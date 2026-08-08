import { describe, expect, it } from "vitest";

import type { GeneratedTrip, LonLat } from "../lib/types";
import { collectPreviewSegments } from "../ui/previewSegments";

function metroTrip(
  id: string,
  walkInCoords: LonLat[],
  metroCoords: LonLat[],
  walkOutCoords: LonLat[]
): GeneratedTrip {
  return {
    id,
    pairKey: id,
    fileName: `${id}.gpx`,
    gpx: "<gpx />",
    routeMode: "metro",
    originPoint: { id: `${id}-origin`, lat: 0, lon: 0 },
    destinationPoint: { id: `${id}-destination`, lat: 1, lon: 1 },
    walkInCoords,
    metroCoords,
    walkOutCoords,
    drivingCoords: []
  };
}

describe("collectPreviewSegments", () => {
  it("deduplicates shared route arrays and keeps the selected trip on top", () => {
    const sharedWalkIn: LonLat[] = [[2, 48]];
    const sharedMetro: LonLat[] = [[2.1, 48.1]];
    const firstWalkOut: LonLat[] = [[2.2, 48.2]];
    const secondWalkOut: LonLat[] = [[2.3, 48.3]];
    const trips = [
      metroTrip("first", sharedWalkIn, sharedMetro, firstWalkOut),
      metroTrip("second", sharedWalkIn, sharedMetro, secondWalkOut)
    ];

    const unselected = collectPreviewSegments(trips, null);
    expect(unselected).toHaveLength(4);
    expect(unselected.every((segment) => !segment.highlighted)).toBe(true);

    const selected = collectPreviewSegments(trips, "second");
    expect(selected.slice(-3).every((segment) => segment.highlighted)).toBe(true);
    expect(selected).toHaveLength(6);
  });
});
