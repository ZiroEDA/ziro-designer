// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew/microwave/*: the shape generators against the C++.
 *
 * - The S-shaped coil is checked point for point against an independent Python
 *   transcription of `BuildCornersList_S_Shape` (`qa/data/pcbnew/microwave/inductor_oracle.py`).
 * - Gap, Stub and Arc Stub expectations are worked by hand from
 *   microwave_footprint.cpp for a 0.25 mm track and a 1 mm gap.
 * - The polygon reader/builder: file format and offsets from microwave_polygon.cpp.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PADSTACK } from '@ziroeda/pcbnew/padstack.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import {
  MICROWAVE_TOOL,
  MICROWAVE_FOOTPRINT_SHAPE,
  type MICROWAVE_HOST,
} from '@ziroeda/pcbnew/microwave/microwave_tool.js';
import {
  BuildCornersList_S_Shape,
  INDUCTOR_S_SHAPE_RESULT,
} from '@ziroeda/pcbnew/microwave/microwave_inductor.js';
import {
  g_MwaveShape,
  g_PolyEdges,
  MWAVE_POLY_SHAPE_TYPE,
  ReadDataShapeDescr,
} from '@ziroeda/pcbnew/microwave/microwave_polygon.js';

const TRACK = 250000;

function makeHost(answers: (string | null)[], over: Partial<MICROWAVE_HOST> = {}) {
  const errors: string[] = [];
  const asked: string[] = [];
  const added: FOOTPRINT[] = [];
  let modified = 0;
  const host: MICROWAVE_HOST = {
    GetCurrentTrackWidth: () => TRACK,
    StringFromValue: (iu) => String(iu),
    ValueFromString: (s) => Number(s),
    CreateNewFootprint: () => new FOOTPRINT(null),
    OnModify: () => {
      modified++;
    },
    ShowInfoBarError: (m) => errors.push(m),
    DisplayError: (m) => errors.push(m),
    TextEntry: async (prompt) => {
      asked.push(prompt);
      return answers.shift() ?? null;
    },
    PolygonShapeDialog: async () => true,
    AddInductor: (f) => added.push(f),
    ...over,
  };
  return { host, errors, asked, added, modified: () => modified };
}

describe('Gap / Stub / Arc Stub footprints', () => {
  it('Gap: two pads a 1 mm gap apart, centred on the anchor', async () => {
    const { host, asked, modified } = makeHost(['1000000']);
    const fp = (await new MICROWAVE_TOOL(host).createMicrowaveFeature(
      MICROWAVE_FOOTPRINT_SHAPE.GAP,
    ))!;
    expect(asked).toEqual(['Gap Size:']);
    const pads = fp.Pads();
    // offsetX = -(gap + padW) / 2 = -625000; pad2 = offsetX + gap + padW = +625000
    expect(pads.map((p) => p.GetPosition().x)).toEqual([-625000, 625000]);
    // createBaseFootprint adds with ADD_MODE::INSERT (push_front), so the list is [#2, #1]:
    // the first pad, the one moved left, is number 2.
    expect(pads.map((p) => p.GetNumber())).toEqual(['2', '1']);
    expect(pads[0]!.GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: TRACK, y: TRACK });
    // text_size = gap_size is assigned BEFORE the dialog, so it is the track width
    // (0.25 mm), not the typed gap: size = width, thickness = width / 5.
    expect(fp.Reference().GetTextSize()).toEqual({ x: TRACK, y: TRACK });
    expect(fp.Reference().GetTextThickness()).toBe(TRACK / 5);
    expect(modified()).toBe(1);
  });

  it('Stub: pad 2 is stretched to the stub size and moved up by half of (stub + pad)', async () => {
    const { host } = makeHost(['1000000']);
    const fp = (await new MICROWAVE_TOOL(host).createMicrowaveFeature(
      MICROWAVE_FOOTPRINT_SHAPE.STUB,
    ))!;
    const [a, b] = fp.Pads();
    expect(a!.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(b!.GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: TRACK, y: 1000000 });
    expect(b!.GetPosition()).toEqual({ x: 0, y: -625000 });
  });

  it('Arc Stub: one custom pad with a 5-degree fan polygon from the origin', async () => {
    const { host, asked } = makeHost(['1000000', '90']);
    const fp = (await new MICROWAVE_TOOL(host).createMicrowaveFeature(
      MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC,
    ))!;
    expect(asked).toEqual(['Arc Stub Radius Value:', 'Angle in degrees:']);
    expect(fp.Pads()).toHaveLength(1);
    const prims = fp.Pads()[0]!.GetPrimitives(PADSTACK.ALL_LAYERS) as PCB_SHAPE[];
    expect(prims).toHaveLength(1);
    const pts = prims[0]!.GetPolyShape().Outline(0).CPoints();
    // numPoints = 90/5 + 3 = 21: origin, 19 arc points (-45..+45 deg), then the origin again.
    expect(pts).toHaveLength(21);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    // theta = -45: (0,-R) rotated -> ( R sin45, -R cos45 )
    expect(pts[1]!.x).toBe(707107);
    expect(pts[1]!.y).toBe(-707107);
    expect(pts[10]).toEqual({ x: 0, y: -1000000 }); // theta = 0
    expect(pts[19]!.x).toBe(-707107);
    expect(pts[20]).toEqual({ x: 0, y: 0 });
  });

  it('Arc Stub: a negative angle is its absolute value, above 180 is 180', async () => {
    const run = async (ang: string) => {
      const { host } = makeHost(['1000000', ang]);
      const fp = (await new MICROWAVE_TOOL(host).createMicrowaveFeature(
        MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC,
      ))!;
      return (fp.Pads()[0]!.GetPrimitives(PADSTACK.ALL_LAYERS) as PCB_SHAPE[])[0]!
        .GetPolyShape()
        .Outline(0)
        .CPoints().length;
    };
    expect(await run('-90')).toBe(21);
    // 180 deg: 180/5 + 3 = 39 points
    expect(await run('400')).toBe(39);
  });

  it('cancel, and a non-numeric angle, produce nothing', async () => {
    expect(
      await new MICROWAVE_TOOL(makeHost([null]).host).createMicrowaveFeature(
        MICROWAVE_FOOTPRINT_SHAPE.GAP,
      ),
    ).toBeNull();
    const bad = makeHost(['1000000', 'abc']);
    expect(
      await new MICROWAVE_TOOL(bad.host).createMicrowaveFeature(MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC),
    ).toBeNull();
    expect(bad.errors).toEqual(['Incorrect number, abort']);
  });
});

