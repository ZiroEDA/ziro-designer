// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLE_PROPERTIES`, the dialog `DrawTable` ends with.
 *
 * Ours reported the row and column counts the drag had produced and offered
 * nothing else, so a table could be created but never given contents or a
 * border. This covers the decisions the real dialog makes — in particular the
 * two that are not obvious from the widgets:
 *
 *  - switching a line off stores a width of −1, it does not merely stop
 *    drawing it;
 *  - and reading that back beats the flag, so a −1 width shows the boxes
 *    unticked whatever `StrokeRows()` says.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { makeTable } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import {
  applySchTableValues,
  borderControlsEnabled,
  collectSchTableValues,
  separatorControlsEnabled,
  tableAt,
  tableRowCount,
  tableStrokeStyle,
  tableWithValues,
} from '@ziroeda/eeschema/src/tools/sch_table_properties.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const EMPTY = `(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`;
const blank = (): Schematic => readSchematic(parse(EMPTY));

/** A 2x3 table with known cell texts. */
const doc = (): Schematic => {
  const d = blank();
  const t = makeTable({ x: mmToIU(10), y: mmToIU(10) }, 2, 3, ['a', 'b', 'c', 'd', 'e', 'f']);
  return { ...d, tables: [t] };
};

describe('reading a table into the dialog', () => {
  it('lays the cell texts out in rows and columns', () => {
    const v = collectSchTableValues(doc().tables[0]!);
    expect(v.cellText).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('and the row count comes from the cells and the column count', () => {
    expect(tableRowCount(doc().tables[0]!)).toBe(2);
  });

  it('carries the border and separator flags across', () => {
    const v = collectSchTableValues(doc().tables[0]!);
    expect(v.borderExternal).toBe(true);
    expect(v.borderHeader).toBe(true);
    expect(v.separatorRows).toBe(true);
    expect(v.separatorCols).toBe(true);
  });

  it('a stored "default" line style selects Solid, not a Default row', () => {
    // The combo is `lineTypeNames`, which starts at Solid; LINE_STYLE::DEFAULT
    // is −1, out of range, so `SetSelection( 0 )` applies.
    expect(tableStrokeStyle({ width: 0, type: 'default' })).toBe('solid');
    expect(tableStrokeStyle(undefined)).toBe('solid');
    expect(tableStrokeStyle({ width: 0, type: 'dash_dot' })).toBe('dash_dot');
  });

  it('a −1 separator width unticks the boxes, whatever the flags say', () => {
    // `bool rows = m_table->StrokeRows() && m_table->GetSeparatorsStroke().GetWidth() >= 0;`
    const d = doc();
    const t = { ...d.tables[0]!, separatorsStroke: { width: -1, type: 'solid' } };
    const v = collectSchTableValues(t);
    expect(t.separatorRows).toBe(true); // the flag is still set…
    expect(v.separatorRows).toBe(false); // …but the width decides
    expect(v.separatorCols).toBe(false);
  });

  it('and the width field falls back to zero rather than showing −1', () => {
    const d = doc();
    const t = { ...d.tables[0]!, borderStroke: { width: -1, type: 'solid' } };
    expect(collectSchTableValues(t).borderWidth).toBe(0);
  });
});

describe('which controls are live', () => {
  const base = collectSchTableValues(doc().tables[0]!);

  it('the border width, colour and style need one of the two border boxes', () => {
    expect(borderControlsEnabled({ ...base, borderExternal: true, borderHeader: false })).toBe(
      true,
    );
    expect(borderControlsEnabled({ ...base, borderExternal: false, borderHeader: true })).toBe(
      true,
    );
    expect(borderControlsEnabled({ ...base, borderExternal: false, borderHeader: false })).toBe(
      false,
    );
  });

  it('and the separator controls need a row or a column line', () => {
    expect(separatorControlsEnabled({ ...base, separatorRows: false, separatorCols: false })).toBe(
      false,
    );
    expect(separatorControlsEnabled({ ...base, separatorRows: false, separatorCols: true })).toBe(
      true,
    );
  });
});

describe('applying the dialog', () => {
  it('writes the edited cell texts', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      cellText: [
        ['A', 'b', 'c'],
        ['d', 'e', 'F'],
      ],
    }).apply(d);
    expect(next.tables[0]?.cells.map((c) => c.text)).toEqual(['A', 'b', 'c', 'd', 'e', 'F']);
  });

  it('leaves an untouched cell as the very same object', () => {
    // So a dialog that only changed one cell does not make every other cell
    // look modified to anything comparing by identity.
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      cellText: [
        ['A', 'b', 'c'],
        ['d', 'e', 'f'],
      ],
    }).apply(d);
    expect(next.tables[0]?.cells[1]).toBe(d.tables[0]?.cells[1]);
  });

  it('stores −1 for a border switched off', () => {
    // `else stroke.SetWidth( -1 );` — the rule that makes "no border" survive.
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      borderExternal: false,
      borderHeader: false,
    }).apply(d);
    expect(next.tables[0]?.borderStroke?.width).toBe(-1);
  });

  it('and a width of at least zero when it is on', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, { ...v, borderWidth: mmToIU(0.5) }).apply(d);
    expect(next.tables[0]?.borderStroke?.width).toBe(mmToIU(0.5));
    // `std::max( 0, … )` — a negative typed into the field is clamped, not stored.
    const clamped = applySchTableValues(0, { ...v, borderWidth: -50 }).apply(d);
    expect(clamped.tables[0]?.borderStroke?.width).toBe(0);
  });

  it('same for the separators', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const off = applySchTableValues(0, {
      ...v,
      separatorRows: false,
      separatorCols: false,
    }).apply(d);
    expect(off.tables[0]?.separatorsStroke?.width).toBe(-1);
    expect(off.tables[0]?.separatorRows).toBe(false);
  });

  it('keeps the style and colour chosen', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      borderStyle: 'dash_dot',
      borderColor: [255, 0, 0, 1],
    }).apply(d);
    expect(next.tables[0]?.borderStroke?.type).toBe('dash_dot');
    expect(next.tables[0]?.borderStroke?.color).toEqual([255, 0, 0, 1]);
  });

  it('and undo puts the whole table back', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const cmd = applySchTableValues(0, { ...v, borderExternal: false, borderHeader: false });
    const back = cmd.invert(d).apply(cmd.apply(d));
    expect(back.tables[0]).toBe(d.tables[0]);
  });
});

