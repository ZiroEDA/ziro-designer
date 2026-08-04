// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every modelled field survives a save — swept structurally, not case by case.
 *
 * `writer_editable_fields.test.ts` covers the fields somebody remembered to
 * add a case for, and it has caught this bug nine times. It still missed three
 * in one week: a table cell's `(span …)`, a table's shape (`column_count`,
 * `column_widths`, `row_heights`) and a cell's margins/fill/effects were each
 * modelled, editable, and never written. Each was found only when a *new*
 * feature made the field editable — which is to say, by luck.
 *
 * So this one does not enumerate cases. It walks the model itself: for every
 * item in a fixture, for every scalar field on it, perturb that field to a
 * distinguishable value, serialize, read back, and check it came back. A field
 * added to the model tomorrow is covered tomorrow.
 *
 * A field that legitimately cannot round-trip has to be named in `EXCLUDED`
 * with the reason. That list is the point as much as the test is: it is the
 * complete inventory of what the file format does not carry, and adding to it
 * should feel like a decision.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { changeTextType } from '@ziroeda/eeschema/src/tools/change_text_type.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/**
 * Fields that are modelled but deliberately not round-tripped, and why.
 * Keyed `<array>.<field>`; `*` matches any array.
 */
const EXCLUDED: Record<string, string> = {
  '*.source': 'the source node itself — patched, never compared',
  '*.uuid': 'identity, not content: changing it would be a different item',
  // Sheet instances are written from the document-level block, not per sheet.
  'sheets.instances': 'written from sheet_instances, not from the sheet',
  // A lib_id is resolved against the embedded lib_symbols cache; renaming one
  // without adding the library entry is not an edit the model can express.
  'symbols.libId': 'resolved against lib_symbols — needs the library entry too',
  // `kind` is the source node's *head* token — `(wire …)` vs `(bus …)`,
  // `(label …)` vs `(global_label …)`. Changing it is not a field assignment:
  // changeTextType builds a replacement item with a fresh node, which is why
  // the head is never patched. The test below checks that path really works,
  // so this exclusion is not hiding the bug it looks like.
  'lines.kind': 'the node’s head token; changed by replacing the item',
  'labels.kind': 'the node’s head token; changed by replacing the item',
  // A placement's `(pin "1" …)` record is keyed by the library pin it belongs
  // to. Renaming the number does not rename a pin — it points the record at a
  // pin that does not exist, and the reader drops it.
  'symbols.pins.number': 'identity: which library pin this record is for',
  // Sheetname/Sheetfile are mandatory and looked up by name; the field dialog
  // refuses to rename them for the same reason. A *symbol* field's key does
  // round-trip, and is deliberately not excluded here.
  'sheets.fields.key': 'mandatory field name, looked up by name',
  'directiveLabels.fields.key': 'mandatory field name, looked up by name',
};

/**
 * Fields whose value is a token, not free text. Appending to one produces
 * something the reader rejects, so the perturbation is "a *different* valid
 * value" — which also checks that the token itself round-trips.
 */
const ENUMS: Record<string, readonly string[]> = {
  'lines.kind': ['wire', 'bus', 'polyline'],
  'labels.kind': ['label', 'global_label', 'hierarchical_label', 'text'],
  'labels.shape': ['input', 'output', 'bidirectional', 'tri_state', 'passive'],
  'symbols.mirror': ['x', 'y'],
  'symbols.passthrough': ['block', 'force'],
  'busEntries.kind': ['wire', 'bus'],
  'directiveLabels.shape': ['dot', 'round', 'diamond', 'rectangle'],
};

/** Item arrays on a Schematic that hold uuid-bearing model items. */
const ARRAYS = [
  'symbols',
  'lines',
  'junctions',
  'noConnects',
  'labels',
  'sheets',
  'busEntries',
  'images',
  'textBoxes',
  'tables',
  'directiveLabels',
] as const;

type ArrayName = (typeof ARRAYS)[number];

/**
 * A schematic holding one of every item kind. The two real fixtures are honest
 * boards and so contain symbols, wires, labels and sheets — none of the kinds
 * the three recent bugs were in. A sweep is only as good as what it sweeps.
 */
