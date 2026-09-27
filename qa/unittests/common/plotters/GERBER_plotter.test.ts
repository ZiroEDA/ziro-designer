// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GERBER_PLOTTER pieces the kicad-cli oracle (`qa/unittests/pcbnew/
 * plot_gerber_oracle.test.ts`) cannot reach with a real board. Expectations are
 * read off GERBER_plotter.cpp, cited per case.
 */
import { describe, expect, it } from 'vitest';
import {
  APER_MACRO_FREEPOLY,
  APER_MACRO_FREEPOLY_LIST,
} from '@ziroeda/common/plotters/GERBER_plotter.js';

describe('APER_MACRO_FREEPOLY', () => {
  const poly = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 0, y: 1000 },
  ];

  it('treats corners within 2 IU as the same polygon (polyCompare, margin = 2)', () => {
    const am = new APER_MACRO_FREEPOLY(poly, 0);
    expect(
      am.IsSamePoly([
        { x: 2, y: -2 },
        { x: 1002, y: 0 },
        { x: 0, y: 998 },
      ]),
    ).toBe(true);
    expect(
      am.IsSamePoly([
        { x: 3, y: 0 },
        { x: 1000, y: 0 },
        { x: 0, y: 1000 },
      ]),
    ).toBe(false);
    expect(am.IsSamePoly(poly.slice(0, 2))).toBe(false);
  });

  it('numbers the list in append order and finds by shape', () => {
    const list = new APER_MACRO_FREEPOLY_LIST();
    list.Append(poly);
    list.Append([{ x: 5, y: 5 }, ...poly]);
    expect(list.FindAm([{ x: 5, y: 5 }, ...poly])).toBe(1);
    expect(
      list.FindAm([
        { x: 1, y: 1 },
        { x: 1001, y: 0 },
        { x: 0, y: 1001 },
      ]),
    ).toBe(0);
    expect(list.FindAm([{ x: 9, y: 9 }])).toBe(-1);
  });

  it('closes the outline, negates Y as an int, and breaks the line every 20 corners', () => {
    // Format: "%AMFreePoly<id>*", "4,1,<n>," then n+1 corner pairs, a newline
    // after each 20th, and "$1*%" on whatever line the corners ended. A zero Y prints "0.000000", never "-0.000000".
    const corners = Array.from({ length: 21 }, (_, i) => ({ x: i * 1000000, y: 0 }));
    const text = new APER_MACRO_FREEPOLY(corners, 3).Format(1e-6);
    const lines = text.split('\n');
    expect(lines[0]).toBe('%AMFreePoly3*');
    expect(lines[1]!.startsWith('4,1,21,0.000000,0.000000,1.000000,0.000000,')).toBe(true);
    expect(lines[1]!.endsWith('19.000000,0.000000,')).toBe(true);
    // the 21st corner and the closing repeat of the first share the last line
    // with the rotation parameter
    expect(lines[2]).toBe('20.000000,0.000000,0.000000,0.000000,$1*%');
    expect(text).not.toContain('-0.000000');
  });
});
