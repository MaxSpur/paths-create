import type { LatLon, LonLat } from "./types";

const EARTH_RADIUS_M = 6371000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function destinationPoint(center: LatLon, bearingRad: number, distanceM: number): LatLon {
  const lat1 = toRad(center.lat);
  const lon1 = toRad(center.lon);
  const angDist = distanceM / EARTH_RADIUS_M;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAd = Math.sin(angDist);
  const cosAd = Math.cos(angDist);

  const lat2 = Math.asin(sinLat1 * cosAd + cosLat1 * sinAd * Math.cos(bearingRad));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * sinAd * cosLat1,
      cosAd - sinLat1 * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((lon2 * 180) / Math.PI + 540) % 360 - 180
  };
}

export function toLonLat(point: LatLon): LonLat {
  return [point.lon, point.lat];
}

export function toLatLon(coord: LonLat): LatLon {
  return { lon: coord[0], lat: coord[1] };
}

export function computeBbox(points: LatLon[], paddingM = 0): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  let south = Math.min(...lats);
  let north = Math.max(...lats);
  let west = Math.min(...lons);
  let east = Math.max(...lons);

  if (paddingM > 0) {
    const avgLat = (south + north) / 2;
    const latDegPerM = 1 / 111320;
    const lonDegPerM = 1 / (111320 * Math.cos(toRad(avgLat)));
    south -= paddingM * latDegPerM;
    north += paddingM * latDegPerM;
    west -= paddingM * lonDegPerM;
    east += paddingM * lonDegPerM;
  }

  return { south, west, north, east };
}
