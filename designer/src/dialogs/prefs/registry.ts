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
  // `#if defined(__linux__) || defined(__FreeBSD__)` (:1590). Linux is the
  // parity target, so the row is here.
  { id: 'spacemouse', label: 'SpaceMouse', owner: 'generic' },
  { id: 'hotkeys', label: 'Hotkeys', owner: 'generic' },
  { id: 'version-control', label: 'Version Control', owner: 'generic' },
  // eeschema's KIFACE is consulted first, and it adds TWO headings: the Symbol
  // Editor's five sub-pages (`common/eda_base_frame.cpp:1632-1637`) come before
  // the Schematic Editor's (`:1641-1652`).
  { id: null, label: 'Symbol Editor' },
  { id: 'sym-display', label: 'Display Options', indent: true, owner: 'symbol' },
  { id: 'sym-grids', label: 'Grids', indent: true, owner: 'symbol' },
  { id: 'sym-editing', label: 'Editing Options', indent: true, owner: 'symbol' },
  { id: 'sym-toolbars', label: 'Toolbars', indent: true, owner: 'symbol' },
  { id: null, label: 'Schematic Editor' },
  { id: 'sch-display', label: 'Display Options', indent: true, owner: 'schematic' },
  { id: 'sch-grids', label: 'Grids', indent: true, owner: 'schematic' },
  { id: 'sch-editing', label: 'Editing Options', indent: true, owner: 'schematic' },
  { id: 'sch-colors', label: 'Colors', indent: true, owner: 'schematic' },
  { id: 'sch-toolbars', label: 'Toolbars', indent: true, owner: 'schematic' },
  { id: 'sch-fields', label: 'Field Name Templates', indent: true, owner: 'schematic' },
  { id: 'sch-datasources', label: 'Data Sources', indent: true, owner: 'schematic' },
  { id: 'sch-simulator', label: 'Simulator', indent: true, owner: 'schematic' },
  { id: null, label: 'PCB Editor' },
  { id: 'pcb-display', label: 'Display Options', indent: true, owner: 'pcb' },
  { id: 'pcb-grids', label: 'Grids', indent: true, owner: 'pcb' },
  { id: 'pcb-toolbars', label: 'Toolbars', indent: true, owner: 'pcb' },
  // gerbview's KIFACE is consulted after pcbnew's and before pl_editor's
  // (`common/eda_base_frame.cpp:1702-1721`).
  //
  // **This order is `ShowPreferences`', not `gerbview.cpp`'s.** The obvious
  // place to read the list off is gerbview's own `CreateKiWindow` switch, and
  // it is the wrong one: that switch is in `PANEL_GBR_*` enum order (display,
  // excellon, grids, colors, toolbars, `gerbview/gerbview.cpp:76-110`) and
  // nothing reads it as a sequence. The tree is built by the run of
  // `AddLazySubPage` calls at `eda_base_frame.cpp:1714-1718`, and that run puts
  // Colors and Toolbars *before* Grids — which is also unlike every other
  // editor's heading here, where Grids comes second.
  { id: null, label: 'Gerber Viewer' },
  { id: 'gbr-display', label: 'Display Options', indent: true, owner: 'gerbview' },
  { id: 'gbr-colors', label: 'Colors', indent: true, owner: 'gerbview' },
  { id: 'gbr-toolbars', label: 'Toolbars', indent: true, owner: 'gerbview' },
  // pl_editor's KIFACE is added last of the five, after gerbview's
  // (`common/eda_base_frame.cpp:1726-1737`).
  { id: null, label: 'Drawing Sheet Editor' },
  { id: 'ds-display', label: 'Display Options', indent: true, owner: 'drawingsheet' },
  { id: 'ds-grids', label: 'Grids', indent: true, owner: 'drawingsheet' },
  { id: 'ds-colors', label: 'Colors', indent: true, owner: 'drawingsheet' },
  { id: 'ds-toolbars', label: 'Toolbars', indent: true, owner: 'drawingsheet' },
  // The tail of the book, after the last KIFACE's heading: `AddLazyPage(
  // PANEL_PACKAGES_AND_UPDATES )` closes the try block, then `AddPage(
  // PANEL_PLUGIN_SETTINGS )` under `#ifdef KICAD_IPC_API` and `AddPage(
  // PANEL_MAINTENANCE )`. All three are top-level, not sub-pages.
  { id: 'maintenance', label: 'Maintenance', owner: 'generic' },
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
  // `common/eda_base_frame.cpp:1633-1637`, the five `AddLazySubPage` calls
  // under the Symbol Editor heading, in source order.
  'Symbol Editor': ['Display Options', 'Grids', 'Editing Options', 'Colors', 'Toolbars'],
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
  // `common/eda_base_frame.cpp:1714-1718`. Colors and Toolbars come BEFORE
  // Grids here, which no other heading does; see the note in {@link PAGES}.
  'Gerber Viewer': ['Display Options', 'Colors', 'Toolbars', 'Grids', 'Excellon Options'],
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
 * Fifteen rows. We ship ten. The five we do not are in
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
 * The top-level rows of {@link UPSTREAM_TOP_LEVEL} this port does not draw, and
 * why.
 *
 * Two are headings for editors we DO ship — Footprint Editor, 3D Viewer — so
 * those two are unfinished rather than impossible.
 * Upstream their sub-pages are mostly the shared widgets we already have:
 * `PANEL_FP_EDIT_GRIDS` and `PANEL_GBR_GRIDS` are both `PANEL_GRID_SETTINGS`,
 * every Toolbars page is `PANEL_TOOLBAR_CUSTOMIZATION`, and every Display
 * Options page wraps `PANEL_GAL_OPTIONS`. So they are bindings to a settings
 * store, not new panels — which is what the Symbol Editor and Gerber Viewer
 * headings, two of the four until they shipped, turned out to be.
 *
 * The other two were built and then taken out again, which is the useful part
 * of their entries: a page whose every control is a desktop concept has nothing
 * to show once the controls are disabled, and a row that exists only to explain
 * its own emptiness is worse than an absent row. Maintenance stayed and is
 * live, because it manipulates the settings store rather than a device, a path
 * or a socket. SpaceMouse and Version Control are still drawn — they are
 * equally un-portable and should probably follow, but that is Akshay's call
 * and he named these two.
 */
