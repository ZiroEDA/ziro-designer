// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a table.
 * Counterparts: `DRAWING_TOOL::DrawTable` and `PCB_TABLE`'s constructor.
 *
 * The sizing rule is the substance. Four constants decide it and every one is
 * stated here as a **literal** rather than recomputed from the exported value —
 * an assertion built from the same expression it is checking passes whatever
 * that expression becomes.
 *
 * The behaviours worth naming:
 *
 * - A new column costs 15 font-widths of drag, a new row 3 font-heights, both
 *   by *truncating* division, so the grid grows in visible steps.
 * - Both counts floor at one, so a tiny or backwards drag gives a 1x1 table
 *   rather than nothing or a negative count.
 * - Cell size floors at 5 font-widths by 3 font-heights, which is what stops a
 *   fast drag producing a row of slivers.
 * - The result snaps to the grid pitch, so cells line up with the board.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { addBoardTable } from '@ziroeda/pcbnew/src/edit-board.js';
import {
  COL_STEP_IN_FONT_WIDTHS,
  DEFAULT_TABLE_DEFAULTS,
  MIN_CELL_IN_FONT_HEIGHTS,
  MIN_CELL_IN_FONT_WIDTHS,
  ROW_STEP_IN_FONT_HEIGHTS,
  newTable,
  tableCellSize,
  tableGridSize,
  type TableDefaults,
} from '@ziroeda/pcbnew/src/draw_table.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): { x: number; y: number } => ({ x: MM(x), y: MM(y) });

/** 1 mm font, no grid snapping, so the arithmetic is readable. */
const D: TableDefaults = {
  layer: 'F.SilkS',
  fontWidth: MM(1),
  fontHeight: MM(1),
  textThickness: MM(0.15),
  lineThickness: MM(0.1),
  gridPitch: 0,
};

