import init from "parquet-wasm/esm";
import wasmUrl from "parquet-wasm/esm/parquet_wasm_bg.wasm?url";
import {parquetReadObjects} from "hyparquet";
import {compressors} from "hyparquet-compressors";
import {writePathParquet} from "../../src/lib/parquetWriter";
import {buildTripSegments} from "../../src/lib/gpxWriter";
import {pathFixture} from "./pathFixture";

self.onmessage = async (event: MessageEvent<number>) => {
  try {
    if (![100, 1000, 10000].includes(event.data)) throw new Error("Unsupported fixture size");
    self.postMessage({status: "Loading local fixture and WebAssembly…"});
    const [network] = await Promise.all([
      fetch("/data/idfm-transit.json").then(response => {if (!response.ok) throw new Error("Missing transit fixture"); return response.json();}),
      init({module_or_path: wasmUrl})
    ]);
    const trips = pathFixture(network, event.data);
    writePathParquet([{id: "warmup", trips: trips.slice(0, 10)}]);
    self.postMessage({status: "Writing GeoParquet in worker…"});
    const start = performance.now();
    const bytes = writePathParquet([{id: "browser-fixture-90310", trips}]);
    const exportMs = performance.now() - start;
    self.postMessage({status: "Checking every coordinate with independent reader…"});
    const rows = await parquetReadObjects({file: Uint8Array.from(bytes).buffer, compressors});
    let index = 0, points = 0;
    for (const trip of trips) for (const [legIndex, leg] of buildTripSegments(trip).entries()) {
      const row = rows[index++];
      const expected = {type: leg.coords.length === 1 ? "Point" : "LineString", coordinates: leg.coords.length === 1 ? leg.coords[0] : leg.coords};
      if (row.trip_id !== trip.id || row.leg_index !== legIndex || row.mode !== leg.mode || JSON.stringify(row.geometry) !== JSON.stringify(expected)) throw new Error("Round-trip mismatch");
      points += leg.coords.length;
    }
    if (rows.length !== index) throw new Error("Unexpected row count");
    self.postMessage({done: true, trips: trips.length, legs: rows.length, points, exportMs, bytes}, {transfer: [bytes.buffer]});
  } catch (error) {self.postMessage({error: error instanceof Error ? error.message : String(error)});}
};
