// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A text glow sits exactly under the glyphs it belongs to.
 *
 * Stroke text is not laid out where you ask for it. `FONT::getLinePositions`
 * shifts the whole run by a fraction of the pen:
 *
 *     if( IsStroke() )
 *     {
 *         // Fudge factors to match 6.0 positioning
 *         offset.x += aAttrs.m_StrokeWidth / 1.52;
 *         offset.y -= aAttrs.m_StrokeWidth * 0.052;
 *     }
 *
 * so a run stroked with a fatter pen lands somewhere else. The selection glow
 * *is* the same run with a fatter pen — `attrs.m_StrokeWidth += getShadowWidth()`
 * — and upstream takes the resulting shift straight back out, saying so:
 *
 *     // New text stroking has width dependent offset but we need to center the
 *     // shadow on the stroke.  NB this offset is in font.cpp also.
 *     int fudge = KiROUND( getShadowWidth( … ) / 1.52 );
 *     if( m_Halign == LEFT  && m_Angle == ANGLE_0 ) text_offset.x -= fudge;
 *     else if( m_Halign == RIGHT && m_Angle == ANGLE_0 ) text_offset.x += fudge;
 *
 * We did neither half: the glow was stroked with the shadow width *instead of*
 * the pen plus it, and nothing compensated. So every left-justified label's glow
 * sat to the right of its text, by more the further out you zoomed — the shift
 * is a screen-constant term, so it grows in world units as the scale shrinks.
 *
 * The glow and the text are the same path, so along the reading direction their
 * recorded geometry has to be identical to the last unit. Across it upstream
 * compensates nothing, and matching upstream means keeping that.
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

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * The union box of every stroke of one colour, in canvas space.
 *
 * The transform is tracked rather than stubbed: glyphs are drawn with the
 * context translated to the run's anchor, so a spy that ignores `translate`
 * measures every run at the origin and cannot see a shift at all.
 */
function spy(): { boxes: Map<string, Box>; ctx: CanvasRenderingContext2D } {
  const boxes = new Map<string, Box>();
  const noop = (): void => {};
  const st = { color: '', m: IDENT, stack: [] as Mat[] };
  const note = (x: number, y: number): void => {
    const wx = st.m[0] * x + st.m[2] * y + st.m[4];
    const wy = st.m[1] * x + st.m[3] * y + st.m[5];
    const b = boxes.get(st.color);
    if (!b) boxes.set(st.color, { minX: wx, maxX: wx, minY: wy, maxY: wy });
    else {
      b.minX = Math.min(b.minX, wx);
      b.maxX = Math.max(b.maxX, wx);
      b.minY = Math.min(b.minY, wy);
      b.maxY = Math.max(b.maxY, wy);
    }
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
    setLineDash: noop,
    closePath: noop,
    rect: noop,
    fill: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    stroke: noop,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      st.m = [a, b, c, d, e, f];
    },
    save: () => st.stack.push(st.m),
    restore: () => {
      st.m = st.stack.pop() ?? IDENT;
    },
    translate: (x: number, y: number) => {
      st.m = mul(st.m, [1, 0, 0, 1, x, y]);
    },
    scale: (x: number, y: number) => {
      st.m = mul(st.m, [x, 0, 0, y, 0, 0]);
    },
    rotate: (r: number) => {
      st.m = mul(st.m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    },
    moveTo: (x: number, y: number) => note(x, y),
    lineTo: (x: number, y: number) => note(x, y),
    arc: (x: number, y: number, r: number) => {
      note(x - r, y - r);
      note(x + r, y + r);
    },
    bezierCurveTo: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
      note(x1, y1);
      note(x2, y2);
      note(x, y);
    },
  };
  return { boxes, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const paint = (doc: Schematic, selection: Set<string>, scale: number): Map<string, Box> => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale, offsetX: 0, offsetY: 0 },
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
  return s.boxes;
};

