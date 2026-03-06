import { describe, expect, it } from "vitest";

import {
  clampStationRadiusM,
  formatStationRadius,
  MAX_STATION_RADIUS_M,
  MIN_STATION_RADIUS_M,
  STATION_RADIUS_SLIDER_STEPS,
  stationRadiusSliderToMeters
} from "../lib/stationRadius";

describe("stationRadius", () => {
  it("clamps station radii into the supported range", () => {
    expect(clampStationRadiusM(0)).toBe(MIN_STATION_RADIUS_M);
    expect(clampStationRadiusM(12.7)).toBe(13);
    expect(clampStationRadiusM(999999)).toBe(MAX_STATION_RADIUS_M);
  });

  it("maps slider endpoints to the supported radius range", () => {
    expect(stationRadiusSliderToMeters(0)).toBe(MIN_STATION_RADIUS_M);
    expect(stationRadiusSliderToMeters(STATION_RADIUS_SLIDER_STEPS)).toBe(MAX_STATION_RADIUS_M);
  });

  it("formats metric and kilometer readouts compactly", () => {
    expect(formatStationRadius(425)).toBe("425 m");
    expect(formatStationRadius(1500)).toBe("1.5 km");
    expect(formatStationRadius(5000)).toBe("5 km");
  });
});
