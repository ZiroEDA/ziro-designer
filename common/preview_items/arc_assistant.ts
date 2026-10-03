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
import { ARC_STEPS } from './arc_geom_manager.js';
import type { ARC_GEOM_MANAGER } from './arc_geom_manager.js';
import { DRAW_CONTEXT, DrawContext, type DevicePoint } from './draw_context.js';
import { EDA_ITEM } from '../eda_item.js';
import type { EdaIuScale, EdaUnits } from '../eda_units.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import type { VIEW } from '../view/view.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { sub } from '@ziroeda/kimath/src/math/vector2.js';
import {
  angleLabel,
  DimensionLabel,
  DrawTextNextToCursor,
  dimensionLabel,
  drawTextNextToCursor,
  type PreviewUnits,
} from './preview_utils.js';

export interface ArcAssistantOptions {
  mgr: ARC_GEOM_MANAGER;
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
  mgr: ARC_GEOM_MANAGER,
  iuPerMm: number,
  units: PreviewUnits,
): string[] {
  if (mgr.GetStep() === ARC_STEPS.SET_START) {
    // "haven't started the angle selection phase yet"
    const initAngle = mgr.GetStartAngle().Clone().Normalize720();
    return [
      dimensionLabel('r', mgr.GetRadius(), iuPerMm, units),
      angleLabel('θ', initAngle.AsDegrees()),
    ];
  }

  const start = mgr.GetStartAngle();
  const subtended = mgr.GetSubtended();
  const normalizedEnd = start.add(subtended).Normalize180();

  return [angleLabel('Δθ', subtended.AsDegrees()), angleLabel('θ', normalizedEnd.AsDegrees())];
}

/** `ARC_ASSISTANT::ViewDraw`. */
export function drawArcAssistant(ctx: CanvasRenderingContext2D, o: ArcAssistantOptions): void {
  const mgr = o.mgr;

  // "not in a position to draw anything"
  if (mgr.IsReset()) return;

  const dc = new DrawContext(ctx, {
    color: o.color,
    backgroundIsDark: o.backgroundIsDark,
    devicePixelRatio: o.devicePixelRatio,
  });

  const originPx = o.toPx(mgr.GetOrigin());
  const step = mgr.GetStep();

  // The first radius line, dimmed once it is no longer the one being set.
  dc.drawLineWithAngleHighlight(
    originPx,
    o.toPx(mgr.GetStartRadiusEnd()),
    step > ARC_STEPS.SET_START,
  );

  if (step === ARC_STEPS.SET_START) {
    // "draw the radius guide circle", dimmed.
    dc.drawCircle(originPx, mgr.GetRadius() * Math.abs(o.worldScale), true);
  } else {
    dc.drawLineWithAngleHighlight(originPx, o.toPx(mgr.GetEndRadiusEnd()), false);
    // "draw dimmed extender line to cursor" — the cursor is off the arc,
    // because the radius was fixed by the previous click.
    dc.drawLineWithAngleHighlight(originPx, o.toPx(mgr.GetLastPoint()), true);
  }

  const lastPx = o.toPx(mgr.GetLastPoint());

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
export function arcMidPoint(mgr: ARC_GEOM_MANAGER): { x: number; y: number } {
  const origin = mgr.GetOrigin();
  const r = Math.trunc(mgr.GetRadius());
  // `GetStartAngle` and `GetSubtended` are both negated relative to screen
  // angles, so negate once more to get back to the atan2 convention the
  // canvas draws in.
  const startScreen = -mgr.GetStartAngle().AsDegrees();
  const halfSweep = -mgr.GetSubtended().AsDegrees() / 2;
  const a = new EDA_ANGLE(startScreen + halfSweep);
  return { x: origin.x + Math.round(r * a.Cos()), y: origin.y + Math.round(r * a.Sin()) };
}

/**
 * `KIGFX::PREVIEW::ARC_ASSISTANT` (common/preview_items/arc_assistant.cpp): the
 * arc tool's guides as a VIEW item on the overlay - the first radius (dimmed
 * once the start is set), the radius guide circle with r and theta while the
 * start is placed, then the end radius, the dimmed extender to the cursor, and
 * delta-theta and theta - drawn through the GAL.
 */
export class ARC_ASSISTANT extends EDA_ITEM {
  private m_units: EdaUnits;

  constructor(
    private readonly m_constructMan: ARC_GEOM_MANAGER,
    private readonly m_iuScale: EdaIuScale,
    aUnits: EdaUnits,
  ) {
    super(KICAD_T.NOT_USED);
    this.m_units = aUnits;
  }

  override ViewBBox(): BOX2I {
    const tmp = new BOX2I();

    // no bounding box when no graphic shown
    if (this.m_constructMan.IsReset()) return tmp;

    // this is an edit-time artifact; no reason to try and be smart with the bounding box
    // (besides, we can't tell the text extents without a view to know what the scale is)
    tmp.SetMaximum();
    return tmp;
  }

  override ViewGetLayers(): number[] {
    return [GAL_LAYER_ID.LAYER_SELECT_OVERLAY, GAL_LAYER_ID.LAYER_GP_OVERLAY];
  }

  override GetClass(): string {
    return 'ARC_ASSISTANT';
  }

  SetUnits(aUnits: EdaUnits): void {
    this.m_units = aUnits;
  }

  override ViewDraw(aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL()!;

    // not in a position to draw anything
    if (this.m_constructMan.IsReset()) return;

    gal.ResetTextAttributes();

    const origin = this.m_constructMan.GetOrigin();
    const preview_ctx = new DRAW_CONTEXT(aView);

    // draw first radius line
    const dimFirstLine = this.m_constructMan.GetStep() > ARC_STEPS.SET_START;

    preview_ctx.DrawLineWithAngleHighlight(
      origin,
      this.m_constructMan.GetStartRadiusEnd(),
      dimFirstLine,
    );

    const cursorStrings: string[] = [];

    if (this.m_constructMan.GetStep() === ARC_STEPS.SET_START) {
      // haven't started the angle selection phase yet
      const initAngle = this.m_constructMan.GetStartAngle().Normalize720();

      // draw the radius guide circle
      preview_ctx.DrawCircle(origin, this.m_constructMan.GetRadius(), true);

      cursorStrings.push(
        DimensionLabel('r', this.m_constructMan.GetRadius(), this.m_iuScale, this.m_units),
      );
      cursorStrings.push(DimensionLabel('θ', initAngle.AsDegrees(), this.m_iuScale, 'degrees'));
    } else {
      preview_ctx.DrawLineWithAngleHighlight(origin, this.m_constructMan.GetEndRadiusEnd(), false);

      const start = this.m_constructMan.GetStartAngle();
      const subtended = this.m_constructMan.GetSubtended();
      const normalizedEnd = start.add(subtended).Normalize180();

      // draw dimmed extender line to cursor
      preview_ctx.DrawLineWithAngleHighlight(origin, this.m_constructMan.GetLastPoint(), true);

      cursorStrings.push(DimensionLabel('Δθ', subtended.AsDegrees(), this.m_iuScale, 'degrees'));
      cursorStrings.push(DimensionLabel('θ', normalizedEnd.AsDegrees(), this.m_iuScale, 'degrees'));
    }

    // place the text next to cursor, on opposite side from radius
    DrawTextNextToCursor(
      aView,
      this.m_constructMan.GetLastPoint(),
      sub(origin, this.m_constructMan.GetLastPoint()),
      cursorStrings,
      aLayer === GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
    );
  }
}
