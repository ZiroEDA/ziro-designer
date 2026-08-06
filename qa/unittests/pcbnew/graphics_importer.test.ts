// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import { LINE_STYLE } from '@ziroeda/pcbnew/src/plot_dxf.js';
import {
  BOX2D,
  COLOR4D_UNSPECIFIED,
  GRAPHICS_IMPORTER_BUFFER,
  IMPORTED_ARC,
  IMPORTED_LINE,
  IMPORTED_STROKE,
  IMPORTED_TEXT,
  POLY_FILL_RULE,
  matrixIdentity,
  type IMPORTED_ITEM,
  type MATRIX3x3D,
} from '@ziroeda/pcbnew/src/graphics_importer.js';
import {
  GRAPHICS_IMPORTER_PCBNEW,
  setupSplineOrLine,
} from '@ziroeda/pcbnew/src/graphics_importer_pcbnew.js';

/** A stroke the parsers would build: width in mm, plus a line style. */
const stroke = (width: number, style = LINE_STYLE.SOLID): IMPORTED_STROKE =>
  new IMPORTED_STROKE(width, style, COLOR4D_UNSPECIFIED);

const shapesOf = (items: IMPORTED_ITEM[]) =>
  items.filter((i) => i.type === 'shape').map((i) => i.shape);

const textsOf = (items: IMPORTED_ITEM[]) =>
  items.filter((i) => i.type === 'text').map((i) => i.text);

describe('GRAPHICS_IMPORTER_PCBNEW: the placement model', () => {
  it('scales, then offsets, then converts to internal units', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetScale({ x: 2, y: 2 });
    imp.SetImportOffsetMM({ x: 5, y: -5 });

    // (10 * 2 + 5) mm and (20 * 2 - 5) mm, at 1e6 IU per mm. Applying the
    // offset before the scale would give 30 mm and 30 mm instead.
    expect(imp.MapCoordinate({ x: 10, y: 20 })).toEqual({ x: 25_000_000, y: 35_000_000 });
  });

  it('leaves the offset meaning the same when the scale changes', () => {
    const half = new GRAPHICS_IMPORTER_PCBNEW();
    half.SetScale({ x: 0.5, y: 0.5 });
    half.SetImportOffsetMM({ x: 100, y: 100 });

    // The drawing shrinks around the offset; the offset itself does not move.
    // A scale applied after the offset would drag it to 50 mm.
    expect(half.MapCoordinate({ x: 0, y: 0 })).toEqual({ x: 100_000_000, y: 100_000_000 });
  });

  it('rounds coordinates but truncates widths', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();

    // 0.0000005 mm is half an internal unit: KiROUND takes it away from zero,
    // while MapLineWidth's int() cast drops it. Swapping either one for the
    // other moves every imported coordinate or every imported width by 1 IU.
    expect(imp.MapCoordinate({ x: 0.0000005, y: -0.0000005 })).toEqual({ x: 1, y: -1 });
    expect(imp.MapLineWidth(0.0000015)).toBe(1);
  });

  it('averages the two scale factors for a line width', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetScale({ x: 1, y: 3 });

    // A stroke has no direction, so it gets (1 + 3) / 2 = 2 million IU per mm.
    // Taking either axis alone would give 1e6 or 3e6.
    expect(imp.MapLineWidth(1)).toBe(2_000_000);
  });

  it('falls back to the default line width for any non-positive width but -1', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLineWidthMM(0.25);

    // -1 is the parsers' "no stroke", and must survive as zero width.
    expect(imp.MapStrokeParams(stroke(-1)).width).toBe(0);
    // Everything else non-positive means "the file did not say" and picks up
    // the default. Collapsing the two would silently stroke a fill-only shape.
    expect(imp.MapStrokeParams(stroke(0)).width).toBe(250_000);
    expect(imp.MapStrokeParams(stroke(-2)).width).toBe(250_000);
    expect(imp.MapStrokeParams(stroke(0.5)).width).toBe(500_000);
  });

  it('carries the line style through to the board stroke type', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();

    expect(imp.MapStrokeParams(stroke(1, LINE_STYLE.DEFAULT)).plotStyle).toBe('default');
    expect(imp.MapStrokeParams(stroke(1, LINE_STYLE.DASH)).plotStyle).toBe('dash');
    expect(imp.MapStrokeParams(stroke(1, LINE_STYLE.DOT)).plotStyle).toBe('dot');
    expect(imp.MapStrokeParams(stroke(1, LINE_STYLE.DASHDOT)).plotStyle).toBe('dash_dot');
    expect(imp.MapStrokeParams(stroke(1, LINE_STYLE.DASHDOTDOT)).plotStyle).toBe('dash_dot_dot');
  });
});

