export const MIN_STATION_RADIUS_M = 5;
export const MAX_STATION_RADIUS_M = 5000;
export const DEFAULT_STATION_RADIUS_M = 500;
export const STATION_RADIUS_SLIDER_STEPS = 120;

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function clampStationRadiusM(radiusM: number): number {
  if (!Number.isFinite(radiusM)) {
    return DEFAULT_STATION_RADIUS_M;
  }
  return Math.max(MIN_STATION_RADIUS_M, Math.min(MAX_STATION_RADIUS_M, Math.round(radiusM)));
}

export function stationRadiusSliderToMeters(sliderValue: number): number {
  const clampedValue = Math.max(0, Math.min(STATION_RADIUS_SLIDER_STEPS, Math.round(sliderValue)));
  const ratio = clampedValue / STATION_RADIUS_SLIDER_STEPS;
  const scaled =
    MIN_STATION_RADIUS_M *
    Math.exp(Math.log(MAX_STATION_RADIUS_M / MIN_STATION_RADIUS_M) * ratio);
  return clampStationRadiusM(scaled);
}

export function stationRadiusMetersToSlider(radiusM: number): number {
  const clampedRadius = clampStationRadiusM(radiusM);
  const ratio =
    Math.log(clampedRadius / MIN_STATION_RADIUS_M) /
    Math.log(MAX_STATION_RADIUS_M / MIN_STATION_RADIUS_M);
  return Math.max(0, Math.min(STATION_RADIUS_SLIDER_STEPS, Math.round(ratio * STATION_RADIUS_SLIDER_STEPS)));
}

export function formatStationRadius(radiusM: number): string {
  const clampedRadius = clampStationRadiusM(radiusM);
  if (clampedRadius < 1000) {
    return `${clampedRadius} m`;
  }

  const km = clampedRadius / 1000;
  const decimals = km >= 2 ? 1 : 2;
  return `${trimTrailingZeros(km.toFixed(decimals))} km`;
}
