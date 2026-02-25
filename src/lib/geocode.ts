import type { LatLon } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const CACHE_DECIMALS = 5;
const MAX_CONCURRENCY = 1;
const MIN_REQUEST_GAP_MS = 300;

const cache = new Map<string, string>();
const queue: Array<() => void> = [];
let active = 0;
let lastRequestStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(point: LatLon): string {
  return `${point.lat.toFixed(CACHE_DECIMALS)},${point.lon.toFixed(CACHE_DECIMALS)}`;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      active += 1;
      try {
        const value = await task();
        resolve(value);
      } catch (error) {
        reject(error);
      } finally {
        active -= 1;
        const next = queue.shift();
        if (next) {
          next();
        }
      }
    };

    if (active < MAX_CONCURRENCY) {
      void run();
    } else {
      queue.push(() => {
        void run();
      });
    }
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

export async function reverseGeocodeLabel(point: LatLon): Promise<string> {
  const key = cacheKey(point);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const label = await enqueue(async () => {
    const elapsed = Date.now() - lastRequestStartedAt;
    if (elapsed < MIN_REQUEST_GAP_MS) {
      await sleep(MIN_REQUEST_GAP_MS - elapsed);
    }
    lastRequestStartedAt = Date.now();

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
  });

  cache.set(key, label);
  return label;
}
