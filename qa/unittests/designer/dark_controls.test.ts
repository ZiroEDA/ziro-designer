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

  it('switches the native scrollbars off for every scroller, not just :root', () => {
    // `scrollbar-width` does NOT inherit - only `scrollbar-color` does - so the
    // `:root { scrollbar-width: thin }` that used to sit here reached the
    // document element and no pane at all, which is why every pane kept the
    // browser's 15 px gutter. It has to be a universal selector, and `*` is
    // specificity 0 so it cannot outrank anything below it. A `.ze-app *`
    // selector could, and would also miss anything rendered outside a frame.
    expect(rule('*')).toMatch(/scrollbar-width:\s*none/);
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

  it('carry the desktop accent on the controls that take one', () => {
    // This used to pin the literal #e07b1a, a shade that appears in no Yaru
    // stylesheet — so the test was holding the drift in place rather than
    // catching it. GTK paints ONE accent for every app: a live GerbView's
    // layer-visibility checkboxes fill with rgb(233,84,32), which is
    // --chrome-active, and so do real eeschema's.
    //
    // The MECHANISM has since moved and this assertion moved with it rather
    // than being relaxed. `accent-color` gets the fill right, but the tick is
    // not ours to ask for: the browser picks its own contrast colour, and GTK's
    // is a white check on the accent. So both controls are DRAWN —
    // `appearance: none` and a `:checked` rule — and the accent arrives as a
    // background. What has to stay true is that it arrives from the TOKEN.
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleFor = (selector: string): string => {
      const at = code.indexOf(`\n${selector} {`);
      expect(at, `shell.css has no rule for ${selector}`).toBeGreaterThanOrEqual(0);
      return code.slice(at, code.indexOf('}', at));
    };
    for (const sel of [
      '.ze-app input[type="checkbox"]:checked',
      '.ze-app input[type="radio"]:checked',
    ]) {
      const rule = ruleFor(sel);
      expect(rule, `${sel} does not take the accent from the token`).toContain(
        'var(--chrome-active)',
      );
      // The half that caught the original drift: not a shade written down here.
      expect(rule, `${sel} writes a literal colour`).not.toMatch(/:\s*#[0-9a-f]{3,8}\b/i);
    }
    // And no literal accent anywhere, for a control that still asks for one.
    expect(code).not.toMatch(/accent-color:\s*#/);
  });

  it('theme the option rows for engines that need it', () => {
    expect(CSS).toContain('.ze-app option,');
  });
});
