// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_DRAW_PANEL_GAL::Refresh` coalesced to one paint per animation frame.
 *
 * Upstream repaints inside Refresh, synchronously, and vsync throttles it: SwapBuffers blocks
 * until the display takes the frame. A browser never blocks, so every wheel or motion event
 * repainted in full and a fast wheel queued repaints faster than they finished - the zoom lag.
 * Outside an animation frame Refresh now asks for one; inside it (and in onIdle, which runs on
 * one) it paints as upstream.
 *
 * The panel's constructor needs WebGL2, so the methods run on an object built from its
 * prototype holding the members they read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDA_DRAW_PANEL_GAL } from '@ziroeda/common/draw_panel_gal.js';

let frames: (() => void)[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (aCb: () => void) => {
    frames.push(aCb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

/** Run the frames queued so far, as the browser does at its next frame. */
function nextFrame(): void {
  const due = frames;
  frames = [];
  for (const cb of due) cb();
}

function panel() {
  let paints = 0;
  const p = Object.create(EDA_DRAW_PANEL_GAL.prototype) as EDA_DRAW_PANEL_GAL &
    Record<string, unknown>;
  Object.assign(p, {
    m_refreshFrameHandle: null,
    m_inAnimationFrame: false,
    m_lastRepaintEnd: 0,
    m_gal: { IsInitialized: () => true, GetSwapInterval: () => 1 },
    m_refreshTimer: { IsRunning: () => false, StartOnce: () => {} },
    DoRePaint: (): boolean => {
      paints++;
      return true;
    },
  });
  return { p, paints: () => paints };
}

describe('EDA_DRAW_PANEL_GAL::Refresh', () => {
  it('paints nothing during the event, then once in the next frame however often it was asked', () => {
    const { p, paints } = panel();

    for (let i = 0; i < 5; i++) p.Refresh();

    expect(paints()).toBe(0);
    expect(frames).toHaveLength(1);

    nextFrame();

    expect(paints()).toBe(1);
    expect(frames).toHaveLength(0);
  });

  it('asks for a new frame after the last one painted', () => {
    const { p, paints } = panel();

    p.Refresh();
    nextFrame();
    p.Refresh();

    expect(frames).toHaveLength(1);
    nextFrame();
    expect(paints()).toBe(2);
  });

  it('paints at once inside an animation frame, as upstream does', () => {
    const { p, paints } = panel();
    (p as unknown as { m_inAnimationFrame: boolean }).m_inAnimationFrame = true;

    p.Refresh();

    expect(paints()).toBe(1);
    expect(frames).toHaveLength(0);
  });
});
