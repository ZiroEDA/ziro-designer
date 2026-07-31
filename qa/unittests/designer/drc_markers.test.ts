// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRC marker painting (designer/src/editors/pcb/renderBoard.ts
 * drawDrcMarkers): mirrors pcb_painter.cpp draw(PCB_MARKER*), the
 * MARKER_BASE MarkerShapeCorners polygon at MarkerScale() =
 * SCALING_FACTOR/sqrt(zoom) (pcb_marker.cpp SCALING_FACTOR = 0.1625mm), a
 * LAYER_MARKER_SHADOWS stroked outline in the background color at alpha 0.6
 * with line width MarkerScale(), severity fills in GAL layer order
 * (exclusions under warnings under errors), and the active marker repainted
 * last in LAYER_DRC_HIGHLIGHTED with its collision 'X' (half-length
 * 2.5·MarkerScale(), stroke MarkerScale()/2).
 */
import { PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import { describe, it, expect } from 'vitest';
import { drawDrcMarkers } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { PCB_BACKGROUND, PCB_SPECIAL } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';

interface Call {
  op: string;
  args?: unknown[];
  value?: unknown;
}

/** A 2D context stand-in recording every method call and property set. */
function recorder(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        return (...args: unknown[]) => calls.push({ op: String(prop), args });
      },
      set(_t, prop, value) {
        calls.push({ op: `set:${String(prop)}`, value });
        return true;
      },
    },
  ) as CanvasRenderingContext2D & { __calls: Call[] };
}

const COLORS = { background: PCB_BACKGROUND, ...PCB_SPECIAL };

// marker_base.cpp MarkerShapeCorners.
const CORNERS: [number, number][] = [
  [0, 0],
  [8, 1],
  [4, 3],
  [13, 8],
  [9, 9],
  [8, 13],
  [3, 4],
  [1, 8],
  [0, 0],
];

