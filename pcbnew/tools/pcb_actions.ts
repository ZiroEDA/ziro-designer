// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_ACTIONS` (pcbnew/tools/pcb_actions.h, pcb_actions.cpp): every tool
 * action of the board and footprint editors, each a static TOOL_ACTION
 * registered with ACTION_MANAGER as it is built, exactly as the C++ statics
 * are. The strings are the C++'s untranslated `_()` sources. Generated from
 * pcb_actions.cpp with the `__WXMAC__` branches dropped (the GTK build).
 *
 * Seven actions the header declares are never defined in the C++ (`find`,
 * `measureTool`, `pickerTool`, `regenerateItem`, `remove`, `selectionMenu`,
 * `selectionTool`) and are not here either.
 */
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { BITMAPS } from '@ziroeda/common/bitmaps_list.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { ACTIONS, CURSOR_EVENT_TYPE, REMOVE_FLAGS } from '@ziroeda/common/tool/actions.js';
import {
  TOOL_ACTION,
  TOOL_ACTION_ARGS,
  TOOL_ACTION_FLAGS,
  TOOL_ACTION_GROUP,
  TOOL_ACTION_SCOPE,
  TOOLBAR_STATE,
} from '@ziroeda/common/tool/tool_action.js';
import {
  MD_ALT,
  MD_CTRL,
  MD_SHIFT,
  TOOL_EVENT,
  TOOL_EVENT_CATEGORY,
  TOOL_ACTIONS,
} from '@ziroeda/common/tool/tool_event.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_REFERENCE_IMAGE } from '../pcb_reference_image.js';
import { PnsDragMode } from '../router/pns_drag_algo.js';
import { PnsMode } from '../router/pns_routing_settings.js';
import { PnsRouterMode } from '../router/pns_router.js';
import type { ZONE } from '../zone.js';

/** `'N'` in a hotkey: the character's code, as C++ `int` promotion gives it. */
const ch = (c: string): number => c.charCodeAt(0);

export enum ZONE_MODE {
  ADD, ///< Add a new zone/keepout with fresh settings
  CUTOUT, ///< Make a cutout to an existing zone
  SIMILAR, ///< Add a new zone with the same settings as an existing one
  GRAPHIC_POLYGON,
}

/** `FPVIEWER_CONSTANTS` (pcbnew/footprint_viewer_frame.h:43). */
export enum FPVIEWER_CONSTANTS {
  NEW_PART = 0,
  NEXT_PART = 1,
  PREVIOUS_PART = 2,
  RELOAD_PART = 3,
}

// Microwave shapes that are created as board footprints when the user requests them.
// (pcbnew/microwave/microwave_tool.h:32)
export enum MICROWAVE_FOOTPRINT_SHAPE {
  GAP,
  STUB,
  STUB_ARC,
  FUNCTION_SHAPE,
}

/**
 * `PCB_PICKER_TOOL::INTERACTIVE_PARAMS` (pcbnew/tools/pcb_picker_tool.h:55);
 * the tool lands at stage 3, its parameter's shape is here.
 */
export interface INTERACTIVE_PARAMS {
  m_Receiver: unknown | null;
  m_Prompt: string;
  m_ItemFilter: ((aItem: EDA_ITEM) => boolean) | null;
}

/** `DESIGN_BLOCK` (common/design_block.h): pending with the design-block library. */
export type DESIGN_BLOCK = unknown;

export class PCB_ACTIONS extends ACTIONS {
  /**
   * Translate a layer ID into the action that switches to that layer.
   *
   * @param aLayerID is the layer to switch to
   * @return the action that will switch to the specified layer
   */
  static LayerIDToAction(aLayer: PCB_LAYER_ID): TOOL_ACTION | null {
    switch (aLayer) {
      case PCB_LAYER_ID.F_Cu:
        return PCB_ACTIONS.layerTop;
      case PCB_LAYER_ID.In1_Cu:
        return PCB_ACTIONS.layerInner1;
      case PCB_LAYER_ID.In2_Cu:
        return PCB_ACTIONS.layerInner2;
      case PCB_LAYER_ID.In3_Cu:
        return PCB_ACTIONS.layerInner3;
      case PCB_LAYER_ID.In4_Cu:
        return PCB_ACTIONS.layerInner4;
      case PCB_LAYER_ID.In5_Cu:
        return PCB_ACTIONS.layerInner5;
      case PCB_LAYER_ID.In6_Cu:
        return PCB_ACTIONS.layerInner6;
      case PCB_LAYER_ID.In7_Cu:
        return PCB_ACTIONS.layerInner7;
      case PCB_LAYER_ID.In8_Cu:
        return PCB_ACTIONS.layerInner8;
      case PCB_LAYER_ID.In9_Cu:
        return PCB_ACTIONS.layerInner9;
      case PCB_LAYER_ID.In10_Cu:
        return PCB_ACTIONS.layerInner10;
      case PCB_LAYER_ID.In11_Cu:
        return PCB_ACTIONS.layerInner11;
      case PCB_LAYER_ID.In12_Cu:
        return PCB_ACTIONS.layerInner12;
      case PCB_LAYER_ID.In13_Cu:
        return PCB_ACTIONS.layerInner13;
      case PCB_LAYER_ID.In14_Cu:
        return PCB_ACTIONS.layerInner14;
      case PCB_LAYER_ID.In15_Cu:
        return PCB_ACTIONS.layerInner15;
      case PCB_LAYER_ID.In16_Cu:
        return PCB_ACTIONS.layerInner16;
      case PCB_LAYER_ID.In17_Cu:
        return PCB_ACTIONS.layerInner17;
      case PCB_LAYER_ID.In18_Cu:
        return PCB_ACTIONS.layerInner18;
      case PCB_LAYER_ID.In19_Cu:
        return PCB_ACTIONS.layerInner19;
      case PCB_LAYER_ID.In20_Cu:
        return PCB_ACTIONS.layerInner20;
      case PCB_LAYER_ID.In21_Cu:
        return PCB_ACTIONS.layerInner21;
      case PCB_LAYER_ID.In22_Cu:
        return PCB_ACTIONS.layerInner22;
      case PCB_LAYER_ID.In23_Cu:
        return PCB_ACTIONS.layerInner23;
      case PCB_LAYER_ID.In24_Cu:
        return PCB_ACTIONS.layerInner24;
      case PCB_LAYER_ID.In25_Cu:
        return PCB_ACTIONS.layerInner25;
      case PCB_LAYER_ID.In26_Cu:
        return PCB_ACTIONS.layerInner26;
      case PCB_LAYER_ID.In27_Cu:
        return PCB_ACTIONS.layerInner27;
      case PCB_LAYER_ID.In28_Cu:
        return PCB_ACTIONS.layerInner28;
      case PCB_LAYER_ID.In29_Cu:
        return PCB_ACTIONS.layerInner29;
      case PCB_LAYER_ID.In30_Cu:
        return PCB_ACTIONS.layerInner30;
      case PCB_LAYER_ID.B_Cu:
        return PCB_ACTIONS.layerBottom;
      default:
        return null;
    }
  }

  // Implemented as an accessor + static variable to ensure it is initialized when used
  // in static action constructors
  private static s_toolActionGroup: TOOL_ACTION_GROUP | null = null;

  static layerDirectSwitchActions(): TOOL_ACTION_GROUP {
    if (!PCB_ACTIONS.s_toolActionGroup)
      PCB_ACTIONS.s_toolActionGroup = new TOOL_ACTION_GROUP('pcbnew.Control.DirectLayerActions');

    return new TOOL_ACTION_GROUP(PCB_ACTIONS.s_toolActionGroup);
  }

