import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTrips } from "../lib/generator";
import { createDefaultState, loadState, persistState } from "../lib/stateStore";
import { loadTransitNetwork } from "../lib/transitNetwork";
import type { AppState, GenerationResult, LatLon, RoutingMode } from "../lib/types";
import { createApp } from "../ui/app";
import type { MapCallbacks, MapRenderModel } from "../ui/map";

const mocks = vi.hoisted(() => ({
  callbacks: undefined as MapCallbacks | undefined,
  model: undefined as MapRenderModel | undefined,
  generate: vi.fn(),
  loadNetwork: vi.fn(),
  reverse: vi.fn()
}));

vi.mock("../ui/map", () => ({
  MapView: class {
    constructor(_root: HTMLElement, _center: LatLon, _zoom: number, callbacks: MapCallbacks) {
      mocks.callbacks = callbacks;
    }
    render(model: MapRenderModel) { mocks.model = model; }
    focusOnStation() {}
    focusOnPoint() {}
    focusOnTrip() {}
    getCenter() { return { lat: 48.85, lon: 2.35 }; }
  }
}));
vi.mock("../lib/generator", () => ({ generateTrips: mocks.generate }));
vi.mock("../lib/geocode", () => ({ reverseGeocode: mocks.reverse, searchLocations: vi.fn().mockResolvedValue([]) }));
vi.mock("../lib/overpassClient", () => ({ DEFAULT_OVERPASS_URL: "https://example.invalid/overpass", fetchNearbyStations: vi.fn().mockResolvedValue([]) }));
vi.mock("../lib/transitNetwork", () => ({ isInTransitRegion: () => true, loadTransitNetwork: mocks.loadNetwork }));

function savedStations(): AppState {
  const state = createDefaultState();
  state.schemaVersion = 1;
  state.stations = [
    { id: "old-origin", name: "Pantin", lat: 48.89795, lon: 2.40049, radiusM: 500,
      walkPoints: [
        { id: "origin-1", lat: 48.898, lon: 2.4005, label: "Origin one", addressStatus: "resolved", tripMode: "metro" },
        { id: "origin-2", lat: 48.897, lon: 2.401, label: "Origin two", addressStatus: "resolved", tripMode: "driving" }
      ] },
    { id: "old-destination", name: "Noisy-Champs", lat: 48.84297, lon: 2.58098, radiusM: 600,
      walkPoints: [{ id: "destination-1", lat: 48.843, lon: 2.581, label: "Destination", addressStatus: "resolved", tripMode: "metro" }] }
  ];
  state.selectedOriginStationId = "old-origin";
  state.selectedDestinationStationId = "old-destination";
  state.ui.activeStationId = "old-origin";
  return state;
}

function start(state = savedStations()): void {
  persistState(state);
  document.body.innerHTML = '<div id="app"></div>';
  createApp(document.querySelector<HTMLElement>("#app")!);
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function click(selector: string): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(selector);
  expect(button, `Missing control ${selector}`).not.toBeNull();
  expect(button!.disabled).not.toBe(true);
  button!.click();
  await flush();
}

async function change(selector: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  expect(input, `Missing control ${selector}`).not.toBeNull();
  input!.value = value;
  input!.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
}

let windowListeners: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.clearAllMocks();
  windowListeners = vi.spyOn(window, "addEventListener");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request in app lifecycle test")));
  mocks.reverse.mockResolvedValue({ label: "Mock resolved address", address: { displayName: "Mock resolved address" } });
  mocks.loadNetwork.mockResolvedValue({ schemaVersion: 1, version: "test-network", stops: [], lines: [], patterns: [], transfers: [] });
  const result: GenerationResult = {
    trips: [], report: { requestedTrips: 1, generatedTrips: 0, failedTrips: 0, failures: [],
      pairingStats: { uniquePairsUsed: 0, maxPairReuse: 0 },
      reuseStats: { metroPath: false, walkingLegs: 0, walkingLegRequests: 0 }, serviceStats: { overpassFallback: false } }
  };
  mocks.generate.mockResolvedValue(result);
});

