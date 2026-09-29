// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZONE_PREVIEW_CANVAS` and `ZONE_PAINTER` -
 * `pcbnew/zone_manager/zone_preview_canvas.{h,cpp}`: a `PCB_DRAW_PANEL_GAL`
 * that shows one zone, on one layer, over a shaded rectangle standing for the
 * board edges, and nothing else.
 *
 * `KIPLATFORM::UI::IsDarkTheme()` is true here (dark is the app's identity), so
 * the two colour functions answer their dark branch.
 *
 * The right-click "Zoom to Fit" menu and the resize handler are the window's
 * (`wxEVT_RIGHT_UP`, `wxEVT_SIZE`); the canvas exposes what they call:
 * {@link ZONE_PREVIEW_CANVAS.OnResize}, {@link ZoomFitScreen}, {@link UnlockZoom}.
 */
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import type { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import {
  type DRAW_PANEL_GAL_PARENT,
  type DRAW_PANEL_GAL_WINDOW,
  GAL_TYPE,
} from '@ziroeda/common/draw_panel_gal.js';
import { PCB_LAYER_ID, PCB_LAYER_ID_COUNT } from '@ziroeda/common/layer_id.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import type { BOARD } from '../board.js';
import { PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';
import { PCB_PAINTER } from '../pcb_painter.js';
import type { ZONE } from '../zone.js';
import { BOARD_EDGES_BOUNDING_ITEM } from './board_edges_bounding_item.js';

export enum DRAW_ORDER {
  DRAW_ORDER_BOARD_BOUNDING,
  DRAW_ORDER_ZONE,
}

/** `wxColour( r, g, b, a )` (0-255) as a COLOR4D. */
const wxColour = (r: number, g: number, b: number, a = 255): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a: a / 255,
});

/** `getCanvasBackgroundColor`: the dark branch, `wxColour( 0, 0, 0, 30 )`. */
export const getCanvasBackgroundColor = (): Color4d => wxColour(0, 0, 0, 30);

/** `getBoundBoundingFillColor`: the dark branch, `wxColour( 238, 243, 243, 60 )`. */
export const getBoundBoundingFillColor = (): Color4d => wxColour(238, 243, 243, 60);

/** `ZONE_PAINTER`: `PCB_PAINTER` that fills the board-edges box itself. */
export class ZONE_PAINTER extends PCB_PAINTER {
  override Draw(aItem: VIEW_ITEM, aLayer: number): boolean {
    if (aItem instanceof BOARD_EDGES_BOUNDING_ITEM) {
      const gal = this.m_gal!;

      gal.Save();
      gal.SetFillColor(getBoundBoundingFillColor());
      gal.SetLineWidth(0);
      gal.SetIsFill(true);
      gal.SetIsStroke(false);
      const box = aItem.ViewBBox();
      gal.DrawRectangle(box.GetOrigin(), box.GetEnd());
      gal.Restore();
      return true;
    }

    return super.Draw(aItem, aLayer);
  }
}

export class ZONE_PREVIEW_CANVAS extends PCB_DRAW_PANEL_GAL {
  private m_pcb: BOARD;
  private m_pcb_bounding_box: BOARD_EDGES_BOUNDING_ITEM;
  private m_zone: ZONE | null;
  private m_zoomLocked = false;

  constructor(
    aPcb: BOARD,
    aZone: ZONE | null,
    aLayer: PCB_LAYER_ID,
    aParentWindow: DRAW_PANEL_GAL_PARENT | null,
    aWindow: DRAW_PANEL_GAL_WINDOW,
    aOptions: GAL_DISPLAY_OPTIONS,
    aGalType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL,
  ) {
    super(aParentWindow, aWindow, aOptions, aGalType);

    this.m_pcb = aPcb;
    this.m_pcb_bounding_box = new BOARD_EDGES_BOUNDING_ITEM(aPcb.GetBoardEdgesBoundingBox());
    this.m_zone = aZone;

    this.m_view!.UseDrawPriority(true);
    this.m_painter = new ZONE_PAINTER(this.m_gal, FRAME_T.FRAME_FOOTPRINT_PREVIEW);
    this.m_view!.SetPainter(this.m_painter);
    this.m_view!.Add(this.m_pcb_bounding_box, DRAW_ORDER.DRAW_ORDER_BOARD_BOUNDING);

    if (this.m_zone) this.m_view!.Add(this.m_zone, DRAW_ORDER.DRAW_ORDER_ZONE);

    this.UpdateColors();
    this.m_painter.GetSettings().SetBackgroundColor(getCanvasBackgroundColor());

    // Load layer & elements visibility settings
    for (let i = 0; i < PCB_LAYER_ID_COUNT; ++i)
      this.m_view!.SetLayerVisible(i, aLayer === i || PCB_LAYER_ID.Edge_Cuts === i);

    this.StartDrawing();
    this.RequestRefresh();
  }

  /** The `wxEVT_SIZE` handler: `if( !m_zoomLocked ) ZoomFitScreen()`. */
  OnResize(): void {
    if (!this.m_zoomLocked) this.ZoomFitScreen();
  }

  GetBoardBoundingBox(aBoardEdgesOnly: boolean): BOX2I {
    const area = aBoardEdgesOnly
      ? this.m_pcb.GetBoardEdgesBoundingBox()
      : this.m_pcb.GetBoundingBox();

    if (area.GetWidth() === 0 && area.GetHeight() === 0) {
      const pageSize = this.GetPageSizeIU();
      area.SetOrigin({ x: 0, y: 0 });
      area.SetEnd({ x: pageSize.x, y: pageSize.y });
    }

    return area;
  }

  GetDocumentExtents(aIncludeAllVisible = true): BOX2I {
    if (aIncludeAllVisible || !this.m_pcb.IsLayerVisible(PCB_LAYER_ID.Edge_Cuts))
      return this.GetBoardBoundingBox(false);
    else return this.GetBoardBoundingBox(true);
  }

  GetPageSizeIU(): { x: number; y: number } {
    const sizeIU = this.m_pcb.GetPageSettings().GetSizeIU(pcbIUScale.IU_PER_MILS);
    return { x: KiROUND(sizeIU.x), y: KiROUND(sizeIU.y) };
  }

  ZoomFitScreen(): void {
    let bBox = this.GetDocumentExtents(false);
    const defaultBox = this.GetDefaultViewBBox();
    const view = this.m_view!;

    view.SetScale(1.0);
    const clientSize = this.GetClientSize();
    const screenSize = view.ToWorld({ x: clientSize.x, y: clientSize.y }, false) as Vec2;

    if (bBox.GetWidth() === 0 || bBox.GetHeight() === 0) bBox = defaultBox ?? bBox;

    const vsize = bBox.GetSize();
    const scale =
      view.GetScale() /
      Math.max(Math.abs(vsize.x / screenSize.x), Math.abs(vsize.y / screenSize.y));

    if (!Number.isFinite(scale)) {
      view.SetCenter({ x: 0, y: 0 });
      this.Refresh();
      return;
    }

    view.SetScale(scale);
    view.SetCenter(bBox.Centre());
    this.RequestRefresh();
  }

  LockZoom(aScale: number, aCenter: Vec2): void {
    this.m_zoomLocked = true;
    this.m_view!.SetScale(aScale);
    this.m_view!.SetCenter(aCenter);
    this.RequestRefresh();
  }

  UnlockZoom(): void {
    this.m_zoomLocked = false;
  }
}
