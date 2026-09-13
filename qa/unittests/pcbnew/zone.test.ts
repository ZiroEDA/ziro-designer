// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ZONE over BOARD_CONNECTED_ITEM (`pcbnew/zone.cpp`) and the ZONE_SETTINGS
 * defaults it takes. Every expected number below was read from KiCad's own
 * `pcbnew` python module on the same inputs (a default 2-copper BOARD), not
 * derived from our port.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { FLIP_DIRECTION } from '@ziroeda/core/src/mirror.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/src/board.js';
import {
  ISLAND_REMOVAL_MODE,
  ZONE,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_SETTINGS,
} from '@ziroeda/pcbnew/src/zone.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/src/zones.js';

const units = new UNITS_PROVIDER(pcbIUScale, 'mm');

const mkRect = (board = new BOARD()): ZONE => {
  const z = new ZONE(board);

  for (const p of [
    { x: 0, y: 0 },
    { x: 10000000, y: 0 },
    { x: 10000000, y: 5000000 },
    { x: 0, y: 5000000 },
  ])
    z.AppendCorner(p, -1);

  z.SetLayer(PCB_LAYER_ID.F_Cu);
  return z;
};

describe('ZONE', () => {
  it('constructs from the default ZONE_SETTINGS', () => {
    const z = new ZONE(new BOARD());
    expect(z.GetLocalClearance()).toBe(500000);
    expect(z.GetMinThickness()).toBe(250000);
    expect(z.GetHatchThickness()).toBe(1000000);
    expect(z.GetHatchGap()).toBe(1500000);
    expect(z.GetPadConnection()).toBe(ZONE_CONNECTION.THERMAL);
    expect(z.GetAssignedPriority()).toBe(0);
    expect(z.GetHatchStyle()).toBe(ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE);
    expect(z.GetBorderHatchPitch()).toBe(500000);
    expect(z.GetThermalReliefGap()).toBe(500000);
    expect(z.GetThermalReliefSpokeWidth()).toBe(500000);
    expect(z.GetIslandRemovalMode()).toBe(ISLAND_REMOVAL_MODE.ALWAYS);
    expect(z.GetMinIslandArea()).toBe(10000000000000);
    expect(z.GetLayer()).toBe(PCB_LAYER_ID.UNDEFINED_LAYER); // ExportSetting( *this, false ) leaves the layer set empty
    expect(z.GetLayerSet().FmtHex()).toBe('00000000_00000000_00000000_00000000');
    expect(z.GetIsRuleArea()).toBe(false);
    expect(z.GetCornerSmoothingType()).toBe(ZONE_SETTINGS.SMOOTHING_NONE);
    expect(z.GetCornerRadius()).toBe(0);
    expect(z.IsFilled()).toBe(false);
    expect(z.NeedRefill()).toBe(false);
  });

  it('outline corners, position, bbox, area and the edge/corner hit tests', () => {
    const z = mkRect();
    expect(z.GetNumCorners()).toBe(4);
    expect(z.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(z.GetBoundingBox().GetX()).toBe(0);
    expect(z.GetBoundingBox().GetWidth()).toBe(10000000);
    expect(z.CalculateOutlineArea()).toBe(50000000000000);
    expect(z.HitTest({ x: 5000000, y: 0 }, 0)).toBe(true); // on an edge
    expect(z.HitTest({ x: 5000000, y: 2500000 }, 0)).toBe(false); // inside, not an outline hit
    expect(z.HitTestForCorner({ x: 50000, y: 50000 }, 200000)).toBe(true);
    expect(z.HitTestFilledArea(PCB_LAYER_ID.F_Cu, { x: 5000000, y: 2500000 })).toBe(false); // no fill yet
  });

  it('Move carries the outline; description, friendly name and view layers', () => {
    const z = mkRect();
    z.Move({ x: 100, y: 200 });
    expect(z.GetPosition()).toEqual({ x: 100, y: 200 });
    expect(z.GetItemDescription(units, true)).toBe('Zone [<no net>] on F.Cu, priority 0');
    expect(z.GetFriendlyName()).toBe('Copper Zone');
    expect(z.ViewGetLayers()).toEqual([0, 310]);

    z.SetIsRuleArea(true);
    expect(z.GetItemDescription(units, true)).toBe('Rule Area on F.Cu');
    expect(z.HitTestFilledArea(PCB_LAYER_ID.F_Cu, { x: 5000000, y: 2500000 })).toBe(true); // a rule area's interior counts
    expect(z.GetLocalClearance()).toBe(0);
  });

  it('BuildSmoothedPoly fillets the corners; Flip mirrors through the board', () => {
    const z = mkRect();
    z.Move({ x: 100, y: 200 });
    z.SetCornerSmoothingType(ZONE_SETTINGS.SMOOTHING_FILLET);
    z.SetCornerRadius(500000);

    const sm = new SHAPE_POLY_SET();
    expect(z.BuildSmoothedPoly(sm, PCB_LAYER_ID.F_Cu, null)).toBe(true);
    expect(sm.TotalVertices()).toBe(28);
    expect(sm.CVertex(0)).toEqual({ x: 9629510, y: 17237 });
    expect(sm.CVertex(5)).toEqual({ x: 10000100, y: 500200 });

    z.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.LEFT_RIGHT);
    expect(z.GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(z.GetPosition()).toEqual({ x: -100, y: 200 });

    const c = z.Clone();
    expect(c.m_Uuid).toBe(z.m_Uuid);
    expect(c.equals(z)).toBe(true);
  });

  it('BOARD::GetUniqueZoneName increments the root of a _<n> suffix', () => {
    const board = new BOARD();
    const z = mkRect(board);
    board.Add(z);
    z.SetZoneName('foo_3');
    expect(board.GetUniqueZoneName('foo_3', null)).toBe('foo_1');
    expect(board.GetUniqueZoneName('foo_3', z)).toBe('foo_3');
  });
});
