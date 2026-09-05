// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A stroked circle is drawn as a circle, not as its facets.
 *
 * Reported as "the circle in ours is like made up of polygons while in kicad
 * it's a smooth circle", on a `PCB_POINT`'s ring.
 *
 * KiCad's OpenGL GAL never tessellates one: `DrawCircle` puts down a quad and
 * the fragment shader does the distance test, so a circle is exact at every
 * zoom. Ours flattened it at record time, and because the retained scene is
 * deliberately zoom-independent the flattening used a fixed **world** sagitta
 * of 0.005 mm. That is `arc_to_seg_error` — what KiCad uses to turn arcs into
 * segments for *plotting and geometry*, not for the screen — and on a small
 * circle it is coarse: a point's ring is 0.25 mm in radius and came out a
 * 16-gon.
 *
 * Two symptoms, one cause. Magnified, the facets show. Shrunk, a 16-gon
 * stroked at one pixel fills in as a solid dot where an exact ring stays a
 * ring, which is why ours read as a red blob beside KiCad's at the same zoom.
 */
import { describe, expect, it } from 'vitest';
import { GlPath, setPathOwner } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { Scene, RING_STRIDE } from '@ziroeda/designer/src/render/gl/scene.js';
import { GlRecorder } from '@ziroeda/designer/src/render/gl/recorder.js';
import { facetsForRadius } from '@ziroeda/designer/src/render/gl/tessellate.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { recordBoardScene } from '@ziroeda/designer/src/render/gl/pcb_gl.js';
import { buildScene, DEFAULT_DRAW_OPTIONS } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { parse } from '@ziroeda/sexpr/src/index.js';

const MM = 1e6;

/** Stroke `build` into an ordered scene and hand back what it recorded. */
function record(build: (p: GlPath) => void, opts: { dash?: number[] } = {}): Scene {
  const scene = new Scene(true);
  const rec = new GlRecorder(scene, { referenceScale: 1 });
  const path = new GlPath();
  build(path);
  rec.strokeStyle = 'rgb(255, 38, 226)';
  rec.lineWidth = 0.05 * MM;
  if (opts.dash) rec.setLineDash(opts.dash);
  rec.stroke(path);
  return scene;
}

/** The ring instances a scene holds, decoded. */
const rings = (s: Scene): { cx: number; cy: number; r: number; half: number }[] => {
  const v = s.rings.view();
  const out = [];
  for (let i = 0; i < s.ringCount; i++) {
    const o = i * RING_STRIDE;
    out.push({ cx: v[o]!, cy: v[o + 1]!, r: v[o + 2]!, half: v[o + 3]! });
  }
  return out;
};

describe('a whole circle keeps its identity', () => {
  it('is one exact ring, not a polygon of segments', () => {
    // The shape `renderBoard` draws a point's ring with: a `moveTo` to the
    // circle's start so the shared bucket does not join it to the last one,
    // then a full-turn `arc`.
    const s = record((p) => {
      p.moveTo(10 * MM + 0.25 * MM, 20 * MM);
      p.arc(10 * MM, 20 * MM, 0.25 * MM, 0, Math.PI * 2);
    });

    expect(rings(s)).toEqual([{ cx: 10 * MM, cy: 20 * MM, r: 0.25 * MM, half: 0.025 * MM }]);
    // And not a single segment — which is what it used to be, sixteen of them.
    expect(s.segmentCount).toBe(0);
    expect(facetsForRadius(0.25 * MM)).toBe(16);
  });

  it('works with no `moveTo` at all, which is the other way to draw one', () => {
    const s = record((p) => {
      p.arc(0, 0, 5 * MM, 0, Math.PI * 2);
    });

    expect(s.ringCount).toBe(1);
    expect(s.segmentCount).toBe(0);
  });

  it('records it in the run order, so painter’s sequence still holds', () => {
    // The scene draws one call per run in record order. A ring that did not
    // announce itself would be swept into the preceding run and drawn with the
    // wrong program — the ordered loop's fallback branch is the disc.
    const s = record((p) => {
      p.moveTo(0, 0);
      p.lineTo(MM, 0);
      p.moveTo(5 * MM, 0);
      p.arc(4 * MM, 0, MM, 0, Math.PI * 2);
    });

    expect(s.runs.map((r) => r.kind)).toEqual(['seg', 'ring']);
  });
});

