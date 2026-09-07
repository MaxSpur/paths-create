import { afterEach, describe, expect, it, vi } from "vitest";
import { generateTrips } from "../lib/generator";
import { createGenerationRouteCache } from "../lib/generationRouteCache";
import { routeOutdoorTransfers, withStationAccess } from "../lib/transitWalking";
import type { StationRecord } from "../lib/types";
import type { TransitNetwork } from "../lib/transitTypes";
import { transitJourneyFixture } from "./transitJourneyFixture";

const network: TransitNetwork = {
  schemaVersion: 1, version: "test",
  source: { url: "fixture", retrieved: "2026-09-07", license: "fixture", attribution: "fixture" },
  lines: [
    { id: "E", name: "E", mode: "rer", color: "ff00ff" },
    { id: "A", name: "A", mode: "rer", color: "ff0000" }
  ],
  stops: [
    { id: "o", name: "Origin", lat: 52.5, lon: 13.4 },
    { id: "x1", name: "Interchange", lat: 52.5, lon: 13.409, parent: "x" },
    { id: "x2", name: "Interchange", lat: 52.5, lon: 13.410, parent: "x" },
    { id: "d", name: "Destination", lat: 52.5, lon: 13.42 }
  ],
  patterns: [
    { line: 0, stops: [0, 1], coordinates: [[13.4, 52.5], [13.409, 52.5]], offsets: [0, 1] },
    { line: 1, stops: [2, 3], coordinates: [[13.410, 52.5], [13.42, 52.5]], offsets: [0, 1] }
  ], transfers: [[1, 2]]
};
const origin: StationRecord = {
  ...network.stops[0], radiusM: 500,
  walkPoints: [{ id: "o1", lat: 52.499, lon: 13.399 }]
};
const destination: StationRecord = {
  ...network.stops[3], radiusM: 500,
  walkPoints: [{ id: "d1", lat: 52.501, lon: 13.421 }]
};

afterEach(() => vi.restoreAllMocks());

describe("transit generation", () => {
  it("generates and caches two-line GPX without requesting rail ways or surface rail elevation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toContain("/foot-walking/");
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: body.coordinates } }] }));
    });
    const routeCache = createGenerationRouteCache();
    const args = {
      orsApiKey: "fixture-key", overpassUrl: "https://overpass.test",
      originStation: origin, destinationStation: destination,
      tripCount: 1, transitNetwork: network, routeCache
    };
    const first = await generateTrips(args);
    expect(first.report.failures).toEqual([]);
    expect(first.trips).toHaveLength(1);
    expect(first.trips[0].transitJourney?.transferCount).toBe(1);
    expect(first.trips[0].transitJourney?.legs.map((leg) => leg.line?.name ?? "walk")).toEqual(["E", "walk", "A"]);
    expect(first.trips[0].gpx).toContain('schemaVersion="2"');
    expect(first.trips[0].metroCoords).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = await generateTrips(args);
    expect(second.report.reuseStats.metroPath).toBe(true);
    expect(second.report.reuseStats.walkingLegs).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    routeCache.clear();
    await generateTrips(args);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reports missing transit instead of inventing a rail connection or substituting driving", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await generateTrips({
      orsApiKey: "fixture-key", overpassUrl: "https://overpass.test",
      originStation: origin, destinationStation: destination, tripCount: 1,
      transitNetwork: { ...network, transfers: [] }
    });
    expect(result.trips).toEqual([]);
    expect(result.report.failures[0].code).toBe("NO_TRANSIT_PATH");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses ORS geometry for longer outdoor changes and rejects distant walking snaps", async () => {
    const journey = transitJourneyFixture();
    const transfer = journey.legs[1];
    transfer.to = { ...transfer.to, lon: transfer.from.lon + 0.01 };
    const walk = vi.fn(async () => [
      [transfer.from.lon, transfer.from.lat] as [number, number],
      [transfer.to.lon, transfer.to.lat] as [number, number]
    ]);
    const resolved = await routeOutdoorTransfers(journey, walk);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(resolved.legs[1].geometrySource).toBe("ors");
    expect(() => withStationAccess(journey, [[0, 0]], [[0, 0]])).toThrow("too far");
  });

  it("keeps driving pairs working when the transit asset is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toContain("/driving-car/");
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ features: [{ geometry: { coordinates: body.coordinates } }] }));
    });
    const result = await generateTrips({
      orsApiKey: "fixture-key", overpassUrl: "https://overpass.test",
      originStation: { ...origin, walkPoints: [...origin.walkPoints, { id: "car", lat: 52.5, lon: 13.4, tripMode: "driving" }] },
      destinationStation: destination, tripCount: 2,
      transitNetworkError: "Transit snapshot unavailable."
    });
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].routeMode).toBe("driving");
    expect(result.report.failures).toContainEqual({
      code: "TRANSIT_NETWORK_UNAVAILABLE", message: "Transit snapshot unavailable."
    });
  });
});
