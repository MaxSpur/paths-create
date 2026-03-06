import { haversineDistanceM } from "../lib/geo";
import type { LatLon, StationRecord } from "../lib/types";

export type EditMode = "idle" | "add_station" | "add_point";

export type MapClickAction =
  | { type: "activate_station"; stationId: string }
  | { type: "add_station" }
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
    haversineDistanceM(point, { lat: activeStation.lat, lon: activeStation.lon }) <= activeStation.radiusM;

  if (hitStation && hitStation.id !== activeStationId) {
    return { type: "activate_station", stationId: hitStation.id };
  }

  if (selectedPointId && !clickedInsideActiveStation) {
    return { type: "deselect_point" };
  }

  if (mode === "add_point" && activeStationId && clickedInsideActiveStation) {
    if (selectedPointId && activeStation?.walkPoints.some((pointItem) => pointItem.id === selectedPointId)) {
      return {
        type: "move_point",
        stationId: activeStationId,
        pointId: selectedPointId
      };
    }

    return { type: "add_point", stationId: activeStationId };
  }

  if (mode === "add_station" && !hitStation) {
    return { type: "add_station" };
  }

  return { type: "noop" };
}
