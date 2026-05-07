import { describe, expect, it, vi } from "vitest";

import { searchLocations } from "../lib/geocode";

describe("searchLocations", () => {
  it("normalizes Nominatim search results", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            display_name: "Berlin, Germany",
            lat: "52.5173885",
            lon: "13.3951309",
            boundingbox: ["52.3382448", "52.6755087", "13.0883450", "13.7611609"]
          }
        ]),
        { status: 200 }
      )
    );

    const results = await searchLocations("Berlin", 1);
    const url = String(fetchMock.mock.calls[0]?.[0]);

    expect(url).toContain("https://nominatim.openstreetmap.org/search?");
    expect(url).toContain("q=Berlin");
    expect(results).toEqual([
      {
        label: "Berlin, Germany",
        lat: 52.5173885,
        lon: 13.3951309,
        boundingBox: {
          south: 52.3382448,
          west: 13.088345,
          north: 52.6755087,
          east: 13.7611609
        }
      }
    ]);
  });
});