describe('what is NOT a circle', () => {
  it('an arc that is not a full turn stays a polyline', () => {
    // A rounded pad corner is a quarter turn inside a larger outline. Drawing
    // it as a ring would draw the whole circle.
    const s = record((p) => {
      p.moveTo(0, 0);
      p.arc(0, 0, MM, 0, Math.PI / 2);
    });

    expect(s.ringCount).toBe(0);
    expect(s.segmentCount).toBeGreaterThan(0);
  });

  it('a circle joined onto an existing run stays a polyline', () => {
    // The seed point must be the arc's own start. Here the run already holds a
    // line, so the circle is geometry *within* a larger outline and the bridge
    // Canvas2D draws from the current point is part of the picture.
    const s = record((p) => {
      p.moveTo(0, 0);
      p.lineTo(10 * MM, 10 * MM);
      p.arc(0, 0, MM, 0, Math.PI * 2);
    });

    expect(s.ringCount).toBe(0);
  });

  it('a dashed circle stays a polyline, because the dashes are arcs', () => {
    const s = record(
      (p) => {
        p.moveTo(MM, 0);
        p.arc(0, 0, MM, 0, Math.PI * 2);
      },
      { dash: [0.2 * MM, 0.2 * MM] },
    );

    expect(s.ringCount).toBe(0);
    expect(s.segmentCount).toBeGreaterThan(0);
  });
});

describe('the ring still behaves like every other primitive', () => {
  it('moves with its item when one is dragged', () => {
    // `Scene.translateItem` is what makes a drag a translation rather than a
    // re-record. A buffer it did not know about would leave the ring behind.
    const scene = new Scene(true);
    const rec = new GlRecorder(scene, { referenceScale: 1 });
    setPathOwner('point:0');
    const path = new GlPath();
    path.moveTo(MM, 0);
    path.arc(0, 0, MM, 0, Math.PI * 2);
    setPathOwner(undefined);
    rec.strokeStyle = 'rgb(255, 38, 226)';
    rec.stroke(path);
    scene.closeItem();

    scene.translateItem('point:0', 3 * MM, 4 * MM);

    expect(rings(scene)[0]).toMatchObject({ cx: 3 * MM, cy: 4 * MM });
  });

  it('counts towards an empty scene’s emptiness', () => {
    const empty = new Scene(true);
    expect(empty.isEmpty).toBe(true);
    expect(record((p) => p.arc(0, 0, MM, 0, Math.PI * 2)).isEmpty).toBe(false);
  });

  it('is cleared with everything else', () => {
    const s = record((p) => p.arc(0, 0, MM, 0, Math.PI * 2));
    expect(s.ringCount).toBe(1);
    s.clear();
    expect(s.ringCount).toBe(0);
  });
});

/**
 * The board pipeline, end to end.
 *
 * The tests above drive `GlPath` and the recorder directly, which is where the
 * ring primitive lives — and they all passed while a *placed* point still had
 * no ring on screen. That gap is the point of this block: `renderBoard`'s
 * `addPoint` and `paintPoints` sit between the board and the recorder, and a
 * ring that never reaches the scene, or reaches it with a width of zero, is
 * invisible in a way none of the unit-level tests above can see.
 */
