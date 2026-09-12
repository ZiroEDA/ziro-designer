// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(drill … (offset x y))` moves the pad's COPPER, not its hole.
 *
 *     VECTOR2I PAD::ShapePos( PCB_LAYER_ID aLayer ) const
 *     {
 *         if( GetOffset( aLayer ) == VECTOR2I( 0, 0 ) ) return m_pos;
 *         VECTOR2I loc_offset = GetOffset( aLayer );
 *         RotatePoint( loc_offset, GetOrientation() );
 *         return m_pos + loc_offset;
 *     }
 *
 * while `GetEffectiveHoleShape()` builds its `SHAPE_SEGMENT` from `m_pos`. This
 * tree had the pair the other way round — the hole drawn and knocked out at
 * `at + offset`, the copper left on `at` — which keeps the two the right
 * distance apart and puts both in the wrong place. Every TO-92 on the
 * `complex_hierarchy` demo carries a 0.4 mm offset, and the pour's reliefs and
 * spokes were 0.4 mm off around all of them.
 *
 * The three expected positions are KiCad 10.0.5's own answers for that board,
 * read back through `pad.ShapePos( pcbnew.F_Cu )`.
 */
import { describe, it, expect } from 'vitest';
import { padShapePos } from '@ziroeda/pcbnew/src/padstack.js';
import { padShapes } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { padHoleSegment } from '@ziroeda/pcbnew/src/footprint_checker.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PcbPad } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'rect',
  at: { x: MM(10), y: MM(10) },
  angle: 0,
  size: { x: MM(1.1), y: MM(1.8) },
  layers: ['*.Cu'],
  net: 1,
  drill: { oblong: false, w: MM(0.75), h: MM(0.75), offset: { x: 0, y: MM(0.4) } },
  ...over,
});

/** The centre of the axis-aligned box the pad's copper covers. */
const copperCentre = (p: PcbPad): { x: number; y: number } => {
  const pts = padShapes(p).flatMap((s) =>
    s.kind === 'poly' ? s.pts : s.kind === 'circle' ? [s.c] : [],
  );
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};

describe('PAD::ShapePos', () => {
  it('answers what KiCad answers for complex_hierarchy, at every orientation', () => {
    // Q201 pad 1: (at 131.445 115.316 0), offset (0, 0.4) -> (131.445, 115.716)
    const q201 = padShapePos(pad({ at: { x: MM(131.445), y: MM(115.316) }, angle: 0 }));
    expect(q201.x).toBeCloseTo(MM(131.445), 0);
    expect(q201.y).toBeCloseTo(MM(115.716), 0);

    // U101 pad 1: (at 124.206 70.866 90), offset (0, 0.4) -> (124.606, 70.866)
    const u101 = padShapePos(pad({ at: { x: MM(124.206), y: MM(70.866) }, angle: 90 }));
    expect(u101.x).toBeCloseTo(MM(124.606), 0);
    expect(u101.y).toBeCloseTo(MM(70.866), 0);

    // Q203 pad 1: (at 151.765 123.825 180), offset (0, 0.4) -> (151.765, 123.425)
    const q203 = padShapePos(pad({ at: { x: MM(151.765), y: MM(123.825) }, angle: 180 }));
    expect(q203.x).toBeCloseTo(MM(151.765), 0);
    expect(q203.y).toBeCloseTo(MM(123.425), 0);
  });

  it('leaves a pad with no offset exactly on its position', () => {
    const p = pad({ drill: { oblong: false, w: MM(0.75), h: MM(0.75) } });
    expect(padShapePos(p)).toEqual(p.at);
    expect(padShapePos(pad({ drill: undefined, type: 'smd' }))).toEqual(pad().at);
  });

  it('puts the copper on ShapePos and the hole on the pad position', () => {
    const p = pad();
    const copper = copperCentre(p);
    expect(copper.x).toBeCloseTo(p.at.x, 0);
    expect(copper.y).toBeCloseTo(p.at.y + MM(0.4), 0);

    // `GetEffectiveHoleShape` reads `m_pos`, so the hole does not move.
    const hole = padHoleSegment(p)!;
    expect(hole.a).toEqual(p.at);
    expect(hole.b).toEqual(p.at);
  });

  it('turns the offset with the pad, so the copper leads the rotation', () => {
    const copper = copperCentre(pad({ angle: 90 }));
    expect(copper.x).toBeCloseTo(MM(10) + MM(0.4), 0);
    expect(copper.y).toBeCloseTo(MM(10), 0);
  });
});
