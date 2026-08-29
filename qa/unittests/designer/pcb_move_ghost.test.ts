// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A footprint being dragged leaves nothing behind at the place it started.
 *
 * Upstream this cannot go wrong, because there is only one mechanism:
 * `VIEW::Update` re-caches the item that moved and everything it draws goes
 * with it, anchor cross included. We have two — a GPU path that translates the
 * item's recorded vertices in place, and an overlay path that takes the item
 * out of the board and draws a copy at the cursor — and each of them had a way
 * to leave the original sitting where it was.
 *
 * The LAYER_ANCHOR cross is the one this file can measure directly. It is
 * screen-space (`draw(FOOTPRINT)`: "size and width constant, not related to the
 * scale because the anchor is just a marker on screen"), so it is a per-frame
 * pass and can never be part of the buffer the GPU drag translates. Nothing
 * told it about the drag, so a moved footprint left its magenta cross —
 * `LAYER_ANCHOR` is rgb(255, 38, 226) — at the position it started from until
 * the drop, at which point the whole scene was rebuilt and it jumped across.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  buildDrawSteps,
  buildScene,
  drawAnchors,
  drawNetNames,
  DEFAULT_DRAW_OPTIONS,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';

const MM = 1e6;

/**
 * PcbEditor.tsx as text. The wiring that decides whether these passes are ever
 * told about a drag lives in a .tsx, which qa's tsconfig cannot compile, so it
 * is read the way view_controls_coverage.test.ts reads its call sites.
 */
const text = readFileSync(
  fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
  'utf8',
);

const board = () =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (footprint "R" (layer "F.Cu") (at 100 100))
  (footprint "C" (layer "F.Cu") (at 140 100))
)`),
  );

/** Records where each cross arm was drawn, in device pixels. */
const recordingCtx = (): { ctx: CanvasRenderingContext2D; xs: () => number[] } => {
  const xs: number[] = [];
  const ctx = {
    setTransform: () => {},
    beginPath: () => {},
    moveTo: (x: number) => {
      xs.push(x);
    },
    lineTo: () => {},
    stroke: () => {},
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, xs: () => xs };
};

const scene = buildScene(board(), {}, GL_PATH_FACTORY);
/** Past MINIMAL_ZOOM_FOR_ANCHORS (1.5), or the pass draws nothing at all. */
const view = { scale: (2.05 * 91) / 25.4 / MM, tx: 0, ty: 0 };
const front = new Set(['F.Cu']);

/**
 * The distinct x positions the crosses were centred on.
 *
 * Each cross is a horizontal arm (`moveTo( x - arm )`) then a vertical one
 * (`moveTo( x )`), so the larger of each pair is the centre. The values carry
 * a half pixel because `snapPx` centres a 1 px pen on the pixel grid.
 */
const centres = (shift: { ids: ReadonlySet<string>; dx: number; dy: number } | null): number[] => {
  const rec = recordingCtx();
  drawAnchors(rec.ctx, scene, view, front, 4000, 4000, undefined, 'none', 1, shift);
  const xs = [...new Set(rec.xs())].sort((a, b) => a - b);
  // Drop the arm starts: they sit exactly `arm` (5 px) left of a centre.
  return xs.filter((x) => xs.some((o) => Math.abs(o - (x - 5)) < 1e-6));
};

/** Is a cross centred within half a pixel of `mm`? `snapPx` moves it that far. */
const hasCrossAt = (at: number[], mm: number): boolean =>
  at.some((x) => Math.abs(x - mm * MM * view.scale) <= 0.5);

describe('the anchor cross belongs to its footprint', () => {
  it('records the owning board-item id with each anchor', () => {
    expect(scene.anchors.map((a) => a.owner)).toEqual(['footprint:0', 'footprint:1']);
  });

  it('draws both crosses where the footprints are when nothing is moving', () => {
    const at = centres(null);
    expect(at).toHaveLength(2);
    expect(hasCrossAt(at, 100)).toBe(true);
    expect(hasCrossAt(at, 140)).toBe(true);
  });
});

describe('an in-place GPU drag takes the anchor with it', () => {
  it('shifts only the moving footprint', () => {
    const still = centres(null);
    const moved = centres({ ids: new Set(['footprint:0']), dx: 20 * MM, dy: 0 });

    // R was at 100 mm and is being dragged 20 mm right: its cross is at 120.
    expect(hasCrossAt(moved, 120)).toBe(true);
    expect(hasCrossAt(moved, 100)).toBe(false);
    // C is not in the drag, so it has not moved.
    expect(hasCrossAt(moved, 140)).toBe(true);
    expect(hasCrossAt(still, 100)).toBe(true);
  });

  it('moves every footprint of a multi-item drag', () => {
    const moved = centres({
      ids: new Set(['footprint:0', 'footprint:1']),
      dx: -10 * MM,
      dy: 0,
    });
    expect(hasCrossAt(moved, 90)).toBe(true);
    expect(hasCrossAt(moved, 130)).toBe(true);
  });

  it('a zero delta is indistinguishable from no drag', () => {
    expect(centres({ ids: new Set(['footprint:0']), dx: 0, dy: 0 })).toEqual(centres(null));
  });

  it('ignores ids that are not footprints', () => {
    expect(centres({ ids: new Set(['track:3']), dx: 25 * MM, dy: 0 })).toEqual(centres(null));
  });
});

describe('the overlay fallback is wired for a drag that started in place', () => {
  // The other half, which only the source can show: `updateMove`'s in-place
  // branch used to clear `inPlaceMoveRef` when `gl.moveItems` refused and do
  // nothing else. The gesture then had no overlay (beginMove's in-place branch
  // returns before building one) AND the originals still in the retained scene
  // (it returns before scheduling the rebuild too), so the part sat still while
  // the selection copy followed the cursor.
  it('both entries into the slow path call the one function', () => {
    // Declared once...
    expect(text).toContain('const startOverlayMove = (');
    // ...and called from exactly two places: beginMove, and the moveItems
    // failure. Two is the point of the test: before this there was one.
    expect(text.match(/startOverlayMove\(/g)).toHaveLength(2);
  });

  it('the failure branch does more than clear the flag', () => {
    const i = text.indexOf('The GPU could not take it after all');
    expect(i).toBeGreaterThan(-1);
    const after = text.slice(i, i + 700);
    expect(after).toContain('inPlaceMoveRef.current = null;');
    expect(after).toContain('startOverlayMove(');
  });

  it('the frame builds the shift from the delta the GPU applied', () => {
    // The unit tests above exercise the passes; this is the wiring that decides
    // whether they are ever told anything.
    const i = text.indexOf('const inPlaceShift = inPlaceMoveRef.current');
    expect(i).toBeGreaterThan(-1);
    const decl = text.slice(i, i + 320);
    expect(decl).toContain('ids: dragAffectedRef.current');
    expect(decl).toContain('dx: inPlaceMoveRef.current.x');
    expect(decl).toContain('dy: inPlaceMoveRef.current.y');
    // `inPlaceMoveRef`, not `moveDeltaRef`: the buffer may be a frame behind
    // the cursor, and the passes must agree with the buffer, not the pointer.
    expect(decl).not.toContain('moveDeltaRef');
  });
});

describe('pad numbers and net names travel too', () => {
  // The other per-frame pass, and the one in Akshay's capture: J1 moved and
  // left its pad numbers "1" and "2" behind. Same debt as the anchors — text
  // laid out once in world coordinates and drawn every frame, so the buffer
  // the GPU translated never touches it.
  //
  // The `(layers …)` block is load-bearing: `expandLayers` resolves a pad's
  // `*.Cu` against the board's copper names, and without it every label comes
  // out with an empty layer list and PAD::ViewGetLOD's "hide netnames unless
  // the pad is flashed to a visible layer" drops the lot.
  const padBoard = () =>
    readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (footprint "J" (layer "F.Cu") (at 100 100)
    (pad "1" thru_hole circle (at -2.5 0) (size 2 2) (drill 1) (layers "*.Cu"))
    (pad "2" thru_hole circle (at 2.5 0) (size 2 2) (drill 1) (layers "*.Cu"))
  )
)`),
    );

  const padScene = buildScene(padBoard(), {}, GL_PATH_FACTORY);
  /** 20 px per mm keeps the footprint at 100 mm inside a 4000 px viewport. */
  const padView = { scale: 20 / MM, tx: 0, ty: 0 };

  it('records the owning footprint with each pad label', () => {
    expect(padScene.padLabels).toHaveLength(2);
    expect(padScene.padLabels.every((l) => l.owner === 'footprint:0')).toBe(true);
  });

  /**
   * Where the pad text was placed, in world units.
   *
   * The target carries a `bitmapText` method, which is how `drawNetNames`
   * decides it is drawing to the atlas — that is the path the GPU frame takes,
   * and the one whose anchors are worth measuring.
   */
  const textAt = (
    shift: { ids: ReadonlySet<string>; dx: number; dy: number } | null,
  ): { x: number; y: number }[] => {
    const at: { x: number; y: number }[] = [];
    const ctx = {
      setTransform: () => {},
      bitmapText: (_t: string, p: { x: number; y: number }) => {
        at.push({ x: p.x, y: p.y });
      },
      strokeStyle: '',
    } as unknown as CanvasRenderingContext2D;
    drawNetNames(
      ctx,
      padScene,
      padView,
      new Set(['F.Cu']),
      4000,
      4000,
      DEFAULT_DRAW_OPTIONS,
      'none',
      1,
      'over',
      shift,
    );
    return at;
  };

  it('places the text on the pads when nothing is moving', () => {
    const at = textAt(null);
    expect(at).toHaveLength(2);
    // Pads at 100 mm ± 2.5 mm.
    expect(at.map((p) => p.x).sort((a, b) => a - b)).toEqual([97.5 * MM, 102.5 * MM]);
  });

  it('shifts the text by the delta the GPU applied', () => {
    const moved = textAt({ ids: new Set(['footprint:0']), dx: 20 * MM, dy: -7 * MM });
    expect(moved.map((p) => p.x).sort((a, b) => a - b)).toEqual([117.5 * MM, 122.5 * MM]);
    expect(moved.every((p) => p.y === 93 * MM)).toBe(true);
  });

  it('leaves the text of a footprint that is not in the drag alone', () => {
    expect(textAt({ ids: new Set(['footprint:9']), dx: 20 * MM, dy: 0 })).toEqual(textAt(null));
  });

  /** The colour each pad label was drawn in, keyed by the text drawn. */
  const textColors = (emphasis: 'none' | 'selected'): Map<string, string> => {
    const out = new Map<string, string>();
    let pen = '';
    const ctx = {
      setTransform: () => {},
      bitmapText: (t: string) => out.set(t, pen),
      set strokeStyle(v: string) {
        pen = v;
      },
      get strokeStyle() {
        return pen;
      },
    } as unknown as CanvasRenderingContext2D;
    drawNetNames(
      ctx,
      padScene,
      padView,
      new Set(['F.Cu']),
      4000,
      4000,
      // The pad-name colour has to be a MID tone for this to prove anything.
      // netnameColorFor only ever returns special.padName or its inverse, and
      // the stock value is white — so on any real theme the text is white or
      // black, and selectedColor() short-circuits on `brightness < 0.05` for
      // black just as brightening saturates for white. Either way the colours
      // would match with the isNetname guard removed, and a mutant that drops
      // it survives. This grey-blue sits at ~0.55 brightness, where isNetname
      // is the only thing standing between it and Brightened().
      {
        ...DEFAULT_DRAW_OPTIONS,
        theme: { special: { padName: 'rgba(128,160,200,0.7)' } },
      } as unknown as typeof DEFAULT_DRAW_OPTIONS,
      emphasis,
    );
    return out;
  };

  it("draws a selected pad's text in the same colour as an unselected one", () => {
    // This is what makes suppressing the overlay's copy free. selectedColor()
    // opens with `if (isNetname || …) return color`, and every net-name colour
    // in drawNetNames is resolved with isNetname true, so pcbnew's selection
    // brightening never reaches this text. The overlay's second copy was
    // therefore identical in colour to the first and differed only in coming
    // from the stroke font instead of the atlas — the nudge, and nothing else.
    expect([...textColors('none').keys()].sort()).toEqual(['1', '2']);
    expect(textColors('selected')).toEqual(textColors('none'));
    // Guard the premise: the colour under test really is the mid tone, not a
    // saturated white or a near-black that would short-circuit for its own
    // reasons. Without this the assertion above holds either way.
    expect([...textColors('none').values()]).toEqual([
      'rgba(128,160,200,0.7)',
      'rgba(128,160,200,0.7)',
    ]);
  });

  it('a selection overlay draws no text of its own', () => {
    // Both halves of the fix: the base brightens in place, and the overlay
    // that used to do the brightening stops drawing the glyphs a second time.
    const steps = (suppress: boolean) =>
      buildDrawSteps(
        { setTransform: () => {} } as unknown as CanvasRenderingContext2D,
        padScene,
        padView,
        new Set(['F.Cu']),
        4000,
        4000,
        DEFAULT_DRAW_OPTIONS,
        undefined,
        true,
        'selected',
        suppress,
      ).length;
    expect(steps(true)).toBe(steps(false) - 1);
  });

  it('only a move overlay is allowed to draw its own text', () => {
    // The move path rebuilds the base without the dragged items, so there the
    // overlay is the only one drawing them; every other overlay sits on a
    // board that still holds them.
    expect(text).toContain('moveSceneRef.current === null,');
    // And the three overlays that never remove anything from the base always
    // suppress: net colours, the net highlight and the disambiguation hover.
    expect(text.match(/^\s*'highlighted',\n\s*true,$/gm)).toHaveLength(2);
  });

  it('all three drawNetNames call sites are handed the shift', () => {
    // Two GPU passes (under and over) and the Canvas2D fallback.
    expect(text.match(/^\s*inPlaceShift,$/gm)).toHaveLength(4); // + drawAnchors
  });
});
