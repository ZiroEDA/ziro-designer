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
import { buildScene, drawAnchors } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';

const MM = 1e6;

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
  const text = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
    'utf8',
  );

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

  it('the frame hands drawAnchors the delta the GPU applied', () => {
    // The unit tests above exercise `drawAnchors`; this is the wiring that
    // decides whether it is ever told anything, and it cannot be reached
    // without mounting the editor. Read as text for the same reason
    // view_controls_coverage.test.ts reads its call sites.
    const i = text.indexOf('drawAnchors(');
    expect(i).toBeGreaterThan(-1);
    const call = text.slice(i, text.indexOf(');', i));
    expect(call).toContain('dragAffectedRef.current');
    expect(call).toMatch(/applied\.x/);
    expect(call).toMatch(/applied\.y/);
    // And `applied` is the in-place delta, not the raw pointer delta: the GPU
    // may have taken fewer frames than the cursor moved.
    expect(text.slice(Math.max(0, i - 400), i)).toContain(
      'const applied = inPlaceMoveRef.current;',
    );
  });
});
