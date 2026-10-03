// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pad Properties, board side (DIALOG_PAD_PROPERTIES).
 *
 * The board-editor wrinkle: a pad's position is board-absolute in this model
 * but footprint-local in the file, so every position edit has to convert back
 * through the parent's rotation and anchor. A rotated footprint is therefore
 * the interesting case, and the fixture has one.
 */
import { describe, it, expect } from 'vitest';
import { U, writtenItems } from './support/written_node.js';
import { parse } from '@ziroeda/sexpr/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { padAt, type PadValues } from '@ziroeda/pcbnew/dialogs/dialog_pad_properties.js';
import type { Board, PcbPad } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
const pad = (b: Board, i = 0): PcbPad => b.footprints[0]!.pads[i]!;
/** The written items, one line, header excluded. */
const flat = (b: Board): string => writtenItems(b);

/** A footprint rotated 90°, so the local/absolute conversion has to work. */
const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "") (net 1 "N1") (net 2 "N2")
  (footprint "L:R" (layer "F.Cu") (uuid "${U('f1')}") (at 20 30 90)
    (pad "1" smd roundrect (at -1 0 90) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask")
      (roundrect_rratio 0.25) (net 1 "N1") (uuid "${U('p1')}"))
    (pad "2" thru_hole circle (at 1 0 90) (size 1.5 1.5) (drill 0.8)
      (layers "*.Cu" "*.Mask") (net 1 "N1") (uuid "${U('p2')}")))
)`;

describe('padAt', () => {
  const b = load(SRC);

  it('resolves a single pad id', () => {
    expect(padAt(b, ['pad:0:1'])).toEqual({ footprint: 0, pad: 1 });
  });

  it('refuses an empty or ambiguous selection', () => {
    expect(padAt(b, [])).toBeNull();
    expect(padAt(b, ['footprint:0'])).toBeNull();
    expect(padAt(b, ['pad:0:0', 'pad:0:1'])).toBeNull();
  });
});
