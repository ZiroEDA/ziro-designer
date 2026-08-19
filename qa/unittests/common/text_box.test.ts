// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `EDA_TEXT::GetTextBox` (`common/eda_text.cpp`) and the pieces it is built from.
 *
 * Every expected number here is derived from the C++, never from what our code
 * happens to print. The chain, for a stroke font, is:
 *
 *   advance          = sum of Newstroke glyph advances x size.x
 *   StringBoundaryLimits.x = advance - KiROUND(size.x x 0.2)        [INTER_CHAR]
 *                            + 2 x KiROUND(thickness x 1.5)        [stroke inflate]
 *   StringBoundaryLimits.y = size.y + 2 x KiROUND(thickness x 1.5)
 *   GetTextBox.h     = StringBoundaryLimits.y + KiROUND(that x 0.17) [stroke fudge]
 */

import { describe, expect, it } from 'vitest';
import {
  clampTextPenSize,
  effectiveTextPenWidth,
  fontInterline,
  kiRound,
  penSizeForBold,
  penSizeForNormal,
  stringBoundaryLimits,
  strokeInterline,
  textBox,
} from '@ziroeda/common/src/font/text_box.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';

const MM = 1e6; // pcbnew IU = 1 nm
/** KiCad's default footprint text: 1 mm glyph box, 0.15 mm pen. */
const SIZE = { x: MM, y: MM };
const THICK = 0.15 * MM;

/** The independent re-derivation of StringBoundaryLimits, straight from the C++. */
const limitsFromCpp = (text: string, thickness: number) => {
  const inflate = kiRound(thickness * 1.5);
  return {
    x: text === '' ? 2 * inflate : measureText(text, SIZE.x) - kiRound(SIZE.x * 0.2) + 2 * inflate,
    y: text === '' ? 2 * inflate : SIZE.y + 2 * inflate,
  };
};

describe('pen sizes (common/gr_text.cpp)', () => {
  it('GetPenSizeForNormal is size/8 and GetPenSizeForBold is size/5', () => {
    expect(penSizeForNormal(MM)).toBe(MM / 8);
    expect(penSizeForBold(MM)).toBe(MM / 5);
    // KiROUND, not truncation: 7/8 = 0.875 -> 1.
    expect(penSizeForNormal(7)).toBe(1);
  });

  it('ClampTextPenSize caps at a quarter of the smaller dimension, 0.18 when strict', () => {
    expect(clampTextPenSize(MM, { x: MM, y: MM })).toBe(0.25 * MM);
    expect(clampTextPenSize(MM, { x: MM, y: MM }, true)).toBe(0.18 * MM);
    // A pen already under the cap is returned untouched.
    expect(clampTextPenSize(0.1 * MM, { x: MM, y: MM })).toBe(0.1 * MM);
    // The *smaller* of x and y governs.
    expect(clampTextPenSize(MM, { x: 4 * MM, y: MM })).toBe(0.25 * MM);
  });
});

describe('EDA_TEXT::GetEffectiveTextPenWidth', () => {
  it('takes a stored thickness > 1 as-is', () => {
    expect(effectiveTextPenWidth({ size: SIZE, thickness: THICK })).toBe(THICK);
  });

  it('falls back to size.x/8 with no thickness, and size.x/5 when bold', () => {
    expect(effectiveTextPenWidth({ size: SIZE })).toBe(MM / 8);
    expect(effectiveTextPenWidth({ size: SIZE, bold: true })).toBe(MM / 5);
  });

  it('derives the pen from GetTextWidth (size.x), not the height', () => {
    // A condensed 2 mm-wide, 1 mm-tall text: bold pen = 2mm/5 = 0.4 mm, but
    // ClampTextPenSize then caps it at 0.25 x min(x, y) = 0.25 mm.
    expect(effectiveTextPenWidth({ size: { x: 2 * MM, y: MM }, bold: true })).toBe(0.25 * MM);
    // Unclamped: a 2 mm-wide, 4 mm-tall text keeps the full 2mm/5.
    expect(effectiveTextPenWidth({ size: { x: 2 * MM, y: 4 * MM }, bold: true })).toBe(0.4 * MM);
  });

  it('uses the caller default pen only when there is no thickness and no bold', () => {
    expect(effectiveTextPenWidth({ size: SIZE }, 0.05 * MM)).toBe(0.05 * MM);
    // Bold overrides the default outright (the C++ `if( IsBold() )` comes first).
    expect(effectiveTextPenWidth({ size: SIZE, bold: true }, 0.05 * MM)).toBe(MM / 5);
  });
});

describe('FONT::StringBoundaryLimits', () => {
  it('trims one INTER_CHAR side bearing and inflates by 1.5 x the pen', () => {
    for (const text of ['R1', 'WWWW', '100nF', 'Conn_01x08_Pin_Header']) {
      expect(stringBoundaryLimits(text, { size: SIZE }, THICK)).toEqual(limitsFromCpp(text, THICK));
    }
  });

  it('distinguishes narrow from wide glyphs of equal length', () => {
    const narrow = stringBoundaryLimits('IIII', { size: SIZE }, THICK).x;
    const wide = stringBoundaryLimits('WWWW', { size: SIZE }, THICK).x;
    // Newstroke: I advances 10/21 em, W advances 24/21 em.
    expect(wide - narrow).toBeCloseTo(4 * (24 / 21 - 10 / 21) * MM, 0);
  });

  it('does not widen for italic (the tilt is applied to glyphs, not the cursor)', () => {
    const upright = stringBoundaryLimits('R1', { size: SIZE }, THICK);
    const slanted = stringBoundaryLimits('R1', { size: SIZE, italic: true }, THICK);
    expect(slanted).toEqual(upright);
  });

  it('gives an empty string only the stroke inflate', () => {
    const inflate = kiRound(THICK * 1.5);
    expect(stringBoundaryLimits('', { size: SIZE }, THICK)).toEqual({
      x: 2 * inflate,
      y: 2 * inflate,
    });
  });

  it('does not inflate an outline face, whose thickness is built in', () => {
    const outline = stringBoundaryLimits('R1', { size: SIZE, face: 'Sans' }, THICK);
    expect(outline.y).toBe(SIZE.y);
    expect(outline.x).toBe(measureText('R1', SIZE.x) - kiRound(SIZE.x * 0.2));
  });
});

