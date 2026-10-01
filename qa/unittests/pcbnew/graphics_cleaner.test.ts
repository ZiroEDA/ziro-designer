// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GRAPHICS_CLEANER (pcbnew/graphics_cleaner.cpp) on a live BOARD, driven the
 * way Tools > Cleanup Graphics does: GLOBAL_EDIT_TOOL::CleanupGraphics opens
 * DIALOG_CLEANUP_GRAPHICS (dialog_cleanup_graphics.cpp), every option change
 * is a dry run that lists, and OK cleans up. KiCad has no qa for either; each
 * expectation cites its line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { CLEANUP_RC_CODE } from '@ziroeda/pcbnew/cleanup_item.js';
import type { DIALOG_CLEANUP_GRAPHICS } from '@ziroeda/pcbnew/dialogs/dialog_cleanup_graphics.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { GLOBAL_EDIT_TOOL } from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { byUuid, type TOOL_HARNESS, toolHarness, U } from './support/pcb_tool_harness.js';
import { GLOBAL_EDIT_TEST_FRAME } from './support/global_edit_test_frame.js';

const line = (
  n: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w = 0.1,
  layer = 'F.SilkS',
) =>
  `(gr_line (start ${x1} ${y1}) (end ${x2} ${y2}) (stroke (width ${w}) (type solid)) (layer "${layer}") (uuid "${U(n)}"))`;

const board = (
  items: string[],
) => `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  ${items.join('\n  ')}
)
`;

class CLEANUP_FRAME extends GLOBAL_EDIT_TEST_FRAME {
  dialog: DIALOG_CLEANUP_GRAPHICS | null = null;
  override ShowCleanupGraphicsDialog(aDialog: DIALOG_CLEANUP_GRAPHICS): void {
    this.dialog = aDialog;
  }
}

let h: TOOL_HARNESS<CLEANUP_FRAME>;

