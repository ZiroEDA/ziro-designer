// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME` (pcbnew/pcb_edit_frame.h) — the non-window part the React
 * editor owns: the board, the tool manager wired as `setupTools` wires it,
 * the undo/redo stacks, and the settings the commit and undo code read.
 * `PcbEditor.tsx` is the window.
 *
 * The listener is `BOARD_LISTENER` as the React side subscribes to it: every
 * notification schedules one re-derivation of the view from the BOARD.
 */
import { ROUTER_TOOL } from './router/router_tool.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import { AUTOPLACE_TOOL } from './autorouter/autoplace_tool.js';
import type { BOARD_NETLIST_UPDATER } from './netlist_reader/board_netlist_updater.js';
import { PCB_TRACK } from './pcb_track.js';
import { SpreadFootprints } from './autorouter/spread_footprints.js';
import { PCB_CONTROL } from './tools/pcb_control.js';
import { BOARD_EDITOR_CONTROL } from './tools/board_editor_control.js';
import { PARSE_ERROR } from '@ziroeda/common/dsnlexer.js';
import { EDA_DRAW_FRAME, PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';
import { ARC_EDIT_MODE, FRAME_T } from '@ziroeda/common/frame_type.js';
import {
  CLEARANCE_LAYER_FOR,
  GAL_LAYER_ID,
  IsCopperLayer,
  PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import { EMBED_TOOL } from '@ziroeda/common/tool/embed_tool.js';
import { PROPERTIES_TOOL } from '@ziroeda/common/tool/properties_tool.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from './board.js';
import { BOARD_ITEM } from './board_item.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import { BOARD_LISTENER } from './board.js';
import {
  HIGH_CONTRAST_MODE,
  ZONE_DISPLAY_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import { ACTION_CONDITIONS } from '@ziroeda/common/tool/action_manager.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { PCB_EDITOR_CONDITIONS } from './tools/pcb_editor_conditions.js';
import { PCB_SELECTION_CONDITIONS } from './tools/pcb_selection_conditions.js';
import { PnsMode, type RoutingSettings } from './router/pns_routing_settings.js';
import { PAD } from './pad.js';
import { PCB_VIA, VIATYPE } from './pcb_track.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import {
  PCB_BASE_EDIT_FRAME,
  type IMPORT_GRAPHICS_RESULT,
  type PASTE_MODE,
} from './pcb_base_edit_frame.js';
import { STRTOK, strncpyLine } from '@ziroeda/common/libc/string.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from './pcb_base_frame.js';
import { type AUI_PANELS, PCBNEW_SETTINGS } from './pcbnew_settings.js';
import { BOARD_COMMIT, SKIP_SET_DIRTY, SKIP_UNDO } from './board_commit.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_FIELD } from './pcb_field.js';
import { PCB_TEXT } from './pcb_text.js';
import { PCB_DIMENSION_BASE } from './pcb_dimension.js';
import { FootprintNeedsUpdate } from './footprint_needs_update.js';
import { DIALOG_EXCHANGE_FOOTPRINTS } from './dialogs/dialog_exchange_footprints.js';
import { EMBEDDED_FILE, FILE_TYPE } from '@ziroeda/common/embedded_files.js';
import { UNCONNECTED_NET } from './netinfo_list.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { ZONE } from './zone.js';
import type { wxTextValidator } from '@ziroeda/common/validators.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { MICROWAVE_TOOL, type MICROWAVE_HOST } from './microwave/microwave_tool.js';
import { PCB_VIEWER_TOOLS } from './tools/pcb_viewer_tools.js';
import type { PcbFootprint } from './types.js';
import type { NETLIST } from './netlist_reader/pcb_netlist.js';
import { type DIALOG_DRC_LIKE, DRC_TOOL } from './tools/drc_tool.js';
import type { DRC_JOB_HOOKS, DRC_JOB_REQUEST } from './browser/drc_job.js';
import { runDrcJobOffThread } from './drc_runner.js';
import { PCB_TOOL_BASE } from './tools/pcb_tool_base.js';
import { MARKER_T } from '@ziroeda/common/marker_base.js';
import { RPT_SEVERITY_EXCLUSION } from '@ziroeda/common/reporter.js';
import type { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { GridEntry } from '@ziroeda/common/settings/grid_settings_ui.js';
import {
  frameTitle,
  type FrameTitleParts,
  READ_ONLY_SUFFIX,
} from '@ziroeda/common/use_document_title.js';
import { defaultUnitsToggle } from '@ziroeda/common/settings/app_settings_units.js';
import type { CrosshairMode } from '@ziroeda/common/draw_panel_gal_grid_cursor.js';
import type { RawFile } from '@ziroeda/common';
import { applyMixins } from '@ziroeda/core/mixins.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PCB_DESIGN_BLOCK_UTILS_MIXIN } from './pcb_design_block_utils.js';
import type { PCB_GROUP } from './pcb_group.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { PCB_DESIGN_BLOCK_PANE } from './widgets/pcb_design_block_pane.js';
import { INITPCB_MIXIN } from './initpcb.js';
import { EDIT_MIXIN } from './edit.js';
import { FILES_MIXIN } from './files.js';
import { EDIT_ZONE_HELPERS_MIXIN } from './edit_zone_helpers.js';
import { PCBNEW_CONFIG_MIXIN } from './pcbnew_config.js';
import { LOAD_SELECT_FOOTPRINT_MIXIN } from './load_select_footprint.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { PCB_SELECTION_FILTER_OPTIONS } from '@ziroeda/common/project/board_project_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import type { wxEvent } from '@ziroeda/common/wx/wx_event.js';
import type { SelectionFilter } from './dialogs/dialog_filter_selection.js';
import { PCB_POINT_EDITOR } from './tools/pcb_point_editor.js';
import { PCB_SELECTION_TOOL } from './tools/pcb_selection_tool.js';
import { EDIT_TOOL, type MOVE_EXACT_VALUES } from './tools/edit_tool.js';
import type { DOGBONE_PARAMETERS } from './tools/item_modification_routine.js';
import { ALIGN_DISTRIBUTE_TOOL } from './tools/align_distribute_tool.js';
import { BOARD_INSPECTION_TOOL } from './tools/board_inspection_tool.js';
import { POSITION_RELATIVE_TOOL } from './tools/position_relative_tool.js';
import type { DIALOG_POSITION_RELATIVE } from './dialogs/dialog_position_relative.js';
import type { DIALOG_OFFSET_ITEM } from './dialogs/dialog_offset_item.js';
import { PAD_TOOL } from './tools/pad_tool.js';
import { GLOBAL_EDIT_TOOL } from './tools/global_edit_tool.js';
import { ZONE_FILLER_TOOL } from './tools/zone_filler_tool.js';
import { ZONE_FILLER } from './zone_filler.js';
import type { VIA_DIMENSION } from './board_design_settings.js';

/**
 * `dialog_pns_diff_pair_dimensions.tsx`'s value, restated: qa typechecks this
 * module without JSX, so it cannot import a type from a `.tsx`.
 */
interface DiffPairDimensionsValue {
  width: number;
  gap: number;
  viaGap: number;
  viaGapSameAsTraceGap: boolean;
}

/** `dialog_track_via_size.tsx`'s value, restated for the same reason. */
interface CustomTrackViaSize {
  trackWidth: number;
  via: VIA_DIMENSION;
}
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import type { DIALOG_SWAP_LAYERS } from './dialogs/dialog_swap_layers.js';
import type { DIALOG_CLEANUP_TRACKS_AND_VIAS } from './dialogs/dialog_cleanup_tracks_and_vias.js';
import type { DIALOG_CLEANUP_GRAPHICS } from './dialogs/dialog_cleanup_graphics.js';
import type { DIALOG_UNUSED_PAD_LAYERS } from './dialogs/dialog_unused_pad_layers.js';
import type { DIALOG_GLOBAL_DELETION } from './dialogs/dialog_global_deletion.js';
import type { DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS } from './dialogs/dialog_global_edit_tracks_and_vias.js';
import type { DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS } from './dialogs/dialog_global_edit_text_and_graphics.js';
import type { DIALOG_GLOBAL_EDIT_TEARDROPS } from './dialogs/dialog_global_edit_teardrops.js';
import {
  type DIALOG_PUSH_PAD_PROPERTIES,
  wxID_CANCEL,
} from './dialogs/dialog_push_pad_properties.js';
import type { DIALOG_ENUM_PADS } from './dialogs/dialog_enum_pads.js';
import type { DIALOG_FP_EDIT_PAD_TABLE } from './dialogs/dialog_fp_edit_pad_table.js';
import { CONVERT_TOOL } from './tools/convert_tool.js';
import type { OUTSET_PARAMETERS } from './tools/item_modification_routine.js';
import type { CONVERT_SETTINGS } from './pcbnew_settings.js';
import type { ZONE_SETTINGS } from './zone_settings.js';
import { PCB_GROUP_TOOL } from './tools/pcb_group_tool.js';
import { DRAWING_MODE, DRAWING_TOOL } from './tools/drawing_tool.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { DIALOG_TEXT_PROPERTIES } from './dialogs/dialog_text_properties.js';
import { DIALOG_TABLE_PROPERTIES } from './dialogs/dialog_table_properties.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import { DIALOG_TEXTBOX_PROPERTIES } from './dialogs/dialog_textbox_properties.js';
import { DIALOG_BARCODE_PROPERTIES } from './dialogs/dialog_barcode_properties.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { DIALOG_NON_COPPER_ZONES_EDITOR } from './dialogs/dialog_non_copper_zones_properties.js';
import type { DIALOG_COPPER_ZONE } from './dialogs/panel_zone_properties.js';
import type { DIALOG_RULE_AREA_PROPERTIES } from './dialogs/dialog_rule_area_properties.js';
import { PCB_PICKER_TOOL } from './tools/pcb_picker_tool.js';
import type { PCB_SELECTION } from './tools/pcb_selection.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TABLECELL } from './pcb_tablecell.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { DIALOG_BOOK_REPORTER } from '@ziroeda/common/dialogs/dialog_book_reporter.js';

import {
  makeGatedDispatcher,
  type WINDOW_ACTION_HANDLER,
  WINDOW_ACTION_BRIDGE,
} from './tools/window_action_bridge.js';
import {
  LAYER_PAIR_SETTINGS,
  PCB_CURRENT_LAYER_PAIR_CHANGED,
  PCB_LAYER_PAIR_PRESETS_CHANGED,
} from './layer_pairs.js';

/** `INSPECT_DRC_ERROR_DIALOG_NAME` (pcb_edit_frame.cpp:160). */
const INSPECT_DRC_ERROR_DIALOG_NAME = 'InspectDrcErrorDialog';

/**
 * The slice of the designer's `PcbnewSettings` (`prefs/settings.ts`)
 * `pcbnewSettingsOf` reads — named structurally, the way
 * `FOOTPRINT_EDITOR_SETTINGS_LIKE` (`pcb_base_frame.ts`) already is, so this
 * package states what it needs of the JSON without importing `designer/`.
 * The designer's own `PcbnewSettings` satisfies this by construction; every
 * field name and type below is copied from its `PcbDisplayOptions` /
 * `PcbEditingSettings` (`prefs/settings.ts`).
 */
export interface PCBNEW_JSON_SETTINGS_LIKE {
  DRC: {
    report_all_track_errors: boolean;
    crossprobe: boolean;
    scroll_on_crossprobe: boolean;
  };
  appearance: {
    color_theme: string;
  };
  cross_probing: CROSS_PROBING_SETTINGS;
  /** `m_AuiPanels`, the keys the Search and Net Inspector panes persist. */
  aui: Pick<AUI_PANELS, 'show_search' | 'show_net_inspector' | 'search_panel_height'>;
  pcb_display: {
    net_names_mode: 0 | 1 | 2 | 3;
    pad_numbers: boolean;
    track_clearance_mode: 0 | 1 | 2 | 3 | 4;
    pad_clearance: boolean;
    pad_use_via_color_for_normal_th_padstacks: boolean;
    force_show_fields_when_fp_selected: boolean;
    live_3d_refresh: boolean;
    origin_mode: 0 | 1 | 2;
    origin_invert_x_axis: boolean;
    origin_invert_y_axis: boolean;
    ratsnest_footprint: boolean;
    ratsnest_curved: boolean;
    ratsnest_thickness: number;
    show_page_borders: boolean;
  };
  editing: {
    pcb_angle_snap_mode: 0 | 1 | 2;
    rotation_angle: number;
    arc_edit_mode: number;
    track_drag_action: 0 | 1 | 2;
    flip_left_right: boolean;
    allow_free_pads: boolean;
    auto_fill_zones: boolean;
    magnetic_pads: 0 | 1 | 2;
    magnetic_tracks: 0 | 1 | 2;
    magnetic_graphics: boolean;
    esc_clears_net_highlight: boolean;
    show_courtyard_collisions: boolean;
    ctrl_click_highlight: boolean;
    polar_coords: boolean;
  };
  /**
   * `APP_SETTINGS_BASE::m_Window.grid` / `.cursor` — the slice the window's
   * grid/crosshair toggles and grid-size list read. Added for
   * `pcbTogglesFromSettings` (`toggles.ts`) and the window's own
   * `pcbGridSizesIU`/`storedPcbGridIU`, both narrower readers of the same
   * `PcbnewSettings.window` than `windowSettingsOf` (`pgm_app.ts`) is.
   * `style`/`line_width`/`min_spacing`/`snap`/`always_show_cursor` are the
   * rest of `PANEL_GAL_OPTIONS`' two groups (`common/dialogs/
   * panel_gal_options.cpp:110-124`), which `PcbEditor.tsx`'s `galRef`
   * spreads together with `pcb_display` into a `windowSettingsOf`-shaped
   * object.
   */
  window: {
    grid: {
      sizes: GridEntry[];
      last_size_idx: number;
      show: boolean;
      style: 'dots' | 'lines' | 'crosses';
      line_width: number;
      min_spacing: number;
      snap: 0 | 1 | 2;
    };
    cursor: {
      crosshair: 'small' | 'full' | '45';
      always_show_cursor: boolean;
    };
  };
}

/**
 * `PCBNEW_SETTINGS`' PARAM list, the part of it the frame, the commit and the
 * undo code read, from the designer's `pcbnew.json` slice
 * (`pcbnew_settings.cpp`'s `pcb_display.*` and `editing.*` rows).
 */
export function pcbnewSettingsOf(json: PCBNEW_JSON_SETTINGS_LIKE): PCBNEW_SETTINGS {
  const s = new PCBNEW_SETTINGS();
  const d = json.pcb_display;
  const e = json.editing;

  s.m_Display.m_NetNames = d.net_names_mode;
  s.m_ViewersDisplay.m_DisplayPadNumbers = d.pad_numbers;
  s.m_Display.m_TrackClearance = d.track_clearance_mode;
  s.m_Display.m_PadClearance = d.pad_clearance;
  s.m_Display.m_UseViaColorForNormalTHPadstacks = d.pad_use_via_color_for_normal_th_padstacks;
  s.m_Display.m_ForceShowFieldsWhenFPSelected = d.force_show_fields_when_fp_selected;
  s.m_Display.m_Live3DRefresh = d.live_3d_refresh;
  s.m_Display.m_DisplayOrigin = d.origin_mode;
  s.m_Display.m_DisplayInvertXAxis = d.origin_invert_x_axis;
  s.m_Display.m_DisplayInvertYAxis = d.origin_invert_y_axis;
  s.m_Display.m_ShowModuleRatsnest = d.ratsnest_footprint;
  s.m_Display.m_DisplayRatsnestLinesCurved = d.ratsnest_curved;
  s.m_Display.m_RatsnestThickness = d.ratsnest_thickness;
  s.m_ShowPageLimits = d.show_page_borders;
  s.m_ColorTheme = json.appearance.color_theme;

  s.m_CrossProbing = { ...json.cross_probing };

  s.m_DRCDialog.report_all_track_errors = json.DRC.report_all_track_errors;
  s.m_DRCDialog.crossprobe = json.DRC.crossprobe;
  s.m_DRCDialog.scroll_on_crossprobe = json.DRC.scroll_on_crossprobe;

  s.m_AngleSnapMode = e.pcb_angle_snap_mode;
  s.m_RotationAngle = new EDA_ANGLE(e.rotation_angle, EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
  s.m_ArcEditMode = e.arc_edit_mode;
  s.m_TrackDragAction = e.track_drag_action;
  s.m_FlipDirection = e.flip_left_right ? FLIP_DIRECTION.LEFT_RIGHT : FLIP_DIRECTION.TOP_BOTTOM;
  s.m_AllowFreePads = e.allow_free_pads;
  s.m_AutoRefillZones = e.auto_fill_zones;
  s.m_MagneticItems.pads = e.magnetic_pads;
  s.m_MagneticItems.tracks = e.magnetic_tracks;
  s.m_MagneticItems.graphics = e.magnetic_graphics;
  s.m_ESCClearsNetHighlight = e.esc_clears_net_highlight;
  s.m_ShowCourtyardCollisions = e.show_courtyard_collisions;
  s.m_CtrlClickHighlight = e.ctrl_click_highlight;
  s.m_PolarCoords = e.polar_coords;

  return s;
}

export interface PCB_EDIT_FRAME_HOOKS {
  /** `PCBNEW_SETTINGS`, read on every access so a changed preference is seen. */
  settings(): PCBNEW_SETTINGS;
  /** `PCB_BASE_FRAME::OnModify`'s effect on the window: the dirty flag. */
  onModify(): void;
  /** `new DIALOG_DRC( m_editFrame, aParent )`: the window's DRC dialog. */
  createDrcDialog(aTool: DRC_TOOL, aParent: unknown): DIALOG_DRC_LIKE;
  /** `Kiface().IsSingle()`: no schematic to test parity against. */
  isSingle(): boolean;
  /** DIALOG_PASTE_SPECIAL: the chosen mode and clear-nets, or null for Cancel. */
  showPasteSpecialDialog?(
    aShowClearNets: boolean,
  ): Promise<{ mode: PASTE_MODE; clearNets: boolean } | null>;
  /** DIALOG_PAGES_SETTINGS: true when OK wrote the page and title block into the frame. */
  showPageSettingsDialog?(): Promise<boolean>;
  /** DIALOG_IMPORT_GRAPHICS: what OK read off it, or null. */
  showImportGraphicsDialog?(aFilenameOverride?: string): Promise<IMPORT_GRAPHICS_RESULT | null>;
  /** DIALOG_BARCODE_PROPERTIES on a live barcode, new or not; true when OK closed it. */
  showBarcodePropertiesDialog?(aDialog: DIALOG_BARCODE_PROPERTIES): Promise<boolean>;
  /** DIALOG_TEXTBOX_PROPERTIES on a live text box, new or not; true when OK closed it. */
  showTextBoxPropertiesDialog?(aDialog: DIALOG_TEXTBOX_PROPERTIES): Promise<boolean>;
  /** The "Choose Image" file dialog: the bytes chosen, or null for Cancel. */
  showImageFileDialog?(): Promise<Uint8Array | null>;
  /** DIALOG_TABLE_PROPERTIES on a live table, new or not; true when OK closed it. */
  showTablePropertiesDialog?(aDialog: DIALOG_TABLE_PROPERTIES): Promise<boolean>;
  /** A zone's properties dialog on a ZONE_SETTINGS alone; true when OK closed it. */
  showZoneSettingsDialog?(
    aDialog: DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR | DIALOG_RULE_AREA_PROPERTIES,
  ): Promise<boolean>;
  /** DIALOG_TEXT_PROPERTIES shown quasi-modally; true when OK closed it. */
  showTextPropertiesDialog?(aDialog: DIALOG_TEXT_PROPERTIES): Promise<boolean>;
  /** The tool stack changed (`PushTool` / `PopTool`): the window's toolbar follows it. */
  toolStackChanged?(): void;
  /** `PCB_EDIT_FRAME::FetchNetlistFromSchematic`: fills aNetlist, false on failure. */
  fetchNetlistFromSchematic(aNetlist: NETLIST, aAnnotateMessage: string): boolean;
  /**
   * The netlist text behind the last `fetchNetlistFromSchematic`, which is
   * what the DRC worker is given in place of the NETLIST object.
   */
  schematicNetlistText(): string | null;
  /** The project's `.kicad_pro` text, PROJECT not being ported. */
  projectText(): string | null;
  /** `PCB_EDIT_FRAME::OnEditItemRequest`: the item's properties dialog. */
  onEditItemRequest(aItem: BOARD_ITEM | null): void;
  /**
   * `PCB_EDIT_FRAME::Edit_Zone_Params` (`edit_zone_helpers.cpp`), the part
   * `OnEditItemRequest`'s `PCB_ZONE_T` case delegates to: open the zone's
   * properties dialog (rule area / copper / non-copper is the component's
   * own render choice, from the zone's own `GetIsRuleArea()`/layer).
   */
  editZoneParams(zoneIndex: number): void;
  /** `DIALOG_EXCHANGE_FOOTPRINTS::ShowQuasiModal()`: the window shows the dialog; it closes itself. */
  showExchangeFootprintsDialog(aDialog: DIALOG_EXCHANGE_FOOTPRINTS): void;
  /**
   * `BOARD_EDITOR_CONTROL::PlacingFootprint()`: a footprint is riding the
   * cursor. The editor owns the placement, so it answers. Optional so a frame
   * built for a test need not name it; absent is "not placing".
   */
  placingFootprint?(): boolean;
  /**
   * The board half of `FOOTPRINT_VIEWER_FRAME::AddFootprintToPCB`
   * (`footprint_viewer_frame.cpp:735-779`): `selectionClear`, then
   * `PostAction( PCB_ACTIONS::placeFootprint, newFootprint )` with a copy of
   * the library footprint, so it rides the cursor until a click drops it.
   */
  placeFootprintFromLibrary?(aFpid: string, aFootprint: PcbFootprint): void;
  /** `findDialogs()`: the open modeless dialogs' rectangles, in canvas client pixels. */
  findDialogRects(): BOX2D[];
  /**
   * `VIEW::SetCenter( aPos, aObscuringScreenRects )` as the editor applies it: the
   * editor still owns the view transform, so it performs the centre.
   */
  setViewCenter(aPos: Vec2, aObscuringScreenRects: readonly BOX2D[]): void;
  /** `wxMessageBox( _( "Incomplete undo/redo operation: some items not found" ) )`. */
  onUndoRedoIncomplete(): void;
  /**
   * TRANSITIONAL (#636 stage 3): after a tool event, the window re-reads
   * PCB_RENDER_SETTINGS' net highlight into the state its own panels draw
   * from, as it re-reads the selection on UpdateProperties.
   */
  highlightChanged?(): void;
  /** `DIALOG_BOARD_STATISTICS dialog( m_frame ); dialog.ShowModal()`. */
  showBoardStatisticsDialog?(): void;
  /**
   * `PCB_ACTIONS::syncSelection` / `syncSelectionWithNets` on the items
   * `FindItemsFromSyncSelection` names: the editor owns the selection, so it
   * resolves the parts and applies them. `on_selection` has been checked.
   */
  syncSelection(aParts: readonly string[], aSelectConnections: boolean): void;
  /** `m_toolManager->RunAction( ACTIONS::updatePcbFromSchematic )`: the editor's dialog. */
  updatePcbFromSchematic(): void;
  /**
   * `ROUTER_TOOL::SelectCopperLayerPair` (`sel_layer.cpp:765-789`): open
   * `SELECT_COPPER_LAYERS_PAIR_DIALOG`. Not `PCB_EDIT_FRAME`'s own method
   * upstream — there is no `ROUTER_TOOL` class in this port (routing runs on
   * `PnsSession`), and `sel_layer.cpp` is the file that method's body lives
   * in regardless of which class declares it, so this is that same seam,
   * named for what it does rather than for a class this port doesn't have.
   */
  selectCopperLayerPair(): void;
  /**
   * `EDA_BASE_FRAME::ShowInfoBarError( aErrorMsg, aShowCloseButton )`: the
   * window's infobar, error icon, 8 s. Optional: a frame with no window
   * (tests, headless callers) shows nothing.
   */
  showInfoBarError?(aErrorMsg: string, aShowCloseButton: boolean): void;
  /**
   * `m_appearancePanel->OnLayerChanged()` and the layer box's `SetLayerSelection`
   * in `PCB_EDIT_FRAME::SetActiveLayer` (pcb_edit_frame.cpp:1823-1870): the
   * window's layer combo and Appearance row follow a layer a tool chose (the
   * router's via, its layer commands). Optional: a frame with no window has
   * neither.
   */
  activeLayerChanged?(aLayer: PCB_LAYER_ID): void;
  /**
   * `KISTATUSBAR::AddWarningMessages( aKey, aMessages )`: the status bar's
   * warning icon, which `reconcileImportedFootprintLibraries` fills. Optional:
   * a frame with no window shows nothing.
   */
  addStatusBarWarnings?(aKey: string, aMessages: string): void;
  /**
   * `Kiway().Player( FRAME_FOOTPRINT_CHOOSER )->ShowModal( &footprintName, this )`
   * (`PCB_BASE_FRAME::SelectFootprintFromLibrary`): the footprint chooser, over
   * the window. Answers the chosen `LIB_ID` text, or null when cancelled.
   * `aPreselect` is the `LIB_ID` the chooser opens on. Optional: a frame with no
   * window has no chooser, and nothing is chosen.
   */
  selectFootprintFromChooser?(aPreselect: string): Promise<string | null>;
  /**
   * `FOOTPRINT_LIBRARY_ADAPTER::LoadFootprintWithOptionalNickname( aFootprintId,
   * aKeepUUID )`, which `PCB_BASE_FRAME::loadFootprint` asks: the footprint out of
   * the hosted libraries, a fresh copy the frame owns. Async because a hosted
   * library is fetched, not read off a disk. Without it the board's
   * `FOOTPRINT_LIBRARY_ADAPTER` is asked.
   */
  loadFootprintFromLibrary?(aFootprintId: LIB_ID, aKeepUUID: boolean): Promise<FOOTPRINT | null>;
  /**
   * `WX_TEXT_ENTRY_DIALOG dlg( frame, aPrompt, aCaption, aValue ).ShowModal()`
   * with an optional `SetTextValidator`: the entry's text on wxID_OK, null on
   * wxID_CANCEL. Optional: a frame with no window answers cancel.
   */
  textEntry?(
    aPrompt: string,
    aCaption: string,
    aValue: string,
    aValidator?: wxTextValidator,
  ): Promise<string | null>;
  /**
   * `MWAVE_POLYGONAL_SHAPE_DLG( frame, wxDefaultPosition ).ShowModal()`: true on
   * wxID_OK. Optional: a frame with no window answers cancel.
   */
  mwavePolygonalShapeDialog?(): Promise<boolean>;
  /**
   * `m_toolMgr->RunAction<EDA_ITEM*>( ACTIONS::selectItem, aItem )`, the window's
   * half: the selection shows the item once the commit has put it on the board.
   */
  selectItem?(aItem: FOOTPRINT): void;
  /**
   * `DIALOG_ZONE_MANAGER( editFrame ).ShowQuasiModal()`: true for wxID_OK,
   * with `GetRepourOnClose()`. Optional: absent answers cancel.
   */
  showZoneManager?(): Promise<{ ok: boolean; repour: boolean }>;
  /**
   * TRANSITIONAL (#636): `m_auimgr.GetPane( aName ).IsShown()`. The docked
   * panes are still the window's, which knows which are shown.
   */
  paneShown?(aName: string): boolean;
  /** The window's KiDialog: KIDIALOG::ShowModal. */
  askKiDialog?(aRequest: KiDialogRequest): Promise<KiDialogResult>;
  /**
   * `EDA_BASE_FRAME::ShowInfoBarWarning( aWarningMsg, aShowCloseButton )`: the
   * window's infobar, warning icon, 6 s. Optional: a frame with no window shows
   * nothing.
   */
  showInfoBarWarning?(aWarningMsg: string, aShowCloseButton: boolean): void;
  /** `EDA_BASE_FRAME::ShowInfoBarMsg( aMsg )`: the infobar, information icon. */
  showInfoBarMsg?(aMsg: string): void;
  /** `WX_UNIT_ENTRY_DIALOG( frame, aTitle, aLabel, aValue ).ShowModal()`: the value, null on cancel. */
  showUnitEntryDialog?(aTitle: string, aLabel: string, aValue: number): Promise<number | null>;
  /** EDIT_TOOL's `GetDogboneParams` WX_MULTI_ENTRY_DIALOG. */
  showDogboneDialog?(aParams: DOGBONE_PARAMETERS): Promise<DOGBONE_PARAMETERS | null>;
  /** `DIALOG_MOVE_EXACT( frame, translation, rotation, anchor, bbox ).ShowModal()`. */
  showMoveExactDialog?(
    aValues: MOVE_EXACT_VALUES,
    aSelectionBox: BOX2I,
  ): Promise<MOVE_EXACT_VALUES | null>;
  /** `DIALOG_TRACK_VIA_PROPERTIES( frame, selection ).ShowQuasiModal()`. */
  showTrackViaPropertiesDialog?(aSelection: PCB_SELECTION): Promise<void>;
  /** `DIALOG_GET_FOOTPRINT_BY_NAME( frame, fplist ).ShowModal()`: the value, null on cancel. */
  showGetFootprintByNameDialog?(aList: string[]): Promise<string | null>;
  /** CONVERT_TOOL's `CONVERT_SETTINGS_DIALOG(...).ShowModal() == wxID_OK`. */
  showConvertSettingsDialog?(
    aSettings: CONVERT_SETTINGS,
    aShowCopyLineWidthOption: boolean,
    aShowCenterlineOption: boolean,
    aShowBoundingHullOption: boolean,
  ): Promise<boolean>;
  /** CONVERT_TOOL's `Invoke*ZonesEditor( frame, nullptr, &zoneInfo, &m_userSettings )`. */
  showZoneEditorForConversion?(
    aKind: 'ruleArea' | 'nonCopper' | 'copper',
    aZoneSettings: ZONE_SETTINGS,
    aConvertSettings: CONVERT_SETTINGS,
  ): Promise<boolean>;
  /** `PCB_BASE_FRAME::SelectOneLayer`: UNDEFINED_LAYER on cancel. */
  selectOneLayer?(aDefaultLayer: PCB_LAYER_ID, aNotAllowedLayersMask: LSET): Promise<PCB_LAYER_ID>;
  /** `DIALOG_OUTSET_ITEMS( frame, aParams ).ShowModal() != wxID_CANCEL`. */
  showOutsetItemsDialog?(aParams: OUTSET_PARAMETERS): Promise<boolean>;
  /** POSITION_RELATIVE_TOOL's modeless DIALOG_POSITION_RELATIVE, drawn while it lives. */
  attachPositionRelativeDialog?(aDialog: DIALOG_POSITION_RELATIVE): void;
  /** POSITION_RELATIVE_TOOL's `DIALOG_OFFSET_ITEM( ... ).ShowModal() == wxID_OK`. */
  showOffsetItemDialog?(aDialog: DIALOG_OFFSET_ITEM): Promise<boolean>;
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_EDIT_TEARDROPS, quasi-modal; it closes itself. */
  showGlobalEditTeardropsDialog?(aDialog: DIALOG_GLOBAL_EDIT_TEARDROPS): void;
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS, modal; it closes itself. */
  showGlobalEditTextAndGraphicsDialog?(aDialog: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS): void;
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS, quasi-modal; it closes itself. */
  showGlobalEditTracksAndViasDialog?(aDialog: DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS): void;
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_DELETION: true on OK. */
  showGlobalDeletionDialog?(aDialog: DIALOG_GLOBAL_DELETION): Promise<boolean>;
  /** GLOBAL_EDIT_TOOL's DIALOG_UNUSED_PAD_LAYERS, modal; it closes itself. */
  showUnusedPadLayersDialog?(aDialog: DIALOG_UNUSED_PAD_LAYERS): void;
  /** GLOBAL_EDIT_TOOL's DIALOG_CLEANUP_GRAPHICS, modal; it closes itself. */
  showCleanupGraphicsDialog?(aDialog: DIALOG_CLEANUP_GRAPHICS): void;
  /** GLOBAL_EDIT_TOOL's DIALOG_CLEANUP_TRACKS_AND_VIAS, modal; it closes itself. */
  showCleanupTracksAndViasDialog?(aDialog: DIALOG_CLEANUP_TRACKS_AND_VIAS): void;
  /** GLOBAL_EDIT_TOOL's DIALOG_SWAP_LAYERS: true on OK. */
  showSwapLayersDialog?(aDialog: DIALOG_SWAP_LAYERS): Promise<boolean>;
  /** PAD_TOOL's DIALOG_PUSH_PAD_PROPERTIES: 0 OK, 1 Apply, wxID_CANCEL dismissed. */
  showPushPadPropertiesDialog?(aDialog: DIALOG_PUSH_PAD_PROPERTIES): Promise<number>;
  /** PAD_TOOL's DIALOG_ENUM_PADS: true on OK. */
  showEnumPadsDialog?(aDialog: DIALOG_ENUM_PADS): Promise<boolean>;
  /** PAD_TOOL's DIALOG_FP_EDIT_PAD_TABLE, quasi-modal. */
  showPadTableDialog?(aDialog: DIALOG_FP_EDIT_PAD_TABLE): void;
  /** `WX_INFOBAR::Dismiss()`. */
  dismissInfoBar?(): void;
  /** `PromptConnectedPadDecision`'s wxRichMessageDialog. */
  showConnectedPadDialog?(
    aTitle: string,
    aMessage: string,
    aDetails: string,
  ): Promise<'ignore' | 'all' | null>;
  /** `PCB_BASE_EDIT_FRAME::OpenVertexEditor( aItem )`. */
  openVertexEditor?(aItem: BOARD_ITEM): void;
  /** `DIALOG_PNS_SETTINGS( frame(), aSettings ).ShowModal()`; resolves when it closes. */
  showPnsSettingsDialog?(aSettings: RoutingSettings): Promise<void>;
  /** `DIALOG_PNS_DIFF_PAIR_DIMENSIONS( frame(), sizes ).ShowModal()`: the values, or null on cancel. */
  showDiffPairDimensionsDialog?(
    aValue: DiffPairDimensionsValue,
  ): Promise<DiffPairDimensionsValue | null>;
  /** `DIALOG_TRACK_VIA_SIZE( frame(), bds ).ShowModal()`: the values, or null on cancel. */
  showTrackViaSizeDialog?(aValue: CustomTrackViaSize): Promise<CustomTrackViaSize | null>;
  /**
   * `DIALOG_FILTER_SELECTION( frame, aOptions ).ShowModal() == wxID_OK`, the
   * dialog editing `aOptions` in place. Optional: absent answers cancel.
   */
  showFilterSelectionDialog?(aOptions: SelectionFilter): Promise<boolean>;
  /**
   * `EDA_DRAW_FRAME::UpdateProperties()`'s window half: the selection tool's
   * selection changed, and the window's panels re-read it.
   */
  updateProperties?(): void;
  /**
   * TRANSITIONAL (#636 stage 3): the window's own implementation of an action
   * whose tool is not ported yet (`WINDOW_ACTION_BRIDGE`).
   */
  windowAction?: WINDOW_ACTION_HANDLER;
  /**
   * TRANSITIONAL (#636 stage 3): true when a canvas event belongs to one of the
   * window's own not-yet-ported tools (a drawing tool, a point edit or a move
   * in flight), which then gets it instead of the tool dispatcher.
   */
  eventToWindow?(aEvent: wxEvent): boolean;
}

export interface PCB_EDIT_FRAME
  extends INITPCB_MIXIN,
    EDIT_MIXIN,
    FILES_MIXIN,
    EDIT_ZONE_HELPERS_MIXIN,
    PCBNEW_CONFIG_MIXIN,
    LOAD_SELECT_FOOTPRINT_MIXIN,
    PCB_DESIGN_BLOCK_UTILS_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (INITPCB_MIXIN mixin, see libs/core/mixins.ts)
/** `FormatProbeItem( BOARD_ITEM* aItem )` (pcbnew/cross-probing.cpp:258-307). */
export function FormatProbeItem(aItem: BOARD_ITEM | null): string {
  if (!aItem) return '$CLEAR: "HIGHLIGHTED"'; // message to clear highlight state

  switch (aItem.Type()) {
    case KICAD_T.PCB_FOOTPRINT_T: {
      const footprint = aItem as unknown as FOOTPRINT;
      return `$PART: "${footprint.GetReference()}"`;
    }

    case KICAD_T.PCB_PAD_T: {
      const pad = aItem as unknown as PAD;
      const footprint = pad.GetParentFootprint()!;

      return `$PART: "${footprint.GetReference()}" $PAD: "${pad.GetNumber()}"`;
    }

    case KICAD_T.PCB_FIELD_T: {
      const field = aItem as unknown as PCB_FIELD;
      const footprint = field.GetParentFootprint()!;
      let text_key: string;

      /* This can't be a switch since the break need to pull out
       * from the outer switch! */
      if (field.IsReference()) text_key = '$REF:';
      else if (field.IsValue()) text_key = '$VAL:';
      else break;

      return `$PART: "${footprint.GetReference()}" ${text_key} "${field.GetText()}"`;
    }

    default:
      break;
  }

  return '';
}

/**
 * `processTextItem` (pcb_edit_frame.cpp:2462-2516): copy text settings from
 * aSrc to aDest, or - for each reset flag - keep aDest's and note whether it
 * differs.
 */
function processTextItem(
  aSrc: PCB_TEXT,
  aDest: PCB_TEXT,
  aResetText: boolean,
  aResetTextLayers: boolean,
  aResetTextEffects: boolean,
  aResetTextPositions: boolean,
  aUpdated: { value: boolean },
): void {
  const ne = (a: VECTOR2I, b: VECTOR2I): boolean => a.x !== b.x || a.y !== b.y;

  if (aResetText) aUpdated.value ||= aSrc.GetText() !== aDest.GetText();
  else aDest.SetText(aSrc.GetText());

  if (aResetTextLayers) {
    aUpdated.value ||= aSrc.GetLayer() !== aDest.GetLayer();
    aUpdated.value ||= aSrc.IsVisible() !== aDest.IsVisible();
  } else {
    aDest.SetLayer(aSrc.GetLayer());
    aDest.SetVisible(aSrc.IsVisible());
  }

  const origPos = aDest.GetFPRelativePosition();

  if (aResetTextEffects) {
    aUpdated.value ||= aSrc.GetHorizJustify() !== aDest.GetHorizJustify();
    aUpdated.value ||= aSrc.GetVertJustify() !== aDest.GetVertJustify();
    aUpdated.value ||= ne(aSrc.GetTextSize(), aDest.GetTextSize());
    aUpdated.value ||= aSrc.GetTextThickness() !== aDest.GetTextThickness();
    aUpdated.value ||= !aSrc.GetTextAngle().equals(aDest.GetTextAngle());
    aUpdated.value ||= aSrc.IsKnockout() !== aDest.IsKnockout();
  } else {
    aDest.SetAttributes(aSrc as unknown as EDA_TEXT); // PCB_TEXT is an EDA_TEXT by mixin
    aDest.SetIsKnockout(aSrc.IsKnockout());
  }

  if (aResetTextPositions) {
    aUpdated.value ||= ne(aSrc.GetFPRelativePosition(), origPos);
    aDest.SetFPRelativePosition(origPos);
  } else {
    aDest.SetFPRelativePosition(aSrc.GetFPRelativePosition());
  }

  aDest.SetLocked(aSrc.IsLocked());
  aDest.SetUuidDirect(aSrc.m_Uuid);
}

/**
 * `matchItemsBySimilarity<T>` (pcb_edit_frame.cpp:2521-2588): pair old and new
 * items greedily by `Similarity`, best first; a pad pair with the same number
 * scores 2 more. KiCad breaks a tie on the two pointers, which is allocation
 * order; the list order stands in for it here.
 */
function matchItemsBySimilarity<T extends BOARD_ITEM>(
  aExisting: readonly T[],
  aNew: readonly T[],
  aIsPad = false,
): Array<[T, T]> {
  const candidates: Array<{ e: number; u: number; score: number }> = [];

  aExisting.forEach((existing, e) => {
    aNew.forEach((updated, u) => {
      if (existing.Type() !== updated.Type()) return;

      let similarity = existing.Similarity(updated);

      if (aIsPad) {
        if ((existing as unknown as PAD).GetNumber() === (updated as unknown as PAD).GetNumber())
          similarity += 2.0;
      }

      if (similarity <= 0.0) return;

      candidates.push({ e, u, score: similarity });
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.e - b.e || a.u - b.u);

  const matches: Array<[T, T]> = [];
  const matchedExisting = new Set<number>();
  const matchedNew = new Set<number>();

  for (const c of candidates) {
    if (matchedExisting.has(c.e)) continue;

    if (matchedNew.has(c.u)) continue;

    matchedExisting.add(c.e);
    matchedNew.add(c.u);
    matches.push([aExisting[c.e]!, aNew[c.u]!]);
  }

  return matches;
}

export class PCB_EDIT_FRAME extends PCB_BASE_EDIT_FRAME {
  /** Recursion guard when synchronizing selection from schematic. */
  m_ProbingSchToPcb = false;
  protected readonly hooks: PCB_EDIT_FRAME_HOOKS;

  /**
   * `m_importProperties` (pcb_edit_frame.h): the `std::map<std::string, UTF8>`
   * an import was started with, set for the length of `importFile`
   * (`IMPORT_PROJ_PROPS` reads the footprint-library ones out of it).
   */
  m_importProperties: ReadonlyMap<string, string> | null = null;
  /** The project's .kicad_dru as last given to OnBoardLoaded: `GetDesignRulesPath()` and its text. */
  private m_designRulesText: string | null = null;
  private m_inspectDrcErrorDlg: DIALOG_BOOK_REPORTER | null = null;

  /** `m_ZoneFillsDirty`: the board has been modified since the last zone fill. */
  m_ZoneFillsDirty = true;
  private m_bookReporterListener: (() => void) | null = null;
  private m_designRulesPath = '';
  /**
   * `PCB_BASE_EDIT_FRAME::m_layerPairSettings` (`pcb_base_edit_frame.h:283`),
   * constructed only here (`pcb_edit_frame.cpp:470`) — `FOOTPRINT_EDIT_FRAME`
   * has no via-layer pair, so upstream leaves its copy null. This port has no
   * `FOOTPRINT_EDIT_FRAME` sharing this class, so the field lives directly on
   * `PCB_EDIT_FRAME` rather than on the shared base, and is never null.
   */
  private readonly m_layerPairSettings = new LAYER_PAIR_SETTINGS();

  constructor(hooks: PCB_EDIT_FRAME_HOOKS) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.hooks = hooks;
    this.setupTools();

    // `pcb_edit_frame.cpp:479-489`. Not ported: `PrepareLayerIndicator()`'s
    // toolbar-icon refresh on the `PCB_CURRENT_LAYER_PAIR_CHANGED` binding —
    // the aux toolbar's layer-pair icon isn't rendered from this frame yet.
    this.m_layerPairSettings.Connect(PCB_LAYER_PAIR_PRESETS_CHANGED, () => {
      this.Prj().GetProjectFile().m_LayerPairInfos = [...this.m_layerPairSettings.GetLayerPairs()];
    });
    this.m_layerPairSettings.Connect(PCB_CURRENT_LAYER_PAIR_CHANGED, () => {
      const pair = this.m_layerPairSettings.GetCurrentLayerPair();
      const screen = this.GetScreen()!;
      screen.m_Route_Layer_TOP = pair.GetLayerA();
      screen.m_Route_Layer_BOTTOM = pair.GetLayerB();
    });
  }

  /// `m_designBlocksPane`: the Design Blocks dock, set by the window that docks it.
  m_designBlocksPane: PCB_DESIGN_BLOCK_PANE | null = null;

  /** `GetDesignBlockPane()`. */
  GetDesignBlockPane(): PCB_DESIGN_BLOCK_PANE | null {
    return this.m_designBlocksPane;
  }

  /** `m_toolManager->GetTool<PCB_SELECTION_TOOL>()`. */
  GetSelectionTool(): PCB_SELECTION_TOOL {
    return this.m_toolManager!.GetTool(PCB_SELECTION_TOOL)!;
  }

  /** `GetCurrentSelection()` (pcb_edit_frame.cpp): the selection tool's selection. */
  override GetCurrentSelection(): SELECTION {
    return this.GetSelectionTool().GetSelection();
  }

  /**
   * What `SaveSelectionAsDesignBlock` does with the group it made:
   * `m_toolManager->RunAction( ACTIONS::selectionClear )` then
   * `m_toolManager->RunAction<EDA_ITEM*>( ACTIONS::selectItem, group )`.
   */
  OnDesignBlockGrouped(aGroup: PCB_GROUP): void {
    this.m_toolManager!.RunAction(ACTIONS.selectionClear);
    this.m_toolManager!.RunAction<EDA_ITEM | null>(ACTIONS.selectItem, aGroup);
  }

  /** `GetToolManager()->GetTool<PCB_SELECTION_TOOL>()->GetFilter()`. */
  GetSelectionFilter(): PCB_SELECTION_FILTER_OPTIONS {
    return this.GetSelectionTool().GetFilter();
  }

  /** `EDA_BASE_FRAME::ShowInfoBarError( aErrorMsg, aShowCloseButton )` (eda_base_frame.cpp). */
  ShowInfoBarError(aErrorMsg: string, aShowCloseButton = false): void {
    this.hooks.showInfoBarError?.(aErrorMsg, aShowCloseButton);
  }

  /** `EDA_BASE_FRAME::ShowInfoBarWarning( aWarningMsg, aShowCloseButton )` (eda_base_frame.cpp:1451). */
  override ShowInfoBarWarning(aWarningMsg: string, aShowCloseButton = false): void {
    this.hooks.showInfoBarWarning?.(aWarningMsg, aShowCloseButton);
  }

  /** `DIALOG_FILTER_SELECTION( this, aOptions ).ShowModal() == wxID_OK`. */
  ShowFilterSelectionDialog(aOptions: SelectionFilter): Promise<boolean> {
    return this.hooks.showFilterSelectionDialog?.(aOptions) ?? Promise.resolve(false);
  }

  // ---- EDIT_TOOL's window half (EDIT_TOOL_FRAME) -------------------------

  /** `EDA_BASE_FRAME::ShowInfoBarMsg( aMsg )` (eda_base_frame.cpp). */
  ShowInfoBarMsg(aMsg: string): void {
    this.hooks.showInfoBarMsg?.(aMsg);
  }

  ShowUnitEntryDialog(aTitle: string, aLabel: string, aValue: number): Promise<number | null> {
    return this.hooks.showUnitEntryDialog?.(aTitle, aLabel, aValue) ?? Promise.resolve(null);
  }

  ShowDogboneDialog(aParams: DOGBONE_PARAMETERS): Promise<DOGBONE_PARAMETERS | null> {
    return this.hooks.showDogboneDialog?.(aParams) ?? Promise.resolve(null);
  }

  ShowMoveExactDialog(
    aValues: MOVE_EXACT_VALUES,
    aSelectionBox: BOX2I,
  ): Promise<MOVE_EXACT_VALUES | null> {
    return this.hooks.showMoveExactDialog?.(aValues, aSelectionBox) ?? Promise.resolve(null);
  }

  ShowTrackViaPropertiesDialog(aSelection: PCB_SELECTION): Promise<void> {
    return this.hooks.showTrackViaPropertiesDialog?.(aSelection) ?? Promise.resolve();
  }

  /**
   * `DIALOG_TABLECELL_PROPERTIES`. TRANSITIONAL (#636 stage 3): not wired to a
   * window dialog yet; a table cell's properties open the table's own.
   */
  ShowTableCellPropertiesDialog(_aCells: PCB_TABLECELL[]): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * `PCB_EDIT_FRAME::OnNetlistChanged( aUpdater, aRunDragCommand )`
   * (netlist_reader/netlist.cpp:90-164): after a real netlist update, re-sync
   * the nets, classes and rules, repaint what shows net names, then spread the
   * new footprints at the origin and select them for the drag that follows.
   */
  OnNetlistChanged(aUpdater: BOARD_NETLIST_UPDATER, aRunDragCommand: { value: boolean }): void {
    const board = this.GetBoard()!;

    this.SetMsgPanel(board);

    // Re-sync nets and  netclasses
    board.SynchronizeNetsAndNetClasses(false);

    // Recompute component classes
    board.GetComponentClassManager().InvalidateComponentClasses();
    board.GetComponentClassManager().RebuildRequiredCaches();

    // Resync DRC rules to account for new aggregate netclass / component class rules
    try {
      board
        .GetDesignSettings()
        .m_DRCEngine?.InitEngine(this.m_designRulesText, this.m_designRulesPath);
    } catch (e) {
      if (!(e instanceof PARSE_ERROR)) throw e;
    }

    // Update rendered track/via/pad net labels, and any text items that might reference a
    // netName or netClass
    const netNamesCfg = this.GetPcbNewSettings().m_Display.m_NetNames;

    this.GetCanvas()
      ?.GetView()
      ?.UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
        if (aItem instanceof PCB_TRACK) {
          if (netNamesCfg === 2 || netNamesCfg === 3) return VIEW_UPDATE_FLAGS.REPAINT;
        } else if (aItem instanceof PAD) {
          if (netNamesCfg === 1 || netNamesCfg === 3) return VIEW_UPDATE_FLAGS.REPAINT;
        }

        const text = aItem as unknown as Partial<EDA_TEXT>;

        if (text.HasTextVars?.()) {
          text.ClearRenderCache!();
          text.ClearBoundingBoxCache!();
          return VIEW_UPDATE_FLAGS.GEOMETRY | VIEW_UPDATE_FLAGS.REPAINT;
        }

        return 0;
      });

    // Spread new footprints.
    const newFootprints = aUpdater.GetAddedFootprints();

    this.GetToolManager()!.RunAction(ACTIONS.selectionClear);

    SpreadFootprints(newFootprints, { x: 0, y: 0 }, true);

    // Start drag command for new footprints
    if (newFootprints.length > 0) {
      const items: EDA_ITEM[] = [...newFootprints];
      this.GetToolManager()!.RunAction(ACTIONS.selectItems, items);

      aRunDragCommand.value = true;
    }

    this.Compile_Ratsnest(true);

    this.GetCanvas()?.Refresh();
  }

  override ShowPasteSpecialDialog(
    aShowClearNets: boolean,
  ): Promise<{ mode: PASTE_MODE; clearNets: boolean } | null> {
    return this.hooks.showPasteSpecialDialog?.(aShowClearNets) ?? Promise.resolve(null);
  }

  override ShowPageSettingsDialog(): Promise<boolean> {
    return this.hooks.showPageSettingsDialog?.() ?? Promise.resolve(false);
  }

  override ShowImportGraphicsDialog(
    aFilenameOverride?: string,
  ): Promise<IMPORT_GRAPHICS_RESULT | null> {
    return this.hooks.showImportGraphicsDialog?.(aFilenameOverride) ?? Promise.resolve(null);
  }

  override ShowBarcodePropertiesDialog(aBarcode: PCB_BARCODE): Promise<boolean> {
    return (
      this.hooks.showBarcodePropertiesDialog?.(new DIALOG_BARCODE_PROPERTIES(this, aBarcode)) ??
      Promise.resolve(false)
    );
  }

  override ShowTextBoxPropertiesDialog(aTextBox: PCB_TEXTBOX): Promise<boolean> {
    return (
      this.hooks.showTextBoxPropertiesDialog?.(new DIALOG_TEXTBOX_PROPERTIES(this, aTextBox)) ??
      Promise.resolve(false)
    );
  }

  override ShowImageFileDialog(): Promise<Uint8Array | null> {
    return this.hooks.showImageFileDialog?.() ?? Promise.resolve(null);
  }

  /** `DIALOG_TABLE_PROPERTIES( frame, table ).ShowQuasiModal() == wxID_OK`, on the live table. */
  override ShowTablePropertiesDialog(aTable: PCB_TABLE): Promise<boolean> {
    return (
      this.hooks.showTablePropertiesDialog?.(new DIALOG_TABLE_PROPERTIES(this, aTable)) ??
      Promise.resolve(false)
    );
  }

  // ---- CONVERT_TOOL's window half (CONVERT_TOOL_FRAME) ---------------------

  ShowConvertSettingsDialog(
    aSettings: CONVERT_SETTINGS,
    aShowCopyLineWidthOption: boolean,
    aShowCenterlineOption: boolean,
    aShowBoundingHullOption: boolean,
  ): Promise<boolean> {
    return (
      this.hooks.showConvertSettingsDialog?.(
        aSettings,
        aShowCopyLineWidthOption,
        aShowCenterlineOption,
        aShowBoundingHullOption,
      ) ?? Promise.resolve(false)
    );
  }

  ShowZoneEditorForConversion(
    aKind: 'ruleArea' | 'nonCopper' | 'copper',
    aZoneSettings: ZONE_SETTINGS,
    aConvertSettings: CONVERT_SETTINGS,
  ): Promise<boolean> {
    return (
      this.hooks.showZoneEditorForConversion?.(aKind, aZoneSettings, aConvertSettings) ??
      Promise.resolve(false)
    );
  }

  SelectOneLayer(aDefaultLayer: PCB_LAYER_ID, aNotAllowedLayersMask: LSET): Promise<PCB_LAYER_ID> {
    return (
      this.hooks.selectOneLayer?.(aDefaultLayer, aNotAllowedLayersMask) ??
      Promise.resolve(UNDEFINED_LAYER)
    );
  }

  ShowOutsetItemsDialog(aParams: OUTSET_PARAMETERS): Promise<boolean> {
    return this.hooks.showOutsetItemsDialog?.(aParams) ?? Promise.resolve(false);
  }

  // ---- POSITION_RELATIVE_TOOL's window half (POSITION_RELATIVE_TOOL_FRAME) --

  AttachPositionRelativeDialog(aDialog: DIALOG_POSITION_RELATIVE): void {
    this.hooks.attachPositionRelativeDialog?.(aDialog);
  }

  ShowOffsetItemDialog(aDialog: DIALOG_OFFSET_ITEM): Promise<boolean> {
    return this.hooks.showOffsetItemDialog?.(aDialog) ?? Promise.resolve(false);
  }

  // ---- GLOBAL_EDIT_TOOL's window half (GLOBAL_EDIT_TOOL_FRAME) --------------

  ShowGlobalEditTeardropsDialog(aDialog: DIALOG_GLOBAL_EDIT_TEARDROPS): void {
    this.hooks.showGlobalEditTeardropsDialog?.(aDialog);
  }

  ShowGlobalEditTextAndGraphicsDialog(aDialog: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS): void {
    this.hooks.showGlobalEditTextAndGraphicsDialog?.(aDialog);
  }

  ShowGlobalEditTracksAndViasDialog(aDialog: DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS): void {
    this.hooks.showGlobalEditTracksAndViasDialog?.(aDialog);
  }

  ShowGlobalDeletionDialog(aDialog: DIALOG_GLOBAL_DELETION): Promise<boolean> {
    return this.hooks.showGlobalDeletionDialog?.(aDialog) ?? Promise.resolve(false);
  }

  ShowUnusedPadLayersDialog(aDialog: DIALOG_UNUSED_PAD_LAYERS): void {
    this.hooks.showUnusedPadLayersDialog?.(aDialog);
  }

  ShowCleanupGraphicsDialog(aDialog: DIALOG_CLEANUP_GRAPHICS): void {
    this.hooks.showCleanupGraphicsDialog?.(aDialog);
  }

  ShowCleanupTracksAndViasDialog(aDialog: DIALOG_CLEANUP_TRACKS_AND_VIAS): void {
    this.hooks.showCleanupTracksAndViasDialog?.(aDialog);
  }

  ShowSwapLayersDialog(aDialog: DIALOG_SWAP_LAYERS): Promise<boolean> {
    return this.hooks.showSwapLayersDialog?.(aDialog) ?? Promise.resolve(false);
  }

  ShowZoneManagerDialog(): Promise<{ ok: boolean; repour: boolean }> {
    return this.hooks.showZoneManager?.() ?? Promise.resolve({ ok: false, repour: false });
  }

  // ---- ZONE_FILLER_TOOL's window half (ZONE_FILLER_TOOL_FRAME) --------------

  /** `infobar->ShowMessageFor( ..., 10000, wxICON_WARNING )` with a "Show DRC rules" link. */
  ShowZoneFillRulesWarning(): void {
    this.ShowInfoBarWarning('Zone fills may be inaccurate.  DRC rules contain errors.');
  }

  /**
   * ZONE_FILLER_TOOL::ZoneFillDirty's slow-refill note (zone_filler_tool.cpp:289-303).
   * The "Open Preferences" link is not carried: the infobar takes text only.
   */
  ShowZoneAutoRefillSlowMessage(): void {
    this.ShowInfoBarMsg(
      'Automatic refill of zones can be turned off in Preferences if it becomes too slow.',
    );
  }

  /** `KIDIALOG( this, ... ).ShowModal()`, through the window's KiDialog host. */
  AskKiDialog(aRequest: KiDialogRequest): Promise<KiDialogResult> {
    return this.hooks.askKiDialog?.(aRequest) ?? Promise.resolve('cancel');
  }

  // ---- PAD_TOOL's window half (PAD_TOOL_FRAME) ------------------------------

  ShowPushPadPropertiesDialog(aDialog: DIALOG_PUSH_PAD_PROPERTIES): Promise<number> {
    return this.hooks.showPushPadPropertiesDialog?.(aDialog) ?? Promise.resolve(wxID_CANCEL);
  }

  ShowEnumPadsDialog(aDialog: DIALOG_ENUM_PADS): Promise<boolean> {
    return this.hooks.showEnumPadsDialog?.(aDialog) ?? Promise.resolve(false);
  }

  ShowPadTableDialog(aDialog: DIALOG_FP_EDIT_PAD_TABLE): void {
    this.hooks.showPadTableDialog?.(aDialog);
  }

  /** `GetInfoBar()->Dismiss()`. */
  DismissInfoBar(): void {
    this.hooks.dismissInfoBar?.();
  }

  ShowGetFootprintByNameDialog(aList: string[]): Promise<string | null> {
    return this.hooks.showGetFootprintByNameDialog?.(aList) ?? Promise.resolve(null);
  }

  ShowConnectedPadDialog(
    aTitle: string,
    aMessage: string,
    aDetails: string,
  ): Promise<'ignore' | 'all' | null> {
    return this.hooks.showConnectedPadDialog?.(aTitle, aMessage, aDetails) ?? Promise.resolve(null);
  }

  /** `PCB_BASE_EDIT_FRAME::OpenVertexEditor( aItem )`. */
  /** `DIALOG_PNS_SETTINGS::ShowModal`, through the window. */
  ShowPnsSettingsDialog(aSettings: RoutingSettings): Promise<void> {
    return this.hooks.showPnsSettingsDialog?.(aSettings) ?? Promise.resolve();
  }

  /** `DIALOG_PNS_DIFF_PAIR_DIMENSIONS::ShowModal`, through the window. */
  ShowDiffPairDimensionsDialog(
    aValue: DiffPairDimensionsValue,
  ): Promise<DiffPairDimensionsValue | null> {
    return this.hooks.showDiffPairDimensionsDialog?.(aValue) ?? Promise.resolve(null);
  }

  /** `DIALOG_TRACK_VIA_SIZE::ShowModal`, through the window. */
  ShowTrackViaSizeDialog(aValue: CustomTrackViaSize): Promise<CustomTrackViaSize | null> {
    return this.hooks.showTrackViaSizeDialog?.(aValue) ?? Promise.resolve(null);
  }

  OpenVertexEditor(aItem: BOARD_ITEM): void {
    this.hooks.openVertexEditor?.(aItem);
  }

  /**
   * The frame's idle pass after a canvas event (PCB_BASE_EDIT_FRAME::OnIdle),
   * and TRANSITIONAL (#636 stage 3) the window re-reading the net highlight a
   * tool may have changed.
   */
  override OnIdle(): void {
    super.OnIdle();
    this.hooks.highlightChanged?.();
  }

  /** `DIALOG_BOARD_STATISTICS dialog( this ); dialog.ShowModal()`. */
  ShowBoardStatisticsDialog(): void {
    this.hooks.showBoardStatisticsDialog?.();
  }

  /** `PCB_EDIT_FRAME::SendCrossProbeItem` (pcbnew/cross-probing.cpp:426). */
  SendCrossProbeItem(aSyncItem: BOARD_ITEM | null): void {
    const packet = FormatProbeItem(aSyncItem);

    if (packet !== '') {
      // Typically ExpressMail is going to be s-expression packets, but since
      // we have existing interpreter of the cross probe packet on the other
      // side in place, we use that here.
      this.Kiway()?.ExpressMail(
        FRAME_T.FRAME_SCH,
        MAIL_T.MAIL_CROSS_PROBE,
        { value: packet },
        this,
      );
    }
  }

  /** `EDA_DRAW_FRAME::UpdateProperties()`, and the window re-reading the selection. */
  override UpdateProperties(): void {
    super.UpdateProperties();
    this.hooks.updateProperties?.();
  }

  /** `SearchPaneName()` (pcb_edit_frame.h:148). */
  static SearchPaneName(): string {
    return 'Search';
  }

  /** `LayerManagerShown()` (pcb_edit_frame.cpp:3216-3219). */
  LayerManagerShown(): boolean {
    return this.hooks.paneShown?.('LayersManager') ?? false;
  }

  /** `PropertiesShown()` (pcb_edit_frame.cpp:3222-3225). */
  PropertiesShown(): boolean {
    return this.hooks.paneShown?.(EDA_DRAW_FRAME.PropertiesPaneName()) ?? false;
  }

  /** `NetInspectorShown()` (pcb_edit_frame.cpp:3228-3231). */
  NetInspectorShown(): boolean {
    return this.hooks.paneShown?.(EDA_DRAW_FRAME.NetInspectorPanelName()) ?? false;
  }

  /** `setupUIConditions()` (pcb_edit_frame.cpp:995-1367). */
  protected override setupUIConditions(): void {
    super.setupUIConditions();

    const mgr = this.m_toolManager!.GetActionManager();
    const cond = new PCB_EDITOR_CONDITIONS(this);

    const undoCond = (_aSel: SELECTION): boolean => {
      const drawingTool = this.m_toolManager!.GetTool(DRAWING_TOOL);

      if (drawingTool && drawingTool.GetDrawingMode() !== DRAWING_MODE.NONE) return true;

      const routerTool = this.m_toolManager!.GetTool(ROUTER_TOOL);

      if (routerTool && routerTool.RoutingInProgress()) return true;

      return this.GetUndoCommandCount() > 0;
    };

    const groupWithDesignBlockLink = (aSel: SELECTION): boolean => {
      if (aSel.Size() !== 1) return false;

      if (aSel.Front()!.Type() !== KICAD_T.PCB_GROUP_T) return false;

      const group = aSel.GetItem(0) as unknown as PCB_GROUP;

      return group.HasDesignBlockLink();
    };

    const ENABLE = (x: SELECTION_CONDITION): ACTION_CONDITIONS => new ACTION_CONDITIONS().Enable(x);
    const CHECK = (x: SELECTION_CONDITION): ACTION_CONDITIONS => new ACTION_CONDITIONS().Check(x);
    const { And, Not, ShowAlways, Idle } = {
      And: SELECTION_CONDITIONS.And,
      Not: SELECTION_CONDITIONS.Not,
      ShowAlways: SELECTION_CONDITIONS.ShowAlways,
      Idle: SELECTION_CONDITIONS.Idle,
    };

    mgr.SetConditions(ACTIONS.save, ENABLE(ShowAlways));
    mgr.SetConditions(ACTIONS.undo, ENABLE(undoCond));
    mgr.SetConditions(ACTIONS.redo, ENABLE(cond.RedoAvailable()));

    mgr.SetConditions(ACTIONS.toggleGrid, CHECK(cond.GridVisible()));
    mgr.SetConditions(ACTIONS.toggleGridOverrides, CHECK(cond.GridOverrides()));
    mgr.SetConditions(ACTIONS.togglePolarCoords, CHECK(cond.PolarCoordinates()));

    mgr.SetConditions(ACTIONS.cut, ENABLE(cond.HasItems()));
    mgr.SetConditions(ACTIONS.copy, ENABLE(cond.HasItems()));
    mgr.SetConditions(ACTIONS.paste, ENABLE(And(Idle, cond.NoActiveTool())));
    mgr.SetConditions(ACTIONS.pasteSpecial, ENABLE(And(Idle, cond.NoActiveTool())));
    mgr.SetConditions(ACTIONS.selectAll, ENABLE(cond.HasItems()));
    mgr.SetConditions(ACTIONS.unselectAll, ENABLE(cond.HasItems()));
    mgr.SetConditions(ACTIONS.doDelete, ENABLE(cond.HasItems()));
    mgr.SetConditions(ACTIONS.duplicate, ENABLE(cond.HasItems()));

    const groupTypes = [KICAD_T.PCB_GROUP_T, KICAD_T.PCB_GENERATOR_T];

    mgr.SetConditions(ACTIONS.group, ENABLE(SELECTION_CONDITIONS.MoreThan(1)));
    mgr.SetConditions(ACTIONS.ungroup, ENABLE(SELECTION_CONDITIONS.HasTypes(groupTypes)));
    mgr.SetConditions(PCB_ACTIONS.lock, ENABLE(PCB_SELECTION_CONDITIONS.HasUnlockedItems));
    mgr.SetConditions(PCB_ACTIONS.unlock, ENABLE(PCB_SELECTION_CONDITIONS.HasLockedItems));

    mgr.SetConditions(PCB_ACTIONS.placeLinkedDesignBlock, ENABLE(groupWithDesignBlockLink));
    mgr.SetConditions(PCB_ACTIONS.saveToLinkedDesignBlock, ENABLE(groupWithDesignBlockLink));

    mgr.SetConditions(PCB_ACTIONS.padDisplayMode, CHECK(Not(cond.PadFillDisplay())));
    mgr.SetConditions(PCB_ACTIONS.viaDisplayMode, CHECK(Not(cond.ViaFillDisplay())));
    mgr.SetConditions(PCB_ACTIONS.trackDisplayMode, CHECK(Not(cond.TrackFillDisplay())));
    mgr.SetConditions(PCB_ACTIONS.graphicsOutlines, CHECK(Not(cond.GraphicsFillDisplay())));
    mgr.SetConditions(PCB_ACTIONS.textOutlines, CHECK(Not(cond.TextFillDisplay())));

    // `if( SCRIPTING::IsWxAvailable() )`: there is no Python console in the browser.

    const enableZoneControlCondition = (_aSel: SELECTION): boolean => {
      const board = this.GetBoard();

      return (
        !!board &&
        board.GetVisibleElements().Contains(GAL_LAYER_ID.LAYER_ZONES) &&
        this.GetDisplayOptions().m_ZoneOpacity > 0.0
      );
    };

    mgr.SetConditions(
      PCB_ACTIONS.zoneDisplayFilled,
      ENABLE(enableZoneControlCondition).Check(cond.ZoneDisplayMode(ZONE_DISPLAY_MODE.SHOW_FILLED)),
    );
    mgr.SetConditions(
      PCB_ACTIONS.zoneDisplayOutline,
      ENABLE(enableZoneControlCondition).Check(
        cond.ZoneDisplayMode(ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE),
      ),
    );
    mgr.SetConditions(
      PCB_ACTIONS.zoneDisplayFractured,
      ENABLE(enableZoneControlCondition).Check(
        cond.ZoneDisplayMode(ZONE_DISPLAY_MODE.SHOW_FRACTURE_BORDERS),
      ),
    );
    mgr.SetConditions(
      PCB_ACTIONS.zoneDisplayTriangulated,
      ENABLE(enableZoneControlCondition).Check(
        cond.ZoneDisplayMode(ZONE_DISPLAY_MODE.SHOW_TRIANGULATION),
      ),
    );

    mgr.SetConditions(ACTIONS.toggleBoundingBoxes, CHECK(cond.BoundingBoxes()));

    const hasElements = (aSel: SELECTION): boolean => {
      const board = this.GetBoard();

      return !!board && (!board.IsEmpty() || !Idle(aSel));
    };

    const boardFlippedCond = (_aSel: SELECTION): boolean =>
      this.GetDisplayOptions().m_FlipBoardView;

    const layerManagerCond = (_aSel: SELECTION): boolean => this.LayerManagerShown();

    const propertiesCond = (_aSel: SELECTION): boolean => this.PropertiesShown();

    const netInspectorCond = (_aSel: SELECTION): boolean => this.NetInspectorShown();

    const searchPaneCond = (_aSel: SELECTION): boolean =>
      this.hooks.paneShown?.(PCB_EDIT_FRAME.SearchPaneName()) ?? false;

    const designBlockCond = (_aSel: SELECTION): boolean =>
      this.hooks.paneShown?.(EDA_DRAW_FRAME.DesignBlocksPaneName()) ?? false;

    const highContrastCond = (_aSel: SELECTION): boolean =>
      this.GetDisplayOptions().m_ContrastModeDisplay !== HIGH_CONTRAST_MODE.NORMAL;

    const globalRatsnestCond = (_aSel: SELECTION): boolean => {
      const cfg = this.GetPcbNewSettings();
      return !!cfg && cfg.m_Display.m_ShowGlobalRatsnest;
    };

    const curvedRatsnestCond = (_aSel: SELECTION): boolean => {
      const cfg = this.GetPcbNewSettings();
      return !!cfg && cfg.m_Display.m_DisplayRatsnestLinesCurved;
    };

    const netHighlightCond = (_aSel: SELECTION): boolean => {
      const settings = this.GetCanvas()?.GetView()?.GetPainter()?.GetSettings();

      if (settings) return settings.GetHighlightNetCodes().size > 0;

      return false;
    };

    const enableNetHighlightCond = (_aSel: SELECTION): boolean => {
      const tool = this.m_toolManager!.GetTool(BOARD_INSPECTION_TOOL);
      return !!tool && tool.IsNetHighlightSet();
    };

    mgr.SetConditions(ACTIONS.highContrastMode, CHECK(highContrastCond));
    mgr.SetConditions(PCB_ACTIONS.flipBoard, CHECK(boardFlippedCond));
    mgr.SetConditions(PCB_ACTIONS.showLayersManager, CHECK(layerManagerCond));
    mgr.SetConditions(PCB_ACTIONS.showRatsnest, CHECK(globalRatsnestCond));
    mgr.SetConditions(PCB_ACTIONS.ratsnestLineMode, CHECK(curvedRatsnestCond));
    mgr.SetConditions(
      PCB_ACTIONS.toggleNetHighlight,
      CHECK(netHighlightCond).Enable(enableNetHighlightCond),
    );
    mgr.SetConditions(ACTIONS.showProperties, CHECK(propertiesCond));
    mgr.SetConditions(PCB_ACTIONS.showNetInspector, CHECK(netInspectorCond));
    mgr.SetConditions(ACTIONS.showSearch, CHECK(searchPaneCond));
    mgr.SetConditions(PCB_ACTIONS.showDesignBlockPanel, CHECK(designBlockCond));

    mgr.SetConditions(PCB_ACTIONS.saveBoardAsDesignBlock, ENABLE(hasElements));
    mgr.SetConditions(
      PCB_ACTIONS.saveSelectionAsDesignBlock,
      ENABLE(SELECTION_CONDITIONS.NotEmpty),
    );

    const isArcKeepCenterMode = (_aSel: SELECTION): boolean => {
      const cfg = this.GetPcbNewSettings();
      return !!cfg && cfg.m_ArcEditMode === ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS;
    };

    const isArcKeepEndpointMode = (_aSel: SELECTION): boolean => {
      const cfg = this.GetPcbNewSettings();
      return !!cfg && cfg.m_ArcEditMode === ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION;
    };

    const isArcKeepRadiusMode = (_aSel: SELECTION): boolean => {
      const cfg = this.GetPcbNewSettings();
      return !!cfg && cfg.m_ArcEditMode === ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE;
    };

    mgr.SetConditions(ACTIONS.pointEditorArcKeepCenter, CHECK(isArcKeepCenterMode));
    mgr.SetConditions(ACTIONS.pointEditorArcKeepEndpoint, CHECK(isArcKeepEndpointMode));
    mgr.SetConditions(ACTIONS.pointEditorArcKeepRadius, CHECK(isArcKeepRadiusMode));

    const isHighlightMode = (_aSel: SELECTION): boolean => {
      const tool = this.m_toolManager!.GetTool(ROUTER_TOOL);
      return !!tool && tool.GetRouterMode() === PnsMode.RM_MarkObstacles;
    };

    const isShoveMode = (_aSel: SELECTION): boolean => {
      const tool = this.m_toolManager!.GetTool(ROUTER_TOOL);
      return !!tool && tool.GetRouterMode() === PnsMode.RM_Shove;
    };

    const isWalkaroundMode = (_aSel: SELECTION): boolean => {
      const tool = this.m_toolManager!.GetTool(ROUTER_TOOL);
      return !!tool && tool.GetRouterMode() === PnsMode.RM_Walkaround;
    };

    mgr.SetConditions(PCB_ACTIONS.routerHighlightMode, CHECK(isHighlightMode));
    mgr.SetConditions(PCB_ACTIONS.routerShoveMode, CHECK(isShoveMode));
    mgr.SetConditions(PCB_ACTIONS.routerWalkaroundMode, CHECK(isWalkaroundMode));

    const isAutoTrackWidth = (_aSel: SELECTION): boolean =>
      this.GetDesignSettings().m_UseConnectedTrackWidth;

    mgr.SetConditions(PCB_ACTIONS.autoTrackWidth, CHECK(isAutoTrackWidth));

    const haveNetCond = (aSel: SELECTION): boolean => {
      for (const item of aSel) {
        if (item instanceof BOARD_CONNECTED_ITEM && item.GetNetCode() > 0) return true;
      }

      return false;
    };

    mgr.SetConditions(PCB_ACTIONS.showNetInRatsnest, ENABLE(haveNetCond));
    mgr.SetConditions(PCB_ACTIONS.hideNetInRatsnest, ENABLE(haveNetCond));
    mgr.SetConditions(PCB_ACTIONS.highlightNet, ENABLE(ShowAlways));
    mgr.SetConditions(PCB_ACTIONS.highlightNetSelection, ENABLE(ShowAlways));

    const trackTypes = [KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T, KICAD_T.PCB_VIA_T];
    const padOwnerTypes = [KICAD_T.PCB_FOOTPRINT_T, KICAD_T.PCB_PAD_T];
    const footprintTypes = [KICAD_T.PCB_FOOTPRINT_T];
    const crossProbeTypes = [KICAD_T.PCB_PAD_T, KICAD_T.PCB_FOOTPRINT_T, KICAD_T.PCB_GROUP_T];
    const zoneTypes = [KICAD_T.PCB_ZONE_T];

    mgr.SetConditions(PCB_ACTIONS.selectNet, ENABLE(SELECTION_CONDITIONS.OnlyTypes(trackTypes)));
    mgr.SetConditions(PCB_ACTIONS.deselectNet, ENABLE(SELECTION_CONDITIONS.OnlyTypes(trackTypes)));
    mgr.SetConditions(
      PCB_ACTIONS.selectUnconnected,
      ENABLE(SELECTION_CONDITIONS.OnlyTypes(padOwnerTypes)),
    );
    mgr.SetConditions(
      PCB_ACTIONS.selectSameSheet,
      ENABLE(SELECTION_CONDITIONS.OnlyTypes(footprintTypes)),
    );
    mgr.SetConditions(
      PCB_ACTIONS.selectOnSchematic,
      ENABLE(SELECTION_CONDITIONS.HasTypes(crossProbeTypes)),
    );

    const singleZoneCond = And(
      SELECTION_CONDITIONS.Count(1),
      SELECTION_CONDITIONS.OnlyTypes(zoneTypes),
    );

    const zoneMergeCond = And(
      SELECTION_CONDITIONS.MoreThan(1),
      SELECTION_CONDITIONS.OnlyTypes(zoneTypes),
    );

    mgr.SetConditions(PCB_ACTIONS.zoneDuplicate, ENABLE(singleZoneCond));
    mgr.SetConditions(PCB_ACTIONS.drawZoneCutout, ENABLE(singleZoneCond));
    mgr.SetConditions(PCB_ACTIONS.drawSimilarZone, ENABLE(singleZoneCond));
    mgr.SetConditions(PCB_ACTIONS.zoneMerge, ENABLE(zoneMergeCond));

    mgr.SetConditions(ACTIONS.selectSetRect, CHECK(cond.CurrentTool(ACTIONS.selectionTool)));
    mgr.SetConditions(ACTIONS.selectSetLasso, CHECK(cond.CurrentTool(ACTIONS.selectionTool)));

    const CURRENT_TOOL = (action: TOOL_ACTION): void =>
      mgr.SetConditions(action, CHECK(cond.CurrentTool(action)));

    // These tools can be used at any time to inspect the board
    CURRENT_TOOL(ACTIONS.zoomTool);
    CURRENT_TOOL(ACTIONS.measureTool);
    CURRENT_TOOL(ACTIONS.selectionTool);
    CURRENT_TOOL(PCB_ACTIONS.localRatsnestTool);

    const isDRCIdle = (_aSel: SELECTION): boolean => {
      const tool = this.m_toolManager!.GetTool(DRC_TOOL);
      return !(tool && tool.IsDRCRunning());
    };

    const CURRENT_EDIT_TOOL = (action: TOOL_ACTION): void =>
      mgr.SetConditions(
        action,
        new ACTION_CONDITIONS().Check(cond.CurrentTool(action)).Enable(isDRCIdle),
      );

    // These tools edit the board, so they must be disabled during some operations
    CURRENT_EDIT_TOOL(ACTIONS.embeddedFiles);
    CURRENT_EDIT_TOOL(ACTIONS.deleteTool);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.placeFootprint);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.placeDesignBlock);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.routeSingleTrack);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.routeDiffPair);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.tuneSingleTrack);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.tuneDiffPair);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.tuneSkew);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawVia);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawZone);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawRuleArea);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawLine);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawRectangle);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawCircle);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawArc);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawPolygon);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawBezier);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.placePoint);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.placeReferenceImage);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.placeText);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawTextBox);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawTable);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawAlignedDimension);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawOrthogonalDimension);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawCenterDimension);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawRadialDimension);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drawLeader);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.drillOrigin);
    CURRENT_EDIT_TOOL(ACTIONS.gridSetOrigin);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.createArray);

    CURRENT_EDIT_TOOL(PCB_ACTIONS.microwaveCreateLine);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.microwaveCreateGap);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.microwaveCreateStub);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.microwaveCreateStubArc);
    CURRENT_EDIT_TOOL(PCB_ACTIONS.microwaveCreateFunctionShape);
  }

  /**
   * What `MICROWAVE_TOOL` asks `PCB_EDIT_FRAME` for: the dialogs, the current
   * track width, unit conversion, a blank footprint on this board and the
   * commit.
   */
  MicrowaveHost(): MICROWAVE_HOST {
    return {
      GetCurrentTrackWidth: () => this.GetDesignSettings().GetCurrentTrackWidth(),
      StringFromValue: (aIU) => this.GetUnitsProvider().StringFromValue(aIU),
      ValueFromString: (aText) => this.GetUnitsProvider().ValueFromString(aText),
      CreateNewFootprint: (aName, aLib) => this.CreateNewFootprint(aName, aLib),
      OnModify: () => this.OnModify(),
      ShowInfoBarError: (aMessage) => this.ShowInfoBarError(aMessage),
      DisplayError: (aMessage) => DisplayErrorMessage(aMessage),
      TextEntry: (aPrompt, aCaption, aValue, aValidator) =>
        this.hooks.textEntry?.(aPrompt, aCaption, aValue, aValidator) ?? Promise.resolve(null),
      PolygonShapeDialog: () => this.hooks.mwavePolygonalShapeDialog?.() ?? Promise.resolve(false),
      AddInductor: (aFootprint) => {
        this.m_toolManager!.RunAction<EDA_ITEM | null>(ACTIONS.selectItem, aFootprint);

        const commit = new BOARD_COMMIT(this);
        commit.Add(aFootprint);
        commit.Push('Add Microwave Inductor');
      },
    };
  }

  /** `GetToolManager()->GetTool<MICROWAVE_TOOL>()`. */
  MicrowaveTool(): MICROWAVE_TOOL {
    return this.m_toolManager!.FindTool(MICROWAVE_TOOL.NAME) as unknown as MICROWAVE_TOOL;
  }

  /**
   * `DIALOG_ZONE_MANAGER::OnUpdateDisplayedZonesClick`'s pour
   * (dialog_zone_manager.cpp:495-519): the board's zone list swapped for the
   * clones, `ZONE_FILLER( board, nullptr ).Fill` over them, and the originals
   * restored. "Do not use a commit here since we're operating on cloned zones
   * that are not owned by the board." The connectivity is rebuilt after the
   * restore too, to drop its pointers to the clones. Here rather than in the
   * dialog so the dialog's tests can stand in for the pour.
   */
  FillZones(aBoard: BOARD, aZones: ZONE[]): boolean {
    const zones = aBoard.Zones();
    const originalZones = [...zones];

    zones.splice(0, zones.length, ...aZones);

    try {
      const filler = new ZONE_FILLER(aBoard, null);
      const complete = filler.Fill(aBoard.Zones());
      aBoard.BuildConnectivity();
      return complete;
    } finally {
      zones.splice(0, zones.length, ...originalZones);
      aBoard.BuildConnectivity();
    }
  }

  /** `PCB_BASE_EDIT_FRAME::GetLayerPairSettings()` (`pcb_base_edit_frame.h:249`). */
  GetLayerPairSettings(): LAYER_PAIR_SETTINGS {
    return this.m_layerPairSettings;
  }

  /**
   * `ROUTER_TOOL::SelectCopperLayerPair` (`sel_layer.cpp:765-789`), minus the
   * `ShowModal()`/`wxID_OK` blocking read-back: our dialog is modeless, so it
   * commits (or doesn't) through `GetLayerPairSettings()` itself on OK, and
   * the "top and bottom layers are the same" warning is the dialog's own
   * concern (it can show the message the moment the pick is made, rather
   * than waiting for a close this port has no equivalent event for).
   */
  SelectCopperLayerPair(): void {
    this.hooks.selectCopperLayerPair();
  }

  /**
   * `PCB_EDIT_FRAME::setupTools` (pcb_edit_frame.cpp:940): the manager, its
   * environment, the dispatcher, the tools registered in the C++ order - of
   * them PCB_SELECTION_TOOL, EDIT_TOOL, PCB_POINT_EDITOR (as far as
   * `HasPoint`), BOARD_INSPECTION_TOOL (highlight and ratsnest), ALIGN_DISTRIBUTE_TOOL,
   * POSITION_RELATIVE_TOOL, DRC_TOOL,
   * CONVERT_TOOL, PCB_GROUP_TOOL,
   * PROPERTIES_TOOL, EMBED_TOOL and PCB_PICKER_TOOL are ported; the rest are
   * #636 stage 3's, and WINDOW_ACTION_BRIDGE answers their actions meanwhile.
   */
  private setupTools(): void {
    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(this.m_pcb, null, null, this.hooks.settings(), this);
    const dispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    // TRANSITIONAL (#636 stage 3): an event one of the window's own tools owns
    // goes to the window, not to the dispatcher (see `eventToWindow`).
    this.m_toolDispatcher = makeGatedDispatcher(
      dispatcher,
      (aEvent: wxEvent) => this.hooks.eventToWindow?.(aEvent) ?? false,
      () => this.OnIdle(),
    ) as unknown as TOOL_DISPATCHER;

    // Register tools
    this.m_toolManager.RegisterTool(new PCB_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new ROUTER_TOOL());
    this.m_toolManager.RegisterTool(new EDIT_TOOL());
    this.m_toolManager.RegisterTool(new GLOBAL_EDIT_TOOL());
    this.m_toolManager.RegisterTool(new PAD_TOOL());
    this.m_toolManager.RegisterTool(new PCB_POINT_EDITOR());
    this.m_toolManager.RegisterTool(new BOARD_INSPECTION_TOOL());
    this.m_toolManager.RegisterTool(new ALIGN_DISTRIBUTE_TOOL());
    this.m_toolManager.RegisterTool(new POSITION_RELATIVE_TOOL());
    this.m_toolManager.RegisterTool(new ZONE_FILLER_TOOL());
    this.m_toolManager.RegisterTool(new DRC_TOOL());
    this.m_toolManager.RegisterTool(new CONVERT_TOOL());
    this.m_toolManager.RegisterTool(new PCB_GROUP_TOOL());
    this.m_toolManager.RegisterTool(new PROPERTIES_TOOL());
    this.m_toolManager.RegisterTool(new EMBED_TOOL());
    this.m_toolManager.RegisterTool(new PCB_PICKER_TOOL());
    this.m_toolManager.RegisterTool(new DRAWING_TOOL());
    this.m_toolManager.RegisterTool(new PCB_CONTROL());
    this.m_toolManager.RegisterTool(new BOARD_EDITOR_CONTROL());
    this.m_toolManager.RegisterTool(new AUTOPLACE_TOOL());
    this.m_toolManager.RegisterTool(new MICROWAVE_TOOL());
    this.m_toolManager.RegisterTool(new PCB_VIEWER_TOOLS());
    this.m_toolManager.RegisterTool(
      new WINDOW_ACTION_BRIDGE((aAction, aEvent) => this.hooks.windowAction?.(aAction, aEvent)),
    );
    this.m_toolManager.InitTools();

    // `EDA_BASE_FRAME::LoadWindowSettings` ends with `TOOLS_HOLDER::CommonSettingsChanged()`:
    // the left-drag action (`m_dragAction`), warp-on-move and immediate actions
    // from COMMON_SETTINGS. Without it the drag action stays TOOLS_HOLDER's
    // SELECT, and every drag - from a selected footprint too - is a selection box.
    this.CommonSettingsChanged();

    for (const tool of this.m_toolManager.Tools()) {
      if (tool instanceof PCB_TOOL_BASE) tool.SetIsBoardEditor(true);
    }

    this.setupUIConditions();

    // Run the selection tool, it is supposed to be always active
    this.m_toolManager.InvokeTool('common.InteractiveSelection');
  }

  /** `PCB_EDIT_FRAME::GetDesignRulesPath()`: the project's rules file. */
  GetDesignRulesPath(): string {
    return this.m_designRulesPath;
  }

  /** The rules file's text, which `DRC_ENGINE::InitEngine` reads here in place of the path. */
  GetDesignRulesText(): string | null {
    return this.m_designRulesText;
  }

  /** `PCB_EDIT_FRAME::GetInspectDrcErrorDialog()`: made on first use, destroyed on close. */
  GetInspectDrcErrorDialog(): DIALOG_BOOK_REPORTER {
    if (!this.m_inspectDrcErrorDlg) {
      this.m_inspectDrcErrorDlg = new DIALOG_BOOK_REPORTER(
        INSPECT_DRC_ERROR_DIALOG_NAME,
        'Violation Report',
        (aName) => this.onCloseModelessBookReporterDialogs(aName),
      );
      this.m_bookReporterListener?.();
    }

    return this.m_inspectDrcErrorDlg;
  }

  /** The book-reporter dialogs alive now, for the window to draw. */
  GetBookReporterDialogs(): DIALOG_BOOK_REPORTER[] {
    return this.m_inspectDrcErrorDlg ? [this.m_inspectDrcErrorDlg] : [];
  }

  /** The window's subscription to a book-reporter dialog being made or destroyed. */
  SetBookReporterListener(aListener: (() => void) | null): void {
    this.m_bookReporterListener = aListener;
  }

  /** `EDA_EVT_CLOSE_DIALOG_BOOK_REPORTER`: a modeless report closed; destroy it. */
  private onCloseModelessBookReporterDialogs(aName: string): void {
    if (this.m_inspectDrcErrorDlg && aName === INSPECT_DRC_ERROR_DIALOG_NAME) {
      this.m_inspectDrcErrorDlg = null;
      this.m_bookReporterListener?.();
    }
  }

  /** `PCB_EDIT_FRAME::KiwayMailIn` (pcbnew/cross-probing.cpp:533). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    const payload = mail.GetPayload();

    switch (mail.Command()) {
      case MAIL_T.MAIL_CROSS_PROBE:
        this.ExecuteRemoteCommand(payload);
        break;

      // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH, as upstream
      case MAIL_T.MAIL_SELECTION:
        if (!this.hooks.settings().m_CrossProbing.on_selection) break;

      // KI_FALLTHROUGH;

      case MAIL_T.MAIL_SELECTION_FORCE: {
        // $SELECT: <mode 0 - only footprints, 1 - with connections>,<spec1>,<spec2>,<spec3>
        const prefix = '$SELECT: ';

        if (payload.startsWith(prefix)) {
          const del = ',';
          const paramStr = payload.substring(prefix.length);
          const modeEnd = paramStr.indexOf(del);
          // std::stoi of the mode: its leading integer, and wxFAIL (false) on none.
          const mode = Number.parseInt(
            modeEnd === -1 ? paramStr : paramStr.substring(0, modeEnd),
            10,
          );
          const selectConnections = mode === 1;

          // `paramStr.substr( modeEnd + 1 )`: npos + 1 wraps to 0, the whole string.
          const syncStr = paramStr.substring(modeEnd + 1);

          this.hooks.syncSelection(syncStr.split(del), selectConnections);
        }

        break;
      }

      case MAIL_T.MAIL_PCB_UPDATE:
        this.hooks.updatePcbFromSchematic();
        break;

      default:
        break;
    }
  }

  /**
   * `PCB_EDIT_FRAME::ExecuteRemoteCommand` (pcbnew/cross-probing.cpp:83): a
   * cross-probe packet from the schematic. The `$CLEAR`, `$NET:` and `$NETS:`
   * arms are here; `$CONFIG`, `$CUSTOM_RULES`, `$DRC` and the item probes
   * (`$PART:`, `$PAD:`, `$REF:`, `$VAL:`, `$SHEET:`) are not yet.
   */
  ExecuteRemoteCommand(cmdline: string): void {
    const pcb = this.GetBoard();

    if (!pcb) return;

    const crossProbingSettings = this.hooks.settings().m_CrossProbing;

    const tok = new STRTOK(strncpyLine(cmdline));
    const idcmd = tok.Next(' \n\r');
    const text = tok.Next('"\n\r');

    if (idcmd === null) return;

    let netcode = -1;
    let multiHighlight = false;

    const view = this.m_toolManager!.GetView()!;
    const renderSettings = view.GetPainter()!.GetSettings();

    if (idcmd === '$CLEAR') {
      if (renderSettings.IsHighlightEnabled()) {
        renderSettings.SetHighlight(false);
        view.UpdateAllLayersColor();
      }

      if (pcb.IsHighLightNetON()) {
        pcb.ResetNetHighLight();
        this.SetMsgPanel(pcb);
      }

      this.GetCanvas()?.Refresh();
      return;
    } else if (idcmd === '$NET:') {
      if (!crossProbingSettings.auto_highlight) return;

      const netinfo = pcb.FindNet(text ?? '');

      if (netinfo) {
        netcode = netinfo.GetNetCode();

        const items: MSG_PANEL_ITEM[] = [];
        netinfo.GetMsgPanelInfo(this as unknown as EDA_DRAW_FRAME_LIKE, items);
        this.SetMsgPanel(items);
      }

      // fall through to highlighting section
    } else if (idcmd === '$NETS:') {
      if (!crossProbingSettings.auto_highlight) return;

      // wxStringTokenizer( …, ",", wxTOKEN_STRTOK ): empty tokens are skipped.
      let first = true;

      for (const token of (text ?? '').split(',')) {
        if (token === '') continue;

        const netinfo = pcb.FindNet(token.trim());

        if (netinfo) {
          if (first) {
            // TODO: Once buses are included in netlist, show bus name
            const items: MSG_PANEL_ITEM[] = [];
            netinfo.GetMsgPanelInfo(this as unknown as EDA_DRAW_FRAME_LIKE, items);
            this.SetMsgPanel(items);
            first = false;

            pcb.SetHighLightNet(netinfo.GetNetCode());
            renderSettings.SetHighlight(true, netinfo.GetNetCode());
            multiHighlight = true;
          } else {
            pcb.SetHighLightNet(netinfo.GetNetCode(), true);
            renderSettings.SetHighlight(true, netinfo.GetNetCode(), true);
          }
        }
      }

      netcode = -1;

      // fall through to highlighting section
    } else {
      return;
    }

    const bbox = new BOX2I();

    if (netcode > 0 || multiHighlight) {
      if (!multiHighlight) {
        renderSettings.SetHighlight(netcode >= 0, netcode);
        pcb.SetHighLightNet(netcode);
      } else {
        // Just pick the first one for area calculation
        netcode = Math.min(...pcb.GetHighLightNetCodes());
      }

      pcb.HighLightON();

      const merge_area = (aItem: BOARD_CONNECTED_ITEM): void => {
        if (aItem.GetNetCode() === netcode) bbox.Merge(aItem.GetBoundingBox());
      };

      if (crossProbingSettings.center_on_items) {
        for (const zone of pcb.Zones()) merge_area(zone);

        for (const track of pcb.Tracks()) merge_area(track);

        for (const fp of pcb.Footprints()) {
          for (const p of fp.Pads()) merge_area(p);
        }
      }
    } else {
      renderSettings.SetHighlight(false);
    }

    if (crossProbingSettings.center_on_items && bbox.GetWidth() !== 0 && bbox.GetHeight() !== 0) {
      if (crossProbingSettings.zoom_to_fit) this.GetSelectionTool().ZoomFitCrossProbeBBox(bbox);

      this.FocusOnLocation(bbox.Centre());
    }

    view.UpdateAllLayersColor();

    // Ensure the display is refreshed, because in some installs the refresh is done only
    // when the gal canvas has the focus, and that is not the case when crossprobing from
    // Eeschema:
    this.GetCanvas()?.Refresh();
  }

  /**
   * `PCB_EDIT_FRAME::SendSelectItemsToSch` (pcbnew/cross-probing.cpp:349),
   * over the parts `collectItemsForSyncParts` gives (`boardSyncSelectionParts`,
   * sorted as upstream's `std::set`). The focus item is not sent: the
   * selection tool does not yet tell a point select from the rest, so the mode
   * is always 0. Nothing is sent for no parts, as upstream.
   */
  SendSelectItemsToSch(aParts: readonly string[], aForce: boolean): void {
    let command = '$SELECT: ';

    command += '0,';

    if (aParts.length === 0) return;

    for (const part of aParts) {
      command += part;
      command += ',';
    }

    command = command.slice(0, -1);

    this.Kiway()?.ExpressMail(
      FRAME_T.FRAME_SCH,
      aForce ? MAIL_T.MAIL_SELECTION_FORCE : MAIL_T.MAIL_SELECTION,
      { value: command },
      this,
    );
  }

  /** `PCB_EDIT_FRAME::SendCrossProbeNetName` (pcbnew/cross-probing.cpp:405). */
  SendCrossProbeNetName(aNetName: string): void {
    // The command is a keyword followed by a quoted string.
    const packet = `$NET: "${aNetName}"`;

    this.Kiway()?.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_CROSS_PROBE, { value: packet }, this);
  }

  CreateDrcDialog(aTool: DRC_TOOL, aParent: unknown): DIALOG_DRC_LIKE {
    return this.hooks.createDrcDialog(aTool, aParent);
  }

  /** The project file whose `board.design_settings` the DRC job reloads. */
  GetProjectText(): string | null {
    return this.hooks.projectText();
  }

  GetSchematicNetlistText(): string | null {
    return this.hooks.schematicNetlistText();
  }

  /**
   * `DRC_TOOL::RunTests`' engine run, on a worker.
   *
   * The frame owns this because a `Worker` is the designer's business; the
   * tool only knows it hands over a request and gets violations back. The
   * runner falls back to running the same job in-process where there is no
   * worker (the test runner), so the two paths cannot drift.
   */
  RunDrcJob(aRequest: DRC_JOB_REQUEST, aHooks: DRC_JOB_HOOKS): Promise<void> {
    return runDrcJobOffThread(aRequest, aHooks);
  }

  IsSingle(): boolean {
    return this.hooks.isSingle();
  }

  FetchNetlistFromSchematic(aNetlist: NETLIST, aAnnotateMessage: string): boolean {
    return this.hooks.fetchNetlistFromSchematic(aNetlist, aAnnotateMessage);
  }

  /** `ShowExchangeFootprintsDialog`: `DIALOG_EXCHANGE_FOOTPRINTS( ... ).ShowQuasiModal()`. */
  override ShowZoneSettingsDialog(
    aDialog: DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR | DIALOG_RULE_AREA_PROPERTIES,
  ): Promise<boolean> {
    return this.hooks.showZoneSettingsDialog?.(aDialog) ?? Promise.resolve(false);
  }

  override ShowTextPropertiesDialog(aDialog: DIALOG_TEXT_PROPERTIES): Promise<boolean> {
    return this.hooks.showTextPropertiesDialog?.(aDialog) ?? Promise.resolve(false);
  }

  /** `TOOLS_HOLDER::PushTool`, and the window's toolbar told (KiCad's toolbar asks on update-UI). */
  override PushTool(aEvent: TOOL_EVENT): void {
    super.PushTool(aEvent);
    this.hooks.toolStackChanged?.();
  }

  /** `TOOLS_HOLDER::PopTool`, and the window's toolbar told. */
  override PopTool(aEvent: TOOL_EVENT): void {
    super.PopTool(aEvent);
    this.hooks.toolStackChanged?.();
  }

  ShowExchangeFootprintsDialog(
    aFootprint: FOOTPRINT | null,
    aUpdateMode: boolean,
    aSelectedMode: boolean,
  ): void {
    const dialog = new DIALOG_EXCHANGE_FOOTPRINTS(this, aFootprint, aUpdateMode, aSelectedMode);

    this.hooks.showExchangeFootprintsDialog(dialog);
  }

  /**
   * `PCB_EDIT_FRAME::ExchangeFootprint` (pcb_edit_frame.cpp:2591-3062): put
   * `aNew` where `aExisting` is - its group, place, side, orientation, lock
   * and identity - carry over the pads' nets and the children's UUIDs by
   * similarity, keep or reset the texts, fields, fabrication attributes,
   * clearance overrides and 3D models per the flags, and stage the swap in
   * `aCommit`. `aUpdated.value` is raised when anything actually changed.
   *
   * KiCad's `SetUuid` rebinds an item the board has indexed, else is
   * `SetUuidDirect`; everything renumbered here belongs to the freshly loaded
   * `aNew`, which no board has indexed yet, so it is `SetUuidDirect` throughout.
   */
  ExchangeFootprint(
    aExisting: FOOTPRINT,
    aNew: FOOTPRINT,
    aCommit: BOARD_COMMIT,
    deleteExtraTexts: boolean,
    resetTextLayers: boolean,
    resetTextEffects: boolean,
    resetTextPositions: boolean,
    resetTextContent: boolean,
    resetFabricationAttrs: boolean,
    resetClearanceOverrides: boolean,
    reset3DModels: boolean,
    aUpdated: { value: boolean } = { value: false },
  ): void {
    const parentGroup = aExisting.GetParentGroup();

    if (parentGroup) {
      aCommit.Modify(parentGroup.AsEdaItem(), null, RECURSE_MODE.NO_RECURSE);
      parentGroup.RemoveItem(aExisting);
      parentGroup.AddItem(aNew);
    }

    aNew.SetParent(this.GetBoard());

    this.PlaceFootprint(aNew, false, aExisting.GetPosition());

    if (aNew.GetLayer() !== aExisting.GetLayer())
      aNew.Flip(aNew.GetPosition(), this.GetPcbNewSettings().m_FlipDirection);

    if (!aNew.GetOrientation().equals(aExisting.GetOrientation()))
      aNew.SetOrientation(aExisting.GetOrientation());

    aNew.SetLocked(aExisting.IsLocked());

    aNew.SetUuidDirect(aExisting.m_Uuid);
    aNew.Reference().SetUuidDirect(aExisting.Reference().m_Uuid);
    aNew.Value().SetUuidDirect(aExisting.Value().m_Uuid);

    const padMatches = matchItemsBySimilarity<PAD>([...aExisting.Pads()], [...aNew.Pads()], true);
    const matchedNewPads = new Set<PAD>();

    for (const [oldPad, newPad] of padMatches) {
      matchedNewPads.add(newPad);
      newPad.SetUuidDirect(oldPad.m_Uuid);
      newPad.SetLocalRatsnestVisible(oldPad.GetLocalRatsnestVisible());
      newPad.SetPinFunction(oldPad.GetPinFunction());
      newPad.SetPinType(oldPad.GetPinType());

      if (newPad.IsOnCopperLayer()) newPad.SetNetCode(oldPad.GetNetCode());
      else newPad.SetNetCode(UNCONNECTED_NET);
    }

    for (const newPad of aNew.Pads()) {
      if (matchedNewPads.has(newPad)) continue;

      newPad.ResetUuidDirect();
      newPad.SetNetCode(UNCONNECTED_NET);
    }

    const newDrawings = [...aNew.GraphicalItems()];
    const drawingMatches = matchItemsBySimilarity<BOARD_ITEM>(
      [...aExisting.GraphicalItems()],
      newDrawings,
    );
    const matchedNewDrawings = new Set<BOARD_ITEM>();

    for (const [oldItem, newItem] of drawingMatches) {
      matchedNewDrawings.add(newItem);
      newItem.SetUuidDirect(oldItem.m_Uuid);
    }

    for (const newItem of newDrawings) {
      if (!matchedNewDrawings.has(newItem)) newItem.ResetUuidDirect();
    }

    const reuseUuids = <T extends BOARD_ITEM>(
      aOld: readonly T[],
      aNewItems: readonly T[],
    ): void => {
      const matched = new Set<T>();

      for (const [o, n] of matchItemsBySimilarity<T>(aOld, aNewItems)) {
        matched.add(n);
        n.SetUuidDirect(o.m_Uuid);
      }

      for (const n of aNewItems) {
        if (!matched.has(n)) n.ResetUuidDirect();
      }
    };

    reuseUuids([...aExisting.Zones()], [...aNew.Zones()]);
    reuseUuids([...aExisting.Points()], [...aNew.Points()]);
    reuseUuids<BOARD_ITEM>(
      [...aExisting.Groups()] as unknown as BOARD_ITEM[],
      [...aNew.Groups()] as unknown as BOARD_ITEM[],
    );

    const otherFields = (aFp: FOOTPRINT): PCB_FIELD[] =>
      aFp.GetFields().filter((f): f is PCB_FIELD => !!f && !f.IsReference() && !f.IsValue());
    const newFieldsVec = otherFields(aNew);
    const fieldMatches = matchItemsBySimilarity<PCB_FIELD>(otherFields(aExisting), newFieldsVec);
    const oldToNewFields = new Map<PCB_FIELD, PCB_FIELD>();
    const matchedNewFields = new Set<PCB_FIELD>();

    for (const [oldField, newField] of fieldMatches) {
      oldToNewFields.set(oldField, newField);
      matchedNewFields.add(newField);
      newField.SetUuidDirect(oldField.m_Uuid);
    }

    for (const newField of newFieldsVec) {
      if (!matchedNewFields.has(newField)) newField.ResetUuidDirect();
    }

    const oldToNewTexts = new Map<PCB_TEXT, PCB_TEXT>();

    for (const [oldItem, newItem] of drawingMatches) {
      if (oldItem instanceof PCB_TEXT && newItem instanceof PCB_TEXT)
        oldToNewTexts.set(oldItem, newItem);
    }

    const handledTextItems = new Set<PCB_TEXT>();

    for (const oldItem of [...aExisting.GraphicalItems()]) {
      if (!(oldItem instanceof PCB_TEXT)) continue;

      // Dimensions have PCB_TEXT base but are not treated like texts in the updater
      if (oldItem instanceof PCB_DIMENSION_BASE) continue;

      let newTextItem = oldToNewTexts.get(oldItem) ?? null;

      if (newTextItem) {
        handledTextItems.add(newTextItem);
        processTextItem(
          oldItem,
          newTextItem,
          resetTextContent,
          resetTextLayers,
          resetTextEffects,
          resetTextPositions,
          aUpdated,
        );
      } else if (deleteExtraTexts) {
        aUpdated.value = true;
      } else {
        newTextItem = oldItem.Clone() as PCB_TEXT;
        handledTextItems.add(newTextItem);
        aNew.Add(newTextItem);
      }
    }

    // Check for any newly-added text items and set the update flag as appropriate
    for (const newItem of aNew.GraphicalItems()) {
      if (!(newItem instanceof PCB_TEXT)) continue;

      // Dimensions have PCB_TEXT base but are not treated like texts in the updater
      if (newItem instanceof PCB_DIMENSION_BASE) continue;

      if (!handledTextItems.has(newItem)) {
        aUpdated.value = true;
        break;
      }
    }

    // Copy reference. The initial text is always used, never resetted
    processTextItem(
      aExisting.Reference(),
      aNew.Reference(),
      false,
      resetTextLayers,
      resetTextEffects,
      resetTextPositions,
      aUpdated,
    );

    // Copy value
    processTextItem(
      aExisting.Value(),
      aNew.Value(),
      // reset value text only when it is a proxy for the footprint ID
      // (cf replacing value "MountingHole-2.5mm" with "MountingHole-4.0mm")
      aExisting.GetValue() === aExisting.GetFPID().GetLibItemName(),
      resetTextLayers,
      resetTextEffects,
      resetTextPositions,
      aUpdated,
    );

    const handledFields = new Set<PCB_FIELD>();

    // Copy fields in accordance with the reset* flags
    for (const oldField of [...aExisting.GetFields()]) {
      if (!oldField) continue; // wxCHECK2( oldField, continue )

      // Reference and value are already handled
      if (oldField.IsReference() || oldField.IsValue()) continue;

      let newField = oldToNewFields.get(oldField) ?? null;

      if (newField) {
        handledFields.add(newField);
        processTextItem(
          oldField,
          newField,
          resetTextContent,
          resetTextLayers,
          resetTextEffects,
          resetTextPositions,
          aUpdated,
        );
      } else if (deleteExtraTexts) {
        aUpdated.value = true;
      } else {
        newField = oldField.Clone() as PCB_FIELD;
        handledFields.add(newField);
        aNew.Add(newField);
      }
    }

    // Check for any newly-added fields and set the update flag as appropriate
    for (const newField of aNew.GetFields()) {
      if (!newField) continue; // wxCHECK2( newField, continue )

      // Reference and value are already handled
      if (newField.IsReference() || newField.IsValue()) continue;

      if (!handledFields.has(newField)) {
        aUpdated.value = true;
        break;
      }
    }

    if (resetFabricationAttrs) {
      // We've replaced the existing footprint with the library one, so the fabrication attrs
      // are already reset.  Just set the aUpdated flag if appropriate.
      if (aNew.GetAttributes() !== aExisting.GetAttributes()) aUpdated.value = true;
    } else {
      aNew.SetAttributes(aExisting.GetAttributes());
    }

    if (resetClearanceOverrides) {
      if (aExisting.AllowSolderMaskBridges() !== aNew.AllowSolderMaskBridges())
        aUpdated.value = true;

      if (
        aExisting.GetLocalClearance() !== aNew.GetLocalClearance() ||
        aExisting.GetLocalSolderMaskMargin() !== aNew.GetLocalSolderMaskMargin() ||
        aExisting.GetLocalSolderPasteMargin() !== aNew.GetLocalSolderPasteMargin() ||
        aExisting.GetLocalSolderPasteMarginRatio() !== aNew.GetLocalSolderPasteMarginRatio() ||
        aExisting.GetLocalZoneConnection() !== aNew.GetLocalZoneConnection()
      ) {
        aUpdated.value = true;
      }
    } else {
      aNew.SetLocalClearance(aExisting.GetLocalClearance());
      aNew.SetLocalSolderMaskMargin(aExisting.GetLocalSolderMaskMargin());
      aNew.SetLocalSolderPasteMargin(aExisting.GetLocalSolderPasteMargin());
      aNew.SetLocalSolderPasteMarginRatio(aExisting.GetLocalSolderPasteMarginRatio());
      aNew.SetLocalZoneConnection(aExisting.GetLocalZoneConnection());
      aNew.SetAllowSolderMaskBridges(aExisting.AllowSolderMaskBridges());
    }

    if (reset3DModels) {
      // We've replaced the existing footprint with the library one, so the 3D models are
      // already reset.  Just set the aUpdated flag if appropriate.
      if (aNew.Models().length !== aExisting.Models().length) {
        aUpdated.value = true;
      } else {
        for (let ii = 0; ii < aNew.Models().length; ++ii) {
          if (!aNew.Models()[ii]!.equals(aExisting.Models()[ii]!)) {
            aUpdated.value = true;
            break;
          }
        }
      }
    } else {
      // Preserve model references and all embedded model data.
      aNew.Models().splice(0, aNew.Models().length, ...aExisting.Models().map((m) => m.clone()));

      for (const [name, file] of aExisting.GetEmbeddedFiles().EmbeddedFileMap()) {
        if (file.type !== FILE_TYPE.MODEL) continue;

        aNew.GetEmbeddedFiles().RemoveFile(name, true);
        aNew.GetEmbeddedFiles().AddFile(EMBEDDED_FILE.copyOf(file));
      }
    }

    // Updating other parameters
    aNew.SetPath(aExisting.GetPath());
    aNew.SetSheetfile(aExisting.GetSheetfile());
    aNew.SetSheetname(aExisting.GetSheetname());
    aNew.SetFilters(aExisting.GetFilters());
    aNew.SetStaticComponentClass(aExisting.GetComponentClass());

    if (aUpdated.value === false) {
      // Check pad shapes, graphics, zones, etc. for changes
      if (FootprintNeedsUpdate(aNew, aExisting, BOARD_ITEM.COMPARE_FLAGS.INSTANCE_TO_INSTANCE))
        aUpdated.value = true;
    }

    aCommit.Remove(aExisting);
    aCommit.Add(aNew);

    aNew.ClearFlags();
  }

  /**
   * `toolMgr->GetTool<BOARD_EDITOR_CONTROL>()->PlacingFootprint()`, which the
   * Footprint Library Browser asks before handing a footprint over.
   */
  PlacingFootprint(): boolean {
    return this.hooks.placingFootprint?.() ?? false;
  }

  /**
   * What `FOOTPRINT_VIEWER_FRAME::AddFootprintToPCB` does to this frame once
   * it has passed its two checks (`footprint_viewer_frame.cpp:735-779`). See
   * `footprint_viewer_frame.ts`'s `FOOTPRINT_VIEWER_PCB_TARGET`.
   */
  PlaceFootprintFromLibraryBrowser(aFpid: string, aFootprint: PcbFootprint): void {
    this.hooks.placeFootprintFromLibrary?.(aFpid, aFootprint);
  }

  override findDialogRects(): BOX2D[] {
    return this.hooks.findDialogRects();
  }

  protected override setViewCenter(aPos: Vec2, aObscuringScreenRects: readonly BOX2D[]): void {
    this.hooks.setViewCenter(aPos, aObscuringScreenRects);
  }

  /** `PCB_EDIT_FRAME::ResolveDRCExclusions` (pcb_edit_frame.cpp:1378). */
  ResolveDRCExclusions(aCreateMarkers: boolean): void {
    const commit = new BOARD_COMMIT(this);

    for (const marker of this.GetBoard()!.ResolveDRCExclusions(aCreateMarkers)) {
      if (marker.GetMarkerType() === MARKER_T.MARKER_DRAWING_SHEET) {
        const sheet = this.GetCanvas()?.GetDrawingSheet();

        if (sheet) marker.GetRCItem()!.SetItems(sheet);
      }

      commit.Add(marker);
    }

    commit.Push('', SKIP_UNDO | SKIP_SET_DIRTY);

    for (const marker of this.GetBoard()!.Markers()) {
      if (marker.GetSeverity() === RPT_SEVERITY_EXCLUSION)
        this.GetCanvas()?.GetView().Update(marker);
    }

    this.GetBoard()!.UpdateRatsnestExclusions();
  }

  override SetBoard(
    aBoard: BOARD | null,
    aBuildConnectivity: boolean | PROGRESS_REPORTER_LIKE | null = true,
    aReporter: PROGRESS_REPORTER_LIKE | null = null,
  ): void {
    // `SetBoard( BOARD*, PROGRESS_REPORTER* )` is `SetBoard( aBoard, true, aReporter )`
    if (typeof aBuildConnectivity !== 'boolean') {
      aReporter = aBuildConnectivity;
      aBuildConnectivity = true;
    }

    if (this.m_pcb) this.m_pcb.ClearProject();

    super.SetBoard(aBoard, aReporter);

    aBoard!.SetProject(this.Prj());

    if (aBuildConnectivity) aBoard!.BuildConnectivity();

    // reload the drawing-sheet: SetPageSettings( aBoard->GetPageSettings() ) is the window's
    // UpdateVariantSelectionCtrl(): the toolbar's
  }

  /**
   * `PCB_EDIT_FRAME::OnBoardLoaded` (pcb_edit_frame.cpp:1933): the layer
   * names into the PCB_LAYER_ID enum map (canonical and user), the DRC engine
   * initialised on the project's rules, the clearance cache filled. The rules
   * file arrives as its text (`GetDesignRulesPath()` is the caller's), null
   * when the project has none; a PARSE_ERROR stays quiet, as upstream's does.
   * The WRL-to-STEP migration below it is the 3D viewer's.
   */
  OnBoardLoaded(aRulesText: string | null, aRulesPath = ''): void {
    this.m_designRulesText = aRulesText;
    this.m_designRulesPath = aRulesPath;

    const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');

    layerEnum.Choices().Clear();
    layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);

    for (const layer of LSET.AllLayersMask()) {
      // Canonical name
      layerEnum.Map(layer, LSET.Name(layer));

      // User name
      layerEnum.Map(layer, this.GetBoard()!.GetLayerName(layer));
    }

    const drcEngine = this.GetBoard()!.GetDesignSettings().m_DRCEngine;

    try {
      drcEngine?.InitEngine(aRulesText, aRulesPath);
    } catch (e) {
      // Not sure this is the best place to tell the user their rules are buggy, so
      // we'll stay quiet for now.  Feel free to revisit this decision....
      if (!(e instanceof PARSE_ERROR)) throw e;
    }

    this.GetBoard()!.InitializeClearanceCache();
  }

  /**
   * `PCB_EDIT_FRAME::SetActiveLayer( aLayer, aForceRedraw )` (pcb_edit_frame.cpp:1823):
   * the canvas half; the Appearance panel's `OnLayerChanged` is the window's,
   * through `activeLayerChanged`.
   */
  override SetActiveLayer(aLayer: PCB_LAYER_ID, aForceRedraw = false): void {
    const oldLayer = this.GetActiveLayer();

    if (oldLayer === aLayer && !aForceRedraw) return;

    super.SetActiveLayer(aLayer);

    this.hooks.activeLayerChanged?.(aLayer);

    this.m_toolManager?.PostAction(PCB_ACTIONS.layerChanged); // notify other tools

    const canvas = this.GetCanvas();

    if (!canvas) return;

    canvas.SetHighContrastLayer(aLayer);

    /*
     * Only show pad, via and track clearances when a copper layer is active
     * and then only show the clearance layer for that copper layer. For
     * front/back non-copper layers, show the clearance layer for the outer
     * layer on that side.
     *
     * For pads/vias, this is to avoid clutter when there are pad/via layers
     * that vary in flash (i.e. clearance from the hole or pad edge), padstack
     * shape on each layer or clearances on each layer.
     *
     * For tracks, this follows the same logic as pads/vias, but in theory could
     * have their own set of independent clearance layers to allow track clearance
     * to be shown for more layers.
     */
    const getClearanceLayerForActive = (aActiveLayer: PCB_LAYER_ID): number | null => {
      if (IsCopperLayer(aActiveLayer)) return CLEARANCE_LAYER_FOR(aActiveLayer);

      return null;
    };

    const oldClearanceLayer = getClearanceLayerForActive(oldLayer);

    if (oldClearanceLayer !== null) canvas.GetView().SetLayerVisible(oldClearanceLayer, false);

    const newClearanceLayer = getClearanceLayerForActive(aLayer);

    if (newClearanceLayer !== null) canvas.GetView().SetLayerVisible(newClearanceLayer, true);

    const contrastMode = this.GetDisplayOptions().m_ContrastModeDisplay;

    canvas.GetView().UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
      if (!aItem.IsBOARD_ITEM()) return 0;

      return PCB_EDIT_FRAME.activeLayerUpdateFlags(
        aItem as BOARD_ITEM,
        oldLayer,
        aLayer,
        contrastMode,
      );
    });

    canvas.Refresh();
  }

  /** `PCB_EDIT_FRAME::activeLayerUpdateFlags` (pcb_edit_frame.cpp:1881). */
  static activeLayerUpdateFlags(
    aItem: BOARD_ITEM,
    aOldLayer: PCB_LAYER_ID,
    aNewLayer: PCB_LAYER_ID,
    aContrastMode: HIGH_CONTRAST_MODE,
  ): number {
    // Note: KIGFX::REPAINT isn't enough for things that go from invisible to visible as they
    // won't be found in the view layer's itemset for re-painting.
    if (aContrastMode === HIGH_CONTRAST_MODE.HIDDEN) {
      if (aItem.IsOnLayer(aOldLayer) || aItem.IsOnLayer(aNewLayer)) return VIEW_UPDATE_FLAGS.ALL;
    }

    // High contrast dims by active layer so all flagged items repaint; without it only the flashed
    // copper geometry depends on the active layer, so re-cache just the items whose flashing changes.
    const highContrast = aContrastMode !== HIGH_CONTRAST_MODE.NORMAL;

    if (aItem instanceof PCB_VIA) {
      const via = aItem;

      if (
        via.GetViaType() === VIATYPE.BLIND ||
        via.GetViaType() === VIATYPE.BURIED ||
        via.GetViaType() === VIATYPE.MICROVIA
      ) {
        if (highContrast || via.GetLayerSet().test(aOldLayer) !== via.GetLayerSet().test(aNewLayer))
          return VIEW_UPDATE_FLAGS.REPAINT;
      }

      if (
        via.GetRemoveUnconnected() &&
        (highContrast || via.FlashLayer(aOldLayer) !== via.FlashLayer(aNewLayer))
      ) {
        return VIEW_UPDATE_FLAGS.ALL;
      }
    } else if (aItem instanceof PAD) {
      const pad = aItem;

      if (
        pad.GetRemoveUnconnected() &&
        (highContrast || pad.FlashLayer(aOldLayer) !== pad.FlashLayer(aNewLayer))
      ) {
        return VIEW_UPDATE_FLAGS.ALL;
      }
    }

    return 0;
  }

  GetName(): string {
    return PCB_EDIT_FRAME_NAME;
  }

  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }

  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.hooks.settings();
  }

  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }

  override OnModify(): void {
    super.OnModify();
    this.m_ZoneFillsDirty = true;
    this.hooks.onModify();
  }

  protected override ShowUndoRedoIncompleteMessage(): void {
    this.hooks.onUndoRedoIncomplete();
  }
}

