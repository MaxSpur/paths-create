export type PairingMode = "round_robin_shuffle";
export type PointTripMode = "metro" | "driving";
export type TripRouteMode = "metro" | "driving";

export interface WalkPoint {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  addressStatus?: "resolving" | "resolved" | "failed";
  tripMode?: PointTripMode;
}

export interface StationRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  walkPoints: WalkPoint[];
}

export interface AppState {
  schemaVersion: number;
  orsApiKey: string;
  overpassUrl: string;
  stations: StationRecord[];
  selectedOriginStationId: string | null;
  selectedDestinationStationId: string | null;
  generation: {
    tripCount: number;
    seed?: number;
    pairingMode: PairingMode;
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
  fileName: string;
  gpx: string;
  routeMode: TripRouteMode;
  originPoint: WalkPoint;
  destinationPoint: WalkPoint;
  walkInCoords: LonLat[];
  metroCoords: LonLat[];
  walkOutCoords: LonLat[];
  drivingCoords: LonLat[];
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
