// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Preferences book: the same pages, in the same order, with the same
 * labels, as before the dialog was split into a shell plus a registry.
 *
 * Upstream the book is an explicit run of `AddPage` / `AddLazySubPage` calls in
 * `EDA_BASE_FRAME::ShowPreferences` (`common/eda_base_frame.cpp:1573-1755`), so
 * the order is source order and a page cannot go missing without deleting a
 * line. Ours used to be a `PAGES` array next to a `switch (page)` in the one
 * file that rendered them; now the array is `dialogs/prefs/registry.ts` and the
 * panels live in three different modules that the registry reaches by id.
 *
 * That is exactly the shape in which a page can be dropped, renamed or
 * reordered by accident, and nothing else would fail. The expected list below
 * is transcribed from `designer/src/prefs/PreferencesDialog.tsx` as it stood at
 * 5d6a2f40, the commit this refactor started from.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  EXTRA_PAGES,
  FIRST_PAGE,
  OMITTED_PAGES,
  OMITTED_TOP_LEVEL,
  PAGES,
  UPSTREAM_BOOK,
  UPSTREAM_TOP_LEVEL,
  shippedTopLevel,
  labelOf,
  ownerOf,
  shippedUnder,
  type PrefsPageEntry,
} from '@ziroeda/designer/src/dialogs/prefs/registry.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/**
 * The book as the dialog rendered it before the split. Headings are `id: null`
 * — upstream's `AddPage( new wxPanel( book ), … )`, a tree node with no panel.
 */
const EXPECTED: PrefsPageEntry[] = [
  { id: 'common', label: 'Common', owner: 'generic' },
  { id: 'mouse', label: 'Mouse and Touchpad', owner: 'generic' },
  // Upstream inside `#if defined(__linux__) || defined(__FreeBSD__)`
  // (`common/eda_base_frame.cpp:1590-1596`). Linux is the parity target.
  { id: 'spacemouse', label: 'SpaceMouse', owner: 'generic' },
  { id: 'hotkeys', label: 'Hotkeys', owner: 'generic' },
  { id: 'version-control', label: 'Version Control', owner: 'generic' },
  // eeschema's KIFACE adds two headings, and the Symbol Editor's five
  // sub-pages come first (`common/eda_base_frame.cpp:1632-1637`). Grids and
  // Toolbars are shipped; the other three are declared in OMITTED_PAGES until
  // they land.
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
  // pcbnew's KIFACE adds THREE headings, not one
  // (`common/eda_base_frame.cpp:1657-1697`): the Footprint Editor's, the PCB
  // Editor's and the 3D Viewer's, in that order. The first and the third had no
  // rows here at all, which is why those two frames had no Toolbars page and
  // drew their bars from a module constant.
  //
  // The Footprint Editor's heading is COMPLETE — all nine of the rows
  // `common/eda_base_frame.cpp:1667-1675` adds, in that order. Five of them are
  // classes upstream shares between the two pcbnew frames (`PANEL_GAL_OPTIONS`,
  // `PANEL_GRID_SETTINGS`, `PANEL_PCBNEW_DISPLAY_ORIGIN`, `PANEL_EDIT_OPTIONS`,
  // `PANEL_COLOR_SETTINGS`), one is `PANEL_TOOLBAR_CUSTOMIZATION`, and three
  // are this editor's own. The 3D Viewer still shows only its Toolbars row.
  { id: null, label: 'Footprint Editor' },
  { id: 'fp-display', label: 'Display Options', indent: true, owner: 'footprint' },
  { id: 'fp-grids', label: 'Grids', indent: true, owner: 'footprint' },
  { id: 'fp-origins', label: 'Origins & Axes', indent: true, owner: 'footprint' },
  { id: 'fp-editing', label: 'Editing Options', indent: true, owner: 'footprint' },
  { id: 'fp-colors', label: 'Colors', indent: true, owner: 'footprint' },
  { id: 'fp-toolbars', label: 'Toolbars', indent: true, owner: 'footprint' },
  { id: 'fp-defaults', label: 'Footprint Defaults', indent: true, owner: 'footprint' },
  { id: 'fp-graphics', label: 'Graphics Defaults', indent: true, owner: 'footprint' },
  { id: 'fp-userlayers', label: 'User Layer Names', indent: true, owner: 'footprint' },
  { id: null, label: 'PCB Editor' },
  { id: 'pcb-display', label: 'Display Options', indent: true, owner: 'pcb' },
  { id: 'pcb-grids', label: 'Grids', indent: true, owner: 'pcb' },
  { id: 'pcb-toolbars', label: 'Toolbars', indent: true, owner: 'pcb' },
  { id: null, label: '3D Viewer' },
  { id: '3dv-toolbars', label: 'Toolbars', indent: true, owner: 'pcb' },
  // gerbview's KIFACE is consulted after pcbnew's
  // (`common/eda_base_frame.cpp:1702-1721`), and its sub-page order is
  // `ShowPreferences`' — Display Options, Colors, Toolbars, Grids, Excellon
  // Options — which is NOT gerbview.cpp's `PANEL_GBR_*` switch order and is
  // the one heading here where Grids does not come second.
  { id: null, label: 'Gerber Viewer' },
  { id: 'gbr-display', label: 'Display Options', indent: true, owner: 'gerbview' },
  { id: 'gbr-colors', label: 'Colors', indent: true, owner: 'gerbview' },
  { id: 'gbr-toolbars', label: 'Toolbars', indent: true, owner: 'gerbview' },
  { id: 'gbr-grids', label: 'Grids', indent: true, owner: 'gerbview' },
  { id: 'gbr-excellon', label: 'Excellon Options', indent: true, owner: 'gerbview' },
  // pl_editor's KIFACE is consulted last of the five
  // (`common/eda_base_frame.cpp:1726-1737`), so its heading is last.
  { id: null, label: 'Drawing Sheet Editor' },
  { id: 'ds-display', label: 'Display Options', indent: true, owner: 'drawingsheet' },
  { id: 'ds-grids', label: 'Grids', indent: true, owner: 'drawingsheet' },
  { id: 'ds-colors', label: 'Colors', indent: true, owner: 'drawingsheet' },
  { id: 'ds-toolbars', label: 'Toolbars', indent: true, owner: 'drawingsheet' },
  // The tail: a TOP-LEVEL page after the last KIFACE's heading, added with
  // `AddPage` rather than `AddLazySubPage`. It is not the Drawing Sheet
  // Editor's, and `indent` is what says so — grouping by position put it
  // inside. Upstream there are three; Packages and Updates and Plugins were
  // built and then removed, since every control on either is a desktop concept
  // (see OMITTED_TOP_LEVEL). Maintenance stayed because it edits the settings
  // store, which we have.
  { id: 'maintenance', label: 'Maintenance', owner: 'generic' },
];

