// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_TEXT::GetBoundingBox` / `PCB_TEXT::TextHitTest` (`pcbnew/pcb_text.cpp`),
 * and the measured table that replaced the old `chars x size.x x 0.6` guess.
 */

import { describe, expect, it } from 'vitest';
import {
  drawRotation,
  textItemBBox,
  textItemBox,
  textItemHitTest,
  textPenWidth,
} from '@ziroeda/pcbnew/src/text_metrics.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';
import { kiRound } from '@ziroeda/common/src/font/text_box.js';
import type { PcbTextItem } from '@ziroeda/pcbnew/src/types.js';

const MM = 1e6;
const SIZE = { x: MM, y: MM };
const THICK = 0.15 * MM;

const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'reference',
  text: 'R1',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.SilkS',
  size: SIZE,
  thickness: THICK,
  source: [] as unknown as PcbTextItem['source'],
  ...over,
});

/** What the four call sites computed before: `chars x size.x x 0.6`, used as a *half* width. */
const oldHalfWidth = (s: string): number => Math.max(s.length, 1) * SIZE.x * 0.6;

describe('the measured table (PR body)', () => {
  // GetTextBox width, straight from the C++:
  //   advance - KiROUND(size.x x 0.2) + 2 x KiROUND(thickness x 1.5)
  const realWidth = (s: string): number =>
    measureText(s, SIZE.x) - kiRound(SIZE.x * 0.2) + 2 * kiRound(THICK * 1.5);

  const cases: [string, number][] = [
    // text                  GetTextBox width in mm (1 mm glyphs, 0.15 mm pen)
    ['IIII', 2.1548],
    ['WWWW', 4.8214],
    ['R1', 2.2024],
    ['U12', 3.2024],
    ['C101', 4.1071],
    ['100nF', 4.869],
    ['0.1uF', 4.3929],
    ['10k', 2.9643],
    ['Conn_01x08_Pin_Header', 18.4405],
    ['J1 (top, +3V3)', 11.6786],
  ];

  it.each(cases)('%s measures as GetTextBox says', (s, mm) => {
    const box = textItemBox(text({ text: s }));
    expect(box.w).toBe(realWidth(s));
    expect(box.w / MM).toBeCloseTo(mm, 3);
  });

  it('the old estimate could not tell IIII from WWWW; the font can', () => {
    // The estimate is character-count-driven, so equal-length strings tie.
    expect(oldHalfWidth('IIII')).toBe(oldHalfWidth('WWWW'));
    // Newstroke does not: W is 2.4x the advance of I.
    const narrow = textItemBox(text({ text: 'IIII' })).w;
    const wide = textItemBox(text({ text: 'WWWW' })).w;
    expect(wide / narrow).toBeGreaterThan(2);
  });

  it('the estimate was too wide for everything but a string of Ws', () => {
    // 0.6 em per character sits just under the widest Newstroke glyph (W is
    // 24/21 = 1.14 em against a 2 x 0.6 = 1.2 em allowance), so the guess
    // over-measures every realistic string and under-measures only all-W text.
    const ratio = (s: string): number => (2 * oldHalfWidth(s)) / textItemBox(text({ text: s })).w;
    expect(ratio('IIII')).toBeCloseTo(2.23, 2);
    expect(ratio('J1 (top, +3V3)')).toBeCloseTo(1.44, 2);
    expect(ratio('Conn_01x08_Pin_Header')).toBeCloseTo(1.37, 2);
    expect(ratio('R1')).toBeCloseTo(1.09, 2);
    expect(ratio('WWWW')).toBeLessThan(1);
  });

  it('and every box is taller: the old one was the bare glyph height', () => {
    // GetTextBox height = (size.y + 2 x KiROUND(pen x 1.5)) x 1.17.
    const box = textItemBox(text());
    expect(box.h).toBeCloseTo(1.6965 * MM, -1);
    expect(box.h / SIZE.y).toBeGreaterThan(1.69);
  });
});

