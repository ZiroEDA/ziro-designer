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
import { PARSE_ERROR } from '@ziroeda/common/dsnlexer.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import {
  CLEARANCE_LAYER_FOR,
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
import type { BOARD_ITEM } from './board_item.js';
import type { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import { BOARD_LISTENER } from './board.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { PAD } from './pad.js';
import { PCB_VIA, VIATYPE } from './pcb_track.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import { PCB_BASE_EDIT_FRAME } from './pcb_base_edit_frame.js';
import { STRTOK, strncpyLine } from '@ziroeda/common/libc/string.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from './pcb_base_frame.js';
import { type AUI_PANELS, PCBNEW_SETTINGS } from './pcbnew_settings.js';
import { BOARD_COMMIT, SKIP_SET_DIRTY, SKIP_UNDO } from './board_commit.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_FIELD } from './pcb_field.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { ZONE } from './zone.js';
import type { wxTextValidator } from '@ziroeda/common/validators.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { MICROWAVE_TOOL, type MICROWAVE_HOST } from './microwave/microwave_tool.js';
import type { Board, PcbFootprint } from './types.js';
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
import { EDIT_TOOL, type MOVE_EXACT_VALUES, type ROUTER_TOOL_LIKE } from './tools/edit_tool.js';
import type { DOGBONE_PARAMETERS } from './tools/item_modification_routine.js';
import { ALIGN_DISTRIBUTE_TOOL } from './tools/align_distribute_tool.js';
import { BOARD_INSPECTION_TOOL } from './tools/board_inspection_tool.js';
import { POSITION_RELATIVE_TOOL } from './tools/position_relative_tool.js';
import type { DIALOG_POSITION_RELATIVE } from './dialogs/dialog_position_relative.js';
import type { DIALOG_OFFSET_ITEM } from './dialogs/dialog_offset_item.js';
import { PAD_TOOL } from './tools/pad_tool.js';
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
  /** `DIALOG_EXCHANGE_FOOTPRINTS( frame, footprint, updateMode, true ).ShowQuasiModal()`. */
  showExchangeFootprintsDialog(aFootprint: FOOTPRINT, aUpdateMode: boolean): void;
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
   * `ZONE_FILLER( board, nullptr ).Fill( aZones )` for the Zone Manager's
   * "Update Displayed Zones": the pour of the clones, with the board's zone
   * list swapped for them. The pour is the window's (it is still view based);
   * true when it ran to the end. Optional: absent answers false.
   */
  fillZones?(aBoard: BOARD, aZones: ZONE[]): boolean;
  /**
   * `DIALOG_ZONE_MANAGER( editFrame ).ShowQuasiModal()`: true for wxID_OK,
   * with `GetRepourOnClose()`. Optional: absent answers cancel.
   */
  showZoneManager?(): Promise<{ ok: boolean; repour: boolean }>;
  /** `PCB_ACTIONS::zoneFillAll`. */
  fillAllZones?(): void;
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
  /**
   * TRANSITIONAL (#636 stage 3): the window's view board, which PCB_GRID_HELPER
   * still computes its anchors from (`GetTransitionalBoardView`).
   */
  boardView?(): Board | null;
  /**
   * TRANSITIONAL (#636 stage 3): ROUTER_TOOL's state, while the router is the
   * window's (`WINDOW_ACTION_BRIDGE::Router`).
   */
  router?(): ROUTER_TOOL_LIKE | null;
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

  /** `DIALOG_TABLE_PROPERTIES( frame, table ).ShowQuasiModal()`: the table's edit request. */
  ShowTablePropertiesDialog(aTable: PCB_TABLE): Promise<void> {
    this.OnEditItemRequest(aTable);
    return Promise.resolve();
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
  OpenVertexEditor(aItem: BOARD_ITEM): void {
    this.hooks.openVertexEditor?.(aItem);
  }

  /** TRANSITIONAL (#636 stage 3): see the `boardView` hook. */
  GetTransitionalBoardView(): Board | null {
    return this.hooks.boardView?.() ?? null;
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

  /** `MICROWAVE_TOOL` (`pcbnew.MicrowaveTool`): built on first use, over this frame. */
  private m_microwaveTool: MICROWAVE_TOOL | null = null;

  /**
   * `GetToolManager()->GetTool<MICROWAVE_TOOL>()`. The tool asks this frame for
   * what its C++ asks `PCB_EDIT_FRAME` for: the dialogs, the current track
   * width, unit conversion, a blank footprint on this board and the commit.
   */
  MicrowaveTool(): MICROWAVE_TOOL {
    if (!this.m_microwaveTool) {
      const host: MICROWAVE_HOST = {
        GetCurrentTrackWidth: () => this.GetDesignSettings().GetCurrentTrackWidth(),
        StringFromValue: (aIU) => this.GetUnitsProvider().StringFromValue(aIU),
        ValueFromString: (aText) => this.GetUnitsProvider().ValueFromString(aText),
        CreateNewFootprint: (aName, aLib) => this.CreateNewFootprint(aName, aLib),
        OnModify: () => this.OnModify(),
        ShowInfoBarError: (aMessage) => this.ShowInfoBarError(aMessage),
        DisplayError: (aMessage) => DisplayErrorMessage(aMessage),
        TextEntry: (aPrompt, aCaption, aValue, aValidator) =>
          this.hooks.textEntry?.(aPrompt, aCaption, aValue, aValidator) ?? Promise.resolve(null),
        PolygonShapeDialog: () =>
          this.hooks.mwavePolygonalShapeDialog?.() ?? Promise.resolve(false),
        AddInductor: (aFootprint) => {
          this.m_toolManager!.RunAction<EDA_ITEM | null>(ACTIONS.selectItem, aFootprint);

          const commit = new BOARD_COMMIT(this);
          commit.Add(aFootprint);
          commit.Push('Add Microwave Inductor');
        },
      };

      this.m_microwaveTool = new MICROWAVE_TOOL(host);
    }

    return this.m_microwaveTool;
  }

  /**
   * `doInteractiveItemPlacement`'s left click on an item riding the cursor:
   * `aPlacer->PlaceItem( newBoardItem, commit )` is `commit.Add( aItem )`, then
   * `commit.Push( aCommitMessage )`. The item is at the click already.
   */
  PlaceInteractiveItem(aItem: FOOTPRINT, aCommitMessage: string): void {
    aItem.ClearFlags();

    const commit = new BOARD_COMMIT(this);
    commit.Add(aItem);
    commit.Push(aCommitMessage);
  }

  /** The window half of `ZONE_FILLER::Fill` over clones: see {@link PCB_EDIT_FRAME_HOOKS.fillZones}. */
  FillZones(aBoard: BOARD, aZones: ZONE[]): boolean {
    return this.hooks.fillZones?.(aBoard, aZones) ?? false;
  }

  /**
   * `GLOBAL_EDIT_TOOL::ZonesManager` (global_edit_tool.cpp:240-290), run by
   * Tools > Zone Manager..., the toolbar's zone menu and the Copper Zones
   * dialog's "Open Zone Manager..." button.
   *
   * The dialog edits clones and writes them over the board's zones on OK, so
   * what is left is what the tool does after it: deselect, `OnModify()` (which
   * clears the zone bounding-box caches), update the zones in the view, rebuild
   * the connectivity, and the refill when the box was ticked. Upstream's
   * `BOARD_COMMIT` is populated with `Modify( zone )` and never pushed, so the
   * change files no undo entry.
   */
  async ZonesManager(): Promise<void> {
    const board = this.GetBoard();

    if (!board || !this.hooks.showZoneManager) return;

    const commit = new BOARD_COMMIT(this);

    for (const zone of board.Zones()) commit.Modify(zone);

    const { ok, repour } = await this.hooks.showZoneManager();

    if (!ok) return;

    // "Ensure all zones are deselected before make any change in view"
    this.m_toolManager!.RunAction(ACTIONS.selectionClear);

    this.OnModify();

    for (const zone of board.Zones()) this.GetCanvas()?.GetView().Update(zone);

    // The board's listeners hear the zones changed (the view re-derives), then rebuild connectivity.
    board.OnItemsChanged([...board.Zones()]);
    board.BuildConnectivity();

    if (repour) this.hooks.fillAllZones?.();
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
    this.m_toolManager.RegisterTool(new EDIT_TOOL());
    this.m_toolManager.RegisterTool(new PAD_TOOL());
    this.m_toolManager.RegisterTool(new PCB_POINT_EDITOR());
    this.m_toolManager.RegisterTool(new BOARD_INSPECTION_TOOL());
    this.m_toolManager.RegisterTool(new ALIGN_DISTRIBUTE_TOOL());
    this.m_toolManager.RegisterTool(new POSITION_RELATIVE_TOOL());
    this.m_toolManager.RegisterTool(new DRC_TOOL());
    this.m_toolManager.RegisterTool(new CONVERT_TOOL());
    this.m_toolManager.RegisterTool(new PCB_GROUP_TOOL());
    this.m_toolManager.RegisterTool(new PROPERTIES_TOOL());
    this.m_toolManager.RegisterTool(new EMBED_TOOL());
    this.m_toolManager.RegisterTool(new PCB_PICKER_TOOL());
    this.m_toolManager.RegisterTool(
      new WINDOW_ACTION_BRIDGE(
        (aAction, aEvent) => this.hooks.windowAction?.(aAction, aEvent),
        () => this.hooks.router?.() ?? null,
      ),
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

  ShowExchangeFootprintsDialog(aFootprint: FOOTPRINT, aUpdateMode: boolean): void {
    this.hooks.showExchangeFootprintsDialog(aFootprint, aUpdateMode);
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
   * the canvas half. The Appearance panel's `OnLayerChanged` is the React
   * state's, and `PCB_ACTIONS::layerChanged` is stage 3's.
   */
  override SetActiveLayer(aLayer: PCB_LAYER_ID, aForceRedraw = false): void {
    const oldLayer = this.GetActiveLayer();

    if (oldLayer === aLayer && !aForceRedraw) return;

    super.SetActiveLayer(aLayer);

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

// --- PCB_EDIT_FRAME's grid + snap arithmetic (was pcb_grid.ts) ---

/**
 * Where the grid is, and how a point snaps onto it.
 *
 * A board carries its own grid origin — `(setup (grid_origin x y))`,
 * `BOARD_DESIGN_SETTINGS::GetGridOrigin` — and pcbnew installs it on the GAL the
 * moment a board is opened (`pcb_base_edit_frame.cpp`:
 * `GetGAL()->SetGridOrigin( aBoard->GetDesignSettings().GetGridOrigin() )`).
 * Everything that touches the grid then works relative to it: `CAIRO_GAL_BASE::
 * DrawGrid` offsets every dot by `m_gridOrigin`, and `GRID_HELPER::AlignGrid`
 * rounds about `GRID_HELPER::GetOrigin()`, which reads the same value back off
 * the GAL.
 *
 * We had it hardcoded to (0, 0) in both places. That is invisible on a board
 * whose origin happens to be a whole number of grid steps from the world origin
 * — most of them, which is why it survived — and plainly wrong on one where it
 * is not: the dots sit at a fixed fraction of a step away from every track and
 * pad that KiCad placed on them.
 *
 * Lives in its own module rather than in `PcbEditor.tsx` so the qa package can
 * typecheck it; qa's tsc has no `--jsx`, so anything imported from a `.tsx`
 * fails the workspace typecheck even though vitest runs it happily.
 */

/** A point in internal units. */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * `EDIT_TOOL::Move`'s movement, for one frame (edit_tool_move_fct.cpp:1144-1177).
 *
 *     m_cursor = grid.BestSnapAnchor( mousePos, layers, selectionGrid, sel_items );
 *     movement = m_cursor - prevPos;
 *     …
 *     prevPos  = m_cursor;
 *
 * `prevPos` is seeded to the drag origin — `grid.BestDragOrigin(…)`, an anchor
 * *on the selection*, with the pointer warped onto it (:1311-1351). Summed over
 * the gesture the telescoping leaves `anchor + Σmovement = BestSnapAnchor(…)`,
 * so what is really being placed is the **anchor**, absolutely, at the snapped
 * cursor. That is the whole of why two parts dragged in KiCad line up with each
 * other: each one's anchor lands on a grid node rather than keeping whatever
 * fraction of a grid step it had.
 *
 * `snap` is `BestSnapAnchor`, taken as an argument because it needs the board,
 * the view scale and the moving items to skip — none of which this arithmetic
 * has any business knowing.
 *
 * The browser cannot warp the pointer. It does not need to: with the warp,
 * upstream's `mousePos` is the anchor plus the pointer's motion since the grab,
 * which is what the first line reconstructs. Called with `anchor === grabOrigin`
 * — a selection that offers no anchor at all, where `BestDragOrigin` returns the
 * mouse position — it degenerates to exactly upstream's own answer for that case.
 */
export function moveDelta(
  anchor: GridPoint,
  grabOrigin: GridPoint,
  cursor: GridPoint,
  snap: (p: GridPoint) => GridPoint,
): GridPoint {
  const to = snap({
    x: anchor.x + (cursor.x - grabOrigin.x),
    y: anchor.y + (cursor.y - grabOrigin.y),
  });

  return { x: to.x - anchor.x, y: to.y - anchor.y };
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
