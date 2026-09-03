// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
import { parse } from '@ziroeda/sexpr';
import {
  type ArcEditMode,
  incrementArcEditMode,
  type EditHandle,
  pointEditTarget,
  canAddCorner,
  canRemoveCorner,
  addCorner,
  removeCorner,
  reshapeCommand,
  SPIN_ANGLE,
  spinOfAngle,
  wireLabelDriverName,
  cleanLabelFields,
  DEFAULT_DIRECTIVE_PIN_LENGTH,
  directiveNetclassAssignments,
  ruleAreaNetclassAssignments,
  type DirectiveShape,
  labelFields,
  changeTextType,
  setAttribute,
  alignItems,
  alignToGridCommand,
  autoplaceAfterFieldEdit,
  autoplaceFields,
  autoplacePlacedSymbol,
  autoplaceSheetFields,
  ALIGN_LABELS,
  type AlignMode,
  attributeIsSet,
  canSetAttribute,
  type Attribute,
  TYPE_LABELS,
  type TextType,
  setLabelFields,
  type LabelSpin,
  type TextEffects,
  type SchLabel,
  type SchField,
  type SchSheet,
  type Stroke,
  type Fill,
  readSchematic,
  serializeSchematic,
  deleteByIds,
  deleteItems,
  transformItems,
  computeNetlist,
  withCleanup,
  refId,
  editSymbolProperties,
  copySelectionText,
  parsePastedText,
  boxSelect,
  symbolBodyBBox,
  selectionBBox,
  labelBox,
  emptyBBox,
  type BBox,
  isEmpty,
  inflate,
  contains,
  includePoint,
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
  groupItemsCommand,
  ungroupItemsCommand,
  addToGroupCommand,
  removeFromGroupCommand,
  canAddToGroup,
  canRemoveFromGroup,
  selectionHasGroup,
  setSymbolsLockedCommand,
  expandSelectionToGroups,
  screenHasItems,
  selectionCanCopyAsText,
  selectionIsExpandable,
  syncSelectionParts,
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
  DeletableItems,
  MovableItems,
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
  changeSymbols,
  symbolUnitCount,
  unitDisplayName,
  unplacedUnits,
  planNextSymbolUnit,
  setSymbolUnit,
  symbolLibIdRows,
  orphanCandidates,
  libIdChangeCommand,
  detectFieldCaseConflicts,
  resolveFieldCaseConflictsCommand,
  type FieldCaseAction,
  type FieldCaseConflict,
  type ChangeSymbolsMessage,
  type ChangeSymbolsMode,
  type ChangeSymbolsOptions,
  type SymbolMatch,
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
  canMerge,
  canUnmerge,
  resolveCell,
  tableCellId,
  tableOfCellId,
  hasCellSelection,
  rowColCommand,
  tableCellsCommand,
  type RowColOp,
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
  advanceSyncPlacement,
  deleteSyncLabels,
  deleteSyncPins,
  syncPlacementFor,
  type SyncPlacement,
  type SyncTemplate,
  buildSheetTree,
  sheetFile,
  sheetName,
  findRootFile,
  addItems,
  makeSheet,
  addSheetPin,
  nextImportableSheetPin,
  importableSheetPins,
  replaceSheet,
  replaceGraphic,
  replaceImage,
  replaceSymbol,
  replaceSheetPin,
  parseSheetPinId,
  cleanupSheetPins,
  autoplaceAllSheetPins,
  hierarchicalLabels,
  busUnfoldMembers,
  unfoldBus,
  busForUnfolding,
  swapItems,
  canSwap,
  cycleBodyStyle,
  repeatItems,
  hasAlternateBodyStyle,
  setBodyStyle,
  hierarchicalLabelNames,
  deleteSheetPin,
  type SheetPinRef,
  fieldEditCaption,
  fieldEditTarget,
  imagePPI,
  imagePixelSize,
  replaceTextBox,
  replaceLabel,
  replaceDirectiveLabel,
  replaceBusEntry,
  replaceLine,
  replaceJunction,
  makeImage,
  makeTextBox,
  makeTable,
  makeTableFromDrag,
  buildPropertyNode,
  History,
  type Schematic,
  type SchImage,
  type SchTable,
  type LibSymbol,
  type SchSymbol,
  type EditCommand,
  type SheetSide,
  type TransformOp,
  type LabelKind,
  type LabelShape,
  type SymbolEdit,
  type PastePayload,
  type ErcViolation,
  type SheetTreeNode,
  type ItemRef,
  describeItem,
  itemRefById,
  schPropertiesFor,
  schItemFriendlyName,
  type PropRow,
  getMsgPanelItems,
  type MsgPanelItem,
  nextFreeUnit,
} from '@ziroeda/eeschema';
import {
  SchematicCanvas,
  type CanvasController,
  type LineMode,
  type PendingLabel,
  type PendingDirective,
} from './components/SchematicCanvas.js';
import {
  DialogLabelProperties,
  type LabelPropsKind,
  type LabelPropsResult,
} from './dialogs/dialog_label_properties.js';
import {
  DialogTextProperties,
  type HAlign,
  type TextPropsResult,
  type VAlign,
} from './dialogs/dialog_text_properties.js';
import { SymbolPropertiesDialog } from './components/SymbolPropertiesDialog.js';
import { ErcDialog, type ErcDialogNav } from './components/ErcDialog.js';
import {
  DialogSymbolChooser,
  type PickedSymbol,
  type SymbolChooserResult,
} from './dialogs/dialog_symbol_chooser.js';
import { SymbolLibraryBrowser } from './components/SymbolLibraryBrowser.js';
import { loadFootprint, loadFootprintIndex } from '../../widgets/footprint_list.js';
import { libraryUri, loadIndex, loadSymbol, symbolsBase } from './symbols/index.js';
import { repairSourceLibs } from './symbols/repair_source.js';
import { preloadSchematicLibraries } from './preload.js';
import {
  projectSymbolLibraries,
  projectSymLibTablePath,
  serializeSymLibTable,
} from './symbols/project_sym_lib_table.js';
import { DialogSymLibTable } from '../../widgets/dialog_sym_lib_table.js';
import {
  projectFpLibTablePath,
  serializeFpLibTable,
  type FpLibRow,
} from '../footprint/fp_lib_table.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { SaveAsDialog } from '../../fs/SaveAsDialog.js';
import { kicadSchematicWildcard } from '../../fs/wildcards.js';
import { RIGHT_TOOLBAR_COMMANDS, SCH_DEFAULT_TOOLBARS } from './toolbars_sch_editor.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { MenuBar, ContextMenu, type Menu, type MenuItem } from '../../ui/MenuBar.js';
import { assembleMenu, type RankedItem } from '../../ui/menu_rank.js';
import {
  clearHoverSelection,
  isHoverSelection,
  requestSelection,
  rightClickSelection,
  type HoverSelection,
} from './hover_selection.js';
import { buildMenus } from './menubar.js';
import { CONFIRMATION_CAPTION, revertPromptMessage, savedFileMessage } from './files_io.js';
import { MessageDialogYesNo } from '../../ui/dialog_message.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '../../ui/menu_hotkeys.js';
import { wasBrowserSuppressed, type FocusLike } from '../../ui/browser_hotkeys.js';
import { remapEvent } from './hotkey_bindings.js';
import { applyHotkeyOverrides } from './hotkey_list.js';
import { DialogAssignNetclass } from './dialogs/dialog_assign_netclass.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { DialogTableCellProperties } from './dialogs/dialog_tablecell_properties.js';
import {
  SchNavigateTool,
  flattenHierarchy,
  parentPath,
  type SheetRef,
} from './sch_navigate_tool.js';
import { DialogSchFind } from '../../widgets/dialog_sch_find.js';
import {
  DialogIncrementAnnotations,
  type IncrementAnnotationsResult,
} from './dialogs/dialog_increment_annotations.js';
import {
  DialogGlobalEditTextAndGraphics,
  type GlobalEditResult,
} from './dialogs/dialog_global_edit_text_and_graphics.js';
import { DialogChangeSymbols, type ChangeSymbolsSubject } from './dialogs/dialog_change_symbols.js';
import { DialogEditSymbolsLibId } from './dialogs/dialog_edit_symbols_libid.js';
import { DialogResolveFieldCaseConflicts } from './dialogs/dialog_resolve_field_case_conflicts.js';
import { DialogAnnotate, type AnnotateRun } from './dialogs/dialog_annotate.js';
import { DialogLineProperties, type ItemColor } from './dialogs/dialog_line_properties.js';
import { DialogEeschemaPageSettings } from '../../dialogs/dialog_eeschema_page_settings.js';
import {
  pageSettingsValue,
  toPaperToken,
  type PageExportFlags,
  type PageSettingsValue,
} from '../../dialogs/page_settings_model.js';
// `DIALOG_PASTE_SPECIAL` is a `common/dialogs/` dialog upstream, built by
// eeschema AND pcbnew, so it is one module here too rather than a copy under
// this editor's own `dialogs/`. `SCH_EDITOR_CONTROL::Paste` supplies the two
// things that differ: the mode it opens on, and no `aDefaultRef`.
import { DialogPasteSpecial, type PasteSpecialMode } from '../../dialogs/dialog_paste_special.js';
import { DialogSheetProperties, type SheetPropsResult } from './dialogs/dialog_sheet_properties.js';
import { DialogShapeProperties, type ShapePropsResult } from './dialogs/dialog_shape_properties.js';
import { DialogImageProperties, type ImagePropsResult } from './dialogs/dialog_image_properties.js';
import { DialogFieldProperties, type FieldPropsResult } from './dialogs/dialog_field_properties.js';
import {
  DialogSheetPinProperties,
  type SheetPinPropsResult,
} from './dialogs/dialog_sheet_pin_properties.js';
import {
  DialogSchematicSetup,
  defaultSchematicSetup,
  type SchematicSetup,
} from './dialogs/dialog_schematic_setup.js';
import {
  DialogCreateNetChain,
  type CreateChainFocusHint,
} from './dialogs/dialog_create_net_chain.js';
import {
  findProjectPro,
  readSchematicSetup,
  writeEquivalenceFilesText,
  writeSchematicSetupText,
} from './project_settings.js';
import {
  IU_PER_MILS,
  hopOverArcRadiusIU,
  junctionDotDiameterIU,
  resolveEffectiveNetClass,
  subpartSettings,
} from './schematic_settings.js';
import { computeNetClassOverrides } from './net_overrides.js';
import {
  RefDesTracker,
  buildPageRefsMap,
  chainPatternAssignments,
  connectionName,
  equivalentBusNames,
  detectNetChains,
  isValidNetChainName,
  netChainsCommand,
  readNetChains,
  removeFromNetChainCommand,
  restoreCommittedNetChains,
  writeNetChains,
  type CommittedNetChain,
  expandTextVars,
  intersheetRefsText,
  addEmbeddedFile,
  embeddedFilesCommand,
  getEmbeddedFileData,
  listEmbeddedFiles,
  removeEmbeddedFile,
  setEmbedFonts,
  schematicTextVarResolver,
  type IntersheetRefsConfig,
  type IntersheetSheet,
} from '@ziroeda/eeschema';
import { DialogExportNetlist } from './dialogs/dialog_export_netlist.js';
import { DialogSymbolFieldsTable, type FieldsEdits } from './dialogs/dialog_symbol_fields_table.js';
import { DialogAssignFootprints } from './dialogs/dialog_assign_footprints.js';
import { DialogPrint } from './dialogs/dialog_print.js';
import { DialogPlot, type PlotRequest } from './dialogs/dialog_plot.js';
import {
  downloadBlob,
  printSheets,
  plotPng,
  plotSvg,
  plotPdf,
  plotPdfSheets,
  plotDxf,
  plotPs,
  pageIU,
  type PlotOpts,
  type PlotSink,
} from './render/plot.js';
import { DEFAULT_SETUP } from '@ziroeda/common/src/drawing_sheet/types.js';
import { BUILTIN_THEMES } from './theme.js';
import { LoadingOverlay, nextPaint } from '../../ui/LoadingOverlay.js';
import type { ProgressSnapshot } from '../../ui/progress_reporter.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import type { PrefsPageId } from '../../dialogs/prefs/types.js';
import { settings, gridSizeToIU } from '../../prefs/settings.js';
import {
  fastGridActionForKey,
  fastGridIndex,
  gridChoiceLabel,
  gridFeedback,
  type FastGridAction,
} from '../../ui/grid_settings.js';
import { useHotkeyCyclePopup } from '../../widgets/HotkeyCyclePopup.js';
import {
  useCommonSettings,
  useEeschemaSettings,
  useHotkeyOverrides,
  useSchematicTheme,
} from '../../prefs/useSettings.js';
import type { RenderOpts } from './render/renderer.js';
import type { InputPrefs } from '../../ui/view_controls.js';
import { SchPropertiesPanel } from './components/SchPropertiesPanel.js';
import { FootprintChooserFrame } from '../pcb/dialogs/footprint_chooser_frame.js';
import { SearchPanel } from './components/SearchPanel.js';
import { NetNavigatorPanel } from './components/NetNavigatorPanel.js';
import { DialogUpdateFromPcb } from './dialogs/dialog_update_from_pcb.js';
import { DialogSyncSheetPins, type SyncSheetEntry } from './dialogs/dialog_sync_sheet_pins.js';
import {
  applySchTableValues,
  collectSchTableValues,
  tableWithValues,
  type SchTableValues,
} from '@ziroeda/eeschema/src/tools/sch_table_properties.js';
import { DialogTableProperties } from './dialogs/dialog_table_properties.js';
import { DialogImportGfx } from './dialogs/dialog_import_gfx.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { MsgPanel } from '../../ui/MsgPanel.js';
import {
  gridMsg,
  messageTextFromValue,
  type StatusUnits,
  unitsMsg,
} from '../../ui/status_format.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { withSaveEnablement } from '../../ui/save_enablement.js';
import { fileBaseName, pathHumanReadable, SCH_FRAME_NAME, schFrameTitle } from './frame_title.js';
import {
  SCH_BOTTOM_DOCK,
  SCH_LEFT_PANE_ADD_ORDER,
  schDockPosFrom,
  schLeftDockLayout,
  schPaneGrows,
  schSelectionFilterShown,
  type SchDockPos,
  type SchLeftPane,
} from './panes.js';
import { SelectionFilterPanel } from '../../ui/SelectionFilterPanel.js';
import { useStatusReadout } from '../../ui/useStatusReadout.js';
import { useUnsavedGuard } from '../../ui/useUnsavedGuard.js';
import '../../ui/shell.css';
import { schSymbolLibraryName } from '@ziroeda/eeschema';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { applyToggle, DEFAULT_TOGGLES } from './toggles.js';

// What KiCad writes for File > New Schematic: an empty sheet on A4 paper.
// Launching the editor without a project starts here (no bundled demo).
const EMPTY_SCH =
  '(kicad_sch (version 20231120) (generator "ziroeda") (paper "A4")\n  (lib_symbols)\n)\n';

// Local view toggles; grid/crosshair/line-mode/hidden-pins live in the settings
// store (Preferences) and are derived each render so the two stay in sync.
// `RADIO_GROUPS`, `DEFAULT_TOGGLES` and `applyToggle` are in `toggles.ts`
// rather than here, because `qa`'s tsconfig compiles `.ts` only: a default
// written in a `.tsx` is one no test can read, and the opening units sat on the
// wrong arm of `app_settings.cpp:228-238` for exactly that reason.
/** Edit > Attributes menu ids, and the attribute each one sets. */
/** The Attributes submenu, in the Edit menu's order (SCH_EDIT_TOOL). */
const ATTRIBUTE_MENU: { id: string; label: string }[] = [
  { id: 'attrSim', label: 'Exclude from Simulation' },
  { id: 'attrBom', label: 'Exclude from Bill of Materials' },
  { id: 'attrBoard', label: 'Exclude from Board' },
  { id: 'attrPosFiles', label: 'Exclude from Position Files' },
  { id: 'attrDnp', label: 'Do not Populate' },
];

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

