/**
 * One bundle per library kind, so opening a project fetches the whole stock
 * catalogue in one request instead of thousands.
 *
 * KiCad loads its entire library set when a project opens — `PreloadLibraries`
 * is scheduled with `CallAfter` from the project manager
 * (`kicad/kicad_manager_frame.cpp:540`), the schematic editor
 * (`eeschema/sch_edit_frame.cpp:1493`) and a finishing schematic load
 * (`eeschema/files-io.cpp:858`) — because on the desktop they are files on
 * disk. Ours are objects in a bucket, so the same behaviour needs the catalogue
 * to arrive as one object rather than 15 447 of them.
 *
 * ## Why each library is gzipped here rather than on the client
 *
 * The bundle ships in the form the client STORES, so no user ever compresses
 * anything. The alternative — one brotli stream over the whole raw corpus —
 * is smaller on the wire but makes every browser decode 230 MB and re-gzip it
 * to put it away, about 4.4 s of somebody else's CPU (measured: gzip runs at
 * 52 MB/s) to redo work that can be done once, here, for everyone.
 *
 * It costs less than it sounds, because the redundancy lives in different
 * places for the two kinds. Measured against the live bucket:
 *
 *     symbols      223 libs   230.4 MB raw    10.2 MB gzip per library
 *                                              2.80 MB as one brotli stream
 *     footprints   155 libs   ~157 MB raw     ~21 MB gzip per FILE
 *                             15 447 files     ~9 MB gzip per LIBRARY
 *                                             ~10 MB as one brotli stream
 *
 * A `.pretty` is dozens of near-identical variants of one part, so gzipping a
 * library whole captures almost everything and brotli's cross-library view adds
 * nothing — per-library gzip actually beats it. Symbols are the opposite: the
 * boilerplate is shared BETWEEN the 223 files, which only a whole-corpus stream
 * can see. Net ~19 MB against ~12.8 MB, once, cached forever, and zero client
 * CPU either way.
 *
 * The outer zip is therefore stored and served with NO `content-encoding`: its
 * entries are already gzip streams and re-compressing them gains nothing.
 *
 * ## Why the name carries a hash
 *
 * These are served `immutable` for a year: the stock catalogue does not change
 * between releases, and a user's own libraries live in their account, never
 * here. `immutable` on a fixed name would be a trap — a re-uploaded catalogue
 * could never reach a client that had cached it. With the content hash in the
 * name, a new catalogue is simply a different URL and staleness cannot happen.
 * The manifest is the only mutable object, and it is written last.
 *
 * Usage: pnpm libraries:bundle          (dry run)
 *        pnpm libraries:bundle --write  (uploads)
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { getObject, getObjectBytes, putObject } from '../r2.mjs';
import { verifyZip, zipSync } from '../demos/zip.mjs';

const WRITE = process.argv.includes('--write');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

/**
 * A year, and immutable. Safe only because the object name carries the content
 * hash; see the note above.
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Where the app looks to learn the current bundle names. */
const MANIFEST_KEY = 'bundles.json';

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const sum = (bufs) => bufs.reduce((n, b) => n + b.length, 0);

/** Fetch with limited concurrency; thousands of serial GETs is pure latency. */
async function fetchAll(keys, concurrency = 16) {
  const out = new Array(keys.length);
  const queue = [...keys.entries()];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const [i, key] = next;
        const body = await getObjectBytes(key);
        if (!body) throw new Error(`missing: ${key}`);
        out[i] = body;
      }
    }),
  );
  return out;
}

/**
 * One entry per LIBRARY, gzipped, which is both KiCad's unit and the unit the
 * client stores and later expands. Per-footprint entries would mean 15 447
 * IndexedDB rows and 15 447 gzip streams that each see only 10 kB — half the
 * ratio, for more work.
 *
 * A `.kicad_sym` is one file, so its entry is that file gzipped. A `.pretty` is
 * a DIRECTORY, so its entry is a stored zip of its footprints, gzipped — the
 * same packed/unpacked asymmetry upstream has.
 */
async function symbolEntries() {
  const index = JSON.parse(await getObject('symbols/index.json'));
  const bodies = await fetchAll(index.map((l) => `symbols/${l.name}.kicad_sym`));
  const entries = {};
  index.forEach((l, i) => {
    entries[`${l.name}.kicad_sym`] = gzipSync(bodies[i], { level: 9 });
  });
  return { entries, libs: index.length, files: index.length, raw: sum(bodies) };
}

async function footprintEntries() {
  const index = JSON.parse(await getObject('footprints/index.json'));
  const entries = {};
  let files = 0;
  let raw = 0;
  for (const lib of index) {
    const bodies = await fetchAll(
      lib.footprints.map((f) => `footprints/${lib.name}.pretty/${f}.kicad_mod`),
    );
    const inner = {};
    lib.footprints.forEach((f, i) => {
      inner[`${f}.kicad_mod`] = bodies[i];
    });
    // Stored, because the gzip below is what compresses it — and gzipping the
    // library whole is the entire reason this is ~9 MB and not ~21 MB.
    const packed = zipSync(inner, { store: true });
    verifyZip(packed, inner);
    entries[`${lib.name}.pretty`] = gzipSync(packed, { level: 9 });
    files += lib.footprints.length;
    raw += sum(bodies);
  }
  return { entries, libs: index.length, files, raw };
}

const KINDS = {
  symbols: symbolEntries,
  footprints: footprintEntries,
};

const manifest = {};
for (const [kind, collect] of Object.entries(KINDS)) {
  if (ONLY && kind !== ONLY) continue;
  const { entries, libs, files, raw } = await collect();

  // Stored: every entry is already a gzip stream, so deflating them again
  // costs time and saves nothing.
  const body = zipSync(entries, { store: true });
  verifyZip(body, entries);

  // The name IS the content: same catalogue, same URL; new catalogue, new URL.
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const key = `${kind}/bundle-${hash}.zip`;

  if (WRITE) {
    // No content-encoding: the payload is gzip streams the APP reads, not a
    // transport encoding the browser should strip before the app sees them.
    await putObject(key, body, 'application/zip', { 'cache-control': CACHE_CONTROL });
  }

  manifest[kind] = { key, bytes: body.length, libraries: libs, files };
  console.log(
    `${WRITE ? 'uploaded' : 'built   '} ${kind.padEnd(11)} ${String(libs).padStart(4)} libs / ${String(files).padStart(6)} files  ${mb(raw).padStart(10)} raw -> ${mb(body.length).padStart(9)} on the wire`,
  );
  console.log(`            ${key}`);
}

if (!WRITE) {
  console.log('\ndry run: nothing uploaded, manifest not written');
} else if (ONLY) {
  // A partial run must not publish a manifest naming a bundle it did not build.
  console.log(`\n--only=${ONLY}: bundle uploaded, manifest NOT written`);
} else {
  // Last, and the only mutable object here: until it names them, the hashed
  // bundles are unreferenced and no client can see them.
  await putObject(
    MANIFEST_KEY,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    'application/json',
    {
      'cache-control': 'public, max-age=300',
    },
  );
  console.log(`\nmanifest updated -> ${MANIFEST_KEY}`);
}
