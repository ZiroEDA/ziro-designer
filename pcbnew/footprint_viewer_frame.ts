// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_VIEWER_FRAME` (`pcbnew/footprint_viewer_frame.cpp`/`.h`), the
 * Footprint Library Browser — its KIWAY half and every decision the frame
 * makes that is not drawing: which rows the two lists hold under a filter,
 * which row is selected after a rebuild, where Previous / Next land, the
 * title, the list widths `LoadSettings` restores, and `AddFootprintToPCB`.
 *
 * `footprint_viewer_frame_ui.tsx` is the window; it owns the lists, the
 * canvas and the toolbars those decisions drive, the way
 * `footprint_edit_frame_ui.tsx` owns `FOOTPRINT_EDIT_FRAME`'s.
 */
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { RSTRING_T } from '@ziroeda/common/project.js';
import { EdaCombinedMatcher } from '@ziroeda/common/eda_pattern_match.js';
import { PINNING_SYMBOL } from '@ziroeda/common/lib_tree_model_adapter.js';
import type { FOOTPRINT_INFO } from '@ziroeda/common/footprint_info.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { ABOUT_TITLES } from '@ziroeda/common/eda_base_frame_about_titles.js';
import { listBoxFindString, wxNOT_FOUND } from '@ziroeda/common/widgets/wx_listbox.js';
import { IGNORE_PARENT_GROUP } from '@ziroeda/common/eda_item.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { COMMON_CONTROL } from '@ziroeda/common/tool/common_control.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { BOARD, BOARD_USE } from './board.js';
import { BOARD_COMMIT } from './board_commit.js';
import type { BOARD_ITEM_CONTAINER } from './board_item_container.js';
import type { FOOTPRINT } from './footprint.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from './footprint_library_adapter.js';
import { type FOOTPRINT_EDITOR_SETTINGS_LIKE, PCB_BASE_FRAME } from './pcb_base_frame.js';
import { PCB_SCREEN } from './pcb_screen.js';
import { PCBNEW_SETTINGS } from './pcbnew_settings.js';
import { FPVIEWER_CONSTANTS, PCB_ACTIONS } from './tools/pcb_actions.js';
import { PCB_CONTROL } from './tools/pcb_control.js';
import { PCB_PICKER_TOOL } from './tools/pcb_picker_tool.js';
import { PCB_SELECTION_TOOL } from './tools/pcb_selection_tool.js';
import { PCB_VIEWER_TOOLS } from './tools/pcb_viewer_tools.js';

/**
 * `enum class FPVIEWER_CONSTANTS` (`footprint_viewer_frame.h:41-47`). Declared
 * with the actions whose parameter it is, which load before this module.
 */
export { FPVIEWER_CONSTANTS };

/** `_( "Footprint Library Browser" )`, the constructor's title and the title's tail. */
export const FOOTPRINT_VIEWER_TITLE = 'Footprint Library Browser';

/** `_( "[no library selected]" )` (`UpdateTitle`). */
export const FPVIEWER_NO_LIBRARY = '[no library selected]';

/** `_( "No board currently open." )` (`AddFootprintToPCB`). */
export const FPVIEWER_NO_BOARD = 'No board currently open.';

/** `_( "Previous footprint placement still in progress." )` (`AddFootprintToPCB`). */
export const FPVIEWER_PLACEMENT_IN_PROGRESS = 'Previous footprint placement still in progress.';

/**
 * `m_fpFilter->SetToolTip( … )` (`footprint_viewer_frame.cpp:154-157`), the
 * two spaces after "spaces." included.
 */
export const FPVIEWER_FP_FILTER_TOOLTIP =
  'Filter on footprint name, keywords, description and pad count.\n' +
  'Search terms are separated by spaces.  All search terms must match.\n' +
  'A term which is a number will also match against the pad count.';

