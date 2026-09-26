// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `ZONE_FILLER::Fill`'s conditional-flashing determination
 * (`zone_filler.cpp:576-676`), which settles - before any zone is poured, and
 * deterministically, "due to the pathological case presented in
 * …/issues/12964" - which layers a via or pad with "remove unconnected layers"
 * is flashed on.
 *
 * Nothing in this tree computed it before. The file carries the answer, the
 * parser reads it, `CN_CONNECTIVITY_ALGO` and the formatter read it back, and
 * a refill left whatever the last KiCad to save the board had decided.
 *
 * ## The oracle
 *
 * `qa/data/zone_fill/flashing_kicad_cli.kicad_pcb` is KiCad's own answer:
 * `make_flashing_board.py` builds the board through KiCad's `pcbnew` module
 * and `kicad-cli pcb drc --refill-zones --save-board` fills it, so every
 * `(zone_layer_connections …)` in it was written by `ZONE_FILLER::Fill`. Each
 * item on it isolates one branch - see that script's header.
 *
 * ## Why the overrides are poisoned first
 *
 * Two ways this comparison could pass while proving nothing, both of which it
 * did before it was written this way:
 *
 *  - leave the parsed state alone, and a determination that does *nothing*
 *    scores a perfect match, because the parser has already filled the answer
 *    in. The first run of this against a 12-layer board reported 4370 of 4370
 *    against a method whose body could be deleted without moving the number.
 *  - clear the state, and the `ClearZoneLayerOverrides()` *inside* the
 *    determination becomes untestable, because the test did its job for it.
 *    A stale override on a layer the determination never revisits - a start or
 *    end layer of a `REMOVE_EXCEPT_START_AND_END` item - is exactly what that
 *    clear is for, and dropping stale overrides is the whole point of
 *    recomputing on every fill.
 *
 * Flashing every copper layer satisfies neither: the answer has to be both
 * wiped and rebuilt to come back equal.
 *
 * ## What a mutation sweep leaves standing
 *
 * Seventeen mutants of the determination die here. Two survive, and both are
 * equivalent rather than uncovered:
 *
 *  - dropping `!zone.HasKeepoutParametersSet()` from the keepout test. That
 *    predicate is the OR of the five `DoNotAllow*` flags, and the line after
 *    it already requires `GetDoNotAllowZoneFills()`, so it can never be the
 *    one that rejects a zone.
 *  - dropping `!zone.GetBoundingBox().Intersects()` from
 *    `findHighestPriorityZone`. It is an early-out in front of the test
 *    function, which does the same containment exactly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ZONE_LAYER_OVERRIDE } from '@ziroeda/pcbnew/board_item.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ZONE_FILLER } from '@ziroeda/pcbnew/zone_filler.js';

const BOARD_PATH = resolve(
  import.meta.dirname,
  '../../data/zone_fill/flashing_kicad_cli.kicad_pcb',
);

/** The copper layers an item's overrides claim as flashed - what the file records. */
function flashedLayers(aBoard: BOARD, aItem: PCB_VIA | PAD): PCB_LAYER_ID[] {
  const on: PCB_LAYER_ID[] = [];

  LSET.AllCuMask(aBoard.GetCopperLayerCount()).RunOnLayers((layer) => {
    if (aItem.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED) on.push(layer);
  });

  return on;
}

function itemsWithRemovedLayers(aBoard: BOARD): Map<string, PCB_VIA | PAD> {
  const out = new Map<string, PCB_VIA | PAD>();

  for (const track of aBoard.Tracks())
    if (track.Type() === KICAD_T.PCB_VIA_T) {
      const via = track as PCB_VIA;

      if (via.GetRemoveUnconnected()) out.set(`via ${String(via.m_Uuid)}`, via);
    }

  for (const fp of aBoard.Footprints())
    for (const pad of fp.Pads())
      if (pad.GetRemoveUnconnected()) out.set(`pad ${String(pad.m_Uuid)}`, pad);

  return out;
}