describe('the Preferences page book', () => {
  it('is the same pages in the same order with the same labels', () => {
    expect(PAGES).toEqual(EXPECTED);
  });

  // toEqual on the whole array reports "arrays differ"; these two say which
  // page and how, so a reorder is not mistaken for a rename.
  it('has the ids in the order the dialog rendered them', () => {
    expect(PAGES.map((p) => p.id)).toEqual(EXPECTED.map((p) => p.id));
  });

  it('has the labels the dialog rendered them under', () => {
    expect(PAGES.map((p) => p.label)).toEqual(EXPECTED.map((p) => p.label));
  });

  it('opens on the first selectable page', () => {
    expect(FIRST_PAGE).toBe(PAGES.find((p) => p.id !== null)?.id);
  });

  it('has no duplicate ids', () => {
    const ids = PAGES.map((p) => p.id).filter((id) => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every page an owner, and no heading one', () => {
    for (const p of PAGES) {
      if (p.id === null) expect(p.owner, p.label).toBeUndefined();
      else expect(ownerOf(p.id), p.id).toBeDefined();
    }
  });

  it('resolves a label for every page id', () => {
    for (const p of PAGES) if (p.id !== null) expect(labelOf(p.id)).toBe(p.label);
  });
});

/**
 * The other half of the same invariant, from the panels' side: dropping a page
 * from `PAGES` *and* from the expected list above would still leave the panel
 * behind, and adding one to `PAGES` without a `case` for it would throw only
 * when a user clicked it. Each owning module's `CreateKiWindow` switch must
 * construct exactly the ids the registry assigns to it.
 */
const OWNER_SOURCES: Record<string, string> = {
  generic: 'dialogs/prefs/panels/index.ts',
  symbol: 'editors/symbol/prefs/index.ts',
  schematic: 'editors/schematic/prefs/index.ts',
  // Upstream these come out of pcbnew's KIFACE with the board editor's; here
  // the Footprint Editor is its own bundle, so it is its own factory.
  footprint: 'editors/footprint/prefs/index.ts',
  pcb: 'editors/pcb/prefs/index.ts',
  gerbview: 'editors/gerbview/prefs/index.ts',
  drawingsheet: 'editors/drawingsheet/prefs/index.ts',
};

describe('every page id is constructed by its owner', () => {
  it.each(Object.entries(OWNER_SOURCES))('%s constructs exactly its own ids', (owner, rel) => {
    const src = read(rel);
    const cases = [...src.matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]).sort();
    const mine = PAGES.filter((p) => p.owner === owner)
      .map((p) => p.id as string)
      .sort();
    expect(cases).toEqual(mine);
  });

  it('leaves no page id unowned by any factory', () => {
    const constructed = new Set(
      Object.values(OWNER_SOURCES).flatMap((rel) =>
        [...read(rel).matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1] as string),
      ),
    );
    for (const p of PAGES) if (p.id !== null) expect(constructed.has(p.id), p.id).toBe(true);
  });
});