export const OMITTED_TOP_LEVEL: readonly DeclaredPage[] = [
  {
    label: 'Packages and Updates',
    reason:
      'Built, then removed. Every control on it is about the desktop: whether to check for a ' +
      'KiCad release, and how the PCM writes installed libraries into the global library table ' +
      'on disk. A web app updates when the page reloads and has no library table to write. ' +
      'A row that only explains why it is empty is worse than no row.',
  },
  {
    label: 'Plugins',
    reason:
      'Built, then removed. PANEL_PLUGIN_SETTINGS enables a local IPC socket for other programs ' +
      'on the same machine and points at a native Python interpreter. A browser tab has neither, ' +
      'and there is no partial version of "let other software on this computer connect".',
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
];

/**
 * Pages of {@link UPSTREAM_BOOK} this port does not ship.
 *
 * Every one of these is a row a user comparing the two dialogs side by side
 * will notice is absent. Naming it here is the difference between a decision
 * and an oversight.
 */
export const OMITTED_PAGES: Readonly<Record<string, readonly DeclaredPage[]>> = {
  // In progress, one page per commit. Grids landed first because it is the
  // purest binding — the shared `PANEL_GRID_SETTINGS` with
  // `FRAME_SCH_SYMBOL_EDITOR` and this editor's settings object — and Toolbars
  // with it, because `prefs_page_book.test.ts` requires every heading upstream
  // gives a Toolbars page to have one here. The other three are the same shape.
  'Symbol Editor': [
    {
      label: 'Colors',
      reason:
        'Being built. PANEL_SYM_COLOR_SETTINGS is two radio buttons and a theme choice — a plain ' +
        'wxPanel, not a PANEL_COLOR_SETTINGS.',
    },
  ],
  // In progress, one page per commit, same as the Symbol Editor above. Display
  // Options landed first because it is the page that forced `gerbview.json`
  // into existence; Toolbars came with it because `prefs_page_book.test.ts`
  // requires every heading upstream gives a Toolbars page to have one here.
  'Gerber Viewer': [
    {
      label: 'Grids',
      reason:
        'Being built. The shared PANEL_GRID_SETTINGS with FRAME_GERBER, which hides the whole ' +
        'Grid Overrides group (panel_grid_settings.cpp:62-90).',
    },
    {
      label: 'Excellon Options',
      reason:
        'Being built. PANEL_GERBVIEW_EXCELLON_SETTINGS is entirely file-format defaults — units, ' +
        'zero format, integer/mantissa digit counts — with no path control on it, so it ports whole.',
    },
  ],
  // Both of this heading's absences are now shipped: Data Sources reads the
  // Plugin and Content Manager we already have, and Simulator is drawn with
  // every control greyed, because a simulator is a thing this port can have
  // and has not built — which is the "not implemented" case, not the
  // "meaningless in a browser" one. Annotation Options is not listed as
  // omitted because upstream does not have it here either; it is a Schematic
  // Setup page, which is where ours lives.
  'Schematic Editor': [],
  'PCB Editor': [
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
 * EMPTY, and that is the point. The one entry was "Annotation Options", and it
 * is gone: `PANEL_EESCHEMA_ANNOTATION_OPTIONS` is a page of
 * DIALOG_SCHEMATIC_SETUP (`eeschema/dialogs/dialog_schematic_setup.cpp:66-71`),
 * never of Preferences, and it writes `SCHEMATIC_SETTINGS` — the PROJECT's
 * annotation fields (`panel_eeschema_annotation_options.cpp:103-129`), which
 * our Schematic Setup > Annotation page already edits and
 * `project_settings.ts:242` already round-trips. The Preferences copy was a
 * second set of controls over `eeschema.annotation.*`, an app-settings slice
 * upstream's panel never touches.
 *
 * A row here is a known defect rather than a choice: a reason is not a
 * justification, it is a pointer.
 */
export const EXTRA_PAGES: Readonly<Record<string, readonly DeclaredPage[]>> = {};

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
    // The next heading ends the run -- and so does a top-level page, which is
    // what `AddPage` rather than `AddLazySubPage` means. Stopping only at a
    // heading swept the book's tail (Packages and Updates, Plugins,
    // Maintenance) into the Drawing Sheet Editor, the last heading before it.
    if (p.id === null || p.indent !== true) break;
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
