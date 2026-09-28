// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Search pane's row selection, now behind `SchSearchHandler`
 * (`eeschema/widgets/search_handlers.ts`) rather than inline in
 * `SearchPanel.tsx` — the panel became a thin consumer of
 * `common/widgets/search_pane.tsx`, so what used to be pinned as literal
 * source strings is exercised here instead.
 *
 * Upstream is one-directional: `SEARCH_PANE_LISTVIEW` owns its selection —
 * `OnItemSelected` sets `m_selectionDirty` and `OnUpdateUI` pushes the rows
 * *out* through `m_handler->SelectItems()` — and nothing in `search_pane.cpp`,
 * `search_pane_tab.cpp` or `sch_edit_frame.cpp` pushes a canvas selection back
 * in. So in KiCad, picking a symbol on the sheet leaves its row unhighlighted.
 *
 * **We deliberately go further**: `isRowSelected` is driven by the editor's
 * selection set, so the row and the symbol agree whichever one you clicked.
 * That is a superset, decided on 2026-08-09 after the one-directional version
 * shipped and read as a bug. It is pinned here so it is not "fixed" back by
 * someone reading the upstream source and finding ours does more.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import {
  makeSchSearchHandlers,
  type SchSearchWiring,
} from '@ziroeda/eeschema/widgets/search_handlers.js';
import { COMMON_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/types.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const EDITOR = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');

const SCH = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1"
        (rectangle (start -1.02 2.54) (end 1.02 -2.54)
          (stroke (width 0.254) (type default)) (fill (type none))))))
  (symbol (lib_id "Device:R") (at 40 40 0) (unit 1) (uuid "r-one")
    (property "Reference" "R1" (at 42 39 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 42 41 0) (effects (font (size 1.27 1.27)))))
  (symbol (lib_id "Device:R") (at 60 40 0) (unit 1) (uuid "r-two")
    (property "Reference" "R2" (at 62 39 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1k" (at 62 41 0) (effects (font (size 1.27 1.27))))))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const libs = (d: Schematic): Map<string, LibSymbol> =>
  new Map(d.libSymbols.map((l) => [l.libId, l]));
const fmt = (iu: number): string => String(iu);

/** A `symbol` tab handler with an empty query already searched. */
function symbolHandler(wiring: { current: SchSearchWiring }) {
  const d = doc();
  const [h] = makeSchSearchHandlers(d, libs(d), fmt, true, wiring);
  h!.search('R'); // both R1 and R2 match
  return h!;
}

describe('the Search pane row highlight', () => {
  it('follows the live selection, not a click this handler made itself', () => {
    const wiring: { current: SchSearchWiring } = {
      current: { selectionZoom: 'none', onSelect: () => {}, selection: new Set(['r-two']) },
    };
    const h = symbolHandler(wiring);
    // Whichever row is R2 lights up, R1 does not — and NEITHER was ever
    // pushed out through SelectItems, so this cannot be a click echo.
    const rows = [0, 1].map((r) => h.getResultCell(r, 0));
    const r2Row = rows.indexOf('R2');
    const r1Row = rows.indexOf('R1');
    expect(h.isRowSelected?.(r2Row)).toBe(true);
    expect(h.isRowSelected?.(r1Row)).toBe(false);
  });

  it('still pushes the pick out, as OnUpdateUI does', () => {
    let selected: string | null = null;
    const wiring: { current: SchSearchWiring } = {
      current: { selectionZoom: 'none', onSelect: (id) => (selected = id) },
    };
    const h = symbolHandler(wiring);
    h.selectItems?.([0]);
    expect(selected).toBe(h.getResultCell(0, 0) === 'R1' ? 'r-one' : 'r-two');
  });

  it('clears the selection when given no rows, as an empty wxListCtrl pick does', () => {
    let cleared = false;
    const wiring: { current: SchSearchWiring } = {
      current: {
        selectionZoom: 'none',
        onSelect: () => {},
        onClearSelection: () => (cleared = true),
      },
    };
    const h = symbolHandler(wiring);
    h.selectItems?.([]);
    expect(cleared).toBe(true);
  });

  it('is mounted with the editor selection and a clear callback', () => {
    const at = EDITOR.indexOf('<SearchPanel');
    const usage = EDITOR.slice(at, EDITOR.indexOf('/>', at));
    expect(usage).toMatch(/selection=\{selection\}/);
    expect(usage).toContain('onClearSelection=');
  });
});

/**
 * Picking a row moves the view. `SCH_SEARCH_HANDLER::SelectItems` selects the
 * hits and then runs `ACTIONS::centerSelection` or `ACTIONS::zoomFitSelection`
 * according to `APP_SETTINGS_BASE::SEARCH_PANE::selection_zoom`, whose default
 * is PAN — so a *single* click centres the sheet on the hit.
 */
describe('picking a row moves the view', () => {
  it('defaults to pan, as app_settings.cpp does', () => {
    expect(COMMON_DEFAULTS.search_pane.selection_zoom).toBe('pan');
  });

  it('routes to centre for pan, zoom-fit for zoom, and neither for none', () => {
    let zoomed = 0;
    let centered = 0;
    const base = {
      onSelect: () => {},
      onCenter: () => centered++,
      onZoomFit: () => zoomed++,
    };
    const wiring: { current: SchSearchWiring } = { current: { selectionZoom: 'pan', ...base } };
    const h = symbolHandler(wiring);

    h.selectItems?.([0]);
    expect(centered).toBe(1);
    expect(zoomed).toBe(0);

    wiring.current = { selectionZoom: 'zoom', ...base };
    h.selectItems?.([0]);
    expect(centered).toBe(1);
    expect(zoomed).toBe(1);

    wiring.current = { selectionZoom: 'none', ...base };
    h.selectItems?.([0]);
    expect(centered).toBe(1);
    expect(zoomed).toBe(1);
  });
});
