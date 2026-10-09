// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_TEXT over BOARD_ITEM + EDA_TEXT (`pcbnew/pcb_text.cpp`). Every expected
 * number below was read from KiCad's own `pcbnew` python module on the same
 * inputs (a default 2-copper BOARD as parent, the stroke font).
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';

const bbox = (t: PCB_TEXT): [number, number, number, number] => {
  const r = t.GetBoundingBox();
  return [r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()];
};

const mk = (text: string, pos: { x: number; y: number }): PCB_TEXT => {
  const t = new PCB_TEXT(new BOARD());
  t.SetLayer(PCB_LAYER_ID.F_SilkS);
  t.SetText(text);
  t.SetPosition(pos);
  t.SetTextSize({ x: 1000, y: 1000 });
  return t;
};

describe('PCB_TEXT', () => {
  it('HitTest within the glyph box; the box and the effective pen', () => {
    const t = mk('AB', { x: 8000, y: 8000 });
    expect(t.HitTest({ x: 8000, y: 8000 }, 0)).toBe(true);
    expect(t.HitTest({ x: 8000, y: 9000 }, 0)).toBe(false);
    expect(bbox(t)).toEqual([6984, 7195, 2033, 1610]);
    expect(t.GetTextThickness()).toBe(0);
    expect(t.GetEffectiveTextPenWidth()).toBe(125);
  });

  it('Move / Rotate move the anchor + angle', () => {
    const t = mk('X', { x: 100, y: 0 });
    t.Move({ x: 10, y: 20 });
    expect(t.GetPosition()).toEqual({ x: 110, y: 20 });
    t.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(t.GetPosition()).toEqual({ x: 20, y: -110 });
    expect(t.GetTextAngle().AsDegrees()).toBe(90);
  });

  it('Flip left-right mirrors X, negates angle, flips layer, toggles mirrored', () => {
    const t = mk('X', { x: 100, y: 0 });
    t.SetTextAngle(new EDA_ANGLE(30));
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetPosition()).toEqual({ x: -100, y: 0 });
    expect(t.GetTextAngle().AsDegrees()).toBe(-30);
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(t.IsMirrored()).toBe(true);
    expect(t.GetItemDescription(new UNITS_PROVIDER(pcbIUScale, 'mm'), true)).toBe(
      "PCB text 'X' on B.Silkscreen",
    );
    expect(bbox(t)).toEqual([-991, -979, 1782, 1958]);
    expect(t.GetShownText(true)).toBe('X');
  });

  it('Flip top-bottom mirrors Y and turns the angle into 180 minus it, not its negation', () => {
    // `SetTextAngle( ANGLE_180 - GetTextAngle() )` in the TOP_BOTTOM arm.
    const t = mk('X', { x: 0, y: 100 });
    t.SetTextAngle(new EDA_ANGLE(30));
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);
    expect(t.GetPosition()).toEqual({ x: 0, y: -100 });
    expect(t.GetTextAngle().AsDegrees()).toBe(150);
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
  });

  it('GetEffectiveShape: the stroke segments are integer (the VECTOR2D glyph points are static_cast)', () => {
    const t = new PCB_TEXT(new BOARD());
    t.SetText('The quick');
    t.SetPosition({ x: 0, y: 0 });
    const bb = t.GetEffectiveShape().BBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      -4554612, -761848, 8988273, 1852082,
    ]);
  });
});

describe('PCB_TEXT::GetDrawRotation (pcb_text.cpp:209-228)', () => {
  /** A user text on a footprint at the origin, at that angle, keep-upright as the file says. */
  const fpText = (angle: number, keepUpright: boolean): PCB_TEXT =>
    ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user))
  (net 0 "")
  (footprint "L:F" (layer "F.Cu") (at 0 0)
    (fp_text user "T" (at 0 0 ${angle}${keepUpright ? '' : ' unlocked'}) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15))))))`)
      .Footprints()[0]!
      .GraphicalItems()
      .find((t) => t.Type() === KICAD_T.PCB_TEXT_T) as PCB_TEXT;

  it('folds keep-upright footprint text into ]-90, 90]', () => {
    expect(fpText(270, true).IsKeepUpright()).toBe(true);
    expect(fpText(270, true).GetDrawRotation().AsDegrees()).toBe(90);
    expect(fpText(180, true).GetDrawRotation().AsDegrees()).toBe(0);
    expect(fpText(90, true).GetDrawRotation().AsDegrees()).toBe(90);
  });

  it('leaves board text at its stored angle, normalised', () => {
    const t = mk('T', { x: 0, y: 0 });
    t.SetTextAngle(new EDA_ANGLE(270));
    expect(t.GetDrawRotation().AsDegrees()).toBe(270);
  });
});

describe('EDA_TEXT::GetEffectiveTextPenWidth with no thickness of its own', () => {
  it('is GetPenSizeForNormal, size / 8, and GetPenSizeForBold, size / 5 (gr_text.cpp:37-48)', () => {
    const t = mk('T', { x: 0, y: 0 });
    t.SetTextSize({ x: 1_000_000, y: 1_000_000 });
    t.SetTextThickness(0);
    expect(t.GetEffectiveTextPenWidth()).toBe(125_000);
    t.SetBold(true);
    expect(t.GetEffectiveTextPenWidth()).toBe(200_000);
  });
});
