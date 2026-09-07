import { describe, expect, it } from "vitest";
import { findTransitJourney } from "../lib/transitRouter";
import type { TransitNetwork, TransitPattern } from "../lib/transitTypes";
import type { LonLat } from "../lib/types";

function fixture(coordinates: LonLat[], routes: number[][], transfers: Array<[number, number]> = []): TransitNetwork {
  return {
    schemaVersion: 1, version: "test-1",
    source: { url: "https://example.test", retrieved: "2026-09-07", license: "test", attribution: "test" },
    stops: coordinates.map(([lon, lat], i) => ({ id: `s${i}`, name: `Stop ${i}`, lat, lon })),
    lines: routes.map((_, i) => ({ id: `l${i}`, name: `Line ${i}`, color: "#123456", mode: i ? "rer" : "metro" })),
    patterns: routes.map((stops, line): TransitPattern => ({
      line, stops, coordinates: stops.map((stop) => coordinates[stop]), offsets: stops.map((_, i) => i)
    })), transfers
  };
}

const linear: LonLat[] = [[2, 48], [2.02, 48], [2.04, 48], [2.06, 48], [2.08, 48]];

function route(network: TransitNetwork, from = 0, to = network.stops.length - 1, maxTransfers = 3) {
  return findTransitJourney(network, network.stops[from], network.stops[to], { maxTransfers });
}

