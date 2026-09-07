// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a pad puts on the canvas: its outline, its clearance ring and its
 * number.
 *
 * Reported as "the way the footprint is rendered in KiCad vs us varies a lot",
 * comparing the Choose Symbol dialog's footprint preview of
 * `Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal` side by side. The pad *shapes*
 * turned out to be right already (pin 1 a roundrect, pin 2 a circle, straight
 * off the `(pad …)` tokens); three other things were not:
 *
 *  1. no pad ever showed its number, because `buildDrawSteps` scheduled the
 *     per-frame netname pass only when the scene had track or via labels — and
 *     a board holding one footprint has neither. `PCB_PAINTER::draw( const
 *     PAD*, int )`'s netname branch is a layer of its own (LAYER_PAD_NETNAMES),
 *     independent of the track and via ones;
 *  2. every pad wore a clearance ring the preview has none of: upstream's
 *     `clearance > 0` guard (pcb_painter.cpp:1974) is false on a board with no
 *     DRC engine, which is what `BOARD_CONNECTED_ITEM::GetOwnClearance` answers
 *     0 for (board_connected_item.cpp:121-130);
 *  3. the scene's bounding box grew by pads and the footprint anchor only, so
 *     silkscreen, courtyard, fab outline and text were drawn but never
 *     measured. `BOARD::ComputeBoundingBox` merges
 *     `footprint->GetBoundingBox( true )` (board.cpp:2255).
 *
 * The pad-shape table is here anyway: it was the reported suspicion and nothing
 * pinned it, so a regression to "everything is a circle" would have been silent.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board, PadShape } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  drawBoard,
  drawNetNames,
  DEFAULT_DRAW_OPTIONS,
  type ScenePathFactory,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

const MM = 1e6;

// ---------------------------------------------------------------------------
// A recording backend. `buildScene` takes the factory, so nothing is
// monkeypatched onto globals and each build gets a fresh recorder.

interface Op {
  op: string;
  args: number[];
}

class RecordingPath {
  ops: Op[] = [];
  private push(op: string, args: number[]): void {
    this.ops.push({ op, args });
  }
  moveTo(...a: number[]): void {
    this.push('moveTo', a);
  }
  lineTo(...a: number[]): void {
    this.push('lineTo', a);
  }
  arc(...a: number[]): void {
    this.push('arc', a);
  }
  arcTo(...a: number[]): void {
    this.push('arcTo', a);
  }
  rect(...a: number[]): void {
    this.push('rect', a);
  }
  roundRect(...a: number[]): void {
    this.push('roundRect', a);
  }
  closePath(): void {
    this.push('closePath', []);
  }
  addPath(other: RecordingPath): void {
    this.ops.push(...other.ops);
  }
}

/** The `translate(...).rotate(...)` chain `addPadShape` places a pad with. */
class RecordingMatrix {
  translate(): RecordingMatrix {
    return this;
  }
  rotate(): RecordingMatrix {
    return this;
  }
}

const RECORDING_FACTORY: ScenePathFactory = {
  path: () => new RecordingPath() as unknown as Path2D,
  matrix: () => new RecordingMatrix() as unknown as DOMMatrix,
};

const asRecording = (p: Path2D): RecordingPath => p as unknown as RecordingPath;

// ---------------------------------------------------------------------------

