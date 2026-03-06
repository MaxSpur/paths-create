import { describe, expect, it, vi } from "vitest";
import { OrsClient } from "../lib/orsClient";
import type { LonLat } from "../lib/types";

describe("OrsClient", () => {
  it("requests walking elevation and retries on 429 before succeeding", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      return new Response("rate limited", { status: 429 });
    }).mockImplementationOnce(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.elevation).toBe(true);

      return new Response(
        JSON.stringify({
          features: [
            {
              geometry: {
                coordinates: [
                  [13.4, 52.5, 41.5],
                  [13.41, 52.51, 43.25]
                ]
              }
            }
          ]
        }),
        { status: 200 }
      );
    });

    const client = new OrsClient({ apiKey: "test", retryBaseDelayMs: 1, maxRetries: 2 });
    const coords = await client.getWalkingRoute({ lat: 52.5, lon: 13.4 }, { lat: 52.51, lon: 13.41 });

    expect(coords).toHaveLength(2);
    expect(coords[0]?.[2]).toBe(41.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drapes long lines in overlapping elevation chunks", async () => {
    const line: LonLat[] = Array.from({ length: 2002 }, (_, index) => [13 + index / 1000, 52 + index / 1000]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const coordinates = body.geometry.coordinates as Array<[number, number]>;

      return new Response(
        JSON.stringify({
          type: "LineString",
          coordinates: coordinates.map(([lon, lat]) => [lon, lat, Math.round((lon - 13) * 1000)])
        }),
        { status: 200 }
      );
    });

    const client = new OrsClient({ apiKey: "test" });
    const draped = await client.drapeLine(line);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstBody.geometry.coordinates).toHaveLength(2000);
    expect(secondBody.geometry.coordinates).toHaveLength(3);
    expect(draped).toHaveLength(2002);
    expect(draped[0]).toEqual([13, 52, 0]);
    expect(draped[1999]?.[2]).toBe(1999);
    expect(draped[2001]?.[2]).toBe(2001);
  });
});
