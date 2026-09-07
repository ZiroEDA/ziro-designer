// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GlPath` has to answer every path call `buildScene` makes, and a cast is what
 * stops the compiler from saying so.
 *
 * `GL_PATH_FACTORY` hands `buildScene` a `GlPath` cast to `Path2D` — deliberate,
 * so that `pcb3d.ts` and the footprint canvases keep the concrete type. The
 * consequence is that `GlPath`'s surface is checked by nothing: a method
 * `renderBoard` starts calling and `GlPath` has not got is a TypeError at run
 * time, inside the scene build, which is the whole board.
 *
 * That is not hypothetical. `bezierCurveTo` was left off on the stated grounds
 * that a caller reaching for it would "fail loudly at the type level instead of
 * silently dropping geometry"; the day `renderBoard` learned to stroke a
 * `gr_curve` as a curve, every board with one in it failed to open at all —
 * "Couldn't open board: l.bezierCurveTo is not a function" — with no board and
 * no way back. The type level was never consulted, because of the cast.
 *
 * So the check is behavioural and the fixture is the thing that has to stay
 * honest: one shape of every kind the reader accepts, compiled through the GL
 * factory. The kind list is read back out of `read-board.ts` rather than
 * written here, so a seventh `SHAPE_T` cannot be added without this failing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY, GlPath, asGlPath } from '@ziroeda/designer/src/render/gl/gl_path.js';

const MM = 1e6;

/** One `gr_*` of every kind, keyed by the token the reader matches on. */
const SHAPES: Readonly<Record<string, string>> = {
  line: '(gr_line (start 0 0) (end 5 5) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))',
  arc: '(gr_arc (start 0 0) (mid 3 1) (end 5 5) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))',
  circle:
    '(gr_circle (center 2 2) (end 4 2) (stroke (width 0.1) (type solid)) (fill yes) (layer "F.SilkS"))',
  rect: '(gr_rect (start 0 0) (end 5 3) (stroke (width 0.1) (type solid)) (fill no) (layer "F.SilkS"))',
  poly: '(gr_poly (pts (xy 0 0) (xy 5 0) (xy 5 5)) (stroke (width 0.1) (type solid)) (fill yes) (layer "F.SilkS"))',
  curve:
    '(gr_curve (pts (xy 0 0) (xy 2 4) (xy 8 -4) (xy 10 0)) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))',
};

const READER = readFileSync(
  fileURLToPath(new URL('../../../pcbnew/src/read-board.ts', import.meta.url)),
  'utf8',
);

describe('the fixture covers what the reader accepts', () => {
  it('has one shape of every kind readShape will build', () => {
    // `if (!['line', 'arc', 'circle', 'rect', 'poly', 'curve'].includes(kind)) return null;`
    // — read back rather than restated, so this file cannot quietly fall behind
    // the reader. A test whose fixture is a copy of the list it is checking is
    // one of the four shapes that cannot fail.
    const m = READER.match(/if \(!\[([^\]]+)\]\.includes\(kind\)\) return null;/);
    expect(m).not.toBeNull();
    const kinds = [...m![1]!.matchAll(/'([a-z]+)'/g)].map((x) => x[1]!);
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(Object.keys(SHAPES))).toEqual(new Set(kinds));
  });
});

