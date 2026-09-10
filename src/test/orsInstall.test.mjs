// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ensureAsset} from '../../scripts/ors-install.mjs';

const folders = [];
const body = 'fixture map bytes';
const asset = {file: 'map.pbf', url: 'https://example.invalid/map', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex')};
async function folder() {
  const result = await mkdtemp(path.join(tmpdir(), 'ors-install-test-'));
  folders.push(result);
  return result;
}
afterEach(async () => {await Promise.all(folders.splice(0).map(dir => rm(dir, {recursive: true, force: true})));});
describe('verified ORS inputs', () => {
  it('installs fresh inputs and reuses them without another request', async () => {
    const dir = await folder();
    const request = vi.fn(async () => new Response(body));
    expect(await ensureAsset(dir, asset, request)).toBe('downloaded');
    expect(await readFile(path.join(dir, asset.file), 'utf8')).toBe(body);
    expect(await ensureAsset(dir, asset, request)).toBe('verified');
    expect(request).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual([asset.file]);
  });
  it('refuses to replace an existing mismatched input', async () => {
    const dir = await folder();
    await writeFile(path.join(dir, asset.file), 'old');
    const request = vi.fn();
    await expect(ensureAsset(dir, asset, request)).rejects.toThrow('mismatch');
    expect(request).not.toHaveBeenCalled();
    expect(await readFile(path.join(dir, asset.file), 'utf8')).toBe('old');
  });
  it.each(['wrong checksum', 'oversized', 'unavailable', 'interrupted'])('does not publish a %s download', async kind => {
    const dir = await folder();
    const request = async () => {
      if (kind === 'unavailable') return new Response('', {status: 404});
      if (kind === 'interrupted') return new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array([1])); controller.error(new Error('connection lost'));}}));
      return new Response(kind === 'oversized' ? body + 'extra' : 'x'.repeat(body.length));
    };
    await expect(ensureAsset(dir, asset, request)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
