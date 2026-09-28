// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Teardrops on disk: `(teardrops …)` on pads and vias, `(attr (teardrop (type
 * …)))` on the generated zones, and the round trip through the writer. What
 * TEARDROP_MANAGER builds and writes is teardrop_manager.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);

/** A minimal board: one via, one track into it, one net. */
const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "N1")
  (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
    (teardrops (best_length_ratio 0.7) (max_length 1.5) (best_width_ratio 0.9)
      (max_width 1.8) (curved_edges yes) (filter_ratio 0.8) (enabled yes)
      (allow_two_segments no) (prefer_zone_connections no))
    (uuid "v1"))
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "t1"))
)`;

const load = (text: string): Board => readBoard(parse(text));

describe('(teardrops …) on a via', () => {
  const board = load(SRC);

  it('reads every field, inverting prefer_zone_connections', () => {
    const td = board.vias[0]!.teardrops;

    expect(td).toBeDefined();
    expect(td!.enabled).toBe(true);
    expect(td!.bestLengthRatio).toBeCloseTo(0.7);
    expect(td!.tdMaxLen).toBe(MM(1.5));
    expect(td!.bestWidthRatio).toBeCloseTo(0.9);
    expect(td!.tdMaxWidth).toBe(MM(1.8));
    expect(td!.curvedEdges).toBe(true);
    expect(td!.widthtoSizeFilterRatio).toBeCloseTo(0.8);
    expect(td!.allowUseTwoTracks).toBe(false);
    // (prefer_zone_connections no) means m_TdOnPadsInZones = true.
    expect(td!.tdOnPadsInZones).toBe(true);
  });

  it('fills in upstream defaults for tokens the file omits', () => {
    const partial = load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (teardrops (enabled yes)))
    )`);
    const td = partial.vias[0]!.teardrops!;

    expect(td.enabled).toBe(true);
    expect(td.bestLengthRatio).toBe(0.5);
    expect(td.tdMaxLen).toBe(MM(1.0));
    expect(td.bestWidthRatio).toBe(1.0);
    expect(td.tdMaxWidth).toBe(MM(2.0));
    expect(td.widthtoSizeFilterRatio).toBe(0.9);
    // `parseTEARDROP_PARAMETERS` resets these two on entry (:671-672), the
    // opposite way round from the constructor: absent tokens mean "no" and
    // "yes" here, not the defaults.
    expect(td.allowUseTwoTracks).toBe(false);
    expect(td.tdOnPadsInZones).toBe(true);
  });

  it('reads the legacy (curve_points …) spelling', () => {
    const legacy = load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (teardrops (curve_points 5)))
    )`);

    expect(legacy.vias[0]!.teardrops!.curvedEdges).toBe(true);
  });

  it('leaves the field undefined when the token is absent', () => {
    const plain = load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
    )`);

    expect(plain.vias[0]!.teardrops).toBeUndefined();
  });

  it('round-trips the file untouched', () => {
    // The via keeps its source node, so nothing is rewritten.
    const flat = serializeBoard(board).replace(/\s+/g, ' ').replace(/ \)/g, ')');
    expect(flat).toContain('(best_length_ratio 0.7)');
    expect(flat).toContain('(prefer_zone_connections no)');
  });
});

describe('(teardrops …) on a pad', () => {
  it('reads through the footprint', () => {
    const board = load(`(kicad_pcb (version 20240108)
      (footprint "R" (at 0 0) (layer "F.Cu")
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")
          (teardrops (enabled yes) (curved_edges yes))))
    )`);

    const td = board.footprints[0]!.pads[0]!.teardrops!;
    expect(td.enabled).toBe(true);
    expect(td.curvedEdges).toBe(true);
  });
});

describe('(attr (teardrop (type …))) on a zone', () => {
  it('reads both variants and leaves user zones unmarked', () => {
    const board = load(`(kicad_pcb (version 20240108)
      (zone (net 1) (net_name "N1") (layer "F.Cu") (hatch none 0.5)
        (attr (teardrop (type padvia)))
        (connect_pads yes (clearance 0)) (min_thickness 0.0254)
        (fill yes) (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1))))
      (zone (net 1) (net_name "N1") (layer "F.Cu") (hatch none 0.5)
        (attr (teardrop (type track_end)))
        (connect_pads yes (clearance 0)) (min_thickness 0.0254)
        (fill yes) (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1))))
      (zone (net 1) (net_name "N1") (layer "F.Cu") (hatch edge 0.5)
        (connect_pads (clearance 0.5)) (min_thickness 0.25)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
    )`);

    expect(board.zones.map((z) => z.teardropType)).toEqual(['viapad', 'trackend', undefined]);
  });
});
