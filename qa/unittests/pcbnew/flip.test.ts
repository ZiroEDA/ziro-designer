// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Change Side / Flip (EDIT_TOOL::Flip, the F key).
 *
 * Not the same as Mirror: upstream's Mirror refuses footprints outright
 * ("Footprints cannot be mirrored. Use Flip to move them to the other side of
 * the board."), because a footprint's sides are not interchangeable — flipping
 * swaps every child's layer as well as mirroring its geometry.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { flipBoardItems, flipLayerName } from '@ziroeda/pcbnew/src/edit-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));

/** A four-layer board so the inner-copper half of FlipLayer has something to do. */
const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (1 "In1.Cu" signal) (2 "In2.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "N1")
  (segment (start 0 10) (end 10 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "t1"))
  (arc (start 20 10) (mid 25 15) (end 30 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "a1"))
  (via (at 40 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))
  (via blind (at 45 10) (size 0.8) (drill 0.4) (layers "F.Cu" "In1.Cu") (net 1) (uuid "v2"))
  (gr_text "hi" (at 50 10 30) (layer "F.SilkS") (uuid "x1")
    (effects (font (size 1 1) (thickness 0.15))))
  (gr_line (start 60 10) (end 70 10) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "s1"))
  (footprint "L:R" (layer "F.Cu") (uuid "f1") (at 20 30 30)
    (attr smd)
    (property "Reference" "R1" (at 0 -2 30) (layer "F.SilkS") (uuid "p1")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -0.8 0 30) (size 0.9 0.9) (layers "F.Cu" "F.Paste" "F.Mask") (uuid "d1"))
    (fp_line (start -1 -1) (end 1 -1) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "g1")))
)`;

/** Mirror about y = 0 so the arithmetic in the assertions stays obvious. */
const flip = (b: Board, ids: string[]): Board => flipBoardItems(b, new Set(ids), { x: 0, y: 0 });

describe('flipLayerName', () => {
  it('swaps the front and back pairs', () => {
    expect(flipLayerName('F.Cu')).toBe('B.Cu');
    expect(flipLayerName('B.Cu')).toBe('F.Cu');
    expect(flipLayerName('F.SilkS')).toBe('B.SilkS');
    expect(flipLayerName('B.Paste')).toBe('F.Paste');
    expect(flipLayerName('F.CrtYd')).toBe('B.CrtYd');
  });

  it('leaves side-less layers alone', () => {
    expect(flipLayerName('Edge.Cuts')).toBe('Edge.Cuts');
    expect(flipLayerName('User.1')).toBe('User.1');
  });

  it('reverses inner copper about the middle of the stack', () => {
    // Four copper layers: In1 <-> In2.
    expect(flipLayerName('In1.Cu', 4)).toBe('In2.Cu');
    expect(flipLayerName('In2.Cu', 4)).toBe('In1.Cu');
    // Six: In1 <-> In4, In2 <-> In3.
    expect(flipLayerName('In1.Cu', 6)).toBe('In4.Cu');
    expect(flipLayerName('In2.Cu', 6)).toBe('In3.Cu');
  });

  it('leaves inner copper alone without a copper count to reverse against', () => {
    expect(flipLayerName('In1.Cu')).toBe('In1.Cu');
  });
});

describe('flipping copper', () => {
  const b = load(SRC);

  it('mirrors a track in Y and swaps its layer', () => {
    const t = flip(b, ['track:0']).tracks[0]!;

    expect(t.start).toEqual({ x: 0, y: -MM(10) });
    expect(t.end).toEqual({ x: MM(10), y: -MM(10) });
    expect(t.layer).toBe('B.Cu');
  });

  it('mirrors an arc, mid point included', () => {
    const a = flip(b, ['arc:0']).arcs[0]!;

    expect(a.start).toEqual({ x: MM(20), y: -MM(10) });
    expect(a.mid).toEqual({ x: MM(25), y: -MM(15) });
    expect(a.layer).toBe('B.Cu');
  });

  it('moves a through via but leaves its span, which is the whole stack', () => {
    const v = flip(b, ['via:0']).vias[0]!;

    expect(v.at).toEqual({ x: MM(40), y: -MM(10) });
    expect(v.layers).toEqual(['F.Cu', 'B.Cu']);
  });

  it('flips a blind via’s layer span', () => {
    const v = flip(b, ['via:1']).vias[1]!;

    expect(v.at).toEqual({ x: MM(45), y: -MM(10) });
    // Four copper layers, so In1 reverses to In2.
    expect(v.layers).toEqual(['B.Cu', 'In2.Cu']);
  });
});

describe('flipping graphics', () => {
  const b = load(SRC);

  it('turns a text angle into 180 minus it, not the negation', () => {
    // PCB_TEXT::Flip: text mirrors as text rather than rotating.
    const t = flip(b, ['text:0']).texts[0]!;

    expect(t.at).toEqual({ x: MM(50), y: -MM(10) });
    expect(t.angle).toBe(150);
    expect(t.layer).toBe('B.SilkS');
    expect(t.mirror).toBe(true);
  });

  it('mirrors a line and swaps its layer', () => {
    const s = flip(b, ['shape:0']).shapes[0]!;

    expect(s.start).toEqual({ x: MM(60), y: -MM(10) });
    expect(s.layer).toBe('B.SilkS');
  });
});

describe('flipping a footprint', () => {
  const b = load(SRC);
  const flipped = flip(b, ['footprint:0']);
  const fp = flipped.footprints[0]!;

  it('moves it to the other side', () => {
    expect(fp.layer).toBe('B.Cu');
    expect(fp.at).toEqual({ x: MM(20), y: -MM(30) });
  });

  it('negates the orientation, normalised to ]-180, 180]', () => {
    // FOOTPRINT::Flip negates rather than 180-minus: the angle is a placement
    // value that pick-and-place files read back.
    expect(fp.angle).toBe(-30);
  });

  it('carries the pads across, mirrored and re-layered', () => {
    const before = b.footprints[0]!.pads[0]!;
    const after = fp.pads[0]!;

    expect(after.at).toEqual({ x: before.at.x, y: -before.at.y });
    expect(after.angle).toBe(330);
    expect(after.layers).toEqual(['B.Cu', 'B.Paste', 'B.Mask']);
  });

  it('carries its text and graphics across', () => {
    expect(fp.texts[0]!.layer).toBe('B.SilkS');
    expect(fp.texts[0]!.at.y).toBe(-b.footprints[0]!.texts[0]!.at.y);
    expect(fp.shapes[0]!.layer).toBe('B.SilkS');
  });

  it('is its own inverse', () => {
    const back = flip(flipped, ['footprint:0']).footprints[0]!;
    const orig = b.footprints[0]!;

    expect(back.at).toEqual(orig.at);
    expect(back.angle).toBe(orig.angle);
    expect(back.layer).toBe(orig.layer);
    expect(back.pads[0]!.at).toEqual(orig.pads[0]!.at);
    expect(back.pads[0]!.layers).toEqual(orig.pads[0]!.layers);
  });
});

describe('source patching', () => {
  const b = load(SRC);

  it('a flipped track survives serialize/reload', () => {
    const out = roundTrip(flip(b, ['track:0'])).tracks[0]!;
    expect(out.layer).toBe('B.Cu');
    expect(out.start).toEqual({ x: 0, y: -MM(10) });
  });

  it('a flipped footprint survives, pads and all', () => {
    const out = roundTrip(flip(b, ['footprint:0'])).footprints[0]!;

    expect(out.layer).toBe('B.Cu');
    expect(out.angle).toBe(-30);
    expect(out.at).toEqual({ x: MM(20), y: -MM(30) });
    expect(out.pads[0]!.layers).toEqual(['B.Cu', 'B.Paste', 'B.Mask']);
    expect(out.texts[0]!.layer).toBe('B.SilkS');
  });

  it('leaves unselected items untouched', () => {
    const out = flip(b, ['track:0']);
    expect(out.arcs[0]).toBe(b.arcs[0]);
    expect(out.footprints[0]).toBe(b.footprints[0]);
  });

  it('does nothing on an empty selection', () => {
    expect(flipBoardItems(b, new Set())).toBe(b);
  });
});

describe('the default centre', () => {
  it('flips in place about the selection’s own middle', () => {
    const b = load(SRC);
    // No centre given: the track flips about its own bbox, so it does not move.
    const t = flipBoardItems(b, new Set(['track:0'])).tracks[0]!;

    expect(t.start).toEqual(b.tracks[0]!.start);
    expect(t.layer).toBe('B.Cu');
  });
});
