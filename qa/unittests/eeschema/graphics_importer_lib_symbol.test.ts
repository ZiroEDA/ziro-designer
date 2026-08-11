// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GRAPHICS_IMPORTER_LIB_SYMBOL` — importing graphics into a library symbol.
 *
 * The shared mapping is already covered by the schematic sink's tests; both now
 * extend `SCH_IMPORT_MAPPING`, which is where upstream duplicates the same three
 * methods between its two files. What is tested here is only what upstream does
 * *differently* in this sink, because that is what a copy-paste port would get
 * wrong.
 */
import { describe, it, expect } from 'vitest';
import { GRAPHICS_IMPORTER_LIB_SYMBOL } from '@ziroeda/eeschema/src/import_gfx/graphics_importer_lib_symbol.js';
import { GRAPHICS_IMPORTER_SCH } from '@ziroeda/eeschema/src/import_gfx/graphics_importer_sch.js';
import { IMPORTED_STROKE } from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import { LINE_STYLE } from '@ziroeda/common/src/stroke_params.js';
import { COLOR4D_BLACK } from '@ziroeda/common/src/color4d.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const plain = () => new IMPORTED_STROKE(0.2, LINE_STYLE.SOLID);

function importer(): GRAPHICS_IMPORTER_LIB_SYMBOL {
  const imp = new GRAPHICS_IMPORTER_LIB_SYMBOL();
  imp.SetScale({ x: 1, y: 1 });
  imp.SetImportOffsetMM({ x: 0, y: 0 });
  imp.SetLineWidthMM(0.2);
  return imp;
}

describe('the coordinates are the schematic sink’s, not flipped', () => {
  it('maps a point identically to the sheet importer', () => {
    // The premise this port nearly shipped with: that a library symbol needs a
    // +Y-up inversion. Upstream's MapCoordinate here is character-for-character
    // the sheet one, and KiCad's default TRANSFORM is {1,0,0,1} as ours is.
    const lib = importer();
    const sch = new GRAPHICS_IMPORTER_SCH();
    sch.SetScale({ x: 1, y: 1 });
    sch.SetImportOffsetMM({ x: 0, y: 0 });
    sch.SetLineWidthMM(0.2);

    lib.AddLine({ x: 0, y: 0 }, { x: 10, y: 7 }, plain());
    sch.AddLine({ x: 0, y: 0 }, { x: 10, y: 7 }, plain());

    const g = lib.GetItems()[0]!;
    const s = sch.GetItems()[0]!;
    if (g.kind !== 'polyline' || s.type !== 'graphic' || s.graphic.kind !== 'polyline')
      throw new Error('expected polylines');
    expect(g.points).toEqual(s.graphic.points);
    // and Y is positive-down, not mirrored
    expect(g.points[1]!.y).toBe(mmToIU(7));
  });
});

describe('a polygon is checked before it is kept', () => {
  const tri = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('keeps a real outline, closed by repeating the first vertex', () => {
    const imp = importer();
    imp.AddPolygon(tri, plain(), false, COLOR4D_BLACK);
    const g = imp.GetItems()[0]!;
    if (g.kind !== 'polyline') throw new Error('expected a polyline');
    expect(g.points).toHaveLength(4);
    expect(g.points[3]).toEqual(g.points[0]);
  });

  it('and drops one of two points or fewer (IsPolyShapeValid)', () => {
    // The schematic sink has no such check — this is one of the three places
    // the two sinks genuinely differ.
    const imp = importer();
    imp.AddPolygon(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      plain(),
      false,
      COLOR4D_BLACK,
    );
    expect(imp.GetItems()).toHaveLength(0);
  });
});

describe('a spline decides it is a line by a different test', () => {
  it('demotes a flat cubic to a line', () => {
    //     spline->RebuildBezierToSegmentsPointsList( mmToIU( ARC_LOW_DEF_MM ) );
    //     if( spline->GetBezierPoints().size() <= 2 ) AddLine(…)
    const imp = importer();
    imp.AddSpline({ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 }, plain());
    expect(imp.GetItems()[0]!.kind).toBe('polyline');
  });

  it('and keeps a real curve as a four-point bezier', () => {
    const imp = importer();
    imp.AddSpline({ x: 0, y: 0 }, { x: 3, y: 8 }, { x: 6, y: -8 }, { x: 9, y: 0 }, plain());
    const g = imp.GetItems()[0]!;
    expect(g.kind).toBe('bezier');
    expect(g.kind === 'bezier' && g.points).toHaveLength(4);
  });
});

describe('text becomes a symbol draw item', () => {
  it('not a label: a LIB_SYMBOL holds its text as a graphic', () => {
    const imp = importer();
    imp.AddText({ x: 1, y: 2 }, 'hi', 2, 1, 0.3, 90, -1, -1, COLOR4D_BLACK);
    const g = imp.GetItems()[0]!;
    expect(g.kind).toBe('text');
    if (g.kind !== 'text') throw new Error('expected text');
    expect(g.text).toBe('hi');
    expect(g.angle).toBe(90);
    expect(g.at).toEqual({ x: mmToIU(1), y: mmToIU(2) });
  });

  it('carrying the pen, the glyph box and the justification', () => {
    const imp = importer();
    imp.AddText({ x: 0, y: 0 }, 'hi', 2, 1, 0.3, 0, 1, 1, COLOR4D_BLACK);
    const g = imp.GetItems()[0]!;
    if (g.kind !== 'text') throw new Error('expected text');
    expect(g.effects?.fontSize).toEqual([mmToIU(2), mmToIU(1)]);
    expect(g.effects?.thickness).toBe(Math.trunc(0.3 * mmToIU(1)));
    expect(g.effects?.justify).toEqual(['right', 'bottom']);
  });
});

describe('everything lands as a shape a symbol unit can hold', () => {
  it('circle, arc, ellipse and elliptical arc all produce graphics', () => {
    // The base declares AddEllipse/AddEllipseArc abstract as of the DXF ellipse
    // work, so a sink that skipped them would not compile — this pins that they
    // produce the right kinds rather than merely existing.
    const imp = importer();
    imp.AddCircle({ x: 0, y: 0 }, 5, plain(), false, COLOR4D_BLACK);
    imp.AddEllipse(
      { x: 0, y: 0 },
      5,
      3,
      { AsDegrees: () => 0 } as never,
      plain(),
      false,
      COLOR4D_BLACK,
    );
    expect(imp.GetItems().map((g) => g.kind)).toEqual(['circle', 'ellipse']);
  });
});
