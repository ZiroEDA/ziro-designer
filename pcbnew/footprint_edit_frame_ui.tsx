// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor's window: the chrome FOOTPRINT_EDIT_FRAME's
 * constructor builds (`pcbnew/footprint_edit_frame.cpp`) — menu bar
 * (`menubar_footprint_editor.cpp`), the three toolbars, the Footprints pane
 * (`footprint_tree_pane.cpp`), the GAL canvas, the Appearance and Selection
 * Filter panes, the message panel and the status bar — around the frame
 * itself, which holds the footprint, the tools, the undo list and the
 * library round trip.
 *
 * The window draws; the frame decides. A menu row or a toolbar button runs
 * its TOOL_ACTION on the frame's TOOL_MANAGER, the canvas's mouse and keys go
 * to the frame's TOOL_DISPATCHER, the frame writes the status bar and the
 * message panel through its sinks, and each dialog it asks for is drawn here.
 *
 * What it reaches into `designer/` for arrives as {@link FOOTPRINT_EDIT_FRAME_APP};
 * `designer/src/editors/footprint/footprint_edit_frame_app.tsx` answers it.
 */

import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import type { UnsavedChangesResult } from '@ziroeda/common/confirm.js';
import { CONFIRM_REVERT_EXTENDED } from '@ziroeda/common/confirm.js';
import { UnsavedChangesDialog } from '@ziroeda/common/dialogs/dialog_unsaved_changes.js';
import { EdaListDialog } from '@ziroeda/common/dialogs/eda_list_dialog.js';
import type { LIB_TREE } from '@ziroeda/common/eda_draw_frame.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import type { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { projectFpLibTable, projectLibraryNickname } from '@ziroeda/common/fp_lib_table.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { showHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import { useKiDialog } from '@ziroeda/common/kidialog.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import { GAL_LAYER_ID, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { GetLayerName } from '@ziroeda/common/layer_ids.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import {
  EDIT_GRIDS_LABEL,
  GRID_LIST_SEPARATOR,
  gridChoiceLabel,
} from '@ziroeda/common/settings/grid_settings_ui.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { ContextMenu, type Menu, MenuBar } from '@ziroeda/common/tool/action_menu_bar.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '@ziroeda/common/tool/action_menu_hotkeys.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import {
  LibrariesToRepin,
  type RENAME_DIALOG,
  SetRenameDialogPresenter,
} from '@ziroeda/common/tool/library_editor_control.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import type { ToolbarDefaults, ToolbarLoc } from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import { formatTitle, useDocumentTitle } from '@ziroeda/common/use_document_title.js';
import { useUnsavedGuard } from '@ziroeda/common/use_unsaved_guard.js';
import { type FocusLike, wasBrowserSuppressed } from '@ziroeda/common/browser_hotkeys.js';
import { KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { MsgPanel, type MsgPanelItem } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { ProgressDialog } from '@ziroeda/common/widgets/wx_progress_reporters.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { ChooserFilter, OpenedFile } from '@ziroeda/common/wx/filedlg.js';
import { WxTextEntryDialog } from '@ziroeda/common/wx/textdlg.js';
import { kicadFootprintLibWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import type { CrosshairMode, GridStyle } from '@ziroeda/common/draw_panel_gal_grid_cursor.js';
import '@ziroeda/common/widgets/shell.css';
import type { PCBNEW_APP } from './browser/pcbnew_app.js';
import { DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR } from './dialogs/dialog_footprint_properties_fp_editor.js';
import { DialogFootprintPropertiesFpEditor } from './dialogs/dialog_footprint_properties_fp_editor_ui.js';
import type { SELECTED_3D_MODEL } from './dialogs/panel_fp_properties_3d_model.js';
import { FOOTPRINT } from './footprint.js';
import {
  applyToggle,
  DEFAULT_TOGGLES,
  FOOTPRINT_COPPER_STACK,
  FOOTPRINT_EDIT_FRAME,
  FP_DEFAULT_ACTIVE_LAYER,
  FP_FRAME_NAME,
  footprintGridIU,
  footprintLayers,
} from './footprint_edit_frame.js';
import type { FP_EDIT_JSON_SETTINGS_LIKE } from './footprint_editor_settings.js';
import { fpTargetOf } from './footprint_editor_utils.js';
import {
  FOOTPRINT_LIBRARY_STORE,
  type FOOTPRINT_LIBRARY_STORE_IO,
} from './footprint_library_adapter.js';
import { FootprintTreePane } from './footprint_tree_pane.js';
import { FpTreeSynchronizingAdapter } from './fp_tree_synchronizing_adapter.js';
import { footprintEditorMenus } from './menubar_footprint_editor.js';
import { usePcbItemDialogs } from './pcb_base_edit_frame_ui.js';
import { applyDisplayState, type EditorDisplayState } from './browser/pcb_canvas.js';
import { PCB_DISPLAY_OPTIONS } from './pcb_painter.js';
import { usePcbDrawPanel } from './browser/pcb_draw_panel_gal_host.js';
import {
  layerColor,
  PCB_BACKGROUND,
  PCB_OBJECT_COLORS,
  pcbThemeWithOverrides,
} from './pcbTheme.js';
import { PROJECT_PCB } from './project_pcb.js';
import { FP_DEFAULT_TOOLBARS } from './toolbars_footprint_editor.js';
import { footprintTreeContextMenu, fpTreeSelectedNodes } from './tools/footprint_editor_control.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import {
  AppearanceControls,
  type AppearanceTab,
  appearanceLayerRows,
  BUILTIN_PRESETS,
  DEFAULT_OBJECTS,
  DEFAULT_OPACITY,
  matchPresetName,
  OBJECT_ROWS,
  type ObjectState,
  PRESET_SEPARATOR,
  presetComboItems,
  toggleObject,
  viewportComboItems,
} from './widgets/appearance_controls.js';
import {
  DEFAULT_SELECTION_FILTER_OPTIONS,
  SelectionFilterOnlyMenu,
  SelectionFilterPanel,
  type SelectionFilterItem,
} from './widgets/panel_selection_filter.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';

/**
 * `fpedit.json` as this window reads it.
 */
export interface FOOTPRINT_EDIT_FRAME_SETTINGS extends FP_EDIT_JSON_SETTINGS_LIKE {
  window: FP_EDIT_JSON_SETTINGS_LIKE['window'] & {
    grid: FP_EDIT_JSON_SETTINGS_LIKE['window']['grid'] & {
      style: GridStyle;
      line_width: number;
      min_spacing: number;
    };
    cursor: { crosshair: CrosshairMode; always_show_cursor: boolean };
    /** `window.lib_width`, `m_LibWidth`. */
    lib_width: number;
  };
  editing: {
    polar_coords: boolean;
    /** Tenths of a degree. */
    rotation_angle: number;
    fp_angle_snap_mode: number;
  };
  origin_invert_x_axis: boolean;
  origin_invert_y_axis: boolean;
  appearance: { color_theme: string };
  lib_tree: { columns: string[]; column_widths: Record<string, number>; open_libs: string[] };
}

/** `COMMON_SETTINGS`, the two keys this window reads. */
export interface FOOTPRINT_EDIT_FRAME_COMMON_SETTINGS {
  system: { language: string };
  appearance: { hicontrast_dimming_factor: number };
}

/**
 * What the Footprint Editor asks of the program it runs in: the settings
 * store, the user's toolbar layout, the footprint libraries' storage, the
 * program's own widgets, and `Pgm()`.
 */
export interface FOOTPRINT_EDIT_FRAME_APP {
  /** `GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" )`, subscribed. */
  useFpEditSettings(): FOOTPRINT_EDIT_FRAME_SETTINGS;
  /** The same, read at the moment of the call. */
  fpEdit(): FOOTPRINT_EDIT_FRAME_SETTINGS;
  updateFpEdit(mutate: (s: FOOTPRINT_EDIT_FRAME_SETTINGS) => void): void;
  /** `Pgm().GetCommonSettings()`, subscribed. */
  useCommonSettings(): FOOTPRINT_EDIT_FRAME_COMMON_SETTINGS;
  /** The same, read at the moment of the call. */
  common(): FOOTPRINT_EDIT_FRAME_COMMON_SETTINGS;
  /** `Pgm().SetLanguage`, the Preferences menu's language list. */
  SetLanguage(label: string): void;
  /** `colors/user.json`'s `board.*` rows. */
  useUserColors(): Readonly<Record<string, string>>;
  /** The themes "New Theme..." made. */
  useUserThemes(): Parameters<typeof pcbThemeWithOverrides>[2];
  /** `TOOLBAR_SETTINGS`: each bar as the user configured it. */
  useToolbarEntries(frame: 'fpedit', loc: ToolbarLoc, defaults: ToolbarDefaults): ToolEntry[];
  /** Where a hosted footprint library's files come from. */
  libraryIo: Pick<FOOTPRINT_LIBRARY_STORE_IO, 'footprintText' | 'flipLeftRight'>;
  /** The hosted footprint library set's base URL (its `index.json`). */
  footprintsBase(): string;
  /** `Pgm()` installed: the painter and the view controls read it. */
  installPgm(): void;
  /** `Pgm().GetCommonSettings()` as the GAL display options read it. */
  commonSettingsOf(): COMMON_SETTINGS_LIKE;
  /** The "still loading" panel every chooser shows. */
  LibraryLoadingPanel(props: { label: string; fallback: JSX.Element | null }): ReactNode;
  /** `EDA_BASE_FRAME::ShowPreferences`, opened from this frame. */
  Preferences(onClose: () => void, initialPage?: 'fp-grids'): ReactNode;
  /** The account's Open dialog, in the footprint library folder. */
  OpenFileDialog(props: {
    title: string;
    accept: string;
    filters?: readonly ChooserFilter[];
    onDone: (file: OpenedFile | null) => void;
  }): ReactNode;
  /** The way back to the project manager, at the left of the menu bar. */
  HomeLink: PCBNEW_APP['HomeLink'];
  /** The 3D Models page's preview canvas. */
  ModelPreview3D: PCBNEW_APP['ModelPreview3D'];
}

export interface FootprintEditorFile {
  name: string;
  text: string;
}

/**
 * The two docked palette widths, `footprint_edit_frame.cpp:228-252`. [data]
 * `.MinSize( FromDIP( 250 ), … )` for the Footprints tree and
 * `.MinSize( FromDIP( 180 ), … )` for the LayersManager and Selection Filter.
 */
const LIBRARY_TREE_WIDTH = 250;
const LAYERS_MANAGER_WIDTH = 180;

const PRESET_ITEMS = presetComboItems();
const VIEWPORT_ITEMS = viewportComboItems();

/**
 * The toolbar and menu ids this window's bars carry that are not the
 * TOOL_ACTION's own name. Every other id is `PCB_ACTIONS[id]` or `ACTIONS[id]`.
 */
const ACTION_ALIASES: Readonly<Record<string, TOOL_ACTION>> = {
  rotateCW: PCB_ACTIONS.rotateCw,
  rotateCCW: PCB_ACTIONS.rotateCcw,
  unitsInches: ACTIONS.inchesUnits,
  unitsMils: ACTIONS.milsUnits,
  unitsMm: ACTIONS.millimetersUnits,
  crosshairSmall: ACTIONS.cursorSmallCrosshairs,
  crosshairFull: ACTIONS.cursorFullCrosshairs,
  crosshair45: ACTIONS.cursor45Crosshairs,
  zoomFit: ACTIONS.zoomFitScreen,
  highContrast: ACTIONS.highContrastMode,
  placeImage: PCB_ACTIONS.placeReferenceImage,
};

/** The TOOL_ACTION a toolbar or menu id runs, or null for a window-only row. */
function actionForId(aId: string): TOOL_ACTION | null {
  const alias = ACTION_ALIASES[aId];
  if (alias) return alias;

  const pcb = (PCB_ACTIONS as unknown as Record<string, unknown>)[aId];
  if (pcb && typeof pcb === 'object' && 'MakeEvent' in pcb) return pcb as TOOL_ACTION;

  const common = (ACTIONS as unknown as Record<string, unknown>)[aId];
  if (common && typeof common === 'object' && 'MakeEvent' in common) return common as TOOL_ACTION;

  return null;
}

/** EDA_DRAW_FRAME's eight status fields, by index (`eda_draw_frame.cpp`). */
const STATUS_FIELDS = [
  'message',
  'zoom',
  'coords',
  'deltas',
  'grid',
  'units',
  'tool',
  'constraint',
];

export function FootprintEditFrame({
  app,
  onExitToHome,
  initialProject,
  kiway,
}: {
  app: FOOTPRINT_EDIT_FRAME_APP;
  onExitToHome: () => void;
  initialProject?: FootprintEditorFile[] | null;
  /** The program's KIWAY, on which the frame registers as FRAME_FOOTPRINT_EDITOR. */
  kiway?: KIWAY;
}): JSX.Element {
  const fpCfg = app.useFpEditSettings();
  const userColors = app.useUserColors();
  const userThemes = app.useUserThemes();
  const common = app.useCommonSettings();
  const fpLayers = useMemo(() => footprintLayers(fpCfg), [fpCfg]);
  const allFpLayers = useMemo(() => fpLayers.map((l) => l.name), [fpLayers]);

  const fpTopBar = app.useToolbarEntries('fpedit', 'TOP_MAIN', FP_DEFAULT_TOOLBARS);
  const fpLeftBar = app.useToolbarEntries('fpedit', 'LEFT', FP_DEFAULT_TOOLBARS);
  const fpRightBar = app.useToolbarEntries('fpedit', 'RIGHT', FP_DEFAULT_TOOLBARS);
  const rightBarRef = useRef(fpRightBar);
  rightBarRef.current = fpRightBar;

  /** Anything the frame changed: re-read it. */
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  // ----- window state -----------------------------------------------------------
  const [toggles, setToggles] = useState<Set<string>>(new Set(DEFAULT_TOGGLES));
  const togglesRef = useRef<ReadonlySet<string>>(toggles);
  togglesRef.current = toggles;
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set(allFpLayers));
  const [activeLayerName, setActiveLayerName] = useState(FP_DEFAULT_ACTIVE_LAYER);
  const [tab, setTab] = useState<AppearanceTab>('Layers');
  const [objects, setObjects] = useState<ObjectState>(DEFAULT_OBJECTS);
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  const [contrast, setContrast] = useState<'normal' | 'dim' | 'hide'>('normal');
  const [flipBoard, setFlipBoard] = useState(false);
  const [layerOptsOpen, setLayerOptsOpen] = useState(false);
  const [selFilter, setSelFilter] = useState<Set<string>>(
    new Set(DEFAULT_SELECTION_FILTER_OPTIONS),
  );
  const [filterMenu, setFilterMenu] = useState<{
    x: number;
    y: number;
    item: SelectionFilterItem;
  } | null>(null);
  const [viewportSel, setViewportSel] = useState(PRESET_SEPARATOR);
  const [panelWidth, setPanelWidth] = useState(
    () => app.fpEdit().window.lib_width || LIBRARY_TREE_WIDTH,
  );
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;
  const [treeSel, setTreeSel] = useState<{ lib: string; name: string | null } | null>(null);
  const treeSelRef = useRef(treeSel);
  treeSelRef.current = treeSel;
  const [selectLibId, setSelectLibId] = useState('');
  const [centerLibId, setCenterLibId] = useState('');
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    lib: string;
    name: string;
  } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState<null | true | 'fp-grids'>(null);
  const [fpOpenDlg, setFpOpenDlg] = useState<
    null | { kind: 'addLibrary' } | { kind: 'import'; done: (f: OpenedFile | null) => void }
  >(null);
  const [newLibName, setNewLibName] = useState(false);
  const [unsaved, setUnsaved] = useState<{
    message: string;
    done: (r: UnsavedChangesResult) => void;
  } | null>(null);
  const [saveAs, setSaveAs] = useState<{
    name: string;
    library: string;
    validator: (aLib: string, aName: string) => Promise<boolean>;
    done: (r: { library: string; name: string } | null) => void;
  } | null>(null);
  const [rename, setRename] = useState<{
    dialog: RENAME_DIALOG;
    done: (ok: boolean) => void;
  } | null>(null);
  const [fpProps, setFpProps] = useState<{
    dialog: DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR;
    done: (aOk: boolean) => void;
  } | null>(null);
  const [pick3dModel, setPick3dModel] = useState<{
    done: (aChosen: SELECTED_3D_MODEL | null) => void;
  } | null>(null);
  const model3dResolverRef = useRef<FILENAME_RESOLVER | null>(null);
  const [infoBar, setInfoBar] = useState<string | null>(null);
  const [title, setTitle] = useState(`[no footprint loaded] — ${FP_FRAME_NAME}`);
  const [msgItems, setMsgItems] = useState<MsgPanelItem[]>([]);
  const [activeTool, setActiveTool] = useState('selectSetRect');

  const unitLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';

  const { ask: askKiDialog, node: kiDialogNode } = useKiDialog();
  const askKiDialogRef = useRef(askKiDialog);
  askKiDialogRef.current = askKiDialog;

  // ----- the libraries (FOOTPRINT_LIBRARY_ADAPTER) -----------------------------
  const [store] = useState(
    () =>
      new FOOTPRINT_LIBRARY_STORE({
        footprintText: (n, f) => app.libraryIo.footprintText(n, f),
        flipLeftRight: () => app.libraryIo.flipLeftRight(),
        // FootprintSave's file write. A project library's folder is the
        // project's; the bytes go to the browser's downloads, as Save did.
        writeFootprintFile: (_aDir, aFileName, aText) => {
          const url = URL.createObjectURL(new Blob([aText], { type: 'application/octet-stream' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = aFileName;
          a.click();
          URL.revokeObjectURL(url);
        },
      }),
  );
  const [treeRevision, bumpTree] = useReducer((n: number) => n + 1, 0);

  // ----- the frame ---------------------------------------------------------------
  const frameRef = useRef<FOOTPRINT_EDIT_FRAME | null>(null);
  const itemDialogs = usePcbItemDialogs({
    units: unitLabel,
    board: () => frameRef.current?.GetBoard() ?? null,
    layerColor,
    background: PCB_BACKGROUND,
  });
  const itemDialogHooksRef = useRef(itemDialogs.hooks);
  itemDialogHooksRef.current = itemDialogs.hooks;

  const fpEditRef = useRef<(aFile: string) => void>(() => {});
  const [frame] = useState(() => {
    const h = (): typeof itemDialogHooksRef.current => itemDialogHooksRef.current;
    const f = new FOOTPRINT_EDIT_FRAME({
      fpEdit: (aFile) => fpEditRef.current(aFile),
      onModify: () => repaint(),
      askUnsavedChanges: (aMessage) =>
        new Promise((resolve) => setUnsaved({ message: aMessage, done: resolve })),
      onFootprintLoaded: (aFPID) => {
        // Zoom_Automatique, then the tree: ExpandLibId and CenterLibId. Without
        // WebGL there is no canvas to zoom (KiCad's frame always has one).
        if (frameRef.current?.GetCanvas()) frameRef.current.Zoom_Automatique(false);
        setCenterLibId(aFPID.Format());
        repaint();
      },
      syncLibraryTree: () => bumpTree(),
      showInfoBarError: (aMsg) => setInfoBar(aMsg),
      showInfoBarWarning: (aMsg) => setInfoBar(aMsg),
      showInfoBarMsg: (aMsg) => setInfoBar(aMsg),
      dismissInfoBar: () => setInfoBar(null),
      setTitle: (aTitle) => setTitle(aTitle),
      isLibraryTreeShown: () => togglesRef.current.has('showLibraryTree'),
      toggleLibraryTree: () => onLeftToggleRef.current('showLibraryTree'),
      toggleLayersManager: () => onLeftToggleRef.current('showLayersManager'),
      toggleProperties: () => onLeftToggleRef.current('showProperties'),
      confirmRevert: (aMessage) =>
        askKiDialogRef
          .current({
            caption: 'Confirmation',
            message: aMessage,
            extendedMessage: CONFIRM_REVERT_EXTENDED,
            icon: 'warning',
            labels: { ok: 'Revert' },
          })
          .then((r) => r === 'ok'),
      showSaveAsDialog: (aName, aLibrary, aValidator) =>
        new Promise((resolve) =>
          setSaveAs({ name: aName, library: aLibrary, validator: aValidator, done: resolve }),
        ),
      showImportFootprintDialog: () =>
        new Promise((resolve) =>
          setFpOpenDlg({
            kind: 'import',
            done: (aFile) => resolve(aFile ? { path: aFile.path, text: aFile.text } : null),
          }),
        ),
      showSaveFileDialog: (_aTitle, aDefaultName) => Promise.resolve({ path: aDefaultName }),
      writeTextFile: (aPath, aText) => {
        const url = URL.createObjectURL(new Blob([aText], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = aPath.split('/').pop() ?? aPath;
        a.click();
        URL.revokeObjectURL(url);
        return true;
      },
      askKiDialog: (aRequest) => askKiDialogRef.current(aRequest),
      showFootprintPropertiesFpEditorDialog: (aDialog) =>
        new Promise((resolve) => setFpProps({ dialog: aDialog, done: resolve })),
      updateUserInterface: () => repaint(),
      showPadPropertiesDialog: (d) => h().showPadPropertiesDialog(d),
      showTextPropertiesDialog: (d) => h().showTextPropertiesDialog(d),
      showGraphicItemPropertiesDialog: (d) => h().showGraphicItemPropertiesDialog(d),
      showDimensionPropertiesDialog: (d) => h().showDimensionPropertiesDialog(d),
      showTextBoxPropertiesDialog: (d) => h().showTextBoxPropertiesDialog(d),
      showReferenceImagePropertiesDialog: (d) => h().showReferenceImagePropertiesDialog(d),
      showTablePropertiesDialog: (d) => h().showTablePropertiesDialog(d),
      showBarcodePropertiesDialog: (d) => h().showBarcodePropertiesDialog(d),
      showZoneSettingsDialog: (d) => h().showZoneSettingsDialog(d),
      showImageFileDialog: () => h().showImageFileDialog(),
    });
    f.SetFootprintLibAdapter(store);
    return f;
  });
  frameRef.current = frame;

  // `LoadSettings` / `CommonSettingsChanged`: `GetDesignSettings() =
  // cfg->m_DesignSettings`, so a new footprint takes Preferences' defaults.
  useEffect(() => {
    frame.LoadFootprintEditorDesignSettings(fpCfg.design_settings);
  }, [frame, fpCfg.design_settings]);

  // `KIWAY::Player()` stores the frame as FRAME_FOOTPRINT_EDITOR's player.
  useEffect(() => {
    if (!kiway) return;
    frame.SetKiway(kiway);
    kiway.SetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_EDITOR, frame);
    return () => {
      kiway.PlayerDidClose(FRAME_T.FRAME_FOOTPRINT_EDITOR, frame);
      frame.SetKiway(null);
    };
  }, [kiway, frame]);

  // The frame's status bar, message panel and toolbar selection.
  const statusRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  useEffect(() => {
    frame.SetStatusTextSink((aText, aField) => {
      const name = STATUS_FIELDS[aField];
      const el = name ? statusRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    frame.SetMsgPanelSink((aItems) =>
      setMsgItems(aItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }))),
    );
    // `ACTION_TOOLBAR::SelectAction`: the button whose action the tool runs.
    frame.SetSelectToolbarActionSink((aAction) => {
      const entry = rightBarRef.current.find(
        (e) => typeof e === 'object' && 'id' in e && actionForId(e.id) === aAction,
      );
      if (entry && typeof entry === 'object' && 'id' in entry) setActiveTool(entry.id);
    });
    return () => {
      frame.SetStatusTextSink(null);
      frame.SetMsgPanelSink(null);
      frame.SetSelectToolbarActionSink(null);
    };
  }, [frame]);

  // `LIBRARY_EDITOR_CONTROL::RenameLibrary`'s wxTextEntryDialog.
  useEffect(() => {
    SetRenameDialogPresenter(
      (aDialog) => new Promise((resolve) => setRename({ dialog: aDialog, done: resolve })),
    );
    return () => SetRenameDialogPresenter(null);
  }, []);

  // ----- the canvas ----------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panel = usePcbDrawPanel(frame, canvasRef, {
    installPgm: () => app.installPgm(),
    commonSettings: () => app.commonSettingsOf(),
  });

  /** `TOOL_MANAGER::RunAction`, as a menu row or a toolbar button runs it. */
  const runAction = useCallback(
    (aAction: TOOL_ACTION, aParam?: unknown) => {
      if (aParam === undefined) frame.GetToolManager()?.RunAction(aAction);
      else frame.GetToolManager()?.RunAction(aAction, aParam as never);
      repaint();
    },
    [frame],
  );

  const theme = useMemo(
    () => pcbThemeWithOverrides(fpCfg.appearance.color_theme, userColors, userThemes),
    [fpCfg.appearance.color_theme, userColors, userThemes],
  );

  /**
   * The Appearance panel's state into the board, the view and the painter —
   * what the layer widget, the toolbar and the frame's settings do upstream —
   * and the grid from `fpedit.json`.
   */
  const displayStateRef = useRef<EditorDisplayState | null>(null);
  useEffect(() => {
    const board = frame.GetBoard();

    if (!panel || !board) return;

    const opts = new PCB_DISPLAY_OPTIONS();
    opts.m_ContrastModeDisplay =
      contrast === 'hide'
        ? HIGH_CONTRAST_MODE.HIDDEN
        : contrast === 'dim'
          ? HIGH_CONTRAST_MODE.DIMMED
          : HIGH_CONTRAST_MODE.NORMAL;
    opts.m_PadOpacity = opacity.pads;
    opts.m_ZoneOpacity = opacity.zones;
    opts.m_ImageOpacity = opacity.images;
    opts.m_FilledShapeOpacity = opacity.filledShapes;
    opts.m_FlipBoardView = flipBoard;

    const visibleLayers = new Set<PCB_LAYER_ID>();

    for (const name of visible) {
      const id = board.GetLayerID(name);
      if (id >= 0) visibleLayers.add(id);
    }

    const G = GAL_LAYER_ID;
    const visibleElements = new Map<GAL_LAYER_ID, boolean>([
      [G.LAYER_PADS, objects.pads],
      [G.LAYER_ZONES, objects.zones],
      [G.LAYER_FILLED_SHAPES, objects.filledShapes],
      [G.LAYER_DRAW_BITMAPS, objects.images],
      [G.LAYER_FP_VALUES, objects.fpValues],
      [G.LAYER_FP_REFERENCES, objects.fpReferences],
      [G.LAYER_FP_TEXT, objects.fpText],
      [G.LAYER_DRC_WARNING, objects.drcWarnings],
      [G.LAYER_DRC_ERROR, objects.drcErrors],
      [G.LAYER_DRC_EXCLUSION, objects.drcExclusions],
      [G.LAYER_ANCHOR, objects.anchors],
      [G.LAYER_POINTS, objects.points],
      [G.LAYER_LOCKED_ITEM_SHADOW, objects.lockedShadow],
      [G.LAYER_GRID, objects.grid],
    ]);

    const state: EditorDisplayState = {
      visibleLayers,
      visibleElements,
      displayOptions: opts,
      // The canonical name the layer combo holds (`LSET::NameToLayer`), not the
      // board's display name: a new board calls F.SilkS "F.Silkscreen", and
      // `BOARD::GetLayerID` on the canonical one answers UNDEFINED_LAYER.
      activeLayer: LSET.NameToLayer(activeLayerName) as PCB_LAYER_ID,
      colorTheme: theme.filename,
    };

    applyDisplayState(frame, panel, board, state, displayStateRef.current);
    displayStateRef.current = state;

    // `GAL::SetGridSize` / `SetGridOrigin` / `SetGridVisibility`.
    const gal = panel.GetGAL();
    const gridIU = footprintGridIU(fpCfg);
    gal.SetGridSize({ x: gridIU, y: gridIU });
    gal.SetGridOrigin(board.GetDesignSettings().GetGridOrigin());
    gal.SetGridVisibility(objects.grid && toggles.has('toggleGrid'));
    panel.Refresh();
  }, [
    frame,
    panel,
    visible,
    objects,
    opacity,
    contrast,
    flipBoard,
    activeLayerName,
    theme,
    fpCfg,
    toggles,
  ]);

  // ----- library bootstrap ---------------------------------------------------------
  const projectLibsKey = useMemo(
    () =>
      [
        ...projectFpLibTable(initialProject ?? []).map((r) => `${r.name}\t${r.uri}`),
        ...(initialProject ?? []).filter((f) => /\.kicad_mod$/i.test(f.name)).map((f) => f.name),
      ]
        .sort()
        .join('\n'),
    [initialProject],
  );

  /**
   * `FOOTPRINT_EDIT_FRAME::ProjectChanged` -> `SyncLibraryTree`: the project's
   * rows are re-registered, the previous project's going first. Only the
   * `.pretty` folders the project's fp-lib-table names are libraries.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the project's library content; initialProject is read through it
  useEffect(() => {
    store.DropProjectLibraries();

    const byDir = new Map<string, { fileName: string; text: string }[]>();

    for (const f of initialProject ?? []) {
      if (!/\.kicad_mod$/i.test(f.name)) continue;

      const norm = f.name.replace(/\\/g, '/');
      const m = /([^/]+)\.pretty\//i.exec(norm);
      const dir = m ? `${m[1]}.pretty` : norm.split('/').slice(0, -1).join('/') || 'Project';
      const list = byDir.get(dir) ?? [];
      list.push({ fileName: norm.split('/').pop()!, text: f.text });
      byDir.set(dir, list);
    }

    const libRows = projectFpLibTable(initialProject ?? []);

    for (const [dir, entries] of byDir) {
      const name = projectLibraryNickname(libRows, `${dir}/x.kicad_mod`);
      if (name) store.AddProjectLibrary(name, dir, entries);
    }

    frame.SyncLibraryTree(true);
  }, [projectLibsKey, store, frame]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the base URL is the trigger; the store and frame are stable
  useEffect(() => {
    // The hosted libraries: names up front, files fetched on demand.
    fetch(`${app.footprintsBase()}/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((idx: { name: string; footprints: string[] }[]) => {
        for (const lib of idx) store.AddGlobalLibrary(lib.name, lib.footprints);
        frame.SyncLibraryTree(true);
      })
      .catch(() => bumpTree());
  }, [app.footprintsBase]);

  // `MAIL_FP_EDIT`: find the file's library, select it in the tree, load it.
  fpEditRef.current = (aFile: string): void => {
    const { lib, name } = fpTargetOf(aFile);

    if (!store.HasLibrary(lib)) return;

    const names = store.GetFootprintNames(lib);
    const target = names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? names[0];

    if (!target) return;

    setSelectLibId(`${lib}:${target}`);
    setTreeSel({ lib, name: target });
    void frame.LoadFootprintFromLibrary(new LIB_ID(lib, target));
  };

  // ----- the Footprints pane (LIB_TREE) -------------------------------------------
  const treeAdapter = useMemo(() => {
    const adapter = new FpTreeSynchronizingAdapter({
      loadedFpId: () => frame.GetLoadedFPID().Format(),
      isContentModified: () => frame.GetScreen()?.IsContentModified() === true,
      isCurrentFpFromBoard: () => frame.IsCurrentFPFromBoard(),
    });
    adapter.loadColumnConfig({
      columns: app.fpEdit().lib_tree.columns,
      widths: app.fpEdit().lib_tree.column_widths,
    });
    return adapter;
  }, [app.fpEdit, frame]);

  const openLibs = useRef<readonly string[]>(app.fpEdit().lib_tree.open_libs);
  const openLibSet = useRef(new Set(app.fpEdit().lib_tree.open_libs));

  const [treeNonce, setTreeNonce] = useState(0);
  // `FP_TREE_SYNCHRONIZING_ADAPTER::Sync` over the library adapter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: treeRevision is the Sync trigger
  useEffect(() => {
    treeAdapter.tree.children.length = 0;

    for (const libName of store.GetLibraryNames()) {
      const libNode = treeAdapter.addLibrary(
        libName,
        store.GetRow(libName)?.Description?.() ?? '',
        store.IsPinned(libName),
      );

      for (const name of store.GetFootprintNames(libName)) {
        // FOOTPRINT_INFO: what the file says, once it is in hand.
        const fp = store.LoadFootprint(libName, name, true);
        const descr = fp?.GetLibDescription() ?? '';
        const keywords = fp?.GetKeywords() ?? '';
        const item = new LibTreeNode();
        item.type = LibTreeNodeType.ITEM;
        item.parent = libNode;
        item.name = name;
        item.libNickname = libName;
        item.libItemName = name;
        item.desc = descr;
        // `FOOTPRINT::GetSearchTerms` (`pcbnew/footprint.cpp:1707-1725`).
        item.sourceSearchTerms = [
          { text: libName.toLowerCase(), score: 4 },
          { text: name.toLowerCase(), score: 8, isName: true },
          { text: `${libName}:${name}`.toLowerCase(), score: 16, isName: true },
          ...keywords
            .split(/[ \t\r\n]+/)
            .filter(Boolean)
            .map((k) => ({ text: k.toLowerCase(), score: 4 })),
          { text: keywords.toLowerCase(), score: 1 },
          { text: descr.toLowerCase(), score: 1 },
        ];
        item.rebuildSearchTerms(treeAdapter.getShownColumns());
        libNode.children.push(item);
      }

      treeAdapter.finishLibrary(libNode);
    }

    treeAdapter.tree.assignIntrinsicRanks();
    setTreeNonce((n) => n + 1);
  }, [treeRevision, treeAdapter, store]);

  // The frame's LIB_TREE: the pane's selection and the calls that move it.
  useEffect(() => {
    const tree: LIB_TREE = {
      GetSelectedTreeNodes: (aSelection) => {
        const sel = treeSelRef.current;
        if (!sel) return 0;
        aSelection.push(
          ...fpTreeSelectedNodes({
            library: sel.lib,
            footprint: sel.name ?? '',
            pinned: store.IsPinned(sel.lib),
          }),
        );
        return 1;
      },
      Regenerate: () => bumpTree(),
      CenterLibId: (aLibId) => setCenterLibId(aLibId.Format()),
      GetSelectedLibId: () => {
        const sel = treeSelRef.current;
        return sel ? new LIB_ID(sel.lib, sel.name ?? '') : new LIB_ID();
      },
      SelectLibId: (aLibId) => {
        setSelectLibId(aLibId.Format());
        setTreeSel({ lib: aLibId.GetLibNickname(), name: aLibId.GetLibItemName() || null });
      },
      Unselect: () => setTreeSel(null),
      RefreshLibTree: () => repaint(),
    };
    frame.SetLibTree(tree);
    return () => frame.SetLibTree(null);
  }, [frame, store]);

  const onTreeSelect = useCallback((node: LibTreeNode | null) => {
    if (!node) setTreeSel(null);
    else if (node.type === LibTreeNodeType.LIBRARY) setTreeSel({ lib: node.name, name: null });
    else setTreeSel({ lib: node.libNickname, name: node.libItemName });
  }, []);

  /** `FOOTPRINT_TREE_PANE::onComponentSelected` -> `LoadFootprintFromLibrary`. */
  const onLoadFootprintFromTree = useCallback(
    (lib: string, name: string) => void frame.LoadFootprintFromLibrary(new LIB_ID(lib, name)),
    [frame],
  );

  const onTreeToggleLibrary = useCallback(
    (node: LibTreeNode, open: boolean) => {
      if (open) openLibSet.current.add(node.name);
      else openLibSet.current.delete(node.name);
      app.updateFpEdit((s) => {
        s.lib_tree.open_libs = [...openLibSet.current];
      });
    },
    [app.updateFpEdit],
  );

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
      app.updateFpEdit((s) => {
        s.window.lib_width = panelWidthRef.current;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  // ----- toolbars and menus ----------------------------------------------------------
  /**
   * The left toolbar's buttons. Each runs its action; the window keeps the
   * CHECK state the bar draws (and `fpedit.json`'s copy of the settings ones).
   */
  const onLeftToggle = useCallback(
    (id: string) => {
      if (id === 'gridProperties') {
        setPrefsOpen('fp-grids');
        return;
      }

      // FOOTPRINT_EDIT_FRAME::ToggleLibraryTree: hiding writes the width first.
      if (id === 'showLibraryTree' && togglesRef.current.has(id)) {
        app.updateFpEdit((s) => {
          s.window.lib_width = panelWidthRef.current;
        });
      }

      if (id === 'togglePolarCoords') {
        app.updateFpEdit((s) => {
          s.editing.polar_coords = !s.editing.polar_coords;
        });
      }

      if (id === 'lineModeFree' || id === 'lineMode90' || id === 'lineMode45') {
        const mode = id === 'lineMode45' ? 1 : id === 'lineMode90' ? 2 : 0;
        app.updateFpEdit((s) => {
          s.editing.fp_angle_snap_mode = mode;
        });
      }

      if (id === 'crosshairSmall' || id === 'crosshairFull' || id === 'crosshair45') {
        const mode = id === 'crosshair45' ? '45' : id === 'crosshairFull' ? 'full' : 'small';
        app.updateFpEdit((s) => {
          s.window.cursor.crosshair = mode;
        });
      }

      // The panes are the window's (wxAUI); everything else is an action.
      if (id !== 'showLibraryTree' && id !== 'showLayersManager' && id !== 'showProperties') {
        const action = actionForId(id);
        if (action) runAction(action);
      }

      setToggles((prev) => applyToggle(prev, id));
    },
    [app.updateFpEdit, runAction],
  );
  const onLeftToggleRef = useRef(onLeftToggle);
  onLeftToggleRef.current = onLeftToggle;

  /** A top-toolbar or right-toolbar button: its action. */
  const onToolbarAction = useCallback(
    (id: string) => {
      const action = actionForId(id);
      if (action) runAction(action);
    },
    [runAction],
  );

  /** A menu row: its action, or the few rows that are the window's. */
  const onMenuAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'newLibrary':
          // PCB_CONTROL::AddLibrary -> CreateNewLibrary: not ported; a library
          // here is a project folder made by name.
          setNewLibName(true);
          return;
        case 'addLibrary':
          setFpOpenDlg({ kind: 'addLibrary' });
          return;
        case 'openPreferences':
          setPrefsOpen(true);
          return;
        case 'showFootprintBrowser':
          kiway?.Player(FRAME_T.FRAME_FOOTPRINT_VIEWER);
          return;
        case 'close':
          onExitToHome();
          return;
      }

      const action = actionForId(id);
      if (action) runAction(action);
    },
    [kiway, onExitToHome, runAction],
  );

  const onTreeMenuAction = useCallback(
    (id: string) => {
      const target = treeMenu;
      setTreeMenu(null);
      if (!target) return;

      switch (id) {
        // `LIBRARY_EDITOR_CONTROL::changeSelectedPinStatus`.
        case 'pinLibrary':
        case 'unpinLibrary': {
          const pin = id === 'pinLibrary';
          const sel = fpTreeSelectedNodes({
            library: target.lib,
            footprint: target.name,
            pinned: store.IsPinned(target.lib),
          });
          for (const lib of LibrariesToRepin(sel, pin)) store.SetPinned(lib.libNickname, pin);
          bumpTree();
          return;
        }
        case 'hideLibraryTree':
          onLeftToggle('showLibraryTree');
          return;
        default:
          onMenuAction(id);
      }
    },
    [treeMenu, store, onLeftToggle, onMenuAction],
  );

  const board = frame.GetBoard();
  const footprint = board?.GetFirstFootprint() ?? null;
  const targetFPID = frame.GetTargetFPID();

  const menus: Menu[] = footprintEditorMenus(
    {
      action: onMenuAction,
      tool: onToolbarAction,
      toggle: onLeftToggle,
      language: common.system.language,
      onSelectLanguage: (label: string) => app.SetLanguage(label),
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
      haveFootprint: footprint !== null,
      targetLib: targetFPID.GetLibNickname() !== '',
      targetFootprint: targetFPID.GetLibItemName() !== '',
      footprintSelectedInTree: !!treeSel?.name,
      contentModified: frame.IsContentModified(),
      hasItems: !!board && !board.IsEmpty(),
      undoAvailable: frame.GetUndoCommandCount() > 0,
      redoAvailable: frame.GetRedoCommandCount() > 0,
    },
  );
  const menusRef = useRef<Menu[]>(menus);
  menusRef.current = menus;

  // The menu accelerators; the canvas's own keys go to the dispatcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((document.body.dataset.activeView ?? 'footprints') !== 'footprints') return;
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ----- title -----------------------------------------------------------------------
  // `UpdateTitle()` whenever the frame changed.
  useEffect(() => {
    frame.UpdateTitle();
  });

  const modified = frame.IsContentModified();
  useDocumentTitle('footprints', formatTitle(FP_FRAME_NAME, title, false));
  useUnsavedGuard(modified);

  // ----- Appearance ------------------------------------------------------------------
  const layerRows = useMemo(
    () => appearanceLayerRows(FOOTPRINT_COPPER_STACK, allFpLayers),
    [allFpLayers],
  );

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
    [visible, objects, flipBoard, allFpLayers],
  );

  const applyPreset = (name: string): void => {
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
    if (p.activeLayer && allFpLayers.includes(p.activeLayer)) setActiveLayerName(p.activeLayer);
  };

  const layerName = (name: string): string => GetLayerName(fpLayers, name);

  const toggleLayer = (name: string): void =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const gridIdx = fpCfg.window.grid.last_size_idx;

  const statusSpan = (name: string): JSX.Element => (
    <span
      ref={(el) => {
        statusRefs.current[name] = el;
      }}
    />
  );

  return (
    <div className="ze-app">
      {fpOpenDlg &&
        app.OpenFileDialog({
          title: fpOpenDlg.kind === 'addLibrary' ? 'Add Library' : 'Import Footprint',
          accept: fpOpenDlg.kind === 'addLibrary' ? 'Add' : 'Import',
          filters: [kicadFootprintLibWildcard()],
          onDone: (file) => {
            const which = fpOpenDlg;
            setFpOpenDlg(null);

            if (which.kind === 'import') {
              which.done(file);
              return;
            }

            if (!file) return; // wxID_CANCEL

            const leaf = file.path.split('/').filter(Boolean).pop() ?? file.path;
            store.AddProjectLibrary('Imported', 'Imported.pretty', [
              { fileName: leaf, text: file.text },
            ]);
            frame.SyncLibraryTree(true);
          },
        })}

      <MenuBar
        menus={menus}
        leftSlot={app.HomeLink({ onClick: onExitToHome })}
        title={<b>{title}</b>}
      />

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Toolbar entries={fpTopBar} orientation="horizontal" onActivate={onToolbarAction} />
        <span style={{ width: 8 }} />
        {/* `EDA_DRAW_FRAME::UpdateGridSelectBox`. */}
        <Combo
          title="Grid"
          value={String(gridIdx)}
          options={[
            ...fpCfg.window.grid.sizes.map((g, i) => ({
              value: String(i),
              label: gridChoiceLabel(g, unitLabel, 1e6, g.name),
            })),
            { value: GRID_LIST_SEPARATOR, label: GRID_LIST_SEPARATOR, disabled: true },
            { value: EDIT_GRIDS_LABEL, label: EDIT_GRIDS_LABEL },
          ]}
          onChange={(v) => {
            if (v === GRID_LIST_SEPARATOR) return;
            if (v === EDIT_GRIDS_LABEL) {
              setPrefsOpen('fp-grids');
              return;
            }
            app.updateFpEdit((s) => {
              s.window.grid.last_size_idx = Number(v);
            });
          }}
        />
        <span style={{ width: 8 }} />
        {/* `PCB_LAYER_BOX_SELECTOR`. */}
        <Combo
          title="Active layer"
          value={activeLayerName}
          options={layerRows.map((l) => ({
            value: l,
            label: layerName(l),
            swatch: layerColor(l),
          }))}
          onChange={setActiveLayerName}
        />
      </div>

      <div className="ze-body">
        {toggles.has('showLibraryTree') && (
          <>
            <FootprintTreePane
              width={panelWidth}
              placeholder={
                store.GetLibraryNames().length === 0 &&
                app.LibraryLoadingPanel({
                  fallback: <div className="ze-muted">No footprint libraries loaded.</div>,
                  label: 'Loading footprint libraries...',
                })
              }
              onLoadFootprint={onLoadFootprintFromTree}
              adapter={treeAdapter}
              regenerateNonce={treeNonce}
              selectLibId={selectLibId}
              centerLibId={centerLibId}
              onSelect={onTreeSelect}
              onToggleLibrary={onTreeToggleLibrary}
              onItemContextMenu={onTreeItemContextMenu}
              openLibs={openLibs.current}
              onColumnWidthsChanged={(widths) =>
                app.updateFpEdit((s) => {
                  s.lib_tree.column_widths = widths;
                })
              }
              onShownColumnsChanged={(columns) =>
                app.updateFpEdit((s) => {
                  s.lib_tree.columns = [...columns];
                })
              }
            />
            <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />
          </>
        )}

        <Toolbar
          entries={fpLeftBar}
          app="footprint_editor"
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <div
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {infoBar && (
            <div className="ze-infobar" role="status">
              <span style={{ flex: 1 }}>{infoBar}</span>
              <span className="x" onClick={() => setInfoBar(null)}>
                ✕
              </span>
            </div>
          )}
          <div className="ze-canvas-wrap" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
            {/* `PCB_DRAW_PANEL_GAL`: it takes the canvas's events itself, through
                WX_VIEW_CONTROLS and the frame's TOOL_DISPATCHER. */}
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, outline: 'none' }} />
          </div>
        </div>

        <Toolbar
          entries={fpRightBar}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          onActivate={onToolbarAction}
        />

        {toggles.has('showLayersManager') && (
          <div className="ze-rightdock" style={{ width: LAYERS_MANAGER_WIDTH }}>
            <div className="ze-panel grow">
              <div className="ze-panel-header">Appearance</div>
              <AppearanceControls
                fpEditor
                tab={tab}
                onTab={setTab}
                layerRows={layerRows}
                layerName={layerName}
                layerColor={layerColor}
                activeLayer={activeLayerName}
                onActiveLayer={setActiveLayerName}
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

      <MsgPanel items={msgItems} testId="fp-message-panel" />

      {/* EDA_DRAW_FRAME's eight panes, written by the frame through its sink. */}
      <KiStatusBar
        testIds={{ message: 'fp-status-msg', coords: 'fp-coords', tool: 'fp-tool-msg' }}
        fields={{
          message: statusSpan('message'),
          zoom: statusSpan('zoom'),
          coords: statusSpan('coords'),
          deltas: statusSpan('deltas'),
          grid: statusSpan('grid'),
          units: statusSpan('units'),
          tool: statusSpan('tool'),
          constraint: statusSpan('constraint'),
        }}
      />

      {filterMenu && (
        <SelectionFilterOnlyMenu
          at={filterMenu}
          onOnly={(key) => setSelFilter(new Set([key]))}
          onClose={() => setFilterMenu(null)}
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
              pinned: store.IsPinned(treeMenu.lib),
            },
            { haveFootprint: footprint !== null },
          )}
          onClose={() => setTreeMenu(null)}
        />
      )}

      {newLibName && (
        <WxTextEntryDialog
          caption="New Library"
          message="Name:"
          onCancel={() => setNewLibName(false)}
          onConfirm={(name) => {
            setNewLibName(false);
            const n = name.trim();
            if (!n) return;
            store.CreateLibrary(n);
            setSelectLibId(n);
            setTreeSel({ lib: n, name: null });
            frame.SyncLibraryTree(true);
          }}
        />
      )}

      {rename && (
        <WxTextEntryDialog
          caption={rename.dialog.aTitle}
          message="New name:"
          value={rename.dialog.aName}
          onCancel={() => {
            rename.done(false);
            setRename(null);
          }}
          onConfirm={(text) => {
            void Promise.resolve(rename.dialog.TransferDataFromWindow(text)).then((ok) => {
              if (!ok) return;
              rename.done(true);
              setRename(null);
            });
          }}
        />
      )}

      {saveAs && (
        <EdaListDialog
          title="Save Footprint As"
          listLabel="Save in library:"
          okLabel="Save"
          headers={['Nickname', 'Description']}
          rows={store.GetLibraryNames().map((n) => ({
            value: n,
            cells: [n, store.GetRow(n)?.Description?.() ?? ''],
          }))}
          initialValue={saveAs.library}
          nameRow={{
            label: 'Name:',
            value: saveAs.name,
            excludeChars: FOOTPRINT.StringLibNameInvalidChars(false),
          }}
          onResult={(lib, name) => {
            if (lib === null) {
              saveAs.done(null);
              setSaveAs(null);
              return;
            }
            const fpName = (name ?? '').trim();
            void saveAs.validator(lib, fpName).then((ok) => {
              if (!ok) return;
              saveAs.done({ library: lib, name: fpName });
              setSaveAs(null);
            });
          }}
        />
      )}

      {unsaved && (
        <UnsavedChangesDialog
          message={unsaved.message}
          onResult={(r) => {
            unsaved.done(r);
            setUnsaved(null);
          }}
        />
      )}

      {fpProps && (
        <DialogFootprintPropertiesFpEditor
          dialog={fpProps.dialog}
          units={unitLabel}
          onClose={(aOk) => {
            fpProps.done(aOk);
            setFpProps(null);
            repaint();
          }}
          model3d={(() => {
            const kfp = fpProps.dialog.GetFootprint();
            return {
              footprint: kfp,
              host: {
                resolver: () =>
                  (model3dResolverRef.current ??= PROJECT_PCB.Get3DFilenameResolver()),
                footprintBasePath: () => '',
                embeddedFilesStack: () => [kfp.GetEmbeddedFiles()],
                // No Embedded Files page in this dialog yet, so nothing embeds here.
                addEmbeddedFile: () => null,
                removeEmbeddedFile: () => {},
                onModify: () => {},
              },
              renderPreview: (models, _selected, version) =>
                app.ModelPreview3D({ footprint: kfp, models, version }),
              pickModel: () =>
                new Promise<SELECTED_3D_MODEL | null>((resolve) =>
                  setPick3dModel({ done: resolve }),
                ),
            };
          })()}
        />
      )}
      {pick3dModel &&
        app.OpenFileDialog({
          title: 'Select 3D Model',
          accept: 'Open',
          filters: [
            {
              label: 'All 3D models (*.wrl, *.wrz, *.step, *.stp, *.stpz, *.iges, *.igs)',
              extensions: ['wrl', 'wrz', 'step', 'stp', 'stpz', 'iges', 'igs'],
            },
          ],
          onDone: (file) => {
            const { done } = pick3dModel;
            setPick3dModel(null);
            model3dResolverRef.current ??= PROJECT_PCB.Get3DFilenameResolver();
            done(
              file
                ? {
                    filename: model3dResolverRef.current.ShortenPath(file.path),
                    embedded: false,
                  }
                : null,
            );
          },
        })}

      {itemDialogs.node}
      {kiDialogNode}

      {aboutOpen && (
        <ShowAboutDialog title={ABOUT_TITLES.footprint} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen &&
        app.Preferences(() => setPrefsOpen(null), prefsOpen === true ? undefined : prefsOpen)}
      <ProgressDialog title="Load Footprint Libraries" label={null} />
    </div>
  );
}
