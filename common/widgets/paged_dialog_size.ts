// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ONE size for a paged dialog, for its whole life.
 *
 * `.ze-modal` is `width: max-content`, which tracks whichever page is mounted
 * and re-sizes the window on every row of the tree. Preferences answered that
 * a long time ago and the answer is two lines:
 *
 *   - `.ze-prefs-dialog` states a width and a height;
 *   - `.ze-prefs-panel` is `min-width: 0`, so a page that wants more room
 *     SCROLLS inside the dialog rather than pushing it wider.
 *
 * Board Setup and Schematic Setup now do the same thing, out of the same two
 * pieces: `.ze-paged-panel` is `min-width: 0`, and the width and height are
 * stated at the call site rather than here — this hook is only the mechanism
 * for putting them on the element.
 *
 * **A subclass's `aInitialSize` is the wrong number to state.** It is the size
 * the window OPENS at, before `onPageChanged` has grown it into the showing
 * page, and on Board Setup nobody ever sees it: `wxSize( 980, 600 )` becomes
 * 1227 x 786 the moment a real page resolves. Copying the literal gave a
 * dialog a third narrower than the one KiCad draws, with the Teardrops page's
 * entire right-hand column behind a horizontal scrollbar. The size to state is
 * the GROWN one, measured off a live dialog — which is what
 * `.ze-prefs-dialog`'s 1095 x 713 has always been.
 *
 * ## What upstream does, and why we deliberately do not
 *
 * `PAGED_DIALOG::onPageChanged` (`common/widgets/paged_dialog.cpp:424-451`)
 * recomputes a minimum from the showing page and grows the window into it
 * (`newSize.IncTo( minSize )`), and `DIALOG_SHIM::Show()` restores a size the
 * user has dragged to. Together those settle a real wx dialog at the largest
 * page it has been shown and keep it there across opens.
 *
 * That is genuinely different from what we do here, and the difference is
 * deliberate. Growing needs a page's true `GetBestSize()`, which in wx is a
 * sizer minimum computed off-screen; in a browser it is a measurement of the
 * mounted DOM, and every version of that measurement this file has carried has
 * been wrong in a way the user saw — a floor that could only rise, a remembered
 * size applied as a minimum, a size that evaporated when the next page lowered
 * the minimum. A stated size cannot be wrong in any of those ways, and it is
 * what the app's other paged dialog has always used.
 *
 * If a page does not fit the stated size, that is a parity bug in the PAGE and
 * the page area scrolls until it is fixed — which is visible and local, where a
 * dialog that changes size under the user is neither.
 */
import { useCallback, useRef } from 'react';

/** `PAGED_DIALOG`'s `aInitialSize`, which every subclass states as a literal. */
export interface InitialSize {
  readonly width: number;
  readonly height: number;
}

/**
 * @param initial the subclass's `aInitialSize`. Omitted where the dialog's
 *   size is stated in CSS instead: Preferences is not a `PAGED_DIALOG`
 *   subclass upstream and has no such argument, so its size is a measurement
 *   of the real dialog and lives in `.ze-prefs-dialog` beside the note that
 *   derives it.
 * @returns the ref to put on the dialog element. Nothing else: the size is
 *   written to the element's own inline style rather than handed back as a
 *   React `style` prop, and that is deliberate. `.ze-paged-dialog` is
 *   `resize: both`, and a browser resize handle writes `width`/`height` into
 *   exactly that inline style — so a React-managed `style` would overwrite the
 *   user's drag on the next render (a keystroke in any field is one). Writing
 *   it once, on mount, leaves the element's inline style the user's to change,
 *   which is what a resizable wxDialog is.
 */
export function usePagedDialogSize(initial?: InitialSize): (el: HTMLElement | null) => void {
  const sized = useRef(false);

  return useCallback(
    (el: HTMLElement | null) => {
      if (!el || sized.current || !initial) return;
      sized.current = true;
      el.style.width = `${initial.width}px`;
      el.style.height = `${initial.height}px`;
    },
    [initial?.width, initial?.height],
  );
}
