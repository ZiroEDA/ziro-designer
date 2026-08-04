// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `measureText` and `layoutText` must agree, because one draws the text and the
 * other decides where it is.
 *
 * They did not, for anything containing a newline: `layoutText` splits on `\n`
 * and stacks the lines, `measureText` ran the whole string through as a single
 * line — adding every line's width together, and advancing the `\n` itself as a
 * missing-glyph '?'.
 *
 * Everything geometric measures through `measureText`, so a multi-line text had
 * a bounding box several times too wide: it picked up clicks well to its right,
 * drew its selection halo out there, and pushed autoplaced fields away.
 */
import { describe, it, expect } from 'vitest';
import { layoutText, measureText } from '@ziroeda/common/src/font/stroke_font.js';

const SIZE = 10000;

describe('measureText agrees with layoutText', () => {
  for (const text of [
    'abc',
    '',
    ' ',
    'abc\nde',
    'a\nb\nc',
    'longer line\nx',
    'x\nlonger line',
    'trailing\n',
    '\nleading',
    'a\n\nb',
    '~{overbar}\nplain',
  ]) {
    it(JSON.stringify(text), () => {
      expect(measureText(text, SIZE)).toBeCloseTo(layoutText(text, SIZE).width, 6);
    });
  }

  it('takes the widest line, not the sum', () => {
    // The shape of the old bug: three short lines measured as one long one.
    const one = measureText('a', SIZE);
    expect(measureText('a\na\na', SIZE)).toBeCloseTo(one, 6);
  });

  it('does not let the newline advance as a glyph', () => {
    // '\n' is below 0x20, so the glyph lookup fell back to '?' and charged for it.
    expect(measureText('a\na', SIZE)).toBeCloseTo(measureText('a', SIZE), 6);
  });
});
