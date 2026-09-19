// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `VECTOR2<T>::Resize( T aNewLength )` takes a `T`, and for `VECTOR2I` that is
 * `int32_t` - so a caller passing a double has it narrowed by the language
 * before any of Resize's arithmetic runs. `PCB_MARKER` is such a caller:
 * `V1.Perpendicular().Resize( 2.5 * MarkerScale() )` (pcb_marker.cpp:410),
 * where `MarkerScale()` is `SCALING_FACTOR / sqrt( zoom )` and fractional
 * essentially always.
 *
 * Our parameter is a `number` and nothing narrowed it, so the fraction reached
 * `BigInt( aNewLength )` - which THROWS on a non-integer. The exception came
 * out of `EDA_DRAW_PANEL_GAL::DoRePaint`, and because it threw on every frame
 * while the marker stayed selected, the board stayed unpainted: clicking a DRC
 * violation blanked the canvas.
 */
import { describe, expect, it } from 'vitest';
import { ResizeI } from '@ziroeda/kimath/src/math/vector2.js';

describe('ResizeI narrows its length, as the C++ signature does', () => {
  it('does not throw on the fractional length PCB_MARKER passes', () => {
    // The very number from the console: 2.5 * MarkerScale() at that zoom.
    expect(() => ResizeI({ x: 1000, y: -2000 }, 216617.9301680271)).not.toThrow();
  });

  it('truncates toward zero, which is what static_cast<int> does', () => {
    // Not rounding: 216617.93 becomes 216617, so the answer is the one the
    // C++ gives for the same call - and .93 of an IU is invisible anyway,
    // which is why this was only ever a crash and never a wrong drawing.
    const v = { x: 3, y: 4 }; // |v| = 5, so Resize(n) is (0.6n, 0.8n)

    expect(ResizeI(v, 10.9)).toEqual(ResizeI(v, 10));
    expect(ResizeI(v, -10.9)).toEqual(ResizeI(v, -10));
    expect(ResizeI(v, 10)).toEqual({ x: 6, y: 8 });
  });

  it('keeps the equal-components branch on the same footing', () => {
    // |x| === |y| takes its own arm (`abs(len) * SQRT1_2`), which never
    // touched BigInt - so it could not throw, and it must still narrow.
    const diag = { x: 100, y: -100 };

    expect(ResizeI(diag, 141.9)).toEqual(ResizeI(diag, 141));
  });

  it('still answers zero for a zero vector', () => {
    expect(ResizeI({ x: 0, y: 0 }, 216617.93)).toEqual({ x: 0, y: 0 });
  });
});
