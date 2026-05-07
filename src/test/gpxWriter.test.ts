import { describe, expect, it } from "vitest";
import { buildTripGpx } from "../lib/gpxWriter";

describe("buildTripGpx", () => {
  it("creates parseable GPX with three track segments and elevation tags", () => {
    const gpx = buildTripGpx({
      id: "t1",
      name: "Trip 1",
      originStationName: "Origin",
      destinationStationName: "Destination",
      walkIn: [
        [13.4, 52.5, 41.1],
        [13.41, 52.51, 42.2]
      ],
      metro: [
        [13.42, 52.52, 43.3],
        [13.43, 52.53, 44.4]
      ],
      walkOut: [
        [13.44, 52.54, 45.5],
        [13.45, 52.55, 46.6]
      ]
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(gpx, "application/xml");
    const segments = doc.getElementsByTagName("trkseg");
    const elevations = doc.getElementsByTagName("ele");

    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
    expect(segments.length).toBe(3);
    expect(elevations.length).toBe(6);
  });

  it("omits elevation tags for 2D coordinates", () => {
    const gpx = buildTripGpx({
      id: "t2",
      name: "Trip 2",
      originStationName: "Origin",
      destinationStationName: "Destination",
      walkIn: [[13.4, 52.5]],
      metro: [],
      walkOut: [[13.45, 52.55]]
    });

    expect(gpx).not.toContain("<ele>");
  });

  it("creates one track segment for direct driving trips", () => {
    const gpx = buildTripGpx({
      id: "t3",
      name: "Driving Trip",
      originStationName: "Origin",
      destinationStationName: "Destination",
      walkIn: [],
      metro: [],
      walkOut: [],
      driving: [
        [13.4, 52.5, 41.1],
        [13.45, 52.55, 44.2]
      ]
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(gpx, "application/xml");

    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
    expect(doc.getElementsByTagName("trkseg").length).toBe(1);
    expect(doc.getElementsByTagName("trkpt").length).toBe(2);
  });
});
