import { describe, expect, it } from "vitest";
import { buildTripGpx } from "../lib/gpxWriter";

import { transitJourneyFixture } from "./transitJourneyFixture";

const ODC_NS = "https://www.maximspur.com/origin-destination-creator/gpx/1";

const originStation = {
  id: "origin",
  name: "Origin",
  lat: 52.5,
  lon: 13.4,
  radiusM: 500
};

const destinationStation = {
  id: "destination",
  name: "Destination",
  lat: 52.51,
  lon: 13.45,
  radiusM: 650
};

const originPoint = {
  id: "o1",
  lat: 52.499,
  lon: 13.398,
  label: "Origin Road 1, Mitte",
  addressStatus: "resolved" as const,
  tripMode: "metro" as const,
  address: {
    displayName: "Origin Road 1, Mitte, Berlin, Germany",
    components: {
      road: "Origin Road",
      house_number: "1",
      city: "Berlin",
      country: "Germany"
    }
  }
};

const destinationPoint = {
  id: "d1",
  lat: 52.512,
  lon: 13.452,
  label: "Destination Road 2, Kreuzberg",
  addressStatus: "resolved" as const,
  tripMode: "driving" as const,
  address: {
    displayName: "Destination Road 2, Kreuzberg, Berlin, Germany",
    components: {
      road: "Destination Road",
      house_number: "2",
      city: "Berlin",
      country: "Germany"
    }
  }
};

function parseGpx(gpx: string): XMLDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpx, "application/xml");
  expect(doc.getElementsByTagName("parsererror").length).toBe(0);
  return doc;
}

