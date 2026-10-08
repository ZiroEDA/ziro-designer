// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Library Browser's window — `FOOTPRINT_VIEWER_FRAME`'s
 * constructor and event table (`pcbnew/footprint_viewer_frame.cpp:84-311`).
 * The decisions it makes live in `footprint_viewer_frame.ts`; this file is
 * the AUI layout and the event plumbing between them.
 *
 * The AUI panes, as the constructor adds them (`:275-289`):
 *
 *     TopMainToolbar   VToolbar  Top     Layer 6
 *     LeftToolbar      VToolbar  Left    Layer 3
 *     MsgPanel         Messages  Bottom  Layer 6
 *     Libraries        Palette   Left    Layer 2  no caption  Min 100  Best 200
 *     Footprints       Palette   Left    Layer 1  no caption  Min 100  Best 300
 *     DrawFrame        Canvas    Center
 *
 * so across the body, left to right: the left toolbar (outermost), the
 * libraries palette, the footprints palette, then the canvas; the top toolbar
 * and the message panel span the whole width because layer 6 is outside
 * layer 3. A Palette is `PaneBorder( true )` and resizable, so each list pane
 * wears the 1px wxAUI border and has a sash on its canvas side; the toolbar's
 * dock is `DockFixed( true )` and has none. The status bar below is
 * EDA_DRAW_FRAME's.
 *
 * Each palette is one `wxPanel` holding a vertical box sizer (`:135-176`):
 *
 *     libSizer->Add( m_libFilter, 0, wxEXPAND, 5 );   // wxSearchCtrl
 *     libSizer->Add( m_libList,   1, wxEXPAND, 5 );   // WX_LISTBOX, wxLB_HSCROLL|wxNO_BORDER
 *
 * The 5 is a border with no direction flag, so it is no border at all: the
 * filter and the list run edge to edge.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { PCB_IU_PER_MM } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import { FOOTPRINT_INFO_IMPL, type FootprintIndexLibrary } from './footprint_info_impl.js';
