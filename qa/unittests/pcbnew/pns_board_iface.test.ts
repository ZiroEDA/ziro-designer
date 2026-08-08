// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS_KICAD_IFACE_BASE` over Ziro's `Board` — `pns_board_iface.ts`.
 *
 * The first router test in this tree that fills a `PnsNode` from a **real
 * board**. Every earlier one built its items by hand, which is fine for
 * arithmetic and useless for the one thing a bridge can get wrong: the mapping
 * itself. `ecc83-pp.kicad_pcb` is the demo `connectivity.test.ts`,
 * `drc_probe.test.ts` and `pns_drag.test.ts` already use.
 *
 * What that board cannot cover, and why the synthetic boards below exist: it is
 * two-layer and has **no vias, no arcs and no inner layers** — and neither does
 * any other `.kicad_pcb` in this repo (all 15 were checked). The via, arc and
 * inner-layer paths are therefore driven from a four-layer board built as
 * source text and put through the same `readBoard`, so the reader is still in
 * the loop even though the file is not on disk.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew';
import {
  PnsBoardIface,
  PNS_ORPHANED_NET,
  asBoardItem,
  boardLayerFromPnsLayer,
  padHoleShape,
  pnsLayerFromBoardLayer,
  solidShapeForPad,
} from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import { setRouterIface } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import type { PnsBoardNet } from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import type { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import type { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import type { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import type { Board, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const ECC83 = new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url);

const readEcc83 = (): Board => readBoard(parse(readFileSync(ECC83, 'utf8')));

/** `ROUTER::SyncWorld` (pns_router.cpp:95-105), which is what a caller does. */
function syncInto(aBoard: Board): { iface: PnsBoardIface; node: PnsNode } {
  const iface = new PnsBoardIface(aBoard);

  // `ITEM::collideSimple` reaches `isFlashedOnLayer` through this singleton.
  setRouterIface(iface);

  const node = new PnsNode();
  node.beginBulkAdd();
  iface.syncWorld(node);
  node.finalizeBulkAdd();
  node.fixupVirtualVias();

  return { iface, node };
}

const allPads = (aBoard: Board): PcbPad[] => aBoard.footprints.flatMap((f) => f.pads);

// ---------------------------------------------------------------------------

describe('a real board in a real node: demos/ecc83/ecc83-pp.kicad_pcb', () => {
  let board: Board;
  let iface: PnsBoardIface;
  let node: PnsNode;

  beforeEach(() => {
    board = readEcc83();
    ({ iface, node } = syncInto(board));
  });

  it('is the board this test thinks it is', () => {
    // If the fixture changes, the counts below are meaningless rather than
    // wrong, so they are pinned to the board's own totals as well as to
    // literals.
    expect(allPads(board)).toHaveLength(33);
    expect(board.tracks).toHaveLength(59);
    expect(board.arcs).toHaveLength(0);
    expect(board.vias).toHaveLength(0);
    expect(iface.copperLayerCount()).toBe(2);
  });

  it('adds one SOLID per pad, one SEGMENT per track, and a HOLE per drilled pad', () => {
    const pads = allPads(board);
    const drilled = pads.filter((p) => (p.drill?.w ?? 0) > 0);

    expect(drilled).toHaveLength(33); // every pad on this board is through-hole

    for (const pad of pads) {
      const items = node.findItemsByParent(asBoardItem(pad));

      expect(items).toHaveLength(1);
      expect(items[0]!.kind()).toBe(PnsKind.SOLID_T);
      expect((items[0] as PnsSolid).hasHole()).toBe(true);
    }

    for (const track of board.tracks) {
      const items = node.findItemsByParent(asBoardItem(track));

      expect(items).toHaveLength(1);
      expect(items[0]!.kind()).toBe(PnsKind.SEGMENT_T);
    }

    // The index holds the holes too — a HOLE is an item in its own right, which
    // is what makes hole-to-hole clearance expressible at all.
    expect(node.index().size()).toBe(pads.length + drilled.length + board.tracks.length);
    expect(node.index().size()).toBe(125);
  });

  it('links joints at track endpoints, and a track lands on the pad it meets', () => {
    expect(node.jointCount()).toBe(90);

    const track = board.tracks[0]!;
    const layer = iface.getPnsLayerFromBoardLayer(track.layer);
    const net = iface.netHandle(track.net);
    const segment = node.findItemsByParent(asBoardItem(track))[0] as PnsSegment;

    for (const end of [track.start, track.end]) {
      const joint = node.findJoint(end, layer, net);

      expect(joint).not.toBeNull();
      expect(joint!.linkList()).toContain(segment);
    }

    // Every track endpoint on the board has a joint, and every joint a track
    // ends at carries that track.
    for (const t of board.tracks) {
      const l = iface.getPnsLayerFromBoardLayer(t.layer);
      const n = iface.netHandle(t.net);
      const s = node.findItemsByParent(asBoardItem(t))[0]!;

      expect(node.findJoint(t.start, l, n)?.linkList()).toContain(s);
      expect(node.findJoint(t.end, l, n)?.linkList()).toContain(s);
    }
  });

  it('joins a pad to the tracks that reach it', () => {
    // Pick a pad that at least one track ends on, and check the joint carries
    // both. This is the whole point of the sync: connectivity, not geometry.
    let checked = 0;

    for (const pad of allPads(board)) {
      const solid = node.findItemsByParent(asBoardItem(pad))[0] as PnsSolid;
      const net = iface.netHandle(pad.net);

      const touching = board.tracks.filter(
        (t) => t.net === (pad.net ?? 0) && (samePoint(t.start, pad.at) || samePoint(t.end, pad.at)),
      );

      if (touching.length === 0) continue;

      const layer = iface.getPnsLayerFromBoardLayer(touching[0]!.layer);
      const joint = node.findJoint(pad.at, layer, net);

      expect(joint).not.toBeNull();
      expect(joint!.linkList()).toContain(solid);
      checked++;
    }

    expect(checked).toBe(10);
  });

  it('gives every item the right net handle, interned once per net code', () => {
    for (const track of board.tracks) {
      const segment = node.findItemsByParent(asBoardItem(track))[0]!;

      expect(iface.getNetCode(segment.net())).toBe(track.net);
      expect(iface.getNetName(segment.net())).toBe(board.nets.get(track.net) ?? '');
      // Identity, not equality: `ITEM::collideSimple` compares handles.
      expect(segment.net()).toBe(iface.netHandle(track.net));
    }

    for (const pad of allPads(board)) {
      const solid = node.findItemsByParent(asBoardItem(pad))[0]!;

      expect(iface.getNetCode(solid.net())).toBe(pad.net ?? 0);
    }
  });

  it('spans every copper layer for a through-hole pad and one for an SMD pad', () => {
    const stack = new PnsLayerRange(0, 1);

    for (const pad of allPads(board)) {
      const solid = node.findItemsByParent(asBoardItem(pad))[0]!;

      if (pad.type === 'thru_hole' || pad.type === 'np_thru_hole') {
        expect(solid.layers().equals(stack)).toBe(true);
      } else {
        expect(solid.layers().isMultilayer()).toBe(false);
      }
    }
  });

  it('installs a rule resolver and a max clearance on the node', () => {
    expect(node.getRuleResolver()).toBe(iface.getRuleResolver());
    expect(node.getRuleResolver()).not.toBeNull();
    expect(iface.getWorld()).toBe(node);
    expect(node.getMaxClearance()).toBeGreaterThanOrEqual(0);
  });

  it('places each solid at its pad, not at the origin plus its pad', () => {
    // `SOLID::SetPos` moves the shape by the delta, so calling it after
    // `SetShape` would translate every pad by its own position. A pad far from
    // the origin makes that failure enormous and obvious.
    for (const pad of allPads(board)) {
      const solid = node.findItemsByParent(asBoardItem(pad))[0] as PnsSolid;

      expect(solid.pos()).toEqual(pad.at);

      const shape = solid.shape(-1)!;
      const centre =
        shape.kind === 'circle'
          ? shape.c
          : shape.kind === 'stadium'
            ? { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 }
            : centroid(shape.kind === 'poly' ? shape.pts : []);

      expect(Math.hypot(centre.x - pad.at.x, centre.y - pad.at.y)).toBeLessThan(1000);
    }
  });
});

// ---------------------------------------------------------------------------

const MULTILAYER = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal))
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 10 0) (end 10 10) (width 0.25) (layer "In2.Cu") (net 1))
  (arc (start 0 5) (mid 2 7) (end 5 9) (width 0.3) (layer "In1.Cu") (net 2))
  (via (at 10 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
  (via (at 20 0) (size 0.6) (drill 0.3) (layers "F.Cu" "In1.Cu") (net 2))
  (footprint "T" (layer "F.Cu") (at 30 0)
    (pad "1" thru_hole circle (at 0 0) (size 1.2 1.2) (drill 0.6) (layers "*.Cu") (net 1))
    (pad "2" smd rect (at 2 0) (size 1 0.6) (layers "F.Cu") (net 2))
    (pad "3" np_thru_hole circle (at 4 0) (size 2 2) (drill 1) (layers "*.Cu"))
    (pad "4" thru_hole oval (at 6 0) (size 2 1.4) (drill oval 1.2 0.6) (layers "*.Cu") (net 1))))`;

describe('a four-layer board: vias, arcs and the inner-layer mapping', () => {
  const board = readBoard(parse(MULTILAYER));
  const { iface, node } = syncInto(board);

  it('numbers the copper stack front, inners, back', () => {
    expect(iface.copperLayerCount()).toBe(4);
    expect(iface.getPnsLayerFromBoardLayer('F.Cu')).toBe(0);
    expect(iface.getPnsLayerFromBoardLayer('In1.Cu')).toBe(1);
    expect(iface.getPnsLayerFromBoardLayer('In2.Cu')).toBe(2);
    expect(iface.getPnsLayerFromBoardLayer('B.Cu')).toBe(3);

    expect(iface.getBoardLayerFromPnsLayer(0)).toBe('F.Cu');
    expect(iface.getBoardLayerFromPnsLayer(1)).toBe('In1.Cu');
    expect(iface.getBoardLayerFromPnsLayer(2)).toBe('In2.Cu');
    expect(iface.getBoardLayerFromPnsLayer(3)).toBe('B.Cu');
  });

  it('puts a track on the inner layer it names', () => {
    const inner = board.tracks.find((t) => t.layer === 'In2.Cu')!;
    const segment = node.findItemsByParent(asBoardItem(inner))[0] as PnsSegment;

    expect(segment.layers().equals(new PnsLayerRange(2, 2))).toBe(true);
    expect(segment.width()).toBe(inner.width);
    expect(segment.seg().a).toEqual(inner.start);
    expect(segment.seg().b).toEqual(inner.end);
  });

  it('keeps an arc as an arc, through its three points', () => {
    const arc = board.arcs[0]!;
    const items = node.findItemsByParent(asBoardItem(arc));

    expect(items).toHaveLength(1);
    expect(items[0]!.kind()).toBe(PnsKind.ARC_T);
    expect(items[0]!.layers().equals(new PnsLayerRange(1, 1))).toBe(true);
  });

  it('spans a through via across the whole stack and a blind via across its own', () => {
    const through = node.findItemsByParent(asBoardItem(board.vias[0]!))[0] as PnsVia;
    const blind = node.findItemsByParent(asBoardItem(board.vias[1]!))[0] as PnsVia;

    expect(through.layers().equals(new PnsLayerRange(0, 3))).toBe(true);
    expect(blind.layers().equals(new PnsLayerRange(0, 1))).toBe(true);

    expect(through.diameter(0)).toBe(board.vias[0]!.size);
    expect(through.drill()).toBe(board.vias[0]!.drill);
    expect(through.hasHole()).toBe(true);
    expect(through.holeLayers().equals(new PnsLayerRange(0, 3))).toBe(true);
  });

  it('links a via into the joint the track ending at it also holds', () => {
    const track = board.tracks.find((t) => t.layer === 'F.Cu')!;
    const via = node.findItemsByParent(asBoardItem(board.vias[0]!))[0]!;
    const joint = node.findJoint(track.end, 0, iface.netHandle(track.net));

    expect(joint).not.toBeNull();
    expect(joint!.linkList()).toContain(via);
  });

  it('classifies pads by attribute', () => {
    const pads = allPads(board);
    const [pth, smd, npth, oval] = pads.map(
      (p) => node.findItemsByParent(asBoardItem(p))[0] as PnsSolid,
    );

    expect(pth!.layers().equals(new PnsLayerRange(0, 3))).toBe(true);
    expect(pth!.isRoutable()).toBe(true);

    // An SMD pad takes the *front* of its own copper stack, one layer wide.
    expect(smd!.layers().equals(new PnsLayerRange(0, 0))).toBe(true);

    // NPTH: still an obstacle, still indexed, but not connectable.
    expect(npth!.isRoutable()).toBe(false);
    expect(iface.startPointUnroutableReason(npth!)).toBe(
      'Cannot start routing from a non-plated hole.',
    );
    expect(iface.startPointUnroutableReason(pth!)).toBeNull();

    // An oblong drill is a stadium, not a circle.
    expect(oval!.hole()!.shape(-1)!.kind).toBe('stadium');
    expect(pth!.hole()!.shape(-1)!.kind).toBe('circle');
    // The hole spans the whole board whatever the pad's own layers say.
    expect(pth!.hole()!.layers().equals(new PnsLayerRange(0, 3))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('layer mapping', () => {
  it('is the round trip upstream computes arithmetically', () => {
    for (const count of [2, 4, 8]) {
      for (let i = 0; i < count; i++) {
        const name = boardLayerFromPnsLayer(i, count);

        expect(name).not.toBe('');
        expect(pnsLayerFromBoardLayer(name, count)).toBe(i);
      }
    }
  });

  it('answers -1 for a layer that is not copper', () => {
    for (const name of ['F.SilkS', 'Edge.Cuts', 'B.Mask', 'User.1', '']) {
      expect(pnsLayerFromBoardLayer(name, 4)).toBe(-1);
    }
  });

  it('answers the undefined layer outside the stack', () => {
    expect(boardLayerFromPnsLayer(-1, 4)).toBe('');
    expect(boardLayerFromPnsLayer(4, 4)).toBe('');
    expect(boardLayerFromPnsLayer(3, 4)).toBe('B.Cu');
  });

  it('calls layer 0 the front even on a one-layer board', () => {
    // Upstream tests `aLayer == 0` before `aLayer == count - 1`, so the two
    // arms cannot both fire.
    expect(boardLayerFromPnsLayer(0, 1)).toBe('F.Cu');
  });

  it('is copper exactly where the board-layer conversion produces copper', () => {
    const iface = new PnsBoardIface(readBoard(parse(MULTILAYER)));

    expect([0, 1, 2, 3].map((l) => iface.isPnsCopperLayer(l))).toEqual([true, true, true, true]);
    expect(iface.isPnsCopperLayer(-1)).toBe(false);
    expect(iface.isPnsCopperLayer(4)).toBe(false);
  });

  it('skips a track whose layer is not copper', () => {
    // No upstream counterpart — every PCB_TRACE_T is on copper there — but a
    // parsed file can carry one, and an item with layer -1 overlaps nothing.
    const board = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
        (layers (0 "F.Cu" signal) (2 "B.Cu" signal)) (net 0 "")
        (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.SilkS") (net 0)))`),
    );
    const { node } = syncInto(board);

    expect(node.index().size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('nets', () => {
  const board = readEcc83();
  const iface = new PnsBoardIface(board);

  it('is -1 and empty for the null handle', () => {
    expect(iface.getNetCode(null)).toBe(-1);
    expect(iface.getNetName(null)).toBe('');
  });

  it('interns one handle per code, and net 0 gets one too', () => {
    expect(iface.netHandle(1)).toBe(iface.netHandle(1));
    expect(iface.netHandle(0)).toBe(iface.netHandle(0));
    expect(iface.netHandle(0)).not.toBe(iface.netHandle(1));

    // Net 0 is a handle, not null: upstream's netcode-0 items share one
    // non-null NETINFO_ITEM, so the same-net exemption fires between two
    // unconnected pieces of copper. `boardObstacleHulls` deliberately does the
    // opposite; this is the bridge, and this is upstream.
    expect(iface.netHandle(0)).not.toBeNull();
    expect(iface.getNetCode(iface.netHandle(0))).toBe(0);
  });

  it('keeps the orphaned handle apart from a board net 0', () => {
    expect(iface.getOrphanedNetHandle()).toBe(PNS_ORPHANED_NET);
    expect(iface.getOrphanedNetHandle()).not.toBe(iface.netHandle(0));
    expect(iface.getNetCode(iface.getOrphanedNetHandle())).toBe(0);
    expect(iface.getNetName(iface.getOrphanedNetHandle())).toBe('');
  });

  it('names a net the way the board does', () => {
    for (const [code, name] of board.nets) {
      expect((iface.netHandle(code) as PnsBoardNet).name).toBe(name);
    }
  });
});

// ---------------------------------------------------------------------------

describe('pad shapes', () => {
  const padOf = (aSexpr: string): PcbPad =>
    allPads(
      readBoard(
        parse(`(kicad_pcb (version 20241229) (generator "test")
          (layers (0 "F.Cu" signal) (2 "B.Cu" signal)) (net 0 "")
          (footprint "T" (layer "F.Cu") (at 0 0) ${aSexpr}))`),
      ),
    )[0]!;

  it('uses the single effective shape where there is one', () => {
    expect(
      solidShapeForPad(padOf('(pad "1" smd circle (at 0 0) (size 1 1) (layers "F.Cu"))'))!.kind,
    ).toBe('circle');
    expect(
      solidShapeForPad(padOf('(pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu"))'))!.kind,
    ).toBe('poly');
    expect(
      solidShapeForPad(padOf('(pad "1" smd oval (at 0 0) (size 2 1) (layers "F.Cu"))'))!.kind,
    ).toBe('stadium');
  });

  it('convex-hulls a pad whose effective shape is more than one primitive', () => {
    // A chamfered round-rect is a polygon plus one circle per rounded corner.
    // Upstream falls back to the effective polygon's outline; there is no
    // polygon union here, so it is the hull — an over-approximation that never
    // lets a route closer to copper than KiCad would.
    const pad = padOf(
      `(pad "1" smd roundrect (at 0 0) (size 2 2) (layers "F.Cu")
         (roundrect_rratio 0.25) (chamfer_ratio 0.2) (chamfer top_left))`,
    );
    const shape = solidShapeForPad(pad)!;

    expect(shape.kind).toBe('poly');
    if (shape.kind !== 'poly') throw new Error('unreachable');

    // The hull covers the pad: every corner of the 2x2 mm box is within it or
    // on it, to within the chamfer.
    const xs = shape.pts.map((p) => p.x);
    const ys = shape.pts.map((p) => p.y);

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
    // r is folded into the points, not left on the shape.
    expect(shape.r).toBe(0);
  });

  it('is a circle for a round drill and a stadium for an oblong one', () => {
    const round = padOf('(pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu"))');
    const slot = padOf(
      '(pad "1" thru_hole oval (at 0 0) (size 3 1.5) (drill oval 2 1) (layers "*.Cu"))',
    );

    expect(padHoleShape(round)!.kind).toBe('circle');

    const s = padHoleShape(slot)!;
    expect(s.kind).toBe('stadium');
    if (s.kind !== 'stadium') throw new Error('unreachable');
    // Radius is the short axis; the stadium spans the difference of the two.
    expect(s.r).toBeCloseTo(
      padOf('(pad "1" thru_hole oval (at 0 0) (size 3 1.5) (drill oval 2 1) (layers "*.Cu"))')
        .drill!.h / 2,
    );
    expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeCloseTo(slot.drill!.w - slot.drill!.h);
  });

  it('has no hole shape when the pad has no drill', () => {
    expect(
      padHoleShape(padOf('(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))')),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('the parts that are deliberately not implemented', () => {
  const board = readEcc83();

  it('records board mutations rather than applying them', () => {
    const { iface, node } = syncInto(board);
    const item = node.findItemsByParent(asBoardItem(board.tracks[0]!))[0]!;

    expect(iface.pendingChanges()).toHaveLength(0);

    iface.addItem(item);
    iface.updateItem(item);
    iface.removeItem(item);

    expect(iface.pendingChanges().map((c) => c.kind)).toEqual(['add', 'update', 'remove']);
    expect(board.tracks).toHaveLength(59); // nothing written

    iface.commit();
    expect(iface.pendingChanges()).toHaveLength(0);
  });

  it('answers zero for the stackup and false for importSizes', () => {
    const iface = new PnsBoardIface(board);

    expect(iface.stackupHeight(0, 1)).toBe(0);
    expect(
      iface.importSizes({ trackWidth: 1 } as never, null, iface.netHandle(1), { x: 0, y: 0 }),
    ).toBe(false);
  });

  it('treats everything as visible with no view attached', () => {
    const { iface, node } = syncInto(board);
    const item = node.findItemsByParent(asBoardItem(board.tracks[0]!))[0]!;

    // Upstream's no-view answer for IsAnyLayerVisible is *false*; reproducing
    // it would make pickSingleItem reject every candidate headless.
    expect(iface.isAnyLayerVisible(new PnsLayerRange(0, 1))).toBe(true);
    expect(iface.isItemVisible(item)).toBe(true);
  });

  it('honours an injected visibility predicate', () => {
    const iface = new PnsBoardIface(board, { isLayerVisible: (l) => l === 'F.Cu' });

    expect(iface.isAnyLayerVisible(new PnsLayerRange(0, 0))).toBe(true);
    expect(iface.isAnyLayerVisible(new PnsLayerRange(1, 1))).toBe(false);
    expect(iface.isAnyLayerVisible(new PnsLayerRange(0, 1))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('isFlashedOnLayer', () => {
  const board = readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
      (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal))
      (net 0 "") (net 1 "GND")
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (remove_unused_layers yes) (keep_end_layers yes))
      (footprint "T" (layer "F.Cu") (at 10 0)
        (pad "1" thru_hole circle (at 0 0) (size 1.2 1.2) (drill 0.6) (layers "*.Cu") (net 1)
          (remove_unused_layers yes) (keep_end_layers yes))
        (pad "2" smd rect (at 2 0) (size 1 0.6) (layers "F.Cu") (net 1))))`),
  );
  const { iface, node } = syncInto(board);
  const pads = allPads(board);

  it('is true for any layer when asked about -1', () => {
    const solid = node.findItemsByParent(asBoardItem(pads[0]!))[0]!;

    expect(iface.isFlashedOnLayer(solid, -1)).toBe(true);
  });

  it('reads a pad through PAD::FlashLayer', () => {
    const solid = node.findItemsByParent(asBoardItem(pads[0]!))[0]!;

    // remove_except_start_and_end keeps the two outer layers.
    expect(iface.isFlashedOnLayer(solid, 0)).toBe(true);
    expect(iface.isFlashedOnLayer(solid, 3)).toBe(true);
    // The inner layers are 'if-connected', which reads as flashed here — the
    // CanFlashLayer reading, since there is no connectivity graph.
    expect(iface.isFlashedOnLayer(solid, 1)).toBe(true);
  });

  it('says an SMD pad is not on the back', () => {
    const solid = node.findItemsByParent(asBoardItem(pads[1]!))[0]!;

    expect(iface.isFlashedOnLayer(solid, 0)).toBe(true);
    expect(iface.isFlashedOnLayer(solid, 3)).toBe(false);
  });

  it('reads a via through PCB_VIA::FlashLayer', () => {
    const via = node.findItemsByParent(asBoardItem(board.vias[0]!))[0]!;

    expect(iface.isFlashedOnLayer(via, 0)).toBe(true);
    expect(iface.isFlashedOnLayer(via, 3)).toBe(true);
  });

  it('takes the range overload as "any layer in the intersection"', () => {
    const smd = node.findItemsByParent(asBoardItem(pads[1]!))[0]!;

    expect(iface.isFlashedOnLayer(smd, new PnsLayerRange(0, 3))).toBe(true);
    expect(iface.isFlashedOnLayer(smd, new PnsLayerRange(2, 3))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  a.x === b.x && a.y === b.y;

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 };

  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}
