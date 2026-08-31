// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a GTK popup menu costs, per row and per rule, and where the accelerator
 * sits in it.
 *
 * All three numbers here were read off ONE capture of the installed pcbnew and
 * ours side by side, both showing the selection context menu over a single
 * footprint (2026-08-31, PCB editor, Yaru dark). None of them was guessed:
 *
 *  - **row pitch 26px.** Text tops inside a group run 830, 856, 882 in both
 *    menus. This one we already had right; `ui_font_tokens.test.ts` owns
 *    `--menu-row`, and it is restated here only because the arithmetic below
 *    needs it.
 *
 *  - **a separator is 1px, margins included.** Across a drawn rule the next
 *    text top is 27px on, not 31: the rule's whole vertical footprint is one
 *    pixel, and the 26px row is what gives it air. Corroborated from the other
 *    end by the theme itself - `menu separator` in Yaru
 *    (`yaru_dark_gtk.css:5947`) sets `background-color` and nothing else, so it
 *    inherits the generic `separator { min-height: 1px }` with no margin and no
 *    padding. Pixels and stylesheet are independent derivations and they agree.
 *
 *    The whole menu is then predictable: KiCad's 32 rows and 7 rules measure
 *    31*26 + 7 = 813px from first text top to last, and that is exactly what
 *    the capture shows (y=365 to y=1178). Ours had `margin: 2px 0` on the rule,
 *    so six of them cost 30px instead of 6 - which, with one extra row that
 *    should not have been there at all, is the "why is ours so much taller"
 *    the user was looking at.
 *
 *  - **the accelerator is flush right.** The column is as wide as the widest
 *    accelerator in the menu, because that is how GTK sizes it; a stretched
 *    span then LEFT-aligns every short accelerator against that width. In the
 *    capture KiCad's "M", "Shift+X" and "Backspace" all end at x=899-900
 *    against a popup right border at x=910, while every one of ours started at
 *    x=1749. Same column, opposite edge.
 *
 * These live in `shell.css` and nowhere else: one MenuBar renders every popup
 * in the app, so a launcher that restated any of this locally would be the bug
 * (see the specificity note in CLAUDE.md).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHELL = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

/** The declarations of one rule, comments stripped, as `prop: value` strings. */
function ruleBody(selector: string): string[] {
  const css = SHELL.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} is declared`).toBeGreaterThan(-1);
  const body = css.slice(at + selector.length + 4, css.indexOf('}', at));
  return body
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** A CSS length in px, as a number. `0` is legal unitless. */
function px(value: string): number {
  if (value === '0') return 0;
  const m = /^(-?[\d.]+)px$/.exec(value);
  expect(m, `${value} is a px length`).not.toBeNull();
  return Number(m![1]);
}

describe('a menu separator costs one pixel, the way GTK draws it', () => {
  const decls = ruleBody('.ze-msep');
  const value = (prop: string): string => {
    const found = decls.find((d) => d.startsWith(`${prop}: `));
    expect(found, `.ze-msep declares ${prop}`).toBeDefined();
    return found!.slice(prop.length + 2);
  };

  it('draws a 1px rule', () => {
    expect(px(value('height'))).toBe(1);
  });

  it('adds no margin above or below it', () => {
    // A shorthand margin is one to four lengths; every one of them must be 0,
    // and so must any longhand that follows.
    for (const part of value('margin').split(' ')) expect(px(part)).toBe(0);
    for (const side of ['margin-top', 'margin-bottom', 'margin-block'] as const)
      expect(decls.find((d) => d.startsWith(`${side}: `))).toBeUndefined();
  });

  it('makes the whole menu come out at KiCad measured height', () => {
    // The installed pcbnew's selection menu over a footprint: 32 rows, 7 rules,
    // first text top y=365 and last y=1178.
    const row = /--menu-row:\s*([\d.]+px)/.exec(SHELL.replace(/\/\*[\s\S]*?\*\//g, ''));
    const pitch = row ? px(row[1]!) : px(/height: var\(--menu-row, ([\d.]+px)\)/.exec(SHELL)![1]!);
    const sep =
      px(value('height')) +
      value('margin')
        .split(' ')
        .reduce((a, b) => a + px(b), 0);
    expect((32 - 1) * pitch + 7 * sep).toBe(1178 - 365);
  });
});

describe('a menu accelerator is flush with the right edge', () => {
  it('right-aligns the accelerator in its column', () => {
    const decls = SHELL.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n.ze-mitem .sc {')
      .slice(1)
      .flatMap((chunk) => ruleBodyOf(chunk));
    expect(decls).toContain('justify-self: end');
  });

  it('puts it in the same column as the submenu arrow, which is also at the end', () => {
    // No row has both, so they share a column - and both must reach the same
    // edge, or a row with an accelerator and one with an arrow would disagree.
    expect(ruleBody('.ze-mitem .sub-arrow')).toContain('justify-self: end');
  });
});

/** The declarations of an already-sliced rule body. */
function ruleBodyOf(chunk: string): string[] {
  return chunk
    .slice(0, chunk.indexOf('}'))
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}
