// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

/** `PCB_IO_KICAD_SEXPR::LoadBoard` then `SaveBoard`, as text. */
const resave = (text: string): string => FormatBoard(ParseBoard(text));

// A small but representative board: a footprint, two graphics, a track, an arc
// track and a via, across a minimal layer table with two nets.
const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(general (thickness 1.6))
	(paper "A4")
	(layers
		(0 "F.Cu" signal)
		(2 "B.Cu" signal)
		(25 "Edge.Cuts" user)
		(5 "F.SilkS" user "F.Silkscreen")
		(35 "F.Fab" user)
	)
	(net 0 "")
	(net 1 "GND")
	(footprint "R_0603" (layer "F.Cu") (at 10 10 0)
		(property "Reference" "R1" (at 0 -1 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(property "Value" "10k" (at 0 1 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
		(pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu") (roundrect_rratio 0.25))
		(pad "2" smd roundrect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu") (roundrect_rratio 0.25))
	)
	(gr_line (start 0 0) (end 50 0) (stroke (width 0.15) (type solid)) (layer "Edge.Cuts"))
	(gr_text "Hello" (at 20 20 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
	(arc (start 30 10) (mid 35 12) (end 40 10) (width 0.25) (layer "F.Cu") (net 1))
	(via (at 40 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
)
`;

describe('FormatBoard (.kicad_pcb writer)', () => {
  it('is a fixed point after the first save (lossless round-trip)', () => {
    // The first save normalises a hand-written fixture — the current file
    // version, fresh uuids for items that had none — so the property is that
    // the second save writes the first one's bytes back.
    const once = resave(BOARD);
    expect(resave(once)).toBe(once);
  });

  it('preserves every item through a write + re-read', () => {
    const b = ParseBoard(resave(BOARD));
    const tracks = (t: KICAD_T) => b.Tracks().filter((x) => x.Type() === t);
    expect(b.Footprints()).toHaveLength(1);
    expect(b.Footprints()[0]!.Pads()).toHaveLength(2);
    expect(tracks(KICAD_T.PCB_TRACE_T)).toHaveLength(1);
    expect(tracks(KICAD_T.PCB_ARC_T)).toHaveLength(1);
    expect(tracks(KICAD_T.PCB_VIA_T)).toHaveLength(1);
    expect(b.Drawings().filter((d) => d.Type() === KICAD_T.PCB_SHAPE_T)).toHaveLength(1);
    expect(b.Drawings().filter((d) => d.Type() === KICAD_T.PCB_TEXT_T)).toHaveLength(1);
    expect(b.FindNet('GND')).not.toBeNull();
  });
});

// Opportunistic: real KiCad demo boards when the source tree is present.
const DEMOS = [
  '/home/akshay/zeo/demos/test_pads_inside_pads/test_pads_inside_pads.kicad_pcb',
  '/home/akshay/zeo/demos/custom_pads_test/custom_pads_test.kicad_pcb',
];
for (const path of DEMOS) {
  describe.skipIf(!existsSync(path))(`FormatBoard (real demo: ${path.split('/').pop()})`, () => {
    it('round-trips the real board to a fixed point', () => {
      const once = resave(readFileSync(path, 'utf8'));
      expect(resave(once)).toBe(once);
    });
  });
}
