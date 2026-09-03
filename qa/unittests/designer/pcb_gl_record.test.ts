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
import { Scene, SEGMENT_STRIDE, type RunKind } from '@ziroeda/designer/src/render/gl/scene.js';
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

/** The same board with a reference image dropped on it. */
const boardWithImage = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (segment (start 100 100) (end 120 100) (width 0.25) (layer "F.Cu") (net 0))
  (image (at 110 105) (layer "F.Cu")
    (data "aVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUFFQUFBQUJDQVlBQUFBZkZjU0pBQUFBQzBsRVFWUjQybUw4"))
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

/**
 * Painter's order across the three primitive kinds.
 *
 * Each buffer keeps its own order, but the device also has to know how they
 * interleave. Drawing every fill, then every stroke, then every disc is a
 * different picture on a board: `buildDrawSteps` paints layer by layer through
 * `PCB_PAINT_ORDER`, so an inner-layer track belongs *under* the front copper
 * pour, and hoisting every stroke above every fill lays every inner-layer track
 * over the top of every pour.
 *
 * That shipped, and nothing here caught it, because nothing in Node composites
 * anything. The *order*, though, is perfectly visible from Node — which is what
 * these pin.
 */
const recordOrdered = (b: Board = board()): Scene => {
  const s = new Scene(true);
  recordBoardScene(
    s,
    {
      scene: buildScene(b, {}, GL_PATH_FACTORY),
      visible: VISIBLE,
      opts: DEFAULT_DRAW_OPTIONS,
      emphasis: 'none',
    },
    1e-5,
  );
  return s;
};

