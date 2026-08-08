import type { GeneratedTrip, LonLat } from "../lib/types";

export type PreviewSegmentRole = "walk-in" | "metro" | "walk-out" | "driving";

export interface PreviewSegment {
  role: PreviewSegmentRole;
  coords: LonLat[];
  highlighted: boolean;
}

function tripSegments(trip: GeneratedTrip, highlighted: boolean): PreviewSegment[] {
  if (trip.routeMode === "driving") {
    return trip.drivingCoords.length > 0
      ? [{ role: "driving", coords: trip.drivingCoords, highlighted }]
      : [];
  }

  const segments: PreviewSegment[] = [
    { role: "walk-in", coords: trip.walkInCoords, highlighted },
    { role: "metro", coords: trip.metroCoords, highlighted },
    { role: "walk-out", coords: trip.walkOutCoords, highlighted }
  ];
  return segments.filter((segment) => segment.coords.length > 0);
}

export function collectPreviewSegments(
  trips: GeneratedTrip[],
  selectedTripId: string | null
): PreviewSegment[] {
  const selectedTrip = selectedTripId
    ? trips.find((trip) => trip.id === selectedTripId)
    : undefined;
  const seenByRole: Record<PreviewSegmentRole, Set<LonLat[]>> = {
    "walk-in": new Set(),
    metro: new Set(),
    "walk-out": new Set(),
    driving: new Set()
  };
  const segments: PreviewSegment[] = [];

  for (const trip of trips) {
    if (trip === selectedTrip) continue;

    for (const segment of tripSegments(trip, false)) {
      const seen = seenByRole[segment.role];
      if (seen.has(segment.coords)) continue;
      seen.add(segment.coords);
      segments.push(segment);
    }
  }

  if (selectedTrip) {
    segments.push(...tripSegments(selectedTrip, true));
  }

  return segments;
}
