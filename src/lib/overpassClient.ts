import type { LatLon, OverpassResponse, StationCandidate } from "./types";

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const DEFAULT_OVERPASS_FALLBACK_URL = "https://overpass.private.coffee/api/interpreter";

export class OverpassHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "OverpassHttpError";
  }
}

function overpassErrorMessage(response: Response): string {
  if (response.status === 429) {
    return "The service is rate-limiting requests. Wait a moment and try again.";
  }
  if (response.status >= 500) {
    return "The service timed out or is temporarily overloaded. Try again.";
  }
  return response.statusText || "The request was rejected.";
}

function shouldUseDefaultFallback(error: unknown): boolean {
  return !(error instanceof OverpassHttpError)
    || error.status === 429
    || error.status >= 500;
}

function isDefaultOverpassUrl(url: string): boolean {
  return url.trim().replace(/\/$/, "") === DEFAULT_OVERPASS_URL;
}

async function runOverpassQuery(overpassUrl: string, query: string): Promise<OverpassResponse> {
  const response = await fetch(overpassUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: `data=${encodeURIComponent(query)}`
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new OverpassHttpError(
      response.status,
      `Overpass ${response.status}: ${overpassErrorMessage(response)}`
    );
  }

  return (await response.json()) as OverpassResponse;
}

function isLikelyMetro(tags: Record<string, string>): boolean {
  return (
    tags.station === "subway" ||
    tags.subway === "yes" ||
    tags.railway === "station" ||
    tags.public_transport === "station"
  );
}

export async function fetchNearbyStations(
  overpassUrl: string,
  center: LatLon,
  radiusM: number,
  limit = 50
): Promise<StationCandidate[]> {
  const query = `[out:json][timeout:25];
(
  node["railway"="station"](around:${Math.round(radiusM)},${center.lat},${center.lon});
  node["railway"="halt"](around:${Math.round(radiusM)},${center.lat},${center.lon});
  node["station"="subway"](around:${Math.round(radiusM)},${center.lat},${center.lon});
);
out body;`;

  const response = await runOverpassQuery(overpassUrl, query);

  const stations = response.elements
    .filter((el): el is Extract<typeof el, { type: "node" }> => el.type === "node")
    .map((node) => {
      const tags = node.tags ?? {};
      return {
        id: `osm_node_${node.id}`,
        name: tags.name || `Station ${node.id}`,
        lat: node.lat,
        lon: node.lon,
        tags
      } satisfies StationCandidate;
    })
    .filter((candidate) => isLikelyMetro(candidate.tags));

  return stations.slice(0, limit);
}

export async function fetchRailWays(
  overpassUrl: string,
  bbox: BBox,
  options: { onFallback?: (fallbackUrl: string) => void } = {}
): Promise<OverpassResponse> {
  const query = `[out:json][timeout:45];
(
  way["railway"~"subway|light_rail|rail"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
(._;>;);
out body;`;

  try {
    return await runOverpassQuery(overpassUrl, query);
  } catch (error) {
    if (!isDefaultOverpassUrl(overpassUrl) || !shouldUseDefaultFallback(error)) {
      throw error;
    }

    options.onFallback?.(DEFAULT_OVERPASS_FALLBACK_URL);
    try {
      return await runOverpassQuery(DEFAULT_OVERPASS_FALLBACK_URL, query);
    } catch (fallbackError) {
      const primaryMessage = error instanceof Error ? error.message : "Primary endpoint failed.";
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Backup endpoint failed.";
      throw new Error(
        `Overpass rail query failed on primary and backup endpoints. ${primaryMessage} ${fallbackMessage}`
      );
    }
  }
}
