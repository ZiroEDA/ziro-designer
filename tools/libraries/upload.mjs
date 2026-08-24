/**
 * Upload the complete official symbol + footprint libraries to R2.
 *
 * Sources (gitignored): kicad-symbols-src/ and kicad-footprints-src/ (upstream
 * library repos, master). Upstream symbols moved to the one-symbol-per-file
 * layout (<Lib>.kicad_symdir/*.kicad_sym); the app, like released KiCad,
 * loads one .kicad_sym per library, so each dir is merged into a single
 * library file. The merge is lossless: every top-level `(symbol …)` block is
 * copied byte-for-byte via a balanced-paren scan, never reformatted.
 *
 * Uploads:
 *   symbols/<Lib>.kicad_sym + symbols/index.json   [{name,count,symbols}]
 *   footprints/<Lib>.pretty/<FP>.kicad_mod + footprints/index.json
 *                             [{name,footprints,pads,descr,tags}]
 *
 * Usage: R2_* env vars (see tools/r2.mjs), then `node tools/libraries/upload.mjs`.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { putObject, uploadAll } from '../r2.mjs';
import { perSymbolFiles, stagedFileName, topLevelSymbols, unitCountOf, wrapLib } from './split.mjs';
import { footprintIndexInfo } from './fp_index.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Store one index gzipped, and say so.
 *
 * These two files are what every chooser needs before it can draw a row, and
 * they are the only objects in the bucket that every session fetches. Raw they
 * are 357 kB (symbols) and 649 kB (footprints); gzipped, 80 kB and 83 kB — 4.4x
 * and 7.8x, because a list of library and part names is almost all repeated
 * substrings. `content-encoding` makes the browser decompress transparently, so
 * nothing on the app side changes.
 *
 * A day of `cache-control` with `stale-while-revalidate`: the set changes when
 * upstream KiCad's libraries do, which is not daily, and the app revalidates
 * against the ETag on its own anyway (`libraryHosts.ts`). `must-revalidate` is
 * deliberately absent — a stale index for one load is a chooser missing a part
 * that landed yesterday, and blocking on the network instead is the lag this
 * whole change is about.
 */
async function putIndex(key, value) {
  const raw = Buffer.from(`${JSON.stringify(value)}\n`);
  const gz = gzipSync(raw, { level: 9 });
  await putObject(key, gz, 'application/json', {
    'content-encoding': 'gzip',
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
  });
  console.log(`${key}: ${raw.length} -> ${gz.length} bytes gzipped`);
}
const SYM_SRC = join(ROOT, 'kicad-symbols-src');
const FP_SRC = join(ROOT, 'kicad-footprints-src');