describe('compiling a board for the GPU', () => {
  const board = readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (37 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${Object.values(SHAPES).join('\n  ')}
)`),
  );

  it('answers every path call each shape kind makes', () => {
    // The assertion IS that it does not throw: a missing method on `GlPath` is
    // a TypeError here and an unopenable board in the app.
    expect(() => buildScene(board, {}, GL_PATH_FACTORY)).not.toThrow();
  });

  // The DOM factory is not exercised here: `Path2D` is a browser global and
  // happy-dom does not provide one. `pcb_bezier_render.test.ts` covers that
  // side by handing `buildScene` a recording path of its own.
});

describe('a cubic recorded into a GlPath', () => {
  // The curve from the fixture, as its own control points.
  const P0 = { x: 0, y: 0 };
  const C1 = { x: 2 * MM, y: 4 * MM };
  const C2 = { x: 8 * MM, y: -4 * MM };
  const P3 = { x: 10 * MM, y: 0 };

  // Built inside a helper rather than at describe scope: describe bodies run at
  // COLLECTION, so a missing method there fails the whole file with "no tests"
  // and masks the buildScene case above, which is the one that mirrors the real
  // crash.
  const record = (): { x: number; y: number }[] => {
    const path = new GlPath();
    path.moveTo(P0.x, P0.y);
    path.bezierCurveTo(C1.x, C1.y, C2.x, C2.y, P3.x, P3.y);
    return asGlPath(path as unknown as Path2D).subpaths[0]!.pts;
  };

  /** B(t), evaluated here rather than asked of the tessellator. */
  const B = (t: number): { x: number; y: number } => {
    const u = 1 - t;
    const w = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
    return {
      x: w[0]! * P0.x + w[1]! * C1.x + w[2]! * C2.x + w[3]! * P3.x,
      y: w[0]! * P0.y + w[1]! * C1.y + w[2]! * C2.y + w[3]! * P3.y,
    };
  };

  it('starts at the current point and ends at the end point', () => {
    const pts = record();
    // `pts[0]` of the flattening IS the start, and the subpath already had it
    // from the `moveTo` — emitting it twice would leave a zero-length segment
    // in the stroke buffer for every curve on the board.
    expect(pts[0]).toEqual(P0);
    expect(pts[1]).not.toEqual(P0);
    expect(pts.at(-1)).toEqual(P3);
  });

  it('follows the curve rather than the control polygon', () => {
    const pts = record();
    // Every recorded vertex lies ON the cubic, to within a nanometre of the
    // rounding `BEZIER_POLY::GetPoly`'s integer form applies. The control
    // polygon is over a millimetre away at its worst here, so this cannot pass
    // for a polyline through the handles.
    // Measured against a dense SAMPLING OF SEGMENTS, not of points: sampling
    // points alone puts a floor of half the sample spacing on every answer, and
    // over a 10 mm curve that floor is larger than the thing being measured.
    const fine: { x: number; y: number }[] = [];
    for (let i = 0; i <= 20000; i++) fine.push(B(i / 20000));
    const toSeg = (
      q: { x: number; y: number },
      a: (typeof fine)[0],
      b: (typeof fine)[0],
    ): number => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
      return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
    };
    const off = pts.map((q) => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 1; i < fine.length; i++) best = Math.min(best, toSeg(q, fine[i - 1]!, fine[i]!));
      return best;
    });
    // A nanometre, which is the rounding `BEZIER_POLY::GetPoly`'s integer form
    // applies and nothing else.
    expect(Math.max(...off)).toBeLessThan(1);
  });

  it('is flattened finely enough to be invisible, and not more', () => {
    const pts = record();
    // `PCB_ARC_TOLERANCE` is 0.005 mm — `ARC_HIGH_DEF`, the same number
    // `m_MaxError` defaults to. A deep S over 10 mm lands in the tens of
    // segments: enough that no facet shows, few enough that the vertex buffer
    // is not paying for a curve nobody can see.
    expect(pts.length).toBeGreaterThan(8);
    expect(pts.length).toBeLessThan(200);
  });

  it('starts a subpath at the FIRST CONTROL POINT when there is no current one', () => {
    // The Canvas2D spec's degenerate case: "if the object's path has no
    // subpaths, then ensure there is a subpath with (cp1x, cp1y)". Not the
    // curve's start, which does not exist yet.
    const bare = new GlPath();
    bare.bezierCurveTo(C1.x, C1.y, C2.x, C2.y, P3.x, P3.y);
    expect(asGlPath(bare as unknown as Path2D).subpaths[0]!.pts[0]).toEqual(C1);
  });
});
