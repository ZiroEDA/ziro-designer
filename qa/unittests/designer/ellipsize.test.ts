// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Middle-ellipsis for status-bar fields, the web port of
 * KISTATUSBAR::SetEllipsedTextField's wxELLIPSIZE_MIDDLE pass.
 *
 * Measured in "character widths" so the expectations are readable: a monospace
 * measure of 1 unit per character makes every width below a character count.
 */
import { describe, expect, it } from 'vitest';
import { ellipsisMargin, ellipsizeMiddle } from '@ziroeda/designer/src/ui/ellipsize.js';

/** One unit per character, i.e. a monospace font of width 1. */
const mono = (s: string): number => s.length;

describe('ellipsizeMiddle', () => {
  it('leaves text that already fits alone', () => {
    expect(ellipsizeMiddle('short', 100, mono)).toBe('short');
    // Exactly the budget is still a fit, not an overflow.
    expect(ellipsizeMiddle('12345', 5, mono)).toBe('12345');
  });

  it('cuts from the middle, keeping both ends', () => {
    const text = '/usr/share/kicad/demos/kit-dev-coldfire.kicad_pro';
    const out = ellipsizeMiddle(text, 20, mono);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toContain('...');
    // What survives on each side is a genuine prefix and suffix of the input -
    // that is the whole point of cutting the middle rather than the end. (How
    // many characters each side keeps falls out of the budget: at 20 units it
    // is 9 and 8, so don't assert on a particular boundary.)
    const [head, tail] = out.split('...');
    expect(head).not.toBe('');
    expect(tail).not.toBe('');
    expect(text.startsWith(head!)).toBe(true);
    expect(text.endsWith(tail!)).toBe(true);
  });

  it('never exceeds the budget', () => {
    const text = 'kit-dev-coldfire-xilinx_5213/kit-dev-coldfire-xilinx_5213.kicad_pro';
    for (let w = 4; w <= text.length + 5; w++) {
      expect(ellipsizeMiddle(text, w, mono).length).toBeLessThanOrEqual(Math.max(w, 3));
    }
  });

  it('uses as much of the budget as it can', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    // With a 10-unit budget: "..." costs 3, so 7 original characters fit.
    const out = ellipsizeMiddle(text, 10, mono);
    expect(out).toHaveLength(10);
    // One more character would have overflowed.
    expect(out.replace('...', '')).toHaveLength(7);
  });

  it('splits the kept characters head-heavy, like wxWidgets', () => {
    // 7 kept characters -> 4 leading, 3 trailing.
    expect(ellipsizeMiddle('abcdefghijklmnopqrstuvwxyz', 10, mono)).toBe('abcd...xyz');
  });

  it('degrades to the ellipsis alone when nothing else fits', () => {
    expect(ellipsizeMiddle('abcdefgh', 3, mono)).toBe('...');
    expect(ellipsizeMiddle('abcdefgh', 2, mono)).toBe('...');
  });

  it('treats a zero or negative budget as "do not touch"', () => {
    // The caller (KISTATUSBAR: `if( width > 20 )`) is what really guards this,
    // so an unmeasurable field must not silently blank the text.
    expect(ellipsizeMiddle('abcdef', 0, mono)).toBe('abcdef');
    expect(ellipsizeMiddle('abcdef', -5, mono)).toBe('abcdef');
  });

  it('is stable: ellipsizing an already-ellipsized string is a no-op', () => {
    const once = ellipsizeMiddle('abcdefghijklmnopqrstuvwxyz', 10, mono);
    expect(ellipsizeMiddle(once, 10, mono)).toBe(once);
  });
});

describe('ellipsisMargin', () => {
  it('is the width of "XX", the margin KISTATUSBAR subtracts', () => {
    expect(ellipsisMargin(mono)).toBe(2);
    // Proportional fonts: whatever the measure says two X's cost.
    expect(ellipsisMargin((s) => s.length * 7)).toBe(14);
  });
});
