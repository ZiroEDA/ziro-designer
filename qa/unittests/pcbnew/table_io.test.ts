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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard, buildTableNode } from '@ziroeda/pcbnew/src/write-board.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board, PcbTable } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

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

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );
const only = (src: string): PcbTable => read(src).tables[0]!;

describe('reading a table', () => {
  it('reads the grid shape', () => {
    const t = only(TABLE);

    expect(t.columnCount).toBe(2);
    expect(t.columnWidths).toEqual([MM(18.5), MM(18.5)]);
    expect(t.rowHeights).toEqual([MM(3.5), MM(3.5)]);
  });

  it('reads the layer and uuid', () => {
    const t = only(TABLE);

    expect(t.layer).toBe('Edge.Cuts');
    expect(t.uuid).toBe('d6f049b1-ff3f-4087-ba96-404a150d1c9b');
  });

  it('reads the border flags and stroke', () => {
    const t = only(TABLE);

    expect(t.borderExternal).toBe(true);
    expect(t.borderHeader).toBe(true);
    expect(t.borderWidth).toBe(MM(0.05));
    expect(t.borderStyle).toBe('solid');
  });

  it('reads the separator flags and stroke', () => {
    const t = only(TABLE);

    expect(t.separatorRows).toBe(true);
    expect(t.separatorCols).toBe(true);
    expect(t.separatorWidth).toBe(MM(0.05));
  });

  it('reads a table whose strokes are absent because both flags are off', () => {
    const t = only(BARE);

    expect(t.borderExternal).toBe(false);
    expect(t.borderHeader).toBe(false);
    expect(t.borderWidth).toBeUndefined();
    expect(t.separatorWidth).toBeUndefined();
  });

  it('reads the cells in order', () => {
    const t = only(TABLE);

    expect(t.cells).toHaveLength(2);
    expect(t.cells.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('reads a cell as a text box, geometry and effects included', () => {
    // The whole point of PCB_TABLECELL deriving from PCB_TEXTBOX.
    const c = only(TABLE).cells[0]!;

    expect(c.start).toEqual({ x: MM(146.5), y: MM(75.5) });
    expect(c.end).toEqual({ x: MM(165), y: MM(79) });
    expect(c.size).toEqual({ x: MM(1.27), y: MM(1.27) });
    expect(c.justify).toEqual(['left']);
    expect(c.margins.left).toBe(MM(1.0025));
  });

  it('reads the span, defaulting to one by one', () => {
    const t = only(TABLE);

    expect([t.cells[0]!.colSpan, t.cells[0]!.rowSpan]).toEqual([1, 1]);
    expect([t.cells[1]!.colSpan, t.cells[1]!.rowSpan]).toEqual([2, 1]);
  });

  it('does not mistake a cell for a top-level text box', () => {
    expect(read(TABLE).textBoxes).toHaveLength(0);
  });
});

describe('round-tripping through the writer', () => {
  it('gives an untouched table back unchanged', () => {
    const back = readBoard(parse(serializeBoard(read(TABLE))));
    const t = back.tables[0]!;

    expect(t.columnCount).toBe(2);
    expect(t.cells).toHaveLength(2);
    expect(t.cells[1]!.colSpan).toBe(2);
    expect(t.borderWidth).toBe(MM(0.05));
  });

  it('keeps a table when other items are edited around it', () => {
    const b = read(TABLE);
    b.texts.push({
      kind: 'user',
      text: 'hello',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.SilkS',
      size: { x: MM(1), y: MM(1) },
      source: { kind: 'list', items: [] },
    });
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.tables).toHaveLength(1);
    expect(back.texts.some((t) => t.text === 'hello')).toBe(true);
  });

  it('drops a deleted table', () => {
    const b = read(TABLE, BARE);
    b.tables.splice(0, 1);
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.tables).toHaveLength(1);
    expect(back.tables[0]!.columnCount).toBe(1);
  });
});

describe('building a table from scratch', () => {
  const base = (over: Partial<PcbTable> = {}): PcbTable => ({
    columnCount: 2,
    layer: 'F.SilkS',
    borderExternal: true,
    borderHeader: false,
    borderWidth: MM(0.2),
    borderStyle: 'solid',
    separatorRows: true,
    separatorCols: false,
    separatorWidth: MM(0.1),
    separatorStyle: 'dash',
    columnWidths: [MM(10), MM(20)],
    rowHeights: [MM(5)],
    cells: [
      {
        text: 'x',
        start: { x: 0, y: 0 },
        end: { x: MM(10), y: MM(5) },
        margins: { left: MM(1), top: MM(1), right: MM(1), bottom: MM(1) },
        layer: 'F.SilkS',
        size: { x: MM(1), y: MM(1) },
        border: true,
        colSpan: 1,
        rowSpan: 1,
        source: { kind: 'list', items: [] },
      },
    ],
    source: { kind: 'list', items: [] },
    ...over,
  });
  const text = (t: PcbTable): string => serialize(buildTableNode(t));
  /** The named child block of the built node, so assertions survive formatting. */
  const block = (t: PcbTable, name: string): SList | undefined => {
    const node = buildTableNode(t);
    return node.items.find((it): it is SList => isList(it) && head(it) === name);
  };
  /** Whether that block carries a `(stroke …)`. */
  const hasStroke = (t: PcbTable, name: string): boolean => {
    const b = block(t, name);
    return !!b?.items.some((it) => isList(it) && head(it) === 'stroke');
  };

  it('writes the grid shape', () => {
    const s = text(base());

    expect(s).toContain('(column_count 2)');
    expect(s).toContain('(column_widths 10 20)');
    expect(s).toContain('(row_heights 5)');
  });

  it('writes the border stroke when a border flag is set', () => {
    expect(hasStroke(base(), 'border')).toBe(true);
  });

  it('withholds the border stroke when both flags are off', () => {
    // The rule that matters: KiCad writes no stroke there at all.
    expect(hasStroke(base({ borderExternal: false, borderHeader: false }), 'border')).toBe(false);
  });

  it('withholds the separator stroke when both flags are off', () => {
    expect(hasStroke(base({ separatorRows: false, separatorCols: false }), 'separators')).toBe(
      false,
    );
  });

  it('keeps the separator stroke when only one flag is set', () => {
    // Either flag alone is enough — an `and` here would drop it.
    expect(hasStroke(base({ separatorRows: true, separatorCols: false }), 'separators')).toBe(true);
    expect(hasStroke(base({ separatorRows: false, separatorCols: true }), 'separators')).toBe(true);
  });

  it('writes both flags either way', () => {
    const b = block(base({ borderExternal: false, borderHeader: true }), 'border')!;
    const words = b.items
      .filter((it): it is SList => isList(it))
      .map((it) => `${head(it)}=${it.items[1]?.kind === 'atom' ? it.items[1].value : ''}`);

    expect(words).toContain('external=no');
    expect(words).toContain('header=yes');
  });

  it('writes cells as table_cell, not gr_text_box', () => {
    const s = text(base());

    expect(s).toContain('(table_cell "x"');
    expect(s).not.toContain('gr_text_box');
  });

  it('gives a cell a span but no border of its own', () => {
    // The shared formatter withholds both from a PCB_TABLECELL; the table draws
    // every line.
    const s = text(base());

    expect(s).toContain('(span 1 1)');
    expect(s).not.toContain('(border yes)');
    expect(s).not.toContain('(type solid) (type solid)');
  });

  it('round-trips a built table back through the reader', () => {
    const b = read();
    b.tables.push(base({ uuid: 'abc' }));
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.tables).toHaveLength(1);
    expect(back.tables[0]!.columnCount).toBe(2);
    expect(back.tables[0]!.cells).toHaveLength(1);
    expect(back.tables[0]!.cells[0]!.text).toBe('x');
    expect(back.tables[0]!.separatorStyle).toBe('dash');
  });
});