function load(items: string[]): void {
  h = toolHarness(
    board(items),
    (aBoard) => new CLEANUP_FRAME(aBoard),
    () => [new GLOBAL_EDIT_TOOL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
}

function open(
  aOpts: Partial<Record<'redundant' | 'rects' | 'outlines', boolean>>,
): DIALOG_CLEANUP_GRAPHICS {
  h.mgr.RunAction(PCB_ACTIONS.cleanupGraphics);
  const dlg = h.frame.dialog!;
  dlg.TransferDataToWindow();
  dlg.m_deleteRedundantOpt = !!aOpts.redundant;
  dlg.m_createRectanglesOpt = !!aOpts.rects;
  dlg.m_fixBoardOutlines = !!aOpts.outlines;
  dlg.OnCheckBox();
  return dlg;
}

/** The listed changes: each row's error code and the uuids it names. */
const listed = (dlg: DIALOG_CLEANUP_GRAPHICS): { code: number; n: number }[] =>
  dlg.m_changesTreeModel.GetTree().map((node) => ({
    code: node.m_RcItem!.GetErrorCode(),
    n: Number.parseInt(node.m_RcItem!.GetMainItemID().slice(-12), 10),
  }));

const shapes = (): PCB_SHAPE[] =>
  h.board.Drawings().filter((d): d is PCB_SHAPE => d instanceof PCB_SHAPE);

describe('isNullShape (graphics_cleaner.cpp:94-122)', () => {
  beforeEach(() => {
    // DRC epsilon is 0.0005 mm: 0.0003 apart is null, 0.0005 apart is not (strict <).
    load([
      line(1, 10, 10, 10.0003, 10),
      line(2, 20, 10, 20.0005, 10),
      `(gr_circle (center 30 10) (end 30 10) (stroke (width 0.1) (type solid)) (fill no) (layer "F.SilkS") (uuid "${U(3)}"))`,
    ]);
  });

  it('a segment whose ends are within epsilon is null; a circle never is', () => {
    // `case CIRCLE: return aShape->GetRadius() == 0`, but EDA_SHAPE::GetRadius
    // returns std::max( 1, ... ) (eda_shape.cpp:1170), so in 10.0.6 the check
    // can never be true and a zero-radius circle survives the cleanup.
    const dlg = open({ redundant: true });
    expect(listed(dlg)).toEqual([{ code: CLEANUP_RC_CODE.CLEANUP_NULL_GRAPHIC, n: 1 }]);
  });
});

describe('areEquivalent and cleanupShapes (:125-209)', () => {
  it('keeps the earlier of two identical shapes and reports the later one', () => {
    load([line(1, 0, 0, 10, 0), line(2, 0, 0, 10, 0)]);
    expect(listed(open({ redundant: true }))).toEqual([
      { code: CLEANUP_RC_CODE.CLEANUP_DUPLICATE_GRAPHIC, n: 2 },
    ]);
  });

  it('three identical shapes are two duplicates of the first, not a chain', () => {
    load([line(1, 0, 0, 10, 0), line(2, 0, 0, 10, 0), line(3, 0, 0, 10, 0)]);
    expect(listed(open({ redundant: true })).map((r) => r.n)).toEqual([2, 3]);
  });

  it('needs the same width and layer; a reversed segment is not the same', () => {
    load([
      line(1, 0, 0, 10, 0),
      line(2, 0, 0, 10, 0, 0.2),
      line(3, 0, 0, 10, 0, 0.1, 'F.Cu'),
      line(4, 10, 0, 0, 0),
    ]);
    expect(listed(open({ redundant: true }))).toEqual([]);
  });

  it("ignores an arc's mid point: the minor and major arc over one chord collide", () => {
    load([
      `(gr_arc (start 0 0) (mid 5 2) (end 10 0) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(1)}"))`,
      `(gr_arc (start 0 0) (mid 5 -20) (end 10 0) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(2)}"))`,
    ]);
    // Same chord, but the centres differ for these two, so they do NOT collide;
    // a true minor/major pair shares its centre.
    expect(listed(open({ redundant: true }))).toEqual([]);
  });

  it('a dry run lists and changes nothing; OK removes, one undo step (:118-140)', () => {
    load([line(1, 0, 0, 10, 0), line(2, 0, 0, 10, 0), line(3, 5, 5, 5, 5)]);
    const dlg = open({ redundant: true });
    expect(shapes().length).toBe(3);
    const undo = h.frame.GetUndoCommandCount();
    dlg.TransferDataFromWindow();
    expect(shapes().map((s) => Number.parseInt(s.m_Uuid.slice(-12), 10))).toEqual([1]);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });
});

describe('mergeRects (:238-370)', () => {
  const rect = (w2 = 0.1) => [
    line(1, 0, 0, 0, 10), // left
    line(2, 0, 0, 10, 0), // top
    line(3, 10, 0, 10, 10, w2), // right
    line(4, 0, 10, 10, 10), // bottom
  ];

  it('four sides of one width become one rectangle', () => {
    load(rect());
    const dlg = open({ rects: true });
    expect(listed(dlg)).toEqual([{ code: CLEANUP_RC_CODE.CLEANUP_LINES_TO_RECT, n: 1 }]);
    dlg.TransferDataFromWindow();
    const s = shapes();
    expect(s.length).toBe(1);
    expect(s[0]!.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(s[0]!.IsAnyFill()).toBe(false);
  });

  it('a side of another width is not part of the rectangle', () => {
    load(rect(0.2));
    expect(listed(open({ rects: true }))).toEqual([]);
  });
});

describe('fixBoardOutlines (:212-235)', () => {
  it('does nothing in a dry run, and joins an outline gap within the tolerance on OK', () => {
    load([line(1, 0, 0, 10, 0, 0.1, 'Edge.Cuts'), line(2, 10.5, 0, 10.5, 10, 0.1, 'Edge.Cuts')]);
    const dlg = open({ outlines: true });
    expect(listed(dlg)).toEqual([]);
    // `if( m_dryRun ) return;` (:214): the dry run leaves the gap.
    expect((byUuid(h.board, 1) as unknown as PCB_SHAPE).GetEnd()).toEqual({ x: 10_000_000, y: 0 });
    dlg.TransferDataFromWindow();
    const a = byUuid(h.board, 1) as unknown as PCB_SHAPE;
    const b = byUuid(h.board, 2) as unknown as PCB_SHAPE;
    expect(a.GetEnd()).toEqual(b.GetStart());
  });
});

describe('DIALOG_CLEANUP_GRAPHICS', () => {
  it('offers "Update PCB" on a board, the 2 mm tolerance first (:33, :52-60)', () => {
    load([]);
    const dlg = open({});
    expect(dlg.GetOKLabel()).toBe('Update PCB');
    expect(dlg.m_tolerance.GetValue()).toBe(2_000_000);
  });
});
