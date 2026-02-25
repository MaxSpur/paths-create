import type { LatLon, OverpassResponse, StationCandidate } from "./types";

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
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
    const text = await response.text();
    throw new Error(`Overpass ${response.status}: ${text || response.statusText}`);
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

export async function fetchRailWays(overpassUrl: string, bbox: BBox): Promise<OverpassResponse> {
  const query = `[out:json][timeout:45];
(
  way["railway"~"subway|light_rail|rail"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
(._;>;);
out body;`;

  return runOverpassQuery(overpassUrl, query);
}
