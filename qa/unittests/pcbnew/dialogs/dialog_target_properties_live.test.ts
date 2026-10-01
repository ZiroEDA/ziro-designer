// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TARGET_PROPERTIES on a live PCB_TARGET (dialog_target_properties.cpp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IN_EDIT, IS_MOVING } from '@ziroeda/common/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_TARGET_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_target_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_TARGET } from '@ziroeda/pcbnew/pcb_target.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const target = (): PCB_TARGET => board.Drawings()[0] as PCB_TARGET;
const dlg = () => new DIALOG_TARGET_PROPERTIES(frame, target());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (target x (at 10 20) (size 4) (width 0.2) (layer "Edge.Cuts")
    (uuid "70000000-0000-4000-8000-000000000001")))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_TARGET_PROPERTIES', () => {
  it('reads Size, Thickness and the shape (x is choice 1)', () => {
    expect(dlg().TransferDataToWindow()).toEqual({ size: MM(4), thickness: MM(0.2), shape: 1 });
  });

  it('writes all three back as one undo step, "Edit Alignment Target"', () => {
    expect(dlg().TransferDataFromWindow({ size: MM(6), thickness: MM(0.3), shape: 0 })).toEqual({
      ok: true,
    });
    expect(target().GetSize()).toBe(MM(6));
    expect(target().GetWidth()).toBe(MM(0.3));
    expect(target().GetShape()).toBe(0);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(target().GetSize()).toBe(MM(4));
    expect(target().GetShape()).toBe(1);
  });

  it('refuses a size under one mil ("hard to see/select"), changing nothing', () => {
    const r = dlg().TransferDataFromWindow({ size: MM(0.02), thickness: MM(0.3), shape: 0 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Size must be at least 0.0254 mm');
    expect(target().GetSize()).toBe(MM(4));
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('accepts exactly one mil', () => {
    expect(
      dlg().TransferDataFromWindow({ size: pcbIUScale.milsToIU(1), thickness: MM(0.2), shape: 1 })
        .ok,
    ).toBe(true);
  });

  it('a target mid-edit is flagged IN_EDIT and pushes no commit of its own', () => {
    target().SetFlags(IS_MOVING);
    dlg().TransferDataFromWindow({ size: MM(6), thickness: MM(0.2), shape: 1 });
    expect(target().GetSize()).toBe(MM(6));
    expect(target().GetFlags() & IN_EDIT).toBe(IN_EDIT);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});
