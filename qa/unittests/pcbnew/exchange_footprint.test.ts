// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_EDIT_FRAME::ExchangeFootprint` (pcb_edit_frame.cpp:2642-2675), as the
 * netlist updater calls it: the replacement goes where the old footprint was -
 * `PlaceFootprint( aNew, false, aExisting->GetPosition() )`, then the old
 * orientation - and nothing matches its pads to the old ones. 10.0.5 has no
 * pad realignment; a library whose anchor moved moves the copper with it.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as MM } from '@ziroeda/common/eda_units.js';
import {
  exchangeFootprint,
  placeFootprint,
} from '@ziroeda/pcbnew/netlist_reader/pcb_netlist_utils.js';
import { readFootprintFile } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { parse } from '@ziroeda/sexpr/index.js';

/** Two pads, pad 1 on the anchor. */
const OLD = `(footprint "R"
  (version 20241229) (generator "pcbnew") (layer "F.Cu")
  (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))
  (pad "2" smd rect (at 2.54 0) (size 1 1) (layers "F.Cu"))
)`;

/** The same part after the library moved its anchor to the pads' middle. */
const NEW = `(footprint "R"
  (version 20241229) (generator "pcbnew") (layer "F.Cu")
  (pad "1" smd rect (at -1.27 0) (size 1 1) (layers "F.Cu"))
  (pad "2" smd rect (at 1.27 0) (size 1 1) (layers "F.Cu"))
)`;

describe('ExchangeFootprint places the replacement where the old one was', () => {
  it('keeps the position and orientation, whatever the library did to its anchor', () => {
    const existing = placeFootprint(readFootprintFile(parse(OLD))!, {
      fpid: 'Lib:R',
      at: { x: MM(100), y: MM(50) },
      angle: 90,
      uuid: 'u',
      path: '/p',
    })!;

    const placed = exchangeFootprint(existing, readFootprintFile(parse(NEW))!, 'Lib:R')!;

    expect(placed.at).toEqual({ x: MM(100), y: MM(50) });
    expect(placed.angle).toBe(90);
    // So pad 1 does NOT land on the old pad 1: it moves with the new anchor.
    const pad1 = (fp: typeof placed) => fp.pads.find((p) => p.number === '1')!.at;
    expect(pad1(placed)).not.toEqual(pad1(existing));
  });
});
