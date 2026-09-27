// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `PL_EDITOR_FRAME` on a real TOOL_MANAGER and a real VIEW, for the tests
 * that drive the Drawing Sheet Editor through its frame and tools. The
 * canvas's constructor needs WebGL2, which Node has not, so the panel is an
 * object on `PL_DRAW_PANEL_GAL`'s prototype holding what its methods read (a
 * VIEW on a stub GAL, view controls whose cursor the test sets).
 *
 * The host records what the frame asked of the page and answers the dialogs
 * from queues a test fills: `open` / `saveAs` paths, `unsaved` answers,
 * `pageSettings` OK/Cancel, the image the chooser returns.
 */
import { DS_PAINTER } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import type { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  TA_MOUSE_MOTION,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { VC_SETTINGS } from '@ziroeda/common/view/view_controls.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { WX_IMAGE } from '@ziroeda/common/wx_image.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { DIALOG_INSPECTOR } from '@ziroeda/pagelayout_editor/dialogs/design_inspector.js';
import { PL_DRAW_PANEL_GAL } from '@ziroeda/pagelayout_editor/pl_draw_panel_gal.js';
import {
  PL_EDITOR_FRAME,
  type PL_EDITOR_FRAME_HOST,
} from '@ziroeda/pagelayout_editor/pl_editor_frame.js';
import { PL_EDITOR_SETTINGS } from '@ziroeda/pagelayout_editor/pl_editor_settings.js';

class STUB_GAL extends GAL {}

/** The recording host: every call the frame made, and the dialogs' answers. */
export interface TestHost extends PL_EDITOR_FRAME_HOST {
  clipboard: string;
  clipboardImage: WX_IMAGE | null;
  titles: string[];
  /** `DisplayErrorMessage` calls, text and extra info. */
  errors: { text: string; extra: string | undefined }[];
  /** `wxMessageBox` calls. */
  messages: { message: string; caption: string | undefined }[];
  /** Files by path: what `ReadFile` answers and `WriteFile` stores. */
  files: Map<string, string>;
  /** Paths written, in order. */
  written: string[];
  /** `UpdateFileHistory` paths, in order. */
  history: string[];
  /** The outdated-format infobar, as last shown. */
  outdatedInfoBar: boolean;
  /** What the next open / append / save-as dialogs return (null = Cancel). */
  openAnswers: (string | null)[];
  saveAsAnswers: (string | null)[];
  /** The dialogs opened: titles in order. */
  dialogs: string[];
  /** HandleUnsavedChanges' answers: 'save' | 'discard' | 'cancel'. */
  unsavedAnswers: ('save' | 'discard' | 'cancel')[];
  unsavedQuestions: string[];
  /** DIALOG_PAGES_SETTINGS: OK or Cancel, and what OK writes back. */
  pageSettingsAnswers: boolean[];
  /** The image the chooser returns (null = Cancel). */
  imageAnswers: ({ path: string; data: Uint8Array } | null)[];
  inspectors: DIALOG_INSPECTOR[];
  printed: number;
  htmlBoxes: { caption: string; html: string; list: readonly string[] }[];
}

export interface Harness {
  frame: PL_EDITOR_FRAME;
  mgr: TOOL_MANAGER;
  view: VIEW;
  cursor: { at: VECTOR2I };
  /** The last `SetCurrentCursor` the tools asked the canvas for. */
  canvasCursor: { kind: number | null };
  status: string[];
  msgPanel: readonly MSG_PANEL_ITEM[];
  host: TestHost;
  cfg: PL_EDITOR_SETTINGS;
}

function makeHost(): TestHost {
  const host: TestHost = {
    clipboard: '',
    clipboardImage: null,
    titles: [],
    errors: [],
    messages: [],
    files: new Map(),
    written: [],
    history: [],
    outdatedInfoBar: false,
    openAnswers: [],
    saveAsAnswers: [],
    dialogs: [],
    unsavedAnswers: [],
    unsavedQuestions: [],
    pageSettingsAnswers: [],
    imageAnswers: [],
    inspectors: [],
    printed: 0,
    htmlBoxes: [],
    SetTitle(aTitle) {
      host.titles.push(aTitle);
    },
    DisplayErrorMessage(aText, aExtra) {
      host.errors.push({ text: aText, extra: aExtra });
    },
    MessageBox(aMessage, aCaption) {
      host.messages.push({ message: aMessage, caption: aCaption });
    },
    WriteFile(aPath, aContents) {
      host.files.set(aPath, aContents);
      host.written.push(aPath);
      return true;
    },
    ReadFile: (aPath) => host.files.get(aPath) ?? null,
    UpdateFileHistory(aPath) {
      host.history.push(aPath);
    },
    ShowOutdatedSaveInfoBar(aShow) {
      host.outdatedInfoBar = aShow;
    },
    OpenFileDialog(aTitle) {
      host.dialogs.push(aTitle);
      return Promise.resolve(host.openAnswers.shift() ?? null);
    },
    SaveFileDialog(aTitle) {
      host.dialogs.push(aTitle);
      return Promise.resolve(host.saveAsAnswers.shift() ?? null);
    },
    async HandleUnsavedChanges(aMessage, aSave) {
      host.unsavedQuestions.push(aMessage);
      const answer = host.unsavedAnswers.shift() ?? 'cancel';
      if (answer === 'save') return aSave();
      return answer === 'discard';
    },
    ToPrinter() {
      host.printed++;
    },
    ShowDesignInspector(aDlg) {
      host.inspectors.push(aDlg);
      return Promise.resolve();
    },
    ShowPageSettingsDialog: () => Promise.resolve(host.pageSettingsAnswers.shift() ?? false),
    ChooseImageFile: () => Promise.resolve(host.imageAnswers.shift() ?? null),
    HtmlMessageBox(aCaption, aHtml, aList) {
      host.htmlBoxes.push({ caption: aCaption, html: aHtml, list: aList });
    },
    SaveClipboard(aText) {
      host.clipboard = aText;
      return true;
    },
    GetClipboardUTF8: () => host.clipboard,
    GetImageFromClipboard: () => host.clipboardImage,
    ShowInfoBarMsg() {},
    DismissInfoBar() {},
  };

  return host;
}

/**
 * The frame as the page builds it: settings, host, sinks, then
 * `AttachCanvas` with a panel on a stub GAL.
 *
 * @param aSetup runs on the settings object before the frame is built.
 */
export function makeHarness(
  aUnits: EDA_UNITS_INT,
  aCorner = 0,
  aSetup: (aCfg: PL_EDITOR_SETTINGS) => void = () => {},
): Harness {
  const cfg = new PL_EDITOR_SETTINGS();
  cfg.m_System.units = aUnits;
  cfg.m_CornerOrigin = aCorner;
  aSetup(cfg);

  const frame = new PL_EDITOR_FRAME(cfg);
  // `BASE_SCREEN::m_DrawingSheetFileName` is a static: a fresh process starts empty.
  frame.SetCurrentFileName('');

  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  const view = new VIEW();
  view.SetGAL(gal);
  view.SetPainter(new DS_PAINTER(gal));

  const cursor = { at: { x: 0, y: 0 } as VECTOR2I };
  const canvasCursor: { kind: number | null } = { kind: null };
  const vcSettings = new VC_SETTINGS();
  const vc = {
    GetSettings: () => vcSettings,
    ApplySettings: () => {},
    ForceCursorPosition: () => {},
    WarpMouseCursor: () => {},
    GetMousePosition: () => cursor.at,
    GetCursorPosition: () => cursor.at,
    SetCursorPosition: (p: VECTOR2I) => {
      cursor.at = p;
    },
    SetCrossHairCursorPosition: () => {},
    ShowCursor: () => {},
    CaptureCursor: () => {},
    SetAutoPan: () => {},
    CenterOnCursor: () => {},
  };

  // PL_DRAW_PANEL_GAL as its constructor leaves it, less the WebGL context.
  const panel = Object.create(PL_DRAW_PANEL_GAL.prototype) as PL_DRAW_PANEL_GAL;
  Object.assign(panel, {
    m_view: view,
    m_gal: gal,
    m_viewControls: vc,
    m_edaFrame: frame,
    m_backend: 1,
    m_pageDrawItem: null,
    SwitchBackend: () => true,
    GetBackend: () => 1,
    StartDrawing: () => {},
    Refresh: () => {},
    ForceRefresh: () => {},
    SetFocus: () => {},
    SetEventDispatcher: () => {},
    SetCurrentCursor: (aCursor: number) => {
      canvasCursor.kind = aCursor;
    },
    GetClientSize: () => ({ x: 1000, y: 800 }),
    GetDefaultViewBBox: () => view.GetBoundary(),
    Destroy: () => {},
  });

  const status: string[] = [];
  frame.SetStatusTextSink((aText, aField) => {
    status[aField] = aText;
  });

  const host = makeHost();
  frame.SetHost(host);

  const harness: Harness = {
    frame,
    mgr: null as unknown as TOOL_MANAGER,
    view,
    cursor,
    canvasCursor,
    status,
    msgPanel: [],
    host,
    cfg,
  };

  frame.SetMsgPanelSink((aItems) => {
    harness.msgPanel = aItems;
  });

  frame.AttachCanvas(panel);
  harness.mgr = frame.GetToolManager()!;

  return harness;
}

/** A mouse event at `aAt`, the cursor moved there first. */
export function mouse(aMgr: TOOL_MANAGER, aAction: number, aAt: VECTOR2I, aHarness: Harness): void {
  aHarness.cursor.at = aAt;
  const e = new TOOL_EVENT(
    TC_MOUSE,
    aAction,
    aAction === TA_MOUSE_MOTION ? 0 : BUT_LEFT,
    AS_GLOBAL,
  );
  e.SetMousePosition(aAt);
  aMgr.ProcessEvent(e);
}

/**
 * A toolbar button: `ACTION_TOOLBAR::onToolEvent` makes the action's event
 * and clears its position before processing it (action_toolbar.cpp:807-808),
 * so a drawing tool is not primed at the cursor.
 */
export function toolbar(aMgr: TOOL_MANAGER, aAction: { MakeEvent(): TOOL_EVENT }): void {
  const evt = aAction.MakeEvent();
  evt.SetHasPosition(false);
  aMgr.ProcessEvent(evt);
}

/** Let every pending promise and `CallAfter` run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}
