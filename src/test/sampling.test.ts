import { describe, expect, it } from "vitest";
import { haversineDistanceM } from "../lib/geo";
import { createSeededRandom, samplePointsWithinRadius } from "../lib/sampling";

describe("samplePointsWithinRadius", () => {
  it("keeps all points inside radius", () => {
    const center = { lat: 52.5, lon: 13.4 };
    const radius = 500;
    const points = samplePointsWithinRadius(center, 200, radius, createSeededRandom(123));
    for (const point of points) {
      const d = haversineDistanceM(center, { lat: point.lat, lon: point.lon });
      expect(d).toBeLessThanOrEqual(radius + 0.01);
    }
  });
});
