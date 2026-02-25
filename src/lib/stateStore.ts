import type { AppState, StationRecord } from "./types";

export const STORAGE_KEY = "odc.generator.state.v1";
export const STATE_SCHEMA_VERSION = 1;

const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeStation(raw: unknown): StationRecord | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!isFiniteNumber(raw.lat) || !isFiniteNumber(raw.lon) || !isFiniteNumber(raw.radiusM)) return null;
  const walkPoints = Array.isArray(raw.walkPoints) ? raw.walkPoints : [];

  const normalizedPoints = walkPoints
    .filter((p): p is Record<string, unknown> => isObject(p))
    .filter((p) => typeof p.id === "string" && isFiniteNumber(p.lat) && isFiniteNumber(p.lon))
    .map((p) => ({
      id: p.id as string,
      lat: p.lat as number,
      lon: p.lon as number,
      label: typeof p.label === "string" ? p.label : undefined
    }));

  return {
    id: raw.id,
    name: raw.name,
    lat: raw.lat,
    lon: raw.lon,
    radiusM: raw.radiusM,
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
        : 20,
      radiusM: isFiniteNumber(randomPointDefaults.radiusM)
        ? Math.max(20, randomPointDefaults.radiusM)
        : 500
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
      tripCount: 20,
      pairingMode: "round_robin_shuffle"
    },
    randomPointDefaults: {
      count: 20,
      radiusM: 500
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
  update: (updater: (current: AppState) => AppState) => void;
  reset: () => void;
  subscribe: (listener: (state: AppState) => void) => () => void;
}

export function createStateStore(initialState?: AppState): StateStore {
  let state = initialState ?? loadState();
  const listeners = new Set<(state: AppState) => void>();

  const emit = () => {
    persistState(state);
    listeners.forEach((listener) => listener(state));
  };

  return {
    getState: () => state,
    setState: (next) => {
      state = normalizeState(next) ?? createDefaultState();
      emit();
    },
    update: (updater) => {
      const next = updater(structuredClone(state));
      state = normalizeState(next) ?? createDefaultState();
      emit();
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
