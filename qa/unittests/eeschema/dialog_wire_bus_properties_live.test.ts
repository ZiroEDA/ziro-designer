// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_WIRE_BUS_PROPERTIES (dialog_wire_bus_properties.cpp) on live items: the common stroke
 * shown, indeterminate values left alone, wires and bus entries edited in one commit.
 */
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { DIALOG_WIRE_BUS_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_wire_bus_properties.js';
import { SCH_BUS_WIRE_ENTRY } from '@ziroeda/eeschema/sch_bus_entry.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schFrame, schToolHarness } from './support/sch_tool_harness.js';

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const BLUE = { r: 0, g: 0, b: 1, a: 1 };

function wire(h: ReturnType<typeof schToolHarness>, aWidth: number): SCH_LINE {
  const w = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
  w.SetEndPoint({ x: 12700, y: 0 });
  w.SetLineWidth(aWidth);
  h.frame.AddToScreen(w, h.frame.GetScreen());
  return w;
}

describe('DIALOG_WIRE_BUS_PROPERTIES', () => {
  it('shows the common width and style, none when they differ; no junction means no junction size', () => {
    const h = schToolHarness(schFrame({}));
    const a = wire(h, 1000);
    const b = wire(h, 1000);
    b.SetLineStyle(LINE_STYLE.DASH);
    const shown = new DIALOG_WIRE_BUS_PROPERTIES(h.frame, [a, b]).TransferDataToWindow();
    expect(shown.width).toBe(1000);
    expect(shown.style).toBe(null);
    expect(shown.junction).toBe(undefined);

    const c = wire(h, 2000);
    expect(new DIALOG_WIRE_BUS_PROPERTIES(h.frame, [a, c]).TransferDataToWindow().width).toBe(null);
  });

  it('OK edits wires and bus entries in one commit; a null leaves that value alone', () => {
    const h = schToolHarness(schFrame({}));
    const a = wire(h, 1000);
    const entry = new SCH_BUS_WIRE_ENTRY({ x: 0, y: 0 });
    h.frame.AddToScreen(entry, h.frame.GetScreen());
    const undo = h.frame.GetUndoCommandCount();

    new DIALOG_WIRE_BUS_PROPERTIES(h.frame, [a, entry]).TransferDataFromWindow(
      null,
      'dot',
      BLUE,
      null,
    );

    expect(a.GetStroke().GetWidth()).toBe(1000);
    expect(a.GetLineStyle()).toBe(LINE_STYLE.DOT);
    expect(entry.GetStroke().GetLineStyle()).toBe(LINE_STYLE.DOT);
    expect(a.GetLineColor()).toEqual(BLUE);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('sets a selected junction’s colour and size', () => {
    const h = schToolHarness(schFrame({}));
    const j = new SCH_JUNCTION({ x: 0, y: 0 }, 900);
    h.frame.AddToScreen(j, h.frame.GetScreen());
    const dlg = new DIALOG_WIRE_BUS_PROPERTIES(h.frame, [j]);
    expect(dlg.TransferDataToWindow().junction).toBe(900);

    dlg.TransferDataFromWindow(null, null, BLUE, 1500);

    expect([j.GetDiameter(), j.GetColor()]).toEqual([1500, BLUE]);
  });
});
