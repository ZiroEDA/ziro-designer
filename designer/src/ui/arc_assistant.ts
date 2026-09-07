// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::ARC_ASSISTANT` — the guides and readout the arc tool draws
 * while you sweep it out. Counterpart: `common/preview_items/arc_assistant.cpp`.
 *
 * It is the half of pcbnew's arc tool that explains the other half. The tool
 * asks for a **centre**, then a **start**, then an **angle**, and none of that
 * is legible without the two radius lines and the guide circle:
 *
 * - the first radius line is always drawn, and **dims to 50%** once it has been
 *   locked in (`dimFirstLine = GetStep() > SET_START`);
 * - while the radius is being set, a full guide circle is drawn dimmed at that
 *   radius, and the readout is `r` and `θ`;
 * - once sweeping, the second radius line is drawn at full strength, a **third,
 *   dimmed** line runs out to the raw cursor — which is not on the arc, because
 *   the radius is already fixed — and the readout is `Δθ` and `θ`.
 *
 * Every line goes through `DRAW_CONTEXT::DrawLineWithAngleHighlight`, so a
 * radius that lands on a multiple of 45° turns green. That is the only signal
 * the tool gives that a radius is square-on.
 */

import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ArcStep } from '@ziroeda/common/src/preview_items/arc_geom_manager.js';
import type { ArcGeomManager } from '@ziroeda/common/src/preview_items/arc_geom_manager.js';
import { DrawContext, type DevicePoint } from './draw_context.js';
import {
  angleLabel,
  dimensionLabel,
  drawTextNextToCursor,
  type PreviewUnits,
} from './preview_utils.js';

export interface ArcAssistantOptions {
  mgr: ArcGeomManager;
  /** World → device pixels, the canvas's own transform. */
  toPx: (p: { x: number; y: number }) => DevicePoint;
  /**
   * Device pixels per world unit, for the guide circle's radius. Its magnitude
   * only: a flipped board view carries a negative X scale and a radius cannot
   * be negative.
   */
  worldScale: number;
  /** `rs->GetLayerColor( LAYER_AUX_ITEMS )`. */
  color: string;
  backgroundIsDark: boolean;
  iuPerMm: number;
  units: PreviewUnits;
  devicePixelRatio: number;
}

/**
 * `ARC_ASSISTANT::ViewDraw`'s cursor strings — the two lines, and which two
 * they are depends on the step.
 */
export function arcCursorStrings(
  mgr: ArcGeomManager,
  iuPerMm: number,
  units: PreviewUnits,
): string[] {
  if (mgr.getArcStep() === ArcStep.SET_START) {
    // "haven't started the angle selection phase yet"
    const initAngle = mgr.getStartAngle().Clone().Normalize720();
    return [
      dimensionLabel('r', mgr.getRadius(), iuPerMm, units),
      angleLabel('θ', initAngle.AsDegrees()),
    ];
  }

  const start = mgr.getStartAngle();
  const subtended = mgr.getSubtended();
  const normalizedEnd = start.add(subtended).Normalize180();

  return [angleLabel('Δθ', subtended.AsDegrees()), angleLabel('θ', normalizedEnd.AsDegrees())];
}

/** `ARC_ASSISTANT::ViewDraw`. */
export function drawArcAssistant(ctx: CanvasRenderingContext2D, o: ArcAssistantOptions): void {
  const mgr = o.mgr;

  // "not in a position to draw anything"
  if (mgr.isReset()) return;

  const dc = new DrawContext(ctx, {
    color: o.color,
    backgroundIsDark: o.backgroundIsDark,
    devicePixelRatio: o.devicePixelRatio,
  });

  const originPx = o.toPx(mgr.getOrigin());
  const step = mgr.getArcStep();

  // The first radius line, dimmed once it is no longer the one being set.
  dc.drawLineWithAngleHighlight(
    originPx,
    o.toPx(mgr.getStartRadiusEnd()),
    step > ArcStep.SET_START,
  );

  if (step === ArcStep.SET_START) {
    // "draw the radius guide circle", dimmed.
    dc.drawCircle(originPx, mgr.getRadius() * Math.abs(o.worldScale), true);
  } else {
    dc.drawLineWithAngleHighlight(originPx, o.toPx(mgr.getEndRadiusEnd()), false);
    // "draw dimmed extender line to cursor" — the cursor is off the arc,
    // because the radius was fixed by the previous click.
    dc.drawLineWithAngleHighlight(originPx, o.toPx(mgr.getLastPoint()), true);
  }

  const lastPx = o.toPx(mgr.getLastPoint());

  drawTextNextToCursor(ctx, {
    cursor: lastPx,
    // "place the text next to cursor, on opposite side from radius".
    quadrant: { x: originPx.x - lastPx.x, y: originPx.y - lastPx.y },
    strings: arcCursorStrings(mgr, o.iuPerMm, o.units),
    color: o.color,
    devicePixelRatio: o.devicePixelRatio,
  });
}

/**
 * The point half way along the arc, which is how a `PcbShape` stores one —
 * `(start mid end)`, the board file's own form — where the manager holds a
 * centre, a radius and two angles.
 *
 * `updateArcFromConstructionMgr` (`drawing_tool.cpp:2758-2777`) sets a
 * `PCB_SHAPE`'s centre/start/end instead, and **swaps start and end when the
 * subtended angle is positive**, because `PCB_SHAPE`'s arc always runs one way.
 * Deriving the mid from the signed sweep is that same rule stated for a
 * three-point arc: bisect the sweep the manager actually reports.
 */
export function arcMidPoint(mgr: ArcGeomManager): { x: number; y: number } {
  const origin = mgr.getOrigin();
  const r = Math.trunc(mgr.getRadius());
  // `GetStartAngle` and `GetSubtended` are both negated relative to screen
  // angles, so negate once more to get back to the atan2 convention the
  // canvas draws in.
  const startScreen = -mgr.getStartAngle().AsDegrees();
  const halfSweep = -mgr.getSubtended().AsDegrees() / 2;
  const a = new EDA_ANGLE(startScreen + halfSweep);
  return { x: origin.x + Math.round(r * a.Cos()), y: origin.y + Math.round(r * a.Sin()) };
}
