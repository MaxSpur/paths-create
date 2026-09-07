import type { AppState, StationRecord, StructuredAddress, WalkPoint } from "./types";
import { DEFAULT_OVERPASS_URL } from "./overpassClient";
import { clampStationRadiusM } from "./stationRadius";

export const STORAGE_KEY = "odc.generator.state.v1";
export const STATE_SCHEMA_VERSION = 2;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeStructuredAddress(raw: unknown): StructuredAddress | undefined {
  if (!isObject(raw)) return undefined;

  const displayName = typeof raw.displayName === "string" && raw.displayName.trim()
    ? raw.displayName.trim()
    : undefined;
  const rawComponents = isObject(raw.components) ? raw.components : {};
  const components = Object.fromEntries(
    Object.entries(rawComponents)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, value]) => [key, value.trim()])
  );

  if (!displayName && Object.keys(components).length === 0) {
    return undefined;
  }

  return {
    displayName,
    components: Object.keys(components).length > 0 ? components : undefined
  };
}

function normalizeStation(raw: unknown): StationRecord | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!isFiniteNumber(raw.lat) || !isFiniteNumber(raw.lon) || !isFiniteNumber(raw.radiusM)) return null;
  const walkPoints = Array.isArray(raw.walkPoints) ? raw.walkPoints : [];

  const normalizedPoints = walkPoints
    .filter((p): p is Record<string, unknown> => isObject(p))
    .filter((p) => typeof p.id === "string" && isFiniteNumber(p.lat) && isFiniteNumber(p.lon))
    .map((p) => {
      const normalizedStatus: WalkPoint["addressStatus"] =
        p.addressStatus === "resolving" || p.addressStatus === "resolved" || p.addressStatus === "failed"
          ? p.addressStatus
          : typeof p.label === "string" && p.label.trim() && p.label !== "Resolving address..."
            ? "resolved"
            : "resolving";
      const normalizedTripMode: WalkPoint["tripMode"] = p.tripMode === "driving" ? "driving" : "metro";

      return {
        id: p.id as string,
        lat: p.lat as number,
        lon: p.lon as number,
        label: typeof p.label === "string" ? p.label : undefined,
        address: normalizeStructuredAddress(p.address),
        addressStatus: normalizedStatus,
        tripMode: normalizedTripMode
      };
    });

  const kind = raw.kind === "point" && normalizedPoints.length <= 1 ? "point" : "area";
  if (kind === "point" && normalizedPoints.length === 0) {
    normalizedPoints.push({ id: `${raw.id}:point`, lat: raw.lat, lon: raw.lon, label: raw.name, address: undefined, addressStatus: "resolving", tripMode: "metro" });
  }
  return {
    kind,
    id: raw.id,
    name: raw.name,
    lat: kind === "point" ? normalizedPoints[0].lat : raw.lat,
    lon: kind === "point" ? normalizedPoints[0].lon : raw.lon,
    radiusM: clampStationRadiusM(raw.radiusM),
    walkPoints: normalizedPoints
  };
}

