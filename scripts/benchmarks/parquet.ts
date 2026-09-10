import {readFileSync, writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {deepStrictEqual} from "node:assert";
import JSZip from "jszip";
import init from "parquet-wasm/esm";
import {parquetReadObjects, parquetMetadata} from "hyparquet";
import {compressors} from "hyparquet-compressors";
import {buildTripGpx, buildTripSegments} from "../../src/lib/gpxWriter";
import {writePathParquet} from "../../src/lib/parquetWriter";
import {pathFixture} from "./pathFixture";

const [format, countText, output] = process.argv.slice(2);
const count = Number(countText);
if (!["gpx-store", "gpx-deflate", "parquet"].includes(format) || !Number.isInteger(count) || count < 1 || count > 50000) throw new Error("Invalid benchmark arguments");
await init({module_or_path: readFileSync("node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm")});
const network = JSON.parse(readFileSync("public/data/idfm-transit.json", "utf8"));
const trips = pathFixture(network, count);
const pointCount = trips.reduce((sum, trip) => sum + buildTripSegments(trip).reduce((n, leg) => n + leg.coords.length, 0), 0);
async function encode(input: typeof trips) {
  if (format === "parquet") return writePathParquet([{id: "fixture-90310", trips: input}]);
  const zip = new JSZip();
  for (const trip of input) zip.file(`${trip.id}.gpx`, buildTripGpx(trip));
  return zip.generateAsync({type: "uint8array", compression: format === "gpx-store" ? "STORE" : "DEFLATE", compressionOptions: {level: 6}});
}
await encode(trips.slice(0, 10));
global.gc?.();
const baselineRss = process.memoryUsage().rss;
const start = performance.now();
const bytes = await encode(trips);
const exportMs = performance.now() - start;
const peakRss = process.resourceUsage().maxRSS * 1024;
const endRss = process.memoryUsage().rss;
writeFileSync(`${output}/${count}-${format}.${format === "parquet" ? "parquet" : "zip"}`, bytes);
let roundTripMs: number | null = null;
let selectedColumnsMs: number | null = null;
if (format === "parquet") {
  const file = Uint8Array.from(bytes).buffer;
  const metadata = parquetMetadata(file);
  if (!metadata.key_value_metadata?.some(item => item.key === "geo")) throw new Error("Missing GeoParquet metadata");
  let start = performance.now();
  const rows = await parquetReadObjects({file, compressors});
  roundTripMs = performance.now() - start;
  let rowIndex = 0;
  for (const trip of trips) {
    for (const [legIndex, leg] of buildTripSegments(trip).entries()) {
      const row = rows[rowIndex++];
      deepStrictEqual([row.batch_id, row.trip_id, row.leg_index, row.mode, row.role], ["fixture-90310", trip.id, legIndex, leg.mode, leg.role]);
      deepStrictEqual(row.geometry, {type: leg.coords.length === 1 ? "Point" : "LineString", coordinates: leg.coords.length === 1 ? leg.coords[0] : leg.coords});
      deepStrictEqual(JSON.parse(row.trip_json as string).originPoint, trip.originPoint);
    }
  }
  deepStrictEqual(rows.length, rowIndex);
  start = performance.now();
  const selected = await parquetReadObjects({file, compressors, columns: ["trip_id", "mode", "distance_m"]});
  selectedColumnsMs = performance.now() - start;
  deepStrictEqual(selected.length, rows.length);
} else {
  const archive = await JSZip.loadAsync(bytes);
  deepStrictEqual(Object.keys(archive.files).length, count);
  // The same XML is retained by ZIP; point serialization is covered by GPX contract tests.
  for (const trip of [trips[0], trips[trips.length - 1]]) {
    const xml = await archive.file(`${trip.id}.gpx`)!.async("string");
    if (!xml.includes(`<odc:trip id="${trip.id}"`)) throw new Error("ZIP verification failed");
  }
}
console.log(JSON.stringify({format, count, legs: count * 3, pointCount, bytes: bytes.length, exportMs, baselineRss, endRss, peakRss, roundTripMs, selectedColumnsMs, verified: true}));
