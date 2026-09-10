import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectAutomaticTransit } from "../lib/automaticTransit";
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

  it("automatically selects connected stops for arbitrary Pantin and Noisy points", async () => {
    const origin = { lat: 48.902, lon: 2.401 };
    const destination = { lat: 48.838, lon: 2.581 };
    const result = await selectAutomaticTransit(network, origin, destination, async (from, to) =>
      [[from.lon, from.lat], [to.lon, to.lat]], { maxAccessDistanceM: 1500, maxTransfers: 3 });
    const rides = result.journey.legs.filter((leg) => leg.kind === "transit");
    expect(rides.map((leg) => leg.line?.name)).toEqual(["E", "A"]);
    expect(result.walkIn[0]).toEqual([origin.lon, origin.lat]);
    expect(result.walkOut.at(-1)).toEqual([destination.lon, destination.lat]);
    expect(result.journey.transferCount).toBe(1);
  });

  it("retains direct RER A journeys and allows the reverse direction", () => {
    const vincennes = { lat: 48.84732, lon: 2.43349 };
    for (const [from, to] of [[vincennes, noisy], [noisy, vincennes]]) {
      const journey = findTransitJourney(network, from, to);
      expect(journey?.transferCount).toBe(0);
      expect(journey?.legs.filter((leg) => leg.kind === "transit").map((leg) => leg.line?.name)).toEqual(["A"]);
    }
  });

  it("routes a served bus stop pair even when nearby transfer arrivals compete", () => {
    const from = network.stops.findIndex((stop) => stop.id === "IDFM:30006");
    const to = network.stops.findIndex((stop) => stop.id === "IDFM:495675");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThanOrEqual(0);
    const journey = findTransitJourney(network, network.stops[from], network.stops[to], {
      originStopCosts: new Map([[from, 0]]), destinationStopCosts: new Map([[to, 0]])
    });
    expect(journey).not.toBeNull();
    expect(journey!.legs.filter((leg) => leg.kind === "transit").map((leg) => leg.mode)).toContain("bus");
    expect(journey!.from.id).toBe(network.stops[from].id);
    expect(journey!.to.id).toBe(network.stops[to].id);
  });

  it("connects a bus-only boarding stop to RER A through declared interchanges", () => {
    const from = network.stops.findIndex((stop) => stop.id === "IDFM:30006");
    const to = network.stops.findIndex((stop) => stop.id === "IDFM:monomodalStopPlace:58937");
    const journey = findTransitJourney(network, network.stops[from], network.stops[to], {
      originStopCosts: new Map([[from, 0]]), destinationStopCosts: new Map([[to, 0]]), maxTransfers: 3
    });
    expect(journey).not.toBeNull();
    const rides = journey!.legs.filter((leg) => leg.kind === "transit");
    expect(rides[0].mode).toBe("bus");
    expect(rides.at(-1)?.mode).toBe("rer");
    expect(rides.at(-1)?.line?.name).toBe("A");
    expect(journey!.transferCount).toBeLessThanOrEqual(3);
    for (let i = 1; i < journey!.legs.length; i++) {
      expect(journey!.legs[i].coordinates[0]).toEqual(journey!.legs[i - 1].coordinates.at(-1));
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