describe("findTransitJourney", () => {
  it("returns a direct service with all intermediate shape coordinates and no transfers", () => {
    const network = fixture(linear, [[0, 1, 2, 3, 4]]);
    network.patterns[0].coordinates.splice(1, 0, [2.01, 48.001]);
    network.patterns[0].offsets = [0, 2, 3, 4, 5];
    const journey = route(network)!;
    expect(journey.transferCount).toBe(0);
    expect(journey.legs).toHaveLength(1);
    expect(journey.legs[0].coordinates).toEqual(network.patterns[0].coordinates);
    expect(journey.networkVersion).toBe("test-1");
    expect(route(network, 1, 3)!.legs[0].coordinates).toEqual(linear.slice(1, 4));
  });

  it("changes lines at a shared platform, with no invented walking segment", () => {
    const network = fixture(linear.slice(0, 3), [[0, 1], [1, 2]]);
    const journey = route(network)!;
    expect(journey.transferCount).toBe(1);
    expect(journey.legs.map((leg) => leg.line?.id)).toEqual(["l0", "l1"]);
    expect(journey.legs.map((leg) => leg.kind)).toEqual(["transit", "transit"]);
    expect(route(network, 0, 2, 0)).toBeNull();
  });

  it("supports multiple changes and enforces the requested maximum", () => {
    const network = fixture(linear, [[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(route(network)!.transferCount).toBe(3);
    expect(route(network)!.legs).toHaveLength(4);
    expect(route(network, 0, 4, 2)).toBeNull();
  });

  it("routes only in the pattern's declared direction", () => {
    const network = fixture(linear.slice(0, 3), [[0, 1, 2]]);
    expect(route(network, 2, 0)).toBeNull();
    const bidirectional = fixture(linear.slice(0, 3), [[0, 1, 2], [2, 1, 0]]);
    expect(route(bidirectional, 2, 0)!.legs[0].coordinates).toEqual(linear.slice(0, 3).reverse());
  });

  it("never changes trains where track shapes merely cross", () => {
    const network = fixture([[2, 48], [2.04, 48], [2.02, 47.98], [2.02, 48.02]], [[0, 1], [2, 3]]);
    expect(route(network)).toBeNull();
  });

  it("requires a declared connection between nearby stops, even with the same name", () => {
    const coordinates: LonLat[] = [[2, 48], [2.02, 48], [2.0201, 48], [2.04, 48]];
    const network = fixture(coordinates, [[0, 1], [2, 3]]);
    network.stops[1].name = network.stops[2].name = "Interchange";
    expect(route(network)).toBeNull();
    const connected = fixture(coordinates, [[0, 1], [2, 3]], [[1, 2]]);
    const journey = route(connected)!;
    expect(journey.transferCount).toBe(1);
    expect(journey.legs.map((leg) => leg.kind)).toEqual(["transit", "transfer", "transit"]);
    expect(journey.legs[1].coordinates).toEqual(coordinates.slice(1, 3));
    expect(journey.legs[1].geometrySource).toBe("station-connector");
  });

  it("respects directed interchange links and chains walking links as one change", () => {
    const network = fixture(linear, [[0, 1], [3, 4]], [[1, 2], [2, 3]]);
    const journey = route(network)!;
    expect(journey.transferCount).toBe(1);
    expect(journey.legs[1].coordinates).toEqual(linear.slice(1, 4));
    const reversedConnection = fixture(linear, [[0, 1], [3, 4]], [[2, 1], [3, 2]]);
    expect(route(reversedConnection)).toBeNull();
  });

  it("anchors riding and walking endpoints to stop-aligned shape offsets", () => {
    const network = fixture(linear.slice(0, 3), [[0, 1], [1, 2]]);
    network.patterns[0].coordinates = [[2.0001, 48], [2.0199, 48]];
    network.patterns[1].coordinates = [[2.0201, 48], [2.0401, 48]];
    const journey = route(network)!;
    expect(journey.from).toMatchObject({ id: "s0", lon: 2.0001 });
    expect(journey.to).toMatchObject({ id: "s2", lon: 2.0401 });
    expect(journey.legs[1].coordinates).toEqual([[2.0199, 48], [2.0201, 48]]);
    for (let i = 1; i < journey.legs.length; i++) {
      expect(journey.legs[i].coordinates[0]).toEqual(journey.legs[i - 1].coordinates.at(-1));
    }
  });

  it("uses the nearest station group instead of skipping to a nearby unrelated station", () => {
    const network = fixture([[2, 48], [2.001, 48], [2.04, 48]], [[1, 2]]);
    expect(route(network)).toBeNull();
    const platforms = fixture([[2, 48], [2.001, 48], [2.04, 48]], [[1, 2]]);
    platforms.stops[0].parent = platforms.stops[1].parent = "station";
    expect(route(platforms)!.from.id).toBe("s1");
  });

  it("does not invent a train loop between points in the same station group", () => {
    const network = fixture([[2, 48], [2.02, 48], [2.0001, 48]], [[0, 1], [1, 2]]);
    network.stops[0].parent = network.stops[2].parent = "same-station";
    expect(route(network)).toBeNull();
    const loop = fixture(linear.slice(0, 2), [[0, 1, 0]]);
    expect(route(loop, 0, 0)).toBeNull();
  });

  it("does not connect points outside the access radius", () => {
    const network = fixture(linear.slice(0, 3), [[0, 1, 2]]);
    expect(findTransitJourney(network, { lat: 49, lon: 2 }, network.stops[2])).toBeNull();
    expect(findTransitJourney(network, network.stops[0], { lat: 49, lon: 2 })).toBeNull();
  });

  it("prefers fewer boardings when the detour is smaller than the transfer penalty", () => {
    const network = fixture([[2, 48], [2.02, 48], [2.04, 48]], [[0, 2], [0, 1], [1, 2]]);
    network.patterns[0].coordinates = [[2, 48], [2.02, 48.005], [2.04, 48]];
    network.patterns[0].offsets = [0, 2];
    expect(route(network)!.transferCount).toBe(0);
    expect(findTransitJourney(network, network.stops[0], network.stops[2], { transferPenaltyM: 0 })!.transferCount).toBe(1);
  });

  it("obeys pickup and dropoff restrictions while allowing trains to pass through", () => {
    const network = fixture(linear.slice(0, 3), [[0, 1, 2]]);
    network.patterns[0].pickup = [true, false, true];
    network.patterns[0].dropoff = [true, false, true];
    expect(route(network)).not.toBeNull();
    expect(route(network, 0, 1)).toBeNull();
    expect(route(network, 1, 2)).toBeNull();
    const interchange = fixture(linear.slice(0, 3), [[0, 1], [1, 2]]);
    interchange.patterns[0].dropoff = [true, false];
    expect(route(interchange)).toBeNull();
  });

  it("keeps the complete train path when a pattern revisits a stop", () => {
    const network = fixture(linear.slice(0, 3), [[0, 1, 0, 2]]);
    network.patterns[0].pickup = [true, true, false, true];
    expect(route(network)!.legs[0].coordinates).toEqual([linear[0], linear[1], linear[0], linear[2]]);
  });

  it("is deterministic and rejects negative or fractional bounds", () => {
    const network = fixture(linear.slice(0, 3), [[0, 1, 2], [0, 1, 2]]);
    expect(route(network)).toEqual(route(network));
    expect(route(network)!.legs[0].line?.id).toBe("l0");
    expect(() => route(network, 0, 2, -1)).toThrow("Invalid transit routing options");
    expect(() => route(network, 0, 2, 0.5)).toThrow("Invalid transit routing options");
  });
});
