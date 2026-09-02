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
  AcceleratingZoomController,
  DEFAULT_INPUT_PREFS,
  dragGesture,
  dragZoomScale,
  fitMarginScaleFactor,
  makeMotionPan,
  makeZoomController,
  zoomControllerFor,
  type ModifierState,
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

/**
 * `WX_VIEW_CONTROLS::onButton` — Preferences > Mouse and Touchpad > Drag
 * Gestures, for the middle and right buttons.
 *
 * Upstream one `WX_VIEW_CONTROLS` sits in front of every GAL canvas and
 * answers this identically for all of them (`wx_view_controls.cpp:546-569`).
 * Ours are seven React components, and every one of them but the schematic
 * canvas hardcoded `button === 1` -> pan: the two combos were live in one
 * editor out of six, and `Zoom` and `None` did nothing anywhere else.
 */
describe('dragGesture — onButton (wx_view_controls.cpp:546-569)', () => {
  it('the middle button takes m_dragMiddle', () => {
    expect(dragGesture(1, prefs({ mouseMiddle: 'pan' }))).toBe('pan');
    expect(dragGesture(1, prefs({ mouseMiddle: 'zoom' }))).toBe('zoom');
    expect(dragGesture(1, prefs({ mouseMiddle: 'none' }))).toBe('none');
  });

  it('the right button takes m_dragRight, not m_dragMiddle', () => {
    // Both branches of onButton name the two buttons separately; a port that
    // shared one setting between them passes every single-button test.
    expect(dragGesture(2, prefs({ mouseMiddle: 'none', mouseRight: 'pan' }))).toBe('pan');
    expect(dragGesture(2, prefs({ mouseMiddle: 'pan', mouseRight: 'zoom' }))).toBe('zoom');
    expect(dragGesture(2, prefs({ mouseMiddle: 'pan', mouseRight: 'none' }))).toBe('none');
  });

  it('the LEFT button starts no view gesture, whatever mouseLeft says', () => {
    // `m_dragLeft` is loaded (`:188`) and onButton never reads it -- a left
    // drag is the selection tool's, through TOOLS_HOLDER::GetDragAction.
    for (const mouseLeft of ['select', 'drag_selected', 'drag_any'] as const) {
      expect(dragGesture(0, prefs({ mouseLeft }))).toBe('none');
    }
  });
});

/**
 * `WX_VIEW_CONTROLS::onMotion`'s DRAG_ZOOMING step (`:379-388`):
 *
 *     double scale = exp( d.y * m_settings.m_zoomSpeed * 0.001 );
 *
 * The factor is written out below rather than computed from the function, so
 * the expectation cannot agree with a wrong implementation by construction.
 */
describe('dragZoomScale — DRAG_ZOOMING (wx_view_controls.cpp:379-388)', () => {
  it('is exp( dy * zoom_speed * 0.001 )', () => {
    // zoom_speed 1, 40 px of travel: exp( 40 * 1 * 0.001 ) = exp( 0.04 ).
    expect(dragZoomScale(40, prefs({ zoomSpeed: 1 }))).toBeCloseTo(Math.exp(0.04), 12);
    // zoom_speed 10 over the same travel: exp( 0.4 ), ten times the exponent.
    expect(dragZoomScale(40, prefs({ zoomSpeed: 10 }))).toBeCloseTo(Math.exp(0.4), 12);
  });

  it('the Zoom speed slider really moves it', () => {
    // The bug this pins: the schematic canvas multiplied by a literal 0.005,
    // so every speed gave the same factor.
    const seen = [1, 2, 5, 10].map((zoomSpeed) => dragZoomScale(40, prefs({ zoomSpeed })));
    expect(new Set(seen).size).toBe(4);
  });

  it('Automatic does NOT take over the drag', () => {
    // `zoom_speed_auto` picks a ZOOM_CONTROLLER for the WHEEL (`:196-214`);
    // DRAG_ZOOMING reads `m_zoomSpeed` raw and never asks for a controller.
    expect(dragZoomScale(40, prefs({ zoomSpeed: 3, zoomSpeedAuto: true }))).toBeCloseTo(
      dragZoomScale(40, prefs({ zoomSpeed: 3, zoomSpeedAuto: false })),
      12,
    );
  });

  it('a downward drag zooms out, an upward drag zooms in', () => {
    // `d = m_dragStartPoint - mousePos`, so dragging DOWN (y increasing) makes
    // d.y negative and the scale less than 1.
    expect(dragZoomScale(-40, prefs())).toBeLessThan(1);
    expect(dragZoomScale(40, prefs())).toBeGreaterThan(1);
    expect(dragZoomScale(0, prefs())).toBe(1);
  });
});

