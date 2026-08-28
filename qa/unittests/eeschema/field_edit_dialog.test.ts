// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_TOOL::editFieldText` (eeschema/tools/sch_edit_tool.cpp:2328-2372),
 * the single funnel every route into DIALOG_FIELD_PROPERTIES goes through.
 *
 * What is pinned here, and the line of C++ behind each:
 *
 *  - the caption for a MANDATORY field is `TitleCaps`ed and unquoted
 *    (:2343-2346), and the caption for a USER field is quoted (:2350). Those
 *    two are what tell the user which field the dialog is about, and they are
 *    the whole reason the tool builds a caption instead of the dialog owning
 *    one;
 *  - a double-click on field text resolves to that FIELD, and a double-click
 *    on the symbol body does not — `fieldEditTarget` is the string-id stand-in
 *    for upstream's `static_cast<SCH_FIELD*>( aItem )` (:2882), and the ids it
 *    is fed here come from the real hit-test, not from a literal;
 *  - the re-autoplace tail (:2357-2365): gated on the preference, and a no-op
 *    on a symbol whose fields the autoplacer does not own.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  autoplaceAfterFieldEdit,
  fieldEditCaption,
  fieldEditTarget,
} from '@ziroeda/eeschema/src/tools/field_properties.js';
import { collectFieldBoxes, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { collectAndGuess } from '@ziroeda/eeschema/src/tools/sch_collectors.js';
import { symbolBodyBBox } from '@ziroeda/eeschema/src/tools/bbox.js';
import { placeSymbol } from '@ziroeda/eeschema/src/tools/index.js';
import { titleCaps } from '@ziroeda/common/src/string_utils.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, SchField, Schematic } from '@ziroeda/eeschema/src/types.js';

const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

function sheetWithResistor(): { doc: Schematic; lib: Map<string, LibSymbol> } {
  const empty = readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
  const doc = placeSymbol(R, { x: mmToIU(100), y: mmToIU(100) }, { angle: 0 }, 1).apply(empty);
  return { doc, lib: new Map([[R.libId, R]]) };
}

const centreOf = (b: { minX: number; minY: number; maxX: number; maxY: number }) => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

describe('editFieldText builds the dialog caption', () => {
  // `GetDefaultFieldName( aFieldId, DO_TRANSLATE )` returns the canonical
  // English name for each FIELD_T (common/template_fieldnames.cpp:76-86), which
  // is the string we key fields by, so the expectation is that table, not
  // whatever our own code prints.
  it.each([
    ['Reference', 'Edit Reference Field'],
    ['Value', 'Edit Value Field'],
    ['Footprint', 'Edit Footprint Field'],
    ['Datasheet', 'Edit Datasheet Field'],
    ['Description', 'Edit Description Field'],
  ])('title-caps a mandatory field and leaves it unquoted: %s', (key, caption) => {
    expect(fieldEditCaption(key)).toBe(caption);
  });

  it("quotes a user field's own name", () => {
    // `caption.Printf( _( "Edit '%s' Field" ), aField->GetName() )` — the name
    // is NOT title-capped here, so a part number keeps its case.
    expect(fieldEditCaption('MPN')).toBe("Edit 'MPN' Field");
    expect(fieldEditCaption('mfg part no')).toBe("Edit 'mfg part no' Field");
  });

  it('applies TitleCaps, not a bare first-letter upcase', () => {
    // `word.Capitalize()` lowers the REST of each word
    // (common/string_utils.cpp:405-411), which is the difference between the
    // two spellings a naive implementation would produce.
    expect(titleCaps('sheet NAME')).toBe('Sheet Name');
    expect(titleCaps('Reference')).toBe('Reference');
    // wxStringSplit drops exactly one trailing empty, so an interior run of
    // spaces survives and a single trailing space does not.
    expect(titleCaps('a  b')).toBe('A  B');
    expect(titleCaps('a ')).toBe('A');
    expect(titleCaps(' a')).toBe('A');
  });
});

describe('a double-click routes to the field, not to the symbol', () => {
  it('resolves the id a click on field text produces', () => {
    const { doc, lib } = sheetWithResistor();
    const box = collectFieldBoxes(doc, lib).find(
      (f) => doc.symbols[0]!.fields[f.index]!.key === 'Reference',
    )!;

    // The id is what `pickAt` (collectAndGuess) actually returns for that
    // point, so this cannot pass on a hand-written id that the hit-test would
    // never produce.
    const hit = collectAndGuess(doc, lib, centreOf(box.bbox), mmToIU(0.5))[0]!;
    expect(hit.kind).toBe('field');

    const target = fieldEditTarget(doc, hit.id);
    expect(target).toEqual({ symbol: 0, index: box.index });
    expect(doc.symbols[target!.symbol]!.fields[target!.index]!.key).toBe('Reference');
  });

  it('refuses the id a click on the symbol body produces', () => {
    const { doc, lib } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    const body = symbolBodyBBox(doc.symbols[0]!, R);
    const boxes = collectFieldBoxes(doc, lib).map((f) => f.bbox);
    const inside = (b: (typeof boxes)[number], x: number, y: number) =>
      x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

    let probe: { x: number; y: number } | null = null;
    for (let fx = 0.1; fx <= 0.9 && !probe; fx += 0.1) {
      for (let fy = 0.1; fy <= 0.9 && !probe; fy += 0.1) {
        const x = body.minX + (body.maxX - body.minX) * fx;
        const y = body.minY + (body.maxY - body.minY) * fy;
        if (!boxes.some((b) => inside(b, x, y))) probe = { x, y };
      }
    }
    expect(probe).not.toBeNull();

    const hit = collectAndGuess(doc, lib, probe!, mmToIU(0.5))[0]!;
    expect(hit.kind).toBe('symbol');
    expect(hit.id).toBe(symId);
    // The symbol branch is reachable only because this is null; a router that
    // answered with a field here would open the wrong dialog for a body click.
    expect(fieldEditTarget(doc, hit.id)).toBeNull();
  });

  it('refuses a field index the symbol does not have', () => {
    const { doc } = sheetWithResistor();
    const symId = refId('symbol', doc.symbols[0]!.uuid, 0);
    expect(fieldEditTarget(doc, `${symId}:field99`)).toBeNull();
    expect(fieldEditTarget(doc, 'no-such-symbol:field0')).toBeNull();
  });
});

describe("editFieldText's re-autoplace tail", () => {
  const OPTS = { allowRejustify: true, alignToGrid: true };

  /** Move every field somewhere the autoplacer would never leave it. */
  const displaced = (doc: Schematic): Schematic => ({
    ...doc,
    symbols: doc.symbols.map((s) => ({
      ...s,
      fields: s.fields.map(
        (f): SchField => (f.at ? { ...f, at: { x: f.at.x + mmToIU(30), y: f.at.y } } : f),
      ),
    })),
  });

  const sheetOf = (doc: Schematic, lib: Map<string, LibSymbol>) => ({ doc, libById: lib });

  it('re-places the fields of a symbol the autoplacer owns', () => {
    const { doc, lib } = sheetWithResistor();
    const moved = displaced(doc);
    const sym = { ...moved.symbols[0]!, fieldsAutoplaced: 'auto' as const };

    const after = autoplaceAfterFieldEdit(sym, R, true, OPTS, sheetOf(moved, lib));
    expect(after.fields.map((f) => f.at)).not.toEqual(sym.fields.map((f) => f.at));
    // `AutoplaceFields( screen, fieldsAutoplaced )` keeps the parent's existing
    // algo rather than promoting it to MANUAL.
    expect(after.fieldsAutoplaced).toBe('auto');
  });

  it('leaves a symbol alone when the preference is off', () => {
    // `if( m_frame->eeconfig()->m_AutoplaceFields.enable || parentType == SCH_SHEET_T )`
    const { doc, lib } = sheetWithResistor();
    const moved = displaced(doc);
    const sym = { ...moved.symbols[0]!, fieldsAutoplaced: 'auto' as const };

    expect(autoplaceAfterFieldEdit(sym, R, false, OPTS, sheetOf(moved, lib))).toBe(sym);
  });

  it('leaves a symbol whose fields the user placed by hand', () => {
    // `if( fieldsAutoplaced == AUTOPLACE_AUTO || fieldsAutoplaced == AUTOPLACE_MANUAL )`
    // — no `fields_autoplaced` token means the positions are the user's.
    const { doc, lib } = sheetWithResistor();
    const moved = displaced(doc);
    const sym = { ...moved.symbols[0]! };
    delete (sym as { fieldsAutoplaced?: 'auto' | 'manual' }).fieldsAutoplaced;

    expect(autoplaceAfterFieldEdit(sym, R, true, OPTS, sheetOf(moved, lib))).toBe(sym);
  });
});
