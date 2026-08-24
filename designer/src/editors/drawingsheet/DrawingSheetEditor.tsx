// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor frame, the web mirror of `pl_editor`'s
 * PL_EDITOR_FRAME (pagelayout_editor/pl_editor_frame.cpp): the menu bar
 * (menubar.cpp), the top / left / right toolbars with the origin and page
 * selectors (toolbars_pl_editor.cpp), the docked properties panel
 * (dialogs/properties_frame.cpp, see PropertiesFrame), the design inspector
 * (dialogs/design_inspector.cpp, see DesignInspector), the page-preview
 * settings dialog (PageSettingsDialog), the canvas with its interactive tools
 * (DrawingSheetCanvas), and the two status-bar rows with the origin-relative
 * coordinate readout (PL_EDITOR_FRAME::UpdateStatusBar).
 *
 * The document is a `WksSheet`; File → New loads the default stationery, and
 * Open / Save read and write `.kicad_wks`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  defaultDrawingSheet,
  parseDrawingSheet,
  serializeDrawingSheet,
  layoutDrawingSheet,
  translateItem,
  wksItemMsgPanelInfo,
  ellipsizeStatusText,
  statusTextWidth,
  mmToIU,
  iuToMM,
  SCH_IU_PER_MM,
  type WksSheet,
  type WksItem,
  type WksCorner,
  type WksPoint,
  type WksLine,
  type WksRect,
  type WksResolveContext,
  pageSizeDisplayMM,
} from '@ziroeda/common';
import type { Vec2 } from '@ziroeda/kimath';
import { Combo, type ComboOption } from '../../ui/Combo.js';
import { MenuBar, ContextMenu, type Menu, type MenuItem } from '../../ui/MenuBar.js';

/** m_pageSelectBox (pl_editor_frame.cpp): page 1 versus every other page. */
const PAGE_NUMBER_CHOICES: readonly ComboOption[] = [
  { value: '1', label: 'Page 1' },
  { value: '2', label: 'Other pages' },
];
import { Toolbar } from '../../ui/Toolbar.js';
import {
  FRAME_TITLE_SEPARATOR,
  formatTitle,
  frameTitleName,
  useDocumentTitle,
} from '../../ui/useDocumentTitle.js';
import { useUnsavedGuard } from '../../ui/useUnsavedGuard.js';
import { KiStatusBar } from '../../ui/KiStatusBar.js';
import { MsgPanel, type MsgPanelItem } from '../../ui/MsgPanel.js';
import { measureTextWidth } from '../../ui/text_ctrl_width.js';
import {
  formatG,
  gridMsg,
  messageTextFromValue,
  unitText,
  zoomFactorForScale,
  zoomMsg,
} from '../../ui/status_format.js';
import { DS_TOP_TOOLBAR, DS_LEFT_TOOLBAR, DS_RIGHT_TOOLBAR } from './drawingSheetToolbars.js';
import { buildDsContextMenu } from './ds_context_menu.js';
import { DEFAULT_GRID_INDEX, GRID_SIZE_LIST, gridSizeToMM } from '../../ui/grid_settings.js';
import { DrawingSheetCanvas, type DrawingSheetCanvasController } from './DrawingSheetCanvas.js';
import { PropertiesFrame, SyntaxHelpDialog } from './PropertiesFrame.js';
import { DockSash } from '../../ui/DockSash.js';
import { dockedPaneWidth } from '../../ui/dock_sash.js';
import { SaveAsDialog } from '../../fs/SaveAsDialog.js';
import { leafOf, savePathWithExtension } from '../../fs/save_path.js';
import { OpenFileDialog } from '../../fs/OpenFileDialog.js';
import { drawingSheetWildcard } from '../../fs/wildcards.js';
import { DesignInspector } from './DesignInspector.js';
import { MessageDialogError } from '../../ui/dialog_message.js';
import { UnsavedChangesDialog } from '../../ui/dialog_unsaved_changes.js';
import { handleUnsavedChanges, type UnsavedChangesResult } from '../../ui/confirm.js';
import { dsInspectorTitle } from './design_inspector.js';
import {
  PageSettingsDialog,
  previewPageMM,
  paperDescription,
  type PreviewSettings,
} from './PageSettingsDialog.js';
import { previewSettingsFromConfig, writePageToConfig } from './preview_settings.js';
import { imageFileToPng, decodeImageMeta } from '@ziroeda/common';
import { drawDrawingSheetItems, DS_PRINT_PAPER_COLOR } from '@ziroeda/common';
import '../../ui/shell.css';
import { standardHelpMenu } from '../../ui/help_menu.js';
import { showHotkeyList } from '../../ui/hotkey_list_action.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import {
  FileHistory,
  MISSING_FILE_EXTENDED,
  missingFileMessage,
  openRecentMenuItem,
} from '../../ui/file_history.js';
import { useFileHistory } from '../../ui/useFileHistory.js';
import { setLanguageMenuItem } from '../../ui/language_menu.js';
import { addClose, addQuit } from '../../ui/action_menu.js';
import { browserSafeKey } from '../../ui/browser_reserved.js';
import { dispatchMenuHotkey, focusBlocksHotkey } from '../../ui/menu_hotkeys.js';
import { wasBrowserSuppressed, type FocusLike } from '../../ui/browser_hotkeys.js';
import { PL_EDITOR_DEFAULTS, settings } from '../../prefs/settings.js';
import { useCommonSettings } from '../../prefs/useSettings.js';
import {
  applyToggle,
  persistToggle,
  switchUnits,
  toggleUnitsId,
  togglesFromSettings,
} from './toggles.js';
import { DRAWING_SHEET_FILE_EXTENSION } from '@ziroeda/common/src/common.js';

export interface DrawingSheetEditorFile {
  name: string;
  text: string;
}

/**
 * PL_EDITOR_SETTINGS `properties_frame_width` (pl_editor_settings.cpp:46).
 *
 * [data] KiCad hardcodes this in its own parameter table, and it is the Props
 * pane's *best* size, not its size: `pl_editor_frame.cpp:200-204` adds the pane
 * with `.BestSize( m_propertiesFrameWidth, -1 )` floored by
 * `.MinSize( m_propertiesPagelayout->GetMinSize() )`, so wxAUI shows whichever
 * of the two is larger and the width is really the panel's own content. The
 * `200` at pl_editor_frame.cpp:97 is only the ctor's seed — `LoadSettings`
 * overwrites it from the setting at :538 before the pane is ever laid out.
 *
 * The CSS counterpart of the MinSize floor is `min-width: min-content` on
 * `.ze-leftdock.on-right`; this is the BestSize half.
 */
/**
 * `PL_EDITOR_SETTINGS::m_PropertiesFrameWidth` — the pane's BestSize.
 *
 *     m_PropertiesFrameWidth = 150;
 *     new PARAM<int>( "properties_frame_width", &m_PropertiesFrameWidth, 150 )
 *                                       pagelayout_editor/pl_editor_settings.cpp:38,46
 *
 * 150 and NOT the 200 in `PL_EDITOR_FRAME`'s constructor initialiser list
 * (`pl_editor_frame.cpp:97`): `LoadSettings` overwrites it with the setting
 * before the pane is ever built (`:538`), so 200 is only what the member holds
 * for the few lines before the config is read. Exactly the shape of the units
 * default, which was nearly "fixed" the same wrong way.
 *
 * The number itself is no longer written here: it is that parameter's default,
 * and it lives with the rest of `pl_editor.json` in `prefs/settings.ts`. What
 * this name still means is "the width a pane with no stored setting opens at",
 * which is the floor `dockedPaneWidth` measures the panel's content against.
 */
const PROPERTIES_FRAME_WIDTH = PL_EDITOR_DEFAULTS.properties_frame_width;

/** The centre pane's floor — how much canvas the sash has to leave behind. */
const CANVAS_MIN_WIDTH = 200;

/*
 * The unit group, the launch defaults and the reducer that used to sit here now
 * live in `./toggles.ts`, alongside the mapping between a button and the
 * `pl_editor.json` field behind it. They moved for the reason GerbView's did:
 * `qa` has no DOM, so a rule inside a `.tsx` cannot be exercised at all.
 */

/** The 5 status-bar coordinate origins (PL_EDITOR_FRAME::m_originChoiceList). */
const ORIGIN_CHOICES = [
  'Left Top paper corner',
  'Right Bottom page corner',
  'Left Bottom page corner',
  'Right Top page corner',
  'Left Top page corner',
];

/**
 * PL_EDITOR_FRAME's `m_fileHistory`, allocated once the way
 * `EDA_BASE_FRAME::LoadSettings` (eda_base_frame.cpp:1282-1286) allocates it.
 * This file used to carry a private copy of the store — cap 5, dedupe by name
 * — that had drifted from the Image Converter's private copy of the same idea;
 * both are now the shared `ui/file_history.ts` port.
 */
interface RecentFile {
  name: string;
  text: string;
}
const recentFiles = new FileHistory<RecentFile>({
  storageKey: 'ziroeda.drawingsheet.recent',
  maxFiles: settings.common.system.file_history_size,
});

const download = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

/** Backfill decoded pixel size + DPI for bitmaps loaded from a file. */
async function backfillBitmapMeta(sheet: WksSheet): Promise<WksSheet> {
  if (!sheet.items.some((it) => it.type === 'bitmap' && it.pngB64 && !(it.pxW && it.pxW > 0)))
    return sheet;
  const items = await Promise.all(
    sheet.items.map(async (it) => {
      if (it.type !== 'bitmap' || !it.pngB64 || (it.pxW && it.pxW > 0)) return it;
      try {
        const { w, h, ppi } = await decodeImageMeta(it.pngB64);
        return { ...it, pxW: w, pxH: h, ppi };
      } catch {
        return it;
      }
    }),
  );
  return { ...sheet, items };
}

/** A fresh item-base for newly placed items (AddDrawingSheetItem defaults). */
const NEW_BASE = {
  name: '',
  option: 'normal' as const,
  repeat: 1,
  incrx: 0,
  incry: 0,
  incrlabel: 1,
  comment: '',
};

