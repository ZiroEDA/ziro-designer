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
import { WXK } from '@ziroeda/wx/wx_keycodes.js';
import { BITMAPS } from '@ziroeda/include/bitmaps/bitmaps_list.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
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
import { _HKI } from '@ziroeda/include/i18n_utility.js';

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
      .FriendlyName(_HKI('Create Polygon from Selection...'))
      .Tooltip(_HKI('Creates a graphic polygon from the selection'))
      .Icon(BITMAPS.add_graphical_polygon),
  );

  static readonly convertToZone = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToZone')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Create Zone from Selection...'))
      .Tooltip(_HKI('Creates a copper zone from the selection'))
      .Icon(BITMAPS.add_zone),
  );

  static readonly convertToKeepout = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToKeepout')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Create Rule Area from Selection...'))
      .Tooltip(_HKI('Creates a rule area from the selection'))
      .Icon(BITMAPS.add_keepout_area),
  );

  static readonly convertToLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Create Lines from Selection...'))
      .Tooltip(_HKI('Creates graphic lines from the selection'))
      .Icon(BITMAPS.add_line),
  );

  static readonly convertToArc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToArc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Create Arc from Selection'))
      .Tooltip(_HKI('Creates an arc from the selected line segment'))
      .Icon(BITMAPS.add_arc),
  );

  static readonly convertToTracks = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.convertToTracks')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Create Tracks from Selection'))
      .Tooltip(_HKI('Creates tracks from the selected graphic lines'))
      .Icon(BITMAPS.add_tracks),
  );

  static readonly outsetItems = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Convert.outsetItems')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Create Outsets from Selection...'))
      .Tooltip(_HKI('Create outset lines from the selected item'))
      .Icon(BITMAPS.outset_from_selection),
  );

  static readonly drawLine = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.line')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('L'))
      .LegacyHotkeyName('Draw Line')
      .FriendlyName(_HKI('Draw Lines'))
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
      .FriendlyName(_HKI('Draw Polygons'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_graphical_polygon)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(ZONE_MODE.GRAPHIC_POLYGON),
  );

  static readonly drawRectangle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.rectangle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Rectangles'))
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
      .FriendlyName(_HKI('Draw Circles'))
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
      .FriendlyName(_HKI('Draw Arcs'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_arc)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawBezier = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.bezier')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('B'))
      .FriendlyName(_HKI('Draw Bezier Curve'))
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
      .Tooltip(_HKI('Add a barcode'))
      .Icon(BITMAPS.add_barcode)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placeCharacteristics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeCharacteristics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Add Board Characteristics')
      .FriendlyName('Add Board Characteristics')
      .Tooltip(_HKI('Add a board characteristics table on a graphic layer'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placeStackup = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeStackup')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Add Stackup Table')
      .FriendlyName('Add Stackup Table')
      .Tooltip(_HKI('Add a board stackup table on a graphic layer'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placePoint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placePoint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Place Point'))
      .Tooltip(_HKI('Add reference/snap points'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_point)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placeReferenceImage = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeReferenceImage')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Place Reference Images'))
      .Tooltip(
        _HKI(
          'Add bitmap images to be used as reference (images will not be included in any output)',
        ),
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
      .FriendlyName(_HKI('Draw Text'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.text)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawTextBox = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.textbox')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Text Boxes'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_textbox)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.drawTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Tables'))
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
      .FriendlyName(_HKI('Increase Spacing'))
      .Tooltip(_HKI('Increase tuning pattern spacing by one step.'))
      .Icon(BITMAPS.router_len_tuner_dist_incr),
  );

  static readonly spacingDecrease = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.lengthTuner.SpacingDecrease')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('2'))
      .LegacyHotkeyName('Decrease meander spacing by one step.')
      .FriendlyName(_HKI('Decrease Spacing'))
      .Tooltip(_HKI('Decrease tuning pattern spacing by one step.'))
      .Icon(BITMAPS.router_len_tuner_dist_decr),
  );

  static readonly amplIncrease = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.lengthTuner.AmplIncrease')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('3'))
      .LegacyHotkeyName('Increase meander amplitude by one step.')
      .FriendlyName(_HKI('Increase Amplitude'))
      .Tooltip(_HKI('Increase tuning pattern amplitude by one step.'))
      .Icon(BITMAPS.router_len_tuner_amplitude_incr),
  );

  static readonly amplDecrease = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.lengthTuner.AmplDecrease')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('4'))
      .LegacyHotkeyName('Decrease meander amplitude by one step.')
      .FriendlyName(_HKI('Decrease Amplitude'))
      .Tooltip(_HKI('Decrease tuning pattern amplitude by one step.'))
      .Icon(BITMAPS.router_len_tuner_amplitude_decr),
  );

  static readonly drawAlignedDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.alignedDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .LegacyHotkeyName('Add Dimension')
      .FriendlyName(_HKI('Draw Aligned Dimensions'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_aligned_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawCenterDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.centerDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Center Dimensions'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_center_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawRadialDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.radialDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Radial Dimensions'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_radial_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawOrthogonalDimension = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.orthogonalDimension')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('H'))
      .FriendlyName(_HKI('Draw Orthogonal Dimensions'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.add_orthogonal_dimension)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly drawLeader = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.leader')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Leaders'))
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
      .FriendlyName(_HKI('Draw Filled Zones'))
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
      .FriendlyName(_HKI('Place Vias'))
      .Tooltip(_HKI('Place free-standing vias'))
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
      .FriendlyName(_HKI('Draw Rule Areas'))
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
      .Tooltip(_HKI('Add a cutout to an existing zone or rule area'))
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
      .Tooltip(_HKI('Add a zone with the same settings as an existing zone'))
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
      .FriendlyName(_HKI('Import Graphics...'))
      .Tooltip(_HKI('Import 2D drawing file'))
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
      .Tooltip(_HKI('Set the anchor point of the footprint'))
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
      .FriendlyName(_HKI('Switch Arc Posture')),
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
      .FriendlyName(_HKI('Snap to Objects on the Active Layer Only'))
      .Tooltip(_HKI('Enables snapping to objects on the active layer only')),
  );

  static readonly magneticSnapAllLayers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.magneticSnapAllLayers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Snap to Objects on All Layers'))
      .Tooltip(_HKI('Enables snapping to objects on all visible layers')),
  );

  static readonly magneticSnapToggle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('common.Control.magneticSnapToggle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('S'))
      .FriendlyName(_HKI('Toggle Snapping Between Active and All Layers'))
      .Tooltip(_HKI('Toggles between snapping on all visible layers and only the active area')),
  );

  static readonly deleteLastPoint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.deleteLastPoint')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(WXK.WXK_BACK)
      .FriendlyName(_HKI('Delete Last Point'))
      .Tooltip(_HKI('Delete the last point added to the current item'))
      .Icon(BITMAPS.undo),
  );

  static readonly closeOutline = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.closeOutline')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .FriendlyName(_HKI('Close Outline'))
      .Tooltip(_HKI('Close the in progress outline'))
      .Icon(BITMAPS.checked_ok),
  );

  static readonly runDRC = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.DRCTool.runDRC')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Design Rules Checker'))
      .Tooltip(_HKI('Show the design rules checker window'))
      .Icon(BITMAPS.erc),
  );

  static readonly placeDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('B'))
      .FriendlyName(_HKI('Place Design Block'))
      .Tooltip(_HKI('Add selected design block to current board'))
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter<DESIGN_BLOCK | null>(null),
  );

  static readonly placeLinkedDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.placeLinkedDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Place Linked Design Block'))
      .Tooltip(_HKI('Place design block linked to selected group'))
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter<boolean | null>(null),
  );

  static readonly applyDesignBlockLayout = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.applyDesignBlockLayout')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Apply Design Block Layout'))
      .Tooltip(_HKI('Apply linked design block layout to selected group'))
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly saveToLinkedDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveDrawing.saveToLinkedDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Save to Linked Design Block'))
      .Tooltip(_HKI('Save selected group to linked design block'))
      .Icon(BITMAPS.add_component)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly showDesignBlockPanel = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.showDesignBlockPanel')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Design Blocks'))
      .Tooltip(_HKI('Show/hide design blocks library'))
      .Icon(BITMAPS.search_tree),
  );

  static readonly saveBoardAsDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.saveBoardAsDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Save Board as Design Block...'))
      .Tooltip(_HKI('Create a new design block from the current board'))
      .Icon(BITMAPS.new_component),
  );

  static readonly saveSelectionAsDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.saveSelectionAsDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Save Selection as Design Block...'))
      .Tooltip(_HKI('Create a new design block from the current selection'))
      .Icon(BITMAPS.new_component),
  );

  static readonly updateDesignBlockFromBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.updateDesignBlockFromBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Update Design Block from Board'))
      .Tooltip(_HKI('Set design block layout to current board'))
      .Icon(BITMAPS.save),
  );

  static readonly updateDesignBlockFromSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.updateDesignBlockFromSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Update Design Block from Selection'))
      .Tooltip(_HKI('Set design block layout to current selection'))
      .Icon(BITMAPS.save),
  );

  static readonly deleteDesignBlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.deleteDesignBlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Delete Design Block'))
      .Tooltip(_HKI('Remove the selected design block from its library'))
      .Icon(BITMAPS.trash),
  );

  static readonly editDesignBlockProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PcbDesignBlockControl.editDesignBlockProperties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Properties...'))
      .Tooltip(_HKI('Edit properties of design block'))
      .Icon(BITMAPS.edit),
  );

  static readonly editFpInFpEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.EditFpInFpEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .LegacyHotkeyName('Edit with Footprint Editor')
      .FriendlyName(_HKI('Open in Footprint Editor'))
      .Icon(BITMAPS.module_editor),
  );

  static readonly editLibFpInFpEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.EditLibFpInFpEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('E'))
      .FriendlyName(_HKI('Edit Library Footprint...'))
      .Icon(BITMAPS.module_editor),
  );

  static readonly toggleExcludeFromBOM = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.toggleExcludeFromBOM')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Exclude from Bill of Materials'))
      .Tooltip(_HKI('Toggle the exclude from bill of materials attribute')),
  );

  static readonly toggleExcludeFromPosFiles = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.toggleExcludeFromPosFiles')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Exclude from Position Files'))
      .Tooltip(_HKI('Toggle the exclude from position files attribute')),
  );

  static readonly getAndPlace = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.FindMove')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('T'))
      .LegacyHotkeyName('Get and Move Footprint')
      .FriendlyName('Get and Move Footprint')
      .Tooltip(
        _HKI(
          'Selects a footprint by reference designator and places it under the cursor for moving',
        ),
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
      .FriendlyName(_HKI('Move'))
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_NONE),
  );

  static readonly moveIndividually = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveMove.moveIndividually')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('M'))
      .FriendlyName(_HKI('Move Individually'))
      .Tooltip(_HKI('Moves the selected items one-by-one'))
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_NONE),
  );

  static readonly moveWithReference = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveMove.moveWithReference')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Move with Reference...'))
      .Tooltip(_HKI('Moves the selected item(s) with a specified starting point'))
      .Icon(BITMAPS.move)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(CURSOR_EVENT_TYPE.CURSOR_NONE),
  );

  static readonly copyWithReference = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveMove.copyWithReference')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Copy with Reference...'))
      .Tooltip(_HKI('Copy selected item(s) to clipboard with a specified starting point'))
      .Icon(BITMAPS.copy)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly duplicateIncrement = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.duplicateIncrementPads')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + MD_SHIFT + ch('D'))
      .LegacyHotkeyName('Duplicate Item and Increment')
      .FriendlyName(_HKI('Duplicate and Increment'))
      .Tooltip(_HKI('Duplicates the selected item(s), incrementing pad numbers'))
      .Icon(BITMAPS.duplicate),
  );

  static readonly moveExact = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.moveExact')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('M'))
      .LegacyHotkeyName('Move Item Exactly')
      .FriendlyName(_HKI('Move Exactly...'))
      .Tooltip(_HKI('Moves the selected item(s) by an exact amount'))
      .Icon(BITMAPS.move_exactly),
  );

  static readonly pointEditorMoveCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.moveCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Move Corner To...'))
      .Tooltip(_HKI('Move the active corner to an exact location'))
      .Icon(BITMAPS.move_exactly),
  );

  static readonly pointEditorMoveMidpoint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.moveMidpoint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Move Midpoint To...'))
      .Tooltip(_HKI('Move the active midpoint to an exact location'))
      .Icon(BITMAPS.move_exactly),
  );

  static readonly rotateCw = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.rotateCw')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('R'))
      .LegacyHotkeyName('Rotate Item Clockwise (Modern Toolset only)')
      .FriendlyName(_HKI('Rotate Clockwise'))
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
      .FriendlyName(_HKI('Rotate Counterclockwise'))
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
      .FriendlyName(_HKI('Change Side / Flip'))
      .Tooltip(_HKI('Flips selected item(s) to opposite side of board'))
      .Icon(BITMAPS.swap_layer),
  );

  static readonly mirrorH = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.mirrorHoriontally')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Mirror Horizontally'))
      .Tooltip(_HKI('Mirrors selected item(s) across the Y axis'))
      .Icon(BITMAPS.mirror_h),
  );

  static readonly mirrorV = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.mirrorVertically')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Mirror Vertically'))
      .Tooltip(_HKI('Mirrors selected item(s) across the X axis'))
      .Icon(BITMAPS.mirror_v),
  );

  static readonly swap = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.swap')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('S'))
      .FriendlyName(_HKI('Swap'))
      .Tooltip(_HKI('Swap positions of selected items'))
      .Icon(BITMAPS.swap),
  );

  static readonly swapPadNets = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.swapPadNets')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Swap Pad Nets'))
      .Tooltip(_HKI('Swap nets between two selected pads and their connected copper'))
      .Icon(BITMAPS.swap),
  );

  static readonly swapGateNets = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.swapGateNets')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Swap Gate Nets'))
      .Tooltip(_HKI('Swap nets between gates of a footprint and their connected copper'))
      .Parameter<string>('')
      .Icon(BITMAPS.swap),
  );

  static readonly packAndMoveFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.packAndMoveFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('P'))
      .FriendlyName(_HKI('Pack and Move Footprints'))
      .Tooltip(
        _HKI('Sorts selected footprints by reference, packs based on size and initiates movement'),
      )
      .Icon(BITMAPS.pack_footprints),
  );

  static readonly skip = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.skip')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(WXK.WXK_TAB)
      .FriendlyName(_HKI('Skip'))
      .Tooltip(_HKI('Skip to next item'))
      .Icon(BITMAPS.right),
  );

  static readonly changeTrackWidth = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.changeTrackWidth')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Change Track Width'))
      .Tooltip(_HKI('Updates selected track & via sizes')),
  );

  static readonly changeTrackLayerNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.changeTrackLayerNext')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('+'))
      .FriendlyName('Switch Track to Next Layer')
      .Tooltip(_HKI('Switch track to next enabled copper layer')),
  );

  static readonly changeTrackLayerPrev = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.changeTrackLayerPrev')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('-'))
      .FriendlyName('Switch Track to Previous Layer')
      .Tooltip(_HKI('Switch track to previous enabled copper layer')),
  );

  static readonly filletTracks = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.filletTracks')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Fillet Tracks'))
      .Tooltip(_HKI('Adds arcs tangent to the selected straight track segments')),
  );

  static readonly filletLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.filletLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Fillet Lines...'))
      .Tooltip(_HKI('Adds arcs tangent to the selected lines'))
      .Icon(BITMAPS.fillet),
  );

  static readonly chamferLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.chamferLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Chamfer Lines...'))
      .Tooltip(_HKI('Cut away corners between selected lines'))
      .Icon(BITMAPS.chamfer),
  );

  static readonly dogboneCorners = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.dogboneCorners')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Dogbone Corners...'))
      .Tooltip(_HKI('Add dogbone corners to selected lines')),
  );

  static readonly simplifyPolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.simplifyPolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Simplify Polygons'))
      .Tooltip(_HKI('Simplify polygon outlines, removing superfluous points')),
  );

  static readonly editVertices = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.editVertices')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Edit Corners...'))
      .Tooltip(_HKI('Edit polygon corners using a table'))
      .Icon(BITMAPS.edit),
  );

  static readonly healShapes = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.healShapes')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Heal Shapes'))
      .Tooltip(_HKI('Connect shapes, possibly extending or cutting them, or adding extra geometry'))
      .Icon(BITMAPS.heal_shapes),
  );

  static readonly extendLines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.extendLines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Extend Lines to Meet'))
      .Tooltip(_HKI('Extend lines to meet each other')),
  );

  static readonly mergePolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.mergePolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Merge Polygons'))
      .Tooltip(_HKI('Merge selected polygons into a single polygon'))
      .Icon(BITMAPS.merge_polygons),
  );

  static readonly subtractPolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.subtractPolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Subtract Polygons'))
      .Tooltip(_HKI('Subtract selected polygons from the last one selected'))
      .Icon(BITMAPS.subtract_polygons),
  );

  static readonly intersectPolygons = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.intersectPolygons')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Intersect Polygons'))
      .Tooltip(_HKI('Create the intersection of the selected polygons'))
      .Icon(BITMAPS.intersect_polygons),
  );

  static readonly deleteFull = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveEdit.deleteFull')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + WXK.WXK_DELETE)
      .LegacyHotkeyName('Delete Full Track')
      .FriendlyName('Delete Full Track')
      .Tooltip(_HKI('Deletes selected item(s) and copper connections'))
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
      .FriendlyName(_HKI('Properties...'))
      .Icon(BITMAPS.edit),
  );

  static readonly createArray = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Array.createArray')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('T'))
      .LegacyHotkeyName('Create Array')
      .FriendlyName(_HKI('Create Array...'))
      .Icon(BITMAPS.array)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly newFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.newFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('N'))
      .LegacyHotkeyName('New')
      .FriendlyName(_HKI('New Footprint'))
      .Tooltip(_HKI('Create a new, empty footprint'))
      .Icon(BITMAPS.new_footprint),
  );

  static readonly createFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.createFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Create Footprint...'))
      .Tooltip(_HKI('Create a new footprint using the Footprint Wizard'))
      .Icon(BITMAPS.module_wizard),
  );

  static readonly editFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.editFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Edit Footprint'))
      .Tooltip(_HKI('Show selected footprint on editor canvas'))
      .Icon(BITMAPS.edit),
  );

  static readonly duplicateFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.duplicateFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Duplicate Footprint'))
      .Icon(BITMAPS.duplicate),
  );

  static readonly renameFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.renameFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Rename Footprint...'))
      .Icon(BITMAPS.edit),
  );

  static readonly deleteFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.deleteFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Delete Footprint from Library'))
      .Icon(BITMAPS.trash),
  );

  static readonly cutFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.cutFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Cut Footprint'))
      .Icon(BITMAPS.cut),
  );

  static readonly copyFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.copyFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Copy Footprint'))
      .Icon(BITMAPS.copy),
  );

  static readonly pasteFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.pasteFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Paste Footprint'))
      .Icon(BITMAPS.paste),
  );

  static readonly importFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.importFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Import Footprint...'))
      .Tooltip(_HKI('Import footprint from file'))
      .Icon(BITMAPS.import_module),
  );

  static readonly exportFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.exportFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export Current Footprint...'))
      .Tooltip(_HKI('Export edited footprint to file'))
      .Icon(BITMAPS.export_module),
  );

  static readonly footprintProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.footprintProperties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Footprint Properties...'))
      .Icon(BITMAPS.module_options),
  );

  static readonly padTable = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.padTable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Pad Table...'))
      .Tooltip(_HKI('Displays pad table for bulk editing of pads'))
      .Icon(BITMAPS.pin_table),
  );

  static readonly checkFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.checkFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Footprint Checker'))
      .Tooltip(_HKI('Show the footprint checker window'))
      .Icon(BITMAPS.erc),
  );

  static readonly loadFpFromBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.loadFootprintFromBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Load footprint from current PCB'))
      .Tooltip(_HKI('Load footprint from current board'))
      .Icon(BITMAPS.load_module_board),
  );

  static readonly saveFpToBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.saveFootprintToBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Insert footprint into PCB'))
      .Tooltip(_HKI('Insert footprint into current board'))
      .Icon(BITMAPS.insert_module_board),
  );

  static readonly previousFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.previousFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Display previous footprint'))
      .Icon(BITMAPS.lib_previous)
      .Parameter<FPVIEWER_CONSTANTS>(FPVIEWER_CONSTANTS.PREVIOUS_PART),
  );

  static readonly nextFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.nextFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Display next footprint'))
      .Icon(BITMAPS.lib_next)
      .Parameter<FPVIEWER_CONSTANTS>(FPVIEWER_CONSTANTS.NEXT_PART),
  );

  static readonly updateFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.updateFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Update Footprint...'))
      .Tooltip(_HKI('Update footprint to include any changes from the library'))
      .Icon(BITMAPS.refresh),
  );

  static readonly updateFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.updateFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Update Footprints from Library...'))
      .Tooltip(_HKI('Update footprints to include any changes from the library'))
      .Icon(BITMAPS.refresh),
  );

  static readonly migrate3DModels = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.migrate3DModels')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Migrate 3D Models...'))
      .Tooltip(_HKI('Replace obsolete WRL 3D model references with current STEP models'))
      .Icon(BITMAPS.refresh),
  );

  static readonly removeUnusedPads = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.removeUnusedPads')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Remove Unused Pads...'))
      .Tooltip(_HKI('Remove or restore the unconnected inner layers on through hole pads and vias'))
      .Icon(BITMAPS.pads_remove),
  );

  static readonly changeFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.changeFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Change Footprint...'))
      .Tooltip(_HKI('Assign a different footprint from the library'))
      .Icon(BITMAPS.exchange),
  );

  static readonly changeFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.changeFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Change Footprints...'))
      .Tooltip(_HKI('Assign different footprints from the library'))
      .Icon(BITMAPS.exchange),
  );

  static readonly swapLayers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.swapLayers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Swap Layers...'))
      .Tooltip(_HKI('Move tracks or drawings from one layer to another'))
      .Icon(BITMAPS.swap_layer),
  );

  static readonly editTracksAndVias = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.editTracksAndVias')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Edit Track & Via Properties...'))
      .Tooltip(_HKI('Edit track and via properties globally across board'))
      .Icon(BITMAPS.width_track_via),
  );

  static readonly editTextAndGraphics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.editTextAndGraphics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Edit Text & Graphics Properties...'))
      .Tooltip(_HKI('Edit Text and graphics properties globally across board'))
      .Icon(BITMAPS.text),
  );

  static readonly editTeardrops = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.editTeardrops')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Edit Teardrops...'))
      .Tooltip(_HKI('Add, remove or edit teardrops globally across board'))
      .Icon(BITMAPS.via),
  );

  static readonly globalDeletions = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.globalDeletions')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Global Deletions...'))
      .Tooltip(_HKI('Delete tracks, footprints and graphic items from board'))
      .Icon(BITMAPS.general_deletions),
  );

  static readonly cleanupTracksAndVias = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.cleanupTracksAndVias')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Cleanup Tracks & Vias...'))
      .Tooltip(_HKI('Cleanup redundant items, shorting items, etc.'))
      .Icon(BITMAPS.cleanup_tracks_and_vias),
  );

  static readonly cleanupGraphics = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.GlobalEdit.cleanupGraphics')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Cleanup Graphics...'))
      .Tooltip(_HKI('Cleanup redundant items, etc.'))
      .Icon(BITMAPS.cleanup_graphics),
  );

  static readonly microwaveCreateGap = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createGap')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Microwave Gaps'))
      .Tooltip(_HKI('Create gap of specified length for microwave applications'))
      .Icon(BITMAPS.mw_add_gap)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.GAP),
  );

  static readonly microwaveCreateStub = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createStub')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Microwave Stubs'))
      .Tooltip(_HKI('Create stub of specified length for microwave applications'))
      .Icon(BITMAPS.mw_add_stub)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.STUB),
  );

  static readonly microwaveCreateStubArc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createStubArc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Microwave Arc Stubs'))
      .Tooltip(_HKI('Create stub (arc) of specified size for microwave applications'))
      .Icon(BITMAPS.mw_add_stub_arc)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC),
  );

  static readonly microwaveCreateFunctionShape = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createFunctionShape')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Microwave Polygonal Shapes'))
      .Tooltip(_HKI('Create a microwave polygonal shape from a list of vertices'))
      .Icon(BITMAPS.mw_add_shape)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(MICROWAVE_FOOTPRINT_SHAPE.FUNCTION_SHAPE),
  );

  static readonly microwaveCreateLine = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.MicrowaveTool.createLine')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Microwave Lines'))
      .Tooltip(_HKI('Create line of specified length for microwave applications'))
      .Icon(BITMAPS.mw_add_line)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly copyPadSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.CopyPadSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Copy Pad Properties to Default'))
      .Tooltip(_HKI("Copy current pad's properties"))
      .Icon(BITMAPS.copy_pad_settings),
  );

  static readonly applyPadSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.ApplyPadSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Paste Default Pad Properties to Selected'))
      .Tooltip(_HKI("Replace the current pad's properties with those copied earlier"))
      .Icon(BITMAPS.apply_pad_settings),
  );

  static readonly pushPadSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.PushPadSettings')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Push Pad Properties to Other Pads...'))
      .Tooltip(_HKI("Copy the current pad's properties to other pads"))
      .Icon(BITMAPS.push_pad_settings),
  );

  static readonly enumeratePads = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.enumeratePads')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Renumber Pads...'))
      .Tooltip(_HKI('Renumber pads by clicking on them in the desired order'))
      .Icon(BITMAPS.pad_enumerate)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly placePad = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.placePad')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Add Pad'))
      .Tooltip(_HKI('Add a pad'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pad)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly explodePad = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.explodePad')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .FriendlyName(_HKI('Edit Pad as Graphic Shapes'))
      .Tooltip(_HKI('Ungroups a custom-shaped pad for editing as individual graphic shapes'))
      .Icon(BITMAPS.custom_pad_to_primitives),
  );

  static readonly recombinePad = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.recombinePad')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .FriendlyName(_HKI('Finish Pad Edit'))
      .Tooltip(_HKI('Regroups all touching graphic shapes into the edited pad'))
      .Icon(BITMAPS.custom_pad_to_primitives),
  );

  static readonly defaultPadProperties = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PadTool.defaultPadProperties')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Default Pad Properties...'))
      .Tooltip(_HKI('Edit the pad properties used when creating new pads'))
      .Icon(BITMAPS.options_pad),
  );

  static readonly pluginsShowFolder = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ScriptingTool.pluginsShowFolder')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Open Plugin Directory'))
      .Tooltip(_HKI('Opens the directory in the default system file manager'))
      .Icon(BITMAPS.directory_open),
  );

  static readonly appendBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.appendBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Append Board...'))
      .Tooltip(_HKI('Open another board and append its contents to this board'))
      .Icon(BITMAPS.add_board),
  );

  static readonly rescueAutosave = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.rescueAutosave')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Rescue'))
      .Tooltip(_HKI('Clear board and get last rescue file automatically saved by PCB editor'))
      .Icon(BITMAPS.rescue),
  );

  static readonly openNonKicadBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.openNonKicadBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Import Non-KiCad Board File...'))
      .Tooltip(_HKI('Import board file from other applications'))
      .Icon(BITMAPS.import_brd_file),
  );

  static readonly exportFootprints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportFootprints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export Footprints...'))
      .Tooltip(
        _HKI(
          'Add footprints from board to a new or an existing footprint library\n(does not remove other footprints from this library)',
        ),
      )
      .Icon(BITMAPS.library_archive),
  );

  static readonly boardSetup = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.boardSetup')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Board Setup...'))
      .Tooltip(_HKI('Edit board setup including layers, design rules and various defaults'))
      .Icon(BITMAPS.options_board),
  );

  static readonly importNetlist = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.importNetlist')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Import Netlist...'))
      .Tooltip(_HKI('Read netlist and update board connectivity'))
      .Icon(BITMAPS.netlist),
  );

  static readonly importSpecctraSession = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.importSpecctraSession')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Import Specctra Session...'))
      .Tooltip(_HKI('Import routed Specctra session (*.ses) file'))
      .Icon(BITMAPS.import),
  );

  static readonly exportSpecctraDSN = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportSpecctraDSN')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export Specctra DSN...'))
      .Tooltip(_HKI('Export Specctra DSN routing info'))
      .Icon(BITMAPS.export_dsn),
  );

  static readonly generateGerbers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateGerbers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Gerbers (.gbr)...'))
      .Tooltip(_HKI('Generate Gerbers for fabrication'))
      .Icon(BITMAPS.post_gerber),
  );

  static readonly generateDrillFiles = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateDrillFiles')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Drill Files (.drl)...'))
      .Tooltip(_HKI('Generate Excellon drill file(s)'))
      .Icon(BITMAPS.post_drill),
  );

  static readonly generatePosFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generatePosFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Component Placement (.pos, .gbr)...'))
      .Tooltip(_HKI('Generate component placement file(s) for pick and place'))
      .Icon(BITMAPS.post_compo),
  );

  static readonly generateReportFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateReportFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Footprint Report (.rpt)...'))
      .Tooltip(_HKI('Create report of all footprints from current board'))
      .Icon(BITMAPS.post_rpt),
  );

  static readonly generateIPC2581File = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateIPC2581File')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('IPC-2581 File (.xml)...'))
      .Tooltip(_HKI('Generate an IPC-2581 file'))
      .Icon(BITMAPS.post_xml),
  );

  static readonly generateODBPPFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateODBPPFile')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('ODB++ Output File...'))
      .Tooltip(_HKI('Generate ODB++ output files'))
      .Icon(BITMAPS.post_odb),
  );

  static readonly generateD356File = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateD356File')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('IPC-D-356 Netlist File...'))
      .Tooltip(_HKI('Generate IPC-D-356 netlist file'))
      .Icon(BITMAPS.post_d356),
  );

  static readonly generateBOM = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.generateBOM')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Bill of Materials...'))
      .Tooltip(_HKI('Create bill of materials from board'))
      .Icon(BITMAPS.post_bom),
  );

  static readonly exportGenCAD = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportGenCAD')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export GenCAD...'))
      .Tooltip(_HKI('Export GenCAD board representation'))
      .Icon(BITMAPS.post_gencad),
  );

  static readonly exportVRML = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportVRML')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export VRML...'))
      .Tooltip(_HKI('Export VRML 3D board representation'))
      .Icon(BITMAPS.export3d),
  );

  static readonly exportIDF = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportIDF')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export IDFv3...'))
      .Tooltip(_HKI('Export IDF 3D board representation'))
      .Icon(BITMAPS.export_idf),
  );

  static readonly exportSTEP = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportSTEP')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export STEP/GLB/BREP/XAO/PLY/STL...'))
      .Tooltip(_HKI('Export STEP, GLB, BREP, XAO, PLY or STL 3D board representation'))
      .Icon(BITMAPS.export_step),
  );

  static readonly exportCmpFile = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportFootprintAssociations')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export Footprint Association (.cmp) File...'))
      .Tooltip(_HKI('Export footprint association file (*.cmp) for schematic back annotation'))
      .Icon(BITMAPS.export_cmp),
  );

  static readonly exportHyperlynx = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.exportHyperlynx')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Hyperlynx...'))
      .Icon(BITMAPS.export_step),
  );

  static readonly collect3DModels = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.collect3DModels')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Collect And Embed 3D Models'))
      .Tooltip(_HKI('Collect footprint 3D models and embed them into the board'))
      .Icon(BITMAPS.import3d),
  );

  static readonly trackWidthInc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.trackWidthInc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('W'))
      .LegacyHotkeyName('Switch Track Width To Next')
      .FriendlyName(_HKI('Switch Track Width to Next'))
      .Tooltip(_HKI('Change track width to next pre-defined size')),
  );

  static readonly trackWidthDec = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.trackWidthDec')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('W'))
      .LegacyHotkeyName('Switch Track Width To Previous')
      .FriendlyName(_HKI('Switch Track Width to Previous'))
      .Tooltip(_HKI('Change track width to previous pre-defined size')),
  );

  static readonly viaSizeInc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.viaSizeInc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch("'"))
      .LegacyHotkeyName('Increase Via Size')
      .FriendlyName('Increase Via Size')
      .Tooltip(_HKI('Change via size to next pre-defined size')),
  );

  static readonly viaSizeDec = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.viaSizeDec')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('\\'))
      .LegacyHotkeyName('Decrease Via Size')
      .FriendlyName('Decrease Via Size')
      .Tooltip(_HKI('Change via size to previous pre-defined size')),
  );

  static readonly autoTrackWidth = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.autoTrackWidth')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Automatically select track width'))
      .Tooltip(
        _HKI(
          'When routing from an existing track use its width instead of the current width setting',
        ),
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
      .FriendlyName(_HKI('Assign Netclass...'))
      .Tooltip(_HKI('Assign a netclass to nets matching a pattern'))
      .Icon(BITMAPS.netlist),
  );

  static readonly zoneMerge = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zoneMerge')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Merge Zones')),
  );

  static readonly zoneDuplicate = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zoneDuplicate')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Duplicate Zone onto Layer...'))
      .Icon(BITMAPS.zone_duplicate),
  );

  static readonly zonePriorityMoveToTop = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityMoveToTop')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Move to Top'))
      .Icon(BITMAPS.small_up),
  );

  static readonly zonePriorityRaise = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityRaise')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Raise'))
      .Icon(BITMAPS.small_up),
  );

  static readonly zonePriorityLower = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityLower')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Lower'))
      .Icon(BITMAPS.small_down),
  );

  static readonly zonePriorityMoveToBottom = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.zonePriorityMoveToBottom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Move to Bottom'))
      .Icon(BITMAPS.small_down),
  );

  static readonly placeFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.placeFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('A'))
      .LegacyHotkeyName('Add Footprint')
      .FriendlyName(_HKI('Place Footprints'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.module)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter<FOOTPRINT | null>(null),
  );

  static readonly drillOrigin = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.drillOrigin')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Drill/Place File Origin'))
      .Tooltip(_HKI('Place origin point for drill files and component placement files'))
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
      .FriendlyName(_HKI('Toggle Lock'))
      .Tooltip(_HKI('Lock or unlock selected items'))
      .Icon(BITMAPS.lock_unlock),
  );

  static readonly lineModeFree = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineModeFree')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Line Modes'))
      .Tooltip(_HKI('Draw and drag at any angle'))
      .Icon(BITMAPS.lines_any)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(LEADER_MODE.DIRECT),
  );

  static readonly lineMode90 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineModeOrthonal')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Line Modes'))
      .Tooltip(_HKI('Constrain drawing and dragging to horizontal or vertical motions'))
      .Icon(BITMAPS.lines90)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(LEADER_MODE.DEG90),
  );

  static readonly lineMode45 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineMode45')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Line Modes'))
      .Tooltip(
        _HKI('Constrain drawing and dragging to horizontal, vertical, or 45-degree angle motions'),
      )
      .Icon(BITMAPS.hv45mode)
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(LEADER_MODE.DEG45),
  );

  static readonly lineModeNext = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.lineModeNext')
      .DefaultHotkey(MD_SHIFT + ch(' '))
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Line Modes'))
      .Tooltip(_HKI('Switch to next angle snapping mode')),
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
      .FriendlyName(_HKI('Lock'))
      .Tooltip(_HKI('Prevent items from being moved and/or resized on the canvas'))
      .Icon(BITMAPS.locked),
  );

  static readonly unlock = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.unlock')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Unlock'))
      .Tooltip(_HKI('Allow items to be moved and/or resized on the canvas'))
      .Icon(BITMAPS.unlocked),
  );

  static readonly highlightNet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.highlightNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('`'))
      .LegacyHotkeyName('Toggle Highlight of Selected Net (Modern Toolset only)')
      .FriendlyName(_HKI('Highlight Net'))
      .Tooltip(_HKI('Highlight net under cursor'))
      .Icon(BITMAPS.net_highlight)
      .Parameter<number>(0),
  );

  static readonly toggleLastNetHighlight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.toggleLastNetHighlight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Toggle Last Net Highlight'))
      .Tooltip(_HKI('Toggle between last two highlighted nets'))
      .Parameter<number>(0),
  );

  static readonly clearHighlight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.clearHighlight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('~'))
      .FriendlyName(_HKI('Clear Net Highlighting')),
  );

  static readonly toggleNetHighlight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.toggleNetHighlight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_ALT + ch('`'))
      .FriendlyName(_HKI('Toggle Net Highlight'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.net_highlight)
      .Parameter<number>(0),
  );

  static readonly highlightNetSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.highlightNetSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Highlight Net'))
      .Tooltip(_HKI('Highlight all copper items on the selected net(s)'))
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
      .FriendlyName(_HKI('Hide Net in Ratsnest'))
      .Tooltip(_HKI('Hide the selected net in the ratsnest of unconnected net lines/arcs'))
      .Icon(BITMAPS.hide_ratsnest)
      .Parameter<number>(0),
  );

  static readonly showNetInRatsnest = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.showNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Show Net in Ratsnest'))
      .Tooltip(_HKI('Show the selected net in the ratsnest of unconnected net lines/arcs'))
      .Icon(BITMAPS.show_ratsnest)
      .Parameter<number>(0),
  );

  static readonly showEeschema = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.EditorControl.showEeschema')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Switch to Schematic Editor'))
      .Tooltip(_HKI('Open schematic in schematic editor'))
      .Icon(BITMAPS.icon_eeschema_24),
  );

  static readonly drcRuleEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.DRETool.drcRuleEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('DRC Rule Editor'))
      .Tooltip(_HKI('Open DRC rule editor window')),
  );

  static readonly localRatsnestTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.localRatsnestTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Local Ratsnest'))
      .Tooltip(_HKI('Toggle ratsnest display of selected item(s)'))
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
      .FriendlyName(_HKI('Scripting Console'))
      .Tooltip(_HKI('Show the Python scripting console'))
      .Icon(BITMAPS.py_script)
      .ToolbarState(TOOLBAR_STATE.TOGGLE),
  );

  static readonly showLayersManager = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showLayersManager')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Appearance'))
      .Tooltip(_HKI('Show/hide the appearance manager'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.layers_manager),
  );

  static readonly showNetInspector = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showNetInspector')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Net Inspector'))
      .Tooltip(_HKI('Show/hide the net inspector'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.tools),
  );

  static readonly zonesManager = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zonesManager')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Zone Manager...'))
      .Tooltip(_HKI('Show the zone manager dialog'))
      .Icon(BITMAPS.show_zone),
  );

  static readonly flipBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.flipBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Flip Board View'))
      .Tooltip(_HKI('View board from the opposite side'))
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
      .FriendlyName(_HKI('Show Ratsnest'))
      .Tooltip(_HKI('Show lines/arcs representing missing connections on the board'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.general_ratsnest),
  );

  static readonly ratsnestLineMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.ratsnestLineMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Curved Ratsnest Lines'))
      .Tooltip(_HKI('Show ratsnest with curved lines'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.curved_ratsnest),
  );

  static readonly ratsnestModeCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.ratsnestModeCycle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Ratsnest Mode (3-state)'))
      .Tooltip(
        _HKI('Cycle between showing ratsnests for all layers, just visible layers, and none'),
      ),
  );

  static readonly netColorModeCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.netColorMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Net Color Mode (3-state)'))
      .Tooltip(
        _HKI('Cycle between using net and netclass colors for all nets, just ratsnests, and none'),
      ),
  );

  static readonly trackDisplayMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.trackDisplayMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('K'))
      .LegacyHotkeyName('Track Display Mode')
      .FriendlyName(_HKI('Sketch Tracks'))
      .Tooltip(_HKI('Show tracks in outline mode'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.showtrack),
  );

  static readonly padDisplayMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.padDisplayMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Sketch Pads'))
      .Tooltip(_HKI('Show pads in outline mode'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pad_sketch),
  );

  static readonly viaDisplayMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.viaDisplayMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Sketch Vias'))
      .Tooltip(_HKI('Show vias in outline mode'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.via_sketch),
  );

  static readonly graphicsOutlines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.graphicOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Sketch Graphic Items'))
      .Tooltip(_HKI('Show graphic items in outline mode'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_mod_edge),
  );

  static readonly textOutlines = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.textOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Sketch Text Items'))
      .Tooltip(_HKI('Show footprint texts in line mode'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.text_sketch),
  );

  static readonly showPadNumbers = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.showPadNumbers')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Show Pad Numbers'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.pad_number),
  );

  static readonly zoneDisplayFilled = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayEnable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Zone Fills'))
      .Tooltip(_HKI('Show filled areas of zones'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone),
  );

  static readonly zoneDisplayOutline = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayDisable')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Zone Outlines'))
      .Tooltip(_HKI('Show only zone boundaries'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone_disable),
  );

  static readonly zoneDisplayFractured = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayOutlines')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Zone Fill Fracture Borders'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone_outline_only),
  );

  static readonly zoneDisplayTriangulated = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayTesselation')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draw Zone Fill Triangulation'))
      .ToolbarState(TOOLBAR_STATE.TOGGLE)
      .Icon(BITMAPS.show_zone_triangulation),
  );

  static readonly zoneDisplayToggle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.zoneDisplayToggle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Toggle Zone Display'))
      .Tooltip(_HKI('Cycle between showing zone fills and just their outlines'))
      .Icon(BITMAPS.show_zone),
  );

  static readonly fpAutoZoom = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.fpAutoZoom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Automatic zoom'))
      .Tooltip(_HKI('Automatic Zoom on footprint change'))
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
      .FriendlyName(_HKI('Switch to Inner Layer 1'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In1_Cu),
  );

  static readonly layerInner2 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner2')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 2')
      .FriendlyName(_HKI('Switch to Inner Layer 2'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In2_Cu),
  );

  static readonly layerInner3 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner3')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 3')
      .FriendlyName(_HKI('Switch to Inner Layer 3'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In3_Cu),
  );

  static readonly layerInner4 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner4')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 4')
      .FriendlyName(_HKI('Switch to Inner Layer 4'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In4_Cu),
  );

  static readonly layerInner5 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner5')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 5')
      .FriendlyName(_HKI('Switch to Inner Layer 5'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In5_Cu),
  );

  static readonly layerInner6 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner6')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .LegacyHotkeyName('Switch to Inner layer 6')
      .FriendlyName(_HKI('Switch to Inner Layer 6'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In6_Cu),
  );

  static readonly layerInner7 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner7')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 7'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In7_Cu),
  );

  static readonly layerInner8 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner8')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 8'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In8_Cu),
  );

  static readonly layerInner9 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner9')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 9'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In9_Cu),
  );

  static readonly layerInner10 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner10')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 10'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In10_Cu),
  );

  static readonly layerInner11 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner11')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 11'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In11_Cu),
  );

  static readonly layerInner12 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner12')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 12'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In12_Cu),
  );

  static readonly layerInner13 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner13')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 13'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In13_Cu),
  );

  static readonly layerInner14 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner14')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 14'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In14_Cu),
  );

  static readonly layerInner15 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner15')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 15'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In15_Cu),
  );

  static readonly layerInner16 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner16')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 16'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In16_Cu),
  );

  static readonly layerInner17 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner17')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 17'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In17_Cu),
  );

  static readonly layerInner18 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner18')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 18'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In18_Cu),
  );

  static readonly layerInner19 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner19')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 19'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In19_Cu),
  );

  static readonly layerInner20 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner20')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 20'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In20_Cu),
  );

  static readonly layerInner21 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner21')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 21'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In21_Cu),
  );

  static readonly layerInner22 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner22')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 22'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In22_Cu),
  );

  static readonly layerInner23 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner23')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 23'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In23_Cu),
  );

  static readonly layerInner24 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner24')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 24'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In24_Cu),
  );

  static readonly layerInner25 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner25')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 25'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In25_Cu),
  );

  static readonly layerInner26 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner26')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 26'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In26_Cu),
  );

  static readonly layerInner27 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner27')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 27'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In27_Cu),
  );

  static readonly layerInner28 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner28')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 28'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In28_Cu),
  );

  static readonly layerInner29 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner29')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 29'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY)
      .Parameter(PCB_LAYER_ID.In29_Cu),
  );

  static readonly layerInner30 = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerInner30')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .Group(PCB_ACTIONS.layerDirectSwitchActions())
      .FriendlyName(_HKI('Switch to Inner Layer 30'))
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
      .FriendlyName(_HKI('Switch to Copper (B.Cu) Layer'))
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
      .FriendlyName(_HKI('Toggle Layer'))
      .Tooltip(_HKI('Switch between layers in active layer pair'))
      .Flags(TOOL_ACTION_FLAGS.AF_NOTIFY),
  );

  static readonly layerAlphaInc = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerAlphaInc')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('}'))
      .LegacyHotkeyName('Increment Layer Transparency (Modern Toolset only)')
      .FriendlyName(_HKI('Increase Layer Opacity'))
      .Tooltip(_HKI('Make the current layer less transparent'))
      .Icon(BITMAPS.contrast_mode),
  );

  static readonly layerAlphaDec = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerAlphaDec')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('{'))
      .LegacyHotkeyName('Decrement Layer Transparency (Modern Toolset only)')
      .FriendlyName(_HKI('Decrease Layer Opacity'))
      .Tooltip(_HKI('Make the current layer more transparent'))
      .Icon(BITMAPS.contrast_mode),
  );

  static readonly layerPairPresetsCycle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.layerPairPresetCycle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('V'))
      .FriendlyName(_HKI('Cycle Layer Pair Presets'))
      .Tooltip(_HKI('Cycle between preset layer pairs')),
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
      .FriendlyName(_HKI('Show Board Statistics'))
      .Tooltip(_HKI('Shows board statistics'))
      .Icon(BITMAPS.editor),
  );

  static readonly inspectClearance = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.InspectClearance')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Clearance Resolution'))
      .Tooltip(_HKI('Show clearance resolution for the active layer between two selected objects'))
      .Icon(BITMAPS.mw_add_gap),
  );

  static readonly inspectConstraints = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.InspectConstraints')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Constraints Resolution'))
      .Tooltip(_HKI('Show constraints resolution for the selected object'))
      .Icon(BITMAPS.mw_add_stub),
  );

  static readonly diffFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.DiffFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Compare Footprint with Library'))
      .Tooltip(_HKI('Show differences between board footprint and its library equivalent'))
      .Icon(BITMAPS.library),
  );

  static readonly showFootprintAssociations = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InspectionTool.ShowFootprintAssociations')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Show Footprint Associations'))
      .Tooltip(_HKI('Show footprint library and schematic symbol associations'))
      .Icon(BITMAPS.edit_cmp_symb_links),
  );

  static readonly boardReannotate = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ReannotateTool.ShowReannotateDialog')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Geographical Reannotate...'))
      .Tooltip(_HKI('Reannotate PCB in geographical order'))
      .Icon(BITMAPS.annotate),
  );

  static readonly repairBoard = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Control.repairBoard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Repair Board'))
      .Tooltip(_HKI('Run various diagnostics and attempt to repair board'))
      .Icon(BITMAPS.rescue)
      .Parameter(false),
  );

  static readonly repairFootprint = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ModuleEditor.repairFootprint')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Repair Footprint'))
      .Tooltip(_HKI('Run various diagnostics and attempt to repair footprint'))
      .Icon(BITMAPS.rescue),
  );

  static readonly alignTop = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignTop')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Align to Top'))
      .Tooltip(_HKI('Aligns selected items to the top edge of the item under the cursor'))
      .Icon(BITMAPS.align_items_top),
  );

  static readonly alignBottom = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignBottom')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Align to Bottom'))
      .Tooltip(_HKI('Aligns selected items to the bottom edge of the item under the cursor'))
      .Icon(BITMAPS.align_items_bottom),
  );

  static readonly alignLeft = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignLeft')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Align to Left'))
      .Tooltip(_HKI('Aligns selected items to the left edge of the item under the cursor'))
      .Icon(BITMAPS.align_items_left),
  );

  static readonly alignRight = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignRight')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Align to Right'))
      .Tooltip(_HKI('Aligns selected items to the right edge of the item under the cursor'))
      .Icon(BITMAPS.align_items_right),
  );

  static readonly alignCenterY = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignCenterY')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Align to Vertical Center'))
      .Tooltip(_HKI('Aligns selected items to the vertical center of the item under the cursor'))
      .Icon(BITMAPS.align_items_center),
  );

  static readonly alignCenterX = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.alignCenterX')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Align to Horizontal Center'))
      .Tooltip(_HKI('Aligns selected items to the horizontal center of the item under the cursor'))
      .Icon(BITMAPS.align_items_middle),
  );

  static readonly distributeHorizontallyCenters = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeHorizontallyCenters')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Distribute Horizontally by Centers'))
      .Tooltip(
        _HKI(
          'Distributes selected items between the left-most item and the right-most item so that the item centers are equally distributed',
        ),
      )
      .Icon(BITMAPS.distribute_horizontal_centers),
  );

  static readonly distributeHorizontallyGaps = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeHorizontallyGaps')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Distribute Horizontally with Even Gaps'))
      .Tooltip(
        _HKI(
          'Distributes selected items between the left-most item and the right-most item so that the gaps between items are equal',
        ),
      )
      .Icon(BITMAPS.distribute_horizontal_gaps),
  );

  static readonly distributeVerticallyGaps = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeVerticallyGaps')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Distribute Vertically with Even Gaps'))
      .Tooltip(
        _HKI(
          'Distributes selected items between the top-most item and the bottom-most item so that the gaps between items are equal',
        ),
      )
      .Icon(BITMAPS.distribute_vertical_gaps),
  );

  static readonly distributeVerticallyCenters = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.AlignAndDistribute.distributeVerticallyCenters')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Distribute Vertically by Centers'))
      .Tooltip(
        _HKI(
          'Distributes selected items between the top-most item and the bottom-most item so that the item centers are equally distributed',
        ),
      )
      .Icon(BITMAPS.distribute_vertical_centers),
  );

  static readonly pointEditorAddCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.addCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_INSERT)
      .FriendlyName(_HKI('Create Corner'))
      .Tooltip(_HKI('Create a corner'))
      .Icon(BITMAPS.add_corner),
  );

  static readonly pointEditorRemoveCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.removeCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Remove Corner'))
      .Tooltip(_HKI('Remove corner'))
      .Icon(BITMAPS.delete_cursor),
  );

  static readonly pointEditorChamferCorner = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PointEditor.chamferCorner')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Chamfer Corner'))
      .Tooltip(_HKI('Chamfer corner'))
      .Icon(BITMAPS.chamfer),
  );

  static readonly positionRelative = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PositionRelative.positionRelative')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('P'))
      .LegacyHotkeyName('Position Item Relative')
      .FriendlyName(_HKI('Position Relative To...'))
      .Tooltip(_HKI('Positions the selected item(s) by an exact amount relative to another'))
      .Icon(BITMAPS.move_relative),
  );

  static readonly interactiveOffsetTool = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.PositionRelative.interactiveOffsetTool')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Interactive Offset Tool'))
      .Tooltip(_HKI('Interactive tool for offsetting items by exact amounts'))
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
      .FriendlyName(_HKI('Select/Expand Connection'))
      .Tooltip(
        _HKI(
          'Selects a connection or expands an existing selection to junctions, pads, or entire connections',
        ),
      )
      .Icon(BITMAPS.add_tracks),
  );

  static readonly unrouteSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.unrouteSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Unroute Selected'))
      .Tooltip(_HKI('Unroutes selected items to the nearest pad.'))
      .Icon(BITMAPS.general_deletions),
  );

  static readonly unrouteSegment = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.unrouteSegment')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(WXK.WXK_BACK)
      .FriendlyName(_HKI('Unroute Segment'))
      .Tooltip(_HKI('Unroutes segment to the nearest segment.'))
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
      .FriendlyName(_HKI('Select All Tracks in Net'))
      .Tooltip(_HKI('Selects all tracks & vias belonging to the same net.'))
      .Parameter<number>(0),
  );

  static readonly deselectNet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.DeselectNet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Deselect All Tracks in Net'))
      .Tooltip(_HKI('Deselects all tracks & vias belonging to the same net.'))
      .Parameter<number>(0),
  );

  static readonly selectUnconnected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectUnconnected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('O'))
      .FriendlyName(_HKI('Select All Unconnected Footprints'))
      .Tooltip(_HKI('Selects all unconnected footprints belonging to each selected net.')),
  );

  static readonly grabUnconnected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.GrabUnconnected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('O'))
      .FriendlyName(_HKI('Grab Nearest Unconnected Footprints'))
      .Tooltip(
        _HKI(
          'Selects and initiates moving the nearest unconnected footprint on each selected net.',
        ),
      ),
  );

  static readonly selectOnSheetFromEeschema = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectOnSheet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Sheet'))
      .Tooltip(_HKI('Selects all footprints and tracks in the schematic sheet'))
      .Icon(BITMAPS.select_same_sheet),
  );

  static readonly selectSameSheet = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectSameSheet')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Items in Same Hierarchical Sheet'))
      .Tooltip(_HKI('Selects all footprints and tracks in the same schematic sheet'))
      .Icon(BITMAPS.select_same_sheet),
  );

  static readonly selectOnSchematic = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.SelectOnSchematic')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select on Schematic'))
      .Tooltip(_HKI('Selects corresponding items in Schematic editor'))
      .Icon(BITMAPS.select_same_sheet),
  );

  static readonly filterSelection = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveSelection.FilterSelection')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Filter Selected Items...'))
      .Tooltip(_HKI('Remove items from the selection by type'))
      .Icon(BITMAPS.filter),
  );

  static readonly zoneFill = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneFill')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Draft Fill Selected Zone(s)'))
      .Tooltip(
        _HKI('Update copper fill of selected zone(s) without regard to other interacting zones'),
      )
      .Icon(BITMAPS.fill_zone)
      .Parameter<ZONE | null>(null),
  );

  static readonly zoneFillAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneFillAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('B'))
      .LegacyHotkeyName('Fill or Refill All Zones')
      .FriendlyName(_HKI('Fill All Zones'))
      .Tooltip(_HKI('Update copper fill of all zones'))
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
      .FriendlyName(_HKI('Unfill Selected Zone(s)'))
      .Tooltip(_HKI('Remove copper fill from selected zone(s)'))
      .Icon(BITMAPS.zone_unfill),
  );

  static readonly zoneUnfillAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.ZoneFiller.zoneUnfillAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('B'))
      .LegacyHotkeyName('Remove Filled Areas in All Zones')
      .FriendlyName(_HKI('Unfill All Zones'))
      .Tooltip(_HKI('Remove copper fill from all zones'))
      .Icon(BITMAPS.zone_unfill),
  );

  static readonly autoplaceSelectedComponents = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Autoplacer.autoplaceSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Place Selected Footprints'))
      .Tooltip(_HKI('Performs automatic placement of selected components')),
  );

  static readonly autoplaceOffboardComponents = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Autoplacer.autoplaceOffboard')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Place Off-Board Footprints'))
      .Tooltip(_HKI('Performs automatic placement of components outside board area')),
  );

  static readonly generatePlacementRuleAreas = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Multichannel.generatePlacementRuleAreas')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Generate Placement Rule Areas...'))
      .Tooltip(_HKI('Creates best-fit placement rule areas'))
      .Icon(BITMAPS.add_keepout_area)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly repeatLayout = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Multichannel.repeatLayout')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Repeat Layout...'))
      .Tooltip(_HKI('Clones placement & routing across multiple identical channels'))
      .Icon(BITMAPS.copy),
  );

  static readonly routeSingleTrack = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.SingleTrack')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('X'))
      .LegacyHotkeyName('Add New Track')
      .FriendlyName(_HKI('Route Single Track'))
      .Tooltip(_HKI('Route tracks'))
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
      .FriendlyName(_HKI('Route Differential Pair'))
      .Tooltip(_HKI('Route differential pairs'))
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
      .FriendlyName(_HKI('Interactive Router Settings...'))
      .Tooltip(_HKI('Open Interactive Router settings'))
      .Icon(BITMAPS.tools),
  );

  static readonly routerDiffPairDialog = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.DiffPairDialog')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Differential Pair Dimensions...'))
      .Tooltip(_HKI('Open Differential Pair Dimension settings'))
      .Icon(BITMAPS.ps_diff_pair_gap),
  );

  static readonly routerHighlightMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.HighlightMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Router Highlight Mode'))
      .Tooltip(_HKI('Switch router to highlight mode'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(PnsMode.RM_MarkObstacles),
  );

  static readonly routerShoveMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.ShoveMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Router Shove Mode'))
      .Tooltip(_HKI('Switch router to shove mode'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(PnsMode.RM_Shove),
  );

  static readonly routerWalkaroundMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.WalkaroundMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Router Walkaround Mode'))
      .Tooltip(_HKI('Switch router to walkaround mode'))
      .Flags(TOOL_ACTION_FLAGS.AF_NONE)
      .Parameter(PnsMode.RM_Walkaround),
  );

  static readonly cycleRouterMode = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.CycleRouterMode')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Cycle Router Mode'))
      .Tooltip(_HKI('Cycle router to the next mode')),
  );

  static readonly selectLayerPair = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.SelectLayerPair')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Set Layer Pair...'))
      .Tooltip(_HKI('Change active layer pair for routing'))
      .Icon(BITMAPS.select_layer_pair)
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE),
  );

  static readonly tuneSingleTrack = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.LengthTuner.TuneSingleTrack')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('7'))
      .LegacyHotkeyName('Tune Single Track (Modern Toolset only)')
      .FriendlyName(_HKI('Tune Length of a Single Track'))
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
      .FriendlyName(_HKI('Tune Length of a Differential Pair'))
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
      .FriendlyName(_HKI('Tune Skew of a Differential Pair'))
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
      .FriendlyName(_HKI('Undo Last Segment'))
      .Tooltip(_HKI('Walks the current track back one segment.')),
  );

  static readonly routerContinueFromEnd = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.ContinueFromEnd')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(MD_CTRL + ch('E'))
      .FriendlyName(_HKI('Route From Other End'))
      .Tooltip(_HKI('Commits current segments and starts next segment from nearest ratsnest end.')),
  );

  static readonly routerAttemptFinish = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.AttemptFinish')
      .Scope(TOOL_ACTION_SCOPE.AS_CONTEXT)
      .DefaultHotkey(ch('F'))
      .FriendlyName(_HKI('Attempt Finish'))
      .Tooltip(_HKI('Attempts to complete current route to nearest ratsnest end.'))
      .Parameter<boolean | null>(null),
  );

  static readonly routerRouteSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.RouteSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('X'))
      .FriendlyName(_HKI('Route Selected'))
      .Tooltip(_HKI('Sequentially route selected items from ratsnest anchor.'))
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_SINGLE),
  );

  static readonly routerRouteSelectedFromEnd = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.RouteSelectedFromEnd')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('E'))
      .FriendlyName(_HKI('Route Selected From Other End'))
      .Tooltip(_HKI('Sequentially route selected items from other end of ratsnest anchor.'))
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_SINGLE),
  );

  static readonly routerAutorouteSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.Autoroute')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_SHIFT + ch('F'))
      .FriendlyName(_HKI('Attempt Finish Selected (Autoroute)'))
      .Tooltip(_HKI('Sequentially attempt to automatically route all selected pads.'))
      .Flags(TOOL_ACTION_FLAGS.AF_ACTIVATE)
      .Parameter(PnsRouterMode.PNS_MODE_ROUTE_SINGLE),
  );

  static readonly cancelCurrentItem = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.CancelCurrentItem')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Cancel Current Item'))
      .Tooltip(_HKI('Skip current item and route next selected item.')),
  );

  static readonly breakTrack = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.BreakTrack')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Break Track'))
      .Tooltip(_HKI('Splits the track segment into two segments connected at the cursor position.'))
      .Icon(BITMAPS.break_line),
  );

  static readonly drag45Degree = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.Drag45Degree')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('D'))
      .LegacyHotkeyName('Drag Track Keep Slope')
      .FriendlyName(_HKI('Drag 45 Degree Mode'))
      .Tooltip(_HKI('Drags the track segment while keeping connected tracks at 45 degrees.'))
      .Icon(BITMAPS.drag_segment_withslope),
  );

  static readonly dragFreeAngle = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.InteractiveRouter.DragFreeAngle')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(ch('G'))
      .LegacyHotkeyName('Drag Item')
      .FriendlyName(_HKI('Drag Free Angle'))
      .Tooltip(_HKI('Drags the nearest joint in the track without restricting the track angle.'))
      .Icon(BITMAPS.drag_segment),
  );

  static readonly regenerateAllTuning = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.regenerateAllTuning')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Update All Tuning Patterns'))
      .Tooltip(_HKI('Attempt to re-tune existing tuning patterns within their bounds'))
      .Icon(BITMAPS.router_len_tuner)
      .Parameter('tuning_pattern'),
  );

  static readonly regenerateAll = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.regenerateAll')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Rebuild All Generators'))
      .Tooltip(_HKI('Rebuilds geometry of all generators'))
      .Icon(BITMAPS.refresh)
      .Parameter('*'),
  );

  static readonly regenerateSelected = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.Generator.regenerateSelected')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Rebuild Selected Generators'))
      .Tooltip(_HKI('Rebuilds geometry of selected generator(s)'))
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
      .FriendlyName(_HKI('Generators Manager'))
      .Tooltip(_HKI('Show a manager dialog for Generator objects'))
      .Icon(BITMAPS.pin_table),
  );

  static readonly lengthTunerSettings = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.LengthTuner.Settings')
      .ToolbarState(TOOLBAR_STATE.HIDDEN)
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .DefaultHotkey(MD_CTRL + ch('L'))
      .LegacyHotkeyName('Length Tuning Settings (Modern Toolset only)')
      .FriendlyName(_HKI('Length Tuning Settings'))
      .MenuText(_HKI('Length Tuning Settings...'))
      .Tooltip(_HKI('Displays tuning pattern properties dialog'))
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
      .FriendlyName(_HKI('Show wizards selector'))
      .Tooltip(_HKI('Select wizard script to run'))
      .Icon(BITMAPS.module_wizard),
  );

  static readonly resetWizardPrms = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.resetWizardPrms')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Reset wizard parameters'))
      .Tooltip(_HKI('Reset wizard parameters to default'))
      .Icon(BITMAPS.reload),
  );

  static readonly selectPreviousWizardPage = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.selectPreviousWizardPage')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select previous wizard page'))
      .Tooltip(_HKI('Select previous parameters page'))
      .Icon(BITMAPS.lib_previous),
  );

  static readonly selectNextWizardPage = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.selectNextWizardPage')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Select next wizard page'))
      .Tooltip(_HKI('Select next parameters page'))
      .Icon(BITMAPS.lib_next),
  );

  static readonly exportFpToEditor = new TOOL_ACTION(
    new TOOL_ACTION_ARGS()
      .Name('pcbnew.FpWizard.exportFpToEditor')
      .Scope(TOOL_ACTION_SCOPE.AS_GLOBAL)
      .FriendlyName(_HKI('Export footprint to editor'))
      .Tooltip(_HKI('Export footprint to editor'))
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
