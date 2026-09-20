// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_statistics.cpp`: `CollectDrillLineItems`, the drill table
 * behind the Board Statistics dialog's "Drill holes" tab.
 *
 * ## Two holes are the same hole only if all seven fields agree
 *
 * Holes fold into rows, so a board with forty identical vias reports one row
 * of forty. `DRILL_LINE_ITEM::operator==` decides that, and it compares the
 * *layer span* as well as the size: a 0.3 mm via from F.Cu to In1.Cu is a
 * different drilling operation from a 0.3 mm via that goes all the way
 * through, and a fabricator quotes them separately. The count is deliberately
 * not one of the seven — it is what folding produces, so comparing it would
 * make every row unique and fold nothing.
 *
 * A pad's span is its copper stack's first and last layer. A pad on no copper
 * layer at all reports `UNDEFINED_LAYER` at both ends rather than being
 * skipped: it is still a hole somebody has to drill.
 */
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD } from './board.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE } from './padstack.js';
import type { PCB_VIA } from './pcb_track.js';

/** `DRILL_LINE_ITEM` (`board_statistics.h`). */
export interface DrillLineItem {
  xSize: number;
  ySize: number;
  shape: PAD_DRILL_SHAPE;
  /** Anything other than an NPTH pad; vias are always plated. */
  isPlated: boolean;
  isPad: boolean;
  startLayer: PCB_LAYER_ID;
  stopLayer: PCB_LAYER_ID;
  qty: number;
}

/**
 * `DRILL_LINE_ITEM::operator==`: every field but the count.
 *
 * Lower-cased because it is ours: upstream compares with an operator, so there
 * is no KiCad name for this to carry.
 */
export function sameDrillLineItem(a: DrillLineItem, b: DrillLineItem): boolean {
  return (
    a.xSize === b.xSize &&
    a.ySize === b.ySize &&
    a.shape === b.shape &&
    a.isPlated === b.isPlated &&
    a.isPad === b.isPad &&
    a.startLayer === b.startLayer &&
    a.stopLayer === b.stopLayer
  );
}

/** `CollectDrillLineItems`: fold every drilled hole on the board into rows. */
export function CollectDrillLineItems(aBoard: BOARD | null): DrillLineItem[] {
  const out: DrillLineItem[] = [];

  const addOrIncrement = (d: DrillLineItem): void => {
    for (const e of out) {
      if (sameDrillLineItem(e, d)) {
        e.qty++;
        return;
      }
    }

    out.push({ ...d, qty: 1 });
  };

  if (!aBoard) return out;

  // Pads
  for (const fp of aBoard.Footprints()) {
    for (const pad of fp.Pads()) {
      if (!pad.HasHole()) continue;

      const xs = pad.GetDrillSize().x;
      const ys = pad.GetDrillSize().y;

      if (xs <= 0 || ys <= 0) continue;

      const cuStack = pad.GetLayerSet().CuStack();
      const top = cuStack.length === 0 ? PCB_LAYER_ID.UNDEFINED_LAYER : cuStack[0]!;
      const bottom =
        cuStack.length === 0 ? PCB_LAYER_ID.UNDEFINED_LAYER : cuStack[cuStack.length - 1]!;

      addOrIncrement({
        xSize: xs,
        ySize: ys,
        shape: pad.GetDrillShape(),
        isPlated: pad.GetAttribute() !== PAD_ATTRIB.NPTH,
        isPad: true,
        startLayer: top,
        stopLayer: bottom,
        qty: 0,
      });
    }
  }

  // Vias
  for (const t of aBoard.Tracks()) {
    if (t.Type() !== KICAD_T.PCB_VIA_T) continue;

    const via = t as PCB_VIA;
    const dmm = via.GetDrillValue();

    if (dmm <= 0) continue;

    addOrIncrement({
      xSize: dmm,
      ySize: dmm,
      shape: PAD_DRILL_SHAPE.CIRCLE,
      isPlated: true,
      isPad: false,
      startLayer: via.TopLayer(),
      stopLayer: via.BottomLayer(),
      qty: 0,
    });
  }

  return out;
}
