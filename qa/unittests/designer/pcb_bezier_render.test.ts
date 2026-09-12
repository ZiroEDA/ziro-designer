// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `gr_curve` is drawn, clicked and edited as the curve it is — not as the
 * quadrilateral of its four control points.
 *
 * `PCB_PAINTER::draw( PCB_SHAPE )`, `case SHAPE_T::BEZIER` strokes
 * `GetBezierPoints()`, the tessellation, and `EDA_SHAPE::hitTest` walks the
 * same list with `TestSegmentHit`. Ours did neither: `curve` shared the `poly`
 * branch in both places, so a bezier rendered as a zigzag through its handles
 * and picked up clicks on the control polygon instead of on the ink. Nothing in
 * the reader or the writer was wrong, which is why this survived — the file
 * round-tripped perfectly and only the screen lied.
 *
 * The fixture is a deep S. It is chosen so the two readings cannot be confused
 * for each other: at the halfway point of this curve the control polygon is
 * over a millimetre away, far past any click slop.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { boardHitCandidates, boardItemId } from '@ziroeda/pcbnew/src/edit-board.js';
import {
  boardEditHandles,
  boardIndicatorLines,
  dragBoardHandle,
} from '@ziroeda/pcbnew/src/point_editor.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  buildDrawSteps,
  DEFAULT_DRAW_OPTIONS,
  type ScenePathFactory,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

const MM = 1e6;

interface Op {
  op: string;
  args: number[];
}

