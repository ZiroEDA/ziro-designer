// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The DOM to wx event conversion (`wx/dom_events.ts`): wxGTK's rules for a
 * wheel notch (120, `GDK_SCROLL_SMOOTH`'s delta of 1.0), a horizontal
 * scroll, the button events (the second press of a double click is the
 * DCLICK), the button state after the event, and the key codes.
 */
import { describe, expect, it } from 'vitest';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import {
  wxKeyCodeFromDom,
  wxMouseEventFromDom,
  wxWheelEventFromDom,
} from '@ziroeda/common/wx/dom_events.js';
import { wxGetKeyState, wxMouseWheelAxis } from '@ziroeda/common/wx/wx_event.js';

const target = {
  getBoundingClientRect: () => ({ left: 10, top: 20 }),
} as unknown as HTMLElement;

function wheelDom(over: Record<string, unknown>): WheelEvent {
  return dom(over) as unknown as WheelEvent;
}

function dom(over: Record<string, unknown>): PointerEvent {
  return {
    clientX: 110,
    clientY: 220,
    pageX: 110,
    pageY: 220,
    button: 0,
    buttons: 0,
    detail: 1,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    timeStamp: 5,
    pointerType: 'mouse',
    ...over,
  } as unknown as PointerEvent;
}

describe('wxWheelEventFromDom', () => {
  it('a Chrome wheel notch (100 px) is a rotation of 120, up for a negative deltaY', () => {
    const e = wxWheelEventFromDom(
      target,
      wheelDom({ ...dom({}), deltaX: 0, deltaY: -100, deltaMode: 0 }),
    );
    expect(e.GetWheelRotation()).toBe(120);
    expect(e.GetWheelAxis()).toBe(wxMouseWheelAxis.wxMOUSE_WHEEL_VERTICAL);
    expect(e.GetWheelDelta()).toBe(120);
    expect(e.GetX()).toBe(100);
    expect(e.GetY()).toBe(200);
  });

  it('a Firefox notch is 3 lines; a page is a notch', () => {
    expect(
      wxWheelEventFromDom(
        target,
        wheelDom({ ...dom({}), deltaX: 0, deltaY: 3, deltaMode: 1 }),
      ).GetWheelRotation(),
    ).toBe(-120);
    expect(
      wxWheelEventFromDom(
        target,
        wheelDom({ ...dom({}), deltaX: 0, deltaY: 1, deltaMode: 2 }),
      ).GetWheelRotation(),
    ).toBe(-120);
  });

  it('a touchpad scroll of 10 px is 12, truncated as int( -delta_y * 120 )', () => {
    expect(
      wxWheelEventFromDom(
        target,
        wheelDom({ ...dom({}), deltaX: 0, deltaY: 10, deltaMode: 0 }),
      ).GetWheelRotation(),
    ).toBe(-12);
    expect(
      wxWheelEventFromDom(
        target,
        wheelDom({ ...dom({}), deltaX: 0, deltaY: 1, deltaMode: 0 }),
      ).GetWheelRotation(),
    ).toBe(-1);
  });

  it('a purely horizontal delta is a horizontal-axis event, positive to the right', () => {
    const e = wxWheelEventFromDom(
      target,
      wheelDom({ ...dom({}), deltaX: 50, deltaY: 0, deltaMode: 0 }),
    );
    expect(e.GetWheelAxis()).toBe(wxMouseWheelAxis.wxMOUSE_WHEEL_HORIZONTAL);
    expect(e.GetWheelRotation()).toBe(60);
  });

  it('the modifiers ride along, and wxGetKeyState sees them', () => {
    const e = wxWheelEventFromDom(
      target,
      wheelDom({
        ...dom({ ctrlKey: true, shiftKey: true }),
        deltaX: 0,
        deltaY: -100,
        deltaMode: 0,
      }),
    );
    expect(e.ControlDown()).toBe(true);
    expect(e.ShiftDown()).toBe(true);
    expect(e.AltDown()).toBe(false);
    expect(wxGetKeyState(WXK.WXK_CONTROL)).toBe(true);
    expect(wxGetKeyState(WXK.WXK_ALT)).toBe(false);
  });
});

describe('wxMouseEventFromDom', () => {
  it('a press is the button DOWN with that button now down', () => {
    const e = wxMouseEventFromDom(target, dom({ button: 1, buttons: 4 }), 'down');
    expect(e.MiddleDown()).toBe(true);
    expect(e.MiddleIsDown()).toBe(true);
    expect(e.LeftIsDown()).toBe(false);
    expect(e.ButtonDown()).toBe(true);
    expect(e.Dragging()).toBe(false);
  });

  it('the second press of a double click is the DCLICK', () => {
    const e = wxMouseEventFromDom(target, dom({ button: 0, buttons: 1, detail: 2 }), 'down');
    expect(e.LeftDClick()).toBe(true);
    expect(e.LeftDown()).toBe(false);
    expect(e.GetClickCount()).toBe(2);
  });

  it('a release is the UP with the button up; a move with a button held is Dragging', () => {
    const up = wxMouseEventFromDom(target, dom({ button: 2, buttons: 0 }), 'up');
    expect(up.RightUp()).toBe(true);
    expect(up.RightIsDown()).toBe(false);

    const move = wxMouseEventFromDom(target, dom({ buttons: 2 }), 'move');
    expect(move.Dragging()).toBe(true);
    expect(move.RightIsDown()).toBe(true);
    expect(move.Moving()).toBe(false);

    const hover = wxMouseEventFromDom(target, dom({}), 'move');
    expect(hover.Moving()).toBe(true);
  });

  it('the aux buttons map to AUX1 / AUX2', () => {
    expect(wxMouseEventFromDom(target, dom({ button: 3, buttons: 8 }), 'down').Aux1Down()).toBe(
      true,
    );
    expect(wxMouseEventFromDom(target, dom({ button: 4, buttons: 16 }), 'down').Aux2Down()).toBe(
      true,
    );
  });
});

describe('wxKeyCodeFromDom', () => {
  const key = (k: string, over: Record<string, unknown> = {}): KeyboardEvent =>
    ({
      key: k,
      code: '',
      location: 0,
      keyCode: 0,
      repeat: false,
      ...over,
    }) as unknown as KeyboardEvent;

  it('letters are upper-case ASCII whatever the shift state; digits and symbols are themselves', () => {
    expect(wxKeyCodeFromDom(key('a'))).toBe(65);
    expect(wxKeyCodeFromDom(key('A'))).toBe(65);
    expect(wxKeyCodeFromDom(key('7'))).toBe(55);
    expect(wxKeyCodeFromDom(key('+'))).toBe(43);
    expect(wxKeyCodeFromDom(key(' '))).toBe(WXK.WXK_SPACE);
  });

  it('the named keys, the function keys and the numpad', () => {
    expect(wxKeyCodeFromDom(key('Escape'))).toBe(WXK.WXK_ESCAPE);
    expect(wxKeyCodeFromDom(key('ArrowLeft'))).toBe(WXK.WXK_LEFT);
    expect(wxKeyCodeFromDom(key('Delete'))).toBe(WXK.WXK_DELETE);
    expect(wxKeyCodeFromDom(key('F12'))).toBe(WXK.WXK_F12);
    expect(wxKeyCodeFromDom(key('F24'))).toBe(WXK.WXK_F24);
    expect(wxKeyCodeFromDom(key('5', { code: 'Numpad5', location: 3 }))).toBe(WXK.WXK_NUMPAD5);
    expect(wxKeyCodeFromDom(key('Enter', { code: 'NumpadEnter', location: 3 }))).toBe(
      WXK.WXK_NUMPAD_ENTER,
    );
    expect(wxKeyCodeFromDom(key('Enter'))).toBe(WXK.WXK_RETURN);
    expect(wxKeyCodeFromDom(key('Dead'))).toBe(WXK.WXK_NONE);
  });
});
