// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `ROUNDRECT` (`geometry/roundrect.h`, `src/geometry/roundrect.cpp`). */

import type { VECTOR2I } from '../math/vector2.js';
import type { BOX2I } from '../math/box2.js';
import { ANGLE_360 } from './eda_angle.js';
import { Directions } from './direction45.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_RECT } from './shape_rect.js';
import { SHAPE_POLY_SET } from './shape_poly_set.js';
import { KIGEOM_GetPoint, KIGEOM_MakeArcCw180, KIGEOM_MakeArcCw90 } from './shape_utils.js';

function MakeCornerArcCw90(aRect: SHAPE_RECT, aRadius: number, aDir: Directions): SHAPE_ARC {
  const center = KIGEOM_GetPoint(aRect, aDir);
  return KIGEOM_MakeArcCw90(center, aRadius, aDir);
}

function MakeSideArcCw180(aRect: SHAPE_RECT, aRadius: number, aDir: Directions): SHAPE_ARC {
  const center = KIGEOM_GetPoint(aRect, aDir);
  return KIGEOM_MakeArcCw180(center, aRadius, aDir);
}

/**
 * A round rectangle shape, based on a rectangle and a radius.
 *
 * For now, not an inheritor of SHAPE as that means implementing a lot of
 * things that we don't need yet.
 */
export class ROUNDRECT {
  private m_rect: SHAPE_RECT;
  private m_radius: number;

  constructor();
  constructor(aRect: SHAPE_RECT, aRadius: number, aNormalizeOnCreate?: boolean);
  constructor(aRect?: SHAPE_RECT, aRadius = 0, aNormalizeOnCreate = false) {
    if (aRect === undefined) {
      this.m_rect = new SHAPE_RECT();
      this.m_radius = 0;
      return;
    }

    this.m_rect = new SHAPE_RECT(aRect);
    this.m_radius = aRadius;

    if (aNormalizeOnCreate) this.m_rect.Normalize();

    // Ensure radius is compatible with rectangle size:
    const min_radius = Math.trunc(Math.abs(this.m_rect.MinorDimension()) / 2);

    if (this.m_radius > min_radius) this.m_radius = min_radius;

    if (this.m_radius < 0) this.m_radius = 0;
  }

  static OutsetFrom(aRect: SHAPE_RECT, aOutset: number): ROUNDRECT {
    return new ROUNDRECT(aRect.GetInflated(aOutset), aOutset);
  }

  GetRoundRadius(): number {
    return this.m_radius;
  }

  GetRect(): SHAPE_RECT {
    return this.m_rect;
  }

  GetWidth(): number {
    return this.m_rect.GetWidth();
  }

  GetHeight(): number {
    return this.m_rect.GetHeight();
  }

  GetPosition(): VECTOR2I {
    return this.m_rect.GetPosition();
  }

  BBox(): BOX2I {
    return this.m_rect.BBox();
  }

  /**
   * Get the roundrect with the size increased by aOutset in all directions.
   * (the radius increases by aOutset as well).
   */
  GetInflated(aOutset: number): ROUNDRECT {
    return new ROUNDRECT(this.m_rect.GetInflated(aOutset), this.m_radius + aOutset);
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aMaxError: number): void {
    // Roundrects won't have a gazillion points, so we use a higher definition than the
    // typical maxError.
    const maxError = Math.trunc(aMaxError / 5);
    const tmp = new SHAPE_POLY_SET();
    const idx = tmp.NewOutline();
    const outline = tmp.Outline(idx);

    const w = this.m_rect.GetWidth();
    const h = this.m_rect.GetHeight();

    // Handle non normalized rect (i.e. w or h < 0 )
    if (w < 0 || h < 0) {
      const norm_rr = new ROUNDRECT(this.m_rect, this.m_radius, true); // build a normalized ROUNDRECT (w,h >= 0)
      norm_rr.TransformToPolygon(aBuffer, aMaxError);
      return;
    }

    // This code works fine only with normalized rect (i.e. w or h >= 0 )
    const x_edge = this.m_rect.GetWidth() - 2 * this.m_radius;
    const y_edge = this.m_rect.GetHeight() - 2 * this.m_radius;

    // Handle degenerate cases where dimensions are invalid
    // This can happen with negative inflate values or zero-size rectangles
    if (x_edge < 0 || y_edge < 0 || this.m_radius < 0 || w <= 0 || h <= 0) return;

    const m_p0 = this.m_rect.GetPosition();
    const p = (dx: number, dy: number): VECTOR2I => ({ x: m_p0.x + dx, y: m_p0.y + dy });

    if (this.m_radius === 0) {
      // It's just a rectangle
      outline.Append(m_p0);
      outline.Append(p(w, 0));
      outline.Append(p(w, h));
      outline.Append(p(0, h));
    } else if (x_edge === 0 && y_edge === 0) {
      // It's a circle
      outline.Append(
        new SHAPE_ARC(p(this.m_radius, this.m_radius), p(0, this.m_radius), ANGLE_360),
        maxError,
      );
    } else {
      const inner_rect = new SHAPE_RECT(p(this.m_radius, this.m_radius), x_edge, y_edge);

      if (x_edge > 0) {
        // Either a normal roundrect or an oval with x_edge > 0

        // Start to the right of the top left radius
        outline.Append(p(this.m_radius, 0));

        // Top side
        outline.Append(p(this.m_radius + x_edge, 0));

        if (y_edge > 0) {
          outline.Append(MakeCornerArcCw90(inner_rect, this.m_radius, Directions.NE), maxError);
          outline.Append(p(w, this.m_radius + y_edge));
          outline.Append(MakeCornerArcCw90(inner_rect, this.m_radius, Directions.SE), maxError);
        } else {
          outline.Append(MakeSideArcCw180(inner_rect, this.m_radius, Directions.E), maxError);
        }

        // Bottom side
        outline.Append(p(this.m_radius, h));

        if (y_edge > 0) {
          outline.Append(MakeCornerArcCw90(inner_rect, this.m_radius, Directions.SW), maxError);
          outline.Append(p(0, this.m_radius));
          outline.Append(MakeCornerArcCw90(inner_rect, this.m_radius, Directions.NW), maxError);
        } else {
          outline.Append(MakeSideArcCw180(inner_rect, this.m_radius, Directions.W), maxError);
        }
      } else {
        // x_edge is 0 but y_edge is not, so it's an oval the other way up
        outline.Append(p(0, this.m_radius));
        outline.Append(MakeSideArcCw180(inner_rect, this.m_radius, Directions.N), maxError);
        outline.Append(p(w, this.m_radius + y_edge));
        outline.Append(MakeSideArcCw180(inner_rect, this.m_radius, Directions.S), maxError);
      }
    }

    outline.SetClosed(true);
    aBuffer.assign(tmp);
  }
}
