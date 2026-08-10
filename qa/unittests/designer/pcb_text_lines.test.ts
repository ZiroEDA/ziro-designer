// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Line splitting, pad-text visibility and the place-origin marker.
 *
 * All three came out of putting our board beside pcbnew's with everything but
 * Edge.Cuts and the copper graphics hidden — a view small enough to measure
 * exactly, where each of these was a visible, reproducible difference.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { layoutText, splitTextLines } from '@ziroeda/common/src/font/stroke_font.js';
import { buildScene, drawNetNames } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';

const MM = 1e6;

describe('splitTextLines (wxStringSplit)', () => {
  it('drops a trailing empty line but keeps interior ones', () => {
    // The coldfire demo's `(gr_text "JTAG_EN\n")`: one line, not two.
    expect(splitTextLines('JTAG_EN\n')).toEqual(['JTAG_EN']);
    expect(splitTextLines('a\n\nb')).toEqual(['a', '', 'b']);
    // Only ONE trailing empty goes, exactly as the C++ loop leaves things.
    expect(splitTextLines('a\n\n')).toEqual(['a', '']);
    expect(splitTextLines('plain')).toEqual(['plain']);
  });

  it('does not shift a trailing-newline text off its anchor', () => {
    // A block of n lines is centred on the anchor, so counting one line too
    // many lifts the text by half an interline (1.68 · size / 2).
    const size = 1 * MM;
    const one = layoutText('JTAG_EN', size);
    const trailing = layoutText('JTAG_EN\n', size);
    const top = (r: { strokes: { y: number }[][] }): number =>
      Math.min(...r.strokes.flat().map((p) => p.y));
    expect(top(trailing)).toBeCloseTo(top(one), 6);
    // Two real lines still centre as a block: the first rises by 0.84 · size.
    const two = layoutText('JTAG_EN\nX', size);
    expect(top(one) - top(two)).toBeCloseTo(0.84 * size, 0);
  });
});

const padBoard = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (setup (aux_axis_origin 65.151 148.4122))
  (footprint "R"
    (layer "F.Cu")
    (at 100 100)
    (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 1 "VCC")))
)`),
  );

/**
 * The per-frame pass builds its glyph runs with `Path2D`, which Node has no
 * business owning; the geometry is irrelevant here, only whether anything was
 * handed to `stroke` at all.
 */
const withPath2D = (fn: () => void): void => {
  const real = globalThis.Path2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Path2D = class {
    moveTo(): void {}
    lineTo(): void {}
  };
  try {
    fn();
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Path2D = real;
  }
};

/** A 2D-context stand-in that counts stroked paths. */
const recordingCtx = (): { ctx: CanvasRenderingContext2D; strokes: () => number } => {
  let n = 0;
  const ctx = {
    setTransform: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    lineWidth: 0,
    stroke: () => {
      n++;
    },
    // renderBoard strokes glyph runs through Path2D objects it builds itself.
    fill: () => {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, strokes: () => n };
};

describe('pad text follows copper-layer visibility', () => {
  // GL paths, so no browser Path2D is needed to hold the geometry.
  const scene = buildScene(padBoard(), {}, GL_PATH_FACTORY);

  it('records the pad label with the copper layers it flashes on', () => {
    expect(scene.padLabels).toHaveLength(1);
    expect(scene.padLabels[0]!.layers).toEqual(['F.Cu']);
  });

  it('draws pad text when its layer is visible and not when it is hidden', () => {
    // 40 px/mm: the 2 mm pad is 80 px, far past PAD::ViewGetLOD's 0.5 mm.
    const view = { scale: 40 / MM, tx: 400 - 100 * MM * (40 / MM), ty: 300 - 100 * MM * (40 / MM) };
    const shown = recordingCtx();
    withPath2D(() => drawNetNames(shown.ctx, scene, view, new Set(['F.Cu']), 800, 600));
    expect(shown.strokes()).toBeGreaterThan(0);

    // Hiding every copper layer must take the numbers and net names with it —
    // they used to keep drawing over an otherwise empty board.
    const hidden = recordingCtx();
    withPath2D(() => drawNetNames(hidden.ctx, scene, view, new Set(['Edge.Cuts']), 800, 600));
    expect(hidden.strokes()).toBe(0);
  });
});