// --- symbols: merge each .kicad_symdir into one library file ------------------
const symEntries = [];
const symIndex = [];
const symDirs = readdirSync(SYM_SRC).filter((d) => d.endsWith('.kicad_symdir'));
for (const dir of symDirs.sort()) {
  const lib = dir.replace(/\.kicad_symdir$/, '');
  const parts = [];
  for (const f of readdirSync(join(SYM_SRC, dir)).sort()) {
    if (!f.endsWith('.kicad_sym')) continue;
    for (const s of topLevelSymbols(readFileSync(join(SYM_SRC, dir, f), 'utf8'))) parts.push(s);
  }
  // Derived symbols (`extends`) must appear after their parent; upstream keeps
  // parents and derivatives in one file, and file order preserves that.
  const names = parts.map((p) => p.name);
  // LIB_SYMBOL::IsPower, carried in the index so the chooser's power filter is
  // exact without loading every library. A derived symbol inherits it from the
  // symbol it extends, so the parents are resolved first.
  const blockByName = new Map(parts.map((p) => [p.name, p.block]));
  const isPower = (name, seen = new Set()) => {
    const block = blockByName.get(name);
    if (!block || seen.has(name)) return false;
    if (/\(\s*power\s*\)/.test(block)) return true;
    const ext = /\(\s*extends\s+"([^"]+)"/.exec(block);
    return ext ? isPower(ext[1], seen.add(name)) : false;
  };
  const power = names.filter((n) => isPower(n));
  const body = parts.map((p) => `\t${p.block}`).join('\n');
  const merged = wrapLib('ziro_library_merge', body);
  symEntries.push([`symbols/${lib}.kicad_sym`, Buffer.from(merged), 'text/plain']);

  // --- one file per symbol ----------------------------------------------------
  // Placing a part used to fetch its whole library: 7.0 MB for one connector
  // out of Connector_Generic, 5.2 MB out of Connector. These are the same
  // blocks, byte for byte, split so the app can ask for exactly the symbol it
  // is placing. The merged library above stays, for the library browser (which
  // legitimately wants all of a library) and as the fallback.
  //
  // A derived symbol carries no geometry of its own, so its file must also hold
  // the chain it extends. `LIB_SYMBOL::Flatten` (our `resolveExtends`) looks the
  // parent up **by name within the same file** and, finding nothing, silently
  // keeps the child's own empty body: the symbol parses, places, and has no
  // pins. Parents are emitted before the child, matching the order the merged
  // file relies on.
  const oneDir = join(ROOT, 'tools/libraries/out/symbols', lib);
  mkdirSync(oneDir, { recursive: true });
  for (const { name, text } of perSymbolFiles(parts)) {
    // The key holds the symbol name raw; the app percent-encodes it into the
    // request path, which the object store decodes back to this key.
    symEntries.push([`symbols/${lib}/${name}.kicad_sym`, Buffer.from(text), 'text/plain']);
    // Staged so the qa sweep can check every one of them with our own reader
    // before any of it is uploaded.
    writeFileSync(join(oneDir, stagedFileName(name)), text);
  }
  // Unit counts, for the symbols that have more than one.
  //
  // The chooser tree needs them before anything is fetched: KiCad builds a
  // symbol's unit rows when it builds the node (LIB_TREE_NODE_ITEM::Update ->
  // AddUnit), so a multi-unit part shows its expander arrow immediately. Ours
  // could only learn the count by downloading the symbol, so the arrow appeared
  // after the row was clicked. Carried like `power`: only the entries that need
  // it, so a library of ordinary parts adds nothing.
  const units = {};
  for (const name of names) {
    const n = unitCountOf(blockByName.get(name) ?? '');
    if (n > 1) units[name] = n;
  }
  symIndex.push({
    name: lib,
    count: names.length,
    symbols: names,
    // Omitted entirely when a library has none, keeping the index small.
    ...(power.length ? { power } : {}),
    ...(Object.keys(units).length ? { units } : {}),
  });
  // stage the merged lib so the qa sweep can validate it with our engines
  mkdirSync(join(ROOT, 'tools/libraries/out/symbols'), { recursive: true });
  writeFileSync(join(ROOT, 'tools/libraries/out/symbols', `${lib}.kicad_sym`), merged);
}
console.log(
  `symbols: ${symIndex.length} libraries, ${symIndex.reduce((n, l) => n + l.count, 0)} symbols`,
);

// --- footprints: verbatim files ------------------------------------------------
const fpEntries = [];
const fpIndex = [];
const pretties = readdirSync(FP_SRC).filter((d) => d.endsWith('.pretty'));
for (const dir of pretties.sort()) {
  const lib = dir.replace(/\.pretty$/, '');
  const mods = readdirSync(join(FP_SRC, dir))
    .filter((f) => f.endsWith('.kicad_mod'))
    .sort();
  // FOOTPRINT_INFO's three cached fields, computed here rather than in the
  // browser: the alternative is downloading and parsing every candidate to
  // answer "how many pads" / "does it mention SMD", which is what the Assign
  // Footprints dialog used to do and is far too much to run behind a filter
  // box. See tools/libraries/fp_index.mjs.
  const pads = [];
  const descr = [];
  const tags = [];
  for (const f of mods) {
    const bytes = readFileSync(join(FP_SRC, dir, f));
    fpEntries.push([`footprints/${dir}/${f}`, bytes, 'text/plain']);
    const info = footprintIndexInfo(bytes.toString('utf8'));
    pads.push(info.pads);
    descr.push(info.descr);
    tags.push(info.tags);
  }
  fpIndex.push({
    name: lib,
    footprints: mods.map((f) => f.replace(/\.kicad_mod$/, '')),
    pads,
    descr,
    tags,
  });
}
console.log(`footprints: ${fpIndex.length} libraries, ${fpEntries.length} footprints`);

if (process.env.STAGE_ONLY) {
  console.log('STAGE_ONLY set, merged libraries staged, skipping upload.');
  process.exit(0);
}

// --- upload ---------------------------------------------------------------------
const all = [...symEntries, ...fpEntries];
const totalMB = all.reduce((n, [, b]) => n + b.length, 0) / 1e6;
console.log(`uploading ${all.length} objects, ${totalMB.toFixed(0)} MB…`);
await uploadAll(all, {
  onProgress: (d, t) => {
    if (d % 500 === 0 || d === t) console.log(`${d}/${t}`);
  },
});
await putIndex('symbols/index.json', symIndex);
await putIndex('footprints/index.json', fpIndex);
console.log('uploaded manifests');
console.log('DONE');
