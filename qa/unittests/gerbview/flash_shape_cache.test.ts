// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two aperture-shape caches KiCad has and we did not.
 *
 * `D_CODE::m_Polygon` is built once per aperture and
 * `GERBER_DRAW_ITEM::m_AbsolutePolygon` once per item; every upstream call site
 * is guarded by an `OutlineCount() == 0` test
 * (`gerbview/gerbview_painter.cpp:283, 505, 530, 573, 584, 601`), so neither is
 * ever recomputed. We rebuilt both on every frame.
 *
 * What is pinned here is the *level* each cache lives at, which is the part
 * that can be got wrong silently: an absolute-coordinate shape cached on the
 * shared aperture would put every flash of a D-code at the first flash's
 * position, and every pixel would still be drawn.
 */
import { describe, expect, it } from 'vitest';
import { parseGerber, GBR_BASIC_SHAPE, APERTURE_T, D_CODE, IU_PER_MM } from '@ziroeda/gerbview';

const twoFlashes = [
  '%FSLAX46Y46*%',
  '%MOMM*%',
  '%ADD10C,0.5*%',
  'D10*',
  'X0Y0D03*',
  'X5000000Y2000000D03*',
  'M02*',
].join('\n');

describe('aperture shape caches', () => {
  it('resolves a flash once and hands the same array back', () => {
    const img = parseGerber(twoFlashes, 'a.gbr');
    const item = img.items[0]!;
    expect(item.shape).toBe(GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE);
    expect(item.resolveFlashShapes()).toBe(item.resolveFlashShapes());
  });

  it('resolves an aperture once and hands the same array back', () => {
    const img = parseGerber(twoFlashes, 'a.gbr');
    const code = img.items[0]!.dcode!;
    expect(code.getFlashShapes()).toBe(code.getFlashShapes());
  });

  it('caches the absolute shape per item, not per aperture', () => {
    // Both items flash the same D10. If the absolute shape were cached on the
    // shared aperture, the second flash would come back at the first's centre.
    const img = parseGerber(twoFlashes, 'a.gbr');
    const [a, b] = img.items;
    expect(a!.dcode).toBe(b!.dcode);
    const ca = a!.resolveFlashShapes()[0]!;
    const cb = b!.resolveFlashShapes()[0]!;
    expect(ca.kind).toBe('circle');
    expect(cb.kind).toBe('circle');
    if (ca.kind !== 'circle' || cb.kind !== 'circle') throw new Error('not circles');
    expect(ca.center).toEqual({ x: 0, y: 0 });
    // X5.0 Y2.0 mm in gerbview IU.
    expect(cb.center.x).toBeCloseTo(5 * IU_PER_MM, 6);
    expect(cb.center.y).toBeCloseTo(2 * IU_PER_MM, 6);
    expect(a!.resolveFlashShapes()).not.toBe(b!.resolveFlashShapes());
  });

  it('serves the cached aperture shape until it is invalidated', () => {
    // Not a KiCad behaviour to match, a contract to state: the cache is real,
    // so a mutation of the aperture is invisible until invalidateFlashShapes.
    // This is the only caller of the invalidator, and that is the point - see
    // its comment for why the parser must not be one.
    const code = new D_CODE(10, IU_PER_MM);
    code.shape = APERTURE_T.APT_CIRCLE;
    code.size = { x: 1, y: 1 };
    const first = code.getFlashShapes()[0]!;
    if (first.kind !== 'circle') throw new Error('not a circle');
    expect(first.radius).toBeCloseTo(0.5 * IU_PER_MM, 6);

    code.size = { x: 4, y: 4 };
    const stale = code.getFlashShapes()[0]!;
    if (stale.kind !== 'circle') throw new Error('not a circle');
    expect(stale.radius).toBeCloseTo(0.5 * IU_PER_MM, 6);

    code.invalidateFlashShapes();
    const fresh = code.getFlashShapes()[0]!;
    if (fresh.kind !== 'circle') throw new Error('not a circle');
    expect(fresh.radius).toBeCloseTo(2 * IU_PER_MM, 6);
  });

  it('re-describing a D-code in the file does not serve the old shape', () => {
    // Passes because the cache is built lazily, after the parse - not because
    // anything invalidates during it. Kept as a regression guard on that
    // ordering: build a shape eagerly at `%ADD` time and this fails.
    const g = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,1*%',
      'D10*',
      'X0Y0D03*',
      '%ADD10C,4*%',
      'D10*',
      'X5000000Y0D03*',
      'M02*',
    ].join('\n');
    const img = parseGerber(g, 'a.gbr');
    const last = img.items[img.items.length - 1]!;
    const sh = last.resolveFlashShapes()[0]!;
    if (sh.kind !== 'circle') throw new Error('not a circle');
    expect(sh.radius).toBeCloseTo(2 * IU_PER_MM, 6);
  });
});
