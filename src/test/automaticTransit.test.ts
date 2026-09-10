import { afterEach, describe, expect, it, vi } from "vitest";
import { selectAutomaticTransit } from "../lib/automaticTransit";
import { generateTrips } from "../lib/generator";
import { collectPreviewSegments } from "../ui/previewSegments";
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
    expect(String(input)).toMatch(/\/(foot-walking|driving-car|cycling-regular)\//);
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


describe("cycling routes", () => {
  it("routes direct cycling without any transit data or driving override", async () => {
    const fetchMock = fetchRoutes();
    const origin = place("From", [{lat: 52.5, lon: 13.4}]);
    origin.walkPoints[0].tripMode = "driving";
    const result = await generateTrips({orsApiKey: "fixture", overpassUrl: "unused", automaticTransit: true,
      routingMode: "cycling", originStation: origin, destinationStation: place("To", [{lat:52.51, lon:13.42}]), tripCount:1});
    expect(result.report.failures).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/cycling-regular/geojson");
    const trip = result.trips[0];
    expect(trip.routeMode).toBe("cycling");
    expect(trip.drivingCoords).toEqual([]);
    expect(trip.gpx).toContain('role="cycling" mode="cycling"');
    expect(trip.gpx).toContain('schemaVersion="4"');
    expect(collectPreviewSegments([trip], trip.id)).toEqual([expect.objectContaining({role:"cycling", highlighted:true, coords:trip.cyclingCoords})]);
  });

  it("cycles to a farther RER station then walks at the destination, with explicit parking uncertainty", async () => {
    const network = fixture([[2.3,48.8], [2.5,48.8]], [[0,1]]);
    const fetchMock = fetchRoutes();
    const args = {orsApiKey:"fixture", overpassUrl:"unused", automaticTransit:true,
      originStation:place("From", [{lat:48.8,lon:2.27}]), destinationStation:place("To", [network.stops[1]]),
      tripCount:1, transitNetwork:network, maxAccessDistanceM:500, maxCyclingDistanceM:3000, routeCache:createGenerationRouteCache()};
    const walking = await generateTrips({...args, routingMode:"transit"});
    expect(walking.trips).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const cycling = await generateTrips({...args, routingMode:"cycling_transit"});
    expect(cycling.report.failures).toEqual([]);
    const trip = cycling.trips[0];
    expect(trip.accessMode).toBe("cycling");
    expect(trip.gpx).toContain('bikeParking="unverified"');
    expect(trip.gpx).toContain('bikeHandling="leave-at-boarding-station"');
    expect(trip.gpx).toContain('role="cycle-in" mode="cycling"');
    expect(trip.gpx).toContain('role="walk-out" mode="walking"');
    expect(fetchMock.mock.calls.map((call: unknown[])=>String(call[0]))).toEqual([expect.stringContaining("cycling-regular"),expect.stringContaining("foot-walking")]);
    expect(collectPreviewSegments([trip], null).map(s=>s.role)).toEqual(["cycle-in","transit","walk-out"]);
    const count = fetchMock.mock.calls.length;
    expect((await generateTrips({...args,routingMode:"cycling_transit"})).trips).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });

  it("keeps walking and cycling caches separate for identical access endpoints", async () => {
    const network = fixture([[2.3,48.8], [2.5,48.8]], [[0,1]]);
    const fetchMock = fetchRoutes();
    const args = {orsApiKey:"fixture", overpassUrl:"unused", automaticTransit:true,
      originStation:place("From", [{lat:48.8,lon:2.299}]), destinationStation:place("To", [network.stops[1]]),
      tripCount:1, transitNetwork:network, routeCache:createGenerationRouteCache()};
    expect((await generateTrips({...args,routingMode:"transit"})).trips).toHaveLength(1);
    expect((await generateTrips({...args,routingMode:"cycling_transit"})).trips).toHaveLength(1);
    expect(fetchMock.mock.calls.map((call: unknown[])=>String(call[0]))).toEqual([expect.stringContaining("foot-walking"),expect.stringContaining("foot-walking"),expect.stringContaining("cycling-regular")]);
  });

  it("rejects long bicycle detours even when a RER station is nearby", async () => {
    const network = fixture([[2.3,48.8], [2.5,48.8]], [[0,1]]);
    const route = vi.fn(async (from:LatLon,to:LatLon):Promise<LonLat[]> => [[from.lon,from.lat],[2.3,48.85],[to.lon,to.lat]]);
    await expect(selectAutomaticTransit(network,network.stops[0],network.stops[1],directWalk,
      {...options, cyclingAccess:{maxDistanceM:1000,route}})).rejects.toMatchObject({code:"NO_REACHABLE_TRANSIT_STOP"});
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("does not replace RER bike access with bus boarding", async () => {
    const network = fixture([[2.3,48.8], [2.5,48.8]], [[0,1]]);
    network.lines[0].mode = "bus";
    const route = vi.fn(directWalk);
    await expect(selectAutomaticTransit(network,network.stops[0],network.stops[1],directWalk,
      {...options,cyclingAccess:{maxDistanceM:5000,route}})).rejects.toMatchObject({code:"NO_REACHABLE_TRANSIT_STOP"});
    expect(route).not.toHaveBeenCalled();
  });
});

describe("mixed point modes and local provider",()=>{
  it("generates all four point modes in one batch with correct GPX point metadata",async()=>{
    const network=fixture([[2.3,48.8],[2.5,48.8]],[[0,1]]);
    fetchRoutes();
    const origin=place("From",Array.from({length:4},()=>({lat:48.8,lon:2.299})));
    const modes=["metro","driving","cycling","cycling_transit"] as const;
    origin.walkPoints.forEach((point,index)=>{point.tripMode=modes[index];});
    const result=await generateTrips({orsApiKey:"fixture",overpassUrl:"unused",automaticTransit:true,routingMode:"point_modes",transitNetwork:network,
      originStation:origin,destinationStation:place("To",[network.stops[1]]),tripCount:4});
    expect(result.report.failures).toEqual([]);
    expect(result.trips).toHaveLength(4);
    for(const trip of result.trips){
      const mode=trip.originPoint.tripMode;
      expect(trip.routeMode).toBe(mode==="cycling_transit"?"metro":mode);
      expect(trip.accessMode).toBe(mode==="cycling_transit"?"cycling":undefined);
      expect(trip.gpx).toContain(`tripMode="${mode}"`);
    }
  });
  it("uses local 2D directions without a key and never reuses hosted access geometry",async()=>{
    const network=fixture([[2.3,48.8],[2.5,48.8]],[[0,1]]);
    const fetchMock=fetchRoutes();
    const args={orsApiKey:"fixture-hosted-key",overpassUrl:"unused",automaticTransit:true,routingMode:"transit" as const,transitNetwork:network,
      originStation:place("From",[{lat:48.8,lon:2.299}]),destinationStation:place("To",[network.stops[1]]),tripCount:1,routeCache:createGenerationRouteCache()};
    expect((await generateTrips(args)).trips).toHaveLength(1);
    const count=fetchMock.mock.calls.length;
    expect((await generateTrips({...args,routingProvider:"local"})).trips).toHaveLength(1);
    const calls=fetchMock.mock.calls.slice(count) as [unknown,RequestInit][];
    expect(calls).toHaveLength(2);
    for(const [url,init] of calls){
      expect(String(url)).toContain("http://127.0.0.1:8082/ors/v2/directions/");
      expect(init.headers).not.toHaveProperty("Authorization");
      expect(JSON.parse(String(init.body)).elevation).toBe(false);
    }
    expect((await generateTrips({...args,routingProvider:"local",orsApiKey:""})).trips).toHaveLength(1);
  });
});
