import type { LatLon, LonLat } from "./types";

export type TransitMode = "metro" | "rer" | "train" | "tram";

export interface TransitStop extends LatLon {
  id: string;
  name: string;
  parent?: string;
}

export interface TransitLine {
  id: string;
  name: string;
  mode: TransitMode;
  color: string;
}

export interface TransitPattern {
  line: number;
  stops: number[];
  coordinates: LonLat[];
  offsets: number[];
  pickup?: boolean[];
  dropoff?: boolean[];
}

export interface TransitNetwork {
  schemaVersion: 1;
  version: string;
  source: { url: string; retrieved: string; license: string; attribution: string };
  stops: TransitStop[];
  lines: TransitLine[];
  patterns: TransitPattern[];
  /** Directed permitted stop-to-stop transfers, including within stations. */
  transfers: Array<[number, number]>;
}

export interface TransitLeg {
  kind: "transit" | "transfer";
  mode: TransitMode | "walking";
  from: TransitStop;
  to: TransitStop;
  line?: TransitLine;
  coordinates: LonLat[];
  geometrySource: "gtfs" | "station-connector" | "ors";
}

export interface TransitJourney {
  legs: TransitLeg[];
  from: TransitStop;
  to: TransitStop;
  transferCount: number;
  networkVersion: string;
}
