// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Proof that a React panel can be RENDERED and asserted on, not just read.
 *
 * Until now `qa` had no DOM at all — no jsdom, no happy-dom, no testing
 * library. Every rule that lived in a `.tsx` could only be asserted as SOURCE
 * TEXT, which pins its spelling and not its behaviour, and three separate
 * agents this week had to extract logic out into `.ts` files purely so a test
 * could call it. Every audit ended with the same sentence: "could not verify —
 * nothing was rendered".
 *
 * The environment is opted into per file with the docblock above rather than
 * switched on globally: the other ~13 000 tests are pure functions over
 * engines, and paying for a DOM on all of them would be a real cost for no
 * gain. A `.tsx` test file is also why this one is named `.tsx` — qa's tsc
 * compiles `.ts` only, so a test that renders JSX has to say so in its
 * extension (see the TS6142 note in CLAUDE.md's neighbourhood).
 *
 * What this pins is the capability, not the panel. Its value is that the next
 * audit can assert what a control actually renders — `disabled`, a label, a
 * unit string — instead of grepping for the source line that ought to cause it.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PanelColorCode } from '@ziroeda/designer/src/editors/calculator/panels/panel_color_code.js';

describe('the DOM environment is real', () => {
  it('renders a calculator panel and finds its controls', () => {
    render(<PanelColorCode />);

    // `PANEL_COLOR_CODE`'s tolerance radio set (panel_color_code_base.cpp) —
    // asserted as RENDERED RADIOS, which no source-text check could do: a
    // `grep` cannot tell a radio that is drawn from one behind an early return.
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThan(0);

    // And at least one is checked, which is state rather than markup.
    expect(radios.some((r) => (r as HTMLInputElement).checked)).toBe(true);
  });
});
