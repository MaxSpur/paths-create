import type { GeneratedTrip, LonLat } from "../lib/types";

export type PreviewSegmentRole = "walk-in" | "metro" | "walk-out" | "driving" | "transit" | "transfer";

export interface PreviewSegment {
  tripId: string;
  role: PreviewSegmentRole;
  coords: LonLat[];
  highlighted: boolean;
  color?: string;
  dashed?: boolean;
}

function tripSegments(trip: GeneratedTrip, highlighted: boolean): PreviewSegment[] {
  if (trip.routeMode === "driving") {
    return trip.drivingCoords.length > 0
      ? [{ tripId: trip.id, role: "driving", coords: trip.drivingCoords, highlighted }]
      : [];
  }

  const segments: PreviewSegment[] = [
    { tripId: trip.id, role: "walk-in", coords: trip.walkInCoords, highlighted, ...(trip.transitJourney ? { dashed: true } : {}) },
    ...(trip.transitJourney
      ? trip.transitJourney.legs.map((leg): PreviewSegment => ({
          tripId: trip.id, role: leg.kind, coords: leg.coordinates, highlighted,
          color: leg.line?.color, dashed: leg.kind === "transfer"
        }))
      : [{ tripId: trip.id, role: "metro" as const, coords: trip.metroCoords, highlighted }]),
    { tripId: trip.id, role: "walk-out", coords: trip.walkOutCoords, highlighted, ...(trip.transitJourney ? { dashed: true } : {}) }
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
    driving: new Set(),
    transit: new Set(),
    transfer: new Set()
  };
  const segments: PreviewSegment[] = [];

  for (const trip of trips) {
    if (trip === selectedTrip) continue;

    for (const segment of tripSegments(trip, false)) {
      const seen = seenByRole[segment.role];
      // Shared geometry selects the first trip in list order; selected overlays retain their own ID.
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
