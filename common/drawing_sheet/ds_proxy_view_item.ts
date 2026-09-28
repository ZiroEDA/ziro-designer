// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/drawing_sheet/ds_painter.h` + `common/drawing_sheet/ds_painter.cpp`
 * and `ds_proxy_view_item.h` + `.cpp`: `KIGFX::DS_RENDER_SETTINGS`,
 * `KIGFX::DS_PAINTER` (the GAL drawing of a sheet's items) and
 * `DS_PROXY_VIEW_ITEM`, the VIEW_ITEM a board or schematic adds so the
 * drawing sheet paints on LAYER_DRAWINGSHEET.
 *
 * The item list a `DS_DRAW_ITEM_LIST` would build comes from the resolved
 * layout (`layoutDrawingSheet`): each `DsDrawItem` becomes the
 * `DS_DRAW_ITEM_*` (`ds_draw_item.ts`) the painter draws, with no
 * `DS_DATA_ITEM` peer. Building from `DS_DATA_MODEL::GetTheInstance()` as
 * KiCad does is the next step for the board and schematic canvases. The layout works in schematic internal
 * units (`SCH_IU_PER_MM`); `m_iuScale` converts to the host's.
 */

import { BOX2I, BOX2ISafe } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 as VECTOR2D, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { brightened, brightness, type Color4d, LEGACY_COLORS } from '../gal/color4d.js';
import { EDA_ITEM } from '../eda_item.js';
import { type EdaIuScale, SCH_IU_PER_MM } from '../eda_units.js';
import { FONT } from '../font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../font/text_attributes.js';
import type { GAL } from '../gal/graphics_abstraction_layer.js';
import { PAINTER } from '../gal/painter.js';
import {
  GAL_LAYER_ID,
  LAYER_BRIGHTENED,
  LAYER_DRAWINGSHEET,
  LAYER_PAGE_LIMITS,
  LAYER_SCHEMATIC_BACKGROUND,
  LAYER_SCHEMATIC_DRAWINGSHEET,
  LAYER_SCHEMATIC_GRID,
  LAYER_SELECT_OVERLAY,
  SCH_LAYER_ID,
} from '../layer_id.js';
import type { PAGE_INFO } from '../page_info.js';
import { RENDER_SETTINGS } from '../render_settings.js';
import type { COLOR_SETTINGS } from '../settings/color_settings.js';
import type { TITLE_BLOCK } from '../title_block.js';
import type { VIEW } from '../view/view.js';
import type { VIEW_ITEM } from '../view/view_item.js';
import { defaultDrawingSheet } from './default-sheet.js';
import type { DS_DATA_ITEM_BITMAP } from './ds_data_item.js';
import {
  type DS_DRAW_ITEM_BASE,
  DS_DRAW_ITEM_BITMAP,
  type DS_DRAW_ITEM_PAGE,
  DS_DRAW_ITEM_LINE,
  DS_DRAW_ITEM_POLYPOLYGONS,
  DS_DRAW_ITEM_RECT,
  DS_DRAW_ITEM_TEXT,
} from './ds_draw_item.js';
import { type DsTextItem, layoutDrawingSheet } from './layout.js';
import type { WksSheet } from './types.js';

/** `COLOR4D::UNSPECIFIED`. */
const COLOR4D_UNSPECIFIED: Color4d = { r: 0, g: 0, b: 0, a: 0 };

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * Store page-layout-specific render settings.
 */
export class DS_RENDER_SETTINGS extends RENDER_SETTINGS {
  private m_normalColor: Color4d;
  private m_selectedColor: Color4d;
  private m_brightenedColor: Color4d;
  private m_gridColor: Color4d = { r: 0, g: 0, b: 0, a: 1 };
  private m_cursorColor: Color4d = { r: 0, g: 0, b: 0, a: 1 };
  /** `friend class DS_PAINTER` reads it. */
  m_pageBorderColor: Color4d;

  constructor() {
    super();
    this.m_backgroundColor = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    this.m_normalColor = LEGACY_COLORS.RED;
    this.m_selectedColor = brightened(this.m_normalColor, 0.5);
    this.m_brightenedColor = { r: 0.0, g: 1.0, b: 0.0, a: 0.9 };
    this.m_pageBorderColor = { r: 0.4, g: 0.4, b: 0.4, a: 1.0 };

    this.update();
  }

  override LoadColors(aSettings: COLOR_SETTINGS | null): void {
    if (!aSettings) return;

    for (
      let layer = SCH_LAYER_ID.SCH_LAYER_ID_START;
      layer < SCH_LAYER_ID.SCH_LAYER_ID_END;
      layer++
    )
      this.m_layerColors.set(layer, aSettings.GetColor(layer));

    for (
      let layer = GAL_LAYER_ID.GAL_LAYER_ID_START;
      layer < GAL_LAYER_ID.GAL_LAYER_ID_END;
      layer++
    )
      this.m_layerColors.set(layer, aSettings.GetColor(layer));

    this.m_backgroundColor = aSettings.GetColor(LAYER_SCHEMATIC_BACKGROUND);
    this.m_pageBorderColor = aSettings.GetColor(LAYER_SCHEMATIC_GRID);
    this.m_normalColor = aSettings.GetColor(LAYER_SCHEMATIC_DRAWINGSHEET);
  }

  /// @copydoc RENDER_SETTINGS::GetColor()
  override GetColor(aItem: VIEW_ITEM | null, _aLayer: number): Color4d {
    const item = aItem instanceof EDA_ITEM ? aItem : null;

    if (item) {
      // Selection disambiguation
      if (item.IsBrightened()) return this.m_brightenedColor;

      if (item.IsSelected()) return this.m_selectedColor;

      if (item.Type() === KICAD_T.WSG_TEXT_T) {
        const color = (item as DS_DRAW_ITEM_TEXT).GetTextColor();

        if (!colorEquals(color, COLOR4D_UNSPECIFIED)) return color;
      }
    }

    return this.m_normalColor;
  }

  override IsBackgroundDark(): boolean {
    const luma = brightness(this.m_backgroundColor);

    return luma < 0.5;
  }

  override GetBackgroundColor(): Color4d {
    return this.m_backgroundColor;
  }

  override SetBackgroundColor(aColor: Color4d): void {
    this.m_backgroundColor = aColor;
  }

  SetNormalColor(aColor: Color4d): void {
    this.m_normalColor = aColor;
  }
  SetSelectedColor(aColor: Color4d): void {
    this.m_selectedColor = aColor;
  }
  SetBrightenedColor(aColor: Color4d): void {
    this.m_brightenedColor = aColor;
  }
  SetPageBorderColor(aColor: Color4d): void {
    this.m_pageBorderColor = aColor;
  }

  override GetGridColor(): Color4d {
    this.m_gridColor = this.IsBackgroundDark() ? LEGACY_COLORS.DARKGRAY : LEGACY_COLORS.LIGHTGRAY;
    return this.m_gridColor;
  }

  override GetCursorColor(): Color4d {
    this.m_cursorColor = this.IsBackgroundDark() ? LEGACY_COLORS.WHITE : LEGACY_COLORS.BLACK;
    return this.m_cursorColor;
  }
}

/**
 * Methods for drawing drawing sheet items.
 */
export class DS_PAINTER extends PAINTER {
  private m_renderSettings = new DS_RENDER_SETTINGS();

  constructor(aGal: GAL | null) {
    super(aGal);
  }

  /// @copydoc PAINTER::Draw()
  override Draw(aItem: VIEW_ITEM, aLayer: number): boolean {
    const item = aItem instanceof EDA_ITEM ? aItem : null;

    if (!item) return false;

    switch (item.Type()) {
      case KICAD_T.WSG_LINE_T:
        this.drawLine(item as DS_DRAW_ITEM_LINE, aLayer);
        break;
      case KICAD_T.WSG_POLY_T:
        this.drawPolyPolygons(item as DS_DRAW_ITEM_POLYPOLYGONS, aLayer);
        break;
      case KICAD_T.WSG_RECT_T:
        this.drawRect(item as DS_DRAW_ITEM_RECT, aLayer);
        break;
      case KICAD_T.WSG_TEXT_T:
        this.drawText(item as DS_DRAW_ITEM_TEXT, aLayer);
        break;
      case KICAD_T.WSG_BITMAP_T:
        this.drawBitmap(item as DS_DRAW_ITEM_BITMAP, aLayer);
        break;
      case KICAD_T.WSG_PAGE_T:
        this.drawPage(item as DS_DRAW_ITEM_PAGE, aLayer);
        break;
      default:
        return false;
    }

    return true;
  }

  /// @copydoc PAINTER::GetSettings()
  override GetSettings(): DS_RENDER_SETTINGS {
    return this.m_renderSettings;
  }

  private drawLine(aItem: DS_DRAW_ITEM_LINE, aLayer: number): void {
    const gal = this.m_gal!;
    gal.SetIsStroke(true);
    gal.SetIsFill(false);
    gal.SetStrokeColor(this.m_renderSettings.GetColor(aItem, aLayer));
    gal.SetLineWidth(Math.max(aItem.GetPenWidth(), this.m_renderSettings.GetDefaultPenWidth()));
    gal.DrawLine(aItem.GetStart(), aItem.GetEnd());
  }

  private drawRect(aItem: DS_DRAW_ITEM_RECT, aLayer: number): void {
    const gal = this.m_gal!;
    gal.SetIsStroke(true);
    gal.SetIsFill(false);
    gal.SetStrokeColor(this.m_renderSettings.GetColor(aItem, aLayer));
    gal.SetLineWidth(Math.max(aItem.GetPenWidth(), this.m_renderSettings.GetDefaultPenWidth()));
    gal.DrawRectangle(aItem.GetStart(), aItem.GetEnd());
  }

  private drawPolyPolygons(aItem: DS_DRAW_ITEM_POLYPOLYGONS, aLayer: number): void {
    const gal = this.m_gal!;
    gal.SetFillColor(this.m_renderSettings.GetColor(aItem, aLayer));
    gal.SetIsFill(true);
    gal.SetIsStroke(false);

    const polygons = aItem.GetPolygons();

    for (let idx = 0; idx < polygons.OutlineCount(); ++idx) gal.DrawPolygon(polygons.Outline(idx));
  }

  private drawText(aItem: DS_DRAW_ITEM_TEXT, aLayer: number): void {
    const gal = this.m_gal!;
    let font = aItem.GetFont();

    if (!font) {
      font = FONT.GetFont(
        this.m_renderSettings.GetDefaultFont(),
        aItem.IsBold(),
        aItem.IsItalic(),
        null,
        true,
      );
    }

    const color = this.m_renderSettings.GetColor(aItem, aLayer);

    gal.SetStrokeColor(color);
    gal.SetFillColor(color);

    const attrs = aItem.GetAttributes().clone();
    attrs.m_StrokeWidth = Math.max(
      aItem.GetEffectiveTextPenWidth(),
      this.m_renderSettings.GetDefaultPenWidth(),
    );

    font.DrawAt(gal, aItem.GetShownText(true), aItem.GetTextPos(), attrs, aItem.GetFontMetrics());
  }

  private drawBitmap(aItem: DS_DRAW_ITEM_BITMAP, _aLayer: number): void {
    const gal = this.m_gal!;
    gal.Save();

    const bitmap = aItem.GetPeer() as DS_DATA_ITEM_BITMAP | null;

    const position: VECTOR2D = aItem.GetPosition();
    gal.Translate(position);

    // If we've failed to read the bitmap data, don't try to draw it. An item
    // the layout built (no peer) carries no decoded image. Upstream returns
    // here without the Restore; ours keeps the GAL's stack balanced.
    if (!bitmap?.m_ImageBitmap?.GetImageData()) {
      gal.Restore();
      return;
    }

    // When the image scale factor is not 1.0, we need to modify the actual scale
    // as the image scale factor is similar to a local zoom
    const img_scale = bitmap.m_ImageBitmap.GetScale();

    if (img_scale !== 1.0) gal.Scale({ x: img_scale, y: img_scale });

    gal.DrawBitmap(bitmap.m_ImageBitmap);

    gal.Restore();
  }

  private drawPage(aItem: DS_DRAW_ITEM_PAGE, _aLayer: number): void {
    const gal = this.m_gal!;
    const origin: VECTOR2D = { x: 0.0, y: 0.0 };
    const end: VECTOR2D = { x: aItem.GetPageSize().x, y: aItem.GetPageSize().y };

    gal.SetIsStroke(true);

    // Use a gray color for the border color
    gal.SetStrokeColor(this.m_renderSettings.m_pageBorderColor);
    gal.SetIsFill(false);
    gal.SetLineWidth(this.m_renderSettings.GetDefaultPenWidth());

    gal.DrawRectangle(origin, end);

    // Draw the corner marker
    const marker_size = aItem.GetMarkerSize();

    gal.SetStrokeColor(this.m_renderSettings.m_pageBorderColor);
    const pos: VECTOR2D = { x: aItem.GetMarkerPos().x, y: aItem.GetMarkerPos().y };

    // Draw a circle and a X
    gal.DrawCircle(pos, marker_size);
    gal.DrawLine(
      { x: pos.x - marker_size, y: pos.y - marker_size },
      { x: pos.x + marker_size, y: pos.y + marker_size },
    );
    gal.DrawLine(
      { x: pos.x + marker_size, y: pos.y - marker_size },
      { x: pos.x - marker_size, y: pos.y + marker_size },
    );
  }

  DrawBorder(aPageInfo: PAGE_INFO, aScaleFactor: number): void {
    const gal = this.m_gal!;
    const origin: VECTOR2D = { x: 0.0, y: 0.0 };
    const end: VECTOR2D = {
      x: aPageInfo.GetWidthMils() * aScaleFactor,
      y: aPageInfo.GetHeightMils() * aScaleFactor,
    };

    gal.SetIsStroke(true);
    // Use a gray color for the border color
    gal.SetStrokeColor(this.m_renderSettings.m_pageBorderColor);
    gal.SetIsFill(false);
    gal.SetLineWidth(this.m_renderSettings.GetDefaultPenWidth());
    gal.DrawRectangle(origin, end);
  }
}

/**
 * `DS_DRAW_ITEM_LIST`, as far as the proxy item fills and reads it: the
 * resolve context the layout takes, and the built items.
 */
export interface DS_DRAW_LIST_CONTEXT {
  fileName: string;
  sheetName: string;
  sheetPath: string;
  sheetLayer: string;
  pageNumber: string;
  sheetCount: number;
  isFirstPage: boolean;
  variantName: string;
  variantDesc: string;
}

/** `PROJECT`, as far as the drawing sheet resolves text through it. */
export interface DS_PROJECT_LIKE {
  /** The project's drawing sheet, when it has one; KiCad's default when not. */
  GetDrawingSheet?(): WksSheet | null;
}

/**
 * The drawing sheet as a VIEW_ITEM.
 */
export class DS_PROXY_VIEW_ITEM extends EDA_ITEM {
  protected m_iuScale: EdaIuScale;
  protected m_fileName = '';
  protected m_sheetName = '';
  protected m_sheetPath = '';
  protected m_titleBlock: TITLE_BLOCK | null;
  protected m_pageInfo: PAGE_INFO | null;
  protected m_pageNumber: string;
  protected m_sheetCount: number;
  protected m_isFirstPage: boolean;
  protected m_variantName = '';
  protected m_variantDesc = '';
  protected m_project: DS_PROJECT_LIKE | null;
  protected m_properties: Map<string, string> | null;
  protected m_colorLayer: number;

  /// Layer that is used for page border color
  protected m_pageBorderColorLayer: number;

  constructor(
    aIuScale: EdaIuScale,
    aPageInfo: PAGE_INFO | null,
    aProject: DS_PROJECT_LIKE | null,
    aTitleBlock: TITLE_BLOCK | null,
    aProperties: Map<string, string> | null,
  ) {
    super(KICAD_T.NOT_USED); // this item is never added to a BOARD so it needs no type
    this.m_iuScale = aIuScale;
    this.m_titleBlock = aTitleBlock;
    this.m_pageInfo = aPageInfo;
    this.m_pageNumber = '1';
    this.m_sheetCount = 1;
    this.m_isFirstPage = false;
    this.m_project = aProject;
    this.m_properties = aProperties;
    this.m_colorLayer = LAYER_DRAWINGSHEET;
    this.m_pageBorderColorLayer = LAYER_PAGE_LIMITS;
  }

  /**
   * Set the file name displayed in the title block.
   */
  SetFileName(aFileName: string): void {
    this.m_fileName = aFileName;
  }

  /**
   * Set the sheet name displayed in the title block.
   */
  SetSheetName(aSheetName: string): void {
    this.m_sheetName = aSheetName;
  }

  /**
   * Set the sheet path displayed in the title block.
   */
  SetSheetPath(aSheetPath: string): void {
    this.m_sheetPath = aSheetPath;
  }

  /**
   * Change the page number displayed in the title block.
   */
  SetPageNumber(aPageNumber: string): void {
    this.m_pageNumber = aPageNumber;
  }

  /**
   * Change the sheet-count number displayed in the title block.
   */
  SetSheetCount(aSheetCount: number): void {
    this.m_sheetCount = aSheetCount;
  }

  SetIsFirstPage(aIsFirstPage: boolean): void {
    this.m_isFirstPage = aIsFirstPage;
  }

  SetVariantName(aVariant: string): void {
    this.m_variantName = aVariant;
  }

  SetVariantDesc(aVariantDesc: string): void {
    this.m_variantDesc = aVariantDesc;
  }

  /**
   * Can be used to override which layer ID is used for drawing sheet item colors
   * @param aLayerId is the color to use (will default to LAYER_DRAWINGSHEET if never set)
   */
  SetColorLayer(aLayerId: number): void {
    this.m_colorLayer = aLayerId;
  }

  /**
   * Override the layer used to pick the color of the page border (normally LAYER_GRID)
   * @param aLayerId is the layer to use
   */
  SetPageBorderColorLayer(aLayerId: number): void {
    this.m_pageBorderColorLayer = aLayerId;
  }

  GetPageInfo(): PAGE_INFO {
    return this.m_pageInfo!;
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.m_titleBlock!;
  }

  /// @copydoc VIEW_ITEM::ViewBBox()
  override ViewBBox(): BOX2I {
    const bbox = new BOX2I();

    if (this.m_pageInfo) {
      bbox.SetOrigin({ x: 0, y: 0 });
      bbox.SetEnd({
        x: this.m_iuScale.milsToIU(this.m_pageInfo.GetWidthMils()),
        y: this.m_iuScale.milsToIU(this.m_pageInfo.GetHeightMils()),
      });
    } else {
      bbox.SetMaximum();
    }

    return bbox;
  }

  /**
   * `buildDrawList`: `DS_DRAW_ITEM_LIST::BuildDrawItemsList( pageInfo, titleBlock )`
   * over the resolved layout, converted from the layout's schematic units to
   * the host's.
   */
  protected buildDrawList(
    aView: VIEW,
    aProperties: Map<string, string> | null,
  ): DS_DRAW_ITEM_BASE[] {
    const settings = aView.GetPainter().GetSettings();
    const pageInfo = this.m_pageInfo!;
    const titleBlock = this.m_titleBlock;

    const defaultPenSize = Math.trunc(settings.GetDrawingSheetLineWidth());

    const comments: string[] = [];

    if (titleBlock) for (let i = 0; i < 9; ++i) comments.push(titleBlock.GetComment(i));

    const sheet = this.m_project?.GetDrawingSheet?.() ?? defaultDrawingSheet();

    const items = layoutDrawingSheet(
      sheet,
      {
        widthMM: pageInfo.GetWidthMils() * 0.0254,
        heightMM: pageInfo.GetHeightMils() * 0.0254,
      },
      {
        pageNumber: Number.parseInt(this.m_pageNumber, 10) || 1,
        pageName: this.m_pageNumber,
        sheetCount: this.m_sheetCount,
        title: titleBlock?.GetTitle() ?? '',
        rev: titleBlock?.GetRevision() ?? '',
        date: titleBlock?.GetDate() ?? '',
        company: titleBlock?.GetCompany() ?? '',
        comments,
        paper: pageInfo.GetTypeAsString(),
        layer: settings.GetLayerName(),
        fileName: this.m_fileName,
        sheetName: this.m_sheetName,
        sheetPath: this.m_sheetPath,
      },
    );

    void aProperties;

    // The layout is in schematic internal units; scale to the host's.
    const k = this.m_iuScale.IU_PER_MM / SCH_IU_PER_MM;
    const toIU = (p: { x: number; y: number }): VECTOR2I => ({
      x: Math.trunc(p.x * k),
      y: Math.trunc(p.y * k),
    });
    const penOf = (aWidth: number): number =>
      aWidth > 0 ? Math.trunc(aWidth * k) : defaultPenSize;

    const out: DS_DRAW_ITEM_BASE[] = [];

    for (const item of items) {
      switch (item.kind) {
        case 'line':
          out.push(new DS_DRAW_ITEM_LINE(null, 0, toIU(item.a), toIU(item.b), penOf(item.width)));
          break;
        case 'rect':
          out.push(new DS_DRAW_ITEM_RECT(null, 0, toIU(item.a), toIU(item.b), penOf(item.width)));
          break;
        case 'poly': {
          const pts = item.pts.map(toIU);
          const poly = new DS_DRAW_ITEM_POLYPOLYGONS(null, 0, pts[0] ?? { x: 0, y: 0 }, 0);
          poly.GetPolygons().NewOutline();

          for (const pt of pts) poly.GetPolygons().Append(pt);

          out.push(poly);
          break;
        }
        case 'text':
          out.push(this.makeTextItem(item, toIU, k));
          break;
        case 'bitmap':
          // The layout's image has no BITMAP_BASE peer; DS_PAINTER draws no
          // pixels for it (drawBitmap below).
          out.push(new DS_DRAW_ITEM_BITMAP(null, 0, toIU(item.at)));
          break;
      }
    }

    return out;
  }

  /**
   * The text items of `DS_DRAW_ITEM_LIST drawItems( iuScale, FOR_ERC_DRC )` built
   * the way ERC and DRC build it: page "1" of 1, `dummyFilename`, `dummySheet`,
   * `dummyLayer`, and `${DRC_ERROR ...}` / `${DRC_WARNING ...}` left in the text.
   * There is no VIEW here, so the pen widths fall back to the layout's own.
   */
  BuildTextItemsForErcDrc(): DS_DRAW_ITEM_TEXT[] {
    const pageInfo = this.m_pageInfo!;
    const titleBlock = this.m_titleBlock;

    const comments: string[] = [];

    if (titleBlock) for (let i = 0; i < 9; ++i) comments.push(titleBlock.GetComment(i));

    const sheet = this.m_project?.GetDrawingSheet?.() ?? defaultDrawingSheet();

    const items = layoutDrawingSheet(
      sheet,
      {
        widthMM: pageInfo.GetWidthMils() * 0.0254,
        heightMM: pageInfo.GetHeightMils() * 0.0254,
      },
      {
        pageNumber: 1,
        pageName: '1',
        sheetCount: 1,
        title: titleBlock?.GetTitle() ?? '',
        rev: titleBlock?.GetRevision() ?? '',
        date: titleBlock?.GetDate() ?? '',
        company: titleBlock?.GetCompany() ?? '',
        comments,
        paper: pageInfo.GetTypeAsString(),
        layer: 'dummyLayer',
        fileName: 'dummyFilename',
        sheetName: 'dummySheet',
        sheetPath: this.m_sheetPath,
      },
    );

    // The layout is in schematic internal units; scale to the host's.
    const k = this.m_iuScale.IU_PER_MM / SCH_IU_PER_MM;
    const toIU = (p: { x: number; y: number }): VECTOR2I => ({
      x: Math.trunc(p.x * k),
      y: Math.trunc(p.y * k),
    });

    const out: DS_DRAW_ITEM_TEXT[] = [];

    for (const item of items) {
      if (item.kind === 'text') out.push(this.makeTextItem(item, toIU, k));
    }

    return out;
  }

  /** `DS_DATA_ITEM_TEXT::SyncDrawItems`' text attributes, from the resolved item. */
  private makeTextItem(
    aItem: DsTextItem,
    aToIU: (p: { x: number; y: number }) => VECTOR2I,
    aScale: number,
  ): DS_DRAW_ITEM_TEXT {
    const font = aItem.face ? FONT.GetFont(aItem.face, aItem.bold, aItem.italic, null, true) : null;

    const color: Color4d = aItem.color
      ? { r: aItem.color.r / 255, g: aItem.color.g / 255, b: aItem.color.b / 255, a: aItem.color.a }
      : COLOR4D_UNSPECIFIED;

    const text = new DS_DRAW_ITEM_TEXT(
      this.m_iuScale,
      null,
      0,
      aItem.text,
      aToIU(aItem.at),
      { x: Math.trunc(aItem.w * aScale), y: Math.trunc(aItem.h * aScale) },
      Math.trunc(aItem.thickness * aScale),
      font,
      aItem.italic,
      aItem.bold,
      color,
    );

    text.SetHorizJustify(
      aItem.hjustify === 'left'
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
        : aItem.hjustify === 'right'
          ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
          : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER,
    );
    text.SetVertJustify(
      aItem.vjustify === 'top'
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
        : aItem.vjustify === 'bottom'
          ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
          : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER,
    );
    text.SetTextAngle(new EDA_ANGLE(aItem.rotate));
    text.SetMultilineAllowed(true);

    return text;
  }

  /// @copydoc VIEW_ITEM::ViewDraw()
  override ViewDraw(_aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL();
    const settings = aView.GetPainter().GetSettings();
    const drawList = this.buildDrawList(aView, this.m_properties);

    let viewport = BOX2ISafe(aView.GetViewport());

    // Draw the title block normally even if the view is flipped
    const flipped = gal.IsFlippedX();

    if (flipped) {
      const pageWidth = this.m_iuScale.milsToIU(this.m_pageInfo!.GetWidthMils());
      gal.Save();
      gal.Translate({ x: pageWidth, y: 0 });
      gal.Scale({ x: -1.0, y: 1.0 });

      const right = pageWidth - viewport.GetLeft();
      const left = right - viewport.GetWidth();
      const v = new BOX2I(viewport.GetOrigin(), viewport.GetSize());
      v.SetOrigin({ x: left, y: viewport.GetTop() });
      viewport = v;
    }

    const ws_painter = new DS_PAINTER(gal);
    const ws_settings = ws_painter.GetSettings();

    ws_settings.SetNormalColor(settings.GetLayerColor(this.m_colorLayer));
    ws_settings.SetSelectedColor(settings.GetLayerColor(LAYER_SELECT_OVERLAY));
    ws_settings.SetBrightenedColor(settings.GetLayerColor(LAYER_BRIGHTENED));
    ws_settings.SetPageBorderColor(settings.GetLayerColor(this.m_pageBorderColorLayer));
    ws_settings.SetDefaultFont(settings.GetDefaultFont());

    // Draw all the components that make the drawing sheet
    for (const item of drawList) {
      if (viewport.Intersects(item.GetApproxBBox())) ws_painter.Draw(item, LAYER_DRAWINGSHEET);
    }

    // Draw gray line that outlines the sheet size
    if (settings.GetShowPageLimits())
      ws_painter.DrawBorder(this.m_pageInfo!, this.m_iuScale.IU_PER_MILS);

    if (flipped) gal.Restore();
  }

  /// @copydoc VIEW_ITEM::ViewGetLayers()
  override ViewGetLayers(): number[] {
    return [LAYER_DRAWINGSHEET];
  }

  override GetClass(): string {
    return 'DS_PROXY_VIEW_ITEM';
  }

  HitTestDrawingSheetItems(aView: VIEW, aPosition: VECTOR2I): boolean {
    const accuracy = Math.trunc(aView.ToWorld(5.0)); // five pixels at current zoom
    const drawList = this.buildDrawList(aView, this.m_properties);

    for (const item of drawList) {
      const bbox = item.GetApproxBBox();
      bbox.Inflate(accuracy);

      if (bbox.Contains(aPosition)) return true;
    }

    return false;
  }
}
