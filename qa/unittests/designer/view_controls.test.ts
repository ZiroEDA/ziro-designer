// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::WX_VIEW_CONTROLS::onWheel` and `COMMON_TOOLS::doZoomFit`.
 *
 * Upstream there is one wheel handler in the whole suite
 * (`common/view/wx_view_controls.cpp:418-545`), constructed by
 * `EDA_DRAW_PANEL_GAL` for every frame, and one Zoom to Fit
 * (`common/tool/common_tools.cpp:322-408`). We had five wheel handlers, of
 * which two read the preferences, and five fits with four different margins -
 * so "Preferences -> Mouse and Touchpad" changed the schematic and nothing
 * else. These are the tests for the single module that replaced them: every
 * setting is asserted to CHANGE the outcome when it is toggled, because a
 * setting that is read and then ignored still passes a test that only checks
 * the default.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INPUT_PREFS,
  fitMarginScaleFactor,
  wheelAction,
  wheelModifier,
  zoomFitView,
  zoomScaleForRotation,
  type FitFrame,
  type InputPrefs,
  type WheelAction,
  type WheelInput,
} from '@ziroeda/designer/src/ui/view_controls.js';

/** A 1000x800 device-pixel canvas, big enough that the <768 margin rule is off. */
const VIEWPORT = { width: 1000, height: 800 };

const prefs = (over: Partial<InputPrefs> = {}): InputPrefs => ({ ...DEFAULT_INPUT_PREFS, ...over });

/** One notch of wheel-down, the DOM's ~100 px. */
const wheel = (over: Partial<WheelInput> = {}): WheelInput => ({
  deltaX: 0,
  deltaY: 100,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  ...over,
});

const act = (e: Partial<WheelInput>, p: Partial<InputPrefs> = {}): WheelAction =>
  wheelAction(wheel(e), prefs(p), VIEWPORT);

const zoomFactor = (a: WheelAction): number => {
  expect(a.kind).toBe('zoom');
  return a.kind === 'zoom' ? a.factor : Number.NaN;
};

describe('zoomScaleForRotation - CONSTANT_ZOOM_CONTROLLER::GetScaleForRotation', () => {
  it('is 1 + rotation*scale zooming in and 1/(1 - rotation*scale) zooming out', () => {
    // zoom_controller.cpp:120-131, with GTK3_SCALE = 0.002 (the auto scale).
    expect(zoomScaleForRotation(100, prefs())).toBeCloseTo(1 + 100 * 0.002, 12);
    expect(zoomScaleForRotation(-100, prefs())).toBeCloseTo(1 / (1 + 100 * 0.002), 12);
  });

  it('is exactly reciprocal in and out, so a notch each way returns to the start', () => {
    const p = prefs();
    expect(zoomScaleForRotation(100, p) * zoomScaleForRotation(-100, p)).toBeCloseTo(1, 12);
  });

  it('clamps the rotation to +/-100 (zoom_controller.cpp:124)', () => {
    const p = prefs();
    expect(zoomScaleForRotation(4000, p)).toBeCloseTo(zoomScaleForRotation(100, p), 12);
    expect(zoomScaleForRotation(-4000, p)).toBeCloseTo(zoomScaleForRotation(-100, p), 12);
    // Without the clamp a trackpad flick would multiply the scale by 9.
    expect(zoomScaleForRotation(4000, p)).toBeLessThan(1.3);
  });
});