/** One label, nothing else on the sheet, so each colour has one source. */
const oneLabel = (justify: string): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (label "SIGNAL" (at 60 60 0)
        (effects (font (size 1.27 1.27)) (justify ${justify})) (uuid "l1")))`),
  );

const HALO = KICAD_DEFAULT.selectionShadow;
const LABEL = KICAD_DEFAULT.label;

describe('the glow under a label', () => {
  for (const justify of ['left', 'right']) {
    it(`lands exactly on ${justify}-justified glyphs`, () => {
      const boxes = paint(oneLabel(justify), new Set(['l1']), 0.0005);
      const halo = boxes.get(HALO)!;
      const text = boxes.get(LABEL)!;

      expect(halo).toBeDefined();
      expect(text).toBeDefined();
      // Exact along the reading direction, which is the axis upstream
      // compensates and the one the misalignment was visible on.
      expect(halo.minX).toBeCloseTo(text.minX, 6);
      expect(halo.maxX).toBeCloseTo(text.maxX, 6);
      // Across it, upstream compensates nothing — its fudge is `text_offset.x`
      // for ANGLE_0 and `text_offset.y` for ANGLE_90, always the reading axis —
      // so `offset.y -= m_StrokeWidth * 0.052` survives on the glow. That
      // leaves about a fifth of a pixel, and it stays there at any zoom because
      // the shadow width is itself a screen-constant term. Matching upstream
      // means keeping it, not closing it.
      expect(Math.abs(halo.minY - text.minY)).toBeLessThan(0.25);
      expect(Math.abs(halo.maxY - text.maxY)).toBeLessThan(0.25);
    });
  }

  it('stays on them as the zoom changes', () => {
    // The shift that used to be there was a screen-constant term
    // (`mils / scale`), so it grew in world units the further out you zoomed:
    // a version that lined up at one zoom could still be wrong at another.
    for (const scale of [0.002, 0.0005, 0.00008]) {
      const boxes = paint(oneLabel('left'), new Set(['l1']), scale);
      const halo = boxes.get(HALO)!;
      const text = boxes.get(LABEL)!;
      expect(halo.minX).toBeCloseTo(text.minX, 6);
      expect(halo.maxX).toBeCloseTo(text.maxX, 6);
      expect(Math.abs(halo.minY - text.minY)).toBeLessThan(0.25);
    }
  });
});

describe('the glow under a centred run', () => {
  // A symbol field is laid out centred, and `getLinePositions` *assigns*
  // `-lineSize.x / 2` there rather than adding to the offset — so the pen never
  // reached the position and there is nothing to take back out. Compensating
  // anyway would push the glow off in the other direction.
  const symbol = readSchematic(
    parse(`(kicad_sch (version 20250114)
      (lib_symbols
        (symbol "Device:R"
          (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
          (symbol "R_1_1")))
      (symbol (lib_id "Device:R") (at 60 60 0) (unit 1) (uuid "sym-1")
        (property "Reference" "R101" (at 60 55 0) (effects (font (size 1.27 1.27))))))`),
  );

  it('lands exactly on the reference', () => {
    const boxes = paint(symbol, new Set(['sym-1']), 0.0005);
    const halo = boxes.get(HALO)!;
    const text = boxes.get(KICAD_DEFAULT.reference)!;

    expect(halo).toBeDefined();
    expect(text).toBeDefined();
    expect(halo.minX).toBeCloseTo(text.minX, 6);
    expect(halo.maxX).toBeCloseTo(text.maxX, 6);
  });
});

describe('the glow under a sheet', () => {
  const sheet = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 50 50) (size 30 20) (uuid "sh1")
        (stroke (width 0) (type solid))
        (property "Sheetname" "power" (at 50 48 0) (effects (font (size 1.27 1.27))))
        (property "Sheetfile" "power.kicad_sch" (at 50 72 0)
          (effects (font (size 1.27 1.27)) (hide yes)))))`),
  );

  it('lands on the sheet name', () => {
    // The sheet name is the only thing drawn in its own colour here, so the two
    // boxes can only have come from the name and from the name's glow.
    const boxes = paint(sheet, new Set(['sh1']), 0.0005);
    const halo = boxes.get(HALO)!;
    const name = boxes.get(KICAD_DEFAULT.sheetName)!;

    expect(name).toBeDefined();
    // The sheet's box is in the halo too, so only the name's side is compared:
    // the glow must reach at least as far left as the text and no further.
    expect(halo.minX).toBeLessThanOrEqual(name.minX);
    expect(halo.minY).toBeLessThanOrEqual(name.minY);
  });
});
