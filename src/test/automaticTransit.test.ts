import { afterEach, describe, expect, it, vi } from "vitest";
import { selectAutomaticTransit } from "../lib/automaticTransit";
import { generateTrips } from "../lib/generator";
import { createGenerationRouteCache } from "../lib/generationRouteCache";
import type { TransitNetwork } from "../lib/transitTypes";
import type { LatLon, LonLat, StationRecord } from "../lib/types";

function fixture(coordinates: LonLat[], routes: number[][]): TransitNetwork {
  return {
    schemaVersion: 1, version: "automatic-test",
    source: { url: "fixture", retrieved: "2026-09-07", license: "fixture", attribution: "fixture" },
    stops: coordinates.map(([lon, lat], index) => ({ id: `s${index}`, name: `Stop ${index}`, lon, lat })),
    lines: routes.map((_, index) => ({ id: `L${index}`, name: `${index}`, mode: "rer", color: "123456" })),
    patterns: routes.map((stops, line) => ({ line, stops, coordinates: stops.map((index) => coordinates[index]), offsets: stops.map((_, index) => index) })),
    transfers: []
  };
}
const options = { maxAccessDistanceM: 1500, maxTransfers: 3 };
const directWalk = async (from: LatLon, to: LatLon): Promise<LonLat[]> => [[from.lon, from.lat], [to.lon, to.lat]];
function place(id: string, points: LatLon[]): StationRecord {
  // Area centers are deliberately outside regional coverage; only actual trip points matter.
  return { id, name: id, lat: 0, lon: 0, radiusM: 500,
    walkPoints: points.map((point, index) => ({ ...point, id: `${id}-${index}`, tripMode: "metro" })) };
}
function fetchRoutes(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(String(input)).toMatch(/\/(foot-walking|driving-car)\//);
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ features: [{ geometry: { coordinates: body.coordinates } }] }));
  });
}
afterEach(() => vi.restoreAllMocks());

describe("automatic transit access", () => {
  it("rejects identical points before routing or walking requests", async () => {
    const network = fixture([[2.3, 48.8], [2.31, 48.8]], [[0, 1], [1, 0]]);
    const walk = vi.fn(directWalk);
    await expect(selectAutomaticTransit(network, network.stops[0], network.stops[0], walk, options))
      .rejects.toMatchObject({ code: "IDENTICAL_TRIP_POINTS" });
    expect(walk).not.toHaveBeenCalled();
  });

  it("shares common rail geometry while keeping per-point walking routes distinct", async () => {
    const network = fixture([[2.3, 48.8], [2.5, 48.8]], [[0, 1]]);
    const first = await selectAutomaticTransit(network, { lon: 2.299, lat: 48.8 }, network.stops[1], directWalk, options);
    const second = await selectAutomaticTransit(network, { lon: 2.301, lat: 48.8 }, network.stops[1], directWalk, options);
    expect(second.journey.legs.find((leg) => leg.kind === "transit")?.coordinates)
      .toBe(first.journey.legs.find((leg) => leg.kind === "transit")?.coordinates);
    expect(second.walkIn).not.toBe(first.walkIn);
  });

  it("finds a farther connected station when the nearest station is isolated", async () => {
    const network = fixture([[2.3, 48.8], [2.31, 48.8], [2.5, 48.8]], [[1, 2]]);
    const journey = await selectAutomaticTransit(network, network.stops[0], network.stops[2], directWalk, options);
    expect(journey.journey.from.id).toBe("s1");
    expect(journey.journey.to.id).toBe("s2");
  });

  it("tries another boarding stop after an inaccessible pedestrian route", async () => {
    const network = fixture([[2.3, 48.8], [2.31, 48.8], [2.5, 48.8]], [[0, 2], [1, 2]]);
    const walk = vi.fn(async (from: LatLon, to: LatLon) => {
      if (to.lon === 2.3) throw new Error("Pedestrian route unavailable");
      return directWalk(from, to);
    });
    const result = await selectAutomaticTransit(network, { lat: 48.8, lon: 2.3001 }, network.stops[2], walk, options);
    expect(result.journey.from.id).toBe("s1");
    expect(walk).toHaveBeenCalledTimes(3);
  });

  it("checks routed walking length, not just proximity, and retries a reachable stop", async () => {
    const network = fixture([[2.3, 48.8], [2.31, 48.8], [2.5, 48.8]], [[0, 2], [1, 2]]);
    const walk = async (from: LatLon, to: LatLon): Promise<LonLat[]> => to.lon === 2.3
      ? [[from.lon, from.lat], [2.3, 48.85], [to.lon, to.lat]] : directWalk(from, to);
    expect((await selectAutomaticTransit(network, { lat: 48.8, lon: 2.3001 }, network.stops[2], walk, options)).journey.from.id).toBe("s1");
    await expect(selectAutomaticTransit(network, { lat: 48.8, lon: 2.3001 }, network.stops[2], walk,
      { ...options, maxAccessDistanceM: 500 })).rejects.toMatchObject({ code: "NO_REACHABLE_TRANSIT_STOP" });
  });

  it("reranks a connected candidate when real pedestrian detours outweigh its closer stop", async () => {
    const network = fixture([[2.3, 48.8], [2.31, 48.8], [2.5, 48.8]], [[0, 2], [1, 2]]);
    const walk = async (from: LatLon, to: LatLon): Promise<LonLat[]> => to.lon === 2.3
      ? [[from.lon, from.lat], [2.3, 48.806], [to.lon, to.lat]] : directWalk(from, to);
    const result = await selectAutomaticTransit(network, { lat: 48.8, lon: 2.3001 }, network.stops[2], walk, options);
    expect(result.journey.from.id).toBe("s1");
  });

  it("reports the absence of nearby stops without pedestrian requests", async () => {
    const network = fixture([[2.3, 48.8], [2.5, 48.8]], [[0, 1]]);
    const walk = vi.fn(directWalk);
    await expect(selectAutomaticTransit(network, { lat: 49, lon: 2 }, network.stops[1], walk, options))
      .rejects.toMatchObject({ code: "NO_REACHABLE_TRANSIT_STOP" });
    expect(walk).not.toHaveBeenCalled();
  });

  it("does not spend more requests on candidate stations after an authentication failure", async () => {
    const network = fixture([[2.3, 48.8], [2.31, 48.8], [2.5, 48.8]], [[0, 2], [1, 2]]);
    const walk = vi.fn(async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); });
    await expect(selectAutomaticTransit(network, network.stops[0], network.stops[2], walk, options))
      .rejects.toMatchObject({ code: "WALKING_SERVICE_UNAVAILABLE" });
    expect(walk).toHaveBeenCalledTimes(1);
  });
});

