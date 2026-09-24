import { createSeededRandom, type RandomFn } from "./sampling";
import { destinationPoint, haversineDistanceM } from "./geo";
import type { LatLon } from "./types";
import type { AreaGeometry, FitSettings, NetmobArea, NetmobPair, NetmobRecord } from "./netmobTypes";

export function stableSeed(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
const polygons = (g: AreaGeometry): number[][][][] => g.type === "Polygon" ? [g.coordinates] : g.coordinates;
function inRing(p: LatLon, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [a, b] = ring[j];
    if ((y > p.lat) !== (b > p.lat) && p.lon < (a - x) * (p.lat - y) / (b - y) + x) inside = !inside;
  }
  return inside;
}
export function containsPoint(g: AreaGeometry, p: LatLon): boolean {
  return polygons(g).some(poly => inRing(p, poly[0]) && !poly.slice(1).some(hole => inRing(p, hole)));
}
export function validGeometry(value: unknown): value is AreaGeometry {
  if (!value || typeof value !== "object") return false;
  const g = value as AreaGeometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return false;
  try {return polygons(g).length > 0 && polygons(g).every(poly => poly.length > 0 && poly.every(ring => ring.length >= 4 && ring.every(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)));} catch {return false;}
}
function ringArea(ring: number[][]): number {
  let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}
const prepared = new WeakMap<AreaGeometry, Array<{poly: number[][][]; area: number; box: number[]}>>();
export function sampleArea(g: AreaGeometry, random: RandomFn): LatLon {
  let parts = prepared.get(g);
  if (!parts) {
    parts = polygons(g).map(poly => {
      let x = Infinity, y = Infinity, a = -Infinity, b = -Infinity;
      for (const p of poly[0]) {x = Math.min(x,p[0]); y = Math.min(y,p[1]); a = Math.max(a,p[0]); b = Math.max(b,p[1]);}
      return {poly, area: Math.max(0, ringArea(poly[0]) - poly.slice(1).reduce((s,r) => s + ringArea(r),0)) * Math.cos((y+b)/2*Math.PI/180), box:[x,y,a,b]};
    }); prepared.set(g, parts);
  }
  const total = parts.reduce((s,p)=>s+p.area,0);
  if (!total) throw new Error("Area has no usable surface.");
  let pick = random()*total; const part = parts.find(p => (pick -= p.area) <= 0) ?? parts[parts.length-1];
  for (let i=0;i<10000;i++) {
    const [x,y,a,b]=part.box; const p={lon:x+random()*(a-x),lat:y+random()*(b-y)};
    if (containsPoint({type:"Polygon",coordinates:part.poly},p)) return p;
  }
  throw new Error("Could not sample this polygon within the bounded search.");
}
export function candidatePairs(datasetId: string, record: NetmobRecord, originArea: NetmobArea, destinationArea: NetmobArea, settings: FitSettings): NetmobPair[] {
  const random = createSeededRandom(stableSeed(`${datasetId}|${record.key}|${settings.seed}|${settings.realization}`));
  const candidates: NetmobPair[] = [];
  const count = Math.max(1,Math.min(64,Math.floor(settings.trials)));
  for(let candidate=0;candidate<count;candidate++) {
    const origin=sampleArea(originArea.geometry,random); let destination=sampleArea(destinationArea.geometry,random);
    if(record.origin===record.destination && candidate%2===0 && record.durationS) {
      const speed=record.modes.includes("MAP")?1.3:record.modes.some(m=>["VELO","VAE","TROTTINETTE"].includes(m))?4:8;
      for(let n=0;n<100;n++) {
        const near=destinationPoint(origin, random()*Math.PI*2, Math.max(10,record.durationS*speed*(0.15+random()*0.7)));
        if(containsPoint(destinationArea.geometry,near)){destination=near;break;}
      }
    }
    candidates.push({record,origin,destination,originArea,destinationArea,candidate});
  }
  const speed=record.modes.includes("MAP")?1.3:record.modes.some(m=>["VELO","VAE","TROTTINETTE"].includes(m))?4:8;
  return candidates.sort((a,b)=>record.durationS ? Math.abs(haversineDistanceM(a.origin,a.destination)*1.3/speed-record.durationS)-Math.abs(haversineDistanceM(b.origin,b.destination)*1.3/speed-record.durationS)||a.candidate-b.candidate : a.candidate-b.candidate);
}
