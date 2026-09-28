// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/common_control.cpp` + `include/tool/common_control.h`:
 * COMMON_CONTROL, the tool every KiCad frame registers for the actions shared
 * between applications - Preferences, the library tables, the other editors,
 * Quit, and the Help menu.
 *
 * What the program does for a KIWAY call is `common/kiway.ts`'s. Two
 * differences from the C++, both settled before this port:
 *
 * - ACTIONS::help and ACTIONS::gettingStarted open our handbook. Upstream
 *   looks for an installed copy first (`SearchHelpFileFullPath`) and asks
 *   before going online; a browser has no installed copy, so the question
 *   would be asked every time and answered the same way. Upstream's handbook
 *   is one book per kiface (`help_name()`); ours is one site, so ACTIONS::help
 *   opens its front page from every frame.
 * - ACTIONS::getInvolved and ACTIONS::reportBug point at our repository, as
 *   the Help menu does (`eda_base_frame_help_menu.ts`).
 *
 * `Execute( aExecutible, aParam )` starts a KiCad binary; every binary it can
 * name is an editor here, so ACTIONS::showCalculatorTools goes through
 * `KIWAY::Player` like the other players. ReloadPlugins is KICAD_IPC_API only,
 * which a browser build does not have: it does nothing, as upstream does when
 * the API server is disabled.
 */

import { GetVersionInfoData } from '../build_version.js';
import { DisplayInfoMessage } from '../confirm.js';
import type { EDA_BASE_FRAME } from '../eda_base_frame.js';
import { FRAME_T } from '../frame_type.js';
import { DisplayHotkeyList } from '../hotkeys_basic.js';
import { wxLaunchDefaultBrowser } from '../wx/utils.js';
import { ACTIONS } from './actions.js';
import type { RESET_REASON } from './tool_base.js';
import type { TOOL_EVENT } from './tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from './tool_interactive.js';

/** `URL_GET_INVOLVED`. */
export const URL_GET_INVOLVED = 'https://github.com/ZiroEDA/ziro-designer';
/** `URL_DONATE`: KiCad's own page. No menu row runs ACTIONS::donate here. */
export const URL_DONATE = 'https://go.kicad.org/app-donate';
/** `URL_DOCUMENTATION`: the handbook ACTIONS::help opens. */
export const URL_DOCUMENTATION = 'https://docs.ziroeda.com/';
/** The getting-started guide ACTIONS::gettingStarted opens. */
export const URL_GETTING_STARTED = 'https://docs.ziroeda.com/getting-started';
/** Where ACTIONS::reportBug files an issue. */
export const REPORT_BUG_URL = 'https://github.com/ZiroEDA/ziro-designer/issues';

/**
 * Handle actions that are shared between different applications
 */
export class COMMON_CONTROL extends TOOL_INTERACTIVE {
  ///< Pointer to the currently used edit frame.
  private m_frame: EDA_BASE_FRAME | null;

  /// URL to launch a new issue with pre-populated description
  static m_bugReportUrl = `${REPORT_BUG_URL}/new?body=%s`;

  /// Issue template to use for reporting bugs (this should not be translated)
  static m_bugReportTemplate = '```\n%s\n```';

  constructor() {
    super('common.SuiteControl');
    this.m_frame = null;
  }

  private frame(): EDA_BASE_FRAME {
    return this.m_frame!;
  }

