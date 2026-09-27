// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BRDITEMS_PLOTTER` — `pcbnew/plot_brditems_plotter.cpp`, declared in
 * `pcbplot.h`: plots one board item at a time through a PLOTTER, attaching
 * the Gerber X2 aperture and object attributes (`GBR_METADATA`) each item
 * carries.
 *
 * Divergence: `COLOR_SETTINGS` is not ported into the plot params
 * (pcb_plot_params.ts), so {@link BRDITEMS_PLOTTER.getColor} answers black.
 * Every colour it feeds reaches `SetColor`, which the Gerber back-end ignores;
 * the colour back-ends will need the real table.
 */

import {
  COLOR4D_BLACK,
  COLOR4D_WHITE,
  type Color4d,
  LEGACY_COLORS,
} from '@ziroeda/common/gal/color4d.js';
import { CALLBACK_GAL } from '@ziroeda/common/callback_gal.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { TEXT_ATTRIBUTES } from '@ziroeda/common/font/text_attributes.js';
import { GBR_APERTURE_ATTRIB, GBR_METADATA } from '@ziroeda/common/gbr_metadata.js';
import { GBR_NETINFO_TYPE } from '@ziroeda/common/gbr_netlist_metadata.js';
import { IsCopperLayer, IsExternalCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  DXF_OUTLINE_MODE,
  FILL_T,
  LINE_STYLE,
  PLOT_FORMAT,
  PLOT_TEXT_MODE,
  type PLOTTER,
  plotterFont,
} from '@ziroeda/common/plotters/plotter.js';
import type { GERBER_PLOTTER } from '@ziroeda/common/plotters/GERBER_plotter.js';
import { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { printableCharCount, unescapeString, wxStringSplit } from '@ziroeda/common/string_utils.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, ANGLE_90, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET, CornerStrategy } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import type { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';
import type { PAD } from './pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_PROP, PAD_SHAPE, PADSTACK } from './padstack.js';
import { PCB_PLOT_PARAMS, DRILL_MARKS } from './pcb_plot_params.js';
import { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import type { PCB_TARGET } from './pcb_target.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_VIA } from './pcb_track.js';
import type { ZONE } from './zone.js';

const WHITE = COLOR4D_WHITE;
/** The EDA_TEXT half of every text item BRDITEMS_PLOTTER::PlotText is handed. */
type PLOTTED_TEXT = Pick<
  EDA_TEXT,
  | 'GetDrawFont'
  | 'GetShownText'
  | 'GetTextPos'
  | 'GetAttributes'
  | 'GetEffectiveTextPenWidth'
  | 'GetDrawRotation'
  | 'GetRenderCache'
  | 'IsMultilineAllowed'
  | 'GetLinePositions'
>;

/** `LIGHTGRAY`, the `EDA_COLOR_T` palette entry (color4d.cpp). */
const LIGHTGRAY: Color4d = LEGACY_COLORS.LIGHTGRAY;

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/** Plots board items through a PLOTTER, with Gerber attributes. */
export class BRDITEMS_PLOTTER extends PCB_PLOT_PARAMS {
  private m_plotter: PLOTTER;
  private m_board: BOARD;
  private m_layerMask = new LSET();

  constructor(aPlotter: PLOTTER, aBoard: BOARD, aPlotOpts: PCB_PLOT_PARAMS) {
    super();
    this.assign(aPlotOpts);
    this.m_plotter = aPlotter;
    this.m_board = aBoard;
  }

  getFineWidthAdj(): number {
    if (this.GetFormat() === PLOT_FORMAT.POST) return this.GetWidthAdjust();
    else return 0;
  }

  // Basic functions to plot a board item
  SetLayerSet(aLayerMask: LSET): void {
    this.m_layerMask = aLayerMask;
  }

  private hideDNPItems(aLayer: PCB_LAYER_ID): boolean {
    return (
      this.GetHideDNPFPsOnFabLayers() &&
      (aLayer === PCB_LAYER_ID.F_Fab || aLayer === PCB_LAYER_ID.B_Fab)
    );
  }

  private crossoutDNPItems(aLayer: PCB_LAYER_ID): boolean {
    return (
      this.GetCrossoutDNPFPsOnFabLayers() &&
      (aLayer === PCB_LAYER_ID.F_Fab || aLayer === PCB_LAYER_ID.B_Fab)
    );
  }

  /** `m_plotter->RenderSettings()` as the RENDER_SETTINGS the text calls take. */
  private renderSettings(): RENDER_SETTINGS | null {
    const settings = this.m_plotter.RenderSettings();
    return settings instanceof RENDER_SETTINGS ? settings : null;
  }

  /** `getMetadata()`: the Gerber metadata, the DXF plot options, or nothing. */
  private metadata(aGbrMetadata: GBR_METADATA): unknown {
    const type = this.m_plotter.GetPlotterType();

    if (type === PLOT_FORMAT.GERBER) return aGbrMetadata;
    if (type === PLOT_FORMAT.DXF) return this;

    return null;
  }

  private gerber(): GERBER_PLOTTER | null {
    return this.m_plotter.GetPlotterType() === PLOT_FORMAT.GERBER
      ? (this.m_plotter as GERBER_PLOTTER)
      : null;
  }

  getColor(_aLayer: number): Color4d {
    // `ColorSettings()->GetColor( aLayer )`; see the file comment.
    let color = COLOR4D_BLACK;

    // A hack to avoid plotting a white item in white color on white paper
    if (colorEquals(color, WHITE)) color = LIGHTGRAY;

    return color;
  }

  PlotPadNumber(aPad: PAD, aColor: Color4d): void {
    const padNumber = unescapeString(aPad.GetNumber());

    if (padNumber === '') return;

    const padBBox = aPad.GetBoundingBox();
    let position = padBBox.Centre();
    const padsize = { ...padBBox.GetSize() };

    // TODO(JE) padstacks
    if (aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CUSTOM) {
      // See if we have a number box
      for (const primitive of aPad.GetPrimitives(PADSTACK.ALL_LAYERS)) {
        if (primitive.IsProxyItem() && primitive.GetShape() === SHAPE_T.RECTANGLE) {
          position = RotatePoint(primitive.GetCenter(), aPad.GetOrientation());
          const shapePos = aPad.ShapePos(PADSTACK.ALL_LAYERS);
          position = { x: position.x + shapePos.x, y: position.y + shapePos.y };

          padsize.x = Math.abs(primitive.GetBotRight().x - primitive.GetTopLeft().x);
          padsize.y = Math.abs(primitive.GetBotRight().y - primitive.GetTopLeft().y);

          break;
        }
      }
    }

    if (aPad.GetShape(PADSTACK.ALL_LAYERS) !== PAD_SHAPE.CUSTOM) {
      // Don't allow a 45° rotation to bloat a pad's bounding box unnecessarily
      const size = aPad.GetSize(PADSTACK.ALL_LAYERS);
      const limit = KiROUND(Math.min(size.x, size.y) * 1.1);

      if (padsize.x > limit && padsize.y > limit) {
        padsize.x = limit;
        padsize.y = limit;
      }
    }

    const textAttrs = new TEXT_ATTRIBUTES();

    textAttrs.m_Mirrored = this.m_plotter.GetPlotMirrored();

    if (padsize.x < padsize.y * 0.95) {
      textAttrs.m_Angle = ANGLE_90;
      [padsize.x, padsize.y] = [padsize.y, padsize.x];
    }

    // approximate the size of the pad number text:
    // We use a size for at least 3 chars, to give a good look even for short numbers
    let tsize = KiROUND(padsize.x / Math.max(printableCharCount(padNumber), 3));
    tsize = Math.min(tsize, padsize.y);

    // enforce a max size
    tsize = Math.min(tsize, pcbIUScale.mmToIU(5.0));

    textAttrs.m_Size = { x: tsize, y: tsize };

    // use a somewhat spindly font to go with the outlined pads
    textAttrs.m_StrokeWidth = KiROUND(tsize / 12.0);

    // `PlotText( position, aColor, padNumber, textAttrs )`: the font and metrics
    // default to `nullptr` and `METRICS::Default()`, and a null font is
    // `FONT::GetFont( m_renderSettings->GetDefaultFont() )`, the stroke font.
    this.m_plotter.PlotText(
      position,
      aColor,
      padNumber,
      textAttrs,
      plotterFont(FONT.GetFont(), METRICS.Default()),
    );
  }

  PlotPad(aPad: PAD, aLayer: PCB_LAYER_ID, aColor: Color4d, aSketchMode: boolean): void {
    const shape_pos = aPad.ShapePos(aLayer);
    const metadata = new GBR_METADATA();

    const plotOnCopperLayer = this.m_layerMask.and(LSET.AllCuMask()).any();
    const plotOnExternalCopperLayer = this.m_layerMask.and(LSET.ExternalCuMask()).any();

    // Pad not on the solder mask layer cannot be soldered.
    // therefore it can have a specific aperture attribute.
    // Not yet in use.
    // bool isPadOnBoardTechLayers = ( aPad->GetLayerSet() & LSET::AllBoardTechMask() ).any();

    metadata.SetCmpReference(aPad.GetParentFootprint()!.GetReference());

    if (plotOnCopperLayer) {
      metadata.SetNetAttribType(
        GBR_NETINFO_TYPE.GBR_NETINFO_PAD |
          GBR_NETINFO_TYPE.GBR_NETINFO_NET |
          GBR_NETINFO_TYPE.GBR_NETINFO_CMP,
      );
      metadata.SetCopper(true);

      // Gives a default attribute, for instance for pads used as tracks in net ties:
      // Connector pads and SMD pads are on external layers
      // if on internal layers, they are certainly used as net tie
      // and are similar to tracks: just conductor items
      metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CONDUCTOR);

      const useUTF8 = false;
      const useQuoting = false;
      metadata.SetPadName(aPad.GetNumber(), useUTF8, useQuoting);

      if (aPad.GetNumber() !== '')
        metadata.SetPadPinFunction(aPad.GetPinFunction(), useUTF8, useQuoting);

      metadata.SetNetName(aPad.GetNetname());

      // Some pads are mechanical pads ( through hole or smd )
      // when this is the case, they have no pad name and/or are not plated.
      // In this case gerber files have slightly different attributes.
      if (aPad.GetAttribute() === PAD_ATTRIB.NPTH || aPad.GetNumber() === '')
        metadata.m_NetlistMetadata.m_NotInNet = true;

      if (!plotOnExternalCopperLayer) {
        // the .P object attribute (GBR_NETLIST_METADATA::GBR_NETINFO_PAD)
        // is used on outer layers, unless the component is embedded
        // or a "etched" component (fp only drawn, not a physical component)
        // Currently, Pcbnew does not handle embedded component, so we disable the .P
        // attribute on internal layers
        // Note the Gerber doc is not really clear about through holes pads about the .P
        metadata.SetNetAttribType(
          GBR_NETINFO_TYPE.GBR_NETINFO_NET | GBR_NETINFO_TYPE.GBR_NETINFO_CMP,
        );
      }

      // Some attributes are reserved to the external copper layers:
      // GBR_APERTURE_ATTRIB_CONNECTORPAD and GBR_APERTURE_ATTRIB_SMDPAD_CUDEF
      // for instance.
      // Pad with type PAD_ATTRIB::CONN or PAD_ATTRIB::SMD that is not on outer layer
      // has its aperture attribute set to GBR_APERTURE_ATTRIB_CONDUCTOR
      switch (aPad.GetAttribute()) {
        case PAD_ATTRIB.NPTH: // Mechanical pad through hole
          metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_WASHERPAD);
          break;

        case PAD_ATTRIB.PTH: // Pad through hole, a hole is also expected
          metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_COMPONENTPAD);
          break;

        case PAD_ATTRIB.CONN: // Connector pads, no solder paste but with solder mask.
          if (plotOnExternalCopperLayer)
            metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CONNECTORPAD);
          break;

        case PAD_ATTRIB.SMD: // SMD pads (on external copper layer only)
          // with solder paste and mask
          if (plotOnExternalCopperLayer)
            metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_SMDPAD_CUDEF);
          break;
      }

      // Fabrication properties can have specific GBR_APERTURE_METADATA options
      // that replace previous aperture attribute:
      switch (aPad.GetProperty()) {
        case PAD_PROP.BGA: // Only applicable to outer layers
          if (plotOnExternalCopperLayer)
            metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_BGAPAD_CUDEF);
          break;

        case PAD_PROP.FIDUCIAL_GLBL:
          metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_FIDUCIAL_GLBL);
          break;

        case PAD_PROP.FIDUCIAL_LOCAL:
          metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_FIDUCIAL_LOCAL);
          break;

        case PAD_PROP.TESTPOINT: // Only applicable to outer layers
          if (plotOnExternalCopperLayer)
            metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_TESTPOINT);
          break;

        case PAD_PROP.HEATSINK:
          metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_HEATSINKPAD);
          break;

        case PAD_PROP.CASTELLATED:
          metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CASTELLATEDPAD);
          break;

        default: // PRESSFIT (used only in drill files), NONE, MECHANICAL
          break;
      }

      // Ensure NPTH pads have *always* the GBR_APERTURE_ATTRIB_WASHERPAD attribute
      if (aPad.GetAttribute() === PAD_ATTRIB.NPTH)
        metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_WASHERPAD);
    } else {
      metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_CMP);
    }

    // Set plot color (change WHITE to LIGHTGRAY because
    // the white items are not seen on a white paper or screen
    this.m_plotter.SetColor(!colorEquals(aColor, WHITE) ? aColor : LIGHTGRAY);

    if (aSketchMode) {
      switch (aPad.GetShape(aLayer)) {
        case PAD_SHAPE.CIRCLE:
          this.m_plotter.ThickCircle(
            shape_pos,
            aPad.GetSize(aLayer).x,
            this.GetSketchPadLineWidth(),
            null,
          );
          break;

        case PAD_SHAPE.OVAL:
          this.m_plotter.ThickOval(
            shape_pos,
            aPad.GetSize(aLayer),
            aPad.GetOrientation(),
            this.GetSketchPadLineWidth(),
            null,
          );
          break;

        default: {
          // RECTANGLE, ROUNDRECT, TRAPEZOID, CHAMFERED_RECT, CUSTOM
          const outline = new SHAPE_POLY_SET();
          aPad.TransformShapeToPolygon(
            outline,
            aLayer,
            0,
            this.m_plotter.GetPlotterArcHighDef(),
            ERROR_LOC.ERROR_INSIDE,
            false,
          );

          this.m_plotter.ThickPoly(outline, this.GetSketchPadLineWidth(), null);
          break;
        }
      }

      return;
    }

    switch (aPad.GetShape(aLayer)) {
      case PAD_SHAPE.CIRCLE:
        this.m_plotter.FlashPadCircle(shape_pos, aPad.GetSize(aLayer).x, metadata);
        break;

      case PAD_SHAPE.OVAL:
        this.m_plotter.FlashPadOval(
          shape_pos,
          aPad.GetSize(aLayer),
          aPad.GetOrientation(),
          metadata,
        );
        break;

      case PAD_SHAPE.RECTANGLE:
        this.m_plotter.FlashPadRect(
          shape_pos,
          aPad.GetSize(aLayer),
          aPad.GetOrientation(),
          metadata,
        );
        break;

      case PAD_SHAPE.ROUNDRECT:
        this.flashPadRoundRect(
          shape_pos,
          aPad.GetSize(aLayer),
          aPad.GetRoundRectCornerRadius(aLayer),
          aPad.GetOrientation(),
          metadata,
        );
        break;

      case PAD_SHAPE.TRAPEZOID: {
        // Build the pad polygon in coordinates relative to the pad
        // (i.e. for a pad at pos 0,0, rot 0.0). Needed to use aperture macros,
        // to be able to create a pattern common to all trapezoid pads having the same shape
        // Order is lower left, lower right, upper right, upper left.
        const size = aPad.GetSize(aLayer);
        const delta = aPad.GetDelta(aLayer);
        const half_size = { x: Math.trunc(size.x / 2), y: Math.trunc(size.y / 2) };
        const trap_delta = { x: Math.trunc(delta.x / 2), y: Math.trunc(delta.y / 2) };

        const coord: VECTOR2I[] = [
          { x: -half_size.x - trap_delta.y, y: half_size.y + trap_delta.x },
          { x: half_size.x + trap_delta.y, y: half_size.y - trap_delta.x },
          { x: half_size.x - trap_delta.y, y: -half_size.y + trap_delta.x },
          { x: -half_size.x + trap_delta.y, y: -half_size.y - trap_delta.x },
        ];

        this.m_plotter.FlashPadTrapez(shape_pos, coord, aPad.GetOrientation(), metadata);
        break;
      }

      default: {
        const gerberPlotter = this.gerber();

        if (aPad.GetShape(aLayer) === PAD_SHAPE.CHAMFERED_RECT && gerberPlotter) {
          gerberPlotter.FlashPadChamferRoundRect(
            shape_pos,
            aPad.GetSize(aLayer),
            aPad.GetRoundRectCornerRadius(aLayer),
            aPad.GetChamferRectRatio(aLayer),
            aPad.GetChamferPositions(aLayer),
            aPad.GetOrientation(),
            metadata,
          );
          break;
        }

        // KI_FALLTHROUGH: CUSTOM, and CHAMFERED_RECT on a non-Gerber plotter
        const polygons = aPad.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE);

        if (polygons.OutlineCount())
          this.flashPadCustom(aPad, aLayer, shape_pos, polygons, metadata);
        break;
      }
    }
  }

  /** `m_plotter->FlashPadRoundRect(…)`: declared on PLOTTER upstream, not yet on ours. */
  private flashPadRoundRect(
    aPos: VECTOR2I,
    aSize: VECTOR2I,
    aRadius: number,
    aOrient: EDA_ANGLE,
    aData: GBR_METADATA,
  ): void {
    const plotter = this.m_plotter as PLOTTER & {
      FlashPadRoundRect?(p: VECTOR2I, s: VECTOR2I, r: number, o: EDA_ANGLE, d?: unknown): void;
    };

    if (!plotter.FlashPadRoundRect)
      throw new Error('this plotter has no FlashPadRoundRect (PS_plotter.ts file comment)');

    plotter.FlashPadRoundRect(aPos, aSize, aRadius, aOrient, aData);
  }

  /** `m_plotter->FlashPadCustom(…)`: declared on PLOTTER upstream, not yet on ours. */
  private flashPadCustom(
    aPad: PAD,
    aLayer: PCB_LAYER_ID,
    aPos: VECTOR2I,
    aPolygons: SHAPE_POLY_SET,
    aData: GBR_METADATA,
  ): void {
    const gerberPlotter = this.gerber();

    if (!gerberPlotter) throw new Error('FlashPadCustom is only wired for the Gerber plotter here');

    gerberPlotter.FlashPadCustom(
      aPos,
      aPad.GetSize(aLayer),
      aPad.GetOrientation(),
      aPolygons,
      aData,
    );
  }

  PlotFootprintTextItems(aFootprint: FOOTPRINT): void {
    if (!this.GetPlotFPText()) return;

    const variantName = this.m_board ? this.m_board.GetCurrentVariant() : '';
    const dnp = aFootprint.GetDNPForVariant(variantName);

    const reference = aFootprint.Reference();
    const refLayer = reference.GetLayer();

    // Reference and value have special controls for forcing their plotting
    if (
      this.GetPlotReference() &&
      this.m_layerMask.test(refLayer) &&
      reference.IsVisible() &&
      !(dnp && this.hideDNPItems(refLayer))
    ) {
      this.PlotText(
        reference,
        refLayer,
        reference.IsKnockout(),
        reference.GetFontMetrics(),
        dnp && this.crossoutDNPItems(refLayer),
      );
    }

    const value = aFootprint.Value();
    const valueLayer = value.GetLayer();

    if (
      this.GetPlotValue() &&
      this.m_layerMask.test(valueLayer) &&
      value.IsVisible() &&
      !(dnp && this.hideDNPItems(valueLayer))
    ) {
      this.PlotText(value, valueLayer, value.IsKnockout(), value.GetFontMetrics(), false);
    }

    const texts: PCB_TEXT[] = [];

    // Skip the reference and value texts that are handled specially
    for (const field of aFootprint.GetFields()) {
      if (!field) continue;

      if (field.IsReference() || field.IsValue()) continue;

      if (field.IsVisible()) texts.push(field);
    }

    for (const item of aFootprint.GraphicalItems()) {
      // dynamic_cast<PCB_TEXT*>: PCB_TEXT and everything derived from it
      if (item.Type() === KICAD_T.PCB_TEXT_T || item.Type() === KICAD_T.PCB_FIELD_T)
        texts.push(item as unknown as PCB_TEXT);
    }

    for (const text of texts) {
      const textLayer = text.GetLayer();
      let strikeout = false;

      if (textLayer === PCB_LAYER_ID.Edge_Cuts || textLayer >= PCB_LAYER_ID.PCB_LAYER_ID_COUNT)
        continue;

      if (dnp && this.hideDNPItems(textLayer)) continue;

      if (!this.m_layerMask.test(textLayer) || aFootprint.GetPrivateLayers().test(textLayer))
        continue;

      if (text.GetText() === '${REFERENCE}') {
        if (!this.GetPlotReference()) continue;

        strikeout = dnp && this.crossoutDNPItems(textLayer);
      }

      if (text.GetText() === '${VALUE}') {
        if (!this.GetPlotValue()) continue;
      }

      this.PlotText(text, textLayer, text.IsKnockout(), text.GetFontMetrics(), strikeout);
    }
  }

  PlotBoardGraphicItem(item: BOARD_ITEM): void {
    switch (item.Type()) {
      case KICAD_T.PCB_SHAPE_T:
        this.PlotShape(item as PCB_SHAPE);
        break;

      case KICAD_T.PCB_TEXT_T: {
        const text = item as unknown as PCB_TEXT;
        this.PlotText(text, text.GetLayer(), text.IsKnockout(), text.GetFontMetrics());
        break;
      }

      case KICAD_T.PCB_TEXTBOX_T: {
        this.m_plotter.SetTextMode(PLOT_TEXT_MODE.STROKE);

        const textbox = item as unknown as PCB_TEXTBOX;
        this.PlotText(textbox, textbox.GetLayer(), textbox.IsKnockout(), textbox.GetFontMetrics());

        if (textbox.IsBorderEnabled()) this.PlotShape(textbox);

        this.m_plotter.SetTextMode(this.GetTextMode());
        break;
      }

      case KICAD_T.PCB_BARCODE_T:
        this.PlotBarCode(item as unknown as PCB_BARCODE);
        break;

      case KICAD_T.PCB_TABLE_T: {
        const table = item as unknown as PCB_TABLE;

        this.m_plotter.SetTextMode(PLOT_TEXT_MODE.STROKE);

        for (const cell of table.GetCells())
          this.PlotText(cell, cell.GetLayer(), cell.IsKnockout(), cell.GetFontMetrics());

        this.PlotTableBorders(table);

        this.m_plotter.SetTextMode(this.GetTextMode());
        break;
      }

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        this.m_plotter.SetTextMode(PLOT_TEXT_MODE.STROKE);

        this.PlotDimension(item as unknown as PCB_DIMENSION_BASE);

        this.m_plotter.SetTextMode(this.GetTextMode());
        break;

      case KICAD_T.PCB_TARGET_T:
        this.PlotPcbTarget(item as unknown as PCB_TARGET);
        break;

      default:
        break;
    }
  }

  PlotDimension(aDim: PCB_DIMENSION_BASE): void {
    if (!this.m_layerMask.test(aDim.GetLayer())) return;

    const color = this.getColor(aDim.GetLayer());

    // Set plot color (change WHITE to LIGHTGRAY because
    // the white items are not seen on a white paper or screen
    this.m_plotter.SetColor(!colorEquals(color, WHITE) ? color : LIGHTGRAY);

    this.PlotText(aDim, aDim.GetLayer(), false, aDim.GetFontMetrics());

    const temp_item = new PCB_SHAPE(null);

    temp_item.SetStroke(new STROKE_PARAMS(aDim.GetLineThickness(), LINE_STYLE.SOLID));
    temp_item.SetLayer(aDim.GetLayer());

    for (const shape of aDim.GetShapes()) {
      switch (shape.Type()) {
        case SHAPE_TYPE.SH_SEGMENT: {
          const seg = (shape as SHAPE_SEGMENT).GetSeg();

          temp_item.SetShape(SHAPE_T.SEGMENT);
          temp_item.SetStart(seg.A);
          temp_item.SetEnd(seg.B);

          this.PlotShape(temp_item);
          break;
        }

        case SHAPE_TYPE.SH_CIRCLE: {
          const start = shape.Centre();
          const radius = (shape as SHAPE_CIRCLE).GetRadius();

          temp_item.SetShape(SHAPE_T.CIRCLE);
          temp_item.SetFilled(false);
          temp_item.SetStart(start);
          temp_item.SetEnd({ x: start.x + radius, y: start.y });

          this.PlotShape(temp_item);
          break;
        }

        default:
          break;
      }
    }
  }

  PlotPcbTarget(aMire: PCB_TARGET): void {
    if (!this.m_layerMask.test(aMire.GetLayer())) return;

    this.m_plotter.SetColor(this.getColor(aMire.GetLayer()));

    const temp_item = new PCB_SHAPE(null);

    temp_item.SetShape(SHAPE_T.CIRCLE);
    temp_item.SetFilled(false);
    temp_item.SetStroke(new STROKE_PARAMS(aMire.GetWidth(), LINE_STYLE.SOLID));
    temp_item.SetLayer(aMire.GetLayer());
    temp_item.SetStart(aMire.GetPosition());
    let radius = Math.trunc(aMire.GetSize() / 3);

    if (aMire.GetShape())
      // temp_item X
      radius = Math.trunc(aMire.GetSize() / 2);

    // Draw the circle
    temp_item.SetEnd({ x: temp_item.GetStart().x + radius, y: temp_item.GetStart().y });

    this.PlotShape(temp_item);

    temp_item.SetShape(SHAPE_T.SEGMENT);

    radius = Math.trunc(aMire.GetSize() / 2);
    let dx1 = radius;
    let dy1 = 0;
    let dx2 = 0;
    let dy2 = radius;

    if (aMire.GetShape()) {
      // Shape X
      dx1 = dy1 = radius;
      dx2 = dx1;
      dy2 = -dy1;
    }

    const mirePos = aMire.GetPosition();

    // Draw the X or + temp_item:
    temp_item.SetStart({ x: mirePos.x - dx1, y: mirePos.y - dy1 });
    temp_item.SetEnd({ x: mirePos.x + dx1, y: mirePos.y + dy1 });
    this.PlotShape(temp_item);

    temp_item.SetStart({ x: mirePos.x - dx2, y: mirePos.y - dy2 });
    temp_item.SetEnd({ x: mirePos.x + dx2, y: mirePos.y + dy2 });
    this.PlotShape(temp_item);
  }

  PlotFootprintGraphicItems(aFootprint: FOOTPRINT): void {
    const variantName = this.m_board ? this.m_board.GetCurrentVariant() : '';
    const dnp = aFootprint.GetDNPForVariant(variantName);

    for (const item of aFootprint.GraphicalItems()) {
      const itemLayer = item.GetLayer();

      if (aFootprint.GetPrivateLayers().test(itemLayer)) continue;

      if (dnp && this.hideDNPItems(itemLayer)) continue;

      if (!this.m_layerMask.and(item.GetLayerSet()).any()) continue;

      switch (item.Type()) {
        case KICAD_T.PCB_SHAPE_T:
          this.PlotShape(item as PCB_SHAPE);
          break;

        case KICAD_T.PCB_TEXTBOX_T: {
          const textbox = item as unknown as PCB_TEXTBOX;

          this.m_plotter.SetTextMode(PLOT_TEXT_MODE.STROKE);

          this.PlotText(
            textbox,
            textbox.GetLayer(),
            textbox.IsKnockout(),
            textbox.GetFontMetrics(),
          );

          if (textbox.IsBorderEnabled()) this.PlotShape(textbox);

          this.m_plotter.SetTextMode(this.GetTextMode());
          break;
        }

        case KICAD_T.PCB_BARCODE_T:
          this.PlotBarCode(item as unknown as PCB_BARCODE);
          break;

        case KICAD_T.PCB_TABLE_T: {
          const table = item as unknown as PCB_TABLE;

          this.m_plotter.SetTextMode(PLOT_TEXT_MODE.STROKE);

          for (const cell of table.GetCells())
            this.PlotText(cell, cell.GetLayer(), cell.IsKnockout(), cell.GetFontMetrics());

          this.PlotTableBorders(table);

          this.m_plotter.SetTextMode(this.GetTextMode());
          break;
        }

        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        case KICAD_T.PCB_DIM_LEADER_T:
          this.PlotDimension(item as unknown as PCB_DIMENSION_BASE);
          break;

        case KICAD_T.PCB_TEXT_T:
          // Plotted in PlotFootprintTextItems()
          break;

        case KICAD_T.PCB_REFERENCE_IMAGE_T:
          // Not plotted at all
          break;

        default:
          // UNIMPLEMENTED_FOR( item->GetClass() )
          break;
      }
    }
  }

  PlotText(
    aText: PLOTTED_TEXT,
    aLayer: PCB_LAYER_ID,
    aIsKnockout: boolean,
    aFontMetrics: METRICS,
    aStrikeout = false,
  ): void {
    const maxError = this.m_board.GetDesignSettings().m_MaxError;
    const font = aText.GetDrawFont(this.renderSettings());
    const shownText = aText.GetShownText(true);

    if (shownText === '') return;

    if (!this.m_layerMask.test(aLayer)) return;

    const gbr_metadata = new GBR_METADATA();

    if (IsCopperLayer(aLayer))
      gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_NONCONDUCTOR);

    const color = this.getColor(aLayer);
    this.m_plotter.SetColor(color);

    const pos = aText.GetTextPos();

    const attrs = Object.assign(new TEXT_ATTRIBUTES(), aText.GetAttributes());
    attrs.m_StrokeWidth = aText.GetEffectiveTextPenWidth();
    attrs.m_Angle = aText.GetDrawRotation();
    attrs.m_Multiline = false;

    this.m_plotter.SetCurrentLineWidth(attrs.m_StrokeWidth);

    const strikeoutText = (text: PCB_TEXT): void => {
      const textPoly = new SHAPE_POLY_SET();

      text.TransformTextToPolySet(textPoly, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_INSIDE);
      textPoly.Rotate(text.GetDrawRotation().negate(), text.GetDrawPos());

      const rect = textPoly.BBox();
      let start = {
        x: rect.GetLeft() - attrs.m_StrokeWidth,
        y: Math.trunc((rect.GetTop() + rect.GetBottom()) / 2),
      };
      let end = {
        x: rect.GetRight() + attrs.m_StrokeWidth,
        y: Math.trunc((rect.GetTop() + rect.GetBottom()) / 2),
      };

      start = RotatePoint(start, text.GetDrawPos(), text.GetDrawRotation());
      end = RotatePoint(end, text.GetDrawPos(), text.GetDrawRotation());

      this.m_plotter.ThickSegment(start, end, attrs.m_StrokeWidth, this.metadata(gbr_metadata));
    };

    if (aIsKnockout) {
      const finalPoly = new SHAPE_POLY_SET();
      const withPolys = aText as unknown as {
        TransformTextToPolySet?(
          aBuffer: SHAPE_POLY_SET,
          aClearance: number,
          aMaxError: number,
          aErrorLoc: ERROR_LOC,
        ): void;
      };

      withPolys.TransformTextToPolySet?.(finalPoly, 0, maxError, ERROR_LOC.ERROR_INSIDE);

      finalPoly.Fracture();

      for (let ii = 0; ii < finalPoly.OutlineCount(); ++ii)
        this.m_plotter.PlotPolyLineChain(
          finalPoly.Outline(ii),
          FILL_T.FILLED_SHAPE,
          0,
          this.metadata(gbr_metadata),
        );
    } else if (font.IsOutline() && !this.m_board.GetEmbeddedFiles().GetAreFontsEmbedded()) {
      const callback_gal = new CALLBACK_GAL(
        // Stroke callback
        (aPt1, aPt2) => {
          this.m_plotter.ThickSegment(aPt1, aPt2, attrs.m_StrokeWidth, this.metadata(gbr_metadata));
        },
        // Polygon callback
        (aPoly: SHAPE_LINE_CHAIN) => {
          this.m_plotter.PlotPolyLineChain(
            aPoly,
            FILL_T.FILLED_SHAPE,
            0,
            this.metadata(gbr_metadata),
          );
        },
      );

      callback_gal.DrawGlyphs(aText.GetRenderCache(font, shownText) ?? []);
    } else if (aText.IsMultilineAllowed()) {
      const positions: VECTOR2I[] = [];
      const strings_list = wxStringSplit(shownText, '\n');

      aText.GetLinePositions(this.renderSettings(), positions, strings_list.length);

      for (let ii = 0; ii < strings_list.length; ii++) {
        this.m_plotter.PlotText(
          positions[ii]!,
          color,
          strings_list[ii]!,
          attrs,
          plotterFont(font, aFontMetrics),
          aFontMetrics,
          this.metadata(gbr_metadata),
        );
      }

      if (aStrikeout && strings_list.length === 1) strikeoutText(aText as unknown as PCB_TEXT);
    } else {
      this.m_plotter.PlotText(
        pos,
        color,
        shownText,
        attrs,
        plotterFont(font, aFontMetrics),
        aFontMetrics,
        this.metadata(gbr_metadata),
      );

      if (aStrikeout) strikeoutText(aText as unknown as PCB_TEXT);
    }
  }

  PlotZone(aZone: ZONE, aLayer: PCB_LAYER_ID, aPolysList: SHAPE_POLY_SET): void {
    if (aPolysList.IsEmpty()) return;

    const gbr_metadata = new GBR_METADATA();

    if (aZone.IsOnCopperLayer()) {
      gbr_metadata.SetNetName(aZone.GetNetname());
      gbr_metadata.SetCopper(true);

      // Zones with no net name can exist.
      // they are not used to connect items, so the aperture attribute cannot
      // be set as conductor
      if (aZone.GetNetname() === '') {
        gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_NONCONDUCTOR);
      } else {
        gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CONDUCTOR);
        gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_NET);
      }
    }

    this.m_plotter.SetColor(this.getColor(aLayer));

    this.m_plotter.StartBlock(null); // Clean current object attributes

    /*
     * In non filled mode the outline is plotted, but not the filling items
     */

    for (let idx = 0; idx < aPolysList.OutlineCount(); ++idx) {
      const outline = aPolysList.Outline(idx);

      // Plot the current filled area (as region for Gerber plotter to manage attributes)
      const gerberPlotter = this.gerber();

      if (gerberPlotter) {
        gerberPlotter.PlotGerberRegionLineChain(outline, gbr_metadata);
      } else if (this.m_plotter.GetPlotterType() === PLOT_FORMAT.DXF) {
        if (this.GetDXFPlotMode() === DXF_OUTLINE_MODE.FILLED)
          this.m_plotter.PlotPolyLineChain(
            outline,
            FILL_T.FILLED_SHAPE,
            0,
            this.metadata(gbr_metadata),
          );
      } else {
        this.m_plotter.PlotPolyLineChain(
          outline,
          FILL_T.FILLED_SHAPE,
          0,
          this.metadata(gbr_metadata),
        );
      }
    }

    this.m_plotter.EndBlock(null); // Clear object attributes
  }

  PlotShape(aShape: PCB_SHAPE): void {
    if (!this.m_layerMask.and(aShape.GetLayerSet()).any()) return;

    let thickness = aShape.GetWidth();
    const margin = { value: thickness }; // unclamped thickness (can be negative)
    const lineStyle = aShape.GetStroke().GetLineStyle();
    const onCopperLayer = LSET.AllCuMask().and(this.m_layerMask).any();
    const onSolderMaskLayer = new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask])
      .and(this.m_layerMask)
      .any();
    let isSolidFill = aShape.IsSolidFill();
    let isHatchedFill = aShape.IsHatchedFill();

    if (onSolderMaskLayer && aShape.HasSolderMask() && IsExternalCopperLayer(aShape.GetLayer())) {
      margin.value += 2 * aShape.GetSolderMaskExpansion();
      thickness = Math.max(margin.value, 0);

      if (isHatchedFill) {
        isSolidFill = true;
        isHatchedFill = false;
      }
    }

    this.m_plotter.SetColor(this.getColor(aShape.GetLayer()));

    const parentFP = aShape.GetParentFootprint();
    const gbr_metadata = new GBR_METADATA();
    const variantName = this.m_board ? this.m_board.GetCurrentVariant() : '';
    const parentDnp = parentFP ? parentFP.GetDNPForVariant(variantName) : false;

    if (parentFP) {
      gbr_metadata.SetCmpReference(parentFP.GetReference());
      gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_CMP);
    }

    if (parentFP && parentDnp && this.GetSketchDNPFPsOnFabLayers()) {
      if (aShape.GetLayer() === PCB_LAYER_ID.F_Fab || aShape.GetLayer() === PCB_LAYER_ID.B_Fab) {
        thickness = this.GetSketchPadLineWidth();
        isSolidFill = false;
        isHatchedFill = false;
      }
    }

    if (aShape.GetLayer() === PCB_LAYER_ID.Edge_Cuts) {
      gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_EDGECUT);
    } else if (onCopperLayer) {
      if (parentFP) {
        gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_ETCHEDCMP);
        gbr_metadata.SetCopper(true);
      } else if (aShape.GetNetCode() > 0) {
        gbr_metadata.SetCopper(true);
        gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CONDUCTOR);
        gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_NET);
        gbr_metadata.SetNetName(aShape.GetNetname());
      } else {
        // Graphic items (PCB_SHAPE, TEXT) having no net have the NonConductor attribute
        // Graphic items having a net have the Conductor attribute, but are not (yet?)
        // supported in Pcbnew
        gbr_metadata.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_NONCONDUCTOR);
      }
    }

    const md = this.metadata(gbr_metadata);
    const gerberPlotter = this.gerber();

    if (lineStyle <= LINE_STYLE.SOLID /* FIRST_TYPE */) {
      switch (aShape.GetShape()) {
        case SHAPE_T.SEGMENT:
          this.m_plotter.ThickSegment(aShape.GetStart(), aShape.GetEnd(), thickness, md);
          break;

        case SHAPE_T.CIRCLE:
          if (isSolidFill) {
            let diameter = aShape.GetRadius() * 2 + thickness;

            if (margin.value < 0) {
              diameter += margin.value;
              diameter = Math.max(diameter, 0);
            }

            this.m_plotter.FilledCircle(aShape.GetStart(), diameter, md);
          } else {
            this.m_plotter.ThickCircle(aShape.GetStart(), aShape.GetRadius() * 2, thickness, md);
          }

          break;

        case SHAPE_T.ARC:
          // when startAngle == endAngle ThickArc() doesn't know whether it's 0 deg and 360 deg
          // but it is a circle
          if (Math.abs(aShape.GetArcAngle().AsDegrees()) === 360.0) {
            this.m_plotter.ThickCircle(aShape.GetCenter(), aShape.GetRadius() * 2, thickness, md);
          } else {
            this.m_plotter.ThickArcShape(aShape, md, thickness);
          }

          break;

        case SHAPE_T.BEZIER:
          this.m_plotter.BezierCurve(
            aShape.GetStart(),
            aShape.GetBezierC1(),
            aShape.GetBezierC2(),
            aShape.GetEnd(),
            0,
            thickness,
          );
          break;

        case SHAPE_T.POLY:
          if (aShape.IsPolyShapeValid()) {
            if (
              this.m_plotter.GetPlotterType() === PLOT_FORMAT.DXF &&
              this.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH
            ) {
              this.m_plotter.ThickPoly(aShape.GetPolyShape(), thickness, md);
            } else {
              this.m_plotter.SetCurrentLineWidth(thickness, gbr_metadata);

              const origPoly = aShape.GetPolyShape();

              // Stroke the unfractured outline so degenerate near-zero-width
              // spikes (which Fracture() collapses but the editor still draws as
              // thick lines) are preserved in the plot output (issue #24143).
              if (thickness > 0) {
                for (let jj = 0; jj < origPoly.OutlineCount(); ++jj) {
                  this.m_plotter.PlotPolyLineChain(
                    origPoly.COutline(jj),
                    FILL_T.NO_FILL,
                    thickness,
                    md,
                  );
                }
              }

              if (!isSolidFill) break;

              // Fracture before plotting the fill to avoid invalid gerber regions
              // from self-intersecting or overlapping outlines.
              const tmpPoly = origPoly.CloneDropTriangulation();
              tmpPoly.Fracture();

              if (margin.value < 0)
                tmpPoly.Inflate(
                  Math.trunc(margin.value / 2),
                  CornerStrategy.ROUND_ALL_CORNERS,
                  aShape.GetMaxError(),
                );

              for (let jj = 0; jj < tmpPoly.OutlineCount(); ++jj) {
                const poly = tmpPoly.Outline(jj);
                poly.SetClosed(true);

                // Width 0; the stroke was already plotted from the unfractured outline.
                if (gerberPlotter) {
                  gerberPlotter.PlotPolyAsRegion(poly, FILL_T.FILLED_SHAPE, 0, gbr_metadata);
                } else {
                  this.m_plotter.PlotPolyLineChain(poly, FILL_T.FILLED_SHAPE, 0, md);
                }
              }
            }
          }

          break;

        case SHAPE_T.RECTANGLE: {
          let radius = aShape.GetCornerRadius();

          if (
            radius === 0 &&
            this.m_plotter.GetPlotterType() === PLOT_FORMAT.DXF &&
            this.GetDXFPlotMode() === DXF_OUTLINE_MODE.SKETCH
          ) {
            const pts = aShape.GetRectCorners();
            this.m_plotter.ThickRect(pts[0]!, pts[2]!, thickness, md);
          } else {
            const box = new BOX2I(aShape.GetStart(), {
              x: aShape.GetEnd().x - aShape.GetStart().x,
              y: aShape.GetEnd().y - aShape.GetStart().y,
            });
            box.Normalize();

            if (margin.value < 0) {
              box.Inflate(margin.value);
              radius += margin.value;
            }

            const rect = new SHAPE_RECT(box);
            rect.SetRadius(radius);

            const outline = rect.Outline();
            const poly = new SHAPE_POLY_SET(outline);

            const fill_mode = isSolidFill ? FILL_T.FILLED_SHAPE : FILL_T.NO_FILL;

            if (poly.OutlineCount() > 0) {
              if (gerberPlotter) {
                gerberPlotter.PlotPolyAsRegion(
                  poly.COutline(0),
                  fill_mode,
                  thickness,
                  gbr_metadata,
                );
              } else {
                // TODO: PlotPoly needs to handle arcs...
                this.m_plotter.PlotPolyLineChain(poly.COutline(0), fill_mode, thickness, md);
              }
            }
          }

          break;
        }

        default:
          // UNIMPLEMENTED_FOR( aShape->SHAPE_T_asString() )
          break;
      }
    } else {
      const shapes = aShape.MakeEffectiveShapes(true);
      const renderSettings = this.m_plotter.RenderSettings();

      for (const shape of shapes) {
        STROKE_PARAMS.Stroke(shape, lineStyle, aShape.GetWidth(), renderSettings!, (a, b) => {
          this.m_plotter.ThickSegment(a, b, thickness, md);
        });
      }
    }

    if (isHatchedFill) {
      for (let ii = 0; ii < aShape.GetHatching().OutlineCount(); ++ii) {
        if (gerberPlotter) {
          gerberPlotter.PlotPolyAsRegion(
            aShape.GetHatching().Outline(ii),
            FILL_T.FILLED_SHAPE,
            0,
            gbr_metadata,
          );
        } else {
          this.m_plotter.PlotPolyLineChain(
            aShape.GetHatching().Outline(ii),
            FILL_T.FILLED_SHAPE,
            0,
            md,
          );
        }
      }
    }
  }

  PlotBarCode(aBarCode: PCB_BARCODE): void {
    if (!this.m_layerMask.test(aBarCode.GetLayer())) return;

    // To avoid duplicate code, build a PCB_SHAPE to plot the polygon shape
    const dummy = new PCB_SHAPE(aBarCode.GetParent(), SHAPE_T.POLY);
    dummy.SetLayer(aBarCode.GetLayer());
    dummy.SetFillMode(FILL_T.FILLED_SHAPE);
    dummy.SetWidth(0);

    const shape = new SHAPE_POLY_SET();
    aBarCode.TransformShapeToPolySet(shape, aBarCode.GetLayer(), 0, 0, ERROR_LOC.ERROR_INSIDE);
    dummy.SetPolyShape(shape);

    this.PlotShape(dummy);
  }

  PlotTableBorders(aTable: PCB_TABLE): void {
    if (!this.m_layerMask.test(aTable.GetLayer())) return;

    const gbr_metadata = new GBR_METADATA();
    const parentFP = aTable.GetParentFootprint();

    if (parentFP) {
      gbr_metadata.SetCmpReference(parentFP.GetReference());
      gbr_metadata.SetNetAttribType(GBR_NETINFO_TYPE.GBR_NETINFO_CMP);
    }

    const md = this.metadata(gbr_metadata);

    aTable.DrawBorders((ptA, ptB, stroke) => {
      const lineWidth = stroke.GetWidth();
      const lineStyle = stroke.GetLineStyle();

      if (lineStyle <= LINE_STYLE.SOLID /* FIRST_TYPE */) {
        this.m_plotter.ThickSegment(ptA, ptB, lineWidth, md);
      } else {
        const seg = new SHAPE_SEGMENT(ptA, ptB);

        STROKE_PARAMS.Stroke(
          seg,
          lineStyle,
          lineWidth,
          this.m_plotter.RenderSettings()!,
          (a, b) => {
            this.m_plotter.ThickSegment(a, b, lineWidth, md);
          },
        );
      }
    });
  }

  private plotOneDrillMark(
    aDrillShape: PAD_DRILL_SHAPE,
    aDrillPos: VECTOR2I,
    aDrillSize: VECTOR2I,
    aPadSize: VECTOR2I,
    aOrientation: EDA_ANGLE,
    aSmallDrill: number,
  ): void {
    const drillSize = { x: aDrillSize.x, y: aDrillSize.y };

    // Small drill marks have no significance when applied to slots
    if (aSmallDrill && aDrillShape === PAD_DRILL_SHAPE.CIRCLE)
      drillSize.x = Math.min(aSmallDrill, drillSize.x);

    // Round holes only have x diameter, slots have both
    const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
    drillSize.x -= this.getFineWidthAdj();
    drillSize.x = clamp(drillSize.x, 1, aPadSize.x - 1);

    if (aDrillShape === PAD_DRILL_SHAPE.OBLONG) {
      drillSize.y -= this.getFineWidthAdj();
      drillSize.y = clamp(drillSize.y, 1, aPadSize.y - 1);

      this.m_plotter.FlashPadOval(aDrillPos, drillSize, aOrientation, null);
    } else {
      this.m_plotter.FlashPadCircle(aDrillPos, drillSize.x, null);
    }
  }

  PlotDrillMarks(): void {
    let smallDrill = 0;

    if (this.GetDrillMarksType() === DRILL_MARKS.SMALL_DRILL_SHAPE)
      smallDrill = pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_SmallDrillMarkSize);

    /* Drill marks are drawn white-on-black to knock-out the underlying pad.  This works only
     * for drivers supporting color change, obviously... it means that:
       - PS, SVG and PDF output is correct (i.e. you have a 'donut' pad)
       - In gerbers you can't see them. This is arguably the right thing to do since having
         drill marks and high speed drill stations is a sure recipe for broken tools and angry
         manufacturers. If you *really* want them you could start a layer with negative
         polarity to knock-out the film.
       - In DXF they go into the 'WHITE' layer. This could be useful.
     */
    const notSketchDxf =
      this.m_plotter.GetPlotterType() !== PLOT_FORMAT.DXF ||
      this.GetDXFPlotMode() === DXF_OUTLINE_MODE.FILLED;

    if (notSketchDxf) this.m_plotter.SetColor(WHITE);

    for (const track of this.m_board.Tracks()) {
      if (track.Type() === KICAD_T.PCB_VIA_T) {
        const via = track as PCB_VIA;

        // Via are not always on all layers
        if (via.GetLayerSet().and(this.m_layerMask).none()) continue;

        this.plotOneDrillMark(
          PAD_DRILL_SHAPE.CIRCLE,
          via.GetStart(),
          { x: via.GetDrillValue(), y: 0 },
          { x: via.GetWidth(PADSTACK.ALL_LAYERS), y: 0 },
          ANGLE_0,
          smallDrill,
        );
      }
    }

    for (const footprint of this.m_board.Footprints()) {
      for (const pad of footprint.Pads()) {
        if (pad.GetDrillSize().x === 0) continue;

        // Skip marks on layers the pad isn't on for Gerber only (24416). Other
        // formats keep them as a drill map, e.g. Edge.Cuts (24867).
        if (
          this.m_plotter.GetPlotterType() === PLOT_FORMAT.GERBER &&
          pad.GetLayerSet().and(this.m_layerMask).none()
        )
          continue;

        if (notSketchDxf) {
          // Drill mark is in black unless we can find something to knock it out of
          this.m_plotter.SetColor(COLOR4D_BLACK);

          for (const layer of this.m_layerMask.Seq()) {
            if (!pad.IsOnLayer(layer)) continue;

            const padSize = pad.GetSize(layer);

            if (padSize.x > pad.GetDrillSizeX() || padSize.y > pad.GetDrillSizeY()) {
              this.m_plotter.SetColor(WHITE);
              break;
            }
          }
        }

        this.plotOneDrillMark(
          pad.GetDrillShape(),
          pad.GetPosition(),
          pad.GetDrillSize(),
          pad.GetSize(PADSTACK.ALL_LAYERS),
          pad.GetOrientation(),
          smallDrill,
        );
      }
    }

    if (notSketchDxf) this.m_plotter.SetColor(COLOR4D_BLACK);
  }
}
