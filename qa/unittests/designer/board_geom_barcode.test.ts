// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A barcode in the 3D view and in the STEP export.
 *
 * `EXPORTER_STEP::visitItem`, `case PCB_BARCODE_T` (`exporter_step.cpp:1033`):
 *
 *     barcode->TransformShapeToPolySet( m_poly_shapes[pcblayer][wxEmptyString],
 *                                       pcblayer, 0, maxError, ERROR_INSIDE );
 *
 * and `FOOTPRINT::TransformFPShapesToPolySet` does the same for one inside a
 * footprint, under `aIncludeShapes` (`footprint.cpp:4693`). So a barcode is
 * real geometry on its layer, not a 2D-only decoration — it shows in the 3D
 * viewer and it lands in an exported STEP.
 *
 * This is the last of KiCad's `PCB_BARCODE_T` sites; the 2D painter, the
 * plotter, DRC and convert are covered elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { buildBoardGeom } from '@ziroeda/designer/src/editors/pcb/boardGeom.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = 1e6;
const BOX = { minX: 0, minY: 0, maxX: 40 * MM, maxY: 40 * MM };

const boardWith = (items: string): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal)
          (37 "F.SilkS" user "F.Silkscreen") (38 "B.SilkS" user "B.Silkscreen")
          (44 "Dwgs.User" user))
  (net 0 "")
  ${items}
)`),
  );

const barcodeOn = (layer: string): string =>
  `(barcode (at 10 20 0) (layer "${layer}") (size 8 8) (text "ZIRO") (text_height 1.27)
     (type qr) (ecc_level L) (hide yes) (knockout no))`;

const silkTris = (b: Board): { front: number; back: number } => {
  const g = buildBoardGeom(b, BOX);
  return { front: g.front.silk.tris.length, back: g.back.silk.tris.length };
};

describe('a barcode is silkscreen geometry', () => {
  it('puts triangles on the front for a front-layer barcode', () => {
    const empty = silkTris(boardWith(''));
    const withBc = silkTris(boardWith(barcodeOn('F.SilkS')));

    expect(empty.front).toBe(0);
    expect(withBc.front).toBeGreaterThan(0);
    expect(withBc.back).toBe(0);
  });

  it('and on the back for a back-layer one', () => {
    const g = silkTris(boardWith(barcodeOn('B.SilkS')));

    expect(g.back).toBeGreaterThan(0);
    expect(g.front).toBe(0);
  });

  it('and nothing at all on a layer with no 3D surface', () => {
    // `silkSide` answers null for anything but the two silkscreens, which is
    // how a Dwgs.User graphic stays out of the render — the same rule, and the
    // barcode has to obey it rather than defaulting to the front.
    const g = silkTris(boardWith(barcodeOn('Dwgs.User')));

    expect(g.front).toBe(0);
    expect(g.back).toBe(0);
  });

  it('fills the modules rather than stroking them', () => {
    // Every other silk primitive is a centreline turned into a stadium of the
    // shape's own width. A barcode has no centreline: `m_poly` IS the filled
    // area. A stroking path would draw the outlines of the modules and leave
    // their middles empty, which reads as a grid of squares and scans as
    // nothing.
    //
    // A filled 8x8 mm QR code covers far more area than its outlines would, so
    // the triangle count is the tell — dozens of modules, each a quad.
    const g = buildBoardGeom(boardWith(barcodeOn('F.SilkS')), BOX);

    // Two triangles per module run, and a version-1 QR code has many.
    expect(g.front.silk.tris.length / 3).toBeGreaterThan(20);
  });

  it('takes a footprint’s barcode too', () => {
    // `FOOTPRINT::TransformFPShapesToPolySet`'s `aIncludeShapes` arm.
    const g = silkTris(
      boardWith(`(footprint "B" (layer "F.Cu") (at 0 0) ${barcodeOn('F.SilkS')})`),
    );

    expect(g.front).toBeGreaterThan(0);
  });
});
