// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EDA_BASE_FRAME::AddStandardHelpMenu (common/eda_base_frame.cpp), ported.
 *
 *     void EDA_BASE_FRAME::AddStandardHelpMenu( wxMenuBar* aMenuBar )
 *     {
 *         COMMON_CONTROL* commonControl = m_toolManager->GetTool<COMMON_CONTROL>();
 *         ACTION_MENU*    helpMenu = new ACTION_MENU( false, commonControl );
 *
 *         helpMenu->Add( ACTIONS::help );
 *         helpMenu->Add( ACTIONS::gettingStarted );
 *         helpMenu->Add( ACTIONS::listHotKeys );
 *         helpMenu->Add( ACTIONS::getInvolved );
 *         helpMenu->Add( ACTIONS::donate );
 *         helpMenu->Add( ACTIONS::reportBug );
 *
 *         helpMenu->AppendSeparator();
 *         helpMenu->Add( ACTIONS::about );
 *
 *         aMenuBar->Append( helpMenu, _( "&Help" ) );
 *     }
 *
 * The point of this file is that there is one of it. Fourteen frames call that
 * function - eeschema, pcbnew, gerbview, pl_editor, the symbol and footprint
 * editors and viewers, cvpcb, the simulator, the 3D viewer, bitmap2component,
 * the calculator and the project manager - so every KiCad Help menu is the same
 * seven entries, because there is only one place they are written.
 *
 * Ours were written eight separate times and had drifted into eight different
 * menus: "About ZiroEDA" here, "About Ziro Design" there, "About Image
 * Converter" in the image converter, and only the project manager carrying
 * documentation, hotkeys or a bug link at all.
 *
 * Two deliberate differences from the transcription above, both already
 * settled: ACTIONS::donate is not carried, because a donation prompt for
 * another project belongs in that project's Help menu rather than ours; and
 * every link points at our own documentation and repository, for the same
 * reason.
 */
import { PRODUCT } from './eda_base_frame_about_titles.js';
import type { Menu, MenuItem } from './tool/action_menu_types.js';
import { ACTIONS } from './tool/actions.js';
import {
  REPORT_BUG_URL,
  URL_DOCUMENTATION,
  URL_GET_INVOLVED,
  URL_GETTING_STARTED,
} from './tool/common_control.js';
import type { TOOL_ACTION } from './tool/tool_action.js';

export { REPORT_BUG_URL };

export interface HelpMenuHandlers {
  /** ACTIONS::listHotKeys - opens DIALOG_LIST_HOTKEYS. */
  showHotkeys: () => void;
  /** ACTIONS::about. */
  showAbout: () => void;
}

const SEP: MenuItem = { sep: true };

const openExternal = (url: string) => (): void => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * ACTIONS::about's friendly name is "About KiCad" - the product, in every
 * frame, not the frame. Ours had four spellings of this across five editors.
 */
export const ABOUT_LABEL = `About ${PRODUCT}`;

/**
 * A frame whose Help menu is `ACTION_MENU( false, commonControl )`: each row
 * runs its action on the frame's TOOL_MANAGER, where COMMON_CONTROL answers
 * it (`common/tool/common_control.ts`).
 */
export interface HelpMenuToolManager {
  RunAction(aAction: TOOL_ACTION): unknown;
}

/**
 * The Help menu, identical in every frame, as upstream's is.
 *
 * Given a tool manager, the rows are the actions and COMMON_CONTROL runs them.
 * Given handlers, it is a frame that has not registered COMMON_CONTROL yet.
 */
export function standardHelpMenu(h: HelpMenuHandlers | HelpMenuToolManager): Menu {
  if ('RunAction' in h) {
    const run = (a: TOOL_ACTION) => (): void => {
      h.RunAction(a);
    };

    return helpMenu({
      help: run(ACTIONS.help),
      gettingStarted: run(ACTIONS.gettingStarted),
      showHotkeys: run(ACTIONS.listHotKeys),
      getInvolved: run(ACTIONS.getInvolved),
      reportBug: run(ACTIONS.reportBug),
      showAbout: run(ACTIONS.about),
    });
  }

  return helpMenu({
    help: openExternal(URL_DOCUMENTATION),
    gettingStarted: openExternal(URL_GETTING_STARTED),
    showHotkeys: h.showHotkeys,
    getInvolved: openExternal(URL_GET_INVOLVED),
    reportBug: openExternal(REPORT_BUG_URL),
    showAbout: h.showAbout,
  });
}

function helpMenu(r: {
  help: () => void;
  gettingStarted: () => void;
  showHotkeys: () => void;
  getInvolved: () => void;
  reportBug: () => void;
  showAbout: () => void;
}): Menu {
  return {
    label: 'Help',
    items: [
      // ACTIONS::help. Its FriendlyName is literally "Help", so the first row
      // of the Help menu is "Help" - the tooltip, not the label, is the one
      // that says "Open product documentation in a web browser". This had been
      // renamed "Documentation" here, which is our word, not upstream's.
      { label: 'Help', action: r.help },
      // ACTIONS::gettingStarted: "Getting Started with KiCad". The product name
      // is part of the label upstream, so it is part of ours.
      {
        label: `Getting Started with ${PRODUCT}`,
        action: r.gettingStarted,
      },
      // ACTIONS::listHotKeys, .DefaultHotkey( MD_CTRL + WXK_F1 ).
      { label: 'List Hotkeys...', shortcut: 'Ctrl+F1', action: r.showHotkeys },
      // ACTIONS::getInvolved.
      { label: 'Get Involved', action: r.getInvolved },
      // ACTIONS::donate sits here upstream, deliberately not carried.
      // ACTIONS::reportBug.
      {
        label: 'Report Bug',
        action: r.reportBug,
      },
      SEP,
      { label: ABOUT_LABEL, action: r.showAbout },
    ],
  };
}
