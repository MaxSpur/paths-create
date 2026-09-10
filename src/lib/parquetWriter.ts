import {Binary, Float64, Int32, Table, Utf8, tableToIPC, vectorFromArray} from "apache-arrow";
import * as parquet from "parquet-wasm/esm";
import {buildTripSegments, segmentDistanceM, type GpxTripInput} from "./gpxWriter";
import type {LonLat} from "./types";

export interface PathBatch { id: string; trips: GpxTripInput[] }

/** WKB keeps the original float64 coordinates; no decimal rounding or simplification. */
export function encodePathWkb(coords: LonLat[]): {bytes: Uint8Array; type: string} {
  if (!coords.length) throw new Error("Cannot encode an empty path.");
  const dimension = coords[0].length;
  if (dimension !== 2 && dimension !== 3) throw new Error("Expected 2D or 3D coordinates.");
  if (coords.some(c => c.length !== dimension || !c.every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)) {
    throw new Error("Invalid coordinates or mixed dimensions within a leg.");
  }
  const point = coords.length === 1;
  const bytes = new Uint8Array((point ? 5 : 9) + coords.length * dimension * 8);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 1);
  view.setUint32(1, (point ? 1 : 2) + (dimension === 3 ? 1000 : 0), true);
  if (!point) view.setUint32(5, coords.length, true);
  let offset = point ? 5 : 9;
  for (const coord of coords) for (const value of coord) {view.setFloat64(offset, value!, true); offset += 8;}
  return {bytes, type: `${point ? "Point" : "LineString"}${dimension === 3 ? " Z" : ""}`};
}

function tripMetadata(trip: GpxTripInput): string {
  const {walkIn, metro, walkOut, driving, cycling, transitJourney, ...metadata} = trip;
  return JSON.stringify({...metadata, ...(transitJourney ? {transitJourney: {
    from: transitJourney.from, to: transitJourney.to,
    networkVersion: transitJourney.networkVersion, transferCount: transitJourney.transferCount
  }} : {}), ...(trip.accessMode === "cycling" ? {
    bikeHandling: "leave-at-boarding-station", bikeParking: "unverified"
  } : {})});
}

/** Prototype: caller initializes the WASM runtime; write in a worker for browser use. */
export function writePathParquet(batches: PathBatch[]): Uint8Array {
  const rows: Array<{
    batch_id: string; trip_id: string; leg_index: number; role: string; mode: string;
    line_id: string | null; line_name: string | null; geometry_source: string | null;
    point_count: number; distance_m: number; geometry: Uint8Array;
    from_json: string; to_json: string; trip_json: string; leg_json: string;
  }> = [];
  const geometryTypes = new Set<string>();
  const batchIds = new Set<string>();
  for (const batch of batches) {
    if (!batch.id || batchIds.has(batch.id)) throw new Error("Batch IDs must be nonempty and unique.");
    batchIds.add(batch.id);
    const tripIds = new Set<string>();
    for (const trip of batch.trips) {
      if (!trip.id || tripIds.has(trip.id)) throw new Error("Trip IDs must be nonempty and unique within each batch.");
      tripIds.add(trip.id);
      const segments = buildTripSegments(trip);
      if (!segments.length) throw new Error(`Trip ${trip.id} has no path geometry.`);
      const metadata = tripMetadata(trip);
      for (const [index, segment] of segments.entries()) {
        const geometry = encodePathWkb(segment.coords);
        geometryTypes.add(geometry.type);
        rows.push({batch_id: batch.id, trip_id: trip.id, leg_index: index,
          role: segment.role, mode: segment.mode,
          line_id: segment.transitLeg?.line?.id ?? null, line_name: segment.transitLeg?.line?.name ?? null,
          geometry_source: segment.geometrySource ?? null,
          point_count: segment.coords.length, distance_m: segmentDistanceM(segment.coords), geometry: geometry.bytes,
          from_json: JSON.stringify(segment.from), to_json: JSON.stringify(segment.to), trip_json: metadata,
          leg_json: JSON.stringify({...segment, coords: undefined, transitLeg: segment.transitLeg ? {...segment.transitLeg, coordinates: undefined} : undefined})});
      }
    }
  }
  if (!rows.length) throw new Error("No trips to export.");
  const strings = ["batch_id", "trip_id", "role", "mode", "line_id", "line_name", "geometry_source", "from_json", "to_json", "trip_json", "leg_json"] as const;
  const columns = Object.fromEntries(strings.map(key => [key, vectorFromArray(rows.map(row => row[key]), new Utf8())]));
  const table = new Table({...columns,
    leg_index: vectorFromArray(rows.map(r => r.leg_index), new Int32()),
    point_count: vectorFromArray(rows.map(r => r.point_count), new Int32()),
    distance_m: vectorFromArray(rows.map(r => r.distance_m), new Float64()),
    geometry: vectorFromArray(rows.map(r => r.geometry), new Binary())});
  const properties = new parquet.WriterPropertiesBuilder()
    .setCompression(parquet.Compression.ZSTD)
    .setMaxRowGroupSize(4096)
    .setKeyValueMetadata(new Map([
      ["geo", JSON.stringify({version: "1.1.0", primary_column: "geometry", columns: {
        geometry: {encoding: "WKB", geometry_types: [...geometryTypes].sort(), edges: "planar"}
      }})],
      ["odc", JSON.stringify({schemaVersion: 1, legIndexBase: 0, coordinates: "longitude,latitude[,elevation_m]",
        source: "Synthetic paths; no per-point timestamps or observation noise.",
        transitAttribution: "Île-de-France Mobilités", transitLicense: "https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm",
        geometryAttribution: "© OpenStreetMap contributors", geometryLicense: "https://opendatacommons.org/licenses/odbl/1-0/"})]
    ])).build();
  const wasmTable = parquet.Table.fromIPCStream(tableToIPC(table, "stream"));
  // writeParquet consumes both WASM objects; do not free them again after this call.
  return parquet.writeParquet(wasmTable, properties);
}
