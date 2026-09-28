// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/tool/construction_manager.h` + `common/tool/construction_manager.cpp`
 * (`CONSTRUCTION_MANAGER`, `SNAP_LINE_MANAGER`, `SNAP_MANAGER`) and
 * `common/preview_items/construction_geom.ts` (`CONSTRUCTION_GEOM`,
 * `drawConstructionGeom`). Every expectation is worked by hand from the C++,
 * never read back off the code under test.
 */
import { CIRCLE } from '@ziroeda/kimath/src/geometry/circle.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { HALF_LINE } from '@ziroeda/kimath/src/geometry/half_line.js';
import { LINE } from '@ziroeda/kimath/src/geometry/line.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { EDA_ITEM, type INSPECTOR, INSPECT_RESULT } from '@ziroeda/common/eda_item.js';
import {
  CONSTRUCTION_MANAGER_SOURCE,
  type CONSTRUCTION_ITEM_BATCH,
  SNAP_MANAGER,
} from '@ziroeda/common/tool/construction_manager.js';
import {
  CONSTRUCTION_GEOM,
  drawConstructionGeom,
} from '@ziroeda/common/preview_items/construction_geom.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { KICAD_T as KT } from '@ziroeda/core/typeinfo.js';
import { describe, expect, it, vi } from 'vitest';

/** A bare EDA_ITEM: only identity (`Item` in a `CONSTRUCTION_ITEM`) matters here. */
class DUMMY_ITEM extends EDA_ITEM {
  constructor() {
    super(null, KICAD_T.NOT_USED);
  }
  override GetClass(): string {
    return 'DUMMY_ITEM';
  }
  override Clone(): EDA_ITEM {
    return new DUMMY_ITEM();
  }
  override Visit(_i: INSPECTOR, _d: unknown, _t: readonly KT[]): INSPECT_RESULT {
    return INSPECT_RESULT.CONTINUE;
  }
}

function batchOf(item: EDA_ITEM | null, drawable: SEG = new SEG({ x: 0, y: 0 }, { x: 1, y: 0 })) {
  const batch: CONSTRUCTION_ITEM_BATCH = [
    {
      Source: CONSTRUCTION_MANAGER_SOURCE.FROM_ITEMS,
      Item: item,
      Constructions: [{ Drawable: drawable, LineWidth: 1 }],
    },
  ];
  return batch;
}

describe('SNAP_LINE_MANAGER::SetDirections (construction_manager.cpp:450-489)', () => {
  it('normalizes and de-duplicates opposite/scaled directions', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    // (2,0) normalizes to (1,0); (-1,0) normalizes to (1,0) too (sign flip
    // rule: dx<0 -> negate); (0,-3) normalizes to (0,1).
    snapLine.SetDirections([
      { x: 2, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: -3 },
    ]);

    expect(snapLine.GetDirections()).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('drops the (0,0) direction and clears the snap line when directions become empty', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    snapLine.SetSnapLineOrigin({ x: 5, y: 5 });
    snapLine.SetDirections([{ x: 0, y: 0 }]);

    expect(snapLine.GetDirections()).toEqual([]);
    expect(snapLine.GetSnapLineOrigin()).toBeNull();
  });

  it('unsets the end when it no longer lies on any surviving direction', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    snapLine.SetSnapLineOrigin({ x: 0, y: 0 });
    snapLine.SetSnapLineEnd({ x: 0, y: 10 }); // on the default (0,1) direction

    snapLine.SetDirections([{ x: 1, y: 0 }]); // (0,1) no longer present

    expect(snapLine.GetSnapLineOrigin()).toEqual({ x: 0, y: 0 });
    expect(snapLine.HasCompleteSnapLine()).toBe(false);
  });
});