describe('EDA_TEXT::GetEffectiveTextPenWidth on a board item', () => {
  it('takes the file thickness, else size.x/8, else size.x/5 when bold', () => {
    expect(textPenWidth(text())).toBe(THICK);
    expect(textPenWidth(text({ thickness: undefined }))).toBe(MM / 8);
    expect(textPenWidth(text({ thickness: undefined, bold: true }))).toBe(MM / 5);
  });
});

describe('PCB_TEXT::GetDrawRotation', () => {
  it('folds keep-upright footprint text into ]-90, 90]', () => {
    expect(drawRotation(text({ angle: 270, keepUpright: true }))).toBe(90);
    expect(drawRotation(text({ angle: 180, keepUpright: true }))).toBe(0);
    expect(drawRotation(text({ angle: 90, keepUpright: true }))).toBe(90);
  });

  it('leaves board text (gr_text) at its stored angle', () => {
    expect(drawRotation(text({ angle: 270 }))).toBe(270);
  });
});

describe('PCB_TEXT::GetBoundingBox', () => {
  it('is the text box for unrotated text', () => {
    expect(textItemBBox(text())).toEqual(textItemBox(text()));
  });

  it('swaps width and height at 90 degrees', () => {
    const flat = textItemBox(text());
    const turned = textItemBBox(text({ angle: 90 }));
    expect(turned.w).toBeCloseTo(flat.h, 6);
    expect(turned.h).toBeCloseTo(flat.w, 6);
  });

  it('stays centred on the anchor when the text is centre-justified', () => {
    const turned = textItemBBox(text({ angle: 90 }));
    // GetTextBox centres with C++ integer division, so the anchor can sit up to
    // one internal unit (1 nm) off the exact centre.
    expect(Math.abs(turned.x + turned.w / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(turned.y + turned.h / 2)).toBeLessThanOrEqual(1);
  });
});

describe('PCB_TEXT::TextHitTest', () => {
  it('accepts the anchor and rejects a point past the real glyph run', () => {
    const t = text({ text: 'IIII' });
    const halfW = textItemBox(t).w / 2;
    expect(textItemHitTest(t, { x: 0, y: 0 }, 0)).toBe(true);
    expect(textItemHitTest(t, { x: halfW - 1, y: 0 }, 0)).toBe(true);
    expect(textItemHitTest(t, { x: halfW + 1, y: 0 }, 0)).toBe(false);
  });

  it('no longer picks up a click a long way past narrow text', () => {
    // The old half-width for "IIII" was 4 x 1 mm x 0.6 = 2.4 mm; the glyph run
    // only reaches 1.077 mm from the anchor, so 2 mm out was a false hit.
    const t = text({ text: 'IIII' });
    expect(oldHalfWidth('IIII') / MM).toBe(2.4);
    expect(textItemHitTest(t, { x: 2 * MM, y: 0 }, 0)).toBe(false);
  });

  it('keeps the caller tolerance, which is upstream aAccuracy', () => {
    const t = text({ text: 'IIII' });
    const halfW = textItemBox(t).w / 2;
    expect(textItemHitTest(t, { x: halfW + 0.2 * MM, y: 0 }, 0)).toBe(false);
    expect(textItemHitTest(t, { x: halfW + 0.2 * MM, y: 0 }, 0.3 * MM)).toBe(true);
  });

  it('rotates the point back into the text frame', () => {
    const flat = text({ text: 'Conn_01x08_Pin_Header' });
    const box = textItemBox(flat);
    const along = { x: box.w / 2 - 1, y: 0 };
    const turned = text({ text: 'Conn_01x08_Pin_Header', angle: 90 });
    // A point far out along +x hits the flat text but not the turned one...
    expect(textItemHitTest(flat, along, 0)).toBe(true);
    expect(textItemHitTest(turned, along, 0)).toBe(false);
    // ...and the same distance along the rotated axis hits the turned one.
    expect(textItemHitTest(turned, { x: 0, y: -(box.w / 2 - 1) }, 0)).toBe(true);
  });
});