describe('GRAPHICS_IMPORTER_PCBNEW: entity to board graphic', () => {
  it('drops a segment whose ends round to the same internal unit', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();

    // A tenth of a nanometre apart in the source is the same point on the
    // board, and a zero-length graphic is invisible and unselectable.
    imp.AddLine({ x: 0, y: 0 }, { x: 0.0000001, y: 0 }, stroke(0.1));
    expect(imp.GetItems()).toHaveLength(0);

    imp.AddLine({ x: 0, y: 0 }, { x: 0.000001, y: 0 }, stroke(0.1));
    expect(shapesOf(imp.GetItems())).toEqual([
      {
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        width: 100_000,
        strokeType: 'solid',
        fill: false,
        layer: 'Dwgs.User',
      },
    ]);
  });

  it('gives a circle a centre and a point one radius away along +X', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetImportOffsetMM({ x: 10, y: 0 });
    imp.AddCircle({ x: 1, y: 2 }, 3, stroke(0.1), true, COLOR4D_UNSPECIFIED);

    // The radius point goes through MapCoordinate, so it carries the offset
    // too — the *difference* is the radius. Mapping the radius as a length
    // would put the end point at 3 mm rather than 14 mm.
    expect(shapesOf(imp.GetItems())[0]).toMatchObject({
      kind: 'circle',
      center: { x: 11_000_000, y: 2_000_000 },
      end: { x: 14_000_000, y: 2_000_000 },
      fill: true,
    });
  });

  it('rotates an arc in floating point before it meets the unit grid', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.AddArc({ x: 0, y: 0 }, { x: 10, y: 0 }, new EDA_ANGLE(-90), stroke(0.1));

    // The mid point is the start rotated by half the (negated) angle, at
    // millimetre scale. Rounding to internal units first, then rotating, would
    // land somewhere else entirely; 7071068 is 10·cos45° in nanometres.
    expect(shapesOf(imp.GetItems())[0]).toMatchObject({
      kind: 'arc',
      start: { x: 10_000_000, y: 0 },
      mid: { x: 7_071_068, y: -7_071_068 },
      end: { x: 0, y: -10_000_000 },
      fill: false,
    });
  });

  it('degrades an arc too large for the coordinate range to its chord', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    // 2000 mm of radius is 2e9 IU, past half the 32-bit coordinate range.
    imp.AddArc({ x: 0, y: 0 }, { x: 2000, y: 0 }, new EDA_ANGLE(-90), stroke(0.1));

    // A segment, not a dropped shape — and its ends are the arc's own, which
    // means the *unmapped* start and the rotated end were handed to AddLine.
    expect(shapesOf(imp.GetItems())).toEqual([
      {
        kind: 'line',
        start: { x: 2_000_000_000, y: 0 },
        end: { x: 0, y: -2_000_000_000 },
        width: 100_000,
        strokeType: 'solid',
        fill: false,
        layer: 'Dwgs.User',
      },
    ]);
  });

  it('refuses a polygon of two points or fewer', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();

    // IsPolyShapeValid: an outline needs more than two points to enclose
    // anything, and a two-point "polygon" would be written to the file.
    imp.AddPolygon(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      stroke(0.1),
      true,
      COLOR4D_UNSPECIFIED,
    );
    expect(imp.GetItems()).toHaveLength(0);

    imp.AddPolygon(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      stroke(0.1),
      true,
      COLOR4D_UNSPECIFIED,
    );
    expect(shapesOf(imp.GetItems())[0]).toMatchObject({
      kind: 'poly',
      pts: [
        { x: 0, y: 0 },
        { x: 1_000_000, y: 0 },
        { x: 1_000_000, y: 1_000_000 },
      ],
      fill: true,
    });
  });

  it('truncates text size and maps its thickness like a line width', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.AddText(
      { x: 1, y: 2 },
      'ABC',
      2.0000009,
      1.0000009,
      0.15,
      30,
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.TOP,
      COLOR4D_UNSPECIFIED,
    );

    // .9 of an internal unit is dropped on both axes: these are int setters fed
    // a double. Rounding them would give 2000001 / 1000001.
    expect(textsOf(imp.GetItems())[0]).toEqual({
      kind: 'user',
      text: 'ABC',
      at: { x: 1_000_000, y: 2_000_000 },
      angle: 30,
      layer: 'Dwgs.User',
      size: { x: 1_000_000, y: 2_000_000 },
      thickness: 150_000,
      justify: ['left', 'top'],
    });
  });

  it('takes the default line width for text of unspecified thickness', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLineWidthMM(0.3);
    imp.AddText(
      { x: 0, y: 0 },
      'A',
      1,
      1,
      -1,
      0,
      GR_TEXT_H_ALIGN_T.CENTER,
      GR_TEXT_V_ALIGN_T.CENTER,
      COLOR4D_UNSPECIFIED,
    );

    // Text thickness goes through MapLineWidth, not MapStrokeParams, so -1 is
    // "unspecified" here rather than "no stroke": it must not become zero.
    expect(textsOf(imp.GetItems())[0]?.thickness).toBe(300_000);
  });

  it('writes only the non-centre justification words, on both axes', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    const add = (h: GR_TEXT_H_ALIGN_T, v: GR_TEXT_V_ALIGN_T): void =>
      imp.AddText({ x: 0, y: 0 }, 'A', 1, 1, 0.1, 0, h, v, COLOR4D_UNSPECIFIED);

    add(GR_TEXT_H_ALIGN_T.LEFT, GR_TEXT_V_ALIGN_T.BOTTOM);
    add(GR_TEXT_H_ALIGN_T.RIGHT, GR_TEXT_V_ALIGN_T.TOP);
    add(GR_TEXT_H_ALIGN_T.CENTER, GR_TEXT_V_ALIGN_T.CENTER);

    // Each of the four non-default words has to reach the file, and neither
    // `center` may: KiCad never writes it, so emitting one changes the file on
    // every save. Left/right and top/bottom are checked in both directions
    // because swapping a single arm of either ternary is otherwise invisible.
    expect(textsOf(imp.GetItems()).map((t) => t.justify)).toEqual([
      ['left', 'bottom'],
      ['right', 'top'],
      [],
    ]);
  });
});

