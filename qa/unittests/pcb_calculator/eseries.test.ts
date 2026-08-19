// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, expect, it } from 'vitest';
import {
  E12_VALUES,
  E24_VALUES,
  E96_VALUES,
  ESeriesId,
  RES_NOT_WORTH_USING,
  eseriesInRange,
  eseriesNearest,
  resApproximationText,
  resEquivCalc,
} from '@ziroeda/pcb_calculator';

describe('eseries tables', () => {
  it('has the right series sizes', () => {
    expect(E12_VALUES).toHaveLength(12);
    expect(E24_VALUES).toHaveLength(24);
    expect(E96_VALUES).toHaveLength(96);
  });

  it('spans decades without float noise', () => {
    const vals = eseriesInRange(ESeriesId.E12, -1, 1);
    expect(vals).toContain(0.47);
    expect(vals).toContain(4.7);
    expect(vals).toContain(47);
    expect(vals).toHaveLength(36);
  });

  it('finds nearest values', () => {
    expect(eseriesNearest(ESeriesId.E24, 4990)).toBe(5100);
    expect(eseriesNearest(ESeriesId.E12, 3.5)).toBe(3.3);
    expect(eseriesNearest(ESeriesId.E96, 10000)).toBe(10000);
  });
});

describe('resistor substitution (RES_EQUIV_CALC port)', () => {
  it('finds an exact 2R for an in-series decade pair', () => {
    // 14.7k from E12: 12k + 2.7k exactly; s3r/s4r absent (KiCad "Not worth using").
    const r = resEquivCalc(14700, ESeriesId.E12)!;
    expect(r.s2r.value).toBe(14700);
    expect(r.s3r).toBeUndefined();
    expect(r.s4r).toBeUndefined();
  });

  it('improves (or matches) accuracy with more resistors', () => {
    const r = resEquivCalc(3456, ESeriesId.E12, [3456])!;
    const e2 = Math.abs(r.s2r.value - 3456);
    expect(r.s3r).toBeDefined();
    const e3 = Math.abs(r.s3r!.value - 3456);
    expect(e3).toBeLessThanOrEqual(e2);
    if (r.s4r) expect(Math.abs(r.s4r.value - 3456)).toBeLessThanOrEqual(e3);
  });

  it('finds the exact 4R network KiCad finds for 4321.9 Ω on E24', () => {
    const r = resEquivCalc(4321.9, ESeriesId.E24, [4321.9])!;
    expect(r.s4r).toBeDefined();
    expect(r.s4r!.value).toBeCloseTo(4321.9, 9);
  });

  it('uses KiCad notation for names', () => {
    const r = resEquivCalc(14700, ESeriesId.E12)!;
    // "12K + 2K7" (order per the sorted 2R buffer construction).
    expect(r.s2r.name).toMatch(/K/);
    expect(r.s2r.parts).toHaveLength(2);
  });

  it('rejects out-of-range series id', () => {
    expect(resEquivCalc(4700, ESeriesId.E96)).toBeNull();
    expect(resEquivCalc(Number.NaN, ESeriesId.E24)?.s2r.value).toBeUndefined();
  });

  it('honours excluded values', () => {
    // Excluding 4.7k removes it from every combination's parts.
    const excl = resEquivCalc(4700, ESeriesId.E24, [4700])!;
    expect(excl.s2r.parts).not.toContain(4700);
    expect(excl.s3r === undefined || !excl.s3r.parts.includes(4700)).toBe(true);
  });
});

/**
 * The Approximation cell's text, and the values driven side by side against
 * pcb_calculator 10.0.5 on the Resistor Calculator page.
 */
describe('Resistor Calculator display strings', () => {
  it('names an exact hit "Exact" and a tiny one "<0.01"', () => {
    expect(resApproximationText(0)).toBe('Exact');
    expect(resApproximationText(0.004)).toBe('<0.01');
    expect(resApproximationText(-0.004)).toBe('<0.01');
  });

  it('always writes the sign, at two decimals', () => {
    // %+.2f — the plus is not decorative, KiCad prints it.
    expect(resApproximationText(-0.53)).toBe('-0.53');
    expect(resApproximationText(100)).toBe('+100.00');
    expect(resApproximationText(33.333333)).toBe('+33.33');
    expect(resApproximationText(0.5)).toBe('+0.50');
  });

  it('an absent level is "Not worth using"', () => {
    expect(RES_NOT_WORTH_USING).toBe('Not worth using');
  });

  it('reproduces the 3.1 kOhm E6 run from the real binary', () => {
    // KiCad, driven: Simple "3K3 | 47K" -0.53, 3R "100R + 1K5 + 1K5" Exact,
    // 4R absent.
    const target = 3100;
    const r = resEquivCalc(target, ESeriesId.E6, [target]);
    expect(r).toBeTruthy();
    expect(r?.s2r?.name).toBe('3K3 | 47K');
    expect(resApproximationText((r!.s2r!.value / target - 1) * 100)).toBe('-0.53');
    expect(r?.s3r?.name).toBe('100R + 1K5 + 1K5');
    expect(resApproximationText((r!.s3r!.value / target - 1) * 100)).toBe('Exact');
    expect(r?.s4r).toBeFalsy();
  });

  it('reproduces the 2.5 Ohm E6 run, where every level overshoots', () => {
    // KiCad, driven: "10R | 10R" +100.00, "10R | 10R | 10R" +33.33,
    // "10R | 10R | 10R | 10R" Exact. (The real field is 54 px wide and clips
    // the first two to "+100." and "+33.3"; the VALUE is the full string.)
    const target = 2.5;
    const r = resEquivCalc(target, ESeriesId.E6, [target]);
    expect(r?.s2r?.name).toBe('10R | 10R');
    expect(resApproximationText((r!.s2r!.value / target - 1) * 100)).toBe('+100.00');
    expect(r?.s3r?.name).toBe('10R | 10R | 10R');
    expect(resApproximationText((r!.s3r!.value / target - 1) * 100)).toBe('+33.33');
    expect(r?.s4r?.name).toBe('10R | 10R | 10R | 10R');
    expect(resApproximationText((r!.s4r!.value / target - 1) * 100)).toBe('Exact');
  });
});
