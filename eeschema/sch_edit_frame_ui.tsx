// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import type { SCH_TEXT } from './sch_text.js';
import type { SCH_TEXTBOX } from './sch_textbox.js';
import type { SCH_SHEET_PIN } from './sch_sheet_pin.js';
import type { SCH_LABEL_BASE } from './sch_label.js';
import type { SCH_COMMIT } from './sch_commit.js';
import type { SCH_FIELD } from './sch_field.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import type { SCH_TABLE } from './sch_table.js';
import type { SCH_TABLECELL } from './sch_tablecell.js';
import type { SHEET_PROPERTIES_RESULT } from './sch_edit_frame.js';
import type { SCH_BITMAP } from './sch_bitmap.js';
import type { SCH_SHAPE } from './sch_shape.js';
import {
  DIALOG_WIRE_BUS_PROPERTIES,
  type WIRE_BUS_DIALOG_VALUES,
} from './dialogs/dialog_wire_bus_properties.js';
import type { SCH_ITEM } from './sch_item.js';
import { DIALOG_JUNCTION_PROPS } from './dialogs/dialog_junction_props.js';
import type { SCH_JUNCTION } from './sch_junction.js';
import { color4dToItemColor, itemColorToColor4d } from './dialogs/item_color.js';
import { type ChooserFilter, type OpenedFile, WxFileDialog } from '@ziroeda/common/wx/filedlg.js';
import { WxTextEntryDialog } from '@ziroeda/common/wx/textdlg.js';
import { wxFD_FILE_MUST_EXIST, wxFD_OPEN, wxFD_SAVE } from '@ziroeda/common/wx/defs.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { type KICAD_MESSAGE_DIALOG_ARG, ShowKicadMessageDialog } from '@ziroeda/common/confirm.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/template_fieldnames.js';
import type { PICKED_SYMBOL } from './sch_screen.js';
import type { SYMBOL_LIBRARY_FILTER } from './symbol_library_common.js';
import type { SchScriptApi } from './sch_script_api.js';
import { GetAssociatedDocument } from '@ziroeda/common/eda_doc.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { Priority } from './connectivity/nets.js';
import type { Vec2 } from '@ziroeda/kimath';
import {
  ensureFileExtension,
  iuToMM,
  KICAD_SCHEMATIC_FILE_EXTENSION,
  mmToIU,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  type ReportLine,
  SCH_IU_PER_MM,
  type WksSheet,
} from '@ziroeda/common';
import { resolveActiveSheet, readSheetRef, writeSheetRefText } from '@ziroeda/common';
import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import { parse } from '@ziroeda/sexpr';
import {
  applySchematicPatch,
  diffSchematic,
  schematicPatchIsEmpty,
  type SchematicPatch,
} from './browser/sch_diff.js';
import type {
  PeerRole,
  PresenceInfo,
  ProjectSyncTransport,
} from './browser/project_sync_transport.js';
import { ReadOnlyNotice } from '@ziroeda/common/widgets/wx_infobar.js';
import {
  type ArcEditMode,
  incrementArcEditMode,
  SPIN_ANGLE,
  directiveNetclassAssignments,
  ruleAreaNetclassAssignments,
  setAttribute,
  autoplaceFields,
  attributeIsSet,
  type Attribute,
  type LabelSpin,
  readSchematic,
  serializeSchematic,
  readSymbolLib,
  serializeSymbolLib,
  type ProjectStep,
  type ProjectEdit,
  deleteItems,
  computeNetlist,
  withCleanup,
  refId,
  copySelectionText,
  parsePastedText,
  boxSelect,
  selectionBBox,
  emptyBBox,
  type BBox,
  isEmpty,
  instanceKey,
  getSheetPageNumber,
  getRootPageNumber,
  setSheetPageNumberCommand,
  setRootPageNumberCommand,
  setPageSettingsCommand,
  getPageSettings,
  bulkEditFieldsCommand,
  bulkEditSymbolAttributesCommand,
  composeCommands,
  type SymbolAttrEdit,
  addToGroupCommand,
  removeFromGroupCommand,
  canAddToGroup,
  canRemoveFromGroup,
  selectionHasGroup,
  setSymbolsLockedCommand,
  expandSelectionToGroups,
  getNode,
  selectConnection,
  planNetclassAssignment,
  selectedNets,
  addNetclassAssignment,
  applySelectionFilter,
  clickTarget,
  defaultSelectionFilter,
  type SelectionFilterOptions,
  // SCH_SELECTION_TOOL::RequestSelection's aScanTypes tables: what each command
  // will pick up from under the cursor, and what it trims a selection down to.
  AnyItems,
  AttributeItems,
  RotatableItems,
  SheetItems,
  SymbolItems,
  type ScanTypes,
  getSelectedItemsAsText,
  type PasteMode,
  type PasteOptions,
  type PageSettings,
  findMatches,
  replaceCommand,
  defaultSearchData,
  annotateHierarchy,
  annotateSymbols,
  defaultAnnotateOptions,
  incrementAnnotations,
  globalEdit,
  symbolLibIdRows,
  orphanCandidates,
  libIdChangeCommand,
  annotationReport,
  checkAnnotation,
  clearAnnotationCommand,
  clearAnnotationReport,
  setSymbolsCommand,
  subReference,
  type AnnotateDiff,
  type AnnotateSheet,
  type SchSearchData,
  type AnnotateOptions,
  type ErcRunOptions,
  type ExternalPin,
  type ExternalSymbol,
  type ExternalLabel,
  computeHierarchyNetlist,
  enumeratePins,
  runErc,
  runErcSteps,
  ERC_ITEMS,
  ercExclusionKey,
  type LibPin,
  ercParentId,
  electricalPinTypeGetText,
  pinShapeGetText,
  symbolEditorRequest,
  type SymbolEditorTarget,
  saveSymbolToSchematic,
  buildNetNavigator,
  buildNetNavigatorHierarchy,
  netNavigatorOrder,
  stepNetItem,
  type PcbFootprintData,
  syncPinFromLabel,
  syncLabelsFromPin,
  deleteSyncLabels,
  deleteSyncPins,
  syncPlacementFor,
  type SyncPlacement,
  buildSheetTree,
  repairPageNumbersOnLoad,
  sheetFile,
  findRootFile,
  addItems,
  swapPinsCommand,
  sharedPinSwapMessage,
  busUnfoldMembers,
  unfoldBus,
  busForUnfolding,
  swapItems,
  repeatItems,
  makeImage,
  ProjectHistory,
  type Schematic,
  type SchImage,
  type LibSymbol,
  type SchSymbol,
  type EditCommand,
  type LabelShape,
  type PastePayload,
  type ErcViolation,
  type SheetTreeNode,
  type ItemRef,
  describeItem,
} from './index.js';
import type { PendingLabel } from './sch_draw_panel.js';
import {
  DIALOG_LABEL_PROPERTIES,
  DialogLabelProperties,
  type LABEL_DIALOG_VALUES,
} from './dialogs/dialog_label_properties.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import {
  DIALOG_TEXT_PROPERTIES,
  DialogTextProperties,
  type TextPropsInitial,
} from './dialogs/dialog_text_properties.js';
import {
  DIALOG_SYMBOL_PROPERTIES,
  DialogSymbolProperties,
  type SYMBOL_DIALOG_VALUES,
} from './dialogs/dialog_symbol_properties.js';
import { ErcDialog, type ErcDialogNav } from './dialogs/dialog_erc.js';
import type { PickedSymbol, SymbolChooserResult } from './picksymbol.js';
import { repairSourceLibs } from './browser/repair_source.js';
import {
  findRescues,
  rescueDocumentCommand,
  rescueLibraryFileName,
  rescueLibraryNickname,
  rescuedDefinition,
  type RescueCandidate,
} from './project_rescue.js';
import type { RescueInstance } from './project_rescue.js';
import {
  legacyCacheFileNames,
  readLegacySymbolLibrary,
} from './sch_io/kicad_legacy/sch_io_kicad_legacy_lib_cache.js';
import { legacySchLibs } from './project_sch.js';
import {
  legacyLibrarySymbols,
  legacyRootFile,
  readLegacyProject,
} from './sch_io/kicad_legacy/sch_io_kicad_legacy.js';
import {
  projectSymbolLibraries,
  projectSymLibTable,
  projectSymLibTablePath,
  serializeSymLibTable,
} from './project_sym_lib_table.js';
import {
  projectFpLibTablePath,
  serializeFpLibTable,
  type FpLibRow,
} from '@ziroeda/common/fp_lib_table.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import { kicadSchematicWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import { RIGHT_TOOLBAR_COMMANDS, SCH_DEFAULT_TOOLBARS } from './toolbars_sch_editor.js';
import { MenuBar, ContextMenu, type Menu } from '@ziroeda/common/tool/action_menu_bar.js';
import { clearHoverSelection, requestSelection, type HoverSelection } from './hover_selection.js';
import { buildMenus } from './menubar.js';
import {
  CONFIRMATION_CAPTION,
  LOAD_REPAIRED_MESSAGE,
  revertPromptMessage,
  savedFileMessage,
} from './files-io.js';
import { MessageDialogOk, MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import { INFO_CAPTION } from '@ziroeda/common/confirm_types.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '@ziroeda/common/tool/action_menu_hotkeys.js';
import { wasBrowserSuppressed, type FocusLike } from '@ziroeda/common/browser_hotkeys.js';
import { DialogAssignNetclass } from '@ziroeda/common/dialogs/dialog_assign_netclass.js';
import { showHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import {
  DIALOG_TABLECELL_PROPERTIES,
  DialogTableCellProperties,
  type TABLECELL_DIALOG_VALUES,
} from './dialogs/dialog_tablecell_properties.js';
import {
  SchNavigateTool,
  flattenHierarchy,
  parentPath,
  type SheetRef,
} from './tools/sch_navigate_tool.js';
import { DialogSchFind } from './dialogs/dialog_sch_find.js';
import {
  DialogIncrementAnnotations,
  type IncrementAnnotationsResult,
} from './dialogs/dialog_increment_annotations.js';
import {
  DialogGlobalEditTextAndGraphics,
  type GlobalEditResult,
} from './dialogs/dialog_global_edit_text_and_graphics.js';
import { DIALOG_CHANGE_SYMBOLS, DialogChangeSymbols } from './dialogs/dialog_change_symbols.js';
import type { DIALOG_CHANGE_SYMBOLS_MODE } from './tools/sch_edit_tool.js';
import { DialogEditSymbolsLibId } from './dialogs/dialog_edit_symbols_libid.js';
import { DialogAnnotate, type AnnotateRun } from './dialogs/dialog_annotate.js';
import { DialogLineProperties } from './dialogs/dialog_line_properties.js';
import { DialogEeschemaPageSettings } from './dialogs/dialog_eeschema_page_settings.js';
import {
  pageSettingsValue,
  toPaperToken,
  type PageExportFlags,
  type PageSettingsValue,
} from '@ziroeda/common/dialogs/dialog_page_settings.js';
// `DIALOG_PASTE_SPECIAL` is a `common/dialogs/` dialog upstream, built by
// eeschema AND pcbnew, so it is one module here too rather than a copy under
// this editor's own `dialogs/`. `SCH_EDITOR_CONTROL::Paste` supplies the two
// things that differ: the mode it opens on, and no `aDefaultRef`.
import {
  DialogPasteSpecial,
  type PasteSpecialMode,
} from '@ziroeda/common/dialogs/dialog_paste_special.js';
import {
  DIALOG_SHEET_PROPERTIES,
  DialogSheetProperties,
  type SHEET_DIALOG_VALUES,
} from './dialogs/dialog_sheet_properties.js';
import { useKiDialog } from '@ziroeda/common/kidialog.js';
import {
  DIALOG_SHAPE_PROPERTIES,
  DialogShapeProperties,
  type SHAPE_DIALOG_VALUES,
} from './dialogs/dialog_shape_properties.js';
import {
  DIALOG_IMAGE_PROPERTIES,
  DialogImageProperties,
} from './dialogs/dialog_image_properties.js';
import {
  DIALOG_FIELD_PROPERTIES,
  DialogFieldProperties,
  type FIELD_DIALOG_VALUES,
} from './dialogs/dialog_field_properties.js';
import {
  DIALOG_SHEET_PIN_PROPERTIES,
  DialogSheetPinProperties,
  type SHEET_PIN_DIALOG_VALUES,
} from './dialogs/dialog_sheet_pin_properties.js';
import {
  DialogSchematicSetup,
  defaultSchematicSetup,
  type SchematicSetup,
} from './dialogs/dialog_schematic_setup.js';
import { LoadProjectSettings } from './eeschema_config.js';
import { SelectionFilterPanel } from './widgets/panel_sch_selection_filter_ui.js';
import { gridSizeToIU } from './eeschema_settings.js';
import {
  findProjectPro,
  readSchematicSetup,
  writeEquivalenceFilesText,
  writeSchematicSetupText,
} from './project_settings.js';
import { IU_PER_MILS, resolveEffectiveNetClass, subpartSettings } from './schematic_settings.js';
import { netClassHumanReadableName } from '@ziroeda/common/project/net_settings.js';
import type { PdfNetInfo } from './sch_plotter.js';
import type { Netlist } from './connectivity/nets.js';
import { DEFAULT_WIRE_WIDTH } from './sch_painter.js';
import { computeNetClassOverrides } from './net_overrides.js';
import {
  REFDES_TRACKER,
  buildPageRefsMap,
  connectionName,
  equivalentBusNames,
  intersheetRefsText,
  addEmbeddedFile,
  embeddedFilesCommand,
  getEmbeddedFileData,
  listEmbeddedFiles,
  removeEmbeddedFile,
  setEmbedFonts,
  type IntersheetRefsConfig,
  type IntersheetSheet,
} from './index.js';
import { schematicTextVarResolver } from './schematic.js';
import { ResolveShownText, type TextVarResolverFn } from '@ziroeda/common/common.js';
import { DialogExportNetlist } from './dialogs/dialog_export_netlist.js';
import { DialogSymbolFieldsTable, type FieldsEdits } from './dialogs/dialog_symbol_fields_table.js';
import { DialogPrint } from './printing/dialog_print.js';
import { SCH_PRINTOUT } from './printing/sch_printout.js';
import { wxPrinter } from '@ziroeda/common/wx/printer.js';
import { DialogPlot, type PlotRequest } from './dialogs/dialog_plot_schematic.js';
import {
  downloadBlob,
  plotPng,
  plotSvg,
  plotPdf,
  plotPdfSheets,
  type PdfPlotSheet,
  plotDxf,
  plotPs,
  pageIU,
  renderSheetToCanvas,
  type PlotOpts,
  type PlotSink,
} from './sch_plotter.js';
import { DEFAULT_SETUP } from '@ziroeda/common/drawing_sheet/types.js';
import { BUILTIN_THEMES } from './sch_render_settings.js';
import { ProgressDialog, nextPaint } from '@ziroeda/common/widgets/wx_progress_reporters.js';
import type { ProgressSnapshot } from '@ziroeda/common/widgets/progress_reporter_snapshot.js';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import type { PrefsPageId } from '@ziroeda/common/frame_type.js';
import type { EESCHEMA_APP } from './browser/eeschema_app.js';
import {
  fastGridActionForKey,
  fastGridIndex,
  gridFeedback,
  type FastGridAction,
} from '@ziroeda/common/settings/grid_settings_ui.js';
import { useHotkeyCyclePopup } from '@ziroeda/common/dialogs/hotkey_cycle_popup_ui.js';
import { resolveTemplateFieldnames } from '@ziroeda/common/template_fieldnames.js';
import type { RenderOpts } from './sch_render_settings.js';
import type { InputPrefs } from '@ziroeda/common/ui/view_controls.js';
import { LiveSchPropertiesPanel } from './widgets/sch_properties_panel_ui.js';
import { SearchPanel } from './widgets/sch_search_pane.js';
import { NetNavigatorPanel } from './widgets/net_navigator_panel.js';
import { DialogUpdateFromPcb } from './dialogs/dialog_update_from_pcb.js';
import { DialogSyncSheetPins, type SyncSheetEntry } from './dialogs/dialog_sync_sheet_pins.js';
import {
  DIALOG_TABLE_PROPERTIES,
  DialogTableProperties,
  type SCH_TABLE_DIALOG_VALUES,
} from './dialogs/dialog_table_properties.js';
import { DialogImportGfx } from './import_gfx/dialog_import_gfx_sch.js';
import { KISTATUSBAR_FIELDS, KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import { MsgPanel, type MsgPanelItem } from '@ziroeda/common/widgets/msgpanel_ui.js';
import {
  gridMsg,
  messageTextFromValue,
  type StatusUnits,
  unitsMsg,
} from '@ziroeda/common/widgets/kistatusbar_format.js';
import { formatTitle, useDocumentTitle } from '@ziroeda/common/use_document_title.js';
import { useLiveState } from '@ziroeda/common/use_live_state.js';
import { withSaveEnablement } from '@ziroeda/common/save_enablement.js';
import {
  fileBaseName,
  pathHumanReadable,
  SCH_FRAME_NAME,
  schFrameTitle,
} from './sch_edit_frame.js';
import {
  SCH_BOTTOM_DOCK,
  SCH_LEFT_PANE_ADD_ORDER,
  schDockPosFrom,
  schLeftDockLayout,
  schPaneGrows,
  schSelectionFilterShown,
  type SchDockPos,
  type SchLeftPane,
} from './sch_edit_frame.js';
import { DockSash } from '@ziroeda/common/widgets/wx_aui_sash.js';
import { loadOutlineFontsFor } from '@ziroeda/common/font/outline_fonts.js';
import { useUnsavedGuard } from '@ziroeda/common/use_unsaved_guard.js';
import '@ziroeda/common/widgets/shell.css';
import { schSymbolLibraryName } from './index.js';
import { busJunctionIds as busJunctionIdsOf } from './connectivity/bus.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { applyToggle, DEFAULT_TOGGLES } from './toggles.js';
import { LIVE_SCHEMATIC_MIRROR, liveScreensToRecords } from './sch_record_bridge.js';
import { createSchDrawPanel } from './sch_canvas.js';
import type { SCH_DRAW_PANEL } from './sch_draw_panel.js';
import { loadBitmapFontImage } from '@ziroeda/common/gal/gal_window.js';
import { type SCH_SCREEN, SCH_SCREENS } from './sch_screen.js';
import type { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { actionMenuItems } from '@ziroeda/common/tool/action_menu_popup.js';
import { wxMenuEvent, wxMenuEventType } from '@ziroeda/common/wx/menu.js';
import { MEMORY_FILESYSTEM, wxFileExists, wxMountFileSystem } from '@ziroeda/common/wx/filefn.js';
import { schToolbarAction } from './toolbars_sch_editor.js';
import { symbolLibraryUri } from './cross-probing.js';

// What KiCad writes for File > New Schematic: an empty sheet on A4 paper.
// Launching the editor without a project starts here (no bundled demo).

/** A PICKED_SYMBOL as the chooser's history rows take it. */
function pickedToChooser(aPicked: PICKED_SYMBOL): PickedSymbol {
  return {
    libId: aPicked.LibId.Format(),
    unit: aPicked.Unit,
    fields: aPicked.Fields.map(([id, value]) => [GetCanonicalFieldName(id), value]),
  };
}

/** The chooser's answer as PickSymbolFromLibrary returns it (picksymbol.cpp). */
function chooserToPicked(aResult: SymbolChooserResult): PICKED_SYMBOL {
  const fields: [FIELD_T, string][] = [];
  for (const [name, value] of aResult.fields) {
    const id = [
      FIELD_T.REFERENCE,
      FIELD_T.VALUE,
      FIELD_T.FOOTPRINT,
      FIELD_T.DATASHEET,
      FIELD_T.DESCRIPTION,
    ].find((f) => GetCanonicalFieldName(f) === name);
    if (id !== undefined) fields.push([id, value]);
  }
  const libId = new LIB_ID();
  libId.Parse(aResult.symbol.libId);
  return {
    LibId: libId,
    Unit: aResult.unit,
    Convert: 1,
    KeepSymbol: aResult.keepSymbol,
    PlaceAllUnits: aResult.placeAllUnits,
    Fields: fields,
  };
}

/** Where a file the picker hands back is readable when no mount holds its path. */
const PICKED_FILES_DIR = '/.picked-files';
let s_pickedFiles: MEMORY_FILESYSTEM | null = null;

/**
 * `wxFileDialog::GetPath()` for a file the project picker returned: its own path when a mounted
 * file system already has it (a project file), else its bytes written to the picked-files folder,
 * so KiCad's file reads open it.
 */
function pickedFilePath(aFile: OpenedFile): string {
  if (wxFileExists(aFile.path)) return aFile.path;
  if (!s_pickedFiles) {
    s_pickedFiles = new MEMORY_FILESYSTEM();
    wxMountFileSystem(PICKED_FILES_DIR, s_pickedFiles);
  }
  const name = aFile.path.replace(/^.*\//, '');
  s_pickedFiles.Write(name, aFile.bytes);
  return `${PICKED_FILES_DIR}/${name}`;
}

const EMPTY_SCH =
  '(kicad_sch (version 20231120) (generator "ziroeda") (paper "A4")\n  (lib_symbols)\n)\n';

const ATTRIBUTE_IDS: Record<string, Attribute> = {
  attrSim: 'sim',
  attrBom: 'bom',
  attrBoard: 'board',
  attrPosFiles: 'posFiles',
  attrDnp: 'dnp',
};

const SETTINGS_TOGGLES = new Set([
  'toggleGrid',
  'toggleGridOverrides',
  'toggleHiddenPins',
  'toggleHiddenFields',
  'crosshairSmall',
  'crosshairFull',
  'crosshair45',
  'lineModeFree',
  'lineMode90',
  'lineMode45',
  'annotateAuto',
]);

/** ERC_TESTER::TestDuplicateSheetNames, the guard the highlight tools run
 *  before picking (sheet names compare case-insensitively upstream). */
/**
 * The Page Settings dialog's seed value for a document.
 *
 * `TransferDataToWindow` builds it from `m_parent->GetPageSettings()` and
 * `m_parent->GetTitleBlock()` (dialog_page_settings.cpp:120, :72); ours has to
 * split the stored `(paper …)` token into PAGE_INFO's three pieces first.
 */
function pageSettingsSeed(sch: Schematic): PageSettingsValue {
  const s = getPageSettings(sch);
  return pageSettingsValue(s.paper, s);
}

/**
 * `AUTOPLACER::getDrawableArea`: the page inside the drawing sheet's margins.
 * Autoplace treats a field box that would fall outside it as colliding, so a
 * symbol near the edge keeps its fields on the page.
 *
 * Resolving a paper name to a size belongs to the application rather than the
 * model, which is why the engine takes the rectangle instead of computing it.
 * The margins are the drawing sheet's; a project with a custom `.kicad_wks`
 * would take them from its setup, and the built-in sheet's 10 mm is used until
 * loading one is wired through.
 */
function drawableArea(sch: Schematic): BBox {
  const page = pageIU(sch);
  const mm = (v: number): number => mmToIU(v);
  return {
    minX: mm(DEFAULT_SETUP.leftMargin),
    minY: mm(DEFAULT_SETUP.topMargin),
    maxX: page.w - mm(DEFAULT_SETUP.rightMargin),
    maxY: page.h - mm(DEFAULT_SETUP.bottomMargin),
  };
}

// The "Current Tool" status-bar field (EDA_DRAW_FRAME::DisplayToolMsg):
// TOOLS_HOLDER::PushTool shows the active action's FriendlyName; the idle
// selection tool reads "Select item(s)". Names from sch_actions.cpp /
// actions.cpp FriendlyName().
const SCH_TOOL_MSGS: Record<string, string> = {
  select: 'Select item(s)',
  selectLasso: 'Select item(s)',
  highlightNet: 'Highlight Nets',
  placeSymbol: 'Place Symbols',
  placePower: 'Place Power Symbols',
  drawWire: 'Draw Wires',
  drawBus: 'Draw Buses',
  busEntry: 'Place Wire to Bus Entries',
  noConnect: 'Place/Remove No Connect Flags',
  junction: 'Place Junctions',
  placeLabel: 'Place Net Labels',
  placeClassLabel: 'Place Directive Labels',
  placeGlobalLabel: 'Place Global Labels',
  placeHierLabel: 'Place Hierarchical Labels',
  drawSheet: 'Draw Hierarchical Sheets',
  sheetPin: 'Place Pins from Sheet',
  placeText: 'Draw Text',
  textBox: 'Draw Text Boxes',
  table: 'Draw Tables',
  rectangle: 'Draw Rectangles',
  circle: 'Draw Circles',
  arc: 'Draw Arcs',
  bezier: 'Draw Bezier Curve',
  lines: 'Draw Lines',
  image: 'Place Images',
  delete: 'Interactive Delete Tool',
  zoomTool: 'Zoom to Selection Area',
};

/** A file picked from disk for a project open. */
/**
 * Below this many footprint libraries the served index is a bundled stub, not a
 * library table, ERC's footprint-link test stands down rather than reporting
 * every standard KiCad library as missing.
 */
const MIN_FOOTPRINT_LIBS = 10;

export interface PickedFile {
  name: string;
  text: string;
  /** Binary payload for non-text files (plot outputs: PNG/PDF, …). When set,
   *  `text` is empty and the file is stored/downloaded from these bytes. */
  bytes?: Uint8Array;
}

const DEFAULT_FILE = 'untitled.kicad_sch';

// The chooser's "Recently Used" group persists across dialog openings for the
// session (sch_drawing_tools.cpp s_SymbolHistoryList / s_PowerHistoryList).
const sSymbolHistoryList: PickedSymbol[] = [];

/** A token's value from a resolver, or '' when it does not answer. */
function resolveToken(aResolver: TextVarResolverFn | undefined, aName: string): string {
  const token = { value: aName };
  return aResolver?.(token) ? token.value : '';
}

export function SchematicEditor({
  app,
  onExitToHome,
  onShowPcb,
  hasBoard,
  onEditSymbolInEditor,
  editedSymbol,
  readOnlyNotice,
  readOnly,
  readBoardFootprints,
  autosaveActive,
  onShowSymbolEditor,
  onShowFootprintEditor,
  onShowCalculator,
  initialProject,
  initialFile,
  placeRequest,
  onProjectChange,
  onPersistFiles,
  onSaveFiles,
  onRevert,
  onOutputFile,
  registerAutosaveFlush,
  openNonce,
  shown = true,
  extraSheetFiles,
  projectName,
  rootPro,
  kiway,
  registerScriptApi,
}: {
  /** Lets a host script this window while it is shown (the AI pane): read the
   *  sheet on screen and run one undoable command on it. Returns the
   *  unregister function. */
  registerScriptApi?: (api: SchScriptApi) => () => void;
  /** What the program gives this window (`EESCHEMA_APP`, `eeschema_app.ts`):
   *  settings, the app's dialogs and canvas, the hosted libraries, the other
   *  KIWAY players. Built by designer's `useEeschemaApp()`. */
  app: EESCHEMA_APP;
  onExitToHome: () => void;
  onShowPcb?: () => void;
  /** Whether the project has a board, which Tools > Update PCB from Schematic
   *  (F8) needs here: upstream would create one, this editor does not. */
  hasBoard?: boolean;
  /** SCH_EDIT_TOOL's Edit with Symbol Editor (Ctrl+E): hand the placement's
   *  symbol to the symbol editor and switch to it. */
  onEditSymbolInEditor?: (req: {
    symbol: LibSymbol;
    unit: number;
    bodyStyle: number;
    targetId: string;
  }) => void;
  /** The edited symbol coming back (SaveSymbolToSchematic). Re-sent with a
   *  fresh nonce so a second save of the same symbol still applies. */
  editedSymbol?: { symbol: LibSymbol; targetId: string; nonce: number } | null;
  /** Tools > Update Schematic from PCB: the board's footprints, read on demand
   *  so a project with no board simply has no entry. Resolving to null means the
   *  board could not be read, which the caller reports. Asynchronous because the
   *  host loads the board reader on use, keeping it out of the entry chunk. */
  readBoardFootprints?: () => Promise<PcbFootprintData[] | null>;
  /** A strip to show above the canvas, e.g. "this demo is not being saved". */
  readOnlyNotice?: JSX.Element | null;
  /**
   * `screen->IsReadOnly()` — the `[Read Only]` half of the frame title
   * (sch_edit_frame.cpp:1849-1850). A browser has no per-file writable bit;
   * the condition that stands in for one here is the demo project, which is
   * exactly what {@link readOnlyNotice} already announces above the canvas.
   */
  readOnly?: boolean;
  /**
   * Whether edits reach storage at all. False for a bare `.kicad_sch` opened
   * without a project, or when IndexedDB is unavailable — in which case nothing
   * is written until Save, and leaving the page is worth a prompt.
   */
  autosaveActive?: boolean;
  /** Open the Symbol Editor (the top toolbar's `symbolEditor` button). */
  onShowSymbolEditor?: () => void;
  /** Open the Footprint Editor (the top toolbar's `footprintEditor` button). */
  onShowFootprintEditor?: () => void;
  /** Open the Calculator Tools (Tools menu). */
  onShowCalculator?: () => void;
  initialProject?: PickedFile[] | null;
  initialFile?: string | null;
  /** A symbol handed over by the Symbol Editor's "Add symbol to schematic": attach it to the cursor. */
  placeRequest?: { lib: LibSymbol; nonce: number } | null;
  /** Autosave hook: called (debounced) with the serialized sheets after edits. */
  /**
   * Hand edited sheets to the app, which writes them locally and decides
   * whether the account hears about them.
   *
   * `push` is false for a change that arrived from another peer: it is still
   * saved on this machine, and still must not be committed to the cloud from
   * here. Absent means true, so every existing caller keeps its behaviour.
   */
  onProjectChange?: (files: PickedFile[], opts?: { push?: boolean }) => void;
  /** Persist project files immediately (no debounce), used for the drawing-sheet
   *  reference in .kicad_pro so it survives a "go back and reopen". */
  onPersistFiles?: (files: PickedFile[]) => void;
  /**
   * The EXPLICIT Save. Writes the files and then records a Local History point
   * (`LOCAL_HISTORY::CommitSnapshot`, which upstream runs from the same place a
   * save does). Distinct from `onPersistFiles` because that one is also used
   * for incidental writes — the drawing-sheet reference, sheet bookkeeping —
   * and none of those is a point a user chose to be able to come back to.
   */
  onSaveFiles?: (files: PickedFile[]) => Promise<void>;
  /**
   * ACTIONS::revert's restore half — put the project back to its newest save
   * point and reload the editors. Resolves false when there is no point to go
   * back to, so the command can say so rather than appear to do nothing.
   */
  onRevert?: () => Promise<boolean>;
  /** Write a generated output file (plot / export) into the project file
   *  manager instead of the browser download folder. When absent, outputs fall
   *  back to a browser download. */
  onOutputFile?: (name: string, bytes: Uint8Array, mime: string) => void;
  /** Register a flush the host calls before leaving/reopening, so a pending
   *  autosave is written out first (the "edit → home → reopen" case). */
  registerAutosaveFlush?: (fn: (() => void) | null) => void;
  /**
   * Bumped by the host once per deliberate project open, and by nothing else.
   *
   * `initialProject` is a LIVE prop — the host mirrors this editor's own
   * autosaved sheets back into it — so it is not, and must not be, what decides
   * that the project should be re-opened. See the effect that reads this.
   */
  openNonce?: number;
  /**
   * Whether this frame is the one on screen. A hidden frame keeps what it has
   * and opens the project when next shown; see the same prop on PcbEditor for
   * why. Defaults to shown, for a frame that has no host.
   */
  shown?: boolean;
  /** `.kicad_wks` saved into the project this session (Drawing Sheet Editor →
   *  Save to Project), offered as extra Page Settings drawing-sheet choices. */
  extraSheetFiles?: PickedFile[];
  /** Project name shown as "<project>, Schematic Editor" in the menu bar. */
  projectName?: string;
  /** Basename of the active project's .kicad_pro (no extension). When a folder
   *  holds several projects, this pins which one's root sheet to load, so the
   *  editor matches the launcher tree instead of guessing the first/last pro. */
  rootPro?: string;
  /**
   * The program's KIWAY: the editor's SCH_EDIT_FRAME registers as FRAME_SCH's
   * player on it, so the board's cross-probe mail reaches `KiwayMailIn`, and
   * sends its own through it.
   */
  kiway?: KIWAY;
}): JSX.Element {
  const {
    PreferencesDialog,
    HomeLink,
    OpenFileDialog,
    SaveAsDialog,
    DialogSymLibTable,
    FootprintChooserFrame,
    useToolbarEntries,
    loadFootprintIndex,
    loadFootprint,
    loadIndex,
    loadSymbol,
    symbolsBase,
    libraryUri,
    preloadSchematicLibraries,
    remapEvent,
    applyHotkeyOverrides,
    useProjectSync,
    useAuth,
    PresencePanel,
    AssignFootprints,
    DialogSymbolChooser,
    SymbolLibraryBrowser,
    DialogRescueEach,
    SymbolChooserFrame,
  } = app;
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo<Schematic | null>(() => {
    try {
      return { ...readSchematic(parse(EMPTY_SCH)), fileName: DEFAULT_FILE };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);
  // Unsaved-changes flag ('*' in the title until the autosave hand-off; Save
  // greys when clean), same affordance as the PCB editor / KiCad's title.
  const [dirty, setDirty] = useState(false);
  const dirtySkipRef = useRef(true);
  /**
   * Edits made since the last time anything was written.
   *
   * Not the same as `dirty`, which is the title's asterisk and clears on a
   * timer whether or not a write actually happened — fine as a flash, useless
   * as "is there work to lose". This one only clears on a save.
   */
  const [unsaved, setUnsaved] = useState(false);

  // Live, not plain `useState`: the undo step is folded in a `setDoc` updater,
  // and a plain updater is replayed by React whenever it replays a render —
  // which popped the stack twice and left the document as it was. See the hook.
  const [doc, setDoc, docRef] = useLiveState<Schematic | null>(initial);
  // Multi-sheet project: every parsed document by basename, and the root file.
  // `doc` is always the currently-shown sheet; it is written back into `docs`
  // when switching. The undo stack is NOT here — there is one for the whole
  // project, on the frame, exactly as `EDA_BASE_FRAME` holds it.
  const project = useRef<{ docs: Map<string, Schematic>; root: string }>({
    docs: new Map(initial ? [[DEFAULT_FILE, initial]] : []),
    root: DEFAULT_FILE,
  });
  const [currentFile, setCurrentFile] = useState<string>(DEFAULT_FILE);
  // The active sheet *instance* (KiCad SCH_SHEET_PATH). Distinct from currentFile
  // so two instances of one shared document highlight/navigate independently.
  const [currentPath, setCurrentPath] = useState<string>('/');
  // KiCad's "Load Schematic" progress: non-null while parsing/saving a project
  // (a plain message, or a snapshot with the per-sheet parse gauge).
  const [loading, setLoading] = useState<string | ProgressSnapshot | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // Live cross-tab presence/selection sync (designer/src/sync/). Broadcast-only
  // for now — does not apply remote model changes yet.
  const syncTransport = useRef<ProjectSyncTransport | null>(null);
  const [syncPeers, setSyncPeers] = useState<PresenceInfo[]>([]);
  // Real identity to announce (see PcbEditor.tsx's own copy of this comment
  // and docs/proposals/multiplayer-architecture.md requirement 5).
  const { session } = useAuth();
  const myDisplayName = session?.user.email ?? null;
  /** The tab's one connection, owned by ProjectSyncProvider rather than by
   *  this editor — see the comment on the subscription effect below. */
  const sharedSync = useProjectSync();
  // This tab's own role in the live session — see PcbEditor.tsx's own copy
  // of this comment and eeschema/project_sync_transport.ts's
  // PeerRole. Read by runCommand/applySheetDocument to refuse a local edit
  // from a viewer; mirrored into a ref for the same reason PcbEditor.tsx's
  // is. No interactive-gesture-start guard here the way PcbEditor.tsx's
  // beginMove has one: a schematic move isn't funnelled through one
  // function the way a PCB drag is (SchematicCanvas.tsx sets `modeRef`
  // directly at several call sites), so a viewer can still visually start
  // dragging a symbol here — it just will not commit on drop, the same
  // "reads fine without the extra polish" tradeoff PcbEditor.tsx's own
  // nine non-drag guarded commands already accept.
  const [myRole, setMyRole] = useState<PeerRole>('editor');
  const myRoleRef = useRef<PeerRole>('editor');
  myRoleRef.current = myRole;
  // Marks this tab as applying a change that arrived from a peer rather
  // than one it originated itself — checked (and always reset again
  // immediately after, unlike PcbEditor.tsx's copy, since there is only
  // one remote-apply call site here and no cross-render gap to bridge) so
  // that call does not itself get refused by the viewer guard above.
  const applyingRemoteRef = useRef(false);
  const [presencePanelOpen, setPresencePanelOpen] = useState(false);
  // Other peers' last-known cursor world position, keyed by peerId. Cleared
  // per-peer on their next 'presence' drop (see the presence handler below).
  /**
   * What each peer currently has selected, by item uuid.
   *
   * Stored unresolved, as uuids, exactly as they arrived. `refId` already
   * makes a schematic id BE the item's uuid (`uuid ?? kind:idx:index`), so
   * unlike the board -- whose ids are positional and have to be translated
   * per peer -- nothing has to be mapped here. What still has to be checked
   * is the sheet: a uuid selected on another sheet means nothing on this
   * one, which is why every read of this filters through presence.
   */
  // A remote sheet-text update waiting to be applied (see the effect near
  // applySheetDocument below — it needs sheetInstanceRefs/applySheetDocument,
  // both defined later in this component, hence the queue rather than
  // applying inline here).
  const [pendingRemoteChange, setPendingRemoteChange] = useState<
    | { sheetPath: string; text: string; patch?: undefined }
    | { sheetPath: string; patch: SchematicPatch; text?: undefined }
    | null
  >(null);
  /**
   * The sheet state this tab last broadcast, and which sheet it was — the
   * base `diffSchematic` measures the next edit against.
   *
   * Keyed by path because switching sheets replaces `doc` wholesale: diffing
   * sheet B against sheet A would describe every item on both as changed,
   * which is not just wasteful but wrong. A switch therefore falls back to
   * whole text once, and patches resume from there.
   */
  const prevSyncedDoc = useRef<{ path: string; doc: Schematic } | null>(null);
  // Last text this tab is responsible for having produced on the active
  // sheet — set both when broadcasting a local edit and when applying a
  // remote one, so applying a remote change doesn't immediately echo it
  // straight back out (see the broadcast effect below).
  const lastKnownText = useRef<string | null>(null);
  useEffect(() => {
    // The connection belongs to the tab, not to this editor: both editors
    // stay mounted, so owning one here made the tab its own peer. See
    // designer/src/sync/ProjectSyncProvider.tsx.
    const transport = sharedSync;
    if (!transport) return undefined;
    syncTransport.current = transport;
    const unsubscribe = transport.onMessage((payload, fromPeerId) => {
      if (payload.kind === 'presence') {
        setSyncPeers(payload.peers);
      } else if (payload.kind === 'selection' || payload.kind === 'cursor') {
        // Peers' cursors and selections were drawn by the record canvas, which is gone; they come
        // back as an overlay on KiCad's canvas. Until then they are received and not shown.
      } else if (payload.kind === 'model-changed') {
        setPendingRemoteChange({ sheetPath: payload.sheetPath, text: payload.text });
      } else if (payload.kind === 'sheet-patch') {
        setPendingRemoteChange({ sheetPath: payload.sheetPath, patch: payload.patch });
      } else if (payload.kind === 'self-role') {
        // Locally synthesized, not peer-authored — see PcbEditor.tsx's own
        // copy of this branch and the payload's own doc comment.
        setMyRole(payload.role);
      } else if (payload.kind === 'role-assign') {
        if (payload.toPeerId !== transport.peerId) return; // addressed to someone else
        syncTransport.current?.setRole(payload.role);
      }
    });
    return () => {
      // Unsubscribe only. Disconnecting is the provider's job -- this editor
      // stays mounted and hidden when the user switches to the board, and
      // tearing the tab's connection down here would take presence with it.
      unsubscribe();
      syncTransport.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSync]);
  // This editor owns the sheet half of presence, because it is the only
  // thing that knows which sheet is open. `shown` -- the prop the host
  // already passes to say which editor is in front -- is in the deps, so
  // arriving back from the board re-announces the sheet the provider could
  // not name when it announced the view.
  useEffect(() => {
    if (!shown) return;
    sharedSync?.updatePresence('schematic', currentPath);
  }, [currentPath, shown, sharedSync]);
  useEffect(() => {
    // Only ids that are really uuids. `refId` falls back to `kind:idx:index`
    // for an item with no uuid of its own, and that names a position in THIS
    // tab's arrays -- sent as-is it would land on whatever item happened to
    // sit at that index on the receiver, which is worse than sending nothing.
    const refs = [...selection].filter((id) => !id.includes(':idx:'));
    syncTransport.current?.publish({ kind: 'selection', refs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  // Broadcast the active sheet's edits (designer/src/sync/), debounced so a
  // run of small edits collapses into one message instead of one per commit.
  // Skipped when the change we're seeing is one we just applied FROM a
  // remote peer (lastKnownText already matches it) — otherwise applying a
  // remote change would immediately echo it straight back out.
  useEffect(() => {
    if (!doc) return undefined;
    const timer = setTimeout(() => {
      let text: string;
      try {
        text = serializeSchematic(doc);
      } catch {
        return;
      }
      // Recorded even when this turns out to be our own echo, so the next
      // real edit diffs against what the group actually has rather than
      // against whatever this tab last sent.
      const base = prevSyncedDoc.current?.path === currentPath ? prevSyncedDoc.current.doc : null;
      prevSyncedDoc.current = { path: currentPath, doc };
      if (text === lastKnownText.current) return;
      lastKnownText.current = text;
      // The fast path: a handful of changed items instead of the whole sheet,
      // `lib_symbols` cache and title block. Null means this edit touched the
      // retained AST (page settings, embedded files) and cannot be described
      // as items — see sch_diff.ts.
      const patch = base ? diffSchematic(base, doc) : null;
      if (patch && !schematicPatchIsEmpty(patch)) {
        syncTransport.current?.publish({ kind: 'sheet-patch', sheetPath: currentPath, patch });
        return;
      }
      syncTransport.current?.publish({ kind: 'model-changed', sheetPath: currentPath, text });
    }, 400);
    return () => clearTimeout(timer);
  }, [doc, currentPath]);
  /**
   * The selection a right-click made just to have something to aim the menu at
   * — `SELECTION::SetIsHover`.
   *
   * `SCH_SELECTION_TOOL::Main`'s right-click branch only picks an item when
   * nothing is selected yet, and marks what it picked as a hover:
   *
   *     if( m_selection.Empty() )
   *     {
   *         ClearSelection();
   *         SelectPoint( evt->Position(), { SCH_LOCATE_ANY_T }, nullptr, &selCancelled );
   *         m_selection.SetIsHover( true );
   *     }
   *
   * A hover selection is disposable: every action that acts on one clears it
   * when it finishes (`if( selection.IsHover() ) … selectionClear`), and the
   * point editor's handles never come up on it — which is why right-clicking a
   * sheet cold shows the menu with no resize grips, while right-clicking one
   * that was already selected leaves the grips it already had.
   *
   * Held as the set itself rather than a flag, so it stops applying the moment
   * the selection becomes anything else.
   */
  const [hoverSelection, setHoverSelection] = useState<ReadonlySet<string> | null>(null);
  const selectionRef = useRef<ReadonlySet<string>>(selection);
  selectionRef.current = selection;
  const hoverSelectionRef = useRef<ReadonlySet<string> | null>(hoverSelection);
  hoverSelectionRef.current = hoverSelection;
  // The item whose net is highlighted by the Highlight-Net tool (KiCad's
  // m_highlightedConn). Distinct from selection: plain selection is never a net
  // highlight in KiCad; it's the explicit highlight action that brightens a net.
  const [highlightItem, setHighlightItem] = useState<string | null>(null);
  // SCH_EDITOR_CONTROL::m_highlightBusMembers: re-clicking an already-highlighted
  // net toggles the members of the bus it rides on into the highlight.
  const [highlightBusMembers, setHighlightBusMembers] = useState(false);
  const history = useRef(new ProjectHistory());
  const [activeTool, setActiveTool] = useState('select');
  /** The current tool, for callbacks that must not re-run when it changes. */
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const [placeLib, setPlaceLibOnly] = useState<LibSymbol | null>(null);
  // A ready-built symbol on the cursor instead of one made from the library's
  // defaults: Place Next Symbol Unit attaches a copy of an existing placement.
  const [placeInstance, setPlaceInstance] = useState<SchSymbol | null>(null);
  // Every other placement path starts (or abandons) a library placement through
  // this, which drops the copy, so it can never outlive its own run.
  const setPlaceLib = useCallback((lib: LibSymbol | null) => {
    setPlaceLibOnly(lib);
    setPlaceInstance(null);
    // `addSymbol`'s first line, when the symbol goes ON the cursor:
    //
    //     m_toolMgr->RunAction( ACTIONS::selectionClear );
    //     m_selectionTool->AddItemToSel( aSymbol );
    //
    // This is NOT what unhighlights the previous symbol when you open the
    // chooser — the click branch already cleared it before the dialog went up
    // (see `chooserOpen` below), so by the time a pick gets here there is
    // nothing left to clear. It is the operative one on the paths that attach
    // a symbol WITHOUT a chooser: Place Next Symbol Unit, and the repeated
    // copies of "Place all units" / KeepSymbol.
    //
    // Only on attach: `setPlaceLib( null )` is the abandon path, and Escape's
    // own cleanup() clears the selection there.
    if (lib) setSelection(new Set());
  }, []);
  // Unit attached to the cursor, and the chooser's checkbox state driving the
  // after-placement continuation (KeepSymbol / PlaceAllUnits stepping).
  // Read by the after-placement continuation, which must see the library that
  // is on the cursor now rather than the one its closure was built with.
  const placeLibRef = useRef<LibSymbol | null>(null);
  placeLibRef.current = placeLib;
  const placeFlags = useRef({ keepSymbol: true, placeAllUnits: false, unitCount: 1 });
  const [pendingLabel, setPendingLabel] = useState<PendingLabel | null>(null);
  // SCH_DRAWING_TOOLS' m_last* members: the next label starts from whatever the
  // previous one was given. Upstream's initial values: Input, RIGHT, no bold /
  // italic / auto-rotate.
  const lastLabel = useRef({
    shape: 'input' as LabelShape,
    bold: false,
    italic: false,
    spin: 'right' as LabelSpin,
    autoRotate: false,
    face: '',
  });
  /** DIALOG_TEXT_PROPERTIES while it is up for the live tools. */
  const [labelDialog, setLabelDialog] = useState<{
    dlg: DIALOG_LABEL_PROPERTIES;
    shown: LABEL_DIALOG_VALUES;
    resolve: (aId: number) => void;
  } | null>(null);
  const [fieldDialog, setFieldDialog] = useState<{
    dlg: DIALOG_FIELD_PROPERTIES;
    shown: FIELD_DIALOG_VALUES;
    field: SCH_FIELD;
    commit: SCH_COMMIT;
    resolve: (aId: number) => void;
  } | null>(null);
  const [sheetDialog, setSheetDialog] = useState<{
    dlg: DIALOG_SHEET_PROPERTIES;
    shown: SHEET_DIALOG_VALUES;
    resolve: (aId: number) => void;
  } | null>(null);
  // KIDIALOG for the live tools' warnings with a "Do not show again" box.
  const kiDialog = useKiDialog();
  const [symbolDialog, setSymbolDialog] = useState<{
    dlg: DIALOG_SYMBOL_PROPERTIES;
    shown: SYMBOL_DIALOG_VALUES;
    resolve: (aId: number) => void;
  } | null>(null);
  const [changeSymbolsDialog, setChangeSymbolsDialog] = useState<{
    dlg: DIALOG_CHANGE_SYMBOLS;
    resolve: (aId: number) => void;
  } | null>(null);
  // FRAME_SYMBOL_CHOOSER, opened quasi-modal by a dialog's browse button.
  const [symbolChooser, setSymbolChooser] = useState<{
    preselect: string;
    resolve: (aLibId: string | null) => void;
  } | null>(null);
  const [tableDialog, setTableDialog] = useState<{
    dlg: DIALOG_TABLE_PROPERTIES;
    shown: SCH_TABLE_DIALOG_VALUES;
    isNew: boolean;
    resolve: (aId: number) => void;
  } | null>(null);
  const [cellDialog, setCellDialog] = useState<{
    dlg: DIALOG_TABLECELL_PROPERTIES;
    shown: TABLECELL_DIALOG_VALUES;
    resolve: (aId: number) => void;
  } | null>(null);
  const [textDialog, setTextDialog] = useState<{
    dlg: DIALOG_TEXT_PROPERTIES;
    shown: TextPropsInitial;
    resolve: (aId: number) => void;
  } | null>(null);
  /**
   * The rectangle a table was dragged out over, awaiting confirmation.
   *
   * `DrawTable` derives the row and column counts from the drag —
   *
   *     int colCount = std::max( 1, requestedSize.x / ( fontSize * 15 ) );
   *     int rowCount = std::max( 1, requestedSize.y / ( fontSize * 2  ) );
   *
   * — and then shows DIALOG_TABLE_PROPERTIES over the result; only OK commits.
   * Asking for the counts up front, which is what this used to do, is a
   * different gesture and gives no preview of what you are about to get.
   */
  /**
   * The open DIALOG_TABLE_PROPERTIES. A table drawn just now is held here
   * rather than in the document, because Cancel throws it away —
   * `else { delete table; }` — so it must not be committed first.
   */
  // The image riding the cursor, built once when the file is chosen and
  // re-placed each frame (SCH_DRAWING_TOOLS::PlaceImage keeps one SCH_BITMAP
  // and moves it), so its identity — and the renderer's decode of it — survives.
  const [pendingImage, setPendingImage] = useState<SchImage | null>(null);
  // Keyboard-initiated grabbed move (SCH_MOVE_TOOL): M leaves connected wires
  // behind, G drags them along. A fresh nonce restarts the grab.
  // Assign Netclass: the patterns the selection produced, awaiting a class.
  const [netclassPatterns, setNetclassPatterns] = useState<string[] | null>(null);
  // SCH_MOVE_TOOL::Main's four modes. Break and Slice split the selected
  // segment first and then run exactly this drag, which is why they are a grab
  // kind rather than an edit of their own.
  // Right-click selection context menu (SCH_SELECTION_TOOL's TOOL_MENU):
  // client-space position plus the hit-tested item, or null when closed.
  // Clarify Selection (SCH_SELECTION_TOOL::doSelectionMenu): an ambiguous
  // click lists every candidate; picking a row selects it.
  const [clarify, setClarify] = useState<{
    x: number;
    y: number;
    items: ItemRef[];
    additive: boolean;
  } | null>(null);
  // Editing an existing label's text/shape (DIALOG_LABEL_PROPERTIES).
  // Editing a hierarchical sheet's name/file (DIALOG_SHEET_PROPERTIES).
  // Sheet Properties (DIALOG_SHEET_PROPERTIES); the dialog reads the sheet
  // itself out of the document, so only which one is open is state.
  // Shape Properties (DIALOG_SHAPE_PROPERTIES). A graphic polyline lives in
  // `lines`, every other shape in `graphics`, so the target says which.
  /** DIALOG_SHAPE_PROPERTIES while it is up for the live tools. */
  const [shapeDialog, setShapeDialog] = useState<{
    dlg: DIALOG_SHAPE_PROPERTIES;
    name: string;
    shown: SHAPE_DIALOG_VALUES;
    resolve: (aId: number) => void;
  } | null>(null);
  // Image Properties (DIALOG_IMAGE_PROPERTIES over PANEL_IMAGE_EDITOR).
  /** DIALOG_IMAGE_PROPERTIES while it is up for the live tools. */
  const [imageDialog, setImageDialog] = useState<{
    dlg: DIALOG_IMAGE_PROPERTIES;
    shown: ReturnType<DIALOG_IMAGE_PROPERTIES['TransferDataToWindow']>;
    resolve: (aId: number) => void;
  } | null>(null);
  // Field Properties (DIALOG_FIELD_PROPERTIES): which symbol, which field.
  // Sheet Pin Properties (DIALOG_SHEET_PIN_PROPERTIES).
  /** DIALOG_SHEET_PIN_PROPERTIES while it is up for the live tools. */
  const [sheetPinDialog, setSheetPinDialog] = useState<{
    dlg: DIALOG_SHEET_PIN_PROPERTIES;
    shown: SHEET_PIN_DIALOG_VALUES;
    resolve: (aId: number) => void;
  } | null>(null);
  // Unfold from Bus leaves the wire tool drawing away from the new entry
  // (SCH_LINE_WIRE_BUS_TOOL continues into its drawing loop).
  // Editing the current sheet's page number (SCH_ACTIONS::editPageNumber).
  // The page-number dialog. `sheet` is the selected sheet's index and uuid when
  // the edit targets a *sub*-sheet from the context menu; without it the open
  // sheet's own page number is edited, which is what the Edit menu does.
  const [pageEdit, setPageEdit] = useState<{
    page: string;
    sheet?: { index: number; uuid: string };
  } | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the dialog is up, so a
  // closed one does not sit on the stack swallowing the key.
  useModalEscape(() => setPageEdit(null), pageEdit !== null);
  // Editing a wire/bus stroke (DIALOG_WIRE_BUS_PROPERTIES) or a junction's
  // diameter (DIALOG_JUNCTION_PROPS).
  // A bus entry opens the same DIALOG_WIRE_BUS_PROPERTIES a wire does: upstream
  // groups SCH_BUS_WIRE_ENTRY_T with SCH_LINE_T and SCH_JUNCTION_T in
  // SCH_EDIT_TOOL::Properties.
  /** DIALOG_WIRE_BUS_PROPERTIES while it is up for the live tools. */
  const [wireBusDialog, setWireBusDialog] = useState<{
    dlg: DIALOG_WIRE_BUS_PROPERTIES;
    shown: WIRE_BUS_DIALOG_VALUES;
    firstWidth: number;
    resolve: (aId: number) => void;
  } | null>(null);
  /** DIALOG_JUNCTION_PROPS while it is up for the live tools. */
  const [junctionDialog, setJunctionDialog] = useState<{
    dlg: DIALOG_JUNCTION_PROPS;
    shown: ReturnType<DIALOG_JUNCTION_PROPS['TransferDataToWindow']>;
    firstDiameter: number;
    resolve: (aId: number) => void;
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [localToggles, setLocalToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  // Collapsed nodes in the Schematic Hierarchy tree (HIERARCHY_TREE twisties),
  // keyed by SheetTreeNode.path; a node not in the set is expanded.
  const [collapsedSheets, setCollapsedSheets] = useState<Set<string>>(new Set());

  // Left dock sizing (KiCad's default AUI perspective for the Properties /
  // Net Navigator / Schematic Hierarchy / Selection Filter column: bestw=300,
  // and PropertiesManager's minw=240 is the binding constraint on the whole
  // column). Height is per stacked pane; Selection Filter (prop=0 in KiCad's
  // perspective) never grows, so it's excluded from panelHeights.
  const [leftDockWidth, setLeftDockWidth] = useState(300);
  const [panelHeights, setPanelHeights] = useState<Record<string, number>>({});
  // `dock_pos` for the left column, which is state and not a table: wxAUI
  // renumbers the SHOWN panes on every Update, so the pane opened first ends
  // up at 0 and the next one keeps its (larger) `Position()` and docks below
  // it. See `schLeftDockLayout` and `qa/probes/aui_dock_pos_probe.cpp`. It
  // starts at what `AddPane` leaves behind, so a frame that opens with several
  // panes already shown gets them in `Position()` order.
  //
  // A ref rather than state: it is written during the render that lays the
  // column out, and every write is accompanied by the toggle change that
  // caused it, so there is nothing extra to re-render for.
  //
  // It starts from the stored perspective, not from the `Position()` table:
  // `RestoreAuiLayout()` runs before any pane is shown, so upstream's column
  // resumes wherever the last session left it. See `schDockPosFrom`.
  const dockPosRef = useRef<SchDockPos>(schDockPosFrom(app.settings.eeschema.window.left_dock_pos));
  // The numbers the last laid-out render produced, persisted after it.
  const dockPosSaveRef = useRef<SchDockPos>(dockPosRef.current);
  // `SCH_EDIT_FRAME::SaveSettings` writes `m_auimgr.SavePerspective()`, which
  // carries every pane's `dock_pos`, so the renumbering wxAUI did during the
  // session outlives it. Ours is written after the render that produced it
  // rather than during, because a settings commit notifies subscribers.
  //
  // No dependency array: the value is a ref, so there is nothing React could
  // key on, and the comparison below makes the pass a no-op whenever the column
  // did not move.
  useEffect(() => {
    const next = dockPosSaveRef.current;
    const stored = app.settings.eeschema.window.left_dock_pos;
    if (SCH_LEFT_PANE_ADD_ORDER.every((pane) => stored[pane] === next[pane])) return;
    app.settings.updateEeschema((s) => {
      s.window.left_dock_pos = { ...next };
    });
  });
  // Drags the pane immediately above the sash (KiCad's HIERARCHY_TREE /
  // PROPERTIES_PANEL / NET_NAVIGATOR sashes); the pane below it keeps filling
  // the rest via flex:1, same chain KiCad's wxAUI splitters produce.
  const startPanelResize = (key: string, e: React.MouseEvent): void => {
    e.preventDefault();
    const paneEl = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    const startY = e.clientY;
    const startH = panelHeights[key] ?? paneEl?.getBoundingClientRect().height ?? 200;
    const onMove = (ev: MouseEvent): void =>
      setPanelHeights((p) => ({ ...p, [key]: Math.max(60, startH + ev.clientY - startY) }));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
  };

  /**
   * The sash above the BOTTOM dock. `startPanelResize` grows the pane before
   * the sash; this one is the mirror image — the pane is *after* the sash, so
   * dragging down shrinks it. The floor is the pane's own
   * `.MinSize( 180, 60 )`, not a number chosen here.
   */
  const startBottomDockResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const paneEl = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
    const startY = e.clientY;
    const startH =
      panelHeights.search ?? paneEl?.getBoundingClientRect().height ?? SCH_BOTTOM_DOCK.bestHeight;
    const onMove = (ev: MouseEvent): void =>
      setPanelHeights((p) => ({
        ...p,
        search: Math.max(SCH_BOTTOM_DOCK.minHeight, startH - (ev.clientY - startY)),
      }));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
  };

  /** The dock opens at the pane's `.BestSize( 180, 100 )` height. */
  const bottomDockStyle: React.CSSProperties = {
    height: panelHeights.search ?? SCH_BOTTOM_DOCK.bestHeight,
  };
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /**
   * `ShowPreferences( aStartPage, aStartParentPage )`'s first argument, for the
   * callers that name a page — `COMMON_TOOLS::GridProperties` is the only one
   * so far (`common/tool/common_tools.cpp:609-634`). Undefined means the book
   * opens where it always did.
   */
  const [prefsPage, setPrefsPage] = useState<PrefsPageId | undefined>(undefined);
  const openPrefs = useCallback((page?: PrefsPageId) => {
    setPrefsPage(page);
    setPrefsOpen(true);
  }, []);
  const common = app.useCommonSettings();
  const es = app.useEeschemaSettings();
  /**
   * `EDA_BASE_FRAME::RecreateToolbars` (`common/eda_base_frame.cpp:1728-1843`):
   * the frame asks `GetToolbarConfig( loc, m_CustomToolbars )` for each bar and
   * never reads `DefaultToolbarConfig` itself, which is what lets Preferences >
   * Toolbars change what is drawn.
   */
  const schTopBar = useToolbarEntries('eeschema', 'TOP_MAIN', SCH_DEFAULT_TOOLBARS);
  const schLeftBar = useToolbarEntries('eeschema', 'LEFT', SCH_DEFAULT_TOOLBARS);
  const schRightBar = useToolbarEntries('eeschema', 'RIGHT', SCH_DEFAULT_TOOLBARS);
  const theme = app.useSchematicTheme();

  // The displayed toggle set: local toggles plus the settings-derived ones
  // (Preferences and the left toolbar drive the same EESCHEMA_SETTINGS keys).
  const toggles = useMemo(() => {
    const t = new Set(localToggles);
    if (es.window.grid.show) t.add('toggleGrid');
    if (es.window.grid.overrides_enabled) t.add('toggleGridOverrides');
    if (es.appearance.show_hidden_pins) t.add('toggleHiddenPins');
    if (es.appearance.show_hidden_fields) t.add('toggleHiddenFields');
    t.add(
      es.window.cursor.crosshair === '45'
        ? 'crosshair45'
        : es.window.cursor.crosshair === 'small'
          ? 'crosshairSmall'
          : 'crosshairFull',
    );
    t.add(
      es.drawing.line_mode === 0
        ? 'lineModeFree'
        : es.drawing.line_mode === 2
          ? 'lineMode45'
          : 'lineMode90',
    );
    if (es.annotation.automatic) t.add('annotateAuto');
    return t;
  }, [localToggles, es]);
  // Ctrl+U (ACTIONS::toggleUnits) returns to the last imperial unit, like
  // COMMON_TOOLS::m_imperialUnit (initially inches).
  const lastImperialRef = useRef<'unitsInches' | 'unitsMils'>('unitsInches');
  useEffect(() => {
    if (toggles.has('unitsInches')) lastImperialRef.current = 'unitsInches';
    else if (toggles.has('unitsMils')) lastImperialRef.current = 'unitsMils';
  }, [toggles]);
  // Selection Filter (SCH_SELECTION_FILTER_OPTIONS): gates which item types,
  // and locked items, the selection accepts.
  const [selFilter, setSelFilter] = useState<SelectionFilterOptions>(defaultSelectionFilter);
  // The cursor and the viewport scale drive nothing but the three status-bar
  // panes, and they change on every pointer event, so they are held in refs
  // and pushed straight into that widget. Routing them through this frame's
  // state would re-render the whole editor for every mouse move.
  const cursorRef = useRef<Vec2 | null>(null);
  // ACTIONS::toggleUnits / the imperial-unit pair, and the display's device
  // pixel ratio: both feed the live status panes, so they are resolved before
  // the readout that writes them.
  const units: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // HOTKEY_CYCLE_POPUP, this frame's one instance (EDA_DRAW_FRAME::m_hotkeyPopup).
  // Its expiry hands the keyboard back with `m_drawFrame->GetCanvas()->SetFocus()`
  // (common/dialogs/hotkey_cycle_popup.cpp:48).
  const appRef = useRef<HTMLDivElement>(null);
  const hotkeyPopup = useHotkeyCyclePopup(() => appRef.current?.querySelector('canvas')?.focus());
  /**
   * `SCH_EDITOR_CONTROL::GridFeedback`
   * (eeschema/tools/sch_editor_control.cpp:3360-3382), bound to
   * `EVENTS::GridChangedByKeyEvent` (`:3550`) - which `COMMON_TOOLS::
   * OnGridChanged` posts only for the HOTKEY paths, never for the grid combo
   * or the menu (common/tool/common_tools.cpp:562-564).
   *
   * Held in a ref because the keydown listener is installed once, while the
   * labels depend on the frame's live units.
   */
  const gridFeedbackRef = useRef<() => void>(() => {});
  gridFeedbackRef.current = () => {
    // The settings manager is read here rather than the render-time `es`,
    // because this runs immediately after `updateEeschema` has moved the index
    // and must see the grid the keystroke just chose - as upstream does, where
    // `OnGridChanged` assigns `last_size_idx` before posting the event.
    const grid = app.settings.eeschema.window.grid;
    gridFeedback(hotkeyPopup, {
      hotkeyFeedback: app.settings.common.input.hotkey_feedback,
      grids: grid.sizes,
      lastSizeIdx: grid.last_size_idx,
      units,
      iuPerMM: SCH_IU_PER_MM,
    });
  };
  // The symbol whose properties dialog is open (its refId), or null.
  // Items parsed from the clipboard, attached to the cursor until dropped.
  const [pastePending, setPastePendingOnly] = useState<PastePayload | null>(null);
  /**
   * Attaching a paste clears the selection, so the items it came from go dark.
   *
   * Ctrl+D is not its own operation upstream — it IS a paste:
   *
   *     int SCH_EDITOR_CONTROL::Duplicate( const TOOL_EVENT& aEvent )
   *     {
   *         doCopy( true ); // Use the local clipboard
   *         Paste( aEvent );
   *     }
   *
   * (sch_editor_control.cpp:1797-1803), and the paste path clears the selection
   * before it takes the pasted items into it. So the moment you duplicate, the
   * original stops being selected and the new copy is what is highlighted.
   * Ours left the original lit and only moved the selection across on the drop.
   *
   * Every paste path goes through this one setter — Ctrl+V, Duplicate, the
   * repeat-item and drag-drop paths — so the rule is stated once here rather
   * than at seven call sites. `null` is the abandon/finish path and leaves the
   * selection alone: `onPasteDone` sets it to the items just dropped.
   */
  const setPastePending = useCallback((payload: PastePayload | null) => {
    setPastePendingOnly(payload);
    if (payload) setSelection(new Set());
  }, []);
  /** File > Import > Graphics (Ctrl+Shift+F): the open DIALOG_IMPORT_GFX_SCH. */
  const [importGfxOpen, setImportGfxOpen] = useState(false);
  // ERC markers: null until a run has happened. They live on past the dialog
  // closing, exactly like the SCH_MARKERs upstream appends to the screen,
  // only Delete All Markers (or a new run) clears them.
  const [ercResult, setErcResult] = useState<readonly ErcViolation[] | null>(null);
  // m_cancelled: set by the dialog's Cancel button, read between phases.
  const ercCancelled = useRef(false);
  // The marker a heading row put the focus on (FocusOnItem brightens it).
  // DIALOG_ERC's visibility, and the phase messages of a run in flight.
  const [ercOpen, setErcOpen] = useState(false);
  /** Tools > Update Schematic from PCB: the footprints read for this run. */
  const [backAnnotateFps, setBackAnnotateFps] = useState<PcbFootprintData[] | null>(null);
  /** The open ERC dialog's marker-tree API, for the Inspect menu's entries. */
  const ercNav = useRef<ErcDialogNav | null>(null);
  /** A marker cross-probe waiting for the ERC dialog to exist (or to unfilter). */
  const pendingErcSelect = useRef<string | null>(null);
  /** Tools > Sync Sheet Pins: which sub-sheets the dialog is showing. */
  const [syncPinsOpen, setSyncPinsOpen] = useState<SyncSheetEntry[] | null>(null);
  /**
   * The file the dialog was opened over, kept separately from `currentFile`:
   * "Add Hierarchical Labels" navigates into the sub-sheet to place them, and
   * the dialog has to come back showing the sheet it was opened on, not
   * whatever is on screen when the placement finishes. Upstream gets this for
   * free — its panels hold sheet *paths*, not the active screen.
   */
  const syncParentFile = useRef<string>('');
  /** Which page the dialog should reopen on after a placement. */
  const syncPage = useRef(0);
  /**
   * `DIALOG_SYNC_SHEET_PINS`'s placement template queue: the rows an Add button
   * armed, one placed per click, the dialog reopening when the last one lands
   * (`CanPlaceMore` / `EndPlacement`).
   */
  const [syncPlacement, setSyncPlacement] = useState<SyncPlacement | null>(null);
  const syncPlacementRef = useRef<SyncPlacement | null>(null);
  syncPlacementRef.current = syncPlacement;
  /** Where to navigate back to when a label placement finishes. */
  const syncReturn = useRef<{ path: string; file: string } | null>(null);
  const [ercRunning, setErcRunning] = useState<readonly string[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  /**
   * `SCH_ACTIONS::importSheet`'s file picker.
   *
   * Deliberately not the Open dialog: Open *replaces* the document, while
   * importing brings another schematic's contents *into* this one, so the two
   * must not share a picker.
   */
  const [importSheetOpen, setImportSheetOpen] = useState(false);

  const libById = useMemo<Map<string, LibSymbol>>(
    () => new Map((doc?.libSymbols ?? []).map((l) => [l.libId, l])),
    [doc?.libSymbols],
  );
  // The same map for the stable callbacks, which are built once and would
  // otherwise capture the first render's.
  const libByIdRef = useRef(libById);
  libByIdRef.current = libById;

  // Connectivity: compute the netlist, then brighten the net the Highlight-Net tool
  // picked (not the selection, KiCad keeps those separate). The renderer matches
  // wire/junction/pin ids against this set.
  // Project-scoped Schematic Setup values (SCHEMATIC_SETTINGS working state);
  // hydrated from .kicad_pro on project load, committed via commitSetup.
  const [setup, setSetup] = useState<SchematicSetup>(defaultSchematicSetup);

  // Bus Alias Definitions feed group-bus expansion in the netlist.
  const busAliases = useMemo(
    () => new Map(setup.busAliases.filter((a) => a.name).map((a) => [a.name, a.members])),
    [setup.busAliases],
  );

  // Connectivity runs one task behind the document. Rebuilding the graph is the
  // most expensive thing an edit triggers, and nothing about the *geometry* the
  // user just changed depends on it, so the edit is painted first and the nets
  // are rebuilt immediately afterwards, with the previous result left on screen
  // for that one frame rather than blanking. Everything derived from the graph
  // (net colours, netclass widths) keys off `connDoc` so it stays
  // self-consistent; a wire drawn this frame simply has no override yet.
  //
  // This does not widen any window a caller could observe: a handler that edits
  // the document already cannot see a rebuilt netlist, because React has not
  // re-rendered at that point either.
  const [connDoc, setConnDoc] = useState<Schematic | null>(doc);
  useEffect(() => {
    if (connDoc === doc) return;
    // setTimeout, not requestAnimationFrame, rAF never fires while the tab is
    // hidden, and connectivity must keep up with edits made off-screen.
    const t = setTimeout(() => setConnDoc(doc), 0);
    return () => clearTimeout(t);
  }, [doc, connDoc]);

  const netlist = useMemo(
    () => (connDoc ? computeNetlist(connDoc, libById, { busAliases }) : null),
    [connDoc, libById, busAliases],
  );
  const schFrameRef = useRef<SCH_EDIT_FRAME | null>(null);
  /** `wxTextEntryDialog` for the live tools while it is up. */
  const [textEntryRequest, setTextEntryRequest] = useState<{
    message: string;
    caption: string;
    value: string;
    resolve: (aText: string | null) => void;
  } | null>(null);
  /** `wxFileDialog` (open) for the live tools while it is up. */
  const [fileDialogRequest, setFileDialogRequest] = useState<{
    title: string;
    defaultDir: string;
    filters: readonly ChooserFilter[];
    resolve: (aPath: string | null) => void;
  } | null>(null);
  /** PickSymbolFromLibrary's DIALOG_SYMBOL_CHOOSER while it is up. */
  const [chooserRequest, setChooserRequest] = useState<{
    filter: SYMBOL_LIBRARY_FILTER | null;
    history: readonly PICKED_SYMBOL[];
    placed: readonly PICKED_SYMBOL[];
    showFootprints: boolean;
    resolve: (aPicked: PICKED_SYMBOL | null) => void;
  } | null>(null);
  // MAIL_ASSIGN_FOOTPRINTS and MAIL_SCH_SAVE, filled in below once the
  // project edit and the save they call exist.
  const saveProjectRef = useRef<() => boolean>(() => false);
  // TRANSITIONAL (S2-5b, gone at S7): the frame's live SCHEMATIC, rebuilt from the window's
  // records when one changed (sch_record_bridge.ts).
  const syncLiveRef = useRef<() => boolean>(() => false);
  const editLiveRef = useRef<NonNullable<SchScriptApi['editLive']>>(async () => null);
  const liveFilesRef = useRef<{
    rawFiles: readonly PickedFile[];
    projectName?: string;
    rootPro?: string;
  }>({ rawFiles: [] });
  const modalAnnotateRef = useRef<(aMessage: string) => void>(() => {});
  /**
   * `SaveProject()` arriving in the same tick as the assignment it saves: the
   * assignment's step folds on the next render, so it is marked to be written
   * then rather than left to the debounced save.
   */
  const saveRequestedRef = useRef(false);
  const assignPendingRef = useRef(false);
  // What a grid's text-button cell opens (GRID_CELL_FPID / URL / PATH_EDITOR): the frame's own
  // file dialog and document opener.
  const gridTextButtonHost: GRID_TEXT_BUTTON_HOST = {
    // `Kiway().Player( FRAME_FOOTPRINT_CHOOSER )`, sent MAIL_SYMBOL_NETLIST: KiwayMailIn reads the
    // pins (one per distinct number) from the first line and the filters from the second.
    ChooseFootprint: (aPreselect, aNetlist) =>
      new Promise((resolve) => {
        const [pinLine = '', filterLine = ''] = aNetlist.split('\r');
        const pinNames = new Set(
          pinLine === '' ? [] : pinLine.split('\t').map((pin) => pin.split(' ')[0]!),
        );
        setFpChooser({
          current: aPreselect,
          commit: resolve,
          cancel: () => resolve(null),
          fpFilters: filterLine === '' ? [] : filterLine.split(' '),
          pinCount: pinNames.size,
        });
      }),
    OpenFile: (aTitle, aDefaultDir, aWildcard) =>
      schFrameRef.current!.ShowFileDialog(
        aTitle,
        aDefaultDir,
        '',
        aWildcard,
        wxFD_OPEN | wxFD_FILE_MUST_EXIST,
      ),
    OpenDocument: (aUrl) =>
      GetAssociatedDocument(aUrl, (aToken) => schFrameRef.current!.Prj().TextVarResolver(aToken)),
  };
  if (!schFrameRef.current) {
    schFrameRef.current = new SCH_EDIT_FRAME({
      // `DIALOG_xxx( this, … ).ShowModal()` for the live tools: each dialog KiCad names, by its C++
      // class. One not ported yet is cancelled, as with no window, and says so in the console.
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog === 'KICAD_MESSAGE_DIALOG')
          return ShowKicadMessageDialog(aArg as KICAD_MESSAGE_DIALOG_ARG);
        if (aDialog === 'DIALOG_WIRE_BUS_PROPERTIES') {
          const items = _aItems as SCH_ITEM[];
          const dlg = new DIALOG_WIRE_BUS_PROPERTIES(schFrameRef.current!, items);
          const stroked = items.find((it) => it.HasLineStroke());
          return new Promise<number>((resolve) =>
            setWireBusDialog({
              dlg,
              shown: dlg.TransferDataToWindow(),
              firstWidth: stroked ? stroked.GetStroke().GetWidth() : 0,
              resolve,
            }),
          );
        }
        if (aDialog === 'DIALOG_SHAPE_PROPERTIES') {
          const shape = _aItems[0] as SCH_SHAPE;
          const dlg = new DIALOG_SHAPE_PROPERTIES(schFrameRef.current!, shape);
          return new Promise<number>((resolve) =>
            setShapeDialog({
              dlg,
              name: shape.GetFriendlyName(),
              shown: dlg.TransferDataToWindow(),
              resolve,
            }),
          );
        }
        if (aDialog === 'DIALOG_IMAGE_PROPERTIES') {
          const dlg = new DIALOG_IMAGE_PROPERTIES(schFrameRef.current!, _aItems[0] as SCH_BITMAP);
          return new Promise<number>((resolve) =>
            setImageDialog({ dlg, shown: dlg.TransferDataToWindow(), resolve }),
          );
        }
        if (aDialog === 'DIALOG_SHEET_PIN_PROPERTIES') {
          const dlg = new DIALOG_SHEET_PIN_PROPERTIES(
            schFrameRef.current!,
            _aItems[0] as SCH_SHEET_PIN,
          );
          return new Promise<number>((resolve) =>
            setSheetPinDialog({ dlg, shown: dlg.TransferDataToWindow(), resolve }),
          );
        }
        if (aDialog === 'DIALOG_TEXT_PROPERTIES') {
          const dlg = new DIALOG_TEXT_PROPERTIES(
            schFrameRef.current!,
            _aItems[0] as SCH_TEXT | SCH_TEXTBOX,
          );
          return new Promise<number>((resolve) =>
            setTextDialog({ dlg, shown: dlg.TransferDataToWindow(), resolve }),
          );
        }
        if (aDialog === 'DIALOG_LABEL_PROPERTIES') {
          // `DIALOG_LABEL_PROPERTIES dlg( m_frame, label, aNew )`, plus `SetLabelList` for a new
          // label: Properties passes false, createNewLabel { isNew, labelList }.
          const arg = aArg as boolean | { isNew: boolean; labelList: SCH_LABEL_BASE[] } | undefined;
          const isNew = typeof arg === 'object' ? arg.isNew : !!arg;
          const dlg = new DIALOG_LABEL_PROPERTIES(
            schFrameRef.current!,
            _aItems[0] as SCH_LABEL_BASE,
            isNew,
            gridTextButtonHost,
          );
          if (typeof arg === 'object') dlg.SetLabelList(arg.labelList);
          return new Promise<number>((resolve) =>
            setLabelDialog({ dlg, shown: dlg.TransferDataToWindow(), resolve }),
          );
        }
        if (aDialog === 'DIALOG_FIELD_PROPERTIES') {
          // `DIALOG_FIELD_PROPERTIES dlg( m_frame, caption, aField )`; editFieldText hands its commit
          // for UpdateField.
          const { caption, commit } = aArg as { caption: string; commit: SCH_COMMIT };
          const field = _aItems[0] as SCH_FIELD;
          const dlg = new DIALOG_FIELD_PROPERTIES(
            schFrameRef.current!,
            caption,
            field,
            gridTextButtonHost,
          );
          return new Promise<number>((resolve) =>
            setFieldDialog({ dlg, shown: dlg.TransferDataToWindow(), field, commit, resolve }),
          );
        }
        if (aDialog === 'DIALOG_SHEET_PROPERTIES') {
          // EditSheetProperties: `DIALOG_SHEET_PROPERTIES dlg( this, aSheet, aIsUndoable, … )`.
          const { result, sourceSheetFilename } = aArg as {
            result: SHEET_PROPERTIES_RESULT;
            sourceSheetFilename: string | null;
          };
          const dlg = new DIALOG_SHEET_PROPERTIES(
            schFrameRef.current!,
            _aItems[0] as SCH_SHEET,
            result,
            sourceSheetFilename,
            gridTextButtonHost,
            kiDialog.ask,
          );
          return new Promise<number>((resolve) =>
            setSheetDialog({ dlg, shown: dlg.TransferDataToWindow(), resolve }),
          );
        }
        if (aDialog === 'DIALOG_SYMBOL_PROPERTIES') {
          const dlg = new DIALOG_SYMBOL_PROPERTIES(
            schFrameRef.current!,
            _aItems[0] as SCH_SYMBOL,
            gridTextButtonHost,
          );
          return new Promise<number>((resolve) =>
            setSymbolDialog({ dlg, shown: dlg.TransferDataToWindow(), resolve }),
          );
        }
        if (aDialog === 'DIALOG_CHANGE_SYMBOLS') {
          // `DIALOG_CHANGE_SYMBOLS dlg( m_frame, selectedSymbol, mode ); dlg.ShowQuasiModal()`.
          const dlg = new DIALOG_CHANGE_SYMBOLS(
            schFrameRef.current!,
            (_aItems[0] as SCH_SYMBOL | undefined) ?? null,
            aArg as DIALOG_CHANGE_SYMBOLS_MODE,
            (aPreselect) =>
              new Promise((resolve) => setSymbolChooser({ preselect: aPreselect, resolve })),
          );
          return new Promise<number>((resolve) => {
            setChangeSymbolsDialog({ dlg, resolve });
            void dlg.TransferDataToWindow();
          });
        }
        if (aDialog === 'DIALOG_TABLE_PROPERTIES') {
          const table = _aItems[0] as SCH_TABLE;
          const dlg = new DIALOG_TABLE_PROPERTIES(schFrameRef.current!, table);
          return new Promise<number>((resolve) =>
            setTableDialog({
              dlg,
              shown: dlg.TransferDataToWindow(),
              isNew: table.IsNew(),
              resolve,
            }),
          );
        }
        if (aDialog === 'DIALOG_TABLECELL_PROPERTIES') {
          // `dlg.ShowQuasiModal(); dlg.GetReturnValue()`: the cell dialog answers its return value.
          const dlg = new DIALOG_TABLECELL_PROPERTIES(
            schFrameRef.current!,
            _aItems as SCH_TABLECELL[],
          );
          return new Promise<number>((resolve) =>
            setCellDialog({ dlg, shown: dlg.TransferDataToWindow(), resolve }),
          );
        }
        if (aDialog === 'DIALOG_JUNCTION_PROPS') {
          const junctions = _aItems as SCH_JUNCTION[];
          const dlg = new DIALOG_JUNCTION_PROPS(schFrameRef.current!, junctions);
          return new Promise<number>((resolve) =>
            setJunctionDialog({
              dlg,
              shown: dlg.TransferDataToWindow(),
              firstDiameter: junctions[0]!.GetDiameter(),
              resolve,
            }),
          );
        }
        console.warn(`${aDialog} is not ported to the live model yet`);
        return wxID_CANCEL;
      },
      textEntry: (aMessage, aCaption, aValue) =>
        new Promise((resolve) =>
          setTextEntryRequest({ message: aMessage, caption: aCaption, value: aValue, resolve }),
        ),
      fileDialog: (aTitle, aDefaultDir, _aDefaultFile, aWildcard, aStyle) => {
        // The project's picker opens files; naming a new one to write is not ported yet.
        if (aStyle & wxFD_SAVE) {
          console.warn(`wxFileDialog(wxFD_SAVE) '${aTitle}' is not ported yet`);
          return null;
        }
        return new Promise((resolve) =>
          setFileDialogRequest({
            title: aTitle,
            defaultDir: aDefaultDir,
            filters: typeof aWildcard === 'string' ? [] : aWildcard,
            resolve,
          }),
        );
      },
      pickSymbol: (aFilter, aHistory, aPlaced, aShowFootprints) =>
        new Promise((resolve) =>
          setChooserRequest({
            filter: aFilter,
            history: aHistory,
            placed: aPlaced,
            showFootprints: aShowFootprints,
            resolve,
          }),
        ),
      crossProbingSettings: () => app.settings.eeschema.cross_probing,
      saveProject: () => saveProjectRef.current(),
      syncLiveSchematic: () => syncLiveRef.current(),
      modalAnnotate: (aMessage) => modalAnnotateRef.current(aMessage),
      symbolLibraryUri: (aNickname) => symbolLibraryUri(liveFilesRef.current.rawFiles)(aNickname),
      liveModified: () => liveModifiedRef.current(),
      liveSheetChanged: () => liveSheetChangedRef.current(),
    });
  }
  // `KIWAY::Player()` stores the frame it created as FRAME_SCH's player, and
  // the frame's close tells KIWAY it is gone (`PlayerDidClose`).
  useEffect(() => {
    const frame = schFrameRef.current!;
    if (!kiway) return;
    frame.SetKiway(kiway);
    kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, frame);
    return () => {
      kiway.PlayerDidClose(FRAME_T.FRAME_SCH, frame);
      frame.SetKiway(null);
    };
  }, [kiway]);
  /** Tools > Update PCB from Schematic (F8): `SCH_EDIT_FRAME::OnUpdatePCB`. */
  const onUpdatePcb = useMemo(
    () => (hasBoard && kiway ? () => schFrameRef.current!.OnUpdatePCB() : undefined),
    [hasBoard, kiway],
  );
  const { highlightName } = useMemo(() => {
    const items = new Set<string>();
    let name: string | null = null;
    if (netlist && highlightItem !== null) {
      name = connectionName(netlist, highlightItem);
      if (name !== null) {
        // UpdateNetHighlighting's connNames set: the net itself, the other
        // label forms of the same bus (GetEquivalentBusNames), the bus members
        // when that toggle is on, and every bus carrying the net (GetBusParents)
        // so a highlighted member lights the bus it rides on too.
        const connNames = new Set<string>([name]);
        for (const eq of equivalentBusNames(netlist, name)) connNames.add(eq);
        if (highlightBusMembers) {
          for (const b of netlist.buses)
            if (b.name && connNames.has(b.name)) for (const m of b.members) connNames.add(m);
        }
        for (const b of netlist.buses)
          if (b.name && b.members.some((m) => connNames.has(m))) connNames.add(b.name);

        for (const net of netlist.nets)
          if (connNames.has(net.name)) for (const item of net.items) items.add(item);
        for (const b of netlist.buses)
          if (b.name && connNames.has(b.name)) for (const item of b.items) items.add(item);
      }
    }
    return { highlightWires: items, highlightName: name };
  }, [netlist, highlightItem, highlightBusMembers]);

  // Cross-probe the highlight to the PCB editor.
  useEffect(() => {
    const frame = schFrameRef.current!;
    if (highlightName === null) frame.SendCrossProbeClearHighlight();
    else frame.SendCrossProbeNetName(highlightName);
  }, [highlightName]);

  // The live document for stable callbacks is `docRef`, kept by `setDoc`.
  // Which file that document is, for the same reason: an undo step is applied
  // inside a `setDoc` updater, where the state value of `currentFile` may be a
  // render behind.
  const currentFileRef = useRef(currentFile);
  currentFileRef.current = currentFile;
  /**
   * `grid.GetGrid().x` for the rules that measure in grid squares — right now
   * only `SCH_SELECTION_TOOL::Main`'s right-click test. A ref because
   * `gridSizeIU` is derived far below and these callbacks are built once.
   */
  const gridSizeIURef = useRef(0);
  // Group promotion (SCH_SELECTION_TOOL): clicking a member selects its whole
  // group, so every selection result expands through the document's groups.
  const promote = (ids: ReadonlySet<string>): ReadonlySet<string> =>
    docRef.current ? expandSelectionToGroups(docRef.current, ids) : ids;

  // The Selection Filter narrows a raw hit before it can enter the selection
  // (SCH_SELECTION_TOOL::itemPassesFilter): locked items and disabled item
  // types are dropped, so they can't be selected/moved/deleted.
  const selFilterRef = useRef(selFilter);
  selFilterRef.current = selFilter;
  const filterIds = (ids: ReadonlySet<string>): ReadonlySet<string> =>
    docRef.current ? applySelectionFilter(docRef.current, ids, selFilterRef.current) : ids;

  const onSelect = useCallback((raw: string | null, additive: boolean) => {
    // A selection does *not* clear the net highlight: upstream's highlightNet
    // never touches the selection and vice versa, the highlight lives until
    // Esc, `~`, or a highlight-tool click on empty space.
    setSelection((prev) => {
      if (raw === null) return additive ? prev : new Set();
      // The Selection Filter narrows a click before it can enter the selection.
      // A filtered-out hit behaves like empty space, except for a pin with the
      // Pins toggle off, which stands for the symbol that owns it
      // (SCH_SELECTION_TOOL::collectSelectable).
      const doc = docRef.current;
      const id = doc ? clickTarget(doc, raw, selFilterRef.current) : raw;
      if (id === null) return additive ? prev : new Set();
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) {
          // Toggling a grouped member off removes its whole group.
          for (const m of promote(new Set([id]))) next.delete(m);
        } else for (const m of promote(new Set([id]))) next.add(m);
        return next;
      }
      return new Set(promote(new Set([id])));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SCH_EDITOR_CONTROL::ClearHighlight, the net and the bus-member mode drop
  // together (`~`, Esc, or a click on empty space).
  const clearHighlight = useCallback(() => {
    setHighlightItem(null);
    setHighlightBusMembers(false);
  }, []);

  // Live values for the highlight callback, kept in refs so the canvas prop
  // stays stable across renders.
  const netlistRef = useRef(netlist);
  netlistRef.current = netlist;
  const highlightConnRef = useRef<string | null>(null);
  highlightConnRef.current = highlightName;

  /** Push a resolved selection state into both the state and its refs, so a
   *  second command in the same tick reads what the first one left. */
  const applySelectionState = useCallback((next: HoverSelection): void => {
    if (next.selection !== selectionRef.current) {
      selectionRef.current = next.selection;
      setSelection(next.selection);
    }
    if (next.hover !== hoverSelectionRef.current) {
      hoverSelectionRef.current = next.hover;
      setHoverSelection(next.hover);
    }
  }, []);

  /**
   * `SCH_SELECTION_TOOL::RequestSelection` — the one place an editing command
   * gets its target (sch_selection_tool.cpp:1945-1994).
   *
   * Every editor command that upstream routes through `RequestSelection` routes
   * through here, which is why hovering an unselected symbol and pressing R
   * rotates it, hovering one and pressing Delete deletes it, and so on: none of
   * those is a per-command feature, they are all this function.
   *
   * `SelectPoint`'s own two follow-ups are supplied here because they need the
   * editor's live settings: the Selection Filter (`clickTarget`) and group
   * promotion.
   */
  const requestTarget = useCallback(
    (scanTypes: ScanTypes): ReadonlySet<string> => {
      const d = docRef.current;
      if (!d) return new Set();
      const before: HoverSelection = {
        selection: selectionRef.current,
        hover: hoverSelectionRef.current,
      };
      const req = requestSelection(
        d,
        before,
        scanTypes,
        // `GetCursorPosition( true )` + the collector, both of which are the
        // canvas's: the editor knows neither the zoom nor the snapped cursor.
        [],
        (id) => {
          const target = clickTarget(d, id, selFilterRef.current);
          return target === null ? [] : promote(new Set([target]));
        },
      );
      applySelectionState(req.state);
      return req.target;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applySelectionState],
  );

  /** `if( selection.IsHover() ) RunAction( ACTIONS::selectionClear )`: the
   *  disposable selection a command picked up is thrown away when it finishes. */
  const finishCommand = useCallback((): void => {
    applySelectionState(
      clearHoverSelection({
        selection: selectionRef.current,
        hover: hoverSelectionRef.current,
      }),
    );
  }, [applySelectionState]);

  /**
   * Request → act → clear-if-hover: the shape every `SCH_EDIT_TOOL` handler
   * has, so each command states only its scan types and its body.
   */
  const withSelection = useCallback(
    (scanTypes: ScanTypes, act: (ids: ReadonlySet<string>) => void): void => {
      const ids = requestTarget(scanTypes);
      if (ids.size === 0) return;
      act(ids);
      finishCommand();
    },
    [requestTarget, finishCommand],
  );

  /**
   * Fold a history step back into the project.
   *
   * The step names every document it changed. The one on screen becomes the new
   * `doc`; the rest are written into the project and queued for the host, so a
   * single Ctrl+Z that reverts an edit spanning three sheets really does put all
   * three back — `PutDataInPreviousState` adding each item to the screen its own
   * picker names.
   *
   * Called from inside a `setDoc` updater, so it must not call `setState`: the
   * project's documents live in a ref, and the files are persisted after the
   * render.
   */
  const foldStep = useCallback(
    (step: ProjectStep | null, fallback: Schematic, persist = false): Schematic => {
      if (!step) return fallback;
      const here = currentFileRef.current;
      const changed: PickedFile[] = [];
      for (const [file, next] of step.docs) {
        // The open sheet is written to disk by the ordinary (debounced) save, so
        // it is reported only when the caller asked to persist right now.
        if (file === here && !persist && !saveRequestedRef.current) continue;
        if (file !== here) project.current.docs.set(file, next);
        try {
          changed.push({ name: file, text: serializeSchematic(next) });
        } catch {
          /* skip a bad sheet */
        }
      }
      if (changed.length) {
        pendingProjectChange.current.push(...changed);
        if (!applyingRemoteRef.current) pendingIsMine.current = true;
      }
      if (persist || saveRequestedRef.current) pendingPersist.current = true;
      // The one status whose undo navigates; see `EditCommand.pageSettings`.
      if (step.showSheet && step.showSheet !== here) pendingShowSheet.current = step.showSheet;
      return step.docs.get(here) ?? fallback;
    },
    [],
  );

  /** Files an edit or undo folded back, flushed to the host after the render. */
  const pendingProjectChange = useRef<PickedFile[]>([]);
  /**
   * Whether anything in the queued batch is MY work.
   *
   * A peer's edit is written to this machine -- it has to be, or a reload shows
   * a sheet older than the one on screen -- but it must not be pushed to the
   * cloud from here. Every peer holding the same change would otherwise race
   * the version compare-and-swap to commit bytes they did not author, N pushes
   * for one edit. The author's own push is what puts it there.
   *
   * Sticky across a batch and cleared with it: one local keystroke in the same
   * frame as a remote patch still has to reach the account.
   */
  const pendingIsMine = useRef(false);
  /** …and whether the caller wanted them written now rather than on the timer. */
  const pendingPersist = useRef(false);
  /**
   * `ClearUndoRedoList` asked for by an edit that has just been queued.
   *
   * The Project Rescue Helper is the one operation that drops the whole undo
   * history when it finishes; it cannot do it at the call site, because the
   * entry it is dropping has not been pushed yet — `runProject` folds inside a
   * `setDoc` updater, which React runs at the next render.
   */
  const pendingClearHistory = useRef(false);
  useEffect(() => {
    saveRequestedRef.current = false;
    assignPendingRef.current = false;
    if (pendingClearHistory.current) {
      pendingClearHistory.current = false;
      history.current.clear();
    }
    if (pendingProjectChange.current.length === 0) return;
    const files = pendingProjectChange.current;
    const persist = pendingPersist.current;
    const mine = pendingIsMine.current;
    pendingProjectChange.current = [];
    pendingPersist.current = false;
    pendingIsMine.current = false;
    onProjectChange?.(files, { push: mine });
    if (persist) onPersistFiles?.(files);
  });

  /** A sheet an undo asked to be shown (page settings), navigated to after. */
  const pendingShowSheet = useRef<string | null>(null);

  /**
   * The project's live documents as a history step must see them, from inside a
   * `setDoc` updater — the open sheet's edits are in `d`, not yet in the map.
   */
  const docsWith = (d: Schematic): Map<string, Schematic> =>
    new Map(project.current.docs).set(currentFileRef.current, d);

  /**
   * Run one edit as a SINGLE undo entry, over whichever sheets it touches.
   *
   * This is `SCH_COMMIT::Push`: the commit has staged each modified item with
   * the screen it belongs to, and pushes one `PICKED_ITEMS_LIST` onto the
   * frame's undo list. An edit confined to the open sheet is not a different
   * case, just a one-file one.
   */
  const runProject = useCallback(
    (edit: ProjectEdit, persist = false): void => {
      // The one choke point every edit funnels through, whichever sheets it
      // touches — see PcbEditor.tsx's own copy of this guard and
      // eeschema/project_sync_transport.ts's PeerRole.
      // applyingRemoteRef is what lets a remote update still land on a
      // Viewer's own tab while refusing a local edit.
      if (!applyingRemoteRef.current && myRoleRef.current === 'viewer') return;
      setDoc((d) => {
        if (!d) return d;
        const staged = new Map<string, EditCommand>();
        for (const [file, cmd] of edit) staged.set(file, withCleanup(cmd, libById));
        const docs = docsWith(d);
        // Undo is over MY operations. A peer's edit still lands on the
        // document -- that is the whole point of it arriving -- but it does not
        // become an entry on my stack and does not clear my redo. See
        // `ProjectHistory.applyUnrecorded`.
        const step = applyingRemoteRef.current
          ? history.current.applyUnrecorded(docs, staged)
          : history.current.execute(docs, staged);
        return foldStep(step, d, persist);
      });
    },
    [libById, foldStep],
  );

  /** The overwhelmingly common case: an edit on the sheet you are looking at. */
  const runCommand = useCallback(
    (cmd: EditCommand) => runProject(new Map([[currentFileRef.current, cmd]])),
    [runProject],
  );
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const runProjectRef = useRef(runProject);
  runProjectRef.current = runProject;

  // biome-ignore lint/correctness/useExhaustiveDependencies: everything it reads goes through refs or stable callbacks
  useEffect(() => {
    // Registered for as long as the frame exists, shown or not: the AI
    // works on the schematic while the board is on screen, and back.
    if (!registerScriptApi) return;
    return registerScriptApi({
      doc: () => docRef.current,
      runCommand: (cmd) => runCommandRef.current(cmd),
      annotatePlacement: (sym, lib) => annotatePlacementRef.current(sym, lib),
      loadSymbol: (library, name) => app.loadSymbol(library, name),
      erc: () => ercNowRef.current(),
      symbolIndex: () => app.loadIndex(),
      footprintIndex: () => app.loadFootprintIndex(),
      snapshot: () => snapshotRef.current(),
      undo: () => undoRef.current(),
      docs: () => {
        const docs = new Map(project.current.docs);
        if (docRef.current) docs.set(currentFileRef.current, docRef.current);
        return docs;
      },
      currentFile: () => currentFileRef.current,
      runCommandOn: (file, cmd) => runProjectRef.current(new Map([[file, cmd]])),
      editLive: (aEdit) => editLiveRef.current(aEdit),
      readLive: (aRead) => (syncLiveRef.current() ? aRead(schFrameRef.current!) : null),
    });
  }, [registerScriptApi]);

  const undo = useCallback(
    () => setDoc((d) => (d ? foldStep(history.current.undo(docsWith(d)), d) : d)),
    [foldStep],
  );
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redo = useCallback(
    () => setDoc((d) => (d ? foldStep(history.current.redo(docsWith(d)), d) : d)),
    [foldStep],
  );

  // The schematic hierarchy (SCH_SHEET_LIST): rebuilt from the live documents so
  // sheet edits (adding/renaming sheets) reflect immediately.
  const sheetTree = useMemo<SheetTreeNode | null>(() => {
    if (!doc) return null;
    const docs = new Map(project.current.docs);
    docs.set(currentFile, doc);
    return buildSheetTree(docs, project.current.root);
  }, [doc, currentFile]);

  // Depth-first hierarchy order (virtual page numbers) + Back/Forward history
  // (SCH_NAVIGATE_TOOL). Sheet edits prune dead history entries (CleanHistory).
  const flatSheets = useMemo<SheetRef[]>(
    () => (sheetTree ? flattenHierarchy(sheetTree) : []),
    [sheetTree],
  );

  // The same DFS with each instance's sheet name and human-readable path
  // (SCH_SHEET_PATH::PathHumanReadable), the title block's ${SHEETNAME} /
  // ${SHEETPATH} context for the screen and for printed pages.
  const sheetInstanceRefs = useMemo<
    { file: string; path: string; name: string; namePath: string }[]
  >(() => {
    const refs: { file: string; path: string; name: string; namePath: string }[] = [];
    const walk = (n: SheetTreeNode, parentNames: string): void => {
      const namePath = n.path === '/' ? '/' : `${parentNames}${n.name}/`;
      refs.push({ file: n.file, path: n.path, name: n.name, namePath });
      for (const c of n.children) walk(c, namePath);
    };
    if (sheetTree) walk(sheetTree, '/');
    return refs;
  }, [sheetTree]);

  const navTool = useRef(new SchNavigateTool());
  useEffect(() => {
    navTool.current.cleanHistory(new Set(flatSheets.map((s) => s.path)));
  }, [flatSheets]);

  // Bumped after editing a page number in a sheet's *parent* document, so any
  // page-number display refreshes even though `doc`/`currentFile` didn't change.
  const [, forcePageRefresh] = useState(0);

  // Live documents with the on-screen sheet's edits folded in.
  const liveDocs = useCallback((): Map<string, Schematic> => {
    const docs = new Map(project.current.docs);
    if (doc) docs.set(currentFile, doc);
    return docs;
  }, [doc, currentFile]);

  /**
   * The Net Navigator's tree, across the whole hierarchy.
   *
   * `MakeNetNavigatorNode` collects every subgraph of a net — over all sheets —
   * and appends a node per sheet path with that sheet's items beneath it, so a
   * signal crossing three sheets shows three sheet nodes.
   *
   * That needs a hierarchy-wide netlist, far too expensive to keep current on
   * every keystroke, so it is built only while the pane is open. Upstream gates
   * it the same way: `RefreshNetNavigator` returns early on
   * `!m_netNavigator->IsShownOnScreen()`.
   *
   * Each label is upstream's: the root sheet's name — its file name when the
   * field is empty — then one "/<name>" per level below it.
   */
  const netNavigatorTree = useMemo(() => {
    if (!toggles.has('showNetNavigator') || !doc) return [];
    const docs = liveDocs();
    const base = (project.current.root ?? '').replace(/\.kicad_sch$/i, '');
    const sheets = sheetInstanceRefs
      .map((ref) => {
        const sheetDoc = docs.get(ref.file);
        if (!sheetDoc) return null;
        const names = ref.namePath.split('/').filter(Boolean);
        return { path: ref.path, file: ref.file, doc: sheetDoc, label: [base, ...names].join('/') };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (sheets.length === 0) return [];
    // The same formatter `fmt` is, built here from the unit toggles: `fmt`
    // itself is a fresh closure every render, and depending on it would rebuild
    // the hierarchy netlist on every one of them.
    const u = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
    const format = (iu: number): string => {
      const mm = iuToMM(iu);
      if (u === 'mm') return `${mm.toFixed(4)}`;
      if (u === 'mils') return `${(mm / 0.0254).toFixed(2)}`;
      return `${(mm / 25.4).toFixed(4)}`;
    };
    return buildNetNavigatorHierarchy(
      sheets,
      (sheet) => new Map(sheet.doc.libSymbols.map((l) => [l.libId, l])),
      format,
      { busAliases },
    );
  }, [toggles, doc, liveDocs, sheetInstanceRefs, busAliases]);

  // ----- Choose Symbol dialog (DIALOG_SYMBOL_CHOOSER) ----------------------------
  /**
   * Dismissed by Cancel, and reopened by the next click.
   *
   * `PickSymbolFromLibrary` returning an invalid LIB_ID is a `continue`
   * (sch_drawing_tools.cpp:416-419): back to the top of `Wait()` with no
   * `PopTool` and no `break`, so the TOOL STAYS ACTIVE and the chooser comes
   * back on the next click, which is the click branch that opened it in the
   * first place (:371-375). Ours called `setActiveTool('select')`, dropping the
   * tool the moment the dialog closed.
   *
   * It cannot simply be derived from "the tool is active and nothing is on the
   * cursor", because that is true again the instant Cancel returns and the
   * dialog would reopen forever. Upstream is event-driven and so is this.
   */
  /**
   * The Selection Filter's close box, which holds only until its visibility is
   * derived again.
   *
   * The pane has no visibility control of its own - upstream's own comment,
   * "Don't give the selection filter its own visibility controls; instead show
   * it if anything else is visible" - but its pane info still asks for
   * `.CloseButton( true )` (eeschema_settings.cpp:120). Closing it hides the
   * pane, and the next `updateSelectionFilterVisbility` writes the derived
   * answer back over it (sch_edit_frame.cpp:2817-2831). That runs whenever a
   * pane opens or closes, which is what clears the latch here.
   */
  const [selectionFilterClosed, setSelectionFilterClosed] = useState(false);

  const [chooserDismissed, setChooserDismissed] = useState(false);
  const chooserOpen =
    (activeTool === 'placeSymbol' || activeTool === 'placePower') && !placeLib && !chooserDismissed;

  /**
   * The selection goes dark as the chooser OPENS, not when you pick from it.
   *
   * `selectionClear` is the first statement inside the click branch's
   * `if( !symbol )`, ahead of the whole already-placed scan and of
   * `PickSymbolFromLibrary` itself (sch_drawing_tools.cpp:375-377):
   *
   *     if( !symbol )
   *     {
   *         m_toolMgr->RunAction( ACTIONS::selectionClear );
   *         ...
   *         PICKED_SYMBOL sel = m_frame->PickSymbolFromLibrary( ... );
   *
   * so the symbol placed a moment ago is unhighlighted the instant the dialog
   * appears — which is also the instant `A` primes the tool, since the prime
   * IS that click. Ours held the highlight through the whole chooser session.
   */
  useEffect(() => {
    if (chooserOpen) setSelection(new Set());
  }, [chooserOpen]);

  /**
   * Activating the tool primes it, and a primed event IS a click here.
   * `PrimeTool` posts `TOOL_EVENT( TC_MOUSE, TA_PRIME, BUT_LEFT )`
   * (tool_manager.cpp:414-430); `TA_PRIME` is 0x800001 and carries
   * `TA_MOUSE_CLICK`'s 0x0001 bit, and `IsClick()` tests exactly that bit
   * (tool_event.cpp:212-215). With `input.immediate_actions` set, which is its
   * default (common_settings.cpp:251-252), the tool therefore opens its chooser
   * on activation without the user clicking anything.
   */
  useEffect(() => {
    setChooserDismissed(false);
  }, [activeTool]);

  /** `updateSelectionFilterVisbility` runs on every pane show/hide. */
  const selFilterInputs = `${toggles.has('showNetNavigator')}|${toggles.has('showHierarchy')}|${toggles.has('showProperties')}`;
  useEffect(() => {
    setSelectionFilterClosed(false);
  }, [selFilterInputs]);

  // The stored page number of the sheet instance at `path`
  // (SCH_SHEET_PATH::GetPageNumber): the root sheet from the document-level
  // sheet_instances, a sub-sheet from its object's instances in the parent doc.
  const pageNumberOf = useCallback(
    (path: string): string => {
      const docs = liveDocs();
      const rootDoc = docs.get(project.current.root);
      if (path === '/') return rootDoc ? getRootPageNumber(rootDoc) : '';
      const rootUuid = rootDoc?.uuid;
      if (!rootUuid) return '';
      const chain = path.split('/').filter(Boolean);
      const ownUuid = chain[chain.length - 1];
      const parent = flatSheets.find((s) => s.path === (parentPath(path) ?? '/'));
      const parentDoc = docs.get(parent?.file ?? project.current.root);
      const sheet = parentDoc?.sheets.find((s) => s.uuid === ownUuid);
      return sheet ? getSheetPageNumber(sheet, instanceKey(rootUuid, chain)) : '';
    },
    [liveDocs, flatSheets],
  );

  /** The link combo's page entries: "#<page>" labelled "Page 3 (Power)", as
   *  DIALOG_TEXT_PROPERTIES fills m_hyperlinkCombo from Schematic().Hierarchy(). */
  const linkPages = useMemo<{ value: string; label: string }[]>(() => {
    return flatSheets.map((ref) => {
      const page = pageNumberOf(ref.path);
      const name =
        ref.path === '/'
          ? '<root sheet>'
          : (sheetInstanceRefs.find((r) => r.path === ref.path)?.name ?? ref.file);
      return { value: `#${page}`, label: `Page ${page} (${name})` };
    });
  }, [flatSheets, pageNumberOf, sheetInstanceRefs]);

  // Set the current sheet's page number (SCH_ACTIONS::editPageNumber →
  // SCH_SHEET_PATH::SetPageNumber). The root edits its own document; a sub-sheet
  // edits its object in the *parent* document (through that doc's own history).
  const editPageNumber = useCallback(
    (page: string, target?: { index: number; uuid: string }) => {
      // SCH_EDIT_TOOL::EditPageNumber with a sheet selected edits *that*
      // sheet's instance under the open sheet, not the open sheet's own:
      //
      //   SCH_SHEET_PATH instance = m_frame->GetCurrentSheet();
      //   instance.push_back( sheet );
      //
      // so the path is the current one with the selected sheet pushed on.
      if (target) {
        const docs = liveDocs();
        const rootUuid = docs.get(project.current.root)?.uuid;
        if (!rootUuid) return;
        const chain = [...currentPath.split('/').filter(Boolean), target.uuid];
        runCommand(setSheetPageNumberCommand(target.index, instanceKey(rootUuid, chain), page));
        return;
      }
      if (currentPath === '/') {
        runCommand(setRootPageNumberCommand(page));
        return;
      }
      const docs = liveDocs();
      const rootUuid = docs.get(project.current.root)?.uuid;
      if (!rootUuid) return;
      const chain = currentPath.split('/').filter(Boolean);
      const ownUuid = chain[chain.length - 1];
      const parent = flatSheets.find((s) => s.path === (parentPath(currentPath) ?? '/'));
      const parentFile = parent?.file ?? project.current.root;
      const parentDoc = parentFile === currentFile ? doc : project.current.docs.get(parentFile);
      if (!parentDoc) return;
      const sheetIndex = parentDoc.sheets.findIndex((s) => s.uuid === ownUuid);
      if (sheetIndex === -1) return;
      const cmd = setSheetPageNumberCommand(sheetIndex, instanceKey(rootUuid, chain), page);
      // The sheet object lives in the PARENT document, which may not be the one
      // on screen. One entry either way: the stack is the project's.
      runProject(new Map([[parentFile, cmd]]));
      if (parentFile !== currentFile) forcePageRefresh((n) => n + 1);
    },
    [currentPath, currentFile, doc, flatSheets, liveDocs, runProject],
  );

  // Find / Find and Replace (SCH_FIND_REPLACE_TOOL): modeless dialog state
  // (false, or which mode it opened in), the search settings, and a cursor
  // over the matches across sheet instances in hierarchy order.
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [searchData, setSearchData] = useState<SchSearchData>(defaultSearchData);
  const [findStatus, setFindStatus] = useState('');
  const findCursor = useRef(-1);
  const lastMatch = useRef<{ id: string } | null>(null);
  const openFindDialog = useCallback((mode: 'find' | 'replace') => {
    setFindOpen(mode);
    // Replace mode excludes reference designators from matches unless opted in.
    setSearchData((d) => ({ ...d, searchAndReplace: mode === 'replace' }));
  }, []);

  // Annotate Schematic (SCH_EDIT_FRAME::AnnotateSymbols) dialog.
  const [annotateOpen, setAnnotateOpen] = useState(false);
  // SCH_ACTIONS::incrementAnnotations, a small dialog of its own.
  const [incrementAnnotationsOpen, setIncrementAnnotationsOpen] = useState(false);
  // SCH_EDIT_TOOL::GlobalEdit (Edit Text & Graphics Properties).
  const [globalEditOpen, setGlobalEditOpen] = useState(false);
  // DIALOG_EDIT_SYMBOLS_LIBID (Bulk Edit Symbol Library Links).
  const [libIdsOpen, setLibIdsOpen] = useState(false);
  const [libIdErrors, setLibIdErrors] = useState<readonly string[]>([]);
  // DIALOG_CHANGE_SYMBOLS, in whichever of its two modes was asked for.
  /**
   * The symbol DIALOG_CHANGE_SYMBOLS was opened ON, which it seeds all three
   * match entries from — `m_symbol` is its second constructor argument and
   * `TransferDataToWindow` (:146-152) fills reference, value and library id
   * from it. Null when it is opened from the Tools menu, and then upstream
   * hides the "selected symbol(s)" radio outright.
   */
  // Page Settings (DIALOG_PAGES_SETTINGS), Print (DIALOG_PRINT) and Plot
  // (DIALOG_PLOT_SCHEMATIC) dialogs, open flags.
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  // Raw project files (kept for the .kicad_pro drawing-sheet reference and the
  // project's .kicad_wks files); reseeded whenever a project is (re)opened.
  const [rawFiles, setRawFiles] = useState<PickedFile[]>(() => initialProject ?? []);
  // In-session Page Settings override of the drawing sheet: `name` '' = built-in
  // default. Persisted to .kicad_pro (schematic.page_layout_descr_file) on OK;
  // otherwise the sheet is resolved from the project like KiCad does.
  const [sheetOverride, setSheetOverride] = useState<{
    name: string;
    sheet: WksSheet | null;
  } | null>(null);
  // Project files plus any .kicad_wks saved this session (the .kicad_pro
  // reference lives in rawFiles; the sheets themselves may come from either).
  const allFiles = useMemo(
    () => (extraSheetFiles?.length ? [...rawFiles, ...extraSheetFiles] : rawFiles),
    [rawFiles, extraSheetFiles],
  );
  // The drawing sheet to draw (override else the project reference) and its
  // file name for `SetWksFileName` in the Page Settings dialog.
  const activeSheet = useMemo(
    () => (sheetOverride ? sheetOverride.sheet : resolveActiveSheet(allFiles)),
    [allFiles, sheetOverride],
  );
  const sheetRefName = sheetOverride ? sheetOverride.name : readSheetRef(rawFiles);
  // WX_INFOBAR message posted by a tool (null = hidden).
  const [infoBar, setInfoBar] = useState<string | null>(null);
  /**
   * `SetStatusText( msg, 0 )` — field 0 of the status bar. wx leaves whatever
   * was written there until something writes over it, so this is state rather
   * than a transient toast. The highlight message shares the field and takes
   * precedence while a net is actually highlighted.
   */
  const [statusText, setStatusText] = useState<string>('');
  // `EDA_BASE_FRAME::SetStatusText` from the frame: field 0 is state (the net highlight shares
  // it); zoom, coordinates and deltas (SCH_BASE_FRAME::UpdateStatusBar on every event) are
  // written straight to their panes, so the pointer's motion re-renders nothing.
  const statusPaneRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  useEffect(() => {
    const frame = schFrameRef.current!;
    frame.SetStatusTextSink((aText, aField) => {
      if (aField === 0) {
        setStatusText(aText);
        return;
      }
      const name = KISTATUSBAR_FIELDS[aField];
      const el = name && name !== 'grid' && name !== 'units' ? statusPaneRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    return () => frame.SetStatusTextSink(null);
  }, []);
  /** ACTIONS::revert's IsOK(), while it is up. */
  const [revertPrompt, setRevertPrompt] = useState<{
    file: string;
    onYes: () => void;
    onNo: () => void;
  } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [plotOpen, setPlotOpen] = useState(false);
  // Folders that already exist inside the project, relative to the project's
  // own folder, the Plot dialog's "Output directory:" browse choices (the
  // cloud file manager stands in for upstream's wxDirDialog).
  const projectFolders = useMemo(() => {
    const pro = rawFiles.find((f) => /\.kicad_pro$/i.test(f.name))?.name.replace(/\\/g, '/');
    const prefix = pro?.includes('/') ? pro.slice(0, pro.lastIndexOf('/') + 1) : '';
    const dirs = new Set<string>();
    for (const f of rawFiles) {
      const p = f.name.replace(/\\/g, '/');
      if (prefix && !p.startsWith(prefix)) continue;
      const rel = p.slice(prefix.length);
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (dir) dirs.add(dir);
    }
    return [...dirs];
  }, [rawFiles]);
  // Paste Special (DIALOG_PASTE_SPECIAL): pick the PASTE_MODE before pasting.
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false);
  // Schematic Setup (DIALOG_SCHEMATIC_SETUP): project-scoped settings, incl. the
  // ERC severities + pin-conflict map that the ERC checker reads. (The setup
  // state itself is declared above the netlist memo, which consumes it.)
  const [setupOpen, setSetupOpen] = useState(false);
  // Generate Bill of Materials (Symbol Fields Table export) dialog.
  const [bomOpen, setBomOpen] = useState(false);
  // Export Netlist (DIALOG_EXPORT_NETLIST) dialog.
  const [netlistOpen, setNetlistOpen] = useState(false);
  // Bulk Edit Symbol Fields (Symbol Fields Table edit view) dialog.
  const [fieldsTableOpen, setFieldsTableOpen] = useState(false);
  // Symbol Library Browser (SYMBOL_VIEWER_FRAME).
  const [browserOpen, setBrowserOpen] = useState(false);
  // Assign Footprints (CVPCB_MAINFRAME).
  const [assignFpOpen, setAssignFpOpen] = useState(false);
  // The sheets of THIS design, in hierarchy order, cvpcb is handed the
  // current schematic's netlist, so sibling projects sharing the folder (and
  // sheets reached twice) must not add rows.
  const assignFpFiles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of sheetInstanceRefs) {
      if (seen.has(s.file)) continue;
      seen.add(s.file);
      out.push(s.file);
    }
    return out.length > 0 ? out : [currentFile];
  }, [sheetInstanceRefs, currentFile]);
  // The project's own `.pretty` libraries (the fp-lib-table's project scope),
  // which Assign Footprints lists ahead of the global libraries. The table
  // itself comes along: it holds the library nicknames the FPIDs are written
  // with ("Footprints:…" for `${KIPRJMOD}/footprints.pretty`).
  const projectFootprintFiles = useMemo(
    () =>
      rawFiles
        .filter(
          (f) =>
            /\.kicad_mod$/i.test(f.name) ||
            /(^|\/)fp-lib-table$/i.test(f.name) ||
            // The `.equ` footprint association files, which automatic
            // association reads, and the `.kicad_pro` that lists them at
            // `cvpcb.equivalence_files`.
            /\.equ$/i.test(f.name) ||
            /\.kicad_pro$/i.test(f.name),
        )
        .map((f) => ({ name: f.name, text: f.text })),
    [rawFiles],
  );
  // Manage Footprint Libraries: write the project's `fp-lib-table` (creating it
  // next to the `.kicad_pro` when the project has none) and keep it in memory,
  // so a library registered here resolves immediately.
  const saveProjectFpLibTable = useCallback(
    (rows: FpLibRow[]) => {
      const name = projectFpLibTablePath(rawFiles);
      const text = serializeFpLibTable(rows);
      setRawFiles((prev) => {
        const has = prev.some((f) => f.name === name);
        return has
          ? prev.map((f) => (f.name === name ? { ...f, text } : f))
          : [...prev, { name, text }];
      });
      onPersistFiles?.([{ name, text }]);
    },
    [rawFiles, onPersistFiles],
  );
  // Manage Footprint Association Files' OK: `cvpcb.equivalence_files` into the
  // project's `.kicad_pro` (upstream's `SaveProject()`,
  // dialog_config_equfiles.cpp:116), plus any `.equ` file Add brought in from
  // outside the project — which has to be written too, because
  // `buildEquivalenceList` re-reads the reference on every press.
  const saveProjectEquFiles = useCallback(
    (files: readonly string[], newFiles: readonly { name: string; text: string }[]) => {
      const pro = findProjectPro(rawFiles);
      const written: { name: string; text: string }[] = [...newFiles];
      if (pro) {
        const text = writeEquivalenceFilesText(pro.text, files);
        if (text !== null) written.push({ name: pro.name, text });
      }
      if (written.length === 0) return;
      setRawFiles((prev) => {
        const byName = new Map(written.map((f) => [f.name, f.text]));
        const updated = prev.map((f) =>
          byName.has(f.name) ? { ...f, text: byName.get(f.name) as string } : f,
        );
        const known = new Set(prev.map((f) => f.name));
        return [...updated, ...written.filter((f) => !known.has(f.name))];
      });
      onPersistFiles?.(written);
    },
    [rawFiles, onPersistFiles],
  );
  // Manage Symbol Libraries: the same for the project's `sym-lib-table`. A row
  // written here is what makes the library exist — SYMBOL_LIB_TABLE resolves a
  // LIB_ID's nickname through this table, so nothing else can register one.
  const saveProjectSymLibTable = useCallback(
    (rows: FpLibRow[]) => {
      const name = projectSymLibTablePath(rawFiles);
      const text = serializeSymLibTable(rows);
      setRawFiles((prev) => {
        const has = prev.some((f) => f.name === name);
        return has
          ? prev.map((f) => (f.name === name ? { ...f, text } : f))
          : [...prev, { name, text }];
      });
      onPersistFiles?.([{ name, text }]);
      // The table decides what ERC can resolve, so drop the cached library set.
      ercSymbolLibs.current = null;
      ercLibrarySymbols.current = new Map();
      ercUnloadedSymbolLibs.current = new Map();
    },
    [rawFiles, onPersistFiles],
  );
  const [symLibTableOpen, setSymLibTableOpen] = useState(false);
  /** The hosted library nicknames, the global table's stand-in in the dialog.
   *  Fetched when it first opens; the ERC cache is not reused because a run
   *  merges the project's own rows into it. */
  const [hostedSymbolLibs, setHostedSymbolLibs] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!symLibTableOpen || hostedSymbolLibs.length > 0) return;
    void loadIndex()
      .then((index) => setHostedSymbolLibs(index.map((lib) => lib.name)))
      .catch(() => setHostedSymbolLibs([]));
  }, [symLibTableOpen, hostedSymbolLibs.length, loadIndex]);

  // The Annotation Messages the last Annotate / Clear Annotation run produced;
  // the dialog stays open showing them (WX_HTML_REPORT_PANEL).
  const [annotateMessages, setAnnotateMessages] = useState<readonly ReportLine[]>([]);

  // Page Settings (DIALOG_PAGES_SETTINGS::onOK): write paper + title block back
  // through an undoable command; fields with "Export to other sheets" checked
  // are copied into every other sheet file (upstream's OnOkClick loop), via
  // the same cross-document pattern as the bulk field edits.
  const applyPageSettings = useCallback(
    (next: PageSettings, exports: PageExportFlags, sheet: WksSheet | null, sheetName: string) => {
      runCommand(setPageSettingsCommand(next));
      // The ticks themselves are persisted by DIALOG_EESCHEMA_PAGE_SETTINGS —
      // its destructor, which is `onStoreExports` at the call site. They are a
      // preference rather than one-shot dialog state: `InitSheet` consults them
      // when a *new* sheet is created, so a project that wants its title
      // carried onto every sheet only says so once.
      // Adopt the chosen drawing sheet (name '' = built-in default) and persist
      // it into .kicad_pro (schematic.page_layout_descr_file), like KiCad.
      setSheetOverride({ name: sheetName, sheet });
      setRawFiles((prev) => {
        const pro = prev.find((f) => /\.kicad_pro$/i.test(f.name));
        if (!pro) return prev;
        const updated = writeSheetRefText(pro.text, sheetName);
        if (updated === null || updated === pro.text) return prev;
        const changed = { name: pro.name, text: updated };
        // Persist the reference now (not via the debounced autosave) so a
        // reopen straight after picking the sheet reads it back.
        onPersistFiles?.([changed]);
        return prev.map((f) => (f.name === pro.name ? changed : f));
      });
      const anyExport =
        exports.paper ||
        exports.date ||
        exports.rev ||
        exports.title ||
        exports.company ||
        exports.comments.some(Boolean);
      if (anyExport) {
        const changedFiles: PickedFile[] = [];
        for (const [file, target] of project.current.docs) {
          if (file === currentFile) continue;
          const cur = getPageSettings(target);
          const merged: PageSettings = {
            paper: exports.paper ? next.paper : cur.paper,
            date: exports.date ? next.date : cur.date,
            rev: exports.rev ? next.rev : cur.rev,
            title: exports.title ? next.title : cur.title,
            company: exports.company ? next.company : cur.company,
            comments: cur.comments.map((c, i) =>
              exports.comments[i] ? (next.comments[i] ?? c) : c,
            ),
          };
          // No undo entry for the exported sheets, because upstream makes
          // none: `onSavePageSettings` walks `SCH_SCREENS` and calls
          // `SetPageSettings` / `SetTitleBlock` on each other screen straight
          // out (`dialog_eeschema_page_settings.cpp:134-180`), while the only
          // thing on the undo list is the `DS_PROXY_UNDO_ITEM` for THIS screen
          // pushed before the dialog opened (`sch_editor_control.cpp:503-509`).
          // Ctrl+Z after exporting a title to twelve sheets takes back this
          // sheet's page settings and leaves the other twelve as they now are.
          const updated = withCleanup(setPageSettingsCommand(merged), libById).apply(target);
          project.current.docs.set(file, updated);
          try {
            changedFiles.push({ name: file, text: serializeSchematic(updated) });
          } catch {
            /* skip a bad sheet */
          }
        }
        if (changedFiles.length) onProjectChange?.(changedFiles);
      }
      setPageSettingsOpen(false);
    },
    [runCommand, currentFile, onProjectChange, onPersistFiles, libById],
  );

  // A base file name for a printed/plotted output (KiCad names plots after the
  // sheet file): the current sheet's name without extension, else the title.
  const outputBaseName = useCallback((): string => {
    const base = currentFile !== DEFAULT_FILE ? currentFile : (fileName ?? '');
    const noExt = base.replace(/\.kicad_sch$/i, '');
    return noExt || doc?.titleBlock?.title || 'schematic';
  }, [currentFile, fileName, doc]);

  // Commit a new SchematicSetup: adopt it and write the project's .kicad_pro
  // (SCHEMATIC_SETTINGS / ERC_SETTINGS / NET_SETTINGS all live there),
  // preserving every key the dialog does not own, same flow as the
  // drawing-sheet reference in applyPageSettings. Used by the Schematic Setup
  // dialog's OK and by dialogs that write single settings back (Annotate).
  const commitSetup = useCallback(
    (next: SchematicSetup) => {
      setSetup(next);
      setRawFiles((prev) => {
        const pro = findProjectPro(prev, rootPro ?? undefined);
        if (!pro) return prev;
        const updated = writeSchematicSetupText(pro.text, next);
        if (updated === null || updated === pro.text) return prev;
        const changed = { name: pro.name, text: updated };
        // Persist now (not via the debounced autosave) so a reopen straight
        // after the dialog reads the new settings back.
        onPersistFiles?.([changed]);
        return prev.map((f) => (f.name === pro.name ? changed : f));
      });
    },
    [rootPro, onPersistFiles],
  );

  // Per-item netclass render fallbacks (wire colour/width/style, junction
  // clamp) for the current sheet, reuses the connectivity memo; undefined
  // when no class carries a visual parameter.
  // Keyed on connDoc alongside the graph it resolves against, the ids in the
  // override maps are only meaningful for the document the netlist was built
  // from. An item added since simply has no override for a frame.
  const netOverrides = useMemo(
    () =>
      connDoc
        ? computeNetClassOverrides(connDoc, libById, setup, netlist, [
            // Netclass directive labels assign to whatever net they sit on.
            ...directiveNetclassAssignments(connDoc, netlist),
            // ...and a rule area assigns to every net it encloses, from the
            // directives attached to its border. `GetNetclassesForDriver`
            // concatenates the two sources the same way.
            ...ruleAreaNetclassAssignments(connDoc, libById, netlist),
          ])
        : undefined,
    [connDoc, libById, setup, netlist],
  );

  // `${VAR}` resolver for a document: project text variables (Schematic Setup
  // > Text Variables) + the sheet's title block + sheet/file tokens, per
  // PROJECT / TITLE_BLOCK / SCHEMATIC TextVarResolver.
  const resolverForDoc = useCallback(
    (d: Schematic, file: string, path = '/') => {
      const ps = getPageSettings(d);
      return schematicTextVarResolver({
        textVars: Object.fromEntries(
          setup.textVars.filter((v) => v.name).map((v) => [v.name, v.value]),
        ),
        titleBlock: {
          title: ps.title,
          date: ps.date,
          rev: ps.rev,
          company: ps.company,
          comments: ps.comments,
        },
        sheetName: path === '/' ? 'Root' : (path.split('/').filter(Boolean).pop() ?? 'Root'),
        sheetPath: path,
        fileName: file,
        ...(projectName ? { projectName } : {}),
      });
    },
    [setup.textVars, projectName],
  );
  const resolveTextVar = useMemo(
    () => (doc ? resolverForDoc(doc, currentFile, currentPath) : undefined),
    [doc, resolverForDoc, currentFile, currentPath],
  );

  // The hierarchy as an annotation pass sees it (SCH_SHEET_LIST + the scope
  // switch in AnnotateSymbols): every sheet in DFS order carrying its virtual
  // page number, tagged with how the chosen scope treats it. A file used by
  // more than one sheet instance appears once, a reference lives on the
  // symbol here, not per sheet-instance path.
  const annotateSheets = useCallback(
    (scope: AnnotateOptions['scope'], recursive: boolean): AnnotateSheet[] => {
      const docs = liveDocs();
      // Sub-sheets of the current sheet, and (for a selection) the subtrees of
      // any selected sheet symbol.
      const selectedSheetPaths: string[] = [];
      if (scope === 'selection' && recursive && doc) {
        doc.sheets.forEach((sh, i) => {
          if (selection.has(refId('sheet', sh.uuid, i)))
            selectedSheetPaths.push(`${currentPath}${sh.uuid || `i${i}`}/`);
        });
      }
      const seen = new Set<string>();
      const sheets: AnnotateSheet[] = [];
      flatSheets.forEach((s, i) => {
        const d = docs.get(s.file);
        if (!d || seen.has(s.file)) return;
        seen.add(s.file);
        const isCurrent = s.file === currentFile;
        const belowCurrent = s.path.startsWith(currentPath) && s.path !== currentPath;
        const inSelectedSubtree = selectedSheetPaths.some((p) => s.path.startsWith(p));
        let sheetScope: AnnotateSheet['scope'] = 'out';
        if (scope === 'all') sheetScope = 'full';
        else if (isCurrent) sheetScope = scope === 'selection' ? 'selected' : 'full';
        else if (scope === 'current_sheet' && recursive && belowCurrent) sheetScope = 'full';
        else if (scope === 'selection' && inSelectedSubtree) sheetScope = 'full';
        sheets.push({ file: s.file, doc: d, sheetNumber: i + 1, scope: sheetScope });
      });
      return sheets;
    },
    [liveDocs, flatSheets, currentFile, currentPath, doc, selection],
  );

  /** Library symbols of every sheet taking part, for unit counts. */
  const hierarchyLibs = useCallback(
    (sheets: readonly AnnotateSheet[]): Map<string, LibSymbol> => {
      const libs = new Map(libById);
      for (const s of sheets)
        for (const l of s.doc.libSymbols) if (!libs.has(l.libId)) libs.set(l.libId, l);
      return libs;
    },
    [libById],
  );

  /**
   * Everything `SCH_EDITOR_CONTROL::Paste` reads off the frame and the project
   * before it starts (sch_editor_control.cpp:2199-2257, :2604-2606):
   *
   *   - the PASTE_MODE the annotation toggle implies —
   *     `pasteMode = annotateAutomatic ? UNIQUE_ANNOTATIONS : REMOVE_ANNOTATIONS`
   *     (:2203). Plain Ctrl+V used to ignore the toggle entirely and always
   *     re-annotate;
   *   - the whole hierarchy, `Schematic().Hierarchy()` (:2222), because
   *     reference uniqueness is a hierarchy-wide question (:2249). It used to
   *     be computed against the one open sheet, so copying R5 on sheet 2 and
   *     pasting on sheet 1 kept R5 and collided;
   *   - the project's annotation settings and REFDES_TRACKER, so the paste's
   *     re-annotation numbers the way the Annotate dialog would.
   *
   * `mode` overrides the toggle, which is what DIALOG_PASTE_SPECIAL does.
   */
  const pasteOptions = useCallback(
    (mode?: PasteMode): PasteOptions => {
      const tracker = new REFDES_TRACKER();
      tracker.Deserialize(setup.usedDesignators);
      tracker.SetReuseRefDes(setup.annotation.allowReuse);
      const defaultMode: PasteMode = es.annotation.automatic ? 'unique' : 'remove';
      const page = flatSheets.findIndex((s) => s.path === currentPath);
      return {
        mode: mode ?? defaultMode,
        // Every sheet only reserves its references here; a paste renumbers
        // nothing that was already on a sheet.
        hierarchy: annotateSheets('all', true).map((s) => ({ ...s, scope: 'out' as const })),
        sheetNumber: page >= 0 ? page + 1 : 1,
        annotate: {
          // The same project settings DIALOG_ANNOTATE seeds itself from.
          order: setup.annotation.sortOrder,
          algo:
            setup.annotation.numbering === 'sheetX100'
              ? 'sheet_100'
              : setup.annotation.numbering === 'sheetX1000'
                ? 'sheet_1000'
                : 'incremental',
          startNumber: setup.annotation.firstFreeAfter,
          tracker,
        },
        // `forceRemoveAnnotations` (:2213): only an *explicit* Paste Special
        // choice of "remove annotations" that was not already the default, and
        // it is what stops the "already in the schematic" rule putting them
        // back.
        forceRemoveAnnotations: mode === 'remove' && defaultMode !== 'remove',
      };
    },
    [setup, es.annotation.automatic, annotateSheets, flatSheets, currentPath],
  );

  /** Apply one sheet's new symbol list, on its own undo history when off-screen. */
  /**
   * Run an edit against any sheet of the project, not just the open one.
   *
   * The open sheet goes through the ordinary undo path so Ctrl+Z reaches it;
   * another sheet gets its own history and is serialized straight into the
   * `changed` list for the caller to persist. Extracted from
   * `applySheetSymbols` when Sync Sheet Pins needed the same thing for pins and
   * labels — the mechanism was never about symbols.
   */
  /**
   * The commands a multi-sheet operation has produced so far, while one is
   * running — the equivalent of a `SCH_COMMIT` that has been `Modify`d on
   * several screens and not yet `Push`ed.
   *
   * Non-null only inside {@link sheetBatch}. Everything that reaches
   * `applySheetCommand` while it is open is collected here instead of being
   * executed, so the whole operation lands as one undo entry.
   */
  const openBatch = useRef<Map<string, EditCommand[]> | null>(null);

  /**
   * Run a multi-sheet operation as ONE undo step, whichever sheets it turns out
   * to touch — Annotate, Clear Annotation, Increment Annotations, Sync Sheet
   * Pins, Edit Text and Graphics.
   *
   * Upstream every one of these is a single `SCH_COMMIT` pushed once
   * (`sch_editor_control.cpp`, `dialog_annotate.cpp`, …), and Ctrl+Z takes the
   * whole thing back. Ours pushed one entry per sheet on that sheet's own
   * stack, so undoing on the open sheet reverted its share and left the rest of
   * the hierarchy annotated — half a rename, spread over files the user cannot
   * see from here.
   *
   * The body still calls the same `applySheet*` helpers; they notice the batch.
   */
  const sheetBatch = useCallback(
    (label: string, body: () => void): void => {
      // Not re-entrant, and does not need to be: an operation that ran another
      // would already be one commit upstream. An inner call just joins the
      // batch that is open.
      if (openBatch.current) {
        body();
        return;
      }
      const batch = new Map<string, EditCommand[]>();
      openBatch.current = batch;
      try {
        body();
      } finally {
        openBatch.current = null;
      }
      if (batch.size === 0) return;
      const edit = new Map<string, EditCommand>();
      for (const [file, cmds] of batch) edit.set(file, composeCommands(label, cmds));
      runProject(edit);
    },
    [runProject],
  );

  /** Collect one command into the open batch, or run it as its own entry. */
  const stage = useCallback(
    (file: string, cmd: EditCommand): void => {
      const batch = openBatch.current;
      if (!batch) {
        runProject(new Map([[file, cmd]]));
        return;
      }
      const list = batch.get(file);
      if (list) list.push(cmd);
      else batch.set(file, [cmd]);
    },
    [runProject],
  );

  const applySheetCommand = useCallback(
    (file: string, cmd: EditCommand): void => {
      if (file === currentFile || project.current.docs.has(file)) stage(file, cmd);
    },
    [currentFile, stage],
  );

  const applySheetSymbols = useCallback(
    (file: string, symbols: readonly SchSymbol[], label: string): void =>
      applySheetCommand(file, setSymbolsCommand(symbols, label)),
    [applySheetCommand],
  );

  // Increment Annotations From… (SCH_EDITOR_CONTROL::IncrementAnnotations):
  // move a tail of one reference prefix up, to free numbers in the middle of a
  // run. The scope radio is the dialog's own, not the annotate dialog's, so it
  // is either this sheet or every sheet — nothing in between.
  const runIncrementAnnotations = useCallback(
    (r: IncrementAnnotationsResult) => {
      const sheets = r.allSheets
        ? annotateSheets('all', false)
        : annotateSheets('current_sheet', false);
      sheetBatch('Increment Annotations', () => {
        for (const sheet of sheets) {
          if (sheet.scope === 'out') continue;
          const symbols = incrementAnnotations(sheet.doc.symbols, {
            startRef: r.startRef,
            increment: r.increment,
          });
          if (symbols === sheet.doc.symbols) continue;
          applySheetSymbols(sheet.file, symbols, 'Increment Annotations');
        }
      });
    },
    [annotateSheets, applySheetSymbols, sheetBatch],
  );

  /** The same, for an edit that replaces a whole sheet document. */
  const applySheetDocument = useCallback(
    (file: string, next: Schematic, label: string): void => {
      const cmd: EditCommand = {
        label,
        apply: () => next,
        invert: (before: Schematic) => ({
          label,
          apply: () => before,
          invert: (b: Schematic) => ({ label, apply: () => b, invert: () => cmd }),
        }),
      };
      applySheetCommand(file, cmd);
    },
    [applySheetCommand],
  );

  // Apply a queued remote sheet-text update (designer/src/sync/). Reuses
  // applySheetDocument, the same primitive Increment Annotations/Sync Sheet
  // Pins use to replace a whole sheet document — so this rides the ordinary
  // undo path when it lands on the open sheet (a bad remote update is a
  // Ctrl+Z away) and gets its own history entry otherwise, exactly like any
  // other cross-sheet edit. Not a merge: last update to arrive wins.
  useEffect(() => {
    if (!pendingRemoteChange) return;
    const { sheetPath } = pendingRemoteChange;
    setPendingRemoteChange(null);
    const target = sheetInstanceRefs.find((r) => r.path === sheetPath);
    if (!target) return; // not (yet) part of this tab's loaded hierarchy
    let next: Schematic;
    if (pendingRemoteChange.patch) {
      // A patch is only meaningful against the sheet it was diffed from, so
      // it needs this tab's current copy of that sheet to splice into.
      const current =
        target.file === currentFile ? docRef.current : project.current.docs.get(target.file);
      if (!current) return; // the sheet is named but not loaded here
      next = applySchematicPatch(current, pendingRemoteChange.patch);
    } else {
      try {
        next = { ...readSchematic(parse(pendingRemoteChange.text)), fileName: target.file };
      } catch {
        return; // malformed text mid-broadcast; wait for the next update
      }
    }
    if (target.file === currentFile) {
      // Echo suppression works off text either way, so a patch has to be
      // serialized here — the alternative is re-broadcasting what we just
      // received. Cheaper than it looks: this runs once per received edit,
      // not once per frame, and only for the sheet on screen.
      try {
        lastKnownText.current = serializeSchematic(next);
      } catch {
        lastKnownText.current = null; // unserializable: fall back to sending text next time
      }
    }
    applyingRemoteRef.current = true;
    try {
      applySheetDocument(target.file, next, 'Remote update');
    } finally {
      applyingRemoteRef.current = false;
    }
  }, [pendingRemoteChange, sheetInstanceRefs, currentFile, applySheetDocument]);

  /** Open the fields table (DIALOG_SYMBOL_FIELDS_TABLE opens directly). */
  const openFieldsTable = useCallback((view: 'edit' | 'bom') => {
    if (view === 'bom') setBomOpen(true);
    else setFieldsTableOpen(true);
  }, []);

  // Bulk Edit Symbol Library Links (DIALOG_EDIT_SYMBOLS_LIBID). A bad row keeps
  // the dialog open on its error rather than closing on a half-applied edit.
  const runLibIdChanges = useCallback(
    (changes: Map<string, string>) => {
      if (!doc) return;
      const { command, errors } = libIdChangeCommand(doc, libById, changes);
      setLibIdErrors(errors);
      if (command) runCommand(command);
      if (errors.length === 0) setLibIdsOpen(false);
    },
    [doc, libById, runCommand],
  );

  /**
   * SCH_EDIT_TOOL's Edit with Symbol Editor. Hands the placement's symbol over
   * in library form: the fields come back out of schematic space, and the unit
   * and body style the editor opens on are the placement's.
   */
  /**
   * `SCH_ACTIONS::editLibSymbolWithLibEdit`. Both Edit Symbol and Edit Library
   * Symbol run ONE handler upstream — `SCH_EDITOR_CONTROL::EditWithSymbolEditor`
   * (sch_editor_control.cpp:2886, both actions bound at :3553) — and open the
   * same SYMBOL_EDIT_FRAME. They differ only in what they seed it with:
   *
   *     editWithLibEdit          LoadSymbolFromSchematic( symbol )
   *     editLibSymbolWithLibEdit LoadSymbol( symbol->GetLibId(),
   *                                          symbol->GetUnit(),
   *                                          symbol->GetBodyStyle() )
   *
   * The first opens this placement's own copy, the second the LIBRARY part, so
   * an edit there reaches every use of it. This one used to call
   * `onShowSymbolEditor()` with no arguments at all, which opened an empty
   * editor — the symbol was never seeded.
   */
  const openSymbolEditorOn = useCallback(
    (id: string, target: SymbolEditorTarget): void => {
      const d = docRef.current;
      if (!d || !onEditSymbolInEditor) return;
      const req = symbolEditorRequest(d.symbols, libById, id, target);
      if (!req) {
        // `"Symbols with broken library symbol links cannot be edited."`
        // (sch_editor_control.cpp:2870) — the same guard, on the same footing.
        // The editor is NOT opened: an empty SYMBOL_EDIT_FRAME is not what
        // upstream does with a symbol it refuses.
        setInfoBar('That symbol is not in any loaded library.');
        return;
      }
      onEditSymbolInEditor(req);
    },
    [libById, onEditSymbolInEditor],
  );

  const editSymbolInEditor = useCallback(
    (id: string): void => openSymbolEditorOn(id, 'schematic'),
    [openSymbolEditorOn],
  );

  // The edited symbol coming back from the editor. A nonce rather than the
  // symbol's identity, so saving the same symbol twice applies twice.
  const editedNonce = useRef<number | null>(null);
  useEffect(() => {
    const req = editedSymbol;
    if (!req || editedNonce.current === req.nonce) return;
    editedNonce.current = req.nonce;
    const d = docRef.current;
    if (!d) return;
    const cmd = saveSymbolToSchematic(d, req.targetId, req.symbol);
    if (!cmd) {
      setInfoBar('That symbol is no longer on the schematic.');
      return;
    }
    runCommand(cmd);
  }, [editedSymbol, runCommand]);

  /**
   * Tools > Rescue Symbols — `SCH_EDITOR_CONTROL::RescueSymbols`.
   *
   * Always the symbol-library-table rescuer: `LEGACY_RESCUER` is chosen only
   * when `HasNoFullyDefinedLibIds()`, a KiCad 4 schematic whose symbols carry a
   * bare name with no nickname, and nothing we can open is one.
   *
   * `aRunningOnDemand` is true here and always will be: the other caller is the
   * prompt at load time, which sits inside the legacy `.sch` branch
   * (`files-io.cpp:616-621`). That is what makes the "nothing to rescue"
   * message appear at all — the automatic call passes false and stays silent.
   */
  const [rescueCandidates, setRescueCandidates] = useState<readonly RescueCandidate[] | null>(null);
  const [rescueMessage, setRescueMessage] = useState<string | null>(null);
  /**
   * `DisplayInfoMessage` after a load that `RepairPageNumbers` changed
   * (files-io.cpp:451-458). One box, one string, raised by the loader alone.
   */
  const [loadRepairedMessage, setLoadRepairedMessage] = useState<string | null>(null);
  /** `aRunningOnDemand`: true from the Tools menu, false for the load prompt. */
  const [rescueOnDemand, setRescueOnDemand] = useState(true);
  /** Set by a legacy project load; the prompt runs once the sheet is on screen. */
  const pendingRescuePrompt = useRef(false);

  /**
   * The project's `<project>-cache.lib`, read — `PROJECT_SCH::LegacySchLibs`
   * (`@ziroeda/eeschema/project_sch.ts`'s `legacySchLibs`).
   *
   * `LoadAllLibraries` adds it whatever the schematic's format
   * (`legacy_symbol_library.cpp:589-600`, "add the special cache library"), and
   * the lazy load happens the first time anything asks — which for a modern
   * project is the Project Rescue Helper and nothing else.
   *
   * A cache that will not parse leaves the map empty and the rescue runs
   * without it, which is what upstream does with the `IO_ERROR`: `AddLibrary`
   * throws, `LoadAllLibraries` catches it, logs "Symbol library '%s' failed to
   * load." and carries on with the libraries it did get.
   */
  const legacyCache = useCallback(
    (): Map<string, LibSymbol> => legacySchLibs(rawFiles, project.current.root),
    [rawFiles],
  );

  const runRescueSymbols = useCallback(
    async (onDemand = true) => {
      setRescueOnDemand(onDemand);
      const docs = liveDocs();
      const symbols = [...docs.values()].flatMap((d) => d.symbols);
      // `SchGetLibSymbol( symbol_id, SymbolLibAdapter( … ) )`: the library the id
      // names, never the sheet's own cached copy — the cache is the other half of
      // the comparison, so it cannot also stand in for the library.
      const libs = await repairSourceLibs(
        symbols.map((sym) => sym.libId),
        loadSymbol,
        new Map(),
      );
      const found = findRescues(symbols, {
        cache: legacyCache(),
        lib: (id) => libs.get(id) ?? null,
        schematicFileName: project.current.root,
      });
      if (found.length === 0) {
        // "if( aRunningOnDemand )" — the automatic call says nothing when there
        // is nothing to say, because the user did not ask for it.
        if (onDemand) setRescueMessage('This project has nothing to rescue.');
        return;
      }
      setRescueCandidates(found);
    },
    [liveDocs, legacyCache, loadSymbol],
  );

  /**
   * The load-time prompt — `files-io.cpp:616-621`:
   *
   *     if( ( !cfg || !cfg->m_RescueNeverShow ) && !cacheExists )
   *         editor->RescueSymbolLibTableProject( false );
   *
   * Deferred to an effect because it needs the sheet that was just opened, and
   * `loadProject` puts that on screen with `setDoc`.
   */
  useEffect(() => {
    if (!pendingRescuePrompt.current || !doc) return;
    pendingRescuePrompt.current = false;
    void runRescueSymbols(false);
  }, [doc, runRescueSymbols]);

  /** "Instances of this symbol" — every placement of one id, over the hierarchy. */
  const rescueInstances = useCallback(
    (requestedId: string): RescueInstance[] => {
      const out: RescueInstance[] = [];
      for (const sheet of flatSheets) {
        const d = sheet.file === currentFile ? doc : project.current.docs.get(sheet.file);
        for (const sym of d?.symbols ?? []) {
          if (sym.libId !== requestedId) continue;
          out.push({
            reference: sym.fields.find((f) => f.key === 'Reference')?.value ?? '',
            value: sym.fields.find((f) => f.key === 'Value')?.value ?? '',
          });
        }
      }
      return out;
    },
    [flatSheets, currentFile, doc],
  );

  /**
   * OK on the dialog — `DoRescues` then `WriteRescueLibrary`, and then
   * `m_frame->ClearUndoRedoList()` (`sch_editor_control.cpp:582`).
   *
   * The undo list goes because the rescue has written a library file; undoing
   * the schematic afterwards would leave it pointing at symbol ids the rescue
   * library still defines, which is not a state the project was ever in.
   */
  const applyRescues = useCallback(
    (chosen: readonly RescueCandidate[]) => {
      setRescueCandidates(null);
      if (chosen.length === 0) {
        // "No symbols were rescued." — upstream says this even on Cancel,
        // because a mis-click there should not look like it did something.
        setRescueMessage('No symbols were rescued.');
        return;
      }

      // The library file itself. `OpenRescueLibrary` copies any existing rescue
      // library in first so previous rescues are not lost.
      const libFile = rescueLibraryFileName(project.current.root);
      const nickname = rescueLibraryNickname(project.current.root);
      const existing = rawFiles.find((f) => f.name === libFile);
      const kept: LibSymbol[] = existing ? readSymbolLib(parse(existing.text)) : [];
      const minted = chosen
        .map(rescuedDefinition)
        .filter((d): d is LibSymbol => d !== null)
        .filter((d) => !kept.some((k) => k.libId === d.libId));
      const text = serializeSymbolLib([...kept, ...minted]);

      setRawFiles((prev) =>
        prev.some((f) => f.name === libFile)
          ? prev.map((f) => (f.name === libFile ? { ...f, text } : f))
          : [...prev, { name: libFile, text }],
      );
      onPersistFiles?.([{ name: libFile, text }]);

      // "If the rescue library already exists in the symbol library table no
      // need save it to add it to the table."
      const rows = projectSymLibTable(rawFiles);
      if (!rows.some((r) => r.name === nickname)) {
        saveProjectSymLibTable([
          ...rows,
          {
            name: nickname,
            type: 'KiCad',
            // `wxS( "${KIPRJMOD}/" ) + fn.GetFullName()` — a path relative to
            // the project, so the row survives the folder being moved.
            uri: `\${KIPRJMOD}/${libFile}`,
            options: '',
            descr: '',
          },
        ]);
      }

      // The schematic half: one edit over every sheet that places a rescued id.
      const edit = new Map<string, EditCommand>();
      for (const [file, d] of liveDocs()) {
        if (!d.symbols.some((sym) => chosen.some((c) => c.requestedId === sym.libId))) continue;
        edit.set(file, rescueDocumentCommand(chosen));
      }
      if (edit.size > 0) runProject(edit);
      // Queued, not immediate: `runProject` folds inside a `setDoc` updater, so
      // the entry it pushes does not exist yet.
      pendingClearHistory.current = true;
    },
    [rawFiles, onPersistFiles, saveProjectSymLibTable, liveDocs, runProject],
  );

  // Edit Text & Graphics Properties (SCH_EDIT_TOOL::GlobalEdit). The sweep runs
  // over the whole hierarchy, as TransferDataFromWindow does — it walks every
  // sheet path, not just the one on screen.
  const runGlobalEdit = useCallback(
    (r: GlobalEditResult) => {
      const sheets = annotateSheets('all', false);
      const libs = hierarchyLibs(sheets);
      sheetBatch('Edit Text and Graphics', () => {
        for (const sheet of sheets) {
          // The net filter needs that sheet's own netlist; it is only computed
          // when the filter is actually on.
          const netOfItem = r.filters.net
            ? (id: string): string | null => {
                const nl = computeNetlist(sheet.doc, libs);
                return connectionName(nl, id);
              }
            : undefined;
          const next = globalEdit(sheet.doc, libs, {
            scope: r.scope,
            filters: {
              ...r.filters,
              ...(r.filters.selectedOnly && sheet.file === currentFile
                ? { selected: selection }
                : {}),
              // "Selected items only" can only mean the sheet on screen; an
              // off-screen sheet has no selection, so nothing there matches.
              ...(r.filters.selectedOnly && sheet.file !== currentFile
                ? { selected: new Set<string>() }
                : {}),
            },
            action: r.action,
            ...(netOfItem ? { netOfItem } : {}),
          });
          if (next === sheet.doc) continue;
          applySheetDocument(sheet.file, next, 'Edit Text and Graphics');
        }
      });
    },
    [
      annotateSheets,
      hierarchyLibs,
      applySheetDocument,
      currentFile,
      selection,
      onProjectChange,
      sheetBatch,
    ],
  );

  /**
   * Give a symbol being placed its reference, when KiCad would.
   *
   * `sch_drawing_tools.cpp`, after the symbol is added and inside the same
   * commit:
   *
   *   if( cfg->m_AnnotatePanel.automatic || newReference.AlwaysAnnotate() )
   *       refs.ReannotateByOptions( … );
   *
   * so the "Annotate Automatically" toggle is not the only gate:
   * `SCH_REFERENCE::AlwaysAnnotate` is true for a power symbol or a reference
   * beginning with '#', and those are numbered whatever the toggle says.
   *
   * The numbering itself goes through the same pass the Annotate dialog uses,
   * rather than a second "find the next free number" of its own, so the sort
   * order, the algorithm, the start number and the designator tracker all apply
   * exactly as they do there. The symbol is annotated *before* it is placed:
   * KiCad annotates after adding but within one COMMIT, and building it
   * annotated is how that comes out as a single undo step here.
   */
  const annotatePlacement = useCallback(
    (sym: SchSymbol, lib: LibSymbol): SchSymbol => {
      const d = docRef.current;
      if (!d) return sym;
      const reference = sym.fields.find((f) => f.key === 'Reference')?.value ?? '';
      const alwaysAnnotate = lib.isPower === true || reference.startsWith('#');
      if (!es.annotation.automatic && !alwaysAnnotate) return sym;

      const tracker = new REFDES_TRACKER();
      tracker.Deserialize(setup.usedDesignators);
      tracker.SetReuseRefDes(setup.annotation.allowReuse);

      // Annotate it in a document that already holds it, scoped to it alone, so
      // every existing reference on the sheet is seen as taken.
      const staged: Schematic = { ...d, symbols: [...d.symbols, sym] };
      const libs = new Map(
        hierarchyLibs([{ file: currentFile, doc: staged, sheetNumber: 1, scope: 'full' }]),
      );
      if (!libs.has(lib.libId)) libs.set(lib.libId, lib);
      const index = staged.symbols.length - 1;
      const only = new Set([refId('symbol', sym.uuid, index)]);
      const annotated = annotateSymbols(
        staged,
        libs,
        {
          ...defaultAnnotateOptions(),
          scope: 'selection',
          // The same project settings DIALOG_ANNOTATE seeds itself from.
          order: setup.annotation.sortOrder,
          algo:
            setup.annotation.numbering === 'sheetX100'
              ? 'sheet_100'
              : setup.annotation.numbering === 'sheetX1000'
                ? 'sheet_1000'
                : 'incremental',
          startNumber: setup.annotation.firstFreeAfter,
          resetExisting: false,
          // SYMBOL_FILTER_ALL: the placement path numbers power symbols too,
          // which is how a freshly placed GND becomes #PWR01 rather than
          // staying #PWR? and colliding with the next one.
          includePower: true,
          tracker,
        },
        only,
      );
      return annotated[index] ?? sym;
    },
    [setup, es.annotation.automatic, hierarchyLibs, currentFile],
  );
  const annotatePlacementRef = useRef(annotatePlacement);
  annotatePlacementRef.current = annotatePlacement;

  // Annotate (SCH_EDIT_FRAME::AnnotateSymbols): one numbering pass across the
  // sheets in scope, then the report loop and CheckAnnotate's final control.
  // The REFDES_TRACKER is deserialized from schematic.used_designators, gated
  // by the project's reuse_designators, and persists back after the run.
  const runAnnotate = useCallback(
    (opts: AnnotateRun) => {
      const tracker = new REFDES_TRACKER();
      tracker.Deserialize(setup.usedDesignators);
      tracker.SetReuseRefDes(setup.annotation.allowReuse);

      const sheets = annotateSheets(opts.scope, opts.recursive);
      const libs = hierarchyLibs(sheets);
      const subRef = (unit: number): string =>
        subReference(unit, subpartSettings(setup.annotation), false);
      const updated = annotateHierarchy(sheets, libs, { ...opts, tracker }, selection);

      const diffs: AnnotateDiff[] = [];
      sheetBatch('Annotate Schematic', () => {
        for (const sheet of sheets) {
          const symbols = updated.get(sheet.file);
          if (!symbols) continue;
          applySheetSymbols(sheet.file, symbols, 'Annotate Schematic');
          diffs.push({ before: sheet.doc, after: { ...sheet.doc, symbols } });
        }
      });

      const lines = [...annotationReport(diffs, libs, subRef)];
      // The final control runs over the sheets that were in scope, as upstream's
      // CheckAnnotate does, against the post-annotation documents.
      const checked = sheets
        .filter((s) => s.scope !== 'out')
        .map((s) => {
          const symbols = updated.get(s.file);
          return symbols ? { ...s.doc, symbols } : s.doc;
        });
      const errors = checkAnnotation(checked, libs, subRef);
      lines.push(...errors);
      if (errors.length === 0)
        lines.push({
          message: 'Annotation complete.',
          severity: RPT_SEVERITY_ACTION,
          location: 'tail',
        });
      setAnnotateMessages(lines);

      const usedDesignators = tracker.Serialize();
      if (usedDesignators !== setup.usedDesignators) commitSetup({ ...setup, usedDesignators });
    },
    [
      annotateSheets,
      hierarchyLibs,
      applySheetSymbols,
      sheetBatch,
      onProjectChange,
      selection,
      setup,
      commitSetup,
    ],
  );

  // Clear Annotation (SCH_EDIT_FRAME::DeleteAnnotation): the same scope walk,
  // resetting each in-scope symbol's reference to its bare prefix + '?'.
  const runClearAnnotation = useCallback(
    (scope: AnnotateOptions['scope'], recursive: boolean) => {
      const sheets = annotateSheets(scope, recursive);
      const libs = hierarchyLibs(sheets);
      const diffs: AnnotateDiff[] = [];
      sheetBatch('Clear Annotation', () => {
        for (const sheet of sheets) {
          if (sheet.scope === 'out') continue;
          const cmd = clearAnnotationCommand(
            sheet.scope === 'selected' ? 'selection' : 'all',
            selection,
          );
          const next = cmd.apply(sheet.doc);
          if (next === sheet.doc) continue;
          applySheetSymbols(sheet.file, next.symbols, 'Clear Annotation');
          diffs.push({ before: sheet.doc, after: next });
        }
      });
      setAnnotateMessages(
        clearAnnotationReport(diffs, libs, (unit) =>
          subReference(unit, subpartSettings(setup.annotation), false),
        ),
      );
    },
    [
      annotateSheets,
      hierarchyLibs,
      applySheetSymbols,
      sheetBatch,
      onProjectChange,
      selection,
      setup.annotation,
    ],
  );

  // Drawing defaults shared by every output (screen, print, plot), derived
  // from Schematic Setup > Formatting the way SCH_RENDER_SETTINGS is seeded
  // from SCHEMATIC_SETTINGS upstream (eeschema_config.cpp).
  /**
   * `SetLayer( busLine ? LAYER_BUS_JUNCTION : LAYER_JUNCTION )`
   * (`connection_graph.cpp:1451-1454`), for the junctions on this sheet.
   *
   * Cheap enough to keep current on every document change: one segment index
   * over the buses, then one lookup per junction.
   */
  const busJunctionIds = useMemo(() => (doc ? busJunctionIdsOf(doc) : new Set<string>()), [doc]);

  const drawingDefaults = useMemo(() => LoadProjectSettings(setup), [setup]);

  // Inter-sheet references (SCHEMATIC::RecomputeIntersheetRefs): resolved
  // global-label text -> virtual pages across the hierarchy, plus each virtual
  // page's page-number string, rebuilt when the hierarchy or settings change.
  const intersheetRefsBase = useMemo(() => {
    if (!setup.formatting.intersheetRefsShow) return undefined;
    const docs = liveDocs();
    const sheets: IntersheetSheet[] = [];
    const virtualPageToPages = new Map<number, string>();
    sheetInstanceRefs.forEach((s, i) => {
      const sch = docs.get(s.file);
      const page = pageNumberOf(s.path) || String(i + 1);
      virtualPageToPages.set(i + 1, page);
      if (sch) {
        const resolver = resolverForDoc(sch, s.file, s.path);
        sheets.push({
          sch,
          virtualPage: i + 1,
          pageString: page,
          resolve: (t) => ResolveShownText(t, resolver),
        });
      }
    });
    // No hierarchy yet (fresh document): the on-screen sheet is page 1.
    if (sheets.length === 0 && doc) {
      virtualPageToPages.set(1, pageNumberOf('/') || '1');
      const resolver = resolverForDoc(doc, currentFile);
      sheets.push({
        sch: doc,
        virtualPage: 1,
        pageString: '1',
        resolve: (t) => ResolveShownText(t, resolver),
      });
    }
    return { pageRefsMap: buildPageRefsMap(sheets), virtualPageToPages };
  }, [setup, liveDocs, sheetInstanceRefs, pageNumberOf, doc, currentFile, resolverForDoc]);

  // ${INTERSHEET_REFS} resolver for the sheet shown as `currentVirtualPage`
  // (SCH_GLOBALLABEL::ResolveTextVar reads CurrentSheet()'s virtual page).
  const intersheetRefsFor = useCallback(
    (currentVirtualPage: number): RenderOpts['intersheetRefs'] => {
      if (!intersheetRefsBase) return undefined;
      const cfg: IntersheetRefsConfig = {
        pageRefsMap: intersheetRefsBase.pageRefsMap,
        virtualPageToPages: intersheetRefsBase.virtualPageToPages,
        currentVirtualPage,
        listOwnPage: setup.formatting.intersheetRefsOwnPage,
        formatShort: setup.formatting.intersheetRefsAbbreviated,
        prefix: setup.formatting.intersheetRefsPrefix,
        suffix: setup.formatting.intersheetRefsSuffix,
      };
      return { text: (resolvedLabel) => intersheetRefsText(resolvedLabel, cfg) };
    },
    [intersheetRefsBase, setup],
  );

  // The on-screen sheet's resolver (CurrentSheet().GetVirtualPageNumber()).
  const intersheetRefs = useMemo(() => {
    const idx = sheetInstanceRefs.findIndex((s) => s.path === currentPath);
    return intersheetRefsFor(idx === -1 ? 1 : idx + 1);
  }, [intersheetRefsFor, sheetInstanceRefs, currentPath]);

  // Print (DIALOG_PRINT::TransferDataFromWindow): SavePrintOptions has run in the dialog, so
  // SCH_PRINTOUT reads them from eeconfig(); wxPrinter draws its pages into the browser's print
  // window on the paper TransferDataToWindow takes from the current screen's page settings.
  const doPrint = useCallback(() => {
    const frame = schFrameRef.current;
    const pageInfo = frame?.GetScreen()?.GetPageSettings();
    if (!frame || !pageInfo) return;
    new wxPrinter().Print(new SCH_PRINTOUT(frame, 'Print Schematic'), {
      x: pageInfo.GetWidthMils() / 1000,
      y: pageInfo.GetHeightMils() / 1000,
    });
    setPrintOpen(false);
  }, []);

  // Bulk Edit Symbol Fields: apply the changed cells across every sheet they
  // reach, as ONE entry — DIALOG_SYMBOL_FIELDS_TABLE builds a single SCH_COMMIT
  // and pushes it once, however many screens it modified.
  const applyFieldsEdits = useCallback(
    (
      edits: FieldsEdits,
      opts: {
        persist?: boolean;
        /** The `${DNP}` / `${EXCLUDE_FROM_…}` columns, applied in the same step. */
        attrs?: ReadonlyMap<string, ReadonlyMap<string, SymbolAttrEdit>>;
      } = {},
    ) => {
      const edit = new Map<string, EditCommand>();
      const files = new Set([...edits.keys(), ...(opts.attrs?.keys() ?? [])]);
      for (const file of files) {
        if (file !== currentFile && !project.current.docs.has(file)) continue;
        const perSymbol = edits.get(file);
        const perSymbolAttrs = opts.attrs?.get(file);
        const cmds = [
          ...(perSymbol?.size ? [bulkEditFieldsCommand(perSymbol)] : []),
          ...(perSymbolAttrs?.size ? [bulkEditSymbolAttributesCommand(perSymbolAttrs)] : []),
        ];
        if (cmds.length === 0) continue;
        edit.set(file, cmds.length === 1 ? cmds[0]! : composeCommands('Edit Symbol Fields', cmds));
      }
      if (edit.size === 0) return;
      // "Apply, Save Schematic & Continue" (CVPCB) writes now rather than
      // waiting for the debounced autosave, so every sheet the edit reached —
      // the open one included — is reported to the host.
      runProject(edit, opts.persist === true);
    },
    [currentFile, runProject],
  );

  // Plot (DIALOG_PLOT_SCHEMATIC / SCH_PLOTTER::Plot): write the chosen format
  // into the project's output directory. "Plot All Pages" (the upstream OK
  // button) plots every sheet file, "Plot Current Page" (wxID_APPLY) just this
  // one. Each written file is reported to the dialog's Output Messages panel
  // the way SCH_PLOTTER reports "Plotted to '<path>'.".
  const doPlot = useCallback(
    ({
      format,
      opts,
      allPages,
      themeId,
      outputDir,
      pdfMetadata,
      pdfPropertyPopups,
      pdfHierarchicalLinks,
      openAfter,
      downloadCopy,
      report,
    }: PlotRequest) => {
      const plotTheme = themeId && BUILTIN_THEMES[themeId] ? BUILTIN_THEMES[themeId]!.theme : theme;
      const o: PlotOpts = {
        ...opts,
        ...drawingDefaults,
        ...(activeSheet ? { sheet: activeSheet } : {}),
        pdfPropertyPopups,
        pdfHierarchicalLinks,
      };
      // "Open file after plot": open the tab now, in the click gesture, so the
      // browser doesn't block it, the sink navigates it once the file (which
      // for PNG/PDF is produced asynchronously) is ready. Single page only.
      const preview = openAfter && !allPages ? window.open('', '_blank') : null;
      // Netclass visuals, text variables and intersheet refs all resolve per
      // sheet, so the options are built per sheet even when the pages end up in
      // one document.
      const optsFor = (d: Schematic, name: string, file: string): PlotOpts => {
        const nov = computeNetClassOverrides(
          d,
          new Map(d.libSymbols.map((l) => [l.libId, l])),
          setup,
        );
        const resolve = resolverForDoc(d, name);
        // The PDF popups' "Net" / "Resolved netclass" lines and a bus's
        // members, from this sheet's connectivity (SCH_CONNECTION::Name,
        // GetEffectiveNetClass()->GetHumanReadableName()). Computed lazily:
        // the other formats never ask.
        const docLib = new Map(d.libSymbols.map((l) => [l.libId, l]));
        let nl: Netlist | null = null;
        const netOf = (id: string): PdfNetInfo | undefined => {
          nl ??= computeNetlist(d, docLib);
          const code = nl.netByItem.get(id);
          const net = code !== undefined ? nl.nets.find((n) => n.code === code) : undefined;
          if (!net) return undefined;
          const members = nl.buses.find((b) => b.items.includes(id))?.members;
          return {
            net: net.name,
            netclass: netClassHumanReadableName(
              resolveEffectiveNetClass(net.name, setup.netClasses),
            ),
            ...(members ? { members } : {}),
            // SCH_LINE::GetPenWidth: the netclass width, else the stroke's,
            // else the default wire width the plot renderer strokes with.
            penWidth: nov?.lines.get(id)?.widthIU ?? DEFAULT_WIRE_WIDTH,
          };
        };
        const od: PlotOpts = {
          ...o,
          ...(nov ? { netOverrides: nov } : {}),
          resolveTextVar: resolve,
          netOf,
          libById: docLib,
          ...((): Partial<PlotOpts> => {
            const idx = sheetInstanceRefs.findIndex((s) => s.file === file);
            const r = intersheetRefsFor(idx === -1 ? 1 : idx + 1);
            return r ? { intersheetRefs: r } : {};
          })(),
          // "Generate metadata from AUTHOR & SUBJECT variables": the same text
          // variables SCH_PLOTTER resolves before writing the PDF.
          ...(pdfMetadata
            ? {
                pdfMetadata: {
                  title: d.titleBlock?.title || name,
                  // `m_schematic->ResolveTextVar( &sheet, &msg, 0 )` with the bare token.
                  author: resolveToken(resolve, 'AUTHOR'),
                  subject: resolveToken(resolve, 'SUBJECT'),
                },
              }
            : {}),
        };
        return od;
      };
      // Every plot lands in the project's file manager (the cloud "disk");
      // "Download a copy to this computer" additionally streams it out, and
      // "Open file after plot" navigates the pre-opened preview tab to it.
      const makeSink = (): PlotSink => {
        return (blob, filename) => {
          const path = outputDir ? `${outputDir}/${filename}` : filename;
          if (onOutputFile) {
            void blob.arrayBuffer().then((buf) => {
              onOutputFile(path, new Uint8Array(buf), blob.type);
              report(`Plotted to '${path}'.`, RPT_SEVERITY_ACTION);
            });
          } else {
            downloadBlob(blob, filename);
            report(`Plotted to '${filename}'.`, RPT_SEVERITY_ACTION);
          }
          if (downloadCopy && onOutputFile) downloadBlob(blob, filename);
          if (preview) {
            // Browsers render PDF/SVG/PNG inline but can't display PostScript or
            // DXF, those are text, so re-wrap them as text/plain to show the
            // file content in the tab instead of triggering a download.
            const viewable = blob.type === 'application/pdf' || blob.type.startsWith('image/');
            const shown = viewable ? blob : new Blob([blob], { type: 'text/plain' });
            preview.location.href = URL.createObjectURL(shown);
          }
        };
      };
      const one = (d: Schematic, name: string, file: string): void => {
        const od = optsFor(d, name, file);
        const sink = makeSink();
        // The async back-ends are fired and forgotten, so a failure had nowhere
        // to go: the dialog has a report panel and it stayed empty. A raster
        // plot of a big sheet is the realistic case — the canvas has a size
        // limit and exceeding it throws.
        const failed = (e: unknown): void =>
          report(`Plot failed: ${e instanceof Error ? e.message : String(e)}`, RPT_SEVERITY_ERROR);
        if (format === 'svg') plotSvg(d, plotTheme, od, name, sink);
        else if (format === 'png') void plotPng(d, plotTheme, od, name, sink).catch(failed);
        else if (format === 'dxf') plotDxf(d, plotTheme, od, name, sink);
        else if (format === 'ps') plotPs(d, plotTheme, od, name, sink);
        else void plotPdf(d, plotTheme, od, name, sink).catch(failed);
      };
      const run = (): void => {
        if (allPages) {
          const sheets = [...liveDocs()];
          // SCH_PLOTTER::Plot: nothing to write is an error, not a silent no-op.
          if (sheets.length === 0) report('No sheets to plot.', RPT_SEVERITY_ERROR);
          else if (format === 'pdf') {
            // createPDFFile opens one file and pages through the SHEET LIST —
            // one page per sheet instance, in hierarchy order, each with its
            // own page number and sheet name (StartPlot / StartPage's
            // arguments) and its parent's, so the document's outline nests
            // the way the hierarchy does. Every other format has no page
            // after the first, which is why only this one is gathered.
            const refs = sheetInstanceRefs;
            const docs = liveDocs();
            const pageOf = (path: string): string =>
              pageNumberOf(path) || String(refs.findIndex((r) => r.path === path) + 1);
            const pages: PdfPlotSheet[] = refs.flatMap((s, i) => {
              const d = docs.get(s.file);
              if (!d) return [];
              const parentPath = s.path === '/' ? null : s.path.replace(/[^/]+\/$/, '');
              const parent = refs.find((r) => r.path === parentPath);
              const r = intersheetRefsFor(i + 1);
              // `findSelf().GetPageNumber()` for each sheet symbol on this page:
              // the instance at this path plus the sheet's uuid.
              const childPages = new Map(
                d.sheets.flatMap((sh) =>
                  sh.uuid ? [[sh.uuid, pageOf(`${s.path}${sh.uuid}/`)] as const] : [],
                ),
              );
              return [
                {
                  sch: d,
                  childPages,
                  opts: {
                    ...optsFor(d, s.file.replace(/\.kicad_sch$/i, '') || outputBaseName(), s.file),
                    pageNumber: pageOf(s.path),
                    sheetNumber: i + 1,
                    sheetCount: refs.length,
                    ...(s.path !== '/' ? { sheetName: s.name } : {}),
                    sheetPath: s.namePath,
                    ...(r ? { intersheetRefs: r } : {}),
                  },
                  ...(parent
                    ? {
                        parent: {
                          pageNumber: pageOf(parent.path),
                          sheetName: parent.path === '/' ? '' : parent.name,
                        },
                      }
                    : {}),
                },
              ];
            });
            void plotPdfSheets(
              pages.length > 0
                ? pages
                : sheets.map(([file, d]) => ({
                    sch: d,
                    opts: optsFor(d, file.replace(/\.kicad_sch$/i, '') || outputBaseName(), file),
                  })),
              plotTheme,
              outputBaseName(),
              makeSink(),
            ).catch((e) =>
              report(
                `Plot failed: ${e instanceof Error ? e.message : String(e)}`,
                RPT_SEVERITY_ERROR,
              ),
            );
          } else {
            for (const [file, d] of sheets)
              one(d, file.replace(/\.kicad_sch$/i, '') || outputBaseName(), file);
          }
        } else if (doc) one(doc, outputBaseName(), currentFile);
        else report('No sheets to plot.', RPT_SEVERITY_ERROR);
      };
      // A faced text plots from the same glyphs it is drawn with, which
      // means its face has to be here first: a sheet never shown on screen
      // has not asked for its fonts yet.
      void loadOutlineFontsFor(allPages ? [...liveDocs().values()] : doc ? [doc] : []).then(run);
      // The dialog stays open after plotting (like DIALOG_PLOT_SCHEMATIC) so the
      // Output Messages panel is visible; only the Close button dismisses it.
    },
    [
      doc,
      theme,
      outputBaseName,
      liveDocs,
      activeSheet,
      drawingDefaults,
      setup,
      resolverForDoc,
      intersheetRefsFor,
      sheetInstanceRefs,
      pageNumberOf,
      currentFile,
      onOutputFile,
    ],
  );
  useEffect(() => {
    // Changed search settings restart the scan (upstream m_foundItemHighlight reset).
    findCursor.current = -1;
    lastMatch.current = null;
    setFindStatus('');
  }, [searchData]);

  // Load a schematic from raw .kicad_sch text: parse (lossless), fresh history,
  // clear transient state, and fit the view. Embedded lib_symbols render as-is.
  const resetTransient = useCallback(() => {
    setSelection(new Set());
    setHighlightItem(null);
    setHighlightBusMembers(false);
    setPendingLabel(null);
    setActiveTool('select');
    setPlaceLib(null);
    setPastePending(null);
  }, []);

  /**
   * Drop the ERC run. Deliberately *not* part of `resetTransient`: a run spans
   * the whole hierarchy and its markers live on the sheet each fault belongs to
   * (upstream keeps them on that sheet's SCH_SCREEN), so entering another sheet
   * must leave the list alone — DIALOG_ERC is modeless and navigating to a
   * marker on another sheet is the *point* of clicking its row. Only loading a
   * different schematic or project invalidates the run.
   */
  const resetErc = useCallback(() => {
    setErcResult(null);
    setErcRunning(null);
  }, []);

  const loadText = useCallback(
    async (text: string, name?: string) => {
      setLoading(`Loading ${name ?? 'untitled.kicad_sch'}...`);
      await nextPaint();
      try {
        const next = { ...readSchematic(parse(text)), fileName: name ?? 'untitled.kicad_sch' };
        const file = name ?? 'untitled.kicad_sch';
        project.current = { docs: new Map([[file, next]]), root: file };
        history.current.clear();
        setCurrentFile(file);
        setCurrentPath('/');
        navTool.current.resetHistory('/');
        setDoc(next);
        resetTransient();
        resetErc();
        if (name) setFileName(name);
        setError(null);
        // `SCH_EDIT_FRAME::OpenProjectFiles`' trailing CallAfter (files-io.cpp:857-864):
        // the libraries are paid for now, in the background, so nothing waits
        // for them later. See ./preload.ts.
        preloadSchematicLibraries([next]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    },
    [resetTransient, resetErc, preloadSchematicLibraries],
  );

  // Open a whole KiCad project: parse every .kicad_sch, find the root (the
  // .kicad_pro's schematic, else the sheet nothing references), and show it.
  const loadProject = useCallback(
    async (files: PickedFile[], startFile?: string) => {
      // The reporter comes up before anything is read; its message is empty
      // (an 80-space reservation) until the loader's first Report().
      setLoading({ message: '' });
      await nextPaint(); // paint the dialog before the (synchronous) sheet parse
      try {
        const docs = new Map<string, Schematic>();
        const problems: string[] = [];
        let proName: string | undefined;
        // When a folder bundles several projects, the launcher pins the active
        // one via rootPro; load that project's .kicad_pro so the editor's root
        // sheet matches the tree instead of guessing the first pro found.
        const wantPro = rootPro ? `${rootPro}.kicad_pro`.toLowerCase() : null;
        // Parse sheet by sheet with a per-sheet gauge (KiCad's "Loading
        // Schematic" progress dialog), yielding a paint between sheets so the
        // bar advances even though each parse is synchronous.
        const sheets = files.filter((f) =>
          /\.kicad_sch$/i.test(f.name.split('/').pop()!.split('\\').pop()!),
        );
        let parsed = 0;
        for (const f of files) {
          const base = f.name.split('/').pop()!.split('\\').pop()!;
          if (/\.kicad_pro$/i.test(base)) {
            // Prefer the active project's .kicad_pro (rootPro) so the editor and
            // the launcher tree open the same root sheet. Absent that, fall back
            // to the FIRST .kicad_pro (matching projectNameOf and the tree root);
            // picking a later one would open a different root than the tree shows
            // and the two would then edit different sheets and diverge.
            if (wantPro && base.toLowerCase() === wantPro) proName = base;
            else proName ??= base;
            continue;
          }
          if (!/\.kicad_sch$/i.test(base)) continue;
          // `Loading %s...` (sch_io_kicad_sexpr.cpp:324) per sheet; the gauge
          // is the sheet count, one phase per file as KiCad's loader adds them.
          setLoading({ message: `Loading ${base}...`, value: parsed / sheets.length });
          // Unconditional: `Report()` is followed by `KeepRefreshing()` before
          // the read (sch_io_kicad_sexpr.cpp:324-327), so the name is on screen
          // while the sheet parses — for one sheet as much as for twelve. Skipping
          // the yield for a single sheet batched the message with the close, and
          // the dialog showed its blank reservation for the whole read.
          await nextPaint();
          try {
            docs.set(base, { ...readSchematic(parse(f.text)), fileName: base });
          } catch (e) {
            problems.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
          }
          parsed++;
        }
        /**
         * A KiCad 4/5 project, converted on the way in — `SCH_IO_MGR::SCH_LEGACY`.
         *
         * Only when the selection holds no `.kicad_sch` at all: a folder with
         * both is one that has already been upgraded, and the old files beside
         * it are what KiCad leaves behind rather than what it opens.
         */
        let legacy = false;
        if (docs.size === 0) {
          const sch = new Map<string, string>();
          const libs = new Map<string, string>();
          for (const f of files) {
            const base = f.name.split('/').pop()!.split('\\').pop()!;
            if (/\.sch$/i.test(base)) sch.set(base, f.text);
            else if (/\.lib$/i.test(base)) libs.set(base, f.text);
          }
          const rootSch = legacyRootFile(sch, proName?.replace(/\.kicad_pro$/i, ''));
          if (rootSch) {
            legacy = true;
            setLoading(`Loading ${rootSch}...`);
            await nextPaint();
            const converted = readLegacyProject({
              files: sch,
              rootFile: rootSch,
              projectName: (proName ?? rootSch).replace(/\.[^.]*$/, ''),
              // `UpdateSymbolLinks` fills a screen's `lib_symbols` from the
              // resolved library, and it is that which a `.kicad_sch` carries.
              libSymbols: legacyLibrarySymbols(libs, readLegacySymbolLibrary),
            });
            for (const [name, d] of converted.docs) docs.set(name, d);
            problems.push(...converted.problems);

            // The one thing `never_show_rescue_dialog` gates:
            //
            //     if( ( !cfg || !cfg->m_RescueNeverShow ) && !cacheExists )
            //         editor->RescueSymbolLibTableProject( false );
            //     (files-io.cpp:616-621)
            //
            // A project whose cache library is still there needs no prompt —
            // the symbols it was drawn with are all present.
            const cacheNames = legacyCacheFileNames(proName ?? rootSch);
            const cacheExists = files.some((f) =>
              cacheNames.includes(f.name.replace(/\\/g, '/').split('/').pop() ?? ''),
            );
            if (!app.settings.eeschema.system.never_show_rescue_dialog && !cacheExists) {
              pendingRescuePrompt.current = true;
            }
          }
        }

        if (docs.size === 0) {
          setError(problems[0] ?? 'No .kicad_sch files in the selection');
          return;
        }
        const root = findRootFile(docs, proName);
        // Page numbers are made whole before anything reads the hierarchy
        // (files-io.cpp:439-446): a blank or duplicated page is reassigned
        // and, when that happened, the user is told the file needs saving.
        const pageRepair = repairPageNumbersOnLoad(docs, root);
        for (const [name, d] of pageRepair.docs) docs.set(name, d);
        if (pageRepair.repaired) setLoadRepairedMessage(LOAD_REPAIRED_MESSAGE);
        project.current = { docs, root };
        // Home-page tree clicks land on the clicked sheet, else the root.
        const startBase = startFile?.split('/').pop()?.split('\\').pop();
        const start = startBase && docs.has(startBase) ? startBase : root;
        const wantRoot = proName?.replace(/\.kicad_pro$/i, '.kicad_sch');
        if (wantRoot && !docs.has(wantRoot) && start === root)
          problems.push(
            `root schematic ${wantRoot} is not in the selection, opened ${root} instead`,
          );
        history.current.clear();
        setCurrentFile(start);
        // Home-tree opens the root; deeper instances are entered from the canvas.
        setCurrentPath('/');
        navTool.current.resetHistory('/');
        setDoc(docs.get(start)!);
        resetTransient();
        resetErc();
        setFileName(start);
        setError(problems.length ? `Some sheets failed to load: ${problems.join('; ')}` : null);
        // The other CallAfter, `SCH_EDIT_FRAME::LoadProject`
        // (sch_edit_frame.cpp:1492-1499). Every sheet, not just the one being
        // shown: `PreloadLibraries` is hierarchy-wide because the library table
        // is, and entering a sub-sheet must not start a fresh wait.
        preloadSchematicLibraries(docs.values());
      } catch (e) {
        // Each *sheet* is already caught individually and reported through
        // `problems`. This is everything around them — reading the .kicad_pro,
        // picking the root, building the hierarchy — where a throw escaped an
        // async handler: the overlay cleared, no project loaded, and the error
        // bar stayed empty, so opening a project appeared to do nothing at all.
        setError(`Could not open this project: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoading(null);
      }
    },
    [resetTransient, resetErc, rootPro, app, preloadSchematicLibraries],
  );

  /**
   * A project handed over from the home page's Open Project picker.
   *
   * Keyed on `openNonce` — the host telling us it OPENED something — and not on
   * the identity of the `initialProject` array. That array is now live: the
   * host mirrors our own autosaved sheets back into it so a reopen, or a
   * remount, sees the session's work instead of the file it started from. When
   * the reload was keyed on identity, every unrelated change to it re-ran
   * `loadProject` and reverted the canvas to the opened file — a plot output
   * file, a Ctrl+S in the board editor, a reopen from the tree — and the 900 ms
   * autosave below then wrote that revert over the good copy in storage.
   *
   * `loadProject` throws away `project.current`, the undo histories and the
   * view, so it must run when a project is opened and at no other time. That is
   * KiCad's own shape: `OpenProjectFiles` is called by an action.
   */
  const openedKey = useRef<string | null>(null);
  const projectRef = useRef(initialProject);
  projectRef.current = initialProject;
  /**
   * The project's NON-SHEET content: the `.kicad_pro`, the library tables, the
   * drawing sheet. What `rawFiles` and Schematic Setup are read from.
   *
   * Keyed on content rather than on the array, which now changes identity every
   * time autosave mirrors a sheet back. Re-deriving Setup from the prop on each
   * of those ticks would undo a Schematic Setup the user had just changed: the
   * dialog persists straight to storage and does not refresh the prop, so what
   * came back would be the `.kicad_pro` as it was opened.
   */
  const projectMetaKey = useMemo(
    () =>
      (initialProject ?? [])
        .filter((f) => !/\.kicad_sch$/i.test(f.name))
        .map((f) => `${f.name} ${f.text}`)
        .join(''),
    [initialProject],
  );
  useEffect(() => {
    const files = projectRef.current;
    // rootPro is part of the key so switching the active project (same folder,
    // different .kicad_pro) reloads with the newly-pinned root sheet.
    const key = `${openNonce ?? 0} ${rootPro ?? ''}`;
    // Only a frame on screen opens; a hidden one takes the open when shown.
    if (shown && openedKey.current !== key) {
      const first = openedKey.current === null;
      openedKey.current = key;
      if (files && files.length > 0) void loadProject(files, initialFile ?? undefined);
      // An open with no project is a NEW schematic (`is_new` in files-io.cpp:
      // "Create Schematic"). The frame outlives the manager now, so without
      // this the launcher pressed with no project open would show whatever
      // project this frame held last. The very first open needs nothing: the
      // frame was born on the blank sheet.
      else if (!first) void loadText(EMPTY_SCH);
      // Drop any in-session sheet override for the freshly opened project.
      setSheetOverride(null);
    }
    // Reseed the raw files (drawing-sheet reference + .kicad_wks choices) and
    // hydrate the Schematic Setup from the project's .kicad_pro (SCHEMATIC/ERC/
    // NET_SETTINGS live in the project file, like KiCad's project load). Both
    // read the project rather than the document, so they follow the prop.
    setRawFiles(files ?? []);
    setSetup(readSchematicSetup(files ?? [], rootPro ?? undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectMetaKey, rootPro, openNonce, shown]);

  // Serialize the project's sheets (current sheet + resident others) for autosave.
  const serializeSheets = useCallback((): PickedFile[] => {
    if (!doc) return [];
    const docs = new Map(project.current.docs);
    docs.set(currentFile, doc);
    const files: PickedFile[] = [];
    for (const [file, d] of docs) {
      try {
        files.push({ name: file, text: serializeSchematic(d) });
      } catch {
        /* skip a bad sheet */
      }
    }
    return files;
  }, [doc, currentFile]);

  // Autosave: once edits settle, hand the sheets up (App debounces the write to
  // IndexedDB). Fires on sheet switch/load too, re-saving identical content.
  useEffect(() => {
    if (!doc || !onProjectChange) return;
    const t = setTimeout(() => {
      const files = serializeSheets();
      if (files.length) onProjectChange(files);
    }, 900);
    return () => clearTimeout(t);
  }, [doc, onProjectChange, serializeSheets]);

  // Register a flush so the host can force the pending autosave out before the
  // project is reopened (the "edit → home → reopen" case).
  useEffect(() => {
    if (!registerAutosaveFlush) return;
    registerAutosaveFlush(() => {
      const files = serializeSheets();
      if (files.length) onProjectChange?.(files);
    });
    return () => registerAutosaveFlush(null);
  }, [registerAutosaveFlush, onProjectChange, serializeSheets]);

  // "Add symbol to schematic" from the Symbol Editor: attach the symbol to the
  // cursor exactly as the Place Symbol tool does after its chooser.
  useEffect(() => {
    if (!placeRequest) return;
    placeFlags.current = { keepSymbol: true, placeAllUnits: false, unitCount: 1 };
    setPlaceLib(placeRequest.lib);
    setActiveTool('placeSymbol');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeRequest?.nonce]);

  // Switch the visible sheet (KiCad's Enter Sheet / hierarchy navigation): stash
  // the edited current sheet back into the project, swap in the target document
  // and its own undo history.
  const switchSheet = useCallback(
    (path: string, file: string, pushHistory = true) => {
      // Every sheet change lands in the Back/Forward history (changeSheet →
      // pushToHistory); Back/Forward themselves move the cursor instead.
      if (pushHistory) navTool.current.pushToHistory(path);
      // Always record which instance is active (path is unique per instance).
      setCurrentPath(path);
      // Two instances of the same file share one document, nothing to swap, just
      // the active path changed.
      if (!doc || file === currentFile) return;
      const proj = project.current;
      proj.docs.set(currentFile, doc);
      const target = proj.docs.get(file);
      if (!target) {
        setError(`Sheet file not in project: ${file}`);
        return;
      }
      // The undo stack is NOT swapped: there is one for the whole project, and
      // stepping into a sheet does not change what Ctrl+Z takes back.
      setCurrentFile(file);
      setDoc(target);
      resetTransient();
    },
    [doc, currentFile, resetTransient],
  );

  /**
   * The page-settings undo's navigation, run after the step has been folded in.
   *
   *     SetCurrentSheet( undoSheet );
   *     DisplayCurrentSheet();
   *     (`schematic_undo_redo.cpp:357-358`)
   *
   * Only that one status asks for it; see `EditCommand.pageSettings`. If the
   * sheet has since been removed from the hierarchy there is nothing to show,
   * and the restored settings simply stay where they landed.
   */
  useEffect(() => {
    const file = pendingShowSheet.current;
    if (!file) return;
    pendingShowSheet.current = null;
    const target = flatSheets.find((sh) => sh.file === file);
    if (target) switchSheet(target.path, file);
  });

  // FindNext/FindPrevious (SCH_FIND_REPLACE_TOOL): collect matches over the
  // sheet instances (hierarchy order, or just the current instance), advance
  // the cursor with wrap-around, then jump: switch sheet, select, centre.
  const doFind = useCallback(
    (dir: 1 | -1) => {
      const docs = new Map(project.current.docs);
      if (doc) docs.set(currentFile, doc);
      const sheets = searchData.searchCurrentSheetOnly
        ? flatSheets.filter((s) => s.path === currentPath)
        : flatSheets;
      const all = sheets.flatMap((s) => {
        const d = docs.get(s.file);
        if (!d) return [];
        // Selection scoping and net-name search only make sense on the sheet
        // that owns the selection/netlist we have live (the current sheet).
        const ctx = s.path === currentPath ? { selection, nets: netlist?.nets } : {};
        return findMatches(d, libById, searchData, ctx).map((m) => ({ ...m, sheet: s }));
      });
      if (all.length === 0) {
        findCursor.current = -1;
        lastMatch.current = null;
        setFindStatus(searchData.findString ? 'Not found' : '');
        return;
      }
      findCursor.current =
        findCursor.current === -1
          ? dir === 1
            ? 0
            : all.length - 1
          : (findCursor.current + dir + all.length) % all.length;
      const m = all[findCursor.current]!;
      lastMatch.current = { id: m.id };
      if (m.sheet.path !== currentPath) switchSheet(m.sheet.path, m.sheet.file);
      setSelection(new Set([m.id]));
      // After a sheet switch the canvas fits first (rAF); centre on the frame after.
      schFrameRef.current!.FocusOnLocation(m.pos);
      setFindStatus(`${findCursor.current + 1} of ${all.length}`);
    },
    [
      doc,
      currentFile,
      currentPath,
      flatSheets,
      libById,
      searchData,
      selection,
      netlist,
      switchSheet,
    ],
  );

  // ReplaceAndFindNext: replace inside the current match, then find the next
  // one against the post-replace document (next frame, after setDoc lands).
  const doFindRef = useRef(doFind);
  doFindRef.current = doFind;
  const doReplaceNext = useCallback(() => {
    if (!searchData.findString) return;
    if (findCursor.current === -1 || !lastMatch.current) {
      doFind(1);
      return;
    }
    runCommand(replaceCommand(searchData, new Set([lastMatch.current.id])));
    // The replaced item usually drops out of the match list; step the cursor
    // back so the follow-up FindNext lands on the item after it.
    findCursor.current = Math.max(-1, findCursor.current - 1);
    lastMatch.current = null;
    requestAnimationFrame(() => doFindRef.current(1));
  }, [searchData, runCommand, doFind]);

  // ReplaceAll: substitute in every matched item, on the current sheet only,
  // or in every document of the project, each through its own undo history.
  const doReplaceAll = useCallback(() => {
    if (!searchData.findString) return;
    // One entry over every sheet it reaches: `SCH_FIND_REPLACE_TOOL::ReplaceAll`
    // runs a single SCH_COMMIT over the whole hierarchy and pushes it once.
    const edit = new Map<string, EditCommand>([[currentFile, replaceCommand(searchData)]]);
    if (!searchData.searchCurrentSheetOnly) {
      for (const file of project.current.docs.keys())
        if (file !== currentFile) edit.set(file, replaceCommand(searchData));
    }
    runProject(edit);
    findCursor.current = -1;
    lastMatch.current = null;
    setFindStatus('');
  }, [searchData, runCommand, currentFile, libById]);

  const openFile = useCallback(
    (file: File) => {
      if (!/\.kicad_sch$/i.test(file.name)) {
        setError(`Not a .kicad_sch file: ${file.name}`);
        return;
      }
      file
        .text()
        .then((t) => void loadText(t, file.name))
        .catch((e) => setError(String(e)));
    },
    [loadText],
  );

  /**
   * `SCH_EDIT_FRAME::OnOpenSchematic` - a `wxFileDialog` on the project
   * directory filtered by `FILEEXT::KiCadSchematicFileWildcard`, not the
   * operating system's file manager. Ours clicked a hidden
   * `<input type="file">`, which cannot see the account's projects at all, so
   * a schematic saved to the cloud could not be re-opened from inside the
   * editor.
   */
  const [openDlgOpen, setOpenDlgOpen] = useState(false);
  const promptOpen = useCallback(() => setOpenDlgOpen(true), []);

  // Doc edits mark the title dirty; the flag clears after the app's coalesced
  // autosave window (1.2 s) has taken the change. Mount / file switches skip.
  useEffect(() => {
    dirtySkipRef.current = true;
    setUnsaved(false);
  }, [currentFile]);

  // Only when nothing is writing the work down. With a project open, autosave
  // plus the flush on page-hide already carry it, and a prompt would be noise
  // on every close.
  useUnsavedGuard(!autosaveActive && unsaved);
  useEffect(() => {
    if (dirtySkipRef.current) {
      dirtySkipRef.current = false;
      return;
    }
    setDirty(true);
    setUnsaved(true);
    const id = setTimeout(() => setDirty(false), 1600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const save = useCallback(() => {
    // Not inside a setDoc updater. A state updater must be pure — StrictMode
    // runs it twice, which here meant persisting twice or firing two downloads
    // — and it must not be where the work is decided: the document is read from
    // its ref instead.
    const d = docRef.current;
    if (!d) return;
    let text: string;
    try {
      text = serializeSchematic(d);
    } catch (e) {
      // The flags stay set. Clearing them first told the user their work was
      // safe *because* we were about to write it, which is exactly backwards
      // when the write is the thing that failed.
      setInfoBar(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (onSaveFiles && currentFile !== DEFAULT_FILE) {
      // Save writes into the project's file manager (cloud storage); a local
      // copy can be downloaded from there (or via Save a Copy). This is the
      // path that also commits the Local History point.
      void onSaveFiles([{ name: currentFile, text }]);
    } else if (onPersistFiles && currentFile !== DEFAULT_FILE) {
      onPersistFiles([{ name: currentFile, text }]);
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download =
        currentFile !== DEFAULT_FILE
          ? currentFile
          : (fileName ?? `${d.titleBlock?.title ?? 'schematic'}.kicad_sch`);
      a.click();
      URL.revokeObjectURL(url);
    }
    // Only now: the asterisk and the leave-prompt both mean "written".
    setDirty(false);
    setUnsaved(false);
  }, [fileName, currentFile, onPersistFiles, onSaveFiles]);
  // MAIL_SCH_GET_NETLIST is answered by the frame from its live SCHEMATIC (ReadyToNetlist,
  // NETLIST_EXPORTER_KICAD); this keeps that schematic the window's: every sheet's record, the
  // open one with the edits its file only gets on the debounced save, opened through
  // OpenProjectFiles under the folder pcbnew loads the project from.
  // (TRANSITIONAL, W3a): the open project's files on the mounted file system, where
  // KiCad would find them (`/<project>/…`), so the live tools that read or write files - Import
  // Sheet, Place Image, Export Symbols, Rescue, ChangeSheetFile - see the project. A write lands
  // in the project's file store; the explicit Save stays the window's until the switch.
  useEffect(() => {
    const name = projectName ?? project.current.root.replace(/\.[^.]*$/, '');
    if (!name) return;
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const fs = new MEMORY_FILESYSTEM();
    for (const f of rawFiles) fs.Write(f.name, enc.encode(f.text));
    fs.SetWriteListener((aRel, aData) =>
      onPersistFiles?.([{ name: aRel, text: dec.decode(aData) }]),
    );
    return wxMountFileSystem(`/${name}`, fs);
  }, [rawFiles, projectName, onPersistFiles]);
  const liveMirrorRef = useRef<LIVE_SCHEMATIC_MIRROR | null>(null);
  const inEditLiveRef = useRef(false);
  const adoptLiveScreensRef = useRef<(aScreens: Iterable<SCH_SCREEN>) => void>(() => {});
  const liveModifiedRef = useRef<() => void>(() => {});
  const liveSheetChangedRef = useRef<() => void>(() => {});
  const showingLiveRef = useRef(false);
  liveFilesRef.current = { rawFiles, projectName, rootPro };
  syncLiveRef.current = () => {
    liveMirrorRef.current ??= new LIVE_SCHEMATIC_MIRROR(schFrameRef.current!, () => {
      const docs = new Map(project.current.docs);
      if (docRef.current) docs.set(currentFileRef.current, docRef.current);
      if (docs.size === 0) return null;
      const { rawFiles: files, projectName: name } = liveFilesRef.current;
      const root = project.current.root;
      return {
        dir: `/${name ?? root.replace(/\.[^.]*$/, '')}`,
        docs,
        root,
        files: files
          .filter((f) => /\.kicad_(pro|prl)$/i.test(f.name))
          .map((f) => ({ name: f.name, text: f.text })),
      };
    });
    return liveMirrorRef.current.get() !== null;
  };
  // (TRANSITIONAL, S4-6c/S5): KiCad's own canvas - SCH_DRAW_PANEL on the live model,
  // its VIEW and WX_VIEW_CONTROLS owning zoom and pan - over the window's, read only until the
  // tools (SCH_SELECTION_TOOL onward) run on it. The live model follows the records.
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const schPanelRef = useRef<SCH_DRAW_PANEL | null>(null);
  const [schFontImage, setSchFontImage] = useState<ImageBitmap | null>(null);
  const showLiveRef = useRef<() => void>(() => {});
  const schShownRef = useRef(false);
  showLiveRef.current = () => {
    const panel = schPanelRef.current;
    const frame = schFrameRef.current;
    if (!panel || !frame) return;
    // A rebuild of the live model zooms to fit (initScreenZoom); after the first showing, keep
    // where the user was.
    const view = panel.GetView();
    const had = schShownRef.current ? { scale: view.GetScale(), center: view.GetCenter() } : null;
    if (!syncLiveRef.current()) return;
    schShownRef.current = true;
    const file = currentFileRef.current;
    const path = frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.LastScreen()?.GetFileName().endsWith(`/${file}`));
    showingLiveRef.current = true;
    try {
      if (path && !path.equals(frame.GetCurrentSheet())) frame.SetCurrentSheet(path);
      else panel.DisplaySheet(frame.GetScreen());
    } finally {
      showingLiveRef.current = false;
    }
    if (had) {
      view.SetScale(had.scale);
      view.SetCenter(had.center);
    }
    panel.ForceRefresh();
  };
  useEffect(() => {
    let cancelled = false;
    loadBitmapFontImage().then(
      (img) => {
        if (!cancelled) setSchFontImage(img);
      },
      (err: unknown) => console.warn(`Could not use OpenGL: ${(err as Error).message}`),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed sheet or record is the trigger; the panel reads them through refs
  useEffect(() => {
    showLiveRef.current();
  }, [doc, currentFile]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the font atlas is the trigger; the rest are refs
  useEffect(() => {
    const canvas = glCanvasRef.current;
    const frame = schFrameRef.current;
    if (!canvas || !frame || !schFontImage || schPanelRef.current) return;
    const panel = createSchDrawPanel(frame, canvas, schFontImage);
    if (!panel) return;
    schPanelRef.current = panel;
    frame.ActivateGalCanvas();
    showLiveRef.current();
    return () => {
      panel.Destroy();
      schPanelRef.current = null;
      frame.SetCanvas(null);
    };
  }, [schFontImage]);

  // SchScriptApi.editLive: an edit on the live model, its screens written back into the window
  // as one undo step (sch_record_bridge.ts liveScreensToRecords; TRANSITIONAL until S7).
  editLiveRef.current = async (aEdit) => {
    if (!syncLiveRef.current()) return null;
    const frame = schFrameRef.current!;
    let edit: { result: Iterable<SCH_SCREEN> | null; messages: string[] };
    inEditLiveRef.current = true;
    try {
      edit = await frame.WithoutDialogsAsync(true, () => aEdit(frame));
    } catch (e) {
      // The edit may have changed the live model before it threw; the window has not changed,
      // so the next sync rebuilds the live model from it.
      liveMirrorRef.current?.Invalidate();
      throw e;
    } finally {
      inEditLiveRef.current = false;
    }
    const { result: screens, messages } = edit;
    if (!screens) return messages.length ? messages : ['nothing was changed'];
    adoptLiveScreensRef.current(screens);
    return messages;
  };
  // The live model's changed screens written back as the window's records (sch_record_bridge.ts
  // liveScreensToRecords; TRANSITIONAL until S7, when saving reads the live model). Stored as
  // KiCad wrote them, the very objects the mirror adopts: they used to go through runProject,
  // whose record cleanup (withCleanup) rebuilt them, so the mirror saw records it had not built
  // from and reopened the project - wiping SCH_EDIT_FRAME's undo list after every edit. The
  // undo step is the live commit's own (SCH_COMMIT::Push); KiCad's cleanup has already run in it.
  adoptLiveScreensRef.current = (screens) => {
    // A viewer's tab keeps no edits (runProject's guard, kept for the write-back).
    if (myRoleRef.current === 'viewer') return;
    const frame = schFrameRef.current!;
    const name = liveFilesRef.current.projectName;
    const dir = `/${name ?? project.current.root.replace(/\.[^.]*$/, '')}`;
    const docs = liveScreensToRecords(frame, screens, dir);
    const here = currentFileRef.current;
    const changed: PickedFile[] = [];
    for (const [file, d] of docs) {
      if (file === here) continue;
      // Another sheet, or a new sheet's file (initSheetDocument's case): the project holds it,
      // and it is reported for the host to write, as foldStep reports a sheet an edit touched.
      project.current.docs.set(file, d);
      try {
        changed.push({ name: file, text: serializeSchematic(d) });
      } catch {
        /* skip a bad sheet */
      }
    }
    if (changed.length) {
      pendingProjectChange.current.push(...changed);
      pendingIsMine.current = true;
    }
    liveMirrorRef.current?.Adopt(docs);
    const current = docs.get(here);
    if (current) setDoc(current);
  };
  // (TRANSITIONAL, S5): a tool on the live canvas committed (SCH_EDIT_FRAME::OnModify).
  // Its screen - and any sheet file the commit created - become the window's records, so the
  // window follows the live model the tools edit.
  // (TRANSITIONAL, W2c): a live tool changed sheets (DisplayCurrentSheet). The window
  // follows: the record path of that instance is '/' then each sheet below the top-level one,
  // by uuid ('/<uuid>/<uuid>/'), and the file is its screen's, relative to the project folder.
  liveSheetChangedRef.current = () => {
    if (showingLiveRef.current || !schPanelRef.current) return;
    const frame = schFrameRef.current!;
    const sheetPath = frame.GetCurrentSheet();
    const screen = sheetPath.LastScreen();
    if (!screen) return;
    let path = '/';
    for (let i = 1; i < sheetPath.size(); i++) path += `${sheetPath.at(i)!.m_Uuid}/`;
    const name = liveFilesRef.current.projectName;
    const dir = `/${name ?? project.current.root.replace(/\.[^.]*$/, '')}`;
    const absolute = screen.GetFileName().replace(/\\/g, '/');
    const file = absolute.startsWith(`${dir}/`) ? absolute.slice(dir.length + 1) : absolute;
    if (path !== currentPath || file !== currentFile) switchSheet(path, file);
  };
  liveModifiedRef.current = () => {
    if (inEditLiveRef.current || !schPanelRef.current) return;
    const frame = schFrameRef.current!;
    const changed = new Set<SCH_SCREEN>();
    const current = frame.GetScreen();
    if (current) changed.add(current);
    const name = liveFilesRef.current.projectName;
    const dir = `/${name ?? project.current.root.replace(/\.[^.]*$/, '')}`;
    const screens = new SCH_SCREENS(frame.Schematic().Root());
    for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
      const file = screen.GetFileName().replace(/\\/g, '/');
      const rel = file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : file;
      if (rel !== currentFileRef.current && !project.current.docs.has(rel)) changed.add(screen);
    }
    adoptLiveScreensRef.current(changed);
  };
  // ModalAnnotate: the Annotate dialog, which cannot block the mail here; the user annotates
  // and updates the board again.
  modalAnnotateRef.current = () => setAnnotateOpen(true);
  // `SaveProject()`: an assignment from this same mail round is written as it
  // folds; with nothing pending, the open sheet is saved now.
  saveProjectRef.current = () => {
    if (assignPendingRef.current) saveRequestedRef.current = true;
    else save();
    return true;
  };

  /**
   * `SCH_EDITOR_CONTROL::SaveCurrSheetCopyAs` (eeschema/tools/
   * sch_editor_control.cpp:426-442):
   *
   *     SCH_SHEET*   curr_sheet = m_frame->GetCurrentSheet().Last();
   *     wxFileName   curr_fn = curr_sheet->GetFileName();
   *     wxFileDialog dlg( …, curr_fn.GetPath(), curr_fn.GetFullName(),
   *                       FILEEXT::KiCadSchematicFileWildcard(),
   *                       wxFD_SAVE | wxFD_OVERWRITE_PROMPT );
   *     if( dlg.ShowModal() == wxID_CANCEL ) return false;
   *     wxString newFilename =
   *         EnsureFileExtension( dlg.GetPath(), FILEEXT::KiCadSchematicFileExtension );
   *     m_frame->saveSchematicFile( curr_sheet, newFilename );
   *
   * Three things this must NOT do, all of them from
   * `SCH_EDIT_FRAME::saveSchematicFile` (eeschema/files-io.cpp:989-1081):
   *
   *  - it writes the CURRENT SHEET only, never the hierarchy. The dialog is
   *    seeded from that sheet's own name, not the project's.
   *  - it never calls `screen->SetFileName()`, so the editor is NOT retargeted
   *    at the copy: you go on editing the original, and the title does not
   *    change.
   *  - on success it does `screen->SetContentModified( false )` and
   *    `SetStatusText( "File '%s' saved." )` built from `screen->GetFileName()`
   *    — the ORIGINAL name, because the screen was never renamed.
   *
   * That last pair looks like an upstream bug: saving a COPY clears the dirty
   * flag on a document that was not written, and then reports the original
   * file's name as the one saved. It is mirrored here deliberately rather than
   * corrected. The parity target is the installed build including where it is
   * odd; the moment we start fixing KiCad's oddities the two stop matching and
   * a user who knows KiCad is the one surprised.
   *
   * The path comes from the same file manager every other Save As uses -
   * upstream's is `wxFileDialog( … wxFD_SAVE | wxFD_OVERWRITE_PROMPT )` seeded
   * with the current sheet's name. It was a `window.prompt`, which cannot show
   * the project, cannot filter and cannot warn about an overwrite. Nothing
   * else about the command changes: the seed, the extension rule, what gets
   * written, and what is left alone are all upstream's.
   */
  const [copyAsOpen, setCopyAsOpen] = useState(false);
  // curr_fn.GetFullName() — the current sheet's own file name, which for us is
  // the file the editor has open.
  const copyAsSeed = currentFile !== DEFAULT_FILE ? currentFile : (fileName ?? DEFAULT_FILE);

  /** `curr_fn.GetFullName()` — the leaf, not the project-relative path. */
  const basename = (file: string): string => file.split('/').filter(Boolean).pop() ?? file;

  /**
   * `curr_fn.GetPath()` — the folder the sheet's own file sits in.
   *
   * A sheet's stored name is project-relative, so a sub-sheet kept in a
   * subfolder opens THERE rather than at the project root. With no directory
   * part the answer is the project folder itself, which is where a flat
   * project's sheets live.
   */
  const sheetDirOf = (project: string, file: string): string => {
    const parts = file.split('/').filter(Boolean);
    parts.pop();
    return [`/${project}`, ...parts].join('/');
  };
  const saveCurrSheetCopyAs = useCallback(() => setCopyAsOpen(true), []);

  const saveCurrSheetCopyTo = useCallback(
    (picked: string) => {
      const d = docRef.current;
      if (!d) return;

      const seed = copyAsSeed;
      const trimmed = picked.split('/').filter(Boolean).pop()?.trim() ?? '';
      if (!trimmed) return;

      const newFilename = ensureFileExtension(trimmed, KICAD_SCHEMATIC_FILE_EXTENSION);

      let text: string;
      try {
        text = serializeSchematic(d);
      } catch (e) {
        // saveSchematicFile's catch( IO_ERROR ) -> DisplayError, and success
        // stays false, so neither the dirty flag nor the status text is touched.
        setError(
          `Error saving schematic file '${newFilename}'.\n${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }

      if (onPersistFiles && currentFile !== DEFAULT_FILE) {
        onPersistFiles([{ name: newFilename, text }]);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = newFilename;
        a.click();
        URL.revokeObjectURL(url);
      }

      // screen->SetContentModified( false ), then the status text built from
      // screen->GetFileName() — the original, not the copy. See above.
      setDirty(false);
      setUnsaved(false);
      setStatusText(savedFileMessage(seed));
    },
    [copyAsSeed, currentFile, onPersistFiles],
  );

  /**
   * `SCH_EDITOR_CONTROL::Revert` (eeschema/tools/sch_editor_control.cpp:445-492).
   *
   * The order is upstream's and each step is load-bearing:
   *
   *  1. remember the current sheet, and whether it is a subsheet:
   *     `wasOnSubsheet = ( GetCurrentSheet().Last() != &root )`.
   *  2. if it is, navigate to the ROOT FIRST — `Hierarchy().at( 0 )`, with the
   *     comment "manually pushing root creates a path with empty KIID which
   *     causes assertions". Upstream deliberately does NOT `wxSafeYield()` here,
   *     "to avoid repainting the root sheet before the dialog", so the user
   *     sees the question rather than a flash of a sheet they did not ask for.
   *  3. ask. The string is verbatim, and `IsOK` (common/confirm.cpp:278-300) is
   *     a "Confirmation" dialog with a question icon whose OK/Cancel pair is
   *     relabelled Yes/No, with wxOK_DEFAULT — so YES is the default button.
   *  4. NO returns you to the sheet you were on (this one DOES yield) and
   *     changes nothing.
   *  5. YES marks every screen unmodified BEFORE restoring — "do not prompt the
   *     user for changes" — then releases and re-opens.
   *
   * The `%s` is `schematic.GetFileName()`, which is the first top-level sheet's
   * file (eeschema/schematic.cpp:524-532), not whichever sheet you are looking
   * at — the prompt names the project, and says "(and all sub-sheets)" because
   * it discards the whole hierarchy.
   *
   * What differs here, and it is the persistence model rather than a shortcut:
   * upstream re-reads the FILE, because KiCad writes to disk only on Save. We
   * autosave, so the file already holds the edits Revert is meant to discard;
   * our "last version saved" is the newest Local History save point instead.
   * Upstream keeps Revert and Local History's Restore Commit separate; here
   * they necessarily meet.
   */
  const revert = useCallback(() => {
    if (!onRevert) return;

    const rootSheet = flatSheets[0];
    const wasOnSubsheet = !!rootSheet && currentPath !== rootSheet.path;
    const originalSheet = { path: currentPath, file: currentFile };

    // Step 2: to the root before asking, and without repainting first.
    if (wasOnSubsheet && rootSheet) switchSheet(rootSheet.path, rootSheet.file, false);

    setRevertPrompt({
      // schematic.GetFileName() — the first top-level sheet's file.
      file: rootSheet?.file ?? currentFile,
      onNo: () => {
        setRevertPrompt(null);
        // Step 4: back to where they were.
        if (wasOnSubsheet) switchSheet(originalSheet.path, originalSheet.file, false);
      },
      onYes: () => {
        setRevertPrompt(null);
        // Step 5. `SetContentModified( false )` on every screen first, so the
        // reload does not stop to ask about the very changes being discarded.
        setDirty(false);
        setUnsaved(false);
        void onRevert().then((ok) => {
          if (!ok) setInfoBar('There is no saved version to revert to yet.');
        });
      },
    });
  }, [onRevert, flatSheets, currentPath, currentFile, switchSheet]);

  // ----- copy / cut / paste / duplicate (SCH_EDITOR_CONTROL port) -------------
  // Copy writes KiCad's clipboard format (lib_symbols + items as S-expressions),
  // so text copied here pastes into desktop KiCad and vice versa. Paste parses
  // the clipboard, gives everything fresh UUIDs, re-annotates duplicate
  // references, and attaches the items to the cursor until clicked to drop.
  // Text-entry focus only: a focused checkbox/radio (e.g. the Selection
  // Filter panel) must not swallow editor hotkeys the way a text box does.
  const isTyping = (): boolean => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    return (
      el.tagName === 'INPUT' &&
      !/^(checkbox|radio|button|range)$/.test((el as HTMLInputElement).type)
    );
  };

  useEffect(() => {
    // Editors stay mounted behind display:none, only the visible frame may
    // own the document clipboard events (see App's activeView stamp).
    const hidden = (): boolean => (document.body.dataset.activeView ?? 'schematic') !== 'schematic';
    const onCopy = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || selection.size === 0 || !doc) return;
      const text = copySelectionText(doc, selection);
      // Nothing the clipboard can carry: leave the system clipboard alone
      // rather than overwriting whatever is on it with an empty string.
      if (text === '') return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || selection.size === 0 || !doc) return;
      // TEMPORARY DIVERGENCE from KiCad, whose Cut always succeeds because its
      // copy carries sheets: SCH_EDITOR_CONTROL::doCopy stashes each sheet's
      // screen in m_supplementaryClipboard (sch_editor_control.cpp:1667) and
      // Paste rebuilds it (:2377-2472). We have not ported that yet, so
      // `copySelectionText` writes `sheets: []` — cutting a sheet would delete
      // it with nothing on the clipboard to paste back, and no undo path
      // through the clipboard at all. Refuse the cut instead of destroying it.
      // Delete this the moment the supplementary clipboard lands (finding 6 of
      // the M2 clipboard audit; sheet paste is its own branch).
      if (doc.sheets.some((sh, i) => selection.has(refId('sheet', sh.uuid, i)))) {
        e.preventDefault();
        setInfoBar('Cut cannot carry a sheet yet. Copy its contents, or use Delete.');
        return;
      }
      const text = copySelectionText(doc, selection);
      if (text === '') return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
      runCommand(deleteItems(doc, selection));
      setSelection(new Set());
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || !doc) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const payload = parsePastedText(text, doc, pasteOptions());
      if (!payload) return;
      e.preventDefault();
      setActiveTool('select');
      setPastePending(payload);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, [doc, selection, runCommand, pasteOptions]);

  // Select/Expand Connection (Ctrl+4 and the context menu). Each press widens
  // the selection by one stage; the walk itself lives in eeschema.
  const expandSelectionAlongConnection = useCallback(() => {
    if (!doc || selection.size === 0) return;
    setSelection(
      new Set(
        promote(
          selectConnection(doc, libById, selection, {
            passesFilter: (id) => filterIds(new Set([id])).size > 0,
          }),
        ),
      ),
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: promote/filterIds read refs
  }, [doc, libById, selection]);

  // Duplicate (Ctrl+D): copy to a local buffer and paste from it. KiCad anchors
  // the copy at the connection point closest to the cursor so it doesn't jump.
  const duplicateSelection = useCallback(() => {
    // `SCH_EDITOR_CONTROL::doCopy( true )` (sch_editor_control.cpp:1654-1661):
    // Duplicate copies `RequestSelection()` — unfiltered — and remembers
    // whether that was a hover, so the original is dropped from the selection
    // once the copy is on the cursor (:1772).
    const ids = requestTarget(AnyItems);
    const doc = docRef.current;
    if (!doc || ids.size === 0) return;
    // sch_edit_tool.cpp, DUPLICATE: the copy is re-annotated only when the
    // toggle is on —
    //
    //   if( m_frame->eeconfig()->m_AnnotatePanel.automatic )
    //   { ClearAnnotation(...); AnnotateSymbols( ANNOTATE_SELECTION, ... ); }
    //
    // and keeps the reference it was copied from otherwise, duplicate and all,
    // which is the state the annotate check is there to report. This always
    // re-annotated, so the toggle made no difference here either.
    const payload = parsePastedText(
      copySelectionText(doc, ids),
      doc,
      pasteOptions(es.annotation.automatic ? 'unique' : 'keep'),
    );
    if (!payload) return;
    let refPoint = payload.refPoint;
    const cursor = cursorRef.current;
    if (cursor) {
      let best = Infinity;
      const consider = (p: Vec2): void => {
        const d = (p.x - cursor.x) ** 2 + (p.y - cursor.y) ** 2;
        if (d < best) {
          best = d;
          refPoint = p;
        }
      };
      payload.batch.symbols.forEach((s) => consider(s.at));
      payload.batch.lines.forEach((l) => {
        consider(l.start);
        consider(l.end);
      });
      payload.batch.junctions.forEach((j) => consider(j.at));
      payload.batch.labels.forEach((l) => consider(l.at));
      // Every kind the clipboard carries needs an anchor here, or duplicating a
      // selection made only of these lands it at the payload's leftmost point
      // instead of under the cursor.
      payload.batch.busEntries.forEach((b) => consider(b.at));
      payload.batch.noConnects.forEach((n) => consider(n.at));
      payload.batch.textBoxes.forEach((t) => consider(t.start));
      payload.batch.images.forEach((im) => consider(im.at));
      payload.batch.directiveLabels.forEach((d) => consider(d.at));
    }
    setActiveTool('select');
    setPastePending({ ...payload, refPoint });
    // `m_duplicateIsHoverSelection`: the hover the copy was taken from is
    // dropped now that the duplicate is the thing on the cursor.
    finishCommand();
  }, [es.annotation.automatic, pasteOptions, requestTarget, finishCommand]);

  // ----- ERC (Inspect > Electrical Rules Checker) ------------------------------
  /** The run's options: the hierarchy, the project settings and the libraries. */
  const ercOptions = useCallback(
    (cfg: SchematicSetup): ErcRunOptions => {
      // The hierarchy feeds the sheet-pin / global-label tests: sub-sheet
      // documents by file, and the global labels used on every other sheet.
      const docs = liveDocs();
      const otherGlobals = new Set<string>();
      for (const [file, other] of docs) {
        if (file === currentFile) continue;
        for (const l of other.labels) if (l.kind === 'global_label') otherGlobals.add(l.text);
      }
      return {
        // Formatting's connection grid feeds the off-grid endpoint test.
        connectionGridIU: cfg.formatting.connectionGridMils * IU_PER_MILS,
        busAliases,
        subSheets: docs,
        otherSheetGlobalLabels: otherGlobals,
        ...(resolveTextVar ? { resolveTextVar } : {}),
        // SIM_LIB_MGR::ResolveLibraryPath: a `Sim.Library` path resolves
        // against the project, so the project's own files are the library set.
        simLibraryText: (path) => {
          const wanted =
            path
              .replace(/^\$\{KIPRJMOD\}[\\/]/, '')
              .split(/[\\/]/)
              .pop() ?? path;
          return rawFiles.find(
            (f) => f.name === path || f.name.endsWith(`/${wanted}`) || f.name === wanted,
          )?.text;
        },
        showAllErrors: app.settings.eeschema.erc_dialog.show_all_errors,
        // TestMissingNetclasses: a "Netclass" field may only name a class the
        // project defines (NET_SETTINGS::HasNetclass), or the default one.
        netclasses: {
          defaultName: cfg.netClasses.classes[0]?.name ?? 'Default',
          names: new Set(cfg.netClasses.classes.map((c) => c.name)),
        },
        // TestFootprintLinkIssues compares against the *configured* footprint
        // library table. Ours is whatever the deployment serves, so the test
        // only runs against a real library set, a bundled stub would report
        // every standard KiCad library as "not configured".
        ...(ercFootprintLibs.current && ercFootprintLibs.current.size >= MIN_FOOTPRINT_LIBS
          ? { footprintLibs: ercFootprintLibs.current }
          : {}),
      };
    },
    [liveDocs, currentFile, busAliases, resolveTextVar, app],
  );

  /** One synchronous ERC pass (used when a severity change re-runs the list). */
  const runErcWith = useCallback(
    (cfg: SchematicSetup): ErcViolation[] => {
      const d = doc;
      if (!d) return [];
      return runErc(d, new Map(d.libSymbols.map((l) => [l.libId, l])), cfg.erc, ercOptions(cfg));
    },
    [doc, ercOptions],
  );
  // The script API's ERC reads the doc through its ref: a host calls it
  // right after its own command, before React has rendered the new doc.
  // The script API's picture: the whole sheet through the plot path, in the
  // editor's theme. 150 dpi keeps 1.27 mm text legible to a vision model.
  const snapshotRef = useRef<() => string>(() => '');
  snapshotRef.current = () => {
    const d = docRef.current;
    if (!d) return '';
    const canvas = renderSheetToCanvas(
      d,
      theme,
      { color: true, drawingSheet: true, background: true },
      150,
    );
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
  };
  const ercNowRef = useRef<() => ErcViolation[]>(() => []);
  ercNowRef.current = () => {
    const d = docRef.current;
    if (!d) return [];
    return runErc(d, new Map(d.libSymbols.map((l) => [l.libId, l])), setup.erc, ercOptions(setup));
  };

  // The footprint library index (nickname -> footprint names) backing
  // TestFootprintLinkIssues; loaded on the first run, like upstream's
  // BlockUntilLoaded before the test.
  const ercFootprintLibs = useRef<Map<string, Set<string>> | null>(null);
  // The library's copy of each symbol used in the project, for the
  // ERCE_LIB_SYMBOL_MISMATCH comparison. Cached across runs.
  const ercLibrarySymbols = useRef<Map<string, LibSymbol>>(new Map());
  // The symbol library table as TestLibSymbolIssues sees it: nickname -> the
  // symbol names the library holds.
  const ercSymbolLibs = useRef<Map<string, Set<string>> | null>(null);
  // Configured libraries whose file would not load, with the URI they were
  // looked for at (SYMBOL_LIBRARY_ADAPTER::IsLibraryLoaded / GetFullURI).
  const ercUnloadedSymbolLibs = useRef<Map<string, string>>(new Map());
  // Pad numbers of each footprint the project assigns or associates, upstream
  // fetches these from CvPcb (KIFACE_FOOTPRINT_PAD_NUMBERS) for the pin-map tests.
  const ercFootprintPads = useRef<Map<string, Set<string>>>(new Map());

  /**
   * DIALOG_ERC::OnRunERCClick: switch to the "Tests Running…" page, walk the
   * phases (repainting between them), then show the results.
   */
  const runErcNow = useCallback(async () => {
    const d = doc;
    if (!d || ercRunning) return;
    ercCancelled.current = false;
    // Upstream's running page shows the tester's phases and nothing else: the
    // library loads DIALOG_ERC does first (BlockUntilLoaded, the CvPcb pad
    // fetch) happen silently behind its busy cursor.
    const messages: string[] = [];
    setErcRunning([...messages]);
    if (!ercFootprintLibs.current) {
      try {
        const index = await loadFootprintIndex();
        ercFootprintLibs.current = new Map(
          index.map((lib) => [lib.name, new Set(lib.footprints)] as const),
        );
      } catch {
        ercFootprintLibs.current = new Map();
      }
    }

    // Fetch the library copy of every symbol the project places, so the
    // mismatch test has something to compare against (upstream reads them from
    // the symbol library table).
    if (!ercSymbolLibs.current) {
      try {
        const index = await loadIndex();
        ercSymbolLibs.current = new Map(
          index.map((lib) => [lib.name, new Set(lib.symbols)] as const),
        );
      } catch {
        ercSymbolLibs.current = new Map();
      }
    }
    // SYMBOL_LIB_TABLE resolves a nickname through the *project* table before the
    // global one, and a project that ships its own symbols registers them only
    // there. The hosted index above is the global table's stand-in, so without
    // this every symbol such a project places reads as an unconfigured library
    // and TestLibSymbolIssues reports it once per symbol.
    const projectLibs = projectSymbolLibraries(rawFiles);
    for (const [nickname, names] of projectLibs.symbolLibs)
      ercSymbolLibs.current.set(nickname, names);
    for (const [nickname, uri] of projectLibs.unloaded)
      ercUnloadedSymbolLibs.current.set(nickname, uri);
    {
      const wanted = new Set<string>();
      for (const d of liveDocs().values()) for (const sym of d.symbols) wanted.add(sym.libId);
      await Promise.all(
        [...wanted].map(async (libId) => {
          if (ercLibrarySymbols.current.has(libId)) return;
          // The project's own libraries are already in hand; only the hosted
          // ones need fetching.
          const fromProject = projectLibs.librarySymbols.get(libId);
          if (fromProject) {
            ercLibrarySymbols.current.set(libId, fromProject);
            return;
          }
          const sep = libId.indexOf(':');
          if (sep <= 0) return;
          const libName = libId.slice(0, sep);
          if (projectLibs.symbolLibs.has(libName) || projectLibs.unloaded.has(libName)) return;
          try {
            const fromLib = await loadSymbol(libName, libId.slice(sep + 1));
            if (fromLib) ercLibrarySymbols.current.set(libId, fromLib);
            ercUnloadedSymbolLibs.current.delete(libName);
          } catch {
            // A library that will not load is TestLibSymbolIssues' second case.
            ercUnloadedSymbolLibs.current.set(libName, libraryUri(libName));
          }
        }),
      );
    }
    // ERC covers the whole hierarchy (SCH_SCREENS), not just the open sheet:
    // every sheet file is checked in turn and its markers carry its file name.
    const docs = liveDocs();
    const sheetFiles: string[] = [];
    for (const s of flatSheets) if (!sheetFiles.includes(s.file)) sheetFiles.push(s.file);
    if (sheetFiles.length === 0) sheetFiles.push(currentFile);

    // The pads of every footprint the project assigns, plus those its symbols
    // associate a pin map with, for the pin-map pad tests.
    {
      const wantedFootprints = new Set<string>();
      for (const d of liveDocs().values()) {
        const libs = new Map(d.libSymbols.map((l) => [l.libId, l]));
        for (const sym of d.symbols) {
          const fp = sym.fields.find((f) => f.key === 'Footprint')?.value ?? '';
          if (fp.includes(':')) wantedFootprints.add(fp);
          for (const assoc of libs.get(schSymbolLibraryName(sym))?.associatedFootprints ?? []) {
            if (assoc.footprintLibId.includes(':')) wantedFootprints.add(assoc.footprintLibId);
          }
        }
      }
      if (wantedFootprints.size > 0) {
        await Promise.all(
          [...wantedFootprints].map(async (libId) => {
            if (ercFootprintPads.current.has(libId)) return;
            try {
              const fp = await loadFootprint(libId);
              if (fp)
                ercFootprintPads.current.set(libId, new Set(fp.pads.map((pad) => pad.number)));
            } catch {
              /* an unreachable footprint stands the pad tests down */
            }
          }),
        );
      }
    }

    // CONNECTION_GRAPH: graph every sheet instance and propagate net names
    // through the sheet pins, so the net tests below see whole nets rather
    // than each sheet's slice of them.
    // setTimeout, not requestAnimationFrame, rAF never fires in a hidden tab,
    // which would leave an ERC run wedged half-way through.
    await new Promise((r) => setTimeout(r, 0));

    const hierSheets = flatSheets
      .map((s) => ({ path: s.path, file: s.file, doc: docs.get(s.file) }))
      .filter((s): s is { path: string; file: string; doc: Schematic } => !!s.doc);
    const hier = computeHierarchyNetlist(
      hierSheets,
      (s) => new Map(s.doc.libSymbols.map((l) => [l.libId, l])),
      { busAliases },
    );

    // Every pin of the hierarchy by (propagated) net name, and the net names
    // that carry a no-connect flag, upstream's merged m_nets entry.
    const pinsByNet = new Map<string, { file: string; pin: ExternalPin }[]>();
    const ncNets = new Set<string>();
    for (const sheet of hierSheets) {
      const netlist = hier.bySheet.get(sheet.path);
      if (!netlist) continue;
      const libs = new Map(sheet.doc.libSymbols.map((l) => [l.libId, l]));
      const byId = new Map(enumeratePins(sheet.doc, libs).map((p) => [p.id, p]));
      const nameOf = (id: string): string | undefined => {
        const code = netlist.netByItem.get(id);
        return netlist.nets.find((n) => n.code === code)?.name;
      };
      for (const [id, p] of byId) {
        const name = nameOf(id);
        if (name === undefined) continue;
        const arr = pinsByNet.get(name) ?? [];
        arr.push({
          file: sheet.file,
          pin: {
            electricalType: p.electricalType,
            ref: p.ref,
            number: p.number,
            hidden: p.hidden,
            file: sheet.file,
          },
        });
        pinsByNet.set(name, arr);
      }
      sheet.doc.noConnects.forEach((nc, i) => {
        const name = nameOf(refId('noconnect', nc.uuid, i));
        if (name !== undefined) ncNets.add(name);
      });
    }
    /**
     * The human-readable sheet path each file is checked under. ERC re-graphs one
     * sheet at a time, so it must qualify its net names with the same path the
     * hierarchy used or the cross-sheet pin lookup above would miss. A file used by
     * several instances is checked once, under its first instance's path, the same
     * approximation this file-based loop already makes.
     */
    const sheetPathFor = new Map<string, string>();
    /** …and the renames the hierarchy applied to that instance's net names, so the
     *  lookup finds them even when a parent's driver outranked this sheet's. */
    const hierNamesFor = new Map<string, ReadonlyMap<string, string>>();
    for (const sheet of hierSheets) {
      if (!sheetPathFor.has(sheet.file)) {
        sheetPathFor.set(sheet.file, hier.humanPaths.get(sheet.path) ?? '/');
        const renames = hier.hierNetNames.get(sheet.path);
        if (renames) hierNamesFor.set(sheet.file, renames);
      }
    }

    /** The pins of each net that do *not* live on `file`. */
    const externalPinsFor = (file: string): Map<string, ExternalPin[]> => {
      const map = new Map<string, ExternalPin[]>();
      for (const [name, entries] of pinsByNet) {
        const others = entries.filter((e) => e.file !== file).map((e) => e.pin);
        if (others.length > 0) map.set(name, others);
      }
      return map;
    };

    // SCH_REFERENCE_LIST and TestSimilarLabels span the whole hierarchy, so
    // each sheet's run is told what the other sheets hold. `sheetIndex` is the
    // sheet's place in the list, which decides who owns a marker that spans two
    // sheets, upstream never had to ask, walking every sheet in one pass.
    const sheetIndexOf = new Map(sheetFiles.map((f, i) => [f, i] as const));
    const allSymbols: (ExternalSymbol & { file: string })[] = [];
    const allLabels: (ExternalLabel & { file: string })[] = [];
    for (const file of sheetFiles) {
      const sheetDoc = file === currentFile ? d : docs.get(file);
      if (!sheetDoc) continue;
      const sheetIndex = sheetIndexOf.get(file) ?? 0;
      const libs = new Map(sheetDoc.libSymbols.map((l) => [l.libId, l]));
      sheetDoc.symbols.forEach((sym, index) => {
        const fieldOf = (key: string): string => sym.fields.find((f) => f.key === key)?.value ?? '';
        allSymbols.push({
          file,
          ref: fieldOf('Reference'),
          unit: sym.unit,
          libId: sym.libId,
          value: fieldOf('Value'),
          footprint: fieldOf('Footprint'),
          sheetIndex,
          index,
        });
      });
      let order = 0;
      for (const l of sheetDoc.labels) {
        if (l.kind === 'text') continue;
        allLabels.push({ file, text: l.text, isPin: false, sheetIndex, index: order++ });
      }
      // A power symbol's value is the text TestSimilarLabels compares.
      const seen = new Set<string>();
      for (const p of enumeratePins(sheetDoc, libs)) {
        if (p.electricalType !== 'power_in' || !p.isPowerSymbol || seen.has(p.symId)) continue;
        seen.add(p.symId);
        const sym = sheetDoc.symbols.find((_, i) => refId('symbol', _.uuid, i) === p.symId);
        const value = sym?.fields.find((f) => f.key === 'Value')?.value ?? '';
        if (value) allLabels.push({ file, text: value, isPin: true, sheetIndex, index: order++ });
      }
    }

    const found: ErcViolation[] = [];
    // As above: a plain task yield, so a run keeps going in a hidden tab.
    const frame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    for (const file of sheetFiles) {
      const sheetDoc = file === currentFile ? d : docs.get(file);
      if (!sheetDoc) continue;
      const steps = runErcSteps(
        sheetDoc,
        new Map(sheetDoc.libSymbols.map((l) => [l.libId, l])),
        setup.erc,
        {
          ...ercOptions(setup),
          sheetFile: file,
          sheetPath: sheetPathFor.get(file) ?? '/',
          sheetIndex: sheetIndexOf.get(file) ?? 0,
          externalSymbols: allSymbols.filter((x) => x.file !== file),
          externalLabels: allLabels.filter((x) => x.file !== file),
          externalNetPins: externalPinsFor(file),
          externalNetNoConnects: ncNets,
          ...(hierNamesFor.has(file) ? { hierNetNames: hierNamesFor.get(file)! } : {}),
          librarySymbols: ercLibrarySymbols.current,
          footprintPads: ercFootprintPads.current,
          // Only a real library set is a symbol library table; a failed index
          // load would otherwise report every library as unconfigured.
          ...(ercSymbolLibs.current && ercSymbolLibs.current.size > 0
            ? {
                symbolLibs: ercSymbolLibs.current,
                unloadedSymbolLibs: ercUnloadedSymbolLibs.current,
              }
            : {}),
        },
      );
      for (;;) {
        if (ercCancelled.current) break;
        const step = steps.next();
        if (step.done) {
          found.push(...step.value);
          break;
        }
        const line = step.value;
        // Only a phase name we have not shown yet is worth adding — every sheet
        // emits the same ones — but the **yield is unconditional**. Guarding it
        // on the same condition meant that from the second sheet onwards no line
        // was ever new, so the loop never yielded again and sheets 2..N ran in
        // one unbroken synchronous block: the tab stopped repainting, the
        // progress panel froze on its first line, and Cancel could not be
        // reached (#446).
        if (!messages.includes(line)) {
          messages.push(line);
          setErcRunning([...messages]);
        }
        await frame();
      }
      if (ercCancelled.current) break;
    }

    if (ercCancelled.current) {
      messages.push('-------- ERC cancelled by user.');
      setErcRunning([...messages]);
      await new Promise((r) => setTimeout(r, 500));
      setErcRunning(null);
      return;
    }

    // "%d symbol(s) require annotation.", reported as a head line upstream.
    const notAnnotated = found.filter((v) => v.code === 'unannotated').length;
    if (notAnnotated > 0) messages.unshift(`${notAnnotated} symbol(s) require annotation.`);
    messages.push('Done.');
    setErcRunning([...messages]);
    // The 500 ms upstream waits before flipping to the results page.
    await new Promise((r) => setTimeout(r, 500));
    setErcResult(found);
    setErcRunning(null);
  }, [
    doc,
    setup,
    ercOptions,
    ercRunning,
    liveDocs,
    flatSheets,
    currentFile,
    rawFiles,
    loadFootprintIndex,
    loadFootprint,
    loadIndex,
    loadSymbol,
    libraryUri,
  ]);

  // Clicking a violation centres the fault and selects the offending items.
  // DIALOG_ERC's cross-probe: select the violation's items, and scroll the
  // canvas to them only when "Center on Cross-probe" is on.
  const locateViolation = useCallback(
    (v: ErcViolation, center = true, itemId?: string) => {
      // A marker on another sheet: open its sheet first (KiCad's cross-probe
      // follows the marker's SCH_SHEET_PATH).
      let switched = false;
      if (v.file && v.file !== currentFile) {
        const target = flatSheets.find((s) => s.file === v.file);
        if (target) {
          switchSheet(target.path, target.file);
          switched = true;
        }
      }
      // FocusOnItem( ResolveItem( RC_TREE_MODEL::ToUUID( row ) ) ): a heading
      // row resolves to the *marker*, so it brightens the marker and leaves the
      // schematic items alone; only an item row focuses that item.
      // A sheet switch fits the canvas on the next frame, which would throw the
      // marker back off-centre; centre on the frame after, as FindNext does.
      if (center) {
        if (switched)
          requestAnimationFrame(() =>
            requestAnimationFrame(() => schFrameRef.current!.FocusOnLocation(v.at)),
          );
        else schFrameRef.current!.FocusOnLocation(v.at);
      }
      if (itemId) {
        // A marker's item may be a PIN (`<symId>:pin<k>`); the editor selects
        // its parent symbol, which is what upstream highlights too.
        setSelection(new Set([ercParentId(itemId)]));
      } else {
        setSelection(new Set());
      }
    },
    [currentFile, flatSheets, switchSheet],
  );

  // RC_TREE_MODEL's child rows: one description line per involved item
  // (SCH_EDIT_FRAME::ResolveItem + EDA_ITEM::GetItemDescription).
  const describeErcItem = useCallback(
    (id: string, file?: string): string => {
      const target = !file || file === currentFile ? doc : liveDocs().get(file);
      if (!target) return id;
      const kinds: ItemRef['kind'][] = [
        'symbol',
        'label',
        'line',
        'junction',
        'noconnect',
        'sheet',
        'busentry',
      ];
      const arrays: readonly (readonly { uuid?: string }[])[] = [
        target.symbols,
        target.labels,
        target.lines,
        target.junctions,
        target.noConnects,
        target.sheets,
        target.busEntries,
      ];
      // A marker's item may be a PIN, `<symId>:pin<k>`, and upstream names the
      // pin rather than the symbol it is on:
      //
      //   SCH_PIN::GetItemDescription   "Symbol %s %s"  (sch_pin.cpp:1721)
      //   SCH_PIN::getItemDescription   "Pin %s [%s, %s, %s]" with a name,
      //                                 "Pin %s [%s, %s]" without   (:1729-1750)
      //
      // so KiCad reads `Symbol #PWR01 Pin 1 [Power input, Line]` where this
      // fell through to the parent symbol and read `Symbol #PWR1 [GND]`.
      const pinAt = id.lastIndexOf(':pin');
      if (pinAt !== -1) {
        const symId = id.slice(0, pinAt);
        const pinIdx = Number(id.slice(pinAt + 4));
        for (let i = 0; i < target.symbols.length; i++) {
          const sym = target.symbols[i]!;
          if (refId('symbol', sym.uuid, i) !== symId) continue;
          const lib = target.libSymbols.find((l) => l.libId === schSymbolLibraryName(sym));
          const ref = sym.fields.find((f) => f.key === 'Reference')?.value ?? '';
          // The same walk `enumeratePins` uses (nets.ts:345-352) — the unit and
          // body-style filter included — so `k` here is the k that built the id.
          let pin: LibPin | undefined;
          if (lib) {
            let k = 0;
            outer: for (const u of lib.units) {
              if (
                (u.unit !== 0 && u.unit !== sym.unit) ||
                (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
              )
                continue;
              for (const q of u.pins) {
                if (k === pinIdx) {
                  pin = q;
                  break outer;
                }
                k++;
              }
            }
          }
          if (!pin) return `Symbol ${ref}`;
          // `UnescapeString( GetShownName() )` — an empty name is "~" upstream
          // and prints as nothing.
          const name = pin.name === '~' ? '' : pin.name;
          const type = electricalPinTypeGetText(pin.electricalType);
          const shape = pinShapeGetText(pin.shape);
          const desc = name
            ? `Pin ${pin.number} [${name}, ${type}, ${shape}]`
            : `Pin ${pin.number} [${type}, ${shape}]`;
          return `Symbol ${ref} ${desc}`;
        }
        return id;
      }

      for (let k = 0; k < kinds.length; k++) {
        const kind = kinds[k]!;
        const arr = arrays[k]!;
        for (let i = 0; i < arr.length; i++) {
          if (refId(kind, arr[i]!.uuid, i) === id) {
            const libs = new Map(target.libSymbols.map((l) => [l.libId, l]));
            return describeItem(target, libs, { kind, id });
          }
        }
      }
      return id;
    },
    [doc, currentFile, liveDocs],
  );

  /**
   * `SCHEMATIC_SETTINGS::m_TemplateFieldNames.GetTemplateFieldNames()` — the
   * RESOLVED templates, which is what every consumer upstream asks for and what
   * neither of ours was getting.
   *
   * There are two lists. Schematic Setup > Field Name Templates edits the
   * PROJECT's, and Preferences > Schematic Editor > Field Name Templates edits
   * the GLOBAL one in `eeschema.json`'s `drawing.field_names`
   * (`panel_template_fieldnames.cpp:50-60`). We passed `setup.fieldTemplates`
   * — the project's alone — to both dialogs, so a template added on the
   * Preferences page was stored, listed back on that page, and used by nothing.
   *
   * See `template_fieldnames.ts` for the merge, which is `resolveTemplates`.
   */
  const resolvedFieldTemplates = useMemo(
    () => resolveTemplateFieldnames(setup.fieldTemplates, es.drawing.field_names),
    [setup.fieldTemplates, es.drawing.field_names],
  );

  // Display + input options handed to the canvas, straight from the settings
  // (Preferences > Display Options / Grids / Mouse and Touchpad).
  const renderOpts = useMemo<RenderOpts>(
    () => ({
      showHiddenPins: es.appearance.show_hidden_pins,
      showHiddenFields: es.appearance.show_hidden_fields,
      // `SCH_RENDER_SETTINGS::LoadColors` copies the theme's
      // `GetOverrideSchItemColors()` into `m_OverrideItemColors`
      // (`sch_render_settings.cpp:75`); the painter then ignores every item's
      // own colour. The flag belongs to the THEME, so it comes from whichever
      // one is selected — see `overrideItemColorsFor`.
      overrideItemColors: app.overrideItemColorsFor(es.appearance.color_theme),
      showPageLimits: es.appearance.show_page_limits,
      // `eeconfig()->m_Appearance.show_directive_labels` — read per label by
      // the painter (sch_painter.cpp:3266), so the flags disappear the moment
      // Display Options turns them off, and a selected one stays visible.
      showDirectiveLabels: es.appearance.show_directive_labels,
      // `eeconfig()->m_Selection.fill_shapes`, read in the shadow pass
      // (sch_painter.cpp:2068).
      showPinAltIcons: es.appearance.show_pin_alt_icons,
      highlightNetclassColors: es.selection.highlight_netclass_colors,
      netclassHighlightThicknessMils: es.selection.highlight_netclass_colors_thickness,
      netclassHighlightAlpha: es.selection.highlight_netclass_colors_alpha,
      fillSelectedShapes: es.selection.fill_shapes,
      drawSelectedChildren: es.selection.draw_selected_children,
      // `eeconfig()->m_Appearance.mark_sim_exclusions` — the painter reads it
      // per symbol (sch_painter.cpp:2696), so the marker disappears the moment
      // Display Options turns it off.
      markSimExclusions: es.appearance.mark_sim_exclusions,
      ...(activeSheet ? { drawingSheet: activeSheet } : {}),
      // The on-screen title block shows the current instance's real page
      // number, sheet count and path (SCH_EDIT_FRAME::SetSheetNumberAndCount).
      ...((): Partial<RenderOpts> => {
        const idx = sheetInstanceRefs.findIndex((s) => s.path === currentPath);
        if (idx === -1) return {};
        const ref = sheetInstanceRefs[idx]!;
        return {
          pageNumber: pageNumberOf(currentPath) || String(idx + 1),
          sheetNumber: idx + 1,
          sheetCount: sheetInstanceRefs.length,
          ...(ref.path !== '/' ? { sheetName: ref.name } : {}),
          sheetPath: ref.namePath,
        };
      })(),
      // Default pen for zero-width strokes = Schematic Setup > Formatting's
      // "Default line width" (SCHEMATIC_SETTINGS::m_DefaultLineWidth), mils→IU.
      defaultPenIU: mmToIU((setup.formatting.defaultLineWidthMils * 25.4) / 1000),
      // Wires and buses resolve separately: SCH_LINE::GetPenWidth reads the
      // netclass's wire width on LAYER_WIRE and its *bus* width on LAYER_BUS,
      // and eeschema seeds those from Preferences > Editing Options
      // (m_Drawing.default_wire_thickness 6 mils, default_bus_thickness 12).
      // A bus is meant to read as twice as thick as a wire.
      defaultWireIU: mmToIU((es.drawing.default_wire_thickness * 25.4) / 1000),
      defaultBusIU: mmToIU((es.drawing.default_bus_thickness * 25.4) / 1000),
      // Junction-dot size, dash ratios and label/pin text offsets from
      // Schematic Setup > Formatting (SCH_RENDER_SETTINGS seeding).
      ...drawingDefaults,
      // Wire colour/width/style + junction clamp from the resolved netclasses.
      ...(netOverrides ? { netOverrides } : {}),
      // Which junction dots the graph put on LAYER_BUS_JUNCTION. Upstream this
      // is a flag CONNECTION_GRAPH writes onto the item; here it travels with
      // the other connectivity answers rather than being re-derived by the
      // painter.
      busJunctionIds,
      // ${VAR} expansion in labels/text/fields (GetShownText).
      ...(resolveTextVar ? { resolveTextVar } : {}),
      // ${INTERSHEET_REFS} on global labels (LAYER_INTERSHEET_REFS shown).
      ...(intersheetRefs ? { intersheetRefs } : {}),
      selectionThicknessMils: es.selection.thickness,
      highlightThicknessMils: es.selection.highlight_thickness,
      grid: {
        show: es.window.grid.show,
        sizeIU: gridSizeToIU(es.window.grid.sizes[es.window.grid.last_size_idx]?.x ?? '50 mil'),
        style: es.window.grid.style,
        lineWidthPx: es.window.grid.line_width,
        minSpacingPx: es.window.grid.min_spacing,
        devicePixelRatio: dpr,
        overrides: {
          enabled: es.window.grid.overrides_enabled,
          ...(es.window.grid.overrides.connected.enabled
            ? { connected: gridSizeToIU(es.window.grid.overrides.connected.size) }
            : {}),
          ...(es.window.grid.overrides.wires.enabled
            ? { wires: gridSizeToIU(es.window.grid.overrides.wires.size) }
            : {}),
          ...(es.window.grid.overrides.text.enabled
            ? { text: gridSizeToIU(es.window.grid.overrides.text.size) }
            : {}),
          ...(es.window.grid.overrides.graphics.enabled
            ? { graphics: gridSizeToIU(es.window.grid.overrides.graphics.size) }
            : {}),
        },
      },
    }),
    [
      es,
      activeSheet,
      setup,
      drawingDefaults,
      busJunctionIds,
      netOverrides,
      resolveTextVar,
      intersheetRefs,
      sheetInstanceRefs,
      currentPath,
      pageNumberOf,
      dpr,
      app,
    ],
  );

  const inputPrefs = useMemo<InputPrefs>(
    () => ({
      zoomSpeed: common.input.zoom_speed,
      zoomSpeedAuto: common.input.zoom_speed_auto,
      zoomAcceleration: common.input.zoom_acceleration,
      centerOnZoom: common.input.center_on_zoom,
      reverseZoom: common.input.reverse_scroll_zoom,
      scrollModZoom: common.input.scroll_modifier_zoom,
      scrollModPanH: common.input.scroll_modifier_pan_h,
      scrollModPanV: common.input.scroll_modifier_pan_v,
      reverseScrollPanH: common.input.reverse_scroll_pan_h,
      horizontalPan: common.input.horizontal_pan,
      motionPanModifier: common.input.motion_pan_modifier,
      autoPan: common.input.auto_pan,
      autoPanAcceleration: common.input.auto_pan_acceleration,
      mouseLeft: common.input.mouse_left as InputPrefs['mouseLeft'],
      mouseMiddle: common.input.mouse_middle as InputPrefs['mouseMiddle'],
      mouseRight: common.input.mouse_right as InputPrefs['mouseRight'],
      dragIsMove: es.input.drag_is_move,
      autoStartWires: es.drawing.auto_start_wires,
      crosshair: es.window.cursor.crosshair,
      alwaysShowCrosshair: es.window.cursor.always_show_cursor,
    }),
    [common, es],
  );

  // Selecting a placement tool reopens its chooser/dialog (clears any attached item).
  const onToolSelect = useCallback((id: string) => {
    // Every one of these is an AF_ACTIVATE tool, so picking the one already
    // running stops it — see `activateTool`. Checked before the two tools that
    // open something, or clicking a lit Image button would reopen the file
    // picker instead of putting the tool away.
    if (activeToolRef.current === id) {
      setActiveTool('select');
      setPlaceLib(null);
      setPendingLabel(null);
      setPendingImage(null);
      return;
    }
    // The Image tool opens a file picker; the image then follows the cursor
    // (SCH_ACTIONS::placeImage).
    if (id === 'image') {
      imageInputRef.current?.click();
      return;
    }
    setActiveTool(id);
    setPlaceLib(null);
    setPendingLabel(null);
    setPendingImage(null);
  }, []);

  /**
   * "Place Pins from Sheet" (`SCH_ACTIONS::importSheetPin`).
   *
   * The tool imports; it does not ask. `TwoClickPlace` takes the next
   * hierarchical label the child sheet has and the parent has no pin for —
   *
   *     SCH_HIERLABEL* label = importHierLabel( sheet );
   *     if( !label ) { … "No new hierarchical labels found." … break; }
   *     item = createNewSheetPinFromLabel( sheet, cursorPos, label );
   *
   * — and `createNewSheetPinFromLabel` copies the label's text *and* shape onto
   * the pin, so the two cannot disagree. Ours opened the pin-properties dialog
   * and had you type a name, which is the manual gesture upstream only offers
   * from the sync dialog, and which lets a pin and its label drift apart.
   */
  /**
   * The placement queue ran out (or was abandoned): put the tool away and bring
   * the dialog back, on the sheet it was opened over.
   *
   *     m_frame->PopTool( aEvent );
   *     m_toolMgr->RunAction( ACTIONS::selectionClear );
   *     m_dialogSyncSheetPin->Show( true );
   *
   * and the same on escape, via `EndPlacement()`. The dialog is not rebuilt —
   * `syncPinsOpen` was never cleared, only hidden while a placement was running
   * — but its sub-sheet documents are re-read, since placing labels changed one.
   */
  const endSyncPlacement = useCallback(() => {
    setSyncPlacement(null);
    setActiveTool('select');
    setPendingLabel(null);
    const back = syncReturn.current;
    syncReturn.current = null;
    if (back) switchSheet(back.path, back.file);
    setSyncPinsOpen((prev) =>
      prev ? prev.map((e) => ({ ...e, sub: project.current.docs.get(e.file) ?? e.sub })) : prev,
    );
  }, [switchSheet]);

  /**
   * The document the sync dialog was opened over. Read from the project rather
   * than taken as `doc`, because placing hierarchical labels navigates into the
   * sub-sheet and the dialog still belongs to the sheet it was opened on.
   */
  const syncParent: Schematic | null = !syncPinsOpen
    ? null
    : syncParentFile.current === currentFile
      ? doc
      : (project.current.docs.get(syncParentFile.current) ?? null);

  /**
   * SCH_DRAWING_TOOLS::m_statusPopup: a tool's one popup, replaced by the next
   * (`std::make_unique` over the old one) and shown beside the cursor for two
   * seconds - `Move( GetMousePosition() + wxPoint( 20, 20 ) ); PopupFor( 2000 )`.
   */
  const statusPopupRef = useRef<STATUS_TEXT_POPUP | null>(null);
  useEffect(() => () => statusPopupRef.current?.Destroy(), []);

  // `wxWindow::PopupMenu` for the frame under (TRANSITIONAL, W2): the tools'
  // context menu (TOOL_MENU::ShowContextMenu, evaluated against the selection) and any other
  // ACTION_MENU a tool puts up, drawn with the menu bar's ContextMenu.
  const [toolPopup, setToolPopup] = useState<{
    menu: ACTION_MENU;
    x: number;
    y: number;
    onClose: () => void;
  } | null>(null);
  useEffect(() => {
    const frame = schFrameRef.current;
    if (!frame) return;
    frame.SetPopupMenuPresenter((aMenu, aOnClose) => {
      const at = KIPLATFORM_UI.GetMousePosition();
      aMenu.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_MENU_OPEN, 0, aMenu));
      setToolPopup({ menu: aMenu, x: at.x, y: at.y, onClose: aOnClose });
    });
    return () => frame.SetPopupMenuPresenter(null);
  }, []);

  /** The active grid step, which the table's cell size is snapped to. */
  const gridSizeIU = useMemo(
    () => gridSizeToIU(es.window.grid.sizes[es.window.grid.last_size_idx]?.x ?? '50 mil'),
    [es.window.grid.sizes, es.window.grid.last_size_idx],
  );
  gridSizeIURef.current = gridSizeIU;

  /** A label was dropped: take the next of a multi-label run, else stop. */
  // What F1 repeats: the items the last placement produced
  // (SCH_EDIT_FRAME::GetRepeatItems).
  const repeatItemsRef = useRef<string[]>([]);

  /** The sheet as DIALOG_SHEET_PROPERTIES wants it: its fields as grid rows,
   *  its border and fill, this instance's page number and its attributes. */
  // Flush a cross-probe that arrived before the ERC dialog was on screen: the
  // double-click that opens it cannot select a row in a dialog that does not
  // exist yet, and `CrossProbe` shows the dialog *then* calls SelectMarker.
  useEffect(() => {
    const key = pendingErcSelect.current;
    if (!key || !ercOpen) return;
    if (ercNav.current?.selectByKey(key)) pendingErcSelect.current = null;
  }, [ercOpen, ercResult, es.appearance.show_erc_errors, es.appearance.show_erc_warnings]);

  // The image file picker: read the chosen bitmap as base64 and attach it to the cursor.
  const onImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      const comma = res.indexOf(',');
      setPendingImage(makeImage({ x: 0, y: 0 }, comma >= 0 ? res.slice(comma + 1) : res));
      setActiveTool('image');
    };
    reader.readAsDataURL(file);
  }, []);

  /**
   * SCH_EDITOR_CONTROL::AssignNetclass — reduce the selection to net-name
   * patterns and open the picker. The refusals are upstream's and are shown in
   * the error bar rather than silently doing nothing.
   */
  const assignNetclass = useCallback(() => {
    if (!netlist) return;
    const plan = planNetclassAssignment(selectedNets(netlist, selection));
    if (plan.error) {
      setError(plan.error);
      return;
    }
    setNetclassPatterns(plan.patterns);
  }, [netlist, selection]);

  const onTopAction = useCallback(
    (id: string) => {
      // the canvas-editing actions run on the frame's TOOL_MANAGER (TRANSITIONAL, W2).
      const galAction = schToolbarAction(id);
      const galMgr = schFrameRef.current?.GetToolManager();
      if (galAction && galMgr) {
        galMgr.RunAction(galAction);
        return;
      }
      // ACTIONS::about — Help > About. The menu sent this id and nothing
      // answered it, so the schematic's About did nothing at all.
      if (id === 'about') {
        setAboutOpen(true);
        return;
      }
      // ACTIONS::listHotKeys — Ctrl+F1 and Help > List Hotkeys.
      if (id === 'listHotkeys') {
        showHotkeyList();
        return;
      }
      if (id === 'assignNetclass') {
        assignNetclass();
        return;
      }
      if (id === 'open') promptOpen();
      else if (id === 'save') save();
      // SCH_ACTIONS::saveCurrSheetCopyAs
      else if (id === 'saveCurrSheetCopyAs') saveCurrSheetCopyAs();
      // ACTIONS::revert
      else if (id === 'revert') revert();
      else if (id === 'erc') setErcOpen(true);
      else if (id === 'manageSymbolLibraries') setSymLibTableOpen(true);
      else if (id === 'ercPrevMarker' || id === 'ercNextMarker' || id === 'ercExcludeMarker') {
        // The dialog owns the tree, so raise it first and act on the next tick,
        // when it has mounted and filled in the ref (dlg->Show(true); dlg->Raise();
        // dlg->NextMarker()).
        setErcOpen(true);
        const act = id;
        requestAnimationFrame(() => {
          const nav = ercNav.current;
          if (!nav) return;
          if (act === 'ercPrevMarker') nav.prev();
          else if (act === 'ercNextMarker') nav.next();
          else nav.excludeCurrent();
        });
      } else if (id === 'syncSheetPins' || id === 'syncAllSheetPins') {
        // syncSheetPins acts on the selected sheet symbol, syncAllSheetsPins on
        // every sheet of the open screen. Both need the sub-sheet's document,
        // which only a loaded project has.
        const d = docRef.current;
        // The single-sheet form is `RequestSelection( { SCH_SHEET_T } )`, the
        // list every other sheet command uses (sch_edit_tool.cpp:3403, :3430),
        // so hovering a sheet is enough to open its Sync Sheet Pins.
        const target = id === 'syncSheetPins' ? requestTarget(SheetItems) : new Set<string>();
        const wanted =
          id === 'syncSheetPins'
            ? (d?.sheets
                .map((sh, i) => ({ sh, i }))
                .filter(({ sh, i }) => target.has(refId('sheet', sh.uuid, i))) ?? [])
            : (d?.sheets.map((sh, i) => ({ sh, i })) ?? []);
        const entries: SyncSheetEntry[] = [];
        for (const { sh, i } of wanted) {
          const file = sheetFile(sh);
          const sub = file ? project.current.docs.get(file) : undefined;
          if (!file || !sub) continue;
          entries.push({
            sheetIndex: i,
            name: sh.fields.find((f) => f.key === 'Sheetname')?.value ?? file,
            file,
            sub,
          });
        }
        if (entries.length === 0)
          setInfoBar(
            id === 'syncSheetPins'
              ? 'Select a sheet whose file is part of this project.'
              : 'This schematic has no sub-sheets loaded from the project.',
          );
        else {
          // Which file the dialog belongs to, so it survives navigating away to
          // place labels; and the page of the selected sheet, which upstream
          // pre-selects (`SCH_SHEET* selectedSheet = … GetSelection().Front()`).
          syncParentFile.current = currentFile;
          const sel = entries.findIndex(({ sheetIndex }) =>
            target.has(refId('sheet', d?.sheets[sheetIndex]?.uuid, sheetIndex)),
          );
          syncPage.current = sel >= 0 ? sel : 0;
          setSyncPinsOpen(entries);
        }
      } else if (id === 'importSheet') {
        // `SCH_DRAWING_TOOLS::ImportSheet`. Upstream loads the file, selects
        // everything it brought in and moves it to the cursor — which is what
        // paste already does here, so this is paste sourced from a file rather
        // than from the clipboard. `parsePastedText` already accepts a whole
        // `(kicad_sch …)` document, so the reader needs nothing new.
        setImportSheetOpen(true);
      } else if (id === 'importGraphics') {
        // SCH_ACTIONS::importGraphics -> EE_GRAPHIC_TOOL::ImportGraphics: the
        // dialog parses, and only its OK produces anything to place.
        setImportGfxOpen(true);
      } else if (id === 'showPcbNew') onShowPcb?.();
      else if (id === 'updatePcbFromSch') onUpdatePcb?.();
      else if (id === 'updateSchFromPcb') {
        // The host loads the board reader on use, so the first invocation waits
        // on a fetch. Everything below is state, so there is nothing for the
        // command handler itself to return or await.
        void (async () => {
          const fps = (await readBoardFootprints?.()) ?? null;
          // A board that cannot be read is worth saying so about; an empty one is
          // a legitimate answer and the dialog reports "no changes".
          if (fps) setBackAnnotateFps(fps);
          else setInfoBar('No board to read, or the board could not be parsed.');
        })();
      } else if (id === 'symbolEditor') onShowSymbolEditor?.();
      else if (id === 'footprintEditor') onShowFootprintEditor?.();
      else if (id === 'bom') openFieldsTable('bom');
      else if (id === 'exportNetlist') setNetlistOpen(true);
      else if (id === 'editSymbolFields') openFieldsTable('edit');
      else if (id === 'symbolBrowser') setBrowserOpen(true);
      else if (id === 'assignFootprints') setAssignFpOpen(true);
      else if (id === 'showCalculator') onShowCalculator?.();
      // ACTIONS::selectAll, whose row carries Ctrl+A and dispatches from there.
      else if (id === 'selectAll')
        setDoc((d) => {
          // Select All honors the Selection Filter (SCH_SELECTION_TOOL::SelectAll
          // runs every item through itemPassesFilter).
          if (d)
            setSelection(
              applySelectionFilter(
                d,
                boxSelect(d, libById, { x: 1e15, y: 1e15 }, { x: -1e15, y: -1e15 }),
                selFilterRef.current,
              ),
            );
          return d;
        });
      else if (id === 'unselectAll') setSelection(new Set());
      // Group / Ungroup (SCH_GROUP_TOOL): members stay selected afterwards,
      // upstream selects the new group (= its members) / the freed members.
      else if (id === 'addToGroup')
        setSelection((sel) => {
          const d = docRef.current;
          if (d && canAddToGroup(d, sel)) runCommand(addToGroupCommand(sel));
          return sel;
        });
      else if (id === 'removeFromGroup')
        setSelection((sel) => {
          const d = docRef.current;
          if (d && canRemoveFromGroup(d, sel)) runCommand(removeFromGroupCommand(sel));
          return sel;
        });
      // Lock / Unlock / Toggle Lock: `SCH_EDIT_TOOL::SetAttribute`
      // (sch_edit_tool.cpp:3530-3616), whose target is
      // `RequestSelection( { SCH_SYMBOL_T, SCH_SHEET_T, SCH_RULE_AREA_T } )`
      // and which clears a hover selection at :3614.
      else if (id === 'lock' || id === 'unlock' || id === 'toggleLock')
        withSelection(AttributeItems, (ids) =>
          runCommand(
            setSymbolsLockedCommand(
              ids,
              id === 'lock' ? 'lock' : id === 'unlock' ? 'unlock' : 'toggle',
            ),
          ),
        );
      // `SCH_EDIT_TOOL::SwapPins` (`sch_edit_tool.cpp:1765-1900`). The
      // preference is checked here too, not only on the menu entry: upstream's
      // handler opens with the same test (`:1769-1770`), so a hotkey or a
      // scripted call cannot get past it either.
      else if (id === 'swapPins') {
        if (!doc || !es.input.allow_unconstrained_pin_swaps) return;
        const r = swapPinsCommand(doc, libById, [...selection], project.current.root);
        if ('cmd' in r) {
          runCommand(r.cmd);
          // `if( selection.IsHover() ) RunAction( selectionClear )` — and the
          // pins have moved, so the ids no longer name what was picked.
          setSelection(new Set());
        } else if (r.kind === 'shared') {
          setInfoBar(sharedPinSwapMessage(r));
        }
      } else if (id === 'openPreferences') setPrefsOpen(true);
      else if (id === 'close') onExitToHome();
      // ACTIONS::help — "Open product documentation in a web browser".
      else if (id === 'help')
        window.open('https://docs.ziroeda.com', '_blank', 'noopener,noreferrer');
      // Tools > Project Manager. One page here, so it lands where Close does.
      else if (id === 'showProjectManager') onExitToHome();
      else if (id === 'find') openFindDialog('find');
      else if (id === 'findReplace') openFindDialog('replace');
      else if (id === 'annotate') setAnnotateOpen(true);
      else if (id === 'incrementAnnotations') setIncrementAnnotationsOpen(true);
      else if (id === 'globalEditTextAndGraphics') setGlobalEditOpen(true);
      else if (id === 'rescueSymbols') void runRescueSymbols(true);
      else if (id === 'editSymbolLibraryLinks') {
        setLibIdErrors([]);
        setLibIdsOpen(true);
      } else if (id === 'schematicSetup') {
        // The Embedded Files page lists the sheet's embedded_files section
        // (names + embed-fonts flag) fresh from the document on every open,
        // read-only until the zstd blobs can be decoded.
        if (doc) {
          const emb = listEmbeddedFiles(doc);
          setSetup((prev) => ({
            ...prev,
            embeddedFiles: {
              files: emb.files.map((f) => ({ name: f.name, reference: f.reference })),
              embedFonts: emb.embedFonts,
            },
          }));
        }
        setSetupOpen(true);
      } else if (id === 'pageSettings') setPageSettingsOpen(true);
      else if (id === 'print') setPrintOpen(true);
      else if (id === 'plot') setPlotOpen(true);
      else if (id === 'editPageNumber') setPageEdit({ page: pageNumberOf(currentPath) });
      // Hierarchy navigation (SCH_NAVIGATE_TOOL). Back/Forward move the history
      // cursor without pushing; Up and Previous/Next go through changeSheet.
      else if (id === 'navBack' || id === 'navFwd') {
        const p = id === 'navBack' ? navTool.current.back() : navTool.current.forward();
        const target = p !== null ? flatSheets.find((s) => s.path === p) : undefined;
        if (target) switchSheet(target.path, target.file, false);
      } else if (id === 'navUp') {
        const pp = parentPath(currentPath);
        const target = pp !== null ? flatSheets.find((s) => s.path === pp) : undefined;
        if (target) switchSheet(target.path, target.file);
      } else if (id === 'navPrev' || id === 'navNext') {
        const idx = flatSheets.findIndex((s) => s.path === currentPath);
        const target = idx !== -1 ? flatSheets[idx + (id === 'navNext' ? 1 : -1)] : undefined;
        if (target) switchSheet(target.path, target.file);
      }
      // Menu Cut/Copy re-dispatch the native clipboard events our document
      // handlers already implement; Paste reads the async clipboard API (menu
      // clicks can't synthesize a trusted paste event).
      else if (id === 'cut') document.execCommand('cut');
      else if (id === 'copy') document.execCommand('copy');
      // ACTIONS::copyAsText (SCH_EDITOR_CONTROL::CopyAsText,
      // sch_editor_control.cpp:1840-1852): `RequestSelection()` with no filter,
      // and `if( selection.IsHover() ) selectionClear` at :1849.
      else if (id === 'copyAsText')
        withSelection(AnyItems, (ids) => {
          const d = docRef.current;
          const text = d ? getSelectedItemsAsText(d, ids) : '';
          if (text) void navigator.clipboard?.writeText(text);
        });
      else if (id === 'pasteSpecial') setPasteSpecialOpen(true);
    },
    [
      undo,
      redo,
      save,
      saveCurrSheetCopyAs,
      revert,
      promptOpen,
      runCommand,
      runErcNow,
      onShowPcb,
      onUpdatePcb,
      onShowSymbolEditor,
      onShowFootprintEditor,
      onShowCalculator,
      onExitToHome,
      flatSheets,
      currentPath,
      switchSheet,
      doc,
      netlist,
      selection,
      libById,
      pageNumberOf,
      pasteOptions,
      withSelection,
      requestTarget,
      applySelectionState,
      runRescueSymbols,
    ],
  );

  /**
   * A right-toolbar click. Most of its buttons arm a placement tool; the few in
   * `RIGHT_TOOLBAR_COMMANDS` run straight away instead, so they go to the same
   * dispatcher the menu items use rather than becoming an `activeTool` no tool
   * answers to.
   */
  const onRightToolbar = useCallback(
    (id: string) => {
      // the tools run on the frame's TOOL_MANAGER (TRANSITIONAL, W2).
      const galAction = schToolbarAction(id);
      const galMgr = schFrameRef.current?.GetToolManager();
      if (galAction && galMgr) {
        galMgr.RunAction(galAction);
        return;
      }
      if (RIGHT_TOOLBAR_COMMANDS.has(id)) onTopAction(id);
    },
    [onTopAction],
  );

  const onLeftToggle = useCallback(
    (id: string) => {
      // Not a toggle, and not a button either: the Show Grid button carries a
      // right-click menu whose one row is `ACTIONS::gridProperties`
      // (`eeschema/toolbars_sch_editor.cpp:71-79`), and upstream runs that row
      // through the same TOOL_MANAGER the button goes through, so it arrives
      // here. `COMMON_TOOLS::GridProperties` for FRAME_SCH is
      // `ShowPreferences( _( "Grids" ), _( "Schematic Editor" ) )`
      // (`common/tool/common_tools.cpp:623`).
      if (id === 'gridProperties') {
        openPrefs('sch-grids');
        return;
      }
      // The Attributes submenu is a set of item edits, not a view setting: it
      // acts on the selection (SCH_EDIT_TOOL::SetAttribute).
      const attr = ATTRIBUTE_IDS[id];
      if (attr) {
        if (doc) {
          const cmd = setAttribute(doc, selection, attr);
          if (cmd) runCommand(cmd);
        }
        return;
      }
      if (SETTINGS_TOGGLES.has(id)) {
        app.settings.updateEeschema((s) => {
          if (id === 'toggleGrid') s.window.grid.show = !s.window.grid.show;
          else if (id === 'toggleGridOverrides')
            s.window.grid.overrides_enabled = !s.window.grid.overrides_enabled;
          else if (id === 'toggleHiddenPins')
            s.appearance.show_hidden_pins = !s.appearance.show_hidden_pins;
          else if (id === 'toggleHiddenFields')
            s.appearance.show_hidden_fields = !s.appearance.show_hidden_fields;
          else if (id === 'crosshairSmall') s.window.cursor.crosshair = 'small';
          else if (id === 'crosshairFull') s.window.cursor.crosshair = 'full';
          else if (id === 'crosshair45') s.window.cursor.crosshair = '45';
          else if (id === 'lineModeFree') s.drawing.line_mode = 0;
          else if (id === 'lineMode90') s.drawing.line_mode = 1;
          else if (id === 'lineMode45') s.drawing.line_mode = 2;
          else if (id === 'annotateAuto') s.annotation.automatic = !s.annotation.automatic;
        });
        return;
      }
      setLocalToggles((prev) => applyToggle(prev, id));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [doc, selection, runCommand, openPrefs, app],
  );

  // Menus carry their shortcut as literal text, so a rebinding has to be
  // painted back over them (see applyHotkeyOverrides).
  const hotkeyOverrides = app.useHotkeyOverrides();
  /**
   * The tree as the actions *declare* it, before any rebinding is painted on.
   *
   * Split out because the two consumers want opposite things. What is drawn
   * must show the user's own key, so it gets `applyHotkeyOverrides`. What
   * *dispatches* must match the defaults, because `remapEvent` has already
   * turned a rebound press into the action's default combo - that is the whole
   * mechanism, and it is why the key chain "deliberately still matches on the
   * defaults". Dispatching against the painted tree would mean translating the
   * event to the default and then comparing it with the override, so every
   * rebound command would answer to nothing.
   */
  const menusRaw = useMemo(
    () =>
      buildMenus(
        {
          tool: onToolSelect,
          action: onTopAction,
          toggle: onLeftToggle,
          // Preferences > Set Language (menubar.cpp:347-348). The setting is
          // COMMON_SETTINGS', shared by every frame, so it is read and written
          // through the common store exactly as the other five launchers do.
          language: app.settings.common.system.language,
          onSelectLanguage: (label: string) =>
            app.settings.updateCommon((c) => {
              c.system.language = label;
            }),
        },
        {
          // CHECK( cond.CurrentTool( ACTIONS::zoomTool ) ): the View entry ticks
          // while the tool is running, the same condition the button uses.
          zoomTool: activeTool === 'zoomTool',
          toggleHiddenPins: es.appearance.show_hidden_pins,
          toggleHiddenFields: es.appearance.show_hidden_fields,
          showProperties: toggles.has('showProperties'),
          showSearch: toggles.has('showSearch'),
          showHierarchy: toggles.has('showHierarchy'),
          showNetNavigator: toggles.has('showNetNavigator'),
          // Each attribute shows checked only when everything the action would
          // touch already carries it, the same test the action itself uses.
          ...Object.fromEntries(
            Object.entries(ATTRIBUTE_IDS).map(([id, a]) => [
              id,
              !!doc && attributeIsSet(doc, selection, a),
            ]),
          ),
        },
      ),
    [
      onToolSelect,
      onTopAction,
      onLeftToggle,
      es.appearance.show_hidden_pins,
      es.appearance.show_hidden_fields,
      toggles,
      activeTool,
      doc,
      selection,
      app,
    ],
  );
  const menus = useMemo(
    () => applyHotkeyOverrides(menusRaw, hotkeyOverrides),
    [menusRaw, hotkeyOverrides, applyHotkeyOverrides],
  );

  /**
   * The tree the chain dispatches off, read through a ref: it is rebuilt on
   * every render, and depending on it would tear the listener down and put it
   * back on each keystroke's re-render. `useMenuHotkeys` holds one for the
   * same reason.
   */
  const menusRef = useRef<Menu[]>(menusRaw);
  menusRef.current = menusRaw;

  // The frame's single key chain, in ACTION_MANAGER::RunHotKey order: the
  // context actions this canvas owns, then the menus. See ui/menu_hotkeys.ts.
  //
  // The dispatch is called from *inside* this listener rather than added
  // beside it, which matters more here than anywhere else in the app: the
  // event the menus must see is the one `remapEvent` produced, so a user's
  // rebinding reaches a menu row exactly as it reaches a tool key.
  useEffect(() => {
    const onKey = (raw: KeyboardEvent) => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'schematic') !== 'schematic') return;
      // `defaultPrevented` means someone already acted on this key - EXCEPT
      // when it was our own browser suppressor, which runs in the capture phase
      // and cancels every combo the app claims purely to stop the browser.
      // Reading that as "handled" is what made every hotkey in the app stop
      // working once the dispatcher landed (c4a00590).
      if (raw.defaultPrevented && !wasBrowserSuppressed(raw)) return;
      // tool_dispatcher.cpp:654-670 - an editable entry takes every key, a
      // read-only one keeps Ctrl+C.
      const target = raw.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, raw)) return;
      // The user's rebindings, applied before anything below sees the event: a
      // key bound elsewhere arrives spelled as the action's *default* combo, and
      // a cleared one arrives as null and stops here. See hotkey_bindings.ts —
      // the chain below deliberately still matches on the defaults.
      // Read off the manager rather than through a subscription: this effect is
      // re-bound on a long dependency list already, and the map has to be the
      // live one the moment the key is pressed, not the one this closure was
      // built with.
      const e = remapEvent(raw, app.settings.hotkeys);
      if (!e) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        // Under the project manager eeschema's File menu starts at Save - New
        // and Open belong to the launcher (menubar.cpp) - so this key has no
        // row to answer from and stays here.
        e.preventDefault();
        promptOpen();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        // ACTIONS::redo. actions.cpp:292-302 binds Ctrl+Y off macOS and
        // Ctrl+Shift+Z on it, so THIS is the platform default and the key the
        // row now prints. The old comment had it exactly the wrong way round.
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === 'F3' && (findOpen || searchData.findString)) {
        // ACTIONS::findNext / findPrevious (F3 / Shift+F3).
        e.preventDefault();
        doFind(e.shiftKey ? -1 : 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u' && !e.shiftKey) {
        // ACTIONS::toggleUnits (Ctrl+U): imperial <-> metric, remembering the
        // last imperial unit (COMMON_TOOLS m_imperialUnit, initially inches).
        e.preventDefault();
        const imperial = toggles.has('unitsInches') || toggles.has('unitsMils');
        onLeftToggle(imperial ? 'unitsMm' : lastImperialRef.current);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
        // ACTIONS::cycleArcEditMode (Ctrl+Space): switch to a different method
        // of editing arcs. The point editor reads the same preference, so this
        // changes what dragging an arc's points does from the next drag on.
        e.preventDefault();
        app.settings.updateEeschema((s) => {
          s.drawing.arc_edit_mode = incrementArcEditMode(s.drawing.arc_edit_mode as ArcEditMode);
        });
      } else if (
        e.key === 'Insert' &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        repeatItemsRef.current.length > 0 &&
        doc
      ) {
        // SCH_ACTIONS::repeatDrawItem (Ins). sch_actions.cpp:757-759 binds F1
        // inside `#if defined( __WXMAC__ )` and WXK_INSERT in the `#else`, so
        // Ins is this platform's key and the only one bound. F1 used to be
        // accepted here too, which is what made F1 ambiguous: it repeated when
        // there was something to repeat and zoomed otherwise.
        //
        // The comment here used to say F1 "shares the key with
        // ACTIONS::zoomInCenter; upstream resolves that by tool scope". Neither
        // half held: `zoomInCenter` carries no hotkey at all (F1 belongs to
        // `ACTIONS::zoomIn`), and upstream has no collision on either platform
        // — macOS is repeat F1 / zoom Ctrl++, Linux is repeat Ins / zoom F1.
        // The clash was ours, made by taking one branch for one action and the
        // other branch for the other.
        e.preventDefault();
        const r = repeatItems(doc, repeatItemsRef.current, {
          offset: {
            x: mmToIU(es.drawing.default_repeat_offset_x * 0.0254),
            y: mmToIU(es.drawing.default_repeat_offset_y * 0.0254),
          },
          labelIncrement: es.drawing.repeat_label_increment,
        });
        if (r) {
          runCommand(r.command);
          // The copies become the selection, and the next F1 repeats from them.
          repeatItemsRef.current = r.ids;
          setSelection(new Set(r.ids));
          if (r.clampedAtZero) setError('Label value cannot go below zero');
        }
      } else if (e.key === 'F1' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        // ACTIONS::listHotKeys is AS_GLOBAL and HotkeyListHost binds Ctrl+F1
        // once, above every frame. The arm stays so the bare-F1 zoom below - a
        // *different* action that requires no modifiers - is still reached only
        // when Ctrl is absent; without it, Ctrl+F1 would fall through and zoom.
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && !e.shiftKey) {
        // SCH_ACTIONS::editWithLibEdit (Ctrl+E) on a single selected symbol.
        e.preventDefault();
        if (selection.size === 1) {
          const id = [...selection][0]!;
          editSymbolInEditor(/^(.*):field\d+$/.exec(id)?.[1] ?? id);
        }
      } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // SCH_ACTIONS::nextNetItem / previousNetItem (Tab / Shift+Tab):
        // SCH_SELECTION_TOOL::SelectNext walks the Net Navigator's flattened
        // tree, so it needs exactly one selected item to start from, and it
        // *wraps* — unlike Previous/Next Marker, which stops at the ends.
        if (doc && selection.size === 1) {
          // The same tree the pane shows, so Tab walks what you can see.
          const order = netNavigatorOrder(
            netNavigatorTree.length ? netNavigatorTree : buildNetNavigator(doc, libById, fmt),
          );
          const next = stepNetItem(order, [...selection][0]!, !e.shiftKey);
          if (next !== null) {
            e.preventDefault();
            setSelection(new Set([next]));
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
        // ACTIONS::toggleGridOverrides (Ctrl+Shift+G).
        e.preventDefault();
        onLeftToggle('toggleGridOverrides');
      } else if (e.altKey && fastGridActionForKey(e.key) !== null) {
        // ACTIONS::gridFast1 / gridFast2 / gridFastCycle, through the shared
        // `COMMON_TOOLS` implementation. This had its own copy that read the
        // two indices as 1-BASED — `min(max(v, 1), n) - 1` — where
        // `GridPreset` clamps `idx` into `[0, size-1]` untouched, so with the
        // stock settings Alt+1 selected 100 mil instead of 50 and Alt+2 50
        // instead of 25. See `fastGridIndex`.
        const action = fastGridActionForKey(e.key);
        e.preventDefault();
        app.settings.updateEeschema((st) => {
          const idx = fastGridIndex(st.window.grid, action as FastGridAction);
          if (idx !== null) st.window.grid.last_size_idx = idx;
        });
        // GridFast1/2/Cycle all reach `GridPreset( idx, true )`, so they post
        // GridChangedByKeyEvent too (common/tool/common_tools.cpp:569-592).
        gridFeedbackRef.current();
      } else if (e.altKey && e.key === '3') {
        // SCH_ACTIONS::selectNode (Alt+3): select the connection item under the
        // cursor. The pick is GetNode's, connectable types only at growing
        // thresholds, so a pin or a wire wins over the symbol body around it.
        e.preventDefault();
        if (doc && cursorRef.current) {
          // GetNode's widest threshold is max(HITTEST_THRESHOLD, grid size);
          // with no pointer scale to hand here the grid is the threshold.
          const grid = gridSizeToIU(
            app.settings.eeschema.window.grid.sizes[app.settings.eeschema.window.grid.last_size_idx]
              ?.x ?? '50 mil',
          );
          const node = getNode(doc, libById, cursorRef.current, grid);
          if (node) setSelection(new Set(promote(filterIds(new Set([node.id])))));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === '4') {
        // SCH_ACTIONS::selectConnection (Ctrl+4): widen the selection along the
        // connection, one stage per press (junction, then pin, then everything).
        e.preventDefault();
        expandSelectionAlongConnection();
      } else if (e.altKey && e.key.toLowerCase() === 's' && selection.size > 1) {
        // SCH_ACTIONS::swap (Alt+S): the selection's positions cycle round.
        e.preventDefault();
        if (doc) {
          const cmd = swapItems(doc, selection);
          if (cmd) runCommand(cmd);
        }
      } else if (e.altKey && e.key === 'Backspace') {
        // SCH_ACTIONS::leaveSheet (Alt+Backspace), same as Navigate Up.
        e.preventDefault();
        onTopAction('navUp');
      } else if (e.key === 'Escape') {
        // Abandoning a Sync Sheet Pins placement puts the rest of the queue
        // back and reopens the dialog, rather than leaving it half-placed with
        // nothing on screen to say so:
        //
        //     if( m_dialogSyncSheetPin && m_dialogSyncSheetPin->CanPlaceMore() )
        //     { m_dialogSyncSheetPin->EndPlacement(); m_dialogSyncSheetPin->Show( true ); }
        if (syncPlacementRef.current) endSyncPlacement();
        else if (pastePending) setPastePending(null);
        else if (pendingImage) {
          setPendingImage(null);
          setActiveTool('select');
        } else if (pendingLabel) {
          setPendingLabel(null);
          setActiveTool('select');
        } else if (placeLib || placeInstance) {
          // `PlaceSymbol`'s cancel is TWO states, not one
          // (sch_drawing_tools.cpp:324-344):
          //
          //     if( symbol ) { cleanup();
          //                    if( keepSymbol ) PostAction( cursorClick ); }
          //     else         { m_frame->PopTool( aEvent ); break; }
          //
          // The first Escape runs `cleanup()` — drop the symbol, clear the
          // selection — and LEAVES THE TOOL RUNNING; only a second one, with
          // nothing on the cursor, pops it. Ours collapsed both into a single
          // press, which put the tool away while KiCad keeps it armed for the
          // next symbol. Two presses to leave the tool is upstream's answer,
          // not a wrong count.
          setPlaceLib(null);
          // cleanup()'s own first line, ACTIONS::selectionClear.
          setSelection(new Set());
          // `if( keepSymbol ) PostAction( ACTIONS::cursorClick )` re-enters the
          // chooser straight away; without it the tool waits, and it is the
          // next click that reopens it (the click branch at :371-375).
          setChooserDismissed(!placeFlags.current.keepSymbol);
        } else {
          // Popping the tool and clearing the selection are NOT alternatives.
          // TWO tools see this one cancel event, because SCH_SELECTION_TOOL is
          // not "the tool you go back to" — it runs the whole time, alongside
          // whatever drawing tool is active:
          //
          //   PlaceSymbol, nothing on the cursor:
          //       m_frame->PopTool( aEvent ); break;      (:341-343)
          //     — pops the tool and never touches the selection.
          //   SCH_SELECTION_TOOL::Main, same event:
          //       if( !GetSelection().Empty() ) ClearSelection();
          //                                              (sch_selection_tool.cpp:1093-1096)
          //
          // So one Escape after a drop both puts the tool away AND unhighlights
          // the symbol you just placed. Ours had these as `else if` arms of one
          // chain, which made it take two presses to get back to a clean sheet.
          if (activeTool !== 'select') setActiveTool('select');

          // The selection tool's own arms, in its order: it clears the
          // selection, and only when there was nothing to clear does the
          // Escape fall through to the net highlight.
          if (selection.size > 0) setSelection(new Set());
          // "<ESC> clears net highlighting" (eeschema input.esc_clears_net_highlight).
          else if (app.settings.eeschema.input.esc_clears_net_highlight) clearHighlight();
        }
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // KiCad single-key tool hotkeys (A=symbol, W=wire, …). Skip while
        // typing, but a focused checkbox/radio isn't typing.
        const tgt = e.target as HTMLElement | null;
        const typing =
          !!tgt &&
          (tgt.tagName === 'TEXTAREA' ||
            tgt.tagName === 'SELECT' ||
            tgt.isContentEditable ||
            (tgt.tagName === 'INPUT' &&
              !/^(checkbox|radio|button|range)$/.test((tgt as HTMLInputElement).type)));
        if (typing) return;
        // R / Shift+R / X / Y, rotate & mirror the selection
        // (SCH_ACTIONS::rotateCCW/rotateCW/mirrorH/mirrorV default hotkeys).
        const txKey =
          e.key.toLowerCase() === 'r'
            ? e.shiftKey
              ? 'rotateCW'
              : 'rotateCCW'
            : e.key.toLowerCase() === 'x'
              ? 'mirrorH'
              : e.key.toLowerCase() === 'y'
                ? 'mirrorV'
                : null;
        if (txKey) {
          e.preventDefault();
          onTopAction(txKey);
          return;
        }
        // ` = Highlight Net tool, ~ = clear highlighting
        // (SCH_ACTIONS::highlightNet / clearHighlight).
        if (e.key === '`') {
          e.preventDefault();
          setActiveTool('highlightNet');
          return;
        }
        if (e.key === '~') {
          e.preventDefault();
          clearHighlight();
          return;
        }
        // Shift+Space, cycle the wire/bus line mode free → 90° → 45°
        // (SCH_ACTIONS::lineModeNext; SCH_EDITOR_CONTROL::NextLineMode).
        if (e.key === ' ' && e.shiftKey) {
          e.preventDefault();
          app.settings.updateEeschema((s) => {
            s.drawing.line_mode = s.drawing.line_mode === 0 ? 1 : s.drawing.line_mode === 1 ? 2 : 0;
          });
          return;
        }
        // N / Shift+N, next/previous grid (ACTIONS::gridNext/gridPrev).
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          app.settings.updateEeschema((s) => {
            const n = s.window.grid.sizes.length;
            if (n > 0)
              s.window.grid.last_size_idx =
                (s.window.grid.last_size_idx + (e.shiftKey ? n - 1 : 1)) % n;
          });
          // `OnGridChanged( true )` ends by posting GridChangedByKeyEvent.
          gridFeedbackRef.current();
          return;
        }
        // C = Unfold from Bus (SCH_ACTIONS::unfoldBus) on the bus under the
        // cursor. With one member it unfolds straight away; with several the
        // choice belongs in BUS_UNFOLD_MENU, which is the context menu.
        if (e.key.toLowerCase() === 'c' && doc && cursorRef.current) {
          const bi = busForUnfolding(doc, cursorRef.current, mmToIU(2));
          if (bi !== -1) {
            const members = busUnfoldMembers(doc, bi, busAliases);
            if (members.length === 1) {
              e.preventDefault();
              const out = unfoldBus(
                doc,
                bi,
                cursorRef.current,
                members[0]!,
                mmToIU(es.drawing.default_text_size * 0.0254),
              );
              if (out) {
                runCommand(out.command);
                setActiveTool('drawWire');
              }
              return;
            }
          }
        }
        // D = Show Datasheet (ACTIONS::showDatasheet), whose target is
        // `RequestSelection( { SCH_SYMBOL_T } )` and which clears a hover
        // selection afterwards (sch_editor_control.cpp:2845-2852).
        if (e.key.toLowerCase() === 'd' && doc) {
          const ids = requestTarget(SymbolItems);
          const id = ids.size === 1 ? [...ids][0]! : null;
          const sym =
            id === null
              ? undefined
              : doc.symbols.find((sy, i) => refId('symbol', sy.uuid, i) === id);
          if (sym) {
            e.preventDefault();
            const datasheet = sym.fields.find((f) => f.key === 'Datasheet')?.value ?? '';
            // "~" is KiCad's "no datasheet", not a URL (sch_inspection_tool.cpp:511).
            if (datasheet === '' || datasheet === '~') setError('No datasheet defined.');
            else GetAssociatedDocument(datasheet, null);
            finishCommand();
            return;
          }
        }
        // O = Autoplace Fields (SCH_ACTIONS::autoplaceFields). Its target is
        // `RequestSelection( RotatableItems )` (sch_edit_tool.cpp:2463) and it
        // clears a hover selection at :2502.
        if (e.key.toLowerCase() === 'o') {
          // `withSelection` inlined rather than called, because O has to fall
          // through to the menu accelerators when the request comes back empty
          // — and asking the seam twice, once to decide that and once inside,
          // would leave the outer scan types free to drift from the inner ones.
          const ids = requestTarget(RotatableItems);
          if (ids.size > 0) {
            e.preventDefault();
            const d = docRef.current;
            if (d) {
              const cmd = autoplaceFields(
                d,
                ids,
                libById,
                {
                  allowRejustify: es.autoplace_fields.allow_rejustify,
                  alignToGrid: es.autoplace_fields.align_to_grid,
                },
                drawableArea(d),
              );
              if (cmd) runCommand(cmd);
            }
            finishCommand();
            return;
          }
        }
        // A, P, W, B, Z, Q, J, L, H, S, T and I used to be dispatched here
        // out of TOOL_HOTKEYS, and every one of them is also a Place menu row
        // carrying the same key. The row is the declaration now; the map stays
        // because `ui/hotkeys_inventory.ts` reads it for the Hotkey List.
        if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
      }
      // --- global: every other menu accelerator ---------------------------
      // Reached only when no arm above claimed the key, which is
      // ACTION_MANAGER::RunHotKey's order: a context action first, the
      // AS_GLOBAL ones the menus render second.
      else if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    undo,
    redo,
    save,
    promptOpen,
    selection,
    onUpdatePcb,
    editSymbolInEditor,
    runCommand,
    activeTool,
    onToolSelect,
    onTopAction,
    onLeftToggle,
    libById,
    pendingLabel,
    pendingImage,
    placeLib,
    placeInstance,
    pastePending,
    duplicateSelection,
    findOpen,
    searchData,
    doFind,
    openFindDialog,
    toggles,
    endSyncPlacement,
    requestTarget,
    withSelection,
    finishCommand,
    app,
    remapEvent,
  ]);

  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (units === 'mm') return `${mm.toFixed(4)}`;
    if (units === 'mils') return `${(mm / 0.0254).toFixed(2)}`;
    return `${(mm / 25.4).toFixed(4)}`;
  };

  /**
   * FRAME_FOOTPRINT_CHOOSER, opened by the Footprint field's PG_FPID_EDITOR
   * button. `OnEvent`'s wxEVT_BUTTON branch shows it modally on the cell's
   * current text and, on OK, writes the picked fpid back through the property
   * (pg_editors.cpp:556-586) - so the commit callback is the CELL's, not a
   * separate edit path.
   */
  const [fpChooser, setFpChooser] = useState<{
    current: string;
    commit: (picked: string) => void;
    /** The symbol's `ki_fp_filters`, split — MAIL_SYMBOL_NETLIST's half. */
    fpFilters: readonly string[];
    /** Its pin count, the other half. */
    pinCount?: number;
    /** Closed without a pick. */
    cancel?: () => void;
  } | null>(null);

  // Message-panel rows (EDA_MSG_PANEL): what the frame's SetMsgPanel holds - the live tools'
  // SCH_INSPECTION_TOOL::UpdateMessagePanel fills it on every selection change, from the item's
  // GetMsgPanelInfo.
  const [msgPanelItems, setMsgPanelItems] = useState<MsgPanelItem[]>([]);
  useEffect(() => {
    const frame = schFrameRef.current!;
    frame.SetMsgPanelSink((aItems) => {
      const rows = aItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }));
      // The same rows again re-render nothing: UpdateMessagePanel runs on every selection event,
      // and a fresh array for an unchanged panel set off a render that raised another one.
      setMsgPanelItems((prev) =>
        prev.length === rows.length &&
        prev.every((r, i) => r.upper === rows[i]!.upper && r.lower === rows[i]!.lower)
          ? prev
          : rows,
      );
    });
    return () => frame.SetMsgPanelSink(null);
  }, []);

  /**
   * The frame title, `SCH_EDIT_FRAME::updateTitle`
   * (eeschema/sch_edit_frame.cpp:1819-1862), built by the shared rule rather
   * than restated here — see `frame_title.ts`.
   *
   * The document half is the CURRENT sheet's file, so descending into a
   * sub-sheet renames the title; the bracket is that sheet's
   * `PathHumanReadable( false, true )`, which is seeded with the ROOT file's
   * base name and is therefore suppressed on the root sheet.
   */
  const schTitle = useMemo(() => {
    const rootBase = sheetTree ? fileBaseName(sheetTree.file) : '';
    const here = sheetInstanceRefs.find((r) => r.path === currentPath)?.namePath ?? '/';
    const sheetNames = here.split('/').filter(Boolean);
    return schFrameTitle({
      fileName: doc ? currentFile : null,
      sheetPath: rootBase === '' ? '' : pathHumanReadable(rootBase, sheetNames),
      modified: dirty,
      readOnly,
    });
  }, [doc, currentFile, sheetTree, sheetInstanceRefs, currentPath, dirty, readOnly]);

  // The browser tab. Every other editor claims it; the schematic did not, so
  // whichever view rendered last kept the tab's name forever.
  useDocumentTitle('schematic', formatTitle(SCH_FRAME_NAME, schTitle.document, dirty));

  // A load failure before any document exists is fatal; once a document is open,
  // a bad Open just shows a dismissible banner and leaves the current sheet intact.
  if (!doc) {
    return error ? (
      <pre style={{ color: 'crimson', padding: 16 }}>Failed to load schematic: {error}</pre>
    ) : (
      <div className="ze-app sch-theme">
        <ProgressDialog title="Load Schematic" label={loading ?? 'Loading schematic...'} />
      </div>
    );
  }

  const _title =
    currentFile !== DEFAULT_FILE ? currentFile : (fileName ?? doc.titleBlock?.title ?? 'Root');

  // Hierarchy-navigation buttons grey out when there's nowhere to go, matching
  // KiCad's SCH_NAVIGATE_TOOL enable conditions (CanGoBack/Forward, CanGoUp):
  // on a flat/root schematic Navigate Up has no parent to enter, so it disables.
  const navDisabled = new Set<string>();
  if (!navTool.current.canGoBack()) navDisabled.add('navBack');
  if (!navTool.current.canGoForward()) navDisabled.add('navFwd');
  if (parentPath(currentPath) === null) navDisabled.add('navUp');
  // The toolbar's Group / Ungroup grey out when they can't act (GROUP_TOOL::
  // update): Group needs >= 2 selected items, Ungroup needs a group in the
  // selection. Add / Remove are right-click-only, gated in the context menu.
  if (selection.size < 2) navDisabled.add('group');
  if (!selectionHasGroup(doc, selection)) navDisabled.add('ungroup');

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length > 1) {
      // Several files at once = a project drop: load them all as one hierarchy.
      Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })))
        .then(loadProject)
        .catch((err) => setError(String(err)));
    } else if (files[0]) {
      openFile(files[0]);
    }
  };

  return (
    <div
      ref={appRef}
      className="ze-app sch-theme"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* HOTKEY_CYCLE_POPUP: a wxSTAY_ON_TOP window over the whole frame. */}
      {hotkeyPopup.node}
      {syncPeers.length > 0 && (
        <button
          type="button"
          className="ze-presence-badge"
          title={syncPeers.map((p) => `${p.view} · ${p.sheetPath ?? '/'}`).join('\n')}
          onClick={() => setPresencePanelOpen((v) => !v)}
        >
          {syncPeers.length === 1 ? '1 other viewer' : `${syncPeers.length} other viewers`}
        </button>
      )}
      {presencePanelOpen && (
        <PresencePanel
          me={{
            peerId: syncTransport.current?.peerId ?? '',
            role: myRole,
            displayName: myDisplayName,
          }}
          peers={syncPeers}
          onSetRole={(peerId, role) =>
            syncTransport.current?.publish({ kind: 'role-assign', toPeerId: peerId, role })
          }
          onClose={() => setPresencePanelOpen(false)}
        />
      )}
      {copyAsOpen && (
        <SaveAsDialog
          title="Save Current Sheet Copy As"
          // `wxFileDialog( m_frame, _( "Schematic Files" ), curr_fn.GetPath(),
          //                curr_fn.GetFullName(), ... )`
          // (sch_editor_control.cpp, SaveCurrSheetCopyAs). Both arguments come
          // off the sheet's OWN file: it opens in the folder that file already
          // sits in, and suggests that file's own name UNCHANGED - upstream
          // appends no "_copy", the word is in the command's FriendlyName
          // (sch_actions.cpp:1623) and nowhere else.
          //
          // Ours passed a name and no directory, so it opened at the account
          // root listing every project.
          initialName={basename(copyAsSeed)}
          {...(projectName ? { projectDir: `/${projectName}` } : {})}
          {...(projectName ? { initialPath: sheetDirOf(projectName, copyAsSeed) } : {})}
          filters={[kicadSchematicWildcard()]}
          onDone={(path) => {
            setCopyAsOpen(false);
            if (path === null) return; // wxID_CANCEL
            saveCurrSheetCopyTo(path);
          }}
        />
      )}

      {openDlgOpen && (
        <OpenFileDialog
          filters={[kicadSchematicWildcard()]}
          onDone={(file) => {
            setOpenDlgOpen(false);
            if (!file) return; // wxID_CANCEL
            const leaf = file.path.split('/').filter(Boolean).pop() ?? file.path;
            void loadText(file.text, leaf);
          }}
        />
      )}
      {/* `Import Schematic Sheet Content` over the account's tree. It was a
          hidden `<input type="file">`, i.e. the operating system's picker,
          which cannot see the account at all. A schematic is a project
          document, so there is no shared folder for it - `kind` is omitted and
          every project is listed. */}
      {importSheetOpen && (
        <OpenFileDialog
          title="Import Schematic Sheet Content"
          accept="Import"
          filters={[kicadSchematicWildcard()]}
          onDone={(file) => {
            setImportSheetOpen(false);
            if (!file) return; // wxID_CANCEL
            setDoc((d) => {
              // 'unique' is upstream's default: `keep_annotations` off, so the
              // imported symbols are re-annotated rather than arriving with the
              // source sheet's references and colliding with this one's.
              const payload = d ? parsePastedText(file.text, d, pasteOptions('unique')) : null;
              if (payload) {
                setActiveTool('select');
                setPastePending(payload);
              } else {
                setInfoBar('No schematic items found in that file.');
              }
              return d;
            });
          }}
        />
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImageFile(f);
          e.target.value = '';
        }}
      />
      {error && (
        <div className="ze-error-banner" onClick={() => setError(null)} title="Dismiss">
          {error}, click to dismiss
        </div>
      )}
      <MenuBar
        menus={menus}
        leftSlot={<HomeLink onClick={onExitToHome} />}
        title={
          <>
            <b>
              {schTitle.modified}
              {schTitle.document}
            </b>
            {schTitle.separator}
            {schTitle.frameName}
          </>
        }
      />

      <Toolbar
        entries={schTopBar}
        app="eeschema"
        orientation="horizontal"
        disabledIds={withSaveEnablement(navDisabled, dirty)}
        // Almost everything up here is a plain action, but the zoom tool is not:
        // it is an AF_ACTIVATE tool that keeps running, and its button stays
        // checked for as long as it does.
        //
        //     mgr->SetConditions( ACTIONS::zoomTool, CHECK( cond.CurrentTool( ACTIONS::zoomTool ) ) );
        //
        // Passing the current tool is enough to get that: no other id on this
        // toolbar is a tool id, so `zoomTool` is the only one that can match.
        activeTool={activeTool}
        onActivate={onTopAction}
      />

      <div className="ze-body">
        {(() => {
          // Which panes are on screen. The ORDER they are drawn in is not a
          // table: it is `schLeftDockLayout`, one wxAUI Update, run below.
          const growShown = {
            netNavigator: toggles.has('showNetNavigator') && !!doc,
            hierarchy: toggles.has('showHierarchy'),
            properties: toggles.has('showProperties'),
          };
          const paneShown: Record<SchLeftPane, boolean> = {
            ...growShown,
            // Not a toggle of its own: `updateSelectionFilterVisbility` ORs the
            // other three panes. See `schSelectionFilterShown`.
            // `updateSelectionFilterVisbility` ORs the other three and writes
            // the answer every time it runs, so a close only holds until the
            // next recompute — which is exactly what the latch below does.
            selectionFilter: schSelectionFilterShown(growShown) && !selectionFilterClosed,
          };
          // One `wxAuiManager::Update()`: sort the shown panes by `dock_pos`,
          // draw them in that order, and renumber them for the next time. The
          // pane opened FIRST holds the top of the column, which is what
          // upstream does and what a fixed order table could not express.
          //
          // Writing the ref here is safe because the pass is idempotent: a
          // second render with the same panes shown produces the same order
          // and the same numbers.
          const dockLayout = schLeftDockLayout(dockPosRef.current, paneShown);
          dockPosRef.current = dockLayout.dockPos;
          dockPosSaveRef.current = dockLayout.dockPos;
          // Adjacent visible grow panes get a drag sash between them, top pane
          // resizes (KiCad's wxAUI sash chain); Selection Filter (prop=0 in
          // KiCad's perspective) never grows, so it's never in this list.
          // Search is not here either — it is the BOTTOM dock, below the
          // canvas, and its sash is its own (`SCH_BOTTOM_DOCK`).
          const visibleGrowKeys: string[] = dockLayout.order.filter(schPaneGrows);
          const sashAfter = (key: string): JSX.Element | null =>
            visibleGrowKeys.indexOf(key) < visibleGrowKeys.length - 1 ? (
              <div
                className="ze-splitter horizontal"
                onMouseDown={(e) => startPanelResize(key, e)}
                title="Drag to resize"
              />
            ) : null;
          const heightStyle = (key: string): React.CSSProperties | undefined =>
            panelHeights[key] != null ? { flex: `0 0 ${panelHeights[key]}px` } : undefined;
          return (
            // Search is no longer a term: it does not live in this column.
            (paneShown.properties || paneShown.hierarchy || paneShown.netNavigator) && (
              <>
                <div
                  className="ze-leftdock sch-leftdock"
                  // The pane WINDOW is `leftDockWidth` wide; wxAUI's 1px pane
                  // border sits outside it on both sides ([px] the tree's own
                  // frame runs x=67..366 with #292929 at 66 and 367), so the
                  // column is the window plus two borders.
                  style={{ width: `calc(${leftDockWidth}px + 2 * var(--aui-pane-border-size))` }}
                >
                  {/* The docked panes, in the order the wxAUI Update above
                      sorted them into — see `panes.ts`. Only the ORDER is
                      data; each pane's contents stay inline. */}
                  {dockLayout.order.map((paneKey) => (
                    <Fragment key={paneKey}>
                      {paneKey === 'netNavigator' && paneShown.netNavigator && (
                        <>
                          <div className="ze-panel grow" style={heightStyle('netNavigator')}>
                            <div className="ze-panel-header">
                              <span>Net Navigator</span>
                              {/* `.CloseButton( true )` on every one of these
                                  palettes. Closing a pane is the same state the
                                  View > Panels check item drives, which is why it
                                  goes through the same toggle. */}
                              <button
                                type="button"
                                className="ze-pane-close"
                                onClick={() => onLeftToggle('showNetNavigator')}
                                title="Close"
                              >
                                ⊠
                              </button>
                            </div>
                            <div className="ze-panel-body">
                              <NetNavigatorPanel
                                doc={doc}
                                libById={libById}
                                fmt={fmt}
                                selectedId={selection.size === 1 ? [...selection][0] : undefined}
                                highlightedNet={highlightName}
                                prebuilt={netNavigatorTree}
                                onSelect={(id) => {
                                  // onNetNavigatorSelection ends in
                                  // `FocusOnLocation( item->GetBoundingBox().Centre() )`, so
                                  // picking a leaf brings the item under the crosshair even
                                  // though the pointer is still in the panel.
                                  setSelection(new Set([id]));
                                  const box = doc
                                    ? selectionBBox(doc, new Set([id]), libById)
                                    : emptyBBox();
                                  if (!isEmpty(box))
                                    schFrameRef.current!.FocusOnLocation({
                                      x: (box.minX + box.maxX) / 2,
                                      y: (box.minY + box.maxY) / 2,
                                    });
                                }}
                              />
                            </div>
                          </div>
                          {sashAfter('netNavigator')}
                        </>
                      )}
                      {paneKey === 'hierarchy' && paneShown.hierarchy && (
                        <>
                          <div className="ze-panel grow" style={heightStyle('hierarchy')}>
                            <div className="ze-panel-header">
                              <span>Schematic Hierarchy</span>
                              {/* `.CloseButton( true )` on every one of these
                                  palettes. Closing a pane is the same state the
                                  View > Panels check item drives, which is why it
                                  goes through the same toggle. */}
                              <button
                                type="button"
                                className="ze-pane-close"
                                onClick={() => onLeftToggle('showHierarchy')}
                                title="Close"
                              >
                                ⊠
                              </button>
                            </div>
                            {/* HIERARCHY_TREE fills the pane: `sizer->Add( m_tree,
                                1, wxEXPAND, wxBORDER_NONE )` (hierarchy_pane.cpp:57)
                                — no inset, so the control's own frame is the
                                pane's edge. */}
                            <div className="ze-panel-body ze-hiertree">
                              {sheetTree &&
                                renderSheetNode(
                                  sheetTree,
                                  0,
                                  currentPath,
                                  switchSheet,
                                  collapsedSheets,
                                  setCollapsedSheets,
                                )}
                            </div>
                          </div>
                          {sashAfter('hierarchy')}
                        </>
                      )}
                      {paneKey === 'properties' && paneShown.properties && (
                        <>
                          <div className="ze-panel grow" style={heightStyle('properties')}>
                            <div className="ze-panel-header">
                              <span>Properties</span>
                              {/* `.CloseButton( true )` on every one of these
                                  palettes. Closing a pane is the same state the
                                  View > Panels check item drives, which is why it
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
                              {/* The empty and multi-selection captions are
                                  PROPERTIES_PANEL's own (properties_panel.cpp:
                                  196-210), so the panel renders them rather
                                  than the frame swapping in a placeholder. */}
                              {/* SCH_PROPERTIES_PANEL on the live model. */}
                              <LiveSchPropertiesPanel frame={schFrameRef.current!} units={units} />
                            </div>
                          </div>
                          {sashAfter('properties')}
                        </>
                      )}
                      {/* `PANEL_SCH_SELECTION_FILTER`, the same widget the Symbol
                          Editor builds (`widgets/panel_sch_selection_filter_ui.tsx`). What was
                          here was a private copy that (a) rendered a visible
                          "Locked items" row — `m_cbLockedItems->Hide()`,
                          `panel_sch_selection_filter_base.cpp:28`, hides it in
                          BOTH frames — and (b) put "All items" on a row of its
                          own above the grid, which shifted every pair one cell
                          left of upstream's `wxGBPosition`s. */}
                      {paneKey === 'selectionFilter' && paneShown.selectionFilter && (
                        <SelectionFilterPanel
                          frame="FRAME_SCH"
                          filter={selFilter}
                          onChange={setSelFilter}
                          onClose={() => setSelectionFilterClosed(true)}
                        />
                      )}
                    </Fragment>
                  ))}
                </div>
                {/* wxAUI's sash: a sibling of the dock, 5px of sash colour
                    between the pane border and the left toolbar — the same
                    `<DockSash>` pcbnew's Properties dock carries, and for the
                    same reason: it is the sash, not a rule, that separates a
                    dock from the toolbar beside it. The clamps are the
                    Properties pane's MinSize (240) and the width past which
                    the canvas suffers. */}
                <DockSash
                  edge="right"
                  width={leftDockWidth}
                  min={240}
                  max={800}
                  onResize={setLeftDockWidth}
                />
              </>
            )
          );
        })()}

        <Toolbar
          entries={schLeftBar}
          app="eeschema"
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        {/* The centre pane and the docks of LAYER 0 around it. Only the Search
            pane is in that layer here, `.Bottom()` with no `.Layer()` call
            (sch_edit_frame.cpp:290-292), and wxAUI nests docks outward by
            layer — so it is as wide as the canvas, with the left dock (layer 3)
            and both toolbars (layer 2) running full height past it and the
            message panel (layer 6) below the lot. See `SCH_BOTTOM_DOCK`. */}
        <div className="ze-canvas-col">
          {/* `CreateInfoBar()` puts WX_INFOBAR in its own AUI pane ABOVE the canvas. These strips
              were the wrap's children, and the wrap's <canvas> is `position: absolute; inset: 0`,
              so the GL canvas painted over them the moment the sheet drew - the demo banner
              vanished as the schematic appeared. In the column they take their own height and
              the wrap, flex: 1, gets the rest. */}
          {readOnlyNotice}
          {myRole === 'viewer' && (
            <ReadOnlyNotice message="You have view-only access to this project. Ask the owner for edit access to make changes." />
          )}
          {/* WX_INFOBAR: the strip a tool posts an error into, dismissed with
            its ✕ or by the next successful action. */}
          {infoBar && (
            <div className="ze-infobar">
              {infoBar}
              <span
                className="x"
                title="Close"
                onClick={() => setInfoBar(null)}
                style={{ marginLeft: 'auto', cursor: 'default' }}
              >
                ✕
              </span>
            </div>
          )}
          <div className="ze-canvas-wrap">
            <canvas
              ref={glCanvasRef}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes the keys, as the wxGLCanvas does
              tabIndex={0}
              style={{
                position: 'absolute',
                inset: 0,
                outline: 'none',
                width: '100%',
                height: '100%',
              }}
            />
            {toolPopup && (
              <ContextMenu
                x={toolPopup.x}
                y={toolPopup.y}
                items={actionMenuItems(toolPopup.menu)}
                onClose={() => {
                  const close = toolPopup.onClose;
                  setToolPopup(null);
                  // wx runs the chosen row while PopupMenu is still open and returns after, so
                  // the close half runs once the row's handler has.
                  queueMicrotask(close);
                }}
              />
            )}
            {clarify && doc && (
              <ContextMenu
                x={clarify.x}
                y={clarify.y}
                items={clarify.items.map((ref) => ({
                  label: describeItem(doc, libById, ref),
                  action: () => {
                    onSelect(ref.id, clarify.additive);
                    setClarify(null);
                  },
                }))}
                onClose={() => setClarify(null)}
              />
            )}
            {backAnnotateFps && doc && (
              <DialogUpdateFromPcb
                doc={doc}
                footprints={backAnnotateFps}
                onApply={runCommand}
                onClose={() => setBackAnnotateFps(null)}
              />
            )}
            {/* Hidden, not closed, while a placement queue is running: upstream
              calls Hide() and Show(true) around the placement tool. */}
            {syncPinsOpen && !syncPlacement && syncParent && (
              <DialogSyncSheetPins
                parent={syncParent}
                parentFile={syncParentFile.current}
                initialPage={syncPage.current}
                sheets={syncPinsOpen}
                // Each direction writes a different file, which is why they
                // go through the per-sheet applier rather than plain
                // runCommand — and through `sheetBatch`, so the entry lands on
                // the stack Ctrl+Z reaches from here rather than on the stack
                // of a sheet the user is not looking at.
                onUsePinTemplate={(entry, pin, label) => {
                  const cmd = syncPinFromLabel(
                    doc,
                    { sheet: entry.sheetIndex, pin: pin.index },
                    label,
                  );
                  if (!cmd) return;
                  sheetBatch('Sync Sheet Pins', () =>
                    applySheetCommand(syncParentFile.current, cmd),
                  );
                }}
                onUseLabelTemplate={(entry, label, pin) => {
                  sheetBatch('Sync Sheet Pins', () =>
                    applySheetCommand(entry.file, syncLabelsFromPin(label, pin)),
                  );
                  // The dialog reads the sub-sheet it was handed, so refresh it.
                  // Safe to read `project.current.docs` here even though the
                  // edit is folded in a `setDoc` updater: `doc`'s hook is
                  // declared above this one, so its queue is drained first.
                  setSyncPinsOpen((prev) =>
                    prev
                      ? prev.map((e) =>
                          e.file === entry.file
                            ? { ...e, sub: project.current.docs.get(e.file) ?? e.sub }
                            : e,
                        )
                      : prev,
                  );
                }}
                // `OnBtnAddSheetPinsClicked` → `PlaceSheetPin`: the panel goes
                // away, the sheet symbol is selected and the pin tool runs with
                // the chosen labels queued. One click places one pin.
                onAddSheetPins={(entry, tmpl) => {
                  const p = syncPlacementFor(
                    'sheetPin',
                    entry.sheetIndex,
                    syncParentFile.current,
                    tmpl,
                  );
                  if (!p) return;
                  setSyncPlacement(p);
                  // `SyncSelection( {}, nullptr, { sheet } )` — so the tool acts
                  // on the sheet the page belongs to.
                  const sh = doc.sheets[entry.sheetIndex];
                  if (sh) setSelection(new Set([refId('sheet', sh.uuid, entry.sheetIndex)]));
                  setActiveTool('sheetPin');
                  setInfoBar(
                    `Click the sheet border to place '${tmpl[0]!.text}'` +
                      (tmpl.length > 1 ? ` (${tmpl.length} to place).` : '.'),
                  );
                }}
                // `OnBtnAddLabelsClicked` → `PlaceHieraLable`: the label belongs
                // to the sub-sheet's own document, so this changes sheet first
                // (`RunAction( SCH_ACTIONS::changeSheet, &aPath )`) and comes back
                // when the queue runs out.
                onAddHierLabels={(entry, tmpl) => {
                  const p = syncPlacementFor('hierLabel', entry.sheetIndex, entry.file, tmpl);
                  if (!p) return;
                  const target = flatSheets.find((f) => f.file === entry.file);
                  if (!target) {
                    setInfoBar(`Sheet file not in project: ${entry.file}`);
                    return;
                  }
                  syncReturn.current = { path: currentPath, file: currentFile };
                  switchSheet(target.path, target.file);
                  setSyncPlacement(p);
                  setActiveTool('placeHierLabel');
                  setPendingLabel({
                    kind: 'hierarchical_label',
                    text: tmpl[0]!.text,
                    shape: tmpl[0]!.shape,
                    fontSize: setup.formatting.defaultTextSizeMils * IU_PER_MILS,
                    angle: SPIN_ANGLE[lastLabel.current.spin],
                    autoRotate: lastLabel.current.autoRotate,
                    fields: [],
                  });
                  setInfoBar(
                    `Click to place '${tmpl[0]!.text}' in ${entry.file}` +
                      (tmpl.length > 1 ? ` (${tmpl.length} to place).` : '.'),
                  );
                }}
                // The two delete buttons (`OnBtnRmPinsClicked` /
                // `OnBtnRmLabelsClicked`), each writing its own half's file.
                onDeletePins={(entry, indices) => {
                  sheetBatch('Sync Sheet Pins', () =>
                    applySheetCommand(
                      syncParentFile.current,
                      deleteSyncPins(entry.sheetIndex, indices),
                    ),
                  );
                }}
                onDeleteLabels={(entry, texts) => {
                  sheetBatch('Sync Sheet Pins', () =>
                    applySheetCommand(entry.file, deleteSyncLabels(texts)),
                  );
                  setSyncPinsOpen((prev) =>
                    prev
                      ? prev.map((e) =>
                          e.file === entry.file
                            ? { ...e, sub: project.current.docs.get(e.file) ?? e.sub }
                            : e,
                        )
                      : prev,
                  );
                }}
                onClose={() => setSyncPinsOpen(null)}
              />
            )}
            {symLibTableOpen && (
              <DialogSymLibTable
                projectFiles={rawFiles}
                globalLibraries={hostedSymbolLibs}
                globalBase={symbolsBase()}
                onSave={(rows) => {
                  saveProjectSymLibTable(rows);
                  setSymLibTableOpen(false);
                }}
                onClose={() => setSymLibTableOpen(false)}
              />
            )}
            {rescueCandidates && (
              <DialogRescueEach
                candidates={rescueCandidates}
                instancesOf={rescueInstances}
                // `aAskShowAgain = !aRunningOnDemand`, and ours is always on
                // demand: the automatic caller lives in the legacy `.sch`
                // branch of the loader, which we never take.
                // `aAskShowAgain = !aRunningOnDemand`: the button is offered
                // only by the prompt the user did not ask for.
                askShowAgain={!rescueOnDemand}
                inputPrefs={inputPrefs}
                onOk={applyRescues}
                onCancel={() => {
                  // `OnCancelClick` clears the chosen candidates, and
                  // `RescueProject` then reports that nothing was rescued.
                  setRescueCandidates(null);
                  setRescueMessage('No symbols were rescued.');
                }}
                onNeverShowAgain={() => {
                  setRescueCandidates(null);
                  app.settings.updateEeschema((st) => {
                    st.system.never_show_rescue_dialog = true;
                  });
                }}
              />
            )}
            {rescueMessage && (
              <MessageDialogOk
                caption="Project Rescue Helper"
                message={rescueMessage}
                onClose={() => setRescueMessage(null)}
              />
            )}
            {loadRepairedMessage && (
              <MessageDialogOk
                caption={INFO_CAPTION}
                message={loadRepairedMessage}
                onClose={() => setLoadRepairedMessage(null)}
              />
            )}
            {ercOpen && (
              <ErcDialog
                navRef={ercNav}
                sourceName={currentFile}
                violations={ercResult}
                running={ercRunning}
                ignoredTests={ERC_ITEMS.filter(
                  (it) => setup.erc.severities[it.code] === 'ignore',
                ).map((it) => it.title)}
                unannotated={doc?.symbols.some((s) =>
                  (s.fields.find((f) => f.key === 'Reference')?.value ?? '').endsWith('?'),
                )}
                options={{
                  crossprobe: es.erc_dialog.crossprobe,
                  scrollOnCrossprobe: es.erc_dialog.scroll_on_crossprobe,
                  showAllErrors: es.erc_dialog.show_all_errors,
                }}
                onOptionsChange={(o) =>
                  app.settings.updateEeschema((s) => {
                    s.erc_dialog.crossprobe = o.crossprobe;
                    s.erc_dialog.scroll_on_crossprobe = o.scrollOnCrossprobe;
                    s.erc_dialog.show_all_errors = o.showAllErrors;
                  })
                }
                onShowAnnotate={() => setAnnotateOpen(true)}
                onRun={() => void runErcNow()}
                onLocate={locateViolation}
                describeItem={describeErcItem}
                onSetSeverity={(code, level) => {
                  // OnERCItemRClick's severity commands: change the rule for
                  // every violation of its type, then re-run so the list matches.
                  const next = {
                    ...setup,
                    erc: {
                      ...setup.erc,
                      severities: { ...setup.erc.severities, [code]: level },
                    },
                  };
                  commitSetup(next);
                  setErcResult(runErcWith(next));
                }}
                onEditPinMap={() => setSetupOpen(true)}
                onEditConnectionGrid={() => setSetupOpen(true)}
                onDelete={(i) => setErcResult((r) => (r ? r.filter((_, idx) => idx !== i) : r))}
                onDeleteAll={() => {
                  setErcResult([]);
                }}
                excluded={new Set(setup.ercExclusions)}
                exclusionComments={new Map(Object.entries(setup.ercExclusionComments))}
                onCancelRun={() => {
                  ercCancelled.current = true;
                }}
                onToggleExclude={(v, comment) => {
                  const key = ercExclusionKey(v);
                  setSetup((cur) => {
                    const has = cur.ercExclusions.includes(key);
                    // A comment edit keeps the exclusion and only rewrites the note
                    // (MARKER_BASE::SetComment); otherwise this toggles it.
                    const keepExcluded = comment !== undefined ? true : !has;
                    const comments = { ...cur.ercExclusionComments };
                    if (!keepExcluded) delete comments[key];
                    else if (comment !== undefined) comments[key] = comment;
                    return {
                      ...cur,
                      ercExclusions: keepExcluded
                        ? has
                          ? cur.ercExclusions
                          : [...cur.ercExclusions, key]
                        : cur.ercExclusions.filter((k) => k !== key),
                      ercExclusionComments: comments,
                    };
                  });
                }}
                onEditSeverities={() => setSetupOpen(true)}
                onClose={() => {
                  setErcOpen(false);
                }}
              />
            )}
            {findOpen && (
              <DialogSchFind
                // `SCH_BASE_FRAME::ShowFindReplaceDialog` builds the same
                // DIALOG_SCH_FIND in both frames; the dialog branches on the
                // frame type itself, so this is the whole of the difference.
                frame="FRAME_SCH"
                data={searchData}
                onChange={setSearchData}
                onFindNext={() => doFind(1)}
                onFindPrevious={() => doFind(-1)}
                onClose={() => setFindOpen(false)}
                status={findStatus}
                replace={findOpen === 'replace'}
                onReplace={doReplaceNext}
                onReplaceAll={doReplaceAll}
                // onShowSearchPanel runs ACTIONS::showSearch, which is a *toggle*
                // upstream — so clicking a link labelled "Show search panel" with
                // the panel already open closes it. We show it instead; the panel
                // is the point of the link, and the divergence is one keystroke
                // away from being undone either way.
                onShowSearchPanel={() => {
                  setLocalToggles((prev) => new Set(prev).add('showSearch'));
                }}
              />
            )}
            {annotateOpen && (
              <DialogAnnotate
                settings={app.settings}
                hasSelection={selection.size > 0}
                // Sort order, numbering method and start number are project
                // settings (SCHEMATIC_SETTINGS), seed from Schematic Setup >
                // Annotation like DIALOG_ANNOTATE::TransferDataToWindow.
                initial={{
                  order: setup.annotation.sortOrder,
                  algo:
                    setup.annotation.numbering === 'sheetX100'
                      ? 'sheet_100'
                      : setup.annotation.numbering === 'sheetX1000'
                        ? 'sheet_1000'
                        : 'incremental',
                  startNumber: setup.annotation.firstFreeAfter,
                }}
                messages={annotateMessages}
                onAnnotate={runAnnotate}
                onClear={runClearAnnotation}
                onClose={(s) => {
                  // ~DIALOG_ANNOTATE: write changed settings back to the project.
                  const numbering =
                    s.algo === 'sheet_100'
                      ? 'sheetX100'
                      : s.algo === 'sheet_1000'
                        ? 'sheetX1000'
                        : 'firstFree';
                  if (
                    s.order !== setup.annotation.sortOrder ||
                    numbering !== setup.annotation.numbering ||
                    s.startNumber !== setup.annotation.firstFreeAfter
                  ) {
                    commitSetup({
                      ...setup,
                      annotation: {
                        ...setup.annotation,
                        sortOrder: s.order,
                        numbering,
                        firstFreeAfter: s.startNumber,
                      },
                    });
                  }
                  // OnClose destroys the dialog, so its messages go with it.
                  setAnnotateMessages([]);
                  setAnnotateOpen(false);
                }}
              />
            )}
            {libIdsOpen && doc && (
              <DialogEditSymbolsLibId
                rows={symbolLibIdRows(doc, libById)}
                candidatesFor={(id) => orphanCandidates(id, libById)}
                errors={libIdErrors}
                onApply={runLibIdChanges}
                onClose={() => setLibIdsOpen(false)}
              />
            )}
            {changeSymbolsDialog && (
              <DialogChangeSymbols
                dlg={changeSymbolsDialog.dlg}
                onClose={() => {
                  setChangeSymbolsDialog(null);
                  changeSymbolsDialog.resolve(wxID_CANCEL);
                }}
              />
            )}
            {symbolChooser && (
              <SymbolChooserFrame
                preselect={symbolChooser.preselect}
                historyList={sSymbolHistoryList}
                onOk={(libId) => {
                  setSymbolChooser(null);
                  symbolChooser.resolve(libId);
                }}
                onCancel={() => {
                  setSymbolChooser(null);
                  symbolChooser.resolve(null);
                }}
              />
            )}
            {globalEditOpen && (
              <DialogGlobalEditTextAndGraphics
                hasSelection={selection.size > 0}
                onOk={(r) => {
                  setGlobalEditOpen(false);
                  runGlobalEdit(r);
                }}
                onCancel={() => setGlobalEditOpen(false)}
              />
            )}
            {incrementAnnotationsOpen && (
              <DialogIncrementAnnotations
                onOk={(r) => {
                  setIncrementAnnotationsOpen(false);
                  runIncrementAnnotations(r);
                }}
                onCancel={() => setIncrementAnnotationsOpen(false)}
              />
            )}
            {pageSettingsOpen && doc && (
              // DIALOG_EESCHEMA_PAGE_SETTINGS, not DIALOG_PAGES_SETTINGS: the
              // base class hides the sheet tallies and all fourteen "Export to
              // other sheets" boxes (dialog_page_settings.cpp:169-185) and this
              // subclass is the only thing that shows them
              // (dialog_eeschema_page_settings.cpp:87-102). pcbnew and
              // pl_editor open the base class and get neither.
              <DialogEeschemaPageSettings
                // `m_customSizeX( aParent, … )` — a UNIT_BINDER over the FRAME
                // (dialog_page_settings.cpp:65-66), so the two custom-size
                // fields read in the schematic frame's own unit. A fresh
                // eeschema is in MILS (app_settings.cpp:228-238), which is why
                // real eeschema shows mils where ours said "mm".
                units={units}
                value={pageSettingsSeed(doc)}
                sheetCount={flatSheets.length}
                sheetNumber={Number(pageNumberOf(currentPath)) || 1}
                wksFileName={sheetRefName}
                sheet={activeSheet}
                projectDir={projectName ? `/${projectName}` : null}
                stored={{
                  paper: es.page_settings.export_paper,
                  date: es.page_settings.export_date,
                  rev: es.page_settings.export_revision,
                  title: es.page_settings.export_title,
                  company: es.page_settings.export_company,
                  comments: es.page_settings.export_comments,
                }}
                onStoreExports={(next) =>
                  app.settings.updateEeschema((cfg) => {
                    cfg.page_settings.export_paper = next.paper;
                    cfg.page_settings.export_revision = next.rev;
                    cfg.page_settings.export_date = next.date;
                    cfg.page_settings.export_title = next.title;
                    cfg.page_settings.export_company = next.company;
                    cfg.page_settings.export_comments = [...next.comments];
                  })
                }
                onOk={(next, exports, drawingSheet, drawingSheetName) =>
                  applyPageSettings(
                    {
                      paper: toPaperToken(next),
                      title: next.title,
                      date: next.date,
                      rev: next.rev,
                      company: next.company,
                      comments: next.comments,
                    },
                    exports,
                    drawingSheet,
                    drawingSheetName,
                  )
                }
                onCancel={() => setPageSettingsOpen(false)}
              />
            )}
            {printOpen && (
              <DialogPrint
                settings={app.settings}
                onPrint={doPrint}
                themeId={es.appearance.color_theme}
                onClose={() => setPrintOpen(false)}
              />
            )}
            {pasteSpecialOpen && (
              <DialogPasteSpecial
                /* `PASTE_MODE pasteMode = annotateAutomatic ?
                   UNIQUE_ANNOTATIONS : REMOVE_ANNOTATIONS`
                   (sch_editor_control.cpp:2203) — the schematic never opens on
                   "keep". */
                mode={es.annotation.automatic ? 'UNIQUE_ANNOTATIONS' : 'REMOVE_ANNOTATIONS'}
                /* `SCH_EDITOR_CONTROL::Paste` never calls `HideClearNets()`, so
                   the box is shown here as well — it just never reads it. */
                onOk={(chosen: PasteSpecialMode) => {
                  const mode: PasteMode =
                    chosen === 'UNIQUE_ANNOTATIONS'
                      ? 'unique'
                      : chosen === 'KEEP_ANNOTATIONS'
                        ? 'keep'
                        : 'remove';
                  setPasteSpecialOpen(false);
                  void navigator.clipboard?.readText().then((text) => {
                    setDoc((d) => {
                      const payload = d ? parsePastedText(text, d, pasteOptions(mode)) : null;
                      if (payload) {
                        setActiveTool('select');
                        setPastePending(payload);
                      }
                      return d;
                    });
                  });
                }}
                onCancel={() => setPasteSpecialOpen(false)}
              />
            )}
            {plotOpen && (
              <DialogPlot
                settings={app.settings}
                themeId={es.appearance.color_theme}
                projectFolders={projectFolders}
                onPlot={doPlot}
                onClose={() => setPlotOpen(false)}
              />
            )}
            {setupOpen && (
              <DialogSchematicSetup
                value={setup}
                onOk={(next) => {
                  commitSetup(next);
                  // The Embedded Files page edits the document itself
                  // (EMBEDDED_FILES lives in .kicad_sch, not the project file):
                  // compress added files, drop removed ones, set the fonts flag.
                  if (doc) {
                    const cur = listEmbeddedFiles(doc);
                    const keep = new Set(next.embeddedFiles.files.map((f) => f.name));
                    const removed = cur.files.filter((f) => !keep.has(f.name)).map((f) => f.name);
                    const added = next.embeddedFiles.files.filter((f) => f.pendingBytes);
                    const fontsChanged = next.embeddedFiles.embedFonts !== cur.embedFonts;
                    if (removed.length || added.length || fontsChanged) {
                      const base = doc;
                      void (async () => {
                        let after = base;
                        for (const name of removed) after = removeEmbeddedFile(after, name);
                        for (const f of added)
                          after = await addEmbeddedFile(after, f.name, f.pendingBytes!);
                        if (fontsChanged)
                          after = setEmbedFonts(after, next.embeddedFiles.embedFonts);
                        runCommand(embeddedFilesCommand(after));
                      })();
                    }
                  }
                  setSetupOpen(false);
                }}
                onCancel={() => setSetupOpen(false)}
                onExportEmbedded={(files) => {
                  // onExportFiles: write every embedded file out, here as
                  // downloads; pending rows export their picked bytes directly.
                  const base = doc;
                  if (!base) return;
                  void (async () => {
                    for (const f of files) {
                      const bytes =
                        f.pendingBytes ?? (await getEmbeddedFileData(base, f.name))?.bytes;
                      if (bytes) downloadBlob(new Blob([bytes.slice().buffer]), f.name);
                    }
                  })();
                }}
              />
            )}
            {netlistOpen && doc && (
              <DialogExportNetlist
                doc={doc}
                libById={libById}
                baseName={outputBaseName()}
                {...(projectName ? { projectName } : {})}
                projectFolders={projectFolders}
                onOutputFile={onOutputFile}
                onClose={() => setNetlistOpen(false)}
              />
            )}
            {/* One dialog, two views (DIALOG_SYMBOL_FIELDS_TABLE): Edit Symbol
              Fields opens its Edit page, Generate BOM its Export page. */}
            {(fieldsTableOpen || bomOpen) && (
              <DialogSymbolFieldsTable
                docs={liveDocs()}
                rootFile={project.current.root}
                currentPath={currentPath}
                fieldTemplates={resolvedFieldTemplates}
                presets={setup.bomPresets}
                // Saved presets persist into schematic.bom_presets and list in
                // Schematic Setup > BOM Presets, like upstream.
                onSavePresets={(bomPresets) => commitSetup({ ...setup, bomPresets })}
                defaultBomFileName={`${outputBaseName()}.csv`}
                initialTab={bomOpen ? 'export' : 'edit'}
                onApply={(edits, opts) =>
                  applyFieldsEdits(edits.fields, { ...opts, attrs: edits.attrs })
                }
                // The BOM lands in the project's file manager (the cloud "disk"),
                // like every other generated output.
                onExportFile={(name, text) => {
                  if (onOutputFile) onOutputFile(name, new TextEncoder().encode(text), 'text/csv');
                  else downloadBlob(new Blob([text], { type: 'text/csv' }), name);
                }}
                // Cross-probe: pick the row's symbols on the canvas (highlight
                // also centres on the first one), as OnTableRangeSelected does.
                onCrossProbe={(refs, mode) => {
                  const ids = refs.filter((r) => r.file === currentFile).map((r) => r.id);
                  if (ids.length === 0) return;
                  setSelection(new Set(ids));
                  if (mode === 'highlight') setHighlightItem(ids[0] ?? null);
                }}
                onClose={() => {
                  setFieldsTableOpen(false);
                  setBomOpen(false);
                }}
              />
            )}
            {/* Assign Footprints (cvpcb): assignments apply as Footprint field
              edits through the same per-sheet pathway as the fields table. */}
            {assignFpOpen && (
              <AssignFootprints
                docs={liveDocs()}
                // The netlist CVPCB works on is this design's sheets, in
                // hierarchy order, not every .kicad_sch in the project folder.
                files={assignFpFiles}
                projectFootprints={projectFootprintFiles}
                kiway={kiway}
                onSaveLibTable={saveProjectFpLibTable}
                onSaveEquFiles={saveProjectEquFiles}
                onClose={() => setAssignFpOpen(false)}
              />
            )}
            {/* Symbol Library Browser: "Add Symbol to Schematic" attaches the pick
              to the cursor exactly like the Place Symbol chooser. */}
            {browserOpen && (
              <SymbolLibraryBrowser
                onPick={(lib) => {
                  setBrowserOpen(false);
                  placeFlags.current = { keepSymbol: true, placeAllUnits: false, unitCount: 1 };
                  setPlaceLib(lib);
                  setActiveTool('placeSymbol');
                }}
                onClose={() => setBrowserOpen(false)}
              />
            )}
          </div>
          {toggles.has('showSearch') && doc && (
            <>
              {/* The sash sits ABOVE the pane here, so dragging it down has to
                  SHRINK the pane below rather than grow the one above —
                  `startPanelResize`'s inverse. */}
              <div
                className="ze-splitter horizontal"
                onMouseDown={startBottomDockResize}
                title="Drag to resize"
              />
              <div className="ze-bottomdock sch-bottomdock" style={bottomDockStyle}>
                <div className="ze-panel">
                  <div className="ze-panel-header">Search</div>
                  <div className="ze-panel-body">
                    <SearchPanel
                      doc={doc}
                      libById={libById}
                      fmt={fmt}
                      menuState={{
                        selectionZoom: app.settings.common.search_pane.selection_zoom,
                        searchHiddenFields: app.settings.common.search_pane.search_hidden_fields,
                        searchMetadata: app.settings.common.search_pane.search_metadata,
                      }}
                      onMenuStateChange={(next) =>
                        app.settings.updateCommon((c) => {
                          c.search_pane.selection_zoom = next.selectionZoom;
                          c.search_pane.search_hidden_fields = next.searchHiddenFields;
                          c.search_pane.search_metadata = next.searchMetadata;
                        })
                      }
                      selection={selection}
                      onClearSelection={() => setSelection(new Set())}
                      onSelect={(id) => setSelection(new Set([id]))}
                      onCenter={(_id, at) => schFrameRef.current!.FocusOnLocation(at)}
                      onZoomFit={(id) => {
                        // ACTIONS::zoomFitSelection, the same extent walk the View
                        // menu's Zoom to Selected Objects uses.
                        const box = doc ? selectionBBox(doc, new Set([id]), libById) : emptyBBox();
                        if (!isEmpty(box))
                          schFrameRef.current!.FocusOnLocation({
                            x: (box.minX + box.maxX) / 2,
                            y: (box.minY + box.maxY) / 2,
                          });
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <Toolbar
          entries={schRightBar}
          app="eeschema"
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onRightToolbar}
        />
      </div>

      {/* EDA_DRAW_FRAME hosts a message panel above the 8-field status bar:
          a single selected item's GetMsgPanelInfo rows; anything else clears
          it (SCH_INSPECTION_TOOL::UpdateMessagePanel). */}
      <MsgPanel items={msgPanelItems} testId="sch-message-panel" />

      {/* KISTATUSBAR's 8 fields (eda_draw_frame.cpp): message (grows), the
          net-highlight text lands here (UpdateNetHighlightStatus) | Z zoom |
          absolute X/Y | relative dx/dy/dist | grid | units | current-tool
          (grows) | constraint (eeschema never writes it). */}
      <KiStatusBar
        testIds={{ message: 'sch-status-msg', tool: 'sch-tool-msg' }}
        fields={{
          message: highlightName ? `Highlighted net: ${highlightName}` : statusText,
          zoom: (
            <span
              ref={(el) => {
                statusPaneRefs.current.zoom = el;
              }}
            />
          ),
          coords: (
            <span
              ref={(el) => {
                statusPaneRefs.current.coords = el;
              }}
            />
          ),
          deltas: (
            <span
              ref={(el) => {
                statusPaneRefs.current.deltas = el;
              }}
            />
          ),
          grid: gridMsg(messageTextFromValue(iuToMM(renderOpts.grid.sizeIU), units, SCH_IU_PER_MM)),
          units: unitsMsg(units),
          tool: SCH_TOOL_MSGS[activeTool] ?? '',
        }}
      />

      {revertPrompt && (
        /* IsOK (common/confirm.cpp:278-300): a KICAD_MESSAGE_DIALOG captioned
           "Confirmation" with wxICON_QUESTION, whose OK/Cancel pair is
           relabelled "&Yes"/"&No", and wxOK_DEFAULT makes YES the default. */
        <MessageDialogYesNo
          caption={CONFIRMATION_CAPTION}
          message={revertPromptMessage(revertPrompt.file)}
          icon="question"
          defaultButton="yes"
          onResult={(r) => (r === 'yes' ? revertPrompt.onYes() : revertPrompt.onNo())}
        />
      )}

      {textEntryRequest && (
        <WxTextEntryDialog
          caption={textEntryRequest.caption}
          message={textEntryRequest.message}
          value={textEntryRequest.value}
          onCancel={() => {
            setTextEntryRequest(null);
            textEntryRequest.resolve(null);
          }}
          onConfirm={(text) => {
            setTextEntryRequest(null);
            textEntryRequest.resolve(text);
          }}
        />
      )}
      {fileDialogRequest && (
        <WxFileDialog
          title={fileDialogRequest.title}
          filters={fileDialogRequest.filters}
          initialPath={fileDialogRequest.defaultDir || undefined}
          projectDir={project.current.root ? `/${project.current.root.replace(/\/.*$/, '')}` : null}
          onDone={(file) => {
            setFileDialogRequest(null);
            fileDialogRequest.resolve(file ? pickedFilePath(file) : null);
          }}
        />
      )}
      {/* DIALOG_SYMBOL_CHOOSER, opened by PickSymbolFromLibrary for the live tools. */}
      {chooserRequest && (
        <DialogSymbolChooser
          powerFilter={chooserRequest.filter?.GetFilterPowerSymbols() ?? false}
          showFootprints={chooserRequest.showFootprints}
          historyList={chooserRequest.history.map(pickedToChooser)}
          alreadyPlaced={chooserRequest.placed.map(pickedToChooser)}
          onOk={(result) => {
            setChooserRequest(null);
            chooserRequest.resolve(result ? chooserToPicked(result) : null);
          }}
          onCancel={() => {
            setChooserRequest(null);
            chooserRequest.resolve(null);
          }}
        />
      )}

      {aboutOpen && (
        <ShowAboutDialog title={ABOUT_TITLES.schematic} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen && (
        <PreferencesDialog initialPage={prefsPage} onClose={() => setPrefsOpen(false)} />
      )}

      {/* DIALOG_SYMBOL_PROPERTIES on a live symbol (SCH_EDIT_TOOL::Properties). */}
      {symbolDialog && (
        <DialogSymbolProperties
          dlg={symbolDialog.dlg}
          initial={symbolDialog.shown}
          onClose={(aRetval) => {
            setSymbolDialog(null);
            symbolDialog.resolve(aRetval);
          }}
          onCancel={() => {
            setSymbolDialog(null);
            symbolDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* DIALOG_WIRE_BUS_PROPERTIES on the live wires, buses and bus entries. */}
      {wireBusDialog && (
        <DialogLineProperties
          kind="wire"
          widthIU={wireBusDialog.shown.width ?? wireBusDialog.firstWidth}
          style={wireBusDialog.shown.style ?? 'default'}
          color={color4dToItemColor(wireBusDialog.shown.color)}
          {...(wireBusDialog.shown.junction !== undefined
            ? { junctionIU: wireBusDialog.shown.junction ?? 0 }
            : {})}
          onOk={(widthIU, style, color, junctionIU) => {
            setWireBusDialog(null);
            const shown = wireBusDialog.shown;
            // A binder left indeterminate leaves its value alone.
            wireBusDialog.dlg.TransferDataFromWindow(
              shown.width === null && widthIU === wireBusDialog.firstWidth ? null : widthIU,
              shown.style === null && style === 'default' ? null : style,
              itemColorToColor4d(color),
              junctionIU === undefined || (shown.junction === null && junctionIU === 0)
                ? null
                : junctionIU,
            );
            wireBusDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setWireBusDialog(null);
            wireBusDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* Assign Netclass (DIALOG_ASSIGN_NETCLASS). */}
      {netclassPatterns && (
        <DialogAssignNetclass
          frame="schematic"
          netNames={new Set(netclassPatterns)}
          // SCHEMATIC::GetNetClassAssignmentCandidates (schematic.cpp:742-758):
          // every non-bus net driven at least by a pin, as a sorted set.
          candidateNetNames={[
            ...new Set(
              (netlist?.nets ?? [])
                .filter((n) => n.driverPriority >= Priority.Pin)
                .map((n) => n.name),
            ),
          ].sort()}
          // netSettings->GetNetclasses(): a std::map, so by name, and without Default.
          netClasses={setup.netClasses.classes
            .map((c) => c.name)
            .filter((n) => n !== 'Default')
            .sort()}
          onCancel={() => setNetclassPatterns(null)}
          onOk={(pattern, netClass) => {
            // SetNetclassPatternAssignment( pattern, netclass ): the one pattern,
            // bus members expanded.
            const assignments = addNetclassAssignment(
              setup.netClasses.assignments,
              pattern,
              netClass,
            );
            commitSetup({
              ...setup,
              netClasses: { ...setup.netClasses, assignments },
            });
            setNetclassPatterns(null);
          }}
        />
      )}

      {/* The read-only hotkey list (DIALOG_LIST_HOTKEYS, Ctrl+F1). */}
      {/* DIALOG_TABLECELL_PROPERTIES on live cells (SCH_EDIT_TOOL::Properties). */}
      {cellDialog && (
        <DialogTableCellProperties
          dlg={cellDialog.dlg}
          initial={cellDialog.shown}
          units={units}
          onClose={(aRetval) => {
            setCellDialog(null);
            cellDialog.resolve(aRetval);
          }}
        />
      )}

      {/* DIALOG_JUNCTION_PROPS on the live junctions (E / double-click on a junction). */}
      {junctionDialog && (
        <DialogLineProperties
          kind="junction"
          diameterIU={junctionDialog.shown.diameter ?? junctionDialog.firstDiameter}
          color={color4dToItemColor(junctionDialog.shown.color)}
          onOk={(diameterIU, color) => {
            setJunctionDialog(null);
            // The binder was indeterminate and the user left it so: leave the diameters.
            const unchanged =
              junctionDialog.shown.diameter === null && diameterIU === junctionDialog.firstDiameter;
            junctionDialog.dlg.TransferDataFromWindow(
              unchanged ? null : diameterIU,
              itemColorToColor4d(color),
            );
            junctionDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setJunctionDialog(null);
            junctionDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* Edit Sheet Page Number (SCH_ACTIONS::editPageNumber). */}
      {pageEdit && (
        <div className="ze-modal-backdrop" onMouseDown={() => setPageEdit(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Edit Sheet Page Number
              <span className="x" title="Cancel" onClick={() => setPageEdit(null)}>
                ✕
              </span>
            </div>
            <div
              className="ze-label-dialog-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label className="row">
                <span>Page number</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={pageEdit.page}
                  onChange={(e) => setPageEdit({ page: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      editPageNumber(pageEdit.page.trim(), pageEdit.sheet);
                      setPageEdit(null);
                    }
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setPageEdit(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!pageEdit.page.trim()}
                onClick={() => {
                  editPageNumber(pageEdit.page.trim(), pageEdit.sheet);
                  setPageEdit(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG_SHEET_PROPERTIES on a live sheet (SCH_EDIT_FRAME::EditSheetProperties). */}
      {sheetDialog && (
        <DialogSheetProperties
          dlg={sheetDialog.dlg}
          initial={sheetDialog.shown}
          units={units}
          onOk={(values) => {
            void sheetDialog.dlg.TransferDataFromWindow(values).then((ok) => {
              if (!ok) return;
              setSheetDialog(null);
              sheetDialog.resolve(wxID_OK);
            });
          }}
          onCancel={() => {
            setSheetDialog(null);
            sheetDialog.resolve(wxID_CANCEL);
          }}
        />
      )}
      {kiDialog.node}

      {/* FRAME_FOOTPRINT_CHOOSER. Upstream reaches it through
          `Kiway().Player( FRAME_FOOTPRINT_CHOOSER, true, m_frame )` from
          PG_FPID_EDITOR, and the same frame is what Symbol Properties'
          GRID_CELL_FPID_EDITOR opens - one chooser, two callers. */}
      {fpChooser && (
        <FootprintChooserFrame
          preselect={fpChooser.current}
          fpFilters={fpChooser.fpFilters}
          {...(fpChooser.pinCount === undefined ? {} : { pinCount: fpChooser.pinCount })}
          onOk={(libId) => {
            fpChooser.commit(libId);
            setFpChooser(null);
          }}
          onCancel={() => {
            fpChooser.cancel?.();
            setFpChooser(null);
          }}
        />
      )}

      {/* DIALOG_SHEET_PIN_PROPERTIES on a live sheet pin. */}
      {sheetPinDialog && (
        <DialogSheetPinProperties
          initial={sheetPinDialog.shown}
          units={units}
          onOk={(values) => {
            setSheetPinDialog(null);
            sheetPinDialog.dlg.TransferDataFromWindow(values);
            sheetPinDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setSheetPinDialog(null);
            sheetPinDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {fieldDialog && (
        <DialogFieldProperties
          dlg={fieldDialog.dlg}
          initial={fieldDialog.shown}
          // Every UNIT_BINDER in the dialog reads its units off the frame.
          units={units}
          onOk={(values) => {
            if (!fieldDialog.dlg.TransferDataFromWindow(values)) return;
            // `dlg.UpdateField( &commit, aField, &m_frame->GetCurrentSheet() )`, on the caller's
            // commit.
            fieldDialog.dlg.UpdateField(
              fieldDialog.commit,
              fieldDialog.field,
              schFrameRef.current!.GetCurrentSheet(),
            );
            setFieldDialog(null);
            fieldDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setFieldDialog(null);
            fieldDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* DIALOG_IMAGE_PROPERTIES on a live bitmap. */}
      {imageDialog && (
        <DialogImageProperties
          at={imageDialog.shown.at}
          scale={imageDialog.shown.scale}
          data={imageDialog.shown.data}
          ppi={imageDialog.shown.ppi}
          pixelSize={imageDialog.shown.pixelSize}
          onOk={(r) => {
            setImageDialog(null);
            imageDialog.dlg.TransferDataFromWindow(r);
            imageDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setImageDialog(null);
            imageDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* DIALOG_SHAPE_PROPERTIES on a live shape. */}
      {shapeDialog && (
        <DialogShapeProperties
          shapeName={shapeDialog.name}
          units={units}
          initial={{
            border: shapeDialog.shown.border,
            borderWidthIU: shapeDialog.shown.borderWidth,
            borderStyle: shapeDialog.shown.borderStyle,
            ...(color4dToItemColor(shapeDialog.shown.borderColor)
              ? { borderColor: color4dToItemColor(shapeDialog.shown.borderColor) }
              : {}),
            fillType: shapeDialog.shown.fillType,
            ...(color4dToItemColor(shapeDialog.shown.fillColor)
              ? { fillColor: color4dToItemColor(shapeDialog.shown.fillColor) }
              : {}),
          }}
          onOk={(r) => {
            setShapeDialog(null);
            shapeDialog.dlg.TransferDataFromWindow({
              border: r.border,
              borderWidth: r.borderWidthIU,
              borderStyle: r.borderStyle,
              borderColor: itemColorToColor4d(r.borderColor),
              fillType: r.fillType,
              fillColor: itemColorToColor4d(r.fillColor),
            });
            shapeDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setShapeDialog(null);
            shapeDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* DIALOG_TEXT_PROPERTIES on a live text or text box. */}
      {labelDialog && (
        <DialogLabelProperties
          dlg={labelDialog.dlg}
          initial={labelDialog.shown}
          units={units}
          onOk={(values) => {
            if (!labelDialog.dlg.TransferDataFromWindow(values)) return;
            setLabelDialog(null);
            labelDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setLabelDialog(null);
            labelDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {textDialog && (
        <DialogTextProperties
          units={units}
          kind={textDialog.dlg.IsTextBox() ? 'textbox' : 'text'}
          pages={linkPages}
          initial={textDialog.shown}
          onOk={(values) => {
            const error = textDialog.dlg.TransferDataFromWindow(values);
            if (error) {
              schFrameRef.current!.DisplayError(error);
              return;
            }
            setTextDialog(null);
            textDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setTextDialog(null);
            textDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* Table: choose the grid size, then place the table (SCH_TABLE). */}
      {importGfxOpen && (
        <DialogImportGfx
          onCancel={() => setImportGfxOpen(false)}
          onOk={(graphics, labels, interactive) => {
            setImportGfxOpen(false);
            if (graphics.length === 0 && labels.length === 0) return;
            if (!interactive) {
              runCommand(addItems({ graphics, labels }));
              return;
            }
            // Interactive placement: the drawing rides the cursor and a click
            // drops it, which is the paste gesture — upstream likewise hands
            // the imported items to the placement loop as a preview.
            //
            //     m_toolMgr->RunAction( ACTIONS::cancelInteractive );
            //     … preview … commitImport( newItems );
            //
            // The anchor is the drawing's top-left, as a paste's is
            // (SCH_SELECTION::GetTopLeftItem).
            let minX = Infinity;
            let minY = Infinity;
            for (const g of graphics) {
              const pts =
                g.kind === 'polyline' || g.kind === 'bezier'
                  ? g.points
                  : g.kind === 'circle'
                    ? [{ x: g.center.x - g.radius, y: g.center.y - g.radius }]
                    : g.kind === 'arc'
                      ? [g.start, g.mid, g.end]
                      : g.kind === 'ellipse' || g.kind === 'ellipse_arc'
                        ? [
                            {
                              x: g.center.x - Math.max(g.majorRadius, g.minorRadius),
                              y: g.center.y - Math.max(g.majorRadius, g.minorRadius),
                            },
                          ]
                        : [];
              for (const p of pts) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
              }
            }
            for (const l of labels) {
              minX = Math.min(minX, l.at.x);
              minY = Math.min(minY, l.at.y);
            }
            setPastePending({
              batch: {
                symbols: [],
                lines: [],
                junctions: [],
                noConnects: [],
                labels,
                sheets: [],
                busEntries: [],
                images: [],
                graphics,
                textBoxes: [],
                directiveLabels: [],
                tables: [],
              },
              libs: [],
              refPoint: {
                x: Number.isFinite(minX) ? minX : 0,
                y: Number.isFinite(minY) ? minY : 0,
              },
            });
          }}
        />
      )}
      {/* DIALOG_TABLE_PROPERTIES on a live table (DrawTable, Properties, EditTable). */}
      {tableDialog && (
        <DialogTableProperties
          dlg={tableDialog.dlg}
          initial={tableDialog.shown}
          isNew={tableDialog.isNew}
          onOk={(values) => {
            if (!tableDialog.dlg.TransferDataFromWindow(values)) return;
            setTableDialog(null);
            tableDialog.resolve(wxID_OK);
          }}
          onCancel={() => {
            setTableDialog(null);
            tableDialog.resolve(wxID_CANCEL);
          }}
        />
      )}

      {/* WX_PROGRESS_REPORTER( this, _( "Load Schematic" ), 1, PR_CAN_ABORT )
          (files-io.cpp:179), over the frame — which is already up, menus,
          toolbars and grid, with its blank sheet, exactly as SCH_EDIT_FRAME
          is before OpenProjectFiles runs. */}
      <ProgressDialog title="Load Schematic" label={loading} />
    </div>
  );
}

/** One row of the hierarchy tree; children indent one level (KiCad's navigator). */
/**
 * One row of the hierarchy tree (HIERARCHY_TREE): ancestor columns carry a
 * dotted guide line for every level whose parent still has siblings below it,
 * and this node's own column elbows into its row - straight through for a
 * middle child, cut off halfway down for the last one - matching KiCad's
 * wxTreeCtrl connector lines.
 */
/**
 * One row of HIERARCHY_TREE and, below it, its subtree.
 *
 * On GTK a wxTreeCtrl is wxGenericTreeCtrl, and it paints every row with the
 * same arithmetic (src/generic/treectlg.cpp, `PaintLevel` :2765 and
 * `PaintItem` :2556), so the row is laid out from those numbers rather than
 * from flex gaps. `qa/probes/hierarchy_tree_probe.cpp` builds the tree with
 * HIERARCHY_TREE's style word and KiCad's two images and reads the same
 * positions back off wx. With `m_indent` 15 and `m_spacing` 18, an item at
 * `level` (1 for the top-level sheet — `wxTR_HIDE_ROOT` hides level 0):
 *
 *     x         = level * 15                 the button's centre and the trunk
 *     item X    = x + 18                     the 16px icon
 *     text      = X + 16 + 4                 MARGIN_BETWEEN_IMAGE_AND_TEXT
 *     guide     = (x > 15 ? x - 15 : x) .. X the dotted lead-in, at y_mid
 *     trunk     = x, from y_mid + 5 down to the last child's y_mid
 *     selection = X + 17 .. text end + 3     the band leaves the icon alone
 *
 * The control paints from y = 2 and each row is `GetLineHeight()` = 24 tall
 * (font extent 18 + 4 + 2, the probe's number), the icon centred at +4 and
 * the text centred in the row.
 *
 * The CSS carries the same numbers as `--x`, `--X` per level; the classes are
 * `ze-hier-*` and nothing else in the app shares them.
 *
 * Which row is selected: `UpdateHierarchySelection` (hierarchy_pane.cpp:145)
 * bolds the current sheet and `SetFocusedItem`s it, which in the generic tree
 * is `SelectItem` — so the current sheet is the selected one, and a selected
 * item shows its SELECTED image, `tree_sel` (the blue dot), where every other
 * row shows `tree_nosel`. wxGenericTreeCtrl has no hover state.
 */
function renderSheetNode(
  node: SheetTreeNode,
  depth: number,
  currentPath: string,
  onOpen: (path: string, file: string) => void,
  collapsedPaths: ReadonlySet<string>,
  setCollapsedPaths: (updater: (prev: Set<string>) => Set<string>) => void,
  isLast = true,
  isFirst = true,
): JSX.Element {
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedPaths.has(node.path);
  const active = node.path === currentPath;
  const level = depth + 1;
  const toggle = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  };
  return (
    <div
      key={node.path}
      className={`ze-hier-node${isLast ? ' last' : ''}${isFirst ? ' first' : ''}`}
      style={{ '--lvl': level } as React.CSSProperties}
    >
      <div className="ze-hier-row" onClick={() => onOpen(node.path, node.file)} title={node.file}>
        {/* The dotted lead-in: from the parent's trunk (or, for a top-level
            sheet, from its own button) to the icon. */}
        <span className="ze-hier-guide" />
        {hasChildren && (
          <span
            className={`ze-hier-button${collapsed ? '' : ' open'}`}
            onClick={toggle}
            title={collapsed ? 'Expand' : 'Collapse'}
          />
        )}
        <span className={`ze-hier-icon${active ? ' sel' : ''}`} />
        <span className={`ze-hier-label${active ? ' sel' : ''}`}>
          {node.name}
          {node.page && ` (page ${node.page})`}
        </span>
      </div>
      {!collapsed && hasChildren && (
        <div className="ze-hier-children">
          {node.children.map((c, i) =>
            renderSheetNode(
              c,
              depth + 1,
              currentPath,
              onOpen,
              collapsedPaths,
              setCollapsedPaths,
              i === node.children.length - 1,
              i === 0,
            ),
          )}
        </div>
      )}
    </div>
  );
}