/** The same board with `n` extra tracks: more geometry, no more layers. */
const boardWithTracks = (n: number): Board => {
  const segs: string[] = [];
  for (let i = 0; i < n; i++) {
    const y = 100 + (i % 50) * 0.4;
    const x = 100 + Math.floor(i / 50) * 0.4;
    segs.push(
      `(segment (start ${x} ${y}) (end ${x + 0.3} ${y}) (width 0.25) (layer "F.Cu") (net 1))`,
    );
  }
  return readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (gr_line (start 90 90) (end 130 90) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))
  ${segs.join('\n  ')}
)`),
  );
};

describe('an ordered scene records painter order across the primitive kinds', () => {
  it('partitions every buffer completely and contiguously', () => {
    const s = recordOrdered();
    // Nothing may be dropped, duplicated or reordered: read in sequence, the
    // runs have to walk each buffer from its start to its end exactly once.
    // Every kind, including `image`: `Record<RunKind, …>` is exhaustive on
    // purpose, so adding a primitive to the scene makes this fail to compile
    // rather than quietly skipping the new buffer's partition check.
    const next: Record<RunKind, number> = { tri: 0, seg: 0, disc: 0, glyph: 0, image: 0 };
    for (const run of s.runs) {
      expect(run.start).toBe(next[run.kind]);
      expect(run.count).toBeGreaterThan(0);
      next[run.kind] = run.start + run.count;
    }
    expect(next.tri).toBe(s.triangleVertexCount);
    expect(next.seg).toBe(s.segmentCount);
    expect(next.disc).toBe(s.discCount);
    expect(next.glyph).toBe(s.glyphVertexCount);
    // The board records no bitmaps, so this run stays empty — but it is
    // asserted rather than omitted, since "no image runs" is the claim.
    expect(next.image).toBe(0);
  });

  it('keeps a fill recorded after a stroke after it', () => {
    // The one thing the three-draw path cannot express, and the whole reason
    // this exists: a board interleaves, each layer filling and stroking before
    // the next one starts.
    const kinds = recordOrdered().runs.map((r) => r.kind);
    expect(kinds.length).toBeGreaterThan(1);
    const firstSeg = kinds.indexOf('seg');
    expect(firstSeg).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('tri', firstSeg)).toBeGreaterThan(firstSeg);
  });

  it('costs draw calls in layers and buckets, not in board size', () => {
    // Runs become draw calls. If they grew with the geometry this would have
    // traded one scaling cost for another and bought nothing.
    const small = recordOrdered(boardWithTracks(20));
    const large = recordOrdered(boardWithTracks(2000));
    expect(large.segmentCount).toBeGreaterThan(small.segmentCount * 10);
    expect(large.runs.length).toBe(small.runs.length);
  });

  it('leaves an unordered scene empty of runs, so the schematic still costs three draws', () => {
    // Opt-in: a schematic alternates per *item*, so ordering it would cost
    // thousands of draw calls a frame to fix a difference nobody can see.
    expect(record(1e-5).runs).toHaveLength(0);
  });
});

/**
 * Everything on a `BoardScene` that is *not* a path.
 *
 * `PcbEditor` swaps the factory the board is compiled through when the GL layer
 * is drawing, and it reads three things off the resulting scene that have
 * nothing to do with the backend: `bbox` for zoom-to-fit, `images` for the
 * decode-and-blit pass, `netLabels` for the zoom-dependent track names. All
 * three are computed alongside the paths rather than from them, so a factory
 * swap has no business changing them — and if it did, the symptom would be
 * zoom-to-fit landing on empty space, or net labels quietly disappearing,
 * neither of which reads as a renderer bug.
 */
describe('a GL-compiled scene keeps what the editor reads that is not a path', () => {
  it('measures the same bounding box', () => {
    const scene = buildScene(board(), {}, GL_PATH_FACTORY);
    expect(scene.bbox).not.toBeNull();
    // The board spans 90..130 mm in X and 90..118 mm in Y, plus stroke widths
    // and the pads' own extent. pcbnew's IU is 1 nm.
    const bb = scene.bbox!;
    expect(bb.minX / 1e6).toBeGreaterThan(85);
    expect(bb.minX / 1e6).toBeLessThan(91);
    expect(bb.maxX / 1e6).toBeGreaterThan(129);
    expect(bb.maxX / 1e6).toBeLessThan(135);
  });

  it('still carries the track net labels', () => {
    const scene = buildScene(board(), {}, GL_PATH_FACTORY);
    expect(scene.netLabels.map((l) => l.text)).toContain('VCC');
  });

  it('still reports a reference image, which is why the board falls back', () => {
    // The editor's one hard reason to keep a board on Canvas2D: `GlRecorder`
    // has no `drawImage`, so a picture recorded into a vertex buffer is a
    // picture lost. The fallback is only possible because the scene says so
    // here — and it has to say so through *this* factory, since the scene the
    // editor tests is the one it just compiled for the GPU.
    const scene = buildScene(boardWithImage(), {}, GL_PATH_FACTORY);
    expect(scene.images).toHaveLength(1);
    expect(scene.images[0]!.layer).toBe('F.Cu');
  });
});

/**
 * Which of KiCad's two rasterisers each stroke imitates.
 *
 * A **line** is clamped up to `u_minLinePixelWidth` and drawn solid, so a
 * 0.05 mm courtyard rectangle is still a crisp magenta line on a board zoomed
 * out to fit. **Bitmap text** takes no floor and simply gets fainter as it
 * shrinks; we stroke those glyphs, so they have to fade instead.
 *
 * Recording every stroke the second way is what made courtyards, silkscreen
 * outlines and zone borders disappear from a zoomed-out board that KiCad still
 * draws them on. The sign of the per-vertex `minPx` carries the distinction, so
 * it is visible from Node even though the consequence is not.
 */
describe('hairline rule per stroke', () => {
  /** Distinct signed minPx values across the segment buffer. */
  const minPxSigns = (s: Scene): Set<number> => {
    const seg = s.segments.view();
    const out = new Set<number>();
    for (let i = 0; i < seg.length; i += SEGMENT_STRIDE) out.add(Math.sign(seg[i + 5]!));
    return out;
  };

  it('records board geometry as solid lines', () => {
    // A board with no pad numbers and no net names on it: every stroke is
    // geometry, so every one must be negative (solid).
    const b = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (net 0 "")
  (gr_line (start 90 90) (end 130 90) (stroke (width 0.05) (type solid)) (layer "Edge.Cuts"))
  (segment (start 100 100) (end 120 100) (width 0.25) (layer "F.Cu") (net 0))
)`),
    );
    const s = new Scene(true);
    recordBoardScene(
      s,
      {
        scene: buildScene(b, {}, GL_PATH_FACTORY),
        visible: VISIBLE,
        opts: DEFAULT_DRAW_OPTIONS,
        emphasis: 'none',
      },
      1e-5,
    );
    expect(s.segmentCount).toBeGreaterThan(0);
    expect(minPxSigns(s)).toEqual(new Set([-1]));
  });

  it('records no pad text at all — that pass is per-frame now', () => {
    // Pad numbers and net names are gated by PAD::ViewGetLOD against the
    // *current* zoom and must not compound where they overlap, so they draw
    // with the track and via names in the per-frame netname pass
    // (drawNetNames) and never enter a retained recording. A recording of a
    // board with pads therefore carries only lines.
    const s = new Scene(true);
    recordBoardScene(
      s,
      {
        scene: buildScene(board(), {}, GL_PATH_FACTORY),
        visible: VISIBLE,
        opts: DEFAULT_DRAW_OPTIONS,
        emphasis: 'none',
      },
      1e-5,
    );
    expect(minPxSigns(s)).toEqual(new Set([-1]));
  });
});