function snapshot(aBoard: BOARD): Map<string, string> {
  const out = new Map<string, string>();

  for (const [key, item] of itemsWithRemovedLayers(aBoard))
    out.set(
      key,
      flashedLayers(aBoard, item)
        .map((l) => aBoard.GetLayerName(l))
        .join(' '),
    );

  return out;
}

describe("the flashing determination reproduces KiCad's own", () => {
  let board: BOARD;
  let kicad: Map<string, string>;

  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();

    board = ParseBoard(readFileSync(BOARD_PATH, 'utf8'), BOARD_PATH);
    board.BuildListOfNets();
    board.BuildConnectivity();

    kicad = snapshot(board);

    for (const item of itemsWithRemovedLayers(board).values())
      LSET.AllCuMask(board.GetCopperLayerCount()).RunOnLayers((layer) =>
        item.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED),
      );

    new ZONE_FILLER(board).PrepareBoardForFill();
  });

  it('has something to compare: the fixture carries both answers', () => {
    // A board where nothing is flashed, or everything is, would pass the
    // comparison below whatever the determination did.
    const sets = [...kicad.values()];

    expect(sets.length).toBeGreaterThan(5);
    expect(sets.some((s) => s === '')).toBe(true);
    expect(sets.some((s) => s !== '')).toBe(true);
  });

  it('flashes exactly the layers KiCad flashed, item for item', () => {
    expect(snapshot(board)).toEqual(kicad);
  });
});

describe('findHighestPriorityZone, on a board zone order cannot come from a file', () => {
  /**
   * The `zone->GetAssignedPriority() < highestPriority` early-out only bites
   * when a HIGHER-priority zone is examined before a lower-priority one of the
   * item's own net: without it, the lower one replaces the higher through the
   * "or matching netcode" arm. KiCad writes zones out in ascending priority,
   * so no saved board can put them that way round - but a board being edited
   * holds them in whatever order they were added.
   */
  function boardWithZonePair(aHigherFirst: boolean): BOARD {
    const board = new BOARD();

    board.SetCopperLayerCount(4);

    const gnd = new NETINFO_ITEM(board, 'GND');
    const vcc = new NETINFO_ITEM(board, 'VCC');

    board.Add(gnd);
    board.Add(vcc);

    const mkZone = (net: NETINFO_ITEM, priority: number): ZONE => {
      const z = new ZONE(board);
      const outline = new SHAPE_POLY_SET();

      outline.NewOutline();

      for (const p of [
        { x: 0, y: 0 },
        { x: 20_000_000, y: 0 },
        { x: 20_000_000, y: 20_000_000 },
        { x: 0, y: 20_000_000 },
      ])
        outline.Append(p.x, p.y);

      z.SetOutline(outline);
      z.SetLayerSet(new LSET([PCB_LAYER_ID.In1_Cu]));
      z.SetNet(net);
      z.SetAssignedPriority(priority);

      return z;
    };

    // The item's own net at the LOWER priority, so the two arms disagree.
    const higher = mkZone(vcc, 5);
    const lower = mkZone(gnd, 2);

    for (const z of aHigherFirst ? [higher, lower] : [lower, higher]) board.Add(z);

    const via = new PCB_VIA(board);

    via.SetPosition({ x: 10_000_000, y: 10_000_000 });
    via.SetWidth(800_000);
    via.SetDrill(400_000);
    via.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    via.SetNet(gnd);
    via.SetRemoveUnconnected(true);
    via.SetKeepStartEnd(true);
    board.Add(via);

    board.BuildListOfNets();
    board.BuildConnectivity();

    new ZONE_FILLER(board).PrepareBoardForFill();

    return board;
  }

  for (const higherFirst of [true, false]) {
    it(`the priority-5 zone wins with it declared ${higherFirst ? 'first' : 'second'}`, () => {
      const board = boardWithZonePair(higherFirst);
      const via = board.Tracks().find((t) => t.Type() === KICAD_T.PCB_VIA_T) as PCB_VIA;

      // The priority-5 zone is VCC and the via is GND, so the via is flashed
      // on neither inner layer - and the answer must not depend on which of
      // the two zones the loop reached first.
      expect(flashedLayers(board, via)).toEqual([]);
    });
  }
});
