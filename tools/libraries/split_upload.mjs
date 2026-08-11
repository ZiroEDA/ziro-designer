/**
 * Publish the per-symbol files for the libraries that are already live.
 *
 * `upload.mjs` builds everything from an upstream checkout, which is right when
 * refreshing to a new KiCad release and wrong for this: rebuilding the merged
 * libraries from whatever upstream is at today would quietly change the symbols
 * production serves, as a side effect of adding a fetch optimisation. So this
 * reads each `symbols/<Lib>.kicad_sym` back out of the bucket and splits *that*,
 * which makes the per-symbol files exact copies of what the app already serves,
 * whatever release they came from.
 *
 * Purely additive: every key it writes (`symbols/<Lib>/<Symbol>.kicad_sym`) is
 * new, and nothing existing is touched.
 *
 * Usage (needs .env, see .env.example):
 *   pnpm libraries:split                 all libraries
 *   pnpm libraries:split Device 74xx     only those, for a first look
 */
import { getObject, uploadAll } from '../r2.mjs';
import { perSymbolFiles, topLevelSymbols } from './split.mjs';

const only = new Set(process.argv.slice(2));

const index = JSON.parse((await getObject('symbols/index.json')) ?? '[]');
const libs = index.map((e) => e.name).filter((n) => only.size === 0 || only.has(n));
if (libs.length === 0) {
  console.error(`no libraries matched (index holds ${index.length})`);
  process.exit(1);
}
console.log(`splitting ${libs.length} of ${index.length} libraries`);

let symbols = 0;
let bytes = 0;
const entries = [];

for (const lib of libs) {
  const text = await getObject(`symbols/${lib}.kicad_sym`);
  if (text === null) {
    console.warn(`  ${lib}: no merged library in the bucket, skipped`);
    continue;
  }
  const parts = topLevelSymbols(text);
  for (const { name, text: one } of perSymbolFiles(parts)) {
    const body = Buffer.from(one);
    // The key carries the symbol name raw. The app percent-encodes it into the
    // request path and the store decodes that back to this key; encoding at
    // both ends would store a key nothing can address.
    entries.push([`symbols/${lib}/${name}.kicad_sym`, body, 'text/plain']);
    bytes += body.length;
  }
  symbols += parts.length;
  process.stdout.write(`\r  read ${lib}: ${symbols} symbols so far`.padEnd(72));
}

console.log(
  `\nuploading ${entries.length} objects, ${(bytes / 1024 / 1024).toFixed(1)} MB total ` +
    `(average ${Math.round(bytes / Math.max(entries.length, 1))} bytes per symbol)`,
);

await uploadAll(entries, {
  onProgress: (done, total) => {
    if (done % 200 === 0 || done === total) {
      process.stdout.write(`\r  uploaded ${done}/${total}`.padEnd(72));
    }
  },
});

console.log(`\ndone: ${entries.length} per-symbol files across ${libs.length} libraries`);