/**
 * The book against KiCad's, heading by heading.
 *
 * Everything above this point compares `PAGES` with a transcript of `PAGES`.
 * That catches a reorder and a rename and nothing else: a page upstream has and
 * we never built is identical, to such a test, to a page that does not exist.
 * The Drawing Sheet Editor shipped as "complete" with its whole heading missing
 * for exactly that reason.
 *
 * So this compares against the C++ instead. `UPSTREAM_BOOK` is transcribed from
 * `EDA_BASE_FRAME::ShowPreferences`' `AddLazySubPage` runs
 * (`common/eda_base_frame.cpp:1644-1652`, `:1684-1691`, `:1733-1737`), and the
 * rule is per heading: what we ship, plus what we have *declared* absent, must
 * be that list — in that order — with nothing shipped that upstream has not got
 * unless that too is declared.
 *
 * Per heading and not in aggregate, because "right in pl_editor, wrong in
 * eeschema" is the shape of bug this codebase produces most.
 */
describe('each editor heading against KiCad’s own list', () => {
  const HEADINGS = Object.keys(UPSTREAM_BOOK);

  it('covers every heading the tree actually shows', () => {
    const shown = PAGES.filter((p) => p.id === null).map((p) => p.label);
    expect(shown.sort()).toEqual([...HEADINGS].sort());
  });

  it.each(HEADINGS)('%s: shipped + declared-absent is upstream’s list, in order', (heading) => {
    const upstream = UPSTREAM_BOOK[heading] as readonly string[];
    const shipped = shippedUnder(heading);
    const omitted = (OMITTED_PAGES[heading] ?? []).map((p) => p.label);
    const extra = (EXTRA_PAGES[heading] ?? []).map((p) => p.label);

    // Nothing invented: every row we show is either upstream's or declared.
    for (const label of shipped)
      expect(upstream.concat(extra), `${heading} > ${label}`).toContain(label);

    // Nothing lost: upstream's list is exactly the shipped rows plus the
    // declared-absent ones, and the shipped ones keep upstream's order.
    const accounted = upstream.filter(
      (label) => shipped.includes(label) || omitted.includes(label),
    );
    expect(accounted).toEqual([...upstream]);
    expect(shipped.filter((l) => !extra.includes(l))).toEqual(
      upstream.filter((l) => !omitted.includes(l)),
    );
  });

  it('the Drawing Sheet Editor has the four pages pl_editor’s KIFACE registers', () => {
    // `pagelayout_editor/pl_editor.cpp:68, 71, 82, 85` — PANEL_DS_DISPLAY_OPTIONS,
    // PANEL_DS_GRIDS, PANEL_DS_COLORS, PANEL_DS_TOOLBARS — and the labels are
    // `eda_base_frame.cpp:1734-1737`. Read off a running pl_editor as well.
    expect(UPSTREAM_BOOK['Drawing Sheet Editor']).toEqual([
      'Display Options',
      'Grids',
      'Colors',
      'Toolbars',
    ]);
    expect(shippedUnder('Drawing Sheet Editor')).toEqual([
      'Display Options',
      'Grids',
      'Colors',
      'Toolbars',
    ]);
  });

  it('gives every heading upstream registers a Toolbars page one', () => {
    // `PANEL_SYM_TOOLBARS`, `PANEL_SCH_TOOLBARS`, `PANEL_FP_TOOLBARS`,
    // `PANEL_PCB_TOOLBARS`, `PANEL_3DV_TOOLBARS`, `PANEL_GBR_TOOLBARS`,
    // `PANEL_DS_TOOLBARS` — seven frames (`common/eda_base_frame.cpp:1637`,
    // `:1647`, `:1672`, `:1686`, `:1694`, `:1715`, `:1737`), all of them one
    // `PANEL_TOOLBAR_CUSTOMIZATION`. Four of those headings do not exist here
    // at all, so this is per heading over the ones that do: "right in
    // pl_editor, wrong in eeschema" is what it is here to stop.
    for (const [heading, upstream] of Object.entries(UPSTREAM_BOOK)) {
      if (!upstream.includes('Toolbars')) continue;
      expect(shippedUnder(heading), `${heading} > Toolbars`).toContain('Toolbars');
      expect(
        (OMITTED_PAGES[heading] ?? []).map((p) => p.label),
        heading,
      ).not.toContain('Toolbars');
    }
  });

  it('states a reason for every declared page, and declares no page twice', () => {
    for (const table of [OMITTED_PAGES, EXTRA_PAGES]) {
      for (const [heading, rows] of Object.entries(table)) {
        const labels = rows.map((r) => r.label);
        expect(new Set(labels).size, heading).toBe(labels.length);
        for (const row of rows)
          expect(row.reason.length, `${heading} > ${row.label}`).toBeGreaterThan(20);
      }
    }
  });

  it('declares absent only pages upstream actually has', () => {
    // A reason attached to a row KiCad does not have would read as diligence
    // and mean nothing.
    for (const [heading, rows] of Object.entries(OMITTED_PAGES))
      for (const row of rows)
        expect(UPSTREAM_BOOK[heading], `${heading} > ${row.label}`).toContain(row.label);
  });

  it('declares extra only pages upstream does not have', () => {
    for (const [heading, rows] of Object.entries(EXTRA_PAGES))
      for (const row of rows)
        expect(UPSTREAM_BOOK[heading], `${heading} > ${row.label}`).not.toContain(row.label);
  });
});