describe('setupSplineOrLine', () => {
  it('demotes a cubic whose control points sit on the chord', () => {
    // Both control points are on the straight line from start to end; this is a
    // segment drawn the long way round and importing it as a curve would give
    // the user four control points to drag on a straight line.
    expect(
      setupSplineOrLine(
        { x: 0, y: 0 },
        { x: 1_000_000, y: 0 },
        { x: 2_000_000, y: 0 },
        { x: 3_000_000, y: 0 },
        5000,
      ),
    ).toBe('line');
  });

  it('discards a demoted segment shorter than 20 nm', () => {
    // A 10 IU chord is a rounding artefact of the conversion, not a drawn line.
    expect(
      setupSplineOrLine({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 0 }, 5000),
    ).toBeNull();

    // 20 IU is the threshold and is kept: the comparison is strictly less-than.
    expect(
      setupSplineOrLine({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 }, { x: 20, y: 0 }, 5000),
    ).toBe('line');
  });

  it('keeps a curve that actually bends', () => {
    expect(
      setupSplineOrLine(
        { x: 0, y: 0 },
        { x: 0, y: 10_000_000 },
        { x: 10_000_000, y: 10_000_000 },
        { x: 10_000_000, y: 0 },
        5000,
      ),
    ).toBe('curve');
  });
});

