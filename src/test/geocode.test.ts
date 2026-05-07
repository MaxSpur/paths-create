import { afterEach, describe, expect, it, vi } from "vitest";

import { reverseGeocode, searchLocations } from "../lib/geocode";

afterEach(() => {
  vi.restoreAllMocks();
});

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

    const results = await searchLocations("Berlin", {
      limit: 1,
      viewBox: {
        south: 52.4,
        west: 13.2,
        north: 52.6,
        east: 13.5
      }
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);

    expect(url).toContain("https://nominatim.openstreetmap.org/search?");
    expect(url).toContain("q=Berlin");
    expect(url).toContain("limit=1");
    expect(url).toContain("viewbox=13.2%2C52.4%2C13.5%2C52.6");
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

describe("reverseGeocode", () => {
  it("returns a display label with structured address details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          display_name: "Origin Road 1, Mitte, Berlin, Germany",
          address: {
            road: "Origin Road",
            house_number: "1",
            city: "Berlin",
            country: "Germany"
          }
        }),
        { status: 200 }
      )
    );

    const result = await reverseGeocode({ lat: 50.12345, lon: 8.12345 });

    expect(result).toEqual({
      label: "Origin Road 1, Berlin",
      address: {
        displayName: "Origin Road 1, Mitte, Berlin, Germany",
        components: {
          road: "Origin Road",
          house_number: "1",
          city: "Berlin",
          country: "Germany"
        }
      }
    });
  });
});
