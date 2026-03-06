import { describe, expect, it } from "vitest";

import type { LatLon, StationRecord } from "../lib/types";
import {
  findNearestStationWithinRadius,
  resolveMapClickAction
} from "../ui/interaction";

function station(overrides: Partial<StationRecord> & Pick<StationRecord, "id" | "lat" | "lon">): StationRecord {
  return {
    id: overrides.id,
    name: overrides.id,
    lat: overrides.lat,
    lon: overrides.lon,
    radiusM: overrides.radiusM ?? 500,
    walkPoints: overrides.walkPoints ?? []
  };
}

const activePoint: LatLon = { lat: 52.52, lon: 13.4053 };
const farAwayPoint: LatLon = { lat: 52.53, lon: 13.42 };

describe("interaction", () => {
  it("prefers the nearest station whose radius contains the click", () => {
    const match = findNearestStationWithinRadius(
      [
        station({ id: "a", lat: 52.52, lon: 13.405, radiusM: 700 }),
        station({ id: "b", lat: 52.5201, lon: 13.40525, radiusM: 700 })
      ],
      activePoint
    );

    expect(match?.id).toBe("b");
  });

  it("moves the selected point when add-point mode clicks stay inside the active station radius", () => {
    const result = resolveMapClickAction({
      mode: "add_point",
      point: activePoint,
      stations: [
        station({
          id: "a",
          lat: 52.52,
          lon: 13.405,
          walkPoints: [{ id: "pt-1", lat: 52.5202, lon: 13.4051 }]
        })
      ],
      activeStationId: "a",
      selectedPointId: "pt-1"
    });

    expect(result).toEqual({
      type: "move_point",
      stationId: "a",
      pointId: "pt-1"
    });
  });

  it("adds a point when add-point mode clicks inside the active station radius without a selected point", () => {
    const result = resolveMapClickAction({
      mode: "add_point",
      point: activePoint,
      stations: [station({ id: "a", lat: 52.52, lon: 13.405 })],
      activeStationId: "a",
      selectedPointId: null
    });

    expect(result).toEqual({
      type: "add_point",
      stationId: "a"
    });
  });

  it("deselects the selected point before any outside-radius map action", () => {
    const result = resolveMapClickAction({
      mode: "add_point",
      point: farAwayPoint,
      stations: [
        station({
          id: "a",
          lat: 52.52,
          lon: 13.405,
          walkPoints: [{ id: "pt-1", lat: 52.5202, lon: 13.4051 }]
        })
      ],
      activeStationId: "a",
      selectedPointId: "pt-1"
    });

    expect(result).toEqual({ type: "deselect_point" });
  });

  it("activates another station when its radius is clicked", () => {
    const result = resolveMapClickAction({
      mode: "idle",
      point: { lat: 52.521, lon: 13.412 },
      stations: [
        station({ id: "a", lat: 52.52, lon: 13.405 }),
        station({ id: "b", lat: 52.521, lon: 13.412 })
      ],
      activeStationId: "a",
      selectedPointId: null
    });

    expect(result).toEqual({
      type: "activate_station",
      stationId: "b"
    });
  });

  it("adds a station only when add-station mode clicks outside all station radii", () => {
    const result = resolveMapClickAction({
      mode: "add_station",
      point: farAwayPoint,
      stations: [station({ id: "a", lat: 52.52, lon: 13.405 })],
      activeStationId: "a",
      selectedPointId: null
    });

    expect(result).toEqual({ type: "add_station" });
  });
});
