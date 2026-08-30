// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A rule that nests inside a flex COLUMN and wants a ROW must say so.
 *
 * Two of our shared dialog containers are flex columns:
 *
 *     .ze-label-dialog-body   display: flex; flex-direction: column
 *     .ze-props-group         display: flex; flex-direction: column
 *
 * and both are single-class selectors. A rule for something nested in one is
 * usually a single class too, so the two carry EQUAL specificity and the later
 * one wins — but only for the properties it actually states. `display: flex`
 * without `flex-direction` inherits the column, silently, and a layout meant to
 * be side by side comes out stacked.
 *
 * That has now happened twice, in the same shape, on two different dialogs:
 *
 *   - DIALOG_CHANGE_SYMBOLS' Update Options box, whose two columns
 *     (`m_updateOptionsSizer` is wxHORIZONTAL) stacked into one, put sixteen
 *     rows in a single column and doubled the dialog's height;
 *   - DIALOG_SHAPE_PROPERTIES' `bColumns`, likewise wxHORIZONTAL, whose border
 *     and fill columns stacked.
 *
 * Neither showed up in any test: happy-dom has no layout engine, so nothing in
 * the suite can see a stacked column. This reads the stylesheet instead — the
 * one place the mistake is visible.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);

/** Every rule body, by selector, comments stripped. */
function rules(): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: (m[1] ?? '').trim().replace(/\s+/g, ' '), body: m[2] ?? '' });
  }
  return out;
}

/** The containers whose direction a nested rule inherits by accident. */
const COLUMN_CONTAINERS = ['.ze-label-dialog-body', '.ze-props-group'];

describe('the shared dialog containers really are flex columns', () => {
  // If one of these stops being a column the guard below is pointless, so it
  // is asserted rather than assumed.
  it.each(COLUMN_CONTAINERS)('%s', (sel) => {
    const r = rules().find((x) => x.sel === sel);
    expect(r, `${sel} not found`).toBeTruthy();
    expect(r?.body).toMatch(/display:\s*flex/);
    expect(r?.body).toMatch(/flex-direction:\s*column/);
  });
});

describe('a rule that turns one of them into a row states the direction', () => {
  /**
   * The rules at risk: a single-class selector that sets `display: flex` and is
   * a descendant-or-self of a column container by NAME — i.e. its own class is
   * applied to an element that also carries the container's class, which is how
   * both bugs were written (`className="ze-label-dialog-body ze-shapeprops"`).
   */
  it('every element carrying a container class AND another says its direction', () => {
    const containerClasses = COLUMN_CONTAINERS.map((c) => c.slice(1));
    const offenders: string[] = [];

    for (const { sel, body } of rules()) {
      // one class, no combinator: the shape that ties with the container
      if (!/^\.[a-z0-9-]+$/i.test(sel)) continue;
      if (!/display:\s*flex/.test(body)) continue;
      if (/flex-direction:/.test(body)) continue;
      const cls = sel.slice(1);
      if (containerClasses.includes(cls)) continue;
      // Does any markup put this class on the same element as a container?
      const co = coOccurring();
      if (co.has(cls)) offenders.push(sel);
    }

    expect(
      offenders,
      'these set `display: flex` on an element that also carries a flex-COLUMN ' +
        'container class, at equal specificity, so they inherit `column` — state ' +
        '`flex-direction` explicitly',
    ).toStrictEqual([]);
  });
});

/** Classes that appear beside a column container in a className attribute. */
function coOccurring(): Set<string> {
  const out = new Set<string>();
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.tsx')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/className="([^"]+)"/g)) {
          const classes = (m[1] ?? '').split(/\s+/);
          if (!classes.some((c) => COLUMN_CONTAINERS.includes(`.${c}`))) continue;
          for (const c of classes) if (!COLUMN_CONTAINERS.includes(`.${c}`)) out.add(c);
        }
      }
    }
  };
  walk(SRC);
  return out;
}
