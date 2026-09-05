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
  { id: 'sym-colors', label: 'Colors', indent: true, owner: 'symbol' },
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
  // pcbnew's KIFACE adds THREE headings, in this order
  // (`common/eda_base_frame.cpp:1657-1697`): the Footprint Editor's nine
  // sub-pages, the PCB Editor's seven, then the 3D Viewer's four. The first and
  // the third were missing here entirely, which is why those two frames drew
  // their toolbars from a module constant with no page to change it.
  //
  // Only the Toolbars row of each is listed: the rest of both headings is the
  // same tree gap the PCB Editor's own heading has (Origins & Axes, Editing
  // Options and Colors are not built yet), not a decision about these frames.
  { id: null, label: 'Footprint Editor' },
  { id: 'fp-toolbars', label: 'Toolbars', indent: true, owner: 'footprint' },
  { id: null, label: 'PCB Editor' },
  { id: 'pcb-display', label: 'Display Options', indent: true, owner: 'pcb' },
  { id: 'pcb-grids', label: 'Grids', indent: true, owner: 'pcb' },
  { id: 'pcb-toolbars', label: 'Toolbars', indent: true, owner: 'pcb' },
  { id: null, label: '3D Viewer' },
  { id: '3dv-toolbars', label: 'Toolbars', indent: true, owner: 'pcb' },
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
  { id: 'gbr-grids', label: 'Grids', indent: true, owner: 'gerbview' },
  { id: 'gbr-excellon', label: 'Excellon Options', indent: true, owner: 'gerbview' },
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
  // `common/eda_base_frame.cpp:1666-1676`, the nine `AddLazySubPage` calls
  // under the Footprint Editor heading, in source order.
  'Footprint Editor': [
    'Display Options',
    'Grids',
    'Origins & Axes',
    'Editing Options',
    'Colors',
    'Toolbars',
    'Footprint Defaults',
    'Graphics Defaults',
    'User Layer Names',
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
  // `common/eda_base_frame.cpp:1692-1696`. The 3D Viewer's first row is called
  // "General", not "Display Options".
  '3D Viewer': ['General', 'Toolbars', 'Realtime Renderer', 'Raytracing Renderer'],
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
 * Both remaining entries were built and then taken out again, which is the
 * useful part of them: a page whose every control is a desktop concept has nothing
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
];

/**
 * Pages of {@link UPSTREAM_BOOK} this port does not ship.
 *
 * Every one of these is a row a user comparing the two dialogs side by side
 * will notice is absent. Naming it here is the difference between a decision
 * and an oversight.
 */
export const OMITTED_PAGES: Readonly<Record<string, readonly DeclaredPage[]>> = {
  // The Gerber Viewer heading has NO entry: all five of its pages ship. It
  // came closest to needing one on Excellon Options, which is the page most
  // likely to have been a directory or a helper application — and turned out
  // to be six file-format controls and no path at all.
  // Both of this heading's absences are now shipped: Data Sources reads the
  // Plugin and Content Manager we already have, and Simulator is drawn with
  // every control greyed, because a simulator is a thing this port can have
  // and has not built — which is the "not implemented" case, not the
  // "meaningless in a browser" one. Annotation Options is not listed as
  // omitted because upstream does not have it here either; it is a Schematic
  // Setup page, which is where ours lives.
  'Schematic Editor': [],
  // Both were the whole heading until the Toolbars page shipped. Every
  // remaining row is a page nobody has built, not one that cannot exist:
  // `PANEL_FP_EDIT_GRIDS` is `PANEL_GRID_SETTINGS` and every Display Options
  // page wraps `PANEL_GAL_OPTIONS`, both of which this port already has.
  'Footprint Editor': [
    { label: 'Display Options', reason: 'Footprint Editor tracker 200.' },
    { label: 'Grids', reason: 'Footprint Editor tracker 200.' },
    { label: 'Origins & Axes', reason: 'Footprint Editor tracker 200.' },
    { label: 'Editing Options', reason: 'Footprint Editor tracker 200.' },
    { label: 'Colors', reason: 'Footprint Editor tracker 200.' },
    { label: 'Footprint Defaults', reason: 'Footprint Editor tracker 200.' },
    { label: 'Graphics Defaults', reason: 'Footprint Editor tracker 200.' },
    { label: 'User Layer Names', reason: 'Footprint Editor tracker 200.' },
  ],
  '3D Viewer': [
    { label: 'General', reason: '3D Viewer tracker 200.' },
    {
      label: 'Realtime Renderer',
      reason:
        "PANEL_3D_OPENGL_OPTIONS configures KiCad's own OpenGL renderer — its " +
        'anti-aliasing mode, its copper thickness and its highlight animation. Ours is a ' +
        'three.js scene with none of those knobs.',
    },
    {
      label: 'Raytracing Renderer',
      reason: 'PANEL_3D_RAYTRACING_OPTIONS configures a raytracer this port does not have.',
    },
  ],
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
