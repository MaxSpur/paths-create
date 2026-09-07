import { computeBbox } from "./geo";
import type { GenerationRouteCache } from "./generationRouteCache";
import { newId } from "./ids";
import { fetchRailWays } from "./overpassClient";
import { generateRoundRobinPairs } from "./pairing";
import { createSeededRandom } from "./sampling";
import { OrsClient } from "./orsClient";
import { buildRailGraph, nodePathToCoordinates, shortestPath, snapToNearestNode } from "./railGraph";
import { buildTripGpx } from "./gpxWriter";
import type { TransitJourney, TransitNetwork } from "./transitTypes";
import { routeOutdoorTransfers, withStationAccess } from "./transitWalking";
import { isInTransitRegion } from "./transitNetwork";
import type { AutomaticTransitResult } from "./automaticTransit";
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
  excludedPairKeys?: Iterable<string>;
  startingTripNumber?: number;
  maxSnapDistanceM?: number;
  railPaddingM?: number;
  onProgress?: (update: GenerationProgressUpdate) => void;
  routeCache?: GenerationRouteCache;
  transitNetwork?: TransitNetwork;
  transitNetworkError?: string;
  automaticTransit?: boolean;
  routingMode?: "transit" | "driving" | "point_modes";
  maxAccessDistanceM?: number;
  maxTransfers?: number;
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

function pairUsesDriving(pair: { origin: WalkPoint; destination: WalkPoint }, mode?: GenerateTripsInput["routingMode"]): boolean {
  if (mode === "driving") return true;
  if (mode === "transit") return false;
  return pointTripMode(pair.origin) === "driving" || pointTripMode(pair.destination) === "driving";
}

function pointLatLon(point: WalkPoint): LatLon {
  return { lat: point.lat, lon: point.lon };
}

function coordinateKey(point: LatLon): string {
  return JSON.stringify([point.lat, point.lon]);
}

function walkingLegCacheKey(from: LatLon, to: LatLon): string {
  return `walk:v1|foot-walking|elevation=1|${coordinateKey(from)}|${coordinateKey(to)}`;
}

function metroPathCacheKey(
  overpassUrl: string,
  origin: LatLon,
  destination: LatLon,
  railPaddingM: number,
  maxSnapDistanceM: number
): string {
  return [
    "metro:v1",
    overpassUrl.trim(),
    coordinateKey(origin),
    coordinateKey(destination),
    Math.round(railPaddingM),
    Math.round(maxSnapDistanceM),
    "rail=subway,light_rail,rail"
  ].join("|");
}

