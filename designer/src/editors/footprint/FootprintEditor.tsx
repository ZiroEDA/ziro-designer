// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { parse } from '@ziroeda/sexpr';
import type { Vec2 } from '@ziroeda/kimath';
import { mmToIU, pcbIuToMM, PCB_IU_PER_MM, SCH_IU_PER_MM } from '@ziroeda/common';
import { EDIT_GRIDS_LABEL, GRID_LIST_SEPARATOR, gridChoiceLabel } from '../../ui/grid_settings.js';
import { footprintGridForTool, footprintGridIU, footprintSnappingEnabled } from './grid.js';
import { newFootprint } from './new_footprint.js';
import { fpLineThicknessMM } from './graphics_defaults.js';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { EMPTY_SOURCE } from '@ziroeda/eeschema';
import { applyBarcodeValues, barcodeValues } from '@ziroeda/pcbnew/src/barcode_properties.js';
import { DialogBarcodeProperties } from '../pcb/dialogs/dialog_barcode_properties.js';
import {
  readFootprintFile,
  moveFootprintItems,
  rotateFootprintItems,
  mirrorFootprintItems,
  deleteFootprintItems,
  fpItemBBox,
  addPad,
  addPoint,
  addBarcode,
  setBarcode,
  addShape,
  DEFAULT_POINT_SIZE,
  setFootprintReference,
  setFootprintValue,
  footprintStringChild,
  setFootprintDescription,
  setFootprintKeywords,
  patchPad,
  replaceFootprintItem,
  parseFpItemId,
  type PadEdit,
  type PcbFootprint,
  type PcbBarcode,
  type PcbPad,
  type PcbShape,
  type PcbTextItem,
} from '@ziroeda/pcbnew';
import { FootprintPropertiesDialog, PadPropertiesDialog } from './dialogs.js';
import { MenuBar, ContextMenu, type Menu } from '../../ui/MenuBar.js';
import { footprintTreeContextMenu } from './tree_context_menu.js';
import { Toolbar } from '../../ui/Toolbar.js';
import { useStatusReadout } from '../../ui/useStatusReadout.js';

/** `BOARD::m_LocalOrigin`; a module constant so its identity is stable. */
const FP_LOCAL_ORIGIN = { x: 0, y: 0 };
import { LoadingOverlay } from '../../ui/LoadingOverlay.js';
import { formatTitle, useDocumentTitle } from '../../ui/useDocumentTitle.js';
import { FP_FRAME_NAME, fpFrameTitle } from './frame_title.js';
import { useUnsavedGuard } from '../../ui/useUnsavedGuard.js';
import { LibraryLoadingPanel } from '../../widgets/library_loading_panel.js';
import { LibTree } from '../../widgets/lib_tree.js';
import { LibTreeNode, LibTreeNodeType } from '../../widgets/lib_tree_model.js';
import { FpTreeSynchronizingAdapter } from './fp_tree_synchronizing_adapter.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { MsgPanel, type MsgPanelItem } from '../../ui/MsgPanel.js';
import {
  angleSnapModeOf,
  constraintsMsg,
  gridMsg,
  messageTextFromValue,
  type StatusUnits,
  unitsMsg,
  zoomFactorForScale,
  zoomMsg,
} from '../../ui/status_format.js';
import { FP_DEFAULT_TOOLBARS, footprintToolMsg } from './footprintToolbars.js';
import { useToolbarEntries } from '../../ui/useToolbarEntries.js';
import { applyToggle, DEFAULT_TOGGLES } from './toggles.js';
import { FootprintCanvas, type FootprintCanvasController } from './FootprintCanvas.js';
import { FootprintLibraryManager, fpNameOf, footprintsBase } from './libraryManager.js';
import { projectFpLibTable, projectLibraryNickname } from './fp_lib_table.js';
import {
  FOOTPRINT_COPPER_STACK,
  footprintLayers,
  FP_DEFAULT_ACTIVE_LAYER,
} from './footprintBoard.js';
import { layerColor, PCB_BACKGROUND, PCB_OBJECT_COLORS } from '../pcb/pcbTheme.js';
import { appearanceLayerRows } from '../../widgets/appearance_layers.js';
// APPEARANCE_CONTROLS and PANEL_SELECTION_FILTER are the same two widgets
// pcbnew docks; FOOTPRINT_EDIT_FRAME passes `aFpEditor = true` and its own
// board's data, and that is the whole of the difference
// (footprint_edit_frame.cpp:177-178).
import { AppearanceControls, type AppearanceTab } from '../../widgets/appearance_controls.js';
import {
  DEFAULT_OBJECTS,
  DEFAULT_OPACITY,
  OBJECT_ROWS,
  toggleObject,
  type ObjectState,
} from '../../widgets/appearance_objects.js';
import {
  BUILTIN_PRESETS,
  matchPresetName,
  presetComboItems,
  PRESET_SEPARATOR,
  viewportComboItems,
} from '../../widgets/appearance_presets.js';
import {
  DEFAULT_SELECTION_FILTER_OPTIONS,
  SelectionFilterOnlyMenu,
  SelectionFilterPanel,
  type SelectionFilterItem,
} from '../../widgets/panel_selection_filter.js';
import { GetLayerName } from '@ziroeda/pcbnew/src/layer_ids.js';
import { DEFAULT_DRAW_OPTIONS, type PcbDrawOptions } from '../pcb/renderBoard.js';
import '../../ui/shell.css';
import { AboutDialog } from '../../home/dialogs/dialog_about.js';
import { PreferencesDialog } from '../../dialogs/PreferencesDialog.js';
import type { PrefsPageId } from '../../dialogs/prefs/types.js';
import { Combo } from '../../ui/Combo.js';
import { useCommonSettings, useFpEditSettings, useUserColors } from '../../prefs/useSettings.js';
import { pcbThemeWithOverrides } from '../pcb/pcbTheme.js';
import { settings } from '../../prefs/settings.js';
import { footprintEditorMenus } from './menubar.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { ABOUT_TITLES } from '../../ui/about_titles.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '../../ui/menu_hotkeys.js';
import { wasBrowserSuppressed, type FocusLike } from '../../ui/browser_hotkeys.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { kicadFootprintLibWildcard } from '../../fs/wildcards.js';
import { CONFIRM_REVERT_EXTENDED, confirmRevertMessage } from '../../ui/confirm.js';

/**
 * The Footprint Editor frame, the web mirror of KiCad's FOOTPRINT_EDIT_FRAME
 * (pcbnew/footprint_edit_frame.cpp): menu bar (menubar_footprint_editor.cpp),
 * the three toolbars with the layer selector (toolbars_footprint_editor.cpp),
 * the footprint library tree pane (footprint_tree_pane.cpp) and the board-based
 * drawing canvas. A footprint is edited on an internal one-item board, so the
 * canvas reuses the PCB painter directly. Editing tools are staged; library
 * navigation, viewing, layer control and save are functional.
 */

export interface FootprintEditorFile {
  name: string;
  text: string;
}

const _MM = 10000;

/**
 * The two docked palette widths, `footprint_edit_frame.cpp:228-252`.
 *
 * [data] KiCad states them itself, as `FromDIP` pixels rather than a theme
 * value: the Footprints tree is `.MinSize( FromDIP( 250 ), FromDIP( 80 ) )
 * .BestSize( FromDIP( 250 ), -1 )` and the LayersManager and Selection Filter
 * are `.MinSize( FromDIP( 180 ), … ).BestSize( FromDIP( 180 ), -1 )`. Ours were
 * 260 and 200, neither of which is anywhere upstream.
 */
const LIBRARY_TREE_WIDTH = 250;
const LAYERS_MANAGER_WIDTH = 180;

const basename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

/**
 * `PCB_BARCODE`'s constructor (`pcb_barcode.cpp:61-72`), for the item the
 * barcode tool builds before opening its dialog. The layer and position are
 * the tool's; the text height stays `EDA_TEXT`'s 50 mil here rather than the
 * board setting `DrawBarcode` reads, because the footprint editor has no
 * `BOARD_DESIGN_SETTINGS` of its own to read it from.
 */
const NEW_FP_BARCODE: PcbBarcode = {
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'Dwgs.User',
  width: mmToIU(40),
  height: mmToIU(40),
  text: '',
  textHeight: mmToIU(1.27),
  kind: 'qr',
  ecc: 'L',
  showText: true,
  knockout: false,
  margin: { x: 0, y: 0 },
  source: EMPTY_SOURCE,
};

/**
 * The two combos under the notebook.
 *
 * `loadDefaultLayerPresets` and `rebuildViewportsWidget` are called from the
 * one `APPEARANCE_CONTROLS` constructor with no `m_isFpEditor` branch, so this
 * frame gets the same eight built-in presets pcbnew does. Neither list can grow
 * here yet: this frame has no project to save a user preset or a viewport into,
 * which is why both "Delete …" rows are handed in disabled.
 */
const PRESET_ITEMS = presetComboItems();
const VIEWPORT_ITEMS = viewportComboItems();

// The left toolbar's radio groups, its opening state and its reducer are in
// `toggles.ts` rather than here, because `qa`'s tsconfig compiles `.ts` only:
// a default written in a `.tsx` is one no test can read, and the line mode had
// been wrong since the toolbar landed.

/**
 * Resolve a project `.kicad_mod` path (the file the project manager
 * double-clicked, KiCad's MAIL_FP_EDIT packet) to the library nickname and
 * footprint name the manager keys it under. Mirrors the bootstrap grouping:
 * a footprint's library is its `.pretty` directory, its name the file basename.
 */
function fpTargetOf(path: string): { lib: string; name: string } {
  const norm = path.replace(/\\/g, '/');
  const m = /([^/]+)\.pretty\//i.exec(norm);
  const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
  const lib = dir
    .replace(/\.pretty$/i, '')
    .split('/')
    .pop()!;
  return { lib, name: fpNameOf(norm) };
}

/**
 * `ACTIONS::gridOrigin` — the second row of the Show Grid button's right-click
 * menu (`pcbnew/toolbars_footprint_editor.cpp:54-62`) — is
 * `COMMON_TOOLS::GridOrigin`, a WX_PT_ENTRY_DIALOG that writes `SetGridOrigin`
 * (`common/tool/common_tools.cpp:637-651`), and we do not have it. Shown in its
 * upstream position and greyed, which is what this editor already does with
 * every entry it cannot run yet.
 */
const FP_LEFT_DISABLED: ReadonlySet<string> = new Set(['gridOrigin']);

