import { ENV_VAR_MAP } from '@ziroeda/common/settings/environment.js';
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::ZOOM_CONTROLLER` — KiCad's own `qa/tests/common/view/test_zoom_controller.cpp`
 * transcribed — and `KIGFX::WX_VIEW_CONTROLS` driven by the wx events the
 * panel would make: the wheel zooms about the cursor (or pans with the
 * modifier), a middle drag pans by the world delta of the mouse delta, the
 * scroll events pan by a fraction of the viewport, the cursor snaps through
 * the GAL's grid, and a warp that the platform cannot do leaves the view
 * where it was.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { GAL_DISPLAY_OPTIONS, GRID_SNAPPING } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/mouse_drag_action.js';
import { type COMMON_SETTINGS_LIKE, PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import {
  WX_VIEW_CONTROLS,
  type WX_VIEW_CONTROLS_PANEL,
} from '@ziroeda/common/view/wx_view_controls.js';
import {
  ACCELERATING_ZOOM_CONTROLLER,
  CONSTANT_ZOOM_CONTROLLER,
  type TIMESTAMP_PROVIDER,
} from '@ziroeda/common/view/zoom_controller.js';
import {
  type wxEvent,
  type wxEventType,
  wxEVT_LEFT_UP,
  wxEVT_MIDDLE_DOWN,
  wxEVT_MIDDLE_UP,
  wxEVT_MOTION,
  wxEVT_MOUSEWHEEL,
  wxEVT_SCROLLWIN_LINEDOWN,
  wxEVT_SCROLLWIN_PAGEUP,
  wxMouseEvent,
  wxMouseWheelAxis,
  wxOrientation,
  wxScrollWinEvent,
} from '@ziroeda/common/wx/wx_event.js';

describe('ZoomController', () => {
  it('ConstController: a GTK3 detent zooms by ~1.1 either way', () => {
    // A single scroll step on a GTK3 Linux system: 120 is the standard wheel delta
    const zoom_ctrl = new CONSTANT_ZOOM_CONTROLLER(CONSTANT_ZOOM_CONTROLLER.GTK3_SCALE);
    // BOOST_CHECK_CLOSE( ..., 10% )
    expect(Math.abs(zoom_ctrl.GetScaleForRotation(120) / 1.1 - 1)).toBeLessThan(0.1);
    expect(Math.abs(zoom_ctrl.GetScaleForRotation(-120) / (1 / 1.1) - 1)).toBeLessThan(0.1);
    // ...and exactly: the rotation clamps at 100
    expect(zoom_ctrl.GetScaleForRotation(120)).toBe(1 + 100 * CONSTANT_ZOOM_CONTROLLER.GTK3_SCALE);
    expect(zoom_ctrl.GetScaleForRotation(-120)).toBe(
      1 / (1 + 100 * CONSTANT_ZOOM_CONTROLLER.GTK3_SCALE),
    );
  });

  class PREDEF_TIMESTAMPER implements TIMESTAMP_PROVIDER {
    private m_iter = 0;
    constructor(private readonly m_stamps: readonly number[]) {}
    GetTimestamp(): number {
      // Don't ask for more samples than given
      expect(this.m_iter).toBeLessThan(this.m_stamps.length);
      return this.m_stamps[this.m_iter++]!;
    }
  }

  const accel_cases = [
    // Scrolls widely spaced, just go up and down by a constant factor
    {
      timeout: 500,
      stamps: [0, 1000, 2000, 3000, 4000],
      scrolls: [120, 120, -120, -120],
      zooms: [1.05, 1.05, 1 / 1.05, 1 / 1.05],
    },
    // Close scrolls - acceleration, apart from when changing direction
    {
      timeout: 500,
      stamps: [0, 1000, 1100, 1200, 1300, 1400],
      scrolls: [120, 120, -120, -120, 120],
      zooms: [1.05, 2.05, 1 / 1.05, 1 / 2.05, 1.05],
    },
  ];

  it('AccelController', () => {
    for (const c of accel_cases) {
      const timestamper = new PREDEF_TIMESTAMPER(c.stamps);
      const zoom_ctrl = new ACCELERATING_ZOOM_CONTROLLER(
        ACCELERATING_ZOOM_CONTROLLER.DEFAULT_ACCELERATION_SCALE,
        c.timeout,
        timestamper,
      );

      for (let i = 0; i < c.scrolls.length; i++) {
        const zoom_scale = zoom_ctrl.GetScaleForRotation(c.scrolls[i]!);
        expect(Math.abs(zoom_scale / c.zooms[i]! - 1)).toBeLessThan(0.1);
      }
    }
  });

  it('AccelController, exactly: timeDiff / timeout is a chrono integer quotient, so 2.05 within the timeout', () => {
    const timestamper = new PREDEF_TIMESTAMPER([0, 1000, 1100, 1499]);
    const zoom_ctrl = new ACCELERATING_ZOOM_CONTROLLER(5.0, 500, timestamper);
    expect(zoom_ctrl.GetScaleForRotation(120)).toBe(1.05);
    expect(zoom_ctrl.GetScaleForRotation(120)).toBe(2.05);
    expect(zoom_ctrl.GetScaleForRotation(120)).toBe(2.05);
  });
});

/** A GAL with a real screen size, so the VIEW's matrices mean something. */
class SCREEN_GAL extends GAL {
  constructor(aOptions: GAL_DISPLAY_OPTIONS) {
    super(aOptions);
    this.ResizeScreen(800, 600);
  }
  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
    this.ComputeWorldScreenMatrix();
  }
}

/** The panel as the view controls reach it, with the handler table the events run through. */
class FAKE_PANEL implements WX_VIEW_CONTROLS_PANEL {
  m_MouseCapturedLost = false;
  handlers = new Map<wxEventType, ((e: wxEvent) => void)[]>();
  posted: wxEvent[] = [];
  refreshes = 0;
  scrollbars: number[][] = [];
  clientSize: VECTOR2I = { x: 800, y: 600 };
  range: VECTOR2I = { x: 0, y: 0 };

  Connect(aEventType: wxEventType, aHandler: (e: wxEvent) => void): void {
    const list = this.handlers.get(aEventType) ?? [];
    list.push(aHandler);
    this.handlers.set(aEventType, list);
  }
  /** wx: the most recently connected handler first; a Skip() passes on. */
  ProcessEvent(e: wxEvent): boolean {
    const list = this.handlers.get(e.GetEventType()) ?? [];
    for (let i = list.length - 1; i >= 0; --i) {
      e.Skip(false);
      list[i]!(e);
      if (!e.GetSkipped()) return true;
    }
    return false;
  }
  PostEvent(e: wxEvent): void {
    this.posted.push(e);
  }
  ScreenToClient(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x, y: p.y };
  }
  GetClientSize(): VECTOR2I {
    return this.clientSize;
  }
  Refresh(): void {
    this.refreshes++;
  }
  GetParent(): unknown {
    return null;
  }
  GetParentEDAFrame(): null {
    return null;
  }
  StatusPopupHasFocus(): boolean {
    return false;
  }
  EnableTouchEvents(): boolean {
    return false;
  }
  GetScrollThumb(): number {
    return 0;
  }
  GetScrollRange(aOrientation: wxOrientation): number {
    return aOrientation === wxOrientation.wxHORIZONTAL ? this.range.x : this.range.y;
  }
  SetScrollbars(...args: [number, number, number, number, number, number, boolean]): void {
    this.scrollbars.push(args.slice(0, 6) as number[]);
    this.range = { x: args[2], y: args[3] };
  }
  GetHandle(): HTMLElement | null {
    return null;
  }
  HasFocus(): boolean {
    return true;
  }
  SetFocus(): void {}
}

const INPUT: COMMON_SETTINGS_LIKE['m_Input'] = {
  focus_follow_sch_pcb: false,
  auto_pan: false,
  auto_pan_acceleration: 5,
  center_on_zoom: false,
  immediate_actions: true,
  warp_mouse_on_move: true,
  horizontal_pan: false,
  hotkey_feedback: true,
  zoom_acceleration: false,
  zoom_speed: 1,
  zoom_speed_auto: true,
  scroll_modifier_zoom: WXK.WXK_NONE,
  scroll_modifier_pan_h: WXK.WXK_CONTROL,
  scroll_modifier_pan_v: WXK.WXK_SHIFT,
  motion_pan_modifier: WXK.WXK_NONE,
  drag_left: MOUSE_DRAG_ACTION.DRAG_SELECTED,
  drag_middle: MOUSE_DRAG_ACTION.PAN,
  drag_right: MOUSE_DRAG_ACTION.PAN,
  reverse_scroll_zoom: false,
  reverse_scroll_pan_h: false,
};

function setup(aInput: Partial<COMMON_SETTINGS_LIKE['m_Input']> = {}): {
  view: VIEW;
  gal: SCREEN_GAL;
  panel: FAKE_PANEL;
  vc: WX_VIEW_CONTROLS;
  options: GAL_DISPLAY_OPTIONS;
} {
  SetPgm(
    new PGM_BASE({
      m_Appearance: {
        show_scrollbars: true,
        zoom_correction_factor: 1,
        hicontrast_dimming_factor: 0.8,
        canvas_scale: 0,
      },
      m_Input: { ...INPUT, ...aInput },
      m_Graphics: { aa_mode: 0 },
      m_Env: { vars: new ENV_VAR_MAP() },
    }),
  );
  const options = new GAL_DISPLAY_OPTIONS();
  const gal = new SCREEN_GAL(options);
  const view = new VIEW();
  view.SetGAL(gal);
  view.SetScale(1.0);
  view.SetCenter({ x: 0, y: 0 });
  const panel = new FAKE_PANEL();
  const vc = new WX_VIEW_CONTROLS(view, panel);
  return { view, gal, panel, vc, options };
}

function wheel(
  aRotation: number,
  aMods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
  aAt = { x: 400, y: 300 },
): wxMouseEvent {
  const e = new wxMouseEvent(wxEVT_MOUSEWHEEL);
  e.SetX(aAt.x);
  e.SetY(aAt.y);
  e.m_wheelRotation = aRotation;
  e.m_wheelAxis = wxMouseWheelAxis.wxMOUSE_WHEEL_VERTICAL;
  e.SetShiftDown(!!aMods.shift);
  e.SetControlDown(!!aMods.ctrl);
  e.SetAltDown(!!aMods.alt);
  return e;
}

function mouse(
  aType: wxEventType,
  aX: number,
  aY: number,
  aButtons: { middle?: boolean } = {},
): wxMouseEvent {
  const e = new wxMouseEvent(aType);
  e.SetX(aX);
  e.SetY(aY);
  e.state.SetMiddleDown(!!aButtons.middle);
  KIPLATFORM_UI.SetMousePosition(aX, aY);
  return e;
}

beforeAll(() => {
  KIPLATFORM_UI.SetMousePosition(400, 300);
});

describe('WX_VIEW_CONTROLS::onWheel', () => {
  it('a plain wheel notch zooms by the GTK3 constant controller about the pointer', () => {
    const { view, panel } = setup();
    const before = view.ToWorld({ x: 100, y: 100 });

    expect(panel.ProcessEvent(wheel(120, {}, { x: 100, y: 100 }))).toBe(false); // Skip()ped

    expect(view.GetScale()).toBeCloseTo(1.2);
    // The anchor stays under the pointer
    const after = view.ToWorld({ x: 100, y: 100 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    // refreshMouse posted the EVT_REFRESH_MOUSE with the modifiers set
    expect(panel.posted).toHaveLength(1);
    expect(panel.posted[0]!.GetEventType()).toBe(WX_VIEW_CONTROLS.EVT_REFRESH_MOUSE);
  });

  it('reverse_scroll_zoom flips the direction', () => {
    const { view, panel } = setup({ reverse_scroll_zoom: true });
    panel.ProcessEvent(wheel(120));
    expect(view.GetScale()).toBeCloseTo(1 / 1.2);
  });

  it('the vertical pan modifier (Shift) pans by 0.001 * rotation of the viewport height', () => {
    const { view, panel } = setup();
    const c0 = view.GetCenter();

    expect(panel.ProcessEvent(wheel(120, { shift: true }))).toBe(true); // consumed

    const screenWorld = view.ToWorld({ x: 800, y: 600 }, false);
    expect(view.GetCenter().y).toBeCloseTo(c0.y - screenWorld.y * (120 * 0.001));
    expect(view.GetCenter().x).toBeCloseTo(c0.x);
    expect(view.GetScale()).toBe(1.0);
  });

  it('the horizontal pan modifier (Ctrl) pans in x, reversed by reverse_scroll_pan_h', () => {
    {
      const { view, panel } = setup();
      const c0 = view.GetCenter();
      panel.ProcessEvent(wheel(120, { ctrl: true }));
      const screenWorld = view.ToWorld({ x: 800, y: 600 }, false);
      expect(view.GetCenter().x).toBeCloseTo(c0.x - screenWorld.x * 0.12);
    }
    {
      const { view, panel } = setup({ reverse_scroll_pan_h: true });
      const c0 = view.GetCenter();
      panel.ProcessEvent(wheel(120, { ctrl: true }));
      const screenWorld = view.ToWorld({ x: 800, y: 600 }, false);
      expect(view.GetCenter().x).toBeCloseTo(c0.x + screenWorld.x * 0.12);
    }
  });

  it('two modifiers together are not a view control: the event is skipped to the tools', () => {
    const { view, panel } = setup();
    expect(panel.ProcessEvent(wheel(120, { shift: true, ctrl: true }))).toBe(false);
    expect(view.GetScale()).toBe(1.0);
    expect(view.GetCenter()).toEqual({ x: 0, y: 0 });
  });

  it('a native horizontal wheel always pans horizontally, whatever the settings', () => {
    const { view, panel } = setup();
    const e = wheel(120);
    e.m_wheelAxis = wxMouseWheelAxis.wxMOUSE_WHEEL_HORIZONTAL;
    panel.ProcessEvent(e);
    const screenWorld = view.ToWorld({ x: 800, y: 600 }, false);
    expect(view.GetCenter().x).toBeCloseTo(screenWorld.x * 0.12);
    expect(view.GetCenter().y).toBe(0);
  });

  it('center_on_zoom: the warp fails on this platform, so the zoom is about the screen centre', () => {
    const { view, panel } = setup({ center_on_zoom: true });
    view.SetCenter({ x: 1000, y: 2000 });
    panel.ProcessEvent(wheel(120, {}, { x: 100, y: 100 }));
    expect(view.GetScale()).toBeCloseTo(1.2);
    // CenterOnCursor could not warp: the centre is untouched (not moved to the cursor)
    expect(view.GetCenter().x).toBeCloseTo(1000);
    expect(view.GetCenter().y).toBeCloseTo(2000);
  });
});

describe('WX_VIEW_CONTROLS drag panning', () => {
  it('a middle-button drag moves the centre by the world delta of the mouse delta', () => {
    const { view, panel } = setup();
    view.SetScale(2.0);
    const c0 = view.GetCenter();

    panel.ProcessEvent(mouse(wxEVT_MIDDLE_DOWN, 400, 300, { middle: true }));
    const move = mouse(wxEVT_MOTION, 410, 320, { middle: true });
    panel.ProcessEvent(move);

    // d = start - mouse = (-10, -20) screen pixels, as a relative world vector
    const d = view.ToWorld({ x: -10, y: -20 }, false);
    expect(view.GetCenter().x).toBeCloseTo(c0.x + d.x);
    expect(view.GetCenter().y).toBeCloseTo(c0.y + d.y);
    expect(d.x).not.toBe(0);
    // The drag consumed the motion's propagation (StopPropagation), yet Skip()ped it on
    expect(move.ShouldPropagate()).toBe(false);
    expect(move.GetSkipped()).toBe(true);

    panel.ProcessEvent(mouse(wxEVT_MIDDLE_UP, 410, 320));
    const c1 = view.GetCenter();
    panel.ProcessEvent(mouse(wxEVT_MOTION, 500, 500));
    expect(view.GetCenter()).toEqual(c1);
  });

  it('drag_middle = ZOOM: a vertical drag scales by exp( dy * zoom_speed * 0.001 ) about the start', () => {
    const { view, panel } = setup({ drag_middle: MOUSE_DRAG_ACTION.ZOOM, zoom_speed: 5 });
    panel.ProcessEvent(mouse(wxEVT_MIDDLE_DOWN, 400, 300, { middle: true }));
    panel.ProcessEvent(mouse(wxEVT_MOTION, 400, 200, { middle: true }));
    // d.y = 300 - 200 = 100
    expect(view.GetScale()).toBeCloseTo(Math.exp(100 * 5 * 0.001));
  });

  it('a left up while idle stays idle; CancelDrag ends a pan', () => {
    const { view, panel, vc } = setup();
    panel.ProcessEvent(mouse(wxEVT_MIDDLE_DOWN, 400, 300, { middle: true }));
    vc.CancelDrag();
    panel.ProcessEvent(mouse(wxEVT_MOTION, 450, 350, { middle: true }));
    expect(view.GetCenter()).toEqual({ x: 0, y: 0 });
    panel.ProcessEvent(mouse(wxEVT_LEFT_UP, 450, 350));
  });
});

describe('WX_VIEW_CONTROLS::onScroll', () => {
  it('a page up pans by half the viewport, a line down by 5% the other way, then refreshes', () => {
    const { view, panel } = setup();
    const screenWorld = view.ToWorld({ x: 800, y: 600 }, false);

    panel.ProcessEvent(new wxScrollWinEvent(wxEVT_SCROLLWIN_PAGEUP, 0, wxOrientation.wxVERTICAL));
    expect(view.GetCenter().y).toBeCloseTo(-screenWorld.y * 0.5);

    panel.ProcessEvent(
      new wxScrollWinEvent(wxEVT_SCROLLWIN_LINEDOWN, 0, wxOrientation.wxHORIZONTAL),
    );
    expect(view.GetCenter().x).toBeCloseTo(screenWorld.x * 0.05);
    expect(panel.refreshes).toBe(2);
  });
});

describe('WX_VIEW_CONTROLS cursor', () => {
  it('GetCursorPosition snaps through the GAL grid when snapping is on, raw otherwise', () => {
    const { view, gal, panel, vc, options } = setup();
    const raw = view.ToWorld({ x: 430, y: 340 });
    gal.SetGridSize({ x: raw.x * 3, y: raw.y * 3 }); // the nearest grid point is the origin
    options.m_gridSnapping = GRID_SNAPPING.ALWAYS;

    panel.ProcessEvent(mouse(wxEVT_MOTION, 430, 340));
    expect(vc.GetRawCursorPosition(false)).toEqual(raw);
    expect(vc.GetCursorPosition()).toEqual({ x: 0, y: 0 });
    expect(vc.GetCursorPosition(false)).toEqual(raw);

    options.m_gridSnapping = GRID_SNAPPING.NEVER;
    expect(vc.GetCursorPosition()).toEqual(raw);
  });

  it('ForceCursorPosition wins over the mouse until released', () => {
    const { view, panel, vc, options } = setup();
    options.m_gridSnapping = GRID_SNAPPING.NEVER;
    panel.ProcessEvent(mouse(wxEVT_MOTION, 430, 340));
    vc.ForceCursorPosition(true, { x: 7, y: 9 });
    expect(vc.GetCursorPosition()).toEqual({ x: 7, y: 9 });
    vc.ForceCursorPosition(false);
    expect(vc.GetCursorPosition()).toEqual(view.ToWorld({ x: 430, y: 340 }));
  });

  it('SetCrossHairCursorPosition recentres the view only when the point is off screen', () => {
    const { view, vc, options } = setup();
    options.m_gridSnapping = GRID_SNAPPING.NEVER;
    const onScreen = view.ToWorld({ x: 10, y: 10 });
    vc.SetCrossHairCursorPosition(onScreen, true);
    expect(view.GetCenter()).toEqual({ x: 0, y: 0 });
    const offScreen = view.ToWorld({ x: 1200, y: 900 });
    vc.SetCrossHairCursorPosition(offScreen, true);
    expect(view.GetCenter()).toEqual(offScreen);
    expect(vc.GetCursorPosition(false)).toEqual(offScreen);
  });

  it('the coordinates are clamped to what an int can negate', () => {
    const { vc } = setup();
    vc.ForceCursorPosition(true, { x: 1e12, y: -1e12 });
    expect(vc.GetCursorPosition()).toEqual({ x: 2147483646, y: -2147483646 });
  });

  it('UpdateScrollbars scales the boundary to a 2000-unit range and posts a refresh', () => {
    const { panel, vc } = setup();
    vc.UpdateScrollbars();
    expect(panel.scrollbars).toHaveLength(1);
    expect(panel.scrollbars[0]![0]).toBe(1);
    expect(panel.posted.some((e) => e.GetEventType() === WX_VIEW_CONTROLS.EVT_REFRESH_MOUSE)).toBe(
      true,
    );
    // Unchanged: no second SetScrollbars
    panel.posted = [];
    vc.UpdateScrollbars();
    expect(panel.scrollbars).toHaveLength(1);
    expect(panel.posted).toHaveLength(0);
  });
});

describe('WX_VIEW_CONTROLS auto-panning', () => {
  it('with auto pan enabled by the tool AND the setting, a pointer in the margin starts panning', () => {
    const { view, panel, vc } = setup({ auto_pan: true });
    vc.SetAutoPan(true);
    vc.SetAutoPanMargin(0.02); // 2% of 600 = 12 px
    const c0 = { ...view.GetCenter() };

    panel.ProcessEvent(mouse(wxEVT_MOTION, 5, 300)); // 7 px inside the left margin

    // The pan is on the timer; it is started, and nothing has moved yet
    expect(view.GetCenter()).toEqual(c0);
    const vcp = vc as unknown as { m_state: number; m_panDirection: Vec2 };
    expect(vcp.m_state).toBe(3); // AUTO_PANNING
    expect(vcp.m_panDirection).toEqual({ x: -7, y: 0 });

    panel.ProcessEvent(mouse(wxEVT_MOTION, 400, 300));
    expect(vcp.m_state).toBe(1); // IDLE
    vc.Destroy();
  });

  it('without the setting nothing happens in the margin', () => {
    const { panel, vc } = setup({ auto_pan: false });
    vc.SetAutoPan(true);
    panel.ProcessEvent(mouse(wxEVT_MOTION, 5, 300));
    expect((vc as unknown as { m_state: number }).m_state).toBe(1);
  });
});
