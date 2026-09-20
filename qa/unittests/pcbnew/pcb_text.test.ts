// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_TEXT over BOARD_ITEM + EDA_TEXT (`pcbnew/pcb_text.cpp`). Every expected
 * number below was read from KiCad's own `pcbnew` python module on the same
 * inputs (a default 2-copper BOARD as parent, the stroke font).
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';

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