/**
 * A Path2D that keeps what was recorded into it.
 *
 * `bezierCurveTo` is a real method here rather than a string this file greps
 * for: the assertion is that the renderer *called* it, with the control points
 * in the order the cubic needs.
 */
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
  bezierCurveTo(...a: number[]): void {
    this.push('bezierCurveTo', a);
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
class RecordingMatrix {
  translate(): RecordingMatrix {
    return this;
  }
  rotate(): RecordingMatrix {
    return this;
  }
}
const FACTORY: ScenePathFactory = {
  path: () => new RecordingPath() as unknown as Path2D,
  matrix: () => new RecordingMatrix() as unknown as DOMMatrix,
};
const rec = (p: Path2D): RecordingPath => p as unknown as RecordingPath;

interface Drawn {
  path: RecordingPath;
  kind: 'stroke' | 'fill';
}

function drawn(board: Board, visible = ['F.SilkS']): Drawn[] {
  const scene = buildScene(board, {}, FACTORY);
  const out: Drawn[] = [];
  const ctx = {
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set fillStyle(_v: string) {},
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    canvas: { width: 800, height: 600 },
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    clearRect: () => {},
    fillRect: () => {},
    fill: (p?: Path2D) => {
      if (p) out.push({ path: rec(p), kind: 'fill' });
    },
    fillText: () => {},
    measureText: () => ({ width: 0 }),
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    clip: () => {},
    drawImage: () => {},
    stroke: (p?: Path2D) => {
      if (p) out.push({ path: rec(p), kind: 'stroke' });
    },
  } as unknown as CanvasRenderingContext2D;

  for (const step of buildDrawSteps(
    ctx,
    scene,
    { scale: 1, tx: 0, ty: 0, flipX: false },
    new Set(visible),
    800,
    600,
    { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false },
  ))
    step();
  return out;
}

const boardWith = (...items: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${items.join('\n  ')}
)`),
  );

/**
 * A deep S from (0,0) to (10,0) whose handles are pulled 8 mm apart vertically.
 *
 * Its midpoint is at (5, 0) — the symmetry makes that exact — while the control
 * polygon at x = 5 is nowhere near: the segment C1→C2 runs from (2,4) to (8,-4),
 * crossing y = 0 at x = 5 as well. So the midpoint is a *bad* discriminator and
 * the tests below pick x = 2.5 instead, where the curve sits at roughly y = 2.1
 * and the control polygon at y = 1.
 */
const CURVE =
  '(gr_curve (pts (xy 0 0) (xy 2 4) (xy 8 -4) (xy 10 0)) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))';

const ID = boardItemId('shape', 0);

describe('drawing it', () => {
  it('strokes one cubic through the two control points, not four line segments', () => {
    const paths = drawn(boardWith(CURVE));
    const curve = paths.find((d) => d.path.ops.some((o) => o.op === 'bezierCurveTo'));

    expect(curve).toBeDefined();
    expect(curve!.path.ops).toEqual([
      { op: 'moveTo', args: [0, 0] },
      // start is the moveTo; the three arguments are C1, C2 and the end, which
      // is the order `CanvasPath.bezierCurveTo` takes and the order the file
      // stores them in — so no reordering is needed and none is done.
      { op: 'bezierCurveTo', args: [2 * MM, 4 * MM, 8 * MM, -4 * MM, 10 * MM, 0] },
    ]);
    // and nothing walked the control polygon
    expect(curve!.path.ops.some((o) => o.op === 'lineTo')).toBe(false);
  });

  it('closes the chord when the curve is filled, as DrawPolygon does', () => {
    // `m_gal->DrawPolygon( GetBezierPoints() )` — a filled bezier is the region
    // between the curve and the chord from its end back to its start.
    const filled = CURVE.replace('(layer', '(fill solid) (layer');
    const paths = drawn(boardWith(filled));
    const fill = paths.find(
      (d) => d.kind === 'fill' && d.path.ops.some((o) => o.op === 'bezierCurveTo'),
    );

    expect(fill).toBeDefined();
    expect(fill!.path.ops.at(-1)).toEqual({ op: 'closePath', args: [] });
  });
});

describe('clicking it', () => {
  // A generous 0.25 mm of slop, so neither result can be blamed on the tolerance.
  const TOL = 0.25 * MM;
  const board = boardWith(CURVE);

  it('picks the shape from a point on the ink', () => {
    // B(0.25) of the cubic itself, evaluated by hand rather than by asking our
    // tessellator where the curve is — an expectation computed from the code
    // under test cannot fail (see `tests-that-cannot-fail`):
    //
    //   B(t) = (1-t)³P0 + 3(1-t)²t P1 + 3(1-t)t² P2 + t³P3
    //   x = 3(0.5625)(0.25)(2) + 3(0.75)(0.0625)(8) + (0.015625)(10) = 2.125
    //   y = 3(0.5625)(0.25)(4) + 3(0.75)(0.0625)(-4)                 = 1.125
    expect(boardHitCandidates(board, { x: 2.125 * MM, y: 1.125 * MM }, TOL)).toContain(ID);
  });

  it('and does NOT pick it from a point on the control polygon', () => {
    // (3.5, 2) is EXACTLY on the C1→C2 handle segment — a quarter of the way
    // along it — and 1.20 mm from the nearest point of the curve. The midpoint
    // of that segment would not do: (5, 0) is on the control polygon and on the
    // curve, by the symmetry of this fixture.
    expect(boardHitCandidates(board, { x: 3.5 * MM, y: 2 * MM }, TOL)).not.toContain(ID);
  });

  it('and not from the straight chord between its endpoints either', () => {
    // (7.5, 0) is exactly on the start→end chord and 1.01 mm from the curve.
    // The chord matters on its own because a FILLED bezier closes it — the fill
    // does, but the outline still must not.
    expect(boardHitCandidates(board, { x: 7.5 * MM, y: 0 }, TOL)).not.toContain(ID);
  });
});

describe('editing it', () => {
  const board = boardWith(CURVE);

  it('carries four handles in EDA_BEZIER_POINT_EDIT_BEHAVIOR’s order', () => {
    // START, CTRL_PT1, CTRL_PT2, END — the same order `MakePoints` adds them and
    // the same order the file stores them. A bezier had none at all before this,
    // because `curve` matched neither the `poly` guard nor any other.
    expect(boardEditHandles(board, ID)).toEqual([
      { kind: 'point', index: 0, at: { x: 0, y: 0 } },
      { kind: 'point', index: 1, at: { x: 2 * MM, y: 4 * MM } },
      { kind: 'point', index: 2, at: { x: 8 * MM, y: -4 * MM } },
      { kind: 'point', index: 3, at: { x: 10 * MM, y: 0 } },
    ]);
  });

  it('moves only the dragged point, since no bezier point constrains another', () => {
    const h = boardEditHandles(board, ID)[1]!;
    const next = dragBoardHandle(board, ID, h, { x: 3 * MM, y: 9 * MM });
    expect(next.shapes[0]?.pts).toEqual([
      { x: 0, y: 0 },
      { x: 3 * MM, y: 9 * MM },
      { x: 8 * MM, y: -4 * MM },
      { x: 10 * MM, y: 0 },
    ]);
  });

  it('draws the two control arms, so a handle says which end it belongs to', () => {
    // `AddIndicatorLine( START, CTRL_PT1 )` and `AddIndicatorLine( CTRL_PT2,
    // END )`. Not start→C2 and not a ring round all four: each arm ties one
    // control point to the endpoint whose tangent it sets.
    expect(boardIndicatorLines(board, ID)).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 2 * MM, y: 4 * MM } },
      { a: { x: 8 * MM, y: -4 * MM }, b: { x: 10 * MM, y: 0 } },
    ]);
  });

  it('and nothing else has any', () => {
    const poly = boardWith(
      '(gr_poly (pts (xy 0 0) (xy 1 0) (xy 1 1)) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))',
    );
    expect(boardIndicatorLines(poly, ID)).toEqual([]);
  });
});
