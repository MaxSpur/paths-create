import {build} from 'vite';
import {mkdir, writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const run = promisify(execFile);
const counts = (process.argv[2] ?? '1000,10000').split(',').map(Number);
const repeats = Number(process.argv[3] ?? 3);
if (counts.some(n => !Number.isInteger(n) || n < 1 || n > 50000) || !Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Usage: npm run benchmark:parquet -- 1000,10000 3');
const output = path.resolve('.benchmark-output/parquet');
await mkdir(output, {recursive: true});
await build({configFile: false, logLevel: 'warn', build: {ssr: 'scripts/benchmarks/parquet.ts', outDir: output, emptyOutDir: false}});
const results = [];
for (const count of counts) for (let repeat = 0; repeat < repeats; repeat++) for (const format of ['gpx-store', 'gpx-deflate', 'parquet']) {
  const {stdout} = await run(process.execPath, ['--expose-gc', path.join(output, 'parquet.js'), format, String(count), output], {maxBuffer: 4 * 1024 * 1024});
  const result = {...JSON.parse(stdout.trim()), repeat};
  results.push(result);
  console.log(`${count} trips ${format} run ${repeat + 1}: ${(result.bytes / 1e6).toFixed(2)} MB, ${(result.exportMs / 1000).toFixed(2)} s, peak process RSS ${(result.peakRss / 2**20).toFixed(0)} MiB; verified`);
}
await writeFile(path.join(output, 'results.json'), JSON.stringify({created: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, results}, null, 2) + '\n');
console.log(`Artifacts and raw results: ${output}`);
