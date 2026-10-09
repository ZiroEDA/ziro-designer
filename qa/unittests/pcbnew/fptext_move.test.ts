// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const mmToIU = (n: number): number => pcbIUScale.mmToIU(n);

const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user))
  (net 0 "")
  (footprint "R_0805" (layer "F.Cu") (at 100 100)
    (fp_text reference "R1" (at 0 -2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value "10k" (at 0 2) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu"))
    (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu"))
  )
)`;

describe('a footprint text moved on its own', () => {
  it('moves only the reference, and writes its new footprint-relative position', () => {
    const board = ParseBoard(BOARD);
    const fp = board.Footprints()[0]!;
    const ref = fp.GetField(FIELD_T.REFERENCE)!;
    const val = fp.GetField(FIELD_T.VALUE)!;
    const refBefore = { ...ref.GetPosition() };
    const valBefore = { ...val.GetPosition() };
    const fpBefore = { ...fp.GetPosition() };

    ref.Move({ x: mmToIU(3), y: mmToIU(1) });
    expect(ref.GetPosition()).toEqual({ x: refBefore.x + mmToIU(3), y: refBefore.y + mmToIU(1) });
    expect(val.GetPosition()).toEqual(valBefore);
    expect(fp.GetPosition()).toEqual(fpBefore);

    // `format( PCB_TEXT* )` writes a footprint text relative to its parent.
    const out = FormatBoard(board);
    expect(out).toContain('(at 3 -1 0)');
    const back = ParseBoard(out).Footprints()[0]!.GetField(FIELD_T.REFERENCE)!;
    expect(back.GetPosition()).toEqual(ref.GetPosition());
  });

  it('a rotated footprint keeps a moved text where it was put', () => {
    const board = ParseBoard(BOARD.replace('(at 100 100)', '(at 100 100 90)'));
    const ref = board.Footprints()[0]!.GetField(FIELD_T.REFERENCE)!;
    ref.Move({ x: mmToIU(3), y: 0 });
    const back = ParseBoard(FormatBoard(board)).Footprints()[0]!.GetField(FIELD_T.REFERENCE)!;
    expect(back.GetPosition()).toEqual(ref.GetPosition());
  });
});
