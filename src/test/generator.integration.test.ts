import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTrips } from "../lib/generator";
import type { StationRecord } from "../lib/types";

function createOrsResponse(payload: { coordinates: [number, number, number?][] }): Response {
  return new Response(
    JSON.stringify({
      features: [
        {
          geometry: {
            coordinates: payload.coordinates
          }
        }
      ]
    }),
    { status: 200 }
  );
}

function createElevationResponse(payload: { coordinates: [number, number][] }): Response {
  return new Response(
    JSON.stringify({
      type: "LineString",
      coordinates: payload.coordinates.map(([lon, lat], index) => [lon, lat, 200 + index])
    }),
    { status: 200 }
  );
}

function createConnectedRailResponse(): Response {
  return new Response(
    JSON.stringify({
      elements: [
        { type: "node", id: 1, lat: 52.5, lon: 13.4 },
        { type: "node", id: 2, lat: 52.5, lon: 13.41 },
        { type: "node", id: 3, lat: 52.5, lon: 13.42 },
        { type: "way", id: 10, nodes: [1, 2, 3], tags: { railway: "subway" } }
      ]
    }),
    { status: 200 }
  );
}

function createDisconnectedRailResponse(): Response {
  return new Response(
    JSON.stringify({
      elements: [
        { type: "node", id: 1, lat: 52.5, lon: 13.4 },
        { type: "node", id: 2, lat: 52.5, lon: 13.401 },
        { type: "node", id: 3, lat: 52.5, lon: 13.42 },
        { type: "node", id: 4, lat: 52.5, lon: 13.421 },
        { type: "way", id: 11, nodes: [1, 2], tags: { railway: "subway" } },
        { type: "way", id: 12, nodes: [3, 4], tags: { railway: "subway" } }
      ]
    }),
    { status: 200 }
  );
}

const originStation: StationRecord = {
  id: "origin",
  name: "Origin",
  lat: 52.5,
  lon: 13.4,
  radiusM: 500,
  walkPoints: [
    { id: "o1", lat: 52.499, lon: 13.398, label: "o1" },
    { id: "o2", lat: 52.501, lon: 13.399, label: "o2" }
  ]
};

const destinationStation: StationRecord = {
  id: "destination",
  name: "Destination",
  lat: 52.5,
  lon: 13.42,
  radiusM: 500,
  walkPoints: [
    { id: "d1", lat: 52.499, lon: 13.422, label: "d1" },
    { id: "d2", lat: 52.501, lon: 13.423, label: "d2" }
  ]
};

describe("generateTrips integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates deterministic trips with fixed seed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("overpass")) {
        return createConnectedRailResponse();
      }
      if (url.includes("/elevation/line")) {
        const body = JSON.parse(String(init?.body));
        return createElevationResponse({ coordinates: body.geometry.coordinates });
      }
      if (url.includes("openrouteservice")) {
        const body = JSON.parse(String(init?.body));
        expect(body.elevation).toBe(true);
        return createOrsResponse({
          coordinates: body.coordinates.map(([lon, lat]: [number, number], index: number) => [lon, lat, 100 + index])
        });
      }
      throw new Error(`Unhandled URL: ${url}`);
    });

    const runA = await generateTrips({
      orsApiKey: "key",
      overpassUrl: "https://overpass.test/interpreter",
      originStation,
      destinationStation,
      tripCount: 4,
      seed: 123
    });

    const runB = await generateTrips({
      orsApiKey: "key",
      overpassUrl: "https://overpass.test/interpreter",
      originStation,
      destinationStation,
      tripCount: 4,
      seed: 123
    });

    expect(runA.report.generatedTrips).toBe(4);
    expect(runB.report.generatedTrips).toBe(4);
    expect(runA.report.failures).toEqual([]);
    expect(runA.trips.map((trip) => `${trip.originPoint.id}-${trip.destinationPoint.id}`)).toEqual(
      runB.trips.map((trip) => `${trip.originPoint.id}-${trip.destinationPoint.id}`)
    );
    expect(runA.trips[0]?.gpx).toContain("<ele>");
    expect(runA.trips[0]?.gpx).toContain("xmlns:odc=");
    expect(runA.trips[0]?.gpx).toContain('routeMode="metro"');
    expect(runA.trips[0]?.gpx).toContain('<type>walking</type>');
    expect(runA.trips[0]?.gpx).toContain('<type>metro</type>');
    expect(runA.trips[0]?.metroCoords[0]?.[2]).toBe(200);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/elevation/line"))).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns NO_RAIL_PATH when stations are disconnected", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("overpass")) {
        return createDisconnectedRailResponse();
      }
      return createOrsResponse({ coordinates: [] });
    });

    const result = await generateTrips({
      orsApiKey: "key",
      overpassUrl: "https://overpass.test/interpreter",
      originStation,
      destinationStation,
      tripCount: 4,
      seed: 2
    });

    expect(result.report.generatedTrips).toBe(0);
    expect(result.report.failures[0]?.code).toBe("NO_RAIL_PATH");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses direct driving routes for pairs containing driving-mode points", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("overpass")) {
        throw new Error("Driving-only generation should not fetch rail data.");
      }
      if (url.includes("/driving-car/geojson")) {
        const body = JSON.parse(String(init?.body));
        expect(body.alternative_routes).toBeTruthy();
        return new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  coordinates: [
                    body.coordinates[0],
                    [13.41, 52.51, 111],
                    body.coordinates[1]
                  ]
                }
              },
              {
                geometry: {
                  coordinates: [
                    body.coordinates[0],
                    [13.415, 52.515, 222],
                    body.coordinates[1]
                  ]
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unhandled URL: ${url}`);
    });

    const result = await generateTrips({
      orsApiKey: "key",
      overpassUrl: "https://overpass.test/interpreter",
      originStation: {
        ...originStation,
        walkPoints: [{ ...originStation.walkPoints[0], tripMode: "driving" }]
      },
      destinationStation: {
        ...destinationStation,
        walkPoints: [{ ...destinationStation.walkPoints[0], tripMode: "metro" }]
      },
      tripCount: 1,
      seed: 123
    });

    expect(result.report.generatedTrips).toBe(1);
    expect(result.report.failures).toEqual([]);
    expect(result.trips.every((trip) => trip.routeMode === "driving")).toBe(true);
    expect(result.trips.every((trip) => trip.pairKey === "o1::d1")).toBe(true);
    expect(result.trips.every((trip) => trip.drivingCoords.length === 3)).toBe(true);
    expect(result.trips.every((trip) => trip.metroCoords.length === 0)).toBe(true);
    expect(result.trips.every((trip) => trip.gpx.includes('routeMode="driving"'))).toBe(true);
    expect(result.trips.every((trip) => trip.gpx.includes("<type>driving</type>"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not request routes for excluded existing pairs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(createOrsResponse({ coordinates: [] }));

    const result = await generateTrips({
      orsApiKey: "key",
      overpassUrl: "https://overpass.test/interpreter",
      originStation: {
        ...originStation,
        walkPoints: [{ ...originStation.walkPoints[0], tripMode: "driving" }]
      },
      destinationStation: {
        ...destinationStation,
        walkPoints: [{ ...destinationStation.walkPoints[0], tripMode: "driving" }]
      },
      tripCount: 1,
      seed: 123,
      excludedPairKeys: ["o1::d1"]
    });

    expect(result.trips).toEqual([]);
    expect(result.report.failures[0]?.code).toBe("NO_UNUSED_PAIRS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
