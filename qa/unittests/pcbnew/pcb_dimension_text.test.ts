// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_DIMENSION_BASE's text: `GetValueText`, `updateText`'s format switch and
 * each kind's `updateText` placement (pcbnew/pcb_dimension.cpp).
 *
 * Every number is derived from the C++ in the comment above it, and one
 * section re-derives a dimension KiCad itself wrote, so the placement port has
 * a fixed point that is not ours.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { PCB_DIM_ALIGNED, PCB_DIMENSION_BASE } from '@ziroeda/pcbnew/pcb_dimension.js';
import {
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from '@ziroeda/pcbnew/pcb_dimension.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const P = (x: number, y: number): { x: number; y: number } => ({ x: MM(x), y: MM(y) });

const boardOf = (dimension: string): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (17 "Dwgs.User" user "User.Drawings"))
  (net 0 "")
  ${dimension}
)`);

const first = (b: BOARD): PCB_DIMENSION_BASE => b.Drawings()[0] as PCB_DIMENSION_BASE;

const STYLE = `(style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
      (keep_text_aligned yes))`;
const TEXT = (at = '0 0 0') => `(gr_text "" (at ${at}) (layer "Dwgs.User")
      (effects (font (size 1 1) (thickness 0.15))))`;

/** A 10 mm horizontal aligned dimension with a crossbar 5 mm above it, mm, X_XXXX, zeroes suppressed. */
const aligned = (pts = '(xy 0 0) (xy 10 0)', textAt = '0 0 0', style = STYLE): PCB_DIM_ALIGNED => {
  const d = first(
    boardOf(`(dimension (type aligned) (layer "Dwgs.User")
    (pts ${pts}) (height 5)
    (format (prefix "") (suffix "") (units 2) (units_format 0) (precision 4) (suppress_zeroes yes))
    ${style}
    ${TEXT(textAt)})`),
  );
  return d as PCB_DIM_ALIGNED;
};

/** `Update()` and the string it leaves on the text. */
const shown = (d: PCB_DIMENSION_BASE): string => {
  d.Update();
  return d.GetText();
};

describe('which units the value is shown in (SetUnitsMode)', () => {
  it('reads the three fixed DIM_UNITS_MODE members', () => {
    const d = aligned();
    d.SetUnitsMode(DIM_UNITS_MODE.INCH);
    expect(d.GetUnits()).toBe('in');
    d.SetUnitsMode(DIM_UNITS_MODE.MILS);
    expect(d.GetUnits()).toBe('mils');
    d.SetUnitsMode(DIM_UNITS_MODE.MM);
    expect(d.GetUnits()).toBe('mm');
  });

  it('takes AUTOMATIC from the board, not from a constant', () => {
    // `m_units = GetBoard() ? GetBoard()->GetUserUnits() : EDA_UNITS::MM`.
    const d = aligned();
    d.GetBoard()!.SetUserUnits('in');
    d.SetUnitsMode(DIM_UNITS_MODE.AUTOMATIC);
    expect(d.GetUnits()).toBe('in');
    d.GetBoard()!.SetUserUnits('mils');
    d.SetUnitsMode(DIM_UNITS_MODE.AUTOMATIC);
    expect(d.GetUnits()).toBe('mils');
    expect(d.GetUnitsMode()).toBe(DIM_UNITS_MODE.AUTOMATIC);
  });
});

describe('the measured value as a string (GetValueText, :430-469)', () => {
  it('prints the distance at the requested precision', () => {
    // 10 mm at X_XXXX, zeroes kept.
    const d = aligned();
    d.SetSuppressZeroes(false);
    d.Update();
    expect(d.GetValueText()).toBe('10.0000');
  });

  it('converts to the chosen unit', () => {
    // 10 mm is 10/25.4 in and 10000/25.4 mils.
    const d = aligned();
    d.SetSuppressZeroes(false);
    d.SetUnitsMode(DIM_UNITS_MODE.INCH);
    expect(d.GetValueText()).toBe('0.3937');
    d.SetUnitsMode(DIM_UNITS_MODE.MILS);
    expect(d.GetValueText()).toBe('393.7008');
  });

  it('strips the trailing zeroes when asked', () => {
    expect(aligned().GetValueText()).toBe('10');
  });

  it('stops at the decimal point rather than eating real digits', () => {
    // 10.5 mm -> "10.5000" -> "10.5"; the loop breaks the moment it eats a '.'.
    const d = aligned('(xy 0 0) (xy 10.5 0)');
    d.Update();
    expect(d.GetValueText()).toBe('10.5');
  });

  it('eats a whole-number zero at precision X, as upstream does', () => {
    // `while( text.EndsWith( '0' ) )` runs before any decimal point exists, so
    // "10" becomes "1" and the loop then stops (:456-465).
    const d = aligned();
    d.SetPrecision(0);
    expect(d.GetValueText()).toBe('1');
    // Without suppression the same value keeps its zero.
    d.SetSuppressZeroes(false);
    expect(d.GetValueText()).toBe('10');
  });

  it('rebases the significant-digit precisions per unit', () => {
    // `precision >= 6` (:439-448): inch loses 4, mm loses 5, mils loses 7 with
    // a floor of 0.
    const d = aligned();
    d.SetSuppressZeroes(false);
    d.SetPrecision(6);
    d.SetUnitsMode(DIM_UNITS_MODE.MM);
    expect(d.GetValueText()).toBe('10.0');
    d.SetUnitsMode(DIM_UNITS_MODE.INCH);
    expect(d.GetValueText()).toBe('0.39');
    d.SetUnitsMode(DIM_UNITS_MODE.MILS);
    expect(d.GetValueText()).toBe('394');
    // V_VVVV (8) in mils is 8 - 7 = one decimal; the floor only bites below 7.
    d.SetPrecision(8);
    expect(d.GetValueText()).toBe('393.7');
  });
});

describe('the whole displayed string (updateText)', () => {
  it('adds no suffix in NO_SUFFIX', () => {
    expect(shown(aligned())).toBe('10');
  });

  it('adds a bare suffix, leading space included', () => {
    const d = aligned();
    d.SetUnitsFormat(DIM_UNITS_FORMAT.BARE_SUFFIX);
    expect(shown(d)).toBe('10 mm');
  });

  it('parenthesises the suffix with its leading space trimmed', () => {
    const d = aligned();
    d.SetUnitsFormat(DIM_UNITS_FORMAT.PAREN_SUFFIX);
    expect(shown(d)).toBe('10 (mm)');
  });

  it('wraps the prefix and suffix outside the unit label', () => {
    const d = aligned();
    d.SetUnitsFormat(DIM_UNITS_FORMAT.BARE_SUFFIX);
    d.SetPrefix('R ');
    d.SetSuffix(' typ.');
    expect(shown(d)).toBe('R 10 mm typ.');
  });

  it('shows the override instead of the measurement', () => {
    const d = aligned();
    d.SetOverrideTextEnabled(true);
    d.SetOverrideText('DNP');
    expect(shown(d)).toBe('DNP');
  });

  it('still puts a unit suffix on an override', () => {
    // `text = m_overrideTextEnabled ? m_valueString : GetValueText()` happens
    // before the format switch, so the suffix lands on typed text too.
    const d = aligned();
    d.SetOverrideTextEnabled(true);
    d.SetOverrideText('Leader');
    d.SetUnitsFormat(DIM_UNITS_FORMAT.BARE_SUFFIX);
    expect(shown(d)).toBe('Leader mm');
  });

  it('distinguishes an empty override from an absent one', () => {
    const d = aligned();
    d.SetOverrideTextEnabled(true);
    d.SetOverrideText('');
    expect(shown(d)).toBe('');
    d.SetOverrideTextEnabled(false);
    expect(shown(d)).toBe('10');
  });
});

describe('where the label lands, against a dimension KiCad wrote', () => {
  // Verbatim from demos/cm5_minima. Every number in the `(gr_text …)` line is
  // derived, so it is a fixed point for the whole placement port.
  const fromFile = (): PCB_DIMENSION_BASE =>
    first(
      boardOf(`(dimension
      (type orthogonal)
      (layer "Dwgs.User")
      (pts (xy 113.6 58.975) (xy 113.35 28.975))
      (height 12.85)
      (orientation 1)
      (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4)
        (suppress_zeroes yes))
      ${STYLE}
      (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User")
        (effects (font (size 1 1) (thickness 0.15)))))`),
    );

  it('re-derives the position KiCad stored, to the nanometre', () => {
    // Crossbar runs (126.45, 58.975) -> (126.45, 28.975); its centre offset is
    // (0, -15). x == 0, so the rotation is 90 * sign(15) = +90, which sends
    // (0, -15) to (-15, 0); resized to pen (0.15) + text height (1) = 1.15 that
    // is (-1.15, 0). Text pos = crossbar start + (0, -15) + (-1.15, 0).
    const d = fromFile();
    d.Update();
    expect(d.GetTextPos()).toEqual(P(125.3, 43.975));
  });

  it('re-derives the angle KiCad stored', () => {
    // EDA_ANGLE((0, -15)) is -90; 360 - (-90) normalises to 90, which is not in
    // (90, 270], so it is kept.
    const d = fromFile();
    d.Update();
    expect(d.GetTextAngle().AsDegrees()).toBe(90);
  });

  it('re-derives the string KiCad stored, in the board’s units', () => {
    // (units 3), AUTOMATIC. 30 mm at X_XXXX with zeroes suppressed: "30".
    const d = fromFile();
    d.GetBoard()!.SetUserUnits('mm');
    d.SetUnitsMode(DIM_UNITS_MODE.AUTOMATIC);
    expect(shown(d)).toBe('30');
    // 30 mm is 1.1811023... in, so "1.1811".
    d.GetBoard()!.SetUserUnits('in');
    d.SetUnitsMode(DIM_UNITS_MODE.AUTOMATIC);
    expect(shown(d)).toBe('1.1811');
  });
});

describe('the aligned placement in each direction (PCB_DIM_ALIGNED::updateText)', () => {
  // textOffsetDistance is pen (0.15, under the 0.25 * 1 clamp) + height (1).
  const D = MM(1.15);

  it('hangs the label above a left-to-right bar', () => {
    // Crossbar (0,5) -> (10,5); centre offset (5,0). x > 0 so rotation is +90,
    // sending (5,0) to (0,-5), resized to (0,-D). Pos = (0,5) + (5,0) + (0,-D).
    // KiCad's height is signed the other way: (height 5) puts the bar at y -5.
    const d = aligned();
    d.Update();
    expect(d.GetTextPos()).toEqual({ x: MM(5), y: d.GetCrossbarStart().y - D });
    expect(d.GetTextAngle().AsDegrees()).toBe(0);
  });

  it('hangs it to the left of a top-to-bottom bar, reading upwards', () => {
    // EDA_ANGLE((0,5)) = 90; 360-90 = 270, which is in (90,270], so 270-180.
    const d = aligned('(xy 0 0) (xy 0 10)');
    d.Update();
    expect(d.GetTextPos()).toEqual({ x: d.GetCrossbarStart().x - D, y: MM(5) });
    expect(d.GetTextAngle().AsDegrees()).toBe(90);
  });

  it('sits the label on the bar in INLINE mode', () => {
    const d = aligned();
    d.SetTextPositionMode(DIM_TEXT_POSITION.INLINE);
    d.Update();
    expect(d.GetTextPos()).toEqual({ x: MM(5), y: d.GetCrossbarStart().y });
  });

  it('leaves a manually placed label exactly where it was put', () => {
    // The file says MANUAL, so the parser's own Update() leaves the text too.
    const d = aligned(
      '(xy 0 0) (xy 10 0)',
      '42 7 0',
      STYLE.replace('(text_position_mode 0)', '(text_position_mode 2)'),
    );
    d.Update();
    expect(d.GetTextPos()).toEqual(P(42, 7));
    // The string is still re-derived; only the position is the user's.
    expect(d.GetText()).toBe('10');
  });

  it('leaves the angle alone when keep-aligned is off', () => {
    const d = aligned(
      '(xy 0 0) (xy 10 0)',
      '0 0 33',
      STYLE.replace('(keep_text_aligned yes)', '(keep_text_aligned no)'),
    );
    d.Update();
    expect(d.GetTextAngle().AsDegrees()).toBe(33);
  });
});

describe('the kinds whose label the tool places, not the geometry', () => {
  const radial = (textAt: string): PCB_DIMENSION_BASE =>
    first(
      boardOf(`(dimension (type radial) (layer "Dwgs.User")
    (pts (xy 0 0) (xy 10 0)) (leader_length 3.81)
    (format (prefix "R ") (suffix "") (units 2) (units_format 0) (precision 4) (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (arrow_direction outward)
      (extension_offset 0.5) (keep_text_aligned yes))
    ${TEXT(textAt)})`),
    );

  it('leaves a radial label where the tool dragged it', () => {
    const d = radial('30 0 0');
    d.Update();
    expect(d.GetTextPos()).toEqual(P(30, 0));
    expect(d.GetText()).toBe('R 10');
  });

  it('angles a radial label along the line back to its knee', () => {
    // start (0,0) -> end (10,0), leader 3.81, so the knee is (13.81, 0) and the
    // text line to (30, 0) points along +x: EDA_ANGLE 0, 360-0 normalises to 0.
    const d = radial('30 0 0');
    d.Update();
    expect(d.GetTextAngle().AsDegrees()).toBe(0);
  });

  it('rounds a radial angle to the whole degree, unlike an aligned one', () => {
    // Knee (13.81, 0) to text (30, 10): atan2(10, 16.19) = 31.702...°, so
    // 360 - that = 328.297..., which is not in (90, 270] and stays. KiROUND
    // gives 328.
    const d = radial('30 10 0');
    d.Update();
    expect(d.GetTextAngle().AsDegrees()).toBe(328);
  });

  it('leaves a leader label alone but still re-derives its string', () => {
    const d = first(
      boardOf(`(dimension (type leader) (layer "Dwgs.User")
    (pts (xy 0 0) (xy 10 0))
    (format (prefix "") (suffix "") (units 0) (units_format 0) (precision 4) (override_value "Leader"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (text_frame 0) (extension_offset 0.5))
    ${TEXT('25 -3 12')})`),
    );
    d.Update();
    expect(d.GetTextPos()).toEqual(P(25, -3));
    expect(d.GetTextAngle().AsDegrees()).toBe(12);
    expect(d.GetText()).toBe('Leader');
  });
});

describe('the label knocking a gap out of the crossbar (CollectKnockedOutSegments, :119-147)', () => {
  /** The crossbar's pieces: the segments that lie on its line. */
  const bars = (d: PCB_DIM_ALIGNED) => {
    const y = d.GetCrossbarStart().y;
    return d
      .GetShapes()
      .filter((s): s is SHAPE_SEGMENT => s instanceof SHAPE_SEGMENT)
      .map((s) => s.GetSeg())
      .filter((s) => s.A.y === y && s.B.y === y);
  };

  it('leaves an OUTSIDE crossbar whole, because the label clears it', () => {
    // `textOffsetDistance = pen + text height` lifts the box off the bar.
    const d = aligned();
    d.Update();
    const b = bars(d);
    expect(b).toHaveLength(1);
    expect([b[0]!.A.x, b[0]!.B.x]).toEqual([0, MM(10)]);
  });

  it('cuts an INLINE crossbar in two, because the label sits on it', () => {
    const d = aligned(
      '(xy 0 0) (xy 10 0)',
      '0 0 0',
      STYLE.replace('(text_position_mode 0)', '(text_position_mode 1)'),
    );
    d.Update();
    const b = bars(d);
    expect(b).toHaveLength(2);
    // The two pieces start and end where the whole bar did, with a gap
    // around the label's centre between them.
    expect(b[0]!.A.x).toBe(0);
    expect(b[1]!.B.x).toBe(MM(10));
    expect(b[0]!.B.x).toBeLessThan(MM(5));
    expect(b[1]!.A.x).toBeGreaterThan(MM(5));
  });
});
