// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Track and via net names against their ViewGetLOD gates.
 *
 * The regression this file exists for: net names were baked into the retained
 * GL scene as a `buildDrawSteps` step, so they were evaluated once, at the
 * zoom the board happened to be recorded at — where every label fails its LOD
 * — and could then never appear at any zoom. The pass is per-frame now
 * (`drawNetNames`), and a retained recording must contain no netname glyphs at
 * any recording scale.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  BACK_NETNAMES_MARK,
  buildScene,
  DEFAULT_DRAW_OPTIONS,
  drawNetNames,
  showsNetName,
  showsViaNetName,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { BITMAP_MINPX_FLAG, Scene, SEGMENT_STRIDE } from '@ziroeda/designer/src/render/gl/scene.js';
import { recordBoardScene } from '@ziroeda/designer/src/render/gl/pcb_gl.js';

/** GAL's 91 dpi: KiCad zoom z draws 1 mm as 91/25.4·z px (see GAL_SCREEN_DPI). */
const PX_PER_MM_AT_Z1 = 91 / 25.4;
const MM = 1e6;

// A 4-layer board: one long fat track, a through via and a blind via, no pads
// (pad text would muddy the "no atlas strokes in a recording" assertion).
const board = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (1 "In1.Cu" signal) (2 "In2.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "/uart/RXD1")
  (segment (start 100 100) (end 180 100) (width 2) (layer "F.Cu") (net 1))
  (via (at 120 100) (size 1.6) (drill 0.8) (layers "F.Cu" "B.Cu") (net 1))
  (via blind (at 140 100) (size 1.6) (drill 0.8) (layers "F.Cu" "In1.Cu") (net 1))
)`),
  );

const VISIBLE = new Set(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);

describe('scene net-label data', () => {
  const scene = buildScene(board(), {}, GL_PATH_FACTORY);

  it('keeps track labels as data with the short net name', () => {
    expect(scene.netLabels).toHaveLength(1);
    expect(scene.netLabels[0]!.text).toBe('RXD1');
    expect(scene.netLabels[0]!.width).toBe(2 * MM);
  });

  it('draws a slash in a label name as a slash, not as {slash} (issue #626)', () => {
    // The reported bug, at the surface it was reported on. A net the schematic
    // calls `SDA/A4` is stored `SDA{slash}A4`, because `/` already separates
    // hierarchy in a net name; the painter drew that verbatim.
    const b = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "/uart/SDA{slash}A4")
  (segment (start 100 100) (end 180 100) (width 2) (layer "F.Cu") (net 1))
  (via (at 120 100) (size 1.6) (drill 0.8) (layers "F.Cu" "B.Cu") (net 1))
)`),
    );
    const scene = buildScene(b, {}, GL_PATH_FACTORY);
    // Short name for the painter, and the escape resolved: `SDA/A4`, not `A4`
    // (which is what unescaping before the split would have produced).
    expect(scene.netLabels.map((l) => l.text)).toEqual(['SDA/A4']);
    expect(scene.viaNetLabels.map((l) => l.text)).toEqual(['SDA/A4']);
  });

  it('gives a via its net name, and layer numbers only when not through', () => {
    expect(scene.viaNetLabels).toHaveLength(2);
    const through = scene.viaNetLabels.find((l) => l.at.x === 120 * MM)!;
    const blind = scene.viaNetLabels.find((l) => l.at.x === 140 * MM)!;
    expect(through.text).toBe('RXD1');
    expect(through.layerIds).toBe('');
    // F.Cu is copper layer 1, In1.Cu is 2 (the layer-manager numbering).
    expect(blind.layerIds).toBe('1-2');
  });
});

