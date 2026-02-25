import { describe, expect, it, vi } from "vitest";
import { OrsClient } from "../lib/orsClient";

describe("OrsClient", () => {
  it("retries on 429 and then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: {
                  coordinates: [
                    [13.4, 52.5],
                    [13.41, 52.51]
                  ]
                }
              }
            ]
          }),
          { status: 200 }
        )
      );

    const client = new OrsClient({ apiKey: "test", retryBaseDelayMs: 1, maxRetries: 2 });
    const coords = await client.getWalkingRoute({ lat: 52.5, lon: 13.4 }, { lat: 52.51, lon: 13.41 });

    expect(coords).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
