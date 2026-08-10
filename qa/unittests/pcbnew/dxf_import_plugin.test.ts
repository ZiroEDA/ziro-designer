// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DXF_IMPORT_PLUGIN`, the DXF entity reader.
 *
 * Assertions are made on the *importer calls* — the shapes the plugin buffers,
 * or the items a real `GRAPHICS_IMPORTER_PCBNEW` produces from them — and never
 * on a round-tripped board file, because the board reader and writer both
 * normalise and would launder a wrong coordinate into a plausible one.
 */
import { describe, expect, it } from 'vitest';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import {
  DXF_IMPORT_PLUGIN,
  DXF_IMPORT_UNITS,
  matrixMul,
  matrixSetRotation,
  matrixSetScale,
  matrixZero,
} from '@ziroeda/common/src/import_gfx/dxf_import_plugin.js';
import { SPLINE_ERROR, bsplineToBeziers } from '@ziroeda/common/src/import_gfx/dxf_spline.js';
import {
  DXF_READER,
  stripWhiteSpace,
  toInt,
  toInt16,
  toReal,
} from '@ziroeda/common/src/import_gfx/dxf_reader.js';
import {
  IMPORTED_ARC,
  IMPORTED_CIRCLE,
  IMPORTED_ELLIPSE,
  IMPORTED_ELLIPSE_ARC,
  IMPORTED_LINE,
  IMPORTED_SPLINE,
  IMPORTED_TEXT,
  type IMPORTED_SHAPE,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import { GRAPHICS_IMPORTER_PCBNEW } from '@ziroeda/pcbnew/src/graphics_importer_pcbnew.js';

/** Build DXF text from group couplets. */
const dxf = (pairs: (readonly [number, string])[]): string =>
  `${pairs.map(([c, v]) => `${c}\n${v}`).join('\n')}\n`;

/** Wrap entity couplets in the ENTITIES section every DXF carries. */
const entities = (pairs: (readonly [number, string])[]): string =>
  dxf([[0, 'SECTION'], [2, 'ENTITIES'], ...pairs, [0, 'ENDSEC'], [0, 'EOF']]);

/** The buffered shapes, which are what every parser assertion is made against. */
const shapesOf = (plugin: DXF_IMPORT_PLUGIN): IMPORTED_SHAPE[] => {
  const internal = (plugin as unknown as { m_internalImporter: { GetShapes(): IMPORTED_SHAPE[] } })
    .m_internalImporter;

  return internal.GetShapes();
};

/** Reach into a buffered shape's private geometry. */
const geom = <T>(shape: IMPORTED_SHAPE, field: string): T =>
  (shape as unknown as Record<string, T>)[field] as T;

const load = (text: string): DXF_IMPORT_PLUGIN => {
  const plugin = new DXF_IMPORT_PLUGIN();

  plugin.Load(text);

  return plugin;
};

const CLOSE = 1e-9;

describe('DXF_READER: group couplets', () => {
  it('strips whitespace from the code line but not from the value line', () => {
    expect(stripWhiteSpace('  10 \r', true)).toBe('10');
    expect(stripWhiteSpace('  a value \r', false)).toBe('  a value ');
  });

  it('reads the group codes as decimal and the handle as hexadecimal', () => {
    expect(toInt(' -370abc')).toBe(-370);
    expect(toInt('not a number')).toBe(0);
    expect(toInt16('1F')).toBe(31);
    expect(toReal('1,5')).toBe(1.5);
    expect(toReal('-2.5e2mm')).toBe(-250);
    expect(toReal('')).toBe(0);
  });

  it('clears the accumulated values at each new entity', () => {
    // The second LINE omits groups 8 and 20. It must not inherit the first's:
    // an omitted group means its documented default, not "whatever was last".
    const plugin = load(
      entities([
        [0, 'LINE'],
        [8, 'A'],
        [10, '1'],
        [20, '9'],
        [11, '3'],
        [21, '4'],
        [0, 'LINE'],
        [10, '1'],
        [11, '3'],
        [21, '4'],
      ]),
    );

    const shapes = shapesOf(plugin);

    expect(shapes).toHaveLength(2);
    expect(geom<{ y: number }>(shapes[0]!, 'm_start').y).toBe(-9);
    expect(geom<{ y: number }>(shapes[1]!, 'm_start').y).toBe(0);
    expect(shapes[0]!.GetSourceLayer()).toBe('A');
    expect(shapes[1]!.GetSourceLayer()).toBe('0');
  });

  it('reads a header variable by the lowest group code its value arrived under', () => {
    // `addSetting` picks the smallest code present, so a $INSUNITS carrying a
    // stray higher-numbered group is still read as an integer from group 70.
    const reader = new DXF_READER();

    expect(reader).toBeInstanceOf(DXF_READER);

    const plugin = load(
      dxf([
        [0, 'SECTION'],
        [2, 'HEADER'],
        [9, '$INSUNITS'],
        [70, '1'],
        [370, '4'],
        [0, 'ENDSEC'],
      ]),
    );

    expect(plugin.GetUnit()).toBe(DXF_IMPORT_UNITS.INCH);
  });

  it('drops a trailing group code with no value line', () => {
    // An odd number of lines: the last code never gets a value, so the LINE
    // before it is still flushed but nothing new starts.
    const plugin = load(
      `${entities([
        [0, 'LINE'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '1'],
      ])}0\n`,
    );

    expect(shapesOf(plugin)).toHaveLength(1);
  });
});

describe('DXF_IMPORT_PLUGIN: coordinates are millimetres and Y is flipped', () => {
  it('maps a LINE with the DXF Y axis inverted and no scaling of its own', () => {
    const plugin = load(
      entities([
        [0, 'LINE'],
        [8, 'Top'],
        [10, '0'],
        [20, '0'],
        [11, '10'],
        [21, '5'],
      ]),
    );

    const [line] = shapesOf(plugin);

    expect(line).toBeInstanceOf(IMPORTED_LINE);
    expect(geom(line!, 'm_start')).toEqual({ x: 0, y: 0 });
    expect(geom(line!, 'm_end')).toEqual({ x: 10, y: -5 });
    expect(line!.GetSourceLayer()).toBe('Top');
  });

  it('applies SetOffset in millimetres, X added and Y subtracted from', () => {
    const plugin = new DXF_IMPORT_PLUGIN();

    plugin.SetOffset(3, -7);
    plugin.Load(
      entities([
        [0, 'LINE'],
        [10, '1'],
        [20, '2'],
        [11, '1'],
        [21, '2'],
      ]),
    );

    expect(geom(shapesOf(plugin)[0]!, 'm_start')).toEqual({ x: 4, y: -9 });
  });

  it('never applies the importer scale itself — the importer applies it once', () => {
    const plugin = load(
      entities([
        [0, 'LINE'],
        [10, '0'],
        [20, '0'],
        [11, '10'],
        [21, '0'],
      ]),
    );

    // The parser's own output is unchanged by the user's import ratio...
    expect(geom(shapesOf(plugin)[0]!, 'm_end')).toEqual({ x: 10, y: 0 });

    // ...and the importer multiplies by it exactly once (2 mm/unit * 10 units
    // = 20 mm, which is 20e6 internal units).
    const importer = new GRAPHICS_IMPORTER_PCBNEW();
    importer.SetScale({ x: 2, y: 2 });
    plugin.SetImporter(importer);
    plugin.Import();

    const items = importer.GetItems();

    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('shape');

    if (items[0]!.type === 'shape') expect(items[0]!.shape.end).toEqual({ x: 20e6, y: 0 });
  });
});

describe('DXF_IMPORT_PLUGIN: units', () => {
  const lineIn = (insunits: string): number => {
    const text =
      dxf([
        [0, 'SECTION'],
        [2, 'HEADER'],
        [9, '$INSUNITS'],
        [70, insunits],
        [0, 'ENDSEC'],
      ]) +
      entities([
        [0, 'LINE'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
      ]);

    return geom<{ x: number }>(shapesOf(load(text))[0]!, 'm_end').x;
  };

  it('reads $INSUNITS and scales the drawing to millimetres', () => {
    expect(lineIn('1')).toBeCloseTo(25.4, 12); // inch
    expect(lineIn('2')).toBeCloseTo(304.8, 12); // feet
    expect(lineIn('4')).toBe(1.0); // mm
    expect(lineIn('5')).toBe(10.0); // cm
    expect(lineIn('6')).toBe(1000.0); // metres
    expect(lineIn('8')).toBeCloseTo(2.54e-5, 15); // microinches
    expect(lineIn('9')).toBeCloseTo(0.0254, 12); // mils
    expect(lineIn('10')).toBeCloseTo(914.4, 9); // yards
    expect(lineIn('11')).toBeCloseTo(1.0e-7, 15); // angstroms
    expect(lineIn('12')).toBeCloseTo(1.0e-6, 15); // nanometres
    expect(lineIn('13')).toBeCloseTo(1.0e-3, 15); // microns
    expect(lineIn('14')).toBe(100.0); // decimetres
  });

  it('imports the units it has no scale for as millimetres, upstream does too', () => {
    for (const unit of ['0', '3', '7', '15', '16', '17', '18', '19', '20']) {
      expect(lineIn(unit)).toBe(1.0);
    }
  });

  it('an unknown $INSUNITS resets a unit set by SetUnit', () => {
    const plugin = new DXF_IMPORT_PLUGIN();

    plugin.SetUnit(DXF_IMPORT_UNITS.INCH);
    plugin.Load(
      dxf([
        [0, 'SECTION'],
        [2, 'HEADER'],
        [9, '$INSUNITS'],
        [70, '99'],
        [0, 'ENDSEC'],
      ]),
    );

    expect(plugin.GetUnit()).toBe(DXF_IMPORT_UNITS.DEFAULT);
  });

  it('reads the header precisions, which nothing downstream consumes', () => {
    const plugin = load(
      dxf([
        [0, 'SECTION'],
        [2, 'HEADER'],
        [9, '$LUPREC'],
        [70, '6'],
        [9, '$AUPREC'],
        [70, '3'],
        [0, 'ENDSEC'],
      ]),
    );

    expect(plugin.GetHeaderState().coordinatePrecision).toBe(6);
    expect(plugin.GetHeaderState().anglePrecision).toBe(3);
  });
});

describe('DXF_IMPORT_PLUGIN: line widths', () => {
  const widthOf = (pairs: (readonly [number, string])[]): number =>
    geom<{ GetWidth(): number }>(shapesOf(load(entities(pairs)))[0]!, 'm_stroke').GetWidth();

  it('reads a lineweight in hundredths of a millimetre from group 370', () => {
    expect(
      widthOf([
        [0, 'LINE'],
        [370, '25'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
      ]),
    ).toBe(0.25);
  });

  it('falls back to the default thickness for BYLAYER with no layer entry', () => {
    expect(
      widthOf([
        [0, 'LINE'],
        [370, '-1'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
      ]),
    ).toBe(0.2);
  });

  it("resolves BYLAYER against the layer table's own lineweight", () => {
    const text =
      dxf([
        [0, 'SECTION'],
        [2, 'TABLES'],
        [0, 'LAYER'],
        [2, 'Thick'],
        [370, '80'],
        [0, 'ENDTAB'],
        [0, 'ENDSEC'],
      ]) +
      entities([
        [0, 'LINE'],
        [8, 'Thick'],
        [370, '-1'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
      ]);

    expect(geom<{ GetWidth(): number }>(shapesOf(load(text))[0]!, 'm_stroke').GetWidth()).toBe(0.8);
  });

  it('takes the width the importer was told to use as the default', () => {
    const plugin = new DXF_IMPORT_PLUGIN();
    const importer = new GRAPHICS_IMPORTER_PCBNEW();

    importer.SetLineWidthMM(0.35);
    plugin.SetImporter(importer);
    plugin.Load(
      entities([
        [0, 'LINE'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
      ]),
    );

    expect(geom<{ GetWidth(): number }>(shapesOf(plugin)[0]!, 'm_stroke').GetWidth()).toBe(0.35);
  });
});

describe('DXF_IMPORT_PLUGIN: circles and arcs', () => {
  it('maps a CIRCLE centre and radius', () => {
    const plugin = load(
      entities([
        [0, 'CIRCLE'],
        [8, 'L'],
        [10, '4'],
        [20, '3'],
        [40, '2'],
      ]),
    );

    const [circle] = shapesOf(plugin);

    expect(circle).toBeInstanceOf(IMPORTED_CIRCLE);
    expect(geom(circle!, 'm_center')).toEqual({ x: 4, y: -3 });
    expect(geom(circle!, 'm_radius')).toBe(2);
    expect(geom(circle!, 'm_filled')).toBe(false);
  });

  it('turns a POINT into a filled circle whose radius is its thickness', () => {
    const plugin = load(
      entities([
        [0, 'POINT'],
        [10, '1'],
        [20, '1'],
        [39, '0.5'],
      ]),
    );

    const [dot] = shapesOf(plugin);

    expect(geom(dot!, 'm_filled')).toBe(true);
    expect(geom(dot!, 'm_radius')).toBe(0.5);
    expect(geom<{ GetWidth(): number }>(dot!, 'm_stroke').GetWidth()).toBe(0.0001);
  });

  it('gives a POINT with no thickness the 0.01 minimum', () => {
    const plugin = load(
      entities([
        [0, 'POINT'],
        [10, '0'],
        [20, '0'],
      ]),
    );

    expect(geom(shapesOf(plugin)[0]!, 'm_radius')).toBe(0.01);
  });

  it('emits an ARC with pcbnew winding: a negative sweep from the DXF start', () => {
    // A quarter arc from 0 to 90 degrees, centred at the origin, radius 5.
    const plugin = load(
      entities([
        [0, 'ARC'],
        [10, '0'],
        [20, '0'],
        [40, '5'],
        [50, '0'],
        [51, '90'],
      ]),
    );

    const [arc] = shapesOf(plugin);

    expect(arc).toBeInstanceOf(IMPORTED_ARC);
    expect(geom(arc!, 'm_center')).toEqual({ x: 0, y: 0 });

    const start = geom<{ x: number; y: number }>(arc!, 'm_start');

    expect(start.x).toBeCloseTo(5, 12);
    expect(start.y).toBeCloseTo(-0, 12);
    expect(geom<{ AsDegrees(): number }>(arc!, 'm_angle').AsDegrees()).toBeCloseTo(-90, 12);
  });

  it('wraps a sweep that would come out positive back below zero', () => {
    // 90 -> 0 is a 270 degree CCW arc, which must not import as +90.
    const plugin = load(
      entities([
        [0, 'ARC'],
        [10, '0'],
        [20, '0'],
        [40, '5'],
        [50, '90'],
        [51, '0'],
      ]),
    );

    expect(geom<{ AsDegrees(): number }>(shapesOf(plugin)[0]!, 'm_angle').AsDegrees()).toBeCloseTo(
      -270,
      12,
    );
  });

  it('unmirrors an arc drawn on a negative extrusion', () => {
    // Extrusion (0,0,-1) reflects the object coordinate system, so the DXF
    // angles have to be reflected about 180 degrees and swapped.
    const plugin = load(
      entities([
        [0, 'ARC'],
        [10, '0'],
        [20, '0'],
        [40, '5'],
        [50, '0'],
        [51, '90'],
        [210, '0'],
        [220, '0'],
        [230, '-1'],
      ]),
    );

    const [arc] = shapesOf(plugin);
    const start = geom<{ x: number; y: number }>(arc!, 'm_start');

    // start angle becomes 180 - 90 = 90 degrees.
    expect(start.x).toBeCloseTo(0, 9);
    expect(start.y).toBeCloseTo(-5, 9);
    expect(geom<{ AsDegrees(): number }>(arc!, 'm_angle').AsDegrees()).toBeCloseTo(-90, 12);
  });

  it('reroutes a ratio-1 ELLIPSE to a circle and reports the general one', () => {
    const full = load(
      entities([
        [0, 'ELLIPSE'],
        [10, '0'],
        [20, '0'],
        [11, '3'],
        [21, '0'],
        [40, '1'],
        [41, '0'],
        [42, `${2 * Math.PI}`],
      ]),
    );

    // A full ratio-1 ellipse is not a circle here: 0 and 2pi are not equal, so
    // upstream takes the *arc* branch. The sweep covers the whole 360 degrees.
    expect(shapesOf(full)[0]).toBeInstanceOf(IMPORTED_ARC);

    const circle = load(
      entities([
        [0, 'ELLIPSE'],
        [10, '0'],
        [20, '0'],
        [11, '3'],
        [21, '0'],
        [40, '1'],
        [41, '0'],
        [42, '0'],
      ]),
    );

    expect(shapesOf(circle)[0]).toBeInstanceOf(IMPORTED_CIRCLE);
    expect(geom(shapesOf(circle)[0]!, 'm_radius')).toBeCloseTo(3, 12);

    const oval = load(
      entities([
        [0, 'ELLIPSE'],
        [10, '0'],
        [20, '0'],
        [11, '3'],
        [21, '0'],
        [40, '0.5'],
      ]),
    );

    // The minor axis is a *ratio* of the major, so both radii come out of the
    // one vector the file gives.
    expect(shapesOf(oval)[0]).toBeInstanceOf(IMPORTED_ELLIPSE);
    expect(geom(shapesOf(oval)[0]!, 'm_majorRadius')).toBeCloseTo(3, 12);
    expect(geom(shapesOf(oval)[0]!, 'm_minorRadius')).toBeCloseTo(1.5, 12);
  });

  it('and a partial one becomes an elliptical arc, its angles kept in radians', () => {
    // "DXF elliptical arcs store their angles in radians (unlike circular arcs
    // which use degrees)".
    const arc = load(
      entities([
        [0, 'ELLIPSE'],
        [10, '0'],
        [20, '0'],
        [11, '4'],
        [21, '0'],
        [40, '0.25'],
        [41, '0'],
        [42, `${Math.PI / 2}`],
      ]),
    );

    const shape = shapesOf(arc)[0]!;
    expect(shape).toBeInstanceOf(IMPORTED_ELLIPSE_ARC);
    expect(geom(shape, 'm_minorRadius')).toBeCloseTo(1, 12);
    expect((geom(shape, 'm_endAngle') as EDA_ANGLE).AsDegrees()).toBeCloseTo(90, 9);
  });

  it('a tilted ellipse takes its rotation from the major axis vector', () => {
    // The major axis points up the DXF page, so down ours: -90 degrees.
    const tilted = load(
      entities([
        [0, 'ELLIPSE'],
        [10, '0'],
        [20, '0'],
        [11, '0'],
        [21, '5'],
        [40, '0.4'],
      ]),
    );

    const shape = shapesOf(tilted)[0]!;
    expect(geom(shape, 'm_majorRadius')).toBeCloseTo(5, 12);
    expect((geom(shape, 'm_rotation') as EDA_ANGLE).AsDegrees()).toBeCloseTo(-90, 9);
  });
});

describe('DXF_IMPORT_PLUGIN: polylines and bulges', () => {
  const lwpolyline = (
    verts: { x: number; y: number; bulge?: number }[],
    flags = 0,
  ): DXF_IMPORT_PLUGIN => {
    const pairs: (readonly [number, string])[] = [
      [0, 'LWPOLYLINE'],
      [8, 'P'],
      [90, String(verts.length)],
      [70, String(flags)],
    ];

    for (const v of verts) {
      pairs.push([10, String(v.x)]);
      pairs.push([20, String(v.y)]);

      if (v.bulge !== undefined) pairs.push([42, String(v.bulge)]);
    }

    return load(entities(pairs));
  };

  it('emits one line per segment and leaves an open polyline open', () => {
    const plugin = lwpolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);

    const shapes = shapesOf(plugin);

    expect(shapes).toHaveLength(2);
    expect(shapes.every((s) => s instanceof IMPORTED_LINE)).toBe(true);
    expect(geom(shapes[1]!, 'm_end')).toEqual({ x: 10, y: -10 });
  });

  it('closes the polyline when flag bit 0 is set', () => {
    const plugin = lwpolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      1,
    );

    const shapes = shapesOf(plugin);

    expect(shapes).toHaveLength(3);
    expect(geom(shapes[2]!, 'm_start')).toEqual({ x: 10, y: -10 });
    expect(geom(shapes[2]!, 'm_end')).toEqual({ x: 0, y: 0 });
  });

  it('uses the *previous* vertex bulge for each segment', () => {
    // Only the first vertex bulges, so only the first segment is an arc.
    const plugin = lwpolyline([
      { x: 0, y: 0, bulge: 1 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);

    const shapes = shapesOf(plugin);

    expect(shapes[0]).toBeInstanceOf(IMPORTED_ARC);
    expect(shapes[1]).toBeInstanceOf(IMPORTED_LINE);
  });

  it('draws a bulge below the 0.0218 threshold as a straight line', () => {
    expect(
      shapesOf(
        lwpolyline([
          { x: 0, y: 0, bulge: 0.0217 },
          { x: 10, y: 0 },
        ]),
      )[0],
    ).toBeInstanceOf(IMPORTED_LINE);

    expect(
      shapesOf(
        lwpolyline([
          { x: 0, y: 0, bulge: 0.0218 },
          { x: 10, y: 0 },
        ]),
      )[0],
    ).toBeInstanceOf(IMPORTED_ARC);
  });

  it('turns a bulge of 1 into a semicircle above the chord', () => {
    // bulge 1 => 4*atan(1) = pi, a half turn counter-clockwise in DXF, which
    // pcbnew stores as -180 starting from the DXF start point.
    const plugin = lwpolyline([
      { x: 0, y: 0, bulge: 1 },
      { x: 10, y: 0 },
    ]);

    const [arc] = shapesOf(plugin);
    const center = geom<{ x: number; y: number }>(arc!, 'm_center');
    const start = geom<{ x: number; y: number }>(arc!, 'm_start');

    expect(center.x).toBeCloseTo(5, 9);
    expect(center.y).toBeCloseTo(-0, 9);
    expect(start.x).toBeCloseTo(0, 9);
    expect(start.y).toBeCloseTo(-0, 9);
    expect(geom<{ AsDegrees(): number }>(arc!, 'm_angle').AsDegrees()).toBeCloseTo(-180, 9);
  });

  it('starts a negative bulge from the segment end instead', () => {
    const plugin = lwpolyline([
      { x: 0, y: 0, bulge: -1 },
      { x: 10, y: 0 },
    ]);

    const [arc] = shapesOf(plugin);
    const start = geom<{ x: number; y: number }>(arc!, 'm_start');

    expect(start.x).toBeCloseTo(10, 9);
    expect(geom<{ AsDegrees(): number }>(arc!, 'm_angle').AsDegrees()).toBeCloseTo(-180, 9);
  });

  it('flips the centre to the far side for a sweep past a half turn', () => {
    // bulge 2 => 4*atan(2) ~ 5.06 rad ~ 290 degrees, more than pi, so the
    // centre must fall below the chord rather than above it.
    const plugin = lwpolyline([
      { x: 0, y: 0, bulge: 2 },
      { x: 10, y: 0 },
    ]);

    const [arc] = shapesOf(plugin);
    const center = geom<{ x: number; y: number }>(arc!, 'm_center');

    expect(center.x).toBeCloseTo(5, 9);
    // In DXF's frame the centre is below the chord; pcbnew's Y is flipped.
    expect(center.y).toBeGreaterThan(0);
    expect(geom<{ AsDegrees(): number }>(arc!, 'm_angle').AsDegrees()).toBeCloseTo(
      (-4 * Math.atan(2) * 180) / Math.PI,
      9,
    );
  });

  it('clamps an absurd bulge to +/-2000 rather than dividing by zero', () => {
    const plugin = lwpolyline([
      { x: 0, y: 0, bulge: 1e9 },
      { x: 10, y: 0 },
    ]);

    const [arc] = shapesOf(plugin);

    expect(Number.isFinite(geom<{ x: number }>(arc!, 'm_center').x)).toBe(true);
    expect(geom<{ AsDegrees(): number }>(arc!, 'm_angle').AsDegrees()).toBeCloseTo(
      (-4 * Math.atan(2000) * 180) / Math.PI,
      9,
    );
  });

  it('honours a per-vertex width, which DXF scales by 100', () => {
    const plugin = load(
      entities([
        [0, 'POLYLINE'],
        [8, 'P'],
        [70, '0'],
        [0, 'VERTEX'],
        [10, '0'],
        [20, '0'],
        [0, 'VERTEX'],
        [10, '10'],
        [20, '0'],
        [40, '30'],
        [0, 'SEQEND'],
      ]),
    );

    expect(geom<{ GetWidth(): number }>(shapesOf(plugin)[0]!, 'm_stroke').GetWidth()).toBe(0.3);
  });

  it('takes the source layer from the polyline, not from its vertices', () => {
    const plugin = load(
      entities([
        [0, 'POLYLINE'],
        [8, 'Outline'],
        [70, '0'],
        [0, 'VERTEX'],
        [8, 'Other'],
        [10, '0'],
        [20, '0'],
        [0, 'VERTEX'],
        [8, 'Other'],
        [10, '10'],
        [20, '0'],
        [0, 'SEQEND'],
      ]),
    );

    expect(shapesOf(plugin)[0]!.GetSourceLayer()).toBe('Outline');
  });

  it('skips a POLYLINE vertex that is a mesh face record', () => {
    const plugin = load(
      entities([
        [0, 'POLYLINE'],
        [70, '64'],
        [0, 'VERTEX'],
        [10, '0'],
        [20, '0'],
        [70, '0'],
        [0, 'VERTEX'],
        [10, '10'],
        [20, '0'],
        [70, '0'],
        [0, 'VERTEX'],
        [70, '128'],
        [0, 'SEQEND'],
      ]),
    );

    expect(shapesOf(plugin)).toHaveLength(1);
  });
});

describe('DXF_IMPORT_PLUGIN: blocks and INSERT', () => {
  const blockAndInsert = (insert: (readonly [number, string])[]): DXF_IMPORT_PLUGIN =>
    load(
      dxf([
        [0, 'SECTION'],
        [2, 'BLOCKS'],
        [0, 'BLOCK'],
        [2, 'PAD'],
        [10, '0'],
        [20, '0'],
        [0, 'LINE'],
        [8, '0'],
        [10, '0'],
        [20, '0'],
        [11, '2'],
        [21, '0'],
        [0, 'ENDBLK'],
        [0, 'ENDSEC'],
      ]) + entities([[0, 'INSERT'], [2, 'PAD'], ...insert]),
    );

  it('keeps block geometry out of the drawing until an INSERT places it', () => {
    const plugin = load(
      dxf([
        [0, 'SECTION'],
        [2, 'BLOCKS'],
        [0, 'BLOCK'],
        [2, 'PAD'],
        [10, '0'],
        [20, '0'],
        [0, 'LINE'],
        [10, '0'],
        [20, '0'],
        [11, '2'],
        [21, '0'],
        [0, 'ENDBLK'],
        [0, 'ENDSEC'],
        [0, 'EOF'],
      ]),
    );

    expect(shapesOf(plugin)).toHaveLength(0);
  });

  it('translates a placed block by the insertion point', () => {
    const plugin = blockAndInsert([
      [10, '5'],
      [20, '5'],
    ]);
    const [line] = shapesOf(plugin);

    expect(geom<{ x: number; y: number }>(line!, 'm_start').x).toBeCloseTo(5, CLOSE);
    expect(geom<{ x: number; y: number }>(line!, 'm_start').y).toBeCloseTo(-5, CLOSE);
    expect(geom<{ x: number; y: number }>(line!, 'm_end').x).toBeCloseTo(7, CLOSE);
  });

  it("subtracts the block's own base point", () => {
    const plugin = load(
      dxf([
        [0, 'SECTION'],
        [2, 'BLOCKS'],
        [0, 'BLOCK'],
        [2, 'PAD'],
        [10, '1'],
        [20, '0'],
        [0, 'LINE'],
        [10, '1'],
        [20, '0'],
        [11, '3'],
        [21, '0'],
        [0, 'ENDBLK'],
        [0, 'ENDSEC'],
      ]) +
        entities([
          [0, 'INSERT'],
          [2, 'PAD'],
          [10, '10'],
          [20, '0'],
        ]),
    );

    // The base point lands on the insertion point.
    expect(geom<{ x: number }>(shapesOf(plugin)[0]!, 'm_start').x).toBeCloseTo(10, CLOSE);
    expect(geom<{ x: number }>(shapesOf(plugin)[0]!, 'm_end').x).toBeCloseTo(12, CLOSE);
  });

  it('rotates and scales a placed block', () => {
    const plugin = blockAndInsert([
      [10, '0'],
      [20, '0'],
      [41, '3'],
      [42, '1'],
      [50, '90'],
    ]);
    const end = geom<{ x: number; y: number }>(shapesOf(plugin)[0]!, 'm_end');

    // 2 mm along +X, scaled by 3, then rotated by -90 degrees in the matrix.
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.y).toBeCloseTo(-6, 9);
  });

  it('places the block once however many rows and columns the INSERT asks for', () => {
    const plugin = blockAndInsert([
      [10, '0'],
      [20, '0'],
      [70, '4'],
      [71, '3'],
    ]);

    expect(shapesOf(plugin)).toHaveLength(1);
  });

  it('ignores an INSERT naming a block that does not exist', () => {
    const plugin = load(
      entities([
        [0, 'INSERT'],
        [2, 'MISSING'],
        [10, '0'],
        [20, '0'],
      ]),
    );

    expect(shapesOf(plugin)).toHaveLength(0);
  });

  it("gives a block shape on layer 0 the INSERT's layer, and keeps a named one", () => {
    const plugin = load(
      dxf([
        [0, 'SECTION'],
        [2, 'BLOCKS'],
        [0, 'BLOCK'],
        [2, 'PAD'],
        [10, '0'],
        [20, '0'],
        [0, 'LINE'],
        [8, '0'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
        [0, 'LINE'],
        [8, 'Named'],
        [10, '0'],
        [20, '1'],
        [11, '1'],
        [21, '1'],
        [0, 'ENDBLK'],
        [0, 'ENDSEC'],
      ]) +
        entities([
          [0, 'INSERT'],
          [2, 'PAD'],
          [8, 'Placement'],
          [10, '0'],
          [20, '0'],
        ]),
    );

    const shapes = shapesOf(plugin);

    expect(shapes[0]!.GetSourceLayer()).toBe('Placement');
    expect(shapes[1]!.GetSourceLayer()).toBe('Named');
  });
});

describe('DXF_IMPORT_PLUGIN: text', () => {
  it('sizes a glyph at 0.9 of its height and strokes it at an eighth', () => {
    const plugin = load(
      entities([
        [0, 'TEXT'],
        [8, 'Silk'],
        [1, 'AB'],
        [10, '0'],
        [20, '0'],
        [40, '4'],
      ]),
    );

    const [text] = shapesOf(plugin);

    expect(text).toBeInstanceOf(IMPORTED_TEXT);
    expect(geom(text!, 'm_height')).toBe(4);
    expect(geom(text!, 'm_width')).toBeCloseTo(3.6, 12);
    expect(geom(text!, 'm_thickness')).toBe(0.5);
    expect(geom(text!, 'm_text')).toBe('AB');
  });

  it('applies a text style width factor to the glyph width', () => {
    const text =
      dxf([
        [0, 'SECTION'],
        [2, 'TABLES'],
        [0, 'STYLE'],
        [2, 'Wide'],
        [40, '0'],
        [41, '2'],
        [0, 'ENDTAB'],
        [0, 'ENDSEC'],
      ]) +
      entities([
        [0, 'TEXT'],
        [1, 'A'],
        [7, 'Wide'],
        [10, '0'],
        [20, '0'],
        [40, '4'],
      ]);

    expect(geom(shapesOf(load(text))[0]!, 'm_width')).toBeCloseTo(7.2, 12);
  });

  it('uses the alignment point when the text is not left/baseline aligned', () => {
    const plugin = load(
      entities([
        [0, 'TEXT'],
        [1, 'A'],
        [10, '0'],
        [20, '0'],
        [11, '20'],
        [21, '0'],
        [40, '2'],
        [72, '1'],
      ]),
    );

    expect(geom<{ x: number }>(shapesOf(plugin)[0]!, 'm_origin').x).toBe(20);
    expect(geom(shapesOf(plugin)[0]!, 'm_hJustify')).toBe(GR_TEXT_H_ALIGN_T.CENTER);
  });

  it('keeps the insertion point for aligned (3) and fit (5) justification', () => {
    for (const hjust of ['3', '5']) {
      const plugin = load(
        entities([
          [0, 'TEXT'],
          [1, 'A'],
          [10, '0'],
          [20, '0'],
          [11, '20'],
          [21, '0'],
          [40, '2'],
          [72, hjust],
        ]),
      );

      expect(geom<{ x: number }>(shapesOf(plugin)[0]!, 'm_origin').x).toBe(0);
      expect(geom(shapesOf(plugin)[0]!, 'm_hJustify')).toBe(GR_TEXT_H_ALIGN_T.LEFT);
    }
  });

  it('maps the DXF justification codes onto pcbnew alignment', () => {
    const justify = (h: string, v: string) => {
      const plugin = load(
        entities([
          [0, 'TEXT'],
          [1, 'A'],
          [10, '0'],
          [20, '0'],
          [40, '2'],
          [72, h],
          [73, v],
        ]),
      );

      return {
        h: geom(shapesOf(plugin)[0]!, 'm_hJustify'),
        v: geom(shapesOf(plugin)[0]!, 'm_vJustify'),
      };
    };

    expect(justify('0', '0')).toEqual({
      h: GR_TEXT_H_ALIGN_T.LEFT,
      v: GR_TEXT_V_ALIGN_T.BOTTOM,
    });
    expect(justify('1', '2').h).toBe(GR_TEXT_H_ALIGN_T.CENTER);
    expect(justify('4', '2').h).toBe(GR_TEXT_H_ALIGN_T.CENTER);
    expect(justify('2', '3')).toEqual({ h: GR_TEXT_H_ALIGN_T.RIGHT, v: GR_TEXT_V_ALIGN_T.TOP });
    expect(justify('0', '1').v).toBe(GR_TEXT_V_ALIGN_T.BOTTOM);
    expect(justify('0', '2').v).toBe(GR_TEXT_V_ALIGN_T.CENTER);
  });

  it('converts the rotation back to degrees', () => {
    const plugin = load(
      entities([
        [0, 'TEXT'],
        [1, 'A'],
        [10, '0'],
        [20, '0'],
        [40, '2'],
        [50, '45'],
      ]),
    );

    expect(geom<number>(shapesOf(plugin)[0]!, 'm_orientation')).toBeCloseTo(45, 12);
  });

  it('joins MTEXT chunks and reads the attachment point', () => {
    const plugin = load(
      entities([
        [0, 'MTEXT'],
        [8, 'Silk'],
        [10, '0'],
        [20, '0'],
        [40, '2'],
        [71, '5'],
        [3, 'first '],
        [3, 'second '],
        [1, 'tail'],
      ]),
    );

    const [text] = shapesOf(plugin);

    expect(geom(text!, 'm_text')).toBe('first second tail');
    expect(geom(text!, 'm_hJustify')).toBe(GR_TEXT_H_ALIGN_T.CENTER);
    expect(geom(text!, 'm_vJustify')).toBe(GR_TEXT_V_ALIGN_T.CENTER);
  });

  it('clears the MTEXT buffer between entities', () => {
    const plugin = load(
      entities([
        [0, 'MTEXT'],
        [10, '0'],
        [20, '0'],
        [40, '2'],
        [1, 'one'],
        [0, 'MTEXT'],
        [10, '0'],
        [20, '5'],
        [40, '2'],
        [1, 'two'],
      ]),
    );

    expect(shapesOf(plugin).map((s) => geom(s, 'm_text'))).toEqual(['one', 'two']);
  });

  it('maps the MTEXT attachment point ranges onto alignment', () => {
    const align = (point: string) => {
      const plugin = load(
        entities([
          [0, 'MTEXT'],
          [10, '0'],
          [20, '0'],
          [40, '2'],
          [71, point],
          [1, 'x'],
        ]),
      );

      return {
        h: geom(shapesOf(plugin)[0]!, 'm_hJustify'),
        v: geom(shapesOf(plugin)[0]!, 'm_vJustify'),
      };
    };

    expect(align('1')).toEqual({ h: GR_TEXT_H_ALIGN_T.LEFT, v: GR_TEXT_V_ALIGN_T.TOP });
    expect(align('3')).toEqual({ h: GR_TEXT_H_ALIGN_T.RIGHT, v: GR_TEXT_V_ALIGN_T.TOP });
    expect(align('5')).toEqual({ h: GR_TEXT_H_ALIGN_T.CENTER, v: GR_TEXT_V_ALIGN_T.CENTER });
    expect(align('7')).toEqual({ h: GR_TEXT_H_ALIGN_T.LEFT, v: GR_TEXT_V_ALIGN_T.BOTTOM });
    expect(align('9')).toEqual({ h: GR_TEXT_H_ALIGN_T.RIGHT, v: GR_TEXT_V_ALIGN_T.BOTTOM });
  });
});

describe('DXF_IMPORT_PLUGIN.toNativeString', () => {
  const native = DXF_IMPORT_PLUGIN.toNativeString;

  it('decodes the special-character escapes', () => {
    expect(native('%%c%%D%%p')).toBe('∅°±');
    expect(native('a\\Pb')).toBe('a\nb');
    expect(native('a\\~b')).toBe('a\u00A0b');
    expect(native('\\U+00B5m')).toBe('µm');
  });

  it('turns \\O ... \\o into a KiCad overbar and closes an unterminated one', () => {
    expect(native('\\Oover\\onot')).toBe('~{over}not');
    expect(native('\\Oover')).toBe('~{over}');
  });

  it('closes an overbar at the brace depth it was opened at', () => {
    expect(native('{\\Oover}rest')).toBe('~{over}rest');
  });

  it('skips codes that take an argument, up to their semicolon', () => {
    expect(native('\\H2.5x;text')).toBe('text');
    expect(native('\\C1;red')).toBe('red');
  });

  it('rewrites a stacked fraction', () => {
    expect(native('\\S1#2;')).toBe('^{1}/_{2}');
    expect(native('\\S1^ 2;')).toBe('1/2');
  });

  it('handles the C0 control codes', () => {
    expect(native('a^Ib')).toBe('a\tb');
    expect(native('a^ b')).toBe('a^b');
  });
});

describe('DXF_IMPORT_PLUGIN: splines', () => {
  const spline = (ctrl: [number, number][], knots: number[], degree: number): DXF_IMPORT_PLUGIN => {
    const pairs: (readonly [number, string])[] = [
      [0, 'SPLINE'],
      [8, 'S'],
      [71, String(degree)],
      [72, String(knots.length)],
      [73, String(ctrl.length)],
      [74, '0'],
    ];

    for (const k of knots) pairs.push([40, String(k)]);

    for (const [x, y] of ctrl) {
      pairs.push([10, String(x)]);
      pairs.push([20, String(y)]);
    }

    return load(entities(pairs));
  };

  it('passes a single cubic Bézier through unchanged, with Y flipped', () => {
    const plugin = spline(
      [
        [0, 0],
        [1, 2],
        [3, 2],
        [4, 0],
      ],
      [0, 0, 0, 0, 1, 1, 1, 1],
      3,
    );

    const [curve] = shapesOf(plugin);

    expect(curve).toBeInstanceOf(IMPORTED_SPLINE);
    expect(geom(curve!, 'm_start')).toEqual({ x: 0, y: 0 });
    expect(geom(curve!, 'm_bezierControl1')).toEqual({ x: 1, y: -2 });
    expect(geom(curve!, 'm_bezierControl2')).toEqual({ x: 3, y: -2 });
    expect(geom(curve!, 'm_end')).toEqual({ x: 4, y: 0 });
  });

  it('splits at an interior knot into two joined Béziers', () => {
    const plugin = spline(
      [
        [0, 0],
        [1, 2],
        [2, 2],
        [3, 0],
        [4, 3],
      ],
      [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
      3,
    );

    const shapes = shapesOf(plugin);

    expect(shapes).toHaveLength(2);
    expect(geom(shapes[0]!, 'm_end')).toEqual(geom(shapes[1]!, 'm_start'));
    expect(geom(shapes[0]!, 'm_end')).toEqual({ x: 2, y: -1.5 });
  });

  it('drops a spline with fewer than two control points, silently', () => {
    const plugin = spline([[0, 0]], [0, 0], 1);

    expect(shapesOf(plugin)).toHaveLength(0);
    expect(plugin.GetMessages()).toBe('');
  });

  it('reports an invalid spline definition rather than throwing', () => {
    // A knot vector of the wrong length is what tinyspline rejects.
    const plugin = spline(
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
      [0, 0, 1],
      2,
    );

    expect(shapesOf(plugin)).toHaveLength(0);
    expect(plugin.GetMessages()).toContain('Invalid spline definition encountered');
  });

  it('takes the source layer from the SPLINE entity', () => {
    const plugin = spline(
      [
        [0, 0],
        [1, 2],
        [3, 2],
        [4, 0],
      ],
      [0, 0, 0, 0, 1, 1, 1, 1],
      3,
    );

    expect(shapesOf(plugin)[0]!.GetSourceLayer()).toBe('S');
  });
});

describe('bsplineToBeziers', () => {
  it('elevates a quadratic to a cubic without moving the curve', () => {
    const { coords, order } = bsplineToBeziers([0, 0, 1, 2, 2, 0], [0, 0, 0, 1, 1, 1], 2);

    expect(order).toBe(4);
    // Standard elevation: P1' = P0/3 + 2P1/3, P2' = 2P1/3 + P2/3.
    expect(coords[0]).toBe(0);
    expect(coords[1]).toBe(0);
    expect(coords[2]).toBeCloseTo(2 / 3, 12);
    expect(coords[3]).toBeCloseTo(4 / 3, 12);
    expect(coords[4]).toBeCloseTo(4 / 3, 12);
    expect(coords[5]).toBeCloseTo(4 / 3, 12);
    expect(coords[6]).toBe(2);
    expect(coords[7]).toBe(0);
  });

  it('rejects a spline with fewer control points than its order', () => {
    expect(() => bsplineToBeziers([0, 0, 1, 1], [0, 0, 0, 1, 1, 1], 3)).toThrow(SPLINE_ERROR);
  });

  it('rejects a decreasing knot vector', () => {
    expect(() => bsplineToBeziers([0, 0, 1, 1, 2, 0], [0, 0, 0, 1, 0.5, 1], 2)).toThrow(
      SPLINE_ERROR,
    );
  });

  it('rejects a knot vector of the wrong length', () => {
    expect(() => bsplineToBeziers([0, 0, 1, 1, 2, 0], [0, 0, 0, 1, 1], 2)).toThrow(SPLINE_ERROR);
  });
});

describe('DXF_IMPORT_PLUGIN: layers and unsupported entities', () => {
  it('collects every source layer the shapes came from, in first-seen order', () => {
    const plugin = load(
      entities([
        [0, 'LINE'],
        [8, 'Second'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
        [0, 'LINE'],
        [8, 'First'],
        [10, '0'],
        [20, '1'],
        [11, '1'],
        [21, '1'],
        [0, 'LINE'],
        [8, 'Second'],
        [10, '0'],
        [20, '2'],
        [11, '1'],
        [21, '2'],
      ]),
    );

    expect(plugin.GetSourceLayers()).toEqual(['Second', 'First']);
  });

  it('gives an entity with no layer group the implicit layer "0"', () => {
    const plugin = load(
      entities([
        [0, 'LINE'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
      ]),
    );

    expect(plugin.GetSourceLayers()).toEqual(['0']);
  });

  it('lets the importer refuse a source layer at Import() time', () => {
    const plugin = load(
      entities([
        [0, 'LINE'],
        [8, 'Keep'],
        [10, '0'],
        [20, '0'],
        [11, '1'],
        [21, '0'],
        [0, 'LINE'],
        [8, 'Drop'],
        [10, '0'],
        [20, '1'],
        [11, '1'],
        [21, '1'],
      ]),
    );

    const importer = new GRAPHICS_IMPORTER_PCBNEW();

    importer.SetLayerMap(new Map([['Keep', importer.GetLayer()]]));
    plugin.SetImporter(importer);
    plugin.Import();

    expect(importer.GetItems()).toHaveLength(1);
  });

  it('reports each unsupported entity type with upstream wording', () => {
    const message = (name: string, extra: (readonly [number, string])[] = []): string =>
      load(entities([[0, name], ...extra])).GetMessages();

    expect(message('XLINE')).toBe('DXF construction lines not currently supported.\n');
    expect(message('RAY')).toBe('DXF construction lines not currently supported.\n');
    expect(message('ARCALIGNEDTEXT')).toBe('DXF arc-aligned text not currently supported.\n');
    expect(message('HATCH')).toBe('DXF hatches not currently supported.\n');
    expect(message('TRACE')).toBe('DXF traces not currently supported.\n');
    expect(message('3DFACE')).toBe('DXF 3dfaces not currently supported.\n');
    expect(message('SOLID')).toBe('DXF solids not currently supported.\n');
    expect(message('IMAGE')).toBe('DXF images not currently supported.\n');
    expect(message('LEADER')).toBe('DXF dimensions not currently supported.\n');
  });

  it('reports every DIMENSION variant the bottom three bits of group 70 select', () => {
    for (const type of ['0', '1', '2', '3', '4', '5', '6']) {
      expect(
        load(
          entities([
            [0, 'DIMENSION'],
            [70, type],
          ]),
        ).GetMessages(),
      ).toBe('DXF dimensions not currently supported.\n');
    }

    // Type 7 selects nothing at all.
    expect(
      load(
        entities([
          [0, 'DIMENSION'],
          [70, '7'],
        ]),
      ).GetMessages(),
    ).toBe('');
  });

  it('does not report a supported entity', () => {
    expect(
      load(
        entities([
          [0, 'LINE'],
          [10, '0'],
          [20, '0'],
          [11, '1'],
          [21, '0'],
        ]),
      ).GetMessages(),
    ).toBe('');
  });
});

describe('MATRIX3x3 helpers: a zero matrix is not the identity', () => {
  it('leaves everything SetRotation and SetScale do not write at zero', () => {
    const rot = matrixZero();

    matrixSetRotation(rot, 0);

    expect(rot[2][2]).toBe(0);
    expect(rot[0][2]).toBe(0);

    const scale = matrixZero();

    matrixSetScale(scale, { x: 2, y: 3 });

    expect(scale).toEqual([
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 0],
    ]);
  });

  it('multiplies rows by columns', () => {
    const a = matrixZero();
    const b = matrixZero();

    matrixSetScale(a, { x: 2, y: 2 });
    matrixSetRotation(b, Math.PI / 2);

    const product = matrixMul(a, b);

    expect(product[0][0]).toBeCloseTo(0, 12);
    expect(product[0][1]).toBeCloseTo(-2, 12);
    expect(product[1][0]).toBeCloseTo(2, 12);
  });
});

describe('DXF_IMPORT_PLUGIN: the reported image bounding box', () => {
  it('rotates a text box with upstream’s broken rotation, not a real one', () => {
    // `updateTextImageLimits` writes
    //     p.x = p.x * cos - p.y * sin;
    //     p.y = p.x * sin + p.y * cos;
    // and the second line reads the x the first has just overwritten. At 90
    // degrees cos is ~0, so every corner collapses onto the origin instead of
    // swinging round to it: the reported box has essentially no height where a
    // real rotation would give it the text's full width. Reproduced, not fixed
    // — it only ever reaches GetImageBBox, and "correcting" it would change the
    // extent KiCad reports for every rotated string.
    const plugin = load(
      entities([
        [0, 'TEXT'],
        [8, 'Silk'],
        [1, 'AB'],
        [10, '0'],
        [20, '0'],
        [40, '4'],
        [50, '90'],
      ]),
    );

    const bbox = plugin.GetImageBBox();

    // A true rotation carries the glyph run onto the y axis and reports a box
    // 7.2 mm tall starting at y = 0. The overwrite collapses it to the text's
    // height, 4 mm, starting at y = -4.
    expect(bbox.GetSize().y).toBeCloseTo(4, 9);
    expect(bbox.GetPosition().y).toBeCloseTo(-4, 9);
  });

  it('grows the box to include a segment’s endpoints', () => {
    const plugin = load(
      entities([
        [0, 'LINE'],
        [8, 'Silk'],
        [10, '-3'],
        [20, '-4'],
        [11, '7'],
        [21, '9'],
      ]),
    );

    const bbox = plugin.GetImageBBox();

    expect(bbox.GetPosition()).toEqual({ x: -3, y: -9 });
    expect(bbox.GetSize()).toEqual({ x: 10, y: 13 });
  });
});
