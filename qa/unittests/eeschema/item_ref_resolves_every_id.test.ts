// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `itemRefById` is the lookup between a SELECTED ID and everything that asks
 * "what is this?" — the Properties panel, the message panel, the edit dialogs.
 * `SchematicEditor.tsx:8111` renders nothing at all when it answers null, so an
 * id it does not know is a pane that silently goes blank, not an error.
 *
 * Most ids are the item's own uuid and are found by scanning. A few are
 * COMPOSITE — `<parentRefId>:<tag><k>` — and each of those needs its own branch,
 * because the plain scans compare the whole id and can never match one. That has
 * now been missed twice:
 *
 *   - `:sheetpin`, whose absence blanked the panel on a selected sheet pin;
 *   - `:cell`, whose absence blanked it on a selected TABLE CELL, and cost a
 *     round of "the properties are still not showing" after the arm in
 *     `schPropertiesFor` had already been written and unit-tested. The arm was
 *     fine; nothing reached it.
 *
 * So this guards the MECHANISM rather than the two instances of it: every
 * composite id tag built anywhere in eeschema must have a matching branch in
 * `itemRefById`. A third tag added without one fails here rather than in a
 * screenshot.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { tableCellId } from '@ziroeda/eeschema/src/tools/table_cells.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const SRC = resolve(process.cwd(), '../eeschema/src');

/** Every .ts file under eeschema/src. */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('every composite id tag has a branch in itemRefById', () => {
  it('finds the tags actually built in the tree', () => {
    // `idx` is not a composite id - `${kind}:idx${n}` is the fallback IDENTITY
    // of an item with no uuid, and it is what the plain scans compare against.
    const tags = new Set<string>();
    for (const f of sources(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/`\$\{[^}]+\}:([a-z]+)\$\{/g)) {
        if (m[1] && m[1] !== 'idx') tags.add(m[1]);
      }
    }
    // If this ever shrinks, the guard below is guarding less than it claims.
    expect([...tags].sort()).toEqual(['cell', 'field', 'pin', 'sheetpin']);
  });

  it('itemRefById branches on each of them', () => {
    const code = readFileSync(join(SRC, 'tools', 'hittest.ts'), 'utf8');
    const fn = code.slice(code.indexOf('export function itemRefById'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    for (const tag of ['cell', 'field', 'pin', 'sheetpin']) {
      expect(body.includes(`':${tag}'`), `itemRefById has no ':${tag}' branch`).toBe(true);
    }
  });
});

/**
 * And the behaviour, not just the source: one document carrying every item the
 * hit test can return, with each id resolved the way the editor resolves it.
 */
const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (junction (at 10 10) (diameter 0) (uuid "j-1"))
      (no_connect (at 20 20) (uuid "nc-1"))
      (bus_entry (at 30 30) (size 2.54 2.54) (uuid "be-1"))
      (wire (pts (xy 0 0) (xy 10 0)) (uuid "w-1"))
      (label "L" (at 5 5 0) (effects (font (size 1.27 1.27))) (uuid "l-1"))
      (text "T" (at 6 6 0) (effects (font (size 1.27 1.27))) (uuid "tx-1"))
      (text_box "TB" (at 7 7 0) (size 10 5) (effects (font (size 1.27 1.27))) (uuid "tb-1"))
      (rectangle (start 0 0) (end 5 5) (stroke (width 0) (type default)) (fill (type none)))
      (table (column_count 2)
        (border (external yes) (header yes) (stroke (width 0) (type solid)))
        (separators (rows yes) (cols yes) (stroke (width 0) (type solid)))
        (column_widths 25.4 25.4) (row_heights 12.7)
        (cells
          (table_cell "a" (exclude_from_sim no) (at 0 0 0) (size 25.4 12.7)
            (margins 1 1 1 1) (span 1 1) (effects (font (size 1.27 1.27))))
          (table_cell "b" (exclude_from_sim no) (at 25.4 0 0) (size 25.4 12.7)
            (margins 1 1 1 1) (span 1 1) (effects (font (size 1.27 1.27)))))
        (uuid "t-1"))
      (sheet (at 40 40) (size 20 20)
        (stroke (width 0) (type solid)) (fill (color 0 0 0 0.0))
        (uuid "sh-1")
        (property "Sheetname" "S" (at 40 39 0) (effects (font (size 1.27 1.27))))
        (property "Sheetfile" "s.kicad_sch" (at 40 61 0) (effects (font (size 1.27 1.27))))
        (pin "P" input (at 40 45 180) (uuid "sp-1") (effects (font (size 1.27 1.27))))))`),
  );

describe('every id the editor can select resolves to a ref', () => {
  const cases: [string, (d: Schematic) => string][] = [
    ['junction', (d) => refId('junction', d.junctions[0]!.uuid, 0)],
    ['noconnect', (d) => refId('noconnect', d.noConnects[0]!.uuid, 0)],
    ['busentry', (d) => refId('busentry', d.busEntries[0]!.uuid, 0)],
    ['line', (d) => refId('line', d.lines[0]!.uuid, 0)],
    ['label', (d) => refId('label', d.labels[0]!.uuid, 0)],
    ['textbox', (d) => refId('textbox', d.textBoxes[0]!.uuid, 0)],
    ['graphic', (d) => refId('graphic', undefined, 0)],
    ['table', (d) => refId('table', d.tables[0]!.uuid, 0)],
    ['tablecell', (d) => tableCellId(refId('table', d.tables[0]!.uuid, 0), 1)],
    ['sheet', (d) => refId('sheet', d.sheets[0]!.uuid, 0)],
    ['sheetpin', (d) => `${refId('sheet', d.sheets[0]!.uuid, 0)}:sheetpin0`],
  ];

  it.each(cases)('%s', (_name, idOf) => {
    const d = doc();
    const id = idOf(d);
    // Not just "not null" - the ref has to carry the id back, because that is
    // what schPropertiesFor switches on.
    const ref = itemRefById(d, id);
    expect(ref, `itemRefById returned null for ${id}`).not.toBeNull();
    expect(ref!.id).toBe(id);
  });

  it('still answers null for an id that is nobody', () => {
    expect(itemRefById(doc(), 'not-an-item')).toBeNull();
  });
});