function hasDuplicateSheetNames(sch: Schematic): boolean {
  const seen = new Set<string>();
  for (const s of sch.sheets) {
    const name = (s.fields.find((f) => f.key === 'Sheetname')?.value ?? '').toLowerCase();
    if (!name) continue;
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
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

// Right-toolbar tool ids that place a text label, mapped to the label kind.
const LABEL_TOOL_KINDS: Record<string, LabelKind> = {
  placeLabel: 'label',
  placeGlobalLabel: 'global_label',
  placeHierLabel: 'hierarchical_label',
  placeText: 'text',
};

// The subset served by DIALOG_LABEL_PROPERTIES (free text has its own dialog).
const LABEL_DIALOG_KINDS: Record<string, 'label' | 'global_label' | 'hierarchical_label'> = {
  placeLabel: 'label',
  placeGlobalLabel: 'global_label',
  placeHierLabel: 'hierarchical_label',
};

/** `(justify …)` tokens from the text dialog's alignment buttons; centred
 *  alignment is the default and writes no token (EDA_TEXT::Format). */
const justifyTokens = (h: HAlign, v: VAlign): string[] => [
  ...(h === 'center' ? [] : [h]),
  ...(v === 'center' ? [] : [v]),
];

const hAlignOf = (justify: readonly string[] | undefined): HAlign =>
  justify?.includes('left') ? 'left' : justify?.includes('right') ? 'right' : 'center';

const vAlignOf = (justify: readonly string[] | undefined): VAlign =>
  justify?.includes('top') ? 'top' : justify?.includes('bottom') ? 'bottom' : 'center';

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
const sPowerHistoryList: PickedSymbol[] = [];

export function SchematicEditor({
  onExitToHome,
  onShowPcb,
  onUpdatePcb,
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
  extraSheetFiles,
  projectName,
  rootPro,
  onCrossProbeNet,
  onSelectOnPcb,
}: {
  onExitToHome: () => void;
  onShowPcb?: () => void;
  /** Tools > Update PCB from Schematic (F8): switch to the PCB editor and run
   *  its update dialog. Absent when the project has no board. */
  onUpdatePcb?: () => void;
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
  onProjectChange?: (files: PickedFile[]) => void;
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
  /** `.kicad_wks` saved into the project this session (Drawing Sheet Editor →
   *  Save to Project), offered as extra Page Settings drawing-sheet choices. */
  extraSheetFiles?: PickedFile[];
  /** Project name shown as "<project>, Schematic Editor" in the menu bar. */
  projectName?: string;
  /** Basename of the active project's .kicad_pro (no extension). When a folder
   *  holds several projects, this pins which one's root sheet to load, so the
   *  editor matches the launcher tree instead of guessing the first/last pro. */
  rootPro?: string;
  /** The net the highlight tools are showing, cross-probed to the PCB editor
   *  (SCH_EDIT_FRAME::SendCrossProbeConnection / SendCrossProbeClearHighlight);
   *  null when the highlight is cleared. */
  onCrossProbeNet?: (net: string | null) => void;
  /** Select on PCB (SCH_ACTIONS::selectOnPCB): the `$SELECT:` parts of the
   *  current selection, for the board frame to resolve and select. */
  onSelectOnPcb?: (parts: readonly string[]) => void;
}): JSX.Element {
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

  const [doc, setDoc] = useState<Schematic | null>(initial);
  // Multi-sheet project: every parsed document by basename, the root file, and a
  // History per sheet (KiCad keeps one undo stack per screen). `doc` is always
  // the currently-shown sheet; it is written back into `docs` when switching.
  const project = useRef<{ docs: Map<string, Schematic>; root: string }>({
    docs: new Map(initial ? [[DEFAULT_FILE, initial]] : []),
    root: DEFAULT_FILE,
  });
  const histories = useRef<Map<string, History>>(new Map());
  const [currentFile, setCurrentFile] = useState<string>(DEFAULT_FILE);
  // The active sheet *instance* (KiCad SCH_SHEET_PATH). Distinct from currentFile
  // so two instances of one shared document highlight/navigate independently.
  const [currentPath, setCurrentPath] = useState<string>('/');
  // KiCad's "Load Schematic" progress: non-null while parsing/saving a project
  // (a plain message, or a snapshot with the per-sheet parse gauge).
  const [loading, setLoading] = useState<string | ProgressSnapshot | null>(null);
  // Register the initial sheet's undo stack so returning to it keeps its history.
  useEffect(() => {
    histories.current.set(DEFAULT_FILE, history.current);
  }, []);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
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
  const history = useRef(new History());
  const controller = useRef<CanvasController>(null);
  const [activeTool, setActiveTool] = useState('select');
  /**
   * Run an AF_ACTIVATE tool, or stop it if it is the one already running.
   *
   * `TOOL_MANAGER::dispatchActivation` sends the activation to the running tool
   * *and* asks for it to be run again, but `runTool` refuses to restart one that
   * is already active:
   *
   *     // If the tool is already active, bring it to the top of the active tools stack
   *     if( isActive( aTool ) && m_activeTools.size() > 1 )
   *     { ... return false; }
   *
   * so all the second click really does is deliver the event the tool's own loop
   * treats as a cancel —
   *
   *     if( evt->IsCancelInteractive() || evt->IsActivate() )
   *         break;
   *
   * — after which `PopTool` empties the stack and leaves the selection tool in
   * charge. Clicking a lit toolbar button therefore turns the tool off, and ours
   * just re-armed it.
   */
  const activateTool = useCallback((id: string) => {
    setActiveTool((cur) => (cur === id ? 'select' : id));
  }, []);
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
  const [placeUnit, setPlaceUnit] = useState(1);
  // Read by the after-placement continuation, which must see the library that
  // is on the cursor now rather than the one its closure was built with.
  const placeLibRef = useRef<LibSymbol | null>(null);
  placeLibRef.current = placeLib;
  const placeFlags = useRef({ keepSymbol: true, placeAllUnits: false, unitCount: 1 });
  const [pendingLabel, setPendingLabel] = useState<PendingLabel | null>(null);
  // The rest of a "Multiple label input" run: KiCad hands TwoClickPlace a list
  // and places them one click at a time (itemsToPlace).
  const [labelQueue, setLabelQueue] = useState<readonly string[]>([]);
  // Whether the label dialog is up. A label tool asks for its label as soon as
  // it is picked (common_settings->m_Input.immediate_actions primes the tool),
  // and again on the next click after one is placed.
  const [labelPrompt, setLabelPrompt] = useState(false);
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
  // The free-text equivalents (m_lastTextHJustify / m_lastTextVJustify /
  // m_lastTextAngle), which createNewText carries between placements.
  const lastText = useRef({
    hAlign: 'center' as HAlign,
    vAlign: 'center' as VAlign,
    angle: 0,
    excludeFromSim: false,
    face: '',
  });
  // m_lastSheetPinType: the shape the next sheet pin starts with (Input).
  const lastSheetPin = useRef({ shape: 'input' as LabelShape });
  // m_lastNetClassFlagShape: the directive label's flag shape (Circle).
  const lastDirective = useRef({
    shape: 'round' as DirectiveShape,
    pinLength: DEFAULT_DIRECTIVE_PIN_LENGTH,
    spin: 'right' as LabelSpin,
  });
  const [pendingDirective, setPendingDirective] = useState<PendingDirective | null>(null);
  // The netclass flag whose properties are open (double-click / Properties).
  const [directiveEdit, setDirectiveEdit] = useState<{ index: number } | null>(null);
  // immediate_actions (COMMON_SETTINGS::m_Input): picking a label or text tool
  // primes it, so the properties dialog comes up as soon as the tool is active
  // - whichever way it was chosen (toolbar, menu or hotkey).
  useEffect(() => {
    const isLabelTool = !!LABEL_TOOL_KINDS[activeTool] || activeTool === 'placeClassLabel';
    setLabelPrompt(isLabelTool);
    if (!isLabelTool) setLabelQueue([]);
    if (activeTool !== 'placeClassLabel') setPendingDirective(null);
  }, [activeTool]);
  // Right-toolbar drawing state: a drawn sheet awaiting its name/file, a sheet-pin
  // click awaiting its name, an image chosen and following the cursor.
  const [sheetDraw, setSheetDraw] = useState<{
    at: Vec2;
    size: { w: number; h: number };
    name: string;
    file: string;
  } | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the dialog is up, so a
  // closed one does not sit on the stack swallowing the key.
  useModalEscape(() => setSheetDraw(null), sheetDraw !== null);

  const [sheetPinDraw, setSheetPinDraw] = useState<{
    index: number;
    at: Vec2;
    side: SheetSide;
    name: string;
  } | null>(null);
  const [textBoxDraw, setTextBoxDraw] = useState<{
    start: Vec2;
    end: Vec2;
    text: string;
    editIndex?: number;
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
  const [tableProps, setTableProps] = useState<
    { kind: 'new'; table: SchTable } | { kind: 'edit'; index: number } | null
  >(null);
  // The image riding the cursor, built once when the file is chosen and
  // re-placed each frame (SCH_DRAWING_TOOLS::PlaceImage keeps one SCH_BITMAP
  // and moves it), so its identity — and the renderer's decode of it — survives.
  const [pendingImage, setPendingImage] = useState<SchImage | null>(null);
  // Keyboard-initiated grabbed move (SCH_MOVE_TOOL): M leaves connected wires
  // behind, G drags them along. A fresh nonce restarts the grab.
  /** DIALOG_TABLECELL_PROPERTIES: the cell ids it is editing. */
  const [cellPropsIds, setCellPropsIds] = useState<string[] | null>(null);
  // Assign Netclass: the patterns the selection produced, awaiting a class.
  const [netclassPatterns, setNetclassPatterns] = useState<string[] | null>(null);
  // SCH_MOVE_TOOL::Main's four modes. Break and Slice split the selected
  // segment first and then run exactly this drag, which is why they are a grab
  // kind rather than an edit of their own.
  const [grabRequest, setGrabRequest] = useState<{
    kind: 'move' | 'drag' | 'break' | 'slice';
    nonce: number;
  } | null>(null);
  // Right-click selection context menu (SCH_SELECTION_TOOL's TOOL_MENU):
  // client-space position plus the hit-tested item, or null when closed.
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    hit: ItemRef | null;
    /** Where the click landed, for SCH_POINT_EDITOR's Add / Remove Corner. */
    pointEdit?: { world: Vec2; handle: EditHandle | null; tolerance: number };
  } | null>(null);
  // Clarify Selection (SCH_SELECTION_TOOL::doSelectionMenu): an ambiguous
  // click lists every candidate; picking a row selects it.
  const [clarify, setClarify] = useState<{
    x: number;
    y: number;
    items: ItemRef[];
    additive: boolean;
  } | null>(null);
  // Editing an existing label's text/shape (DIALOG_LABEL_PROPERTIES).
  const [labelEdit, setLabelEdit] = useState<{
    index: number;
    kind: LabelKind;
    text: string;
    shape?: LabelShape;
  } | null>(null);
  // Editing a hierarchical sheet's name/file (DIALOG_SHEET_PROPERTIES).
  // Sheet Properties (DIALOG_SHEET_PROPERTIES); the dialog reads the sheet
  // itself out of the document, so only which one is open is state.
  const [sheetEdit, setSheetEdit] = useState<{ index: number } | null>(null);
  // Shape Properties (DIALOG_SHAPE_PROPERTIES). A graphic polyline lives in
  // `lines`, every other shape in `graphics`, so the target says which.
  const [shapeEdit, setShapeEdit] = useState<{ kind: 'graphic' | 'line'; index: number } | null>(
    null,
  );
  // Image Properties (DIALOG_IMAGE_PROPERTIES over PANEL_IMAGE_EDITOR).
  const [imageEdit, setImageEdit] = useState<{ index: number } | null>(null);
  // Field Properties (DIALOG_FIELD_PROPERTIES): which symbol, which field.
  const [fieldEdit, setFieldEdit] = useState<{ symbol: number; index: number } | null>(null);
  // Sheet Pin Properties (DIALOG_SHEET_PIN_PROPERTIES).
  const [sheetPinEdit, setSheetPinEdit] = useState<SheetPinRef | null>(null);
  // Unfold from Bus leaves the wire tool drawing away from the new entry
  // (SCH_LINE_WIRE_BUS_TOOL continues into its drawing loop).
  const [wireStartRequest, setWireStartRequest] = useState<{ at: Vec2; nonce: number } | null>(
    null,
  );
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
  const [lineEdit, setLineEdit] = useState<{
    index: number;
    widthIU: number;
    style: string;
    color?: ItemColor;
  } | null>(null);
  // A bus entry opens the same DIALOG_WIRE_BUS_PROPERTIES a wire does: upstream
  // groups SCH_BUS_WIRE_ENTRY_T with SCH_LINE_T and SCH_JUNCTION_T in
  // SCH_EDIT_TOOL::Properties.
  const [busEntryEdit, setBusEntryEdit] = useState<{
    index: number;
    widthIU: number;
    style: string;
    color?: ItemColor;
  } | null>(null);
  const [junctionEdit, setJunctionEdit] = useState<{
    index: number;
    diameterIU: number;
    color?: ItemColor;
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
  const dockPosRef = useRef<SchDockPos>(schDockPosFrom(settings.eeschema.window.left_dock_pos));
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
    const stored = settings.eeschema.window.left_dock_pos;
    if (SCH_LEFT_PANE_ADD_ORDER.every((pane) => stored[pane] === next[pane])) return;
    settings.updateEeschema((s) => {
      s.window.left_dock_pos = { ...next };
    });
  });
  const startLeftDockResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftDockWidth;
    const onMove = (ev: MouseEvent): void =>
      setLeftDockWidth(Math.min(800, Math.max(240, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };
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
  const common = useCommonSettings();
  const es = useEeschemaSettings();
  /**
   * `EDA_BASE_FRAME::RecreateToolbars` (`common/eda_base_frame.cpp:1728-1843`):
   * the frame asks `GetToolbarConfig( loc, m_CustomToolbars )` for each bar and
   * never reads `DefaultToolbarConfig` itself, which is what lets Preferences >
   * Toolbars change what is drawn.
   */
  const schTopBar = useToolbarEntries('eeschema', 'TOP_MAIN', SCH_DEFAULT_TOOLBARS);
  const schLeftBar = useToolbarEntries('eeschema', 'LEFT', SCH_DEFAULT_TOOLBARS);
  const schRightBar = useToolbarEntries('eeschema', 'RIGHT', SCH_DEFAULT_TOOLBARS);
  const theme = useSchematicTheme();

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
  // Status-bar relative coordinates: dx/dy/dist measure from this origin,
  // which Space resets to the cursor (ACTIONS::resetLocalCoords;
  // COMMON_TOOLS::ResetLocalCoords sets SCH_SCREEN::m_LocalOrigin).
  const [localOrigin, setLocalOrigin] = useState<Vec2>({ x: 0, y: 0 });
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
    const grid = settings.eeschema.window.grid;
    gridFeedback(hotkeyPopup, {
      hotkeyFeedback: settings.common.input.hotkey_feedback,
      grids: grid.sizes,
      lastSizeIdx: grid.last_size_idx,
      units,
      iuPerMM: SCH_IU_PER_MM,
    });
  };
  const statusReadout = useStatusReadout({
    units,
    localOrigin,
    devicePixelRatio: dpr,
    iuPerMM: SCH_IU_PER_MM,
  });
  const onCursorMove = useCallback(
    (world: Vec2 | null, snapped: Vec2 | null) => {
      cursorRef.current = world;
      // SCH_BASE_FRAME::UpdateStatusBar reads GetViewControls()->GetCursorPosition(),
      // which is the *snapped* cursor, so the coordinate panes are always on the
      // grid. Ours showed the raw pointer position, which is why the readout sat
      // on values like 110.0250 on a 1.27 mm grid.
      statusReadout.setCursor(snapped ?? world);
    },
    [statusReadout],
  );
  const onScaleChange = useCallback(
    (s: number) => {
      statusReadout.setScale(s);
    },
    [statusReadout],
  );
  // The symbol whose properties dialog is open (its refId), or null.
  const [propsTarget, setPropsTarget] = useState<string | null>(null);
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
  const [ercFocusedMarker, setErcFocusedMarker] = useState<string | null>(null);
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
  // (net colours, netclass widths, chains) keys off `connDoc` so it stays
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
  // This run's potential chains (RebuildNetChains) and the committed chains
  // restored against them, shared by netclass resolution, the highlight
  // actions and the Create Net Chain dialog.
  const potentialChains = useMemo(
    () => (connDoc && netlist ? detectNetChains(connDoc, libById, netlist) : []),
    [connDoc, libById, netlist],
  );
  const committedChains = useMemo(() => {
    if (!connDoc) return [];
    return netlist
      ? restoreCommittedNetChains(
          connDoc,
          libById,
          netlist,
          potentialChains,
          readNetChains(connDoc),
        )
      : readNetChains(connDoc);
  }, [connDoc, libById, netlist, potentialChains]);

  // SetHighlightedNetChain (SCHEMATIC::m_highlightedNetChain): exclusive with
  // the plain net highlight, like upstream.
  const [highlightedChain, setHighlightedChain] = useState<string | null>(null);
  const { highlightWires, highlightName } = useMemo(() => {
    const items = new Set<string>();
    let name: string | null = null;
    if (netlist && highlightedChain !== null) {
      // A highlighted chain brightens every member net's items
      // (UpdateNetHighlighting walks the chain's nets).
      const chain = committedChains.find((c) => c.name === highlightedChain);
      if (chain) {
        name = chain.name;
        for (const netName of chain.nets) {
          const net = netlist.nets.find((n) => n.name === netName);
          if (net) for (const item of net.items) items.add(item);
        }
      }
    } else if (netlist && highlightItem !== null) {
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
  }, [netlist, highlightItem, highlightedChain, highlightBusMembers, committedChains]);

  // Cross-probe the highlight to the PCB editor. A highlighted chain probes its
  // first member net, the PCB side takes one net, as upstream notes when it
  // cross-probes a chain (sch_editor_control.cpp:1250).
  const crossProbeNet = useMemo(() => {
    if (highlightedChain !== null)
      return committedChains.find((c) => c.name === highlightedChain)?.nets[0] ?? null;
    return highlightName;
  }, [highlightedChain, highlightName, committedChains]);
  useEffect(() => {
    onCrossProbeNet?.(crossProbeNet);
  }, [crossProbeNet, onCrossProbeNet]);

  // Wire tint while a coloured chain is highlighted (painter chain block).
  const chainHighlight = useMemo(() => {
    if (!netlist || highlightedChain === null) return undefined;
    const chain = committedChains.find((c) => c.name === highlightedChain);
    if (!chain || chain.color === '') return undefined;
    const lineIds = new Set<string>();
    for (const netName of chain.nets) {
      const net = netlist.nets.find((n) => n.name === netName);
      if (net) for (const item of net.items) lineIds.add(item);
    }
    return { lineIds, color: chain.color };
  }, [netlist, highlightedChain, committedChains]);

  // The live document for stable callbacks (selection promotion needs groups).
  const docRef = useRef(doc);
  docRef.current = doc;
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

  // SCH_EDITOR_CONTROL::ClearHighlight, the net, the chain and the bus-member
  // mode all drop together (`~`, Esc, or a click on empty space).
  const clearHighlight = useCallback(() => {
    setHighlightItem(null);
    setHighlightedChain(null);
    setHighlightBusMembers(false);
  }, []);

  // Live values for the highlight callback, kept in refs so the canvas prop
  // stays stable across renders.
  const netlistRef = useRef(netlist);
  netlistRef.current = netlist;
  const chainsRef = useRef(committedChains);
  chainsRef.current = committedChains;
  // GetHighlightedConnection(): empty while a chain is highlighted, since the
  // two modes are exclusive upstream.
  const highlightConnRef = useRef<string | null>(null);
  highlightConnRef.current = highlightedChain !== null ? null : highlightName;

  // Highlight-Net tool, a port of eeschema's static highlightNet()
  // (sch_editor_control.cpp:1051). The selection is left alone: upstream's
  // highlight and selection are independent.
  const onHighlight = useCallback((id: string | null) => {
    // ERC_TESTER::TestDuplicateSheetNames guard: upstream refuses to highlight
    // at all while the current sheet has duplicate sub-sheet names.
    if (id !== null && docRef.current && hasDuplicateSheetNames(docRef.current)) {
      setError('Error: duplicate sub-sheet names found in current sheet.');
      return;
    }
    const nl = netlistRef.current;
    const name = id !== null && nl ? connectionName(nl, id) : null;
    if (name === null) {
      // No connection under the cursor: clear the net *and* the chain highlight.
      setHighlightItem(null);
      setHighlightedChain(null);
      setHighlightBusMembers(false);
      return;
    }
    if (name !== highlightConnRef.current) {
      setHighlightBusMembers(false);
      setHighlightedChain(null);
      setHighlightItem(id);
      return;
    }
    // Same net re-invoked: expand to the chain that contains it, or fall back
    // to toggling the bus members in and out of the highlight.
    const chain = chainsRef.current.find((c) => c.nets.includes(name));
    if (chain) {
      setHighlightItem(null);
      setHighlightBusMembers(false);
      setHighlightedChain(chain.name);
    } else {
      setHighlightBusMembers((v) => !v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Box-selection result (KiCad SelectMultiple): plain drags replace the
  // selection, shift-drags add, ctrl+shift-drags subtract.
  const onSelectBox = useCallback(
    (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => {
      setSelection((prev) => {
        // Box/lasso results pass through the Selection Filter before promotion
        // (KiCad narrows the collector), so locked/disabled items never enter.
        const hit = promote(filterIds(ids));
        if (subtractive) {
          const next = new Set(prev);
          for (const id of hit) next.delete(id);
          return next;
        }
        if (additive) {
          const next = new Set(prev);
          for (const id of hit) next.add(id);
          return next;
        }
        return new Set(hit);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Right-click with the select tool (SCH_SELECTION_TOOL::Main,
  // sch_selection_tool.cpp:643-675). With nothing selected the item under the
  // cursor is picked up as a hover selection; with something selected the
  // selection is kept and the menu applies to it, *unless* the click has left
  // the selection's bounding box by more than a grid square and there is
  // something else there — "the user likely meant to get the context menu for
  // that item". Inside the box nothing is re-picked, which is what stops a
  // selected symbol's own fields and pins from stealing its menu.
  const onContextMenuRequest = useCallback(
    (
      x: number,
      y: number,
      hit: ItemRef | null,
      pointEdit: { world: Vec2; handle: EditHandle | null; tolerance: number },
    ) => {
      // Only an *unselected* item is picked up here, and what gets picked up is
      // a hover selection. Right-clicking something already selected leaves the
      // selection exactly as it was, hover flag included — which is what keeps
      // the point editor's handles on screen in that case and not in the other.
      const before = { selection: selectionRef.current, hover: hoverSelectionRef.current };
      // `!m_selection.GetBoundingBox().Inflate( grid.x, grid.y ).Contains( pos )`.
      // A selection with no extent at all has no box to be inside of, which is
      // upstream's empty `BOX2I` failing `Contains` for every point.
      const d = docRef.current;
      const box = d ? selectionBBox(d, before.selection, libByIdRef.current) : emptyBBox();
      const beyond =
        isEmpty(box) || !contains(inflate(box, gridSizeIURef.current), pointEdit.world);
      const after = rightClickSelection(
        before,
        hit?.id ?? null,
        (id) => promote(new Set([id])),
        beyond,
      );
      if (after !== before) {
        setSelection(after.selection);
        setHoverSelection(after.hover);
      }
      setCtxMenu({ x, y, hit, pointEdit });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
        controller.current?.candidatesAtCursor() ?? [],
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

  // Every edit runs through KiCad's post-commit cleanup (colinear wire merge),
  // as part of the same undoable step (SCHEMATIC::CleanUp / RecalculateConnections).
  const runCommand = useCallback(
    (cmd: EditCommand) => {
      setDoc((d) => (d ? history.current.execute(d, withCleanup(cmd, libById)) : d));
    },
    [libById],
  );

  const undo = useCallback(() => setDoc((d) => (d ? (history.current.undo(d) ?? d) : d)), []);
  const redo = useCallback(() => setDoc((d) => (d ? (history.current.redo(d) ?? d) : d)), []);

  // Resolve the open dialog's target symbol against the current document.
  const propsSymbol = useMemo(() => {
    if (!doc || propsTarget === null) return null;
    for (let i = 0; i < doc.symbols.length; i++) {
      const s = doc.symbols[i]!;
      if (refId('symbol', s.uuid, i) === propsTarget) return s;
    }
    return null;
  }, [doc, propsTarget]);

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

  // The chooser's "-- Already Placed --" group: every distinct library symbol
  // used anywhere in the hierarchy, filtered to the tool's power-symbol flavour
  // (sch_drawing_tools.cpp builds the same list before PickSymbolFromLibrary).
  const alreadyPlaced = useMemo<PickedSymbol[]>(() => {
    if (!chooserOpen) return [];
    const powerOnly = activeTool === 'placePower';
    const seen = new Set<string>();
    const out: PickedSymbol[] = [];
    for (const d of liveDocs().values()) {
      const libs = new Map(d.libSymbols.map((l) => [l.libId, l]));
      for (const s of d.symbols) {
        if (seen.has(s.libId)) continue;
        seen.add(s.libId);
        const lib = libs.get(schSymbolLibraryName(s));
        if (lib && lib.isPower === powerOnly) out.push({ libId: s.libId, unit: 1, fields: [] });
      }
    }
    return out;
  }, [chooserOpen, activeTool, liveDocs]);

  // Resolve a LIB_ID from the schematics' embedded library caches, so the
  // chooser groups show descriptions/units without refetching libraries.
  const getPlacedLibSymbol = useCallback(
    (libId: string): LibSymbol | undefined => {
      const own = libById.get(libId);
      if (own) return own;
      for (const d of liveDocs().values()) {
        const hit = d.libSymbols.find((l) => l.libId === libId);
        if (hit) return hit;
      }
      return undefined;
    },
    [libById, liveDocs],
  );

  const onChooserOk = useCallback(
    (result: SymbolChooserResult | null) => {
      // OK with nothing selected returns an invalid LIB_ID; the tool ignores
      // it and the chooser comes straight back (sch_drawing_tools.cpp).
      if (!result) return;
      const { symbol, unit, fields, keepSymbol, placeAllUnits } = result;

      // Field edits (the footprint override) land on the embedded library copy.
      let lib = symbol;
      for (const [key, value] of fields) {
        const properties = lib.properties.some((p) => p.key === key)
          ? lib.properties.map((p) => (p.key === key ? { ...p, value } : p))
          : [
              ...lib.properties,
              (() => {
                const field = {
                  key,
                  value,
                  angle: 0,
                  effects: { hidden: true, fontSize: [12700, 12700] as [number, number] },
                };
                return { ...field, source: buildPropertyNode(field) };
              })(),
            ];
        lib = { ...lib, properties };
      }

      const unitCount = new Set(lib.units.map((u) => u.unit).filter((u) => u > 0)).size || 1;
      placeFlags.current = { keepSymbol, placeAllUnits, unitCount };
      setPlaceUnit(unit > 0 ? unit : 1);

      // AddSymbolToHistory: most recent first, deduplicated by LIB_ID.
      const hist = activeTool === 'placePower' ? sPowerHistoryList : sSymbolHistoryList;
      const dup = hist.findIndex((h) => h.libId === symbol.libId);
      if (dup >= 0) hist.splice(dup, 1);
      hist.unshift({ libId: symbol.libId, unit: unit > 0 ? unit : 1, fields });

      setPlaceLib(lib);
    },
    [activeTool],
  );

  /**
   * The reference string a fresh placement of `lib` carries: its prefix with a
   * '?', or the number it was given if it was annotated on the way in. Matching
   * on it is what keeps two different multi-unit parts, which before annotation
   * both read "U?", from stepping over each other's units.
   */
  const referenceForPlacement = useCallback((lib: LibSymbol): string => {
    const prefix = lib.properties.find((p) => p.key === 'Reference')?.value ?? 'U';
    return /\?$/.test(prefix) ? prefix : `${prefix}?`;
  }, []);

  // After each placement: step to the next unit ("Place all units"), keep the
  // symbol attached ("Place repeated copies"), or clear it so the chooser
  // reopens, mirroring the continuation in SCH_DRAWING_TOOLS::PlaceSymbol.
  const onSymbolPlaced = useCallback(() => {
    // `placeOneOnly = symbol != nullptr`: a placement handed a ready-made symbol
    // drops exactly one and pops the tool, instead of continuing into the
    // chooser or the unit stepping (sch_drawing_tools.cpp).
    if (placeInstance) {
      setPlaceLib(null);
      setPlaceUnit(1);
      setActiveTool('select');
      return;
    }
    const { keepSymbol, placeAllUnits, unitCount } = placeFlags.current;
    if (placeAllUnits && unitCount > 1) {
      // The next unit that is not already on the sheet, not simply the next
      // number: upstream walks past the taken ones
      //
      //   while( unit <= unitCount && unitOccupied( unit ) ) unit++;
      //   if( unit > unitCount ) unit = 1;
      //
      // Incrementing blindly meant the count restarted whenever the chooser
      // reopened, so placing a 4001, closing the chooser and placing it again
      // put a second unit A on the sheet instead of moving on to B.
      const lib = placeLibRef.current;
      const d = docRef.current;
      const next =
        lib && d
          ? nextFreeUnit(d.symbols, referenceForPlacement(lib), lib.libId, unitCount, placeUnit + 1)
          : placeUnit + 1;
      if (next > 1) {
        setPlaceUnit(next);
        // `addSymbol` opens with `ACTIONS::selectionClear` before it selects the
        // symbol it is attaching (sch_drawing_tools.cpp:218-232), so the one just
        // dropped stops being the selection the moment a next one rides the
        // cursor. Only the path below, where nothing more attaches, leaves it lit.
        setSelection(new Set());
        return;
      }
      // Wrapped: every unit is placed. Upstream keeps cycling from 1 only when
      // the symbol is staying on the cursor.
      if (keepSymbol) {
        setPlaceUnit(1);
        // selectionClear, as above: another unit is going on the cursor.
        setSelection(new Set());
        return;
      }
    } else if (keepSymbol) {
      // selectionClear, as above: the same symbol stays on the cursor, so the
      // copy just dropped hands the selection over to it.
      setSelection(new Set());
      return; // same symbol stays on the cursor
    }
    setPlaceLib(null);
    setPlaceUnit(1);
    // ...and the chooser does NOT come straight back. After `commit.Push` the
    // tool sets `symbol = nextSymbol` (nullptr here) and falls to the bottom of
    // the loop; nothing opens the chooser there. It reopens only where it
    // opened the first time — inside the CLICK branch, under `if( !symbol )`
    // (sch_drawing_tools.cpp:371-375) — so KiCad leaves the tool armed with an
    // empty cursor and waits for you to click the sheet again.
    //
    // Ours derives `chooserOpen` from "tool active and nothing on the cursor",
    // which is true the instant the symbol is dropped, so the dialog flew back
    // up on its own. This is the same latch a Cancel uses; the canvas clears it
    // through `onRequestChooser` on the next click.
    setChooserDismissed(true);
  }, [placeUnit, placeInstance, setPlaceLib, referenceForPlacement]);

  /**
   * SCH_DRAWING_TOOLS::PlaceNextSymbolUnit: attach a copy of the symbol at
   * `symbolIndex`, switched to a unit the hierarchy is missing, to the cursor.
   * `unit` is the one the menu entry named; 0 means the lowest one missing.
   * Refusals go to the info bar with upstream's own wording.
   */
  const placeNextSymbolUnit = useCallback(
    (symbolIndex: number, unit = 0) => {
      if (!doc) return;
      const plan = planNextSymbolUnit(doc, symbolIndex, libById, unit, liveDocs().values());
      if (!plan.ok) {
        setInfoBar(plan.message);
        return;
      }
      const lib = libById.get(schSymbolLibraryName(doc.symbols[symbolIndex]!));
      if (!lib) return;
      placeFlags.current = { keepSymbol: false, placeAllUnits: false, unitCount: 1 };
      setPlaceUnit(plan.unit);
      setPlaceLibOnly(lib);
      setPlaceInstance(plan.symbol);
      setActiveTool('placeSymbol');
    },
    [doc, libById, liveDocs],
  );

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
      if (parentFile === currentFile) {
        runCommand(cmd);
      } else {
        // Edit the parent document via its own undo history (SCH_COMMIT on it).
        if (!histories.current.has(parentFile)) histories.current.set(parentFile, new History());
        project.current.docs.set(
          parentFile,
          histories.current.get(parentFile)!.execute(parentDoc, withCleanup(cmd, libById)),
        );
        onProjectChange?.([
          { name: parentFile, text: serializeSchematic(project.current.docs.get(parentFile)!) },
        ]);
        forcePageRefresh((n) => n + 1);
      }
    },
    [currentPath, currentFile, doc, flatSheets, liveDocs, runCommand, onProjectChange, libById],
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
  const [changeSymbolsMode, setChangeSymbolsMode] = useState<ChangeSymbolsMode | null>(null);
  /**
   * The symbol DIALOG_CHANGE_SYMBOLS was opened ON, which it seeds all three
   * match entries from — `m_symbol` is its second constructor argument and
   * `TransferDataToWindow` (:146-152) fills reference, value and library id
   * from it. Null when it is opened from the Tools menu, and then upstream
   * hides the "selected symbol(s)" radio outright.
   */
  const [changeSymbolsSubject, setChangeSymbolsSubject] = useState<
    ChangeSymbolsSubject | undefined
  >(undefined);
  /**
   * `m_symbol->GetRef()` / VALUE / `GetLibId().Format()`, plus IsSelected().
   *
   * Off `fields`, which is where a PLACEMENT keeps its Reference and Value.
   * `properties` is the LIBRARY symbol's list — reaching for it here found
   * nothing and seeded two empty boxes, and the parameter had been typed
   * loosely enough (`properties?:`) that tsc had nothing to object to. Taking
   * `SchSymbol` is what makes the wrong member a compile error.
   */
  const changeSymbolsSubjectOf = (sym: SchSymbol, selected: boolean): ChangeSymbolsSubject => ({
    reference: sym.fields.find((f) => f.key === 'Reference')?.value ?? '',
    value: sym.fields.find((f) => f.key === 'Value')?.value ?? '',
    libId: sym.libId,
    isSelected: selected,
  });
  const [changeSymbolsMessages, setChangeSymbolsMessages] = useState<
    readonly ChangeSymbolsMessage[]
  >([]);
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
  // Net-chain tools: the Create Net Chain dialog (ShowCreateNetChain) and the
  // Name Net Chain prompt (NameNetChain's wxGetTextFromUser).
  const [createChainOpen, setCreateChainOpen] = useState(false);
  const [chainRename, setChainRename] = useState<{ orig: string; name: string } | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the dialog is up, so a
  // closed one does not sit on the stack swallowing the key.
  useModalEscape(() => setChainRename(null), chainRename !== null);
  // Generate Bill of Materials (Symbol Fields Table export) dialog.
  const [bomOpen, setBomOpen] = useState(false);
  // Export Netlist (DIALOG_EXPORT_NETLIST) dialog.
  const [netlistOpen, setNetlistOpen] = useState(false);
  // Bulk Edit Symbol Fields (Symbol Fields Table edit view) dialog.
  const [fieldsTableOpen, setFieldsTableOpen] = useState(false);
  // DIALOG_RESOLVE_FIELD_CASE_CONFLICTS gates the fields table: two field names
  // differing only in case cannot both be a column, so the table will not open
  // until they are resolved. `pending` is the view it should open afterwards.
  const [caseConflicts, setCaseConflicts] = useState<{
    list: readonly FieldCaseConflict[];
    pending: 'edit' | 'bom';
  } | null>(null);
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
  }, [symLibTableOpen, hostedSymbolLibs.length]);

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
          if (!histories.current.has(file)) histories.current.set(file, new History());
          const updated = histories.current
            .get(file)!
            .execute(target, withCleanup(setPageSettingsCommand(merged), libById));
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
  // Committed-chain netclass overrides join the per-net resolution
  // (CONNECTION_GRAPH::ApplyNetChainNetclasses feeds NET_SETTINGS' chain
  // pattern assignments) so member nets draw with the chain's netclass.
  // Keyed on connDoc alongside the graph it resolves against, the ids in the
  // override maps are only meaningful for the document the netlist was built
  // from. An item added since simply has no override for a frame.
  const netOverrides = useMemo(
    () =>
      connDoc
        ? computeNetClassOverrides(connDoc, libById, setup, netlist, [
            ...chainPatternAssignments(committedChains),
            // Netclass directive labels assign to whatever net they sit on.
            ...directiveNetclassAssignments(connDoc, netlist),
            // ...and a rule area assigns to every net it encloses, from the
            // directives attached to its border. `GetNetclassesForDriver`
            // concatenates the two sources the same way.
            ...ruleAreaNetclassAssignments(connDoc, libById, netlist),
          ])
        : undefined,
    [connDoc, libById, setup, netlist, committedChains],
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
      const tracker = new RefDesTracker();
      tracker.deserialize(setup.usedDesignators);
      tracker.reuseRefDes = setup.annotation.allowReuse;
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
  const applySheetCommand = useCallback(
    (file: string, cmd: EditCommand, changed: PickedFile[]): void => {
      if (file === currentFile) {
        runCommand(cmd);
        return;
      }
      const target = project.current.docs.get(file);
      if (!target) return;
      if (!histories.current.has(file)) histories.current.set(file, new History());
      const next = histories.current.get(file)!.execute(target, withCleanup(cmd, libById));
      project.current.docs.set(file, next);
      try {
        changed.push({ name: file, text: serializeSchematic(next) });
      } catch {
        /* skip a bad sheet */
      }
    },
    [currentFile, runCommand, libById],
  );

  const applySheetSymbols = useCallback(
    (file: string, symbols: readonly SchSymbol[], label: string, changed: PickedFile[]): void => {
      const cmd = setSymbolsCommand(symbols, label);
      if (file === currentFile) {
        runCommand(cmd);
        return;
      }
      const target = project.current.docs.get(file);
      if (!target) return;
      if (!histories.current.has(file)) histories.current.set(file, new History());
      const next = histories.current.get(file)!.execute(target, withCleanup(cmd, libById));
      project.current.docs.set(file, next);
      try {
        changed.push({ name: file, text: serializeSchematic(next) });
      } catch {
        /* skip a bad sheet */
      }
    },
    [currentFile, runCommand, libById],
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
      const changedFiles: PickedFile[] = [];
      for (const sheet of sheets) {
        if (sheet.scope === 'out') continue;
        const symbols = incrementAnnotations(sheet.doc.symbols, {
          startRef: r.startRef,
          increment: r.increment,
        });
        if (symbols === sheet.doc.symbols) continue;
        applySheetSymbols(sheet.file, symbols, 'Increment Annotations', changedFiles);
      }
      if (changedFiles.length) onProjectChange?.(changedFiles);
    },
    [annotateSheets, applySheetSymbols, onProjectChange],
  );

  /** The same, for an edit that replaces a whole sheet document. */
  const applySheetDocument = useCallback(
    (file: string, next: Schematic, label: string, changed: PickedFile[]): void => {
      const cmd: EditCommand = {
        label,
        apply: () => next,
        invert: (before: Schematic) => ({
          label,
          apply: () => before,
          invert: (b: Schematic) => ({ label, apply: () => b, invert: () => cmd }),
        }),
      };
      if (file === currentFile) {
        runCommand(cmd);
        return;
      }
      const target = project.current.docs.get(file);
      if (!target) return;
      if (!histories.current.has(file)) histories.current.set(file, new History());
      const applied = histories.current.get(file)!.execute(target, cmd);
      project.current.docs.set(file, applied);
      try {
        changed.push({ name: file, text: serializeSchematic(applied) });
      } catch {
        /* skip a bad sheet */
      }
    },
    [currentFile, runCommand],
  );

  /** Open the fields table, unless its field names have to be resolved first. */
  const openFieldsTable = useCallback(
    (view: 'edit' | 'bom') => {
      const conflicts = doc ? detectFieldCaseConflicts(doc) : [];
      if (conflicts.length > 0) {
        setCaseConflicts({ list: conflicts, pending: view });
        return;
      }
      if (view === 'bom') setBomOpen(true);
      else setFieldsTableOpen(true);
    },
    [doc],
  );

  const applyCaseConflicts = useCallback(
    (actions: Map<string, FieldCaseAction>, separator: string) => {
      if (!doc || !caseConflicts) return;
      const cmd = resolveFieldCaseConflictsCommand(doc, caseConflicts.list, actions, separator);
      if (cmd) runCommand(cmd);
      const view = caseConflicts.pending;
      setCaseConflicts(null);
      // Resolving only the first two spellings of a name can leave a third, so
      // the table opens on the next pass rather than after this one.
      if (view === 'bom') setBomOpen(true);
      else setFieldsTableOpen(true);
    },
    [doc, caseConflicts, runCommand],
  );

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

  /** Every field name in use on this sheet, with the mandatory ones first —
   *  the dialog's checklist (DIALOG_CHANGE_SYMBOLS::updateFieldsList). */
  /**
   * `DIALOG_CHANGE_SYMBOLS::updateFieldsList`. Two things it does that this
   * did not:
   *
   * 1. It walks only the symbols the current match SELECTS —
   *    `if( !isMatch( symbol, &instance ) ) continue;` — and their library
   *    symbols. This walked every symbol and every `lib_symbols` entry in the
   *    document, so choosing "Update selected symbol(s)" on a screw terminal
   *    still offered `Sim.Device` and `Sim.Pins` because some diode elsewhere
   *    on the sheet had them. The dialog re-runs it whenever the match changes,
   *    which is why this is a function and not a memo.
   *
   * 2. `ki_keywords`, `ki_description` and `ki_fp_filters` are NOT fields. The
   *    parser consumes each into the symbol itself and returns nullptr —
   *    "Not a SCH_FIELD object yet" (sch_io_kicad_sexpr_parser.cpp:1169-1184) —
   *    so they can never appear in a field list.
   *
   * The five mandatory fields are always listed, `Description` included
   * (`SCH_FIELD::IsMandatory`, sch_field.cpp:1447-1452); it was missing.
   */
  const changeSymbolsFieldNames = useCallback(
    (match: SymbolMatch): readonly string[] => {
      const names = ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description'];
      const seen = new Set(names);
      /** Consumed by the parser into the symbol, never a field. */
      const NOT_A_FIELD = new Set(['ki_keywords', 'ki_description', 'ki_fp_filters']);
      const add = (key: string): void => {
        if (seen.has(key) || NOT_A_FIELD.has(key)) return;
        seen.add(key);
        names.push(key);
      };

      const text = (match.text ?? '').trim();
      const matches = (sym: SchSymbol, i: number): boolean => {
        switch (match.mode) {
          case 'all':
            return true;
          case 'selected':
            return selection.has(refId('symbol', sym.uuid, i));
          case 'reference':
            return (
              text === '' || (sym.fields.find((f) => f.key === 'Reference')?.value ?? '') === text
            );
          case 'value':
            return text === '' || (sym.fields.find((f) => f.key === 'Value')?.value ?? '') === text;
          case 'libId':
            return text === '' || sym.libId === text;
          default:
            return true;
        }
      };

      (doc?.symbols ?? []).forEach((sym, i) => {
        if (!matches(sym, i)) return;
        for (const f of sym.fields) add(f.key);
        // ...and the library symbol it came from.
        const lib = libById.get(schSymbolLibraryName(sym));
        for (const f of lib?.properties ?? []) add(f.key);
      });
      return names;
    },
    [doc, libById, selection],
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

  const editLibrarySymbolInEditor = useCallback(
    (id: string): void => openSymbolEditorOn(id, 'library'),
    [openSymbolEditorOn],
  );

  const editSymbolInEditor = useCallback(
    (id: string): void => openSymbolEditorOn(id, 'schematic'),
    [openSymbolEditorOn],
  );

  /**
   * DIALOG_SYMBOL_PROPERTIES' "Edit Symbol..." / "Edit Library Symbol...".
   * Upstream's dialog does not open anything itself: it ends quasi-modal with
   * a return code and SCH_EDIT_TOOL opens the editor
   * (`sch_edit_tool.cpp:2727-2760`). Ours closes the dialog and seeds the
   * editor, and the two buttons share this one handler so neither can drift
   * onto a different path than the other.
   */
  const symbolPropsHandoff = useCallback(
    (id: string, target: SymbolEditorTarget) => (): void => {
      setPropsTarget(null);
      openSymbolEditorOn(id, target);
    },
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

  // Change Symbols / Update Symbols from Library (DIALOG_CHANGE_SYMBOLS). The
  // dialog stays open on its report, as upstream's does.
  const runChangeSymbols = useCallback(
    async (o: ChangeSymbolsOptions) => {
      const sheets = annotateSheets('all', false);
      // The repair source is the LIBRARY, not the document's own cache.
      //
      // `DIALOG_CHANGE_SYMBOLS::processSymbols` resolves every lib_id through
      // the symbol library table (`SCH_SYMBOL::ResolveLibSymbol`), which is the
      // whole point of the command: the schematic's `lib_symbols` block is the
      // thing being brought back into line, so it cannot also be the thing that
      // says what "correct" is. Ours passed `hierarchyLibs`, whose first term
      // `libById` is built from `doc.libSymbols` -- the cache itself -- so
      // Update Symbols from Library compared each symbol against a copy of
      // itself and could only ever report "no changes".
      //
      // It showed up on a schematic written before placements were flattened
      // (fb9a40b1): its cached `Diode:1N4007` carries `extends` and no body,
      // the library has the real one, and the command that exists to repair
      // exactly that repaired nothing.
      const libs = await repairSourceLibs(
        sheets.flatMap((s) => s.doc.symbols.map((sym) => sym.libId)),
        loadSymbol,
        hierarchyLibs(sheets),
      );
      const changedFiles: PickedFile[] = [];
      const messages: ChangeSymbolsMessage[] = [];
      for (const sheet of sheets) {
        const r = changeSymbols(sheet.doc, libs, {
          ...o,
          match:
            o.match.mode === 'selected' && sheet.file === currentFile
              ? { ...o.match, selected: selection }
              : o.match.mode === 'selected'
                ? { ...o.match, selected: new Set<string>() }
                : o.match,
        });
        messages.push(...r.messages);
        if (r.doc === sheet.doc) continue;
        applySheetDocument(
          sheet.file,
          r.doc,
          o.mode === 'change' ? 'Change Symbols' : 'Update Symbols from Library',
          changedFiles,
        );
      }
      if (changedFiles.length) onProjectChange?.(changedFiles);
      setChangeSymbolsMessages(messages);
    },
    [annotateSheets, hierarchyLibs, applySheetDocument, currentFile, selection, onProjectChange],
  );

  // Edit Text & Graphics Properties (SCH_EDIT_TOOL::GlobalEdit). The sweep runs
  // over the whole hierarchy, as TransferDataFromWindow does — it walks every
  // sheet path, not just the one on screen.
  const runGlobalEdit = useCallback(
    (r: GlobalEditResult) => {
      const sheets = annotateSheets('all', false);
      const libs = hierarchyLibs(sheets);
      const changedFiles: PickedFile[] = [];
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
        applySheetDocument(sheet.file, next, 'Edit Text and Graphics', changedFiles);
      }
      if (changedFiles.length) onProjectChange?.(changedFiles);
    },
    [annotateSheets, hierarchyLibs, applySheetDocument, currentFile, selection, onProjectChange],
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

      const tracker = new RefDesTracker();
      tracker.deserialize(setup.usedDesignators);
      tracker.reuseRefDes = setup.annotation.allowReuse;

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

  /**
   * `SCH_DRAWING_TOOLS::PlaceSymbol` autoplaces the fields of the symbol it is
   * placing whenever `m_AutoplaceFields.enable` is set, which it is by default
   * (`eeschema_settings.cpp:328`), at both of its two placement points
   * (sch_drawing_tools.cpp:484-499).
   *
   * Without this the fields keep the positions the library gave them, and for
   * most parts that is not where KiCad shows them: Screw_Terminal_01x02 stores
   * its Reference at (0, 2.54) and its Value at (0, -5.08), above and below the
   * body, while KiCad draws both beside it because the autoplacer moved them
   * off the pins.
   *
   * `dropped` is upstream's screen argument. False is the null screen used
   * while the symbol is still on the cursor, and true is the real one, which
   * lets the algorithm see the rest of the sheet and avoid it.
   */
  const autoplacePlacement = useCallback(
    (sym: SchSymbol, lib: LibSymbol, dropped: boolean): SchSymbol => {
      const d = docRef.current;
      return autoplacePlacedSymbol(
        sym,
        lib,
        es.autoplace_fields.enable,
        {
          allowRejustify: es.autoplace_fields.allow_rejustify,
          alignToGrid: es.autoplace_fields.align_to_grid,
        },
        dropped && d ? { doc: d, libById, drawableArea: drawableArea(d) } : undefined,
      );
    },
    [
      es.autoplace_fields.enable,
      es.autoplace_fields.allow_rejustify,
      es.autoplace_fields.align_to_grid,
      libById,
    ],
  );

  // Annotate (SCH_EDIT_FRAME::AnnotateSymbols): one numbering pass across the
  // sheets in scope, then the report loop and CheckAnnotate's final control.
  // The REFDES_TRACKER is deserialized from schematic.used_designators, gated
  // by the project's reuse_designators, and persists back after the run.
  const runAnnotate = useCallback(
    (opts: AnnotateRun) => {
      const tracker = new RefDesTracker();
      tracker.deserialize(setup.usedDesignators);
      tracker.reuseRefDes = setup.annotation.allowReuse;

      const sheets = annotateSheets(opts.scope, opts.recursive);
      const libs = hierarchyLibs(sheets);
      const subRef = (unit: number): string =>
        subReference(unit, subpartSettings(setup.annotation), false);
      const updated = annotateHierarchy(sheets, libs, { ...opts, tracker }, selection);

      const changedFiles: PickedFile[] = [];
      const diffs: AnnotateDiff[] = [];
      for (const sheet of sheets) {
        const symbols = updated.get(sheet.file);
        if (!symbols) continue;
        applySheetSymbols(sheet.file, symbols, 'Annotate Schematic', changedFiles);
        diffs.push({ before: sheet.doc, after: { ...sheet.doc, symbols } });
      }
      if (changedFiles.length) onProjectChange?.(changedFiles);

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

      const usedDesignators = tracker.serialize();
      if (usedDesignators !== setup.usedDesignators) commitSetup({ ...setup, usedDesignators });
    },
    [
      annotateSheets,
      hierarchyLibs,
      applySheetSymbols,
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
      const changedFiles: PickedFile[] = [];
      const diffs: AnnotateDiff[] = [];
      for (const sheet of sheets) {
        if (sheet.scope === 'out') continue;
        const cmd = clearAnnotationCommand(
          sheet.scope === 'selected' ? 'selection' : 'all',
          selection,
        );
        const next = cmd.apply(sheet.doc);
        if (next === sheet.doc) continue;
        applySheetSymbols(sheet.file, next.symbols, 'Clear Annotation', changedFiles);
        diffs.push({ before: sheet.doc, after: next });
      }
      if (changedFiles.length) onProjectChange?.(changedFiles);
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
      onProjectChange,
      selection,
      setup.annotation,
    ],
  );

  // Drawing defaults shared by every output (screen, print, plot), derived
  // from Schematic Setup > Formatting the way SCH_RENDER_SETTINGS is seeded
  // from SCHEMATIC_SETTINGS upstream (eeschema_config.cpp).
  const drawingDefaults = useMemo(
    () => ({
      junctionDiameterIU: junctionDotDiameterIU(setup),
      dashLengthRatio: setup.formatting.dashLengthRatio,
      gapLengthRatio: setup.formatting.gapLengthRatio,
      // The panel stores percent (KiCad UI convention); the ratio is /100.
      textOffsetRatio: setup.formatting.labelOffsetRatio / 100,
      labelSizeRatio: setup.formatting.labelSizeRatio / 100,
      // Overbar offset is stored as the raw ratio (1.23), not percent.
      overbarHeightRatio: setup.formatting.overbarOffsetRatio,
      // 0 mils is meaningful: KiCad's per-pin text-size fallback.
      pinSymbolSizeIU: setup.formatting.pinSymbolSizeMils * IU_PER_MILS,
      // Wire hop-over arc radius (default line width × GetHopOverScale).
      hopOverRadiusIU: hopOverArcRadiusIU(setup),
      // Multi-unit reference notation (SCHEMATIC_SETTINGS::SubReference).
      subpart: subpartSettings(setup.annotation),
    }),
    [setup],
  );

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
          resolve: (t) => expandTextVars(t, resolver),
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
        resolve: (t) => expandTextVars(t, resolver),
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

  // Print (DIALOG_PRINT): render every sheet of the hierarchy, one page per
  // sheet instance in SCH_SHEET_LIST order, like SCH_PRINTOUT (sheet_count =
  // Root().CountSheets()), optionally with a different colour theme
  // (m_useColorTheme choice). NOTE: title-block page-number variables render
  // per file (the drawing-sheet resolver is not yet instance-aware).
  const printPages = useCallback(
    (opts: PlotOpts): { sch: Schematic; opts: PlotOpts }[] => {
      // Junction dots, dash ratios, label offsets and netclass visuals print
      // at their Schematic Setup values, like the screen.
      const o: PlotOpts = {
        ...opts,
        ...drawingDefaults,
        ...(netOverrides ? { netOverrides } : {}),
        ...(resolveTextVar ? { resolveTextVar } : {}),
        ...(intersheetRefs ? { intersheetRefs } : {}),
        ...(activeSheet ? { sheet: activeSheet } : {}),
      };
      const docs = liveDocs();
      const refs = sheetInstanceRefs;
      const pages = refs.flatMap((s, i) => {
        const sch = docs.get(s.file);
        if (!sch) return [];
        // Per-instance title-block context (SCH_PRINTOUT sets the printed
        // sheet's page number/count on the drawing-sheet painter).
        const pageOpts: PlotOpts = {
          ...o,
          pageNumber: pageNumberOf(s.path) || String(i + 1),
          sheetNumber: i + 1,
          sheetCount: refs.length,
          ...(s.path !== '/' ? { sheetName: s.name } : {}),
          sheetPath: s.namePath,
          ...((): Partial<PlotOpts> => {
            const r = intersheetRefsFor(i + 1);
            return r ? { intersheetRefs: r } : {};
          })(),
        };
        return [{ sch, opts: pageOpts }];
      });
      // No hierarchy yet (fresh document): print the on-screen sheet.
      return pages.length === 0 && doc ? [{ sch: doc, opts: o }] : pages;
    },
    [
      doc,
      activeSheet,
      drawingDefaults,
      netOverrides,
      resolveTextVar,
      liveDocs,
      sheetInstanceRefs,
      pageNumberOf,
      intersheetRefs,
      intersheetRefsFor,
    ],
  );

  const doPrint = useCallback(
    (opts: PlotOpts, themeId?: string) => {
      const printTheme =
        themeId && BUILTIN_THEMES[themeId] ? BUILTIN_THEMES[themeId]!.theme : theme;
      printSheets(printPages(opts), printTheme, outputBaseName());
      setPrintOpen(false);
    },
    [theme, outputBaseName, printPages],
  );

  // Print Preview (DIALOG_PRINT's Apply / OnPrintPreview): render into a new tab
  // without auto-printing, and keep the dialog open so options can be adjusted.
  const doPreview = useCallback(
    (opts: PlotOpts, themeId?: string) => {
      const printTheme =
        themeId && BUILTIN_THEMES[themeId] ? BUILTIN_THEMES[themeId]!.theme : theme;
      printSheets(printPages(opts), printTheme, outputBaseName(), true);
    },
    [theme, outputBaseName, printPages],
  );

  // Bulk Edit Symbol Fields: apply the changed cells per sheet, the current
  // sheet through the live undo history, other sheets through their own
  // histories (the same cross-document pattern as editPageNumber/ReplaceAll).
  const applyFieldsEdits = useCallback(
    (
      edits: FieldsEdits,
      opts: {
        persist?: boolean;
        /** The `${DNP}` / `${EXCLUDE_FROM_…}` columns, applied in the same step. */
        attrs?: ReadonlyMap<string, ReadonlyMap<string, SymbolAttrEdit>>;
      } = {},
    ) => {
      const changedFiles: PickedFile[] = [];
      const files = new Set([...edits.keys(), ...(opts.attrs?.keys() ?? [])]);
      for (const file of files) {
        const perSymbol = edits.get(file);
        const perSymbolAttrs = opts.attrs?.get(file);
        const cmds = [
          ...(perSymbol?.size ? [bulkEditFieldsCommand(perSymbol)] : []),
          ...(perSymbolAttrs?.size ? [bulkEditSymbolAttributesCommand(perSymbolAttrs)] : []),
        ];
        if (cmds.length === 0) continue;
        const cmd = cmds.length === 1 ? cmds[0]! : composeCommands('Edit Symbol Fields', cmds);
        if (file === currentFile) {
          runCommand(cmd);
          // "Apply, Save Schematic & Continue" (CVPCB) saves right away rather
          // than waiting for the debounced autosave, so the on-screen sheet is
          // serialized from the same command result runCommand just committed.
          const cur = docRef.current;
          if (opts.persist && cur) {
            try {
              changedFiles.push({
                name: file,
                text: serializeSchematic(withCleanup(cmd, libById).apply(cur)),
              });
            } catch {
              /* skip a bad sheet */
            }
          }
          continue;
        }
        const target = project.current.docs.get(file);
        if (!target) continue;
        if (!histories.current.has(file)) histories.current.set(file, new History());
        const next = histories.current.get(file)!.execute(target, withCleanup(cmd, libById));
        project.current.docs.set(file, next);
        try {
          changedFiles.push({ name: file, text: serializeSchematic(next) });
        } catch {
          /* skip a bad sheet */
        }
      }
      if (changedFiles.length) {
        onProjectChange?.(changedFiles);
        if (opts.persist) onPersistFiles?.(changedFiles);
      }
    },
    [currentFile, runCommand, onProjectChange, onPersistFiles, libById],
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
      openAfter,
      downloadCopy,
      report,
    }: PlotRequest) => {
      const plotTheme = themeId && BUILTIN_THEMES[themeId] ? BUILTIN_THEMES[themeId]!.theme : theme;
      const o: PlotOpts = {
        ...opts,
        ...drawingDefaults,
        ...(activeSheet ? { sheet: activeSheet } : {}),
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
        const od: PlotOpts = {
          ...o,
          ...(nov ? { netOverrides: nov } : {}),
          resolveTextVar: resolve,
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
                  author: resolve?.('AUTHOR') ?? '',
                  subject: resolve?.('SUBJECT') ?? '',
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
      if (allPages) {
        const sheets = [...liveDocs()];
        // SCH_PLOTTER::Plot: nothing to write is an error, not a silent no-op.
        if (sheets.length === 0) report('No sheets to plot.', RPT_SEVERITY_ERROR);
        else if (format === 'pdf') {
          // createPDFFile opens one file and pages through the sheet list, so a
          // hierarchy is one document rather than a file per sheet. Every other
          // format has no page after the first, which is why only this one is
          // gathered.
          void plotPdfSheets(
            sheets.map(([file, d]) => ({
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
    setHighlightedChain(null);
    setHighlightBusMembers(false);
    setPendingLabel(null);
    setActiveTool('select');
    setPlaceLib(null);
    setPlaceUnit(1);
    setPastePending(null);
    setPropsTarget(null);
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
      setLoading('Loading schematic...');
      await nextPaint();
      try {
        const next = { ...readSchematic(parse(text)), fileName: name ?? 'untitled.kicad_sch' };
        const file = name ?? 'untitled.kicad_sch';
        project.current = { docs: new Map([[file, next]]), root: file };
        histories.current = new Map([[file, new History()]]);
        history.current = histories.current.get(file)!;
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
        // Fit after React commits the new doc to the canvas.
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    },
    [resetTransient, resetErc],
  );

  // Open a whole KiCad project: parse every .kicad_sch, find the root (the
  // .kicad_pro's schematic, else the sheet nothing references), and show it.
  const loadProject = useCallback(
    async (files: PickedFile[], startFile?: string) => {
      setLoading('Loading schematic...');
      await nextPaint(); // paint the overlay before the (synchronous) sheet parse
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
          setLoading({
            message: `Loading schematic: ${base}`,
            detail: `${parsed + 1} of ${sheets.length} sheets`,
            value: parsed / sheets.length,
          });
          if (sheets.length > 1) await nextPaint();
          try {
            docs.set(base, { ...readSchematic(parse(f.text)), fileName: base });
          } catch (e) {
            problems.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
          }
          parsed++;
        }
        if (docs.size === 0) {
          setError(problems[0] ?? 'No .kicad_sch files in the selection');
          return;
        }
        const root = findRootFile(docs, proName);
        project.current = { docs, root };
        // Home-page tree clicks land on the clicked sheet, else the root.
        const startBase = startFile?.split('/').pop()?.split('\\').pop();
        const start = startBase && docs.has(startBase) ? startBase : root;
        const wantRoot = proName?.replace(/\.kicad_pro$/i, '.kicad_sch');
        if (wantRoot && !docs.has(wantRoot) && start === root)
          problems.push(
            `root schematic ${wantRoot} is not in the selection, opened ${root} instead`,
          );
        histories.current = new Map([[start, new History()]]);
        history.current = histories.current.get(start)!;
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
        requestAnimationFrame(() => controller.current?.zoomToFit());
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
    [resetTransient, resetErc, rootPro],
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
    const opening = openedKey.current !== key;
    openedKey.current = key;
    if (opening) {
      if (files && files.length > 0) void loadProject(files, initialFile ?? undefined);
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
  }, [projectMetaKey, rootPro, openNonce]);

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
    setPlaceUnit(1);
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
      if (!histories.current.has(file)) histories.current.set(file, new History());
      history.current = histories.current.get(file)!;
      setCurrentFile(file);
      setDoc(target);
      resetTransient();
      requestAnimationFrame(() => controller.current?.zoomToFit());
    },
    [doc, currentFile, resetTransient],
  );

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
      requestAnimationFrame(() => requestAnimationFrame(() => controller.current?.centerOn(m.pos)));
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
    if (!searchData.searchCurrentSheetOnly) {
      for (const [file, target] of project.current.docs) {
        if (file === currentFile) continue;
        if (!histories.current.has(file)) histories.current.set(file, new History());
        project.current.docs.set(
          file,
          histories.current
            .get(file)!
            .execute(target, withCleanup(replaceCommand(searchData), libById)),
        );
      }
    }
    runCommand(replaceCommand(searchData));
    findCursor.current = -1;
    lastMatch.current = null;
    setFindStatus('');
  }, [searchData, runCommand, currentFile, libById]);

  // KiCad's Properties action: symbols have a full properties dialog; a text box
  // reopens its text editor (double-click = edit).
  const onEditItem = useCallback(
    (id: string, kind: ItemRef['kind']) => {
      if (kind === 'symbol') setPropsTarget(id);
      // `Properties`' `case SCH_FIELD_T` (sch_edit_tool.cpp:2880-2890): a
      // field is an item in its own right, so double-clicking a symbol's
      // Reference / Value / Footprint / user field opens DIALOG_FIELD_
      // PROPERTIES for THAT field, not the whole symbol's dialog. The
      // hit-test already ranks the field's small text box over the body
      // (`collectAndGuess`), so this arm is what the click was picking out.
      if (kind === 'field' && doc) {
        const target = fieldEditTarget(doc, id);
        if (target) setFieldEdit(target);
      }
      if (kind === 'label' && doc) {
        const idx = doc.labels.findIndex((l, i) => refId('label', l.uuid, i) === id);
        if (idx !== -1) {
          const l = doc.labels[idx]!;
          setLabelEdit({ index: idx, kind: l.kind, text: l.text, shape: l.shape });
        }
      }
      if (kind === 'textbox' && doc) {
        const idx = doc.textBoxes.findIndex((tb, i) => refId('textbox', tb.uuid, i) === id);
        if (idx !== -1) {
          const tb = doc.textBoxes[idx]!;
          setTextBoxDraw({ start: tb.start, end: tb.end, text: tb.text, editIndex: idx });
        }
      }
      if (kind === 'table' && doc) {
        // `SCH_EDIT_TOOL::Properties` opens DIALOG_TABLE_PROPERTIES for a whole
        // table; a selected cell opens the cell dialog instead.
        const idx = doc.tables.findIndex((t, i) => refId('table', t.uuid, i) === id);
        if (idx !== -1) setTableProps({ kind: 'edit', index: idx });
      }
      // A netclass flag opens its Directive Label Properties.
      if (kind === 'directive' && doc) {
        const flags = doc.directiveLabels ?? [];
        const idx = flags.findIndex((d, i) => refId('directive', d.uuid, i) === id);
        if (idx !== -1) setDirectiveEdit({ index: idx });
      }
      // Double-clicking a sheet enters it (KiCad's Enter Sheet).
      if (kind === 'sheet' && doc) {
        const idx = doc.sheets.findIndex((sh, i) => refId('sheet', sh.uuid, i) === id);
        if (idx !== -1) {
          const sh = doc.sheets[idx]!;
          const file = sheetFile(sh);
          // Descend from the current instance path (KiCad's SCH_SHEET_PATH push).
          if (file) switchSheet(`${currentPath}${sh.uuid || `i${idx}`}/`, file);
        }
      }
    },
    [doc, currentPath, switchSheet],
  );

  // SCH_EDIT_TOOL::Properties, route a single item to its properties dialog:
  // symbols open the full symbol dialog, labels/text boxes/tables their
  // editors, wires/junctions/sheets their small dialogs. Shared by the E
  // hotkey and the selection context menu, like the upstream action.
  const openProperties = useCallback(
    (id: string) => {
      setDoc((d) => {
        if (!d) return d;
        // A field of a placed symbol: "<symbolRefId>:field<k>"
        // (DIALOG_FIELD_PROPERTIES, not the whole symbol's dialog).
        // A sheet's hierarchical pin (DIALOG_SHEET_PIN_PROPERTIES).
        const spRef = d ? parseSheetPinId(d, id) : null;
        if (spRef) {
          setSheetPinEdit(spRef);
          return d;
        }
        const field = fieldEditTarget(d, id);
        if (field) {
          setFieldEdit(field);
        } else if (d.symbols.some((s, i) => refId('symbol', s.uuid, i) === id)) setPropsTarget(id);
        else if (d.labels.some((l, i) => refId('label', l.uuid, i) === id)) onEditItem(id, 'label');
        else if (d.textBoxes.some((tb, i) => refId('textbox', tb.uuid, i) === id))
          onEditItem(id, 'textbox');
        else if (d.tables.some((t, i) => refId('table', t.uuid, i) === id)) onEditItem(id, 'table');
        else if (d.images.some((im, i) => refId('image', im.uuid, i) === id)) {
          const ii = d.images.findIndex((im, i) => refId('image', im.uuid, i) === id);
          setImageEdit({ index: ii });
        } else if (d.graphics.some((_, i) => refId('graphic', undefined, i) === id)) {
          const gi = d.graphics.findIndex((_, i) => refId('graphic', undefined, i) === id);
          // Free text has no border or fill to edit; it is a text item.
          if (d.graphics[gi]!.kind !== 'text') setShapeEdit({ kind: 'graphic', index: gi });
        } else if (d.lines.some((l, i) => refId('line', l.uuid, i) === id)) {
          const li = d.lines.findIndex((l, i) => refId('line', l.uuid, i) === id);
          const l = d.lines[li]!;
          // A wire or bus is a connection and gets DIALOG_WIRE_BUS_PROPERTIES;
          // a graphic polyline is a shape and gets DIALOG_SHAPE_PROPERTIES.
          if (l.kind === 'polyline') setShapeEdit({ kind: 'line', index: li });
          else
            setLineEdit({
              index: li,
              widthIU: l.stroke?.width ?? 0,
              style: l.stroke?.type ?? 'default',
              color: l.stroke?.color,
            });
        } else if (d.junctions.some((j, i) => refId('junction', j.uuid, i) === id)) {
          const ji = d.junctions.findIndex((j, i) => refId('junction', j.uuid, i) === id);
          setJunctionEdit({
            index: ji,
            diameterIU: d.junctions[ji]!.diameter,
            color: d.junctions[ji]!.color,
          });
        } else if (d.busEntries.some((b, i) => refId('busentry', b.uuid, i) === id)) {
          // Grouped with wires and junctions upstream; same stroke dialog.
          const bi = d.busEntries.findIndex((b, i) => refId('busentry', b.uuid, i) === id);
          const be = d.busEntries[bi]!;
          setBusEntryEdit({
            index: bi,
            widthIU: be.stroke?.width ?? 0,
            style: be.stroke?.type ?? 'default',
            color: be.stroke?.color,
          });
        } else if (
          (d.directiveLabels ?? []).some((dl, i) => refId('directive', dl.uuid, i) === id)
        ) {
          // Reachable by double-click already, but Properties never routed here.
          onEditItem(id, 'directive');
        } else {
          // Properties on a sheet opens its dialog (double-click enters it).
          const si = d.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === id);
          if (si !== -1) setSheetEdit({ index: si });
        }
        return d;
      });
    },
    [onEditItem],
  );

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
      if (hidden() || isTyping() || propsTarget !== null || selection.size === 0 || !doc) return;
      const text = copySelectionText(doc, selection);
      // Nothing the clipboard can carry: leave the system clipboard alone
      // rather than overwriting whatever is on it with an empty string.
      if (text === '') return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || propsTarget !== null || selection.size === 0 || !doc) return;
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
      if (hidden() || isTyping() || propsTarget !== null || !doc) return;
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
  }, [doc, selection, propsTarget, runCommand, pasteOptions]);

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

  // The paste was dropped: keep the pasted items selected, as KiCad does.
  const onPasteDone = useCallback((ids: ReadonlySet<string>) => {
    setPastePending(null);
    setSelection(new Set(ids));
  }, []);

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
        resolveTextVar: (name) => resolveTextVar?.(name),
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
        showAllErrors: settings.eeschema.erc_dialog.show_all_errors,
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
    [liveDocs, currentFile, busAliases, resolveTextVar],
  );

  /**
   * `SCH_EDIT_FRAME::InitSheet`: give a newly drawn sheet an empty screen so it
   * can be entered straight away.
   *
   *     SCH_SCREEN* newScreen = new SCH_SCREEN( &Schematic() );
   *     aSheet->SetScreen( newScreen );
   *     aSheet->GetScreen()->SetContentModified();
   *     aSheet->GetScreen()->SetFileName( aNewFilename );
   *
   * The file itself is only written on save — upstream never touches the disk
   * here, it just creates the screen in memory. Ours created the sheet symbol
   * and nothing behind it, so entering it reported the file as missing from the
   * project.
   *
   * A file the project already holds is left alone: pointing a second sheet at
   * an existing schematic is how a sub-sheet gets used twice.
   */
  const initSheetDocument = useCallback(
    (file: string) => {
      const name = file.trim();
      if (!name || project.current.docs.has(name)) return;
      const blank: Schematic = { ...readSchematic(parse(EMPTY_SCH)), fileName: name };
      // Only what the "Export to other sheets" ticks ask for follows the parent:
      //
      //     if( cfg->m_PageSettings.export_paper )
      //         newScreen->SetPageSettings( GetScreen()->GetPageSettings() );
      //     if( cfg->m_PageSettings.export_title )
      //         tb2.SetTitle( tb1.GetTitle() );
      //
      // Every one of those defaults to false, so out of the box a new sheet
      // gets its own empty title block, exactly as upstream does.
      const ex = settings.eeschema.page_settings;
      const parent = liveDocs().get(currentFile);
      const tb = parent?.titleBlock;
      project.current.docs.set(name, {
        ...blank,
        ...(ex.export_paper && parent?.paper ? { paper: parent.paper } : {}),
        ...(tb && blank.titleBlock
          ? {
              titleBlock: {
                ...blank.titleBlock,
                ...(ex.export_title && tb.title ? { title: tb.title } : {}),
                ...(ex.export_date && tb.date ? { date: tb.date } : {}),
                ...(ex.export_revision && tb.rev ? { rev: tb.rev } : {}),
                ...(ex.export_company && tb.company ? { company: tb.company } : {}),
              },
            }
          : {}),
      });
      histories.current.set(name, new History());
    },
    [currentFile, liveDocs],
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
    setErcFocusedMarker(null);
    setErcRunning(null);
  }, [doc, setup, ercOptions, ercRunning, liveDocs, flatSheets, currentFile, rawFiles]);

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
            requestAnimationFrame(() => controller.current?.centerOn(v.at)),
          );
        else controller.current?.centerOn(v.at);
      }
      if (itemId) {
        setErcFocusedMarker(null);
        // A marker's item may be a PIN (`<symId>:pin<k>`); the editor selects
        // its parent symbol, which is what upstream highlights too.
        setSelection(new Set([ercParentId(itemId)]));
      } else {
        setSelection(new Set());
        setErcFocusedMarker(ercExclusionKey(v));
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

  const lineMode: LineMode =
    es.drawing.line_mode === 0 ? 'free' : es.drawing.line_mode === 2 ? '45' : '90';

  // Display + input options handed to the canvas, straight from the settings
  // (Preferences > Display Options / Grids / Mouse and Touchpad).
  const renderOpts = useMemo<RenderOpts>(
    () => ({
      showHiddenPins: es.appearance.show_hidden_pins,
      showHiddenFields: es.appearance.show_hidden_fields,
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
      // ${VAR} expansion in labels/text/fields (GetShownText).
      ...(resolveTextVar ? { resolveTextVar } : {}),
      // ${INTERSHEET_REFS} on global labels (LAYER_INTERSHEET_REFS shown).
      ...(intersheetRefs ? { intersheetRefs } : {}),
      // Highlighted-chain wire tint (SetHighlightedNetChain + chain colour).
      ...(chainHighlight ? { chainHighlight } : {}),
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
      netOverrides,
      resolveTextVar,
      intersheetRefs,
      sheetInstanceRefs,
      currentPath,
      pageNumberOf,
      dpr,
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

  // ----- right-toolbar drawing callbacks ---------------------------------------
  const onSheetDrawn = useCallback((at: Vec2, size: { w: number; h: number }) => {
    setSheetDraw({ at, size, name: 'Sheet', file: 'sheet.kicad_sch' });
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
    setLabelQueue([]);
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

  const onSheetPinClick = useCallback(
    (index: number, at: Vec2, side: SheetSide) => {
      const d = doc;
      const sheet = d?.sheets[index];
      if (!d || !sheet) return;
      // Sync Sheet Pins armed a queue: place its head rather than importing the
      // next unmatched label. Upstream branches at exactly this point —
      //
      //     if( m_dialogSyncSheetPin && m_dialogSyncSheetPin->GetPlacementTemplate() )
      //         item = createNewSheetPinFromLabel( sheet, cursorPos, … );
      //     else
      //         SCH_HIERLABEL* label = importHierLabel( sheet );  // 'Place Sheet Pins'
      //
      // — the two tools sharing one placement loop.
      const placing = syncPlacementRef.current;
      const queued = placing?.kind === 'sheetPin' ? placing.queue[0] : undefined;
      const next = queued ?? nextImportableSheetPin(sheet, liveDocs().get(sheetFile(sheet)));
      if (!next) {
        setInfoBar('No new hierarchical labels found.');
        setActiveTool('select');
        return;
      }
      setInfoBar(null);
      lastSheetPin.current = { shape: next.shape };
      runCommand(replaceSheet(index, addSheetPin(sheet, next.text, at, side, next.shape)));
      if (!placing || !queued) return;
      // `EndPlaceItem` then `CanPlaceMore`: keep going, or put the tool away and
      // show the dialog again.
      const rest = advanceSyncPlacement(placing);
      setSyncPlacement(rest);
      if (!rest) endSyncPlacement();
    },
    [doc, liveDocs, runCommand, endSyncPlacement],
  );

  /** The active grid step, which the table's cell size is snapped to. */
  const gridSizeIU = useMemo(
    () => gridSizeToIU(es.window.grid.sizes[es.window.grid.last_size_idx]?.x ?? '50 mil'),
    [es.window.grid.sizes, es.window.grid.last_size_idx],
  );
  gridSizeIURef.current = gridSizeIU;

  const onTextBoxDrawn = useCallback((start: Vec2, end: Vec2) => {
    setTextBoxDraw({ start, end, text: '' });
  }, []);

  /**
   * The drag is finished: build the table it describes and show
   * DIALOG_TABLE_PROPERTIES over it.
   *
   *     table->Normalize();
   *     DIALOG_TABLE_PROPERTIES dlg( m_frame, table );
   *
   * The table is real from here on — the same one the preview has been showing
   * — it is simply not in the document until OK.
   */
  const onTableDrawn = useCallback(
    (start: Vec2, end: Vec2) => {
      const size = { x: end.x - start.x, y: end.y - start.y };
      setTableProps({
        kind: 'new',
        table: makeTableFromDrag(start, size, setup.formatting.defaultTextSizeMils * IU_PER_MILS, {
          x: gridSizeIU,
          y: gridSizeIU,
        }),
      });
    },
    [gridSizeIU, setup.formatting.defaultTextSizeMils],
  );

  /** The text box being edited, if the dialog was opened on an existing one. */
  const textBoxOrig =
    textBoxDraw?.editIndex !== undefined ? doc?.textBoxes[textBoxDraw.editIndex] : undefined;

  /**
   * DIALOG_TEXT_PROPERTIES for a text box: the text and formatting, plus the
   * border (a negative stroke width is KiCad's "no border") and the fill.
   */
  const commitTextBoxProperties = useCallback(
    (r: TextPropsResult) => {
      setTextBoxDraw((tbd) => {
        if (!tbd) return null;
        const effects: TextEffects = {
          hidden: false,
          face: r.face || undefined,
          bold: r.bold || undefined,
          italic: r.italic || undefined,
          fontSize: [r.sizeIU, r.sizeIU] as [number, number],
          justify: justifyTokens(r.hAlign, r.vAlign),
          ...(r.color ? { color: r.color } : {}),
        };
        const stroke: Stroke = {
          width: r.border ? (r.borderWidthIU ?? 0) : -1,
          type: r.borderStyle ?? 'default',
          ...(r.borderColor ? { color: r.borderColor } : {}),
        };
        const fill: Fill = r.filled
          ? { type: 'color', ...(r.fillColor ? { color: r.fillColor } : {}) }
          : { type: 'none' };
        if (tbd.editIndex !== undefined && doc) {
          const orig = doc.textBoxes[tbd.editIndex];
          if (orig) {
            runCommand(
              replaceTextBox(tbd.editIndex, {
                ...orig,
                text: r.text,
                angle: r.angle,
                excludedFromSim: r.excludeFromSim,
                hyperlink: r.hyperlink || undefined,
                effects,
                stroke,
                fill,
              }),
            );
          }
        } else {
          const box = makeTextBox(tbd.start, tbd.end, r.text, { effects, stroke, fill });
          runCommand(addItems({ textBoxes: [box] }));
          // Every drawing tool selects what it placed; a text box is drawn by
          // the same `EE_GRAPHIC_TOOL::DrawShape` path as the other shapes.
          if (docRef.current)
            setSelection(new Set([refId('textbox', box.uuid, docRef.current.textBoxes.length)]));
        }
        return null;
      });
    },
    [doc, runCommand],
  );

  /** DIALOG_LABEL_PROPERTIES for a sheet pin: name, shape and side. */
  const commitSheetPin = useCallback(
    (r: LabelPropsResult) => {
      setSheetPinDraw((spd) => {
        if (!spd || !doc) return null;
        const sheet = doc.sheets[spd.index];
        const name = r.texts[0]?.trim();
        if (!sheet || !name) return null;
        lastSheetPin.current = { shape: r.shape as LabelShape };
        // The orientation buttons choose which border the pin sits on.
        const side = SPIN_ANGLE[r.spin] as SheetSide;
        const withPin = addSheetPin(sheet, name, spd.at, side, r.shape as LabelShape);
        // The pin's own fields (SCH_SHEET_PIN is a SCH_LABEL_BASE), from the
        // grid; writeSheetPin appends the ones the file doesn't have yet.
        const fields = cleanLabelFields(r.fields) as SchField[];
        const next = fields.length
          ? {
              ...withPin,
              pins: withPin.pins.map((p, i) =>
                i === withPin.pins.length - 1 ? { ...p, fields } : p,
              ),
            }
          : withPin;
        runCommand(replaceSheet(spd.index, next));
        return null;
      });
    },
    [doc, runCommand],
  );

  /**
   * What the open table dialog starts from, either half of the two entry points,
   * plus the table's column widths — `sizeGridToTable` lays the cell grid out in
   * the table's own proportions.
   */
  const tablePropsInitial = useMemo(() => {
    if (!tableProps) return null;
    const t = tableProps.kind === 'new' ? tableProps.table : doc?.tables[tableProps.index];
    return t ? { values: collectSchTableValues(t), colWidths: t.colWidths } : null;
  }, [tableProps, doc]);

  /**
   * OK. A new table is added and selected, then the point editor takes over:
   *
   *     commit.Add( table, m_frame->GetScreen() );
   *     commit.Push( _( "Draw Table" ) );
   *     m_selectionTool->AddItemToSel( table );
   *     m_toolMgr->PostAction( ACTIONS::activatePointEditor );
   *
   * An existing one is just modified in place.
   */
  const commitTableProps = useCallback(
    (v: SchTableValues) => {
      setTableProps((tp) => {
        if (!tp) return null;
        if (tp.kind === 'edit') {
          runCommand(applySchTableValues(tp.index, v));
          return null;
        }
        const table = tableWithValues(tp.table, v);
        const at = docRef.current?.tables.length ?? 0;
        runCommand(addItems({ tables: [table] }));
        setSelection(new Set([refId('table', table.uuid, at)]));
        setActiveTool('select');
        return null;
      });
    },
    [runCommand],
  );

  /**
   * The dialog's result becomes the label(s) attached to the cursor, and the
   * last-used shape / formatting / orientation for the next one (KiCad's
   * m_last* members, saved right after the dialog closes in createNewLabel).
   */
  const startLabelPlacement = useCallback((kind: LabelKind, r: LabelPropsResult) => {
    lastLabel.current = {
      shape: r.shape as LabelShape,
      bold: r.bold,
      italic: r.italic,
      spin: r.spin,
      autoRotate: r.autoRotate,
      face: r.face,
    };
    const [first, ...rest] = r.texts;
    if (first === undefined) return;
    setPendingLabel({
      kind,
      text: first,
      shape: r.shape as LabelShape,
      bold: r.bold,
      italic: r.italic,
      fontSize: r.sizeIU,
      angle: SPIN_ANGLE[r.spin],
      autoRotate: r.autoRotate,
      ...(r.color ? { color: r.color } : {}),
      fields: r.fields,
    });
    setLabelQueue(rest);
    setLabelPrompt(false);
  }, []);

  /**
   * Free text from DIALOG_TEXT_PROPERTIES: attached to the cursor, and its
   * formatting kept for the next one (m_lastText* in createNewText).
   */
  const startTextPlacement = useCallback((r: TextPropsResult) => {
    lastLabel.current = { ...lastLabel.current, bold: r.bold, italic: r.italic };
    lastText.current = {
      hAlign: r.hAlign,
      vAlign: r.vAlign,
      angle: r.angle,
      excludeFromSim: r.excludeFromSim,
      face: r.face,
    };
    setPendingLabel({
      kind: 'text',
      text: r.text,
      shape: 'bidirectional',
      bold: r.bold,
      italic: r.italic,
      fontSize: r.sizeIU,
      angle: r.angle,
      justify: justifyTokens(r.hAlign, r.vAlign),
      excludeFromSim: r.excludeFromSim,
      ...(r.face ? { face: r.face } : {}),
      ...(r.hyperlink ? { hyperlink: r.hyperlink } : {}),
      ...(r.color ? { color: r.color } : {}),
    });
    setLabelPrompt(false);
  }, []);

  /**
   * The Directive Label dialog's result: the flag follows the cursor, and its
   * shape / pin length / orientation seed the next one (m_lastNetClassFlagShape).
   */
  /**
   * The netclass names the Netclass field cell offers, as
   * `FIELDS_GRID_TABLE::initGrid` builds them: the default class first, then
   * every class the project defines.
   *
   *     existingNetclasses.push_back( settings->GetDefaultNetclass()->GetName() );
   *     for( const auto& [name, netclass] : settings->GetNetclasses() )
   *         existingNetclasses.push_back( name );
   */
  const netclassNames = useMemo(
    () => [...new Set(setup.netClasses.classes.map((c) => c.name).filter(Boolean))],
    [setup.netClasses.classes],
  );

  const startDirectivePlacement = useCallback((r: LabelPropsResult) => {
    const shape = r.shape as DirectiveShape;
    lastDirective.current = { shape, pinLength: r.sizeIU, spin: r.spin };
    setPendingDirective({
      shape,
      pinLength: r.sizeIU,
      netclass: r.fields.find((f) => f.key === 'Netclass')?.value.trim() ?? '',
      angle: SPIN_ANGLE[r.spin],
      // Upstream places the very item the dialog edited, so every field it
      // holds travels with it; the netclass above is kept as well because the
      // netclass resolver reads it by name.
      fields: r.fields,
    });
    setLabelPrompt(false);
  }, []);

  /** Apply Directive Label Properties to the flag being edited. */
  const commitDirectiveProperties = useCallback(
    (r: LabelPropsResult) => {
      setDirectiveEdit((de) => {
        if (!de || !doc) return null;
        const orig = (doc.directiveLabels ?? [])[de.index];
        if (!orig) return null;
        const netclass = r.fields.find((f) => f.key === 'Netclass')?.value ?? '';
        runCommand(
          replaceDirectiveLabel(de.index, {
            ...orig,
            shape: r.shape as DirectiveShape,
            pinLength: r.sizeIU,
            angle: SPIN_ANGLE[r.spin],
            fields: orig.fields.map((f) => (f.key === 'Netclass' ? { ...f, value: netclass } : f)),
          }),
        );
        return null;
      });
    },
    [doc, runCommand],
  );

  /** Apply DIALOG_TEXT_PROPERTIES to the text item being edited. */
  const commitTextProperties = useCallback(
    (r: TextPropsResult) => {
      setLabelEdit((le) => {
        if (!le || !doc) return null;
        const orig = doc.labels[le.index];
        if (!orig) return null;
        const next: SchLabel = {
          ...orig,
          text: r.text,
          angle: r.angle,
          excludedFromSim: r.excludeFromSim,
          hyperlink: r.hyperlink || undefined,
          effects: {
            hidden: false,
            ...orig.effects,
            face: r.face || undefined,
            bold: r.bold || undefined,
            italic: r.italic || undefined,
            fontSize: [r.sizeIU, r.sizeIU] as [number, number],
            justify: justifyTokens(r.hAlign, r.vAlign),
            ...(r.color ? { color: r.color } : {}),
          },
        };
        runCommand(replaceLabel(le.index, next));
        return null;
      });
    },
    [doc, runCommand],
  );

  /**
   * A label tool was clicked with nothing attached. If the wire under the
   * click already carries a label-driven net, the new label takes that name
   * and no dialog is shown, createNewLabel's findWireLabelDriverName path.
   * Otherwise the properties dialog opens.
   */
  const onLabelPrompt = useCallback(
    (at: Vec2) => {
      const kind = LABEL_DIALOG_KINDS[activeTool];
      const name =
        kind && kind !== 'hierarchical_label' && doc ? wireLabelDriverName(doc, netlist, at) : '';
      if (kind && name) {
        setPendingLabel({
          kind,
          text: name,
          shape: lastLabel.current.shape,
          bold: lastLabel.current.bold,
          italic: lastLabel.current.italic,
          fontSize: setup.formatting.defaultTextSizeMils * IU_PER_MILS,
          angle: SPIN_ANGLE[lastLabel.current.spin],
          autoRotate: lastLabel.current.autoRotate,
        });
        return;
      }
      setLabelPrompt(true);
    },
    [activeTool, doc, netlist, setup.formatting.defaultTextSizeMils],
  );

  /**
   * Follow a text item's `(hyperlink …)`: "#<page>" switches to that sheet,
   * anything else is a URL, opened in a new tab (SCH_EDIT_FRAME's handling,
   * where the OS browser is launched instead).
   */
  const onFollowLink = useCallback(
    (link: string) => {
      if (link.startsWith('#')) {
        const page = link.slice(1);
        const target = flatSheets.find((ref) => pageNumberOf(ref.path) === page);
        if (target) switchSheet(target.path, target.file);
        else setInfoBar(`No sheet with page number "${page}".`);
        return;
      }
      if (/^https?:\/\//i.test(link)) window.open(link, '_blank', 'noopener,noreferrer');
      else setInfoBar(`Cannot open "${link}" from the browser.`);
    },
    [flatSheets, pageNumberOf, switchSheet],
  );

  /** A label was dropped: take the next of a multi-label run, else stop. */
  // What F1 repeats: the items the last placement produced
  // (SCH_EDIT_FRAME::GetRepeatItems).
  const repeatItemsRef = useRef<string[]>([]);
  const onLabelPlaced = useCallback(
    (id?: string) => {
      if (id) repeatItemsRef.current = [id];
      setPendingDirective(null);
      // Sync Sheet Pins armed a queue of templates. Each carries its own shape,
      // so it drives the pending label directly rather than through the plain
      // text queue the label dialog fills.
      const placing = syncPlacementRef.current;
      if (placing?.kind === 'hierLabel') {
        const rest = advanceSyncPlacement(placing);
        setSyncPlacement(rest);
        const next = rest?.queue[0];
        if (next) setPendingLabel((p) => (p ? { ...p, text: next.text, shape: next.shape } : p));
        else endSyncPlacement();
        return;
      }
      setLabelQueue((q) => {
        const [next, ...rest] = q;
        setPendingLabel((p) => (p && next !== undefined ? { ...p, text: next } : null));
        return rest;
      });
    },
    [endSyncPlacement],
  );

  /** Apply DIALOG_LABEL_PROPERTIES to the label being edited (Properties). */
  const commitLabelProperties = useCallback(
    (r: LabelPropsResult) => {
      setLabelEdit((le) => {
        if (!le || !doc) return null;
        const orig = doc.labels[le.index];
        if (!orig) return null;
        const effects: TextEffects = {
          hidden: false,
          ...orig.effects,
          face: r.face || undefined,
          bold: r.bold || undefined,
          italic: r.italic || undefined,
          fontSize: [r.sizeIU, r.sizeIU] as [number, number],
          ...(r.color ? { color: r.color } : {}),
        };
        const next: SchLabel = {
          ...orig,
          text: r.texts[0] ?? orig.text,
          ...(le.shape !== undefined ? { shape: r.shape as LabelShape } : {}),
          angle: SPIN_ANGLE[r.spin],
          effects,
        };
        runCommand(replaceLabel(le.index, setLabelFields(next, r.fields)));
        return null;
      });
    },
    [doc, runCommand],
  );

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

  const sheetPropsOf = useCallback(
    (sh: SchSheet, _index: number): SheetPropsResult => {
      const rootUuid = liveDocs().get(project.current.root)?.uuid;
      const chain = [...currentPath.split('/').filter(Boolean), sh.uuid ?? ''];
      const path = rootUuid && sh.uuid ? instanceKey(rootUuid, chain) : null;
      return {
        fields: sh.fields.map((f) => ({
          key: f.key,
          value: f.value,
          effects: f.effects ?? { hidden: false },
          nameShown: !!f.nameShown,
          ...(f.source ? { source: f.source } : {}),
        })),
        borderWidthIU: sh.stroke?.width ?? 0,
        ...(sh.stroke?.color ? { borderColor: sh.stroke.color } : {}),
        ...(sh.fillColor ? { backgroundColor: sh.fillColor } : {}),
        pageNumber: (path && sh.instances.find((i) => i.path === path)?.page) || '',
        excludeFromSim: !!sh.excludedFromSim,
        excludeFromBom: !sh.inBom,
        excludeFromBoard: !sh.onBoard,
        dnp: sh.dnp,
      };
    },
    [currentPath, liveDocs],
  );

  /**
   * SCH_SHEET_PATH::PathHumanReadable for the sheet being edited: the names of
   * the sheets from the root down to it, which is the path this sheet's
   * instance data is keyed under.
   */
  const sheetPathLabel = useCallback(
    (sh: SchSheet): string => {
      // namePath is the parent chain with a trailing slash ("/" at the root),
      // so appending this sheet's own name completes the readable path.
      const here = sheetInstanceRefs.find((r) => r.path === currentPath)?.namePath ?? '/';
      return `${here}${sheetName(sh)}`;
    },
    [sheetInstanceRefs, currentPath],
  );

  /**
   * Apply DIALOG_SHEET_PROPERTIES. The fields grid carries the sheet name and
   * file, since upstream those are just its two mandatory rows; everything else
   * writes into the sheet object, except the page number, which belongs to this
   * sheet's instance and goes through the same command editPageNumber uses.
   */
  /**
   * Apply DIALOG_SHEET_PROPERTIES. The fields grid carries the sheet name and
   * file, since upstream those are just its two mandatory rows; the rest writes
   * into the sheet object, except the page number, which belongs to this
   * sheet's instance record and goes through the command editPageNumber uses.
   */
  const commitSheetEdit = useCallback(
    (r: SheetPropsResult) => {
      setSheetEdit((se) => {
        if (!se || !doc) return null;
        const orig = doc.sheets[se.index];
        if (!orig) return null;

        // Each row keeps the source node of the field it came from, so fields
        // the dialog did not touch still round-trip byte-for-byte.
        const fields = r.fields.map((row) => {
          const prev = orig.fields.find((f) => f.key === row.key);
          return {
            ...(prev ?? {}),
            key: row.key,
            value: row.value,
            effects: row.effects,
            nameShown: row.nameShown,
          } as SchField;
        });

        const stroke: NonNullable<SchSheet['stroke']> = {
          ...(orig.stroke ?? { type: 'solid' }),
          width: r.borderWidthIU,
          ...(r.borderColor ? { color: r.borderColor } : {}),
        };
        if (!r.borderColor) delete (stroke as { color?: ItemColor }).color;

        const next: SchSheet = {
          ...orig,
          fields,
          stroke,
          // The file stores these inverted; the dialog asks the other way round.
          inBom: !r.excludeFromBom,
          onBoard: !r.excludeFromBoard,
          dnp: r.dnp,
          excludedFromSim: r.excludeFromSim,
          ...(r.backgroundColor ? { fillColor: r.backgroundColor } : {}),
        };
        if (!r.backgroundColor) delete (next as { fillColor?: ItemColor }).fillColor;

        // Pointing a sheet at a file the project does not hold yet is the same
        // "new sheet" case as drawing one: `InitSheet` gives it an empty screen
        // rather than failing to open it later.
        initSheetDocument(fields.find((f) => f.key === 'Sheetfile')?.value ?? '');

        const cmds: EditCommand[] = [replaceSheet(se.index, next)];
        const rootUuid = liveDocs().get(project.current.root)?.uuid;
        const chain = [...currentPath.split('/').filter(Boolean), orig.uuid ?? ''];
        if (rootUuid && orig.uuid) {
          const path = instanceKey(rootUuid, chain);
          const current = orig.instances.find((i) => i.path === path)?.page ?? '';
          if (r.pageNumber !== current)
            cmds.push(setSheetPageNumberCommand(se.index, path, r.pageNumber));
        }
        runCommand(composeCommands('Edit Sheet Properties', cmds));
        return null;
      });
    },
    [doc, runCommand, currentPath, liveDocs],
  );

  /** The shape being edited, whichever array it lives in. */
  const shapeEditItem = useCallback(
    (se: { kind: 'graphic' | 'line'; index: number }) =>
      se.kind === 'line' ? doc?.lines[se.index] : doc?.graphics[se.index],
    [doc],
  );

  /** KiCad titles the dialog after the shape ("Rectangle Properties"). */
  /**
   * The dialog's title is `_( "%s Properties" )` formatted with
   * `aShape->GetFriendlyName()` (dialog_shape_properties.cpp:44). That is
   * `EDA_ITEM::GetFriendlyName` → `GetTypeDesc()`, and every schematic shape is
   * one type: `.Map( SCH_SHAPE_T, _HKI( "Graphic" ) )` (eda_item.cpp:480).
   *
   * So it is "Graphic Properties" for a rectangle, a circle and an arc alike —
   * not "Rectangle Properties". This built the word from our own shape token.
   */
  const shapeEditName = useCallback(
    (_se: { kind: 'graphic' | 'line'; index: number }): string => 'Graphic',
    [],
  );

  /** The shape's border and fill as the dialog wants them. A stored width below
   *  zero is KiCad's "no border", which is what the Border checkbox reads. */
  const shapePropsOf = useCallback(
    (se: { kind: 'graphic' | 'line'; index: number }): ShapePropsResult => {
      const item = shapeEditItem(se);
      // Text is the one graphic with neither, and never opens this dialog.
      const styled = item && 'stroke' in item ? item : undefined;
      const stroke = styled?.stroke;
      const fill = styled && 'fill' in styled ? styled.fill : undefined;
      const width = stroke?.width ?? 0;
      return {
        border: width >= 0,
        borderWidthIU: Math.max(0, width),
        borderStyle: stroke?.type ?? 'default',
        ...(stroke?.color ? { borderColor: stroke.color } : {}),
        fillType: fill?.type ?? 'none',
        ...(fill?.color ? { fillColor: fill.color } : {}),
      };
    },
    [shapeEditItem],
  );

  const commitSheetPinEdit = useCallback(
    (r: SheetPinPropsResult) => {
      setSheetPinEdit((sp) => {
        if (!sp || !doc) return null;
        const orig = doc.sheets[sp.sheet]?.pins[sp.pin];
        if (orig)
          runCommand(
            replaceSheetPin(sp, { ...orig, name: r.name, shape: r.shape, effects: r.effects }),
          );
        return null;
      });
    },
    [doc, runCommand],
  );

  /**
   * DIALOG_FIELD_PROPERTIES reads and writes the field's position
   * symbol-relative, the way the symbol properties grid shows it
   * (TransferDataToWindow offsets each copy by -symbol position).
   */
  const fieldPropsOf = useCallback(
    (fe: { symbol: number; index: number }): FieldPropsResult | null => {
      const sym = doc?.symbols[fe.symbol];
      const f = sym?.fields[fe.index];
      if (!sym || !f) return null;
      return {
        key: f.key,
        value: f.value,
        at: f.at ? { x: f.at.x - sym.at.x, y: f.at.y - sym.at.y } : { x: 0, y: 0 },
        angle: f.angle,
        effects: f.effects ?? { hidden: false },
        nameShown: !!f.nameShown,
        doNotAutoplace: !!f.doNotAutoplace,
      };
    },
    [doc],
  );

  const commitFieldEdit = useCallback(
    (r: FieldPropsResult) => {
      setFieldEdit((fe) => {
        if (!fe || !doc) return null;
        const sym = doc.symbols[fe.symbol];
        const orig = sym?.fields[fe.index];
        if (!sym || !orig) return null;
        const next: SchField = {
          ...orig,
          key: r.key,
          value: r.value,
          // Back to absolute, the way the document stores it.
          at: { x: r.at.x + sym.at.x, y: r.at.y + sym.at.y },
          angle: r.angle,
          effects: r.effects,
          nameShown: r.nameShown,
          doNotAutoplace: r.doNotAutoplace,
        };
        const edited: SchSymbol = {
          ...sym,
          fields: sym.fields.map((f, i) => (i === fe.index ? next : f)),
        };
        // `editFieldText`'s tail (sch_edit_tool.cpp:2357-2365): with
        // `m_AutoplaceFields.enable` set, a parent whose fields the autoplacer
        // already owns has them re-placed, INSIDE the same commit — which is
        // why making a Value longer nudges the Reference along.
        const replaced = autoplaceAfterFieldEdit(
          edited,
          libById.get(schSymbolLibraryName(edited)),
          es.autoplace_fields.enable,
          {
            allowRejustify: es.autoplace_fields.allow_rejustify,
            alignToGrid: es.autoplace_fields.align_to_grid,
          },
          { doc, libById, drawableArea: drawableArea(doc) },
        );
        // `commit.Push( caption )`: the undo entry is named after the dialog,
        // not "Edit Symbol".
        runCommand(
          composeCommands(fieldEditCaption(orig.key), [replaceSymbol(fe.symbol, replaced)]),
        );
        // "if( !field->IsVisible() ) m_toolMgr->RunAction( ACTIONS::selectionClear )"
        // (sch_edit_tool.cpp:2886-2887): unticking Visible in the dialog leaves
        // the selection pointing at something no longer drawn, so it goes.
        if (next.effects?.hidden) setSelection(new Set());
        return null;
      });
    },
    [doc, runCommand, libById, es.autoplace_fields],
  );

  /** Apply DIALOG_IMAGE_PROPERTIES: position, scale, and the payload when
   *  Convert to Greyscale rewrote it. */
  const commitImageEdit = useCallback(
    (r: ImagePropsResult) => {
      setImageEdit((ie) => {
        if (!ie || !doc) return null;
        const orig = doc.images[ie.index];
        if (orig)
          runCommand(
            replaceImage(ie.index, {
              ...orig,
              at: r.at,
              scale: r.scale,
              ...(r.data !== undefined ? { data: r.data } : {}),
            }),
          );
        return null;
      });
    },
    [doc, runCommand],
  );

  /**
   * Apply DIALOG_SHAPE_PROPERTIES. Unchecking Border stores a width of -1,
   * KiCad's "no border at all", which is a different thing from 0 meaning "use
   * the schematic's default line width".
   */
  const commitShapeEdit = useCallback(
    (r: ShapePropsResult) => {
      setShapeEdit((se) => {
        if (!se || !doc) return null;
        const stroke: { width: number; type: string; color?: ItemColor } = {
          width: r.borderWidthIU,
          type: r.borderStyle,
          ...(r.borderColor ? { color: r.borderColor } : {}),
        };
        const fill =
          r.fillType === 'none'
            ? { type: 'none' }
            : { type: r.fillType, ...(r.fillColor ? { color: r.fillColor } : {}) };

        if (se.kind === 'line') {
          const orig = doc.lines[se.index];
          if (orig) runCommand(replaceLine(se.index, { ...orig, stroke }));
        } else {
          const orig = doc.graphics[se.index];
          // Text carries neither, and never reaches this dialog.
          if (orig && orig.kind !== 'text')
            runCommand(replaceGraphic(se.index, { ...orig, stroke, fill }));
        }
        return null;
      });
    },
    [doc, runCommand],
  );

  const commitBusEntryEdit = useCallback(
    (widthIU: number, style: string, color?: ItemColor) => {
      setBusEntryEdit((be) => {
        if (!be || !doc) return null;
        const orig = doc.busEntries[be.index];
        if (!orig) return null;
        const stroke: { width: number; type: string; color?: ItemColor } = {
          ...(orig.stroke ?? {}),
          width: widthIU,
          type: style,
        };
        if (color) stroke.color = color;
        else delete stroke.color;
        runCommand(replaceBusEntry(be.index, { ...orig, stroke }));
        return null;
      });
    },
    [doc, runCommand],
  );

  const commitLineEdit = useCallback(
    (widthIU: number, style: string, color?: ItemColor, junctionIU?: number) => {
      setLineEdit((le) => {
        if (!le || !doc) return null;
        const orig = doc.lines[le.index];
        if (!orig) return null;
        const stroke: { width: number; type: string; color?: ItemColor } = {
          ...(orig.stroke ?? {}),
          width: widthIU,
          type: style,
        };
        if (color) stroke.color = color;
        else delete stroke.color;

        const cmds: EditCommand[] = [replaceLine(le.index, { ...orig, stroke })];
        // The junction size applies to the junctions this wire actually meets,
        // which is what "the junctions in the selection scope" comes to here.
        if (junctionIU !== undefined) {
          const touches = (p: { x: number; y: number }): boolean =>
            (p.x === orig.start.x && p.y === orig.start.y) ||
            (p.x === orig.end.x && p.y === orig.end.y);
          doc.junctions.forEach((j, i) => {
            if (touches(j.at) && j.diameter !== junctionIU)
              cmds.push(replaceJunction(i, { ...j, diameter: junctionIU }));
          });
        }
        runCommand(
          cmds.length === 1 ? cmds[0]! : composeCommands('Edit Wire & Bus Properties', cmds),
        );
        return null;
      });
    },
    [doc, runCommand],
  );

  const commitJunctionEdit = useCallback(
    (diameterIU: number, color?: ItemColor) => {
      setJunctionEdit((je) => {
        if (!je || !doc) return null;
        const orig = doc.junctions[je.index];
        if (orig) {
          const next = { ...orig, diameter: diameterIU, color };
          if (!color) delete (next as { color?: ItemColor }).color;
          runCommand(replaceJunction(je.index, next));
        }
        return null;
      });
    },
    [doc, runCommand],
  );

  const onImagePlaced = useCallback(
    (at: Vec2) => {
      setPendingImage((img) => {
        if (img) runCommand(addItems({ images: [makeImage(at, img.data, img.scale, img.uuid)] }));
        return null;
      });
      setActiveTool('select');
    },
    [runCommand],
  );

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
      // ACTIONS::listHotKeys — Ctrl+F1 and Help > List Hotkeys.
      if (id === 'listHotkeys') {
        showHotkeyList();
        return;
      }
      if (id === 'assignNetclass') {
        assignNetclass();
        return;
      }
      // mirrorV = MirrorVertically (KiCad SYM_MIRROR_X); mirrorH = MirrorHorizontally (SYM_MIRROR_Y).
      const TX: Record<string, TransformOp> = {
        rotateCCW: 'rotateCCW',
        rotateCW: 'rotateCW',
        mirrorV: 'mirrorX',
        mirrorH: 'mirrorY',
      };
      if (id === 'zoomFit') controller.current?.zoomToFit();
      // Zoom to All Objects fits what is drawn, not the page (ACTIONS::zoomFitObjects).
      else if (id === 'zoomFitObjects') controller.current?.zoomToFit(true);
      else if (id === 'zoomIn') controller.current?.zoomIn();
      else if (id === 'zoomOut') controller.current?.zoomOut();
      else if (id === 'zoomRedraw') controller.current?.redraw();
      else if (id === 'zoomTool') activateTool('zoomTool');
      else if (id === 'zoomFitSelection') {
        // Zoom to Selected Objects. The extent comes from the one walk that
        // knows every item kind; this used to have its own, and it covered five
        // kinds of fifteen, so selecting a text box and zooming did nothing.
        const box = doc ? selectionBBox(doc, selection, libById) : emptyBBox();
        if (!isEmpty(box)) controller.current?.zoomToBox(box);
      } else if (id === 'undo') undo();
      else if (id === 'redo') redo();
      else if (id === 'open') promptOpen();
      else if (id === 'save') save();
      // SCH_ACTIONS::saveCurrSheetCopyAs
      else if (id === 'saveCurrSheetCopyAs') saveCurrSheetCopyAs();
      // ACTIONS::revert
      else if (id === 'revert') revert();
      else if (id === 'erc') setErcOpen(true);
      else if (id === 'manageSymbolLibraries') setSymLibTableOpen(true);
      // SCH_EDITOR_CONTROL::ShowCreateNetChain opens whatever is selected; a
      // symbol selection only pre-fills the dialog's from/to focus hint.
      else if (id === 'createNetChain') setCreateChainOpen(true);
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
      else if (id === 'group')
        setSelection((sel) => {
          if (sel.size >= 2) runCommand(groupItemsCommand(sel));
          return sel;
        });
      else if (id === 'ungroup')
        setSelection((sel) => {
          if (sel.size > 0) runCommand(ungroupItemsCommand(sel));
          return sel;
        });
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
      else if (id === 'openPreferences') setPrefsOpen(true);
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
      else if (id === 'editSymbolLibraryLinks') {
        setLibIdErrors([]);
        setLibIdsOpen(true);
      } else if (id === 'changeSymbols' || id === 'updateSymbolsFromLibrary') {
        setChangeSymbolsMessages([]);
        // From the Tools menu there is no `m_symbol`: nothing to seed, and the
        // "selected symbol(s)" radio is hidden.
        setChangeSymbolsSubject(undefined);
        setChangeSymbolsMode(id === 'changeSymbols' ? 'change' : 'update');
      } else if (id === 'schematicSetup') {
        // The Embedded Files page lists the sheet's embedded_files section
        // (names + embed-fonts flag) fresh from the document on every open,
        // read-only until the zstd blobs can be decoded, and the Net Chains
        // page shows the engine's detected (potential) chains
        // (CONNECTION_GRAPH::RebuildNetChains), each keeping its persisted
        // chain-class assignment.
        if (doc) {
          const emb = listEmbeddedFiles(doc);
          const detected = netlist ? detectNetChains(doc, libById, netlist) : [];
          setSetup((prev) => ({
            ...prev,
            embeddedFiles: {
              files: emb.files.map((f) => ({ name: f.name, reference: f.reference })),
              embedFonts: emb.embedFonts,
            },
            netChains: {
              ...prev.netChains,
              // The grid lists committed chains (PANEL_SETUP_NET_CHAINS::
              // loadFromModel): persisted (net_chain …) nodes restored against
              // this run's potentials (RebuildNetChains passes 2a/2b).
              chains: (netlist
                ? restoreCommittedNetChains(doc, libById, netlist, detected, readNetChains(doc))
                : readNetChains(doc)
              ).map((c) => ({
                origName: c.name,
                name: c.name,
                members: [...c.nets],
                chainClass: prev.netChains.classByChain[c.name] ?? '',
                netClass: c.netClass,
                color: c.color,
                from: c.from,
                to: c.to,
              })),
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
      else if (id === 'paste')
        void navigator.clipboard?.readText().then((text) => {
          setDoc((d) => {
            const payload = d ? parsePastedText(text, d, pasteOptions()) : null;
            if (payload) {
              setActiveTool('select');
              setPastePending(payload);
            }
            return d;
          });
        });
      // `SCH_EDIT_TOOL::DoDelete` (sch_edit_tool.cpp:2224-2235): the target is
      // `RequestSelection( DeletableItems )`, and the selection is cleared
      // unconditionally afterwards ("Don't leave a freed pointer in the
      // selection"), hover or not.
      else if (id === 'delete')
        withSelection(DeletableItems, (ids) => {
          const d = docRef.current;
          if (d) runCommand(deleteItems(d, ids));
          applySelectionState({ selection: new Set(), hover: null });
        });
      // `SCH_EDIT_TOOL::Rotate` / `::Mirror` (sch_edit_tool.cpp:967, :1297),
      // both over `RotatableItems`.
      else if (TX[id])
        withSelection(RotatableItems, (ids) => {
          const d = docRef.current;
          runCommand(
            transformItems(
              ids,
              TX[id]!,
              // No centre and no grid override: both keep their defaults, and
              // threading the window's live grid through is a separate change
              // (see `DEFAULT_GRID_IU`).
              undefined,
              undefined,
              // `if( m_frame->eeconfig()->m_AutoplaceFields.enable )` — the
              // block that keeps a rotated symbol's reference reading
              // horizontally (sch_edit_tool.cpp:1022-1029).
              {
                enable: es.autoplace_fields.enable,
                libById,
                opts: {
                  allowRejustify: es.autoplace_fields.allow_rejustify,
                  alignToGrid: es.autoplace_fields.align_to_grid,
                },
                ...(d ? { drawableArea: drawableArea(d) } : {}),
              },
            ),
          );
        });
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
    ],
  );

  // The selection context menu, assembled the way the upstream TOOL_MENU is:
  // each tool's Init() contributions in priority order, GROUP_TOOL's Grouping
  // submenu (100), SCH_MOVE_TOOL move/drag and enterSheet/leaveSheet (150),
  // SCH_EDIT_TOOL transforms + properties (200), wire placements (250), the
  // clipboard block (300), then selectAll/unselectAll (400).
  /** One entry point for the six row/column actions, which differ only by op. */
  const runRowCol = useCallback(
    (op: RowColOp): void => {
      const d = docRef.current;
      if (!d) return;
      const cmd = rowColCommand(d, selection, op);
      if (!cmd) return;
      runCommand(cmd);
      // The ids shift when rows or columns move, and a stale cell id would
      // address a different cell. Clearing is what upstream's SelectedEvent
      // amounts to here.
      setSelection(new Set());
    },
    [selection, runCommand],
  );

  const buildContextMenu = (): MenuItem[] => {
    const hit = ctxMenu?.hit ?? null;
    const act = (label: string, id: string, shortcut?: string): MenuItem => ({
      label,
      icon: id,
      shortcut,
      action: () => onTopAction(id),
    });
    const tool = (label: string, id: string, shortcut?: string): MenuItem => ({
      label,
      icon: id,
      shortcut,
      action: () => onToolSelect(id),
    });
    // KiCad does not build this menu in reading order: every entry is filed
    // under a rank (`CONDITIONAL_MENU::AddItem`'s last argument) and the menu is
    // the ranks concatenated, with the separators declared as entries of their
    // own. `addEntry` inserts after everything of the same rank, so within a
    // rank the order is the order the *tools* registered in — selection tool,
    // then edit tool, then move tool, then group tool.
    //
    // Ranks used below, with where they come from:
    //     1   symbol unit / body style menus      sch_edit_tool.cpp
    //     2   Select/Expand Connection            sch_selection_tool.cpp
    //    50   point-editor corners                sch_point_editor.cpp (ANY_ORDER)
    //   100   Draw Wires / Draw Buses             sch_selection_tool.cpp
    //   101   Grouping, Align, Table, Unfold      group_tool.cpp / align / table
    //   150   Enter/Leave Sheet, Move, Drag       sch_selection_tool / sch_move_tool
    //   200   Transform, Attributes, Properties…  sch_edit_tool.cpp
    //   250   sheet pins, labels, netclass, Lock  sch_selection_tool / sch_edit_tool
    //   300   the clipboard block                 sch_edit_tool.cpp
    //   400   net chain menu                      sch_selection_tool.cpp
    //   401   Select All / Unselect All           sch_edit_tool.cpp
    //  1000   Zoom / Grid                         AddStandardSubMenus
    //
    // Ranks 100 and 101 are one rank upstream; they are split here because the
    // second `AddSeparator( 100 )` falls between them, and that separator is
    // the line under Draw Buses.
    //
    // The fractions are not upstream ranks. Within one rank KiCad's order is
    // the order the *tools* registered, and a port that adds its entries in
    // source order gets that wrong in a way only a side-by-side screenshot
    // shows. The fraction pins each entry to the line it holds upstream:
    //
    //   150.1‥.3  enterSheet, selectOnPCB, leaveSheet   sch_selection_tool:716
    //   150.4‥.6  move, drag, alignToGrid               sch_move_tool:202
    //   200.1‥.9  transform, attributes, swap,          sch_edit_tool:902
    //             properties, editFields, autoplace,
    //             editWithLibEdit, change/update, convertTo
    //   250.0‥.5  labels, break/slice, sheet pins,      sch_selection_tool:721
    //             netclass, page number, then the
    //             edit tool's cleanup and lock entries
    const entries: RankedItem[] = [];
    const add = (order: number, ...list: MenuItem[]): void => {
      for (const item of list) entries.push({ order, item });
    };
    if (selection.size > 0) {
      // GROUP_CONTEXT_MENU: all four items always shown, greyed per condition
      // (GROUP_TOOL::update Enable()). Labels are the actions' FriendlyNames.
      add(101, {
        label: 'Grouping',
        items: [
          { ...act('Group Items', 'group'), disabled: selection.size < 2 },
          {
            ...act('Ungroup Items', 'ungroup'),
            disabled: !(doc && selectionHasGroup(doc, selection)),
          },
          { ...act('Add Items', 'addToGroup'), disabled: !(doc && canAddToGroup(doc, selection)) },
          {
            ...act('Remove Items', 'removeFromGroup'),
            disabled: !(doc && canRemoveFromGroup(doc, selection)),
          },
        ],
      });
      // Locking (SCH_SELECTION_TOOL makeLockMenu), only symbols lock.
      const selSymbols =
        doc?.symbols.filter((s, i) => selection.has(refId('symbol', s.uuid, i))) ?? [];
      if (selSymbols.length > 0) {
        const anyUnlocked = selSymbols.some((s) => !s.locked);
        const anyLocked = selSymbols.some((s) => s.locked);
        const lockItems: MenuItem[] = [];
        if (anyUnlocked) lockItems.push(act('Lock', 'lock'));
        if (anyLocked) lockItems.push(act('Unlock', 'unlock'));
        lockItems.push(act('Toggle Lock', 'toggleLock'));
        add(250.5, { label: 'Locking', items: lockItems });
      }
      add(
        150.4,
        {
          label: 'Move',
          icon: 'move',
          shortcut: 'M',
          action: () => setGrabRequest((p) => ({ kind: 'move', nonce: (p?.nonce ?? 0) + 1 })),
        },
        {
          label: 'Drag',
          icon: 'drag',
          shortcut: 'G',
          action: () => setGrabRequest((p) => ({ kind: 'drag', nonce: (p?.nonce ?? 0) + 1 })),
        },
      );
      // SCH_ACTIONS::selectOnPCB, gated on `crossProbingSelection` — the kinds
      // that name something on the board (symbols, pins, sheets). A selection
      // of wires or labels has nothing to send, so the entry is absent.
      if (doc && onSelectOnPcb) {
        const parts = syncSelectionParts(doc, selection, currentPath, libById);
        if (parts.length > 0)
          add(150.2, {
            label: 'Select on PCB',
            action: () => onSelectOnPcb(parts),
          });
      }
      if (netlist && selectedNets(netlist, selection).length > 0)
        add(250.3, {
          label: 'Assign Netclass...',
          icon: 'assignNetclass',
          action: assignNetclass,
        });
      // SCH_ACTIONS::breakWire / ::slice, both offered whenever a line is
      // selected (SCH_SELECTION_TOOL's `linesSelection` condition). Break
      // divides into connected segments, Slice into unconnected ones.
      if (doc && [...selection].some((id) => id.startsWith('line:')))
        add(
          250.1,
          {
            label: 'Break',
            icon: 'break',
            action: () => setGrabRequest((p) => ({ kind: 'break', nonce: (p?.nonce ?? 0) + 1 })),
          },
          {
            label: 'Slice',
            icon: 'slice',
            action: () => setGrabRequest((p) => ({ kind: 'slice', nonce: (p?.nonce ?? 0) + 1 })),
          },
        );
      if (hit?.kind === 'sheet') {
        add(150.1, {
          label: 'Enter Sheet',
          icon: 'enterSheet',
          action: () => onEditItem(hit.id, 'sheet'),
        });
        // SCH_ACTIONS::placeSheetPin, the first of the sheet block at rank 250.
        add(250.2, tool('Place Pins from Sheet', 'sheetPin'));
        add(
          250.2,
          // SCH_ACTIONS::autoplaceAllSheetPins: a pin for every hierarchical
          // label inside the sheet that has none yet.
          {
            label: 'Autoplace All Sheet Pins',
            icon: 'autoplaceAllSheetPins',
            action: () => {
              if (!doc) return;
              const si = doc.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === hit.id);
              const sh = doc.sheets[si];
              if (!sh) return;
              const file = sh.fields.find((f) => f.key === 'Sheetfile')?.value ?? '';
              const child = liveDocs().get(file);
              if (!child) return;
              const cmd = autoplaceAllSheetPins(
                doc,
                si,
                hierarchicalLabels(child),
                es.drawing.default_text_size
                  ? mmToIU(es.drawing.default_text_size * 0.0254)
                  : 12700,
              );
              if (cmd) runCommand(cmd);
            },
          },
          // SCH_ACTIONS::syncSheetPins ("Sync Selected Sheet Pins..."), the
          // one-sheet form of the toolbar's Sync All.
          {
            label: 'Sync Selected Sheet Pins...',
            icon: 'syncSheetPins',
            action: () => onTopAction('syncSheetPins'),
          },
        );
        // SCH_ACTIONS::editPageNumber, whose condition here is
        // `schEditSheetPageNumberCondition` — at most one sheet selected. Last
        // of the selection tool's rank-250 block, after the sheet-pin actions.
        add(250.4, {
          label: 'Edit Sheet Page Number...',
          icon: 'editPageNumber',
          action: () => {
            if (!doc) return;
            const si = doc.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === hit.id);
            const sh = doc.sheets[si];
            if (!sh?.uuid) return;
            const rootUuid = liveDocs().get(project.current.root)?.uuid;
            const chain = [...currentPath.split('/').filter(Boolean), sh.uuid];
            const key = rootUuid ? instanceKey(rootUuid, chain) : '';
            setPageEdit({
              page: sh.instances.find((i) => i.path === key)?.page ?? '',
              sheet: { index: si, uuid: sh.uuid },
            });
          },
        });
        // SCH_ACTIONS::cleanupSheetPins is the one sheet entry with a condition
        // of its own (`sheetHasUndefinedPins`): it is offered only when the
        // sheet actually carries a pin that no longer names a hierarchical
        // label inside it. `cleanupSheetPins` returning null is that test.
        {
          const si = doc?.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === hit.id) ?? -1;
          const sh = si >= 0 ? doc?.sheets[si] : undefined;
          const file = sh?.fields.find((f) => f.key === 'Sheetfile')?.value ?? '';
          // Without the child document there is nothing to check against, and
          // dropping every pin would be worse than doing nothing.
          const child = file ? liveDocs().get(file) : undefined;
          const cmd =
            doc && child && si >= 0
              ? cleanupSheetPins(doc, si, hierarchicalLabelNames(child))
              : null;
          if (cmd)
            add(250.5, {
              label: 'Cleanup Sheet Pins',
              icon: 'cleanupSheetPins',
              action: () => runCommand(cmd),
            });
        }
      }
      // SCH_POINT_EDITOR's own two menu items, shown for a polyline under the
      // same conditions upstream gates them on: the cursor has to be on the
      // shape to add a corner, and on one of its vertices to remove one.
      {
        const pe = ctxMenu?.pointEdit;
        const target =
          doc && selection.size === 1 ? pointEditTarget(doc, [...selection][0]!) : null;
        if (doc && target && pe) {
          if (canAddCorner(doc, target, pe.world, pe.tolerance))
            add(50, {
              label: 'Add Corner',
              icon: 'addCorner',
              action: () => {
                const next = addCorner(doc, target, pe.world);
                if (next) runCommand(reshapeCommand('Add Corner', next));
              },
            });
          if (pe.handle && canRemoveCorner(doc, target, pe.handle))
            add(50, {
              label: 'Remove Corner',
              icon: 'removeCorner',
              action: () => {
                const next = removeCorner(doc, target, pe.handle!);
                if (next) runCommand(reshapeCommand('Remove Corner', next));
              },
            });
        }
      }
      // SCH_ACTIONS::autoplaceFields. `autoplaceCondition` is `FieldOwners` —
      // symbols, sheets and labels — not symbols alone, so a sheet gets the
      // entry too and it moves the Sheetname/Sheetfile text back to the box.
      //
      // Labels are the part of FieldOwners still missing:
      // `SCH_LABEL_BASE::AutoplaceFields` places its fields off the direction
      // the label's connection leaves in, which we have not ported. Offering a
      // menu entry that does nothing would be worse than leaving it out.
      {
        const symbolSel =
          doc?.symbols.some((sy, i) => selection.has(refId('symbol', sy.uuid, i))) ?? false;
        const sheetSel = doc?.sheets.some((sh, i) => selection.has(refId('sheet', sh.uuid, i)));
        if (doc && (symbolSel || sheetSel))
          add(200.6, {
            label: 'Autoplace Fields',
            icon: 'autoplaceFields',
            shortcut: 'O',
            action: () => {
              const cmds = [
                symbolSel
                  ? autoplaceFields(
                      doc,
                      selection,
                      libById,
                      {
                        allowRejustify: es.autoplace_fields.allow_rejustify,
                        alignToGrid: es.autoplace_fields.align_to_grid,
                      },
                      drawableArea(doc),
                    )
                  : null,
                sheetSel
                  ? // `SCH_SHEET::GetPenWidth` falls back to the schematic's
                    // default line width, which this setting holds in mils.
                    autoplaceSheetFields(
                      doc,
                      selection,
                      es.drawing.default_line_thickness * IU_PER_MILS,
                    )
                  : null,
              ].filter((c): c is EditCommand => c !== null);
              if (cmds.length === 1) runCommand(cmds[0]!);
              else if (cmds.length > 1) runCommand(composeCommands('Autoplace Fields', cmds));
            },
          });
      }
      // SYMBOL_UNIT_MENU: which unit of a multi-unit part this placement is.
      // Units already on the sheet are annotated rather than disabled, since
      // re-picking one is legitimate when swapping two of them over.
      if (doc && selection.size === 1) {
        const si = doc.symbols.findIndex(
          (sy, i) => refId('symbol', sy.uuid, i) === [...selection][0],
        );
        const sym = si === -1 ? undefined : doc.symbols[si];
        const lib = sym ? libById.get(schSymbolLibraryName(sym)) : undefined;
        const count = symbolUnitCount(lib);
        if (sym && count > 1) {
          const missing = unplacedUnits(doc, si, libById, liveDocs().values());
          const unitItems: MenuItem[] = Array.from({ length: count }, (_v, k) => k + 1).map(
            (u) => ({
              label: unitDisplayName(lib, u) + (missing.has(u) ? '' : ' (already placed)'),
              checked: sym.unit === u,
              action: () => runCommand(setSymbolUnit(si, u)),
            }),
          );
          // Below the list, one entry per unit the hierarchy is still missing,
          // which starts a placement of that unit as a copy of this symbol.
          if (missing.size > 0) {
            unitItems.push({ sep: true });
            for (const u of [...missing].sort((a, b) => a - b))
              unitItems.push({
                label: `Place unit ${unitDisplayName(lib, u)}`,
                action: () => placeNextSymbolUnit(si, u),
              });
          }
          add(1, { label: 'Symbol Unit', items: unitItems });
        }
      }
      // SCH_EDIT_TOOL's Attributes submenu, the same five item edits the Edit
      // menu carries (SCH_EDIT_TOOL::SetAttribute).
      if (doc && Object.values(ATTRIBUTE_IDS).some((a) => canSetAttribute(doc, selection, a)))
        add(200.2, {
          label: 'Attributes',
          items: ATTRIBUTE_MENU.map(({ id, label }) => ({
            label,
            checked: attributeIsSet(doc, selection, ATTRIBUTE_IDS[id]!),
            disabled: !canSetAttribute(doc, selection, ATTRIBUTE_IDS[id]!),
            action: () => onLeftToggle(id),
          })),
        });
      // SCH_EDIT_TOOL's "Edit Main Fields" submenu: the same three the U, V and
      // F keys open.
      if (doc && selection.size === 1) {
        const owner = /^(.*):field\d+$/.exec([...selection][0]!)?.[1] ?? [...selection][0]!;
        const si = doc.symbols.findIndex((sy, i) => refId('symbol', sy.uuid, i) === owner);
        if (si !== -1) {
          const sym = doc.symbols[si]!;
          const isPower = !!libById.get(schSymbolLibraryName(sym))?.isPower;
          const fieldEntries: MenuItem[] = [];
          for (const [key, label, shortcut] of [
            ['Reference', 'Edit Reference...', 'U'],
            ['Value', 'Edit Value...', 'V'],
            // Footprint is meaningless on a power symbol, so upstream skips it.
            ...(isPower ? [] : [['Footprint', 'Edit Footprint...', 'F']]),
          ] as [string, string, string][]) {
            const fi = sym.fields.findIndex((f) => f.key === key);
            if (fi !== -1)
              fieldEntries.push({
                label,
                shortcut,
                action: () => setFieldEdit({ symbol: si, index: fi }),
              });
          }
          if (fieldEntries.length > 0)
            add(200.5, { label: 'Edit Main Fields', items: fieldEntries });
          // editWithLibEdit is registered *before* changeSymbol upstream
          // (sch_edit_tool.cpp:909 against :910), so it sits above the pair.
          add(200.7, {
            label: 'Edit with Symbol Editor',
            shortcut: 'Ctrl+E',
            action: () => editSymbolInEditor(owner),
          });
          add(
            200.8,
            {
              label: 'Change Symbol...',
              action: () => {
                setChangeSymbolsMessages([]);
                setChangeSymbolsSubject(changeSymbolsSubjectOf(sym, true));
                setChangeSymbolsMode('change');
              },
            },
            {
              label: 'Update Symbol...',
              action: () => {
                setChangeSymbolsMessages([]);
                setChangeSymbolsSubject(changeSymbolsSubjectOf(sym, true));
                setChangeSymbolsMode('update');
              },
            },
          );
        }
      }
      // SCH_EDIT_TABLE_TOOL, when the selection holds table cells. Upstream
      // puts these in their own submenu of the table-cell context menu.
      if (doc && hasCellSelection(selection)) {
        const cellItems: MenuItem[] = [
          { label: 'Add Row Above', action: () => runRowCol('addRowAbove') },
          { label: 'Add Row Below', action: () => runRowCol('addRowBelow') },
          { label: 'Add Column Before', action: () => runRowCol('addColumnBefore') },
          { label: 'Add Column After', action: () => runRowCol('addColumnAfter') },
          { sep: true },
          { label: 'Delete Rows', action: () => runRowCol('deleteRows') },
          { label: 'Delete Columns', action: () => runRowCol('deleteColumns') },
          { sep: true },
          {
            label: 'Merge Cells',
            disabled: !canMerge(doc, selection),
            action: () => {
              const cmd = tableCellsCommand(doc, selection, 'merge');
              if (cmd) runCommand(cmd);
            },
          },
          {
            label: 'Properties...',
            shortcut: 'E',
            action: () => setCellPropsIds([...selection].filter((i) => tableOfCellId(i) !== null)),
          },
          { sep: true },
          {
            label: 'Unmerge Cells',
            disabled: !canUnmerge(doc, selection),
            action: () => {
              const cmd = tableCellsCommand(doc, selection, 'unmerge');
              if (cmd) runCommand(cmd);
            },
          },
        ];
        add(101, { label: 'Table', items: cellItems });
      }
      // SCH_ACTIONS::cycleBodyStyle: step to the De Morgan alternate.
      if (doc && cycleBodyStyle(doc, selection, libById))
        add(1, {
          label: 'Cycle Body Style',
          icon: 'cycleBodyStyle',
          action: () => {
            const cmd = cycleBodyStyle(doc, selection, libById);
            if (cmd) runCommand(cmd);
          },
        });
      // SCH_ACTIONS::swap (Alt+S).
      if (doc && canSwap(doc, selection))
        add(200.3, {
          label: 'Swap',
          icon: 'swap',
          shortcut: 'Alt+S',
          action: () => {
            const cmd = swapItems(doc, selection);
            if (cmd) runCommand(cmd);
          },
        });
      // SCH_ACTIONS::alignToGrid, offered by SCH_MOVE_TOOL's selection menu
      // whenever there is something movable selected. It drags each item onto
      // the grid, so connected wiring comes along.
      if (doc && selection.size > 0)
        add(150.6, {
          label: 'Align Items to Grid',
          action: () => {
            const grid = gridSizeToIU(
              es.window.grid.sizes[es.window.grid.last_size_idx]?.x ?? '50 mil',
            );
            const cmd = alignToGridCommand(doc, selection, libById, grid);
            if (cmd) runCommand(cmd);
          },
        });
      // SCH_ALIGN_TOOL's submenu, shown once there is more than one thing to
      // line up. The click position is the target hint (selectTarget prefers
      // the item under the cursor), so it is passed through.
      if (selection.size > 1)
        add(101, {
          label: 'Align Items',
          items: (['top', 'bottom', 'left', 'right', 'centerX', 'centerY'] as AlignMode[]).map(
            (mode) => ({
              label: ALIGN_LABELS[mode],
              action: () => {
                if (!doc) return;
                const grid = gridSizeToIU(
                  es.window.grid.sizes[es.window.grid.last_size_idx]?.x ?? '50 mil',
                );
                const cmd = alignItems(
                  doc,
                  selection,
                  libById,
                  mode,
                  grid,
                  ctxMenu?.pointEdit?.world,
                );
                if (cmd) runCommand(cmd);
              },
            }),
          ),
        });
      // KiCad groups the four transforms into a submenu rather than listing
      // them flat (SCH_EDIT_TOOL's Transform Selection menu).
      add(200.1, {
        label: 'Transform Selection',
        items: [
          act('Rotate Counterclockwise', 'rotateCCW', 'R'),
          act('Rotate Clockwise', 'rotateCW', 'Shift+R'),
          act('Mirror Vertically', 'mirrorV', 'Y'),
          act('Mirror Horizontally', 'mirrorH', 'X'),
        ],
      });
      // SCH_EDIT_TOOL's "Change To" submenu (toLabel / toGLabel / toHLabel /
      // toDLabel / toText / toTextBox), shown when the selection holds
      // anything convertible. Each entry greys out for a selection that is
      // already that type, as upstream skips those items.
      {
        const convertible = doc ? changeTextType(doc, selection, 'text_box') !== null : false;
        const anyText =
          convertible || (doc ? changeTextType(doc, selection, 'label') !== null : false);
        if (anyText)
          add(200.9, {
            label: 'Change To',
            items: (
              [
                'label',
                'global_label',
                'hierarchical_label',
                'directive_label',
                'text',
                'text_box',
              ] as TextType[]
            ).map((to) => ({
              label: TYPE_LABELS[to],
              disabled: !doc || changeTextType(doc, selection, to) === null,
              action: () => {
                const cmd = doc && changeTextType(doc, selection, to);
                if (cmd) {
                  runCommand(cmd);
                  setSelection(new Set());
                }
              },
            })),
          });
      }
      if (selection.size === 1)
        add(200.4, {
          label: 'Properties...',
          icon: 'properties',
          shortcut: 'E',
          // Same handler as E: the right-click's hover selection is thrown away
          // once the dialog is up (`clearSelection = selection.IsHover()`).
          action: () => {
            const ids = requestTarget(AnyItems);
            if (ids.size !== 1) return;
            openProperties([...ids][0]!);
            finishCommand();
          },
        });
      // SCH_ACTIONS::unfoldBus (C): BUS_UNFOLD_MENU lists the bus's members and
      // picking one drops an entry plus a label for it.
      if (hit?.kind === 'line' && doc && ctxMenu?.pointEdit) {
        const bi = doc.lines.findIndex((l, i) => refId('line', l.uuid, i) === hit.id);
        const members = bi === -1 ? [] : busUnfoldMembers(doc, bi, busAliases);
        if (members.length)
          add(101, {
            label: 'Unfold from Bus',
            items: members.map((net) => ({
              label: net,
              action: () => {
                const at = ctxMenu.pointEdit!.world;
                const out = unfoldBus(
                  doc,
                  bi,
                  at,
                  net,
                  mmToIU(es.drawing.default_text_size * 0.0254),
                );
                if (out) {
                  runCommand(out.command);
                  // KiCad leaves you drawing the wire away from the entry.
                  setActiveTool('drawWire');
                  setWireStartRequest((p) => ({
                    at: out.wireStart,
                    nonce: (p?.nonce ?? 0) + 1,
                  }));
                }
              },
            })),
          });
      }
      if (hit?.kind === 'line')
        add(
          250,
          tool('Place Junction', 'junction', 'J'),
          tool('Place Net Label', 'placeLabel', 'L'),
          // placeClassLabel sits between the net and global labels upstream.
          tool('Place Netclass Directive Label', 'placeClassLabel'),
          tool('Place Global Label', 'placeGlobalLabel', 'Ctrl+L'),
          tool('Place Hierarchical Label', 'placeHierLabel', 'H'),
        );
      // SCH_SELECTION_TOOL's net-chain menu: Create for symbols-only
      // selections; Highlight / Remove-from / Name when the hit item's net
      // belongs to a committed chain.
      {
        const chainItems: MenuItem[] = [];
        const symbolIds = doc
          ? new Set(doc.symbols.map((s, i) => refId('symbol', s.uuid, i)))
          : new Set<string>();
        const symbolsOnly = selection.size > 0 && [...selection].every((id) => symbolIds.has(id));
        if (symbolsOnly)
          chainItems.push({
            label: 'Create Net Chain...',
            action: () => setCreateChainOpen(true),
          });
        const hitCode = hit && netlist ? netlist.netByItem.get(hit.id) : undefined;
        const hitNet =
          hitCode !== undefined
            ? (netlist?.nets.find((n) => n.code === hitCode)?.name ?? null)
            : null;
        const hitChain = hitNet ? committedChains.find((c) => c.nets.includes(hitNet)) : undefined;
        if (hitChain && hitNet) {
          chainItems.push(
            {
              label: 'Highlight Net Chain',
              action: () => {
                // HighlightNetChain: the chain replaces the net highlight; the
                // selection is untouched.
                setHighlightItem(null);
                setHighlightBusMembers(false);
                setHighlightedChain(hitChain.name);
              },
            },
            {
              label: 'Remove from Net Chain',
              action: () => {
                // RemoveFromNetChain: block every 2-pin symbol bridging this
                // net out of its chain, then chains rebuild via the memos.
                if (doc && netlist) {
                  const cmd = removeFromNetChainCommand(doc, libById, netlist, hitNet);
                  if (cmd) runCommand(cmd);
                }
              },
            },
            {
              label: 'Name Net Chain...',
              action: () => setChainRename({ orig: hitChain.name, name: hitChain.name }),
            },
          );
        }
        if (hitNet)
          chainItems.push({
            // SCH_ACTIONS::findNetInInspector: show the Net Navigator and put
            // the selection on the clicked item's row, which is what the panel
            // marks as active.
            label: 'Find in Net Navigator',
            action: () => {
              setLocalToggles((prev) => new Set(prev).add('showNetNavigator'));
              if (hit) setSelection(new Set([hit.id]));
            },
          });
        if (highlightedChain !== null || highlightItem !== null)
          chainItems.push({
            label: 'Clear Net Highlighting',
            action: clearHighlight,
          });
        if (chainItems.length > 0) add(400, ...chainItems);
      }
      // SCH_ACTIONS::selectConnection, gated on `expandableSelection` — the
      // connectivity-carrying kinds. A sheet is not one of them.
      if (doc && selectionIsExpandable(doc, selection))
        add(2, {
          label: 'Select/Expand Connection',
          shortcut: 'Ctrl+4',
          action: expandSelectionAlongConnection,
        });
      add(300, act('Cut', 'cut', 'Ctrl+X'), act('Copy', 'copy', 'Ctrl+C'));
      // `canCopyText` is an OnlyTypes condition: every selected item has to
      // carry text, so one symbol or sheet in the selection removes it.
      if (doc && selectionCanCopyAsText(doc, selection))
        add(300, act('Copy as Text', 'copyAsText', 'Ctrl+Shift+C'));
      add(
        300,
        act('Paste', 'paste', 'Ctrl+V'),
        act('Paste Special...', 'pasteSpecial', 'Ctrl+Shift+V'),
        act('Delete', 'delete', 'Delete'),
        {
          label: 'Duplicate',
          icon: 'duplicate',
          shortcut: 'Ctrl+D',
          action: duplicateSelection,
        },
      );
    } else {
      add(100, tool('Draw Wires', 'drawWire', 'W'), tool('Draw Buses', 'drawBus', 'B'));
      // The clipboard block, rank 300 in sch_edit_tool.cpp. Cut / Copy / Copy
      // as Text / Delete are conditioned on a selection (`IdleSelection`,
      // `NotEmpty`) and so drop out here, but these three are not:
      //
      //   selToolMenu.AddItem( ACTIONS::paste,        S_C::Idle,          300 );
      //   selToolMenu.AddItem( ACTIONS::pasteSpecial, S_C::Idle,          300 );
      //   selToolMenu.AddItem( ACTIONS::duplicate,    duplicateCondition, 300 );
      //
      // Duplicate over empty canvas looks odd until you read what gates it:
      // `duplicateCondition` only asks that no wire is being drawn, and its
      // enable is `ENABLE( hasElements )` — a property of the sheet, not of the
      // selection. So it is offered, and greyed only on an empty sheet.
      add(
        300,
        act('Paste', 'paste', 'Ctrl+V'),
        act('Paste Special...', 'pasteSpecial', 'Ctrl+Shift+V'),
        {
          label: 'Duplicate',
          icon: 'duplicate',
          shortcut: 'Ctrl+D',
          action: duplicateSelection,
          disabled: !doc || !screenHasItems(doc),
        },
      );
    }
    // Leave Sheet is on the menu whatever is selected, greyed on the sheet you
    // cannot leave. The two halves of that come from different conditions, and
    // what pulls them apart is the virtual root `SCHEMATIC::ensureVirtualRoot`
    // puts above the top-level sheets:
    //
    //   menu.AddItem( leaveSheet, belowRootSheetCondition, 150 );   // shown
    //       -> GetCurrentSheet().Last() != &Schematic().Root()
    //   mgr->SetConditions( leaveSheet, ENABLE( CanGoUp() ) );      // enabled
    //       -> Last() is not one of GetTopLevelSheets()
    //
    // On the top-level schematic the first is *true* — the invisible root sits
    // above it — while the second is false. Hence shown and greyed. We have no
    // virtual root, so the shown half is always true for us and only the enable
    // is left to compute.
    add(150.3, {
      label: 'Leave Sheet',
      icon: 'navUp',
      // SCH_ACTIONS::leaveSheet is MD_ALT + WXK_BACK (sch_actions.cpp:1421).
      // GTK labels WXK_BACK `BackSpace` in the menu; the Hotkey List calls it
      // `Back` (hotkeys_basic.cpp:95), which `hotkeyListName` supplies.
      shortcut: 'Alt+BackSpace',
      action: () => onTopAction('navUp'),
      disabled: parentPath(currentPath) === null,
    });
    add(
      401,
      act('Select All', 'selectAll', 'Ctrl+A'),
      act('Unselect All', 'unselectAll', 'Ctrl+Shift+A'),
    );
    // EDA_DRAW_FRAME::AddStandardSubMenus, rank 1000: every canvas context
    // menu in KiCad ends with these two, whatever is selected.
    add(
      1000,
      {
        label: 'Zoom',
        items: [
          act('Zoom to Fit', 'zoomFit', 'Home'),
          act('Zoom to Objects', 'zoomFitObjects', 'Ctrl+Home'),
          act('Zoom In', 'zoomIn', 'F1'),
          act('Zoom Out', 'zoomOut', 'F2'),
          act('Refresh', 'zoomRedraw', 'F5'),
        ],
      },
      {
        label: 'Grid',
        items: [
          // `GRID_MENU::update` (common/tool/grid_menu.cpp:52-104) labels each
          // row with `BuildChoiceList`'s `"%s%s (%s)"` — the optional name, the
          // size in the frame's unit, and the same size in the other one. The
          // raw stored string stood here, which cannot show a grid's name and
          // shows only its X.
          ...es.window.grid.sizes.map((size, i) => ({
            label: gridChoiceLabel(size, units, SCH_IU_PER_MM, size.name),
            checked: es.window.grid.last_size_idx === i,
            action: () =>
              settings.updateEeschema((st) => {
                st.window.grid.last_size_idx = i;
              }),
          })),
          { sep: true },
          {
            label: 'Show Grid',
            checked: es.window.grid.show,
            action: () => onLeftToggle('toggleGrid'),
          },
        ],
      },
    );

    // The separators this menu declares: two at rank 100 (the second is the
    // line under Draw Buses), then 200, 300, 400, the edit tool's own at 400
    // that lands after the net chain menu, and AddStandardSubMenus' at 1000.
    return assembleMenu(entries, [100, 101, 200, 300, 400, 401, 1000]);
  };

  /**
   * A right-toolbar click. Most of its buttons arm a placement tool; the few in
   * `RIGHT_TOOLBAR_COMMANDS` run straight away instead, so they go to the same
   * dispatcher the menu items use rather than becoming an `activeTool` no tool
   * answers to.
   */
  const onRightToolbar = useCallback(
    (id: string) => {
      if (RIGHT_TOOLBAR_COMMANDS.has(id)) onTopAction(id);
      else onToolSelect(id);
    },
    [onTopAction, onToolSelect],
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
        settings.updateEeschema((s) => {
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
    [doc, selection, runCommand, openPrefs],
  );

  // Menus carry their shortcut as literal text, so a rebinding has to be
  // painted back over them (see applyHotkeyOverrides).
  const hotkeyOverrides = useHotkeyOverrides();
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
          language: settings.common.system.language,
          onSelectLanguage: (label: string) =>
            settings.updateCommon((c) => {
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
    ],
  );
  const menus = useMemo(
    () => applyHotkeyOverrides(menusRaw, hotkeyOverrides),
    [menusRaw, hotkeyOverrides],
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
      const e = remapEvent(raw, settings.hotkeys);
      if (!e) return;
      // While a modal properties dialog is open, only Escape acts on the editor.
      if (propsTarget !== null && e.key !== 'Escape') return;
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
        settings.updateEeschema((s) => {
          s.drawing.arc_edit_mode = incrementArcEditMode(s.drawing.arc_edit_mode as ArcEditMode);
        });
      } else if (e.key === 'F5' && !e.altKey && !e.shiftKey) {
        // ACTIONS::zoomRedraw's default off macOS (actions.cpp:705-716), and
        // now also what the row prints. Ctrl+R, the macOS branch, stays bound
        // below as the second spelling.
        e.preventDefault();
        controller.current?.redraw();
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
      } else if (e.key === 'Home' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // ACTIONS::zoomFitScreen. WXK_HOME is its `#else` branch
        // (actions.cpp:719-724) and what `hotkeys.ts` has always printed for
        // `zoomFit` -- but nothing bound it, so the row advertised a dead key
        // while Ctrl+0, the `#if __WXMAC__` branch, did the work.
        e.preventDefault();
        controller.current?.zoomToFit();
      } else if (e.key === 'F1' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        // ACTIONS::listHotKeys is AS_GLOBAL and HotkeyListHost binds Ctrl+F1
        // once, above every frame. The arm stays so the bare-F1 zoom below - a
        // *different* action that requires no modifiers - is still reached only
        // when Ctrl is absent; without it, Ctrl+F1 would fall through and zoom.
        e.preventDefault();
      } else if (e.key === 'F1' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // ACTIONS::zoomIn, "Zoom In at Cursor" (F1 off macOS). It is not
        // zoomInCenter, which this used to be labelled: that action zooms about
        // the viewport centre and has no default hotkey at all.
        //
        // Ctrl++ is deliberately NOT bound as a second spelling. That is this
        // same action's `#if defined( __WXMAC__ )` default (actions.cpp:747-752)
        // and F1 is the `#else` branch, so binding both gave us a key real
        // KiCad does not have on this platform. Ctrl+- likewise, below.
        e.preventDefault();
        controller.current?.zoomIn();
      } else if (e.key === 'F2' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // ACTIONS::zoomOut, "Zoom Out at Cursor" (F2 off macOS).
        e.preventDefault();
        controller.current?.zoomOut();
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
        settings.updateEeschema((st) => {
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
            settings.eeschema.window.grid.sizes[settings.eeschema.window.grid.last_size_idx]?.x ??
              '50 mil',
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
        else if (propsTarget !== null) setPropsTarget(null);
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
          else if (settings.eeschema.input.esc_clears_net_highlight) clearHighlight();
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
        // M = Move (leaves connected wires behind), G = Drag (keeps them
        // attached), SCH_ACTIONS::move / drag. Grabs the current selection.
        if (e.key.toLowerCase() === 'm' || e.key.toLowerCase() === 'g') {
          // `SCH_MOVE_TOOL::Main` (sch_move_tool.cpp:1109-1110):
          //
          //     SCH_SELECTION& selection =
          //             m_selectionTool->RequestSelection( SCH_COLLECTOR::MovableItems, true );
          //     aUnselect = selection.IsHover();
          //
          // so M or G over an unselected symbol picks it up and moves it. The
          // hover is dropped when the move ends rather than now, which is what
          // `aUnselect` is carried through the move for.
          if (requestTarget(MovableItems).size > 0) {
            e.preventDefault();
            const kind = e.key.toLowerCase() === 'm' ? 'move' : 'drag';
            setGrabRequest((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
            return;
          }
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
        // Space, reset the status bar's relative (dx/dy) origin to the
        // cursor (ACTIONS::resetLocalCoords).
        if (e.key === ' ' && !e.shiftKey) {
          e.preventDefault();
          if (cursorRef.current) setLocalOrigin({ ...cursorRef.current });
          return;
        }
        // Shift+Space, cycle the wire/bus line mode free → 90° → 45°
        // (SCH_ACTIONS::lineModeNext; SCH_EDITOR_CONTROL::NextLineMode).
        if (e.key === ' ' && e.shiftKey) {
          e.preventDefault();
          settings.updateEeschema((s) => {
            s.drawing.line_mode = s.drawing.line_mode === 0 ? 1 : s.drawing.line_mode === 1 ? 2 : 0;
          });
          return;
        }
        // N / Shift+N, next/previous grid (ACTIONS::gridNext/gridPrev).
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          settings.updateEeschema((s) => {
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
                setWireStartRequest((p) => ({ at: out.wireStart, nonce: (p?.nonce ?? 0) + 1 }));
              }
              return;
            }
          }
        }
        // U / V / F = edit the Reference / Value / Footprint of the selected
        // symbol (SCH_EDIT_TOOL::EditField), which opens the same field dialog
        // double-clicking that field does. A field selected on its own resolves
        // to its parent symbol, as EditField does.
        {
          const FIELD_KEYS: Record<string, string> = { u: 'Reference', v: 'Value', f: 'Footprint' };
          const want = FIELD_KEYS[e.key.toLowerCase()];
          if (want && doc && selection.size === 1) {
            const id = [...selection][0]!;
            const owner = /^(.*):field\d+$/.exec(id)?.[1] ?? id;
            const si = doc.symbols.findIndex((sy, i) => refId('symbol', sy.uuid, i) === owner);
            if (si !== -1) {
              e.preventDefault();
              const sym = doc.symbols[si]!;
              // Footprint is meaningless on a power symbol, so upstream skips it.
              const isPower = !!libById.get(schSymbolLibraryName(sym))?.isPower;
              if (!(want === 'Footprint' && isPower)) {
                const fi = sym.fields.findIndex((f) => f.key === want);
                if (fi !== -1) setFieldEdit({ symbol: si, index: fi });
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
            const url = (sym.fields.find((f) => f.key === 'Datasheet')?.value ?? '').trim();
            // "~" is KiCad's "no datasheet", not a URL.
            if (url === '' || url === '~') setError('No datasheet defined.');
            else window.open(url, '_blank', 'noopener,noreferrer');
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
        // E = Properties (KiCad SCH_ACTIONS::properties) on a single selected
        // item (openProperties routes by item kind).
        if (e.key.toLowerCase() === 'e') {
          // `SCH_EDIT_TOOL::Properties` (sch_edit_tool.cpp:2569-2571):
          //
          //     SCH_SELECTION& selection = m_selectionTool->RequestSelection();
          //     bool           clearSelection = selection.IsHover();
          //
          // Unfiltered, and the hover it may have picked up is cleared once the
          // dialog returns.
          const ids = requestTarget(AnyItems);
          if (ids.size === 1) {
            e.preventDefault();
            openProperties([...ids][0]!);
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
    propsTarget,
    pastePending,
    duplicateSelection,
    findOpen,
    searchData,
    doFind,
    openFindDialog,
    openProperties,
    toggles,
    endSyncPlacement,
    requestTarget,
    withSelection,
    finishCommand,
  ]);

  const fmt = (iu: number): string => {
    const mm = iuToMM(iu);
    if (units === 'mm') return `${mm.toFixed(4)}`;
    if (units === 'mils') return `${(mm / 0.0254).toFixed(2)}`;
    return `${(mm / 25.4).toFixed(4)}`;
  };

  // Properties panel rows (SCH_PROPERTIES_PANEL): the property grid for a
  // single selected item; multi-selections keep the count message for now
  // (upstream shows the properties common to the whole selection, #77).
  const propRows = useMemo<PropRow[]>(() => {
    if (!doc || selection.size !== 1) return [];
    const ref = itemRefById(doc, [...selection][0]!);
    return ref ? schPropertiesFor(doc, libById, ref) : [];
  }, [doc, selection, libById]);

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
  } | null>(null);

  /**
   * What upstream mails the chooser as MAIL_SYMBOL_NETLIST: the symbol's
   * footprint filters and its pin count. Both are the FRAME's knowledge and
   * neither is derivable inside the chooser, which is why the two filter
   * checkboxes live there and not in the tree.
   *
   * `PG_FPID_EDITOR::OnEvent` builds the netlist through `m_netlistCallback`
   * and mails it before showing the frame; an empty one simply means no
   * checkboxes, which is the same `if( !m_fpFilters.empty() )` branch.
   */
  const selectedSymbolFpContext = useCallback((): {
    fpFilters: readonly string[];
    pinCount?: number;
  } => {
    if (!doc || selection.size !== 1) return { fpFilters: [] };
    const ref = itemRefById(doc, [...selection][0]!);
    if (ref?.kind !== 'symbol') return { fpFilters: [] };
    const sym = doc.symbols.find((t, i) => refId('symbol', t.uuid, i) === ref.id);
    if (!sym) return { fpFilters: [] };
    const lib = libById.get(sym.libId);
    const filters = (
      lib?.properties.find((pr) => pr.key === 'ki_fp_filters')?.value ??
      sym.fields.find((f) => f.key === 'ki_fp_filters')?.value ??
      ''
    )
      .split(/\s+/)
      .filter(Boolean);
    // `FOOTPRINT_CHOOSER_FRAME` counts the pins in the mailed netlist, which is
    // the symbol's whole pin list - every unit's, across body styles, counted
    // once per pin NUMBER the way `GetUniquePadCount` counts pads. A power
    // symbol's hidden pin counts too, because the netlist carries it.
    const numbers = new Set<string>();
    for (const unit of lib?.units ?? []) {
      for (const pin of unit.pins) if (pin.number) numbers.add(pin.number);
    }
    return { fpFilters: filters, ...(numbers.size > 0 ? { pinCount: numbers.size } : {}) };
  }, [doc, selection, libById]);

  // `PROPERTIES_PANEL::rebuildProperties` captions a single selection with
  // `aSelection.Front()->GetFriendlyName()` — the item's TYPE.
  const propFriendlyName = useMemo<string | undefined>(() => {
    if (!doc || selection.size !== 1) return undefined;
    const ref = itemRefById(doc, [...selection][0]!);
    return ref ? schItemFriendlyName(doc, ref) : undefined;
  }, [doc, selection]);

  // Existing net/label names for the label dialog's completion list
  // (DIALOG_LABEL_PROPERTIES pre-loads its combo with the sheet's net names).
  /** The combo is loaded with the existing labels *of the same type* across the
   *  whole hierarchy, plus the project's bus aliases (TransferDataToWindow). */
  const labelSuggestionsOf = useCallback(
    (kind: LabelPropsKind): string[] => {
      const names = new Set<string>();
      for (const sheet of liveDocs().values()) {
        for (const l of sheet.labels) if (l.kind === kind && l.text) names.add(l.text);
      }
      for (const alias of setup.busAliases) if (alias.name) names.add(`{${alias.name}}`);
      return [...names].sort((a, b) => a.localeCompare(b));
    },
    [liveDocs, setup.busAliases],
  );

  // Message-panel rows (EDA_MSG_PANEL): exactly one selected item shows its
  // GetMsgPanelInfo; empty and multi-selections clear the panel.
  const msgPanelItems = useMemo<MsgPanelItem[]>(() => {
    if (!doc || selection.size !== 1) return [];
    const id = [...selection][0]!;
    const ref = itemRefById(doc, id);
    if (!ref) return [];
    const code = netlist?.netByItem.get(id);
    const net = code !== undefined ? netlist?.nets.find((n) => n.code === code) : undefined;
    // Resolved Netclass (NET_SETTINGS::GetEffectiveNetClass) for the net row.
    const ncName = net ? resolveEffectiveNetClass(net.name, setup.netClasses).name : null;
    return getMsgPanelItems(doc, libById, ref, fmt, net?.name ?? null, ncName);
  }, [doc, selection, libById, netlist, fmt, setup.netClasses]);

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
        <LoadingOverlay label={loading ?? 'Loading schematic...'} />
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
        leftSlot={
          <div className="ze-home-link" onClick={onExitToHome} title="Back to project manager">
            ⌂ ZiroEDA
          </div>
        }
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
                <div className="ze-leftdock sch-leftdock" style={{ width: leftDockWidth }}>
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
                                highlightedNet={highlightedChain}
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
                                    controller.current?.centerOn({
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
                            <div className="ze-panel-body">
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
                              <SchPropertiesPanel
                                rows={propRows}
                                selectionCount={selection.size}
                                friendlyName={propFriendlyName}
                                units={units}
                                onCommand={runCommand}
                                onBrowseFootprint={(current, commit) =>
                                  setFpChooser({ current, commit, ...selectedSymbolFpContext() })
                                }
                              />
                            </div>
                          </div>
                          {sashAfter('properties')}
                        </>
                      )}
                      {/* `PANEL_SCH_SELECTION_FILTER`, the same widget the Symbol
                          Editor builds (`ui/SelectionFilterPanel.tsx`). What was
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
                <div
                  className="ze-splitter"
                  onMouseDown={startLeftDockResize}
                  title="Drag to resize"
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
          <div className="ze-canvas-wrap">
            {readOnlyNotice}
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
            <SchematicCanvas
              ref={controller}
              onInfoBar={setInfoBar}
              schematic={doc}
              libById={libById}
              selection={selection}
              activeTool={activeTool}
              lineMode={lineMode}
              wireStartRequest={wireStartRequest}
              arcEditMode={es.drawing.arc_edit_mode as ArcEditMode}
              placeLib={placeLib}
              placeUnit={placeUnit}
              placeInstance={placeInstance}
              onSymbolPlaced={onSymbolPlaced}
              pendingLabel={pendingLabel}
              // The canvas has always read this to decide whether a click drops
              // the flag or re-opens the dialog, and it was never passed: it saw
              // `undefined` every time, took the "ask again" branch on every
              // click, and a directive label could not be placed at all.
              pendingDirective={pendingDirective}
              onLabelPlaced={onLabelPlaced}
              onLabelPrompt={onLabelPrompt}
              onFollowLink={onFollowLink}
              highlight={highlightWires}
              theme={theme}
              renderOpts={renderOpts}
              inputPrefs={inputPrefs}
              onSheetDrawn={onSheetDrawn}
              onTextBoxDrawn={onTextBoxDrawn}
              onTableDrawn={onTableDrawn}
              // The table preview needs the default text size: a column is
              // fifteen characters wide and a row two high.
              tableFontSizeIU={setup.formatting.defaultTextSizeMils * IU_PER_MILS}
              onSheetPinClick={onSheetPinClick}
              pendingImage={pendingImage}
              onImagePlaced={onImagePlaced}
              grabRequest={grabRequest}
              onContextMenuRequest={onContextMenuRequest}
              isHoverSelection={isHoverSelection({ selection, hover: hoverSelection })}
              onClarify={(x, y, items, additive) => setClarify({ x, y, items, additive })}
              onZoomArea={(box) => {
                // The tool stays armed after a zoom. `ZOOM_TOOL::Main` loops on
                // `selectRegion()`, and that returns *cancelled* — false for a
                // zoom that actually happened — so the `break` is only ever taken
                // when the user escapes or picks another tool:
                //
                //     else if( evt->IsDrag( BUT_LEFT ) || evt->IsDrag( BUT_RIGHT ) )
                //     {
                //         if( selectRegion() )
                //             break;
                //     }
                //
                // Dropping back to the selection tool here made it a one-shot, so
                // zooming in twice meant picking the tool twice.
                controller.current?.zoomToBox(box);
              }}
              onSelect={onSelect}
              onHighlight={onHighlight}
              onRequestTool={onToolSelect}
              // `SCH_SELECTION_TOOL` (sch_selection_tool.cpp:676-694) has ONE
              // rule for a left double-click: a sheet enters the sheet, a
              // group enters the group, and everything else does
              //
              //     m_toolMgr->PostAction( SCH_ACTIONS::properties );
              //
              // which is the same action E is bound to. We had grown two
              // routers instead — `onEditItem` knew symbol, field, label, text
              // box, table, directive and sheet, while `openProperties` knew
              // those AND graphics, lines, images, junctions and bus entries.
              // So double-clicking a rectangle did nothing at all: it was not
              // on the shorter list. `openProperties` is the complete one, and
              // `onEditItem` remains what it calls to open a particular kind.
              onEditItem={(id, kind) => {
                if (kind === 'sheet' || kind === 'directive') onEditItem(id, kind);
                else openProperties(id);
              }}
              onSelectBox={onSelectBox}
              pastePending={pastePending}
              onPasteDone={onPasteDone}
              ercMarkers={ercResult
                ?.filter((v) => (v.file ?? currentFile) === currentFile)
                .map((v) => ({
                  ...v,
                  excluded: setup.ercExclusions.includes(ercExclusionKey(v)),
                  brightened: ercFocusedMarker === ercExclusionKey(v),
                }))
                .filter((v) =>
                  v.excluded
                    ? es.appearance.show_erc_exclusions
                    : v.severity === 'error'
                      ? es.appearance.show_erc_errors
                      : es.appearance.show_erc_warnings,
                )}
              onMarkerPick={(v, dbl) => {
                // `SCH_MARKER_T` is always selectable, and selecting one runs
                // `SCH_INSPECTION_TOOL::CrossProbe`: brighten the marker, drop any
                // item selection, and walk the open ERC dialog to its row.
                setSelection(new Set());
                setErcFocusedMarker(ercExclusionKey(v));
                // A double-click comes through SCH_EDIT_TOOL::Properties, which
                // opens the dialog first if it is not already up:
                //
                //     if( !dlg->IsShownOnScreen() ) { dlg->Show( true ); dlg->Raise(); }
                if (dbl) setErcOpen(true);
                // The dialog may not be mounted yet on that first double-click,
                // so the row is remembered and applied once its nav appears.
                if (!ercNav.current?.selectByKey(ercExclusionKey(v)))
                  pendingErcSelect.current = ercExclusionKey(v);
              }}
              onCommand={runCommand}
              onAnnotatePlacement={annotatePlacement}
              onAutoplacePlacement={autoplacePlacement}
              onRequestChooser={() => setChooserDismissed(false)}
              onEditDrawingSheet={() => setPageSettingsOpen(true)}
              onCursorMove={onCursorMove}
              onScaleChange={onScaleChange}
            />
            {ctxMenu && (
              <ContextMenu
                x={ctxMenu.x}
                y={ctxMenu.y}
                items={buildContextMenu()}
                onClose={() => setCtxMenu(null)}
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
                // Each direction writes a different file, which is why they go
                // through the per-sheet applier rather than plain runCommand.
                onUsePinTemplate={(entry, pin, label) => {
                  const cmd = syncPinFromLabel(
                    doc,
                    { sheet: entry.sheetIndex, pin: pin.index },
                    label,
                  );
                  if (!cmd) return;
                  const changed: PickedFile[] = [];
                  applySheetCommand(syncParentFile.current, cmd, changed);
                  if (changed.length) onProjectChange?.(changed);
                }}
                onUseLabelTemplate={(entry, label, pin) => {
                  const changed: PickedFile[] = [];
                  applySheetCommand(entry.file, syncLabelsFromPin(label, pin), changed);
                  if (changed.length) onProjectChange?.(changed);
                  // The dialog reads the sub-sheet it was handed, so refresh it.
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
                  const changed: PickedFile[] = [];
                  applySheetCommand(
                    syncParentFile.current,
                    deleteSyncPins(entry.sheetIndex, indices),
                    changed,
                  );
                  if (changed.length) onProjectChange?.(changed);
                }}
                onDeleteLabels={(entry, texts) => {
                  const changed: PickedFile[] = [];
                  applySheetCommand(entry.file, deleteSyncLabels(texts), changed);
                  if (changed.length) onProjectChange?.(changed);
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
                  settings.updateEeschema((s) => {
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
                  setErcFocusedMarker(null);
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
                  setErcFocusedMarker(null);
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
            {caseConflicts && (
              <DialogResolveFieldCaseConflicts
                conflicts={caseConflicts.list}
                onApply={applyCaseConflicts}
                // Cancel abandons opening the table (m_aborted upstream).
                onCancel={() => setCaseConflicts(null)}
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
            {changeSymbolsMode !== null && (
              <DialogChangeSymbols
                mode={changeSymbolsMode}
                fieldNamesFor={changeSymbolsFieldNames}
                hasSelection={selection.size > 0}
                {...(changeSymbolsSubject ? { subject: changeSymbolsSubject } : {})}
                messages={changeSymbolsMessages}
                onApply={runChangeSymbols}
                onClose={() => setChangeSymbolsMode(null)}
                /* The browse buttons open SYMBOL_CHOOSER_FRAME, which is handed
                   `s_SymbolHistoryList` — the same global the Place Symbol
                   chooser uses (symbol_chooser_frame.cpp:86), never the power
                   one, since this frame passes no filter. */
                chooserHistory={sSymbolHistoryList}
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
                  settings.updateEeschema((cfg) => {
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
                onPrint={doPrint}
                onPreview={doPreview}
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
                themeId={es.appearance.color_theme}
                projectFolders={projectFolders}
                onPlot={doPlot}
                onClose={() => setPlotOpen(false)}
              />
            )}
            {createChainOpen && doc && (
              <DialogCreateNetChain
                potentials={potentialChains}
                committed={committedChains}
                hint={(() => {
                  // ShowCreateNetChain's FOCUS_HINT from the current selection:
                  // symbol references, or a single wire's net name.
                  const hint: CreateChainFocusHint = {};
                  if (doc) {
                    const selSymbols = doc.symbols
                      .map((s, i) => ({ s, id: refId('symbol', s.uuid, i) }))
                      .filter((e) => selection.has(e.id));
                    const ref = (sym: (typeof selSymbols)[number]['s']): string =>
                      sym.fields.find((f) => f.key === 'Reference')?.value ?? '';
                    if (selSymbols[0]) hint.fromRef = ref(selSymbols[0].s);
                    if (selSymbols[1]) hint.toRef = ref(selSymbols[1].s);
                    if (selSymbols.length === 0 && selection.size === 1 && netlist) {
                      const code = netlist.netByItem.get([...selection][0]!);
                      const net =
                        code !== undefined ? netlist.nets.find((n) => n.code === code) : undefined;
                      if (net) hint.netName = net.name;
                    }
                  }
                  return hint;
                })()}
                onCreate={(chain) => {
                  // CreateNetChainFromPotential + highlight the new chain.
                  runCommand(netChainsCommand(writeNetChains(doc, [...committedChains, chain])));
                  setSelection(new Set());
                  setHighlightItem(null);
                  setHighlightBusMembers(false);
                  setHighlightedChain(chain.name);
                }}
                onClose={() => setCreateChainOpen(false)}
              />
            )}
            {chainRename && doc && (
              <div className="ze-modal-backdrop" onMouseDown={() => setChainRename(null)}>
                <div className="ze-modal" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="ze-modal-header">
                    Name Net Chain
                    <span className="x" title="Cancel" onClick={() => setChainRename(null)}>
                      ✕
                    </span>
                  </div>
                  <div className="ze-modal-body" style={{ display: 'block', padding: 14 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Net chain name:
                      <input
                        style={{ flex: 1 }}
                        value={chainRename.name}
                        autoFocus
                        onChange={(e) =>
                          setChainRename((p) => (p ? { ...p, name: e.target.value } : p))
                        }
                      />
                    </label>
                  </div>
                  <div className="ze-modal-footer">
                    <button className="ze-btn" onClick={() => setChainRename(null)}>
                      Cancel
                    </button>
                    <button
                      className="ze-btn primary"
                      onClick={() => {
                        // NameNetChain: rename the committed chain (collisions
                        // rejected like RenameCommittedNetChain), rekey the
                        // chain->class map, and keep the chain highlighted.
                        const { orig, name } = chainRename;
                        if (
                          name === orig ||
                          !isValidNetChainName(name) ||
                          committedChains.some((c) => c.name === name)
                        ) {
                          setChainRename(null);
                          return;
                        }
                        runCommand(
                          netChainsCommand(
                            writeNetChains(
                              doc,
                              committedChains.map((c) => (c.name === orig ? { ...c, name } : c)),
                            ),
                          ),
                        );
                        const classByChain = { ...setup.netChains.classByChain };
                        if (classByChain[orig] !== undefined) {
                          classByChain[name] = classByChain[orig];
                          delete classByChain[orig];
                          commitSetup({
                            ...setup,
                            netChains: { ...setup.netChains, classByChain },
                          });
                        }
                        if (highlightedChain === orig) setHighlightedChain(name);
                        setChainRename(null);
                      }}
                    >
                      OK
                    </button>
                  </div>
                </div>
              </div>
            )}
            {setupOpen && (
              <DialogSchematicSetup
                value={setup}
                onOk={(nextIn) => {
                  // PANEL_SETUP_NET_CHAINS::ApplyEdits: rekey the chain->class
                  // map for renamed rows and drop deleted chains before the
                  // project file persists it.
                  let next = nextIn;
                  if (doc) {
                    const committedAtOpen = readNetChains(doc).map((c) => c.name);
                    const rows = next.netChains.chains;
                    const rowByOrig = new Map(
                      rows.filter((r) => r.origName).map((r) => [r.origName, r]),
                    );
                    const classByChain = { ...next.netChains.classByChain };
                    for (const name of committedAtOpen) {
                      const row = rowByOrig.get(name);
                      if (!row || row.name !== name) delete classByChain[name];
                    }
                    for (const row of rows) {
                      if (row.chainClass) classByChain[row.name] = row.chainClass;
                      else delete classByChain[row.name];
                    }
                    next = { ...next, netChains: { ...next.netChains, classByChain } };
                  }
                  commitSetup(next);
                  // Net-chain renames/edits/deletes write back to the document's
                  // (net_chain …) nodes (they live in .kicad_sch, root sheet).
                  if (doc) {
                    const before = readNetChains(doc);
                    const rowByOrig = new Map(
                      next.netChains.chains.filter((r) => r.origName).map((r) => [r.origName, r]),
                    );
                    const after = before.flatMap((c) => {
                      const row = rowByOrig.get(c.name);
                      if (!row) return []; // deleted
                      return [{ ...c, name: row.name, netClass: row.netClass, color: row.color }];
                    });
                    if (JSON.stringify(after) !== JSON.stringify(before))
                      runCommand(netChainsCommand(writeNetChains(doc, after)));
                  }
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
                fieldTemplates={setup.fieldTemplates}
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
              <DialogAssignFootprints
                docs={liveDocs()}
                // The netlist CVPCB works on is this design's sheets, in
                // hierarchy order, not every .kicad_sch in the project folder.
                files={assignFpFiles}
                projectFootprints={projectFootprintFiles}
                onApply={(edits, { save, close }) => {
                  applyFieldsEdits(edits, { persist: save });
                  if (close) setAssignFpOpen(false);
                }}
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
                  setPlaceUnit(1);
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
                      selectionZoom={settings.common.search_pane.selection_zoom}
                      onSelectionZoomChange={(mode) =>
                        settings.updateCommon((c) => {
                          c.search_pane.selection_zoom = mode;
                        })
                      }
                      selection={selection}
                      onClearSelection={() => setSelection(new Set())}
                      onSelect={(id) => setSelection(new Set([id]))}
                      onCenter={(_id, at) => controller.current?.centerOn(at)}
                      onZoomFit={(id) => {
                        // ACTIONS::zoomFitSelection, the same extent walk the View
                        // menu's Zoom to Selected Objects uses.
                        const box = doc ? selectionBBox(doc, new Set([id]), libById) : emptyBBox();
                        if (!isEmpty(box)) controller.current?.zoomToBox(box);
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
          zoom: <span ref={statusReadout.zoomRef} />,
          coords: <span ref={statusReadout.coordsRef} />,
          deltas: <span ref={statusReadout.deltasRef} />,
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

      {chooserOpen && (
        <DialogSymbolChooser
          powerFilter={activeTool === 'placePower'}
          showFootprints={es.appearance.footprint_preview}
          historyList={activeTool === 'placePower' ? sPowerHistoryList : sSymbolHistoryList}
          alreadyPlaced={alreadyPlaced}
          getPlacedLibSymbol={getPlacedLibSymbol}
          onOk={onChooserOk}
          onCancel={() => setChooserDismissed(true)}
        />
      )}

      {prefsOpen && (
        <PreferencesDialog initialPage={prefsPage} onClose={() => setPrefsOpen(false)} />
      )}

      {/* Double-click / E on a symbol: KiCad's Symbol Properties dialog. */}
      {propsSymbol && propsTarget !== null && (
        <SymbolPropertiesDialog
          hasAlternate={hasAlternateBodyStyle(libById.get(schSymbolLibraryName(propsSymbol)))}
          symbol={propsSymbol}
          lib={libById.get(schSymbolLibraryName(propsSymbol))}
          fieldTemplates={setup.fieldTemplates}
          subpart={subpartSettings(setup.annotation)}
          // `m_frame->GetUserUnits()` — the grid's Text Size / X / Y cells are
          // formatted and parsed in the frame's display unit, not in mm.
          units={units}
          onOk={(edit: SymbolEdit) => {
            runCommand(editSymbolProperties(propsTarget, edit));
            setPropsTarget(null);
          }}
          onCancel={() => setPropsTarget(null)}
          // The General page's hand-off buttons. Each closes this dialog and
          // opens the flow that already exists, as upstream's do.
          onChangeSymbol={() => {
            setPropsTarget(null);
            setChangeSymbolsMessages([]);
            // Opened ON this symbol, so it is `m_symbol` and seeds the entries.
            setChangeSymbolsSubject(changeSymbolsSubjectOf(propsSymbol, true));
            setChangeSymbolsMode('change');
          }}
          onUpdateSymbol={() => {
            setPropsTarget(null);
            setChangeSymbolsMessages([]);
            setChangeSymbolsSubject(changeSymbolsSubjectOf(propsSymbol, true));
            setChangeSymbolsMode('update');
          }}
          // The two hand-off buttons are ONE handler with one literal
          // different, because that is all that separates them upstream
          // (sch_edit_tool.cpp:2727-2760). "Edit Symbol..." used to call
          // `onShowSymbolEditor()` — a bare view switch with no symbol — so it
          // opened on `[no symbol loaded]`; "Edit Library Symbol..." opens the
          // *library* part rather than this sheet's cached copy, so an edit
          // there reaches every use of it.
          onEditSymbol={
            onEditSymbolInEditor && propsTarget !== null
              ? symbolPropsHandoff(propsTarget, 'schematic')
              : undefined
          }
          onEditLibrarySymbol={
            onEditSymbolInEditor && propsTarget !== null
              ? symbolPropsHandoff(propsTarget, 'library')
              : undefined
          }
        />
      )}

      {/* Free text (DIALOG_TEXT_PROPERTIES): createNewText opens it before the
          text is attached to the cursor, seeded from the last one placed. */}
      {activeTool === 'placeText' && labelPrompt && !pendingLabel && !labelEdit && (
        <DialogTextProperties
          units={units}
          kind="text"
          pages={linkPages}
          initial={{
            text: '',
            face: lastText.current.face,
            hyperlink: '',
            bold: lastLabel.current.bold,
            italic: lastLabel.current.italic,
            // New text defaults to Schematic Setup > Formatting's text size
            // (createNewText seeds from m_DefaultTextSize).
            sizeIU: setup.formatting.defaultTextSizeMils * IU_PER_MILS,
            hAlign: lastText.current.hAlign,
            vAlign: lastText.current.vAlign,
            angle: lastText.current.angle,
            excludeFromSim: lastText.current.excludeFromSim,
          }}
          onOk={(r: TextPropsResult) => startTextPlacement(r)}
          onCancel={() => setLabelPrompt(false)}
        />
      )}

      {/* Label tools (DIALOG_LABEL_PROPERTIES): the dialog names the label and
          sets its shape/formatting, then it follows the cursor to be placed. */}
      {LABEL_DIALOG_KINDS[activeTool] && labelPrompt && !pendingLabel && !labelEdit && (
        <DialogLabelProperties
          units={units}
          kind={LABEL_DIALOG_KINDS[activeTool]!}
          isNew
          initial={{
            text: '',
            face: lastLabel.current.face,
            shape: lastLabel.current.shape,
            bold: lastLabel.current.bold,
            italic: lastLabel.current.italic,
            // New labels default to Schematic Setup > Formatting's text size
            // (createNewLabel seeds from m_DefaultTextSize).
            sizeIU: setup.formatting.defaultTextSizeMils * IU_PER_MILS,
            spin: lastLabel.current.spin,
            autoRotate: lastLabel.current.autoRotate,
            fields: [],
          }}
          suggestions={labelSuggestionsOf(LABEL_DIALOG_KINDS[activeTool]!)}
          onOk={(r: LabelPropsResult) => startLabelPlacement(LABEL_DIALOG_KINDS[activeTool]!, r)}
          onCancel={() => setLabelPrompt(false)}
        />
      )}

      {/* Netclass directive label (DIALOG_LABEL_PROPERTIES' "Directive Label
          Properties"): no text of its own, the flag shape, the pin length and
          the Netclass field. */}
      {activeTool === 'placeClassLabel' && labelPrompt && !pendingDirective && !labelEdit && (
        <DialogLabelProperties
          units={units}
          kind="directive"
          netclasses={netclassNames}
          isNew
          initial={{
            text: '',
            shape: lastDirective.current.shape,
            bold: false,
            italic: false,
            sizeIU: lastDirective.current.pinLength,
            spin: lastDirective.current.spin,
            autoRotate: false,
            // `createNewLabel`, `case LAYER_NETCLASS_REFS` — a new directive
            // label is born with *two* user fields, not one:
            //
            //     labelItem->GetFields().emplace_back( labelItem, FIELD_T::USER, wxT( "Netclass" ) );
            //     labelItem->GetFields().emplace_back( labelItem, FIELD_T::USER, wxT( "Component Class" ) );
            //     labelItem->GetFields().back().SetItalic( true );
            //     labelItem->GetFields().back().SetVisible( true );
            //
            // Ours offered only the netclass row, so the dialog did not match
            // upstream's and a component class could not be given at all.
            fields: [
              {
                key: 'Netclass',
                value: '',
                angle: 0,
                effects: { hidden: false },
              },
              {
                key: 'Component Class',
                value: '',
                angle: 0,
                effects: { hidden: false, italic: true },
              },
            ],
          }}
          onOk={startDirectivePlacement}
          onCancel={() => setLabelPrompt(false)}
        />
      )}

      {/* Editing a netclass flag (Properties): the same dialog, pre-filled. */}
      {directiveEdit && (doc.directiveLabels ?? [])[directiveEdit.index] && (
        <DialogLabelProperties
          units={units}
          kind="directive"
          netclasses={netclassNames}
          isNew={false}
          initial={{
            text: '',
            shape: (doc.directiveLabels ?? [])[directiveEdit.index]!.shape ?? 'round',
            bold: false,
            italic: false,
            sizeIU:
              (doc.directiveLabels ?? [])[directiveEdit.index]!.pinLength ??
              DEFAULT_DIRECTIVE_PIN_LENGTH,
            spin: spinOfAngle((doc.directiveLabels ?? [])[directiveEdit.index]!.angle),
            autoRotate: false,
            fields: (doc.directiveLabels ?? [])[directiveEdit.index]!.fields,
          }}
          onOk={commitDirectiveProperties}
          onCancel={() => setDirectiveEdit(null)}
        />
      )}

      {/* Editing existing free text (Properties): the same dialog, pre-filled. */}
      {labelEdit && labelEdit.kind === 'text' && doc?.labels[labelEdit.index] && (
        <DialogTextProperties
          units={units}
          kind="text"
          pages={linkPages}
          initial={{
            text: labelEdit.text,
            face: doc.labels[labelEdit.index]?.effects?.face ?? '',
            hyperlink: doc.labels[labelEdit.index]?.hyperlink ?? '',
            bold: !!doc.labels[labelEdit.index]?.effects?.bold,
            italic: !!doc.labels[labelEdit.index]?.effects?.italic,
            sizeIU: doc.labels[labelEdit.index]?.effects?.fontSize?.[0] ?? 12700,
            ...(doc.labels[labelEdit.index]?.effects?.color
              ? { color: doc.labels[labelEdit.index]!.effects!.color! }
              : {}),
            hAlign: hAlignOf(doc.labels[labelEdit.index]!.effects?.justify),
            vAlign: vAlignOf(doc.labels[labelEdit.index]!.effects?.justify),
            angle: doc.labels[labelEdit.index]!.angle,
            excludeFromSim: !!doc.labels[labelEdit.index]?.excludedFromSim,
          }}
          onOk={commitTextProperties}
          onCancel={() => setLabelEdit(null)}
        />
      )}

      {/* Editing an existing label (Properties): the same dialog, pre-filled. */}
      {labelEdit && labelEdit.kind !== 'text' && doc?.labels[labelEdit.index] && (
        <DialogLabelProperties
          units={units}
          kind={labelEdit.kind as LabelPropsKind}
          isNew={false}
          initial={{
            text: labelEdit.text,
            face: doc.labels[labelEdit.index]?.effects?.face ?? '',
            shape: labelEdit.shape ?? lastLabel.current.shape,
            bold: !!doc.labels[labelEdit.index]?.effects?.bold,
            italic: !!doc.labels[labelEdit.index]?.effects?.italic,
            sizeIU: doc.labels[labelEdit.index]?.effects?.fontSize?.[0] ?? 12700,
            ...(doc.labels[labelEdit.index]?.effects?.color
              ? { color: doc.labels[labelEdit.index]!.effects!.color! }
              : {}),
            spin: spinOfAngle(doc.labels[labelEdit.index]!.angle),
            autoRotate: false,
            fields: labelFields(doc.labels[labelEdit.index]!),
          }}
          suggestions={labelSuggestionsOf(labelEdit.kind as LabelPropsKind)}
          onOk={commitLabelProperties}
          onCancel={() => setLabelEdit(null)}
        />
      )}

      {/* Wire/bus stroke (DIALOG_WIRE_BUS_PROPERTIES, E on a wire). */}
      {lineEdit && (
        <DialogLineProperties
          kind="wire"
          widthIU={lineEdit.widthIU}
          style={lineEdit.style}
          color={lineEdit.color}
          junctionIU={
            doc.junctions.find(
              (j) =>
                (j.at.x === doc.lines[lineEdit.index]?.start.x &&
                  j.at.y === doc.lines[lineEdit.index]?.start.y) ||
                (j.at.x === doc.lines[lineEdit.index]?.end.x &&
                  j.at.y === doc.lines[lineEdit.index]?.end.y),
            )?.diameter ?? 0
          }
          onOk={commitLineEdit}
          onCancel={() => setLineEdit(null)}
        />
      )}

      {/* Assign Netclass (DIALOG_ASSIGN_NETCLASS). */}
      {netclassPatterns && (
        <DialogAssignNetclass
          patterns={netclassPatterns}
          netClasses={setup.netClasses.classes.map((c) => c.name)}
          onCancel={() => setNetclassPatterns(null)}
          onOk={(netClass) => {
            const assignments = netclassPatterns.reduce(
              (acc, pattern) => addNetclassAssignment(acc, pattern, netClass),
              setup.netClasses.assignments,
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
      {cellPropsIds && doc && (
        <DialogTableCellProperties
          cells={cellPropsIds
            .map((i) => resolveCell(doc, i)?.cell)
            .filter((c): c is NonNullable<typeof c> => !!c)}
          fmt={fmt}
          parse={(t) => {
            const n = Number.parseFloat(t);
            if (!Number.isFinite(n)) return null;
            return units === 'mm'
              ? mmToIU(n)
              : units === 'mils'
                ? mmToIU(n * 0.0254)
                : mmToIU(n * 25.4);
          }}
          onCancel={() => setCellPropsIds(null)}
          onOk={(next) => {
            const targets = new Set(cellPropsIds);
            const tables = doc.tables.map((t, ti) => {
              const tid = refId('table', t.uuid, ti);
              if (!t.cells.some((_, k) => targets.has(tableCellId(tid, k)))) return t;
              return {
                ...t,
                cells: t.cells.map((c, k) => (targets.has(tableCellId(tid, k)) ? next(c) : c)),
              };
            });
            runCommand({
              label: 'Table Cell Properties',
              apply: (d) => ({ ...d, tables }),
              invert: (before) => {
                const was = before.tables;
                const put = (arr: typeof was): EditCommand => ({
                  label: 'Table Cell Properties',
                  apply: (d) => ({ ...d, tables: arr }),
                  invert: (b) => put(b.tables),
                });
                return put(was);
              },
            });
            setCellPropsIds(null);
          }}
        />
      )}

      {/* A bus entry's stroke (DIALOG_WIRE_BUS_PROPERTIES, E on an entry). */}
      {busEntryEdit && (
        <DialogLineProperties
          kind="wire"
          widthIU={busEntryEdit.widthIU}
          style={busEntryEdit.style}
          color={busEntryEdit.color}
          onOk={commitBusEntryEdit}
          onCancel={() => setBusEntryEdit(null)}
        />
      )}

      {/* Junction diameter/colour (DIALOG_JUNCTION_PROPS, E on a junction). */}
      {junctionEdit && (
        <DialogLineProperties
          kind="junction"
          diameterIU={junctionEdit.diameterIU}
          color={junctionEdit.color}
          onOk={commitJunctionEdit}
          onCancel={() => setJunctionEdit(null)}
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

      {/* Editing an existing sheet's name/file (DIALOG_SHEET_PROPERTIES, E key). */}
      {sheetEdit && doc.sheets[sheetEdit.index] && (
        <DialogSheetProperties
          initial={sheetPropsOf(doc.sheets[sheetEdit.index]!, sheetEdit.index)}
          hierarchicalPath={sheetPathLabel(doc.sheets[sheetEdit.index]!)}
          onOk={commitSheetEdit}
          onCancel={() => setSheetEdit(null)}
        />
      )}

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
          onCancel={() => setFpChooser(null)}
        />
      )}

      {sheetPinEdit && doc.sheets[sheetPinEdit.sheet]?.pins[sheetPinEdit.pin] && (
        <DialogSheetPinProperties
          initial={{
            name: doc.sheets[sheetPinEdit.sheet]!.pins[sheetPinEdit.pin]!.name,
            shape: doc.sheets[sheetPinEdit.sheet]!.pins[sheetPinEdit.pin]!.shape,
            effects: doc.sheets[sheetPinEdit.sheet]!.pins[sheetPinEdit.pin]!.effects ?? {
              hidden: false,
            },
          }}
          onOk={commitSheetPinEdit}
          onCancel={() => setSheetPinEdit(null)}
        />
      )}

      {fieldEdit && fieldPropsOf(fieldEdit) && (
        <DialogFieldProperties
          initial={fieldPropsOf(fieldEdit)!}
          caption={fieldEditCaption(doc.symbols[fieldEdit.symbol]!.fields[fieldEdit.index]!.key)}
          // Every UNIT_BINDER in the dialog reads its units off the frame.
          units={units}
          onOk={commitFieldEdit}
          onCancel={() => setFieldEdit(null)}
        />
      )}

      {imageEdit && doc.images[imageEdit.index] && (
        <DialogImageProperties
          at={doc.images[imageEdit.index]!.at}
          scale={doc.images[imageEdit.index]!.scale}
          data={doc.images[imageEdit.index]!.data}
          ppi={imagePPI(doc.images[imageEdit.index]!.data)}
          pixelSize={imagePixelSize(doc.images[imageEdit.index]!.data) ?? { w: 40, h: 40 }}
          onOk={commitImageEdit}
          onCancel={() => setImageEdit(null)}
        />
      )}

      {shapeEdit && (
        <DialogShapeProperties
          shapeName={shapeEditName(shapeEdit)}
          units={units}
          initial={shapePropsOf(shapeEdit)}
          onOk={commitShapeEdit}
          onCancel={() => setShapeEdit(null)}
        />
      )}

      {/* Hierarchical sheet: after drawing the rectangle, name it and its file. */}
      {sheetDraw && (
        <div className="ze-modal-backdrop" onMouseDown={() => setSheetDraw(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Sheet Properties
              <span className="x" title="Cancel" onClick={() => setSheetDraw(null)}>
                ✕
              </span>
            </div>
            <div
              className="ze-label-dialog-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label className="row">
                <span>Sheet name</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={sheetDraw.name}
                  onChange={(e) => setSheetDraw({ ...sheetDraw, name: e.target.value })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <label className="row">
                <span>File name</span>
                <input
                  className="ze-search"
                  value={sheetDraw.file}
                  onChange={(e) => setSheetDraw({ ...sheetDraw, file: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      initSheetDocument(sheetDraw.file);
                      const sheet = makeSheet(
                        sheetDraw.at,
                        sheetDraw.size,
                        sheetDraw.name,
                        sheetDraw.file,
                      );
                      runCommand(addItems({ sheets: [sheet] }));
                      setSelection(new Set([refId('sheet', sheet.uuid, doc.sheets.length)]));
                      setSheetDraw(null);
                    }
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setSheetDraw(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!sheetDraw.name.trim()}
                onClick={() => {
                  initSheetDocument(sheetDraw.file.trim());
                  const sheet = makeSheet(
                    sheetDraw.at,
                    sheetDraw.size,
                    sheetDraw.name.trim(),
                    sheetDraw.file.trim(),
                  );
                  runCommand(addItems({ sheets: [sheet] }));
                  // "c.Push( "Draw Sheet" ); ... m_selectionTool->AddItemToSel( sheet );"
                  // — the new sheet is selected once it is committed, which is
                  // why it lights up only after you let go.
                  setSelection(new Set([refId('sheet', sheet.uuid, doc.sheets.length)]));
                  setSheetDraw(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Text box (DIALOG_TEXT_PROPERTIES' SCH_TEXTBOX variant): the border and
          fill rows join the text and formatting ones. */}
      {textBoxDraw && (
        <DialogTextProperties
          units={units}
          kind="textbox"
          pages={linkPages}
          initial={{
            text: textBoxDraw.text,
            face: textBoxOrig?.effects?.face ?? '',
            hyperlink: textBoxOrig?.hyperlink ?? '',
            bold: !!textBoxOrig?.effects?.bold,
            italic: !!textBoxOrig?.effects?.italic,
            sizeIU:
              textBoxOrig?.effects?.fontSize?.[0] ??
              setup.formatting.defaultTextSizeMils * IU_PER_MILS,
            ...(textBoxOrig?.effects?.color ? { color: textBoxOrig.effects.color } : {}),
            hAlign: hAlignOf(textBoxOrig?.effects?.justify ?? ['left', 'top']),
            vAlign: vAlignOf(textBoxOrig?.effects?.justify ?? ['left', 'top']),
            angle: textBoxOrig?.angle ?? 0,
            excludeFromSim: !!textBoxOrig?.excludedFromSim,
            // "Border" is off when the stroke width is negative (KiCad stores
            // -1 for "no border"); the width row is disabled with it.
            border: (textBoxOrig?.stroke?.width ?? 0) >= 0,
            borderWidthIU: Math.max(0, textBoxOrig?.stroke?.width ?? 0),
            ...(textBoxOrig?.stroke?.color ? { borderColor: textBoxOrig.stroke.color } : {}),
            borderStyle: textBoxOrig?.stroke?.type ?? 'default',
            filled: textBoxOrig?.fill?.type === 'color',
            ...(textBoxOrig?.fill?.color ? { fillColor: textBoxOrig.fill.color } : {}),
          }}
          onOk={commitTextBoxProperties}
          onCancel={() => setTextBoxDraw(null)}
        />
      )}

      {/* Sheet pin (DIALOG_LABEL_PROPERTIES' "Hierarchical Sheet Pin
          Properties"): the pin's name, its flag shape and which side it sits on. */}
      {sheetPinDraw && (
        <DialogLabelProperties
          units={units}
          kind="sheet_pin"
          isNew
          initial={{
            text: sheetPinDraw.name,
            shape: lastSheetPin.current.shape,
            bold: false,
            italic: false,
            sizeIU: setup.formatting.defaultTextSizeMils * IU_PER_MILS,
            spin: spinOfAngle(sheetPinDraw.side),
            autoRotate: false,
            fields: [],
          }}
          onOk={commitSheetPin}
          onCancel={() => setSheetPinDraw(null)}
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
      {tableProps && tablePropsInitial && (
        <DialogTableProperties
          initial={tablePropsInitial.values}
          columnWidths={tablePropsInitial.colWidths}
          isNew={tableProps.kind === 'new'}
          onOk={commitTableProps}
          // Cancel on a freshly drawn table discards it — `delete table;` —
          // which is why it was never added to the document in the first place.
          onCancel={() => setTableProps(null)}
        />
      )}

      <LoadingOverlay label={loading} />
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
function renderSheetNode(
  node: SheetTreeNode,
  depth: number,
  currentPath: string,
  onOpen: (path: string, file: string) => void,
  collapsedPaths: ReadonlySet<string>,
  setCollapsedPaths: (updater: (prev: Set<string>) => Set<string>) => void,
  guides: readonly boolean[] = [],
  isLast = true,
  isFirst = true,
): JSX.Element {
  const hasChildren = node.children.length > 0;
  const collapsed = collapsedPaths.has(node.path);
  const active = node.path === currentPath;
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
    <div key={node.path}>
      <div className="ze-tree-item" onClick={() => onOpen(node.path, node.file)} title={node.file}>
        {guides.map((line, i) => (
          <span key={i} className={`ze-tree-guide${line ? ' line' : ''}`} />
        ))}
        {depth > 0 && (
          <span
            className={`ze-tree-guide line branch${isLast ? ' last' : ''}${isFirst ? ' first' : ''}`}
          />
        )}
        {hasChildren ? (
          <span className={`twisty expandable${collapsed ? '' : ' open'}`} onClick={toggle} />
        ) : (
          <span className="ze-tree-spacer" />
        )}
        <span className="ze-tree-sheet-icon" />
        {/* Only the label pills orange when selected (HIERARCHY_TREE's row
            highlight hugs the text, not the twisty/icon/guide gutter). */}
        <span className={`ze-tree-label${active ? ' active' : ''}`}>
          {node.name}
          {node.page && ` (page ${node.page})`}
        </span>
      </div>
      {!collapsed &&
        node.children.map((c, i) => (
          <div key={c.path}>
            {renderSheetNode(
              c,
              depth + 1,
              currentPath,
              onOpen,
              collapsedPaths,
              setCollapsedPaths,
              depth > 0 ? [...guides, !isLast] : guides,
              i === node.children.length - 1,
              i === 0,
            )}
          </div>
        ))}
    </div>
  );
}