describe("buildTripGpx", () => {
  it("exports ordered transit and transfer tracks with line identity and geometry provenance", () => {
    const journey = transitJourneyFixture();
    const doc = parseGpx(buildTripGpx({
      id: "transfer-trip", name: "Transit trip", routeMode: "metro",
      originStation, destinationStation, originPoint, destinationPoint,
      walkIn: [[2.401, 48.901], [2.4, 48.9]], metro: [[99, 99]],
      walkOut: [[2.58, 48.84], [2.581, 48.841]], transitJourney: journey
    }));
    const trip = doc.getElementsByTagNameNS(ODC_NS, "trip")[0];
    const segments = Array.from(doc.getElementsByTagNameNS(ODC_NS, "segment"));
    const refs = Array.from(doc.getElementsByTagNameNS(ODC_NS, "segmentRef"));
    expect(trip.getAttribute("schemaVersion")).toBe("2");
    expect(trip.getAttribute("networkVersion")).toBe("fixture-1");
    expect(trip.getAttribute("transferCount")).toBe("1");
    expect(segments.map((segment) => segment.getAttribute("role"))).toEqual([
      "walk-in", "transit", "transfer", "transit", "walk-out"
    ]);
    expect(Array.from(doc.getElementsByTagName("type")).map((node) => node.textContent))
      .toEqual(["walking", "metro", "walking", "rer", "walking"]);
    expect(doc.getElementsByTagName("trkpt")).toHaveLength(10);
    expect(doc.querySelector('trkpt[lat="99.0000000"]')).toBeNull();
    expect(segments[1].getAttribute("lineId")).toBe('line-"5');
    expect(segments[1].getAttribute("lineName")).toBe("5 <&>");
    expect(segments[1].getAttribute("boardingStopId")).toBe("stop-origin");
    expect(segments[1].getAttribute("alightingStopId")).toBe("stop-change-1");
    expect(segments[2].getAttribute("geometrySource")).toBe("station-connector");
    expect(segments[2].getAttribute("lineId")).toBeNull();
    expect(segments[0].getElementsByTagNameNS(ODC_NS, "to")[0].getAttribute("ref")).toBe("stop-origin");
    for (let i = 0; i < segments.length; i += 1) {
      for (const attribute of ["role", "mode", "distanceM", "pointCount", "geometrySource", "lineId"]) {
        expect(refs[i].getAttribute(attribute)).toBe(segments[i].getAttribute(attribute));
      }
    }
    expect(doc.getElementsByTagNameNS(ODC_NS, "source")[0].getAttribute("geometryLicense")).toBe("ODbL");
    expect(doc.getElementsByTagNameNS(ODC_NS, "source")[0].getAttribute("licenseUrl")).toBe("https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm");
    expect(doc.getElementsByTagNameNS(ODC_NS, "source")[0].getAttribute("geometryLicenseUrl")).toBe("https://opendatacommons.org/licenses/odbl/1-0/");
    expect(doc.getElementsByTagName("desc")[3].textContent).toContain("Approximate station connector");
  });

  it("creates parseable metro GPX with one labeled track per transport leg", () => {
    const gpx = buildTripGpx({
      id: "t1",
      name: "Trip 1",
      routeMode: "metro",
      originStation,
      destinationStation,
      originPoint,
      destinationPoint,
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

    const doc = parseGpx(gpx);
    const tracks = Array.from(doc.getElementsByTagName("trk"));
    const segments = Array.from(doc.getElementsByTagName("trkseg"));
    const trackTypes = tracks.map((track) => track.getElementsByTagName("type")[0]?.textContent);
    const odcSegments = Array.from(doc.getElementsByTagNameNS(ODC_NS, "segment"));
    const odcSegmentRefs = Array.from(doc.getElementsByTagNameNS(ODC_NS, "segmentRef"));
    const trip = doc.getElementsByTagNameNS(ODC_NS, "trip")[0];

    expect(tracks).toHaveLength(3);
    expect(segments).toHaveLength(3);
    expect(trackTypes).toEqual(["walking", "metro", "walking"]);
    expect(doc.getElementsByTagName("ele")).toHaveLength(6);
    expect(trip?.getAttribute("schemaVersion")).toBe("1");
    expect(trip?.getAttribute("routeMode")).toBe("metro");
    expect(trip?.getAttribute("segmentCount")).toBe("3");
    expect(odcSegments.map((segment) => segment.getAttribute("role"))).toEqual([
      "walk-in",
      "metro",
      "walk-out"
    ]);
    expect(odcSegments.map((segment) => segment.getAttribute("mode"))).toEqual([
      "walking",
      "metro",
      "walking"
    ]);
    expect(odcSegmentRefs.map((segment) => segment.getAttribute("role"))).toEqual([
      "walk-in",
      "metro",
      "walk-out"
    ]);
  });

  it("stores origin and destination point labels and structured address components", () => {
    const gpx = buildTripGpx({
      id: "t2",
      name: "Trip 2",
      routeMode: "metro",
      originStation,
      destinationStation,
      originPoint,
      destinationPoint,
      walkIn: [[13.4, 52.5]],
      metro: [[13.42, 52.52]],
      walkOut: [[13.45, 52.55]]
    });

    const doc = parseGpx(gpx);
    const points = Array.from(doc.getElementsByTagNameNS(ODC_NS, "point"));
    const components = Array.from(doc.getElementsByTagNameNS(ODC_NS, "component"));

    expect(points[0]?.getAttribute("id")).toBe("o1");
    expect(points[0]?.getAttribute("tripMode")).toBe("metro");
    expect(points[1]?.getAttribute("id")).toBe("d1");
    expect(points[1]?.getAttribute("tripMode")).toBe("driving");
    expect(Array.from(doc.getElementsByTagNameNS(ODC_NS, "label")).map((item) => item.textContent)).toEqual([
      "Origin Road 1, Mitte",
      "Destination Road 2, Kreuzberg"
    ]);
    expect(components.some((component) => component.getAttribute("key") === "road" && component.textContent === "Origin Road")).toBe(true);
    expect(components.some((component) => component.getAttribute("key") === "country" && component.textContent === "Germany")).toBe(true);
  });

  it("omits elevation tags for 2D coordinates", () => {
    const gpx = buildTripGpx({
      id: "t3",
      name: "Trip 3",
      routeMode: "metro",
      originStation,
      destinationStation,
      originPoint,
      destinationPoint,
      walkIn: [[13.4, 52.5]],
      metro: [],
      walkOut: [[13.45, 52.55]]
    });

    expect(gpx).not.toContain("<ele>");
  });

  it("creates one labeled track segment for direct driving trips", () => {
    const gpx = buildTripGpx({
      id: "t4",
      name: "Driving Trip",
      routeMode: "driving",
      originStation,
      destinationStation,
      originPoint: { ...originPoint, tripMode: "driving" },
      destinationPoint,
      walkIn: [],
      metro: [],
      walkOut: [],
      driving: [
        [13.4, 52.5, 41.1],
        [13.45, 52.55, 44.2]
      ]
    });

    const doc = parseGpx(gpx);
    const trip = doc.getElementsByTagNameNS(ODC_NS, "trip")[0];
    const segment = doc.getElementsByTagNameNS(ODC_NS, "segment")[0];

    expect(doc.getElementsByTagName("trk")).toHaveLength(1);
    expect(doc.getElementsByTagName("trkseg")).toHaveLength(1);
    expect(doc.getElementsByTagName("trkpt")).toHaveLength(2);
    expect(doc.getElementsByTagName("type")[0]?.textContent).toBe("driving");
    expect(trip?.getAttribute("routeMode")).toBe("driving");
    expect(trip?.getAttribute("segmentCount")).toBe("1");
    expect(segment?.getAttribute("role")).toBe("driving");
    expect(segment?.getAttribute("mode")).toBe("driving");
  });
});