describe('drawDrcMarkers', () => {
  const view = { scale: 0.01, tx: 5, ty: 7 };
  const dpr = 1;
  // MarkerScale() = mmToIU(0.1625) / sqrt(zoom); GAL zoom factor for a
  // view at `scale` device px per IU (1 IU = 100 nm) on a 96 dpi screen:
  // zoom = scale·IU_PER_MM·25.4/(96·dpr).
  const zoom = (view.scale * PCB_IU_PER_MM * 25.4) / (96 * dpr);
  const scaleIU = (0.1625 * PCB_IU_PER_MM) / Math.sqrt(zoom);

  it('paints nothing without markers', () => {
    const ctx = recorder();
    drawDrcMarkers(ctx, [], view, dpr, COLORS);
    expect(ctx.__calls).toEqual([]);
  });

  it('shadow pass: MarkerShapeCorners at MarkerScale(), background @0.6, width MarkerScale()', () => {
    const ctx = recorder();
    const pos = { x: 100000, y: 50000 };
    drawDrcMarkers(ctx, [{ pos, severity: 'error' }], view, dpr, COLORS);
    const calls = ctx.__calls;

    const shadow = calls.find((c) => c.op === 'set:strokeStyle');
    expect(shadow?.value).toBe('rgba(0,16,35,0.6)'); // PCB_BACKGROUND @0.6
    const width = calls.find((c) => c.op === 'set:lineWidth');
    expect(width?.value).toBeCloseTo(scaleIU * view.scale, 10);

    // The traced polygon is the exact 9-corner shape scaled by MarkerScale().
    const pts = calls
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
      .map((c) => c.args as [number, number]);
    expect(pts.length).toBeGreaterThanOrEqual(CORNERS.length);
    CORNERS.forEach(([cx, cy], i) => {
      expect(pts[i]![0]).toBeCloseTo((pos.x + cx * scaleIU) * view.scale + view.tx, 8);
      expect(pts[i]![1]).toBeCloseTo((pos.y + cy * scaleIU) * view.scale + view.ty, 8);
    });
    expect(calls.some((c) => c.op === 'stroke')).toBe(true);
    expect(calls.filter((c) => c.op === 'fill').length).toBe(1);
  });

  it('fills severities bottom-up (exclusion, warning, error) after all shadows', () => {
    const ctx = recorder();
    drawDrcMarkers(
      ctx,
      [
        { pos: { x: 0, y: 0 }, severity: 'error' },
        { pos: { x: 1000, y: 0 }, severity: 'warning' },
        { pos: { x: 2000, y: 0 }, severity: 'exclusion' },
      ],
      view,
      dpr,
      COLORS,
    );
    const calls = ctx.__calls;
    // One shadow stroke per marker, before any fill.
    const strokes = calls.map((c, i) => [c.op, i] as const).filter(([op]) => op === 'stroke');
    const fills = calls.map((c, i) => [c.op, i] as const).filter(([op]) => op === 'fill');
    expect(strokes.length).toBe(3);
    expect(fills.length).toBe(3);
    expect(Math.max(...strokes.map(([, i]) => i))).toBeLessThan(
      Math.min(...fills.map(([, i]) => i)),
    );
    // Fill colors in GAL bottom-up order.
    const fillStyles = calls.filter((c) => c.op === 'set:fillStyle').map((c) => c.value);
    expect(fillStyles).toEqual([
      PCB_SPECIAL.drcExclusion,
      PCB_SPECIAL.drcWarning,
      PCB_SPECIAL.drcError,
    ]);
  });

  it('active marker repaints last in DRC_HIGHLIGHTED with the collision X', () => {
    const ctx = recorder();
    const pos = { x: 100000, y: 50000 };
    drawDrcMarkers(
      ctx,
      [
        { pos: { x: 0, y: 0 }, severity: 'error' },
        { pos, severity: 'error', active: true },
      ],
      view,
      dpr,
      COLORS,
    );
    const calls = ctx.__calls;
    // The last fillStyle is the highlighted color, set after the severity fills.
    const fillStyles = calls.filter((c) => c.op === 'set:fillStyle').map((c) => c.value);
    expect(fillStyles[fillStyles.length - 1]).toBe(PCB_SPECIAL.drcHighlighted);
    // The active marker is NOT drawn in the plain error pass (one error fill),
    // then once highlighted: two fills total.
    expect(calls.filter((c) => c.op === 'fill').length).toBe(2);

    // Collision 'X': two diagonals of half-length 2.5·MarkerScale() around the
    // marker position, stroked at MarkerScale()/2 in the highlighted color.
    const len = 2.5 * scaleIU;
    const xy = (dx: number, dy: number): [number, number] => [
      (pos.x + dx) * view.scale + view.tx,
      (pos.y + dy) * view.scale + view.ty,
    ];
    const segs = calls
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
      .map((c) => c.args as [number, number]);
    const near = (a: [number, number], b: [number, number]): boolean =>
      Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8;
    expect(segs.some((p) => near(p, xy(-len, -len)))).toBe(true);
    expect(segs.some((p) => near(p, xy(len, len)))).toBe(true);
    expect(segs.some((p) => near(p, xy(-len, len)))).toBe(true);
    expect(segs.some((p) => near(p, xy(len, -len)))).toBe(true);
    const lineWidths = calls.filter((c) => c.op === 'set:lineWidth').map((c) => c.value as number);
    expect(lineWidths[lineWidths.length - 1]).toBeCloseTo((scaleIU / 2) * view.scale, 10);
    // Highlighted stroke color for the X.
    const strokeStyles = calls.filter((c) => c.op === 'set:strokeStyle').map((c) => c.value);
    expect(strokeStyles[strokeStyles.length - 1]).toBe(PCB_SPECIAL.drcHighlighted);
  });

  it('mirrors X in the flipped view like the world transform', () => {
    const ctx = recorder();
    const pos = { x: 100000, y: 50000 };
    drawDrcMarkers(ctx, [{ pos, severity: 'warning' }], { ...view, flipX: true }, dpr, COLORS);
    const pts = ctx.__calls
      .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
      .map((c) => c.args as [number, number]);
    // First corner (0,0): x = pos.x·(−scale)+tx.
    expect(pts[0]![0]).toBeCloseTo(pos.x * -view.scale + view.tx, 8);
    expect(pts[0]![1]).toBeCloseTo(pos.y * view.scale + view.ty, 8);
  });
});
