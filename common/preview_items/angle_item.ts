// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/preview_items/angle_item.h` + `common/preview_items/angle_item.cpp`:
 * `KIGFX::PREVIEW::ANGLE_ITEM`, the angle readout a point editor draws at the
 * corner being dragged or hovered, and at its two neighbours - an arc (or a
 * right-angle mark) and the angle in degrees, with a second, inner mark where
 * two of the shown angles are equal.
 */

import { ANGLE_HORIZONTAL, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { FONT } from '../font/font.js';
import { METRICS } from '../font/font_metrics.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import { EDIT_POINT, type EDIT_POINTS } from '../tool/edit_points.js';
import type { VIEW } from '../view/view.js';
import { SIMPLE_OVERLAY_ITEM } from './simple_overlay_item.js';

/** `VECTOR2D::Resize( aNewLength )`: the same direction, that length. */
function resizeD(v: Vec2, aNewLength: number): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: (v.x * aNewLength) / len, y: (v.y * aNewLength) / len };
}

const addD = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

interface AngleInfo {
  point: EDIT_POINT;
  angle: EDA_ANGLE;
  center: Vec2;
  v1: VECTOR2I;
  v2: VECTOR2I;
  start: EDA_ANGLE;
  sweep: EDA_ANGLE;
  mid: EDA_ANGLE;
  isRightAngle: boolean;
}

export class ANGLE_ITEM extends SIMPLE_OVERLAY_ITEM {
  /// `std::weak_ptr<EDIT_POINTS>`: the owner (the point editor) drops it by
  /// resetting this item, so a plain reference serves.
  private m_points: EDIT_POINTS | null;

  constructor(aPoints: EDIT_POINTS | null) {
    super();
    this.m_points = aPoints;
  }

  override ViewBBox(): BOX2I {
    if (this.m_points) return this.m_points.ViewBBox();

    return new BOX2I();
  }

  SetEditPoints(aPoints: EDIT_POINTS | null): void {
    this.m_points = aPoints;
  }

  override GetClass(): string {
    return 'ANGLE_ITEM';
  }

