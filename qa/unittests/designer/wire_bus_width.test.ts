// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A bus is drawn twice as thick as a wire.
 *
 * `SCH_LINE::GetPenWidth` resolves each layer from its own source:
 *
 *     case LAYER_WIRE: ... m_lastResolvedWidth = GetEffectiveNetClass()->GetWireWidth();
 *     case LAYER_BUS:  ... m_lastResolvedWidth = GetEffectiveNetClass()->GetBusWidth();
 *     default:         ... return schematic->Settings().m_DefaultLineWidth;
 *
 * and `SCH_LINE`'s constructor seeds each from its own default:
 * DEFAULT_WIRE_WIDTH_MILS 6, DEFAULT_BUS_WIDTH_MILS **12**,
 * DEFAULT_LINE_WIDTH_MILS 6 (eeschema/default_values.h).
 *
 * Both used to be drawn at the graphic-line default, so a bus came out
 * wire-thin — even though the wire tool's own preview already drew an
 * in-progress bus at 12 mils, so it visibly thinned when committed.
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
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** Records the line width in force at each stroke, tagged by stroke colour. */
function spy(): { strokes: { colour: string; width: number }[]; ctx: CanvasRenderingContext2D } {
  const strokes: { colour: string; width: number }[] = [];
  const noop = (): void => {};
  const state = { strokeStyle: '', lineWidth: 1 };
  const ctx = {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    fillStyle: '',
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
    setLineDash: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    fill: noop,
    strokeRect: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    fillRect: noop,
    stroke: () => strokes.push({ colour: state.strokeStyle, width: state.lineWidth }),
  };
  return { strokes, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const doc: Schematic = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols)
    (wire (pts (xy 10 10) (xy 40 10)) (stroke (width 0) (type default)) (uuid "w1"))
    (bus  (pts (xy 10 20) (xy 40 20)) (stroke (width 0) (type default)) (uuid "b1"))
    (polyline (pts (xy 10 30) (xy 40 30)) (stroke (width 0) (type default)) (uuid "g1")))`),
);

const widths = (opts: Partial<typeof DEFAULT_RENDER_OPTS> = {}): Map<string, number> => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      1200,
      900,
      undefined,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        showDrawingSheet: false,
        ...opts,
      },
    );
  } finally {
    setVectorText(false);
  }
  // The three lines are the only things on the sheet, each in its own colour.
  const byColour = new Map<string, number>();
  for (const st of s.strokes) if (!byColour.has(st.colour)) byColour.set(st.colour, st.width);
  return byColour;
};

describe('wire, bus and graphic line default widths', () => {
  it('draws a bus twice as thick as a wire', () => {
    const w = widths();
    expect(w.get(KICAD_DEFAULT.wire)).toBe(mmToIU(0.1524)); // 6 mils
    expect(w.get(KICAD_DEFAULT.bus)).toBe(mmToIU(0.3048)); // 12 mils
    expect(w.get(KICAD_DEFAULT.bus)).toBe(w.get(KICAD_DEFAULT.wire)! * 2);
  });

  it('leaves a graphic line on the default line width, not the bus width', () => {
    // LAYER_NOTES takes m_DefaultLineWidth, which is 6 mils like a wire but is
    // a different setting and moves independently of it.
    expect(widths().get(KICAD_DEFAULT.noteLine)).toBe(mmToIU(0.1524));
  });

  it('honours the Editing Options thicknesses', () => {
    const w = widths({ defaultWireIU: mmToIU(0.25), defaultBusIU: mmToIU(0.75) });
    expect(w.get(KICAD_DEFAULT.wire)).toBe(mmToIU(0.25));
    expect(w.get(KICAD_DEFAULT.bus)).toBe(mmToIU(0.75));
  });

  it('and the graphic line still follows defaultPenIU alone', () => {
    const w = widths({ defaultPenIU: mmToIU(0.4), defaultBusIU: mmToIU(0.75) });
    expect(w.get(KICAD_DEFAULT.noteLine)).toBe(mmToIU(0.4));
    expect(w.get(KICAD_DEFAULT.wire)).toBe(mmToIU(0.1524));
  });

  it("still lets an item's own stroke win", () => {
    // `if( m_stroke.GetWidth() > 0 ) return m_stroke.GetWidth();` comes first on
    // every layer.
    const explicit: Schematic = readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (bus (pts (xy 10 20) (xy 40 20)) (stroke (width 1) (type default)) (uuid "b1")))`),
    );
    const s = spy();
    setVectorText(true);
    try {
      renderSchematic(
        s.ctx,
        explicit,
        { scale: 0.0005, offsetX: 0, offsetY: 0 },
        KICAD_DEFAULT,
        1200,
        900,
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
    expect(s.strokes.find((st) => st.colour === KICAD_DEFAULT.bus)?.width).toBe(mmToIU(1));
  });
});
