// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import type { Vec2 } from '@ziroeda/kimath';
import {
  iuToMM,
  mmToIU,
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  type ReportLine,
  type WksSheet,
} from '@ziroeda/common';
import {
  resolveActiveSheet,
  readSheetRef,
  writeSheetRefText,
  listProjectSheetFiles,
  parseProjectSheet,
} from '../drawingsheet/projectSheet.js';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  type DirectiveShape,
  labelFields,
  changeTextType,
  setAttribute,
  alignItems,
  alignToGridCommand,
  autoplaceFields,
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
  transformItems,
  computeNetlist,
  withCleanup,
  refId,
  editSymbolProperties,
  copySelectionText,
  parsePastedText,
  boxSelect,
  symbolBodyBBox,
  labelBox,
  emptyBBox,
  type BBox,
  isEmpty,
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
  getNode,
  selectConnection,
  planNetclassAssignment,
  selectedNets,
  addNetclassAssignment,
  applySelectionFilter,
  defaultSelectionFilter,
  selectionFilterAll,
  type SelectionFilterOptions,
  getSelectedItemsAsText,
  type PasteMode,
  type PageSettings,
  findMatches,
  replaceCommand,
  defaultSearchData,
  annotateHierarchy,
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
  buildNetNavigator,
  netNavigatorOrder,
  stepNetItem,
  type PcbFootprintData,
  buildSheetTree,
  sheetFile,
  sheetName,
  findRootFile,
  addItems,
  makeSheet,
  addSheetPin,
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
  isMandatoryField,
  imagePPI,
  imagePixelSize,
  replaceTextBox,
  replaceTable,
  replaceLabel,
  replaceDirectiveLabel,
  replaceBusEntry,
  replaceLine,
  replaceJunction,
  makeImage,
  makeTextBox,
  makeTable,
  buildPropertyNode,
  History,
  type Schematic,
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
  type PropRow,
  getMsgPanelItems,
  type MsgPanelItem,
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
import { StatusField, STATUS_FIELD_TEMPLATES } from '../../ui/StatusField.js';
import { SymbolPropertiesDialog } from './components/SymbolPropertiesDialog.js';
import { ErcDialog, type ErcDialogNav } from './components/ErcDialog.js';
import {
  DialogSymbolChooser,
  type PickedSymbol,
  type SymbolChooserResult,
} from './dialogs/dialog_symbol_chooser.js';
import { SymbolLibraryBrowser } from './components/SymbolLibraryBrowser.js';
import { loadFootprint, loadFootprintIndex } from '../../widgets/footprint_list.js';
import { libraryUri, loadIndex, loadSymbol } from './symbols/index.js';
import {
  projectFpLibTablePath,
  serializeFpLibTable,
  type FpLibRow,
} from '../footprint/fp_lib_table.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { TOP_TOOLBAR, LEFT_TOOLBAR, RIGHT_TOOLBAR } from './toolbars_sch_editor.js';
import { MenuBar, ContextMenu, type MenuItem } from '../../ui/MenuBar.js';
import { buildMenus, TOOL_HOTKEYS } from './menubar.js';
import { buildHotkeyList } from './hotkey_list.js';
import { DialogAssignNetclass } from './dialogs/dialog_assign_netclass.js';
import { DialogListHotkeys } from './dialogs/dialog_list_hotkeys.js';
import {
  SchNavigateTool,
  flattenHierarchy,
  parentPath,
  type SheetRef,
} from './sch_navigate_tool.js';
import { DialogSchematicFind } from './dialogs/dialog_schematic_find.js';
import {
  DialogIncrementAnnotations,
  type IncrementAnnotationsResult,
} from './dialogs/dialog_increment_annotations.js';
import {
  DialogGlobalEditTextAndGraphics,
  type GlobalEditResult,
} from './dialogs/dialog_global_edit_text_and_graphics.js';
import { DialogChangeSymbols } from './dialogs/dialog_change_symbols.js';
import { DialogEditSymbolsLibId } from './dialogs/dialog_edit_symbols_libid.js';
import { DialogResolveFieldCaseConflicts } from './dialogs/dialog_resolve_field_case_conflicts.js';
import { DialogAnnotate, type AnnotateRun } from './dialogs/dialog_annotate.js';
import { DialogLineProperties, type ItemColor } from './dialogs/dialog_line_properties.js';
import { DialogPageSettings, type PageExportFlags } from './dialogs/dialog_page_settings.js';
import { DialogPasteSpecial } from './dialogs/dialog_paste_special.js';
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
import { findProjectPro, readSchematicSetup, writeSchematicSetupText } from './project_settings.js';
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
import { PreferencesDialog } from '../../prefs/PreferencesDialog.js';
import { settings, gridSizeToIU } from '../../prefs/settings.js';
import {
  useCommonSettings,
  useEeschemaSettings,
  useSchematicTheme,
} from '../../prefs/useSettings.js';
import type { RenderOpts } from './render/renderer.js';
import type { InputPrefs } from './components/SchematicCanvas.js';
import { SchPropertiesPanel } from './components/SchPropertiesPanel.js';
import { SearchPanel } from './components/SearchPanel.js';
import { NetNavigatorPanel } from './components/NetNavigatorPanel.js';
import { DialogUpdateFromPcb } from './dialogs/dialog_update_from_pcb.js';
import { StatusReadout, type StatusReadoutHandle } from './components/StatusReadout.js';
import '../../ui/shell.css';

// What KiCad writes for File > New Schematic: an empty sheet on A4 paper.
// Launching the editor without a project starts here (no bundled demo).
const EMPTY_SCH =
  '(kicad_sch (version 20231120) (generator "ziroeda") (paper "A4")\n  (lib_symbols)\n)\n';

const RADIO_GROUPS: string[][] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];
// Local view toggles; grid/crosshair/line-mode/hidden-pins live in the settings
// store (Preferences) and are derived each render so the two stay in sync.
const DEFAULT_TOGGLES = new Set(['unitsMm', 'showHierarchy', 'showProperties']);
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

