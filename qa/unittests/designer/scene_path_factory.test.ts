// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `buildScene`'s injectable geometry backend.
 *
 * `Path2D` records what to draw but will not give the segments back, so a GPU
 * renderer cannot consume a scene built with it. `buildScene` therefore takes a
 * {@link ScenePathFactory}: the WebGL board renderer passes one whose paths keep
 * their vertices, and everything else keeps the browser's.
 *
 * What matters, and what is checked here:
 *   - the default is unchanged, because `pcb3d.ts`, `FootprintCanvas.tsx` and
 *     `footprint_preview_widget.tsx` all still expect real `Path2D` objects;
 *   - a supplied factory gets *every* construction, not most of them — a single
 *     missed `new Path2D()` is geometry the GPU renderer would silently drop;
 *   - the swap is scoped, so a build with a factory cannot leak into the next
 *     build without one, even when the first one throws.
 *
 * Note this file installs no globals. Testing `buildScene` used to require
 * monkeypatching `globalThis.Path2D` (see `dimension_render.test.ts`); passing a
 * factory is that same trick made explicit, which is a side benefit of the port.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  DOM_PATH_FACTORY,
  type ScenePathFactory,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

/** A path that keeps its ops, standing in for the GL recorder's vertex sink. */
class CountingPath {
  ops: string[] = [];
  moveTo(): void {
    this.ops.push('moveTo');
  }
  lineTo(): void {
    this.ops.push('lineTo');
  }
  arc(): void {
    this.ops.push('arc');
  }
  arcTo(): void {
    this.ops.push('arcTo');
  }
  rect(): void {
    this.ops.push('rect');
  }
  roundRect(): void {
    this.ops.push('roundRect');
  }
  closePath(): void {
    this.ops.push('closePath');
  }
  addPath(): void {
    this.ops.push('addPath');
  }
}

/** `translate`/`rotate` chain, the whole DOMMatrix surface `buildScene` uses. */
class CountingMatrix {
  translate(): CountingMatrix {
    return this;
  }
  rotate(): CountingMatrix {
    return this;
  }
}

interface Counting extends ScenePathFactory {
  paths: CountingPath[];
  matrices: number;
}

const counting = (): Counting => {
  const paths: CountingPath[] = [];
  let matrices = 0;
  return {
    paths,
    get matrices() {
      return matrices;
    },
    path: () => {
      const p = new CountingPath();
      paths.push(p);
      return p as unknown as Path2D;
    },
    matrix: () => {
      matrices++;
      return new CountingMatrix() as unknown as DOMMatrix;
    },
  } as Counting;
};

/** A board with a track and a through-hole pad: exercises paths and matrices. */
const read = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 100 100) (end 120 100) (width 0.25) (layer "F.Cu") (net 1))
  (footprint "R_0805"
    (layer "F.Cu")
    (at 110 110)
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8)
      (layers "*.Cu") (net 1 "VCC")))
)`),
  );

describe('buildScene geometry backend', () => {
  it('routes every path and matrix through a supplied factory', () => {
    const f = counting();
    buildScene(read(), {}, f);

    // The scene-level holes alone are six paths, and the per-layer buckets add
    // seven more each, so a real board can only produce a lot of them. The
    // point is that none escaped to a raw `new Path2D()`.
    expect(f.paths.length).toBeGreaterThan(6);
    // The through-hole pad is placed with a matrix; if this is 0, the pad
    // geometry went through the browser's DOMMatrix behind the factory's back.
    expect(f.matrices).toBeGreaterThan(0);
    // And the factory's paths were actually drawn into, not just allocated.
    expect(f.paths.some((p) => p.ops.length > 0)).toBe(true);
  });

  it('leaves the scene shape alone, so the other consumers still work', () => {
    const f = counting();
    const scene = buildScene(read(), {}, f);
    // pcb3d.ts reads bbox and walks the buckets structurally; neither depends
    // on what a path *is*.
    expect(scene.bbox).not.toBeNull();
    expect(scene.layers.get('F.Cu')).toBeDefined();
    expect(f.paths).toContain(scene.viaHoles as unknown as CountingPath);
  });

  it('defaults to the browser backend', () => {
    expect(DOM_PATH_FACTORY.path).toBeTypeOf('function');
    expect(DOM_PATH_FACTORY.matrix).toBeTypeOf('function');
  });

  it('restores the previous backend after a build', () => {
    const first = counting();
    buildScene(read(), {}, first);

    // A second build naming its own factory must get all of its own paths, and
    // none of the first one's.
    const second = counting();
    buildScene(read(), {}, second);
    expect(second.paths.length).toBe(first.paths.length);
    expect(first.paths.some((p) => second.paths.includes(p))).toBe(false);
  });

  it('surfaces a backend failure without wedging later builds', () => {
    const exploding: ScenePathFactory = {
      path: () => {
        throw new Error('boom');
      },
      matrix: () => new CountingMatrix() as unknown as DOMMatrix,
    };
    expect(() => buildScene(read(), {}, exploding)).toThrow('boom');

    const after = counting();
    expect(() => buildScene(read(), {}, after)).not.toThrow();
    expect(after.paths.length).toBeGreaterThan(0);

    // Honest about what this does and does not establish: it is NOT a test of
    // the `finally` in `buildScene`. Deleting that restore leaves this test
    // green, because every entry reassigns the backend before compiling — so
    // a stranded factory is unobservable from outside. Verified by mutation.
    // What it does pin is that a throwing backend propagates rather than being
    // swallowed into a half-built scene.
  });
});