describe('FONT::GetInterline', () => {
  it('carries STROKE_FONT::GetInterline s 0.9583 legacy factor', () => {
    expect(strokeInterline(MM)).toBeCloseTo(1.68 * 0.9583 * MM, 6);
    expect(fontInterline(MM)).toBe(strokeInterline(MM));
  });

  it('OUTLINE_FONT::GetInterline is the bare metrics pitch', () => {
    expect(fontInterline(MM, 'Sans')).toBeCloseTo(1.68 * MM, 6);
  });
});

describe('EDA_TEXT::GetTextBox', () => {
  const at = { x: 0, y: 0 };

  it('height is the glyph box plus the pen inflate plus the 17% stroke fudge', () => {
    const box = textBox('R1', at, { size: SIZE, thickness: THICK });
    const limits = limitsFromCpp('R1', THICK);
    expect(box.h).toBe(limits.y + kiRound(limits.y * 0.17));
    // Concretely: 1 mm + 2x0.225 mm = 1.45 mm, x 1.17 = 1.6965 mm.
    expect(box.h).toBeCloseTo(1.6965 * MM, 0);
  });

  it('centres by default, which is what PCB text uses', () => {
    const box = textBox('R1', at, { size: SIZE, thickness: THICK });
    expect(box.x).toBe(-Math.trunc(box.w / 2));
    expect(box.y).toBe(-Math.trunc(box.h / 2));
  });

  it('left justification anchors the box at the position', () => {
    const box = textBox('R1', at, { size: SIZE, thickness: THICK, hJustify: 'left' });
    expect(box.x).toBe(0);
  });

  it('right justification pulls the box back by its width', () => {
    const box = textBox('R1', at, { size: SIZE, thickness: THICK, hJustify: 'right' });
    expect(box.x).toBe(-box.w);
  });

  it('mirroring swaps which of left/right shifts the box', () => {
    const left = textBox('R1', at, {
      size: SIZE,
      thickness: THICK,
      hJustify: 'left',
      mirrored: true,
    });
    const right = textBox('R1', at, {
      size: SIZE,
      thickness: THICK,
      hJustify: 'right',
      mirrored: true,
    });
    expect(left.x).toBe(-left.w);
    expect(right.x).toBe(0);
  });

  it('italic shifts the justified box by KiROUND(size.y x ITALIC_TILT)', () => {
    const upright = textBox('R1', at, { size: SIZE, thickness: THICK, hJustify: 'right' });
    const slanted = textBox('R1', at, {
      size: SIZE,
      thickness: THICK,
      hJustify: 'right',
      italic: true,
    });
    expect(slanted.x - upright.x).toBe(kiRound(SIZE.y / 8));
    expect(slanted.w).toBe(upright.w);
  });

  it('top/bottom justification offsets by the fudge factor', () => {
    const limits = limitsFromCpp('R1', THICK);
    const fudge = kiRound(limits.y * 0.17);
    expect(textBox('R1', at, { size: SIZE, thickness: THICK, vJustify: 'top' }).y).toBe(-fudge);
    const bottom = textBox('R1', at, { size: SIZE, thickness: THICK, vJustify: 'bottom' });
    expect(bottom.y).toBe(-bottom.h + fudge);
  });

  it('takes a multi-line run as the widest line plus one interline per extra line', () => {
    const one = textBox('WWWW', at, { size: SIZE, thickness: THICK, vJustify: 'top' });
    const three = textBox('R1\nWWWW\nII', at, { size: SIZE, thickness: THICK, vJustify: 'top' });
    expect(three.w).toBe(one.w); // widest line wins
    expect(three.h).toBe(one.h + kiRound(2 * strokeInterline(SIZE.y)));
  });

  it('does not open a line for a trailing newline (wxStringSplit)', () => {
    const plain = textBox('JTAG_EN', at, { size: SIZE, thickness: THICK });
    const trailing = textBox('JTAG_EN\n', at, { size: SIZE, thickness: THICK });
    expect(trailing).toEqual(plain);
  });

  it('adds an overbar offset of extents.y/6 when the first line opens one', () => {
    const plain = textBox('RESET', at, { size: SIZE, thickness: THICK, vJustify: 'top' });
    const barred = textBox('~{RESET}', at, { size: SIZE, thickness: THICK, vJustify: 'top' });
    const limits = limitsFromCpp('~{RESET}', THICK);
    expect(barred.h - plain.h).toBe(Math.trunc(limits.y / 6));
  });

  it('ignores an overbar that only appears after the first line', () => {
    // GetTextBox tests `text.Contains("~{")` before its multi-line loop
    // reassigns `text`, so only line 0 is examined.
    const a = textBox('AB\nCD', at, { size: SIZE, thickness: THICK, vJustify: 'top' });
    const b = textBox('AB\n~{CD}', at, { size: SIZE, thickness: THICK, vJustify: 'top' });
    expect(b.h).toBe(a.h);
  });
});
