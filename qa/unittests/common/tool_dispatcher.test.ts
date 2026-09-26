// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_DISPATCHER` against `common/tool/tool_dispatcher.cpp`, driven with
 * wx events and a manager that records what it is given. Each expectation is
 * the C++'s rule, cited:
 *
 *   handleMouseButton (:198-280)  a press is TA_MOUSE_DOWN; a release is a
 *                                 CLICK at the PRESS position unless the
 *                                 pointer went more than the drag metric
 *                                 (8 on wxGTK) from the press, then it is
 *                                 DRAG events and a TA_MOUSE_UP; a release
 *                                 is detected from the button STATE, so a
 *                                 lost up event still ends the drag.
 *   GetToolEvent (:400-475)       ESC is TC_COMMAND/TA_CANCEL_TOOL; Ctrl+A
 *                                 arrives as code 1 and becomes 'A'|MD_CTRL.
 *   DispatchWxEvent (:535-720)    a shifted CHAR_HOOK waits for its CHAR;
 *                                 a wheel is a tool event only with two or
 *                                 more modifiers.
 *   ShouldDropAutoRepeat (:500)   same key within 250 ms is dropped only
 *                                 once the key is up.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { TOOL_DISPATCHER } from '@ziroeda/common/tool/tool_dispatcher.js';
