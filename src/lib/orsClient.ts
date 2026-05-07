import type { LatLon, LonLat } from "./types";

interface GeoJsonGeometry {
  coordinates?: unknown;
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

export interface DrivingRouteRequest {
  id: string;
  from: LatLon;
  to: LatLon;
}

export interface DrivingRouteResult {
  id: string;
  alternatives?: LonLat[][];
  error?: string;
}

export interface OrsClientOptions {
  apiKey: string;
  baseUrl?: string;
  elevationBaseUrl?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

const MAX_ELEVATION_VERTICES = 2000;

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

function normalizeCoordinate(value: unknown): LonLat | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const [lon, lat, elevation] = value;
  if (typeof lon !== "number" || typeof lat !== "number") {
    return null;
  }

  if (typeof elevation === "number") {
    return [lon, lat, elevation];
  }

  return [lon, lat];
}

function normalizeCoordinateList(value: unknown): LonLat[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const coordinates: LonLat[] = [];
  for (const item of value) {
    const coordinate = normalizeCoordinate(item);
    if (!coordinate) {
      return null;
    }
    coordinates.push(coordinate);
  }

  return coordinates.length > 0 ? coordinates : null;
}

function extractCoordinates(payload: unknown): LonLat[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const features = Array.isArray(record.features) ? record.features : [];
  const feature = features[0];
  const featureGeometry =
    feature && typeof feature === "object" ? ((feature as { geometry?: GeoJsonGeometry }).geometry ?? null) : null;
  const rootGeometry = (record.geometry as GeoJsonGeometry | undefined) ?? null;

  return (
    normalizeCoordinateList(featureGeometry?.coordinates) ??
    normalizeCoordinateList(rootGeometry?.coordinates) ??
    normalizeCoordinateList(record.coordinates)
  );
}

function extractCoordinateAlternatives(payload: unknown): LonLat[][] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const features = Array.isArray(record.features) ? record.features : [];
  const alternatives = features
    .map((feature) => {
      const featureGeometry =
        feature && typeof feature === "object" ? ((feature as { geometry?: GeoJsonGeometry }).geometry ?? null) : null;
      return normalizeCoordinateList(featureGeometry?.coordinates);
    })
    .filter((coordinates): coordinates is LonLat[] => Boolean(coordinates && coordinates.length > 1));

  if (alternatives.length > 0) {
    return alternatives;
  }

  const singleRoute = extractCoordinates(payload);
  return singleRoute && singleRoute.length > 1 ? [singleRoute] : [];
}

function splitLineIntoChunks(line: LonLat[], maxVertices = MAX_ELEVATION_VERTICES): LonLat[][] {
  if (line.length <= maxVertices) {
    return [line];
  }

  const chunks: LonLat[][] = [];
  const step = Math.max(1, maxVertices - 1);

  for (let start = 0; start < line.length; start += step) {
    const chunk = line.slice(start, start + maxVertices);
    if (chunk.length < 2 && chunks.length > 0) {
      break;
    }
    chunks.push(chunk);
    if (start + maxVertices >= line.length) {
      break;
    }
  }

  return chunks;
}

export class OrsClient {
  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly elevationBaseUrl: string;

  private readonly maxRetries: number;

  private readonly retryBaseDelayMs: number;

  constructor(options: OrsClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openrouteservice.org/v2/directions";
    this.elevationBaseUrl = options.elevationBaseUrl ?? "https://api.openrouteservice.org/elevation";
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 350;
  }

