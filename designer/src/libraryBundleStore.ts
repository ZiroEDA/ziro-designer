// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The stock catalogue, fetched once as one object and kept on the device.
 *
 * KiCad loads its whole library set when a project opens — `PreloadLibraries`
 * scheduled with `CallAfter` from the project manager
 * (`kicad/kicad_manager_frame.cpp:540`) and the schematic editor
 * (`eeschema/sch_edit_frame.cpp:1493`) — because on the desktop they are files
 * already on disk. Ours were 223 symbol libraries and 15 447 footprint files in
 * the bucket, fetched one at a time, forever, on every board that touched them.
 *
 * So `tools/libraries/bundle.mjs` publishes one object per kind and this reads
 * it. Measured: symbols 230.41 MB raw -> 10.21 MB in one request.
 *
 * Three properties, in the order they matter:
 *
 *  - **Nothing is compressed here.** Each entry arrives already gzipped, in the
 *    form it is stored in, so a browser never spends CPU packing 230 MB away.
 *    Reading costs one `gunzip` of one library, measured at 1-5 ms even for the
 *    largest (Regulator_Linear, 1 625 symbols).
 *  - **Nothing is held in memory.** The bundle decodes to ~390 MB across both
 *    kinds; only the libraries a design actually touches are ever expanded, and
 *    the parsed results are the caller's to cache.
 *  - **The bundle is immutable and content-named.** `bundles.json` names
 *    `symbols/bundle-<hash>.zip`; a different catalogue is a different URL, so
 *    the year-long `immutable` on the object can never strand anybody.
 *
 * This is the GLOBAL library table only. A project's own libraries resolve
 * ahead of it through `project_sym_lib_table.ts`, exactly as
 * `SYMBOL_LIB_TABLE` resolves the project table before the global one, so a
 * bundle can never shadow a library the user brought with their project.
 */
import { unzipSync } from 'fflate';
import { idbHandle } from './home/idb_open.js';
import { gunzip } from './home/gzip.js';
import { LIBRARY_HOST } from './libraryHosts.js';

const DB_NAME = 'ziroeda-libraries';
const VERSION = 1;
/** `<kind>/<library>` -> the library's gzip bytes, exactly as shipped. */
const BLOBS = 'blobs';
/** `<kind>` -> which bundle hash the blobs came from. */
const META = 'meta';

export type LibraryKind = 'symbols' | 'footprints';

/** One kind's entry in `bundles.json`. */
export interface BundleInfo {
  key: string;
  bytes: number;
  libraries: number;
  files: number;
}