const ALL_KINDS = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
        (stroke (width 0) (type default)) (fill (type none))))))
  (junction (at 10 10) (diameter 0.9) (color 1 2 3 1) (uuid "j-1"))
  (no_connect (at 20 10) (uuid "nc-1"))
  (bus_entry (at 30 10) (size 2.54 2.54)
    (stroke (width 0.1) (type solid) (color 0 0 0 0)) (uuid "be-1"))
  (wire (pts (xy 40 10) (xy 50 10))
    (stroke (width 0.2) (type dash) (color 1 0 0 1)) (uuid "w-1"))
  (label "NET" (at 60 10 0) (fields_autoplaced yes)
    (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "l-1"))
  (netclass_flag "HS" (length 2.54) (shape round) (at 70 10 0)
    (effects (font (size 1.27 1.27))) (uuid "d-1")
    (property "Netclass" "HS" (at 70 10 0) (effects (font (size 1.27 1.27)))))
  (text_box "boxed" (exclude_from_sim no) (at 10 30 0) (size 20 10)
    (margins 0.5 0.5 0.5 0.5)
    (stroke (width 0.1) (type solid)) (fill (type none))
    (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb-1"))
  (table (column_count 2) (border (external yes) (header yes))
    (separators (rows yes) (cols yes))
    (column_widths 20 20) (row_heights 10) (uuid "t-1")
    (cells
      (table_cell "a" (exclude_from_sim no) (at 40 30 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5)
        (effects (font (size 1.27 1.27)) (justify left top)))
      (table_cell "b" (exclude_from_sim no) (at 60 30 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5)
        (effects (font (size 1.27 1.27)) (justify left top)))))
  (symbol (lib_id "L:R") (at 10 50 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
    (property "Reference" "R1" (at 12 48 0) (effects (font (size 1.27 1.27)))))
  (sheet (at 30 50) (size 20 20) (stroke (width 0.1) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh-1")
    (property "Sheetname" "sub" (at 30 49 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 30 71 0)
      (effects (font (size 1.27 1.27))))))`;

const load = (name: string): Schematic =>
  readSchematic(
    parse(readFileSync(fileURLToPath(new URL(`../../data/${name}`, import.meta.url)), 'utf8')),
  );

/** A value distinguishable from `v`, or null when this field cannot be perturbed. */
function perturb(v: unknown, key: string): unknown | null {
  const tokens = ENUMS[key];
  if (tokens) return tokens.find((t) => t !== v) ?? null;
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return Number.isInteger(v) ? v + 137 : v + 0.5;
  if (typeof v === 'string') return v === '' ? 'ZQX' : `${v}ZQX`;
  return null;
}

/** Round-trip a document and return the item at `[array][index]`. */
function roundTrip(doc: Schematic, array: ArrayName, index: number): Record<string, unknown> {
  const back = readSchematic(parse(serializeSchematic(doc)));
  return (back[array] as unknown as Record<string, unknown>[])[index] ?? {};
}

interface Miss {
  where: string;
  wrote: unknown;
  read: unknown;
}

/** Every scalar leaf under `item`, as a dotted path plus its value. */
function leaves(
  node: unknown,
  path: string[] = [],
  depth = 0,
  out: { path: string[]; value: unknown }[] = [],
): { path: string[]; value: unknown }[] {
  // Six levels reaches tables[i] → cells → [k] → effects → fontSize → [0],
  // which is the deepest the model goes. It was three, and three stopped one
  // short of a cell's margins — the sweep passed while the mutation that
  // deletes the margins patcher survived, which is how a structural test
  // quietly covers less than it claims. The bound exists only so a cyclic or
  // huge structure cannot hang the run.
  if (depth > 6) return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => leaves(v, [...path, String(i)], depth + 1, out));
    return out;
  }
  if (isRecord(node)) {
    for (const k of Object.keys(node)) leaves(node[k], [...path, k], depth + 1, out);
    return out;
  }
  out.push({ path, value: node });
  return out;
}

/** A copy of `node` with the value at `path` replaced. */
function setAt(node: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(node)) {
    const i = Number(head);
    return node.map((v, j) => (j === i ? setAt(v, rest, value) : v));
  }
  return {
    ...(node as Record<string, unknown>),
    [head!]: setAt((node as Record<string, unknown>)[head!], rest, value),
  };
}

/** Read the value at `path` under `node`, or undefined. */
function getAt(node: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (n, k) => (n == null ? undefined : (n as Record<string, unknown>)[k]),
    node,
  );
}

/** The EXCLUDED key for a path: array-index segments are dropped. */
const keyOf = (array: string, path: readonly string[]): string =>
  [array, ...path.filter((p) => !/^\d+$/.test(p))].join('.');

/**
 * For every scalar leaf of every item — however deeply nested — set it to
 * something new and check the file gives it back.
 *
 * The nesting is not optional. All three of the bugs that motivated this test
 * lived below the top level: a cell's span is `tables[i].cells[k].span`, and
 * its margins are a level deeper still. A shallow walk sails past all of them.
 */
function sweep(doc: Schematic): Miss[] {
  const misses: Miss[] = [];
  for (const array of ARRAYS) {
    const items = (doc[array] ?? []) as unknown as Record<string, unknown>[];
    items.forEach((item, index) => {
      for (const { path, value } of leaves(item)) {
        // Excluding a *branch* has to exclude everything under it: `source` is
        // a whole s-expression tree, and its leaves are `source.items.3.kind`.
        const segments = path.filter((seg) => !/^\d+$/.test(seg));
        if (segments.some((seg) => EXCLUDED[`*.${seg}`])) continue;
        const key = keyOf(array, path);
        if (segments.some((_, i) => EXCLUDED[[array, ...segments.slice(0, i + 1)].join('.')]))
          continue;
        const next = perturb(value, key);
        if (next === null) continue;
        const edited = {
          ...doc,
          [array]: items.map((x, i) => (i === index ? setAt(x, path, next) : x)),
        } as Schematic;
        const got = getAt(roundTrip(edited, array, index), path);
        if (got !== next)
          misses.push({ where: `${array}[${index}].${path.join('.')}`, wrote: next, read: got });
      }
    });
  }
  return misses;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

describe('every modelled scalar field survives a save', () => {
  const CASES: [string, () => Schematic][] = [
    ['nfc-antenna.kicad_sch', () => load('nfc-antenna.kicad_sch')],
    ['complex_hierarchy.kicad_sch', () => load('complex_hierarchy.kicad_sch')],
    ['one of every item kind', () => readSchematic(parse(ALL_KINDS))],
  ];

  for (const [file, get] of CASES) {
    // O(items x fields) whole-document round-trips: the honest fixtures are
    // hundreds of them, which is slow but is the coverage that matters.
    it(`${file}`, { timeout: 60_000 }, () => {
      const misses = sweep(get());
      const report = misses
        .map((m) => `${m.where}: wrote ${JSON.stringify(m.wrote)}, read ${JSON.stringify(m.read)}`)
        .join('\n  ');
      expect(misses, `fields that did not survive a save:\n  ${report}`).toEqual([]);
    });
  }

  it('and the head token does round-trip through the tool that changes it', () => {
    // The two `kind` exclusions above are only honest if the supported path
    // works. changeTextType replaces the item rather than assigning the field.
    const doc = load('nfc-antenna.kicad_sch');
    const first = doc.labels[0];
    if (!first) return;
    const id = refId('label', first.uuid, 0);
    const cmd = changeTextType(doc, new Set([id]), 'global_label')!;
    const back = readSchematic(parse(serializeSchematic(cmd.apply(doc))));
    expect(back.labels.some((l) => l.kind === 'global_label' && l.text === first.text)).toBe(true);
  });

  it('is actually looking at something', () => {
    // Without this the sweep could pass by finding no items at all — which is
    // how a structural test quietly stops testing.
    const doc = load('complex_hierarchy.kicad_sch');
    const scanned = ARRAYS.reduce((n, a) => n + ((doc[a] ?? []) as unknown[]).length, 0);
    expect(scanned).toBeGreaterThan(20);
  });
});