describe('SNAP_LINE_MANAGER origin/end/anchor (construction_manager.cpp:491-559)', () => {
  it('SetSnapLineOrigin resets the end and the active direction', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    snapLine.SetSnapLineOrigin({ x: 0, y: 0 });
    snapLine.SetSnapLineEnd({ x: 10, y: 0 });
    expect(snapLine.GetActiveDirection()).toBe(0);

    snapLine.SetSnapLineOrigin({ x: 3, y: 3 });
    expect(snapLine.GetActiveDirection()).toBeNull();
    expect(snapLine.HasCompleteSnapLine()).toBe(false);
  });

  it('SetSnapLineEnd sets the active direction to the matching index, or null off-axis', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    snapLine.SetSnapLineOrigin({ x: 0, y: 0 }); // directions: (1,0) idx0, (0,1) idx1
    snapLine.SetSnapLineEnd({ x: 0, y: 20 });
    expect(snapLine.GetActiveDirection()).toBe(1);

    // Off both axes: findDirectionIndex finds no match.
    snapLine.SetSnapLineEnd({ x: 5, y: 7 });
    expect(snapLine.GetActiveDirection()).toBeNull();
  });

  it('SetSnappedAnchor extends the line along an active direction, else starts a new one', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    snapLine.SetSnapLineOrigin({ x: 0, y: 0 });

    // On the (1,0) axis from the origin -> becomes the end.
    snapLine.SetSnappedAnchor({ x: 15, y: 0 });
    expect(snapLine.GetSnapLineOrigin()).toEqual({ x: 0, y: 0 });
    expect(snapLine.HasCompleteSnapLine()).toBe(true);

    // Off-axis from the origin -> becomes the new origin instead.
    snapLine.SetSnappedAnchor({ x: 4, y: 4 });
    expect(snapLine.GetSnapLineOrigin()).toEqual({ x: 4, y: 4 });
    expect(snapLine.HasCompleteSnapLine()).toBe(false);
  });

  it('ClearSnapLine drops the origin, end and active direction', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    snapLine.SetSnapLineOrigin({ x: 1, y: 1 });
    snapLine.SetSnapLineEnd({ x: 1, y: 11 });
    snapLine.ClearSnapLine();

    expect(snapLine.GetSnapLineOrigin()).toBeNull();
    expect(snapLine.GetActiveDirection()).toBeNull();
  });
});

describe('SNAP_LINE_MANAGER::GetNearestSnapLinePoint (construction_manager.cpp:561-716)', () => {
  it('answers null with no origin, or when the grid-vs-nearest gate rejects', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();

    expect(snapLine.GetNearestSnapLinePoint({ x: 5, y: 1 }, { x: 5, y: 0 }, null, 10)).toBeNull();

    snapLine.SetSnapLineOrigin({ x: 0, y: 0 });
    // aDistToNearest (5) <= aSnapRange (10): the nearby non-grid snap wins, so
    // `gridBetterThanNearest` is false and this returns null regardless of geometry.
    expect(snapLine.GetNearestSnapLinePoint({ x: 5, y: 1 }, { x: 5, y: 0 }, 5, 10)).toBeNull();
  });

  it('grid off: picks the direction with the smaller perpendicular distance, ungridded', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();
    snapLine.SetSnapLineOrigin({ x: 0, y: 0 }); // default directions (1,0), (0,1)

    // cursor (5,1): against (1,0) perp=1 (projection (5,0)); against (0,1)
    // perp=5 (projection (0,1)). (1,0) wins.
    expect(snapLine.GetNearestSnapLinePoint({ x: 5, y: 1 }, { x: 6, y: 2 }, null, 10)).toEqual({
      x: 5,
      y: 0,
    });
  });

  it('grid on: snaps a horizontal/vertical direction to the grid on the free axis', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();
    snapLine.SetSnapLineOrigin({ x: 0, y: 0 });

    // Same cursor as above: (1,0) still wins on perpendicular distance, and
    // with the grid on its projection's free (y) axis is fixed by
    // SetSnapLineOrigin at 0 and its free (x) axis takes aNearestGrid.x.
    expect(
      snapLine.GetNearestSnapLinePoint(
        { x: 5, y: 1 },
        { x: 6, y: 2 },
        null,
        10,
        { x: 5, y: 5 },
        { x: 0, y: 0 },
      ),
    ).toEqual({ x: 6, y: 0 });
  });

  it('grid on, diagonal direction: snaps to the nearest grid intersection along the line', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const snapLine = mgr.GetSnapLineManager();
    snapLine.SetSnapLineOrigin({ x: 0, y: 0 });
    snapLine.SetDirections([{ x: 1, y: 1 }]); // the only direction: the 45 deg diagonal

    // cursor near (10,10), squarely on the diagonal already; nearest grid
    // intersection on a 5x5 grid at the origin is (10,10) itself.
    expect(
      snapLine.GetNearestSnapLinePoint(
        { x: 10, y: 11 },
        { x: 10, y: 10 },
        null,
        10,
        { x: 5, y: 5 },
        { x: 0, y: 0 },
      ),
    ).toEqual({ x: 10, y: 10 });
  });
});

