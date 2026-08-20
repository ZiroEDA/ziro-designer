// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxColourBase::ChangeLightness` and the `wxColour( 0xBBGGRR )` byte order.
 * Counterpart: wxWidgets `src/common/colourcmn.cpp`, used by KiCad in
 * `bitmap_button.cpp:270-310` (the four BITMAP_BUTTON states) and
 * `pcb_calculator/calculator_panels/panel_eseries_display.cpp:118-146` (the
 * seven E-series column colours and their alternates).
 *
 * Two details carry the whole thing and neither is guessable:
 *
 *  - the blend TRUNCATES. `AlphaBlend` computes in double and casts to
 *    `unsigned char`, so 206 * 0.78 = 160.68 becomes 160, not 161. Every
 *    expectation below is read off the RUNNING BINARY's pixels
 *    (`~/calcvis/k11_e-series.png`), not computed by calling the code, so a
 *    rounding implementation fails them.
 *  - above 100 the alpha is the COMPLEMENT, `200 - ialpha`, and the blend is
 *    toward white. 125 is therefore a quarter of the way to white, not a
 *    quarter again of the way from it.
 */

import { changeLightness, rgb8ToCss, rgbFromBgrHex } from '@ziroeda/common';
import { describe, expect, it } from 'vitest';

/** [data] panel_eseries_display.h:93-129, `wxColour( 0xBBGGRR )` literals. */
const E1 = 0xf0fff0;
const E6 = 0xed9564;
const E24 = 0xebce87;
const E48 = 0x23e86b;
const E96 = 0x7aa0ff;

/** [data] panel_eseries_display.h:80,87. */
const DARK = 78;
const ALT = 125;

describe('wxColour( 0xBBGGRR )', () => {
  it('reads the low byte as RED, so the E6 constant is cornflowerblue', () => {
    // 0xed9564 is written blue-first: r = 0x64, g = 0x95, b = 0xed. Read the
    // other way round it would be a muddy orange, and the E6 column is blue.
    expect(rgbFromBgrHex(E6)).toStrictEqual([100, 149, 237]);
    expect(rgbFromBgrHex(E24)).toStrictEqual([135, 206, 235]);
    expect(rgbFromBgrHex(E48)).toStrictEqual([107, 232, 35]);
    expect(rgbFromBgrHex(E96)).toStrictEqual([255, 160, 122]);
  });

  it('is its own inverse on a palindromic constant, which is why E1 hides the bug', () => {
    // honeydew is f0-ff-f0 either way round: a test that only used E1 or E3
    // would pass with the byte order reversed.
    expect(rgbFromBgrHex(E1)).toStrictEqual([240, 255, 240]);
  });
});

describe('ChangeLightness below 100 blends toward black', () => {
  it('matches the binary channel for channel at the E-series dark adjust of 78', () => {
    // [px] sampled from k11_e-series.png: the E24 column at (250,120), E48 at
    // (290,90), E96 at (330,100), E6 at (800,100), E1 at (720,200).
    expect(changeLightness(rgbFromBgrHex(E24), DARK)).toStrictEqual([105, 160, 183]);
    expect(changeLightness(rgbFromBgrHex(E48), DARK)).toStrictEqual([83, 180, 27]);
    expect(changeLightness(rgbFromBgrHex(E96), DARK)).toStrictEqual([198, 124, 95]);
    expect(changeLightness(rgbFromBgrHex(E6), DARK)).toStrictEqual([78, 116, 184]);
    expect(changeLightness(rgbFromBgrHex(E1), DARK)).toStrictEqual([187, 198, 187]);
  });

  it('truncates rather than rounds, which is a whole level on three channels', () => {
    // 206 * 0.78 = 160.68 and the binary paints 160; 232 * 0.78 = 180.96 and it
    // paints 180; 160 * 0.78 = 124.8 and it paints 124. Rounding gives 161,
    // 181 and 125, so this pins the cast and not just the arithmetic.
    expect(changeLightness([206, 232, 160], DARK)).toStrictEqual([160, 180, 124]);
  });
});

describe('ChangeLightness above 100 blends toward white by the COMPLEMENT', () => {
  it('matches the binary for the alternating blocks at 125', () => {
    // [px] the second block of each column, sampled from the same capture:
    // E24 at (250,230), E48 at (290,130), E96 at (330,120), E6 at (800,150).
    const dark = (bgr: number): readonly [number, number, number] =>
      changeLightness(rgbFromBgrHex(bgr), DARK);
    expect(changeLightness(dark(E24), ALT)).toStrictEqual([142, 183, 201]);
    expect(changeLightness(dark(E48), ALT)).toStrictEqual([126, 198, 84]);
    expect(changeLightness(dark(E96), ALT)).toStrictEqual([212, 156, 135]);
    expect(changeLightness(dark(E6), ALT)).toStrictEqual([122, 150, 201]);
  });

  it('uses 200 - ialpha, not ialpha, so 125 is a QUARTER of the way to white', () => {
    // With alpha 0.75 toward white: 255 - 0.75 * (255 - 0) = 63. Using the
    // ialpha itself (1.25) would overshoot past white and clamp to 255, and
    // using it as a blend toward black would give 0.
    expect(changeLightness([0, 0, 0], ALT)).toStrictEqual([63, 63, 63]);
    // and the far end stays put, because white blended toward white is white.
    expect(changeLightness([255, 255, 255], ALT)).toStrictEqual([255, 255, 255]);
  });

  it('leaves a colour alone at exactly 100', () => {
    expect(changeLightness([1, 2, 3], 100)).toStrictEqual([1, 2, 3]);
  });
});

describe('the four BITMAP_BUTTON states share this one function', () => {
  it('darkens wxSYS_COLOUR_HIGHLIGHT to 40/50/20 per bitmap_button.cpp:270-310', () => {
    // Yaru's highlight is #e95420. The checked fill keeps two fifths of it.
    const highlight: readonly [number, number, number] = [233, 84, 32];
    expect(changeLightness(highlight, 40)).toStrictEqual([93, 33, 12]);
    expect(changeLightness(highlight, 50)).toStrictEqual([116, 42, 16]);
    expect(changeLightness(highlight, 20)).toStrictEqual([46, 16, 6]);
  });
});

describe('rgb8ToCss', () => {
  it('spells a triple the way the stylesheet does', () => {
    expect(rgb8ToCss([105, 160, 183])).toBe('rgb(105, 160, 183)');
  });
});
