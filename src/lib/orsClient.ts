import type { LatLon, LonLat } from "./types";

interface OrsGeoJsonResponse {
  features?: Array<{
    geometry?: {
      coordinates?: LonLat[];
    };
  }>;
}

export interface WalkingRouteRequest {
  id: string;
  from: LatLon;
  to: LatLon;
}

export interface WalkingRouteResult {
  id: string;
  coordinates?: LonLat[];
  error?: string;
}

export interface OrsClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const effectiveConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(values.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(effectiveConcurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export class OrsClient {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly maxRetries: number;

  private readonly retryBaseDelayMs: number;

  constructor(options: OrsClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openrouteservice.org/v2/directions";
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 350;
  }

  async getWalkingRoute(from: LatLon, to: LatLon): Promise<LonLat[]> {
    if (!this.apiKey.trim()) {
      throw new Error("Missing ORS API key.");
    }

    const url = `${this.baseUrl}/foot-walking/geojson`;
    const payload = {
      coordinates: [
        [from.lon, from.lat],
        [to.lon, to.lat]
      ]
    };

    let attempt = 0;

    while (true) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: this.apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const text = await response.text();
          if (attempt < this.maxRetries && isRetriableStatus(response.status)) {
            const delay = this.retryBaseDelayMs * 2 ** attempt + Math.random() * 200;
            attempt += 1;
            await sleep(delay);
            continue;
          }
          throw new Error(`ORS ${response.status}: ${text || response.statusText}`);
        }

        const data = (await response.json()) as OrsGeoJsonResponse;
        const coordinates = data.features?.[0]?.geometry?.coordinates;

        if (!coordinates || coordinates.length < 2) {
          throw new Error("ORS response did not include route geometry.");
        }

        return coordinates;
      } catch (error) {
        if (attempt >= this.maxRetries) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        const delay = this.retryBaseDelayMs * 2 ** attempt + Math.random() * 200;
        attempt += 1;
        await sleep(delay);
      }
    }
  }

  async getManyWalkingRoutes(
    requests: WalkingRouteRequest[],
    concurrency = 2
  ): Promise<WalkingRouteResult[]> {
    return mapConcurrent(requests, concurrency, async (request) => {
      try {
        const coordinates = await this.getWalkingRoute(request.from, request.to);
        return {
          id: request.id,
          coordinates
        };
      } catch (error) {
        return {
          id: request.id,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
  }
}
