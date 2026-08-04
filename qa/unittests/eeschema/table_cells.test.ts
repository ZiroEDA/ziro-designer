// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table cells as selectable items: `SCH_SELECTION_TOOL::Selectable` for
 * `SCH_TABLECELL`, and the cell-to-table promotion move and rotate ask for.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  cellAt,
  cellIdAt,
  cellIndexOfId,
  hasCellSelection,
  isSelectableCell,
  promoteCellSelection,
  resolveCell,
  tableCellId,
  tableOfCellId,
} from '@ziroeda/eeschema/src/tools/table_cells.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const mm = (n: number): number => n * 10000;

/**
 * A 2x2 table whose top row is one merged cell: cell 0 spans two columns, so
 * cell 1 is spanned over and carries `(span 0 0)`.
 */
const cell = (x: number, y: number, w: number, h: number, span: string, text: string): string =>
  `(table_cell "${text}" (exclude_from_sim no) (at ${x} ${y} 0) (size ${w} ${h})
     ${span} (margins 0.5 0.5 0.5 0.5)
     (effects (font (size 1.27 1.27)) (justify left top)))`;

const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
      (table (column_count 2) (border (external yes) (header yes))
        (separators (rows yes) (cols yes))
        (column_widths 20 20) (row_heights 10 10) (uuid "t-1")
        (cells
          ${cell(10, 10, 40, 10, '(span 2 1)', 'header')}
          ${cell(30, 10, 0, 0, '(span 0 0)', '')}
          ${cell(10, 20, 20, 10, '(span 1 1)', 'a')}
          ${cell(30, 20, 20, 10, '(span 1 1)', 'b')})))`),
  );

const TABLE = 't-1';

describe('which cells can be selected', () => {
  it('rejects a cell a merged neighbour covers', () => {
    // Selectable() returns false for colSpan == 0 || rowSpan == 0. Those cells
    // still exist in the file, holding the grid's shape, but nothing on screen
    // belongs to them.
    const t = doc().tables[0]!;
    expect(isSelectableCell(t.cells[1]!)).toBe(false);
    expect(isSelectableCell(t.cells[0]!)).toBe(true);
    expect(isSelectableCell(t.cells[2]!)).toBe(true);
  });
});

describe('finding the cell under a point', () => {
  it('finds a plain cell', () => {
    const t = doc().tables[0]!;
    expect(cellAt(t, { x: mm(15), y: mm(25) })).toBe(2);
    expect(cellAt(t, { x: mm(35), y: mm(25) })).toBe(3);
  });

  it('finds the merged cell across the whole span', () => {
    // The point is over what would have been cell 1's column; the merged cell 0
    // owns it.
    const t = doc().tables[0]!;
    expect(cellAt(t, { x: mm(35), y: mm(15) })).toBe(0);
  });

  it('never returns a spanned-over cell', () => {
    // Cell 1 is zero-sized here, but even a stale non-zero rectangle must not
    // win: the span rule is what decides, not the geometry.
    const d = doc();
    const t = d.tables[0]!;
    const stale = {
      ...t,
      cells: t.cells.map((c, i) =>
        i === 1 ? { ...c, end: { x: mm(50), y: mm(20) }, start: { x: mm(30), y: mm(10) } } : c,
      ),
    };
    expect(cellAt(stale, { x: mm(35), y: mm(15) })).toBe(0);
  });

  it('gives the topmost cell when two overlap', () => {
    // Malformed input: selectable cells of a well-formed table do not overlap.
    // The renderer draws them in order, so the later one is what is on screen.
    const d = doc();
    const t = d.tables[0]!;
    const overlapping = {
      ...t,
      cells: [...t.cells, { ...t.cells[2]!, text: 'on top', start: { x: mm(10), y: mm(20) } }],
    };
    expect(cellAt(overlapping, { x: mm(15), y: mm(25) })).toBe(4);
  });

  it('handles a cell whose rectangle is written backwards', () => {
    // size can be negative, and a raw start/end compare would then never match.
    const d = doc();
    const t = d.tables[0]!;
    const flipped = {
      ...t,
      cells: t.cells.map((c, i) =>
        i === 2 ? { ...c, start: { x: mm(30), y: mm(30) }, end: { x: mm(10), y: mm(20) } } : c,
      ),
    };
    expect(cellAt(flipped, { x: mm(15), y: mm(25) })).toBe(2);
  });

  it('returns -1 outside the table', () => {
    expect(cellAt(doc().tables[0]!, { x: mm(100), y: mm(100) })).toBe(-1);
  });

  it('gives the cell id for a point in the document', () => {
    const d = doc();
    expect(cellIdAt(d, { x: mm(15), y: mm(25) })).toBe(tableCellId(TABLE, 2));
    expect(cellIdAt(d, { x: mm(100), y: mm(100) })).toBeNull();
  });

  it('picks the later table when two overlap', () => {
    // Tables are drawn in document order, so the later one is on top and is
    // what a click at a shared point should land on.
    const d = doc();
    const second = { ...d.tables[0]!, uuid: 't-2' };
    const two: Schematic = { ...d, tables: [d.tables[0]!, second] };
    expect(cellIdAt(two, { x: mm(15), y: mm(25) })).toBe(tableCellId('t-2', 2));
  });
});

describe('cell ids', () => {
  it('round-trip to their table and index', () => {
    const id = tableCellId(TABLE, 3);
    expect(tableOfCellId(id)).toBe(TABLE);
    expect(cellIndexOfId(id)).toBe(3);
  });

  it('leave an ordinary item id alone', () => {
    expect(tableOfCellId('sym-1')).toBeNull();
    expect(cellIndexOfId('sym-1')).toBeNull();
  });

  it('survive a table id that has no uuid', () => {
    // refId falls back to "table:idx:<n>", which has colons of its own.
    const id = tableCellId('table:idx:4', 1);
    expect(tableOfCellId(id)).toBe('table:idx:4');
    expect(cellIndexOfId(id)).toBe(1);
  });

  it('resolve back to the cell', () => {
    const d = doc();
    const r = resolveCell(d, tableCellId(TABLE, 2))!;
    expect(r.cell.text).toBe('a');
    expect(r.tableIndex).toBe(0);
    expect(r.cellIndex).toBe(2);
  });

  it('resolve to null when the cell or table is gone', () => {
    const d = doc();
    expect(resolveCell(d, tableCellId(TABLE, 99))).toBeNull();
    expect(resolveCell(d, tableCellId('nope', 0))).toBeNull();
    expect(resolveCell(d, 'sym-1')).toBeNull();
  });
});

describe('promoting a cell selection', () => {
  it('turns cells into their table, which is what move and rotate get', () => {
    // A cell cannot be moved out of the table it belongs to, so dragging with
    // one selected drags the table.
    const ids = [tableCellId(TABLE, 0), tableCellId(TABLE, 2)];
    expect([...promoteCellSelection(ids)]).toEqual([TABLE]);
  });

  it('passes other items through untouched', () => {
    const out = promoteCellSelection(['sym-1', tableCellId(TABLE, 0)]);
    expect(out).toEqual(new Set(['sym-1', TABLE]));
  });

  it('does not add a table twice when it is already selected', () => {
    expect(promoteCellSelection([TABLE, tableCellId(TABLE, 1)])).toEqual(new Set([TABLE]));
  });

  it('reports whether there is anything to promote', () => {
    expect(hasCellSelection(['sym-1'])).toBe(false);
    expect(hasCellSelection(['sym-1', tableCellId(TABLE, 0)])).toBe(true);
  });
});
