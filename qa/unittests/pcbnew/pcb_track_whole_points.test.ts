// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A track's points are VECTOR2I upstream (pcb_track.h): SetStart, SetEnd, SetMid and
 * SetPosition take `const VECTOR2I&`, Move/Rotate/Mirror/Flip take a VECTOR2I vector or
 * centre, and SetStartX & co. take an `int`. A VECTOR2D or a double handed to any of them is
 * truncated on the way in, so a track never holds a fraction.
 *
 * Ours stored whatever came, and a track whose end was 149312449.5 later threw in
 * PCB_TRACK::HitTest - TestSegmentHit's SEG::SquaredDistance converts the track's own ends to
 * BigInt (Sentry JAVASCRIPT-REACT-1D, 11-11, current build, a user clicking about a board).
 */
import { describe, expect, it } from 'vitest';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 ""))`;

const half = { x: 149312449.5, y: 20000000.75 };
/** A mirror doubles its centre, which makes a half whole: a quarter shows the cast. */
const quarter = { x: 30000000.25, y: 20000000.25 };
const whole = (p: { x: number; y: number }): boolean =>
  Number.isInteger(p.x) && Number.isInteger(p.y);
const ends = (t: PCB_TRACK): { x: number; y: number }[] => [t.GetStart(), t.GetEnd()];

function track(): PCB_TRACK {
  const t = new PCB_TRACK(ParseBoard(BOARD));
  t.SetStart({ x: 100000000, y: 10000000 });
  t.SetEnd({ x: 160000000, y: 40000000 });
  t.SetWidth(250000);
  return t;
}

describe('PCB_TRACK holds whole points (pcb_track.h: VECTOR2I m_Start, m_End)', () => {
  it('SetStart / SetEnd / SetPosition truncate, as `const VECTOR2I&` does', () => {
    const t = track();
    t.SetStart(half);
    expect(t.GetStart()).toEqual({ x: 149312449, y: 20000000 });
    t.SetEnd({ x: -3.5, y: 7.9 });
    expect(t.GetEnd()).toEqual({ x: -3, y: 7 });
    t.SetPosition(half);
    expect(t.GetStart()).toEqual({ x: 149312449, y: 20000000 });
  });

  it('SetStartX / SetStartY / SetEndX / SetEndY truncate, as `int` does', () => {
    const t = track();
    t.SetStartX(1.5);
    t.SetStartY(2.5);
    t.SetEndX(-3.5);
    t.SetEndY(4.5);
    expect(ends(t)).toEqual([
      { x: 1, y: 2 },
      { x: -3, y: 4 },
    ]);
  });

  it('Move, Rotate, Mirror and Flip take whole vectors and centres', () => {
    const each = (aOp: (t: PCB_TRACK) => void): boolean => {
      const t = track();
      aOp(t);
      return ends(t).every(whole);
    };
    expect(each((t) => t.Move({ x: 0.5, y: 0.5 }))).toBe(true);
    expect(each((t) => t.Rotate(half, new EDA_ANGLE(90, EDA_ANGLE_T.DEGREES_T)))).toBe(true);
    expect(each((t) => t.Mirror(quarter, FLIP_DIRECTION.LEFT_RIGHT))).toBe(true);
    expect(each((t) => t.Mirror(quarter, FLIP_DIRECTION.TOP_BOTTOM))).toBe(true);
    expect(each((t) => t.Flip(quarter, FLIP_DIRECTION.LEFT_RIGHT))).toBe(true);
    expect(each((t) => t.Flip(quarter, FLIP_DIRECTION.TOP_BOTTOM))).toBe(true);
  });

  it('a slanted track given a half-IU end is still hit-tested (the 1D crash)', () => {
    const t = track();
    t.SetEnd(half);
    expect(() => t.HitTest({ x: 120000000, y: 15000000 }, 0)).not.toThrow();
  });

  it("an arc's mid and a via's position are whole too", () => {
    const b = ParseBoard(BOARD);
    const a = new PCB_ARC(b);
    a.SetStart({ x: 0, y: 0 });
    a.SetEnd({ x: 20000000, y: 0 });
    a.SetMid({ x: 10000000.5, y: 10000000.5 });
    expect(a.GetMid()).toEqual({ x: 10000000, y: 10000000 });
    const arcWhole = (): boolean => [a.GetStart(), a.GetMid(), a.GetEnd()].every(whole);
    a.Move({ x: 0.5, y: -0.5 });
    expect(arcWhole()).toBe(true);
    a.Rotate(half, new EDA_ANGLE(90, EDA_ANGLE_T.DEGREES_T));
    expect(arcWhole()).toBe(true);
    a.Mirror(quarter, FLIP_DIRECTION.TOP_BOTTOM);
    expect(arcWhole()).toBe(true);
    a.Flip(quarter, FLIP_DIRECTION.LEFT_RIGHT);
    expect(arcWhole()).toBe(true);

    const v = new PCB_VIA(b);
    v.SetPosition(half);
    expect(ends(v)).toEqual([
      { x: 149312449, y: 20000000 },
      { x: 149312449, y: 20000000 },
    ]);
    v.Flip(quarter, FLIP_DIRECTION.LEFT_RIGHT);
    expect(ends(v).every(whole)).toBe(true);
  });
});
