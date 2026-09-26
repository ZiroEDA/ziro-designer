// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview_painter.h` + `.cpp`: `GERBVIEW_RENDER_SETTINGS` (the
 * colours an item is drawn in, and the highlight state) and
 * `GERBVIEW_PAINTER`, which turns a GERBER_DRAW_ITEM into GAL calls in image
 * (AB) coordinates.
 *
 * The GAL underneath is the app's (Canvas 2D or WebGL; STRUCTURE.md): nothing
 * here depends on which, as upstream's painter does not depend on Cairo or
 * OpenGL.
 */
import { brightened, type Color4d, COLOR4D_WHITE, darkened } from '@ziroeda/common/color4d.js';
import { PAINTER } from '@ziroeda/common/gal/painter.js';
import type { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import {
  GAL_LAYER_ID,
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_LAYER_ID,
  IsDCodeLayer,
  LAYER_DRAWINGSHEET,
} from '@ziroeda/common/layer_id.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { ANGLE_360, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { APERTURE_DEF_HOLETYPE, APERTURE_T, type D_CODE } from './dcode.js';
import { GBR_BASIC_SHAPE_TYPE, GERBER_DRAW_ITEM } from './gerber_draw_item.js';
import { gerbIUScale } from './gerbview.js';
import { GERBVIEW_SETTINGS } from './gerbview_settings.js';

/** `COLOR4D( 0, 0, 0, 0 )`. */
const TRANSPARENT: Color4d = { r: 0, g: 0, b: 0, a: 0 };

/** A default GERBVIEW_SETTINGS for a caller with no program object (a test). */
let s_defaultSettings: GERBVIEW_SETTINGS | null = null;

/**
 * `gvconfig()`: the gerbview app settings, from the program's settings
 * manager.
 */
export function gvconfig(): GERBVIEW_SETTINGS {
  const registered = PgmOrNull()
    ?.GetSettingsManager()
    .GetAppSettings<GERBVIEW_SETTINGS>('gerbview');

  if (registered) return registered;

  if (!s_defaultSettings) s_defaultSettings = new GERBVIEW_SETTINGS();

  return s_defaultSettings;
}

/** `gerbIUScale.mmToIU( x )`. */
const mmToIU = (mm: number): number => KiROUND(mm * gerbIUScale.IU_PER_MM);

const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const eq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;
const dist = (a: VECTOR2I, b: VECTOR2I): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Store the gerbview specific render settings. */
export class GERBVIEW_RENDER_SETTINGS extends RENDER_SETTINGS {
  /**
   * If set to anything but an empty string, will highlight items with
   * matching component.
   */
  m_componentHighlightString = '';
  /** If set to anything but an empty string, will highlight items with matching net. */
  m_netHighlightString = '';
  /** If set to anything but an empty string, will highlight items with matching attribute. */
  m_attributeHighlightString = '';
  /** If set to anything but >0 (in fact 10 the min dcode value), will highlight items with matching dcode. */
  m_dcodeHighlightValue = -1;

  /** Maximum font size for D-Codes and other strings. */
  static readonly MAX_FONT_SIZE = mmToIU(10.0);

  constructor() {
    super();
    this.m_backgroundColor = { r: 0, g: 0, b: 0, a: 1 }; // COLOR4D::BLACK

    this.m_componentHighlightString = '';
    this.m_netHighlightString = '';
    this.m_attributeHighlightString = '';
    this.m_dcodeHighlightValue = -1;

    this.update();
  }

  override LoadColors(aSettings: COLOR_SETTINGS): void {
    // Layers to draw gerber data read from gerber files:
    for (
      let i = GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START;
      i < GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START + GERBER_DRAWLAYERS_COUNT;
      i++
    ) {
      let baseColor = aSettings.GetColor(i);

      if (gvconfig().m_Display.m_ForceOpacityMode)
        baseColor = { ...baseColor, a: gvconfig().m_Display.m_OpacityModeAlphaValue };

      this.m_layerColors.set(i, baseColor);
      this.m_layerColorsHi.set(i, brightened(baseColor, 0.5));
      this.m_layerColorsSel.set(i, brightened(baseColor, 0.8));
      this.m_layerColorsDark.set(i, darkened(baseColor, 0.25));
    }

    // Draw layers specific to Gerbview:
    // LAYER_DCODES, LAYER_NEGATIVE_OBJECTS, LAYER_GERBVIEW_GRID, LAYER_GERBVIEW_AXES,
    // LAYER_GERBVIEW_BACKGROUND, LAYER_GERBVIEW_DRAWINGSHEET, LAYER_GERBVIEW_PAGE_LIMITS
    for (let i = GERBVIEW_LAYER_ID.LAYER_DCODES; i < GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_END; i++)
      this.m_layerColors.set(i, aSettings.GetColor(i));

    for (let i = GAL_LAYER_ID.GAL_LAYER_ID_START; i < GAL_LAYER_ID.GAL_LAYER_ID_END; i++)
      this.m_layerColors.set(i, aSettings.GetColor(i));

    // Ensure the generic LAYER_DRAWINGSHEET has the same color as the specialized
    // LAYER_GERBVIEW_DRAWINGSHEET
    this.m_layerColors.set(
      LAYER_DRAWINGSHEET,
      this.m_layerColors.get(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_DRAWINGSHEET) ?? COLOR4D_WHITE,
    );

    this.update();
  }

  /** Clear all highlight selections (dcode, net, component, attribute selection). */
  ClearHighlightSelections(): void {
    this.m_componentHighlightString = '';
    this.m_netHighlightString = '';
    this.m_attributeHighlightString = '';
    this.m_dcodeHighlightValue = -1;
  }

  /** The color of `aItem` drawn on `aLayer`. */
  override GetColor(aItem: VIEW_ITEM | null, aLayer: number): Color4d {
    const gbrItem = aItem instanceof GERBER_DRAW_ITEM ? aItem : null;

    // All DCODE layers stored under a single color setting
    if (IsDCodeLayer(aLayer))
      return this.m_layerColors.get(GERBVIEW_LAYER_ID.LAYER_DCODES) ?? COLOR4D_WHITE;

    if (gbrItem?.IsSelected()) return this.m_layerColorsSel.get(aLayer) ?? COLOR4D_WHITE;

    if (gbrItem?.GetLayerPolarity()) {
      if (gvconfig().m_Appearance.show_negative_objects)
        return this.m_layerColors.get(GERBVIEW_LAYER_ID.LAYER_NEGATIVE_OBJECTS) ?? COLOR4D_WHITE;

      return TRANSPARENT;
    }

    if (
      this.m_netHighlightString.length > 0 &&
      gbrItem &&
      this.m_netHighlightString === gbrItem.GetNetAttributes().m_Netname
    )
      return this.m_layerColorsHi.get(aLayer) ?? COLOR4D_WHITE;

    if (
      this.m_componentHighlightString.length > 0 &&
      gbrItem &&
      this.m_componentHighlightString === gbrItem.GetNetAttributes().m_Cmpref
    )
      return this.m_layerColorsHi.get(aLayer) ?? COLOR4D_WHITE;

    if (
      this.m_attributeHighlightString.length > 0 &&
      gbrItem?.GetDcodeDescr() &&
      this.m_attributeHighlightString === (gbrItem.GetDcodeDescr() as D_CODE).m_AperFunction
    )
      return this.m_layerColorsHi.get(aLayer) ?? COLOR4D_WHITE;

    if (
      this.m_dcodeHighlightValue > 0 &&
      gbrItem?.GetDcodeDescr() &&
      this.m_dcodeHighlightValue === (gbrItem.GetDcodeDescr() as D_CODE).m_Num_Dcode
    )
      return this.m_layerColorsHi.get(aLayer) ?? COLOR4D_WHITE;

    // Return grayish color for non-highlighted layers in the high contrast mode
    if (this.m_hiContrastEnabled && !this.GetHighContrastLayers().has(aLayer))
      return this.m_hiContrastColor.get(aLayer) ?? darkened(COLOR4D_WHITE, 0.25);

    // Catch the case when highlight and high-contraste modes are enabled
    // and we are drawing a not highlighted track
    if (this.m_highlightEnabled)
      return this.m_layerColorsDark.get(aLayer) ?? darkened(COLOR4D_WHITE, 0.5);

    // No special modificators enabled
    return this.m_layerColors.get(aLayer) ?? COLOR4D_WHITE;
  }

  /** Return true if we should show page limits. */
  override GetShowPageLimits(): boolean {
    return gvconfig().m_Display.m_DisplayPageLimits;
  }

  override GetBackgroundColor(): Color4d {
    return this.m_backgroundColor;
  }

  override SetBackgroundColor(aColor: Color4d): void {
    this.m_backgroundColor = aColor;
  }

  override GetGridColor(): Color4d {
    return this.m_layerColors.get(GERBVIEW_LAYER_ID.LAYER_GERBVIEW_GRID) ?? COLOR4D_WHITE;
  }

  override GetCursorColor(): Color4d {
    return this.m_layerColors.get(GAL_LAYER_ID.LAYER_CURSOR) ?? COLOR4D_WHITE;
  }

  /** `m_outlineWidth`, which GERBVIEW_PAINTER reads as a friend. */
  OutlineWidth(): number {
    return this.m_outlineWidth;
  }
}

/** Methods for drawing GerbView specific items. */
export class GERBVIEW_PAINTER extends PAINTER {
  protected m_gerbviewSettings = new GERBVIEW_RENDER_SETTINGS();

  override GetSettings(): GERBVIEW_RENDER_SETTINGS {
    return this.m_gerbviewSettings;
  }

  private gal(): GAL {
    return this.m_gal as GAL;
  }

  /**
   * "If items have 0 thickness, draw them with the outline width, otherwise
   * respect the set value (which, no matter how small will produce something)".
   */
  protected getLineThickness(aActualThickness: number): number {
    if (aActualThickness === 0) return this.m_gerbviewSettings.OutlineWidth();

    return aActualThickness;
  }

  override Draw(aItem: VIEW_ITEM, aLayer: number): boolean {
    if (aItem instanceof GERBER_DRAW_ITEM) {
      this.draw(aItem, aLayer);
      return true;
    }

    return false;
  }

  private draw(aItem: GERBER_DRAW_ITEM, aLayer: number): void {
    const gal = this.gal();
    const start = aItem.GetABPosition(aItem.m_Start);
    const end = aItem.GetABPosition(aItem.m_End);
    const width = aItem.m_Size.x;
    let isFilled = true;
    let color: Color4d;
    // TODO(JE) This doesn't actually work properly for ImageNegative
    const image = aItem.m_GerberImageFile;
    const isNegative = aItem.GetLayerPolarity() !== (image?.m_ImageNegative ?? false);

    // Draw DCODE overlay text
    if (IsDCodeLayer(aLayer)) {
      const prms = aItem.GetTextD_CodePrms();

      if (!prms) return;

      color = this.m_gerbviewSettings.GetColor(aItem, aLayer);
      const codeText = `D${aItem.m_DCode}`;

      gal.SetIsStroke(true);
      gal.SetIsFill(false);
      gal.SetStrokeColor(color);
      gal.SetFillColor(TRANSPARENT);
      gal.SetLineWidth(prms.size / 10);
      gal.SetFontBold(false);
      gal.SetFontItalic(false);
      gal.SetFontUnderlined(false);
      gal.SetTextMirrored(false);
      gal.SetGlyphSize({ x: prms.size, y: prms.size });
      gal.SetHorizontalJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      gal.SetVerticalJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
      gal.BitmapText(codeText, prms.pos, prms.orientation);

      return;
    }

    color = this.m_gerbviewSettings.GetColor(aItem, aLayer);

    // TODO: Should brightened color be a preference?
    if (aItem.IsBrightened()) color = { r: 0.0, g: 1.0, b: 0.0, a: 0.75 };

    gal.SetNegativeDrawMode(isNegative && !gvconfig().m_Appearance.show_negative_objects);
    gal.SetStrokeColor(color);
    gal.SetFillColor(color);
    gal.SetIsFill(isFilled);
    gal.SetIsStroke(!isFilled);

    switch (aItem.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON: {
        isFilled = gvconfig().m_Display.m_DisplayPolygonsFill;
        gal.SetIsFill(isFilled);
        gal.SetIsStroke(!isFilled);

        if (isNegative && !isFilled) {
          gal.SetNegativeDrawMode(false);
          gal.SetStrokeColor(this.GetSettings().GetColor(aItem, aLayer));
        }

        if (!isFilled) gal.SetLineWidth(this.m_gerbviewSettings.OutlineWidth());

        if (aItem.m_AbsolutePolygon.OutlineCount() === 0) {
          const pts = aItem.m_ShapeAsPolygon
            .COutline(0)
            .CPoints()
            .map((pt) => aItem.GetABPosition(pt));

          const chain = new SHAPE_LINE_CHAIN(pts);
          chain.SetClosed(true);
          aItem.m_AbsolutePolygon.AddOutline(chain);
        }

        // Degenerated polygons (having < 3 points) are drawn as lines
        // to avoid issues in draw polygon functions
        if (!isFilled || aItem.m_AbsolutePolygon.COutline(0).PointCount() < 3) {
          gal.DrawPolyline(aItem.m_AbsolutePolygon.COutline(0));
        } else {
          // On Opengl, a not convex filled polygon is usually drawn by using triangles as
          // primitives. CacheTriangulation() can create basic triangle primitives to draw the
          // polygon solid shape on Opengl
          if (gal.IsOpenGlEngine() && !aItem.m_AbsolutePolygon.IsTriangulationUpToDate())
            aItem.m_AbsolutePolygon.CacheTriangulation(
              false /* fastest triangulation calculation mode */,
            );

          gal.DrawPolygon(aItem.m_AbsolutePolygon);
        }

        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE: {
        isFilled = gvconfig().m_Display.m_DisplayLinesFill;
        const radius = dist(aItem.m_Start, aItem.m_End);
        gal.DrawCircle(start, radius);
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_ARC: {
        isFilled = gvconfig().m_Display.m_DisplayLinesFill;

        // These are swapped because wxDC fills arcs counterclockwise and GAL
        // fills them clockwise.
        const arcStart = aItem.m_End;
        const arcEnd = aItem.m_Start;

        // Gerber arcs are 3-point (start, center, end)
        // GAL needs center, radius, start angle, end angle
        const radius = dist(arcStart, aItem.m_ArcCentre);
        const center = aItem.GetABPosition(aItem.m_ArcCentre);
        const startVec = sub(aItem.GetABPosition(arcStart), center);
        const endVec = sub(aItem.GetABPosition(arcEnd), center);

        gal.SetIsFill(isFilled);
        gal.SetIsStroke(!isFilled);
        gal.SetLineWidth(isFilled ? width : this.m_gerbviewSettings.OutlineWidth());

        const startAngle = EDA_ANGLE.fromVector(startVec);
        let endAngle = EDA_ANGLE.fromVector(endVec);

        // GAL fills in direction of increasing angle, so we have to convert
        // the angle from the -PI to PI domain of atan2() to ensure that
        // the arc goes in the right direction
        if (startAngle.gt(endAngle)) endAngle = endAngle.add(ANGLE_360);

        // In Gerber, 360-degree arcs are stored in the file with start equal to end
        if (eq(arcStart, arcEnd)) endAngle = startAngle.add(ANGLE_360);

        // Adjust the allowed approx error to convert arcs to segments:
        const arc_to_seg_error = mmToIU(0.005); // Allow 5 microns
        gal.DrawArcSegment(
          center,
          radius,
          startAngle,
          endAngle.sub(startAngle),
          width,
          arc_to_seg_error,
        );
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
        isFilled = gvconfig().m_Display.m_DisplayFlashedItemsFill;
        this.drawFlashedShape(aItem, isFilled);
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT: {
        /* Plot a line from m_Start to m_End.
         * Usually, a round pen is used, but some gerber files use a rectangular pen
         * In fact, any aperture can be used to plot a line.
         * currently: only a square pen is handled (I believe using a polygon gives a strange plot).
         */
        isFilled = gvconfig().m_Display.m_DisplayLinesFill;
        gal.SetIsFill(isFilled);
        gal.SetIsStroke(!isFilled);

        if (isNegative && !isFilled) gal.SetStrokeColor(this.GetSettings().GetColor(aItem, aLayer));

        // TODO(JE) Refactor this to allow const aItem
        const code = aItem.GetDcodeDescr();
        if (code && code.m_ApertType === APERTURE_T.APT_RECT) {
          if (aItem.m_ShapeAsPolygon.OutlineCount() === 0) aItem.ConvertSegmentToPolygon();

          this.drawPolygon(aItem, aItem.m_ShapeAsPolygon, isFilled);
        } else {
          if (!isFilled) gal.SetLineWidth(this.m_gerbviewSettings.OutlineWidth());

          gal.DrawSegment(start, end, width);
        }
        break;
      }

      default:
        // wxASSERT_MSG( false, wxT( "GERBER_DRAW_ITEM shape is unknown!" ) );
        break;
    }

    gal.SetNegativeDrawMode(false);
  }

  /**
   * Helper routine to draw a polygon: its first outline, through
   * GetABPosition, offset by the item's position when `aShift`.
   */
  private drawPolygon(
    aParent: GERBER_DRAW_ITEM,
    aPolygon: SHAPE_POLY_SET,
    aFilled: boolean,
    aShift = false,
  ): void {
    const gal = this.gal();

    // wxASSERT( aPolygon.OutlineCount() == 1 );
    if (aPolygon.OutlineCount() === 0) return;

    const poly = new SHAPE_POLY_SET();
    poly.NewOutline();
    const pts = aPolygon.COutline(0).CPoints();
    const offset = aShift ? { ...aParent.m_Start } : { x: 0, y: 0 };

    for (const pt of pts) poly.Append(aParent.GetABPosition(add(pt, offset)));

    if (!gvconfig().m_Display.m_DisplayPolygonsFill)
      gal.SetLineWidth(this.m_gerbviewSettings.OutlineWidth());

    if (!aFilled) gal.DrawPolyline(poly.COutline(0));
    else gal.DrawPolygon(poly);
  }

  /** Helper to draw a flashed shape (aka spot). */
  private drawFlashedShape(aItem: GERBER_DRAW_ITEM, aFilled: boolean): void {
    const gal = this.gal();
    const code = aItem.GetDcodeDescr();

    if (!code) {
      // wxLogDebug( wxT( "drawFlashedShape: Item has no D_CODE" ) );
      return;
    }

    gal.SetIsFill(aFilled);
    gal.SetIsStroke(!aFilled);
    gal.SetLineWidth(this.m_gerbviewSettings.OutlineWidth());

    switch (aItem.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE: {
        const radius = code.m_Size.x >> 1;
        const start = aItem.GetABPosition(aItem.m_Start);

        if (!aFilled || code.m_DrillShape === APERTURE_DEF_HOLETYPE.APT_DEF_NO_HOLE) {
          gal.DrawCircle(start, radius);
        } else {
          // rectangular hole
          if (code.m_Polygon.OutlineCount() === 0) code.ConvertShapeToPolygon(aItem);

          this.drawPolygon(aItem, code.m_Polygon, aFilled, true);
        }

        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT: {
        const aShapePos = aItem.m_Start;
        let codeStart: VECTOR2I = {
          x: aShapePos.x - Math.trunc(code.m_Size.x / 2),
          y: aShapePos.y - Math.trunc(code.m_Size.y / 2),
        };
        let codeEnd = add(codeStart, code.m_Size);
        codeStart = aItem.GetABPosition(codeStart);
        codeEnd = aItem.GetABPosition(codeEnd);

        if (!aFilled || code.m_DrillShape === APERTURE_DEF_HOLETYPE.APT_DEF_NO_HOLE) {
          gal.DrawRectangle(codeStart, codeEnd);
        } else {
          if (code.m_Polygon.OutlineCount() === 0) code.ConvertShapeToPolygon(aItem);

          this.drawPolygon(aItem, code.m_Polygon, aFilled, true);
        }
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL: {
        let radius = 0;

        let codeStart = { ...aItem.m_Start };
        let codeEnd = { ...aItem.m_Start };

        if (code.m_Size.x > code.m_Size.y) {
          // horizontal oval
          const delta = Math.trunc((code.m_Size.x - code.m_Size.y) / 2);
          codeStart.x -= delta;
          codeEnd.x += delta;
          radius = code.m_Size.y;
        } else {
          // horizontal oval
          const delta = Math.trunc((code.m_Size.y - code.m_Size.x) / 2);
          codeStart.y -= delta;
          codeEnd.y += delta;
          radius = code.m_Size.x;
        }

        codeStart = aItem.GetABPosition(codeStart);
        codeEnd = aItem.GetABPosition(codeEnd);

        if (!aFilled || code.m_DrillShape === APERTURE_DEF_HOLETYPE.APT_DEF_NO_HOLE) {
          gal.DrawSegment(codeStart, codeEnd, radius);
        } else {
          if (code.m_Polygon.OutlineCount() === 0) code.ConvertShapeToPolygon(aItem);

          this.drawPolygon(aItem, code.m_Polygon, aFilled, true);
        }
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
        if (code.m_Polygon.OutlineCount() === 0) code.ConvertShapeToPolygon(aItem);

        this.drawPolygon(aItem, code.m_Polygon, aFilled, true);
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
        this.drawApertureMacro(aItem, aFilled);
        break;

      default:
        // wxASSERT_MSG( false, wxT( "Unknown Gerber flashed shape!" ) );
        break;
    }
  }

  /** Helper to draw an aperture macro shape. */
  private drawApertureMacro(aParent: GERBER_DRAW_ITEM, aFilled: boolean): void {
    const gal = this.gal();

    if (aParent.m_AbsolutePolygon.OutlineCount() === 0) {
      const code = aParent.GetDcodeDescr() as D_CODE;
      const macro = code.GetMacro();

      if (macro)
        aParent.m_AbsolutePolygon = macro
          .GetApertureMacroShape(aParent, aParent.m_Start)
          .CloneDropTriangulation();
    }

    const polyset = aParent.m_AbsolutePolygon;

    if (!gvconfig().m_Display.m_DisplayPolygonsFill)
      gal.SetLineWidth(this.m_gerbviewSettings.OutlineWidth());

    if (!aFilled) {
      for (let i = 0; i < polyset.OutlineCount(); i++) gal.DrawPolyline(polyset.COutline(i));
    } else {
      gal.DrawPolygon(polyset);
    }
  }
}
