// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::BEZIER_ASSISTANT` (common/preview_items/bezier_assistant.cpp):
 * the bezier tool's guides as a VIEW item - the first control arm dashed from
 * the start, then the second as a double-length dashed line centred on the
 * end. Upstream reports no length yet ("Going to need a better way to get a
 * length here"), so no readout is drawn.
 */
import { EDA_ITEM } from '../eda_item.js';
import type { EdaIuScale, EdaUnits } from '../eda_units.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import type { VIEW } from '../view/view.js';
import { type BEZIER_GEOM_MANAGER, BEZIER_STEPS } from './bezier_geom_manager.js';
import { DRAW_CONTEXT } from './draw_context.js';
import { DrawTextNextToCursor } from './preview_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { sub } from '@ziroeda/kimath/src/math/vector2.js';

export class BEZIER_ASSISTANT extends EDA_ITEM {
  private m_units: EdaUnits;

  constructor(
    private readonly m_constructMan: BEZIER_GEOM_MANAGER,
    _aIuScale: EdaIuScale,
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
    return 'BEZIER_ASSISTANT';
  }

  SetUnits(aUnits: EdaUnits): void {
    this.m_units = aUnits;
  }

  /** The units a length readout would use; upstream has none to show yet. */
  GetUnits(): EdaUnits {
    return this.m_units;
  }

  override ViewDraw(aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL()!;

    // not in a position to draw anything
    if (this.m_constructMan.IsReset()) return;

    gal.ResetTextAttributes();

    const start = this.m_constructMan.GetStart();
    const step = this.m_constructMan.GetStep();

    const preview_ctx = new DRAW_CONTEXT(aView);

    const dashSize = KiROUND(aView.ToWorld(12));

    if (step >= BEZIER_STEPS.SET_CONTROL1) {
      // Draw the first control point control line
      preview_ctx.DrawLineDashed(
        start,
        this.m_constructMan.GetControlC1(),
        dashSize,
        Math.trunc(dashSize / 2),
        false,
      );
    }

    if (step >= BEZIER_STEPS.SET_CONTROL2) {
      const c2vec = sub(this.m_constructMan.GetControlC2(), this.m_constructMan.GetEnd());

      // Draw the second control point control line as a double length line
      // centered on the end point
      preview_ctx.DrawLineDashed(
        sub(this.m_constructMan.GetEnd(), c2vec),
        this.m_constructMan.GetControlC2(),
        dashSize,
        Math.trunc(dashSize / 2),
        false,
      );
    }

    const cursorStrings: string[] = [];

    // step >= SET_END: "Going to need a better way to get a length here" - no readout yet.

    if (cursorStrings.length > 0) {
      // place the text next to cursor, on opposite side from radius
      DrawTextNextToCursor(
        aView,
        this.m_constructMan.GetLastPoint(),
        sub(start, this.m_constructMan.GetLastPoint()),
        cursorStrings,
        aLayer === GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
      );
    }
  }
}
