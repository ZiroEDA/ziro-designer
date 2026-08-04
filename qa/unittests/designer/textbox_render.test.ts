// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text boxes in the board scene.
 * Counterpart: `PCB_PAINTER::draw( const PCB_TEXTBOX* )`, which strokes the
 * corners at the box's line width and then draws the text inside.
 *
 * The decision worth testing is that **the border and the text are separate**:
 * `border no` is a legitimate setting meaning "text with invisible margins",
 * so the text must still be drawn. Tying the two together would make such a box
 * vanish entirely, while still being selectable — the worst of both.
 *
 * Uses the recording `Path2D` stub introduced with the dimension renderer;
 * `buildScene` needs the browser's, and none of this renders a canvas. What a
 * text box *looks* like on screen is still unverified.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

const MM = (n: number): number => mmToIU(n);

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
(globalThis as unknown as { Path2D: unknown }).Path2D = RecordingPath2D;

const BOX = (over = ''): string =>
  `(gr_text_box "boxed"
    (start 50 50) (end 60 56)
    (margins 1 1 1 1)
    (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000005")
    (effects (font (size 1 1) (thickness 0.15)))
    (border yes)
    (stroke (width 0.12) (type solid))
    (knockout no))`.replace('(border yes)', over || '(border yes)');

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );

type Buckets = {
  gfxStrokes: Map<number, RecordingPath2D>;
  textBoard: Map<number, RecordingPath2D>;
};
const layerOf = (b: Board, layer = 'F.SilkS'): Buckets =>
  buildScene(b).layers.get(layer) as unknown as Buckets;

const strokeOps = (bk: Buckets): Array<{ op: string; args: number[] }> =>
  [...bk.gfxStrokes.values()].flatMap((p) => p.ops);

describe('the border', () => {
  it('is drawn as a closed outline at the box line width', () => {
    const bk = layerOf(read(BOX()));

    expect([...bk.gfxStrokes.keys()]).toEqual([MM(0.12)]);
    expect(strokeOps(bk).filter((o) => o.op === 'closePath')).toHaveLength(1);
  });

  it('traces all four corners', () => {
    const ops = strokeOps(layerOf(read(BOX())));
    const pts = ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');

    expect(pts).toHaveLength(4);
    expect(pts[0]!.args).toEqual([MM(50), MM(50)]);
  });

  it('is left out entirely when border is off', () => {
    const bk = layerOf(read(BOX('(border no)')));

    expect(strokeOps(bk)).toHaveLength(0);
  });
});

describe('the text', () => {
  it('is drawn inside the box', () => {
    expect(layerOf(read(BOX())).textBoard.size).toBeGreaterThan(0);
  });

  it('is still drawn when the border is off', () => {
    // `border no` means text with invisible margins, not an invisible item.
    expect(layerOf(read(BOX('(border no)'))).textBoard.size).toBeGreaterThan(0);
  });

  it('is left out when the box is empty', () => {
    const empty = BOX().replace('"boxed"', '""');

    expect(layerOf(read(empty)).textBoard.size).toBe(0);
  });
});

describe('the scene bounding box', () => {
  it('grows to hold the box', () => {
    const bbox = buildScene(read(BOX())).bbox!;

    expect(bbox.minX).toBeLessThanOrEqual(MM(50));
    expect(bbox.maxY).toBeGreaterThanOrEqual(MM(56));
  });

  it('grows even when the border is off', () => {
    // The item still occupies space, and Zoom to Fit must not clip it away.
    const bbox = buildScene(read(BOX('(border no)'))).bbox!;

    expect(bbox.maxX).toBeGreaterThanOrEqual(MM(60));
  });
});