describe('CONSTRUCTION_MANAGER (construction_manager.h/.cpp:163-360)', () => {
  it('proposing an empty batch is a no-op', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    mgr.GetConstructionManager().ProposeConstructionItems([], true);
    expect(mgr.GetConstructionManager().HasActiveConstruction()).toBe(false);
  });

  it('a persistent batch is accepted immediately and replaces the previous one', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const cm = mgr.GetConstructionManager();
    const itemA = new DUMMY_ITEM();
    const itemB = new DUMMY_ITEM();

    cm.ProposeConstructionItems(batchOf(itemA), true);
    expect(cm.HasActiveConstruction()).toBe(true);
    expect(cm.InvolvesAllGivenRealItems([itemA])).toBe(true);
    expect(geom.GetDrawables()).toHaveLength(1);

    cm.ProposeConstructionItems(batchOf(itemB), true);
    // Persistent batches replace one another; only the second is involved now.
    expect(cm.InvolvesAllGivenRealItems([itemB])).toBe(true);
    expect(cm.InvolvesAllGivenRealItems([itemA])).toBe(false);
    expect(geom.GetDrawables()).toHaveLength(1);
  });

  it('null items in a batch are always considered "involved"', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const cm = mgr.GetConstructionManager();

    cm.ProposeConstructionItems(batchOf(null), true);
    expect(cm.InvolvesAllGivenRealItems([null])).toBe(true);
  });

  it('temporary batches accept immediately until getMaxTemporaryBatches() (2), then defer', () => {
    vi.useFakeTimers();
    try {
      const geom = new CONSTRUCTION_GEOM();
      const mgr = new SNAP_MANAGER(geom);
      const cm = mgr.GetConstructionManager();
      const itemA = new DUMMY_ITEM();
      const itemB = new DUMMY_ITEM();
      const itemC = new DUMMY_ITEM();

      cm.ProposeConstructionItems(batchOf(itemA), false); // 0 existing -> immediate
      cm.ProposeConstructionItems(batchOf(itemB), false); // 1 existing -> immediate
      expect(cm.InvolvesAllGivenRealItems([itemA, itemB])).toBe(true);

      cm.ProposeConstructionItems(batchOf(itemC), false); // 2 existing -> deferred
      expect(cm.InvolvesAllGivenRealItems([itemC])).toBe(false);

      // ADVANCED_CFG::m_ExtensionSnapTimeoutMs default: 500ms.
      vi.advanceTimersByTime(500);

      // The oldest temporary batch (A) is evicted to make room for C.
      expect(cm.InvolvesAllGivenRealItems([itemB, itemC])).toBe(true);
      expect(cm.InvolvesAllGivenRealItems([itemA])).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('CancelProposal drops a still-pending (non-immediate) proposal', () => {
    vi.useFakeTimers();
    try {
      const geom = new CONSTRUCTION_GEOM();
      const mgr = new SNAP_MANAGER(geom);
      const cm = mgr.GetConstructionManager();
      const itemA = new DUMMY_ITEM();
      const itemB = new DUMMY_ITEM();
      const itemC = new DUMMY_ITEM();

      cm.ProposeConstructionItems(batchOf(itemA), false);
      cm.ProposeConstructionItems(batchOf(itemB), false);
      cm.ProposeConstructionItems(batchOf(itemC), false); // deferred

      cm.CancelProposal();
      vi.advanceTimersByTime(1000);

      expect(cm.InvolvesAllGivenRealItems([itemC])).toBe(false);
      expect(cm.InvolvesAllGivenRealItems([itemA, itemB])).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Clear() drops both batches, the involved-item set, and any pending proposal', () => {
    vi.useFakeTimers();
    try {
      const geom = new CONSTRUCTION_GEOM();
      const mgr = new SNAP_MANAGER(geom);
      const cm = mgr.GetConstructionManager();
      const itemA = new DUMMY_ITEM();

      cm.ProposeConstructionItems(batchOf(itemA), true);
      cm.Clear();

      expect(cm.HasActiveConstruction()).toBe(false);
      expect(cm.InvolvesAllGivenRealItems([itemA])).toBe(false);

      const batches: CONSTRUCTION_ITEM_BATCH[] = [];
      cm.GetConstructionItems(batches);
      expect(batches).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SNAP_MANAGER (construction_manager.h/.cpp:250-360, 719-793)', () => {
  it('updateView: showAnything reflects active construction OR a live snap line', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const seen: boolean[] = [];
    mgr.SetUpdateCallback((show) => seen.push(show));

    // Origin set, directions non-empty (the default two) -> true, even
    // without a complete line.
    mgr.GetSnapLineManager().SetSnapLineOrigin({ x: 0, y: 0 });
    expect(seen.at(-1)).toBe(true);

    mgr.GetSnapLineManager().ClearSnapLine();
    expect(seen.at(-1)).toBe(false);

    const item = new DUMMY_ITEM();
    mgr.GetConstructionManager().ProposeConstructionItems(batchOf(item), true);
    expect(mgr.GetConstructionManager().HasActiveConstruction()).toBe(true);
  });

  it('GetConstructionItems combines the construction manager batches with the snap-line batch', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);
    const item = new DUMMY_ITEM();

    mgr.GetConstructionManager().ProposeConstructionItems(batchOf(item), true);
    mgr.GetSnapLineManager().SetSnapLineOrigin({ x: 0, y: 0 });

    const batches = mgr.GetConstructionItems();
    expect(batches).toHaveLength(2); // the persistent items batch, then the snap-line batch

    const snapLineBatch = batches[1];
    expect(snapLineBatch).toBeDefined();
    expect(snapLineBatch?.[0]?.Source).toBe(CONSTRUCTION_MANAGER_SOURCE.FROM_SNAP_LINE);
    expect(snapLineBatch?.[0]?.Item).toBeNull();
    // One drawable segment per default direction (2), both starting at the origin.
    expect(snapLineBatch?.[0]?.Constructions).toHaveLength(2);
  });

  it('UpdateSnapGuides gives the active direction the highlight color and width 5', () => {
    const geom = new CONSTRUCTION_GEOM();
    const mgr = new SNAP_MANAGER(geom);

    mgr.SetSnapGuideColors('#111111', '#eeeeee');
    mgr.GetSnapLineManager().SetSnapLineOrigin({ x: 0, y: 0 });
    mgr.GetSnapLineManager().SetSnapLineEnd({ x: 10, y: 0 }); // activates direction 0, (1,0)

    const guides = geom.GetSnapGuides();
    expect(guides).toHaveLength(2);
    const active = guides.find((g) => g.LineWidth === 5);
    const inactive = guides.find((g) => g.LineWidth === 1);
    expect(active?.Color).toBe('#eeeeee');
    expect(inactive?.Color).toBe('#111111');
    // The active (1,0) guide is the long horizontal segment through the origin.
    expect(active?.Segment.A.y).toBe(0);
    expect(active?.Segment.B.y).toBe(0);
  });
});

describe('CONSTRUCTION_GEOM state (construction_geom.h/.cpp:44-59, 68-74)', () => {
  it('AddDrawable / ClearDrawables round-trip, keeping IsPersistent and LineWidth', () => {
    const geom = new CONSTRUCTION_GEOM();
    const seg = new SEG({ x: 0, y: 0 }, { x: 1, y: 1 });

    geom.AddDrawable(seg, true, 3);
    geom.AddDrawable({ x: 5, y: 5 }, false);

    expect(geom.GetDrawables()).toHaveLength(2);
    expect(geom.GetDrawables()[0]).toEqual({ Item: seg, IsPersistent: true, LineWidth: 3 });
    expect(geom.GetDrawables()[1]).toEqual({
      Item: { x: 5, y: 5 },
      IsPersistent: false,
      LineWidth: 1,
    });

    geom.ClearDrawables();
    expect(geom.GetDrawables()).toEqual([]);
  });

  it('SetSnapLine / ClearSnapLine round-trip', () => {
    const geom = new CONSTRUCTION_GEOM();
    expect(geom.GetSnapLine()).toBeNull();

    const line = new SEG({ x: 0, y: 0 }, { x: 5, y: 5 });
    geom.SetSnapLine(line);
    expect(geom.GetSnapLine()).toBe(line);

    geom.ClearSnapLine();
    expect(geom.GetSnapLine()).toBeNull();
  });
});

interface Call {
  op: string;
  args: unknown[];
}

/** A 2D context stand-in recording every path call and style set (as `origin_viewitem.test.ts` does). */
function recorder(): CanvasRenderingContext2D & { calls: Call[]; strokeStyles: string[] } {
  const calls: Call[] = [];
  const strokeStyles: string[] = [];
  const ctx = {
    calls,
    strokeStyles,
    set strokeStyle(v: string) {
      strokeStyles.push(v);
    },
    set fillStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineJoin(_v: string) {},
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    moveTo: (...a: unknown[]) => calls.push({ op: 'moveTo', args: a }),
    lineTo: (...a: unknown[]) => calls.push({ op: 'lineTo', args: a }),
    arc: (...a: unknown[]) => calls.push({ op: 'arc', args: a }),
    stroke: () => calls.push({ op: 'stroke', args: [] }),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[]; strokeStyles: string[] };
}

const bigViewport = new BOX2I({ x: -1000, y: -1000 }, { x: 2000, y: 2000 });

describe('drawConstructionGeom (construction_geom.cpp:76-165)', () => {
  it('draws a bare SEG drawable at its own endpoints, worldScale dividing the pen width', () => {
    const geom = new CONSTRUCTION_GEOM();
    const seg = new SEG({ x: 1, y: 2 }, { x: 3, y: 4 });
    geom.AddDrawable(seg, false, 4);
    geom.SetColor('#ff0000');

    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport: bigViewport, worldScale: 2 });

    expect(ctx.calls).toContainEqual({ op: 'moveTo', args: [1, 2] });
    expect(ctx.calls).toContainEqual({ op: 'lineTo', args: [3, 4] });
    expect(ctx.strokeStyles).toContain('#ff0000');
  });

  it('draws a LINE clipped to the viewport, not its own arbitrary contained segment', () => {
    const geom = new CONSTRUCTION_GEOM();
    // The 45 degree line through the origin.
    const line = new LINE({ x: 0, y: 0 }, { x: 1, y: 1 });
    geom.AddDrawable(line, true, 1);
    geom.SetPersistentColor('#00ff00');

    const viewport = new BOX2I({ x: -100, y: -100 }, { x: 200, y: 200 });
    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport, worldScale: 1 });

    const points = new Set(
      ctx.calls
        .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
        .map((c) => `${c.args[0]},${c.args[1]}`),
    );
    expect(points).toEqual(new Set(['-100,-100', '100,100']));
  });

  it('draws a HALF_LINE clipped to the viewport, starting at the ray origin', () => {
    const geom = new CONSTRUCTION_GEOM();
    // A ray starting at (0,0) heading toward +x.
    const ray = new HALF_LINE({ x: 0, y: 0 }, { x: 1, y: 0 });
    geom.AddDrawable(ray, true, 1);

    const viewport = new BOX2I({ x: -100, y: -100 }, { x: 200, y: 200 });
    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport, worldScale: 1 });

    const points = new Set(
      ctx.calls
        .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
        .map((c) => `${c.args[0]},${c.args[1]}`),
    );
    expect(points).toEqual(new Set(['0,0', '100,0']));
  });

  it('draws a CIRCLE at its own center and radius', () => {
    const geom = new CONSTRUCTION_GEOM();
    geom.AddDrawable(new CIRCLE({ x: 5, y: 5 }, 10), true, 1);

    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport: bigViewport, worldScale: 1 });

    expect(ctx.calls).toContainEqual({ op: 'arc', args: [5, 5, 10, 0, Math.PI * 2] });
  });

  it('draws a SHAPE_ARC using its own center/radius/start/central angle', () => {
    const geom = new CONSTRUCTION_GEOM();
    const arc = new SHAPE_ARC({ x: 0, y: 0 }, { x: 100, y: 0 }, new EDA_ANGLE(90));
    geom.AddDrawable(arc, true, 1);

    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport: bigViewport, worldScale: 1 });

    const center = arc.GetCenter();
    const startDeg = arc.GetStartAngle().AsDegrees();
    const sweepDeg = arc.GetCentralAngle().AsDegrees();
    expect(ctx.calls).toContainEqual({
      op: 'arc',
      args: [
        center.x,
        center.y,
        arc.GetRadius(),
        (startDeg * Math.PI) / 180,
        ((startDeg + sweepDeg) * Math.PI) / 180,
        sweepDeg < 0,
      ],
    });
  });

  it('draws a plain VECTOR2I as a cross of size 16/worldScale', () => {
    const geom = new CONSTRUCTION_GEOM();
    geom.AddDrawable({ x: 50, y: 60 }, true, 1);

    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport: bigViewport, worldScale: 2 }); // size 16/2=8, half=4

    expect(ctx.calls).toContainEqual({ op: 'moveTo', args: [46, 60] });
    expect(ctx.calls).toContainEqual({ op: 'lineTo', args: [54, 60] });
    expect(ctx.calls).toContainEqual({ op: 'moveTo', args: [50, 56] });
    expect(ctx.calls).toContainEqual({ op: 'lineTo', args: [50, 64] });
  });

  it('suppresses a drawable SEG collinear with the active snap line, draws a non-collinear one', () => {
    const geom = new CONSTRUCTION_GEOM();
    geom.SetSnapLine(new SEG({ x: 0, y: 0 }, { x: 0, y: 20 })); // length 20 >= 10: "have" a snap line
    geom.AddDrawable(new SEG({ x: 0, y: 5 }, { x: 0, y: 15 }), false, 1); // collinear (same vertical line)
    geom.AddDrawable(new SEG({ x: -10, y: 0 }, { x: 10, y: 0 }), false, 1); // not collinear (horizontal)

    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport: bigViewport, worldScale: 1 });

    const points = ctx.calls
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
      .map((c) => `${c.args[0]},${c.args[1]}`);
    expect(points).not.toContain('0,5');
    expect(points).not.toContain('0,15');
    expect(points).toContain('-10,0');
    expect(points).toContain('10,0');
  });

  it('skips a degenerate (zero-length) snap guide, draws a real one clipped to the viewport', () => {
    const geom = new CONSTRUCTION_GEOM();
    geom.SetSnapGuides([
      { Segment: new SEG({ x: 1, y: 1 }, { x: 1, y: 1 }), Color: '#abcabc', LineWidth: 3 },
      { Segment: new SEG({ x: -5, y: 0 }, { x: 5, y: 0 }), Color: '#0000ff', LineWidth: 7 },
    ]);

    const viewport = new BOX2I({ x: -100, y: -100 }, { x: 200, y: 200 });
    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport, worldScale: 1 });

    const points = new Set(
      ctx.calls
        .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
        .map((c) => `${c.args[0]},${c.args[1]}`),
    );
    // The degenerate guide never reaches a moveTo/lineTo at (1,1); the real
    // one clips to the box's horizontal chord through y=0.
    expect(points.has('1,1')).toBe(false);
    expect(points).toEqual(new Set(['-100,0', '100,0']));
    expect(ctx.strokeStyles).toContain('#0000ff');
    expect(ctx.strokeStyles).not.toContain('#abcabc');
  });

  it('omits the snap-line origin marker when the line is too short on screen, shows it otherwise', () => {
    // worldScale=0.5: omitStartMarkerIfWithinLength = 8/0.5 = 16.
    const shortGeom = new CONSTRUCTION_GEOM();
    shortGeom.SetSnapLine(new SEG({ x: 0, y: 0 }, { x: 12, y: 0 })); // length 12 (>=10, "have"; <16, omit marker)
    const shortCtx = recorder();
    drawConstructionGeom(shortCtx, shortGeom, { viewport: bigViewport, worldScale: 0.5 });
    expect(shortCtx.calls.some((c) => c.op === 'arc')).toBe(false);

    const longGeom = new CONSTRUCTION_GEOM();
    longGeom.SetSnapLine(new SEG({ x: 0, y: 0 }, { x: 20, y: 0 })); // length 20 (>=16, marker shown)
    const longCtx = recorder();
    drawConstructionGeom(longCtx, longGeom, { viewport: bigViewport, worldScale: 0.5 });
    // marker circle radius = snapOriginMarkerSize/2 = (16/0.5)/2 = 16, at the origin (0,0).
    expect(longCtx.calls).toContainEqual({ op: 'arc', args: [0, 0, 16, 0, Math.PI * 2] });
  });

  it('with no snap line, draws no marker and no dashed geometry from it', () => {
    const geom = new CONSTRUCTION_GEOM();
    const ctx = recorder();
    drawConstructionGeom(ctx, geom, { viewport: bigViewport, worldScale: 1 });
    expect(ctx.calls).toEqual([]);
  });
});