describe('zoom_speed / zoom_speed_auto', () => {
  it('zoom_speed changes the step, monotonically (MANUAL_SCALE_FACTOR * zoom_speed)', () => {
    const slow = zoomFactor(act({ deltaY: -100 }, { zoomSpeedAuto: false, zoomSpeed: 1 }));
    const fast = zoomFactor(act({ deltaY: -100 }, { zoomSpeedAuto: false, zoomSpeed: 8 }));
    expect(slow).toBeCloseTo(1 + 100 * 0.001 * 1, 12);
    expect(fast).toBeCloseTo(1 + 100 * 0.001 * 8, 12);
    expect(fast).toBeGreaterThan(slow);
  });

  it('zoom_speed_auto ignores zoom_speed and uses the platform scale', () => {
    // wx_view_controls.cpp:197-199 -> GetZoomControllerForPlatform, which on
    // GTK3 is CONSTANT_ZOOM_CONTROLLER( GTK3_SCALE ) whatever zoom_speed says.
    const a = zoomFactor(act({ deltaY: -100 }, { zoomSpeedAuto: true, zoomSpeed: 1 }));
    const b = zoomFactor(act({ deltaY: -100 }, { zoomSpeedAuto: true, zoomSpeed: 10 }));
    expect(a).toBe(b);
    expect(a).toBeCloseTo(1 + 100 * 0.002, 12);
  });

  it('toggling zoom_speed_auto off at speed 1 really changes the step', () => {
    // The guard against "auto" being implemented as "speed 1": auto is GTK3's
    // 0.002 and speed 1 is 0.001, so they must not be equal.
    const auto = zoomFactor(act({ deltaY: -100 }, { zoomSpeedAuto: true, zoomSpeed: 1 }));
    const manual = zoomFactor(act({ deltaY: -100 }, { zoomSpeedAuto: false, zoomSpeed: 1 }));
    expect(auto).not.toBeCloseTo(manual, 6);
  });
});

describe('reverse_scroll_zoom', () => {
  it('inverts which way the wheel zooms', () => {
    const fwd = zoomFactor(act({ deltaY: 100 }));
    const rev = zoomFactor(act({ deltaY: 100 }, { reverseZoom: true }));
    expect(fwd).toBeLessThan(1); // wheel down zooms out by default
    expect(rev).toBeGreaterThan(1);
    expect(fwd * rev).toBeCloseTo(1, 12);
  });

  it('is the same gesture as flipping the wheel direction', () => {
    expect(zoomFactor(act({ deltaY: 100 }, { reverseZoom: true }))).toBeCloseTo(
      zoomFactor(act({ deltaY: -100 })),
      12,
    );
  });
});

describe('scroll_modifier_zoom / _pan_h / _pan_v', () => {
  it('by default a bare wheel zooms, ctrl pans left/right, shift pans up/down', () => {
    expect(act({}).kind).toBe('zoom');
    expect(act({ ctrlKey: true })).toEqual({ kind: 'pan', dx: expect.any(Number), dy: 0 });
    expect(act({ shiftKey: true }).kind).toBe('pan');
    const shift = act({ shiftKey: true });
    expect(shift.kind === 'pan' && shift.dx).toBe(0);
    expect(shift.kind === 'pan' && shift.dy).not.toBe(0);
  });

  it('moving the zoom modifier to ctrl moves the zoom with it', () => {
    const p = { scrollModZoom: 'ctrl' as const, scrollModPanH: 'none' as const };
    expect(act({ ctrlKey: true }, p).kind).toBe('zoom');
    // ...and the bare wheel is no longer a zoom.
    expect(act({}, p).kind).toBe('pan');
  });

  it('dropping a scroll modifier changes what that chord does', () => {
    // pan_h moved off ctrl: ctrl+wheel is no longer a horizontal pan, it falls
    // through to onWheel's else-branch and pans vertically.
    const before = act({ ctrlKey: true });
    const after = act({ ctrlKey: true }, { scrollModPanH: 'alt' });
    expect(before).not.toEqual(after);
    expect(before.kind === 'pan' && before.dy).toBe(0);
    expect(after.kind === 'pan' && after.dy).not.toBe(0);
    // and alt+wheel now pans horizontally, where before it panned vertically.
    expect(act({ altKey: true }, { scrollModPanH: 'alt' })).toEqual(before);
  });

  it('a modifier bound to nothing still pans vertically (onWheel has no fourth case)', () => {
    // wx_view_controls.cpp:492-509: anything that is not the zoom modifier
    // scrolls, and anything that is not the pan-H modifier scrolls vertically.
    // Alt is bound to nothing by default and must NOT be a no-op.
    const a = act({ altKey: true });
    expect(a.kind).toBe('pan');
    expect(a.kind === 'pan' && a.dy).not.toBe(0);
  });

  it('zoom wins when two settings name the same modifier', () => {
    // onWheel tests the zoom modifier first (wx_view_controls.cpp:464).
    expect(act({ shiftKey: true }, { scrollModZoom: 'shift' }).kind).toBe('zoom');
  });
});

