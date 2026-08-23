// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COLOR4D::ToHSV`, `FromHSV`, `ToHexString` and `SetFromHexString`
 * (`common/gal/color4d.cpp:180-223, 387-511`).
 *
 * These four are what DIALOG_COLOR_PICKER is built out of: the wheel is drawn
 * by `FromHSV`, the spin controls read `ToHSV`, and the entry at the bottom is
 * the hex pair. None of them existed here - the app had no colour picker of
 * its own and handed the job to `<input type="color">`, which is the desktop's
 * picker and opens off-screen on a control near the window edge.
 */
import { describe, expect, it } from 'vitest';
import { fromHSV, setFromHexString, toHexString, toHSV } from '@ziroeda/common/src/color4d.js';

const near = (a: number, b: number, eps = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('ToHSV', () => {
  it('codes the six hue landmarks the comment in color4d.cpp lists', () => {
    // "0 or 360 : red, 60 : yellow, 120 : green, 180 : cyan, 240 : blue,
    //  300 : magenta" — color4d.cpp:412-419.
    const hue = (r: number, g: number, b: number): number => toHSV({ r, g, b, a: 1 }).hue;
    expect(hue(1, 0, 0)).toBe(0);
    expect(hue(1, 1, 0)).toBe(60);
    expect(hue(0, 1, 0)).toBe(120);
    expect(hue(0, 1, 1)).toBe(180);
    expect(hue(0, 0, 1)).toBe(240);
    expect(hue(1, 0, 1)).toBe(300);
  });

  it('gives black saturation 0, and no hue unless asked', () => {
    // "for black color (r = g = b = 0) saturation is set to 0" (:405-410), and
    // the hue is NaN unless aAlwaysDefineHue. The picker passes true, because a
    // spin control has to show a number.
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(toHSV(black).sat).toBe(0);
    expect(toHSV(black).hue).toBeNaN();
    expect(toHSV(black, true).hue).toBe(0);
  });

  it('gives a grey no hue either — delta is 0, not just max', () => {
    // The second NaN branch, :434-437. A test that only covered black would
    // pass with this branch deleted.
    const grey = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
    expect(toHSV(grey).hue).toBeNaN();
    expect(toHSV(grey).sat).toBe(0);
    expect(toHSV(grey).val).toBe(0.5);
    // And 0 when asked, which is the assertion the branch actually needs:
    // without it the fall-through computes `(g - b) / delta` = 0/0 and reaches
    // NaN by accident, so deleting the branch changed nothing a test could see.
    expect(toHSV(grey, true).hue).toBe(0);
  });

  it('reports value as the LARGEST channel, not the average', () => {
    expect(toHSV({ r: 0.2, g: 0.9, b: 0.4, a: 1 }).val).toBe(0.9);
  });
});

describe('FromHSV', () => {
  it('round-trips every hue sector', () => {
    for (let hue = 0; hue < 360; hue += 17) {
      const c = fromHSV(hue, 0.8, 0.6);
      const back = toHSV(c, true);
      near(back.hue, hue, 1e-9);
      near(back.sat, 0.8, 1e-9);
      near(back.val, 0.6, 1e-9);
    }
  });

  it('is grey at saturation 0, whatever the hue', () => {
    // The early return at :443-449.
    expect(fromHSV(200, 0, 0.4)).toEqual({ r: 0.4, g: 0.4, b: 0.4, a: 1 });
    // The guard is `aInS <= 0.0`, not `< 0.0`. At exactly 0 the sector maths
    // happens to reach the same grey, so only a NEGATIVE saturation tells the
    // two apart - and upstream's guard says that is grey too.
    expect(fromHSV(200, -0.5, 0.4)).toEqual({ r: 0.4, g: 0.4, b: 0.4, a: 1 });
  });

  it('wraps a hue at or past 360 rather than clamping it', () => {
    // `while( hh >= 360.0 ) hh -= 360.0` (:452-453). Clamping would make 400
    // magenta instead of the orange 40 degrees is.
    expect(fromHSV(400, 1, 1)).toEqual(fromHSV(40, 1, 1));
    expect(fromHSV(360, 1, 1)).toEqual(fromHSV(0, 1, 1));
  });
});

describe('the hex string pair', () => {
  it('always writes the alpha byte, in upper case', () => {
    // wxString::Format( "#%02X%02X%02X%02X" ) — color4d.cpp:215-222. An opaque
    // colour still ends in FF, which `#RRGGBB` output would drop.
    expect(toHexString({ r: 1, g: 0, b: 0, a: 1 })).toBe('#FF0000FF');
    expect(toHexString({ r: 0, g: 0.5, b: 1, a: 0.5 })).toBe('#0080FF80');
  });

  it('reads 8 hex digits as RGBA and 6 as RGB with alpha 1', () => {
    // The length branch at :194-207.
    expect(setFromHexString('#FF000080')).toEqual({ r: 1, g: 0, b: 0, a: 128 / 255 });
    expect(setFromHexString('#FF0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it('refuses a string under 7 characters, CSS shorthand included', () => {
    // `if( str.length() < 7 || !str.StartsWith( '#' ) ) return false` (:186).
    // `#ABC` is a colour in CSS and is NOT one here, which is the difference
    // that lets a half-typed entry leave the picker's colour alone.
    expect(setFromHexString('#ABC')).toBeNull();
    expect(setFromHexString('#1')).toBeNull();
    expect(setFromHexString('FF0000')).toBeNull();
  });

  it('trims either end before deciding', () => {
    // `str.Trim( true ); str.Trim( false );` (:183-184).
    expect(setFromHexString('  #FF0000  ')).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it('round-trips through the picker unchanged', () => {
    for (const hex of ['#000000FF', '#FFFFFFFF', '#123456AB', '#E95420FF']) {
      const c = setFromHexString(hex);
      expect(c).not.toBeNull();
      expect(toHexString(c as NonNullable<typeof c>)).toBe(hex);
    }
  });
});
