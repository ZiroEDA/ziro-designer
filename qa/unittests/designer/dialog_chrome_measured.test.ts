// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A dialog's chrome is what GTK paints a wxDialog with, asked of wx.
 *
 * `qa/probes/dialog_chrome_probe.cpp` builds a `wxDialog` with a static text, a
 * text control and a button, shows it, pumps the loop and asks it. On this
 * machine under this theme:
 *
 *     dialog GetFont                     Ubuntu Sans 11pt  px=18
 *     dialog GetBackgroundColour         rgb( 44, 44, 44)  #2C2C2C
 *     staticText GetForegroundColour     rgb(247,247,247)  #F7F7F7
 *     wxSYS_COLOUR_BTNTEXT               rgb(247,247,247)  #F7F7F7
 *     entry GetBackgroundColour          rgb( 39, 39, 39)  #272727
 *     wxTextCtrl size                    98 x 34
 *     wxButton  size                     85 x 34
 *     dialog char height                 18
 *
 * The probe prints the font face on purpose: stripping the environment drops
 * the settings daemon and GTK falls back to Cantarell with no error, so a run
 * that does not say "Ubuntu Sans" measured the wrong theme.
 *
 * THE BUG THIS PINS. `.ze-modal` — the rule every dialog in the app inherits
 * from — carried `color: #f3f4f5`, four shades off the measured #F7F7F7 and
 * written as a literal where `--chrome-fg` already held the right value. Four
 * other dialog rules repeated the same literal.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHELL = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

/** A rule's body, by exact selector. */
function ruleBody(selector: string): string {
  const i = SHELL.indexOf(`\n${selector} {`);
  if (i < 0) throw new Error(`${selector} not found`);
  return SHELL.slice(i, SHELL.indexOf('}', i));
}

/** The declared value of a `:root` custom property. */
function token(name: string): string {
  const m = SHELL.match(new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm'));
  if (!m) throw new Error(`${name} is not declared`);
  return (m[1] ?? '').trim();
}

describe('the shared dialog takes its colours from the measured tokens', () => {
  it('paints its text with --chrome-fg, not a literal', () => {
    expect(ruleBody('.ze-modal')).toMatch(/color:\s*var\(--chrome-fg\)/);
  });

  it('and --chrome-fg is what wx reports for a dialog’s text', () => {
    // Without this the rule above passes while pointing at the wrong value.
    expect(token('--chrome-fg')).toBe('#f7f7f7');
  });

  it('and its background is the measured dialog background', () => {
    expect(ruleBody('.ze-modal')).toMatch(/background:\s*var\(--chrome-bg\)/);
    expect(token('--chrome-bg')).toBe('#2c2c2c');
  });

  // Per-occurrence, not "the file contains it somewhere": the literal was in
  // five separate rules, and a file-level check would have gone quiet after the
  // first was fixed.
  it('and no rule anywhere restates that colour as a literal', () => {
    const code = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = code
      .split('}')
      .filter((block) => /#f3f4f5/i.test(block))
      .map((block) => block.split('{')[0]!.trim().replace(/\s+/g, ' '));
    expect(offenders).toEqual([]);
  });
});

describe('a control in a dialog is the height wx makes it', () => {
  it('--ctl-height is the measured 34px', () => {
    // wxTextCtrl and wxButton both come back 34 tall in the probe.
    expect(token('--ctl-height')).toBe('34px');
  });
});

describe('a dialog\u2019s affirmative button is an ordinary button', () => {
  /**
   * `DIALOG_SHIM` makes OK the default (`sdbSizer->GetAffirmativeButton()->SetDefault()`,
   * dialog_shim.cpp:1882), and on GTK that binds Enter — it does not restyle
   * the button. An accent fill needs GTK's `.suggested-action`, and it never
   * arrives: KiCad asks for it nowhere in 10.0.5 (`grep -rn suggested-action`
   * is empty), and Yaru defines no `button.default` rule at all — checked in
   * the extracted theme, `gtk.gresource` -> `Yaru-dark/3.0/gtk.css`, which has
   * `.suggested-action` rules and no `button.default`.
   *
   * So every dialog's OK was accent-orange where KiCad leaves it the same grey
   * as Cancel. The class stays — it is what names the affirmative button for
   * Enter and for a11y — but it must not paint.
   */
  it('does not fill itself with the accent', () => {
    const body = ruleBody('.ze-btn.primary');
    expect(body).not.toMatch(/background:\s*var\(--chrome-active\)/);
    expect(body).not.toMatch(/background:\s*var\(--accent/);
  });

  it('and takes the same face as any other button', () => {
    expect(ruleBody('.ze-btn.primary')).toMatch(/background:\s*var\(--ctl-face\)/);
  });
});
