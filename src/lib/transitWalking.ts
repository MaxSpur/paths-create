import { haversineDistanceM, toLatLon } from "./geo";
import type { LonLat } from "./types";
import type { TransitJourney, TransitLeg, TransitStop } from "./transitTypes";

function connector(from: TransitStop, to: TransitStop): TransitLeg {
  return {
    kind: "transfer", mode: "walking", from, to,
    coordinates: [[from.lon, from.lat], [to.lon, to.lat]],
    geometrySource: "station-connector"
  };
}

function atCoordinate(stop: TransitStop, coord: LonLat): TransitStop {
  return { ...stop, ...toLatLon(coord) };
}

/** Explicit approximate links between a street route's snapped end and a platform. */
function joinGap(from: TransitStop, to: TransitStop): TransitLeg[] {
  const distance = haversineDistanceM(from, to);
  if (from.lat === to.lat && from.lon === to.lon) return [];
  if (distance > 500) throw new Error(`Walking route ends too far from ${to.name} (${Math.round(distance)} m).`);
  return [connector(from, to)];
}

export async function routeOutdoorTransfers(
  journey: TransitJourney,
  walkingRoute: (from: TransitStop, to: TransitStop) => Promise<LonLat[]>
): Promise<TransitJourney> {
  const legs: TransitLeg[] = [];
  for (const leg of journey.legs) {
    // Short/in-station connections use the explicit GTFS link, not a fabricated street route.
    const sameStation = leg.from.parent && leg.from.parent === leg.to.parent;
    if (leg.kind !== "transfer" || sameStation || haversineDistanceM(leg.from, leg.to) <= 350) {
      legs.push(leg);
      continue;
    }
    const coords = await walkingRoute(leg.from, leg.to);
    if (coords.length < 2) throw new Error(`No walking route for the interchange at ${leg.from.name}.`);
    const start = atCoordinate(leg.from, coords[0]);
    const end = atCoordinate(leg.to, coords[coords.length - 1]);
    legs.push(...joinGap(leg.from, start), {
      ...leg, from: start, to: end, coordinates: coords, geometrySource: "ors"
    }, ...joinGap(end, leg.to));
  }
  return { ...journey, legs };
}

export function withStationAccess(
  journey: TransitJourney, walkIn: LonLat[], walkOut: LonLat[]
): TransitJourney {
  if (!walkIn.length || !walkOut.length) throw new Error("Missing transit access or egress route.");
  return {
    ...journey,
    legs: [
      ...joinGap(atCoordinate(journey.from, walkIn[walkIn.length - 1]), journey.from),
      ...journey.legs,
      ...joinGap(journey.to, atCoordinate(journey.to, walkOut[0]))
    ]
  };
}
