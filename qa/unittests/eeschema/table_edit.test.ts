// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDIT_TABLE_TOOL_BASE::doMergeCells` / `doUnmergeCells`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  canMerge,
  canUnmerge,
  cellBlock,
  mergeCells,
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
