// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_TABLECELL — what clicking a cell in a table actually selects.
 *
 * `schPropertiesFor` had no `tablecell` arm at all, so the switch fell through
 * to `[]` and the Properties panel came up completely empty on a cell, against
 * four categories and seventeen rows in a real 10.0.5.
 *
 * The set is not "everything a text box has". SCH_TABLECELL inherits
 * SCH_TEXTBOX -> SCH_SHAPE -> EDA_SHAPE and EDA_TEXT and then MASKS most of
 * it (sch_tablecell.cpp): the whole shape half except the fill, which it
 * re-registers under different names, and Width/Height/Thickness/Orientation/
 * Mirrored/Visible/Hyperlink out of the text half. So this list is the DESC
 * block's registrations minus its `Mask` calls, and it agrees row for row with
 * a capture of the same cell in 10.0.5.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  schItemFriendlyName,
  schPropertiesFor,
} from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById, refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { tableCellId } from '@ziroeda/eeschema/src/tools/table_cells.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();

/** A 2x2 table, which is the smallest thing with a second row and column. */
const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (table (column_count 2)
        (border (external yes) (header yes) (stroke (width 0) (type solid)))
        (separators (rows yes) (cols yes) (stroke (width 0) (type solid)))
        (column_widths 25.4 50.8)
        (row_heights 12.7 25.4)
        (cells
          (table_cell "a" (exclude_from_sim no) (at 0 0 0) (size 25.4 12.7)
            (margins 1 1 1 1) (span 1 1) (effects (font (size 1.27 1.27))))
          (table_cell "b" (exclude_from_sim no) (at 25.4 0 0) (size 50.8 12.7)
            (margins 1 1 1 1) (span 1 1) (effects (font (size 1.27 1.27))))
          (table_cell "c" (exclude_from_sim no) (at 0 12.7 0) (size 25.4 25.4)
            (margins 1 1 1 1) (span 1 1) (effects (font (size 1.27 1.27))))
          (table_cell "d" (exclude_from_sim no) (at 25.4 12.7 0) (size 50.8 25.4)
            (margins 1 1 1 1) (span 1 1) (effects (font (size 1.27 1.27)))))
        (uuid "t-1")))`),
  );

const cellRef = (d: Schematic, k: number): string =>
  tableCellId(refId('table', d.tables[0]!.uuid, 0), k);

/**
 * Through `itemRefById`, which is the call the editor makes
 * (SchematicEditor.tsx:8111) - NOT a hand-built ref.
 *
 * That distinction is the whole reason this file exists twice over. The first
 * version of it constructed `{ kind: 'tablecell', id }` itself, which made
 * every case below pass while the panel was still blank in the app: the arm in
 * `schPropertiesFor` was fine and `itemRefById` returned null for a `:cell`
 * id, so nothing ever reached the arm. A test that skips the lookup cannot see
 * that, which is the first of CLAUDE.md's shapes of test that cannot fail -
 * an expectation that does not exercise the path under test.
 */
const cellItemRef = (d: Schematic, k: number) => itemRefById(d, cellRef(d, k));

const rows = (d: Schematic, k = 0) => schPropertiesFor(d, LIB, cellItemRef(d, k)!);

describe('a cell id resolves to a ref at all', () => {
  it('itemRefById knows a :cell id', () => {
    // The editor turns the selected id into a ref with this call and renders
    // nothing when it answers null. `:cell` was missing from it, alongside the
    // `:sheetpin`, `:pin` and `:field` cases that were already there - so a
    // selected cell showed no caption and no rows however complete the arm was.
    const d = doc();
    expect(itemRefById(d, cellRef(d, 0))).toEqual({ kind: 'tablecell', id: cellRef(d, 0) });
  });

  it('answers null for a cell index the table does not have', () => {
    const d = doc();
    expect(itemRefById(d, `${refId('table', d.tables[0]!.uuid, 0)}:cell99`)).toBeNull();
  });

  it('still resolves the table itself', () => {
    const d = doc();
    const id = refId('table', d.tables[0]!.uuid, 0);
    expect(itemRefById(d, id)).toEqual({ kind: 'table', id });
  });
});

describe('a table cell has properties, and they are the masked set', () => {
  it('is not empty, which is what the missing arm made it', () => {
    expect(rows(doc()).length).toBeGreaterThan(0);
  });

  it('names itself Table Cell', () => {
    const d = doc();
    expect(schItemFriendlyName(d, cellItemRef(d, 0)!)).toBe('Table Cell');
  });

  it('offers what survives the masks, in the order a real panel shows', () => {
    expect(rows(doc()).map((r) => r.name)).toEqual([
      'Column Width',
      'Row Height',
      'Background Fill',
      'Background Fill Color',
      'Margin Left',
      'Margin Top',
      'Margin Right',
      'Margin Bottom',
      'Text',
      'Font',
      'Auto Thickness',
      'Italic',
      'Bold',
      'Horizontal Justification',
      'Vertical Justification',
      'Color',
      'Text Size',
    ]);
  });

  it('puts them in the four categories SCH_TABLECELL declares', () => {
    const byName = new Map(rows(doc()).map((r) => [r.name, r.group]));
    expect(byName.get('Column Width')).toBe('Table');
    expect(byName.get('Row Height')).toBe('Table');
    expect(byName.get('Background Fill')).toBe('Cell Properties');
    expect(byName.get('Background Fill Color')).toBe('Cell Properties');
    expect(byName.get('Margin Left')).toBe('Margins');
    expect(byName.get('Text')).toBe('Text Properties');
    expect(byName.get('Text Size')).toBe('Text Properties');
  });

  it('shows none of the masked rows', () => {
    // Every name in SCH_TABLECELL_DESC's Mask list. `Visible` is doubly gone:
    // masked here, and `SetAvailableFunc( isField )` upstream anyway.
    const names = new Set(rows(doc()).map((r) => r.name));
    for (const masked of [
      'Start X',
      'Start Y',
      'End X',
      'End Y',
      'Shape',
      'Width',
      'Height',
      'Fill',
      'Fill Color',
      'Line Width',
      'Line Style',
      'Line Color',
      'Corner Radius',
      'Thickness',
      'Orientation',
      'Mirrored',
      'Visible',
      'Hyperlink',
    ]) {
      expect(names.has(masked), `${masked} is masked and must not be shown`).toBe(false);
    }
  });
});

describe('a cell reads its width and height off its own column and row', () => {
  it('takes cell 0 from column 0 and row 0', () => {
    const r = rows(doc(), 0);
    expect(r.find((x) => x.name === 'Column Width')!.value).toBe(doc().tables[0]!.colWidths[0]);
    expect(r.find((x) => x.name === 'Row Height')!.value).toBe(doc().tables[0]!.rowHeights[0]);
  });

  it('takes cell 3 from column 1 and row 1, not from column 0', () => {
    // The bug this guards: `k % columnCount` / `Math.floor( k / columnCount )`
    // written the other way round reads plausibly and is wrong on any table
    // that is not square in its widths.
    const d = doc();
    const r = rows(d, 3);
    expect(r.find((x) => x.name === 'Column Width')!.value).toBe(d.tables[0]!.colWidths[1]);
    expect(r.find((x) => x.name === 'Row Height')!.value).toBe(d.tables[0]!.rowHeights[1]);
  });

  it('writes a column width back onto the table, not onto the cell', () => {
    const d = doc();
    const after = rows(d, 1).find((x) => x.name === 'Column Width')!.set!(99000)!.apply(d);
    expect(after.tables[0]!.colWidths[1]).toBe(99000);
    // The other column is untouched.
    expect(after.tables[0]!.colWidths[0]).toBe(d.tables[0]!.colWidths[0]);
  });
});

describe('the cell background is EDA_SHAPE fill under another name', () => {
  it('reads Background Fill as IsSolidFill', () => {
    const d = doc();
    expect(rows(d).find((r) => r.name === 'Background Fill')!.value).toBe(false);
    const after = rows(d).find((r) => r.name === 'Background Fill')!.set!(true)!.apply(d);
    expect(after.tables[0]!.cells[0]!.fill?.type).toBe('color');
  });

  it('writes the background colour as bytes, not as floats', () => {
    const d = doc();
    const after = rows(d).find((r) => r.name === 'Background Fill Color')!.set!('#3366cc')!.apply(
      d,
    );
    expect(after.tables[0]!.cells[0]!.fill?.color?.slice(0, 3)).toEqual([0x33, 0x66, 0xcc]);
  });
});

describe('the text half is edited on the cell', () => {
  it('writes the text', () => {
    const d = doc();
    const after = rows(d).find((r) => r.name === 'Text')!.set!('hello')!.apply(d);
    expect(after.tables[0]!.cells[0]!.text).toBe('hello');
    // ...and only that cell.
    expect(after.tables[0]!.cells[1]!.text).toBe('b');
  });

  it('writes bold onto the cell effects', () => {
    const d = doc();
    const after = rows(d).find((r) => r.name === 'Bold')!.set!(true)!.apply(d);
    expect(after.tables[0]!.cells[0]!.effects?.bold).toBe(true);
  });
});
