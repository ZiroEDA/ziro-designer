// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { iuToMM, SCH_IU_PER_MM } from '@ziroeda/common';
import { parse } from '@ziroeda/sexpr';
import type { Vec2 } from '@ziroeda/kimath';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  letterSubReference,
  readSymbolLib,
  serializeSymbolLib,
  EMPTY_SOURCE,
  type LibGraphic,
  type LibPin,
  type LibSymbol,
  type SchField,
} from '@ziroeda/eeschema';
import * as sexpr from '@ziroeda/sexpr';
import { MenuBar, type Menu } from '../../ui/MenuBar.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { LoadingOverlay } from '../../ui/LoadingOverlay.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { useUnsavedGuard } from '../../ui/useUnsavedGuard.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { toolbarIconUrl } from '../../ui/toolbarIcons.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { MsgPanel, type MsgPanelItem } from '../../ui/MsgPanel.js';
import {
  coordsMsg,
  deltasMsg,
  gridMsg,
  messageTextFromValue,
  type StatusUnits,
  unitsMsg,
  zoomFactorForScale,
  zoomMsg,
} from '../../ui/status_format.js';
import {
  LISTBOX_WIDTH,
  SYM_CONTROL,
  SYM_TOP_TOOLBAR,
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
} from './symbolToolbars.js';
import { SymbolCanvas, type SymbolCanvasController } from './SymbolCanvas.js';
import { SymbolLibraryManager, type ManagedLibrary } from './libraryManager.js';
import {
  findSymLibRowByUri,
  resolvedProjectSymLibs,
} from '../schematic/symbols/project_sym_lib_table.js';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import { SYM_FRAME_NAME, symFrameTitle } from './frame_title.js';
import { loadIndex } from '../schematic/symbols/index.js';
import { useCommonSettings, useSchematicTheme } from '../../prefs/useSettings.js';
import { pcm } from '../../pcm/pcmStore.js';
import {
  addGraphicToSymbol,
  addPinToSymbol,
  allPins,
  createImagePins,
  deleteSymbolItems,
  ensureUnitEntry,
  hasAlternateBodyStyle,
  mirrorSymbolItems,
  parseItemId,
  renameSymbol,
  replaceSymbolItem,
  rotateSymbolItems,
  setUnitCount,
  unitCount,
} from './edits.js';
import { GRID, MM, type SymbolViewOptions } from './render/symbolRenderer.js';
import { settings } from '../../prefs/settings.js';
import type { SymbolHit } from './edits.js';
import {
  LibSymbolPropertiesDialog,
  NewSymbolDialog,
  PinPropertiesDialog,
  PinTableDialog,
  ShapePropertiesDialog,
  SymbolCheckDialog,
  SymbolTextDialog,
  type NewSymbolResult,
  type PinDialogResult,
} from './components/dialogs.js';
import '../../ui/shell.css';
import { AboutDialog } from '../../home/dialogs/dialog_about.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import { symbolEditorMenus } from './menubar.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { ABOUT_TITLES } from '../../ui/about_titles.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '../../ui/menu_hotkeys.js';
import { wasBrowserSuppressed, type FocusLike } from '../../ui/browser_hotkeys.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { kicadSymbolLibWildcard } from '../../fs/wildcards.js';
import { defaultUnitsToggle } from '../../ui/app_settings_units.js';
import { SelectionFilterPanel } from '../../ui/SelectionFilterPanel.js';
import { symSelectionFilterShown } from '../../ui/selection_filter_panel.js';
import {
  defaultSelectionFilter,
  type SelectionFilterOptions,
} from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';

/**
 * The Symbol Editor frame, the web mirror of KiCad's SYMBOL_EDIT_FRAME
 * (eeschema/symbol_editor/): menu bar (menubar_symbol_editor.cpp), the three
 * toolbars with the unit selector combo (toolbars_symbol_editor.cpp), the
 * library tree pane (symbol_tree_pane.cpp) and the drawing canvas, wired to a
 * buffered library manager. Undo/redo keeps whole-symbol snapshots exactly as
 * SaveCopyInUndoList duplicates the full LIB_SYMBOL.
 */

export interface SymbolEditorFile {
  name: string;
  text: string;
}

/** Pin defaults persisted across placements (g_LastPin* in symbol_editor_pin_tool.cpp). */
interface LastPinState {
  electricalType: string;
  shape: string;
  angle: number;
  length: number;
  nameSize: number;
  numberSize: number;
  commonUnit: boolean;
  commonBody: boolean;
  visible: boolean;
}

/**
 * The library tree pane's width, `symbol_edit_frame.cpp:219-222`.
 *
 * [data] KiCad states it itself: `.MinSize( FromDIP( 250 ), FromDIP( 80 ) )
 * .BestSize( FromDIP( 250 ), -1 )` — the same pair the footprint editor's tree
 * uses. Ours was 260, which is nowhere upstream.
 */
const LIBRARY_TREE_WIDTH = 250;

const DEFAULT_LAST_PIN: LastPinState = {
  electricalType: 'input',
  shape: 'line',
  angle: 0,
  length: 2.54 * MM, // DEFAULT_PIN_LENGTH = 100 mils
  nameSize: 1.27 * MM, // DEFAULT_PINNAME_SIZE = 50 mils
  numberSize: 1.27 * MM, // DEFAULT_PINNUM_SIZE = 50 mils
  commonUnit: false,
  commonBody: false,
  visible: true,
};

const DEFAULT_TOGGLES = new Set([
  'toggleGrid',
  // `system.units`. NOT a literal: `symbol_editor` is on the imperial side of
  // `APP_SETTINGS_BASE`'s single branch (`app_settings.cpp:228-238`), so this
  // frame opens in mils, reading `grid 50` where ours read `grid 1.27`. It said
  // `unitsMm`, which is that branch's OTHER arm — the one pcbnew takes.
  defaultUnitsToggle('symbol_editor'),
  'toggleSyncedPinsMode',
  'showLibraryTree',
  'showProperties',
  // `cursorSmallCrosshairs` is the group's first action, so it is the one the
  // crosshair button shows on open.
  'crosshairSmall',
]);

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`toolbars_symbol_editor.cpp:72-79`). One button each, showing the selected
 * action, so exactly one member is in `toggles` at a time.
 *
 * `showDeMorganStandard` / `showDeMorganAlternate` used to be a third pair here.
 * They were ours: neither name appears anywhere in KiCad 10.0.5, and the body
 * style is a CHOICE on the top bar upstream, not two toggle buttons.
 */
const RADIO_GROUPS: string[][] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
];

/**
 * Field 6, the "Current Tool" pane: TOOLS_HOLDER::SetTool hands
 * `TOOL_ACTION::GetFriendlyName()` to `EDA_DRAW_FRAME::DisplayToolMsg`
 * (common/tool/tools_holder.cpp:72). These are SCH_ACTIONS' names verbatim
 * (eeschema/tools/sch_actions.cpp:376-426, :685-704; the selection and delete
 * tools are ACTIONS' own, common/tool/actions.cpp:416/:1230).
 */
const SYM_TOOL_MSGS: Record<string, string> = {
  select: 'Select item(s)',
  placePin: 'Draw Pins',
  placeText: 'Draw Text',
  drawRectangle: 'Draw Rectangles',
  drawCircle: 'Draw Circles',
  drawArc: 'Draw Arcs',
  drawLines: 'Draw Lines',
  drawPolygon: 'Draw Polygons',
  placeAnchor: 'Move Symbol Anchor',
  deleteTool: 'Interactive Delete Tool',
};

const basename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

/** Resolve a derived symbol's geometry against the live library (LIB_SYMBOL::Flatten). */
function flattenAgainst(sym: LibSymbol, lib: ManagedLibrary, depth = 0): LibSymbol {
  if (sym.extends === undefined || depth > 10) return sym;
  const parent = lib.symbols.get(sym.extends);
  if (!parent) return sym;
  const base = flattenAgainst(parent, lib, depth + 1);
  return {
    ...sym,
    units: base.units,
    isPower: sym.isPower || base.isPower,
    pinNumbersHidden: base.pinNumbersHidden,
    pinNamesHidden: base.pinNamesHidden,
    pinNameOffset: base.pinNameOffset,
  };
}

/**
 * The transient library a symbol borrowed from the schematic lives in. Never
 * written to disk: it is the closest thing we have to upstream's session-only
 * instance tab.
 */
const SCHEMATIC_LIB = 'Schematic';

