import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findTransitJourney } from "../lib/transitRouter";
import type { TransitNetwork } from "../lib/transitTypes";
import { haversineDistanceM, toLatLon } from "../lib/geo";

const network = JSON.parse(readFileSync("public/data/idfm-transit.json", "utf8")) as TransitNetwork;
const noisy = { lat: 48.84297, lon: 2.58098 };

describe("published IDFM snapshot", () => {
  it("routes Pantin to Noisy–Champs via E, Val de Fontenay and A with continuous legs", () => {
    const journey = findTransitJourney(network, { lat: 48.89795, lon: 2.40049 }, noisy);
    expect(journey).not.toBeNull();
    expect(journey?.transferCount).toBe(1);
    const rides = journey!.legs.filter((leg) => leg.kind === "transit");
    expect(rides.map((leg) => leg.line?.name)).toEqual(["E", "A"]);
    expect(rides[0].to.name).toBe("Val de Fontenay");
    expect(rides[1].from.name).toBe("Val de Fontenay");
    for (let i = 1; i < journey!.legs.length; i++) {
      expect(journey!.legs[i].coordinates[0]).toEqual(journey!.legs[i - 1].coordinates.at(-1));
    }
  });

  it("retains direct RER A journeys and allows the reverse direction", () => {
    const vincennes = { lat: 48.84732, lon: 2.43349 };
    for (const [from, to] of [[vincennes, noisy], [noisy, vincennes]]) {
      const journey = findTransitJourney(network, from, to);
      expect(journey?.transferCount).toBe(0);
      expect(journey?.legs.filter((leg) => leg.kind === "transit").map((leg) => leg.line?.name)).toEqual(["A"]);
    }
  });

  it("contains valid directed shapes, offsets, stop permissions and transfer indexes", () => {
    expect(network.source.license).toBeTruthy();
    for (const pattern of network.patterns) {
      expect(network.lines[pattern.line]).toBeDefined();
      expect(pattern.stops.length).toBe(pattern.offsets.length);
      expect(pattern.pickup?.length).toBe(pattern.stops.length);
      expect(pattern.dropoff?.length).toBe(pattern.stops.length);
      for (let i = 0; i < pattern.stops.length; i++) {
        const stop = network.stops[pattern.stops[i]];
        const point = pattern.coordinates[pattern.offsets[i]];
        expect(stop).toBeDefined();
        expect(point.every(Number.isFinite)).toBe(true);
        expect(haversineDistanceM(stop, toLatLon(point))).toBeLessThan(405);
        if (i) expect(pattern.offsets[i]).toBeGreaterThan(pattern.offsets[i - 1]);
      }
    }
    for (const [from, to] of network.transfers) {
      expect(network.stops[from]).toBeDefined();
      expect(network.stops[to]).toBeDefined();
    }
  });
});