/**
 * The same idea one level up, and the level that actually shows: at most one
 * section is expanded when Preferences opens, so the top-level rows ARE the
 * tree the user is looking at. Fifteen upstream, six here.
 *
 * `UPSTREAM_BOOK` is keyed by heading and so cannot describe a heading that is
 * absent altogether — an entry that is not there has nothing to be missing
 * from. Four of KiCad's headings were in exactly that blind spot, for editors
 * we ship: Symbol Editor, Footprint Editor, 3D Viewer, Gerber Viewer. The
 * registry's own doc named them and no test could see them.
 */
describe('the top-level tree', () => {
  it("is upstream's list, once the declared omissions are put back", () => {
    const restored = [...shippedTopLevel(), ...OMITTED_TOP_LEVEL.map((r) => r.label)];
    // Order is not asserted here because the omissions are declared in
    // upstream order rather than interleaved into ours; the set is.
    expect([...restored].sort()).toStrictEqual([...UPSTREAM_TOP_LEVEL].sort());
  });

  it("keeps the rows it does ship in upstream's relative order", () => {
    const shipped = shippedTopLevel();
    const upstreamOrder = UPSTREAM_TOP_LEVEL.filter((l) => shipped.includes(l));
    expect(shipped).toStrictEqual(upstreamOrder);
  });

  it('omits nothing upstream does not have, and nothing twice', () => {
    const labels = OMITTED_TOP_LEVEL.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const row of OMITTED_TOP_LEVEL) {
      expect(UPSTREAM_TOP_LEVEL, row.label).toContain(row.label);
      // A row we actually draw must not also be declared absent.
      expect(shippedTopLevel(), row.label).not.toContain(row.label);
      expect(row.reason.length, row.label).toBeGreaterThan(20);
    }
  });

  it('has not quietly gained a row KiCad does not show', () => {
    for (const label of shippedTopLevel()) expect(UPSTREAM_TOP_LEVEL).toContain(label);
  });
});
