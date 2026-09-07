// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The label a dimension shows, and where it sits.
 * Counterparts: `PCB_DIMENSION_BASE::GetValueText` / `::updateText` and the five
 * `PCB_DIM_*::updateText` overrides (pcbnew/pcb_dimension.cpp).
 *
 * The anchor for the placement half is a dimension **KiCad itself wrote**:
 * `demos/cm5_minima` contains an orthogonal one whose `(gr_text …)` child is
 * `(at 125.3 43.975 90)`. Every one of those three numbers is derivable from its
 * feature points and style, so re-deriving them and comparing against the file
 * checks the port against KiCad's own arithmetic rather than against ours.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  dimensionSegments,
  hitTestDimension,
  knockOutSegment,
  textKnockoutPoly,
} from '@ziroeda/pcbnew/src/dimension_geometry.js';
import {
  dimensionDisplayText,
  dimensionUnits,
  dimensionValueText,
  updateDimension,
} from '@ziroeda/pcbnew/src/dimension_text.js';
import type { PcbDimension, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): { x: number; y: number } => ({ x: MM(x), y: MM(y) });

const EMPTY = { kind: 'list' as const, items: [] };

const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'user',
  text: '',
  at: P(0, 0),
  angle: 0,
  layer: 'Dwgs.User',
  size: { x: MM(1), y: MM(1) },
  thickness: MM(0.15),
  source: EMPTY,
  ...over,
});

/** A 10 mm horizontal aligned dimension with a crossbar 5 mm above it. */
const aligned = (over: Partial<PcbDimension> = {}): PcbDimension => ({
  kind: 'aligned',
  layer: 'Dwgs.User',
  start: P(0, 0),
  end: P(10, 0),
  height: MM(5),
  style: {
    thickness: MM(0.1),
    arrowLength: MM(1.27),
    textPositionMode: 0,
    extensionOffset: MM(0.5),
    extensionHeight: MM(0.58642),
    arrowDirection: 'outward',
    keepTextAligned: true,
  },
  format: {
    prefix: '',
    suffix: '',
    units: 2, // MM
    unitsFormat: 0,
    precision: 4,
    suppressZeroes: true,
  },
  text: text(),
  source: EMPTY,
  ...over,
});

const withFormat = (d: PcbDimension, over: Partial<NonNullable<PcbDimension['format']>>) => ({
  ...d,
  format: { ...d.format!, ...over },
});

describe('which units the value is shown in', () => {
  it('reads the four DIM_UNITS_MODE members', () => {
    const d = aligned();
    expect(dimensionUnits(withFormat(d, { units: 0 }))).toBe('in');
    expect(dimensionUnits(withFormat(d, { units: 1 }))).toBe('mils');
    expect(dimensionUnits(withFormat(d, { units: 2 }))).toBe('mm');
  });

  it('takes AUTOMATIC from the frame, not from a constant', () => {
    // `m_units = GetBoard() ? GetBoard()->GetUserUnits() : EDA_UNITS::MM`.
    const d = withFormat(aligned(), { units: 3 });
    expect(dimensionUnits(d, 'in')).toBe('in');
    expect(dimensionUnits(d, 'mils')).toBe('mils');
    expect(dimensionUnits(d)).toBe('mm'); // the no-board fallback
  });
});

