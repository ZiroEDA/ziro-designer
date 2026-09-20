// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `*.Cu` is lossy for a pad, and the DRC job round-trips the board through it.
 *
 * `formatLayers` writes `*.Cu` both for a pad on every copper layer and for one
 * on just the outer two (`pcb_io_kicad_sexpr.cpp:1576-1584`, transcribed
 * faithfully), and the parser reads it back as every copper layer. KiCad wears
 * that because the collapse only happens when a file is SAVED. We cannot,
 * because `DRC_TOOL::runJob` serialises the live board to hand it to the
 * worker - so a lossy write is a check run against a board the editor does not
 * have.
 *
 * It was not theoretical. CM5_MINIMA_3 comes from a 9.99 build with J101's
 * NPTH pads on `F&B.Cu`; the round trip put them on all six copper layers, and
 * the DRC then reported 24 hole-clearance errors against inner-layer zones
 * whose fills were poured when the pad was not on those layers. `kicad-cli`
 * agreed with us about the re-written board, and about the original, and the
 * two answers differed - which is how the round trip was caught.
 */
import { describe, expect, it } from 'vitest';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { GENERATOR } from '@ziroeda/common/src/generator.js';
import {
  CTL_ENUMERATE_LAYERS,
  CTL_FOR_BOARD,
  FormatBoard,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';

/**
 * Four copper layers, so "front and back" and "all copper" are different
 * answers - on a two-layer board the wildcard is not lossy at all.
 */
const BOARD = `(kicad_pcb
\t(version 20260206)
\t(generator "pcbnew")
\t(generator_version "10.0")
\t(general (thickness 1.6))
\t(paper "A4")
\t(layers
\t\t(0 "F.Cu" signal)
\t\t(4 "In1.Cu" signal)
\t\t(6 "In2.Cu" signal)
\t\t(2 "B.Cu" signal)
\t\t(1 "F.Mask" user)
\t\t(3 "B.Mask" user)
\t\t(5 "F.SilkS" user "F.Silkscreen")
\t\t(7 "B.SilkS" user "B.Silkscreen")
\t\t(25 "Edge.Cuts" user)
\t)
\t(footprint "TEST:MountingHole"
\t\t(layer "F.Cu")
\t\t(uuid "5a0c4d1e-0000-4000-8000-000000000001")
\t\t(at 10 10)
\t\t(pad "" np_thru_hole circle
\t\t\t(at 0 0)
\t\t\t(size 1.5 1.5)
\t\t\t(drill 1.5)
\t\t\t(layers "F&B.Cu" "*.Mask")
\t\t\t(uuid "5a0c4d1e-0000-4000-8000-000000000002")
\t\t)
\t\t(pad "1" thru_hole circle
\t\t\t(at 3 0)
\t\t\t(size 1.6 1.6)
\t\t\t(drill 0.8)
\t\t\t(layers "*.Cu" "*.Mask")
\t\t\t(uuid "5a0c4d1e-0000-4000-8000-000000000003")
\t\t)
\t)
)
`;

/** The copper layers a pad sits on, after a write and a read back. */
function copperAfterRoundTrip(aCtl: number): Record<string, PCB_LAYER_ID[]> {
  const written = FormatBoard(ParseBoard(BOARD, 'transport.kicad_pcb'), GENERATOR, aCtl);
  const out: Record<string, PCB_LAYER_ID[]> = {};

  for (const fp of ParseBoard(written, 'transport.kicad_pcb').Footprints()) {
    for (const pad of fp.Pads()) {
      // Copper only, and by `IsCopperLayer` rather than by id: KiCad 10
      // interleaves the technical layers with the copper ones (F.Mask is 1,
      // B.Cu is 2), so a range test quietly includes the masks.
      out[pad.GetNumber() === '' ? 'npth' : pad.GetNumber()] = [...pad.GetLayerSet()].filter((l) =>
        IsCopperLayer(l),
      );
    }
  }

  return out;
}

const OUTER = [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu];

describe('the DRC job hands the worker the board the editor has', () => {
  it('keeps an outer-layers-only pad off the inner layers', () => {
    const got = copperAfterRoundTrip(CTL_FOR_BOARD | CTL_ENUMERATE_LAYERS);

    expect(got.npth).toEqual(OUTER);
    // ...and does not go the other way either: a pad that really is on every
    // copper layer still is. (`*.Cu` is every copper layer there could be,
    // not the four this board enables - that is how the parser reads it.)
    expect(got['1']).toContain(PCB_LAYER_ID.In1_Cu);
    expect(got['1']).toContain(PCB_LAYER_ID.In2_Cu);
  });

  it('is exactly what a plain board write loses, which is why the flag exists', () => {
    // Not a wish: this is what `SaveBoard` does, and what KiCad's own save
    // does - a 10.0.6 re-save of CM5_MINIMA_3 writes `*.Cu` for those same
    // NPTH pads. The assertion is here so that the day it stops being true,
    // the flag above is known to be unnecessary rather than quietly redundant.
    const saved = copperAfterRoundTrip(CTL_FOR_BOARD);

    expect(saved.npth).not.toEqual(OUTER);
    expect(saved.npth).toContain(PCB_LAYER_ID.In1_Cu);
  });

  it('writes the layers out rather than the wildcard', () => {
    const written = FormatBoard(
      ParseBoard(BOARD, 'transport.kicad_pcb'),
      GENERATOR,
      CTL_FOR_BOARD | CTL_ENUMERATE_LAYERS,
    );

    // The NPTH pad's own line, not the file at large.
    const padLine = written.split('\n').find((l) => l.includes('(layers') && l.includes('B.Cu'));

    expect(padLine).toBeDefined();
    expect(padLine).not.toContain('*.Cu');
    expect(padLine).toContain('"F.Cu"');
    expect(padLine).toContain('"B.Cu"');
  });
});
