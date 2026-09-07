// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A placed footprint brings its `(point …)` children with it.
 *
 * `placeFootprint` stands in for `FOOTPRINT::SetPosition` and
 * `FOOTPRINT::SetOrientation`, and both of those carry the points explicitly
 * alongside the pads, fields, zones and drawings:
 *
 *     for( PCB_POINT* point : m_points ) point->Move( delta );        (footprint.cpp:3022)
 *     for( PCB_POINT* point : m_points ) point->Rotate( ctr, angle ); (footprint.cpp:3122)
 *
 * The *reader* deliberately does not transform a point — a footprint's points
 * are written and read in absolute board coordinates, because `parsePCB_POINT`
 * takes no parent and `format( const PCB_POINT* )` prints through the
 * one-argument `formatInternalUnits`. So the placement is the only place the
 * offset can be applied, and it was not being applied at all.
 *
 * ## Why this was worth a test of its own
 *
 * A library footprint's points are in the library's frame, where the footprint
 * sits at the origin. Left untranslated they stay at the *sheet* origin, and
 * `footprintBBox` counts points — so the footprint's box stretched from the
 * corner of the sheet to wherever it had been placed. `SpreadFootprints` sizes
 * its blocks from that box, so a single such footprint was handed a block the
 * size of the page: after Update PCB from Schematic it sat alone far from the
 * others while everything else packed into a cluster beside it, plus a stray
 * marker in the top-left corner of the sheet.
 *
 * `LED_THT:LED_D5.0mm` is the real case — it carries
 * `(point (at 1.27 0) (size 2) (layer "F.Fab"))` — and it is why a demo board's
 * LED landed 120 mm from the rest of its parts.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { placeFootprint } from '@ziroeda/pcbnew/src/board_exchange_footprint.js';
import { footprintBBox } from '@ziroeda/pcbnew/src/edit-footprint.js';
import { pcbMmToIU as MM } from '@ziroeda/common/src/eda_units.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

/**
 * A part with one pad and one point, shaped like `LED_D5.0mm`'s: the point at
 * (1.27, 0) in the library's own frame.
 */
const LIB = `(footprint "P"
  (version 20241229) (generator "pcbnew") (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu"))
  (point (at 1.27 0) (size 2) (layer "F.Fab"))
)`;

const place = (at: { x: number; y: number }, angle?: number): PcbFootprint =>
  placeFootprint(readFootprintFile(parse(LIB))!, {
    fpid: 'Lib:P',
    at,
    ...(angle === undefined ? {} : { angle }),
    uuid: 'u',
    path: '/p',
  })!;

describe('placing a library footprint that carries a point', () => {
  it('moves the point with it, as FOOTPRINT::SetPosition does', () => {
    const fp = place({ x: MM(148.5), y: MM(105) });
    expect(fp.points).toHaveLength(1);
    expect(fp.points[0]!.at).toEqual({ x: MM(149.77), y: MM(105) });
  });

  it('rotates it about the footprint origin too, as SetOrientation does', () => {
    // A quarter turn takes (1.27, 0) to (0, -1.27) in KiCad's screen-y-down
    // convention, then the translation is added.
    const fp = place({ x: MM(100), y: MM(50) }, 90);
    expect(fp.points[0]!.at).toEqual({ x: MM(100), y: MM(48.73) });
  });

  it('leaves the point at the library position when placed at the origin', () => {
    // The transform is an offset, not an unconditional rewrite.
    const fp = place({ x: 0, y: 0 });
    expect(fp.points[0]!.at).toEqual({ x: MM(1.27), y: 0 });
  });

  it('keeps the size and layer the library gave it', () => {
    const p = place({ x: MM(148.5), y: MM(105) }).points[0]!;
    expect(p.size).toBe(MM(2));
    expect(p.layer).toBe('F.Fab');
  });

  it('keeps the footprint bounding box the size of the footprint', () => {
    // The consequence that mattered. `footprintBBox` counts points, so an
    // untranslated one stretched this box from the sheet origin to the part —
    // 152 x 109 mm for a 5 mm LED at (148.5, 105).
    const fp = place({ x: MM(148.5), y: MM(105) });
    const b = footprintBBox(fp, false)!;

    expect(b.maxX - b.minX).toBeLessThan(MM(10));
    expect(b.maxY - b.minY).toBeLessThan(MM(10));
    // and it really is around the placement, not around the origin.
    expect(b.minX).toBeGreaterThan(MM(140));
    expect(b.minY).toBeGreaterThan(MM(100));
  });
});