export function DrawingSheetEditor({
  onExitToHome,
  projectName,
  onSaveToProject,
  openRequest,
}: {
  onExitToHome: () => void;
  projectName?: string;
  /** Save the current sheet into the open project as a `.kicad_wks`. Absent
   *  when no project is open (the menu item is then hidden). */
  /** Write the sheet at this full account path — see `writeSheet`. */
  onSaveToProject?: (path: string, text: string) => void;
  /** A `.kicad_wks` the project manager double-clicked to open here; re-sent with
   *  a fresh nonce so the resident editor re-opens on the newly-picked file. */
  openRequest?: { name: string; text: string; nonce: number } | null;
}): JSX.Element {
  const [sheet, setSheet] = useState<WksSheet>(() => defaultDrawingSheet());
  /** Lets `save` fall through to `saveAs`, which is declared after it. */
  const saveAsRef = useRef<(() => void) | null>(null);

  /**
   * `GetCurrentFileName()`, and it starts EMPTY.
   *
   * pl_editor draws its default page from the moment it opens, but that is not
   * a loaded document: `UpdateTitleAndInfo` prints `[no drawing sheet loaded]`
   * whenever the name is empty (`pl_editor_frame.cpp:575-585`), and a live
   * KiCad with nothing opened shows exactly that in its title bar. Ours seeded
   * this with `drawing_sheet.kicad_wks`, so the frame claimed a file that was
   * never opened and the placeholder branch — which is written and correct —
   * could never run.
   *
   * An empty name is a working state, not a hole: Save turns itself into Save
   * As when there is no name (`files.cpp:105`), which is what the callback
   * below does.
   */
  const [fileName, setFileName] = useState('');
  const [dirty, setDirty] = useState(false);
  const undoStack = useRef<WksSheet[]>([]);
  const redoStack = useRef<WksSheet[]>([]);

  const [selectionRaw, setSelectionRaw] = useState<ReadonlySet<number>>(new Set());
  const selection = selectionRaw;
  /**
   * Every selection change goes through here, which is what marks the message
   * panel as seeded — upstream's `UpdateMsgPanelInfo` is called from the
   * selection handlers and from nowhere else.
   */
  const setSelection = useCallback((next: React.SetStateAction<ReadonlySet<number>>) => {
    setSelectionSeen(true);
    setSelectionRaw(next);
  }, []);
  const [activeTool, setActiveTool] = useState('select');
  /**
   * `setupUnits( config() )` (pl_editor_frame.cpp:216) and the grid/cursor half
   * of `LoadSettings`: the buttons a frame opens with are read off
   * `pl_editor.json`, not hardcoded.
   */
  const [toggles, setToggles] = useState<Set<string>>(() => togglesFromSettings(settings.plEditor));
  /**
   * The preview title block starts EMPTY, including the title.
   *
   * `DIALOG_PAGES_SETTINGS` fills its fields from `m_parent->GetTitleBlock()`
   * (`dialog_page_settings.cpp:72, 155-163`), and pl_editor's is
   * `m_pageLayout.GetTitleBlock()` — a default-constructed TITLE_BLOCK that
   * nothing ever seeds (`pl_editor_frame.cpp:625-634`). A fresh pl_editor
   * therefore opens Preview Settings with every field blank; ours put the
   * project name in Title, which is not a value upstream has anywhere.
   */
  const [preview, setPreview] = useState<PreviewSettings>(() =>
    previewSettingsFromConfig(settings.plEditor),
  );
  /**
   * `m_pageSelectBox` (pl_editor_frame.h:273). Session state: `OnSelectPage`
   * (pl_editor_frame.cpp:461-467) writes it nowhere, and no parameter binds
   * it, so a restart always comes back on Page 1.
   */
  const [pageNumber, setPageNumber] = useState(1); // 1 = "Page 1", 2 = "Other pages"
  /** `corner_origin` -> `m_originSelectChoice` (pl_editor_frame.cpp:539, :561). */
  const [originChoice, setOriginChoice] = useState(settings.plEditor.corner_origin);
  /**
   * The Properties pane's width, and the two bounds the sash respects.
   *
   * wxAUI gives a `.Palette()` pane a sash for free, which is why no frame
   * upstream writes one and why ours had none: the pane was a fixed 150 px
   * strip. `MinSize( m_propertiesPagelayout->GetMinSize() )`
   * (`pl_editor_frame.cpp:203`) is the panel's own content minimum, so it is
   * measured off the live panel rather than picked — the same way GerbView's
   * layers pane does it.
   *
   * The width itself is `properties_frame_width`, captured off the live pane in
   * `SaveSettings` (pl_editor_frame.cpp:558-560) and fed back as the pane's
   * `BestSize` in the constructor (:204).
   */
  const [propsWidth, setPropsWidth] = useState(settings.plEditor.properties_frame_width);
  const [propsMin, setPropsMin] = useState(PROPERTIES_FRAME_WIDTH);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** The message panel, which is what a status row is measured against. */
  const msgPanelRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = propsRef.current?.firstElementChild;
    if (!(el instanceof HTMLElement)) return;
    // `scrollWidth` is what the content needs when the box is narrower than it,
    // which is the browser's answer to the question wx answers with a sizer's
    // GetMinSize(). Floored at the BestSize so a panel that happens to lay out
    // narrow cannot drag the minimum below what the frame opens at.
    const min = Math.ceil(el.scrollWidth);
    if (min <= 0) return;
    // wxAUI shows whichever of BestSize and MinSize is larger, so the pane
    // OPENS at the wider of the two. We had only the BestSize half, so it
    // opened at 150 and clipped its own value column, vertical-justify buttons
    // and text-colour swatch until the sash was dragged out.
    const floor = dockedPaneWidth(PROPERTIES_FRAME_WIDTH, min);
    setPropsMin(floor);
    setPropsWidth((w) => Math.max(w, floor));
  }, []);
  const [localOrigin, setLocalOrigin] = useState<Vec2>({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [scale, setScale] = useState(0);
  /**
   * Status pane 0, empty at startup.
   *
   * A live pl_editor with nothing loaded shows an empty message pane — it is
   * written on a file load, not on the default page appearing. Ours announced
   * "Loaded default drawing sheet", which claims an event that never happened.
   */
  const [status, setStatus] = useState('');
  /** Whether a selection change has happened — see the message panel below. */
  const [selectionSeen, setSelectionSeen] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  /**
   * `grid.last_size_idx` into `DefaultGridSizeList()`'s pl_editor row
   * (app_settings.cpp:468-481, ui/grid_settings.ts). A WINDOW setting, not a
   * unit-derived one — see the gridLabel comment below — and now settable, from
   * the canvas context menu's Grid submenu.
   *
   * `SaveSettings` never writes it: `COMMON_TOOLS::GridPreset` takes an `int&`
   * straight into the settings object (common_tools.cpp:536) and mutates it in
   * place, which is what carries the choice across a restart.
   */
  const [gridIndex, setGridIndexRaw] = useState(settings.plEditor.window.grid.last_size_idx);
  const setGridIndex = useCallback((idx: number) => {
    setGridIndexRaw(idx);
    settings.updatePlEditor((s) => {
      s.window.grid.last_size_idx = idx;
    });
  }, []);
  /** Where the canvas context menu was opened, or null when it is closed. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  /** DisplayErrorMessage's text when Print cannot open its preview window. */
  const [printError, setPrintError] = useState<string | null>(null);
  /**
   * `black_background` -> `SetDrawBgColor( cfg->m_BlackBackground ? BLACK : WHITE )`
   * (pl_editor_frame.cpp:541), written back at :562.
   */
  const [blackBackground, setBlackBackgroundRaw] = useState(settings.plEditor.black_background);
  const setBlackBackground = useCallback((on: boolean) => {
    setBlackBackgroundRaw(on);
    settings.updatePlEditor((s) => {
      s.black_background = on;
    });
  }, []);
  const [showInspector, setShowInspector] = useState(false);
  const [showPageDialog, setShowPageDialog] = useState(false);
  const [showSyntaxHelp, setShowSyntaxHelp] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const recent = useFileHistory(recentFiles);
  const common = useCommonSettings();

  const controller = useRef<DrawingSheetCanvasController>(null);
  const bitmapInputRef = useRef<HTMLInputElement>(null);
  const pendingBitmapPos = useRef<WksPoint | null>(null);
  // Index of the two-click item currently being drawn, or null.
  const drawingIndex = useRef<number | null>(null);
  // One undo push per point-editor drag.
  const pointDragUndoPushed = useRef(false);
  // Internal clipboard for Edit → Cut / Copy / Paste.
  const clipboard = useRef<WksItem[]>([]);

  // Title-block display mode: normal (resolved) vs edit (raw ${…} tokens).
  const editMode = toggles.has('layoutEditMode');

  // ---- page geometry ----
  const pageMM = useMemo(() => previewPageMM(preview), [preview]);
  const pageW = mmToIU(pageMM[0]);
  const pageH = mmToIU(pageMM[1]);

  // ---- title-block resolve context (fed by the Page Settings preview data) ----
  const resolveCtx = useMemo<WksResolveContext>(
    () => ({
      pageNumber,
      sheetCount: pageNumber > 1 ? 2 : 1,
      title: preview.title,
      rev: preview.rev,
      date: preview.date,
      company: preview.company,
      comments: preview.comments,
      paper: preview.paper,
      fileName,
      sheetPath: '/',
      appVersion: 'ZiroEDA',
      rawText: editMode,
    }),
    [pageNumber, preview, fileName, editMode],
  );

  const draws = useMemo(
    () => layoutDrawingSheet(sheet, { widthMM: pageMM[0], heightMM: pageMM[1] }, resolveCtx),
    [sheet, pageMM, resolveCtx],
  );

  // ---- undoable commit ----
  const commit = useCallback((next: WksSheet, description: string) => {
    setSheet((prev) => {
      undoStack.current.push(prev);
      redoStack.current = [];
      return next;
    });
    setDirty(true);
    setStatus(description);
  }, []);

  /** Push the current sheet on the undo stack without changing it (in-flight edits). */
  const pushUndo = useCallback(() => {
    setSheet((cur) => {
      undoStack.current.push(cur);
      redoStack.current = [];
      return cur;
    });
    setDirty(true);
  }, []);

  /** Silent update used while dragging (no extra undo entries). */
  const updateSheet = useCallback((fn: (cur: WksSheet) => WksSheet) => {
    setSheet(fn);
  }, []);

  const undo = useCallback(() => {
    setSheet((cur) => {
      const p = undoStack.current.pop();
      if (!p) return cur;
      redoStack.current.push(cur);
      return p;
    });
    setSelection(new Set());
    drawingIndex.current = null;
  }, []);
  const redo = useCallback(() => {
    setSheet((cur) => {
      const n = redoStack.current.pop();
      if (!n) return cur;
      undoStack.current.push(cur);
      return n;
    });
    setSelection(new Set());
  }, []);

  // ---- file ops ----
  // EDA_BASE_FRAME::UpdateFileHistory.
  const addRecent = useCallback((name: string, text: string) => {
    recentFiles.addFileToHistory({ name, text });
  }, []);

  /**
   * `PL_EDITOR_FRAME::Files_io( wxID_NEW )` (files.cpp:123-128), which is four
   * calls:
   *
   *     pglayout.AllowVoidList( true );
   *     SetCurrentFileName( wxEmptyString );
   *     pglayout.ClearList();
   *     OnNewDrawingSheet();
   *
   * The first two are the ones we had backwards. `ClearList` empties the item
   * list and `AllowVoidList( true )` is what lets it STAY empty - the flag is
   * false by default and means "if the list is void, load the default sheet"
   * (`m_allowVoidList`, ds_data_model.h:188). So a new drawing sheet in a live
   * pl_editor is a blank page: no border, no title block, nothing. Ours loaded
   * `defaultDrawingSheet()` instead, which is the sheet the editor OPENS with,
   * not the one New makes.
   *
   * `SetCurrentFileName( wxEmptyString )` is why the title bar then reads
   * `[no drawing sheet loaded]`. We set `drawing_sheet.kicad_wks`, so the frame
   * claimed a file New had not created.
   *
   * The SETUP survives: `ClearList` deletes the items and touches nothing else,
   * so the margins and default text sizes are still whatever the model held.
   *
   * `OnNewDrawingSheet` (pl_editor_frame.cpp:906-928) is the rest - clear the
   * undo list, drop the modified flag, blank the properties page (which an
   * empty selection does here), update the title, and zoom to fit.
   */
  const newSheet = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setSheet((s) => ({ ...s, items: [] }));
    setSelection(new Set());
    setDirty(false);
    setFileName('');
    setStatus('New drawing sheet');
    requestAnimationFrame(() => controller.current?.zoomToFit());
  }, []);

  const openText = useCallback(
    async (name: string, text: string) => {
      try {
        const parsed = await backfillBitmapMeta(parseDrawingSheet(text));
        undoStack.current = [];
        redoStack.current = [];
        setSheet(parsed);
        setSelection(new Set());
        setDirty(false);
        setFileName(name);
        setStatus(`Opened ${name} (${parsed.items.length} items)`);
        addRecent(name, text);
        requestAnimationFrame(() => controller.current?.zoomToFit());
      } catch (err) {
        setStatus(`Failed to open ${name}: ${(err as Error).message}`);
      }
    },
    [addRecent],
  );

  /**
   * EDA_BASE_FRAME::GetFileFromHistory (eda_base_frame.cpp:1486-1523). A row
   * whose file is gone gets the "File '%s' was not found." dialog with the
   * Remove / Keep buttons and opens nothing either way; ours holds the sheet
   * text itself, so "gone" is an entry that lost its payload in storage. The
   * dialog is a window.confirm until the KICAD_MESSAGE_DIALOG port lands.
   */
  const openRecent = useCallback(
    async (index: number) => {
      const r = recentFiles.getFileFromHistory(index, {
        exists: (e) => e.text.length > 0,
        confirmRemove: (e) =>
          window.confirm(`${missingFileMessage(e.name)}\n${MISSING_FILE_EXTENDED}`),
      });
      if (r) await openText(r.name, r.text);
    },
    [openText],
  );

  // Open the .kicad_wks the project manager double-clicked (a fresh nonce each
  // activation re-opens even while the editor stays resident).
  const openReqNonce = openRequest?.nonce;
  useEffect(() => {
    if (!openRequest) return;
    const base = openRequest.name.split(/[\\/]/).pop() ?? openRequest.name;
    void openText(base, openRequest.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReqNonce]);

  const appendText = useCallback(
    async (name: string, text: string) => {
      try {
        const parsed = await backfillBitmapMeta(parseDrawingSheet(text));
        commit(
          { ...sheet, items: [...sheet.items, ...parsed.items] },
          `Appended ${parsed.items.length} items from ${name}`,
        );
      } catch (err) {
        setStatus(`Failed to append ${name}: ${(err as Error).message}`);
      }
    },
    [sheet, commit],
  );

  /**
   * `SaveDrawingSheetFile( filename )` — ONE path, the one the dialog returned
   * (pagelayout_editor/files.cpp:215), and the status line names that whole
   * path: `File '%s' saved.` (:230).
   *
   * `aPath` is a full account path — `/Templates/frame.kicad_wks`, or
   * `/MyBoard/frame.kicad_wks`. It used to be a bare leaf, which is why a sheet
   * saved into Templates landed in the open project instead, or downloaded when
   * there was no project: the directory the person had just picked was thrown
   * away one line after the chooser handed it over.
   */
  const writeSheet = useCallback(
    (aPath: string, note = 'Saved') => {
      const text = serializeDrawingSheet(sheet);
      if (onSaveToProject) onSaveToProject(aPath, text);
      else download(leafOf(aPath), text);
      addRecent(aPath, text);
      setDirty(false);
      setStatus(`${note} ${aPath}`);
    },
    [sheet, addRecent, onSaveToProject],
  );

  // `if( filename.IsEmpty() && id == wxID_SAVE ) id = wxID_SAVEAS;`
  // (`pagelayout_editor/files.cpp:105`). Declared below `saveAs` in the source
  // order upstream uses, but the dependency runs the other way, so it is read
  // through a ref-free forward call.
  const save = useCallback(() => {
    if (!fileName) {
      saveAsRef.current?.();
      return;
    }
    writeSheet(fileName);
  }, [writeSheet, fileName]);

  /**
   * Save As opens the file manager, not a browser prompt.
   *
   * Upstream this is a `wxFileDialog` with wxFD_SAVE | wxFD_OVERWRITE_PROMPT on
   * the project directory, filtered by DrawingSheetFileWildcard. A
   * `window.prompt` cannot show the tree, cannot filter, cannot warn about an
   * overwrite, and hands back a bare name rather than a path — so nothing saved
   * from here could land anywhere but the root.
   */
  /**
   * Open, over the project store rather than the OS file manager.
   *
   * `PL_EDITOR_FRAME::Files_io` opens a `wxFileDialog` on the project
   * directory filtered by DrawingSheetFileWildcard (files.cpp:159-167). Ours
   * clicked a hidden `<input type="file">`, which can only see the local disk
   * - so a sheet saved into the account's project could not be re-opened from
   * inside the editor at all.
   *
   * `append` is the same dialog for `Append Existing Drawing Sheet...`, which
   * upstream is a second wxFileDialog with the same wildcard.
   */
  const [openDlg, setOpenDlg] = useState<null | 'open' | 'append'>(null);

  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const saveAs = useCallback(() => setSaveAsOpen(true), []);

  /**
   * `Files_io`'s guard on the two commands that throw the sheet away:
   *
   *     if( ( id == wxID_NEW || id == wxID_OPEN ) && IsContentModified() )
   *         if( !HandleUnsavedChanges( this, _( "The current drawing sheet has
   *                                     been modified. Save changes?" ),
   *                                    [&]() { return saveCurrentPageLayout(); } ) )
   *             return;
   *
   * (pagelayout_editor/files.cpp:106-118.) New and Open only - `Append
   * Existing Drawing Sheet` is not in that condition, because it ADDS to the
   * sheet and destroys nothing.
   *
   * We had New and Open discarding a modified sheet silently, which is the
   * shape `ui/confirm.ts` warns about: a two-answer prompt, or none at all,
   * offers no way to KEEP the work. The three-answer dialog is already shared -
   * cvpcb raises the same one - so this is a wiring, not a new widget.
   */
  const [unsavedFor, setUnsavedFor] = useState<null | 'new' | 'open'>(null);

  /**
   * The command `HandleUnsavedChanges` is holding while a Save As runs.
   *
   * Upstream `saveCurrentPageLayout` shows Save As MODALLY and can therefore
   * answer "did it save?" on the spot. Ours cannot block, so the answer arrives
   * later, in `onSaveAsDone` - which is where this is read.
   */
  const pendingAfterSave = useRef<null | 'new' | 'open'>(null);
  const runAfterSaveRef = useRef<(() => void) | null>(null);
  const onSaveAsDone = useCallback(
    (path: string | null, placeId?: string) => {
      setSaveAsOpen(false);
      if (path === null) {
        // wxID_CANCEL. The sheet is still modified, so `saveCurrentPageLayout`
        // is false and anything waiting on it is dropped rather than run.
        pendingAfterSave.current = null;
        return;
      }
      // The chooser hands back a full path, and upstream keeps the full path:
      // `filename = openFileDialog.GetPath()`, the extension is appended to
      // THAT, `SaveDrawingSheetFile( filename )` takes it and
      // `SetCurrentFileName( filename )` stores it
      // (pagelayout_editor/files.cpp:213-233). Only the title strips it down,
      // through `wxFileName::GetName()`.

      // `EnsureFileExtension` (common/common.cpp:662-678), which pl_editor's
      // own Save As runs on the returned path (files.cpp:213-215). The field is
      // NOT locked and upstream does not nag - "Just fix it, but be careful not
      // to destroy existing after-dot-text that isn't actually a bad extension,
      // such as Schematic_1.1", says the comment there. So the extension is
      // APPENDED when what follows the last dot is not it, never replaced.
      //
      // This was a local `/\.kicad_wks$/i` test, which is the shared function
      // written out again per editor - and not the same function: a name ending
      // in a bare dot came out `foo..kicad_wks`, where upstream gives
      // `foo.kicad_wks`.
      const finalPath = savePathWithExtension(path, DRAWING_SHEET_FILE_EXTENSION);
      setFileName(finalPath);

      // `SaveDrawingSheetFile( filename )` — one path, the one the dialog gave
      // back (pagelayout_editor/files.cpp:215-232). A sheet belongs in the
      // project: DIALOG_PAGES_SETTINGS records one by embedding it in the
      // project or by a project-RELATIVE path, and only falls back to an
      // env-var reference outside it (dialog_page_settings.cpp:738-756). It is
      // a project tree file type too (kicad/tree_file_type.h:61).
      writeSheet(finalPath);
      // `saveCurrentPageLayout` returns `!IsContentModified()`, and this is the
      // moment that becomes true. Whatever New-or-Open was waiting on the save
      // now goes ahead; a cancel above left it un-run, which is
      // `HandleUnsavedChanges` returning false and `Files_io` returning.
      runAfterSaveRef.current?.();
    },
    [writeSheet],
  );
  saveAsRef.current = saveAs;

  /** The `switch( id )` body, once the guard above has let it through. */
  const runFileCommand = useCallback(
    (what: 'new' | 'open') => {
      if (what === 'new') newSheet();
      else setOpenDlg('open');
    },
    [newSheet],
  );

  /** `Files_io` itself: ask first when the sheet is modified, then dispatch. */
  const requestFileCommand = useCallback(
    (what: 'new' | 'open') => {
      if (dirty) setUnsavedFor(what);
      else runFileCommand(what);
    },
    [dirty, runFileCommand],
  );

  /** The answer, through the shared `HandleUnsavedChanges` rule. */
  const answerUnsavedChanges = useCallback(
    (result: UnsavedChangesResult) => {
      const what = unsavedFor;
      setUnsavedFor(null);
      if (!what) return;

      const proceed = handleUnsavedChanges(result, () => {
        // `saveCurrentPageLayout` runs Save, and Save becomes Save As when the
        // sheet has never had a name (files.cpp:103-104). Only that second path
        // is deferred; a sheet that has a name is written here and now.
        if (!fileName) {
          pendingAfterSave.current = what;
          saveAsRef.current?.();
          return false;
        }
        writeSheet(fileName);
        return true;
      });

      if (proceed) runFileCommand(what);
    },
    [unsavedFor, fileName, writeSheet, runFileCommand],
  );

  runAfterSaveRef.current = () => {
    const what = pendingAfterSave.current;
    pendingAfterSave.current = null;
    if (what) runFileCommand(what);
  };

  /** Print the sheet: render the page alone to a bitmap and print that. */
  const printSheet = useCallback(() => {
    const scalePx = 2480 / pageW; // ~300 DPI for an A4-wide page
    const cv = document.createElement('canvas');
    cv.width = Math.round(pageW * scalePx);
    cv.height = Math.round(pageH * scalePx);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = DS_PRINT_PAPER_COLOR;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scalePx, 0, 0, scalePx, 0, 0);
    drawDrawingSheetItems(ctx, draws, new Set(), { minWidth: 1 / scalePx });
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
      // `window.open` returns null when the popup is blocked, and this used to
      // `return` on it: Print then did nothing and reported nothing, which is
      // the worst of the three outcomes. The system print dialog KiCad opens
      // (DIALOG_PRINT_GENERIC via PL_EDITOR_FRAME's ACTIONS::print) is
      // genuinely out of reach in a browser; failing silently is not.
      //
      // DisplayErrorMessage (common/confirm.cpp) is what upstream raises when
      // a command cannot proceed, and it is the shared ui/dialog_message.tsx
      // component here.
      setPrintError(
        'Print could not open the preview window.\n\n' +
          'Your browser blocked the pop-up. Allow pop-ups for this site and try again.',
      );
      return;
    }
    w.document.write(
      `<title>${fileName}</title><img src="${cv.toDataURL('image/png')}" style="width:100%" onload="window.print()">`,
    );
    w.document.close();
  }, [draws, pageW, pageH, fileName]);

  // ---- placement: page-space IU point → anchored mm point ----
  const anchoredPoint = useCallback(
    (p: Vec2, corner: WksCorner): WksPoint => {
      const s = sheet.setup;
      const left = s.leftMargin,
        top = s.topMargin;
      const right = pageMM[0] - s.rightMargin,
        bottom = pageMM[1] - s.bottomMargin;
      const px = iuToMM(p.x),
        py = iuToMM(p.y);
      const round = (n: number): number => Math.round(n * 1000) / 1000;
      switch (corner) {
        case 'ltcorner':
          return { corner, x: round(px - left), y: round(py - top) };
        case 'rtcorner':
          return { corner, x: round(right - px), y: round(py - top) };
        case 'lbcorner':
          return { corner, x: round(px - left), y: round(bottom - py) };
        default:
          return { corner, x: round(right - px), y: round(bottom - py) };
      }
    },
    [sheet.setup, pageMM],
  );

  /** Anchored mm point → page-space IU (for the point-editor handles). */
  const anchoredToIU = useCallback(
    (p: WksPoint): Vec2 => {
      const s = sheet.setup;
      const left = s.leftMargin,
        top = s.topMargin;
      const right = pageMM[0] - s.rightMargin,
        bottom = pageMM[1] - s.bottomMargin;
      switch (p.corner) {
        case 'ltcorner':
          return { x: mmToIU(left + p.x), y: mmToIU(top + p.y) };
        case 'rtcorner':
          return { x: mmToIU(right - p.x), y: mmToIU(top + p.y) };
        case 'lbcorner':
          return { x: mmToIU(left + p.x), y: mmToIU(bottom - p.y) };
        default:
          return { x: mmToIU(right - p.x), y: mmToIU(bottom - p.y) };
      }
    },
    [sheet.setup, pageMM],
  );

  // ---- drawing tools (first click creates, motion drags, second finishes) ----
  const onDrawFirst = useCallback(
    (tool: string, at: Vec2) => {
      const pos = anchoredPoint(at, 'rbcorner');
      const item: WksLine | WksRect = {
        type: tool === 'dsAddLine' ? 'line' : 'rect',
        ...NEW_BASE,
        start: pos,
        end: pos,
        lineWidth: 0,
      };
      pushUndo();
      updateSheet((cur) => {
        drawingIndex.current = cur.items.length;
        return { ...cur, items: [...cur.items, item] };
      });
      setSelection(new Set()); // selected only once placed
    },
    [anchoredPoint, pushUndo, updateSheet],
  );

  const onDrawMove = useCallback(
    (at: Vec2) => {
      const idx = drawingIndex.current;
      if (idx === null) return;
      const end = anchoredPoint(at, 'rbcorner');
      updateSheet((cur) => {
        const items = cur.items.slice();
        const it = items[idx];
        if (!it || (it.type !== 'line' && it.type !== 'rect')) return cur;
        items[idx] = { ...it, end };
        return { ...cur, items };
      });
    },
    [anchoredPoint, updateSheet],
  );

  const onDrawSecond = useCallback(
    (at: Vec2) => {
      const idx = drawingIndex.current;
      drawingIndex.current = null;
      if (idx === null) return;
      onDrawMove(at);
      drawingIndex.current = null;
      setSelection(new Set([idx]));
      setDirty(true);
      setStatus('Item placed');
      // The tool stays active for the next placement, as upstream does.
    },
    [onDrawMove],
  );

  const cancelDrawing = useCallback(() => {
    if (drawingIndex.current === null) return;
    drawingIndex.current = null;
    undo(); // roll back the in-flight item
  }, [undo]);

  // ---- one-click tools ----
  const addItem = useCallback(
    (item: WksItem, description: string) => {
      const next = { ...sheet, items: [...sheet.items, item] };
      commit(next, description);
      setSelection(new Set([next.items.length - 1]));
    },
    [sheet, commit],
  );

  const onPlacePoint = useCallback(
    (tool: string, at: Vec2) => {
      const pos = anchoredPoint(at, 'rbcorner');
      if (tool === 'dsAddText') {
        addItem(
          {
            type: 'text',
            ...NEW_BASE,
            text: 'Text',
            pos,
            fontW: 0,
            fontH: 0,
            bold: false,
            italic: false,
            lineWidth: 0,
            hjustify: 'left',
            vjustify: 'center',
            rotate: 0,
            maxlen: 0,
            maxheight: 0,
          },
          'Add text',
        );
      } else if (tool === 'dsAddBitmap') {
        // Place → Image opens a file dialog; capture the anchor and prompt.
        pendingBitmapPos.current = pos;
        bitmapInputRef.current?.click();
      }
    },
    [anchoredPoint, addItem],
  );

  // Create a bitmap item from any image File, used by Place → Image, by pasting
  // an image, and by images the Image Converter puts on the clipboard.
  const addBitmapFromFile = useCallback(
    async (file: File, pos: WksPoint) => {
      try {
        const { b64, pxW, pxH, ppi } = await imageFileToPng(file);
        addItem(
          { type: 'bitmap', ...NEW_BASE, pos, scale: 1, pngB64: b64, ppi, pxW, pxH },
          `Add image (${file.name || 'pasted image'})`,
        );
      } catch (err) {
        setStatus(`Failed to load image: ${(err as Error).message}`);
      }
    },
    [addItem],
  );

  const centreOrCursorPoint = useCallback(
    (): WksPoint => anchoredPoint(cursor ?? { x: pageW / 2, y: pageH / 2 }, 'rbcorner'),
    [anchoredPoint, cursor, pageW, pageH],
  );

  const onPickBitmap = useCallback(
    async (file: File) => {
      const pos = pendingBitmapPos.current ?? centreOrCursorPoint();
      pendingBitmapPos.current = null;
      await addBitmapFromFile(file, pos);
    },
    [addBitmapFromFile, centreOrCursorPoint],
  );

  // ---- selection edits ----
  const onSelect = useCallback((src: number | null, additive: boolean) => {
    setSelection((prev) => {
      if (src === null) return additive ? prev : new Set();
      if (additive) {
        const n = new Set(prev);
        if (n.has(src)) n.delete(src);
        else n.add(src);
        return n;
      }
      return new Set([src]);
    });
  }, []);
  const onSelectBox = useCallback((srcs: number[], additive: boolean) => {
    setSelection((prev) => (additive ? new Set([...prev, ...srcs]) : new Set(srcs)));
  }, []);

  /**
   * Right-click on the canvas — PL_SELECTION_TOOL::Main's BUT_RIGHT branch
   * (pl_selection_tool.cpp:120-135).
   *
   * An EMPTY selection takes the item under the cursor as a hover selection
   * first, so the menu that opens is about something. A non-empty selection is
   * left exactly as it is, wherever the click landed, which is what lets you
   * right-click off to one side of a group without losing it.
   */
  const onCanvasContextMenu = useCallback((x: number, y: number, hit: number | null) => {
    setSelection((prev) => (prev.size === 0 && hit !== null ? new Set([hit]) : prev));
    setCtxMenu({ x, y });
  }, []);

  const moveSelection = useCallback(
    (delta: Vec2) => {
      if (selection.size === 0) return;
      const items = sheet.items.map((it, i) => (selection.has(i) ? translateItem(it, delta) : it));
      commit({ ...sheet, items }, 'Move');
    },
    [sheet, selection, commit],
  );

  const deleteSelection = useCallback(() => {
    if (selection.size === 0) return;
    const items = sheet.items.filter((_, i) => !selection.has(i));
    commit({ ...sheet, items }, `Deleted ${selection.size} item${selection.size === 1 ? '' : 's'}`);
    setSelection(new Set());
  }, [sheet, selection, commit]);

  const onDeleteClick = useCallback(
    (src: number) => {
      const items = sheet.items.filter((_, i) => i !== src);
      commit({ ...sheet, items }, 'Deleted 1 item');
      setSelection(new Set());
    },
    [sheet, commit],
  );

  const copySelection = useCallback(() => {
    if (selection.size === 0) return;
    const items = [...selection].sort((a, b) => a - b).map((i) => structuredClone(sheet.items[i]!));
    clipboard.current = items;
    // Also place a .kicad_wks fragment on the system clipboard so the selection
    // can be pasted across editor instances / tabs (and by an external tool).
    try {
      const frag = serializeDrawingSheet({ ...sheet, items });
      void navigator.clipboard?.writeText?.(frag).catch(() => {});
    } catch {
      /* clipboard unavailable */
    }
    setStatus(`Copied ${items.length} item${items.length === 1 ? '' : 's'}`);
  }, [sheet, selection]);

  // Append items to the sheet (used by clipboard paste of items / a whole sheet).
  const appendItems = useCallback(
    (incoming: WksItem[], description: string) => {
      if (incoming.length === 0) return;
      const off = { x: mmToIU(2), y: mmToIU(2) };
      const shifted = incoming.map((it) => translateItem(structuredClone(it), off));
      const start = sheet.items.length;
      commit({ ...sheet, items: [...sheet.items, ...shifted] }, description);
      setSelection(new Set(shifted.map((_, k) => start + k)));
    },
    [sheet, commit],
  );

  const pasteClipboard = useCallback(() => {
    if (clipboard.current.length === 0) return;
    appendItems(
      clipboard.current,
      `Pasted ${clipboard.current.length} item${clipboard.current.length === 1 ? '' : 's'}`,
    );
  }, [appendItems]);

  // Parse `.kicad_wks` text from the clipboard and paste its items. Returns true
  // when the text was a drawing sheet (or fragment) that yielded items.
  const pasteWksText = useCallback(
    async (text: string): Promise<boolean> => {
      let parsed: WksSheet;
      try {
        parsed = await backfillBitmapMeta(parseDrawingSheet(text));
      } catch {
        return false;
      }
      if (parsed.items.length === 0) return false;
      appendItems(
        parsed.items,
        `Pasted ${parsed.items.length} item${parsed.items.length === 1 ? '' : 's'} from clipboard`,
      );
      return true;
    },
    [appendItems],
  );

  // Menu → Paste: read the system clipboard (image → bitmap, .kicad_wks text →
  // items), falling back to the in-editor clipboard when neither is available.
  const pasteFromSystem = useCallback(async () => {
    const clip: Clipboard | undefined = navigator.clipboard;
    try {
      if (typeof clip?.read === 'function') {
        const contents = await clip.read();
        for (const item of contents) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            await addBitmapFromFile(
              new File([blob], 'pasted-image', { type: imgType }),
              centreOrCursorPoint(),
            );
            return;
          }
        }
      }
      if (typeof clip?.readText === 'function') {
        const text = await clip.readText().catch(() => '');
        if (text && (await pasteWksText(text))) return;
      }
    } catch {
      /* permission denied / unsupported → fall back */
    }
    pasteClipboard();
  }, [addBitmapFromFile, centreOrCursorPoint, pasteWksText, pasteClipboard]);

  const cutSelection = useCallback(() => {
    if (selection.size === 0) return;
    copySelection();
    deleteSelection();
  }, [selection, copySelection, deleteSelection]);

  // ---- properties ----
  const selectedIndex = selection.size === 1 ? [...selection][0]! : -1;

  const updateSelected = useCallback(
    (patch: Partial<WksItem>) => {
      if (selectedIndex < 0) return;
      const items = sheet.items.slice();
      items[selectedIndex] = { ...items[selectedIndex]!, ...patch } as WksItem;
      commit({ ...sheet, items }, 'Edit properties');
    },
    [sheet, selectedIndex, commit],
  );

  const updateSetup = useCallback(
    (patch: Partial<WksSheet['setup']>) => {
      commit({ ...sheet, setup: { ...sheet.setup, ...patch } }, 'Edit general options');
    },
    [sheet, commit],
  );

  // ---- point editor (single selected line/rect) ----
  const selectedShape =
    selectedIndex >= 0 &&
    (sheet.items[selectedIndex]?.type === 'line' || sheet.items[selectedIndex]?.type === 'rect')
      ? (sheet.items[selectedIndex] as WksLine | WksRect)
      : null;

  const editPoints = useMemo<Vec2[]>(() => {
    if (!selectedShape || moveMode) return [];
    const a = anchoredToIU(selectedShape.start);
    const b = anchoredToIU(selectedShape.end);
    if (selectedShape.type === 'line') return [a, b];
    // Rect: TL, TR, BL, BR of the current geometry.
    const minX = Math.min(a.x, b.x),
      maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y),
      maxY = Math.max(a.y, b.y);
    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY },
    ];
  }, [selectedShape, anchoredToIU, moveMode]);

  const onPointDrag = useCallback(
    (index: number, at: Vec2) => {
      if (!selectedShape || selectedIndex < 0) return;
      if (!pointDragUndoPushed.current) {
        pointDragUndoPushed.current = true;
        pushUndo();
      }
      updateSheet((cur) => {
        const items = cur.items.slice();
        const it = items[selectedIndex];
        if (!it || (it.type !== 'line' && it.type !== 'rect')) return cur;
        const a = anchoredToIU(it.start);
        const b = anchoredToIU(it.end);
        let nextStart = it.start;
        let nextEnd = it.end;
        if (it.type === 'line') {
          if (index === 0) nextStart = anchoredPoint(at, it.start.corner);
          else nextEnd = anchoredPoint(at, it.end.corner);
        } else {
          // Rect corners: move the x of whichever endpoint holds that side,
          // and the y of whichever endpoint holds that edge (RECT_* cases).
          const leftIsStart = a.x <= b.x;
          const topIsStart = a.y <= b.y;
          const isLeft = index === 0 || index === 2;
          const isTop = index === 0 || index === 1;
          const xTarget = isLeft === leftIsStart ? 'start' : 'end';
          const yTarget = isTop === topIsStart ? 'start' : 'end';
          const sIU = { x: a.x, y: a.y };
          const eIU = { x: b.x, y: b.y };
          if (xTarget === 'start') sIU.x = at.x;
          else eIU.x = at.x;
          if (yTarget === 'start') sIU.y = at.y;
          else eIU.y = at.y;
          nextStart = anchoredPoint(sIU, it.start.corner);
          nextEnd = anchoredPoint(eIU, it.end.corner);
        }
        items[selectedIndex] = { ...it, start: nextStart, end: nextEnd };
        return { ...cur, items };
      });
    },
    [selectedShape, selectedIndex, anchoredToIU, anchoredPoint, pushUndo, updateSheet],
  );

  const onPointDragEnd = useCallback(() => {
    pointDragUndoPushed.current = false;
    setStatus('Resize');
  }, []);

  // ---- toolbars ----
  /*
   * `COMMON_TOOLS::m_imperialUnit` / `m_metricUnit` — the member of each family
   * Ctrl+U comes back to — are no longer a ref here. `setupUnits`
   * (eda_draw_frame.cpp:1384-1387) seeds them from
   * `system.last_imperial_units` / `system.last_metric_units` before the frame
   * is usable, so the settings object IS the store; a ref seeded with "inches"
   * was a second copy of state that upstream reads out of the config file.
   */

  const onLeftToggle = useCallback((id: string) => {
    settings.updatePlEditor((s) => {
      persistToggle(s, id);
    });
    setToggles((prev) => applyToggle(prev, id));
  }, []);

  const setTitleBlockMode = useCallback((mode: 'layoutNormalMode' | 'layoutEditMode') => {
    setToggles((prev) => {
      const next = new Set(prev);
      next.delete('layoutNormalMode');
      next.delete('layoutEditMode');
      next.add(mode);
      return next;
    });
  }, []);

  const onTopAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'new':
          requestFileCommand('new');
          break;
        case 'open':
          requestFileCommand('open');
          break;
        case 'save':
          save();
          break;
        case 'print':
          printSheet();
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
        case 'zoomTool':
          // ACTIONS::zoomTool is AF_ACTIVATE with ToolbarState TOGGLE
          // (actions.cpp:817-826): the button ARMS the rubber-band tool, it
          // does not act on the selection.
          setActiveTool('zoomTool');
          break;
        case 'inspect':
          setShowInspector(true);
          break;
        case 'previewSettings':
          setShowPageDialog(true);
          break;
        case 'layoutNormalMode':
          setTitleBlockMode('layoutNormalMode');
          break;
        case 'layoutEditMode':
          setTitleBlockMode('layoutEditMode');
          break;
        default:
          break;
      }
    },
    [requestFileCommand, save, printSheet, undo, redo, setTitleBlockMode],
  );

  const onRightTool = useCallback((id: string) => {
    if (id === 'appendSheet') {
      setOpenDlg('append');
      return;
    }
    setMoveMode(false);
    setActiveTool(id);
  }, []);

  /**
   * The menu tree, mirrored for the key chain below.
   *
   * `menus` is built further down - it needs every handler in the frame - while
   * the chain has to dispatch off the *live* tree, since a row's `disabled`
   * moves with the selection. A ref is how `useMenuHotkeys` does it too, and
   * for the same reason: depending on `menus` would tear the listener down and
   * put it back on every render.
   */
  const menusRef = useRef<Menu[]>([]);

  // ---- keyboard ----
  // The frame's single key chain, in `ACTION_MANAGER::RunHotKey` order: the
  // context actions this canvas owns, then the menus. See ui/menu_hotkeys.ts.
  //
  // `PL_ACTIONS` declares exactly one hotkey of its own - `move` = M
  // (pl_actions.cpp:84) - and it has no menu row anywhere in pl_editor, so it
  // stays here. Everything else pl_editor binds is shared `ACTIONS`, every one
  // of which has a row in the tree below, so every one of them is now
  // dispatched from that row rather than restated here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hidden frames must not act on global hotkeys (editors stay mounted
      // behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'drawingsheet') !== 'drawingsheet') return;
      // Another context handler already claimed this keystroke.
      // `defaultPrevented` means someone already acted on this key - EXCEPT
      // when it was our own browser suppressor, which runs in the capture phase
      // and cancels every combo the app claims purely to stop the browser.
      // Reading that as "handled" is what made every hotkey in the app stop
      // working once the dispatcher landed (c4a00590).
      if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
      // tool_dispatcher.cpp:654-670 - an editable entry takes every key, a
      // read-only one keeps Ctrl+C. This gates the context branches below;
      // dispatchMenuHotkey applies the same rule to the menus for itself.
      const target = e.target as (FocusLike & { readOnly?: boolean; disabled?: boolean }) | null;
      if (focusBlocksHotkey(target, e)) return;
      // A canvas tool key is `MD_NONE` upstream, so a modified press is a
      // different action and must fall through to the menus.
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;

      // --- context: what the live tool / selection owns -------------------
      if (e.key === 'Escape') {
        // PL_ACTIONS' cancel chain: back out of the move, then the drawing,
        // then the tool, and only then drop the selection.
        if (moveMode) setMoveMode(false);
        else if (drawingIndex.current !== null) cancelDrawing();
        else if (activeTool !== 'select') setActiveTool('select');
        else setSelection(new Set());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u') {
        // ACTIONS::toggleUnits (actions.cpp:1149-1156), Ctrl+U — listed in this
        // frame's hotkey list and working in pl_editor, and simply not bound
        // here: the audit pressed it with the frame focused and the status bar
        // stayed on inches.
        //
        // COMMON_TOOLS::ToggleUnits (common_tools.cpp:671-677) switches
        // imperial <-> metric and returns to the member of the other family you
        // were last in, which is why this is not a three-way cycle. That is the
        // units button's job, and it already cycles mm -> in -> mil. Both
        // "last" values are settings, so `toggleUnitsId` reads them from
        // `pl_editor.json` rather than from anything this frame remembers.
        e.preventDefault();
        onLeftToggle(toggleUnitsId(settings.plEditor));
        return;
      }
      if (plain && (e.key === 'm' || e.key === 'M')) {
        // PL_ACTIONS::move (pl_actions.cpp:84). Only claims the key when there
        // is something to move, exactly as its ACTION_CONDITIONS would.
        if (selection.size > 0) {
          e.preventDefault();
          setMoveMode(true);
        }
        return;
      }

      // --- global: the menu accelerators ----------------------------------
      if (dispatchMenuHotkey(menusRef.current, e, { target })) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, moveMode, selection, cancelDrawing, toggles, onLeftToggle]);

  // ---- system-clipboard paste (Ctrl+V): image → bitmap, .kicad_wks text → items ----
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      // Hidden frames must not act on the document paste event (editors stay
      // mounted behind display:none; no stamp = standalone build, always active).
      if ((document.body.dataset.activeView ?? 'drawingsheet') !== 'drawingsheet') return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')
      )
        return;
      const dt = e.clipboardData;
      if (!dt) return;
      // 1) A pasted image (from the Image Converter, a screenshot, etc.).
      const imgItem = Array.from(dt.items).find(
        (it) => it.kind === 'file' && it.type.startsWith('image/'),
      );
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          e.preventDefault();
          void addBitmapFromFile(file, centreOrCursorPoint());
          return;
        }
      }
      // 2) A pasted drawing sheet / fragment (kicad_wks S-expression text).
      const text = dt.getData('text/plain');
      if (text && /\(\s*(kicad_wks|polygon|tbtext|line|rect|bitmap)\b/.test(text)) {
        e.preventDefault();
        void pasteWksText(text);
        return;
      }
      // 3) Otherwise fall back to items copied inside this editor.
      if (clipboard.current.length) {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addBitmapFromFile, centreOrCursorPoint, pasteWksText, pasteClipboard]);

  // ---- menus (menubar.cpp) ----
  const openRecentItem: MenuItem = openRecentMenuItem({
    files: recent,
    onOpen: (i) => void openRecent(i),
    onClear: () => recentFiles.clearFileHistory(),
  });

  const menus: Menu[] = useMemo(
    () => [
      {
        label: 'File',
        items: [
          {
            label: 'New...',
            icon: 'new',
            action: () => requestFileCommand('new'),
            shortcut: browserSafeKey('Ctrl+N'),
          },
          {
            label: 'Open...',
            icon: 'open',
            action: () => requestFileCommand('open'),
            shortcut: 'Ctrl+O',
          },
          openRecentItem,
          { sep: true },
          { label: 'Save', icon: 'save', action: save, shortcut: 'Ctrl+S' },
          { label: 'Save As...', icon: 'saveAs', action: saveAs, shortcut: 'Shift+Ctrl+S' },
          { sep: true },
          { label: 'Print...', icon: 'print', action: printSheet, shortcut: 'Ctrl+P' },
          { sep: true },
          addClose('Drawing Sheet Editor', onExitToHome),
          addQuit('Drawing Sheet Editor', onExitToHome),
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: 'undo', action: undo, shortcut: 'Ctrl+Z' },
          { label: 'Redo', icon: 'redo', action: redo, shortcut: 'Ctrl+Y' },
          { sep: true },
          {
            label: 'Cut',
            icon: 'cut',
            action: cutSelection,
            shortcut: 'Ctrl+X',
            disabled: selection.size === 0,
          },
          {
            label: 'Copy',
            icon: 'copy',
            action: copySelection,
            shortcut: 'Ctrl+C',
            disabled: selection.size === 0,
          },
          {
            // Ctrl+V is performed by the browser's own paste, which is the only
            // reliable read of the system clipboard - see `nativeShortcut`. The
            // action is what the *row* does when it is clicked.
            label: 'Paste',
            icon: 'paste',
            action: () => void pasteFromSystem(),
            shortcut: 'Ctrl+V',
            nativeShortcut: true,
          },
          {
            label: 'Delete',
            icon: 'dsDelete',
            action: deleteSelection,
            shortcut: 'Delete',
            disabled: selection.size === 0,
          },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom In', icon: 'zoomIn', action: () => controller.current?.zoomIn() },
          { label: 'Zoom Out', icon: 'zoomOut', action: () => controller.current?.zoomOut() },
          {
            label: 'Zoom to Fit',
            icon: 'zoomFit',
            action: () => controller.current?.zoomToFit(),
            shortcut: 'Home',
          },
          {
            label: 'Zoom to Selection Area',
            icon: 'zoomTool',
            action: () => setActiveTool('zoomTool'),
            shortcut: 'Ctrl+F5',
          },
          {
            label: 'Refresh',
            icon: 'zoomRedraw',
            action: () => controller.current?.redraw(),
            shortcut: 'F5',
          },
          { sep: true },
          {
            label: 'Page Preview Settings...',
            icon: 'previewSettings',
            action: () => setShowPageDialog(true),
          },
        ],
      },
      {
        label: 'Place',
        items: [
          {
            label: 'Draw Lines',
            icon: 'dsAddLine',
            action: () => setActiveTool('dsAddLine'),
          },
          {
            label: 'Draw Rectangles',
            icon: 'dsAddRect',
            action: () => setActiveTool('dsAddRect'),
          },
          { label: 'Draw Text', icon: 'dsAddText', action: () => setActiveTool('dsAddText') },
          {
            label: 'Place Bitmaps',
            icon: 'dsAddBitmap',
            action: () => setActiveTool('dsAddBitmap'),
          },
          { sep: true },
          {
            label: 'Append Existing Drawing Sheet...',
            icon: 'appendSheet',
            action: () => setOpenDlg('append'),
          },
          { sep: true },
          // PL_EDITOR_CONTROL::GridResetOrigin (pl_editor_control.cpp) is
          // SetGridOrigin( 0, 0 ) followed by ForceRefresh(). Our grid is
          // anchored at (0, 0) and there is no gridSetOrigin to move it, so
          // only the refresh half is observable here - see the PR.
          {
            label: 'Reset Grid Origin',
            action: () => controller.current?.redraw(),
          },
        ],
      },
      {
        label: 'Inspect',
        items: [
          { label: 'Show Design Inspector', icon: 'inspect', action: () => setShowInspector(true) },
        ],
      },
      {
        label: 'Preferences',
        // menubar.cpp:142-149 — openPreferences then AddMenuLanguageList, and
        // unlike bitmap2cmp and cvpcb pl_editor puts no separator between them.
        items: [
          { label: 'Preferences...', action: () => setShowPrefs(true), shortcut: 'Ctrl+,' },
          setLanguageMenuItem({
            current: common.system.language,
            onSelect: (label) =>
              settings.updateCommon((c) => {
                c.system.language = label;
              }),
          }),
        ],
      },
      // "Syntax Help" is not a Help-menu entry upstream: pl_editor puts it in
      // the properties panel as a hyperlink (properties_frame_base.cpp,
      // m_syntaxHelpLink), which is where ours lives now too.
      standardHelpMenu({
        showHotkeys: showHotkeyList,
        showAbout: () => setStatus('ZiroEDA Drawing Sheet Editor'),
      }),
    ],
    [
      requestFileCommand,
      save,
      saveAs,
      printSheet,
      undo,
      redo,
      cutSelection,
      copySelection,
      pasteFromSystem,
      deleteSelection,
      selection,
      onExitToHome,
      openRecentItem,
      common.system.language,
    ],
  );

  // The chain above reads the tree through this ref; see `menusRef`.
  menusRef.current = menus;

  // ---- title ----
  /*
   * PL_EDITOR_FRAME::UpdateTitleAndInfo (pl_editor_frame.cpp:570-586):
   *
   *   if( IsContentModified() )  title = "*";
   *   if( file.IsOk() )          title += file.GetName();
   *   else                       title += _( "[no drawing sheet loaded]" );
   *   title += " \u2014 " + _( "Drawing Sheet Editor" );
   *
   * `wxFileName::GetName()` is the base name WITHOUT the extension, and the
   * dash is an EM DASH with a space either side, not an ASCII hyphen. The
   * empty-name branch is reachable: File > New does
   * SetCurrentFileName( wxEmptyString ) (pagelayout_editor/files.cpp).
   */
  const titleName = frameTitleName(fileName, '[no drawing sheet loaded]');

  useDocumentTitle('drawingsheet', formatTitle('Drawing Sheet Editor', fileName, dirty));

  // This editor has no autosave: a sheet reaches the project only when Save is
  // pressed. So unlike the schematic and the board there is nothing to flush on
  // the way out, and the only useful thing is to stop an accidental close.
  useUnsavedGuard(dirty);

  // ---- status bar (UpdateStatusBar) ----
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const unit = toggles.has('unitsInches') ? 'inches' : toggles.has('unitsMils') ? 'mils' : 'mm';
  const toUser = useCallback(
    (iu: number): number => {
      const mm = iuToMM(iu);
      return unit === 'inches' ? mm / 25.4 : unit === 'mils' ? (mm / 25.4) * 1000 : mm;
    },
    [unit],
  );
  /**
   * `PL_EDITOR_FRAME::UpdateStatusBar` formats both coordinate pairs with
   * `%.4g` (pl_editor_frame.cpp:770-771). That is not "4 significant digits":
   * `%g` switches to exponent form once the exponent leaves `-4 <= e < 4`,
   * which is why a cold-open pl_editor reads `X 1.266e+04  Y 1.217e+04`.
   * JS's own toPrecision-and-back never does, so ours printed plain
   * integers there.
   */
  const fmt4 = (n: number): string => formatG(n, 4);

  /** Origin corner in page IU + per-axis signs (ReturnCoordOriginCorner). */
  const originInfo = useMemo((): { origin: Vec2; xs: number; ys: number } => {
    const s = sheet.setup;
    const left = mmToIU(s.leftMargin),
      top = mmToIU(s.topMargin);
    const right = mmToIU(pageMM[0] - s.rightMargin),
      bottom = mmToIU(pageMM[1] - s.bottomMargin);
    switch (originChoice) {
      case 1:
        return { origin: { x: right, y: bottom }, xs: -1, ys: -1 };
      case 2:
        return { origin: { x: left, y: bottom }, xs: 1, ys: -1 };
      case 3:
        return { origin: { x: right, y: top }, xs: -1, ys: 1 };
      case 4:
        return { origin: { x: left, y: top }, xs: 1, ys: 1 };
      default:
        return { origin: { x: 0, y: 0 }, xs: 1, ys: 1 };
    }
  }, [sheet.setup, pageMM, originChoice]);

  const absCoord = cursor
    ? `X ${fmt4(toUser((cursor.x - originInfo.origin.x) * originInfo.xs))}  Y ${fmt4(
        toUser((cursor.y - originInfo.origin.y) * originInfo.ys),
      )}`
    : 'X, Y -';
  const relCoord = cursor
    ? `dx ${fmt4(toUser((cursor.x - localOrigin.x) * originInfo.xs))}  dy ${fmt4(
        toUser((cursor.y - localOrigin.y) * originInfo.ys),
      )}`
    : 'dx, dy -';

  /*
   * The grid is a WINDOW setting, not a unit-derived one: pl_editor's default
   * comes from grid.last_size = 4 (app_settings.cpp:466-472) indexing
   * DefaultGridSizeList()'s pl_editor list (:605-614), whose entry 4 is
   * "0.50 mm". It does not change when the display unit does - the readout
   * just re-expresses the same spacing, which is why a live pl_editor in mils
   * shows "grid 19.685039".
   *
   * Ours derived the spacing from the unit, so the mils default above would
   * otherwise have moved the grid from 1 mm to 2.54 mm. Keying it to the
   * upstream list and its index keeps the two independent, as they are
   * upstream; `gridIndex` starts at DEFAULT_GRID_INDEX.pl_editor = 4.
   */
  const gridIU = mmToIU(gridSizeToMM(GRID_SIZE_LIST.pl_editor[gridIndex]?.x ?? '0.50 mm') ?? 0.5);
  // PL_EDITOR_FRAME::DisplayGridMsg (pagelayout_editor/pl_editor_frame.cpp:710)
  // formats the grid itself - "grid %.4f" in mm, "grid %.3f" in inch - rather
  // than going through GRID::MessageText, which is what MessageTextFromValue's
  // long form prints anyway. Ours was a string literal per unit.
  const gridLabel = gridMsg(
    unit === 'inches'
      ? (iuToMM(gridIU) / 25.4).toFixed(3)
      : unit === 'mils'
        ? // The MILS case is the `default:` branch of that switch, and its
          // format is a bare "grid %f" - no precision given, so C's default of
          // SIX decimal places. A live pl_editor in mils really does read
          // "grid 19.685039"; ours read "grid 19.7".
          ((iuToMM(gridIU) / 25.4) * 1000).toFixed(6)
        : iuToMM(gridIU).toFixed(4),
  );

  /**
   * The message panel is REPLACED on every selection change, never added to.
   *
   * `PL_EDITOR_CONTROL::UpdateMessagePanel`
   * (pagelayout_editor/tools/pl_editor_control.cpp:147-179) picks exactly one
   * of two sources and hands it to `EDA_DRAW_FRAME::SetMsgPanel`, which erases
   * the box before appending (`common/eda_draw_frame.cpp:955-964`):
   *
   *   - one item selected  -> that item's `GetMsgPanelInfo`, six rows
   *   - anything else      -> `PL_EDITOR_FRAME::UpdateMsgPanelInfo`
   *                           (`pl_editor_frame.cpp:968-977`), which is Page
   *                           Width and Page Height and nothing else
   *
   * so the page rows are never on screen beside an item's rows. Ours used to
   * keep the page rows up permanently, add two invented ones (`Paper`, `Page`)
   * and append a `Selected` count, which is four fields of noise in front of
   * the ones a user opened the editor to read.
   *
   * The values carry their unit label because `MessageTextFromValue`'s
   * `aAddUnitsText` defaults to true (`include/units_provider.h:127`) and
   * neither call site overrides it - see `unitText`.
   */
  const dsMsgPanelItems = useMemo((): MsgPanelItem[] => {
    const u = unit === 'inches' ? 'in' : unit;
    const fmt = (mm: number): string => messageTextFromValue(mm, u) + unitText(u);

    if (selection.size === 1) {
      const item = sheet.items[[...selection][0] as number];
      // `KIUI::EllipsizeStatusText( aFrame, textItem->GetText() )`
      // (ds_draw_item.cpp:132). The window it measures against is the frame,
      // and the budget is a fraction of that frame's width - so both come from
      // the live panel here rather than from a character count.
      if (item)
        return wksItemMsgPanelInfo(item, fmt, (text) => {
          const el = msgPanelRef.current;
          if (!el) return text;
          return ellipsizeStatusText(text, statusTextWidth(el.clientWidth), (s) =>
            measureTextWidth(s, el),
          );
        });
    }
    // Page size, but only once a selection change has happened.
    //
    // `UpdateMsgPanelInfo` has exactly two call sites upstream
    // (`pl_editor_frame.cpp:834`, `pl_editor_control.cpp:171`) and BOTH are
    // selection-change handlers, so a freshly opened pl_editor shows an empty
    // message panel and only fills it when you click the canvas. Ours filled it
    // from the first render, which is why it read Page Width / Page Height
    // where a live KiCad shows nothing at all.
    if (!selectionSeen) return [];
    const std = pageSizeDisplayMM(preview.paper);
    const displayMM = std[0] > 0 ? std : pageMM;
    return [
      // Not `pageMM`: the panel prints what `GetSizeIU` returns, and that is an
      // int, so A3's height reads 297.0020 rather than 297.0022. A custom page
      // has no entry in the table and falls back to the mm it was typed as.
      { upper: 'Page Width', lower: fmt(displayMM[0]) },
      { upper: 'Page Height', lower: fmt(displayMM[1]) },
    ];
  }, [pageMM, unit, selection, sheet.items, selectionSeen, preview.paper]);

  return (
    // `ze-wks` scopes the PL_EDITOR_FRAME chrome measurements in shell.css.
    <div className="ze-app ze-wks">
      <input
        ref={bitmapInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickBitmap(f);
          e.target.value = '';
        }}
      />

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
              {titleName}
            </b>
            {FRAME_TITLE_SEPARATOR}
            Drawing Sheet Editor
          </>
        }
      />

      {/* Top toolbar + the origin / page selector combos. Upstream these two
          are toolbar CONTROLS on the one ACTION_TOOLBAR
          (toolbars_pl_editor.cpp), so the row is a single strip: the wrapper
          carries the same face as the toolbar it continues. */}
      {/* One toolbar, not a bar holding a toolbar: upstream adds both choices
          to the toolbar itself (`toolbars_pl_editor.cpp:132,157`). The wrapper
          this replaces painted --chrome-bg behind a --content-bg toolbar, so
          the strip showed the menu-bar grey either side of the buttons. */}
      <Toolbar
        entries={DS_TOP_TOOLBAR}
        orientation="horizontal"
        toggled={activeTool === 'zoomTool' ? new Set([...toggles, 'zoomTool']) : toggles}
        onActivate={onTopAction}
        controls={{
          originSelector: (
            <Combo
              value={String(originChoice)}
              options={ORIGIN_CHOICES.map((c, i) => ({ value: String(i), label: c }))}
              onChange={(v) => {
                const idx = Number(v);
                setOriginChoice(idx);
                settings.updatePlEditor((s) => {
                  s.corner_origin = idx;
                });
              }}
              title="Origin of coordinates displayed to the status bar"
            />
          ),
          pageSelect: (
            <Combo
              value={String(pageNumber)}
              options={PAGE_NUMBER_CHOICES}
              onChange={(v) => setPageNumber(Number(v))}
              title={
                'Simulate page 1 or other pages to show how items\nwhich are not on all page are displayed'
              }
            />
          ),
        }}
      />

      <div className="ze-body" ref={bodyRef}>
        <Toolbar
          entries={DS_LEFT_TOOLBAR}
          orientation="vertical"
          side="left"
          toggled={toggles}
          onActivate={onLeftToggle}
        />

        <DrawingSheetCanvas
          ref={controller}
          draws={draws}
          pageW={pageW}
          pageH={pageH}
          selection={selection}
          activeTool={activeTool}
          showGrid={toggles.has('toggleGrid')}
          gridIU={gridIU}
          originIU={originInfo.origin}
          fullCrosshair={toggles.has('crosshairFull')}
          blackBackground={blackBackground}
          editPoints={editPoints}
          moveMode={moveMode}
          onCursorMove={setCursor}
          onScaleChange={setScale}
          onSelect={onSelect}
          onSelectBox={onSelectBox}
          onMoveItems={moveSelection}
          onPlacePoint={onPlacePoint}
          onDrawFirst={onDrawFirst}
          onDrawMove={onDrawMove}
          onDrawSecond={onDrawSecond}
          onDeleteClick={onDeleteClick}
          onPointDrag={onPointDrag}
          onPointDragEnd={onPointDragEnd}
          onSetLocalOrigin={setLocalOrigin}
          onToolDone={() => setActiveTool('select')}
          onMoveDrop={(d) => {
            moveSelection(d);
            setMoveMode(false);
          }}
          onContextMenuRequest={onCanvasContextMenu}
        />

        {/* RightToolbar is `.Right().Layer( 2 )` and Props is
            `.Right().Layer( 3 )` (pl_editor_frame.cpp:197-204). A higher wxAUI
            layer docks FURTHER from the centre, and the centre is the canvas,
            so the toolbar touches the canvas and the palette sits outside it.
            The toolbar therefore comes FIRST in this row. */}
        <Toolbar
          entries={DS_RIGHT_TOOLBAR}
          orientation="vertical"
          side="right"
          activeTool={moveMode ? '' : activeTool}
          onActivate={onRightTool}
        />

        {/* wxAUI's sash. It sits on the pane's LEFT edge, which puts it between
            the right toolbar and the palette — the toolbar is Layer 2 and the
            palette Layer 3, so the palette is the outer of the two
            (`pl_editor_frame.cpp:196-204`). */}
        <DockSash
          edge="left"
          width={propsWidth}
          min={propsMin}
          max={Math.max(propsMin, (bodyRef.current?.clientWidth ?? 0) - CANVAS_MIN_WIDTH)}
          onResize={(w) => {
            setPropsWidth(w);
            // `m_propertiesFrameWidth = m_propertiesPagelayout->GetSize().x`
            // (pl_editor_frame.cpp:558) — upstream re-reads the live pane at
            // save time; the web equivalent of "at save time" is as it moves,
            // the same as the Symbol Library Browser's two sashes.
            settings.updatePlEditor((s) => {
              s.properties_frame_width = w;
            });
          }}
        />
        {/* Docked properties panel (properties_frame.cpp). It is itself the
            `.ze-panel`, caption included — see PropertiesFrame. */}
        <div
          ref={propsRef}
          className="ze-leftdock on-right"
          style={{ width: propsWidth, minWidth: propsWidth }}
        >
          <PropertiesFrame
            sheet={sheet}
            selectedIndex={selectedIndex}
            units={unit === 'inches' ? 'in' : unit}
            onItemChange={updateSelected}
            onSetupChange={updateSetup}
            onShowSyntaxHelp={() => setShowSyntaxHelp(true)}
          />
        </div>
      </div>

      {/* wxFileDialog( … wxFD_SAVE | wxFD_OVERWRITE_PROMPT ), over the project
          store rather than a browser prompt. */}
      {openDlg && (
        <OpenFileDialog
          // Reading is not gated: a sheet opens from any project, with or
          // without one open, and from Templates.
          kind="templates"
          title={openDlg === 'append' ? 'Append Existing Drawing Sheet' : 'Open'}
          accept={openDlg === 'append' ? 'Append' : 'Open'}
          filters={[drawingSheetWildcard()]}
          onDone={(file) => {
            const mode = openDlg;
            setOpenDlg(null);
            if (!file) return; // wxID_CANCEL
            const leaf = file.path.split('/').filter(Boolean).pop() ?? file.path;
            if (mode === 'append') void appendText(leaf, file.text);
            else void openText(leaf, file.text);
          }}
        />
      )}

      {saveAsOpen && (
        <SaveAsDialog
          // `wxFileDialog( this, _( "Save Drawing Sheet As" ), dir,
          //                wxEmptyString, ... )` — pl_editor suggests NO name
          // (pagelayout_editor/files.cpp:200-202), and a probe of that very
          // dialog confirms it: GetFilename() and GTK's current-name are both
          // empty. Not even the sheet's existing name is pre-filled. Ours
          // invented `drawing_sheet.kicad_wks`, a name no KiCad ever offers,
          // and pre-filled the old one for a saved sheet.
          initialName=""
          // Upstream's defaultDir is `PATHS::GetUserTemplatesPath()`
          // (pagelayout_editor/files.cpp:199) — the user-data folder for
          // drawing sheets, on a machine where the project directory, the user
          // data directory and the rest of the disk are three separate places.
          //
          // This tree has one, so the two answers are two FOLDERS of it, and
          // the dialog offers exactly those: this project, or Templates. No
          // other project is reachable — see `chooserPlacesFor`.
          kind="templates"
          {...(projectName ? { projectDir: `/${projectName}` } : {})}
          filters={[drawingSheetWildcard()]}
          onDone={onSaveAsDone}
        />
      )}

      {/* `HandleUnsavedChanges`, with `Files_io`'s own sentence
          (pagelayout_editor/files.cpp:107-108). */}
      {unsavedFor && (
        <UnsavedChangesDialog
          message="The current drawing sheet has been modified. Save changes?"
          onResult={answerUnsavedChanges}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildDsContextMenu(
            {
              hasSelection: selection.size > 0,
              zoom: zoomFactorForScale(scale, dpr, SCH_IU_PER_MM),
              gridIndex,
              primaryUnits: unit === 'inches' ? 'in' : unit,
            },
            {
              move: () => setMoveMode(true),
              cut: cutSelection,
              copy: copySelection,
              paste: () => void pasteFromSystem(),
              doDelete: deleteSelection,
              drawLine: () => setActiveTool('dsAddLine'),
              drawRectangle: () => setActiveTool('dsAddRect'),
              placeText: () => setActiveTool('dsAddText'),
              placeImage: () => setActiveTool('dsAddBitmap'),
              // PL_EDITOR_CONTROL::GridResetOrigin, as the Place menu's row
              // already explains: our grid is anchored at (0, 0) and there is
              // no gridSetOrigin to move it, so only the refresh half shows.
              gridOrigin: () => controller.current?.redraw(),
              setZoom: (factor) => controller.current?.setZoomPreset(factor),
              setGrid: setGridIndex,
            },
          )}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <MsgPanel items={dsMsgPanelItems} testId="ds-message-panel" panelRef={msgPanelRef} />

      {/* PL_EDITOR_FRAME::UpdateStatusBar (pl_editor_frame.cpp:730) keeps
          EDA_DRAW_FRAME's eight panes and their widths but writes two of them
          differently: pane 5, the one sized by the "Inches" template, carries
          "coord origin: <corner>" (:803), and the units land in pane 6, the
          stretch pane the other frames use for the current tool (:776). */}
      <KiStatusBar
        testIds={{ message: 'ds-status-msg', coords: 'ds-coords' }}
        fields={{
          message: status,
          zoom: zoomMsg(zoomFactorForScale(scale, dpr, SCH_IU_PER_MM)),
          coords: absCoord,
          deltas: relCoord,
          grid: gridLabel,
          units: `coord origin: ${ORIGIN_CHOICES[originChoice]}`,
          tool: unit,
        }}
      />

      {showPageDialog && (
        <PageSettingsDialog
          value={preview}
          // The dialog's custom-size fields are UNIT_BINDERs over the FRAME
          // (dialog_page_settings.cpp:65-66), so they read in the frame's unit.
          units={unit === 'inches' ? 'in' : unit}
          // SetWksFileName( m_frame->GetCurrentFileName() ), then
          // EnableWksFileNamePicker( false ) — shown, filled and disabled
          // (pl_editor_control.cpp:97-98).
          wksFileName={fileName}
          sheet={sheet}
          onCancel={() => setShowPageDialog(false)}
          onOk={(next) => {
            setPreview(next);
            // The page — and only the page. `SaveSettings` writes the paper
            // type, the orientation and the two custom edges
            // (pl_editor_frame.cpp:563-566); the title block it edits alongside
            // them has no parameter and opens blank every time.
            settings.updatePlEditor((s) => writePageToConfig(s, next));
            setShowPageDialog(false);
            setStatus(`Page: ${paperDescription(next)}`);
            requestAnimationFrame(() => controller.current?.zoomToFit());
          }}
        />
      )}

      {showInspector && (
        <DesignInspector
          items={sheet.items}
          selection={selection}
          // SetTitle( fn.GetName() ) or "<default drawing sheet>"
          // (design_inspector.cpp:216-221). Ours hardcoded "Design Inspector",
          // which is the one string upstream never puts there.
          title={dsInspectorTitle(frameTitleName(fileName, ''))}
          // PAGE_INFO::GetTypeAsString() — the page type NAME, not a
          // description of it, and the page size goes in the Text column.
          paperType={preview.paper}
          pageMM={pageMM}
          onClose={() => setShowInspector(false)}
          // onCellClicked (design_inspector.cpp:344-353) is ClearSelection,
          // AddItemToSel, Refresh and CopyPrmsFromItemToPanel - a repaint, not
          // a view change. Ours also zoomed to the picked item, so inspecting a
          // row threw away the zoom and the scroll position the user had set
          // (measured: KiCad held Z 0.53 where ours went 1.12 -> 2.02 and
          // re-centred).
          onSelect={(i) => setSelection(new Set([i]))}
        />
      )}

      {printError && (
        <MessageDialogError message={printError} onClose={() => setPrintError(null)} />
      )}

      {showSyntaxHelp && <SyntaxHelpDialog onClose={() => setShowSyntaxHelp(false)} />}

      {showPrefs && (
        <PreferencesDialog
          blackBackground={blackBackground}
          fullCrosshair={toggles.has('crosshairFull')}
          onBlackBackground={setBlackBackground}
          // The checkbox is a checkbox, so it can only ever ask for the value
          // it is not already on — which is exactly what `onLeftToggle` does,
          // and routing it through there is what keeps
          // `window.cursor.cross_hair_mode` written.
          onFullCrosshair={() => onLeftToggle('crosshairFull')}
          onClose={() => setShowPrefs(false)}
        />
      )}
    </div>
  );
}

