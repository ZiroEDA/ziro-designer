// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RULE_AREA_CREATE_HELPER` (eeschema/tools/rule_area_create_helper.{h,cpp}): the
 * POLYGON_GEOM_MANAGER client SCH_DRAWING_TOOLS::DrawRuleArea draws with. It shows the outline
 * in progress and commits the finished SCH_RULE_AREA.
 */
import { COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  LeaderMode,
  type POLYGON_GEOM_MANAGER,
  type POLYGON_GEOM_MANAGER_CLIENT,
} from '@ziroeda/common/preview_items/polygon_geom_manager.js';
import { POLYGON_ITEM } from '@ziroeda/common/preview_items/polygon_item.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_RENDER_SETTINGS } from '../sch_render_settings.js';
import { SCH_RULE_AREA } from '../sch_rule_area.js';

export class RULE_AREA_CREATE_HELPER implements POLYGON_GEOM_MANAGER_CLIENT {
  ///< The preview item to display
  private readonly m_previewItem = new POLYGON_ITEM();

  ///< The rule area in progress
  private m_rule_area: SCH_RULE_AREA | null = null;

  constructor(
    private readonly m_parentView: VIEW,
    private readonly m_frame: SCH_EDIT_FRAME,
    private readonly m_toolManager: TOOL_MANAGER,
  ) {
    this.m_parentView.Add(this.m_previewItem);
  }

  /** `~RULE_AREA_CREATE_HELPER()`: take the preview back out of the view. */
  Dispose(): void {
    // remove the preview from the view
    this.m_parentView.SetVisible(this.m_previewItem, false);
    this.m_parentView.Remove(this.m_previewItem);
  }

  private createNewRuleArea(): SCH_RULE_AREA {
    const ruleArea = new SCH_RULE_AREA();
    ruleArea.SetLineStyle(LINE_STYLE.DASH);
    ruleArea.SetLineColor(COLOR4D_UNSPECIFIED);

    return ruleArea;
  }

  private commitRuleArea(aRuleArea: SCH_RULE_AREA): void {
    const commit = new SCH_COMMIT(this.m_toolManager);

    commit.Add(aRuleArea, this.m_frame.GetScreen());
    commit.Push('Draw Rule Area');

    this.m_toolManager.RunAction(ACTIONS.selectItem, aRuleArea);

    this.m_parentView.ClearPreview();
  }

  OnFirstPoint(aMgr: POLYGON_GEOM_MANAGER): boolean {
    this.m_rule_area = this.createNewRuleArea();

    if (this.m_rule_area) {
      this.m_toolManager.RunAction(ACTIONS.selectionClear);

      const renderSettings = new SCH_RENDER_SETTINGS();
      const colorSettings = this.m_frame.GetColorSettings();
      renderSettings.LoadColors(colorSettings);

      const color = renderSettings.GetLayerColor(SCH_LAYER_ID.LAYER_RULE_AREAS);
      this.m_previewItem.SetLineColor(color);
      this.m_previewItem.SetLeaderColor(color);
      this.m_previewItem.SetFillColor({ ...color, a: 0.2 }); // color.WithAlpha( 0.2 )

      this.m_parentView.SetVisible(this.m_previewItem, true);

      aMgr.SetLeaderMode(LeaderMode.DEG45);
    }

    return this.m_rule_area !== null;
  }

  OnGeometryChange(aMgr: POLYGON_GEOM_MANAGER): void {
    // Handle a cancel-interactive
    if (this.m_rule_area && !aMgr.IsPolygonInProgress()) {
      this.m_rule_area = null;
      this.m_parentView.SetVisible(this.m_previewItem, false);
      return;
    }

    // send the points to the preview item
    this.m_previewItem.SetPoints(
      aMgr.GetLockedInPoints(),
      aMgr.GetLeaderLinePoints(),
      aMgr.GetLoopLinePoints(),
    );
    this.m_parentView.Update(this.m_previewItem, VIEW_UPDATE_FLAGS.GEOMETRY);
  }

  OnComplete(aMgr: POLYGON_GEOM_MANAGER): void {
    const finalPoints = aMgr.GetLockedInPoints();

    if (finalPoints.length < 3 || !this.m_rule_area) {
      // Just scrap the rule area in progress
      this.m_rule_area = null;
    } else {
      const ruleShape = new SHAPE_POLY_SET();

      ruleShape.NewOutline();
      const outline = ruleShape.Outline(0);

      for (const p of finalPoints) outline.Append(p);

      // In DEG45 mode, we may have intermediate points in the leader that should be included
      // as they are shown in the preview.  These typically maintain the 45 constraint
      if (aMgr.GetLeaderMode() === LeaderMode.DEG45 || aMgr.GetLeaderMode() === LeaderMode.DEG90) {
        const leaderPts = aMgr.GetLeaderLinePoints();

        for (let i = 1; i < leaderPts.length; i++) outline.Append(leaderPts[i]!);

        const loopPts = aMgr.GetLoopLinePoints();

        for (let i = 1; i < loopPts.length - 1; i++) outline.Append(loopPts[i]!);
      }

      outline.SetClosed(true);
      outline.Simplify(1); // Simplify( true ): an int tolerance, so 1

      // Remove the start point if it lies on the line between neighbouring points.
      // Simplify doesn't handle that currently.
      if (outline.PointCount() >= 3) {
        const seg = new SEG(outline.CLastPoint(), outline.CPoint(1));

        if (seg.LineDistance(outline.CPoint(0)) <= 1) outline.Remove(0);
      }

      this.m_rule_area.SetPolyShape(ruleShape);

      // hand the rule area over to the committer
      this.commitRuleArea(this.m_rule_area);
      this.m_rule_area = null;
    }

    this.m_parentView.SetVisible(this.m_previewItem, false);
  }
}
