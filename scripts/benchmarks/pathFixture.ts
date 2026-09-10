import type {GpxTripInput} from "../../src/lib/gpxWriter";
import type {TransitNetwork} from "../../src/lib/transitTypes";
import type {LonLat} from "../../src/lib/types";

/** Actual GTFS subpaths, with synthetic straight access legs: export fixture, not routed journeys. */
export function pathFixture(network: TransitNetwork, count: number): GpxTripInput[] {
  let state = 90310;
  const random = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296;};
  const groups = ["bus", "metro", "rer", "train", "tram"].map(mode => network.patterns.filter(p => network.lines[p.line].mode === mode && p.stops.length > 2));
  return Array.from({length: count}, (_, index) => {
    const group = groups[index % groups.length];
    const pattern = group[Math.floor(random() * group.length)];
    const first = Math.floor(random() * (pattern.stops.length - 2));
    const last = Math.min(pattern.stops.length - 1, first + 2 + Math.floor(random() * 10));
    const from = network.stops[pattern.stops[first]], to = network.stops[pattern.stops[last]];
    const coordinates = pattern.coordinates.slice(pattern.offsets[first], pattern.offsets[last] + 1);
    const start = coordinates[0], end = coordinates[coordinates.length - 1];
    const origin: LonLat = [start[0] + .001 + random() * .003, start[1] + random() * .002];
    const destination: LonLat = [end[0] + random() * .003, end[1] + .001 + random() * .002];
    const cycle = index % 5 === 0;
    return {
      id: `trip-${index}`, pairKey: `o${index}-d${index}`, name: `Fixture ${index}`, places: true,
      routeMode: "metro", accessMode: cycle ? "cycling" : undefined,
      originStation: {kind: "point", id: `place-o${index}`, name: from.name, lon: origin[0], lat: origin[1], radiusM: 0},
      destinationStation: {kind: "point", id: `place-d${index}`, name: to.name, lon: destination[0], lat: destination[1], radiusM: 0},
      originPoint: {id: `o${index}`, lon: origin[0], lat: origin[1], addressStatus: "skipped", tripMode: cycle ? "cycling_transit" : "metro"},
      destinationPoint: {id: `d${index}`, lon: destination[0], lat: destination[1], addressStatus: "skipped", tripMode: "metro"},
      walkIn: [origin, start], walkOut: [end, destination], metro: [],
      transitJourney: {from, to, networkVersion: network.version, transferCount: 0, legs: [{
        kind: "transit", mode: network.lines[pattern.line].mode, line: network.lines[pattern.line], from, to, coordinates, geometrySource: "gtfs"
      }]}
    };
  });
}
