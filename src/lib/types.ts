import type { TransitJourney } from "./transitTypes";

export type PairingMode = "round_robin_shuffle";
export type PointTripMode = "metro" | "driving" | "cycling" | "cycling_transit";
export type TripRouteMode = "metro" | "driving" | "cycling";

export interface StructuredAddress {
  displayName?: string;
  components?: Record<string, string>;
}

export interface WalkPoint {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  address?: StructuredAddress;
  addressStatus?: "resolving" | "resolved" | "failed" | "skipped";
  tripMode?: PointTripMode;
}

export type RoutingMode = "transit" | "driving" | "cycling" | "cycling_transit" | "point_modes";

export interface PlaceRecord {
  kind?: "area" | "point";
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  walkPoints: WalkPoint[];
}

/** Legacy storage/API name; records now represent arbitrary places and areas. */
export type StationRecord = PlaceRecord;

export interface AppState {
  schemaVersion: number;
  orsApiKey: string;
  routingProvider?: "hosted" | "local";
  lookupAddresses?: boolean;
  overpassUrl: string;
  stations: StationRecord[];
  selectedOriginStationId: string | null;
  selectedDestinationStationId: string | null;
  generation: {
    tripCount: number;
    seed?: number;
    pairingMode: PairingMode;
    routingMode?: RoutingMode;
    maxAccessDistanceM?: number;
    maxCyclingDistanceM?: number;
    maxTransfers?: number;
  };
  randomPointDefaults: {
    count: number;
  };
  ui: {
    activeStationId: string | null;
    selectedPointId: string | null;
    mapCenter: {
      lat: number;
      lon: number;
    };
    mapZoom: number;
  };
}

export interface LatLon {
  lat: number;
  lon: number;
}

export type LonLat = [number, number, number?];

export interface PairingResult {
  pairs: Array<{
    origin: WalkPoint;
    destination: WalkPoint;
    pairKey: string;
  }>;
  uniquePairsUsed: number;
  maxPairReuse: number;
}

export interface GeneratedTrip {
  id: string;
  pairKey: string;
  fileName: string;
  gpx: string;
  routeMode: TripRouteMode;
  originPoint: WalkPoint;
  destinationPoint: WalkPoint;
  walkInCoords: LonLat[];
  metroCoords: LonLat[];
  transitJourney?: TransitJourney;
  walkOutCoords: LonLat[];
  drivingCoords: LonLat[];
  cyclingCoords?: LonLat[];
  accessMode?: "cycling";
}

export interface GenerationFailure {
  code: string;
  message: string;
}

export interface GenerationReport {
  requestedTrips: number;
  generatedTrips: number;
  failedTrips: number;
  failures: GenerationFailure[];
  pairingStats: {
    uniquePairsUsed: number;
    maxPairReuse: number;
  };
  reuseStats: {
    metroPath: boolean;
    walkingLegs: number;
    walkingLegRequests: number;
  };
  serviceStats: {
    overpassFallback: boolean;
    transitNetwork?: boolean;
  };
}

export interface GenerationResult {
  trips: GeneratedTrip[];
  report: GenerationReport;
}

export interface StationCandidate {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

export interface OverpassNodeElement {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OverpassWayElement {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: Array<OverpassNodeElement | OverpassWayElement>;
}
