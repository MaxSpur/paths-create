import { describe, expect, it } from "vitest";
import { buildTripGpx } from "../lib/gpxWriter";

describe("buildTripGpx", () => {
  it("creates parseable GPX with three track segments", () => {
    const gpx = buildTripGpx({
      id: "t1",
      name: "Trip 1",
      originStationName: "Origin",
      destinationStationName: "Destination",
      walkIn: [
        [13.4, 52.5],
        [13.41, 52.51]
      ],
      metro: [
        [13.42, 52.52],
        [13.43, 52.53]
      ],
      walkOut: [
        [13.44, 52.54],
        [13.45, 52.55]
      ]
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(gpx, "application/xml");
    const segments = doc.getElementsByTagName("trkseg");

    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
    expect(segments.length).toBe(3);
  });
});
