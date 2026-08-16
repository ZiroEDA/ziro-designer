// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A selected symbol's halo is its pins' own geometry, decorations included.
 *
 * `SCH_PAINTER::draw( const SCH_PIN* )` runs one GRAPHIC_PINSHAPE switch for
 * every layer it is asked for; the shadow pass changes the colour and the width
 * and nothing else (`getLineWidth( aPin, drawingShadows )`). So for an inverted
 * pin the halo gets the bubble and the shortened line:
 *
 *     case GRAPHIC_PINSHAPE::INVERTED:
 *         m_gal->DrawCircle( p0 + dir * radius, radius );
 *         m_gal->DrawLine( p0 + dir * ( diam ), pos );
 *         break;
 *
 * Ours drew the halo from its own idea of a pin — a plain line from root to tip
 * — so it ran straight through the negation bubble, where the pin itself draws
 * no line at all, and never lit the bubble. Selecting a connector full of
 * inverted pins glowed along a row of invisible lines.
 *
 * The assertions compare the halo against the pin as drawn in the same frame
 * rather than against numbers worked out here: "the same geometry" is the
 * contract, and anything derived independently could agree with a bug.
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
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

interface Stroke {
  color: string;
  kind: 'line' | 'arc' | 'rect';
  minX: number;
  maxX: number;
}

