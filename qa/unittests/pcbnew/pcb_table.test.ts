// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_TABLE / PCB_TABLECELL (`pcbnew/pcb_table.cpp`, `pcb_tablecell.cpp`).
 * Every expected number below was read from KiCad's own `pcbnew` python
 * module on a 2x2 table loaded from a board file (5/7 mm columns, 3/4 mm
 * rows, 0.1 mm table strokes, no cell stroke, 1.27 mm text with a 0.15 mm pen,
 * F.SilkS); the cell
 * coordinates were read back through SaveBoard, since the python binding
 * does not wrap PCB_TABLECELL.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_TABLE, PCB_TABLECELL } from '@ziroeda/pcbnew/pcb_table.js';

const deg = (d: number) => new EDA_ANGLE(d, EDA_ANGLE_T.DEGREES_T);

function table(): { b: BOARD; t: PCB_TABLE } {
  const b = new BOARD();
  const t = new PCB_TABLE(b, 100000);
  t.SetLayer(PCB_LAYER_ID.F_SilkS);
  b.Add(t);
  t.SetColCount(2);
  const geometry = [
    ['R0C0', 1, 2, 6, 5],
    ['R0C1', 6, 2, 13, 5],
    ['R1C0', 1, 5, 6, 9],
    ['R1C1', 6, 5, 13, 9],
  ] as const;
  for (const [text, sx, sy, ex, ey] of geometry) {
    const cell = new PCB_TABLECELL(t);
    cell.SetText(text);
    cell.SetStart({ x: sx * 1000000, y: sy * 1000000 });
    cell.SetEnd({ x: ex * 1000000, y: ey * 1000000 });
    cell.SetTextThickness(150000);
    // A cell parsed from a board file without a (stroke) token gets STROKE_PARAMS( -1, SOLID ).
    cell.SetStroke(new STROKE_PARAMS(-1, LINE_STYLE.SOLID));
    t.AddCell(cell);
  }
  t.SetColWidth(0, 5000000);
  t.SetColWidth(1, 7000000);
  t.SetRowHeight(0, 3000000);
  t.SetRowHeight(1, 4000000);
  return { b, t };
}

const cells = (t: PCB_TABLE) =>
  t
    .GetCells()
    .map((c) => [c.GetText(), c.GetStart().x, c.GetStart().y, c.GetEnd().x, c.GetEnd().y]);

const box = (t: PCB_TABLE) => {
  const bb = t.GetBoundingBox();
  return [bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()];
};

