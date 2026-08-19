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

/** The stylesheet with its comments taken out, so a brace inside one cannot
    read as the end of a rule. The :root block documents the GTK rules its
    values come from, quoted verbatim - `button { min-height: 24px; ... }` - and
    the `[^}]*` below stopped dead at the first of those. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first rule whose selector matches exactly. */
const rule = (selector: string): string => {
  const rx = new RegExp(
    `(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
  );
  return rx.exec(CSS_CODE)?.[2] ?? '';
};

describe('the shell tells the browser it is dark', () => {
  it('declares color-scheme, which is what themes the popups it opens', () => {
    // The open <select> list is a native popup CSS cannot reach; only this does.
    expect(rule(':root')).toMatch(/color-scheme:\s*dark/);
  });

  it('switches the native scrollbars off where the property can inherit', () => {
    // It inherits, so declaring it on :root reaches every scroller without a
    // universal selector (which would outrank later rules and trip the
    // descending-specificity lint). `thin` used to be the value here and still
    // reserved a gutter; see overlay_scrollbars.test.ts for what replaced it.
    expect(rule(':root')).toMatch(/scrollbar-width:\s*none/);
    expect(CSS).not.toContain('.ze-app * {');
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
