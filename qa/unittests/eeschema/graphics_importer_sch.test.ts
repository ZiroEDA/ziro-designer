// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRAPHICS_IMPORTER_SCH` — the schematic half of graphics import.
 *
 * The parsers and the buffer are shared with the board and already tested; what
 * is specific here is the mapping: schematic internal units, the coordinate
 * order (scale, then offset, then mm-to-IU), the averaged line-width scale, and
 * the `-1` stroke width that means "no stroke" in Eeschema and nowhere else.
 */
import { describe, it, expect } from 'vitest';
import {
  GRAPHICS_IMPORTER_SCH,
  type SchImportedItem,
} from '@ziroeda/eeschema/src/import_gfx/graphics_importer_sch.js';
import { IMPORTED_STROKE } from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import { LINE_STYLE } from '@ziroeda/common/src/stroke_params.js';
import { COLOR4D_BLACK } from '@ziroeda/common/src/color4d.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibGraphic, Stroke } from '@ziroeda/eeschema/src/types.js';

const plain = () => new IMPORTED_STROKE(0.2, LINE_STYLE.SOLID);

/** An importer at 1:1 with no offset, the identity case. */
function importer(): GRAPHICS_IMPORTER_SCH {
  const imp = new GRAPHICS_IMPORTER_SCH();
  imp.SetScale({ x: 1, y: 1 });
  imp.SetImportOffsetMM({ x: 0, y: 0 });
  imp.SetLineWidthMM(0.2);
  return imp;
}

const graphics = (items: readonly SchImportedItem[]) =>
  items.flatMap((i) => (i.type === 'graphic' ? [i.graphic] : []));

/** `LibGraphic` is a union and not every arm is stroked (text is not). */
const strokeOf = (g: LibGraphic): Stroke | undefined => ('stroke' in g ? g.stroke : undefined);

describe('mapping into schematic internal units', () => {
  it('uses schIUScale, not the board scale', () => {
    // The only reason this class exists apart from GRAPHICS_IMPORTER_PCBNEW.
    const imp = importer();
    imp.AddLine({ x: 0, y: 0 }, { x: 10, y: 0 }, plain());
    const g = graphics(imp.GetItems())[0]!;
    expect(g.kind === 'polyline' && g.points[1]!.x).toBe(mmToIU(10));
  });

  it('applies the offset in millimetres of the scaled drawing, not the file', () => {
    // `coord *= scale; coord += offset; coord *= mmToIu` — so halving the scale
    // leaves the offset landing the drawing in the same place.
    const imp = importer();
    imp.SetScale({ x: 0.5, y: 0.5 });
    imp.SetImportOffsetMM({ x: 100, y: 0 });
    imp.AddLine({ x: 0, y: 0 }, { x: 10, y: 0 }, plain());
    const g = graphics(imp.GetItems())[0]!;
    if (g.kind !== 'polyline') throw new Error('expected a polyline');
    expect(g.points[0]!.x).toBe(mmToIU(100));
    expect(g.points[1]!.x).toBe(mmToIU(105));
  });

  it('skips a zero-length line', () => {
    // "Skip 0 len lines" — an artefact of the conversion, not content.
    const imp = importer();
    imp.AddLine({ x: 5, y: 5 }, { x: 5, y: 5 }, plain());
    expect(imp.GetItems()).toHaveLength(0);
  });
});

describe('the stroke width', () => {
  it('scales by the averaged X/Y factor, because a stroke has no direction', () => {
    const imp = importer();
    imp.SetScale({ x: 2, y: 4 }); // averaged: 3
    imp.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, new IMPORTED_STROKE(1, LINE_STYLE.SOLID));
    const g = graphics(imp.GetItems())[0]!;
    expect(strokeOf(g)?.width).toBe(Math.trunc(1 * 3 * mmToIU(1)));
  });

  it('truncates rather than rounding, as the C++ int cast does', () => {
    const imp = importer();
    // A width whose IU value has a fractional part: 0.10005 mm.
    imp.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, new IMPORTED_STROKE(0.10005, LINE_STYLE.SOLID));
    const g = graphics(imp.GetItems())[0]!;
    const exact = 0.10005 * mmToIU(1);
    expect(strokeOf(g)?.width).toBe(Math.trunc(exact));
    expect(strokeOf(g)?.width).not.toBe(Math.round(exact));
  });

  it('falls back to the importer default when the file gave no width', () => {
    const imp = importer();
    imp.AddLine({ x: 0, y: 0 }, { x: 1, y: 0 }, new IMPORTED_STROKE(0, LINE_STYLE.SOLID));
    const g = graphics(imp.GetItems())[0]!;
    expect(strokeOf(g)?.width).toBe(Math.trunc(0.2 * mmToIU(1)));
  });

  it('passes -1 straight through: in Eeschema it means "no stroke"', () => {
    // The sentinel the board sink has to translate away and this one must not.
    // Clamping it to 0 would give every unstroked import an outline.
    const imp = importer();
    imp.AddCircle(
      { x: 0, y: 0 },
      5,
      new IMPORTED_STROKE(-1, LINE_STYLE.SOLID),
      true,
      COLOR4D_BLACK,
    );
    const g = graphics(imp.GetItems())[0]!;
    expect(strokeOf(g)?.width).toBe(-1);
  });
});