const db = idbHandle(DB_NAME, VERSION, (d) => {
  if (!d.objectStoreNames.contains(BLOBS)) d.createObjectStore(BLOBS);
  if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
});

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const store = async (name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> =>
  (await db.get()).transaction(name, mode).objectStore(name);

/**
 * The catalogue must never be the reason the app fails to start. Every failure
 * here falls back to the per-library fetches that worked before this existed.
 */
const quiet = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

let manifestPromise: Promise<Record<string, BundleInfo> | null> | null = null;

/** `bundles.json` — the only mutable object in this scheme. */
export function bundleManifest(): Promise<Record<string, BundleInfo> | null> {
  if (!manifestPromise) {
    manifestPromise = quiet(async () => {
      const res = await fetch(`${LIBRARY_HOST}/bundles.json`);
      return res.ok ? ((await res.json()) as Record<string, BundleInfo>) : null;
    }, null);
  }
  return manifestPromise;
}

/** Which bundle this device already holds for a kind, if any. */
const storedHash = (kind: LibraryKind): Promise<string | undefined> =>
  quiet(
    async () => wrap((await store(META, 'readonly')).get(kind) as IDBRequest<string | undefined>),
    undefined,
  );

/**
 * Make a kind's catalogue resident, if it is not already.
 *
 * Returns false when the bundle could not be used, which is not an error: the
 * caller carries on with per-library fetches.
 *
 * `onProgress(done, total)` reports libraries written, so the caller can drive
 * the status-bar gauge the way `PreloadLibraries` drives it from
 * `AsyncLoadProgress()`.
 */
export async function ensureBundle(
  kind: LibraryKind,
  onProgress?: (done: number, total: number) => void,
): Promise<boolean> {
  return quiet(async () => {
    const manifest = await bundleManifest();
    const info = manifest?.[kind];
    if (!info) return false;

    // The hash is in the key, so "same key" is "same catalogue" and there is
    // nothing to compare, re-download, or invalidate.
    if ((await storedHash(kind)) === info.key) return true;

    // The hash is in the key, so "same key" is "same catalogue" and there is
    // nothing to compare, re-download, or invalidate.

    const res = await fetch(`${LIBRARY_HOST}/${info.key}`);
    if (!res.ok) return false;
    const zip = new Uint8Array(await res.arrayBuffer());

    // Stored entries, so this is a header walk rather than a decompression;
    // the gzip inside each entry is left alone and written as it came.
    const entries = unzipSync(zip);
    const names = Object.keys(entries);
    if (names.length === 0) return false;

    let done = 0;
    for (const name of names) {
      const s = await store(BLOBS, 'readwrite');
      s.put(entries[name], `${kind}/${name}`);
      onProgress?.(++done, names.length);
    }
    const meta = await store(META, 'readwrite');
    meta.put(info.key, kind);
    return true;
  }, false);
}

/**
 * A library's bytes, expanded on demand.
 *
 * For symbols this is the `.kicad_sym` text. For footprints it is a zip of the
 * library's `.kicad_mod` files, because a `.pretty` is a directory upstream —
 * use {@link readFootprintLibrary} rather than unpacking it here.
 */
export async function readLibraryBlob(kind: LibraryKind, name: string): Promise<Uint8Array | null> {
  return quiet(async () => {
    const s = await store(BLOBS, 'readonly');
    const blob = await wrap(s.get(`${kind}/${name}`) as IDBRequest<Uint8Array | undefined>);
    return blob ? await gunzip(blob) : null;
  }, null);
}

/**
 * Unzipped `.pretty` archives, by library name.
 *
 * A footprint is read one at a time — the chooser previews them individually —
 * and unzipping the whole library for each would redo the same work per part.
 * The values are views into one decompressed buffer per library, so this holds
 * the libraries a session actually touches and nothing else.
 */
const footprintLibs = new Map<string, Record<string, Uint8Array> | null>();

/** One `.pretty`'s footprints, by bare footprint name. */
export async function readFootprintLibrary(
  library: string,
): Promise<Record<string, Uint8Array> | null> {
  const memo = footprintLibs.get(library);
  if (memo !== undefined) return memo;
  const packed = await readLibraryBlob('footprints', `${library}.pretty`);
  const out = packed ? await quiet(async () => unzipSync(packed), null) : null;
  footprintLibs.set(library, out);
  return out;
}

const dec = new TextDecoder();

/**
 * A stock symbol library's text, or null when this device has no bundle.
 *
 * Null is the signal to fetch it the old way; every caller keeps that path.
 */
export async function symbolLibraryText(library: string): Promise<string | null> {
  const bytes = await readLibraryBlob('symbols', `${library}.kicad_sym`);
  return bytes ? dec.decode(bytes) : null;
}

/** A stock footprint's text, or null when this device has no bundle. */
export async function footprintText(library: string, name: string): Promise<string | null> {
  const lib = await readFootprintLibrary(library);
  const entry = lib?.[`${name}.kicad_mod`];
  return entry ? dec.decode(entry) : null;
}

/** Preferences > Maintenance, and the tests. */
export async function clearBundles(): Promise<void> {
  footprintLibs.clear();
  await quiet(async () => {
    (await store(BLOBS, 'readwrite')).clear();
    (await store(META, 'readwrite')).clear();
  }, undefined);
}