import type { FOOTPRINT_INFO } from '@ziroeda/common/footprint_info.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import { MenuBar } from '@ziroeda/common/tool/action_menu_bar.js';
import { useMenuHotkeys } from '@ziroeda/common/tool/use_menu_hotkeys.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { wasBrowserSuppressed } from '@ziroeda/common/browser_hotkeys.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { MsgPanel, type MsgPanelItem } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { KISTATUSBAR_FIELDS, KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import { DockSash } from '@ziroeda/common/widgets/wx_aui_sash.js';
import {
  WxListBox,
  listBoxGetBaseString,
  wxNOT_FOUND,
} from '@ziroeda/common/widgets/wx_listbox.js';
import { WxSearchCtrl } from '@ziroeda/common/widgets/wx_search_ctrl.js';
import { showHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import { useDocumentTitle } from '@ziroeda/common/use_document_title.js';
import type { GridStyle } from '@ziroeda/common/draw_panel_gal_grid_cursor.js';
import { GRID_STYLE } from '@ziroeda/common/gal/gal_display_options.js';
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import {
  EDIT_GRIDS_LABEL,
  GRID_LIST_SEPARATOR,
  GRID_SIZE_LIST,
  DEFAULT_GRID_INDEX,
  gridChoiceLabel,
  gridSizesIU,
} from '@ziroeda/common/settings/grid_settings_ui.js';
import { ZOOM_LIST, zoomChoices } from '@ziroeda/common/settings/zoom_settings.js';
import {
  zoomFactorForScale,
  type StatusUnits,
} from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { BOARD } from './board.js';
import {
  FOOTPRINT_LIBRARY_STORE,
  type FOOTPRINT_LIBRARY_STORE_IO,
} from './footprint_library_adapter.js';
import { usePcbDrawPanel } from './browser/pcb_draw_panel_gal_host.js';
import type { FOOTPRINT_VIEWER_JSON_SETTINGS } from './pcbnew_settings.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import {
  FOOTPRINT_VIEWER_FRAME,
  FPVIEWER_CONSTANTS,
  FPVIEWER_FP_FILTER_TOOLTIP,
  FPVIEWER_FP_LIST_BEST_WIDTH,
  FPVIEWER_LIB_LIST_BEST_WIDTH,
  FPVIEWER_LIST_MIN_WIDTH,
  clampFootprintViewerListWidths,
  footprintListRows,
  footprintViewerTitle,
  libraryListRows,
  listSelectionAfterRebuild,
  paneWidthOrBest,
  selectNextIndex,
  selectPrevIndex,
  stepFootprintSelection,
} from './footprint_viewer_frame.js';
import {
  FPVIEWER_CONTROL,
  FPVIEWER_LEFT_TOOLBAR,
  FPVIEWER_TOP_TOOLBAR,
  footprintViewerMenus,
} from './toolbars_footprint_viewer.js';
import '@ziroeda/common/widgets/shell.css';
import './footprint_viewer_frame_ui.css';

/**
 * What the browser asks of the program: the footprint libraries and their
 * index, the `pcbnew.json` slice it keeps its state in, and the windows that
 * live with the app. `pcbnew` never imports `designer`; the designer's
 * `footprint_viewer_frame_app.tsx` is the one file that answers it.
 */
export interface FOOTPRINT_VIEWER_FRAME_APP {
  /** The hosted library index: `FOOTPRINT_LIBRARY_ADAPTER::GetLibraryNames` and the footprints of each. */
  loadFootprintIndex(): Promise<readonly FootprintIndexLibrary[]>;
  /** FOOTPRINT_LIBRARY_STORE's storage: where a hosted footprint's file comes from. */
  libraryIo: Pick<FOOTPRINT_LIBRARY_STORE_IO, 'footprintText' | 'flipLeftRight'>;
  /** `Pgm()`, installed before the canvas is built. */
  installPgm(): void;
  /** `Pgm().GetCommonSettings()`, which the GAL display options read. */
  commonSettingsOf(): COMMON_SETTINGS_LIKE;
  /** `LIBRARY_MANAGER::GetFullURI( FOOTPRINT, nickname, true )`, null when unresolved. */
  libraryUri(nickname: string): string | null;
  /** `COMMON_SETTINGS::m_Session.pinned_fp_libs`. */
  pinnedFootprintLibs(): readonly string[];
  /** `PCBNEW_SETTINGS`' `footprint_viewer.*`, read on every access. */
  footprintViewerSettings(): FOOTPRINT_VIEWER_JSON_SETTINGS;
  updateFootprintViewerSettings(mutate: (s: FOOTPRINT_VIEWER_JSON_SETTINGS) => void): void;
  /**
   * `m_ViewersDisplay.m_DisplayPadNumbers` — `GetViewerSettingsBase()` is
   * `PCBNEW_SETTINGS` for this frame (`pcb_base_frame.cpp:896-903`), so Show
   * Pad Numbers here is the SAME flag as the board editor's.
   */
  padNumbers(): boolean;
  setPadNumbers(on: boolean): void;
  /**
   * `GetGalDisplayOptions().ReadWindowSettings( fpedit->m_Window )`
   * (`:797-801`): the grid's look comes from the Footprint Editor's settings.
   */
  galGridOptions(): { style: GridStyle; lineWidthPx: number; minSpacingPx: number };
  /** The home link in the title bar. */
  HomeLink(props: { onClick?: () => void }): ReactNode;
  /** The busy panel a list shows while the library index is fetched. */
  LibraryLoadingPanel(props: { label: string; fallback: JSX.Element | null }): ReactNode;
  /** `EDA_3D_VIEWER_FRAME`, reached through `PCB_VIEWER_TOOLS::Show3DViewer`. */
  Viewer3DFrame(props: {
    board: BOARD;
    title: string;
    backLabel: string;
    imageBaseName: string;
    onClose: () => void;
  }): ReactNode;
}

export interface FootprintViewerFrameProps {
  app: FOOTPRINT_VIEWER_FRAME_APP;
  kiway?: KIWAY;
  /** `Close( false )`: File > Close. */
  onClose: () => void;
  /** The home link: back to the project manager. */
  onExitToHome?: () => void;
}

/** The view stamp App writes on `<body>` while this frame is the one on screen. */
export const FPVIEWER_VIEW = 'fpviewer';

/** `pcbnew`'s grid row and zoom list — this is a PCB_DRAW_PANEL_GAL. */
const FPVIEWER_GRIDS = gridSizesIU('pcbnew', PCB_IU_PER_MM);
const FPVIEWER_GRID_SIZES = GRID_SIZE_LIST.pcbnew;
const ZOOM_APP = 'pcbnew' as const;

/**
 * `FOOTPRINT_INFO`s of one library, in the library's own order — what
 * `adapter->GetFootprints( nickname, true )` returns. Not through
 * `FOOTPRINT_LIST_IMPL::ReadFootprintIndex`, which sorts: the viewer lists
 * the library as it was enumerated.
 */
export function footprintInfosOf(aLib: FootprintIndexLibrary | undefined): FOOTPRINT_INFO[] {
  if (!aLib) return [];

  return aLib.footprints.map((fpname, i) => {
    const pads = aLib.pads?.[i] ?? 0;
    return new FOOTPRINT_INFO_IMPL(
      aLib.name,
      fpname,
      aLib.descr?.[i] ?? '',
      aLib.tags?.[i] ?? '',
      i,
      pads,
      pads,
    );
  });
}

export function FootprintViewerFrame({
  app,
  kiway,
  onClose,
  onExitToHome,
}: FootprintViewerFrameProps): JSX.Element {
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  // ----- the two lists (ReCreateLibraryList / ReCreateFootprintList) ------

  const [index, setIndex] = useState<readonly FootprintIndexLibrary[] | null>(null);
  const [libFilter, setLibFilter] = useState('');
  const [fpFilter, setFpFilter] = useState('');
  const [curNickname, setCurNicknameState] = useState('');
  const [curFootprintName, setCurFootprintNameState] = useState('');
  const [libSel, setLibSel] = useState(wxNOT_FOUND);
  const [fpSel, setFpSel] = useState(wxNOT_FOUND);

  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )`: the hosted libraries, read on demand. */
  const [store] = useState(
    () =>
      new FOOTPRINT_LIBRARY_STORE({
        footprintText: (n, f) => app.libraryIo.footprintText(n, f),
        flipLeftRight: () => app.libraryIo.flipLeftRight(),
      }),
  );

  const [frame] = useState(() => {
    const f = new FOOTPRINT_VIEWER_FRAME({
      reCreateLibraryList: () => reloadIndexRef.current(),
      selectAndViewFootprint: (aMode) => selectAndViewFootprintRef.current(aMode),
    });
    f.SetFootprintLibAdapter(store);

    // `GetGalDisplayOptions().ReadWindowSettings( … )`: the grid's look.
    const grid = app.galGridOptions();
    const gal = f.GetGalDisplayOptions();
    gal.m_gridStyle = GRID_STYLE_OF[grid.style];
    gal.m_gridLineWidth = grid.lineWidthPx;
    gal.m_gridMinSpacing = grid.minSpacingPx;

    return f;
  });

  const setCurNickname = useCallback(
    (aNickname: string) => {
      frame.setCurNickname(aNickname);
      setCurNicknameState(aNickname);
    },
    [frame],
  );
  const setCurFootprintName = useCallback(
    (aName: string) => {
      frame.setCurFootprintName(aName);
      setCurFootprintNameState(aName);
    },
    [frame],
  );

  // The constructor's "if a footprint was previously loaded, reload it": the
  // project's retained strings survive the frame being closed and reopened.
  useEffect(() => {
    setCurNicknameState(frame.getCurNickname());
    setCurFootprintNameState(frame.getCurFootprintName());
  }, [frame]);

  const reloadIndex = useCallback(() => {
    app
      .loadFootprintIndex()
      .then((idx) => {
        for (const lib of idx) store.AddGlobalLibrary(lib.name, lib.footprints);
        setIndex(idx);
      })
      .catch(() => setIndex([]));
  }, [app, store]);
  const reloadIndexRef = useRef(reloadIndex);
  reloadIndexRef.current = reloadIndex;
  useEffect(reloadIndex, [reloadIndex]);

  // `KIWAY::Player()` records the frame it made; its close tells KIWAY it is gone.
  useEffect(() => {
    if (!kiway) return;
    frame.SetKiway(kiway);
    kiway.SetPlayerFrame(FRAME_T.FRAME_FOOTPRINT_VIEWER, frame);
    return () => {
      kiway.PlayerDidClose(FRAME_T.FRAME_FOOTPRINT_VIEWER, frame);
      frame.SetKiway(null);
    };
  }, [kiway, frame]);

  const nicknames = useMemo(() => (index ?? []).map((l) => l.name), [index]);
  const libRows = useMemo(() => {
    const pinned = new Set(app.pinnedFootprintLibs());
    return libraryListRows(nicknames, libFilter, (n) => pinned.has(n));
  }, [app, nicknames, libFilter]);

  const libInfos = useMemo(
    () => footprintInfosOf(index?.find((l) => l.name === curNickname)),
    [index, curNickname],
  );
  const fpRows = useMemo(
    () => (curNickname === '' ? [] : footprintListRows(libInfos, fpFilter)),
    [curNickname, libInfos, fpFilter],
  );

  /**
   * `ClickOnLibList`: a different library clears the footprint name so the
   * footprint list re-selects from its top, then rebuilds (the memo above).
   *
   * 10.0.6 first calls `FootprintLibAdapter()->RefreshLibraryIfChanged( name )`,
   * re-reading a library whose files changed on disk. The libraries here are
   * the hosted, read-only set read through the index, so there is nothing to
   * refresh; `MAIL_RELOAD_LIB` is the path by which a changed table arrives.
   */
  const clickOnLibList = useCallback(
    (ii: number) => {
      if (ii < 0) return;
      setLibSel(ii);
      const name = listBoxGetBaseString(libRows, ii);
      if (frame.getCurNickname() === name) return;
      setCurNickname(name);
      setCurFootprintName('');
    },
    [frame, libRows, setCurNickname, setCurFootprintName],
  );

  /**
   * The list half of `SelectAndViewFootprint( aMode )`: select the row and
   * remember the name; the effect below has the frame load it onto its board.
   */
  const selectAndViewFootprint = useCallback(
    (aMode: FPVIEWER_CONSTANTS, aCurrent = frame.getCurFootprintName()) => {
      const nickname = frame.getCurNickname();
      if (nickname === '') return;
      const selection = stepFootprintSelection(fpRows, aCurrent, aMode);
      if (selection === wxNOT_FOUND) return;
      setFpSel(selection);
      setCurFootprintName(listBoxGetBaseString(fpRows, selection));
    },
    [frame, fpRows, setCurFootprintName],
  );
  const selectAndViewFootprintRef = useRef(selectAndViewFootprint);
  selectAndViewFootprintRef.current = selectAndViewFootprint;

  /** `ClickOnFootprintList`: a different name is viewed (`CmpNoCase`). */
  const clickOnFootprintList = useCallback(
    (ii: number) => {
      if (fpRows.length === 0 || ii < 0) return;
      setFpSel(ii);
      const name = listBoxGetBaseString(fpRows, ii);
      if (frame.getCurFootprintName().toLowerCase() !== name.toLowerCase())
        selectAndViewFootprint(FPVIEWER_CONSTANTS.NEW_PART, name);
    },
    [fpRows, frame, selectAndViewFootprint],
  );

  // ReCreateLibraryList's tail: find the current nickname, else the first row,
  // and "click" it; an empty list clears both names.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on a rebuilt list only, as upstream's tail does
  useEffect(() => {
    if (index === null) return;
    const at = listSelectionAfterRebuild(libRows, frame.getCurNickname());
    if (at === wxNOT_FOUND) {
      setLibSel(wxNOT_FOUND);
      setCurNickname('');
      setCurFootprintName('');
    } else {
      clickOnLibList(at);
    }
  }, [libRows, index]);

  // ReCreateFootprintList's tail, the same rule for the footprint list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on a rebuilt list only, as upstream's tail does
  useEffect(() => {
    if (index === null) return;
    const at = listSelectionAfterRebuild(fpRows, frame.getCurFootprintName());
    if (at === wxNOT_FOUND) {
      setFpSel(wxNOT_FOUND);
      setCurFootprintName('');
    } else {
      setFpSel(at);
      const name = listBoxGetBaseString(fpRows, at);
      if (frame.getCurFootprintName().toLowerCase() !== name.toLowerCase())
        selectAndViewFootprint(FPVIEWER_CONSTANTS.NEW_PART, name);
    }
  }, [fpRows, index]);

  // ----- the canvas (PCB_DRAW_PANEL_GAL) --------------------------------------

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panel = usePcbDrawPanel(frame, canvasRef, {
    installPgm: () => app.installPgm(),
    commonSettings: () => app.commonSettingsOf(),
  });

  // The board half of `SelectAndViewFootprint`, whenever the name on show changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the two names are the trigger; the frame reads them itself
  useEffect(() => {
    void frame.ViewFootprint().then(repaint);
  }, [frame, curNickname, curFootprintName]);

  /**
   * The constructor's tail once the canvas exists: "Restore last zoom" —
   * `SetScale( m_FootprintViewerZoom )` — then `updateView()`, which auto-zooms
   * or centres.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the panel is the trigger; the settings are read once, as the constructor does
  useEffect(() => {
    if (!panel) return;
    const z = app.footprintViewerSettings().zoom;
    if (z > 0) panel.GetView().SetScale(z);
    frame.updateView();
    repaint();
  }, [panel]);

  // SaveSettings on close: `m_FootprintViewerZoom = GetView()->GetScale()`.
  useEffect(
    () => () => {
      const scale = panel?.GetView().GetScale() ?? 0;
      if (scale > 0)
        app.updateFootprintViewerSettings((s) => {
          s.zoom = scale;
        });
    },
    [app, panel],
  );

  // The frame's status bar and message panel.
  const statusRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [msgItems, setMsgItems] = useState<MsgPanelItem[]>([]);
  const [activeTool, setActiveTool] = useState('selectionTool');
  useEffect(() => {
    frame.SetStatusTextSink((aText, aField) => {
      const name = KISTATUSBAR_FIELDS[aField];
      const el = name ? statusRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    frame.SetMsgPanelSink((aItems) =>
      setMsgItems(aItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }))),
    );
    // `ACTION_TOOLBAR::SelectAction`: the button whose action the tool runs.
    frame.SetSelectToolbarActionSink((aAction) => {
      for (const id of ['selectionTool', 'measureTool', 'zoomTool']) {
        if (actionForId(id) === aAction) setActiveTool(id);
      }
    });
    return () => {
      frame.SetStatusTextSink(null);
      frame.SetMsgPanelSink(null);
      frame.SetSelectToolbarActionSink(null);
    };
  }, [frame]);
  const statusSpan = (name: string): JSX.Element => (
    <span
      ref={(el) => {
        statusRefs.current[name] = el;
      }}
    />
  );

  /** `TOOL_MANAGER::RunAction`, as a menu row or a toolbar button runs it. */
  const runAction = useCallback(
    (aAction: TOOL_ACTION) => {
      frame.GetToolManager()?.RunAction(aAction);
      repaint();
    },
    [frame],
  );

  const cfg = app.footprintViewerSettings();
  const [gridIdx, setGridIdx] = useState(cfg.grid.last_size_idx);
  /**
   * The sketch toggles and the rest of the left bar's check items. Units
   * start on millimetres, `EDA_UNITS::MM` being the default `system.units`,
   * and the crosshair on what the last session left.
   */
  const [toggles, setToggles] = useState<ReadonlySet<string>>(
    () =>
      new Set([
        'toggleGrid',
        'unitsMm',
        cfg.cursor.crosshair === 'full'
          ? 'crosshairFull'
          : cfg.cursor.crosshair === '45'
            ? 'crosshair45'
            : 'crosshairSmall',
        ...(app.padNumbers() ? ['showPadNumbers'] : []),
      ]),
  );
  const [show3D, setShow3D] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const unitLabel: StatusUnits = toggles.has('unitsInches')
    ? 'in'
    : toggles.has('unitsMils')
      ? 'mils'
      : 'mm';
  const gridIU = FPVIEWER_GRIDS[gridIdx] ?? FPVIEWER_GRIDS[DEFAULT_GRID_INDEX.pcbnew] ?? 0;

  // `GAL::SetGridSize` / `SetGridOrigin`: the grid the combo picked.
  useEffect(() => {
    const board = frame.GetBoard();
    if (!panel || !board) return;
    const gal = panel.GetGAL();
    gal.SetGridSize({ x: gridIU, y: gridIU });
    gal.SetGridOrigin(board.GetDesignSettings().GetGridOrigin());
    panel.Refresh();
  }, [frame, panel, gridIU]);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const zoomFactor = zoomFactorForScale(panel?.GetView().GetScale() ?? 0, dpr, PCB_IU_PER_MM);
  const zoom = useMemo(() => zoomChoices(zoomFactor, ZOOM_LIST[ZOOM_APP]), [zoomFactor]);

  const shown = frame.GetBoard()?.GetFirstFootprint() ?? null;
  const autoZoom = frame.GetPcbNewSettings().m_FootprintViewerAutoZoomOnSelect;

  /** `AddFootprintToPCB()` — double click, Enter, and the toolbar button. */
  const addFootprintToPCB = useCallback(() => {
    frame.AddFootprintToPCB();
  }, [frame]);

  const onTopAction = (id: string): void => {
    switch (id) {
      // `PCB_VIEWER_TOOLS::Show3DViewer`, over `CreateAndShow3D_Frame()`.
      case 'show3DViewer':
        setShow3D(true);
        return;
      // `PCB_VIEWER_TOOLS::FootprintAutoZoom` flips the setting; SaveSettings
      // writes it.
      case 'fpAutoZoom': {
        const next = !autoZoom;
        app.updateFootprintViewerSettings((s) => {
          s.autozoom = next;
        });
        break;
      }
      default:
        break;
    }

    const action = actionForId(id);
    if (action) runAction(action);
  };

  const onLeftAction = (id: string): void => {
    if (id.startsWith('crosshair')) {
      const mode = id === 'crosshairFull' ? 'full' : id === 'crosshair45' ? '45' : 'small';
      // `GAL_DISPLAY_OPTIONS::WriteConfig( *window )` on SaveSettings.
      app.updateFootprintViewerSettings((s) => {
        s.cursor.crosshair = mode;
      });
    }
    if (id === 'showPadNumbers') app.setPadNumbers(!toggles.has('showPadNumbers'));

    const action = actionForId(id);
    if (action) runAction(action);

    if (id === 'selectionTool' || id === 'measureTool') return;

    setToggles((prev) => {
      const next = new Set(prev);
      if (id.startsWith('units') || id.startsWith('crosshair')) {
        const group = id.startsWith('units')
          ? ['unitsMm', 'unitsInches', 'unitsMils']
          : ['crosshairSmall', 'crosshairFull', 'crosshair45'];
        for (const g of group) next.delete(g);
        next.add(id);
      } else if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };

  /** `setupUIConditions()` (`:338-378`): the CHECK conditions, lit. */
  const lit = useMemo(() => {
    const on = new Set(toggles);
    on.add(activeTool);
    if (autoZoom) on.add('fpAutoZoom');
    return on;
  }, [toggles, activeTool, autoZoom]);

  /** `saveFpToBoard`'s ENABLE: `GetBoard()->GetFirstFootprint() != nullptr`. */
  const topDisabled = useMemo(
    () => (shown ? new Set<string>() : new Set(['saveFpToBoard'])),
    [shown],
  );

  // ----- menus (doReCreateMenuBar) -------------------------------------------

  const menus = footprintViewerMenus({
    close: onClose,
    action: onTopAction,
    showHotkeys: showHotkeyList,
    showAbout: () => setAboutOpen(true),
  });
  useMenuHotkeys(menus, FPVIEWER_VIEW);

  // ----- OnCharHook (`:584-623`) --------------------------------------------

  const libFilterRef = useRef<HTMLInputElement>(null);
  const fpFilterRef = useRef<HTMLInputElement>(null);
  const charHook = useRef<(e: KeyboardEvent) => void>(() => {});
  charHook.current = (e: KeyboardEvent): void => {
    const focused = document.activeElement;
    const libHasFocus =
      focused === libFilterRef.current ||
      (focused instanceof HTMLElement && focused.dataset.testid === 'fpviewer-lib-list');

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const up = e.key === 'ArrowUp';
      if (libHasFocus) {
        const to = up ? selectPrevIndex(libSel) : selectNextIndex(libSel, libRows.length);
        if (to !== null) clickOnLibList(to);
      } else {
        const to = up ? selectPrevIndex(fpSel) : selectNextIndex(fpSel, fpRows.length);
        if (to !== null) clickOnFootprintList(to);
      }
      e.preventDefault();
    } else if (e.key === 'Tab' && focused === libFilterRef.current) {
      if (!e.shiftKey) {
        fpFilterRef.current?.focus();
        e.preventDefault();
      }
    } else if (e.key === 'Tab' && focused === fpFilterRef.current) {
      if (e.shiftKey) {
        libFilterRef.current?.focus();
        e.preventDefault();
      }
    } else if (e.key === 'Enter' && fpSel >= 0) {
      addFootprintToPCB();
      e.preventDefault();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((document.body.dataset.activeView ?? FPVIEWER_VIEW) !== FPVIEWER_VIEW) return;
      // A menu accelerator that ran has already prevented the key; our own
      // browser suppressor prevents keys too, and that is not a handler.
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      charHook.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ----- the two palettes' widths (m_libListWidth / m_fpListWidth) -----------

  const initialWidths = useMemo(() => {
    const c = app.footprintViewerSettings();
    const w = clampFootprintViewerListWidths(
      c.lib_list_width,
      c.fp_list_width,
      typeof window !== 'undefined' ? window.innerWidth : 0,
    );
    return {
      lib: paneWidthOrBest(w.lib, FPVIEWER_LIB_LIST_BEST_WIDTH),
      fp: paneWidthOrBest(w.fp, FPVIEWER_FP_LIST_BEST_WIDTH),
    };
  }, [app]);
  const [libWidth, setLibWidth] = useState(initialWidths.lib);
  const [fpWidth, setFpWidth] = useState(initialWidths.fp);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBodyWidth(el.clientWidth));
    ro.observe(el);
    setBodyWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // SaveSettings: `m_FootprintViewerLibListWidth = m_libList->GetSize().x`.
  const onLibResize = (w: number): void => {
    setLibWidth(w);
    app.updateFootprintViewerSettings((s) => {
      s.lib_list_width = w;
    });
  };
  const onFpResize = (w: number): void => {
    setFpWidth(w);
    app.updateFootprintViewerSettings((s) => {
      s.fp_list_width = w;
    });
  };

  // ----- title ---------------------------------------------------------------

  const title = footprintViewerTitle(
    curNickname,
    curNickname === '' ? null : app.libraryUri(curNickname),
  );
  useDocumentTitle(FPVIEWER_VIEW, title);

  return (
    <div className="ze-app ze-fpviewer" data-testid="fpviewer-frame">
      <MenuBar menus={menus} leftSlot={app.HomeLink({ onClick: onExitToHome })} title={title} />

      <Toolbar
        entries={FPVIEWER_TOP_TOOLBAR}
        orientation="horizontal"
        toggled={lit}
        disabledIds={topDisabled}
        onActivate={onTopAction}
        controls={{
          [FPVIEWER_CONTROL.gridSelect]: (
            <Combo
              title="Grid Selection box"
              value={String(gridIdx)}
              options={[
                ...FPVIEWER_GRID_SIZES.map((g, i) => ({
                  value: String(i),
                  label: gridChoiceLabel(g, unitLabel, PCB_IU_PER_MM),
                })),
                { value: GRID_LIST_SEPARATOR, label: GRID_LIST_SEPARATOR, disabled: true },
                { value: EDIT_GRIDS_LABEL, label: EDIT_GRIDS_LABEL },
              ]}
              onChange={(v) => {
                if (v === GRID_LIST_SEPARATOR || v === EDIT_GRIDS_LABEL) return;
                const i = Number(v);
                setGridIdx(i);
                app.updateFootprintViewerSettings((s) => {
                  s.grid.last_size_idx = i;
                });
              }}
            />
          ),
          [FPVIEWER_CONTROL.zoomSelect]: (
            <Combo
              title="Zoom Selection box"
              value={String(zoom.selected)}
              options={zoom.choices.map((c, i) => ({ value: String(i), label: c.label }))}
              onChange={(v) => {
                // `EDA_DRAW_FRAME::OnSelectZoom`: `RunAction( ACTIONS::zoomPreset, id )`.
                const preset = zoom.choices[Number(v)]?.preset;
                if (preset != null) {
                  frame.GetToolManager()?.RunAction(ACTIONS.zoomPreset, preset);
                  repaint();
                }
              }}
            />
          ),
        }}
      />

      <div className="ze-body" ref={bodyRef}>
        <Toolbar
          entries={FPVIEWER_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={lit}
          onActivate={onLeftAction}
        />

        {/* AUI pane "Libraries" */}
        <div className="ze-fpviewer-pane" style={{ width: libWidth }}>
          <WxSearchCtrl
            value={libFilter}
            onChange={setLibFilter}
            descriptiveText="Filter"
            inputRef={libFilterRef}
            testId="fpviewer-lib-filter"
            autoFocus
          />
          {index === null ? (
            app.LibraryLoadingPanel({
              label: 'Loading footprint libraries...',
              fallback: null,
            })
          ) : (
            <WxListBox
              items={libRows}
              selection={libSel}
              noBorder
              onSelect={clickOnLibList}
              testId="fpviewer-lib-list"
              ariaLabel="Libraries"
            />
          )}
        </div>
        <DockSash
          edge="right"
          width={libWidth}
          min={FPVIEWER_LIST_MIN_WIDTH}
          max={Math.max(FPVIEWER_LIST_MIN_WIDTH, bodyWidth - fpWidth - FPVIEWER_LIST_MIN_WIDTH)}
          onResize={onLibResize}
        />

        {/* AUI pane "Footprints" */}
        <div className="ze-fpviewer-pane ze-fpviewer-fps" style={{ width: fpWidth }}>
          <WxSearchCtrl
            value={fpFilter}
            onChange={setFpFilter}
            descriptiveText="Filter"
            toolTip={FPVIEWER_FP_FILTER_TOOLTIP}
            inputRef={fpFilterRef}
            testId="fpviewer-fp-filter"
          />
          <WxListBox
            items={fpRows}
            selection={fpSel}
            noBorder
            onSelect={clickOnFootprintList}
            onDoubleClick={addFootprintToPCB}
            testId="fpviewer-fp-list"
            ariaLabel="Footprints"
          />
        </div>
        <DockSash
          edge="right"
          width={fpWidth}
          min={FPVIEWER_LIST_MIN_WIDTH}
          max={Math.max(FPVIEWER_LIST_MIN_WIDTH, bodyWidth - libWidth - FPVIEWER_LIST_MIN_WIDTH)}
          onResize={onFpResize}
        />

        {/* AUI pane "DrawFrame": `PCB_DRAW_PANEL_GAL`, which takes the canvas's
            events itself through WX_VIEW_CONTROLS and the frame's TOOL_DISPATCHER. */}
        <div className="ze-fpviewer-canvas" data-testid="fpviewer-canvas">
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, outline: 'none' }} />
        </div>
      </div>

      <MsgPanel items={msgItems} testId="fpviewer-message-panel" />

      <KiStatusBar
        testIds={{ message: 'fpviewer-status-msg', coords: 'fpviewer-coords' }}
        fields={{
          message: statusSpan('message'),
          zoom: statusSpan('zoom'),
          coords: statusSpan('coords'),
          deltas: statusSpan('deltas'),
          grid: statusSpan('grid'),
          units: statusSpan('units'),
        }}
      />

      {/* `Update3DView`: "3D Viewer — <footprint name>" (`:987-991`). */}
      {show3D &&
        shown &&
        app.Viewer3DFrame({
          board: frame.GetBoard()!,
          title: `3D Viewer — ${curFootprintName}`,
          backLabel: '← Footprint Library Browser',
          imageBaseName: curFootprintName || 'footprint',
          onClose: () => setShow3D(false),
        })}

      {aboutOpen && (
        <ShowAboutDialog title={ABOUT_TITLES.footprintViewer} onClose={() => setAboutOpen(false)} />
      )}
    </div>
  );
}

/** The app's grid style names, as GAL_DISPLAY_OPTIONS stores them. */
const GRID_STYLE_OF: Readonly<Record<GridStyle, GRID_STYLE>> = {
  dots: GRID_STYLE.DOTS,
  lines: GRID_STYLE.LINES,
  crosses: GRID_STYLE.SMALL_CROSS,
};

/**
 * The toolbar and menu ids this window's bars carry that are not the
 * TOOL_ACTION's own name. Every other id is `PCB_ACTIONS[id]` or `ACTIONS[id]`.
 */
const ACTION_ALIASES: Readonly<Record<string, TOOL_ACTION>> = {
  unitsInches: ACTIONS.inchesUnits,
  unitsMils: ACTIONS.milsUnits,
  unitsMm: ACTIONS.millimetersUnits,
  crosshairSmall: ACTIONS.cursorSmallCrosshairs,
  crosshairFull: ACTIONS.cursorFullCrosshairs,
  crosshair45: ACTIONS.cursor45Crosshairs,
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
