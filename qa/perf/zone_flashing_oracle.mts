// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `ZONE_FILLER::Fill`'s conditional-flashing determination, against KiCad's own
 * answer for the same board.
 *
 * A board saved by KiCad carries `(zone_layer_connections …)` on every via and
 * pad whose unconnected layers are removed, and that list is *exactly* the set
 * of layers the item's `ZLO_FORCE_FLASHED` override names — the formatter
 * writes those and nothing else. KiCad recomputes the whole set at the top of
 * every `Fill()`, so the list in a freshly filled board IS the answer this
 * port has to reproduce.
 *
 * Compare the FLASHED set, not the raw override: a layer at `ZLO_NONE` and one
 * at `ZLO_FORCE_NO_ZONE_CONNECTION` are indistinguishable downstream (see
 * `PCB_VIA::FlashLayer`, which for START_END_ONLY never reads the override at
 * all), and the parser fills every unlisted copper layer with the latter
 * whereas `ClearZoneLayerOverrides` leaves the former. Comparing raw values
 * reports every start/end layer of every START_END_ONLY via as a difference,
 * which is what it did on the first run of this: 4370 of them, all spurious.
 *
 *     npx tsx perf/zone_flashing_oracle.mts <board.kicad_pcb>
 */
import { readFileSync } from 'node:fs';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';
import { ZONE_LAYER_OVERRIDE } from '@ziroeda/pcbnew/board_item.js';
import { ZONE_FILLER } from '@ziroeda/pcbnew/zone_filler.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';

await EMBEDDED_FILES.InitCodec();

const path = process.argv[2]!;
const board = ParseBoard(readFileSync(path, 'utf8'), path);

board.BuildListOfNets();
board.BuildConnectivity();

const cu = LSET.AllCuMask(board.GetCopperLayerCount());

/** The layers an item's overrides name as flashed - what the file records. */
function flashed(aItem: PCB_VIA | PAD): string {
  const on: number[] = [];

  cu.RunOnLayers((layer) => {
    if (aItem.GetZoneLayerOverride(layer) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED) on.push(layer);
  });

  return on.join(',');
}

/** Every copper layer claimed as flashed, which is the answer for no item. */
function poison(aItem: PCB_VIA | PAD): void {
  cu.RunOnLayers((layer) =>
    aItem.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED),
  );
}

function snapshot(): Map<string, string> {
  const m = new Map<string, string>();

  for (const track of board.Tracks())
    if (track.Type() === KICAD_T.PCB_VIA_T) {
      const via = track as PCB_VIA;
      if (via.GetRemoveUnconnected()) m.set(`via:${String(via.m_Uuid)}`, flashed(via));
    }

  for (const fp of board.Footprints())
    for (const pad of fp.Pads())
      if (pad.GetRemoveUnconnected()) m.set(`pad:${String(pad.m_Uuid)}`, flashed(pad));

  return m;
}

const before = snapshot();

// POISON what the file said, rather than clearing it, before asking for it
// back. The determination has to survive both halves of that.
//
// Clearing is not enough, and emptily passing is not the only trap here:
//
//  - leaving the file's state alone means a `PrepareBoardForFill` that does
//    NOTHING scores a perfect match, because the parser has already filled in
//    the answer. The first run of this reported 4370 of 4370 against a method
//    whose body could be deleted without moving the number.
//  - clearing it means a `ClearZoneLayerOverrides` dropped from inside the
//    method scores a perfect match too, because this did its job for it. A
//    stale override on a layer the method never revisits - a start or end
//    layer of a REMOVE_EXCEPT_START_AND_END via - is exactly what that clear
//    is for, and it is what a refill after an edit has to get rid of.
//
// Flashing everything satisfies neither: the answer has to be both wiped and
// rebuilt to come back equal.
for (const track of board.Tracks())
  if (track.Type() === KICAD_T.PCB_VIA_T) poison(track as PCB_VIA);

for (const fp of board.Footprints()) for (const pad of fp.Pads()) poison(pad);

let anyFlashed = false;

for (const v of before.values()) if (v !== '') anyFlashed = true;

if (!anyFlashed) {
  console.log(`${path}\n  no item on this board has a flashed layer: nothing to compare`);
  process.exit(2);
}

const t0 = Date.now();

new ZONE_FILLER(board).PrepareBoardForFill();

const ms = Date.now() - t0;
const after = snapshot();

let same = 0;
let differ = 0;
const examples: string[] = [];

for (const [key, kicad] of before) {
  const ours = after.get(key)!;

  if (kicad === ours) {
    same++;
  } else {
    differ++;
    if (examples.length < 10) examples.push(`${key}\n  KiCad: [${kicad}]\n  ours : [${ours}]`);
  }
}

console.log(`${path}`);
console.log(
  `  items with removed layers ${before.size}  match ${same}  DIFFER ${differ}  (${ms} ms)`,
);
for (const e of examples) console.log(e);
process.exit(differ === 0 ? 0 : 1);
