// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/common/test_eda_text.cpp`, transcribed. `std::hash<EDA_TEXT>` has
 * no port, so the hasher checks are not here; `Compare` is what they hash.
 */
import { describe, expect, it } from 'vitest';
import { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import { pcbIUScale, unityScale } from '@ziroeda/common/src/eda_units.js';
import { STRING_FORMATTER } from '@ziroeda/common/src/richio.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/font/text_attributes.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';

describe('EdaText', () => {
  it('Compare', () => {
    const a = new EDA_TEXT(unityScale);
    const b = new EDA_TEXT(unityScale);

    expect(a.Compare(b)).toBe(0);

    a.SetText('A');
    expect(a.Compare(b)).toBeGreaterThan(0);

    b.SetText('B');
    expect(a.Compare(b)).toBeLessThan(0);

    a.SetText('B');
    a.SetTextPos({ x: 1, y: 0 });
    expect(a.Compare(b)).toBeGreaterThan(0);

    a.SetTextPos({ x: -1, y: 0 });
    expect(a.Compare(b)).toBeLessThan(0);

    a.SetTextPos({ x: 0, y: 0 });
    b.SetTextPos({ x: 0, y: 1 });
    expect(a.Compare(b)).toBeLessThan(0);

    b.SetTextPos({ x: 0, y: -1 });
    expect(a.Compare(b)).toBeGreaterThan(0);

    // Text attributes are tested in the TEXT_ATTRIBUTES unit tests.
  });

  // ---- The rest pins behaviour the C++ suite leaves to its callers. ----

  it('the constructor sets DEFAULT_SIZE_TEXT (50 mils) in the scale it is given', () => {
    // 50 mils = 1.27 mm = 1 270 000 nm on a board, 12 700 in schematic units.
    expect(new EDA_TEXT(pcbIUScale).GetTextSize()).toEqual({ x: 1270000, y: 1270000 });
    expect(new EDA_TEXT(unityScale).GetTextSize()).toEqual({ x: 1, y: 1 });
  });

  it('SetTextSize clamps to [TEXT_MIN_SIZE_MM, TEXT_MAX_SIZE_MM] except at unityScale', () => {
    const t = new EDA_TEXT(pcbIUScale);
    t.SetTextSize({ x: 0, y: 1_000_000_000 });
    expect(t.GetTextSize()).toEqual({ x: 1000, y: 250_000_000 });

    t.SetTextSize({ x: 0, y: 1_000_000_000 }, false);
    expect(t.GetTextSize()).toEqual({ x: 0, y: 1_000_000_000 });

    // Plotting uses unityScale and independently scales the text.
    const u = new EDA_TEXT(unityScale);
    u.SetTextSize({ x: 0, y: 1_000_000_000 });
    expect(u.GetTextSize()).toEqual({ x: 0, y: 1_000_000_000 });
  });

  it('GetEffectiveTextPenWidth: bold/normal pen from the width, clamped to a quarter of the size', () => {
    const t = new EDA_TEXT(pcbIUScale);
    t.SetTextSize({ x: 1000000, y: 1000000 });
    expect(t.GetAutoThickness()).toBe(true);
    expect(t.GetEffectiveTextPenWidth()).toBe(125000); // size / 8
    expect(t.GetEffectiveTextPenWidth(150000)).toBe(150000); // the default pen wins over normal
    t.SetBoldFlag(true);
    expect(t.GetEffectiveTextPenWidth(150000)).toBe(200000); // bold ignores the default: size / 5
    t.SetTextThickness(400000);
    expect(t.GetEffectiveTextPenWidth()).toBe(250000); // clamped: size / 4
  });

  it('SetBold on a stroke font swaps the pen through m_StoredStrokeWidth', () => {
    const t = new EDA_TEXT(pcbIUScale);
    t.SetTextSize({ x: 1000000, y: 1000000 });
    t.SetTextThickness(90000);
    t.SetBold(true);
    expect(t.GetTextThickness()).toBe(200000);
    t.SetBold(false);
    expect(t.GetTextThickness()).toBe(90000);

    // Bold applied before the feature existed: unbolding falls back to the normal pen.
    const u = new EDA_TEXT(pcbIUScale);
    u.SetTextSize({ x: 1000000, y: 1000000 });
    u.SetBoldFlag(true);
    u.SetBold(false);
    expect(u.GetTextThickness()).toBe(125000);
  });

  it('GetShownText unescapes and HasTextVars sees ${ and @{', () => {
    const t = new EDA_TEXT(pcbIUScale, 'R{slash}1');
    expect(t.GetShownText(true)).toBe('R/1');
    expect(t.HasTextVars()).toBe(false);
    t.SetText('${REFERENCE}');
    expect(t.HasTextVars()).toBe(true);
    t.SetText('@{1+1}');
    expect(t.HasTextVars()).toBe(true);
  });

  it('GetTextBox: the C++ box for a centred single line, and the cache is keyed by position', () => {
    const t = new EDA_TEXT(pcbIUScale, 'A');
    t.SetTextSize({ x: 1000000, y: 1000000 });
    const box = t.GetTextBox(null);

    // Every number in this file's GetTextBox/TextHitTest cases is what KiCad 10.0.5's own
    // `PCB_TEXT::GetTextBox` returns for the same text through the pcbnew python module (a
    // 1 mm 'A' with the 125 000 nm auto pen): x -516071, y -804375, w 1032143, h 1608750.
    expect(box.GetWidth()).toBe(1032143);
    expect(box.GetHeight()).toBe(1608750);
    expect(box.GetX()).toBe(-516071);
    expect(box.GetY()).toBe(-804375);

    // Returned by value in C++: inflating the caller's copy must not touch the cache.
    box.Inflate(1000);
    expect(t.GetTextBox(null).GetWidth()).toBe(1032143);
    expect(t.GetTextBox(null)).not.toBe(box);
    t.SetTextPos({ x: 10, y: 0 });
    expect(t.GetTextBox(null)).not.toBe(box); // position changed: recomputed
    expect(t.GetTextBox(null).GetX()).toBe(-516061);
  });

  it('GetTextBox: every justification moves the box the C++ way', () => {
    const mk = (h: GR_TEXT_H_ALIGN_T, v: GR_TEXT_V_ALIGN_T, mirrored = false): [number, number] => {
      const t = new EDA_TEXT(pcbIUScale, 'A');
      t.SetTextSize({ x: 1000000, y: 1000000 });
      t.SetHorizJustify(h);
      t.SetVertJustify(v);
      t.SetMirrored(mirrored);
      const b = t.GetTextBox(null);
      return [b.GetX(), b.GetY()];
    };
    const {
      GR_TEXT_H_ALIGN_LEFT: L,
      GR_TEXT_H_ALIGN_CENTER: C,
      GR_TEXT_H_ALIGN_RIGHT: R,
    } = GR_TEXT_H_ALIGN_T;
    const {
      GR_TEXT_V_ALIGN_TOP: T,
      GR_TEXT_V_ALIGN_CENTER: M,
      GR_TEXT_V_ALIGN_BOTTOM: B,
    } = GR_TEXT_V_ALIGN_T;
    const fudge = 233750;

    expect(mk(L, T)).toEqual([0, -fudge]);
    expect(mk(R, T)).toEqual([-1032143, -fudge]);
    expect(mk(L, T, true)).toEqual([-1032143, -fudge]); // mirrored left reads as right
    expect(mk(R, T, true)).toEqual([0, -fudge]);
    expect(mk(C, B)).toEqual([-516071, -1608750 + fudge]);
    expect(mk(C, M)).toEqual([-516071, -804375]);
  });

  it('GetTextBox: multiline merges lines; a line index picks one', () => {
    const t = new EDA_TEXT(pcbIUScale, 'A\nAA');
    t.SetTextSize({ x: 1000000, y: 1000000 });
    t.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    t.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

    const all = t.GetTextBox(null);
    const line0 = t.GetTextBox(null, 0);
    const line1 = t.GetTextBox(null, 1);

    // KiCad: all = (0, -233750, 1889286 x 3218694); line 0 = (0, -233750, 1032143 x 1608750);
    // line 1 = (0, -1843694, 1889286 x 1608750). The interline is 1 609 944.
    expect([all.GetX(), all.GetY(), all.GetWidth(), all.GetHeight()]).toEqual([
      0, -233750, 1889286, 3218694,
    ]);
    expect([line0.GetX(), line0.GetY(), line0.GetWidth(), line0.GetHeight()]).toEqual([
      0, -233750, 1032143, 1608750,
    ]);
    expect([line1.GetX(), line1.GetY(), line1.GetWidth(), line1.GetHeight()]).toEqual([
      0, -1843694, 1889286, 1608750,
    ]);
    expect(all.GetHeight()).toBe(line0.GetHeight() + 1609944);
  });

  it('TextHitTest rotates the point into the text frame', () => {
    const t = new EDA_TEXT(pcbIUScale, 'A');
    t.SetTextSize({ x: 1000000, y: 1000000 });
    t.SetTextAngle(new EDA_ANGLE(90));
    // The box is ~1.2 mm wide and ~1.6 mm tall unrotated; rotated 90°, it is tall along X.
    expect(t.TextHitTest({ x: 0, y: 700000 })).toBe(false);
    expect(t.TextHitTest({ x: 700000, y: 0 })).toBe(true);
    expect(t.TextHitTest({ x: 0, y: 700000 }, 100000)).toBe(false); // KiCad: still outside
    expect(t.TextHitTest({ x: 0, y: 700000 }, 200000)).toBe(true); // inflated past the half-width
  });

  it('Format writes the (effects ...) block exactly as EDA_TEXT::Format', () => {
    const t = new EDA_TEXT(pcbIUScale, 'x');
    const out = new STRING_FORMATTER();
    t.Format(out, 0);
    expect(out.GetString()).toBe('(effects(font(size 1.27 1.27)))');

    t.SetTextThickness(150000);
    t.SetBoldFlag(true);
    t.SetItalicFlag(true);
    t.SetMirrored(true);
    t.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    t.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
    t.SetLineSpacing(1.5);
    t.SetHyperlink('https://kicad.org');
    t.SetTextColor({ r: 1, g: 0.5, b: 0, a: 1 });
    out.Clear();
    t.Format(out, 0);
    expect(out.GetString()).toBe(
      '(effects(font(size 1.27 1.27)(line_spacing 1.5)(thickness 0.15)(bold yes)(italic yes)(color 255 128 0 1))(justify left bottom mirror)(href "https://kicad.org"))',
    );
  });

  it('IsDefaultFormatting / GetTextStyleName', () => {
    const t = new EDA_TEXT(pcbIUScale);
    expect(t.IsDefaultFormatting()).toBe(false); // multiline defaults to allowed
    t.SetMultilineAllowed(false);
    expect(t.IsDefaultFormatting()).toBe(true);
    expect(t.GetTextStyleName()).toBe('Normal');
    t.SetBoldFlag(true);
    expect(t.GetTextStyleName()).toBe('Bold');
    t.SetItalicFlag(true);
    expect(t.GetTextStyleName()).toBe('Bold+Italic');
    expect(t.IsDefaultFormatting()).toBe(false);
  });

  it('Levenshtein and Similarity', () => {
    const a = new EDA_TEXT(pcbIUScale, 'kitten');
    const b = new EDA_TEXT(pcbIUScale, 'sitting');
    expect(a.Levenshtein(b)).toBeCloseTo(1 - 3 / 7, 12);
    expect(a.Similarity(b)).toBeCloseTo(1 - 3 / 7, 12);
    b.SetTextPos({ x: 1, y: 1 });
    expect(a.Similarity(b)).toBeCloseTo(0.9 * (1 - 3 / 7), 12);
    b.SetBoldFlag(true);
    expect(a.Similarity(b)).toBeCloseTo(0.81 * (1 - 3 / 7), 12);
    expect(new EDA_TEXT(pcbIUScale).Levenshtein(a)).toBe(0);
  });

  it('ValidateHyperlink / IsGotoPageHref / GotoPageHref', () => {
    expect(EDA_TEXT.ValidateHyperlink('')).toBe(true);
    expect(EDA_TEXT.ValidateHyperlink('#3')).toBe(true);
    expect(EDA_TEXT.ValidateHyperlink('https://kicad.org')).toBe(true);
    expect(EDA_TEXT.ValidateHyperlink('file:///tmp/x')).toBe(true);
    expect(EDA_TEXT.ValidateHyperlink('kicad.org')).toBe(false);
    expect(EDA_TEXT.ValidateHyperlink('3com:x')).toBe(false); // a scheme starts with a letter

    const dest = { value: '' };
    expect(EDA_TEXT.IsGotoPageHref('#12', dest)).toBe(true);
    expect(dest.value).toBe('12');
    expect(EDA_TEXT.IsGotoPageHref('12')).toBe(false);
    expect(EDA_TEXT.GotoPageHref('7')).toBe('#7');
  });

  it('GetEffectiveTextShape: a stroke text is SHAPE_SEGMENTs at the effective pen width', () => {
    const t = new EDA_TEXT(pcbIUScale, 'I');
    t.SetTextSize({ x: 1000000, y: 1000000 });
    const shape = t.GetEffectiveTextShape();
    // 'I' in newstroke is a single stroke: one segment.
    expect(shape.Size()).toBe(1);
    const seg = shape.Shapes()[0]!;
    expect(seg.Type()).toBe(1); // SH_SEGMENT
    expect((seg as { GetWidth(): number }).GetWidth()).toBe(125000);
  });

  it('SetAttributes / SwapAttributes / SwapText / CopyText', () => {
    const a = new EDA_TEXT(pcbIUScale, 'a');
    const b = new EDA_TEXT(pcbIUScale, 'b');
    b.SetTextPos({ x: 5, y: 6 });
    b.SetBoldFlag(true);

    a.SetAttributes(b, false);
    expect(a.IsBold()).toBe(true);
    expect(a.GetTextPos()).toEqual({ x: 0, y: 0 });
    a.SetAttributes(b);
    expect(a.GetTextPos()).toEqual({ x: 5, y: 6 });

    a.SetBoldFlag(false);
    a.SwapAttributes(b);
    expect(a.IsBold()).toBe(true);
    expect(b.IsBold()).toBe(false);

    a.SwapText(b);
    expect(a.GetText()).toBe('b');
    expect(b.GetText()).toBe('a');
    a.CopyText(b);
    expect(a.GetText()).toBe('a');
  });

  it('MapHorizJustify / MapVertJustify clamp out-of-range values', () => {
    expect(EDA_TEXT.MapHorizJustify(-7)).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    expect(EDA_TEXT.MapHorizJustify(7)).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    expect(EDA_TEXT.MapHorizJustify(0)).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
    expect(EDA_TEXT.MapVertJustify(-7)).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
    expect(EDA_TEXT.MapVertJustify(7)).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
  });
});