export function FootprintEditor({
  onExitToHome,
  initialProject,
  openRequest,
}: {
  onExitToHome: () => void;
  initialProject?: FootprintEditorFile[] | null;
  /** The `.kicad_mod` the project manager launched us on (KiCad's MAIL_FP_EDIT).
   *  Re-sent with a fresh nonce each activation so a resident editor re-opens. */
  openRequest?: { file: string | null; nonce: number } | null;
}): JSX.Element {
  /*
   * `EDA_BASE_FRAME::RecreateToolbars` asks the TOOLBAR_SETTINGS for each
   * location rather than reading `DefaultToolbarConfig` itself
   * (`common/eda_base_frame.cpp:1728-1843`), which is the whole reason
   * Preferences > Toolbars does anything. This frame read the module constants,
   * so its page would have edited `fpedit-toolbars` and changed nothing on
   * screen — the exact defect `useToolbarEntries` was written to end.
   */
  /**
   * `GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" )`, which upstream the
   * frame holds as `GetFootprintEditorSettings()` and every one of its
   * Preferences pages is handed. Subscribed, so pressing OK on any of them
   * repaints this frame — `EDA_BASE_FRAME::CommonSettingsChanged`.
   */
  const fpCfg = useFpEditSettings();
  /** `colors/user.json`'s `board.*` rows — the other half of what the Colors
   *  page writes. */
  const userColors = useUserColors();
  /**
   * `updateEnabledLayers()` — this frame's layer set, whose `User.n` rows come
   * from Preferences > Footprint Editor > User Layer Names. A module constant
   * here is what made that page unreachable: the count and the names had
   * nothing to change.
   */
  const fpLayers = useMemo(() => footprintLayers(fpCfg), [fpCfg]);
  const allFpLayers = useMemo(() => fpLayers.map((l) => l.name), [fpLayers]);

  const fpTopBar = useToolbarEntries('fpedit', 'TOP_MAIN', FP_DEFAULT_TOOLBARS);
  const fpLeftBar = useToolbarEntries('fpedit', 'LEFT', FP_DEFAULT_TOOLBARS);
  const fpRightBar = useToolbarEntries('fpedit', 'RIGHT', FP_DEFAULT_TOOLBARS);

  const manager = useRef(new FootprintLibraryManager());
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const [curLib, setCurLib] = useState<string | null>(null);
  const [curName, setCurName] = useState<string | null>(null);
  const [workFp, setWorkFp] = useState<PcbFootprint | null>(null);

  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // Whole-footprint snapshot undo/redo (SaveCopyInUndoList), reset per load.
  const undoStack = useRef<PcbFootprint[]>([]);
  const redoStack = useRef<PcbFootprint[]>([]);
  /**
   * `EDA_BASE_FRAME::GetUndoCommandCount()` / `GetRedoCommandCount()`, which
   * `EDITOR_CONDITIONS::UndoAvailable` / `RedoAvailable`
   * (`common/tool/editor_conditions.cpp:169-178`) compare against zero to grey
   * the two Edit rows. The stacks themselves are refs, so a depth read at
   * render time would be a value nothing re-reads; these mirror them into
   * state so the menu tree is rebuilt when they move.
   */
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set(allFpLayers));
  // `SetActiveLayer( F_SilkS )` — see `FP_DEFAULT_ACTIVE_LAYER`.
  const [activeLayer, setActiveLayer] = useState(FP_DEFAULT_ACTIVE_LAYER);
  // ----- APPEARANCE_CONTROLS' state -------------------------------------------
  //
  // Held by the frame, exactly as upstream holds it on the BOARD/VIEW and the
  // panel reads it back through `getVisibleLayers()` / `getVisibleObjects()`.
  // Every one of these had no counterpart here at all: the panel was a list of
  // coloured squares with no tabs, no objects, no display options and no
  // presets.
  const [tab, setTab] = useState<AppearanceTab>('Layers');
  const [objects, setObjects] = useState<ObjectState>(DEFAULT_OBJECTS);
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  /** HIGH_CONTRAST_MODE, `m_ContrastModeDisplay` (NORMAL by default). */
  const [contrast, setContrast] = useState<'normal' | 'dim' | 'hide'>('normal');
  /** `PCB_DISPLAY_OPTIONS::m_FlipBoardView`. */
  const [flipBoard, setFlipBoard] = useState(false);
  /** `m_paneLayerDisplayOptions->Collapse()` (appearance_controls.cpp:628). */
  const [layerOptsOpen, setLayerOptsOpen] = useState(false);
  /** `m_tool->GetFilter()`, PANEL_SELECTION_FILTER's options. */
  const [selFilter, setSelFilter] = useState<Set<string>>(
    new Set(DEFAULT_SELECTION_FILTER_OPTIONS),
  );
  const [filterMenu, setFilterMenu] = useState<{
    x: number;
    y: number;
    item: SelectionFilterItem;
  } | null>(null);
  /** `m_cbViewports->SetSelection( GetCount() - 3 )` — the separator. */
  const [viewportSel, setViewportSel] = useState(PRESET_SEPARATOR);
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const [activeTool, setActiveTool] = useState('selectSetRect');
  /**
   * `BOARD_DESIGN_SETTINGS::GetGridOrigin()` of this frame's board.
   *
   * `FOOTPRINT_EDIT_FRAME` owns a real `BOARD` holding the one footprint, so it
   * has a grid origin, and `ACTIONS::gridSetOrigin` on its right toolbar moves
   * it. Frame state and not document state, because nothing in `.kicad_mod` can
   * express it — upstream's lives on the dummy board and dies with the frame
   * too.
   */
  const [gridOrigin, setGridOrigin] = useState<Vec2>({ x: 0, y: 0 });
  /** Whether any tool has been pushed since the frame opened — see `selectTool`. */
  const [toolArmed, setToolArmed] = useState(false);
  /**
   * `window.grid.last_size_idx` and `window.grid.sizes`, out of `fpedit.json` —
   * not React state and not `GRID_SIZE_LIST.pcbnew`.
   *
   * `GRID_SETTINGS::grids` is what `PANEL_GRID_SETTINGS` edits: add, edit,
   * remove and reorder all write `m_grids` back into `gridCfg.grids`
   * (`common/dialogs/panel_grid_settings.cpp:190-192`), and `last_size` is the
   * row its Current Grid choice selects. A frame reading the module table
   * instead would draw the stock grids however that page was left, which is the
   * same defect the toolbars had before `useToolbarEntries`.
   *
   * The default is still 15 — `app_settings.cpp:472-481`, `0.5 mm` — but it is
   * now `FPEDIT_DEFAULTS`' rather than a second copy of it here.
   */
  const gridIdx = fpCfg.window.grid.last_size_idx;
  /**
   * `PCB_GRID_HELPER::GetGridSize( GetItemGrid( … ) )` — the current grid
   * unless a Grid Overrides row applies to the kind of item the active tool
   * lays down. The status bar deliberately does NOT use this: `DisplayGridMsg`
   * prints the current grid.
   */
  const toolGridIU = footprintGridForTool(fpCfg, activeTool);
  const setGridIdx = useCallback((next: number) => {
    settings.updateFpEdit((s) => {
      s.window.grid.last_size_idx = next;
    });
  }, []);
  // First anchor of a 2-click graphic (line/rect/circle) being drawn.
  const [drawStart, setDrawStart] = useState<Vec2 | null>(null);
  /** The barcode properties dialog: `at` for a new one, `index` to edit one. */
  const [barcodeDialog, setBarcodeDialog] = useState<{ at: Vec2; index?: number } | null>(null);
  const unitLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  /**
   * The panes that follow the pointer, written through refs.
   *
   * `PCB_BASE_FRAME::UpdateStatusBar` writes them with `SetStatusText` on every
   * cursor motion and repaints nothing else; this frame re-rendered itself
   * whole on every mouse move instead. `localOrigin` is `BOARD::m_LocalOrigin`,
   * which the footprint editor never moves (no `ACTIONS::resetLocalCoords`
   * binding yet), so the deltas run from the footprint origin.
   */
  const statusReadout = useStatusReadout({
    units: unitLabel,
    localOrigin: FP_LOCAL_ORIGIN,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    iuPerMM: SCH_IU_PER_MM,
    // `PCB_BASE_FRAME::GetShowPolarCoords()` -> `m_PolarCoords`, which the left
    // toolbar's `ACTIONS::togglePolarCoords` writes
    // (`footprint_editor_settings.cpp:115-116`).
    polar: fpCfg.editing.polar_coords,
    // `PCB_ORIGIN_TRANSFORMS::invertXAxis()` / `invertYAxis()`, i.e.
    // Preferences > Footprint Editor > Origins & Axes.
    invertX: fpCfg.origin_invert_x_axis,
    invertY: fpCfg.origin_invert_y_axis,
  });
  const [scale, setScale] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  /**
   * `GetLibTree()->GetSelectedLibId()`, the tree's selection as this frame
   * reads it back — the four conditions in `FOOTPRINT_EDITOR_CONTROL::Init`
   * and `GetTargetFPID`.
   *
   * The search string and the expansion state are NOT here any more: they
   * belong to `LIB_TREE`, and a frame that kept its own copies is what made
   * the shared widget unmountable in this pane.
   */
  const [treeSel, setTreeSel] = useState<{ lib: string; name: string | null } | null>(null);
  /**
   * The Footprints pane's width, `m_editorSettings->m_LibWidth`.
   *
   * `FOOTPRINT_EDIT_FRAME` restores it with `SetAuiPaneSize( m_auimgr, treePane,
   * libWidth, -1 )` while the frame is being built (`:279-280`) and writes
   * `m_treePane->GetSize().x` back in `SaveSettings` (`:837`) and whenever the
   * pane is hidden (`:414`). We never persisted it, so every session opened at
   * the default however the user had left it.
   *
   * `LIBRARY_TREE_WIDTH` is still the fallback: it is `PARAM<int>(
   * "window.lib_width", &m_LibWidth, 250 )`'s default and the pane's own
   * `BestSize`, which is the same number twice upstream.
   */
  const [panelWidth, setPanelWidth] = useState(
    () => settings.fpEdit.window.lib_width || LIBRARY_TREE_WIDTH,
  );
  /** Read by `onLeftToggle`, which must not be rebuilt on every drag frame. */
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  /** The same, for the toggle set it is about to change. */
  const togglesRef = useRef<ReadonlySet<string>>(toggles);
  togglesRef.current = toggles;
  const [newLibName, setNewLibName] = useState<string | null>(null);
  const [newFpName, setNewFpName] = useState<string | null>(null);
  const [propsOpen, setPropsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  /**
   * `ShowPreferences( <page>, <heading> )`. `true` is the plain
   * `ACTIONS::openPreferences`, which names no page; a `PrefsPageId` is what
   * `COMMON_TOOLS::GridProperties` and the grid combo's Edit Grids... row ask
   * for (`common/tool/common_tools.cpp:609-634`).
   */
  const [prefsOpen, setPrefsOpen] = useState<null | true | PrefsPageId>(null);
  const common = useCommonSettings();
  const [padDialogId, setPadDialogId] = useState<string | null>(null);

  const controller = useRef<FootprintCanvasController>(null);
  /**
   * `Add Library` and `Import Footprint`, over the account's tree.
   *
   * Upstream both are `wxFileDialog`s; a footprint library lives in the project
   * or in `PATHS::GetDefaultUserFootprintsPath()` (paths.cpp:93).
   */
  const [fpOpenDlg, setFpOpenDlg] = useState<null | 'addLibrary' | 'importFootprint'>(null);
  /**
   * The tree's right-click menu: where it was opened and on what.
   * `LIB_TREE::onItemContextMenu` selects the row under the pointer first, so
   * the menu is always evaluated against the row it was opened on.
   */
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    lib: string;
    name: string;
  } | null>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // ----- library bootstrap ------------------------------------------------------
  useEffect(() => {
    // Group the open project's `.kicad_mod` files by their `.pretty` directory.
    const byDir = new Map<string, { fileName: string; text: string }[]>();
    for (const f of initialProject ?? []) {
      if (!/\.kicad_mod$/i.test(f.name)) continue;
      const norm = f.name.replace(/\\/g, '/');
      const m = /([^/]+)\.pretty\//i.exec(norm);
      const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
      const list = byDir.get(dir) ?? [];
      list.push({ fileName: basename(f.name), text: f.text });
      byDir.set(dir, list);
    }
    // Only libraries the project's fp-lib-table registers are loaded, under
    // the nickname the table gives them (FP_LIB_TABLE): a `.pretty` folder no
    // row points at is not a library, here or in KiCad.
    const libRows = projectFpLibTable(initialProject ?? []);
    for (const [dir, entries] of byDir) {
      const name = projectLibraryNickname(libRows, `${dir}/x.kicad_mod`);
      if (name) manager.current.addProjectLibrary(name, dir, entries);
    }
    // Bundled global footprint libraries (names up front, files fetched lazily).
    fetch(`${footprintsBase()}/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((idx: { name: string; footprints: string[] }[]) => {
        for (const lib of idx) manager.current.addGlobalLibrary(lib.name, lib.footprints);
        bump();
      })
      .catch(() => bump());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetLib = treeSel?.lib ?? curLib;

  /**
   * Draw options from the Appearance panel's Objects tab and its Layer Display
   * Options, the way pcbnew derives them — the controls are the same widget's,
   * so what they mean has to be the same too. Before the panel was shared this
   * frame had no Objects tab at all, and the only line here was the pad sketch
   * mode.
   */
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
      filledShapeOpacity: opacity.filledShapes,
      // Display-mode toggle: on = sketch (outline) = fill off (m_DisplayPadFill).
      padFill: !toggles.has('padDisplayMode'),
      contrastMode: contrast,
      activeLayer,
      // `FOOTPRINT_EDIT_FRAME::GetColorSettings()` is
      // `::GetColorSettings( GetSettings()->m_ColorTheme )` — this frame's own
      // `appearance.color_theme`, over the `board` namespace it shares with the
      // PCB Editor. Preferences > Footprint Editor > Colors is the page that
      // writes both halves.
      theme: pcbThemeWithOverrides(fpCfg.appearance.color_theme, userColors),
    }),
    [toggles, objects, opacity, contrast, activeLayer, fpCfg.appearance.color_theme, userColors],
  );

  // ----- load / save ------------------------------------------------------------
  const loadFootprint = useCallback(
    async (libName: string, fpName: string) => {
      setLoading('Loading footprint...');
      try {
        const fp = await manager.current.loadFootprint(libName, fpName);
        if (!fp) {
          setStatus(`Footprint ${libName}:${fpName} not found`);
          return;
        }
        setCurLib(libName);
        setCurName(fpName);
        setWorkFp(fp);
        setSelection(new Set());
        undoStack.current = [];
        redoStack.current = [];
        setStatus(`Loaded ${libName}:${fpName}`);
        bump();
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } finally {
        setLoading(null);
      }
    },
    [bump],
  );

  // Open the specific footprint the project manager launched us on, KiCad's
  // PROJECT_TREE_ITEM::Activate routing a `.kicad_mod` through editFootprints +
  // MAIL_FP_EDIT. Resolve its `.pretty` library and name, expand and select it
  // in the library tree, and load it onto the canvas. Runs after the bootstrap
  // effect has registered the project libraries (same mount, declared earlier).
  useEffect(() => {
    const file = openRequest?.file;
    if (!file) return;
    const { lib, name } = fpTargetOf(file);
    if (!manager.current.libraryExists(lib)) return;
    const names = manager.current.footprintNames(lib);
    const target = names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? names[0];
    if (!target) return;
    // `LIB_TREE::SelectLibId`, which expands the ancestors and selects — the
    // frame no longer owns an expansion set to add to.
    setSelectLibId(`${lib}:${target}`);
    setTreeSel({ lib, name: target });
    void loadFootprint(lib, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  // ----- undoable edits ---------------------------------------------------------
  /** Commit one edit: snapshot for undo, buffer to the manager, mark modified. */
  const commit = useCallback(
    (next: PcbFootprint, description: string) => {
      setWorkFp((prev) => {
        if (!prev || !curLib || !curName) return prev;
        undoStack.current.push(prev);
        redoStack.current = [];
        manager.current.updateFootprint(curLib, curName, next);
        bump();
        setStatus(description);
        return next;
      });
    },
    [curLib, curName, bump],
  );

  const undo = useCallback(() => {
    setWorkFp((cur) => {
      const prev = undoStack.current.pop();
      if (!prev || !cur || !curLib || !curName) return cur;
      redoStack.current.push(cur);
      manager.current.updateFootprint(curLib, curName, prev);
      bump();
      return prev;
    });
    setSelection(new Set());
  }, [curLib, curName, bump]);

  const redo = useCallback(() => {
    setWorkFp((cur) => {
      const next = redoStack.current.pop();
      if (!next || !cur || !curLib || !curName) return cur;
      undoStack.current.push(cur);
      manager.current.updateFootprint(curLib, curName, next);
      bump();
      return next;
    });
    setSelection(new Set());
  }, [curLib, curName, bump]);

  // Mirror the two stack depths into state after every commit / undo / redo /
  // load. `workFp` and `revision` both move on all four, and an effect runs
  // after the DOM commit, so the ref is already at its new depth here.
  useEffect(() => {
    setUndoDepth(undoStack.current.length);
    setRedoDepth(redoStack.current.length);
  }, [workFp, revision]);

  // The centre to rotate/mirror about: the selection's combined bounding box.
  const selectionCenter = useCallback((fp: PcbFootprint, sel: ReadonlySet<string>): Vec2 => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of sel) {
      const b = fpItemBBox(fp, id);
      if (!b) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (minX > maxX) return { x: 0, y: 0 };
    return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
  }, []);

  const moveSel = useCallback(
    (delta: Vec2) => {
      if (!workFp || selection.size === 0) return;
      commit(moveFootprintItems(workFp, selection, delta), 'Move');
    },
    [workFp, selection, commit],
  );

  const rotateSel = useCallback(
    (ccw: boolean) => {
      if (!workFp || selection.size === 0) return;
      commit(
        rotateFootprintItems(
          workFp,
          selection,
          ccw,
          selectionCenter(workFp, selection),
          // `frame()->GetRotationAngle()` — `editing.rotation_angle`, stored in
          // tenths of a degree.
          fpCfg.editing.rotation_angle / 10,
        ),
        ccw ? 'Rotate CCW' : 'Rotate CW',
      );
    },
    [workFp, selection, commit, selectionCenter, fpCfg.editing.rotation_angle],
  );

  const mirrorSel = useCallback(() => {
    if (!workFp || selection.size === 0) return;
    commit(mirrorFootprintItems(workFp, selection, selectionCenter(workFp, selection)), 'Mirror');
  }, [workFp, selection, commit, selectionCenter]);

  const deleteSel = useCallback(() => {
    if (!workFp || selection.size === 0) return;
    commit(deleteFootprintItems(workFp, selection), 'Delete');
    setSelection(new Set());
  }, [workFp, selection, commit]);

  const applyProps = useCallback(
    (r: { reference: string; value: string; description: string; keywords: string }) => {
      setPropsOpen(false);
      if (!workFp) return;
      let next = workFp;
      if (r.reference !== (workFp.reference ?? '')) next = setFootprintReference(next, r.reference);
      if (r.value !== (workFp.value ?? '')) next = setFootprintValue(next, r.value);
      next = setFootprintDescription(next, r.description);
      next = setFootprintKeywords(next, r.keywords);
      commit(next, 'Edit Footprint Properties');
    },
    [workFp, commit],
  );

  // The next pad number: one past the highest numeric pad (KiCad's PAD_TOOL).
  const nextPadNumber = (fp: PcbFootprint): string => {
    let max = 0;
    for (const p of fp.pads) {
      const n = parseInt(p.number, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return String(max + 1);
  };

  // Place a pad at the click (Add Pad tool). Defaults mirror KiCad's pad master:
  // a through-hole round pad, 1.524 mm / 0.762 mm drill, on all copper + mask.
  const placePadAt = useCallback(
    (pos: Vec2) => {
      if (!workFp || !curLib || !curName) return;
      const pad: PcbPad = {
        number: nextPadNumber(workFp),
        type: 'thru_hole',
        shape: 'circle',
        at: { x: Math.round(pos.x), y: Math.round(pos.y) },
        angle: 0,
        size: { x: mmToIU(1.524), y: mmToIU(1.524) },
        drill: { oblong: false, w: mmToIU(0.762), h: mmToIU(0.762) },
        layers: ['*.Cu', '*.Mask'],
        source: EMPTY_SOURCE,
      };
      commit(addPad(workFp, pad), 'Add Pad');
    },
    [workFp, curLib, curName, commit],
  );

  // Build a graphic from its two click points, on the active layer.
  const makeShape = useCallback(
    (tool: string, a: Vec2, b: Vec2): PcbShape | null => {
      // `DRAWING_TOOL`'s `m_stroke.SetWidth( bds.GetLineThickness( layer ) )`
      // — the stroke a new graphic takes is the ACTIVE LAYER's class, out of
      // Preferences > Footprint Editor > Graphics Defaults. This was
      // `mmToIU( 0.1 )`, which is the silk class's default and so looked right
      // on silk and was wrong on every other layer.
      const base = {
        width: mmToIU(fpLineThicknessMM(activeLayer, fpCfg)),
        fill: false,
        layer: activeLayer,
        source: EMPTY_SOURCE,
      };
      if (tool === 'drawLine') return { kind: 'line', start: a, end: b, ...base };
      if (tool === 'drawRectangle') return { kind: 'rect', start: a, end: b, ...base };
      if (tool === 'drawCircle') return { kind: 'circle', center: a, end: b, ...base };
      return null;
    },
    [activeLayer, fpCfg],
  );

  const DRAW_TOOLS = new Set(['drawLine', 'drawRectangle', 'drawCircle']);

  const onPlace = useCallback(
    (pos: Vec2) => {
      const p = { x: Math.round(pos.x), y: Math.round(pos.y) };
      if (activeTool === 'placePad') {
        placePadAt(p);
        return;
      }
      // `PCB_CONTROL::GridPlaceOrigin`'s picker (`pcb_control.cpp:769-800`),
      // which the footprint editor reaches through the same PCB_CONTROL.
      // A one-shot: the click handler returns false, so the tool pops.
      if (activeTool === 'gridSetOrigin') {
        setGridOrigin(p);
        setActiveTool('selectSetRect');
        return;
      }
      // `DRAWING_TOOL::PlacePoint` — `POINT_PLACER::CreateItem` sets nothing on
      // the new `PCB_POINT` but `SetLayer( GetActiveLayer() )`, so the size is
      // the constructor's 1 mm. `IPO_REPEAT | IPO_SINGLE_CLICK`: one click
      // places one point and the tool stays armed.
      if (activeTool === 'placePoint') {
        if (workFp)
          commit(
            addPoint(workFp, {
              at: p,
              size: DEFAULT_POINT_SIZE,
              layer: activeLayer,
              source: EMPTY_SOURCE,
            }),
            'Place point',
          );
        return;
      }
      // `DRAWING_TOOL::DrawBarcode` again, reached here through the footprint
      // editor's own Place menu (`menubar_footprint_editor.cpp:193`). One
      // click opens the properties dialog; nothing is added until it returns
      // OK, and the tool does not re-arm (`PopTool` after the commit).
      if (activeTool === 'placeBarcode') {
        setBarcodeDialog({ at: p });
        return;
      }
      if (DRAW_TOOLS.has(activeTool)) {
        // Two-click drawing: first click sets the anchor, second commits the shape.
        if (!drawStart) {
          setDrawStart(p);
          return;
        }
        const shape = makeShape(activeTool, drawStart, p);
        setDrawStart(null);
        if (shape && workFp)
          commit(addShape(workFp, shape), `Draw ${activeTool.replace('draw', '').toLowerCase()}`);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [activeTool, drawStart, placePadAt, makeShape, workFp, commit],
  );

  // Switching tools (or Escape) abandons an in-progress graphic.
  //
  // `toolArmed` is `TOOLS_HOLDER`'s tool stack, reduced to the one bit status
  // pane 6 needs: nothing is pushed at frame construction, so the pane stays
  // blank until the user arms something. See `footprintToolMsg`.
  const selectTool = useCallback((id: string) => {
    setActiveTool(id);
    setDrawStart(null);
    setToolArmed(true);
  }, []);

  // Double-click an item to edit it (pads open the pad-properties dialog).
  const onEditItem = useCallback(
    (id: string) => {
      const ref = parseFpItemId(id);
      if (ref?.kind === 'pad') setPadDialogId(id);
      else if (workFp) setPropsOpen(true); // graphics/text → footprint properties for now
    },
    [workFp],
  );

  const padForDialog = useMemo(() => {
    if (!padDialogId || !workFp) return null;
    const ref = parseFpItemId(padDialogId);
    return ref?.kind === 'pad' ? (workFp.pads[ref.index] ?? null) : null;
  }, [padDialogId, workFp]);

  const applyPadEdit = useCallback(
    (e: PadEdit) => {
      const id = padDialogId;
      setPadDialogId(null);
      if (!id || !workFp) return;
      const ref = parseFpItemId(id);
      const pad = ref?.kind === 'pad' ? workFp.pads[ref.index] : undefined;
      if (!pad) return;
      commit(replaceFootprintItem(workFp, id, patchPad(pad, e)), 'Edit Pad');
    },
    [padDialogId, workFp, commit],
  );

  // Click / box selection from the canvas (PCB_SELECTION_TOOL semantics).
  const onSelect = useCallback((id: string | null, additive: boolean) => {
    setSelection((prev) => {
      if (id === null) return additive ? prev : new Set();
      if (additive) {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }
      return new Set([id]);
    });
  }, []);
  const onSelectBox = useCallback((ids: string[], additive: boolean) => {
    setSelection((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
  }, []);

  const downloadText = (fileName: string, text: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveLibrary = useCallback(
    (libName: string) => {
      const files = manager.current.modifiedFiles(libName);
      if (files.length === 0) {
        setStatus('No unsaved changes');
        return;
      }
      for (const f of files) downloadText(f.fileName, f.text);
      setStatus(`Saved ${files.length} footprint${files.length === 1 ? '' : 's'} in '${libName}'`);
      bump();
    },
    [bump],
  );

  const save = useCallback(() => {
    const libName = treeSel?.lib ?? curLib;
    if (libName) saveLibrary(libName);
  }, [treeSel, curLib, saveLibrary]);

  const saveAll = useCallback(() => {
    for (const name of manager.current.libraryNames()) {
      if (manager.current.isLibraryModified(name)) saveLibrary(name);
    }
  }, [saveLibrary]);

  // ----- footprint management ---------------------------------------------------
  const createFootprint = useCallback(
    (name: string) => {
      setNewFpName(null);
      const libName = targetLib;
      if (!libName || !name.trim()) return;
      const fp = newFootprint(name.trim());
      manager.current.updateFootprint(libName, name.trim(), fp);
      setSelectLibId(`${libName}:${name.trim()}`);
      bump();
      void loadFootprint(libName, name.trim());
    },
    [targetLib, bump, loadFootprint],
  );

  const addLibraryEntries = useCallback(
    (entries: { fileName: string; text: string }[]) => {
      // `.kicad_mod` files are added as a library named for their folder.
      if (entries.length === 0) return;
      const name = 'Imported';
      manager.current.addProjectLibrary(name, `${name}.pretty`, entries);
      setSelectLibId(name);
      bump();
    },
    [bump],
  );

  const importFootprintText = useCallback(
    (fileName: string, text: string) => {
      const libName = targetLib;
      if (!libName) {
        setStatus('Select a library first');
        return;
      }
      const fp = readFootprintFile(parse(text));
      if (!fp) {
        setStatus(`No footprint in ${fileName}`);
        return;
      }
      let name = fp.lib || fpNameOf(fileName);
      while (manager.current.footprintExists(libName, name)) name = `${name}_1`;
      manager.current.updateFootprint(libName, name, { ...fp, lib: name });
      bump();
      void loadFootprint(libName, name);
    },
    [targetLib, bump, loadFootprint],
  );

  const deleteFootprint = useCallback(
    (libName: string, fpName: string) => {
      if (!window.confirm(`Delete footprint '${fpName}' from library '${libName}'?`)) return;
      manager.current.removeFootprint(libName, fpName);
      if (curLib === libName && curName === fpName) {
        setWorkFp(null);
        setCurName(null);
      }
      bump();
    },
    [curLib, curName, bump],
  );

  // ----- toolbar / toggles ------------------------------------------------------
  const onLeftToggle = useCallback((id: string) => {
    // The Show Grid button's right-click menu, not a button
    // (`pcbnew/toolbars_footprint_editor.cpp:53-62`): upstream runs its rows
    // through the same TOOL_MANAGER the button goes through, so they arrive
    // here. `COMMON_TOOLS::GridProperties` for FRAME_FOOTPRINT_EDITOR is
    // `ShowPreferences( _( "Grids" ), _( "Footprint Editor" ) )`
    // (`common/tool/common_tools.cpp:626`); that page is not in our book yet,
    // so the dialog opens without naming one.
    if (id === 'gridProperties') {
      setPrefsOpen('fp-grids');
      return;
    }
    // `FOOTPRINT_EDIT_FRAME::ToggleLibraryTree` (`:402-419`): hiding the pane
    // writes its width out first, because once it is hidden `GetSize().x` is no
    // longer the width to come back to. Outside the `setToggles` updater, which
    // runs during the render pass — see `startResize`.
    if (id === 'showLibraryTree' && togglesRef.current.has(id)) {
      settings.updateFpEdit((s) => {
        s.window.lib_width = panelWidthRef.current;
      });
    }
    // `COMMON_TOOLS::CursorControl` (`common/tool/common_tools.cpp`) does not
    // keep a toolbar state of its own: it writes
    // `GetCanvas()->GetGAL()->GetOptions().m_gridStyle`'s neighbour,
    // `m_Window.cursor.cross_hair_mode`, and the buttons' CHECK conditions read
    // it back. So this group is the settings key, and Preferences > Display
    // Options is the same three choices over the same value.
    // `PCB_BASE_FRAME::SetShowPolarCoords` writes `m_PolarCoords` on the app's
    // settings object (`footprint_editor_settings.cpp:115-116`), which is what
    // `UpdateStatusBar`'s `if( GetShowPolarCoords() )` reads back. The button
    // and pane 3 are one value.
    if (id === 'togglePolarCoords') {
      settings.updateFpEdit((s) => {
        s.editing.polar_coords = !s.editing.polar_coords;
      });
    }
    // `FOOTPRINT_EDITOR_CONTROL::OnAngleSnapModeChanged`
    // (`pcbnew/tools/footprint_editor_control.cpp:1031-1048`) maps
    // `m_AngleSnapMode` onto these three buttons, and `PCB_ACTIONS::lineMode*`
    // writes it back — so the group and Preferences > Editing Options'
    // "Constrain actions to H, V, 45 degrees" are one value.
    if (id === 'lineModeFree' || id === 'lineMode90' || id === 'lineMode45') {
      const mode = id === 'lineMode45' ? 1 : id === 'lineMode90' ? 2 : 0;
      settings.updateFpEdit((s) => {
        s.editing.fp_angle_snap_mode = mode;
      });
    }
    if (id === 'crosshairSmall' || id === 'crosshairFull' || id === 'crosshair45') {
      const mode = id === 'crosshair45' ? '45' : id === 'crosshairFull' ? 'full' : 'small';
      settings.updateFpEdit((s) => {
        s.window.cursor.crosshair = mode;
      });
    }
    setToggles((prev) => applyToggle(prev, id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showDatasheet = useCallback(() => {
    setStatus('Datasheet: not defined for this footprint');
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'newFootprint':
          setNewFpName('');
          break;
        case 'save':
          save();
          break;
        case 'undo':
          undo();
          break;
        case 'redo':
          redo();
          break;
        case 'zoomRedraw':
          controller.current?.redraw();
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
        case 'mirrorH':
        case 'mirrorV':
          mirrorSel();
          break;
        case 'footprintProperties':
          if (workFp) setPropsOpen(true);
          break;
        case 'showDatasheet':
          showDatasheet();
          break;
        default:
          break; // remaining editing actions are staged
      }
    },
    [save, undo, redo, rotateSel, mirrorSel, showDatasheet, workFp],
  );

  // ----- library tree (footprint_tree_pane / LIB_TREE) --------------------------
  const libNames = manager.current.libraryNames();
  void revision;

  /**
   * `m_frame->GetLibTreeAdapter()` — the ONE adapter this frame's tree is built
   * on (`footprint_tree_pane.cpp:37-38`). It is an
   * `FP_TREE_SYNCHRONIZING_ADAPTER`, so every row face is re-derived from the
   * frame on each paint and none of it is cached: see
   * `fp_tree_synchronizing_adapter.ts`.
   *
   * Built once, like the manager it wraps. Its three questions read refs rather
   * than state so the memo never has to be rebuilt to see a fresh answer —
   * upstream holds a `FOOTPRINT_EDIT_FRAME*` for the same reason.
   */
  const loadedFpIdRef = useRef('');
  loadedFpIdRef.current = curLib && curName ? `${curLib}:${curName}` : '';
  const contentModifiedRef = useRef(false);
  contentModifiedRef.current =
    !!curLib && !!curName && manager.current.isFootprintModified(curLib, curName);
  const treeAdapter = useMemo(() => {
    const adapter = new FpTreeSynchronizingAdapter({
      loadedFpId: () => loadedFpIdRef.current,
      isContentModified: () => contentModifiedRef.current,
      // `IsCurrentFPFromBoard()`. Always false here for the reason
      // `frame_title.ts` gives: nothing in this port can load a footprint off
      // a board yet — `loadFpFromBoard` is a disabled Tools row.
      isCurrentFpFromBoard: () => false,
    });
    // `loadColumnConfig`, which the adapter's constructor calls on the settings
    // struct it was handed (`common/lib_tree_model_adapter.cpp:184-197`). Ours
    // is `fpedit.json`'s `lib_tree` block, because `FP_TREE_MODEL_ADAPTER` is
    // built on `GetViewerSettingsBase()->m_LibTree`
    // (`pcbnew/fp_tree_model_adapter.cpp:43-44`).
    adapter.loadColumnConfig({
      columns: settings.fpEdit.lib_tree.columns,
      widths: settings.fpEdit.lib_tree.column_widths,
    });
    return adapter;
  }, []);

  /**
   * `m_cfg.open_libs = GetOpenLibs()` (`lib_tree_model_adapter.cpp:246`) and
   * `OpenLibs( … )` on the way back in (`:220-232`).
   *
   * `LIB_TREE` owns the expansion state, so the frame cannot read it back the
   * way `GetOpenLibs` walks the dataview; it hears every change through
   * `onToggleLibrary` instead and keeps the set for the settings file alone.
   */
  const openLibs = useRef<readonly string[]>(settings.fpEdit.lib_tree.open_libs);
  const openLibSet = useRef(new Set(settings.fpEdit.lib_tree.open_libs));

  /**
   * `FP_TREE_SYNCHRONIZING_ADAPTER::Sync` — rebuild the node tree when the SET
   * of libraries or footprints changed, and only then.
   *
   * Modified-ness is deliberately not in the signature: that is the adapter's
   * to answer live, and putting it here would rebuild the whole tree on every
   * keystroke of an edit.
   */
  const treeSignature = libNames
    .map(
      (n) =>
        `${n}\u0000${manager.current.isPinned(n) ? 1 : 0}\u0000${manager.current
          .footprintNames(n)
          .join('\u0001')}`,
    )
    .join('\u0002');
  const [treeNonce, setTreeNonce] = useState(0);
  useEffect(() => {
    const mgr = manager.current;
    treeAdapter.tree.children.length = 0;
    for (const libName of mgr.libraryNames()) {
      // The Description column of a LIBRARY row is the fp-lib-table row's
      // `Description()` (`fp_tree_synchronizing_adapter.cpp:265-272`), not the
      // directory name. `ManagedFpLibrary` does not carry the table's descr, so
      // the cell is empty rather than filled with something else.
      const libNode = treeAdapter.addLibrary(libName, '', mgr.isPinned(libName));
      for (const name of mgr.footprintNames(libName)) {
        const fp = mgr.getFootprint(libName, name);
        const item = new LibTreeNode();
        item.type = LibTreeNodeType.ITEM;
        item.parent = libNode;
        item.name = name;
        item.libNickname = libName;
        item.libItemName = name;
        item.desc = fp?.descr ?? '';
        // `FOOTPRINT::GetSearchTerms` (`pcbnew/footprint.cpp:1707-1725`): the
        // nickname at 4, the name at 8 and the LIB_ID at 16 — the last two
        // flagged as names, which is what an exact match is scored against —
        // then each keyword token at 4, the whole keyword string at 1 and the
        // description at 1. The last four need a file that may not be fetched
        // yet, so they appear as the library loads.
        const keywords = fp?.tags ?? '';
        item.sourceSearchTerms = [
          { text: libName.toLowerCase(), score: 4 },
          { text: name.toLowerCase(), score: 8, isName: true },
          { text: `${libName}:${name}`.toLowerCase(), score: 16, isName: true },
          ...keywords
            .split(/[ \t\r\n]+/)
            .filter(Boolean)
            .map((k) => ({ text: k.toLowerCase(), score: 4 })),
          { text: keywords.toLowerCase(), score: 1 },
          { text: (fp?.descr ?? '').toLowerCase(), score: 1 },
        ];
        item.rebuildSearchTerms(treeAdapter.getShownColumns());
        libNode.children.push(item);
      }
      treeAdapter.finishLibrary(libNode);
    }
    treeAdapter.tree.assignIntrinsicRanks();
    setTreeNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeSignature, treeAdapter]);

  /**
   * `LIB_TREE::SelectLibId`, which `FOOTPRINT_EDIT_FRAME::FocusOnLibID` and
   * `SyncLibraryTree` call to make the tree follow the frame
   * (`footprint_edit_frame.cpp:1186-1211`). One piece of state, because
   * upstream is one call either way.
   */
  const [selectLibId, setSelectLibId] = useState('');
  /**
   * `LIB_TREE::Unselect()`, which `FOOTPRINT_TREE_PANE::onComponentSelected`
   * calls right after the double-click has loaded the footprint (`:88-93`).
   */
  const [unselectNonce, setUnselectNonce] = useState(0);

  /** `EVT_LIBITEM_SELECTED` — the tree's selection, which is what
   *  `GetTargetFPID` and the four `Init` conditions read. */
  const onTreeSelect = useCallback((node: LibTreeNode | null) => {
    if (!node) {
      setTreeSel(null);
      return;
    }
    if (node.type === LibTreeNodeType.LIBRARY) setTreeSel({ lib: node.name, name: null });
    else setTreeSel({ lib: node.libNickname, name: node.libItemName });
  }, []);

  /**
   * `FOOTPRINT_TREE_PANE::onComponentSelected`, bound to `EVT_LIBITEM_CHOSEN`
   * (`footprint_tree_pane.cpp:48`):
   *
   *     m_frame->LoadFootprintFromLibrary( GetLibTree()->GetSelectedLibId() );
   *     // Make sure current-part highlighting doesn't get lost in seleciton highlighting
   *     m_tree->Unselect();
   */
  const onTreeChoose = useCallback(
    (node: LibTreeNode) => {
      if (node.type === LibTreeNodeType.LIBRARY) return;
      void loadFootprint(node.libNickname, node.libItemName);
      setUnselectNonce((n) => n + 1);
    },
    [loadFootprint],
  );

  /** Expanding a library fetches it — our lazy stand-in for upstream's
   *  preloaded `FOOTPRINT_LIBRARY_ADAPTER`. Collapsing needs nothing. */
  const onTreeToggleLibrary = useCallback(
    (node: LibTreeNode, open: boolean) => {
      if (open) openLibSet.current.add(node.name);
      else openLibSet.current.delete(node.name);
      settings.updateFpEdit((s) => {
        s.lib_tree.open_libs = [...openLibSet.current];
      });
      if (!open) return;
      void manager.current.ensureLoaded(node.name).then(bump);
    },
    [bump],
  );

  /**
   * `m_adapter->GetContextMenuTool()` returning `FOOTPRINT_EDITOR_CONTROL`
   * (`fp_tree_synchronizing_adapter.cpp:62-65`), which is why this tree gets
   * the fifteen-row menu in `tree_context_menu.ts` and not `LIB_TREE`'s
   * Pin/Unpin fallback. The widget has already selected the row.
   */
  const onTreeItemContextMenu = useCallback((node: LibTreeNode, x: number, y: number) => {
    setTreeMenu(
      node.type === LibTreeNodeType.LIBRARY
        ? { x, y, lib: node.name, name: '' }
        : { x, y, lib: node.libNickname, name: node.libItemName },
    );
  }, []);

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
      // `cfg->m_LibWidth = m_treePane->GetSize().x` — the pane has stopped
      // moving, so its width is what the next session opens at. Read off the
      // ref rather than out of a `setPanelWidth` updater: that updater runs
      // during React's render pass, and notifying the settings store from
      // there updates one component while another is rendering.
      settings.updateFpEdit((s) => {
        s.window.lib_width = panelWidthRef.current;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  const toggleLayer = (name: string): void => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  /**
   * The menu tree, mirrored for the key chain below - `menus` is built further
   * down, and the chain has to dispatch off the live one. Same reason
   * `useMenuHotkeys` holds a ref rather than a dependency.
   */
  const menusRef = useRef<Menu[]>([]);

  // ----- keyboard ---------------------------------------------------------------
  // One chain, in ACTION_MANAGER::RunHotKey order: the context actions this
  // canvas owns, then the menus. See ui/menu_hotkeys.ts for why there is not a
  // second listener beside this one.
  useEffect(() => {
    const dialogOpen =
      newLibName !== null || newFpName !== null || propsOpen || padDialogId !== null;
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'footprints') !== 'footprints') return;
      // The library tree already claimed it (TreeSelActions).
      // `defaultPrevented` means someone already acted on this key - EXCEPT
      // when it was our own browser suppressor, which runs in the capture phase
      // and cancels every combo the app claims purely to stop the browser.
      // Reading that as "handled" is what made every hotkey in the app stop
      // working once the dispatcher landed (c4a00590).
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      if (dialogOpen) {
        if (e.key === 'Escape') {
          setNewLibName(null);
          setNewFpName(null);
        }
        return;
      }
      // tool_dispatcher.cpp:654-670 - an editable entry takes every key, a
      // read-only one keeps Ctrl+C. dispatchMenuHotkey re-applies this for the
      // menus; here it gates the context branches.
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      // A canvas tool key is MD_NONE upstream, so a modified press is a
      // different action and must fall through to the menus.
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;

      // --- context: what the live tool / selection owns -----------------------
      if (e.key === 'Escape') {
        // ACTIONS::cancelInteractive, scoped to whatever is running: back out
        // of the drawing, then the tool, then the selection.
        if (drawStart) setDrawStart(null);
        else if (activeTool !== 'selectSetRect') selectTool('selectSetRect');
        else setSelection(new Set());
        return;
      }
      if (plain && (e.key === 'r' || e.key === 'R')) {
        // PCB_ACTIONS::rotateCcw (R) / rotateCw (Shift+R). Neither has a row in
        // this frame's Edit menu, so both stay here.
        e.preventDefault();
        rotateSel(!e.shiftKey);
        return;
      }

      // --- global: the menu accelerators --------------------------------------
      if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotateSel, selectTool, activeTool, drawStart, newLibName, newFpName, propsOpen, padDialogId]);

  /**
   * `FOOTPRINT_EDIT_FRAME::IsContentModified()`
   * (`footprint_edit_frame.cpp:368-372`): the screen's dirty bit **and** a
   * footprint on the board. It gates Revert and the title's `*`.
   */
  const modified = curLib && curName ? manager.current.isFootprintModified(curLib, curName) : false;

  /**
   * `FOOTPRINT_EDIT_FRAME::RevertFootprint()`
   * (`footprint_libraries_utils.cpp:1191-1218`): confirm, put the as-loaded
   * copy back on the board, zoom-fit, and clear both the undo/redo lists and
   * the modified flag.
   */
  const revert = useCallback(() => {
    if (!curLib || !curName || !modified) return;
    // `ConfirmRevertDialog` — the message and its grey sub-line both come from
    // `ui/confirm.ts`, the one place `common/confirm.cpp` is transcribed.
    if (!window.confirm(`${confirmRevertMessage(curName)}\n\n${CONFIRM_REVERT_EXTENDED}`)) return;
    const orig = manager.current.revertFootprint(curLib, curName);
    setWorkFp(orig ?? null);
    setSelection(new Set());
    undoStack.current = [];
    redoStack.current = [];
    bump();
    requestAnimationFrame(() => controller.current?.zoomToFit());
  }, [curLib, curName, modified, bump]);

  // ----- menus (menubar_footprint_editor.cpp) -----------------------------------
  //
  // The tree lives in `menubar.ts`. A menu built inside a `.tsx` cannot be
  // reached by any test - `qa`'s tsconfig compiles `.ts` only - so nothing
  // could have caught a missing row. What stays here is the frame's half: the
  // three handlers and the ENABLE() conditions.
  const onMenuAction = useCallback(
    (id: string) => {
      switch (id) {
        // `COMMON_TOOLS::GridResetOrigin` — `SetGridOrigin( VECTOR2I( 0, 0 ) )`
        // and a refresh. Not a picker, so it is a plain menu action.
        case 'gridResetOrigin':
          setGridOrigin({ x: 0, y: 0 });
          break;
        case 'newLibrary':
          setNewLibName('');
          break;
        case 'addLibrary':
          setFpOpenDlg('addLibrary');
          break;
        case 'newFootprint':
          setNewFpName('');
          break;
        case 'save':
          save();
          break;
        case 'revert':
          revert();
          break;
        case 'saveAll':
          saveAll();
          break;
        case 'importFootprint':
          setFpOpenDlg('importFootprint');
          break;
        case 'exportFootprint': {
          const l = treeSel?.lib ?? curLib,
            n = treeSel?.name ?? curName;
          if (l && n) {
            const t = manager.current.saveFootprintText(l, n);
            if (t) downloadText(`${n}.kicad_mod`, t);
          }
          break;
        }
        case 'footprintProperties':
          if (workFp) setPropsOpen(true);
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
          deleteSel();
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
        // ACTIONS::openPreferences. The shared dialog every launcher opens.
        case 'openPreferences':
          setPrefsOpen(true);
          break;
      }
    },
    [
      save,
      saveAll,
      revert,
      undo,
      redo,
      deleteSel,
      onExitToHome,
      treeSel,
      curLib,
      curName,
      workFp,
      showDatasheet,
    ],
  );

  /**
   * The tree menu's dispatch. Most ids are the menu bar's own — upstream they
   * are literally the same `TOOL_ACTION` objects appearing in two menus — so
   * they route to `onMenuAction`; only the four the tree owns are handled here.
   */
  const onTreeMenuAction = useCallback(
    (id: string) => {
      const target = treeMenu;
      setTreeMenu(null);
      if (!target) return;
      switch (id) {
        // `LIBRARY_EDITOR_CONTROL::changeSelectedPinStatus`
        // (`common/tool/library_editor_control.cpp:99-130`).
        case 'pinLibrary':
        case 'unpinLibrary':
          manager.current.setPinned(target.lib, id === 'pinLibrary');
          bump();
          break;
        // `PCB_ACTIONS::deleteFootprint` — the tree's row, which acts on the
        // tree selection and not on the canvas.
        case 'deleteFootprint':
          if (target.name) deleteFootprint(target.lib, target.name);
          break;
        // `ACTIONS::hideLibraryTree` — the same toggle the View > Panels row
        // and the left toolbar button flip.
        case 'hideLibraryTree':
          onLeftToggle('showLibraryTree');
          break;
        default:
          onMenuAction(id);
          break;
      }
    },
    [treeMenu, bump, deleteFootprint, onLeftToggle, onMenuAction],
  );

  const menus: Menu[] = useMemo(
    () =>
      footprintEditorMenus(
        {
          action: onMenuAction,
          tool: selectTool,
          toggle: onLeftToggle,
          // Preferences > Set Language. COMMON_SETTINGS is shared by every
          // frame, so it is read and written through the common store.
          language: common.system.language,
          onSelectLanguage: (label: string) =>
            settings.updateCommon((c) => {
              c.system.language = label;
            }),
          showHotkeys: showHotkeyList,
          showAbout: () => setAboutOpen(true),
        },
        {
          showLibraryTree: toggles.has('showLibraryTree'),
          showLayersManager: toggles.has('showLayersManager'),
          showProperties: toggles.has('showProperties'),
          padDisplayMode: toggles.has('padDisplayMode'),
          graphicsOutlines: toggles.has('graphicsOutlines'),
          textOutlines: toggles.has('textOutlines'),
          highContrast: toggles.has('highContrast'),
        },
        {
          haveFootprint: !!workFp,
          targetLib: !!targetLib,
          targetFootprint: !!(curName || treeSel?.name),
          footprintSelectedInTree: !!treeSel?.name,
          // `IsContentModified()` is the LOADED footprint's dirty bit
          // (`footprint_edit_frame.cpp:368-372`), not the whole workspace's.
          contentModified: modified,
          // `board && !board->IsEmpty()` — our board is `footprintToBoard`, so
          // it is non-empty exactly when a footprint is loaded.
          hasItems: !!workFp,
          undoAvailable: undoDepth > 0,
          redoAvailable: redoDepth > 0,
        },
      ),
    [
      onMenuAction,
      selectTool,
      onLeftToggle,
      toggles,
      workFp,
      targetLib,
      curName,
      treeSel,
      modified,
      undoDepth,
      redoDepth,
      common.system.language,
    ],
  );

  // The chain above reads the tree through this ref; see `menusRef`.
  menusRef.current = menus;

  // ----- title (FOOTPRINT_EDIT_FRAME::UpdateTitle) -------------------------------
  //
  // Built by the shared rule rather than restated here - see `frame_title.ts`
  // for the C++ and for the four branches this frame decides for itself. What
  // used to be here got the document right and everything around it wrong: no
  // `*`, an ASCII hyphen for the em dash, and "No footprint" where KiCad says
  // `[no footprint loaded]`.
  const fpTitle = useMemo(
    () =>
      fpFrameTitle({
        // `IsCurrentFPFromBoard()`. Always false today: nothing here can load a
        // footprint off a board yet - `loadFpFromBoard` is the disabled Tools
        // row - so branch 1 is unreachable. Ported and tested anyway, so the
        // title is already right on the day that action lands.
        fromBoard: false,
        // `GetLoadedFPID().IsValid()` - the branch GUARD, which upstream reads
        // off the LOADED id while printing the LIVE one.
        loadedFpidValid: Boolean(curLib && curName),
        // `footprint->GetFPID().Format()` - the live id, so a rename shows
        // through before it is saved.
        fpid: workFp && curLib && curName ? `${curLib}:${curName}` : '',
        // `IsFootprintLibWritable( … )`. Undefined means writable, matching
        // upstream's `bool writable = true` seed; `FootprintLibraryManager` has
        // no writability notion yet, so `[Read Only]` cannot appear.
        writable: undefined,
        // `IsContentModified()`.
        modified,
      }),
    [workFp, curLib, curName, modified],
  );

  useDocumentTitle('footprints', formatTitle(FP_FRAME_NAME, fpTitle.document, modified));

  // Library edits are buffered and only written by Save, so closing the tab
  // discards them. `hasModifications()` answers across every open library
  // rather than just the footprint on screen — losing an edit to a library you
  // are not looking at is the easier mistake to make.
  useUnsavedGuard(manager.current.hasModifications());

  // ----- unit display -----------------------------------------------------------
  // FOOTPRINT_EDIT_FRAME is a PCB_BASE_EDIT_FRAME, so MessageTextFromValue takes
  // its long form off pcbIUScale — mm %.4f, mils %.2f, inches %.4f — and the
  // value has to be converted at that scale too. It went through the SCHEMATIC
  // iuToMM, which is a hundred times coarser, so every coordinate, delta and
  // grid figure in the status bar read 100x too large.
  const fmt = (iu: number): string => messageTextFromValue(pcbIuToMM(iu), unitLabel, PCB_IU_PER_MM);

  /**
   * The Appearance panel's rows, `APPEARANCE_CONTROLS::rebuildLayers`
   * (`appearance_controls.cpp:1859-1893`): the copper stack front-to-back, then
   * `non_cu_seq`. Shared with the PCB editor — see `widgets/appearance_layers.ts`
   * for what this used to be instead.
   */
  const layerRows = useMemo(() => appearanceLayerRows(FOOTPRINT_COPPER_STACK, allFpLayers), []);

  /**
   * Which preset the combo shows — `syncLayerPresetSelection`, derived from the
   * view rather than stored, exactly as in pcbnew. The two frames run the same
   * function; only the layer set it compares against differs.
   */
  const preset = useMemo(
    () =>
      matchPresetName({
        visibleLayers: visible,
        objectsAtDefault: OBJECT_ROWS.every(
          (r) => r === 'sep' || objects[r.key] === DEFAULT_OBJECTS[r.key],
        ),
        flipBoard,
        allLayers: allFpLayers,
        copperLayers: FOOTPRINT_COPPER_STACK,
      }),
    [visible, objects, flipBoard],
  );

  /** `doApplyLayerPreset` — the layers, the flip and the preset's active layer. */
  const applyPreset = useCallback((name: string): void => {
    const p = BUILTIN_PRESETS.find((x) => x.name === name);
    if (!p) return;
    setVisible(
      new Set(
        p
          .layers([...allFpLayers], [...FOOTPRINT_COPPER_STACK])
          .filter((l) => allFpLayers.includes(l)),
      ),
    );
    setFlipBoard(p.flipBoard);
    if (p.activeLayer && allFpLayers.includes(p.activeLayer)) setActiveLayer(p.activeLayer);
  }, []);

  /**
   * `board->GetLayerName( layer )` (:1876, and :1902's fp-editor branch, which
   * falls back to `GetStandardLayerName`). Every place a layer is put in front
   * of the user goes through it: the Appearance rows, the layer selector and
   * the status bar all said `F.SilkS`, `Dwgs.User`, `F.CrtYd` where KiCad says
   * `F.Silkscreen`, `User.Drawings`, `F.Courtyard`.
   */
  const layerName = useCallback((name: string): string => GetLayerName(fpLayers, name), [fpLayers]);

  /**
   * FOOTPRINT::GetMsgPanelInfo's FRAME_FOOTPRINT_EDITOR branch
   * (pcbnew/footprint.cpp:2140-2157): reference/value, Library, Footprint
   * Name, Pads, then the Doc/Keywords pair.
   */
  const fpMsgPanelItems = useMemo((): MsgPanelItem[] => {
    if (!workFp) return [];
    return [
      { upper: workFp.reference ?? '', lower: workFp.value ?? '' },
      { upper: 'Library', lower: curLib ?? '' },
      { upper: 'Footprint Name', lower: curName ?? '' },
      { upper: 'Pads', lower: String(workFp.pads.length) },
      {
        upper: `Doc: ${footprintStringChild(workFp, 'descr')}`,
        lower: `Keywords: ${footprintStringChild(workFp, 'tags')}`,
      },
    ];
  }, [workFp, curLib, curName]);

  return (
    <div className="ze-app">
      {/* `Add Library` and `Import Footprint`, over the account's tree. Both
          were a hidden `<input type="file">`, i.e. the operating system's
          picker, which cannot see the account at all. */}
      {fpOpenDlg && (
        <OpenFileDialog
          title={fpOpenDlg === 'addLibrary' ? 'Add Library' : 'Import Footprint'}
          accept={fpOpenDlg === 'addLibrary' ? 'Add' : 'Import'}
          // A footprint library lives in the project or in
          // `PATHS::GetDefaultUserFootprintsPath()` (paths.cpp:93).
          kind="footprints"
          filters={[kicadFootprintLibWildcard()]}
          onDone={(file) => {
            const which = fpOpenDlg;
            setFpOpenDlg(null);
            if (!file) return; // wxID_CANCEL
            const leaf = file.path.split('/').filter(Boolean).pop() ?? file.path;
            if (which === 'addLibrary') addLibraryEntries([{ fileName: leaf, text: file.text }]);
            else importFootprintText(leaf, file.text);
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
              {fpTitle.modified}
              {fpTitle.document}
            </b>
            {fpTitle.separator}
            {fpTitle.frameName}
          </>
        }
      />

      {/* Top toolbar + grid / zoom / layer selector combos (toolbars_footprint_editor.cpp). */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Toolbar entries={fpTopBar} orientation="horizontal" onActivate={onTopAction} />
        <span style={{ width: 8 }} />
        {/* `EDA_DRAW_FRAME::UpdateGridSelectBox` (`common/eda_draw_frame.cpp:
            200-225`): one row per `GRID_SETTINGS::grids` entry labelled by
            `GRID_MENU::BuildChoiceList`, then a "---" rule and Edit Grids....
            The app's own combo, never a native <select> — a wxChoice is
            owner-drawn and takes the GTK theme. */}
        <Combo
          title="Grid"
          value={String(gridIdx)}
          options={[
            ...fpCfg.window.grid.sizes.map((g, i) => ({
              value: String(i),
              label: gridChoiceLabel(g, unitLabel, PCB_IU_PER_MM, g.name),
            })),
            { value: GRID_LIST_SEPARATOR, label: GRID_LIST_SEPARATOR, disabled: true },
            { value: EDIT_GRIDS_LABEL, label: EDIT_GRIDS_LABEL },
          ]}
          onChange={(v) => {
            if (v === GRID_LIST_SEPARATOR) return;
            // `COMMON_TOOLS::GridProperties` is `ShowPreferences( _( "Grids" ),
            // _( "Footprint Editor" ) )` and a return
            // (`common/tool/common_tools.cpp:626`), so the row opens the page
            // rather than doing grid editing of its own.
            if (v === EDIT_GRIDS_LABEL) {
              setPrefsOpen('fp-grids');
              return;
            }
            setGridIdx(Number(v));
          }}
        />
        <select className="ze-select" disabled title="Zoom" style={{ margin: '0 4px' }}>
          <option>Zoom Auto</option>
        </select>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '0 8px' }}>
          <span
            style={{
              width: 12,
              height: 12,
              background: layerColor(activeLayer),
              borderRadius: 2,
              border: '1px solid #444',
            }}
          />
          <select
            className="ze-select"
            value={activeLayer}
            onChange={(e) => setActiveLayer(e.target.value)}
            title="Active layer (+/- to switch)"
          >
            {layerRows.map((l) => (
              <option key={l} value={l}>
                {layerName(l)}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="ze-body">
        {toggles.has('showLibraryTree') && (
          <>
            <div className="ze-leftdock" style={{ width: panelWidth, minWidth: panelWidth }}>
              <div className="ze-panel grow">
                <div className="ze-panel-header">Libraries</div>
                {/*
                 * `FOOTPRINT_TREE_PANE` (`pcbnew/footprint_tree_pane.cpp:30-52`)
                 * is a panel whose entire body is ONE `LIB_TREE`:
                 *
                 *     m_tree = new LIB_TREE( this, wxT( "footprints" ),
                 *                            m_frame->GetLibTreeAdapter(),
                 *                            LIB_TREE::SEARCH );
                 *
                 * SEARCH alone — no `MULTISELECT` and no `DETAILS`, hence
                 * `hasExternalDetails`, which keeps the HTML info pane the
                 * chooser has out of this dock.
                 *
                 * What stood here was a third tree: a `treeRows` memo and about
                 * a hundred lines of JSX. That is why this pane had no "Item"
                 * header, a bare `<input>` instead of the `wxSearchCtrl` with
                 * its magnifier and its recent-search menu, no sort/expand
                 * menu, a library glyph KiCad does not draw, no Description
                 * column, no virtual scrolling and none of the row faces — and
                 * why every fix made in `widgets/lib_tree.tsx` reached the
                 * chooser and not this pane.
                 */}
                {libNames.length === 0 && (
                  <LibraryLoadingPanel
                    kind="footprints"
                    fallback={<div className="ze-muted">No footprint libraries loaded.</div>}
                    label="Loading footprint libraries..."
                  />
                )}
                <LibTree
                  adapter={treeAdapter}
                  // `LIB_TREE( this, wxT( "footprints" ), … )` — the recent
                  // searches key upstream gives this tree, which is the one
                  // CvPcb's footprint tree shares and NOT the symbols' list.
                  recentSearchesKey="footprints"
                  regenerateNonce={treeNonce}
                  selectLibId={selectLibId}
                  unselectNonce={unselectNonce}
                  onSelect={onTreeSelect}
                  onChoose={onTreeChoose}
                  onToggleLibrary={onTreeToggleLibrary}
                  onItemContextMenu={onTreeItemContextMenu}
                  openLibs={openLibs.current}
                  onColumnWidthsChanged={(widths) =>
                    settings.updateFpEdit((s) => {
                      s.lib_tree.column_widths = widths;
                    })
                  }
                  onShownColumnsChanged={(columns) =>
                    settings.updateFpEdit((s) => {
                      s.lib_tree.columns = [...columns];
                    })
                  }
                  hasExternalDetails
                />
              </div>
            </div>
            <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />
          </>
        )}

        <Toolbar
          entries={fpLeftBar}
          app="footprint_editor"
          orientation="vertical"
          side="left"
          toggled={toggles}
          disabledIds={FP_LEFT_DISABLED}
          onActivate={onLeftToggle}
        />

        <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
          <FootprintCanvas
            ref={controller}
            footprint={workFp}
            visible={visible}
            drawOpts={drawOpts}
            selection={selection}
            activeTool={activeTool}
            gridOrigin={gridOrigin}
            showGrid={objects.grid && toggles.has('toggleGrid')}
            // `PCB_GRID_HELPER::GetGrid`, i.e. the current grid unless an
            // override applies to what the active tool lays down.
            gridIU={toolGridIU}
            // `PANEL_GAL_OPTIONS`, out of this frame's own settings object.
            gridStyle={fpCfg.window.grid.style}
            gridLineWidthPx={fpCfg.window.grid.line_width}
            gridMinSpacingPx={fpCfg.window.grid.min_spacing}
            // `window.cursor.cross_hair_mode`, which is one setting with two
            // controls over it: `PANEL_GAL_OPTIONS`' Cursor group and the left
            // toolbar's `ACTIONS::cursorSmallCrosshairs` group, which
            // `COMMON_TOOLS::CursorControl` writes into the same key. Reading
            // the toolbar's own toggle set here instead is what would let the
            // two disagree.
            crosshairMode={fpCfg.window.cursor.crosshair}
            alwaysShowCursor={fpCfg.window.cursor.always_show_cursor}
            snapping={footprintSnappingEnabled(fpCfg)}
            // `updateEnabledLayers()` — the user layers Preferences asked for.
            layers={fpLayers}
            // `RULER_ITEM` is built with `frame()->GetUserUnits()`, so the
            // Units radio group drives its graduations and its readout. The
            // footprint VIEWER passed this and the editor did not, so the same
            // canvas measured in mm here whatever the toolbar said.
            measureUnits={unitLabel}
            onCursorMove={statusReadout.setCursor}
            onScaleChange={setScale}
            onSelect={onSelect}
            onSelectBox={onSelectBox}
            onMoveItems={moveSel}
            onPlace={onPlace}
            onEditItem={onEditItem}
            preview={drawStart ? { tool: activeTool, start: drawStart } : null}
          />
          {!workFp && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                color: '#888',
                fontSize: 14,
              }}
            >
              Double-click a footprint in the library tree to view it, or File &gt; New Footprint...
            </div>
          )}
        </div>

        {/* RightToolbar is `.Right().Layer( 2 )`; LayersManager and Selection
            Filter are `.Right().Layer( 3 )` (footprint_edit_frame.cpp:238-252).
            A higher wxAUI layer docks further from the centre, so the toolbar
            touches the canvas and the palettes sit outside it. */}
        <Toolbar
          entries={fpRightBar}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={selectTool}
        />

        {/* LayersManager and SelectionFilter are both `.Right().Layer( 3 )`,
            outside the `.Layer( 2 )` right toolbar
            (footprint_edit_frame.cpp:243-254) — the same dock pcbnew builds, so
            the same `.ze-rightdock` construct rather than the left dock flipped
            over. `MinSize( FromDIP( 180 ), … )` on both panes. */}
        {toggles.has('showLayersManager') && (
          <div className="ze-rightdock" style={{ width: LAYERS_MANAGER_WIDTH }}>
            <div className="ze-panel grow">
              <div className="ze-panel-header">Appearance</div>
              {/* `new APPEARANCE_CONTROLS( this, GetCanvas(), true )`
                  (footprint_edit_frame.cpp:178). `fpEditor` removes the Nets
                  page and trims the Objects rows to `s_allowedInFpEditor`;
                  everything else is the identical widget pcbnew docks. */}
              <AppearanceControls
                fpEditor
                tab={tab}
                onTab={setTab}
                layerRows={layerRows}
                layerName={layerName}
                layerColor={layerColor}
                activeLayer={activeLayer}
                onActiveLayer={setActiveLayer}
                visibleLayers={visible}
                onToggleLayer={toggleLayer}
                objects={objects}
                onToggleObject={(key) => setObjects((p) => toggleObject(p, key))}
                objectColor={(key) => PCB_OBJECT_COLORS[key]}
                opacity={opacity}
                onOpacity={(key, value) => setOpacity((p) => ({ ...p, [key]: value }))}
                contrast={contrast}
                onContrast={setContrast}
                flipBoard={flipBoard}
                onFlipBoard={() => setFlipBoard((f) => !f)}
                layerOptionsOpen={layerOptsOpen}
                onLayerOptionsOpen={setLayerOptsOpen}
                presetItems={PRESET_ITEMS}
                preset={preset}
                onPreset={applyPreset}
                deletePresetDisabled
                viewportItems={VIEWPORT_ITEMS}
                viewport={viewportSel}
                onViewport={setViewportSel}
                deleteViewportDisabled
              />
            </div>

            {/* `m_auimgr.GetPane( "SelectionFilter" ).dock_proportion = 0`
                (footprint_edit_frame.cpp:267) — a fixed-height pane. */}
            <div className="ze-panel fixed">
              <div className="ze-panel-header">Selection Filter</div>
              <div className="ze-panel-body">
                <SelectionFilterPanel
                  filter={selFilter}
                  onChange={setSelFilter}
                  onContextMenu={(x, y, item) => setFilterMenu({ x, y, item })}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* pcbnew-style status bar. */}
      <MsgPanel items={fpMsgPanelItems} testId="fp-message-panel" />

      {/* FOOTPRINT_EDIT_FRAME is a PCB_BASE_EDIT_FRAME, so it gets
          EDA_DRAW_FRAME's eight panes unchanged
          (pcbnew/pcb_base_frame.cpp:761). */}
      <KiStatusBar
        testIds={{ message: 'fp-status-msg', coords: 'fp-coords', tool: 'fp-tool-msg' }}
        fields={{
          message: status,
          // `scale` is device px per *our* IU, so the zoom factor is derived
          // against the scale our geometry is held at, not pcbnew's.
          zoom: zoomMsg(zoomFactorForScale(scale, dpr, SCH_IU_PER_MM)),
          coords: <span ref={statusReadout.coordsRef} />,
          deltas: <span ref={statusReadout.deltasRef} />,
          // `EDA_DRAW_FRAME::DisplayGridMsg` prints the CURRENT grid, not the
          // override the active tool is on (`common/eda_draw_frame.cpp`).
          grid: gridMsg(fmt(footprintGridIU(fpCfg))),
          units: unitsMsg(unitLabel),
          // Pane 6 is `DisplayToolMsg` and pane 7 `DisplayConstraintsMsg`
          // (`eda_draw_frame.cpp:729-744`). Ours put the active layer in pane 6
          // — a string upstream never writes to the status bar at all — and
          // left pane 7 empty, where real pcbnew opens on "Constrain to H, V,
          // 45" because `DRAWING_TOOL::Reset` fills it.
          tool: footprintToolMsg(activeTool, toolArmed),
          // `DRAWING_TOOL::UpdateStatusBar` switches on `m_AngleSnapMode`
          // (`pcbnew/tools/drawing_tool.cpp:340-357`), the settings field — not
          // on a toolbar's own state, which is what reading `toggles` here was.
          constraint: constraintsMsg(
            fpCfg.editing.fp_angle_snap_mode === 1
              ? 'deg45'
              : fpCfg.editing.fp_angle_snap_mode === 2
                ? 'deg90'
                : 'direct',
          ),
        }}
      />

      {/* PANEL_SELECTION_FILTER::onRightClick's one-item wxMenu. */}
      {filterMenu && (
        <SelectionFilterOnlyMenu
          at={filterMenu}
          onOnly={(key) => setSelFilter(new Set([key]))}
          onClose={() => setFilterMenu(null)}
        />
      )}

      {/* New Library dialog. */}
      {newLibName !== null && (
        <SimplePrompt
          title="New Library"
          label="Name"
          placeholder="MyFootprints"
          value={newLibName}
          onChange={setNewLibName}
          onCancel={() => setNewLibName(null)}
          onOk={() => {
            const n = newLibName.trim();
            if (n) {
              manager.current.createLibrary(n);
              setSelectLibId(n);
              setTreeSel({ lib: n, name: null });
              setNewLibName(null);
              bump();
            }
          }}
        />
      )}
      {/* New Footprint dialog. */}
      {newFpName !== null && (
        <SimplePrompt
          title="New Footprint"
          label="Name"
          placeholder="MyFootprint"
          value={newFpName}
          onChange={setNewFpName}
          onCancel={() => setNewFpName(null)}
          onOk={() => createFootprint(newFpName)}
        />
      )}

      {aboutOpen && (
        <AboutDialog title={ABOUT_TITLES.footprint} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen && (
        <PreferencesDialog
          onClose={() => setPrefsOpen(null)}
          {...(prefsOpen === true ? {} : { initialPage: prefsOpen })}
          // `if( GetFrameType() == FRAME_FOOTPRINT_EDITOR ) expand.push_back( … )`
          // (`common/eda_base_frame.cpp:1663-1664`) — the section the tree opens
          // expanded is the one the window was opened FROM.
          frameOwner="footprint"
        />
      )}
      {propsOpen && workFp && (
        <FootprintPropertiesDialog
          footprint={workFp}
          onOk={applyProps}
          onCancel={() => setPropsOpen(false)}
        />
      )}
      {padForDialog && (
        <PadPropertiesDialog
          pad={padForDialog}
          onOk={applyPadEdit}
          onCancel={() => setPadDialogId(null)}
        />
      )}

      {treeMenu && (
        <ContextMenu
          x={treeMenu.x}
          y={treeMenu.y}
          items={footprintTreeContextMenu(
            { action: onTreeMenuAction },
            {
              library: treeMenu.lib,
              footprint: treeMenu.name,
              pinned: manager.current.isPinned(treeMenu.lib),
            },
            { haveFootprint: !!workFp },
          )}
          onClose={() => setTreeMenu(null)}
        />
      )}

      {/* Barcode properties: `DRAWING_TOOL::DrawBarcode` opens it before
          placing, and the footprint editor reaches the same tool through its
          own Place menu. */}
      {barcodeDialog &&
        (() => {
          const bc: PcbBarcode =
            barcodeDialog.index !== undefined
              ? (workFp?.barcodes[barcodeDialog.index] ?? NEW_FP_BARCODE)
              : {
                  ...NEW_FP_BARCODE,
                  at: barcodeDialog.at,
                  layer: activeLayer,
                };
          return (
            <DialogBarcodeProperties
              barcode={bc}
              initial={barcodeValues(bc)}
              layers={allFpLayers}
              layerColor={layerColor}
              background={PCB_BACKGROUND}
              onClose={() => setBarcodeDialog(null)}
              onApply={(v) => {
                const dlg = barcodeDialog;
                setBarcodeDialog(null);
                if (!workFp || !dlg) return;
                const next = applyBarcodeValues(bc, v);
                commit(
                  dlg.index !== undefined
                    ? setBarcode(workFp, dlg.index, next)
                    : addBarcode(workFp, next),
                  'Draw Barcode',
                );
                // `PopTool` — unlike Place Point, the barcode tool does not
                // re-arm (`drawing_tool.cpp` runs one dialog per activation).
                setActiveTool('selectSetRect');
              }}
            />
          );
        })()}

      <TreeSelActions
        treeSel={treeSel}
        onDelete={deleteFootprint}
        canvasSelection={selection.size > 0}
      />
      <LoadingOverlay label={loading} />
    </div>
  );
}

