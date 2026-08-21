import { describe, expect, it } from "vitest";

import { createGenerationRouteCache } from "../lib/generationRouteCache";

describe("GenerationRouteCache", () => {
  it("bounds metro entries by least-recently-used order and can be cleared", () => {
    const cache = createGenerationRouteCache();

    for (let index = 0; index < 16; index += 1) {
      cache.setMetroSetup(`metro-${index}`, { railCoordinates: [[index, index]] });
    }
    expect(cache.getMetroSetup("metro-0")).toBeDefined();

    cache.setMetroSetup("metro-16", { railCoordinates: [[16, 16]] });
    expect(cache.getMetroSetup("metro-1")).toBeUndefined();
    expect(cache.getMetroSetup("metro-0")).toBeDefined();

    cache.setWalkingLeg("walk", [[2, 1], [3, 2]]);
    cache.clear();
    expect(cache.getMetroSetup("metro-0")).toBeUndefined();
    expect(cache.getWalkingLeg("walk")).toBeUndefined();
  });
});
