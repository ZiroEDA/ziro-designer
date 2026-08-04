// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_TABLE::Normalize` and the cell point editor's resize rule.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  cellRowCol,
  normalizeTable,
  resizeCellEdge,
  tableOrigin,
} from '@ziroeda/eeschema/src/tools/table_layout.js';
import {
  dragHandle,
  editHandles,
  pointEditTarget,
} from '@ziroeda/eeschema/src/tools/point_editor.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { SchTable } from '@ziroeda/eeschema/src/types.js';

const mm = (n: number): number => n * 10000;

const cell = (x: number, y: number, w: number, h: number, span: string, text: string): string =>
  `(table_cell "${text}" (exclude_from_sim no) (at ${x} ${y} 0) (size ${w} ${h})
     ${span} (margins 0.5 0.5 0.5 0.5)
     (effects (font (size 1.27 1.27)) (justify left top)))`;

/** A 2x2 grid, origin (10,10), columns 20 and 30, rows 10 and 15. */
const table = (): SchTable =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
      (table (column_count 2) (border (external yes) (header yes))
        (separators (rows yes) (cols yes))
        (column_widths 20 30) (row_heights 10 15) (uuid "t-1")
        (cells
          ${cell(10, 10, 20, 10, '(span 1 1)', 'a')}
          ${cell(30, 10, 30, 10, '(span 1 1)', 'b')}
          ${cell(10, 20, 20, 15, '(span 1 1)', 'c')}
          ${cell(30, 20, 30, 15, '(span 1 1)', 'd')})))`),
  ).tables[0]!;

/** The same grid, but the top row is one cell spanning both columns. */
const merged = (): SchTable => {
  const t = table();
  return {
    ...t,
    cells: t.cells.map((c, i) =>
      i === 0 ? { ...c, colSpan: 2 } : i === 1 ? { ...c, colSpan: 0, rowSpan: 0 } : c,
    ),
  };
};

const box = (t: SchTable, i: number) => ({
  x0: t.cells[i]!.start.x,
  y0: t.cells[i]!.start.y,
  x1: t.cells[i]!.end.x,
  y1: t.cells[i]!.end.y,
});

describe('normalize', () => {
  it('leaves an already-consistent table alone, identity and all', () => {
    // Identity is how callers tell that nothing moved.
    const t = table();
    expect(normalizeTable(t)).toBe(t);
  });

  it('puts the cells back where the widths say they belong', () => {
    const t = table();
    const scrambled: SchTable = {
      ...t,
      cells: t.cells.map((c) => ({ ...c, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } })),
    };
    // Origin comes from the first cell, which the scramble moved to (0,0).
    const out = normalizeTable(scrambled);
    expect(box(out, 0)).toEqual({ x0: 0, y0: 0, x1: mm(20), y1: mm(10) });
    expect(box(out, 1)).toEqual({ x0: mm(20), y0: 0, x1: mm(50), y1: mm(10) });
    expect(box(out, 2)).toEqual({ x0: 0, y0: mm(10), x1: mm(20), y1: mm(25) });
    expect(box(out, 3)).toEqual({ x0: mm(20), y0: mm(10), x1: mm(50), y1: mm(25) });
  });

  it('grows a merged cell across the columns it swallowed', () => {
    const out = normalizeTable(merged());
    // 20 + 30 wide, starting at the origin.
    expect(box(out, 0)).toEqual({ x0: mm(10), y0: mm(10), x1: mm(60), y1: mm(20) });
  });

  it('does not move the cells a merge covers out of the way', () => {
    // The swallowed cell keeps a slot in the grid — the row-major walk depends
    // on it — it is simply never selectable.
    const out = normalizeTable(merged());
    expect(out.cells).toHaveLength(4);
  });

  it('survives a table with no cells or no columns', () => {
    const t = table();
    expect(normalizeTable({ ...t, cells: [] }).cells).toEqual([]);
    expect(normalizeTable({ ...t, columnCount: 0 })).toEqual({ ...t, columnCount: 0 });
  });

  it('keeps a ragged final row rather than dropping it', () => {
    const t = table();
    const ragged: SchTable = { ...t, cells: [...t.cells, t.cells[0]!] };
    expect(normalizeTable(ragged).cells).toHaveLength(5);
  });
});

describe('the origin and the row/column of a cell', () => {
  it('takes the origin from the first cell', () => {
    expect(tableOrigin(table())).toEqual({ x: mm(10), y: mm(10) });
  });

  it('maps an index to its row and column', () => {
    const t = table();
    expect(cellRowCol(t, 0)).toEqual({ row: 0, col: 0 });
    expect(cellRowCol(t, 3)).toEqual({ row: 1, col: 1 });
  });
});

describe('dragging a cell edge', () => {
  it('sets the column width, and moves everything to its right', () => {
    const out = resizeCellEdge(table(), 0, 'right', mm(25));
    expect(out.colWidths[0]).toBe(mm(25));
    expect(box(out, 0).x1).toBe(mm(35));
    // The second column keeps its width but starts 5mm later.
    expect(box(out, 1)).toEqual({ x0: mm(35), y0: mm(10), x1: mm(65), y1: mm(20) });
  });

  it('sets the row height the same way', () => {
    const out = resizeCellEdge(table(), 0, 'bottom', mm(12));
    expect(out.rowHeights[0]).toBe(mm(12));
    expect(box(out, 2).y0).toBe(mm(22));
  });

  it('gives a merged cell’s drag to the LAST column it spans', () => {
    // The rule that is not the obvious one. The cell spans columns 0 and 1;
    // dragging it to 60mm must leave column 0 at 20 and set column 1 to 40 --
    // setting the whole 60 on column 0 would shove every cell to its right.
    const out = resizeCellEdge(merged(), 0, 'right', mm(60));
    expect(out.colWidths[0]).toBe(mm(20));
    expect(out.colWidths[1]).toBe(mm(40));
    expect(box(out, 0)).toEqual({ x0: mm(10), y0: mm(10), x1: mm(70), y1: mm(20) });
  });

  it('clamps a drag that would make a column narrower than nothing', () => {
    // Spanned width 20 already, dragged to 5: the last column would go to -15.
    const out = resizeCellEdge(merged(), 0, 'right', mm(5));
    expect(out.colWidths[1]).toBe(0);
  });

  it('does nothing for a cell that is not there', () => {
    const t = table();
    expect(resizeCellEdge(t, 99, 'right', mm(5))).toBe(t);
  });

  it('does nothing when the span runs past the declared columns', () => {
    // Malformed input: a span reaching beyond column_widths has no column to
    // write to, and inventing one would change the table's shape.
    const t = table();
    const overrun: SchTable = {
      ...t,
      cells: t.cells.map((c, i) => (i === 0 ? { ...c, colSpan: 5 } : c)),
    };
    expect(resizeCellEdge(overrun, 0, 'right', mm(60))).toBe(overrun);
  });
});

describe('the cell point editor', () => {
  const doc = () =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
        (table (column_count 2) (border (external yes) (header yes))
          (separators (rows yes) (cols yes))
          (column_widths 20 30) (row_heights 10 15) (uuid "t-1")
          (cells
            ${cell(10, 10, 20, 10, '(span 1 1)', 'a')}
            ${cell(30, 10, 30, 10, '(span 1 1)', 'b')}
            ${cell(10, 20, 20, 15, '(span 1 1)', 'c')}
            ${cell(30, 20, 30, 15, '(span 1 1)', 'd')})))`),
    );

  const CELL0 = 't-1:cell0';

  it('resolves a cell id to a point-edit target', () => {
    expect(pointEditTarget(doc(), CELL0)).toEqual({ kind: 'tablecell', index: 0, cell: 0 });
  });

  it('gives a cell two handles, not eight', () => {
    // EDA_TABLECELL_POINT_EDIT_BEHAVIOR exposes COL_WIDTH and ROW_HEIGHT only:
    // there is no top-left to drag, because a cell cannot move out of its grid.
    const d = doc();
    const handles = editHandles(d, pointEditTarget(d, CELL0)!);
    expect(handles).toHaveLength(2);
    expect(handles[0]!.at).toEqual({ x: mm(30), y: mm(15) });
    expect(handles[1]!.at).toEqual({ x: mm(20), y: mm(20) });
  });

  it('dragging the right handle widens the column', () => {
    const d = doc();
    const t = pointEditTarget(d, CELL0)!;
    const after = dragHandle(d, t, editHandles(d, t)[0]!, { x: mm(35), y: mm(15) });
    expect(after.tables[0]!.colWidths[0]).toBe(mm(25));
    // The neighbour moves with it rather than overlapping.
    expect(after.tables[0]!.cells[1]!.start.x).toBe(mm(35));
  });

  it('dragging the bottom handle heightens the row', () => {
    const d = doc();
    const t = pointEditTarget(d, CELL0)!;
    const after = dragHandle(d, t, editHandles(d, t)[1]!, { x: mm(20), y: mm(24) });
    expect(after.tables[0]!.rowHeights[0]).toBe(mm(14));
    expect(after.tables[0]!.cells[2]!.start.y).toBe(mm(24));
  });

  it('floors a drag at one mil rather than inverting the cell', () => {
    const d = doc();
    const t = pointEditTarget(d, CELL0)!;
    const after = dragHandle(d, t, editHandles(d, t)[0]!, { x: mm(-50), y: mm(15) });
    expect(after.tables[0]!.colWidths[0]).toBe(mmToIU(0.0254));
  });

  it('has no handles for a cell that is gone', () => {
    const d = doc();
    expect(editHandles(d, { kind: 'tablecell', index: 0, cell: 99 })).toEqual([]);
  });
});
