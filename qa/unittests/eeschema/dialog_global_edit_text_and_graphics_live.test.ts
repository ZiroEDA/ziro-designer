// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS (`eeschema/dialogs/dialog_global_edit_text_and_graphics.cpp`)
 * on a live hierarchy: what the controls start at, which items each Scope box and filter reaches
 * on every sheet, and that the whole edit is one undo step.
 */
import { resolve } from 'node:path';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS,
  type GLOBAL_EDIT_VALUES,
} from '@ziroeda/eeschema/dialogs/dialog_global_edit_text_and_graphics.js';
import type { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SYMBOL_ORIENTATION_T } from '@ziroeda/eeschema/symbol.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const MM = 1e4;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(h.frame.Schematic().Hierarchy()[0]!);
  h.frame.SetUserUnits('mm');
  return h.frame;
}

/** Every symbol of every screen, once per screen. */
function symbols(aFrame: SCH_EDIT_FRAME): SCH_SYMBOL[] {
  const screens = new Set(
    aFrame
      .Schematic()
      .Hierarchy()
      .map((p) => p.LastScreen()!),
  );
  return [...screens].flatMap((s) => [...s.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]);
}

function run(aFrame: SCH_EDIT_FRAME, aChange: Partial<GLOBAL_EDIT_VALUES>): boolean {
  const dlg = new DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS(aFrame);
  const values = { ...dlg.TransferDataToWindow(), ...aChange };
  const ok = dlg.TransferDataFromWindow(values);
  dlg.Destroy(values);
  return ok;
}

describe('DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS', () => {
  it('starts with no scope and every Set To control left unchanged', () => {
    const v = new DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS(setUp()).TransferDataToWindow();

    expect([v.references, v.values, v.wires, v.schTextAndGraphics]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect([v.font, v.textSize, v.lineWidth, v.junctionSize]).toEqual([
      INDETERMINATE_ACTION,
      INDETERMINATE_ACTION,
      INDETERMINATE_ACTION,
      INDETERMINATE_ACTION,
    ]);
    expect([v.bold, v.italic, v.visible, v.showFieldNames]).toEqual([null, null, null, null]);
    // The last row of each choice is "-- leave unchanged --".
    expect([v.orientation, v.hAlign, v.vAlign, v.lineStyle]).toEqual([4, 3, 3, 5]);
    expect([v.setTextColor, v.setColor, v.setFillColor, v.setDotColor]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('resizes every reference designator on every sheet, and nothing else, in one undo step', () => {
    const frame = setUp();
    const all = symbols(frame);
    const values = all.map((s) => s.GetField(FIELD_T.VALUE)!.GetTextWidth());
    const undo = frame.GetUndoCommandCount();

    expect(run(frame, { references: true, textSize: '2.5' })).toBe(true);

    expect(new Set(all.map((s) => s.GetField(FIELD_T.REFERENCE)!.GetTextWidth()))).toEqual(
      new Set([2.5 * MM]),
    );
    expect(all.map((s) => s.GetField(FIELD_T.VALUE)!.GetTextWidth())).toEqual(values);
    expect(frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('narrows to the symbols whose reference matches the wildcard, ignoring case', () => {
    const frame = setUp();
    const all = symbols(frame).filter((s) => !s.GetLibSymbolRef()?.IsPower());
    const sheet = frame.Schematic().Hierarchy()[0]!;
    const target = all[0]!.GetRef(sheet).replace(/\d+$/, '');
    const before = new Map(all.map((s) => [s, s.GetField(FIELD_T.REFERENCE)!.IsBold()]));

    run(frame, {
      references: true,
      bold: true,
      referenceFilterOpt: true,
      referenceFilter: `${target.toLowerCase()}*`,
    });

    for (const s of all.filter((s) => s.GetRef(sheet) !== '')) {
      const matches = s.GetRef(sheet).toUpperCase().startsWith(target.toUpperCase());
      expect(s.GetField(FIELD_T.REFERENCE)!.IsBold()).toBe(matches ? true : before.get(s));
    }
  });

  it('touches only selected items when "Selected items only" is ticked', () => {
    const frame = setUp();
    const [a, b] = symbols(frame).filter((s) => !s.GetLibSymbolRef()?.IsPower());
    const sel = frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
    sel.ClearSelection(true);
    sel.AddItemToSel(a!, true);
    const bWidth = b!.GetField(FIELD_T.VALUE)!.GetTextWidth();

    run(frame, { values: true, textSize: '3', selectedFilterOpt: true });

    expect(a!.GetField(FIELD_T.VALUE)!.GetTextWidth()).toBe(3 * MM);
    expect(b!.GetField(FIELD_T.VALUE)!.GetTextWidth()).toBe(bWidth);
  });

  it('flips a left or right alignment on a mirrored symbol, so it reads the same on screen', () => {
    const frame = setUp();
    const plain = symbols(frame).find((s) => s.GetTransform().x1 > 0)!;
    const mirrored = symbols(frame).find((s) => s !== plain && s.GetTransform().x1 > 0)!;
    mirrored.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);
    expect(mirrored.GetTransform().x1).toBeLessThan(0);

    run(frame, { references: true, hAlign: 0 /* Left */ });

    expect(plain.GetField(FIELD_T.REFERENCE)!.GetHorizJustify()).toBe(
      GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
    );
    expect(mirrored.GetField(FIELD_T.REFERENCE)!.GetHorizJustify()).toBe(
      GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
    );
  });

  it('fills a shape with the colour, and an unspecified colour clears the fill', () => {
    const frame = setUp();
    const shape = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_NOTES);
    shape.SetPosition({ x: 0, y: 0 });
    shape.SetEnd({ x: 10 * MM, y: 10 * MM });
    frame.AddToScreen(shape, frame.GetScreen());
    const red = { r: 1, g: 0, b: 0, a: 1 };

    run(frame, { schTextAndGraphics: true, setFillColor: true, fillColor: red });
    expect(shape.GetFillMode()).toBe(FILL_T.FILLED_WITH_COLOR);
    expect(shape.GetFillColor()).toEqual(red);

    run(frame, { schTextAndGraphics: true, setFillColor: true, fillColor: COLOR4D_UNSPECIFIED });
    expect(shape.GetFillMode()).toBe(FILL_T.NO_FILL);
  });

  it('refuses a text size under 1 mil and changes nothing', () => {
    const frame = setUp();
    const all = symbols(frame);
    const before = all.map((s) => s.GetField(FIELD_T.REFERENCE)!.GetTextWidth());

    expect(run(frame, { references: true, textSize: '0.001' })).toBe(false);
    expect(all.map((s) => s.GetField(FIELD_T.REFERENCE)!.GetTextWidth())).toEqual(before);
  });

  it('remembers the four filters for the next time it opens', () => {
    const frame = setUp();
    run(frame, { fieldnameFilter: 'MPN', referenceFilter: 'R*', symbolFilter: 'Device:*' });

    const v = new DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS(frame).TransferDataToWindow();

    expect([v.fieldnameFilter, v.referenceFilter, v.symbolFilter]).toEqual([
      'MPN',
      'R*',
      'Device:*',
    ]);
    expect([v.fieldnameFilterOpt, v.referenceFilterOpt, v.symbolFilterOpt]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