import {
  BUT_LEFT,
  MD_CTRL,
  MD_SHIFT,
  TA_CANCEL_TOOL,
  TA_KEY_PRESSED,
  TA_MOUSE_CLICK,
  TA_MOUSE_DOWN,
  TA_MOUSE_DRAG,
  TA_MOUSE_MOTION,
  TA_MOUSE_UP,
  TA_MOUSE_WHEEL,
  TC_COMMAND,
  TC_KEYBOARD,
  TC_MOUSE,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import {
  wxEVT_CHAR_HOOK,
  wxEVT_LEFT_DOWN,
  wxEVT_LEFT_UP,
  wxEVT_MOTION,
  wxEVT_MOUSEWHEEL,
  wxKeyEvent,
  wxMouseEvent,
  wxSetKeyState,
  wxSetMouseButtons,
} from '@ziroeda/common/wx/wx_event.js';

/** A manager that records events; world = screen * 10 so the two can be told apart. */
function harness(): {
  dispatcher: TOOL_DISPATCHER;
  events: TOOL_EVENT[];
  moveTo(x: number, y: number): void;
} {
  const events: TOOL_EVENT[] = [];
  let screen = { x: 0, y: 0 };
  const mgr = {
    ProcessEvent: (e: TOOL_EVENT): boolean => {
      events.push(e);
      return true;
    },
    GetViewControls: () => ({
      GetMousePosition: (aWorld = true) =>
        aWorld ? { x: screen.x * 10, y: screen.y * 10 } : { ...screen },
    }),
    GetToolHolder: () => null,
    GetView: () => null,
  };

  return {
    dispatcher: new TOOL_DISPATCHER(mgr as unknown as TOOL_MANAGER),
    events,
    moveTo: (x, y) => {
      screen = { x, y };
    },
  };
}

function mouse(aType: number, aMods: { ctrl?: boolean; shift?: boolean } = {}): wxMouseEvent {
  const e = new wxMouseEvent(aType);
  e.state.SetControlDown(aMods.ctrl ?? false);
  e.state.SetShiftDown(aMods.shift ?? false);
  return e;
}

function key(aCode: number, aMods: { ctrl?: boolean; shift?: boolean } = {}): wxKeyEvent {
  const e = new wxKeyEvent(wxEVT_CHAR_HOOK);
  e.m_keyCode = aCode;
  e.state.SetControlDown(aMods.ctrl ?? false);
  e.state.SetShiftDown(aMods.shift ?? false);
  return e;
}

beforeEach(() => wxSetMouseButtons(0));

describe('TOOL_DISPATCHER mouse buttons', () => {
  it('a press and release in place is DOWN then a CLICK at the press position', () => {
    const { dispatcher, events, moveTo } = harness();
    moveTo(5, 5);
    dispatcher.DispatchWxEvent(mouse(wxEVT_MOTION));
    events.length = 0;

    wxSetMouseButtons(1);
    dispatcher.DispatchWxEvent(mouse(wxEVT_LEFT_DOWN));
    wxSetMouseButtons(0);
    dispatcher.DispatchWxEvent(mouse(wxEVT_LEFT_UP));

    expect(events.map((e) => e.Action())).toEqual([TA_MOUSE_DOWN, TA_MOUSE_CLICK]);
    expect(events[1]!.Buttons()).toBe(BUT_LEFT);
    expect(events[1]!.Position()).toEqual({ x: 50, y: 50 });
  });

  it('8 px is still a click on wxGTK; 9 px makes a drag, then an UP instead of a click', () => {
    const { dispatcher, events, moveTo } = harness();
    wxSetMouseButtons(1);
    dispatcher.DispatchWxEvent(mouse(wxEVT_LEFT_DOWN));

    // `abs( offset.x ) > m_sysDragMinX`: 8 is not past 8. No button event
    // fires, so the move is the plain motion event (:620-625).
    moveTo(8, 0);
    dispatcher.DispatchWxEvent(mouse(wxEVT_MOTION));
    expect(events.at(-1)!.Action()).toBe(TA_MOUSE_MOTION);
    expect(events.some((e) => e.Action() === TA_MOUSE_DRAG)).toBe(false);

    moveTo(9, 0);
    dispatcher.DispatchWxEvent(mouse(wxEVT_MOTION));
    const drag = events.at(-1)!;
    expect(drag.Action()).toBe(TA_MOUSE_DRAG);
    expect(drag.DragOrigin()).toEqual({ x: 0, y: 0 });
    expect(drag.Delta()).toEqual({ x: 90, y: 0 });

    wxSetMouseButtons(0);
    dispatcher.DispatchWxEvent(mouse(wxEVT_LEFT_UP));
    expect(events.at(-1)!.Action()).toBe(TA_MOUSE_UP);
    expect(events.some((e) => e.Action() === TA_MOUSE_CLICK)).toBe(false);
  });

  it('a lost button-up still ends the press, read from the button state', () => {
    const { dispatcher, events, moveTo } = harness();
    wxSetMouseButtons(1);
    dispatcher.DispatchWxEvent(mouse(wxEVT_LEFT_DOWN));

    // The up event never arrives; the next motion sees the button released.
    wxSetMouseButtons(0);
    moveTo(1, 1);
    dispatcher.DispatchWxEvent(mouse(wxEVT_MOTION));

    expect(events.at(-1)!.Action()).toBe(TA_MOUSE_CLICK);
  });

  it('plain motion is TA_MOUSE_MOTION with the modifiers, and nothing when nothing moved', () => {
    const { dispatcher, events, moveTo } = harness();
    moveTo(3, 4);
    dispatcher.DispatchWxEvent(mouse(wxEVT_MOTION, { shift: true }));

    expect(events).toHaveLength(1);
    expect(events[0]!.Category()).toBe(TC_MOUSE);
    expect(events[0]!.Action()).toBe(TA_MOUSE_MOTION);
    expect(events[0]!.Modifier()).toBe(MD_SHIFT);

    dispatcher.DispatchWxEvent(mouse(wxEVT_MOTION));
    expect(events).toHaveLength(1);
  });
});

describe('TOOL_DISPATCHER wheel', () => {
  it('is left to the view controls with fewer than two modifiers', () => {
    const { dispatcher, events } = harness();
    const e = mouse(wxEVT_MOUSEWHEEL, { ctrl: true });
    e.m_wheelRotation = 120;
    dispatcher.DispatchWxEvent(e);

    expect(events).toHaveLength(0);
  });

  it('is a TA_MOUSE_WHEEL carrying the rotation with two modifiers', () => {
    const { dispatcher, events } = harness();
    const e = mouse(wxEVT_MOUSEWHEEL, { ctrl: true, shift: true });
    e.m_wheelRotation = -120;
    dispatcher.DispatchWxEvent(e);

    expect(events).toHaveLength(1);
    expect(events[0]!.Action()).toBe(TA_MOUSE_WHEEL);
    expect(events[0]!.Parameter<number>()).toBe(-120);
  });
});

describe('TOOL_DISPATCHER keys', () => {
  it('ESC is the cancel command', () => {
    const { dispatcher, events } = harness();
    dispatcher.DispatchWxEvent(key(WXK.WXK_ESCAPE));

    expect(events[0]!.Category()).toBe(TC_COMMAND);
    expect(events[0]!.Action()).toBe(TA_CANCEL_TOOL);
  });

  it('Ctrl+A, which wx delivers as code 1, is the key A with MD_CTRL', () => {
    const { dispatcher, events } = harness();
    wxSetKeyState(1, true);
    dispatcher.DispatchWxEvent(key(1, { ctrl: true }));

    expect(events[0]!.Category()).toBe(TC_KEYBOARD);
    expect(events[0]!.Action()).toBe(TA_KEY_PRESSED);
    expect(events[0]!.KeyCode()).toBe('A'.charCodeAt(0));
    expect(events[0]!.Modifier()).toBe(MD_CTRL);
  });

  it('a shift-modified CHAR_HOOK is skipped and makes no event', () => {
    const { dispatcher, events } = harness();
    const e = key('A'.charCodeAt(0), { shift: true });
    dispatcher.DispatchWxEvent(e);

    expect(events).toHaveLength(0);
    expect(e.GetSkipped()).toBe(true);
  });

  it('a modifier key alone makes no event', () => {
    const { dispatcher, events } = harness();
    dispatcher.DispatchWxEvent(key(WXK.WXK_CONTROL, { ctrl: true }));

    expect(events).toHaveLength(0);
  });
});

describe('TOOL_DISPATCHER::ShouldDropAutoRepeat', () => {
  it('drops a repeat of the same key inside 250 ms only once the key is up', () => {
    const last = { key: 0, timeMs: 0 };

    expect(TOOL_DISPATCHER.ShouldDropAutoRepeat(65, 1000, false, last)).toBe(false);
    expect(TOOL_DISPATCHER.ShouldDropAutoRepeat(65, 1100, true, last)).toBe(false);
    expect(TOOL_DISPATCHER.ShouldDropAutoRepeat(65, 1200, false, last)).toBe(true);
    // 250 ms is outside the window: `< AutoRepeatWindowMs`.
    expect(TOOL_DISPATCHER.ShouldDropAutoRepeat(65, 1450, false, last)).toBe(false);
    // Another key never continues the burst.
    expect(TOOL_DISPATCHER.ShouldDropAutoRepeat(66, 1460, false, last)).toBe(false);
  });
});