/** Records each stroke's colour, what kind of path it was, and its x span. */
function spy(): { strokes: Stroke[]; ctx: CanvasRenderingContext2D } {
  const strokes: Stroke[] = [];
  const noop = (): void => {};
  const st = { color: '', kind: 'line' as Stroke['kind'], minX: Infinity, maxX: -Infinity };
  const note = (x: number): void => {
    if (x < st.minX) st.minX = x;
    if (x > st.maxX) st.maxX = x;
  };
  const flush = (): void => {
    if (st.minX !== Infinity)
      strokes.push({ color: st.color, kind: st.kind, minX: st.minX, maxX: st.maxX });
  };
  const reset = (): void => {
    st.kind = 'line';
    st.minX = Infinity;
    st.maxX = -Infinity;
  };
  const ctx = {
    get strokeStyle() {
      return st.color;
    },
    set strokeStyle(v: string) {
      st.color = v;
    },
    fillStyle: '',
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
    setLineDash: noop,
    closePath: noop,
    rect: noop,
    fill: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    fillRect: noop,
    bezierCurveTo: noop,
    beginPath: reset,
    moveTo: (x: number) => note(x),
    lineTo: (x: number) => note(x),
    arc: (x: number, _y: number, r: number) => {
      st.kind = 'arc';
      note(x - r);
      note(x + r);
    },
    strokeRect: (x: number, _y: number, w: number) => {
      reset();
      st.kind = 'rect';
      note(x);
      note(x + w);
      flush();
    },
    stroke: () => {
      flush();
      reset();
    },
  };
  return { strokes, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/**
 * One symbol, one pin, drawn with the shape the caller names.
 *
 * The reference field is hidden, and the pin's name and number are both "~"
 * (KiCad's "nothing here"), so the only ink on the canvas is the pin's own
 * geometry — which is what these assertions measure.
 * Glyphs are drawn with the context translated to the text anchor, and this spy
 * does not track the transform — a visible field would drop letter-shaped
 * strokes near the origin and swamp every span measured below.
 */
const oneP2in = (shape: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114)
      (lib_symbols
        (symbol "Device:U"
          (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
          (symbol "U_1_1"
            (pin input ${shape} (at -12.7 0 0) (length 5.08)
              (name "~" (effects (font (size 1.27 1.27))))
              (number "~" (effects (font (size 1.27 1.27))))))))
      (symbol (lib_id "Device:U") (at 50 50 0) (unit 1) (uuid "sym-1")
        (property "Reference" "U1" (at 50 45 0)
          (effects (font (size 1.27 1.27)) (hide yes)))))`),
  );

const paint = (doc: Schematic, selection: Set<string>): Stroke[] => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      1400,
      1000,
      selection,
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
  return s.strokes;
};

const HALO = KICAD_DEFAULT.selectionShadow;
const PIN = KICAD_DEFAULT.pin;

/** The union x-span of the line strokes of one colour. */
function lineSpan(strokes: Stroke[], color: string): [number, number] {
  const lines = strokes.filter((s) => s.color === color && s.kind === 'line');
  return [Math.min(...lines.map((s) => s.minX)), Math.max(...lines.map((s) => s.maxX))];
}

const arcs = (strokes: Stroke[], color: string): number =>
  strokes.filter((s) => s.color === color && s.kind === 'arc').length;

describe('the halo of a selected symbol with an inverted pin', () => {
  const drawn = paint(oneP2in('inverted'), new Set(['sym-1']));

  it('has a ring round the negation bubble', () => {
    // The bubble is the pin's only arc, so one is exactly right — and before
    // this, there were none.
    expect(arcs(drawn, HALO)).toBe(arcs(drawn, PIN));
    expect(arcs(drawn, HALO)).toBeGreaterThan(0);
  });

  it('stops the line where the pin stops it, short of the bubble', () => {
    // `DrawLine( p0 + dir * diam, pos )` — the pin draws no line across the
    // bubble, so neither may the halo. Compared against the pin drawn in the
    // same frame: same geometry is the whole contract.
    expect(lineSpan(drawn, HALO)).toEqual(lineSpan(drawn, PIN));
  });

  it('does not run through the bubble', () => {
    // The bug stated on its own, and the thing that was actually visible: a
    // halo drawn root-to-tip covers the bubble's centre, where the pin has
    // nothing but a hole.
    const [lineMin, lineMax] = lineSpan(drawn, HALO);
    const bubble = drawn.filter((s) => s.color === HALO && s.kind === 'arc');
    const centre =
      (Math.min(...bubble.map((s) => s.minX)) + Math.max(...bubble.map((s) => s.maxX))) / 2;

    expect(lineMin <= centre && centre <= lineMax).toBe(false);
  });
});

describe('a hidden pin', () => {
  // The halo follows what is drawn. Nobody draws a hidden pin unless "show
  // hidden pins" is on, so nothing may glow where one is.
  const hidden = readSchematic(
    parse(`(kicad_sch (version 20250114)
      (lib_symbols
        (symbol "Device:U"
          (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
          (symbol "U_1_1"
            (pin power_in line (at -12.7 0 0) (length 5.08) hide
              (name "VCC" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27))))))))
      (symbol (lib_id "Device:U") (at 50 50 0) (unit 1) (uuid "sym-1")
        (property "Reference" "U1" (at 50 45 0)
          (effects (font (size 1.27 1.27)) (hide yes)))))`),
  );

  it('gets no halo when it is not drawn', () => {
    const drawn = paint(hidden, new Set(['sym-1']));
    expect(drawn.filter((s) => s.color === HALO)).toHaveLength(0);
  });
});

describe('the halo of a plain pin', () => {
  const drawn = paint(oneP2in('line'), new Set(['sym-1']));

  it('is the whole line and no ring', () => {
    expect(arcs(drawn, HALO)).toBe(0);
    expect(lineSpan(drawn, HALO)).toEqual(lineSpan(drawn, PIN));
  });
});

describe('the halo of a clock pin', () => {
  // The notch is a polyline inside the body, not an arc; it still has to be
  // there, and the line still runs the full length.
  const drawn = paint(oneP2in('clock'), new Set(['sym-1']));

  it('follows the pin exactly, notch and all', () => {
    expect(lineSpan(drawn, HALO)).toEqual(lineSpan(drawn, PIN));
    expect(drawn.filter((s) => s.color === HALO && s.kind === 'line').length).toBe(
      drawn.filter((s) => s.color === PIN && s.kind === 'line').length,
    );
  });
});
