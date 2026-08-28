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

  it('rejects EVERY nameless user row, whether or not it has a value', () => {
    // Re-derived, not re-baselined: `DIALOG_SYMBOL_PROPERTIES::Validate`
    // (dialog_symbol_properties.cpp:673-692) reads `field.GetName( false )` and
    // nothing else — an empty name is refused with "Fields must have a name."
    // whatever the text beside it. This expectation used to say a nameless
    // valueless row was fine, borrowing the rule from `TransferDataFromWindow`'s
    // "no name AND no value → continue" (:771); but Validate runs FIRST and
    // such a row never reaches that branch from the OK button. The drop rule is
    // still `fieldsFromRows`'s, and that half is unchanged.
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    const blank = { ...rows[0]!, key: '', value: '' };
    const named = { ...rows[0]!, key: '', value: 'orphan' };
    expect(validateRows([...rows, blank])).toBe('Fields must have a name.');
    expect(validateRows([...rows, named])).toBe('Fields must have a name.');
    // …and a mandatory row is exempt, because `field.IsMandatory() → continue`.
    expect(validateRows(rows)).toBeNull();
    // `TransferDataFromWindow` still drops the blank one if it ever gets there.
    expect(fieldsFromRows([...rows, blank])).toHaveLength(rows.length);
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

/* ---------------------------------------------------------------------------
 * FIELDS_GRID_TABLE's shape, and the row rules the dialog's four buttons ask.
 *
 * These are the parts of the grid that are DATA rather than DOM — the column
 * table, which columns start shown, and which rows may be renamed, deleted or
 * moved — so they are pinned here rather than through a render. The rendering
 * of them is `symbol_properties_dialog.test.tsx`.
 * ------------------------------------------------------------------------ */

import {
  canDeleteRow,
  canMoveRowDown,
  canMoveRowUp,
  DEFAULT_SHOWN_COLUMNS,
  defaultShownColumns,
  FIELDS_GRID_COLUMNS,
  gridRowIndices,
  isNameReadOnly,
  isValueReadOnly,
  mandatoryRowCount,
} from '@ziroeda/designer/src/editors/schematic/symbol_props_rows.js';

/** A part carrying all five mandatory properties, as every LIB_SYMBOL does. */
const LIB = `(kicad_sch (version 20250114)
  (lib_symbols (symbol "Device:R"
    (property "Reference" "R" (at 0 0 0))
    (property "Value" "R" (at 0 0 0))
    (property "Footprint" "" (at 0 0 0))
    (property "Datasheet" "~" (at 0 0 0))
    (property "Description" "Resistor" (at 0 0 0))
    (symbol "R_0_1" (rectangle (start -1 1) (end 1 -1))))))`;
const libSymbol = () => readSchematic(parse(LIB)).libSymbols[0]!;

describe('the mandatory block is always five rows, and always first', () => {
  it('materialises the ones the file left out, in FIELD_T order', () => {
    // SCH_SYMBOL holds REFERENCE, VALUE, FOOTPRINT, DATASHEET and DESCRIPTION
    // whether or not the file wrote them, which is why TransferDataToWindow can
    // push GetFields() straight into the grid and get five rows.
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    expect(rows.slice(0, 5).map((r) => r.key)).toStrictEqual([
      'Reference',
      'Value',
      'Footprint',
      'Datasheet',
      'Description',
    ]);
    expect(mandatoryRowCount(rows)).toBe(5);
  });

  it('takes a materialised one from the library part, not from thin air', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!, undefined, libSymbol());
    expect(rows.find((r) => r.key === 'Description')!.value).toBe('Resistor');
    // Without a part there is nothing to copy, so the row is empty and hidden —
    // still a row, because the row is what makes the field editable at all.
    const bare = rowsFromSymbol(sheet().symbols[0]!);
    expect(bare.find((r) => r.key === 'Description')!.value).toBe('');
    expect(bare.find((r) => r.key === 'Description')!.effects.hidden).toBe(true);
  });

  it('keeps the user fields after them, in the file s order', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    expect(rows.map((r) => r.key).slice(5)).toStrictEqual(['Sim.Params']);
  });

  it('does not duplicate one the file DID write', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!, undefined, libSymbol());
    // The fixture's Footprint is R_0603 with its own flags; the library's is
    // empty. The placement's wins, and there is one of it.
    expect(rows.filter((r) => r.key === 'Footprint')).toHaveLength(1);
    expect(rows.find((r) => r.key === 'Footprint')!.value).toBe('R_0603');
  });
});

describe('a private field is in the table but not in the grid', () => {
  it('gridRowIndices skips it, and skips only it', () => {
    // FIELDS_GRID_TABLE::getVisibleRowCount / getField, fields_grid_table.cpp:
    // 474-516, for FRAME_SCH and FRAME_SCH_VIEWER.
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    const view = gridRowIndices(rows);
    expect(view.map((i) => rows[i]!.key)).not.toContain('Sim.Params');
    expect(view).toHaveLength(rows.length - 1);
  });

  it('and fieldsFromRows still hands it back, so OK cannot drop it', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    expect(fieldsFromRows(rows).map((f) => f.key)).toContain('Sim.Params');
  });
});

