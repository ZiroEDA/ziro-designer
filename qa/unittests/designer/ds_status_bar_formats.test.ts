// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-22 — the two numeric formats `PL_EDITOR_FRAME` writes into its status bar
 * by hand rather than through the shared formatters.
 *
 *   grid, MILS   `"grid %f"`      -> `grid 19.685039`  (pl_editor_frame.cpp:715)
 *   coordinates  `"X %.4g  Y %.4g"`                    (:770-771)
 *
 * The audit cycled the units button in both apps and found inches and mm
 * matching and mils wrong (`grid 19.7`), and read `X 1.266e+04 Y 1.217e+04` off
 * a cold-open pl_editor where ours prints plain integers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatG, gridMsg } from '@ziroeda/designer/src/ui/status_format.js';

describe('formatG — C’s %g', () => {
  it('switches to exponent form once the exponent reaches the precision', () => {
    // Checked against the C library: printf "%.4g" 12660 12170 -> the same.
    expect(formatG(12660)).toBe('1.266e+04');
    expect(formatG(12170)).toBe('1.217e+04');
    expect(formatG(-12660)).toBe('-1.266e+04');
  });

  it('stays in fixed form while the exponent is inside -4 <= e < precision', () => {
    expect(formatG(7736)).toBe('7736');
    expect(formatG(5413)).toBe('5413');
    expect(formatG(9999)).toBe('9999');
    expect(formatG(1.5)).toBe('1.5');
    expect(formatG(0)).toBe('0');
  });

  it('takes the exponent AFTER rounding, as C does', () => {
    // 9999.6 rounds to 1.000e+04 at 4 digits, so it prints in exponent form.
    expect(formatG(9999.6)).toBe('1e+04');
  });

  it('goes exponential below 1e-4 and pads the exponent to two digits', () => {
    expect(formatG(0.00001234)).toBe('1.234e-05');
    expect(formatG(0.0001234)).toBe('0.0001234');
  });

  it('trims trailing zeros and a bare decimal point', () => {
    expect(formatG(0.5)).toBe('0.5');
    expect(formatG(100)).toBe('100');
    expect(formatG(1000)).toBe('1000');
  });
});

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

describe('the status bar’s own formats', () => {
  it('formats both coordinate pairs with %.4g', () => {
    expect(EDITOR).toContain('const fmt4 = (n: number): string => formatG(n, 4);');
    expect(EDITOR).not.toContain('toPrecision(4)');
  });

  it('prints the mils grid to six decimal places', () => {
    // DisplayGridMsg's `default:` branch is a bare "grid %f", and C's default
    // precision for %f is 6. 0.5 mm is 19.685039 mils.
    expect(gridMsg((0.5 / 25.4) * 1000 + '')).toBe('grid 19.68503937007874');
    expect(gridMsg(((0.5 / 25.4) * 1000).toFixed(6))).toBe('grid 19.685039');

    const at = EDITOR.indexOf("unit === 'mils'");
    expect(at).toBeGreaterThan(-1);
    const branch = EDITOR.slice(at, EDITOR.indexOf(': iuToMM(gridIU).toFixed(4)', at));
    expect(branch).toContain('toFixed(6)');
    expect(branch).not.toContain('toFixed(1)');
  });

  it('leaves the inch and mm grid formats alone, which already matched', () => {
    // "grid %.3f" in inch, "grid %.4f" in mm (pl_editor_frame.cpp:713-714).
    expect(EDITOR).toContain('(iuToMM(gridIU) / 25.4).toFixed(3)');
    expect(EDITOR).toContain('iuToMM(gridIU).toFixed(4)');
  });
});
