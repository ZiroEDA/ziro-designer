// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Properties fields grid's rows, counterpart FIELDS_GRID_TABLE as
 * DIALOG_SYMBOL_PROPERTIES fills and reads it.
 *
 * The point of these is the round trip: a flag the grid does not carry is a
 * flag the dialog silently clears, because `applyFields` rebuilds each field
 * from exactly the object the grid hands back and `patchProperty` then strips
 * the token from the file. Nothing about the UI says so.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { writeSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/write-schematic.js';
import { editSymbolProperties } from '@ziroeda/eeschema/src/tools/properties.js';
import {
  colorFromHex,
  colorHex,
  fieldsFromRows,
  rowsFromSymbol,
  validateRows,
} from '@ziroeda/designer/src/editors/schematic/symbol_props_rows.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** A resistor whose Footprint field is pinned in place and colour-set. */
const SRC = `(kicad_sch (version 20250114)
  (symbol (lib_id "Device:R") (at 50.8 50.8 0) (unit 1) (uuid "s-1")
    (property "Reference" "R1" (at 53.34 49.53 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 53.34 52.07 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "R_0603" (at 53.34 54.61 0) (do_not_autoplace yes)
      (show_in_chooser yes)
      (effects (font (size 1.27 1.27) (color 255 0 0 1)) (hide yes)))
    (property private "Sim.Params" "r=10k" (at 53.34 57.15 0)
      (effects (font (size 1.27 1.27)) (hide yes)))))`;

const sheet = (): Schematic => readSchematic(parse(SRC));
// refId returns the uuid itself when the item has one; a decorated id would
// match nothing and every "the flag survived" assertion would pass for the
// wrong reason — the edit simply would not have run.
const symId = 's-1';

describe('a row carries every flag the file does', () => {
  it('reads do_not_autoplace and show_in_chooser off the field', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    const fp = rows.find((r) => r.key === 'Footprint')!;
    expect(fp.doNotAutoplace).toBe(true);
    expect(fp.showInChooser).toBe(true);
    expect(fp.effects.color).toEqual([255, 0, 0, 1]);
  });

  it('shows a `private` field under its own name, and carries the flag', () => {
    // The flag is a bare atom BEFORE the name, so reading the first positional
    // slot as the name put "private" in the grid's Name column and the real
    // name in its Value column.
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    expect(rows.map((r) => r.key)).not.toContain('private');
    const sim = rows.find((r) => r.key === 'Sim.Params')!;
    expect(sim.value).toBe('r=10k');
    expect(sim.isPrivate).toBe(true);
  });

  it('hands them back unchanged when nothing was edited', () => {
    // The OK path with no edits at all: whatever came in must come out.
    const fields = fieldsFromRows(rowsFromSymbol(sheet().symbols[0]!));
    const fp = fields.find((f) => f.key === 'Footprint')!;
    expect(fp.doNotAutoplace).toBe(true);
    expect(fp.showInChooser).toBe(true);
  });

  it('survives a full OK with no edits, all the way to the file', () => {
    // This is the one that matters. The grid used to drop both flags, and
    // patchProperty strips (do_not_autoplace yes) when the model says false —
    // so opening the dialog and pressing OK cleared a setting untouched.
    const doc = sheet();
    const sym = doc.symbols[0]!;
    const edit = editSymbolProperties(symId, {
      fields: fieldsFromRows(rowsFromSymbol(sym)),
      angle: sym.angle,
      unit: sym.unit,
      bodyStyle: sym.bodyStyle,
      inBom: sym.inBom,
      onBoard: sym.onBoard,
      dnp: sym.dnp,
    });
    const out = serialize(writeSchematic(edit.apply(doc)));
    expect(out).toContain('(do_not_autoplace yes)');
    expect(out).toContain('(show_in_chooser yes)');
    expect(out).toContain('(color 255 0 0 1)');
    // The `private` flag stays ahead of the name; the field is not renamed.
    expect(out).toContain('(property private "Sim.Params"');
  });

  it('clearing Allow Autoplacement drops the token, as the checkbox says', () => {
    const doc = sheet();
    const sym = doc.symbols[0]!;
    const rows = rowsFromSymbol(sym).map((r) =>
      r.key === 'Footprint' ? { ...r, doNotAutoplace: undefined } : r,
    );
    const out = serialize(
      writeSchematic(
        editSymbolProperties(symId, {
          fields: fieldsFromRows(rows),
          angle: sym.angle,
          unit: sym.unit,
          bodyStyle: sym.bodyStyle,
          inBom: sym.inBom,
          onBoard: sym.onBoard,
          dnp: sym.dnp,
        }).apply(doc),
      ),
    );
    expect(out).not.toContain('do_not_autoplace');
  });
});

describe('the template rows and the drop rule', () => {
  it('offers a template name the symbol lacks, with its Visible flag', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!, [
      { name: 'MPN', visible: true, url: false },
      // Already on the symbol: not offered twice.
      { name: 'Value', visible: false, url: false },
    ]);
    expect(rows.filter((r) => r.key === 'Value')).toHaveLength(1);
    const mpn = rows.find((r) => r.key === 'MPN')!;
    expect(mpn.value).toBe('');
    expect(mpn.effects.hidden).toBe(false);
  });

  it('drops a nameless valueless row but rejects a nameless one with a value', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    const blank = { ...rows[0]!, key: '', value: '' };
    const named = { ...rows[0]!, key: '', value: 'orphan' };
    expect(validateRows([...rows, blank])).toBeNull();
    expect(fieldsFromRows([...rows, blank])).toHaveLength(rows.length);
    expect(validateRows([...rows, named])).toBe('Fields must have a name.');
  });
});

describe('the colour swatch', () => {
  it('round-trips a colour through the hex the swatch speaks', () => {
    expect(colorHex([255, 0, 0, 1])).toBe('#ff0000');
    expect(colorHex([0, 128, 255, 1])).toBe('#0080ff');
    expect(colorFromHex('#0080ff')).toEqual([0, 128, 255, 1]);
  });

  it('never produces the alpha-0 colour that means "unspecified"', () => {
    // (0 0 0 0) is how KiCad spells no colour; a swatch that produced it would
    // read back as "default" and the black the user picked would vanish.
    expect(colorFromHex('#000000')).toEqual([0, 0, 0, 1]);
    expect(colorHex(undefined)).toBe('');
    expect(colorFromHex('not a colour')).toBeUndefined();
  });
});
