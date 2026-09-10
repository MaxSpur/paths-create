import type { PointTripMode, RoutingMode, WalkPoint } from "./types";

export const POINT_MODES: readonly PointTripMode[] = ["metro", "driving", "cycling", "cycling_transit"];
export const MODE_LABELS: Record<PointTripMode, string> = { metro: "Transit", driving: "Driving", cycling: "Cycling", cycling_transit: "Cycling + transit" };
export const MODE_SHORT: Record<PointTripMode, string> = { metro: "T", driving: "D", cycling: "C", cycling_transit: "C+T" };
export function normalizePointMode(value: unknown): PointTripMode {
  return POINT_MODES.includes(value as PointTripMode) ? value as PointTripMode : "metro";
}
export function nextPointMode(value: unknown): PointTripMode {
  return POINT_MODES[(POINT_MODES.indexOf(normalizePointMode(value)) + 1) % POINT_MODES.length];
}
/** Retain the legacy explicit-mode API; the app always uses per-point modes. */
export function resolvePairMode(origin: WalkPoint, destination: WalkPoint, override?: RoutingMode): PointTripMode {
  if (override && override !== "point_modes") return override === "transit" ? "metro" : override;
  const modes = [normalizePointMode(origin.tripMode), normalizePointMode(destination.tripMode)];
  return (["driving", "cycling", "cycling_transit"] as const).find(mode => modes.includes(mode)) ?? "metro";
}
export function hasTransitPointPairs(origins: WalkPoint[], destinations: WalkPoint[]): boolean {
  const compatible = (point: WalkPoint) => ["metro", "cycling_transit"].includes(normalizePointMode(point.tripMode));
  return origins.some(compatible) && destinations.some(compatible);
}
