// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a `PCB_POINT` puts on the canvas, and the two switches that hide it.
 *
 * `PCB_PAINTER::draw( const PCB_POINT*, int )` (`pcb_painter.cpp:3225-3269`):
 *
 *     double size = (double) aPoint->GetSize() / 2;
 *     double thickness = m_pcbSettings.m_outlineWidth;
 *     COLOR4D crossColor = m_pcbSettings.GetColor( aPoint, LAYER_POINTS );
 *     COLOR4D ringColor  = m_pcbSettings.GetColor( aPoint, aPoint->GetLayer() );
 *     …
 *     // Draw as X to make it clearer when overlaid on cursor or axes
 *     m_gal->DrawLine( { -size, -size }, {  size,  size } );
 *     m_gal->DrawLine( {  size, -size }, { -size,  size } );
 *     m_gal->SetStrokeColor( ringColor );
 *     m_gal->DrawCircle( { 0, 0 }, size / 2 );
 *
 * Two colours in one marker is the part that is easy to get wrong, and it is
 * the part a user reads: the X says "this is a point" whatever layer it is on,
 * and the ring says which layer that is.
 *
 * The two switches are `PCB_POINT::ViewGetLOD` (`pcb_point.cpp:119-129`), which
 * returns LOD_HIDE when LAYER_POINTS is off **or** when the point's own board
 * layer is off. Either alone would leave half the marker showing.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  buildDrawSteps,
  DEFAULT_DRAW_OPTIONS,
  type ScenePathFactory,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { PCB_LAYER_COLORS, PCB_SPECIAL } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';

const MM = 1e6;

interface Op {
  op: string;
  args: number[];
}

/** A Path2D that keeps what was recorded into it. */
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

/** Every `stroke(path)` a pass made, with the style in force at the time. */
interface Stroke {
  path: RecordingPath;
  style: string;
  width: number;
}
function strokes(board: Board, opts = {}, visible = ['F.Cu', 'F.SilkS']): Stroke[] {
  const scene = buildScene(board, {}, FACTORY);
  const out: Stroke[] = [];
  let style = '';
  let width = 0;
  const ctx = {
    set strokeStyle(v: string) {
      style = v;
    },
    set lineWidth(v: number) {
      width = v;
    },
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
    fill: () => {},
    fillText: () => {},
    measureText: () => ({ width: 0 }),
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    clip: () => {},
    drawImage: () => {},
    stroke: (p?: Path2D) => {
      if (p) out.push({ path: rec(p), style, width });
    },
  } as unknown as CanvasRenderingContext2D;

  for (const step of buildDrawSteps(
    ctx,
    scene,
    { scale: 1, tx: 0, ty: 0, flipX: false },
    new Set(visible),
    800,
    600,
    { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false, ...opts },
  ))
    step();
  return out;
}

