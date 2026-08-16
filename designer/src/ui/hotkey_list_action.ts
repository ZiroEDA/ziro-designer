// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ACTIONS::listHotKeys as something a menu can dispatch, split from the dialog
 * that answers it.
 *
 *     TOOL_ACTION ACTIONS::listHotKeys( TOOL_ACTION_ARGS()
 *             .Name( "common.SuiteControl.listHotKeys" )
 *             .Scope( AS_GLOBAL )
 *             .DefaultHotkey( MD_CTRL + static_cast<int>( WXK_F1 ) ) ... );
 *
 * AS_GLOBAL is why this is a registry of listeners rather than a prop threaded
 * through eight editors: upstream has one action, registered once, reachable
 * from every frame. `HotkeyListHost` subscribes; every Help menu calls
 * `showHotkeyList()`.
 *
 * It lives in a `.ts` of its own because the menu builders that dispatch it are
 * data modules that qa compiles, and qa's tsc has no `--jsx`. Importing the
 * dialog directly resolved to a `.tsx` and failed the whole package's
 * typecheck - the same trap `menu_types.ts` and `toolbar_types.ts` were split
 * out to fix.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe. Returns the unsubscribe, for an effect's cleanup. */
export function onShowHotkeyList(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Dispatch the action. A no-op before the host mounts, which is the same shape
 * as a TOOL_ACTION fired at a tool manager that has no handler for it.
 */
export function showHotkeyList(): void {
  for (const l of listeners) l();
}
