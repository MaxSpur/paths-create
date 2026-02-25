import { destinationPoint } from "./geo";
import { newId } from "./ids";
import type { LatLon, WalkPoint } from "./types";

export type RandomFn = () => number;

export function createSeededRandom(seed?: number): RandomFn {
  if (seed === undefined) {
    return () => Math.random();
  }

  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(array: T[], random: RandomFn): T[] {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function samplePointsWithinRadius(
  center: LatLon,
  count: number,
  radiusM: number,
  random: RandomFn,
  labelPrefix = "rnd"
): WalkPoint[] {
  const points: WalkPoint[] = [];

  for (let i = 0; i < count; i += 1) {
    const bearing = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radiusM;
    const sampled = destinationPoint(center, bearing, distance);
    points.push({
      id: newId("pt"),
      lat: sampled.lat,
      lon: sampled.lon,
      label: `${labelPrefix}-${i + 1}`
    });
  }

  return points;
}
