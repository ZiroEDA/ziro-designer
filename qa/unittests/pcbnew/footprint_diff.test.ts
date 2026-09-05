// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board footprint versus its library original.
 * Counterpart: `FOOTPRINT::FootprintNeedsUpdate`.
 *
 * The comparison has to happen in the footprint's *own* frame. Our model
 * stores footprint children board-absolute with the parent transform already
 * baked in, and a library footprint sits at the origin unrotated — so a placed,
 * rotated copy of an unmodified footprint would otherwise differ in every pad.
 * That is the first thing tested here, because it is the thing that makes the
 * whole feature useless if it is wrong.
 *
 * The second thing tested here is everything upstream deliberately declines to
 * look at. Each of those is a difference a real board has for innocent reasons,
 * and reporting any one of them would mark every board on the bench stale.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  footprintDifferences,
  footprintLocalPos,
  footprintNeedsUpdate,
} from '@ziroeda/pcbnew/src/footprint_diff.js';
import { rotatePcb } from '@ziroeda/pcbnew/src/read-board.js';
import type { PcbFootprint, PcbPad, PcbShape, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** A pad at a footprint-local offset, placed into the parent's frame. */
const pad = (
  fp: { at: { x: number; y: number }; angle: number },
  local: { x: number; y: number },
  over: Partial<PcbPad> = {},
): PcbPad => {
  const r = rotatePcb(local, fp.angle);
  return {
    number: '1',
    type: 'smd',
    shape: 'rect',
    at: { x: fp.at.x + r.x, y: fp.at.y + r.y },
    angle: fp.angle,
    size: { x: MM(1), y: MM(1) },
    layers: ['F.Cu', 'F.Mask'],
    net: 0,
    source: EMPTY,
    ...over,
  };
};

const silk = (
  fp: { at: { x: number; y: number }; angle: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
  over: Partial<PcbShape> = {},
): PcbShape => {
  const a = rotatePcb(from, fp.angle);
  const b = rotatePcb(to, fp.angle);
  return {
    kind: 'line',
    start: { x: fp.at.x + a.x, y: fp.at.y + a.y },
    end: { x: fp.at.x + b.x, y: fp.at.y + b.y },
    width: MM(0.12),
    fill: false,
    layer: 'F.SilkS',
    source: EMPTY,
    ...over,
  };
};

const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'reference',
  text: 'REF**',
  at: { x: 0, y: MM(-1.5) },
  angle: 0,
  layer: 'F.SilkS',
  size: { x: MM(1), y: MM(1) },
  thickness: MM(0.15),
  source: EMPTY,
  ...over,
});

/** A polygon graphic on the silkscreen, at the footprint's origin. */
const polyFp = (pts: { x: number; y: number }[], fill = true): PcbFootprint =>
  make({ x: 0, y: 0 }, 0, {
    shapes: [{ kind: 'poly', pts, width: MM(0.12), fill, layer: 'F.SilkS', source: EMPTY }],
  });

/** A footprint placed at `at`/`angle`, with the same local geometry each time. */
const make = (at = { x: 0, y: 0 }, angle = 0, over: Partial<PcbFootprint> = {}): PcbFootprint => {
  const base = { at, angle };
  return {
    lib: 'Lib:R_0603',
    reference: 'R1',
    value: '10k',
    at,
    angle,
    layer: 'F.Cu',
    pads: [
      pad(base, { x: MM(-0.8), y: 0 }, { number: '1' }),
      pad(base, { x: MM(0.8), y: 0 }, { number: '2' }),
    ],
    shapes: [silk(base, { x: MM(-1), y: MM(-0.5) }, { x: MM(1), y: MM(-0.5) })],
    texts: [],
    points: [],
    barcodes: [],
    models: [],
    source: EMPTY,
    ...over,
  };
};

