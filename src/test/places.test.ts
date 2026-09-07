import { describe, expect, it } from "vitest";
import { haversineDistanceM } from "../lib/geo";
import { createPlace, movePlace } from "../lib/places";
import { DEFAULT_STATION_RADIUS_M } from "../lib/stationRadius";
import type { PlaceRecord } from "../lib/types";

function area(): PlaceRecord {
  return {
    id: "saved-area", name: "Home", kind: "area", lat: 48.85, lon: 2.35, radiusM: 700,
    walkPoints: [
      { id: "one", lat: 48.852, lon: 2.353, tripMode: "driving", label: "Old address",
        address: { displayName: "Old address" }, addressStatus: "resolved" },
      { id: "two", lat: 48.849, lon: 2.348, tripMode: "metro" }
    ]
  };
}

describe("places", () => {
  it("creates an empty area or exactly one resolving transit point with unique IDs", () => {
    const position = { lat: 48.85, lon: 2.35 };
    const region = createPlace(position, "Home", "area");
    const single = createPlace(position, "Office", "point");
    expect(region).toMatchObject({ ...position, name: "Home", kind: "area", radiusM: DEFAULT_STATION_RADIUS_M, walkPoints: [] });
    expect(single).toMatchObject({ ...position, name: "Office", kind: "point" });
    expect(single.walkPoints).toHaveLength(1);
    expect(single.walkPoints[0]).toMatchObject({ ...position, label: "Resolving address...", addressStatus: "resolving", tripMode: "metro" });
    expect(new Set([region.id, single.id, single.walkPoints[0].id]).size).toBe(3);
  });

  it("moves every area point without mutating saved data, retaining IDs and modes", () => {
    const original = area();
    const snapshot = structuredClone(original);
    const moved = movePlace(original, { lat: 55, lon: 10 });
    expect(original).toEqual(snapshot);
    expect(moved).toMatchObject({ id: original.id, name: original.name, kind: "area", radiusM: 700, lat: 55, lon: 10 });
    expect(moved.walkPoints).toHaveLength(2);
    moved.walkPoints.forEach((point, index) => {
      expect(point).toMatchObject({ id: original.walkPoints[index].id, tripMode: original.walkPoints[index].tripMode,
        label: "Resolving address...", addressStatus: "resolving" });
      expect(point.address).toBeUndefined();
      expect(point).not.toBe(original.walkPoints[index]);
      expect(Math.abs(haversineDistanceM(moved, point) - haversineDistanceM(original, original.walkPoints[index]))).toBeLessThan(0.02);
    });
  });

  it("preserves exact coordinates when moving an area to its current position", () => {
    const original = area();
    const moved = movePlace(original, original);
    expect(moved.walkPoints.map(({ lat, lon }) => ({ lat, lon })))
      .toEqual(original.walkPoints.map(({ lat, lon }) => ({ lat, lon })));
  });

  it("keeps a single place and its sole point together", () => {
    const original = createPlace({ lat: 40, lon: 2 }, "Single", "point");
    original.walkPoints[0].tripMode = "driving";
    const moved = movePlace(original, { lat: 50, lon: 12 });
    expect(moved.walkPoints).toHaveLength(1);
    expect(moved.walkPoints[0]).toMatchObject({ id: original.walkPoints[0].id, lat: 50, lon: 12, tripMode: "driving" });
    expect(moved).toMatchObject({ lat: 50, lon: 12 });
    expect(original).toMatchObject({ lat: 40, lon: 2 });
  });

  it("translates across the date line using the short local offset", () => {
    const original: PlaceRecord = { ...area(), lat: 0, lon: 179.999,
      walkPoints: [{ id: "across", lat: 0.001, lon: -179.999 }] };
    const moved = movePlace(original, { lat: 0, lon: -179.999 });
    expect(moved.walkPoints[0].lon).toBeCloseTo(-179.997, 9);
    expect(haversineDistanceM(moved, moved.walkPoints[0])).toBeCloseTo(haversineDistanceM(original, original.walkPoints[0]), 5);
  });

  it("bounds polar coordinates and wraps longitudes", () => {
    const moved = movePlace(area(), { lat: 95, lon: 541 });
    expect(moved.lat).toBeLessThan(90);
    expect(moved.lon).toBe(-179);
    for (const point of moved.walkPoints) {
      expect(Number.isFinite(point.lon)).toBe(true);
      expect(Math.abs(point.lat)).toBeLessThan(90);
      expect(point.lon).toBeGreaterThanOrEqual(-180);
      expect(point.lon).toBeLessThan(180);
    }
  });
});
