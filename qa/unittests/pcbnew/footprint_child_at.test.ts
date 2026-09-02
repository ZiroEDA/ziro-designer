// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A footprint's children survive a save.
 *
 * The report: "when I rotate a footprint the text rotates too, that's good, but
 * when I close the editor and reopen, the footprint is still rotated and its
 * text is horizontal again." It was worse than the text — every pad came back
 * unrotated too, and a *flip* reloaded the pads a hundred millimetres away from
 * their own footprint.
 *
 * One cause: a footprint child's `(at …)` is a **mixed** pair, and every
 * mutation was expected to know it.
 *
 *     // format( const PAD* ), pcb_io_kicad_sexpr.cpp:1695-1699
 *     m_out->Print( "(at %s %s)", formatInternalUnits( aPad->GetFPRelativePosition() ),
 *                   aPad->GetOrientation().IsZero() ? "" : FormatAngle( aPad->GetOrientation() ) );
 *
 *     // format( const PCB_TEXT* ), :2280-2302
 *     pos -= parentFP->GetPosition();
 *     RotatePoint( pos, -parentFP->GetOrientation() );
 *     m_out->Print( "(at %s %s)", formatInternalUnits( pos ), FormatAngle( aText->GetTextAngle() ) );
 *
 * The position is footprint-relative; the angle is absolute — the parser says
 * so in as many words, "It was read as absolute rotation from file"
 * (pcb_io_kicad_sexpr_parser.cpp:3959-3965), and `parsePAD` sets the pad's
 * orientation from the file value with no parent term (:5904).
 *
 * Upstream cannot get this wrong because `format()` derives both from the model
 * every time; ours re-emitted a stored parse tree, so each mutation had to
 * convert for itself. Rotation converted neither angle, flip wrote board
 * coordinates into the local slot. The writer derives it now, so these tests are
 * about the round trip and not about any one command.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  flipBoardItems,
  modificationPoint,
  moveBoardItems,
  rotateBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = 1e6;

/**
 * A diode like the ones in the report: reference and value text above and
 * below, a user text beside it, one rectangular pad already at 30° and one
 * upright. Both pad shapes matter — a rect pad that loses its orientation is
 * copper in the wrong place, not just an ugly label.
 */
const SRC = `(kicad_pcb (version 20241229) (generator "test")
	(layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user) (38 "B.SilkS" user))
	(net 0 "")
	(footprint "D_DO-41" (layer "F.Cu") (at 100 100)
		(property "Reference" "D1" (at 0 -2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(property "Value" "1N4007" (at 0 2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(fp_text user "K" (at 3 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(pad "1" smd rect (at 0 0 30) (size 1.6 0.8) (layers "F.Cu"))
		(pad "2" smd rect (at 0 2) (size 1.6 0.8) (layers "F.Cu"))
	)
)`;

const board = (): Board => readBoard(parse(SRC));
/** Save and open again, which is the whole of what the report was about. */
const reopen = (b: Board): Board => readBoard(parse(serializeBoard(b)));
const angles = (b: Board): { texts: number[]; pads: number[]; fp: number } => ({
  fp: b.footprints[0]!.angle,
  texts: b.footprints[0]!.texts.map((t) => t.angle),
  pads: b.footprints[0]!.pads.map((p) => p.angle),
});

