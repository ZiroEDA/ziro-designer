// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where each line of a multi-line run sits, `FONT::getLinePositions`:
 *
 *     case GR_TEXT_H_ALIGN_LEFT:                                              break;
 *     case GR_TEXT_H_ALIGN_CENTER: lineOffset.x = -lineSize.x / 2;            break;
 *     case GR_TEXT_H_ALIGN_RIGHT:  lineOffset.x = -( lineSize.x + offset.x ); break;
 *
 * The alignment is applied per line, from the *item's* justification. Laying
 * every line out centred — which is what this did, whatever the item said —
 * makes a left-justified note look like this:
 *
 *              CHANGE LOG                     <- centred over the paragraph
 *     - swapped sensors' I2C from MIPI0 …
 *
 * where KiCad has both lines starting at the anchor. The offsets below are
 * expressed within the block (left edge at x=0, width = the widest line), which
 * is the frame a caller positions by.
 */
import { describe, it, expect } from 'vitest';
import { layoutText, measureText, interline } from '@ziroeda/common/src/font/stroke_font.js';

const SIZE = 12700; // 1.27 mm in schematic IU
const SHORT = 'CHANGE LOG';
const LONG = "- swapped sensors' I2C from MIPI0 to I2C1 (IO56-58)";
const TEXT = `${SHORT}\n\n${LONG}`;

/** The leftmost *ink* of the strokes belonging to one line, by its y band. */
function lineLeft(strokes: { x: number; y: number }[][], band: number): number {
  let min = Infinity;
  for (const s of strokes) {
    for (const p of s) {
      // A line's glyphs sit between its baseline and one size above it.
      if (p.y > band + 0.5 * SIZE || p.y < band - 1.5 * SIZE) continue;
      if (p.x < min) min = p.x;
    }
  }
  return min;
}

const pitch = interline(SIZE);
const shortWidth = measureText(SHORT, SIZE);
const longWidth = measureText(LONG, SIZE);

/**
 * How far a line was shifted inside the block, measured against the same string
 * laid out on its own.
 *
 * Comparing raw ink across two different lines would measure their first
 * glyph's left side bearing as well — 'C' and '-' do not start at the same
 * offset inside their advance — and that is not what is under test here.
 */
const soloLeft = (text: string): number =>
  lineLeft(layoutText(text, SIZE, 'left', 'first-line').strokes, 0);

const shift = (strokes: { x: number; y: number }[][], band: number, text: string): number =>
  lineLeft(strokes, band) - soloLeft(text);

describe('a left-justified multi-line run', () => {
  const { strokes, width, lineCount } = layoutText(TEXT, SIZE, 'left', 'first-line');

  it('shifts no line at all — every one starts at the anchor', () => {
    expect(shift(strokes, 0, SHORT)).toBeCloseTo(0, 6);
    expect(shift(strokes, 2 * pitch, LONG)).toBeCloseTo(0, 6);
  });

  it('reports the widest line as the block width', () => {
    expect(width).toBeCloseTo(longWidth, 6);
    expect(lineCount).toBe(3); // the blank middle line counts
  });
});

describe('a centred multi-line run', () => {
  // The behaviour that was applied to everything, and the only one it is right
  // for: each short line is pulled in by half the difference.
  const { strokes } = layoutText(TEXT, SIZE, 'center', 'first-line');

  it('indents the short line by half the difference', () => {
    expect(shift(strokes, 0, SHORT)).toBeCloseTo((longWidth - shortWidth) / 2, 6);
  });

  it('leaves the widest line where it was', () => {
    expect(shift(strokes, 2 * pitch, LONG)).toBeCloseTo(0, 6);
  });
});

describe('a right-justified multi-line run', () => {
  const { strokes } = layoutText(TEXT, SIZE, 'right', 'first-line');

  it('pushes the short line right by the whole difference', () => {
    expect(shift(strokes, 0, SHORT)).toBeCloseTo(longWidth - shortWidth, 6);
    expect(shift(strokes, 2 * pitch, LONG)).toBeCloseTo(0, 6);
  });
});

describe('the vertical block', () => {
  it("'first-line' leaves line 0 on the baseline", () => {
    // getLinePositions grows downwards from the anchor and lets the caller
    // subtract the block height for CENTER/BOTTOM; it never pre-centres.
    const { strokes } = layoutText(`A\nB`, SIZE, 'left', 'first-line');
    const top = Math.min(...strokes.flat().map((p) => p.y));
    expect(top).toBeGreaterThan(-SIZE * 1.1);
    expect(top).toBeLessThan(0);
  });

  it("'center' keeps the old behaviour for every other caller", () => {
    // The PCB, symbol and drawing-sheet renderers place a block by its centre,
    // so the default must not move under them.
    const centred = layoutText(`A\nB`, SIZE, 'center', 'center');
    const first = layoutText(`A\nB`, SIZE, 'center', 'first-line');
    const dy =
      Math.min(...centred.strokes.flat().map((p) => p.y)) -
      Math.min(...first.strokes.flat().map((p) => p.y));
    expect(dy).toBeCloseTo(-pitch / 2, 6);
  });

  it('spaces the lines by GetInterline', () => {
    const { strokes } = layoutText(`A\nB`, SIZE, 'left', 'first-line');
    const ys = strokes.flat().map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(pitch * 0.9);
  });
});