  static readonly convertToPoly = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToPoly')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Polygon from Selection...')
      .Tooltip('Creates a graphic polygon from the selection')
      .Icon(BITMAPS.add_graphical_polygon),
  );

  static readonly convertToZone = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToZone')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Zone from Selection...')
      .Tooltip('Creates a copper zone from the selection')
      .Icon(BITMAPS.add_zone),
  );

  static readonly convertToKeepout = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToKeepout')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Rule Area from Selection...')
      .Tooltip('Creates a rule area from the selection')
      .Icon(BITMAPS.add_keepout_area),
  );

  static readonly convertToLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Lines from Selection...')
      .Tooltip('Creates graphic lines from the selection')
      .Icon(BITMAPS.add_line),
  );

  static readonly convertToArc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToArc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Arc from Selection')
      .Tooltip('Creates an arc from the selected line segment')
      .Icon(BITMAPS.add_arc),
  );

  static readonly convertToTracks = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToTracks')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Tracks from Selection')
      .Tooltip('Creates tracks from the selected graphic lines')
      .Icon(BITMAPS.add_tracks),
  );

  static readonly outsetItems = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.outsetItems')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Outsets from Selection...')
      .Tooltip('Create outset lines from the selected item')
      .Icon(BITMAPS.outset_from_selection),
  );

  static readonly drawLine = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.line')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('L'))
      .LegacyHotkeyName('Draw Line')
      .FriendlyName('Draw Lines')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_graphical_segments)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawPolygon = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.graphicPolygon')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('P'))
      .LegacyHotkeyName('Draw Graphic Polygon')
      .FriendlyName('Draw Polygons')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_graphical_polygon)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(ZONE_MODE.GRAPHIC_POLYGON),
  );

  static readonly drawRectangle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.rectangle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Rectangles')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_rectangle)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawCircle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.circle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('C'))
      .LegacyHotkeyName('Draw Circle')
      .FriendlyName('Draw Circles')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_circle)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawArc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.arc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('A'))
      .LegacyHotkeyName('Draw Arc')
      .FriendlyName('Draw Arcs')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_arc)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawBezier = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.bezier')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('B'))
      .FriendlyName('Draw Bezier Curve')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_bezier)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placeBarcode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.barcode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Add Barcode')
      .FriendlyName('Add Barcode')
      .Tooltip('Add a barcode')
      .Icon(BITMAPS.add_barcode)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placeCharacteristics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeCharacteristics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Add Board Characteristics')
      .FriendlyName('Add Board Characteristics')
      .Tooltip('Add a board characteristics table on a graphic layer')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placeStackup = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeStackup')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Add Stackup Table')
      .FriendlyName('Add Stackup Table')
      .Tooltip('Add a board stackup table on a graphic layer')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placePoint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placePoint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Place Point')
      .Tooltip('Add reference/snap points')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_point)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placeReferenceImage = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeReferenceImage')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Place Reference Images')
      .Tooltip(
        'Add bitmap images to be used as reference (images will not be included in any output)',
      )
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.image)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter<PCB_REFERENCE_IMAGE | null>(null),
  );

  static readonly placeText = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.text')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('T'))
      .LegacyHotkeyName('Add Text')
      .FriendlyName('Draw Text')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.text)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawTextBox = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.textbox')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Text Boxes')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_textbox)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.drawTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Tables')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.table)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly spacingIncrease = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.lengthTuner.SpacingIncrease')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('1'))
      .LegacyHotkeyName('Increase meander spacing by one step.')
      .FriendlyName('Increase Spacing')
      .Tooltip('Increase tuning pattern spacing by one step.')
      .Icon(BITMAPS.router_len_tuner_dist_incr),
  );

  static readonly spacingDecrease = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.lengthTuner.SpacingDecrease')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('2'))
      .LegacyHotkeyName('Decrease meander spacing by one step.')
      .FriendlyName('Decrease Spacing')
      .Tooltip('Decrease tuning pattern spacing by one step.')
      .Icon(BITMAPS.router_len_tuner_dist_decr),
  );

  static readonly amplIncrease = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.lengthTuner.AmplIncrease')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('3'))
      .LegacyHotkeyName('Increase meander amplitude by one step.')
      .FriendlyName('Increase Amplitude')
      .Tooltip('Increase tuning pattern amplitude by one step.')
      .Icon(BITMAPS.router_len_tuner_amplitude_incr),
  );

  static readonly amplDecrease = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.lengthTuner.AmplDecrease')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('4'))
      .LegacyHotkeyName('Decrease meander amplitude by one step.')
      .FriendlyName('Decrease Amplitude')
      .Tooltip('Decrease tuning pattern amplitude by one step.')
      .Icon(BITMAPS.router_len_tuner_amplitude_decr),
  );

  static readonly drawAlignedDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.alignedDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Add Dimension')
      .FriendlyName('Draw Aligned Dimensions')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_aligned_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawCenterDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.centerDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Center Dimensions')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_center_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawRadialDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.radialDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Radial Dimensions')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_radial_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawOrthogonalDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.orthogonalDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('H'))
      .FriendlyName('Draw Orthogonal Dimensions')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_orthogonal_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawLeader = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.leader')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Leaders')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_leader)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawZone = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.zone')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('Z'))
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('Z'))
      .LegacyHotkeyName('Add Filled Zone')
      .FriendlyName('Draw Filled Zones')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_zone)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(ZONE_MODE.ADD),
  );

  static readonly drawVia = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.via')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('X'))
      .LegacyHotkeyName('Add Vias')
      .FriendlyName('Place Vias')
      .Tooltip('Place free-standing vias')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_via)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawRuleArea = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.ruleArea')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('K'))
      .LegacyHotkeyName('Add Keepout Area')
      .FriendlyName('Draw Rule Areas')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_keepout_area)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(ZONE_MODE.ADD),
  );

  static readonly drawZoneCutout = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.zoneCutout')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('C'))
      .LegacyHotkeyName('Add a Zone Cutout')
      .FriendlyName('Add a Zone Cutout')
      .Tooltip('Add a cutout to an existing zone or rule area')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_zone_cutout)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(ZONE_MODE.CUTOUT),
  );

  static readonly drawSimilarZone = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.similarZone')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('.'))
      .LegacyHotkeyName('Add a Similar Zone')
      .FriendlyName('Add a Similar Zone')
      .Tooltip('Add a zone with the same settings as an existing zone')
      .Icon(BITMAPS.add_zone)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(ZONE_MODE.SIMILAR),
  );

  static readonly placeImportedGraphics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeImportedGraphics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('F'))
      .LegacyHotkeyName('Place DXF')
      .FriendlyName('Import Graphics...')
      .Tooltip('Import 2D drawing file')
      .Icon(BITMAPS.import_vector)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly setAnchor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.setAnchor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('N'))
      .LegacyHotkeyName('Place the Footprint Anchor')
      .FriendlyName('Place the Footprint Anchor')
      .Tooltip('Set the anchor point of the footprint')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.anchor)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly incWidth = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.incWidth')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(MD_CTRL + ch('+'))
      .LegacyHotkeyName('Increase Line Width')
      .FriendlyName('Increase Line Width'),
  );

  static readonly decWidth = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.decWidth')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(MD_CTRL + ch('-'))
      .LegacyHotkeyName('Decrease Line Width')
      .FriendlyName('Decrease Line Width'),
  );

  static readonly arcPosture = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.arcPosture')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(ch('/'))
      .LegacyHotkeyName('Switch Track Posture')
      .FriendlyName('Switch Arc Posture'),
  );

  static readonly changeDimensionArrows = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.changeDimensionArrows')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .FriendlyName('Switch Dimension Arrows')
      .Tooltip('Switch between inward and outward dimension arrows'),
  );

  static readonly magneticSnapActiveLayer = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.magneticSnapActiveLayer')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Snap to Objects on the Active Layer Only')
      .Tooltip('Enables snapping to objects on the active layer only'),
  );

  static readonly magneticSnapAllLayers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.magneticSnapAllLayers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Snap to Objects on All Layers')
      .Tooltip('Enables snapping to objects on all visible layers'),
  );

  static readonly magneticSnapToggle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.magneticSnapToggle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('S'))
      .FriendlyName('Toggle Snapping Between Active and All Layers')
      .Tooltip('Toggles between snapping on all visible layers and only the active area'),
  );

  static readonly deleteLastPoint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.deleteLastPoint')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(WXK.WXK_BACK)
      .FriendlyName('Delete Last Point')
      .Tooltip('Delete the last point added to the current item')
      .Icon(BITMAPS.undo),
  );

  static readonly closeOutline = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.closeOutline')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .FriendlyName('Close Outline')
      .Tooltip('Close the in progress outline')
      .Icon(BITMAPS.checked_ok),
  );

  static readonly runDRC = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.DRCTool.runDRC')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Design Rules Checker')
      .Tooltip('Show the design rules checker window')
      .Icon(BITMAPS.erc),
  );

  static readonly placeDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('B'))
      .FriendlyName('Place Design Block')
      .Tooltip('Add selected design block to current board')
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter<DESIGN_BLOCK | null>(null),
  );

  static readonly placeLinkedDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeLinkedDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Place Linked Design Block')
      .Tooltip('Place design block linked to selected group')
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter<boolean | null>(null),
  );

  static readonly applyDesignBlockLayout = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.applyDesignBlockLayout')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Apply Design Block Layout')
      .Tooltip('Apply linked design block layout to selected group')
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly saveToLinkedDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.saveToLinkedDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Save to Linked Design Block')
      .Tooltip('Save selected group to linked design block')
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly showDesignBlockPanel = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.showDesignBlockPanel')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Design Blocks')
      .Tooltip('Show/hide design blocks library')
      .Icon(BITMAPS.search_tree),
  );

  static readonly saveBoardAsDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.saveBoardAsDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Save Board as Design Block...')
      .Tooltip('Create a new design block from the current board')
      .Icon(BITMAPS.new_component),
  );

  static readonly saveSelectionAsDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.saveSelectionAsDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Save Selection as Design Block...')
      .Tooltip('Create a new design block from the current selection')
      .Icon(BITMAPS.new_component),
  );

  static readonly updateDesignBlockFromBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.updateDesignBlockFromBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Update Design Block from Board')
      .Tooltip('Set design block layout to current board')
      .Icon(BITMAPS.save),
  );

  static readonly updateDesignBlockFromSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.updateDesignBlockFromSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Update Design Block from Selection')
      .Tooltip('Set design block layout to current selection')
      .Icon(BITMAPS.save),
  );

  static readonly deleteDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.deleteDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Delete Design Block')
      .Tooltip('Remove the selected design block from its library')
      .Icon(BITMAPS.trash),
  );

  static readonly editDesignBlockProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.editDesignBlockProperties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Properties...')
      .Tooltip('Edit properties of design block')
      .Icon(BITMAPS.edit),
  );

  static readonly editFpInFpEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.EditFpInFpEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .LegacyHotkeyName('Edit with Footprint Editor')
      .FriendlyName('Open in Footprint Editor')
      .Icon(BITMAPS.module_editor),
  );

  static readonly editLibFpInFpEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.EditLibFpInFpEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('E'))
      .FriendlyName('Edit Library Footprint...')
      .Icon(BITMAPS.module_editor),
  );

  static readonly toggleExcludeFromBOM = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.toggleExcludeFromBOM')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Exclude from Bill of Materials')
      .Tooltip('Toggle the exclude from bill of materials attribute'),
  );

  static readonly toggleExcludeFromPosFiles = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.toggleExcludeFromPosFiles')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Exclude from Position Files')
      .Tooltip('Toggle the exclude from position files attribute'),
  );

  static readonly getAndPlace = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.FindMove')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('T'))
      .LegacyHotkeyName('Get and Move Footprint')
      .FriendlyName('Get and Move Footprint')
      .Tooltip(
        'Selects a footprint by reference designator and places it under the cursor for moving',
      )
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly move = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveMove.move')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('M'))
      .LegacyHotkeyName('Move Item')
      .FriendlyName('Move')
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_NONE),
  );

  static readonly moveIndividually = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveMove.moveIndividually')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('M'))
      .FriendlyName('Move Individually')
      .Tooltip('Moves the selected items one-by-one')
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_NONE),
  );

  static readonly moveWithReference = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveMove.moveWithReference')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Move with Reference...')
      .Tooltip('Moves the selected item(s) with a specified starting point')
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_NONE),
  );

  static readonly copyWithReference = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveMove.copyWithReference')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Copy with Reference...')
      .Tooltip('Copy selected item(s) to clipboard with a specified starting point')
      .Icon(BITMAPS.copy)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly duplicateIncrement = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.duplicateIncrementPads')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('D'))
      .LegacyHotkeyName('Duplicate Item and Increment')
      .FriendlyName('Duplicate and Increment')
      .Tooltip('Duplicates the selected item(s), incrementing pad numbers')
      .Icon(BITMAPS.duplicate),
  );

  static readonly moveExact = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.moveExact')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('M'))
      .LegacyHotkeyName('Move Item Exactly')
      .FriendlyName('Move Exactly...')
      .Tooltip('Moves the selected item(s) by an exact amount')
      .Icon(BITMAPS.move_exactly),
  );

  static readonly pointEditorMoveCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.moveCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Move Corner To...')
      .Tooltip('Move the active corner to an exact location')
      .Icon(BITMAPS.move_exactly),
  );

  static readonly pointEditorMoveMidpoint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.moveMidpoint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Move Midpoint To...')
      .Tooltip('Move the active midpoint to an exact location')
      .Icon(BITMAPS.move_exactly),
  );

  static readonly rotateCw = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.rotateCw')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('R'))
      .LegacyHotkeyName('Rotate Item Clockwise (Modern Toolset only)')
      .FriendlyName('Rotate Clockwise')
      .Icon(BITMAPS.rotate_cw)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(-1),
  );

  static readonly rotateCcw = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.rotateCcw')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('R'))
      .LegacyHotkeyName('Rotate Item')
      .FriendlyName('Rotate Counterclockwise')
      .Icon(BITMAPS.rotate_ccw)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(1),
  );

  static readonly flip = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.flip')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('F'))
      .LegacyHotkeyName('Flip Item')
      .FriendlyName('Change Side / Flip')
      .Tooltip('Flips selected item(s) to opposite side of board')
      .Icon(BITMAPS.swap_layer),
  );

  static readonly mirrorH = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.mirrorHoriontally')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Mirror Horizontally')
      .Tooltip('Mirrors selected item(s) across the Y axis')
      .Icon(BITMAPS.mirror_h),
  );

  static readonly mirrorV = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.mirrorVertically')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Mirror Vertically')
      .Tooltip('Mirrors selected item(s) across the X axis')
      .Icon(BITMAPS.mirror_v),
  );

  static readonly swap = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.swap')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('S'))
      .FriendlyName('Swap')
      .Tooltip('Swap positions of selected items')
      .Icon(BITMAPS.swap),
  );

  static readonly swapPadNets = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.swapPadNets')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Swap Pad Nets')
      .Tooltip('Swap nets between two selected pads and their connected copper')
      .Icon(BITMAPS.swap),
  );

  static readonly swapGateNets = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.swapGateNets')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Swap Gate Nets')
      .Tooltip('Swap nets between gates of a footprint and their connected copper')
      .Parameter<string>('')
      .Icon(BITMAPS.swap),
  );

  static readonly packAndMoveFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.packAndMoveFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('P'))
      .FriendlyName('Pack and Move Footprints')
      .Tooltip('Sorts selected footprints by reference, packs based on size and initiates movement')
      .Icon(BITMAPS.pack_footprints),
  );

  static readonly skip = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.skip')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(WXK.WXK_TAB)
      .FriendlyName('Skip')
      .Tooltip('Skip to next item')
      .Icon(BITMAPS.right),
  );

  static readonly changeTrackWidth = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.changeTrackWidth')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Change Track Width')
      .Tooltip('Updates selected track & via sizes'),
  );

  static readonly changeTrackLayerNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.changeTrackLayerNext')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('+'))
      .FriendlyName('Switch Track to Next Layer')
      .Tooltip('Switch track to next enabled copper layer'),
  );

  static readonly changeTrackLayerPrev = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.changeTrackLayerPrev')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('-'))
      .FriendlyName('Switch Track to Previous Layer')
      .Tooltip('Switch track to previous enabled copper layer'),
  );

  static readonly filletTracks = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.filletTracks')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Fillet Tracks')
      .Tooltip('Adds arcs tangent to the selected straight track segments'),
  );

  static readonly filletLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.filletLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Fillet Lines...')
      .Tooltip('Adds arcs tangent to the selected lines')
      .Icon(BITMAPS.fillet),
  );

  static readonly chamferLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.chamferLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Chamfer Lines...')
      .Tooltip('Cut away corners between selected lines')
      .Icon(BITMAPS.chamfer),
  );

  static readonly dogboneCorners = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.dogboneCorners')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Dogbone Corners...')
      .Tooltip('Add dogbone corners to selected lines'),
  );

  static readonly simplifyPolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.simplifyPolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Simplify Polygons')
      .Tooltip('Simplify polygon outlines, removing superfluous points'),
  );

  static readonly editVertices = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.editVertices')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Edit Corners...')
      .Tooltip('Edit polygon corners using a table')
      .Icon(BITMAPS.edit),
  );

  static readonly healShapes = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.healShapes')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Heal Shapes')
      .Tooltip('Connect shapes, possibly extending or cutting them, or adding extra geometry')
      .Icon(BITMAPS.heal_shapes),
  );

  static readonly extendLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.extendLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Extend Lines to Meet')
      .Tooltip('Extend lines to meet each other'),
  );

  static readonly mergePolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.mergePolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Merge Polygons')
      .Tooltip('Merge selected polygons into a single polygon')
      .Icon(BITMAPS.merge_polygons),
  );

  static readonly subtractPolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.subtractPolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Subtract Polygons')
      .Tooltip('Subtract selected polygons from the last one selected')
      .Icon(BITMAPS.subtract_polygons),
  );

  static readonly intersectPolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.intersectPolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Intersect Polygons')
      .Tooltip('Create the intersection of the selected polygons')
      .Icon(BITMAPS.intersect_polygons),
  );

  static readonly deleteFull = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.deleteFull')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + WXK.WXK_DELETE)
      .LegacyHotkeyName('Delete Full Track')
      .FriendlyName('Delete Full Track')
      .Tooltip('Deletes selected item(s) and copper connections')
      .Icon(BITMAPS.delete_cursor)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(REMOVE_FLAGS.ALT),
  );

  static readonly properties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.properties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('E'))
      .LegacyHotkeyName('Edit Item')
      .FriendlyName('Properties...')
      .Icon(BITMAPS.edit),
  );

  static readonly createArray = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Array.createArray')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('T'))
      .LegacyHotkeyName('Create Array')
      .FriendlyName('Create Array...')
      .Icon(BITMAPS.array)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly newFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.newFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('N'))
      .LegacyHotkeyName('New')
      .FriendlyName('New Footprint')
      .Tooltip('Create a new, empty footprint')
      .Icon(BITMAPS.new_footprint),
  );

  static readonly createFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.createFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Create Footprint...')
      .Tooltip('Create a new footprint using the Footprint Wizard')
      .Icon(BITMAPS.module_wizard),
  );

  static readonly editFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.editFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Edit Footprint')
      .Tooltip('Show selected footprint on editor canvas')
      .Icon(BITMAPS.edit),
  );

  static readonly duplicateFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.duplicateFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Duplicate Footprint')
      .Icon(BITMAPS.duplicate),
  );

  static readonly renameFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.renameFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Rename Footprint...')
      .Icon(BITMAPS.edit),
  );

  static readonly deleteFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.deleteFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Delete Footprint from Library')
      .Icon(BITMAPS.trash),
  );

  static readonly cutFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.cutFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Cut Footprint')
      .Icon(BITMAPS.cut),
  );

  static readonly copyFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.copyFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Copy Footprint')
      .Icon(BITMAPS.copy),
  );

  static readonly pasteFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.pasteFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Paste Footprint')
      .Icon(BITMAPS.paste),
  );

  static readonly importFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.importFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Import Footprint...')
      .Tooltip('Import footprint from file')
      .Icon(BITMAPS.import_module),
  );

  static readonly exportFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.exportFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export Current Footprint...')
      .Tooltip('Export edited footprint to file')
      .Icon(BITMAPS.export_module),
  );

  static readonly footprintProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.footprintProperties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Footprint Properties...')
      .Icon(BITMAPS.module_options),
  );

  static readonly padTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.padTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Pad Table...')
      .Tooltip('Displays pad table for bulk editing of pads')
      .Icon(BITMAPS.pin_table),
  );

  static readonly checkFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.checkFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Footprint Checker')
      .Tooltip('Show the footprint checker window')
      .Icon(BITMAPS.erc),
  );

  static readonly loadFpFromBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.loadFootprintFromBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Load footprint from current PCB')
      .Tooltip('Load footprint from current board')
      .Icon(BITMAPS.load_module_board),
  );

  static readonly saveFpToBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.saveFootprintToBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Insert footprint into PCB')
      .Tooltip('Insert footprint into current board')
      .Icon(BITMAPS.insert_module_board),
  );

  static readonly previousFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.previousFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Display previous footprint')
      .Icon(BITMAPS.lib_previous)
      .Parameter<FPVIEWER_CONSTANTS>(FPVIEWER_CONSTANTS.PREVIOUS_PART),
  );

  static readonly nextFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.nextFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Display next footprint')
      .Icon(BITMAPS.lib_next)
      .Parameter<FPVIEWER_CONSTANTS>(FPVIEWER_CONSTANTS.NEXT_PART),
  );

  static readonly updateFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.updateFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Update Footprint...')
      .Tooltip('Update footprint to include any changes from the library')
      .Icon(BITMAPS.refresh),
  );

  static readonly updateFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.updateFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Update Footprints from Library...')
      .Tooltip('Update footprints to include any changes from the library')
      .Icon(BITMAPS.refresh),
  );

  static readonly migrate3DModels = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.migrate3DModels')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Migrate 3D Models...')
      .Tooltip('Replace obsolete WRL 3D model references with current STEP models')
      .Icon(BITMAPS.refresh),
  );

  static readonly removeUnusedPads = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.removeUnusedPads')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Remove Unused Pads...')
      .Tooltip('Remove or restore the unconnected inner layers on through hole pads and vias')
      .Icon(BITMAPS.pads_remove),
  );

  static readonly changeFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.changeFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Change Footprint...')
      .Tooltip('Assign a different footprint from the library')
      .Icon(BITMAPS.exchange),
  );

  static readonly changeFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.changeFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Change Footprints...')
      .Tooltip('Assign different footprints from the library')
      .Icon(BITMAPS.exchange),
  );

  static readonly swapLayers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.swapLayers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Swap Layers...')
      .Tooltip('Move tracks or drawings from one layer to another')
      .Icon(BITMAPS.swap_layer),
  );

  static readonly editTracksAndVias = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.editTracksAndVias')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Edit Track & Via Properties...')
      .Tooltip('Edit track and via properties globally across board')
      .Icon(BITMAPS.width_track_via),
  );

  static readonly editTextAndGraphics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.editTextAndGraphics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Edit Text & Graphics Properties...')
      .Tooltip('Edit Text and graphics properties globally across board')
      .Icon(BITMAPS.text),
  );

  static readonly editTeardrops = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.editTeardrops')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Edit Teardrops...')
      .Tooltip('Add, remove or edit teardrops globally across board')
      .Icon(BITMAPS.via),
  );

  static readonly globalDeletions = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.globalDeletions')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Global Deletions...')
      .Tooltip('Delete tracks, footprints and graphic items from board')
      .Icon(BITMAPS.general_deletions),
  );

  static readonly cleanupTracksAndVias = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.cleanupTracksAndVias')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Cleanup Tracks & Vias...')
      .Tooltip('Cleanup redundant items, shorting items, etc.')
      .Icon(BITMAPS.cleanup_tracks_and_vias),
  );

  static readonly cleanupGraphics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.cleanupGraphics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Cleanup Graphics...')
      .Tooltip('Cleanup redundant items, etc.')
      .Icon(BITMAPS.cleanup_graphics),
  );

  static readonly microwaveCreateGap = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createGap')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Microwave Gaps')
      .Tooltip('Create gap of specified length for microwave applications')
      .Icon(BITMAPS.mw_add_gap)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.GAP),
  );

  static readonly microwaveCreateStub = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createStub')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Microwave Stubs')
      .Tooltip('Create stub of specified length for microwave applications')
      .Icon(BITMAPS.mw_add_stub)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.STUB),
  );

  static readonly microwaveCreateStubArc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createStubArc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Microwave Arc Stubs')
      .Tooltip('Create stub (arc) of specified size for microwave applications')
      .Icon(BITMAPS.mw_add_stub_arc)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC),
  );

  static readonly microwaveCreateFunctionShape = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createFunctionShape')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Microwave Polygonal Shapes')
      .Tooltip('Create a microwave polygonal shape from a list of vertices')
      .Icon(BITMAPS.mw_add_shape)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.FUNCTION_SHAPE),
  );

  static readonly microwaveCreateLine = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createLine')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Microwave Lines')
      .Tooltip('Create line of specified length for microwave applications')
      .Icon(BITMAPS.mw_add_line)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly copyPadSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.CopyPadSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Copy Pad Properties to Default')
      .Tooltip("Copy current pad's properties")
      .Icon(BITMAPS.copy_pad_settings),
  );

  static readonly applyPadSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.ApplyPadSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Paste Default Pad Properties to Selected')
      .Tooltip("Replace the current pad's properties with those copied earlier")
      .Icon(BITMAPS.apply_pad_settings),
  );

  static readonly pushPadSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.PushPadSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Push Pad Properties to Other Pads...')
      .Tooltip("Copy the current pad's properties to other pads")
      .Icon(BITMAPS.push_pad_settings),
  );

  static readonly enumeratePads = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.enumeratePads')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Renumber Pads...')
      .Tooltip('Renumber pads by clicking on them in the desired order')
      .Icon(BITMAPS.pad_enumerate)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placePad = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.placePad')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Add Pad')
      .Tooltip('Add a pad')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pad)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly explodePad = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.explodePad')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .FriendlyName('Edit Pad as Graphic Shapes')
      .Tooltip('Ungroups a custom-shaped pad for editing as individual graphic shapes')
      .Icon(BITMAPS.custom_pad_to_primitives),
  );

  static readonly recombinePad = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.recombinePad')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .FriendlyName('Finish Pad Edit')
      .Tooltip('Regroups all touching graphic shapes into the edited pad')
      .Icon(BITMAPS.custom_pad_to_primitives),
  );

  static readonly defaultPadProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.defaultPadProperties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Default Pad Properties...')
      .Tooltip('Edit the pad properties used when creating new pads')
      .Icon(BITMAPS.options_pad),
  );

  static readonly pluginsShowFolder = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ScriptingTool.pluginsShowFolder')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Open Plugin Directory')
      .Tooltip('Opens the directory in the default system file manager')
      .Icon(BITMAPS.directory_open),
  );

  static readonly appendBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.appendBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Append Board...')
      .Tooltip('Open another board and append its contents to this board')
      .Icon(BITMAPS.add_board),
  );

  static readonly rescueAutosave = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.rescueAutosave')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Rescue')
      .Tooltip('Clear board and get last rescue file automatically saved by PCB editor')
      .Icon(BITMAPS.rescue),
  );

  static readonly openNonKicadBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.openNonKicadBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Import Non-KiCad Board File...')
      .Tooltip('Import board file from other applications')
      .Icon(BITMAPS.import_brd_file),
  );

  static readonly exportFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export Footprints...')
      .Tooltip(
        'Add footprints from board to a new or an existing footprint library\n(does not remove other footprints from this library)',
      )
      .Icon(BITMAPS.library_archive),
  );

  static readonly boardSetup = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.boardSetup')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Board Setup...')
      .Tooltip('Edit board setup including layers, design rules and various defaults')
      .Icon(BITMAPS.options_board),
  );

  static readonly importNetlist = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.importNetlist')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Import Netlist...')
      .Tooltip('Read netlist and update board connectivity')
      .Icon(BITMAPS.netlist),
  );

  static readonly importSpecctraSession = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.importSpecctraSession')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Import Specctra Session...')
      .Tooltip('Import routed Specctra session (*.ses) file')
      .Icon(BITMAPS.import),
  );

  static readonly exportSpecctraDSN = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportSpecctraDSN')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export Specctra DSN...')
      .Tooltip('Export Specctra DSN routing info')
      .Icon(BITMAPS.export_dsn),
  );

  static readonly generateGerbers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateGerbers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Gerbers (.gbr)...')
      .Tooltip('Generate Gerbers for fabrication')
      .Icon(BITMAPS.post_gerber),
  );

  static readonly generateDrillFiles = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateDrillFiles')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Drill Files (.drl)...')
      .Tooltip('Generate Excellon drill file(s)')
      .Icon(BITMAPS.post_drill),
  );

  static readonly generatePosFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generatePosFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Component Placement (.pos, .gbr)...')
      .Tooltip('Generate component placement file(s) for pick and place')
      .Icon(BITMAPS.post_compo),
  );

  static readonly generateReportFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateReportFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Footprint Report (.rpt)...')
      .Tooltip('Create report of all footprints from current board')
      .Icon(BITMAPS.post_rpt),
  );

  static readonly generateIPC2581File = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateIPC2581File')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('IPC-2581 File (.xml)...')
      .Tooltip('Generate an IPC-2581 file')
      .Icon(BITMAPS.post_xml),
  );

  static readonly generateODBPPFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateODBPPFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('ODB++ Output File...')
      .Tooltip('Generate ODB++ output files')
      .Icon(BITMAPS.post_odb),
  );

  static readonly generateD356File = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateD356File')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('IPC-D-356 Netlist File...')
      .Tooltip('Generate IPC-D-356 netlist file')
      .Icon(BITMAPS.post_d356),
  );

  static readonly generateBOM = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateBOM')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Bill of Materials...')
      .Tooltip('Create bill of materials from board')
      .Icon(BITMAPS.post_bom),
  );

  static readonly exportGenCAD = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportGenCAD')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export GenCAD...')
      .Tooltip('Export GenCAD board representation')
      .Icon(BITMAPS.post_gencad),
  );

  static readonly exportVRML = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportVRML')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export VRML...')
      .Tooltip('Export VRML 3D board representation')
      .Icon(BITMAPS.export3d),
  );

  static readonly exportIDF = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportIDF')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export IDFv3...')
      .Tooltip('Export IDF 3D board representation')
      .Icon(BITMAPS.export_idf),
  );

  static readonly exportSTEP = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportSTEP')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export STEP/GLB/BREP/XAO/PLY/STL...')
      .Tooltip('Export STEP, GLB, BREP, XAO, PLY or STL 3D board representation')
      .Icon(BITMAPS.export_step),
  );

  static readonly exportCmpFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportFootprintAssociations')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export Footprint Association (.cmp) File...')
      .Tooltip('Export footprint association file (*.cmp) for schematic back annotation')
      .Icon(BITMAPS.export_cmp),
  );

  static readonly exportHyperlynx = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportHyperlynx')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Hyperlynx...')
      .Icon(BITMAPS.export_step),
  );

  static readonly collect3DModels = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.collect3DModels')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Collect And Embed 3D Models')
      .Tooltip('Collect footprint 3D models and embed them into the board')
      .Icon(BITMAPS.import3d),
  );

  static readonly trackWidthInc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.trackWidthInc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('W'))
      .LegacyHotkeyName('Switch Track Width To Next')
      .FriendlyName('Switch Track Width to Next')
      .Tooltip('Change track width to next pre-defined size'),
  );

  static readonly trackWidthDec = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.trackWidthDec')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('W'))
      .LegacyHotkeyName('Switch Track Width To Previous')
      .FriendlyName('Switch Track Width to Previous')
      .Tooltip('Change track width to previous pre-defined size'),
  );

  static readonly viaSizeInc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.viaSizeInc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch("'"))
      .LegacyHotkeyName('Increase Via Size')
      .FriendlyName('Increase Via Size')
      .Tooltip('Change via size to next pre-defined size'),
  );

  static readonly viaSizeDec = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.viaSizeDec')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('\\'))
      .LegacyHotkeyName('Decrease Via Size')
      .FriendlyName('Decrease Via Size')
      .Tooltip('Change via size to previous pre-defined size'),
  );

  static readonly autoTrackWidth = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.autoTrackWidth')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Automatically select track width')
      .Tooltip(
        'When routing from an existing track use its width instead of the current width setting',
      )
      .Icon(BITMAPS.auto_track_width)
      .ToolbarState(TOOLBAR_STATE.TOGGLE),
  );

  static readonly trackViaSizeChanged = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.trackViaSizeChanged')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly assignNetClass = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.assignNetclass')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Assign Netclass...')
      .Tooltip('Assign a netclass to nets matching a pattern')
      .Icon(BITMAPS.netlist),
  );

  static readonly zoneMerge = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zoneMerge')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Merge Zones'),
  );

  static readonly zoneDuplicate = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zoneDuplicate')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Duplicate Zone onto Layer...')
      .Icon(BITMAPS.zone_duplicate),
  );

  static readonly zonePriorityMoveToTop = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityMoveToTop')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Move to Top')
      .Icon(BITMAPS.small_up),
  );

  static readonly zonePriorityRaise = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityRaise')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Raise')
      .Icon(BITMAPS.small_up),
  );

  static readonly zonePriorityLower = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityLower')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Lower')
      .Icon(BITMAPS.small_down),
  );

  static readonly zonePriorityMoveToBottom = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityMoveToBottom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Move to Bottom')
      .Icon(BITMAPS.small_down),
  );

  static readonly placeFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.placeFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('A'))
      .LegacyHotkeyName('Add Footprint')
      .FriendlyName('Place Footprints')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.module)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter<FOOTPRINT | null>(null),
  );

  static readonly drillOrigin = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.drillOrigin')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Drill/Place File Origin')
      .Tooltip('Place origin point for drill files and component placement files')
      .Icon(BITMAPS.set_origin)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drillResetOrigin = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.drillResetOrigin')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Reset Drill Origin')
      .FriendlyName('Reset Drill Origin'),
  );

  static readonly drillSetOrigin = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.drillSetOrigin')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .Parameter({ x: 0, y: 0 }),
  );

  static readonly toggleLock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.toggleLock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('L'))
      .LegacyHotkeyName('Lock/Unlock Footprint')
      .FriendlyName('Toggle Lock')
      .Tooltip('Lock or unlock selected items')
      .Icon(BITMAPS.lock_unlock),
  );

  static readonly lineModeFree = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineModeFree')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Line Modes')
      .Tooltip('Draw and drag at any angle')
      .Icon(BITMAPS.lines_any)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(LEADER_MODE.DIRECT),
  );

  static readonly lineMode90 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineModeOrthonal')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Line Modes')
      .Tooltip('Constrain drawing and dragging to horizontal or vertical motions')
      .Icon(BITMAPS.lines90)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(LEADER_MODE.DEG90),
  );

  static readonly lineMode45 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineMode45')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Line Modes')
      .Tooltip('Constrain drawing and dragging to horizontal, vertical, or 45-degree angle motions')
      .Icon(BITMAPS.hv45mode)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(LEADER_MODE.DEG45),
  );

  static readonly lineModeNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineModeNext')
      .DefaultHotkey(MD_SHIFT + ch(' '))
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Line Modes')
      .Tooltip('Switch to next angle snapping mode'),
  );

  static readonly angleSnapModeChanged = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.angleSnapModeChanged')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly lock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Lock')
      .Tooltip('Prevent items from being moved and/or resized on the canvas')
      .Icon(BITMAPS.locked),
  );

  static readonly unlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.unlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Unlock')
      .Tooltip('Allow items to be moved and/or resized on the canvas')
      .Icon(BITMAPS.unlocked),
  );

  static readonly highlightNet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.highlightNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('`'))
      .LegacyHotkeyName('Toggle Highlight of Selected Net (Modern Toolset only)')
      .FriendlyName('Highlight Net')
      .Tooltip('Highlight net under cursor')
      .Icon(BITMAPS.net_highlight)
      .Parameter<number>(0),
  );

  static readonly toggleLastNetHighlight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.toggleLastNetHighlight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Toggle Last Net Highlight')
      .Tooltip('Toggle between last two highlighted nets')
      .Parameter<number>(0),
  );

  static readonly clearHighlight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.clearHighlight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('~'))
      .FriendlyName('Clear Net Highlighting'),
  );

  static readonly toggleNetHighlight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.toggleNetHighlight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('`'))
      .FriendlyName('Toggle Net Highlight')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.net_highlight)
      .Parameter<number>(0),
  );

  static readonly highlightNetSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.highlightNetSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Highlight Net')
      .Tooltip('Highlight all copper items on the selected net(s)')
      .Icon(BITMAPS.net_highlight)
      .Parameter<number>(0),
  );

  static readonly highlightItem = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.highlightItem')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly hideNetInRatsnest = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.hideNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Hide Net in Ratsnest')
      .Tooltip('Hide the selected net in the ratsnest of unconnected net lines/arcs')
      .Icon(BITMAPS.hide_ratsnest)
      .Parameter<number>(0),
  );

  static readonly showNetInRatsnest = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.showNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Net in Ratsnest')
      .Tooltip('Show the selected net in the ratsnest of unconnected net lines/arcs')
      .Icon(BITMAPS.show_ratsnest)
      .Parameter<number>(0),
  );

  static readonly showEeschema = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.showEeschema')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Switch to Schematic Editor')
      .Tooltip('Open schematic in schematic editor')
      .Icon(BITMAPS.icon_eeschema_24),
  );

  static readonly drcRuleEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.DRETool.drcRuleEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('DRC Rule Editor')
      .Tooltip('Open DRC rule editor window'),
  );

  static readonly localRatsnestTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.localRatsnestTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Local Ratsnest')
      .Tooltip('Toggle ratsnest display of selected item(s)')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.tool_ratsnest)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly hideLocalRatsnest = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.hideDynamicRatsnest')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly updateLocalRatsnest = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.updateLocalRatsnest')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Parameter({ x: 0, y: 0 }),
  );

  static readonly showPythonConsole = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showPythonConsole')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Scripting Console')
      .Tooltip('Show the Python scripting console')
      .Icon(BITMAPS.py_script)
      .ToolbarState(TOOLBAR_STATE.TOGGLE),
  );

  static readonly showLayersManager = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showLayersManager')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Appearance')
      .Tooltip('Show/hide the appearance manager')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.layers_manager),
  );

  static readonly showNetInspector = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showNetInspector')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Net Inspector')
      .Tooltip('Show/hide the net inspector')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.tools),
  );

  static readonly zonesManager = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zonesManager')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Zone Manager...')
      .Tooltip('Show the zone manager dialog')
      .Icon(BITMAPS.show_zone),
  );

  static readonly flipBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.flipBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Flip Board View')
      .Tooltip('View board from the opposite side')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.flip_board),
  );

  static readonly rehatchShapes = new TOOL_ACTION(
    new TOOL_ACTION_ARGS().Name('pcbnew.Control.rehatchShapes').Scope(TOOL_ACTION_SCOPE.AS_CONTEXT),
  );

  static readonly showRatsnest = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showRatsnest')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Ratsnest')
      .Tooltip('Show lines/arcs representing missing connections on the board')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.general_ratsnest),
  );

  static readonly ratsnestLineMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.ratsnestLineMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Curved Ratsnest Lines')
      .Tooltip('Show ratsnest with curved lines')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.curved_ratsnest),
  );

  static readonly ratsnestModeCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.ratsnestModeCycle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Ratsnest Mode (3-state)')
      .Tooltip('Cycle between showing ratsnests for all layers, just visible layers, and none'),
  );

  static readonly netColorModeCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.netColorMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Net Color Mode (3-state)')
      .Tooltip(
        'Cycle between using net and netclass colors for all nets, just ratsnests, and none',
      ),
  );

  static readonly trackDisplayMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.trackDisplayMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('K'))
      .LegacyHotkeyName('Track Display Mode')
      .FriendlyName('Sketch Tracks')
      .Tooltip('Show tracks in outline mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.showtrack),
  );

  static readonly padDisplayMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.padDisplayMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Sketch Pads')
      .Tooltip('Show pads in outline mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pad_sketch),
  );

  static readonly viaDisplayMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.viaDisplayMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Sketch Vias')
      .Tooltip('Show vias in outline mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.via_sketch),
  );

  static readonly graphicsOutlines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.graphicOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Sketch Graphic Items')
      .Tooltip('Show graphic items in outline mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_mod_edge),
  );

  static readonly textOutlines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.textOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Sketch Text Items')
      .Tooltip('Show footprint texts in line mode')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.text_sketch),
  );

  static readonly showPadNumbers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showPadNumbers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Pad Numbers')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pad_number),
  );

  static readonly zoneDisplayFilled = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayEnable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Zone Fills')
      .Tooltip('Show filled areas of zones')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone),
  );

  static readonly zoneDisplayOutline = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayDisable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Zone Outlines')
      .Tooltip('Show only zone boundaries')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone_disable),
  );

  static readonly zoneDisplayFractured = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Zone Fill Fracture Borders')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone_outline_only),
  );

  static readonly zoneDisplayTriangulated = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayTesselation')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draw Zone Fill Triangulation')
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone_triangulation),
  );

  static readonly zoneDisplayToggle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayToggle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Toggle Zone Display')
      .Tooltip('Cycle between showing zone fills and just their outlines')
      .Icon(BITMAPS.show_zone),
  );

  static readonly fpAutoZoom = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.fpAutoZoom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Automatic zoom')
      .Tooltip('Automatic Zoom on footprint change')
      .Icon(BITMAPS.zoom_auto_fit_in_page)
      .ToolbarState(TOOLBAR_STATE.TOGGLE),
  );

  static readonly layerTop = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerTop')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .DefaultHotkey(WXK.WXK_PAGEUP)
      .LegacyHotkeyName('Switch to Component (F.Cu) layer')
      .FriendlyName('Switch to Component (F.Cu) layer')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.F_Cu),
  );

  static readonly layerInner1 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner1')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 1')
      .FriendlyName('Switch to Inner Layer 1')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In1_Cu),
  );

  static readonly layerInner2 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner2')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 2')
      .FriendlyName('Switch to Inner Layer 2')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In2_Cu),
  );

  static readonly layerInner3 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner3')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 3')
      .FriendlyName('Switch to Inner Layer 3')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In3_Cu),
  );

  static readonly layerInner4 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner4')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 4')
      .FriendlyName('Switch to Inner Layer 4')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In4_Cu),
  );

  static readonly layerInner5 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner5')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 5')
      .FriendlyName('Switch to Inner Layer 5')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In5_Cu),
  );

  static readonly layerInner6 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner6')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 6')
      .FriendlyName('Switch to Inner Layer 6')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In6_Cu),
  );

  static readonly layerInner7 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner7')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 7')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In7_Cu),
  );

  static readonly layerInner8 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner8')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 8')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In8_Cu),
  );

  static readonly layerInner9 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner9')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 9')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In9_Cu),
  );

  static readonly layerInner10 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner10')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 10')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In10_Cu),
  );

  static readonly layerInner11 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner11')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 11')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In11_Cu),
  );

  static readonly layerInner12 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner12')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 12')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In12_Cu),
  );

  static readonly layerInner13 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner13')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 13')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In13_Cu),
  );

  static readonly layerInner14 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner14')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 14')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In14_Cu),
  );

  static readonly layerInner15 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner15')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 15')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In15_Cu),
  );

  static readonly layerInner16 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner16')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 16')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In16_Cu),
  );

  static readonly layerInner17 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner17')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 17')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In17_Cu),
  );

  static readonly layerInner18 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner18')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 18')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In18_Cu),
  );

  static readonly layerInner19 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner19')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 19')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In19_Cu),
  );

  static readonly layerInner20 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner20')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 20')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In20_Cu),
  );

  static readonly layerInner21 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner21')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 21')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In21_Cu),
  );

  static readonly layerInner22 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner22')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 22')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In22_Cu),
  );

  static readonly layerInner23 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner23')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 23')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In23_Cu),
  );

  static readonly layerInner24 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner24')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 24')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In24_Cu),
  );

  static readonly layerInner25 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner25')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 25')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In25_Cu),
  );

  static readonly layerInner26 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner26')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 26')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In26_Cu),
  );

  static readonly layerInner27 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner27')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 27')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In27_Cu),
  );

  static readonly layerInner28 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner28')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 28')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In28_Cu),
  );

  static readonly layerInner29 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner29')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 29')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In29_Cu),
  );

  static readonly layerInner30 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner30')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName('Switch to Inner Layer 30')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In30_Cu),
  );

  static readonly layerBottom = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerBottom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .DefaultHotkey(WXK.WXK_PAGEDOWN)
      .LegacyHotkeyName('Switch to Copper (B.Cu) layer')
      .FriendlyName('Switch to Copper (B.Cu) Layer')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.B_Cu),
  );

  static readonly layerNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerNext')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('+'))
      .LegacyHotkeyName('Switch to Next Layer')
      .FriendlyName('Switch to Next Layer')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly layerPrev = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerPrev')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('-'))
      .LegacyHotkeyName('Switch to Previous Layer')
      .FriendlyName('Switch to Previous Layer')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly layerToggle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerToggle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('V'))
      .LegacyHotkeyName('Add Through Via')
      .FriendlyName('Toggle Layer')
      .Tooltip('Switch between layers in active layer pair')
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly layerAlphaInc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerAlphaInc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('}'))
      .LegacyHotkeyName('Increment Layer Transparency (Modern Toolset only)')
      .FriendlyName('Increase Layer Opacity')
      .Tooltip('Make the current layer less transparent')
      .Icon(BITMAPS.contrast_mode),
  );

  static readonly layerAlphaDec = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerAlphaDec')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('{'))
      .LegacyHotkeyName('Decrement Layer Transparency (Modern Toolset only)')
      .FriendlyName('Decrease Layer Opacity')
      .Tooltip('Make the current layer more transparent')
      .Icon(BITMAPS.contrast_mode),
  );

  static readonly layerPairPresetsCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerPairPresetCycle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('V'))
      .FriendlyName('Cycle Layer Pair Presets')
      .Tooltip('Cycle between preset layer pairs'),
  );

  static readonly layerChanged = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerChanged')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly boardStatistics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.ShowBoardStatistics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Board Statistics')
      .Tooltip('Shows board statistics')
      .Icon(BITMAPS.editor),
  );

  static readonly inspectClearance = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.InspectClearance')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Clearance Resolution')
      .Tooltip('Show clearance resolution for the active layer between two selected objects')
      .Icon(BITMAPS.mw_add_gap),
  );

  static readonly inspectConstraints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.InspectConstraints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Constraints Resolution')
      .Tooltip('Show constraints resolution for the selected object')
      .Icon(BITMAPS.mw_add_stub),
  );

  static readonly diffFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.DiffFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Compare Footprint with Library')
      .Tooltip('Show differences between board footprint and its library equivalent')
      .Icon(BITMAPS.library),
  );

  static readonly showFootprintAssociations = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.ShowFootprintAssociations')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show Footprint Associations')
      .Tooltip('Show footprint library and schematic symbol associations')
      .Icon(BITMAPS.edit_cmp_symb_links),
  );

  static readonly boardReannotate = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ReannotateTool.ShowReannotateDialog')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Geographical Reannotate...')
      .Tooltip('Reannotate PCB in geographical order')
      .Icon(BITMAPS.annotate),
  );

  static readonly repairBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.repairBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Repair Board')
      .Tooltip('Run various diagnostics and attempt to repair board')
      .Icon(BITMAPS.rescue)
      .Parameter(false),
  );

  static readonly repairFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.repairFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Repair Footprint')
      .Tooltip('Run various diagnostics and attempt to repair footprint')
      .Icon(BITMAPS.rescue),
  );

  static readonly alignTop = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignTop')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Align to Top')
      .Tooltip('Aligns selected items to the top edge of the item under the cursor')
      .Icon(BITMAPS.align_items_top),
  );

  static readonly alignBottom = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignBottom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Align to Bottom')
      .Tooltip('Aligns selected items to the bottom edge of the item under the cursor')
      .Icon(BITMAPS.align_items_bottom),
  );

  static readonly alignLeft = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignLeft')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Align to Left')
      .Tooltip('Aligns selected items to the left edge of the item under the cursor')
      .Icon(BITMAPS.align_items_left),
  );

  static readonly alignRight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignRight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Align to Right')
      .Tooltip('Aligns selected items to the right edge of the item under the cursor')
      .Icon(BITMAPS.align_items_right),
  );

  static readonly alignCenterY = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignCenterY')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Align to Vertical Center')
      .Tooltip('Aligns selected items to the vertical center of the item under the cursor')
      .Icon(BITMAPS.align_items_center),
  );

  static readonly alignCenterX = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignCenterX')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Align to Horizontal Center')
      .Tooltip('Aligns selected items to the horizontal center of the item under the cursor')
      .Icon(BITMAPS.align_items_middle),
  );

  static readonly distributeHorizontallyCenters = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeHorizontallyCenters')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Distribute Horizontally by Centers')
      .Tooltip(
        'Distributes selected items between the left-most item and the right-most item so that the item centers are equally distributed',
      )
      .Icon(BITMAPS.distribute_horizontal_centers),
  );

  static readonly distributeHorizontallyGaps = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeHorizontallyGaps')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Distribute Horizontally with Even Gaps')
      .Tooltip(
        'Distributes selected items between the left-most item and the right-most item so that the gaps between items are equal',
      )
      .Icon(BITMAPS.distribute_horizontal_gaps),
  );

  static readonly distributeVerticallyGaps = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeVerticallyGaps')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Distribute Vertically with Even Gaps')
      .Tooltip(
        'Distributes selected items between the top-most item and the bottom-most item so that the gaps between items are equal',
      )
      .Icon(BITMAPS.distribute_vertical_gaps),
  );

  static readonly distributeVerticallyCenters = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeVerticallyCenters')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Distribute Vertically by Centers')
      .Tooltip(
        'Distributes selected items between the top-most item and the bottom-most item so that the item centers are equally distributed',
      )
      .Icon(BITMAPS.distribute_vertical_centers),
  );

  static readonly pointEditorAddCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.addCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_INSERT)
      .FriendlyName('Create Corner')
      .Tooltip('Create a corner')
      .Icon(BITMAPS.add_corner),
  );

  static readonly pointEditorRemoveCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.removeCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Remove Corner')
      .Tooltip('Remove corner')
      .Icon(BITMAPS.delete_cursor),
  );

  static readonly pointEditorChamferCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.chamferCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Chamfer Corner')
      .Tooltip('Chamfer corner')
      .Icon(BITMAPS.chamfer),
  );

  static readonly positionRelative = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PositionRelative.positionRelative')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('P'))
      .LegacyHotkeyName('Position Item Relative')
      .FriendlyName('Position Relative To...')
      .Tooltip('Positions the selected item(s) by an exact amount relative to another')
      .Icon(BITMAPS.move_relative),
  );

  static readonly interactiveOffsetTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PositionRelative.interactiveOffsetTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Interactive Offset Tool')
      .Tooltip('Interactive tool for offsetting items by exact amounts')
      .Icon(BITMAPS.move_relative),
  );

  static readonly selectItemInteractively = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Picker.selectItemInteractively')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Parameter<INTERACTIVE_PARAMS>({ m_Receiver: null, m_Prompt: '', m_ItemFilter: null }),
  );

  static readonly selectPointInteractively = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Picker.selectPointInteractively')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Parameter<INTERACTIVE_PARAMS>({ m_Receiver: null, m_Prompt: '', m_ItemFilter: null }),
  );

  static readonly selectConnection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectConnection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('U'))
      .LegacyHotkeyName('Select Single Track')
      .FriendlyName('Select/Expand Connection')
      .Tooltip(
        'Selects a connection or expands an existing selection to junctions, pads, or entire connections',
      )
      .Icon(BITMAPS.add_tracks),
  );

  static readonly unrouteSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.unrouteSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Unroute Selected')
      .Tooltip('Unroutes selected items to the nearest pad.')
      .Icon(BITMAPS.general_deletions),
  );

  static readonly unrouteSegment = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.unrouteSegment')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_BACK)
      .FriendlyName('Unroute Segment')
      .Tooltip('Unroutes segment to the nearest segment.')
      .Icon(BITMAPS.general_deletions),
  );

  static readonly syncSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SyncSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly syncSelectionWithNets = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SyncSelectionWithNets')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly selectNet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Select All Tracks in Net')
      .Tooltip('Selects all tracks & vias belonging to the same net.')
      .Parameter<number>(0),
  );

  static readonly deselectNet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.DeselectNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Deselect All Tracks in Net')
      .Tooltip('Deselects all tracks & vias belonging to the same net.')
      .Parameter<number>(0),
  );

  static readonly selectUnconnected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectUnconnected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('O'))
      .FriendlyName('Select All Unconnected Footprints')
      .Tooltip('Selects all unconnected footprints belonging to each selected net.'),
  );

  static readonly grabUnconnected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.GrabUnconnected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('O'))
      .FriendlyName('Grab Nearest Unconnected Footprints')
      .Tooltip(
        'Selects and initiates moving the nearest unconnected footprint on each selected net.',
      ),
  );

  static readonly selectOnSheetFromEeschema = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectOnSheet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Sheet')
      .Tooltip('Selects all footprints and tracks in the schematic sheet')
      .Icon(BITMAPS.select_same_sheet),
  );

  static readonly selectSameSheet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectSameSheet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Items in Same Hierarchical Sheet')
      .Tooltip('Selects all footprints and tracks in the same schematic sheet')
      .Icon(BITMAPS.select_same_sheet),
  );

  static readonly selectOnSchematic = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectOnSchematic')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Select on Schematic')
      .Tooltip('Selects corresponding items in Schematic editor')
      .Icon(BITMAPS.select_same_sheet),
  );

  static readonly filterSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.FilterSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Filter Selected Items...')
      .Tooltip('Remove items from the selection by type')
      .Icon(BITMAPS.filter),
  );

  static readonly zoneFill = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneFill')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Draft Fill Selected Zone(s)')
      .Tooltip('Update copper fill of selected zone(s) without regard to other interacting zones')
      .Icon(BITMAPS.fill_zone)
      .Parameter<ZONE | null>(null),
  );

  static readonly zoneFillAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneFillAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('B'))
      .LegacyHotkeyName('Fill or Refill All Zones')
      .FriendlyName('Fill All Zones')
      .Tooltip('Update copper fill of all zones')
      .Icon(BITMAPS.fill_zone),
  );

  static readonly zoneFillDirty = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneFillDirty')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT),
  );

  static readonly zoneUnfill = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneUnfill')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Unfill Selected Zone(s)')
      .Tooltip('Remove copper fill from selected zone(s)')
      .Icon(BITMAPS.zone_unfill),
  );

  static readonly zoneUnfillAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneUnfillAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('B'))
      .LegacyHotkeyName('Remove Filled Areas in All Zones')
      .FriendlyName('Unfill All Zones')
      .Tooltip('Remove copper fill from all zones')
      .Icon(BITMAPS.zone_unfill),
  );

  static readonly autoplaceSelectedComponents = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Autoplacer.autoplaceSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Place Selected Footprints')
      .Tooltip('Performs automatic placement of selected components'),
  );

  static readonly autoplaceOffboardComponents = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Autoplacer.autoplaceOffboard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Place Off-Board Footprints')
      .Tooltip('Performs automatic placement of components outside board area'),
  );

  static readonly generatePlacementRuleAreas = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Multichannel.generatePlacementRuleAreas')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Generate Placement Rule Areas...')
      .Tooltip('Creates best-fit placement rule areas')
      .Icon(BITMAPS.add_keepout_area)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly repeatLayout = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Multichannel.repeatLayout')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Repeat Layout...')
      .Tooltip('Clones placement & routing across multiple identical channels')
      .Icon(BITMAPS.copy),
  );

  static readonly routeSingleTrack = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.SingleTrack')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('X'))
      .LegacyHotkeyName('Add New Track')
      .FriendlyName('Route Single Track')
      .Tooltip('Route tracks')
      .Icon(BITMAPS.add_tracks)
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_SINGLE),
  );

  static readonly routeDiffPair = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.DiffPair')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('6'))
      .LegacyHotkeyName('Route Differential Pair (Modern Toolset only)')
      .FriendlyName('Route Differential Pair')
      .Tooltip('Route differential pairs')
      .Icon(BITMAPS.ps_diff_pair)
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR),
  );

  static readonly routerSettingsDialog = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.SettingsDialog')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('<'))
      .LegacyHotkeyName('Routing Options')
      .FriendlyName('Interactive Router Settings...')
      .Tooltip('Open Interactive Router settings')
      .Icon(BITMAPS.tools),
  );

  static readonly routerDiffPairDialog = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.DiffPairDialog')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Differential Pair Dimensions...')
      .Tooltip('Open Differential Pair Dimension settings')
      .Icon(BITMAPS.ps_diff_pair_gap),
  );

  static readonly routerHighlightMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.HighlightMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Router Highlight Mode')
      .Tooltip('Switch router to highlight mode')
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(PnsMode.RM_MarkObstacles),
  );

  static readonly routerShoveMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.ShoveMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Router Shove Mode')
      .Tooltip('Switch router to shove mode')
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(PnsMode.RM_Shove),
  );

  static readonly routerWalkaroundMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.WalkaroundMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Router Walkaround Mode')
      .Tooltip('Switch router to walkaround mode')
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(PnsMode.RM_Walkaround),
  );

  static readonly cycleRouterMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.CycleRouterMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Cycle Router Mode')
      .Tooltip('Cycle router to the next mode'),
  );

  static readonly selectLayerPair = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.SelectLayerPair')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Set Layer Pair...')
      .Tooltip('Change active layer pair for routing')
      .Icon(BITMAPS.select_layer_pair)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly tuneSingleTrack = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.LengthTuner.TuneSingleTrack')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('7'))
      .LegacyHotkeyName('Tune Single Track (Modern Toolset only)')
      .FriendlyName('Tune Length of a Single Track')
      .Icon(BITMAPS.ps_tune_length)
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_TUNE_SINGLE),
  );

  static readonly tuneDiffPair = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.LengthTuner.TuneDiffPair')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('8'))
      .LegacyHotkeyName('Tune Differential Pair Length (Modern Toolset only)')
      .FriendlyName('Tune Length of a Differential Pair')
      .Icon(BITMAPS.ps_diff_pair_tune_length)
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR),
  );

  static readonly tuneSkew = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.LengthTuner.TuneDiffPairSkew')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('9'))
      .LegacyHotkeyName('Tune Differential Pair Skew (Modern Toolset only)')
      .FriendlyName('Tune Skew of a Differential Pair')
      .Icon(BITMAPS.ps_diff_pair_tune_phase)
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW),
  );

  static readonly routerInlineDrag = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.InlineDrag')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .Parameter<number>(PnsDragMode.DM_ANY),
  );

  static readonly routerUndoLastSegment = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.UndoLastSegment')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(WXK.WXK_BACK)
      .FriendlyName('Undo Last Segment')
      .Tooltip('Walks the current track back one segment.'),
  );

  static readonly routerContinueFromEnd = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.ContinueFromEnd')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .FriendlyName('Route From Other End')
      .Tooltip('Commits current segments and starts next segment from nearest ratsnest end.'),
  );

  static readonly routerAttemptFinish = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.AttemptFinish')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(ch('F'))
      .FriendlyName('Attempt Finish')
      .Tooltip('Attempts to complete current route to nearest ratsnest end.')
      .Parameter<boolean | null>(null),
  );

  static readonly routerRouteSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.RouteSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('X'))
      .FriendlyName('Route Selected')
      .Tooltip('Sequentially route selected items from ratsnest anchor.')
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_SINGLE),
  );

  static readonly routerRouteSelectedFromEnd = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.RouteSelectedFromEnd')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('E'))
      .FriendlyName('Route Selected From Other End')
      .Tooltip('Sequentially route selected items from other end of ratsnest anchor.')
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_SINGLE),
  );

  static readonly routerAutorouteSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.Autoroute')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('F'))
      .FriendlyName('Attempt Finish Selected (Autoroute)')
      .Tooltip('Sequentially attempt to automatically route all selected pads.')
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_SINGLE),
  );

  static readonly cancelCurrentItem = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.CancelCurrentItem')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Cancel Current Item')
      .Tooltip('Skip current item and route next selected item.'),
  );

  static readonly breakTrack = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.BreakTrack')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Break Track')
      .Tooltip('Splits the track segment into two segments connected at the cursor position.')
      .Icon(BITMAPS.break_line),
  );

  static readonly drag45Degree = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.Drag45Degree')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('D'))
      .LegacyHotkeyName('Drag Track Keep Slope')
      .FriendlyName('Drag 45 Degree Mode')
      .Tooltip('Drags the track segment while keeping connected tracks at 45 degrees.')
      .Icon(BITMAPS.drag_segment_withslope),
  );

  static readonly dragFreeAngle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.DragFreeAngle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('G'))
      .LegacyHotkeyName('Drag Item')
      .FriendlyName('Drag Free Angle')
      .Tooltip('Drags the nearest joint in the track without restricting the track angle.')
      .Icon(BITMAPS.drag_segment),
  );

  static readonly regenerateAllTuning = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.regenerateAllTuning')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Update All Tuning Patterns')
      .Tooltip('Attempt to re-tune existing tuning patterns within their bounds')
      .Icon(BITMAPS.router_len_tuner)
      .Parameter('tuning_pattern'),
  );

  static readonly regenerateAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.regenerateAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Rebuild All Generators')
      .Tooltip('Rebuilds geometry of all generators')
      .Icon(BITMAPS.refresh)
      .Parameter('*'),
  );

  static readonly regenerateSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.regenerateSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Rebuild Selected Generators')
      .Tooltip('Rebuilds geometry of selected generator(s)')
      .Icon(BITMAPS.refresh),
  );

  static readonly genStartEdit = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.genStartEdit')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT),
  );

  static readonly genUpdateEdit = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.genUpdateEdit')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT),
  );

  static readonly genFinishEdit = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.genFinishEdit')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT),
  );

  static readonly genCancelEdit = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.genCacnelEdit')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT),
  );

  static readonly genRemove = new TOOL_ACTION(
    new TOOL_ACTION_ARGS().Name('pcbnew.Generator.genRemove').Scope(TOOL_ACTION_SCOPE.AS_CONTEXT),
  );

  static readonly generatorsShowManager = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.showManager')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Generators Manager')
      .Tooltip('Show a manager dialog for Generator objects')
      .Icon(BITMAPS.pin_table),
  );

  static readonly lengthTunerSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.LengthTuner.Settings')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('L'))
      .LegacyHotkeyName('Length Tuning Settings (Modern Toolset only)')
      .FriendlyName('Length Tuning Settings')
      .MenuText('Length Tuning Settings...')
      .Tooltip('Displays tuning pattern properties dialog')
      .Icon(BITMAPS.router_len_tuner_setup),
  );

  static readonly ddAppendBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS().Name('pcbnew.Control.DdAppendBoard').Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly ddImportFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.ddImportFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly ddImportGraphics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.ddImportGraphics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL),
  );

  static readonly showWizards = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.showWizards')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Show wizards selector')
      .Tooltip('Select wizard script to run')
      .Icon(BITMAPS.module_wizard),
  );

  static readonly resetWizardPrms = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.resetWizardPrms')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Reset wizard parameters')
      .Tooltip('Reset wizard parameters to default')
      .Icon(BITMAPS.reload),
  );

  static readonly selectPreviousWizardPage = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.selectPreviousWizardPage')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Select previous wizard page')
      .Tooltip('Select previous parameters page')
      .Icon(BITMAPS.lib_previous),
  );

  static readonly selectNextWizardPage = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.selectNextWizardPage')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Select next wizard page')
      .Tooltip('Select next parameters page')
      .Icon(BITMAPS.lib_next),
  );

  static readonly exportFpToEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.exportFpToEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName('Export footprint to editor')
      .Tooltip('Export footprint to editor')
      .Icon(BITMAPS.export_footprint_names),
  );
}

export class PCB_EVENTS {
  // These are functions that access the underlying event because the event constructor
  // needs the ACTION::cancelInteractive action, so we must
  private static s_snappingModeChangedByKey: TOOL_EVENT | null = null;
  private static s_layerPairPresetChangedByKey: TOOL_EVENT | null = null;

  static SnappingModeChangedByKeyEvent(): TOOL_EVENT {
    if (!PCB_EVENTS.s_snappingModeChangedByKey) {
      PCB_EVENTS.s_snappingModeChangedByKey = new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MESSAGE,
        TOOL_ACTIONS.TA_ACTION,
        'common.Interactive.snappingModeChangedByKey',
      );
    }

    return PCB_EVENTS.s_snappingModeChangedByKey;
  }

  static LayerPairPresetChangedByKeyEvent(): TOOL_EVENT {
    if (!PCB_EVENTS.s_layerPairPresetChangedByKey) {
      PCB_EVENTS.s_layerPairPresetChangedByKey = new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MESSAGE,
        TOOL_ACTIONS.TA_ACTION,
        'pcbnew.Control.layerPairPresetChangedByKey',
      );
    }

    return PCB_EVENTS.s_layerPairPresetChangedByKey;
  }
}
