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
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { ParseFootprintFile } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const mmToIU = (n: number): number => pcbIUScale.mmToIU(n);

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

describe('SpreadFootprints measures the footprint without its text (GetBoundingBox( false ))', () => {
  it('the text-free box is the copper, 11 x 1 mm', () => {
    const box = ParseFootprintFile(source('D1')).GetBoundingBox(false);
    expect(box.GetWidth()).toBe(mmToIU(11));
    expect(box.GetHeight()).toBe(mmToIU(1));
  });

  it('the box WITH text is far taller, which is what made the layout airy', () => {
    expect(ParseFootprintFile(source('D1')).GetBoundingBox(true).GetHeight()).toBeGreaterThan(
      mmToIU(6),
    );
  });
});