describe('GRAPHICS_IMPORTER_PCBNEW: splines', () => {
  it('imports a bending spline as its four control points', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.AddSpline({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, stroke(0.1));

    expect(shapesOf(imp.GetItems())[0]).toEqual({
      kind: 'curve',
      pts: [
        { x: 0, y: 0 },
        { x: 0, y: 10_000_000 },
        { x: 10_000_000, y: 10_000_000 },
        { x: 10_000_000, y: 0 },
      ],
      width: 100_000,
      strokeType: 'solid',
      fill: false,
      layer: 'Dwgs.User',
    });
  });

  it('imports a straight spline as a segment, losing the control points', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.AddSpline({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, stroke(0.1));

    expect(shapesOf(imp.GetItems())[0]).toEqual({
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 3_000_000, y: 0 },
      width: 100_000,
      strokeType: 'solid',
      fill: false,
      layer: 'Dwgs.User',
    });
  });

  it('drops a spline that collapses to nothing', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.AddSpline(
      { x: 0, y: 0 },
      { x: 0.000005, y: 0 },
      { x: 0.000008, y: 0 },
      { x: 0.00001, y: 0 },
      stroke(0.1),
    );

    expect(imp.GetItems()).toHaveLength(0);
  });
});

describe('GRAPHICS_IMPORTER_PCBNEW: the source-layer map', () => {
  it('imports everything onto the target layer when no map is set', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLayer('F.SilkS');

    // Without a map the importer knows nothing about DXF layer names, so every
    // one of them is importable and they all land on the chosen layer.
    expect(imp.CanImportSourceLayer('anything')).toBe(true);
    imp.SetCurrentSourceLayer('anything');
    expect(imp.GetLayer()).toBe('F.SilkS');
  });

  it('refuses an unmapped or unassigned source layer once a map is set', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLayerMap(
      new Map([
        ['outline', 'Edge.Cuts'],
        ['notes', null],
      ]),
    );

    expect(imp.CanImportSourceLayer('outline')).toBe(true);
    // Mapped to nothing: KiCad's UNDEFINED/UNSELECTED sentinels, both refused.
    expect(imp.CanImportSourceLayer('notes')).toBe(false);
    // Absent from the map: also refused, which is what makes the map a filter
    // rather than a set of overrides.
    expect(imp.CanImportSourceLayer('hidden')).toBe(false);
  });

  it('resets to the default layer before consulting the map', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLayer('Cmts.User');
    imp.SetLayerMap(new Map([['outline', 'Edge.Cuts']]));

    imp.SetCurrentSourceLayer('outline');
    expect(imp.GetLayer()).toBe('Edge.Cuts');

    // Without the reset, an unmapped layer would inherit Edge.Cuts from the
    // shape before it and put a stray graphic on the board outline.
    imp.SetCurrentSourceLayer('somewhere-else');
    expect(imp.GetLayer()).toBe('Cmts.User');
  });

  it('clears the map back to importing everything', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLayerMap(new Map([['outline', 'Edge.Cuts']]));
    imp.ClearLayerMap();

    expect(imp.CanImportSourceLayer('hidden')).toBe(true);
  });
});

describe('GRAPHICS_IMPORTER_BUFFER', () => {
  it('records shapes and replays them into a real importer', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();
    buffer.AddLine({ x: 0, y: 0 }, { x: 10, y: 0 }, stroke(0.1));
    buffer.AddCircle({ x: 0, y: 0 }, 5, stroke(0.1), false);

    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    buffer.ImportTo(imp);

    expect(shapesOf(imp.GetItems()).map((s) => s.kind)).toEqual(['line', 'circle']);
  });

  it('lists each source layer once, in the order first seen', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();
    buffer.SetCurrentSourceLayer('b');
    buffer.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, stroke(0.1));
    buffer.SetCurrentSourceLayer('a');
    buffer.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, stroke(0.1));
    buffer.SetCurrentSourceLayer('b');
    buffer.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, stroke(0.1));
    buffer.SetCurrentSourceLayer('');
    buffer.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, stroke(0.1));

    // The dialog shows this list; sorting it or letting the blank layer in
    // would change what the user is asked to map.
    expect(buffer.GetSourceLayers()).toEqual(['b', 'a']);
  });

  it('lets a shape built elsewhere keep the layer it already carries', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();
    buffer.SetCurrentSourceLayer('insert-layer');

    const fromBlock = new IMPORTED_LINE({ x: 0, y: 0 }, { x: 1, y: 0 }, stroke(0.1));
    fromBlock.SetSourceLayer('block-layer');
    buffer.AddShape(fromBlock);

    const unlabelled = new IMPORTED_LINE({ x: 0, y: 0 }, { x: 1, y: 0 }, stroke(0.1));
    buffer.AddShape(unlabelled);

    // A DXF INSERT only lends its own layer to block content that had none.
    expect(buffer.GetShapes().map((s) => s.GetSourceLayer())).toEqual([
      'block-layer',
      'insert-layer',
    ]);
  });

  it('tags a polygon with the shape whose fill rule it shares', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();

    // Before any NewShape the index is -1, which is the marker for "not part of
    // a nested shape" — upstream reaches the same -1 by unsigned underflow.
    buffer.AddPolygon([{ x: 0, y: 0 }], stroke(0.1), true);
    buffer.NewShape(POLY_FILL_RULE.PF_EVEN_ODD);
    buffer.AddPolygon([{ x: 0, y: 0 }], stroke(0.1), true);
    buffer.NewShape();
    buffer.AddPolygon([{ x: 0, y: 0 }], stroke(0.1), true);

    expect(buffer.GetShapes().map((s) => s.GetParentShapeIndex())).toEqual([-1, 0, 1]);
  });
});

