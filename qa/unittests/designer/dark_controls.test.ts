// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Native controls follow the shell's theme.
 *
 * Everything the stylesheet paints was dark, but scrollbars, text fields,
 * comboboxes and the list a `<select>` opens are drawn by the *user agent*,
 * which defaults to the OS light theme. The result was white scrollbars and
 * white input boxes over a dark shell. A few places had been themed one at a
 * time — `.ze-auxbar select`, `.ze-cell-input` — and everything else was missed,
 * which is exactly the drift a per-widget approach produces.
 *
 * The shell is dark-only (no light variant, no `prefers-color-scheme` branch),
 * so the fix is one `color-scheme` declaration plus explicit greys, and this
 * pins the pieces that are easy to lose.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

/** The body of the first rule whose selector matches exactly. */
const rule = (selector: string): string => {
  const rx = new RegExp(
    `(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
  );
  return rx.exec(CSS)?.[2] ?? '';
};

describe('the shell tells the browser it is dark', () => {
  it('declares color-scheme, which is what themes the popups it opens', () => {
    // The open <select> list is a native popup CSS cannot reach; only this does.
    expect(rule(':root')).toMatch(/color-scheme:\s*dark/);
  });

  it('sets the Firefox scrollbar properties where they can inherit', () => {
    // Both inherit, so declaring them on :root reaches every scroller without a
    // universal selector (which would outrank later rules and trip the
    // descending-specificity lint).
    const root = rule(':root');
    expect(root).toMatch(/scrollbar-width:\s*thin/);
    expect(root).toMatch(/scrollbar-color:/);
    expect(CSS).not.toContain('.ze-app * {');
  });
});

describe('scrollbars are KiCad grey, not the browser default', () => {
  for (const part of ['', '-track', '-thumb', '-corner']) {
    it(`styles ::-webkit-scrollbar${part}`, () => {
      expect(CSS).toContain(`.ze-app ::-webkit-scrollbar${part}`);
    });
  }

  it('hides the end buttons, which KiCad has none of', () => {
    expect(rule('.ze-app ::-webkit-scrollbar-button')).toMatch(/display:\s*none/);
  });
});

describe('text fields and comboboxes', () => {
  it('are themed app-wide, not one widget at a time', () => {
    expect(CSS).toContain('.ze-app select,');
    expect(CSS).toContain('.ze-app textarea {');
  });

  it('leave the drawn controls alone', () => {
    // A checkbox, radio, colour well or slider is painted, not filled: giving
    // them a background and a border destroys them.
    for (const type of ['checkbox', 'radio', 'color', 'range']) {
      expect(CSS).toContain(`:not([type="${type}"])`);
    }
  });

  it('carry the orange accent on the controls that take one', () => {
    expect(CSS).toMatch(/accent-color:\s*#e07b1a/);
  });

  it('theme the option rows for engines that need it', () => {
    expect(CSS).toContain('.ze-app option,');
  });
});
