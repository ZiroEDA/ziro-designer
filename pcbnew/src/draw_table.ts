// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a table.
 * Counterpart: `DRAWING_TOOL::DrawTable` (pcbnew/tools/drawing_tool.cpp) and
 * `PCB_TABLE`'s constructor.
 *
 * Two clicks: the first fixes the top-left corner, the second finishes. Between
 * them the grid *resizes*, and the second click opens the properties dialog —
 * cancelling there discards the table, exactly as the text box tool works.
 *
 * ## How many rows and columns a drag produces
 *
 * A new column costs **15 font-widths** of horizontal drag and a new row
 * **3 font-heights** of vertical drag, both by truncating integer division and
 * both floored at one. So a small drag gives a 1x1 table rather than nothing,
 * and the grid grows in visible steps rather than continuously.
 *
 * Cell size is then the drag divided by that count, but never below **5
 * font-widths** by **3 font-heights** — which is what stops a fast drag
 * producing a row of slivers. The result is finally snapped to the grid pitch,
 * so cells line up with everything else on the board.
 *
 * Those four constants are upstream's. The tests state them as literals: a test
 * that recomputed them from the same expression would pass whatever they were
 * changed to.
 */
import { legacyTextMargin } from './draw_textbox.js';
import type { PcbTable, PcbTableCell, StrokeType } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Board Setup values a freshly-drawn table takes. */
export interface TableDefaults {
  layer: string;
  /** `BOARD_DESIGN_SETTINGS::GetTextSize` for the layer. */
  fontWidth: number;
  fontHeight: number;
  textThickness: number;
  /** `GetLineThickness(layer)`: both strokes start from it. */
  lineThickness: number;
  /** The snapping pitch cell sizes are rounded to. */
  gridPitch: number;
}

const MM = (v: number): number => Math.round(v * 1e6);

export const DEFAULT_TABLE_DEFAULTS: TableDefaults = {
  layer: 'F.SilkS',
  fontWidth: MM(1),
  fontHeight: MM(1),
  textThickness: MM(0.15),
  lineThickness: MM(0.1),
  gridPitch: MM(0.5),
};

/** Horizontal drag needed per extra column, in font widths. */
export const COL_STEP_IN_FONT_WIDTHS = 15;
/** Vertical drag needed per extra row, in font heights. */
export const ROW_STEP_IN_FONT_HEIGHTS = 3;
/** Smallest cell, in font widths and font heights. */
export const MIN_CELL_IN_FONT_WIDTHS = 5;
export const MIN_CELL_IN_FONT_HEIGHTS = 3;

/** The grid shape a drag of this size asks for. */
export function tableGridSize(
  requested: Vec2,
  d: TableDefaults,
): { colCount: number; rowCount: number } {
  // C++ integer division truncates toward zero, so a backwards drag floors to
  // one rather than going negative.
  return {
    colCount: Math.max(1, Math.trunc(requested.x / (d.fontWidth * COL_STEP_IN_FONT_WIDTHS))),
    rowCount: Math.max(1, Math.trunc(requested.y / (d.fontHeight * ROW_STEP_IN_FONT_HEIGHTS))),
  };
}

/** The cell size for that grid, floored at the minimum and snapped to the pitch. */
export function tableCellSize(
  requested: Vec2,
  colCount: number,
  rowCount: number,
  d: TableDefaults,
): Vec2 {
  const w = Math.max(d.fontWidth * MIN_CELL_IN_FONT_WIDTHS, Math.trunc(requested.x / colCount));
  const h = Math.max(d.fontHeight * MIN_CELL_IN_FONT_HEIGHTS, Math.trunc(requested.y / rowCount));
  const snap = (v: number, pitch: number): number =>
    pitch > 0 ? Math.round(v / pitch) * pitch : v;
  return { x: snap(w, d.gridPitch), y: snap(h, d.gridPitch) };
}

/**
 * The table a drag from `origin` to `cursor` describes.
 *
 * Every cell starts empty: the properties dialog is where the text is typed,
 * and cancelling it throws the whole table away. All four stroke flags start on
 * from `PCB_TABLE`'s constructor, both strokes at the layer's line width.
 */
export function newTable(
  origin: Vec2,
  cursor: Vec2,
  defaults: TableDefaults = DEFAULT_TABLE_DEFAULTS,
): Omit<PcbTable, 'source'> {
  const requested = { x: cursor.x - origin.x, y: cursor.y - origin.y };
  const { colCount, rowCount } = tableGridSize(requested, defaults);
  const cellSize = tableCellSize(requested, colCount, rowCount, defaults);
  const margin = legacyTextMargin(defaults.fontHeight, defaults.lineThickness);

  const cells: PcbTableCell[] = [];
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const start = { x: origin.x + col * cellSize.x, y: origin.y + row * cellSize.y };
      cells.push({
        text: '',
        start,
        end: { x: start.x + cellSize.x, y: start.y + cellSize.y },
        margins: { left: margin, top: margin, right: margin, bottom: margin },
        layer: defaults.layer,
        size: { x: defaults.fontWidth, y: defaults.fontHeight },
        thickness: defaults.textThickness,
        // PCB_TEXTBOX's ctor is LEFT/CENTER; centre is the unwritten default.
        justify: ['left'],
        border: true,
        colSpan: 1,
        rowSpan: 1,
        source: { kind: 'list', items: [] },
      });
    }
  }

  const style: StrokeType = 'solid';
  return {
    columnCount: colCount,
    layer: defaults.layer,
    // PCB_TABLE's ctor turns every stroke flag on.
    borderExternal: true,
    borderHeader: true,
    borderWidth: defaults.lineThickness,
    borderStyle: style,
    separatorRows: true,
    separatorCols: true,
    separatorWidth: defaults.lineThickness,
    separatorStyle: style,
    columnWidths: Array.from({ length: colCount }, () => cellSize.x),
    rowHeights: Array.from({ length: rowCount }, () => cellSize.y),
    cells,
  };
}
