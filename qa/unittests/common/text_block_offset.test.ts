// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where a laid-out block sits relative to the text's position —
 * `FONT::getLinePositions` (`common/font/font.cpp:181-243`):
 *
 *     offset.y  = size.y
 *     offset.x += strokeWidth / 1.52       // "Fudge factors to match 6.0"
 *     offset.y -= strokeWidth * 0.052
 *     height    = size.y * 1.17 + (n-1) * interline
 *     V_CENTER: offset.y -= height / 2;    V_BOTTOM: offset.y -= height
 *
 * Every number here is worked from that, never from what the code prints. The
 * two that matter most are the ones that look like they should not exist:
 * `size.y * 1.17` is not the glyph height, so centred text does not sit with
 * its glyphs centred on the anchor, and `strokeWidth * 0.052` shifts the whole
 * block by a fraction of the pen. `size / 2`, which is what the three call
 * sites used to use, is a fifth of a millimetre out on a 2 mm two-line label —
 * and the pour's knockout hull inherited the error.
 */
import { describe, it, expect } from 'vitest';
import { interline, textBlockOffset } from '@ziroeda/common/src/font/stroke_font.js';

const SIZE = 2032000; // 2.032 mm in pcbnew IU
const PEN = 304800; // 0.3048 mm
const WIDTH = 28448000; // whatever layoutText returned; only its half is used

const call = (over: Partial<Parameters<typeof textBlockOffset>[0]> = {}) =>
  textBlockOffset({
    size: SIZE,
    width: WIDTH,
    strokeWidth: PEN,
    lineCount: 1,
    hAlign: 'center',
    vAlign: 'center',
    ...over,
  });

describe('textBlockOffset', () => {
  it('centres a single line by 1.17 sizes, not by one', () => {
    // offset.y = size - pen*0.052 - (size*1.17)/2
    expect(call().y).toBeCloseTo(SIZE - PEN * 0.052 - (SIZE * 1.17) / 2, 3);
    // Which is NOT size/2: that is the bug this replaced, and it is 0.19 mm out.
    expect(Math.abs(call().y - SIZE / 2)).toBeGreaterThan(188000);
  });

  it('leaves the line count out of the centred case entirely', () => {
    // `getLinePositions` subtracts half a block that grows by one interline per
    // line, and `layoutText` has already raised the stack by exactly that half.
    // The two cancel, so a two-line block centres where a one-line block does.
    expect(call({ lineCount: 2 }).y).toBeCloseTo(call({ lineCount: 1 }).y, 6);
    expect(call({ lineCount: 5 }).y).toBeCloseTo(call({ lineCount: 1 }).y, 6);
  });

  it('drops a top-aligned block by the whole height and a bottom-aligned one by none', () => {
    const pitch = interline(SIZE);
    // V_TOP subtracts nothing, so line 0's baseline is one size down; the
    // half-block `layoutText` added back is the only line-count term left.
    expect(call({ vAlign: 'top', lineCount: 3 }).y).toBeCloseTo(SIZE - PEN * 0.052 + pitch, 3);
    // V_BOTTOM subtracts the whole height.
    expect(call({ vAlign: 'bottom', lineCount: 3 }).y).toBeCloseTo(
      SIZE - PEN * 0.052 - (SIZE * 1.17 + 2 * pitch) + pitch,
      3,
    );
    // Bottom sits a whole 1.17 sizes below top, whatever the line count.
    expect(
      call({ vAlign: 'top', lineCount: 3 }).y - call({ vAlign: 'bottom', lineCount: 3 }).y,
    ).toBeCloseTo(SIZE * 1.17 + 2 * pitch, 3);
  });

  it('carries the pen fudge into the horizontal offset of left and right text', () => {
    // `lineOffset.x = offset.x` for LEFT and `-( lineSize.x + offset.x )` for
    // RIGHT, but CENTER *assigns* `-lineSize.x / 2` and so never sees it.
    expect(call({ hAlign: 'left' }).x).toBeCloseTo(PEN / 1.52, 6);
    expect(call({ hAlign: 'right' }).x).toBeCloseTo(-(WIDTH + PEN / 1.52), 6);
    expect(call({ hAlign: 'center' }).x).toBeCloseTo(-WIDTH / 2, 6);
  });

  it('leaves a text with no thickness of its own where the pen fudges would not move it', () => {
    // `getLinePositions` reads TEXT_ATTRIBUTES::m_StrokeWidth — the stored
    // thickness — not the effective pen `GetEffectiveTextPenWidth` substitutes,
    // so a field left at zero contributes no fudge at all.
    expect(call({ strokeWidth: 0, hAlign: 'left' }).x).toBe(0);
    expect(call({ strokeWidth: 0 }).y).toBeCloseTo(SIZE - (SIZE * 1.17) / 2, 6);
  });

  it('puts line 0 on the baseline when layoutText was not asked to centre the stack', () => {
    const pitch = interline(SIZE);
    // 'first-line' leaves line 0 at y=0, so the half-block correction is gone.
    expect(call({ lineCount: 3, vBlock: 'first-line' }).y).toBeCloseTo(
      call({ lineCount: 3 }).y - pitch,
      6,
    );
  });
});
