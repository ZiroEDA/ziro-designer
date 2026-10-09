// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `CalcArcCenter` (trigo.cpp) against KiCad 10.0.6 itself: each expected centre is
 * `PCB_SHAPE::SetArcGeometry( start, mid, end )` then `GetCenter()` through the
 * installed `pcbnew` Python module, which runs the real CalcArcCenter.
 *
 * The first case is the one that matters. Its first chord is horizontal, so
 * `0.5 / yDelta_21` is infinite, the slope uncertainty `0 * inf` is NaN, and every
 * "snap the centre to a round 10 / 100 IU" comparison comes out false - KiCad keeps
 * the raw centre. A port that guards yDelta to keep the uncertainty finite snaps
 * y to -109548300 instead, which moved every vertex of an Allegro copper fill on
 * the VCU118 board by up to 86 nm.
 */
import { describe, expect, it } from 'vitest';
import { CalcArcCenterI } from '@ziroeda/kimath/src/trigo.js';

const v = (x: number, y: number) => ({ x, y });

describe('CalcArcCenter matches KiCad 10.0.6', () => {
  it('a horizontal first chord keeps the unsnapped centre (NaN uncertainty)', () => {
    expect(
      CalcArcCenterI(v(152758597, -109188860), v(152040083, -109188860), v(152040082, -109907375)),
    ).toEqual(v(152399340, -109548276));
  });

  it('a symmetric arc', () => {
    expect(CalcArcCenterI(v(0, 0), v(1000, -1000), v(2000, 0))).toEqual(v(1000, 0));
  });

  it('an arc whose centre snaps to a round value', () => {
    expect(CalcArcCenterI(v(100000, 0), v(0, 100003), v(-100000, 7))).toEqual(v(0, 3));
  });
});
