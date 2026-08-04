// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The canvas-backed outline measurer (#154, step 2a).
 *
 * Tested against a fake measuring context, which is why the real one is
 * injected: there is no canvas in a headless run, and a font-measurement path
 * that only executes in a browser is one nobody checks.
 */
import { describe, it, expect } from 'vitest';
import {
  canvasFontProvider,
  fontShorthand,
  type MeasuringContext,
} from '@ziroeda/designer/src/font/canvas_font_provider.js';

/** Records what it was asked, and charges 10 per character. */
function fake(): MeasuringContext & { fonts: string[]; texts: string[] } {
  return {
    font: '',
    fonts: [] as string[],
    texts: [] as string[],
    measureText(text: string) {
      this.fonts.push(this.font);
      this.texts.push(text);
      return { width: text.length * 10 };
    },
  };
}

describe('the CSS font shorthand', () => {
  it('carries size and face', () => {
    expect(fontShorthand(12, { face: 'Arial' })).toBe('12px "Arial", sans-serif');
  });

  it('carries bold and italic in CSS order', () => {
    expect(fontShorthand(12, { face: 'Arial', bold: true, italic: true })).toBe(
      'italic bold 12px "Arial", sans-serif',
    );
  });

  it('quotes the family, since names have spaces', () => {
    expect(fontShorthand(12, { face: 'Times New Roman' })).toContain('"Times New Roman"');
  });

  it('falls back to sans-serif for a face the browser lacks', () => {
    // The draw call gets the same fallback, so measuring must too.
    expect(fontShorthand(12, { face: 'Nope' })).toContain('sans-serif');
  });

  it('cannot be broken out of by a quote in the family name', () => {
    // A face comes out of a file, so it is untrusted input for a string that
    // gets parsed as CSS.
    expect(fontShorthand(12, { face: 'A" monospace, x' })).toBe(
      '12px "A monospace, x", sans-serif',
    );
  });
});

describe('measuring', () => {
  it('asks the context in the right font', () => {
    const ctx = fake();
    canvasFontProvider(ctx).measure('abc', 12, { face: 'Arial', bold: true });
    expect(ctx.fonts[0]).toBe('bold 12px "Arial", sans-serif');
    expect(ctx.texts[0]).toBe('abc');
  });

  it('declines when there is no face', () => {
    // The stroke font is not an outline face; measuring it here would change
    // how every existing text measures.
    const ctx = fake();
    expect(canvasFontProvider(ctx).measure('abc', 12, {})).toBeNull();
    expect(ctx.texts).toEqual([]);
  });

  it('takes the widest line, not the sum', () => {
    // The stroke font's measureText and layoutText disagreed about exactly
    // this until #410. A provider that reintroduced it for outline faces would
    // put every geometric consumer back where it was.
    const ctx = fake();
    const m = canvasFontProvider(ctx).measure('abcd\nab', 12, { face: 'Arial' });
    expect(m).toBe(40);
  });

  it('measures each line separately, never the newline', () => {
    const ctx = fake();
    canvasFontProvider(ctx).measure('ab\ncd', 12, { face: 'Arial' });
    expect(ctx.texts).toEqual(['ab', 'cd']);
  });

  it('declines rather than throwing when the context fails', () => {
    // A lost context, or a font string it rejects. Declining sends the caller
    // to the stroke font, which is what we draw today.
    const broken: MeasuringContext = {
      font: '',
      measureText() {
        throw new Error('context lost');
      },
    };
    expect(canvasFontProvider(broken).measure('abc', 12, { face: 'Arial' })).toBeNull();
  });
});