describe('GRAPHICS_IMPORTER_BUFFER.ImportTo: fitting the drawing in 32-bit units', () => {
  /** A buffer holding one axis-aligned box of the given millimetre extent. */
  const boxBuffer = (x1: number, y1: number, x2: number, y2: number): GRAPHICS_IMPORTER_BUFFER => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();
    buffer.AddLine({ x: x1, y: y1 }, { x: x2, y: y2 }, stroke(0.1));
    return buffer;
  };

  it('imports nothing at all from an empty buffer', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    new GRAPHICS_IMPORTER_BUFFER().ImportTo(imp);

    expect(imp.GetItems()).toHaveLength(0);
    expect(imp.GetMessages()).toBe('');
  });

  it('refuses a drawing wider than the coordinate range, and says how much to shrink', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    boxBuffer(0, 0, 3000, 10).ImportTo(imp);

    // 3000 mm is 3e9 IU, past INT_MAX. Nothing is imported...
    expect(imp.GetItems()).toHaveLength(0);
    // ...and the message quotes a scale derived from the *smaller* dimension:
    // upstream takes the max of the two candidate ratios, which for anything
    // but a square is the one that does not fit. Reported verbatim, six
    // decimals, as wxString::Format's %f writes it — a "fixed" min here would
    // change the number KiCad shows the user.
    expect(imp.GetMessages()).toBe(
      `Imported graphic is too large. Maximum scale is ${(2147483647 / (1e6 + 100) / 10).toFixed(6)}\n`,
    );
  });

  it('measures the scaled drawing, not the source one', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetScale({ x: 3, y: 3 });
    boxBuffer(0, 0, 1000, 10).ImportTo(imp);

    // 1000 mm fits; 1000 mm at 3x does not. Checking the unscaled extent would
    // let this one through and produce coordinates that overflow.
    expect(imp.GetItems()).toHaveLength(0);
    expect(imp.GetMessages()).toContain('too large');
  });

  it('recentres a small drawing that sits outside the coordinate range', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    boxBuffer(3000, 3000, 3100, 3100).ImportTo(imp);

    // The drawing is only 100 mm across, so it is not too large — it is merely
    // in the wrong place, and the unset offset is set to bring it to the origin.
    expect(imp.GetImportOffsetMM()).toEqual({ x: -3000, y: -3000 });
    expect(shapesOf(imp.GetItems())[0]).toMatchObject({ start: { x: 0, y: 0 } });
  });

  it('leaves the offset alone when the drawing already fits', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    boxBuffer(0, 0, 100, 100).ImportTo(imp);

    // The user did not ask for an offset and does not need one; inventing one
    // here would move every well-behaved import.
    expect(imp.GetImportOffsetMM()).toEqual({ x: 0, y: 0 });
    expect(imp.GetMessages()).toBe('');
  });

  it('walks a user-chosen offset back until the drawing fits, and says so', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetImportOffsetMM({ x: 3000, y: 0 });
    boxBuffer(0, 0, 100, 100).ImportTo(imp);

    // 3100 mm of right edge overflows by 3100e6 - INT_MAX; the offset gives up
    // that much plus a 100 IU margin. A chosen offset is nudged, never replaced
    // by the recentring the previous test does.
    const overflow = (3100 * 1e6 - 2147483647 + 100) / 1e6;
    expect(imp.GetImportOffsetMM().x).toBeCloseTo(3000 - overflow, 9);
    expect(imp.GetImportOffsetMM().y).toBe(0);
    expect(imp.GetMessages()).toContain('Import offset adjusted to');
  });

  it('treats a half-set offset as chosen', () => {
    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetImportOffsetMM({ x: 0, y: 5 });
    boxBuffer(3000, 3000, 3100, 3100).ImportTo(imp);

    // Only *both* components being zero counts as "no offset chosen". This
    // offset is nudged, so the y still remembers the user's 5 mm; the
    // recentring branch would have replaced both with a flat -3000.
    expect(imp.GetImportOffsetMM().x).toBeCloseTo((2147483647 - 100) / 1e6 - 3100, 9);
    expect(imp.GetImportOffsetMM().y).toBeCloseTo(5 + (2147483647 - 100) / 1e6 - 3105, 9);
    expect(imp.GetMessages()).toContain('Import offset adjusted to');
  });

  it('measures around a shape that has no bounding box at all', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();
    buffer.AddLine({ x: 3000, y: 3000 }, { x: 3100, y: 3100 }, stroke(0.1));
    buffer.AddPolygon([], stroke(0.1), false);

    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    buffer.ImportTo(imp);

    // A vertex-less polygon has an *uninitialised* box, and BOX2D::Merge reads
    // one of those as a zero-size box at the origin whenever the receiver is
    // already initialised. ImportTo therefore tests IsValid itself rather than
    // merging blind: dropping that test would stretch the drawing's extent back
    // to (0, 0) and recentre by nothing instead of by -3000.
    expect(imp.GetImportOffsetMM()).toEqual({ x: -3000, y: -3000 });
  });

  it('skips refused source layers when measuring as well as when importing', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();
    buffer.SetCurrentSourceLayer('keep');
    buffer.AddLine({ x: 0, y: 0 }, { x: 100, y: 100 }, stroke(0.1));
    buffer.SetCurrentSourceLayer('drop');
    buffer.AddLine({ x: 0, y: 0 }, { x: 3000, y: 3000 }, stroke(0.1));

    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLayerMap(
      new Map([
        ['keep', 'F.SilkS'],
        ['drop', null],
      ]),
    );
    buffer.ImportTo(imp);

    // The refused line is 3000 mm long. Had it been measured, the whole import
    // would have been refused as too large instead of yielding one segment.
    expect(shapesOf(imp.GetItems())).toHaveLength(1);
    expect(shapesOf(imp.GetItems())[0]?.layer).toBe('F.SilkS');
  });

  it('clears the current source layer once the replay is done', () => {
    const buffer = new GRAPHICS_IMPORTER_BUFFER();
    buffer.SetCurrentSourceLayer('outline');
    buffer.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, stroke(0.1));

    const imp = new GRAPHICS_IMPORTER_PCBNEW();
    imp.SetLayer('Cmts.User');
    imp.SetLayerMap(new Map([['outline', 'Edge.Cuts']]));
    buffer.ImportTo(imp);

    // Leaving the importer on Edge.Cuts would put whatever is drawn next on the
    // board outline.
    expect(imp.GetLayer()).toBe('Cmts.User');
  });
});

