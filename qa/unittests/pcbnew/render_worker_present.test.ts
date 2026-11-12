// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The render worker's canvas held to the window's view between frames (not KiCad's: KiCad
 * draws the board and its overlay in one place). The window draws the overlay - the cursor,
 * the origins, the ratsnest - in the view the user has just zoomed to; the worker's canvas
 * still shows the frame it last drew. presentTransform moves that frame to where the current
 * view puts it. Checked against VIEW itself: a world point the shown view draws at s, carried
 * by the transform, must land where the current view draws it.
 */
import { describe, expect, it } from 'vitest';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import type { RENDER_VIEW_STATE } from '@ziroeda/pcbnew/browser/render_worker.js';
import { presentTransform } from '@ziroeda/pcbnew/browser/render_worker_host.js';

/** A GAL whose screen is the size it is given, as OPENGL_GAL::ResizeScreen makes it. */
class STUB_GAL extends GAL {
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
  }
}

const W = 1201;
const H = 777;

function state(
  aCenter: { x: number; y: number },
  aScale: number,
  aMirrorX = false,
): RENDER_VIEW_STATE {
  return {
    center: aCenter,
    scale: aScale,
    mirrorX: aMirrorX,
    mirrorY: false,
    width: W,
    height: H,
    grid: { size: { x: 1, y: 1 }, origin: { x: 0, y: 0 }, visible: true },
    gal: {},
  };
}

function viewOf(aState: RENDER_VIEW_STATE): VIEW {
  const gal = new STUB_GAL(new GAL_DISPLAY_OPTIONS());
  gal.ResizeScreen(aState.width, aState.height);
  const view = new VIEW();
  view.SetGAL(gal);
  view.SetMirror(aState.mirrorX, aState.mirrorY);
  view.SetScale(aState.scale);
  view.SetCenter(aState.center);
  return view;
}

function parse(aMatrix: string): [number, number, number] {
  const m = /^matrix\(([^,]+), 0, 0, ([^,]+), ([^,]+), ([^)]+)\)$/.exec(aMatrix);
  expect(m, aMatrix).not.toBeNull();
  expect(Number(m![1])).toBe(Number(m![2]));
  return [Number(m![1]), Number(m![3]), Number(m![4])];
}

// Scales inside VIEW's default limits (0.2 .. 50000): one outside them is clamped, and the two
// views would no longer be the states they claim to be.
const POINTS = [
  { x: 0, y: 0 },
  { x: 250_000_000, y: -120_000_000 },
  { x: -700_000_000, y: 900_000_000 },
];

describe('presentTransform', () => {
  it.each([
    ['a zoom in about the centre', state({ x: 1e8, y: 2e8 }, 1), state({ x: 1e8, y: 2e8 }, 3)],
    ['a zoom out', state({ x: 0, y: 0 }, 4), state({ x: 0, y: 0 }, 1.3)],
    ['a pan', state({ x: 0, y: 0 }, 2), state({ x: 3e8, y: -1e8 }, 2)],
    [
      'a zoom at the cursor (zoom and pan)',
      state({ x: 5e7, y: 5e7 }, 1),
      state({ x: 1.5e8, y: -2e7 }, 2.5),
    ],
    ['a flipped board view', state({ x: 1e8, y: 0 }, 2, true), state({ x: -2e8, y: 4e7 }, 5, true)],
  ])('puts %s where the current view draws it', (_name, shown, now) => {
    const vShown = viewOf(shown);
    const vNow = viewOf(now);
    const [r, tx, ty] = parse(presentTransform(shown, now, vNow.ToScreen({ x: 1, y: 1 }, false)));
    for (const w of POINTS) {
      const s = vShown.ToScreen(w);
      const want = vNow.ToScreen(w);
      expect(r * s.x + tx).toBeCloseTo(want.x, 3);
      expect(r * s.y + ty).toBeCloseTo(want.y, 3);
    }
  });

  it('is none when the frame shows the current view, or there is no frame yet', () => {
    const v = state({ x: 1, y: 2 }, 2);
    expect(presentTransform(v, { ...v }, { x: 2e-4, y: 2e-4 })).toBe('none');
    expect(presentTransform(null, v, { x: 2e-4, y: 2e-4 })).toBe('none');
  });

  it('waits for the next frame across a flip or a resize, which no scale and shift can map', () => {
    const v = state({ x: 0, y: 0 }, 2);
    // Moved as well as flipped, so a transform that ignored the flip would not come out as none.
    expect(
      presentTransform(
        v,
        { ...v, mirrorX: true, center: { x: 5e7, y: 0 } },
        { x: -1.4e-6, y: 1.4e-6 },
      ),
    ).toBe('none');
    expect(presentTransform(v, { ...v, width: W + 10 }, { x: 2e-4, y: 2e-4 })).toBe('none');
  });
});
