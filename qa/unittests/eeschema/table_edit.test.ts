// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDIT_TABLE_TOOL_BASE::doMergeCells` / `doUnmergeCells`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  canMerge,
  canUnmerge,
  addColumn,
  addRow,
  cellBlock,
  deleteColumns,
  deleteRows,
  mergeCells,
  rowColCommand,
  tableCellsCommand,
  unmergeCells,
} from '@ziroeda/eeschema/src/tools/table_edit.js';
import { tableCellId } from '@ziroeda/eeschema/src/tools/table_cells.js';
import type { SchTable, Schematic } from '@ziroeda/eeschema/src/types.js';

const mm = (n: number): number => n * 10000;
const TABLE = 't-1';
const id = (k: number): string => tableCellId(TABLE, k);

const cell = (x: number, y: number, w: number, h: number, text: string): string =>
  `(table_cell "${text}" (exclude_from_sim no) (at ${x} ${y} 0) (size ${w} ${h})
     (span 1 1) (margins 0.5 0.5 0.5 0.5)
     (effects (font (size 1.27 1.27)) (justify left top)))`;

/** A 3x2 grid (3 columns, 2 rows), all columns 20 wide, all rows 10 tall. */
const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
      (table (column_count 3) (border (external yes) (header yes))
        (separators (rows yes) (cols yes))
        (column_widths 20 20 20) (row_heights 10 10) (uuid "${TABLE}")
        (cells
          ${cell(10, 10, 20, 10, 'a')}
          ${cell(30, 10, 20, 10, 'b')}
          ${cell(50, 10, 20, 10, 'c')}
          ${cell(10, 20, 20, 10, 'd')}
          ${cell(30, 20, 20, 10, '')}
          ${cell(50, 20, 20, 10, 'f')})))`),
  );

const table = (): SchTable => doc().tables[0]!;
const spans = (t: SchTable): string => t.cells.map((c) => `${c.colSpan}${c.rowSpan}`).join(' ');

describe('merge', () => {
  it('spans the top-left cell over the block and empties the rest', () => {
    const out = mergeCells(table(), [0, 1]);
    expect(out.cells[0]!.colSpan).toBe(2);
    expect(out.cells[0]!.rowSpan).toBe(1);
    expect(out.cells[1]!.colSpan).toBe(0);
    expect(out.cells[1]!.rowSpan).toBe(0);
    expect(out.cells[1]!.text).toBe('');
  });

  it('joins the texts rather than losing them', () => {
    // A merge is otherwise lossy and undo is the only way back.
    expect(mergeCells(table(), [0, 1]).cells[0]!.text).toBe('a\nb');
  });

  it('skips empty cells when joining', () => {
    // Cell 4 is empty; the join must not leave a blank line in the middle.
    expect(mergeCells(table(), [3, 4, 5]).cells[3]!.text).toBe('d\nf');
  });

  it('takes the whole bounding block, not just the cells picked', () => {
    // doMergeCells reads the selection only for colMin/colMax and
    // rowMin/rowMax: two opposite corners merge everything between them.
    const out = mergeCells(table(), [0, 5]);
    expect(out.cells[0]!.colSpan).toBe(3);
    expect(out.cells[0]!.rowSpan).toBe(2);
    expect(spans(out)).toBe('32 00 00 00 00 00');
    expect(out.cells[0]!.text).toBe('a\nb\nc\nd\nf');
  });

  it('re-lays the geometry out', () => {
    const out = mergeCells(table(), [0, 1]);
    expect(out.cells[0]!.end.x).toBe(mm(50));
    expect(out.cells[0]!.end.y).toBe(mm(20));
  });

  it('does nothing for a single cell', () => {
    // Identity, so the caller can skip the undo entry.
    const t = table();
    expect(mergeCells(t, [0])).toBe(t);
    expect(mergeCells(t, [])).toBe(t);
  });
});

describe('unmerge', () => {
  const mergedTable = (): SchTable => mergeCells(table(), [0, 1]);

  it('gives every swallowed cell its span back', () => {
    const out = unmergeCells(mergedTable(), [0]);
    expect(spans(out)).toBe('11 11 11 11 11 11');
  });

  it('re-lays the geometry out', () => {
    const out = unmergeCells(mergedTable(), [0]);
    expect(out.cells[0]!.end.x).toBe(mm(30));
    expect(out.cells[1]!.start.x).toBe(mm(30));
  });

  it('does not give the text back — the merge already joined it', () => {
    // Undo is what puts the text back, not unmerge. Upstream does the same.
    expect(unmergeCells(mergedTable(), [0]).cells[0]!.text).toBe('a\nb');
    expect(unmergeCells(mergedTable(), [0]).cells[1]!.text).toBe('');
  });

  it('leaves an already-plain cell alone', () => {
    const t = table();
    expect(unmergeCells(t, [0, 1])).toBe(t);
  });

  it('unmerges the merged one in a mixed selection', () => {
    const out = unmergeCells(mergedTable(), [0, 2, 5]);
    expect(spans(out)).toBe('11 11 11 11 11 11');
  });
});

describe('the block a selection spans', () => {
  it('is exclusive at the far edge', () => {
    expect(cellBlock(table(), [0])).toEqual({ colMin: 0, colMax: 1, rowMin: 0, rowMax: 1 });
  });

  it('reaches past a merged cell’s own column', () => {
    const t = mergeCells(table(), [0, 1]);
    expect(cellBlock(t, [0])).toEqual({ colMin: 0, colMax: 2, rowMin: 0, rowMax: 1 });
  });

  it('is null for indices that are not there', () => {
    expect(cellBlock(table(), [99])).toBeNull();
  });

  it('still covers a swallowed cell handed to it directly', () => {
    // A span of 0 cannot be selected, so this is malformed input — but a raw
    // `col + 0` would give an empty block, and an empty block merges nothing
    // while still looking like it worked.
    const t = mergeCells(table(), [0, 1]);
    expect(cellBlock(t, [1])).toEqual({ colMin: 1, colMax: 2, rowMin: 0, rowMax: 1 });
  });
});

describe('reaching the file', () => {
  it('writes the new spans, so a merge survives a save', () => {
    // The writer patched a cell's text, position and size but never its span,
    // because until merge/unmerge nothing could change one. A merge that did
    // not reach the file would come back unmerged on the next open.
    const d = doc();
    const after = tableCellsCommand(d, [id(0), id(1)], 'merge')!.apply(d);
    const text = serializeSchematic(after);
    expect(text).toContain('(span 2 1)');
    expect(text).toContain('(span 0 0)');
    expect(readSchematic(parse(text)).tables[0]!.cells[0]!.colSpan).toBe(2);
  });

  it('adds a span to a cell that never had one', () => {
    // A cell with no `(span ...)` reads as 1x1; after a merge it is not, so
    // patching an absent node is not enough — it has to be added.
    const bare = readSchematic(
      parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
        (table (column_count 2) (border (external yes) (header yes))
          (separators (rows yes) (cols yes))
          (column_widths 20 20) (row_heights 10) (uuid "t-2")
          (cells
            (table_cell "a" (at 10 10 0) (size 20 10)
              (effects (font (size 1.27 1.27))))
            (table_cell "b" (at 30 10 0) (size 20 10)
              (effects (font (size 1.27 1.27)))))))`),
    );
    const merged = mergeCells(bare.tables[0]!, [0, 1]);
    const text = serializeSchematic({ ...bare, tables: [merged] });
    expect(text).toContain('(span 2 1)');
  });
});

