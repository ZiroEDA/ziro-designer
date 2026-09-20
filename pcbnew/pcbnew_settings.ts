// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbnew_settings.h` + `pcbnew_settings.cpp`: the in-memory pcbnew
 * settings, every member at its PARAM default. The JSON side is the designer's
 * `PcbnewSettings` slice; the PARAM mapping between the two is pending with the
 * frame wiring (#636 stage 6).
 */
import { ANGLE_90, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ARC_EDIT_MODE } from '@ziroeda/common/src/frame_type.js';
import { APP_SETTINGS_BASE, WINDOW_SETTINGS } from '@ziroeda/common/src/settings/app_settings.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { RATSNEST_MODE } from '@ziroeda/common/src/project/board_project_settings.js';

// Settings for the CONVERT_TOOL.
export enum CONVERT_STRATEGY {
  COPY_LINEWIDTH,
  CENTERLINE,
  BOUNDING_HULL,
}

export class CONVERT_SETTINGS {
  m_Strategy: CONVERT_STRATEGY = CONVERT_STRATEGY.COPY_LINEWIDTH;
  m_Gap = 0;
  m_LineWidth = 0;
  m_DeleteOriginals = false;
}

export enum MAGNETIC_OPTIONS {
  NO_EFFECT = 0,
  CAPTURE_CURSOR_IN_TRACK_TOOL,
  CAPTURE_ALWAYS,
}

export class MAGNETIC_SETTINGS {
  pads: MAGNETIC_OPTIONS = MAGNETIC_OPTIONS.CAPTURE_CURSOR_IN_TRACK_TOOL;
  tracks: MAGNETIC_OPTIONS = MAGNETIC_OPTIONS.CAPTURE_CURSOR_IN_TRACK_TOOL;
  graphics = false;
  allLayers = false;
}

export enum TRACK_DRAG_ACTION {
  MOVE,
  DRAG,
  DRAG_FREE_ANGLE,
}

export enum TRACK_CLEARANCE_MODE {
  DO_NOT_SHOW_CLEARANCE = 0,
  SHOW_WHILE_ROUTING,
  SHOW_WITH_VIA_WHILE_ROUTING,
  SHOW_WITH_VIA_WHILE_ROUTING_OR_DRAGGING,
  SHOW_WITH_VIA_ALWAYS,
}
export const {
  DO_NOT_SHOW_CLEARANCE,
  SHOW_WHILE_ROUTING,
  SHOW_WITH_VIA_WHILE_ROUTING,
  SHOW_WITH_VIA_WHILE_ROUTING_OR_DRAGGING,
  SHOW_WITH_VIA_ALWAYS,
} = TRACK_CLEARANCE_MODE;

export enum PCB_DISPLAY_ORIGIN {
  PCB_ORIGIN_PAGE = 0,
  PCB_ORIGIN_AUX,
  PCB_ORIGIN_GRID,
}

export type ACTION_PLUGIN_SETTINGS_LIST = [string, boolean][];

export class VIEWERS_DISPLAY_OPTIONS {
  m_AngleSnapMode: LEADER_MODE = LEADER_MODE.DIRECT;
  m_DisplayGraphicsFill = true;
  m_DisplayTextFill = true;
  m_DisplayPadNumbers = true;
  m_DisplayPadFill = true;
}

// base class to handle Pcbnew SETTINGS also used in Cvpcb
export class PCB_VIEWERS_SETTINGS_BASE extends APP_SETTINGS_BASE {
  m_FootprintViewerZoom = 1.0; ///< The last zoom level used (0 for auto)
  m_FootprintViewerAutoZoomOnSelect = true; ///< true to use automatic zoom on fp selection

  m_ViewersDisplay = new VIEWERS_DISPLAY_OPTIONS();
}

export class AUI_PANELS {
  appearance_panel_tab = 0;
  appearance_expand_layer_display = false;
  appearance_expand_net_display = false;
  right_panel_width = -1;
  properties_panel_width = -1;
  net_inspector_width = -1;
  properties_splitter = 0.5;
  search_panel_height = -1;
  search_panel_width = -1;
  search_panel_dock_direction = 3;
  show_layer_manager = true;
  show_properties = true;
  show_search = false;
  show_net_inspector = false;
  design_blocks_show = false;
  design_blocks_panel_docked_width = -1;
  design_blocks_panel_float_width = -1;
  design_blocks_panel_float_height = -1;
}

export class DIALOG_EXPORT_D356 {
  // Export D356 uses wxFileDialog, so there's no DIALOG_SHIM to save/restore control state
  doNotExportUnconnectedPads = false;
}

export class DIALOG_DRC {
  report_all_track_errors = false;
  crossprobe = true;
  scroll_on_crossprobe = true;
}

export class FOOTPRINT_CHOOSER {
  // Footprint chooser is a FRAME, so there's no DIALOG_SHIM to save/restore control state
  width = -1;
  height = -1;
  sash_h = -1;
  sash_v = -1;
  sort_mode = 0;
  use_fp_filters = false;
  filter_on_pin_count = false;
}

export class DISPLAY_OPTIONS {
  // Note: Display options common to  Cvpcb and Pcbnew are stored in
  // VIEWERS_DISPLAY_OPTIONS m_ViewersDisplay, because the section DISPLAY_OPTIONS
  // exists only for Pcbnew
  m_DisplayViaFill = true;
  m_DisplayPcbTrackFill = true;
  m_TrackClearance: TRACK_CLEARANCE_MODE = TRACK_CLEARANCE_MODE.SHOW_WITH_VIA_WHILE_ROUTING;
  m_PadClearance = true;
  m_UseViaColorForNormalTHPadstacks = false;

  m_NetNames = 3;

  m_RatsnestMode: RATSNEST_MODE = RATSNEST_MODE.ALL;
  m_MaxLinksShowed = 3;
  m_ShowModuleRatsnest = true;
  m_ShowGlobalRatsnest = true;
  m_DisplayRatsnestLinesCurved = false;
  m_RatsnestThickness = 0.5;

  m_DisplayOrigin: PCB_DISPLAY_ORIGIN = PCB_DISPLAY_ORIGIN.PCB_ORIGIN_PAGE;
  m_DisplayInvertXAxis = false;
  m_DisplayInvertYAxis = false;

  m_ForceShowFieldsWhenFPSelected = true;

  m_Live3DRefresh = false;
}

///! Update the schema version whenever a migration is required
const pcbnewSchemaVersion = 5;

export class PCBNEW_SETTINGS extends PCB_VIEWERS_SETTINGS_BASE {
  m_AuiPanels = new AUI_PANELS();
  m_ExportD356 = new DIALOG_EXPORT_D356();
  m_DRCDialog = new DIALOG_DRC();
  m_FootprintChooser = new FOOTPRINT_CHOOSER();
  m_FootprintViewer = new WINDOW_SETTINGS();
  m_FootprintWizard = new WINDOW_SETTINGS();
  m_Display = new DISPLAY_OPTIONS();
  m_MagneticItems = new MAGNETIC_SETTINGS();
  m_TrackDragAction: TRACK_DRAG_ACTION = TRACK_DRAG_ACTION.DRAG;
  m_ArcEditMode: ARC_EDIT_MODE = ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS;
  m_CtrlClickHighlight = false;
  m_AngleSnapMode: LEADER_MODE = LEADER_MODE.DIRECT; // Constrain tool actions to horizontal/vertical or 45°/90°
  m_FlipDirection: FLIP_DIRECTION = FLIP_DIRECTION.TOP_BOTTOM;
  m_ESCClearsNetHighlight = true;
  m_PolarCoords = false;
  m_RotationAngle: EDA_ANGLE = ANGLE_90;
  m_ShowPageLimits = true;
  m_ShowCourtyardCollisions = true;
  ///<@todo Implement real auto zone filling (not just after zone properties are edited)
  m_AutoRefillZones = false; // Fill zones after editing the zone using the Zone Properties dialog
  m_AllowFreePads = false; // True: unlocked pads can be moved freely with respect to the footprint.
  // False (default): all pads are treated as locked for the purposes of
  // movement and any attempt to move them will move the footprint instead.
  m_ImportKeepKiCadLayerNames = false;
  m_PnsSettings: unknown = null; // std::unique_ptr<PNS::ROUTING_SETTINGS>, pending (#636 stage 6)
  m_FootprintViewerLibListWidth = 200;
  m_FootprintViewerFPListWidth = 300;
  m_LastFootprintLibDir = '';
  m_LastFootprint3dDir = '';
  m_VisibleActionPlugins: ACTION_PLUGIN_SETTINGS_LIST = [];

  constructor() {
    super('pcbnew', pcbnewSchemaVersion);
    this.addParamsForWindow(this.m_FootprintViewer);
    this.addParamsForWindow(this.m_FootprintWizard);
  }

  protected getLegacyFrameName(): string {
    return 'PcbFrame';
  }
}
