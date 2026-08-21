// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Arc flattening tolerance is a *length*, so it has to be given in the same
 * internal units as the radius it is compared against.
 *
 * The bug: the tolerance was hard-coded to the board's 5000 IU — 0.005 mm at
 * 1 mm = 1e6 IU, which is KiCad's `ARC_HIGH_DEF` and correct there. The
 * schematic has 1 mm = 1e4 IU, where the same 5000 means **0.5 mm**, wider than
 * most things a schematic draws round. Junction dots and power-symbol circles
 * fell straight through to the three-facet floor and rendered as triangles.
 */
import { describe, expect, it } from 'vitest';
import { PCB_IU_PER_MM, SCH_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import {
  arcToPolyline,
  facetsForRadius,
  GBR_ARC_TOLERANCE,
  PCB_ARC_TOLERANCE,
  SCH_ARC_TOLERANCE,
} from '@ziroeda/designer/src/render/gl/tessellate.js';
import { GERB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import { IU_PER_MM as GBR_ENGINE_IU_PER_MM } from '@ziroeda/gerbview';

/** The same physical 0.005 mm sagitta, in each editor's own units. */
describe('the two tolerances are one length', () => {
  it('is 0.005 mm on both sides, which is ARC_HIGH_DEF', () => {
    expect(PCB_ARC_TOLERANCE / PCB_IU_PER_MM).toBeCloseTo(0.005, 9);
    expect(SCH_ARC_TOLERANCE / SCH_IU_PER_MM).toBeCloseTo(0.005, 9);
    // And they differ by exactly the ratio of the two scales — the factor that
    // was silently dropped.
    expect(PCB_ARC_TOLERANCE / SCH_ARC_TOLERANCE).toBe(PCB_IU_PER_MM / SCH_IU_PER_MM);
    // GerbView's is the same length again, in the units its geometry arrives
    // in. Those are the *engine's*, and the engine does not use upstream's
    // gerbview scale: `gerbview/src/types.ts` declares IU_PER_MM = 1e6,
    // "following KiCad's board IU", where KiCad's gerbIUScale is 1e5.
    expect(GBR_ARC_TOLERANCE / GBR_ENGINE_IU_PER_MM).toBeCloseTo(0.005, 9);
  });

  it('is written against the scale the geometry actually uses', () => {
    // The trap: `common` exports GERB_IU_PER_MM with upstream's 1e5, and
    // nothing on the gerbview path uses it. Reaching for it here would ask for
    // a tenth of the intended sagitta and over-tessellate every arc; the
    // reverse of that mistake is what turned every eeschema circle into a
    // triangle.
    expect(GBR_ENGINE_IU_PER_MM).not.toBe(GERB_IU_PER_MM);
    expect(GBR_ARC_TOLERANCE).not.toBe(0.005 * GERB_IU_PER_MM);
    // Because the engine works in board IU, this currently equals the board's.
    // That is a coincidence of the two scales, not one constant with two names:
    // if the engine ever adopts upstream's 1e5, this must move and the board's
    // must not. It also means `rec.arcTolerance = GBR_ARC_TOLERANCE` in
    // gerbview_gl is not observable today - the recorder's default is already
    // the same number - which a mutation sweep found and which is recorded in
    // that file rather than hidden.
    expect(GBR_ARC_TOLERANCE).toBe(PCB_ARC_TOLERANCE);
  });
});

describe('a schematic circle is round', () => {
  // KiCad's default junction dot is 0.36 mm across (DEFAULT_JUNCTION_DIAM).
  const junctionRadius = 0.18 * SCH_IU_PER_MM;
  // A power symbol's circle is about a millimetre of radius.
  const powerRadius = 1 * SCH_IU_PER_MM;

  it('is a triangle under the board tolerance, which is the bug', () => {
    expect(facetsForRadius(junctionRadius, PCB_ARC_TOLERANCE)).toBe(3);
    expect(facetsForRadius(powerRadius, PCB_ARC_TOLERANCE)).toBe(3);
  });

  it('is properly faceted under the schematic tolerance', () => {
    expect(facetsForRadius(junctionRadius, SCH_ARC_TOLERANCE)).toBeGreaterThanOrEqual(12);
    expect(facetsForRadius(powerRadius, SCH_ARC_TOLERANCE)).toBeGreaterThanOrEqual(30);
  });

  it('flattens a full circle to that many points, plus the closing one', () => {
    const pts = arcToPolyline(0, 0, junctionRadius, 0, Math.PI * 2, false, SCH_ARC_TOLERANCE);
    expect(pts.length).toBe(facetsForRadius(junctionRadius, SCH_ARC_TOLERANCE) + 1);
    // Every point really is on the circle.
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(junctionRadius, 6);
  });

  it('keeps the sagitta under tolerance, which is the whole point', () => {
    const r = powerRadius;
    const n = facetsForRadius(r, SCH_ARC_TOLERANCE);
    // sagitta = r (1 - cos(pi/n))
    expect(r * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(SCH_ARC_TOLERANCE);
  });
});

describe('the board is unchanged', () => {
  it('still tessellates a via to KiCad ARC_HIGH_DEF', () => {
    // 0.3 mm drill radius on a board; the default must stay the board's.
    const r = 0.3 * PCB_IU_PER_MM;
    expect(facetsForRadius(r)).toBe(facetsForRadius(r, PCB_ARC_TOLERANCE));
    expect(facetsForRadius(r)).toBeGreaterThanOrEqual(12);
  });

  it('refuses a nonsense tolerance rather than dividing by it', () => {
    expect(facetsForRadius(1 * PCB_IU_PER_MM, 0)).toBe(facetsForRadius(1 * PCB_IU_PER_MM));
    expect(facetsForRadius(1 * PCB_IU_PER_MM, -5)).toBe(facetsForRadius(1 * PCB_IU_PER_MM));
  });
});