describe('IMPORTED_SHAPE: clone and transform', () => {
  /** Rotate by 90° anticlockwise, as a DXF INSERT would. */
  const rot90: MATRIX3x3D = [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ];

  it('transforms a clone without touching the original', () => {
    const line = new IMPORTED_LINE({ x: 1, y: 0 }, { x: 2, y: 0 }, stroke(0.1));
    line.SetSourceLayer('block');

    const copy = line.clone();
    copy.Transform(rot90, { x: 10, y: 10 });

    // A DXF block is placed many times; sharing state between placements would
    // make each INSERT compound the one before it.
    expect(copy.GetBoundingBox().GetPosition()).toEqual({ x: 10, y: 11 });
    expect(line.GetBoundingBox().GetPosition()).toEqual({ x: 1, y: 0 });
    // The source layer has to survive the clone, or the INSERT's own layer
    // would be lent to block content that already had one.
    expect(copy.GetSourceLayer()).toBe('block');
  });

  it('stretches text as a vector, so the translation column resizes it', () => {
    const text = new IMPORTED_TEXT(
      { x: 0, y: 0 },
      'AB',
      2,
      1,
      0.1,
      0,
      GR_TEXT_H_ALIGN_T.LEFT,
      GR_TEXT_V_ALIGN_T.BOTTOM,
      COLOR4D_UNSPECIFIED,
    );

    const withTranslationColumn: MATRIX3x3D = [
      [1, 0, 5],
      [0, 1, 7],
      [0, 0, 1],
    ];
    text.Transform(withTranslationColumn, { x: 0, y: 0 });

    // Upstream's: the glyph box goes through the same matrix as a point, so a
    // matrix carrying a translation adds it to the text size. Looks like a bug,
    // is upstream's behaviour, and is what the block placement produces.
    const box = text.GetBoundingBox();
    expect(box.GetPosition()).toEqual({ x: 5, y: 7 });
    expect(box.GetSize()).toEqual({ x: (1 + 5) * 2, y: 2 + 7 });
  });

  it('leaves a shape where it was under the identity', () => {
    const line = new IMPORTED_LINE({ x: 3, y: 4 }, { x: 5, y: 6 }, stroke(0.1));
    line.Transform(matrixIdentity(), { x: 0, y: 0 });

    expect(line.GetBoundingBox().GetPosition()).toEqual({ x: 3, y: 4 });
  });
});

