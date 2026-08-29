// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::RULER_ITEM`'s graduations.
 *
 * The numbers below are read off a real KiCad, not off ours. Akshay captured
 * CVPCB's footprint viewer measuring across `C_Radial_D8.0mm_H11.5mm_P3.50mm`
 * at Zoom 26.99, and in that capture the ruler is labelled every **1 mm** —
 * 0.000, 1.000 … 10.000 — with **four** unlabelled ticks between each pair. Ten
 * millimetres spans about 965 device pixels along the line, which is the scale
 * fed in here.
 *
 * That pins `getTickFormatForScale` end to end: the 1/2/5-per-decade climb has
 * to stop at a 0.2 mm tick under format `{ 2, 5, 0 }` to produce that picture.
 * It first stopped at 1 mm under `{ 2, 5, 0 }` — a label every 5 mm — because
 * the climb was seeded at one millimetre instead of one internal unit.
 */
import { describe, expect, it } from 'vitest';
import { PCB_IU_PER_MM } from '@ziroeda/common';
import { rulerTicks, MINOR_TICK_PX } from '@ziroeda/designer/src/ui/ruler_item.js';

/** The scale in Akshay's capture: 965 device px across 10 mm. */
const CAPTURE_PX_PER_IU = 965 / (10 * PCB_IU_PER_MM);

describe('the ruler graduations at the scale a real KiCad was measured at', () => {
  const ticks = rulerTicks(10 * PCB_IU_PER_MM, CAPTURE_PX_PER_IU, PCB_IU_PER_MM, 'mm');

  it('spaces them 0.2 mm apart', () => {
    // Two consecutive ticks, in mm.
    expect(ticks.length).toBeGreaterThan(2);
    const step = (ticks[1]!.distIU - ticks[0]!.distIU) / PCB_IU_PER_MM;
    expect(step).toBeCloseTo(0.2, 6);
  });

  it('labels every millimetre, as the capture does', () => {
    const labelled = ticks.filter((t) => t.label !== null).map((t) => t.label);
    expect(labelled.slice(0, 4)).toEqual(['0.000', '1.000', '2.000', '3.000']);
  });

  it('leaves exactly four unlabelled ticks between two labelled ones', () => {
    // `majorStep` 5 with no mid step: |....|
    const first = ticks.findIndex((t) => t.label !== null);
    const second = ticks.findIndex((t, i) => i > first && t.label !== null);
    expect(second - first - 1).toBe(4);
  });

  it('draws the labelled ones longer, by majorTickLengthFactor', () => {
    const major = ticks.find((t) => t.label !== null)!;
    const minor = ticks.find((t) => t.label === null)!;
    expect(minor.lengthPx).toBe(MINOR_TICK_PX);
    // `length *= majorTickLengthFactor` — 2.5 (ruler_item.cpp:36, 210).
    expect(major.lengthPx).toBeCloseTo(MINOR_TICK_PX * 2.5, 6);
  });
});

describe('the climb is seeded in internal units, not millimetres', () => {
  it('can choose a tick FINER than a millimetre when zoomed in', () => {
    // The bug this pins: seeded at 1 mm the sequence can never go below one
    // millimetre, so no zoom however close produces a sub-mm graduation.
    const zoomedIn = rulerTicks(
      1 * PCB_IU_PER_MM,
      // 500 px per mm — well inside a millimetre per tick.
      500 / PCB_IU_PER_MM,
      PCB_IU_PER_MM,
      'mm',
    );
    const step = (zoomedIn[1]!.distIU - zoomedIn[0]!.distIU) / PCB_IU_PER_MM;
    expect(step).toBeLessThan(1);
  });

  it('still coarsens past a millimetre when zoomed out', () => {
    const zoomedOut = rulerTicks(
      200 * PCB_IU_PER_MM,
      2 / PCB_IU_PER_MM, // 2 px per mm
      PCB_IU_PER_MM,
      'mm',
    );
    const step = (zoomedOut[1]!.distIU - zoomedOut[0]!.distIU) / PCB_IU_PER_MM;
    expect(step).toBeGreaterThan(1);
  });

  it('never returns a tick closer than maxTickDensity on screen', () => {
    // `if( pixelSpace >= maxTickDensity ) break;` — 10 px, the whole point of
    // the loop. A seed bug in either direction breaks this.
    for (const pxPerMM of [0.5, 2, 20, 200, 2000]) {
      const t = rulerTicks(50 * PCB_IU_PER_MM, pxPerMM / PCB_IU_PER_MM, PCB_IU_PER_MM, 'mm');
      const stepIU = t[1]!.distIU - t[0]!.distIU;
      expect(stepIU * (pxPerMM / PCB_IU_PER_MM)).toBeGreaterThanOrEqual(10);
    }
  });
});
