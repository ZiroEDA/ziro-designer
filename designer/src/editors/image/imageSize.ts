// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Output-size model, the counterpart of KiCad's `IMAGE_SIZE`
 * (`bitmap2cmp_frame.cpp`). The source image has a pixel count and a native PPI;
 * the "Output Size" box lets you express the exported size either physically
 * (mm / inch) or directly as a DPI. Whatever the unit, the exporter ultimately
 * needs a DPI per axis (`GetOutputDPI`), which is what drives the millimetre
 * scale in `bitmap2component`.
 *
 * The three arithmetic helpers reproduce `IMAGE_SIZE` exactly:
 *  - initialOutputSize ↔ SetOutputSizeFromInitialImageSize
 *  - outputDpi         ↔ GetOutputDPI
 *  - convertOutputSize ↔ SetUnit (preserve the physical size across a unit swap)
 */

import { KiROUND } from '@ziroeda/kimath/src/math/util.js';

export type SizeUnit = 'mm' | 'inch' | 'dpi';

/** The unit dropdown, in KiCad's order (mm, Inch, DPI); index 0 is the default. */
export const SIZE_UNITS: { id: SizeUnit; label: string }[] = [
  { id: 'mm', label: 'mm' },
  { id: 'inch', label: 'Inch' },
  { id: 'dpi', label: 'DPI' },
];

/** The output size that reproduces the image at its native PPI, in the given unit. */
export function initialOutputSize(pixels: number, dpi: number, unit: SizeUnit): number {
  const d = Math.max(1, dpi);
  if (unit === 'mm') return (pixels / d) * 25.4;
  if (unit === 'inch') return pixels / d;
  return d; // 'dpi': the output size *is* the DPI
}

/**
 * The effective DPI this axis exports at, `IMAGE_SIZE::GetOutputDPI`
 * (`bitmap2cmp_frame.cpp:73-90`).
 *
 * The result is an **int**: C++ assigns the division to `int outputDPI`, which
 * truncates toward zero, so 200 px at 21 mm is 241 DPI and not 241.9 — a scale
 * the exported geometry then carries (`bitmap2component.cpp:132-141`). The
 * final `std::max( 1, outputDPI )` is not cosmetic either: a zero or negative
 * size divides by zero, whose double→int conversion lands out of range, and
 * KiCad then exports at 1 DPI rather than at any "sensible" default.
 */
export function outputDpi(size: number, pixels: number, unit: SizeUnit): number {
  let dpi: number;
  if (unit === 'dpi') dpi = KiROUND(size);
  else dpi = Math.trunc(pixels / (unit === 'mm' ? size / 25.4 : size));
  // ±Infinity / NaN stand in for C++'s out-of-range double→int conversion; the
  // std::max( 1, … ) clamp below is what the user actually sees either way.
  if (!Number.isFinite(dpi)) dpi = 1;
  return Math.max(1, dpi);
}

/**
 * Parse an Output Size field, `wxString::ToDouble` (`bitmap2cmp_panel.cpp:315`,
 * `:344`): `strtod` over the *whole* string, so trailing junk or an empty field
 * is a failure, not a zero. KiCad acts only when the parse succeeds and
 * otherwise keeps the previous `m_outputSize`, which is why clearing the field
 * must not retarget the export. `null` is that failure.
 */
export function parseOutputSize(text: string): number | null {
  // strtod skips leading whitespace but stops at trailing whitespace, and
  // wxString::ToDouble requires the end pointer to reach the end of the string.
  if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

/** Re-express an output size in a different unit, keeping the physical size fixed. */
export function convertOutputSize(
  size: number,
  pixels: number,
  from: SizeUnit,
  to: SizeUnit,
): number {
  // to millimetres
  let mm: number;
  if (from === 'mm') mm = size;
  else if (from === 'inch') mm = size * 25.4;
  else mm = size ? (pixels / size) * 25.4 : 0;
  // millimetres to target
  if (to === 'mm') return mm;
  if (to === 'inch') return mm / 25.4;
  return mm ? (pixels / mm) * 25.4 : 0;
}

/**
 * Format an output-size value for a text field, with KiCad's exact precision
 * (`formatOutputSize`): mm `%.1f`, inch `%.2f`, DPI a rounded integer.
 */
export function formatOutputSize(size: number, unit: SizeUnit): string {
  if (!Number.isFinite(size)) size = 0;
  if (unit === 'dpi') return String(KiROUND(size));
  return unit === 'mm' ? size.toFixed(1) : size.toFixed(2);
}