function normalizeState(raw: unknown): AppState | null {
  if (!isObject(raw)) return null;

  const state = raw as Partial<AppState>;
  const stationsRaw = Array.isArray(state.stations) ? state.stations : [];
  const stations = stationsRaw
    .map((s) => normalizeStation(s))
    .filter((s): s is StationRecord => s !== null);

  if (typeof state.orsApiKey !== "string") return null;
  if (typeof state.overpassUrl !== "string") return null;

  const selectedOriginStationId =
    typeof state.selectedOriginStationId === "string" ? state.selectedOriginStationId : null;
  const selectedDestinationStationId =
    typeof state.selectedDestinationStationId === "string" ? state.selectedDestinationStationId : null;

  const generation: Record<string, unknown> = isObject(state.generation) ? state.generation : {};
  const randomPointDefaults: Record<string, unknown> = isObject(state.randomPointDefaults)
    ? state.randomPointDefaults
    : {};
  const ui: Record<string, unknown> = isObject(state.ui) ? state.ui : {};
  const uiMapCenter: Record<string, unknown> = isObject(ui.mapCenter) ? ui.mapCenter : {};

  const normalized: AppState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    orsApiKey: state.orsApiKey,
    overpassUrl: state.overpassUrl || DEFAULT_OVERPASS_URL,
    stations,
    selectedOriginStationId,
    selectedDestinationStationId,
    generation: {
      routingMode: generation.routingMode === "transit" || generation.routingMode === "driving" ? generation.routingMode : "point_modes",
      maxAccessDistanceM: isFiniteNumber(generation.maxAccessDistanceM) ? Math.max(100, Math.min(5000, Math.round(generation.maxAccessDistanceM))) : 1500,
      maxTransfers: isFiniteNumber(generation.maxTransfers) ? Math.max(0, Math.min(3, Math.round(generation.maxTransfers))) : 3,
      tripCount: isFiniteNumber(generation.tripCount)
        ? Math.max(1, Math.round(generation.tripCount))
        : 20,
      seed: isFiniteNumber(generation.seed) ? generation.seed : undefined,
      pairingMode:
        generation.pairingMode === "round_robin_shuffle" ? "round_robin_shuffle" : "round_robin_shuffle"
    },
    randomPointDefaults: {
      count: isFiniteNumber(randomPointDefaults.count)
        ? Math.max(1, Math.round(randomPointDefaults.count))
        : 20
    },
    ui: {
      activeStationId: typeof ui.activeStationId === "string" ? ui.activeStationId : null,
      selectedPointId: typeof ui.selectedPointId === "string" ? ui.selectedPointId : null,
      mapCenter: {
        lat: isFiniteNumber(uiMapCenter.lat) ? uiMapCenter.lat : 52.52,
        lon: isFiniteNumber(uiMapCenter.lon) ? uiMapCenter.lon : 13.405
      },
      mapZoom: isFiniteNumber(ui.mapZoom) ? ui.mapZoom : 12
    }
  };

  const stationIds = new Set(stations.map((s) => s.id));
  if (normalized.selectedOriginStationId && !stationIds.has(normalized.selectedOriginStationId)) {
    normalized.selectedOriginStationId = null;
  }
  if (normalized.selectedDestinationStationId && !stationIds.has(normalized.selectedDestinationStationId)) {
    normalized.selectedDestinationStationId = null;
  }
  if (normalized.ui.activeStationId && !stationIds.has(normalized.ui.activeStationId)) {
    normalized.ui.activeStationId = null;
  }
  if (normalized.ui.activeStationId && normalized.ui.selectedPointId) {
    const activeStation = stations.find((station) => station.id === normalized.ui.activeStationId);
    const pointExists = activeStation?.walkPoints.some((point) => point.id === normalized.ui.selectedPointId);
    if (!pointExists) {
      normalized.ui.selectedPointId = null;
    }
  } else {
    normalized.ui.selectedPointId = null;
  }

  return normalized;
}

export function createDefaultState(): AppState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    orsApiKey: "",
    overpassUrl: DEFAULT_OVERPASS_URL,
    stations: [],
    selectedOriginStationId: null,
    selectedDestinationStationId: null,
    generation: {
      routingMode: "transit",
      maxAccessDistanceM: 1500,
      maxTransfers: 3,
      tripCount: 20,
      pairingMode: "round_robin_shuffle"
    },
    randomPointDefaults: {
      count: 20
    },
    ui: {
      activeStationId: null,
      selectedPointId: null,
      mapCenter: {
        lat: 52.52,
        lon: 13.405
      },
      mapZoom: 12
    }
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    const normalized = normalizeState(parsed);
    return normalized ?? createDefaultState();
  } catch {
    return createDefaultState();
  }
}

export function persistState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export interface StateStore {
  getState: () => AppState;
  setState: (next: AppState) => void;
  update: (
    updater: (current: AppState) => AppState,
    options?: { notify?: boolean }
  ) => void;
  reset: () => void;
  subscribe: (listener: (state: AppState) => void) => () => void;
}

export function createStateStore(initialState?: AppState): StateStore {
  let state = initialState ?? loadState();
  const listeners = new Set<(state: AppState) => void>();

  const emit = (notify = true) => {
    persistState(state);
    if (notify) {
      listeners.forEach((listener) => listener(state));
    }
  };

  return {
    getState: () => state,
    setState: (next) => {
      state = normalizeState(next) ?? createDefaultState();
      emit();
    },
    update: (updater, options) => {
      const next = updater(structuredClone(state));
      state = normalizeState(next) ?? createDefaultState();
      emit(options?.notify !== false);
    },
    reset: () => {
      state = createDefaultState();
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