describe('BOX2D', () => {
  it('starts invalid rather than as a zero-size box at the origin', () => {
    const box = new BOX2D();
    expect(box.IsValid()).toBe(false);

    // The first merge adopts the point outright. Treating a fresh box as (0,0)
    // would stretch every drawing back to the origin and make a distant one
    // look far too large to import.
    box.MergePoint({ x: 100, y: 100 });
    expect(box.IsValid()).toBe(true);
    expect(box.GetPosition()).toEqual({ x: 100, y: 100 });
    expect(box.GetSize()).toEqual({ x: 0, y: 0 });
  });

  it('grows in both directions as points arrive', () => {
    const box = new BOX2D();
    box.MergePoint({ x: 10, y: 10 }).MergePoint({ x: -5, y: 30 });

    expect(box.GetLeft()).toBe(-5);
    expect(box.GetTop()).toBe(10);
    expect(box.GetRight()).toBe(10);
    expect(box.GetBottom()).toBe(30);
  });

  it('swallows the origin when a valid box is merged with an invalid one', () => {
    const box = new BOX2D().MergePoint({ x: 1, y: 1 });
    box.MergeBox(new BOX2D());

    // Upstream checks the *argument's* init flag only on the path where `this`
    // is uninitialised; a valid box merged with an invalid one takes it at face
    // value as a zero-size box at (0, 0) and stretches to reach it. That is why
    // `ImportTo` guards its own merges with `IsValid()` instead of relying on
    // this — and why a "tidied" early return here would hide the reason.
    expect(box.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(box.GetSize()).toEqual({ x: 1, y: 1 });
  });
});

describe("IMPORTED_ARC.GetBoundingBox: upstream's, faults and all", () => {
  it('sweeps a positive angle', () => {
    const box = new IMPORTED_ARC({ x: 10, y: 0 }, { x: 20, y: 0 }, new EDA_ANGLE(90), stroke(1));

    // The sweep samples every five degrees, and each sample is the *sum* of
    // centre and start run through a rotation-with-reflection, so the box
    // reaches far outside the arc it claims to bound. Reproduced, not fixed.
    expect(box.GetBoundingBox().GetSize().x).toBeGreaterThan(2);
  });

  it('does not sweep a negative one, so a pcbnew-convention arc gets only its ends', () => {
    const box = new IMPORTED_ARC({ x: 10, y: 0 }, { x: 20, y: 0 }, new EDA_ANGLE(-90), stroke(1));

    // `for( angle = 0; angle < m_angle; angle += 5 )` counts up, so a negative
    // sweep never enters the loop and the box is just the start point grown by
    // the stroke width. An `abs()` here would look like a fix and would change
    // which drawings ImportTo calls too large.
    expect(box.GetBoundingBox().GetPosition()).toEqual({ x: 19, y: -1 });
    expect(box.GetBoundingBox().GetSize()).toEqual({ x: 2, y: 2 });
  });
});
