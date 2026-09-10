import { afterEach, describe, expect, it, vi } from "vitest";

import { reverseGeocode, searchLocations } from "../lib/geocode";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  it("reuses a recent identical forward search", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([{ display_name: "Vincennes, France", lat: "48.847", lon: "2.439" }]),
        { status: 200 }
      )
    );

    const firstSearch = searchLocations("Vincennes cache test", { limit: 3 });
    await vi.runAllTimersAsync();
    const first = await firstSearch;
    const second = await searchLocations("  vincennes CACHE test ", { limit: 3 });

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("reverseGeocode", () => {
  it("cancels waiting reverse requests without cancelling forward searches in the shared queue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.resetModules();
    const { reverseGeocode, searchLocations } = await import("../lib/geocode");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    const first = new AbortController();
    const second = new AbortController();
    const outcomes = Promise.allSettled([
      reverseGeocode({ lat: 49.111, lon: 2.111 }, { signal: first.signal }),
      reverseGeocode({ lat: 49.222, lon: 2.222 }, { signal: second.signal })
    ]);
    const search = searchLocations("Cancellation test forward search");
    first.abort();
    second.abort();
    await vi.runAllTimersAsync();
    expect((await outcomes).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(await search).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/search?");
  });

  it("returns a display label with structured address details", async () => {
    vi.useFakeTimers();
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

    const resultPromise = reverseGeocode({ lat: 50.12345, lon: 8.12345 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

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
