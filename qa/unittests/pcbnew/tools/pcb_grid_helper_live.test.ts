// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_GRID_HELPER on the live BOARD (pcb_grid_helper.cpp:507-2068): the
 * anchors `computeAnchors` makes from the items the VIEW has round the cursor,
 * `BestSnapAnchor`'s snap to them, and `BestDragOrigin`'s pick among a
 * selection's own.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { MAGNETIC_OPTIONS, MAGNETIC_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_GRID_HELPER } from '@ziroeda/pcbnew/tools/pcb_grid_helper.js';
import { byUuid, mm, type TOOL_HARNESS, toolHarness, U } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

/**
 * A footprint at (40,60) with one 1 x 1 mm pad 1 mm right of its origin; a
 * track (50,60)-(60,60) on F.Cu and another from its start down to (50,66);
 * a via at (70,60); a silkscreen line (50,70)-(60,70) - each 13 x 17 um
 * off the 0.1 mm grid, so that landing on one can never be a grid round.
 */
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  (footprint "R1" (layer "F.Cu") (at 40.013 60.017) (uuid "00000000-0000-4000-8000-000000000001")
    (pad "1" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "00000000-0000-4000-8000-000000000011")))
  (segment (start 50.013 60.017) (end 60.013 60.017) (width 0.25) (layer "F.Cu") (net 1) (uuid "00000000-0000-4000-8000-000000000021"))
  (segment (start 50.013 60.017) (end 50.013 66.017) (width 0.25) (layer "F.Cu") (net 1) (uuid "00000000-0000-4000-8000-000000000022"))
  (via (at 70.013 60.017) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "00000000-0000-4000-8000-000000000031"))
  (gr_line (start 50.013 70.017) (end 60.013 70.017) (stroke (width 0.2) (type solid)) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000041"))
)
`;

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let mag: MAGNETIC_SETTINGS;
let grid: PCB_GRID_HELPER;

const F_Cu = new LSET([PCB_LAYER_ID.F_Cu]);
const SILK = new LSET([PCB_LAYER_ID.F_SilkS]);

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (b) => new TEST_PCB_FRAME(b),
    () => [],
  );
  mag = new MAGNETIC_SETTINGS();
  mag.pads = MAGNETIC_OPTIONS.CAPTURE_ALWAYS;
  mag.tracks = MAGNETIC_OPTIONS.CAPTURE_ALWAYS;
  mag.graphics = true;
  grid = new PCB_GRID_HELPER(h.mgr, mag);
  grid.SetUseGrid(true);
  grid.SetSnap(true);
});

const snap = (aAt: { x: number; y: number }, aLayers = F_Cu, aSkip: BOARD_ITEM[] = []) =>
  grid.BestSnapAnchor(aAt, aLayers, GRID_HELPER_GRIDS.GRID_CURRENT, aSkip);

describe('PCB_GRID_HELPER::BestSnapAnchor on the live BOARD (cpp:593)', () => {
  it('a cursor near a track end lands on it, off the grid', () => {
    expect(snap(mm(50.04, 60.02))).toEqual(mm(50.013, 60.017));
    expect(grid.GetSnapped()?.m_Uuid).toBe(U(21));
  });

  it('a cursor near a via lands on its centre', () => {
    expect(snap(mm(70.02, 59.97))).toEqual(mm(70.013, 60.017));
    expect(grid.GetSnapped()?.m_Uuid).toBe(U(31));
  });

  it('a pad under the cursor offers its centre', () => {
    expect(snap(mm(41.04, 60.03))).toEqual(mm(41.013, 60.017));
    expect(grid.GetSnapped()?.m_Uuid).toBe(U(11));
  });

  it('a footprint offers its origin, off its pad', () => {
    expect(snap(mm(40.04, 60.03))).toEqual(mm(40.013, 60.017));
    expect(grid.GetSnapped()?.m_Uuid).toBe(U(1));
  });

  it('of two items sharing the point, the one nearer the cursor is the snapped one', () => {
    // nearestAnchor's tie-break: the distance to each anchor's item.
    expect(snap(mm(50.05, 60.03))).toEqual(mm(50.013, 60.017));
    expect(grid.GetSnapped()?.m_Uuid).toBe(U(21));
    // A fresh helper: this one holds its snap (m_snapItem) until the cursor
    // leaves snapOut, so it would keep answering the first track.
    grid = new PCB_GRID_HELPER(h.mgr, mag);
    expect(snap(mm(50.03, 60.05))).toEqual(mm(50.013, 60.017));
    expect(grid.GetSnapped()?.m_Uuid).toBe(U(22));
  });

  it('with nothing near, the grid', () => {
    const p = snap(mm(20.03, 20.04));
    expect(p).toEqual(grid.Align(mm(20.03, 20.04), GRID_HELPER_GRIDS.GRID_CURRENT));
    expect(grid.GetSnapped()).toBeNull();
  });

  it('a skipped item offers no anchor', () => {
    const p = snap(mm(60.04, 60.03), F_Cu, [byUuid(h.board, 21)]);
    expect(p).not.toEqual(mm(60.013, 60.017));
  });

  it('only items on the given layers are anchors (magnetic allLayers off)', () => {
    expect(snap(mm(50.03, 70.04), F_Cu)).not.toEqual(mm(50.013, 70.017));
    expect(snap(mm(50.03, 70.04), SILK)).toEqual(mm(50.013, 70.017));
  });

  it('magnetic tracks other than CAPTURE_ALWAYS leave the track alone', () => {
    mag.tracks = MAGNETIC_OPTIONS.CAPTURE_CURSOR_IN_TRACK_TOOL;
    expect(snap(mm(50.03, 60.04))).not.toEqual(mm(50.013, 60.017));
  });

  it('the middle of a track is an anchor too, but not a snappable one', () => {
    // `addAnchor( track->GetCenter(), ORIGIN, … )`: no SNAPPABLE flag.
    expect(snap(mm(55.03, 60.04))).not.toEqual(mm(55.013, 60.017));
  });
});

describe('PCB_GRID_HELPER::BestDragOrigin on the live BOARD (cpp:507)', () => {
  it("a footprint's own origin, not the mouse", () => {
    const fp = byUuid(h.board, 1);
    expect(grid.BestDragOrigin(mm(40.1, 60.1), [fp])).toEqual(mm(40.013, 60.017));
  });

  it('a footprint grabbed on its pad drags from the pad (the pad under the mouse)', () => {
    const fp = byUuid(h.board, 1);
    expect(grid.BestDragOrigin(mm(41.1, 60.1), [fp])).toEqual(mm(41.013, 60.017));
  });

  it('a track grabbed near its end drags from that end', () => {
    const t = byUuid(h.board, 21);
    expect(grid.BestDragOrigin(mm(59.2, 60.1), [t])).toEqual(mm(60.013, 60.017));
  });

  it('no items, the mouse', () => {
    expect(grid.BestDragOrigin(mm(12.3, 4.5), [])).toEqual(mm(12.3, 4.5));
  });
});

describe('barcode and point anchors (computeAnchors, pcb_grid_helper.cpp:1790-1797)', () => {
  const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user)
    (41 "Dwgs.User" user "User.Drawings"))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (barcode (at 100 100 0) (layer "Dwgs.User") (size 8 8) (text "ZIRO")
    (text_height 1.27) (type qr) (ecc_level L) (hide yes) (knockout no)
    (uuid "00000000-0000-4000-8000-000000000051"))
  (point (at 120 100) (size 1.5) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000061"))
)
`;
  let g: PCB_GRID_HELPER;
  const DWGS = new LSET([PCB_LAYER_ID.Dwgs_User]);
  const near = (p: { x: number; y: number }) => ({ x: p.x + 200_000, y: p.y + 200_000 });
  const at = (p: { x: number; y: number }, aLayers: LSET) =>
    g.BestSnapAnchor(p, aLayers, GRID_HELPER_GRIDS.GRID_CURRENT, []);

  beforeEach(() => {
    const hh = toolHarness(
      TEXT,
      (b) => new TEST_PCB_FRAME(b),
      () => [],
    );
    const m = new MAGNETIC_SETTINGS();
    m.graphics = true;
    g = new PCB_GRID_HELPER(hh.mgr, m);
    // No grid: an unpulled cursor comes back as it went in.
    g.SetUseGrid(false);
    g.SetSnap(true);
  });

  // 8 mm square centred on (100, 100). One query per helper: a held snap
  // stays until the cursor leaves it (m_snapItem).
  it('pulls the cursor onto a corner of the barcode symbol', () => {
    expect(at(near(mm(96, 96)), DWGS)).toEqual(mm(96, 96));
  });

  it('and onto the middle of an edge', () => {
    expect(at(near(mm(100, 96)), DWGS)).toEqual(mm(100, 96));
  });

  it('pulls the cursor onto a point', () => {
    expect(at(near(mm(120, 100)), SILK)).toEqual(mm(120, 100));
  });

  it('offers neither from a layer the caller is not on', () => {
    expect(at(near(mm(96, 96)), F_Cu)).toEqual(near(mm(96, 96)));
    expect(at(near(mm(120, 100)), F_Cu)).toEqual(near(mm(120, 100)));
  });
});
