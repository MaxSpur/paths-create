import { toRad } from "./geo";
import { newId } from "./ids";
import { DEFAULT_STATION_RADIUS_M } from "./stationRadius";
import type { LatLon, PlaceRecord, WalkPoint } from "./types";

// Keep longitude scaling finite at the poles.
const MAX_LATITUDE = 89.999999;

function wrapLongitude(lon: number): number {
  return lon >= -180 && lon < 180 ? lon : ((lon + 180) % 360 + 360) % 360 - 180;
}

function normalizePosition(point: LatLon): LatLon {
  return {
    lat: Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat)),
    lon: wrapLongitude(point.lon)
  };
}

function relocatePoint(point: WalkPoint, target: LatLon): WalkPoint {
  return {
    ...point,
    ...target,
    label: "Resolving address...",
    address: undefined,
    addressStatus: "resolving"
  };
}

export function createPlace(point: LatLon, name: string, kind: "area" | "point"): PlaceRecord {
  const position = normalizePosition(point);
  return {
    id: newId("place"),
    name,
    kind,
    ...position,
    radiusM: DEFAULT_STATION_RADIUS_M,
    walkPoints: kind === "point"
      ? [relocatePoint({ id: newId("pt"), ...position, tripMode: "metro" }, position)]
      : []
  };
}

export function movePlace(place: PlaceRecord, target: LatLon): PlaceRecord {
  const position = normalizePosition(target);
  const unchanged = position.lat === place.lat && position.lon === place.lon;
  const longitudeScale = Math.cos(toRad(place.lat)) / Math.cos(toRad(position.lat));
  return {
    ...place,
    ...position,
    walkPoints: place.walkPoints.map((point) => {
      const moved = place.kind === "point" ? position : unchanged ? point : normalizePosition({
        lat: position.lat + (point.lat - place.lat),
        lon: position.lon + wrapLongitude(point.lon - place.lon) * longitudeScale
      });
      return relocatePoint(point, { lat: moved.lat, lon: moved.lon });
    })
  };
}
