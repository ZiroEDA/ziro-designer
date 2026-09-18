// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_painter.h` + `.cpp`: `KIGFX::PCB_RENDER_SETTINGS` and
 * `PCB_PAINTER`, the class that knows how every board item is drawn on the
 * GAL, and `PCB_DISPLAY_OPTIONS` (`include/pcb_display_options.h`).
 */

import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import {
  ANGLE_90,
  ANGLE_360,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
  EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ROUNDRECT } from '@ziroeda/kimath/src/geometry/roundrect.js';
import type { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { type SHAPE, SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import type { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import type { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import type { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  Perpendicular,
  ResizeI,
  type Vec2,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { ADVANCED_CFG } from '@ziroeda/common/src/advanced_config.js';
import {
  brightened,
  type Color4d,
  COLOR4D_BLACK,
  COLOR4D_WHITE,
  darkened,
  inverted,
  brightness,
  mix,
  withAlpha,
} from '@ziroeda/common/src/color4d.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { FONT } from '@ziroeda/common/src/font/font.js';
import type { METRICS } from '@ziroeda/common/src/font/font_metrics.js';
import type { GLYPH_LIKE } from '@ziroeda/common/src/font/glyph.js';
import {
  GR_TEXT_H_ALIGN_T,
  GR_TEXT_V_ALIGN_T,
  TEXT_ATTRIBUTES,
} from '@ziroeda/common/src/font/text_attributes.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import type { GAL } from '@ziroeda/common/src/gal/graphics_abstraction_layer.js';
import {
  GAL_SCOPED_ATTRS,
  GAL_SCOPED_ATTRS_FLAGS,
} from '@ziroeda/common/src/gal/graphics_abstraction_layer.js';
import { PAINTER } from '@ziroeda/common/src/gal/painter.js';
import { GetPenSizeForNormal } from '@ziroeda/common/src/gr_text.js';
import {
  B_Cu,
  B_Mask,
  B_Paste,
  Edge_Cuts,
  F_Cu,
  F_Mask,
  F_Paste,
  GAL_LAYER_ID,
  GetNetnameLayer,
  IsClearanceLayer,
  IsCopperLayer,
  IsExternalCopperLayer,
  IsHoleLayer,
  IsNetnameLayer,
  IsPadCopperLayer,
  IsPcbLayer,
  IsPointsLayer,
  IsSolderMaskLayer,
  IsViaCopperLayer,
  IsZoneFillLayer,
  LAYER_ANCHOR,
  LAYER_CLEARANCE_START,
  LAYER_CONFLICTS_SHADOW,
  LAYER_CURSOR,
  LAYER_DRC_ERROR,
  LAYER_DRC_EXCLUSION,
  LAYER_DRC_SHAPES,
  LAYER_DRC_WARNING,
  LAYER_GRID,
  LAYER_LOCKED_ITEM_SHADOW,
  LAYER_MARKER_SHADOWS,
  LAYER_NON_PLATEDHOLES,
  LAYER_PAD_BK_NETNAMES,
  LAYER_PAD_COPPER_START,
  LAYER_PAD_FR_NETNAMES,
  LAYER_PAD_HOLEWALLS,
  LAYER_PAD_NETNAMES,
  LAYER_PAD_PLATEDHOLES,
  LAYER_PADS,
  LAYER_PCB_BACKGROUND,
  LAYER_POINTS,
  LAYER_VIA_BLIND,
  LAYER_VIA_BURIED,
  LAYER_VIA_COPPER_START,
  LAYER_VIA_HOLES,
  LAYER_VIA_HOLEWALLS,
  LAYER_VIA_MICROVIA,
  LAYER_VIA_THROUGH,
  LAYER_ZONE_START,
  NETNAMES_LAYER_ID,
  PCB_LAYER_ID,
  ToLAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { PgmOrNull } from '@ziroeda/common/src/pgm_base.js';
import { RENDER_SETTINGS } from '@ziroeda/common/src/render_settings.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/src/settings/color_settings.js';
import { printableCharCount, unescapeString } from '@ziroeda/common/src/string_utils.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/src/stroke_params.js';
import type { VIEW_ITEM } from '@ziroeda/common/src/view/view_item.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { BOARD_ITEM } from './board_item.js';
import { BOARD_USE } from './board.js';
import { HIGH_CONTRAST_MODE, NET_COLOR_MODE, ZONE_DISPLAY_MODE } from './board_project_settings.js';
import type { FOOTPRINT } from './footprint.js';
import { NETINFO_LIST } from './netinfo.js';
import { PAD } from './pad.js';
import { PAD_ATTRIB, type PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK_MODE } from './padstack.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_BOARD_OUTLINE } from './pcb_board_outline.js';
import type { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import type { PCB_FIELD } from './pcb_field.js';
import type { PCB_GROUP } from './pcb_group.js';
import type { PCB_MARKER } from './pcb_marker.js';
import type { PCB_POINT } from './pcb_point.js';
import type { PCB_REFERENCE_IMAGE } from './pcb_reference_image.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TABLECELL } from './pcb_table.js';
import type { PCB_TARGET } from './pcb_target.js';
import { PCB_TEXT } from './pcb_text.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import { type PCB_ARC, type PCB_TRACK, PCB_VIA, VIATYPE } from './pcb_track.js';
import {
  type PCB_VIEWERS_SETTINGS_BASE,
  PCBNEW_SETTINGS,
  SHOW_WITH_VIA_ALWAYS,
} from './pcbnew_settings.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import type { ZONE } from './zone.js';
import { ZONE_BORDER_DISPLAY_STYLE } from './zone_settings.js';

const COLOR4D = (r: number, g: number, b: number, a: number): Color4d => ({ r, g, b, a });
/** `COLOR4D::CLEAR`. */
const COLOR4D_CLEAR = COLOR4D(1, 0, 1, 0);
/** `COLOR4D::UNSPECIFIED`. */
const COLOR4D_UNSPECIFIED = COLOR4D(0, 0, 0, 0);
/** `COLOR4D( MAGENTA )`, `COLOR4D( CYAN )`: the legacy table's. */
const COLOR4D_MAGENTA = COLOR4D(0.52, 0.0, 0.52, 1.0);
const COLOR4D_CYAN = COLOR4D(0.0, 0.52, 0.52, 1.0);

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * `include/pcb_display_options.h`: the display options a frame hands the
 * render settings.
 */
export class PCB_DISPLAY_OPTIONS {
  /// @see ZONE_DISPLAY_MODE - stored in the project
  m_ZoneDisplayMode: ZONE_DISPLAY_MODE;

  /// How inactive layers are displayed.  @see HIGH_CONTRAST_MODE - stored in the project
  m_ContrastModeDisplay: HIGH_CONTRAST_MODE;

  /// How to use color overrides on specific nets and netclasses
  m_NetColorMode: NET_COLOR_MODE;

  // These opacity overrides multiply with any opacity in the base layer color

  m_TrackOpacity: number; ///< Opacity override for all tracks
  m_ViaOpacity: number; ///< Opacity override for all types of via
  m_PadOpacity: number; ///< Opacity override for SMD pads and PTHs
  m_ZoneOpacity: number; ///< Opacity override for filled zone areas
  m_ImageOpacity: number; ///< Opacity override for user images
  m_FilledShapeOpacity: number; ///< Opacity override for graphic shapes

  m_FlipBoardView = false; ///< true if the board is flipped to show the mirrored view

  constructor() {
    this.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_FILLED;
    this.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.NORMAL;
    this.m_NetColorMode = NET_COLOR_MODE.RATSNEST;
    this.m_TrackOpacity = 1.0;
    this.m_ViaOpacity = 1.0;
    this.m_PadOpacity = 1.0;
    this.m_ZoneOpacity = 1.0;
    this.m_ImageOpacity = 1.0;
    this.m_FilledShapeOpacity = 1.0;
  }
}

/** `pcbconfig()`: `Kiface().KifaceSettings()` in pcbnew's kiface. */
function pcbconfig(): PCBNEW_SETTINGS | null {
  return PgmOrNull()?.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew') ?? null;
}

/**
 * PCB specific render settings.
 */
export class PCB_RENDER_SETTINGS extends RENDER_SETTINGS {
  /** `friend class PCB_PAINTER`: the painter reads the protected members. */

  m_ForcePadSketchModeOn: boolean;
  m_ForceShowFieldsWhenFPSelected: boolean;
  m_ZoneDisplayMode: ZONE_DISPLAY_MODE;
  m_ContrastModeDisplay: HIGH_CONTRAST_MODE;
  m_PadEditModePad: PAD | null; // Pad currently in Pad Edit Mode (if any)

  ///< Maximum font size for netnames (and other dynamically shown strings)
  static readonly MAX_FONT_SIZE = pcbIUScale.mmToIU(10.0);

  ///< How to display nets and netclasses with color overrides
  m_netColorMode: NET_COLOR_MODE;

  ///< Overrides for specific netclass colors
  m_netclassColors: Map<string, Color4d> = new Map();

  ///< Overrides for specific net colors, stored as netcodes for the ratsnest to access easily
  m_netColors: Map<number, Color4d> = new Map();

  ///< Set of net codes that should not have their ratsnest displayed
  m_hiddenNets: Set<number> = new Set();

  // These opacity overrides multiply with any opacity in the base layer color
  m_trackOpacity: number; ///< Opacity override for all tracks
  m_viaOpacity: number; ///< Opacity override for all types of via
  m_padOpacity: number; ///< Opacity override for SMD pads and PTHs
  m_zoneOpacity: number; ///< Opacity override for filled zones
  m_imageOpacity: number; ///< Opacity override for user images
  m_filledShapeOpacity: number; ///< Opacity override for graphic shapes

  constructor() {
    super();
    this.m_backgroundColor = COLOR4D(0.0, 0.0, 0.0, 1.0);
    this.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_FILLED;
    this.m_netColorMode = NET_COLOR_MODE.RATSNEST;
    this.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.NORMAL;

    this.m_trackOpacity = 1.0;
    this.m_viaOpacity = 1.0;
    this.m_padOpacity = 1.0;
    this.m_zoneOpacity = 1.0;
    this.m_imageOpacity = 1.0;
    this.m_filledShapeOpacity = 1.0;

    this.m_ForcePadSketchModeOn = false;

    this.m_PadEditModePad = null;

    this.SetDashLengthRatio(12); // From ISO 128-2
    this.SetGapLengthRatio(3); // From ISO 128-2

    this.m_ForceShowFieldsWhenFPSelected = true;

    this.update();
  }

  /**
   * Load settings related to display options (high-contrast mode, full or outline modes
   * for vias/pads/tracks and so on).
   *
   * @param aOptions are settings that you want to use for displaying items.
   */
  LoadDisplayOptions(aOptions: PCB_DISPLAY_OPTIONS): void {
    this.m_hiContrastEnabled = aOptions.m_ContrastModeDisplay !== HIGH_CONTRAST_MODE.NORMAL;
    this.m_ZoneDisplayMode = aOptions.m_ZoneDisplayMode;
    this.m_ContrastModeDisplay = aOptions.m_ContrastModeDisplay;
    this.m_netColorMode = aOptions.m_NetColorMode;

    this.m_trackOpacity = aOptions.m_TrackOpacity;
    this.m_viaOpacity = aOptions.m_ViaOpacity;
    this.m_padOpacity = aOptions.m_PadOpacity;
    this.m_zoneOpacity = aOptions.m_ZoneOpacity;
    this.m_imageOpacity = aOptions.m_ImageOpacity;
    this.m_filledShapeOpacity = aOptions.m_FilledShapeOpacity;
  }

  override LoadColors(aSettings: COLOR_SETTINGS | null): void {
    if (!aSettings) return;

    this.SetBackgroundColor(aSettings.GetColor(LAYER_PCB_BACKGROUND));

    // Init board layers colors:
    for (let i = 0; i < PCB_LAYER_ID.PCB_LAYER_ID_COUNT; i++) {
      let c = aSettings.GetColor(i);

      // Guard: if the alpha channel is too small, the layer is not visible.
      if (c.a < 0.2) c = { ...c, a: 0.2 };

      this.m_layerColors.set(i, c);
    }

    // Init specific graphic layers colors:
    for (let i = GAL_LAYER_ID.GAL_LAYER_ID_START; i < GAL_LAYER_ID.GAL_LAYER_ID_END; i++)
      this.m_layerColors.set(i, aSettings.GetColor(i));

    // Colors for layers that aren't theme-able
    this.m_layerColors.set(LAYER_PAD_PLATEDHOLES, aSettings.GetColor(LAYER_PCB_BACKGROUND));
    this.m_layerColors.set(
      LAYER_PAD_NETNAMES,
      aSettings.GetColor(NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_START),
    );

    // Netnames for copper layers
    const lightLabel = aSettings.GetColor(NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_START);
    const darkLabel = inverted(lightLabel);

    for (const layer of LSET.AllCuMask().CuStack()) {
      if (brightness(this.m_layerColors.get(layer)!) > 0.5)
        this.m_layerColors.set(GetNetnameLayer(layer), darkLabel);
      else this.m_layerColors.set(GetNetnameLayer(layer), lightLabel);
    }

    const pgm = PgmOrNull();

    if (pgm?.GetCommonSettings())
      // can be null if used without project (i.e. from python script)
      this.m_hiContrastFactor = Math.fround(
        1.0 - pgm.GetCommonSettings()!.m_Appearance.hicontrast_dimming_factor,
      );
    else this.m_hiContrastFactor = Math.fround(1.0 - 0.8); // default value

    this.update();
  }

  /// @copydoc RENDER_SETTINGS::GetColor()
  override GetColor(aItem: VIEW_ITEM | BOARD_ITEM | null, aLayer: number): Color4d {
    return this.GetColorForBoardItem(aItem instanceof BOARD_ITEM ? aItem : null, aLayer);
  }

  ///< Board-specific version
  GetColorForBoardItem(aItem: BOARD_ITEM | null, aLayer: number): Color4d {
    let netCode = -1;
    const originalLayer = aLayer;

    if (aLayer === LAYER_MARKER_SHADOWS) return withAlpha(this.m_backgroundColor, 0.6);

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW) return this.m_layerColors.get(aLayer)!;

    // SMD pads use the copper netname layer
    if (aLayer === LAYER_PAD_FR_NETNAMES) aLayer = GetNetnameLayer(F_Cu);
    else if (aLayer === LAYER_PAD_BK_NETNAMES) aLayer = GetNetnameLayer(B_Cu);

    if (IsHoleLayer(aLayer) && this.m_isPrinting) {
      // Careful that we don't end up with the same colour for the annular ring and the hole
      // when printing in B&W.
      const pad = aItem instanceof PAD ? aItem : null;
      const via = aItem instanceof PCB_VIA ? aItem : null;
      const holeLayer = aLayer;
      let annularRingLayer: number = PCB_LAYER_ID.UNDEFINED_LAYER;

      if (pad && pad.GetAttribute() === PAD_ATTRIB.PTH) {
        const copperLayers = pad.GetLayerSet().and(LSET.AllCuMask());

        if (copperLayers.any()) annularRingLayer = copperLayers.Seq()[0]!;
      } else if (via) {
        annularRingLayer = F_Cu;
      }

      if (annularRingLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        const it = this.m_layerColors.get(holeLayer);
        const it2 = this.m_layerColors.get(annularRingLayer);

        if (it !== undefined && it2 !== undefined && colorEquals(it, it2))
          aLayer = LAYER_PCB_BACKGROUND;
      }
    }

    // Zones should pull from the copper layer
    if (aItem && aItem.Type() === KICAD_T.PCB_ZONE_T) {
      if (IsZoneFillLayer(aLayer)) aLayer = aLayer - LAYER_ZONE_START;
    }

    // Points use the LAYER_POINTS color for their virtual per-layer layers
    if (IsPointsLayer(aLayer)) aLayer = LAYER_POINTS;

    // Pad and via copper and clearance outlines take their color from the copper layer
    if (IsPadCopperLayer(aLayer)) {
      if (pcbconfig() && aItem && aItem.Type() === KICAD_T.PCB_PAD_T) {
        const pad = aItem as PAD;

        // Old-skool display for people who struggle with change
        if (
          pcbconfig()!.m_Display.m_UseViaColorForNormalTHPadstacks &&
          pad.GetAttribute() === PAD_ATTRIB.PTH &&
          pad.Padstack().Mode() === PADSTACK_MODE.NORMAL
        ) {
          aLayer = LAYER_VIA_HOLES;
        } else {
          aLayer = aLayer - LAYER_PAD_COPPER_START;
        }
      } else {
        aLayer = aLayer - LAYER_PAD_COPPER_START;
      }
    } else if (IsViaCopperLayer(aLayer)) aLayer = aLayer - LAYER_VIA_COPPER_START;
    else if (IsClearanceLayer(aLayer)) aLayer = aLayer - LAYER_CLEARANCE_START;
    // Use via "golden copper" hole color for pad hole walls for contrast
    else if (aLayer === LAYER_PAD_HOLEWALLS) aLayer = LAYER_VIA_HOLES;

    // Show via mask layers if appropriate
    if (aLayer === LAYER_VIA_THROUGH && !this.m_isPrinting) {
      if (aItem?.GetBoard()) {
        const visibleLayers = aItem
          .GetBoard()!
          .GetVisibleLayers()
          .and(aItem.GetBoard()!.GetEnabledLayers())
          .and(aItem.GetLayerSet());

        if (this.GetActiveLayer() === F_Mask && visibleLayers.test(F_Mask)) {
          aLayer = F_Mask;
        } else if (this.GetActiveLayer() === B_Mask && visibleLayers.test(B_Mask)) {
          aLayer = B_Mask;
        } else if (visibleLayers.and(LSET.AllCuMask()).none()) {
          if (visibleLayers.any()) {
            const seq = visibleLayers.Seq();
            aLayer = seq[seq.length - 1]!;
          }
        }
      }
    }

    // Normal path: get the layer base color
    let it = this.m_layerColors.get(aLayer);
    let color: Color4d = it === undefined ? COLOR4D_WHITE : it;

    if (!aItem) return color;

    // Selection disambiguation
    if (aItem.IsBrightened()) return withAlpha(brightened(color, this.m_selectFactor), 0.8);

    // Normal selection
    if (aItem.IsSelected()) {
      // Selection for tables is done with a background wash, so pass in nullptr to GetColor()
      // so we just get the "normal" (un-selected/un-brightened) color for the borders.
      if (aItem.Type() !== KICAD_T.PCB_TABLE_T && aItem.Type() !== KICAD_T.PCB_TABLECELL_T) {
        const it_selected = this.m_layerColorsSel.get(aLayer);
        color = it_selected === undefined ? brightened(color, 0.8) : it_selected;
      }
    }

    // Some graphic objects are BOARD_CONNECTED_ITEM, but they are seen here as
    // actually board connected objects only if on a copper layer
    let conItem: BOARD_CONNECTED_ITEM | null = null;

    if (aItem.IsConnected() && aItem.IsOnCopperLayer())
      conItem = aItem as unknown as BOARD_CONNECTED_ITEM;

    // Try to obtain the netcode for the aItem
    if (conItem) netCode = conItem.GetNetCode();

    const highlighted = this.m_highlightEnabled && this.m_highlightNetcodes.has(netCode);
    const selected = aItem.IsSelected();

    // Apply net color overrides
    if (conItem && this.m_netColorMode === NET_COLOR_MODE.ALL && IsCopperLayer(aLayer)) {
      let netColor: Color4d = COLOR4D_UNSPECIFIED;

      const ii = this.m_netColors.get(netCode);

      if (ii !== undefined) netColor = ii;

      if (colorEquals(netColor, COLOR4D_UNSPECIFIED)) {
        const nc = conItem.GetEffectiveNetClass();

        if (nc.HasPcbColor()) netColor = nc.GetPcbColor();
      }

      if (colorEquals(netColor, COLOR4D_UNSPECIFIED)) netColor = color;

      if (selected) {
        // Selection brightening overrides highlighting
        netColor = brightened(netColor, this.m_selectFactor);
      } else if (this.m_highlightEnabled) {
        // Highlight brightens objects on all layers and darkens everything else for contrast
        if (highlighted) netColor = brightened(netColor, this.m_highlightFactor);
        else netColor = darkened(netColor, 1.0 - this.m_highlightFactor);
      }

      color = netColor;
    } else if (!selected && this.m_highlightEnabled) {
      // Single net highlight mode
      if (this.m_highlightNetcodes.has(netCode)) {
        const it_hi = this.m_layerColorsHi.get(aLayer);
        color = it_hi === undefined ? brightened(color, this.m_highlightFactor) : it_hi;
      } else {
        const it_dark = this.m_layerColorsDark.get(aLayer);
        color = it_dark === undefined ? darkened(color, 1.0 - this.m_highlightFactor) : it_dark;
      }
    }

    // Apply high-contrast dimming
    if (this.m_hiContrastEnabled && this.m_highContrastLayers.size && !highlighted && !selected) {
      const primary = this.GetPrimaryHighContrastLayer();
      let isActive = this.m_highContrastLayers.has(aLayer);
      let hide = false;

      switch (originalLayer) {
        case LAYER_PADS: {
          const pad = aItem as PAD;

          if (pad.IsOnLayer(primary) && !pad.FlashLayer(primary)) {
            isActive = false;

            if (IsCopperLayer(primary)) hide = true;
          }

          if (this.m_PadEditModePad && pad !== this.m_PadEditModePad) isActive = false;

          break;
        }

        case LAYER_VIA_BLIND:
        case LAYER_VIA_BURIED:
        case LAYER_VIA_MICROVIA: {
          const via = aItem as PCB_VIA;

          // Target graphic is active if the via crosses the primary layer
          if (!via.GetLayerSet().test(primary)) {
            isActive = false;
            hide = true;
          }

          break;
        }

        case LAYER_VIA_THROUGH: {
          const via = aItem as PCB_VIA;

          if (!via.FlashLayer(primary)) {
            isActive = false;

            if (IsCopperLayer(primary)) hide = true;
          }

          break;
        }

        case LAYER_PAD_PLATEDHOLES:
        case LAYER_PAD_HOLEWALLS:
        case LAYER_NON_PLATEDHOLES:
          // Pad holes are active is any physical layer is active
          if (!LSET.PhysicalLayersMask().test(primary)) isActive = false;

          break;

        case LAYER_VIA_HOLES:
        case LAYER_VIA_HOLEWALLS: {
          const via = aItem as PCB_VIA;

          if (via.GetViaType() === VIATYPE.THROUGH) {
            // A through via's hole is active if any physical layer is active
            if (!LSET.PhysicalLayersMask().test(primary)) isActive = false;
          } else {
            // A blind/buried or micro via's hole is active if it crosses the primary layer
            if (!via.GetLayerSet().test(primary)) isActive = false;
          }

          break;
        }

        case LAYER_DRC_ERROR:
        case LAYER_DRC_WARNING:
        case LAYER_DRC_EXCLUSION:
        case LAYER_DRC_SHAPES:
          isActive = true;
          break;

        default:
          break;
      }

      if (!isActive) {
        // Graphics on Edge_Cuts layer are not fully dimmed or hidden because they are
        // useful when working on another layer
        // We could use a dim factor = m_hiContrastFactor, but to have a sufficient
        // contrast whenever m_hiContrastFactor value, we clamp the factor to 0.3f
        // (arbitray choice after tests)
        const dim_factor_Edge_Cuts = Math.max(this.m_hiContrastFactor, Math.fround(0.3));

        if (
          this.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.HIDDEN ||
          IsNetnameLayer(aLayer) ||
          hide
        ) {
          if (originalLayer === Edge_Cuts) {
            it = this.m_layerColors.get(LAYER_PCB_BACKGROUND);

            if (it !== undefined) color = mix(color, it, dim_factor_Edge_Cuts);
            else color = mix(color, COLOR4D_BLACK, dim_factor_Edge_Cuts);
          } else color = COLOR4D_CLEAR;
        } else {
          it = this.m_layerColors.get(LAYER_PCB_BACKGROUND);
          const backgroundColor = it === undefined ? COLOR4D_BLACK : it;

          if (originalLayer === Edge_Cuts)
            color = mix(color, backgroundColor, dim_factor_Edge_Cuts);
          else color = mix(color, backgroundColor, this.m_hiContrastFactor);

          // Reference images can't have their color mixed so just reduce the opacity a bit
          // so they show through less
          if (aItem.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T)
            color = { ...color, a: color.a * this.m_hiContrastFactor };
        }
      }
    } else if (
      originalLayer === LAYER_VIA_BLIND ||
      originalLayer === LAYER_VIA_BURIED ||
      originalLayer === LAYER_VIA_MICROVIA
    ) {
      const via = aItem as PCB_VIA;
      const board = via.GetBoard()!;
      const visibleLayers = board.GetVisibleLayers().and(board.GetEnabledLayers());

      // Target graphic is visible if the via crosses a visible layer
      if (via.GetLayerSet().and(visibleLayers).none()) color = COLOR4D_CLEAR;
    }

    // Apply per-type opacity overrides
    if (aItem.Type() === KICAD_T.PCB_TRACE_T || aItem.Type() === KICAD_T.PCB_ARC_T)
      color = { ...color, a: color.a * this.m_trackOpacity };
    else if (aItem.Type() === KICAD_T.PCB_VIA_T)
      color = { ...color, a: color.a * this.m_viaOpacity };
    else if (aItem.Type() === KICAD_T.PCB_PAD_T)
      color = { ...color, a: color.a * this.m_padOpacity };
    else if (aItem.Type() === KICAD_T.PCB_ZONE_T && (aItem as ZONE).IsTeardropArea())
      color = { ...color, a: color.a * this.m_trackOpacity };
    else if (aItem.Type() === KICAD_T.PCB_ZONE_T)
      color = { ...color, a: color.a * this.m_zoneOpacity };
    else if (aItem.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T)
      color = { ...color, a: color.a * this.m_imageOpacity };
    else if (aItem.Type() === KICAD_T.PCB_SHAPE_T && (aItem as PCB_SHAPE).IsAnyFill())
      color = { ...color, a: color.a * this.m_filledShapeOpacity };
    else if (aItem.Type() === KICAD_T.PCB_SHAPE_T && aItem.IsOnCopperLayer())
      color = { ...color, a: color.a * this.m_trackOpacity };

    if (aItem.GetForcedTransparency() > 0.0)
      color = withAlpha(color, color.a * (1.0 - aItem.GetForcedTransparency()));

    // No special modifiers enabled
    return color;
  }

  override GetShowPageLimits(): boolean {
    return !!pcbconfig() && pcbconfig()!.m_ShowPageLimits;
  }

  override IsBackgroundDark(): boolean {
    const it = this.m_layerColors.get(LAYER_PCB_BACKGROUND);

    if (it === undefined) return false;

    return brightness(it) < 0.5;
  }

  GetBackgroundColor(): Color4d {
    const it = this.m_layerColors.get(LAYER_PCB_BACKGROUND);
    return it === undefined ? COLOR4D_BLACK : it;
  }

  SetBackgroundColor(aColor: Color4d): void {
    this.m_layerColors.set(LAYER_PCB_BACKGROUND, aColor);
  }

  GetGridColor(): Color4d {
    return this.mapAt(LAYER_GRID);
  }

  GetCursorColor(): Color4d {
    return this.mapAt(LAYER_CURSOR);
  }

  /** `m_layerColors[ aLayer ]`: a std::map creates a black entry on first access. */
  private mapAt(aLayer: number): Color4d {
    let c = this.m_layerColors.get(aLayer);
    if (c === undefined) {
      c = COLOR4D(0, 0, 0, 1);
      this.m_layerColors.set(aLayer, c);
    }
    return c;
  }

  GetNetColorMode(): NET_COLOR_MODE {
    return this.m_netColorMode;
  }
  SetNetColorMode(aMode: NET_COLOR_MODE): void {
    this.m_netColorMode = aMode;
  }

  GetNetColorMap(): Map<number, Color4d> {
    return this.m_netColors;
  }

  GetHiddenNets(): Set<number> {
    return this.m_hiddenNets;
  }
}

/**
 * Contains methods for drawing PCB-specific items.
 */
export class PCB_PAINTER extends PAINTER {
  protected m_pcbSettings: PCB_RENDER_SETTINGS;
  protected m_frameType: FRAME_T;
  protected m_maxError: number;
  protected m_holePlatingThickness: number;
  protected m_lockedShadowMargin: number;

  constructor(aGal: GAL | null, aFrameType: FRAME_T) {
    super(aGal);
    this.m_pcbSettings = new PCB_RENDER_SETTINGS();
    this.m_frameType = aFrameType;
    this.m_maxError = ARC_HIGH_DEF;
    this.m_holePlatingThickness = 0;
    this.m_lockedShadowMargin = 0;
  }

  /// @copydoc PAINTER::GetSettings()
  GetSettings(): PCB_RENDER_SETTINGS {
    return this.m_pcbSettings;
  }

  // Helpers for display options existing in Cvpcb and Pcbnew
  // Note, when running Cvpcb, pcbconfig() returns nullptr and viewer_settings()
  // returns the viewer options existing to Cvpcb and Pcbnew
  protected viewer_settings(): PCB_VIEWERS_SETTINGS_BASE {
    const mgr = PgmOrNull()?.GetSettingsManager();

    switch (this.m_frameType) {
      case FRAME_T.FRAME_FOOTPRINT_EDITOR:
      case FRAME_T.FRAME_FOOTPRINT_WIZARD:
        return (
          mgr?.GetAppSettings<PCB_VIEWERS_SETTINGS_BASE>('fpedit') ??
          PCB_PAINTER.defaultViewerSettings()
        );

      case FRAME_T.FRAME_FOOTPRINT_VIEWER:
      case FRAME_T.FRAME_FOOTPRINT_CHOOSER:
      case FRAME_T.FRAME_FOOTPRINT_PREVIEW:
      case FRAME_T.FRAME_CVPCB:
      case FRAME_T.FRAME_CVPCB_DISPLAY:
        return (
          mgr?.GetAppSettings<PCB_VIEWERS_SETTINGS_BASE>('cvpcb') ??
          PCB_PAINTER.defaultViewerSettings()
        );

      default:
        return (
          mgr?.GetAppSettings<PCBNEW_SETTINGS>('pcbnew') ?? PCB_PAINTER.defaultViewerSettings()
        );
    }
  }

  /**
   * `GetAppSettings<T>` creates the settings from their defaults when none are
   * loaded; the same object, made once.
   */
  private static s_defaultViewerSettings: PCBNEW_SETTINGS | null = null;

  private static defaultViewerSettings(): PCBNEW_SETTINGS {
    if (!PCB_PAINTER.s_defaultViewerSettings)
      PCB_PAINTER.s_defaultViewerSettings = new PCBNEW_SETTINGS();
    return PCB_PAINTER.s_defaultViewerSettings;
  }

  /**
   * Get the thickness to draw for a line (e.g. 0 thickness lines get a minimum value).
   *
   * @param aActualThickness line own thickness.
   * @return the thickness to draw.
   */
  protected getLineThickness(aActualThickness: number): number {
    // if items have 0 thickness, draw them with the outline
    // width, otherwise respect the set value (which, no matter
    // how small will produce something)
    if (aActualThickness === 0) return this.m_pcbSettings.GetOutlineWidth();

    return aActualThickness;
  }

  /**
   * Return drill shape of a pad.
   */
  protected getDrillShape(aPad: PAD): PAD_DRILL_SHAPE {
    return aPad.GetDrillShape();
  }

  /**
   * Return hole shape for a pad (internal units).
   */
  protected getPadHoleShape(aPad: PAD): SHAPE_SEGMENT {
    const segm = aPad.GetEffectiveHoleShape().Clone() as SHAPE_SEGMENT;
    return segm;
  }

  /**
   * Return drill diameter for a via (internal units).
   */
  protected getViaDrillSize(aVia: PCB_VIA): number {
    return aVia.GetDrillValue();
  }

  /// @copydoc PAINTER::Draw()
  Draw(aItem: VIEW_ITEM, aLayer: number): boolean {
    if (!aItem.IsBOARD_ITEM()) return false;

    const item = aItem as unknown as BOARD_ITEM;
    const board = item.GetBoard();

    if (board) {
      const bds = board.GetDesignSettings();
      this.m_maxError = bds.m_MaxError;
      this.m_holePlatingThickness = bds.GetHolePlatingThickness();
      this.m_lockedShadowMargin = bds.GetLineThickness(PCB_LAYER_ID.F_SilkS) * 4;

      if (item.GetParentFootprint() && !board.IsFootprintHolder()) {
        const parentFP = item.GetParentFootprint()!;

        // Never draw footprint reference images on board
        if (item.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T) {
          return false;
        }

        if (item.GetLayerSet().count() > 1) {
          // For multi-layer objects, exclude only those layers that are private
          if (IsPcbLayer(aLayer) && parentFP.GetPrivateLayers().test(aLayer)) return false;
        } else if (item.GetLayerSet().count() === 1) {
          // For single-layer objects, exclude all layers including ancillary layers
          // such as holes, netnames, etc.
          const singleLayer = item.GetLayerSet().ExtractLayer();

          if (parentFP.GetPrivateLayers().test(singleLayer)) return false;
        }
      }
    } else {
      this.m_maxError = ARC_HIGH_DEF;
      this.m_holePlatingThickness = 0;
    }

    // the "cast" applied in here clarifies which overloaded draw() is called
    switch (item.Type()) {
      case KICAD_T.PCB_TRACE_T:
        this.drawTrack(item as PCB_TRACK, aLayer);
        break;

      case KICAD_T.PCB_ARC_T:
        this.drawArc(item as PCB_ARC, aLayer);
        break;

      case KICAD_T.PCB_VIA_T:
        this.drawVia(item as PCB_VIA, aLayer);
        break;

      case KICAD_T.PCB_PAD_T:
        this.drawPad(item as PAD, aLayer);
        break;

      case KICAD_T.PCB_SHAPE_T:
        this.drawShape(item as PCB_SHAPE, aLayer);
        break;

      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        this.drawReferenceImage(item as PCB_REFERENCE_IMAGE, aLayer);
        break;

      case KICAD_T.PCB_FIELD_T:
        this.drawField(item as PCB_FIELD, aLayer);
        break;

      case KICAD_T.PCB_TEXT_T:
        this.drawText(item as PCB_TEXT, aLayer);
        break;

      case KICAD_T.PCB_TEXTBOX_T:
        this.drawTextBox(item as PCB_TEXTBOX, aLayer);
        break;

      case KICAD_T.PCB_TABLE_T:
        this.drawTable(item as PCB_TABLE, aLayer);
        break;

      case KICAD_T.PCB_FOOTPRINT_T:
        this.drawFootprint(item as FOOTPRINT, aLayer);
        break;

      case KICAD_T.PCB_GROUP_T:
        this.drawGroup(item as PCB_GROUP, aLayer);
        break;

      case KICAD_T.PCB_ZONE_T:
        this.drawZone(item as ZONE, aLayer);
        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        this.drawDimension(item as PCB_DIMENSION_BASE, aLayer);
        break;

      case KICAD_T.PCB_BARCODE_T:
        this.drawBarcode(item as PCB_BARCODE, aLayer);
        break;

      case KICAD_T.PCB_TARGET_T:
        this.drawTarget(item as PCB_TARGET);
        break;

      case KICAD_T.PCB_POINT_T:
        this.drawPoint(item as PCB_POINT, aLayer);
        break;

      case KICAD_T.PCB_MARKER_T:
        this.drawMarker(item as PCB_MARKER, aLayer);
        break;

      case KICAD_T.PCB_BOARD_OUTLINE_T:
        this.drawBoardOutline(item as PCB_BOARD_OUTLINE, aLayer);
        break;

      default:
        // Painter does not know how to draw the object
        return false;
    }

    // Draw bounding boxes after drawing objects so they can be seen.
    if (this.m_pcbSettings.GetDrawBoundingBoxes()) {
      const gal = this.m_gal!;

      // Show bounding boxes of painted objects for debugging.
      const box = item.GetBoundingBox();

      gal.SetIsFill(false);
      gal.SetIsStroke(true);

      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        gal.SetStrokeColor(item.IsSelected() ? COLOR4D(1.0, 0.2, 0.2, 1) : COLOR4D_MAGENTA);
      } else {
        gal.SetStrokeColor(
          item.IsSelected() ? COLOR4D(1.0, 0.2, 0.2, 1) : COLOR4D(0.4, 0.4, 0.4, 1),
        );
      }

      gal.SetLineWidth(1);
      gal.DrawRectangle(box.GetOrigin(), box.GetEnd());

      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        gal.SetStrokeColor(item.IsSelected() ? COLOR4D(1.0, 0.2, 0.2, 1) : COLOR4D_CYAN);

        const fp = item as FOOTPRINT;

        if (fp) {
          const convex = fp.GetBoundingHull();

          gal.DrawPolyline(convex.COutline(0));
        }
      }
    }

    return true;
  }

  protected drawTrack(aTrack: PCB_TRACK, aLayer: number): void {
    const gal = this.m_gal!;
    const start: VECTOR2I = aTrack.GetStart();
    const end: VECTOR2I = aTrack.GetEnd();
    let track_width = aTrack.GetWidth();
    const color = this.m_pcbSettings.GetColorForBoardItem(aTrack, aLayer);

    if (IsNetnameLayer(aLayer)) {
      if (!pcbconfig() || pcbconfig()!.m_Display.m_NetNames < 2) return;

      if (aTrack.GetNetCode() <= NETINFO_LIST.UNCONNECTED) return;

      const trackShape = new SHAPE_SEGMENT(aTrack.GetStart(), aTrack.GetEnd(), aTrack.GetWidth());
      this.renderNetNameForSegment(trackShape, color, aTrack.GetDisplayNetname());
      return;
    }

    if (IsCopperLayer(aLayer) || IsSolderMaskLayer(aLayer) || aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      // Draw a regular track
      const outline_mode =
        !!pcbconfig() &&
        !pcbconfig()!.m_Display.m_DisplayPcbTrackFill &&
        aLayer !== LAYER_LOCKED_ITEM_SHADOW;
      gal.SetStrokeColor(color);
      gal.SetFillColor(color);
      gal.SetIsStroke(outline_mode);
      gal.SetIsFill(!outline_mode);
      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());

      if (IsSolderMaskLayer(aLayer))
        track_width = track_width + aTrack.GetSolderMaskExpansion() * 2;

      if (aLayer === LAYER_LOCKED_ITEM_SHADOW)
        track_width = track_width + this.m_lockedShadowMargin;

      gal.DrawSegment(start, end, track_width);
    }

    // Clearance lines
    if (
      IsClearanceLayer(aLayer) &&
      pcbconfig() &&
      pcbconfig()!.m_Display.m_TrackClearance === SHOW_WITH_VIA_ALWAYS &&
      !this.m_pcbSettings.IsPrinting()
    ) {
      const copperLayerForClearance = ToLAYER_ID(aLayer - LAYER_CLEARANCE_START);
      const clearance = aTrack.GetOwnClearance(copperLayerForClearance);

      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetStrokeColor(color);
      gal.DrawSegment(start, end, track_width + clearance * 2);
    }
  }

  protected renderNetNameForSegment(aSeg: SHAPE_SEGMENT, aColor: Color4d, aNetName: string): void {
    const gal = this.m_gal!;

    // When drawing netnames, clip the track to the viewport
    const screenSize = gal.GetScreenPixelSize();
    const matrix = gal.GetScreenWorldMatrix();
    const o = matrix.mulVec2({ x: 0, y: 0 });
    const e = matrix.mulVec2(screenSize);
    const viewport = {
      left: Math.min(o.x, e.x),
      top: Math.min(o.y, e.y),
      right: Math.max(o.x, e.x),
      bottom: Math.max(o.y, e.y),
    };
    const viewportWidth = viewport.right - viewport.left;
    const viewportHeight = viewport.bottom - viewport.top;
    const viewportContains = (p: Vec2): boolean =>
      p.x >= viewport.left &&
      p.x <= viewport.right &&
      p.y >= viewport.top &&
      p.y <= viewport.bottom;

    const num_char = [...aNetName].length;

    // Check if the track is long enough to have a netname displayed
    const seg_minlength = aSeg.GetWidth() * num_char;
    const seg_minlength_sq = seg_minlength * seg_minlength;

    if (aSeg.GetSeg().SquaredLength() < seg_minlength_sq) return;

    const textSize = aSeg.GetWidth();
    const penWidth = textSize / 12.0;
    let textOrientation: EDA_ANGLE;
    let num_names = 1;

    const start = aSeg.GetSeg().A;
    const end = aSeg.GetSeg().B;
    const segV = { x: end.x - start.x, y: end.y - start.y };

    if (end.y === start.y) {
      // horizontal
      textOrientation = ANGLE_HORIZONTAL;
      num_names = Math.max(num_names, KiROUND(aSeg.GetSeg().Length() / viewportWidth));
    } else if (end.x === start.x) {
      // vertical
      textOrientation = ANGLE_VERTICAL;
      num_names = Math.max(num_names, KiROUND(aSeg.GetSeg().Length() / viewportHeight));
    } else {
      textOrientation = EDA_ANGLE.fromVector(segV).negate();
      textOrientation = textOrientation.Normalize90();

      const min_size = Math.min(viewportWidth, viewportHeight);
      num_names = Math.max(num_names, KiROUND(aSeg.GetSeg().Length() / (Math.SQRT2 * min_size)));
    }

    gal.SetIsStroke(true);
    gal.SetIsFill(false);
    gal.SetStrokeColor(aColor);
    gal.SetLineWidth(penWidth);
    gal.SetFontBold(false);
    gal.SetFontItalic(false);
    gal.SetFontUnderlined(false);
    gal.SetTextMirrored(false);
    gal.SetGlyphSize({ x: Math.trunc(textSize * 0.55), y: Math.trunc(textSize * 0.55) });
    gal.SetHorizontalJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
    gal.SetVerticalJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

    const divisions = num_names + 1;

    for (let ii = 1; ii < divisions; ++ii) {
      const textPosition: VECTOR2I = {
        x: Math.trunc(start.x + segV.x * (ii / divisions)),
        y: Math.trunc(start.y + segV.y * (ii / divisions)),
      };

      if (viewportContains(textPosition)) gal.BitmapText(aNetName, textPosition, textOrientation);
    }
  }

  protected drawArc(aArc: PCB_ARC, aLayer: number): void {
    const gal = this.m_gal!;
    const center: Vec2 = aArc.GetCenter();
    let width = aArc.GetWidth();
    const color = this.m_pcbSettings.GetColorForBoardItem(aArc, aLayer);
    const radius = aArc.GetRadius();
    const start_angle = aArc.GetArcAngleStart();
    const angle = aArc.GetAngle();

    if (IsNetnameLayer(aLayer)) {
      if (!pcbconfig() || pcbconfig()!.m_Display.m_NetNames < 2) return;

      if (aArc.GetNetCode() <= NETINFO_LIST.UNCONNECTED) return;

      const netname = aArc.GetDisplayNetname();

      if (netname === '') return;

      // Arc length must accommodate the label width.
      const arcLen = Math.abs(radius * angle.AsRadians());

      if (arcLen < width * [...netname].length) return;

      // Tangent at the arc midpoint is perpendicular to the radius there.
      const midPt = aArc.GetMid();
      const c = aArc.GetCenter();
      const radial = { x: midPt.x - c.x, y: midPt.y - c.y };
      let textOrientation = EDA_ANGLE.fromVector({ x: -radial.y, y: radial.x });
      textOrientation = textOrientation.negate();
      textOrientation = textOrientation.Normalize90();

      const textSize = width;
      const penWidth = textSize / 12.0;

      gal.SetIsStroke(true);
      gal.SetIsFill(false);
      gal.SetStrokeColor(color);
      gal.SetLineWidth(penWidth);
      gal.SetFontBold(false);
      gal.SetFontItalic(false);
      gal.SetFontUnderlined(false);
      gal.SetTextMirrored(false);
      gal.SetGlyphSize({ x: Math.trunc(textSize * 0.55), y: Math.trunc(textSize * 0.55) });
      gal.SetHorizontalJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      gal.SetVerticalJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

      gal.BitmapText(netname, midPt, textOrientation);
      return;
    }

    if (IsCopperLayer(aLayer) || IsSolderMaskLayer(aLayer) || aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      // Draw a regular track
      const outline_mode =
        !!pcbconfig() &&
        !pcbconfig()!.m_Display.m_DisplayPcbTrackFill &&
        aLayer !== LAYER_LOCKED_ITEM_SHADOW;
      gal.SetStrokeColor(color);
      gal.SetFillColor(color);
      gal.SetIsStroke(outline_mode);
      gal.SetIsFill(!outline_mode);
      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());

      if (IsSolderMaskLayer(aLayer)) width = width + aArc.GetSolderMaskExpansion() * 2;

      if (aLayer === LAYER_LOCKED_ITEM_SHADOW) width = width + this.m_lockedShadowMargin;

      gal.DrawArcSegment(center, radius, start_angle, angle, width, this.m_maxError);
    }

    // Clearance lines
    if (
      IsClearanceLayer(aLayer) &&
      pcbconfig() &&
      pcbconfig()!.m_Display.m_TrackClearance === SHOW_WITH_VIA_ALWAYS &&
      !this.m_pcbSettings.IsPrinting()
    ) {
      /*
       * Showing the clearance area is not obvious for optionally-flashed pads and vias, so we
       * choose to not display clearance lines at all on non-copper active layers.  We follow
       * the same rule for tracks to be consistent (even though they don't have the same issue).
       */
      const activeLayer = this.m_pcbSettings.GetActiveLayer();
      const board = aArc.GetBoard()!;

      if (IsCopperLayer(activeLayer) && board.GetVisibleLayers().test(activeLayer)) {
        const clearance = aArc.GetOwnClearance(activeLayer);

        gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
        gal.SetIsFill(false);
        gal.SetIsStroke(true);
        gal.SetStrokeColor(color);

        gal.DrawArcSegment(
          center,
          radius,
          start_angle,
          angle,
          width + clearance * 2,
          this.m_maxError,
        );
      }
    }
  }

  protected drawVia(aVia: PCB_VIA, aLayer: number): void {
    const gal = this.m_gal!;
    const board = aVia.GetBoard()!;
    const color = this.m_pcbSettings.GetColorForBoardItem(aVia, aLayer);
    const center: Vec2 = aVia.GetStart();

    if (colorEquals(color, COLOR4D_CLEAR)) return;

    const copperLayer = IsViaCopperLayer(aLayer) ? aLayer - LAYER_VIA_COPPER_START : aLayer;
    const currentLayer = ToLAYER_ID(copperLayer);

    const pair = aVia.LayerPair();
    const layerTop = pair[0];
    const layerBottom = pair[1];

    // Blind/buried vias (and microvias) will use different hole and label rendering
    const isBlindBuried =
      aVia.GetViaType() === VIATYPE.BLIND ||
      aVia.GetViaType() === VIATYPE.BURIED ||
      (aVia.GetViaType() === VIATYPE.MICROVIA && (layerTop !== F_Cu || layerBottom !== B_Cu));

    // Draw description layer
    if (IsNetnameLayer(aLayer)) {
      const position: Vec2 = center;

      // Is anything that we can display enabled (netname and/or layers ids)?
      const showNets =
        !!pcbconfig() && pcbconfig()!.m_Display.m_NetNames !== 0 && aVia.GetNetname() !== '';
      const showLayers = aVia.GetViaType() !== VIATYPE.THROUGH;

      if (!showNets && !showLayers) return;

      const maxSize = PCB_RENDER_SETTINGS.MAX_FONT_SIZE;
      let size = aVia.GetWidth(currentLayer);

      // Font size limits
      if (size > maxSize) size = maxSize;

      gal.Save();
      gal.Translate(position);

      // Default font settings
      gal.ResetTextAttributes();
      gal.SetHorizontalJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      gal.SetVerticalJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
      gal.SetFontBold(false);
      gal.SetFontItalic(false);
      gal.SetFontUnderlined(false);
      gal.SetTextMirrored(false);
      gal.SetStrokeColor(this.m_pcbSettings.GetColorForBoardItem(aVia, aLayer));
      gal.SetIsStroke(true);
      gal.SetIsFill(false);

      // Set the text position via position. if only one text, it is on the via position
      // For 2 lines, the netname is slightly below the center, and the layer IDs above
      // the netname
      const textpos = { x: 0.0, y: 0.0 };

      const netname = aVia.GetDisplayNetname();

      const topLayerId = aVia.TopLayer();
      const bottomLayerId = aVia.BottomLayer();
      let topLayer: number; // The via top layer number (from 1 to copper layer count)
      let bottomLayer: number; // The via bottom layer number (from 1 to copper layer count)

      switch (topLayerId) {
        case F_Cu:
          topLayer = 1;
          break;
        case B_Cu:
          topLayer = board.GetCopperLayerCount();
          break;
        default:
          topLayer = Math.trunc((topLayerId - B_Cu) / 2) + 1;
          break;
      }

      switch (bottomLayerId) {
        case F_Cu:
          bottomLayer = 1;
          break;
        case B_Cu:
          bottomLayer = board.GetCopperLayerCount();
          break;
        default:
          bottomLayer = Math.trunc((bottomLayerId - B_Cu) / 2) + 1;
          break;
      }

      const layerIds = `${topLayer}-${bottomLayer}`;

      // a good size is set room for at least 6 chars, to be able to print 2 lines of text,
      // or at least 3 chars for only the netname
      // (The layerIds string has 5 chars max)
      const minCharCnt = showLayers ? 6 : 3;

      // approximate the size of netname and layerIds text:
      let tsize = (1.5 * size) / Math.max(printableCharCount(netname), minCharCnt);
      tsize = Math.min(tsize, size);
      // Use a smaller text size to handle interline, pen size..
      tsize *= 0.75;
      const namesize = { x: tsize, y: tsize };

      // For 2 lines, adjust the text pos (move it a small amount to the bottom)
      if (showLayers && showNets) textpos.y += (tsize * 1.3) / 2;

      gal.SetGlyphSize({ x: Math.trunc(namesize.x), y: Math.trunc(namesize.y) });
      gal.SetLineWidth(namesize.x / 10.0);

      if (showNets)
        gal.BitmapText(
          netname,
          { x: Math.trunc(textpos.x), y: Math.trunc(textpos.y) },
          ANGLE_HORIZONTAL,
        );

      if (showLayers) {
        if (showNets) textpos.y -= tsize * 1.3;

        gal.BitmapText(
          layerIds,
          { x: Math.trunc(textpos.x), y: Math.trunc(textpos.y) },
          ANGLE_HORIZONTAL,
        );
      }

      gal.Restore();

      return;
    }

    const outline_mode = !!pcbconfig() && !pcbconfig()!.m_Display.m_DisplayViaFill;

    gal.SetStrokeColor(color);
    gal.SetFillColor(color);
    gal.SetIsStroke(true);
    gal.SetIsFill(false);

    if (outline_mode) gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());

    if (aLayer === LAYER_VIA_HOLEWALLS) {
      let thickness =
        this.m_holePlatingThickness * ADVANCED_CFG.GetCfg().m_HoleWallPaintingMultiplier;
      const drillRadius = this.getViaDrillSize(aVia) / 2.0;
      const maxRadius = aVia.GetWidth(layerTop) / 2.0;
      let radius = drillRadius + thickness;

      // Clamp the hole wall so it doesn't extend beyond the via's copper
      if (radius > maxRadius) {
        radius = maxRadius;
        thickness = radius - drillRadius;
      }

      if (thickness <= 0) return;

      if (!outline_mode) {
        gal.SetLineWidth(thickness);
        radius -= thickness / 2.0;
      }

      // Underpaint the hole so that there aren't artifacts at its edge
      gal.SetIsFill(true);

      gal.DrawCircle(center, radius);

      // Draw backdrill indicators (semi-circles extending into the hole) on top of the
      // hole wall so they remain visible regardless of layer rendering order
      if (!this.m_pcbSettings.IsPrinting()) {
        const secDrill = aVia.GetSecondaryDrillSize();
        const terDrill = aVia.GetTertiaryDrillSize();

        if ((secDrill ?? 0) > 0) {
          this.drawBackdrillIndicator(
            aVia,
            center,
            secDrill!,
            aVia.GetSecondaryDrillStartLayer(),
            aVia.GetSecondaryDrillEndLayer(),
          );
        }

        if ((terDrill ?? 0) > 0) {
          this.drawBackdrillIndicator(
            aVia,
            center,
            terDrill!,
            aVia.GetTertiaryDrillStartLayer(),
            aVia.GetTertiaryDrillEndLayer(),
          );
        }
      }
    } else if (aLayer === LAYER_VIA_HOLES) {
      const radius = this.getViaDrillSize(aVia) / 2.0;

      gal.SetIsStroke(false);
      gal.SetIsFill(true);

      if (isBlindBuried && !this.m_pcbSettings.IsPrinting()) {
        gal.SetIsStroke(false);
        gal.SetIsFill(true);

        gal.SetFillColor(this.m_pcbSettings.GetColorForBoardItem(aVia, layerTop));
        gal.DrawArc(center, radius, new EDA_ANGLE(180), new EDA_ANGLE(180));

        gal.SetFillColor(this.m_pcbSettings.GetColorForBoardItem(aVia, layerBottom));
        gal.DrawArc(center, radius, new EDA_ANGLE(0), new EDA_ANGLE(180));
      } else {
        gal.DrawCircle(center, radius);
      }
    } else if (
      (aLayer === F_Mask && aVia.IsOnLayer(F_Mask)) ||
      (aLayer === B_Mask && aVia.IsOnLayer(B_Mask))
    ) {
      const margin = board.GetDesignSettings().m_SolderMaskExpansion;

      gal.SetIsFill(true);
      gal.SetIsStroke(false);

      gal.SetLineWidth(margin);
      gal.DrawCircle(center, aVia.GetWidth(currentLayer) / 2.0 + margin);
    } else if (this.m_pcbSettings.IsPrinting() || IsCopperLayer(currentLayer)) {
      const annular_width = Math.trunc(
        (aVia.GetWidth(currentLayer) - this.getViaDrillSize(aVia)) / 2.0,
      );
      let radius = aVia.GetWidth(currentLayer) / 2.0;
      let draw = false;

      if (this.m_pcbSettings.IsPrinting()) {
        draw = aVia.FlashLayer(this.m_pcbSettings.GetPrintLayers());
      } else if (aVia.IsSelected()) {
        draw = true;
      } else if (aVia.FlashLayer(board.GetVisibleLayers().and(board.GetEnabledLayers()))) {
        draw = true;
      }

      if (!aVia.FlashLayer(currentLayer)) draw = false;

      if (!outline_mode) {
        gal.SetLineWidth(annular_width);
        radius -= annular_width / 2.0;
      }

      if (draw) gal.DrawCircle(center, radius);

      // Draw post-machining indicator if this layer is post-machined
      if (!this.m_pcbSettings.IsPrinting() && draw) {
        this.drawPostMachiningIndicator(aVia, center, currentLayer);
      }
    } else if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      // draw a ring around the via
      gal.SetLineWidth(this.m_lockedShadowMargin);

      gal.DrawCircle(center, (aVia.GetWidth(currentLayer) + this.m_lockedShadowMargin) / 2.0);
    }

    // Clearance lines
    if (
      IsClearanceLayer(aLayer) &&
      pcbconfig() &&
      pcbconfig()!.m_Display.m_TrackClearance === SHOW_WITH_VIA_ALWAYS &&
      !this.m_pcbSettings.IsPrinting()
    ) {
      const copperLayerForClearance = ToLAYER_ID(aLayer - LAYER_CLEARANCE_START);
      let radius: number;

      if (aVia.FlashLayer(copperLayerForClearance))
        radius = aVia.GetWidth(copperLayerForClearance) / 2.0;
      else radius = this.getViaDrillSize(aVia) / 2.0 + this.m_holePlatingThickness;

      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetStrokeColor(color);
      gal.DrawCircle(center, radius + aVia.GetOwnClearance(copperLayerForClearance));
    }
  }

  protected drawPad(aPad: PAD, aLayer: number): void {
    const gal = this.m_gal!;
    let color = this.m_pcbSettings.GetColorForBoardItem(aPad, aLayer);
    const copperLayer = IsPadCopperLayer(aLayer) ? aLayer - LAYER_PAD_COPPER_START : aLayer;
    const pcbLayer = copperLayer as PCB_LAYER_ID;

    if (IsNetnameLayer(aLayer)) {
      const displayOpts = pcbconfig() ? pcbconfig()!.m_Display : null;
      let netname = '';
      let padNumber = '';

      // dynamic_cast<CVPCB_SETTINGS*>( viewer_settings() ): the cvpcb frame types
      const isCvpcb =
        this.m_frameType === FRAME_T.FRAME_CVPCB ||
        this.m_frameType === FRAME_T.FRAME_CVPCB_DISPLAY ||
        this.m_frameType === FRAME_T.FRAME_FOOTPRINT_VIEWER ||
        this.m_frameType === FRAME_T.FRAME_FOOTPRINT_CHOOSER ||
        this.m_frameType === FRAME_T.FRAME_FOOTPRINT_PREVIEW;

      if (this.viewer_settings().m_ViewersDisplay.m_DisplayPadNumbers) {
        padNumber = unescapeString(aPad.GetNumber());

        if (isCvpcb) netname = aPad.GetPinFunction();
      }

      if (displayOpts && !isCvpcb) {
        if (displayOpts.m_NetNames === 1 || displayOpts.m_NetNames === 3)
          netname = aPad.GetDisplayNetname();

        if (aPad.IsNoConnectPad()) netname = 'x';
        else if (aPad.IsFreePad()) netname = '*';
      }

      if (netname === '' && padNumber === '') return;

      const padBBox = aPad.GetBoundingBox();
      let position: Vec2 = padBBox.Centre();
      let padsize: Vec2 = { ...padBBox.GetSize() };

      if (aPad.IsEntered()) {
        const fp = aPad.GetParentFootprint()!;

        // Find the number box
        for (const aItem of fp.GraphicalItems()) {
          if (aItem.Type() === KICAD_T.PCB_SHAPE_T) {
            const shape = aItem as PCB_SHAPE;

            if (shape.IsProxyItem() && shape.GetShape() === SHAPE_T.RECTANGLE) {
              position = shape.GetCenter();
              const br = shape.GetBotRight();
              const tl = shape.GetTopLeft();
              padsize = { x: br.x - tl.x, y: br.y - tl.y };

              // We normally draw a bit outside the pad, but this will be somewhat
              // unexpected when the user has drawn a box.
              padsize = { x: padsize.x * 0.9, y: padsize.y * 0.9 };

              break;
            }
          }
        }
      } else if (aPad.GetShape(pcbLayer) === PAD_SHAPE.CUSTOM) {
        // See if we have a number box
        for (const primitive of aPad.GetPrimitives(pcbLayer)) {
          if (primitive.IsProxyItem() && primitive.GetShape() === SHAPE_T.RECTANGLE) {
            let p: VECTOR2I = primitive.GetCenter();
            p = RotatePoint(p, aPad.GetOrientation());
            const sp = aPad.ShapePos(pcbLayer);
            position = { x: p.x + sp.x, y: p.y + sp.y };
            padsize = {
              x: Math.abs(primitive.GetBotRight().x - primitive.GetTopLeft().x),
              y: Math.abs(primitive.GetBotRight().y - primitive.GetTopLeft().y),
            };

            // We normally draw a bit outside the pad, but this will be somewhat
            // unexpected when the user has drawn a box.
            padsize = { x: padsize.x * 0.9, y: padsize.y * 0.9 };

            break;
          }
        }
      }

      if (aPad.GetShape(pcbLayer) !== PAD_SHAPE.CUSTOM) {
        // Don't allow a 45° rotation to bloat a pad's bounding box unnecessarily
        const limit = Math.min(aPad.GetSize(pcbLayer).x, aPad.GetSize(pcbLayer).y) * 1.1;

        if (padsize.x > limit && padsize.y > limit) {
          padsize = { x: limit, y: limit };
        }
      }

      const maxSize = PCB_RENDER_SETTINGS.MAX_FONT_SIZE;
      let size = padsize.y;

      gal.Save();
      gal.Translate(position);

      // Keep the size ratio for the font, but make it smaller
      if (padsize.x < padsize.y * 0.95) {
        gal.Rotate(-ANGLE_90.AsRadians());
        size = padsize.x;
        padsize = { x: padsize.y, y: padsize.x };
      }

      // Font size limits
      if (size > maxSize) size = maxSize;

      // Default font settings
      gal.ResetTextAttributes();
      gal.SetHorizontalJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      gal.SetVerticalJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
      gal.SetFontBold(false);
      gal.SetFontItalic(false);
      gal.SetFontUnderlined(false);
      gal.SetTextMirrored(false);
      gal.SetStrokeColor(this.m_pcbSettings.GetColorForBoardItem(aPad, aLayer));
      gal.SetIsStroke(true);
      gal.SetIsFill(false);

      // We have already translated the GAL to be centered at the center of the pad's
      // bounding box
      const textpos: VECTOR2I = { x: 0, y: 0 };

      // Divide the space, to display both pad numbers and netnames and set the Y text
      // offset position to display 2 lines
      let Y_offset_numpad = 0;
      let Y_offset_netname = 0;

      if (netname !== '' && padNumber !== '') {
        // The magic numbers are defined experimentally for a better look.
        size = size / 2.5;
        Y_offset_netname = Math.trunc(size / 1.4); // netname size is usually smaller than num pad
        // so the offset can be smaller
        Y_offset_numpad = Math.trunc(size / 1.7);
      }

      // We are using different fonts to display names, depending on the graphic
      // engine (OpenGL or Cairo).
      // Xscale_for_stroked_font adjust the text X size for cairo (stroke fonts) engine
      const Xscale_for_stroked_font = 0.9;

      if (netname !== '') {
        // approximate the size of net name text:
        // We use a size for at least 5 chars, to give a good look even for short names
        // (like VCC, GND...)
        let tsize = (1.5 * padsize.x) / Math.max(printableCharCount(netname) + 1, 5);
        tsize = Math.min(tsize, size);
        // Use a smaller text size to handle interline, pen size...
        tsize *= 0.85;

        // Round and oval pads have less room to display the net name than other
        // (i.e RECT) shapes, so reduce the text size for these shapes
        if (
          aPad.GetShape(pcbLayer) === PAD_SHAPE.CIRCLE ||
          aPad.GetShape(pcbLayer) === PAD_SHAPE.OVAL
        ) {
          tsize *= 0.9;
        }

        const namesize = { x: tsize * Xscale_for_stroked_font, y: tsize };
        textpos.y = Math.trunc(Math.min(tsize * 1.4, Y_offset_netname));

        gal.SetGlyphSize({ x: Math.trunc(namesize.x), y: Math.trunc(namesize.y) });
        gal.SetLineWidth(namesize.x / 6.0);
        gal.SetFontBold(true);
        gal.BitmapText(netname, textpos, ANGLE_HORIZONTAL);
      }

      if (padNumber !== '') {
        // approximate the size of the pad number text:
        // We use a size for at least 3 chars, to give a good look even for short numbers
        let tsize = (1.5 * padsize.x) / Math.max(printableCharCount(padNumber), 3);
        tsize = Math.min(tsize, size);
        // Use a smaller text size to handle interline, pen size...
        tsize *= 0.85;
        tsize = Math.min(tsize, size);
        const numsize = { x: tsize * Xscale_for_stroked_font, y: tsize };
        textpos.y = -Y_offset_numpad;

        gal.SetGlyphSize({ x: Math.trunc(numsize.x), y: Math.trunc(numsize.y) });
        gal.SetLineWidth(numsize.x / 6.0);
        gal.SetFontBold(true);
        gal.BitmapText(padNumber, textpos, ANGLE_HORIZONTAL);
      }

      gal.Restore();

      return;
    }

    if (aLayer === LAYER_PAD_HOLEWALLS) {
      gal.SetIsFill(true);
      gal.SetIsStroke(false);

      const widthFactor = ADVANCED_CFG.GetCfg().m_HoleWallPaintingMultiplier;
      let lineWidth = widthFactor * this.m_holePlatingThickness;
      lineWidth = Math.min(lineWidth, aPad.GetSizeX() / 2.0);
      lineWidth = Math.min(lineWidth, aPad.GetSizeY() / 2.0);

      gal.SetFillColor(color);
      gal.SetMinLineWidth(lineWidth);

      const slot = aPad.GetEffectiveHoleShape();

      if (slot.GetSeg().A.x === slot.GetSeg().B.x && slot.GetSeg().A.y === slot.GetSeg().B.y) {
        // Circular hole
        const holeRadius = slot.GetWidth() / 2.0;
        gal.DrawHoleWall(slot.GetSeg().A, holeRadius, lineWidth);
      } else {
        const holeSize = slot.GetWidth() + 2 * lineWidth;
        gal.DrawSegment(slot.GetSeg().A, slot.GetSeg().B, holeSize);
      }

      gal.SetMinLineWidth(1.0);

      // Draw backdrill indicators on top of the hole wall so they remain visible
      // regardless of layer rendering order
      if (!this.m_pcbSettings.IsPrinting() && aPad.GetDrillSizeX() > 0) {
        const holePos = slot.GetSeg().A;
        const secDrill = aPad.GetSecondaryDrillSize();
        const terDrill = aPad.GetTertiaryDrillSize();

        if (secDrill.x > 0) {
          this.drawBackdrillIndicator(
            aPad,
            holePos,
            secDrill.x,
            aPad.GetSecondaryDrillStartLayer(),
            aPad.GetSecondaryDrillEndLayer(),
          );
        }

        if (terDrill.x > 0) {
          this.drawBackdrillIndicator(
            aPad,
            holePos,
            terDrill.x,
            aPad.GetTertiaryDrillStartLayer(),
            aPad.GetTertiaryDrillEndLayer(),
          );
        }
      }

      return;
    }

    let outline_mode = !this.viewer_settings().m_ViewersDisplay.m_DisplayPadFill;

    if (this.m_pcbSettings.m_ForcePadSketchModeOn) outline_mode = true;

    let drawShape = false;

    if (this.m_pcbSettings.IsPrinting()) {
      drawShape = aPad.FlashLayer(this.m_pcbSettings.GetPrintLayers());
    } else if (
      (aLayer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT || IsPadCopperLayer(aLayer)) &&
      aPad.FlashLayer(pcbLayer)
    ) {
      drawShape = true;
    } else if (aPad.IsSelected()) {
      drawShape = true;
      outline_mode = true;
    } else if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      drawShape = true;
      outline_mode = false;
    }

    // Plated holes are always filled as they use a solid BG fill to
    // draw the "hole" over the hole-wall segment/circle.
    if (outline_mode && aLayer !== LAYER_PAD_PLATEDHOLES) {
      // Outline mode
      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
      gal.SetStrokeColor(color);
    } else {
      // Filled mode
      gal.SetIsFill(true);
      gal.SetIsStroke(false);
      gal.SetFillColor(color);
    }

    if (aLayer === LAYER_PAD_PLATEDHOLES || aLayer === LAYER_NON_PLATEDHOLES) {
      const slot = this.getPadHoleShape(aPad);
      const center = slot.GetSeg().A;

      if (slot.GetSeg().A.x === slot.GetSeg().B.x && slot.GetSeg().A.y === slot.GetSeg().B.y)
        // Circular hole
        gal.DrawCircle(center, slot.GetWidth() / 2.0);
      else gal.DrawSegment(slot.GetSeg().A, slot.GetSeg().B, slot.GetWidth());
    } else if (drawShape) {
      const pad_size = aPad.GetSize(pcbLayer);
      let margin: VECTOR2I = { x: 0, y: 0 };

      const getExpansion = (layer: PCB_LAYER_ID): VECTOR2I => {
        let expansion: VECTOR2I = { x: 0, y: 0 };

        switch (aLayer) {
          case F_Mask:
          case B_Mask: {
            const e = aPad.GetSolderMaskExpansion(layer);
            expansion = { x: e, y: e };
            break;
          }

          case F_Paste:
          case B_Paste:
            expansion = aPad.GetSolderPasteMargin(layer);
            break;

          default:
            expansion = { x: 0, y: 0 };
            break;
        }

        return expansion;
      };

      if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
        const visibleLayers = aPad
          .GetBoard()!
          .GetVisibleLayers()
          .and(aPad.GetBoard()!.GetEnabledLayers())
          .and(aPad.GetLayerSet());

        for (const layer of visibleLayers.Seq()) {
          // std::max on VECTOR2I: lexicographic
          const e = getExpansion(layer);
          if (e.x > margin.x || (e.x === margin.x && e.y > margin.y)) margin = e;
        }

        margin = {
          x: margin.x + Math.trunc(this.m_lockedShadowMargin / 2),
          y: margin.y + Math.trunc(this.m_lockedShadowMargin / 2),
        };
      } else {
        margin = getExpansion(pcbLayer);
      }

      let dummyPad: PAD | null = null;
      let shapes: SHAPE_COMPOUND | null = null;

      // Drawing components of compound shapes in outline mode produces a mess.
      let simpleShapes = !outline_mode;

      // When this layer has post-machining (counterbore/countersink), GetEffectiveShape returns
      // the counterbore hole circle (for DRC purposes), not the actual copper shape.  Force the
      // slower TransformShapeToPolygon path which always returns the correct copper shape.
      if (IsCopperLayer(pcbLayer) && aPad.GetPostMachiningKnockout(pcbLayer) > 0)
        simpleShapes = false;

      if (simpleShapes) {
        if (
          (margin.x !== margin.y && aPad.GetShape(pcbLayer) !== PAD_SHAPE.CUSTOM) ||
          (aPad.GetShape(pcbLayer) === PAD_SHAPE.ROUNDRECT && (margin.x < 0 || margin.y < 0))
        ) {
          // Our algorithms below (polygon inflation in particular) can't handle differential
          // inflation along separate axes.  So for those cases we build a dummy pad instead,
          // and inflate it.

          // Margin is added to both sides.  If the total margin is larger than the pad
          // then don't display this layer
          if (pad_size.x + 2 * margin.x <= 0 || pad_size.y + 2 * margin.y <= 0) return;

          dummyPad = aPad.Duplicate(false /* IGNORE_PARENT_GROUP */) as PAD;
          const initial_radius = dummyPad.GetRoundRectCornerRadius(pcbLayer);

          dummyPad.SetSize(pcbLayer, {
            x: pad_size.x + margin.x + margin.x,
            y: pad_size.y + margin.y + margin.y,
          });

          if (dummyPad.GetShape(pcbLayer) === PAD_SHAPE.ROUNDRECT) {
            // To keep the right margin around the corners, we need to modify the corner radius.
            // We must have only one radius correction, so use the smallest absolute margin.
            const radius_margin = Math.max(margin.x, margin.y); // radius_margin is < 0
            dummyPad.SetRoundRectCornerRadius(
              pcbLayer,
              Math.max(initial_radius + radius_margin, 0),
            );
          }

          shapes = asCompound(dummyPad.GetEffectiveShape(pcbLayer));
          margin = { x: 0, y: 0 };
        } else {
          shapes = asCompound(aPad.GetEffectiveShape(pcbLayer));
        }

        // The dynamic cast above will fail if the pad returned the hole shape or a null shape
        // instead of a SHAPE_COMPOUND, which happens if we're on a copper layer and the pad has
        // no shape on that layer.
        if (!shapes) return;

        if (aPad.GetShape(pcbLayer) === PAD_SHAPE.CUSTOM && (margin.x || margin.y)) {
          // We can't draw as shapes because we don't know which edges are internal and which
          // are external (so we don't know when to apply the margin and when not to).
          simpleShapes = false;
        }

        for (const shape of shapes.Shapes()) {
          if (!simpleShapes) break;

          switch (shape.Type()) {
            case SHAPE_TYPE.SH_SEGMENT:
            case SHAPE_TYPE.SH_CIRCLE:
            case SHAPE_TYPE.SH_RECT:
            case SHAPE_TYPE.SH_SIMPLE:
              // OK so far
              break;

            default:
              // Not OK
              simpleShapes = false;
              break;
          }
        }
      }

      const drawOneSimpleShape = (aShape: SHAPE): void => {
        switch (aShape.Type()) {
          case SHAPE_TYPE.SH_SEGMENT: {
            const seg = aShape as SHAPE_SEGMENT;
            const effectiveWidth = seg.GetWidth() + 2 * margin.x;

            if (effectiveWidth > 0) gal.DrawSegment(seg.GetSeg().A, seg.GetSeg().B, effectiveWidth);

            break;
          }

          case SHAPE_TYPE.SH_CIRCLE: {
            const circle = aShape as SHAPE_CIRCLE;
            const effectiveRadius = circle.GetRadius() + margin.x;

            if (effectiveRadius > 0) gal.DrawCircle(circle.GetCenter(), effectiveRadius);

            break;
          }

          case SHAPE_TYPE.SH_RECT: {
            const r = aShape as SHAPE_RECT;
            const pos = r.GetPosition();
            const effectiveMargin = margin;

            if (effectiveMargin.x < 0) {
              // A negative margin just produces a smaller rect.
              const effectiveSize = {
                x: r.GetSize().x + effectiveMargin.x,
                y: r.GetSize().y + effectiveMargin.y,
              };

              if (effectiveSize.x > 0 && effectiveSize.y > 0)
                gal.DrawRectangle(
                  { x: pos.x - effectiveMargin.x, y: pos.y - effectiveMargin.y },
                  { x: pos.x + effectiveSize.x, y: pos.y + effectiveSize.y },
                );
            } else if (effectiveMargin.x > 0) {
              // A positive margin produces a larger rect, but with rounded corners
              gal.DrawRectangle(r.GetPosition(), {
                x: r.GetPosition().x + r.GetSize().x,
                y: r.GetPosition().y + r.GetSize().y,
              });

              // Use segments to produce the margin with rounded corners
              gal.DrawSegment(pos, { x: pos.x + r.GetWidth(), y: pos.y }, effectiveMargin.x * 2);
              gal.DrawSegment(
                { x: pos.x + r.GetWidth(), y: pos.y },
                { x: pos.x + r.GetSize().x, y: pos.y + r.GetSize().y },
                effectiveMargin.x * 2,
              );
              gal.DrawSegment(
                { x: pos.x + r.GetSize().x, y: pos.y + r.GetSize().y },
                { x: pos.x, y: pos.y + r.GetHeight() },
                effectiveMargin.x * 2,
              );
              gal.DrawSegment({ x: pos.x, y: pos.y + r.GetHeight() }, pos, effectiveMargin.x * 2);
            } else {
              gal.DrawRectangle(r.GetPosition(), {
                x: r.GetPosition().x + r.GetSize().x,
                y: r.GetPosition().y + r.GetSize().y,
              });
            }

            break;
          }

          case SHAPE_TYPE.SH_SIMPLE: {
            const poly = aShape as SHAPE_SIMPLE;

            if (poly.PointCount() < 2)
              // Careful of empty pads
              break;

            if (margin.x < 0) {
              // The poly shape must be deflated
              const outline = new SHAPE_POLY_SET();
              outline.NewOutline();

              for (let ii = 0; ii < poly.PointCount(); ++ii) outline.Append(poly.CPoint(ii));

              outline.Deflate(-margin.x, CornerStrategy.CHAMFER_ALL_CORNERS, this.m_maxError);

              gal.DrawPolygon(outline);
            } else {
              gal.DrawPolygon(poly.Vertices());
            }

            // Now add on a rounded margin (using segments) if the margin > 0
            if (margin.x > 0) {
              for (let ii = 0; ii < poly.GetSegmentCount(); ++ii) {
                const seg = poly.GetSegment(ii);
                gal.DrawSegment(seg.A, seg.B, margin.x * 2);
              }
            }

            break;
          }

          default:
            // Better not get here; we already pre-flighted the shapes...
            break;
        }
      };

      if (simpleShapes) {
        for (const shape of shapes!.Shapes()) drawOneSimpleShape(shape);
      } else {
        // This is expensive.  Avoid if possible.
        const polySet = new SHAPE_POLY_SET();
        aPad.TransformShapeToPolygon(
          polySet,
          ToLAYER_ID(aLayer),
          margin.x,
          this.m_maxError,
          ERROR_LOC.ERROR_INSIDE,
        );
        gal.DrawPolygon(polySet);
      }
    }

    if (!this.m_pcbSettings.IsPrinting() && IsCopperLayer(pcbLayer) && aPad.GetDrillSizeX() > 0) {
      const pp = aPad.GetPosition();
      const off = aPad.GetOffset(pcbLayer);
      const holePos = { x: pp.x + off.x, y: pp.y + off.y };
      this.drawPostMachiningIndicator(aPad, holePos, pcbLayer);
    }

    if (
      IsClearanceLayer(aLayer) &&
      ((pcbconfig() && pcbconfig()!.m_Display.m_PadClearance) || !pcbconfig()) &&
      !this.m_pcbSettings.IsPrinting()
    ) {
      const copperLayerForClearance = ToLAYER_ID(aLayer - LAYER_CLEARANCE_START);

      if (aPad.GetAttribute() === PAD_ATTRIB.NPTH)
        color = this.m_pcbSettings.GetLayerColor(LAYER_NON_PLATEDHOLES);

      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
      gal.SetIsStroke(true);
      gal.SetIsFill(false);
      gal.SetStrokeColor(color);

      const clearance = aPad.GetOwnClearance(copperLayerForClearance);

      if (aPad.FlashLayer(copperLayerForClearance) && clearance > 0) {
        const shape = asCompound(aPad.GetEffectiveShape(pcbLayer));

        if (shape && shape.Size() === 1 && shape.Shapes()[0]!.Type() === SHAPE_TYPE.SH_SEGMENT) {
          const seg = shape.Shapes()[0] as SHAPE_SEGMENT;
          gal.DrawSegment(seg.GetSeg().A, seg.GetSeg().B, seg.GetWidth() + 2 * clearance);
        } else if (
          shape &&
          shape.Size() === 1 &&
          shape.Shapes()[0]!.Type() === SHAPE_TYPE.SH_CIRCLE
        ) {
          const circle = shape.Shapes()[0] as SHAPE_CIRCLE;
          gal.DrawCircle(circle.GetCenter(), circle.GetRadius() + clearance);
        } else {
          const polySet = new SHAPE_POLY_SET();

          // Use ERROR_INSIDE because it avoids Clipper and is therefore much faster.
          aPad.TransformShapeToPolygon(
            polySet,
            copperLayerForClearance,
            clearance,
            this.m_maxError,
            ERROR_LOC.ERROR_INSIDE,
          );

          if (polySet.Outline(0).PointCount() > 2)
            // Careful of empty pads
            gal.DrawPolygon(polySet);
        }
      } else if (aPad.GetEffectiveHoleShape() && clearance > 0) {
        const slot = aPad.GetEffectiveHoleShape();
        gal.DrawSegment(slot.GetSeg().A, slot.GetSeg().B, slot.GetWidth() + 2 * clearance);
      }
    }
  }

  protected drawShape(aShape: PCB_SHAPE, aLayer: number): void {
    const gal = this.m_gal!;
    let color = this.m_pcbSettings.GetColorForBoardItem(aShape, aLayer);
    const outline_mode = !this.viewer_settings().m_ViewersDisplay.m_DisplayGraphicsFill;
    let thickness = this.getLineThickness(aShape.GetWidth());
    let lineStyle = aShape.GetStroke().GetLineStyle();
    let isSolidFill = aShape.IsSolidFill();
    let isHatchedFill = aShape.IsHatchedFill();

    if (lineStyle === LINE_STYLE.DEFAULT) lineStyle = LINE_STYLE.SOLID;

    if (
      IsSolderMaskLayer(aLayer) &&
      aShape.HasSolderMask() &&
      IsExternalCopperLayer(aShape.GetLayer())
    ) {
      lineStyle = LINE_STYLE.SOLID;
      thickness += aShape.GetSolderMaskExpansion() * 2;

      if (isHatchedFill) {
        isSolidFill = true;
        isHatchedFill = false;
      }
    }

    if (IsNetnameLayer(aLayer)) {
      // Net names are shown only in board editor:
      if (this.m_frameType !== FRAME_T.FRAME_PCB_EDITOR) return;

      if (!pcbconfig() || pcbconfig()!.m_Display.m_NetNames < 2) return;

      if (aShape.GetNetCode() <= NETINFO_LIST.UNCONNECTED) return;

      const netname = aShape.GetDisplayNetname();

      if (netname === '') return;

      if (aShape.GetShape() === SHAPE_T.SEGMENT) {
        const seg = new SHAPE_SEGMENT(aShape.GetStart(), aShape.GetEnd(), aShape.GetWidth());
        this.renderNetNameForSegment(seg, color, netname);
        return;
      }

      // TODO: Maybe use some of the pad code?

      return;
    }

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      color = this.m_pcbSettings.GetColorForBoardItem(aShape, aLayer);
      thickness = thickness + this.m_lockedShadowMargin;
      // Note: on LAYER_LOCKED_ITEM_SHADOW always draw shadow shapes as continuous lines
      // otherwise the look is very strange and ugly
      lineStyle = LINE_STYLE.SOLID;
    }

    if (outline_mode) {
      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
    }

    gal.SetFillColor(color);
    gal.SetStrokeColor(color);

    if (lineStyle === LINE_STYLE.SOLID || aShape.IsSolidFill()) {
      switch (aShape.GetShape()) {
        case SHAPE_T.SEGMENT:
          if (aShape.IsProxyItem()) {
            const pts: VECTOR2I[] = [];
            const s = aShape.GetStart();
            const e = aShape.GetEnd();
            let offset = Perpendicular({ x: e.x - s.x, y: e.y - s.y });
            offset = ResizeI(offset, Math.trunc(thickness / 2));

            pts.push({ x: s.x + offset.x, y: s.y + offset.y });
            pts.push({ x: s.x - offset.x, y: s.y - offset.y });
            pts.push({ x: e.x - offset.x, y: e.y - offset.y });
            pts.push({ x: e.x + offset.x, y: e.y + offset.y });

            gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
            gal.DrawLine(pts[0]!, pts[1]!);
            gal.DrawLine(pts[1]!, pts[2]!);
            gal.DrawLine(pts[2]!, pts[3]!);
            gal.DrawLine(pts[3]!, pts[0]!);
            gal.DrawLine(mid(pts[0]!, pts[1]!), mid(pts[1]!, pts[2]!));
            gal.DrawLine(mid(pts[1]!, pts[2]!), mid(pts[2]!, pts[3]!));
            gal.DrawLine(mid(pts[2]!, pts[3]!), mid(pts[3]!, pts[0]!));
            gal.DrawLine(mid(pts[3]!, pts[0]!), mid(pts[0]!, pts[1]!));
          } else if (outline_mode) {
            gal.DrawSegment(aShape.GetStart(), aShape.GetEnd(), thickness);
          } else if (lineStyle === LINE_STYLE.SOLID) {
            gal.SetIsFill(true);
            gal.SetIsStroke(false);

            gal.DrawSegment(aShape.GetStart(), aShape.GetEnd(), thickness);
          }

          break;

        case SHAPE_T.RECTANGLE: {
          if (aShape.GetCornerRadius() > 0) {
            // Creates a normalized ROUNDRECT item
            // (GetRectangleWidth() and GetRectangleHeight() can be < 0 with transforms
            const rr = new ROUNDRECT(
              new SHAPE_RECT(
                aShape.GetStart(),
                aShape.GetRectangleWidth(),
                aShape.GetRectangleHeight(),
              ),
              aShape.GetCornerRadius(),
              true /* normalize */,
            );
            const poly = new SHAPE_POLY_SET();
            rr.TransformToPolygon(poly, aShape.GetMaxError());
            const outline = poly.Outline(0);

            if (aShape.IsProxyItem()) {
              gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
              gal.DrawPolygon(outline);
            } else if (outline_mode) {
              gal.DrawSegmentChain(outline, thickness);
            } else {
              gal.SetIsFill(true);
              gal.SetIsStroke(false);

              if (lineStyle === LINE_STYLE.SOLID && thickness > 0) {
                gal.DrawSegmentChain(outline, thickness);
              }

              if (isSolidFill) {
                if (thickness < 0) {
                  const deflated_shape = new SHAPE_POLY_SET(outline);
                  deflated_shape.Inflate(
                    Math.trunc(thickness / 2),
                    CornerStrategy.ROUND_ALL_CORNERS,
                    this.m_maxError,
                  );
                  gal.DrawPolygon(deflated_shape);
                } else {
                  gal.DrawPolygon(outline);
                }
              }
            }
          } else {
            const pts = aShape.GetRectCorners();

            if (aShape.IsProxyItem()) {
              gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
              gal.DrawLine(pts[0]!, pts[1]!);
              gal.DrawLine(pts[1]!, pts[2]!);
              gal.DrawLine(pts[2]!, pts[3]!);
              gal.DrawLine(pts[3]!, pts[0]!);
              gal.DrawLine(pts[0]!, pts[2]!);
              gal.DrawLine(pts[1]!, pts[3]!);
            } else if (outline_mode) {
              gal.DrawSegment(pts[0]!, pts[1]!, thickness);
              gal.DrawSegment(pts[1]!, pts[2]!, thickness);
              gal.DrawSegment(pts[2]!, pts[3]!, thickness);
              gal.DrawSegment(pts[3]!, pts[0]!, thickness);
            } else {
              gal.SetIsFill(true);
              gal.SetIsStroke(false);

              if (lineStyle === LINE_STYLE.SOLID && thickness > 0) {
                gal.DrawSegment(pts[0]!, pts[1]!, thickness);
                gal.DrawSegment(pts[1]!, pts[2]!, thickness);
                gal.DrawSegment(pts[2]!, pts[3]!, thickness);
                gal.DrawSegment(pts[3]!, pts[0]!, thickness);
              }

              if (isSolidFill) {
                const poly = new SHAPE_POLY_SET();
                poly.NewOutline();

                for (const pt of pts) poly.Append(pt);

                if (thickness < 0)
                  poly.Inflate(
                    Math.trunc(thickness / 2),
                    CornerStrategy.ROUND_ALL_CORNERS,
                    this.m_maxError,
                  );

                gal.DrawPolygon(poly);
              }
            }
          }

          break;
        }

        case SHAPE_T.ARC: {
          const angles = aShape.CalcArcAngles();
          const startAngle = angles[0];
          const endAngle = angles[1];

          if (outline_mode) {
            gal.DrawArcSegment(
              aShape.GetCenter(),
              aShape.GetRadius(),
              startAngle,
              endAngle.sub(startAngle),
              thickness,
              this.m_maxError,
            );
          } else if (lineStyle === LINE_STYLE.SOLID) {
            gal.SetIsFill(true);
            gal.SetIsStroke(false);

            gal.DrawArcSegment(
              aShape.GetCenter(),
              aShape.GetRadius(),
              startAngle,
              endAngle.sub(startAngle),
              thickness,
              this.m_maxError,
            );
          }

          break;
        }

        case SHAPE_T.CIRCLE:
          if (outline_mode) {
            gal.DrawCircle(aShape.GetStart(), aShape.GetRadius() - Math.trunc(thickness / 2));
            gal.DrawCircle(aShape.GetStart(), aShape.GetRadius() + Math.trunc(thickness / 2));
          } else {
            gal.SetIsFill(aShape.IsSolidFill());
            gal.SetIsStroke(lineStyle === LINE_STYLE.SOLID && thickness > 0);
            gal.SetLineWidth(thickness);

            let radius = aShape.GetRadius();

            if (lineStyle === LINE_STYLE.SOLID && thickness > 0) {
              gal.DrawCircle(aShape.GetStart(), radius);
            } else if (isSolidFill) {
              if (thickness < 0) {
                radius += Math.trunc(thickness / 2);
                radius = Math.max(radius, 0);
              }

              gal.DrawCircle(aShape.GetStart(), radius);
            }
          }

          break;

        case SHAPE_T.POLY: {
          const shape = aShape.GetPolyShape();

          if (shape.OutlineCount() === 0) break;

          if (outline_mode) {
            for (let ii = 0; ii < shape.OutlineCount(); ++ii)
              gal.DrawSegmentChain(shape.Outline(ii), thickness);
          } else {
            gal.SetIsFill(true);
            gal.SetIsStroke(false);

            if (lineStyle === LINE_STYLE.SOLID && thickness > 0) {
              for (let ii = 0; ii < shape.OutlineCount(); ++ii)
                gal.DrawSegmentChain(shape.Outline(ii), thickness);
            }

            if (isSolidFill) {
              if (thickness < 0) {
                const deflated_shape = new SHAPE_POLY_SET(shape);
                deflated_shape.Inflate(
                  Math.trunc(thickness / 2),
                  CornerStrategy.ROUND_ALL_CORNERS,
                  this.m_maxError,
                );
                gal.DrawPolygon(deflated_shape);
              } else {
                // On Opengl, a not convex filled polygon is usually drawn by using
                // triangles as primitives. CacheTriangulation() can create basic triangle
                // primitives to draw the polygon solid shape on Opengl.  GLU tessellation
                // is much slower, so currently we are using our tessellation.
                if (gal.IsOpenGlEngine() && !shape.IsTriangulationUpToDate())
                  shape.CacheTriangulation(true, true);

                gal.DrawPolygon(shape);
              }
            }
          }

          break;
        }

        case SHAPE_T.BEZIER:
          if (outline_mode) {
            const pointCtrl: Vec2[] = [];

            pointCtrl.push(aShape.GetStart());
            pointCtrl.push(aShape.GetBezierC1());
            pointCtrl.push(aShape.GetBezierC2());
            pointCtrl.push(aShape.GetEnd());

            const converter = new BezierPoly(pointCtrl);
            converter.getPolyD(this.m_maxError);

            gal.DrawSegmentChain(aShape.GetBezierPoints(), thickness);
          } else {
            gal.SetIsFill(aShape.IsSolidFill());
            gal.SetIsStroke(lineStyle === LINE_STYLE.SOLID && thickness > 0);
            gal.SetLineWidth(thickness);

            if (aShape.GetBezierPoints().length > 2) {
              gal.DrawPolygon(aShape.GetBezierPoints());
            } else {
              gal.DrawCurve(
                aShape.GetStart(),
                aShape.GetBezierC1(),
                aShape.GetBezierC2(),
                aShape.GetEnd(),
                this.m_maxError,
              );
            }
          }

          break;

        case SHAPE_T.UNDEFINED:
          break;
      }
    }

    if (lineStyle !== LINE_STYLE.SOLID) {
      if (!outline_mode) {
        gal.SetIsFill(true);
        gal.SetIsStroke(false);
      }

      const shapes = aShape.MakeEffectiveShapes(true);

      for (const shape of shapes) {
        STROKE_PARAMS.Stroke(
          shape,
          lineStyle,
          this.getLineThickness(aShape.GetWidth()),
          this.m_pcbSettings,
          (a: VECTOR2I, b: VECTOR2I) => {
            gal.DrawSegment(a, b, thickness);
          },
        );
      }
    }

    if (isHatchedFill) {
      aShape.UpdateHatching();

      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetLineWidth(aShape.GetHatchLineWidth());

      for (const seg of aShape.GetHatchLines()) gal.DrawLine(seg.A, seg.B);
    }
  }

  protected strokeText(
    aText: string,
    aPosition: VECTOR2I,
    aAttrs: TEXT_ATTRIBUTES,
    aFontMetrics: METRICS,
  ): void {
    const gal = this.m_gal!;
    let font = aAttrs.m_Font;

    if (!font) font = FONT.GetFont('', aAttrs.m_Bold, aAttrs.m_Italic);

    gal.SetIsFill(font.IsOutline());
    gal.SetIsStroke(font.IsStroke());

    let pos: VECTOR2I = { ...aPosition };
    let fudge: VECTOR2I = { x: KiROUND(0.16 * aAttrs.m_StrokeWidth), y: 0 };

    fudge = RotatePoint(fudge, aAttrs.m_Angle);

    if (
      (aAttrs.m_Halign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT && !aAttrs.m_Mirrored) ||
      (aAttrs.m_Halign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT && aAttrs.m_Mirrored)
    ) {
      pos = { x: pos.x - fudge.x, y: pos.y - fudge.y };
    } else if (
      (aAttrs.m_Halign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT && !aAttrs.m_Mirrored) ||
      (aAttrs.m_Halign === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT && aAttrs.m_Mirrored)
    ) {
      pos = { x: pos.x + fudge.x, y: pos.y + fudge.y };
    }

    font.DrawAt(gal, aText, pos, aAttrs, aFontMetrics);
  }

  protected drawReferenceImage(aBitmap: PCB_REFERENCE_IMAGE, aLayer: number): void {
    const gal = this.m_gal!;

    gal.Save();

    const refImg = aBitmap.GetReferenceImage();
    gal.Translate(refImg.GetPosition());

    // When the image scale factor is not 1.0, we need to modify the actual as the image scale
    // factor is similar to a local zoom
    const img_scale = refImg.GetImageScale();

    if (img_scale !== 1.0) gal.Scale({ x: img_scale, y: img_scale });

    const imgAlpha = this.m_pcbSettings.GetColorForBoardItem(aBitmap, aBitmap.GetLayer()).a;

    if (aBitmap.IsSelected() || aBitmap.IsBrightened()) {
      const color = this.m_pcbSettings.GetColorForBoardItem(aBitmap, LAYER_ANCHOR);
      gal.SetIsStroke(true);
      gal.SetStrokeColor(color);
      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth() * 2.0);
      gal.SetIsFill(false);

      // Draws a bounding box.
      let bm_size: Vec2 = { ...refImg.GetSize() };
      // bm_size is the actual image size in UI.
      // but m_canvas scale was previously set to img_scale
      // so recalculate size relative to this image size.
      bm_size = { x: bm_size.x / img_scale, y: bm_size.y / img_scale };
      const origin = { x: -bm_size.x / 2.0, y: -bm_size.y / 2.0 };
      const end = { x: origin.x + bm_size.x, y: origin.y + bm_size.y };

      gal.DrawRectangle(origin, end);

      // Keep reference images opaque when selected (and not moving). Otherwise cached layers
      // will not be rendered under the selected image because cached layers are rendered
      // after non-cached layers (e.g. bitmaps), which will have a closer Z order.
      gal.DrawBitmap(refImg.GetImage(), aBitmap.IsMoving() ? imgAlpha : 1.0);
    } else gal.DrawBitmap(refImg.GetImage(), imgAlpha);

    gal.Restore();
  }

  protected drawField(aField: PCB_FIELD, aLayer: number): void {
    if (aField.IsVisible()) this.drawText(aField as unknown as PCB_TEXT, aLayer);
  }

  protected drawText(aText: PCB_TEXT, aLayer: number): void {
    const gal = this.m_gal!;
    const resolvedText = aText.GetShownText(true);

    if (resolvedText.length === 0) return;

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      // happens only if locked
      const color = this.m_pcbSettings.GetColorForBoardItem(aText, aLayer);

      gal.SetIsFill(true);
      gal.SetIsStroke(true);
      gal.SetFillColor(color);
      gal.SetStrokeColor(color);
      gal.SetLineWidth(this.m_lockedShadowMargin);

      const poly = new SHAPE_POLY_SET();
      aText.TransformShapeToPolygon(
        poly,
        aText.GetLayer(),
        0,
        this.m_maxError,
        ERROR_LOC.ERROR_OUTSIDE,
      );
      gal.DrawPolygon(poly);

      return;
    }

    const metrics = aText.GetFontMetrics();
    const attrs = aText.GetAttributes().clone();
    const color = this.m_pcbSettings.GetColorForBoardItem(aText, aLayer);
    const outline_mode = !this.viewer_settings().m_ViewersDisplay.m_DisplayTextFill;

    const font = aText.GetDrawFont(this.m_pcbSettings);

    gal.SetStrokeColor(color);
    gal.SetFillColor(color);
    attrs.m_Angle = aText.GetDrawRotation();

    if (aText.IsKnockout()) {
      const finalPoly = aText.GetKnockoutCache(font, resolvedText, this.m_maxError);

      gal.SetIsStroke(false);
      gal.SetIsFill(true);
      gal.DrawPolygon(finalPoly);
    } else {
      if (outline_mode) attrs.m_StrokeWidth = this.m_pcbSettings.GetOutlineWidth();
      else attrs.m_StrokeWidth = this.getLineThickness(aText.GetEffectiveTextPenWidth());

      if (gal.IsFlippedX() && !aText.IsSideSpecific()) {
        // We do not want to change the mirroring for this kind of text
        // on the mirrored canvas
        // (not mirrored is draw not mirrored and mirrored is draw mirrored)
        // So we need to recalculate the text position to keep it at the same position
        // on the canvas
        let textPos: VECTOR2I = { ...aText.GetTextPos() };
        let textWidth: VECTOR2I = { x: aText.GetTextBox(this.m_pcbSettings).GetWidth(), y: 0 };

        if (aText.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
          textWidth = { x: -textWidth.x, y: textWidth.y };
        else if (aText.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER)
          textWidth = { x: 0, y: textWidth.y };

        textWidth = RotatePoint(textWidth, { x: 0, y: 0 }, aText.GetDrawRotation());

        if (attrs.m_Mirrored) textPos = { x: textPos.x - textWidth.x, y: textPos.y - textWidth.y };
        else textPos = { x: textPos.x + textWidth.x, y: textPos.y + textWidth.y };

        attrs.m_Mirrored = !attrs.m_Mirrored;
        this.strokeText(resolvedText, textPos, attrs, metrics);
        return;
      }

      let cache: GLYPH_LIKE[] | null = null;

      if (font.IsOutline()) cache = aText.GetRenderCache(font, resolvedText);

      if (cache) {
        gal.SetLineWidth(attrs.m_StrokeWidth);
        gal.DrawGlyphs(cache);
      } else {
        this.strokeText(resolvedText, aText.GetTextPos(), attrs, metrics);
      }
    }

    // Draw the umbilical line for texts in footprints
    const fp_parent = aText.GetParentFootprint();

    if (fp_parent && aText.IsSelected()) {
      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
      gal.SetStrokeColor(this.m_pcbSettings.GetColorForBoardItem(null, LAYER_ANCHOR));
      gal.DrawLine(aText.GetTextPos(), fp_parent.GetPosition());
    }
  }

  protected drawTextBox(aTextBox: PCB_TEXTBOX, aLayer: number): void {
    const gal = this.m_gal!;

    if (aTextBox.Type() === KICAD_T.PCB_TABLECELL_T) {
      const cell = aTextBox as unknown as PCB_TABLECELL;

      if (cell.GetColSpan() === 0 || cell.GetRowSpan() === 0) return;
    }

    const color = this.m_pcbSettings.GetColorForBoardItem(aTextBox, aLayer);
    const thickness = this.getLineThickness(aTextBox.GetWidth());
    const lineStyle = aTextBox.GetStroke().GetLineStyle();
    const resolvedText = aTextBox.GetShownText(true);
    const font = aTextBox.GetDrawFont(this.m_pcbSettings);

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      // happens only if locked
      const sh_color = this.m_pcbSettings.GetColorForBoardItem(aTextBox, aLayer);
      gal.SetIsFill(true);
      gal.SetIsStroke(false);
      gal.SetFillColor(sh_color);
      gal.SetStrokeColor(sh_color);

      // Draw the box with a larger thickness than box thickness to show
      // the shadow mask
      const pts = aTextBox.GetCorners();
      const line_thickness = Math.max(thickness * 3, pcbIUScale.mmToIU(0.2));

      const dpts: Vec2[] = [];

      for (const pt of pts) dpts.push({ x: pt.x, y: pt.y });

      dpts.push({ x: pts[0]!.x, y: pts[0]!.y });

      gal.SetIsStroke(true);
      gal.SetLineWidth(line_thickness);
      gal.DrawPolygon(dpts);
    }

    gal.SetFillColor(color);
    gal.SetStrokeColor(color);
    gal.SetIsFill(true);
    gal.SetIsStroke(false);

    if (aTextBox.Type() !== KICAD_T.PCB_TABLECELL_T && aTextBox.IsBorderEnabled()) {
      if (lineStyle <= LINE_STYLE.SOLID /* FIRST_TYPE */) {
        if (thickness > 0) {
          const pts = aTextBox.GetCorners();

          for (let ii = 0; ii < pts.length; ++ii)
            gal.DrawSegment(pts[ii]!, pts[(ii + 1) % pts.length]!, thickness);
        }
      } else {
        const shapes = aTextBox.MakeEffectiveShapes(true);

        for (const shape of shapes) {
          STROKE_PARAMS.Stroke(
            shape,
            lineStyle,
            thickness,
            this.m_pcbSettings,
            (a: VECTOR2I, b: VECTOR2I) => {
              gal.DrawSegment(a, b, thickness);
            },
          );
        }
      }
    }

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      // For now, the textbox is a filled shape.
      // so the text drawn on LAYER_LOCKED_ITEM_SHADOW with a thick width is disabled
      // If enabled, the thick text position must be offsetted to be exactly on the
      // initial text, which is not easy, depending on its rotation and justification.
      return;
    }

    if (aTextBox.IsKnockout()) {
      const finalPoly = new SHAPE_POLY_SET();
      aTextBox.TransformTextToPolySet(finalPoly, 0, this.m_maxError, ERROR_LOC.ERROR_INSIDE);
      finalPoly.Fracture();

      gal.SetIsStroke(false);
      gal.SetIsFill(true);
      gal.DrawPolygon(finalPoly);
    } else {
      if (resolvedText.length === 0) return;

      const metrics = aTextBox.GetFontMetrics();
      const attrs = aTextBox.GetAttributes().clone();
      attrs.m_StrokeWidth = this.getLineThickness(aTextBox.GetEffectiveTextPenWidth());

      if (gal.IsFlippedX() && !aTextBox.IsSideSpecific()) {
        attrs.m_Mirrored = !attrs.m_Mirrored;
        this.strokeText(resolvedText, aTextBox.GetDrawPos(true), attrs, metrics);
        return;
      }

      let cache: GLYPH_LIKE[] | null = null;

      if (font.IsOutline()) cache = aTextBox.GetRenderCache(font, resolvedText);

      if (cache) {
        gal.SetLineWidth(attrs.m_StrokeWidth);
        gal.DrawGlyphs(cache);
      } else {
        this.strokeText(resolvedText, aTextBox.GetDrawPos(), attrs, metrics);
      }
    }
  }

  protected drawTable(aTable: PCB_TABLE, aLayer: number): void {
    const gal = this.m_gal!;

    if (aTable.GetCells().length === 0) return;

    for (const cell of aTable.GetCells()) {
      if (cell.GetColSpan() > 0 || cell.GetRowSpan() > 0)
        this.drawTextBox(cell as unknown as PCB_TEXTBOX, aLayer);
    }

    const color = this.m_pcbSettings.GetColorForBoardItem(aTable, aLayer);

    aTable.DrawBorders((ptA: VECTOR2I, ptB: VECTOR2I, stroke: STROKE_PARAMS) => {
      const lineWidth = this.getLineThickness(stroke.GetWidth());
      const lineStyle = stroke.GetLineStyle();

      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetStrokeColor(color);
      gal.SetLineWidth(lineWidth);

      if (lineStyle <= LINE_STYLE.SOLID /* FIRST_TYPE */) {
        gal.DrawLine(ptA, ptB);
      } else {
        const seg = new SHAPE_SEGMENT(ptA, ptB);
        STROKE_PARAMS.Stroke(
          seg,
          lineStyle,
          lineWidth,
          this.m_pcbSettings,
          (a: VECTOR2I, b: VECTOR2I) => {
            // DrawLine has problem with 0 length lines so enforce minimum
            if (a.x === b.x && a.y === b.y) gal.DrawLine({ x: a.x + 1, y: a.y + 1 }, b);
            else gal.DrawLine(a, b);
          },
        );
      }
    });

    // Highlight selected tablecells with a background wash.
    for (const cell of aTable.GetCells()) {
      if (aTable.IsSelected() || cell.IsSelected()) {
        const corners = cell.GetCorners();
        const pts: Vec2[] = corners.map((c) => ({ x: c.x, y: c.y }));

        gal.SetFillColor(withAlpha(color, 0.5));
        gal.SetIsFill(true);
        gal.SetIsStroke(false);
        gal.DrawPolygon(pts);
      }
    }
  }

  protected drawFootprint(aFootprint: FOOTPRINT, aLayer: number): void {
    const gal = this.m_gal!;

    if (aLayer === LAYER_ANCHOR) {
      const color = this.m_pcbSettings.GetColorForBoardItem(aFootprint, aLayer);

      // Keep the size and width constant, not related to the scale because the anchor
      // is just a marker on screen
      const anchorSize = 5.0 / gal.GetWorldScale(); // 5 pixels size
      const anchorThickness = 1.0 / gal.GetWorldScale(); // 1 pixels width

      // Draw anchor
      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetStrokeColor(color);
      gal.SetLineWidth(anchorThickness);

      const center: Vec2 = aFootprint.GetPosition();
      gal.DrawLine(
        { x: center.x - anchorSize, y: center.y },
        { x: center.x + anchorSize, y: center.y },
      );
      gal.DrawLine(
        { x: center.x, y: center.y - anchorSize },
        { x: center.x, y: center.y + anchorSize },
      );
    }

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW && this.m_frameType === FRAME_T.FRAME_PCB_EDITOR) {
      // happens only if locked
      const color = this.m_pcbSettings.GetColorForBoardItem(aFootprint, aLayer);

      gal.SetIsFill(true);
      gal.SetIsStroke(false);
      gal.SetFillColor(color);

      const bbox = aFootprint.GetBoundingBox(false);
      const topLeft = bbox.GetPosition();
      const botRight = {
        x: bbox.GetPosition().x + bbox.GetSize().x,
        y: bbox.GetPosition().y + bbox.GetSize().y,
      };

      gal.DrawRectangle(topLeft, botRight);

      // Use segments to produce a margin with rounded corners
      gal.DrawSegment(topLeft, { x: botRight.x, y: topLeft.y }, this.m_lockedShadowMargin);
      gal.DrawSegment({ x: botRight.x, y: topLeft.y }, botRight, this.m_lockedShadowMargin);
      gal.DrawSegment(botRight, { x: topLeft.x, y: botRight.y }, this.m_lockedShadowMargin);
      gal.DrawSegment({ x: topLeft.x, y: botRight.y }, topLeft, this.m_lockedShadowMargin);
    }

    if (aLayer === LAYER_CONFLICTS_SHADOW) {
      const frontpoly = aFootprint.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
      const backpoly = aFootprint.GetCourtyard(PCB_LAYER_ID.B_CrtYd);

      const color = this.m_pcbSettings.GetColorForBoardItem(aFootprint, aLayer);

      gal.SetIsFill(true);
      gal.SetIsStroke(false);
      gal.SetFillColor(color);

      if (frontpoly.OutlineCount() > 0) gal.DrawPolygon(frontpoly);

      if (backpoly.OutlineCount() > 0) gal.DrawPolygon(backpoly);
    }
  }

  protected drawGroup(aGroup: PCB_GROUP, aLayer: number): void {
    const gal = this.m_gal!;

    if (aLayer === LAYER_ANCHOR) {
      if (aGroup.IsSelected() && !(aGroup.GetParent() && aGroup.GetParent()!.IsSelected())) {
        // Selected on our own; draw enclosing box
      } else if (aGroup.IsEntered()) {
        // Entered group; draw enclosing box
      } else {
        // Neither selected nor entered; draw nothing at the group level (ie: only draw
        // its members)
        return;
      }

      const color = this.m_pcbSettings.GetColorForBoardItem(aGroup, LAYER_ANCHOR);

      gal.SetStrokeColor(color);
      gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth() * 2.0);

      const bbox = aGroup.GetBoundingBox();
      const topLeft = bbox.GetPosition();
      const width = { x: bbox.GetWidth(), y: 0 };
      const height = { x: 0, y: bbox.GetHeight() };
      const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
      const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

      gal.DrawLine(topLeft, add(topLeft, width));
      gal.DrawLine(add(topLeft, width), add(add(topLeft, width), height));
      gal.DrawLine(add(add(topLeft, width), height), add(topLeft, height));
      gal.DrawLine(add(topLeft, height), topLeft);

      const name = aGroup.GetName();

      if (name === '') return;

      const ptSize = 12;
      const scaledSize = Math.abs(KiROUND(gal.GetScreenWorldMatrix().GetScale().x * ptSize));
      const unscaledSize = pcbIUScale.milsToIU(ptSize);

      // Scale by zoom a bit, but not too much
      const textSize = Math.trunc((scaledSize + unscaledSize * 2) / 3);
      const textOffset: VECTOR2I = { x: KiROUND(width.x / 2.0), y: KiROUND(-textSize * 0.5) };
      const titleHeight: VECTOR2I = { x: KiROUND(0.0), y: KiROUND(textSize * 2.0) };

      if (printableCharCount(name) * textSize < bbox.GetWidth()) {
        gal.DrawLine(topLeft, sub(topLeft, titleHeight));
        gal.DrawLine(sub(topLeft, titleHeight), sub(add(topLeft, width), titleHeight));
        gal.DrawLine(sub(add(topLeft, width), titleHeight), add(topLeft, width));

        const attrs = new TEXT_ATTRIBUTES();
        attrs.m_Italic = true;
        attrs.m_Halign = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
        attrs.m_Valign = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;
        attrs.m_Size = { x: textSize, y: textSize };
        attrs.m_StrokeWidth = GetPenSizeForNormal(textSize);

        FONT.GetFont().DrawAt(
          gal,
          aGroup.GetName(),
          { x: topLeft.x + textOffset.x, y: topLeft.y + textOffset.y },
          attrs,
          aGroup.GetFontMetrics(),
        );
      }
    }
  }

  protected drawZone(aZone: ZONE, aLayer: number): void {
    const gal = this.m_gal!;

    if (aLayer === LAYER_CONFLICTS_SHADOW) {
      const color = this.m_pcbSettings.GetColorForBoardItem(aZone, aLayer);

      gal.SetIsFill(true);
      gal.SetIsStroke(false);
      gal.SetFillColor(color);

      gal.DrawPolygon(aZone.Outline().Outline(0));
      return;
    }

    /*
     * aLayer will be the virtual zone layer (LAYER_ZONE_START, ... in GAL_LAYER_ID)
     * This is used for draw ordering in the GAL.
     * The color for the zone comes from the associated copper layer ( aLayer - LAYER_ZONE_START )
     * and the visibility comes from the combination of that copper layer and LAYER_ZONES
     */
    let layer: PCB_LAYER_ID;

    if (IsZoneFillLayer(aLayer)) layer = ToLAYER_ID(aLayer - LAYER_ZONE_START);
    else layer = ToLAYER_ID(aLayer);

    if (!aZone.IsOnLayer(layer)) return;

    const color = this.m_pcbSettings.GetColorForBoardItem(aZone, layer);
    let displayMode = this.m_pcbSettings.m_ZoneDisplayMode;

    if (aZone.IsTeardropArea()) displayMode = ZONE_DISPLAY_MODE.SHOW_FILLED;

    // A zone whose only visual is its outline (rule area, or outline-only display) draws it on
    // the zone layer, above copper, so tracks and pads can't paint over it.
    const outlineOnly =
      aZone.GetIsRuleArea() || displayMode === ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE;

    // Draw the outline
    if (ZoneOutlineDrawnOnLayer(outlineOnly, aLayer)) {
      const outline = aZone.Outline();
      const allowDrawOutline = aZone.GetHatchStyle() !== ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER;

      if (
        allowDrawOutline &&
        !this.m_pcbSettings.IsPrinting() &&
        outline &&
        outline.OutlineCount() > 0
      ) {
        gal.SetStrokeColor(color.a > 0.0 ? withAlpha(color, 1.0) : color);
        gal.SetIsFill(false);
        gal.SetIsStroke(true);
        gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());

        // Draw each contour (main contour and holes)

        /*
         * m_gal->DrawPolygon( *outline );
         * should be enough, but currently does not work to draw holes contours in a complex polygon
         * so each contour is draw as a simple polygon
         */

        // Draw the main contour(s?)
        for (let ii = 0; ii < outline.OutlineCount(); ++ii) {
          gal.DrawPolyline(outline.COutline(ii));

          // Draw holes
          const holes_count = outline.HoleCount(ii);

          for (let jj = 0; jj < holes_count; ++jj) gal.DrawPolyline(outline.CHole(ii, jj));
        }

        // Draw hatch lines
        for (const hatchLine of aZone.GetHatchLines()) gal.DrawLine(hatchLine.A, hatchLine.B);
      }
    }

    // Draw the filling
    if (
      IsZoneFillLayer(aLayer) &&
      (displayMode === ZONE_DISPLAY_MODE.SHOW_FILLED ||
        displayMode === ZONE_DISPLAY_MODE.SHOW_FRACTURE_BORDERS ||
        displayMode === ZONE_DISPLAY_MODE.SHOW_TRIANGULATION)
    ) {
      const polySet = aZone.GetFilledPolysList(layer);

      if (!polySet || polySet.OutlineCount() === 0)
        // Nothing to draw
        return;

      gal.SetStrokeColor(color);
      gal.SetFillColor(color);
      gal.SetLineWidth(0);

      if (displayMode === ZONE_DISPLAY_MODE.SHOW_FILLED) {
        gal.SetIsFill(true);
        gal.SetIsStroke(false);
      } else {
        gal.SetIsFill(false);
        gal.SetIsStroke(true);
      }

      // On Opengl, a not convex filled polygon is usually drawn by using triangles
      // as primitives. CacheTriangulation() can create basic triangle primitives to
      // draw the polygon solid shape on Opengl.  GLU tessellation is much slower,
      // so currently we are using our tessellation.
      if (gal.IsOpenGlEngine() && !polySet.IsTriangulationUpToDate())
        polySet.CacheTriangulation(true, true);

      gal.DrawPolygon(polySet, displayMode === ZONE_DISPLAY_MODE.SHOW_TRIANGULATION);
    }
  }

  protected drawBarcode(aBarcode: PCB_BARCODE, aLayer: number): void {
    const gal = this.m_gal!;
    const color = this.m_pcbSettings.GetColorForBoardItem(aBarcode, aLayer);

    gal.SetIsFill(true);
    gal.SetIsStroke(false);
    gal.SetFillColor(color);

    // Draw the barcode
    const shape = new SHAPE_POLY_SET();

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW)
      aBarcode.GetBoundingHull(
        shape,
        aBarcode.GetLayer(),
        this.m_lockedShadowMargin,
        this.m_maxError,
        ERROR_LOC.ERROR_INSIDE,
      );
    else
      aBarcode.TransformShapeToPolySet(
        shape,
        aBarcode.GetLayer(),
        0,
        this.m_maxError,
        ERROR_LOC.ERROR_INSIDE,
      );

    if (shape.OutlineCount() !== 0) gal.DrawPolygon(shape);
  }

  protected drawDimension(aDimension: PCB_DIMENSION_BASE, aLayer: number): void {
    const gal = this.m_gal!;
    const color = this.m_pcbSettings.GetColorForBoardItem(aDimension, aLayer);

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      gal.SetIsFill(true);
      gal.SetIsStroke(true);
      gal.SetFillColor(color);
      gal.SetStrokeColor(color);
      gal.SetLineWidth(this.m_lockedShadowMargin);

      for (const shape of aDimension.GetShapes()) {
        switch (shape.Type()) {
          case SHAPE_TYPE.SH_SEGMENT: {
            const seg = (shape as SHAPE_SEGMENT).GetSeg();
            gal.DrawSegment(seg.A, seg.B, this.m_lockedShadowMargin);
            break;
          }

          case SHAPE_TYPE.SH_CIRCLE: {
            const radius = (shape as SHAPE_CIRCLE).GetRadius();
            gal.DrawCircle(shape.Centre(), radius);
            break;
          }

          default:
            break;
        }
      }

      const poly = new SHAPE_POLY_SET();
      // aDimension->PCB_TEXT::TransformShapeToPolygon
      PCB_TEXT.prototype.TransformShapeToPolygon.call(
        aDimension,
        poly,
        aDimension.GetLayer(),
        0,
        this.m_maxError,
        ERROR_LOC.ERROR_OUTSIDE,
      );
      gal.DrawPolygon(poly);

      return;
    }

    gal.SetStrokeColor(color);
    gal.SetFillColor(color);
    gal.SetIsFill(false);
    gal.SetIsStroke(true);

    const outline_mode = !this.viewer_settings().m_ViewersDisplay.m_DisplayGraphicsFill;

    if (outline_mode) gal.SetLineWidth(this.m_pcbSettings.GetOutlineWidth());
    else gal.SetLineWidth(this.getLineThickness(aDimension.GetLineThickness()));

    // Draw dimension shapes
    // TODO(JE) lift this out
    for (const shape of aDimension.GetShapes()) {
      switch (shape.Type()) {
        case SHAPE_TYPE.SH_SEGMENT: {
          const seg = (shape as SHAPE_SEGMENT).GetSeg();
          gal.DrawLine(seg.A, seg.B);
          break;
        }

        case SHAPE_TYPE.SH_CIRCLE: {
          const radius = (shape as SHAPE_CIRCLE).GetRadius();
          gal.DrawCircle(shape.Centre(), radius);
          break;
        }

        default:
          break;
      }
    }

    // Draw text
    const resolvedText = aDimension.GetShownText(true);
    const attrs = aDimension.GetAttributes().clone();

    if (gal.IsFlippedX() && !aDimension.IsSideSpecific()) attrs.m_Mirrored = !attrs.m_Mirrored;

    if (outline_mode) attrs.m_StrokeWidth = this.m_pcbSettings.GetOutlineWidth();
    else attrs.m_StrokeWidth = this.getLineThickness(aDimension.GetEffectiveTextPenWidth());

    let cache: GLYPH_LIKE[] | null = null;

    if (aDimension.GetFont()?.IsOutline())
      cache = aDimension.GetRenderCache(aDimension.GetFont()!, resolvedText);

    if (cache) {
      for (const glyph of cache) gal.DrawGlyph(glyph);
    } else {
      this.strokeText(resolvedText, aDimension.GetTextPos(), attrs, aDimension.GetFontMetrics());
    }
  }

  protected drawTarget(aTarget: PCB_TARGET): void {
    const gal = this.m_gal!;
    const strokeColor = this.m_pcbSettings.GetColorForBoardItem(aTarget, aTarget.GetLayer());
    const position: Vec2 = aTarget.GetPosition();
    let size: number;
    let radius: number;

    gal.SetLineWidth(this.getLineThickness(aTarget.GetWidth()));
    gal.SetStrokeColor(strokeColor);
    gal.SetIsFill(false);
    gal.SetIsStroke(true);

    gal.Save();
    gal.Translate(position);

    if (aTarget.GetShape()) {
      // shape x
      gal.Rotate(Math.PI / 4.0);
      size = (2.0 * aTarget.GetSize()) / 3.0;
      radius = aTarget.GetSize() / 2.0;
    } else {
      // shape +
      size = aTarget.GetSize() / 2.0;
      radius = aTarget.GetSize() / 3.0;
    }

    gal.DrawLine({ x: -size, y: 0.0 }, { x: size, y: 0.0 });
    gal.DrawLine({ x: 0.0, y: -size }, { x: 0.0, y: size });
    gal.DrawCircle({ x: 0.0, y: 0.0 }, radius);

    gal.Restore();
  }

  protected drawPoint(aPoint: PCB_POINT, aLayer: number): void {
    const gal = this.m_gal!;

    // aLayer will be the virtual point layer (LAYER_POINT_START, ... in GAL_LAYER_ID).
    // This is used for draw ordering in the GAL.
    // The cross color comes from LAYER_POINTS and the ring color follows the point's board layer.
    // Visibility comes from the combination of that board layer and LAYER_POINTS.

    const size = aPoint.GetSize() / 2;

    // Keep the width constant, not related to the scale because the anchor
    // is just a marker on screen, just draw in pixels
    let thickness = this.m_pcbSettings.GetOutlineWidth();

    // The general "points" colour
    let crossColor = this.m_pcbSettings.GetColorForBoardItem(aPoint, LAYER_POINTS);
    // The colour for the ring around the point follows the "real" layer of the point
    let ringColor = this.m_pcbSettings.GetColorForBoardItem(aPoint, aPoint.GetLayer());

    if (aLayer === LAYER_LOCKED_ITEM_SHADOW) {
      thickness += this.m_lockedShadowMargin;
      crossColor = this.m_pcbSettings.GetColorForBoardItem(aPoint, aLayer);
      ringColor = this.m_pcbSettings.GetColorForBoardItem(aPoint, aLayer);
    }

    const position: Vec2 = aPoint.GetPosition();

    gal.SetLineWidth(thickness);
    gal.SetStrokeColor(crossColor);
    gal.SetIsFill(false);
    gal.SetIsStroke(true);

    gal.Save();
    gal.Translate(position);

    // Draw as X to make it clearer when overlaid on cursor or axes
    gal.DrawLine({ x: -size, y: -size }, { x: size, y: size });
    gal.DrawLine({ x: size, y: -size }, { x: -size, y: size });

    // Draw the circle in the layer colour
    gal.SetStrokeColor(ringColor);
    gal.DrawCircle({ x: 0.0, y: 0.0 }, size / 2);

    gal.Restore();
  }

  protected drawMarker(aMarker: PCB_MARKER, aLayer: number): void {
    const gal = this.m_gal!;

    // Don't paint invisible markers.
    // It would be nice to do this through layer dependencies but we can't do an "or" there today
    if (aMarker.GetBoard() && !aMarker.GetBoard()!.IsElementVisible(aMarker.GetColorLayer()))
      return;

    const color = this.m_pcbSettings.GetColorForBoardItem(aMarker, aMarker.GetColorLayer());

    aMarker.SetZoom(1.0 / Math.sqrt(gal.GetZoomFactor()));

    switch (aLayer) {
      case LAYER_MARKER_SHADOWS:
      case LAYER_DRC_ERROR:
      case LAYER_DRC_WARNING: {
        const isShadow = aLayer === LAYER_MARKER_SHADOWS;

        const polygon = new SHAPE_LINE_CHAIN();
        aMarker.ShapeToPolygon(polygon);

        gal.Save();
        gal.Translate(aMarker.GetPosition());

        if (isShadow) {
          gal.SetStrokeColor(
            this.m_pcbSettings.GetColorForBoardItem(aMarker, LAYER_MARKER_SHADOWS),
          );
          gal.SetIsStroke(true);
          gal.SetLineWidth(aMarker.MarkerScale());
        } else {
          gal.SetFillColor(color);
          gal.SetIsFill(true);
        }

        gal.DrawPolygon(polygon);
        gal.Restore();
        break;
      }

      case LAYER_DRC_SHAPES:
        if (!aMarker.IsBrightened()) return;

        for (const shape of aMarker.GetShapes()) {
          if (shape.GetStroke().GetWidth() === 1.0) {
            gal.SetIsFill(false);
            gal.SetIsStroke(true);
            gal.SetStrokeColor(COLOR4D_WHITE);
            gal.SetLineWidth(KiROUND(aMarker.MarkerScale() / 2.0));

            if (shape.GetShape() === SHAPE_T.SEGMENT) {
              gal.DrawLine(shape.GetStart(), shape.GetEnd());
            } else if (shape.GetShape() === SHAPE_T.ARC) {
              const angles = shape.CalcArcAngles();
              gal.DrawArc(shape.GetCenter(), shape.GetRadius(), angles[0], shape.GetArcAngle());
            }
          } else {
            gal.SetIsFill(true);
            gal.SetIsStroke(false);
            gal.SetFillColor(withAlpha(color, 0.5));

            if (shape.GetShape() === SHAPE_T.SEGMENT) {
              gal.DrawSegment(shape.GetStart(), shape.GetEnd(), shape.GetWidth());
            } else if (shape.GetShape() === SHAPE_T.ARC) {
              const angles = shape.CalcArcAngles();
              gal.DrawArcSegment(
                shape.GetCenter(),
                shape.GetRadius(),
                angles[0],
                shape.GetArcAngle(),
                shape.GetWidth(),
                ARC_HIGH_DEF,
              );
            }
          }
        }

        break;
    }
  }

  protected drawBoardOutline(aBoardOutline: PCB_BOARD_OUTLINE, aLayer: number): void {
    const gal = this.m_gal!;

    if (!aBoardOutline.HasOutline()) return;

    // aBoardOutline makes sense only for the board editor. for fp holder boards
    // there are no board outlines area.
    const brd = aBoardOutline.GetBoard();

    if (!brd || brd.GetBoardUse() === BOARD_USE.FPHOLDER) return;

    GAL_SCOPED_ATTRS(gal, GAL_SCOPED_ATTRS_FLAGS.ALL_ATTRS, () => {
      gal.Save();

      const outlineColor = this.m_pcbSettings.GetColorForBoardItem(aBoardOutline, aLayer);
      gal.SetFillColor(outlineColor);
      gal.AdvanceDepth();
      gal.SetLineWidth(0);
      gal.SetIsFill(true);
      gal.SetIsStroke(false);
      gal.DrawPolygon(aBoardOutline.GetOutline());

      gal.Restore();
    });
  }

  protected drawBackdrillIndicator(
    aItem: BOARD_ITEM,
    aCenter: Vec2,
    aDrillSize: number,
    aStartLayer: PCB_LAYER_ID,
    aEndLayer: PCB_LAYER_ID,
  ): void {
    const gal = this.m_gal!;
    const backdrillRadius = aDrillSize / 2.0;
    const lineWidth = Math.max(backdrillRadius / 4.0, this.m_pcbSettings.GetOutlineWidth() * 2.0);

    GAL_SCOPED_ATTRS(gal, GAL_SCOPED_ATTRS_FLAGS.ALL_ATTRS, () => {
      gal.AdvanceDepth();
      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetLineWidth(lineWidth);

      // Draw semi-circle in start layer color (top half, from 90° to 270°)
      gal.SetStrokeColor(this.m_pcbSettings.GetColorForBoardItem(aItem, aStartLayer));
      gal.DrawArc(aCenter, backdrillRadius, new EDA_ANGLE(90), new EDA_ANGLE(180));

      // Draw semi-circle in end layer color (bottom half, from 270° to 90°)
      gal.SetStrokeColor(this.m_pcbSettings.GetColorForBoardItem(aItem, aEndLayer));
      gal.DrawArc(aCenter, backdrillRadius, new EDA_ANGLE(270), new EDA_ANGLE(180));
    });
  }

  protected drawPostMachiningIndicator(
    aItem: BOARD_ITEM,
    aCenter: Vec2,
    aLayer: PCB_LAYER_ID,
  ): void {
    const gal = this.m_gal!;
    let size = 0;

    // Check to see if the pad or via has a post-machining operation on this layer
    if (aItem instanceof PAD) {
      size = aItem.GetPostMachiningKnockout(aLayer);
    } else if (aItem instanceof PCB_VIA) {
      size = aItem.GetPostMachiningKnockout(aLayer);
    }

    if (size <= 0) return;

    GAL_SCOPED_ATTRS(gal, GAL_SCOPED_ATTRS_FLAGS.ALL_ATTRS, () => {
      gal.AdvanceDepth();

      const pmRadius = size / 2.0;

      // Use a line width proportional to the radius for visibility
      const lineWidth = Math.max(pmRadius / 8.0, this.m_pcbSettings.GetOutlineWidth() * 2.0);

      const layerColor = this.m_pcbSettings.GetColorForBoardItem(aItem, aLayer);

      gal.SetIsFill(false);
      gal.SetIsStroke(true);
      gal.SetStrokeColor(layerColor);
      gal.SetLineWidth(lineWidth);

      // Draw dashed circle manually with fixed number of segments for consistent appearance
      const NUM_DASHES = 12; // Number of dashes around the circle
      const dashAngle = ANGLE_360.divide(NUM_DASHES * 2); // Dash and gap are equal size

      for (let i = 0; i < NUM_DASHES; ++i) {
        const startAngle = dashAngle.multiply(i * 2);
        gal.DrawArc(aCenter, pmRadius, startAngle, dashAngle);
      }
    });
  }
}

export function ZoneOutlineDrawnOnLayer(aOutlineOnly: boolean, aLayer: number): boolean {
  if (aOutlineOnly) return IsZoneFillLayer(aLayer);

  return !IsZoneFillLayer(aLayer);
}

/** `std::dynamic_pointer_cast<SHAPE_COMPOUND>`. */
function asCompound(aShape: SHAPE | null): SHAPE_COMPOUND | null {
  if (aShape && aShape.Type() === SHAPE_TYPE.SH_COMPOUND) return aShape as SHAPE_COMPOUND;
  return null;
}

/** `( a + b ) / 2` on VECTOR2I. */
function mid(a: VECTOR2I, b: VECTOR2I): VECTOR2I {
  return { x: Math.trunc((a.x + b.x) / 2), y: Math.trunc((a.y + b.y) / 2) };
}

export type { SEG };