describe('the document-level command', () => {
  it('merges through a selection of ids', () => {
    const d = doc();
    const cmd = tableCellsCommand(d, [id(0), id(1)], 'merge')!;
    expect(cmd.apply(d).tables[0]!.cells[0]!.colSpan).toBe(2);
  });

  it('is null when nothing would change', () => {
    const d = doc();
    expect(tableCellsCommand(d, [id(0)], 'merge')).toBeNull();
    expect(tableCellsCommand(d, [id(0), id(1)], 'unmerge')).toBeNull();
    expect(tableCellsCommand(d, ['sym-1'], 'merge')).toBeNull();
  });

  it('undoes and redoes', () => {
    const d = doc();
    const cmd = tableCellsCommand(d, [id(0), id(1)], 'merge')!;
    const after = cmd.apply(d);
    expect(cmd.invert(d).apply(after).tables).toEqual(d.tables);
    const redone = cmd.invert(d).invert(after).apply(cmd.invert(d).apply(after));
    expect(redone.tables[0]!.cells[0]!.colSpan).toBe(2);
  });

  it('reports what the menu should offer', () => {
    const d = doc();
    expect(canMerge(d, [id(0), id(1)])).toBe(true);
    expect(canMerge(d, [id(0)])).toBe(false);
    expect(canUnmerge(d, [id(0)])).toBe(false);
    const mergedDoc = tableCellsCommand(d, [id(0), id(1)], 'merge')!.apply(d);
    expect(canUnmerge(mergedDoc, [id(0)])).toBe(true);
  });
});

