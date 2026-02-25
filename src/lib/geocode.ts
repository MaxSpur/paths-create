import type { LatLon } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const CACHE_DECIMALS = 5;
const MAX_CONCURRENCY = 1;
const MIN_REQUEST_GAP_MS = 2000;

const cache = new Map<string, string>();

type QueueEntry<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  hooks?: ReverseGeocodeHooks;
};

const queue: Array<QueueEntry<any>> = [];
let active = 0;
let lastRequestStartedAt = 0;

export interface ReverseGeocodeHooks {
  onQueued?: (info: { queuePosition: number; estimatedWaitMs: number }) => void;
  onStarted?: () => void;
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

function enqueue<T>(task: () => Promise<T>, hooks?: ReverseGeocodeHooks): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const queuePosition = active + queue.length;
    const estimatedWait = estimateWaitMs(queuePosition);
    if (estimatedWait > 0 || queuePosition > 0) {
      hooks?.onQueued?.({ queuePosition, estimatedWaitMs: estimatedWait });
    }

    queue.push({ task, resolve, reject, hooks });
    void processQueue();
  });
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

export async function reverseGeocodeLabel(point: LatLon, hooks?: ReverseGeocodeHooks): Promise<string> {
  const key = cacheKey(point);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const label = await enqueue(async () => {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(point.lat),
      lon: String(point.lon),
      zoom: "18",
      addressdetails: "1"
    });

    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoding failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };

    return (
      formatAddress(payload) ??
      `${point.lat.toFixed(CACHE_DECIMALS)}, ${point.lon.toFixed(CACHE_DECIMALS)}`
    );
  }, hooks);

  cache.set(key, label);
  return label;
}
