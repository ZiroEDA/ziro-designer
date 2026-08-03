// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Grabbing and dragging point-editor handles.
 * Counterparts: `EDIT_POINTS::FindPoint` and `PCB_POINT_EDITOR`'s drag arithmetic.
 *
 * Two behaviours here are easy to get subtly wrong and impossible to notice from
 * a screenshot: a corner and an edge-midpoint handle can be *equidistant* on a
 * short edge, and an edge handle grabbed off-centre must not teleport. Both are
 * pinned below.
 *
 * Fixtures are in millimetres — a tolerance measured in raw IU would be
 * nanometres across and every hit test would miss.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { BoardEditHandle } from '@ziroeda/pcbnew';
import {
  handleAtPoint,
  handleDragTarget,
  handleTolerance,
} from '@ziroeda/designer/src/editors/pcb/point_edit_canvas.js';

const MM = (n: number): number => mmToIU(n);

const point = (x: number, y: number, index = 0): BoardEditHandle => ({
  kind: 'point',
  index,
  at: { x: MM(x), y: MM(y) },
});
const line = (x: number, y: number, index = 0): BoardEditHandle => ({
  kind: 'line',
  index,
  at: { x: MM(x), y: MM(y) },
});

describe('how big the grab target is', () => {
  it('shrinks in board units as you zoom in', () => {
    // The handle stays the same size on screen, so at 10x zoom it covers a
    // tenth as much board.
    expect(handleTolerance(8, 1)).toBe(8);
    expect(handleTolerance(8, 10)).toBe(0.8);
  });

  it('grows in board units as you zoom out', () => {
    expect(handleTolerance(8, 0.5)).toBe(16);
  });
});

describe('which handle the cursor is on', () => {
  const handles = [point(0, 0), point(10, 0), line(5, 0)];

  it('finds the one under the cursor', () => {
    expect(handleAtPoint(handles, { x: MM(10), y: 0 }, MM(1))).toBe(handles[1]);
  });

  it('finds the nearest when several are in range', () => {
    // Nearer to the edge handle at 5 than to either corner.
    expect(handleAtPoint(handles, { x: MM(5.2), y: 0 }, MM(4))).toBe(handles[2]);
  });

  it('finds nothing when the cursor is off every handle', () => {
    expect(handleAtPoint(handles, { x: MM(5), y: MM(50) }, MM(1))).toBeNull();
  });

  it('finds nothing among no handles', () => {
    expect(handleAtPoint([], { x: 0, y: 0 }, MM(1))).toBeNull();
  });

  it('takes a handle exactly on the tolerance', () => {
    // The boundary is inclusive; a handle exactly a tolerance away is still
    // grabbable, which is what makes the target feel its stated size.
    expect(handleAtPoint([point(1, 0)], { x: 0, y: 0 }, MM(1))).not.toBeNull();
  });

  it('rejects a handle just outside it', () => {
    expect(handleAtPoint([point(1.001, 0)], { x: 0, y: 0 }, MM(1))).toBeNull();
  });
});

describe('a tie between a corner and an edge', () => {
  // The case that matters: on a short edge the corner and the edge-midpoint
  // handle can be the same distance from the cursor. If the edge wins, the
  // corner becomes ungrabbable and the item can only ever be moved, not
  // reshaped.
  it('goes to the corner whichever order they come in', () => {
    const corner = point(0, 0);
    const edge = line(2, 0);
    const cursor = { x: MM(1), y: 0 };

    expect(handleAtPoint([corner, edge], cursor, MM(5))).toBe(corner);
    expect(handleAtPoint([edge, corner], cursor, MM(5))).toBe(corner);
  });

  it('still lets a strictly nearer edge win', () => {
    // The tie-break must not become "corners always win" — an edge the cursor
    // is plainly closer to is the one being pointed at.
    const corner = point(0, 0);
    const edge = line(2, 0);

    expect(handleAtPoint([corner, edge], { x: MM(1.9), y: 0 }, MM(5))).toBe(edge);
  });
});

describe('where a drag puts the handle', () => {
  it('puts a point handle on the cursor', () => {
    const h = point(0, 0);
    const target = handleDragTarget(h, { x: MM(0), y: MM(0) }, { x: MM(7), y: MM(3) });

    expect(target).toEqual({ x: MM(7), y: MM(3) });
  });

  it('puts a point handle on the cursor even when grabbed off-centre', () => {
    // A corner is the thing being positioned, so it goes where you point,
    // regardless of where within its box you clicked.
    const h = point(0, 0);
    const target = handleDragTarget(h, { x: MM(0.4), y: MM(0.4) }, { x: MM(7), y: MM(3) });

    expect(target).toEqual({ x: MM(7), y: MM(3) });
  });

  it('moves an edge handle by the cursor delta, not onto the cursor', () => {
    // Grabbed 2 mm right of the midpoint and dragged 5 mm down: the edge should
    // follow the mouse, ending 5 mm down — not jump 2 mm right to catch up.
    const h = line(10, 0);
    const target = handleDragTarget(h, { x: MM(12), y: MM(0) }, { x: MM(12), y: MM(5) });

    expect(target).toEqual({ x: MM(10), y: MM(5) });
  });

  it('leaves an edge handle alone when the cursor has not moved', () => {
    const h = line(10, 0);
    const target = handleDragTarget(h, { x: MM(12), y: MM(3) }, { x: MM(12), y: MM(3) });

    expect(target).toEqual({ x: MM(10), y: MM(0) });
  });

  it('agrees with the cursor for an edge grabbed exactly on its midpoint', () => {
    // The two rules coincide only in this one case, which is why a fixture that
    // grabs the midpoint proves nothing about the delta behaviour.
    const h = line(10, 0);
    const target = handleDragTarget(h, { x: MM(10), y: MM(0) }, { x: MM(14), y: MM(6) });

    expect(target).toEqual({ x: MM(14), y: MM(6) });
  });
});
