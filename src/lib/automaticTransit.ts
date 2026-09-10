import { haversineDistanceM, toLatLon } from "./geo";
import { findTransitJourney } from "./transitRouter";
import { routeOutdoorTransfers, withStationAccess } from "./transitWalking";
import type { LatLon, LonLat } from "./types";
import type { TransitJourney, TransitNetwork } from "./transitTypes";

const WALKING_WEIGHT = 3;
const MAX_CANDIDATE_ATTEMPTS = 12;

export class TransitSelectionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface AutomaticTransitResult {
  journey: TransitJourney;
  walkIn: LonLat[];
  walkOut: LonLat[];
  accessMode?: "cycling";
}

function rethrowServiceFailure(error: unknown): void {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if ([401, 403, 429].includes(status) || status >= 500 || error instanceof TypeError) {
    throw new TransitSelectionError("WALKING_SERVICE_UNAVAILABLE",
      status === 401 || status === 403 ? "The routing service rejected the ORS key. Check the key before retrying."
        : "The routing service is unavailable or rate limited. Try again later.");
  }
}

function distance(coordinates: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineDistanceM(toLatLon(coordinates[i - 1]), toLatLon(coordinates[i]));
  }
  return total;
}

/** Include all platforms in range, so an isolated nearest stop cannot hide another line. */
function candidates(network: TransitNetwork, point: LatLon, radius: number, weight = WALKING_WEIGHT): Map<number, number> {
  const result = new Map<number, number>();
  network.stops.forEach((stop, index) => {
    const length = haversineDistanceM(point, stop);
    if (length <= radius) result.set(index, length * weight);
  });
  return result;
}

/** ORS may snap to a street. Reject remote snaps and include small endpoint gaps in the limit. */
function accessDistance(coordinates: LonLat[], from: LatLon, to: LatLon, limit: number): number {
  if (coordinates.length < 2) throw new Error("No access route was returned.");
  const startGap = haversineDistanceM(from, toLatLon(coordinates[0]));
  const endGap = haversineDistanceM(to, toLatLon(coordinates[coordinates.length - 1]));
  if (startGap > 500 || endGap > 500) throw new Error("The access route snaps too far from its endpoint.");
  const length = distance(coordinates) + startGap + endGap;
  if (!Number.isFinite(length) || length > limit) throw new Error(`Street access exceeds ${Math.round(limit)} m.`);
  return length;
}

/**
 * One multi-source graph search per refinement, never a station-pair request matrix.
 * Only promising endpoints are sent to ORS; real walk costs can change the preferred
 * station. Failed access candidates are removed and another connected stop is tried.
 */