describe('a placed point reaches the GPU as a ring', () => {
  const POINT_BOARD = readBoard(
    parse(`(kicad_pcb (version 20241229)
  (layers (0 "F.Cu" signal) (37 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (point (at 10 20) (size 2) (layer "F.SilkS"))
)`),
  );

  const recorded = (): Scene => {
    const s = new Scene(true);
    recordBoardScene(
      s,
      {
        scene: buildScene(POINT_BOARD, {}, GL_PATH_FACTORY),
        visible: new Set(['F.Cu', 'F.SilkS']),
        // `minPenWidth: 0` is what a retained backend passes, and it is the
        // value that made the ring vanish: it leaves `a_halfWidth` at zero, so
        // the shader has nothing but the pixel floor to draw with.
        opts: { ...DEFAULT_DRAW_OPTIONS, minPenWidth: 0, drawingSheet: false },
        emphasis: 'none',
      },
      1,
    );
    return s;
  };

  it('records one ring, at the marker’s centre and a quarter of its size', () => {
    const r = rings(recorded());

    expect(r).toHaveLength(1);
    expect(r[0]!.cx).toBe(10 * MM);
    expect(r[0]!.cy).toBe(20 * MM);
    expect(r[0]!.r).toBe(0.5 * MM);
  });

  it('carries a pixel floor the shader can draw with', () => {
    // The bug this block exists for. `GlRecorder.pen()` returns a **signed**
    // minPx — the sign tags which of KiCad's rasterisers the stroke imitates,
    // and a line is negative. The ring shader first copied the disc's naive
    // `max(trueHalfPx, a_minPx)`, and with `a_halfWidth` zero that max picked
    // zero: a half-pixel band at under half alpha, invisible at every zoom.
    //
    // So the instance must carry a floor whose MAGNITUDE is usable. Asserting
    // it is non-zero is the whole check — the sign is the shader's to decode.
    const v = recorded().rings.view();
    const halfWidth = v[3]!;
    const minPx = v[4]!;

    expect(halfWidth).toBe(0);
    expect(Math.abs(minPx)).toBeGreaterThan(0);
  });

  it('and no segments stand in for it', () => {
    // The cross is two segments; the ring must not add sixteen more.
    expect(recorded().segmentCount).toBe(2);
  });

  it('gives each ring run a start index into the RING buffer', () => {
    // The bug that made some placed points show a circle and others not.
    // `Scene.note` picked a run's start from a chain of ternaries whose final
    // branch was the disc buffer, so `ring` fell through and took `discCount -
    // count`. On a board with via and pad holes that is a garbage offset into
    // the rings, and a circle drew only where the two happened to coincide.
    //
    // Asserted as a partition — read in order, the runs of a kind must walk
    // that kind's buffer from 0 to its end exactly once. A start borrowed from
    // another buffer fails this even when the counts add up.
    const board = readBoard(
      parse(`(kicad_pcb (version 20241229)
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (via (at 5 5) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0))
  (via (at 8 5) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0))
  (point (at 10 20) (size 2) (layer "F.SilkS"))
  (point (at 14 20) (size 2) (layer "F.SilkS"))
  (point (at 18 20) (size 2) (layer "F.Cu"))
)`),
    );
    const s = new Scene(true);
    recordBoardScene(
      s,
      {
        scene: buildScene(board, {}, GL_PATH_FACTORY),
        visible: new Set(['F.Cu', 'B.Cu', 'F.SilkS']),
        opts: { ...DEFAULT_DRAW_OPTIONS, minPenWidth: 0, drawingSheet: false },
        emphasis: 'none',
      },
      1,
    );

    // More than three rings, and deliberately not pinned to a number: the two
    // vias contribute their hole walls, which are stroked circles and are now
    // exact for the same reason the points are. What matters here is that
    // several ring RUNS exist — the F.Cu point is separated from the two on
    // F.SilkS by other kinds — because a single run would be right at start 0
    // whatever buffer the index came from, and could not catch this.
    expect(s.ringCount).toBeGreaterThanOrEqual(3);
    expect(s.runs.filter((r) => r.kind === 'ring').length).toBeGreaterThan(1);
    // A board records no discs at all — `disc` is the schematic's junction
    // primitive — so the fall-through handed rings `0 - count`, a NEGATIVE
    // start. That is what the partition below catches, and it is why the
    // symptom was "some points have a circle": a negative instance offset
    // reads outside the buffer, and what came back varied.
    expect(s.discCount).toBe(0);

    let next = 0;
    for (const run of s.runs.filter((r) => r.kind === 'ring')) {
      expect(run.start).toBe(next);
      next = run.start + run.count;
    }
    expect(next).toBe(s.ringCount);
  });
});