const boardWith = (...items: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (37 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${items.join('\n  ')}
)`),
  );

/** One 2 mm point at (10, 20) on F.SilkS. */
const POINT = '(point (at 10 20) (size 2) (layer "F.SilkS"))';

/** The X, identified by the two diagonal strokes it is alone in drawing. */
const crossOf = (s: Stroke[]): Stroke | undefined =>
  s.find((x) => x.path.ops.filter((o) => o.op === 'lineTo').length === 2 && x.path.ops.length === 4);
const ringOf = (s: Stroke[]): Stroke | undefined =>
  s.find((x) => x.path.ops.some((o) => o.op === 'arc'));

describe('the marker', () => {
  it('draws an X spanning the full size, corner to corner', () => {
    // `size` in the C++ is `GetSize() / 2`, and the arms run from `-size` to
    // `+size` — so a 2 mm point's X is 2 mm wide, one millimetre each way.
    const cross = crossOf(strokes(boardWith(POINT)));

    expect(cross).toBeDefined();
    expect(cross!.path.ops).toEqual([
      { op: 'moveTo', args: [9 * MM, 19 * MM] },
      { op: 'lineTo', args: [11 * MM, 21 * MM] },
      { op: 'moveTo', args: [11 * MM, 19 * MM] },
      { op: 'lineTo', args: [9 * MM, 21 * MM] },
    ]);
  });

  it('and a ring of a quarter of the size', () => {
    // `DrawCircle( { 0, 0 }, size / 2 )` with `size` already halved — so the
    // radius is `GetSize() / 4`, 0.5 mm here.
    const ring = ringOf(strokes(boardWith(POINT)));

    expect(ring).toBeDefined();
    const arc = ring!.path.ops.find((o) => o.op === 'arc')!;
    expect(arc.args[0]).toBe(10 * MM);
    expect(arc.args[1]).toBe(20 * MM);
    expect(arc.args[2]).toBe(0.5 * MM);
  });

  it('strokes the X in LAYER_POINTS and the ring in the point’s own layer', () => {
    // The whole reason the marker is two paths. A single-colour marker would
    // pass every geometry check above and still be the wrong picture.
    const s = strokes(boardWith(POINT));

    expect(crossOf(s)!.style).toBe(PCB_SPECIAL.points);
    expect(ringOf(s)!.style).toBe(PCB_LAYER_COLORS['F.SilkS']);
    expect(crossOf(s)!.style).not.toBe(ringOf(s)!.style);
  });

  it('at m_outlineWidth, which is GAL’s minimum pen and not the layer’s', () => {
    // `thickness = m_pcbSettings.m_outlineWidth` — 1 IU (render_settings.cpp),
    // so it is the minimum pen the view resolves and nothing else. At scale 1
    // that is one world unit.
    expect(crossOf(strokes(boardWith(POINT)))!.width).toBe(1);
  });
});

describe('ViewGetLOD’s two switches', () => {
  it('hides every point when the Objects tab’s Points row is off', () => {
    // `if( !aView->IsLayerVisible( LAYER_POINTS ) ) return LOD_HIDE` — whatever
    // the point's own layer is doing.
    const s = strokes(boardWith(POINT), { points: false });

    expect(crossOf(s)).toBeUndefined();
    expect(ringOf(s)).toBeUndefined();
  });

  it('hides a point whose own layer is hidden', () => {
    // `if( !aView->IsLayerVisible( m_layer ) ) return LOD_HIDE`. Both halves
    // go: a ring without its X, or an X without its ring, is not a marker.
    const s = strokes(boardWith(POINT), {}, ['F.Cu']);

    expect(crossOf(s)).toBeUndefined();
    expect(ringOf(s)).toBeUndefined();
  });

  it('and shows it when both are on, so the checks above are not vacuous', () => {
    expect(crossOf(strokes(boardWith(POINT)))).toBeDefined();
  });
});

describe('a footprint’s own points', () => {
  it('draw through the same painter', () => {
    // `FOOTPRINT::Points()` — not graphics and not pads, so they need a pass of
    // their own in the scene build. Without one a `.kicad_mod` full of snap
    // points opens blank in the footprint editor.
    const b = boardWith(`(footprint "T" (layer "F.Cu") (at 100 50)
      (point (at 1 2) (size 2) (layer "F.SilkS")))`);
    const cross = crossOf(strokes(b));

    expect(cross).toBeDefined();
    // Board coordinates: the footprint sits at (100, 50).
    expect(cross!.path.ops[0]!.args).toEqual([100 * MM, 51 * MM]);
  });
});

describe('the scene measures them', () => {
  it('grows the bounding box by the marker, so zoom-to-fit does not crop it', () => {
    // The box is what zoom-to-fit reads. A point outside every other item — the
    // case a snap anchor placed off to one side is — would be scrolled out of
    // view by a build that recorded its geometry without measuring it.
    const box = buildScene(boardWith(POINT), {}, FACTORY).bbox;

    expect(box).not.toBeNull();
    expect(box!.minX).toBeLessThanOrEqual(9 * MM);
    expect(box!.maxX).toBeGreaterThanOrEqual(11 * MM);
    expect(box!.minY).toBeLessThanOrEqual(19 * MM);
    expect(box!.maxY).toBeGreaterThanOrEqual(21 * MM);
  });
});
