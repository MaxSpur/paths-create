import type { LatLon, StructuredAddress } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const CACHE_DECIMALS = 5;
const MAX_CONCURRENCY = 1;
const MIN_REQUEST_GAP_MS = 2000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 32;

const cache = new Map<string, ReverseGeocodeResult>();
const searchCache = new Map<string, { expiresAt: number; results: LocationSearchResult[] }>();

type QueuePriority = "interactive" | "background";

type QueueEntry<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  hooks?: ReverseGeocodeHooks;
  priority: QueuePriority;
};

const queue: Array<QueueEntry<any>> = [];
let active = 0;
let lastRequestStartedAt = 0;

export interface ReverseGeocodeHooks {
  signal?: AbortSignal;
  onQueued?: (info: { queuePosition: number; estimatedWaitMs: number }) => void;
  onStarted?: () => void;
}

export interface LocationSearchResult {
  label: string;
  lat: number;
  lon: number;
  boundingBox?: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
}

export interface LocationSearchBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface LocationSearchOptions {
  limit?: number;
  viewBox?: LocationSearchBounds;
}

export interface ReverseGeocodeResult {
  label: string;
  address?: StructuredAddress;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(point: LatLon): string {
  return `${point.lat.toFixed(CACHE_DECIMALS)},${point.lon.toFixed(CACHE_DECIMALS)}`;
}

function estimateWaitMs(queuePosition: number): number {
  const now = Date.now();
  const gapRemaining = Math.max(0, MIN_REQUEST_GAP_MS - (now - lastRequestStartedAt));
  if (queuePosition <= 0) {
    return gapRemaining;
  }
  return gapRemaining + queuePosition * MIN_REQUEST_GAP_MS;
}

async function processQueue(): Promise<void> {
  if (active >= MAX_CONCURRENCY || queue.length === 0) {
    return;
  }

  const entry = queue.shift();
  if (!entry) {
    return;
  }

  active += 1;
  try {
    const elapsed = Date.now() - lastRequestStartedAt;
    if (elapsed < MIN_REQUEST_GAP_MS) {
      await sleep(MIN_REQUEST_GAP_MS - elapsed);
    }

    entry.hooks?.signal?.throwIfAborted();
    lastRequestStartedAt = Date.now();
    entry.hooks?.onStarted?.();

    const value = await entry.task();
    entry.resolve(value);
  } catch (error) {
    entry.reject(error);
  } finally {
    active -= 1;
    if (queue.length > 0) {
      void processQueue();
    }
  }
}

function enqueue<T>(
  task: () => Promise<T>,
  hooks?: ReverseGeocodeHooks,
  priority: QueuePriority = "background"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = hooks?.signal;
    signal?.throwIfAborted();
    const entry: QueueEntry<T> = {
      task, hooks, priority,
      resolve: (value) => { signal?.removeEventListener("abort", cancel); resolve(value); },
      reject: (error) => { signal?.removeEventListener("abort", cancel); reject(error); }
    };
    const cancel = () => {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      entry.reject(signal?.reason);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const insertionIndex = priority === "interactive"
      ? queue.findIndex((entry) => entry.priority === "background")
      : -1;
    const queueIndex = insertionIndex >= 0 ? insertionIndex : queue.length;
    const queuePosition = active + queueIndex;
    const estimatedWait = estimateWaitMs(queuePosition);
    if (estimatedWait > 0 || queuePosition > 0) {
      hooks?.onQueued?.({ queuePosition, estimatedWaitMs: estimatedWait });
    }

    queue.splice(queueIndex, 0, entry);
    void processQueue();
  });
}

function locationSearchCacheKey(
  query: string,
  limit: number,
  viewBox?: LocationSearchBounds
): string {
  const boundsKey = viewBox
    ? [viewBox.south, viewBox.west, viewBox.north, viewBox.east]
        .map((value) => value.toFixed(2))
        .join(",")
    : "global";
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ");
  return `${normalizedQuery}|${limit}|${boundsKey}`;
}

function getCachedLocationSearch(key: string): LocationSearchResult[] | null {
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }

  searchCache.delete(key);
  searchCache.set(key, cached);
  return cached.results;
}

function cacheLocationSearch(key: string, results: LocationSearchResult[]): void {
  searchCache.set(key, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    results
  });
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    searchCache.delete(oldestKey);
  }
}