describe('ViewGetLOD gates', () => {
  // PCB_TRACK: show once width · zoom > 4 mm, i.e. 14.33 px of track.
  it('shows a track name at 14.33 px of width, per physical pixel', () => {
    const label = {
      start: { x: 0, y: 0 },
      end: { x: 400 * MM, y: 0 },
      width: 1 * MM,
      layer: 'F.Cu',
      text: 'RXD1',
    };
    const at = (px: number): number => px / 1; // width is 1 mm, so scale = px/mm
    expect(showsNetName(label, { scale: at(14.0) / MM, tx: 0, ty: 0 })).toBe(false);
    expect(showsNetName(label, { scale: at(14.7) / MM, tx: 0, ty: 0 })).toBe(true);
    // A device pixel is not a physical pixel: at dpr 2 the same on-screen size
    // needs twice the device pixels.
    expect(showsNetName(label, { scale: at(14.7) / MM, tx: 0, ty: 0 }, 2)).toBe(false);
    expect(showsNetName(label, { scale: at(29.4) / MM, tx: 0, ty: 0 }, 2)).toBe(true);
  });

  it('hides a track name when the segment is shorter than the text', () => {
    const label = {
      start: { x: 0, y: 0 },
      end: { x: 3 * MM, y: 0 },
      width: 1 * MM,
      layer: 'F.Cu',
      text: 'RXD1', // 4 chars · 1 mm > 3 mm of track
    };
    expect(showsNetName(label, { scale: 1, tx: 0, ty: 0 })).toBe(false);
  });

  // PCB_VIA: show once width · zoom > 10 mm, i.e. 35.83 px of via.
  it('shows a via description at 35.83 px of diameter', () => {
    const label = {
      at: { x: 0, y: 0 },
      width: 1.6 * MM,
      layers: ['F.Cu'],
      text: 'RXD1',
      layerIds: '',
    };
    const scaleFor = (px: number): number => px / (1.6 * MM);
    expect(showsViaNetName(label, { scale: scaleFor(35), tx: 0, ty: 0 })).toBe(false);
    expect(showsViaNetName(label, { scale: scaleFor(36.5), tx: 0, ty: 0 })).toBe(true);
    expect(showsViaNetName(label, { scale: scaleFor(36.5), tx: 0, ty: 0 }, 2)).toBe(false);
  });

  it("derives both thresholds from GAL's 91 dpi", () => {
    // 4 mm and 10 mm at zoom 1, in pixels — the constants the gates compare to.
    expect(4 * PX_PER_MM_AT_Z1).toBeCloseTo(14.33, 2);
    expect(10 * PX_PER_MM_AT_Z1).toBeCloseTo(35.83, 2);
  });
});

describe('retained recording vs the per-frame pass', () => {
  const atlasSegments = (s: Scene): number => {
    const a = s.segments.view();
    let n = 0;
    for (let i = 0; i < a.length; i += SEGMENT_STRIDE) if (a[i + 5]! > BITMAP_MINPX_FLAG / 2) n++;
    return n;
  };

  it('records no netname glyphs at any scale — the pass is per-frame', () => {
    const scene = buildScene(board(), {}, GL_PATH_FACTORY);
    for (const scale of [0.001, 1.0]) {
      const gl = new Scene(true);
      recordBoardScene(
        gl,
        { scene, visible: VISIBLE, opts: undefined as never, emphasis: 'none' },
        scale,
      );
      expect(atlasSegments(gl)).toBe(0);
    }
  });

  it('draws labels per frame once the zoom passes the gates', () => {
    const scene = buildScene(board(), {}, GL_PATH_FACTORY);
    // A minimal 2D-context stand-in; glyph paths are Path2D, stubbed for Node.
    const strokes: unknown[] = [];
    const ctx = {
      setTransform: () => {},
      lineCap: '',
      lineJoin: '',
      strokeStyle: '',
      lineWidth: 0,
      stroke: (p: unknown) => strokes.push(p),
    } as unknown as CanvasRenderingContext2D;
    const path2d = globalThis.Path2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Path2D = class {
      moveTo(): void {}
      lineTo(): void {}
    };
    try {
      // Board-fit-ish zoom: 0.02 px per mm — every gate fails, nothing drawn.
      drawNetNames(ctx, scene, { scale: 0.02 / MM, tx: 0, ty: 0 }, VISIBLE, 800, 600);
      expect(strokes).toHaveLength(0);
      // 40 px/mm with the view centred on the track: it is 80 px wide on
      // screen and the 1.6 mm via 64 px, so both gates pass.
      const scale = 40 / MM;
      drawNetNames(
        ctx,
        scene,
        { scale, tx: 400 - 140 * MM * scale, ty: 300 - 100 * MM * scale },
        VISIBLE,
        800,
        600,
      );
      expect(strokes.length).toBeGreaterThan(0);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Path2D = path2d;
    }
  });
});

