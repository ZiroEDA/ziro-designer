// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_POINT (`pcbnew/pcb_point.cpp`) and PCB_GENERATOR (`pcb_generator.cpp`).
 * KiCad's python module does not wrap either, so the expectations here are
 * read from the C++ over kimath classes whose own numbers are oracle-checked
 * (BOX2I::ByCenter, SEG::Collide, SHAPE_CIRCLE::Collide).
 */
import { describe, expect, it } from 'vitest';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { STRING_ANY_MAP } from '@ziroeda/common/string_any_map.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_COMMIT_LIKE } from '@ziroeda/pcbnew/board_item.js';
import { PCB_GENERATOR } from '@ziroeda/pcbnew/pcb_generator.js';
import { PCB_POINT } from '@ziroeda/pcbnew/pcb_point.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';

describe('PCB_POINT', () => {
  it('constructs 1 mm by default; the box is ByCenter(pos, size)', () => {
    const b = new BOARD();
    expect(new PCB_POINT(b).GetSize()).toBe(1000000);
    const p = new PCB_POINT(b, { x: 1000000, y: 2000000 }, 1000000);
    b.Add(p);
    const bb = p.GetBoundingBox();
    expect([bb.GetX(), bb.GetY(), bb.GetWidth(), bb.GetHeight()]).toEqual([
      500000, 1500000, 1000000, 1000000,
    ]);
    expect(p.GetItemDescription(null, true)).toBe('Point');
    expect(p.ViewGetLayers()).toEqual([GAL_LAYER_ID.LAYER_POINT_START + PCB_LAYER_ID.F_Cu]);
    p.SetLocked(true);
    expect(p.ViewGetLayers()).toEqual([
      GAL_LAYER_ID.LAYER_POINT_START + PCB_LAYER_ID.F_Cu,
      GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW,
    ]);
  });

  it('HitTest is the two bars of the X (half the size each way) and the quarter-size circle', () => {
    const b = new BOARD();
    const p = new PCB_POINT(b, { x: 1000000, y: 2000000 }, 1000000);
    b.Add(p);
    expect(p.HitTest({ x: 1000000, y: 2000000 }, 0)).toBe(true); // centre
    expect(p.HitTest({ x: 1400000, y: 2400000 }, 0)).toBe(true); // on the \ bar
    expect(p.HitTest({ x: 600000, y: 2400000 }, 0)).toBe(true); // on the / bar
    expect(p.HitTest({ x: 1200000, y: 2000000 }, 0)).toBe(true); // inside the 250000 circle
    expect(p.HitTest({ x: 1260000, y: 2000000 }, 0)).toBe(false); // just outside it, off both bars
    expect(p.HitTest({ x: 1400000, y: 2000000 }, 0)).toBe(false);
    expect(p.HitTest({ x: 1400000, y: 2000000 }, 100000)).toBe(false); // 150000 from the circle, 282843 from a bar
    expect(p.HitTest({ x: 1400000, y: 2000000 }, 160000)).toBe(true);
  });

  it('Flip mirrors the position and flips the layer; Rotate; equality and the C++ Similarity', () => {
    const b = new BOARD();
    const p = new PCB_POINT(b, { x: 1000000, y: 2000000 }, 1000000);
    b.Add(p);
    p.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);
    expect(p.GetPosition()).toEqual({ x: 1000000, y: -2000000 });
    expect(p.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    p.Rotate({ x: 0, y: 0 }, new EDA_ANGLE(90, EDA_ANGLE_T.DEGREES_T));
    expect(p.GetPosition()).toEqual({ x: -2000000, y: -1000000 });

    const d = p.Duplicate(false) as PCB_POINT;
    expect(p.equals(d)).toBe(true);
    // Upstream's Similarity multiplies by 0.9 when the positions are EQUAL (its own bug, kept)
    expect(p.Similarity(d)).toBeCloseTo(0.9, 12);
    d.SetPosition({ x: 0, y: 0 });
    expect(p.equals(d)).toBe(false);
    expect(p.Similarity(d)).toBe(1.0);
  });
});

/** The smallest concrete generator, for the base class behaviour. */
class TEST_GENERATOR extends PCB_GENERATOR {
  constructor(aParent: BOARD, aLayer: PCB_LAYER_ID) {
    super(aParent, aLayer);
    this.m_generatorType = 'test';
  }
  override Clone(): TEST_GENERATOR {
    const c = new TEST_GENERATOR(this.GetParent() as BOARD, this.m_layer);
    c.assignGenerator(this);
    (c as { m_Uuid: string }).m_Uuid = this.m_Uuid;
    return c;
  }
  EditStart(): void {}
  Update(): boolean {
    return true;
  }
  EditFinish(): void {}
  EditCancel(): void {}
  Remove(): void {}
  GetPluralName(): string {
    return 'Tests';
  }
  GetCommitMessage(): string {
    return 'Test';
  }
  // the tool hooks take (aTool, aBoard, aCommit); the test never passes them
  declare _commit: BOARD_COMMIT_LIKE;
}

describe('PCB_GENERATOR', () => {
  it('is a PCB_GROUP with an origin; Move/Rotate/Flip carry the origin and the members', () => {
    const b = new BOARD();
    const g = new TEST_GENERATOR(b, PCB_LAYER_ID.F_Cu);
    b.Add(g);
    const t = new PCB_TRACK(b);
    t.SetStart({ x: 1000000, y: 0 });
    t.SetEnd({ x: 2000000, y: 0 });
    b.Add(t);
    g.AddItem(t);
    g.SetPosition({ x: 500000, y: 500000 });

    expect(g.GetClass()).toBe('PCB_GENERATOR');
    expect(g.GetGeneratorType()).toBe('test');
    expect(g.GetItemDescription(null, true)).toBe('Generator');
    expect(g.GetLayerSet().Contains(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(g.GetBoundingBox().GetWidth()).toBe(0); // an empty box, not the members'

    g.Move({ x: 1000000, y: 1000000 });
    expect(g.GetPosition()).toEqual({ x: 1500000, y: 1500000 });
    expect(t.GetStart()).toEqual({ x: 2000000, y: 1000000 });

    g.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(g.GetPosition()).toEqual({ x: -1500000, y: 1500000 });
    expect(g.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);

    const props = g.GetProperties();
    expect(props.get_to('origin', 'object')).toEqual({ x: -1500000, y: 1500000 });
    const incoming = new STRING_ANY_MAP(1000000);
    incoming.set_('origin', { x: 7, y: 8 });
    incoming.set_('origin', { x: 9, y: 9 }); // emplace: the first wins
    g.SetProperties(incoming);
    expect(g.GetPosition()).toEqual({ x: 7, y: 8 });

    const deep = g.DeepClone();
    expect(deep.m_Uuid).toBe(g.m_Uuid);
    expect(deep.GetItems().size).toBe(1);
    expect(deep.GetItems().has(t)).toBe(false);
  });
});
