// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SpreadFootprints` (`pcbnew/autorouter/spread_footprints.cpp`), the layout the
 * new footprints of a netlist update arrive in.
 *
 * The behaviour nothing pinned, and which made our result visibly airier than
 * pcbnew's on the same schematic: **the cell size is the footprint's bounding
 * box WITHOUT text.** Every one of the four boxes upstream measures is
 * `footprint->GetBoundingBox( false )` (:137, :210, :213, :245), and
 * `aIncludeText == false` drops the reference and value entirely
 * (`pcbnew/footprint.cpp`, the `if( aIncludeText || noDrawItems )` guard around
 * the text merge). Ours called `footprintBBox(fp)`, whose parameter DEFAULTS to
 * true, so each cell carried the height of the silkscreen reference above the
 * part and the value below it — on a through-hole diode that is roughly 1 mm of
 * copper against 7 mm of box, and the group came out with that much air in it.
 *
 * The tell in a real pcbnew capture is that the value text of one part overlaps
 * the outline of the next. A box that included the text could not produce that.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { footprintBBox } from '@ziroeda/pcbnew/src/edit-footprint.js';
import { spreadFootprints } from '@ziroeda/pcbnew/src/spread_footprints.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

/**
 * Two pads 1 mm square at x = ±5, so the copper box is 11 x 1 mm; the reference
 * sits 3 mm above the origin and the value 3 mm below, so a box that counted
 * them would be about 11 x 7 mm instead. Deliberately extreme, because the
 * whole point is which of the two numbers the pitch comes from.
 */
const source = (ref: string): string => `(footprint "D"
  (version 20241229) (generator "pcbnew")
  (layer "F.Cu")
  (property "Reference" "${ref}" (at 0 -3 0) (layer "F.SilkS")
    (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "1N4007" (at 0 3 0) (layer "F.Fab")
    (effects (font (size 1 1) (thickness 0.15))))
  (pad "1" smd rect (at -5 0) (size 1 1) (layers "F.Cu"))
  (pad "2" smd rect (at 5 0) (size 1 1) (layers "F.Cu"))
)
`;

const footprint = (ref: string): PcbFootprint => {
  const fp = readFootprintFile(parse(source(ref)))!;
  fp.reference = ref;
  return fp;
};

/** `aComponentGap`'s default, 1 mm (spread_footprints.h). */
const GAP = mmToIU(1);

describe('SpreadFootprints measures the footprint without its text', () => {
  it('the text-free box is the copper, 11 x 1 mm', () => {
    // Pads at ±5 with a 1 mm square face: x spans -5.5..5.5, y spans -0.5..0.5.
    const box = footprintBBox(footprint('D1'), false)!;
    expect(box.maxX - box.minX).toBe(mmToIU(11));
    expect(box.maxY - box.minY).toBe(mmToIU(1));
  });

  it('the box WITH text is far taller, which is what made the layout airy', () => {
    const box = footprintBBox(footprint('D1'), true)!;
    expect(box.maxY - box.minY).toBeGreaterThan(mmToIU(6));
  });

  it('stacks same-size footprints one text-free height plus the gap apart', () => {
    // `fpSize` = box size + aComponentGap = 12 x 2 mm, so `vertical` (x >= y)
    // and, with two footprints and no 5:1 wrap, `optimalCountPerLine` is 2:
    //   i = 0 -> position = fpSize/2                = (6, 1)
    //   i = 1 -> position.y += fpSize.y * (1 % 2)   = (6, 3)
    // The block and sheet packing then translate both together, so the PITCH is
    // what the cell size decides. 1 mm of copper + 1 mm of gap = 2 mm.
    const fps = [footprint('D1'), footprint('D2')];
    const [d1, d2] = spreadFootprints(fps, { x: 0, y: 0 });

    expect(d2!.x - d1!.x).toBe(0);
    expect(d2!.y - d1!.y).toBe(mmToIU(1) + GAP);
    // Which is 2 mm, not the ~8 mm a text-inclusive box would have given.
    expect(d2!.y - d1!.y).toBe(mmToIU(2));
  });

  it('honours an explicit component gap', () => {
    const fps = [footprint('D1'), footprint('D2')];
    const [d1, d2] = spreadFootprints(fps, { x: 0, y: 0 }, { componentGap: mmToIU(4) });
    expect(d2!.y - d1!.y).toBe(mmToIU(1) + mmToIU(4));
  });

  it('orders a block by reference prefix then trailing number, not by string', () => {
    // compareFootprintsbyRef: GetRefDesPrefix then GetTrailingInt, so D10 comes
    // after D2 where a plain string sort would put it before.
    const fps = [footprint('D10'), footprint('D2')];
    const [d10, d2] = spreadFootprints(fps, { x: 0, y: 0 });
    // D2 takes the first cell, D10 the second, so D10 ends up 2 mm lower.
    expect(d10!.y - d2!.y).toBe(mmToIU(2));
  });

  it('offsets the whole result by targetBoxPosition', () => {
    const fps = [footprint('D1'), footprint('D2')];
    const at0 = spreadFootprints(fps, { x: 0, y: 0 });
    const moved = spreadFootprints(fps, { x: mmToIU(50), y: mmToIU(30) });
    expect(moved[0]!.x - at0[0]!.x).toBe(mmToIU(50));
    expect(moved[0]!.y - at0[0]!.y).toBe(mmToIU(30));
  });
});
