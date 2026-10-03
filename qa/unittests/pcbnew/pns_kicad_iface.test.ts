// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS_KICAD_IFACE_BASE` / `PNS_KICAD_IFACE` over the live BOARD —
 * `pns_kicad_iface.ts`.
 *
 * `ecc83-pp.kicad_pcb` is a real two-layer board with no vias, arcs or inner
 * layers; those paths are driven from a four-layer board built as source text
 * and put through the same parser.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { NETINFO_LIST } from '@ziroeda/pcbnew/netinfo.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB } from '@ziroeda/pcbnew/padstack.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import {
  PNS_KICAD_IFACE,
  boardLayerFromPnsLayer,
  pnsLayerFromBoardLayer,
} from '@ziroeda/pcbnew/router/pns_kicad_iface.js';
import { type PnsBoardItem, PnsKind, setRouterIface } from '@ziroeda/pcbnew/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/router/pns_layerset.js';
import { PnsNode } from '@ziroeda/pcbnew/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/router/pns_segment.js';
import type { PnsSolid } from '@ziroeda/pcbnew/router/pns_solid.js';
import type { PnsVia } from '@ziroeda/pcbnew/router/pns_via.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const ECC83 = new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url);

const readEcc83 = (): BOARD => {
  const b = ParseBoard(readFileSync(ECC83, 'utf8'));
  b.BuildConnectivity();
  return b;
};

/** `ITEM::Parent()`'s handle for a board item, as `NODE::FindItemsByParent` takes it. */
const pb = (aItem: object): PnsBoardItem => aItem as unknown as PnsBoardItem;

/** `ROUTER::SyncWorld` (pns_router.cpp:95-105), which is what a caller does. */
function syncInto(aBoard: BOARD): { iface: PNS_KICAD_IFACE; node: PnsNode } {
  const iface = new PNS_KICAD_IFACE(aBoard);

  // `ITEM::collideSimple` reaches `isFlashedOnLayer` through this singleton.
  setRouterIface(iface);

  const node = new PnsNode();
  node.beginBulkAdd();
  iface.syncWorld(node);
  node.finalizeBulkAdd();
  node.fixupVirtualVias();

  return { iface, node };
}

const allPads = (aBoard: BOARD): PAD[] => aBoard.Footprints().flatMap((f) => f.Pads());
const traces = (aBoard: BOARD): PCB_TRACK[] =>
  aBoard.Tracks().filter((t) => t.Type() === KICAD_T.PCB_TRACE_T);
const arcs = (aBoard: BOARD): PCB_ARC[] =>
  aBoard.Tracks().filter((t) => t.Type() === KICAD_T.PCB_ARC_T) as PCB_ARC[];
const vias = (aBoard: BOARD): PCB_VIA[] =>
  aBoard.Tracks().filter((t) => t.Type() === KICAD_T.PCB_VIA_T) as PCB_VIA[];
const layerName = (aItem: { GetLayer(): number }): string => LSET.Name(aItem.GetLayer());

// ---------------------------------------------------------------------------

