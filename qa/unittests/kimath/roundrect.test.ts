// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_roundrect.cpp` (Roundrect) and
 * `test_shape_rect_corner.cpp`, transcribed against `ROUNDRECT` / `SHAPE_RECT`.
 */
import { describe, expect, it } from 'vitest';
import { ROUNDRECT } from '@ziroeda/kimath/src/geometry/roundrect.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

describe('Roundrect', () => {
  // The polygon must fit its rectangle. One maxError of slack covers the arc
  // chords. Catches the maxed-radius circle coming out too big (#24623).
  function CheckPolygonFitsRect(aWidth: number, aHeight: number, aRadius: number): void {
    const maxError = 100;
    const pos = V(1000, 2000);

    const rr = new ROUNDRECT(new SHAPE_RECT(pos, aWidth, aHeight), aRadius);

    const poly = new SHAPE_POLY_SET();
    rr.TransformToPolygon(poly, maxError);

    expect(poly.OutlineCount()).toBe(1);

    const bbox = poly.BBox();
    const tol = maxError;

    expect(Math.abs(bbox.GetLeft() - pos.x)).toBeLessThanOrEqual(tol);
    expect(Math.abs(bbox.GetTop() - pos.y)).toBeLessThanOrEqual(tol);
    expect(Math.abs(bbox.GetWidth() - aWidth)).toBeLessThanOrEqual(tol);
    expect(Math.abs(bbox.GetHeight() - aHeight)).toBeLessThanOrEqual(tol);
  }

  // Radius is half of both sides, so it becomes a circle (#24623).
  it('CircleFromSquare', () => {
    CheckPolygonFitsRect(10000000, 10000000, 5000000);
  });

  // Radius maxed on the height only, giving a horizontal oval.
  it('OvalWide', () => {
    CheckPolygonFitsRect(20000000, 10000000, 5000000);
  });

  // Radius maxed on the width only, giving a vertical oval.
  it('OvalTall', () => {
    CheckPolygonFitsRect(10000000, 20000000, 5000000);
  });

  // Ordinary roundrect, corners below the max radius.
  it('NormalRoundrect', () => {
    CheckPolygonFitsRect(20000000, 10000000, 2000000);
  });

  // Zero radius is a plain rectangle.
  it('PlainRectangle', () => {
    CheckPolygonFitsRect(20000000, 10000000, 0);
  });
});

describe('ShapeRectCorner', () => {
  it('ShapeRectCornerRadius', () => {
    const rect = new SHAPE_RECT(V(0, 0), V(10, 10));
    rect.SetRadius(2);
    expect(rect.GetRadius()).toBe(2);
  });
});