describe("place-to-place generation", () => {
  it("chooses different stops for actual points in the same area and shares cached walks", async () => {
    const network = fixture([[2.3, 48.8], [2.32, 48.8], [2.5, 48.8]], [[0, 1, 2]]);
    const fetchMock = fetchRoutes();
    const args = {
      orsApiKey: "fixture", overpassUrl: "https://overpass.test", automaticTransit: true,
      routingMode: "transit" as const, transitNetwork: network, routeCache: createGenerationRouteCache(),
      originStation: place("From area", network.stops.slice(0, 2)), destinationStation: place("To area", [network.stops[2]]), tripCount: 2
    };
    const first = await generateTrips(args);
    expect(first.report.failures).toEqual([]);
    expect(first.trips).toHaveLength(2);
    expect(first.trips.map((trip) => trip.transitJourney?.from.id).sort()).toEqual(["s0", "s1"]);
    expect(first.trips.every((trip) => trip.transitJourney?.to.id === "s2")).toBe(true);
    expect(first.trips[0].gpx).toContain('kind="stop"');
    const requests = fetchMock.mock.calls.length;
    const second = await generateTrips(args);
    expect(second.trips).toHaveLength(2);
    expect(fetchMock.mock.calls.length).toBe(requests);
    expect(second.report.reuseStats.walkingLegs).toBeGreaterThan(0);
  });

  it("never uses track fallback outside coverage; forced driving still works there", async () => {
    const fetchMock = fetchRoutes();
    const args = { orsApiKey: "fixture", overpassUrl: "https://overpass.test", automaticTransit: true,
      originStation: place("From", [{ lat: 52.5, lon: 13.4 }]), destinationStation: place("To", [{ lat: 52.51, lon: 13.42 }]), tripCount: 1 };
    const transit = await generateTrips({ ...args, routingMode: "transit" });
    expect(transit.trips).toEqual([]);
    expect(transit.report.failures[0].code).toBe("TRANSIT_OUTSIDE_COVERAGE");
    expect(fetchMock).not.toHaveBeenCalled();
    const driving = await generateTrips({ ...args, routingMode: "driving" });
    expect(driving.trips).toHaveLength(1);
    expect(driving.trips[0].routeMode).toBe("driving");
  });

  it("uses forced transit even when a point retains its old driving override", async () => {
    const network = fixture([[2.3, 48.8], [2.5, 48.8]], [[0, 1]]);
    fetchRoutes();
    const origin = place("From", [network.stops[0]]);
    origin.walkPoints[0].tripMode = "driving";
    const result = await generateTrips({ orsApiKey: "fixture", overpassUrl: "https://overpass.test", automaticTransit: true,
      routingMode: "transit", transitNetwork: network, originStation: origin, destinationStation: place("To", [network.stops[1]]), tripCount: 1 });
    expect(result.trips[0].routeMode).toBe("metro");
  });
});
