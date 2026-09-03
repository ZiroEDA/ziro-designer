/**
 * Add a `bundle.zip` to every demo already on the bucket, without re-uploading
 * the corpus.
 *
 * `upload.mjs` builds bundles too, but it publishes the whole corpus from a
 * local `kicad-src/demos` clone. That clone is gitignored and usually absent,
 * and re-deriving the corpus from a fresh checkout risks publishing files that
 * differ from the ones already live. So this reads what is actually on the
 * bucket and bundles that: whatever a demo currently serves is exactly what its
 * bundle contains.
 *
 * Two ordering rules, both about not breaking the live app:
 *
 *   1. **Bundles first, manifest last.** `bundleBytes` in the manifest is what
 *      switches clients onto the one-request path, so it is written only after
 *      every bundle it names exists. Until then every client keeps taking the
 *      per-file path it takes today.
 *   2. **Additive only.** Bundles are new objects; nothing existing is deleted
 *      or overwritten except the manifest, and the previous manifest is saved
 *      beside this script first so the change is one command to undo.
 *
 * One demo at a time, in memory, so a 120 MB project needs 120 MB rather than
 * a copy of the corpus on a disk that may not have room for it.
 *
 * Usage: pnpm demos:bundle           (dry run: builds and verifies, uploads nothing)
 *        pnpm demos:bundle --write   (uploads)
 *        pnpm demos:bundle --write --brotli
 *
 * `--brotli` stores the zip uncompressed and brotli-compresses the object,
 * served with `content-encoding: br`. The browser decodes it transparently, so
 * the app still receives a plain zip and `expandArchive` needs no change —
 * while brotli, seeing the whole archive at once, exploits the redundancy
 * between a project's dozens of near-identical footprints that per-file
 * deflate cannot. Measured on CM5 Minima: 10.67 MB -> 7.19 MB, 32.6% less.
 * Verified beforehand that R2 stores and returns both `content-encoding` and
 * `cache-control` on a public object.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getObject, getObjectBytes, putObject } from '../r2.mjs';
import { verifyZip, zipSync } from './zip.mjs';

const PREFIX = (process.env.R2_PREFIX ?? 'demos').replace(/\/+$/, '');
const BUNDLE_NAME = 'bundle.zip';
const WRITE = process.argv.includes('--write');
const BROTLI = process.argv.includes('--brotli');

/**
 * Long enough that a reopened demo is free, short enough that a re-upload is
 * picked up the same day. The object name is fixed, so an `immutable` year
 * would strand clients on a stale bundle with no way to invalidate.
 */
const CACHE_CONTROL = 'public, max-age=3600';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

const manifestText = await getObject(`${PREFIX}/index.json`);
if (!manifestText) throw new Error(`no manifest at ${PREFIX}/index.json`);
const manifest = JSON.parse(manifestText);

// The rollback artifact, written before anything is uploaded. Restoring it is
// enough to put every client back on the per-file path.
//
// Never clobbered. A second run's "previous manifest" is the FIRST run's
// output, so overwriting would quietly destroy the only record of the state
// before any of this existed - which is precisely the state a rollback wants.
// Each run also drops a timestamped copy, so every step is recoverable.
const backup = fileURLToPath(new URL('index.json.bak', import.meta.url));
if (!existsSync(backup)) writeFileSync(backup, manifestText);
const stamped = fileURLToPath(
  new URL(`index.json.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`, import.meta.url),
);
writeFileSync(stamped, manifestText);
console.log(`${manifest.demos.length} demos; manifest saved to ${stamped}`);
if (!WRITE) console.log('DRY RUN - pass --write to upload\n');

let totalRaw = 0;
let totalZip = 0;

for (const d of manifest.demos) {
  if (ONLY && d.id !== ONLY) continue;
  // Fetched with limited concurrency: 703 objects one after another is minutes
  // of pure round-trip. Entries are keyed by name, so arrival order is free.
  const entries = {};
  let raw = 0;
  const queue = [...d.files];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const rel = queue.shift();
        if (!rel) return;
        const body = await getObjectBytes(`${PREFIX}/${d.id}/${rel}`);
        if (!body) throw new Error(`missing: ${PREFIX}/${d.id}/${rel}`);
        entries[rel] = body;
        raw += body.length;
      }
    }),
  );
  // zipSync walks `entries` in insertion order, which concurrency makes
  // arrival order; sort so a rebuild of unchanged files is the same bytes.
  const ordered = {};
  for (const rel of d.files) ordered[rel] = entries[rel];

  const zip = zipSync(ordered, { store: BROTLI });
  // Nothing in CI opens a bundle this writer produced; see `verifyZip`.
  verifyZip(zip, ordered);

  // What the wire carries, and what the browser hands the app after decoding.
  const body = BROTLI
    ? brotliCompressSync(zip, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
          [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: zip.length,
        },
      })
    : zip;

  if (WRITE) {
    for (let attempt = 1; ; attempt++) {
      try {
        await putObject(`${PREFIX}/${d.id}/${BUNDLE_NAME}`, body, 'application/zip', {
          'cache-control': CACHE_CONTROL,
          ...(BROTLI ? { 'content-encoding': 'br' } : {}),
        });
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
  // `bundleBytes` is what the wire carries. `bundleRawBytes` is what the app
  // receives after the browser decodes `content-encoding`, and it is the only
  // honest denominator for a download gauge: a decoding stream yields decoded
  // bytes, so measuring them against the compressed content-length runs the
  // bar past 100%.
  d.bundleBytes = body.length;
  if (BROTLI) d.bundleRawBytes = zip.length;
  else delete d.bundleRawBytes;
  totalRaw += raw;
  totalZip += body.length;
  console.log(
    `${WRITE ? 'uploaded' : 'built   '} ${d.id.padEnd(38)} ${String(d.files.length).padStart(3)} files  ${mb(raw).padStart(9)} -> ${mb(body.length).padStart(9)}`,
  );
}

console.log(`\ntotal ${mb(totalRaw)} -> ${mb(totalZip)}`);

if (!WRITE) {
  console.log('dry run: manifest NOT written');
} else if (ONLY) {
  // A partial run must not publish a manifest claiming bundles it never built.
  console.log(`--only=${ONLY}: bundle uploaded, manifest NOT written`);
} else {
  await putObject(
    `${PREFIX}/index.json`,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    'application/json',
  );
  console.log(`manifest updated -> ${PREFIX}/index.json`);
}
