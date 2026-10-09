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
 * `format()` derives both from the model every time. These tests are about the
 * round trip after FOOTPRINT::Rotate, Flip and a field's own Move.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const MM = 1e6;

/**
 * A diode like the ones in the report: reference and value text above and
 * below, a user text beside it, one rectangular pad already at 30° and one
 * upright. Both pad shapes matter — a rect pad that loses its orientation is
 * copper in the wrong place, not just an ugly label.
 */
const SRC = `(kicad_pcb (version 20241229) (generator "test")
	(layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (7 "B.SilkS" user))
	(net 0 "")
	(footprint "D_DO-41" (layer "F.Cu") (at 100 100)
		(property "Reference" "D1" (at 0 -2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(property "Value" "1N4007" (at 0 2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(fp_text user "K" (at 3 0 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
		(pad "1" smd rect (at 0 0 30) (size 1.6 0.8) (layers "F.Cu"))
		(pad "2" smd rect (at 0 2) (size 1.6 0.8) (layers "F.Cu"))
	)
)`;

const board = (): BOARD => ParseBoard(SRC);
/** Save and open again, which is the whole of what the report was about. */
const reopen = (b: BOARD): BOARD => ParseBoard(FormatBoard(b));
const fpOf = (b: BOARD): FOOTPRINT => b.Footprints()[0]!;
/** Reference, Value and the user text, in file order. */
const texts = (fp: FOOTPRINT): PCB_TEXT[] => [
  fp.GetField(FIELD_T.REFERENCE)!,
  fp.GetField(FIELD_T.VALUE)!,
  ...(fp.GraphicalItems().filter((t) => t.Type() === KICAD_T.PCB_TEXT_T) as PCB_TEXT[]),
];
const angles = (b: BOARD): { texts: number[]; pads: number[]; fp: number } => ({
  fp: fpOf(b).GetOrientationDegrees(),
  texts: texts(fpOf(b)).map((t) => t.GetTextAngleDegrees()),
  pads: fpOf(b)
    .Pads()
    .map((p) => p.GetOrientationDegrees()),
});

describe('rotating a footprint about its anchor (FOOTPRINT::Rotate)', () => {
  const rotated = (): BOARD => {
    const b = board();
    fpOf(b).Rotate(fpOf(b).GetPosition(), ANGLE_90);
    return b;
  };

  it('turns the footprint, its texts and its pads together', () => {
    expect(angles(board())).toEqual({ fp: 0, texts: [0, 0, 0], pads: [30, 0] });
    expect(angles(rotated())).toEqual({ fp: 90, texts: [90, 90, 90], pads: [120, 90] });
  });

  it('and they are all still turned after a save and a reopen', () => {
    expect(angles(reopen(rotated()))).toEqual({ fp: 90, texts: [90, 90, 90], pads: [120, 90] });
  });

  it('writes the angle into the file in the board frame, not the footprint one', () => {
    // A footprint-relative angle would be 0 for every child here. The file must
    // carry 90 (120 for the pad that started at 30), positions footprint-local.
    const text = FormatBoard(rotated());
    expect(text).toContain('(at 0 -2 90)');
    expect(text).toContain('(at 3 0 90)');
    expect(text).toContain('(at 0 0 120)');
    expect(text).toContain('(at 0 2 90)');
  });

  it('leaves the children where they are relative to the part', () => {
    const fp = fpOf(reopen(rotated()));
    // Pad 2 was 2 mm below the anchor; after a quarter turn it is 2 mm to its right.
    expect(fp.Pads()[1]!.GetPosition()).toEqual({ x: 102 * MM, y: 100 * MM });
    expect(fp.GetPosition()).toEqual({ x: 100 * MM, y: 100 * MM });
  });
});

describe('flipping a footprint to the other side (FOOTPRINT::Flip, TOP_BOTTOM)', () => {
  const flipped = (): BOARD => {
    const b = board();
    fpOf(b).Flip(fpOf(b).GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
    return b;
  };

  it('keeps its pads on it', () => {
    const before = fpOf(flipped());
    const after = fpOf(reopen(flipped()));
    expect(after.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(after.GetPosition()).toEqual(before.GetPosition());
    expect(after.Pads().map((p) => p.GetPosition())).toEqual(
      before.Pads().map((p) => p.GetPosition()),
    );
    // As geometry: pad 1 on the anchor, pad 2 mirrored to 2 mm above it.
    expect(after.Pads()[0]!.GetPosition()).toEqual(after.GetPosition());
    expect(after.Pads()[1]!.GetPosition()).toEqual({
      x: after.GetPosition().x,
      y: after.GetPosition().y - 2 * MM,
    });
  });

  it('keeps their orientation too', () => {
    // `PAD::Flip` negates the orientation: 30° becomes 330°.
    expect(
      fpOf(reopen(flipped()))
        .Pads()
        .map((p) => p.GetOrientationDegrees()),
    ).toEqual([330, 0]);
  });
});

describe('moving one footprint text on its own', () => {
  it('survives the round trip', () => {
    const b = board();
    fpOf(b)
      .GetField(FIELD_T.REFERENCE)!
      .Move({ x: 3 * MM, y: 1 * MM });
    expect(fpOf(reopen(b)).GetField(FIELD_T.REFERENCE)!.GetPosition()).toEqual({
      x: 103 * MM,
      y: 99 * MM,
    });
    // Written footprint-local, as `GetFPRelativePosition` gives it.
    expect(FormatBoard(b)).toContain('(at 3 -1 0)');
  });

  it('is measured in the footprint frame when the part is turned', () => {
    const b = ParseBoard(SRC.replace('(at 100 100)', '(at 100 100 90)'));
    const ref = fpOf(b).GetField(FIELD_T.REFERENCE)!;
    ref.Move({ x: 3 * MM, y: 0 });
    expect(fpOf(reopen(b)).GetField(FIELD_T.REFERENCE)!.GetPosition()).toEqual(ref.GetPosition());
  });
});

describe('an untouched footprint', () => {
  it('round-trips unchanged', () => {
    const once = FormatBoard(board());
    expect(FormatBoard(ParseBoard(once))).toBe(once);
    expect(angles(reopen(board()))).toEqual(angles(board()));
  });
});