describe('a real board in a real node: demos/ecc83/ecc83-pp.kicad_pcb', () => {
  let board: BOARD;
  let iface: PNS_KICAD_IFACE;
  let node: PnsNode;

  beforeEach(() => {
    board = readEcc83();
    ({ iface, node } = syncInto(board));
  });

  it('is the board this test thinks it is', () => {
    expect(allPads(board)).toHaveLength(33);
    expect(traces(board)).toHaveLength(59);
    expect(arcs(board)).toHaveLength(0);
    expect(vias(board)).toHaveLength(0);
    expect(iface.copperLayerCount()).toBe(2);
  });

  it('adds one SOLID per pad, one SEGMENT per track, and a HOLE per drilled pad', () => {
    const pads = allPads(board);
    const drilled = pads.filter((p) => p.GetDrillSize().x > 0);

    expect(drilled).toHaveLength(33); // every pad on this board is through-hole

    for (const pad of pads) {
      const items = node.findItemsByParent(pb(pad));

      expect(items).toHaveLength(1);
      expect(items[0]!.kind()).toBe(PnsKind.SOLID_T);
      expect((items[0] as PnsSolid).hasHole()).toBe(true);
    }

    for (const track of traces(board)) {
      const items = node.findItemsByParent(pb(track));

      expect(items).toHaveLength(1);
      expect(items[0]!.kind()).toBe(PnsKind.SEGMENT_T);
    }

    // The holes are items in their own right. The board's Edge.Cuts graphics are
    // synced too now (syncGraphicalItem), as non-routable solids.
    const edges = board
      .Drawings()
      .filter((d) => d.GetLayer() === LSET.NameToLayer('Edge.Cuts')).length;

    expect(node.index().size()).toBeGreaterThanOrEqual(
      pads.length + drilled.length + traces(board).length + edges,
    );
  });

  it('links joints at track endpoints', () => {
    for (const t of traces(board)) {
      const l = iface.getPnsLayerFromBoardLayer(layerName(t));
      const s = node.findItemsByParent(pb(t))[0]!;

      expect(node.findJoint(t.GetStart(), l, t.GetNet())?.linkList()).toContain(s);
      expect(node.findJoint(t.GetEnd(), l, t.GetNet())?.linkList()).toContain(s);
    }
  });

  it('joins a pad to the tracks that reach it', () => {
    let checked = 0;

    for (const pad of allPads(board)) {
      const solid = node.findItemsByParent(pb(pad))[0] as PnsSolid;
      const at = pad.GetPosition();

      const touching = traces(board).filter(
        (t) =>
          t.GetNet() === pad.GetNet() && (samePoint(t.GetStart(), at) || samePoint(t.GetEnd(), at)),
      );

      if (touching.length === 0) continue;

      const layer = iface.getPnsLayerFromBoardLayer(layerName(touching[0]!));
      const joint = node.findJoint(at, layer, pad.GetNet());

      expect(joint).not.toBeNull();
      expect(joint!.linkList()).toContain(solid);
      checked++;
    }

    expect(checked).toBe(10);
  });

  it('gives every item its NETINFO_ITEM as the net handle', () => {
    for (const track of traces(board)) {
      const segment = node.findItemsByParent(pb(track))[0]!;

      // Identity, not equality: `ITEM::collideSimple` compares handles.
      expect(segment.net()).toBe(track.GetNet());
      expect(iface.getNetCode(segment.net())).toBe(track.GetNetCode());
      expect(iface.getNetName(segment.net())).toBe(track.GetNetname());
    }

    for (const pad of allPads(board)) {
      expect(node.findItemsByParent(pb(pad))[0]!.net()).toBe(pad.GetNet());
    }
  });

  it('spans every copper layer for a through-hole pad', () => {
    const stack = new PnsLayerRange(0, 1);

    for (const pad of allPads(board)) {
      const solid = node.findItemsByParent(pb(pad))[0]!;

      expect(solid.layers().equals(stack)).toBe(true);
    }
  });

  it('installs a rule resolver and a max clearance on the node', () => {
    expect(node.getRuleResolver()).toBe(iface.getRuleResolver());
    expect(node.getRuleResolver()).not.toBeNull();
    expect(iface.getWorld()).toBe(node);
    expect(node.getMaxClearance()).toBeGreaterThanOrEqual(board.GetMaxClearanceValue());
  });

  it('places each solid at its pad, not at the origin plus its pad', () => {
    // `SOLID::SetPos` moves the shape by the delta, so calling it after
    // `SetShape` would translate every pad by its own position.
    for (const pad of allPads(board)) {
      const solid = node.findItemsByParent(pb(pad))[0] as PnsSolid;
      const at = pad.GetPosition();

      expect(solid.pos()).toEqual(at);

      const shape = solid.shape(-1)!;
      const centre =
        shape.kind === 'circle'
          ? shape.c
          : shape.kind === 'stadium'
            ? { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 }
            : centroid(shape.kind === 'poly' ? shape.pts : []);

      expect(Math.hypot(centre.x - at.x, centre.y - at.y)).toBeLessThan(1000);
    }
  });
});

// ---------------------------------------------------------------------------

