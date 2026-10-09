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
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_LABEL_BASE } from '@ziroeda/eeschema/sch_label.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
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

  it('a sheet shows its name, its hierarchical path and its file (sch_sheet.cpp)', () => {
    const h = schToolHarness();
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const sheet = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)][0] as SCH_SHEET;
    const items: MSG_PANEL_ITEM[] = [];

    sheet.GetMsgPanelInfo(h.frame.AsDrawFrameLike(), items);

    const rows = items.map((i) => [i.GetUpperText(), i.GetLowerText()]);
    expect(rows.slice(0, 3)).toEqual([
      ['Sheet Name', sheet.GetName()],
      ['Hierarchical Path', `complex_hierarchy/${sheet.GetName()}`],
      ['File Name', sheet.GetFileName()],
    ]);
  });

  it('a symbol pin shows its rows in SCH_PIN::GetMsgPanelInfo’s order, then the owner', () => {
    const { h, sym } = setUp();
    const pin = sym.GetPins()[0]!;
    const items: MSG_PANEL_ITEM[] = [];

    pin.GetMsgPanelInfo(h.frame.AsDrawFrameLike(), items);

    const uppers = items.map((i) => i.GetUpperText());
    const ref = sym.GetRef(h.frame.GetCurrentSheet());
    expect(uppers.filter((u) => !['Unit', 'Body Style'].includes(u))).toEqual([
      'Type',
      'Name',
      'Number',
      'Type',
      'Style',
      'Visible',
      'Length',
      'Orientation',
      ref,
    ]);
    expect(items.find((i) => i.GetUpperText() === 'Number')!.GetLowerText()).toBe(
      pin.GetShownNumber(),
    );
  });

  it('a field shows its name, text and justifications (sch_field.cpp)', () => {
    const { h, sym } = setUp();
    const field = sym.GetField(FIELD_T.VALUE)!;
    const items: MSG_PANEL_ITEM[] = [];

    field.GetMsgPanelInfo(h.frame.AsDrawFrameLike(), items);

    expect(items.map((i) => i.GetUpperText())).toEqual([
      'Symbol Field',
      'Text',
      'Visible',
      'Font',
      'Style',
      'Text Size',
      'H Justification',
      'V Justification',
    ]);
    expect(items[1]!.GetLowerText()).toBe(field.GetText());
  });

  it('a net label shows its kind and text, no electrical type, then style rows (sch_label.cpp)', () => {
    const { h } = setUp();
    const label = [
      ...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_LABEL_T),
    ][0] as SCH_LABEL_BASE;
    const items: MSG_PANEL_ITEM[] = [];

    label.GetMsgPanelInfo(h.frame.AsDrawFrameLike(), items);

    // Only global and hierarchical labels and sheet pins show an electrical Type.
    expect(items.map((i) => i.GetUpperText()).slice(0, 5)).toEqual([
      'Label',
      'Font',
      'Style',
      'Text Size',
      'Justification',
    ]);
    expect(items[0]!.GetLowerText()).toBe(label.GetText());
  });

  it('graphic text on a sheet has one Justification row; on a symbol, H and V (sch_text.cpp)', () => {
    const { h } = setUp();
    const onSheet = new SCH_TEXT({ x: 0, y: 0 }, 'note');
    const inSymbol = new SCH_TEXT({ x: 0, y: 0 }, 'pin note', SCH_LAYER_ID.LAYER_DEVICE);
    const rows = (t: SCH_TEXT) => {
      const items: MSG_PANEL_ITEM[] = [];
      t.GetMsgPanelInfo(h.frame.AsDrawFrameLike(), items);
      return items.map((i) => i.GetUpperText());
    };

    expect(rows(onSheet)).toEqual(['Text', 'Font', 'Style', 'Text Size', 'Justification']);
    expect(rows(inSymbol)).toEqual([
      'Text',
      'Font',
      'Style',
      'Text Size',
      'H Justification',
      'V Justification',
    ]);
  });
});
