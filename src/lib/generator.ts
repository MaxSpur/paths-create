import { computeBbox } from "./geo";
import { newId } from "./ids";
import { fetchRailWays } from "./overpassClient";
import { generateRoundRobinPairs } from "./pairing";
import { createSeededRandom } from "./sampling";
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

export interface GenerationProgressUpdate {
  phase: "setup" | "walking" | "driving" | "assemble" | "done";
  message: string;
  current: number;
  total: number;
}

export interface GenerateTripsInput {
  orsApiKey: string;
  overpassUrl: string;
  originStation: StationRecord;
  destinationStation: StationRecord;
  tripCount: number;
  seed?: number;
  maxSnapDistanceM?: number;
  railPaddingM?: number;
  onProgress?: (update: GenerationProgressUpdate) => void;
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pointTripMode(point: WalkPoint): "metro" | "driving" {
  return point.tripMode === "driving" ? "driving" : "metro";
}

function pairUsesDriving(pair: { origin: WalkPoint; destination: WalkPoint }): boolean {
  return pointTripMode(pair.origin) === "driving" || pointTripMode(pair.destination) === "driving";
}

function pointLatLon(point: WalkPoint): LatLon {
  return { lat: point.lat, lon: point.lon };
}

async function buildWalkLegs(
  orsClient: OrsClient,
  pointList: WalkPoint[],
  toStation: LatLon,
  fromStation = false,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, LonLat[]>> {
  const requests = pointList.map((point) => ({
    id: point.id,
    from: fromStation ? toStation : { lat: point.lat, lon: point.lon },
    to: fromStation ? { lat: point.lat, lon: point.lon } : toStation
  }));

  const results = await orsClient.getManyWalkingRoutes(requests, 2, onProgress);
  const map = new Map<string, LonLat[]>();
  for (const result of results) {
    if (result.coordinates && result.coordinates.length > 1) {
      map.set(result.id, result.coordinates);
    }
  }
  return map;
}

async function buildDrivingRoutes(
  orsClient: OrsClient,
  pairs: Array<{ origin: WalkPoint; destination: WalkPoint; pairKey: string }>,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, LonLat[][]>> {
  const uniquePairs = Array.from(new Map(pairs.map((pair) => [pair.pairKey, pair])).values());
  const results = await orsClient.getManyDrivingRouteAlternatives(
    uniquePairs.map((pair) => ({
      id: pair.pairKey,
      from: pointLatLon(pair.origin),
      to: pointLatLon(pair.destination)
    })),
    2,
    onProgress
  );

  const routeMap = new Map<string, LonLat[][]>();
  for (const result of results) {
    if (result.alternatives && result.alternatives.length > 0) {
      routeMap.set(result.id, result.alternatives);
    }
  }

  return routeMap;
}

export async function generateTrips(input: GenerateTripsInput): Promise<GenerationResult> {
  const failures: GenerationFailure[] = [];
  const progress = input.onProgress;

  const emitProgress = (update: GenerationProgressUpdate) => {
    progress?.(update);
  };

  emitProgress({
    phase: "setup",
    message: "Checking inputs",
    current: 0,
    total: 6
  });

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

  const orsClient = new OrsClient({ apiKey: input.orsApiKey });

  emitProgress({
    phase: "setup",
    message: "Generating point pairings",
    current: 1,
    total: 6
  });
  const pairings = generateRoundRobinPairs(
    input.originStation.walkPoints,
    input.destinationStation.walkPoints,
    input.tripCount,
    input.seed
  );
  const drivingPairs = pairings.pairs.filter((pair) => pairUsesDriving(pair));
  const metroPairs = pairings.pairs.filter((pair) => !pairUsesDriving(pair));
  const needsMetro = metroPairs.length > 0;
  let metroUnavailable: GenerationFailure | null = null;
  let metroCoords: LonLat[] = [];

  if (needsMetro) {
    const railPaddingM = input.railPaddingM ?? 1800;
    emitProgress({
      phase: "setup",
      message: "Fetching rail network",
      current: 2,
      total: 6
    });
    const bbox = computeBbox([stationPoint(input.originStation), stationPoint(input.destinationStation)], railPaddingM);

    const railData = await fetchRailWays(input.overpassUrl, bbox);
    emitProgress({
      phase: "setup",
      message: "Building rail graph",
      current: 3,
      total: 6
    });
    const graph = buildRailGraph(railData);

    const maxSnapDistanceM = input.maxSnapDistanceM ?? 200;
    const originNode = snapToNearestNode(graph, stationPoint(input.originStation), maxSnapDistanceM);
    const destinationNode = snapToNearestNode(graph, stationPoint(input.destinationStation), maxSnapDistanceM);

    if (originNode === null || destinationNode === null) {
      metroUnavailable = {
        code: "RAIL_SNAP_FAILED",
        message: "Unable to snap one or both stations to nearby rail graph nodes."
      };
    } else {
      emitProgress({
        phase: "setup",
        message: "Computing metro path",
        current: 4,
        total: 6
      });
      const railNodePath = shortestPath(graph, originNode, destinationNode);
      if (!railNodePath || railNodePath.length < 2) {
        metroUnavailable = {
          code: "NO_RAIL_PATH",
          message: "No rail path could be found between selected stations."
        };
      } else {
        metroCoords = nodePathToCoordinates(graph, railNodePath);
      }
    }
  }

  emitProgress({
    phase: "setup",
    message: needsMetro ? "Draping metro path elevation" : "Skipping metro setup",
    current: 5,
    total: 6
  });
  if (needsMetro && !metroUnavailable && metroCoords.length > 0) {
    try {
      metroCoords = await orsClient.drapeLine(metroCoords);
    } catch (error) {
      addFailure(
        failures,
        "METRO_ELEVATION_FAILED",
        `Could not drape metro path elevation: ${getErrorMessage(error)}`
      );
    }
  }

  emitProgress({
    phase: "setup",
    message: "Preparing route requests",
    current: 6,
    total: 6
  });

  const uniqueOrigins = Array.from(new Map(metroPairs.map((pair) => [pair.origin.id, pair.origin])).values());
  const uniqueDestinations = Array.from(new Map(metroPairs.map((pair) => [pair.destination.id, pair.destination])).values());
  const totalWalkRequests = uniqueOrigins.length + uniqueDestinations.length;
  let walkInCompleted = 0;
  let walkOutCompleted = 0;
  const emitWalkingProgress = (label: string) => {
    emitProgress({
      phase: "walking",
      message: `${label} (${walkInCompleted + walkOutCompleted}/${totalWalkRequests})`,
      current: walkInCompleted + walkOutCompleted,
      total: Math.max(1, totalWalkRequests)
    });
  };

  let walkInMap = new Map<string, LonLat[]>();
  let walkOutMap = new Map<string, LonLat[]>();
  if (metroPairs.length > 0 && !metroUnavailable) {
    [walkInMap, walkOutMap] = await Promise.all([
      buildWalkLegs(
        orsClient,
        uniqueOrigins,
        stationPoint(input.originStation),
        false,
        (completed) => {
          walkInCompleted = completed;
          emitWalkingProgress("Walking to origin station");
        }
      ),
      buildWalkLegs(
        orsClient,
        uniqueDestinations,
        stationPoint(input.destinationStation),
        true,
        (completed) => {
          walkOutCompleted = completed;
          emitWalkingProgress("Walking from destination station");
        }
      )
    ]);
  }

  const totalDrivingRequests = new Set(drivingPairs.map((pair) => pair.pairKey)).size;
  let drivingCompleted = 0;
  let drivingRouteMap = new Map<string, LonLat[][]>();
  if (drivingPairs.length > 0) {
    emitProgress({
      phase: "driving",
      message: `Preparing driving routes (0/${totalDrivingRequests})`,
      current: 0,
      total: Math.max(1, totalDrivingRequests)
    });
    drivingRouteMap = await buildDrivingRoutes(orsClient, drivingPairs, (completed, total) => {
      drivingCompleted = completed;
      emitProgress({
        phase: "driving",
        message: `Preparing driving routes (${drivingCompleted}/${total})`,
        current: drivingCompleted,
        total: Math.max(1, total)
      });
    });
  }

  const trips: GenerationResult["trips"] = [];
  const routeRandom = createSeededRandom(input.seed === undefined ? undefined : input.seed + 0x9e3779b9);
  if (metroUnavailable && metroPairs.length > 0) {
    addFailure(failures, metroUnavailable.code, metroUnavailable.message);
  }

  emitProgress({
    phase: "assemble",
    message: "Composing trip GPX files",
    current: 0,
    total: pairings.pairs.length
  });
  for (let index = 0; index < pairings.pairs.length; index += 1) {
    const pair = pairings.pairs[index];
    const useDriving = pairUsesDriving(pair);
    const tripNumber = trips.length + 1;
    const tripId = newId("trip");
    const tripName = `${input.originStation.name} to ${input.destinationStation.name} #${tripNumber}`;

    if (useDriving) {
      const alternatives = drivingRouteMap.get(pair.pairKey);
      if (!alternatives || alternatives.length === 0) {
        addFailure(
          failures,
          "DRIVING_ROUTE_FAILED",
          `Missing driving route from origin point ${pair.origin.id} to destination point ${pair.destination.id}.`
        );
        continue;
      }

      const driving = alternatives[Math.floor(routeRandom() * alternatives.length)] ?? alternatives[0];
      const gpx = buildTripGpx({
        id: tripId,
        name: tripName,
        originStationName: input.originStation.name,
        destinationStationName: input.destinationStation.name,
        walkIn: [],
        metro: [],
        walkOut: [],
        driving
      });

      trips.push({
        id: tripId,
        fileName: `${sanitizeFileName(input.originStation.name)}-${sanitizeFileName(input.destinationStation.name)}-${String(tripNumber).padStart(3, "0")}.gpx`,
        gpx,
        routeMode: "driving",
        originPoint: pair.origin,
        destinationPoint: pair.destination,
        walkInCoords: [],
        metroCoords: [],
        walkOutCoords: [],
        drivingCoords: driving
      });

      emitProgress({
        phase: "assemble",
        message: "Composing trip GPX files",
        current: index + 1,
        total: pairings.pairs.length
      });
      continue;
    }

    if (metroUnavailable) {
      continue;
    }

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
      routeMode: "metro",
      originPoint: pair.origin,
      destinationPoint: pair.destination,
      walkInCoords: walkIn,
      metroCoords,
      walkOutCoords: walkOut,
      drivingCoords: []
    });

    emitProgress({
      phase: "assemble",
      message: "Composing trip GPX files",
      current: index + 1,
      total: pairings.pairs.length
    });
  }

  emitProgress({
    phase: "done",
    message: "Generation complete",
    current: 1,
    total: 1
  });

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
