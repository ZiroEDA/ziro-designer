// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_POLY_SET::CacheTriangulation( false )` on a fractured outline with
 * many slits: a QR code's knockout (`PCB_BARCODE::AssembleBarcode`), 316
 * points after `Fracture`. KiCad's python triangulates it in a few ms; ours
 * hung on it until two divergences from `polygon_triangulation.h` /
 * `vertex_set.h` were closed — `insertTriVertex` dropped the `last` link so
 * subdivision added detached points, and `VERTEX::remove` left `next`/`prev`
 * pointing into the ring, so a walk from a removed vertex never came back.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';

describe('POLYGON_TRIANGULATION on a fractured knockout', () => {
  it('terminates, and the triangles cover the polygon', () => {
    const pts = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../fixtures/fractured_qr_knockout.json', import.meta.url)),
        'utf8',
      ),
    ) as number[][];
    const chain = new SHAPE_LINE_CHAIN();
    for (const [x, y] of pts) chain.Append(x!, y!);
    chain.SetClosed(true);
    const ps = new SHAPE_POLY_SET();
    ps.AddOutline(chain);

    const t = performance.now();
    ps.CacheTriangulation(false);
    expect(performance.now() - t).toBeLessThan(5000);

    const tri = ps.TriangulatedPolygon(0)!;
    expect(tri.GetTriangleCount()).toBeGreaterThan(300);

    // The triangulation's area is the polygon's (the outline area is exact; a
    // triangle set that dropped or doubled a region would not match it).
    let area = 0;
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 0, y: 0 };
    for (let i = 0; i < tri.GetTriangleCount(); i++) {
      tri.GetTriangle(i, a, b, c);
      area += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    }
    expect(area / ps.Area()).toBeCloseTo(1, 4);
  }, 20000);
});
