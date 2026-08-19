// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ACTION_MENU::AddClose` / `AddQuit` / `AddQuitOrClose`, ported —
 * `common/tool/action_menu.cpp:220-262`.
 *
 * These three are why every KiCad File menu ends the same way. The label, the
 * accelerator and the status-bar help string are written **once** upstream and
 * every frame calls the function:
 *
 *     void ACTION_MENU::AddClose( const wxString& aAppname )
 *     {
 *     #ifdef __WINDOWS__
 *         Add( _( "Close" ), wxString::Format( _( "Close %s" ), aAppname ),
 *              wxID_CLOSE, BITMAPS::exit );
 *     #else
 *         Add( _( "Close" ) + wxS( "\tCtrl+W" ), ... );
 *     #endif
 *     }
 *
 *     void ACTION_MENU::AddQuit( const wxString& aAppname )
 *     {
 *         Add( _( "Quit" ) + wxS( "\tCtrl+Q" ),
 *              wxString::Format( _( "Quit %s" ), aAppname ),
 *              wxID_EXIT, BITMAPS::exit );
 *     }
 *
 * Note what the app name is *for*: it goes in the help string, never in the
 * label. The row reads "Close"; the status bar reads "Close Footprint Editor".
 * Eleven frames here had written the row by hand and ten of them had put the
 * app name in the label instead — "Close Footprint Editor" as the menu text —
 * with no accelerator at all, which is what a per-frame copy of a shared thing
 * always decays into. `MenuItem.tooltip` is the help string's home.
 *
 * `AddQuitOrClose` is the third: a frame that can run standalone offers Quit,
 * and the same frame under the project manager offers Close, because closing
 * it returns you to the manager rather than ending the process. eeschema,
 * pcbnew and gerbview all call it. Everything here runs under the project
 * manager, so {@link addQuitOrClose} resolves to Close unless told otherwise —
 * but it is spelled as the upstream call so the two branches stay visible.
 *
 * ## Why the accelerators are not the ones in the C++
 *
 * Ctrl+W and Ctrl+Q are both in {@link BROWSER_RESERVED}: a tab cannot take
 * them, and `preventDefault()` on them is ignored. Ctrl+W closes the tab, which
 * with an unsaved board open is the most expensive keystroke in the app.
 *
 * So the row declares {@link browserSafeKey}'s substitution — Ctrl+Alt+W and
 * Ctrl+Alt+Q — and the menu therefore *prints* the key that will actually reach
 * us. That matters more now than it did before `ui/menu_hotkeys.ts`: a printed
 * accelerator used to be decoration, and a raw `Ctrl+W` in a row was merely a
 * lie. It is now a declaration the dispatcher reads, so a row spelling the raw
 * key advertises a keystroke whose only effect is to destroy the user's tab.
 *
 * The upstream spelling is still what appears in the source below, passed
 * through `browserSafeKey`, so the divergence is legible at the point of use
 * and lives in exactly one table.
 */
import { browserSafeKey } from './browser_hotkeys.js';
import type { MenuItem } from './menu_types.js';

/** The upstream key of `AddClose`, before the browser has its say. */
export const UPSTREAM_CLOSE_KEY = 'Ctrl+W';

/** The upstream key of `AddQuit`, before the browser has its say. */
export const UPSTREAM_QUIT_KEY = 'Ctrl+Q';

/**
 * `ACTION_MENU::AddClose( aAppname )`.
 *
 * The row reads "Close"; `aAppname` is the help string only.
 */
export function addClose(appName: string, action: () => void): MenuItem {
  return {
    label: 'Close',
    shortcut: browserSafeKey(UPSTREAM_CLOSE_KEY),
    tooltip: `Close ${appName}`,
    action,
  };
}

/**
 * `ACTION_MENU::AddQuit( aAppname )`.
 *
 * The row reads "Quit"; `aAppname` is the help string only.
 */
export function addQuit(appName: string, action: () => void): MenuItem {
  return {
    label: 'Quit',
    shortcut: browserSafeKey(UPSTREAM_QUIT_KEY),
    tooltip: `Quit ${appName}`,
    action,
  };
}

/**
 * `ACTION_MENU::AddQuitOrClose( aKiface, aAppname )`.
 *
 * `isSingle` is `!aKiface || aKiface->IsSingle()` — the frame is running on its
 * own rather than under the project manager. Every frame here is launched from
 * the project manager and returns to it, so the default is the Close branch.
 */
export function addQuitOrClose(appName: string, action: () => void, isSingle = false): MenuItem {
  return isSingle ? addQuit(appName, action) : addClose(appName, action);
}
