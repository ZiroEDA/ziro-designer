// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Demo projects, upstream's File > Open Demo Project (openDemoProject in
 * kicad/tools/kicad_manager_control.cpp, gated on PATHS::GetStockDemosPath).
 * ecc83 is bundled under /demos as the always-available demo (and the CI
 * compatibility fixture); the full corpus is served from the hosted CDN when
 * VITE_DEMOS_URL points at it (Cloudflare R2, same pattern as the 3D model
 * library; build the upload tree with tools/demos/build.mjs). Opening a demo
 * fetches its files verbatim (no renaming, a demo opens as itself).
 */
import type { PickedHomeFile } from './files.js';
import { DEMOS_HOST } from '../libraryHosts.js';
import { expandArchive } from './project_archiver.js';

export interface DemoMeta {
  id: string;
  base: string;
  title: string;
  description: string;
  files: string[];
  /**
   * Size of this demo's `bundle.zip`, when `tools/demos/upload.mjs` wrote one.
   *
   * Its presence is what tells the app a single-request open is available;
   * absent, the per-file path is used, which is what lets this ship before the
   * corpus is re-uploaded.
   */
  bundleBytes?: number;
}

const DEMOS_BASE = DEMOS_HOST;

const dec = new TextDecoder();

/** Load the bundled demo manifest (empty on failure, the menu item disables). */
export async function loadDemos(): Promise<DemoMeta[]> {
  try {
    const res = await fetch(`${DEMOS_BASE}/index.json`);
    if (!res.ok) return [];
    const j = (await res.json()) as { demos: DemoMeta[] };
    return j.demos ?? [];
  } catch {
    return [];
  }
}

/**
 * Which demo a path in the chooser's Demos tree names, if any.
 *
 * The sibling of `projectAt` for the account's tree, and it exists for the same
 * reason: the file chooser hands back a path, and the caller has to get from
 * that back to the thing it names. It cannot be `projectAt` — that reads the
 * first segment as a project of the store, so `/simulation/amplifier_ac` looks
 * for a project called `simulation`, finds none, and the demo silently does not
 * open. A demo's id *is* its folder, so the demo is the one whose id the path
 * starts with: the folder itself, or anything inside it.
 *
 * The longest match wins. Demo ids nest — `simulation` is a real folder in
 * KiCad's demos directory and `simulation/sallen_key` is a demo inside it — so
 * were a demo ever published at a folder that also prefixes another's id, the
 * shorter one is an ancestor of the path and the longer one is the demo the
 * path is actually in.
 */
export function demoAt(path: string, demos: readonly DemoMeta[]): DemoMeta | null {
  let best: DemoMeta | null = null;
  for (const d of demos) {
    const at = `/${d.id}`;
    if (path !== at && !path.startsWith(`${at}/`)) continue;
    if (!best || d.id.length > best.id.length) best = d;
  }
  return best;
}

const encodeRel = (rel: string): string => rel.split('/').map(encodeURIComponent).join('/');

/** Matches `BUNDLE_NAME` in `tools/demos/upload.mjs`. */
const BUNDLE_NAME = 'bundle.zip';

/**
 * Fetch a demo as one object.
 *
 * The cost of a demo is round trips, not bytes — CM5 Minima's 89 files are
 * 5.3 MB and took 8.45 s measured, because the bucket speaks HTTP/1.1 and the
 * browser caps connections per host at about six. One zip is one request, and
 * its deflate is also the compression the bucket does not do (every object is
 * served uncompressed as `application/octet-stream`).
 *
 * Progress is bytes here rather than files, which is both honest for a single
 * object and a better gauge: the old counter jumped in 89 discrete steps whose
 * sizes differed by three orders of magnitude.
 *
 * Returns null on any failure, so the caller falls back to per-file fetches.
 */
