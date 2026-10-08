// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_JUNCTION_PROPS (dialog_junction_props.cpp) on live junctions: the common diameter and
 * colour shown, an indeterminate diameter left alone, and OK as one "Edit Junction(s)" commit.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { DIALOG_JUNCTION_PROPS } from '@ziroeda/eeschema/dialogs/dialog_junction_props.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schFrame, schToolHarness } from './support/sch_tool_harness.js';

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const RED = { r: 1, g: 0, b: 0, a: 1 };

function setUp(aDiameters: number[]) {
  const h = schToolHarness(schFrame({}));
  const junctions = aDiameters.map((d, i) => {
    const j = new SCH_JUNCTION({ x: i * 1270, y: 0 }, d);
    h.frame.AddToScreen(j, h.frame.GetScreen());
    return j;
  });
  return { h, junctions, dlg: new DIALOG_JUNCTION_PROPS(h.frame, junctions) };
}

describe('DIALOG_JUNCTION_PROPS', () => {
  it('shows the common diameter, or none when they differ', () => {
    expect(setUp([1000, 1000]).dlg.TransferDataToWindow().diameter).toBe(1000);
    expect(setUp([1000, 2000]).dlg.TransferDataToWindow().diameter).toBe(null);
  });

  it('OK writes diameter and colour as one undo step', () => {
    const { h, junctions, dlg } = setUp([1000]);
    const undo = h.frame.GetUndoCommandCount();

    dlg.TransferDataFromWindow(3000, RED);

    expect(junctions[0]!.GetDiameter()).toBe(3000);
    expect(junctions[0]!.GetColor()).toEqual(RED);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('an indeterminate diameter leaves each junction its own; the colour still applies', () => {
    const { junctions, dlg } = setUp([1000, 2000]);

    dlg.TransferDataFromWindow(null, RED);

    expect(junctions.map((j) => j.GetDiameter())).toEqual([1000, 2000]);
    expect(junctions.map((j) => j.GetColor())).toEqual([RED, RED]);
  });
});