/**
 * `ACCELERATING_ZOOM_CONTROLLER` — Preferences > Mouse and Touchpad > "Use
 * zoom acceleration", which had nothing behind it until now.
 *
 * `common/view/zoom_controller.cpp:73-108`, whole:
 *
 *     const double minStep = 1.05;
 *     auto timeDiff = duration_cast<TIMEOUT>( timestamp - m_prevTimestamp );
 *     m_prevTimestamp = timestamp;
 *
 *     if( timeDiff < m_accTimeout && ( (aRotation > 0) == m_prevRotationPositive ) )
 *     {
 *         zoomScale = ( 2.05 * m_scale / 5.0 ) - timeDiff / m_accTimeout;
 *         zoomScale = std::max( zoomScale, minStep );
 *         if( aRotation < 0 ) zoomScale = 1.0 / zoomScale;
 *     }
 *     else
 *         zoomScale = ( aRotation > 0 ) ? minStep : 1 / minStep;
 *
 *     m_prevRotationPositive = aRotation > 0;
 *
 * The expected numbers below are worked out from that expression by hand, not
 * read back off the implementation. `2.05 * m_scale / 5.0` with m_scale =
 * zoom_speed gives 0.41 per unit of speed, and `timeDiff / m_accTimeout` is
 * integer division of two `std::chrono::milliseconds` inside a branch that has
 * already established timeDiff < accTimeout, so it is always zero.
 */