describe('rotating a footprint', () => {
  const rotated = (): Board => {
    const b = board();
    const at = modificationPoint(b, new Set(['footprint:0'])) ?? undefined;
    return rotateBoardItems(b, new Set(['footprint:0']), true, at);
  };

  it('turns the footprint, its texts and its pads together', () => {
    expect(angles(board())).toEqual({ fp: 0, texts: [0, 0, 0], pads: [30, 0] });
    expect(angles(rotated())).toEqual({ fp: 90, texts: [90, 90, 90], pads: [120, 90] });
  });

  it('and they are all still turned after a save and a reopen', () => {
    // The bug, exactly: this used to come back { fp: 90, texts: [0,0,0], pads: [30,0] }
    // — the part turned, everything inside it upright. Stated as the literal
    // rather than as "the same as before the save", so it also fails if the
    // rotation itself starts producing the wrong angles.
    expect(angles(reopen(rotated()))).toEqual({ fp: 90, texts: [90, 90, 90], pads: [120, 90] });
  });

  it('writes the angle into the file in the board frame, not the footprint one', () => {
    // A footprint-relative angle would be 0 for every child here, since they all
    // turned with their parent. The file must carry 90 (120 for the pad that
    // started at 30), or the reader — which subtracts nothing — is wrong.
    const text = serializeBoard(rotated());
    expect(text).toContain('(at 0 -2 90)');
    expect(text).toContain('(at 3 0 90)');
    expect(text).toContain('(at 0 0 120)');
    expect(text).toContain('(at 0 2 90)');
    // …while the positions stay footprint-local: a rigid turn does not move a
    // child within its parent's frame.
    expect(text).not.toContain('(at 100 100 90)\n\t\t\t(at 98');
  });

  it('leaves the children where they are relative to the part', () => {
    const r = reopen(rotated());
    const fp = r.footprints[0]!;
    // Pad 2 was 2 mm below the anchor; after a quarter turn it is 2 mm to its
    // right, and it is still exactly 2 mm away.
    expect(fp.pads[1]!.at).toEqual({ x: 102 * MM, y: 100 * MM });
    expect(fp.at).toEqual({ x: 100 * MM, y: 100 * MM });
  });
});

describe('flipping a footprint to the other side', () => {
  const flipped = (): Board => flipBoardItems(board(), new Set(['footprint:0']));

  it('keeps its pads on it', () => {
    // The `(at …)` slot is footprint-relative, and flip used to write the
    // board-absolute position into it: on reload the pads sat at (200, 203),
    // 100 mm from a footprint at (100, 101.65).
    const before = flipped().footprints[0]!;
    const after = reopen(flipped()).footprints[0]!;
    expect(after.at).toEqual(before.at);
    expect(after.pads.map((p) => p.at)).toEqual(before.pads.map((p) => p.at));
    // And as geometry rather than as "whatever it was before the save": pad 1
    // is on the anchor and pad 2 is 2 mm from it, mirrored to the other side of
    // it by the flip. Reloading them 100 mm away, which is what happened, fails
    // this whether or not the in-memory model agrees.
    expect(after.pads[0]!.at).toEqual(after.at);
    expect(after.pads[1]!.at).toEqual({ x: after.at.x, y: after.at.y - 2 * MM });
  });

  it('keeps their orientation too', () => {
    // `PAD::Flip` negates the orientation: 30° becomes 330°.
    expect(reopen(flipped()).footprints[0]!.pads.map((p) => p.angle)).toEqual([330, 0]);
  });
});

describe('dragging one footprint text on its own', () => {
  it('survives the round trip', () => {
    const moved = moveBoardItems(board(), new Set(['fptext:0:0']), { x: 3 * MM, y: 1 * MM });
    const ref = reopen(moved).footprints[0]!.texts[0]!;
    expect(ref.at).toEqual({ x: 103 * MM, y: 99 * MM });
    // Written footprint-local, as `GetFPRelativePosition` gives it.
    expect(serializeBoard(moved)).toContain('(at 3 -1 0)');
  });

  it('is measured in the footprint frame when the part is turned', () => {
    const turned = readBoard(parse(SRC.replace('(at 100 100)', '(at 100 100 90)')));
    const moved = moveBoardItems(turned, new Set(['fptext:0:0']), { x: 3 * MM, y: 0 });
    // A board +X drag on a part turned 90° is a local −Y shift, and the file
    // records the local one.
    const ref = reopen(moved).footprints[0]!.texts[0]!;
    expect(ref.at).toEqual(moved.footprints[0]!.texts[0]!.at);
  });
});

describe('an untouched footprint', () => {
  it('round-trips unchanged', () => {
    // The writer derives every child `(at …)` now, so this is the guard that it
    // derives the *same* one when nothing has been edited.
    const once = serializeBoard(board());
    expect(serializeBoard(readBoard(parse(once)))).toBe(once);
    expect(angles(reopen(board()))).toEqual(angles(board()));
  });
});
