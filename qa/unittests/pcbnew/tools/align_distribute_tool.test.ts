// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ALIGN_DISTRIBUTE_TOOL (pcbnew/tools/align_distribute_tool.cpp) driven
 * through the tool manager on a live BOARD. KiCad's qa has no suite for the
 * tool; each expectation is read off the C++ line it cites, and the bounding
 * boxes are the rectangles' own: filled, so a zero-width stroke is kept
 * (pcb_io_kicad_sexpr_parser.cpp:3642-3645) and nothing inflates them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_MARKER } from '@ziroeda/pcbnew/pcb_marker.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { ALIGN_DISTRIBUTE_TOOL } from '@ziroeda/pcbnew/tools/align_distribute_tool.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import {
  byUuid,
  MM,
  mm,
  select,
  type TOOL_HARNESS,
  toolHarness,
  U,
} from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const rect = (n: number, x0: number, y0: number, x1: number, y1: number, locked = false): string =>
  `(gr_rect (start ${x0} ${y0}) (end ${x1} ${y1}) (stroke (width 0) (type solid)) (fill yes)` +
  ` (layer "F.SilkS")${locked ? ' (locked yes)' : ''} (uuid "${U(n)}"))`;

const fp = (n: number, x: number, y: number, pads: number[], refY = -3): string =>
  `(footprint "R" (layer "F.Cu") (uuid "${U(n)}") (at ${x} ${y})
    (property "Reference" "R${n}" (at 0 ${refY} 0) (layer "F.SilkS") (uuid "${U(n + 1)}")
      (effects (font (size 1 1) (thickness 0.15))))
    ${pads
      .map(
        (p, i) =>
          `(pad "${i + 1}" smd rect (at ${i * 2 - 1} 0) (size 1 1) (layers "F.Cu") (uuid "${U(p)}"))`,
      )
      .join('\n    ')})`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (5 "F.SilkS" user "F.Silkscreen")
    (25 "Edge.Cuts" user)
  )
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  ${rect(1, 0, 0, 20, 5)}
  ${rect(2, 30, 10, 40, 20)}
  ${rect(3, 90, 0, 100, 5)}
  ${rect(4, 50, 50, 60, 60, true)}
  ${fp(10, 60, 130, [12, 13])}
  ${fp(20, 80, 140, [22], -6)}
)
`;

class ALIGN_FRAME extends TEST_PCB_FRAME {
  warnings: string[] = [];
  override ShowInfoBarWarning(aMsg: string): void {
    this.warnings.push(aMsg);
  }
}

type Harness = TOOL_HARNESS<ALIGN_FRAME>;

let h: Harness;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new ALIGN_FRAME(aBoard),
    () => [new ALIGN_DISTRIBUTE_TOOL()],
  );
  // nowhere near any item: selectTarget's cursor preference stays out of it
  h.mouse = mm(250, 200);
});

const box = (n: number): BOX2I => byUuid(h.board, n).GetBoundingBox();
const left = (n: number): number => box(n).GetLeft() / MM;
const top = (n: number): number => box(n).GetTop() / MM;
const lastUndo = (): string => {
  const entry = h.frame.PopCommandFromUndoList()!;
  return entry.GetDescription();
};

describe('ALIGN_DISTRIBUTE_TOOL::AlignLeft (align_distribute_tool.cpp:281-327)', () => {
  it('moves each item to the left-most left edge, as one "Align to Left"', () => {
    select(h, 2, 3);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    expect([left(2), left(3)]).toEqual([30, 30]);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(lastUndo()).toBe('Align to Left');
  });

  it('prefers the item under the cursor (selectTarget, :111-117)', () => {
    select(h, 1, 3);
    h.mouse = mm(95, 2);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    expect([left(1), left(3)]).toEqual([90, 90]);
  });

  it('prefers a locked item over everything, and does not move it (:101-109, :205-206)', () => {
    select(h, 1, 3, 4);
    h.mouse = mm(95, 2);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    expect([left(1), left(3), left(4)]).toEqual([50, 50, 50]);
  });

  it('runs AlignRight when the view is mirrored (:284-287)', () => {
    h.view.SetMirror(true, false);
    select(h, 2, 3);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    expect(box(2).GetRight() / MM).toBe(100);
  });
});

describe('the other five aligns', () => {
  it('AlignRight: the right-most right edge (:340-376)', () => {
    select(h, 1, 2);
    h.mgr.RunAction(PCB_ACTIONS.alignRight);
    expect([box(1).GetRight() / MM, box(2).GetRight() / MM]).toEqual([40, 40]);
    expect(lastUndo()).toBe('Align to Right');
  });

  it('AlignTop: the top-most top edge (:229-261)', () => {
    select(h, 2, 4);
    h.mgr.RunAction(PCB_ACTIONS.alignTop);
    // the locked rect is the target, so its top (50) wins over the higher one
    expect([top(2), top(4)]).toEqual([50, 50]);
    expect(lastUndo()).toBe('Align to Top');
  });

  it('AlignBottom: the bottom-most bottom edge (:264-296)', () => {
    select(h, 1, 2);
    h.mgr.RunAction(PCB_ACTIONS.alignBottom);
    expect([box(1).GetBottom() / MM, box(2).GetBottom() / MM]).toEqual([20, 20]);
    expect(lastUndo()).toBe('Align to Bottom');
  });

  it('AlignCenterX: the left-most centre (:379-411)', () => {
    select(h, 2, 3);
    h.mgr.RunAction(PCB_ACTIONS.alignCenterX);
    expect([box(2).Centre().x / MM, box(3).Centre().x / MM]).toEqual([35, 35]);
    expect(lastUndo()).toBe('Align to Middle');
  });

  it('AlignCenterY: the top-most centre (:414-446)', () => {
    select(h, 1, 2);
    h.mgr.RunAction(PCB_ACTIONS.alignCenterY);
    expect([box(1).Centre().y / MM, box(2).Centre().y / MM]).toEqual([2.5, 2.5]);
    expect(lastUndo()).toBe('Align to Center');
  });
});

describe('GetSelections (align_distribute_tool.cpp:122-197)', () => {
  it('a pad stands for its footprint, measured by the pad (!m_AllowFreePads, :180-190)', () => {
    select(h, 12, 22);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    // pad 12 (at 59) spans 58.5..59.5, pad 22 (at 79) 78.5..79.5: R20 moves 20 mm left
    expect(byUuid(h.board, 20).GetPosition()).toEqual(mm(60, 140));
    expect(byUuid(h.board, 10).GetPosition()).toEqual(mm(60, 130));
  });

  it('a pad moves on its own when free pads are allowed (:184)', () => {
    h.frame.settings.m_AllowFreePads = true;
    // a rect in the selection: not all pads, so each pad is its own item
    select(h, 13, 22, 2);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    expect(byUuid(h.board, 20).GetPosition()).toEqual(mm(80, 140));
    expect([box(13).GetLeft() / MM, box(22).GetLeft() / MM]).toEqual([30, 30]);
  });

  it('...unless every item is a pad and they have different footprints (:184)', () => {
    h.frame.settings.m_AllowFreePads = true;
    select(h, 12, 22);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    expect(byUuid(h.board, 20).GetPosition()).toEqual(mm(60, 140));
  });

  it('an item whose parent is selected moves with the parent only (:247-248)', () => {
    const field = byUuid(h.board, 11);
    const before = field.GetPosition();
    // the field first: once R10 is selected its children are flagged selected,
    // and select() turns an already-selected item away
    select(h, 11, 10, 20);
    expect([...h.sel.GetSelection()].map((i) => i.GetClass())).toEqual([
      'PCB_FIELD',
      'FOOTPRINT',
      'FOOTPRINT',
    ]);
    h.mgr.RunAction(PCB_ACTIONS.alignBottom);
    // R20's pad bottom (140.5) is the target: R10 (pad bottom 130.5) moves down
    // 10 mm and its field rides with it, once - not again by its own box
    expect(byUuid(h.board, 10).GetPosition()).toEqual(mm(60, 140));
    expect(field.GetPosition().y - before.y).toBe(10 * MM);
  });
});

describe('more GetSelections and target rules', () => {
  it('a DRC marker is not aligned and is no target (:127-135)', () => {
    const marker = new PCB_MARKER(null, mm(5, 5));
    h.board.Add(marker);
    select(h, 2, 3);
    h.sel.AddItemToSel(marker, true);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    expect([left(2), left(3)]).toEqual([30, 30]);
    expect(marker.GetPosition()).toEqual(mm(5, 5));
  });

  it('AlignTop without a locked item: the top-most top (:229-261)', () => {
    select(h, 2, 1);
    h.mgr.RunAction(PCB_ACTIONS.alignTop);
    expect([top(1), top(2)]).toEqual([0, 0]);
  });

  it('two pads of one footprint move it once (addToList, :160-171)', () => {
    select(h, 12, 13, 2);
    h.mgr.RunAction(PCB_ACTIONS.alignLeft);
    // rect 2's left (30) is the target; R10 moves by 30 - 58.5, once
    expect(byUuid(h.board, 10).GetPosition()).toEqual(mm(31.5, 130));
  });

  it('a footprint is measured without its text (getBoundingBox, :94-98)', () => {
    select(h, 10, 20);
    h.mgr.RunAction(PCB_ACTIONS.alignTop);
    // pad tops 129.5 and 139.5; the two references sit 3 and 6 mm up, so
    // measuring with text would move R20 by 7 mm, not 10
    expect(byUuid(h.board, 20).GetPosition()).toEqual(mm(80, 130));
  });
});

describe('ALIGN_DISTRIBUTE_TOOL::DistributeItems (align_distribute_tool.cpp:449-505)', () => {
  it('with even gaps: only the middle item moves (:536-551)', () => {
    select(h, 1, 2, 3);
    h.mgr.RunAction(PCB_ACTIONS.distributeHorizontallyGaps);
    // spans 0-20, 30-40, 90-100: 60 mm of gap over two gaps, so 30 each
    expect([left(1), left(2), left(3)]).toEqual([0, 50, 90]);
    expect(lastUndo()).toBe('Distribute Horizontally with Even Gaps');
  });

  it('by centres: centres 10, 35, 95 become 10, 52.5, 95 (:554-587)', () => {
    select(h, 3, 1, 2);
    h.mgr.RunAction(PCB_ACTIONS.distributeHorizontallyCenters);
    expect(box(2).Centre().x / MM).toBe(52.5);
    expect([left(1), left(3)]).toEqual([0, 90]);
    expect(lastUndo()).toBe('Distribute Horizontally by Centers');
  });

  it('vertically with even gaps: tops 0, 0, 10 sorted, and x is left alone', () => {
    select(h, 1, 2, 3);
    h.mgr.RunAction(PCB_ACTIONS.distributeVerticallyGaps);
    // spans 0-5 (A), 0-5 (C), 10-20 (B): 10 - 5 - 5 = 0 mm of gap, so the
    // middle one (C, the second of the two tied tops) starts where A ends
    expect([top(1), top(3), top(2)]).toEqual([0, 5, 10]);
    expect([left(1), left(3), left(2)]).toEqual([0, 90, 30]);
    expect(lastUndo()).toBe('Distribute Vertically with Even Gaps');
  });

  it('vertically by centres, three free items', () => {
    select(h, 1, 2, 3);
    h.mgr.RunAction(PCB_ACTIONS.distributeVerticallyCenters);
    // centres 2.5 (A), 15 (B), 2.5 (C) sort to A, C, B: C moves to 2.5 + 12.5 / 2
    const ys = [1, 2, 3].map((n) => box(n).Centre().y / MM).sort((a, b) => a - b);
    expect(ys).toEqual([2.5, 8.75, 15]);
    expect(left(2)).toBe(30);
    expect(lastUndo()).toBe('Distribute Vertically by Centers');
  });

  it('fewer than three items: nothing (:468-469)', () => {
    select(h, 1, 2);
    h.mgr.RunAction(PCB_ACTIONS.distributeHorizontallyGaps);
    expect(left(2)).toBe(30);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('a locked item stops the whole command, with the warning (ReportFilteredLockedItems, :465-466)', () => {
    select(h, 1, 2, 3, 4);
    h.mgr.RunAction(PCB_ACTIONS.distributeHorizontallyGaps);
    expect(left(2)).toBe(30);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
    expect(h.frame.warnings).toEqual([
      "Selection contains locked items. Enable 'Override locks' to operate on them.",
    ]);
  });

  it('a selected footprint child goes with its footprint (FilterCollectorForHierarchy, :455)', () => {
    const field = byUuid(h.board, 11);
    const offset = field.GetPosition().x - byUuid(h.board, 10).GetPosition().x;
    select(h, 11, 10, 1, 3);
    h.mgr.RunAction(PCB_ACTIONS.distributeHorizontallyGaps);
    expect(byUuid(h.board, 10).GetPosition().x).not.toBe(60 * MM);
    expect(field.GetPosition().x - byUuid(h.board, 10).GetPosition().x).toBe(offset);
  });
});
