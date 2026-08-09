// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every kind of sheet graphic actually reaches the screen.
 *
 * This is a silent bug class, and it cost the ellipse tools entirely — they
 * were modelled, parsed, written, hit-tested, point-edited and drawn, and drew
 * nothing at all, because of two independent omissions either of which was
 * enough on its own:
 *
 * **The cull.** `drawSheetGraphic` builds a bounding box per shape before
 * drawing it, with a branch per kind. A kind with no branch contributes no
 * points, so the box stays `minX = +Inf, maxX = -Inf`, `inView` says no, and
 * the shape is dropped before a single path call. Not approximated — dropped.
 *
 * **The recorder.** The schematic draws through `GlRecorder`, which is
 * deliberately not `implements CanvasRenderingContext2D` (that interface is
 * enormous and mostly irrelevant to it). So a path method the renderer calls
 * and the recorder lacks is not a type error — `ctx.ellipse` was simply
 * `undefined`, and the shape never entered the buffer.
 *
 * Neither shows up as an error anywhere. The only thing that catches them is
 * asking whether geometry came out the far end, which is what this does: record
 * a sheet holding one shape and check it produced more than a sheet holding
 * none.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { DEFAULT_RENDER_OPTS } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { recordSchematicScene } from '@ziroeda/designer/src/render/gl/schematic_gl.js';
import { Scene } from '@ziroeda/designer/src/render/gl/scene.js';
import type { Theme } from '@ziroeda/designer/src/editors/schematic/theme.js';

/** Every colour the renderer asks for; only the background needs to differ. */
const theme = new Proxy(
  {},
  { get: (_t, k) => (k === 'background' ? '#f0f0f0' : '#008484') },
) as unknown as Theme;

const sheet = (node: string): string =>
  `(kicad_sch (version 20250114) (paper "A4") (lib_symbols) ${node})`;

const STROKE = `(stroke (width 0) (type default)) (fill (type none))`;

/** How much geometry a sheet holding `node` records. */
function segments(node: string): number {
  const scene = new Scene();
  recordSchematicScene(
    scene,
    {
      doc: readSchematic(parse(sheet(node))),
      theme,
      opts: DEFAULT_RENDER_OPTS,
      selection: undefined,
      highlight: undefined,
    },
    0.00002,
  );
  return scene.segments.length;
}

/** The drawing sheet and title block, which every document records. */
const EMPTY = segments('');

const SHAPES: [string, string][] = [
  ['rectangle', `(rectangle (start 100 60) (end 140 90) ${STROKE} (uuid "r1"))`],
  ['circle', `(circle (center 100 60) (radius 20) ${STROKE} (uuid "c1"))`],
  ['arc', `(arc (start 90 60) (mid 100 50) (end 110 60) ${STROKE} (uuid "a1"))`],
  [
    'bezier',
    `(bezier (pts (xy 50 100) (xy 70 60) (xy 110 140) (xy 130 100))
       ${STROKE} (uuid "bz1"))`,
  ],
  [
    'ellipse',
    `(ellipse (center 100 60) (major_radius 20) (minor_radius 10) (rotation_angle 0)
       ${STROKE} (uuid "el1"))`,
  ],
  [
    'ellipse_arc',
    `(ellipse_arc (center 100 60) (major_radius 20) (minor_radius 10) (rotation_angle 0)
       (start_angle 0) (end_angle 90) ${STROKE} (uuid "ea1"))`,
  ],
];

describe('a sheet graphic of every kind', () => {
  it('the empty sheet records its frame, so the baseline is not zero', () => {
    expect(EMPTY).toBeGreaterThan(0);
  });

  for (const [kind, node] of SHAPES) {
    it(`${kind} records geometry`, () => {
      expect(segments(node)).toBeGreaterThan(EMPTY);
    });
  }

  it('a rotated ellipse too, which is a different code path in the flattener', () => {
    expect(
      segments(
        `(ellipse (center 100 60) (major_radius 20) (minor_radius 8) (rotation_angle 30)
           ${STROKE} (uuid "el2"))`,
      ),
    ).toBeGreaterThan(EMPTY);
  });

  it('and an ellipse records about as much as the circle it is a squashed version of', () => {
    // Both are one closed outline of a similar size, so a wildly different
    // count would mean one of them is being flattened at the wrong tolerance.
    const circle = segments(SHAPES.find((x) => x[0] === 'circle')![1]) - EMPTY;
    const ellipse = segments(SHAPES.find((x) => x[0] === 'ellipse')![1]) - EMPTY;
    expect(ellipse).toBeGreaterThan(circle / 2);
    expect(ellipse).toBeLessThan(circle * 2);
  });
});

describe('the elliptical arc', () => {
  it('records less than the whole ellipse, since it is a quarter of one', () => {
    const whole = segments(SHAPES.find((x) => x[0] === 'ellipse')![1]) - EMPTY;
    const quarter = segments(SHAPES.find((x) => x[0] === 'ellipse_arc')![1]) - EMPTY;
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(whole);
  });
});

describe('the bezier is drawn as a curve', () => {
  it('not as the three-segment control polygon it used to be', () => {
    // The renderer once fell through to the polyline branch for a bezier, which
    // draws straight lines between the four control points. A flattened cubic
    // is many more segments than that, so the count tells the two apart.
    const bezier = segments(SHAPES.find((x) => x[0] === 'bezier')![1]) - EMPTY;
    const polyline =
      segments(
        `(polyline (pts (xy 50 100) (xy 70 60) (xy 110 140) (xy 130 100))
         ${STROKE} (uuid "pl1"))`,
      ) - EMPTY;
    expect(polyline).toBeGreaterThan(0);
    expect(bezier).toBeGreaterThan(polyline * 2);
  });
});
