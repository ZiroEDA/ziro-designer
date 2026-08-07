// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Recording a board into GPU geometry.
 *
 * These check the two properties the WebGL backend is built on, both of which
 * fail silently:
 *
 *  - **The board actually records.** `buildDrawSteps` draws through a context
 *    surface; hand it a recorder and geometry should come out. If the scene were
 *    built with the default `Path2D` instead of `GL_PATH_FACTORY`, every bucket
 *    would be opaque and the whole board would record as nothing — a blank
 *    canvas, no error.
 *  - **The recording does not depend on the zoom.** That is the entire reason
 *    for a retained buffer: if geometry changes with the view scale, the buffer
 *    has to be rebuilt on every zoom step and the port is pointless. This is the
 *    exact regression the schematic port shipped and had to undo.
 *
 * No canvas is created and nothing is rasterised, so this says nothing about
 * whether the board *looks* right. That needs the browser.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { buildScene, DEFAULT_DRAW_OPTIONS } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { Scene, SEGMENT_STRIDE } from '@ziroeda/designer/src/render/gl/scene.js';
import { recordBoardScene } from '@ziroeda/designer/src/render/gl/pcb_gl.js';

const board = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 100 100) (end 120 100) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 120 100) (end 120 118) (width 0.25) (layer "F.Cu") (net 1))
  (gr_line (start 90 90) (end 130 90) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))
  (footprint "R_0805"
    (layer "F.Cu")
    (at 110 110)
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8)
      (layers "*.Cu") (net 1 "VCC"))
    (pad "2" smd rect (at 2 0) (size 1 1.2) (layers "F.Cu") (net 1 "VCC")))
)`),
  );

const VISIBLE = new Set(['F.Cu', 'B.Cu', 'Edge.Cuts']);

const record = (viewScale: number): Scene => {
  const s = new Scene();
  recordBoardScene(
    s,
    {
      scene: buildScene(board(), {}, GL_PATH_FACTORY),
      visible: VISIBLE,
      opts: DEFAULT_DRAW_OPTIONS,
      emphasis: 'none',
    },
    viewScale,
  );
  return s;
};

describe('recordBoardScene', () => {
  it('records a board into GPU primitives', () => {
    const s = record(1e-5);
    // Tracks and the board outline are strokes; pads and the zone-less copper
    // are fills. Both kinds have to be there or something is being dropped.
    expect(s.segmentCount).toBeGreaterThan(0);
    expect(s.triangleVertexCount).toBeGreaterThan(0);
    expect(s.isEmpty).toBe(false);
  });

  it('records world coordinates, not view coordinates', () => {
    // The board sits around (100..130 mm, 90..118 mm); pcbnew's IU is 1 nm, so
    // that is 1e8..1.3e8. If the view transform were left baked in, these would
    // come out around the canvas extent instead, and the buffer would be wrong
    // at every zoom but the one it was recorded at.
    const seg = record(1e-5).segments.view();
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < seg.length; i += SEGMENT_STRIDE) {
      minX = Math.min(minX, seg[i]!, seg[i + 2]!);
      maxX = Math.max(maxX, seg[i]!, seg[i + 2]!);
    }
    expect(minX / 1e6).toBeGreaterThan(80); // mm
    expect(maxX / 1e6).toBeLessThan(140);
  });

  it('produces the same geometry at any zoom', () => {
    // The property the retained buffer exists for. Recording at scales two
    // octaves apart must give byte-identical vertices; if it does not, every
    // zoom step costs a full re-record and the port has bought nothing.
    const a = record(1e-5).segments.view();
    const b = record(4e-5).segments.view();
    expect(a.length).toBe(b.length);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
    expect(worst).toBe(0);
  });
});
