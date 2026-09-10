import { createStateStore, createDefaultState, loadState, STORAGE_KEY } from "../lib/stateStore";
import { describe, expect, it, vi } from "vitest";

describe("stateStore", () => {
  it.each(["cycling", "cycling_transit"] as const)("persists %s with independently bounded bike access", (routingMode) => {
    const store = createStateStore(createDefaultState());
    expect(store.getState().generation.maxCyclingDistanceM).toBe(5000);
    store.update((draft) => {
      draft.generation.routingMode = routingMode;
      draft.generation.maxCyclingDistanceM = 99999;
      return draft;
    });
    expect(loadState().generation).toMatchObject({ routingMode: "point_modes", maxCyclingDistanceM: 20000, maxAccessDistanceM: 1500 });
    store.update((draft) => { draft.generation.maxCyclingDistanceM = -1; return draft; });
    expect(loadState().generation.maxCyclingDistanceM).toBe(100);
  });

  it("preserves opt-out and skipped points, while old or invalid preferences default to lookup enabled", () => {
    const state = createDefaultState();
    state.lookupAddresses = false;
    state.stations = [{ id: "area", name: "Area", lat: 48, lon: 2, radiusM: 500, walkPoints: [
      { id: "new", lat: 48, lon: 2, label: "Resolving address...", addressStatus: "resolving" },
      { id: "saved", lat: 48.1, lon: 2.1, label: "Saved address", addressStatus: "resolved" }
    ] }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const loaded = loadState();
    expect(loaded.lookupAddresses).toBe(false);
    expect(loaded.stations[0].walkPoints[0]).toMatchObject({ label: "48.00000, 2.00000", addressStatus: "skipped" });
    expect(loaded.stations[0].walkPoints[1].label).toBe("Saved address");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loaded, lookupAddresses: undefined }));
    expect(loadState().lookupAddresses).toBe(true);
    expect(loadState().stations[0].walkPoints[0].addressStatus).toBe("skipped");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loaded, lookupAddresses: "false" }));
    expect(loadState().lookupAddresses).toBe(true);
  });

  it("persists and rehydrates state", () => {
    const store = createStateStore();
    store.update((draft) => {
      draft.orsApiKey = "test-key";
      draft.overpassUrl = "https://example.com/interpreter";
      draft.stations.push({
        id: "st1",
        name: "Station 1",
        lat: 10,
        lon: 20,
        radiusM: 400,
        walkPoints: [
          {
            id: "p1",
            lat: 10.001,
            lon: 20.001,
            label: "a",
            address: {
              displayName: "Address A",
              components: {
                road: "Main Street",
                empty: ""
              }
            }
          }
        ]
      });
      draft.selectedOriginStationId = "st1";
      draft.selectedDestinationStationId = "st1";
      draft.ui.activeStationId = "st1";
      return draft;
    });

    const loaded = loadState();
    expect(loaded.orsApiKey).toBe("test-key");
    expect(loaded.stations).toHaveLength(1);
    expect(loaded.stations[0].walkPoints).toHaveLength(1);
    expect(loaded.stations[0].walkPoints[0]?.tripMode).toBe("metro");
    expect(loaded.stations[0].walkPoints[0]?.address).toEqual({
      displayName: "Address A",
      components: {
        road: "Main Street"
      }
    });
    expect(loaded.selectedOriginStationId).toBe("st1");
  });

  it("recovers from corrupted localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    const loaded = loadState();
    expect(loaded).toEqual(createDefaultState());
  });

  it("keeps points attached to station when station position changes", () => {
    const store = createStateStore();
    store.update((draft) => {
      draft.stations = [
        {
          id: "a",
          name: "A",
          lat: 1,
          lon: 1,
          radiusM: 500,
          walkPoints: [{ id: "pA", lat: 1.001, lon: 1.001 }]
        },
        {
          id: "b",
          name: "B",
          lat: 2,
          lon: 2,
          radiusM: 500,
          walkPoints: [{ id: "pB", lat: 2.001, lon: 2.001 }]
        }
      ];
      return draft;
    });

    store.update((draft) => {
      const stationA = draft.stations.find((s) => s.id === "a");
      if (stationA) {
        stationA.lat = 9;
        stationA.lon = 9;
      }
      return draft;
    });

    const state = store.getState();
    expect(state.stations.find((s) => s.id === "a")?.walkPoints.map((p) => p.id)).toEqual(["pA"]);
    expect(state.stations.find((s) => s.id === "b")?.walkPoints.map((p) => p.id)).toEqual(["pB"]);
  });

  it("normalizes invalid station selections to null", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...createDefaultState(),
        selectedOriginStationId: "missing",
        selectedDestinationStationId: "missing",
        ui: {
          activeStationId: "missing",
          mapCenter: { lat: 0, lon: 0 },
          mapZoom: 10
        }
      })
    );

    const loaded = loadState();
    expect(loaded.selectedOriginStationId).toBeNull();
    expect(loaded.selectedDestinationStationId).toBeNull();
    expect(loaded.ui.activeStationId).toBeNull();
  });

  it("can persist map-only state without notifying UI subscribers", () => {
    const store = createStateStore(createDefaultState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.update((draft) => {
      draft.ui.mapCenter = { lat: 48.847, lon: 2.439 };
      draft.ui.mapZoom = 15;
      return draft;
    }, { notify: false });

    expect(listener).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").ui.mapZoom).toBe(15);
  });
  it("migrates v1 station pools into areas without losing IDs, radii, points, roles or mixed modes", () => {
    const state = createDefaultState();
    const {routingMode, maxAccessDistanceM, maxTransfers, ...legacyGeneration} = state.generation;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({...state, schemaVersion:1, generation:legacyGeneration,
      stations:[{id:"old",name:"Existing place",lat:48.8,lon:2.4,radiusM:1234,
        walkPoints:[{id:"old-p",lat:48.801,lon:2.401,label:"Saved address",tripMode:"driving"}]}],
      selectedOriginStationId:"old",selectedDestinationStationId:"old",ui:{...state.ui,activeStationId:"old",selectedPointId:"old-p"}}));
    const migrated = loadState();
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.stations[0]).toMatchObject({id:"old",kind:"area",radiusM:1234,walkPoints:[{id:"old-p",label:"Saved address",tripMode:"driving"}]});
    expect(migrated.selectedOriginStationId).toBe("old");
    expect(migrated.selectedDestinationStationId).toBe("old");
    expect(migrated.ui.selectedPointId).toBe("old-p");
    expect(migrated.generation).toMatchObject({routingMode:"point_modes",maxAccessDistanceM:1500,maxTransfers:3});
  });

  it("normalizes point places and bounded routing preferences without discarding extra saved points", () => {
    const store = createStateStore(createDefaultState());
    store.update(draft => {
      draft.stations = [{id:"single",name:"Home",kind:"point",lat:48,lon:2,radiusM:500,walkPoints:[]},
        {id:"multiple",name:"Pool",kind:"point",lat:48,lon:2,radiusM:500,walkPoints:[{id:"p1",lat:48,lon:2},{id:"p2",lat:49,lon:3}]}];
      draft.generation.maxAccessDistanceM = 99999;
      draft.generation.maxTransfers = -1;
      return draft;
    });
    expect(store.getState().stations[0].walkPoints).toHaveLength(1);
    expect(store.getState().stations[1].kind).toBe("area");
    expect(store.getState().stations[1].walkPoints).toHaveLength(2);
    expect(store.getState().generation).toMatchObject({maxAccessDistanceM:5000,maxTransfers:0});
    expect(loadState()).toEqual(store.getState());
  });

});