export function SymbolEditor({
  onExitToHome,
  projectName,
  initialProject,
  onAddSymbolToSchematic,
  openRequest,
  schematicSymbol,
  onSaveToSchematic,
}: {
  onExitToHome: () => void;
  /** The open project's folder name, for the chooser's Save/Open places. */
  projectName?: string;
  initialProject?: SymbolEditorFile[] | null;
  /** eeschema wiring for "Add symbol to schematic" (SCH_ACTIONS::addSymbolToSchematic). */
  onAddSymbolToSchematic?: (sym: LibSymbol) => void;
  /** The `.kicad_sym` the project manager launched us on (KiCad's MAIL_LIB_EDIT).
   *  Re-sent with a fresh nonce each activation so a resident editor re-opens. */
  openRequest?: { file: string | null; nonce: number } | null;
  /** A symbol handed over from the schematic (SCH_EDIT_TOOL's Edit with Symbol
   *  Editor). Re-sent with a fresh nonce so a resident editor re-opens it. */
  schematicSymbol?: {
    symbol: LibSymbol;
    unit: number;
    bodyStyle: number;
    nonce: number;
  } | null;
  /** Save, when the open symbol came from the schematic: the edit goes back to
   *  the placement instead of to a library (SaveSymbolToSchematic). */
  onSaveToSchematic?: (sym: LibSymbol) => void;
}): JSX.Element {
  const manager = useRef(new SymbolLibraryManager());
  const theme = useSchematicTheme();
  const common = useCommonSettings();
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision(manager.current.revision + Math.random()), []);

  // Current symbol (m_symbol): a working copy owned by the frame.
  const [curLib, setCurLib] = useState<string | null>(null);
  const [curName, setCurName] = useState<string | null>(null);
  const [workSymbol, setWorkSymbol] = useState<LibSymbol | null>(null);
  const [unit, setUnit] = useState(1);
  const [bodyStyle, setBodyStyle] = useState(1);

  // Whole-symbol snapshot undo/redo (SaveCopyInUndoList), reset per loaded symbol.
  const undoStack = useRef<LibSymbol[]>([]);
  const redoStack = useRef<LibSymbol[]>([]);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [activeTool, setActiveTool] = useState('select');
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  // Library tree state (LIB_TREE: search box + expandable libraries).
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [treeSel, setTreeSel] = useState<{ lib: string; name: string | null } | null>(null);
  /** The symbol currently on loan from the schematic, by name; null otherwise.
   *  While set, Save routes back to the placement rather than to a library. */
  const [fromSchematic, setFromSchematic] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(LIBRARY_TREE_WIDTH);
  /** `SCH_SELECTION_TOOL::GetFilter()`, seeded from
   *  `SYMBOL_EDITOR_SETTINGS::m_SelectionFilter` (`symbol_edit_frame.cpp:254`). */
  const [selFilter, setSelFilter] = useState<SelectionFilterOptions>(defaultSelectionFilter);

  // Dialogs / pending placements.
  const [pinDialog, setPinDialog] = useState<{
    pin: LibPin;
    isNew: boolean;
    editId?: string;
  } | null>(null);
  const [pendingPin, setPendingPin] = useState<
    (LibPin & { _commonUnit?: boolean; _commonBody?: boolean }) | null
  >(null);
  const [textDialog, setTextDialog] = useState<{
    editId?: string;
    initial?: { text: string; fontSize: number; bold: boolean; italic: boolean };
  } | null>(null);
  const [pendingText, setPendingText] = useState<{
    text: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
  } | null>(null);
  const [shapeDialog, setShapeDialog] = useState<{ editId: string } | null>(null);
  /**
   * `Add Library` and `Import Symbol`, over the account's tree.
   *
   * Both were a hidden `<input type="file">` — the operating system's picker,
   * which knows nothing about the account. Upstream both are `wxFileDialog`s
   * over the filesystem, and a symbol library lives in the project or in
   * `PATHS::GetDefaultUserSymbolsPath()` (paths.cpp:82) — which is what
   * `kind: 'symbols'` names here.
   */
  const [symOpenDlg, setSymOpenDlg] = useState<null | 'addLibrary' | 'importSymbol'>(null);
  const [newSymbolOpen, setNewSymbolOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [symbolPropsOpen, setSymbolPropsOpen] = useState(false);
  const [pinTableOpen, setPinTableOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [newLibName, setNewLibName] = useState<string | null>(null);
  /** DisplayErrorMessage for the MAIL_LIB_EDIT refusals below. */
  const [libError, setLibError] = useState<{ title: string; message: string } | null>(null);

  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts. Registered only while the dialog is up, so a
  // closed one does not sit on the stack swallowing the key.
  // The error box is OK-only, and wx still sends wxID_CANCEL on Esc there.
  useModalEscape(() => setNewLibName(null), newLibName !== null);
  useModalEscape(() => setLibError(null), libError !== null);

  const lastPin = useRef<LastPinState>({ ...DEFAULT_LAST_PIN });
  const controller = useRef<SymbolCanvasController>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // ----- library bootstrap ------------------------------------------------------
  useEffect(() => {
    // Project libraries: the rows of the project's `sym-lib-table`, under the
    // nickname each row gives. SYMBOL_LIB_TABLE is what makes a library exist —
    // a `.kicad_sym` sitting in the project folder that no row points at is a
    // file, not a library, and must not appear in the tree. A disabled row is
    // registered by neither (`HasLibrary( nickname, true )`).
    for (const { row, file } of resolvedProjectSymLibs(initialProject ?? [])) {
      if (row.disabled) continue;
      manager.current.addProjectLibrary(row.name, file.name, file.text);
    }
    // Libraries installed through the Plugin and Content Manager (loaded eagerly
    // from their stored `.kicad_sym` text).
    for (const lib of pcm.installedLibraries())
      manager.current.addInstalledLibrary(lib.name, lib.text);
    // Bundled global libraries: names first (like KiCad's lazy library loads).
    loadIndex()
      .then((idx) => {
        for (const lib of idx) manager.current.addGlobalLibrary(lib.name, lib.symbols);
        bump();
      })
      .catch(() => bump());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- helpers -----------------------------------------------------------------
  // `IsMultiBodyStyle()` / `HasDeMorganBodyStyles()` — what decides whether
  // the body-style combo lists Standard/Alternate or one empty row.
  const showDeMorgan = workSymbol ? hasAlternateBodyStyle(workSymbol) : false;
  const units = workSymbol ? unitCount(workSymbol) : 1;
  const isAlias = workSymbol?.extends !== undefined;
  const synced = toggles.has('toggleSyncedPinsMode');

  const opts: SymbolViewOptions = useMemo(
    () => ({
      unit,
      bodyStyle,
      showPinElectricalTypes: toggles.has('showElectricalTypes'),
      showHiddenPins: toggles.has('showHiddenPins'),
      showHiddenFields: toggles.has('showHiddenFields'),
      // ACTIONS::toggleGrid. The toolbar button used to render pressed while
      // the renderer painted its grid unconditionally, so pressing it did
      // nothing at all.
      showGrid: toggles.has('toggleGrid'),
      gridStyle: settings.eeschema.window.grid.style,
      devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    }),
    [unit, bodyStyle, toggles],
  );

  /** Commit one undoable edit (SaveCopyInUndoList + OnModify + buffer to the manager). */
  const commit = useCallback(
    (next: LibSymbol, description: string) => {
      setWorkSymbol((prev) => {
        if (!prev || !curLib) return prev;
        undoStack.current.push(prev);
        redoStack.current = [];
        if (next.libId !== prev.libId) manager.current.renameSymbol(curLib, prev.libId, next);
        else manager.current.updateSymbol(curLib, next);
        setCurName(next.libId);
        bump();
        setStatus(description);
        return next;
      });
    },
    [curLib, bump],
  );

  const undo = useCallback(() => {
    setWorkSymbol((cur) => {
      const prev = undoStack.current.pop();
      if (!prev || !cur || !curLib) return cur;
      redoStack.current.push(cur);
      if (prev.libId !== cur.libId) manager.current.renameSymbol(curLib, cur.libId, prev);
      else manager.current.updateSymbol(curLib, prev);
      setCurName(prev.libId);
      bump();
      return prev;
    });
    setSelection(new Set());
  }, [curLib, bump]);

  const redo = useCallback(() => {
    setWorkSymbol((cur) => {
      const next = redoStack.current.pop();
      if (!next || !cur || !curLib) return cur;
      undoStack.current.push(cur);
      if (next.libId !== cur.libId) manager.current.renameSymbol(curLib, cur.libId, next);
      else manager.current.updateSymbol(curLib, next);
      setCurName(next.libId);
      bump();
      return next;
    });
    setSelection(new Set());
  }, [curLib, bump]);

  /** LoadSymbol: buffer the working copy, load the target, reset undo, zoom to fit. */
  const loadSymbol = useCallback(
    async (libName: string, symName: string) => {
      setLoading('Loading symbol...');
      try {
        const lib = await manager.current.ensureLoaded(libName);
        const sym = lib?.symbols.get(symName);
        if (!lib || !sym) {
          setStatus(`Symbol ${libName}:${symName} not found`);
          return;
        }
        const flat = flattenAgainst(sym, lib);
        setCurLib(libName);
        setCurName(symName);
        setWorkSymbol(flat);
        setUnit(1);
        setBodyStyle(1);
        undoStack.current = [];
        redoStack.current = [];
        setSelection(new Set());
        setActiveTool('select');
        setPendingPin(null);
        setPendingText(null);
        bump();
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } catch (e) {
        // ensureLoaded fetches the library. A network failure threw out of an
        // async handler: the overlay cleared and nothing else happened, so the
        // symbol simply never appeared and nothing said why.
        setStatus(`Could not load ${libName}:${symName} — ${e instanceof Error ? e.message : e}`);
      } finally {
        setLoading(null);
      }
    },
    [bump],
  );

  // Open the specific library the project manager launched us on, KiCad's
  // PROJECT_TREE_ITEM::Activate routing a `.kicad_sym` through editSymbols +
  // MAIL_LIB_EDIT. A `.kicad_sym` is a whole library, so select it in the tree
  // (like KiCad highlighting the library node) and load its first symbol so the
  // canvas isn't blank. Runs after the bootstrap effect registered the library.
  useEffect(() => {
    const file = openRequest?.file;
    if (!file) return;
    // KiwayMailIn's MAIL_LIB_EDIT: the payload is a *URI*, resolved through the
    // library table, and the nickname comes from the row it matches. A file no
    // row points at is refused with upstream's message rather than opened.
    const row = findSymLibRowByUri(initialProject ?? [], file);
    if (!row) {
      setLibError({
        title: 'Library not found in symbol library table.',
        message:
          `The current configuration does not include the symbol library '${file}'.\n` +
          'Use Manage Symbol Libraries to edit the configuration.',
      });
      return;
    }
    if (row.disabled) {
      setLibError({
        title: 'Symbol library not enabled.',
        message:
          `The symbol library '${unescapeString(row.name)}' is not enabled in the current configuration.\n` +
          'Use Manage Symbol Libraries to edit the configuration.',
      });
      return;
    }
    const lib = row.name;
    void (async () => {
      const loaded = await manager.current.ensureLoaded(lib);
      if (!loaded) return;
      setExpanded((s) => new Set(s).add(lib));
      const first = manager.current.symbolNames(lib)[0];
      setTreeSel({ lib, name: first ?? null });
      if (first) void loadSymbol(lib, first);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  // A symbol on loan from the schematic. Upstream hands it to a session-only
  // instance tab (findOrCreateSymbolInstanceTab); we have no tabs, so it goes
  // into a transient in-memory library that is never written to disk. The tree
  // shows it under its own heading, which is what makes "this one is not from a
  // library" visible rather than something the user has to remember.
  useEffect(() => {
    const req = schematicSymbol;
    if (!req) return;
    // The bare name reads better in the tree than "Device:R"; the placement's
    // full lib id is restored on the way back, from the schematic side.
    const name = req.symbol.libId.split(':').pop() || req.symbol.libId;
    const sym: LibSymbol = { ...req.symbol, libId: name };
    if (!manager.current.libraryExists(SCHEMATIC_LIB)) manager.current.createLibrary(SCHEMATIC_LIB);
    manager.current.updateSymbol(SCHEMATIC_LIB, sym);
    setExpanded((e) => new Set(e).add(SCHEMATIC_LIB));
    setTreeSel({ lib: SCHEMATIC_LIB, name });
    setFromSchematic(name);
    void loadSymbol(SCHEMATIC_LIB, name).then(() => {
      setUnit(req.unit);
      setBodyStyle(req.bodyStyle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schematicSymbol?.nonce]);

  /** Whether the symbol on screen is the one the schematic lent us. */
  const editingSchematicSymbol =
    fromSchematic !== null && curLib === SCHEMATIC_LIB && curName === fromSchematic;

  // ----- save / revert ------------------------------------------------------------
  const downloadText = (fileName: string, text: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** saveLibrary: serialize the buffered library and hand the bytes to the browser. */
  const saveLibrary = useCallback(
    async (libName: string) => {
      await manager.current.ensureLoaded(libName);
      const text = manager.current.saveLibraryText(libName);
      if (text !== undefined) {
        downloadText(`${libName}.kicad_sym`, text);
        setStatus(`Saved library '${libName}'`);
        bump();
      }
    },
    [bump],
  );

  /** Save: back to the schematic when the symbol came from there
   *  (symbol_editor.cpp routes Save by whether the tab has a schematic source),
   *  otherwise the tree's target library, else the current symbol's. */
  const save = useCallback(() => {
    if (editingSchematicSymbol && workSymbol && onSaveToSchematic) {
      onSaveToSchematic(workSymbol);
      setStatus('Saved to schematic');
      return;
    }
    const libName = treeSel?.lib ?? curLib;
    if (libName) void saveLibrary(libName);
  }, [editingSchematicSymbol, workSymbol, onSaveToSchematic, treeSel, curLib, saveLibrary]);

  const saveAll = useCallback(() => {
    for (const name of manager.current.libraryNames()) {
      // The schematic's transient library has no file behind it; "Save All"
      // must not offer to download one.
      if (name === SCHEMATIC_LIB) continue;
      if (manager.current.isLibraryModified(name)) void saveLibrary(name);
    }
  }, [saveLibrary]);

  const revert = useCallback(() => {
    if (!curLib || !curName || !workSymbol) return;
    if (!manager.current.isSymbolModified(curLib, curName)) return;
    if (!window.confirm('Revert unsaved changes in this symbol?')) return;
    const orig = manager.current.revertSymbol(curLib, curName);
    if (orig) {
      const lib = manager.current.library(curLib)!;
      setWorkSymbol(flattenAgainst(orig, lib));
      undoStack.current = [];
      redoStack.current = [];
      setSelection(new Set());
    } else {
      setWorkSymbol(null);
      setCurName(null);
    }
    bump();
  }, [curLib, curName, workSymbol, bump]);

  // ----- symbol management (symbol_editor.cpp) --------------------------------------
  const targetLib = treeSel?.lib ?? curLib;

  /** CreateNewSymbol: root or derived, exactly as SYMBOL_EDIT_FRAME::CreateNewSymbol. */
  const createNewSymbol = useCallback(
    (r: NewSymbolResult) => {
      setNewSymbolOpen(false);
      const libName = targetLib;
      if (!libName) return;
      const { atom, list, str } = sexpr;
      const field = (key: string, value: string, hidden: boolean): SchField => ({
        key,
        value,
        at: { x: 0, y: 0 },
        angle: 0,
        effects: { hidden },
        source: EMPTY_SOURCE,
      });

      let sym: LibSymbol;
      if (r.parentSymbolName === '') {
        // Root symbol: mandatory fields + the dialog's flags. The source node
        // carries the header booleans the typed model doesn't represent.
        const source = list(
          atom('symbol'),
          str(r.name),
          list(atom('exclude_from_sim'), atom('no')),
          list(atom('in_bom'), atom(r.excludeFromBom ? 'no' : 'yes')),
          list(atom('on_board'), atom(r.excludeFromBoard ? 'no' : 'yes')),
        );
        const properties: SchField[] = [
          field('Reference', r.reference, false),
          field('Value', r.name, false),
          field('Footprint', '', true),
          field('Datasheet', '', true),
          field('Description', '', true),
        ];
        if (!r.unitsInterchangeable && r.unitCount >= 2)
          properties.push(field('ki_locked', '', true));
        sym = {
          libId: r.name,
          isPower: r.isPowerSymbol,
          pinNumbersHidden: !r.showPinNumber,
          pinNamesHidden: !r.showPinName,
          pinNameOffset: r.pinNameInside ? r.pinTextPosition || (0.0254 * MM) / 10 : 0,
          properties,
          units: [],
          source,
        };
        sym = ensureUnitEntry(sym, 0, 1).sym;
        for (let u = 1; u <= r.unitCount; u++) {
          if (r.unitCount > 1) sym = ensureUnitEntry(sym, u, 1).sym;
          if (r.alternateBodyStyle) sym = ensureUnitEntry(sym, u, 2).sym;
        }
      } else {
        // Derived symbol: inherit the parent's mandatory-field attributes.
        const lib = manager.current.library(libName);
        const parent = lib?.symbols.get(r.parentSymbolName);
        if (!parent) return;
        const source = list(
          atom('symbol'),
          str(r.name),
          list(atom('extends'), str(r.parentSymbolName)),
        );
        const parentField = (key: string): SchField | undefined =>
          parent.properties.find((f) => f.key === key);
        const properties: SchField[] = [
          'Reference',
          'Value',
          'Footprint',
          'Datasheet',
          'Description',
        ].map((key) => {
          const pf = parentField(key);
          const base: SchField = pf
            ? { ...pf, source: EMPTY_SOURCE }
            : field(key, '', key !== 'Reference' && key !== 'Value');
          if (key === 'Value') return { ...base, value: parent.isPower ? r.name : r.name };
          if (key === 'Footprint' || key === 'Datasheet') return { ...base, value: '' };
          return base;
        });
        sym = {
          libId: r.name,
          extends: r.parentSymbolName,
          isPower: parent.isPower,
          pinNumbersHidden: parent.pinNumbersHidden,
          pinNamesHidden: parent.pinNamesHidden,
          pinNameOffset: parent.pinNameOffset,
          properties,
          units: parent.units,
          source,
        };
      }
      manager.current.updateSymbol(libName, sym);
      bump();
      void loadSymbol(libName, r.name);
    },
    [targetLib, bump, loadSymbol],
  );

  const deleteSymbol = useCallback(
    (libName: string, symName: string) => {
      if (!window.confirm(`Delete symbol '${symName}' from library '${libName}'?`)) return;
      manager.current.removeSymbol(libName, symName);
      if (curLib === libName && curName === symName) {
        setWorkSymbol(null);
        setCurName(null);
      }
      bump();
    },
    [curLib, curName, bump],
  );

  /** DuplicateSymbol: insert a copy with a unique name next to the source. */
  const duplicateSymbol = useCallback(
    async (libName: string, symName: string) => {
      const lib = await manager.current.ensureLoaded(libName);
      const src = lib?.symbols.get(symName);
      if (!lib || !src) return;
      let newName = symName;
      while (lib.symbols.has(newName)) newName = `${newName}_copy`;
      const copy = renameSymbol({ ...src, source: src.source }, newName);
      manager.current.updateSymbol(libName, copy);
      bump();
      void loadSymbol(libName, newName);
    },
    [bump, loadSymbol],
  );

  const exportSymbol = useCallback(async () => {
    const libName = treeSel?.lib ?? curLib;
    const symName = treeSel?.name ?? curName;
    if (!libName || !symName) return;
    await manager.current.ensureLoaded(libName);
    const sym = manager.current.getSymbol(libName, symName);
    if (!sym) return;
    const lib = manager.current.library(libName)!;
    downloadText(`${symName}.kicad_sym`, serializeSymbolLib([flattenAgainst(sym, lib)]));
  }, [treeSel, curLib, curName]);

  /** ImportSymbol: append the file's first symbol to the target library. */
  const importSymbolText = useCallback(
    async (fileName: string, text: string) => {
      const libName = targetLib;
      if (!libName) {
        setStatus('Select a library first');
        return;
      }
      try {
        const symbols = readSymbolLib(parse(text));
        const first = symbols.find((s) => s.extends === undefined) ?? symbols[0];
        if (!first) {
          setStatus(`No symbols in ${fileName}`);
          return;
        }
        await manager.current.ensureLoaded(libName);
        const lib = manager.current.library(libName)!;
        let name = first.libId;
        while (lib.symbols.has(name)) name = `${name}_1`; // ensureUniqueName
        manager.current.updateSymbol(
          libName,
          name === first.libId ? first : renameSymbol(first, name),
        );
        bump();
        void loadSymbol(libName, name);
      } catch (e) {
        setStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [targetLib, bump, loadSymbol],
  );

  const addLibraryText = useCallback(
    (fileName: string, text: string) => {
      const name = basename(fileName).replace(/\.kicad_sym$/i, '');
      manager.current.addProjectLibrary(name, fileName, text);
      setExpanded((p) => new Set([...p, name]));
      bump();
    },
    [bump],
  );

  // ----- tool / toolbar dispatch -----------------------------------------------------
  const onToolSelect = useCallback((id: string) => {
    setActiveTool(id);
    setPendingPin(null);
    setPendingText(null);
  }, []);

  const rotateSel = useCallback(
    (ccw: boolean) => {
      if (!workSymbol || selection.size === 0 || isAlias) return;
      commit(rotateSymbolItems(workSymbol, selection, ccw), ccw ? 'Rotate CCW' : 'Rotate CW');
    },
    [workSymbol, selection, isAlias, commit],
  );

  const mirrorSel = useCallback(
    (horizontal: boolean) => {
      if (!workSymbol || selection.size === 0 || isAlias) return;
      commit(
        mirrorSymbolItems(workSymbol, selection, horizontal),
        horizontal ? 'Mirror Horizontally' : 'Mirror Vertically',
      );
    },
    [workSymbol, selection, isAlias, commit],
  );

  const showDatasheet = useCallback(() => {
    const url = workSymbol?.properties.find((f) => f.key === 'Datasheet')?.value ?? '';
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else setStatus(url ? `Datasheet: ${url}` : 'No datasheet defined');
  }, [workSymbol]);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'newSymbol':
          setNewSymbolOpen(true);
          break;
        case 'saveAll':
          saveAll();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'zoomRedraw':
          controller.current?.zoomToFit();
          break;
        case 'zoomIn':
          controller.current?.zoomIn();
          break;
        case 'zoomOut':
          controller.current?.zoomOut();
          break;
        case 'zoomFit':
          controller.current?.zoomToFit();
          break;
        case 'rotateCCW':
          rotateSel(true);
          break;
        case 'rotateCW':
          rotateSel(false);
          break;
        // mirrorV = MirrorVertically (top/bottom flip); mirrorH = MirrorHorizontally.
        case 'mirrorV':
          mirrorSel(false);
          break;
        case 'mirrorH':
          mirrorSel(true);
          break;
        case 'symbolProperties':
          if (workSymbol) setSymbolPropsOpen(true);
          break;
        case 'pinTable':
          if (workSymbol) setPinTableOpen(true);
          break;
        case 'showDatasheet':
          showDatasheet();
          break;
        case 'checkSymbol':
          if (workSymbol) setCheckOpen(true);
          break;
        case 'toggleSyncedPinsMode':
          setToggles((t) => flip(t, 'toggleSyncedPinsMode'));
          break;
        case 'addSymbolToSchematic':
          if (workSymbol && curLib && onAddSymbolToSchematic) {
            onAddSymbolToSchematic({ ...workSymbol, libId: `${curLib}:${workSymbol.libId}` });
          } else {
            setStatus('No schematic currently open.');
          }
          break;
      }
    },
    [
      saveAll,
      undo,
      redo,
      rotateSel,
      mirrorSel,
      workSymbol,
      curLib,
      onAddSymbolToSchematic,
      showDatasheet,
    ],
  );

  const radio = (t: Set<string>, id: string): Set<string> => {
    const group = RADIO_GROUPS.find((g) => g.includes(id));
    const next = new Set(t);
    if (group) for (const g of group) next.delete(g);
    next.add(id);
    return next;
  };
  const flip = (t: Set<string>, id: string): Set<string> => {
    const next = new Set(t);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const onLeftToggle = useCallback((id: string) => {
    setToggles((prev) =>
      RADIO_GROUPS.some((g) => g.includes(id)) ? radio(prev, id) : flip(prev, id),
    );
  }, []);

  // ----- pin placement (SYMBOL_EDITOR_PIN_TOOL) ---------------------------------------
  const onPinToolClick = useCallback(
    (pos: Vec2) => {
      if (!workSymbol || isAlias) return;
      const lp = lastPin.current;
      setPinDialog({
        isNew: true,
        pin: {
          electricalType: lp.electricalType,
          shape: lp.shape,
          at: pos,
          angle: lp.angle,
          length: lp.length,
          name: '',
          number: '',
          nameSize: lp.nameSize,
          numberSize: lp.numberSize,
          hidden: !lp.visible,
          source: EMPTY_SOURCE,
        },
      });
    },
    [workSymbol, isAlias],
  );

  const onPinDialogOk = useCallback(
    (r: PinDialogResult) => {
      const wasNew = pinDialog?.isNew;
      const editId = pinDialog?.editId;
      setPinDialog(null);
      // Persist the "last pin" defaults (g_LastPin*).
      lastPin.current = {
        electricalType: r.pin.electricalType,
        shape: r.pin.shape,
        angle: r.pin.angle,
        length: r.pin.length,
        nameSize: r.pin.nameSize ?? DEFAULT_LAST_PIN.nameSize,
        numberSize: r.pin.numberSize ?? DEFAULT_LAST_PIN.numberSize,
        commonUnit: r.commonToAllUnits,
        commonBody: r.commonToAllBodyStyles,
        visible: !r.pin.hidden,
      };
      if (wasNew) {
        setPendingPin({
          ...r.pin,
          _commonUnit: r.commonToAllUnits,
          _commonBody: r.commonToAllBodyStyles,
        });
      } else if (editId && workSymbol) {
        // EditPinProperties: apply the dialog and, in synchronized mode, update the
        // matching pins of the other units (same original position/orientation/
        // type/visibility/name, one per unit).
        const ref = parseItemId(editId);
        const original = ref && workSymbol.units[ref.unitIdx]?.pins[ref.itemIdx];
        let next = replaceSymbolItem(workSymbol, editId, r.pin);
        if (original && synced && units > 1) {
          const gotUnit = new Set<number>([workSymbol.units[ref!.unitIdx]!.unit]);
          next = {
            ...next,
            units: next.units.map((u, ui) => {
              if (ui === ref!.unitIdx || gotUnit.has(u.unit)) return u;
              let taken = false;
              const pins = u.pins.map((other) => {
                if (taken) return other;
                if (
                  other.at.x === original.at.x &&
                  other.at.y === original.at.y &&
                  other.angle === original.angle &&
                  other.electricalType === original.electricalType &&
                  other.hidden === original.hidden &&
                  other.name === original.name
                ) {
                  taken = true;
                  return {
                    ...other,
                    length: r.pin.length,
                    at: r.pin.at,
                    shape: r.pin.shape,
                    angle: r.pin.angle,
                    electricalType: r.pin.electricalType,
                    hidden: r.pin.hidden,
                    name: r.pin.name,
                    nameSize: r.pin.nameSize,
                    numberSize: r.pin.numberSize,
                  };
                }
                return other;
              });
              if (taken) gotUnit.add(u.unit);
              return taken ? { ...u, pins } : u;
            }),
          };
        }
        commit(next, 'Edit Pin Properties');
      }
    },
    [pinDialog, workSymbol, synced, units, commit],
  );

  const onPlacePendingPin = useCallback(
    (pos: Vec2) => {
      if (!workSymbol || !pendingPin || !curLib) return;
      const { _commonUnit, _commonBody, ...pinBase } = pendingPin;
      const pin: LibPin = { ...pinBase, at: pos };
      const pinUnit = _commonUnit ? 0 : unit;
      const pinBody = _commonBody ? 0 : bodyStyle;

      // PlacePin: warn when the position is already occupied in another unit.
      if (synced) {
        const clash = allPins(workSymbol).find(({ pin: test, unitIdx }) => {
          const u = workSymbol.units[unitIdx]!;
          if (test.at.x !== pos.x || test.at.y !== pos.y) return false;
          if (u.bodyStyle && pinBody && u.bodyStyle !== pinBody) return false;
          return true;
        });
        if (clash) {
          const u = workSymbol.units[clash.unitIdx]!;
          if (
            !window.confirm(
              `This position is already occupied by another pin, in unit ${u.unit || 1}.\nPlace Pin Anyway?`,
            )
          )
            return;
        }
      }

      let { sym: next } = addPinToSymbol(workSymbol, pin, pinUnit, pinBody);
      if (synced && units > 1) next = createImagePins(next, pin, pinUnit, pinBody);
      commit(next, 'Place Pin');
      // The tool stays active; the next click opens the dialog again (CreatePin).
      setPendingPin(null);
    },
    [workSymbol, pendingPin, curLib, unit, bodyStyle, synced, units, commit],
  );

  // ----- text / shapes ------------------------------------------------------------------
  const onTextToolClick = useCallback(() => {
    if (!workSymbol || isAlias) return;
    setTextDialog({});
  }, [workSymbol, isAlias]);

  const onTextDialogOk = useCallback(
    (r: { text: string; fontSize: number; bold: boolean; italic: boolean }) => {
      const editId = textDialog?.editId;
      setTextDialog(null);
      if (editId && workSymbol) {
        const ref = parseItemId(editId);
        const g = ref && workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
        if (g && g.kind === 'text') {
          const next: LibGraphic = {
            ...g,
            text: r.text,
            effects: {
              ...(g.effects ?? { hidden: false }),
              fontSize: [r.fontSize, r.fontSize],
              bold: r.bold || undefined,
              italic: r.italic || undefined,
            },
          };
          commit(replaceSymbolItem(workSymbol, editId, next), 'Edit Text');
        }
      } else {
        setPendingText(r);
      }
    },
    [textDialog, workSymbol, commit],
  );

  const onPlacePendingText = useCallback(
    (pos: Vec2) => {
      if (!workSymbol || !pendingText) return;
      const g: LibGraphic = {
        kind: 'text',
        text: pendingText.text,
        at: pos,
        angle: 0,
        effects: {
          hidden: false,
          fontSize: [pendingText.fontSize, pendingText.fontSize],
          bold: pendingText.bold || undefined,
          italic: pendingText.italic || undefined,
        },
        source: EMPTY_SOURCE,
      };
      commit(addGraphicToSymbol(workSymbol, g, unit, bodyStyle).sym, 'Draw Text');
      setPendingText(null);
    },
    [workSymbol, pendingText, unit, bodyStyle, commit],
  );

  const onPlaceShape = useCallback(
    (g: LibGraphic) => {
      if (!workSymbol || isAlias) return;
      // New shapes take KiCad's defaults: line_width 0 ("default") and no fill.
      commit(addGraphicToSymbol(workSymbol, g, unit, bodyStyle).sym, `Add ${g.kind}`);
    },
    [workSymbol, isAlias, unit, bodyStyle, commit],
  );

  // ----- item editing -----------------------------------------------------------------
  const onEditItem = useCallback(
    (hit: SymbolHit) => {
      if (!workSymbol) return;
      const ref = parseItemId(hit.id);
      if (!ref) return;
      if (hit.kind === 'pin') {
        const pin = workSymbol.units[ref.unitIdx]?.pins[ref.itemIdx];
        if (pin) setPinDialog({ pin, isNew: false, editId: hit.id });
      } else if (hit.kind === 'gfx') {
        const g = workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
        if (g?.kind === 'text') {
          setTextDialog({
            editId: hit.id,
            initial: {
              text: g.text,
              fontSize: g.effects?.fontSize?.[0] ?? 1.27 * MM,
              bold: !!g.effects?.bold,
              italic: !!g.effects?.italic,
            },
          });
        } else if (g) {
          setShapeDialog({ editId: hit.id });
        }
      } else {
        setSymbolPropsOpen(true);
      }
    },
    [workSymbol],
  );

  const onShapeDialogOk = useCallback(
    (r: {
      strokeWidth: number;
      strokeType: string;
      fillType: 'none' | 'outline' | 'background';
    }) => {
      const editId = shapeDialog?.editId;
      setShapeDialog(null);
      if (!editId || !workSymbol) return;
      const ref = parseItemId(editId);
      const g = ref && workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
      if (!g || g.kind === 'text') return;
      const next: LibGraphic = {
        ...g,
        stroke: { width: r.strokeWidth, type: r.strokeType },
        fill: { type: r.fillType },
      };
      commit(replaceSymbolItem(workSymbol, editId, next), 'Edit Shape');
    },
    [shapeDialog, workSymbol, commit],
  );

  /** Symbol properties dialog OK (UpdateAfterSymbolProperties). */
  const onSymbolPropsOk = useCallback(
    (r: {
      name: string;
      properties: SchField[];
      keywords: string;
      unitCount: number;
      unitsInterchangeable: boolean;
      isPower: boolean;
      pinNameInside: boolean;
      pinNameOffset: number;
      showPinNumbers: boolean;
      showPinNames: boolean;
    }) => {
      setSymbolPropsOpen(false);
      if (!workSymbol || !curLib) return;
      let next = workSymbol;

      // Rebuild the property list: dialog rows + the preserved hidden ki_* fields.
      const hiddenExtras = workSymbol.properties.filter((f) => f.key === 'ki_fp_filters');
      const props: SchField[] = [...r.properties];
      if (r.keywords.trim() !== '') {
        const old = workSymbol.properties.find((f) => f.key === 'ki_keywords');
        props.push(
          old
            ? { ...old, value: r.keywords }
            : {
                key: 'ki_keywords',
                value: r.keywords,
                at: { x: 0, y: 0 },
                angle: 0,
                effects: { hidden: true },
                source: EMPTY_SOURCE,
              },
        );
      }
      if (!r.unitsInterchangeable && r.unitCount >= 2) {
        const old = workSymbol.properties.find((f) => f.key === 'ki_locked');
        props.push(
          old ?? {
            key: 'ki_locked',
            value: '',
            at: { x: 0, y: 0 },
            angle: 0,
            effects: { hidden: true },
            source: EMPTY_SOURCE,
          },
        );
      }
      props.push(...hiddenExtras);

      next = {
        ...next,
        properties: props,
        isPower: r.isPower,
        pinNumbersHidden: !r.showPinNumbers,
        pinNamesHidden: !r.showPinNames,
        pinNameOffset: r.pinNameInside ? r.pinNameOffset : 0,
      };
      next = setUnitCount(next, r.unitCount);
      if (r.name !== workSymbol.libId) next = renameSymbol(next, r.name);
      commit(next, 'Edit Symbol Properties');
    },
    [workSymbol, curLib, commit],
  );

  /**
   * The menu tree, mirrored for the key chain below - `menus` is built further
   * down, and the chain has to dispatch off the live one. Same reason
   * `useMenuHotkeys` holds a ref rather than a dependency.
   */
  const menusRef = useRef<Menu[]>([]);

  // ----- keyboard (hotkeys per sch_actions defaults) --------------------------------------
  // One chain, in ACTION_MANAGER::RunHotKey order: the context actions this
  // canvas owns, then the menus. See ui/menu_hotkeys.ts.
  useEffect(() => {
    const anyDialogOpen =
      pinDialog ||
      textDialog ||
      shapeDialog ||
      newSymbolOpen ||
      symbolPropsOpen ||
      pinTableOpen ||
      checkOpen ||
      newLibName !== null;
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'symbols') !== 'symbols') return;
      // The library tree already claimed it (TreeSelActions).
      // `defaultPrevented` means someone already acted on this key - EXCEPT
      // when it was our own browser suppressor, which runs in the capture phase
      // and cancels every combo the app claims purely to stop the browser.
      // Reading that as "handled" is what made every hotkey in the app stop
      // working once the dispatcher landed (c4a00590).
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      if (anyDialogOpen && e.key !== 'Escape') return;
      // tool_dispatcher.cpp:654-670 - an editable entry takes every key, a
      // read-only one keeps Ctrl+C. dispatchMenuHotkey re-applies this for the
      // menus; here it gates the context branches.
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      // A canvas tool key is MD_NONE upstream, so a modified press is a
      // different action and must fall through to the menus. It is also what
      // keeps bare Y (mirrorV) apart from Ctrl+Y (redo).
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;

      // --- context: what the live tool / selection owns -----------------------
      if (e.key === 'Escape') {
        // ACTIONS::cancelInteractive. A modal here has no row and no key of its
        // own, so Escape backs out of the dialog, then the pending placement,
        // then the tool, then the selection.
        if (anyDialogOpen) {
          setPinDialog(null);
          setTextDialog(null);
          setShapeDialog(null);
          setNewSymbolOpen(false);
          setSymbolPropsOpen(false);
          setPinTableOpen(false);
          setCheckOpen(false);
          setNewLibName(null);
        } else if (pendingPin) setPendingPin(null);
        else if (pendingText) setPendingText(null);
        else if (activeTool !== 'select') setActiveTool('select');
        else setSelection(new Set());
        return;
      }
      if (plain) {
        const k = e.key.toLowerCase();
        // SCH_ACTIONS::rotateCCW / rotateCW (R / Shift+R) and mirrorH / mirrorV
        // (X / Y). None of the four has a row in this frame's Edit menu.
        if (k === 'r') {
          e.preventDefault();
          rotateSel(!e.shiftKey);
          return;
        }
        if (k === 'x') {
          e.preventDefault();
          mirrorSel(false);
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          mirrorSel(true);
          return;
        }
        // SCH_ACTIONS::properties (E) on a single selected item - no row here,
        // and it claims the key only when there is exactly one thing to edit,
        // which is its ACTION_CONDITIONS.
        if (k === 'e' && selection.size === 1 && workSymbol) {
          const id = [...selection][0]!;
          const ref = parseItemId(id);
          if (ref) {
            e.preventDefault();
            onEditItem({ id, kind: ref.kind });
            return;
          }
        }
      }

      // --- global: the menu accelerators --------------------------------------
      if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selection,
    workSymbol,
    activeTool,
    rotateSel,
    mirrorSel,
    onEditItem,
    pinDialog,
    textDialog,
    shapeDialog,
    newSymbolOpen,
    symbolPropsOpen,
    pinTableOpen,
    checkOpen,
    newLibName,
    pendingPin,
    pendingText,
  ]);

  // ----- selection ---------------------------------------------------------------------
  const onSelect = useCallback((id: string | null, additive: boolean) => {
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return prev.has(id) ? prev : new Set([id]);
    });
  }, []);

  const onSelectBox = useCallback(
    (ids: ReadonlySet<string>, additive: boolean, subtractive: boolean) => {
      setSelection((prev) => {
        if (subtractive) {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        }
        if (additive) {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        }
        return new Set(ids);
      });
    },
    [],
  );

  // ----- library tree (symbol_tree_pane / LIB_TREE) -----------------------------------------
  const libNames = manager.current.libraryNames();
  const q = query.trim().toLowerCase();
  void revision;

  const treeRows = useMemo(() => {
    interface Row {
      lib: string;
      sym?: string;
      desc?: string;
      modified?: boolean;
    }
    const rows: Row[] = [];
    const mgr = manager.current;
    for (const libName of libNames) {
      const lib = mgr.library(libName)!;
      const names = mgr.symbolNames(libName);
      if (q) {
        const matches = names.filter(
          (n) => n.toLowerCase().includes(q) || `${libName}:${n}`.toLowerCase().includes(q),
        );
        if (matches.length === 0 && !libName.toLowerCase().includes(q)) continue;
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        for (const n of (matches.length > 0 ? matches : names).slice(0, 100)) {
          rows.push({ lib: libName, sym: n, modified: mgr.isSymbolModified(libName, n) });
        }
      } else {
        rows.push({ lib: libName, modified: mgr.isLibraryModified(libName) });
        if (expanded.has(libName)) {
          for (const n of names) {
            const sym = lib.symbols.get(n);
            const desc = sym?.properties.find(
              (f) => f.key === 'Description' || f.key === 'ki_description',
            )?.value;
            rows.push({
              lib: libName,
              sym: n,
              ...(desc ? { desc } : {}),
              modified: mgr.isSymbolModified(libName, n),
            });
          }
        }
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libNames, q, expanded, revision]);

  const toggleLib = useCallback(
    (libName: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(libName)) next.delete(libName);
        else {
          next.add(libName);
          void manager.current.ensureLoaded(libName).then(bump);
        }
        return next;
      });
    },
    [bump],
  );

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: MouseEvent): void =>
      setPanelWidth(Math.min(500, Math.max(160, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  // ----- menus (menubar_symbol_editor.cpp) -------------------------------------------
  //
  // The tree lives in `menubar.ts`. A menu built inside a `.tsx` cannot be
  // reached by any test - `qa`'s tsconfig compiles `.ts` only - which is why
  // every row upstream has and this bar does not went unnoticed. What stays
  // here is the frame's half: the three handlers and the ENABLE() conditions.
  const onMenuAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'newLibrary':
          setNewLibName('');
          break;
        case 'addLibrary':
          setSymOpenDlg('addLibrary');
          break;
        case 'newSymbol':
          setNewSymbolOpen(true);
          break;
        case 'save':
          save();
          break;
        case 'saveAll':
          saveAll();
          break;
        case 'revert':
          revert();
          break;
        case 'importSymbol':
          setSymOpenDlg('importSymbol');
          break;
        case 'exportSymbol':
          void exportSymbol();
          break;
        case 'symbolProperties':
          if (workSymbol) setSymbolPropsOpen(true);
          break;
        case 'close':
          onExitToHome();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'doDelete':
          if (workSymbol && selection.size > 0 && !isAlias) {
            commit(deleteSymbolItems(workSymbol, selection), 'Delete');
            setSelection(new Set());
          }
          break;
        case 'pinTable':
          if (workSymbol) setPinTableOpen(true);
          break;
        case 'zoomInCenter':
          controller.current?.zoomIn();
          break;
        case 'zoomOutCenter':
          controller.current?.zoomOut();
          break;
        case 'zoomFitScreen':
          controller.current?.zoomToFit();
          break;
        case 'showDatasheet':
          showDatasheet();
          break;
        case 'checkSymbol':
          if (workSymbol) setCheckOpen(true);
          break;
        // ACTIONS::openPreferences. The dialog is `dialogs/PreferencesDialog`,
        // the one every other launcher opens - there is not a symbol-editor
        // copy of it, the way there is not one upstream.
        case 'openPreferences':
          setPrefsOpen(true);
          break;
      }
    },
    [
      save,
      saveAll,
      revert,
      exportSymbol,
      onExitToHome,
      undo,
      redo,
      workSymbol,
      selection,
      isAlias,
      commit,
      showDatasheet,
    ],
  );

  const menus: Menu[] = useMemo(
    () =>
      symbolEditorMenus(
        {
          action: onMenuAction,
          tool: onToolSelect,
          toggle: onLeftToggle,
          // Preferences > Set Language. The setting is COMMON_SETTINGS', shared
          // by every frame, so it is read and written through the common store
          // exactly as the other launchers do.
          language: common.system.language,
          onSelectLanguage: (label: string) =>
            settings.updateCommon((c) => {
              c.system.language = label;
            }),
          showHotkeys: showHotkeyList,
          showAbout: () => setAboutOpen(true),
        },
        {
          showHiddenPins: toggles.has('showHiddenPins'),
          showHiddenFields: toggles.has('showHiddenFields'),
          showLibraryTree: toggles.has('showLibraryTree'),
          showProperties: toggles.has('showProperties'),
        },
        {
          haveSymbol: !!workSymbol,
          revert: !!curName,
          targetSymbol: !!(curName || treeSel?.name),
          // `IsSymbolFromSchematic()`. Nothing can open this frame on a
          // schematic's own symbol yet, so it is false and stays false until
          // something can - at which point File > Save All disappears and Edit
          // Library Symbol lights up, both on their own.
          symbolFromSchematic: false,
        },
      ),
    [
      onMenuAction,
      onToolSelect,
      onLeftToggle,
      toggles,
      workSymbol,
      curName,
      treeSel,
      common.system.language,
    ],
  );

  // The chain above reads the tree through this ref; see `menusRef`.
  menusRef.current = menus;

  // ----- title (SYMBOL_EDIT_FRAME::UpdateTitle) ------------------------------------------
  //
  // Built by the shared rule rather than restated here - see `frame_title.ts`
  // for the C++ and for the three things this frame decides for itself. What
  // used to be here printed the PROJECT name where the LIB_ID goes, which is
  // not a formatting slip but the wrong document: editing `Device:R` read
  // `MyProject - Symbol Editor`.
  const modified = curLib && curName ? manager.current.isSymbolModified(curLib, curName) : false;
  const symTitle = useMemo(
    () =>
      symFrameTitle(
        {
          // `GetCurSymbol()`.
          hasSymbol: workSymbol !== null && workSymbol !== undefined,
          // `IsSymbolFromSchematic()`.
          fromSchematic: editingSchematicSymbol,
          // `m_reference = symbol->GetReferenceField().GetText()`
          // (symbol_edit_frame.cpp:2048) - the WORKING symbol's Reference
          // field, which is the same expression upstream evaluates.
          //
          // Ours reads `R` where KiCad reads `R12`, and the cause is not here:
          // `libSymbolFromPlacement` deliberately keeps the LIBRARY's field
          // values rather than the placement's, because our `libById` is the
          // schematic's own embedded `lib_symbols` and writing `R12` back into
          // the cached `Device:R` would arm "Update Symbols from Library" to
          // push it onto every other resistor. That trade is documented at
          // `eeschema/src/tools/symbol_from_schematic.ts:30-47` and owned
          // there; the title just reports what the working symbol says.
          reference: workSymbol?.properties.find((f) => f.key === 'Reference')?.value ?? '',
          // `GetCurSymbol()->GetLibId().Format()`, still escaped - the module
          // unescapes, as `UpdateTitle` does.
          libId: curName ? `${curLib}:${curName}` : (workSymbol?.libId ?? ''),
          // `m_libMgr->LibraryExists( … ) && m_libMgr->IsLibraryReadOnly( … )`.
          // Always false today: `SymbolLibraryManager` has no writability
          // notion at all, so `[Read Only Library]` cannot yet appear. That is
          // a missing capability rather than a title bug - the branch is
          // ported and tested, and lights up as soon as the manager can answer.
          readOnlyLibrary: false,
          // `GetScreen() && GetScreen()->IsContentModified()`.
          modified,
        },
        unescapeString,
      ),
    [workSymbol, editingSchematicSymbol, curLib, curName, modified],
  );

  useDocumentTitle('symbols', formatTitle(SYM_FRAME_NAME, symTitle.document, modified));

  // Library edits are buffered and only written by Save, so closing the tab
  // discards them. `hasModifications()` is the manager's own answer to "is
  // there anything unwritten", across every open library rather than just the
  // symbol on screen — losing an edit to a library you are not looking at is
  // the easier mistake to make.
  useUnsavedGuard(manager.current.hasModifications());

  const unitsLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  // MessageTextFromValue at the eeschema IU scale, which is the short form:
  // mm %.3f (trimmed), mils %.0f, inches %.3f.
  const fmt = (iu: number): string => messageTextFromValue(iuToMM(iu), unitsLabel, SCH_IU_PER_MM);

  /**
   * SYMBOL_EDIT_FRAME::UpdateSymbolMsgPanelInfo
   * (eeschema/symbol_editor/symbol_editor.cpp:1740): Name, Parent (derived
   * symbols only), Type, Description, Keywords, Datasheet.
   */
  const symbolMsgPanelItems = useMemo((): MsgPanelItem[] => {
    if (!workSymbol) return [];

    const field = (key: string): string =>
      workSymbol.properties.find((f) => f.key === key)?.value ?? '';

    return [
      { upper: 'Name', lower: curName ?? workSymbol.libId },
      ...(isAlias ? [{ upper: 'Parent', lower: workSymbol.extends ?? 'Undefined!' }] : []),
      {
        upper: 'Type',
        lower: workSymbol.isPower
          ? workSymbol.isLocalPower
            ? 'Power Symbol (Local)'
            : 'Power Symbol'
          : 'Symbol',
      },
      { upper: 'Description', lower: field('ki_description') },
      { upper: 'Keywords', lower: field('ki_keywords') },
      { upper: 'Datasheet', lower: field('Datasheet') },
    ];
  }, [workSymbol, curName, isAlias]);

  const propsSummary = useMemo(() => {
    if (!workSymbol || selection.size !== 1) return null;
    const ref = parseItemId([...selection][0]!);
    if (!ref) return null;
    if (ref.kind === 'pin') {
      const p = workSymbol.units[ref.unitIdx]?.pins[ref.itemIdx];
      return p
        ? `Pin ${p.number} '${p.name}', ${p.electricalType}, ${p.shape}, length ${fmt(p.length)} ${unitsLabel}`
        : null;
    }
    if (ref.kind === 'field') {
      const f = workSymbol.properties[ref.itemIdx];
      return f ? `Field ${f.key}: ${f.value}` : null;
    }
    const g = workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
    return g ? `Graphic: ${g.kind}` : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workSymbol, selection, unitsLabel]);

  return (
    <div className="ze-app">
      {/* `Add Library` and `Import Symbol` over the account's tree. Both were
          a hidden `<input type="file">` — the operating system's picker, which
          cannot see the account at all. */}
      {symOpenDlg && (
        <OpenFileDialog
          title={symOpenDlg === 'addLibrary' ? 'Add Library' : 'Import Symbol'}
          accept={symOpenDlg === 'addLibrary' ? 'Add' : 'Import'}
          // A symbol library lives in the project or in
          // `PATHS::GetDefaultUserSymbolsPath()` (paths.cpp:82).
          kind="symbols"
          filters={[kicadSymbolLibWildcard()]}
          onDone={(file) => {
            const which = symOpenDlg;
            setSymOpenDlg(null);
            if (!file) return; // wxID_CANCEL
            const leaf = file.path.split('/').filter(Boolean).pop() ?? file.path;
            if (which === 'addLibrary') addLibraryText(leaf, file.text);
            else void importSymbolText(leaf, file.text);
          }}
        />
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
              {symTitle.modified}
              {symTitle.document}
            </b>
            {symTitle.separator}
            {symTitle.frameName}
          </>
        }
      />

      {/* Both combos are AppendControl slots ON the toolbar
          (`toolbars_symbol_editor.cpp:148,151`), each between its own
          separators — not widgets beside it. The unit selector used to sit in a
          flex div wrapping the Toolbar, which put it outside the bar's face and
          past its right edge instead of inside the run of tools. */}
      <Toolbar
        entries={SYM_TOP_TOOLBAR}
        orientation="horizontal"
        toggled={toggles}
        onActivate={onTopAction}
        controls={{
          /**
           * `RebuildSymbolUnitAndBodyStyleLists`
           * (`symbol_edit_frame.cpp:760-787`): one EMPTY entry when the symbol
           * has a single body style, otherwise "Standard" / "Alternate" —
           * `DEMORGAN_STD` / `DEMORGAN_ALT` (`symbol_edit_frame.h:47-48`).
           *
           * Upstream has a third branch for a symbol with named body styles
           * (`GetBodyStyleNames()`); our model carries De Morgan alone, so that
           * branch has nothing to read and is not faked here.
           */
          [SYM_CONTROL.bodyStyleSelector]: (
            <select
              className="ze-select"
              title="Select body style"
              style={{ width: LISTBOX_WIDTH }}
              disabled={!showDeMorgan}
              value={bodyStyle}
              onChange={(e) => {
                setBodyStyle(Number(e.target.value));
                setSelection(new Set());
              }}
            >
              {showDeMorgan ? (
                <>
                  <option value={1}>Standard</option>
                  <option value={2}>Alternate</option>
                </>
              ) : (
                <option value={1} />
              )}
            </select>
          ),
          /** The same function's first half (`:737-758`). */
          [SYM_CONTROL.unitSelector]: (
            <select
              className="ze-select"
              title="Select unit to edit"
              style={{ width: LISTBOX_WIDTH }}
              disabled={units < 2}
              value={unit}
              onChange={(e) => {
                setUnit(Number(e.target.value));
                setSelection(new Set());
              }}
            >
              {units < 2 ? (
                <option value={1} />
              ) : (
                Array.from({ length: units }, (_, k) => (
                  <option key={k + 1} value={k + 1}>
                    Unit {letterSubReference(k + 1)}
                  </option>
                ))
              )}
            </select>
          ),
        }}
      />

      <div className="ze-body">
        {/* Three independent AUI panes upstream — "LibraryTree"
            (`symbol_edit_frame.cpp:219-225`), the properties pane
            (`:227`) and "SelectionFilter" (`:228`) — so the dock is up
            whenever EITHER of the two with a toggle is. It used to be gated on
            the tree alone, which took Properties down with it. */}
        {(toggles.has('showLibraryTree') || toggles.has('showProperties')) && (
          <>
            <div className="ze-leftdock" style={{ width: panelWidth, minWidth: panelWidth }}>
              {toggles.has('showLibraryTree') && (
              <div className="ze-panel grow">
                <div className="ze-panel-header">Libraries</div>
                <div style={{ padding: 4 }}>
                  <input
                    className="ze-search"
                    placeholder="Filter"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    style={{ width: '100%' }}
                  />
                </div>
                <div className="ze-panel-body">
                  {treeRows.length === 0 && (
                    <LibraryLoadingPanel
                      kind="symbols"
                      fallback={<div className="ze-muted">No libraries</div>}
                      label="Loading symbol libraries..."
                    />
                  )}
                  {treeRows.map((row) =>
                    row.sym === undefined ? (
                      <div
                        key={row.lib}
                        className={`ze-tree-item root${treeSel?.lib === row.lib && !treeSel.name ? ' active' : ''}`}
                        onClick={() => {
                          setTreeSel({ lib: row.lib, name: null });
                          if (!q) toggleLib(row.lib);
                        }}
                        title={manager.current.library(row.lib)?.fileName}
                      >
                        <span
                          className={`twisty expandable${expanded.has(row.lib) || q ? ' open' : ''}`}
                        />
                        {toolbarIconUrl('library') && (
                          <img
                            src={toolbarIconUrl('library')}
                            alt=""
                            style={{ width: 16, height: 16 }}
                          />
                        )}
                        <span>
                          {row.lib}
                          {row.modified ? ' *' : ''}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={`${row.lib}:${row.sym}`}
                        className={`ze-tree-item${curLib === row.lib && curName === row.sym ? ' active' : ''}`}
                        style={{
                          paddingLeft: 26,
                          fontWeight: curLib === row.lib && curName === row.sym ? 600 : 400,
                        }}
                        onClick={() => setTreeSel({ lib: row.lib, name: row.sym! })}
                        onDoubleClick={() => void loadSymbol(row.lib, row.sym!)}
                        title={row.desc ? `${row.sym}, ${row.desc}` : row.sym}
                      >
                        <span>
                          {row.sym}
                          {row.modified ? ' *' : ''}
                        </span>
                        {row.desc && (
                          <span
                            style={{
                              opacity: 0.55,
                              marginLeft: 8,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {row.desc}
                          </span>
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>
              )}
              {toggles.has('showProperties') && (
                <div className="ze-panel">
                  <div className="ze-panel-header">Properties</div>
                  <div className="ze-panel-body">
                    <div className="ze-muted">
                      {selection.size === 0
                        ? 'No objects selected'
                        : (propsSummary ?? `${selection.size} items selected`)}
                    </div>
                  </div>
                </div>
              )}
              {/* `m_selectionFilterPanel = new PANEL_SCH_SELECTION_FILTER( this )`
                  (`symbol_edit_frame.cpp:195`) — the SAME widget the schematic
                  builds, which lays itself out differently for
                  FRAME_SCH_SYMBOL_EDITOR. It has no toggle of its own; see
                  `symSelectionFilterShown`. */}
              {symSelectionFilterShown({
                libraryTree: toggles.has('showLibraryTree'),
                properties: toggles.has('showProperties'),
              }) && (
                <SelectionFilterPanel
                  frame="FRAME_SCH_SYMBOL_EDITOR"
                  filter={selFilter}
                  onChange={setSelFilter}
                />
              )}
            </div>
            <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />
          </>
        )}

        <Toolbar
          entries={SYM_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <div className="ze-canvas-wrap">
          <SymbolCanvas
            ref={controller}
            symbol={workSymbol}
            theme={theme}
            opts={opts}
            selection={selection}
            activeTool={activeTool}
            pendingPin={pendingPin}
            pendingText={pendingText}
            onSelect={onSelect}
            onSelectBox={onSelectBox}
            onCommit={commit}
            onPinToolClick={onPinToolClick}
            onPlacePendingPin={onPlacePendingPin}
            onTextToolClick={onTextToolClick}
            onPlacePendingText={onPlacePendingText}
            onPlaceShape={onPlaceShape}
            onEditItem={onEditItem}
            onCursorMove={setCursor}
            onScaleChange={setScale}
          />
          {/* Nothing goes here. An empty SYMBOL_EDIT_FRAME draws the axes and
              the grid and no text at all: `LoadOneLibrarySymbolAux` simply
              leaves the screen empty (`symbol_edit_frame.cpp:1546-1555`,
              `emptyScreen`), and the only place upstream says anything is the
              title bar's `[no symbol loaded]` (`symbol_editor.cpp:62`), which
              `frame_title.ts` already prints.

              What stood here was an invented hint centred on the canvas, in an
              invented grey (`#888`) at an invented 14 px — two chrome literals
              for a control KiCad does not have. */}
        </div>

        <Toolbar
          entries={SYM_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onToolSelect}
        />
      </div>

      <MsgPanel items={symbolMsgPanelItems} testId="sym-message-panel" />

      {/* SYMBOL_EDIT_FRAME is a SCH_BASE_FRAME, so it gets EDA_DRAW_FRAME's
          eight panes unchanged (eeschema/sch_base_frame.cpp:252). */}
      <KiStatusBar
        testIds={{ message: 'sym-status-msg', tool: 'sym-tool-msg' }}
        fields={{
          message: status,
          zoom: zoomMsg(zoomFactorForScale(scale, dpr, SCH_IU_PER_MM)),
          coords: cursor ? coordsMsg(fmt(cursor.x), fmt(cursor.y)) : coordsMsg(null),
          // SCH_SCREEN::m_LocalOrigin, which the symbol editor never moves
          // (it has no ACTIONS::resetLocalCoords binding yet), so the deltas
          // are measured from the symbol anchor.
          deltas: cursor
            ? deltasMsg(fmt(cursor.x), fmt(cursor.y), fmt(Math.hypot(cursor.x, cursor.y)))
            : deltasMsg(null),
          grid: gridMsg(fmt(GRID)),
          units: unitsMsg(unitsLabel),
          tool: SYM_TOOL_MSGS[activeTool] ?? '',
        }}
      />

      {/* ----- dialogs ----- */}
      {pinDialog && workSymbol && (
        <PinPropertiesDialog
          pin={pinDialog.pin}
          symbol={workSymbol}
          isNew={pinDialog.isNew}
          commonUnit={
            pinDialog.isNew
              ? lastPin.current.commonUnit
              : workSymbol.units[parseItemId(pinDialog.editId ?? '')?.unitIdx ?? 0]?.unit === 0
          }
          commonBody={
            pinDialog.isNew
              ? lastPin.current.commonBody
              : workSymbol.units[parseItemId(pinDialog.editId ?? '')?.unitIdx ?? 0]?.bodyStyle === 0
          }
          multiUnit={units > 1}
          onOk={onPinDialogOk}
          onCancel={() => setPinDialog(null)}
        />
      )}
      {textDialog && (
        <SymbolTextDialog
          {...(textDialog.initial ? { initial: textDialog.initial } : {})}
          onOk={onTextDialogOk}
          onCancel={() => {
            setTextDialog(null);
            if (!textDialog.editId) setActiveTool('select');
          }}
        />
      )}
      {shapeDialog &&
        workSymbol &&
        (() => {
          const ref = parseItemId(shapeDialog.editId);
          const g = ref && workSymbol.units[ref.unitIdx]?.graphics[ref.itemIdx];
          if (!g || g.kind === 'text') return null;
          return (
            <ShapePropertiesDialog
              initial={{
                strokeWidth: g.stroke?.width ?? 0,
                strokeType: g.stroke?.type ?? 'default',
                fillType: g.fill?.type ?? 'none',
              }}
              onOk={onShapeDialogOk}
              onCancel={() => setShapeDialog(null)}
            />
          );
        })()}
      {aboutOpen && <AboutDialog title={ABOUT_TITLES.symbol} onClose={() => setAboutOpen(false)} />}
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}
      {newSymbolOpen && (
        <NewSymbolDialog
          symbolNames={targetLib ? manager.current.symbolNames(targetLib) : []}
          onOk={createNewSymbol}
          onCancel={() => setNewSymbolOpen(false)}
        />
      )}
      {symbolPropsOpen && workSymbol && (
        <LibSymbolPropertiesDialog
          symbol={workSymbol}
          onOk={onSymbolPropsOk}
          onCancel={() => setSymbolPropsOpen(false)}
        />
      )}
      {pinTableOpen && workSymbol && (
        <PinTableDialog
          symbol={workSymbol}
          onOk={(next) => {
            setPinTableOpen(false);
            commit(next, 'Edit Pin Table');
          }}
          onCancel={() => setPinTableOpen(false)}
        />
      )}
      {checkOpen && workSymbol && (
        <SymbolCheckDialog symbol={workSymbol} onClose={() => setCheckOpen(false)} />
      )}

      {libError && (
        <div className="ze-modal-backdrop" onMouseDown={() => setLibError(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              {libError.title}
              <span className="x" onClick={() => setLibError(null)}>
                ✕
              </span>
            </div>
            <div className="ze-label-dialog-body">
              <div style={{ whiteSpace: 'pre-wrap', maxWidth: 460, fontSize: 12 }}>
                {libError.message}
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn primary" onClick={() => setLibError(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {newLibName !== null && (
        <div className="ze-modal-backdrop" onMouseDown={() => setNewLibName(null)}>
          <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ze-modal-header">
              New Library
              <span className="x" onClick={() => setNewLibName(null)}>
                ✕
              </span>
            </div>
            <div className="ze-label-dialog-body">
              <div className="row">
                <span>Name</span>
                <input
                  className="ze-search"
                  autoFocus
                  placeholder="MyLibrary"
                  value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && newLibName.trim()) {
                      manager.current.createLibrary(newLibName.trim());
                      setExpanded((p) => new Set([...p, newLibName.trim()]));
                      setNewLibName(null);
                      bump();
                    }
                  }}
                />
              </div>
            </div>
            <div className="ze-modal-footer">
              <button className="ze-btn" onClick={() => setNewLibName(null)}>
                Cancel
              </button>
              <button
                className="ze-btn primary"
                disabled={!newLibName.trim()}
                onClick={() => {
                  manager.current.createLibrary(newLibName.trim());
                  setExpanded((p) => new Set([...p, newLibName.trim()]));
                  setNewLibName(null);
                  bump();
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tree context actions (delete/duplicate) via keyboard on the tree selection. */}
      <TreeSelActions
        treeSel={treeSel}
        onDelete={deleteSymbol}
        onDuplicate={(l, s) => void duplicateSymbol(l, s)}
      />

      <LoadingOverlay label={loading} />
    </div>
  );
}

/** Del / Ctrl+D on the library-tree selection (the context-menu subset). */
function TreeSelActions({
  treeSel,
  onDelete,
  onDuplicate,
}: {
  treeSel: { lib: string; name: string | null } | null;
  onDelete: (lib: string, name: string) => void;
  onDuplicate: (lib: string, name: string) => void;
}): JSX.Element | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'symbols') !== 'symbols') return;
      if (!treeSel?.name) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        onDuplicate(treeSel.lib, treeSel.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [treeSel, onDelete, onDuplicate]);
  return null;
}
