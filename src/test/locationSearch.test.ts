import { describe, expect, it } from "vitest";

import { expandBounds, rankLocationSearchResults } from "../ui/locationSearch";

const visibleBounds = {
  south: 10,
  west: 10,
  north: 11,
  east: 11
};

describe("locationSearch", () => {
  it("expands bounds around the current center", () => {
    expect(expandBounds(visibleBounds, 3)).toEqual({
      south: 9,
      west: 9,
      north: 12,
      east: 12
    });
  });

  it("ranks visible results before nearby and elsewhere results", () => {
    const ranked = rankLocationSearchResults(
      [
        { label: "Elsewhere", lat: 40, lon: 40 },
        { label: "Visible", lat: 10.5, lon: 10.5 },
        { label: "Nearby", lat: 12, lon: 12 }
      ],
      visibleBounds,
      5
    );

    expect(ranked.map((item) => `${item.bucket}:${item.result.label}`)).toEqual([
      "visible:Visible",
      "nearby:Nearby",
      "elsewhere:Elsewhere"
    ]);
  });
});