describe('which side of the board a name is painted on', () => {
  // GAL_LAYER_ORDER: LAYER_PAD_NETNAMES and LAYER_VIA_NETNAMES sit up with the
  // overlays; LAYER_PAD_FR_NETNAMES just above F.Cu; LAYER_PAD_BK_NETNAMES
  // down in the back-copper block, beneath the inner layers and the front
  // pour — which is why pcbnew shows back-side pad text as a pale ghost while
  // ours read as brightly as the front.
  const sideBoard = (): Board =>
    readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (1 "In1.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 100 100) (end 180 100) (width 2) (layer "F.Cu") (net 1))
  (segment (start 100 110) (end 180 110) (width 2) (layer "B.Cu") (net 1))
  (footprint "F" (layer "F.Cu") (at 120 120)
    (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 1 "VCC")))
  (footprint "B" (layer "B.Cu") (at 140 120)
    (pad "1" smd rect (at 0 0) (size 2 2) (layers "B.Cu") (net 1 "VCC")))
)`),
    );

  const drawnOn = (where: 'over' | 'under'): number => {
    const scene = buildScene(sideBoard(), {}, GL_PATH_FACTORY);
    let n = 0;
    const ctx = {
      setTransform: () => {},
      lineCap: '',
      lineJoin: '',
      strokeStyle: '',
      lineWidth: 0,
      stroke: () => {
        n++;
      },
    } as unknown as CanvasRenderingContext2D;
    const path2d = globalThis.Path2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Path2D = class {
      moveTo(): void {}
      lineTo(): void {}
    };
    try {
      const scale = 40 / MM;
      drawNetNames(
        ctx,
        scene,
        { scale, tx: 400 - 130 * MM * scale, ty: 300 - 112 * MM * scale },
        new Set(['F.Cu', 'In1.Cu', 'B.Cu']),
        4000,
        4000,
        undefined,
        'none',
        1,
        where,
      );
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Path2D = path2d;
    }
    return n;
  };

  it('paints something on each side, so neither pass is dead', () => {
    expect(drawnOn('over')).toBeGreaterThan(0);
    expect(drawnOn('under')).toBeGreaterThan(0);
  });
});

describe('the under pass pays for its depth in alpha', () => {
  it('dims a back-side name by one pour of transmission, and leaves front alone', () => {
    // A zone composites at 0.6, so what pcbnew stacks beneath it keeps 0.4.
    // Both passes draw on the same canvas: burying the under pass beneath the
    // board hid a back pad's text under its own (opaque) pad.
    const colours: string[] = [];
    const ctx = {
      setTransform: () => {},
      lineCap: '',
      lineJoin: '',
      lineWidth: 0,
      get strokeStyle() {
        return '';
      },
      set strokeStyle(v: string) {
        colours.push(v);
      },
      stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    const scene = buildScene(
      readBoard(
        parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 100 100) (end 180 100) (width 2) (layer "B.Cu") (net 1))
)`),
      ),
      {},
      GL_PATH_FACTORY,
    );
    const path2d = globalThis.Path2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Path2D = class {
      moveTo(): void {}
      lineTo(): void {}
    };
    try {
      const scale = 40 / MM;
      const view = { scale, tx: 400 - 140 * MM * scale, ty: 300 - 100 * MM * scale };
      drawNetNames(ctx, scene, view, new Set(['B.Cu']), 800, 600, undefined, 'none', 1, 'under');
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Path2D = path2d;
    }
    // B.Cu's netnames are the light label at 0.7; under the pour, 0.7 · 0.4.
    expect(colours.some((c) => c.includes('0.27999999999999997') || c.includes('0.28'))).toBe(true);
  });
});

describe('the depth the retained backend draws the under pass at', () => {
  /**
   * `BACK_NETNAMES_MARK` is where the GL device splits the board's run list to
   * draw the under pass — back and inner net names, and every back-side pad
   * number. It has to name the point *after* B.Cu was painted.
   *
   * It named run zero. `buildDrawSteps` only builds closures, and the mark was
   * emitted while building rather than pushed as a step, so it was taken
   * against an empty run list every time. The device then drew the whole under
   * pass before the first run — beneath the entire board, back pad numbers
   * included, each one hidden under its own opaque pad.
   */
  const sided = (): Board =>
    readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 100 100) (end 180 100) (width 0.25) (layer "B.Cu") (net 1))
  (segment (start 100 110) (end 180 110) (width 0.25) (layer "F.Cu") (net 1))
  (footprint "R1" (layer "F.Cu") (at 100 110)
    (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "VCC")))
  (footprint "R2" (layer "B.Cu") (at 110 100)
    (pad "9" smd rect (at 0 0) (size 2 2) (layers "B.Cu" "B.Paste" "B.Mask") (net 1 "VCC")))
)`),
    );

  const recorded = (): Scene => {
    const s = new Scene(true);
    recordBoardScene(
      s,
      {
        scene: buildScene(sided(), {}, GL_PATH_FACTORY),
        visible: new Set(['F.Cu', 'B.Cu']),
        opts: DEFAULT_DRAW_OPTIONS,
        emphasis: 'none',
      },
      40 / MM,
    );
    return s;
  };

  it('falls after the back copper and before the front', () => {
    const s = recorded();
    const at = s.marks.get(BACK_NETNAMES_MARK);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(s.runs.length);
  });

  it('starts a fresh run, so nothing recorded after it draws before it', () => {
    // `note` extends the open run whenever the kind repeats, and the front
    // layers follow the back ones with the same kinds. Without the break the
    // mark's own boundary would have front geometry on the back side of it.
    const s = recorded();
    const at = s.marks.get(BACK_NETNAMES_MARK) ?? 0;
    const before = s.runs.slice(0, at);
    const after = s.runs.slice(at);
    // Every vertex recorded before the mark comes before every vertex after it,
    // per buffer — which is what makes the split a depth and not just an index.
    for (const kind of ['seg', 'tri', 'disc'] as const) {
      const ends = before.filter((r) => r.kind === kind).map((r) => r.start + r.count);
      const starts = after.filter((r) => r.kind === kind).map((r) => r.start);
      if (ends.length === 0 || starts.length === 0) continue;
      expect(Math.max(...ends)).toBeLessThanOrEqual(Math.min(...starts));
    }
  });
});
