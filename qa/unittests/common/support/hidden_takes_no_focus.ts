// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A browser gives no focus to a control that is not being rendered, and `visibility: hidden`
 * is not rendered (HTML's "focusable area"). happy-dom focuses it anyway, so a test there
 * cannot tell a control that focused itself while its dialog was still hidden for its first
 * layout - which in a browser is a dialog that opens without the focus - from one focused once
 * the window is shown. Install this to get the browser's rule.
 *
 * @return the function that puts happy-dom's own `focus` back.
 */
export function hiddenTakesNoFocus(): () => void {
  const real = HTMLElement.prototype.focus;

  HTMLElement.prototype.focus = function (this: HTMLElement, aOptions?: FocusOptions): void {
    if (getComputedStyle(this).visibility === 'hidden') return;
    real.call(this, aOptions);
  };

  return () => {
    HTMLElement.prototype.focus = real;
  };
}
