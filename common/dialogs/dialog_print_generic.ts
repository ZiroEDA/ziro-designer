// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/dialogs/dialog_print_generic.cpp`'s arithmetic: the scale the
 * three Scale radios and the Custom text stand for, both ways. Pure, so the
 * engine halves of the dialogs that derive it (DIALOG_PRINT_PCBNEW,
 * DIALOG_PRINT_GERBVIEW) can use it without a DOM;
 * `dialog_print_generic_ui.tsx` draws the dialog.
 */

/** dialog_print_generic.cpp:34-35. */
export const MIN_SCALE = 0.01;
export const MAX_SCALE = 100.0;

export type PrintScaleMode = '1:1' | 'fit' | 'custom';

/**
 * `setScaleValue` (:172-196): 0 selects Fit to page, 1 selects 1:1, anything
 * else is clamped silently and written into Custom with `%f`.
 */
export function setScaleValue(aValue: number): { mode: PrintScaleMode; text?: string } {
  if (aValue === 0.0) return { mode: 'fit' };
  if (aValue === 1.0) return { mode: '1:1' };
  const v = Math.min(MAX_SCALE, Math.max(MIN_SCALE, aValue));
  return { mode: 'custom', text: v.toFixed(6) };
}

/**
 * `getScaleValue` (:128-170): the scale, what the controls become when the
 * custom text had to be corrected, and the DisplayInfoMessage upstream shows
 * for it.
 */
export function getScaleValue(
  aMode: PrintScaleMode,
  aCustomText: string,
): { scale: number; reset?: { mode: PrintScaleMode; text?: string }; info?: string } {
  if (aMode === '1:1') return { scale: 1.0 };
  if (aMode === 'fit') return { scale: 0.0 };

  const t = aCustomText.trim();
  let scale = t === '' ? Number.NaN : Number(t);

  if (!Number.isFinite(scale)) {
    return {
      scale: 1.0,
      reset: setScaleValue(1.0),
      info: 'Warning: custom scale is not a number.',
    };
  }

  if (scale > MAX_SCALE) {
    scale = MAX_SCALE;
    return {
      scale,
      reset: setScaleValue(scale),
      info: `Warning: custom scale is too large.\nIt will be clamped to ${scale.toFixed(6)}.`,
    };
  }
  if (scale < MIN_SCALE) {
    scale = MIN_SCALE;
    return {
      scale,
      reset: setScaleValue(scale),
      info: `Warning: custom scale is too small.\nIt will be clamped to ${scale.toFixed(6)}.`,
    };
  }
  return { scale };
}
