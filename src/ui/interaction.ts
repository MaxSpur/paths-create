import { haversineDistanceM } from "../lib/geo";
import type { LatLon, StationRecord } from "../lib/types";

export type EditMode = "idle" | "add_station" | "add_place_point" | "add_point" | "move_point" | "move_place";

export type MapClickAction =
  | { type: "activate_station"; stationId: string }
  | { type: "add_station" }
  | { type: "add_place_point" }
  | { type: "move_place"; stationId: string }
  | { type: "add_point"; stationId: string }
  | { type: "move_point"; stationId: string; pointId: string }
  | { type: "deselect_point" }
  | { type: "noop" };

export interface MapClickContext {
  mode: EditMode;
  point: LatLon;
  stations: StationRecord[];
  activeStationId: string | null;
  selectedPointId: string | null;
}

export function findNearestStationWithinRadius(
  stations: StationRecord[],
  point: LatLon
): StationRecord | null {
  let bestMatch: { station: StationRecord; distanceM: number } | null = null;

  for (const station of stations) {
    if (station.kind === "point") continue;
    const distanceM = haversineDistanceM(point, { lat: station.lat, lon: station.lon });
    if (distanceM > station.radiusM) {
      continue;
    }

    if (!bestMatch || distanceM < bestMatch.distanceM) {
      bestMatch = { station, distanceM };
    }
  }

  return bestMatch?.station ?? null;
}

export function resolveMapClickAction({
  mode,
  point,
  stations,
  activeStationId,
  selectedPointId
}: MapClickContext): MapClickAction {
  const activeStation = activeStationId ? stations.find((station) => station.id === activeStationId) ?? null : null;
  const hitStation = findNearestStationWithinRadius(stations, point);
  const clickedInsideActiveStation =
    activeStation !== null &&
    activeStation.kind !== "point" &&
    haversineDistanceM(point, { lat: activeStation.lat, lon: activeStation.lon }) <= activeStation.radiusM;

  // Creation is explicit and permits overlapping areas. Moving is a separate intent.
  if (mode === "add_station") return { type: "add_station" };
  if (mode === "add_place_point") return { type: "add_place_point" };
  if (mode === "move_place" && activeStation) return { type: "move_place", stationId: activeStation.id };
  if (mode === "move_point") {
    if (activeStation && selectedPointId && (clickedInsideActiveStation || activeStation.kind === "point") &&
      activeStation.walkPoints.some((item) => item.id === selectedPointId)) {
      return { type: "move_point", stationId: activeStation.id, pointId: selectedPointId };
    }
    return { type: "noop" };
  }
  if (mode === "add_point" && activeStationId && clickedInsideActiveStation) {
    return { type: "add_point", stationId: activeStationId };
  }
  if (hitStation && hitStation.id !== activeStationId) {
    return { type: "activate_station", stationId: hitStation.id };
  }

  if (selectedPointId && !clickedInsideActiveStation) {
    return { type: "deselect_point" };
  }

  return { type: "noop" };
}
