/**
 * Re-store the two library indexes gzipped, with cache headers.
 *
 * A one-shot for the objects already in the bucket. `upload.mjs` writes them
 * this way now (see `putIndex` there), but re-running that means re-uploading
 * the whole official symbol and footprint set to fix two files. This downloads
 * what is there, gzips it, and puts it back byte-identical once decompressed.
 *
 * Why it matters: those two objects are what every chooser needs before it can
 * draw a single row, and they were served raw with an ETag and NO
 * `Cache-Control` at all — 357 kB and 649 kB downloaded again on every page
 * load, when they compress 4.4x and 7.8x.
 *
 * Usage: R2_* env vars (see tools/r2.mjs), then
 *   node tools/libraries/reheader_indexes.mjs
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { putObject } from '../r2.mjs';

const HOST = 'https://pub-ac941e05e1284f409be2ed74ddb151b3.r2.dev';
const KEYS = ['symbols/index.json', 'footprints/index.json'];

for (const key of KEYS) {
  const res = await fetch(`${HOST}/${key}`);
  if (!res.ok) throw new Error(`GET ${key}: ${res.status}`);
  let raw = Buffer.from(await res.arrayBuffer());

  // Idempotent: if it has already been done, the body on the wire is gzip and
  // `fetch` may or may not have decompressed it depending on the header the
  // bucket sent. Re-gzipping a gzip would leave the object double-encoded and
  // unreadable, which is a worse state than the one being fixed.
  if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);

  // It has to still parse. A truncated download that got put back would take
  // every chooser down, and there is no second copy in the bucket.
  const parsed = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${key}: expected a non-empty array, refusing to write it back`);
  }

  const gz = gzipSync(raw, { level: 9 });
  await putObject(key, gz, 'application/json', {
    'content-encoding': 'gzip',
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
  });
  console.log(`${key}: ${parsed.length} entries, ${raw.length} -> ${gz.length} bytes`);
}
console.log('DONE');