describe('the measured value as a string', () => {
  it('prints the distance at the requested precision', () => {
    // 10 mm at X_XXXX, zeroes kept.
    expect(dimensionValueText(withFormat(aligned(), { suppressZeroes: false }))).toBe('10.0000');
  });

  it('converts to the chosen unit', () => {
    // 10 mm is 10/25.4 in and 10000/25.4 mils.
    const d = aligned();
    expect(dimensionValueText(withFormat(d, { units: 0, suppressZeroes: false }))).toBe('0.3937');
    expect(dimensionValueText(withFormat(d, { units: 1, suppressZeroes: false }))).toBe('393.7008');
  });

  it('strips the trailing zeroes when asked', () => {
    expect(dimensionValueText(aligned())).toBe('10');
  });

  it('stops at the decimal point rather than eating real digits', () => {
    // 10.5 mm -> "10.5000" -> "10.5"; the loop breaks the moment it eats a '.'.
    expect(dimensionValueText(aligned({ end: P(10.5, 0) }))).toBe('10.5');
  });

  it('mirrors upstream and eats a whole-number zero at precision X', () => {
    // `while( text.EndsWith( '0' ) )` runs before any decimal point exists, so
    // "10" becomes "1" and the loop then stops. This is a KiCad 10.0.5 quirk,
    // reproduced deliberately: re-deriving a "sensible" answer would be a
    // divergence a user could see by placing the same dimension in both.
    expect(dimensionValueText(withFormat(aligned(), { precision: 0 }))).toBe('1');
    // Without suppression the same value keeps its zero.
    expect(dimensionValueText(withFormat(aligned(), { precision: 0, suppressZeroes: false }))).toBe(
      '10',
    );
  });

  it('rebases the significant-digit precisions per unit', () => {
    // `precision >= 6` is the V_VV family, which means one physical resolution
    // rather than one digit count: inch loses 4, mm loses 5, mils loses 7 with a
    // floor of 0.
    const keep = { precision: 6 as const, suppressZeroes: false };
    expect(dimensionValueText(withFormat(aligned(), { ...keep, units: 2 }))).toBe('10.0'); // 6-5
    expect(dimensionValueText(withFormat(aligned(), { ...keep, units: 0 }))).toBe('0.39'); // 6-4
    expect(dimensionValueText(withFormat(aligned(), { ...keep, units: 1 }))).toBe('394'); // max(0,6-7)
  });
});

describe('the whole displayed string', () => {
  it('adds no suffix in NO_SUFFIX', () => {
    expect(dimensionDisplayText(aligned())).toBe('10');
  });

  it('adds a bare suffix, leading space included', () => {
    expect(dimensionDisplayText(withFormat(aligned(), { unitsFormat: 1 }))).toBe('10 mm');
  });

  it('parenthesises the suffix with its leading space trimmed', () => {
    expect(dimensionDisplayText(withFormat(aligned(), { unitsFormat: 2 }))).toBe('10 (mm)');
  });

  it('wraps the prefix and suffix outside the unit label', () => {
    const d = withFormat(aligned(), { unitsFormat: 1, prefix: 'R ', suffix: ' typ.' });
    expect(dimensionDisplayText(d)).toBe('R 10 mm typ.');
  });

  it('shows the override instead of the measurement', () => {
    expect(dimensionDisplayText(withFormat(aligned(), { overrideValue: 'DNP' }))).toBe('DNP');
  });

  it('still puts a unit suffix on an override', () => {
    // `text = m_overrideTextEnabled ? m_valueString : GetValueText()` happens
    // *before* the format switch, so the suffix lands on typed text too. This
    // is why `startDimension` gives a leader NO_SUFFIX: a leader is an override
    // by construction, and any other format would append units to a label.
    const d = withFormat(aligned(), { overrideValue: 'Leader', unitsFormat: 1 });
    expect(dimensionDisplayText(d)).toBe('Leader mm');
  });

  it('distinguishes an empty override from an absent one', () => {
    expect(dimensionDisplayText(withFormat(aligned(), { overrideValue: '' }))).toBe('');
    expect(dimensionDisplayText(withFormat(aligned(), { overrideValue: undefined }))).toBe('10');
  });
});

describe('where the label lands, against a dimension KiCad wrote', () => {
  // Verbatim from demos/cm5_minima. Every number in the `(gr_text …)` line is
  // derived, so it is a fixed point for the whole placement port.
  const CM5 = `(kicad_pcb (version 20241229) (generator "test")
    (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user))
    (net 0 "")
    (dimension
      (type orthogonal)
      (layer "Dwgs.User")
      (pts (xy 113.6 58.975) (xy 113.35 28.975))
      (height 12.85)
      (orientation 1)
      (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4)
        (suppress_zeroes yes))
      (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
        (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
        (keep_text_aligned yes))
      (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User")
        (effects (font (size 1 1) (thickness 0.15))))))`;

  const fromFile = (): PcbDimension => readBoard(parse(CM5)).dimensions[0]!;

  it('re-derives the position KiCad stored, to the nanometre', () => {
    // Crossbar runs (126.45, 58.975) -> (126.45, 28.975); its centre offset is
    // (0, -15). x == 0, so the rotation is 90 * sign(15) = +90, which sends
    // (0, -15) to (-15, 0); resized to pen (0.15) + text height (1) = 1.15 that
    // is (-1.15, 0). Text pos = crossbar start + (0, -15) + (-1.15, 0).
    const d = updateDimension(fromFile());
    expect(d.text!.at).toEqual(P(125.3, 43.975));
  });

  it('re-derives the angle KiCad stored', () => {
    // EDA_ANGLE((0, -15)) is -90; 360 - (-90) normalises to 90, which is not in
    // (90, 270], so it is kept.
    expect(updateDimension(fromFile()).text!.angle).toBe(90);
  });

  it('re-derives the string KiCad stored', () => {
    // 30 mm at X_XXXX with zeroes suppressed. The file says "30".
    expect(updateDimension(fromFile(), 'mm').text!.text).toBe('30');
  });

  it('follows the units the frame is showing, because the file says AUTOMATIC', () => {
    // (units 3). 30 mm is 1.1811023... in, and X_XXXX with zeroes suppressed
    // gives "1.1811".
    expect(updateDimension(fromFile(), 'in').text!.text).toBe('1.1811');
  });
});

