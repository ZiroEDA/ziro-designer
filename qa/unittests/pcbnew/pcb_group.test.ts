// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_GROUP over BOARD_ITEM + EDA_GROUP (`pcbnew/pcb_group.cpp`). Every
 * expected number below was read from KiCad's own `pcbnew` python module on
 * the same inputs (a default 2-copper BOARD, a 0.2 mm F.Cu track from
 * (1,2) mm to (5,2) mm and a 0.8/0.4 mm through via at (7,4) mm), not
 * derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PCB_GROUP } from '@ziroeda/pcbnew/pcb_group.js';
import { PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';

const box = (g: PCB_GROUP): [number, number, number, number] => {
  const r = g.GetBoundingBox();
  return [r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()];
};

function fixture(): { b: BOARD; t: PCB_TRACK; v: PCB_VIA; g: PCB_GROUP } {
  const b = new BOARD();
  const t = new PCB_TRACK(b);
  t.SetStart({ x: 1000000, y: 2000000 });
  t.SetEnd({ x: 5000000, y: 2000000 });
  t.SetWidth(200000);
  t.SetLayer(PCB_LAYER_ID.F_Cu);
  b.Add(t);
  const v = new PCB_VIA(b);
  v.SetPosition({ x: 7000000, y: 4000000 });
  v.SetWidth(800000);
  v.SetDrill(400000);
  b.Add(v);
  const g = new PCB_GROUP(b);
  b.Add(g);
  g.AddItem(t);
  g.AddItem(v);
  return { b, t, v, g };
}

describe('PCB_GROUP', () => {
  it('is a PCB_GROUP_T BOARD_ITEM that is also an EDA_GROUP', () => {
    const { g, t, v } = fixture();
    expect(g.Type()).toBe(KICAD_T.PCB_GROUP_T);
    expect(g.GetClass()).toBe('PCB_GROUP');
    expect(PCB_GROUP.ClassOf(g)).toBe(true);
    expect(g.AsEdaItem()).toBe(g);
    expect(g.GetItems().size).toBe(2);
    expect(t.GetParentGroup()).toBe(g);
    expect(v.GetParentGroup()).toBe(g);
    expect(g.GetBoardItems().has(t)).toBe(true);
    expect(g.IsOnCopperLayer()).toBe(false);
  });

  it('GetBoundingBox merges the members and inflates 0.25 mm; GetPosition is its centre', () => {
    const { g, b } = fixture();
    expect(box(g)).toEqual([650000, 1650000, 7000001, 3000001]);
    expect(g.GetPosition()).toEqual({ x: 4150000, y: 3150000 });

    const empty = new PCB_GROUP(b);
    expect(box(empty)).toEqual([-250000, -250000, 500000, 500000]);
    expect(empty.GetPosition()).toEqual({ x: 0, y: 0 });
  });

  it('GetLayerSet and IsOnLayer are the union over the members', () => {
    const { g, b } = fixture();
    expect(
      g
        .GetLayerSet()
        .Seq()
        .map((l) => b.GetLayerName(l)),
    ).toEqual(['F.Cu', 'B.Cu']);
    expect(g.IsOnLayer(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(g.IsOnLayer(PCB_LAYER_ID.B_Cu)).toBe(true);
    expect(g.IsOnLayer(PCB_LAYER_ID.F_Mask)).toBe(false);
    g.SetLayer(PCB_LAYER_ID.B_Cu); // NOP
    expect(g.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
  });

  it('descriptions and the message panel', () => {
    const { g } = fixture();
    expect(g.GetItemDescription(null, true)).toBe('Unnamed Group, 2 members');
    g.SetName('power');
    expect(g.GetItemDescription(null, true)).toBe("Group 'power', 2 members");
  });

  it('Move/SetPosition move the members; HitTest is always false (selection is promoted)', () => {
    const { g, t, v } = fixture();
    g.Move({ x: 1000000, y: 1000000 });
    expect(t.GetStart()).toEqual({ x: 2000000, y: 3000000 });
    expect(v.GetPosition()).toEqual({ x: 8000000, y: 5000000 });
    g.SetPosition({ x: 0, y: 0 });
    expect(t.GetStart()).toEqual({ x: -3150000, y: -1150000 });
    expect(v.GetPosition()).toEqual({ x: 2850000, y: 850000 });
    expect(g.HitTest(t.GetStart(), 1000000)).toBe(false);

    const eff = g.GetEffectiveShape().BBox();
    expect([eff.GetX(), eff.GetY(), eff.GetWidth(), eff.GetHeight()]).toEqual([
      -3250000, -1250000, 6500000, 2500000,
    ]);
  });

  it('SetLocked propagates to the members', () => {
    const { g, t, v } = fixture();
    g.SetLocked(true);
    expect(g.IsLocked()).toBe(true);
    expect(t.IsLocked()).toBe(true);
    expect(v.IsLocked()).toBe(true);
  });

  it('Mirror is refused when a footprint is a (nested) member', () => {
    const { g, t, b } = fixture();
    const inner = new PCB_GROUP(b);
    b.Add(inner);
    const fp = new FOOTPRINT(b);
    b.Add(fp);
    inner.AddItem(fp);
    g.AddItem(inner);
    g.Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetStart()).toEqual({ x: 1000000, y: 2000000 });
    g.RemoveItem(inner);
    g.Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetStart()).toEqual({ x: -1000000, y: 2000000 });
  });

  it('Clone shares the members and keeps the UUID; DeepClone copies them; DeepDuplicate renews every UUID', () => {
    const { g, t } = fixture();
    const shallow = g.Clone() as PCB_GROUP;
    expect(shallow.m_Uuid).toBe(g.m_Uuid);
    expect(shallow.GetItems().has(t)).toBe(true);
    expect(t.GetParentGroup()).toBe(g); // the copy does not re-parent the members

    const deep = g.DeepClone();
    expect(deep.m_Uuid).toBe(g.m_Uuid);
    expect(deep.GetItems().size).toBe(2);
    expect(deep.GetItems().has(t)).toBe(false);
    const memberUuids = [...deep.GetItems()].map((i) => i.m_Uuid).sort();
    expect(memberUuids).toEqual([...g.GetItems()].map((i) => i.m_Uuid).sort());
    expect(deep.equals(g)).toBe(true);

    const dupe = g.DeepDuplicate(false);
    expect(dupe.m_Uuid).not.toBe(g.m_Uuid);
    for (const member of dupe.GetItems()) {
      expect(member.GetParentGroup()).toBe(dupe);
      expect(memberUuids).not.toContain(member.m_Uuid);
    }
    expect(dupe.equals(g)).toBe(false);
    expect(g.Similarity(g)).toBe(1.0);
  });

  it('TopLevelGroup / WithinScope walk the nesting', () => {
    const { g, t, b } = fixture();
    const outer = new PCB_GROUP(b);
    b.Add(outer);
    outer.AddItem(g);
    expect(PCB_GROUP.TopLevelGroup(t, null, false)).toBe(outer);
    expect(PCB_GROUP.TopLevelGroup(t, outer, false)).toBe(g);
    expect(PCB_GROUP.TopLevelGroup(t, g, false)).toBe(null);
    expect(PCB_GROUP.WithinScope(t, g, false)).toBe(true);
    expect(PCB_GROUP.WithinScope(t, outer, false)).toBe(true);
    const other = new PCB_GROUP(b);
    expect(PCB_GROUP.WithinScope(t, other, false)).toBe(false);
  });

  it('SwapItemData swaps the member sets and re-parents the children', () => {
    const { g, t, v, b } = fixture();
    const image = new PCB_GROUP(b);
    image.SetName('image');
    g.SwapItemData(image);
    expect(g.GetItems().size).toBe(0);
    expect(g.GetName()).toBe('image');
    expect(image.GetItems().size).toBe(2);
    expect(t.GetParentGroup()).toBe(image);
    expect(v.GetParentGroup()).toBe(image);
  });
});
