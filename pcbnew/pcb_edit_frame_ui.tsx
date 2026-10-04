// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB Editor: the pcbnew frame replicated, menu bar (menubar_pcb_editor.cpp),
 * top/left/right toolbars (toolbars_pcb_editor.cpp), the docked Appearance
 * manager with Layers / Objects / Nets tabs and layer presets
 * (widgets/appearance_controls.cpp), the Selection Filter panel, and the
 * PCB_PAINTER canvas (renderBoard.ts). Board editing tools are staged; the
 * viewer pipeline, layer/object controls and presets are fully functional.
 */

import { ParseFootprintFile } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PcbScriptApi } from './pcb_script_api.js';
import { routeHeadless } from './router/route_headless.js';
import { PnsDesignSettingsFromBds } from './router/pns_kicad_iface.js';
import { DEFAULT_UPDATE_PCB_OPTIONS } from './dialogs/dialog_update_pcb.js';
import { type ARC_EDIT_MODE, FRAME_T } from '@ziroeda/common/frame_type.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import type { PCBNEW_APP } from './browser/pcbnew_app.js';
import { jsonFileWildcard, reportFileWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import { type ChooserFilter, WxFileDialog } from '@ziroeda/common/wx/filedlg.js';
import { KICTL_NONKICAD_ONLY } from '@ziroeda/common/kiway_player.js';
import { DialogAssignNetclass } from '@ziroeda/common/dialogs/dialog_assign_netclass.js';
import { EDA_VIEW_SWITCHER } from '@ziroeda/common/dialogs/eda_view_switcher.js';
import { WxTextEntryDialog } from '@ziroeda/common/wx/textdlg.js';
import { WX_TEXT_ENTRY_DIALOG } from '@ziroeda/common/dialogs/dialog_text_entry.js';
import { Pgm, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { PCBNEW_SETTINGS } from './pcbnew_settings.js';
import { PCB_IU_PER_MM } from '@ziroeda/common/eda_units.js';
import {
  drawSelectionArea,
  isBackgroundDark,
  selectionAreaColors,
} from '@ziroeda/common/preview_items/selection_area.js';
import { DialogRuleAreaProperties } from './dialogs/dialog_rule_area_properties_ui.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import { PROF_TIMER, traceAllegroPerf, wxLogTrace } from '@ziroeda/common/trace_helpers.js';
import {
  collectPlacementSources,
  DIALOG_RULE_AREA_PROPERTIES,
  type RuleAreaValues,
} from './dialogs/dialog_rule_area_properties.js';
import { zoomFitScale } from '@ziroeda/common/ui/view_controls.js';
import { DockSash } from '@ziroeda/common/widgets/wx_aui_sash.js';
import { onOutlineFontsChanged } from '@ziroeda/common/font/outline_fonts.js';
import {
  applyCanvasSize,
  canvasBackingSize,
  isMeasured,
} from '@ziroeda/common/widgets/canvas_size.js';
import { appearanceNetRows } from './widgets/appearance_controls.js';
import { useStatusReadout } from '@ziroeda/common/use_status_readout.js';

/**
 * `BASE_SCREEN::m_LocalOrigin`, the point pane 3's dx/dy/dist measures from.
 * A module constant so its identity is stable across renders.
 */
const PCB_LOCAL_ORIGIN = { x: 0, y: 0 };
import { boardToolCursor } from './cursors.js';
import { pickerSnapsToGridOnly } from './tools/pcb_picker_tool.js';
import { appearanceLayerRows } from './widgets/appearance_controls.js';
import {
  ZOOM_AUTO_LABEL,
  ZOOM_LIST,
  isZoomSelectPreset,
  zoomSelectLabel,
} from '@ziroeda/common/settings/zoom_settings.js';

import type { FitType } from '@ziroeda/common/ui/view_controls.js';
import { pcbIUScale, pcbIuToMM as iuToMM } from '@ziroeda/common';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { parse } from '@ziroeda/sexpr';
import {
  readBoard,
  serializeBoard,
  serializeBoardAsync,
  type Board,
  type PcbFootprint,
  type SelectionFilter,
  BOARD_NETLIST_UPDATER,
  type NETLIST,
  type ImageValues,
} from './index.js';
import {
  barcodePreview,
  DIALOG_BARCODE_PROPERTIES,
  type BarcodePreview,
  type BarcodeValues,
} from './dialogs/dialog_barcode_properties.js';
import { DialogBarcodeProperties } from './dialogs/dialog_barcode_properties_ui.js';
import { DialogImportGraphics } from './import_gfx/dialog_import_graphics.js';
import { IsCopperLayer } from '@ziroeda/common/layer_ids.js';
import type { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { useHotkeyCyclePopup } from '@ziroeda/common/dialogs/hotkey_cycle_popup_ui.js';
import type { WX_INFOBAR, WX_INFOBAR_HYPERLINK } from '@ziroeda/common/eda_base_frame.js';
import { buildPcbMenus } from './menubar_pcb_editor.js';
import { itemHasEditableCorners } from './tools/edit_tool.js';
import { DialogDimensionProperties } from './dialogs/dialog_dimension_properties_ui.js';
import { DialogTextBoxProperties } from './dialogs/dialog_textbox_properties_ui.js';
import { DialogReferenceImageProperties } from './dialogs/dialog_reference_image_properties_ui.js';
import { DialogTableProperties } from '@ziroeda/common/dialogs/dialog_table_properties.js';
import { DIALOG_TABLE_PROPERTIES, type TableValues } from './dialogs/dialog_table_properties.js';
import {
  DIALOG_TEXTBOX_PROPERTIES,
  type TextBoxValues,
} from './dialogs/dialog_textbox_properties.js';

// Transitional (#636 stage 3): the bridge between the live BOARD and the legacy id selection;
// PCB_SELECTION_TOOL holds items directly, so this goes away with that stage.
// Seam between the live `BOARD` the docked panes work on and the editor's selection, which is a set of
// `${kind}:${index}` ids over the legacy `Board` view (`edit-board.ts`). `PCB_SEARCH_PANE`'s hitlist and
// `PCB_VERTEX_EDITOR_PANE`'s item are `BOARD_ITEM`s; every legacy item carries the live one as `k`.
/** The id of the legacy item that wraps `aItem`, or null when the view has none. */
/** KiCad's pane names (`PCB_EDIT_FRAME::SearchPaneName` and friends), as the window's toggle ids. */
const PANE_TOGGLE_IDS: Readonly<Record<string, string>> = {
  LayersManager: 'showLayersManager',
  PropertiesManager: 'showProperties',
  Search: 'showSearch',
  NetInspector: 'showNetInspector',
};

/**
 * What `PCB_VERTEX_EDITOR_PANE` asks its `m_frame` (`PCB_BASE_EDIT_FRAME`,
 * `vertex_editor_pane.cpp`): the units, the origin, `BOARD_COMMIT commit( m_frame )`,
 * the canvas refresh, and `OnVertexEditorPaneClosed`.
 */
export function makeVertexEditorFrame(
  aFrame: PCB_BASE_EDIT_FRAME,
  aRefresh: () => void,
  aOnClosed: (aPane: PCB_VERTEX_EDITOR_PANE) => void,
): VertexEditorFrame {
  return {
    GetUnitsProvider: () => aFrame.GetUnitsProvider(),
    GetOriginTransforms: () => aFrame.GetOriginTransforms(),
    NewCommit: () => new BOARD_COMMIT(aFrame),
    RefreshItem: () => aRefresh(),
    OnVertexEditorPaneClosed: aOnClosed,
  };
}

/** What the window still supplies to the search handlers: the net highlight and Board Setup. */
export interface PcbSearchWiringDeps {
  /** `RENDER_SETTINGS::SetHighlight`, then `UpdateAllLayersColor()`. */
  highlightNets(aNetCodes: readonly number[]): void;
  /** `m_frame->ShowBoardSetupDialog( aInitialPage )`. */
  showBoardSetupDialog(aInitialPage: string): void;
}

/**
 * {@link PcbSearchWiring}: `PCB_SEARCH_HANDLER`'s `m_frame->GetToolManager()`
 * calls (search_handlers.cpp:42-48, 103-134) on the frame's tool manager.
 */
export function makePcbSearchWiring(
  aFrame: () => PCB_EDIT_FRAME | null,
  aDeps: PcbSearchWiringDeps,
): PcbSearchWiring {
  const run = (aAction: TOOL_ACTION, aParam?: unknown): void => {
    aFrame()
      ?.GetToolManager()
      ?.RunAction(aAction, aParam as never);
  };

  return {
    clearSelection: () => run(ACTIONS.selectionClear),
    selectItems: (aItems) => run(ACTIONS.selectItems, [...aItems]),
    centerSelection: () => run(ACTIONS.centerSelection),
    zoomFitSelection: () => run(ACTIONS.zoomFitSelection),
    refresh: () => aFrame()?.GetCanvas()?.Refresh(false),
    properties: () => run(PCB_ACTIONS.properties),
    highlightNets: (aNetCodes) => aDeps.highlightNets(aNetCodes),
    showBoardSetupDialog: (aPage) => aDeps.showBoardSetupDialog(aPage),
  };
}

import {
  DIALOG_DIMENSION_PROPERTIES,
  type DimensionValues,
} from './dialogs/dialog_dimension_properties.js';
import { Reporter, type ReportLine } from '@ziroeda/common';
import { MenuBar, ContextMenu, type Menu } from '@ziroeda/common/tool/action_menu_bar.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { layerBoxLabel } from './pcb_layer_box_selector.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import { formatTitle, useDocumentTitle } from '@ziroeda/common/use_document_title.js';
import { PCB_FRAME_NAME, pcbFrameTitle, type PCB_EDIT_FRAME_HOOKS } from './pcb_edit_frame.js';
import { withSaveEnablement } from '@ziroeda/common/save_enablement.js';
import {
  DialogPasteSpecial,
  type PasteSpecialMode,
} from '@ziroeda/common/dialogs/dialog_paste_special.js';
import { KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import { MsgPanel, type MsgPanelItem } from '@ziroeda/common/widgets/msgpanel_ui.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import {
  gridMsg,
  messageTextFromValue,
  scaleForZoomFactor,
  type StatusUnits,
  unitsMsg,
  unitText,
  zoomFactorForScale,
  zoomMsg,
} from '@ziroeda/common/widgets/kistatusbar_format.js';
import { DialogPcbFind } from './dialogs/dialog_find_ui.js';
import type { DIALOG_FIND } from './dialogs/dialog_find.js';
import { DialogPageSettings } from '@ziroeda/common/dialogs/dialog_page_settings.js';
import { pageSettingsValue, toPaperToken } from '@ziroeda/common/dialogs/dialog_page_settings.js';
import { type ExtentsBox, pcbZoomFitBox } from './pcb_base_frame.js';
import { DialogPcbPrint } from './dialogs/dialog_print_pcbnew_ui.js';
import type { DIALOG_PRINT_PCBNEW } from './dialogs/dialog_print_pcbnew.js';
import { wxPrinter } from '@ziroeda/common/wx/printer.js';
import { MessageDialogError, MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import { DialogPcbPlot } from './dialogs/dialog_plot.js';
import {
  DialogBoardSetup,
  defaultBoardSetup,
  type BoardSetupValues,
  type PageId as BoardSetupPageId,
} from './dialogs/dialog_board_setup.js';
import {
  druFileName,
  findProjectDru,
  findProjectPro,
  type PCBNEW_JSON_SETTINGS_LIKE,
} from './pcb_edit_frame.js';
import { BoardSetupFromWindow, BoardSetupToWindow } from './dialogs/board_setup_transfer.js';
import { DumpJson } from '@ziroeda/common/settings/json_dump.js';
import type { BOARD } from './board.js';
import { DialogDrc } from './dialogs/dialog_drc.js';
import { DialogUpdatePcb, type UpdatePcbOptions } from './dialogs/dialog_update_pcb.js';
import { DialogGlobalEditTeardrops } from './dialogs/dialog_global_edit_teardrops_ui.js';
import { BuildBomTextFromBoard } from './build_BOM_from_board.js';
import { DialogBoardStatistics } from './dialogs/dialog_board_statistics.js';
import { DialogFilterSelection } from './dialogs/dialog_filter_selection_ui.js';
import { type MOVE_EXACT_VALUES, ROTATION_ANCHOR } from './tools/edit_tool.js';
import type { DOGBONE_PARAMETERS } from './tools/item_modification_routine.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import type { BOX2I as KBOX2I } from '@ziroeda/kimath/src/math/box2.js';

/** `ROTATION_ANCHOR` in DIALOG_MOVE_EXACT's order, as the dialog names them. */
const ROTATION_ANCHOR_NAMES = ['itemAnchor', 'selectionCenter', 'userOrigin', 'auxOrigin'] as const;
import type { GATED_DISPATCHER, WINDOW_ACTION_HANDLER } from './tools/window_action_bridge.js';
import type { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { actionMenuItems } from '@ziroeda/common/tool/action_menu_popup.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { wxMenuEvent, wxMenuEventType } from '@ziroeda/common/wx/menu.js';
import { clientPosition, wxKeyEventFromDom } from '@ziroeda/common/wx/dom_events.js';
import {
  type wxEvent,
  wxEVT_CHAR,
  wxEVT_CHAR_HOOK,
  wxKeyEvent,
  wxMouseEvent,
} from '@ziroeda/common/wx/wx_event.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { DialogMoveExact, type MoveExactValues } from './dialogs/dialog_move_exact_ui.js';
import { WX_UNIT_ENTRY_DIALOG } from '@ziroeda/common/dialogs/dialog_unit_entry.js';
import { WX_MULTI_ENTRY_DIALOG } from '@ziroeda/common/dialogs/dialog_multi_unit_entry.js';
import { DialogCreateArray } from './dialogs/dialog_create_array_ui.js';
import {
  DEFAULT_ARRAY_SETTINGS,
  arraySpecFrom,
  type ArraySettings,
} from './dialogs/dialog_create_array.js';
import { DialogOutsetItems } from './dialogs/dialog_outset_items_ui.js';
import { DIALOG_OUTSET_ITEMS } from './dialogs/dialog_outset_items.js';
import { CONVERT_SETTINGS_DIALOG } from './tools/convert_settings_dialog.js';
import { ConvertSettingsDialog } from './tools/convert_settings_dialog_ui.js';
import type { OUTSET_PARAMETERS } from './tools/item_modification_routine.js';
import type { CONVERT_SETTINGS } from './pcbnew_settings.js';
import type { ZONE_SETTINGS } from './zone_settings.js';
import { DialogPnsSettings } from './dialogs/dialog_pns_settings.js';
import {
  DialogPnsDiffPairDimensions,
  type DiffPairDimensionsValue,
} from './dialogs/dialog_pns_diff_pair_dimensions.js';
import { type CustomTrackViaSize, DialogTrackViaSize } from './dialogs/dialog_track_via_size.js';
import type { RoutingSettings } from './router/pns_routing_settings.js';
import { DialogPositionRelativeModeless } from './dialogs/dialog_position_relative_ui.js';
import type { DIALOG_POSITION_RELATIVE } from './dialogs/dialog_position_relative.js';
import { DialogOffsetItem } from './dialogs/dialog_offset_item_ui.js';
import { DialogSwapLayers } from './dialogs/dialog_swap_layers_ui.js';
import { choiceOf } from './grid_layer_box_helpers.js';
import { DialogCleanupTracksAndVias } from './dialogs/dialog_cleanup_tracks_and_vias_ui.js';
import { DialogCleanupGraphics } from './dialogs/dialog_cleanup_graphics_ui.js';
import { DialogUnusedPadLayers } from './dialogs/dialog_unused_pad_layers_ui.js';
import { DialogGlobalDeletion } from './dialogs/dialog_global_deletion_ui.js';
import { DialogGlobalEditTracksAndVias } from './dialogs/dialog_global_edit_tracks_and_vias_ui.js';
import { DialogExchangeFootprints } from './dialogs/dialog_exchange_footprints_ui.js';
import { DialogNonCopperZonesProperties } from './dialogs/dialog_non_copper_zones_properties_ui.js';
import type { PCB_TABLE } from './pcb_table.js';
import { DIALOG_NON_COPPER_ZONES_EDITOR } from './dialogs/dialog_non_copper_zones_properties.js';
import type { DIALOG_EXCHANGE_FOOTPRINTS } from './dialogs/dialog_exchange_footprints.js';
import {
  DialogGlobalEditTextAndGraphics,
  type LAYER_DEFAULTS_ROW,
} from './dialogs/dialog_global_edit_text_and_graphics_ui.js';
import type { DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS } from './dialogs/dialog_global_edit_text_and_graphics.js';
import { LAYER_CLASS } from './board_design_settings.js';
import type { DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS } from './dialogs/dialog_global_edit_tracks_and_vias.js';
import type { DIALOG_GLOBAL_DELETION } from './dialogs/dialog_global_deletion.js';
import type { DIALOG_UNUSED_PAD_LAYERS } from './dialogs/dialog_unused_pad_layers.js';
import type { DIALOG_CLEANUP_GRAPHICS } from './dialogs/dialog_cleanup_graphics.js';
import type { DIALOG_CLEANUP_TRACKS_AND_VIAS } from './dialogs/dialog_cleanup_tracks_and_vias.js';
import type { DIALOG_SWAP_LAYERS } from './dialogs/dialog_swap_layers.js';
import { DialogPushPadProperties } from './dialogs/dialog_push_pad_properties_ui.js';
import { DialogEnumPads } from './dialogs/dialog_enum_pads_ui.js';
import { DialogFpEditPadTable } from './dialogs/dialog_fp_edit_pad_table_ui.js';
import type { DIALOG_PUSH_PAD_PROPERTIES } from './dialogs/dialog_push_pad_properties.js';
import type { DIALOG_ENUM_PADS } from './dialogs/dialog_enum_pads.js';
import type { DIALOG_FP_EDIT_PAD_TABLE } from './dialogs/dialog_fp_edit_pad_table.js';
import type { DIALOG_OFFSET_ITEM } from './dialogs/dialog_offset_item.js';
import { DialogBookReporterModeless } from '@ziroeda/common/dialogs/dialog_book_reporter_ui.js';
import type { DIALOG_BOOK_REPORTER } from '@ziroeda/common/dialogs/dialog_book_reporter.js';
import { netClassFor } from '@ziroeda/common/netclass_resolve.js';
// APPEARANCE_CONTROLS is ONE widget that PCB_EDIT_FRAME and
// FOOTPRINT_EDIT_FRAME both construct, so the panel, its Objects table and its
// presets live in `widgets/` and this frame supplies only its own data.
import { AppearanceControls } from './widgets/appearance_controls.js';
import {
  DEFAULT_OBJECTS,
  DEFAULT_OPACITY,
  OBJECT_ROWS,
  toggleObject,
  type ObjectState,
} from './widgets/appearance_controls.js';
import {
  BUILTIN_PRESETS,
  matchPresetName,
  presetComboItems,
  PRESET_SEPARATOR,
  viewportComboItems,
} from './widgets/appearance_controls.js';
import {
  DEFAULT_SELECTION_FILTER_OPTIONS,
  SELECTION_FILTER_ITEMS,
  SelectionFilterOnlyMenu,
  SelectionFilterPanel,
  type SelectionFilterItem,
} from './widgets/panel_selection_filter.js';
import { PCB_GRID_HELPER, type PcbGridState } from './tools/pcb_grid_helper.js';
import { drawConstructionGeom } from '@ziroeda/common/preview_items/construction_geom.js';
import { drawSnapIndicator } from '@ziroeda/common/preview_items/snap_indicator.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { DialogTrackViaProperties } from './dialogs/dialog_track_via_properties_ui.js';
import { DialogCopperZones } from './dialogs/dialog_copper_zones.js';
import { PcbOneLayerSelector, SelectCopperLayerPairDialog } from './sel_layer.js';
import { DialogFootprintProperties } from './dialogs/dialog_footprint_properties_ui.js';
import { DialogFootprintAssociations } from './dialogs/dialog_footprint_associations_ui.js';
import { DialogMapLayers } from './dialogs/dialog_map_layers.js';
import type {
  PANEL_3D_MODEL_HOST,
  SELECTED_3D_MODEL,
} from './dialogs/panel_fp_properties_3d_model.js';
import { PROJECT_PCB } from './project_pcb.js';
import type { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { DialogImportNetlist, type ImportNetlistOptions } from './dialogs/dialog_import_netlist.js';
import { loadNetlist as readNetlistText } from './netlist_reader/netlist_reader.js';
import type { INPUT_LAYER_DESC } from './pcb_io/common/plugin_common_layer_mapping.js';
import type { PCB_LAYER_ID as MapLayersLayerId } from '@ziroeda/common/layer_id.js';
import {
  DIALOG_FOOTPRINT_PROPERTIES,
  type FootprintValues,
} from './dialogs/dialog_footprint_properties.js';
import { DialogPadProperties } from './dialogs/dialog_pad_properties_ui.js';
import { DialogShapeProperties } from './dialogs/dialog_graphic_properties.js';
import { DialogTextProperties } from './dialogs/dialog_text_properties_ui.js';
import { DIALOG_TEXT_PROPERTIES, type TextValues } from './dialogs/dialog_text_properties.js';
import { DIALOG_SHAPE_PROPERTIES, type ShapeValues } from './dialogs/dialog_shape_properties.js';
import {
  DIALOG_PAD_PROPERTIES,
  // `padAt` is taken by the local hit-test helper below.
  type PadValues,
} from './dialogs/dialog_pad_properties.js';
import { DIALOG_COPPER_ZONE, type ZoneValues } from './dialogs/panel_zone_properties.js';
import {
  DIALOG_TRACK_VIA_PROPERTIES,
  type TrackViaValues,
} from './dialogs/dialog_track_via_properties.js';
import { useKiDialog } from '@ziroeda/common/kidialog.js';
import type { DIALOG_GLOBAL_EDIT_TEARDROPS } from './dialogs/dialog_global_edit_teardrops.js';
import { boardFromBOARD } from './pcb_io/kicad_sexpr/board_view.js';
import { DisplayErrorMessage, IsOK } from '@ziroeda/common/confirm.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { DIALOG_REFERENCE_IMAGE_PROPERTIES } from './dialogs/dialog_reference_image_properties.js';
import { ARRAY_TOOL } from './tools/array_tool.js';
import { PCB_SELECTION } from './tools/pcb_selection.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import { MwavePolygonalShapeDlg } from './microwave/microwave_polygon_ui.js';
import {
  DialogZoneManager,
  type ZonePreviewCanvasFactory,
} from './zone_manager/dialog_zone_manager_ui.js';
import { ZONE_PREVIEW_CANVAS } from './zone_manager/zone_preview_canvas.js';
import { drawPanelWindow } from '@ziroeda/common/gal/gal_window.js';
import { GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import { wxEVT_SIZE } from '@ziroeda/common/wx/wx_event.js';
import { pageInfoOfPaper, paperOfPageInfo } from '@ziroeda/common/page_info.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import type { ZONE } from './zone.js';
import type { wxTextValidator } from '@ziroeda/common/validators.js';
import type { DRC_TOOL } from './tools/drc_tool.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 as KVec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { DIALOG_DRC, type DIALOG_DRC_WINDOW } from './dialogs/dialog_drc_model.js';
import { MessageDialogYesNoCancel } from '@ziroeda/common/dialogs/dialog_message.js';
import {
  loadPcbnewSettings,
  PCB_EDIT_FRAME,
  REACT_BOARD_LISTENER,
  storePcbnewSettings,
} from './pcb_edit_frame.js';
import { FetchNetlistFromSchematic } from './netlist_from_schematic.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { BOARD_EDITOR_CONTROL } from './tools/board_editor_control.js';
import type { FOOTPRINT } from './footprint.js';
import {
  drawOriginMarkers,
  PCB_DEFAULT_GRID_IU,
  PCB_DEFAULT_GRID_ORIGIN,
  DEFAULT_DRAW_OPTIONS,
  type PcbDrawOptions,
} from './renderBoard.js';
import {
  applyDisplayState,
  attachBoardToPanel,
  createPcbDrawPanel,
  type EditorDisplayState,
  editorViewOf,
  loadBitmapFontImage,
  syncViewTransform,
  type EditorView,
} from './pcb_canvas.js';
import type { PCB_DRAW_PANEL_GAL } from './pcb_draw_panel_gal.js';
import type { BOARD_ITEM } from './board_item.js';
import { PCB_DISPLAY_OPTIONS, type PCB_PAINTER } from './pcb_painter.js';
import {
  HIGH_CONTRAST_MODE,
  NET_COLOR_MODE,
  RATSNEST_MODE,
  ZONE_DISPLAY_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import {
  GAL_LAYER_ID,
  LayerName,
  PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { PAD } from './pad.js';
import { PCB_TRACK, PCB_VIA } from './pcb_track.js';
import { TRACK_CLEARANCE_MODE } from './pcbnew_settings.js';
import {
  applyToggle,
  crosshairToggleId,
  foldPcbToggle,
  isStoredPcbToggle,
  lineModeToggleId,
  PCB_CHECKED_ACTIONS,
  PCB_LINE_MODE_ACTIONS,
  pcbCheckedSet,
  pcbDisabledSet,
  pcbTogglesFromSettings,
} from './pcb_edit_frame.js';
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { toStatusUnits } from '@ziroeda/common/settings/app_settings_units.js';
import {
  layerColor,
  pcbThemeWithOverrides,
  PCB_BACKGROUND,
  PCB_CURSOR,
  PCB_OBJECT_COLORS,
  PCB_SPECIAL,
} from './pcbTheme.js';
import { PcbPropertiesPanel } from './widgets/pcb_properties_panel_ui.js';
import { PcbNetInspectorPane } from './widgets/pcb_net_inspector_panel_ui.js';
import { PcbSearchPane } from './widgets/pcb_search_pane.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_COMMIT } from './board_commit.js';
import type {
  IMPORT_GRAPHICS_RESULT,
  PASTE_MODE,
  PCB_BASE_EDIT_FRAME,
} from './pcb_base_edit_frame.js';
import {
  GetClipboardText,
  SetClipboardFromPaste,
  SetClipboardFromText,
} from '@ziroeda/common/clipboard.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import type { VertexEditorFrame } from './widgets/vertex_editor_pane.js';
import type { PcbSearchWiring } from './widgets/search_handlers.js';
import { PCB_VERTEX_EDITOR_PANE } from './widgets/vertex_editor_pane.js';
import { VertexEditorWindow } from './pcb_base_edit_frame_ui.js';
import { drawCrosshair, gridSnappingEnabled } from '@ziroeda/common/draw_panel_gal_grid_cursor.js';
import { gridSizeToIU, gridSizesIU } from '@ziroeda/common/settings/grid_settings_ui.js';
import { PCB_CONTROL, PCB_DEFAULT_TOOLBARS } from './toolbars_pcb_editor.js';
import '@ziroeda/common/widgets/shell.css';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { ProgressDialog, nextPaint } from '@ziroeda/common/widgets/wx_progress_reporters.js';
import { yieldToEventLoop } from '@ziroeda/common/yield_to_event_loop.js';
import type { ProgressSnapshot } from '@ziroeda/common/widgets/progress_reporter_snapshot.js';
import { showHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '@ziroeda/common/tool/action_menu_hotkeys.js';
import {
  isTypingTarget,
  wasBrowserSuppressed,
  type FocusLike,
} from '@ziroeda/common/browser_hotkeys.js';
import { hiContrastFactorFor } from '@ziroeda/common/render_settings.js';
import { parseColor4d, toCssColor, type Color4d } from '@ziroeda/common/gal/color4d.js';

const MM = PCB_IU_PER_MM; // pcbnew IU is 1 nm (base_units.h)

/**
 * The board is drawn by `OPENGL_GAL` through KiCad's `VIEW` and `PCB_PAINTER`,
 * and by nothing else.
 *
 * There was a `?renderer=canvas` opt-out and a Canvas2D path behind it. Both
 * are gone: the flag was deleted when the schematic went all-GL, and the path
 * followed once WebGL2 joined the browser-support gate
 * (`browser_support.ts`). The reason is the one the schematic's opt-in flag
 * taught — a renderer that is not the one running is a renderer nobody keeps
 * at parity, and this one silently drew a different board for whoever had no
 * WebGL2 rather than telling them.
 */

/**
 * `?perf=1` publishes what each frame cost and which path drew it, on
 * `window.__pcbPerf`.
 *
 * #481's own rule is that renderer numbers measured from Node mean nothing:
 * everything in the port so far was provable off-screen, and this last step is
 * not. A blank canvas and a correct board are indistinguishable to every test
 * that can be written for it, so the only honest measurement is one taken in a
 * browser against the 1,544 ms baseline in the issue.
 */
const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');

interface PcbPerfCounters {
  /** Frames drawn by each path. */
  gl: number;
  raster: number;
  /** GL re-records: the expensive half, and the one that should stay rare. */
  records: number;
  lastRecordMs: number;
  totalMs: number;
  maxMs: number;
  /** The last 40 frame times, in ms. */
  last: number[];
}

const pcbPerf: PcbPerfCounters = {
  gl: 0,
  raster: 0,
  records: 0,
  lastRecordMs: 0,
  totalMs: 0,
  maxMs: 0,
  last: [],
};
if (PERF && typeof window !== 'undefined') {
  (window as unknown as { __pcbPerf: PcbPerfCounters }).__pcbPerf = pcbPerf;
}

/** Record one frame: which path drew it, and how long it took. */
function notePcbPaint(path: 'gl' | 'raster', t0: number): void {
  if (!PERF) return;
  const ms = performance.now() - t0;
  pcbPerf[path]++;
  pcbPerf.totalMs += ms;
  if (ms > pcbPerf.maxMs) pcbPerf.maxMs = ms;
  pcbPerf.last.push(Math.round(ms * 10) / 10);
  if (pcbPerf.last.length > 40) pcbPerf.last.shift();
}

// pcb_painter.cpp getColor: a selected item is drawn in its layer colour
// Brightened(0.8) (per channel c·0.2 + 0.8), i.e. pushed 80% toward white.

// Snapping lives in pcb_grid.ts; see the note there on the board grid origin.

// pcbnew's grid presets, as the module DEFAULT: `DefaultGridSizeList()`'s
// non-eeschema row, which the footprint editor shares. The table lives in
// ui/grid_settings.ts because it is common/ code upstream.
//
// It is the seed, not the answer. The live list is `window.grid.sizes`, which
// `PANEL_GRID_SETTINGS` edits on Preferences > PCB Editor > Grids — a canvas
// that kept reading the table would make every row on that page a control
// nothing obeys, which is exactly what it was before that page existed.
const PCB_GRIDS: number[] = gridSizesIU('pcbnew', MM);

/** The stored grid list, in IU — `window.grid.sizes` rather than the table. */
function pcbGridSizesIU(cfg: PCBNEW_JSON_SETTINGS_LIKE): number[] {
  return cfg.window.grid.sizes.map((g) => gridSizeToIU(g.x, MM) ?? 0).filter((v) => v > 0);
}

/** The grid the frame opens on: `window.grid.last_size_idx` into that list. */
function storedPcbGridIU(cfg: PCBNEW_JSON_SETTINGS_LIKE): number {
  return pcbGridSizesIU(cfg)[cfg.window.grid.last_size_idx] ?? PCB_DEFAULT_GRID_IU;
}

/** The aux bar's `toggled` sets, hoisted so a render does not build a new one
 *  each time and re-run the toolbar's memo. */
const EMPTY_TOGGLED: ReadonlySet<string> = new Set();
const AUTO_TRACK_WIDTH_ON: ReadonlySet<string> = new Set(['autoTrackWidth']);

/**
 * A GAL zoom factor turned into our view scale, and back.
 *
 * These are what the zoom selector and the status bar's `Z` field mean, and
 * both are KiCad numbers rather than free-floating ones: `COMMON_TOOLS::
 * doZoomToPreset` passes a preset straight to `VIEW::SetScale`, and
 * `EDA_DRAW_FRAME::GetZoomLevelIndicator` prints `GAL::GetZoomFactor`. GAL
 * relates the two by `worldScale = screenDPI · worldUnitLength · zoomFactor`
 * (graphics_abstraction_layer.h `computeWorldScale`), with `worldUnitLength`
 * one internal unit in inches — pcbnew's IU is 1 nm, so 1e-9/0.0254.
 *
 * `scale` here is *device* pixels per IU while GAL's is physical screen pixels,
 * so the device-pixel ratio divides out; on a HiDPI display GAL renders into a
 * larger framebuffer without changing the zoom it reports.
 *
 * The old mapping was `scale · 1000`, which is dimensionless nonsense: it put
 * preset "Zoom 2.20" at 2200 px/mm where pcbnew puts it at 7.9, so choosing a
 * preset landed inside a single pad and the status bar read `Z 0.00` on a board
 * that pcbnew calls `Z 2.10`.
 */

/**
 * The toolbar tools that run on TOOL_MANAGER: DRAWING_TOOL's DrawLine,
 * DrawRectangle, DrawCircle, DrawArc, PlaceText and DrawZone (polygons, zones, rule
 * areas, cutouts and similar zones), DrawDimension, DrawVia, DrawBezier and
 * PlacePoint. Arming one runs its action as the
 * toolbar does (no position); while it is the current tool the canvas's events
 * and keys go to TOOL_DISPATCHER, and its PopTool returns the toolbar to the
 * selection mode. The other drawing tools still run in this window.
 */
const TOOL_MANAGER_TOOLS: Readonly<Record<string, TOOL_ACTION>> = {
  drawLine: PCB_ACTIONS.drawLine,
  drawRectangle: PCB_ACTIONS.drawRectangle,
  drawCircle: PCB_ACTIONS.drawCircle,
  drawArc: PCB_ACTIONS.drawArc,
  placeText: PCB_ACTIONS.placeText,
  drawPolygon: PCB_ACTIONS.drawPolygon,
  drawZone: PCB_ACTIONS.drawZone,
  drawRuleArea: PCB_ACTIONS.drawRuleArea,
  drawZoneCutout: PCB_ACTIONS.drawZoneCutout,
  drawSimilarZone: PCB_ACTIONS.drawSimilarZone,
  drawAlignedDimension: PCB_ACTIONS.drawAlignedDimension,
  drawOrthogonalDimension: PCB_ACTIONS.drawOrthogonalDimension,
  drawCenterDimension: PCB_ACTIONS.drawCenterDimension,
  drawRadialDimension: PCB_ACTIONS.drawRadialDimension,
  drawLeader: PCB_ACTIONS.drawLeader,
  drawVia: PCB_ACTIONS.drawVia,
  drawBezier: PCB_ACTIONS.drawBezier,
  placePoint: PCB_ACTIONS.placePoint,
  drawTable: PCB_ACTIONS.drawTable,
  placeReferenceImage: PCB_ACTIONS.placeReferenceImage,
  drawTextBox: PCB_ACTIONS.drawTextBox,
  placeBarcode: PCB_ACTIONS.placeBarcode,
  placeImportedGraphics: PCB_ACTIONS.placeImportedGraphics,
  // PCB_VIEWER_TOOLS.
  measureTool: ACTIONS.measureTool,
  // BOARD_INSPECTION_TOOL, through PCB_PICKER_TOOL.
  localRatsnestTool: PCB_ACTIONS.localRatsnestTool,
  // MICROWAVE_TOOL.
  microwaveCreateLine: PCB_ACTIONS.microwaveCreateLine,
  microwaveCreateGap: PCB_ACTIONS.microwaveCreateGap,
  microwaveCreateStub: PCB_ACTIONS.microwaveCreateStub,
  microwaveCreateStubArc: PCB_ACTIONS.microwaveCreateStubArc,
  microwaveCreateFunctionShape: PCB_ACTIONS.microwaveCreateFunctionShape,
  // PCB_CONTROL / BOARD_EDITOR_CONTROL, through PCB_PICKER_TOOL.
  gridSetOrigin: ACTIONS.gridSetOrigin,
  drillOrigin: PCB_ACTIONS.drillOrigin,
  deleteTool: ACTIONS.deleteTool,
  // PCB_CONTROL's board tables, placed through EDIT_TOOL::Move.
  placeCharacteristics: PCB_ACTIONS.placeCharacteristics,
  placeStackup: PCB_ACTIONS.placeStackup,
  // BOARD_EDITOR_CONTROL::PlaceFootprint
  placeFootprint: PCB_ACTIONS.placeFootprint,
  // ROUTER_TOOL::MainLoop
  routeSingleTrack: PCB_ACTIONS.routeSingleTrack,
  routeDiffPair: PCB_ACTIONS.routeDiffPair,
};

// Friendly names for the "Current Tool" status-bar field (field 6), shown while
// a right-toolbar tool is active (EDA_DRAW_FRAME::DisplayToolMsg). The selection
// tool leaves the field blank, exactly like KiCad.
const PCB_TOOL_MSGS: Record<string, string> = {
  // Every string here is `TOOL_ACTION::GetFriendlyName()` and nothing else:
  // `TOOLS_HOLDER::PushTool` ends `DisplayToolMsg( action->GetFriendlyName() )`
  // (`tools_holder.cpp:69-74`), so the tooltip, the menu label and the legacy
  // hotkey name are all the wrong string for this field.
  //
  // Half of them were the wrong string: v10's names are plural — "Draw Lines",
  // not "Draw Line" — and the four that read "Add …" were the pre-v7 spellings.
  // The selection tool shows `ACTIONS::selectionTool`'s own name.
  selectSetRect: 'Select item(s)',
  selectSetLasso: 'Select item(s)',
  routeSingleTrack: 'Route Single Track',
  drawVia: 'Place Vias',
  drawZone: 'Draw Filled Zones',
  drawLine: 'Draw Lines',
  drawArc: 'Draw Arcs',
  drawRectangle: 'Draw Rectangles',
  drawCircle: 'Draw Circles',
  drawPolygon: 'Draw Polygons',
  // `PCB_ACTIONS::drawBezier`'s FriendlyName (`pcb_actions.cpp:158`), which is
  // singular where the four above are plural — upstream's own inconsistency.
  drawBezier: 'Draw Bezier Curve',
  placeReferenceImage: 'Place Reference Images',
  placeText: 'Draw Text',
  // These three had no entry at all, so arming them left the field showing the
  // tool before — the Text Box tool in particular, which is what this pass is
  // about.
  drawTextBox: 'Draw Text Boxes',
  drawTable: 'Draw Tables',
  placeBarcode: 'Add Barcode',
  drawOrthogonalDimension: 'Draw Orthogonal Dimensions',
  drawAlignedDimension: 'Draw Aligned Dimensions',
  drawCenterDimension: 'Draw Center Dimensions',
  drawRadialDimension: 'Draw Radial Dimensions',
  drawLeader: 'Draw Leaders',
  // `TOOL_ACTION::GetFriendlyName()`, which `TOOLS_HOLDER::PushTool` puts in
  // pane 6 — "Place Point" (`pcb_actions.cpp:194`), not the tooltip.
  placePoint: 'Place Point',
  // `ACTIONS::gridSetOrigin` is "Grid Origin" (`actions.cpp:1057`) and
  // `PCB_ACTIONS::drillOrigin` "Drill/Place File Origin"
  // (`pcb_actions.cpp:1472`) — the FriendlyName, not the tooltip.
  gridSetOrigin: 'Grid Origin',
  drillOrigin: 'Drill/Place File Origin',
  measureTool: 'Measure Tool',
  deleteTool: 'Interactive Delete Tool',
  localRatsnestTool: 'Local Ratsnest',
  // `TOOL_ACTION::GetFriendlyName()` of the five `MICROWAVE_TOOL` actions.
  microwaveCreateLine: 'Draw Microwave Lines',
  microwaveCreateGap: 'Draw Microwave Gaps',
  microwaveCreateStub: 'Draw Microwave Stubs',
  microwaveCreateStubArc: 'Draw Microwave Arc Stubs',
  microwaveCreateFunctionShape: 'Draw Microwave Polygonal Shapes',
};

/**
 * `ACTIONS::selectSetRect` / `ACTIONS::selectSetLasso`: one tool, two drag
 * shapes. Both set `m_selectionMode` and post `ACTIONS::selectionTool`
 * (`pcb_selection_tool.cpp:1348-1363`), so neither is a pushed tool.
 */
const isSelectTool = (t: string): boolean => t === 'selectSetRect' || t === 'selectSetLasso';

// Tools that act on plain clicks and take no drag/box-select gestures.
const isClickTool = (t: string): boolean => t === 'routeSingleTrack';

// The left toolbar's radio groups, its opening state and its reducer are in
// `toggles.ts` rather than here, because `qa`'s tsconfig compiles `.ts` only:
// a default written in a `.tsx` is one no test can read, and two of the seven
// were on the wrong arm of pcbnew's own settings.

// `rebuildLayers()`'s non_cu_seq order and its tooltips now live in
// `widgets/appearance_layers.ts`, because APPEARANCE_CONTROLS is ONE widget
// that both PCB_EDIT_FRAME and FOOTPRINT_EDIT_FRAME construct - the table was
// restated here, and the footprint editor, unable to import it out of a `.tsx`,
// had invented an order of its own.

// The user-facing name of a layer is BOARD::GetLayerName's, which every
// upstream caller goes through: the board's own name for it when the file
// carries one, and LayerName()'s standard English name otherwise. Both halves
// live in @ziroeda/pcbnew/layer_ids.ts — the table used to be restated
// here, and this copy had no way to reach the board's names at all.

// Routing dimensions of a net class (NETCLASS factory defaults, in IU), the
// last-resort fallback when even the Default class carries no value.
interface ClassDims {
  trackWidth: number;
  viaDiameter: number;
  viaDrill: number;
}
const DEFAULT_CLASS_DIMS: ClassDims = {
  trackWidth: 0.25 * MM,
  viaDiameter: 0.8 * MM,
  viaDrill: 0.4 * MM,
};

/**
 * The selection an EDIT_TOOL command actually operates on: groups expanded to
 * their members, and pads replaced by their parent footprints, the
 * FilterCollectorForHierarchy + FilterCollectorForFreePads pair every command
 * (Move, Drag, Rotate, Mirror, Remove, …) runs its collector through.
 *
 * `selection` is what RequestSelection leaves selected afterwards: it hands the
 * filtered collector back, so a promoted pad leaves its footprint selected. It
 * is null when nothing was promoted, so group ids stay selected as groups.
 */
// EDIT_POINT's screen sizes and colours come from the shared modules the symbol,
// schematic and drawing-sheet canvases already use — `preview_items/edit_points`
// for the metrics and `editPointColors` for the palette. This file used to
// restate all six locally, and both halves were wrong for it:
//
//   * the sizes were 3 and 6, which is upstream's `#ifdef __WXMAC__` arm. The
//     parity target is the GTK build on this machine, where they are 2 and 5, so
//     every handle here carried a border half again too heavy.
//   * the colours were a hardcoded white fill with two grey borders, which is
//     what `editPointColors` happens to derive for a white LAYER_AUX_ITEMS — so
//     the handles ignored the board theme entirely.

/**
 * `PCB_EDIT_FRAME::SyncProjectSettingsIntoBoard` (`files.ts`, `pcbnew/
 * files.cpp`'s half of `OpenProjectFiles`), plus the one piece of it that
 * is canvas work rather than model work: on a later change of those files
 * (Board Setup's OK persists them) the pads and tracks repaint with the new
 * clearances, as `ShowBoardSetupDialog`'s `UpdateAllItemsConditionally`
 * has them do.
 */
function syncProjectSettingsIntoBoard(
  frame: PCB_EDIT_FRAME,
  panel: PCB_DRAW_PANEL_GAL | null,
  files: readonly { name: string; text: string }[],
  rootPro: string | undefined,
  aFromBoardSetup: boolean,
  aProjectDir: string,
): void {
  const kb = frame.GetBoard();
  if (!kb) return;
  frame.SyncProjectSettingsIntoBoard(files, rootPro, aFromBoardSetup, aProjectDir);
  if (!aFromBoardSetup || !panel) return;
  boardSetupRepaint(frame, panel, kb);
}

/**
 * `ShowBoardSetupDialog`'s `UpdateAllItemsConditionally`: what the dialog's
 * OK repaints — pads and vias whose mask/paste layers may have appeared,
 * tracks and pads drawn with their clearance.
 */
function boardSetupRepaint(frame: PCB_EDIT_FRAME, panel: PCB_DRAW_PANEL_GAL, kb: BOARD): void {
  const settings = frame.GetPcbNewSettings();
  const maskAndPasteLayers = new LSET([
    PCB_LAYER_ID.F_Mask,
    PCB_LAYER_ID.F_Paste,
    PCB_LAYER_ID.B_Mask,
    PCB_LAYER_ID.B_Paste,
  ]);
  panel.GetView().UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
    let flags = 0;

    if (!aItem.IsBOARD_ITEM()) return flags;

    const item = aItem as BOARD_ITEM;

    // PCB_VIA_T || PCB_PAD_T
    if (item instanceof PCB_VIA || item instanceof PAD) {
      // Note: KIGFX::REPAINT isn't enough for things that go from invisible
      // to visible as they won't be found in the view layer's itemset for
      // re-painting.
      if (kb.GetVisibleLayers().and(maskAndPasteLayers).any()) flags |= VIEW_UPDATE_FLAGS.ALL;
    }

    // PCB_TRACE_T || PCB_ARC_T || PCB_VIA_T
    if (item instanceof PCB_TRACK) {
      if (settings.m_Display.m_TrackClearance === TRACK_CLEARANCE_MODE.SHOW_WITH_VIA_ALWAYS)
        flags |= VIEW_UPDATE_FLAGS.REPAINT;
    }

    if (item instanceof PAD) {
      if (settings.m_Display.m_PadClearance) flags |= VIEW_UPDATE_FLAGS.REPAINT;
    }

    return flags;
  });
  panel.ForceRefresh();
}

/**
 * The two `.Bottom()` panes of `PCB_EDIT_FRAME`'s AUI layout
 * (`pcb_edit_frame.cpp:396-412`): the Net Inspector and the Search pane.
 *
 * Neither names a layer, so both take the innermost ring, side by side in one
 * dock under the canvas, in `AddPane` order (Net Inspector first). Each is
 * `.PaneBorder( false )` and `.CloseButton( true )`; the dock's height is the
 * tallest `BestSize` of what is shown until it is dragged.
 */
/** [data] `.MinSize( 180, 60 )`, `.BestSize( 180, 100 )` (`pcb_edit_frame.cpp:408-409`). */
export const PCB_SEARCH_PANE_SIZE = { minHeight: 60, bestHeight: 100 } as const;

/** [data] `.MinSize( 240, 60 )`, `.BestSize( 300, 200 )` (`pcb_edit_frame.cpp:399-400`). */
export const PCB_NET_INSPECTOR_SIZE = { minHeight: 60, bestHeight: 200 } as const;

/** The dock's height for what is shown, when the user has not dragged it (or `SetAuiPaneSize( -1 )`'s stored -1). */
export function bottomDockHeight(
  aShowSearch: boolean,
  aShowNetInspector: boolean,
  aStored: number,
): number {
  if (aStored > 0) return aStored;

  return Math.max(
    aShowSearch ? PCB_SEARCH_PANE_SIZE.bestHeight : 0,
    aShowNetInspector ? PCB_NET_INSPECTOR_SIZE.bestHeight : 0,
  );
}

/** The floor a drag stops at: the tallest `MinSize` of what is shown. */
export function bottomDockMinHeight(aShowSearch: boolean, aShowNetInspector: boolean): number {
  return Math.max(
    aShowSearch ? PCB_SEARCH_PANE_SIZE.minHeight : 0,
    aShowNetInspector ? PCB_NET_INSPECTOR_SIZE.minHeight : 0,
  );
}

interface DockedPaneProps {
  caption: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}

function DockedPane({ caption, testId, onClose, children }: DockedPaneProps): JSX.Element {
  return (
    <div className="ze-panel" style={{ flex: '1 1 0', minWidth: 0 }} data-testid={testId}>
      <div className="ze-panel-header">
        <span>{caption}</span>
        <button type="button" className="ze-pane-close" onClick={onClose} title="Close">
          ⊠
        </button>
      </div>
      <div className="ze-panel-body">{children}</div>
    </div>
  );
}

interface PcbBottomDockProps {
  /** `m_auimgr.GetPane( SearchPaneName() ).IsShown()`. */
  showSearch: boolean;
  /** `NetInspectorShown()`. */
  showNetInspector: boolean;
  /** The stored height, `search_panel_height`; -1 until dragged. */
  height: number;
  onHeightChange: (aHeight: number) => void;
  onCloseSearch: () => void;
  onCloseNetInspector: () => void;
  netInspector: ReactNode;
  search: ReactNode;
}

export function PcbBottomDock({
  showSearch,
  showNetInspector,
  height,
  onHeightChange,
  onCloseSearch,
  onCloseNetInspector,
  netInspector,
  search,
}: PcbBottomDockProps): JSX.Element | null {
  if (!showSearch && !showNetInspector) return null;

  const minHeight = bottomDockMinHeight(showSearch, showNetInspector);

  // The sash is ABOVE the pane, so dragging down shrinks it.
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const dock = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
    const startY = e.clientY;
    const startH =
      dock?.getBoundingClientRect().height ??
      bottomDockHeight(showSearch, showNetInspector, height);
    const onMove = (ev: MouseEvent): void =>
      onHeightChange(Math.max(minHeight, Math.round(startH - (ev.clientY - startY))));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
  };

  return (
    <>
      <div
        className="ze-splitter horizontal"
        data-testid="pcb-bottom-dock-sash"
        onMouseDown={startResize}
        title="Drag to resize"
      />
      <div
        className="ze-bottomdock"
        data-testid="pcb-bottom-dock"
        style={{
          height: bottomDockHeight(showSearch, showNetInspector, height),
          flexDirection: 'row',
        }}
      >
        {showNetInspector && (
          <DockedPane
            caption="Net Inspector"
            testId="pcb-net-inspector"
            onClose={onCloseNetInspector}
          >
            {netInspector}
          </DockedPane>
        )}
        {showSearch && (
          <DockedPane caption="Search" testId="pcb-search-pane" onClose={onCloseSearch}>
            {search}
          </DockedPane>
        )}
      </div>
    </>
  );
}

/**
 * The read-only layer-defaults grid of DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS
 * (dialog_global_edit_text_and_graphics.cpp:213-284): Board Setup's per-class
 * line and text defaults. Edge Cuts and Courtyards have line thickness only.
 */
function layerDefaultsRows(aFrame: PCB_EDIT_FRAME): LAYER_DEFAULTS_ROW[] {
  const bds = aFrame.GetBoard()!.GetDesignSettings();
  const str = (v: number): string => aFrame.GetUnitsProvider().StringFromValue(v, true);
  const C = LAYER_CLASS;
  const full = (name: string, c: LAYER_CLASS): LAYER_DEFAULTS_ROW => ({
    name,
    line: str(bds.m_LineThickness[c]!),
    width: str(bds.m_TextSize[c]!.x),
    height: str(bds.m_TextSize[c]!.y),
    thickness: str(bds.m_TextThickness[c]!),
    italic: bds.m_TextItalic[c]!,
    upright: bds.m_TextUpright[c]!,
  });
  const lineOnly = (name: string, c: LAYER_CLASS): LAYER_DEFAULTS_ROW => ({
    name,
    line: str(bds.m_LineThickness[c]!),
    width: '',
    height: '',
    thickness: '',
    italic: null,
    upright: null,
  });

  return [
    full('Silk Layers', C.LAYER_CLASS_SILK),
    full('Copper Layers', C.LAYER_CLASS_COPPER),
    lineOnly('Edge Cuts', C.LAYER_CLASS_EDGES),
    lineOnly('Courtyards', C.LAYER_CLASS_COURTYARD),
    full('Fab Layers', C.LAYER_CLASS_FAB),
    full('Other Layers', C.LAYER_CLASS_OTHERS),
  ];
}

/**
 * The board's enabled layers by canonical name: the copper stack, then the
 * rest in UI order (`BOARD::GetEnabledLayers()`, walked as
 * APPEARANCE_CONTROLS::rebuildLayers walks it).
 */
function enabledLayerNames(aBoard: BOARD | null | undefined): string[] {
  const enabled = aBoard?.GetEnabledLayers();
  if (!enabled) return [];
  return [...enabled.CuStack(), ...enabled.TechAndUserUIOrder()].map((l) => LSET.Name(l));
}

/** The board's nets as code -> name, for a dialog's net selector (NETINFO_LIST). */
function netNamesByCode(aBoard: BOARD | null | undefined): ReadonlyMap<number, string> {
  return new Map(
    [...(aBoard?.GetNetInfo().NetsByNetcode() ?? new Map())].map(
      ([code, net]) => [code, net.GetNetname()] as const,
    ),
  );
}

export function PcbEditor({
  registerScriptApi,
  app,
  fileName,
  text,
  onExit,
  onShowSchematic,
  onShowFootprintEditor,
  onSaveBoard,
  onBoardChange,
  registerAutosaveFlush,
  openNonce,
  shown = true,
  projectName,
  projectFiles,
  rootPro,
  onPersistFiles,
  onOutputFile,
  kiway,
  viewer3DOpen,
  onViewer3DOpenChange,
  readOnlyNotice,
  readOnly,
}: {
  /** Lets a host script this window (the AI pane): the live board and frame,
   *  Update PCB from Schematic, zone fill and a picture. Returns the
   *  unregister function. */
  registerScriptApi?: (api: PcbScriptApi) => () => void;
  /** What the program gives this window — PreferencesDialog, HomeLink,
   *  SaveAsDialog, the 3D viewer, the footprint chooser, the settings
   *  triad — the same seam `cvpcb`'s `CVPCB_APP` and `pagelayout_editor`'s
   *  `PL_EDITOR_APP` already give theirs. See `pcbnew/browser/pcbnew_app.ts`. */
  app: PCBNEW_APP;
  fileName: string;
  text: string;
  onExit: () => void;
  onShowSchematic?: () => void;
  /** Open the Footprint Editor (the top-toolbar button / Tools menu). */
  onShowFootprintEditor?: () => void;
  /** Save the board into the project (cloud/file-manager storage); when
   *  absent, Save falls back to a local download. */
  onSaveBoard?: (text: string) => void;
  /** Debounced autosave sink (the app's coalesced project autosave): board
   *  edits sync automatically like the schematic's. */
  onBoardChange?: (text: string) => void;
  /**
   * Hand the host a "serialise the board NOW" callback, the same contract
   * eeschema has had.
   *
   * Without it the board's own 1 s autosave debounce was unreachable: the
   * host's flush — leaving for the home screen, `visibilitychange`, `pagehide`,
   * the crash-recovery zip — could force the schematic out and had nothing at
   * all for pcbnew, so the last second of board work was lost by every one of
   * those paths.
   */
  registerAutosaveFlush?: (fn: (() => void) | null) => void;
  /**
   * Bumped by the host once per deliberate project open, and by nothing else.
   *
   * `text` is a LIVE prop: the host mirrors this editor's own autosaved output
   * back into the open project so a reopen or a remount sees the work rather
   * than the file. Reloading the board whenever that string changed would
   * therefore reparse the board on every autosave and throw the session away
   * on every reopen, so the reload is keyed on the open instead — KiCad calls
   * `OpenProjectFiles` when something asks it to, not because a data structure
   * changed identity.
   */
  openNonce?: number;
  /**
   * Whether this frame is the one on screen.
   *
   * A pcbnew frame that is not shown does not exist in KiCad, so it does no
   * work. Ours stays mounted behind the other frames, and used to read the
   * board the moment `openNonce` moved even while hidden — so opening a
   * project parsed every editor that had ever been visited, on the thread the
   * visible one was trying to paint with. Hidden, the frame keeps whatever it
   * has and reads the new board when it is next shown. Defaults to shown, for
   * a frame that has no host.
   */
  shown?: boolean;
  /** Project name shown as "<project>, PCB Editor" in the menu bar. */
  projectName?: string;
  /** The open project's files (name + text), lets the 3D viewer resolve
   *  ${KIPRJMOD}/relative model references to project-bundled files. */
  projectFiles?: { name: string; text: string }[];
  /** Base name of the active `.kicad_pro` (scopes multi-project folders). */
  rootPro?: string;
  /** Persist project files immediately (Board Setup writes the `.kicad_pro`
   *  and `.kicad_dru` through this, same flow as the schematic editor). */
  onPersistFiles?: (files: { name: string; text: string }[]) => void;
  /** Write a generated output file (plot / drill) into the project's file
   *  manager; the path is relative to the project folder. */
  onOutputFile?: (path: string, bytes: Uint8Array, mime: string) => void;
  /**
   * The program's KIWAY: the frame registers as FRAME_PCB_EDITOR's player on
   * it, so the schematic's cross-probe mail reaches `KiwayMailIn`, and sends
   * its own through it.
   */
  kiway?: KIWAY;
  /**
   * The 3D viewer (`EDA_3D_VIEWER_FRAME`) open over this frame, controlled
   * from outside so the address can carry it (`/p/<uid>/pcb/3d`). Omitted,
   * the editor keeps the fact to itself.
   */
  viewer3DOpen?: boolean;
  onViewer3DOpenChange?: (open: boolean) => void;
  /** A strip to show above the canvas, e.g. "this demo is not being saved". */
  readOnlyNotice?: JSX.Element | null;
  /**
   * `!fn.IsFileWritable()` — the `[Read Only]` half of the frame title
   * (pcb_edit_frame.cpp:2186-2187). A browser has no per-file writable bit;
   * the condition that stands in for one here is the demo project, which is
   * exactly what {@link readOnlyNotice} already announces above the canvas.
   * The schematic editor has taken the same prop, from the same call site in
   * `App.tsx`, since its title was rebuilt on the shared rule.
   */
  readOnly?: boolean;
}): JSX.Element {
  // What the program gives this window (pcbnew/browser/pcbnew_app.ts's PCBNEW_APP);
  // destructured once so the rest of this file's calls and JSX are
  // unchanged from when each of these was its own designer/ import.
  const {
    PreferencesDialog,
    HomeLink,
    SaveAsDialog,
    FootprintChooserFrame,
    ModelPreview3D,
    Viewer3DFrame,
    pcbnewSettings: pcbCfg,
    commonSettings: commonCfg,
    updatePcbnewSettings,
    updateCommonSettings,
    commonSettingsOf,
    storeCommonDoNotShowAgain,
    windowSettingsOf,
    installPgm,
    reloadUserColorSettings,
    userColors,
    userThemes,
    useToolbarEntries,
    loadFootprintIndex,
    loadFootprint,
    preloadBoardLibraries,
    cleanup3dCache,
    EMPTY_PCB,
    addNetclassAssignment,
  } = app;
  /**
   * `EDA_BASE_FRAME::RecreateToolbars` (`common/eda_base_frame.cpp:1728-1843`):
   * the frame asks `GetToolbarConfig( loc, m_CustomToolbars )` for each bar and
   * never reads `DefaultToolbarConfig` itself, which is what lets Preferences >
   * Toolbars change what is drawn.
   */
  const pcbTopBar = useToolbarEntries('pcbnew', 'TOP_MAIN', PCB_DEFAULT_TOOLBARS);
  const pcbAuxBar = useToolbarEntries('pcbnew', 'TOP_AUX', PCB_DEFAULT_TOOLBARS);
  const pcbLeftBar = useToolbarEntries('pcbnew', 'LEFT', PCB_DEFAULT_TOOLBARS);
  const pcbRightBar = useToolbarEntries('pcbnew', 'RIGHT', PCB_DEFAULT_TOOLBARS);
  /**
   * The board the frame is born with: an empty one.
   *
   * `PCB_EDIT_FRAME::PCB_EDIT_FRAME` does `SetBoard( new BOARD() )` and shows
   * the canvas before `OpenProjectFiles` ever runs (pcb_edit_frame.cpp), which
   * is why pcbnew's window — menus, toolbars, the grid on a blank sheet — is
   * up in an instant and the file loads *over* it behind a progress dialog.
   * Ours held `null` until the parse finished and drew a spinner in the
   * canvas instead. The parse below replaces this the moment it is done.
   */
  const emptyBoard = useMemo<Board>(
    () => ({ ...readBoard(parse(EMPTY_PCB)), fileName }),
    [fileName],
  );
  // The PCB_EDIT_FRAME this window draws; everything below reads the BOARD through it.
  const frameRef = useRef<PCB_EDIT_FRAME | null>(null);
  const [board, setBoard] = useState<Board | null>(emptyBoard);
  /**
   * `OnModify` after a tool changed a board setting that is not an item: an
   * origin (PCB_CONTROL::DoSetGridOrigin, BOARD_EDITOR_CONTROL::DoSetDrillOrigin)
   * or the page and title block (BOARD_EDITOR_CONTROL::PageSettings), or their
   * undo. No BOARD_LISTENER event fires for those, and what reads them here
   * reads the BOARD, so this only has React read it again.
   */
  const [boardSettingsRev, setBoardSettingsRev] = useState(0);
  /** WX_PROGRESS_REPORTER( this, _( "Load PCB" ), 1, PR_CAN_ABORT ) (files.cpp:561). */
  const [loading, setLoading] = useState<ProgressSnapshot | null>(null);
  // Unsaved-changes flag: '*' in the title while modified, Save greys when
  // clean (KiCad's IsContentModified / m_infoBar save affordance).
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<string>>(
    () => new Set(emptyBoard.layers.map((l) => l.name)),
  );
  // Read by callbacks that must not re-create on every layer toggle (the fit).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [activeLayer, setActiveLayer] = useState('F.Cu');
  // `getView()->GetTopLayer()`, which every snap reads to prefer items on the
  // layer being worked on. A ref because `draw` reads it without wanting to be
  // rebuilt when the layer changes.
  const activeLayerRef = useRef(activeLayer);
  activeLayerRef.current = activeLayer;
  // Selected layer preset; '---' is the separator row, the default selection
  // like rebuildLayerPresetsWidget.
  const [tab, setTab] = useState<'Layers' | 'Objects' | 'Nets'>('Layers');
  /**
   * `pcbnew.json`, live. `PCB_EDIT_FRAME::CommonSettingsChanged` is what makes
   * an OK on Preferences reach the canvas upstream; subscribing here is that
   * call, and it is why Display Options' Grid Display, Cursor, Annotations and
   * Clearance Outlines groups take effect without a reload.
   */
  /**
   * `PANEL_GAL_OPTIONS`' two groups, mirrored into a ref because `draw` is
   * memoised on the layer set alone and must not be rebuilt whenever a setting
   * moves — the same shape `FootprintCanvas` uses for the same reason.
   */
  const galRef = useRef({
    ...pcbCfg.window.grid,
    ...pcbCfg.window.cursor,
    ...pcbCfg.pcb_display,
  });
  galRef.current = { ...pcbCfg.window.grid, ...pcbCfg.window.cursor, ...pcbCfg.pcb_display };
  /**
   * `EDA_DRAW_FRAME::GetRotationAngle()` in degrees — `editing.rotation_angle`
   * is tenths. A ref because the rotate command is a long-lived keydown
   * handler.
   */
  const rotationStepRef = useRef(90);
  rotationStepRef.current = pcbCfg.editing.rotation_angle / 10;
  /**
   * `PCB_POINT_EDITOR::m_arcEditMode`, read from `PCBNEW_SETTINGS::m_ArcEditMode`
   * when the point editor starts (pcb_point_editor.cpp:2322); a ref because the
   * handle drag runs in a long-lived pointer handler.
   */
  const arcEditModeRef = useRef<ARC_EDIT_MODE>(0);
  arcEditModeRef.current = pcbCfg.editing.arc_edit_mode as ARC_EDIT_MODE;
  /** `MAGNETIC_SETTINGS`, for the snap path, which is not a React consumer. */
  const magneticRef = useRef({ pads: 1, tracks: 1 });
  magneticRef.current = {
    pads: pcbCfg.editing.magnetic_pads,
    tracks: pcbCfg.editing.magnetic_tracks,
  };
  /** `m_ESCClearsNetHighlight` — whether Escape drops the net highlight. */
  const escClearsHighlightRef = useRef(true);
  escClearsHighlightRef.current = pcbCfg.editing.esc_clears_net_highlight;
  /**
   * `showCourtyardConflicts = !m_isFootprintEditor && cfg->m_ShowCourtyardCollisions`
   * (`edit_tool_move_fct.cpp:1002`) — Editing Options' "Show courtyard
   * collisions when moving/dragging". The move path is not a React consumer.
   */
  const showCourtyardConflictsRef = useRef(true);
  showCourtyardConflictsRef.current = pcbCfg.editing.show_courtyard_collisions;
  /** `drc_on_move`: the courtyards cached once at grab (`Init`). */
  /** …and the last frame's `m_itemsInConflict`, which the overlay shades. */
  /** `GAL::GetGridSnapping()` — Snap to grid, against `window.grid.show`. */
  const gridSnapRef = useRef(true);
  gridSnapRef.current = gridSnappingEnabled(pcbCfg.window.grid.snap, pcbCfg.window.grid.show);
  // …and the other direction: Preferences moved the stored crosshair or Show
  // Grid, so the left toolbar's buttons have to follow. `EDA_DRAW_FRAME::
  // CommonSettingsChanged` re-reads both and the toolbar's conditions repaint
  // off them; this is that, with the toggle set as our condition store.
  const storedCrosshair = pcbCfg.window.cursor.crosshair;
  const storedShowGrid = pcbCfg.window.grid.show;
  const storedLineMode = pcbCfg.editing.pcb_angle_snap_mode;
  const storedPolar = pcbCfg.editing.polar_coords;
  useEffect(() => {
    setToggles((prev) => {
      const next = new Set(prev);
      for (const id of ['crosshairSmall', 'crosshairFull', 'crosshair45']) next.delete(id);
      next.add(crosshairToggleId(storedCrosshair));
      for (const id of ['lineModeFree', 'lineMode45', 'lineMode90']) next.delete(id);
      next.add(lineModeToggleId(storedLineMode));
      const flag = (id: string, on: boolean): void => {
        if (on) next.add(id);
        else next.delete(id);
      };
      flag('toggleGrid', storedShowGrid);
      flag('togglePolarCoords', storedPolar);
      return next;
    });
  }, [storedCrosshair, storedShowGrid, storedLineMode, storedPolar]);
  // `EDA_DRAW_FRAME::LoadSettings` — the frame opens on what the file holds,
  // not on a hardcoded set. Seeded once: after that the toolbar owns the state
  // and folds its own clicks back into the file (`foldPcbToggle`).
  const [toggles, setToggles] = useState<Set<string>>(() => pcbTogglesFromSettings(pcbCfg));
  const togglesRef = useRef(toggles);
  togglesRef.current = toggles;
  // `GetUserUnits()`: the frame's, which its LoadSettings read from
  // `system.units` and COMMON_TOOLS changes; `ReCreateAuxiliaryToolbar` tells
  // the window, which re-renders in them.
  const [userUnits, setUserUnits] = useState<EdaUnits>(() => pcbCfg.system.units);
  const setUserUnitsRef = useRef(setUserUnits);
  const unitLabel: StatusUnits = toStatusUnits(userUnits);
  /**
   * The three status panes that follow the pointer, written through refs.
   *
   * `PCB_BASE_FRAME::UpdateStatusBar` (pcb_base_frame.cpp:761) runs on every
   * cursor motion and calls `SetStatusText`; nothing else on the frame
   * repaints. This frame instead held the cursor in React state and set it
   * from `onPointerMove` — with a fresh `{ x, y }` object, so `Object.is` never
   * matched and React could never bail out. Every mouse move re-rendered the
   * whole editor: both toolbars, the Appearance notebook, the Properties grid,
   * the Selection Filter and the status bar, all before the
   * `requestAnimationFrame` that actually moves the crosshair. That is why the
   * crosshair trailed the pointer here and not in eeschema, which was this
   * hook's only caller. (`setScale( v.scale )` at the end of `draw` is a
   * NUMBER, so React does bail out of that one — which is why zoom never had
   * the same problem.)
   *
   * `localOrigin` is `BASE_SCREEN::m_LocalOrigin`, which pane 3 measures from.
   * There is no Set Local Origin here yet, so it is the page origin — as a
   * module constant, because the hook's repaint effect depends on its identity.
   */
  /**
   * `PCB_BASE_FRAME::GetUserOrigin()` — Preferences > PCB Editor > Origins &
   * Axes' Display Origin group turned into a point:
   *
   *     PCB_ORIGIN_PAGE  -> ( 0, 0 )
   *     PCB_ORIGIN_AUX   -> GetDesignSettings().GetAuxOrigin()
   *     PCB_ORIGIN_GRID  -> GetDesignSettings().GetGridOrigin()
   *
   * Only the frame can answer the last two, which is why the hook takes the
   * point rather than the enum.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `board` and `boardSettingsRev` are the triggers; the BOARD holds the origins
  const userOrigin = useMemo(() => {
    const bds = frameRef.current?.GetBoard()?.GetDesignSettings();
    if (!bds) return PCB_LOCAL_ORIGIN;
    if (pcbCfg.pcb_display.origin_mode === 1) return bds.GetAuxOrigin();
    if (pcbCfg.pcb_display.origin_mode === 2) return bds.GetGridOrigin();
    return PCB_LOCAL_ORIGIN;
  }, [board, boardSettingsRev, pcbCfg.pcb_display.origin_mode]);
  const statusReadout = useStatusReadout({
    units: unitLabel,
    localOrigin: PCB_LOCAL_ORIGIN,
    devicePixelRatio: window.devicePixelRatio || 1,
    iuPerMM: PCB_IU_PER_MM,
    // `GetShowPolarCoords()` — the same pane, the other branch.
    polar: toggles.has('togglePolarCoords'),
    // Preferences > PCB Editor > Origins & Axes, all three of it.
    userOrigin,
    invertX: pcbCfg.pcb_display.origin_invert_x_axis,
    invertY: pcbCfg.pcb_display.origin_invert_y_axis,
  });
  // Properties pane width. KiCad's PCB_PROPERTIES_PANEL docks at BestSize 300,
  // MinSize 240 (pcb_edit_frame.cpp), and the pane is user-resizable.
  const [propWidth, setPropWidth] = useState(300);
  const [objects, setObjects] = useState<ObjectState>(DEFAULT_OBJECTS);
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  // Appearance pane width: KiCad's LayersManager AUI pane (BestSize ~220, but
  // our rows carry a swatch + eye + label + slider, so start a little wider so
  // the opacity sliders and the net-display radios fit on one line).
  const [appWidth, setAppWidth] = useState(255);
  // High-contrast (inactive layer) mode: HIGH_CONTRAST_MODE Normal/Dim/Hide.
  const [contrast, setContrast] = useState<'normal' | 'dim' | 'hide'>('normal');
  // "Flip board view" (PCB_ACTIONS::flipBoard): mirror the view horizontally.
  const [flipView, setFlipView] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // "Layer Display Options" collapsible pane state (collapsed by default).
  const [layerOptsOpen, setLayerOptsOpen] = useState(false);
  // Layer right-click context menu position (rightClickHandler).
  const [layerMenu, setLayerMenu] = useState<{ x: number; y: number } | null>(null);
  // User layer presets (saved from "Save preset...").
  const [userPresets, setUserPresets] = useState<{ name: string; layers: string[] }[]>([]);
  // Viewports (APPEARANCE_CONTROLS::m_viewports): named view transforms.
  const [viewports, setViewports] = useState<
    { name: string; view: { tx: number; ty: number; scale: number } }[]
  >([]);
  const [viewportSel, setViewportSel] = useState('---');
  // BOARD_EDITOR_CONTROL::AssignNetclass: the labelled nets of the selection,
  // while DIALOG_ASSIGN_NETCLASS is up.
  const [netclassDlg, setNetclassDlg] = useState<{
    names: ReadonlySet<string>;
    candidates: ReadonlySet<string>;
    preview: (aNetNames: readonly string[]) => void;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  // "Delete preset/viewport..." chooser popup.
  const [deleteChooser, setDeleteChooser] = useState<'presets' | 'viewports' | null>(null);
  // APPEARANCE_CONTROLS::m_presetMRU / m_viewportMRU: most recent first. The
  // preset list starts as every preset in m_layerPresets' (alphabetical)
  // order (rebuildLayerPresetsWidget( true )); viewports as they are added.
  const [presetMRU, setPresetMRU] = useState<string[]>(() =>
    BUILTIN_PRESETS.map((p) => p.name).sort(),
  );
  const [viewportMRU, setViewportMRU] = useState<string[]>([]);
  const touchMRU = (list: string[], name: string): string[] => [
    name,
    ...list.filter((n) => n !== name),
  ];
  // The EDA_VIEW_SWITCHER that is up, and which list it is cycling.
  const [viewSwitcher, setViewSwitcher] = useState<'presets' | 'viewports' | null>(null);
  // "Save preset..." / "Save viewport...": the wxTextEntryDialog that is up.
  const [saveNameAsk, setSaveNameAsk] = useState<'preset' | 'viewport' | null>(null);
  // Nets tab state: per-net / per-class colors, ratsnest visibility, and the
  // Net Display Options modes (appearance_controls.cpp net display pane).
  const [hiddenNets, setHiddenNets] = useState<ReadonlySet<number>>(new Set());
  const [classColors, setClassColors] = useState<ReadonlyMap<string, string>>(new Map());
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<string>>(new Set());
  const [netColorMode, setNetColorMode] = useState<'all' | 'ratsnest' | 'off'>('ratsnest');
  const [ratsnestMode, setRatsnestMode] = useState<'all' | 'visible' | 'off'>('all');
  const [netOptsOpen, setNetOptsOpen] = useState(false);
  // Pads whose local ratsnest is forced on, keyed `fp:pad`, the tool works at
  // PAD level (BOARD_INSPECTION_TOOL::LocalRatsnestTool toggles
  // PAD::SetLocalRatsnestVisible; a footprint click sets all its pads).
  //
  // PROJECT_LOCAL_SETTINGS' `board.selection_filter` defaults, which are the
  // shared table's: everything but "Locked items"
  // (common/project/project_local_settings.cpp:160-172). Ours ticked all
  // twelve, so a fresh board would select locked items.
  const [selFilter, setSelFilter] = useState<Set<string>>(
    new Set(DEFAULT_SELECTION_FILTER_OPTIONS),
  );
  // Right-click "Only <category>" popup of the Selection Filter panel
  // (PANEL_SELECTION_FILTER::onRightClick).
  const [filterMenu, setFilterMenu] = useState<{
    x: number;
    y: number;
    item: SelectionFilterItem;
  } | null>(null);
  // Net highlight (BOARD_INSPECTION_TOOL): the set of net codes currently
  // highlighted. When non-empty the whole board dims and these nets' copper
  // pops (pcb_painter.cpp getColor: highlighted → Brightened, else Darkened).
  // Picked with the backtick hotkey / cleared with '~'; the left-toolbar
  // "Toggle Net Highlight" button shows/hides the last highlight set.
  const [highlightNets, setHighlightNets] = useState<ReadonlySet<number>>(new Set());
  const highlightNetsRef = useRef<ReadonlySet<number>>(highlightNets);
  highlightNetsRef.current = highlightNets;
  /**
   * TRANSITIONAL (#636 stage 3): BOARD_INSPECTION_TOOL writes the net
   * highlight and the hidden nets on PCB_RENDER_SETTINGS, as KiCad does; the
   * window's own panels still draw from React state, so it re-reads both after
   * a tool event (the frame's OnIdle) and after an action it runs.
   */
  const refreshInspectionMirrorRef = useRef((): void => {
    const rs = (panelRef.current?.GetView().GetPainter() as PCB_PAINTER | undefined)?.GetSettings();
    if (!rs) return;
    const same = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean =>
      a.size === b.size && [...a].every((c) => b.has(c));
    const lit: ReadonlySet<number> = rs.IsHighlightEnabled()
      ? new Set(rs.GetHighlightNetCodes())
      : new Set();
    setHighlightNets((prev) => (same(prev, lit) ? prev : lit));
    const hidden: ReadonlySet<number> = new Set(rs.GetHiddenNets());
    setHiddenNets((prev) => (same(prev, hidden) ? prev : hidden));
  });
  /**
   * `GetPainter()->GetSettings()->SetHighlight( netcodes )` +
   * `UpdateAllLayersColor()`, as the net inspector, the search pane and the
   * router's drag write the highlight directly in KiCad.
   */
  const applyRenderHighlightRef = useRef((aNetCodes: Iterable<number>): void => {
    const view = panelRef.current?.GetView();
    if (!view) return;
    const codes = new Set(aNetCodes);
    view
      .GetPainter()!
      .GetSettings()
      .SetHighlight(codes, codes.size > 0);
    view.UpdateAllLayersColor();
    refreshInspectionMirrorRef.current();
  });
  const [activeTool, setActiveTool] = useState('selectSetRect');
  /**
   * TRANSITIONAL (#636 stage 3): PCB_SELECTION_TOOL's selection, as the view
   * ids the window's own not-yet-ported tools still read it by. The selection
   * is the tool's; this is re-read from it whenever the tool's events reach the
   * frame (`UpdateProperties`) and whenever the view is re-derived. Deleted
   * with EDIT_TOOL.
   */
  const [selection, setSelectionMirror] = useState<ReadonlySet<BOARD_ITEM>>(new Set());

  /**
   * `SendCrossProbeNetName` / `SendCrossProbeClearHighlight`: the board's
   * highlight, named, going the other way.
   *
   * One net, because the packet carries one — a multi-net highlight
   * (`$NETS:`) has no schematic-side equivalent here, so the first is sent, as
   * the schematic side already does when a CHAIN is highlighted.
   */
  useEffect(() => {
    const brd = boardRef.current;
    if (!brd) return;
    const first = [...highlightNets][0];
    frameRef.current?.SendCrossProbeNetName(
      first === undefined ? '' : (netNamesByCode(frameRef.current?.GetBoard()).get(first) ?? ''),
    );
  }, [highlightNets]);

  // `EDA_3D_VIEWER_FRAME`, shown by `CreateAndShow3D_Frame`. Owned here, but
  // mirrored to App when asked so the address can say `/pcb/3d`.
  const [show3DLocal, setShow3DLocal] = useState(false);
  const show3D = viewer3DOpen ?? show3DLocal;
  const setShow3D = useCallback(
    (open: boolean) => {
      setShow3DLocal(open);
      onViewer3DOpenChange?.(open);
    },
    [onViewer3DOpenChange],
  );
  const show3DRef = useRef(show3D);
  show3DRef.current = show3D;
  const setShow3DRef = useRef(setShow3D);
  setShow3DRef.current = setShow3D;
  /** DIALOG_PASTE_SPECIAL, opened by PCB_CONTROL::Paste for `ACTIONS::pasteSpecial`. */
  const [pasteSpecialDlg, setPasteSpecialDlg] = useState<{
    showClearNets: boolean;
    resolve: (aResult: { mode: PASTE_MODE; clearNets: boolean } | null) => void;
  } | null>(null);
  /**
   * `DIALOG_FILTER_SELECTION( m_frame, opts )` as PCB_SELECTION_TOOL::
   * filterSelection shows it: the tool's options being edited, and the
   * `ShowModal()` it waits on.
   */
  /** EDIT_TOOL's `WX_UNIT_ENTRY_DIALOG`, with the answer it waits on. */
  const [unitEntryDlg, setUnitEntryDlg] = useState<{
    title: string;
    label: string;
    value: number;
    resolve: (aValue: number | null) => void;
  } | null>(null);
  /** EDIT_TOOL's `GetDogboneParams` WX_MULTI_ENTRY_DIALOG. */
  const [dogboneDlg, setDogboneDlg] = useState<{
    params: DOGBONE_PARAMETERS;
    resolve: (aParams: DOGBONE_PARAMETERS | null) => void;
  } | null>(null);
  /** EDIT_TOOL's `DIALOG_MOVE_EXACT`. */
  const [moveExactDlg, setMoveExactDlg] = useState<{
    values: MOVE_EXACT_VALUES;
    box: KBOX2I;
    resolve: (aValues: MOVE_EXACT_VALUES | null) => void;
  } | null>(null);
  const [filterDlg, setFilterDlg] = useState<{
    opts: SelectionFilter;
    resolve: (aOk: boolean, aEdited?: SelectionFilter) => void;
  } | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  /**
   * `DIALOG_BOARD_STATISTICS::saveReportClicked`: the report is a generated
   * output, so it takes the same route as a plot - the file manager when the
   * host offers one, a download when it does not.
   */
  const saveReportFile = useCallback(
    (text: string, name: string) => {
      if (onOutputFile) {
        onOutputFile(name, new TextEncoder().encode(text), 'text/plain');
        return;
      }

      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    [onOutputFile],
  );
  /** POSITION_RELATIVE_TOOL's modeless dialog, for as long as the tool keeps it. */
  const [posRelDialog, setPosRelDialog] = useState<DIALOG_POSITION_RELATIVE | null>(null);
  /** POSITION_RELATIVE_TOOL's DIALOG_OFFSET_ITEM, with the promise the tool waits on. */
  const [offsetDlg, setOffsetDlg] = useState<{
    dialog: DIALOG_OFFSET_ITEM;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS. */
  const [editTgDlg, setEditTgDlg] = useState<DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS | null>(null);
  /** PCB_EDIT_FRAME::ShowExchangeFootprintsDialog's DIALOG_EXCHANGE_FOOTPRINTS. */
  const [exchangeDlg, setExchangeDlg] = useState<DIALOG_EXCHANGE_FOOTPRINTS | null>(null);
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS. */
  const [editTvDlg, setEditTvDlg] = useState<DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS | null>(null);
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_DELETION, with the promise the tool waits on. */
  const [globalDelDlg, setGlobalDelDlg] = useState<{
    dialog: DIALOG_GLOBAL_DELETION;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  /** GLOBAL_EDIT_TOOL's DIALOG_UNUSED_PAD_LAYERS. */
  const [unusedPadsDlg, setUnusedPadsDlg] = useState<DIALOG_UNUSED_PAD_LAYERS | null>(null);
  /** GLOBAL_EDIT_TOOL's DIALOG_CLEANUP_GRAPHICS. */
  const [cleanupGfxDlg, setCleanupGfxDlg] = useState<DIALOG_CLEANUP_GRAPHICS | null>(null);
  /** GLOBAL_EDIT_TOOL's DIALOG_CLEANUP_TRACKS_AND_VIAS. */
  const [cleanupDlg, setCleanupDlg] = useState<DIALOG_CLEANUP_TRACKS_AND_VIAS | null>(null);
  /** GLOBAL_EDIT_TOOL's DIALOG_SWAP_LAYERS, with the promise the tool waits on. */
  const [swapLayersDlg, setSwapLayersDlg] = useState<{
    dialog: DIALOG_SWAP_LAYERS;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  /** PAD_TOOL's dialogs, each with the promise the tool waits on. */
  const [pushPadDlg, setPushPadDlg] = useState<{
    dialog: DIALOG_PUSH_PAD_PROPERTIES;
    resolve: (aReturnCode: number) => void;
  } | null>(null);
  const [enumPadsDlg, setEnumPadsDlg] = useState<{
    dialog: DIALOG_ENUM_PADS;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  const [padTableDlg, setPadTableDlg] = useState<DIALOG_FP_EDIT_PAD_TABLE | null>(null);
  /** CONVERT_TOOL's modal dialogs, each with the promise the tool waits on. */
  const [outsetDlg, setOutsetDlg] = useState<{
    params: OUTSET_PARAMETERS;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  const [convertDlg, setConvertDlg] = useState<{
    dialog: CONVERT_SETTINGS_DIALOG;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  const [zoneConvertDlg, setZoneConvertDlg] = useState<{
    kind: 'ruleArea' | 'nonCopper' | 'copper';
    zoneSettings: ZONE_SETTINGS;
    convertSettings: CONVERT_SETTINGS;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  const [oneLayerDlg, setOneLayerDlg] = useState<{
    notAllowed: LSET;
    resolve: (aLayer: PCB_LAYER_ID) => void;
  } | null>(null);
  /**
   * ROUTER_TOOL's three dialogs (`SettingsDialog`, `DpDimensionsDialog`,
   * `CustomTrackWidthDialog`): what each was opened on, and how it answers the
   * coroutine waiting in RunMainStackModal.
   */
  const [pnsSettingsReq, setPnsSettingsReq] = useState<{
    settings: RoutingSettings;
    resolve: () => void;
  } | null>(null);
  const [dpDimsReq, setDpDimsReq] = useState<{
    value: DiffPairDimensionsValue;
    resolve: (aValue: DiffPairDimensionsValue | null) => void;
  } | null>(null);
  const [trackViaSizeReq, setTrackViaSizeReq] = useState<{
    value: CustomTrackViaSize;
    resolve: (aValue: CustomTrackViaSize | null) => void;
  } | null>(null);
  const [arrayOpen, setArrayOpen] = useState(false);
  // Kept across openings, as upstream persists its ARRAY_OPTIONS.
  const [arraySettings, setArraySettings] = useState<ArraySettings>(DEFAULT_ARRAY_SETTINGS);
  // Kept across openings, as upstream keeps its PARAMETERS on the tool.
  // Live (world) cursor position read by draw()'s crosshair pass without
  // re-creating the callback; null when the pointer is off the canvas.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  // The two snap modifiers, as the tool events carry them.
  //
  // Shift disables snapping to *items*, leaving the plain grid
  // (`m_gridHelper->SetSnap( !aEvent.Modifier( MD_SHIFT ) )`); Ctrl disables
  // the *grid*, which is `TOOL_EVENT::DisableGridSnapping()` — literally
  // `Modifier( MD_CTRL )` (tool_event.h:367) — and every tool feeds it to
  // `SetUseGrid( GetGridSnapping() && !evt->DisableGridSnapping() )`.
  //
  // Both are tracked on key events as well as pointer events. Sampling them
  // only on pointer move means pressing or releasing a modifier with the mouse
  // held still changes nothing until the pointer is jiggled, and upstream
  // reacts at once because the modifier arrives as its own tool event.
  const shiftDownRef = useRef(false);
  /** `GetUserUnits()`, for the paint pass — `unitLabel` is computed far below. */
  const unitsRef = useRef<StatusUnits>('mm');
  const ctrlDownRef = useRef(false);
  const [scale, setScale] = useState(0);
  // Active grid size (the TOP_AUX grid selector; EDA_DRAW_FRAME's grid list).
  //
  // Seeded from `window.grid.last_size_idx` and written back on every change,
  // which is what carries the choice across a reload: `COMMON_TOOLS::GridPreset`
  // takes an `int&` straight into the settings object and mutates it in place
  // (`common_tools.cpp:536`), so upstream never writes it explicitly either.
  const [gridIU, setGridIU] = useState(() => storedPcbGridIU(pcbCfg));
  const gridIURef = useRef(gridIU);
  gridIURef.current = gridIU;
  /** {@link setGridIU}, plus the write-back that makes the choice survive. */
  const setGridIUStored = useCallback((iu: number) => {
    setGridIU(iu);
    updatePcbnewSettings((s) => {
      const idx = pcbGridSizesIU(s).indexOf(iu);
      if (idx >= 0) s.window.grid.last_size_idx = idx;
    });
  }, []);
  // The board's own grid origin (`(setup (grid_origin))`), which pcbnew hands
  // to the GAL on open (pcb_base_edit_frame.cpp) and which both the dots and
  // the snap are measured from. A ref because `draw` and the pointer handlers
  // read it without wanting to be rebuilt when the board object is replaced.
  const gridOriginRef = useRef<{ x: number; y: number }>(PCB_DEFAULT_GRID_ORIGIN);
  gridOriginRef.current =
    frameRef.current?.GetBoard()?.GetDesignSettings().GetGridOrigin() ?? PCB_DEFAULT_GRID_ORIGIN;
  // `GRID_HELPER::m_auxAxis` — the point the current gesture started from, kept
  // reachable for its whole duration so an off-grid item can be put back
  // exactly where it came from. Set at the start of a move/drag and cleared
  // when it ends, as `ROUTER_TOOL` (router_tool.cpp:2190, :2654) and
  // `EDIT_TOOL` (edit_tool_move_fct.cpp:1401) do.
  const auxAxisRef = useRef<{ x: number; y: number } | null>(null);
  // `PCB_GRID_HELPER`'s state, as the ported Align / AlignToSegment /
  // AlignToArc read it. Rebuilt per call rather than held, because the two
  // flags upstream pokes onto a long-lived helper (`SetUseGrid`, `SetSnap`)
  // are both derived here: grid snapping follows the toggle, and `enableSnap`
  // is cleared while Shift is held, exactly as `TOOL_BASE::updateEndItem` does
  // with `SetSnap( !aEvent.Modifier( MD_SHIFT ) )`.
  const gridState = (): PcbGridState => ({
    size: gridIURef.current,
    origin: gridOriginRef.current,
    // `PCB_GRID_HELPER::canUseGrid()` = `GetGridSnapping()` AND no Ctrl.
    // `GAL::GetGridSnapping` is the Snap to grid choice on Display Options —
    // ALWAYS, WITH_GRID (only while the grid is shown) or NEVER — which is why
    // the predicate is shared with every other editor rather than being the
    // modifier alone, as it was here.
    enableGrid: gridSnapRef.current && !ctrlDownRef.current,
    enableSnap: !shiftDownRef.current,
    auxAxis: auxAxisRef.current,
  });
  /**
   * The editor's `PCB_GRID_HELPER`, held for its life as a tool holds its
   * `m_gridHelper` (`PCB_TOOL_BASE`, `ROUTER_TOOL`, `EDIT_TOOL`); each ask
   * pokes this event's state into it, as upstream's handlers call
   * `SetUseGrid` / `SetSnap` / `SetAuxAxes` on the long-lived one.
   */
  const gridHelperRef = useRef<PCB_GRID_HELPER | null>(null);
  const gridHelperMgrRef = useRef<TOOL_MANAGER | null>(null);
  const gridHelper = (): PCB_GRID_HELPER => {
    const mgr = frameRef.current?.GetToolManager() ?? null;
    if (!gridHelperRef.current || gridHelperMgrRef.current !== mgr) {
      // `PCB_GRID_HELPER( m_toolMgr, frame()->GetMagneticItemsSettings() )`, as
      // every tool makes it: the grid and the items come from the frame's VIEW
      // and live BOARD. Before the frame exists, a stateless one for the grid.
      gridHelperRef.current = mgr
        ? new PCB_GRID_HELPER(mgr, frameRef.current!.GetMagneticItemsSettings())
        : new PCB_GRID_HELPER();
      gridHelperMgrRef.current = mgr;
      // The canvas is the helper's VIEW: its snap point and construction
      // preview are drawn on the overlay, which repaints when they change.
      gridHelperRef.current.AttachView(() => requestDrawRef.current());
    }
    return mgr ? gridHelperRef.current : gridHelperRef.current.SetState(gridState());
  };

  // Every grid snap in the editor, through the one function upstream uses.
  // Calling `computeNearest` directly anywhere would bypass the auxiliary axis
  // and quantise the gesture's origin away again — which is the bug this is
  // here to prevent, so there is deliberately no other route to the grid.
  const snapToGrid = (p: { x: number; y: number }): { x: number; y: number } =>
    gridHelper().Align(p);
  // Where the routing crosshair actually goes — `controls()->ForceCursorPosition(
  // true, m_endSnapPoint )` at the end of `TOOL_BASE::updateEndItem`. `draw` is
  // memoised long before `copperAt` exists, so it reads the live one off a ref
  // that is re-pointed below once `copperAt` is in scope.
  const routeSnapRef =
    useRef<(w: { x: number; y: number }) => { x: number; y: number }>(snapToGrid);
  // The crosshair sticks to copper only while routing. In pcbnew the general
  // cursor does not: a track contributes its two ends as `CORNER | SNAPPABLE`
  // anchors and its midpoint as `ORIGIN` *without* `SNAPPABLE`
  // (pcb_grid_helper.cpp:1796-1808), and `BestSnapAnchor` weighs only the
  // snappable ones — so nothing there can pull the selection cursor onto the
  // middle of a track. That behaviour belongs to the router alone.
  // Held in a ref, like everything else `draw` reads: `draw` is a useCallback,
  // and closing over a function rebuilt each render would put it in the
  // dependency list and rebuild the whole draw pass on every keystroke.
  const cursorSnapRef =
    useRef<(w: { x: number; y: number }) => { x: number; y: number }>(snapToGrid);
  cursorSnapRef.current = (w) => {
    if (activeToolRef.current === 'routeSingleTrack' || activeToolRef.current === 'routeDiffPair')
      return routeSnapRef.current(w);

    // The plain selection tool does not snap to items on hover in pcbnew:
    // nothing in `PCB_SELECTION_TOOL`'s motion path calls `BestSnapAnchor`,
    // while the drawing, placement, picker and move tools all do.
    if (!isClickTool(activeToolRef.current)) return snapToGrid(w);
    // The pickers that `SetSnapping( false )` — see `picker_snap.ts`.
    if (pickerSnapsToGridOnly(activeToolRef.current)) return snapToGrid(w);

    if (!frameRef.current?.GetToolManager()) return snapToGrid(w);

    // `BestSnapAnchor( aOrigin, nullptr )` (pcb_grid_helper.cpp:568-590): the
    // frame's active layer, its magnetic settings and the view's snap radius.
    return gridHelper().BestSnapAnchor(w, null);
  };
  // TOP_AUX track-width / via-size selections: index 0 = "use netclass",
  // 1.. = the pre-defined list entries (BOARD_DESIGN_SETTINGS m_TrackWidthList /
  // m_ViasDimensionsList; ours come from the project's netclasses).
  const [trackSel, setTrackSel] = useState(0);
  const [viaSel, setViaSel] = useState(0);
  /**
   * `BOARD_DESIGN_SETTINGS::m_UseConnectedTrackWidth` — the TOP_AUX
   * "Automatically select track width" toggle, `false` in the constructor
   * (board_design_settings.cpp:71). The button's checked state is this value
   * (pcb_edit_frame.cpp:1250), and the router reads it through
   * `inheritTrackWidth`.
   */
  const [autoTrackWidth, setAutoTrackWidth] = useState(false);
  const trackSelRef = useRef(trackSel);
  trackSelRef.current = trackSel;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ scale: 0.005, tx: 0, ty: 0, flipX: false });
  /**
   * TRANSITIONAL (#636 stage 3): the view is the VIEW's - WX_VIEW_CONTROLS
   * (the wheel, the drag gestures, autopan) and the tools (`FocusOnLocation`,
   * `zoomFitSelection`) move it - while `viewRef` is the window overlay's copy
   * in its own device-pixel transform, which the window's own zoom commands
   * (the startup fit among them) still write. Each paint reconciles the two:
   * a window write since the last paint is pushed into the VIEW, and so is the
   * window's transform whenever the GAL's screen has changed size since - the
   * overlay and the GAL canvas are the same box, so the window's transform is
   * the one that is right for the new size, and a push made while the GAL was
   * still unsized (the fit runs on the wrap's first measurement, the panel
   * sizes itself on its own observer) is redone once it is. Anything else is
   * read back from the VIEW.
   */
  const syncedViewRef = useRef<{ view: EditorView; screenX: number; screenY: number } | null>(null);
  const syncWindowViewRef = useRef((aPanel: PCB_DRAW_PANEL_GAL): void => {
    const v = viewRef.current;
    const was = syncedViewRef.current;
    const screen = aPanel.GetGAL().GetScreenPixelSize();
    const windowWrote =
      !was ||
      was.view.scale !== v.scale ||
      was.view.tx !== v.tx ||
      was.view.ty !== v.ty ||
      was.view.flipX !== v.flipX ||
      was.screenX !== screen.x ||
      was.screenY !== screen.y;

    if (windowWrote) {
      syncViewTransform(aPanel, v, dpr);
    } else {
      const now = editorViewOf(aPanel, dpr);

      if (now) Object.assign(v, now);
    }

    syncedViewRef.current = { view: { ...v }, screenX: screen.x, screenY: screen.y };
  });
  const boardRef = useRef<Board | null>(null);
  // Live selection read by draw()'s overlay pass without re-creating the callback.
  const selForDrawRef = useRef<ReadonlySet<BOARD_ITEM>>(selection);
  selForDrawRef.current = selection;
  // The in-progress rubber-band marquee (world coords), read by the overlay pass.
  const boxRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  /**
   * The frame's non-window half: the BOARD, the tool manager and the
   * undo/redo stacks (`PCB_BASE_EDIT_FRAME`). Every edit is a BOARD_COMMIT on
   * the live BOARD; undo and redo are `RestoreCopyFromUndoList/RedoList`.
   * The settings and the dirty flag are reached through refs, so the frame is
   * built once.
   */
  const pcbCfgRef = useRef(pcbCfg);
  pcbCfgRef.current = pcbCfg;
  /**
   * `SaveSettings( config() )` then the manager's save: what a tool changed in
   * the PCBNEW_SETTINGS object, written into the `pcbnew.json` slice. Only a
   * changed object writes, so an idle pass costs a compare.
   */
  /** The slice the PCBNEW_SETTINGS object was last loaded from. */
  const loadedPcbCfgRef = useRef<typeof pcbCfg | null>(null);
  const commonCfgRef = useRef(commonCfg);
  commonCfgRef.current = commonCfg;
  const storePcbnewSettingsRef = useRef((): void => {
    // COMMON_SETTINGS' `do_not_show_again.*`, which a tool sets in the object.
    const common = PgmOrNull()?.GetCommonSettings();

    if (
      common &&
      storeCommonDoNotShowAgain(common, structuredClone(commonCfgRef.current.do_not_show_again))
    )
      updateCommonSettings((c) => void storeCommonDoNotShowAgain(common, c.do_not_show_again));

    const cfg = Pgm().GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');

    if (!cfg) return;

    // A slice the object has not loaded yet - Preferences wrote it and the
    // effect below has not run - is loaded first, or this store would write the
    // object's older values straight back over it.
    if (loadedPcbCfgRef.current !== pcbCfgRef.current) {
      loadedPcbCfgRef.current = pcbCfgRef.current;
      loadPcbnewSettings(cfg, pcbCfgRef.current);
      frameRef.current?.LoadSettings(cfg);
      return;
    }

    // `SaveSettings( config() )`: the frame's own state - its units, polar
    // coordinates, panes - into the object, then the object into the store.
    frameRef.current?.SaveSettings(cfg);

    if (!storePcbnewSettings(cfg, structuredClone(pcbCfgRef.current))) return;

    updatePcbnewSettings((json) => {
      storePcbnewSettings(cfg, json);
    });
  });
  // `JSON_SETTINGS::Load`: a preference changed in the slice reaches the object.
  useEffect(() => {
    const cfg = Pgm().GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');

    if (!cfg || loadedPcbCfgRef.current === pcbCfg) return;

    loadedPcbCfgRef.current = pcbCfg;
    loadPcbnewSettings(cfg, pcbCfg);
    frameRef.current?.LoadSettings(cfg);
  }, [pcbCfg]);
  const setDirtyRef = useRef(setDirty);
  setDirtyRef.current = setDirty;
  const [frameMsgItems, setFrameMsgItems] = useState<readonly MSG_PANEL_ITEM[]>([]);
  // HOTKEY_CYCLE_POPUP, this frame's one instance (EDA_DRAW_FRAME::m_hotkeyPopup).
  // Its expiry hands the keyboard back with `m_drawFrame->GetCanvas()->SetFocus()`
  // (common/dialogs/hotkey_cycle_popup.cpp:48).
  const glCanvasFocusRef = useRef((): void => {});
  const hotkeyPopup = useHotkeyCyclePopup(() => glCanvasFocusRef.current());
  const hotkeyPopupRef = useRef(hotkeyPopup);
  hotkeyPopupRef.current = hotkeyPopup;
  /**
   * The frame's WX_INFOBAR (`EDA_BASE_FRAME::m_infoBar`): one message at a time,
   * with the hyperlink buttons a caller added, dismissed after `ShowMessageFor`'s
   * time.
   */
  const [frameInfoBar, setFrameInfoBar] = useState<{
    message: string;
    button: WX_INFOBAR_HYPERLINK | null;
  } | null>(null);
  const wxInfoBarRef = useRef<WX_INFOBAR>(
    (() => {
      let buttons: WX_INFOBAR_HYPERLINK[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clear = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      return {
        IsLocked: () => false,
        AddButton: (aButton) => {
          buttons.push(aButton);
        },
        RemoveAllButtons: () => {
          buttons = [];
        },
        ShowMessageFor: (aMessage, aTime) => {
          clear();
          setFrameInfoBar({ message: aMessage, button: buttons[0] ?? null });
          timer = setTimeout(() => setFrameInfoBar(null), aTime);
        },
        Dismiss: () => {
          clear();
          setFrameInfoBar(null);
        },
      };
    })(),
  );
  /**
   * `APPEARANCE_CONTROLS::UpdateDisplayOptions` (appearance_controls.cpp:1479-1513),
   * which `PCB_EDIT_FRAME::OnDisplayOptionsChanged` calls: the panel re-reads the
   * frame's display options and the ratsnest settings. The window also mirrors
   * the zone mode and the opacities, which it paints with.
   */
  const updateDisplayOptionsRef = useRef((): void => {});
  updateDisplayOptionsRef.current = (): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const o = frame.GetDisplayOptions();
    setContrast(
      o.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.HIDDEN
        ? 'hide'
        : o.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.DIMMED
          ? 'dim'
          : 'normal',
    );
    setNetColorMode(
      o.m_NetColorMode === NET_COLOR_MODE.ALL
        ? 'all'
        : o.m_NetColorMode === NET_COLOR_MODE.OFF
          ? 'off'
          : 'ratsnest',
    );
    setOpacity((p) =>
      p.tracks === o.m_TrackOpacity &&
      p.vias === o.m_ViaOpacity &&
      p.pads === o.m_PadOpacity &&
      p.zones === o.m_ZoneOpacity &&
      p.images === o.m_ImageOpacity &&
      p.filledShapes === o.m_FilledShapeOpacity
        ? p
        : {
            tracks: o.m_TrackOpacity,
            vias: o.m_ViaOpacity,
            pads: o.m_PadOpacity,
            zones: o.m_ZoneOpacity,
            images: o.m_ImageOpacity,
            filledShapes: o.m_FilledShapeOpacity,
          },
    );
    setToggles((prev) => {
      const next = new Set(prev);
      next.delete('zoneDisplayFilled');
      next.delete('zoneDisplayOutline');
      if (o.m_ZoneDisplayMode === ZONE_DISPLAY_MODE.SHOW_FILLED) next.add('zoneDisplayFilled');
      else if (o.m_ZoneDisplayMode === ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE)
        next.add('zoneDisplayOutline');
      return next;
    });
    const cfg = frame.GetPcbNewSettings();
    setRatsnestMode(
      !cfg.m_Display.m_ShowGlobalRatsnest
        ? 'off'
        : cfg.m_Display.m_RatsnestMode === RATSNEST_MODE.ALL
          ? 'all'
          : 'visible',
    );
    setObjects((p) =>
      p.ratsnest === cfg.m_Display.m_ShowGlobalRatsnest
        ? p
        : { ...p, ratsnest: cfg.m_Display.m_ShowGlobalRatsnest },
    );
  };
  /** The Layer Display Options radios' `setHighContrastMode` (appearance_controls.cpp:487-497). */
  const onHighContrastMode = (aMode: 'normal' | 'dim' | 'hide'): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const opts = Object.assign(new PCB_DISPLAY_OPTIONS(), frame.GetDisplayOptions());
    opts.m_ContrastModeDisplay =
      aMode === 'hide'
        ? HIGH_CONTRAST_MODE.HIDDEN
        : aMode === 'dim'
          ? HIGH_CONTRAST_MODE.DIMMED
          : HIGH_CONTRAST_MODE.NORMAL;
    frame.SetDisplayOptions(opts);
  };
  /** `APPEARANCE_CONTROLS::onNetColorMode` (appearance_controls.cpp:3400-3413). */
  const onNetColorMode = (aMode: 'all' | 'ratsnest' | 'off'): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const options = Object.assign(new PCB_DISPLAY_OPTIONS(), frame.GetDisplayOptions());
    options.m_NetColorMode =
      aMode === 'all'
        ? NET_COLOR_MODE.ALL
        : aMode === 'ratsnest'
          ? NET_COLOR_MODE.RATSNEST
          : NET_COLOR_MODE.OFF;
    frame.SetDisplayOptions(options);
    frame.GetCanvas()?.GetView().UpdateAllLayersColor();
  };
  /** `APPEARANCE_CONTROLS::onRatsnestMode` (appearance_controls.cpp:3417-3446). */
  const onRatsnestMode = (aMode: 'all' | 'visible' | 'off'): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const cfg = frame.GetPcbNewSettings();
    if (aMode === 'all') {
      cfg.m_Display.m_ShowGlobalRatsnest = true;
      cfg.m_Display.m_RatsnestMode = RATSNEST_MODE.ALL;
    } else if (aMode === 'visible') {
      cfg.m_Display.m_ShowGlobalRatsnest = true;
      cfg.m_Display.m_RatsnestMode = RATSNEST_MODE.VISIBLE;
    } else {
      cfg.m_Display.m_ShowGlobalRatsnest = false;
    }
    frame.SetElementVisibility(GAL_LAYER_ID.LAYER_RATSNEST, cfg.m_Display.m_ShowGlobalRatsnest);
    frame.OnDisplayOptionsChanged();
    frame.GetCanvas()?.RedrawRatsnest();
    frame.GetCanvas()?.Refresh();
    storePcbnewSettingsRef.current();
  };
  /**
   * `APPEARANCE_CONTROLS::onObjectVisibilityChanged( LAYER_RATSNEST, ... )`
   * (appearance_controls.cpp:2216-2237): "ratsnest is enabled on per-item basis", so the
   * layer stays visible and the global flag is the setting's.
   */
  const onRatsnestObjectVisibility = (aVisible: boolean): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const view = frame.GetCanvas()?.GetView();
    view?.MarkTargetDirty(RENDER_TARGET.TARGET_NONCACHED);
    view?.SetLayerVisible(GAL_LAYER_ID.LAYER_RATSNEST, true);
    frame.GetPcbNewSettings().m_Display.m_ShowGlobalRatsnest = aVisible;
    frame.GetBoard()?.SetElementVisibility(GAL_LAYER_ID.LAYER_RATSNEST, aVisible);
    frame.OnDisplayOptionsChanged();
    frame.GetCanvas()?.RedrawRatsnest();
    storePcbnewSettingsRef.current();
  };
  /** `m_toolManager->RunAction( aAction )`: a menu row, a hotkey or a toolbar button. */
  const runAction = (aAction: TOOL_ACTION): void => {
    frameRef.current?.GetToolManager()?.RunAction(aAction);
    refreshInspectionMirrorRef.current();
    storePcbnewSettingsRef.current();
  };
  /** The same, for listeners installed once (the clipboard events). */
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  /**
   * PCB_CONTROL::Paste from a menu row: outside a paste event the browser hands
   * the system clipboard over only asynchronously, so its text is read into the
   * clipboard first.
   */
  const pasteFromSystemClipboard = (aAction: TOOL_ACTION): void => {
    const run = (): void => runActionRef.current(aAction);
    const read = navigator.clipboard?.readText();
    if (read)
      void read.then((text) => {
        SetClipboardFromText(text);
        run();
      }, run);
    else run();
  };
  /**
   * TRANSITIONAL (#636 stage 3): the selection tool's selection and entered
   * group, re-read as the view's ids for the window's own tools.
   */
  const refreshSelectionMirrorRef = useRef((): void => {
    const frame = frameRef.current;
    if (!frame) return;
    const tool = frame.GetSelectionTool();
    const next: ReadonlySet<BOARD_ITEM> = new Set(
      tool.GetSelection().GetItems() as unknown as BOARD_ITEM[],
    );
    enteredGroupRef.current = tool.GetEnteredGroup()?.m_Uuid ?? null;
    selForDrawRef.current = next;
    setSelectionMirror(next);
  });
  /**
   * `PCB_EDIT_FRAME::SwitchLayer` (edit.cpp:72-95): the validated entry
   * point every explicit layer pick (the toolbar combo, a layer hotkey, a
   * saved preset, the zone tool's dialog) goes through, so a disabled
   * copper layer is refused the same way upstream refuses it. The router's
   * own layer-follow (`syncRouterAndFrameLayer`) does not: it mirrors a
   * layer the interactive router session already validated, not a new pick.
   */
  const switchActiveLayer = (layerName: string): void => {
    const id = LSET.NameToLayer(layerName);
    if (frameRef.current?.GetBoard()?.IsLayerEnabled(id)) frameRef.current.SwitchLayer(id);
    setActiveLayer(layerName);
  };
  const drcWindowRef = useRef<{
    createDrcDialog: (aTool: DRC_TOOL, aParent: unknown) => DIALOG_DRC;
    isSingle: () => boolean;
    fetchNetlistFromSchematic: (aNetlist: NETLIST, aMessage: string) => boolean;
    schematicNetlistText: () => string | null;
    projectText: () => string | null;
    editZoneParams: (aZone: ZONE) => void;
    showFindDialog: (aDialog: DIALOG_FIND) => void;
    showPrintDialog: (aDialog: DIALOG_PRINT_PCBNEW) => Promise<void>;
    showSaveFileDialog: NonNullable<PCB_EDIT_FRAME_HOOKS['showSaveFileDialog']>;
    writeTextFile: (aPath: string, aText: string) => boolean;
    showReferenceImagePropertiesDialog: (
      aDialog: DIALOG_REFERENCE_IMAGE_PROPERTIES,
    ) => Promise<boolean>;
    showPadPropertiesDialog: (aDialog: DIALOG_PAD_PROPERTIES) => void;
    showFootprintPropertiesDialog: (aDialog: DIALOG_FOOTPRINT_PROPERTIES) => void;
    showDimensionPropertiesDialog: (aDialog: DIALOG_DIMENSION_PROPERTIES) => void;
    showGraphicItemPropertiesDialog: (aDialog: DIALOG_SHAPE_PROPERTIES) => void;
    selectCopperLayerPair: () => void;
    showInfoBarError: (aMsg: string) => void;
    selectFootprintFromChooser: (aPreselect: string) => Promise<string | null>;
    loadFootprintFromLibrary: (aId: LIB_ID, aKeepUUID: boolean) => Promise<FOOTPRINT | null>;
    findDialogRects: () => BOX2D[];
    setViewCenter: (aPos: KVec2, aRects: readonly BOX2D[]) => void;
  } | null>(null);
  // The window half of `MICROWAVE_TOOL`: its two dialogs and the selection.
  const mwWindowRef = useRef<{
    textEntry: (
      aPrompt: string,
      aCaption: string,
      aValue: string,
      aValidator?: wxTextValidator,
    ) => Promise<string | null>;
    polygonDialog: () => Promise<boolean>;
    showZoneManager: () => Promise<{ ok: boolean; repour: boolean }>;
    fillAllZones: () => void;
  } | null>(null);
  /**
   * The window half of PCB_SELECTION_TOOL and of the frame's selection
   * plumbing: the infobar, the Filter Selection dialog, the panels' re-read of
   * the selection, and (TRANSITIONAL, #636 stage 3) the actions and canvas
   * events the window's own not-yet-ported tools still own.
   */
  const selWindowRef = useRef<{
    showInfoBarWarning: (aMsg: string) => void;
    showFilterSelectionDialog: (aOptions: SelectionFilter) => Promise<boolean>;
    updateProperties: () => void;
    windowAction: WINDOW_ACTION_HANDLER;
    eventToWindow: (aEvent: wxEvent) => boolean;
  } | null>(null);
  /** The window half of EDIT_TOOL (EDIT_TOOL_FRAME through the frame's hooks). */
  const editWindowRef = useRef<{
    showInfoBarMsg: (aMsg: string) => void;
    dismissInfoBar: () => void;
    showUnitEntryDialog: (aTitle: string, aLabel: string, aValue: number) => Promise<number | null>;
    showDogboneDialog: (aParams: DOGBONE_PARAMETERS) => Promise<DOGBONE_PARAMETERS | null>;
    showMoveExactDialog: (
      aValues: MOVE_EXACT_VALUES,
      aBox: KBOX2I,
    ) => Promise<MOVE_EXACT_VALUES | null>;
    showTrackViaPropertiesDialog: (aSelection: PCB_SELECTION) => Promise<void>;
    showGetFootprintByNameDialog: (aList: string[]) => Promise<string | null>;
    showConnectedPadDialog: (
      aTitle: string,
      aMessage: string,
      aDetails: string,
    ) => Promise<'ignore' | 'all' | null>;
    openVertexEditor: () => void;
  } | null>(null);
  if (!frameRef.current) {
    // `PGM_BASE::InitPgm` runs before any KiCad frame exists, and the frame
    // needs it at once: the SetBoard below joins the board to `Prj()`, which is
    // `Pgm().GetSettingsManager().Prj()`. Installing it only in the canvas
    // effect, after this first render, threw "Pgm() called before the PGM_BASE
    // was set" whenever the PCB editor was the first frame to open.
    installPgm();
    frameRef.current = new PCB_EDIT_FRAME({
      // `Kiface().KifaceSettings()`: the one PCBNEW_SETTINGS installPgm keeps.
      settings: () => Pgm().GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew')!,
      storeSettings: () => storePcbnewSettingsRef.current(),
      updateDisplayOptions: () => updateDisplayOptionsRef.current(),
      showFootprintAssociationsDialog: (aFootprint) => setFootprintAssociations(aFootprint),
      showAssignNetclassDialog: (aNames, aCandidates, aPreview) =>
        new Promise<boolean>((resolve) =>
          setNetclassDlg({ names: aNames, candidates: aCandidates, preview: aPreview, resolve }),
        ),
      viewer3DShown: () => show3DRef.current,
      showViewer3D: () => setShow3DRef.current(true),
      reCreateAuxiliaryToolbar: () => {
        const f = frameRef.current;

        if (f) setUserUnitsRef.current(f.GetUserUnits());
      },
      // `m_auimgr.GetPane( aName ).IsShown()`: the docked panes are the window's
      // toggles, by KiCad's pane names. No Design Blocks pane is docked here.
      paneShown: (aName) => {
        const id = PANE_TOGGLE_IDS[aName];
        return id !== undefined && togglesRef.current.has(id);
      },
      onModify: () => {
        setDirtyRef.current(true);
        setBoardSettingsRev((r) => r + 1);
      },
      onUndoRedoIncomplete: () =>
        console.warn('Incomplete undo/redo operation: some items not found'),
      // The window half of DRC_TOOL / DIALOG_DRC: filled in below, once the
      // editor's state and callbacks exist (`drcWindowRef`).
      createDrcDialog: (aTool, aParent) => drcWindowRef.current!.createDrcDialog(aTool, aParent),
      isSingle: () => drcWindowRef.current!.isSingle(),
      // The toolbar follows the tool stack for the TOOL_MANAGER tools: a push
      // from a hotkey arms the button, the tool's PopTool disarms it.
      toolStackChanged: () => {
        const f = frameRef.current;
        if (!f) return;
        const pushed = Object.keys(TOOL_MANAGER_TOOLS).find((k) =>
          f.IsCurrentTool(TOOL_MANAGER_TOOLS[k]!),
        );
        if (pushed) {
          if (activeToolRef.current !== pushed) setActiveTool(pushed);
        } else if (TOOL_MANAGER_TOOLS[activeToolRef.current]) {
          setActiveTool(selectModeRef.current);
        }
      },
      fetchNetlistFromSchematic: (aNetlist, aMessage) =>
        drcWindowRef.current!.fetchNetlistFromSchematic(aNetlist, aMessage),
      schematicNetlistText: () => drcWindowRef.current!.schematicNetlistText(),
      projectText: () => drcWindowRef.current!.projectText(),
      editZoneParams: (aZone) => drcWindowRef.current!.editZoneParams(aZone),
      showFindDialog: (aDialog) => drcWindowRef.current!.showFindDialog(aDialog),
      showPrintDialog: (aDialog) => drcWindowRef.current!.showPrintDialog(aDialog),
      showSaveFileDialog: (aTitle, aName, aWildcard, aCheckbox) =>
        drcWindowRef.current!.showSaveFileDialog(aTitle, aName, aWildcard, aCheckbox),
      writeTextFile: (aPath, aText) => drcWindowRef.current!.writeTextFile(aPath, aText),
      showReferenceImagePropertiesDialog: (aDialog) =>
        drcWindowRef.current!.showReferenceImagePropertiesDialog(aDialog),
      showPadPropertiesDialog: (aDialog) => drcWindowRef.current!.showPadPropertiesDialog(aDialog),
      showFootprintPropertiesDialog: (aDialog) =>
        drcWindowRef.current!.showFootprintPropertiesDialog(aDialog),
      showDimensionPropertiesDialog: (aDialog) =>
        drcWindowRef.current!.showDimensionPropertiesDialog(aDialog),
      showGraphicItemPropertiesDialog: (aDialog) =>
        drcWindowRef.current!.showGraphicItemPropertiesDialog(aDialog),
      selectCopperLayerPair: () => drcWindowRef.current!.selectCopperLayerPair(),
      showInfoBarError: (aMsg) => drcWindowRef.current?.showInfoBarError(aMsg),
      /** `m_appearancePanel->OnLayerChanged()`: the layer combo follows a layer a tool chose. */
      showPnsSettingsDialog: (aSettings) =>
        new Promise<void>((resolve) => setPnsSettingsReq({ settings: aSettings, resolve })),
      showDiffPairDimensionsDialog: (aValue) =>
        new Promise((resolve) => setDpDimsReq({ value: aValue, resolve })),
      showTrackViaSizeDialog: (aValue) =>
        new Promise((resolve) => setTrackViaSizeReq({ value: aValue, resolve })),
      activeLayerChanged: (aLayer) => {
        if (frameRef.current?.GetBoard()?.IsLayerEnabled(aLayer)) setActiveLayer(LSET.Name(aLayer));
      },
      selectFootprintFromChooser: (aPreselect) =>
        drcWindowRef.current!.selectFootprintFromChooser(aPreselect),
      loadFootprintFromLibrary: (aId, aKeepUUID) =>
        drcWindowRef.current!.loadFootprintFromLibrary(aId, aKeepUUID),
      showExchangeFootprintsDialog: (aDialog) => setExchangeDlg(aDialog),
      findDialogRects: () => drcWindowRef.current!.findDialogRects(),
      setViewCenter: (aPos, aRects) => drcWindowRef.current!.setViewCenter(aPos, aRects),
      // The `$NET:` probe's highlight, kept as the same set when it is unchanged
      // so the send-back below does not fire for it.
      // MAIL_SELECTION(_FORCE): the frame has checked `on_selection` already,
      // so the parts are applied as a forced probe.
      updatePcbFromSchematic: () => void openUpdatePcbRef.current(),
      // The Footprint Library Browser's Insert: `PlacingFootprint()` and the
      // placement it posts. Both read the placement state declared below.
      placingFootprint: () =>
        (
          frameRef.current?.GetToolManager()?.FindTool('pcbnew.EditorControl') as unknown as
            | BOARD_EDITOR_CONTROL
            | null
            | undefined
        )?.PlacingFootprint() ?? false,
      placeFootprintFromLibrary: (aFpid, aFootprint) =>
        placeFromBrowserRef.current(aFpid, aFootprint),
      textEntry: (aPrompt, aCaption, aValue, aValidator) =>
        mwWindowRef.current!.textEntry(aPrompt, aCaption, aValue, aValidator),
      mwavePolygonalShapeDialog: () => mwWindowRef.current!.polygonDialog(),
      showZoneManager: () => mwWindowRef.current!.showZoneManager(),
      // PCB_SELECTION_TOOL's window half: filled in below, once the editor's
      // state and callbacks exist (`selWindowRef`).
      showInfoBarWarning: (aMsg) => selWindowRef.current?.showInfoBarWarning(aMsg),
      showFilterSelectionDialog: (aOptions) =>
        selWindowRef.current?.showFilterSelectionDialog(aOptions) ?? Promise.resolve(false),
      updateProperties: () => selWindowRef.current?.updateProperties(),
      windowAction: (aAction, aEvent) => selWindowRef.current?.windowAction(aAction, aEvent),
      // EDIT_TOOL's window half: its dialogs, the infobar and the vertex editor.
      showInfoBarMsg: (aMsg) => editWindowRef.current?.showInfoBarMsg(aMsg),
      showUnitEntryDialog: (aTitle, aLabel, aValue) =>
        editWindowRef.current?.showUnitEntryDialog(aTitle, aLabel, aValue) ?? Promise.resolve(null),
      showDogboneDialog: (aParams) =>
        editWindowRef.current?.showDogboneDialog(aParams) ?? Promise.resolve(null),
      showMoveExactDialog: (aValues, aBox) =>
        editWindowRef.current?.showMoveExactDialog(aValues, aBox) ?? Promise.resolve(null),
      showTrackViaPropertiesDialog: (aSelection) =>
        editWindowRef.current?.showTrackViaPropertiesDialog(aSelection) ?? Promise.resolve(),
      showGetFootprintByNameDialog: (aList) =>
        editWindowRef.current?.showGetFootprintByNameDialog(aList) ?? Promise.resolve(null),
      showConnectedPadDialog: (aTitle, aMessage, aDetails) =>
        editWindowRef.current?.showConnectedPadDialog(aTitle, aMessage, aDetails) ??
        Promise.resolve(null),
      openVertexEditor: () => editWindowRef.current?.openVertexEditor(),
      // CONVERT_TOOL's window half: its four modal dialogs, each a promise.
      showConvertSettingsDialog: (aSettings, aCopyLineWidth, aCenterline, aBoundingHull) =>
        new Promise<boolean>((resolve) =>
          setConvertDlg({
            dialog: new CONVERT_SETTINGS_DIALOG(aSettings, {
              copyLineWidth: aCopyLineWidth,
              centerline: aCenterline,
              boundingHull: aBoundingHull,
            }),
            resolve,
          }),
        ),
      showZoneEditorForConversion: (aKind, aZoneSettings, aConvertSettings) =>
        new Promise<boolean>((resolve) =>
          setZoneConvertDlg({
            kind: aKind,
            zoneSettings: aZoneSettings,
            convertSettings: aConvertSettings,
            resolve,
          }),
        ),
      selectOneLayer: (_aDefaultLayer, aNotAllowedLayersMask) =>
        new Promise<PCB_LAYER_ID>((resolve) =>
          setOneLayerDlg({ notAllowed: aNotAllowedLayersMask, resolve }),
        ),
      showOutsetItemsDialog: (aParams) =>
        new Promise<boolean>((resolve) => setOutsetDlg({ params: aParams, resolve })),
      // POSITION_RELATIVE_TOOL's window half.
      attachPositionRelativeDialog: (aDialog) => setPosRelDialog(aDialog),
      showOffsetItemDialog: (aDialog) =>
        new Promise<boolean>((resolve) => setOffsetDlg({ dialog: aDialog, resolve })),
      // GLOBAL_EDIT_TOOL's window half.
      showCleanupTracksAndViasDialog: (aDialog) => setCleanupDlg(aDialog),
      showCleanupGraphicsDialog: (aDialog) => setCleanupGfxDlg(aDialog),
      showUnusedPadLayersDialog: (aDialog) => setUnusedPadsDlg(aDialog),
      showGlobalEditTracksAndViasDialog: (aDialog) => setEditTvDlg(aDialog),
      showGlobalEditTextAndGraphicsDialog: (aDialog) => setEditTgDlg(aDialog),
      // The "Choose Image" dialog: a file input, read as bytes. Cancel answers
      // null (the input's `cancel` event), which leaves the tool armed, as
      // upstream's `continue` does.
      showPasteSpecialDialog: (aShowClearNets) =>
        new Promise((resolve) => setPasteSpecialDlg({ showClearNets: aShowClearNets, resolve })),
      showPageSettingsDialog: () => new Promise<boolean>((resolve) => setPageDlg({ resolve })),
      showImportGraphicsDialog: () =>
        new Promise<IMPORT_GRAPHICS_RESULT | null>((resolve) => setImportGfxDlg({ resolve })),
      showBarcodePropertiesDialog: (aDialog) =>
        new Promise<boolean>((resolve) => openBarcodeProps(aDialog, resolve)),
      showTextBoxPropertiesDialog: (aDialog) =>
        new Promise<boolean>((resolve) => setTextBoxPropsDlg({ dialog: aDialog, resolve })),
      showImageFileDialog: () =>
        new Promise<Uint8Array | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.addEventListener('cancel', () => resolve(null));
          input.onchange = (): void => {
            const file = input.files?.[0];
            if (!file) {
              resolve(null);
              return;
            }
            void file.arrayBuffer().then(
              (b) => resolve(new Uint8Array(b)),
              () => resolve(null),
            );
          };
          input.click();
        }),
      showTablePropertiesDialog: (aDialog) =>
        new Promise<boolean>((resolve) =>
          setTablePropsDlg({ dialog: aDialog, table: aDialog.GetTable(), resolve }),
        ),
      showZoneSettingsDialog: (aDialog) =>
        new Promise<boolean>((resolve) => setZoneSettingsDlg({ dialog: aDialog, resolve })),
      showTextPropertiesDialog: (aDialog) =>
        new Promise<boolean>((resolve) => setTextPropsDlg({ dialog: aDialog, resolve })),
      showGlobalEditTeardropsDialog: (aDialog) => setTeardropsDlg(aDialog),
      showGlobalDeletionDialog: (aDialog) =>
        new Promise<boolean>((resolve) => setGlobalDelDlg({ dialog: aDialog, resolve })),
      askKiDialog: (aRequest) => askKiDialogRef.current(aRequest),
      showSwapLayersDialog: (aDialog) =>
        new Promise<boolean>((resolve) => setSwapLayersDlg({ dialog: aDialog, resolve })),
      // PAD_TOOL's window half.
      showPushPadPropertiesDialog: (aDialog) =>
        new Promise<number>((resolve) => setPushPadDlg({ dialog: aDialog, resolve })),
      showEnumPadsDialog: (aDialog) =>
        new Promise<boolean>((resolve) => setEnumPadsDlg({ dialog: aDialog, resolve })),
      showPadTableDialog: (aDialog) => setPadTableDlg(aDialog),
      dismissInfoBar: () => editWindowRef.current?.dismissInfoBar(),
      eventToWindow: (aEvent) => selWindowRef.current?.eventToWindow(aEvent) ?? false,
      highlightChanged: () => refreshInspectionMirrorRef.current(),
      showBoardStatisticsDialog: () => setStatsOpen(true),
    });
    // `PCB_EDIT_FRAME::PCB_EDIT_FRAME`: `SetBoard( new BOARD() )` (:250) --
    // the frame never has no board, and the empty one's drawing sheet is on
    // the VIEW from the first frame, fitted by the constructor's
    // zoomFitScreen. Without it the canvas was bare until the load's own
    // SetBoard, seconds later.
    if (emptyBoard.k) frameRef.current.SetBoard(emptyBoard.k, false);
    // The frame's WX_INFOBAR and HOTKEY_CYCLE_POPUP are page widgets this
    // window renders; it hands them over as the C++ constructor creates them.
    frameRef.current.SetInfoBar(wxInfoBarRef.current);
    frameRef.current.SetHotkeyPopup({
      Popup: (aTitle, aItems, aSelection) =>
        hotkeyPopupRef.current.popup(aTitle, aItems, aSelection),
    });
  }
  // `KIWAY::Player()` stores the frame it created as FRAME_PCB_EDITOR's player,
  // and the frame's close tells KIWAY it is gone (`PlayerDidClose`).
  useEffect(() => {
    const frame = frameRef.current;
    if (!kiway || !frame) return;
    frame.SetKiway(kiway);
    kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, frame);
    return () => {
      kiway.PlayerDidClose(FRAME_T.FRAME_PCB_EDITOR, frame);
      frame.SetKiway(null);
    };
  }, [kiway]);
  // The frame's modeless book-reporter dialogs (GetInspectDrcErrorDialog and
  // its siblings): the tools make and fill them, this draws the live ones.
  const [bookReporters, setBookReporters] = useState<DIALOG_BOOK_REPORTER[]>([]);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const sync = (): void => setBookReporters(frame.GetBookReporterDialogs());
    frame.SetBookReporterListener(sync);
    sync();
    return () => frame.SetBookReporterListener(null);
  }, []);
  // Mirror of the active right-toolbar tool for the pointer/Escape handlers.
  const activeToolRef = useRef('selectSetRect');
  /**
   * Both selection-mode ids ARE the selection tool.
   *
   * `SetSelectRect` and `SetSelectPoly` set `m_selectionMode` and post
   * `ACTIONS::selectionTool` (`pcb_selection_tool.cpp:1348-1363`) — neither
   * pushes a tool, and the mode outlives every tool that is pushed. So
   * `ToolStackIsEmpty` is either id, and Esc out of a tool returns to the
   * MODE the user chose rather than resetting it to the rectangle.
   */
  const selectModeRef = useRef('selectSetRect');
  if (isSelectTool(activeTool)) selectModeRef.current = activeTool;
  activeToolRef.current = activeTool;

  // Arming a TOOL_MANAGER tool runs its action the way the toolbar does (no
  // position, so nothing is primed at the cursor); arming anything else while
  // one is current activates the selection tool, which the drawing tool reads
  // as `IsActivate()`: cleanup and PopTool.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeTool is the trigger; the frame is read through its ref
  useEffect(() => {
    const f = frameRef.current;
    const mgr = f?.GetToolManager();
    if (!f || !mgr) return;
    const action = TOOL_MANAGER_TOOLS[activeTool];
    if (action) {
      if (f.IsCurrentTool(action)) return;
      const evt = action.MakeEvent();
      evt.SetHasPosition(false);
      mgr.ProcessEvent(evt);
    } else if (Object.values(TOOL_MANAGER_TOOLS).some((a) => f.IsCurrentTool(a))) {
      mgr.RunAction(ACTIONS.selectionTool);
    }
  }, [activeTool]);
  // Page Settings / Print dialogs (DIALOG_PAGES_SETTINGS / DIALOG_PRINT_PCBNEW).
  // The tab title (PCB_EDIT_FRAME::UpdateTitle): the board file, its project,
  // and a leading * while there are unsaved changes.
  useDocumentTitle(
    'pcb',
    formatTitle(
      PCB_FRAME_NAME,
      projectName ? `${fileName.split('/').pop()!} [${projectName}]` : fileName,
      dirty,
    ),
  );

  // BOARD_EDITOR_CONTROL::PageSettings's DIALOG_PAGES_SETTINGS: the tool waits
  // on `resolve` (true when OK wrote the page and title block into the frame).
  const [pageDlg, setPageDlg] = useState<{ resolve: (aOk: boolean) => void } | null>(null);
  // DIALOG_PRINT_PCBNEW while PCB_CONTROL::Print shows it, and its messages.
  const [printDlg, setPrintDlg] = useState<{ dlg: DIALOG_PRINT_PCBNEW; done: () => void } | null>(
    null,
  );
  /**
   * A generated text file into the project: the file manager when the host
   * offers one, a download when it does not (as a plot goes).
   */
  const writeOutputText = (aName: string, aText: string): void => {
    if (onOutputFile) {
      onOutputFile(aName, new TextEncoder().encode(aText), 'text/plain');
      return;
    }

    const url = URL.createObjectURL(new Blob([aText], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = aName;
    a.click();
    URL.revokeObjectURL(url);
  };
  /** PCB_EDIT_FRAME::ShowSaveFileDialog's wxFileDialog, while it is up. */
  const [saveFileDlg, setSaveFileDlg] = useState<{
    title: string;
    name: string;
    wildcard: ChooserFilter;
    checkbox: { label: string; value: boolean } | null;
    checked: boolean;
    resolve: (aResult: { path: string; checked: boolean } | null) => void;
  } | null>(null);
  const [printMessage, setPrintMessage] = useState<{ message: string; error: boolean } | null>(
    null,
  );
  const [plotDlgOpen, setPlotDlgOpen] = useState(false);
  // Folders that already exist in the project, relative to the project's own
  // folder, the Plot dialog's "Output directory:" choices (the cloud file
  // manager stands in for upstream's wxDirDialog).
  const projectFolders = useMemo(() => {
    const files = projectFiles ?? [];
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name))?.name.replace(/\\/g, '/');
    const prefix = pro?.includes('/') ? pro.slice(0, pro.lastIndexOf('/') + 1) : '';
    const dirs = new Set<string>();
    for (const f of files) {
      const p = f.name.replace(/\\/g, '/');
      if (prefix && !p.startsWith(prefix)) continue;
      const rel = p.slice(prefix.length);
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (dir) dirs.add(dir);
    }
    return [...dirs];
  }, [projectFiles]);
  // Board Setup (DIALOG_BOARD_SETUP). Hydrated from the project's .kicad_pro
  // + the board file's setup sections + the .kicad_dru; committed back to all
  // three on OK (see commitBoardSetup below).
  const [boardSetupOpen, setBoardSetupOpen] = useState(false);
  // ShowBoardSetupDialog( _( "Net Classes" ) ) — the Appearance panel's wrench
  // opens Board Setup already on that page, not on its first one.
  const [boardSetupPage, setBoardSetupPage] = useState<BoardSetupPageId | undefined>(undefined);
  // DRC dialog (DIALOG_DRC), the engine runs in-browser over the live board.
  // The dialog is modeless like upstream; the violations become PCB_MARKERs
  // that stay on the board until the next run / Delete All Markers, and the
  // active violation is the brightened (highlighted) marker.
  // `DRC_TOOL::m_drcDialog`: the DIALOG_DRC the tool created through the
  // frame's CreateDrcDialog, and whether it is shown (Show( false ) on a
  // double-clicked row hides it without destroying it).
  const [drcDialog, setDrcDialog] = useState<{ dialog: DIALOG_DRC; shown: boolean } | null>(null);
  // The modal sub-dialogs DIALOG_DRC raises: "Delete exclusions too?"
  const [drcYesNoCancel, setDrcYesNoCancel] = useState<{
    resolve: (r: 'yes' | 'no' | 'cancel') => void;
  } | null>(null);
  // ...its "Save Report File" (wxFileDialog, wxFD_SAVE)...
  const [drcSaveReport, setDrcSaveReport] = useState<{
    defaultName: string;
    resolve: (path: string | null) => void;
  } | null>(null);
  // ...and "Exclusion Comment" (WX_TEXT_ENTRY_DIALOG).
  const [drcTextEntry, setDrcTextEntry] = useState<{
    caption: string;
    initial: string;
    resolve: (value: string | null) => void;
  } | null>(null);
  // Edit Teardrops (DIALOG_GLOBAL_EDIT_TEARDROPS).
  /** GLOBAL_EDIT_TOOL's DIALOG_GLOBAL_EDIT_TEARDROPS. */
  const [teardropsDlg, setTeardropsDlg] = useState<DIALOG_GLOBAL_EDIT_TEARDROPS | null>(null);
  // Track & Via Properties (DIALOG_TRACK_VIA_PROPERTIES), opened by E or a
  // double-click on a copper item.
  // DIALOG_TRACK_VIA_PROPERTIES on these items (EDIT_TOOL::Properties' selection).
  const [trackViaItems, setTrackViaItems] = useState<readonly EDA_ITEM[] | null>(null);
  // Set Layer Pair... (SELECT_COPPER_LAYERS_PAIR_DIALOG), Edit > Route.
  const [layerPairDialogOpen, setLayerPairDialogOpen] = useState(false);
  // The KIDIALOGs its OK asks (confirmShortingNets, confirmPadChange).
  const { ask: askKiDialog, node: kiDialogNode } = useKiDialog();
  const askKiDialogRef = useRef(askKiDialog);
  askKiDialogRef.current = askKiDialog;
  // Edit_Zone_Params: the zone whose properties dialog is up.
  const [zoneProps, setZoneProps] = useState<ZONE | null>(null);
  // Footprint Properties (DIALOG_FOOTPRINT_PROPERTIES), board side.
  const [fpPropsDlg, setFpPropsDlg] = useState<DIALOG_FOOTPRINT_PROPERTIES | null>(null);
  // Footprint Associations (DIALOG_FOOTPRINT_ASSOCIATIONS), on the selected footprint.
  const [footprintAssociations, setFootprintAssociations] = useState<FOOTPRINT | null>(null);
  // Pad Properties (DIALOG_PAD_PROPERTIES), board side.
  const [padPropsDlg, setPadPropsDlg] = useState<DIALOG_PAD_PROPERTIES | null>(null);
  // Text / Shape properties for board graphics.
  /**
   * DIALOG_TEXT_PROPERTIES on a live PCB_TEXT: the board's own (Properties on a
   * selected text) or DRAWING_TOOL::PlaceText's new one, which waits on `resolve`.
   */
  /**
   * ZONE_CREATE_HELPER::createNewZone's properties dialog, on a ZONE_SETTINGS
   * alone: the copper, non-copper or rule-area one, and the tool waiting on it.
   */
  const [zoneSettingsDlg, setZoneSettingsDlg] = useState<{
    dialog: DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR | DIALOG_RULE_AREA_PROPERTIES;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  const [textPropsDlg, setTextPropsDlg] = useState<{
    dialog: DIALOG_TEXT_PROPERTIES;
    resolve?: (aOk: boolean) => void;
  } | null>(null);
  const [shapePropsDlg, setShapePropsDlg] = useState<DIALOG_SHAPE_PROPERTIES | null>(null);
  const [dimensionPropsDlg, setDimensionPropsDlg] = useState<DIALOG_DIMENSION_PROPERTIES | null>(
    null,
  );
  /**
   * DIALOG_TEXTBOX_PROPERTIES on a live PCB_TEXTBOX: the board's own, or
   * DRAWING_TOOL's new one (drawTextBox), which waits on `resolve`.
   */
  const [textBoxPropsDlg, setTextBoxPropsDlg] = useState<{
    dialog: DIALOG_TEXTBOX_PROPERTIES;
    resolve?: (aOk: boolean) => void;
  } | null>(null);
  const [imagePropsDlg, setImagePropsDlg] = useState<{
    dialog: DIALOG_REFERENCE_IMAGE_PROPERTIES;
    resolve: (aOk: boolean) => void;
  } | null>(null);
  /**
   * DIALOG_TABLE_PROPERTIES on a live PCB_TABLE: the board's own, or
   * DRAWING_TOOL::DrawTable's new one, which waits on `resolve`.
   */
  const [tablePropsDlg, setTablePropsDlg] = useState<{
    dialog: DIALOG_TABLE_PROPERTIES;
    table: PCB_TABLE;
    resolve?: (aOk: boolean) => void;
  } | null>(null);
  /** Properties on the view board's table `aIndex`. */
  // Update PCB from Schematic (DIALOG_UPDATE_PCB). The netlist is fetched from the
  // project's schematic before the dialog opens, together with every footprint it
  // names, the updater itself is synchronous, exactly like upstream, so the
  // libraries have to be in hand first (upstream's adapter->BlockUntilLoaded).
  const [updatePcb, setUpdatePcb] = useState<{
    netlist: NETLIST;
    library: Map<string, FOOTPRINT>;
  } | null>(null);
  const [updatePcbBusy, setUpdatePcbBusy] = useState(false);
  // File > Import > Netlist... (DIALOG_IMPORT_NETLIST): the path it opens on is
  // `GetLastPath( LAST_PATH_NETLIST )`, null while the dialog is closed.
  const [importNetlistName, setImportNetlistName] = useState<string | null>(null);
  // Footprint Properties > 3D Models > Browse: `DIALOG_SELECT_3DMODEL::ShowQuasiModal()`
  // is not ported (it is a `3d-viewer/` dialog); a file chooser answers in its place.
  const [pick3dModel, setPick3dModel] = useState<{
    done: (aChosen: SELECTED_3D_MODEL | null) => void;
  } | null>(null);
  const model3dResolverRef = useRef<FILENAME_RESOLVER | null>(null);
  const lastNetlistPathRef = useRef('');
  const [updatePcbError, setUpdatePcbError] = useState<{
    message: string;
    details?: string;
  } | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. An OK-only message box still cancels on Esc: wx sends
  // wxID_CANCEL whether or not a Cancel button exists.
  useModalEscape(() => setUpdatePcbError(null), updatePcbError !== null);
  const drcDialogRef = useRef<HTMLDivElement | null>(null);
  /**
   * The netlist text of the last `FetchNetlistFromSchematic`, which is what
   * the DRC worker is handed for the parity tests - a NETLIST is a graph of
   * class instances and does not cross `postMessage`, but the text it was
   * read from does (`drc_job.ts`).
   */
  const drcNetlistTextRef = useRef<string | null>(null);
  const [boardSetup, setBoardSetup] = useState<BoardSetupValues>(defaultBoardSetup);
  // Latest texts this editor wrote for project-side files: the projectFiles
  // prop is a load-time snapshot (App persists to storage without refreshing
  // the prop), so without this overlay a hydrate after a board save, or a
  // second dialog OK, would read/merge stale text. Each entry remembers the
  // prop text it was derived from (`base`): it applies only while the prop
  // still holds that text, and drops automatically when a genuine reload
  // delivers fresh content.
  const projectFileEditsRef = useRef<Map<string, { base: string; text: string }>>(new Map());
  const projectFilesNow = useCallback((): { name: string; text: string }[] => {
    const edits = projectFileEditsRef.current;
    return (projectFiles ?? []).map((f) => {
      const entry = edits.get(f.name);
      if (!entry) return f;
      if (entry.base !== f.text && entry.text !== f.text) {
        edits.delete(f.name); // the prop moved on: our overlay is obsolete
        return f;
      }
      return { name: f.name, text: entry.text };
    });
  }, [projectFiles]);
  const boardSetupRef = useRef(boardSetup);
  boardSetupRef.current = boardSetup;

  // The frame's DIALOG_FIND while it is shown (PCB_EDIT_FRAME::ShowFindDialog).
  const [findDlg, setFindDlg] = useState<DIALOG_FIND | null>(null);
  /**
   * DIALOG_BARCODE_PROPERTIES on a live PCB_BARCODE: the board's own
   * (`EDIT_TOOL::Properties`), or DRAWING_TOOL::DrawBarcode's new one, which
   * waits on `resolve`. The preview and the error check are the model's, held
   * here so the dialog's preview effect sees one function per opening.
   */
  const [barcodePropsDlg, setBarcodePropsDlg] = useState<{
    dialog: DIALOG_BARCODE_PROPERTIES;
    preview: (v: BarcodeValues) => BarcodePreview;
    commitError: (v: BarcodeValues) => string;
    resolve?: (aOk: boolean) => void;
  } | null>(null);
  const openBarcodeProps = useCallback(
    (aDialog: DIALOG_BARCODE_PROPERTIES, aResolve?: (aOk: boolean) => void): void =>
      setBarcodePropsDlg({
        dialog: aDialog,
        preview: (v) => barcodePreview(aDialog.Preview(v)),
        commitError: (v) => aDialog.CommitError(v),
        ...(aResolve ? { resolve: aResolve } : {}),
      }),
    [],
  );
  // `DRAWING_TOOL::PlaceImportedGraphics`'s DIALOG_IMPORT_GRAPHICS (File >
  // Import > Graphics): the tool waits on `resolve`, null for Cancel.
  const [importGfxDlg, setImportGfxDlg] = useState<{
    resolve: (aResult: IMPORT_GRAPHICS_RESULT | null) => void;
  } | null>(null);
  /** File > Import > Non-KiCad Board File: the chooser's type combo while it is up. */
  const [nonKicadFilters, setNonKicadFilters] = useState<ChooserFilter[] | null>(null);
  // DIALOG_MAP_LAYERS::RunModal, asked for by a layer-mappable importer mid-load
  // (files.cpp:642-649); the promise is what the synchronous `ShowModal` returns.
  const [mapLayersRequest, setMapLayersRequest] = useState<{
    layers: readonly INPUT_LAYER_DESC[];
    done: (aMap: Map<string, MapLayersLayerId>, aKeep: boolean) => void;
  } | null>(null);
  /** `DIALOG_ZONE_MANAGER`, open: `ShowQuasiModal()`'s answer. */
  const [zoneManager, setZoneManager] = useState<{
    resolve: (r: { ok: boolean; repour: boolean }) => void;
  } | null>(null);
  /** `WX_TEXT_ENTRY_DIALOG` as `MICROWAVE_TOOL` asks it. */
  const [mwTextEntry, setMwTextEntry] = useState<{
    prompt: string;
    caption: string;
    value: string;
    validator?: wxTextValidator;
    resolve: (value: string | null) => void;
  } | null>(null);
  /** `MWAVE_POLYGONAL_SHAPE_DLG::ShowModal`. */
  const [mwPolygonOpen, setMwPolygonOpen] = useState<{ resolve: (ok: boolean) => void } | null>(
    null,
  );
  /** `SelectFootprintFromLibrary`'s FOOTPRINT_CHOOSER_FRAME is open. */
  const [fpChooserOpen, setFpChooserOpen] = useState(false);
  /** The `LIB_ID` text the chooser opens on (`SelectFootprintFromLibrary`'s `aPreselect`). */
  const [fpChooserPreselect, setFpChooserPreselect] = useState('');
  /** What the open chooser answers, `SelectFootprintFromLibrary` being `await`ing it. */
  const fpChooserResolveRef = useRef<((aLibId: string | null) => void) | null>(null);
  /**
   * `frame()->ShowInfoBarError( m_router->FailureReason(), true )`
   * (router_tool.cpp:1436, :1600) — why the router refused, in the infobar
   * above the canvas, with its close button.
   */
  /**
   * The frame's info bar, `EDA_BASE_FRAME::ShowInfoBarError`. One bar per
   * frame upstream, so one state here: the router was its first user, not its
   * owner.
   */
  const [infoBarError, setInfoBarError] = useState<string | null>(null);
  // Switching tools abandons what a window tool has in flight: the footprint
  // chooser.
  useEffect(() => {
    fpChooserResolveRef.current?.(null);
    fpChooserResolveRef.current = null;
    setFpChooserOpen(false);
  }, [activeTool]);
  /**
   * The WebGL layer, and whether it is the one drawing.
   *
   * `glOkRef` is what the *scene compiler* keys off, not `glRef.current`: a
   * scene built through `GL_PATH_FACTORY` holds paths a 2D canvas cannot draw,
   * and one built through `Path2D` holds paths the recorder reads as empty. So
   * the two have to be decided together, and a context loss has to rebuild the
   * scene rather than just switch the draw path — otherwise the fallback shows
   * an empty board with no error, which is the failure mode this whole layer is
   * most able to hide.
   */
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  glCanvasFocusRef.current = (): void => glCanvasRef.current?.focus();
  /**
   * `PCB_DRAW_PANEL_GAL`, the KiCad canvas over `glCanvasRef`: its VIEW draws
   * the board through `PCB_PAINTER` on `OPENGL_GAL`. Null until the bitmap
   * font atlas is decoded and WebGL2 has answered; null for good when it has
   * not, in which case the raster path below draws the board.
   */
  const panelRef = useRef<PCB_DRAW_PANEL_GAL | null>(null);
  const [fontImage, setFontImage] = useState<ImageBitmap | null>(null);
  const [panelReady, setPanelReady] = useState(false);
  /** Bumped when a lost WebGL context is restored, so the panel is rebuilt. */
  const [panelGeneration, setPanelGeneration] = useState(0);
  /** What `applyDisplayState` last pushed into the frame, for its diffs. */
  const displayStateRef = useRef<EditorDisplayState | null>(null);

  /**
   * `PCB_BASE_FRAME::GetBoardBoundingBox( false )`'s `m_pcb->GetBoundingBox()`:
   * the box over every item, null for `ComputeBoundingBox`'s empty BOX2I.
   */
  const boardItemsBox = (): ExtentsBox | null => {
    const kb = boardRef.current?.k;

    if (!kb) return null;

    const area = kb.GetBoundingBox();

    if (area.GetWidth() === 0 && area.GetHeight() === 0) return null;

    return {
      minX: area.GetLeft(),
      minY: area.GetTop(),
      maxX: area.GetRight(),
      maxY: area.GetBottom(),
    };
  };
  /**
   * `BOARD::GetBoardEdgesBoundingBox()`: the Edge.Cuts items' box, null for
   * an empty one. The raster path has no model: its scene box stands in.
   */
  const boardEdgesBox = (): ExtentsBox | null => {
    const kb = boardRef.current?.k;

    if (!kb) return null;

    const area = kb.GetBoardEdgesBoundingBox();

    if (area.GetWidth() === 0 && area.GetHeight() === 0) return null;

    return {
      minX: area.GetLeft(),
      minY: area.GetTop(),
      maxX: area.GetRight(),
      maxY: area.GetBottom(),
    };
  };
  const rafRef = useRef(0);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // Auto-sync: a moment after any edit, serialize into the app's coalesced
  // autosave. The title's '*' shows while the write is pending and clears once
  // handed off, every change reaches the project storage without Ctrl+S.
  //
  // The text is built in time slices (`serializeBoardAsync`): pcbnew formats
  // a board only on a save, a modal wait, and KiCad's own SaveBoard of the
  // jetson demo is 2.1 s natively -- one synchronous serialization after
  // every drop froze the editor for that long. An edit landing while the
  // text is being built aborts it (the effect's cleanup); the next quiet
  // second starts over.
  useEffect(() => {
    if (!dirty || !onBoardChange) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      const brd = boardRef.current;
      if (!brd) return;
      const text = await serializeBoardAsync(brd, yieldToEventLoop, () => cancelled);
      if (cancelled || text === null) return;
      onBoardChange(text);
      setDirty(false);
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [dirty, board, onBoardChange]);

  // The same 1 s debounce, forced out. `SCH_EDIT_FRAME`'s equivalent has been
  // registered since autosave existed; pcbnew's never was, which is why leaving
  // the frame, hiding the tab, unloading the page or crashing all lost the last
  // second of board work with nothing to say so.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!registerAutosaveFlush) return;
    registerAutosaveFlush(() => {
      const brd = boardRef.current;
      // Not dirty means the last serialization already reached the host, and
      // re-serializing a large board on every tab hide is not free.
      if (!brd || !dirtyRef.current || !onBoardChange) return;
      onBoardChange(serializeBoard(brd));
      setDirty(false);
    });
    return () => registerAutosaveFlush(null);
  }, [registerAutosaveFlush, onBoardChange]);

  const showAppearance = toggles.has('showLayersManager');
  const showProperties = toggles.has('showProperties');
  // `PCB_EDIT_FRAME::m_ShowSearch` / `m_ShowNetInspector`.
  const showSearch = toggles.has('showSearch');
  const showNetInspector = toggles.has('showNetInspector');

  // Draw options derived from the Objects tab + zone display mode.
  /** `PCBNEW_SETTINGS::m_Display` + `m_ViewersDisplay`, this page's slice. */
  const display = pcbCfg.pcb_display;
  /**
   * `::GetColorSettings( cfg->m_ColorTheme )` with the user's overrides on top
   * — Preferences > PCB Editor > Colors, and the footprint editor's page too,
   * because both write the `board` namespace.
   *
   * `drawOpts.theme` was left undefined here, so every colour came from
   * `pcbTheme.ts`' built-in constants and the Colors page had nothing behind
   * it. `PCB_DRAW_PANEL_GAL`'s painter is loaded from the same call
   * (`pcb_draw_panel_gal.cpp:780-790`), and `CommonSettingsChanged` re-runs it,
   * which is what the settings subscription above is.
   */
  const theme = useMemo(
    () => pcbThemeWithOverrides(pcbCfg.appearance.color_theme, userColors, userThemes),
    [pcbCfg.appearance.color_theme, userColors, userThemes],
  );
  const drawOpts = useMemo<PcbDrawOptions>(
    () => ({
      ...DEFAULT_DRAW_OPTIONS,
      tracks: objects.tracks,
      vias: objects.vias,
      pads: objects.pads,
      zones: objects.zones,
      points: objects.points,
      fpValues: objects.fpValues,
      fpReferences: objects.fpReferences,
      fpText: objects.fpText,
      drawingSheet: objects.drawingSheet,
      trackOpacity: opacity.tracks,
      viaOpacity: opacity.vias,
      padOpacity: opacity.pads,
      zoneOpacity: opacity.zones,
      imageOpacity: opacity.images,
      zoneOutline: toggles.has('zoneDisplayOutline'),
      // Display-mode toggles: on = sketch (outline) = fill off (m_Display*Fill).
      trackFill: pcbCfg.pcb_display.track_fill,
      viaFill: pcbCfg.pcb_display.via_fill,
      padFill: pcbCfg.pcb_display.pad_fill,
      filledShapeOpacity: opacity.filledShapes,
      contrastMode: contrast,
      // `m_hiContrastFactor = 1.0 - hicontrast_dimming_factor`
      // (`pcbnew/pcb_painter.cpp:176`). The inversion is the point: Preferences
      // asks how much to DIM and the painter wants how much SURVIVES.
      hiContrastFactor: hiContrastFactorFor(commonCfg.appearance.hicontrast_dimming_factor),
      activeLayer,
      theme,
      // Preferences > PCB Editor > Display Options. `m_Display.m_NetNames` is
      // ONE 4-valued choice that gates three different items at three
      // thresholds — `pcb_painter.cpp:1403` for a pad, `:1118` for a via, and
      // the track branch for the rest — so it fans out here rather than being
      // stored three times.
      netNames: display.net_names_mode >= 2,
      padNetNames: display.net_names_mode === 1 || display.net_names_mode === 3,
      viaNetNames: display.net_names_mode !== 0,
      padNumbers: display.pad_numbers,
      padClearance: display.pad_clearance,
      viaColorForThPads: display.pad_use_via_color_for_normal_th_padstacks,
      trackClearanceMode: display.track_clearance_mode,
      // `LAYER_BOARD_OUTLINE_AREA` — the Objects tab's "Board Area Shadow"
      // row, which had a checkbox and nothing behind it.
      boardOutlineArea: objects.boardAreaShadow,
      // Identity-stable: the cache mutates the map and asks for a redraw, and
      // the paint pass reads it then. Nothing here needs to change for a decode
      // to become visible.
    }),
    [
      objects,
      opacity,
      toggles,
      contrast,
      activeLayer,
      display,
      theme,
      pcbCfg.pcb_display.pad_fill,
      pcbCfg.pcb_display.track_fill,
      pcbCfg.pcb_display.via_fill,
    ],
  );

  // The left-toolbar high-contrast button reflects the Layer Display mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `contrast`, `objects.ratsnest`, `unitLabel` and `pcbCfg` are the triggers - the frame's conditions are read through frameRef
  const leftToggles = useMemo(() => {
    const s = new Set(toggles);
    const frame = frameRef.current;
    if (frame) for (const id of pcbCheckedSet(frame)) s.add(id);
    // The button is checked whenever a net highlight is active (netHighlightCond
    // = IsNetHighlightSet()).
    if (highlightNets.size > 0) s.add('toggleNetHighlight');
    else s.delete('toggleNetHighlight');
    return s;
  }, [toggles, contrast, objects.ratsnest, highlightNets, unitLabel, pcbCfg]);

  // `text` is live (see the `openNonce` prop): the host mirrors this editor's
  // own autosaved board back into the open project, so reading it as a
  // dependency would reparse the board on every autosave — and, on a reopen,
  // replace the board being edited with the copy the host happened to hold.
  // Read at open time only.
  const textRef = useRef(text);
  textRef.current = text;

  /** The open this frame has read: `openNonce` + file, set as the parse begins. */
  const parsedOpen = useRef<string | null>(null);
  /** The board whose first paint closes the Load PCB dialog, while one is pending. */
  const firstPaintPendingRef = useRef<Board | null>(null);
  // The project folder, `/<projectName>`: read through a ref by the loads
  // below, which run on their own triggers (opening a board, Board Setup).
  const projectDirRef = useRef('');
  projectDirRef.current = projectName ? `/${projectName}` : '';

  // Parse after the first paint, so the frame — and the progress dialog over
  // it — is on screen before the (synchronous) read blocks the thread.
  useEffect(() => {
    let cancelled = false;
    // The frame's own blank board, in the refs the canvas draws from, so the
    // grid is up while the file is read. Only the first time: a reopen
    // (`openNonce`) keeps the board being edited on screen until the new one
    // has parsed, as pcbnew keeps the old board up until `SetBoard`.
    if (!boardRef.current) {
      boardRef.current = emptyBoard;
      requestDrawRef.current();
    }
    // Not on screen: nothing to do yet. The open is read when the frame is
    // next shown, which re-runs this with `shown` true — see the prop.
    if (!shown) return;
    const open = `${openNonce ?? 0} ${fileName}`;
    if (parsedOpen.current === open) return;
    // `Loading %s...` (pcb_io_kicad_sexpr.cpp:3144) is the loader's first
    // Report(); the gauge stays at 0 because the parse is one call with no
    // checkpoint() to move it.
    setLoading({ message: `Loading ${fileName}...`, value: 0 });
    const id = setTimeout(async () => {
      // Claimed only once the read actually starts: a frame hidden again
      // inside these 30 ms cancels the timer, and must read when next shown.
      parsedOpen.current = open;
      // `WX_PROGRESS_REPORTER progressReporter( this, _( "Load PCB" ), 1,
      // PR_CAN_ABORT )` (files.cpp:561): one reporter for the whole open, its
      // phases the messages the C++ reports, and `KeepRefreshing()` a paint,
      // so each message is on screen before the phase it names blocks.
      let value = 0;
      /** `KeepRefreshing()`: the dialog painted, which here means a frame yielded. */
      const keepRefreshing = (): Promise<void> => (cancelled ? Promise.resolve() : nextPaint());
      const reporter: PROGRESS_REPORTER_LIKE = {
        SetMaxProgress: () => {},
        SetCurrentProgress: (aProgress) => {
          value = aProgress;
        },
        AdvanceProgress: () => {},
        KeepRefreshing: () => !cancelled,
        IsCancelled: () => cancelled,
        Report: (message) => {
          if (!cancelled) setLoading({ message, value });
        },
      };
      try {
        // The frame — and the dialog over it — painted before the read blocks.
        await keepRefreshing();
        if (cancelled) return;
        // `PROF_TIMER` + `wxLogTrace( traceAllegroPerf, ... )` in
        // OpenProjectFiles: the open's phases, under `WXTRACE=KICAD_ALLEGRO_PERF`.
        const postLoadTimer = new PROF_TIMER();
        const b = { ...readBoard(parse(textRef.current)), fileName };
        wxLogTrace(traceAllegroPerf, () => `Load: ${postLoadTimer.msecs(true).toFixed(3)} ms`);
        if (cancelled) return;
        const kb = b.k;
        // `BOARD::BuildConnectivity`'s first step, `CacheTriangulation`, runs
        // on the thread pool in the C++ while the progress dialog pumps
        // (`Tessellating copper zones...`). Ours pumps the same way — the
        // zones on the pool's workers, this thread free to paint the gauge —
        // and the synchronous build below then finds every zone cached.
        if (kb && kb.Zones().length > 0) {
          const zones = kb.Zones().length;
          let done = 0;
          await kb.CacheTriangulationAsync({
            ...reporter,
            AdvanceProgress: () => {
              done++;
              reporter.SetCurrentProgress(done / zones);
              reporter.Report('Tessellating copper zones...');
            },
          });
          wxLogTrace(
            traceAllegroPerf,
            () => `Post-load CacheTriangulation: ${postLoadTimer.msecs(true).toFixed(3)} ms`,
          );
          if (cancelled) return;
        }
        boardRef.current = b;
        // OpenProjectFiles, the board loaded: `AdvancePhase( _( "Finalizing
        // board" ) )`, `SetBoard( loadedBoard, false )` — through the canvas,
        // so the VIEW takes every item here — then "Rebuild list of nets
        // (full ratsnest rebuild)". Done here rather than in the effect on
        // `board` so the dialog can say which phase is blocking; the effect
        // then finds the frame already on this board.
        const frame = frameRef.current;
        if (frame && kb) {
          reporter.SetCurrentProgress(1);
          reporter.Report('Finalizing board');
          await keepRefreshing();
          if (cancelled) return;
          frame.Clear_Pcb();
          frame.SetBoard(kb, false);
          wxLogTrace(
            traceAllegroPerf,
            () => `Post-load SetBoard: ${postLoadTimer.msecs(true).toFixed(3)} ms`,
          );
          reporter.Report('Updating nets...');
          await keepRefreshing();
          if (cancelled) return;
          kb.BuildConnectivity();
          wxLogTrace(
            traceAllegroPerf,
            () => `Post-load BuildConnectivity: ${postLoadTimer.msecs(true).toFixed(3)} ms`,
          );
          // `OnBoardLoaded()`: the project's constraints, netclasses and
          // rules into the DRC engine. Its tail - SetActiveLayer( ..., true )
          // and the UpdateAllItems( ALL ) that re-records what a frame drew
          // before the rules existed - is the board's first display sync.
          syncProjectSettingsIntoBoard(
            frame,
            panelRef.current,
            projectFilesNow(),
            rootPro,
            false,
            projectDirRef.current,
          );
          // `LoadProjectSettings` (files.cpp:907) filled the frame's display
          // options, the painter's hidden nets and the selection filter from
          // the .kicad_prl; this window's Appearance state starts from them.
          if (frame.GetCanvas()) {
            updateDisplayOptionsRef.current();
            const loadedPanel = panelRef.current;
            if (loadedPanel) {
              const render = (loadedPanel.GetView().GetPainter() as PCB_PAINTER).GetSettings();
              setHiddenNets(new Set(render.GetHiddenNets()));
            }
            const loadedFilter = frame.GetSelectionFilter() as unknown as Record<string, unknown>;
            setSelFilter(
              new Set(Object.keys(loadedFilter).filter((k) => loadedFilter[k] === true)),
            );
          }
          wxLogTrace(
            traceAllegroPerf,
            () => `Post-load DRC engine: ${postLoadTimer.msecs(true).toFixed(3)} ms`,
          );
        }
        // The first fit went to the blank sheet; the loaded board gets its own.
        fittedRef.current = false;
        // The dialog stays up until this board has been painted (see `draw`):
        // the first frame caches every item, and an empty sheet under a
        // vanished dialog reads as "no board".
        firstPaintPendingRef.current = b;
        setBoard(b);
        setVisible(new Set(b.layers.map((l) => l.name)));
        // `PCB_EDIT_FRAME::OpenProjectFiles`' preload (pcbnew/files.cpp:610):
        // the footprint libraries are paid for now, in the background. See
        // ./preload.ts.
        preloadBoardLibraries(b);
      } catch (e) {
        firstPaintPendingRef.current = null;
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(null);
        }
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(id);
      firstPaintPendingRef.current = null;
      setLoading(null);
    };
  }, [openNonce, fileName, emptyBoard, shown]);

  /**
   * The `.kicad_pro` / `.kicad_dru` content Board Setup is derived from.
   *
   * Keyed on the CONTENT rather than on the `projectFiles` array, which now
   * changes identity on every autosave tick: re-deriving the whole of Board
   * Setup and re-rendering the frame once a second, for files that had not
   * moved, is not something the user should pay for.
   */
  const setupSourceKey = useMemo(
    () =>
      projectFilesNow()
        .filter((f) => /\.(kicad_pro|kicad_dru)$/i.test(f.name))
        .map((f) => `${f.name}\u0000${f.text}`)
        .join('\u0001'),
    [projectFilesNow],
  );

  // The project's files changed under the editor (a save from Board Setup,
  // another session, the schematic side): reload them into the BOARD, the way
  // BOARD::SetProject + LoadProjectSettings do, and re-read the Board Setup
  // snapshot from the live objects.
  useEffect(() => {
    const files = projectFilesNow();
    const frame = frameRef.current;
    if (frame && frame.GetBoard() && parsedOpen.current !== null) {
      syncProjectSettingsIntoBoard(
        frame,
        panelRef.current,
        files,
        rootPro,
        true,
        projectDirRef.current,
      );
      const dru = findProjectDru(files, rootPro);
      setBoardSetup(BoardSetupToWindow(frame.GetBoard()!, frame.Prj(), dru?.text ?? ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupSourceKey, rootPro, openNonce]);

  /** `GetDesignSettings().GetAuxOrigin()`: the drill/place file origin. */
  const auxOriginOf = (): { x: number; y: number } =>
    frameRef.current?.GetBoard()?.GetDesignSettings().GetAuxOrigin() ?? { x: 0, y: 0 };

  const draw = useCallback(() => {
    const __t0 = PERF ? performance.now() : 0;
    const canvas = canvasRef.current;
    // Not gated on a compiled scene any more: the VIEW draws the board, and
    // `sceneRef` holds the shell alone under it (`buildBoardScene`).
    if (!canvas) return;
    // The window's overlay, above the board: everything the tools not yet
    // ported draw (TRANSITIONAL, #636 stage 3 - each tool's preview moves onto
    // the VIEW with the tool, and then this canvas goes). Below it is only the
    // KiCad canvas: `EDA_DRAW_PANEL_GAL::DoRePaint` clears to the theme's
    // background, draws the grid (`GAL::DrawGrid`), then the VIEW - the drawing
    // sheet, every board layer, the net names, the anchors, the ratsnest and the
    // selection - each on its GAL layer in `GAL_LAYER_ORDER`.
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // `panel` is null only between a lost context and its restoration, and then
    // the frame simply has no board in it.
    const panel = panelRef.current;
    // A board just opened, not yet fitted: its first frame caches every item
    // (seconds on a big board), so it is drawn once, at the fitted view,
    // rather than first at the blank sheet's.
    const awaitingFit =
      panel !== null && firstPaintPendingRef.current === boardRef.current && !fittedRef.current;
    if (panel && !awaitingFit) {
      syncWindowViewRef.current(panel);
      // `Refresh()`, as a canvas event does: a repaint only when the view is
      // dirty or the cursor moved, throttled to the GAL's swap interval.
      panel.Refresh();
    }
    const v = viewRef.current;
    // Signed X scale for the flipped (mirrored) view; world→screen X uses this.
    const sx = v.flipX ? -v.scale : v.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The open's last phase: the loaded board is on screen, so the Load PCB
    // dialog goes.
    if (firstPaintPendingRef.current === boardRef.current && !awaitingFit) {
      firstPaintPendingRef.current = null;
      setLoading(null);
    }
    // Grid sits behind the board (GAL GRID_DEPTH), painted crisply at the live
    // view every frame so it stays sharp during pan/zoom. The raster is drawn on
    // top with a transparent background so the grid shows through empty areas.
    // Drawing sheet, drawn behind the board with the UN-flipped transform so the
    // page frame and title block stay in place and readable when the board is
    // flipped (KiCad's DS_PROXY_VIEW_ITEM un-mirrors itself). tx is recovered by
    // mirroring back about the viewport centre.
    // Footprint anchors (LAYER_ANCHOR), *under* the board rather than over it.
    //
    // They belong here rather than on the overlay because that is where pcbnew
    // puts them in practice: with the copper pours switched on its anchors all
    // but disappear — a translucent zone fill washes the magenta out to a faint
    // grey tick you only find by zooming right in — and they come back cleanly
    // The board itself, when the VIEW is not drawing it: the raster blit.
    // The drill/place file origin marker, screen-space like the anchors and,
    // like them, drawn above the board (LAYER_GP_OVERLAY).
    drawOriginMarkers(
      ctx,
      { aux: auxOriginOf(), grid: gridOriginRef.current },
      v,
      canvas.width,
      canvas.height,
      dpr,
      drawOpts.theme,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Back and inner net names. On the GPU they were recorded into the board's
    // own draw at the depth pcbnew files them at (see the `recordInner` call
    // above), so nothing is drawn here. The Canvas2D path has no such depth to
    // draw into, so it keeps the attenuated stand-in — dimmed by what pcbnew
    // stacks over them, which is the best a single flat raster can do.
    // Net-color overlay (net colors mode "All"): copper items of colored nets
    // repainted in their net color over the raster. The VIEW paints net colours
    // itself (PCB_RENDER_SETTINGS::GetColor, NET_COLOR_MODE::ALL).
    // Courtyard conflicts, when there is no GPU to composite them on. Ordered
    // after the ratsnest and before the selection chrome because that is where
    // GAL_LAYER_ORDER puts LAYER_CONFLICTS_SHADOW: directly under
    // LAYER_SELECT_OVERLAY and 130 entries above LAYER_RATSNEST
    // (`pcb_draw_panel_gal.cpp:81`). The GL path draws it in its own layer, in
    // the same position, with KiCad's overlay blend that this one cannot do.
    // The zoom tool's band (TRANSITIONAL until ZOOM_TOOL, #636 stage 3), in
    // `KIGFX::PREVIEW::SELECTION_AREA`'s colours. The selection tool's own band
    // and lasso are its SELECTION_AREA on the VIEW.
    const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: p.x * sx + v.tx,
      y: p.y * v.scale + v.ty,
    });
    const bandDark = isBackgroundDark(theme.background);
    const box = boxRef.current;
    if (box) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const p0 = toPx(box.a);
      const p1 = toPx(box.b);
      drawSelectionArea(
        ctx,
        p0.x,
        p0.y,
        p1.x,
        p1.y,
        // Left→right is the window select, which is `INSIDE_RECTANGLE`.
        selectionAreaColors({ backgroundDark: bandDark, inside: box.b.x >= box.a.x }),
      );
    }
    // DRC markers are PCB_MARKERs in the BOARD since #636 stage 4d: the VIEW's
    // PCB_PAINTER draws them (LAYER_DRC_ERROR / _WARNING / _EXCLUSION, gated by
    // BOARD::IsElementVisible from the Objects tab); nothing on this overlay.
    // `GRID_HELPER::m_viewAxis` (pcb_grid_helper.cpp:167-172): the auxiliary
    // axis, drawn at the origin of the gesture in progress as a CROSS in the
    // aux-items colour at 40% alpha. `SetSize( 20000 )` is in *screen* pixels
    // (`ORIGIN_VIEWITEM::ViewDraw` puts it through `ToWorld`), so at any real
    // zoom it spans the whole canvas. It is the cue that says this point is
    // still reachable however far the cursor wanders off the grid.
    const aux = auxAxisRef.current;
    if (aux) {
      const ax = aux.x * sx + v.tx;
      const ay = aux.y * v.scale + v.ty;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = PCB_CURSOR;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      ctx.moveTo(0, ay);
      ctx.lineTo(canvas.width, ay);
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, canvas.height);
      ctx.stroke();
      ctx.restore();
    }
    // The grid helper's own view items: `m_constructionGeomPreview`
    // (grid_helper.cpp:67) and `m_viewSnapPoint`, a 10 px CIRCLE_CROSS in the
    // aux-items colour (pcb_grid_helper.cpp:174-178).
    const gh = gridHelperRef.current;
    if (gh) {
      const cg = gh.GetConstructionGeomState();
      if (cg.visible) {
        const x0 = (0 - v.tx) / sx;
        const x1 = (canvas.width - v.tx) / sx;
        const y0 = (0 - v.ty) / v.scale;
        const y1 = (canvas.height - v.ty) / v.scale;
        ctx.save();
        ctx.setTransform(sx, 0, 0, v.scale, v.tx, v.ty);
        drawConstructionGeom(ctx, cg.geom, {
          viewport: BOX2I.ByCorners({ x: x0, y: y0 }, { x: x1, y: y1 }),
          worldScale: Math.abs(v.scale),
        });
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      const sp = gh.GetSnapIndicatorState();
      if (sp.visible) {
        drawSnapIndicator(ctx, {
          position: sp.position,
          toPx: (p) => ({ x: p.x * sx + v.tx, y: p.y * v.scale + v.ty }),
          style: 'circle_cross',
          size: 10 * dpr,
          color: drawOpts.theme?.special.auxItems ?? PCB_SPECIAL.auxItems,
          drawAtZero: true,
          snapTypes: sp.snapTypes,
          lineWidth: Math.max(1, dpr),
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        });
      }
    }
    // Crosshair cursor (GAL::blitCursor): the LAYER_CURSOR cross at the
    // grid-snapped cursor, drawn topmost, by the shared painter.
    // Every picker draws it too: `PCB_PICKER_TOOL::Main`'s `setCursor` is
    // `SetCurrentCursor( m_cursor )` AND `controls->ShowCursor( true )`
    // (`pcb_picker_tool.cpp:22-27`), so the local ratsnest tool shows the
    // bullseye pointer and the crosshair together. This pass used to skip
    // that one tool.
    const cur = cursorRef.current;
    if (cur) {
      const snapped = cursorSnapRef.current(cur);
      drawCrosshair(
        ctx,
        { x: snapped.x * sx + v.tx, y: snapped.y * v.scale + v.ty },
        canvas.width,
        canvas.height,
        {
          // `GAL_DISPLAY_OPTIONS::m_gridStyle`'s sibling `m_crossHairMode`,
          // read from the file rather than from the button set so Display
          // Options and the toolbar cannot disagree.
          mode: galRef.current.crosshair,
          color: PCB_CURSOR,
          // pcbnew's tools call ShowCursor(true) as soon as one is active; with
          // the selection tool the crosshair is there only because "Always show
          // crosshairs" forced it, and a forced cursor is dimmed upstream.
          toolWantsCursor: activeToolRef.current !== 'select',
          // `GAL_DISPLAY_OPTIONS::m_forceDisplayCursor`, the Cursor group's
          // second control. Hardcoded true here, so switching it off on
          // Display Options changed nothing.
          alwaysShow: galRef.current.always_show_cursor,
          devicePixelRatio: dpr,
        },
      );
    }
    notePcbPaint('gl', __t0);
    setScale(v.scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, drawOpts]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);
  // Ref mirror so long-lived handlers (global keydown) never call a stale draw.
  const requestDrawRef = useRef(requestDraw);
  requestDrawRef.current = requestDraw;

  // Layer/object changes repaint. What they change *in* the picture is the
  // VIEW's — `PCB_DRAW_PANEL_GAL` is told the new layer set by
  // `applyDisplayState` — so this only asks for the frame.
  useEffect(() => {
    requestDraw();
  }, [visible, drawOpts, requestDraw]);

  // The selection lives on the VIEW (PCB_SELECTION_TOOL's `m_selection` on
  // LAYER_SELECT_OVERLAY), and PCB_PAINTER draws what a selected item adds - an
  // umbilical, a reference image's box, a group's frame. A change only asks
  // for the frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection is the trigger
  useEffect(() => {
    requestDraw();
  }, [selection, requestDraw]);

  // ----- board model mutation (edits + undo/redo) -----------------------------

  // A board text in an outline face draws as the stroke font until its face
  // has been fetched (`FONT::GetFont` loads off the disk synchronously; ours
  // cannot). When the face lands the canvas repaints.
  useEffect(() => onOutlineFontsChanged(() => requestDrawRef.current()), []);

  /**
   * The bitmap font atlas the GAL draws BitmapText with, decoded once. The
   * panel is not built until it has landed: `OPENGL_GAL::BeginDrawing`
   * uploads it on the first frame.
   */
  useEffect(() => {
    let cancelled = false;
    loadBitmapFontImage().then(
      (img) => {
        if (!cancelled) setFontImage(img);
      },
      (err: unknown) => console.warn(`Could not use OpenGL: ${(err as Error).message}`),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * `PCB_EDIT_FRAME::PCB_EDIT_FRAME`: the canvas. Built once the font atlas is
   * here, on the element React mounted; a browser without WebGL2 leaves
   * `panelRef` null and every frame takes the raster path exactly as before.
   *
   * `installPgm` first: the painter reads `pcbconfig()`, the view controls
   * `Pgm().GetCommonSettings()`, and the colours come through the settings
   * manager's theme loader.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: fontImage and panelGeneration (a restored context) are the triggers; the rest are refs
  useEffect(() => {
    const canvas = glCanvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame || !fontImage || panelRef.current) return;
    installPgm();
    // `EDA_DRAW_FRAME::EDA_DRAW_FRAME`: `m_galDisplayOptions.ReadCommonConfig(
    // *Pgm().GetCommonSettings(), this )` before the canvas is built.
    frame.GetGalDisplayOptions().ReadCommonConfig(commonSettingsOf(), window);
    const panel = createPcbDrawPanel(frame, canvas, fontImage);
    if (!panel) {
      console.warn('WebGL2 unavailable; drawing the board with Canvas2D');
      return;
    }
    panelRef.current = panel;
    // `?perf=1`: the panel beside the counters, so a probe can ask the VIEW
    // where a board point is on screen and drive a gesture there.
    if (PERF) {
      const perf = pcbPerf as PcbPerfCounters & {
        panel?: PCB_DRAW_PANEL_GAL;
        frame?: PCB_EDIT_FRAME;
      };
      perf.panel = panel;
      perf.frame = frame;
    }
    // A board already open: `SetBoard` ran without a canvas, so what it would
    // have done through the canvas is done now.
    // In SetBoard's order: `DisplayBoard` first (it clears the VIEW), then
    // `SetPageSettings`' drawing sheet onto it -- the other way round the
    // sheet went into the VIEW and was cleared straight out again, and the
    // empty board an open starts from had no sheet until the load's own
    // SetBoard, seconds later.
    const kb = frame.GetBoard();
    if (kb) {
      panel.DisplayBoard(kb);
      attachBoardToPanel(frame, panel, kb);
      panel.UpdateColors();
    }
    frame.ActivateGalCanvas();
    // The VIEW starts where the editor's transform is -- the fit the sheet
    // or the board already had -- rather than at the VIEW's own default
    // until the next draw syncs it (which, with the parse about to block
    // the thread, was the un-fitted sheet in the corner for the whole open).
    syncViewTransform(panel, viewRef.current, dpr);
    displayStateRef.current = null;
    setPanelReady(true);
    // A lost context: the panel's GAL is gone with it until the context is
    // restored and the panel rebuilt.
    const onLost = (e: Event): void => {
      e.preventDefault();
      panelRef.current?.Destroy();
      panelRef.current = null;
      frame.SetCanvas(null);
      setPanelReady(false);
      requestDrawRef.current();
    };
    const onRestored = (): void => {
      setPanelGeneration((g) => g + 1);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      panelRef.current?.Destroy();
      panelRef.current = null;
      frame.SetCanvas(null);
    };
  }, [fontImage, panelGeneration]);

  const setBoardModel = useCallback(
    (b: Board) => {
      boardRef.current = b;
      setBoard(b);
      requestDraw();
    },
    [requestDraw],
  );

  /**
   * `PCB_EDIT_FRAME::ShowBoardSetupDialog`, the OK half: every panel's
   * TransferDataFromWindow into the live BOARD / BOARD_DESIGN_SETTINGS /
   * PROJECT_FILE, then the syncs, tickers and repaints upstream does after
   * `ShowQuasiModal() == wxID_OK`. The `.kicad_pro` is then what
   * `SETTINGS_MANAGER::SaveProject()` writes (upstream writes it on the next
   * board save; here it is persisted at once, as every edit is), the `.kicad_dru`
   * is the Custom Rules text, and the board goes out through the normal save
   * when something board-side moved.
   */
  const commitBoardSetup = useCallback(
    (next: BoardSetupValues) => {
      const frame = frameRef.current;
      const kb = frame?.GetBoard();
      if (!frame || !kb) return;
      const prj = frame.Prj();

      const modified = BoardSetupFromWindow(next, kb, prj);

      // Note: We must synchronise time domain properties before nets and classes, otherwise the
      // updates called by the board listener events are using stale data
      kb.SynchronizeTuningProfileProperties();
      kb.SynchronizeNetsAndNetClasses(true);

      if (!kb.SynchronizeComponentClasses(new Set()))
        setInfoBarError('Could not load component class assignment rules');

      prj.IncrementTextVarsTicker();
      prj.IncrementNetclassesTicker();

      // The rules file is the frame's (OnBoardLoaded reads it): the DRC engine
      // is re-initialised on the new constraints, netclasses and custom rules.
      frame.OnBoardLoaded(next.customRules.text, druFileName(rootPro ?? ''));

      // The view over the BOARD: layers, stackup, plot options, embedded files.
      setBoardModel({ ...boardFromBOARD(kb, fileNameRef.current), fileName: fileNameRef.current });
      const panel = panelRef.current;
      if (panel) boardSetupRepaint(frame, panel, kb);

      // .kicad_pro + .kicad_dru, persisted now.
      const files = projectFilesNow();
      const baseOf = (name: string): string =>
        (projectFiles ?? []).find((f) => f.name === name)?.text ?? '';
      const persist: { name: string; text: string }[] = [];
      const pro = findProjectPro(files, rootPro);
      const saved = Pgm().GetSettingsManager().SaveProject(prj);
      if (pro && saved) {
        const updated = DumpJson(saved.pro);
        if (updated !== pro.text) persist.push({ name: pro.name, text: updated });
        const druName = druFileName(pro.name);
        const dru = findProjectDru(files, rootPro);
        if (dru ? next.customRules.text !== dru.text : next.customRules.text.trim() !== '') {
          persist.push({ name: dru?.name ?? druName, text: next.customRules.text });
        }
      }
      if (persist.length) {
        for (const f of persist)
          projectFileEditsRef.current.set(f.name, { base: baseOf(f.name), text: f.text });
        onPersistFiles?.(persist);
      }

      setBoardSetup(BoardSetupToWindow(kb, prj, next.customRules.text));

      // We don't know if anything was modified, so err on the side of requiring a save
      if (modified) {
        if (onSaveBoard) onSaveBoard(serializeBoard(boardRef.current!));
        else setDirty(true);
      }
    },
    [projectFilesNow, projectFiles, rootPro, onPersistFiles, onSaveBoard, setBoardModel],
  );

  /**
   * The BOARD_LISTENER that drives React: whatever a commit, an undo or a
   * redo did to the BOARD, the view is re-derived from it once, after the
   * operation has finished.
   */
  const fileNameRef = useRef(fileName);
  fileNameRef.current = fileName;
  const listenerRef = useRef<REACT_BOARD_LISTENER | null>(null);
  if (!listenerRef.current) {
    listenerRef.current = new REACT_BOARD_LISTENER((unchanged) => {
      const kb = frameRef.current?.GetBoard();
      if (!kb || boardRef.current?.k !== kb) return;
      setBoardModel({
        ...boardFromBOARD(kb, fileNameRef.current, unchanged ?? undefined),
        fileName: fileNameRef.current,
      });
    });
  }
  // `EDA_DRAW_FRAME::CommonSettingsChanged`: `m_galDisplayOptions.ReadCommonConfig(
  // *settings, this )` (eda_draw_frame.cpp:400). The GAL observes the options:
  // `OPENGL_GAL::updatedGalDisplayOptions` drops its framebuffers and refreshes,
  // and the next frame rebuilds the compositor at the new antialiasing mode.
  const antialiasingMode = commonCfg.graphics.antialiasing_mode;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mode is the trigger; the body reads the settings store and refs
  useEffect(() => {
    if (!panelRef.current) return;
    frameRef.current?.GetGalDisplayOptions().ReadCommonConfig(commonSettingsOf(), window);
  }, [antialiasingMode]);
  // `TOOLS_HOLDER::CommonSettingsChanged`: the left-drag action, warp-on-move
  // and immediate actions the selection and edit tools read off the frame.
  // Once Pgm() is installed (the panel effect), and again whenever
  // Preferences > Mouse and Touchpad changes them.
  const commonInput = commonCfg.input as {
    mouse_left?: string;
    warp_mouse_on_move?: boolean;
    immediate_actions: boolean;
  };
  const inputLeftDrag = commonInput.mouse_left;
  const inputWarp = commonInput.warp_mouse_on_move;
  const inputImmediate = commonInput.immediate_actions;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the three settings and the panel are the triggers; the frame reads Pgm()
  useEffect(() => {
    if (!panelReady) return;
    frameRef.current?.CommonSettingsChanged();
  }, [inputLeftDrag, inputWarp, inputImmediate, panelReady]);
  const boardK = board?.k ?? null;
  useEffect(() => {
    const frame = frameRef.current;
    const listener = listenerRef.current;
    if (!boardK || !frame || !listener) return;
    // PCB_EDIT_FRAME::OpenProjectFiles: Clear_Pcb, SetBoard( loadedBoard, false ),
    // then "Rebuild list of nets (full ratsnest rebuild)". The open itself
    // has done these under its progress dialog (the load effect above); a
    // board that arrives any other way — Board Setup's re-parse — gets them
    // here.
    if (frame.GetBoard() !== boardK) {
      frame.Clear_Pcb();
      frame.SetBoard(boardK, false);
      boardK.BuildConnectivity();
    }
    boardK.AddListener(listener);
    // The canvas, when it is up: the screen's page size and the drawing
    // sheet follow the board (`SetBoard` displayed it through the canvas),
    // and the Appearance state is pushed afresh into the new board.
    const panel = panelRef.current;
    if (panel) {
      attachBoardToPanel(frame, panel, boardK);
      displayStateRef.current = null;
    }
    return () => boardK.RemoveListener(listener);
  }, [boardK]);

  // ----- Update PCB from Schematic (BOARD_EDITOR_CONTROL::UpdatePCBFromSchematic) --

  /**
   * Every footprint a netlist names, in hand before the synchronous updater runs:
   * the project's own `.pretty` files, then the hosted libraries (a bare name
   * searches them alphabetically, as `LoadFootprintWithOptionalNickname` does).
   */
  const buildNetlistLibrary = useCallback(
    async (
      netlist: NETLIST,
      files: readonly { name: string; text: string }[],
    ): Promise<Map<string, FOOTPRINT>> => {
      const frame = frameRef.current;
      const library = new Map<string, FOOTPRINT>();
      if (!frame) return library;

      // Project-local `.kicad_mod` files, keyed by "<pretty dir>:<name>".
      const projectFootprints = new Map<string, string>();
      for (const file of files) {
        const norm = file.name.replace(/\\/g, '/');
        const match = /([^/]+)\.pretty\/([^/]+)\.kicad_mod$/i.exec(norm);
        if (match) projectFootprints.set(`${match[1]}:${match[2]}`, file.text);
      }

      const wanted = new Set<string>();
      for (const component of netlist.Components()) {
        const fpid = component.GetFPID();
        if (fpid !== '') wanted.add(fpid);
      }

      await Promise.all(
        [...wanted].map(async (fpid) => {
          const local = projectFootprints.get(fpid);
          if (local) {
            try {
              // `PCB_BASE_FRAME::loadFootprint`'s tail: nets cleared, the
              // board's default styles applied.
              const fp = ParseFootprintFile(local);
              const id = new LIB_ID();
              id.Parse(fpid, true);
              fp.SetFPID(id);
              fp.ClearAllNets();
              const bds = frame.GetBoard()!.GetDesignSettings();
              fp.ApplyDefaultSettings(
                frame.GetBoard()!,
                bds.m_StyleFPFields,
                bds.m_StyleFPText,
                bds.m_StyleFPShapes,
                bds.m_StyleFPDimensions,
                bds.m_StyleFPBarcodes,
              );
              library.set(fpid, fp);
              return;
            } catch {
              // not a footprint: fall through to the libraries
            }
          }
          const id = new LIB_ID();
          id.Parse(fpid, true);
          const fromLibrary = await frame.LoadFootprint(id);
          if (fromLibrary) library.set(fpid, fromLibrary);
        }),
      );
      return library;
    },
    [],
  );

  /**
   * FetchNetlistFromSchematic, then load every footprint the netlist names so the
   * synchronous updater can run: the hosted libraries plus any `.pretty` the project
   * carries (FOOTPRINT_LIBRARY_ADAPTER's project rows). A bare footprint name with no
   * library nickname searches the libraries alphabetically, as
   * LoadFootprintWithOptionalNickname does.
   */
  const openUpdatePcb = useCallback(async (): Promise<void> => {
    setUpdatePcbError(null);
    const files = projectFilesNow();

    const fetched = FetchNetlistFromSchematic(
      frameRef.current?.Kiway() ?? null,
      frameRef.current,
      files,
      'Updating PCB requires a fully annotated schematic.',
      rootPro,
    );

    if (!fetched.ok) {
      setUpdatePcbError({
        message: fetched.error,
        ...(fetched.details ? { details: fetched.details } : {}),
      });
      return;
    }

    setUpdatePcbBusy(true);
    try {
      const library = await buildNetlistLibrary(fetched.netlist, files);

      setUpdatePcb({ netlist: fetched.netlist, library });
    } finally {
      setUpdatePcbBusy(false);
    }
  }, [projectFilesNow, rootPro, buildNetlistLibrary]);

  // Tools > Update PCB from Schematic, invoked from the schematic editor:
  // MAIL_PCB_UPDATE runs the same dialog as this frame's own F8.
  const openUpdatePcbRef = useRef(openUpdatePcb);
  openUpdatePcbRef.current = openUpdatePcb;

  /**
   * DIALOG_UPDATE_PCB::PerformUpdate. A dry run only reports; a real run commits the
   * new board, then spreads the footprints it added and selects them,
   * PCB_EDIT_FRAME::OnNetlistChanged's SpreadFootprints + selectItems, which is what
   * leaves the new parts ready to be dragged into place.
   */
  const runNetlistUpdate = useCallback(
    (
      data: { netlist: NETLIST; library: Map<string, FOOTPRINT> },
      options: UpdatePcbOptions,
      dryRun: boolean,
      followCursor = true,
    ): readonly ReportLine[] => {
      const frame = frameRef.current;
      const board = frame?.GetBoard();
      if (!frame || !board) return [];

      const reporter = new Reporter();

      // `m_netlist->SetFindByTimeStamp( !relink ); SetReplaceFootprints( update )`.
      data.netlist.SetFindByTimeStamp(!options.relinkFootprints);
      data.netlist.SetReplaceFootprints(options.updateFootprints);

      if (!dryRun) {
        frame.GetToolManager()?.DeactivateTool();
        frame.GetToolManager()?.RunAction(ACTIONS.selectionClear);
      }

      // `m_frame->LoadFootprint( aFootprintId )`, from what was loaded before
      // the dialog opened; a bare name searches the libraries alphabetically,
      // as LoadFootprintWithOptionalNickname does. Each call is a new copy.
      const loader = (aFpid: LIB_ID): FOOTPRINT | null => {
        const key = aFpid.Format();
        let proto = data.library.get(key) ?? null;
        if (!proto && aFpid.IsLegacy()) {
          for (const k of [...data.library.keys()].sort()) {
            if (k.slice(k.indexOf(':') + 1) === aFpid.GetLibItemName()) {
              proto = data.library.get(k) ?? null;
              break;
            }
          }
        }
        return proto ? (proto.Duplicate(false) as FOOTPRINT) : null;
      };

      const updater = new BOARD_NETLIST_UPDATER(frame, board, loader);
      updater.SetReporter(reporter);
      updater.SetIsDryRun(dryRun);
      updater.SetLookupByTimestamp(!options.relinkFootprints);
      updater.SetDeleteUnusedFootprints(options.deleteExtraFootprints);
      updater.SetReplaceFootprints(options.updateFootprints);
      updater.SetTransferGroups(options.transferGroups);
      updater.SetOverrideLocks(options.overrideLocks);
      updater.SetUpdateFields(options.updateFields);
      updater.SetRemoveExtraFields(options.removeExtraFields);
      updater.UpdateNetlist(data.netlist);

      if (!dryRun) {
        const runDragCommand = { value: false };
        frame.OnNetlistChanged(updater, runDragCommand);
        // `*aRunDragCommand = true` (`netlist.cpp:152`), acted on by the dialog's
        // destructor: the spread cluster follows the cursor until you click.
        if (followCursor && runDragCommand.value) startPostUpdateMoveRef.current();
      }

      return reporter.lines;
    },
    [],
  );

  // The script API reads everything through refs, so it is registered once
  // for the life of the frame.
  const scriptRef = useRef({
    buildNetlistLibrary,
    runNetlistUpdate,
    projectFilesNow,
    loadFootprint,
  });
  scriptRef.current = {
    buildNetlistLibrary,
    runNetlistUpdate,
    projectFilesNow,
    loadFootprint,
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: everything it reads goes through refs
  useEffect(() => {
    if (!registerScriptApi) return;
    return registerScriptApi({
      board: () => frameRef.current?.GetBoard() ?? null,
      frame: () => frameRef.current,
      updateFromSchematic: async () => {
        const sc = scriptRef.current;
        const files = sc.projectFilesNow();
        const fetched = FetchNetlistFromSchematic(
          frameRef.current?.Kiway() ?? null,
          frameRef.current,
          files,
          'Updating PCB requires a fully annotated schematic.',
          rootPro,
        );
        if (!fetched.ok)
          return { ok: false, report: [fetched.error, fetched.details ?? ''].join('\n').trim() };
        const library = await sc.buildNetlistLibrary(fetched.netlist, files);
        const lines = sc.runNetlistUpdate(
          { netlist: fetched.netlist, library },
          // "Delete footprints with no symbols" on: a part removed from the
          // schematic leaves the board too.
          { ...DEFAULT_UPDATE_PCB_OPTIONS, deleteExtraFootprints: true },
          false,
          false,
        );
        return { ok: true, report: lines.map((l) => l.message).join('\n') };
      },
      fillZones: () => frameRef.current?.GetToolManager()?.RunAction(PCB_ACTIONS.zoneFillAll),
      show3D: () => setShow3D(true),
      route: async (from, to, layer, through = []) => {
        const frame = frameRef.current;
        const kb = frame?.GetBoard();
        if (!frame || !kb) return { ok: false, reason: 'no board open' };
        const view = frame.GetCanvas()?.GetView() ?? null;
        // Arrived means a new segment ends inside the pad at that end on a
        // copper layer the pad has; with no pad there, on the point itself.
        const arrivedAt = (at: { x: number; y: number }) => {
          const pad = kb
            .Footprints()
            .flatMap((f) => f.Pads())
            .find((p) => p.HitTest(at));
          return (e: { x: number; y: number; layer: string }) =>
            pad
              ? pad.IsOnLayer(kb.GetLayerID(e.layer)) && pad.HitTest({ x: e.x, y: e.y })
              : Math.hypot(e.x - at.x, e.y - at.y) < 1000;
        };
        // What ROUTER_TOOL's own Reset gives its interface: the board's
        // design settings, the view's layer visibility, the router settings,
        // and the frame as the commit host.
        const r = routeHeadless(
          kb,
          from,
          to,
          layer,
          {
            designSettings: PnsDesignSettingsFromBds(kb.GetDesignSettings()),
            ...(view
              ? { isLayerVisible: (l: string) => view.IsLayerVisible(kb.GetLayerID(l)) }
              : {}),
            settings: frame.GetPcbNewSettings().m_PnsSettings ?? undefined,
            commitHost: frame,
          },
          kb.GetCopperLayerCount(),
          arrivedAt(from),
          arrivedAt(to),
          through,
        );
        return r.ok ? { ok: true, reason: '' } : { ok: false, reason: r.reason };
      },
      loadFootprint: async (libId) => {
        const lib = await scriptRef.current.loadFootprint(libId);
        return lib?.k ? (lib.k.Duplicate(false) as FOOTPRINT) : null;
      },
    });
  }, [registerScriptApi]);

  const performNetlistUpdate = useCallback(
    (options: UpdatePcbOptions, dryRun: boolean): readonly ReportLine[] =>
      updatePcb ? runNetlistUpdate(updatePcb, options, dryRun) : [],
    [updatePcb, runNetlistUpdate],
  );

  /**
   * `DIALOG_IMPORT_NETLIST::loadNetlist`: `ReadNetlistFromFile` then
   * `BOARD_NETLIST_UPDATER::UpdateNetlist` with the dialog's options, on the
   * same updater Update PCB from Schematic runs. Null when the file cannot be
   * read (the error is the frame's `DisplayErrorMessage`, as upstream).
   */
  const performImportNetlist = useCallback(
    async (
      name: string,
      text: string,
      opts: ImportNetlistOptions,
      dryRun: boolean,
    ): Promise<readonly ReportLine[] | null> => {
      let loaded: ReturnType<typeof readNetlistText>;

      try {
        loaded = readNetlistText(text);
      } catch (e) {
        DisplayErrorMessage(
          `Error loading netlist.\n${e instanceof Error ? e.message : String(e)}`,
        );
        return null;
      }

      if (!loaded) {
        DisplayErrorMessage(`Cannot open netlist file '${name}'.`);
        return null;
      }

      lastNetlistPathRef.current = name;
      const library = await buildNetlistLibrary(loaded.netlist, projectFilesNow());

      return runNetlistUpdate(
        { netlist: loaded.netlist, library },
        {
          // SetFindByTimeStamp( sel == 0 ) / SetLookupByTimestamp( sel == 0 ).
          relinkFootprints: opts.matchByReference,
          transferGroups: opts.transferGroups,
          applyDesignBlockLayouts: false,
          updateFootprints: opts.updateFootprints,
          deleteExtraFootprints: opts.deleteExtraFootprints,
          overrideLocks: opts.overrideLocks,
          // `updater.SetUpdateFields( true )`; nothing in this dialog removes fields.
          updateFields: true,
          removeExtraFields: false,
        },
        dryRun,
      );
    },
    [buildNetlistLibrary, projectFilesNow, runNetlistUpdate],
  );

  // ACTIONS::undo / redo: PCB_CONTROL::Undo / Redo, which run the frame's
  // RestoreCopyFromUndoList / RedoList; the window re-reads the selection the
  // selection tool rebuilt.
  const undo = useCallback(() => {
    const frame = frameRef.current!;
    if (frame.GetUndoCommandCount() <= 0) return;
    runActionRef.current(ACTIONS.undo);
    refreshSelectionMirrorRef.current();
  }, []);

  const redo = useCallback(() => {
    const frame = frameRef.current!;
    if (frame.GetRedoCommandCount() <= 0) return;
    runActionRef.current(ACTIONS.redo);
    refreshSelectionMirrorRef.current();
  }, []);

  // Selection-filter predicate ref (assigned once passesFilter is defined), so
  // the stable Select All callback can honour the live filter.

  // Select All / Unselect All: PCB_SELECTION_TOOL::SelectAll / UnselectAll,
  // which honour the Selection Filter.
  const selectAllSel = useCallback(() => runActionRef.current(ACTIONS.selectAll), []);
  const unselectAllSel = useCallback(() => runActionRef.current(ACTIONS.unselectAll), []);

  /**
   * TRANSITIONAL (#636 stage 3): `PCB_SELECTION_TOOL::GetEnteredGroup()`'s
   * uuid, for the window's own hit test (`hitCandidates`), refreshed with the
   * selection mirror. Entering and leaving are the tool's.
   */
  const enteredGroupRef = useRef<string | null>(null);

  /** The ACTION_MENU a tool pops up - the selection tool's context menu, the disambiguation menu - with its close. */
  const [toolPopup, setToolPopup] = useState<{
    menu: ACTION_MENU;
    x: number;
    y: number;
    onClose: () => void;
  } | null>(null);

  /** ARRAY_TOOL::CreateArray. */
  const applyArray = useCallback((settings: ArraySettings) => {
    setArraySettings(settings);
    setArrayOpen(false);

    const frame = frameRef.current;
    if (!frame || frame.GetSelectionTool().GetSelection().Empty()) return;

    // ARRAY_TOOL::onDialogClosed on the live selection: one BOARD_COMMIT.
    new ARRAY_TOOL(frame).onDialogClosed(
      frame.GetSelectionTool().GetSelection(),
      arraySpecFrom(settings),
    );
  }, []);

  /**
   * `ALIGN_DISTRIBUTE_TOOL`'s submenu (align_distribute_tool.cpp:66-88), built
   * ONCE.
   *
   * It had been written out by hand in the Edit menu, and left out of the
   * selection context menu, which is the one place upstream actually hangs it
   * (`selToolMenu.AddMenu( m_placementMenu, MoreThan( 1 ), 100 )`, :87-88;
   * `menubar_pcb_editor.cpp` has no align rows at all). The hand-written copy
   * had drifted too: "Distribute Horizontally by Gaps" against the action's own
   * "Distribute Horizontally with Even Gaps" (pcb_actions.cpp:2304-2307). One
   * builder is how that stops happening - the editor fills in the data, it does
   * not re-lay the menu.
   *
   * `canAlign` is `MoreThan( 1 )`; `canDistribute` is `MoreThan( 2 )` and the
   * rule above the distribute group carries `canDistribute` itself (:78), so at
   * two items the submenu ends after Align to Bottom rather than on a rule with
   * four dead rows beneath it.
   */
  /**
   * CONVERT_TOOL's "Create from Selection" CONDITIONAL_MENU, evaluated over
   * the selection tool's selection; a chosen row is the menu's own
   * `OnMenuEvent`, which runs the action through the tool manager.
   */
  /** BOARD_INSPECTION_TOOL's NET_CONTEXT_MENU, its rows the tool's actions. */

  // Fit the view to a world-space box (shared by Zoom-to-Fit variants and the
  // interactive zoom tool).
  const fitWorldBox = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number, fitType: FitType = 'all') => {
      const canvas = canvasRef.current;
      if (!canvas || maxX <= minX || maxY <= minY) return;
      // COMMON_TOOLS::doZoomFit's margin_scale_factor, not our own 5 mm pad.
      const s = zoomFitScale(
        { minX, minY, maxX, maxY },
        { width: canvas.width, height: canvas.height },
        'pcb',
        fitType,
      );
      if (s === null) return;
      const flipX = viewRef.current.flipX;
      viewRef.current = {
        scale: s,
        flipX,
        tx: canvas.width / 2 - ((minX + maxX) / 2) * (flipX ? -s : s),
        ty: canvas.height / 2 - ((minY + maxY) / 2) * s,
      };
      requestDraw();
    },
    [requestDraw],
  );

  // ACTIONS::zoomFitScreen (Home): fit the page frame + objects.
  // ACTIONS::zoomFitObjects (Ctrl+Home): fit the objects only, ignoring the
  // drawing sheet.
  //
  // Which box that is — and, on a board with nothing in it, the fact that there
  // is a box at all — is `pcbZoomFitBox`; see `document_extents.ts` for the
  // `GetBoardBoundingBox` fallback it ports. Before it, an empty board's null
  // scene box returned here and the button did nothing.
  const zoomToFitImpl = useCallback(
    (fitType: 'all' | 'objects') => {
      const box = pcbZoomFitBox(boardItemsBox(), {
        paper: (() => {
          const page = frameRef.current?.GetBoard()?.GetPageSettings();
          return page ? paperOfPageInfo(page) : undefined;
        })(),
        drawingSheetVisible: objects.drawingSheet,
        fitType,
        edgeCutsVisible: visibleRef.current.has('Edge.Cuts'),
        edgesBox: boardEdgesBox(),
      });
      if (!box) return;
      fitWorldBox(box.minX, box.minY, box.maxX, box.maxY, fitType);
    },
    [fitWorldBox, objects.drawingSheet],
  );
  const zoomToFit = useCallback(() => zoomToFitImpl('all'), [zoomToFitImpl]);
  const zoomFitObjects = useCallback(() => zoomToFitImpl('objects'), [zoomToFitImpl]);

  /** The footprint indices in the selection, for the 3D viewer's `IsSelected()`. */
  const selectedFootprints = useMemo(() => {
    const out = new Set<number>();
    const fps = frameRef.current?.GetBoard()?.Footprints() ?? [];
    fps.forEach((fp, i) => {
      if (selection.has(fp)) out.add(i);
    });
    return out;
  }, [selection]);

  // `Kiface().IsSingle()`: a project with no schematic runs pcbnew "single".
  const projectHasSchematic = (projectFiles ?? []).some((f) => /\.kicad_sch$/i.test(f.name));

  /**
   * The window half of DRC_TOOL / DIALOG_DRC (`PCB_EDIT_FRAME_HOOKS` above):
   * the dialog's creation and its modal sub-dialogs, the frame's dialog rects
   * and view centring for `FocusOnLocation` / `FocusOnItems`, the item-edit
   * request and the netlist fetch.
   */
  mwWindowRef.current = {
    textEntry: (prompt, caption, value, validator) =>
      new Promise<string | null>((resolve) =>
        setMwTextEntry({ prompt, caption, value, ...(validator ? { validator } : {}), resolve }),
      ),
    polygonDialog: () => new Promise<boolean>((resolve) => setMwPolygonOpen({ resolve })),
    showZoneManager: () =>
      new Promise((resolve) => {
        setZoneManager((prev) => {
          prev?.resolve({ ok: false, repour: false });
          return { resolve };
        });
      }),
    fillAllZones: () => fillAllZonesRef.current(),
  };
  selWindowRef.current = {
    showInfoBarWarning: (aMsg) => setInfoBarError(aMsg),
    showFilterSelectionDialog: (aOptions) =>
      new Promise<boolean>((resolve) =>
        setFilterDlg({
          opts: { ...aOptions },
          // wxID_OK writes the dialog's choices back into the tool's OPTIONS
          // (`m_priv->m_filterOpts`, TransferDataFromWindow).
          resolve: (aOk, aEdited) => {
            if (aOk && aEdited) Object.assign(aOptions, aEdited);
            resolve(aOk);
          },
        }),
      ),
    updateProperties: () => {
      refreshSelectionMirrorRef.current();
      requestDraw();
    },
    windowAction: (aAction) => {
      switch (aAction) {
        // ARRAY_TOOL::CreateArray: the window's Create Array dialog.
        case PCB_ACTIONS.createArray:
          setArrayOpen(true);
          break;
        case ACTIONS.zoomFitScreen:
          zoomToFit();
          break;
        case ACTIONS.zoomFitObjects:
          zoomFitObjects();
          break;
      }
    },
    eventToWindow: (aEvent) => {
      // A TOOL_MANAGER tool owns the canvas: every event is the dispatcher's.
      if (TOOL_MANAGER_TOOLS[activeToolRef.current]) return false;
      // A key: the window's key chain has every key but Escape; Escape in the
      // selection tool is the tool's.
      if (aEvent instanceof wxKeyEvent) {
        if (aEvent.GetKeyCode() !== WXK.WXK_ESCAPE) return true;
        return !isSelectTool(activeToolRef.current);
      }
      if (!(aEvent instanceof wxMouseEvent)) return false;
      return !isSelectTool(activeToolRef.current);
    },
  };
  // EDA_BASE_FRAME::SelectToolbarAction: a toolbar group shows the action a
  // tool names (the Line modes group, from OnAngleSnapModeChanged).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.SetSelectToolbarActionSink((aAction) => {
      const id = Object.keys(PCB_LINE_MODE_ACTIONS).find(
        (k) => PCB_LINE_MODE_ACTIONS[k] === aAction,
      );
      if (id) setToggles((prev) => applyToggle(prev, id));
    });
    return () => frame.SetSelectToolbarActionSink(null);
  }, []);
  // The frame's message panel is this window's MsgPanel.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    setFrameMsgItems([...frame.GetMsgPanelItems()]);
    frame.SetMsgPanelSink((aItems) => setFrameMsgItems([...aItems]));
    return () => frame.SetMsgPanelSink(null);
  }, []);
  // `wxWindow::PopupMenu` for the frame: PCB_SELECTION_TOOL's context menu, and
  // any other ACTION_MENU a tool puts up (the disambiguation menu).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.SetPopupMenuPresenter((aMenu, aOnClose) => {
      const at = KIPLATFORM_UI.GetMousePosition();
      aMenu.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_MENU_OPEN, 0, aMenu));
      // A TOOL_MENU's CONDITIONAL_MENU arrives evaluated against the selection
      // (TOOL_MENU::ShowContextMenu): the rows every tool's Init() added.
      setToolPopup({ menu: aMenu, x: at.x, y: at.y, onClose: aOnClose });
    });
    return () => frame.SetPopupMenuPresenter(null);
  }, []);
  // The Selection Filter panel edits PCB_SELECTION_TOOL's `m_filter` (the
  // panel's checkboxes are its fields, PANEL_SELECTION_FILTER::onFilterChanged).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const filter = frame.GetSelectionTool().GetFilter() as unknown as Record<string, boolean>;
    for (const item of SELECTION_FILTER_ITEMS) filter[item.key] = selFilter.has(item.key);
  }, [selFilter]);
  // The two selection modes are the selection tool's (`ACTIONS::selectSetRect`
  // / `selectSetLasso` set `m_selectionMode`); a window tool leaves it alone.
  // Both set the canvas cursor, so they wait for the canvas.
  useEffect(() => {
    const mgr = frameRef.current?.GetToolManager();
    if (!mgr || !panelReady) return;
    if (activeTool === 'selectSetLasso') mgr.RunAction(ACTIONS.selectSetLasso);
    else if (activeTool === 'selectSetRect') mgr.RunAction(ACTIONS.selectSetRect);
  }, [activeTool, panelReady]);
  // The frame's idle handler: modifier keys change the selection tool's cursor
  // (ADD / SUBTRACT / XOR) without a mouse event (pcb_base_edit_frame.cpp:75-88).
  useEffect(() => {
    const onKey = (): void => {
      if (isSelectTool(activeToolRef.current) && panelRef.current) frameRef.current?.OnIdle();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);
  // A re-derived view renumbers the ids; the tool's items are the same objects.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `board` is the trigger; the mirror reads refs
  useEffect(() => {
    refreshSelectionMirrorRef.current();
  }, [board]);
  editWindowRef.current = {
    showInfoBarMsg: (aMsg) => setInfoBarError(aMsg),
    dismissInfoBar: () => setInfoBarError(null),
    showUnitEntryDialog: (aTitle, aLabel, aValue) =>
      new Promise((resolve) =>
        setUnitEntryDlg({ title: aTitle, label: aLabel, value: aValue, resolve }),
      ),
    showDogboneDialog: (aParams) =>
      new Promise((resolve) => setDogboneDlg({ params: aParams, resolve })),
    showMoveExactDialog: (aValues, aBox) =>
      new Promise((resolve) => setMoveExactDlg({ values: aValues, box: aBox, resolve })),
    showTrackViaPropertiesDialog: (aSelection) => {
      setTrackViaItems([...aSelection.GetItems()]);
      return Promise.resolve();
    },
    // TRANSITIONAL (#636 stage 3): DIALOG_GET_FOOTPRINT_BY_NAME is not built;
    // its "Reference designator:" field, without the "Available footprints:"
    // list, through the text-entry dialog.
    showGetFootprintByNameDialog: (_aList) =>
      mwWindowRef.current!.textEntry('Reference designator:', 'Get and Move Footprint', ''),
    // TRANSITIONAL (#636 stage 3): KIDIALOG has OK and Cancel, so the
    // "Swap All Connected Pads" answer (wxID_NO) is not offered yet.
    showConnectedPadDialog: (aTitle, aMessage, aDetails) =>
      askKiDialog({
        caption: aTitle,
        message: aMessage,
        extendedMessage: aDetails,
        icon: 'warning',
        labels: { ok: 'Ignore Unselected Pads' },
      }).then((r) => (r === 'ok' ? 'ignore' : null)),
    openVertexEditor: () => openVertexEditor(),
  };
  drcWindowRef.current = {
    createDrcDialog: (_aTool: DRC_TOOL): DIALOG_DRC => {
      const frame = frameRef.current!;
      let dialog: DIALOG_DRC;

      const window: DIALOG_DRC_WINDOW = {
        // WX_TEXT_ENTRY_DIALOG( this, wxEmptyString, _( "Exclusion Comment" ),
        // aInitial, true ) - the shared dialog, as the ERC dialog asks too.
        textEntry: (caption, initial) =>
          new Promise<string | null>((resolve) => setDrcTextEntry({ caption, initial, resolve })),
        askDeleteExclusions: () =>
          new Promise<'yes' | 'no' | 'cancel'>((resolve) => setDrcYesNoCancel({ resolve })),
        saveReport: async (defaultName, write) => {
          // wxFileDialog( _( "Save Report File" ), Prj().GetProjectPath(), ... ): the report
          // goes to the project's files, as the plots do; a report or the JSON schema.
          // wxFD_SAVE in the project folder, the report's name suggested.
          const path = await new Promise<string | null>((resolve) =>
            setDrcSaveReport({ defaultName, resolve }),
          );
          if (path === null) return null;
          const prefix = projectName ? `/${projectName}/` : '/';
          const name = path.startsWith(prefix)
            ? path.slice(prefix.length)
            : path.slice(path.lastIndexOf('/') + 1);
          const text = write(name);
          if (text === null) return name;
          writeOutputText(name, text);
          return name;
        },
        displayError: (message) => setUpdatePcbError({ message }),
        showBoardSetupDialog: (page) => {
          setBoardSetupPage(page === 'Custom Rules' ? 'customRules' : 'severities');
          setBoardSetupOpen(true);
        },
        setLayerVisible: (layer, on) =>
          setVisible((prev) => {
            const next = new Set(prev);
            if (on) next.add(LayerName(layer));
            else next.delete(LayerName(layer));
            return next;
          }),
        show: (aShow) => setDrcDialog({ dialog, shown: aShow }),
        raise: () => {},
        isShownOnScreen: () => drcDialogRef.current !== null,
        destroy: () => setDrcDialog(null),
        saveDrcDialogSettings: (values) =>
          updatePcbnewSettings((c) => {
            c.DRC.report_all_track_errors = values.report_all_track_errors;
            c.DRC.crossprobe = values.crossprobe;
            c.DRC.scroll_on_crossprobe = values.scroll_on_crossprobe;
          }),
      };

      dialog = new DIALOG_DRC(frame, window);
      return dialog;
    },
    isSingle: () => !projectHasSchematic,
    fetchNetlistFromSchematic: (aNetlist: NETLIST, aMessage: string): boolean => {
      const fetched = FetchNetlistFromSchematic(
        frameRef.current?.Kiway() ?? null,
        frameRef.current,
        projectFilesNow(),
        aMessage,
        rootPro,
      );

      if (!fetched.ok) {
        // DisplayErrorMessage( this, msg, details )
        setUpdatePcbError({
          message: fetched.error,
          ...(fetched.details ? { details: fetched.details } : {}),
        });
        return false;
      }

      // The fetch built its own NETLIST; the caller's is filled from it.
      for (const component of fetched.netlist.Components()) aNetlist.AddComponent(component);
      for (const group of fetched.netlist.Groups()) aNetlist.AddGroup(group);

      // The DRC worker takes the netlist as the text it was read from
      // (`loadKicadNetlist` on the far side) rather than as the object.
      drcNetlistTextRef.current = fetched.netlistText;

      return true;
    },
    schematicNetlistText: (): string | null => drcNetlistTextRef.current,
    projectText: (): string | null => findProjectPro(projectFilesNow(), rootPro)?.text ?? null,
    /** `PCB_EDIT_FRAME::Edit_Zone_Params`'s actual open: the rendering trigger. */
    editZoneParams: (aZone: ZONE): void => setZoneProps(aZone),
    showFindDialog: (aDialog: DIALOG_FIND): void => setFindDlg(aDialog),
    showPrintDialog: (aDialog: DIALOG_PRINT_PCBNEW): Promise<void> =>
      new Promise<void>((resolve) => setPrintDlg({ dlg: aDialog, done: resolve })),
    showSaveFileDialog: (aTitle, aName, aWildcard, aCheckbox) =>
      new Promise((resolve) =>
        setSaveFileDlg({
          title: aTitle,
          name: aName,
          wildcard: aWildcard,
          checkbox: aCheckbox,
          checked: aCheckbox?.value ?? false,
          resolve,
        }),
      ),
    writeTextFile: (aPath: string, aText: string): boolean => {
      writeOutputText(aPath, aText);
      return true;
    },
    showReferenceImagePropertiesDialog: (aDialog) =>
      new Promise<boolean>((resolve) => setImagePropsDlg({ dialog: aDialog, resolve })),
    showPadPropertiesDialog: (aDialog) => setPadPropsDlg(aDialog),
    showFootprintPropertiesDialog: (aDialog) => setFpPropsDlg(aDialog),
    showDimensionPropertiesDialog: (aDialog) => setDimensionPropsDlg(aDialog),
    showGraphicItemPropertiesDialog: (aDialog) => setShapePropsDlg(aDialog),
    /** `ROUTER_TOOL::SelectCopperLayerPair`'s actual open: the rendering trigger. */
    selectCopperLayerPair: (): void => setLayerPairDialogOpen(true),
    /** `EDA_BASE_FRAME::ShowInfoBarError`: this window's infobar. */
    showInfoBarError: (aMsg: string): void => setInfoBarError(aMsg),
    /**
     * `Kiway().Player( FRAME_FOOTPRINT_CHOOSER )->ShowModal( &footprintName )`
     * (`SelectFootprintFromLibrary`): the chooser opens, and the answer is what
     * `onFootprintChosen` / `onFootprintChooserCancel` resolve.
     */
    selectFootprintFromChooser: (aPreselect: string): Promise<string | null> =>
      new Promise((resolve) => {
        fpChooserResolveRef.current?.(null);
        fpChooserResolveRef.current = resolve;
        setFpChooserPreselect(aPreselect);
        setFpChooserOpen(true);
      }),
    /**
     * `FOOTPRINT_LIBRARY_ADAPTER::LoadFootprintWithOptionalNickname`: the hosted
     * library's footprint, a copy the frame owns. A frame that does not keep the
     * library's UUIDs gets `Duplicate`'s fresh ones (`FootprintLoad`).
     */
    loadFootprintFromLibrary: async (
      aId: LIB_ID,
      aKeepUUID: boolean,
    ): Promise<FOOTPRINT | null> => {
      const lib = await loadFootprint(aId.Format());
      if (!lib?.k) return null;
      return aKeepUUID ? (lib.k.Clone() as FOOTPRINT) : (lib.k.Duplicate(false) as FOOTPRINT);
    },
    // findDialogs(): the DRC dialog is the one modeless dialog of this frame; its
    // rect in canvas client pixels, as ScreenToClient( dialog->GetScreenPosition() ).
    findDialogRects: (): BOX2D[] => {
      const dlg = drcDialogRef.current;
      const canvas = canvasRef.current;
      if (!dlg || !canvas) return [];
      const dr = dlg.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const k = cr.width > 0 ? canvas.width / cr.width : 1; // device px per CSS px
      return [
        new BOX2D(
          { x: (dr.left - cr.left) * k, y: (dr.top - cr.top) * k },
          { x: dr.width * k, y: dr.height * k },
        ),
      ];
    },
    // VIEW::SetCenter( aPos, aObscuringScreenRects ): the editor's own view transform
    // (the VIEW is synced from it); the obscuring rects are already accounted for by
    // FocusOnLocation's decision to centre.
    setViewCenter: (aPos: KVec2): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const sx = v.flipX ? -v.scale : v.scale;
      v.tx = canvas.width / 2 - aPos.x * sx;
      v.ty = canvas.height / 2 - aPos.y * v.scale;
      requestDraw();
    },
  };

  // The TOP_AUX zoom selector: set an absolute zoom about the viewport centre,
  // as COMMON_TOOLS::doZoomToPreset does with VIEW::SetScale.
  const setZoomPreset = useCallback(
    (z: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const target = scaleForZoomFactor(z, window.devicePixelRatio || 1);
      const px = canvas.width / 2;
      const py = canvas.height / 2;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale = target;
      v.tx = px - wx * (v.flipX ? -target : target);
      v.ty = py - wy * target;
      requestDraw();
    },
    [requestDraw],
  );

  const zoomStep = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const px = canvas.width / 2;
      const py = canvas.height / 2;
      const sx = v.flipX ? -v.scale : v.scale;
      const wx = (px - v.tx) / sx;
      const wy = (py - v.ty) / v.scale;
      v.scale *= factor;
      v.tx = px - wx * (v.flipX ? -v.scale : v.scale);
      v.ty = py - wy * v.scale;
      requestDraw();
    },
    [requestDraw],
  );

  // Size the canvas to its container (device pixels) and fit on first layout.
  const fittedRef = useRef(false);
  // `IsShownOnScreen()`, for the observer callback and the frame after a load.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `board` and `shown` are triggers: re-observing fires the observer once more, which is the fit after a load and the fit when the frame is first shown
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      // `canvasBackingSize`, shared with the schematic canvas, and the reason
      // this frame used to shimmer while a dock was dragged: it measured with
      // `getBoundingClientRect()`, whose width is fractional, and put a rounded
      // backing store behind a fractional CSS size — so the browser resampled
      // the whole board on every frame of the drag. See `ui/canvas_size.ts`.
      //
      // `applyCanvasSize` keeps the "only assign canvas.width on a REAL change"
      // rule: assigning it clears the bitmap even when the value is unchanged,
      // and this effect re-runs (and re-observes, firing an initial callback)
      // whenever the draw options change, so a left-toolbar toggle would
      // otherwise blank the view for a frame.
      //
      // The GL and overlay layers are sized with the board canvas. The GL one's
      // drawing buffer *is* the viewport its shaders project into, so a stale
      // size shows up as a board drawn at the wrong scale rather than as
      // nothing at all.
      const size = canvasBackingSize(wrap, dpr);
      // The KiCad canvas sizes its own element (EDA_DRAW_PANEL_GAL::onSize).
      const changed = applyCanvasSize([canvas], size);
      // Only a fit against a viewport that exists counts.
      //
      // The frames stay mounted and are toggled with CSS, so this observer also
      // fires while the board editor is hidden behind the schematic, and a
      // hidden element measures 0 x 0 — which `Math.max(1, …)` above turns into
      // a 1 x 1 canvas. Fitting to that produced a scale and an offset that
      // meant nothing, and recording it as done meant the real layout, when the
      // user finally switched over, never fitted at all: an empty sheet with the
      // origin marker sitting in it until they pressed Zoom to Fit themselves.
      //
      // And only while the frame is shown: a frame kept mounted behind the
      // manager (`content-visibility: hidden` keeps its box) measures a real
      // size too, and a fit taken there is to a viewport the user never sees.
      // `PCB_EDIT_FRAME::onSize` runs its zoomFitScreen `if( IsShownOnScreen() )`
      // and not before.
      if (!fittedRef.current && boardRef.current && isMeasured(size) && shownRef.current) {
        fittedRef.current = true;
        zoomToFit();
      } else if (changed) {
        requestDraw();
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dpr, requestDraw, zoomToFit, board, shown]);

  // The other half of the same race: a board can finish parsing after the last
  // resize the observer will ever see, and then nothing is left to trigger the
  // first fit. Runs on the frame after the board changes, does nothing once a
  // real fit has happened, and does nothing while the frame is hidden — so the
  // fit lands on whichever of the two events happens last.
  useEffect(() => {
    if (!board) return;
    let raf = 0;
    const tryFit = (): void => {
      if (fittedRef.current || !boardRef.current) return;
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0 || !shownRef.current) return;
      fittedRef.current = true;
      zoomToFit();
    };
    raf = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(raf);
  }, [board, zoomToFit]);

  // Flip board view (PCB_ACTIONS::flipBoard → VIEW::SetMirror on X): toggle the
  // view's horizontal mirror, re-centring so the board stays put. The mirror
  // itself is the VIEW's matrix, pushed by `syncViewTransform`.
  const toggleFlip = useCallback(() => {
    const v = viewRef.current;
    const canvas = canvasRef.current;
    v.flipX = !v.flipX;
    // Mirror tx about the viewport centre so the visible board doesn't jump.
    if (canvas) v.tx = canvas.width - v.tx;
    setFlipView(v.flipX);
    requestDraw();
  }, [requestDraw]);

  // World coordinate under a pointer event (device pixels → board units).
  const worldAt = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      // The VIEW may have moved (a wheel zoom, autopan) since the last paint.
      if (panelRef.current) syncWindowViewRef.current(panelRef.current);
      const v = viewRef.current;
      return {
        x: ((clientX - rect.left) * dpr - v.tx) / (v.flipX ? -v.scale : v.scale),
        y: ((clientY - rect.top) * dpr - v.ty) / v.scale,
      };
    },
    [dpr],
  );

  // The left press in progress: origin, world origin, the item it landed on (if
  // any), and whether it has moved. Still = click; moved on an item = drag-move;
  // moved on empty = box-select.
  const downRef = useRef<{
    x: number;
    y: number;
    world: { x: number; y: number } | null;
    hitId: string | null;
    onItem: boolean;
    moved: boolean;
    shift: boolean;
  } | null>(null);

  /**
   * The browser's own menu never opens on the canvas: a right click is
   * PCB_SELECTION_TOOL::Main's (`m_menu->ShowContextMenu( m_selection )`,
   * pcb_selection_tool.cpp:359-379), which reaches the window through
   * `PopupMenu`.
   */
  const onCanvasContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
  };

  /**
   * The system clipboard's own events, so Ctrl+X / Ctrl+C / Ctrl+V work and not
   * only the menu rows. Same shape as the schematic editor's, for the same
   * reason: the browser will only hand a page the clipboard from inside one of
   * these three events.
   *
   * The editors all stay mounted behind `display: none`, so only the visible
   * frame may own them — `App` stamps the active view on `document.body` and
   * every frame checks it. Without that, the PCB editor would answer a copy
   * pressed in the schematic.
   */
  useEffect(() => {
    const hidden = (): boolean => document.body.dataset.activeView !== 'pcb';
    // `isTypingTarget` is the shared predicate, and its own doc comment names
    // Ctrl+C / Ctrl+X / Ctrl+V as the reason it exists: while a field has
    // focus the FIELD's copy must win, not the board's. Building a synthetic
    // Ctrl+C to ask `focusBlocksHotkey` instead put a hand-written modifier
    // comparison in a converted frame, which is the one thing
    // `menu_hotkey_coverage.test.ts` forbids — and it caught it.
    const typing = (): boolean => isTypingTarget(document.activeElement as FocusLike | null);

    // EDIT_TOOL::copyToClipboard / cutToClipboard save through SaveClipboard;
    // inside the browser's own event, what they saved goes on the system
    // clipboard too.
    const onCopy = (e: ClipboardEvent): void => {
      if (hidden() || typing() || selForDrawRef.current.size === 0) return;
      runActionRef.current(ACTIONS.copy);
      const text = GetClipboardText();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent): void => {
      if (hidden() || typing() || selForDrawRef.current.size === 0) return;
      runActionRef.current(ACTIONS.cut);
      const text = GetClipboardText();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    // PCB_CONTROL::Paste reads the clipboard; the event's data becomes it first.
    const onPaste = (e: ClipboardEvent): void => {
      if (hidden() || typing() || !e.clipboardData) return;
      e.preventDefault();
      void SetClipboardFromPaste(e.clipboardData).then(() => runActionRef.current(ACTIONS.paste));
    };

    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  // ----- graphic shape drawing (DRAWING_TOOL) ---------------------------------

  // ----- interactive routing (ROUTER_TOOL, highlight mode) --------------------

  // While routing the crosshair is where ROUTER_TOOL put it:
  // `controls()->ForceCursorPosition( true, m_endSnapPoint )` at the end of
  // `TOOL_BASE::updateEndItem`, read back as EDA_DRAW_PANEL_GAL draws the
  // cursor (`m_viewControls->GetCursorPosition()`, draw_panel_gal.cpp:299).
  routeSnapRef.current = (w) =>
    frameRef.current?.GetCanvas()?.GetViewControls().GetCursorPosition() ?? snapToGrid(w);

  /**
   * The two controls the *board's* table dialog has and the schematic's does
   * not: `m_LayerSelectionCtrl` and `m_cbLocked`
   * (`pcbnew/dialogs/dialog_table_properties_base.h:45-46`). A `SCH_TABLE` has
   * neither — it has no layer and eeschema has no lock — so they are passed
   * into the shared dialog rather than living in it.
   *
   * `m_LayerSelectionCtrl` is a PCB_LAYER_BOX_SELECTOR, which draws each
   * layer's colour swatch through `LAYER_PRESENTATION::DrawColorSwatch`; a
   * plain list of names is not that control.
   */
  const tableDialogHeader = (
    v: TableValues,
    set: (patch: Partial<TableValues>) => void,
  ): JSX.Element => (
    <div className="ze-tableprops-header">
      <label className="row ze-tableprops-field">
        <span className="ze-tableprops-lbl">Layer:</span>
        <Combo
          value={v.layer}
          onChange={(layer) => set({ layer })}
          options={enabledLayerNames(frameRef.current?.GetBoard()).map((name) => ({
            value: name,
            label: name,
            swatch: layerColor(name),
          }))}
        />
      </label>
      <label className="row ze-tableprops-field">
        <input
          type="checkbox"
          checked={v.locked}
          onChange={(e) => set({ locked: e.target.checked })}
        />
        <span className="ze-tableprops-boxlbl">Locked</span>
      </label>
    </div>
  );

  /**
   * A click with the reference image tool active
   * (`DRAWING_TOOL::PlaceReferenceImage`). The first opens the file dialog and
   * puts the picture on the cursor; the second drops it.
   */

  /** The chooser answered: `ShowModal` returned, `footprintName` set. */
  const onFootprintChosen = (libId: string): void => {
    setFpChooserOpen(false);
    fpChooserResolveRef.current?.(libId);
    fpChooserResolveRef.current = null;
  };

  /** The chooser was cancelled: `ShowModal` returned 0. */
  const onFootprintChooserCancel = (): void => {
    setFpChooserOpen(false);
    fpChooserResolveRef.current?.(null);
    fpChooserResolveRef.current = null;
  };

  /**
   * `FOOTPRINT_VIEWER_FRAME::AddFootprintToPCB`'s board half
   * (`footprint_viewer_frame.cpp:735-779`): `selectionClear`, then
   * `PostAction( PCB_ACTIONS::placeFootprint, newFootprint )` - the tool runs
   * with the footprint as its parameter, so it is on the cursor at once and
   * the next click commits it.
   */
  const placeFromBrowser = (aFpid: string, _aFootprint: PcbFootprint): void => {
    setFpChooserOpen(false);
    const frame = frameRef.current;
    if (!frame) return;
    frame.GetToolManager()?.RunAction(ACTIONS.selectionClear);
    const fpid = new LIB_ID();
    fpid.Parse(aFpid);
    void frame.LoadFootprint(fpid).then((fp) => {
      if (fp) frame.GetToolManager()?.PostAction(PCB_ACTIONS.placeFootprint, fp);
    });
  };
  const placeFromBrowserRef = useRef(placeFromBrowser);
  placeFromBrowserRef.current = placeFromBrowser;

  /**
   * Place a snap point (`DRAWING_TOOL::PlacePoint`, drawing_tool.cpp:914-930).
   *
   * `POINT_PLACER::CreateItem` makes a default `PCB_POINT` and sets exactly one
   * thing on it, `SetLayer( m_frame.GetActiveLayer() )` — so the size is the
   * constructor's 1 mm and the position is whatever `SnapItem` forced the
   * cursor to, which is `cursorSnapRef` here.
   *
   * `IPO_REPEAT` means the tool re-arms after each placement rather than
   * falling back to the selection tool, so this handler does not clear
   * `activeTool`; `IPO_SINGLE_CLICK` is why one click both creates and commits
   * (the preview item exists before the first click, see `pointPreviewRef`).
   */

  // ----- interactive move / drag (EDIT_TOOL Move vs Drag) ---------------------

  // Start a move/drag of `sel` from world grab point `origin`. 'move' leaves the
  // routing behind; 'drag' stretches the traces attached to moving footprints.
  // Splits the scene into a backdrop (everything else) + a live moving overlay.

  /** The BOARD_ITEMs hidden in the VIEW for the gesture in flight. */

  /** The gesture is over: the hidden items draw again (`VIEW::Hide( item, false )`). */

  /**
   * Fill All Zones (PCB_ACTIONS::zoneFillAll, the B key): re-pour every zone
   * from the current copper. ZONE_FILLER::Fill runs over the whole board rather
   * than one zone, so an edit anywhere re-flows everything that touches it.
   */
  const fillAllZones = useCallback(() => {
    frameRef.current?.GetToolManager()?.RunAction(PCB_ACTIONS.zoneFillAll);
  }, []);
  // The global key handler is stable, so it reaches the action through a ref.
  const fillAllZonesRef = useRef(fillAllZones);
  fillAllZonesRef.current = fillAllZones;

  /** DIALOG_TRACK_VIA_PROPERTIES::TransferDataFromWindow. */
  const applyTrackViaEdit = useCallback(
    (values: TrackViaValues) => {
      const frame = frameRef.current;
      const items = trackViaItems;
      if (!frame || !items) {
        setTrackViaItems(null);
        return;
      }
      // DIALOG_TRACK_VIA_PROPERTIES on the live items: one BOARD_COMMIT. A
      // refused OK leaves the dialog up behind its error, as DisplayError does.
      void new DIALOG_TRACK_VIA_PROPERTIES(frame, items)
        .TransferDataFromWindow(values, askKiDialog)
        .then((r) => {
          if (r.ok) setTrackViaItems(null);
          else if (r.message) DisplayErrorMessage(r.message);
        });
    },
    [askKiDialog, trackViaItems],
  );

  /** DIALOG_TEXT_PROPERTIES / DIALOG_SHAPE_PROPERTIES::TransferDataFromWindow. */
  const applyTextEdit = useCallback(
    (values: TextValues) => {
      const d = textPropsDlg;
      setTextPropsDlg(null);
      if (!d) return;
      // On the live PCB_TEXT: one BOARD_COMMIT, or none for a new text (IS_NEW),
      // which its tool commits.
      const r = d.dialog.TransferDataFromWindow(values);
      d.resolve?.(r.ok);
    },
    [textPropsDlg],
  );

  /** DIALOG_TABLE_PROPERTIES::TransferDataFromWindow. */
  const applyTableEdit = useCallback(
    (values: TableValues) => {
      const d = tablePropsDlg;
      setTablePropsDlg(null);
      if (!d) return;
      // On the live PCB_TABLE: one BOARD_COMMIT, or none for a new table (IS_NEW),
      // which its tool commits.
      const r = d.dialog.TransferDataFromWindow(values);
      d.resolve?.(r.ok);
    },
    [tablePropsDlg],
  );

  /** DIALOG_TEXTBOX_PROPERTIES::TransferDataFromWindow. */
  const applyTextBoxEdit = useCallback(
    (values: TextBoxValues) => {
      const d = textBoxPropsDlg;
      setTextBoxPropsDlg(null);
      if (!d) return;
      // On the live PCB_TEXTBOX: one BOARD_COMMIT, or none for a new box (IS_NEW),
      // which its tool commits.
      const r = d.dialog.TransferDataFromWindow(values);
      d.resolve?.(r.ok);
    },
    [textBoxPropsDlg],
  );

  /** DIALOG_REFERENCE_IMAGE_PROPERTIES::TransferDataFromWindow. */
  const applyImageEdit = useCallback(
    (values: ImageValues) => {
      const req = imagePropsDlg;
      setImagePropsDlg(null);
      if (!req) return;

      let question: string | null = null;
      const r = req.dialog.TransferDataFromWindow(values, (m) => {
        question = m;
        return false;
      });
      if (r.ok) req.resolve(true);
      else if (question !== null)
        void IsOK(question).then((yes) => {
          req.resolve(yes && req.dialog.TransferDataFromWindow(values).ok);
        });
      else req.resolve(false);
    },
    [imagePropsDlg],
  );

  /** DIALOG_DIMENSION_PROPERTIES::TransferDataFromWindow. */
  const applyDimensionEdit = useCallback(
    (values: DimensionValues) => {
      const dlg = dimensionPropsDlg;
      setDimensionPropsDlg(null);
      // DIALOG_DIMENSION_PROPERTIES on the live dimension: one BOARD_COMMIT.
      dlg?.TransferDataFromWindow(values);
    },
    [dimensionPropsDlg],
  );

  const applyShapeEdit = useCallback(
    (values: ShapeValues) => {
      const dlg = shapePropsDlg;
      setShapePropsDlg(null);
      // DIALOG_SHAPE_PROPERTIES on the live PCB_SHAPE: one BOARD_COMMIT.
      dlg?.TransferDataFromWindow(values);
    },
    [shapePropsDlg],
  );

  /** DIALOG_PAD_PROPERTIES::TransferDataFromWindow. */
  const applyPadEdit = useCallback(
    (values: PadValues) => {
      const dlg = padPropsDlg;
      setPadPropsDlg(null);
      // DIALOG_PAD_PROPERTIES on the live PAD: one BOARD_COMMIT.
      dlg?.TransferDataFromWindow(values);
    },
    [padPropsDlg],
  );

  /** DIALOG_FOOTPRINT_PROPERTIES::TransferDataFromWindow. */
  const applyFootprintEdit = useCallback(
    (values: FootprintValues) => {
      const dlg = fpPropsDlg;
      setFpPropsDlg(null);
      // DIALOG_FOOTPRINT_PROPERTIES on the live FOOTPRINT: one BOARD_COMMIT.
      dlg?.TransferDataFromWindow(values);
    },
    [fpPropsDlg],
  );

  /** PANEL_ZONE_PROPERTIES::TransferDataFromWindow. */
  const applyZoneEdit = useCallback(
    (values: ZoneValues) => {
      const zone = zoneProps;
      setZoneProps(null);
      const frame = frameRef.current;
      // Edit_Zone_Params: a copper zone is DIALOG_COPPER_ZONE on the live
      // ZONE, one BOARD_COMMIT; the commit refills under "Auto-refill zones".
      if (frame && zone) new DIALOG_COPPER_ZONE(frame, zone).TransferDataFromWindow(values);
    },
    [zoneProps],
  );

  /** Edit_Zone_Params on a rule area: DIALOG_RULE_AREA_PROPERTIES on the live ZONE. */
  const applyRuleAreaEdit = useCallback(
    (values: RuleAreaValues) => {
      const zone = zoneProps;
      setZoneProps(null);
      const frame = frameRef.current;
      if (frame && zone)
        new DIALOG_RULE_AREA_PROPERTIES(frame, zone).TransferDataFromWindow(values);
    },
    [zoneProps],
  );

  /**
   * DIALOG_GLOBAL_EDIT_TEARDROPS::TransferDataFromWindow, on the live BOARD:
   * the items' parameters are staged on a BOARD_COMMIT and TEARDROP_MANAGER
   * rebuilds the zones, as upstream does; the listener re-derives the view.
   */
  /**
   * After DIALOG_GLOBAL_EDIT_TEARDROPS applies: the scope checkboxes are project
   * state (`teardrop_options`), which the dialog wrote onto
   * BOARD_DESIGN_SETTINGS; persist them with the project.
   */
  const onTeardropsApplied = useCallback((): void => {
    const kb = frameRef.current?.GetBoard();
    if (!kb) return;

    // A run that changed no item (every filter missed) raises no listener
    // call; the view is re-derived here instead.
    if (!listenerRef.current!.IsPending())
      setBoardModel({
        ...boardFromBOARD(kb, fileNameRef.current),
        fileName: fileNameRef.current,
      });

    const tdl = kb.GetDesignSettings().GetTeadropParamsList();
    commitBoardSetup({
      ...boardSetupRef.current,
      teardrops: {
        ...boardSetupRef.current.teardrops,
        targets: {
          vias: tdl.m_TargetVias,
          pthPads: tdl.m_TargetPTHPads,
          smdPads: tdl.m_TargetSMDPads,
          trackToTrack: tdl.m_TargetTrack2Track,
          roundShapesOnly: tdl.m_UseRoundShapesOnly,
        },
      },
    });
  }, [commitBoardSetup, setBoardModel]);

  /**
   * `DIALOG_UPDATE_PCB::~DIALOG_UPDATE_PCB` (`dialog_update_pcb.cpp:65-85`): once
   * the update has spread the new footprints, KiCad hands the whole cluster to
   * the cursor as a move, so you drop it where you want it.
   *
   *     if( m_runDragCommand )
   *     {
   *         // Set the reference point to (0,0) where the new footprints were
   *         // spread. This ensures the move tool knows where the items are
   *         // located, preventing an offset when the "warp cursor to origin of
   *         // moved object" preference is disabled.
   *         if( selection.Size() > 0 )
   *             selection.SetReferencePoint( VECTOR2I( 0, 0 ) );
   *         …
   *     }
   *
   * `netlist.cpp:149` spreads to `{ 0, 0 }`, which is why the reference point is
   * that and not the cluster's own corner. Without this the cluster is simply
   * left at the page origin — the top-left of the sheet — which is not where
   * anybody wants their board.
   *
   * A ref because the update handler is a `useCallback`; the selection it
   * writes is the selection tool's, and the move is EDIT_TOOL's.
   */
  const startPostUpdateMoveRef = useRef<() => void>(() => {});
  startPostUpdateMoveRef.current = () => {
    const frame = frameRef.current;
    if (!frame) return;
    const selection = frame.GetSelectionTool().GetSelection();
    if (selection.Size() === 0) return;
    selection.SetReferencePoint({ x: 0, y: 0 });
    frame.GetToolManager()?.PostAction(PCB_ACTIONS.move);
  };

  /**
   * The window's own tools' press (TRANSITIONAL, #636 stage 3). The selection
   * tool takes its own presses through the dispatcher; what is left here is a
   * press `eventToWindow` gave the window: a click tool's, a point edit's, the
   * end of a keyboard grab - and, in the selection tool, only where the press
   * went down, for a move the tool starts through `PCB_ACTIONS::move`.
   */
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 0) {
      const w = worldAt(e.clientX, e.clientY);
      downRef.current = {
        x: e.clientX,
        y: e.clientY,
        world: w,
        hitId: null,
        onItem: false,
        moved: false,
        shift: e.shiftKey,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    shiftDownRef.current = e.shiftKey;
    ctrlDownRef.current = e.ctrlKey || e.metaKey;
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      // Signed X so the crosshair tracks the physical cursor under a flipped view.
      const wx = ((e.clientX - rect.left) * dpr - v.tx) / (v.flipX ? -v.scale : v.scale);
      const wy = ((e.clientY - rect.top) * dpr - v.ty) / v.scale;
      statusReadout.setCursor({ x: wx, y: wy });
      cursorRef.current = { x: wx, y: wy };
      // Repaint so the crosshair follows even on a plain hover (no pan/drag).
      requestDraw();
    }
    const d = downRef.current;
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3 * dpr) d.moved = true;
      // Click-driven tools (delete, local ratsnest, drawing, routing, vias,
      // text) take no drag-move or box-select gestures.
      if (isClickTool(activeToolRef.current)) return;
      const cur = worldAt(e.clientX, e.clientY);
      if (!cur) return;
      // ZOOM_TOOL::selectRegion rubber-bands the area it zooms to.
      if (d.moved && d.world && activeToolRef.current === 'zoomTool') {
        boxRef.current = { a: d.world, b: cur };
        requestDraw();
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    const d = downRef.current;
    const box = boxRef.current;
    downRef.current = null;
    boxRef.current = null;
    if (d) {
      // Zoom-to-selection (ZOOM_TOOL::Main): a dragged box zooms into it, a
      // plain click zooms in a step about the clicked point; either way the
      // tool returns to selection after one use.
      if (activeToolRef.current === 'zoomTool') {
        if (box) {
          fitWorldBox(
            Math.min(box.a.x, box.b.x),
            Math.min(box.a.y, box.b.y),
            Math.max(box.a.x, box.b.x),
            Math.max(box.a.y, box.b.y),
            'selection',
          );
        } else if (!d.moved) {
          zoomStep(1.3);
        }
        setActiveTool(selectModeRef.current);
        requestDraw();
        return;
      }
      if (!d.moved) {
        // A click in the selection tool is the tool's, through the dispatcher.
      }
    }
    requestDraw();
  };
  // Pointer left the canvas, drop the crosshair.
  const onPointerLeave = (): void => {
    cursorRef.current = null;
    statusReadout.setCursor(null);
    requestDraw();
  };

  /**
   * The menu tree, mirrored for the key chain below - `menus` is rebuilt every
   * render, and the chain has to dispatch off the live one so a row's
   * `disabled` (which moves with the selection) is honoured. Same reason
   * `useMenuHotkeys` holds a ref rather than a dependency.
   */
  const menusRef = useRef<Menu[]>([]);

  // One chain, in ACTION_MANAGER::RunHotKey order: the context actions this
  // canvas owns, then the menus. See ui/menu_hotkeys.ts for why there is not a
  // second listener beside this one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'pcb') !== 'pcb') return;
      // The 3D viewer overlay claims every unmodified key while it is up.
      // `defaultPrevented` means someone already acted on this key - EXCEPT
      // when it was our own browser suppressor, which runs in the capture phase
      // and cancels every combo the app claims purely to stop the browser.
      // Reading that as "handled" is what made every hotkey in the app stop
      // working once the dispatcher landed (c4a00590).
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      // tool_dispatcher.cpp:654-670 - an editable entry takes every key, a
      // read-only one keeps Ctrl+C. dispatchMenuHotkey re-applies this for the
      // menus; here it gates the context branches.
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      const mod = e.ctrlKey || e.metaKey;

      // A TOOL_MANAGER tool (DRAWING_TOOL's shapes) takes its keys through
      // TOOL_DISPATCHER: Esc is TA_CANCEL_TOOL, and the rest reach the
      // actions' hotkeys (deleteLastPoint, arcPosture, incWidth...) there.
      if (TOOL_MANAGER_TOOLS[activeToolRef.current] && !mod) {
        const canvas = glCanvasRef.current;
        const dispatcher = frameRef.current?.GetToolDispatcher();
        if (canvas && dispatcher) {
          const at = KIPLATFORM_UI.GetMousePosition();
          e.preventDefault();
          dispatcher.DispatchWxEvent(
            wxKeyEventFromDom(
              canvas,
              e,
              wxEVT_CHAR_HOOK,
              clientPosition(canvas, { clientX: at.x, clientY: at.y }),
            ),
          );
          return;
        }
      }

      // PCB_BASE_EDIT_FRAME::TryBefore: Tab with PRESET_SWITCH_KEY (Ctrl) or
      // VIEWPORT_SWITCH_KEY (Shift) raises EDA_VIEW_SWITCHER.
      if (e.key === 'Tab' && openViewSwitcherRef.current(mod, e.shiftKey)) {
        e.preventDefault();
        return;
      }

      // --- context: what the live tool / selection owns ---------------------
      if (!mod && (e.key === 'r' || e.key === 'R')) {
        runAction(e.shiftKey ? PCB_ACTIONS.rotateCw : PCB_ACTIONS.rotateCcw);
        return;
      } // R = CCW, Shift+R = CW (PCB_ACTIONS::rotateCcw / rotateCw, no row)
      // M = Move (routing left behind), G = Drag (attached traces follow), a
      // keyboard grab that follows the cursor and commits on click (EDIT_TOOL).
      // Shift is excluded because Shift+M is Move Exactly, which *has* a row:
      // `e.key` is already 'M' whenever shift is held, so without the guard
      // this would swallow the row's accelerator before it reached the menu.
      if (!mod && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        runAction(PCB_ACTIONS.move);
        return;
      }
      if (!mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        runAction(PCB_ACTIONS.dragFreeAngle);
        return;
      }
      // Bare D is drag45; Ctrl+D is Edit > Duplicate and belongs to its row.
      if (!mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        runAction(PCB_ACTIONS.drag45Degree);
        return;
      }
      // B = Fill All Zones (PCB_ACTIONS::zoneFillAll), no row.
      if (!mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        fillAllZonesRef.current();
        return;
      }
      // ACTIONS::zoomFitScreen: WXK_HOME off macOS, Ctrl+0 on it
      // (actions.cpp:719-724). Home is the only spelling bound, and the View
      // menu row now prints it.
      if (!mod && e.key === 'Home') {
        e.preventDefault();
        zoomToFit();
        return;
      }
      // Net highlight (BOARD_INSPECTION_TOOL). `~` clears; Alt+` toggles the last
      // highlight on/off; a bare ` highlights the net under the cursor.
      if (!mod && e.key === '~') {
        e.preventDefault();
        runAction(PCB_ACTIONS.clearHighlight);
        return;
      }
      if (e.key === '`') {
        e.preventDefault();
        // `toggleNetHighlight` is MD_ALT + '`'; `highlightNet` the bare key.
        runAction(e.altKey ? PCB_ACTIONS.toggleNetHighlight : PCB_ACTIONS.highlightNet);
        return;
      }
      if (e.key === 'Escape') {
        // Escape cancels what a window tool has in flight, then leaves the
        // tool; in the selection tool it is Main's.
        if (!isSelectTool(activeToolRef.current)) {
          // Esc in a tool returns to the selection tool (TOOL_MANAGER), in
          // whichever mode it was left in.
          // `PCB_PICKER_TOOL::Main`: `IsCancelInteractive()` is EVT_CANCEL,
          // and the ratsnest picker's finalize handler resets every pad's
          // local override on anything but END_ACTIVATE.
          setActiveTool(selectModeRef.current);
        } else {
          setShow3D(false);
          // The selection tool's cancel (`IsCancel()`, pcb_selection_tool.cpp:
          // 554-584): clear the selection, else leave the entered group, else
          // clear the net highlight when `m_ESCClearsNetHighlight` says so. The
          // key reaches the canvas's dispatcher first when the canvas has the
          // focus; from anywhere else in the frame it is handed to it here, as
          // the frame's char hook hands it upstream.
          const canvas = glCanvasRef.current;
          const dispatcher = frameRef.current?.GetToolDispatcher();
          if (canvas && dispatcher) {
            const at = KIPLATFORM_UI.GetMousePosition();
            dispatcher.DispatchWxEvent(
              wxKeyEventFromDom(
                canvas,
                e,
                wxEVT_CHAR_HOOK,
                clientPosition(canvas, {
                  clientX: at.x,
                  clientY: at.y,
                }),
              ),
            );
          }
        }
        return;
      }

      // --- global: the menu accelerators ------------------------------------
      if (dispatchMenuHotkey(menusRef.current, e, { target })) {
        e.preventDefault();
        return;
      }

      // --- the rest: TOOL_DISPATCHER, as the frame's char hook passes it on ---
      // (EDA_BASE_FRAME::OnCharHook only skips): ACTION_MANAGER::RunHotKey runs
      // the action bound to the key - PCB_CONTROL's layer keys, the H contrast
      // cycle and every other tool hotkey with no menu row. wxEVT_CHAR_HOOK
      // first, then wxEVT_CHAR, as the canvas sends them.
      const canvas = glCanvasRef.current;
      const dispatcher = frameRef.current?.GetToolDispatcher() as unknown as
        | GATED_DISPATCHER
        | null
        | undefined;
      if (canvas && dispatcher) {
        const at = KIPLATFORM_UI.GetMousePosition();
        const pos = clientPosition(canvas, { clientX: at.x, clientY: at.y });
        const hook = wxKeyEventFromDom(canvas, e, wxEVT_CHAR_HOOK, pos);
        dispatcher.DispatchToTools(hook);
        if (!hook.GetSkipped()) {
          e.preventDefault();
          return;
        }
        const ch = wxKeyEventFromDom(canvas, e, wxEVT_CHAR, pos);
        dispatcher.DispatchToTools(ch);
        if (!ch.GetSkipped()) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomToFit]);

  // The snap modifiers, tracked on the keyboard as well as the pointer.
  // Upstream a modifier arrives as its own `TOOL_EVENT`, so pressing Shift or
  // Ctrl changes the snap immediately; sampling them only on pointer move
  // leaves the snap stale until the mouse is nudged. A repaint follows so the
  // crosshair and any in-flight preview move the moment the key does.
  useEffect(() => {
    const sync = (e: KeyboardEvent): void => {
      const shift = e.shiftKey;
      const ctrl = e.ctrlKey || e.metaKey;
      if (shift === shiftDownRef.current && ctrl === ctrlDownRef.current) return;
      shiftDownRef.current = shift;
      ctrlDownRef.current = ctrl;
      requestDrawRef.current();
    };
    // A window that loses focus mid-chord never sees the keyup, which would
    // otherwise leave snapping disabled until the key is pressed and released
    // again.
    const clear = (): void => {
      shiftDownRef.current = false;
      ctrlDownRef.current = false;
    };
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // ----- appearance data ------------------------------------------------------

  /**
   * BOARD::GetLayerName for this board — the one place the frame turns a layer
   * into text for the user. The Appearance list, the aux-bar layer selector
   * and the readout all go through it, the way every upstream caller goes
   * through BOARD::GetLayerName rather than spelling the name itself.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `board` is the trigger; the BOARD is read through frameRef
  const layerName = useCallback(
    // BOARD::GetLayerName: the user's name for the layer, or its canonical one.
    (name: string): string =>
      frameRef.current?.GetBoard()?.GetLayerName(LSET.NameToLayer(name)) ?? name,
    [board],
  );

  const copperLayers = useMemo(
    () =>
      board ? enabledLayerNames(frameRef.current?.GetBoard()).filter((n) => /\.Cu$/.test(n)) : [],
    [board],
  );
  // Copper layers first, then the technical layers in rebuildLayers()'s
  // non_cu_seq order, then any remaining - the shared rule, in
  // `widgets/appearance_layers.ts`.
  /**
   * The rule area dialog's layer list. `DIALOG_RULE_AREA_PROPERTIES` fills it
   * from `LSET::AllNonCuMask()`'s complement — every board layer the frame
   * offers — each row a checkbox, a colour swatch and the layer's name.
   */
  const ruleAreaLayers = useMemo(
    () =>
      board
        ? enabledLayerNames(frameRef.current?.GetBoard()).map((name) => ({
            name,
            color: drawOpts.theme?.layerColors[name] ?? layerColor(name),
          }))
        : [],
    [board, drawOpts.theme],
  );
  /** The copper rows the zone dialog's layer list draws, with their swatches. */
  const copperLayerRows = useMemo(
    () =>
      copperLayers.map((name) => ({
        name,
        color: drawOpts.theme?.layerColors[name] ?? layerColor(name),
      })),
    [copperLayers, drawOpts.theme],
  );
  const layerRows = useMemo(
    () =>
      board
        ? appearanceLayerRows(copperLayers, enabledLayerNames(frameRef.current?.GetBoard()))
        : [],
    [board, copperLayers],
  );

  /**
   * Which entry the presets combo shows. Derived every render, never stored:
   * syncLayerPresetSelection searches the presets for one matching the view
   * and selects the separator when none does, so there is no state to keep in
   * step and no "(unsaved)" sentinel — that entry is in the wxFormBuilder stub
   * and Clear() removes it before the combo is ever seen.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `board` is the trigger; the BOARD is read through frameRef
  const preset = useMemo(
    () =>
      matchPresetName({
        visibleLayers: visible,
        objectsAtDefault: OBJECT_ROWS.every(
          (r) => r === 'sep' || objects[r.key] === DEFAULT_OBJECTS[r.key],
        ),
        flipBoard: flipView,
        allLayers: enabledLayerNames(frameRef.current?.GetBoard()),
        copperLayers,
        userPresets,
      }),
    [visible, objects, flipView, board, copperLayers, userPresets],
  );

  const toggleLayer = (name: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const applyPreset = (name: string): void => {
    setPresetMRU((m) => touchMRU(m, name));
    const user = userPresets.find((x) => x.name === name);
    if (user) {
      setVisible(new Set(user.layers));
      return;
    }
    const p = BUILTIN_PRESETS.find((x) => x.name === name);
    if (!p || !board) return;
    const all = enabledLayerNames(frameRef.current?.GetBoard());
    setVisible(new Set(p.layers(all, copperLayers).filter((l) => all.includes(l))));
    // doApplyLayerPreset also carries the preset's flipBoard and activeLayer.
    setFlipView(p.flipBoard);
    if (p.activeLayer && all.includes(p.activeLayer)) switchActiveLayer(p.activeLayer);
  };

  // Layer right-click context menu ops (APPEARANCE_CONTROLS::onLayerContextMenu).
  const nonCopperLayers = useMemo(
    () =>
      board ? enabledLayerNames(frameRef.current?.GetBoard()).filter((n) => !/\.Cu$/.test(n)) : [],
    [board],
  );
  const setVisibleUnsaved = (names: Iterable<string>): void => {
    setVisible(new Set(names));
  };
  const layerMenuItems = (): { label: string; run: () => void }[][] => {
    if (!board) return [];
    const all = enabledLayerNames(frameRef.current?.GetBoard());
    const has = (n: string): boolean => all.includes(n);
    const applyNamed = (name: string, active?: string): void => {
      const p = BUILTIN_PRESETS.find((x) => x.name === name);
      if (!p) return;
      setVisibleUnsaved(p.layers(all, copperLayers).filter(has));
      if (active && has(active)) switchActiveLayer(active);
    };
    const groups: { label: string; run: () => void }[][] = [
      [
        {
          label: 'Show All Copper Layers',
          run: () => setVisibleUnsaved([...visible, ...copperLayers]),
        },
        {
          label: 'Hide All Copper Layers',
          run: () => setVisibleUnsaved([...visible].filter((n) => !/\.Cu$/.test(n))),
        },
      ],
      [{ label: 'Hide All Layers But Active', run: () => setVisibleUnsaved([activeLayer]) }],
      [
        {
          label: 'Show All Non Copper Layers',
          run: () => setVisibleUnsaved([...visible, ...nonCopperLayers]),
        },
        {
          label: 'Hide All Non Copper Layers',
          run: () => setVisibleUnsaved([...visible].filter((n) => /\.Cu$/.test(n))),
        },
      ],
      [
        { label: 'Show All Layers', run: () => setVisibleUnsaved(all) },
        { label: 'Hide All Layers', run: () => setVisibleUnsaved([]) },
      ],
      [
        {
          label: 'Show Only Front Assembly Layers',
          run: () => applyNamed('Front Assembly View', 'F.SilkS'),
        },
        { label: 'Show Only Front Layers', run: () => applyNamed('Front Layers', 'F.Cu') },
        ...(copperLayers.length > 2
          ? [
              {
                label: 'Show Only Inner Layers',
                run: () => applyNamed('Inner Copper Layers', copperLayers[1]),
              },
            ]
          : []),
        { label: 'Show Only Back Layers', run: () => applyNamed('Back Layers', 'B.Cu') },
        {
          label: 'Show Only Back Assembly Layers',
          run: () => applyNamed('Back Assembly View', 'B.SilkS'),
        },
      ],
    ];
    return groups;
  };

  // Presets combo (rebuildLayerPresetsWidget): the built-ins alphabetically,
  // then the user's, then --- / Save preset... / Delete preset...
  const onPresetChoice = (value: string): void => {
    if (value === PRESET_SEPARATOR) return;
    if (value === 'Save preset...') {
      // wxTextEntryDialog( _( "Layer preset name:" ), _( "Save Layer Preset" ) ).
      setSaveNameAsk('preset');
      return;
    }
    if (value === 'Delete preset...') {
      setDeleteChooser('presets');
      return;
    }
    applyPreset(value);
  };

  // Viewports combo (rebuildViewportsWidget): saved viewports, then
  // --- / Save viewport... / Delete viewport...
  const onViewportChoice = (value: string): void => {
    if (value === '---') return;
    if (value === 'Save viewport...') {
      // wxTextEntryDialog( _( "Viewport name:" ), _( "Save Viewport" ), name ).
      setSaveNameAsk('viewport');
      return;
    }
    if (value === 'Delete viewport...') {
      setDeleteChooser('viewports');
      return;
    }
    const vp = viewports.find((x) => x.name === value);
    if (!vp) return;
    viewRef.current.tx = vp.view.tx;
    viewRef.current.ty = vp.view.ty;
    viewRef.current.scale = vp.view.scale;
    setViewportSel(value);
    setViewportMRU((m) => touchMRU(m, value));
    requestDraw();
  };

  /** The two saves, once the name dialog answers. */
  const saveNamed = (kind: 'preset' | 'viewport', name: string): void => {
    if (kind === 'preset') {
      setUserPresets((p) => [...p.filter((x) => x.name !== name), { name, layers: [...visible] }]);
      setPresetMRU((m) => touchMRU(m, name));
    } else {
      const v = { ...viewRef.current };
      setViewports((p) => [...p.filter((x) => x.name !== name), { name, view: v }]);
      setViewportSel(name);
      setViewportMRU((m) => touchMRU(m, name));
    }
  };

  // PCB_BASE_EDIT_FRAME::TryBefore (pcb_base_edit_frame.cpp:117-190): Tab
  // with PRESET_SWITCH_KEY (Ctrl) held raises the preset switcher, with
  // VIEWPORT_SWITCH_KEY (Shift) the viewport one, when there is anything to
  // offer. A page is never given Ctrl+Tab by the browser outside fullscreen
  // (common/browser_reserved.ts), so in practice the preset switcher opens
  // only there; Shift+Tab always reaches it.
  // Read by the frame's one keydown chain (below): it raises the switcher when
  // there is a list to offer, and says whether it did.
  const openViewSwitcherRef = useRef<(ctrl: boolean, shift: boolean) => boolean>(() => false);
  openViewSwitcherRef.current = (ctrl, shift) => {
    if (viewSwitcher) return false;
    if (ctrl && presetMRU.length > 0) {
      setViewSwitcher('presets');
      return true;
    }
    if (shift && !ctrl && viewportMRU.length > 0) {
      setViewSwitcher('viewports');
      return true;
    }
    return false;
  };

  // `NET_GRID_TABLE::Rebuild`'s filter and sort, in a module qa can import;
  // see appearance_nets.ts for both decisions and what each one got wrong.
  const nets = useMemo(
    () => (board ? appearanceNetRows(netNamesByCode(frameRef.current?.GetBoard())) : []),
    [board],
  );

  // ----- ratsnest + net classes ----------------------------------------------

  // Net classes from Board Setup, the single source of truth (hydrated from
  // the project's net_settings, updated live when the dialog commits). A blank
  // per-class cell inherits the Default class, which itself falls back to the
  // NETCLASS factory constants (netclass resolution).

  const netclassInfo = useMemo(() => {
    const rows = boardSetup.netClasses.classes;
    const mmVal = (s: string): number | undefined => {
      const v = parseFloat(s);
      return Number.isFinite(v) && v > 0 ? Math.round(v * MM) : undefined;
    };
    const dflt = rows[0];
    const dfltDims: ClassDims = {
      trackWidth: mmVal(dflt?.trackWidth ?? '') ?? DEFAULT_CLASS_DIMS.trackWidth,
      viaDiameter: mmVal(dflt?.viaSize ?? '') ?? DEFAULT_CLASS_DIMS.viaDiameter,
      viaDrill: mmVal(dflt?.viaHole ?? '') ?? DEFAULT_CLASS_DIMS.viaDrill,
    };
    const dfltClearance = mmVal(dflt?.clearance ?? '') ?? 0;
    const classes: string[] = [];
    const classColors = new Map<string, string>();
    const classDims = new Map<string, ClassDims>();
    const classClearance = new Map<string, number>();
    for (const c of rows) {
      if (!c.name || classes.includes(c.name)) continue;
      classes.push(c.name);
      if (c.pcbColor) classColors.set(c.name, c.pcbColor);
      classDims.set(c.name, {
        trackWidth: mmVal(c.trackWidth) ?? dfltDims.trackWidth,
        viaDiameter: mmVal(c.viaSize) ?? dfltDims.viaDiameter,
        viaDrill: mmVal(c.viaHole) ?? dfltDims.viaDrill,
      });
      classClearance.set(c.name, mmVal(c.clearance) ?? dfltClearance);
    }
    if (!classes.includes('Default')) classes.unshift('Default');
    const patterns = boardSetup.netClasses.assignments.filter((a) => a.pattern && a.netClass);
    return { classes, classColors, classDims, classClearance, patterns };
  }, [boardSetup.netClasses]);

  // TOP_AUX pre-defined size lists = BOARD_DESIGN_SETTINGS m_TrackWidthList /
  // m_ViasDimensionsList (Board Setup > Pre-defined Sizes, in stored order;
  // upstream's [0] "use netclass" sentinel is the dropdowns' first option).
  const trackWidthList = useMemo(
    () => boardSetup.trackWidthsMM.filter((w) => w > 0).map((w) => Math.round(w * MM)),
    [boardSetup.trackWidthsMM],
  );
  const viaSizeList = useMemo(
    () =>
      boardSetup.viaSizesMM
        .filter((v) => v.diameter > 0)
        .map((v) => ({ diameter: Math.round(v.diameter * MM), drill: Math.round(v.drill * MM) })),
    [boardSetup.viaSizesMM],
  );
  // A shrunken list drops an out-of-range selection back to "use netclass".
  useEffect(() => {
    if (trackSel > trackWidthList.length) setTrackSel(0);
  }, [trackWidthList, trackSel]);
  useEffect(() => {
    if (viaSel > viaSizeList.length) setViaSel(0);
  }, [viaSizeList, viaSel]);
  // The TOP_AUX choices live in BOARD_DESIGN_SETTINGS upstream: the combos'
  // handlers call `SetTrackWidthIndex` / `SetViaSizeIndex` and AutoTrackWidth
  // flips `m_UseConnectedTrackWidth` (board_editor_control.cpp:1332-1344), and
  // ROUTER_TOOL's `ImportSizes` reads them there.
  useEffect(() => {
    const bds = boardK?.GetDesignSettings();
    if (!bds) return;
    let changed = false;
    if (bds.GetTrackWidthIndex() !== trackSel) {
      bds.SetTrackWidthIndex(trackSel);
      changed = true;
    }
    if (bds.GetViaSizeIndex() !== viaSel) {
      bds.SetViaSizeIndex(viaSel);
      changed = true;
    }
    bds.m_UseConnectedTrackWidth = autoTrackWidth;
    // `PCB_EDIT_FRAME::Tracks_and_Vias_Size_Event` ends with
    // `RunAction( PCB_ACTIONS::trackViaSizeChanged )` (edit_track_width.cpp:224):
    // a route in flight takes the new size at once.
    if (changed) frameRef.current?.GetToolManager()?.RunAction(PCB_ACTIONS.trackViaSizeChanged);
  }, [boardK, trackSel, viaSel, autoTrackWidth]);
  // net code -> net class name, via the project's netclass_patterns.
  const netClassOf = useMemo(() => {
    const m = new Map<number, string>();
    if (board) {
      for (const [code, name] of netNamesByCode(frameRef.current?.GetBoard()))
        m.set(code, netClassFor(name, netclassInfo.patterns));
    }
    return m;
  }, [board, netclassInfo]);
  const classColorOf = useCallback(
    (cls: string): string | undefined => classColors.get(cls) ?? netclassInfo.classColors.get(cls),
    [classColors, netclassInfo],
  );

  // ----- what APPEARANCE_CONTROLS is handed ------------------------------------
  //
  // The widget draws; this frame supplies. Each of these is one of the model
  // structs the C++ builds inside the panel because there it *is* the frame's
  // neighbour: NET_GRID_TABLE's rows, m_netclassSettings, and the two combos.

  /** NET_GRID_TABLE's rows (appearance_controls.h:48-62). */
  /**
   * The per-net colour overrides, by net code.
   *
   * Not state of this frame's own: `PCB_EDIT_FRAME::LoadProjectSettings` fills
   * the painter's map from `NET_SETTINGS::GetNetColorAssignments()`
   * (pcbnew_config.cpp:95-105), which is `net_settings.net_colors` in the
   * .kicad_pro — a NAME to colour map, resolved to net codes through the
   * board's own net list. This was a `useState( new Map() )` that only the
   * colour picker ever wrote, so a board whose project assigns colours opened
   * with every net unspecified, and a colour set here was gone on reload.
   */
  const netColors = useMemo(() => {
    const byCode = new Map<number, string>();
    if (!board) return byCode;
    for (const [code, name] of netNamesByCode(frameRef.current?.GetBoard())) {
      const css = boardSetup.netClasses.netColors[name];
      if (css) byCode.set(code, css);
    }
    return byCode;
  }, [board, boardSetup.netClasses.netColors]);

  /**
   * The editor's Appearance state into the frame, the VIEW and the render
   * settings — what the layer widget, the Objects tab, the toolbar toggles
   * and the net inspector do upstream when the user works them: layer
   * visibility (`BOARD::SetVisibleLayers` + `SyncLayersVisibility`), the
   * display options (`PCB_BASE_FRAME::SetDisplayOptions`), the active layer
   * (`SetHighContrastLayer`), the highlighted nets, the theme
   * (`UpdateColors`) and the grid (`GAL::SetGridSize` / `SetGridVisibility`).
   */
  const lastThemeRef = useRef<unknown>(null);
  const lastPcbCfgRef = useRef<unknown>(null);
  useEffect(() => {
    const panel = panelRef.current;
    const frame = frameRef.current;
    const kb = boardK;
    if (!panelReady || !panel || !frame || !kb) return;
    // A changed preference: the PCBNEW_SETTINGS the painter reads is re-registered,
    // and every item repaints (PCB_EDIT_FRAME::CommonSettingsChanged -> RecacheAllItems)
    if (lastPcbCfgRef.current !== pcbCfg) {
      lastPcbCfgRef.current = pcbCfg;
      installPgm();
      panel.GetView().RecacheAllItems();
    }
    if (lastThemeRef.current !== theme) {
      lastThemeRef.current = theme;
      reloadUserColorSettings();
    }
    const opts = new PCB_DISPLAY_OPTIONS();
    opts.m_ZoneDisplayMode = toggles.has('zoneDisplayOutline')
      ? ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE
      : ZONE_DISPLAY_MODE.SHOW_FILLED;
    opts.m_ContrastModeDisplay =
      contrast === 'hide'
        ? HIGH_CONTRAST_MODE.HIDDEN
        : contrast === 'dim'
          ? HIGH_CONTRAST_MODE.DIMMED
          : HIGH_CONTRAST_MODE.NORMAL;
    opts.m_NetColorMode =
      netColorMode === 'all'
        ? NET_COLOR_MODE.ALL
        : netColorMode === 'off'
          ? NET_COLOR_MODE.OFF
          : NET_COLOR_MODE.RATSNEST;
    opts.m_TrackOpacity = opacity.tracks;
    opts.m_ViaOpacity = opacity.vias;
    opts.m_PadOpacity = opacity.pads;
    opts.m_ZoneOpacity = opacity.zones;
    opts.m_ImageOpacity = opacity.images;
    opts.m_FilledShapeOpacity = opacity.filledShapes;
    opts.m_FlipBoardView = viewRef.current.flipX;
    const visibleLayers = new Set<PCB_LAYER_ID>();
    for (const name of visible) {
      const id = kb.GetLayerID(name);
      if (id >= 0) visibleLayers.add(id);
    }
    const G = GAL_LAYER_ID;
    const visibleElements = new Map<GAL_LAYER_ID, boolean>([
      [G.LAYER_TRACKS, objects.tracks],
      [G.LAYER_VIAS, objects.vias],
      [G.LAYER_PADS, objects.pads],
      [G.LAYER_ZONES, objects.zones],
      [G.LAYER_FILLED_SHAPES, objects.filledShapes],
      [G.LAYER_DRAW_BITMAPS, objects.images],
      [G.LAYER_FOOTPRINTS_FR, objects.footprintsFront],
      [G.LAYER_FOOTPRINTS_BK, objects.footprintsBack],
      [G.LAYER_FP_VALUES, objects.fpValues],
      [G.LAYER_FP_REFERENCES, objects.fpReferences],
      [G.LAYER_FP_TEXT, objects.fpText],
      [G.LAYER_RATSNEST, objects.ratsnest],
      [G.LAYER_DRC_WARNING, objects.drcWarnings],
      [G.LAYER_DRC_ERROR, objects.drcErrors],
      [G.LAYER_DRC_EXCLUSION, objects.drcExclusions],
      [G.LAYER_ANCHOR, objects.anchors],
      [G.LAYER_POINTS, objects.points],
      [G.LAYER_LOCKED_ITEM_SHADOW, objects.lockedShadow],
      [G.LAYER_CONFLICTS_SHADOW, objects.collidingCourtyards],
      [G.LAYER_BOARD_OUTLINE_AREA, objects.boardAreaShadow],
      [G.LAYER_DRAWINGSHEET, objects.drawingSheet],
      [G.LAYER_GRID, objects.grid],
    ]);
    const state: EditorDisplayState = {
      visibleLayers,
      visibleElements,
      displayOptions: opts,
      activeLayer: kb.GetLayerID(activeLayer),
      colorTheme: theme.filename,
    };
    // The net colour assignments the painter's NET_COLOR_MODE reads
    // (`m_netColors`, keyed by netcode as the ratsnest needs).
    const netColorMap = (panel.GetView().GetPainter() as PCB_PAINTER)
      .GetSettings()
      .GetNetColorMap();
    netColorMap.clear();
    for (const [code, css] of netColors) netColorMap.set(code, parseColor4d(css));
    applyDisplayState(frame, panel, kb, state, displayStateRef.current);
    displayStateRef.current = state;
    // The grid: `GAL::SetGridSize` / `SetGridOrigin` / `SetGridVisibility`, and
    // the GAL_DISPLAY_OPTIONS the Preferences' grid page writes.
    const gal = panel.GetGAL();
    gal.SetGridSize({ x: gridIU, y: gridIU });
    gal.SetGridOrigin(gridOriginRef.current);
    gal.SetGridVisibility(objects.grid && toggles.has('toggleGrid'));
    // EDA_DRAW_FRAME::LoadSettings: m_galDisplayOptions.ReadWindowSettings( m_Window ).
    frame.GetGalDisplayOptions().ReadWindowSettings(windowSettingsOf(galRef.current));
    requestDraw();
  }, [
    panelReady,
    boardK,
    visible,
    objects,
    opacity,
    toggles,
    contrast,
    netColorMode,
    netColors,
    activeLayer,
    theme,
    pcbCfg,
    gridIU,
    requestDraw,
  ]);

  /**
   * The picker's write, straight back into the project slice it came from.
   *
   * `#rrggbb`, because that is the form every colour in a BoardSetupValues
   * takes — `kicadColorToCss` normalises the file's `rgb(...)` into it and
   * `cssColorToKicad` only accepts it back (project_settings.ts:196-209). An
   * `rgb(...)` string handed in here would be written out as the UNSET
   * sentinel, i.e. silently dropped.
   *
   * COLOR4D::UNSPECIFIED (alpha 0) clears the assignment rather than storing a
   * transparent black, which is what upstream's `if( color != UNSPECIFIED )`
   * does on the way in (pcbnew_config.cpp:99).
   */
  const setNetColor = useCallback(
    (code: number, picked: Color4d): void => {
      const name = board?.nets.get(code);
      if (!name) return;
      const next = { ...(boardSetupRef.current.netClasses.netColors ?? {}) };
      if (picked.a > 0) {
        const ch = (v: number): string =>
          Math.round(Math.min(1, Math.max(0, v)) * 255)
            .toString(16)
            .padStart(2, '0');
        next[name] = `#${ch(picked.r)}${ch(picked.g)}${ch(picked.b)}`;
      } else {
        delete next[name];
      }
      commitBoardSetup({
        ...boardSetupRef.current,
        netClasses: { ...boardSetupRef.current.netClasses, netColors: next },
      });
    },
    [board, commitBoardSetup],
  );

  const netRows = useMemo(
    () =>
      nets.map(([code, name]) => ({
        code,
        name,
        color: netColors.get(code),
        visible: !hiddenNets.has(code),
      })),
    [nets, netColors, hiddenNets],
  );

  /** m_netclassSettings, in Board Setup order. */
  const netclassRows = useMemo(
    () =>
      netclassInfo.classes.map((name) => ({
        name,
        color: classColorOf(name),
        visible: !hiddenClasses.has(name),
      })),
    [netclassInfo, classColorOf, hiddenClasses],
  );

  const presetItems = useMemo(
    () => presetComboItems(userPresets.map((u) => u.name)),
    [userPresets],
  );
  const viewportItems = useMemo(
    () => viewportComboItems(viewports.map((v) => v.name)),
    [viewports],
  );

  // Nets of the current selection, their airwires are always shown (even when
  // the global ratsnest is off), so clicking a pad/footprint/track reveals the
  // thin airwires to what it connects to (PCB_SELECTION_TOOL local ratsnest).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `board` is the trigger; the BOARD is read through frameRef
  const selectedNets = useMemo(() => {
    const nets = new Set<number>();
    for (const item of selection) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        for (const p of (item as unknown as FOOTPRINT).Pads())
          if (p.GetNetCode() > 0) nets.add(p.GetNetCode());
      } else if (item.IsConnected()) {
        const code = (item as unknown as BOARD_CONNECTED_ITEM).GetNetCode();
        if (code > 0) nets.add(code);
      }
    }
    return nets;
  }, [selection, board]);
  const selectedNetsRef = useRef<ReadonlySet<number>>(selectedNets);
  selectedNetsRef.current = selectedNets;

  // "Toggle Net Highlight" is greyed unless a net is designated for highlight
  // (KiCad's enableNetHighlightCond = IsNetHighlightSet). We enable it whenever
  // the selection carries a net (so a click highlights that net) or a highlight
  // is already active (so a click can toggle it off).
  const leftDisabled = useMemo(() => {
    const s = new Set<string>();
    if (selectedNets.size === 0 && highlightNets.size === 0) s.add('toggleNetHighlight');
    // The Show Grid button's right-click menu carries `ACTIONS::gridOrigin`
    // under `ACTIONS::gridProperties` (`pcbnew/toolbars_pcb_editor.cpp:150-161`).
    // `COMMON_TOOLS::GridOrigin` is a WX_PT_ENTRY_DIALOG that writes
    // `SetGridOrigin` (`common/tool/common_tools.cpp:637-651`), and we do not
    // have it: the Place menu's own Grid Origin row is greyed for the same
    // reason. Shown in its upstream position rather than dropped, which is what
    // the rest of this frame does with an entry it cannot run yet.
    s.add('gridOrigin');
    return s;
  }, [selectedNets, highlightNets]);

  // A net highlight is the VIEW's (PCB_RENDER_SETTINGS::GetColor brightens the
  // highlighted nets and darkens the rest); the canvas only repaints.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `highlightNets` is the trigger
  useEffect(() => {
    requestDraw();
  }, [highlightNets, requestDraw]);

  // Which airwires are shown, and in what colour, is the VIEW's answer now:
  // `RATSNEST_VIEW_ITEM::ViewDraw` walks CONNECTIVITY_DATA's RN_NETs and reads
  // the hidden nets, the ratsnest mode and the net colours off
  // PCB_RENDER_SETTINGS itself. What stood here was a second copy of that rule
  // over a list of airwires the raster path had built, and only the raster
  // path drew it.

  // Net colours in mode "All" are the VIEW's: `PCB_RENDER_SETTINGS::GetColor`
  // takes them from NET_SETTINGS when `NET_COLOR_MODE::ALL` is set
  // (`applyEditorDisplayState`). The overlay scenes that used to tint the
  // raster copy went with the raster path.

  // ----- the docked Search and Net Inspector panes, and Edit Vertices ---------

  // `cfg->m_AuiPanels.search_panel_height` (`pcb_edit_frame.cpp:1768`), written
  // once a drag has settled rather than on every mouse move.
  const [dockHeight, setDockHeight] = useState(pcbCfg.aui.search_panel_height);
  const storedDockHeight = pcbCfg.aui.search_panel_height;
  useEffect(() => {
    if (dockHeight === storedDockHeight) return;

    const t = window.setTimeout(
      () =>
        updatePcbnewSettings((c) => {
          c.aui.search_panel_height = dockHeight;
        }),
      300,
    );

    return () => window.clearTimeout(t);
  }, [dockHeight, storedDockHeight, updatePcbnewSettings]);

  /** `PCB_EDIT_FRAME` as the search handlers read it (`PcbSearchFrame`, minus `config`). */
  const searchFrame = useMemo(
    () => ({
      GetBoard: () => frameRef.current?.GetBoard() ?? null,
      IsClosing: () => frameRef.current?.IsClosing() ?? false,
      MessageTextFromValue: (
        v: number,
        addUnits?: boolean,
        type?: Parameters<UNITS_PROVIDER['MessageTextFromValue']>[2],
      ) => frameRef.current!.GetUnitsProvider().MessageTextFromValue(v, addUnits, type),
      GetOriginTransforms: () => frameRef.current!.GetOriginTransforms(),
    }),
    [],
  );

  const searchActions = useRef({
    boardSetup: (_page: string) => {},
  });
  // What the hitlist rows do: the tool manager's actions, as upstream.
  const searchWiring = useMemo<PcbSearchWiring>(
    () =>
      makePcbSearchWiring(() => frameRef.current, {
        highlightNets: (codes) => applyRenderHighlightRef.current(codes),
        showBoardSetupDialog: (page) => searchActions.current.boardSetup(page),
      }),
    [],
  );
  searchActions.current = {
    // `ShowBoardSetupDialog( _( "Net Classes" ) )`.
    boardSetup: (page) => {
      setBoardSetupPage(page === 'Net Classes' ? 'netclasses' : undefined);
      setBoardSetupOpen(true);
    },
  };

  // `PCB_BASE_EDIT_FRAME::m_vertexEditorPane`: the floating Edit Vertices pane.
  const [vertexPane, setVertexPane] = useState<PCB_VERTEX_EDITOR_PANE | null>(null);
  const vertexPaneRef = useRef<PCB_VERTEX_EDITOR_PANE | null>(null);
  vertexPaneRef.current = vertexPane;

  /** `PCB_BASE_EDIT_FRAME::OpenVertexEditor` (`pcb_base_edit_frame.cpp:439-462`). */
  const openVertexEditor = (): void => {
    const frame = frameRef.current;
    if (!frame || selection.size !== 1) return;

    const item = [...selection][0]!;
    if (!itemHasEditableCorners(item)) return;

    let pane = vertexPaneRef.current;
    if (!pane) {
      pane = new PCB_VERTEX_EDITOR_PANE(
        makeVertexEditorFrame(
          frame,
          () => requestDrawRef.current(),
          (closed) => {
            frame.OnVertexEditorPaneClosed(closed);
            if (vertexPaneRef.current === closed) setVertexPane(null);
          },
        ),
      );
      // `m_vertexEditorPane`: PCB_CONTROL::UpdateMessagePanel's tail keeps it
      // on the selected item (UpdateVertexEditorSelection).
      frame.m_vertexEditorPane = pane;
      setVertexPane(pane);
    }
    pane.SetItem(item);
  };

  // ----- toolbar handlers -----------------------------------------------------

  const onLeftToggle = (id: string): void => {
    // The Show Grid button's right-click menu, not a button
    // (`pcbnew/toolbars_pcb_editor.cpp:149-161`): upstream runs its rows
    // through the same TOOL_MANAGER the button goes through, so they arrive
    // here. `COMMON_TOOLS::GridProperties` for FRAME_PCB_EDITOR is
    // `ShowPreferences( _( "Grids" ), _( "PCB Editor" ) )`
    // (`common/tool/common_tools.cpp:625`); that page is not in our book yet,
    // so the dialog opens without naming one.
    if (id === 'gridProperties') {
      setPrefsOpen(true);
      return;
    }
    // PCB_ACTIONS::lineModeFree / 45 / 90: BOARD_EDITOR_CONTROL::ChangeLineMode,
    // whose OnAngleSnapModeChanged selects the group's button back.
    const lineModeAction = PCB_LINE_MODE_ACTIONS[id];
    if (lineModeAction) {
      runAction(lineModeAction);
      return;
    }
    // ACTIONS::millimetersUnits / inchesUnits / milsUnits: COMMON_TOOLS::SwitchUnits.
    const checkedAction = PCB_CHECKED_ACTIONS[id];
    if (checkedAction) {
      runAction(checkedAction);
      return;
    }
    // Toggle Net Highlight: show/hide the last-highlighted net set.
    if (id === 'toggleNetHighlight') {
      runAction(PCB_ACTIONS.toggleNetHighlight);
      return;
    }
    // The three crosshair shapes and Show Grid are stored settings, so the
    // button and Preferences are one value: `foldPcbToggle` writes the file and
    // the subscription above brings it back as a re-render.
    if (isStoredPcbToggle(id)) updatePcbnewSettings((c) => void foldPcbToggle(c, id));
    setToggles((prev) => applyToggle(prev, id));
  };

  const saveCopy = useCallback((): void => {
    // Serialize the (possibly edited) board; fall back to the original text if
    // it never parsed. serializeBoard is lossless for unedited boards.
    const out = boardRef.current ? serializeBoard(boardRef.current) : text;
    const blob = new Blob([out], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [text, fileName]);

  /**
   * `PCB_EDIT_FRAME::SaveProjectLocalSettings` (`SavePcbFile` calls it once the
   * board is written, files.cpp:1125): this window's Appearance state into the
   * frame, the frame's into PROJECT_LOCAL_SETTINGS, and the two files
   * `SETTINGS_MANAGER::SaveProject()` returns out to the project's file store.
   */
  const saveProjectLocalSettings = (): void => {
    const frame = frameRef.current;
    const savePanel = panelRef.current;
    if (!frame || !savePanel || !frame.GetBoard()) return;
    const hidden = (savePanel.GetView().GetPainter() as PCB_PAINTER).GetSettings().GetHiddenNets();
    hidden.clear();
    for (const code of hiddenNets) hidden.add(code);
    const filter = frame.GetSelectionFilter() as unknown as Record<string, unknown>;
    for (const key of Object.keys(filter))
      if (typeof filter[key] === 'boolean') filter[key] = selFilter.has(key);
    const saved = frame.SaveProjectLocalSettings();
    if (!saved) return;
    const files = projectFilesNow();
    const pro = findProjectPro(files, rootPro);
    if (!pro) return;
    const baseOf = (name: string): string =>
      (projectFiles ?? []).find((f) => f.name === name)?.text ?? '';
    const persist: { name: string; text: string }[] = [];
    const proText = DumpJson(saved.pro);
    if (proText !== pro.text) persist.push({ name: pro.name, text: proText });
    const prlName = pro.name.replace(/\.kicad_pro$/i, '.kicad_prl');
    const prlText = DumpJson(saved.prl);
    if (prlText !== files.find((f) => f.name === prlName)?.text)
      persist.push({ name: prlName, text: prlText });
    if (persist.length === 0) return;
    for (const f of persist)
      projectFileEditsRef.current.set(f.name, { base: baseOf(f.name), text: f.text });
    onPersistFiles?.(persist);
  };

  const onTopAction = (id: string): void => {
    switch (id) {
      case 'save':
        // Save writes into the project's file manager (cloud storage); users
        // download from there. "Save a Copy…" keeps the local download.
        if (onSaveBoard) onSaveBoard(boardRef.current ? serializeBoard(boardRef.current) : text);
        else saveCopy();
        setDirty(false);
        saveProjectLocalSettings();
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'rotateCCW':
        runAction(PCB_ACTIONS.rotateCcw);
        break;
      case 'rotateCW':
        runAction(PCB_ACTIONS.rotateCw);
        break;
      /**
       * `BOARD_EDITOR_CONTROL::AutoTrackWidth` (board_editor_control.cpp:1332-1344):
       *
       *     if( bds.UseCustomTrackViaSize() )
       *     {
       *         bds.UseCustomTrackViaSize( false );
       *         bds.m_UseConnectedTrackWidth = true;
       *     }
       *     else
       *     {
       *         bds.m_UseConnectedTrackWidth = !bds.m_UseConnectedTrackWidth;
       *     }
       *
       * The first branch is not a flourish: a custom track/via size and
       * inheriting an existing one are mutually exclusive, so turning this on
       * while a custom size is in force clears that size rather than toggling.
       * Our equivalent of `UseCustomTrackViaSize()` is a non-zero selection in
       * the track-width combo, which is what `GetCurrentTrackWidth` reads.
       */
      case 'autoTrackWidth':
        if (trackSelRef.current !== 0) {
          setTrackSel(0);
          setAutoTrackWidth(true);
        } else {
          setAutoTrackWidth((v) => !v);
        }
        break;
      case 'pageSettings':
        runAction(ACTIONS.pageSettings);
        break;
      case 'runDRC':
        // PCB_ACTIONS::runDRC -> DRC_TOOL::ShowDRCDialog
        frameRef.current?.GetToolManager()?.RunAction(PCB_ACTIONS.runDRC);
        break;
      case 'boardSetup':
        setBoardSetupPage(undefined);
        setBoardSetupOpen(true);
        break;
      case 'print':
        runAction(ACTIONS.print);
        break;
      case 'plot':
        setPlotDlgOpen(true);
        break;
      case 'mirrorV':
        runAction(PCB_ACTIONS.mirrorV);
        break;
      case 'mirrorH':
        runAction(PCB_ACTIONS.mirrorH);
        break;
      case 'group':
        runAction(ACTIONS.group);
        break;
      case 'ungroup':
        runAction(ACTIONS.ungroup);
        break;
      case 'addToGroup':
        runAction(ACTIONS.addToGroup);
        break;
      case 'removeFromGroup':
        runAction(ACTIONS.removeFromGroup);
        break;
      case 'lock':
        runAction(PCB_ACTIONS.lock);
        break;
      case 'unlock':
        runAction(PCB_ACTIONS.unlock);
        break;
      case 'toggleLock':
        runAction(PCB_ACTIONS.toggleLock);
        break;
      case 'find':
        runAction(ACTIONS.find);
        break;
      case 'zoomRedraw':
        requestDraw();
        break;
      case 'zoomIn':
        zoomStep(1.3);
        break;
      case 'zoomOut':
        zoomStep(1 / 1.3);
        break;
      case 'zoomFit':
        zoomToFit();
        break;
      case 'zoomFitObjects':
        zoomFitObjects();
        break;
      case 'zoomTool':
        // ACTIONS::zoomTool: drag a rectangle to zoom into it; reverts to the
        // selection tool after one use (handled on pointer-up).
        setActiveTool('zoomTool');
        break;
      case 'footprintEditor':
        onShowFootprintEditor?.();
        break;
      case 'showEeschema':
        onShowSchematic?.();
        break;
      case 'updatePcbFromSch':
        void openUpdatePcb();
        break;
      case 'threeDViewer':
        runAction(ACTIONS.show3DViewer);
        break;

      /*
       * The rows `editors/pcb/menubar.ts` routes here. Every one of these ran
       * from a closure written inline in the menu before the bar moved out of
       * this file; they are cases now because the module names commands rather
       * than holding functions — which is what makes it a `.ts` `qa` can read.
       *
       * The ids are `TOOL_ACTION` names where upstream has one.
       */
      // `undo`, `redo`, `find` and `zoomRedraw` are NOT repeated below: the
      // toolbar already routed those four ids through this switch, and the menu
      // module names them the same way.
      case 'saveCopy':
        saveCopy();
        break;
      case 'cut':
        runAction(ACTIONS.cut);
        break;
      case 'copy':
        runAction(ACTIONS.copy);
        break;
      // PCB_CONTROL::Paste, after the system clipboard's text has been read
      // into the clipboard (a menu row is outside any paste event).
      case 'paste':
        pasteFromSystemClipboard(ACTIONS.paste);
        break;
      case 'pasteSpecial':
        pasteFromSystemClipboard(ACTIONS.pasteSpecial);
        break;
      case 'doDelete':
        runAction(ACTIONS.doDelete);
        break;
      case 'selectAll':
        selectAllSel();
        break;
      case 'unselectAll':
        unselectAllSel();
        break;
      case 'editTeardrops':
        runAction(PCB_ACTIONS.editTeardrops);
        break;
      case 'importGraphics':
        runAction(PCB_ACTIONS.placeImportedGraphics);
        break;
      // `PCB_ACTIONS::exportSpecctraDSN` -> `PCB_EDIT_FRAME::ExportSpecctraFile`.
      case 'exportSpecctraDSN': {
        const frame = frameRef.current;

        if (!frame) break;

        const dsnName = `${fileName.replace(/\.kicad_pcb$/, '')}.dsn`;

        void import('./specctra_import_export/specctra_export.js').then(
          ({ ExportSpecctraFile }) => {
            const r = ExportSpecctraFile(frame, dsnName);

            if (r.ok && r.text !== undefined) saveReportFile(r.text, dsnName);
            else setInfoBarError(`Unable to export, please fix and try again: ${r.error ?? ''}`);
          },
        );
        break;
      }
      // `PCB_ACTIONS::openNonKicadBoard` -> `BOARD_EDITOR_CONTROL::OpenNonKicadBoard`:
      // `AskLoadBoardFileName( KICTL_NONKICAD_ONLY )`'s type combo is "All supported
      // formats" then every importer's board file description (files.cpp:117-171).
      case 'openNonKicadBoard':
        void import('./pcb_io/pcb_io_mgr.js').then(async ({ PCB_IO_MGR }) => {
          const descs = await PCB_IO_MGR.BoardFileDescriptions(KICTL_NONKICAD_ONLY);
          const filters = descs.map((d) => d.Chooser());
          setNonKicadFilters([
            {
              label: 'All supported formats',
              extensions: [...new Set(filters.flatMap((f) => f.extensions))],
            },
            ...filters,
          ]);
        });
        break;
      // `PCB_ACTIONS::importSpecctraSession` -> `PCB_EDIT_FRAME::ImportSpecctraSession`.
      case 'importSpecctraSession': {
        const frame = frameRef.current;

        if (!frame) break;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ses';
        input.onchange = (): void => {
          const file = input.files?.[0];

          if (!file) return;

          void file.text().then(async (text) => {
            const { ImportSpecctraSessionIntoFrame } = await import(
              './specctra_import_export/specctra_import.js'
            );
            const r = ImportSpecctraSessionIntoFrame(frame, text, file.name);
            const kb = frame.GetBoard();

            // Re-derive the view: the session replaced the tracks and moved footprints.
            if (kb)
              setBoardModel({
                ...boardFromBOARD(kb, fileNameRef.current),
                fileName: fileNameRef.current,
              });

            if (r.ok) setDirty(true);
            else setInfoBarError(r.error ?? 'Session import failed');
          });
        };
        input.click();
        break;
      }
      // `PCB_ACTIONS::autoplaceSelectedComponents` / `autoplaceOffboardComponents` ->
      // `AUTOPLACE_TOOL`: Place > Auto-Place Footprints.
      case 'autoplaceSelected':
        runAction(PCB_ACTIONS.autoplaceSelectedComponents);
        break;
      case 'autoplaceOffboard':
        runAction(PCB_ACTIONS.autoplaceOffboardComponents);
        break;
      case 'zoneFillAll':
        fillAllZones();
        break;
      case 'zoneUnfillAll':
        runAction(PCB_ACTIONS.zoneUnfillAll);
        break;
      // `PCB_ACTIONS::zonesManager` -> `GLOBAL_EDIT_TOOL::ZonesManager`.
      case 'zonesManager':
        runAction(PCB_ACTIONS.zonesManager);
        break;
      // `PCB_ACTIONS::swapLayers` -> `GLOBAL_EDIT_TOOL::SwapLayers`.
      case 'swapLayers':
        runAction(PCB_ACTIONS.swapLayers);
        break;
      case 'cleanupTracksAndVias':
        runAction(PCB_ACTIONS.cleanupTracksAndVias);
        break;
      case 'cleanupGraphics':
        runAction(PCB_ACTIONS.cleanupGraphics);
        break;
      case 'removeUnusedPads':
        runAction(PCB_ACTIONS.removeUnusedPads);
        break;
      case 'globalDeletions':
        runAction(PCB_ACTIONS.globalDeletions);
        break;
      case 'editTracksAndVias':
        runAction(PCB_ACTIONS.editTracksAndVias);
        break;
      case 'editTextAndGraphics':
        runAction(PCB_ACTIONS.editTextAndGraphics);
        break;
      case 'changeFootprints':
        runAction(PCB_ACTIONS.changeFootprints);
        break;
      case 'updateFootprints':
        runAction(PCB_ACTIONS.updateFootprints);
        break;
      case 'polygonmerge':
        runAction(PCB_ACTIONS.mergePolygons);
        break;
      case 'polygonsubtract':
        runAction(PCB_ACTIONS.subtractPolygons);
        break;
      case 'polygonintersect':
        runAction(PCB_ACTIONS.intersectPolygons);
        break;
      case 'linefillet':
        runAction(PCB_ACTIONS.filletLines);
        break;
      case 'linechamfer':
        runAction(PCB_ACTIONS.chamferLines);
        break;
      case 'linedogbone':
        runAction(PCB_ACTIONS.dogboneCorners);
        break;
      case 'lineextend':
        runAction(PCB_ACTIONS.extendLines);
        break;
      case 'filterSelection':
        frameRef.current?.GetToolManager()?.RunAction(PCB_ACTIONS.filterSelection);
        break;
      case 'boardStatistics':
        setStatsOpen(true);
        break;
      case 'generateD356File':
        // BOARD_EDITOR_CONTROL::GenD356File.
        runAction(PCB_ACTIONS.generateD356File);
        break;
      case 'generateBOM': {
        // `GenBOMFileFromBoard` opens a save dialog first and bails on an empty
        // board with an info-bar error; ours reports the same refusal.
        const kb = frameRef.current?.GetBoard();

        if (!kb || kb.Footprints().length === 0) {
          setInfoBarError('Cannot export BOM: there are no footprints on the PCB.');
          break;
        }

        saveReportFile(BuildBomTextFromBoard(kb), `${fileName.replace(/\.kicad_pcb$/, '')}.csv`);
        break;
      }
      case 'zoomInCenter':
        zoomStep(1.3);
        break;
      case 'zoomOutCenter':
        zoomStep(1 / 1.3);
        break;
      case 'zoomFitScreen':
        zoomToFit();
        break;
      // `ACTIONS::highContrastMode` is PCB_CONTROL::HighContrastMode, which
      // toggles NORMAL <-> DIMMED (pcb_control.cpp:371-380); only the H key's
      // highContrastModeCycle visits HIDDEN.
      case 'highContrastMode':
        runAction(ACTIONS.highContrastMode);
        break;
      case 'flipBoard':
        toggleFlip();
        break;
      case 'drillResetOrigin':
        runAction(PCB_ACTIONS.drillResetOrigin);
        break;
      case 'gridResetOrigin':
        runAction(ACTIONS.gridResetOrigin);
        break;
      case 'routerSettingsDialog':
        // `PCB_ACTIONS::routerSettingsDialog` -> `ROUTER_TOOL::SettingsDialog`.
        runAction(PCB_ACTIONS.routerSettingsDialog);
        break;
      case 'selectLayerPair':
        // `PCB_ACTIONS::selectLayerPair` -> `ROUTER_TOOL::SelectCopperLayerPair`.
        frameRef.current?.SelectCopperLayerPair();
        break;
      // BOARD_INSPECTION_TOOL's: the reports fill the frame's book reporters.
      case 'inspectClearance':
        runAction(PCB_ACTIONS.inspectClearance);
        break;
      case 'inspectConstraints':
        runAction(PCB_ACTIONS.inspectConstraints);
        break;
      case 'showFootprintAssociations':
        runAction(PCB_ACTIONS.showFootprintAssociations);
        break;
      case 'importNetlist':
        setImportNetlistName(lastNetlistPathRef.current);
        break;
      case 'updatePcbFromSchematic':
        void openUpdatePcb();
        break;
      // `PCB_ACTIONS::editVertices` -> `EDIT_TOOL::EditVertices`
      // (`edit_tool.cpp:2195-2224`): one polygon or zone opens the pane, anything
      // else is `wxBell()`.
      case 'editVertices':
        runAction(PCB_ACTIONS.editVertices);
        break;
      case 'showFootprintEditor':
        onShowFootprintEditor?.();
        break;
      // `ACTIONS::showFootprintBrowser` -> `COMMON_CONTROL::ShowPlayer`:
      // `Kiway().Player( FRAME_FOOTPRINT_VIEWER, true )`, then raise it.
      case 'footprintBrowser':
        kiway?.Player(FRAME_T.FRAME_FOOTPRINT_VIEWER);
        break;
      case 'showProjectManager':
      case 'close':
        closeFrame();
        break;
      case 'openPreferences':
        setPrefsOpen(true);
        break;

      default:
        break; // other editing actions are staged
    }
  };

  /**
   * `PCB_BASE_FRAME::canCloseWindow` (`pcbnew/pcb_base_frame.cpp:112-127`),
   * whose one piece of housekeeping is
   *
   *     PROJECT_PCB::Cleanup3DCache( &Prj() );
   *
   * so leaving the board editor is what ages the 3D model cache — not opening
   * one, which is the moment a scan of the whole store would be felt. The
   * interval comes from `COMMON_SETTINGS` upstream and from the same slice
   * here; `cleanup3dCache` holds the "0 means never" guard.
   *
   * Not awaited, and it must not be: upstream returns `true` and the frame
   * closes whether or not a file was removable, and a sweep is never the reason
   * a view does not change.
   */
  const closeFrame = (): void => {
    void cleanup3dCache(commonCfg.system.clear_3d_cache_interval);
    onExit();
  };

  /**
   * `ZONE_PREVIEW_NOTEBOOK_PAGE`'s `new ZONE_PREVIEW_CANVAS( board, zone, layer,
   * page, frame->GetGalDisplayOptions(), frame->GetCanvas()->GetBackend() )`: a
   * WebGL panel on the page's element.
   */
  const createZonePreviewCanvas: ZonePreviewCanvasFactory = (aBoard, aZone, aLayer, aPage) => {
    const frame = frameRef.current!;
    const el = document.createElement('canvas');
    aPage.appendChild(el);
    const canvas = new ZONE_PREVIEW_CANVAS(
      aBoard,
      aZone,
      aLayer,
      null,
      drawPanelWindow(el, fontImage!),
      frame.GetGalDisplayOptions(),
      frame.GetCanvas()?.GetBackend() ?? GAL_TYPE.GAL_TYPE_OPENGL,
    );
    // `Bind( wxEVT_SIZE, [this]( wxSizeEvent& ) { if( !m_zoomLocked ) ZoomFitScreen(); } )`
    canvas.Connect(wxEVT_SIZE, () => canvas.OnResize());
    return canvas;
  };

  // ----- menus (menubar_pcb_editor.cpp structure, working subset active) ------

  /**
   * `PCB_EDIT_FRAME::doReCreateMenuBar`, which lives in
   * `editors/pcb/menubar.ts` — a `.ts`, so `qa` can build the tree and press
   * its rows rather than reading this file with a regex.
   *
   * The frame keeps the closures; the module keeps the shape. Everything a row
   * needs to know about the board arrives as `PcbMenuState`, which is counts
   * and flags rather than the selection itself.
   */
  const menus: Menu[] = buildPcbMenus(
    {
      action: onTopAction,
      tool: setActiveTool,
      toggle: onLeftToggle,
      language: commonCfg.system.language,
      onSelectLanguage: (label: string) =>
        updateCommonSettings((c) => {
          c.system.language = label;
        }),
      showHotkeys: showHotkeyList,
      showAbout: () => setAboutOpen(true),
    },
    {
      hasSchematic: !!onShowSchematic,
      hasFootprintEditor: !!onShowFootprintEditor,
      highContrast: contrast !== 'normal',
      flipBoard: flipView,
    },
    {
      showProperties: leftToggles.has('showProperties'),
      showLayersManager: leftToggles.has('showLayersManager'),
      showSearch: leftToggles.has('showSearch'),
      showNetInspector: leftToggles.has('showNetInspector'),
      zoneDisplayFilled: leftToggles.has('zoneDisplayFilled'),
      zoneDisplayOutline: leftToggles.has('zoneDisplayOutline'),
      padDisplayMode: leftToggles.has('padDisplayMode'),
      viaDisplayMode: leftToggles.has('viaDisplayMode'),
      trackDisplayMode: leftToggles.has('trackDisplayMode'),
      graphicsOutlines: leftToggles.has('graphicsOutlines'),
      textOutlines: leftToggles.has('textOutlines'),
    },
  );

  menusRef.current = menus;

  // ----- unit display ---------------------------------------------------------

  // MessageTextFromValue at the pcbnew IU scale (PCB_IU_PER_MM), which is the
  // long form: mm %.4f, mils %.2f, inches %.4f.
  unitsRef.current = unitLabel;
  const fmtCoord = (iu: number): string =>
    messageTextFromValue(iuToMM(iu), unitLabel, PCB_IU_PER_MM);

  const gridText = gridMsg(fmtCoord(gridIU));
  // TOP_AUX combo formatting (PCB_EDIT_FRAME::ComboBoxUnits): mm at %.3f,
  // mils at %.2f.
  const auxMM = (iu: number): string => iuToMM(iu).toFixed(3);
  const auxMils = (iu: number): string => ((iuToMM(iu) / 25.4) * 1000).toFixed(2);
  // Zoom selector value (EDA_DRAW_FRAME::OnUpdateSelectZoom): the preset the
  // zoom IS, else the live zoom as a custom entry. Upstream compares with `==`
  // and `isZoomSelectPreset` is that comparison, widened only by the float
  // round-trip our scale storage forces - see its doc. It was a 1% snap, which
  // reported a hand-dragged 2.21 as the 2.20 preset where KiCad shows 2.21.
  const zoomNow = zoomFactorForScale(scale, window.devicePixelRatio || 1);
  const zoomPreset = ZOOM_LIST.pcbnew.find((z) => isZoomSelectPreset(z, zoomNow));
  const zoomCustom = scale > 0 && zoomPreset === undefined ? Number(zoomNow.toFixed(2)) : null;
  const zoomSelValue: string | number = zoomPreset ?? zoomCustom ?? 'auto';
  // Field 6 (EDA_DRAW_FRAME::DisplayToolMsg, the "Current Tool" panel): the
  // friendly name of the active right-toolbar tool, blank in the selection tool.
  const toolMsg = PCB_TOOL_MSGS[activeTool] ?? '';
  // Field 7 (DisplayConstraintsMsg). ROUTER_TOOL writes nothing there
  // (router_tool.cpp never calls DisplayConstraintsMsg); the hint this showed
  // while routing was the window's own. DRAWING_TOOL::UpdateStatusBar's
  // `SetStatusText( msg, 7 )` does not reach this field yet.
  const constraintMsg = '';
  /**
   * The frame's message panel (`EDA_DRAW_FRAME::m_messagePanel`), which
   * `PCB_CONTROL::UpdateMessagePanel` (pcb_control.cpp:2378-2884) fills on
   * every selection and connectivity change, and `OnBoardLoaded` with the
   * board's own info.
   */
  const messagePanelItems: MsgPanelItem[] = frameMsgItems.map((i) => ({
    upper: i.GetUpperText(),
    lower: i.GetLowerText(),
  }));

  // Top-toolbar enablement. Save follows the dirty flag; the toolbar's Group /
  // Ungroup grey out per GROUP_TOOL::update, Group needs >= 2 selected items,
  // Ungroup needs a selected group. (Add / Remove to Group are right-click-only
  // in KiCad; they live in the grouping context menu, not the toolbar.)
  /**
   * `PCB_EDIT_FRAME::setupUIConditions` (`pcb_edit_frame.cpp:1036-1058`), the
   * four the top toolbar reads.
   *
   * Save is not one of them upstream — pcbnew declares
   * `ENABLE( SELECTION_CONDITIONS::ShowAlways )` — and it is not one of them
   * here either: it is added afterwards by `withSaveEnablement`, the one place
   * this app's autosave divergence from that is written down, so the Schematic
   * and PCB editors cannot drift apart on it again.
   */
  /**
   * `PCB_EDIT_FRAME::UpdateTitle` (pcb_edit_frame.cpp:2168-2194), built by the
   * shared rule rather than restated here — see `frame_title.ts`.
   */
  const pcbTitle = useMemo(
    () => pcbFrameTitle({ fileName, modified: dirty, readOnly }),
    [fileName, dirty, readOnly],
  );

  // ACTIONS::group / ungroup, PCB_ACTIONS::lock / unlock: their ENABLE
  // conditions, asked of the frame as wx asks before drawing a control.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection is the trigger; the frame holds the state
  const topDisabled = useMemo(
    () => (frameRef.current ? pcbDisabledSet(frameRef.current) : new Set<string>()),
    [selection],
  );

  return (
    <div className="ze-app">
      <MenuBar
        menus={menus}
        leftSlot={<HomeLink onClick={closeFrame} />}
        title={
          <>
            <b>
              {pcbTitle.modified}
              {pcbTitle.document}
            </b>
            {pcbTitle.separator}
            {pcbTitle.frameName}
          </>
        }
      />
      <Toolbar
        entries={pcbTopBar}
        orientation="horizontal"
        disabledIds={withSaveEnablement(topDisabled, dirty)}
        onActivate={onTopAction}
        controls={{
          /**
           * `UpdateVariantSelectionCtrl` (`toolbars_pcb_editor.cpp:503`) fills
           * this from `BOARD::GetVariantNamesForUI()`, which is
           * `GetDefaultVariantName()` plus the board's own variant names,
           * sorted with the default pinned first (`board.cpp`, `string_utils.cpp:1864`).
           * `< Default >` is that name, spelled exactly (`string_utils.cpp:57`).
           *
           * Our board model carries no variant names, so the list is the
           * default alone — which is also what a stock KiCad board shows, and
           * what a live pcbnew on the ecc83 demo shows. Design variants are
           * not ported, so the control does not pretend to switch anything.
           */
          /* A wxChoice like the five on the bar below, so it takes the same
             GTK metrics — the border, the radius, the chevron and the face.
             As a bare `<select>` it was drawing the browser's widget: no
             border at all, a heavier chevron and a lighter fill.

             Only `< Default >`, because design variants are not modelled here
             yet; that is a missing *list*, not a missing control, so the
             control is present and shows the one variant every board has. */
          [PCB_CONTROL.currentVariant]: (
            <Combo
              title="Select the current variant to display and edit."
              value="default"
              options={[{ value: 'default', label: '< Default >' }]}
              onChange={() => {}}
            />
          ),
        }}
      />

      {/* TOP_AUX toolbar (toolbars_pcb_editor.cpp:365-386). A real
          ACTION_TOOLBAR upstream, docked at .Top().Layer(5) — not a strip of
          loose widgets, which is what this was: a bare flex div writing its own
          gap, padding, face and a 1px #333 bottom rule the shared toolbar rule
          suppresses between two stacked bars. Its three "buttons" read
          "auto" / "pair" / "locks" in the user-agent font because a bare
          <button type="button"> takes it. The five combos are AppendControl slots and are
          supplied through `controls`, as KiCad supplies them through
          RegisterCustomToolbarControlFactory. */}
      <Toolbar
        entries={pcbAuxBar}
        orientation="horizontal"
        onActivate={onTopAction}
        /* `PCB_EDIT_FRAME`'s check for `PCB_ACTIONS::autoTrackWidth`:
           `return GetDesignSettings().m_UseConnectedTrackWidth;`
           (pcb_edit_frame.cpp:1250). */
        toggled={autoTrackWidth ? AUTO_TRACK_WIDTH_ON : EMPTY_TOGGLED}
        controls={{
          /* Every one of these five was a bare `<select>`, so GTK's wxChoice
             metrics — the height, the padding, the chevron and its gutter, the
             font — were the *browser's* instead of ours, and the whole bar sat
             visibly narrower and shorter than pcbnew's. `Combo` is the widget
             that carries those tokens, and GerbView's identical TOP_AUX has
             used it all along; this bar was the one that never got it. */
          [PCB_CONTROL.trackWidth]: (
            <Combo
              title="Select the default width for new tracks. Note that this width can be overridden by the board minimum width, or by the width of an existing track if the 'Use Existing Track Width' feature is enabled."
              value={String(trackSel)}
              options={[
                { value: '0', label: 'Track: use netclass width' },
                ...trackWidthList.map((w, i) => ({
                  value: String(i + 1),
                  label: `Track: ${auxMM(w)} mm (${auxMils(w)} mils)`,
                })),
              ]}
              onChange={(v) => setTrackSel(Number(v))}
            />
          ),
          [PCB_CONTROL.viaDiameter]: (
            <Combo
              title="Via size"
              value={String(viaSel)}
              options={[
                { value: '0', label: 'Via: use netclass sizes' },
                ...viaSizeList.map((v, i) => ({
                  value: String(i + 1),
                  label:
                    v.drill > 0
                      ? `Via: ${auxMM(v.diameter)} / ${auxMM(v.drill)} mm (${auxMils(v.diameter)} / ${auxMils(v.drill)} mils)`
                      : `Via: ${auxMM(v.diameter)} mm (${auxMils(v.diameter)} mils)`,
                })),
              ]}
              onChange={(v) => setViaSel(Number(v))}
            />
          ),
          /* `PCB_LAYER_BOX_SELECTOR::Resync` (pcb_layer_box_selector.cpp:90-101):
             the layer's colour swatch, its name, and — through
             `AddHotkeyName( layername, action->GetHotKey(), IS_COMMENT )` — the
             hotkey of the action that switches to it, in parentheses. Only
             `layerTop` and `layerBottom` carry a default hotkey
             (pcb_actions.cpp:1873, :2129), so F.Cu and B.Cu read "(PgUp)" and
             "(PgDn)" and every inner layer reads as its bare name, which is
             `AddHotkeyName`'s own empty-keyname branch.

             The swatch is `Combo`'s, not a span of ours: its `swatch` option is
             modelled on this very call (see ComboOption). */
          [PCB_CONTROL.layerSelector]: (
            <Combo
              ariaLabel="Active layer"
              value={activeLayer}
              options={enabledLayerNames(frameRef.current?.GetBoard()).map((name) => ({
                value: name,
                label: layerBoxLabel(layerName(name), name),
                swatch: layerColor(name),
              }))}
              onChange={(v) => switchActiveLayer(v)}
            />
          ),
          /* GRID_MENU::BuildChoiceList: `"%s%s (%s)"`, both halves formatted by
             GRID::MessageText with aDisplayUnits true, so both carry the unit
             suffix EDA_UNIT_UTILS::GetText gives — which is "mils", plural.
             This wrote a singular "mil". */
          [PCB_CONTROL.gridSelect]: (
            <Combo
              title="Grid"
              value={String(gridIU)}
              options={[
                ...PCB_GRIDS.map((g) => ({
                  value: String(g),
                  label: `${fmtCoord(g)}${unitText(unitLabel)} (${
                    unitLabel === 'mils'
                      ? `${auxMM(g)}${unitText('mm')}`
                      : `${auxMils(g)}${unitText('mils')}`
                  })`,
                })),
                ...(PCB_GRIDS.includes(gridIU)
                  ? []
                  : [
                      { value: String(gridIU), label: `${fmtCoord(gridIU)}${unitText(unitLabel)}` },
                    ]),
              ]}
              onChange={(v) => {
                setGridIUStored(Number(v));
                requestDraw();
              }}
            />
          ),
          [PCB_CONTROL.zoomSelect]: (
            <Combo
              title="Zoom"
              value={String(zoomSelValue)}
              options={[
                { value: 'auto', label: ZOOM_AUTO_LABEL },
                ...(zoomCustom !== null
                  ? [{ value: String(zoomCustom), label: zoomSelectLabel(zoomCustom) }]
                  : []),
                ...ZOOM_LIST.pcbnew.map((z) => ({
                  value: String(z),
                  label: zoomSelectLabel(z),
                })),
              ]}
              onChange={(v) => {
                if (v === 'auto') zoomToFit();
                else setZoomPreset(Number(v));
              }}
            />
          ),
          /* A wxCheckBox labelled "Override locks" (eda_draw_frame.cpp:240),
             not a button. Its command is not ported, so it is disabled.

             `.ze-check` is the shared wxCheckBox row — it centres the indicator
             against its label and sets the gap between them from
             --check-margin, both of which GTK does for a real one. Stating
             nothing, this was an inline `<input>` sitting on the text baseline,
             so the box rode visibly high beside the words and the gap was the
             browser's, not the theme's. */
          [PCB_CONTROL.overrideLocks]: (
            <label className="ze-check">
              <input type="checkbox" disabled />
              Override locks
            </label>
          ),
        }}
      />

      <div className="ze-body">
        {/* KiCad docks the Properties pane outermost-left (Layer 5), then the
            left options toolbar (Layer 3), then the canvas. */}
        {showProperties && (
          <>
            <div className="ze-leftdock" style={{ width: propWidth, minWidth: 240 }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">
                  <span>Properties</span>
                  {/* `.CloseButton( true )` on this pane and this pane alone —
                      Appearance and Selection Filter are both
                      `.CloseButton( false )` (pcb_edit_frame.cpp:356,365,387),
                      which is why only this caption gets the box. The same
                      `.ze-pane-close` eeschema's palettes use; closing a pane
                      is the state the View > Panels check item drives, so it
                      goes through the same toggle. */}
                  <button
                    type="button"
                    className="ze-pane-close"
                    onClick={() => onLeftToggle('showProperties')}
                    title="Close"
                  >
                    ⊠
                  </button>
                </div>
                <div className="ze-panel-body">
                  {/* The empty and multi-selection captions are PROPERTIES_PANEL's
                    own (properties_panel.cpp:196-210), so the panel renders them
                    rather than the frame swapping in a placeholder. */}
                  <PcbPropertiesPanel
                    frame={frameRef.current}
                    selection={selection}
                    revision={board}
                    units={unitLabel}
                  />
                </div>
              </div>
            </div>
            {/* A SIBLING of the pane, not a child of it. wxAUI puts the sash
              BETWEEN two docks and gives it its own 5px - [px] pcbnew at
              y=1000, the pane ends at x=365 and the left toolbar starts at
              x=371. Inside `.ze-leftdock`, which is a column, a `width`-only
              rule gets a flex-basis of auto and no height, so the bar was
              there in the markup and nowhere on screen: the pane butted
              straight into the toolbar and the strip read 5px narrow.

              Clamps unchanged: KiCad's PCB_PROPERTIES_PANEL MinSize 240, and
              600 past which the canvas suffers. */}
            <DockSash edge="right" width={propWidth} min={240} max={600} onResize={setPropWidth} />
          </>
        )}

        <Toolbar
          entries={pcbLeftBar}
          app="pcbnew"
          orientation="vertical"
          side="left"
          toggled={leftToggles}
          disabledIds={leftDisabled}
          onActivate={onLeftToggle}
        />

        {/* `CreateInfoBar()` puts WX_INFOBAR at AUI layer 1: its own pane ABOVE
            the canvas, not something drawn inside it. That distinction is load
            bearing here, because this frame's <canvas> is `position: absolute;
            inset: 0` in the wrap - so a strip rendered as its sibling was
            painted over the moment the board had anything to draw, and only
            showed while the canvas was still empty. The column gives the bar
            its own height and leaves everything inside the wrap positioned
            against the wrap exactly as before. */}
        <div
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          {readOnlyNotice}
          {frameInfoBar !== null && (
            <Infobar
              message={frameInfoBar.message}
              actionLabel={frameInfoBar.button?.label}
              onAction={
                frameInfoBar.button
                  ? () => {
                      frameInfoBar.button?.onClick();
                      storePcbnewSettingsRef.current();
                    }
                  : undefined
              }
              className="ze-router-infobar"
              key={frameInfoBar.message}
            />
          )}
          {hotkeyPopup.node}
          {infoBarError !== null && (
            <Infobar
              message={infoBarError}
              closable
              className="ze-router-infobar"
              key={infoBarError}
            />
          )}
          <div
            className="ze-canvas-wrap"
            ref={wrapRef}
            style={{ position: 'relative', flex: 1, minHeight: 0 }}
          >
            {/* The KiCad canvas: `PCB_DRAW_PANEL_GAL` on WebGL2 (#481). It takes
              the canvas events itself - `EDA_DRAW_PANEL_GAL`'s own listeners feed
              WX_VIEW_CONTROLS (the wheel, the drag gestures, autopan) and the
              TOOL_DISPATCHER, which runs PCB_SELECTION_TOOL. The React handlers
              on it are the window's own tools' (TRANSITIONAL, #636 stage 3): a
              drawing tool, a point edit or a move in flight, which
              `eventToWindow` keeps off the dispatcher. */}
            <canvas
              ref={glCanvasRef}
              style={{
                position: 'absolute',
                inset: 0,
                outline: 'none',
                // The selection tool and the TOOL_MANAGER tools set their own
                // cursor through `SetCurrentCursor` (the selection tool's ARROW,
                // MOVING, ADD, SUBTRACT, XOR, SELECT_WINDOW, SELECT_LASSO;
                // DRAWING_TOOL's PENCIL, MOVING, TEXT...); a window tool still
                // states its own here.
                //
                // A real cursor, always.
                //
                // This was `none` for every tool but the picker, on the grounds
                // that KiCad draws its own crosshair on the canvas, which it does
                // (the crosshair pass is below). But desktop KiCad draws that
                // crosshair *and* keeps the window's pointer: the crosshair marks
                // the snapped point, the pointer shows where the mouse is.
                //
                // With `none` there is no pointer at all, so the only thing on
                // screen that follows the mouse is painted by us, and it can move
                // no faster than a frame. A native cursor is composited by the
                // OS and tracks the mouse whatever the page is doing. That is the
                // whole of the difference between a cursor that feels attached to
                // your hand and one that feels dragged through mud, and no amount
                // of renderer work reaches it.
                //
                // The local ratsnest picker's KICURSOR::BULLSEYE is the stock
                // wxCURSOR_BULLSEYE on GTK (IsStockCursorOk) — GDK_TARGET, which
                // `ui/kicursors.ts` vendors as measured, not CSS `crosshair`.
                //
                // The two tools that DO name a cursor name KiCad's own art,
                // through the one CURSOR_STORE: `ZOOM_TOOL::Main` sets
                // KICURSOR::ZOOM_IN (`zoom_tool.cpp:65-69`) and
                // `PCB_VIEWER_TOOLS::MeasureTool` KICURSOR::MEASURE
                // (`pcb_viewer_tools.cpp:292`). This frame had neither and
                // showed the plain arrow for both.
                cursor:
                  isSelectTool(activeTool) || TOOL_MANAGER_TOOLS[activeTool]
                    ? undefined
                    : boardToolCursor(activeTool),
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
              onWheel={requestDraw}
              onContextMenu={onCanvasContextMenu}
            />
            {/* TRANSITIONAL (#636 stage 3): the window's overlay - the previews,
              handles and chrome of the tools not yet ported onto the VIEW. It
              takes no events. Deleted when the last of them has moved. */}
            <canvas
              ref={canvasRef}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            />
            {error && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#ff8080',
                }}
              >
                Couldn’t open board: {error}
              </div>
            )}
          </div>
          {/* The two `.Bottom()` panes, under the canvas and beside the toolbars
              (`pcb_edit_frame.cpp:396-412`). */}
          <PcbBottomDock
            showSearch={showSearch}
            showNetInspector={showNetInspector}
            height={dockHeight}
            onHeightChange={setDockHeight}
            onCloseSearch={() => onLeftToggle('showSearch')}
            onCloseNetInspector={() => onLeftToggle('showNetInspector')}
            netInspector={
              board && (
                <PcbNetInspectorPane
                  board={frameRef.current?.GetBoard() ?? null}
                  revision={board}
                  onHighlightNets={(codes) => applyRenderHighlightRef.current(codes)}
                />
              )
            }
            search={
              <PcbSearchPane
                frame={searchFrame}
                board={boardK}
                wiring={searchWiring}
                menuState={{
                  selectionZoom: commonCfg.search_pane.selection_zoom,
                  searchHiddenFields: commonCfg.search_pane.search_hidden_fields,
                  searchMetadata: commonCfg.search_pane.search_metadata,
                }}
                onMenuStateChange={(next) =>
                  updateCommonSettings((c) => {
                    c.search_pane.selection_zoom = next.selectionZoom;
                    c.search_pane.search_hidden_fields = next.searchHiddenFields;
                    c.search_pane.search_metadata = next.searchMetadata;
                  })
                }
                units={unitLabel}
              />
            }
          />
          {vertexPane && (
            <VertexEditorWindow pane={vertexPane} onClose={() => vertexPane.Destroy()} />
          )}
        </div>

        <Toolbar
          entries={pcbRightBar}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={setActiveTool}
        />

        {/* LayersManager + SelectionFilter dock: Right().Layer(4), outside the
            Right().Layer(3) toolbar (pcb_edit_frame.cpp AUI setup), i.e. at the
            window edge with the toolbar between it and the canvas. */}
        {showAppearance && (
          <>
            {/* The same sash GerbView's layers pane uses; wxAUI gives every dock
              one, so it belongs in ui/ rather than here. It is a sibling of
              the pane for the reason the Properties one is - see there - and
              it comes FIRST because this dock's canvas-facing edge is its
              left. The clamps are unchanged: MinSize 200, and 500 past which
              the canvas suffers. */}
            <DockSash edge="left" width={appWidth} min={200} max={500} onResize={setAppWidth} />
            <div className="ze-rightdock" style={{ width: appWidth }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">Appearance</div>
                {/* APPEARANCE_CONTROLS. The identical widget the footprint editor
                  builds; everything below is data this frame supplies. */}
                <AppearanceControls
                  tab={tab}
                  onTab={setTab}
                  layerRows={layerRows}
                  layerName={layerName}
                  layerColor={layerColor}
                  activeLayer={activeLayer}
                  onActiveLayer={setActiveLayer}
                  visibleLayers={visible}
                  onToggleLayer={toggleLayer}
                  onLayerContextMenu={(x, y) => setLayerMenu({ x, y })}
                  objects={objects}
                  onToggleObject={(key) => {
                    if (key === 'ratsnest') onRatsnestObjectVisibility(!objects.ratsnest);
                    else setObjects((p) => toggleObject(p, key));
                  }}
                  objectColor={(key) => PCB_OBJECT_COLORS[key]}
                  opacity={opacity}
                  onOpacity={(key, value) => setOpacity((p) => ({ ...p, [key]: value }))}
                  contrast={contrast}
                  onContrast={onHighContrastMode}
                  flipBoard={flipView}
                  onFlipBoard={toggleFlip}
                  layerOptionsOpen={layerOptsOpen}
                  onLayerOptionsOpen={setLayerOptsOpen}
                  nets={{
                    nets: netRows,
                    onNetColor: setNetColor,
                    // APPEARANCE_CONTROLS' net row: BOARD_INSPECTION_TOOL's
                    // show/hideNetInRatsnest with the net code.
                    onNetVisibility: (code) => {
                      frameRef.current
                        ?.GetToolManager()
                        ?.RunAction(
                          hiddenNets.has(code)
                            ? PCB_ACTIONS.showNetInRatsnest
                            : PCB_ACTIONS.hideNetInRatsnest,
                          code,
                        );
                      refreshInspectionMirrorRef.current();
                    },
                    netclasses: netclassRows,
                    onNetclassColor: (cls, picked) =>
                      setClassColors((p) => new Map(p).set(cls, toCssColor(picked, ', '))),
                    onNetclassVisibility: (cls) =>
                      setHiddenClasses((p) => {
                        const next = new Set(p);
                        if (next.has(cls)) next.delete(cls);
                        else next.add(cls);
                        return next;
                      }),
                    onConfigureNetclasses: () => {
                      setBoardSetupPage('netclasses');
                      setBoardSetupOpen(true);
                    },
                    netColorMode,
                    onNetColorMode: onNetColorMode,
                    ratsnestMode,
                    onRatsnestMode: onRatsnestMode,
                    optionsOpen: netOptsOpen,
                    onOptionsOpen: setNetOptsOpen,
                  }}
                  presetItems={presetItems}
                  preset={preset}
                  onPreset={onPresetChoice}
                  deletePresetDisabled={userPresets.length === 0}
                  viewportItems={viewportItems}
                  viewport={viewportSel}
                  onViewport={onViewportChoice}
                  deleteViewportDisabled={viewports.length === 0}
                />
              </div>

              {/* `.fixed` is `dock_proportion = 0` —
                `m_auimgr.GetPane( "SelectionFilter" ).dock_proportion = 0`
                (pcbnew/pcb_edit_frame.cpp:422). A docked pane grows by default;
                this is the pane that declares it does not. */}
              <div className="ze-panel fixed">
                <div className="ze-panel-header">Selection Filter</div>
                <div className="ze-panel-body">
                  {/* PANEL_SELECTION_FILTER — the same widget the footprint
                    editor docks. Right-clicking a category pops "Only <label>". */}
                  <SelectionFilterPanel
                    filter={selFilter}
                    onChange={setSelFilter}
                    onContextMenu={(x, y, item) => setFilterMenu({ x, y, item })}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* EDA_3D_VIEWER_FRAME. Upstream this is a sibling top-level window
          (KIWAY_PLAYER parented to the PCB frame); in one browser tab it is a
          full-viewport overlay, but it carries the frame's own chrome: menu
          bar, the single TOP_MAIN toolbar (3d-viewer has no side toolbars) and
          the 5-pane status bar. */}
      {show3D && board && (
        <Viewer3DFrame
          board={board}
          projectFiles={projectFiles}
          // BOARD_ADAPTER reads the stackup off the board it is given; ours is
          // held by the editor, so it is handed down. The Color column on the
          // Physical Stackup page is what these paint.
          stackup={boardSetup.physicalStackup}
          boardFinish={boardSetup.boardFinish}
          backLabel="← PCB Editor"
          imageBaseName={projectName || fileName.replace(/\.kicad_pcb$/i, '') || 'board'}
          onClose={() => setShow3D(false)}
          selectedFootprints={selectedFootprints}
          // EDA_3D_CANVAS::OnLeftUp (eda_3d_canvas.cpp:1152-1162): the click is
          // mailed to the board and schematic editors alike.
          onSelect={(parts: readonly string[]) => {
            const frame = frameRef.current;
            const command = `$SELECT: 0,${parts.join(',')}`;
            frame
              ?.Kiway()
              ?.ExpressMail(
                FRAME_T.FRAME_PCB_EDITOR,
                MAIL_T.MAIL_SELECTION,
                { value: command },
                frame,
              );
            frame
              ?.Kiway()
              ?.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SELECTION, { value: command }, frame);
          }}
          netClassOf={netClassOf}
          // "Follow PCB Editor": IsLayerVisible / IsElementVisible off this frame
          pcbVisibility={{
            layers: visible,
            fpReferences: objects.fpReferences,
            fpValues: objects.fpValues,
            fpText: objects.fpText,
          }}
          onOpenPreferences={() => setPrefsOpen(true)}
        />
      )}

      {/* Disambiguation menu (SELECTION_TOOL::doSelectionMenu): which of several
          overlapping items to select.

          Same rows as every other menu in the app, because upstream's is an
          ordinary ACTION_MENU: the first nine are numbered `&n  <description>`
          with the number repeated as the accelerator, then a separator and
          "Select &All\tA". No title — pcbnew never sets `m_MenuTitle`, so the
          "Clarify Selection" caption we had was ours, not KiCad's. Pointing at
          a row brightens what it refers to on the board. */}
      {/* `wxWindow::PopupMenu` for a tool's ACTION_MENU - the disambiguation
          menu `doSelectionMenu` puts up, and any other a tool shows - drawn
          with the menu bar's ContextMenu (common/tool/action_menu_popup.tsx's
          rows), each row wired back to the menu's OnMenuEvent. */}
      {toolPopup && (
        <ContextMenu
          x={toolPopup.x}
          y={toolPopup.y}
          items={actionMenuItems(toolPopup.menu)}
          onClose={() => {
            const close = toolPopup.onClose;
            setToolPopup(null);
            // wx runs the chosen row while PopupMenu is still open and returns
            // after, so the close half runs once the row's handler has.
            queueMicrotask(close);
          }}
        />
      )}

      {/* PANEL_SELECTION_FILTER::onRightClick's one-item wxMenu. */}
      {filterMenu && (
        <SelectionFilterOnlyMenu
          at={filterMenu}
          onOnly={(key) => setSelFilter(new Set([key]))}
          onClose={() => setFilterMenu(null)}
        />
      )}

      {/* Layer right-click menu (APPEARANCE_CONTROLS::rightClickHandler /
          onLayerContextMenu), acting on the active layer like upstream. */}
      {layerMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setLayerMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setLayerMenu(null);
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: Math.min(layerMenu.x, window.innerWidth - 260),
              top: Math.min(layerMenu.y, window.innerHeight - 320),
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 230,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {layerMenuItems().map((group, gi, arr) => (
              <div key={`g${gi}`}>
                {group.map((item) => (
                  <div
                    key={item.label}
                    className="ze-tree-item"
                    style={{ padding: '3px 12px', cursor: 'default' }}
                    onClick={() => {
                      item.run();
                      setLayerMenu(null);
                    }}
                  >
                    {item.label}
                  </div>
                ))}
                {gi < arr.length - 1 && (
                  <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '4px 0' }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* "Delete preset/viewport..." chooser (EDA_LIST_DIALOG stand-in). */}
      {deleteChooser && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}
            onMouseDown={() => setDeleteChooser(null)}
          />
          <div
            style={{
              position: 'fixed',
              right: 24,
              bottom: 120,
              zIndex: 61,
              background: '#26262b',
              border: '1px solid #444',
              borderRadius: 4,
              minWidth: 180,
              padding: '4px 0',
              fontSize: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '2px 12px 4px', opacity: 0.6 }}>
              Delete {deleteChooser === 'presets' ? 'preset' : 'viewport'}
            </div>
            {(deleteChooser === 'presets' ? userPresets : viewports).map((p) => (
              <div
                key={p.name}
                className="ze-tree-item"
                style={{ padding: '3px 12px', cursor: 'default' }}
                onClick={() => {
                  if (deleteChooser === 'presets') {
                    setUserPresets((u) => u.filter((x) => x.name !== p.name));
                  } else {
                    setViewports((v) => v.filter((x) => x.name !== p.name));
                    if (viewportSel === p.name) setViewportSel('---');
                  }
                  setDeleteChooser(null);
                }}
              >
                {p.name}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Barcode properties: `DRAWING_TOOL::DrawBarcode` opens it on its new
          barcode before committing (`drawing_tool.cpp:1534-1541`); a double-click
          on an existing one opens it through `EDIT_TOOL::Properties`. */}
      {barcodePropsDlg && board && (
        <DialogBarcodeProperties
          units={unitLabel}
          preview={barcodePropsDlg.preview}
          commitError={barcodePropsDlg.commitError}
          initial={barcodePropsDlg.dialog.TransferDataToWindow()}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          layerColor={layerColor}
          background={PCB_BACKGROUND}
          onClose={() => {
            barcodePropsDlg.resolve?.(false);
            setBarcodePropsDlg(null);
          }}
          onApply={(v) => {
            const d = barcodePropsDlg;
            setBarcodePropsDlg(null);
            d.resolve?.(d.dialog.TransferDataFromWindow(v).ok);
          }}
        />
      )}

      {/* File > Import > Non-KiCad Board File. `OpenProjectFiles( { file },
          KICTL_NONKICAD_ONLY )` (files.cpp:476): the importer builds the board
          (`ImportNonKicadBoard`), which replaces this one under the editor's
          file name - upstream keeps `previousBoardFileName` - and is modified,
          so the next save writes it into the project. */}
      {nonKicadFilters && (
        <WxFileDialog
          title="Import Non KiCad Board File"
          filters={nonKicadFilters}
          projectDir={projectDirRef.current || null}
          onDone={(file) => {
            setNonKicadFilters(null);
            const frame = frameRef.current;

            if (!file || !frame) return;

            void frame
              .ImportNonKicadBoard(
                file.path,
                file.bytes,
                KICTL_NONKICAD_ONLY,
                null,
                (layers) =>
                  new Promise((resolve) =>
                    setMapLayersRequest({
                      layers,
                      done: (aMap, aKeep) => {
                        // `m_ImportKeepKiCadLayerNames = dlg.m_cbKeepKiCadLayerNames->GetValue()`
                        frame.GetPcbNewSettings().m_ImportKeepKiCadLayerNames = aKeep;
                        setMapLayersRequest(null);
                        resolve(aMap);
                      },
                    }),
                  ),
              )
              .then(({ board: kb, loadMessages, customRules }) => {
                frame.Clear_Pcb();
                frame.SetBoard(kb, false);
                kb.BuildConnectivity();

                // The `.kicad_dru` an importer writes beside the board (Eagle's class
                // clearance matrix) becomes the project's rules file, as it does when
                // KiCad then opens the board's project; persisted now, like Board Setup's.
                let files = projectFilesNow();
                const pro = findProjectPro(files, rootPro);

                if (customRules !== '' && pro) {
                  const dru = findProjectDru(files, rootPro);
                  const name = dru?.name ?? druFileName(pro.name);
                  projectFileEditsRef.current.set(name, {
                    base: dru?.text ?? '',
                    text: customRules,
                  });
                  onPersistFiles?.([{ name, text: customRules }]);
                  files = dru
                    ? files.map((f) => (f === dru ? { name, text: customRules } : f))
                    : [...files, { name, text: customRules }];
                }

                syncProjectSettingsIntoBoard(
                  frame,
                  panelRef.current,
                  files,
                  rootPro,
                  false,
                  projectDirRef.current,
                );
                setBoardModel({
                  ...boardFromBOARD(kb, fileNameRef.current),
                  fileName: fileNameRef.current,
                });
                setDirty(true);

                if (loadMessages !== '') setInfoBarError(loadMessages.trimEnd());
              })
              .catch((e: unknown) =>
                setInfoBarError(
                  `Error loading PCB '${file.path}'.\n${e instanceof Error ? e.message : String(e)}`,
                ),
              );
          }}
        />
      )}
      {importNetlistName !== null && (
        <DialogImportNetlist
          netlistName={importNetlistName}
          readFile={(p) => projectFilesNow().find((f) => f.name === p)?.text ?? null}
          performLoad={performImportNetlist}
          onClose={(n) => {
            lastNetlistPathRef.current = n;
            setImportNetlistName(null);
          }}
        />
      )}
      {mapLayersRequest && frameRef.current && (
        <DialogMapLayers
          layers={mapLayersRequest.layers}
          keepKiCadLayerNames={frameRef.current.GetPcbNewSettings().m_ImportKeepKiCadLayerNames}
          onDone={mapLayersRequest.done}
        />
      )}
      {/* File > Import > Graphics: DIALOG_IMPORT_GRAPHICS, which
          `DRAWING_TOOL::PlaceImportedGraphics` opens and then places what it
          imported (`drawing_tool.cpp:2044-2230`). */}
      {importGfxDlg && (
        <DialogImportGraphics
          units={unitLabel}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          layerColor={layerColor}
          activeLayer={activeLayer}
          parent={(frameRef.current?.GetModel() as BOARD_ITEM_CONTAINER | null | undefined) ?? null}
          invertX={frameRef.current?.GetPcbNewSettings().m_Display.m_DisplayInvertXAxis ?? false}
          invertY={frameRef.current?.GetPcbNewSettings().m_Display.m_DisplayInvertYAxis ?? false}
          onCancel={() => {
            importGfxDlg.resolve(null);
            setImportGfxDlg(null);
          }}
          onOk={(items, opts) => {
            importGfxDlg.resolve({
              items,
              groupItems: opts.group,
              interactive: opts.interactive,
              fixDiscontinuities: opts.fixDiscontinuities,
              // `m_tolerance.GetValue()`: the unit binder answers IU.
              tolerance: pcbIUScale.mmToIU(opts.toleranceMM),
            });
            setImportGfxDlg(null);
          }}
        />
      )}

      {/* `DRAWING_TOOL::PlaceText` builds the PCB_TEXT and opens the SAME
          dialog an existing text opens (`drawing_tool.cpp:144`), so this is
          `DialogTextProperties` and not a second, smaller one. It was a
          hand-rolled div with its own colours, its own border radius and two
          bare buttons — a fourth of this editor's colour literals were in it. */}
      {/* FRAME_FOOTPRINT_CHOOSER, from `PCB_BASE_FRAME::SelectFootprintFromLibrary`
          (load_select_footprint.cpp:190-224). The same frame the schematic's
          footprint field opens; a cancel leaves the tool armed and waiting. */}
      {fpChooserOpen && (
        <FootprintChooserFrame
          onOk={onFootprintChosen}
          onCancel={onFootprintChooserCancel}
          {...(fpChooserPreselect ? { preselect: fpChooserPreselect } : {})}
          loadFootprintIndex={loadFootprintIndex}
          loadFootprint={loadFootprint}
        />
      )}

      {pageDlg && board && (
        <DialogPageSettings
          // BOARD_EDITOR_CONTROL::PageSettings constructs the base class, not
          // eeschema's subclass (board_editor_control.cpp:530-532), so the
          // sheet tallies and every "Export to other sheets" checkbox stay
          // Show(false) (dialog_page_settings.cpp:169-186). It is also the one
          // caller passing MAX_PAGE_SIZE_PCBNEW_MILS rather than eeschema's.
          frame="pcbnew"
          // `m_customSizeX( aParent, … )` over the board frame — a fresh
          // pcbnew is in MILLIMETRES (app_settings.cpp:228-238).
          units={unitLabel}
          value={(() => {
            // DIALOG_PAGES_SETTINGS reads the frame's PAGE_INFO and TITLE_BLOCK.
            const kb = frameRef.current!.GetBoard()!;
            const tb = kb.GetTitleBlock();
            return pageSettingsValue(paperOfPageInfo(kb.GetPageSettings()), {
              title: tb.GetTitle(),
              date: tb.GetDate(),
              rev: tb.GetRevision(),
              company: tb.GetCompany(),
              comments: Array.from({ length: 9 }, (_, i) => tb.GetComment(i)),
            });
          })()}
          onOk={(next) => {
            // DIALOG_PAGES_SETTINGS::TransferDataFromWindow: the page and the
            // title block into the frame.
            const frame = frameRef.current;
            if (frame) {
              frame.SetPageSettings(pageInfoOfPaper(toPaperToken(next), frame.GetPageSettings()));
              const tb = new TITLE_BLOCK();
              tb.SetTitle(next.title);
              tb.SetDate(next.date);
              tb.SetRevision(next.rev);
              tb.SetCompany(next.company);
              next.comments.forEach((c, i) => tb.SetComment(i, c));
              frame.SetTitleBlock(tb);
            }
            pageDlg.resolve(frame !== null);
            setPageDlg(null);
          }}
          onCancel={() => {
            pageDlg.resolve(false);
            setPageDlg(null);
          }}
        />
      )}
      {printDlg && (
        <DialogPcbPrint
          dlg={printDlg.dlg}
          onMessage={(message, error) => setPrintMessage({ message, error })}
          // wxPrinter::Print( this, printout, true ): the pages PCBNEW_PRINTOUT
          // draws, into the browser's print dialog.
          onPrint={() => {
            new wxPrinter().Print(printDlg.dlg.createPrintout('Print'));
          }}
          onClose={() => {
            const done = printDlg.done;
            setPrintDlg(null);
            done();
          }}
        />
      )}
      {printMessage &&
        (printMessage.error ? (
          <MessageDialogError
            message={printMessage.message}
            onClose={() => setPrintMessage(null)}
          />
        ) : (
          <MessageDialogOk
            caption="Information"
            icon="information"
            message={printMessage.message}
            onClose={() => setPrintMessage(null)}
          />
        ))}
      {plotDlgOpen && board && (
        <DialogPcbPlot
          board={frameRef.current!.GetBoard()!}
          fileName={fileName ?? ''}
          units={unitLabel}
          projectFolders={projectFolders}
          onOutputFile={onOutputFile}
          onRunDrc={() => {
            // DIALOG_PLOT's Run DRC... hands off to the DRC dialog.
            setPlotDlgOpen(false);
            frameRef.current?.GetToolManager()?.RunAction(PCB_ACTIONS.runDRC);
          }}
          onClose={() => setPlotDlgOpen(false)}
        />
      )}
      {/* Update PCB from Schematic: the netlist fetch, then DIALOG_UPDATE_PCB.
          A failed fetch shows the same message upstream puts in a
          DisplayErrorMessage box (a missing schematic, or one not annotated). */}
      {pasteSpecialDlg && (
        <DialogPasteSpecial
          /* `PASTE_MODE mode = PASTE_MODE::KEEP_ANNOTATIONS` before the dialog
             is shown (pcb_control.cpp:1208), so pcbnew always opens on "keep"
             — where the schematic never does. */
          mode="KEEP_ANNOTATIONS"
          /* `const wxString defaultRef = wxT( "REF**" )` (:1211), which is the
             string the third row's tooltip names. */
          defaultRef="REF**"
          showClearNets={pasteSpecialDlg.showClearNets}
          onOk={(chosen: PasteSpecialMode, clearNets: boolean) => {
            pasteSpecialDlg.resolve({ mode: chosen, clearNets });
            setPasteSpecialDlg(null);
          }}
          onCancel={() => {
            pasteSpecialDlg.resolve(null);
            setPasteSpecialDlg(null);
          }}
        />
      )}
      {aboutOpen && (
        <ShowAboutDialog title={ABOUT_TITLES.pcb} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}
      {/* `WX_PROGRESS_REPORTER( this, _( "Load Footprint Libraries" ), 1, PR_CAN_ABORT )`
          (cvpcb_mainframe.cpp:910), the same reporter the footprint reads use. */}
      <ProgressDialog
        title="Load Footprint Libraries"
        label={updatePcbBusy ? 'Loading footprint libraries...' : null}
      />
      <ProgressDialog title="Load PCB" label={loading} />
      {updatePcbError && (
        <div className="ze-modal-backdrop" onMouseDown={() => setUpdatePcbError(null)}>
          <div className="ze-modal ze-message-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Update PCB from Schematic
              <span className="x" onClick={() => setUpdatePcbError(null)}>
                ✕
              </span>
            </div>
            <div className="ze-modal-body ze-message-body">
              <p>{updatePcbError.message}</p>
              {updatePcbError.details && <pre>{updatePcbError.details}</pre>}
            </div>
            <div className="ze-modal-footer">
              <span style={{ flex: 1 }} />
              <button type="button" className="primary" onClick={() => setUpdatePcbError(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {updatePcb && (
        <DialogUpdatePcb
          onPerformUpdate={performNetlistUpdate}
          onClose={() => setUpdatePcb(null)}
        />
      )}
      {zoneSettingsDlg &&
        board &&
        (() => {
          const { dialog, resolve } = zoneSettingsDlg;
          const done = (aOk: boolean): void => {
            setZoneSettingsDlg(null);
            resolve(aOk);
          };
          const transferred = (r: { ok: boolean; message?: string }): void => {
            if (r.ok) done(true);
            else if (r.message) DisplayErrorMessage(r.message);
          };
          if (dialog instanceof DIALOG_COPPER_ZONE)
            return (
              <DialogCopperZones
                units={unitLabel}
                initial={dialog.TransferDataToWindow()}
                nets={netNamesByCode(frameRef.current?.GetBoard())}
                layers={copperLayerRows}
                onApply={(values, conv) => transferred(dialog.TransferDataFromWindow(values, conv))}
                onClose={() => done(false)}
              />
            );
          if (dialog instanceof DIALOG_RULE_AREA_PROPERTIES)
            return (
              <DialogRuleAreaProperties
                units={unitLabel}
                initial={dialog.TransferDataToWindow()}
                layers={ruleAreaLayers}
                sources={collectPlacementSources(frameRef.current!.GetBoard()!)}
                onApply={(values, conv) => transferred(dialog.TransferDataFromWindow(values, conv))}
                onClose={() => done(false)}
              />
            );
          return (
            <DialogNonCopperZonesProperties
              dialog={dialog}
              units={unitLabel}
              layers={ruleAreaLayers.filter((l) => !/\.Cu$/.test(l.name))}
              onResult={done}
            />
          );
        })()}
      {textPropsDlg && board && (
        <DialogTextProperties
          initial={textPropsDlg.dialog.TransferDataToWindow()}
          units={unitLabel}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          layerColor={layerColor}
          onApply={applyTextEdit}
          onClose={() => {
            textPropsDlg.resolve?.(false);
            setTextPropsDlg(null);
          }}
        />
      )}
      {shapePropsDlg && board && (
        <DialogShapeProperties
          units={unitLabel}
          initial={shapePropsDlg.TransferDataToWindow()}
          shape={shapePropsDlg.GetShape()}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          onApply={applyShapeEdit}
          onClose={() => setShapePropsDlg(null)}
        />
      )}
      {tablePropsDlg && (
        <DialogTableProperties<TableValues>
          initial={tablePropsDlg.dialog.TransferDataToWindow()}
          iuScale={pcbIUScale}
          columnWidths={Array.from({ length: tablePropsDlg.table.GetColCount() }, (_, i) =>
            tablePropsDlg.table.GetColWidth(i),
          )}
          isNew={tablePropsDlg.table.IsNew()}
          header={tableDialogHeader}
          onOk={applyTableEdit}
          onCancel={() => {
            tablePropsDlg.resolve?.(false);
            setTablePropsDlg(null);
          }}
        />
      )}
      {textBoxPropsDlg && board && (
        <DialogTextBoxProperties
          initial={textBoxPropsDlg.dialog.TransferDataToWindow()}
          units={unitLabel}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          layerColor={layerColor}
          onApply={applyTextBoxEdit}
          onClose={() => {
            textBoxPropsDlg.resolve?.(false);
            setTextBoxPropsDlg(null);
          }}
        />
      )}
      {imagePropsDlg && board && (
        <DialogReferenceImageProperties
          image={{ data: imagePropsDlg.dialog.ImageData() }}
          initial={imagePropsDlg.dialog.TransferDataToWindow()}
          units={unitLabel}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          layerColor={layerColor}
          onApply={applyImageEdit}
          onClose={() => {
            imagePropsDlg.resolve(false);
            setImagePropsDlg(null);
          }}
        />
      )}
      {dimensionPropsDlg && board && (
        <DialogDimensionProperties
          units={unitLabel}
          initial={dimensionPropsDlg.TransferDataToWindow()}
          type={dimensionPropsDlg.GetDimensionType()}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          onApply={applyDimensionEdit}
          onClose={() => setDimensionPropsDlg(null)}
        />
      )}
      {padPropsDlg && board && (
        <DialogPadProperties
          units={unitLabel}
          initial={padPropsDlg.TransferDataToWindow()}
          nets={netNamesByCode(frameRef.current?.GetBoard())}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          onApply={applyPadEdit}
          onClose={() => setPadPropsDlg(null)}
        />
      )}
      {fpPropsDlg && frameRef.current && (
        <DialogFootprintProperties
          units={unitLabel}
          initial={fpPropsDlg.TransferDataToWindow()}
          libId={fpPropsDlg.GetFootprint().GetFPID().Format()}
          onApply={applyFootprintEdit}
          onClose={() => setFpPropsDlg(null)}
          model3d={(() => {
            const kfp = fpPropsDlg.GetFootprint();
            const frame = frameRef.current!;
            const resolver = (): FILENAME_RESOLVER =>
              (model3dResolverRef.current ??= PROJECT_PCB.Get3DFilenameResolver());
            const host: PANEL_3D_MODEL_HOST = {
              resolver,
              // `LIBRARY_MANAGER::GetFullURI( *row, true )` of the footprint's library.
              footprintBasePath: (nick) =>
                frame.GetBoard()?.GetFootprintLibAdapter()?.GetRow(nick)?.uri ?? '',
              embeddedFilesStack: () => [
                kfp.GetEmbeddedFiles(),
                frame.GetBoard()!.GetEmbeddedFiles(),
              ],
              // The Embedded Files page is not in this dialog yet, so nothing embeds here
              // and an embedded model's file stays with the footprint until it has one.
              addEmbeddedFile: () => null,
              removeEmbeddedFile: () => {},
              onModify: () => {},
            };
            return {
              footprint: kfp,
              host,
              renderPreview: (models, _selected, version) =>
                ModelPreview3D({ footprint: kfp, models, version }),
              pickModel: () =>
                new Promise<SELECTED_3D_MODEL | null>((resolve) =>
                  setPick3dModel({ done: resolve }),
                ),
            };
          })()}
        />
      )}
      {pick3dModel && (
        <WxFileDialog
          title="Select 3D Model"
          filters={[
            {
              label: 'All 3D models (*.wrl, *.wrz, *.step, *.stp, *.stpz, *.iges, *.igs)',
              extensions: ['wrl', 'wrz', 'step', 'stp', 'stpz', 'iges', 'igs'],
            },
          ]}
          projectDir={projectDirRef.current || null}
          onDone={(file) => {
            const { done } = pick3dModel;
            setPick3dModel(null);
            model3dResolverRef.current ??= PROJECT_PCB.Get3DFilenameResolver();
            // The name KiCad stores is the path shortened against the search paths.
            done(
              file
                ? {
                    filename: model3dResolverRef.current.ShortenPath(file.path),
                    embedded: false,
                  }
                : null,
            );
          }}
        />
      )}
      {footprintAssociations && frameRef.current && (
        <DialogFootprintAssociations
          footprint={footprintAssociations}
          adapter={frameRef.current.GetBoard()?.GetFootprintLibAdapter() ?? null}
          onClose={() => setFootprintAssociations(null)}
        />
      )}
      {zoneProps?.GetIsRuleArea() && board && frameRef.current && (
        <DialogRuleAreaProperties
          units={unitLabel}
          initial={new DIALOG_RULE_AREA_PROPERTIES(
            frameRef.current,
            zoneProps,
          ).TransferDataToWindow()}
          layers={ruleAreaLayers}
          sources={collectPlacementSources(frameRef.current!.GetBoard()!)}
          onApply={applyRuleAreaEdit}
          onClose={() => setZoneProps(null)}
        />
      )}
      {/* Edit_Zone_Params on a zone off copper: InvokeNonCopperZonesEditor
          (edit_zone_helpers.cpp:59-63), on the live ZONE. */}
      {zoneProps &&
        !zoneProps.GetIsRuleArea() &&
        !IsCopperLayer(zoneProps.GetFirstLayer()) &&
        frameRef.current && (
          <DialogNonCopperZonesProperties
            dialog={new DIALOG_NON_COPPER_ZONES_EDITOR(frameRef.current, zoneProps)}
            units={unitLabel}
            layers={ruleAreaLayers.filter((l) => !/\.Cu$/.test(l.name))}
            onResult={() => setZoneProps(null)}
          />
        )}
      {zoneProps &&
        !zoneProps.GetIsRuleArea() &&
        IsCopperLayer(zoneProps.GetFirstLayer()) &&
        frameRef.current && (
          <DialogCopperZones
            units={unitLabel}
            initial={new DIALOG_COPPER_ZONE(frameRef.current, zoneProps).TransferDataToWindow()}
            nets={netNamesByCode(frameRef.current?.GetBoard())}
            layers={copperLayerRows}
            // "A zone still in creation … can't be edited by the Zone Manager";
            // this path is a zone that already exists, so the button is shown.
            existingZone
            onApply={applyZoneEdit}
            // `onZoneManager`: `TransferDataFromWindow()`, close, then
            // `RunAction( zonesManager )` after the commit (`CallAfter`).
            onOpenZoneManager={(values) => {
              applyZoneEdit(values);
              setTimeout(() => runAction(PCB_ACTIONS.zonesManager), 0);
            }}
            onClose={() => setZoneProps(null)}
          />
        )}
      {trackViaItems &&
        board &&
        frameRef.current &&
        (() => {
          const dlg = new DIALOG_TRACK_VIA_PROPERTIES(frameRef.current!, trackViaItems);
          return (
            <DialogTrackViaProperties
              initial={dlg.TransferDataToWindow()}
              hasTracks={dlg.m_tracks}
              hasVias={dlg.m_vias}
              nets={netNamesByCode(frameRef.current?.GetBoard())}
              layers={enabledLayerNames(frameRef.current?.GetBoard()).filter((n) =>
                /\.Cu$/.test(n),
              )}
              trackWidths={trackWidthList}
              viaSizes={viaSizeList}
              onApply={applyTrackViaEdit}
              onClose={() => setTrackViaItems(null)}
            />
          );
        })()}
      {layerPairDialogOpen && frameRef.current && frameRef.current.GetBoard() && (
        <SelectCopperLayerPairDialog
          board={frameRef.current.GetBoard()!}
          theme={theme}
          layerPairSettings={frameRef.current.GetLayerPairSettings()}
          onClose={() => setLayerPairDialogOpen(false)}
        />
      )}
      {kiDialogNode}
      {arrayOpen && board && (
        <DialogCreateArray
          initial={arraySettings}
          onApply={applyArray}
          onClose={() => setArrayOpen(false)}
        />
      )}
      {pnsSettingsReq && (
        <DialogPnsSettings
          onClose={() => {
            pnsSettingsReq.resolve();
            setPnsSettingsReq(null);
          }}
          settings={pnsSettingsReq.settings}
        />
      )}
      {dpDimsReq && (
        <DialogPnsDiffPairDimensions
          value={dpDimsReq.value}
          units={unitLabel}
          onOk={(v) => {
            dpDimsReq.resolve(v);
            setDpDimsReq(null);
          }}
          onClose={() => {
            dpDimsReq.resolve(null);
            setDpDimsReq(null);
          }}
        />
      )}
      {trackViaSizeReq && (
        <DialogTrackViaSize
          value={trackViaSizeReq.value}
          units={unitLabel}
          onOk={(v) => {
            trackViaSizeReq.resolve(v);
            setTrackViaSizeReq(null);
          }}
          onClose={() => {
            trackViaSizeReq.resolve(null);
            setTrackViaSizeReq(null);
          }}
        />
      )}
      {/* CONVERT_TOOL::OutsetItems' DIALOG_OUTSET_ITEMS, on the tool's
          persistent OUTSET_ROUTINE::PARAMETERS. */}
      {outsetDlg && board && (
        <DialogOutsetItems
          units={unitLabel}
          layers={enabledLayerNames(frameRef.current?.GetBoard())}
          initial={new DIALOG_OUTSET_ITEMS(outsetDlg.params).TransferDataToWindow()}
          onApply={(values) => {
            const res = new DIALOG_OUTSET_ITEMS(outsetDlg.params).TransferDataFromWindow(values);
            if (!res.ok) {
              if (res.message) setInfoBarError(res.message);
              return;
            }
            setOutsetDlg(null);
            outsetDlg.resolve(true);
          }}
          onClose={() => {
            setOutsetDlg(null);
            outsetDlg.resolve(false);
          }}
        />
      )}
      {convertDlg && (
        <ConvertSettingsDialog
          dialog={convertDlg.dialog}
          units={unitLabel}
          onClose={(aOk) => {
            setConvertDlg(null);
            convertDlg.resolve(aOk);
          }}
        />
      )}
      {oneLayerDlg && frameRef.current?.GetBoard() && (
        <PcbOneLayerSelector
          board={frameRef.current.GetBoard()!}
          theme={theme}
          notAllowedLayersMask={oneLayerDlg.notAllowed}
          onSelect={(aLayer) => {
            setOneLayerDlg(null);
            oneLayerDlg.resolve(aLayer);
          }}
          onCancel={() => {
            setOneLayerDlg(null);
            oneLayerDlg.resolve(UNDEFINED_LAYER);
          }}
        />
      )}
      {zoneConvertDlg &&
        board &&
        frameRef.current &&
        zoneConvertDlg.kind === 'copper' &&
        (() => {
          const dlg = new DIALOG_COPPER_ZONE(
            frameRef.current!,
            null,
            zoneConvertDlg.zoneSettings,
            zoneConvertDlg.convertSettings,
          );
          return (
            <DialogCopperZones
              units={unitLabel}
              initial={dlg.TransferDataToWindow()}
              conversion={dlg.TransferConversionToWindow()}
              nets={netNamesByCode(frameRef.current?.GetBoard())}
              layers={copperLayerRows}
              onApply={(values, conversion) => {
                const res = dlg.TransferDataFromWindow(values, conversion);
                if (!res.ok) {
                  if (res.message) setInfoBarError(res.message);
                  return;
                }
                setZoneConvertDlg(null);
                zoneConvertDlg.resolve(true);
              }}
              onClose={() => {
                setZoneConvertDlg(null);
                zoneConvertDlg.resolve(false);
              }}
            />
          );
        })()}
      {zoneConvertDlg &&
        board &&
        frameRef.current &&
        zoneConvertDlg.kind === 'ruleArea' &&
        (() => {
          const dlg = new DIALOG_RULE_AREA_PROPERTIES(
            frameRef.current!,
            null,
            zoneConvertDlg.zoneSettings,
            zoneConvertDlg.convertSettings,
          );
          return (
            <DialogRuleAreaProperties
              units={unitLabel}
              initial={dlg.TransferDataToWindow()}
              conversion={dlg.TransferConversionToWindow()}
              layers={ruleAreaLayers}
              sources={collectPlacementSources(frameRef.current!.GetBoard()!)}
              onApply={(values, conversion) => {
                const res = dlg.TransferDataFromWindow(values, conversion);
                if (!res.ok) {
                  if (res.message) setInfoBarError(res.message);
                  return;
                }
                setZoneConvertDlg(null);
                zoneConvertDlg.resolve(true);
              }}
              onClose={() => {
                setZoneConvertDlg(null);
                zoneConvertDlg.resolve(false);
              }}
            />
          );
        })()}
      {/* TRANSITIONAL (#636 stage 3): DIALOG_NON_COPPER_ZONES_EDITOR has no
          window yet (its transfers are ported), so a non-copper conversion
          asks only the conversion settings and keeps the board's default
          zone settings on the active layer. */}
      {zoneConvertDlg &&
        zoneConvertDlg.kind === 'nonCopper' &&
        (() => {
          const dlg = new CONVERT_SETTINGS_DIALOG(zoneConvertDlg.convertSettings, {
            copyLineWidth: false,
            centerline: true,
            boundingHull: true,
          });
          return (
            <ConvertSettingsDialog
              dialog={dlg}
              units={unitLabel}
              onClose={(aOk) => {
                setZoneConvertDlg(null);
                zoneConvertDlg.resolve(aOk);
              }}
            />
          );
        })()}
      {statsOpen && frameRef.current?.GetBoard() && (
        <DialogBoardStatistics
          board={frameRef.current.GetBoard()!}
          unitsProvider={new UNITS_PROVIDER(pcbIUScale, unitsRef.current)}
          projectName={projectName ?? ''}
          boardName={fileName}
          onGenerateReport={saveReportFile}
          onClose={() => setStatsOpen(false)}
        />
      )}
      {unitEntryDlg && (
        <WX_UNIT_ENTRY_DIALOG
          caption={unitEntryDlg.title}
          label={unitEntryDlg.label}
          defaultValue={unitEntryDlg.value}
          units={unitLabel}
          iuScale={pcbIUScale}
          onResult={(v) => {
            unitEntryDlg.resolve(v);
            setUnitEntryDlg(null);
          }}
        />
      )}
      {dogboneDlg && (
        <WX_MULTI_ENTRY_DIALOG
          caption="Dogbone Corner Settings"
          entries={[
            { label: 'Arc radius:', value: { UNIT_BOUND: dogboneDlg.params.DogboneRadiusIU } },
            {
              label: 'Add slots in acute corners',
              tooltip: 'Add slots in acute corners to allow access to a cutter of the given radius',
              value: { CHECKBOX: dogboneDlg.params.AddSlots },
            },
          ]}
          units={unitLabel}
          iuScale={pcbIUScale}
          onResult={(r) => {
            dogboneDlg.resolve(
              r === null ? null : { DogboneRadiusIU: r[0] as number, AddSlots: r[1] as boolean },
            );
            setDogboneDlg(null);
          }}
        />
      )}
      {moveExactDlg && (
        <DialogMoveExact
          bbox={{
            minX: moveExactDlg.box.GetLeft(),
            minY: moveExactDlg.box.GetTop(),
            maxX: moveExactDlg.box.GetRight(),
            maxY: moveExactDlg.box.GetBottom(),
          }}
          defaultAnchor={ROTATION_ANCHOR_NAMES[moveExactDlg.values.rotationAnchor]}
          onApply={(v: MoveExactValues) => {
            moveExactDlg.resolve({
              translation: v.translation,
              rotation: new EDA_ANGLE(v.rotation, EDA_ANGLE_T.DEGREES_T),
              rotationAnchor: ROTATION_ANCHOR_NAMES.indexOf(v.anchor) as ROTATION_ANCHOR,
            });
            setMoveExactDlg(null);
          }}
          onClose={() => {
            moveExactDlg.resolve(null);
            setMoveExactDlg(null);
          }}
        />
      )}
      {filterDlg && (
        <DialogFilterSelection
          filter={filterDlg.opts}
          onChange={(next) => setFilterDlg({ ...filterDlg, opts: next })}
          onApply={() => {
            filterDlg.resolve(true, filterDlg.opts);
            setFilterDlg(null);
          }}
          onClose={() => {
            filterDlg.resolve(false);
            setFilterDlg(null);
          }}
        />
      )}
      {bookReporters.map((d) => (
        <DialogBookReporterModeless key={d.GetName()} dialog={d} />
      ))}
      {teardropsDlg && (
        <DialogGlobalEditTeardrops
          dialog={teardropsDlg}
          nets={
            new Map(
              [...(frameRef.current?.GetBoard()?.GetNetInfo().NetsByNetcode() ?? new Map())].map(
                ([code, net]) => [code, net.GetNetname()] as const,
              ),
            )
          }
          layers={LSET.AllCuMask(frameRef.current?.GetBoard()?.GetCopperLayerCount() ?? 2)
            .UIOrder()
            .map((l) => {
              const c = choiceOf(l);
              return { layer: l, label: c.label, swatch: c.swatch };
            })}
          onShowBoardSetup={() => {
            setTeardropsDlg(null);
            setBoardSetupPage('teardrops');
            setBoardSetupOpen(true);
          }}
          onApplied={onTeardropsApplied}
          onClose={() => setTeardropsDlg(null)}
        />
      )}
      {drcDialog?.shown && (
        <DialogDrc
          dialog={drcDialog.dialog}
          isSingle={!projectHasSchematic}
          canRefillZones
          rootRef={drcDialogRef}
        />
      )}
      {viewSwitcher && (
        <EDA_VIEW_SWITCHER
          items={viewSwitcher === 'presets' ? presetMRU : viewportMRU}
          heldKey={viewSwitcher === 'presets' ? 'Control' : 'Shift'}
          onResult={(i) => {
            const list = viewSwitcher === 'presets' ? presetMRU : viewportMRU;
            const kind = viewSwitcher;
            setViewSwitcher(null);
            if (i === null || i < 0 || i >= list.length) return;
            if (kind === 'presets') applyPreset(list[i]!);
            else onViewportChoice(list[i]!);
          }}
        />
      )}
      {saveNameAsk && (
        <WxTextEntryDialog
          caption={saveNameAsk === 'preset' ? 'Save Layer Preset' : 'Save Viewport'}
          message={saveNameAsk === 'preset' ? 'Layer preset name:' : 'Viewport name:'}
          onCancel={() => setSaveNameAsk(null)}
          onConfirm={(name) => {
            const kind = saveNameAsk;
            setSaveNameAsk(null);
            saveNamed(kind, name);
          }}
        />
      )}
      {netclassDlg && (
        <DialogAssignNetclass
          frame="pcb"
          netNames={netclassDlg.names}
          candidateNetNames={[...netclassDlg.candidates].sort()}
          netClasses={boardSetup.netClasses.classes
            .map((c) => c.name)
            .filter((n) => n !== 'Default')
            .sort()}
          // BOARD_EDITOR_CONTROL::AssignNetclass's previewer.
          onPreview={(names) => netclassDlg.preview(names)}
          onCancel={() => {
            setNetclassDlg(null);
            netclassDlg.resolve(false);
          }}
          onOk={(pattern, netClass) => {
            setNetclassDlg(null);
            // SetNetclassPatternAssignment, then SynchronizeNetsAndNetClasses
            // (commitBoardSetup does the sync).
            commitBoardSetup({
              ...boardSetupRef.current,
              netClasses: {
                ...boardSetupRef.current.netClasses,
                assignments: addNetclassAssignment(
                  boardSetupRef.current.netClasses.assignments,
                  pattern,
                  netClass,
                ),
              },
            });
            netclassDlg.resolve(true);
          }}
        />
      )}
      {saveFileDlg && (
        // wxFileDialog( this, title, Prj().GetProjectPath(), name, wildcard,
        //   wxFD_SAVE | wxFD_OVERWRITE_PROMPT ) and its customize hook.
        <SaveAsDialog
          title={saveFileDlg.title}
          initialName={saveFileDlg.name}
          filters={[saveFileDlg.wildcard]}
          {...(projectName
            ? { projectDir: `/${projectName}`, initialPath: `/${projectName}` }
            : {})}
          {...(saveFileDlg.checkbox
            ? {
                extra: (
                  <label className="ze-check">
                    <input
                      type="checkbox"
                      checked={saveFileDlg.checked}
                      onChange={(e) =>
                        setSaveFileDlg({ ...saveFileDlg, checked: e.target.checked })
                      }
                    />
                    {saveFileDlg.checkbox.label}
                  </label>
                ),
              }
            : {})}
          onDone={(path) => {
            const { resolve, checked } = saveFileDlg;
            setSaveFileDlg(null);
            if (path === null) {
              resolve(null);
              return;
            }
            // The name in the project, as the DRC report's save takes it.
            const prefix = projectName ? `/${projectName}/` : '/';
            const name = path.startsWith(prefix)
              ? path.slice(prefix.length)
              : path.slice(path.lastIndexOf('/') + 1);
            resolve({ path: name, checked });
          }}
        />
      )}
      {drcSaveReport && (
        // DIALOG_DRC::OnSaveReport (dialog_drc.cpp:1154-1156):
        // wxFileDialog( _( "Save Report File" ), Prj().GetProjectPath(),
        //   fn.GetFullName(), ReportFileWildcard() | JsonFileWildcard(), wxFD_SAVE ).
        <SaveAsDialog
          title="Save Report File"
          initialName={drcSaveReport.defaultName}
          filters={[reportFileWildcard(), jsonFileWildcard()]}
          {...(projectName
            ? { projectDir: `/${projectName}`, initialPath: `/${projectName}` }
            : {})}
          onDone={(path) => {
            drcSaveReport.resolve(path);
            setDrcSaveReport(null);
          }}
        />
      )}
      {zoneManager && frameRef.current && board && (
        <DialogZoneManager
          frame={{
            GetBoard: () => frameRef.current!.GetBoard()!,
            GetColorSettings: () => frameRef.current!.GetColorSettings(),
            FillZones: (b, z) => frameRef.current!.FillZones(b, z),
          }}
          units={unitLabel}
          nets={netNamesByCode(frameRef.current?.GetBoard())}
          createCanvas={createZonePreviewCanvas}
          displayError={DisplayErrorMessage}
          onResult={(ok, repour) => {
            zoneManager.resolve({ ok, repour });
            setZoneManager(null);
          }}
        />
      )}
      {mwTextEntry && (
        <WX_TEXT_ENTRY_DIALOG
          label={mwTextEntry.prompt}
          caption={mwTextEntry.caption}
          defaultValue={mwTextEntry.value}
          {...(mwTextEntry.validator ? { validator: mwTextEntry.validator } : {})}
          onResult={(value) => {
            mwTextEntry.resolve(value);
            setMwTextEntry(null);
          }}
        />
      )}
      {mwPolygonOpen && (
        <MwavePolygonalShapeDlg
          units={unitLabel}
          iuScale={pcbIUScale}
          onResult={(ok) => {
            mwPolygonOpen.resolve(ok);
            setMwPolygonOpen(null);
          }}
        />
      )}
      {drcTextEntry && (
        <WX_TEXT_ENTRY_DIALOG
          label=""
          caption={drcTextEntry.caption}
          defaultValue={drcTextEntry.initial}
          extraWidth
          onResult={(value) => {
            drcTextEntry.resolve(value);
            setDrcTextEntry(null);
          }}
        />
      )}
      {drcYesNoCancel && (
        <MessageDialogYesNoCancel
          caption="Delete All Markers"
          message="Delete exclusions too?"
          icon="question"
          defaultButton="yes"
          labels={{ yes: 'Errors and Warnings Only', no: 'Errors, Warnings and Exclusions' }}
          onResult={(r) => {
            drcYesNoCancel.resolve(r);
            setDrcYesNoCancel(null);
          }}
        />
      )}
      {boardSetupOpen && (
        <DialogBoardSetup
          units={unitLabel}
          board={frameRef.current?.GetBoard() ?? null}
          value={boardSetup}
          initialPage={boardSetupPage}
          onOk={(next) => {
            commitBoardSetup(next);
            setBoardSetupOpen(false);
          }}
          onClose={() => setBoardSetupOpen(false)}
        />
      )}
      {/* POSITION_RELATIVE_TOOL's DIALOG_POSITION_RELATIVE: modeless, in the
          same host as Find; it draws itself only while it is shown. */}
      {posRelDialog && <DialogPositionRelativeModeless dialog={posRelDialog} />}
      {exchangeDlg && (
        <DialogExchangeFootprints
          dialog={exchangeDlg}
          onBrowse={(aPreselect) =>
            drcWindowRef.current?.selectFootprintFromChooser(aPreselect) ?? Promise.resolve(null)
          }
          onClose={() => setExchangeDlg(null)}
        />
      )}
      {editTgDlg && frameRef.current?.GetBoard() && (
        <DialogGlobalEditTextAndGraphics
          dialog={editTgDlg}
          layers={LSET.AllLayersMask()
            .UIOrder()
            .filter((l) => frameRef.current!.GetBoard()!.IsLayerEnabled(l))
            .map((l) => {
              const c = choiceOf(l);
              return { layer: l, label: c.label, swatch: c.swatch };
            })}
          defaults={layerDefaultsRows(frameRef.current)}
          onClose={() => setEditTgDlg(null)}
        />
      )}
      {editTvDlg && (
        <DialogGlobalEditTracksAndVias
          dialog={editTvDlg}
          nets={
            new Map(
              [...(frameRef.current?.GetBoard()?.GetNetInfo().NetsByNetcode() ?? new Map())].map(
                ([code, net]) => [code, net.GetNetname()] as const,
              ),
            )
          }
          layers={LSET.AllCuMask(frameRef.current?.GetBoard()?.GetCopperLayerCount() ?? 2)
            .UIOrder()
            .map((l) => {
              const c = choiceOf(l);
              return { layer: l, label: c.label, swatch: c.swatch };
            })}
          onClose={() => setEditTvDlg(null)}
        />
      )}
      {globalDelDlg && (
        <DialogGlobalDeletion
          dialog={globalDelDlg.dialog}
          onResult={(aOk) => {
            setGlobalDelDlg(null);
            globalDelDlg.resolve(aOk);
          }}
        />
      )}
      {unusedPadsDlg && (
        <DialogUnusedPadLayers dialog={unusedPadsDlg} onClose={() => setUnusedPadsDlg(null)} />
      )}
      {cleanupGfxDlg && (
        <DialogCleanupGraphics dialog={cleanupGfxDlg} onClose={() => setCleanupGfxDlg(null)} />
      )}
      {cleanupDlg && (
        <DialogCleanupTracksAndVias
          dialog={cleanupDlg}
          nets={
            new Map(
              [...(frameRef.current?.GetBoard()?.GetNetInfo().NetsByNetcode() ?? new Map())].map(
                ([code, net]) => [code, net.GetNetname()] as const,
              ),
            )
          }
          layers={LSET.AllCuMask(frameRef.current?.GetBoard()?.GetCopperLayerCount() ?? 2)
            .UIOrder()
            .map((l) => {
              const c = choiceOf(l);
              return { layer: l, label: c.label, swatch: c.swatch };
            })}
          onClose={() => setCleanupDlg(null)}
        />
      )}
      {swapLayersDlg && board && (
        <DialogSwapLayers
          dialog={swapLayersDlg.dialog}
          copperLayerCount={frameRef.current?.GetBoard()?.GetCopperLayerCount() ?? 2}
          onResult={(aOk) => {
            setSwapLayersDlg(null);
            swapLayersDlg.resolve(aOk);
          }}
        />
      )}
      {pushPadDlg && (
        <DialogPushPadProperties
          dialog={pushPadDlg.dialog}
          onResult={(aReturnCode) => {
            setPushPadDlg(null);
            pushPadDlg.resolve(aReturnCode);
          }}
        />
      )}
      {enumPadsDlg && (
        <DialogEnumPads
          dialog={enumPadsDlg.dialog}
          onResult={(aOk) => {
            setEnumPadsDlg(null);
            enumPadsDlg.resolve(aOk);
          }}
        />
      )}
      {padTableDlg && (
        <DialogFpEditPadTable dialog={padTableDlg} onClose={() => setPadTableDlg(null)} />
      )}
      {offsetDlg && (
        <DialogOffsetItem
          dialog={offsetDlg.dialog}
          onResult={(aOk) => {
            setOffsetDlg(null);
            offsetDlg.resolve(aOk);
          }}
        />
      )}
      {findDlg && <DialogPcbFind dialog={findDlg} onClose={() => setFindDlg(null)} />}

      {/* EDA_DRAW_FRAME hosts a message panel above pcbnew's 8-field status bar. */}
      <MsgPanel items={messagePanelItems} testId="pcb-message-panel" />

      {/* pcbnew's 8-field KISTATUSBAR — the pane order and widths are
          KiStatusBar's, shared with every other draw frame. */}
      <KiStatusBar
        testIds={{
          message: 'pcb-status-msg',
          coords: 'pcb-absolute-coords',
          deltas: 'pcb-relative-coords',
          tool: 'pcb-tool-msg',
          constraint: 'pcb-constraint-msg',
        }}
        fields={{
          zoom: zoomMsg(zoomFactorForScale(scale, window.devicePixelRatio || 1)),
          coords: <span ref={statusReadout.coordsRef} />,
          deltas: <span ref={statusReadout.deltasRef} />,
          grid: gridText,
          units: unitsMsg(unitLabel),
          tool: toolMsg,
          constraint: constraintMsg,
        }}
      />
    </div>
  );
}
