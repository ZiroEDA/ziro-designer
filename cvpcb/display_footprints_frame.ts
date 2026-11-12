// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DISPLAY_FOOTPRINTS_FRAME` (`cvpcb/display_footprints_frame.cpp`): the
 * window CvPcb's "View Selected Footprint" opens — a PCB_BASE_FRAME whose
 * BOARD is a footprint holder showing the footprint picked in Assign
 * Footprints, through the same PCB_DRAW_PANEL_GAL and PCB_PAINTER every
 * PCB frame draws with. The window is `display_footprints_frame_ui.tsx`.
 */
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { DEFAULT_THEME, GetColorSettings, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import type { WINDOW_SETTINGS, APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { COMMON_TOOLS } from '@ziroeda/common/tool/common_tools.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { ZOOM_TOOL } from '@ziroeda/common/tool/zoom_tool.js';
import { BOARD, BOARD_USE } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { FOOTPRINT_LIBRARY_ADAPTER } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { fpEditKifaceSettings } from '@ziroeda/pcbnew/footprint_editor_settings.js';
import { PCB_BASE_FRAME } from '@ziroeda/pcbnew/pcb_base_frame.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import {
  type MAGNETIC_SETTINGS,
  PCBNEW_SETTINGS,
  type PCB_VIEWERS_SETTINGS_BASE,
} from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { PCB_EDITOR_CONDITIONS } from '@ziroeda/pcbnew/tools/pcb_editor_conditions.js';
import { ACTION_CONDITIONS } from '@ziroeda/common/tool/action_manager.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import { PCB_VIEWER_TOOLS } from '@ziroeda/pcbnew/tools/pcb_viewer_tools.js';
import { CVPCB_SETTINGS } from './cvpcb_settings.js';
import { CVPCB_FOOTPRINT_VIEWER_SELECTION_TOOL } from './tools/cvpcb_fpviewer_selection_tool.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `FOOTPRINTVIEWER_FRAME_NAME`. */
export const FOOTPRINTVIEWER_FRAME_NAME = 'ModViewFrame';

/** `_( "Footprint ID '%s' is not valid." )` and the three other GetFootprint reports. */
export const footprintIdNotValid = (aName: string): string =>
  wxFormat(_("Footprint ID '%s' is not valid."), aName);
export const libraryNotInTable = (aNickname: string): string =>
  wxFormat(_("Library '%s' is not in the footprint library table."), aNickname);
export const footprintNotFound = (aName: string): string =>
  wxFormat(_("Footprint '%s' not found."), aName);
export const errorLoadingFootprint = (aWhat: string): string =>
  wxFormat(_('Error loading footprint: %s'), aWhat);

/**
 * What `InitDisplay` reads off its parent CVPCB_MAINFRAME: the footprint
 * selected (or the selected symbol's own FPID), and the footprint list's
 * nickname for it.
 */
export interface DISPLAY_FOOTPRINTS_FRAME_PARENT {
  /** `GetSelectedFootprint()`, falling back to `comp->GetFPID().Format()`. */
  footprintName: string;
  /** `m_FootprintsList->GetFootprintInfo( footprintName )->GetLibNickname()`, or null. */
  libNickname: string | null;
}

/** What the frame reaches through its window. */
export interface DISPLAY_FOOTPRINTS_FRAME_HOOKS {
  /** `INFOBAR_REPORTER`'s report: the infobar's one message, or '' to dismiss it. */
  showInfoBar(aMessage: string): void;
  /** `SetTitle( … )`. */
  setTitle(aTitle: string): void;
}

export class DISPLAY_FOOTPRINTS_FRAME extends PCB_BASE_FRAME {
  private readonly hooks: DISPLAY_FOOTPRINTS_FRAME_HOOKS;
  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )`. */
  private m_footprintLibAdapter: FOOTPRINT_LIBRARY_ADAPTER | null = null;
  /** `m_currentFootprint`: the name last shown. */
  private m_currentFootprint = '';
  /** `InitDisplay`'s load in flight; a newer one supersedes it. */
  private m_loadSerial = 0;
  private m_fallbackPcbnew: PCBNEW_SETTINGS | null = null;
  private m_fallbackCvpcb: CVPCB_SETTINGS | null = null;

  constructor(hooks: DISPLAY_FOOTPRINTS_FRAME_HOOKS) {
    super(FRAME_T.FRAME_CVPCB_DISPLAY);
    this.hooks = hooks;

    this.SetBoard(new BOARD());

    // This board will only be used to hold a footprint for viewing
    this.GetBoard()!.SetBoardUse(BOARD_USE.FPHOLDER);

    this.SetScreen(new PCB_SCREEN(this.GetPageSizeIU()));

    // Don't show the default board solder mask expansion.  Only the footprint or pad expansion
    // settings should be shown.
    this.GetBoard()!.GetDesignSettings().m_SolderMaskExpansion = 0;

    this.LoadSettings(this.config());

    // Create the manager and dispatcher & route draw panel events to the dispatcher
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(this.GetBoard(), null, null, this.config(), this);
    this.m_toolDispatcher = new TOOL_DISPATCHER(this.m_toolManager);

    this.m_toolManager.RegisterTool(new COMMON_TOOLS());
    this.m_toolManager.RegisterTool(new ZOOM_TOOL());
    this.m_toolManager.RegisterTool(new CVPCB_FOOTPRINT_VIEWER_SELECTION_TOOL());
    this.m_toolManager.RegisterTool(new PCB_VIEWER_TOOLS());

    this.m_toolManager.GetTool(PCB_VIEWER_TOOLS)!.SetFootprintFrame(true);

    this.m_toolManager.InitTools();

    this.setupUIConditions();

    // Run the control tool, it is supposed to be always active
    this.m_toolManager.InvokeTool('common.InteractiveSelection');
  }

  /**
   * `setupUIConditions()` (display_footprints_frame.cpp:188-210): which buttons are lit - the
   * running tool's, the grid, and the display toggles, each read off the frame as wx asks.
   */
  protected override setupUIConditions(): void {
    super.setupUIConditions();

    const mgr = this.m_toolManager!.GetActionManager();
    const cond = new PCB_EDITOR_CONDITIONS(this);
    const CHECK = (x: SELECTION_CONDITION): ACTION_CONDITIONS => new ACTION_CONDITIONS().Check(x);
    const Not = SELECTION_CONDITIONS.Not;

    mgr.SetConditions(ACTIONS.zoomTool, CHECK(cond.CurrentTool(ACTIONS.zoomTool)));
    mgr.SetConditions(ACTIONS.selectionTool, CHECK(cond.CurrentTool(ACTIONS.selectionTool)));
    mgr.SetConditions(ACTIONS.measureTool, CHECK(cond.CurrentTool(ACTIONS.measureTool)));

    mgr.SetConditions(ACTIONS.toggleGrid, CHECK(cond.GridVisible()));

    mgr.SetConditions(PCB_ACTIONS.showPadNumbers, CHECK(cond.PadNumbersDisplay()));
    mgr.SetConditions(PCB_ACTIONS.padDisplayMode, CHECK(Not(cond.PadFillDisplay())));
    mgr.SetConditions(PCB_ACTIONS.textOutlines, CHECK(Not(cond.TextFillDisplay())));
    mgr.SetConditions(PCB_ACTIONS.graphicsOutlines, CHECK(Not(cond.GraphicsFillDisplay())));
    mgr.SetConditions(PCB_ACTIONS.fpAutoZoom, CHECK(cond.FootprintViewerAutoZoom()));
  }

  GetName(): string {
    return FOOTPRINTVIEWER_FRAME_NAME;
  }

  /** `Kiface().KifaceSettings()`: cvpcb's. */
  override config(): CVPCB_SETTINGS {
    const cfg = PgmOrNull()?.GetSettingsManager().GetAppSettings<CVPCB_SETTINGS>('cvpcb');

    if (cfg instanceof CVPCB_SETTINGS) return cfg;

    // No PGM_BASE, or none registered (a unit test): the defaults, kept.
    if (!this.m_fallbackCvpcb) this.m_fallbackCvpcb = new CVPCB_SETTINGS();

    return this.m_fallbackCvpcb;
  }

  /** `LoadSettings( aCfg )` (`:213-224`). */
  override LoadSettings(aCfg: APP_SETTINGS_BASE): void {
    // We don't allow people to change this right now, so make sure it's on
    this.GetWindowSettings(aCfg).cursor.always_show_cursor = true;

    if (aCfg instanceof CVPCB_SETTINGS) {
      super.LoadSettings(aCfg);
      this.SetDisplayOptions(aCfg.m_FootprintViewerDisplayOptions);
    }
  }

  /** `GetWindowSettings( aCfg )` (`:238-246`): `footprint_viewer.*` in cvpcb.json. */
  override GetWindowSettings(_aCfg: APP_SETTINGS_BASE): WINDOW_SETTINGS {
    return this.config().m_FootprintViewer;
  }

  /** `GetViewerSettingsBase()` (`:248-251`). */
  override GetViewerSettingsBase(): PCB_VIEWERS_SETTINGS_BASE {
    return this.config();
  }

  /** `GetMagneticItemsSettings()` (`:254-263`). */
  override GetMagneticItemsSettings(): MAGNETIC_SETTINGS {
    return this.config().m_FootprintViewerMagneticSettings;
  }

  /** `PCB_BASE_FRAME::GetPcbNewSettings()`. */
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    const cfg = PgmOrNull()?.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');

    if (cfg) return cfg;

    if (!this.m_fallbackPcbnew) this.m_fallbackPcbnew = new PCBNEW_SETTINGS();

    return this.m_fallbackPcbnew;
  }

  /**
   * `GetColorSettings( aForceRefresh )` (display_footprints_frame.cpp:453): the Footprint Editor's
   * theme. PCB_BASE_FRAME's own throws for a frame that does not override it, and this one draws.
   */
  override GetColorSettings(_aForceRefresh = false): COLOR_SETTINGS {
    const cfg = fpEditKifaceSettings();
    return GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME);
  }

  /** `GetModel()` (`:460-463`). */
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.GetBoard()?.GetFirstFootprint() ?? null;
  }

  /** `PROJECT_PCB::FootprintLibAdapter( &Prj() )`, handed in by the window. */
  SetFootprintLibAdapter(aAdapter: FOOTPRINT_LIBRARY_ADAPTER | null): void {
    this.m_footprintLibAdapter = aAdapter;
    this.GetBoard()?.SetFootprintLibAdapter(aAdapter);
  }

  /**
   * `GetFootprint( aFootprintName, aReporter )` (`:272-329`): the footprint
   * the name names, at the origin on this frame's board, or null with the
   * reason reported.
   */
  async GetFootprint(
    aFootprintName: string,
    aReport: (aMessage: string) => void,
  ): Promise<FOOTPRINT | null> {
    const fpid = new LIB_ID();

    if (fpid.Parse(aFootprintName) >= 0) {
      aReport(footprintIdNotValid(aFootprintName));
      return null;
    }

    const libNickname = fpid.GetUniStringLibNickname();
    const fpName = fpid.GetUniStringLibItemName();
    const adapter = this.m_footprintLibAdapter;

    // See if the library requested is in the library table
    if (!adapter?.HasLibrary(libNickname)) {
      aReport(libraryNotInTable(libNickname));
      return null;
    }

    // See if the footprint requested is in the library
    if (!adapter.FootprintExists(libNickname, fpName)) {
      aReport(footprintNotFound(aFootprintName));
      return null;
    }

    let footprint: FOOTPRINT | null;

    try {
      footprint = adapter.LoadFootprintAsync
        ? await adapter.LoadFootprintAsync(libNickname, fpName, false)
        : adapter.LoadFootprint(libNickname, fpName, false);
    } catch (ioe) {
      aReport(errorLoadingFootprint((ioe as Error).message));
      return null;
    }

    if (footprint) {
      footprint.SetFPID(fpid);
      footprint.SetParent(this.GetBoard());
      footprint.SetPosition({ x: 0, y: 0 });
      return footprint;
    }

    aReport(footprintNotFound(aFootprintName));
    return null;
  }

  /**
   * `InitDisplay()` (`:355-418`): show the footprint the parent has selected,
   * unless it is the one already shown. The board is emptied, the infobar
   * dismissed, the title set, the footprint loaded and added, status pane 0
   * written, and the view updated.
   *
   * Upstream also gives each pad its pin function from the selected
   * COMPONENT's nets; the symbols Assign Footprints holds carry no netlist
   * pin functions here, so there are none to give.
   */
  async InitDisplay(aParent: DISPLAY_FOOTPRINTS_FRAME_PARENT): Promise<void> {
    const footprintName = aParent.footprintName;

    if (this.m_currentFootprint === footprintName) return;

    const serial = ++this.m_loadSerial;
    const board = this.GetBoard()!;

    board.DeleteAllFootprints();
    this.GetCanvas()?.GetView().Clear();

    const reports: string[] = [];
    this.hooks.showInfoBar('');

    let footprint: FOOTPRINT | null = null;

    if (footprintName !== '') {
      this.hooks.setTitle(wxFormat(_('Footprint: %s'), footprintName));
      footprint = await this.GetFootprint(footprintName, (m) => reports.push(m));
    }

    if (serial !== this.m_loadSerial) return;

    if (footprint) {
      board.Add(footprint);
      this.GetCanvas()?.GetView().Update(footprint);
      this.m_currentFootprint = footprintName;
    } else {
      this.m_currentFootprint = '';
    }

    this.SetStatusText(aParent.libNickname ? wxFormat(_('Lib: %s'), aParent.libNickname) : '', 0);

    // `infoReporter.Finalize()`: the infobar shows what was reported.
    if (reports.length > 0) this.hooks.showInfoBar(reports.join('\n'));

    this.updateView();
    this.UpdateStatusBar();
    this.GetCanvas()?.Refresh();
    this.Update3DView(true, true);
  }

  /** `ReloadFootprint( aFootprint )` (`:331-352`). */
  ReloadFootprint(aFootprint: FOOTPRINT | null): void {
    if (!aFootprint) return;

    this.GetBoard()!.DeleteAllFootprints();
    this.GetCanvas()?.GetView().Clear();

    this.m_toolManager?.RunAction(PCB_ACTIONS.rehatchShapes);

    this.GetBoard()!.Add(aFootprint);
    this.updateView();
    this.GetCanvas()?.Refresh();
  }

  /** `updateView()` (`:421-438`). */
  updateView(): void {
    const dp = this.GetCanvas();

    if (dp) {
      dp.UpdateColors();
      dp.DisplayBoard(this.GetBoard()!);
    }

    this.m_toolManager?.ResetTools(RESET_REASON.MODEL_RELOAD);

    const cfg = this.config();

    if (dp) {
      if (cfg.m_FootprintViewerAutoZoomOnSelect)
        this.m_toolManager?.RunAction(ACTIONS.zoomFitScreen);
      else this.m_toolManager?.RunAction(ACTIONS.centerContents);
    }

    this.UpdateMsgPanel();
  }

  /** `UpdateMsgPanel()` (`:441-450`). */
  override UpdateMsgPanel(): void {
    const footprint = this.GetBoard()?.GetFirstFootprint() ?? null;
    const items: MSG_PANEL_ITEM[] = [];

    if (footprint) footprint.GetMsgPanelInfo(this.AsDrawFrameLike(), items);

    this.SetMsgPanel(items);
  }
}
