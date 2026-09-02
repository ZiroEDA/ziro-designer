// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAZY_CTOR`: which module constructs a page, and the cache of the ones built.
 *
 * `EDA_BASE_FRAME::ShowPreferences` reaches an app's panels through
 * `kiface->CreateKiWindow( parent, PANEL_<ID>, kiway )` — a call into a
 * separately loaded module, by id. A dynamic `import()` is the direct analogue,
 * and it is load-bearing rather than stylistic: our editors are code-split, so
 * a static import here would drag the whole PCB editor into the dialog's chunk
 * and `AddLazySubPage` would be lazy in name only.
 *
 * Split out of `registry.ts` so the page book stays importable from `qa`,
 * whose tsconfig sets no `--jsx` and therefore cannot follow a `.tsx`.
 */
import { ownerOf } from './registry.js';
import type { PrefsPageId, PrefsPageOwner, PrefsPanelFactory, PrefsPanelModule } from './types.js';

/**
 * Where each owner's `CreateKiWindow` lives. Dynamic on purpose: this is the
 * seam that keeps a code-split editor out of the dialog's bundle.
 */
const OWNERS: Record<PrefsPageOwner, () => Promise<PrefsPanelFactory>> = {
  generic: async () => (await import('./panels/index.js')).createPrefsPanel,
  // Upstream the Symbol Editor's five panels come out of eeschema's KIFACE,
  // the same `CreateKiWindow` switch the schematic's do
  // (`eeschema/eeschema.cpp:251-305`). Here they are their own owner because
  // here the two editors are their own bundles: routing them through the
  // schematic's factory would pull `editors/schematic` in whenever a symbol
  // editor user opened Preferences, which is the one thing this seam exists to
  // prevent.
  symbol: async () => (await import('../../editors/symbol/prefs/index.js')).createPrefsPanel,
  schematic: async () => (await import('../../editors/schematic/prefs/index.js')).createPrefsPanel,
  pcb: async () => (await import('../../editors/pcb/prefs/index.js')).createPrefsPanel,
  gerbview: async () => (await import('../../editors/gerbview/prefs/index.js')).createPrefsPanel,
  drawingsheet: async () =>
    (await import('../../editors/drawingsheet/prefs/index.js')).createPrefsPanel,
};

/** Panels already constructed, so reopening a page does not re-import (wx keeps the page). */
const cache = new Map<PrefsPageId, PrefsPanelModule>();

/** Synchronous peek — non-null once the page has been opened at least once. */
export function peekPrefsPanel(id: PrefsPageId): PrefsPanelModule | undefined {
  return cache.get(id);
}

/** `LAZY_CTOR( id )`: ask the owning module for the page, constructing it on first open. */
export async function loadPrefsPanel(id: PrefsPageId): Promise<PrefsPanelModule> {
  const hit = cache.get(id);
  if (hit) return hit;

  const owner = ownerOf(id);
  if (!owner) throw new Error(`Preferences: no owner registered for page "${id}"`);

  const factory = await OWNERS[owner]();
  const mod = factory(id);
  if (!mod) throw new Error(`Preferences: "${owner}" does not construct page "${id}"`);

  cache.set(id, mod);
  return mod;
}

/** Test seam: drop the constructed-panel cache. */
export function resetPrefsPanelCache(): void {
  cache.clear();
}
