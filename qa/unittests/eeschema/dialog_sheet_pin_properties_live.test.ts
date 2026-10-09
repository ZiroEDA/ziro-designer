// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_SHEET_PIN_PROPERTIES (dialog_sheet_pin_properties.cpp) on a live sheet pin: the name
 * combo lists the sub-sheet's hierarchical labels; OK writes name (escaped), size, style, colour
 * and shape as one "Edit Sheet Pin Properties" commit on the sheet.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { DIALOG_SHEET_PIN_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_sheet_pin_properties.js';
import { LABEL_FLAG_SHAPE, SCH_HIERLABEL } from '@ziroeda/eeschema/sch_label.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SHEET_PIN } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const root = h.frame.Schematic().Hierarchy()[0]!;
  h.frame.SetCurrentSheet(root);
  // The fixture's sheets connect through global labels: give one a pin.
  const sheet = [...root.LastScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T)][0] as SCH_SHEET;
  const pin = new SCH_SHEET_PIN(sheet, sheet.GetPosition(), 'IN1');
  sheet.AddPin(pin);
  for (const name of ['IN1', 'OUT2', 'IN1'])
    sheet.GetScreen()!.Append(new SCH_HIERLABEL({ x: 0, y: 0 }, name));
  return { h, sheet, pin, dlg: new DIALOG_SHEET_PIN_PROPERTIES(h.frame, pin) };
}

describe('DIALOG_SHEET_PIN_PROPERTIES', () => {
  it("offers the sub-sheet's hierarchical labels and shows the pin", () => {
    const { sheet, pin, dlg } = setUp();
    const labels = [...sheet.GetScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)].map((l) =>
      (l as SCH_HIERLABEL).GetText(),
    );
    const shown = dlg.TransferDataToWindow();
    expect(shown.names).toEqual([...new Set(labels)]);
    // Each name once, in screen order.
    expect(shown.names.filter((n) => n === 'IN1')).toHaveLength(1);
    expect(shown.names).toContain('OUT2');
    expect(shown.textSize).toBe(pin.GetTextWidth());
    expect(shown.shape).toBe(pin.GetShape());
  });

  it('OK writes name, size, style, colour and shape as one commit', () => {
    const { h, pin, dlg } = setUp();
    const undo = h.frame.GetUndoCommandCount();
    const red = { r: 1, g: 0, b: 0, a: 1 };

    dlg.TransferDataFromWindow({
      ...dlg.TransferDataToWindow(),
      name: 'A/B',
      textSize: 2000,
      bold: true,
      italic: true,
      color: red,
      shape: LABEL_FLAG_SHAPE.L_TRISTATE,
    });

    expect(pin.GetText()).toBe('A{slash}B'); // EscapeString( …, CTX_NETNAME )
    expect([pin.GetTextWidth(), pin.GetTextHeight()]).toEqual([2000, 2000]);
    expect([pin.IsBold(), pin.IsItalic()]).toEqual([true, true]);
    expect(pin.GetTextColor()).toEqual(red);
    expect(pin.GetShape()).toBe(LABEL_FLAG_SHAPE.L_TRISTATE);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });
});