describe('the aligned placement in each direction', () => {
  // textOffsetDistance is pen (0.15, under the 0.25 * 1 clamp) + height (1).
  const D = MM(1.15);

  it('hangs the label above a left-to-right bar', () => {
    // Crossbar (0,5) -> (10,5); centre offset (5,0). x > 0 so rotation is +90,
    // sending (5,0) to (0,-5), resized to (0,-D). Pos = (0,5) + (5,0) + (0,-D).
    const d = updateDimension(aligned());
    expect(d.text!.at).toEqual({ x: MM(5), y: MM(5) - D });
    expect(d.text!.angle).toBe(0);
  });

  it('hangs it to the left of a top-to-bottom bar, reading upwards', () => {
    // start (0,0) -> end (0,10), height 5. Extension is (-10,0), so the bar runs
    // (-5,0) -> (-5,10) and the centre offset is (0,5). x == 0 so the rotation
    // is 90 * sign(-5) = -90, sending (0,5) to (-5,0), resized to (-D,0).
    const d = updateDimension(aligned({ end: P(0, 10) }));
    expect(d.text!.at).toEqual({ x: MM(-5) - D, y: MM(5) });
    // EDA_ANGLE((0,5)) = 90; 360-90 = 270, which is in (90,270], so 270-180.
    expect(d.text!.angle).toBe(90);
  });

  it('sits the label on the bar in INLINE mode', () => {
    const d = aligned();
    const out = updateDimension({ ...d, style: { ...d.style, textPositionMode: 1 } });
    expect(out.text!.at).toEqual(P(5, 5));
  });

  it('leaves a manually placed label exactly where it was put', () => {
    const d = aligned({ text: text({ at: P(42, 7) }) });
    const out = updateDimension({ ...d, style: { ...d.style, textPositionMode: 2 } });
    expect(out.text!.at).toEqual(P(42, 7));
    // The string is still re-derived; only the position is the user's.
    expect(out.text!.text).toBe('10');
  });

  it('leaves the angle alone when keep-aligned is off', () => {
    const d = aligned({ text: text({ angle: 33 }) });
    const out = updateDimension({ ...d, style: { ...d.style, keepTextAligned: false } });
    expect(out.text!.angle).toBe(33);
  });
});

describe('the orthogonal override upstream never reaches', () => {
  // `PCB_DIM_ORTHOGONAL::updateText` computes a position and angle and then
  // calls `PCB_DIM_ALIGNED::updateText`, which overwrites both — so only the
  // aligned formula ever runs. It is only safe to skip the dead branch if the
  // two agree on an axis-aligned crossbar, which is the one input orthogonal
  // ever has. This checks that claim in all four directions, against the
  // orthogonal formula written out independently from the C++.
  const orthogonalFormula = (d: PcbDimension): { x: number; y: number } => {
    const horizontal = (d.orientation ?? 0) !== 1;
    const height = d.height ?? 0;
    const ext = horizontal ? { x: 0, y: height } : { x: height, y: 0 };
    const n = Math.hypot(ext.x, ext.y);
    const barStart = {
      x: d.start.x + (n === 0 ? 0 : (ext.x / n) * Math.abs(height)),
      y: d.start.y + (n === 0 ? 0 : (ext.y / n) * Math.abs(height)),
    };
    const barEnd = horizontal ? { x: d.end.x, y: barStart.y } : { x: barStart.x, y: d.end.y };
    const cc = { x: (barEnd.x - barStart.x) / 2, y: (barEnd.y - barStart.y) / 2 };
    // textOffset.y = -distance for HORIZONTAL, textOffset.x = -distance for
    // VERTICAL, then `textOffset += crossbarCenter`.
    const dist = MM(1.15);
    const off = horizontal ? { x: 0, y: -dist } : { x: -dist, y: 0 };
    return { x: barStart.x + off.x + cc.x, y: barStart.y + off.y + cc.y };
  };

  const ortho = (over: Partial<PcbDimension>): PcbDimension =>
    aligned({ kind: 'orthogonal', orientation: 0, ...over });

  const cases: Array<[string, PcbDimension]> = [
    ['bar to the right', ortho({ start: P(0, 0), end: P(10, 3), height: MM(5) })],
    ['bar to the left', ortho({ start: P(0, 0), end: P(-10, 3), height: MM(5) })],
    ['bar downwards', ortho({ start: P(0, 0), end: P(3, 10), orientation: 1, height: MM(5) })],
    ['bar upwards', ortho({ start: P(0, 0), end: P(3, -10), orientation: 1, height: MM(5) })],
  ];

  for (const [name, d] of cases) {
    it(`agrees with the aligned formula, ${name}`, () => {
      expect(updateDimension(d).text!.at).toEqual(orthogonalFormula(d));
    });
  }
});