export async function selectAutomaticTransit(
  network: TransitNetwork, origin: LatLon, destination: LatLon,
  walkingRoute: (from: LatLon, to: LatLon) => Promise<LonLat[]>,
  options: { maxAccessDistanceM: number; maxTransfers: number; cyclingAccess?: { maxDistanceM: number; route: (from: LatLon, to: LatLon) => Promise<LonLat[]> } }
): Promise<AutomaticTransitResult> {
  const { maxAccessDistanceM, maxTransfers } = options;
  if (!Number.isFinite(maxAccessDistanceM) || maxAccessDistanceM <= 0 ||
      !Number.isInteger(maxTransfers) || maxTransfers < 0 || maxTransfers > 6) {
    throw new TransitSelectionError("INVALID_TRANSIT_OPTIONS", "Choose a positive walking limit and zero to six changes.");
  }
  if (origin.lat === destination.lat && origin.lon === destination.lon) {
    throw new TransitSelectionError("IDENTICAL_TRIP_POINTS", "The trip starts and ends at the same point. Choose distinct points for a transit journey.");
  }
  const cycle = options.cyclingAccess;
  if (cycle && (!Number.isFinite(cycle.maxDistanceM) || cycle.maxDistanceM <= 0)) {
    throw new TransitSelectionError("INVALID_TRANSIT_OPTIONS", "Choose a positive cycling access limit.");
  }
  const starts = candidates(network, origin, cycle?.maxDistanceM ?? maxAccessDistanceM, cycle ? 1 : WALKING_WEIGHT);
  if (cycle) {
    const rerStops = new Set(network.patterns.filter((pattern) => network.lines[pattern.line].mode === "rer").flatMap((pattern) => pattern.stops));
    for (const index of starts.keys()) if (!rerStops.has(index)) starts.delete(index);
  }
  const ends = candidates(network, destination, maxAccessDistanceM);
  if (!starts.size || !ends.size) {
    throw new TransitSelectionError("NO_REACHABLE_TRANSIT_STOP", cycle ? "No RER boarding stop lies within cycling range, or no destination stop lies within walking range." : "No transit stop lies within the walking limit of one or both trip points.");
  }
  const indexes = new Map(network.stops.map((stop, index) => [stop.id, index]));
  const checked = new Map<string, { coordinates: LonLat[]; length: number }>();
  const blockedTransferStops = new Set<string>();
  let rejectedAccess = false;
  let rejectedTransfer = false;
  let exhausted = true;
  for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS; attempt++) {
    const journey = findTransitJourney(network, origin, destination, {
      originStopCosts: starts, destinationStopCosts: ends, maxTransfers,
      maxAccessDistanceM, walkingWeight: WALKING_WEIGHT, blockedTransferStops, initialBoardingMode: cycle ? "rer" : undefined
    });
    if (!journey) { exhausted = false; break; }
    const access: LonLat[][] = [];
    let refined = false;
    for (const [inbound, stop] of [[true, journey.from], [false, journey.to]] as const) {
      const from = inbound ? origin : stop;
      const to = inbound ? stop : destination;
      const costs = inbound ? starts : ends;
      const index = indexes.get(stop.id)!;
      const key = JSON.stringify([inbound, from.lat, from.lon, to.lat, to.lon]);
      let route = checked.get(key);
      if (!route) {
        try {
          const coordinates = await (inbound && cycle ? cycle.route : walkingRoute)(from, to);
          route = { coordinates, length: accessDistance(coordinates, from, to, inbound && cycle ? cycle.maxDistanceM : maxAccessDistanceM) };
          checked.set(key, route);
          // Actual walking costs are used on the next graph search before selection.
          costs.set(index, route.length * (inbound && cycle ? 1 : WALKING_WEIGHT));
          refined = true;
        } catch (error) {
          rethrowServiceFailure(error);
          costs.delete(index);
          rejectedAccess = true;
          refined = true;
          break;
        }
      }
      access.push(route.coordinates);
    }
    if (refined) continue;
    if (access.length !== 2) continue;
    let failedTransferStop: string | undefined;
    try {
      const routed = await routeOutdoorTransfers(journey, async (from, to) => {
        try { return await walkingRoute(from, to); }
        catch (error) { failedTransferStop = from.id; throw error; }
      });
      return { journey: withStationAccess(routed, access[0], access[1]), walkIn: access[0], walkOut: access[1], ...(cycle ? { accessMode: "cycling" as const } : {}) };
    } catch (error) {
      rethrowServiceFailure(error);
      if (!failedTransferStop) {
        // A returned interchange route can also fail the bounded snap check.
        failedTransferStop = journey.legs.find((leg) => leg.kind === "transfer" &&
          leg.geometrySource === "station-connector" && haversineDistanceM(leg.from, leg.to) > 350)?.from.id;
      }
      if (!failedTransferStop) throw new TransitSelectionError("STATION_ACCESS_FAILED", "Walking geometry could not connect to the selected transit stops.");
      blockedTransferStops.add(failedTransferStop);
      rejectedTransfer = true;
    }
  }
  if (exhausted) throw new TransitSelectionError("TRANSIT_SEARCH_LIMIT", "The transit search reached its candidate limit before verifying a journey. Try a nearby point or a smaller walking radius.");
  if (rejectedAccess) throw new TransitSelectionError("NO_REACHABLE_TRANSIT_STOP", "The candidate transit stops could not be reached within the access limits. Try another point or larger limits.");
  if (rejectedTransfer) throw new TransitSelectionError("TRANSFER_WALK_FAILED", "No itinerary with reachable walking interchanges was found.");
  throw new TransitSelectionError("NO_TRANSIT_PATH", "No connected transit itinerary was found between these points within the walking and change limits.");
}
