// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's window: the wx half of `PL_EDITOR_FRAME`
 * (`pagelayout_editor/pl_editor_frame.cpp`), around the frame object itself
 * (`pagelayout_editor/pl_editor_frame.ts`).
 *
 * Everything pl_editor decides - the model, the selection, the tools, the
 * undo stack, the title, the status bar and message panel text, the
 * Properties panel's fields - is the frame's. This page is what wx and AUI
 * are upstream: the menu bar, the three toolbars with their two choice
 * boxes, the docked Properties pane, the canvas element the GAL panel adopts,
 * the status bar and message panel, and the modal dialogs the frame asks for
 * through `PL_EDITOR_FRAME_HOST`.
 *
 * What only the program has comes in as {@link PL_EDITOR_APP}: `Pgm()` (the
 * settings slice, the language, the colour themes), `KIWAY`, the Open and
 * Save As dialogs over the account's storage, where a written sheet goes,
 * the Preferences dialog, the toolbar layout and the GL window.
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
import { parseDrawingSheet } from '@ziroeda/common';
import { UnsavedChangesDialog } from '@ziroeda/common/dialogs/dialog_unsaved_changes.js';
import { handleUnsavedChanges, type UnsavedChangesResult } from '@ziroeda/common/confirm.js';
import { ShowAboutDialog } from '@ziroeda/common/dialog_about/AboutDialog_main.js';
import { MessageDialogError, MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import {
  DialogPageSettings,
  type PageSettingsValue,
} from '@ziroeda/common/dialogs/dialog_page_settings.js';
import { HtmlMessageBox } from '@ziroeda/common/dialogs/html_message_box.js';
import { GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { DRAW_PANEL_GAL_WINDOW } from '@ziroeda/common/draw_panel_gal.js';
import type { KIWAY } from '@ziroeda/common/kiway.js';
import type { PGM_BASE } from '@ziroeda/common/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { ToolEntry } from '@ziroeda/common/tool/action_toolbar_types.js';
import {
  FileHistory,
  MISSING_FILE_EXTENDED,
  missingFileMessage,
  openRecentMenuItem,
} from '@ziroeda/common/file_history.js';
import { useFileHistory } from '@ziroeda/common/use_file_history.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { MenuBar, type Menu } from '@ziroeda/common/tool/action_menu_bar.js';
import { ActionMenuPopup } from '@ziroeda/common/tool/action_menu_popup.js';
import { Toolbar } from '@ziroeda/common/tool/action_toolbar.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { useMenuHotkeys } from '@ziroeda/common/tool/use_menu_hotkeys.js';
import {
  FRAME_TITLE_SEPARATOR,
  formatTitle,
  frameTitleName,
  useDocumentTitle,
} from '@ziroeda/common/use_document_title.js';
import { useUnsavedGuard } from '@ziroeda/common/use_unsaved_guard.js';
import { KISTATUSBAR_FIELDS, KiStatusBar } from '@ziroeda/common/widgets/kistatusbar.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { MsgPanel } from '@ziroeda/common/widgets/msgpanel_ui.js';
import { DockSash } from '@ziroeda/common/widgets/wx_aui_sash.js';
import { dockedPaneWidth } from '@ziroeda/common/widgets/wx_aui_sash_geometry.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { SetClipboardFromPaste } from '@ziroeda/common/clipboard.js';
import type { DIALOG_INSPECTOR } from './dialogs/design_inspector.js';
import { DesignInspector } from './dialogs/design_inspector_ui.js';
import { PropertiesFrame } from './dialogs/properties_frame_ui.js';
import { DS_OUTDATED_FORMAT_INFOBAR } from './files.js';
import { doReCreateMenuBar } from './menubar.js';
import { PL_DRAW_PANEL_GAL } from './pl_draw_panel_gal.js';
import { CreateKiWindow, PL_EDITOR_KIFACE_NAME } from './pl_editor.js';
import { PL_EDITOR_STATUS_TEMPLATES, type PL_EDITOR_FRAME_HOST } from './pl_editor_frame.js';
import {
  PL_EDITOR_DEFAULTS,
  PL_EDITOR_SETTINGS,
  type PlEditorSettings,
} from './pl_editor_settings.js';
import { PL_ACTIONS } from './tools/pl_actions.js';
import { ReadOnlyNotice } from '@ziroeda/common/widgets/wx_infobar_ui.js';
import {
  ACTION_FOR_ID,
  EDIT_MENU_ACTIONS,
  loadPlEditorColors,
  loadPlEditorSettings,
  storePlEditorSettings,
  uiState,
} from './pl_editor_settings_bridge.js';
import '@ziroeda/common/widgets/shell.css';

export interface DrawingSheetEditorFile {
  name: string;
  text: string;
}

/**
 * `PL_EDITOR_SETTINGS::m_PropertiesFrameWidth`'s default, 150
 * (pl_editor_settings.cpp:38, :46): the Props pane's BestSize floor, which
 * `dockedPaneWidth` measures the panel's content against.
 */
const PROPERTIES_FRAME_WIDTH = PL_EDITOR_DEFAULTS.properties_frame_width;

/** The centre pane's floor — how much canvas the sash has to leave behind. */
const CANVAS_MIN_WIDTH = 200;

/** One mil in millimetres, the exact inch. [data] */
const MM_PER_MIL = 0.0254;

/**
 * One Open Recent row. A row holds the sheet's text: a page cannot re-read a
 * path it was once handed.
 */
interface RecentFile {
  name: string;
  text: string;
}

/**
 * What the Drawing Sheet Editor's window asks of the program it runs in.
 */
export interface PL_EDITOR_APP {
  /** The way back to the project manager, drawn at the left of the menu bar. */
  homeLink: ReactNode;
  /** `Kiway()`: what COMMON_CONTROL asks of the program. */
  kiway: KIWAY;
  /** `Pgm()`, started if nothing has started it yet. */
  InitPgm(): PGM_BASE;

  /** `pl_editor.json`, as the settings manager holds it now. */
  plEditorSettings: PlEditorSettings;
  /** The same, read at the moment of the call rather than at the last render. */
  GetPlEditorSettings(): PlEditorSettings;
  UpdatePlEditorSettings(aFn: (aSettings: PlEditorSettings) => void): void;

  /**
   * `::GetColorSettings( aThemeId )`: the theme the program resolves, the
   * user's per-layer overrides included. `colorsVersion` changes when they do.
   */
  ColorSettings(aThemeId: string): COLOR_SETTINGS;
  colorsVersion: unknown;

  /** `COMMON_SETTINGS::m_System.file_history_size`. */
  fileHistorySize: number;

  /** `Pgm().GetLanguage` / `SetLanguage`, the Preferences menu's language list. */
  language: string;
  SetLanguage(aLabel: string): void;

  /**
   * The Open (or Append) file dialog: the chosen sheet's full path and text,
   * or null for Cancel. It is the account's file chooser.
   */
  OpenFileDialog(
    aTitle: string,
    aAction: 'open' | 'append',
  ): Promise<{ path: string; text: string } | null>;
  /** `wxFileDialog( wxFD_SAVE )`: the chosen full path, or null. */
  SaveFileDialog(aTitle: string): Promise<string | null>;
  /** Where a written sheet goes: the project's storage, or a download. */
  WriteFile(aFullFileName: string, aContents: string): void;

  /**
   * `EDA_BASE_FRAME::ShowPreferences( aStartPage, aStartParentPage )`: the
   * program's dialog. An empty page opens it where it was last closed.
   */
  Preferences(aStartPage: string, aStartParentPage: string, aOnClose: () => void): ReactNode;

  /** The canvas as the window PL_DRAW_PANEL_GAL adopts (cursors, font atlas). */
  DrawPanelWindow(aCanvas: HTMLCanvasElement): Promise<DRAW_PANEL_GAL_WINDOW>;

  /** The three toolbars as the user configured them (`TOOLBAR_SETTINGS`). */
  toolbars: { top: ToolEntry[]; left: ToolEntry[]; right: ToolEntry[] };
}

/** A queued modal: `DisplayErrorMessage` and `wxMessageBox` are two dialogs upstream. */
type MessageBoxRequest =
  | { kind: 'error'; message: string; extendedMessage?: string }
  | { kind: 'message'; message: string; caption?: string };

/** `DIALOG_PAGES_SETTINGS`' fields from the frame's page and title block. */
function pageSettingsValueOf(aPage: PAGE_INFO, aTitleBlock: TITLE_BLOCK): PageSettingsValue {
  return {
    paper: aPage.GetTypeAsString(),
    portrait: aPage.IsPortrait(),
    customWidthMM: PAGE_INFO.GetCustomWidthMils() * MM_PER_MIL,
    customHeightMM: PAGE_INFO.GetCustomHeightMils() * MM_PER_MIL,
    date: aTitleBlock.GetDate(),
    rev: aTitleBlock.GetRevision(),
    title: aTitleBlock.GetTitle(),
    company: aTitleBlock.GetCompany(),
    comments: Array.from({ length: 9 }, (_, i) => aTitleBlock.GetComment(i)),
  };
}

/** `TransferDataFromWindow`'s page half (dialog_page_settings.cpp:422-470). */
function pageInfoOf(aValue: PageSettingsValue, aCurrent: PAGE_INFO): PAGE_INFO {
  if (aValue.paper === 'User') {
    PAGE_INFO.SetCustomWidthMils(aValue.customWidthMM / MM_PER_MIL);
    PAGE_INFO.SetCustomHeightMils(aValue.customHeightMM / MM_PER_MIL);
  }

  const page = new PAGE_INFO().assign(aCurrent);
  page.SetType(aValue.paper, aValue.portrait);
  return page;
}

/** `TransferDataFromWindow`'s title block half. */
function titleBlockOf(aValue: PageSettingsValue): TITLE_BLOCK {
  const tb = new TITLE_BLOCK();
  tb.SetTitle(aValue.title);
  tb.SetDate(aValue.date);
  tb.SetRevision(aValue.rev);
  tb.SetCompany(aValue.company);
  aValue.comments.forEach((c, i) => tb.SetComment(i, c));
  return tb;
}

export function PlEditorFrameWindow({
  app,
  overlay,
  onExitToHome,
  openRequest,
  readOnlyNotice,
}: {
  app: PL_EDITOR_APP;
  /**
   * The program's own modal windows for this frame - its file dialogs - drawn
   * inside the frame, where the theme reaches them.
   */
  overlay?: ReactNode;
  onExitToHome: () => void;
  /**
   * The read-only strip, when the layout cannot be written: `LoadDrawingSheetFile`
   * raises one for exactly this (`pagelayout_editor/files.cpp:276-281`).
   */
  readOnlyNotice?: JSX.Element | null;
  /** A `.kicad_wks` the project manager double-clicked to open here; re-sent with
   *  a fresh nonce so the resident editor re-opens on the newly-picked file. */
  openRequest?: { name: string; text: string; nonce: number } | null;
}): JSX.Element {
  const plCfg = app.plEditorSettings;
  const userColors = app.colorsVersion;
  const { kiway } = app;

  /** The latest services, for the callbacks that outlive a render. */
  const appRef = useRef(app);
  appRef.current = app;

  /**
   * PL_EDITOR_FRAME's `m_fileHistory`, allocated once the way
   * `EDA_BASE_FRAME::LoadSettings` allocates it.
   */
  const [recentFiles] = useState(
    () =>
      new FileHistory<RecentFile>({
        storageKey: 'ziroeda.drawingsheet.recent',
        maxFiles: app.fileHistorySize,
      }),
  );
  const recent = useFileHistory(recentFiles);

  /** Re-render the chrome: wx repaints its widgets on its own. */
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  /**
   * `IFACE::OnKifaceStart` + `CreateKiWindow( FRAME_PL_EDITOR )`: the settings
   * object the frame reads through `config()`, registered where
   * PL_DRAW_PANEL_GAL's constructor asks for it, and the frame over it.
   */
  const frame = useMemo(() => {
    const pgm = PgmOrNull() ?? appRef.current.InitPgm();
    const cfg = new PL_EDITOR_SETTINGS();

    loadPlEditorSettings(cfg, appRef.current.GetPlEditorSettings());
    pgm.GetSettingsManager().RegisterSettings(PL_EDITOR_KIFACE_NAME, cfg);

    return CreateKiWindow(cfg);
  }, []);

  // ---- the files the frame reads and writes by path ------------------------

  /** Every file a dialog handed over, by the path the frame knows it by. */
  const files = useRef(new Map<string, string>());

  // ---- the frame's window services ---------------------------------------

  const [errorDialogs, setErrorDialogs] = useState<readonly MessageBoxRequest[]>([]);
  const [unsaved, setUnsaved] = useState<{
    message: string;
    save: () => Promise<boolean>;
    resolve: (aProceed: boolean) => void;
  } | null>(null);
  const [pageDlg, setPageDlg] = useState<{ resolve: (aOk: boolean) => void } | null>(null);
  const [inspector, setInspector] = useState<{
    dlg: DIALOG_INSPECTOR;
    resolve: () => void;
  } | null>(null);
  const [htmlBox, setHtmlBox] = useState<{
    caption: string;
    html: string;
    list: readonly string[];
  } | null>(null);
  const [outdatedFormat, setOutdatedFormat] = useState(false);
  const [msgItems, setMsgItems] = useState<readonly MSG_PANEL_ITEM[]>([]);
  const [prefsOpen, setPrefsOpen] = useState<{ page: string; parent: string } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  /** The "Choose Image" dialog: a hidden `<input>` resolving the frame's promise. */
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageResolve = useRef<((aFile: { path: string; data: Uint8Array } | null) => void) | null>(
    null,
  );

  /** The file chooser's Cancel: `fileDlg.ShowModal() != wxID_OK`. */
  useEffect(() => {
    const el = imageInputRef.current;

    if (!el) return;

    const onCancel = (): void => {
      const resolve = imageResolve.current;
      imageResolve.current = null;
      resolve?.(null);
    };

    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, []);

  const displayErrorMessage = useCallback((message: string, extendedMessage?: string) => {
    setErrorDialogs((q) => [
      ...q,
      extendedMessage === undefined || extendedMessage === ''
        ? { kind: 'error' as const, message }
        : { kind: 'error' as const, message, extendedMessage },
    ]);
  }, []);

  const host = useMemo<PL_EDITOR_FRAME_HOST>(
    () => ({
      SetTitle: () => repaint(),
      DisplayErrorMessage: displayErrorMessage,
      MessageBox: (aMessage, aCaption) =>
        setErrorDialogs((q) => [
          ...q,
          aCaption === undefined
            ? { kind: 'message' as const, message: aMessage }
            : { kind: 'message' as const, message: aMessage, caption: aCaption },
        ]),
      WriteFile: (aPath, aContents) => {
        files.current.set(aPath, aContents);
        appRef.current.WriteFile(aPath, aContents);
        return true;
      },
      ReadFile: (aPath) => files.current.get(aPath) ?? null,
      UpdateFileHistory: (aPath) => {
        const text = files.current.get(aPath);
        if (text !== undefined) recentFiles.addFileToHistory({ name: aPath, text });
      },
      ShowOutdatedSaveInfoBar: setOutdatedFormat,
      OpenFileDialog: (aTitle, aAction) =>
        appRef.current.OpenFileDialog(aTitle, aAction).then((file) => {
          if (!file) return null; // wxID_CANCEL

          // `filename = openFileDialog.GetPath()`: the whole path.
          files.current.set(file.path, file.text);
          return file.path;
        }),
      SaveFileDialog: (aTitle) => appRef.current.SaveFileDialog(aTitle),
      HandleUnsavedChanges: (aMessage, aSave) =>
        new Promise((resolve) => setUnsaved({ message: aMessage, save: aSave, resolve })),
      ShowDesignInspector: (aDlg) => new Promise((resolve) => setInspector({ dlg: aDlg, resolve })),
      ShowPageSettingsDialog: () => new Promise((resolve) => setPageDlg({ resolve })),
      ChooseImageFile: () =>
        new Promise((resolve) => {
          imageResolve.current = resolve;
          imageInputRef.current?.click();
        }),
      HtmlMessageBox: (aCaption, aHtml, aList) =>
        setHtmlBox({ caption: aCaption, html: aHtml, list: aList }),
      ShowInfoBarMsg: (aMsg) => displayErrorMessage(aMsg),
      DismissInfoBar: () => setOutdatedFormat(false),
    }),
    [displayErrorMessage, recentFiles],
  );

  // ---- the frame and the chrome it drives ---------------------------------

  const statusRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    frame.SetHost(host);
    frame.SetUiListener(repaint);
    frame.SetStatusTextSink((aText, aField) => {
      const name = KISTATUSBAR_FIELDS[aField];
      const el = name ? statusRefs.current[name] : null;
      if (el) el.textContent = aText;
    });
    frame.SetMsgPanelSink((aItems) => setMsgItems([...aItems]));
    // An empty page leaves the dialog on the one it was last closed on
    // (`eda_base_frame.cpp:1766-1767`); a named one is looked up.
    frame.SetPreferencesPresenter((aPage, aParentPage) =>
      setPrefsOpen({ page: aPage, parent: aParentPage }),
    );
    frame.SetAboutPresenter(() => setAboutOpen(true));
    frame.SetKiway(kiway);

    const boxes = [frame.GetOriginSelectBox(), frame.GetPageSelectBox()];
    for (const b of boxes) b.SetChangeListener(repaint);

    return () => {
      frame.SetHost(null);
      frame.SetUiListener(null);
      frame.SetStatusTextSink(null);
      frame.SetMsgPanelSink(null);
      frame.SetPreferencesPresenter(null);
      frame.SetAboutPresenter(null);
      frame.SetKiway(null);
      for (const b of boxes) b.SetChangeListener(null);
    };
  }, [frame, host, kiway]);

  /** Frame -> `pl_editor.json`: `SaveSettings`, then the store. */
  const persist = useCallback(() => {
    const cfg = frame.config();

    if (frame.GetCanvas()) frame.SaveSettings(cfg);

    const probe = structuredClone(appRef.current.GetPlEditorSettings());

    if (!storePlEditorSettings(cfg, probe)) return;

    appRef.current.UpdatePlEditorSettings((s) => {
      storePlEditorSettings(cfg, s);
    });
  }, [frame]);

  /**
   * Preferences -> frame: `CommonSettingsChanged` re-reads cfg after the
   * dialog commits (`pl_editor_frame.cpp:516-535`).
   */
  useEffect(() => {
    loadPlEditorSettings(frame.config(), plCfg);

    if (frame.GetCanvas()) {
      frame.CommonSettingsChanged();
      loadPlEditorColors(frame, appRef.current.ColorSettings(plCfg.appearance.color_theme));
    }

    repaint();
  }, [frame, plCfg]);

  /** A "User" theme override edited on a Colors page repaints the sheet. */
  useEffect(() => {
    if (userColors && frame.GetCanvas())
      loadPlEditorColors(
        frame,
        appRef.current.ColorSettings(appRef.current.GetPlEditorSettings().appearance.color_theme),
      );
  }, [frame, userColors]);

  /**
   * Run an action as a toolbar button or a menu row does:
   * `ACTION_TOOLBAR::onToolEvent` / `ACTION_MENU::OnMenuEvent` clear the
   * event's position before processing it (action_toolbar.cpp:807-808), so a
   * drawing tool does not start at the cursor as a hotkey's does.
   */
  const runAction = useCallback(
    (aAction: TOOL_ACTION) => {
      const mgr = frame.GetToolManager();

      if (!mgr) return;

      const evt = aAction.MakeEvent();
      evt.SetHasPosition(false);
      mgr.ProcessEvent(evt);
      persist();
      repaint();
    },
    [frame, persist],
  );

  // ---- the canvas ------------------------------------------------------------

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [glFailed, setGlFailed] = useState(false);
  const [attached, setAttached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let panel: PL_DRAW_PANEL_GAL | null = null;

    const el = canvasRef.current;

    if (!el) return;

    void appRef.current.DrawPanelWindow(el).then((window) => {
      if (cancelled) return;

      try {
        panel = new PL_DRAW_PANEL_GAL(
          frame,
          window,
          frame.GetGalDisplayOptions(),
          GAL_TYPE.GAL_TYPE_OPENGL,
        );
      } catch (err) {
        console.warn(`Could not use OpenGL: ${(err as Error).message}`);
        setGlFailed(true);
        return;
      }

      frame.AttachCanvas(panel);
      loadPlEditorColors(
        frame,
        appRef.current.ColorSettings(appRef.current.GetPlEditorSettings().appearance.color_theme),
      );
      setAttached(true);
      repaint();
    });

    return () => {
      cancelled = true;

      if (panel) {
        frame.Destroy();
        setAttached(false);
      }
    };
  }, [frame]);

  /**
   * wx's idle: after every input the canvas handled, the controls ask
   * `wxEVT_UPDATE_UI` again and the settings the tools wrote are stored.
   */
  useEffect(() => {
    const el = canvasRef.current;

    if (!el || !attached) return;

    let queued = false;
    const idle = (): void => {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        persist();
        repaint();
      }, 0);
    };
    const events = ['pointerup', 'keyup', 'wheel'] as const;

    for (const e of events) el.addEventListener(e, idle);

    return () => {
      for (const e of events) el.removeEventListener(e, idle);
    };
  }, [attached, persist]);

  // ---- files -------------------------------------------------------------

  /** `KICAD_MANAGER_ACTIONS::editDrawingSheet` with a file: `OpenProjectFiles`. */
  const lastOpened = useRef<number | null>(null);
  useEffect(() => {
    if (!openRequest || openRequest.nonce === lastOpened.current || !attached) return;

    lastOpened.current = openRequest.nonce;
    files.current.set(openRequest.name, openRequest.text);
    frame.OpenProjectFiles([openRequest.name]);
    repaint();
  }, [openRequest, attached, frame]);

  /** `OnFileHistory` for the row picked: `GetFileFromHistory` first. */
  const openRecent = useCallback(
    (aIndex: number) => {
      const r = recentFiles.getFileFromHistory(aIndex, {
        exists: (e) => e.text.length > 0,
        confirmRemove: (e) =>
          window.confirm(`${missingFileMessage(e.name)}\n${MISSING_FILE_EXTENDED}`),
      });

      if (!r) return;

      files.current.set(r.name, r.text);
      void frame.OnFileHistory(r.name).then(repaint);
    },
    [frame, recentFiles],
  );

  /** A system paste with the canvas out of focus: the clipboard, then `ACTIONS::paste`. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      // Hidden frames must not act on the document paste event.
      if ((document.body.dataset.activeView ?? 'drawingsheet') !== 'drawingsheet') return;

      const tgt = e.target as HTMLElement | null;

      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;

      const dt = e.clipboardData;

      if (!dt) return;

      e.preventDefault();

      // `wxTheClipboard` is what the paste carries; then `ACTIONS::paste`.
      void SetClipboardFromPaste(dt).then(() => runAction(ACTIONS.paste));
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [runAction]);

  // ---- toolbars ----------------------------------------------------------

  const { top: dsTopBar, left: dsLeftBar, right: dsRightBar } = app.toolbars;

  const ui = attached
    ? uiState(frame, ACTION_FOR_ID)
    : { checked: new Set<string>(), disabled: new Set<string>() };
  const edit = attached
    ? uiState(frame, EDIT_MENU_ACTIONS)
    : { checked: new Set<string>(), disabled: new Set<string>() };

  /** The RIGHT toolbar's radio: whichever tool action is checked. */
  const activeTool =
    ['dsAddLine', 'dsAddRect', 'dsAddText', 'dsAddBitmap', 'dsDelete', 'select'].find((id) =>
      ui.checked.has(id),
    ) ?? '';

  const onToolbarAction = useCallback(
    (id: string) => {
      const action = ACTION_FOR_ID[id];

      if (action) runAction(action);
    },
    [runAction],
  );

  const originBox = frame.GetOriginSelectBox();
  const pageBox = frame.GetPageSelectBox();

  const topControls: Record<string, ReactNode> = {
    // `m_originSelectBox` (toolbars_pl_editor.cpp:152-170).
    originSelector: (
      <Combo
        value={String(originBox.GetSelection())}
        options={originBox.GetStrings().map((label, i) => ({ value: String(i), label }))}
        onChange={(v) => {
          originBox.SetSelection(Number(v));
          if (attached) frame.OnSelectCoordOriginCorner();
          persist();
          repaint();
        }}
        title="Origin of coordinates displayed to the status bar"
      />
    ),
    // `m_pageSelectBox` (:172-185).
    pageSelect: (
      <Combo
        value={String(pageBox.GetSelection())}
        options={pageBox.GetStrings().map((label, i) => ({ value: String(i), label }))}
        onChange={(v) => {
          pageBox.SetSelection(Number(v));
          if (attached) frame.OnSelectPage();
          repaint();
        }}
        title={
          'Simulate page 1 or other pages to show how items\nwhich are not on all page are displayed'
        }
      />
    ),
  };

  // ---- menus -------------------------------------------------------------

  const openRecentItem = openRecentMenuItem({
    files: recent,
    onOpen: openRecent,
    onClear: () => recentFiles.clearFileHistory(),
  });

  const menus: Menu[] = useMemo(
    () =>
      doReCreateMenuBar({
        doNew: () => runAction(ACTIONS.doNew),
        open: () => runAction(ACTIONS.open),
        openRecent: openRecentItem,
        save: () => runAction(ACTIONS.save),
        saveAs: () => runAction(ACTIONS.saveAs),
        print: () => runAction(ACTIONS.print),
        close: onExitToHome,
        undo: () => runAction(ACTIONS.undo),
        redo: () => runAction(ACTIONS.redo),
        cut: () => runAction(ACTIONS.cut),
        copy: () => runAction(ACTIONS.copy),
        paste: () => runAction(ACTIONS.paste),
        doDelete: () => runAction(ACTIONS.doDelete),
        undoEnabled: !edit.disabled.has('undo'),
        redoEnabled: !edit.disabled.has('redo'),
        selectionNotEmpty: !edit.disabled.has('copy'),
        pasteEnabled: !edit.disabled.has('paste'),
        zoomInCenter: () => runAction(ACTIONS.zoomInCenter),
        zoomOutCenter: () => runAction(ACTIONS.zoomOutCenter),
        zoomFitScreen: () => runAction(ACTIONS.zoomFitScreen),
        zoomTool: () => runAction(ACTIONS.zoomTool),
        zoomRedraw: () => runAction(ACTIONS.zoomRedraw),
        previewSettings: () => runAction(PL_ACTIONS.previewSettings),
        drawLine: () => runAction(PL_ACTIONS.drawLine),
        drawRectangle: () => runAction(PL_ACTIONS.drawRectangle),
        placeText: () => runAction(PL_ACTIONS.placeText),
        placeImage: () => runAction(PL_ACTIONS.placeImage),
        appendImportedDrawingSheet: () => runAction(PL_ACTIONS.appendImportedDrawingSheet),
        gridResetOrigin: () => runAction(ACTIONS.gridResetOrigin),
        showInspector: () => runAction(PL_ACTIONS.showInspector),
        toolManager: { RunAction: (a) => runAction(a) },
        language: app.language,
        onSelectLanguage: (label) => appRef.current.SetLanguage(label),
      }),
    // The enable flags are fresh each render, so the menus follow every repaint.
    [runAction, openRecentItem, onExitToHome, edit.disabled, app.language],
  );

  useMenuHotkeys(menus, 'drawingsheet');

  // ---- title -------------------------------------------------------------

  /** `UpdateTitleAndInfo`'s string: `[*]name — Drawing Sheet Editor`. */
  const frameTitle = frame.GetTitle();
  const sep = frameTitle.lastIndexOf(FRAME_TITLE_SEPARATOR);
  const titleName = sep >= 0 ? frameTitle.slice(0, sep) : frameTitle;
  const titleModified = titleName.startsWith('*');

  useDocumentTitle(
    'drawingsheet',
    formatTitle(
      'Drawing Sheet Editor',
      frameTitleName(frame.GetCurrentFileName(), ''),
      titleModified,
    ),
  );

  // This editor has no autosave: stop an accidental close of a modified sheet.
  useUnsavedGuard(attached && frame.IsContentModified());

  // ---- the Properties pane ------------------------------------------------

  const panel = frame.GetPropertiesFrame();
  const [propsWidth, setPropsWidth] = useState(
    () => appRef.current.GetPlEditorSettings().properties_frame_width,
  );
  const [propsMin, setPropsMin] = useState(PROPERTIES_FRAME_WIDTH);
  const bodyRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef<HTMLDivElement>(null);

  // wxAUI shows whichever of BestSize and MinSize is larger, so the pane
  // OPENS at the wider of the two; the content's minimum is measured.
  useEffect(() => {
    const el = propsRef.current?.firstElementChild;
    if (!(el instanceof HTMLElement) || !attached) return;
    const min = Math.ceil(el.scrollWidth);
    if (min <= 0) return;
    const floor = dockedPaneWidth(PROPERTIES_FRAME_WIDTH, min);
    setPropsMin(floor);
    setPropsWidth((w) => Math.max(w, floor));
  }, [attached]);

  useEffect(() => {
    panel?.SetWidth(propsWidth);
  }, [panel, propsWidth]);

  // ---- page settings dialog ------------------------------------------------

  const pageValue = useMemo(
    () => (pageDlg ? pageSettingsValueOf(frame.GetPageSettings(), frame.GetTitleBlock()) : null),
    [pageDlg, frame],
  );
  const previewSheet = useMemo(() => {
    if (!pageDlg) return null;
    try {
      return parseDrawingSheet(DS_DATA_MODEL.GetTheInstance().SaveInString());
    } catch {
      return null;
    }
  }, [pageDlg]);

  const units = frame.GetUserUnits();
  const dialogUnits = units === 'in' || units === 'mils' ? units : 'mm';

  return (
    // `ze-wks` scopes the PL_EDITOR_FRAME chrome measurements in shell.css.
    <div className="ze-app ze-wks">
      {overlay}
      <input
        ref={imageInputRef}
        type="file"
        // FILEEXT::ImageFileWildcard(): the image types wxImage can read.
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          const resolve = imageResolve.current;
          imageResolve.current = null;

          if (!f) {
            resolve?.(null);
            return;
          }

          void f
            .arrayBuffer()
            .then((buf) => resolve?.({ path: f.name, data: new Uint8Array(buf) }));
        }}
      />

      <MenuBar
        menus={menus}
        leftSlot={app.homeLink}
        title={
          <>
            <b>{titleName}</b>
            {sep >= 0 ? frameTitle.slice(sep) : ''}
          </>
        }
      />

      <Toolbar
        entries={dsTopBar}
        orientation="horizontal"
        toggled={ui.checked}
        disabledIds={ui.disabled}
        onActivate={onToolbarAction}
        controls={topControls}
      />

      {/* `CreateInfoBar()`'s WX_INFOBAR pane, AUI layer 1 (pl_editor_frame.cpp:183). */}
      {readOnlyNotice}
      {outdatedFormat && <ReadOnlyNotice message={DS_OUTDATED_FORMAT_INFOBAR} />}

      <div className="ze-body" ref={bodyRef}>
        <Toolbar
          entries={dsLeftBar}
          app="pl_editor"
          orientation="vertical"
          side="left"
          toggled={ui.checked}
          onActivate={onToolbarAction}
        />

        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <div className="ze-canvas-wrap" style={{ overflow: 'hidden' }}>
            {glFailed ? (
              <div className="ze-gbr-nogl">This browser cannot create a WebGL 2 context.</div>
            ) : (
              // The panel adopts this element: its size, its events, its cursor.
              <canvas
                ref={canvasRef}
                data-testid="ds-canvas"
                tabIndex={0}
                style={{ position: 'absolute', inset: 0, display: 'block', outline: 'none' }}
              />
            )}
          </div>
        </div>

        {/* RightToolbar is `.Right().Layer( 2 )` and Props `.Right().Layer( 3 )`
            (pl_editor_frame.cpp:197-204): the toolbar touches the canvas. */}
        <Toolbar
          entries={dsRightBar}
          orientation="vertical"
          side="right"
          activeTool={activeTool}
          disabledIds={ui.disabled}
          onActivate={onToolbarAction}
        />

        <DockSash
          edge="left"
          width={propsWidth}
          min={propsMin}
          max={Math.max(propsMin, (bodyRef.current?.clientWidth ?? 0) - CANVAS_MIN_WIDTH)}
          onResize={(w) => {
            setPropsWidth(w);
            panel?.SetWidth(w);
            persist();
          }}
        />
        <div
          ref={propsRef}
          className="ze-leftdock on-right"
          style={{ width: propsWidth, minWidth: propsWidth }}
        >
          {panel && <PropertiesFrame panel={panel} />}
        </div>
      </div>

      <MsgPanel
        testId="ds-message-panel"
        items={msgItems.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }))}
      />

      {/* `stsbar->SetFieldsCount( arrayDim( dims ), dims )` (pl_editor_frame.cpp:150-181). */}
      <KiStatusBar
        testIds={{ message: 'ds-status-msg', coords: 'ds-coords' }}
        templates={PL_EDITOR_STATUS_TEMPLATES}
        fields={Object.fromEntries(
          KISTATUSBAR_FIELDS.map((name, i) => [
            name,
            <span
              key={name}
              ref={(el) => {
                statusRefs.current[name] = el;
                if (el && !el.textContent) el.textContent = frame.GetStatusText(i);
              }}
            />,
          ]),
        )}
      />

      <ActionMenuPopup frame={frame} />

      {unsaved && (
        <UnsavedChangesDialog
          message={unsaved.message}
          onResult={(result: UnsavedChangesResult) => {
            const req = unsaved;
            setUnsaved(null);

            // Save runs the frame's saveCurrentPageLayout, which may itself open
            // Save As; the answer arrives when that settles.
            if (result === 'save') {
              void req.save().then(req.resolve);
              return;
            }

            req.resolve(handleUnsavedChanges(result, () => false));
          }}
        />
      )}

      {pageDlg && pageValue && (
        <DialogPageSettings
          value={pageValue}
          // `m_parent->GetName() == PL_EDITOR_FRAME_NAME`: the "Preview" labels.
          frame="pl_editor"
          // `COLOR4D bgColor = m_parent->GetDrawBgColor()` (dialog_page_settings.cpp:598).
          blackBackground={plCfg.black_background}
          units={dialogUnits}
          // `SetWksFileName( GetCurrentFileName() ); EnableWksFileNamePicker( false )`
          // (pl_editor_control.cpp:97-98).
          wksFileName={frame.GetCurrentFileName()}
          sheet={previewSheet}
          onCancel={() => {
            const req = pageDlg;
            setPageDlg(null);
            req.resolve(false);
          }}
          onOk={(next) => {
            const req = pageDlg;
            setPageDlg(null);
            // TransferDataFromWindow: the page and the title block, back into the frame.
            frame.SetPageSettings(pageInfoOf(next, frame.GetPageSettings()));
            frame.SetTitleBlock(titleBlockOf(next));
            req.resolve(true);
            persist();
          }}
        />
      )}

      {inspector && (
        <DesignInspector
          dlg={inspector.dlg}
          onClose={() => {
            const req = inspector;
            setInspector(null);
            req.resolve();
          }}
        />
      )}

      {htmlBox && (
        <HtmlMessageBox
          caption={htmlBox.caption}
          html={htmlBox.html}
          messages={htmlBox.list}
          onClose={() => setHtmlBox(null)}
        />
      )}

      {/* One at a time and in order, as two modal calls on one stack frame. */}
      {errorDialogs[0]?.kind === 'error' && (
        <MessageDialogError
          message={errorDialogs[0].message}
          {...(errorDialogs[0].extendedMessage === undefined
            ? {}
            : { extendedMessage: errorDialogs[0].extendedMessage })}
          onClose={() => setErrorDialogs((q) => q.slice(1))}
        />
      )}
      {errorDialogs[0]?.kind === 'message' && (
        <MessageDialogOk
          message={errorDialogs[0].message}
          {...(errorDialogs[0].caption === undefined ? {} : { caption: errorDialogs[0].caption })}
          onClose={() => setErrorDialogs((q) => q.slice(1))}
        />
      )}

      {aboutOpen && (
        <ShowAboutDialog title={frame.m_aboutTitle} onClose={() => setAboutOpen(false)} />
      )}
      {prefsOpen !== null &&
        app.Preferences(prefsOpen.page, prefsOpen.parent, () => setPrefsOpen(null))}
    </div>
  );
}
