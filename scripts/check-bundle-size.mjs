import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const INITIAL_GZIP_BUDGET_BYTES = 80_000;
const distDirectory = resolve("dist");
const html = await readFile(resolve(distDirectory, "index.html"), "utf8");
const initialAssetPaths = Array.from(
  html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
  (match) => match[1]
);

if (initialAssetPaths.length === 0) {
  throw new Error("No initial JavaScript or CSS assets were found in dist/index.html.");
}

let totalGzipBytes = 0;
for (const assetPath of initialAssetPaths) {
  const normalizedPath = assetPath.replace(/^\.\//, "");
  const bytes = await readFile(resolve(distDirectory, normalizedPath));
  totalGzipBytes += gzipSync(bytes).byteLength;
}

const formatted = `${(totalGzipBytes / 1024).toFixed(1)} KiB`;
const budget = `${(INITIAL_GZIP_BUDGET_BYTES / 1024).toFixed(1)} KiB`;
console.log(`Initial bundle: ${formatted} gzip (budget ${budget}).`);

if (totalGzipBytes > INITIAL_GZIP_BUDGET_BYTES) {
  throw new Error(`Initial bundle exceeds its gzip budget by ${totalGzipBytes - INITIAL_GZIP_BUDGET_BYTES} bytes.`);
}
