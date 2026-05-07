import type { LocationSearchBounds, LocationSearchResult } from "../lib/geocode";

export type LocationSearchBucket = "visible" | "nearby" | "elsewhere";

export interface RankedLocationSearchResult {
  result: LocationSearchResult;
  bucket: LocationSearchBucket;
  bucketLabel: string;
}

const BUCKET_LABELS: Record<LocationSearchBucket, string> = {
  visible: "Visible",
  nearby: "Nearby",
  elsewhere: "Elsewhere"
};

function normalizeBounds(bounds: LocationSearchBounds): LocationSearchBounds {
  return {
    south: Math.min(bounds.south, bounds.north),
    west: Math.min(bounds.west, bounds.east),
    north: Math.max(bounds.south, bounds.north),
    east: Math.max(bounds.west, bounds.east)
  };
}

function containsPoint(bounds: LocationSearchBounds, result: LocationSearchResult): boolean {
  const normalized = normalizeBounds(bounds);
  return (
    result.lat >= normalized.south &&
    result.lat <= normalized.north &&
    result.lon >= normalized.west &&
    result.lon <= normalized.east
  );
}

export function expandBounds(bounds: LocationSearchBounds, factor: number): LocationSearchBounds {
  const normalized = normalizeBounds(bounds);
  const safeFactor = Math.max(1, factor);
  const centerLat = (normalized.south + normalized.north) / 2;
  const centerLon = (normalized.west + normalized.east) / 2;
  const halfHeight = ((normalized.north - normalized.south) * safeFactor) / 2;
  const halfWidth = ((normalized.east - normalized.west) * safeFactor) / 2;

  return {
    south: Math.max(-90, centerLat - halfHeight),
    west: Math.max(-180, centerLon - halfWidth),
    north: Math.min(90, centerLat + halfHeight),
    east: Math.min(180, centerLon + halfWidth)
  };
}

export function rankLocationSearchResults(
  results: LocationSearchResult[],
  visibleBounds: LocationSearchBounds,
  nearbyFactor = 4
): RankedLocationSearchResult[] {
  const nearbyBounds = expandBounds(visibleBounds, nearbyFactor);
  const bucketOrder: Record<LocationSearchBucket, number> = {
    visible: 0,
    nearby: 1,
    elsewhere: 2
  };

  return results
    .map((result, index) => {
      const bucket: LocationSearchBucket = containsPoint(visibleBounds, result)
        ? "visible"
        : containsPoint(nearbyBounds, result)
          ? "nearby"
          : "elsewhere";

      return {
        index,
        ranked: {
          result,
          bucket,
          bucketLabel: BUCKET_LABELS[bucket]
        }
      };
    })
    .sort((a, b) => bucketOrder[a.ranked.bucket] - bucketOrder[b.ranked.bucket] || a.index - b.index)
    .map(({ ranked }) => ranked);
}