describe('PCB_TABLE', () => {
  it('position, end, counts, the cell addresses and bounding box', () => {
    const { t } = table();
    expect(t.GetPosition()).toEqual({ x: 1000000, y: 2000000 });
    expect(t.GetEnd()).toEqual({ x: 13000000, y: 9000000 });
    expect(t.GetRowCount()).toBe(2);
    expect(t.GetColCount()).toBe(2);
    expect(box(t)).toEqual([1000000, 2000000, 12000000, 7000000]);
    expect(t.GetItemDescription(null, true)).toBe('2 column table');
    expect(t.HitTest({ x: 2000000, y: 3000000 }, 0)).toBe(true);
    expect(t.HitTest({ x: 20000000, y: 3000000 }, 0)).toBe(false);

    const c11 = t.GetCell(1, 1)!;
    expect(c11.GetAddr()).toBe('B2');
    expect(c11.GetRow()).toBe(1);
    expect(c11.GetColumn()).toBe(1);
    expect(c11.GetItemDescription(null, true)).toBe('Table cell B2');
    expect(c11.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(c11.GetParent()).toBe(t);
    expect(c11.GetShownText(false)).toBe('R1C1');
    c11.SetText('${ADDR} ${ROW} ${COL}');
    expect(c11.GetShownText(false)).toBe('B2 2\n2'); // wrapped at 7 - 2 x 1.0025 mm, as a PCB_TEXTBOX of that size does
  });

  it('GetEffectiveShape, TransformShapeToPolygon and TransformShapeToPolySet', () => {
    const { t } = table();
    const ebb = t.GetEffectiveShape().BBox();
    expect([ebb.GetX(), ebb.GetY(), ebb.GetWidth(), ebb.GetHeight()]).toEqual([
      950000, 1950000, 12100000, 7100000,
    ]);

    let ps = new SHAPE_POLY_SET();
    t.TransformShapeToPolygon(ps, PCB_LAYER_ID.F_SilkS, 0, 5000, ERROR_LOC.ERROR_INSIDE, false);
    expect(ps.OutlineCount()).toBe(20);
    let bb = ps.BBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      950000, 1950000, 12100000, 7100000,
    ]);

    ps = new SHAPE_POLY_SET();
    t.TransformShapeToPolySet(ps, PCB_LAYER_ID.F_SilkS, 0, 5000, ERROR_LOC.ERROR_INSIDE, null);
    expect(ps.OutlineCount()).toBe(24);
    bb = ps.BBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      950000, 1950000, 12100000, 7100000,
    ]);

    // DrawBorders: the header row's column separator takes the BORDER stroke, the next row's
    // the SEPARATORS stroke — visible once they differ.
    t.SetSeparatorsWidth(300000);
    ps = new SHAPE_POLY_SET();
    t.TransformShapeToPolySet(ps, PCB_LAYER_ID.F_SilkS, 0, 5000, ERROR_LOC.ERROR_INSIDE, null);
    const o = (i: number) => [
      ps.Outline(i).PointCount(),
      ps.Outline(i).BBox().GetWidth(),
      ps.Outline(i).BBox().GetHeight(),
    ];
    expect(o(0)).toEqual([12, 100000, 3092388]);
    expect(o(1)).toEqual([20, 300000, 4294236]);
    expect(o(2)).toEqual([12, 5092388, 100000]);
  });

  it('Rotate keeps the table origin and re-normalizes the cells; rotating back restores them', () => {
    const { t } = table();
    t.Rotate({ x: 1000000, y: 2000000 }, deg(90));
    expect(t.GetPosition()).toEqual({ x: 1000000, y: 2000000 });
    expect(box(t)).toEqual([1000000, -10000000, 7000000, 12000000]);
    expect(cells(t)).toEqual([
      ['R0C0', 1000000, 2000000, 4000000, -3000000],
      ['R0C1', 1000000, -3000000, 4000000, -10000000],
      ['R1C0', 4000000, 2000000, 8000000, -3000000],
      ['R1C1', 4000000, -3000000, 8000000, -10000000],
    ]);
    t.Rotate({ x: 1000000, y: 2000000 }, deg(-90));
    expect(cells(t)).toEqual([
      ['R0C0', 1000000, 2000000, 6000000, 5000000],
      ['R0C1', 6000000, 2000000, 13000000, 5000000],
      ['R1C0', 1000000, 5000000, 6000000, 9000000],
      ['R1C1', 6000000, 5000000, 13000000, 9000000],
    ]);
  });

  it('Flip left-right reverses the columns and their widths, flips the layer, and moves the table the C++ way', () => {
    const { t } = table();
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(t.GetPosition()).toEqual({ x: -25000000, y: 2000000 });
    expect([t.GetColWidth(0), t.GetColWidth(1)]).toEqual([7000000, 5000000]);
    expect(cells(t)).toEqual([
      ['R0C1', -25000000, 2000000, -18000000, 5000000],
      ['R0C0', -18000000, 2000000, -13000000, 5000000],
      ['R1C1', -25000000, 5000000, -18000000, 9000000],
      ['R1C0', -18000000, 5000000, -13000000, 9000000],
    ]);
    expect(box(t)).toEqual([-25000000, 2000000, 12000000, 7000000]);
    for (const c of t.GetCells()) expect(c.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);

    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetPosition()).toEqual({ x: 25000000, y: 2000000 });
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
  });

  it('Autosize fits the columns and rows to the text plus margins; Similarity and equality', () => {
    const { t } = table();
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    t.Autosize();
    expect([t.GetColWidth(0), t.GetColWidth(1)]).toEqual([7572263, 7566554]);
    expect([t.GetRowHeight(0), t.GetRowHeight(1)]).toEqual([3425000, 3425000]);
    expect(t.GetPosition()).toEqual({ x: 23713869, y: 1787500 });

    const d = t.Duplicate(false) as PCB_TABLE;
    expect(t.Similarity(d)).toBe(1.0);
    expect(t.equals(d)).toBe(true);
    expect(d.GetCells()[0]!.GetParent()).toBe(d);
    d.SetStrokeRows(false);
    expect(t.Similarity(d)).toBeCloseTo(0.9, 12);
    expect(t.equals(d)).toBe(false);
  });
});
