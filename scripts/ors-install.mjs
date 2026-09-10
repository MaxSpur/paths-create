import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, link, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable, Transform} from 'node:stream';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

async function verify(file, asset) {
  const info = await stat(file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (info.size !== asset.bytes || hash.digest('hex') !== asset.sha256) {
    throw new Error(`Checksum/size mismatch for ${asset.file}. Existing files are never replaced; see OFFLINE_ROUTING.md.`);
  }
}

// Download beside the destination so the verified file can be published atomically.
export async function ensureAsset(runtime, asset, fetchAsset = fetch) {
  const destination = path.join(runtime, asset.file);
  try {
    await verify(destination, asset);
    return 'verified';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(runtime, {recursive: true});
  const temporary = await mkdtemp(path.join(runtime, '.download-'));
  const partial = path.join(temporary, 'asset');
  try {
    const response = await fetchAsset(asset.url, {signal: AbortSignal.timeout(30 * 60 * 1000)});
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${asset.url}. See OFFLINE_ROUTING.md for unavailable inputs.`);
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > asset.bytes ? new Error(`Download exceeds expected size for ${asset.file}`) : null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(partial, {flags: 'wx'}));
    await verify(partial, asset);
    await link(partial, destination); // Fails if another installer has already created it.
    return 'downloaded';
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const runtime = path.join(root, '.local-ors');
  const inputs = JSON.parse(await readFile(path.join(root, 'scripts/ors-inputs.json'), 'utf8'));
  await mkdir(runtime, {recursive: true});
  const lock = path.join(runtime, '.install-lock');
  try { await mkdir(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another install may be running (.local-ors/.install-lock). See OFFLINE_ROUTING.md.');
    throw error;
  }
  try {
    for (const asset of inputs.assets) {
      console.log(`Checking/installing ${asset.file} (${Math.round(asset.bytes / 1e6)} MB)…`);
      console.log(`${asset.file}: ${await ensureAsset(runtime, asset)}`);
    }
    // Preserve provenance from an earlier successful installation.
    try {
      await writeFile(path.join(runtime, 'manifest.json'), JSON.stringify({...inputs, installed: new Date().toISOString()}, null, 2) + '\n', {flag: 'wx'});
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    console.log('Inputs verified. Install Java 21 if needed, then run npm run ors:start. Graphs and any running server were left intact.');
  } finally { await rm(lock, {recursive: true, force: true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
