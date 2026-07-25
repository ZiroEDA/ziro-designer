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

export interface DemoMeta {
  id: string;
  base: string;
  title: string;
  description: string;
  files: string[];
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

const encodeRel = (rel: string): string => rel.split('/').map(encodeURIComponent).join('/');

/** Fetch a demo's files, nested under a folder named for the demo.
 *  `onProgress(done, total, file)` ticks per downloaded file so the caller can
 *  show a determinate "Downloading… n of m" gauge while the CDN responds. */
export async function openDemo(
  d: DemoMeta,
  onProgress?: (done: number, total: number, file: string) => void,
): Promise<PickedHomeFile[]> {
  const out: PickedHomeFile[] = [];
  let done = 0;
  for (const rel of d.files) {
    const res = await fetch(`${DEMOS_BASE}/${encodeRel(d.id)}/${encodeRel(rel)}`);
    done++;
    onProgress?.(done, d.files.length, rel);
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    out.push({ name: `${d.base}/${rel}`, text: dec.decode(bytes), bytes });
  }
  return out;
}