describe('AcceleratingZoomController (zoom_controller.cpp:73-108)', () => {
  /** A clock the test drives, which is what upstream's TIMESTAMP_PROVIDER is for. */
  function clock(): { now: () => number; advance: (ms: number) => void } {
    let t = 1000;
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  it('the first event of a gesture is minStep, because there is no history', () => {
    const c = clock();
    const ctl = new AcceleratingZoomController(10, undefined, c.now);
    // `m_prevRotationPositive` starts false, so a wheel-UP takes the else.
    expect(ctl.getScaleForRotation(1)).toBeCloseTo(1.05, 12);
  });

  it('a fast repeat in the same direction accelerates to 2.05 * speed / 5', () => {
    const c = clock();
    const ctl = new AcceleratingZoomController(10, undefined, c.now);
    ctl.getScaleForRotation(1); // arms m_prevRotationPositive = true
    c.advance(50); // < 500 ms
    // 2.05 * 10 / 5 = 4.1
    expect(ctl.getScaleForRotation(1)).toBeCloseTo(4.1, 12);
  });

  it('the Zoom speed slider is that m_scale', () => {
    for (const [speed, want] of [
      [10, 4.1],
      [5, 2.05],
      // 2.05 * 2 / 5 = 0.82, under minStep, so std::max clamps it to 1.05.
      [2, 1.05],
      [1, 1.05],
    ] as const) {
      const c = clock();
      const ctl = new AcceleratingZoomController(speed, undefined, c.now);
      ctl.getScaleForRotation(1);
      c.advance(50);
      expect(ctl.getScaleForRotation(1), `speed ${speed}`).toBeCloseTo(want, 12);
    }
  });

  it('waiting longer than the 500 ms timeout drops back to minStep', () => {
    const c = clock();
    const ctl = new AcceleratingZoomController(10, undefined, c.now);
    ctl.getScaleForRotation(1);
    c.advance(500); // NOT < 500
    expect(ctl.getScaleForRotation(1)).toBeCloseTo(1.05, 12);
    c.advance(499);
    expect(ctl.getScaleForRotation(1)).toBeCloseTo(4.1, 12);
  });

  it('reversing direction drops back to minStep even when it is fast', () => {
    // `(aRotation > 0) == m_prevRotationPositive` — the direction has to match
    // as well as the timing, so a quick flick back does not inherit the speed.
    const c = clock();
    const ctl = new AcceleratingZoomController(10, undefined, c.now);
    ctl.getScaleForRotation(1);
    c.advance(10);
    expect(ctl.getScaleForRotation(-1)).toBeCloseTo(1 / 1.05, 12);
  });

  it('an accelerated wheel-DOWN is the reciprocal', () => {
    const c = clock();
    const ctl = new AcceleratingZoomController(10, undefined, c.now);
    ctl.getScaleForRotation(-1); // m_prevRotationPositive = false
    c.advance(10);
    expect(ctl.getScaleForRotation(-1)).toBeCloseTo(1 / 4.1, 12);
  });

  it('ignores the rotation MAGNITUDE, unlike the constant controller', () => {
    // CONSTANT_ZOOM_CONTROLLER multiplies by aRotation; this one only reads
    // its sign. That is the whole difference between the two.
    const c = clock();
    const ctl = new AcceleratingZoomController(10, undefined, c.now);
    ctl.getScaleForRotation(1);
    c.advance(10);
    expect(ctl.getScaleForRotation(500)).toBeCloseTo(4.1, 12);
  });
});

/**
 * `WX_VIEW_CONTROLS::LoadSettings`' controller tree (`:196-214`) and the
 * platform function it delegates to (`:55-71`).
 */
describe('zoomControllerFor — which controller LoadSettings builds', () => {
  const tick = (): (() => number) => {
    let t = 0;
    return () => {
      t += 10;
      return t;
    };
  };

  it('Automatic wins, and on GTK3 it ignores the acceleration flag', () => {
    // `GetZoomControllerForPlatform`'s __WXGTK3__ branch returns
    // CONSTANT_ZOOM_CONTROLLER( GTK3_SCALE ) without reading aAcceleration.
    const on = zoomControllerFor(prefs({ zoomSpeedAuto: true, zoomAcceleration: true }));
    const off = zoomControllerFor(prefs({ zoomSpeedAuto: true, zoomAcceleration: false }));
    expect(on.getScaleForRotation(100)).toBeCloseTo(off.getScaleForRotation(100), 12);
    // …and it is the constant one: 1 + 100 * 0.002.
    expect(on.getScaleForRotation(100)).toBeCloseTo(1.2, 12);
  });

  it('with Automatic off, the flag chooses between the two controllers', () => {
    const acc = zoomControllerFor(
      prefs({ zoomSpeedAuto: false, zoomAcceleration: true, zoomSpeed: 10 }),
      tick(),
    );
    const con = zoomControllerFor(
      prefs({ zoomSpeedAuto: false, zoomAcceleration: false, zoomSpeed: 10 }),
    );
    // Constant: 1 + 100 * 0.001 * 10 = 2. Accelerating on a repeat: 4.1, and
    // it does not depend on the magnitude at all.
    expect(con.getScaleForRotation(100)).toBeCloseTo(2, 12);
    acc.getScaleForRotation(100);
    expect(acc.getScaleForRotation(100)).toBeCloseTo(4.1, 12);
  });
});

/**
 * The controller reaches `wheelAction`, which is the seam every canvas uses.
 */
describe('wheelAction consults m_zoomController', () => {
  it('a canvas that passes one gets the accelerating behaviour', () => {
    const ctl = makeZoomController(() => 0);
    const p = prefs({
      zoomSpeedAuto: false,
      zoomAcceleration: true,
      zoomSpeed: 10,
      scrollModZoom: 'none',
    });
    // Two notches UP in a row, at the same instant. The first takes the else
    // branch -- `m_prevRotationPositive` starts false and this rotation is
    // positive -- and the second is inside the 500 ms window in the same
    // direction, so it accelerates: minStep, then 2.05 * 10 / 5.
    const up = wheel({ deltaY: -100 });
    const first = wheelAction(up, p, VIEWPORT, ctl);
    const second = wheelAction(up, p, VIEWPORT, ctl);
    expect(first.kind).toBe('zoom');
    expect(second.kind).toBe('zoom');
    if (first.kind !== 'zoom' || second.kind !== 'zoom') return;
    expect(first.factor).toBeCloseTo(1.05, 12);
    expect(second.factor).toBeCloseTo(4.1, 12);
  });

  it('a wheel-DOWN accelerates from the very first event, as upstream does', () => {
    // Not a quirk of ours. `m_prevRotationPositive` is initialised to FALSE
    // (`zoom_controller.h:131`) and `m_prevTimestamp` to the construction time
    // (ctor body), so the first wheel-DOWN inside 500 ms of the controller
    // being built matches on both conditions and takes the accelerated branch.
    // Recorded because it looks like an off-by-one until you read the header.
    const ctl = makeZoomController(() => 0);
    const p = prefs({
      zoomSpeedAuto: false,
      zoomAcceleration: true,
      zoomSpeed: 10,
      scrollModZoom: 'none',
    });
    const first = wheelAction(wheel(), p, VIEWPORT, ctl);
    expect(first.kind).toBe('zoom');
    if (first.kind !== 'zoom') return;
    expect(first.factor).toBeCloseTo(1 / 4.1, 12);
  });

  it('and retunes itself when the settings that choose it move', () => {
    // Upstream the Preferences OK calls LoadSettings on every canvas; ours
    // notices the change instead. Without this, a canvas built before the
    // checkbox was ticked would keep the old controller for the tab's life.
    const ctl = makeZoomController(() => 0);
    const acc = prefs({ zoomSpeedAuto: false, zoomAcceleration: true, zoomSpeed: 10 });
    const con = { ...acc, zoomAcceleration: false };
    wheelAction(wheel(), acc, VIEWPORT, ctl);
    const after = wheelAction(wheel(), con, VIEWPORT, ctl);
    expect(after.kind).toBe('zoom');
    // Constant at speed 10 over one 100 px notch: 1 / ( 1 - (-100 * 0.01) )…
    // i.e. the constant controller's answer, not 1/4.1.
    if (after.kind !== 'zoom') return;
    expect(after.factor).toBeCloseTo(zoomScaleForRotation(-100, con), 12);
    expect(after.factor).not.toBeCloseTo(1 / 4.1, 6);
  });
});

/**
 * `WX_VIEW_CONTROLS::onMotion`'s meta-pan — Preferences > Mouse and Touchpad >
 * "Pan on mouse movement with key" (`wx_view_controls.cpp:288-311`).
 *
 * A BARE pointer move, no button held, pans the view while the named key is
 * down. Three things in that block are easy to lose, and each has a test:
 * the first qualifying move only ARMS the gesture (so the view does not jump
 * when the key goes down), the block RETURNS so nothing else in onMotion runs,
 * and letting go of the key clears `m_metaPanning` so the next press starts
 * fresh rather than jumping by however far the pointer travelled meanwhile.
 */
describe('makeMotionPan — onMotion (wx_view_controls.cpp:288-311)', () => {
  const at = (x: number, y: number, mods: Partial<ModifierState> = {}) => ({
    clientX: x,
    clientY: y,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...mods,
  });

  it('does nothing at all when the setting is None', () => {
    // `m_motionPanModifier != WXK_NONE` is the first half of the condition,
    // and the PARAM's default is 0 == WXK_NONE (`common_settings.cpp:287-288`).
    const mp = makeMotionPan();
    expect(mp.update(at(10, 10, { altKey: true, ctrlKey: true, shiftKey: true }), 'none', 1)).toBe(
      null,
    );
  });

  it('does nothing while the named key is up', () => {
    const mp = makeMotionPan();
    expect(mp.update(at(10, 10), 'alt', 1)).toBe(null);
    expect(mp.update(at(50, 50), 'alt', 1)).toBe(null);
  });

  it('arms on the first qualifying move without moving the view', () => {
    // `if( !m_metaPanning ) { m_metaPanning = true; m_metaPanStart = mousePos; }`
    // — there is no delta yet, so the view must not jump when the key goes down
    // in the middle of the canvas.
    const mp = makeMotionPan();
    expect(mp.update(at(100, 100, { altKey: true }), 'alt', 1)).toEqual({ dx: 0, dy: 0 });
  });

  it('then pans by the travel since the previous move', () => {
    const mp = makeMotionPan();
    mp.update(at(100, 100, { altKey: true }), 'alt', 1);
    expect(mp.update(at(130, 90, { altKey: true }), 'alt', 1)).toEqual({ dx: 30, dy: -10 });
    // `m_metaPanStart = mousePos` — each step is measured from the LAST move,
    // not from where the gesture started, so this is 5 more and not 35.
    expect(mp.update(at(135, 90, { altKey: true }), 'alt', 1)).toEqual({ dx: 5, dy: 0 });
  });

  it('scales the delta by the device pixel ratio', () => {
    // Our canvases translate in device pixels; a DOM client coordinate is CSS.
    const mp = makeMotionPan();
    mp.update(at(100, 100, { altKey: true }), 'alt', 2);
    expect(mp.update(at(110, 100, { altKey: true }), 'alt', 2)).toEqual({ dx: 20, dy: 0 });
  });

  it('releasing the key disarms it, so the next press does not jump', () => {
    // `else { m_metaPanning = false; }` — without it, moving the pointer across
    // the canvas with the key up and pressing it again would pan by the whole
    // distance travelled in between.
    const mp = makeMotionPan();
    mp.update(at(100, 100, { altKey: true }), 'alt', 1);
    mp.update(at(120, 100, { altKey: true }), 'alt', 1);
    expect(mp.update(at(400, 400), 'alt', 1)).toBe(null); // key up
    expect(mp.update(at(400, 400, { altKey: true }), 'alt', 1)).toEqual({ dx: 0, dy: 0 });
  });

  it('each modifier is its own key', () => {
    // A port that tested "any modifier" would pass every test above.
    for (const [modifier, mods] of [
      ['alt', { altKey: true }],
      ['ctrl', { ctrlKey: true }],
      ['shift', { shiftKey: true }],
    ] as const) {
      const mp = makeMotionPan();
      expect(mp.update(at(0, 0, mods), modifier, 1), modifier).not.toBe(null);
      const wrong = makeMotionPan();
      const other = modifier === 'alt' ? 'shift' : 'alt';
      expect(wrong.update(at(0, 0, mods), other, 1), `${modifier} vs ${other}`).toBe(null);
    }
  });

  it('treats Cmd as Control, the way wx maps it', () => {
    const mp = makeMotionPan();
    expect(mp.update(at(0, 0, { metaKey: true }), 'ctrl', 1)).not.toBe(null);
  });
});