describe('the kinds whose label the tool places, not the geometry', () => {
  const radial = (over: Partial<PcbDimension> = {}): PcbDimension => ({
    ...aligned(),
    kind: 'radial',
    height: undefined,
    leaderLength: MM(3.81),
    style: { ...aligned().style, keepTextAligned: true, extensionHeight: undefined },
    format: { ...aligned().format!, prefix: 'R ' },
    text: text({ at: P(30, 0) }),
    ...over,
  });

  it('leaves a radial label where the tool dragged it', () => {
    const out = updateDimension(radial());
    expect(out.text!.at).toEqual(P(30, 0));
    expect(out.text!.text).toBe('R 10');
  });

  it('angles a radial label along the line back to its knee', () => {
    // start (0,0) -> end (10,0), leader 3.81, so the knee is (13.81, 0) and the
    // text line to (30, 0) points along +x: EDA_ANGLE 0, 360-0 normalises to 0.
    expect(updateDimension(radial()).text!.angle).toBe(0);
  });

  it('rounds a radial angle to the whole degree, unlike an aligned one', () => {
    // Knee (13.81, 0) to text (30, 10): atan2(10, 16.19) = 31.702...°, so
    // 360 - that = 328.297..., which is not in (90, 270] and stays. KiROUND
    // gives 328.
    const out = updateDimension(radial({ text: text({ at: P(30, 10) }) }));
    expect(out.text!.angle).toBe(328);
  });

  it('leaves a leader label alone but still re-derives its string', () => {
    const d: PcbDimension = {
      ...aligned(),
      kind: 'leader',
      height: undefined,
      style: { ...aligned().style, textFrame: 0, keepTextAligned: undefined },
      format: { ...aligned().format!, units: 0, unitsFormat: 0, overrideValue: 'Leader' },
      text: text({ at: P(25, -3), angle: 12 }),
    };
    const out = updateDimension(d);
    expect(out.text!.at).toEqual(P(25, -3));
    expect(out.text!.angle).toBe(12);
    expect(out.text!.text).toBe('Leader');
  });

  it('leaves a centre mark alone, since it carries no text item at all', () => {
    const d: PcbDimension = {
      kind: 'center',
      layer: 'F.SilkS',
      start: P(0, 0),
      end: P(0, 3.5),
      style: {
        thickness: MM(0.1),
        arrowLength: MM(1.27),
        textPositionMode: 0,
        extensionOffset: MM(0.5),
      },
      source: EMPTY,
    };
    expect(updateDimension(d)).toBe(d);
  });
});

