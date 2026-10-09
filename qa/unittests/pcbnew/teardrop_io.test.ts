// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Teardrops on disk: `(teardrops …)` on pads and vias, `(attr (teardrop (type
 * …)))` on the generated zones, and the round trip through the writer. What
 * TEARDROP_MANAGER builds and writes is teardrop_manager.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import {
  TEARDROP_PARAMETERS,
  TEARDROP_TYPE,
} from '@ziroeda/pcbnew/teardrop/teardrop_parameters.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** A minimal board: one via, one track into it, one net. */
const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "N1")
  (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
    (teardrops (best_length_ratio 0.7) (max_length 1.5) (best_width_ratio 0.9)
      (max_width 1.8) (curved_edges yes) (filter_ratio 0.8) (enabled yes)
      (allow_two_segments no) (prefer_zone_connections no))
    (uuid "aaaaaaaa-0000-4000-8000-000000000001"))
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "aaaaaaaa-0000-4000-8000-000000000002"))
)`;

const load = (text: string): BOARD => ParseBoard(text);
const via = (b: BOARD): PCB_VIA =>
  b.Tracks().find((t) => t.Type() === KICAD_T.PCB_VIA_T)! as PCB_VIA;

describe('(teardrops …) on a via (parseTEARDROP_PARAMETERS)', () => {
  const board = load(SRC);

  it('reads every field, inverting prefer_zone_connections', () => {
    const td = via(board).GetTeardropParams();

    expect(td.m_Enabled).toBe(true);
    expect(td.m_BestLengthRatio).toBeCloseTo(0.7);
    expect(td.m_TdMaxLen).toBe(MM(1.5));
    expect(td.m_BestWidthRatio).toBeCloseTo(0.9);
    expect(td.m_TdMaxWidth).toBe(MM(1.8));
    expect(td.m_CurvedEdges).toBe(true);
    expect(td.m_WidthtoSizeFilterRatio).toBeCloseTo(0.8);
    expect(td.m_AllowUseTwoTracks).toBe(false);
    // (prefer_zone_connections no) means m_TdOnPadsInZones = true.
    expect(td.m_TdOnPadsInZones).toBe(true);
  });

  it('fills in upstream defaults for tokens the file omits', () => {
    const td = via(
      load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (teardrops (enabled yes)))
    )`),
    ).GetTeardropParams();

    expect(td.m_Enabled).toBe(true);
    expect(td.m_BestLengthRatio).toBe(0.5);
    expect(td.m_TdMaxLen).toBe(MM(1.0));
    expect(td.m_BestWidthRatio).toBe(1.0);
    expect(td.m_TdMaxWidth).toBe(MM(2.0));
    expect(td.m_WidthtoSizeFilterRatio).toBe(0.9);
    // `parseTEARDROP_PARAMETERS` resets these two on entry (:671-672), the
    // opposite way round from the constructor: absent tokens mean "no" and
    // "yes" here, not the defaults.
    expect(td.m_AllowUseTwoTracks).toBe(false);
    expect(td.m_TdOnPadsInZones).toBe(true);
  });

  it('reads the legacy (curve_points …) spelling', () => {
    const td = via(
      load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (teardrops (curve_points 5)))
    )`),
    ).GetTeardropParams();

    expect(td.m_CurvedEdges).toBe(true);
  });

  it('leaves the constructor’s parameters when the token is absent', () => {
    const td = via(
      load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
    )`),
    ).GetTeardropParams();

    expect(td.equals(new TEARDROP_PARAMETERS())).toBe(true);
  });

  it('writes the fields back', () => {
    const flat = FormatBoard(board).replace(/\s+/g, ' ').replace(/ \)/g, ')');
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

    const td = board.Footprints()[0]!.Pads()[0]!.GetTeardropParams();
    expect(td.m_Enabled).toBe(true);
    expect(td.m_CurvedEdges).toBe(true);
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

    expect(board.Zones().map((z) => z.GetTeardropAreaType())).toEqual([
      TEARDROP_TYPE.TD_VIAPAD,
      TEARDROP_TYPE.TD_TRACKEND,
      TEARDROP_TYPE.TD_NONE,
    ]);
  });
});
