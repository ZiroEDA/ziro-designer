// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A Search-pane row and a click on the canvas have to name the same item.
 *
 * `SEARCH_PANE_LISTVIEW::OnItemSelected` hands its rows to
 * `m_handler->SelectItems()`, so a row *is* a selection; ours does the same by
 * id. That makes the id the contract between the two, and it is load-bearing
 * twice over: picking a row must select the right item on the sheet, and the
 * row draws selected only when its id is in the editor's selection set.
 *
 * If the two ever drift the failure is silent — the row does nothing visible and
 * the panel simply stops highlighting — so it is pinned here rather than left to
 * a rendering test that cannot see ids at all.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { searchSchematic, hitsOfKind } from '@ziroeda/eeschema/src/tools/search_handlers.js';
import { hitTest } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

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
  (label "CLK" (at 60 20 0) (effects (font (size 1.27 1.27))) (uuid "l-clk")))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const libs = (d: Schematic) => new Map<string, LibSymbol>(d.libSymbols.map((l) => [l.libId, l]));
const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const fmt = (iu: number): string => (iu / 1_000_000).toFixed(2);

describe('search hit ids are canvas selection ids', () => {
  it('a symbol row carries the id clicking that symbol yields', () => {
    const d = doc();
    const hits = searchSchematic(d, libs(d), 'R1', false, fmt);
    const row = hitsOfKind(hits, 'symbol')[0];
    expect(row, 'R1 should be found').toBeDefined();

    // On the resistor's body outline, left of it so the fields (placed to the
    // right, at x=42) cannot be what the click lands on.
    const clicked = hitTest(d, libs(d), at(38.98, 40), mmToIU(0.3));
    expect(clicked?.id).toBe(row!.id);
  });

  it('a label row carries the id clicking that label yields', () => {
    const d = doc();
    const hits = searchSchematic(d, libs(d), 'CLK', false, fmt);
    const row = hitsOfKind(hits, 'label')[0];
    expect(row, 'CLK should be found').toBeDefined();

    const clicked = hitTest(d, libs(d), at(60, 20), mmToIU(0.5));
    expect(clicked?.id).toBe(row!.id);
  });

  it('ids are stable across searches, so a highlight does not flicker', () => {
    const d = doc();
    const a = hitsOfKind(searchSchematic(d, libs(d), 'R', false, fmt), 'symbol')[0];
    const b = hitsOfKind(searchSchematic(d, libs(d), 'R1', false, fmt), 'symbol')[0];
    expect(a!.id).toBe(b!.id);
  });
});