  protected override drawPreviewShape(aView: VIEW): void {
    const points = this.m_points;

    if (!points) return;

    const gal = aView.GetGAL()!;
    const settings = aView.GetPainter()!.GetSettings();
    const drawColor = settings.GetLayerColor(GAL_LAYER_ID.LAYER_AUX_ITEMS);

    const size = aView.ToWorld(EDIT_POINT.POINT_SIZE) / 2.0;
    const borderSize = aView.ToWorld(EDIT_POINT.BORDER_SIZE);
    const radius = size * 10.0;

    gal.SetStrokeColor(drawColor);
    gal.SetFillColor(drawColor);
    gal.SetIsFill(false);
    gal.SetLineWidth(borderSize * 2.0);
    // `VECTOR2I( radius / 2, radius / 2 )`: an int constructor, so truncated.
    gal.SetGlyphSize({ x: Math.trunc(radius / 2), y: Math.trunc(radius / 2) });

    const anglePoints: EDIT_POINT[] = [];

    for (let i = 0; i < points.PointsSize(); ++i) {
      const point = points.Point(i);

      if (point.IsActive() || point.IsHover()) {
        anglePoints.push(point);

        const prev = points.Previous(point, false);
        const next = points.Next(point, false);

        if (prev) anglePoints.push(prev);

        if (next) anglePoints.push(next);
      }
    }

    // `std::sort` + `std::unique` on the pointers: each handle once, in the
    // order the deque holds them.
    const order = (p: EDIT_POINT): number => {
      for (let i = 0; i < points.PointsSize(); ++i) if (points.Point(i) === p) return i;
      return -1;
    };
    const unique = [...new Set(anglePoints)].sort((a, b) => order(a) - order(b));

    // First pass: collect all angles and identify congruent ones
    const angles: AngleInfo[] = [];
    const angleCount = new Map<number, number>(); // Map angle (in tenths of degree) to count

    for (const pt of unique) {
      const prev = points.Previous(pt, false);
      const next = points.Next(pt, false);

      if (!(prev && next)) continue;

      const seg1 = new SEG(pt.GetPosition(), prev.GetPosition());
      const seg2 = new SEG(pt.GetPosition(), next.GetPosition());

      // Calculate the interior angle (0-180 degrees) instead of the smallest angle
      const c = pt.GetPosition();
      const v1 = { x: prev.GetPosition().x - c.x, y: prev.GetPosition().y - c.y };
      const v2 = { x: next.GetPosition().x - c.x, y: next.GetPosition().y - c.y };
      const angle = seg2.Angle(seg1);

      const start = EDA_ANGLE.fromVector(v1);
      const sweep = EDA_ANGLE.fromVector(v2).sub(start).Normalize180();
      const mid = start.add(sweep.divide(2.0));

      angles.push({
        point: pt,
        angle,
        center: { x: c.x, y: c.y },
        v1,
        v2,
        start,
        sweep,
        mid,
        isRightAngle: angle.AsTenthsOfADegree() === 900,
      });
      angleCount.set(
        angle.AsTenthsOfADegree(),
        (angleCount.get(angle.AsTenthsOfADegree()) ?? 0) + 1,
      );
    }

    // Second pass: draw the angles with congruence markings
    for (const angleInfo of angles) {
      const isCongruent = (angleCount.get(angleInfo.angle.AsTenthsOfADegree()) ?? 0) > 1;

      if (angleInfo.isRightAngle) {
        const u1 = resizeD(angleInfo.v1, radius);
        const u2 = resizeD(angleInfo.v2, radius);
        const p1 = addD(angleInfo.center, u1);
        const p2 = addD(angleInfo.center, u2);
        const corner = addD(addD(angleInfo.center, u1), u2);

        // Draw the primary right angle marker
        gal.DrawLine(p1, corner);
        gal.DrawLine(p2, corner);

        // Draw congruence marking for right angles
        if (isCongruent) {
          const innerRadius = radius * 0.6;
          const u1Inner = resizeD(angleInfo.v1, innerRadius);
          const u2Inner = resizeD(angleInfo.v2, innerRadius);
          const p1Inner = addD(angleInfo.center, u1Inner);
          const p2Inner = addD(angleInfo.center, u2Inner);
          const cornerInner = addD(addD(angleInfo.center, u1Inner), u2Inner);

          gal.DrawLine(p1Inner, cornerInner);
          gal.DrawLine(p2Inner, cornerInner);
        }
      } else {
        // Draw the primary arc
        gal.DrawArc(angleInfo.center, radius, angleInfo.start, angleInfo.sweep);

        // Draw congruence marking for non-right angles
        if (isCongruent) {
          const innerRadius = radius * 0.7;
          gal.DrawArc(angleInfo.center, innerRadius, angleInfo.start, angleInfo.sweep);
        }
      }

      const textDir = { x: angleInfo.mid.Cos(), y: angleInfo.mid.Sin() };
      const label = `${angleInfo.angle.AsDegrees().toFixed(1)}°`;

      // Calculate actual text dimensions to ensure proper clearance
      const font = FONT.GetFont();
      const textSize = font.StringBoundaryLimits(
        label,
        gal.GetGlyphSize(),
        0,
        false,
        false,
        METRICS.Default(),
      );

      // Calculate offset based on text direction - use width for horizontal, height for vertical
      const absX = Math.abs(textDir.x);
      const absY = Math.abs(textDir.y);
      const textClearance = (absX * textSize.x + absY * textSize.y) / 2.0;
      const textOffset = radius + borderSize + textClearance;
      // `VECTOR2I( textDir * textOffset )` truncates (vector2d.h:96-103).
      const textPos = {
        x: Math.trunc(angleInfo.center.x + Math.trunc(textDir.x * textOffset)),
        y: Math.trunc(angleInfo.center.y + Math.trunc(textDir.y * textOffset)),
      };
      gal.BitmapText(label, textPos, ANGLE_HORIZONTAL);
    }
  }
}
