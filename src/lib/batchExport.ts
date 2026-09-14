import type {GeneratedBatch} from "./types";
import type {PathBatch} from "./parquetWriter";

export const EXPORT_PART_SIZE = 1000;
export type ExportFormat = "parquet" | "gpx";
export function exportParts(batches: GeneratedBatch[]): Array<{name: string; batch: PathBatch; fileNames: string[]}> {
  const parts: Array<{name: string; batch: PathBatch; fileNames: string[]}> = [];
  batches.forEach((batch, batchIndex) => {
    for (let start = 0; start < batch.trips.length; start += EXPORT_PART_SIZE) {
      const trips = batch.trips.slice(start, start + EXPORT_PART_SIZE).map(trip => {
        if (!trip.exportInput) throw new Error("This trip predates structured exports. Generate it again to export this batch.");
        return trip.exportInput;
      });
      parts.push({name: `batch-${batchIndex + 1}-part-${Math.floor(start / EXPORT_PART_SIZE) + 1}`, batch: {id: batch.id, trips, metadata: {name: batch.name, createdAt: batch.createdAt, report: batch.report}}, fileNames: batch.trips.slice(start, start + EXPORT_PART_SIZE).map(trip => trip.fileName)});
    }
  });
  return parts;
}

async function encode(batch: PathBatch, format: ExportFormat, signal: AbortSignal, fileNames: string[]): Promise<Uint8Array> {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./batchExport.worker.ts", import.meta.url), {type: "module"});
  return new Promise((resolve, reject) => {
    const cleanup = () => {worker.terminate(); signal.removeEventListener("abort", abort);};
    const abort = () => {cleanup(); reject(new DOMException("Export cancelled", "AbortError"));};
    signal.addEventListener("abort", abort, {once: true});
    worker.onerror = event => {cleanup(); reject(new Error(event.message || "Export worker failed"));};
    worker.onmessage = ({data}) => {cleanup(); data.error ? reject(new Error(data.error)) : resolve(data.bytes);};
    try {worker.postMessage({batch, format, fileNames});}
    catch (error) {cleanup(); reject(error);}
  });
}

export async function exportBatches(batches: GeneratedBatch[], format: ExportFormat, signal: AbortSignal, progress: (text: string) => void): Promise<{bytes: Uint8Array; name: string}> {
  const parts = exportParts(batches);
  if (!parts.length) throw new Error("No trips to export.");
  if (parts.length === 1) {
    progress(`Exporting ${parts[0].batch.trips.length} trips…`);
    return {bytes: await encode(parts[0].batch, format, signal, parts[0].fileNames), name: `${parts[0].name}.${format === "parquet" ? "parquet" : "zip"}`};
  }
  const {default: JSZip} = await import("jszip");
  const zip = new JSZip();
  for (const [index, part] of parts.entries()) {
    progress(`Exporting part ${index + 1} of ${parts.length}…`);
    zip.file(`${part.name}.${format === "parquet" ? "parquet" : "zip"}`, await encode(part.batch, format, signal, part.fileNames));
  }
  zip.file("manifest.json", JSON.stringify({schemaVersion: 1, format, batches: batches.map(({id, name, createdAt, report, trips}) => ({id, name, createdAt, report, tripCount: trips.length})), parts: parts.map(p => ({file: `${p.name}.${format === "parquet" ? "parquet" : "zip"}`, batchId: p.batch.id, tripCount: p.batch.trips.length}))}, null, 2));
  signal.throwIfAborted();
  progress("Packaging exported parts…");
  const bytes = await zip.generateAsync({type: "uint8array", compression: "STORE"}, () => signal.throwIfAborted());
  return {bytes, name: `trip-batches-${format}.zip`};
}

export function saveExport(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