describe('the label knocking a gap out of the line', () => {
  // `CollectKnockedOutSegments` (pcb_dimension.cpp:119-147). A square 10 mm
  // across the middle of a horizontal segment is easy to reason about without
  // any font metrics in the way.
  const square = (cx: number, cy: number, half: number) => [
    { x: MM(cx - half), y: MM(cy - half) },
    { x: MM(cx - half), y: MM(cy + half) },
    { x: MM(cx + half), y: MM(cy + half) },
    { x: MM(cx + half), y: MM(cy - half) },
  ];

  it('splits a segment in two when the box sits across its middle', () => {
    const out = knockOutSegment(square(10, 0, 2), { a: P(0, 0), b: P(20, 0) });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ a: P(0, 0), b: P(8, 0) });
    expect(out[1]).toEqual({ a: P(12, 0), b: P(20, 0) });
  });

  it('leaves the segment whole when the box is nowhere near it', () => {
    const s = { a: P(0, 0), b: P(20, 0) };
    expect(knockOutSegment(square(10, 40, 2), s)).toEqual([s]);
  });

  it('keeps only the outside piece when one end is buried in the box', () => {
    // A starts inside, so `segPolyIntersection` from A returns nothing and only
    // the walk back from B survives.
    const out = knockOutSegment(square(0, 0, 2), { a: P(0, 0), b: P(20, 0) });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ a: P(2, 0), b: P(20, 0) });
  });

  it('drops the segment entirely when it is swallowed', () => {
    expect(knockOutSegment(square(10, 0, 8), { a: P(8, 0), b: P(12, 0) })).toEqual([]);
  });

  it('does nothing at all for a dimension with no label', () => {
    // A centre mark carries no text item, so there is no box to cut with.
    const s = { a: P(0, 0), b: P(20, 0) };
    expect(knockOutSegment(null, s)).toEqual([s]);
  });

  it('keeps a zero-length segment that misses the box', () => {
    // The last line of `CollectKnockedOutSegments`, `if( !containsA &&
    // !containsB && !endpointA && !endpointB )`, looks like the ordinary
    // "nothing was cut" case but is not: a segment that merely misses the box
    // comes back through the endpointA branch, because `segPolyIntersection`
    // falls back to the *far end* when it finds no crossing. The only way for
    // both walks to return nothing with neither end inside is a segment with no
    // length, and without that line it would vanish.
    const s = { a: P(0, 0), b: P(0, 0) };
    expect(knockOutSegment(square(10, 40, 2), s)).toEqual([s]);
  });
});

describe('the shape of the box the label is cut out with', () => {
  // These are relationships rather than magic numbers: the glyph box comes from
  // the stroke font, but what each kind does *to* that box does not.
  const penOf = (d: PcbDimension): number => {
    // Same rule as EDA_TEXT: a set thickness wins, clamped to a quarter of the
    // smaller text dimension. 0.15 against a 1 mm box is well under 0.25.
    void d;
    return MM(0.15);
  };
  const height = (poly: { x: number; y: number }[]): number =>
    Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y));
  const width = (poly: { x: number; y: number }[]): number =>
    Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x));

  it('deflates an aligned box vertically but inflates an orthogonal one', () => {
    // `Inflate( GetTextWidth() / 2, -GetEffectiveTextPenWidth() )` for aligned
    // against `Inflate( GetTextWidth() / 2, GetEffectiveTextPenWidth() )` for
    // orthogonal — the sign differs between two call sites four hundred lines
    // apart, and it is the easiest thing in this file to copy wrongly. Whatever
    // the font makes the raw box, the two must differ by four pen widths.
    const d = updateDimension(aligned());
    const a = textKnockoutPoly(d)!;
    const o = textKnockoutPoly(updateDimension({ ...d, kind: 'orthogonal', orientation: 0 }))!;

    expect(height(o) - height(a)).toBe(4 * penOf(d));
    // Horizontally they agree: both inflate by GetTextWidth() / 2.
    expect(width(o)).toBe(width(a));
  });

  it('inflates a leader box by twice the pen', () => {
    const d = updateDimension(aligned());
    const a = textKnockoutPoly(d)!;
    const l = textKnockoutPoly(updateDimension({ ...d, kind: 'leader' }))!;

    // -pen against +2*pen is a difference of 3 on each side.
    expect(height(l) - height(a)).toBe(6 * penOf(d));
  });

  it('turns the box with the label, so a rotated label cuts on its own axes', () => {
    // `polyBox.Rotate( GetTextAngle(), textBox.GetCenter() )`. A quarter turn
    // swaps the extents; without the rotation an upright box would be left
    // cutting the wrong side of a vertical crossbar.
    const flat = updateDimension(aligned());
    const turned = { ...flat, text: { ...flat.text!, angle: 90 } };

    const a = textKnockoutPoly(flat)!;
    const b = textKnockoutPoly(turned)!;

    expect(width(b)).toBe(height(a));
    expect(height(b)).toBe(width(a));
  });

  it('turns it about the box centre, not about the text anchor', () => {
    // `polyBox.Rotate( GetTextAngle(), textBox.GetCenter() )` — turning about
    // the centre is the one thing that leaves the centre where it was.
    //
    // A centred label cannot show the difference: `GetTextBox` puts a
    // CENTER/CENTER box symmetrically on its anchor, so the two rotation
    // centres coincide and either reading gives the same polygon. The dialog's
    // justification radio buttons are what make them differ —
    // `aTarget->SetHorizJustify( GR_TEXT_H_ALIGN_LEFT )` hangs the box off to
    // one side of the anchor, and rotating about the anchor then slides the box
    // half its width as well as turning it.
    const mid = (poly: { x: number; y: number }[]) => ({
      x: (Math.min(...poly.map((p) => p.x)) + Math.max(...poly.map((p) => p.x))) / 2,
      y: (Math.min(...poly.map((p) => p.y)) + Math.max(...poly.map((p) => p.y))) / 2,
    });

    const base = updateDimension(aligned());
    const flat = { ...base, text: { ...base.text!, justify: ['left'] } };
    const turned = { ...flat, text: { ...flat.text, angle: 90 } };

    const before = mid(textKnockoutPoly(flat)!);
    const after = mid(textKnockoutPoly(turned)!);

    // Whole-IU rounding of each corner can move a midpoint by half a unit.
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    // The box really is off the anchor here, so the two readings are not the
    // same polygon and the check above has something to catch.
    expect(before.x - flat.text.at.x).toBeGreaterThan(MM(0.5));
  });
});

