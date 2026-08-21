// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The file list's cell padding, and the rules that have to consume it.
 *
 * `--chooser-icon-pad` and `--chooser-text-pad` shipped from ~/gtkdate/m2.py,
 * which was the same capture that gave us a 24 px row (really 29) and a 130 px
 * Type column (really 108) - both read with the chooser in **Recent** mode,
 * whose tree view carries a different column set. So both tokens were suspect
 * and neither was pinned by anything.
 *
 * They have now been read from the dialog `wxFileDialog` itself builds, pointed
 * at a real directory so the chooser is in **browse** mode:
 * `qa/probes/chooser_cells_probe.cpp`. What it found:
 *
 *   col Name  GtkCellRendererPixbuf  xpad=6 ypad=0 xalign=0.50 fixed=28x16
 *   col Name  GtkCellRendererText    xpad=2 ypad=2  x_offset=28
 *   col Size  GtkCellRendererText    xpad=6
 *   col Type  GtkCellRendererText    xpad=6
 *   col Mod.  GtkCellRendererText    xpad=6
 *   header <every column> button padding l=6 r=6, label starts 6 px in
 *   row 0: background x=0 w=578 | cell x=2 w=574
 *
 * So 6 and 2 were both right, and both were being applied to the wrong things:
 * `--chooser-text-pad` reaches only the NAME column's text renderer, while
 * Size / Type / Modified pad 6, and so does the column header button.
 *
 * Two halves below, and they fail for different reasons on purpose:
 *
 *  - "the measured values" pins the numbers. It survives if the CSS stops
 *    consuming a token, because a declaration is all it reads.
 *  - "the rules that consume them" pins the usage. Deleting the `var()` out of
 *    a rule leaves every value assertion above still passing, so without this
 *    half a mutant that unhooks a token is invisible - which is exactly how a
 *    surviving mutant gets misread as "this code is redundant".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const UI = fileURLToPath(new URL('../../../designer/src/ui/', import.meta.url));
const SHELL = readFileSync(`${UI}shell.css`, 'utf8');
const CHOOSER = readFileSync(`${UI}file_chooser.css`, 'utf8');

/** A token's declared value, or undefined when it is not declared at all. */
function token(name: string): string | undefined {
  const m = SHELL.match(new RegExp(`^\\s*--${name}\\s*:\\s*([^;]+);`, 'm'));
  return m?.[1]?.trim();
}

/** The px number a token declares. */
function px(name: string): number {
  const v = token(name);
  if (v === undefined) throw new Error(`--${name} is not declared in shell.css`);
  const m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!m) throw new Error(`--${name} is ${v}, which is not a px length`);
  return Number(m[1]);
}

/**
 * One rule's declarations, by its exact selector text.
 *
 * Per rule, not per file: a file-level `CHOOSER.includes('--chooser-cell-pad')`
 * would pass while the token sat in a comment or on some unrelated rule, which
 * is the shape of check that cannot fail.
 */
function rule(selector: string): string {
  const at = CHOOSER.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule in file_chooser.css for \`${selector}\``);
  const end = CHOOSER.indexOf('\n}', at);
  return CHOOSER.slice(at + selector.length + 2, end);
}

/** One declaration of a rule, comments stripped so a var() in prose cannot count. */
function decl(selector: string, prop: string): string | undefined {
  const body = rule(selector).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = body.match(new RegExp(`(?:^|;|\\{)\\s*${prop}\\s*:\\s*([^;]+);`));
  return m?.[1]?.trim();
}

const ROW_SPANS = '.ze-chooser-head span,\n.ze-chooser-row span';
const NAME_CELL = '.ze-chooser-row .ze-chooser-name-cell';

describe('the measured values', () => {
  it('pads the icon renderer 6, which is its xpad in browse mode', () => {
    expect(px('chooser-icon-pad')).toBe(6);
  });

  it('pads the name column text renderer 2, and only that one', () => {
    expect(px('chooser-text-pad')).toBe(2);
  });

  it('pads every other column, and the header button, 6', () => {
    // Two independent GTK values that agree: the Size/Type/Modified text
    // renderers report xpad=6, and the header button's own CSS padding is
    // l=6 r=6 with its label starting 6 px in. Neither is derived from the
    // other - one is a cell renderer property, one is theme button padding.
    expect(px('chooser-cell-pad')).toBe(6);
  });

  it('insets a row cell 2 from the row background', () => {
    // background x=0 w=578 against cell x=2 w=574 - GtkTreeView's
    // horizontal-separator, which the header buttons do not get.
    expect(px('chooser-row-inset')).toBe(2);
  });

  it('draws the icon at GTK_ICON_SIZE_MENU', () => {
    expect(px('chooser-icon-size')).toBe(16);
  });
});

