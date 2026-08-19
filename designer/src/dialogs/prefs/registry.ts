// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Preferences book: which pages exist, in what order, under what headings,
 * and which module constructs each one.
 *
 * This is `EDA_BASE_FRAME::ShowPreferences` (`common/eda_base_frame.cpp:1585-1755`).
 * There, the base frame adds the generic pages itself from `common/dialogs/`,
 * then for each loaded KIFACE adds a heading `AddPage( new wxPanel )` and a run
 * of `AddLazySubPage( LAZY_CTOR( PANEL_<ID> ), _( "<label>" ) )` — where
 * `LAZY_CTOR` is nothing but `kiface->CreateKiWindow( parent, key, kiway )`.
 * The dialog therefore knows page ids and labels and nothing else; the app on
 * the far side of the id owns the panel, and no app includes another's header.
 *
 * Ours: `PAGES` is that add-order. `LAZY_CTOR` is the other half, in
 * `lazy_pages.ts` — split off only because it must reach the panels, which are
 * `.tsx`, and `qa`'s tsconfig sets no `--jsx`, so a test that imported the book
 * through this module could not compile. Keeping the book free of that edge is
 * what lets the page list be asserted as data rather than scraped as text.
 *
 * Dependency runs one way: shell -> registry -> editor factory. Nothing here
 * may be imported by an editor, and no editor's prefs module may import
 * another's. Enforced by `qa/unittests/designer/prefs_registry.test.ts`.
 */
import type { PrefsPageId, PrefsPageOwner } from './types.js';

/** A row in the page tree. `id === null` is a heading — upstream's empty `wxPanel`. */
export interface PrefsPageEntry {
  id: PrefsPageId | null;
  label: string;
  /** A sub-page under the heading above it (`AddLazySubPage` rather than `AddPage`). */
  indent?: boolean;
  /** Which module answers for this id. Headings have no owner. */
  owner?: PrefsPageOwner;
}

/**
 * The book, in add-order. Generic pages first, exactly as the base frame adds
 * them before any KIFACE is consulted; then one heading per editor.
 */
export const PAGES: readonly PrefsPageEntry[] = [
  { id: 'common', label: 'Common', owner: 'generic' },
  { id: 'mouse', label: 'Mouse and Touchpad', owner: 'generic' },
  { id: 'hotkeys', label: 'Hotkeys', owner: 'generic' },
  { id: null, label: 'Schematic Editor' },
  { id: 'sch-display', label: 'Display Options', indent: true, owner: 'schematic' },
  { id: 'sch-grids', label: 'Grids', indent: true, owner: 'schematic' },
  { id: 'sch-editing', label: 'Editing Options', indent: true, owner: 'schematic' },
  { id: 'sch-annotation', label: 'Annotation Options', indent: true, owner: 'schematic' },
  { id: 'sch-colors', label: 'Colors', indent: true, owner: 'schematic' },
  { id: 'sch-fields', label: 'Field Name Templates', indent: true, owner: 'schematic' },
  { id: null, label: 'PCB Editor' },
  { id: 'pcb-display', label: 'Display Options', indent: true, owner: 'pcb' },
];

/** The first selectable page — what the dialog opens on. */
export const FIRST_PAGE: PrefsPageId = 'common';

/** Which module answers for this page id, or undefined for an unknown id. */
export function ownerOf(id: PrefsPageId): PrefsPageOwner | undefined {
  return PAGES.find((p) => p.id === id)?.owner;
}

/** The page's tree label, as the dialog shows it. */
export function labelOf(id: PrefsPageId): string | undefined {
  return PAGES.find((p) => p.id === id)?.label;
}
