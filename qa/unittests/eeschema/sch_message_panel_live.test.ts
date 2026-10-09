// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic's message panel, as SCH_INSPECTION_TOOL::UpdateMessagePanel fills it
 * (sch_inspection_tool.cpp:526-559): one selected item shows its GetMsgPanelInfo through
 * EDA_DRAW_FRAME::SetMsgPanel; anything else clears it. The window draws the frame's rows -
 * it used to draw rows built from its own record selection, which the live selection tool
 * never updated, so the panel stayed empty.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, MM, openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!,
  );
  let rows: { upper: string; lower: string }[] | null = null;
  h.frame.SetMsgPanelSink((aItems) => {
    rows = aItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }));
  });
  const sym = (
    [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]
  ).filter((s) => !s.GetLibSymbolRef()?.IsPower())[0]!;
  return { h, sym, rows: () => rows };
}

describe('the schematic message panel', () => {
  it('shows a selected symbol’s reference and value', () => {
    const { h, sym, rows } = setUp();
    const sheet = h.frame.GetCurrentSheet();

    click(h, sym.GetBodyBoundingBox().GetCenter());

    const shown = rows()!;
    expect(shown.find((r) => r.upper === 'Reference')?.lower).toBe(sym.GetRef(sheet));
    expect(shown.find((r) => r.upper === 'Value')?.lower).toBe(sym.GetValue(false, sheet, false));
  });

  it('lists a symbol’s rows in SCH_SYMBOL::GetMsgPanelInfo’s order', () => {
    const { h, sym, rows } = setUp();

    click(h, sym.GetBodyBoundingBox().GetCenter());

    // Reference, Value, (Exclude from), Name, Library or Derived from, Footprint, then the
    // description/keywords pair (sch_symbol.cpp).
    const uppers = rows()!.map((r) => r.upper.replace(/:.*$/, ':'));
    const expected = ['Reference', 'Value', 'Name', 'Library', 'Footprint', 'Description:'];
    if (sym.GetExcludedFromSim() || sym.GetExcludedFromBOM() || sym.GetExcludedFromBoard())
      expected.splice(2, 0, 'Exclude from');
    if (!sym.GetLibSymbolRef()!.IsRoot()) expected[expected.indexOf('Library')] = 'Derived from';
    expect(uppers).toEqual(expected);
    expect(rows()!.at(-1)!.lower.startsWith('Keywords: ')).toBe(true);
  });

  it('clears when the selection is cleared', () => {
    const { h, sym, rows } = setUp();
    click(h, sym.GetBodyBoundingBox().GetCenter());

    click(h, { x: -500 * MM, y: -500 * MM });

    expect(rows()).toEqual([]);
  });
});
