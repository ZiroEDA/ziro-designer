// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three colours a raw `wxGrid` paints itself with, measured from wx.
 *
 * KiCad's Design Inspector (`DIALOG_DESIGN_INSPECTOR`) is a plain `wxGrid` on a
 * panel: it sets a column count and some labels and otherwise takes every
 * colour from the defaults wx derives from the GTK theme. So the whole of
 * `.ze-grid`'s palette is a question for wx, not a design decision, and
 * CLAUDE.md's rule applies — a number GTK or wx decides can be measured.
 *
 * `qa/probes/eseries_grid_probe.cpp` builds a real `wxGrid` on this machine
 * under this theme and asks it. Its output, verbatim:
 *
 *     wxSYS_COLOUR_WINDOW                rgb(39, 39, 39)  #272727
 *     wxSYS_COLOUR_BTNFACE               rgb(55, 55, 55)  #373737
 *     wxGrid default line colour         rgb(55, 55, 55)  #373737
 *     wxGrid default label bg            rgb(55, 55, 55)  #373737
 *
 * THE BUG THIS PINS. `--grid-line` was `#181818`, which is `--ctl-border`'s
 * value — the control border, copied across rather than asked of wx. wx puts
 * the grid lines at BTNFACE, the SAME colour as the label band, so the lines
 * belong to the header rather than reading as dark rules between cells; it is
 * the same effect that makes a wxPropertyGrid category read as an unbroken
 * band (widgets/properties_panel.css records `GetLineColour() = #373737` for
 * that widget). At #181818 our grid drew near-black rules KiCad does not draw.
 *
 * Nothing pinned any of the three before this file, which is why a wrong one
 * survived: no expectation moved when it was introduced.
 *
 * The expectations are the probe's numbers, read off its output. Nothing here
 * computes them from the stylesheet it is checking.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHELL = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

/** The declared value of a custom property, from its `:root`-level declaration. */
function token(name: string): string {
  const m = SHELL.match(new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm'));
  if (!m) throw new Error(`${name} is not declared in shell.css`);
  return (m[1] ?? '').trim();
}

describe('a raw wxGrid takes its colours from wx', () => {
  it('draws its grid lines at BTNFACE, not at the control border', () => {
    expect(token('--grid-line')).toBe('#373737');
  });

  it('paints column and row labels the same BTNFACE', () => {
    expect(token('--grid-label-bg')).toBe('#373737');
  });

  it('but paints the cells at wxSYS_COLOUR_WINDOW, which is darker', () => {
    expect(token('--grid-cell-bg')).toBe('#272727');
  });

  // The point of the fix: lines and labels are ONE colour, so the rules do not
  // read as dark separators. Asserting the two values independently would let a
  // mutant move both together and still pass.
  it('so the lines are invisible against the label band', () => {
    expect(token('--grid-line')).toBe(token('--grid-label-bg'));
  });

  // And the control border is a genuinely different question — #181818 is
  // correct for --ctl-border and was simply the wrong answer for grid lines.
  // This guards the copy coming back.
  it('and are NOT the control border, which is a different measurement', () => {
    expect(token('--ctl-border')).toBe('#181818');
    expect(token('--grid-line')).not.toBe(token('--ctl-border'));
  });
});