async function buildWalkLegs(
  orsClient: OrsClient,
  pointList: WalkPoint[],
  toStation: LatLon,
  fromStation = false,
  onProgress?: (completed: number, total: number) => void,
  routeCache?: GenerationRouteCache
): Promise<{ routes: Map<string, LonLat[]>; reusedCount: number }> {
  const map = new Map<string, LonLat[]>();
  const requests = pointList
    .map((point) => ({
      id: point.id,
      from: fromStation ? toStation : { lat: point.lat, lon: point.lon },
      to: fromStation ? { lat: point.lat, lon: point.lon } : toStation
    }))
    .filter((request) => {
      const cached = routeCache?.getWalkingLeg(walkingLegCacheKey(request.from, request.to));
      if (!cached) return true;
      map.set(request.id, cached);
      return false;
    });

  const cachedCount = map.size;
  onProgress?.(cachedCount, pointList.length);
  const results = await orsClient.getManyWalkingRoutes(
    requests,
    2,
    (completed) => onProgress?.(cachedCount + completed, pointList.length)
  );
  for (const result of results) {
    if (result.coordinates && result.coordinates.length > 1) {
      map.set(result.id, result.coordinates);
      const request = requests.find((item) => item.id === result.id);
      if (request) {
        routeCache?.setWalkingLeg(walkingLegCacheKey(request.from, request.to), result.coordinates);
      }
    }
  }
  return { routes: map, reusedCount: cachedCount };
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
        pairingStats: { uniquePairsUsed: 0, maxPairReuse: 0 },
        reuseStats: { metroPath: false, walkingLegs: 0, walkingLegRequests: 0 },
        serviceStats: { overpassFallback: false }
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
            message: "Both From and To places must contain at least one point."
          }
        ],
        pairingStats: { uniquePairsUsed: 0, maxPairReuse: 0 },
        reuseStats: { metroPath: false, walkingLegs: 0, walkingLegRequests: 0 },
        serviceStats: { overpassFallback: false }
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
    {
      seed: input.seed,
      excludedPairKeys: input.excludedPairKeys
    }
  );
  if (pairings.pairs.length < input.tripCount) {
    addFailure(
      failures,
      "NO_UNUSED_PAIRS",
      `Only ${pairings.pairs.length} unused origin/destination pair${pairings.pairs.length === 1 ? "" : "s"} available for this request.`
    );
  }
  const drivingPairs = pairings.pairs.filter((pair) => pairUsesDriving(pair, input.routingMode));
  const metroPairs = pairings.pairs.filter((pair) => !pairUsesDriving(pair, input.routingMode));
  const needsMetro = metroPairs.length > 0;
  let metroUnavailable: GenerationFailure | null = null;
  let metroCoords: LonLat[] = [];
  let reusedMetroSetup = false;
  let reusedMetroPath = false;
  let reusedWalkingLegs = 0;
  let usedOverpassFallback = false;
  let transitJourney: TransitJourney | undefined;

  if (needsMetro && !input.automaticTransit && input.transitNetworkError) {
    metroUnavailable = { code: "TRANSIT_NETWORK_UNAVAILABLE", message: input.transitNetworkError };
  }
  if (needsMetro && !input.automaticTransit && input.transitNetwork) {
    emitProgress({ phase: "setup", message: "Finding transit lines and interchanges", current: 2, total: 6 });
    const key = `transit:v1|${input.transitNetwork.version}|${coordinateKey(input.originStation)}|${coordinateKey(input.destinationStation)}`;
    transitJourney = input.routeCache?.getTransitJourney(key);
    reusedMetroSetup = Boolean(transitJourney);
    if (!transitJourney) {
      const { findTransitJourney } = await import("./transitRouter");
      const itinerary = findTransitJourney(input.transitNetwork, input.originStation, input.destinationStation);
      if (!itinerary) {
        metroUnavailable = {
          code: "NO_TRANSIT_PATH",
          message: "No plausible transit itinerary within three changes was found near these stations in the Île-de-France snapshot. Check station locations and network coverage."
        };
      } else {
        try {
          transitJourney = await routeOutdoorTransfers(itinerary, async (from, to) => {
            const walkKey = walkingLegCacheKey(from, to);
            const cached = input.routeCache?.getWalkingLeg(walkKey);
            if (cached) return cached;
            const coordinates = await orsClient.getWalkingRoute(from, to);
            if (coordinates.length > 1) input.routeCache?.setWalkingLeg(walkKey, coordinates);
            return coordinates;
          });
          input.routeCache?.setTransitJourney(key, transitJourney);
        } catch (error) {
          metroUnavailable = { code: "TRANSFER_WALK_FAILED", message: getErrorMessage(error) };
        }
      }
    }
  }

  if (needsMetro && !input.automaticTransit && !input.transitNetwork && !input.transitNetworkError) {
    const railPaddingM = input.railPaddingM ?? 1800;
    const maxSnapDistanceM = input.maxSnapDistanceM ?? 200;
    const metroCacheKey = metroPathCacheKey(
      input.overpassUrl,
      stationPoint(input.originStation),
      stationPoint(input.destinationStation),
      railPaddingM,
      maxSnapDistanceM
    );
    const cachedMetroSetup = input.routeCache?.getMetroSetup(metroCacheKey);
    if (cachedMetroSetup) {
      reusedMetroSetup = true;
      metroCoords = cachedMetroSetup.elevatedCoordinates ?? cachedMetroSetup.railCoordinates;
      reusedMetroPath = cachedMetroSetup.elevatedCoordinates !== undefined;
      emitProgress({
        phase: "setup",
        message: reusedMetroPath
          ? "Reusing metro path from this session"
          : "Reusing rail path; refreshing elevation",
        current: reusedMetroPath ? 5 : 4,
        total: 6
      });
    }

    if (!cachedMetroSetup) {
      emitProgress({
        phase: "setup",
        message: "Fetching rail network",
        current: 2,
        total: 6
      });
      const bbox = computeBbox(
        [stationPoint(input.originStation), stationPoint(input.destinationStation)],
        railPaddingM
      );

      const railData = await fetchRailWays(input.overpassUrl, bbox, {
        onFallback: () => {
          usedOverpassFallback = true;
          emitProgress({
            phase: "setup",
            message: "Primary Overpass endpoint unavailable; trying the documented backup",
            current: 2,
            total: 6
          });
        }
      });
      emitProgress({
        phase: "setup",
        message: "Building rail graph",
        current: 3,
        total: 6
      });
      const graph = buildRailGraph(railData);

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
          input.routeCache?.setMetroSetup(metroCacheKey, { railCoordinates: metroCoords });
        }
      }
    }
  }

  emitProgress({
    phase: "setup",
    message: (input.automaticTransit || input.transitNetwork) && needsMetro
      ? "Preparing transit access and egress"
      : needsMetro
      ? reusedMetroPath
        ? "Reusing metro path from this session"
        : "Draping metro path elevation"
      : "Skipping metro setup",
    current: 5,
    total: 6
  });
  if (needsMetro && !input.transitNetwork && !metroUnavailable && metroCoords.length > 0) {
    if (!reusedMetroPath) {
      try {
        const railCoordinates = metroCoords;
        metroCoords = await orsClient.drapeLine(metroCoords);
        const railPaddingM = input.railPaddingM ?? 1800;
        const maxSnapDistanceM = input.maxSnapDistanceM ?? 200;
        input.routeCache?.setMetroSetup(
          metroPathCacheKey(
            input.overpassUrl,
            stationPoint(input.originStation),
            stationPoint(input.destinationStation),
            railPaddingM,
            maxSnapDistanceM
          ),
          {
            railCoordinates,
            elevatedCoordinates: metroCoords
          }
        );
      } catch (error) {
        addFailure(
          failures,
          "METRO_ELEVATION_FAILED",
          `Could not drape metro path elevation: ${getErrorMessage(error)}`
        );
      }
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
  let totalWalkRequests = input.automaticTransit ? 0 : uniqueOrigins.length + uniqueDestinations.length;
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
  if (metroPairs.length > 0 && !input.automaticTransit && !metroUnavailable) {
    const [walkInResult, walkOutResult] = await Promise.all([
      buildWalkLegs(
        orsClient,
        uniqueOrigins,
        transitJourney?.from ?? stationPoint(input.originStation),
        false,
        (completed) => {
          walkInCompleted = completed;
          emitWalkingProgress("Walking to origin station");
        },
        input.routeCache
      ),
      buildWalkLegs(
        orsClient,
        uniqueDestinations,
        transitJourney?.to ?? stationPoint(input.destinationStation),
        true,
        (completed) => {
          walkOutCompleted = completed;
          emitWalkingProgress("Walking from destination station");
        },
        input.routeCache
      )
    ]);
    walkInMap = walkInResult.routes;
    walkOutMap = walkOutResult.routes;
    reusedWalkingLegs = walkInResult.reusedCount + walkOutResult.reusedCount;
  }

  const automaticJourneys = new Map<string, AutomaticTransitResult>();
  if (input.automaticTransit && metroPairs.length) {
    const { selectAutomaticTransit, TransitSelectionError } = await import("./automaticTransit");
    // Share both successes and failures within this batch, without persisting failures.
    const pendingWalks = new Map<string, Promise<LonLat[]>>();
    let serviceFailure: unknown;
    const walk = (from: LatLon, to: LatLon): Promise<LonLat[]> => {
      if (serviceFailure) return Promise.reject(serviceFailure);
      const key = walkingLegCacheKey(from, to);
      const pending = pendingWalks.get(key);
      if (pending) return pending;
      totalWalkRequests++;
      const cached = input.routeCache?.getWalkingLeg(key);
      if (cached) {
        reusedWalkingLegs++;
        const result = Promise.resolve(cached);
        pendingWalks.set(key, result);
        return result;
      }
      const result = orsClient.getWalkingRoute(from, to).then((coords) => {
        if (coords.length > 1) input.routeCache?.setWalkingLeg(key, coords);
        return coords;
      }).catch((error: unknown) => {
        const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
        if ([401, 403, 429].includes(status) || status >= 500 || error instanceof TypeError) serviceFailure = error;
        throw error;
      });
      pendingWalks.set(key, result);
      return result;
    };
    const uniquePairs = [...new Map(metroPairs.map((pair) => [pair.pairKey, pair])).values()];
    for (let index = 0; index < uniquePairs.length; index++) {
      const pair = uniquePairs[index];
      emitProgress({ phase: "walking", message: `Choosing transit stops and walking routes (${index + 1}/${uniquePairs.length})`,
        current: index, total: uniquePairs.length });
      try {
        if (!isInTransitRegion(pair.origin) || !isInTransitRegion(pair.destination)) {
          throw new TransitSelectionError("TRANSIT_OUTSIDE_COVERAGE", "Transit routing currently covers Île-de-France. One or both trip points are outside this area; driving remains available.");
        }
        if (input.transitNetworkError || !input.transitNetwork) {
          throw new TransitSelectionError("TRANSIT_NETWORK_UNAVAILABLE", input.transitNetworkError ?? "The Île-de-France transit network is unavailable.");
        }
        const result = await selectAutomaticTransit(input.transitNetwork, pair.origin, pair.destination, walk, {
          maxAccessDistanceM: input.maxAccessDistanceM ?? 1500,
          maxTransfers: input.maxTransfers ?? 3
        });
        automaticJourneys.set(pair.pairKey, result);
      } catch (error) {
        const code = error instanceof TransitSelectionError ? error.code : "TRANSIT_ROUTING_FAILED";
        const message = getErrorMessage(error);
        if (!failures.some((failure) => failure.code === code && failure.message === message)) addFailure(failures, code, message);
      }
    }
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
    const useDriving = pairUsesDriving(pair, input.routingMode);
    const tripNumber = (input.startingTripNumber ?? 1) + trips.length;
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
        pairKey: pair.pairKey,
        routeMode: "driving",
        places: input.automaticTransit,
        originStation: input.originStation,
        destinationStation: input.destinationStation,
        originPoint: pair.origin,
        destinationPoint: pair.destination,
        walkIn: [],
        metro: [],
        walkOut: [],
        driving
      });

      trips.push({
        id: tripId,
        pairKey: pair.pairKey,
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

    const automaticJourney = automaticJourneys.get(pair.pairKey);
    if (input.automaticTransit && !automaticJourney) continue;
    const walkIn = automaticJourney?.walkIn ?? walkInMap.get(pair.origin.id);
    const walkOut = automaticJourney?.walkOut ?? walkOutMap.get(pair.destination.id);

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

    let tripTransitJourney: TransitJourney | undefined = automaticJourney?.journey;
    if (transitJourney) {
      try {
        tripTransitJourney = withStationAccess(transitJourney, walkIn, walkOut);
      } catch (error) {
        addFailure(failures, "STATION_ACCESS_FAILED", getErrorMessage(error));
        continue;
      }
    }

    const gpx = buildTripGpx({
      id: tripId,
      name: tripName,
      pairKey: pair.pairKey,
      routeMode: "metro",
      places: input.automaticTransit,
      originStation: input.originStation,
      destinationStation: input.destinationStation,
      originPoint: pair.origin,
      destinationPoint: pair.destination,
      walkIn,
      metro: metroCoords,
      walkOut,
      transitJourney: tripTransitJourney
    });

    trips.push({
      id: tripId,
      pairKey: pair.pairKey,
      fileName: `${sanitizeFileName(input.originStation.name)}-${sanitizeFileName(input.destinationStation.name)}-${String(tripNumber).padStart(3, "0")}.gpx`,
      gpx,
      routeMode: "metro",
      originPoint: pair.origin,
      destinationPoint: pair.destination,
      walkInCoords: walkIn,
      metroCoords,
      walkOutCoords: walkOut,
      drivingCoords: [],
      transitJourney: tripTransitJourney
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
    current: input.tripCount,
    total: input.tripCount
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
      },
      reuseStats: {
        metroPath: reusedMetroSetup,
        walkingLegs: reusedWalkingLegs,
        walkingLegRequests: totalWalkRequests
      },
      serviceStats: {
        overpassFallback: usedOverpassFallback,
        ...((input.automaticTransit || input.transitNetwork || input.transitNetworkError) && needsMetro ? { transitNetwork: true } : {})
      }
    }
  };
}
