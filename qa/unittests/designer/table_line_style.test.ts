// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How a table's grid lines are drawn. Counterpart: `SCH_PAINTER::draw( const
 * SCH_TABLE* )` over `SCH_TABLE::DrawBorders`.
 *
 * The painter's three fallbacks:
 *
 *     if( lineWidth == 0 )                   lineWidth = GetDefaultPenWidth();
 *     if( color == COLOR4D::UNSPECIFIED )    color     = GetLayerColor( LAYER_NOTES );
 *     if( lineStyle == LINE_STYLE::DEFAULT ) lineStyle = LINE_STYLE::SOLID;
 *
 * Ours got the two defaults right and then ignored everything else: an explicit
 * stroke colour and line style were dropped on the floor, a *negative* width —
 * which is how the properties dialog stores "no line" — was treated as another
 * way of asking for the default, and the header separator was drawn with the
 * separators stroke.
 *
 * That last one is the rule worth stating twice. `DrawBorders` picks the stroke
 * per line, and the header row's lines belong to the **border**:
 *
 *     if( row == 0 && StrokeHeaderSeparator() ) stroke = GetBorderStroke();
 *     else if( StrokeRows() )                   stroke = GetSeparatorsStroke();
 *     else                                      continue;
 *
 * — which is also why the column separators are walked cell by cell rather than
 * drawn as one line down the table: the piece inside the header row is a
 * different stroke from the pieces below it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { makeTable } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import type { Schematic, SchTable, Stroke } from '@ziroeda/eeschema/src/types.js';

interface Line {
  a: { x: number; y: number };
  b: { x: number; y: number };
  width: number;
  color: string;
  dashed: boolean;
}

/** Records every stroked segment with the pen that drew it. */
function spy(): { lines: Line[]; ctx: CanvasRenderingContext2D } {
  const lines: Line[] = [];
  const noop = (): void => {};
  let pen: { x: number; y: number } | null = null;
  let pending: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  let dash: number[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: (d: number[]) => {
      dash = d;
    },
    beginPath: () => {
      pending = [];
      pen = null;
    },
    moveTo: (x: number, y: number) => {
      pen = { x, y };
    },
    lineTo: (x: number, y: number) => {
      if (pen) pending.push({ a: pen, b: { x, y } });
      pen = { x, y };
    },
    closePath: noop,
    rect: noop,
    arc: noop,
    ellipse: noop,
    bezierCurveTo: noop,
    fill: noop,
    fillText: noop,
    measureText: () => ({ width: 0 }),
    drawImage: noop,
    clip: noop,
    stroke: () => {
      for (const s of pending)
        lines.push({ ...s, width: ctx.lineWidth, color: ctx.strokeStyle, dashed: dash.length > 0 });
      pending = [];
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      lines.push({
        a: { x, y },
        b: { x: x + w, y: y + h },
        width: ctx.lineWidth,
        color: ctx.strokeStyle,
        dashed: dash.length > 0,
      });
    },
    fillRect: noop,
  };
  return { lines, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const EMPTY = `(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`;

/** A 3x3 table at a known place, with the strokes under test. */
const docWith = (patch: Partial<SchTable>): Schematic => {
  const base = readSchematic(parse(EMPTY));
  const t = makeTable({ x: mmToIU(20), y: mmToIU(20) }, 3, 3);
  return { ...base, tables: [{ ...t, ...patch }] };
};

/** Only the table's own lines: the sheet frame strokes at the origin too. */
const inTable = (l: Line): boolean =>
  Math.min(l.a.x, l.b.x) >= mmToIU(19) && Math.min(l.a.y, l.b.y) >= mmToIU(19);

const paint = (doc: Schematic): Line[] => {
  const s = spy();
  /*
   * Measured through the GEOMETRY path, which is what these assertions are
   * about: which width the table CHOOSES.
   *
   * The screen path quantises every stroke to a whole number of device pixels,
   * the way KiCad's GAL does (`roundr( w / u_worldPixelSize, 1.0 )`,
   * `common/gal/shaders/kicad_vert.glsl:70`), so a 0.5 mm border and a 0.6 mm
   * one can land on the same pixel count and the choice becomes unreadable.
   * `setVectorText` is the mode the SVG, DXF and PostScript plotters render in
   * — no screen, no pixels, no floor — and it is the one place the model's own
   * numbers reach a canvas unchanged.
   */
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      1400,
      1000,
      undefined,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        showDrawingSheet: false,
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.lines.filter(inTable);
};

const horizontal = (ls: Line[]): Line[] => ls.filter((l) => l.a.y === l.b.y && l.a.x !== l.b.x);
const vertical = (ls: Line[]): Line[] => ls.filter((l) => l.a.x === l.b.x && l.a.y !== l.b.y);

/** The default pen: DEFAULT_LINE_WIDTH_MILS = 6 mils. */
const DEFAULT_PEN = mmToIU(0.1524);
/** LAYER_NOTES in the default theme. */
const NOTES = KICAD_DEFAULT.noteLine;

describe('the fallbacks', () => {
  it('a zero width draws at the default pen width', () => {
    // `if( lineWidth == 0 ) lineWidth = m_schSettings.GetDefaultPenWidth();`
    const lines = paint(docWith({}));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.width).toBeCloseTo(DEFAULT_PEN, 0);
  });

  it('and an unset colour draws in the notes-layer colour', () => {
    // `if( color == COLOR4D::UNSPECIFIED ) color = GetLayerColor( LAYER_NOTES );`
    for (const l of paint(docWith({}))) expect(l.color).toBe(NOTES);
  });

  it('with no dash, since a default line style means solid', () => {
    for (const l of paint(docWith({}))) expect(l.dashed).toBe(false);
  });
});

describe('an explicit stroke', () => {
  const red: Stroke = { width: mmToIU(0.5), type: 'dash', color: [255, 0, 0, 1] };

  it('is used for the width, not just the default', () => {
    const lines = paint(docWith({ borderStroke: red, separatorsStroke: red }));
    for (const l of lines) expect(l.width).toBe(mmToIU(0.5));
  });

  it('for the colour', () => {
    const lines = paint(docWith({ borderStroke: red, separatorsStroke: red }));
    for (const l of lines) expect(l.color).toBe('rgba(255, 0, 0, 1)');
  });

  it('and for the line style', () => {
    const lines = paint(docWith({ borderStroke: red, separatorsStroke: red }));
    expect(lines.every((l) => l.dashed)).toBe(true);
  });
});

describe('the header separator', () => {
  // A fat border and a thin separator make it obvious which stroke drew what.
  const border: Stroke = { width: mmToIU(0.6), type: 'solid' };
  const seps: Stroke = { width: mmToIU(0.1), type: 'solid' };
  const doc = () => docWith({ borderStroke: border, separatorsStroke: seps });

  it('takes the border stroke, not the separators stroke', () => {
    // `if( row == 0 && StrokeHeaderSeparator() ) stroke = GetBorderStroke();`
    const rows = horizontal(paint(doc())).filter((l) => l.a.y > mmToIU(20));
    // Two internal row lines in a 3-row table; the upper one is the header.
    const byY = [...rows].sort((a, b) => a.a.y - b.a.y);
    expect(byY.length).toBeGreaterThanOrEqual(2);
    expect(byY[0]!.width).toBe(mmToIU(0.6));
    expect(byY[1]!.width).toBe(mmToIU(0.1));
  });

  it('and so do the column ticks inside the header row', () => {
    // The column separators are walked cell by cell for exactly this reason.
    const cols = vertical(paint(doc()));
    const top = cols.filter((l) => Math.min(l.a.y, l.b.y) === mmToIU(20));
    expect(top.length).toBeGreaterThan(0);
    for (const l of top) expect(l.width).toBe(mmToIU(0.6));
  });

  it('is drawn even when the row lines are switched off', () => {
    // `StrokeHeaderSeparator()` is checked before `StrokeRows()`, so a table
    // with a header and no row lines still gets the one line under its header.
    const lines = horizontal(
      paint(
        docWith({
          borderHeader: true,
          separatorRows: false,
          borderStroke: border,
          separatorsStroke: seps,
        }),
      ),
    ).filter((l) => l.a.y > mmToIU(20));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.width).toBe(mmToIU(0.6));
  });
});

describe('a line switched off', () => {
  it('draws no external border when the border width is −1', () => {
    // `if( StrokeExternal() && GetBorderStroke().GetWidth() >= 0 )` — and −1 is
    // what the properties dialog stores for "no border". Treating it as another
    // zero drew the border at the default width instead of not at all.
    const off = paint(docWith({ borderStroke: { width: -1, type: 'solid' }, borderHeader: false }));
    const on = paint(docWith({ borderExternal: true, borderHeader: false }));
    expect(off.length).toBeLessThan(on.length);
    // Nothing at the table's outer edge.
    expect(off.some((l) => l.a.x === mmToIU(20) && l.a.y === mmToIU(20) && l.b.x > l.a.x)).toBe(
      false,
    );
  });

  it('and no separators when the separator width is −1', () => {
    const lines = paint(
      docWith({
        borderExternal: false,
        borderHeader: false,
        separatorsStroke: { width: -1, type: 'solid' },
      }),
    );
    expect(lines).toEqual([]);
  });
});

describe('what is drawn at all', () => {
  it('nothing when every line is switched off', () => {
    expect(
      paint(
        docWith({
          borderExternal: false,
          borderHeader: false,
          separatorRows: false,
          separatorCols: false,
        }),
      ),
    ).toEqual([]);
  });

  it('and the external border alone when only it is on', () => {
    const lines = paint(
      docWith({
        borderExternal: true,
        borderHeader: false,
        separatorRows: false,
        separatorCols: false,
      }),
    );
    expect(lines).toHaveLength(1); // one strokeRect
  });
});