describe('which line the gap actually appears in', () => {
  it('leaves an OUTSIDE crossbar whole, because the label clears it', () => {
    // The default. `textOffsetDistance = pen + text height` lifts the box off
    // the bar, so nothing is cut and the bar is one segment — extension lines,
    // one crossbar, four arrow arms.
    const d = updateDimension(aligned());
    const bars = dimensionSegments(d).filter((s) => s.a.y === MM(5) && s.b.y === MM(5));
    expect(bars).toHaveLength(1);
    expect(bars[0]).toEqual({ a: P(0, 5), b: P(10, 5) });
  });

  it('cuts an INLINE crossbar in two, because the label sits on it', () => {
    // This is what the knockout exists for: INLINE puts the text pos on the bar
    // itself, so the bar has to go round it.
    const base = aligned();
    const d = updateDimension({ ...base, style: { ...base.style, textPositionMode: 1 } });
    const bars = dimensionSegments(d).filter((s) => s.a.y === MM(5) && s.b.y === MM(5));

    expect(bars).toHaveLength(2);
    // The two pieces start and end where the whole bar did...
    expect(bars[0]!.a).toEqual(P(0, 5));
    expect(bars[1]!.b).toEqual(P(10, 5));
    // ...and the gap between them is exactly the label's box.
    const poly = textKnockoutPoly(d)!;
    expect(bars[0]!.b.x).toBe(Math.min(...poly.map((p) => p.x)));
    expect(bars[1]!.a.x).toBe(Math.max(...poly.map((p) => p.x)));
  });

  it('cuts a vertical INLINE crossbar on the turned box, not an upright one', () => {
    // The label of a vertical dimension is rotated 90 degrees, so the box that
    // cuts the bar is turned with it. An unrotated box would open a gap the
    // width of the glyphs instead of their height.
    const base = aligned({ end: P(0, 10) });
    const d = updateDimension({ ...base, style: { ...base.style, textPositionMode: 1 } });
    expect(d.text!.angle).toBe(90);

    const bars = dimensionSegments(d).filter((s) => s.a.x === MM(-5) && s.b.x === MM(-5));
    expect(bars).toHaveLength(2);

    const poly = textKnockoutPoly(d)!;
    expect(bars[0]!.b.y).toBe(Math.min(...poly.map((p) => p.y)));
    expect(bars[1]!.a.y).toBe(Math.max(...poly.map((p) => p.y)));
    // The gap runs along the bar, so it is the box's *turned* extent.
    const gap = bars[1]!.a.y - bars[0]!.b.y;
    expect(gap).toBe(Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y)));
  });

  it('still lets a click on the number select the dimension', () => {
    // `PCB_DIMENSION_BASE::HitTest` tries `TextHitTest` before the shapes. With
    // the bar now cut away from under the glyphs, that branch is the only thing
    // holding an INLINE dimension together for a click on its value.
    const base = aligned();
    const d = updateDimension({ ...base, style: { ...base.style, textPositionMode: 1 } });
    expect(hitTestDimension(d, d.text!.at)).toBe(true);
  });
});