/**
 * Preferences, the display options `pl_editor` keeps in its settings
 * (pl_editor_settings.cpp `black_background`; common display options'
 * always-show-crosshairs).
 */
function PreferencesDialog({
  blackBackground,
  fullCrosshair,
  onBlackBackground,
  onFullCrosshair,
  onClose,
}: {
  blackBackground: boolean;
  fullCrosshair: boolean;
  onBlackBackground: (v: boolean) => void;
  onFullCrosshair: (v: boolean) => void;
  onClose: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Preferences
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        {/* Spacing is the wxFormBuilder unit, --wx-border, not a number picked
            here: KiCad's dialogs are laid out with `wxALL, 5` throughout, so
            every inset in one is a multiple of 5 and they line up because of
            it. */}
        <div
          style={{
            padding: 'calc(var(--wx-border) * 2) calc(var(--wx-border) * 3)',
            fontSize: 12,
            display: 'grid',
            gap: 'calc(var(--wx-border) * 2)',
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={blackBackground}
              onChange={(e) => onBlackBackground(e.target.checked)}
            />{' '}
            Use a black background
          </label>
          <label>
            <input
              type="checkbox"
              checked={fullCrosshair}
              onChange={(e) => onFullCrosshair(e.target.checked)}
            />{' '}
            Always show full-window crosshairs
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
