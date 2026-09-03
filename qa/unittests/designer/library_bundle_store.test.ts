// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The stock-catalogue bundle store, against a real IndexedDB.
 *
 * Every failure here is quiet, which is why it is worth executing rather than
 * reading. A store that re-downloads because it cannot recognise what it
 * already holds costs 22 MB per project open and still works. One that
 * decompresses eagerly costs 390 MB of memory and still works, until it does
 * not. And one that writes the wrong key simply misses, falling back to the
 * per-library fetches this exists to replace — invisibly, and forever.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// fflate is a `designer` dependency and does not resolve from `qa`, so the
// fixtures are built with the app's own wrappers around it — which also means
// they exercise the same writer the real bundle is read by.
import { gzip } from '@ziroeda/designer/src/home/gzip.js';
import { zipArchive } from '@ziroeda/designer/src/home/project_archiver.js';
import {
  clearBundles,
  ensureBundle,
  readFootprintLibrary,
  readLibraryBlob,
} from '@ziroeda/designer/src/libraryBundleStore.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

const SYMBOL_TEXT = '(kicad_symbol_lib (symbol "R" (property "Reference" "R")))';
const FP_TEXT = '(footprint "R_0402" (pad 1 smd rect))';

/** A bundle in the shape `tools/libraries/bundle.mjs` publishes. */
async function symbolBundle(): Promise<Uint8Array> {
  return zipArchive({ 'Device.kicad_sym': await gzip(enc.encode(SYMBOL_TEXT)) });
}

async function footprintBundle(): Promise<Uint8Array> {
  // A .pretty is a DIRECTORY upstream, so its entry is a zip of its footprints,
  // gzipped — the packed/unpacked asymmetry KiCad itself has.
  const inner = zipArchive({ 'R_0402.kicad_mod': enc.encode(FP_TEXT) });
  return zipArchive({ 'Resistor_SMD.pretty': await gzip(inner) });
}

let fetched: string[] = [];

function serve(manifest: unknown, bodies: Record<string, Uint8Array>): void {
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if (url.endsWith('/bundles.json')) {
      return manifest
        ? { ok: true, json: async () => manifest }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    const hit = Object.entries(bodies).find(([k]) => url.endsWith(k));
    return hit
      ? { ok: true, arrayBuffer: async () => hit[1].buffer.slice(0) as ArrayBuffer }
      : { ok: false, status: 404 };
  });
}

const MANIFEST = {
  symbols: { key: 'symbols/bundle-aaaa.zip', bytes: 1, libraries: 1, files: 1 },
  footprints: { key: 'footprints/bundle-bbbb.zip', bytes: 1, libraries: 1, files: 1 },
};

beforeEach(async () => {
  await clearBundles();
});
afterEach(async () => {
  await clearBundles();
  vi.unstubAllGlobals();
});

describe('a bundle becomes resident once', () => {
  it('stores every library and reads one back expanded', async () => {
    serve(MANIFEST, { 'bundle-aaaa.zip': await symbolBundle() });

    expect(await ensureBundle('symbols')).toBe(true);

    const bytes = await readLibraryBlob('symbols', 'Device.kicad_sym');
    // Expanded on demand: what is stored is gzip, what comes back is the text.
    expect(dec.decode(bytes!)).toBe(SYMBOL_TEXT);
  });

  it('does not re-download a catalogue it already holds', async () => {
    serve(MANIFEST, { 'bundle-aaaa.zip': await symbolBundle() });
    await ensureBundle('symbols');
    const first = fetched.filter((u) => u.includes('bundle-aaaa')).length;
    expect(first).toBe(1);

    // Second project open, same catalogue. The hash is IN the key, so this is
    // a key comparison and not a download.
    await ensureBundle('symbols');
    expect(fetched.filter((u) => u.includes('bundle-aaaa')).length).toBe(1);
  });

  it('fetches again when the catalogue is a different object', async () => {
    serve(MANIFEST, { 'bundle-aaaa.zip': await symbolBundle() });
    await ensureBundle('symbols');

    // A NEW SESSION, same device. `bundles.json` is read once per session, so
    // a catalogue published since the last load is seen on the next one - which
    // is why the module registry is reset here rather than the store cleared:
    // the blobs from bundle-aaaa must still be present, or this would prove
    // nothing about recognising a changed key.
    vi.resetModules();
    const next = {
      ...MANIFEST,
      symbols: { ...MANIFEST.symbols, key: 'symbols/bundle-cccc.zip' },
    };
    serve(next, { 'bundle-cccc.zip': await symbolBundle() });
    const fresh = await import('@ziroeda/designer/src/libraryBundleStore.js');

    expect(await fresh.ensureBundle('symbols')).toBe(true);
    // A new catalogue is a new URL — that is what makes `immutable` safe.
    expect(fetched.some((u) => u.includes('bundle-cccc'))).toBe(true);
  });

  it('reports progress in libraries, for the status-bar gauge', async () => {
    serve(MANIFEST, { 'bundle-aaaa.zip': await symbolBundle() });
    const seen: [number, number][] = [];
    await ensureBundle('symbols', (done, total) => seen.push([done, total]));
    expect(seen.length).toBeGreaterThan(0);
    for (const [done, total] of seen) expect(done).toBeLessThanOrEqual(total);
    expect(seen.at(-1)).toEqual([1, 1]);
  });
});

describe('a footprint library is a directory, not a file', () => {
  it('unpacks the inner archive to individual footprints', async () => {
    serve(MANIFEST, { 'bundle-bbbb.zip': await footprintBundle() });
    expect(await ensureBundle('footprints')).toBe(true);

    const lib = await readFootprintLibrary('Resistor_SMD');
    expect(Object.keys(lib!)).toEqual(['R_0402.kicad_mod']);
    expect(dec.decode(lib!['R_0402.kicad_mod'])).toBe(FP_TEXT);
  });
});

describe('the bundle is an optimisation, never a dependency', () => {
  it('reports failure rather than throwing when there is no manifest', async () => {
    serve(null, {});
    expect(await ensureBundle('symbols')).toBe(false);
  });

  it('reports failure when the object named by the manifest is missing', async () => {
    serve(MANIFEST, {}); // manifest names it, bucket 404s
    expect(await ensureBundle('symbols')).toBe(false);
  });

  it('returns null for a library it does not hold, rather than throwing', async () => {
    expect(await readLibraryBlob('symbols', 'NotHere.kicad_sym')).toBeNull();
    expect(await readFootprintLibrary('NotHere')).toBeNull();
  });
});
