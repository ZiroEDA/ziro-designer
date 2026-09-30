// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * CENTRELINE_RECT_ITEM (common/preview_items/centreline_rect_item.cpp): the
 * rectangle along a centre line, whose corners are worked by hand from
 * `getRectangleAlongCentreLine`.
 */
import { describe, expect, it } from 'vitest';
import {
  drawCentrelineRectItem,
  getRectangleAlongCentreLine,
} from '@ziroeda/common/preview_items/centreline_rect_item.js';

describe('getRectangleAlongCentreLine', () => {
  it('lays the rectangle out as the C++ diagram says, for a horizontal centre line', () => {
    // cl = (100, 0); side = cl rotated by -90 deg = (0, 100), scaled by 0.5 = (0, 50).
    // pt0 = s + side/2 = (0, 25); pt1 = pt0 + cl; pt2 = pt1 - side; pt3 = pt2 - cl.
    expect(getRectangleAlongCentreLine({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5)).toEqual([
      { x: 0, y: 25 },
      { x: 100, y: 25 },
      { x: 100, y: -25 },
      { x: 0, y: -25 },
    ]);
  });

  it('rotates the side with the centre line, for a vertical one', () => {
    // cl = (0, 100); RotatePoint( cl, -ANGLE_90 ) is (-y, x) = (-100, 0); * 0.5 = (-50, 0).
    expect(getRectangleAlongCentreLine({ x: 10, y: 10 }, { x: 10, y: 110 }, 0.5)).toEqual([
      { x: -15, y: 10 },
      { x: -15, y: 110 },
      { x: 35, y: 110 },
      { x: 35, y: 10 },
    ]);
  });

  it('never returns a degenerate polygon: a zero centre line becomes (1, 0)', () => {
    const pts = getRectangleAlongCentreLine({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.5);
    expect(pts[1]!.x - pts[0]!.x).toBe(1);
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(4);
  });
});

describe('drawCentrelineRectItem', () => {
  it('draws the centre line first and the outline second, with the item pen', () => {
    const calls: string[] = [];
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      setTransform: () => {},
      beginPath: () => calls.push('begin'),
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
      closePath: () => calls.push('close'),
      stroke: () => calls.push('stroke'),
      fill: () => calls.push('fill'),
      set lineWidth(w: number) {
        calls.push(`w${w}`);
      },
      set strokeStyle(c: string) {
        calls.push(`s:${c}`);
      },
      set fillStyle(c: string) {
        calls.push(`f:${c}`);
      },
    } as unknown as CanvasRenderingContext2D;
    drawCentrelineRectItem(ctx, {
      origin: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      aspect: 0.5,
      toPx: (p) => ({ x: p.x, y: p.y }),
      strokeColor: 'S',
      fillColor: 'F',
      linePx: 0.2,
    });
    // The pen floor is one whole device pixel; the line goes first.
    expect(calls).toEqual([
      'save',
      'w1',
      's:S',
      'f:F',
      'begin',
      'M0,0',
      'L100,0',
      'stroke',
      'begin',
      'M0,25',
      'L100,25',
      'L100,-25',
      'L0,-25',
      'close',
      'fill',
      'stroke',
      'restore',
    ]);
  });
});
