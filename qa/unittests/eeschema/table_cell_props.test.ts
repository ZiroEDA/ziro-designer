// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLECELL_PROPERTIES`, and the rule the whole dialog turns on: a
 * property the selected cells disagree on is indeterminate, and an
 * indeterminate property is left alone rather than flattened.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  applyCellProps,
  cellPropsFromSelection,
  hAlignOf,
  vAlignOf,
} from '@ziroeda/eeschema/src/tools/table_cell_props.js';
import type { SchTableCell, Schematic } from '@ziroeda/eeschema/src/types.js';

const cell = (text: string, effects: string, extra = ''): string =>
  `(table_cell "${text}" (exclude_from_sim no) (at 10 10 0) (size 20 10)
     (span 1 1) (margins 0.5 0.5 0.5 0.5) ${extra} ${effects})`;

const doc = (a: string, b: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
      (table (column_count 2) (border (external yes) (header yes))
        (separators (rows yes) (cols yes))
        (column_widths 20 20) (row_heights 10) (uuid "t-1")
        (cells ${a} ${b})))`),
  );

const cells = (a: string, b: string): readonly SchTableCell[] => doc(a, b).tables[0]!.cells;

const PLAIN = '(effects (font (size 1.27 1.27)) (justify left top))';
const BOLD = '(effects (font (size 1.27 1.27) bold) (justify left top))';
const BIG = '(effects (font (size 2.54 2.54)) (justify left top))';
const RIGHT = '(effects (font (size 1.27 1.27)) (justify right bottom))';

describe('what the dialog shows', () => {
  it('shows a value the cells agree on', () => {
    const p = cellPropsFromSelection(cells(cell('a', BOLD), cell('b', BOLD)));
    expect(p.bold).toBe(true);
    expect(p.textSize).toBe(12700);
  });

  it('shows indeterminate for a value they disagree on', () => {
    const p = cellPropsFromSelection(cells(cell('a', BOLD), cell('b', PLAIN)));
    expect(p.bold).toBeUndefined();
    expect(p.italic).toBe(false); // this one they do agree on
  });

  it('separates the two justification axes', () => {
    // A cell agreeing on horizontal but not vertical must leave only the
    // vertical indeterminate.
    const p = cellPropsFromSelection(
      cells(cell('a', '(effects (font (size 1.27 1.27)) (justify left top))'), cell('b', PLAIN)),
    );
    expect(p.hAlign).toBe('left');
    const q = cellPropsFromSelection(cells(cell('a', PLAIN), cell('b', RIGHT)));
    expect(q.hAlign).toBeUndefined();
    expect(q.vAlign).toBeUndefined();
  });

  it('reads a centred axis from the absence of a token', () => {
    // KiCad writes no token for a centred axis, so "no left and no right" is
    // centre rather than unset.
    expect(hAlignOf({ hidden: false, justify: ['top'] })).toBe('center');
    expect(vAlignOf({ hidden: false, justify: ['left'] })).toBe('center');
    expect(hAlignOf(undefined)).toBe('center');
  });

  it('compares fills by value, not by identity', () => {
    // Two equal colours are different arrays; comparing by identity would call
    // every selection indeterminate.
    const withFill = (c: string): string => cell(c, PLAIN, '(fill (type color) (color 1 2 3 1))');
    const p = cellPropsFromSelection(cells(withFill('a'), withFill('b')));
    expect(p.fill?.color).toEqual([1, 2, 3, 1]);
  });

  it('shows nothing for an empty selection', () => {
    expect(cellPropsFromSelection([]).bold).toBeUndefined();
  });
});

describe('what OK writes', () => {
  it('leaves an indeterminate property as each cell had it', () => {
    // The rule the dialog exists for. Writing back the displayed value would
    // make every selected cell bold because one of them already was.
    const [a, b] = cells(cell('a', BOLD), cell('b', PLAIN));
    const props = { italic: true }; // bold is absent = indeterminate
    expect(applyCellProps(a!, props).effects?.bold).toBe(true);
    expect(applyCellProps(b!, props).effects?.bold ?? false).toBe(false);
    expect(applyCellProps(a!, props).effects?.italic).toBe(true);
    expect(applyCellProps(b!, props).effects?.italic).toBe(true);
  });

  it('keeps each cell’s own size when the size is indeterminate', () => {
    const [a, b] = cells(cell('a', BIG), cell('b', PLAIN));
    const props = { bold: true };
    expect(applyCellProps(a!, props).effects?.fontSize).toEqual([25400, 25400]);
    expect(applyCellProps(b!, props).effects?.fontSize).toEqual([12700, 12700]);
  });

  it('writes one number to both axes', () => {
    const [a] = cells(cell('a', PLAIN), cell('b', PLAIN));
    expect(applyCellProps(a!, { textSize: 20000 }).effects?.fontSize).toEqual([20000, 20000]);
  });

  it('drops the token for an axis set to centre', () => {
    const [a] = cells(cell('a', PLAIN), cell('b', PLAIN));
    const out = applyCellProps(a!, { hAlign: 'center' });
    expect(out.effects?.justify).toEqual(['top']);
  });

  it('keeps the other axis when only one is given', () => {
    const [a] = cells(cell('a', RIGHT), cell('b', RIGHT));
    expect(applyCellProps(a!, { hAlign: 'left' }).effects?.justify).toEqual(['left', 'bottom']);
  });

  it('leaves the effects object alone when nothing textual was set', () => {
    const [a] = cells(cell('a', PLAIN), cell('b', PLAIN));
    expect(applyCellProps(a!, { marginLeft: 100 }).effects).toBe(a!.effects);
  });

  it('fills in the other three margins from the cell', () => {
    const [a] = cells(cell('a', PLAIN), cell('b', PLAIN));
    const out = applyCellProps(a!, { marginLeft: 100 });
    expect(out.margins).toEqual({ left: 100, top: 5000, right: 5000, bottom: 5000 });
  });

  it('leaves the margins alone when none were given', () => {
    const [a] = cells(cell('a', PLAIN), cell('b', PLAIN));
    expect(applyCellProps(a!, { bold: true }).margins).toBe(a!.margins);
  });

  it('writes the text to every cell, as upstream does', () => {
    // The box can only show one string, so upstream writes it unconditionally.
    // Reproduced deliberately; the caller decides whether to offer the box.
    const [a, b] = cells(cell('a', PLAIN), cell('b', PLAIN));
    expect(applyCellProps(a!, { text: 'x' }).text).toBe('x');
    expect(applyCellProps(b!, { text: 'x' }).text).toBe('x');
  });

  it('reaches the file', () => {
    const d = doc(cell('a', PLAIN), cell('b', PLAIN));
    const t = d.tables[0]!;
    const next = { ...t, cells: t.cells.map((c) => applyCellProps(c, { bold: true })) };
    expect(serializeSchematic({ ...d, tables: [next] })).toContain('bold');
  });
});
