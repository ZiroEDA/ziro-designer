// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_TRACK / PCB_ARC / PCB_VIA over BOARD_CONNECTED_ITEM and PADSTACK
 * (`pcbnew/pcb_track.cpp`). Every expected number below was read from
 * KiCad's own `pcbnew` python module on the same inputs (a default 2-copper
 * BOARD as parent), not derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';
import {
  PCB_ARC,
  PCB_TRACK,
  PCB_VIA,
  VIA_PARAMETER_ERROR_FIELD,
  VIATYPE,
} from '@ziroeda/pcbnew/src/pcb_track.js';
import { ENDPOINT, STARTPOINT } from '@ziroeda/common/src/eda_item_flags.js';

const bbox = (item: PCB_TRACK): [number, number, number, number] => {
  const r = item.GetBoundingBox();
  return [r.GetX(), r.GetY(), r.GetWidth(), r.GetHeight()];
};

const mkTrack = (board: BOARD): PCB_TRACK => {
  const t = new PCB_TRACK(board);
  t.SetStart({ x: 100, y: 0 });
  t.SetEnd({ x: 200, y: 0 });
  t.SetWidth(100);
  return t;
};

describe('PCB_TRACK', () => {
  it('constructs like PCB_TRACK( aParent ): 0.2 mm wide, no solder mask, F.Cu', () => {
    const t = new PCB_TRACK(null);
    expect(t.Type()).toBe(KICAD_T.PCB_TRACE_T);
    expect(t.GetWidth()).toBe(pcbIUScale.mmToIU(0.2));
    expect(t.HasSolderMask()).toBe(false);
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(t.IsOnCopperLayer()).toBe(true);
  });

  it('Move translates both endpoints', () => {
    const t = mkTrack(new BOARD());
    t.Move({ x: 10, y: 20 });
    expect(t.GetStart()).toEqual({ x: 110, y: 20 });
    expect(t.GetEnd()).toEqual({ x: 210, y: 20 });
  });

  it('Rotate 90° about origin', () => {
    const t = mkTrack(new BOARD());
    t.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(t.GetStart()).toEqual({ x: 0, y: -100 });
    expect(t.GetEnd()).toEqual({ x: 0, y: -200 });
  });

  it('Flip left-right mirrors X and flips the layer through the board', () => {
    const t = mkTrack(new BOARD());
    t.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(t.GetStart()).toEqual({ x: -100, y: 0 });
    expect(t.GetEnd()).toEqual({ x: -200, y: 0 });
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
  });

  it('HitTest respects half-width + accuracy', () => {
    const t = mkTrack(new BOARD());
    expect(t.HitTest({ x: 150, y: 40 }, 10)).toBe(true); // 40 <= 10 + 50
    expect(t.HitTest({ x: 150, y: 100 }, 10)).toBe(false);
  });

  it('GetBoundingBox is [pos,dim) with the rounded-up radius', () => {
    expect(bbox(mkTrack(new BOARD()))).toEqual([50, -50, 201, 101]);
  });

  it('IsPointOnEnds: exact at 0, half-width when negative', () => {
    const t = mkTrack(new BOARD());
    expect(t.IsPointOnEnds({ x: 100, y: 0 }, 0)).toBe(STARTPOINT);
    expect(t.IsPointOnEnds({ x: 190, y: 0 }, -1)).toBe(ENDPOINT);
    expect(t.IsPointOnEnds({ x: 150, y: 0 }, -1)).toBe(STARTPOINT | ENDPOINT);
  });

  it('GetItemDescription and ViewGetLayers', () => {
    const t = mkTrack(new BOARD());
    const units = new UNITS_PROVIDER(pcbIUScale, 'mm');
    expect(t.GetItemDescription(units, true)).toBe('Track [<no net>] on F.Cu, length 0.0001 mm');
    expect(t.ViewGetLayers()).toEqual([0, 128, 697]);
  });

  it('a solder-mask track is on F.Mask and reports it in its layer set', () => {
    const t = mkTrack(new BOARD());
    t.SetHasSolderMask(true);
    expect(t.IsOnLayer(PCB_LAYER_ID.F_Mask)).toBe(true);
    expect(t.IsOnLayer(PCB_LAYER_ID.B_Mask)).toBe(false);
    expect(t.GetLayerSet().Contains(PCB_LAYER_ID.F_Mask)).toBe(true);
    expect(t.ViewGetLayers()).toContain(PCB_LAYER_ID.F_Mask);
  });

  it('Clone keeps the UUID; CopyFrom keeps its own', () => {
    const t = mkTrack(new BOARD());
    const c = t.Clone();
    expect(c.m_Uuid).toBe(t.m_Uuid);
    expect(c.equals(t)).toBe(true);
    expect(c.Similarity(t)).toBe(1.0);

    const other = new PCB_TRACK(null);
    const ownUuid = other.m_Uuid;
    other.CopyFrom(t);
    expect(other.m_Uuid).toBe(ownUuid);
    expect(other.GetEnd()).toEqual({ x: 200, y: 0 });
  });
});