const EMPTY_BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 ""))`;
const emptyBoard = (): Board => readBoard(parse(EMPTY_BOARD));

describe('the constants', () => {
  it('are upstream’s', () => {
    // Pinned separately so the assertions below can use literals.
    expect(COL_STEP_IN_FONT_WIDTHS).toBe(15);
    expect(ROW_STEP_IN_FONT_HEIGHTS).toBe(3);
    expect(MIN_CELL_IN_FONT_WIDTHS).toBe(5);
    expect(MIN_CELL_IN_FONT_HEIGHTS).toBe(3);
  });
});

describe('how many columns and rows a drag asks for', () => {
  it('gives one column per 15 font-widths', () => {
    expect(tableGridSize(P(15, 0), D).colCount).toBe(1);
    expect(tableGridSize(P(30, 0), D).colCount).toBe(2);
    expect(tableGridSize(P(45, 0), D).colCount).toBe(3);
  });

  it('gives one row per 3 font-heights', () => {
    expect(tableGridSize(P(0, 3), D).rowCount).toBe(1);
    expect(tableGridSize(P(0, 9), D).rowCount).toBe(3);
  });

  it('truncates rather than rounding, so the grid grows in steps', () => {
    // 29 mm is not quite two columns' worth.
    expect(tableGridSize(P(29, 0), D).colCount).toBe(1);
    expect(tableGridSize(P(30, 0), D).colCount).toBe(2);
  });

  it('floors at one for a drag too small to earn a cell', () => {
    expect(tableGridSize(P(1, 1), D)).toEqual({ colCount: 1, rowCount: 1 });
  });

  it('floors at one for a backwards drag rather than going negative', () => {
    expect(tableGridSize(P(-50, -50), D)).toEqual({ colCount: 1, rowCount: 1 });
  });

  it('scales with the font, not with absolute distance', () => {
    const big = { ...D, fontWidth: MM(2) };

    expect(tableGridSize(P(30, 0), big).colCount).toBe(1);
    expect(tableGridSize(P(60, 0), big).colCount).toBe(2);
  });
});

describe('how big each cell is', () => {
  it('divides the drag by the count', () => {
    expect(tableCellSize(P(30, 9), 2, 3, D)).toEqual(P(15, 3));
  });

  it('never goes below 5 font-widths by 3 font-heights', () => {
    // A 1x1 table from a tiny drag still gets a usable cell.
    expect(tableCellSize(P(1, 1), 1, 1, D)).toEqual(P(5, 3));
  });

  it('applies the two floors independently', () => {
    // Wide enough, far too short.
    expect(tableCellSize(P(40, 1), 1, 1, D)).toEqual(P(40, 3));
  });

  it('floors a backwards drag too', () => {
    expect(tableCellSize(P(-40, -40), 1, 1, D)).toEqual(P(5, 3));
  });

  it('snaps to the grid pitch', () => {
    const snapped = { ...D, gridPitch: MM(10) };

    // 32 mm of drag over one column rounds to the nearest 10 mm.
    expect(tableCellSize(P(32, 32), 1, 1, snapped).x).toBe(MM(30));
  });

  it('does not snap when there is no pitch', () => {
    expect(tableCellSize(P(32, 32), 1, 1, D).x).toBe(MM(32));
  });
});

describe('a freshly drawn table', () => {
  it('lays the cells out row-major from the origin', () => {
    const t = newTable(P(0, 0), P(30, 6), D);

    expect(t.columnCount).toBe(2);
    expect(t.cells).toHaveLength(4);
    expect(t.cells[0]!.start).toEqual(P(0, 0));
    expect(t.cells[1]!.start).toEqual(P(15, 0));
    expect(t.cells[2]!.start).toEqual(P(0, 3));
    expect(t.cells[3]!.start).toEqual(P(15, 3));
  });

  it('sizes every cell the same', () => {
    const t = newTable(P(0, 0), P(30, 6), D);

    for (const c of t.cells) {
      expect(c.end!.x - c.start!.x).toBe(MM(15));
      expect(c.end!.y - c.start!.y).toBe(MM(3));
    }
  });

  it('records the widths and heights per column and row', () => {
    const t = newTable(P(0, 0), P(45, 6), D);

    expect(t.columnWidths).toEqual([MM(15), MM(15), MM(15)]);
    expect(t.rowHeights).toEqual([MM(3), MM(3)]);
  });

  it('starts every cell empty, because the dialog supplies the text', () => {
    for (const c of newTable(P(0, 0), P(30, 6), D).cells) expect(c.text).toBe('');
  });

  it('turns every stroke flag on, as PCB_TABLE constructs it', () => {
    const t = newTable(P(0, 0), P(30, 6), D);

    expect(t.borderExternal).toBe(true);
    expect(t.borderHeader).toBe(true);
    expect(t.separatorRows).toBe(true);
    expect(t.separatorCols).toBe(true);
    expect(t.borderWidth).toBe(MM(0.1));
    expect(t.separatorWidth).toBe(MM(0.1));
  });

  it('gives cells the left alignment a text box starts with', () => {
    expect(newTable(P(0, 0), P(30, 6), D).cells[0]!.justify).toEqual(['left']);
  });

  it('gives every cell a span of one', () => {
    for (const c of newTable(P(0, 0), P(30, 6), D).cells) {
      expect(c.colSpan).toBe(1);
      expect(c.rowSpan).toBe(1);
    }
  });

  it('takes the layer it is given, on the table and every cell', () => {
    const t = newTable(P(0, 0), P(30, 6), { ...D, layer: 'F.Cu' });

    expect(t.layer).toBe('F.Cu');
    for (const c of t.cells) expect(c.layer).toBe('F.Cu');
  });

  it('is a 1x1 table for a backwards drag, not an empty one', () => {
    const t = newTable(P(50, 50), P(0, 0), D);

    expect(t.columnCount).toBe(1);
    expect(t.cells).toHaveLength(1);
  });

  it('uses the default settings when none are given', () => {
    const t = newTable(P(0, 0), P(100, 100));

    expect(t.layer).toBe(DEFAULT_TABLE_DEFAULTS.layer);
    expect(t.cells.length).toBeGreaterThan(1);
  });
});

describe('committing it to the board', () => {
  it('appends it and hands back its id', () => {
    const { board, id } = addBoardTable(emptyBoard(), newTable(P(0, 0), P(30, 6), D));

    expect(id).toBe('table:0');
    expect(board.tables).toHaveLength(1);
  });

  it('appends to the tables already there rather than replacing them', () => {
    // Adding to an empty board cannot tell an append from a replace — the
    // blind spot that let #320 ship.
    const first = addBoardTable(emptyBoard(), newTable(P(0, 0), P(30, 6), D));
    const { board, id } = addBoardTable(first.board, newTable(P(50, 50), P(80, 56), D));

    expect(board.tables).toHaveLength(2);
    expect(id).toBe('table:1');
    expect(board.tables[0]!.cells[0]!.start).toEqual(P(0, 0));
  });

  it('writes it into the file and reads it back', () => {
    const { board } = addBoardTable(emptyBoard(), newTable(P(0, 0), P(30, 6), D));
    const back = readBoard(parse(serializeBoard(board)));

    expect(back.tables).toHaveLength(1);
    expect(back.tables[0]!.columnCount).toBe(2);
    expect(back.tables[0]!.cells).toHaveLength(4);
    expect(back.tables[0]!.cells[1]!.start).toEqual(P(15, 0));
  });

  it('leaves the other board arrays alone', () => {
    const b = emptyBoard();
    const { board } = addBoardTable(b, newTable(P(0, 0), P(30, 6), D));

    expect(board.textBoxes).toBe(b.textBoxes);
    expect(board.shapes).toBe(b.shapes);
  });
});
