// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The stroke font's line pitch, pinned to the two C++ constants it is made of.
 *
 *   `common/font/stroke_font.cpp:194-199`
 *       static double LEGACY_FACTOR = 0.9583;   // Adjustment to match legacy spacing
 *       return aFontMetrics.GetInterline( aGlyphHeight ) * LEGACY_FACTOR;
 *
 *   `include/font/font_metrics.h:54-57,64`
 *       double GetInterline( double aFontHeight ) const
 *       { return aFontHeight * m_InterlinePitch; }      // m_InterlinePitch = 1.68
 *
 * so a stroke-font baseline step is `1.68 × 0.9583 = 1.609944` glyph heights.
 *
 * `interline()` returned the bare 1.68 for a long time, which made every
 * multi-line run in the application 4.3 % loose, and `renderer.ts` carried its
 * own correct `1.68 * 0.9583` while importing the wrong one — the same file
 * spacing a wrapped text box and a `\n` text differently.
 *
 * The numbers below are written out from the C++ rather than taken from
 * `interline()`, which is the point: the existing multi-line tests all derive
 * their expected pitch from `interline()` itself and so agree with any factor
 * at all, including none.
 */
import { describe, expect, it } from 'vitest';
import { interline, layoutText } from '@ziroeda/common/src/font/stroke_font.js';
import { fontInterline } from '@ziroeda/common/src/font/text_box.js';
import { INTERLINE_PITCH, STROKE_LEGACY_FACTOR } from '@ziroeda/common/src/font/font_metrics.js';

/** stroke_font.cpp's LEGACY_FACTOR and font_metrics.h's m_InterlinePitch. */
const CPP_PITCH = 1.68 * 0.9583;

const SIZE = 1_270_000; // 1.27 mm in board IU

describe('STROKE_FONT::GetInterline', () => {
  it('is the metrics pitch times the legacy factor', () => {
    expect(interline(SIZE)).toBeCloseTo(CPP_PITCH * SIZE, 3);
    // Spelled out: the bare metrics pitch is 4.3 % larger and is NOT the answer.
    expect(interline(SIZE)).not.toBeCloseTo(1.68 * SIZE, 3);
    // 1.68 - 1.68·0.9583 = 0.070056 heights: the unfactored pitch is
    // 1/0.9583 - 1 = 4.35 % looser than KiCad's.
    expect(1.68 * SIZE - interline(SIZE)).toBeCloseTo(0.070056 * SIZE, 0);
    expect(1.68 / (1.68 * STROKE_LEGACY_FACTOR) - 1).toBeCloseTo(0.0435, 4);
  });

  it('exposes the two constants separately, as the C++ keeps them', () => {
    // OUTLINE_FONT::GetInterline (outline_font.cpp:180-185) returns
    // METRICS::GetInterline with no adjustment, so the factor cannot be folded
    // into the pitch.
    expect(INTERLINE_PITCH).toBe(1.68);
    expect(STROKE_LEGACY_FACTOR).toBe(0.9583);
  });

  it('leaves an outline face on the unadjusted metrics pitch', () => {
    expect(fontInterline(SIZE, 'Arial')).toBeCloseTo(1.68 * SIZE, 3);
    expect(fontInterline(SIZE, undefined)).toBeCloseTo(CPP_PITCH * SIZE, 3);
  });
});

describe('layoutText stacks lines at GetInterline', () => {
  const inkY = (text: string): { top: number; bottom: number } => {
    const ys = layoutText(text, SIZE, 'left', 'first-line')
      .strokes.flat()
      .map((p) => p.y);
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  };

  it('steps each baseline by 1.68 · 0.9583 · size, as FONT::getLinePositions does', () => {
    // 'first-line' leaves line 0 on the baseline and grows downwards, so with
    // the same glyph on every line the ink grows by exactly one pitch per
    // extra line and the top never moves.
    const one = inkY('X');
    const three = inkY('X\nX\nX');
    expect(three.top).toBeCloseTo(one.top, 6);
    expect(three.bottom - one.bottom).toBeCloseTo(2 * CPP_PITCH * SIZE, 3);
  });

  it('centres a two-line block by half that pitch', () => {
    const one = layoutText('X', SIZE);
    const two = layoutText('X\nX', SIZE);
    const top = (r: { strokes: { y: number }[][] }): number =>
      Math.min(...r.strokes.flat().map((p) => p.y));
    expect(top(one) - top(two)).toBeCloseTo((CPP_PITCH * SIZE) / 2, 3);
  });
});
