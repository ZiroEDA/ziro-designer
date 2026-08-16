// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Selecting a sheet lights everything the sheet owns, not just its box.
 *
 * A selected item's children are selected with it. `SCH_SELECTION_TOOL::highlight`
 * runs `RunOnChildren` over the item and sets SELECTED on each child — for a
 * sheet that is its Sheetname and Sheetfile fields and every one of its pins —
 * and `SCH_PAINTER::draw( const SCH_SHEET* )` then paints those children onto
 * LAYER_SELECTION_SHADOWS as well:
 *
 *     if( !drawingShadows || eeconfig()->m_Selection.draw_selected_children )
 *     {
 *         for( const SCH_FIELD& field : aSheet->GetFields() )
 *             draw( &field, aLayer, DNP );
 *         for( SCH_SHEET_PIN* sheetPin : aSheet->GetPins() )
 *             draw( static_cast<SCH_HIERLABEL*>( sheetPin ), aLayer, DNP );
 *     }
 *
 * `selection.draw_selected_children` defaults to true (eeschema_settings.cpp:437).
 *
 * We haloed the rectangle alone. A symbol lit its reference and value; a sheet
 * left its name, its filename and every pin label looking exactly as they did
 * unselected, so on a sheet covered in pins there was almost nothing to see.
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