describe('PCB_ARC', () => {
  // CCW quarter arc, centre origin, radius 1000.
  const mk = (board = new BOARD()): PCB_ARC => {
    const a = new PCB_ARC(board);
    a.SetStart({ x: 1000, y: 0 });
    a.SetMid({ x: 707, y: 707 });
    a.SetEnd({ x: 0, y: 1000 });
    a.SetWidth(100);
    return a;
  };

  it('centre, radius, angles, length and winding', () => {
    const a = mk();
    expect(a.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(a.GetRadius()).toBe(1000);
    expect(a.GetAngle().AsDegrees()).toBe(90);
    expect(a.GetArcAngleStart().AsDegrees()).toBe(0);
    expect(a.GetLength()).toBeCloseTo(1570.7963267948965, 9);
    expect(a.IsCCW()).toBe(true);
  });

  it('HitTest on the arc, and misses off-sweep', () => {
    const a = mk();
    expect(a.HitTest({ x: 707, y: 707 }, 20)).toBe(true);
    expect(a.HitTest({ x: -1000, y: 0 }, 20)).toBe(false); // radius ok, wrong angle
  });

  it('GetBoundingBox comes from the effective SHAPE_ARC', () => {
    expect(bbox(mk())).toEqual([-101, -101, 1203, 1203]);
  });

  it('Rotate carries the mid point', () => {
    const a = mk();
    a.Rotate({ x: 0, y: 0 }, ANGLE_90);
    expect(a.GetMid()).toEqual({ x: 707, y: -707 });
  });

  // PCB_ARC::GetAngle is `angle1.Normalize180() + angle2.Normalize180()`: a
  // clockwise sweep is NEGATIVE, and PCB_ARC::HitTest's `arc_angle < ANGLE_0`
  // branch then keeps the hit inside the sweep.
  it('a clockwise half circle sweeps -180 and misses its other half', () => {
    // centre origin, r=100: 0 -> -90 -> 180 degrees, the y-negative half
    const a = new PCB_ARC(new BOARD());
    a.SetStart({ x: 100, y: 0 });
    a.SetMid({ x: 0, y: -100 });
    a.SetEnd({ x: -100, y: 0 });
    a.SetWidth(10);
    expect(a.GetAngle().AsDegrees()).toBe(-180);
    expect(a.HitTest({ x: 0, y: -100 }, 0)).toBe(true);
    expect(a.HitTest({ x: 0, y: 100 }, 0)).toBe(false); // on the circle, off the sweep
    expect(a.HitTest({ x: 71, y: 71 }, 0)).toBe(false);
  });

  it('a 2 IU collinear arc is degenerated', () => {
    const a = new PCB_ARC(new BOARD());
    a.SetStart({ x: 0, y: 0 });
    a.SetMid({ x: 1, y: 0 });
    a.SetEnd({ x: 2, y: 0 });
    expect(a.IsDegenerated()).toBe(true);
    expect(a.GetRadius()).toBe(1);
  });
});

describe('PCB_VIA', () => {
  const mk = (board = new BOARD()): PCB_VIA => {
    const v = new PCB_VIA(board);
    v.SetPosition({ x: 0, y: 0 });
    v.SetWidth(200);
    v.SetDrill(100);
    return v;
  };

  it('constructs as a through via F.Cu - B.Cu with the default drill', () => {
    const v = new PCB_VIA(null);
    expect(v.GetViaType()).toBe(VIATYPE.THROUGH);
    expect(v.TopLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(v.BottomLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(v.GetDrill()).toBe(-1); // UNDEFINED_DRILL_DIAMETER
    expect(v.HasHole()).toBe(true);
    expect(v.IsNull()).toBe(true);
  });

  it('HitTest inside the pad radius', () => {
    const v = mk();
    expect(v.HitTest({ x: 50, y: 0 }, 0)).toBe(true);
    expect(v.HitTest({ x: 0, y: 150 }, 10)).toBe(false);
  });

  it('bounding box, layer set, drill and effective shape', () => {
    const v = mk();
    expect(bbox(v)).toEqual([-100, -100, 201, 201]);
    expect(v.GetLayerSet().FmtHex()).toBe('00000000_00000000_00000000_00000005'); // F_Cu | B_Cu, tented
    expect(v.GetDrillValue()).toBe(100);
    const shape = v.GetEffectiveShape(PCB_LAYER_ID.F_Cu);
    expect(shape).toBeInstanceOf(SHAPE_CIRCLE);
    expect((shape as SHAPE_CIRCLE).GetRadius()).toBe(100);
    expect(v.LayerMaskDescribe()).toBe('F.Cu - B.Cu');
    expect(v.ViewGetLayers()).toEqual([283, 296, 260, 568, 697, 570, 699]);
  });

  it('a via and a track have no similarity', () => {
    const board = new BOARD();
    expect(mk(board).Similarity(mkTrack(board))).toBe(0.0);
  });

  it('through via keeps its layers on flip; blind via swaps them', () => {
    const through = mk();
    through.SetPosition({ x: 100, y: 0 });
    through.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(through.GetPosition()).toEqual({ x: -100, y: 0 });
    expect(through.GetLayer()).toBe(PCB_LAYER_ID.F_Cu); // through: unchanged

    const blind = mk();
    blind.SetViaType(VIATYPE.BLIND);
    blind.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu);
    expect(blind.IsBlindVia()).toBe(true);
    expect(blind.IsBuriedVia()).toBe(false);
    blind.SetPosition({ x: 100, y: 0 });
    blind.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(blind.GetPosition()).toEqual({ x: -100, y: 0 });
    expect(blind.TopLayer()).toBe(PCB_LAYER_ID.In1_Cu);
    expect(blind.BottomLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(blind.LayerMaskDescribe()).toBe('In1.Cu - B.Cu');
    // LAYER_RANGE( In1_Cu, B_Cu, 2 ) over a 2-copper board: KiCad's own answer
    expect(blind.GetLayerSet().FmtHex()).toBe('00000000_00000000_00000000_00000050');
  });

  it('ValidateViaParameters refuses in KiCad’s words and order', () => {
    // GEOMETRY_MIN_SIZE is 0.001 mm = 1000 IU; everything here is in whole microns
    const um = 1000;
    expect(PCB_VIA.ValidateViaParameters(500 * um, 600 * um)?.m_Message).toBe(
      'Via hole size must be smaller than via diameter',
    );
    expect(PCB_VIA.ValidateViaParameters(500 * um, 600 * um)?.m_Field).toBe(
      VIA_PARAMETER_ERROR_FIELD.DRILL,
    );
    expect(PCB_VIA.ValidateViaParameters(500 * um, undefined)?.m_Message).toBe(
      'No via hole size defined.',
    );
    expect(PCB_VIA.ValidateViaParameters(undefined, 300 * um)?.m_Message).toBe(
      'No via diameter defined.',
    );
    expect(PCB_VIA.ValidateViaParameters(100, 300 * um)?.m_Message).toBe(
      'Via diameter is too small.',
    );
    expect(PCB_VIA.ValidateViaParameters(600 * um, 100)?.m_Message).toBe('Via drill is too small.');
    expect(PCB_VIA.ValidateViaParameters(600 * um, 300 * um)).toBeUndefined();
    expect(PCB_VIA.ValidateViaParameters(600 * um, 300 * um, PCB_LAYER_ID.F_SilkS)?.m_Message).toBe(
      'Via layer must be a copper layer.',
    );
    expect(
      PCB_VIA.ValidateViaParameters(
        600 * um,
        300 * um,
        PCB_LAYER_ID.In4_Cu,
        PCB_LAYER_ID.B_Cu,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        4,
      )?.m_Message,
    ).toBe('Via layer is outside the board stack.');
    expect(
      PCB_VIA.ValidateViaParameters(600 * um, 300 * um, PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Cu)
        ?.m_Field,
    ).toBe(VIA_PARAMETER_ERROR_FIELD.START_LAYER);
  });

  it('SetWidth without a layer sets every layer; Clone keeps the padstack', () => {
    const v = mk();
    expect(v.GetWidth(PCB_LAYER_ID.F_Cu)).toBe(200);
    expect(v.GetWidth(PCB_LAYER_ID.B_Cu)).toBe(200);
    v.SetWidth(PCB_LAYER_ID.B_Cu, 300);
    expect(v.GetWidth(PCB_LAYER_ID.B_Cu)).toBe(300);
    const c = v.Clone();
    expect(c.m_Uuid).toBe(v.m_Uuid);
    expect(c.GetWidth(PCB_LAYER_ID.B_Cu)).toBe(300);
    expect(c.equals(v)).toBe(true);
  });
});
