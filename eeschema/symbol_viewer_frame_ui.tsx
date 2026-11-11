// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Library Browser's window: `SYMBOL_VIEWER_FRAME`'s constructor and event table
 * (`eeschema/symbol_viewer_frame.cpp:82-266`). The frame (`symbol_viewer_frame.ts`) holds the
 * lists, the filters, the unit and body-style choices and the preview; this file draws them and
 * hands their events back, as the event table does.
 *
 * The AUI panes, as the constructor adds them (`:206-215`):
 *
 *     TopMainToolbar   HToolbar  Top     Layer 6
 *     MsgPanel         Messages  Bottom  Layer 6
 *     Libraries        Palette   Left    Layer 2  no caption  Min 100  Best 200
 *     Symbols          Palette   Left    Layer 1  no caption  Min 100  Best 300
 *     DrawFrame        Canvas    Center
 *
 * Each palette is one wxPanel holding a wxSearchCtrl over a WX_LISTBOX, laid out by the shared
 * `.ze-palette-pane` rules (`shell.css`) the Footprint Library Browser's panes use too.
 *
 * The hosted libraries are the global table, as the index load sets it. They are read the way
 * the program reads them: listed once the preload has their items, a symbol's own file fetched
 * when the browser lands on it ({@link hostedSymbolHooks}).
 */
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { loadBitmapFontImage } from '@ziroeda/common/gal/gal_window.js';
import { showHotkeyList } from '@ziroeda/common/hotkeys_basic.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LIBRARY_TABLE_TYPE } from '@ziroeda/common/libraries/library_table.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { wasBrowserSuppressed } from '@ziroeda/common/browser_hotkeys.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { useMenuHotkeys } from '@ziroeda/common/tool/use_menu_hotkeys.js';
import { useDocumentTitle } from '@ziroeda/common/use_document_title.js';
import { KISTATUSBAR_FIELDS, KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import { MsgPanel, type MsgPanelItem } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { WxListBox } from '@ziroeda/common/widgets/wx_listbox.js';
import type { wxChoice } from '@ziroeda/wx/choice.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { MenuBar } from '@ziroeda/wx/menu_ui.js';
import { DockSash } from '@ziroeda/wx/wx_aui_sash.js';
import { WxSearchCtrl } from '@ziroeda/wx/wx_search_ctrl.js';
import { createSchDrawPanel } from './browser/sch_canvas.js';
import { LIB_TREE_ITEM_SYMBOL, type LibTreeItem } from './lib_tree_item.js';
import {
  fetchHostedSymbolFile,
  isHostedSymbolLibraryRow,
  type LibIndexEntry,
  libraryLoaded,
  loadedLibraryItems,
  preloadLibraryItems,
  SYMBOL_TYPE,
} from './libraries/symbol_library_adapter.js';
import { SymbolLibAdapter } from './project_sch.js';
import type { SCH_DRAW_PANEL } from './sch_draw_panel.js';
import { SYMBOL_VIEWER_FRAME, type SYMBOL_VIEWER_FRAME_HOOKS } from './symbol_viewer_frame.js';
import { SCH_ACTIONS } from './tools/sch_actions.js';
import {
  SYMBOL_VIEWER_CHOICE_WIDTH,
  symbolViewerMenus,
  TOP_TOOLBAR,
} from './toolbars_symbol_viewer.js';
import '@ziroeda/common/widgets/shell.css';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/**
 * What the window asks of the program. `eeschema` never imports `designer`; the designer's
 * `symbol_viewer_frame_app.tsx` is the one file that answers it.
 */
export interface SYMBOL_VIEWER_FRAME_APP {
  /** The symbol library index: the hosted set, with the tables' other rows beside it. */
  loadIndex(): Promise<readonly LibIndexEntry[]>;
  /** The colour theme in use; a change is `CommonSettingsChanged`. */
  useSchematicTheme(): unknown;
  /** The home link in the title bar. */
  HomeLink(props: { onClick?: () => void }): ReactNode;
  /** The busy panel the library list shows while the index is fetched. */
  LibraryLoadingPanel(props: { label: string; fallback: JSX.Element | null }): ReactNode;
}

export interface SymbolViewerFrameProps {
  app: SYMBOL_VIEWER_FRAME_APP;
  kiway?: KIWAY;
  /** The frame is the one on screen: a change to true is `EVT_ACTIVATE` (`OnActivate`). */
  active?: boolean;
  /** `Close()`: File > Close. */
  onClose: () => void;
  /** The home link: back to the project manager. */
  onExitToHome?: () => void;
}

/** The view stamp App writes on `<body>` while this frame is the one on screen. */
export const SYMVIEWER_VIEW = 'symviewer';

/** `.BestSize( 200, -1 )` / `.BestSize( 300, -1 )` (`:211-214`). [data] */
const LIB_LIST_BEST_WIDTH = 200;
const SYMBOL_LIST_BEST_WIDTH = 300;
/** `.MinSize( 100, -1 )` on both palettes. [data] */
const LIST_MIN_WIDTH = 100;

/** The constructor's title, before DisplayLibInfos has a library to name. */
const FRAME_TITLE = _HKI('Symbol Library Browser');

/** What the hosted libraries are read through: the program's preload and its per-symbol fetch. */
export interface SYMBOL_VIEWER_LIBRARY_SOURCE {
  /** `GetLibraryStatus( lib )->load_status == LOAD_STATUS::LOADED`, as the preload has it. */
  libraryLoaded(aLib: string): boolean;
  /** The preloaded items of a LOADED library. */
  loadedLibraryItems(aLib: string): readonly LibTreeItem[] | undefined;
  /** One symbol's file fetched into its library's folder; null when the host has none. */
  fetchSymbolFile(aLibId: LIB_ID): Promise<string | null>;
}

export const HOSTED_SYMBOL_SOURCE: SYMBOL_VIEWER_LIBRARY_SOURCE = {
  libraryLoaded,
  loadedLibraryItems,
  fetchSymbolFile: fetchHostedSymbolFile,
};

/**
 * Whether \a aLib is a hosted library: a row of the global table, which the hosted set is. A
 * project row of the same nickname shadows it and is read as any other row.
 */
function isHostedLibrary(aLib: string): boolean {
  const row = SymbolLibAdapter(Pgm().GetSettingsManager().Prj()).GetRow(aLib);

  return !!row && isHostedSymbolLibraryRow(row);
}

/**
 * The frame's library source over the hosted set. A hosted library is LOADED once the preload has
 * its items (the chooser counts it the same way), lists its symbols from them, and has a symbol's
 * own file fetched, then the library re-read, when the browser lands on that symbol. Every other
 * row is the adapter's.
 */
export function hostedSymbolHooks(
  aSource: SYMBOL_VIEWER_LIBRARY_SOURCE = HOSTED_SYMBOL_SOURCE,
): Required<Pick<SYMBOL_VIEWER_FRAME_HOOKS, 'getLibraryNames' | 'getSymbols' | 'ensureSymbol'>> {
  const adapter = () => SymbolLibAdapter(Pgm().GetSettingsManager().Prj());

  return {
    // `GetLibraryNames()`: the loaded rows, `StrNumCmp` case-insensitive (library_manager.cpp).
    getLibraryNames: () => {
      const names = new Set(adapter().GetLibraryNames());

      for (const row of Pgm().GetLibraryManager().Rows(LIBRARY_TABLE_TYPE.SYMBOL)) {
        const nickname = row.Nickname();

        if (isHostedSymbolLibraryRow(row) && aSource.libraryLoaded(nickname)) names.add(nickname);
      }

      return [...names].sort((a, b) => strNumCmp(a, b, true));
    },

    getSymbols: (aLib, aType) => {
      if (!isHostedLibrary(aLib)) return undefined;

      return (aSource.loadedLibraryItems(aLib) ?? [])
        .filter((item) => aType !== SYMBOL_TYPE.POWER_ONLY || item.isPower)
        .map((item) => new LIB_TREE_ITEM_SYMBOL(aLib, item));
    },

    ensureSymbol: async (aLibId) => {
      const lib = aLibId.GetLibNickname();

      if (!isHostedLibrary(lib)) return false;

      if (!(await aSource.fetchSymbolFile(aLibId))) return false;

      adapter().LoadOne(lib);
      return true;
    },
  };
}

/** The TOOL_ACTION a toolbar or menu id runs: every id is `SCH_ACTIONS[id]` or `ACTIONS[id]`. */
function actionForId(aId: string): TOOL_ACTION | null {
  for (const table of [SCH_ACTIONS, ACTIONS]) {
    const action = (table as unknown as Record<string, unknown>)[aId];

    if (action && typeof action === 'object' && 'MakeEvent' in action) return action as TOOL_ACTION;
  }

  return null;
}

/** A frame `wxChoice`, drawn: its strings, its selection, its enabled state. */
function ChoiceControl({
  choice,
  title,
  onSelect,
}: {
  choice: wxChoice;
  title: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <Combo
      title={title}
      style={{ width: SYMBOL_VIEWER_CHOICE_WIDTH }}
      disabled={!choice.IsEnabled()}
      value={String(choice.GetSelection())}
      options={choice.GetStrings().map((label, i) => ({ value: String(i), label }))}
      onChange={(v) => {
        // `EVT_CHOICE`: the selection is the control's before the handler reads it.
        choice.SetSelection(Number(v));
        onSelect();
      }}
    />
  );
}

export function SymbolViewerFrame({
  app,
  kiway,
  active = true,
  onClose,
  onExitToHome,
}: SymbolViewerFrameProps): JSX.Element {
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  const theme = app.useSchematicTheme();

  const mounted = useRef(false);
  const titleRef = useRef(FRAME_TITLE);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const libWidthRef = useRef(0);
  const symbolWidthRef = useRef(0);

  const [frame] = useState(() => {
    const f: SYMBOL_VIEWER_FRAME = new SYMBOL_VIEWER_FRAME({
      setTitle: (aTitle) => {
        titleRef.current = aTitle;
        if (mounted.current) repaint();
      },
      close: () => closeRef.current(),
      ...hostedSymbolHooks(),
      getListWidth: (aList) =>
        aList === f.m_libList ? libWidthRef.current : symbolWidthRef.current,
    });

    // The constructor reads its settings before it lays the panes out.
    const cfg = f.config();
    if (cfg) f.LoadSettings(cfg);

    return f;
  });

  // `if( m_libListWidth > 0 ) SetAuiPaneSize( ... )`, else the pane's BestSize (`:217-221`).
  const [libWidth, setLibWidth] = useState(() =>
    frame.m_libListWidth > 0 ? frame.m_libListWidth : LIB_LIST_BEST_WIDTH,
  );
  const [symbolWidth, setSymbolWidth] = useState(() =>
    frame.m_symbolListWidth > 0 ? frame.m_symbolListWidth : SYMBOL_LIST_BEST_WIDTH,
  );
  libWidthRef.current = libWidth;
  symbolWidthRef.current = symbolWidth;

  // Each widget the frame owns repaints the window when the frame changes it.
  useEffect(() => {
    mounted.current = true;
    const widgets = [
      frame.m_libFilter,
      frame.m_libList,
      frame.m_symbolFilter,
      frame.m_symbolList,
      frame.m_unitChoice,
      frame.m_bodyStyleChoice,
    ];

    for (const w of widgets) w.SetChangeListener(repaint);

    repaint();

    return () => {
      mounted.current = false;
      for (const w of widgets) w.SetChangeListener(null);
    };
  }, [frame]);

  // `KIWAY::Player()` records the frame it made; its close tells KIWAY it is gone.
  useEffect(() => {
    if (!kiway) return;
    frame.SetKiway(kiway);
    kiway.SetPlayerFrame(FRAME_T.FRAME_SCH_VIEWER, frame);
    return () => {
      kiway.PlayerDidClose(FRAME_T.FRAME_SCH_VIEWER, frame);
      frame.SetKiway(null);
    };
  }, [kiway, frame]);

  // ----- the libraries -------------------------------------------------------------
  const [indexLoaded, setIndexLoaded] = useState(false);

  // Once the index is in (loading it installs the global tables), each hosted library listed as
  // its preload lands - the library status changing to LOADED - in one rebuild per batch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the index loader is the trigger
  useEffect(() => {
    let cancelled = false;
    let queued = false;

    const rebuild = (): void => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (cancelled) return;
        frame.ReCreateLibList();
        repaint();
      }, 0);
    };

    app
      .loadIndex()
      .then((idx) => {
        if (cancelled) return;

        setIndexLoaded(true);
        rebuild();

        for (const row of Pgm().GetLibraryManager().Rows(LIBRARY_TABLE_TYPE.SYMBOL)) {
          const nickname = row.Nickname();

          if (isHostedSymbolLibraryRow(row) && !libraryLoaded(nickname))
            preloadLibraryItems(nickname).then(rebuild, () => {});
        }
      })
      .catch(() => setIndexLoaded(true));

    return () => {
      cancelled = true;
    };
  }, [app.loadIndex]);

  // ----- the canvas ------------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fontImage, setFontImage] = useState<ImageBitmap | null>(null);
  const [panel, setPanel] = useState<SCH_DRAW_PANEL | null>(null);

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

  // SaveSettings when the frame closes, while the canvas - and so the render settings - is still
  // there: declared before the canvas, so its cleanup runs first.
  useEffect(
    () => () => {
      const cfg = frame.config();
      if (cfg) frame.SaveSettings(cfg);
    },
    [frame],
  );

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !fontImage) return;

    const built = createSchDrawPanel(frame, canvas, fontImage);

    if (!built) return;

    frame.ActivateGalCanvas();
    setPanel(built);
    repaint();

    return () => {
      // The destructor: the preview leaves the view before the view goes.
      if (frame.m_previewItem) {
        built.GetView().Remove(frame.m_previewItem);
        frame.m_previewItem = null;
      }

      built.Destroy();
      frame.SetCanvas(null);
      setPanel(null);
    };
  }, [frame, fontImage]);

  // `CommonSettingsChanged`: the colour theme into the view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme is the trigger; the frame reads it
  useEffect(() => {
    if (panel) frame.CommonSettingsChanged();
  }, [panel, theme]);

  // `OnActivate`: the frame coming to the front re-reads the libraries.
  useEffect(() => {
    if (active && panel) {
      frame.OnActivate();
      repaint();
    }
  }, [frame, active, panel]);

  // The status bar and the message panel.
  const statusRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [msgItems, setMsgItems] = useState<MsgPanelItem[]>([]);
  useEffect(() => {
    frame.SetStatusTextSink((aText, aField) => {
      const name = KISTATUSBAR_FIELDS[aField];
      const el = name ? statusRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    frame.SetMsgPanelSink((aItems) =>
      setMsgItems(aItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }))),
    );
    return () => {
      frame.SetStatusTextSink(null);
      frame.SetMsgPanelSink(null);
    };
  }, [frame]);
  const statusSpan = (name: string): JSX.Element => (
    <span
      ref={(el) => {
        statusRefs.current[name] = el;
      }}
    />
  );

  // ----- focus: the frame's SetFocus() moves it; the page reports it back -----------------
  const rootRef = useRef<HTMLDivElement>(null);
  const libFilterRef = useRef<HTMLInputElement>(null);
  const symbolFilterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const listOf = (aTestId: string): HTMLElement | null =>
      rootRef.current?.querySelector<HTMLElement>(`[data-testid="${aTestId}"]`) ?? null;

    if (frame.m_libFilter.TakeFocusRequest()) libFilterRef.current?.focus();
    if (frame.m_symbolFilter.TakeFocusRequest()) symbolFilterRef.current?.focus();
    if (frame.m_libList.TakeFocusRequest()) listOf('symviewer-lib-list')?.focus();
    if (frame.m_symbolList.TakeFocusRequest()) listOf('symviewer-sym-list')?.focus();
  });

  /** `TOOL_MANAGER::RunAction`, as a menu row or a toolbar button runs it. */
  const runAction = useCallback(
    (aId: string) => {
      const action = actionForId(aId);

      if (action) frame.GetToolManager()?.RunAction(action);

      repaint();
    },
    [frame],
  );

  // ----- OnCharHook (`:920-985`) -------------------------------------------------------
  useEffect(() => {
    // Capture phase: EVT_CHAR_HOOK reaches the frame before the focused control.
    const onKey = (e: KeyboardEvent): void => {
      if ((document.body.dataset.activeView ?? SYMVIEWER_VIEW) !== SYMVIEWER_VIEW) return;
      // A menu accelerator that ran has already prevented the key; our own browser suppressor
      // prevents keys too, and that is not a handler.
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;

      if (frame.OnCharHook(e.key, e.shiftKey)) {
        e.preventDefault();
        repaint();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [frame]);

  // ----- menus (doReCreateMenuBar) ------------------------------------------------------
  const [aboutOpen, setAboutOpen] = useState(false);
  const menus = symbolViewerMenus({
    close: () => frame.CloseLibraryViewer(),
    action: runAction,
    showHotkeys: showHotkeyList,
    showAbout: () => setAboutOpen(true),
    electricalTypesShown: frame.ConditionElectricalTypesShown(),
    pinNumbersShown: frame.ConditionPinNumbersShown(),
  });
  useMenuHotkeys(menus, SYMVIEWER_VIEW);

  /** `setupUIConditions()` (`:297-333`): the two CHECK toggles, lit... */
  const lit = new Set<string>();
  if (frame.ConditionElectricalTypesShown()) lit.add('showElectricalTypes');
  if (frame.ConditionPinNumbersShown()) lit.add('showPinNumbers');

  /** ...and Show Datasheet's ENABLE. */
  const disabled = new Set<string>();
  if (!frame.ConditionShowDatasheet()) disabled.add('showDatasheet');

  // ----- the frame's size, and the two palettes' widths ---------------------------------------
  // `GetWindowSize()` for SaveWindowSettings: the last size the frame was shown at - a hidden frame
  // measures nothing, and its saved size is the one it had on screen.
  const windowSize = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    frame.SetWindowSizeSource(() => windowSize.current);
    return () => frame.SetWindowSizeSource(null);
  }, [frame]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const root = rootRef.current;
    const el = bodyRef.current;
    if (!root || !el || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      setBodyWidth(el.clientWidth);
      if (root.offsetWidth > 0 && root.offsetHeight > 0)
        windowSize.current = { x: root.offsetWidth, y: root.offsetHeight };
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const title = titleRef.current;
  useDocumentTitle(SYMVIEWER_VIEW, title);

  return (
    <div className="ze-app" ref={rootRef} data-testid="symviewer-frame">
      <MenuBar menus={menus} leftSlot={app.HomeLink({ onClick: onExitToHome })} title={title} />

      <Toolbar
        entries={TOP_TOOLBAR}
        orientation="horizontal"
        toggled={lit}
        disabledIds={disabled}
        onActivate={runAction}
        controls={{
          bodyStyleSelector: (
            <ChoiceControl
              choice={frame.m_bodyStyleChoice}
              title="Body style"
              onSelect={() => frame.onSelectSymbolBodyStyle()}
            />
          ),
          unitSelector: (
            <ChoiceControl
              choice={frame.m_unitChoice}
              title="Unit"
              onSelect={() => frame.onSelectSymbolUnit()}
            />
          ),
        }}
      />

      <div className="ze-body" ref={bodyRef}>
        {/* AUI pane "Libraries" */}
        <div className="ze-palette-pane" style={{ width: libWidth }}>
          <WxSearchCtrl
            value={frame.m_libFilter.GetValue()}
            onChange={(v) => frame.m_libFilter.SetValue(v)}
            descriptiveText={frame.m_libFilter.GetDescriptiveText()}
            inputRef={libFilterRef}
            onFocus={() => frame.m_libFilter.SetHasFocus(true)}
            onBlur={() => frame.m_libFilter.SetHasFocus(false)}
            testId="symviewer-lib-filter"
            autoFocus
          />
          {indexLoaded ? (
            <WxListBox
              items={frame.m_libList.GetStrings()}
              selection={frame.m_libList.GetSelection()}
              noBorder
              onSelect={(n) => {
                frame.m_libList.SetSelection(n);
                frame.ClickOnLibList();
              }}
              onFocus={() => frame.m_libList.SetHasFocus(true)}
              onBlur={() => frame.m_libList.SetHasFocus(false)}
              testId="symviewer-lib-list"
              ariaLabel="Libraries"
            />
          ) : (
            app.LibraryLoadingPanel({ label: 'Loading symbol libraries...', fallback: null })
          )}
        </div>
        <DockSash
          edge="right"
          width={libWidth}
          min={LIST_MIN_WIDTH}
          max={Math.max(LIST_MIN_WIDTH, bodyWidth - symbolWidth - LIST_MIN_WIDTH)}
          onResize={setLibWidth}
        />

        {/* AUI pane "Symbols" */}
        <div className="ze-palette-pane ze-palette-after-sash" style={{ width: symbolWidth }}>
          <WxSearchCtrl
            value={frame.m_symbolFilter.GetValue()}
            onChange={(v) => frame.m_symbolFilter.SetValue(v)}
            descriptiveText={frame.m_symbolFilter.GetDescriptiveText()}
            toolTip={frame.m_symbolFilter.GetToolTip()}
            inputRef={symbolFilterRef}
            onFocus={() => frame.m_symbolFilter.SetHasFocus(true)}
            onBlur={() => frame.m_symbolFilter.SetHasFocus(false)}
            testId="symviewer-sym-filter"
          />
          <WxListBox
            items={frame.m_symbolList.GetStrings()}
            selection={frame.m_symbolList.GetSelection()}
            noBorder
            onSelect={(n) => {
              frame.m_symbolList.SetSelection(n);
              frame.ClickOnSymbolList();
            }}
            // `EVT_LISTBOX_DCLICK`: a row activated, not a click below the last one.
            onDoubleClick={(aRow) => {
              if (aRow >= 0) frame.DClickOnSymbolList();
            }}
            onFocus={() => frame.m_symbolList.SetHasFocus(true)}
            onBlur={() => frame.m_symbolList.SetHasFocus(false)}
            testId="symviewer-sym-list"
            ariaLabel="Symbols"
          />
        </div>
        <DockSash
          edge="right"
          width={symbolWidth}
          min={LIST_MIN_WIDTH}
          max={Math.max(LIST_MIN_WIDTH, bodyWidth - libWidth - LIST_MIN_WIDTH)}
          onResize={setSymbolWidth}
        />

        {/* AUI pane "DrawFrame": SCH_DRAW_PANEL, whose events go to the frame's TOOL_DISPATCHER. */}
        <div className="ze-palette-canvas" data-testid="symviewer-canvas">
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, outline: 'none' }} />
        </div>
      </div>

      <MsgPanel items={msgItems} testId="symviewer-message-panel" />

      <KiStatusBar
        testIds={{ message: 'symviewer-status-msg', coords: 'symviewer-coords' }}
        fields={{
          message: statusSpan('message'),
          zoom: statusSpan('zoom'),
          coords: statusSpan('coords'),
          deltas: statusSpan('deltas'),
          grid: statusSpan('grid'),
          units: statusSpan('units'),
        }}
      />

      {aboutOpen && (
        <ShowAboutDialog title={ABOUT_TITLES.symbolViewer} onClose={() => setAboutOpen(false)} />
      )}
    </div>
  );
}
