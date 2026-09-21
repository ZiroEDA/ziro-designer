// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The schematic's compact patch (designer/src/sync/sch_diff.ts).
 *
 * Against a real KiCad sheet, not a synthetic one: the whole value of this
 * module rests on a property of the actual documents — that an untouched item
 * keeps its object reference through an edit, including through the
 * post-commit colinear-wire cleanup — and a hand-built two-item document
 * cannot demonstrate that.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import type { Schematic } from '@ziroeda/eeschema';
import {
  applySchematicPatch,
  diffSchematic,
  schematicPatchIsEmpty,
} from '../../../designer/src/sync/sch_diff.js';

const FIXTURE = join(__dirname, '../../data/complex_hierarchy.kicad_sch');

function load(): Schematic {
  return readSchematic(parse(readFileSync(FIXTURE, 'utf-8')));
}

/** Move one symbol the way an edit command does: a new object for the item
 *  touched, the same reference for every other. */
function moveFirstSymbol(doc: Schematic, dx: number): Schematic {
  const first = doc.symbols[0]!;
  return {
    ...doc,
    symbols: doc.symbols.map((s) => (s === first ? { ...s, at: { ...s.at, x: s.at.x + dx } } : s)),
  };
}

describe('diffSchematic', () => {
  it('an unchanged sheet diffs to an empty patch', () => {
    const doc = load();
    const patch = diffSchematic(doc, doc);
    expect(patch).not.toBeNull();
    expect(schematicPatchIsEmpty(patch!)).toBe(true);
  });

  it('moving one symbol names that symbol and nothing else', () => {
    // This is requirement 3: a small edit has to cost about as much as a
    // small edit. Before this module the same edit shipped the whole sheet.
    const doc = load();
    expect(doc.symbols.length).toBeGreaterThan(1);
    const patch = diffSchematic(doc, moveFirstSymbol(doc, 2540))!;
    expect(patch).not.toBeNull();
    expect(Object.keys(patch)).toEqual(['symbols']);
    expect(patch.symbols!.upsert).toHaveLength(1);
    expect(patch.symbols!.remove).toEqual([]);
    expect(patch.symbols!.upsert[0]!.uuid).toBe(doc.symbols[0]!.uuid);
  });

  it('costs about one symbol on the wire, not one sheet', () => {
    // The reason the fast path exists, as a measurement rather than a claim.
    // On this fixture: ~9.0 kB of patch against ~58 kB of sheet text, a 6.4x
    // saving for the smallest possible edit.
    //
    // Not larger, because most of those 9 kB are the symbol's own retained
    // `source` AST, which JSON encodes far less densely than the
    // s-expression text it was read from — a symbol is ~4.3 kB of fields and
    // ~4.7 kB of source. So the floor here is one item, not one byte, and the
    // honest bound is a factor rather than an order of magnitude.
    //
    // What makes it worth having anyway is that the patch does not grow with
    // the sheet: this fixture has 27 symbols, and the same edit on a sheet
    // with 270 would send the same 9 kB against ten times the text.
    const doc = load();
    const next = moveFirstSymbol(doc, 2540);
    const patchBytes = JSON.stringify(diffSchematic(doc, next)).length;
    const wholeSheetBytes = serializeSchematic(next).length;
    expect(patchBytes * 4).toBeLessThan(wholeSheetBytes);
    // ...and it really is one item's worth, not a fraction of the document
    // that happens to be small on this fixture.
    const oneSymbol = JSON.stringify(next.symbols[0]).length;
    expect(patchBytes).toBeLessThan(oneSymbol * 1.1);
  });

  it('round-trips: applying the patch reproduces the edited sheet', () => {
    const doc = load();
    const next = moveFirstSymbol(doc, 2540);
    const applied = applySchematicPatch(doc, diffSchematic(doc, next)!);
    expect(serializeSchematic(applied)).toBe(serializeSchematic(next));
  });

  it('reports a deletion as a removal, not as a silently shorter list', () => {
    const doc = load();
    const gone = doc.symbols[0]!;
    const next = { ...doc, symbols: doc.symbols.filter((s) => s !== gone) };
    const patch = diffSchematic(doc, next)!;
    expect(patch.symbols!.remove).toEqual([gone.uuid]);
    const applied = applySchematicPatch(doc, patch);
    expect(applied.symbols.some((s) => s.uuid === gone.uuid)).toBe(false);
  });

  it('refuses an edit that touched the retained AST, so the caller sends text', () => {
    // `writeSchematic` takes the header and every residual structural node
    // from `source`, so no item patch can carry a page-settings or title
    // block change. Null is the honest answer, not an empty patch.
    const doc = load();
    const next = { ...doc, source: { ...doc.source, items: [...doc.source.items] } };
    expect(diffSchematic(doc, next)).toBeNull();
  });

  it('refuses a changed collection whose items have no uuid', () => {
    const doc = load();
    const first = doc.symbols[0]!;
    const { uuid: _dropped, ...noUuid } = first;
    const next = { ...doc, symbols: [noUuid as typeof first, ...doc.symbols.slice(1)] };
    expect(diffSchematic(doc, next)).toBeNull();
  });

  it('keys the lib_symbols cache by lib id, which is the only identity it has', () => {
    const doc = load();
    expect(doc.libSymbols.length).toBeGreaterThan(0);
    const target = doc.libSymbols[0]!;
    const next = {
      ...doc,
      libSymbols: doc.libSymbols.map((l) => (l === target ? { ...l, isPower: !l.isPower } : l)),
    };
    const patch = diffSchematic(doc, next)!;
    expect(patch).not.toBeNull();
    expect(patch.libSymbols!.upsert).toHaveLength(1);
    expect(patch.libSymbols!.upsert[0]!.libId).toBe(target.libId);
    // And it splices back onto the right entry rather than appending a second.
    const applied = applySchematicPatch(doc, patch);
    expect(applied.libSymbols).toHaveLength(doc.libSymbols.length);
    expect(applied.libSymbols.find((l) => l.libId === target.libId)!.isPower).toBe(!target.isPower);
  });

  it('carries the notes graphics whole, having no key to diff them by', () => {
    const doc = load();
    const next = { ...doc, graphics: [...doc.graphics] };
    const patch = diffSchematic(doc, next)!;
    expect(patch.graphics).toEqual(next.graphics);
    // ...and an edit that leaves them alone does not mention them at all.
    expect(diffSchematic(doc, moveFirstSymbol(doc, 10))!.graphics).toBeUndefined();
  });
});
