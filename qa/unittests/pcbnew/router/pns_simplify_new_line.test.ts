// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LINE_PLACER::simplifyNewLine` (pcbnew/router/pns_line_placer.cpp:1899-2003) when a track
 * the route ends on is an ARC.
 *
 * Its colinear clean-up reads every neighbour at a non-corner joint through
 * `static_cast<const SEGMENT*>( neighbor )->Seg()`, arcs included (the filter just above
 * admits `SEGMENT_T | ARC_T`). Our port called `.seg()` on a PnsArc, which has none, and a
 * route fixed onto an arc threw "f.seg is not a function" (Sentry JAVASCRIPT-REACT-1G, the
 * cm5_minima demo, 11-10).
 */
import { describe, expect, it } from 'vitest';
import { BOARD_DESIGN_SETTINGS } from '@ziroeda/pcbnew/board_design_settings.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PnsKind, type PnsItem } from '@ziroeda/pcbnew/router/pns_item.js';
import {
  PNS_KICAD_IFACE,
  PnsDesignSettingsFromBds,
} from '@ziroeda/pcbnew/router/pns_kicad_iface.js';
import { PnsLinePlacer, type PnsRouterLike } from '@ziroeda/pcbnew/router/pns_line_placer.js';
import { PnsNode } from '@ziroeda/pcbnew/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/router/pns_segment.js';

const MM = 1e6;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (x: number, y: number) => ({ x: x * MM, y: y * MM });

/** An arc track on net "a" ending at a via at (20, 20) - three links there with the new segment. */
function board(aMid: string, aEnd: string): string {
  return `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (setup)
  (net 0 "") (net 1 "a")
  (arc (start 20 20) (mid ${aMid}) (end ${aEnd}) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U(1)}"))
  (via (at 20 20) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(2)}"))
)`;
}

/**
 * The route's new segment, (20, 20) to (40, 20) at the arc's width, added to a branch of the
 * synced world the way a fixed route lands in `m_lastNode`; then simplifyNewLine on it.
 */
function simplify(aMid: string, aEnd: string): { node: PnsNode; arcs: () => PnsItem[] } {
  const b = ParseBoard(board(aMid, aEnd));
  const bds: BOARD_DESIGN_SETTINGS = b.GetDesignSettings();
  const iface = new PNS_KICAD_IFACE(b, { designSettings: PnsDesignSettingsFromBds(bds) });
  const world = new PnsNode();
  world.beginBulkAdd();
  iface.syncWorld(world);
  world.finalizeBulkAdd();

  const arc = world
    .hitTest(at(20, 20))
    .items()
    .find((i: PnsItem) => i.kind() === PnsKind.ARC_T)!;

  expect(arc).toBeTruthy();

  const node = world.branch();
  const seg = new PnsSegment({ a: at(20, 20), b: at(40, 20) }, arc.net());
  seg.setLayers(arc.layers());
  seg.setWidth(0.25 * MM);
  node.addSegment(seg);

  new PnsLinePlacer({} as PnsRouterLike).simplifyNewLine(node, seg);

  const arcs = (): PnsItem[] =>
    node
      .hitTest(at(20, 20))
      .items()
      .filter((i: PnsItem) => i.kind() === PnsKind.ARC_T);
  return { node, arcs };
}

describe('simplifyNewLine with an arc at the joint (pns_line_placer.cpp:1915-1960)', () => {
  it('a route fixed onto an arc track does not throw, and an arc bending away stays', () => {
    // The arc leaves (20, 20) heading up and round: nothing colinear with the new segment.
    const { arcs } = simplify('25 15', '30 20');

    expect(arcs()).toHaveLength(1);
  });

  it('reads the arc as KiCad does: SEG( start, mid ), so one whose first half lies on the route is cleaned up', () => {
    // SEGMENT::Seg() returns m_seg.GetSeg(); on an ARC the same bytes are SHAPE_ARC's first
    // two members, m_start and m_mid (both classes derive from SHAPE alone), so the release
    // build compares SEG( (20,20), (30,20) ) - inside the new segment - and the arc's far
    // joint has only the arc, so the arc is removed.
    const { arcs } = simplify('30 20', '40 30');

    expect(arcs()).toHaveLength(0);
  });
});
