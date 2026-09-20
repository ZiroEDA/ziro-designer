// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board-side BOM (`pcbnew/build_BOM_from_board.cpp`).
 *
 * The rules being pinned are the grouping key, the natural sort and the
 * exclusion — the CSV punctuation is only interesting where it is odd.
 */
import { describe, expect, it } from 'vitest';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';
import {
  BuildBomEntriesFromBoard,
  BuildBomTextFromBoard,
} from '@ziroeda/pcbnew/build_BOM_from_board.js';
import { FOOTPRINT, FP_EXCLUDE_FROM_BOM } from '@ziroeda/pcbnew/footprint.js';
import { LIB_ID } from '@ziroeda/common/src/lib_id.js';

const add = (b: BOARD, ref: string, value: string, fpName: string, attrs = 0): FOOTPRINT => {
  const fp = new FOOTPRINT(b);
  fp.SetReference(ref);
  fp.SetValue(value);
  const id = new LIB_ID();
  id.Parse(`Lib:${fpName}`);
  fp.SetFPID(id);
  fp.SetAttributes(attrs);
  b.Add(fp, ADD_MODE.APPEND);
  return fp;
};

describe('the board BOM', () => {
  it('groups on value AND footprint, so one value in two packages stays two lines', () => {
    const b = new BOARD();
    add(b, 'R1', '10k', 'R_0603');
    add(b, 'R2', '10k', 'R_0603');
    add(b, 'R3', '10k', 'R_0805');

    const entries = BuildBomEntriesFromBoard(b);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => [e.footprintName, e.count])).toEqual([
      ['R_0603', 2],
      ['R_0805', 1],
    ]);
  });

  it('sorts references naturally, so R2 comes before R10', () => {
    const b = new BOARD();
    add(b, 'R10', '10k', 'R_0603');
    add(b, 'R2', '10k', 'R_0603');

    expect(BuildBomEntriesFromBoard(b)[0]!.refs).toEqual(['R2', 'R10']);
  });

  it('keys a line on its lowest reference, not on the one found first', () => {
    // C9 is added first, so a line sorted by "first seen" would put the C line
    // after the R line. Sorting happens after the refs are sorted, so the key
    // is C1.
    const b = new BOARD();
    add(b, 'C9', '100n', 'C_0402');
    add(b, 'R1', '10k', 'R_0603');
    add(b, 'C1', '100n', 'C_0402');

    expect(BuildBomEntriesFromBoard(b).map((e) => e.refs[0])).toEqual(['C1', 'R1']);
  });

  it('skips a footprint excluded from the BOM entirely, line and count', () => {
    const b = new BOARD();
    add(b, 'R1', '10k', 'R_0603');
    add(b, 'H1', 'MountingHole', 'MH_3mm', FP_EXCLUDE_FROM_BOM);

    const entries = BuildBomEntriesFromBoard(b);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.count).toBe(1);
  });

  it('writes the six-column header and a row whose last three fields are empty', () => {
    const b = new BOARD();
    add(b, 'R2', '10k', 'R_0603');
    add(b, 'R1', '10k', 'R_0603');

    const text = BuildBomTextFromBoard(b);
    const lines = text.split('\n');

    expect(lines[0]).toBe(
      '"Id";"Designator";"Footprint";"Quantity";"Designation";"Supplier and ref";',
    );
    // Upstream's trailing `;;;` — "Supplier and ref" is a column the board
    // cannot know, left for the user's spreadsheet.
    expect(lines[1]).toBe('1;"R1, R2";"R_0603";2;"10k";;;');
  });

  it('numbers the rows from one, in sorted order', () => {
    const b = new BOARD();
    add(b, 'R1', '10k', 'R_0603');
    add(b, 'C1', '100n', 'C_0402');

    const lines = BuildBomTextFromBoard(b).split('\n');

    expect(lines[1]!.startsWith('1;"C1"')).toBe(true);
    expect(lines[2]!.startsWith('2;"R1"')).toBe(true);
  });
});
