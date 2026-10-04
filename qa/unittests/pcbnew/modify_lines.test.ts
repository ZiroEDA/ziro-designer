// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Fillet / chamfer / dogbone / extend applied to a selection, on a live board.
 * Counterparts: `EDIT_TOOL::ModifyLines` (edit_tool.cpp) and the
 * PAIRWISE_LINE_ROUTINEs (item_modification_routine.cpp).
 *
 * The maths is covered in qa/unittests/kimath/corner_operations.test.ts; what
 * is tested here is the driving: which pairs are tried, that a line taking part
 * in two corners is shortened by both, that consumed lines are deleted rather
 * than left as zero-length items, and what the status line says.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { harnessCanvas } from './support/pcb_tool_harness.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';

const MM = (n: number): number => mmToIU(n);
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Seg = [number, number, number, number];

const boardText = (
  aLines: Seg[],
): string => `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  ${aLines
    .map(
      ([x0, y0, x1, y1], i) =>
        `(gr_line (start ${x0} ${y0}) (end ${x1} ${y1}) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts") (uuid "${U(i + 1)}"))`,
    )
    .join('\n  ')}
)`;

/** An L: two lines meeting at (100, 0). */
const ELBOW: Seg[] = [
  [0, 0, 100, 0],
  [100, 0, 100, 100],
];

/** A closed square drawn as four lines, corners at every turn. */
const SQUARE: Seg[] = [
  [0, 0, 100, 0],
  [100, 0, 100, 100],
  [100, 100, 0, 100],
  [0, 100, 0, 0],
];

let board: BOARD;
let frame: PCB_EDIT_FRAME;
let infobar: string[];
let unitValue: number | null;

function setup(aLines: Seg[]): void {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  infobar = [];
  frame = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
    showUnitEntryDialog: () => Promise.resolve(unitValue),
    showDogboneDialog: () => Promise.resolve({ DogboneRadiusIU: MM(5), AddSlots: false }),
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  frame.ShowInfoBarMsg = (aMsg: string) => {
    infobar.push(aMsg);
  };
  board = ParseBoard(boardText(aLines));
  frame.SetBoard(board, false);
  frame.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));
  // A VIEW for the tools; the cursor sits off the lines.
  const { view, controls } = harnessCanvas(board, frame, {
    mouse: { x: MM(-100), y: MM(-100) },
    forced: null,
  });
  frame.GetToolManager()!.SetEnvironment(board, view, controls, settings as never, frame);
}

/** Select every drawing, run the action, and let the dialog promise settle. */
async function run(aAction: TOOL_ACTION, aValue: number | null = null): Promise<void> {
  unitValue = aValue;
  const tool = frame.GetSelectionTool();

  for (const item of board.Drawings()) tool.AddItemToSel(item, true);

  frame.GetToolManager()!.RunAction(aAction);
  await new Promise((r) => setTimeout(r, 0));
}

const shapes = (aType: SHAPE_T): PCB_SHAPE[] =>
  board.Drawings().filter((d) => (d as PCB_SHAPE).GetShape() === aType) as PCB_SHAPE[];

const length = (s: PCB_SHAPE): number =>
  Math.hypot(s.GetEnd().x - s.GetStart().x, s.GetEnd().y - s.GetStart().y);

beforeEach(() => {
  unitValue = null;
});

describe('filleting a selection', () => {
  it('replaces the corner with an arc', async () => {
    setup(ELBOW);
    await run(PCB_ACTIONS.filletLines, MM(20));

    expect(shapes(SHAPE_T.ARC)).toHaveLength(1);
    expect(shapes(SHAPE_T.SEGMENT).map(length)).toEqual([MM(80), MM(80)]);
    expect(infobar).toEqual([]);
  });

  it('gives the arc the stroke and layer of the lines it came from', async () => {
    setup(ELBOW);
    await run(PCB_ACTIONS.filletLines, MM(20));
    const arc = shapes(SHAPE_T.ARC)[0]!;

    expect(arc.GetWidth()).toBe(MM(0.15));
    expect(arc.GetLayerName()).toBe('Edge.Cuts');
  });

  it('rounds all four corners of a square in one go', async () => {
    // Every unordered pair is tried, so the user need not select in drawing
    // order, and each line takes part in two corners, so it is shortened by
    // both rather than by whichever came last.
    setup(SQUARE);
    await run(PCB_ACTIONS.filletLines, MM(20));

    expect(shapes(SHAPE_T.ARC)).toHaveLength(4);

    // 100 mm less 20 mm off each end.
    for (const s of shapes(SHAPE_T.SEGMENT)) expect(length(s) / MM(60)).toBeCloseTo(1, 3);
  });

  it('says so when no corner could be rounded', async () => {
    setup(ELBOW);
    await run(PCB_ACTIONS.filletLines, MM(500));

    expect(shapes(SHAPE_T.ARC)).toHaveLength(0);
    expect(shapes(SHAPE_T.SEGMENT).map(length)).toEqual([MM(100), MM(100)]);
    expect(infobar).toEqual(['Unable to fillet the selected lines.']);
  });

  it('reports lines that never met as not filleted', async () => {
    // GetStatusMessage: no success at all is "Unable to ..." whatever the reason.
    setup([
      [0, 0, 100, 0],
      [200, 50, 300, 50],
    ]);
    await run(PCB_ACTIONS.filletLines, MM(10));

    expect(infobar).toEqual(['Unable to fillet the selected lines.']);
  });

  it('a cancelled radius changes nothing', async () => {
    setup(ELBOW);
    await run(PCB_ACTIONS.filletLines, null);

    expect(board.Drawings()).toHaveLength(2);
    expect(shapes(SHAPE_T.ARC)).toHaveLength(0);
  });
});

describe('chamfering a selection', () => {
  it('replaces the corner with a straight cut between the set-back points', async () => {
    setup(ELBOW);
    await run(PCB_ACTIONS.chamferLines, MM(20));

    const segs = shapes(SHAPE_T.SEGMENT);
    // The two shortened originals and the chamfer.
    expect(segs).toHaveLength(3);

    const cut = segs.find(
      (s) => s.GetStart().x !== s.GetEnd().x && s.GetStart().y !== s.GetEnd().y,
    )!;
    const ends = [cut.GetStart(), cut.GetEnd()]
      .map((p) => [p.x, p.y])
      .sort((a, b) => a[0]! - b[0]!);
    expect(ends).toEqual([
      [MM(80), 0],
      [MM(100), MM(20)],
    ]);
  });

  it('deletes a line the chamfer consumes entirely', async () => {
    // A set-back reaching the far end leaves nothing; upstream deletes rather
    // than keeping a zero-length item.
    setup(ELBOW);
    await run(PCB_ACTIONS.chamferLines, MM(100));

    expect(board.Drawings()).toHaveLength(1);
  });
});

describe('dogboning a selection', () => {
  it('replaces the corner with a pocket arc through the original corner', async () => {
    // The deepest point is the corner itself, which is what lets a mating
    // sharp corner still seat.
    setup(ELBOW);
    await run(PCB_ACTIONS.dogboneCorners);

    const arcs = shapes(SHAPE_T.ARC);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.GetArcMid()).toEqual({ x: MM(100), y: 0 });

    // Both arms are shortened back to the pocket.
    for (const s of shapes(SHAPE_T.SEGMENT)) expect(length(s)).toBeLessThan(MM(100));
  });
});

describe('extending a selection', () => {
  it('grows both lines until they meet, adding nothing', async () => {
    setup([
      [0, 0, 50, 0],
      [100, 20, 100, 80],
    ]);
    await run(PCB_ACTIONS.extendLines);

    expect(board.Drawings()).toHaveLength(2);

    for (const s of shapes(SHAPE_T.SEGMENT)) {
      const ends = [s.GetStart(), s.GetEnd()];
      expect(ends.some((p) => p.x === MM(100) && p.y === 0)).toBe(true);
    }
  });

  it('leaves lines that already cross alone', async () => {
    setup([
      [0, 0, 100, 0],
      [50, -5, 50, 5],
    ]);
    await run(PCB_ACTIONS.extendLines);

    expect(shapes(SHAPE_T.SEGMENT).map(length)).toEqual([MM(100), MM(10)]);
    expect(infobar).toEqual(['Unable to extend the selected lines to meet.']);
  });
});

describe('the written file', () => {
  it('carries the shortened line', async () => {
    setup(ELBOW);
    await run(PCB_ACTIONS.filletLines, MM(20));
    const text = FormatBoard(board).replace(/\s+/g, ' ');

    expect(text).toContain('(start 0 0) (end 80 0)');
    expect(text).not.toContain('(end 100 0)');
  });
});
