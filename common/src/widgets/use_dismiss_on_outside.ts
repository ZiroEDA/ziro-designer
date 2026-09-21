// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Close a popover on Escape, or on a click outside it — and not on one inside.
 *
 * ### The capture phase is the whole point
 *
 * The obvious version listens for `mousedown` on the document and asks
 * `root.contains(event.target)`. It is wrong, and it fails in a way that looks
 * like the popover closing at random:
 *
 * A control inside the popover may commit on `mousedown` and unmount something
 * in the same event — `ui/Combo` does exactly that, selecting an option and
 * closing its own list. React's handler runs while the event is still
 * bubbling, so by the time a listener on the **document** sees it, the clicked
 * node has already been removed from the tree. `contains` on a detached node
 * is `false`, so the popover decides the click was outside itself and closes.
 *
 * That is what happened to the share panel: choosing a role or a link setting
 * shut the whole thing.
 *
 * Listening in the **capture** phase fixes it, because capture runs from the
 * document down to the target before any React handler has had a chance to
 * unmount anything. The node is still where it was, and `contains` answers the
 * question that was actually asked.
 *
 * Shared rather than written per popover, because every popover in the app has
 * this problem the moment it contains a `Combo` — and two of them already do.
 */

import { useEffect, type RefObject } from 'react';

export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  /** Called for Escape and for a click outside. Not called while `!active`. */
  dismiss: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss();
    };
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) dismiss();
    };
    document.addEventListener('keydown', onKey);
    // Capture. See the header: a bubble-phase listener is handed a node that a
    // React handler has already detached, and reads it as "outside".
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [ref, dismiss, active]);
}