async function fetchDemoBundle(
  d: DemoMeta,
  onProgress?: (done: number, total: number, file: string) => void,
): Promise<PickedHomeFile[] | null> {
  try {
    const res = await fetch(`${DEMOS_BASE}/${encodeRel(d.id)}/${BUNDLE_NAME}`);
    if (!res.ok) return null;

    const total = Number(res.headers.get('content-length')) || d.bundleBytes || 0;
    let bytes: Uint8Array;
    if (res.body && total > 0) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress?.(got, total, d.base);
      }
      bytes = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
    }

    // The same reader that opens a user's uploaded .zip; a demo bundle is not
    // a new format, so there is nothing here to keep in step with the writer.
    const entries = expandArchive(bytes);
    if (!entries || entries.length === 0) return null;

    return entries.map((e) => ({
      name: `${d.base}/${e.name}`,
      text: dec.decode(e.data),
      bytes: e.data,
    }));
  } catch {
    return null;
  }
}

/**
 * Files a demo carries that nothing needs in order to *open* it.
 *
 * 3D models dominate: the CM5 Minima demo is 46 MB, of which 40.7 MB is STEP
 * bodies and a datasheet PDF, against 5 MB of schematic, board and footprints.
 * None of it is read to show a schematic or a board, only to render the 3D view
 * or to open the document from the project tree, so waiting for it before the
 * editor appears is 89% of the wait for nothing.
 */
export const isDeferrableDemoFile = (rel: string): boolean =>
  /\.(step|stp|wrl|glb|pdf|bin)$/i.test(rel);

/** Run `work` over `items`, at most `limit` in flight. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * How many files are fetched at once.
 *
 * The cost of a demo is round trips, not bytes: the files are small and there
 * are up to 128 of them, so fetching them one after another spent the whole
 * open waiting on latency. Browsers cap connections per host at around six, so
 * asking for much more than that buys nothing.
 */
const FETCH_CONCURRENCY = 8;

async function fetchDemoFiles(
  d: DemoMeta,
  rels: readonly string[],
  onProgress?: (done: number, total: number, file: string) => void,
): Promise<PickedHomeFile[]> {
  let done = 0;
  const fetched = await mapLimit(rels, FETCH_CONCURRENCY, async (rel) => {
    const res = await fetch(`${DEMOS_BASE}/${encodeRel(d.id)}/${encodeRel(rel)}`);
    done++;
    // Completion order, not request order: the gauge tracks what has arrived.
    onProgress?.(done, rels.length, rel);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { name: `${d.base}/${rel}`, text: dec.decode(bytes), bytes } as PickedHomeFile;
  });
  return fetched.filter((f): f is PickedHomeFile => f !== null);
}

/**
 * Fetch what a demo needs to open: everything except the deferrable files.
 *
 * `onProgress(done, total, file)` ticks as each arrives, so the caller can show
 * a determinate gauge.
 */
export async function openDemo(
  d: DemoMeta,
  onProgress?: (done: number, total: number, file: string) => void,
): Promise<PickedHomeFile[]> {
  // A bundle carries the WHOLE project, 3D models included, so nothing is
  // deferred and nothing stalls later: a wait the user watched on purpose is
  // better than one that interrupts them mid-edit.
  if (d.bundleBytes) {
    const bundled = await fetchDemoBundle(d, onProgress);
    if (bundled) return bundled;
  }
  return fetchDemoFiles(
    d,
    d.files.filter((rel) => !isDeferrableDemoFile(rel)),
    onProgress,
  );
}

/**
 * The rest of a demo's files, fetched after it is already on screen.
 *
 * The project is still expected to be complete: it lands in Recent, it syncs,
 * and its 3D view has to work. So these arrive too, just not in the way of the
 * user seeing their board. Returns an empty list when there are none.
 */
export async function fetchDemoExtras(
  d: DemoMeta,
  have: readonly string[] = [],
): Promise<PickedHomeFile[]> {
  // `have` is what the open already produced. A bundled demo arrives complete,
  // so every deferrable file is already present and this is empty — without
  // the check, keeping a bundled demo would re-download its 3D models one by
  // one, the exact traffic the bundle exists to remove.
  const present = new Set(have);
  const rels = d.files.filter(
    (rel) => isDeferrableDemoFile(rel) && !present.has(`${d.base}/${rel}`),
  );
  return rels.length === 0 ? [] : fetchDemoFiles(d, rels);
}
