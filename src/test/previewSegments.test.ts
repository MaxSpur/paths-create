import { describe, expect, it } from "vitest";

import type { GeneratedTrip, LonLat } from "../lib/types";
import { collectPreviewSegments } from "../ui/previewSegments";

import { transitJourneyFixture } from "./transitJourneyFixture";

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
  it("preserves ordered line colors and walking connectors while deduplicating shared journeys", () => {
    const transitJourney = transitJourneyFixture();
    const first = { ...metroTrip("first", [[2.4, 48.901]], [[99, 99]], [[2.581, 48.84]]), transitJourney };
    const second = { ...first, id: "second" };
    const segments = collectPreviewSegments([first, second], null);
    expect(segments.map((segment) => segment.role)).toEqual(["walk-in", "transit", "transfer", "transit", "walk-out"]);
    expect(segments[1].coords).toBe(transitJourney.legs[0].coordinates);
    expect(segments[1].color).toBe("#E18F43");
    expect(segments[3].color).toBe("EB2132");
    expect(segments.filter((segment) => segment.dashed).map((segment) => segment.role)).toEqual(["walk-in", "transfer", "walk-out"]);
    const highlighted = collectPreviewSegments([first, second], "second");
    expect(highlighted).toHaveLength(10);
    expect(highlighted.slice(-5).every((segment) => segment.highlighted)).toBe(true);
  });

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
    expect(unselected.map((segment) => segment.tripId)).toEqual(["first", "first", "first", "second"]);
    expect(unselected.every((segment) => !segment.highlighted)).toBe(true);

    const selected = collectPreviewSegments(trips, "second");
    expect(selected.slice(-3).every((segment) => segment.highlighted)).toBe(true);
    expect(selected).toHaveLength(6);
    expect(selected.slice(-3).every((segment) => segment.tripId === "second")).toBe(true);
  });
});
