// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A wxGrid's in-cell text editor has no frame, and a selected row's text is
 * `wxSYS_COLOUR_HIGHLIGHTTEXT`.
 *
 * `wxGridCellTextEditor::Create` makes a plain borderless `wxTextCtrl` and the
 * cell's own outline is the only rectangle drawn; `WX_GRID` is the base class
 * every KiCad grid inherits from, so this holds for all of them and not for
 * the grids that happen to have remembered it.
 *
 * Ours drew the shared entry instead — `--field-bg` inside `--ctl-border`,
 * with Yaru's orange ring on focus — because that rule is
 * `.ze-app input:not(…)x5`, five `:not()`s deep at (0,5,1), and the grid rule
 * was (0,2,1). CLAUDE.md's "specificity is the trap that hides the fix": the
 * grid rule named the right values and was simply never reached.
 *
 * It showed on Preferences > Footprint Editor > Footprint Defaults, where a
 * SELECTED row filled orange and the field sat in the middle of it as a dark
 * box with an orange ring — Akshay's "that highlight ... looks bad".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every rule as `[selector list, body]`, comments already stripped. */
const RULES: [string, string][] = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
  (m[1] ?? '').trim().replace(/\s+/g, ' '),
  m[2] ?? '',
]);

/** The body of the first rule whose selector list contains this predicate. */
function bodyWhere(pred: (sel: string) => boolean): { selector: string; body: string } {
  for (const [selectors, body] of RULES)
    for (const sel of selectors.split(','))
      if (pred(sel.trim())) return { selector: sel.trim(), body };
  throw new Error('no such rule');
}

/**
 * CSS specificity as (ids, classes, elements). `:not(…)` contributes its
 * argument's specificity, which is the whole point of the entry rule's five.
 */
function specificity(selector: string): [number, number, number] {
  let s = selector;
  let a = 0;
  let b = 0;
  let c = 0;
  // `:not(x)` counts as x, so unwrap before counting and count the inside too.
  s = s.replace(/:not\(([^()]*)\)/g, (_, inner: string) => ` ${inner} `);
  a += (s.match(/#[\w-]+/g) ?? []).length;
  b += (s.match(/\.[\w-]+/g) ?? []).length;
  b += (s.match(/\[[^\]]*\]/g) ?? []).length;
  b += (s.match(/:[\w-]+/g) ?? []).length;
  c += (s.replace(/\[[^\]]*\]/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
  return [a, b, c];
}

const beats = (x: [number, number, number], y: [number, number, number]): boolean =>
  x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2];

describe('the shared entry rule does not reach into a grid cell', () => {
  const entry = bodyWhere((s) => s.startsWith('.ze-app input:not(') && !s.includes('.ze-grid'));
  const cell = bodyWhere((s) => s.includes('.ze-grid') && s.includes('td') && s.includes('input'));

  it('is the rule that paints an entry, at five :not()s deep', () => {
    // If this stops being true the test below is comparing the wrong pair.
    expect(entry.body).toContain('var(--field-bg)');
    expect(specificity(entry.selector)[1]).toBeGreaterThanOrEqual(5);
  });

  it('is outranked by the in-cell rule, which is the whole fix', () => {
    expect(
      beats(specificity(cell.selector), specificity(entry.selector)),
      `${cell.selector} (${specificity(cell.selector)}) must beat ${entry.selector} (${specificity(entry.selector)})`,
    ).toBe(true);
  });

  it('leaves the editor with no frame, no fill and the cell’s own ink', () => {
    expect(cell.body).toMatch(/border:\s*none/);
    expect(cell.body).toMatch(/background:\s*transparent/);
    expect(cell.body).toMatch(/box-shadow:\s*none/);
    // Not `--chrome-fg`: a selected row's cell already carries HIGHLIGHTTEXT.
    expect(cell.body).toMatch(/color:\s*inherit/);
    expect(cell.body).not.toContain('--chrome-fg');
  });
});

describe('a selected row is filled, and its text is the highlight ink', () => {
  it('paints both from the syscolour tokens', () => {
    const sel = bodyWhere((s) => s === '.ze-grid tr.selected td');
    expect(sel.body).toMatch(/background:\s*var\(--selection-bg\)/);
    expect(sel.body).toMatch(/color:\s*var\(--selection-fg\)/);
  });
});
