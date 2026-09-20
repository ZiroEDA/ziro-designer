// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/ratsnest/ratsnest_view_item.h` + `.cpp`: `RATSNEST_VIEW_ITEM`,
 * the VIEW_ITEM that draws the connectivity's airwires on LAYER_RATSNEST.
 */

import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import {
  brightened,
  brightness,
  type Color4d,
  darkened,
  withAlpha,
} from '@ziroeda/common/src/color4d.js';
import { EDA_ITEM } from '@ziroeda/common/src/eda_item.js';
import {
  LAYER_PCB_BACKGROUND,
  LAYER_RATSNEST,
  type PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { PgmOrNull } from '@ziroeda/common/src/pgm_base.js';
import type { NETCLASS } from '@ziroeda/common/src/netclass.js';
import type { VIEW } from '@ziroeda/common/src/view/view.js';
import { HIGH_CONTRAST_MODE, NET_COLOR_MODE, RATSNEST_MODE } from '../board_project_settings.js';
import type { CONNECTIVITY_DATA } from '../connectivity/connectivity_data.js';
import type { PCB_RENDER_SETTINGS } from '../pcb_painter.js';
import type { PCBNEW_SETTINGS } from '../pcbnew_settings.js';

/** `COLOR4D::UNSPECIFIED`. */
const COLOR4D_UNSPECIFIED: Color4d = { r: 0, g: 0, b: 0, a: 0 };

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * Class that draws missing connections on a PCB.
 */
export class RATSNEST_VIEW_ITEM extends EDA_ITEM {
  protected m_data: CONNECTIVITY_DATA; ///< Object containing ratsnest data.

  constructor(aData: CONNECTIVITY_DATA) {
    super(KICAD_T.NOT_USED);
    this.m_data = aData;
  }

  /// @copydoc VIEW_ITEM::ViewBBox()
  override ViewBBox(): BOX2I {
    // Make it always visible
    const bbox = new BOX2I();
    bbox.SetMaximum();

    return bbox;
  }

  /// @copydoc VIEW_ITEM::ViewDraw()
  override ViewDraw(aLayer: number, aView: VIEW): void {
    // std::unique_lock<KISPINLOCK> lock( m_data->GetLock(), std::try_to_lock ): single-threaded here
    void aLayer;

    const CROSS_SIZE = 200000;

    const cfg = PgmOrNull()?.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew') ?? null;

    if (!cfg) return;

    const rs = aView.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;
    const gal = aView.GetGAL();
    gal.SetIsStroke(true);
    gal.SetIsFill(false);
    gal.SetLineWidth(cfg.m_Display.m_RatsnestThickness / gal.GetWorldScale());

    const highlightedNets = new Set(rs.GetHighlightNetCodes());
    const hiddenNets = rs.GetHiddenNets();

    const defaultColor = rs.GetColorForBoardItem(null, LAYER_RATSNEST);
    let color = defaultColor;
    const colorByNet = rs.GetNetColorMode() !== NET_COLOR_MODE.OFF;
    const dimStatic = this.m_data.GetLocalRatsnest().length > 0 || highlightedNets.size > 0;

    const netColors = rs.GetNetColorMap();

    const onlyVisibleLayers = cfg.m_Display.m_RatsnestMode === RATSNEST_MODE.VISIBLE;
    const visibleLayers = new LSET();

    // If we are in "other layers off" mode, the active layer is the only visible layer
    if (rs.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.HIDDEN) {
      if (rs.GetPrimaryHighContrastLayer() > UNDEFINED_LAYER)
        visibleLayers.set(rs.GetPrimaryHighContrastLayer());
    } else {
      LSET.AllCuMask().RunOnLayers((layer: PCB_LAYER_ID) => {
        if (aView.IsLayerVisible(layer)) visibleLayers.set(layer);
      });
    }

    const adjustColor = (color_base: Color4d, brightnessDelta: number, alpha: number): Color4d => {
      if (brightness(rs.GetColorForBoardItem(null, LAYER_PCB_BACKGROUND)) < 0.5)
        return withAlpha(brightened(color_base, brightnessDelta), Math.min(alpha, 1.0));

      return withAlpha(darkened(color_base, brightnessDelta), Math.min(alpha, 1.0));
    };

    const curved_ratsnest = cfg.m_Display.m_DisplayRatsnestLinesCurved;

    // Draw the "dynamic" ratsnest (i.e. for objects that may be currently being moved)
    for (const l of this.m_data.GetLocalRatsnest()) {
      if (hiddenNets.has(l.netCode)) continue;

      let nc: NETCLASS | null = null;
      const netSettings = this.m_data.GetNetSettings();

      if (this.m_data.HasNetNameForNetCode(l.netCode)) {
        const netName = this.m_data.GetNetNameForNetCode(l.netCode);

        if (netSettings?.HasEffectiveNetClass(netName))
          nc = netSettings.GetCachedEffectiveNetClass(netName);
      }

      if (colorByNet && netColors.has(l.netCode)) color = netColors.get(l.netCode)!;
      else if (colorByNet && nc?.HasPcbColor()) color = nc.GetPcbColor();
      else color = defaultColor;

      if (colorEquals(color, COLOR4D_UNSPECIFIED)) color = defaultColor;

      gal.SetStrokeColor(adjustColor(color, 0.5, color.a + 0.3));

      if (l.a.x === l.b.x && l.a.y === l.b.y) {
        gal.DrawLine(
          { x: l.a.x - CROSS_SIZE, y: l.a.y - CROSS_SIZE },
          { x: l.b.x + CROSS_SIZE, y: l.b.y + CROSS_SIZE },
        );
        gal.DrawLine(
          { x: l.a.x - CROSS_SIZE, y: l.a.y + CROSS_SIZE },
          { x: l.b.x + CROSS_SIZE, y: l.b.y - CROSS_SIZE },
        );
      } else {
        if (curved_ratsnest) {
          const dx = l.b.x - l.a.x;
          const dy = l.b.y - l.a.y;
          const center: VECTOR2I = {
            x: Math.trunc(l.a.x + 0.5 * dx - 0.1 * dy),
            y: Math.trunc(l.a.y + 0.5 * dy + 0.1 * dx),
          };
          gal.DrawCurve(l.a, center, center, l.b);
        } else {
          gal.DrawLine(l.a, l.b);
        }
      }
    }

    for (let i = 1 /* skip "No Net" at [0] */; i < this.m_data.GetNetCount(); ++i) {
      if (hiddenNets.has(i)) continue;

      const net = this.m_data.GetRatsnestForNet(i);

      if (!net || this.m_data.GetConnectivityAlgo().IsNetDirty(i)) continue;

      let nc: NETCLASS | null = null;
      const netSettings = this.m_data.GetNetSettings();

      if (this.m_data.HasNetNameForNetCode(i)) {
        const netName = this.m_data.GetNetNameForNetCode(i);

        if (netSettings?.HasEffectiveNetClass(netName))
          nc = netSettings.GetCachedEffectiveNetClass(netName);
      }

      if (colorByNet && netColors.has(i)) color = netColors.get(i)!;
      else if (colorByNet && nc?.HasPcbColor()) color = nc.GetPcbColor();
      else color = defaultColor;

      if (colorEquals(color, COLOR4D_UNSPECIFIED)) color = defaultColor;

      if (dimStatic) color = adjustColor(color, 0.0, color.a / 2);

      // Draw the "static" ratsnest
      if (highlightedNets.has(i)) gal.SetStrokeColor(adjustColor(color, 0.8, color.a + 0.4));
      else gal.SetStrokeColor(color); // using the default ratsnest color for not highlighted

      for (const edge of net.GetEdges()) {
        if (!edge.IsVisible()) continue;

        const sourceNode = edge.GetSourceNode();
        const targetNode = edge.GetTargetNode();

        if (!sourceNode || sourceNode.Dirty() || !targetNode || targetNode.Dirty()) continue;

        const source: VECTOR2I = sourceNode.Pos();
        const target: VECTOR2I = targetNode.Pos();

        const enable = !sourceNode.GetNoLine() && !targetNode.GetNoLine();
        let show: boolean;

        // If the global ratsnest is currently enabled, the local ratsnest should be easy to
        // turn off, so either element can disable it.
        // If the global ratsnest is disabled, the local ratsnest should be easy to turn on
        // so either element can enable it.
        if (cfg.m_Display.m_ShowGlobalRatsnest) {
          show =
            sourceNode.Parent().GetLocalRatsnestVisible() &&
            targetNode.Parent().GetLocalRatsnestVisible();
        } else {
          show =
            sourceNode.Parent().GetLocalRatsnestVisible() ||
            targetNode.Parent().GetLocalRatsnestVisible();
        }

        if (onlyVisibleLayers && show) {
          const sourceLayers = sourceNode.Parent().GetLayerSet();
          const targetLayers = targetNode.Parent().GetLayerSet();

          if (!sourceLayers.and(visibleLayers).any() || !targetLayers.and(visibleLayers).any()) {
            show = false;
          }
        }

        if (enable && show) {
          if (source.x === target.x && source.y === target.y) {
            gal.DrawLine(
              { x: source.x - CROSS_SIZE, y: source.y - CROSS_SIZE },
              { x: source.x + CROSS_SIZE, y: source.y + CROSS_SIZE },
            );
            gal.DrawLine(
              { x: source.x - CROSS_SIZE, y: source.y + CROSS_SIZE },
              { x: source.x + CROSS_SIZE, y: source.y - CROSS_SIZE },
            );
          } else {
            if (curved_ratsnest) {
              const dx = target.x - source.x;
              const dy = target.y - source.y;
              const center: VECTOR2I = {
                x: Math.trunc(source.x + 0.5 * dx - 0.1 * dy),
                y: Math.trunc(source.y + 0.5 * dy + 0.1 * dx),
              };
              gal.DrawCurve(source, center, center, target);
            } else {
              gal.DrawLine(source, target);
            }
          }
        }
      }
    }
  }

  /// @copydoc VIEW_ITEM::ViewGetLayers()
  override ViewGetLayers(): number[] {
    return [LAYER_RATSNEST];
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(_a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN, _b?: number | boolean): boolean {
    return false; // Not selectable
  }

  override GetClass(): string {
    return 'RATSNEST_VIEW_ITEM';
  }
}
