// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The one line a frame writes to make its own menu accelerators work.
 *
 *     useMenuHotkeys( menus, 'image' );
 *
 * See `menu_hotkeys.ts` for the matching rules and where each comes from. Split
 * from it for the same reason `useModalEscape` is split from `modal_escape`:
 * the rules are pure data logic and must stay testable without React, and
 * `qa`'s tsc has no `--jsx`.
 *
 * A frame that calls this must not also hand-write a `keydown` listener for a
 * command that has a menu item. `qa/unittests/designer/menu_hotkey_coverage
 * .test.ts` enforces that, because "somebody separately wrote a matching `if`"
 * is the failure this whole module exists to end.
 */
import { useEffect, useRef } from 'react';
import { dispatchMenuHotkey } from './menu_hotkeys.js';
import type { FocusLike } from './browser_hotkeys.js';
import type { Menu } from './menu_types.js';

/**
 * Dispatch this frame's menu accelerators while it is the frame on screen.
 *
 * `view` is the `document.body.dataset.activeView` stamp App writes, because
 * the editors all stay mounted and are toggled with CSS - a keystroke in
 * eeschema must not drive the hidden board editor. Omit it in a frame that is
 * never one of several (a standalone build, or a dialog-shaped frame).
 *
 * `menus` is read through a ref rather than depended on, because a frame
 * rebuilds its whole menu tree every render: depending on it would tear the
 * listener down and put it back on each keystroke's re-render.
 *
 * `preventDefault` is called when something ran, so the key does not also do
 * whatever it does by default in the page. Suppressing the *browser's* action
 * is a different job and already belongs to `ui/browser_hotkeys.ts`.
 */
export function useMenuHotkeys(menus: readonly Menu[], view?: string): void {
  const menusRef = useRef(menus);
  menusRef.current = menus;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      // No stamp at all is a standalone build, where this frame is the app.
      if (view !== undefined && (document.body.dataset.activeView ?? view) !== view) return;
      if (!dispatchMenuHotkey(menusRef.current, e, { target: e.target as FocusLike | null })) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
}