describe('the shapes', () => {
  it('a circle takes its radius from the mapped edge, not a scaled scalar', () => {
    const imp = importer();
    imp.SetScale({ x: 3, y: 3 });
    imp.AddCircle({ x: 0, y: 0 }, 5, plain(), false, COLOR4D_BLACK);
    const g = graphics(imp.GetItems())[0]!;
    expect(g.kind === 'circle' && g.radius).toBe(mmToIU(15));
  });

  it('a polygon repeats its first vertex to close the outline', () => {
    // "Need to close last point for libedit" — an explicit repeat, not an
    // implicit close, so the saved file matches what KiCad writes.
    const imp = importer();
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    imp.AddPolygon(pts, plain(), false, COLOR4D_BLACK);
    const g = graphics(imp.GetItems())[0]!;
    if (g.kind !== 'polyline') throw new Error('expected a polyline');
    expect(g.points).toHaveLength(4);
    expect(g.points[3]).toEqual(g.points[0]);
  });

  it('an empty polygon produces nothing', () => {
    const imp = importer();
    imp.AddPolygon([], plain(), false, COLOR4D_BLACK);
    expect(imp.GetItems()).toHaveLength(0);
  });

  it('a spline whose controls sit on the chord is demoted to a line', () => {
    // setupSplineOrLine: a cubic drawn the long way round is a segment. The
    // accuracy it judges by here is half the stroke width, not the board's arc
    // tolerance.
    const imp = importer();
    imp.AddSpline({ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 }, plain());
    const g = graphics(imp.GetItems())[0]!;
    expect(g.kind).toBe('polyline');
  });

  it('and a real curve stays a four-point bezier', () => {
    const imp = importer();
    imp.AddSpline({ x: 0, y: 0 }, { x: 3, y: 8 }, { x: 6, y: -8 }, { x: 9, y: 0 }, plain());
    const g = graphics(imp.GetItems())[0]!;
    expect(g.kind).toBe('bezier');
    expect(g.kind === 'bezier' && g.points).toHaveLength(4);
  });
});

describe('text', () => {
  it('becomes a free-text label, not a graphic', () => {
    // SCH_TEXT is not a SCH_SHAPE, and in this model it lives in `labels`.
    const imp = importer();
    imp.AddText({ x: 1, y: 2 }, 'hello', 2, 1, 0.1, 0, -1, -1, COLOR4D_BLACK);
    const items = imp.GetItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('text');
    if (items[0]!.type !== 'text') throw new Error('expected text');
    expect(items[0]!.text.kind).toBe('text');
    expect(items[0]!.text.text).toBe('hello');
    expect(items[0]!.text.at).toEqual({ x: mmToIU(1), y: mmToIU(2) });
  });

  it('takes its size from the Y factor alone, and never negative', () => {
    // Text has a direction, so it is not scaled by the averaged factor a stroke
    // gets; a mirrored import gives a negative factor and a size cannot be one.
    const imp = importer();
    imp.SetScale({ x: 1, y: -2 });
    imp.AddText({ x: 0, y: 0 }, 'x', 3, 1, 0, 0, -1, -1, COLOR4D_BLACK);
    const items = imp.GetItems();
    if (items[0]!.type !== 'text') throw new Error('expected text');
    expect(items[0]!.text.effects?.fontSize?.[1]).toBe(mmToIU(6));
  });
});