/** One recorded stroke: its colour and the box it covered, in canvas space. */
interface Stroke {
  color: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A 2D affine transform, [a b c d e f] as the canvas orders them. */
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

/**
 * Records each stroke's colour and the band of the canvas it covered.
 *
 * The transform is tracked for real rather than stubbed out. Glyphs are drawn
 * in their own space with the context translated to the text's anchor, so a spy
 * that ignores `translate` sees every letter of every field piled up at the
 * origin — which reads as "the name got its halo" no matter where the name is,
 * and as "the filename did not" no matter what.
 */
function spy(): {
  strokes: Stroke[];
  ctx: CanvasRenderingContext2D;
} {
  const strokes: Stroke[] = [];
  const noop = (): void => {};
  const st = {
    strokeStyle: '',
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    m: IDENT,
    stack: [] as Mat[],
  };
  /** One path point, through the current transform, into the running band. */
  const note = (x: number, y: number): void => {
    const wx = st.m[0] * x + st.m[2] * y + st.m[4];
    const wy = st.m[1] * x + st.m[3] * y + st.m[5];
    if (wx < st.minX) st.minX = wx;
    if (wx > st.maxX) st.maxX = wx;
    if (wy < st.minY) st.minY = wy;
    if (wy > st.maxY) st.maxY = wy;
  };
  const flush = (): void => {
    if (st.minY !== Infinity)
      strokes.push({
        color: st.strokeStyle,
        minX: st.minX,
        maxX: st.maxX,
        minY: st.minY,
        maxY: st.maxY,
      });
  };
  const ctx = {
    get strokeStyle() {
      return st.strokeStyle;
    },
    set strokeStyle(v: string) {
      st.strokeStyle = v;
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
    beginPath: () => {
      st.minX = Infinity;
      st.maxX = -Infinity;
      st.minY = Infinity;
      st.maxY = -Infinity;
    },
    moveTo: (x: number, y: number) => note(x, y),
    lineTo: (x: number, y: number) => note(x, y),
    arc: (x: number, y: number, r: number) => {
      note(x, y - r);
      note(x, y + r);
    },
    bezierCurveTo: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
      note(x1, y1);
      note(x2, y2);
      note(x, y);
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      st.minX = Infinity;
      st.maxX = -Infinity;
      st.minY = Infinity;
      st.maxY = -Infinity;
      note(x, y);
      note(x + w, y + h);
      flush();
    },
    stroke: flush,
  };
  return { strokes, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const SCALE = 0.0005;

const paint = (doc: Schematic, selection: Set<string>) => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: SCALE, offsetX: 0, offsetY: 0 },
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

// The sheet body spans y = 50..70 mm. Its name sits above it and its filename
// below, so ink outside that band and in the shadow colour can only be a field.
const SHEET = `(kicad_sch (version 20250114) (lib_symbols)
  (sheet (at 50 50) (size 30 20) (uuid "sh1")
    (stroke (width 0) (type solid))
    (property "Sheetname" "power" (at 50 48 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "power.kicad_sch" (at 50 72 0) (effects (font (size 1.27 1.27))))
    (pin "VCC" input (at 50 55 180) (uuid "p1") (effects (font (size 1.27 1.27))))
    (pin "GND" input (at 50 60 180) (uuid "p2") (effects (font (size 1.27 1.27))))))`;

const doc = readSchematic(parse(SHEET));
const SHADOW = KICAD_DEFAULT.selectionShadow;
// The recorded bands are in canvas space, since the view transform is tracked
// along with everything else; at this offset that is just world times scale.
const toScreen = (mm: number): number => mmToIU(mm) * SCALE;
const BODY_TOP = toScreen(50);
const BODY_BOTTOM = toScreen(70);

/** Shadow-coloured strokes lying wholly above the sheet body (the name). */
const aboveBody = (strokes: ReturnType<typeof paint>): number =>
  strokes.filter((s) => s.color === SHADOW && s.maxY < BODY_TOP).length;

/** Shadow-coloured strokes lying wholly below it (the filename). */
const belowBody = (strokes: ReturnType<typeof paint>): number =>
  strokes.filter((s) => s.color === SHADOW && s.minY > BODY_BOTTOM).length;

/** Shadow-coloured strokes strictly inside it (the pin labels). */
const insideBody = (strokes: ReturnType<typeof paint>): number =>
  strokes.filter((s) => s.color === SHADOW && s.minY > BODY_TOP && s.maxY < BODY_BOTTOM).length;

describe('selecting a sheet', () => {
  const selected = paint(doc, new Set(['sh1']));

  it('haloes the box', () => {
    expect(
      selected.some((s) => s.color === SHADOW && s.minY <= BODY_TOP && s.maxY >= BODY_BOTTOM),
    ).toBe(true);
  });

  it('haloes the sheet name above it', () => {
    expect(aboveBody(selected)).toBeGreaterThan(0);
  });

  it('haloes the filename below it', () => {
    expect(belowBody(selected)).toBeGreaterThan(0);
  });

  it('haloes the pin labels inside it', () => {
    expect(insideBody(selected)).toBeGreaterThan(0);
  });

  it('lays the filename halo over the filename, "File: " prefix and all', () => {
    // A halo is the item's own geometry re-stroked, so it has to be laid out by
    // the same rules as the glyphs it sits under. `SCH_FIELD::GetShownText`
    // prefixes a sheet's filename with "File: ", and a halo drawn from the raw
    // value would come out shorter than the text and offset from it — visible
    // as a glow that stops before the name does.
    const span = (only: (s: Stroke) => boolean): [number, number] => {
      const band = selected.filter((s) => s.minY > BODY_BOTTOM).filter(only);
      return [Math.min(...band.map((s) => s.minX)), Math.max(...band.map((s) => s.maxX))];
    };
    const [haloL, haloR] = span((s) => s.color === SHADOW);
    const [inkL, inkR] = span((s) => s.color !== SHADOW);

    expect(haloL).toBeCloseTo(inkL, 3);
    expect(haloR).toBeCloseTo(inkR, 3);
  });
});

describe('a sheet nobody selected', () => {
  const plain = paint(doc, new Set());

  it('gets no shadow ink at all', () => {
    // Whatever the halo covers, none of it may appear unselected — otherwise
    // the assertions above would pass on ink the sheet always draws.
    expect(plain.filter((s) => s.color === SHADOW)).toHaveLength(0);
  });
});

describe('one sheet pin, selected on its own', () => {
  const pinOnly = paint(doc, new Set(['sh1:sheetpin0']));

  it('haloes that pin', () => {
    expect(insideBody(pinOnly)).toBeGreaterThan(0);
  });

  it('leaves the box and the fields alone', () => {
    // The child is selected, not the parent, so nothing else lights up.
    expect(aboveBody(pinOnly)).toBe(0);
    expect(belowBody(pinOnly)).toBe(0);
    expect(
      pinOnly.some((s) => s.color === SHADOW && s.minY <= BODY_TOP && s.maxY >= BODY_BOTTOM),
    ).toBe(false);
  });
});
