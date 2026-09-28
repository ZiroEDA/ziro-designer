// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `cvpcb/tools/cvpcb_control.cpp` (`CVPCB_CONTROL`): ToNA and ChangeFocus.
 */

import {
  footprintOf,
  nextUnassociated,
  selectedComponent,
  type CvpcbAssociations,
  type CvpcbComponent,
  type CvpcbControl,
} from '../cvpcb_mainframe.js';

/**
 * `CVPCB_CONTROL::ToNA` — select the next/previous unassociated symbol.
 *
 * With nothing selected `tempSel` is empty, so `newSel` keeps its `UINT_MAX`
 * initial value and the forward scan can never match, while the backward scan
 * is inside `if( !tempSel.empty() )` — nowhere to go in either direction. That
 * state is reachable now that the window can open with no row selected (every
 * symbol already assigned, `readwrite_dlgs.cpp:271-274`).
 */
export function gotoNA(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  dir: 1 | -1,
): CvpcbAssociations {
  const current = selectedComponent(state);
  if (current < 0) return state;

  const target = nextUnassociated(components.length, current, dir, (i) =>
    Boolean(footprintOf(state, components[i])),
  );
  return target === null ? state : { ...state, selection: [target] };
}

/**
 * `CVPCB_CONTROL::ChangeFocus` (tools/cvpcb_control.cpp:96-144) — Tab / → move
 * the focus one pane to the right and wrap, Shift+Tab / ← one to the left:
 *
 *     CHANGE_FOCUS_RIGHT: library → symbol → footprint → library
 *     CHANGE_FOCUS_LEFT:  library → footprint → symbol → library
 *
 * The keys are two halves of the same command. `CVPCB_ACTIONS::changeFocusRight`
 * / `changeFocusLeft` (tools/cvpcb_actions.cpp:80-92) carry
 * `.DefaultHotkey( WXK_TAB )` and `.DefaultHotkey( MD_SHIFT + WXK_TAB )`, and
 * `CVPCB_CONTROL::Main` (`:64-92`) posts the same two actions for `WXK_RIGHT`
 * and `WXK_LEFT`. Neither pair existed here: the three panes were not even
 * focusable, so the whole window could only be driven with the mouse.
 *
 * `CONTROL_NONE` - the focus is on the toolbar's search box, or nowhere - falls
 * through both switches and does nothing.
 */
export function changeFocus(
  current: CvpcbControl | null,
  dir: 'right' | 'left',
): CvpcbControl | null {
  if (current === null) return null;

  if (dir === 'right') {
    if (current === 'library') return 'symbol';
    if (current === 'symbol') return 'footprint';
    return 'library';
  }

  if (current === 'library') return 'footprint';
  if (current === 'symbol') return 'library';
  return 'symbol';
}