describe('the geometry those values have to reproduce', () => {
  // The independent side: these are run-length boundaries in the screenshot of
  // the REAL KiCad dialog (~/Pictures/Screenshots/...15-52-34.png), not probe
  // output, so they can disagree with the tokens. The list's left edge is 647.
  const LIST_EDGE = 647;
  const CAPTURE_ICON_X = 655; // the name icon runs 655..670
  const CAPTURE_TEXT_X = 680; // the name text starts here

  it('puts the icon where the capture has it', () => {
    // 647 + 2 + 6 = 655. This is the reconciliation that made the tokens look
    // wrong: the capture shows 8 px, the renderer's xpad is 6, and the missing
    // 2 is the tree view's row inset - not, as it appeared, an xpad of 8.
    const iconX = LIST_EDGE + px('chooser-row-inset') + px('chooser-icon-pad');
    expect(iconX).toBe(CAPTURE_ICON_X);
  });

  it('makes an icon cell 28 px wide, as the renderer reports', () => {
    // fixed=28x16 is read straight off the renderer, so this cross-checks the
    // pad against a second measured number rather than restating it: an
    // icon-pad of 8 would give 32 and fail here even though the sum above
    // could be kept at 655 by dropping the inset to 0.
    expect(2 * px('chooser-icon-pad') + px('chooser-icon-size')).toBe(28);
  });

  it('starts the name text where the capture has it, within a pixel', () => {
    // inset + the 28 px icon cell + the text renderer's own 2.
    const textX =
      LIST_EDGE +
      px('chooser-row-inset') +
      (2 * px('chooser-icon-pad') + px('chooser-icon-size')) +
      px('chooser-text-pad');
    expect(Math.abs(textX - CAPTURE_TEXT_X)).toBeLessThanOrEqual(1);
  });
});

describe('the rules that consume them', () => {
  it('pads a plain cell with the cell pad, not the name column pad', () => {
    // The bug this fixes: every cell was getting --chooser-text-pad's 2.
    expect(decl(ROW_SPANS, 'padding')).toBe('0 var(--chooser-cell-pad)');
  });

  it('does not reach for the name column pad in the plain cell rule', () => {
    expect(rule(ROW_SPANS).replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('--chooser-text-pad');
  });

  it('gaps the name cell by the icon pad plus the text pad', () => {
    // Two different measured numbers that happen to sum to 8. Written as one
    // 8px it would survive either of them being re-measured.
    expect(decl(NAME_CELL, 'gap')).toBe('calc(var(--chooser-icon-pad) + var(--chooser-text-pad))');
  });

  it('indents the name cell by the row inset plus the icon pad', () => {
    expect(decl(NAME_CELL, 'padding-left')).toBe(
      'calc(var(--chooser-row-inset) + var(--chooser-icon-pad))',
    );
  });

  it('sizes the icon from the icon-size token', () => {
    expect(
      decl(
        '.ze-chooser-row .ze-chooser-name-cell img,\n.ze-chooser-row .ze-chooser-name-cell svg',
        'width',
      ),
    ).toBe('var(--chooser-icon-size)');
  });

  it('leaves no measured token that nothing reads', () => {
    // A value nothing consumes is a value no bug can contradict.
    for (const t of [
      'chooser-icon-pad',
      'chooser-text-pad',
      'chooser-cell-pad',
      'chooser-row-inset',
      'chooser-icon-size',
    ]) {
      expect(CHOOSER.replace(/\/\*[\s\S]*?\*\//g, '')).toContain(`var(--${t})`);
    }
  });
});

describe('the wrong-mode readings do not come back', () => {
  // Each of these is a value that was actually shipped after being read with
  // the chooser in Recent mode, whose tree view is a different instance with a
  // different column set. They are named so that re-measuring in the wrong mode
  // fails here instead of silently replacing a browse-mode number.
  it('keeps the Type column off its Recent-mode width', () => {
    expect(px('chooser-col-type')).toBe(108);
    expect(px('chooser-col-type')).not.toBe(130);
  });

  it('keeps the Size column off its Recent-mode width', () => {
    expect(px('chooser-col-size')).toBe(72);
    expect(px('chooser-col-size')).not.toBe(79);
  });

  it('keeps the row at the height the real dialog drew', () => {
    // 29 is the selection band in the capture, re-derived independently here
    // (the orange run at x=1200 is y 354..382). NOTE: the wx probe returns 24
    // for a browse-mode list, and that conflict is unresolved - see the commit.
    // What is certain is that 24 is also what the Recent-mode reading gave, so
    // it must not come back without the conflict being settled first.
    expect(px('chooser-row')).toBe(29);
  });
});
