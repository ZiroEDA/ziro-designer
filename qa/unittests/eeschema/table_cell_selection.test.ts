// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Table cells wired into the mechanisms that walk item kinds: hit-testing,
 * Delete, move, rotate, copy, the Selection Filter and the message panel.
 *
 * A new selectable kind fails *silently* in whichever mechanism has no arm for
 * it, so this is a sweep rather than a feature test — one case per mechanism the
 * audit on #178 turned up.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { hitTest } from '@ziroeda/eeschema/src/tools/hittest.js';
import { deleteByIds } from '@ziroeda/eeschema/src/tools/mutate.js';
import { moveItems } from '@ziroeda/eeschema/src/tools/move.js';
import { copySelectionText } from '@ziroeda/eeschema/src/tools/clipboard.js';
import {
  defaultSelectionFilter,
  itemPassesFilter,
} from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';
import { getMsgPanelItems } from '@ziroeda/eeschema/src/tools/msg_panel.js';
import { tableCellId } from '@ziroeda/eeschema/src/tools/table_cells.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const mm = (n: number): number => n * 10000;
const TABLE = 't-1';
const cellId = (k: number): string => tableCellId(TABLE, k);

const cell = (x: number, y: number, w: number, h: number, text: string): string =>
  `(table_cell "${text}" (exclude_from_sim no) (at ${x} ${y} 0) (size ${w} ${h})
     (span 1 1) (margins 0.5 0.5 0.5 0.5)
     (effects (font (size 1.27 1.27)) (justify left top)))`;

const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
      (table (column_count 2) (border (external yes) (header yes))
        (separators (rows yes) (cols yes))
        (column_widths 20 20) (row_heights 10 10) (uuid "${TABLE}")
        (cells
          ${cell(10, 10, 20, 10, 'a')}
          ${cell(30, 10, 20, 10, 'b')}
          ${cell(10, 20, 20, 10, 'c')}
          ${cell(30, 20, 20, 10, 'd')})))`),
  );

const INSIDE = { x: mm(15), y: mm(15) };
const libs = new Map();

describe('hit testing', () => {
  it('a click inside the grid lands on the cell, not the table', () => {
    expect(hitTest(doc(), libs, INSIDE, mm(0.1))).toEqual({
      kind: 'tablecell',
      id: cellId(0),
    });
  });

  it('the table still answers for a point just outside every cell', () => {
    // The accuracy band around the grid is the table's border, which is the
    // only part of a table that is not some cell.
    const hit = hitTest(doc(), libs, { x: mm(9.8), y: mm(15) }, mm(1));
    expect(hit).toEqual({ kind: 'table', id: TABLE });
  });
});

describe('Delete', () => {
  it('empties a cell instead of removing it', () => {
    // SCH_EDIT_TOOL: "Clear contents of table cell". Removing it would tear a
    // hole in the grid, which is why upstream does not.
    const d = doc();
    const after = deleteByIds(new Set([cellId(0)])).apply(d);
    expect(after.tables).toHaveLength(1);
    expect(after.tables[0]!.cells).toHaveLength(4);
    expect(after.tables[0]!.cells[0]!.text).toBe('');
    expect(after.tables[0]!.cells[1]!.text).toBe('b');
  });

  it('still deletes the table when the table itself is selected', () => {
    expect(deleteByIds(new Set([TABLE])).apply(doc()).tables).toHaveLength(0);
  });

  it('undoes a cleared cell', () => {
    const d = doc();
    const cmd = deleteByIds(new Set([cellId(0)]));
    const after = cmd.apply(d);
    expect(cmd.invert(d).apply(after).tables[0]!.cells[0]!.text).toBe('a');
  });
});

describe('promotion to the parent table', () => {
  it('moves the whole table when a cell is selected', () => {
    // A cell cannot leave the table it belongs to.
    const d = doc();
    const after = moveItems(new Set([cellId(0)]), { x: mm(5), y: 0 }).apply(d);
    for (const k of [0, 1, 2, 3]) {
      expect(after.tables[0]!.cells[k]!.start.x).toBe(d.tables[0]!.cells[k]!.start.x + mm(5));
    }
  });

  // Rotate/mirror is deliberately NOT asserted here. transformItems has no
  // table arm at all -- rotating a selected table is a no-op today -- so a test
  // comparing "via cell" to "via table" would compare two no-ops and pass
  // whatever the promotion did. The promotion is in place for when tables
  // become transformable; the gap itself is recorded on #178.

  it('copies the whole table when a cell is selected', () => {
    const d = doc();
    expect(copySelectionText(d, new Set([cellId(0)]))).toBe(copySelectionText(d, new Set([TABLE])));
  });

  it('leaves a selection with no cells in it untouched', () => {
    const d = doc();
    expect(
      moveItems(new Set([TABLE]), { x: mm(5), y: 0 }).apply(d).tables[0]!.cells[0]!.start.x,
    ).toBe(d.tables[0]!.cells[0]!.start.x + mm(5));
  });
});

describe('the rest of the sweep', () => {
  it('a cell follows its table through the Selection Filter', () => {
    // There is no cell row in the filter, and one that hid tables while leaving
    // their cells clickable would be worse than no filter.
    const d = doc();
    const off = { ...defaultSelectionFilter(), text: false };
    expect(itemPassesFilter(d, TABLE, off)).toBe(false);
    expect(itemPassesFilter(d, cellId(0), off)).toBe(false);
    expect(itemPassesFilter(d, cellId(0), defaultSelectionFilter())).toBe(true);
  });

  it('the message panel describes the cell, not the table', () => {
    const d = doc();
    const rows = getMsgPanelItems(d, libs, { kind: 'tablecell', id: cellId(3) }, String);
    expect(rows[0]).toEqual({ upper: 'Table Cell', lower: 'Row 2, Column 2' });
    expect(rows[1]).toEqual({ upper: 'Text', lower: 'd' });
  });

  it('says nothing for a cell that is gone', () => {
    expect(getMsgPanelItems(doc(), libs, { kind: 'tablecell', id: cellId(99) }, String)).toEqual(
      [],
    );
  });
});