interface OracleCase {
  start: [number, number];
  end: [number, number];
  length: number;
  width: number;
  result: string;
  points: [number, number][];
}

describe('BuildCornersList_S_Shape', () => {
  const cases: OracleCase[] = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../data/pcbnew/microwave/inductor_oracle.json', import.meta.url),
      ),
      'utf8',
    ),
  );

  for (const [i, c] of cases.entries()) {
    it(`case ${i}: every point equals the C++ transcription`, () => {
      const buf: { x: number; y: number }[] = [];
      const res = BuildCornersList_S_Shape(
        buf,
        { x: c.start[0], y: c.start[1] },
        { x: c.end[0], y: c.end[1] },
        c.length,
        c.width,
      );
      expect(res).toBe(INDUCTOR_S_SHAPE_RESULT.OK);
      expect(buf.map((p) => [p.x, p.y])).toEqual(c.points);
    });
  }

  it('reports too long / too short instead of building', () => {
    const buf: { x: number; y: number }[] = [];
    // A huge length in a 1 mm gap needs a radius below the trace width.
    expect(
      BuildCornersList_S_Shape(buf, { x: 0, y: 0 }, { x: 0, y: 1000000 }, 500000000, 250000),
    ).toBe(INDUCTOR_S_SHAPE_RESULT.TOO_LONG);
    expect(
      BuildCornersList_S_Shape([], { x: 0, y: 0 }, { x: 0, y: 10000000 }, 1000, 250000),
    ).not.toBe(INDUCTOR_S_SHAPE_RESULT.OK);
  });
});

describe('createInductorBetween', () => {
  it('asks the length, then the value, and hands the footprint over', async () => {
    const { host, asked, added } = makeHost(['20000000', 'L1']);
    await new MICROWAVE_TOOL(host).createInductorBetween({ x: 0, y: 0 }, { x: 0, y: 10000000 });
    expect(asked).toEqual(['Length of track:', 'Component value:']);
    expect(added).toHaveLength(1);
    const fp = added[0]!;
    expect(fp.GetFPID().GetLibItemName()).toBe('mw_inductor');
    expect(fp.GetPosition()).toEqual({ x: 0, y: 10000000 });
    expect(fp.Pads().map((p) => [p.GetNumber(), p.GetPosition()])).toEqual([
      // FOOTPRINT::Add defaults to ADD_MODE::INSERT: newest first.
      ['2', { x: 0, y: 0 }],
      ['1', { x: 0, y: 10000000 }],
    ]);
    // One segment per corner pair: 71 corners -> 70 segments (oracle case 0).
    const segs = fp.GraphicalItems().filter((i) => (i as PCB_SHAPE).GetWidth() === TRACK);
    expect(segs).toHaveLength(70);
  });

  it('a requested length below the distance is refused with the info-bar message', async () => {
    const { host, errors, added } = makeHost(['5000000']);
    await new MICROWAVE_TOOL(host).createInductorBetween({ x: 0, y: 0 }, { x: 0, y: 10000000 });
    expect(errors).toEqual(['Requested length < minimum length']);
    expect(added).toHaveLength(0);
  });

  it('cancelling either dialog adds nothing', async () => {
    for (const answers of [[null], ['20000000', null], ['20000000', '']]) {
      const { host, added, errors } = makeHost(answers);
      await new MICROWAVE_TOOL(host).createInductorBetween({ x: 0, y: 0 }, { x: 0, y: 10000000 });
      expect(added).toHaveLength(0);
      expect(errors).toHaveLength(0);
    }
  });
});

