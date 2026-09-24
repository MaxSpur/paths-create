import type { LatLon, LonLat } from "./types";

export type AreaGeometry = {type: "Polygon"; coordinates: number[][][]} | {type: "MultiPolygon"; coordinates: number[][][][]};
export interface NetmobArea {code: string; name: string; geometry: AreaGeometry; source: string}
export type SourceValues = Record<string, string | number | null>;
export interface NetmobRecord {
  key: string; rowIndex: number; raw: SourceValues; origin: string; destination: string;
  modes: string[]; departure: string | null; durationS: number | null; weight: number | null;
  issues: string[]; exclusions: string[];
}
export interface NetmobSummary {
  id: string; name: string; kind: "emg" | "cube"; rows: number; eligible: number;
  weight: number; areas: number; columns: Array<{name: string; type: string}>;
  modes: Record<string, number>; exclusions: Record<string, number>; importMs: number;
}
export interface NetmobFilter {
  origin?: string; destination?: string; mode?: string; purpose?: string; dateFrom?: string; dateTo?: string;
  timeFrom?: string; timeTo?: string; durationMin?: number; durationMax?: number; eligibleOnly?: boolean;
}
export interface NetmobFacets {modes: Record<string,number>; purposes: Record<string,number>; dates: Record<string,number>; durationMin: number | null; durationMax: number | null}
export interface NetmobPage {facets?: NetmobFacets;rows: NetmobRecord[]; total: number; weight: number; page: number}
export interface NetmobPair {
  record: NetmobRecord; origin: LatLon; destination: LatLon;
  originArea: NetmobArea; destinationArea: NetmobArea; candidate: number;
}
export interface FitSettings {seed: number; realization: number; trials: number; toleranceS: number; tolerancePercent: number; durationModel?:'routing'|'movement'; movement?:import('./movementSimulation').SimulationSettings}
export const DEFAULT_FIT: FitSettings = {seed: 90314, realization: 0, trials: 12, toleranceS: 180, tolerancePercent: 20};
export interface ModeledLeg {
  mode: "walking" | "cycling" | "driving" | "metro" | "rer" | "train" | "tram" | "bus";
  sourceMode: string; coordinates: LonLat[]; durationS: number; distanceM: number;
  waitS?: number; timingSource: string; geometrySource: string;
  lineId?: string; lineName?: string; lineColor?: string;
  traversal?: {patternIndex:number;fromIndex:number;toIndex:number};
  stops?: Array<{stopId:string;name:string;coordinateIndex:number}>; fromStopId?: string; toStopId?: string;
  startOffsetS?: number; endOffsetS?: number; assumptions: string[];
}
export interface NetmobFit {
  status: "acceptable" | "poor" | "unassessed"; targetS: number | null; modeledS: number;
  durationModel?:'routing'|'movement'; movementVersion?:string; routingS?:number; movementS?:number;
  errorS: number | null; trials: number; requests: number; cacheHits: number;
  fidelity: "matched" | "proxy" | "inferred"; assumptions: string[];
}
export interface NetmobMetadata {
  version: 1; datasetId: string; sourceKey: string; rowIndex: number; raw: SourceValues;
  issues?: string[]; settings: FitSettings; candidate: number; departure: string | null;
  origin: LatLon; destination: LatLon; boundaries: {origin: string; destination: string};
  fit: NetmobFit; networkVersion?: string; timingVersion?: string; timingSource?: import("./netmobTiming").TransitTiming["source"];
}