describe('the row rules the add/up/down/delete buttons guard', () => {
  const rows = () => rowsFromSymbol(sheet().symbols[0]!);

  it('delete refuses any row inside the mandatory block', () => {
    // OnDeleteField's filter: `row < m_fields->GetMandatoryRowCount()`.
    for (let i = 0; i < 5; i++) expect(canDeleteRow(rows(), i)).toBe(false);
    expect(canDeleteRow(rows(), 5)).toBe(true);
  });

  it('move-up refuses the FIRST user row as well as the mandatory ones', () => {
    // `row > GetMandatoryRowCount()`, strictly greater — row 5 would swap into
    // the block.
    expect(canMoveRowUp(rows(), 5)).toBe(false);
    const two = [...rows(), { ...rows()[5]!, key: 'Extra' }];
    expect(canMoveRowUp(two, 6)).toBe(true);
  });

  it('move-down allows the first user row, but not the last row', () => {
    // `row >= GetMandatoryRowCount()`, plus WX_GRID's `i + 1 < GetNumberRows()`.
    const two = [...rows(), { ...rows()[5]!, key: 'Extra' }];
    expect(canMoveRowDown(two, 5)).toBe(true);
    expect(canMoveRowDown(two, 6)).toBe(false);
    expect(canMoveRowDown(two, 4)).toBe(false);
  });
});

describe('which cells GetAttr makes read-only', () => {
  it('a mandatory field s name, and no user field s', () => {
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    expect(rows.filter(isNameReadOnly).map((r) => r.key)).toStrictEqual([
      'Reference',
      'Value',
      'Footprint',
      'Datasheet',
      'Description',
    ]);
  });

  it('a power symbol s Footprint VALUE, and nothing else of it', () => {
    // "Power symbols do not appear in the board, so don't allow a footprint."
    const rows = rowsFromSymbol(sheet().symbols[0]!);
    expect(rows.filter((r) => isValueReadOnly(r, true)).map((r) => r.key)).toStrictEqual([
      'Footprint',
    ]);
    expect(rows.filter((r) => isValueReadOnly(r, false))).toHaveLength(0);
  });
});

describe('the column table', () => {
  it('is FDC_SCH_EDIT_COUNT columns, labelled as GetColLabelValue labels them', () => {
    expect(FIELDS_GRID_COLUMNS.map((c) => c.label)).toStrictEqual([
      'Name',
      'Value',
      'Show',
      'Show Name',
      'H Align',
      'V Align',
      'Italic',
      'Bold',
      'Text Size',
      'Orientation',
      'X Position',
      'Y Position',
      'Font',
      'Color',
      'Allow Autoplacement',
    ]);
  });

  it('marks as bool exactly the columns m_boolAttr covers', () => {
    // FDC_SHOWN, FDC_SHOW_NAME, FDC_ITALIC, FDC_BOLD, FDC_ALLOW_AUTOPLACE —
    // the wxGridCellBoolRenderer set, and the reason those cells always draw a
    // checkbox where H/V Align do not.
    expect(FIELDS_GRID_COLUMNS.filter((c) => c.kind === 'bool').map((c) => c.id)).toStrictEqual([
      'shown',
      'show_name',
      'italic',
      'bold',
      'allow_autoplace',
    ]);
  });

  it('marks as choice exactly the columns a wxGridCellChoiceEditor covers', () => {
    expect(FIELDS_GRID_COLUMNS.filter((c) => c.kind === 'choice').map((c) => c.id)).toStrictEqual([
      'h_align',
      'v_align',
      'orientation',
    ]);
  });

  it('carries each choice editor s items in its own order', () => {
    const choices = (id: string) => FIELDS_GRID_COLUMNS.find((c) => c.id === id)?.choices;
    expect(choices('h_align')).toStrictEqual(['Left', 'Center', 'Right']);
    expect(choices('v_align')).toStrictEqual(['Top', 'Center', 'Bottom']);
    expect(choices('orientation')).toStrictEqual(['Horizontal', 'Vertical']);
  });

  it('centres the columns whose attr sets wxALIGN_CENTER, and only those', () => {
    expect(FIELDS_GRID_COLUMNS.filter((c) => c.center).map((c) => c.id)).toStrictEqual([
      'shown',
      'show_name',
      'h_align',
      'v_align',
      'italic',
      'bold',
      'orientation',
      'allow_autoplace',
    ]);
  });

  it('carries the base file s column widths', () => {
    // SetColSize, dialog_symbol_properties_base.cpp:40-53; the fifteenth has
    // none and takes wxGrid's default 80, asked of a real grid by the probe.
    expect(FIELDS_GRID_COLUMNS.map((c) => c.width)).toStrictEqual([
      72, 10, 48, 84, 66, 66, 48, 48, 84, 84, 84, 84, 10, 48, 80,
    ]);
  });

  it('starts with the eight ShowHideColumns names', () => {
    expect(DEFAULT_SHOWN_COLUMNS).toBe('0 1 2 3 4 5 6 7');
    expect([...defaultShownColumns()].sort((a, b) => a - b)).toStrictEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    // Which is Name through Bold. Text Size, Orientation, the two positions,
    // Font, Color and Allow Autoplacement are hidden until the user asks.
    expect([...defaultShownColumns()].map((i) => FIELDS_GRID_COLUMNS[i]!.label)).toStrictEqual([
      'Name',
      'Value',
      'Show',
      'Show Name',
      'H Align',
      'V Align',
      'Italic',
      'Bold',
    ]);
  });
});
