// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The GL canvas must declare its buffer premultiplied.
 *
 * The blend equation writes `alpha·colour` into a transparent canvas, which is
 * premultiplied by definition. Declaring otherwise makes the *compositor*
 * multiply by the buffer's alpha a second time, and the error is invisible on
 * anything opaque: tracks matched pcbnew pixel for pixel while every zone fill
 * — the one thing drawn at 0.6 — came out at 0.36 of its colour.
 *
 * There is no headless WebGL here, so this pins the contract at the point it
 * is declared, which is where it went wrong.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../../../designer/src/render/gl/device.ts', import.meta.url),
  'utf8',
);

describe('WebGL context attributes', () => {
  it('declares premultipliedAlpha true', () => {
    expect(src).toMatch(/premultipliedAlpha:\s*true/);
    expect(src).not.toMatch(/premultipliedAlpha:\s*false/);
  });

  it('still blends with the equation that produces a premultiplied buffer', () => {
    // SRC_ALPHA/ONE_MINUS_SRC_ALPHA for colour, ONE/ONE_MINUS_SRC_ALPHA for
    // alpha: the pair that accumulates premultiplied colour and true coverage.
    expect(src).toMatch(
      /blendFuncSeparate\(\s*gl\.SRC_ALPHA,\s*gl\.ONE_MINUS_SRC_ALPHA,\s*gl\.ONE,\s*gl\.ONE_MINUS_SRC_ALPHA\s*\)/,
    );
  });
});

describe('the arithmetic the bug came from', () => {
  const BG = [0, 16, 35];
  const BCU = [77, 127, 196];
  const mix = (a: number, c: number[]): number[] =>
    c.map((v, i) => Math.round(a * v + (1 - a) * BG[i]!));
  const twice = (a: number, c: number[]): number[] =>
    c.map((v, i) => Math.round(a * (a * v) + (1 - a) * BG[i]!));

  it('matches pcbnew once, and the reported dark pour when applied twice', () => {
    // Measured from a pcbnew screenshot of the same board, zone opacity 0.6.
    expect(mix(0.6, BCU)).toEqual([46, 83, 132]);
    // What ours drew before the fix, measured from the same view.
    expect(twice(0.6, BCU)).toEqual([28, 52, 85]);
  });
});
