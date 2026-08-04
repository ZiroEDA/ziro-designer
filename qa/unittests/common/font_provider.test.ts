// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The single text-measurement entry point (#154).
 *
 * The property that matters most here is the one about *not* changing: with no
 * provider installed — which is every build today — every call has to return
 * exactly what the stroke font returns, for faced and unfaced text alike.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  hasFontProvider,
  setFontProvider,
  textWidth,
  type FontProvider,
} from '@ziroeda/common/src/font/font_provider.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';

const SIZE = 10000;
const install = (measure: FontProvider['measure']): void => setFontProvider({ measure });

afterEach(() => setFontProvider(null));

describe('with no provider installed', () => {
  it('is the stroke measurement, exactly', () => {
    expect(hasFontProvider()).toBe(false);
    for (const t of ['abc', '', 'two\nlines', '~{overbar}']) {
      expect(textWidth(t, SIZE)).toBe(measureText(t, SIZE));
      // Including for text that names a face: today every face draws with the
      // stroke font, so every face must measure with it too.
      expect(textWidth(t, SIZE, { face: 'Arial' })).toBe(measureText(t, SIZE));
    }
  });
});

describe('with a provider installed', () => {
  it('is asked for a face, and answers', () => {
    install(() => 12345);
    expect(textWidth('abc', SIZE, { face: 'Arial' })).toBe(12345);
  });

  it('is not asked when there is no face', () => {
    // The stroke font is not an outline face; routing it through a provider
    // would change how existing text measures, which is the whole risk.
    let asked = false;
    install(() => {
      asked = true;
      return 12345;
    });
    expect(textWidth('abc', SIZE)).toBe(measureText('abc', SIZE));
    expect(textWidth('abc', SIZE, { face: '' })).toBe(measureText('abc', SIZE));
    expect(asked).toBe(false);
  });

  it('receives the style it should measure in', () => {
    const seen: unknown[] = [];
    install((text, size, style) => {
      seen.push({ text, size, style });
      return 1;
    });
    textWidth('abc', SIZE, { face: 'Arial', bold: true, italic: true });
    expect(seen[0]).toEqual({
      text: 'abc',
      size: SIZE,
      style: { face: 'Arial', bold: true, italic: true },
    });
  });

  it('falls back to the stroke font when the provider declines', () => {
    // A face that is not installed, or a font still loading. Falling back to
    // what we draw today beats falling back to a guess.
    install(() => null);
    expect(textWidth('abc', SIZE, { face: 'Nope' })).toBe(measureText('abc', SIZE));
  });

  it('falls back when the provider answers nonsense', () => {
    // A broken provider must not be able to poison every bounding box in the
    // document with a NaN.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      install(() => bad);
      expect(textWidth('abc', SIZE, { face: 'Arial' })).toBe(measureText('abc', SIZE));
    }
  });

  it('can be uninstalled', () => {
    install(() => 12345);
    expect(hasFontProvider()).toBe(true);
    setFontProvider(null);
    expect(hasFontProvider()).toBe(false);
    expect(textWidth('abc', SIZE, { face: 'Arial' })).toBe(measureText('abc', SIZE));
  });
});