function formatAddress(payload: {
  display_name?: string;
  address?: Record<string, string>;
}): string | null {
  const address = payload.address ?? {};

  const streetBase = [address.road, address.pedestrian, address.footway, address.path]
    .find(Boolean)
    ?.trim();
  const houseNumber = address.house_number?.trim();
  const street = streetBase ? [streetBase, houseNumber].filter(Boolean).join(" ") : undefined;

  const locality = [
    address.neighbourhood,
    address.suburb,
    address.city_district,
    address.city,
    address.town,
    address.village,
    address.municipality
  ]
    .find(Boolean)
    ?.trim();

  const parts = [street, locality].filter((part): part is string => Boolean(part && part.length > 0));
  if (parts.length > 0) {
    return parts.join(", ");
  }

  if (typeof payload.display_name === "string" && payload.display_name.trim()) {
    return payload.display_name
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");
  }

  return null;
}

function normalizeAddressComponents(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const components = Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, component]) => [key, component.trim()])
  );

  return Object.keys(components).length > 0 ? components : undefined;
}

function structuredAddressFromPayload(payload: {
  display_name?: unknown;
  address?: unknown;
}): StructuredAddress | undefined {
  const displayName = typeof payload.display_name === "string" && payload.display_name.trim()
    ? payload.display_name.trim()
    : undefined;
  const components = normalizeAddressComponents(payload.address);

  if (!displayName && !components) {
    return undefined;
  }

  return { displayName, components };
}

function parseCoordinate(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoundingBox(value: unknown): LocationSearchResult["boundingBox"] {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }

  const south = parseCoordinate(value[0]);
  const north = parseCoordinate(value[1]);
  const west = parseCoordinate(value[2]);
  const east = parseCoordinate(value[3]);
  if (south === null || north === null || west === null || east === null) {
    return undefined;
  }

  return { south, west, north, east };
}

export async function searchLocations(
  query: string,
  options: LocationSearchOptions | number = {}
): Promise<LocationSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const normalizedOptions = typeof options === "number" ? { limit: options } : options;
  const limit = normalizedOptions.limit ?? 5;
  const boundedLimit = Math.max(1, Math.min(10, Math.round(limit)));
  const searchKey = locationSearchCacheKey(trimmedQuery, boundedLimit, normalizedOptions.viewBox);
  const cachedResults = getCachedLocationSearch(searchKey);
  if (cachedResults) {
    return cachedResults;
  }

  const results = await enqueue(async () => {
    const params = new URLSearchParams({
      format: "jsonv2",
      q: trimmedQuery,
      limit: String(boundedLimit),
      addressdetails: "1"
    });

    if (normalizedOptions.viewBox) {
      const { west, south, east, north } = normalizedOptions.viewBox;
      params.set("viewbox", [west, south, east, north].join(","));
    }

    const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Location search failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .map((item): LocationSearchResult | null => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as {
          display_name?: unknown;
          lat?: unknown;
          lon?: unknown;
          boundingbox?: unknown;
        };
        const lat = parseCoordinate(record.lat);
        const lon = parseCoordinate(record.lon);
        if (lat === null || lon === null) {
          return null;
        }

        return {
          label:
            typeof record.display_name === "string" && record.display_name.trim()
              ? record.display_name.trim()
              : `${lat.toFixed(CACHE_DECIMALS)}, ${lon.toFixed(CACHE_DECIMALS)}`,
          lat,
          lon,
          boundingBox: parseBoundingBox(record.boundingbox)
        };
      })
      .filter((result): result is LocationSearchResult => result !== null);
  }, undefined, "interactive");

  cacheLocationSearch(searchKey, results);
  return results;
}

export async function reverseGeocode(point: LatLon, hooks?: ReverseGeocodeHooks): Promise<ReverseGeocodeResult> {
  hooks?.signal?.throwIfAborted();
  const key = cacheKey(point);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const result = await enqueue(async () => {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(point.lat),
      lon: String(point.lon),
      zoom: "18",
      addressdetails: "1"
    });

    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      signal: hooks?.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoding failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      display_name?: unknown;
      address?: unknown;
    };
    const formattedLabel =
      formatAddress({
        display_name: typeof payload.display_name === "string" ? payload.display_name : undefined,
        address: normalizeAddressComponents(payload.address)
      }) ??
      `${point.lat.toFixed(CACHE_DECIMALS)}, ${point.lon.toFixed(CACHE_DECIMALS)}`;

    return {
      label: formattedLabel,
      address: structuredAddressFromPayload(payload)
    };
  }, hooks);

  cache.set(key, result);
  return result;
}

export async function reverseGeocodeLabel(point: LatLon, hooks?: ReverseGeocodeHooks): Promise<string> {
  const result = await reverseGeocode(point, hooks);
  return result.label;
}