describe('placement is not a difference', () => {
  it('sees no difference between a library footprint and a placed copy', () => {
    const lib = make();
    const placed = make({ x: MM(50), y: MM(30) }, 0);

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('sees no difference when the copy is rotated', () => {
    // The thing that makes this feature useless if it is wrong: a rotated
    // footprint has every pad at a different board position.
    const lib = make();
    const placed = make({ x: MM(50), y: MM(30) }, 90);

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('tolerates the round-off of an odd rotation angle', () => {
    // We reconstruct the library frame by unrotating, and rotatePcb rounds to
    // whole IU, so the reconstruction is not exact. Without the tolerance, no
    // footprint at 45° would ever match its library original again.
    const lib = make();

    for (const angle of [20, 33, 45, 70])
      expect(footprintDifferences(make({ x: MM(50), y: MM(30) }, angle), lib)).toEqual([]);
  });

  it('is tolerating round-off that is really there', () => {
    // Pins the premise of the test above: at 45° the unrotated pad position
    // genuinely misses the library one, by a single internal unit.
    const lib = make();
    const placed = make({ x: MM(50), y: MM(30) }, 45);
    const local = footprintLocalPos(placed, placed.pads[0]!.at);

    expect(local).not.toEqual(lib.pads[0]!.at);
    expect(Math.abs(local.x - lib.pads[0]!.at.x)).toBe(1);
  });

  it('still sees a real geometric difference on a rotated copy', () => {
    const lib = make();
    const placed = make({ x: MM(50), y: MM(30) }, 90);
    placed.pads[0] = pad({ at: placed.at, angle: 90 }, { x: MM(-2), y: 0 }, { number: '1' });

    expect(footprintDifferences(placed, lib)).toContain('Pad properties differ.');
  });

  it('does not let the tolerance swallow a real move', () => {
    // 10 IU is the width of the tolerance; 11 has to be a difference, or a
    // deliberate nudge of a pad would go unreported.
    const lib = make();
    const original = make().pads[0]!;

    const moved = make();
    moved.pads[0] = { ...original, at: { x: original.at.x + 11, y: original.at.y } };

    expect(footprintDifferences(moved, lib)).toContain('Pad properties differ.');

    const nudged = make();
    nudged.pads[0] = { ...original, at: { x: original.at.x + 10, y: original.at.y } };

    expect(footprintDifferences(nudged, lib)).toEqual([]);
  });
});

describe('geometry', () => {
  it('reports a pad count difference', () => {
    const lib = make();
    const placed = make();
    placed.pads = [placed.pads[0]!];

    expect(footprintDifferences(placed, lib)).toContain('Pad count differs.');
  });

  it('reports a changed pad size', () => {
    const lib = make();
    const placed = make();
    placed.pads[0] = { ...placed.pads[0]!, size: { x: MM(2), y: MM(2) } };

    expect(footprintDifferences(placed, lib)).toContain('Pad properties differ.');
  });

  it('does not care what order the pads are stored in', () => {
    // A library that reorders its pads has not changed the footprint.
    const lib = make();
    const placed = make();
    placed.pads = [placed.pads[1]!, placed.pads[0]!];

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('does not care what order the graphics are stored in', () => {
    // Same for the drawings: both sides are put in upstream's own order before
    // anything is compared, so an edit that only reshuffles the file is silent.
    const at = { at: { x: 0, y: 0 }, angle: 0 };
    const top = silk(at, { x: MM(-1), y: MM(-0.5) }, { x: MM(1), y: MM(-0.5) });
    const bottom = silk(at, { x: MM(-1), y: MM(0.5) }, { x: MM(1), y: MM(0.5) });

    const lib = make({ x: 0, y: 0 }, 0, { shapes: [top, bottom] });
    const placed = make({ x: 0, y: 0 }, 0, { shapes: [bottom, top] });

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('reports a graphic count difference', () => {
    const lib = make();
    const placed = make();
    placed.shapes = [];

    expect(footprintDifferences(placed, lib)).toContain('Graphic item count differs.');
  });

  it('reports a moved graphic', () => {
    const lib = make();
    const placed = make();
    placed.shapes[0] = silk(
      { at: placed.at, angle: 0 },
      { x: MM(-1), y: MM(-2) },
      { x: MM(1), y: MM(-2) },
    );

    expect(footprintDifferences(placed, lib)).toContain('Graphic items differ.');
  });

  it('ignores which way round a segment was drawn', () => {
    // NormalizeForCompare turns every segment the same way first, because the
    // two directions draw the identical line.
    const lib = make();
    const placed = make();
    placed.shapes[0] = silk(
      { at: placed.at, angle: 0 },
      { x: MM(1), y: MM(-0.5) },
      { x: MM(-1), y: MM(-0.5) },
    );

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('ignores which corners of a rectangle were stored', () => {
    const box = (from: { x: number; y: number }, to: { x: number; y: number }): PcbFootprint =>
      make({ x: 0, y: 0 }, 0, {
        shapes: [
          {
            kind: 'rect',
            start: from,
            end: to,
            width: MM(0.12),
            fill: false,
            layer: 'F.SilkS',
            source: EMPTY,
          },
        ],
      });

    const lib = box({ x: MM(-1), y: MM(-1) }, { x: MM(1), y: MM(1) });
    const placed = box({ x: MM(1), y: MM(1) }, { x: MM(-1), y: MM(-1) });

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('recognises a rectangle stored as a four-vertex polygon', () => {
    // Normalize() converts an axis-aligned quadrilateral back to a rectangle,
    // so the same outline written by two different editors compares equal.
    const lib = make({ x: 0, y: 0 }, 0, {
      shapes: [
        {
          kind: 'rect',
          start: { x: MM(-1), y: MM(-1) },
          end: { x: MM(1), y: MM(1) },
          width: MM(0.12),
          fill: false,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });
    const placed = polyFp(
      [
        { x: MM(-1), y: MM(-1) },
        { x: MM(1), y: MM(-1) },
        { x: MM(1), y: MM(1) },
        { x: MM(-1), y: MM(1) },
      ],
      false,
    );

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('ignores where a polygon outline starts and which way it winds', () => {
    // CompareGeometry sorts both outlines about their own centroid first.
    const corners = [
      { x: MM(-1), y: MM(-1) },
      { x: MM(1), y: MM(-1) },
      { x: 0, y: MM(1.5) },
    ];

    expect(footprintDifferences(polyFp([...corners].reverse()), polyFp(corners))).toEqual([]);
  });

  it('reports a moved polygon vertex', () => {
    const corners = [
      { x: MM(-1), y: MM(-1) },
      { x: MM(1), y: MM(-1) },
      { x: 0, y: MM(1.5) },
    ];
    const moved = [corners[0]!, corners[1]!, { x: 0, y: MM(3) }];

    expect(footprintDifferences(polyFp(moved), polyFp(corners))).toContain('Graphic items differ.');
  });

  it('allows an arc midpoint more slack than an endpoint', () => {
    // The midpoint is derived from the centre, so it drifts further; upstream
    // gives it 0.0005 mm where a stored endpoint gets a hundredth of a micron.
    const arc = (midY: number): PcbFootprint =>
      make({ x: 0, y: 0 }, 0, {
        shapes: [
          {
            kind: 'arc',
            start: { x: MM(-1), y: 0 },
            mid: { x: 0, y: midY },
            end: { x: MM(1), y: 0 },
            width: MM(0.12),
            fill: false,
            layer: 'F.SilkS',
            source: EMPTY,
          },
        ],
      });

    expect(footprintDifferences(arc(MM(1) + 400), arc(MM(1)))).toEqual([]);
    expect(footprintDifferences(arc(MM(1) + 600), arc(MM(1)))).toContain('Graphic items differ.');
  });
});

describe('what upstream refuses to look at', () => {
  it('ignores text items entirely', () => {
    // Reference and value carry the instance's own text and are moved and
    // restyled per placement; upstream punts on all of it.
    const lib = make({ x: 0, y: 0 }, 0, { texts: [text()] });
    const placed = make({ x: 0, y: 0 }, 0, {
      texts: [
        text({
          text: 'R1',
          at: { x: MM(4), y: MM(4) },
          size: { x: MM(2), y: MM(2) },
          angle: 90,
          hide: true,
        }),
      ],
    });

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('ignores a text item the board added and the library never had', () => {
    const lib = make();
    const placed = make({ x: 0, y: 0 }, 0, { texts: [text({ kind: 'user', text: 'DNP' })] });

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('ignores the stroke of a graphic that is not on copper', () => {
    // shapeNeedsUpdate compares the stroke only on copper layers. It reads like
    // an oversight, and it is upstream's, so a silk line thickened on the board
    // is not a difference.
    const lib = make();
    const placed = make();
    placed.shapes[0] = { ...placed.shapes[0]!, width: MM(0.4), strokeType: 'dash' };

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('does compare the stroke of a graphic on copper', () => {
    const copper = (width: number): PcbFootprint =>
      make({ x: 0, y: 0 }, 0, {
        shapes: [
          silk(
            { at: { x: 0, y: 0 }, angle: 0 },
            { x: 0, y: 0 },
            { x: MM(1), y: 0 },
            {
              layer: 'F.Cu',
              width,
            },
          ),
        ],
      });

    expect(footprintDifferences(copper(MM(0.4)), copper(MM(0.12)))).toContain(
      'Graphic items differ.',
    );
  });

  it('ignores a roundrect ratio left on a pad that is not round-rectangular', () => {
    const lib = make();
    const placed = make();
    placed.pads[0] = { ...placed.pads[0]!, roundrectRatio: 0.4 };

    expect(footprintDifferences(placed, lib)).toEqual([]);
  });

  it('compares the ratio once the pad really is a roundrect', () => {
    const rounded = (ratio: number): PcbFootprint => {
      const fp = make();
      fp.pads[0] = { ...fp.pads[0]!, shape: 'roundrect', roundrectRatio: ratio };
      return fp;
    };

    expect(footprintDifferences(rounded(0.4), rounded(0.25))).toContain('Pad properties differ.');
  });

  it('tells a chamfered rectangle from the roundrect the file spells it as', () => {
    // The file has no token for CHAMFERED_RECT: it writes a roundrect that also
    // carries a chamfer, and the parser promotes the shape.
    const roundrect = (over: Partial<PcbPad> = {}): PcbFootprint => {
      const fp = make();
      fp.pads[0] = { ...fp.pads[0]!, shape: 'roundrect', roundrectRatio: 0.25, ...over };
      return fp;
    };

    const chamfered = roundrect({ chamferRatio: 0.2, chamfer: ['top_left'] });

    expect(footprintDifferences(chamfered, roundrect())).toContain('Pad properties differ.');
    // And the direction that actually matters: the chamfer is compared at all
    // only for a pad that already has one, so a chamfer *added in the library*
    // is reported by the promoted shape or not at all.
    expect(footprintDifferences(roundrect(), chamfered)).toContain('Pad properties differ.');
  });

  it('treats a pad that keeps all layers as one that never said so', () => {
    // KeepTopBottom is undefined unless RemoveUnconnected is set, so the two
    // spellings of "keep everything" have to compare equal.
    const lib = make();
    const placed = make();
    placed.pads[0] = { ...placed.pads[0]!, unconnectedLayerMode: 'keep_all' };

    expect(footprintDifferences(placed, lib)).toEqual([]);

    const removing = make();
    removing.pads[0] = { ...removing.pads[0]!, unconnectedLayerMode: 'remove_all' };

    expect(footprintDifferences(removing, lib)).toContain('Pad properties differ.');
  });
});

describe('report mode versus DRC mode', () => {
  const withAttrs = (attrs: string[]): PcbFootprint =>
    make({ x: 0, y: 0 }, 0, { attributes: attrs });

  it('reports a footprint type difference in both modes', () => {
    const lib = withAttrs(['smd']);
    const placed = withAttrs(['through_hole']);

    expect(footprintDifferences(placed, lib, 'report')).toContain('Footprint types differ.');
    expect(footprintDifferences(placed, lib, 'drc')).toContain('Footprint types differ.');
  });

  it('reports a design attribute only in report mode, under its own label', () => {
    // "Do not populate" is a decision about this board, not a stale footprint,
    // and the report names the setting the way the dialogs name it.
    const lib = withAttrs([]);
    const placed = withAttrs(['dnp']);

    expect(footprintDifferences(placed, lib, 'report')).toEqual([
      "'Do not populate' settings differ.",
    ]);
    expect(footprintDifferences(placed, lib, 'drc')).toEqual([]);
  });

  it('reports a local override only in report mode', () => {
    // Overrides are as likely set on the board as in the library; reporting
    // them as DRC errors would make every such board noisy.
    const lib = make();
    const placed = make({ x: 0, y: 0 }, 0, { localClearance: MM(0.3) });

    expect(footprintDifferences(placed, lib, 'report')).toContain('Pad clearance overridden.');
    expect(footprintDifferences(placed, lib, 'drc')).toEqual([]);
  });

  it('ignores an override the board does not set at all', () => {
    // Only a value actually set on the board counts as an override.
    const lib = make({ x: 0, y: 0 }, 0, { localClearance: MM(0.3) });
    const placed = make();

    expect(footprintDifferences(placed, lib, 'report')).toEqual([]);
  });

  it('names the pad that carries an override, and only in report mode', () => {
    const lib = make();
    const placed = make();
    placed.pads[0] = { ...placed.pads[0]!, localSolderMaskMargin: MM(0.1) };

    expect(footprintDifferences(placed, lib, 'report')).toEqual([
      'Pad 1 has solder mask expansion override.',
    ]);
    expect(footprintDifferences(placed, lib, 'drc')).toEqual([]);
  });

  it('says nothing about the overrides of a pad that already differs', () => {
    // Upstream's `else if`: the pad is being reported anyway, so its overrides
    // are not enumerated on top of that.
    const lib = make();
    const placed = make();
    placed.pads[0] = { ...placed.pads[0]!, size: { x: MM(2), y: MM(2) }, localClearance: MM(0.3) };

    expect(footprintDifferences(placed, lib, 'report')).toEqual(['Pad properties differ.']);
  });

  it('reports a net tie group in both modes', () => {
    // A net tie group is part of the footprint's own definition, not of this
    // board's use of it.
    const lib = make();
    const placed = make({ x: 0, y: 0 }, 0, { netTiePadGroups: ['1,2'] });

    expect(footprintDifferences(placed, lib, 'report')).toContain('Net tie pad groups differ.');
    expect(footprintDifferences(placed, lib, 'drc')).toContain('Net tie pad groups differ.');
  });

  it('says nothing when both sides carry the same net tie groups', () => {
    const groups = { netTiePadGroups: ['1,2', '3,4'] };

    expect(
      footprintDifferences(make({ x: 0, y: 0 }, 0, groups), make({ x: 0, y: 0 }, 0, groups)),
    ).toEqual([]);
  });

  it('reports a geometric difference in both modes', () => {
    const lib = make();
    const placed = make();
    placed.pads = [placed.pads[0]!];

    expect(footprintNeedsUpdate(placed, lib, 'report')).toBe(true);
    expect(footprintNeedsUpdate(placed, lib, 'drc')).toBe(true);
  });
});

describe('needs update', () => {
  it('is false for an unmodified placed footprint', () => {
    expect(footprintNeedsUpdate(make({ x: MM(20), y: MM(10) }, 180), make())).toBe(false);
  });

  it('is true once anything relevant differs', () => {
    const placed = make();
    placed.pads[0] = { ...placed.pads[0]!, layers: ['B.Cu'] };

    expect(footprintNeedsUpdate(placed, make())).toBe(true);
  });
});
