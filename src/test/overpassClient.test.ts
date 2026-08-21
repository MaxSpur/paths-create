import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OVERPASS_FALLBACK_URL,
  DEFAULT_OVERPASS_URL,
  fetchRailWays
} from "../lib/overpassClient";

describe("overpassClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not expose an upstream HTML error body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "<html><body><h1>Gateway Timeout</h1><p>private proxy details</p></body></html>",
      { status: 504, statusText: "Gateway Timeout", headers: { "Content-Type": "text/html" } }
    ));

    let error: unknown;
    try {
      await fetchRailWays("https://overpass.test/interpreter", {
        south: 48.8,
        west: 2.3,
        north: 48.9,
        east: 2.6
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Overpass 504");
    expect((error as Error).message).toContain("temporarily overloaded");
    expect((error as Error).message).not.toContain("<html>");
    expect((error as Error).message).not.toContain("private proxy details");
  });

  it("uses one documented backup after a transient default-endpoint failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 504 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    const fallbacks: string[] = [];

    const response = await fetchRailWays(DEFAULT_OVERPASS_URL, {
      south: 48.8,
      west: 2.3,
      north: 48.9,
      east: 2.6
    }, {
      onFallback: (url) => fallbacks.push(url)
    });

    expect(response.elements).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(DEFAULT_OVERPASS_FALLBACK_URL);
    expect(fallbacks).toEqual([DEFAULT_OVERPASS_FALLBACK_URL]);
  });
});
