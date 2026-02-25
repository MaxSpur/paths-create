import { computeBbox } from "./geo";
import { newId } from "./ids";
import { fetchRailWays } from "./overpassClient";
import { generateRoundRobinPairs } from "./pairing";
import { OrsClient } from "./orsClient";
import { buildRailGraph, nodePathToCoordinates, shortestPath, snapToNearestNode } from "./railGraph";
import { buildTripGpx } from "./gpxWriter";
import type {
  GenerationFailure,
  GenerationResult,
  LatLon,
  LonLat,
  StationRecord,
  WalkPoint
} from "./types";

export interface GenerateTripsInput {
  orsApiKey: string;
  overpassUrl: string;
  originStation: StationRecord;
  destinationStation: StationRecord;
  tripCount: number;
  seed?: number;
  maxSnapDistanceM?: number;
  railPaddingM?: number;
}

function stationPoint(station: StationRecord): LatLon {
  return { lat: station.lat, lon: station.lon };
}

function addFailure(failures: GenerationFailure[], code: string, message: string): void {
  failures.push({ code, message });
}

function sanitizeFileName(name: string): string {
  return name.replaceAll(/[^a-z0-9_-]+/gi, "_");
}

async function buildWalkLegs(
  orsClient: OrsClient,
  pointList: WalkPoint[],
  toStation: LatLon,
  fromStation = false
): Promise<Map<string, LonLat[]>> {
  const requests = pointList.map((point) => ({
    id: point.id,
    from: fromStation ? toStation : { lat: point.lat, lon: point.lon },
    to: fromStation ? { lat: point.lat, lon: point.lon } : toStation
  }));

  const results = await orsClient.getManyWalkingRoutes(requests, 2);
  const map = new Map<string, LonLat[]>();
  for (const result of results) {
    if (result.coordinates && result.coordinates.length > 1) {
      map.set(result.id, result.coordinates);
    }
  }
  return map;
}

export async function generateTrips(input: GenerateTripsInput): Promise<GenerationResult> {
  const failures: GenerationFailure[] = [];

  if (!input.orsApiKey.trim()) {
    return {
      trips: [],
      report: {
        requestedTrips: input.tripCount,
        generatedTrips: 0,
        failedTrips: input.tripCount,
        failures: [{ code: "MISSING_ORS_KEY", message: "ORS API key is required." }],
        pairingStats: { uniquePairsUsed: 0, maxPairReuse: 0 }
      }
    };
  }

  if (input.originStation.walkPoints.length === 0 || input.destinationStation.walkPoints.length === 0) {
    return {
      trips: [],
      report: {
        requestedTrips: input.tripCount,
        generatedTrips: 0,
        failedTrips: input.tripCount,
        failures: [
          {
            code: "EMPTY_POINT_POOL",
            message: "Both origin and destination stations must have at least one walk point."
          }
        ],
        pairingStats: { uniquePairsUsed: 0, maxPairReuse: 0 }
      }
    };
  }

  const railPaddingM = input.railPaddingM ?? 1800;
  const bbox = computeBbox([stationPoint(input.originStation), stationPoint(input.destinationStation)], railPaddingM);

  const railData = await fetchRailWays(input.overpassUrl, bbox);
  const graph = buildRailGraph(railData);

  const maxSnapDistanceM = input.maxSnapDistanceM ?? 200;
  const originNode = snapToNearestNode(graph, stationPoint(input.originStation), maxSnapDistanceM);
  const destinationNode = snapToNearestNode(graph, stationPoint(input.destinationStation), maxSnapDistanceM);

  if (originNode === null || destinationNode === null) {
    return {
      trips: [],
      report: {
        requestedTrips: input.tripCount,
        generatedTrips: 0,
        failedTrips: input.tripCount,
        failures: [
          {
            code: "RAIL_SNAP_FAILED",
            message: "Unable to snap one or both stations to nearby rail graph nodes."
          }
        ],
        pairingStats: { uniquePairsUsed: 0, maxPairReuse: 0 }
      }
    };
  }

  const railNodePath = shortestPath(graph, originNode, destinationNode);
  if (!railNodePath || railNodePath.length < 2) {
    return {
      trips: [],
      report: {
        requestedTrips: input.tripCount,
        generatedTrips: 0,
        failedTrips: input.tripCount,
        failures: [
          {
            code: "NO_RAIL_PATH",
            message: "No rail path could be found between selected stations."
          }
        ],
        pairingStats: { uniquePairsUsed: 0, maxPairReuse: 0 }
      }
    };
  }

  const metroCoords = nodePathToCoordinates(graph, railNodePath);
  const pairings = generateRoundRobinPairs(
    input.originStation.walkPoints,
    input.destinationStation.walkPoints,
    input.tripCount,
    input.seed
  );

  const orsClient = new OrsClient({ apiKey: input.orsApiKey });
  const uniqueOrigins = Array.from(
    new Map(pairings.pairs.map((pair) => [pair.origin.id, pair.origin])).values()
  );
  const uniqueDestinations = Array.from(
    new Map(pairings.pairs.map((pair) => [pair.destination.id, pair.destination])).values()
  );

  const [walkInMap, walkOutMap] = await Promise.all([
    buildWalkLegs(orsClient, uniqueOrigins, stationPoint(input.originStation), false),
    buildWalkLegs(orsClient, uniqueDestinations, stationPoint(input.destinationStation), true)
  ]);

  const trips: GenerationResult["trips"] = [];
  for (let index = 0; index < pairings.pairs.length; index += 1) {
    const pair = pairings.pairs[index];
    const walkIn = walkInMap.get(pair.origin.id);
    const walkOut = walkOutMap.get(pair.destination.id);

    if (!walkIn) {
      addFailure(
        failures,
        "WALK_IN_FAILED",
        `Missing walking route from origin point ${pair.origin.id} to station ${input.originStation.name}.`
      );
      continue;
    }
    if (!walkOut) {
      addFailure(
        failures,
        "WALK_OUT_FAILED",
        `Missing walking route from station ${input.destinationStation.name} to destination point ${pair.destination.id}.`
      );
      continue;
    }

    const tripNumber = trips.length + 1;
    const tripId = newId("trip");
    const tripName = `${input.originStation.name} to ${input.destinationStation.name} #${tripNumber}`;
    const gpx = buildTripGpx({
      id: tripId,
      name: tripName,
      originStationName: input.originStation.name,
      destinationStationName: input.destinationStation.name,
      walkIn,
      metro: metroCoords,
      walkOut
    });

    trips.push({
      id: tripId,
      fileName: `${sanitizeFileName(input.originStation.name)}-${sanitizeFileName(input.destinationStation.name)}-${String(tripNumber).padStart(3, "0")}.gpx`,
      gpx,
      originPoint: pair.origin,
      destinationPoint: pair.destination,
      walkInCoords: walkIn,
      metroCoords,
      walkOutCoords: walkOut
    });
  }

  return {
    trips,
    report: {
      requestedTrips: input.tripCount,
      generatedTrips: trips.length,
      failedTrips: input.tripCount - trips.length,
      failures,
      pairingStats: {
        uniquePairsUsed: pairings.uniquePairsUsed,
        maxPairReuse: pairings.maxPairReuse
      }
    }
  };
}