describe('modifier resolution - "Shift beats control beats alt"', () => {
  it('picks shift over control and control over alt', () => {
    // wx_view_controls.cpp:458-480. Note that the stated precedence is not
    // actually observable, upstream or here: any second modifier trips the
    // nMods > 1 bail-out below before the order can matter. Mutating the order
    // leaves every test green, correctly - what our old handlers really got
    // wrong was having no bail-out at all, which the next block covers.
    expect(wheelModifier(wheel({ shiftKey: true }))).toBe('shift');
    expect(wheelModifier(wheel({ ctrlKey: true }))).toBe('ctrl');
    expect(wheelModifier(wheel({ altKey: true }))).toBe('alt');
    expect(wheelModifier(wheel({}))).toBe('none');
  });

  it('treats Cmd as Control', () => {
    expect(wheelModifier(wheel({ metaKey: true }))).toBe('ctrl');
    // ...and Cmd+Ctrl is one modifier, not two.
    expect(wheelModifier(wheel({ metaKey: true, ctrlKey: true }))).toBe('ctrl');
  });

  it('two or more modifiers are not a view gesture at all', () => {
    // "When we have multiple mods, forward it for tool handling" (:541).
    expect(wheelModifier(wheel({ shiftKey: true, ctrlKey: true }))).toBe('multiple');
    expect(act({ shiftKey: true, ctrlKey: true })).toEqual({ kind: 'none' });
    expect(act({ shiftKey: true, ctrlKey: true, altKey: true })).toEqual({ kind: 'none' });
  });
});

describe('horizontal wheel axis', () => {
  it('pans left/right whatever the horizontal_pan setting says', () => {
    // wx_view_controls.cpp:422-434: the native horizontal axis is handled
    // before any modifier is read and is not gated on m_horizontalPan - which
    // 10.0.5 stores and never reads in onWheel. Ours used to gate on it, so a
    // trackpad's sideways swipe did nothing unless the box was ticked.
    const off = act({ deltaX: 100, deltaY: 0 }, { horizontalPan: false });
    const on = act({ deltaX: 100, deltaY: 0 }, { horizontalPan: true });
    expect(off).toEqual(on);
    expect(off.kind).toBe('pan');
    expect(off.kind === 'pan' && off.dx).not.toBe(0);
    expect(off.kind === 'pan' && off.dy).toBe(0);
  });

  it('beats the zoom modifier, because it is checked first', () => {
    expect(act({ deltaX: 100, deltaY: 10 }).kind).toBe('pan');
    // ...but the dominant axis decides: a mostly-vertical scroll still zooms.
    expect(act({ deltaX: 10, deltaY: 100 }).kind).toBe('zoom');
  });
});

describe('reverse_scroll_pan_h', () => {
  it('flips the modifier-driven horizontal pan and only that', () => {
    const fwd = act({ ctrlKey: true });
    const rev = act({ ctrlKey: true }, { reverseScrollPanH: true });
    expect(fwd.kind === 'pan' && rev.kind === 'pan' && fwd.dx).toBe(
      rev.kind === 'pan' ? -rev.dx : Number.NaN,
    );
    // The vertical pan has no reverse setting upstream (scrollY = -scrollVec.y).
    expect(act({ shiftKey: true })).toEqual(act({ shiftKey: true }, { reverseScrollPanH: true }));
  });
});

describe('pan magnitude - ToWorld( GetScreenPixelSize() ) * rotation * 0.001', () => {
  it('is a fraction of the viewport, not a fixed pixel count', () => {
    const small = wheelAction(wheel({ shiftKey: true }), prefs(), { width: 500, height: 400 });
    const large = wheelAction(wheel({ shiftKey: true }), prefs(), { width: 1000, height: 800 });
    expect(small.kind === 'pan' && large.kind === 'pan' && large.dy / small.dy).toBeCloseTo(2, 12);
    // One notch moves 0.001 * 100 = 10% of the window (wheelPanSpeed = 0.001).
    expect(large.kind === 'pan' && Math.abs(large.dy)).toBeCloseTo(80, 12);
  });

  it('scrolling down moves the content up', () => {
    const down = act({ shiftKey: true, deltaY: 100 });
    const up = act({ shiftKey: true, deltaY: -100 });
    expect(down.kind === 'pan' && down.dy).toBeLessThan(0);
    expect(up.kind === 'pan' && up.dy).toBeGreaterThan(0);
  });
});