const boardWith = (...items: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (31 "F.CrtYd" user) (35 "F.Fab" user))
  (net 0 "")
  ${items.join('\n  ')}
)`),
  );

/** One footprint at the origin holding exactly the pads given. */
const padBoard = (...pads: string[]): Board =>
  boardWith(`(footprint "T" (layer "F.Cu") (at 0 0)
    ${pads.join('\n    ')})`);

/**
 * A layer's pad flashes — BOTH buckets.
 *
 * The scene splits them: a PTH pad with a NORMAL padstack goes to
 * `padsPthNormal` so `m_Display.m_UseViaColorForNormalTHPadstacks` can paint
 * it in the via-hole colour without rebuilding the scene
 * (`PCB_PAINTER::GetColor`, `pcb_painter.cpp:266-283`). The two are disjoint
 * halves of one thing, and every question here is about the SHAPE, which the
 * split does not touch — so reading one bucket would silently answer "no pads"
 * for every through-hole footprint in the library.
 */
const padOps = (board: Board, layer = 'F.Cu'): Op[] => {
  const scene = buildScene(board, {}, RECORDING_FACTORY);
  const bucket = scene.layers.get(layer);
  if (!bucket) return [];
  return [...asRecording(bucket.pads).ops, ...asRecording(bucket.padsPthNormal).ops];
};

describe('a pad draws the shape its own token names', () => {
  /**
   * `PAD_SHAPE` (`include/padstack.h`) against the primitive `addPadShape`
   * builds each one from — the switch in `PCB_PAINTER::draw( const PAD* )` via
   * `PAD::GetEffectiveShape`. One row per member of the enum, so a shape that
   * quietly falls back to another is a failing row rather than a shrug.
   */
  const cases: { shape: PadShape; token: string; op: string; radius?: number }[] = [
    { shape: 'circle', token: 'circle (at 0 0) (size 2.2 2.2)', op: 'arc' },
    { shape: 'rect', token: 'rect (at 0 0) (size 2.2 1.0)', op: 'rect' },
    {
      // The pin-1 marker of every through-hole part in the KiCad library, and
      // the pad the report was actually about.
      shape: 'roundrect',
      token: 'roundrect (at 0 0) (size 2.2 2.2) (roundrect_rratio 0.113636)',
      op: 'roundRect',
      // GetRoundRectCornerRadius: ratio · min(w, h) = 0.113636 · 2.2 mm.
      radius: 0.113636 * 2.2 * MM,
    },
    // An oval is a roundrect whose radius is half its short side (PAD::
    // TransformShapeToPolygon builds it as a stadium).
    { shape: 'oval', token: 'oval (at 0 0) (size 2.2 1.0)', op: 'roundRect', radius: 0.5 * MM },
    {
      shape: 'trapezoid',
      token: 'trapezoid (at 0 0) (size 2.2 2.2) (rect_delta 0.5 0)',
      op: 'closePath',
    },
    {
      shape: 'custom',
      token:
        'custom (at 0 0) (size 1 1) (options (clearance outline) (anchor circle))' +
        ' (primitives (gr_poly (pts (xy -1 -1) (xy 1 -1) (xy 1 1)) (width 0)))',
      op: 'closePath',
    },
  ];

  for (const c of cases) {
    it(`draws a ${c.shape} pad as a ${c.op}`, () => {
      const ops = padOps(padBoard(`(pad "1" smd ${c.token} (layers "F.Cu"))`));

      expect(ops.map((o) => o.op)).toContain(c.op);
      if (c.radius !== undefined) {
        const rr = ops.find((o) => o.op === 'roundRect')!;
        expect(rr.args[4]).toBeCloseTo(c.radius, 0);
      }
    });
  }

  it('does not fall back to a circle for a shape that is not one', () => {
    // The reported suspicion. `arc` is how a circle (and a custom pad's anchor)
    // is drawn, and no other shape may reach for it.
    for (const c of cases) {
      if (c.shape === 'circle' || c.shape === 'custom') continue;
      const ops = padOps(padBoard(`(pad "1" smd ${c.token} (layers "F.Cu"))`));
      expect(
        ops.map((o) => o.op),
        c.shape,
      ).not.toContain('arc');
    }
  });

  it('gives the two pads of D_DO-41_SOD81 the shapes its file declares', () => {
    // Verbatim from
    // /usr/share/kicad/footprints/Diode_THT.pretty/D_DO-41_SOD81_P10.16mm_Horizontal.kicad_mod
    const ops = padOps(
      padBoard(
        '(pad "1" thru_hole roundrect (at 0 0) (size 2.2 2.2) (drill 1.1)' +
          ' (layers "*.Cu" "*.Mask") (roundrect_rratio 0.113636))',
        '(pad "2" thru_hole circle (at 10.16 0) (size 2.2 2.2) (drill 1.1)' +
          ' (layers "*.Cu" "*.Mask"))',
      ),
    );

    expect(ops.filter((o) => o.op === 'roundRect')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'arc')).toHaveLength(1);
  });
});

describe('the clearance ring', () => {
  const hasClearance = (board: Board, clearance?: number): boolean => {
    const scene = buildScene(
      board,
      clearance === undefined ? {} : { clearanceForNet: () => clearance },
      RECORDING_FACTORY,
    );
    return scene.layers.get('F.Cu')?.hasClearance ?? false;
  };

  const oneSmdPad = (): Board => padBoard('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu"))');

  it('is drawn when the rules resolve to a real clearance', () => {
    expect(hasClearance(oneSmdPad(), 0.2 * MM)).toBe(true);
  });

  it('is not drawn when the clearance is zero', () => {
    // `if( aPad->FlashLayer( … ) && clearance > 0 )` — pcb_painter.cpp:1974.
    // A ring at zero clearance is a stroke lying exactly on the pad edge, which
    // is what the footprint preview was wearing: its dummy BOARD has no DRC
    // engine, so GetOwnClearance answers 0 for every pad on it.
    expect(hasClearance(oneSmdPad(), 0)).toBe(false);
  });
});

describe('the scene bounding box measures the whole footprint', () => {
  // A footprint whose silkscreen and courtyard reach well outside its one pad,
  // like every real one: the pad is 2 mm square at the origin, the courtyard
  // runs to x = 11.51 mm and the value text sits at y = 2.47 mm.
  const wide = (): Board =>
    boardWith(`(footprint "T" (layer "F.Cu") (at 0 0)
    (property "Value" "LONG_VALUE_TEXT" (at 5.08 2.47 0) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_rect (start -1.35 -1.6) (end 11.51 1.6) (stroke (width 0.05) (type solid))
      (fill no) (layer "F.CrtYd"))
    (pad "1" thru_hole circle (at 0 0) (size 2.2 2.2) (drill 1.1) (layers "*.Cu")))`);

  it('reaches the courtyard, not just the pads', () => {
    const bbox = buildScene(wide(), {}, RECORDING_FACTORY).bbox!;

    // The pads alone would stop at x = 1.1 mm.
    expect(bbox.maxX).toBeGreaterThanOrEqual(11.51 * MM);
  });

  it('reaches the text as well, the way ComputeBoundingBox does', () => {
    const bbox = buildScene(wide(), {}, RECORDING_FACTORY).bbox!;

    // A 1 mm text centred on y = 2.47 mm: its box ends below 2.9 mm and well
    // past the courtyard's 1.6 mm, which the pads and graphics cannot explain.
    expect(bbox.maxY).toBeGreaterThan(2.47 * MM);
  });
});

describe('pad numbers', () => {
  /** Every `ctx.stroke(path)` the netname pass performs. */
  const strokeCount = (
    board: Board,
    scale: number,
    opts: typeof DEFAULT_DRAW_OPTIONS = { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false },
    visible: ReadonlySet<string> = new Set(['F.Cu', 'B.Cu']),
  ): number => {
    const scene = buildScene(board, {}, RECORDING_FACTORY);
    let n = 0;
    const ctx = {
      setTransform: () => {},
      lineCap: '',
      lineJoin: '',
      strokeStyle: '',
      lineWidth: 0,
      stroke: () => {
        n++;
      },
    } as unknown as CanvasRenderingContext2D;
    const prev = globalThis.Path2D;
    (globalThis as unknown as { Path2D: unknown }).Path2D = class {
      moveTo(): void {}
      lineTo(): void {}
    };
    try {
      drawNetNames(ctx, scene, { scale, tx: 400, ty: 300 }, visible, 800, 600, opts);
    } finally {
      (globalThis as unknown as { Path2D: unknown }).Path2D = prev;
    }
    return n;
  };

  /** One through-hole pad, numbered, on a board with no track and no via. */
  const lonePad = (): Board =>
    padBoard('(pad "1" thru_hole circle (at 0 0) (size 2.2 2.2) (drill 1.1) (layers "*.Cu"))');

  it('reaches the scene as a label carrying the pad number', () => {
    const scene = buildScene(lonePad(), {}, RECORDING_FACTORY);

    expect(scene.padLabels).toHaveLength(1);
    expect(scene.padLabels[0]!.items.map((i) => i.text)).toEqual(['1']);
    // PAD::ViewGetLOD measures the pad bounding box's shorter side.
    expect(scene.padLabels[0]!.minSide).toBe(2.2 * MM);
  });

  it('is drawn by drawBoard on a board that has no track and no via', () => {
    // The regression: `buildDrawSteps` gated the whole per-frame pass on
    // `netLabels.length > 0 || viaNetLabels.length > 0`, so the footprint
    // editor and the chooser's footprint preview — one footprint, nothing else
    // — never scheduled it and no pad number could appear at any zoom.
    //
    // Measured as a difference against the same scene with its pad labels
    // removed, because drawBoard strokes other things too (the hole wall, for
    // one) and a bare count would pass with the pass never scheduled.
    const scene = buildScene(lonePad(), {}, RECORDING_FACTORY);
    expect(scene.netLabels).toHaveLength(0);
    expect(scene.viaNetLabels).toHaveLength(0);

    const withNumbers = boardStrokes(scene);
    const without = boardStrokes({ ...scene, padLabels: [] });

    expect(withNumbers).toBeGreaterThan(without);
  });

  it('is gated by m_DisplayPadNumbers, the Show Pad Numbers toggle', () => {
    // `draw( const PAD*, aLayer )`'s netname branch reads the flag FIRST and
    // leaves `padNumber` empty when it is off (`pcb_painter.cpp:1393-1398`).
    // Nothing in this port could express that: every frame that draws a pad
    // drew its number, so cvpcb's viewer and the footprint editor both carried
    // a Show Pad Numbers button that painted nothing when pressed.
    expect(strokeCount(lonePad(), 20 / MM)).toBeGreaterThan(0);
    expect(
      strokeCount(lonePad(), 20 / MM, {
        ...DEFAULT_DRAW_OPTIONS,
        drawingSheet: false,
        padNumbers: false,
      }),
    ).toBe(0);
  });

  it('and the flag takes the NUMBER only: a net name on the same pad survives', () => {
    // Two independent gates on one label — `m_DisplayPadNumbers` for the number
    // and `m_Display.m_NetNames` for the net name — which is why the scene
    // tags each item rather than the pass gating the whole label.
    const netted = boardWith(
      '(net 1 "GND")',
      `(footprint "T" (layer "F.Cu") (at 0 0)
    (pad "1" thru_hole circle (at 0 0) (size 2.2 2.2) (drill 1.1) (layers "*.Cu") (net 1 "GND")))`,
    );
    const scene = buildScene(netted, {}, RECORDING_FACTORY);
    expect(scene.padLabels[0]!.items.map((i) => i.padText).sort()).toEqual(['net', 'number']);

    const both = strokeCount(netted, 20 / MM);
    const netOnly = strokeCount(netted, 20 / MM, {
      ...DEFAULT_DRAW_OPTIONS,
      drawingSheet: false,
      padNumbers: false,
    });
    expect(netOnly).toBeGreaterThan(0);
    expect(netOnly).toBeLessThan(both);
  });

  it('needs the pad to be flashed to a visible layer, as PAD::ViewGetLOD says', () => {
    // "Hide netnames unless pad is flashed to a visible layer" — hiding every
    // copper layer takes the numbers with it instead of leaving them floating
    // over an empty board.
    expect(strokeCount(lonePad(), 20 / MM)).toBeGreaterThan(0);
    expect(strokeCount(lonePad(), 20 / MM, undefined, new Set(['F.SilkS']))).toBe(0);
  });

  it('disappears as the zoom falls, and comes back as it rises', () => {
    // PAD::ViewGetLOD's own threshold is 0.5 mm of the pad's shorter side
    // (1.79 px at GAL's 91 dpi). It is not the *binding* gate on this backend:
    // a stroked glyph is dropped below GLYPH_LEGIBLE_PX as well, which for a
    // pad number works out at about 3.1 px of pad — so what a Canvas2D test can
    // observe is the pair of answers, not the 1.79. The atlas (GL) path, which
    // has no glyph floor, is where the threshold itself shows.
    expect(strokeCount(lonePad(), 0.5 / MM)).toBe(0);
    expect(strokeCount(lonePad(), 20 / MM)).toBeGreaterThan(0);
  });

  it('goes away with Appearance > Objects > Pads, its LOD meta-control', () => {
    expect(
      strokeCount(lonePad(), 20 / MM, {
        ...DEFAULT_DRAW_OPTIONS,
        drawingSheet: false,
        pads: false,
      }),
    ).toBe(0);
  });
});

/** How many `ctx.stroke()` calls a whole `drawBoard` of this scene performs. */
function boardStrokes(scene: ReturnType<typeof buildScene>): number {
  let strokes = 0;
  const ctx = {
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {},
    scale: () => {},
    translate: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    strokeRect: () => {},
    setLineDash: () => {},
    drawImage: () => {},
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    stroke: () => {
      strokes++;
    },
  } as unknown as CanvasRenderingContext2D;
  const prev = globalThis.Path2D;
  (globalThis as unknown as { Path2D: unknown }).Path2D = class {
    moveTo(): void {}
    lineTo(): void {}
  };
  try {
    drawBoard(
      ctx,
      scene,
      { scale: 20 / MM, tx: 400, ty: 300 },
      new Set(['F.Cu', 'B.Cu', 'F.SilkS', 'F.CrtYd', 'F.Fab']),
      800,
      600,
      { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false },
    );
  } finally {
    (globalThis as unknown as { Path2D: unknown }).Path2D = prev;
  }
  return strokes;
}
