// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Tables in the board model, and their file format.
 * Counterparts: `PCB_TABLE` / `PCB_TABLECELL` (pcbnew/pcb_table.h,
 * pcb_tablecell.h), `PCB_IO_KICAD_SEXPR::format(PCB_TABLE*)` and
 * `parsePCB_TABLE`.
 *
 * **A cell is a text box.** Upstream serialises one by calling
 * `format(static_cast<PCB_TEXTBOX*>(cell))`, so the whole text box reader and
 * writer are reused here — which is why the text box work had to land first.
 * Two differences the shared formatter enforces: a cell gains `(span cols
 * rows)`, and it *loses* `(border …)` and its `(stroke …)`, because a cell
 * draws no border of its own — the table's `(border …)` and `(separators …)`
 * draw every line.
 *
 * **The stroke is conditional.** Inside both `(border …)` and `(separators …)`
 * the stroke is written only when at least one of that pair's flags is set. A
 * table with both border flags off has no border stroke in the file at all, so
 * writing one unconditionally adds a token KiCad never produces.
 *
 * The fixture is verbatim from KiCad's own
 * `qa/data/pcbnew/issue24525/issue24525.kicad_pcb` — a board-level table, not a
 * footprint-embedded one, so it is the case this reader actually handles.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { head, isList, type SList } from '@ziroeda/sexpr/types.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_TABLE } from '@ziroeda/pcbnew/pcb_table.js';
import { PCB_TABLECELL } from '@ziroeda/pcbnew/pcb_tablecell.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { flatText, writtenNode } from './support/written_node.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** Verbatim from KiCad's issue24525.kicad_pcb, trimmed to two cells. */
const TABLE = `(table
    (column_count 2)
    (uuid "d6f049b1-ff3f-4087-ba96-404a150d1c9b")
    (layer "Edge.Cuts")
    (border (external yes) (header yes) (stroke (width 0.05) (type solid)))
    (separators (rows yes) (cols yes) (stroke (width 0.05) (type solid)))
    (column_widths 18.5 18.5)
    (row_heights 3.5 3.5)
    (cells
      (table_cell "A"
        (start 146.5 75.5) (end 165 79)
        (margins 1.0025 1.0025 1.0025 1.0025)
        (span 1 1)
        (layer "Edge.Cuts")
        (uuid "901ff6c4-c027-48f6-9ba1-2f6bede4ee3c")
        (effects (font (size 1.27 1.27)) (justify left)))
      (table_cell "B"
        (start 165 75.5) (end 183.5 79)
        (margins 1.0025 1.0025 1.0025 1.0025)
        (span 2 1)
        (layer "Edge.Cuts")
        (uuid "901ff6c4-c027-48f6-9ba1-2f6bede4ee3d")
        (effects (font (size 1.27 1.27)) (justify left)))))`;

/** Both flag pairs off, so neither stroke is written. */
const BARE = `(table
    (column_count 1)
    (uuid "aaaaaaaa-0000-0000-0000-000000000009")
    (layer "F.SilkS")
    (border (external no) (header no))
    (separators (rows no) (cols no))
    (column_widths 10)
    (row_heights 5)
    (cells
      (table_cell "only"
        (start 0 0) (end 10 5)
        (margins 1 1 1 1)
        (span 1 1)
        (layer "F.SilkS")
        (uuid "aaaaaaaa-0000-0000-0000-00000000000a")
        (effects (font (size 1 1))))))`;