/** `m_libListWidth = 200; m_fpListWidth = 300;` and the panes' `BestSize`. */
export const FPVIEWER_LIB_LIST_BEST_WIDTH = 200;
export const FPVIEWER_FP_LIST_BEST_WIDTH = 300;
/** `.MinSize( 100, -1 )` on both palettes. */
export const FPVIEWER_LIST_MIN_WIDTH = 100;

/** `wxStringTokenizer( filter, " \t\r\n", wxTOKEN_STRTOK )`: empty tokens dropped. */
export function filterTokens(aFilter: string): string[] {
  return aFilter.split(/[ \t\r\n]+/).filter((t) => t !== '');
}

/**
 * `wxString::IsNumber()`: an optional sign, then nothing but ASCII digits.
 * wx's loop accepts a bare sign too (the digit loop simply runs zero times),
 * so `"-"` is a "number" whose `wxAtoi` is 0 — ported as upstream has it.
 */
export function wxIsNumber(aText: string): boolean {
  return aText !== '' && /^[+-]?[0-9]*$/.test(aText);
}

/** `wxAtoi`: the leading integer, 0 when there is none. */
function wxAtoi(aText: string): number {
  const n = Number.parseInt(aText, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * `ReCreateLibraryList()`'s rows (`footprint_viewer_frame.cpp:404-455`).
 *
 * An empty filter lists every nickname. Otherwise the filter is split into
 * terms and EACH term is swept over every nickname: a library matched by any
 * term is listed — and a library two terms both match is `process()`ed twice
 * and appended twice. There is no de-duplication upstream; that is ported.
 *
 * Pinned libraries (the project's `m_PinnedFootprintLibs` or the user's
 * `session.pinned_fp_libs`) come first, each wearing `GetPinningSymbol()`.
 */
export function libraryListRows(
  aNicknames: readonly string[],
  aFilter: string,
  aIsPinned: (aNickname: string) => boolean,
): string[] {
  const pinnedMatches: string[] = [];
  const otherMatches: string[] = [];

  const process = (aNickname: string): void => {
    if (aIsPinned(aNickname)) pinnedMatches.push(aNickname);
    else otherMatches.push(aNickname);
  };

  if (aFilter === '') {
    for (const nickname of aNicknames) process(nickname);
  } else {
    for (const token of filterTokens(aFilter)) {
      const term = token.toLowerCase();
      const matcher = new EdaCombinedMatcher(term);

      for (const nickname of aNicknames) {
        if (matcher.find(nickname.toLowerCase()) >= 0) process(nickname);
      }
    }
  }

  return [...pinnedMatches.map((n) => PINNING_SYMBOL + n), ...otherMatches];
}

/**
 * `ReCreateFootprintList()`'s rows (`footprint_viewer_frame.cpp:458-515`).
 *
 * Unlike the library list, every term must match: a footprint that scores
 * nothing against any one term is excluded. A term that `IsNumber()` also
 * matches when it equals the pad count. The survivors keep the library's
 * order.
 *
 * Upstream scores the loaded `FOOTPRINT`s; this scores the library index's
 * `FOOTPRINT_INFO`s, whose `GetSearchTerms()` is the same list term for term
 * (`common/footprint_info.cpp:67-86` against `pcbnew/footprint.cpp:1707-1725`).
 * The one difference is the pad count: `GetPadCount( DO_NOT_INCLUDE_NPTH )`
 * counts every plated pad, and the hosted index carries the UNIQUE numbered
 * pad count only (`footprint_info_impl.ts`), so a footprint with two pads
 * sharing a number answers one less.
 */
export function footprintListRows(
  aFootprints: readonly FOOTPRINT_INFO[],
  aFilter: string,
): string[] {
  const excludes = new Set<string>();

  for (const token of filterTokens(aFilter)) {
    const filterTerm = token.toLowerCase();
    const matcher = new EdaCombinedMatcher(filterTerm);

    for (const footprint of aFootprints) {
      let matched = matcher.scoreTerms(footprint.GetSearchTerms()).score;

      if (wxIsNumber(filterTerm) && wxAtoi(filterTerm) === footprint.GetPadCount()) matched++;

      if (!matched) excludes.add(footprint.GetFootprintName());
    }
  }

  const rows: string[] = [];

  for (const footprint of aFootprints) {
    const fpName = footprint.GetFootprintName();

    if (!excludes.has(fpName)) rows.push(fpName);
  }

  return rows;
}

/**
 * The tail of `ReCreateLibraryList` / `ReCreateFootprintList`: the row the
 * rebuilt list selects. The current name if the list still holds it
 * (`FindString( name, true )`, case-sensitive), else the first row, else none.
 * Either way a selected row is then "clicked".
 */
export function listSelectionAfterRebuild(aRows: readonly string[], aCurrent: string): number {
  const index = aCurrent === '' ? wxNOT_FOUND : listBoxFindString(aRows, aCurrent, true);

  if (index !== wxNOT_FOUND) return index;

  return aRows.length > 0 ? 0 : wxNOT_FOUND;
}

/** `selectPrev( aListBox )`: one up, or nothing at the top (and nothing with no selection). */
export function selectPrevIndex(aSelection: number): number | null {
  const prev = aSelection - 1;

  return prev >= 0 ? prev : null;
}

/** `selectNext( aListBox )`: one down, or nothing past the end. */
export function selectNextIndex(aSelection: number, aCount: number): number | null {
  const next = aSelection + 1;

  return next < aCount ? next : null;
}

/**
 * `SelectAndViewFootprint( aMode )`'s index arithmetic
 * (`footprint_viewer_frame.cpp:1025-1040`): find the current footprint
 * (case-sensitively), then step once for NEXT / PREVIOUS, stopping at either
 * end. {@link wxNOT_FOUND} when the current name is not in the list, and the
 * frame then shows nothing new.
 */
export function stepFootprintSelection(
  aRows: readonly string[],
  aCurrent: string,
  aMode: FPVIEWER_CONSTANTS,
): number {
  let selection = listBoxFindString(aRows, aCurrent, true);

  if (aMode === FPVIEWER_CONSTANTS.NEXT_PART) {
    if (selection !== wxNOT_FOUND && selection < aRows.length - 1) selection++;
  }

  if (aMode === FPVIEWER_CONSTANTS.PREVIOUS_PART) {
    if (selection !== wxNOT_FOUND && selection > 0) selection--;
  }

  return selection;
}

/**
 * `UpdateTitle()` (`footprint_viewer_frame.cpp:995-1016`):
 * `"<nickname> — <full URI> — Footprint Library Browser"`, or
 * `"[no library selected] — …"` when there is no library or its URI cannot be
 * resolved. The dashes are U+2014 with a space either side.
 */
export function footprintViewerTitle(aNickname: string, aFullUri: string | null): string {
  let title: string;

  if (aNickname !== '' && aFullUri !== null) title = `${aNickname} — ${aFullUri}`;
  else title = FPVIEWER_NO_LIBRARY;

  return `${title} — ${FOOTPRINT_VIEWER_TITLE}`;
}

/**
 * `LoadSettings`' "set parameters to a reasonable value" (`:808-815`):
 *
 *     int maxWidth = cfg->m_FootprintViewer.state.size_x - 80;
 *     if( m_libListWidth + m_fpListWidth > maxWidth )
 *     {
 *         m_libListWidth = maxWidth * ( m_libListWidth / ( m_libListWidth + m_fpListWidth ) );
 *         m_fpListWidth = maxWidth - m_libListWidth;
 *     }
 *
 * All four are `int`, so `m_libListWidth / (sum)` is INTEGER division and is
 * 0 whenever the sum is larger — which is always, once there are two positive
 * widths. The clamp therefore zeroes the library list and hands the fp list
 * all of `maxWidth`. Ported with the truncation, because it decides what the
 * constructor does next: a width that is not `> 0` is not applied, and that
 * pane keeps its `BestSize`.
 */
export function clampFootprintViewerListWidths(
  aLibListWidth: number,
  aFpListWidth: number,
  aWindowWidth: number,
): { lib: number; fp: number } {
  const maxWidth = Math.trunc(aWindowWidth) - 80;
  let lib = Math.trunc(aLibListWidth);
  let fp = Math.trunc(aFpListWidth);

  if (lib + fp > maxWidth) {
    lib = maxWidth * Math.trunc(lib / (lib + fp));
    fp = maxWidth - lib;
  }

  return { lib, fp };
}

/** The width a pane opens at: the restored one when `> 0`, else its `BestSize`. */
export function paneWidthOrBest(aWidth: number, aBest: number): number {
  return aWidth > 0 ? aWidth : aBest;
}

/**
 * What `AddFootprintToPCB` asks of `FRAME_PCB_EDITOR`'s player beyond its
 * PCB_BASE_FRAME: `toolMgr->GetTool<BOARD_EDITOR_CONTROL>()->PlacingFootprint()`,
 * and `Kiway().GetBlockingDialog()->Close( true )`.
 */
export interface FOOTPRINT_VIEWER_PCB_TARGET extends PCB_BASE_FRAME {
  PlacingFootprint(): boolean;
  CloseBlockingDialog(): void;
}

function isPcbTarget(aFrame: unknown): aFrame is FOOTPRINT_VIEWER_PCB_TARGET {
  if (!(aFrame instanceof PCB_BASE_FRAME)) return false;

  const f = aFrame as Partial<FOOTPRINT_VIEWER_PCB_TARGET>;

  return typeof f.PlacingFootprint === 'function' && typeof f.CloseBlockingDialog === 'function';
}

/** What the frame reaches through its window. */
export interface FOOTPRINT_VIEWER_FRAME_HOOKS {
  /** `ReCreateLibraryList()`, which `MAIL_RELOAD_LIB` runs. */
  reCreateLibraryList(): void;
  /**
   * The list half of `SelectAndViewFootprint( aMode )`: the row stepped to and
   * selected, its name made current. The window then has {@link
   * FOOTPRINT_VIEWER_FRAME.ViewFootprint} load it.
   */
  selectAndViewFootprint(aMode: FPVIEWER_CONSTANTS): void;
}

/**
 * `FOOTPRINT_VIEWER_FRAME` (`footprint_viewer_frame.cpp`): the Footprint
 * Library Browser, a PCB_BASE_FRAME whose BOARD is a footprint holder showing
 * the one footprint picked in its lists. The two lists live in the window;
 * the board, its tools and the hand-over to the board editor live here.
 */
export class FOOTPRINT_VIEWER_FRAME extends PCB_BASE_FRAME {
  private readonly hooks: FOOTPRINT_VIEWER_FRAME_HOOKS;

  /**
   * Where `getCurNickname` / `getCurFootprintName` keep their answer when no
   * project is open. Upstream they are the project's retained strings
   * (`PCB_FOOTPRINT_VIEWER_LIB_NICKNAME`, `…_FP_NAME`); with no PROJECT there
   * is nowhere else to put them.
   */
  private m_curNickname = '';
  private m_curFootprintName = '';

  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )`. */
  private m_footprintLibAdapter: FOOTPRINT_LIBRARY_ADAPTER | null = null;

  /** `SelectAndViewFootprint`'s load in flight; a newer one supersedes it. */
  private m_loadSerial = 0;

  constructor(hooks: FOOTPRINT_VIEWER_FRAME_HOOKS) {
    super(FRAME_T.FRAME_FOOTPRINT_VIEWER);
    this.hooks = hooks;
    // `m_aboutTitle = _HKI( "KiCad Footprint Library Browser" )`, the product
    // being ours.
    this.m_aboutTitle = ABOUT_TITLES.footprintViewer;

    this.SetBoard(new BOARD());

    // This board will only be used to hold a footprint for viewing
    this.GetBoard()!.SetBoardUse(BOARD_USE.FPHOLDER);

    // In viewer, the default net clearance is not known (it depends on the actual board).
    // So we do not show the default clearance, by setting it to 0
    // The footprint or pad specific clearance will be shown
    this.GetBoard()!.GetDesignSettings().m_NetSettings.GetDefaultNetclass().SetClearance(0);

    // Don't show the default board solder mask clearance in the footprint viewer.  Only the
    // footprint or pad clearance setting should be shown if it is not 0.
    this.GetBoard()!.GetDesignSettings().m_SolderMaskExpansion = 0;

    // Ensure all layers and items are visible:
    this.GetBoard()!.SetVisibleAlls();

    this.SetScreen(new PCB_SCREEN(this.GetPageSizeIU()));

    this.GetScreen()!.m_Center = true; // Center coordinate origins on screen.

    this.GetGalDisplayOptions().m_axesEnabled = true;

    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(this.GetBoard(), null, null, this.config(), this);
    this.m_toolDispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    this.m_toolManager.RegisterTool(new PCB_CONTROL());
    this.m_toolManager.RegisterTool(new PCB_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new COMMON_TOOLS()); // for std context menus (zoom & grid)
    this.m_toolManager.RegisterTool(new COMMON_CONTROL());
    this.m_toolManager.RegisterTool(new PCB_PICKER_TOOL()); // for setting grid origin
    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.RegisterTool(new PCB_VIEWER_TOOLS());

    this.m_toolManager.GetTool(PCB_VIEWER_TOOLS)!.SetFootprintFrame(true);

    this.m_toolManager.InitTools();
    this.m_toolManager.InvokeTool('common.InteractiveSelection');
  }

  GetName(): string {
    return 'FootprintViewerFrame';
  }

  /** `GetModel()`: `GetBoard()->GetFirstFootprint()`. */
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.GetBoard()?.GetFirstFootprint() ?? null;
  }

  /** `Kiface().KifaceSettings()`: pcbnew's settings, which `FootprintAutoZoom` flips. */
  override config(): PCBNEW_SETTINGS {
    return this.GetPcbNewSettings();
  }

  /**
   * `SelectAndViewFootprint( aMode )` (`footprint_viewer_frame.cpp:1013-1060`),
   * which `PCB_CONTROL::IterateFootprint` runs with the action's parameter.
   */
  SelectAndViewFootprint(aMode: FPVIEWER_CONSTANTS): void {
    if (this.getCurNickname() === '') return;

    this.hooks.selectAndViewFootprint(aMode);
  }

  /** `PCB_BASE_FRAME::GetPcbNewSettings()`: `GetAppSettings<PCBNEW_SETTINGS>( "pcbnew" )`. */
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    const cfg = PgmOrNull()?.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');

    if (cfg) return cfg;

    // No PGM_BASE (a unit test): the defaults, kept so edits to them stick.
    if (!this.m_fallbackSettings) this.m_fallbackSettings = new PCBNEW_SETTINGS();

    return this.m_fallbackSettings;
  }

  private m_fallbackSettings: PCBNEW_SETTINGS | null = null;

  /** `PCB_BASE_FRAME::GetFootprintEditorSettings()`; the viewer reads none of it. */
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }

  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )`, handed in by the window. */
  SetFootprintLibAdapter(aAdapter: FOOTPRINT_LIBRARY_ADAPTER | null): void {
    this.m_footprintLibAdapter = aAdapter;
    this.GetBoard()?.SetFootprintLibAdapter(aAdapter);
  }

  GetFootprintLibAdapter(): FOOTPRINT_LIBRARY_ADAPTER | null {
    return this.m_footprintLibAdapter;
  }

  /** `Prj().GetRString( … )`, or the frame's own copy when there is no project. */
  private rstring(aId: RSTRING_T, aFallback: string): string {
    try {
      return this.Prj().GetRString(aId);
    } catch {
      return aFallback;
    }
  }

  private setRstring(aId: RSTRING_T, aValue: string): void {
    try {
      this.Prj().SetRString(aId, aValue);
    } catch {
      // No PROJECT: the member below is the only copy.
    }
  }

  /** `getCurNickname()`: `PROJECT::PCB_FOOTPRINT_VIEWER_LIB_NICKNAME`. */
  getCurNickname(): string {
    return this.rstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_LIB_NICKNAME, this.m_curNickname);
  }

  setCurNickname(aNickname: string): void {
    this.m_curNickname = aNickname;
    this.setRstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_LIB_NICKNAME, aNickname);
  }

  /** `getCurFootprintName()`: `PROJECT::PCB_FOOTPRINT_VIEWER_FP_NAME`. */
  getCurFootprintName(): string {
    return this.rstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_FP_NAME, this.m_curFootprintName);
  }

  setCurFootprintName(aName: string): void {
    this.m_curFootprintName = aName;
    this.setRstring(RSTRING_T.PCB_FOOTPRINT_VIEWER_FP_NAME, aName);
  }

  /**
   * The board half of `SelectAndViewFootprint( aMode )`
   * (`footprint_viewer_frame.cpp:1031-1055`), once the list has settled on a
   * name: the selection cleared quietly, the board emptied, the footprint
   * loaded from the library and shown, and the view updated. The library's
   * file may still be on its way, so the load is awaited; a newer call
   * supersedes an older one still waiting.
   */
  async ViewFootprint(): Promise<void> {
    const serial = ++this.m_loadSerial;
    const board = this.GetBoard()!;

    // Delete the current footprint
    this.m_toolManager?.GetTool(PCB_SELECTION_TOOL)?.ClearSelection(true /* quiet mode */);

    board.DeleteAllFootprints();
    board.RemoveUnusedNets(null);

    const nickname = this.getCurNickname();
    const name = this.getCurFootprintName();
    const adapter = this.m_footprintLibAdapter;
    let footprint: FOOTPRINT | null = null;

    if (adapter && nickname !== '' && name !== '') {
      footprint = adapter.LoadFootprintAsync
        ? await adapter.LoadFootprintAsync(nickname, name, false)
        : adapter.LoadFootprint(nickname, name, false);
    }

    if (serial !== this.m_loadSerial) return;

    if (footprint) this.displayFootprint(footprint);

    this.Update3DView(true, true);
    this.updateView();
    this.GetCanvas()?.Refresh();
  }

  /**
   * `displayFootprint( aFootprint )`. Upstream first gives each pad a net
   * named for its pin function from `m_comp`, the COMPONENT CvPcb's caller
   * hands in; the browser opened on its own has an empty one, so no pad gets
   * a net.
   */
  private displayFootprint(aFootprint: FOOTPRINT): void {
    this.GetBoard()!.Add(aFootprint);

    this.m_toolManager?.RunAction(PCB_ACTIONS.rehatchShapes);
  }

  /** `updateView()` (`:1063-1079`). */
  updateView(): void {
    const canvas = this.GetCanvas();

    if (canvas) {
      canvas.UpdateColors();
      canvas.DisplayBoard(this.GetBoard()!);
    }

    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);

    const cfg = this.GetPcbNewSettings();

    if (canvas) {
      if (cfg.m_FootprintViewerAutoZoomOnSelect)
        this.m_toolManager?.RunAction(ACTIONS.zoomFitScreen);
      else this.m_toolManager?.RunAction(ACTIONS.centerContents);
    }

    this.UpdateMsgPanel();
  }

  /** `UpdateMsgPanel()` (`:325-336`): the footprint's own message panel. */
  override UpdateMsgPanel(): void {
    super.UpdateMsgPanel();

    const fp = this.GetModel() as FOOTPRINT | null;

    if (fp) {
      const msgItems: MSG_PANEL_ITEM[] = [];
      fp.GetMsgPanelInfo(this.AsDrawFrameLike(), msgItems);
      this.SetMsgPanel(msgItems);
    } else {
      this.SetMsgPanel([]);
    }
  }

  /** `FOOTPRINT_VIEWER_FRAME::KiwayMailIn` (`footprint_viewer_frame.cpp:973-984`). */
  override KiwayMailIn(mail: KIWAY_MAIL_EVENT): void {
    switch (mail.Command()) {
      case MAIL_T.MAIL_RELOAD_LIB:
        this.hooks.reCreateLibraryList();
        break;

      default:
        break;
    }
  }

  /**
   * `AddFootprintToPCB()` (`footprint_viewer_frame.cpp:744-801`): hand a copy
   * of the footprint on show to the board editor, on the cursor, and raise it.
   *
   * Nothing happens with no footprint on the board. With no board editor alive
   * it is `DisplayErrorMessage( "No board currently open." )`; with a
   * placement already riding the cursor there, `DisplayError( "Previous
   * footprint placement still in progress." )`. KiCad's `DisplayError` is the
   * same modal box with a different caption; there is one error box here.
   *
   * Returns whether the footprint was handed over.
   */
  AddFootprintToPCB(): boolean {
    const shown = this.GetBoard()?.GetFirstFootprint() ?? null;

    if (!shown) return false;

    const kiway = this.Kiway();
    const pcbframe = kiway?.GetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR) ?? null;

    // happens when the board editor is not active (or closed)
    if (!isPcbTarget(pcbframe)) {
      DisplayErrorMessage(FPVIEWER_NO_BOARD);
      return false;
    }

    const cfg = pcbframe.GetPcbNewSettings();
    const toolMgr = pcbframe.GetToolManager()!;

    if (pcbframe.PlacingFootprint()) {
      DisplayErrorMessage(FPVIEWER_PLACEMENT_IN_PROGRESS);
      return false;
    }

    pcbframe.CloseBlockingDialog();

    toolMgr.RunAction(ACTIONS.selectionClear);
    const commit = new BOARD_COMMIT(pcbframe);

    // Create the "new" footprint
    const newFootprint = shown.Duplicate(IGNORE_PARENT_GROUP) as FOOTPRINT;
    newFootprint.SetParent(pcbframe.GetBoard());
    newFootprint.SetLink(niluuid);
    newFootprint.SetFlags(IS_NEW); // whatever

    for (const pad of newFootprint.Pads()) {
      // Set the pads ratsnest settings to the global settings
      pad.SetLocalRatsnestVisible(cfg.m_Display.m_ShowGlobalRatsnest);

      // Pads in the library all have orphaned nets.  Replace with Default.
      pad.SetNetCode(0);
    }

    // Put it on FRONT layer,
    // (Can be stored flipped if the lib is an archive built from a board)
    if (newFootprint.IsFlipped())
      newFootprint.Flip(newFootprint.GetPosition(), cfg.m_FlipDirection);

    const viewControls = pcbframe.GetCanvas()?.GetViewControls() ?? null;
    const cursorPos = viewControls?.GetCursorPosition() ?? { x: 0, y: 0 };

    commit.Add(newFootprint);
    viewControls?.SetCrossHairCursorPosition({ x: 0, y: 0 }, false);
    pcbframe.PlaceFootprint(newFootprint);

    newFootprint.SetPosition({ x: 0, y: 0 });
    viewControls?.SetCrossHairCursorPosition(cursorPos, false);
    commit.Push('Insert Footprint');

    // `pcbframe->Raise()`.
    kiway?.Player(FRAME_T.FRAME_PCB_EDITOR);
    toolMgr.PostAction(PCB_ACTIONS.placeFootprint, newFootprint);

    newFootprint.ClearFlags();

    return true;
  }
}

/** `LIB_ID( getCurNickname(), getCurFootprintName() )`, for a caller that wants one. */
export function viewerLibId(aFrame: FOOTPRINT_VIEWER_FRAME): LIB_ID {
  return new LIB_ID(aFrame.getCurNickname(), aFrame.getCurFootprintName());
}