afterEach(() => {
  for (const [type, listener] of windowListeners.mock.calls) {
    window.removeEventListener(type as string, listener as EventListener);
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("places app lifecycle", () => {
  it("migrates saved stations and selects a third place without replacing From/To or point pools", async () => {
    const original = savedStations();
    start(original);
    expect(mocks.model?.stations.map((place) => place.kind)).toEqual(["area", "area"]);
    expect(document.querySelector<HTMLSelectElement>("#originStationSelect")?.value).toBe("old-origin");
    expect(document.querySelector<HTMLSelectElement>("#destinationStationSelect")?.value).toBe("old-destination");

    await click("#modeAddStation");
    mocks.callbacks!.onMapClick({ lat: 48.87, lon: 2.44 });
    await flush();
    const third = loadState().stations[2];
    mocks.callbacks!.onStationClick("old-origin");
    await flush();
    await click(`[data-place-id="${third.id}"]`);

    const state = loadState();
    expect(state.schemaVersion).toBe(2);
    expect(state.ui.activeStationId).toBe(third.id);
    expect(state.selectedOriginStationId).toBe("old-origin");
    expect(state.selectedDestinationStationId).toBe("old-destination");
    expect(state.stations.slice(0, 2).map((place) => place.walkPoints)).toEqual(original.stations.map((place) => place.walkPoints));
  });

  it("creates a single-point place and moves its center and sole point together", async () => {
    start(createDefaultState());
    await click("#modeAddPlacePoint");
    mocks.callbacks!.onMapClick({ lat: 48.85, lon: 2.35 });
    await flush();
    const initial = loadState().stations[0];
    expect(initial.kind).toBe("point");
    expect(initial.walkPoints).toHaveLength(1);
    expect(initial.walkPoints[0]).toMatchObject({ lat: 48.85, lon: 2.35, tripMode: "metro", addressStatus: "resolved" });

    await click("#modeMovePlace");
    mocks.callbacks!.onMapClick({ lat: 48.86, lon: 2.36 });
    await flush();
    const moved = loadState().stations[0];
    expect(moved).toMatchObject({ id: initial.id, lat: 48.86, lon: 2.36 });
    expect(moved.walkPoints).toHaveLength(1);
    expect(moved.walkPoints[0]).toMatchObject({ id: initial.walkPoints[0].id, lat: 48.86, lon: 2.36 });
    expect(mocks.reverse).toHaveBeenLastCalledWith({ lat: 48.86, lon: 2.36 }, expect.any(Object));
  });

  it("adds a new point even after selecting one, and only moves in explicit move mode", async () => {
    start();
    const initial = loadState().stations[0].walkPoints;
    await click('[data-point-id="origin-1"]');
    await click("#modeAddPoint");
    mocks.callbacks!.onMapClick({ lat: 48.8985, lon: 2.401 });
    await flush();
    let points = loadState().stations[0].walkPoints;
    expect(points).toHaveLength(3);
    expect(points.slice(0, 2)).toEqual(initial);
    const addedId = points[2].id;

    await click(`[data-point-id="${addedId}"]`);
    await click("#modeMovePoint");
    mocks.callbacks!.onMapClick({ lat: 48.899, lon: 2.402 });
    await flush();
    points = loadState().stations[0].walkPoints;
    expect(points).toHaveLength(3);
    expect(points[2]).toMatchObject({ id: addedId, lat: 48.899, lon: 2.402, addressStatus: "resolving" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(loadState().stations[0].walkPoints[2].addressStatus).toBe("resolved");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each<RoutingMode>(["transit", "driving", "point_modes"])("passes automatic routing and walking constraints in %s mode", async (routingMode) => {
    start();
    await change("#orsApiKey", "test-only-ors-key");
    await change("#maxAccessDistance", "2300");
    await change("#maxTransfers", "1");
    await change("#routingMode", routingMode);
    await click("#generate");
    expect(generateTrips).toHaveBeenCalledOnce();
    expect(vi.mocked(generateTrips).mock.calls[0][0]).toMatchObject({
      automaticTransit: true, routingMode, maxAccessDistanceM: 2300, maxTransfers: 1,
      orsApiKey: "test-only-ors-key", originStation: { id: "old-origin" }, destinationStation: { id: "old-destination" }
    });
    expect(loadTransitNetwork).toHaveBeenCalledTimes(routingMode === "driving" ? 0 : 1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