const read = (...extra: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`);
const tables = (b: BOARD): PCB_TABLE[] =>
  b.Drawings().filter((d) => d.Type() === KICAD_T.PCB_TABLE_T) as PCB_TABLE[];
const only = (src: string): PCB_TABLE => tables(read(src))[0]!;

describe('reading a table (parsePCB_TABLE)', () => {
  it('reads the grid shape', () => {
    const t = only(TABLE);

    expect(t.GetColCount()).toBe(2);
    expect([t.GetColWidth(0), t.GetColWidth(1)]).toEqual([MM(18.5), MM(18.5)]);
    // `GetRowCount()` is `m_cells.size() / m_colCount` (pcb_table.h:125): two
    // cells in two columns are one row.
    expect(t.GetRowCount()).toBe(1);
    expect(t.GetRowHeight(0)).toBe(MM(3.5));
  });

  it('reads the layer and uuid', () => {
    const t = only(TABLE);

    expect(t.GetLayer()).toBe(PCB_LAYER_ID.Edge_Cuts);
    expect(t.m_Uuid).toBe('d6f049b1-ff3f-4087-ba96-404a150d1c9b');
  });

  it('reads the border flags and stroke', () => {
    const t = only(TABLE);

    expect(t.StrokeExternal()).toBe(true);
    expect(t.StrokeHeaderSeparator()).toBe(true);
    expect(t.GetBorderWidth()).toBe(MM(0.05));
    expect(t.GetBorderStyle()).toBe(LINE_STYLE.SOLID);
  });

  it('reads the separator flags and stroke', () => {
    const t = only(TABLE);

    expect(t.StrokeRows()).toBe(true);
    expect(t.StrokeColumns()).toBe(true);
    expect(t.GetSeparatorsWidth()).toBe(MM(0.05));
  });

  it('reads a table whose strokes are absent because both flags are off', () => {
    const t = only(BARE);

    expect(t.StrokeExternal()).toBe(false);
    expect(t.StrokeHeaderSeparator()).toBe(false);
    expect(t.StrokeRows()).toBe(false);
    expect(t.StrokeColumns()).toBe(false);
  });

  it('reads the cells in order', () => {
    expect(
      only(TABLE)
        .GetCells()
        .map((c) => c.GetText()),
    ).toEqual(['A', 'B']);
  });

  it('reads a cell as a text box, geometry and effects included', () => {
    // The whole point of PCB_TABLECELL deriving from PCB_TEXTBOX.
    const c = only(TABLE).GetCells()[0]!;

    expect(c.GetStart()).toEqual({ x: MM(146.5), y: MM(75.5) });
    expect(c.GetEnd()).toEqual({ x: MM(165), y: MM(79) });
    expect(c.GetTextSize()).toEqual({ x: MM(1.27), y: MM(1.27) });
    expect(c.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    expect(c.GetMarginLeft()).toBe(MM(1.0025));
  });

  it('reads the span', () => {
    const [a, b] = only(TABLE).GetCells();

    expect([a!.GetColSpan(), a!.GetRowSpan()]).toEqual([1, 1]);
    expect([b!.GetColSpan(), b!.GetRowSpan()]).toEqual([2, 1]);
  });

  it('does not mistake a cell for a top-level text box', () => {
    expect(
      read(TABLE)
        .Drawings()
        .filter((d) => d.Type() === KICAD_T.PCB_TEXTBOX_T),
    ).toHaveLength(0);
  });
});

describe('round-tripping through the writer', () => {
  it('gives an untouched table back unchanged', () => {
    const t = tables(ParseBoard(FormatBoard(read(TABLE))))[0]!;

    expect(t.GetColCount()).toBe(2);
    expect(t.GetCells()).toHaveLength(2);
    expect(t.GetCells()[1]!.GetColSpan()).toBe(2);
    expect(t.GetBorderWidth()).toBe(MM(0.05));
  });

  it('drops a deleted table', () => {
    const b = read(TABLE, BARE);
    b.Remove(tables(b)[0]!);
    const back = tables(ParseBoard(FormatBoard(b)));

    expect(back).toHaveLength(1);
    expect(back[0]!.GetColCount()).toBe(1);
  });
});

describe('writing a table built from scratch (format( PCB_TABLE* ))', () => {
  /** Two columns, one row, on F.SilkS: border external, separators rows only. */
  const build = (edit: (t: PCB_TABLE) => void = () => {}): { board: BOARD; table: PCB_TABLE } => {
    const board = read();
    const t = new PCB_TABLE(board, MM(0.2));
    t.SetLayer(PCB_LAYER_ID.F_SilkS);
    t.SetColCount(2);
    t.SetStrokeExternal(true);
    t.SetStrokeHeaderSeparator(false);
    t.SetBorderWidth(MM(0.2));
    t.SetStrokeRows(true);
    t.SetStrokeColumns(false);
    t.SetSeparatorsWidth(MM(0.1));
    t.SetSeparatorsStyle(LINE_STYLE.DASH);
    for (const [text, x0, x1] of [
      ['x', 0, 10],
      ['y', 10, 30],
    ] as const) {
      const c = new PCB_TABLECELL(t);
      c.SetText(text);
      c.SetLayer(PCB_LAYER_ID.F_SilkS);
      c.SetStart({ x: MM(x0), y: 0 });
      c.SetEnd({ x: MM(x1), y: MM(5) });
      t.AddCell(c);
    }
    t.SetColWidth(0, MM(10));
    t.SetColWidth(1, MM(20));
    t.SetRowHeight(0, MM(5));
    edit(t);
    board.Add(t);
    return { board, table: t };
  };
  const node = (edit?: (t: PCB_TABLE) => void): SList => writtenNode(build(edit).board, 'table');
  const block = (edit: (t: PCB_TABLE) => void, name: string): SList | undefined =>
    node(edit).items.find((it): it is SList => isList(it) && head(it) === name);
  const hasStroke = (edit: (t: PCB_TABLE) => void, name: string): boolean =>
    !!block(edit, name)?.items.some((it) => isList(it) && head(it) === 'stroke');

  it('writes the grid shape', () => {
    const s = flatText(node());

    expect(s).toContain('(column_count 2)');
    expect(s).toContain('(column_widths 10 20)');
    expect(s).toContain('(row_heights 5)');
  });

  it('writes the border stroke when a border flag is set', () => {
    expect(hasStroke(() => {}, 'border')).toBe(true);
  });

  it('withholds the border stroke when both flags are off', () => {
    // The rule that matters: KiCad writes no stroke there at all.
    expect(hasStroke((t) => t.SetStrokeExternal(false), 'border')).toBe(false);
  });

  it('withholds the separator stroke when both flags are off', () => {
    expect(hasStroke((t) => t.SetStrokeRows(false), 'separators')).toBe(false);
  });

  it('keeps the separator stroke when only one flag is set', () => {
    // Either flag alone is enough — an `and` here would drop it.
    expect(hasStroke(() => {}, 'separators')).toBe(true);
    expect(
      hasStroke((t) => {
        t.SetStrokeRows(false);
        t.SetStrokeColumns(true);
      }, 'separators'),
    ).toBe(true);
  });

  it('writes both flags either way', () => {
    const b = block((t) => {
      t.SetStrokeExternal(false);
      t.SetStrokeHeaderSeparator(true);
    }, 'border')!;
    const words = b.items
      .filter((it): it is SList => isList(it))
      .map((it) => `${head(it)}=${it.items[1]?.kind === 'atom' ? it.items[1].value : ''}`);

    expect(words).toContain('external=no');
    expect(words).toContain('header=yes');
  });

  it('writes cells as table_cell, not gr_text_box', () => {
    const s = flatText(node());

    expect(s).toContain('(table_cell "x"');
    expect(s).not.toContain('gr_text_box');
  });

  it('gives a cell a span but no border of its own', () => {
    // The shared formatter withholds both from a PCB_TABLECELL; the table draws
    // every line.
    const s = flatText(node());

    expect(s).toContain('(span 1 1)');
    expect(s).not.toContain('(border yes)');
  });

  it('round-trips a built table back through the reader', () => {
    const back = tables(ParseBoard(FormatBoard(build().board)))[0]!;

    expect(back.GetColCount()).toBe(2);
    expect(back.GetCells()).toHaveLength(2);
    expect(back.GetCells()[0]!.GetText()).toBe('x');
    expect(back.GetSeparatorsStyle()).toBe(LINE_STYLE.DASH);
  });
});