/** A tiny name-prompt modal (New Library / New Footprint). */
function SimplePrompt({
  title,
  label,
  placeholder,
  value,
  onChange,
  onOk,
  onCancel,
}: {
  title: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onOk: () => void;
  onCancel: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {title}
          <span className="x" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div className="ze-label-dialog-body">
          <div className="row">
            <span>{label}</span>
            <input
              className="ze-search"
              autoFocus
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onOk();
              }}
            />
          </div>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" disabled={!value.trim()} onClick={onOk}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

/** Del on the library-tree selection (context-menu subset). */
function TreeSelActions({
  treeSel,
  onDelete,
  canvasSelection,
}: {
  treeSel: { lib: string; name: string | null } | null;
  onDelete: (lib: string, name: string) => void;
  /** Whether the canvas has a selection, which owns Del while it does. */
  canvasSelection: boolean;
}): JSX.Element | null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'footprints') !== 'footprints') return;
      if (!treeSel?.name) return;
      // A context action, and the canvas holds the same key: Edit > Delete is
      // ACTIONS::doDelete on the selection. The two are kept disjoint rather
      // than ordered, because two window listeners have no stable order - this
      // one declines while the canvas has a selection, and `deleteSel` is a
      // no-op without one, so exactly one of them can ever do anything.
      // (Edit > Delete itself is `ENABLE( cond.HasItems() )` upstream, i.e.
      // live whenever a footprint is loaded, so its greying is no longer what
      // keeps the two apart.)
      // (`PCB_ACTIONS::deleteFootprint` declares no hotkey upstream at all;
      // pcb_actions.cpp:903-907. This key is ours.)
      if (canvasSelection) return;
      if (focusBlocksHotkey(e.target as FocusLike | null, e)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(treeSel.lib, treeSel.name);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [treeSel, onDelete, canvasSelection]);
  return null;
}
