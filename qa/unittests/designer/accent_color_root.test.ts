// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every native control takes the THEME's accent, not the browser's blue.
 *
 * GTK paints a checkbox tick, a radio dot, a slider thumb and the highlighted
 * row of a dropdown in `wxSYS_COLOUR_HIGHLIGHT` — on this desktop Yaru's
 * #e95420, which `--chrome-active` already holds and which the probe measured.
 * A browser paints all of those its own blue unless the page says otherwise,
 * and `accent-color` is how a page says otherwise.
 *
 * It belongs on `.ze-app`, the root every launcher inherits from, for exactly
 * the reason CLAUDE.md gives: state a shared value once, centrally. It was
 * stated in `calculator.css` and nowhere else, so the calculator's checkboxes
 * were orange and every other launcher's were blue — the same drift as the
 * `13px` / "Segoe UI" the root itself used to carry.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

const SHELL = read('ui/shell.css');

/** The body of the bare `.ze-app { … }` rule — the shell root. */
function appRule(): string {
  const m = /\n\.ze-app \{([^}]*)\}/.exec(SHELL);
  if (!m) throw new Error('.ze-app rule not found');
  return m[1] ?? '';
}

describe('the shell root carries the accent', () => {
  it('sets accent-color on .ze-app', () => {
    expect(appRule()).toMatch(/accent-color:/);
  });

  it('and takes it from the token, not a literal', () => {
    expect(appRule()).toMatch(/accent-color:\s*var\(--chrome-active\)/);
  });

  // The token must be the theme's highlight, or the rule above points at the
  // wrong thing while still passing.
  it('which is the measured Yaru highlight', () => {
    expect(SHELL).toMatch(/--chrome-active:\s*#e95420/);
  });
});

describe('no launcher restates it', () => {
  // A local `accent-color` is the specificity trap: it makes one launcher
  // right and hides that the root is wrong for all the others.
  const LAUNCHERS = [
    'editors/calculator/calculator.css',
    'editors/image/imageConverter.css',
    'widgets/properties_panel.css',
  ];

  it.each(LAUNCHERS)('%s states no accent-color of its own', (rel) => {
    expect(read(rel)).not.toMatch(/^\s*accent-color:/m);
  });
});