  private async postJson(url: string, payload: unknown): Promise<unknown> {
    if (!this.apiKey.trim()) {
      throw new Error("Missing ORS API key.");
    }

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

        return await response.json();
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

  private async postForCoordinates(url: string, payload: unknown, emptyResponseMessage: string): Promise<LonLat[]> {
    const data = await this.postJson(url, payload);
    const coordinates = extractCoordinates(data);

    if (!coordinates || coordinates.length < 2) {
      throw new Error(emptyResponseMessage);
    }

    return coordinates;
  }

  private async postForCoordinateAlternatives(
    url: string,
    payload: unknown,
    emptyResponseMessage: string
  ): Promise<LonLat[][]> {
    const data = await this.postJson(url, payload);
    const alternatives = extractCoordinateAlternatives(data);

    if (alternatives.length === 0) {
      throw new Error(emptyResponseMessage);
    }

    return alternatives;
  }

  async getWalkingRoute(from: LatLon, to: LatLon): Promise<LonLat[]> {
    const url = `${this.baseUrl}/foot-walking/geojson`;
    return this.postForCoordinates(
      url,
      {
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat]
        ],
        elevation: true
      },
      "ORS response did not include route geometry."
    );
  }

  async getDrivingRoute(from: LatLon, to: LatLon): Promise<LonLat[]> {
    const url = `${this.baseUrl}/driving-car/geojson`;
    return this.postForCoordinates(
      url,
      {
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat]
        ],
        elevation: true
      },
      "ORS response did not include driving route geometry."
    );
  }

  async getDrivingRouteAlternatives(from: LatLon, to: LatLon): Promise<LonLat[][]> {
    const url = `${this.baseUrl}/driving-car/geojson`;
    try {
      return await this.postForCoordinateAlternatives(
        url,
        {
          coordinates: [
            [from.lon, from.lat],
            [to.lon, to.lat]
          ],
          elevation: true,
          alternative_routes: {
            target_count: 3,
            share_factor: 0.6,
            weight_factor: 2
          }
        },
        "ORS response did not include driving route geometry."
      );
    } catch {
      return [await this.getDrivingRoute(from, to)];
    }
  }

  async drapeLine(line: LonLat[]): Promise<LonLat[]> {
    if (line.length < 2) {
      return line;
    }

    const chunks = splitLineIntoChunks(line);
    const draped: LonLat[] = [];

    for (const chunk of chunks) {
      const coordinates = await this.postForCoordinates(
        `${this.elevationBaseUrl}/line`,
        {
          format_in: "geojson",
          format_out: "geojson",
          geometry: {
            type: "LineString",
            coordinates: chunk.map(([lon, lat]) => [lon, lat] as [number, number])
          }
        },
        "ORS elevation response did not include draped line geometry."
      );

      if (coordinates.length !== chunk.length) {
        throw new Error(`ORS elevation returned ${coordinates.length} points for ${chunk.length} input points.`);
      }

      if (draped.length > 0) {
        draped.push(...coordinates.slice(1));
      } else {
        draped.push(...coordinates);
      }
    }

    return draped;
  }

  async getManyWalkingRoutes(
    requests: WalkingRouteRequest[],
    concurrency = 2,
    onProgress?: (completed: number, total: number) => void
  ): Promise<WalkingRouteResult[]> {
    const total = requests.length;
    let completed = 0;

    return mapConcurrent(requests, concurrency, async (request) => {
      try {
        const coordinates = await this.getWalkingRoute(request.from, request.to);
        completed += 1;
        onProgress?.(completed, total);
        return {
          id: request.id,
          coordinates
        };
      } catch (error) {
        completed += 1;
        onProgress?.(completed, total);
        return {
          id: request.id,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
  }

  async getManyDrivingRouteAlternatives(
    requests: DrivingRouteRequest[],
    concurrency = 2,
    onProgress?: (completed: number, total: number) => void
  ): Promise<DrivingRouteResult[]> {
    const total = requests.length;
    let completed = 0;

    return mapConcurrent(requests, concurrency, async (request) => {
      try {
        const alternatives = await this.getDrivingRouteAlternatives(request.from, request.to);
        completed += 1;
        onProgress?.(completed, total);
        return {
          id: request.id,
          alternatives
        };
      } catch (error) {
        completed += 1;
        onProgress?.(completed, total);
        return {
          id: request.id,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
  }
}