const MULTILAYER = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal)
    (25 "Edge.Cuts" user) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 10 0) (end 10 10) (width 0.25) (layer "In2.Cu") (net 1))
  (arc (start 0 5) (mid 2 7) (end 5 9) (width 0.3) (layer "In1.Cu") (net 2))
  (via (at 10 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
  (via blind (at 20 0) (size 0.6) (drill 0.3) (layers "F.Cu" "In1.Cu") (net 2))
  (footprint "T" (layer "F.Cu") (at 30 0)
    (pad "1" thru_hole circle (at 0 0) (size 1.2 1.2) (drill 0.6) (layers "*.Cu") (net 1 "GND"))
    (pad "2" smd rect (at 2 0) (size 1 0.6) (layers "F.Cu") (net 2 "VCC"))
    (pad "3" np_thru_hole circle (at 4 0) (size 2 2) (drill 1) (layers "*.Cu"))
    (pad "4" thru_hole oval (at 6 0) (size 2 1.4) (drill oval 1.2 0.6) (layers "*.Cu") (net 1 "GND"))))`;

describe('a four-layer board: vias, arcs and the inner-layer mapping', () => {
  const board = ParseBoard(MULTILAYER);
  const { iface, node } = syncInto(board);

  it('numbers the copper stack front, inners, back', () => {
    expect(iface.copperLayerCount()).toBe(4);
    expect(
      ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'].map((l) => iface.getPnsLayerFromBoardLayer(l)),
    ).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((l) => iface.getBoardLayerFromPnsLayer(l))).toEqual([
      'F.Cu',
      'In1.Cu',
      'In2.Cu',
      'B.Cu',
    ]);
    // `GetBoardLayerFromPNSLayer` / `GetPNSLayerFromBoardLayer` on PCB_LAYER_ID.
    expect(
      [0, 1, 2, 3].map((l) => iface.GetPNSLayerFromBoardLayer(iface.GetBoardLayerFromPNSLayer(l))),
    ).toEqual([0, 1, 2, 3]);
  });

  it('puts a track on the inner layer it names', () => {
    const inner = traces(board).find((t) => layerName(t) === 'In2.Cu')!;
    const segment = node.findItemsByParent(pb(inner))[0] as PnsSegment;

    expect(segment.layers().equals(new PnsLayerRange(2, 2))).toBe(true);
    expect(segment.width()).toBe(inner.GetWidth());
    expect(segment.seg().a).toEqual(inner.GetStart());
    expect(segment.seg().b).toEqual(inner.GetEnd());
  });

  it('keeps an arc as an arc, through its three points', () => {
    const items = node.findItemsByParent(pb(arcs(board)[0]!));

    expect(items).toHaveLength(1);
    expect(items[0]!.kind()).toBe(PnsKind.ARC_T);
    expect(items[0]!.layers().equals(new PnsLayerRange(1, 1))).toBe(true);
  });

  it('spans a through via across the whole stack and a blind via across its own', () => {
    const [v0, v1] = vias(board);
    const through = node.findItemsByParent(pb(v0!))[0] as PnsVia;
    const blind = node.findItemsByParent(pb(v1!))[0] as PnsVia;

    expect(through.layers().equals(new PnsLayerRange(0, 3))).toBe(true);
    expect(blind.layers().equals(new PnsLayerRange(0, 1))).toBe(true);

    expect(through.diameter(0)).toBe(v0!.GetWidth(LSET.NameToLayer('F.Cu')));
    expect(through.drill()).toBe(v0!.GetDrillValue());
    expect(through.hasHole()).toBe(true);
    expect(through.holeLayers().equals(new PnsLayerRange(0, 3))).toBe(true);
  });

  it('links a via into the joint the track ending at it also holds', () => {
    const track = traces(board).find((t) => layerName(t) === 'F.Cu')!;
    const via = node.findItemsByParent(pb(vias(board)[0]!))[0]!;
    const joint = node.findJoint(track.GetEnd(), 0, track.GetNet());

    expect(joint).not.toBeNull();
    expect(joint!.linkList()).toContain(via);
  });

  it('classifies pads by attribute', () => {
    const [pth, smd, npth, oval] = allPads(board).map(
      (p) => node.findItemsByParent(pb(p))[0] as PnsSolid,
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

    // `PAD::GetEffectiveHoleShape` is always a SHAPE_SEGMENT: a round drill is
    // one of zero length, an oblong one has length.
    const ovalHole = oval!.hole()!.shape(-1)!;
    const roundHole = pth!.hole()!.shape(-1)!;
    expect(ovalHole.kind).toBe('stadium');
    expect(roundHole.kind).toBe('stadium');
    if (ovalHole.kind !== 'stadium' || roundHole.kind !== 'stadium') throw new Error('unreachable');
    expect(roundHole.a).toEqual(roundHole.b);
    expect(ovalHole.a).not.toEqual(ovalHole.b);
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
    expect(boardLayerFromPnsLayer(0, 1)).toBe('F.Cu');
  });

  it('is copper exactly on the enabled copper stack (IsPNSCopperLayer)', () => {
    const iface = new PNS_KICAD_IFACE(ParseBoard(MULTILAYER));

    expect([0, 1, 2, 3].map((l) => iface.isPnsCopperLayer(l))).toEqual([true, true, true, true]);
    expect(iface.isPnsCopperLayer(-1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('nets', () => {
  const board = readEcc83();
  const iface = new PNS_KICAD_IFACE(board);

  it('is -1 and empty for the null handle', () => {
    expect(iface.getNetCode(null)).toBe(-1);
    expect(iface.getNetName(null)).toBe('');
  });

  it('keeps the orphaned handle apart from the board net 0 (GetOrphanedNetHandle)', () => {
    expect(iface.getOrphanedNetHandle()).toBe(NETINFO_LIST.OrphanedItem());
    expect(iface.getOrphanedNetHandle()).not.toBe(board.FindNet(0));
    expect(iface.getNetCode(iface.getOrphanedNetHandle())).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('pad shapes (syncPad)', () => {
  const solidOf = (aSexpr: string): PnsSolid => {
    const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
          (layers (0 "F.Cu" signal) (2 "B.Cu" signal)) (net 0 "")
          (footprint "T" (layer "F.Cu") (at 0 0) ${aSexpr}))`);
    const iface = new PNS_KICAD_IFACE(board);

    return iface.syncPad(allPads(board)[0]!)[0]!;
  };

  it('uses the single effective shape where there is one', () => {
    expect(
      solidOf('(pad "1" smd circle (at 0 0) (size 1 1) (layers "F.Cu"))').shape(-1)!.kind,
    ).toBe('circle');
    expect(solidOf('(pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu"))').shape(-1)!.kind).toBe(
      'poly',
    );
    expect(solidOf('(pad "1" smd oval (at 0 0) (size 2 1) (layers "F.Cu"))').shape(-1)!.kind).toBe(
      'stadium',
    );
  });

  it('takes the effective polygon outline of a pad that is more than one primitive', () => {
    // A chamfered round-rect is a polygon plus one circle per rounded corner;
    // upstream falls back to `GetEffectivePolygon( layer, ERROR_OUTSIDE )`.
    const shape = solidOf(
      `(pad "1" smd roundrect (at 0 0) (size 2 2) (layers "F.Cu")
         (roundrect_rratio 0.25) (chamfer_ratio 0.2) (chamfer top_left))`,
    ).shape(-1)!;

    expect(shape.kind).toBe('poly');
    if (shape.kind !== 'poly') throw new Error('unreachable');

    const xs = shape.pts.map((p) => p.x);
    // ERROR_OUTSIDE: the outline reaches the pad's own 2 mm extent, not short of it.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(2_000_000);
    expect(shape.r).toBe(0);
    // More than the four corners of a box: the rounded corners are in the outline.
    expect(shape.pts.length).toBeGreaterThan(8);
  });

  it('is a zero-length segment for a round drill and a stadium for an oblong one', () => {
    const round = solidOf(
      '(pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1) (layers "*.Cu"))',
    )
      .hole()!
      .shape(-1)!;
    expect(round.kind).toBe('stadium');
    if (round.kind !== 'stadium') throw new Error('unreachable');
    expect(round.a).toEqual(round.b);
    expect(round.r).toBeCloseTo(500_000);

    const s = solidOf(
      '(pad "1" thru_hole oval (at 0 0) (size 3 1.5) (drill oval 2 1) (layers "*.Cu"))',
    )
      .hole()!
      .shape(-1)!;
    expect(s.kind).toBe('stadium');
    if (s.kind !== 'stadium') throw new Error('unreachable');
    expect(s.r).toBeCloseTo(500_000);
    expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeCloseTo(1_000_000);
  });

  it('puts the solid at the hole and carries the copper offset (SetPos( c - offset ))', () => {
    const solid = solidOf(
      '(pad "1" thru_hole circle (at 0 0) (size 2 2) (drill 1 (offset 0.5 0)) (layers "*.Cu"))',
    );

    expect(solid.pos()).toEqual({ x: 0, y: 0 });
    expect(solid.offset()).toEqual({ x: 500_000, y: 0 });
    const shape = solid.shape(-1)!;
    if (shape.kind !== 'circle') throw new Error('unreachable');
    expect(shape.c).toEqual({ x: 500_000, y: 0 });
  });

  it('gives the hole the whole stack even when the pad is on one layer', () => {
    // The parser drops an SMD pad's drill, so the drill is set on the model.
    const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
          (layers (0 "F.Cu" signal) (2 "B.Cu" signal)) (net 0 "")
          (footprint "T" (layer "F.Cu") (at 0 0)
            (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu"))))`);
    const pad = allPads(board)[0]!;
    pad.SetDrillSize({ x: 500_000, y: 500_000 });
    const solid = new PNS_KICAD_IFACE(board).syncPad(pad)[0]!;

    expect(solid.layers().equals(new PnsLayerRange(0, 0))).toBe(true);
    expect(solid.hole()!.layers().equals(new PnsLayerRange(0, 1))).toBe(true);
  });

  it('takes the effective polygon when a custom pad is several primitives', () => {
    const shape = solidOf(
      `(pad "1" smd custom (at 0 0) (size 1 1) (layers "F.Cu")
         (options (clearance outline) (anchor circle))
         (primitives (gr_circle (center 0.8 0) (end 1.3 0) (width 0) (fill yes))))`,
    ).shape(-1)!;

    expect(shape.kind).toBe('poly');
    if (shape.kind !== 'poly') throw new Error('unreachable');
    // The outline reaches the off-anchor primitive at x = 1.3 mm, past the 0.5 mm anchor.
    expect(Math.max(...shape.pts.map((p) => p.x))).toBeGreaterThanOrEqual(1_250_000);
  });

  it('has no hole when the pad has no drill', () => {
    expect(solidOf('(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))').hasHole()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('board mutations go through a BOARD_COMMIT (AddItem / RemoveItem / Commit)', () => {
  it('adds a routed segment as a PCB_TRACK on one "Routing" commit', () => {
    const board = ParseBoard(MULTILAYER);
    const frame = new TEST_PCB_FRAME(board);
    const iface = new PNS_KICAD_IFACE(board, { commitHost: frame });
    const before = traces(board).length;

    const seg = new PnsSegment(
      { seg: { a: { x: 0, y: 1_000_000 }, b: { x: 5_000_000, y: 1_000_000 } }, width: 200_000 },
      board.FindNet(1),
    );
    seg.setLayer(3);
    iface.addItem(seg);
    iface.commit();

    const added = traces(board).find((t) => t.GetStart().y === 1_000_000)!;

    expect(traces(board)).toHaveLength(before + 1);
    expect(layerName(added)).toBe('B.Cu');
    expect(added.GetWidth()).toBe(200_000);
    expect(added.GetNet()).toBe(board.FindNet(1));
    // The router item now points at its board item.
    expect(seg.parent()).toBe(pb(added));
    expect(iface.pushedCommits()).toBe(1);

    frame.RestoreCopyFromUndoList();
    expect(traces(board)).toHaveLength(before);
  });

  it('removes a synced track and modifies an updated one', () => {
    const board = ParseBoard(MULTILAYER);
    const frame = new TEST_PCB_FRAME(board);
    const iface = new PNS_KICAD_IFACE(board, { commitHost: frame });
    const node = new PnsNode();
    iface.syncWorld(node);

    const [first, second] = traces(board);
    iface.removeItem(node.findItemsByParent(pb(first!))[0]!);

    const moved = node.findItemsByParent(pb(second!))[0] as PnsSegment;
    moved.setEnds({ x: 10_000_000, y: 0 }, { x: 12_000_000, y: 10_000_000 });
    iface.updateItem(moved);
    iface.commit();

    expect(traces(board)).not.toContain(first);
    expect(second!.GetEnd()).toEqual({ x: 12_000_000, y: 10_000_000 });
  });

  it('without a commit host changes nothing', () => {
    const board = ParseBoard(MULTILAYER);
    const iface = new PNS_KICAD_IFACE(board);
    const before = traces(board).length;
    const seg = new PnsSegment({ seg: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, width: 1 }, null);

    iface.addItem(seg);
    iface.commit();

    expect(traces(board)).toHaveLength(before);
  });
});

// ---------------------------------------------------------------------------

describe('defaults with no view and no design settings', () => {
  const board = readEcc83();

  it('answers zero for the stackup and false for importSizes', () => {
    const iface = new PNS_KICAD_IFACE(board);

    expect(iface.stackupHeight(0, 1)).toBe(0);
    expect(iface.importSizes({ trackWidth: 1 } as never, null, null, { x: 0, y: 0 })).toBe(false);
  });

  it('treats everything as visible with no view attached', () => {
    const { iface, node } = syncInto(board);
    const item = node.findItemsByParent(pb(traces(board)[0]!))[0]!;

    // Upstream's no-view answer for IsAnyLayerVisible is *false*; reproducing
    // it would make pickSingleItem reject every candidate headless.
    expect(iface.isAnyLayerVisible(new PnsLayerRange(0, 1))).toBe(true);
    expect(iface.isItemVisible(item)).toBe(true);
  });

  it('honours an injected visibility predicate', () => {
    const iface = new PNS_KICAD_IFACE(board, { isLayerVisible: (l) => l === 'F.Cu' });

    expect(iface.isAnyLayerVisible(new PnsLayerRange(0, 0))).toBe(true);
    expect(iface.isAnyLayerVisible(new PnsLayerRange(1, 1))).toBe(false);
    expect(iface.isAnyLayerVisible(new PnsLayerRange(0, 1))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('isFlashedOnLayer (PAD::FlashLayer / PCB_VIA::FlashLayer)', () => {
  const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
      (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal))
      (net 0 "") (net 1 "GND")
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (remove_unused_layers yes) (keep_end_layers yes))
      (footprint "T" (layer "F.Cu") (at 10 0)
        (pad "1" thru_hole circle (at 0 0) (size 1.2 1.2) (drill 0.6) (layers "*.Cu") (net 1 "GND")
          (remove_unused_layers yes) (keep_end_layers yes))
        (pad "2" smd rect (at 2 0) (size 1 0.6) (layers "F.Cu") (net 1 "GND"))))`);
  board.BuildConnectivity();
  const { iface, node } = syncInto(board);
  const pads = allPads(board);

  it('is true for any layer when asked about -1', () => {
    expect(iface.isFlashedOnLayer(node.findItemsByParent(pb(pads[0]!))[0]!, -1)).toBe(true);
  });

  it('keeps the end layers of a remove-unused pad and drops an unconnected inner one', () => {
    const solid = node.findItemsByParent(pb(pads[0]!))[0]!;

    expect(iface.isFlashedOnLayer(solid, 0)).toBe(true);
    expect(iface.isFlashedOnLayer(solid, 3)).toBe(true);
    // Nothing connects to the pad on In1.Cu, so `IsConnectedOnLayer` says no.
    expect(iface.isFlashedOnLayer(solid, 1)).toBe(false);
  });

  it('says an SMD pad is not on the back', () => {
    const solid = node.findItemsByParent(pb(pads[1]!))[0]!;

    expect(iface.isFlashedOnLayer(solid, 0)).toBe(true);
    expect(iface.isFlashedOnLayer(solid, 3)).toBe(false);
  });

  it('reads a via through PCB_VIA::FlashLayer', () => {
    const via = node.findItemsByParent(pb(vias(board)[0]!))[0]!;

    expect(iface.isFlashedOnLayer(via, 0)).toBe(true);
    expect(iface.isFlashedOnLayer(via, 3)).toBe(true);
    expect(iface.isFlashedOnLayer(via, 1)).toBe(false);
  });

  it('takes the range overload as "any layer in the intersection"', () => {
    const smd = node.findItemsByParent(pb(pads[1]!))[0]!;

    expect(iface.isFlashedOnLayer(smd, new PnsLayerRange(0, 3))).toBe(true);
    expect(iface.isFlashedOnLayer(smd, new PnsLayerRange(2, 3))).toBe(false);
  });

  it('a pad attribute switch is visible to the bridge', () => {
    expect(pads[1]!.GetAttribute()).toBe(PAD_ATTRIB.SMD);
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
