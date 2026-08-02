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
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { footprintDifferences, footprintNeedsUpdate } from '@ziroeda/pcbnew/src/footprint_diff.js';
import { rotatePcb } from '@ziroeda/pcbnew/src/read-board.js';
import type { PcbFootprint, PcbPad, PcbShape } from '@ziroeda/pcbnew/src/types.js';

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
  };
};

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

  it('still sees a real geometric difference on a rotated copy', () => {
    const lib = make();
    const placed = make({ x: MM(50), y: MM(30) }, 90);
    placed.pads[0] = pad({ at: placed.at, angle: 90 }, { x: MM(-2), y: 0 }, { number: '1' });

    expect(footprintDifferences(placed, lib)).toContain('Pad properties differ.');
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

  it('reports a design attribute only in report mode', () => {
    // "Do not populate" is a decision about this board, not a stale footprint.
    const lib = withAttrs([]);
    const placed = withAttrs(['dnp']);

    expect(footprintDifferences(placed, lib, 'report').length).toBeGreaterThan(0);
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
