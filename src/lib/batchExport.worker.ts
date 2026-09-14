import init from "parquet-wasm/esm";
import wasmUrl from "parquet-wasm/esm/parquet_wasm_bg.wasm?url";
import {writePathParquet, type PathBatch} from "./parquetWriter";
import {buildTripGpx} from "./gpxWriter";
import JSZip from "jszip";
self.onmessage = async ({data}: MessageEvent<{format: "parquet" | "gpx"; batch: PathBatch; fileNames: string[]}>) => {
  try {
    let bytes: Uint8Array;
    if (data.format === "parquet") {await init({module_or_path: wasmUrl}); bytes = writePathParquet([data.batch]);}
    else {
      const zip = new JSZip();
      for (const [index, trip] of data.batch.trips.entries()) zip.file((data.fileNames[index] || `${index + 1}.gpx`).replace(/[\\/]/g, "_"), buildTripGpx(trip));
      bytes = await zip.generateAsync({type: "uint8array", compression: "DEFLATE", compressionOptions: {level: 6}});
    }
    self.postMessage({bytes}, {transfer: [bytes.buffer as ArrayBuffer]});
  } catch (error) {self.postMessage({error: error instanceof Error ? error.message : String(error)});}
};