// KiCad's Selection Filter categories, laid out in two columns (row-major).
// Selection Filter categories, in PANEL_SCH_SELECTION_FILTER order (the
// "All items" master and "Locked items" special are handled separately).
const FILTER_CATS: [keyof SelectionFilterOptions, string][] = [
  ['ruleAreas', 'Rule Areas'],
  ['symbols', 'Symbols'],
  ['pins', 'Pins'],
  ['wires', 'Wires'],
  ['labels', 'Labels'],
  ['graphics', 'Graphics'],
  ['images', 'Images'],
  ['text', 'Text'],
  ['otherItems', 'Other items'],
];

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
  readBoardFootprints,
  onShowSymbolEditor,
  onShowFootprintEditor,
  onShowCalculator,
  initialProject,
  initialFile,
  placeRequest,
  onProjectChange,
  onPersistFiles,
  onOutputFile,
  registerAutosaveFlush,
  extraSheetFiles,
  projectName,
  rootPro,
  onCrossProbeNet,
}: {
  onExitToHome: () => void;
  onShowPcb?: () => void;
  /** Tools > Update PCB from Schematic (F8): switch to the PCB editor and run
   *  its update dialog. Absent when the project has no board. */
  onUpdatePcb?: () => void;
  /** Tools > Update Schematic from PCB: the board's footprints, read on demand
   *  so a project with no board simply has no entry. Returning null means the
   *  board could not be read, which the caller reports. */
  readBoardFootprints?: () => PcbFootprintData[] | null;
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
  /** Write a generated output file (plot / export) into the project file
   *  manager instead of the browser download folder. When absent, outputs fall
   *  back to a browser download. */
  onOutputFile?: (name: string, bytes: Uint8Array, mime: string) => void;
  /** Register a flush the host calls before leaving/reopening, so a pending
   *  autosave is written out first (the "edit → home → reopen" case). */
  registerAutosaveFlush?: (fn: (() => void) | null) => void;
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
  const [placeLib, setPlaceLibOnly] = useState<LibSymbol | null>(null);
  // A ready-built symbol on the cursor instead of one made from the library's
  // defaults: Place Next Symbol Unit attaches a copy of an existing placement.
  const [placeInstance, setPlaceInstance] = useState<SchSymbol | null>(null);
  // Every other placement path starts (or abandons) a library placement through
  // this, which drops the copy, so it can never outlive its own run.
  const setPlaceLib = useCallback((lib: LibSymbol | null) => {
    setPlaceLibOnly(lib);
    setPlaceInstance(null);
  }, []);
  // Unit attached to the cursor, and the chooser's checkbox state driving the
  // after-placement continuation (KeepSymbol / PlaceAllUnits stepping).
  const [placeUnit, setPlaceUnit] = useState(1);
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
  const [tableDraw, setTableDraw] = useState<{ rows: number; cols: number } | null>(null);
  const [tableEdit, setTableEdit] = useState<{
    index: number;
    rows: number;
    cols: number;
    texts: string[];
  } | null>(null);
  const [pendingImage, setPendingImage] = useState<{ data: string } | null>(null);
  // Keyboard-initiated grabbed move (SCH_MOVE_TOOL): M leaves connected wires
  // behind, G drags them along. A fresh nonce restarts the grab.
  const [hotkeyListOpen, setHotkeyListOpen] = useState(false);
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
  const [pageEdit, setPageEdit] = useState<{ page: string } | null>(null);
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
  const [prefsOpen, setPrefsOpen] = useState(false);
  const common = useCommonSettings();
  const es = useEeschemaSettings();
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
  const statusRef = useRef<StatusReadoutHandle>(null);
  const onCursorMove = useCallback((world: Vec2 | null) => {
    cursorRef.current = world;
    statusRef.current?.setCursor(world);
  }, []);
  const onScaleChange = useCallback((s: number) => {
    statusRef.current?.setScale(s);
  }, []);
  // The symbol whose properties dialog is open (its refId), or null.
  const [propsTarget, setPropsTarget] = useState<string | null>(null);
  // Items parsed from the clipboard, attached to the cursor until dropped.
  const [pastePending, setPastePending] = useState<PastePayload | null>(null);
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
  const [ercRunning, setErcRunning] = useState<readonly string[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const libById = useMemo<Map<string, LibSymbol>>(
    () => new Map((doc?.libSymbols ?? []).map((l) => [l.libId, l])),
    [doc?.libSymbols],
  );

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

  const onSelect = useCallback((id: string | null, additive: boolean) => {
    // A selection does *not* clear the net highlight: upstream's highlightNet
    // never touches the selection and vice versa, the highlight lives until
    // Esc, `~`, or a highlight-tool click on empty space.
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      // A filtered-out hit (locked / disabled type) behaves like empty space.
      if (filterIds(new Set([id])).size === 0) return additive ? prev : new Set();
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

  // Right-click with the select tool (SCH_SELECTION_TOOL): an unselected item
  // under the cursor becomes the selection before the menu opens; over a
  // selected item or empty canvas the selection is kept and the menu applies
  // to it (KiCad selects the item, then pops the TOOL_MENU).
  const onContextMenuRequest = useCallback(
    (
      x: number,
      y: number,
      hit: ItemRef | null,
      pointEdit: { world: Vec2; handle: EditHandle | null; tolerance: number },
    ) => {
      if (hit)
        setSelection((prev) => (prev.has(hit.id) ? prev : new Set(promote(new Set([hit.id])))));
      setCtxMenu({ x, y, hit, pointEdit });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
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

  // ----- Choose Symbol dialog (DIALOG_SYMBOL_CHOOSER) ----------------------------
  const chooserOpen = (activeTool === 'placeSymbol' || activeTool === 'placePower') && !placeLib;

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
        const lib = libs.get(s.libId);
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
      if (placeUnit < unitCount) {
        setPlaceUnit(placeUnit + 1);
        return;
      }
      if (keepSymbol) {
        setPlaceUnit(1); // wrap around and keep cycling
        return;
      }
    } else if (keepSymbol) {
      return; // same symbol stays on the cursor
    }
    setPlaceLib(null);
    setPlaceUnit(1);
  }, [placeUnit, placeInstance, setPlaceLib]);

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
      const lib = libById.get(doc.symbols[symbolIndex]!.libId);
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
    (page: string) => {
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
  // The drawing sheet to draw (override else the project reference), its file
  // name for the dialog, and the project's .kicad_wks choices.
  const activeSheet = useMemo(
    () => (sheetOverride ? sheetOverride.sheet : resolveActiveSheet(allFiles)),
    [allFiles, sheetOverride],
  );
  const sheetRefName = sheetOverride ? sheetOverride.name : readSheetRef(rawFiles);
  const sheetChoices = useMemo(
    () =>
      listProjectSheetFiles(allFiles).map((name) => ({
        name,
        sheet: parseProjectSheet(allFiles, name),
      })),
    [allFiles],
  );
  // WX_INFOBAR message posted by a tool (null = hidden).
  const [infoBar, setInfoBar] = useState<string | null>(null);
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

  /** Apply one sheet's new symbol list, on its own undo history when off-screen. */
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
  const changeSymbolsFieldNames = useMemo(() => {
    const names = ['Reference', 'Value', 'Footprint', 'Datasheet'];
    const seen = new Set(names);
    for (const sym of doc?.symbols ?? []) {
      for (const f of sym.fields) {
        if (!seen.has(f.key)) {
          seen.add(f.key);
          names.push(f.key);
        }
      }
    }
    for (const lib of doc?.libSymbols ?? []) {
      for (const f of lib.properties) {
        if (!seen.has(f.key)) {
          seen.add(f.key);
          names.push(f.key);
        }
      }
    }
    return names;
  }, [doc]);

  // Change Symbols / Update Symbols from Library (DIALOG_CHANGE_SYMBOLS). The
  // dialog stays open on its report, as upstream's does.
  const runChangeSymbols = useCallback(
    (o: ChangeSymbolsOptions) => {
      const sheets = annotateSheets('all', false);
      const libs = hierarchyLibs(sheets);
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
      const one = (d: Schematic, name: string, file: string): void => {
        // Netclass visuals and text variables resolve per sheet.
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
        // Every plot lands in the project's file manager (the cloud "disk");
        // "Download a copy to this computer" additionally streams it out, and
        // "Open file after plot" navigates the pre-opened preview tab to it.
        const sink: PlotSink = (blob, filename) => {
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
        if (format === 'svg') plotSvg(d, plotTheme, od, name, sink);
        else if (format === 'png') void plotPng(d, plotTheme, od, name, sink);
        else if (format === 'dxf') plotDxf(d, plotTheme, od, name, sink);
        else if (format === 'ps') plotPs(d, plotTheme, od, name, sink);
        else void plotPdf(d, plotTheme, od, name, sink);
      };
      if (allPages) {
        const sheets = [...liveDocs()];
        // SCH_PLOTTER::Plot: nothing to write is an error, not a silent no-op.
        if (sheets.length === 0) report('No sheets to plot.', RPT_SEVERITY_ERROR);
        for (const [file, d] of sheets)
          one(d, file.replace(/\.kicad_sch$/i, '') || outputBaseName(), file);
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
    setErcResult(null);
    setErcRunning(null);
    setPropsTarget(null);
  }, []);

  const loadText = useCallback(
    async (text: string, name?: string) => {
      setLoading('Loading schematic…');
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
        if (name) setFileName(name);
        setError(null);
        // Fit after React commits the new doc to the canvas.
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    },
    [resetTransient],
  );

  // Open a whole KiCad project: parse every .kicad_sch, find the root (the
  // .kicad_pro's schematic, else the sheet nothing references), and show it.
  const loadProject = useCallback(
    async (files: PickedFile[], startFile?: string) => {
      setLoading('Loading schematic…');
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
        setFileName(start);
        setError(problems.length ? `Some sheets failed to load: ${problems.join('; ')}` : null);
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } finally {
        setLoading(null);
      }
    },
    [resetTransient, rootPro],
  );

  // A project handed over from the home page's Open Project picker.
  useEffect(() => {
    if (initialProject && initialProject.length > 0)
      void loadProject(initialProject, initialFile ?? undefined);
    // Reseed the raw files (drawing-sheet reference + .kicad_wks choices) and
    // drop any in-session sheet override for the freshly opened project.
    setRawFiles(initialProject ?? []);
    setSheetOverride(null);
    // Hydrate the Schematic Setup from the project's .kicad_pro (SCHEMATIC/ERC/
    // NET_SETTINGS live in the project file, like KiCad's project load).
    setSetup(readSchematicSetup(initialProject ?? [], rootPro ?? undefined));
    // rootPro is a dep so switching the active project (same folder, different
    // .kicad_pro) reloads with the newly-pinned root sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProject, rootPro]);

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
        const idx = doc.tables.findIndex((t, i) => refId('table', t.uuid, i) === id);
        if (idx !== -1) {
          const t = doc.tables[idx]!;
          setTableEdit({
            index: idx,
            rows: t.rowHeights.length,
            cols: t.columnCount,
            texts: t.cells.map((c) => c.text),
          });
        }
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
        const field = /^(.*):field(\d+)$/.exec(id);
        if (field) {
          const si = d.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === field[1]);
          const fi = Number(field[2]);
          if (si !== -1 && d.symbols[si]!.fields[fi]) setFieldEdit({ symbol: si, index: fi });
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

  const promptOpen = useCallback(() => fileInputRef.current?.click(), []);

  // Doc edits mark the title dirty; the flag clears after the app's coalesced
  // autosave window (1.2 s) has taken the change. Mount / file switches skip.
  useEffect(() => {
    dirtySkipRef.current = true;
  }, [currentFile]);
  useEffect(() => {
    if (dirtySkipRef.current) {
      dirtySkipRef.current = false;
      return;
    }
    setDirty(true);
    const id = setTimeout(() => setDirty(false), 1600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const save = useCallback(() => {
    setDirty(false);
    setDoc((d) => {
      if (!d) return d;
      const text = serializeSchematic(d);
      if (onPersistFiles && currentFile !== DEFAULT_FILE) {
        // Save writes into the project's file manager (cloud storage); a local
        // copy can be downloaded from there (or via Save a Copy).
        onPersistFiles([{ name: currentFile, text }]);
        return d;
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download =
        currentFile !== DEFAULT_FILE
          ? currentFile
          : (fileName ?? `${d.titleBlock?.title ?? 'schematic'}.kicad_sch`);
      a.click();
      URL.revokeObjectURL(url);
      return d;
    });
  }, [fileName, currentFile]);

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
      e.clipboardData?.setData('text/plain', copySelectionText(doc, selection));
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || propsTarget !== null || selection.size === 0 || !doc) return;
      e.clipboardData?.setData('text/plain', copySelectionText(doc, selection));
      e.preventDefault();
      runCommand(deleteByIds(selection));
      setSelection(new Set());
    };
    const onPaste = (e: ClipboardEvent): void => {
      if (hidden() || isTyping() || propsTarget !== null || !doc) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const payload = parsePastedText(text, doc);
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
  }, [doc, selection, propsTarget, runCommand]);

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
    if (!doc || selection.size === 0) return;
    const payload = parsePastedText(copySelectionText(doc, selection), doc);
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
  }, [doc, selection]);

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
    {
      const wanted = new Set<string>();
      for (const d of liveDocs().values()) for (const sym of d.symbols) wanted.add(sym.libId);
      await Promise.all(
        [...wanted].map(async (libId) => {
          if (ercLibrarySymbols.current.has(libId)) return;
          const sep = libId.indexOf(':');
          if (sep <= 0) return;
          const libName = libId.slice(0, sep);
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
          for (const assoc of libs.get(sym.libId)?.associatedFootprints ?? []) {
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
    for (const sheet of hierSheets) {
      if (!sheetPathFor.has(sheet.file))
        sheetPathFor.set(sheet.file, hier.humanPaths.get(sheet.path) ?? '/');
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
        // One sheet's phases replace the previous sheet's in the message list.
        const line = step.value;
        if (!messages.includes(line)) {
          messages.push(line);
          setErcRunning([...messages]);
          await frame();
        }
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
  }, [doc, setup, ercOptions, ercRunning, liveDocs, flatSheets, currentFile]);

  // Clicking a violation centres the fault and selects the offending items.
  // DIALOG_ERC's cross-probe: select the violation's items, and scroll the
  // canvas to them only when "Center on Cross-probe" is on.
  const locateViolation = useCallback(
    (v: ErcViolation, center = true, itemId?: string) => {
      // A marker on another sheet: open its sheet first (KiCad's cross-probe
      // follows the marker's SCH_SHEET_PATH).
      if (v.file && v.file !== currentFile) {
        const target = flatSheets.find((s) => s.file === v.file);
        if (target) switchSheet(target.path, target.file);
      }
      // FocusOnItem( ResolveItem( RC_TREE_MODEL::ToUUID( row ) ) ): a heading
      // row resolves to the *marker*, so it brightens the marker and leaves the
      // schematic items alone; only an item row focuses that item.
      if (center) controller.current?.centerOn(v.at);
      if (itemId) {
        setErcFocusedMarker(null);
        setSelection(new Set([itemId]));
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
        sizeIU: gridSizeToIU(es.window.grid.sizes[es.window.grid.last_size_idx] ?? '50 mil'),
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
      centerOnZoom: common.input.center_on_zoom,
      reverseZoom: common.input.reverse_scroll_zoom,
      scrollModZoom: common.input.scroll_modifier_zoom,
      scrollModPanH: common.input.scroll_modifier_pan_h,
      scrollModPanV: common.input.scroll_modifier_pan_v,
      reverseScrollPanH: common.input.reverse_scroll_pan_h,
      horizontalPan: common.input.horizontal_pan,
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
    // The Image tool opens a file picker; the image then follows the cursor
    // (SCH_ACTIONS::placeImage).
    if (id === 'image') {
      imageInputRef.current?.click();
      return;
    }
    // Table tool: prompt for the grid size, then place the table (SCH_TABLE).
    if (id === 'table') {
      setTableDraw({ rows: 2, cols: 2 });
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

  const onSheetPinClick = useCallback((index: number, at: Vec2, side: SheetSide) => {
    setSheetPinDraw({ index, at, side, name: '' });
  }, []);

  const onTextBoxDrawn = useCallback((start: Vec2, end: Vec2) => {
    setTextBoxDraw({ start, end, text: '' });
  }, []);

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
          runCommand(
            addItems({
              textBoxes: [makeTextBox(tbd.start, tbd.end, r.text, { effects, stroke, fill })],
            }),
          );
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

  const commitTable = useCallback(() => {
    setTableDraw((td) => {
      if (!td) return null;
      const rows = Math.max(1, Math.min(50, Math.round(td.rows)));
      const cols = Math.max(1, Math.min(50, Math.round(td.cols)));
      // Anchor at the last cursor position, or a sensible default sheet location.
      const at = cursorRef.current ?? { x: 500000, y: 500000 };
      runCommand(addItems({ tables: [makeTable(at, rows, cols)] }));
      return null;
    });
  }, [runCommand]);

  const commitTableEdit = useCallback(() => {
    setTableEdit((te) => {
      if (!te || !doc) return null;
      const orig = doc.tables[te.index];
      if (orig) {
        const cells = orig.cells.map((c, i) => ({ ...c, text: te.texts[i] ?? c.text }));
        runCommand(replaceTable(te.index, { ...orig, cells }));
      }
      return null;
    });
  }, [doc, runCommand]);

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
  const startDirectivePlacement = useCallback((r: LabelPropsResult) => {
    const shape = r.shape as DirectiveShape;
    lastDirective.current = { shape, pinLength: r.sizeIU, spin: r.spin };
    setPendingDirective({
      shape,
      pinLength: r.sizeIU,
      netclass: r.fields.find((f) => f.key === 'Netclass')?.value.trim() ?? '',
      angle: SPIN_ANGLE[r.spin],
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
  const onLabelPlaced = useCallback((id?: string) => {
    if (id) repeatItemsRef.current = [id];
    setPendingDirective(null);
    setLabelQueue((q) => {
      const [next, ...rest] = q;
      setPendingLabel((p) => (p && next !== undefined ? { ...p, text: next } : null));
      return rest;
    });
  }, []);

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
  const shapeEditName = useCallback(
    (se: { kind: 'graphic' | 'line'; index: number }): string => {
      const kind = se.kind === 'line' ? 'polyline' : (shapeEditItem(se)?.kind ?? 'shape');
      return kind.charAt(0).toUpperCase() + kind.slice(1);
    },
    [shapeEditItem],
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
        runCommand(
          replaceSymbol(fe.symbol, {
            ...sym,
            fields: sym.fields.map((f, i) => (i === fe.index ? next : f)),
          }),
        );
        return null;
      });
    },
    [doc, runCommand],
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
        if (img) runCommand(addItems({ images: [makeImage(at, img.data)] }));
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
      setPendingImage({ data: comma >= 0 ? res.slice(comma + 1) : res });
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
        setHotkeyListOpen(true);
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
      else if (id === 'zoomTool') setActiveTool('zoomTool');
      else if (id === 'zoomFitSelection') {
        // Zoom to Selected Objects: fit the view to the selection's extent.
        const box = emptyBBox();
        doc?.symbols.forEach((s, i) => {
          if (selection.has(refId('symbol', s.uuid, i))) {
            const b = symbolBodyBBox(s, libById.get(s.libId));
            includePoint(box, { x: b.minX, y: b.minY });
            includePoint(box, { x: b.maxX, y: b.maxY });
          }
        });
        doc?.labels.forEach((l, i) => {
          if (selection.has(refId('label', l.uuid, i))) {
            const b = labelBox(l);
            includePoint(box, { x: b.minX, y: b.minY });
            includePoint(box, { x: b.maxX, y: b.maxY });
          }
        });
        doc?.lines.forEach((l, i) => {
          if (selection.has(refId('line', l.uuid, i))) {
            includePoint(box, l.start);
            includePoint(box, l.end);
          }
        });
        doc?.junctions.forEach((j, i) => {
          if (selection.has(refId('junction', j.uuid, i))) includePoint(box, j.at);
        });
        doc?.sheets.forEach((sh, i) => {
          if (selection.has(refId('sheet', sh.uuid, i))) {
            includePoint(box, sh.at);
            includePoint(box, { x: sh.at.x + sh.size.w, y: sh.at.y + sh.size.h });
          }
        });
        if (!isEmpty(box)) controller.current?.zoomToBox(box);
      } else if (id === 'undo') undo();
      else if (id === 'redo') redo();
      else if (id === 'open') promptOpen();
      else if (id === 'save') save();
      else if (id === 'erc') setErcOpen(true);
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
      } else if (id === 'showPcbNew') onShowPcb?.();
      else if (id === 'updatePcbFromSch') onUpdatePcb?.();
      else if (id === 'updateSchFromPcb') {
        const fps = readBoardFootprints?.() ?? null;
        // A board that cannot be read is worth saying so about; an empty one is
        // a legitimate answer and the dialog reports "no changes".
        if (fps) setBackAnnotateFps(fps);
        else setInfoBar('No board to read, or the board could not be parsed.');
      } else if (id === 'symbolEditor') onShowSymbolEditor?.();
      else if (id === 'footprintEditor') onShowFootprintEditor?.();
      else if (id === 'bom') openFieldsTable('bom');
      else if (id === 'exportNetlist') setNetlistOpen(true);
      else if (id === 'editSymbolFields') openFieldsTable('edit');
      else if (id === 'symbolBrowser') setBrowserOpen(true);
      else if (id === 'assignFootprints') setAssignFpOpen(true);
      else if (id === 'showCalculator') onShowCalculator?.();
      // ACTIONS::selectAll / unselectAll (also on Ctrl+A / Ctrl+Shift+A).
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
      // Lock / Unlock / Toggle Lock (SCH_EDIT_TOOL): protect symbols from edits.
      else if (id === 'lock' || id === 'unlock' || id === 'toggleLock')
        setSelection((sel) => {
          if (sel.size > 0)
            runCommand(
              setSymbolsLockedCommand(
                sel,
                id === 'lock' ? 'lock' : id === 'unlock' ? 'unlock' : 'toggle',
              ),
            );
          return sel;
        });
      else if (id === 'openPreferences') setPrefsOpen(true);
      else if (id === 'close') onExitToHome();
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
      // ACTIONS::copyAsText (SCH_EDITOR_CONTROL::CopyAsText): the selected
      // items' shown texts, newline-joined, to the system clipboard.
      else if (id === 'copyAsText') {
        if (doc && selection.size > 0) {
          const text = getSelectedItemsAsText(doc, selection);
          if (text) void navigator.clipboard?.writeText(text);
        }
      } else if (id === 'pasteSpecial') setPasteSpecialOpen(true);
      else if (id === 'paste')
        void navigator.clipboard?.readText().then((text) => {
          setDoc((d) => {
            const payload = d ? parsePastedText(text, d) : null;
            if (payload) {
              setActiveTool('select');
              setPastePending(payload);
            }
            return d;
          });
        });
      else if (id === 'delete')
        setSelection((sel) => {
          if (sel.size > 0) runCommand(deleteByIds(sel));
          return new Set();
        });
      else if (TX[id])
        setSelection((sel) => {
          if (sel.size > 0) runCommand(transformItems(sel, TX[id]!));
          return sel;
        });
    },
    [
      undo,
      redo,
      save,
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
    ],
  );

  // The selection context menu, assembled the way the upstream TOOL_MENU is:
  // each tool's Init() contributions in priority order, GROUP_TOOL's Grouping
  // submenu (100), SCH_MOVE_TOOL move/drag and enterSheet/leaveSheet (150),
  // SCH_EDIT_TOOL transforms + properties (200), wire placements (250), the
  // clipboard block (300), then selectAll/unselectAll (400).
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
    const items: MenuItem[] = [];
    if (selection.size > 0) {
      // GROUP_CONTEXT_MENU: all four items always shown, greyed per condition
      // (GROUP_TOOL::update Enable()). Labels are the actions' FriendlyNames.
      items.push({
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
        items.push({ label: 'Locking', items: lockItems });
      }
      items.push(
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
      if (netlist && selectedNets(netlist, selection).length > 0)
        items.push({ label: 'Assign Netclass...', icon: 'assignNetclass', action: assignNetclass });
      // SCH_ACTIONS::breakWire / ::slice, both offered whenever a line is
      // selected (SCH_SELECTION_TOOL's `linesSelection` condition). Break
      // divides into connected segments, Slice into unconnected ones.
      if (doc && [...selection].some((id) => id.startsWith('line:')))
        items.push(
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
      if (hit?.kind === 'sheet')
        items.push(
          {
            label: 'Enter Sheet',
            icon: 'enterSheet',
            action: () => onEditItem(hit.id, 'sheet'),
          },
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
          // SCH_ACTIONS::cleanupSheetPins: drop the pins that no longer name a
          // hierarchical label inside the sheet.
          {
            label: 'Cleanup Sheet Pins',
            icon: 'cleanupSheetPins',
            action: () => {
              if (!doc) return;
              const si = doc.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === hit.id);
              const sh = doc.sheets[si];
              if (!sh) return;
              const file = sh.fields.find((f) => f.key === 'Sheetfile')?.value ?? '';
              const child = liveDocs().get(file);
              // Without the child document there is nothing to check against,
              // and dropping every pin would be worse than doing nothing.
              if (!child) return;
              const cmd = cleanupSheetPins(doc, si, hierarchicalLabelNames(child));
              if (cmd) runCommand(cmd);
            },
          },
        );
      // SCH_POINT_EDITOR's own two menu items, shown for a polyline under the
      // same conditions upstream gates them on: the cursor has to be on the
      // shape to add a corner, and on one of its vertices to remove one.
      {
        const pe = ctxMenu?.pointEdit;
        const target =
          doc && selection.size === 1 ? pointEditTarget(doc, [...selection][0]!) : null;
        if (doc && target && pe) {
          if (canAddCorner(doc, target, pe.world, pe.tolerance))
            items.push({
              label: 'Add Corner',
              icon: 'addCorner',
              action: () => {
                const next = addCorner(doc, target, pe.world);
                if (next) runCommand(reshapeCommand('Add Corner', next));
              },
            });
          if (pe.handle && canRemoveCorner(doc, target, pe.handle))
            items.push({
              label: 'Remove Corner',
              icon: 'removeCorner',
              action: () => {
                const next = removeCorner(doc, target, pe.handle!);
                if (next) runCommand(reshapeCommand('Remove Corner', next));
              },
            });
        }
      }
      // SCH_ACTIONS::autoplaceFields, offered whenever a symbol is selected.
      if (
        doc &&
        [...selection].some((id) => doc.symbols.some((sy, i) => refId('symbol', sy.uuid, i) === id))
      )
        items.push({
          label: 'Autoplace Fields',
          icon: 'autoplaceFields',
          shortcut: 'O',
          action: () => {
            const cmd = autoplaceFields(
              doc,
              selection,
              libById,
              {
                allowRejustify: es.autoplace_fields.allow_rejustify,
                alignToGrid: es.autoplace_fields.align_to_grid,
              },
              drawableArea(doc),
            );
            if (cmd) runCommand(cmd);
          },
        });
      // SYMBOL_UNIT_MENU: which unit of a multi-unit part this placement is.
      // Units already on the sheet are annotated rather than disabled, since
      // re-picking one is legitimate when swapping two of them over.
      if (doc && selection.size === 1) {
        const si = doc.symbols.findIndex(
          (sy, i) => refId('symbol', sy.uuid, i) === [...selection][0],
        );
        const sym = si === -1 ? undefined : doc.symbols[si];
        const lib = sym ? libById.get(sym.libId) : undefined;
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
          items.push({ label: 'Symbol Unit', items: unitItems });
        }
      }
      // SCH_EDIT_TOOL's Attributes submenu, the same five item edits the Edit
      // menu carries (SCH_EDIT_TOOL::SetAttribute).
      if (doc && Object.values(ATTRIBUTE_IDS).some((a) => canSetAttribute(doc, selection, a)))
        items.push({
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
          const isPower = !!libById.get(sym.libId)?.isPower;
          const entries: MenuItem[] = [];
          for (const [key, label, shortcut] of [
            ['Reference', 'Edit Reference...', 'U'],
            ['Value', 'Edit Value...', 'V'],
            // Footprint is meaningless on a power symbol, so upstream skips it.
            ...(isPower ? [] : [['Footprint', 'Edit Footprint...', 'F']]),
          ] as [string, string, string][]) {
            const fi = sym.fields.findIndex((f) => f.key === key);
            if (fi !== -1)
              entries.push({
                label,
                shortcut,
                action: () => setFieldEdit({ symbol: si, index: fi }),
              });
          }
          if (entries.length > 0) items.push({ label: 'Edit Main Fields', items: entries });
          items.push(
            {
              label: 'Change Symbol...',
              action: () => {
                setChangeSymbolsMessages([]);
                setChangeSymbolsMode('change');
              },
            },
            {
              label: 'Update Symbol...',
              action: () => {
                setChangeSymbolsMessages([]);
                setChangeSymbolsMode('update');
              },
            },
          );
        }
      }
      // SCH_ACTIONS::cycleBodyStyle: step to the De Morgan alternate.
      if (doc && cycleBodyStyle(doc, selection, libById))
        items.push({
          label: 'Cycle Body Style',
          icon: 'cycleBodyStyle',
          action: () => {
            const cmd = cycleBodyStyle(doc, selection, libById);
            if (cmd) runCommand(cmd);
          },
        });
      // SCH_ACTIONS::swap (Alt+S).
      if (doc && canSwap(doc, selection))
        items.push({
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
        items.push({
          label: 'Align Items to Grid',
          action: () => {
            const grid = gridSizeToIU(
              es.window.grid.sizes[es.window.grid.last_size_idx] ?? '50 mil',
            );
            const cmd = alignToGridCommand(doc, selection, libById, grid);
            if (cmd) runCommand(cmd);
          },
        });
      // SCH_ALIGN_TOOL's submenu, shown once there is more than one thing to
      // line up. The click position is the target hint (selectTarget prefers
      // the item under the cursor), so it is passed through.
      if (selection.size > 1)
        items.push({
          label: 'Align Items',
          items: (['top', 'bottom', 'left', 'right', 'centerX', 'centerY'] as AlignMode[]).map(
            (mode) => ({
              label: ALIGN_LABELS[mode],
              action: () => {
                if (!doc) return;
                const grid = gridSizeToIU(
                  es.window.grid.sizes[es.window.grid.last_size_idx] ?? '50 mil',
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
      items.push(
        { sep: true },
        {
          label: 'Transform Selection',
          items: [
            act('Rotate Counterclockwise', 'rotateCCW', 'R'),
            act('Rotate Clockwise', 'rotateCW', 'Shift+R'),
            act('Mirror Vertically', 'mirrorV', 'Y'),
            act('Mirror Horizontally', 'mirrorH', 'X'),
          ],
        },
      );
      // SCH_EDIT_TOOL's "Change To" submenu (toLabel / toGLabel / toHLabel /
      // toDLabel / toText / toTextBox), shown when the selection holds
      // anything convertible. Each entry greys out for a selection that is
      // already that type, as upstream skips those items.
      {
        const convertible = doc ? changeTextType(doc, selection, 'text_box') !== null : false;
        const anyText =
          convertible || (doc ? changeTextType(doc, selection, 'label') !== null : false);
        if (anyText)
          items.push({
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
        items.push({
          label: 'Properties...',
          icon: 'properties',
          shortcut: 'E',
          action: () => openProperties([...selection][0]!),
        });
      // SCH_ACTIONS::unfoldBus (C): BUS_UNFOLD_MENU lists the bus's members and
      // picking one drops an entry plus a label for it.
      if (hit?.kind === 'line' && doc && ctxMenu?.pointEdit) {
        const bi = doc.lines.findIndex((l, i) => refId('line', l.uuid, i) === hit.id);
        const members = bi === -1 ? [] : busUnfoldMembers(doc, bi, busAliases);
        if (members.length)
          items.push({
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
        items.push(
          { sep: true },
          tool('Place Junction', 'junction', 'J'),
          tool('Place Net Label', 'placeLabel', 'L'),
          tool('Place Global Label', 'placeGlobalLabel', 'Ctrl+L'),
          tool('Place Hierarchical Label', 'placeHierLabel', 'H'),
          // placeClassLabel sits with the other label tools on a wire.
          tool('Place Netclass Directive Label', 'placeClassLabel'),
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
        if (chainItems.length > 0) items.push({ sep: true }, ...chainItems);
      }
      items.push(
        { sep: true },
        {
          // SCH_ACTIONS::selectConnection, on the selection context menu as
          // well as Ctrl+4 (sch_selection_tool.cpp's expandableSelection).
          label: 'Select/Expand Connection',
          shortcut: 'Ctrl+4',
          action: expandSelectionAlongConnection,
        },
        { sep: true },
        act('Cut', 'cut', 'Ctrl+X'),
        act('Copy', 'copy', 'Ctrl+C'),
        act('Copy as Text', 'copyAsText', 'Ctrl+Shift+C'),
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
      items.push(tool('Draw Wires', 'drawWire', 'W'), tool('Draw Buses', 'drawBus', 'B'));
      if (parentPath(currentPath) !== null)
        items.push({
          label: 'Leave Sheet',
          icon: 'navUp',
          shortcut: 'Alt+Bksp',
          action: () => onTopAction('navUp'),
        });
      items.push({ sep: true }, act('Paste', 'paste', 'Ctrl+V'));
    }
    items.push(
      { sep: true },
      act('Select All', 'selectAll', 'Ctrl+A'),
      act('Unselect All', 'unselectAll', 'Ctrl+Shift+A'),
    );
    // EDA_DRAW_FRAME::AddStandardSubMenus, rank 1000: every canvas context
    // menu in KiCad ends with these two, whatever is selected.
    items.push(
      { sep: true },
      {
        label: 'Zoom',
        items: [
          act('Zoom to Fit', 'zoomFit', 'Ctrl+0'),
          act('Zoom to Objects', 'zoomFitObjects', 'Ctrl+Home'),
          act('Zoom In', 'zoomIn', 'F1'),
          act('Zoom Out', 'zoomOut', 'F2'),
          act('Refresh', 'zoomRedraw', 'F5'),
        ],
      },
      {
        label: 'Grid',
        items: [
          ...es.window.grid.sizes.map((size, i) => ({
            label: size,
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
    return items;
  };

  const onLeftToggle = useCallback(
    (id: string) => {
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
      setLocalToggles((prev) => {
        const next = new Set(prev);
        const group = RADIO_GROUPS.find((g) => g.includes(id));
        if (group) {
          for (const g of group) next.delete(g);
          next.add(id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [doc, selection, runCommand],
  );

  const menus = useMemo(
    () =>
      buildMenus(
        { tool: onToolSelect, action: onTopAction, toggle: onLeftToggle },
        {
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
      doc,
      selection,
    ],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'schematic') !== 'schematic') return;
      // While a modal properties dialog is open, only Escape acts on the editor.
      if (propsTarget !== null && e.key !== 'Escape') return;
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setPrefsOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        promptOpen();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        // ACTIONS::print (Ctrl+P).
        e.preventDefault();
        setPrintOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        // ACTIONS::copyAsText (Ctrl+Shift+C).
        e.preventDefault();
        onTopAction('copyAsText');
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        // ACTIONS::pasteSpecial (Ctrl+Shift+V).
        e.preventDefault();
        setPasteSpecialOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        // SCH_ACTIONS::placeGlobalLabel default hotkey (Ctrl+L).
        e.preventDefault();
        onToolSelect('placeGlobalLabel');
      } else if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'f') {
        // ACTIONS::findAndReplace (Ctrl+Alt+F).
        e.preventDefault();
        openFindDialog('replace');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.altKey) {
        // ACTIONS::find (Ctrl+F).
        e.preventDefault();
        openFindDialog('find');
      } else if (e.key === 'F3' && (findOpen || searchData.findString)) {
        // ACTIONS::findNext / findPrevious (F3 / Shift+F3).
        e.preventDefault();
        doFind(e.shiftKey ? -1 : 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isTyping()) {
        // ACTIONS::selectAll / unselectAll (Ctrl+A / Ctrl+Shift+A). Select-all
        // is a greedy box select over the whole plane.
        e.preventDefault();
        if (e.shiftKey) setSelection(new Set());
        else
          setDoc((d) => {
            // Honors the Selection Filter, like the menu Select All.
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
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        // ACTIONS::zoomFitScreen (Ctrl+0).
        e.preventDefault();
        controller.current?.zoomToFit();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
        // ACTIONS::zoomFitObjects (Ctrl+Home): the drawn objects, not the page.
        e.preventDefault();
        controller.current?.zoomToFit(true);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        // ACTIONS::zoomIn (Ctrl++).
        e.preventDefault();
        controller.current?.zoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        // ACTIONS::zoomOut (Ctrl+-).
        e.preventDefault();
        controller.current?.zoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        // ACTIONS::zoomRedraw (Ctrl+R): repaint without changing the view.
        e.preventDefault();
        controller.current?.redraw();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'F5') {
        // ACTIONS::zoomTool (Ctrl+F5): drag a rectangle to zoom to it.
        e.preventDefault();
        setActiveTool('zoomTool');
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
      } else if (e.key === 'F8' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // ACTIONS::updatePcbFromSchematic's default hotkey, the same one the PCB
        // frame answers.
        e.preventDefault();
        onUpdatePcb?.();
      } else if (e.key === 'F5' && !e.altKey && !e.shiftKey) {
        // ACTIONS::zoomRedraw default hotkey (F5).
        e.preventDefault();
        controller.current?.redraw();
      } else if (
        e.key === 'F1' &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        repeatItemsRef.current.length > 0 &&
        doc
      ) {
        // SCH_ACTIONS::repeatDrawItem (F1). It shares the key with
        // ACTIONS::zoomInCenter; upstream resolves that by tool scope, and
        // here by there being something to repeat.
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
        // ACTIONS::listHotKeys (Ctrl+F1). Checked before the bare-F1 zoom arm
        // below, which requires no modifiers, so the two cannot collide.
        e.preventDefault();
        setHotkeyListOpen(true);
      } else if (e.key === 'F1' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // ACTIONS::zoomInCenter default hotkey (F1).
        e.preventDefault();
        controller.current?.zoomIn();
      } else if (e.key === 'F2' && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // ACTIONS::zoomOutCenter default hotkey (F2).
        e.preventDefault();
        controller.current?.zoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h' && !e.shiftKey) {
        // SCH_ACTIONS::showHierarchy (Ctrl+H): toggle the navigator panel.
        e.preventDefault();
        onLeftToggle('showHierarchy');
      } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // SCH_ACTIONS::nextNetItem / previousNetItem (Tab / Shift+Tab):
        // SCH_SELECTION_TOOL::SelectNext walks the Net Navigator's flattened
        // tree, so it needs exactly one selected item to start from, and it
        // *wraps* — unlike Previous/Next Marker, which stops at the ends.
        if (doc && selection.size === 1) {
          const order = netNavigatorOrder(buildNetNavigator(doc, libById, fmt));
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
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'g') {
        // ACTIONS::showSearch (Ctrl+G): toggle the Search panel. Distinct from
        // Ctrl+Shift+G above, which is grid overrides.
        e.preventDefault();
        onLeftToggle('showSearch');
      } else if (e.altKey && (e.key === '1' || e.key === '2' || e.key === '4')) {
        // ACTIONS::gridFast1 / gridFast2 / gridFastCycle. The two fast grids are
        // indices into the grid list, stored 1-based as KiCad stores them.
        e.preventDefault();
        settings.updateEeschema((st) => {
          const n = st.window.grid.sizes.length;
          if (n === 0) return;
          const g1 = Math.min(Math.max(st.window.grid.fast_grid_1, 1), n) - 1;
          const g2 = Math.min(Math.max(st.window.grid.fast_grid_2, 1), n) - 1;
          st.window.grid.last_size_idx =
            e.key === '1'
              ? g1
              : e.key === '2'
                ? g2
                : // Cycle: whichever of the two is not current, so the key
                  // toggles between them rather than stepping the whole list.
                  st.window.grid.last_size_idx === g1
                  ? g2
                  : g1;
        });
      } else if (e.altKey && e.key === '3') {
        // SCH_ACTIONS::selectNode (Alt+3): select the connection item under the
        // cursor. The pick is GetNode's, connectable types only at growing
        // thresholds, so a pin or a wire wins over the symbol body around it.
        e.preventDefault();
        if (doc && cursorRef.current) {
          // GetNode's widest threshold is max(HITTEST_THRESHOLD, grid size);
          // with no pointer scale to hand here the grid is the threshold.
          const grid = gridSizeToIU(
            settings.eeschema.window.grid.sizes[settings.eeschema.window.grid.last_size_idx] ??
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
      } else if (e.altKey && e.key === 'ArrowLeft') {
        // SCH_ACTIONS::navigateBack (Alt+Left).
        e.preventDefault();
        onTopAction('navBack');
      } else if (e.altKey && e.key === 'ArrowUp') {
        // SCH_ACTIONS::navigateUp (Alt+Up).
        e.preventDefault();
        onTopAction('navUp');
      } else if (e.altKey && e.key === 'ArrowRight') {
        // SCH_ACTIONS::navigateForward (Alt+Right).
        e.preventDefault();
        onTopAction('navFwd');
      } else if (e.altKey && e.key === 'Backspace') {
        // SCH_ACTIONS::leaveSheet (Alt+Backspace), same as Navigate Up.
        e.preventDefault();
        onTopAction('navUp');
      } else if (e.key === 'PageUp' && !isTyping()) {
        // SCH_ACTIONS::navigatePrevious (PgUp).
        e.preventDefault();
        onTopAction('navPrev');
      } else if (e.key === 'PageDown' && !isTyping()) {
        // SCH_ACTIONS::navigateNext (PgDn).
        e.preventDefault();
        onTopAction('navNext');
      } else if (e.key === 'Escape') {
        if (propsTarget !== null) setPropsTarget(null);
        else if (pastePending) setPastePending(null);
        else if (pendingImage) {
          setPendingImage(null);
          setActiveTool('select');
        } else if (pendingLabel) {
          setPendingLabel(null);
          setActiveTool('select');
        } else if (activeTool !== 'select') {
          setActiveTool('select');
          setPlaceLib(null);
        } else if (selection.size > 0) setSelection(new Set());
        // "<ESC> clears net highlighting": with nothing else pending, the next
        // Escape clears the highlighted net (eeschema input.esc_clears_net_highlight).
        else if (settings.eeschema.input.esc_clears_net_highlight) clearHighlight();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
        e.preventDefault();
        runCommand(deleteByIds(selection));
        setSelection(new Set());
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
        if ((e.key.toLowerCase() === 'm' || e.key.toLowerCase() === 'g') && selection.size > 0) {
          e.preventDefault();
          const kind = e.key.toLowerCase() === 'm' ? 'move' : 'drag';
          setGrabRequest((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
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
              const isPower = !!libById.get(sym.libId)?.isPower;
              if (!(want === 'Footprint' && isPower)) {
                const fi = sym.fields.findIndex((f) => f.key === want);
                if (fi !== -1) setFieldEdit({ symbol: si, index: fi });
              }
              return;
            }
          }
        }
        // D = Show Datasheet (ACTIONS::showDatasheet) for the selected symbol.
        if (e.key.toLowerCase() === 'd' && doc && selection.size === 1) {
          const id = [...selection][0]!;
          const sym = doc.symbols.find((sy, i) => refId('symbol', sy.uuid, i) === id);
          if (sym) {
            e.preventDefault();
            const url = (sym.fields.find((f) => f.key === 'Datasheet')?.value ?? '').trim();
            // "~" is KiCad's "no datasheet", not a URL.
            if (url === '' || url === '~') setError('No datasheet defined.');
            else window.open(url, '_blank', 'noopener,noreferrer');
            return;
          }
        }
        // O = Autoplace Fields (SCH_ACTIONS::autoplaceFields) on the selection.
        if (e.key.toLowerCase() === 'o' && selection.size > 0) {
          e.preventDefault();
          if (doc) {
            const cmd = autoplaceFields(
              doc,
              selection,
              libById,
              {
                allowRejustify: es.autoplace_fields.allow_rejustify,
                alignToGrid: es.autoplace_fields.align_to_grid,
              },
              drawableArea(doc),
            );
            if (cmd) runCommand(cmd);
          }
          return;
        }
        // E = Properties (KiCad SCH_ACTIONS::properties) on a single selected
        // item (openProperties routes by item kind).
        if (e.key.toLowerCase() === 'e' && selection.size === 1) {
          e.preventDefault();
          openProperties([...selection][0]!);
          return;
        }
        const toolId = TOOL_HOTKEYS[e.key.toLowerCase()];
        if (toolId) {
          e.preventDefault();
          onToolSelect(toolId);
        }
      }
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
    runCommand,
    activeTool,
    onToolSelect,
    onTopAction,
    onLeftToggle,
    libById,
    pendingLabel,
    propsTarget,
    pastePending,
    duplicateSelection,
    findOpen,
    searchData,
    doFind,
    openFindDialog,
    openProperties,
    toggles,
  ]);

  const units = toggles.has('unitsInches') ? 'in' : toggles.has('unitsMils') ? 'mils' : 'mm';
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

  // Parse a distance typed into the grid, in the current units, back to IU.
  const parseDist = (text: string): number | null => {
    const n = Number(text.trim());
    if (!Number.isFinite(n)) return null;
    const mm = units === 'mm' ? n : units === 'mils' ? n * 0.0254 : n * 25.4;
    return Math.round(mmToIU(mm));
  };

  // A load failure before any document exists is fatal; once a document is open,
  // a bad Open just shows a dismissible banner and leaves the current sheet intact.
  if (!doc) {
    return error ? (
      <pre style={{ color: 'crimson', padding: 16 }}>Failed to load schematic: {error}</pre>
    ) : (
      <div className="ze-app">
        <LoadingOverlay label={loading ?? 'Loading schematic…'} />
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
    <div className="ze-app" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".kicad_sch"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />
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
              {dirty ? '*' : ''}
              {projectName || 'No project'}
            </b>
            &nbsp;-&nbsp;Schematic Editor
          </>
        }
      />

      <Toolbar
        entries={TOP_TOOLBAR}
        orientation="horizontal"
        disabledIds={dirty ? navDisabled : new Set([...(navDisabled ?? []), 'save'])}
        onActivate={onTopAction}
      />

      <div className="ze-body">
        {(toggles.has('showProperties') ||
          toggles.has('showHierarchy') ||
          toggles.has('showSearch') ||
          toggles.has('showNetNavigator')) && (
          <div className="ze-leftdock">
            {toggles.has('showSearch') && doc && (
              <div className="ze-panel grow">
                <div className="ze-panel-header">Search</div>
                <div className="ze-panel-body">
                  <SearchPanel
                    doc={doc}
                    libById={libById}
                    fmt={fmt}
                    onSelect={(id) => setSelection(new Set([id]))}
                    onFocus={(id, at) => {
                      setSelection(new Set([id]));
                      controller.current?.centerOn(at);
                    }}
                  />
                </div>
              </div>
            )}
            {toggles.has('showProperties') && (
              <div className="ze-panel grow">
                <div className="ze-panel-header">Properties</div>
                <div className="ze-panel-body">
                  {propRows.length > 0 ? (
                    <SchPropertiesPanel
                      rows={propRows}
                      fmt={(iu) => fmt(iu)}
                      parse={parseDist}
                      onCommand={runCommand}
                    />
                  ) : (
                    <div className="ze-muted">
                      {selection.size === 0
                        ? 'No objects selected'
                        : `${selection.size} item(s) selected`}
                    </div>
                  )}
                </div>
              </div>
            )}
            {toggles.has('showNetNavigator') && doc && (
              <div className="ze-panel grow">
                <div className="ze-panel-header">Net Navigator</div>
                <div className="ze-panel-body">
                  <NetNavigatorPanel
                    doc={doc}
                    libById={libById}
                    fmt={fmt}
                    selectedId={selection.size === 1 ? [...selection][0] : undefined}
                    onSelect={(id) => setSelection(new Set([id]))}
                  />
                </div>
              </div>
            )}
            {toggles.has('showHierarchy') && (
              <div className="ze-panel grow">
                <div className="ze-panel-header">Schematic Hierarchy</div>
                <div className="ze-panel-body">
                  {sheetTree && renderSheetNode(sheetTree, 0, currentPath, switchSheet)}
                </div>
              </div>
            )}
            {toggles.has('showProperties') && (
              <div className="ze-panel">
                <div className="ze-panel-header">Selection Filter</div>
                <div className="ze-panel-body">
                  {/* "All items" toggles every category (not Locked items),
                      exactly like PANEL_SCH_SELECTION_FILTER::OnFilterChanged. */}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectionFilterAll(selFilter)}
                      onChange={() => {
                        const next = !selectionFilterAll(selFilter);
                        setSelFilter((p) => ({
                          ...p,
                          symbols: next,
                          text: next,
                          wires: next,
                          labels: next,
                          pins: next,
                          graphics: next,
                          images: next,
                          ruleAreas: next,
                          otherItems: next,
                        }));
                      }}
                    />
                    All items
                  </label>
                  {/* Locked items is special (allows selecting locked items). */}
                  <label title="Allow selection of locked items">
                    <input
                      type="checkbox"
                      checked={selFilter.lockedItems}
                      onChange={(e) =>
                        setSelFilter((p) => ({ ...p, lockedItems: e.target.checked }))
                      }
                    />
                    Locked items
                  </label>
                  <div className="ze-selfilter">
                    {FILTER_CATS.map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={selFilter[key]}
                          onChange={(e) => setSelFilter((p) => ({ ...p, [key]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <Toolbar
          entries={LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <div className="ze-canvas-wrap">
          {/* WX_INFOBAR: the strip a tool posts an error into, dismissed with
              its ✕ or by the next successful action. */}
          {infoBar && (
            <div className="ze-infobar">
              {infoBar}
              <span
                className="x"
                title="Close"
                onClick={() => setInfoBar(null)}
                style={{ marginLeft: 'auto', cursor: 'pointer' }}
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
            onLabelPlaced={onLabelPlaced}
            onLabelPrompt={onLabelPrompt}
            onFollowLink={onFollowLink}
            highlight={highlightWires}
            theme={theme}
            renderOpts={renderOpts}
            inputPrefs={inputPrefs}
            onSheetDrawn={onSheetDrawn}
            onTextBoxDrawn={onTextBoxDrawn}
            onSheetPinClick={onSheetPinClick}
            pendingImage={pendingImage}
            onImagePlaced={onImagePlaced}
            grabRequest={grabRequest}
            onContextMenuRequest={onContextMenuRequest}
            onClarify={(x, y, items, additive) => setClarify({ x, y, items, additive })}
            onZoomArea={(box) => {
              controller.current?.zoomToBox(box);
              setActiveTool('select');
            }}
            onSelect={onSelect}
            onHighlight={onHighlight}
            onRequestTool={onToolSelect}
            onEditItem={onEditItem}
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
            onCommand={runCommand}
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
          {ercOpen && (
            <ErcDialog
              navRef={ercNav}
              sourceName={currentFile}
              violations={ercResult}
              running={ercRunning}
              ignoredTests={ERC_ITEMS.filter(
                (it) => setup.erc.severities[it.code] === 'ignore',
              ).map((it) => it.title)}
              filters={{
                errors: es.appearance.show_erc_errors,
                warnings: es.appearance.show_erc_warnings,
                exclusions: es.appearance.show_erc_exclusions,
              }}
              onFilterChange={(f) =>
                settings.updateEeschema((s) => {
                  s.appearance.show_erc_errors = f.errors;
                  s.appearance.show_erc_warnings = f.warnings;
                  s.appearance.show_erc_exclusions = f.exclusions;
                })
              }
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
            <DialogSchematicFind
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
              fieldNames={changeSymbolsFieldNames}
              hasSelection={selection.size > 0}
              messages={changeSymbolsMessages}
              onApply={runChangeSymbols}
              onClose={() => setChangeSymbolsMode(null)}
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
            <DialogPageSettings
              value={getPageSettings(doc)}
              sheetCount={flatSheets.length}
              sheetNumber={Number(pageNumberOf(currentPath)) || 1}
              sheetChoices={sheetChoices}
              drawingSheetName={sheetRefName}
              onOk={applyPageSettings}
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
              annotateAutomatic={es.annotation.automatic}
              onOk={(mode: PasteMode) => {
                setPasteSpecialOpen(false);
                void navigator.clipboard?.readText().then((text) => {
                  setDoc((d) => {
                    const payload = d ? parsePastedText(text, d, mode) : null;
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
              <div
                className="ze-modal"
                style={{ width: 360 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
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
                      if (fontsChanged) after = setEmbedFonts(after, next.embeddedFiles.embedFonts);
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

        <Toolbar
          entries={RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onToolSelect}
        />
      </div>

      {/* EDA_DRAW_FRAME hosts a message panel above the 8-field status bar:
          a single selected item's GetMsgPanelInfo rows; anything else clears
          it (SCH_INSPECTION_TOOL::UpdateMessagePanel). */}
      <div className="ze-msgpanel" data-testid="sch-message-panel">
        {msgPanelItems.map((item) => (
          <div className="ze-msgpanel-item" key={`${item.upper}:${item.lower}`}>
            <div className="ze-msgpanel-upper">{item.upper}</div>
            <div className="ze-msgpanel-lower">{item.lower || ' '}</div>
          </div>
        ))}
      </div>

      {/* KISTATUSBAR's 8 fields (eda_draw_frame.cpp): message (grows), the
          net-highlight text lands here (UpdateNetHighlightStatus) | Z zoom |
          absolute X/Y | relative dx/dy/dist | grid | units | current-tool
          (grows) | constraint (unused by eeschema). */}
      <div className="ze-statusbar">
        <span className="cell msg" data-testid="sch-status-msg">
          {highlightName ? `Highlighted net: ${highlightName}` : ''}
        </span>
        <StatusReadout
          ref={statusRef}
          units={units}
          localOrigin={localOrigin}
          devicePixelRatio={dpr}
        />
        <StatusField template={STATUS_FIELD_TEMPLATES.grid}>
          grid {(() => {
            const iu = renderOpts.grid.sizeIU;
            const mm = iuToMM(iu);
            return units === 'mm'
              ? mm.toFixed(4)
              : units === 'mils'
                ? (mm / 0.0254).toFixed(0)
                : (mm / 25.4).toFixed(4);
          })()}
        </StatusField>
        <StatusField template={STATUS_FIELD_TEMPLATES.units}>
          {units === 'in' ? 'inches' : units}
        </StatusField>
        <span className="cell tool" data-testid="sch-tool-msg">
          {SCH_TOOL_MSGS[activeTool] ?? ''}
        </span>
        <StatusField template={STATUS_FIELD_TEMPLATES.constraint} />
      </div>

      {chooserOpen && (
        <DialogSymbolChooser
          powerFilter={activeTool === 'placePower'}
          showFootprints={es.appearance.footprint_preview}
          historyList={activeTool === 'placePower' ? sPowerHistoryList : sSymbolHistoryList}
          alreadyPlaced={alreadyPlaced}
          getPlacedLibSymbol={getPlacedLibSymbol}
          onOk={onChooserOk}
          onCancel={() => setActiveTool('select')}
        />
      )}

      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      {/* Double-click / E on a symbol: KiCad's Symbol Properties dialog. */}
      {propsSymbol && propsTarget !== null && (
        <SymbolPropertiesDialog
          hasAlternate={hasAlternateBodyStyle(libById.get(propsSymbol.libId))}
          symbol={propsSymbol}
          lib={libById.get(propsSymbol.libId)}
          fieldTemplates={setup.fieldTemplates}
          subpart={subpartSettings(setup.annotation)}
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
            setChangeSymbolsMode('change');
          }}
          onUpdateSymbol={() => {
            setPropsTarget(null);
            setChangeSymbolsMessages([]);
            setChangeSymbolsMode('update');
          }}
          onEditSymbol={
            onShowSymbolEditor
              ? () => {
                  setPropsTarget(null);
                  onShowSymbolEditor();
                }
              : undefined
          }
        />
      )}

      {/* Free text (DIALOG_TEXT_PROPERTIES): createNewText opens it before the
          text is attached to the cursor, seeded from the last one placed. */}
      {activeTool === 'placeText' && labelPrompt && !pendingLabel && !labelEdit && (
        <DialogTextProperties
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
          kind="directive"
          isNew
          initial={{
            text: '',
            shape: lastDirective.current.shape,
            bold: false,
            italic: false,
            sizeIU: lastDirective.current.pinLength,
            spin: lastDirective.current.spin,
            autoRotate: false,
            fields: [
              {
                key: 'Netclass',
                value: '',
                angle: 0,
                effects: { hidden: false },
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
          kind="directive"
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
      {hotkeyListOpen && (
        <DialogListHotkeys
          sections={buildHotkeyList(menus)}
          onClose={() => setHotkeyListOpen(false)}
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
                      editPageNumber(pageEdit.page.trim());
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
                  editPageNumber(pageEdit.page.trim());
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
          mandatory={isMandatoryField(doc.symbols[fieldEdit.symbol]!.fields[fieldEdit.index]!.key)}
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
                      runCommand(
                        addItems({
                          sheets: [
                            makeSheet(sheetDraw.at, sheetDraw.size, sheetDraw.name, sheetDraw.file),
                          ],
                        }),
                      );
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
                  runCommand(
                    addItems({
                      sheets: [
                        makeSheet(
                          sheetDraw.at,
                          sheetDraw.size,
                          sheetDraw.name.trim(),
                          sheetDraw.file.trim(),
                        ),
                      ],
                    }),
                  );
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
      {tableDraw && (
        <div className="ze-modal-backdrop" onMouseDown={() => setTableDraw(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Insert Table
              <span className="x" title="Cancel" onClick={() => setTableDraw(null)}>
                ✕
              </span>
            </div>
            <div
              className="ze-label-dialog-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <label className="row">
                <span>Rows</span>
                <input
                  className="ze-search"
                  type="number"
                  min={1}
                  max={50}
                  autoFocus
                  value={tableDraw.rows}
                  onChange={(e) => setTableDraw({ ...tableDraw, rows: Number(e.target.value) })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitTable();
                  }}
                />
              </label>
              <label className="row">
                <span>Columns</span>
                <input
                  className="ze-search"
                  type="number"
                  min={1}
                  max={50}
                  value={tableDraw.cols}
                  onChange={(e) => setTableDraw({ ...tableDraw, cols: Number(e.target.value) })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitTable();
                  }}
                />
              </label>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setTableDraw(null)}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={commitTable}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table cell editor: a grid of inputs matching the table (double-click to edit). */}
      {tableEdit && (
        <div className="ze-modal-backdrop" onMouseDown={() => setTableEdit(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              Edit Table
              <span className="x" title="Cancel" onClick={() => setTableEdit(null)}>
                ✕
              </span>
            </div>
            <div className="ze-label-dialog-body">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${tableEdit.cols}, 1fr)`,
                  gap: 4,
                }}
              >
                {tableEdit.texts.map((txt, i) => (
                  <input
                    key={i}
                    className="ze-search"
                    value={txt}
                    style={{ minWidth: 80 }}
                    onChange={(e) =>
                      setTableEdit((te) =>
                        te
                          ? { ...te, texts: te.texts.map((t, j) => (j === i ? e.target.value : t)) }
                          : te,
                      )
                    }
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitTableEdit();
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setTableEdit(null)}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={commitTableEdit}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <LoadingOverlay label={loading} />
    </div>
  );
}

/** One row of the hierarchy tree; children indent one level (KiCad's navigator). */
function renderSheetNode(
  node: SheetTreeNode,
  depth: number,
  currentPath: string,
  onOpen: (path: string, file: string) => void,
): JSX.Element {
  return (
    <div key={node.path}>
      <div
        className={`ze-tree-item ${node.path === currentPath ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onOpen(node.path, node.file)}
        title={node.file}
      >
        📄 {node.name}
      </div>
      {node.children.map((c) => (
        <div key={c.path}>{renderSheetNode(c, depth + 1, currentPath, onOpen)}</div>
      ))}
    </div>
  );
}
