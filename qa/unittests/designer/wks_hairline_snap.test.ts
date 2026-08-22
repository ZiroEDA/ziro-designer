// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hairlines in the drawing sheet land on the device pixel grid.
 *
 * Measured against a live pl_editor showing the same A3 page: KiCad puts a
 * border line in ONE pixel, rgb(132,0,0), with untouched background either
 * side. Ours put rgb(139,15,15) in one pixel and bled rgb(238,229,224) into the
 * neighbour, because a 1-device-pixel stroke centred on an integer coordinate
 * straddles two pixels and Canvas 2D antialiases both. Multiplied over every
 * border line, tick and glyph stem, that is the whole of the "blurry" look.
 *
 * The renderer is shared — the schematic, PCB and GerbView canvases draw their
 * sheet through this same function — so this is pinned here rather than in any
 * one editor.
 */
import { describe, expect, it } from 'vitest';
import type { DsDrawItem } from '@ziroeda/common';
import { drawDrawingSheetItems } from '@ziroeda/designer/src/editors/drawingsheet/wksRender.js';

interface StrokeCall {
  op: 'line' | 'rect';
  coords: number[];
  lineWidth: number;
}

/**
 * The smallest CanvasRenderingContext2D that this function actually touches,
 * recording the geometry it is handed. `getTransform` returns whatever
 * `setTransform` last set, so the snapping code sees a real matrix.
 */
function recorder(scale: number, tx: number, ty: number) {
  const calls: StrokeCall[] = [];
  let m = { a: scale, b: 0, c: 0, d: scale, e: tx, f: ty };
  const saved: (typeof m)[] = [];
  let path: number[] = [];
  const ctx = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    lineCap: '',
    lineJoin: '',
    getTransform: () => ({ ...m }) as unknown as DOMMatrix,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      m = { a, b, c, d, e, f };
    },
    save: () => saved.push({ ...m }),
    restore: () => {
      const p = saved.pop();
      if (p) m = p;
    },
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push(x, y),
    lineTo: (x: number, y: number) => path.push(x, y),
    closePath: () => {},
    stroke: () => calls.push({ op: 'line', coords: [...path], lineWidth: ctx.lineWidth }),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      calls.push({ op: 'rect', coords: [x, y, w, h], lineWidth: ctx.lineWidth }),
    fill: () => {},
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    strokeText: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Every coordinate a snapped hairline emits should sit on a pixel centre. */
const onPixelCentre = (v: number): boolean => Math.abs(v - (Math.floor(v) + 0.5)) < 1e-9;

describe('a vertical hairline', () => {
  // A world x that maps to a device x of 100.27 — the fractional case that was
  // blurring. scale 2.7, tx 10  ->  33.4 * 2.7 + 10 = 100.18.
  const items: DsDrawItem[] = [
    { kind: 'line', src: 0, a: { x: 33.4, y: 5 }, b: { x: 33.4, y: 80 }, width: 0.15 },
  ];

  it('is drawn on a pixel centre, not where the maths landed', () => {
    const { ctx, calls } = recorder(2.7, 10, 4);
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 2.7 });
    expect(calls).toHaveLength(1);
    const [x0, , x1] = calls[0]!.coords;
    expect(onPixelCentre(x0!), `x0=${x0}`).toBe(true);
    expect(x0).toBe(x1); // still vertical
  });

  it('and is exactly one device pixel wide', () => {
    const { ctx, calls } = recorder(2.7, 10, 4);
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 2.7 });
    expect(calls[0]!.lineWidth).toBe(1);
  });

  it('and does not move by more than half a pixel', () => {
    // Snapping must not shift geometry visibly; the most it may move is the
    // half pixel that puts it on a centre.
    const { ctx, calls } = recorder(2.7, 10, 4);
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 2.7 });
    const want = 33.4 * 2.7 + 10;
    expect(Math.abs(calls[0]!.coords[0]! - want)).toBeLessThanOrEqual(0.5);
  });
});

describe('a rectangle', () => {
  const items: DsDrawItem[] = [
    { kind: 'rect', src: 0, a: { x: 2.3, y: 2.3 }, b: { x: 110.7, y: 34.9 }, width: 0.15 },
  ];

  it('has all four sides on pixel centres', () => {
    const { ctx, calls } = recorder(3.1, 7.4, 2.9);
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 3.1 });
    expect(calls).toHaveLength(1);
    const [x, y, w, h] = calls[0]!.coords as [number, number, number, number];
    // left/top are centres, and width/height are whole pixels so right/bottom
    // are centres too — a rect snapped on two sides only would be ragged.
    expect(onPixelCentre(x), `x=${x}`).toBe(true);
    expect(onPixelCentre(y), `y=${y}`).toBe(true);
    expect(Number.isInteger(w), `w=${w}`).toBe(true);
    expect(Number.isInteger(h), `h=${h}`).toBe(true);
  });
});

describe('what is deliberately NOT snapped', () => {
  it('a stroke wider than a pixel is left alone', () => {
    // It already covers whole pixels; nudging it would only move it.
    const items: DsDrawItem[] = [
      { kind: 'line', src: 0, a: { x: 10, y: 5 }, b: { x: 10, y: 80 }, width: 4 },
    ];
    const { ctx, calls } = recorder(3, 0.3, 0.3);
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 3 });
    expect(calls[0]!.lineWidth).toBe(4); // world units, untouched
    expect(calls[0]!.coords[0]).toBe(10); // world coords, untouched
  });

  it('a diagonal is left alone — there is no pixel row to sit in', () => {
    const items: DsDrawItem[] = [
      { kind: 'line', src: 0, a: { x: 1, y: 1 }, b: { x: 40, y: 27 }, width: 0.15 },
    ];
    const { ctx, calls } = recorder(2.7, 10, 4);
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 2.7 });
    expect(calls[0]!.coords).toStrictEqual([1, 1, 40, 27]);
  });
});

describe('a context that cannot report its transform', () => {
  // Several suites assert what this renderer draws using a recording double,
  // and those doubles have no `getTransform`. Snapping needs a device position,
  // so with no matrix there is nothing to snap to and the world-space stroke is
  // both the only option and the right one. Pinned so the guard cannot quietly
  // become "snapping is off everywhere".
  const items: DsDrawItem[] = [
    { kind: 'line', src: 0, a: { x: 33.4, y: 5 }, b: { x: 33.4, y: 80 }, width: 0.15 },
  ];

  it('gets the ordinary world-space stroke', () => {
    const { ctx, calls } = recorder(2.7, 10, 4);
    // biome-ignore lint/performance/noDelete: modelling a double that lacks it
    delete (ctx as unknown as Record<string, unknown>).getTransform;
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 2.7 });
    expect(calls[0]!.coords).toStrictEqual([33.4, 5, 33.4, 80]);
  });

  it('while the same items DO snap on a context that can', () => {
    // The other half: without this, a guard that always returned null would
    // pass the test above and silently disable the fix.
    const { ctx, calls } = recorder(2.7, 10, 4);
    drawDrawingSheetItems(ctx, items, new Set(), { minWidth: 1 / 2.7 });
    expect(calls[0]!.coords).not.toStrictEqual([33.4, 5, 33.4, 80]);
    expect(onPixelCentre(calls[0]!.coords[0]!)).toBe(true);
  });
});
