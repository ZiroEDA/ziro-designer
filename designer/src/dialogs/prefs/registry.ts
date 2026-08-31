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
  { id: 'sch-toolbars', label: 'Toolbars', indent: true, owner: 'schematic' },
  { id: 'sch-fields', label: 'Field Name Templates', indent: true, owner: 'schematic' },
  { id: null, label: 'PCB Editor' },
  { id: 'pcb-display', label: 'Display Options', indent: true, owner: 'pcb' },
  { id: 'pcb-toolbars', label: 'Toolbars', indent: true, owner: 'pcb' },
  // pl_editor's KIFACE is added last of the four, after gerbview's
  // (`common/eda_base_frame.cpp:1726-1737`).
  { id: null, label: 'Drawing Sheet Editor' },
  { id: 'ds-display', label: 'Display Options', indent: true, owner: 'drawingsheet' },
  { id: 'ds-grids', label: 'Grids', indent: true, owner: 'drawingsheet' },
  { id: 'ds-colors', label: 'Colors', indent: true, owner: 'drawingsheet' },
  { id: 'ds-toolbars', label: 'Toolbars', indent: true, owner: 'drawingsheet' },
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
 * Headings upstream has that we ship no rows for at all are not here, because
 * this table is keyed by heading: an absent heading has no entry to be missing
 * from. They are declared instead in {@link UPSTREAM_TOP_LEVEL} and
 * {@link OMITTED_TOP_LEVEL}, which is the same idea one level up.
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

/**
 * The tree's TOP-LEVEL rows upstream, in order — the whole of what a user sees
 * when Preferences opens, because at most one section is expanded and usually
 * none is (see `PreferencesDialog`'s `collapsed` state).
 *
 * Read off a capture of the installed 10.0.5 rather than off `ShowPreferences`
 * alone, because two of these rows are behind build options the source cannot
 * settle: `Plugins` is inside `#ifdef KICAD_IPC_API` and is PRESENT in this
 * build, and `Data Collection` — which the source adds unconditionally in the
 * generic run — is ABSENT from it, being guarded by `KICAD_USE_SENTRY` at the
 * panel's own end. The parity target is the installed build, so the capture
 * wins. [data]
 *
 * Fifteen rows. We ship six. The nine we do not are in
 * {@link OMITTED_TOP_LEVEL}, each with its reason, and
 * `qa/unittests/designer/prefs_page_book.test.ts` requires that shipped +
 * omitted is exactly this list in exactly this order — so a heading cannot go
 * missing silently the way the Drawing Sheet Editor's once did.
 */
export const UPSTREAM_TOP_LEVEL: readonly string[] = [
  'Common',
  'Mouse and Touchpad',
  'SpaceMouse',
  'Hotkeys',
  'Version Control',
  'Symbol Editor',
  'Schematic Editor',
  'Footprint Editor',
  'PCB Editor',
  '3D Viewer',
  'Gerber Viewer',
  'Drawing Sheet Editor',
  'Packages and Updates',
  'Plugins',
  'Maintenance',
];

/** A page upstream has under a heading that we do not ship, and why not. */
export interface DeclaredPage {
  /** The label the row would carry, exactly as upstream spells it. */
  label: string;
  /** Why. Not a TODO: a decision, with its reason. */
  reason: string;
}

/**
 * The nine top-level rows of {@link UPSTREAM_TOP_LEVEL} this port does not
 * draw, and why.
 *
 * Four of them are headings for editors we DO ship — Symbol Editor, Footprint
 * Editor, 3D Viewer, Gerber Viewer — and those are the ones that are simply
 * unfinished rather than impossible. Upstream their sub-pages are mostly the
 * shared widgets we already have: `PANEL_SYM_EDIT_GRIDS` is `PANEL_GRID_SETTINGS`,
 * `PANEL_SYM_COLORS` is `PANEL_COLOR_SETTINGS`, `PANEL_SYM_TOOLBARS` is
 * `PANEL_TOOLBAR_CUSTOMIZATION`, and `PANEL_SYM_DISP_OPTIONS` wraps
 * `PANEL_GAL_DISPLAY_OPTIONS`. So they are bindings to a settings store, not
 * new panels.
 *
 * The other five have no browser form at all, and are decisions.
 */
export const OMITTED_TOP_LEVEL: readonly DeclaredPage[] = [
  {
    label: 'SpaceMouse',
    reason:
      'PANEL_NAVLIB drives a 3Dconnexion device through their desktop driver. No browser API reaches it.',
  },
  {
    label: 'Version Control',
    reason:
      'PANEL_GIT_REPOS manages on-disk git remotes for local libraries; we have no local disk.',
  },
  {
    label: 'Symbol Editor',
    reason:
      'Unfinished, not impossible: we ship the editor, and its five sub-pages are the shared ' +
      'grid/colour/toolbar/GAL panels bound to the symbol editor settings. Tracker 195.',
  },
  {
    label: 'Footprint Editor',
    reason:
      'Unfinished, not impossible: we ship the editor. Nine sub-pages, of which Footprint ' +
      'Defaults, Graphics Defaults and User Layer Names are genuinely new. Tracker 200.',
  },
  {
    label: '3D Viewer',
    reason:
      'Unfinished: we ship the viewer as a child frame. General and Toolbars are portable; ' +
      'Realtime Renderer and Raytracing Renderer describe an OpenGL/raytracer we do not have.',
  },
  {
    label: 'Gerber Viewer',
    reason: 'Unfinished, not impossible: we ship gerbview. Five sub-pages. Tracker 195.',
  },
  {
    label: 'Packages and Updates',
    reason:
      'PANEL_PACKAGES_AND_UPDATES configures the Plugin and Content Manager, which installs ' +
      'to the user profile on disk. Nothing to configure here.',
  },
  {
    label: 'Plugins',
    reason:
      'PANEL_PLUGIN_SETTINGS configures the IPC API for external Python plugins ' +
      '(`#ifdef KICAD_IPC_API`). No out-of-process plugins in the browser.',
  },
  {
    label: 'Maintenance',
    reason:
      'PANEL_MAINTENANCE clears the on-disk 3D-model and library caches. Ours are the ' +
      "browser's, and it owns their eviction.",
  },
];

/**
 * Pages of {@link UPSTREAM_BOOK} this port does not ship.
 *
 * Every one of these is a row a user comparing the two dialogs side by side
 * will notice is absent. Naming it here is the difference between a decision
 * and an oversight.
 */
export const OMITTED_PAGES: Readonly<Record<string, readonly DeclaredPage[]>> = {
  'Schematic Editor': [
    { label: 'Data Sources', reason: 'Schematic Editor tracker 195.' },
    { label: 'Simulator', reason: 'No ngspice in the browser; tracker 195.' },
  ],
  'PCB Editor': [
    { label: 'Grids', reason: 'PCB Editor tracker 200.' },
    { label: 'Origins & Axes', reason: 'PCB Editor tracker 200.' },
    { label: 'Editing Options', reason: 'PCB Editor tracker 200.' },
    { label: 'Colors', reason: 'PCB Editor tracker 200.' },
    {
      label: 'Plugins',
      reason:
        'PANEL_PCBNEW_ACTION_PLUGINS lists Python action plugins, which have no browser form.',
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

/**
 * The top-level rows we actually draw, in tree order — every heading plus every
 * un-indented page. Derived from {@link PAGES} rather than listed again, so it
 * cannot drift from the book it describes.
 */
export function shippedTopLevel(): string[] {
  return PAGES.filter((p) => p.id === null || !p.indent).map((p) => p.label);
}
