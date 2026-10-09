// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Merge, subtract and intersect polygons on a live board.
 * Counterparts: `EDIT_TOOL::BooleanPolygons`, `POLYGON_BOOLEAN_ROUTINE`,
 * `POLYGON_MERGE_ROUTINE`, `POLYGON_SUBTRACT_ROUTINE` and
 * `POLYGON_INTERSECT_ROUTINE`, over `SHAPE_POLY_SET`'s Clipper-backed ops.
 *
 * Results are checked by *area*, which is what the operations are actually
 * about and what stays meaningful when Clipper renumbers or reorders the
 * vertices. Two overlapping 10 mm squares offset by 5 mm give a union of 175
 * mm², a difference of 75 mm² and an intersection of 25 mm² — three numbers
 * that no two of the operations share, so a test cannot pass under the wrong
 * one.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import {
  booleanAdd,
  booleanIntersection,
  booleanSubtract,
} from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { harnessCanvas } from './support/pcb_tool_harness.js';

const MM = (n: number): number => mmToIU(n);
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Ring area by the shoelace formula, in mm². */
const areaMM = (pts: readonly { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2 / 1e12;
};

type Rect = [number, number, number, number];

/** Two 10 mm squares overlapping by a 5 x 5 mm corner. */
const OVERLAPPING: Rect[] = [
  [0, 0, 10, 10],
  [5, 5, 15, 15],
];

interface Run {
  board: BOARD;
  infobar: string[];
}

/**
 * Filled `gr_rect`s on F.SilkS (the first with its own layer/width/fill when
 * given), selected in `aOrder` (default: as listed), then `aAction` run.
 */
function run(
  aRects: Rect[],
  aAction: TOOL_ACTION,
  aOrder?: number[],
  aFirst = '(stroke (width 0.15) (type solid)) (fill yes) (layer "F.SilkS")',
): Run {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  const infobar: string[] = [];
  const frame = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  frame.ShowInfoBarMsg = (aMsg: string) => {
    infobar.push(aMsg);
  };
  const text = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen"))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  ${aRects
    .map(
      ([x0, y0, x1, y1], i) =>
        `(gr_rect (start ${x0} ${y0}) (end ${x1} ${y1}) ${
          i === 0 ? aFirst : '(stroke (width 0.15) (type solid)) (fill yes) (layer "F.SilkS")'
        } (uuid "${U(i + 1)}"))`,
    )
    .join('\n  ')}
)`;
  const board = ParseBoard(text);
  frame.SetBoard(board, false);
  frame.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));
  const { view, controls } = harnessCanvas(board, frame, {
    mouse: { x: MM(-100), y: MM(-100) },
    forced: null,
  });
  frame.GetToolManager()!.SetEnvironment(board, view, controls, settings as never, frame);

  const items = board.Drawings();
  const tool = frame.GetSelectionTool();

  for (const i of aOrder ?? items.map((_, n) => n)) tool.AddItemToSel(items[i]!, true);

  frame.GetToolManager()!.RunAction(aAction);
  return { board, infobar };
}

/** Each shape's area, outlines less holes, in mm². */
const areas = (b: BOARD): number[] =>
  b.Drawings().map((d) => {
    const shape = d as PCB_SHAPE;

    // A source the routine kept is still its gr_rect.
    if (shape.GetShape() === SHAPE_T.RECTANGLE) return areaMM(shape.GetRectCorners());

    const poly = shape.GetPolyShape();
    let a = 0;

    for (let o = 0; o < poly.OutlineCount(); o++) {
      a += areaMM(poly.COutline(o).CPoints());

      for (let h = 0; h < poly.HoleCount(o); h++) a -= areaMM(poly.CHole(o, h).CPoints());
    }

    return Math.round(a * 1000) / 1000;
  });

const polys = (b: BOARD): PCB_SHAPE[] =>
  b.Drawings().filter((d) => (d as PCB_SHAPE).GetShape() === SHAPE_T.POLY) as PCB_SHAPE[];

describe('the underlying boolean ops', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => [
    [
      { x: MM(x0), y: MM(y0) },
      { x: MM(x1), y: MM(y0) },
      { x: MM(x1), y: MM(y1) },
      { x: MM(x0), y: MM(y1) },
    ],
  ];

  it('unions two overlapping squares to 175 mm²', () => {
    const r = booleanAdd([sq(0, 0, 10, 10)], [sq(5, 5, 15, 15)]);

    expect(r).toHaveLength(1);
    expect(areaMM(r[0]![0]!)).toBeCloseTo(175, 3);
  });

  it('subtracts to 75 mm²', () => {
    const r = booleanSubtract([sq(0, 0, 10, 10)], [sq(5, 5, 15, 15)]);

    expect(areaMM(r[0]![0]!)).toBeCloseTo(75, 3);
  });

  it('intersects to 25 mm²', () => {
    const r = booleanIntersection([sq(0, 0, 10, 10)], [sq(5, 5, 15, 15)]);

    expect(areaMM(r[0]![0]!)).toBeCloseTo(25, 3);
  });

  it('returns nothing when there is no overlap to intersect', () => {
    expect(booleanIntersection([sq(0, 0, 10, 10)], [sq(50, 50, 60, 60)])).toEqual([]);
  });

  it('keeps disjoint results apart', () => {
    // A union of two squares that do not touch is two outlines, not one.
    const r = booleanAdd([sq(0, 0, 10, 10)], [sq(50, 50, 60, 60)]);

    expect(r).toHaveLength(2);
  });

  it('reports a hole as a hole, not as a second outline', () => {
    // A ring: a big square minus a small one wholly inside it. The result must
    // be one outline carrying one hole, not two separate outlines — the caller
    // relies on that grouping to know which ring to fracture into which.
    const r = booleanSubtract([sq(0, 0, 30, 30)], [sq(10, 10, 20, 20)]);

    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(2);
    expect(areaMM(r[0]![0]!)).toBeCloseTo(900, 3);
    expect(areaMM(r[0]![1]!)).toBeCloseTo(100, 3);
  });
});

describe('merging on the board', () => {
  it('replaces both sources with one shape of the union area', () => {
    const { board, infobar } = run(OVERLAPPING, PCB_ACTIONS.mergePolygons);

    expect(polys(board)).toHaveLength(1);
    expect(areas(board)).toEqual([175]);
    expect(infobar).toEqual([]);
  });

  it('takes the layer, width and fill from the last one selected', () => {
    // GetLastAddedItem() is put at the front: the property donor and the basis.
    const donor = '(stroke (width 0.4) (type solid)) (fill no) (layer "B.SilkS")';
    const last = run(OVERLAPPING, PCB_ACTIONS.mergePolygons, [1, 0], donor).board.Drawings();
    const shape = last[0] as PCB_SHAPE;

    expect(shape.GetLayerName()).toBe('B.Silkscreen');
    expect(shape.GetWidth()).toBe(MM(0.4));
    expect(shape.IsSolidFill()).toBe(false);

    const first = run(OVERLAPPING, PCB_ACTIONS.mergePolygons, [0, 1], donor).board.Drawings();
    expect((first[0] as PCB_SHAPE).GetLayerName()).toBe('F.Silkscreen');
  });

  it('leaves disjoint sources as one shape per outline', () => {
    const { board } = run(
      [
        [0, 0, 10, 10],
        [50, 50, 60, 60],
      ],
      PCB_ACTIONS.mergePolygons,
    );

    expect(areas(board)).toEqual([100, 100]);
  });

  it('folds a third source into the running result', () => {
    const { board } = run(
      [
        [0, 0, 10, 10],
        [5, 5, 15, 15],
        [10, 10, 20, 20],
      ],
      PCB_ACTIONS.mergePolygons,
    );

    expect(polys(board)).toHaveLength(1);
  });
});

describe('subtracting on the board', () => {
  it('leaves the last selected minus the rest', () => {
    const { board } = run(OVERLAPPING, PCB_ACTIONS.subtractPolygons);

    expect(areas(board)).toEqual([75]);
    // The basis is the second square, (5,5)-(15,15).
    const box = polys(board)[0]!.GetPolyShape().BBox();
    expect([box.GetX(), box.GetY()]).toEqual([MM(5), MM(5)]);
  });

  it('depends on the order, unlike merging', () => {
    const { board } = run(OVERLAPPING, PCB_ACTIONS.subtractPolygons, [1, 0]);
    const box = polys(board)[0]!.GetPolyShape().BBox();

    expect(areas(board)).toEqual([75]);
    expect([box.GetX(), box.GetY()]).toEqual([0, 0]);
  });

  it('fractures a hole into the outline rather than losing it', () => {
    // A ring: the big square minus a small one wholly inside it. Selected
    // big-first, the small one is the basis and comes out empty, so upstream
    // retries largest-first and gets the ring: 900 - 100 = 800 mm². Then
    // EDA_SHAPE::SetPolyShape fractures any hole (eda_shape.h:356-368), so
    // the shape has none, and the area is what proves the hole survived.
    const { board } = run(
      [
        [0, 0, 30, 30],
        [10, 10, 20, 20],
      ],
      PCB_ACTIONS.subtractPolygons,
    );

    expect(areas(board)).toEqual([800]);
    expect(polys(board)[0]!.GetPolyShape().HoleCount(0)).toBe(0);
  });

  it('splits a shape a subtraction cuts in two', () => {
    // A bar straight across the middle leaves two pieces, each its own shape.
    const { board } = run(
      [
        [-5, 12, 35, 18],
        [0, 0, 30, 30],
      ],
      PCB_ACTIONS.subtractPolygons,
    );

    expect(areas(board)).toEqual([360, 360]);
  });
});

describe('intersecting on the board', () => {
  it('leaves only the overlap', () => {
    const { board } = run(OVERLAPPING, PCB_ACTIONS.intersectPolygons);

    expect(areas(board)).toEqual([25]);
  });

  it('refuses a source that would erase everything, and says so', () => {
    // Intersecting with something that does not overlap would leave nothing at
    // all; the source is kept and the basis comes back as it was.
    const { board, infobar } = run(
      [
        [0, 0, 10, 10],
        [50, 50, 60, 60],
      ],
      PCB_ACTIONS.intersectPolygons,
    );

    expect(areas(board).sort()).toEqual([100, 100]);
    expect(infobar).toEqual(['Unable to intersect the selected polygons.']);
  });

  it('still folds in the sources that do overlap', () => {
    const { board, infobar } = run(
      [
        [0, 0, 10, 10],
        [50, 50, 60, 60],
        [5, 5, 15, 15],
      ],
      PCB_ACTIONS.intersectPolygons,
    );

    // The basis (last selected) meets the first square; the far one is kept.
    expect(areas(board).sort((a, b) => a - b)).toEqual([25, 100]);
    expect(infobar).toEqual(['Some of the polygons could not be intersected.']);
  });
});
