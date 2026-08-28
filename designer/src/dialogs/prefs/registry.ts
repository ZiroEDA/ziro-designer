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
  // pl_editor's KIFACE is added last of the four, after gerbview's
  // (`common/eda_base_frame.cpp:1726-1737`).
  { id: null, label: 'Drawing Sheet Editor' },
  { id: 'ds-display', label: 'Display Options', indent: true, owner: 'drawingsheet' },
  { id: 'ds-grids', label: 'Grids', indent: true, owner: 'drawingsheet' },
  { id: 'ds-colors', label: 'Colors', indent: true, owner: 'drawingsheet' },
];

/**
 * The sub-pages each heading carries **upstream**, in `ShowPreferences`' own add
 * order — `common/eda_base_frame.cpp:1631-1737`, transcribed from the
 * `AddLazySubPage` runs.
 *
 * A missing page is invisible: the tree simply has one fewer row, and nothing
 * that reads only {@link PAGES} can tell a page that was never ported from a
 * page that was dropped. That is how the Drawing Sheet Editor came to be called
 * complete while its entire heading was absent. So the book is stated from
 * KiCad's side as well as ours, and
 * `qa/unittests/designer/prefs_page_book.test.ts` requires, per heading, that
 * shipped + {@link OMITTED_PAGES} is exactly this list in exactly this order,
 * and that anything shipped which is not on it is declared in
 * {@link EXTRA_PAGES}.
 *
 * Headings upstream has that we ship no rows for at all — Symbol Editor,
 * Footprint Editor, 3D Viewer, Gerber Viewer — are not here: they are absent
 * headings, not absent pages, and are tracked with their editors.
 */
export const UPSTREAM_BOOK: Readonly<Record<string, readonly string[]>> = {
  'Schematic Editor': [
    'Display Options',
    'Grids',
    'Editing Options',
    'Colors',
    'Toolbars',
    'Field Name Templates',
    'Data Sources',
    'Simulator',
  ],
  'PCB Editor': [
    'Display Options',
    'Grids',
    'Origins & Axes',
    'Editing Options',
    'Colors',
    'Toolbars',
    'Plugins',
  ],
  'Drawing Sheet Editor': ['Display Options', 'Grids', 'Colors', 'Toolbars'],
};

/** A page upstream has under a heading that we do not ship, and why not. */
export interface DeclaredPage {
  /** The label the row would carry, exactly as upstream spells it. */
  label: string;
  /** Why. Not a TODO: a decision, with its reason. */
  reason: string;
}

/**
 * Pages of {@link UPSTREAM_BOOK} this port does not ship.
 *
 * Every one of these is a row a user comparing the two dialogs side by side
 * will notice is absent. Naming it here is the difference between a decision
 * and an oversight.
 */
export const OMITTED_PAGES: Readonly<Record<string, readonly DeclaredPage[]>> = {
  'Schematic Editor': [
    {
      label: 'Toolbars',
      reason:
        'PANEL_TOOLBAR_CUSTOMIZATION, and no launcher here has one. See the Drawing ' +
        'Sheet Editor row: it is one app-wide port, tracked on issue 619.',
    },
    { label: 'Data Sources', reason: 'Schematic Editor tracker 195.' },
    { label: 'Simulator', reason: 'No ngspice in the browser; tracker 195.' },
  ],
  'PCB Editor': [
    { label: 'Grids', reason: 'PCB Editor tracker 200.' },
    { label: 'Origins & Axes', reason: 'PCB Editor tracker 200.' },
    { label: 'Editing Options', reason: 'PCB Editor tracker 200.' },
    { label: 'Colors', reason: 'PCB Editor tracker 200.' },
    {
      label: 'Toolbars',
      reason: 'PANEL_TOOLBAR_CUSTOMIZATION; see the Drawing Sheet Editor row. Tracked on 619.',
    },
    {
      label: 'Plugins',
      reason:
        'PANEL_PCBNEW_ACTION_PLUGINS lists Python action plugins, which have no browser form.',
    },
  ],
  'Drawing Sheet Editor': [
    {
      label: 'Toolbars',
      reason:
        'PANEL_TOOLBAR_CUSTOMIZATION (`common/dialogs/panel_toolbar_customization.cpp`, ' +
        '1147 lines). Nothing about it is browser-hostile — it is pure UI state — but it ' +
        "edits a TOOLBAR_SETTINGS file this port does not have: every launcher's toolbars " +
        'are module constants (`editors/*/…Toolbars.ts`), so the page would have nothing ' +
        "to write to. All four of upstream's Toolbars pages are one shared panel over one " +
        'shared store, and building it for pl_editor alone is exactly the per-launcher copy ' +
        'this dialog was split up to stop. App-wide work; stays open on issue 619.',
    },
  ],
};

/**
 * Rows we show that upstream's tree does not have under that heading, and why.
 *
 * There is exactly one, and it is a known defect rather than a choice, so it is
 * recorded as such: a reason here is not a justification, it is a pointer.
 */
export const EXTRA_PAGES: Readonly<Record<string, readonly DeclaredPage[]>> = {
  'Schematic Editor': [
    {
      label: 'Annotation Options',
      reason:
        'Upstream has no such page: `PANEL_EESCHEMA_ANNOTATION_OPTIONS` is a page of ' +
        'DIALOG_SCHEMATIC_SETUP, not of Preferences. Ours puts it in the wrong dialog. ' +
        'Tracked with the schematic, 195.',
    },
  ],
};

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

/**
 * The sub-page labels {@link PAGES} ships under one heading, in tree order.
 * A heading is every row with `id === null`; its sub-pages are the indented
 * rows that follow it, up to the next heading.
 */
export function shippedUnder(heading: string): string[] {
  const start = PAGES.findIndex((p) => p.id === null && p.label === heading);
  if (start < 0) return [];
  const out: string[] = [];
  for (const p of PAGES.slice(start + 1)) {
    if (p.id === null) break;
    out.push(p.label);
  }
  return out;
}
