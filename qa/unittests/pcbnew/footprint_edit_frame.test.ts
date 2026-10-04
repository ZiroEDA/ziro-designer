// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FOOTPRINT_EDIT_FRAME (`pcbnew/footprint_edit_frame.cpp`) as a
 * PCB_BASE_EDIT_FRAME: its footprint-holder BOARD, the tools it registers in
 * footprint mode, and ReloadFootprint.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { BOARD_USE } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_TOOL_BASE } from '@ziroeda/pcbnew/tools/pcb_tool_base.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A footprint placed flipped and rotated on a board, as a library archive can store it. */
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (7 "B.SilkS" user))
  (setup)
  (net 0 "")
  (footprint "Lib:R" (layer "B.Cu") (at 30 40 90) (uuid "${U(1)}")
    (pad "1" smd rect (at 1 0 90) (size 1 1) (layers "B.Cu") (uuid "${U(2)}")))
)`;

let frame: FOOTPRINT_EDIT_FRAME;

const fpFromBoard = (): FOOTPRINT => ParseBoard(BOARD_TEXT).GetFirstFootprint()!;

beforeEach(() => {
  installPgm();
  frame = new FOOTPRINT_EDIT_FRAME({ fpEdit: () => {} });
});

describe('the frame', () => {
  it('holds an empty footprint-holder board with no clearance and no mask margin', () => {
    const board = frame.GetBoard()!;

    expect(board.GetBoardUse()).toBe(BOARD_USE.FPHOLDER);
    expect(board.IsFootprintHolder()).toBe(true);
    expect(board.GetDesignSettings().m_NetSettings.GetDefaultNetclass().GetClearance()).toBe(0);
    expect(board.GetDesignSettings().m_SolderMaskExpansion).toBe(0);
    expect(frame.GetModel()).toBeNull();
  });

  it('registers its tools in footprint mode, none in board mode', () => {
    const tools = [...frame.GetToolManager()!.Tools()].filter((t) => t instanceof PCB_TOOL_BASE);

    expect(tools.length).toBeGreaterThan(0);

    for (const t of tools) {
      expect((t as PCB_TOOL_BASE).IsFootprintEditor()).toBe(true);
      expect((t as PCB_TOOL_BASE).IsBoardEditor()).toBe(false);
    }

    // The board editor's own tools are not the footprint editor's.
    const names = [...frame.GetToolManager()!.Tools()].map((t) => t.GetName());
    expect(names).not.toContain('pcbnew.EditorControl');
    expect(names).not.toContain('pcbnew.InteractiveRouter');
    expect(names).toContain('pcbnew.InteractiveEdit');
  });
});

describe('ReloadFootprint', () => {
  it('replaces the footprint, at the origin, on the front and unrotated', () => {
    frame.ReloadFootprint(fpFromBoard());
    const second = fpFromBoard();
    frame.ReloadFootprint(second);

    const board = frame.GetBoard()!;
    expect(board.Footprints()).toHaveLength(1);
    expect(frame.GetModel() === second).toBe(true);

    expect(second.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(second.IsFlipped()).toBe(false);
    expect(second.GetOrientation().AsDegrees()).toBe(0);
    expect(second.HasFlag(IS_NEW)).toBe(true);
    // The pad came to the front with it.
    expect(second.Pads()[0]!.GetLayerName()).toBe('F.Cu');
  });

  it('keeps an unparented copy of the footprint as loaded, and its name', () => {
    const fp = fpFromBoard();
    frame.ReloadFootprint(fp);

    const copy = frame.GetOriginalFootprintCopy()!;
    expect(copy === fp).toBe(false);
    expect(copy.GetParent()).toBeNull();
    // The copy was taken before AddFootprintToBoard moved the footprint.
    expect(copy.GetPosition()).not.toEqual({ x: 0, y: 0 });
    expect(frame.GetFootprintNameWhenLoaded()).toBe('R');
    expect(frame.GetLoadedFPID().Format()).toBe('Lib:R');
  });
});