describe('rows and columns', () => {
  it('adds a row above, copying the formatting and not the text', () => {
    // copyCell keeps the look of the row you inserted next to; a second copy of
    // its contents is not what "add row" means.
    const out = addRow(table(), 0, 'above');
    expect(out.cells).toHaveLength(9);
    expect(out.cells.slice(0, 3).map((c) => c.text)).toEqual(['', '', '']);
    expect(out.cells[3]!.text).toBe('a');
    expect(out.cells[0]!.effects).toEqual(table().cells[0]!.effects);
  });

  it('adds a row below', () => {
    const out = addRow(table(), 0, 'below');
    expect(out.cells.slice(3, 6).map((c) => c.text)).toEqual(['', '', '']);
    expect(out.cells[6]!.text).toBe('d');
  });

  it('gives the new row the source row’s height, and re-lays out', () => {
    const out = addRow(table(), 0, 'above');
    expect(out.rowHeights).toEqual([mm(10), mm(10), mm(10)]);
    expect(out.cells[3]!.start.y).toBe(mm(20));
  });

  it('resets the span on a copied cell', () => {
    // Carrying a merge into a new row would claim cells that are not there.
    const merged = mergeCells(table(), [0, 1]);
    const out = addRow(merged, 0, 'above');
    expect(out.cells.slice(0, 3).map((c) => c.colSpan)).toEqual([1, 1, 1]);
  });

  it('adds a column, widening every row', () => {
    const out = addColumn(table(), 0, 'before');
    expect(out.columnCount).toBe(4);
    expect(out.cells).toHaveLength(8);
    expect(out.colWidths).toEqual([mm(20), mm(20), mm(20), mm(20)]);
    expect(out.cells[0]!.text).toBe('');
    expect(out.cells[1]!.text).toBe('a');
    expect(out.cells[4]!.text).toBe('');
    expect(out.cells[5]!.text).toBe('d');
  });

  it('adds a column after', () => {
    const out = addColumn(table(), 2, 'after');
    expect(out.cells.slice(0, 4).map((c) => c.text)).toEqual(['a', 'b', 'c', '']);
  });

  it('deletes a row and its height', () => {
    const out = deleteRows(table(), [0])!;
    expect(out.cells.map((c) => c.text)).toEqual(['d', '', 'f']);
    expect(out.rowHeights).toEqual([mm(10)]);
    expect(out.cells[0]!.start.y).toBe(mm(10));
  });

  it('deletes a column and its width', () => {
    const out = deleteColumns(table(), [1])!;
    expect(out.columnCount).toBe(2);
    expect(out.cells.map((c) => c.text)).toEqual(['a', 'c', 'd', 'f']);
    expect(out.colWidths).toEqual([mm(20), mm(20)]);
    expect(out.cells[1]!.start.x).toBe(mm(30));
  });

  it('returns null when every row or column would go', () => {
    // The table itself is removed then (commit.Remove), which is the caller's
    // business rather than this function's.
    expect(deleteRows(table(), [0, 1])).toBeNull();
    expect(deleteColumns(table(), [0, 1, 2])).toBeNull();
  });

  it('does nothing for an out-of-range row or column', () => {
    const t = table();
    expect(addRow(t, 9, 'above')).toBe(t);
    expect(addColumn(t, 9, 'before')).toBe(t);
    expect(deleteRows(t, [9])).toBe(t);
    expect(deleteColumns(t, [9])).toBe(t);
  });
});

describe('the row/column command', () => {
  it('adds above the topmost selected cell and below the bottommost', () => {
    // doAddRowAbove takes `topmost`, doAddRowBelow takes `bottommost`.
    const d = doc();
    const above = rowColCommand(d, [id(3), id(1)], 'addRowAbove')!.apply(d);
    expect(above.tables[0]!.cells[0]!.text).toBe('');
    expect(above.tables[0]!.cells[3]!.text).toBe('a');
    const below = rowColCommand(d, [id(1), id(3)], 'addRowBelow')!.apply(d);
    expect(below.tables[0]!.cells.slice(6, 9).map((c) => c.text)).toEqual(['', '', '']);
  });

  it('deletes every row holding a selected cell', () => {
    const d = doc();
    const out = rowColCommand(d, [id(0)], 'deleteRows')!.apply(d);
    expect(out.tables[0]!.cells.map((c) => c.text)).toEqual(['d', '', 'f']);
  });

  it('removes the table when the deletion takes all of it', () => {
    const d = doc();
    const out = rowColCommand(d, [id(0), id(3)], 'deleteRows')!.apply(d);
    expect(out.tables).toHaveLength(0);
  });

  it('is null for a selection with no cells in it', () => {
    expect(rowColCommand(doc(), ['sym-1'], 'addRowAbove')).toBeNull();
  });

  it('undoes', () => {
    const d = doc();
    const cmd = rowColCommand(d, [id(0)], 'deleteRows')!;
    expect(cmd.invert(d).apply(cmd.apply(d)).tables).toEqual(d.tables);
  });

  it('survives the round trip to the file', () => {
    const d = doc();
    const out = rowColCommand(d, [id(0)], 'addRowAbove')!.apply(d);
    const back = readSchematic(parse(serializeSchematic(out)));
    expect(back.tables[0]!.cells).toHaveLength(9);
    expect(back.tables[0]!.rowHeights).toHaveLength(3);
  });
});
