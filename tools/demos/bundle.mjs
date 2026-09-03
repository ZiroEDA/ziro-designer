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
 * Usage: pnpm demos:bundle          (dry run: builds and verifies, uploads nothing)
 *        pnpm demos:bundle --write  (uploads)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getObject, getObjectBytes, putObject } from '../r2.mjs';
import { verifyZip, zipSync } from './zip.mjs';

const PREFIX = (process.env.R2_PREFIX ?? 'demos').replace(/\/+$/, '');
const BUNDLE_NAME = 'bundle.zip';
const WRITE = process.argv.includes('--write');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

const manifestText = await getObject(`${PREFIX}/index.json`);
if (!manifestText) throw new Error(`no manifest at ${PREFIX}/index.json`);
const manifest = JSON.parse(manifestText);

// The rollback artifact, written before anything is uploaded. Restoring it is
// enough to put every client back on the per-file path.
const backup = fileURLToPath(new URL('index.json.bak', import.meta.url));
writeFileSync(backup, manifestText);
console.log(`${manifest.demos.length} demos; previous manifest saved to ${backup}`);
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

  const zip = zipSync(ordered);
  // Nothing in CI opens a bundle this writer produced; see `verifyZip`.
  verifyZip(zip, ordered);

  if (WRITE) {
    for (let attempt = 1; ; attempt++) {
      try {
        await putObject(`${PREFIX}/${d.id}/${BUNDLE_NAME}`, zip, 'application/zip');
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
  d.bundleBytes = zip.length;
  totalRaw += raw;
  totalZip += zip.length;
  console.log(
    `${WRITE ? 'uploaded' : 'built   '} ${d.id.padEnd(38)} ${String(d.files.length).padStart(3)} files  ${mb(raw).padStart(9)} -> ${mb(zip.length).padStart(9)}`,
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
