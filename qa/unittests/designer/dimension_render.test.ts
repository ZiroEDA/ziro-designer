// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dimensions in the board scene.
 * Counterpart: `PCB_PAINTER::draw( const PCB_DIMENSION_BASE* )`, which walks the
 * shapes `updateGeometry` produced and strokes them at the dimension's line
 * width, then draws the text.
 *
 * `buildScene` needs the browser's `Path2D`, which is why nothing has tested it
 * before (see the note in footprint_list.test.ts). A recording stub is enough:
 * every path operation the builder performs is a plain call with numbers, so
 * capturing them tells us exactly what geometry landed in which bucket. That is
 * the part worth testing — the actual stroking is the browser's job.
 *
 * What this does NOT establish is that a dimension *looks* right on screen. No
 * canvas is rendered here and none has been eyeballed.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

const MM = (n: number): number => mmToIU(n);

/** Records every path op instead of drawing, so a scene can be inspected. */
class RecordingPath2D {
  ops: Array<{ op: string; args: number[] }> = [];
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
  addPath(other: RecordingPath2D): void {
    this.ops.push(...other.ops);
  }
}

// Installed at module scope rather than in a hook: `buildScene` only constructs
// a Path2D when it is *called*, so this just has to be in place before the
// first test body runs, not before the import.
(globalThis as unknown as { Path2D: unknown }).Path2D = RecordingPath2D;

/** Verbatim from demos/cm5_minima, retargeted to a round position. */
const ORTHO = (layer = 'Dwgs.User', extra = ''): string => `(dimension
    (type orthogonal)
    (layer "${layer}")
    (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
    (pts (xy 100 60) (xy 130 60))
    (height 12.85)
    (orientation 0)
    ${extra}
    (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5))
    (gr_text "30" (at 115 75 0) (layer "${layer}")
      (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const CENTER = `(dimension
    (type center)
    (layer "F.SilkS")
    (uuid "6c3890f3-95ec-403d-a195-7e14eaa0059b")
    (pts (xy 106.5 90.75) (xy 106.5 87.25))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (extension_offset 0.5)))`;

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );

type Buckets = {
  gfxStrokes: Map<number, RecordingPath2D>;
  textBoard: Map<number, RecordingPath2D>;
};
const layerOf = (b: Board, layer: string): Buckets =>
  buildScene(b).layers.get(layer) as unknown as Buckets;

/** Every (moveTo, lineTo) pair in the layer's stroke buckets. */
const strokeSegments = (bk: Buckets): Array<[number[], number[]]> => {
  const out: Array<[number[], number[]]> = [];
  for (const p of bk.gfxStrokes.values()) {
    for (let i = 0; i + 1 < p.ops.length; i++) {
      if (p.ops[i]!.op === 'moveTo' && p.ops[i + 1]!.op === 'lineTo')
        out.push([p.ops[i]!.args, p.ops[i + 1]!.args]);
    }
  }
  return out;
};

describe('a dimension reaches the scene', () => {
  it('puts its lines on its own layer', () => {
    expect(strokeSegments(layerOf(read(ORTHO()), 'Dwgs.User')).length).toBeGreaterThan(0);
  });

  it('puts nothing on a layer it is not on', () => {
    const scene = buildScene(read(ORTHO('Dwgs.User')));
    const other = scene.layers.get('F.SilkS') as unknown as Buckets | undefined;

    expect(other ? strokeSegments(other).length : 0).toBe(0);
  });

  it('follows the layer it is given', () => {
    expect(strokeSegments(layerOf(read(ORTHO('F.SilkS')), 'F.SilkS')).length).toBeGreaterThan(0);
  });

  it('draws every segment the geometry produced', () => {
    // 2 extension lines + crossbar + 2 barbs at each end = 7 for an outward
    // orthogonal dimension.
    expect(strokeSegments(layerOf(read(ORTHO()), 'Dwgs.User'))).toHaveLength(7);
  });

  it('strokes them at the dimension line width, not a default', () => {
    const bk = layerOf(read(ORTHO()), 'Dwgs.User');

    expect([...bk.gfxStrokes.keys()]).toEqual([MM(0.1)]);
  });

  it('reaches the crossbar, which is off the feature line', () => {
    // The crossbar sits height (12.85 mm) below the measured points, so a
    // renderer that only drew between the feature points would miss it.
    const ys = strokeSegments(layerOf(read(ORTHO()), 'Dwgs.User')).flatMap(([a, b]) => [
      a[1]!,
      b[1]!,
    ]);

    expect(Math.max(...ys)).toBeGreaterThanOrEqual(MM(72));
  });
});

describe('the dimension text', () => {
  it('goes into the board-text bucket, so it gets the stroke font', () => {
    const bk = layerOf(read(ORTHO()), 'Dwgs.User');

    expect(bk.textBoard.size).toBeGreaterThan(0);
  });

  it('is left out when hidden', () => {
    const hidden = ORTHO().replace('(at 115 75 0)', '(at 115 75 0) (hide yes)');
    const bk = layerOf(read(hidden), 'Dwgs.User');

    expect(bk.textBoard.size).toBe(0);
  });

  it('is absent from a centre dimension, which carries none', () => {
    const bk = layerOf(read(CENTER), 'F.SilkS');

    expect(bk.textBoard.size).toBe(0);
    // ...but its two arms are still drawn.
    expect(strokeSegments(bk)).toHaveLength(2);
  });
});

describe('the scene bounding box', () => {
  it('grows to hold a dimension', () => {
    const bbox = buildScene(read(ORTHO())).bbox!;

    expect(bbox.minX).toBeLessThanOrEqual(MM(100));
    expect(bbox.maxX).toBeGreaterThanOrEqual(MM(130));
  });

  it('reaches past the feature points to the crossbar', () => {
    // Measured from the drawn lines, not from start/end — otherwise Zoom to Fit
    // would clip the crossbar and the arrows off the bottom.
    const bbox = buildScene(read(ORTHO())).bbox!;

    expect(bbox.maxY).toBeGreaterThanOrEqual(MM(72));
  });

  it('is still null for a board with nothing on it', () => {
    expect(buildScene(read()).bbox).toBeNull();
  });
});