describe('the file', () => {
  const roundTrip = (s: Schematic): Schematic => readSchematic(parse(serializeSchematic(s)));

  it('keeps a switched-off border switched off', () => {
    // The writer patched the border's flags but not its stroke, so a −1 width
    // never reached the file and the border came back at the next load.
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      borderExternal: false,
      borderHeader: false,
    }).apply(d);
    const back = roundTrip(next).tables[0]!;
    expect(back.borderExternal).toBe(false);
    expect(back.borderStroke?.width).toBe(-1);
    expect(collectSchTableValues(back).borderExternal).toBe(false);
  });

  it('keeps an edited border width and style', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      borderWidth: mmToIU(0.4),
      borderStyle: 'dash',
    }).apply(d);
    const back = roundTrip(next).tables[0]!;
    expect(back.borderStroke?.width).toBe(mmToIU(0.4));
    expect(back.borderStroke?.type).toBe('dash');
  });

  it('keeps the separators off', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      separatorRows: false,
      separatorCols: false,
    }).apply(d);
    const back = roundTrip(next).tables[0]!;
    expect(collectSchTableValues(back).separatorRows).toBe(false);
    expect(back.separatorsStroke?.width).toBe(-1);
  });

  it('and the cell texts', () => {
    const d = doc();
    const v = collectSchTableValues(d.tables[0]!);
    const next = applySchTableValues(0, {
      ...v,
      cellText: [
        ['one', 'two', 'three'],
        ['four', 'five', 'six'],
      ],
    }).apply(d);
    expect(roundTrip(next).tables[0]?.cells.map((c) => c.text)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
    ]);
  });
});

describe('which table the dialog opens on', () => {
  it('the one selected item, when it is a table', () => {
    const d = doc();
    const id = d.tables[0]!.uuid!;
    expect(tableAt(d, new Set([id]))).toBe(0);
  });

  it('nothing for an empty or multiple selection', () => {
    const d = doc();
    expect(tableAt(d, new Set())).toBe(null);
    expect(tableAt(d, new Set([d.tables[0]!.uuid!, 'other']))).toBe(null);
  });

  it('and nothing for something that is not a table', () => {
    expect(tableAt(doc(), new Set(['not-a-table']))).toBe(null);
  });
});

describe('tableWithValues', () => {
  it('does not disturb the shape of the table', () => {
    const d = doc();
    const t = d.tables[0]!;
    const next = tableWithValues(t, collectSchTableValues(t));
    expect(next.columnCount).toBe(t.columnCount);
    expect(next.colWidths).toEqual(t.colWidths);
    expect(next.rowHeights).toEqual(t.rowHeights);
    expect(next.cells).toHaveLength(t.cells.length);
  });
});