applyMixins(PCB_EDIT_FRAME, [
  INITPCB_MIXIN,
  EDIT_MIXIN,
  FILES_MIXIN,
  EDIT_ZONE_HELPERS_MIXIN,
  PCBNEW_CONFIG_MIXIN,
  LOAD_SELECT_FOOTPRINT_MIXIN,
  PCB_DESIGN_BLOCK_UTILS_MIXIN,
]);

/**
 * The React side's BOARD_LISTENER: whatever the board reports, the view is
 * re-derived once, after the current commit or undo has finished — the
 * listener is invoked in the middle of both.
 */
export class REACT_BOARD_LISTENER extends BOARD_LISTENER {
  private pending = false;
  /**
   * The items the notifications since the last re-derivation named, so the
   * view keeps every other item's object (`boardFromBOARD`'s `aUnchanged`);
   * null once a notification named no items (net settings), which means
   * every item's view is re-derived.
   */
  private touched: Set<BOARD_ITEM> | null = new Set();

  constructor(private readonly refresh: (aUnchanged: ((k: BOARD_ITEM) => boolean) | null) => void) {
    super();
  }

  /** True between a notification and the re-derivation it scheduled. */
  IsPending(): boolean {
    return this.pending;
  }

  private note(aItems: readonly BOARD_ITEM[]): void {
    if (!this.touched) return;
    for (const item of aItems) {
      this.touched.add(item);
      // A footprint's children are viewed through the footprint.
      const fp = item.GetParentFootprint();
      if (fp) this.touched.add(fp);
    }
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      const touched = this.touched;
      this.touched = new Set();
      this.refresh(touched ? (k) => !touched.has(k) : null);
    });
  }

  override OnBoardItemAdded(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsAdded(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardItemRemoved(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsRemoved(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardItemChanged(_aBoard: BOARD, aBoardItem: BOARD_ITEM): void {
    this.note([aBoardItem]);
    this.schedule();
  }
  override OnBoardItemsChanged(_aBoard: BOARD, aBoardItems: BOARD_ITEM[]): void {
    this.note(aBoardItems);
    this.schedule();
  }
  override OnBoardCompositeUpdate(
    _aBoard: BOARD,
    aAddedItems: BOARD_ITEM[],
    aRemovedItems: BOARD_ITEM[],
    aChangedItems: BOARD_ITEM[],
  ): void {
    this.note(aAddedItems);
    this.note(aRemovedItems);
    this.note(aChangedItems);
    this.schedule();
  }
  override OnBoardNetSettingsChanged(_aBoard: BOARD): void {
    this.touched = null;
    this.schedule();
  }
}

// --- PCB_EDIT_FRAME::UpdateTitle (was frame_title.ts) ---

/** `_( "PCB Editor" )`, the half after the dash. */
export const PCB_FRAME_NAME = 'PCB Editor';

/**
 * `_( "3D Viewer" )` — `eda_3d_viewer_frame.cpp:634`, and row 12 of
 * `docs/frame-titles.md`.
 *
 * The child 3D frame names ITSELF. A parent only overrides that title by
 * passing `aTitle` to `PCB_BASE_FRAME::Update3DView` (pcb_base_frame.cpp:161),
 * and exactly two frames do: the Footprint Library Browser
 * (`footprint_viewer_frame.cpp:966`) and the Footprint Chooser
 * (`footprint_chooser_frame.cpp:392-398`), which both build
 * `_( "3D Viewer" ) + " — " + <footprint name>` — the frame name FIRST, the
 * reverse of every other frame.
 *
 * Neither of our two call sites is one of those. `PCB_EDIT_FRAME` and
 * `DISPLAY_FOOTPRINTS_FRAME` (`display_footprints_frame.cpp:417`) both call
 * `Update3DView` with no title at all, so upstream shows the bare frame name.
 * Ours prefixed the board or footprint name and an ASCII hyphen to both.
 */
export const VIEWER_3D_FRAME_NAME = '3D Viewer';

export interface PcbFrameTitleSpec {
  /**
   * The board's file name, extension included or not — this drops it, the way
   * `wxFileName::GetName()` does, along with any directory. Empty or absent is
   * the no-board case.
   */
  fileName?: string | null;
  /** `IsContentModified()`. */
  modified?: boolean;
  /**
   * `!fn.IsFileWritable()`. A browser has no per-file writable bit; the
   * condition that stands in for one here is the demo project, the same
   * substitution `SchematicEditor`'s `readOnly` prop documents.
   *
   * There is no `[Unsaved]` counterpart, for the reason the schematic's module
   * gives: upstream sets it from `!fn.FileExists()`, and a board in this app
   * exists in the project store from the moment it is opened, so the flag
   * would never be true.
   */
  readOnly?: boolean;
}

export function pcbFrameTitle(spec: PcbFrameTitleSpec): FrameTitleParts {
  const raw = spec.fileName?.trim() ?? '';
  // `wxFileName::GetName()` — the NAME half alone, no directory and no
  // extension. A leading dot is not an extension, so `.kicad_pcb` stays whole.
  const name = raw.split(/[/\\]/).filter(Boolean).pop() ?? '';
  const document = name.replace(/(?!^)\.[^./\\]*$/, '');

  return frameTitle({
    frameName: PCB_FRAME_NAME,
    document,
    modified: spec.modified,
    suffixes: spec.readOnly ? [READ_ONLY_SUFFIX] : [],
  });
}

// --- PROJECT::GetProjectFullName / PCB_EDIT_FRAME::GetDesignRulesPath over a file list (was project_settings.ts) ---

const PRO_RE = /\.kicad_pro$/i;

/** Path basename (project references store a bare file name). */
function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** The project's `.kicad_pro` (same pinning rule as the schematic side). */
export function findProjectPro(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const want = proBase ? `${proBase}.kicad_pro`.toLowerCase() : null;
  if (want) {
    const pinned = files.find(
      (f) => PRO_RE.test(f.name) && basename(f.name).toLowerCase() === want,
    );
    if (pinned) return pinned;
  }
  return files.find((f) => PRO_RE.test(f.name));
}

const PRL_RE = /\.kicad_prl$/i;

/** The project's `.kicad_prl` (PROJECT_LOCAL_SETTINGS), if it has ever written one. */
export function findProjectPrl(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const want = proBase ? `${proBase}.kicad_prl`.toLowerCase() : null;
  if (want) {
    const pinned = files.find(
      (f) => PRL_RE.test(f.name) && basename(f.name).toLowerCase() === want,
    );
    if (pinned) return pinned;
  }
  return files.find((f) => PRL_RE.test(f.name));
}

/** The custom-rules file KiCad pairs with a project:
 *  `<project>.kicad_dru` (FILEEXT::DesignRulesFileExtension). */
export function druFileName(proName: string): string {
  return proName.replace(/\.kicad_pro$/i, '.kicad_dru');
}

/** The project's `.kicad_dru`, resolved via its `.kicad_pro` sibling. */
export function findProjectDru(files: readonly RawFile[], proBase?: string): RawFile | undefined {
  const pro = findProjectPro(files, proBase);
  if (!pro) return undefined;
  const want = druFileName(pro.name).toLowerCase();
  return files.find((f) => f.name.toLowerCase() === want);
}

/** Local alias so code merged in from toggles.ts is unchanged. */
type PcbnewSettings = PCBNEW_JSON_SETTINGS_LIKE;

// --- PCB_EDIT_FRAME's left-toolbar toggle state (was toggles.ts) ---

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`pcbnew/toolbars_pcb_editor.cpp:164-177`), in upstream's own order. The
 * units group leads with millimetres here and with inches in eeschema
 * (`eeschema/toolbars_sch_editor.cpp:82-84`), so the order is per-frame data,
 * not a shared constant: it is what the button cycles through on click.
 *
 * The zone-display pair is not an upstream group — those two are separate
 * `AppendAction`s (`toolbars_pcb_editor.cpp:186-188`) — but they read one
 * `ZONE_DISPLAY_MODE`, so only one can be in force.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
  ['zoneDisplayFilled', 'zoneDisplayOutline'],
];

/**
 * What a fresh PCB_EDIT_FRAME shows, entry by entry:
 *
 * - `toggleGrid` — `window.grid.show`, default `true`
 *   (`common/settings/app_settings.cpp:555-556`).
 * - the units button — the `APP_SETTINGS_BASE` branch
 *   (`app_settings.cpp:228-238`). `PCBNEW_SETTINGS` passes the filename
 *   `"pcbnew"` (`pcbnew/pcbnew_settings.cpp:50`), which is on neither imperial
 *   name, so the board opens in millimetres.
 * - `crosshairSmall` — `m_crossHairMode( CROSS_HAIR_MODE::SMALL_CROSS )`
 *   (`common/gal/gal_display_options.cpp:52`).
 * - `lineModeFree` — `m_AngleSnapMode( LEADER_MODE::DIRECT )`
 *   (`pcbnew/pcbnew_settings.cpp:59`), which
 *   `BOARD_EDITOR_CONTROL::OnAngleSnapModeChanged` maps to
 *   `PCB_ACTIONS::lineModeFree` (`pcbnew/tools/board_editor_control.cpp:364`).
 *   **This was `lineMode90`**, which is the DEG90 arm — a mode the board editor
 *   never starts in. The footprint editor's own default is DEG45
 *   (`pcbnew/footprint_editor_settings.cpp:55`), so the three pcbnew-family
 *   frames disagree on purpose and none of them may be copied from a neighbour.
 * - `zoneDisplayFilled` — `m_ZoneDisplayMode = ZONE_DISPLAY_MODE::SHOW_FILLED`
 *   (`include/pcb_display_options.h:35`).
 * - `showLayersManager` — `aui.show_layer_manager`, default `true`
 *   (`pcbnew/pcbnew_settings.cpp:78-79`).
 * - `showProperties` — `aui.show_properties`, default `true`
 *   (`pcbnew/pcbnew_settings.cpp:110-111`).
 *
 * And one entry that is deliberately ABSENT: `ratsnestLineMode` is checked off
 * `m_Display.m_DisplayRatsnestLinesCurved` (`curvedRatsnestCond`,
 * `pcbnew/pcb_edit_frame.cpp:1150-1155`), whose default is `false`
 * (`pcb_display.ratsnest_curved`, `pcbnew/pcbnew_settings.cpp:258-259`). Ours
 * listed it, so a fresh board drew **curved** ratsnest lines where KiCad draws
 * straight ones.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('pcbnew'),
  'crosshairSmall',
  'lineModeFree',
  'zoneDisplayFilled',
  'showLayersManager',
  'showProperties',
]);

/**
 * Activating `id`, given what is currently on.
 *
 * A member of a radio group REPLACES its group — including itself, so
 * re-activating the member already on leaves it on rather than turning it off.
 * Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  const group = RADIO_GROUPS.find((g) => g.includes(id));

  if (group) {
    for (const g of group) next.delete(g);
    next.add(id);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}

/**
 * {@link DEFAULT_TOGGLES}, but with the three entries that have a stored value
 * taken FROM that value — `EDA_DRAW_FRAME::LoadSettings` reading
 * `m_Window.grid.show`, `m_Window.cursor.cross_hair_mode` and the frame's unit
 * back out of `pcbnew.json` on open (`common/eda_draw_frame.cpp`).
 *
 * Preferences > PCB Editor > Display Options edits the crosshair shape and the
 * Grids page the rest of `window.grid`; a frame that booted from a hardcoded
 * set would show a choice the canvas never took. `editors/drawingsheet/
 * toggles.ts`' `togglesFromSettings` is the same function for pl_editor.
 *
 * The other four entries stay literal because no key of `PcbnewSettings` backs
 * them yet — inventing one to derive them from would be the opposite of this.
 */
export function pcbTogglesFromSettings(cfg: PcbnewSettings): Set<string> {
  const out = new Set(DEFAULT_TOGGLES);

  out.delete('toggleGrid');
  if (cfg.window.grid.show) out.add('toggleGrid');

  for (const id of ['crosshairSmall', 'crosshairFull', 'crosshair45']) out.delete(id);
  out.add(crosshairToggleId(cfg.window.cursor.crosshair));

  // `PCB_EDIT_FRAME::LoadSettings` (`pcb_edit_frame.cpp:1739-1740`):
  // `m_ShowSearch = cfg->m_AuiPanels.show_search` and
  // `m_ShowNetInspector = cfg->m_AuiPanels.show_net_inspector`, which the
  // constructor's `.Show( m_ShowSearch )` / `.Show( m_ShowNetInspector )`
  // (:419-420) then applies. Data: neither is in DEFAULT_TOGGLES because both
  // default to false in `AUI_PANELS`.
  for (const id of ['showSearch', 'showNetInspector']) out.delete(id);
  if (cfg.aui.show_search) out.add('showSearch');
  if (cfg.aui.show_net_inspector) out.add('showNetInspector');

  // `curvedRatsnestCond` reads `m_Display.m_DisplayRatsnestLinesCurved`
  // (`pcbnew/pcb_edit_frame.cpp:1150-1155`), which Preferences > PCB Editor >
  // Editing Options is the other control over.
  out.delete('ratsnestLineMode');
  if (cfg.pcb_display.ratsnest_curved) out.add('ratsnestLineMode');

  // `BOARD_EDITOR_CONTROL::OnAngleSnapModeChanged` maps `m_AngleSnapMode` onto
  // one of the three Line mode buttons (`board_editor_control.cpp:360-368`), so
  // the toolbar group and Editing Options' "Constrain actions to H, V, 45
  // degrees" are ONE value.
  for (const id of ['lineModeFree', 'lineMode45', 'lineMode90']) out.delete(id);
  out.add(lineModeToggleId(cfg.editing.pcb_angle_snap_mode));

  return out;
}

/** `LEADER_MODE` -> the left toolbar's button id. DIRECT 0, DEG45 1, DEG90 2. */
export function lineModeToggleId(mode: number): string {
  return mode === 1 ? 'lineMode45' : mode === 2 ? 'lineMode90' : 'lineModeFree';
}

/** …and back. */
export function lineModeOf(id: string): 0 | 1 | 2 | null {
  if (id === 'lineModeFree') return 0;
  if (id === 'lineMode45') return 1;
  if (id === 'lineMode90') return 2;
  return null;
}

/** `CROSS_HAIR_MODE` -> the left toolbar's button id. */
export function crosshairToggleId(mode: CrosshairMode): string {
  return mode === 'full' ? 'crosshairFull' : mode === '45' ? 'crosshair45' : 'crosshairSmall';
}

/** …and back, for a click on one of the three. */
export function crosshairModeOf(id: string): CrosshairMode | null {
  if (id === 'crosshairFull') return 'full';
  if (id === 'crosshair45') return '45';
  if (id === 'crosshairSmall') return 'small';
  return null;
}

/**
 * Fold a toolbar activation back into `pcbnew.json`, so the button and
 * Preferences are one value rather than two that drift.
 *
 * `GAL_DISPLAY_OPTIONS`' setters write straight through to the settings object
 * upstream — `PCB_BASE_FRAME::SaveSettings` then persists it — which is why
 * flipping the crosshair from the toolbar and reopening Preferences shows the
 * new shape selected. Returns true when it took the click, so the caller knows
 * not to treat it as canvas-only state.
 */
export function foldPcbToggle(cfg: PcbnewSettings, id: string): boolean {
  const mode = crosshairModeOf(id);

  if (mode !== null) {
    cfg.window.cursor.crosshair = mode;
    return true;
  }

  const line = lineModeOf(id);

  if (line !== null) {
    cfg.editing.pcb_angle_snap_mode = line;
    return true;
  }

  if (id === 'toggleGrid') {
    cfg.window.grid.show = !cfg.window.grid.show;
    return true;
  }

  if (id === 'ratsnestLineMode') {
    cfg.pcb_display.ratsnest_curved = !cfg.pcb_display.ratsnest_curved;
    return true;
  }

  if (id === 'togglePolarCoords') {
    cfg.editing.polar_coords = !cfg.editing.polar_coords;
    return true;
  }

  // `PCB_EDIT_FRAME::ToggleSearch` / `ToggleNetInspector`
  // (`toolbars_pcb_editor.cpp:774-850`) and `SaveSettings` (`pcb_edit_frame.cpp:
  // 1765-1776`), which writes the pane's shown state to `m_AuiPanels`.
  if (id === 'showSearch') {
    cfg.aui.show_search = !cfg.aui.show_search;
    return true;
  }

  if (id === 'showNetInspector') {
    cfg.aui.show_net_inspector = !cfg.aui.show_net_inspector;
    return true;
  }

  return false;
}

/** Whether {@link foldPcbToggle} would write the file for this id. */
export function isStoredPcbToggle(id: string): boolean {
  return (
    crosshairModeOf(id) !== null ||
    lineModeOf(id) !== null ||
    id === 'toggleGrid' ||
    id === 'ratsnestLineMode' ||
    id === 'togglePolarCoords' ||
    id === 'showSearch' ||
    id === 'showNetInspector'
  );
}