describe('polygonal shape', () => {
  const FILE = `Unit=MM
XScale=10
YScale=2

# a comment line
$COORD
0 0.5
0.5 1
1 0
$ENDCOORD
`;

  it('reads the description file: unit, scales and the point list', () => {
    const r = ReadDataShapeDescr(FILE);
    expect(r).toEqual({ scaleX: 10_000_000, scaleY: 2_000_000 });
    expect(g_PolyEdges).toEqual([
      { x: 0, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ]);
  });

  it('Unit=inch scales by 1000 mils', () => {
    const r = ReadDataShapeDescr('Unit=inch\nXScale=1\nYScale=1\n$COORD\n0 0\n$ENDCOORD\n');
    expect(r.scaleX).toBe(25_400_000);
  });

  async function build(type: MWAVE_POLY_SHAPE_TYPE, text = FILE) {
    ReadDataShapeDescr(text);
    g_MwaveShape.type = type;
    const { host, errors } = makeHost([]);
    const fp = await new MICROWAVE_TOOL(host).createMicrowaveFeature(
      MICROWAVE_FOOTPRINT_SHAPE.FUNCTION_SHAPE,
    );
    return { fp, errors };
  }

  it('Normal: pads at -size/2 and +size/2, corners from the origin up to the last point', async () => {
    const { fp } = await build(MWAVE_POLY_SHAPE_TYPE.NORMAL);
    const fp_ = fp!;
    expect(fp_.Pads().map((p) => p.GetPosition().x)).toEqual([-5_000_000, 5_000_000]);
    const poly = fp_.GraphicalItems().find((i) => (i as PCB_SHAPE).GetPolyShape) as PCB_SHAPE;
    const pts = poly.GetPolyShape().Outline(0).CPoints();
    // offset.x = -5e6. start (offset.x, 0); pts: (0,-1e6) (5e6,-2e6) (10e6, 0) all + offset;
    // last y is 0 so no closing corner.
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [-5_000_000, 0],
      [-5_000_000, -1_000_000],
      [0, -2_000_000],
      [5_000_000, 0],
    ]);
    expect(poly.GetWidth()).toBe(0);
  });

  it('Symmetrical mirrors the whole corner list about the X axis, back to front', async () => {
    const { fp } = await build(MWAVE_POLY_SHAPE_TYPE.SYMMETRICAL);
    const poly = fp!.GraphicalItems().find((i) => (i as PCB_SHAPE).GetPolyShape) as PCB_SHAPE;
    const pts = poly.GetPolyShape().Outline(0).CPoints();
    // 4 corners + 4 mirrored, but SHAPE_LINE_CHAIN::Append drops the duplicate at the seam.
    expect(pts).toHaveLength(7);
    expect(pts.slice(3).map((p) => [p.x, p.y])).toEqual([
      [5_000_000, 0],
      [0, 2_000_000],
      [-5_000_000, 1_000_000],
      [-5_000_000, 0],
    ]);
  });

  it('Mirrored negates the Y scale', async () => {
    const { fp } = await build(MWAVE_POLY_SHAPE_TYPE.MIRRORED);
    const poly = fp!.GraphicalItems().find((i) => (i as PCB_SHAPE).GetPolyShape) as PCB_SHAPE;
    const pts = poly.GetPolyShape().Outline(0).CPoints();
    expect(pts[1]).toEqual({ x: -5_000_000, y: 1_000_000 });
  });

  it('a last point off the axis gets a closing corner on the axis', async () => {
    const { fp } = await build(
      MWAVE_POLY_SHAPE_TYPE.NORMAL,
      'Unit=MM\nXScale=10\nYScale=2\n$COORD\n0 0\n1 0.5\n$ENDCOORD\n',
    );
    const poly = fp!.GraphicalItems().find((i) => (i as PCB_SHAPE).GetPolyShape) as PCB_SHAPE;
    const pts = poly.GetPolyShape().Outline(0).CPoints();
    // (offset.x,0) start; (0,0)+off; (10e6,-1e6)+off; then (last.x, 0).
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [-5_000_000, 0],
      [5_000_000, -1_000_000],
      [5_000_000, 0],
    ]);
  });

  it('a file with no points, or a null size, is refused', async () => {
    const none = await build(MWAVE_POLY_SHAPE_TYPE.NORMAL, 'Unit=MM\nXScale=1\nYScale=1\n');
    expect(none.fp).toBeNull();
    expect(none.errors).toEqual(['Shape has no points.']);
    const nul = await build(
      MWAVE_POLY_SHAPE_TYPE.NORMAL,
      'Unit=MM\nXScale=0\nYScale=1\n$COORD\n1 1\n$ENDCOORD\n',
    );
    expect(nul.errors).toEqual(['Shape has a null size.']);
  });
});