describe('deltaMode normalisation', () => {
  it('treats 3 lines as one 100 px notch', () => {
    expect(zoomFactor(act({ deltaY: 3, deltaMode: 1 }))).toBeCloseTo(
      zoomFactor(act({ deltaY: 100, deltaMode: 0 })),
      12,
    );
  });

  it('a line-mode wheel is not a near-no-op', () => {
    // Without normalisation a Firefox notch is rotation 3, i.e. a 0.6% zoom.
    expect(zoomFactor(act({ deltaY: -3, deltaMode: 1 }))).toBeGreaterThan(1.15);
  });
});

describe('doZoomFit margins - common_tools.cpp:381-401', () => {
  it('is 1.04 for the document editors', () => {
    for (const f of ['sch', 'pcb', 'gerber', 'pl_editor'] as FitFrame[])
      expect(fitMarginScaleFactor(f, 800)).toBe(1.04);
  });

  it('is 1.30 for the library viewers and 1.48 for the library editors', () => {
    expect(fitMarginScaleFactor('sch_viewer', 800)).toBe(1.3);
    expect(fitMarginScaleFactor('footprint_viewer', 800)).toBe(1.3);
    expect(fitMarginScaleFactor('symbol_editor', 800)).toBe(1.48);
    expect(fitMarginScaleFactor('footprint_editor', 800)).toBe(1.48);
  });

  it('widens to 1.10 on a canvas shorter than 768 px', () => {
    expect(fitMarginScaleFactor('sch', 767)).toBe(1.1);
    expect(fitMarginScaleFactor('sch', 768)).toBe(1.04);
  });

  it('applies the library margin only to Zoom to Fit, not to fit-objects/selection', () => {
    // The bigger margin sits inside `if( aFitType == ZOOM_FIT_ALL )` (:387).
    expect(fitMarginScaleFactor('symbol_editor', 800, 'objects')).toBe(1.04);
    expect(fitMarginScaleFactor('symbol_editor', 800, 'selection')).toBe(1.04);
    expect(fitMarginScaleFactor('symbol_editor', 800, 'all')).toBe(1.48);
  });
});

describe('zoomFitView', () => {
  const box = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

  it('fits the limiting axis and centres the box', () => {
    const v = zoomFitView(box, { width: 1000, height: 800 }, 'pcb');
    expect(v).not.toBeNull();
    // min(1000/200, 800/100) = 5, then / 1.04.
    expect(v?.scale).toBeCloseTo(5 / 1.04, 12);
    expect(v?.tx).toBeCloseTo(1000 / 2 - 100 * (5 / 1.04), 12);
    expect(v?.ty).toBeCloseTo(800 / 2 - 50 * (5 / 1.04), 12);
  });

  it('changing the margin really changes the scale', () => {
    const doc = zoomFitView(box, VIEWPORT, 'pcb');
    const lib = zoomFitView(box, VIEWPORT, 'footprint_editor');
    expect(doc?.scale).toBeGreaterThan(lib?.scale ?? 0);
    expect((doc?.scale ?? 0) / (lib?.scale ?? 1)).toBeCloseTo(1.48 / 1.04, 12);
  });

  it('is a viewport fraction, so the slack does not depend on the units', () => {
    // The four hand-rolled fits used absolute world padding (12 mm, 8 mm,
    // 5 mm, 2 mm), so a small footprint got a different framing from a big
    // board. Scaling the box must not change the visible framing.
    const small = zoomFitView({ minX: 0, minY: 0, maxX: 2, maxY: 1 }, VIEWPORT, 'pcb');
    const big = zoomFitView({ minX: 0, minY: 0, maxX: 2e6, maxY: 1e6 }, VIEWPORT, 'pcb');
    // world width * scale = the same number of screen pixels either way.
    expect(2 * (small?.scale ?? 0)).toBeCloseTo(2e6 * (big?.scale ?? 0), 6);
  });

  it('returns null for a degenerate box rather than an infinite scale', () => {
    expect(zoomFitView({ minX: 5, minY: 0, maxX: 5, maxY: 10 }, VIEWPORT, 'pcb')).toBeNull();
    expect(zoomFitView({ minX: 0, minY: 0, maxX: 10, maxY: 0 }, VIEWPORT, 'pcb')).toBeNull();
  });
});