  /// @copydoc TOOL_BASE::Reset()
  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<EDA_BASE_FRAME>();
  }

  OpenPreferences(_aEvent: TOOL_EVENT): number {
    this.frame().ShowPreferences('', '');
    return 0;
  }

  ConfigurePaths(_aEvent: TOOL_EVENT): number {
    // Upstream has pcbnew put the dialog up when it is running, so the 3D
    // paths can be edited too; the program decides which kiface answers.
    this.frame().Kiway()?.CreateKiWindow(FRAME_T.DIALOG_CONFIGUREPATHS);
    return 0;
  }

  ShowLibraryTable(aEvent: TOOL_EVENT): number {
    const kiway = this.frame().Kiway();

    // A kiface that is not available contains the dialog; do nothing, as the
    // C++ catch( ... ) does.
    if (aEvent.IsAction(ACTIONS.showSymbolLibTable))
      kiway?.CreateKiWindow(FRAME_T.DIALOG_SCH_LIBRARY_TABLE);
    else if (aEvent.IsAction(ACTIONS.showFootprintLibTable))
      kiway?.CreateKiWindow(FRAME_T.DIALOG_PCB_LIBRARY_TABLE);
    else if (aEvent.IsAction(ACTIONS.showDesignBlockLibTable))
      kiway?.CreateKiWindow(FRAME_T.DIALOG_DESIGN_BLOCK_LIBRARY_TABLE);

    return 0;
  }

  ShowPlayer(aEvent: TOOL_EVENT): number {
    const playerType = aEvent.Parameter<FRAME_T>();

    // editor can be null if Player() fails:
    if (!this.frame().Kiway()?.Player(playerType))
      console.warn('Cannot open/create the editor frame');

    return 0;
  }

  Quit(_aEvent: TOOL_EVENT): number {
    // m_frame->CallAfter( ... )
    queueMicrotask(() => this.frame().Kiway()?.OnKiCadExit());
    return 0;
  }

  Execute(aEvent: TOOL_EVENT): number {
    if (aEvent.IsAction(ACTIONS.showCalculatorTools))
      this.frame().Kiway()?.Player(FRAME_T.FRAME_CALC);
    else console.assert(false, 'Execute(): unexpected request');

    return 0;
  }

  ShowProjectManager(_aEvent: TOOL_EVENT): number {
    const kiway = this.frame().Kiway();

    if (kiway?.HasProjectManager()) kiway.ShowProjectManager();
    else void DisplayInfoMessage('Can not switch to project manager in stand-alone mode.');

    return 0;
  }

  ShowHelp(aEvent: TOOL_EVENT): number {
    // We have to get document for beginners, or the full specific doc.
    if (aEvent.IsAction(ACTIONS.gettingStarted)) wxLaunchDefaultBrowser(URL_GETTING_STARTED);
    else wxLaunchDefaultBrowser(URL_DOCUMENTATION);

    return 0;
  }

  About(_aEvent: TOOL_EVENT): number {
    this.frame().ShowAboutDialog();
    return 0;
  }

  ListHotKeys(_aEvent: TOOL_EVENT): number {
    DisplayHotkeyList(this.frame());
    return 0;
  }

  GetInvolved(_aEvent: TOOL_EVENT): number {
    if (!wxLaunchDefaultBrowser(URL_GET_INVOLVED)) {
      void DisplayInfoMessage(
        `Could not launch the default browser.\nFor information on how to help the KiCad project, visit ${URL_GET_INVOLVED}`,
      );
    }

    return 0;
  }

  Donate(_aEvent: TOOL_EVENT): number {
    if (!wxLaunchDefaultBrowser(URL_DONATE)) {
      void DisplayInfoMessage(
        `Could not launch the default browser.\nTo donate to the KiCad project, visit ${URL_DONATE}`,
      );
    }

    return 0;
  }

  ReportBug(_aEvent: TOOL_EVENT): number {
    const version = GetVersionInfoData(this.frame().m_aboutTitle, false, true);
    const message = COMMON_CONTROL.m_bugReportTemplate.replace('%s', version);
    const url = COMMON_CONTROL.m_bugReportUrl.replace('%s', encodeURIComponent(message));

    wxLaunchDefaultBrowser(url);

    return 0;
  }

  ReloadPlugins(_aEvent: TOOL_EVENT): number {
    return 0;
  }

  ///< Sets up handlers for various events.
  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.Quit), ACTIONS.quit.MakeEvent());

    this.Go(SYNC_HANDLER(this.OpenPreferences), ACTIONS.openPreferences.MakeEvent());
    this.Go(SYNC_HANDLER(this.ConfigurePaths), ACTIONS.configurePaths.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowLibraryTable), ACTIONS.showSymbolLibTable.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowLibraryTable), ACTIONS.showFootprintLibTable.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowLibraryTable), ACTIONS.showDesignBlockLibTable.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowPlayer), ACTIONS.showSymbolBrowser.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowPlayer), ACTIONS.showSymbolEditor.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowPlayer), ACTIONS.showFootprintBrowser.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowPlayer), ACTIONS.showFootprintEditor.MakeEvent());
    this.Go(SYNC_HANDLER(this.Execute), ACTIONS.showCalculatorTools.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowProjectManager), ACTIONS.showProjectManager.MakeEvent());

    this.Go(SYNC_HANDLER(this.ShowHelp), ACTIONS.gettingStarted.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowHelp), ACTIONS.help.MakeEvent());
    this.Go(SYNC_HANDLER(this.ListHotKeys), ACTIONS.listHotKeys.MakeEvent());
    this.Go(SYNC_HANDLER(this.GetInvolved), ACTIONS.getInvolved.MakeEvent());
    this.Go(SYNC_HANDLER(this.Donate), ACTIONS.donate.MakeEvent());
    this.Go(SYNC_HANDLER(this.ReportBug), ACTIONS.reportBug.MakeEvent());
    this.Go(SYNC_HANDLER(this.About), ACTIONS.about.MakeEvent());
    this.Go(SYNC_HANDLER(this.ReloadPlugins), ACTIONS.pluginsReload.MakeEvent());
  }
}
