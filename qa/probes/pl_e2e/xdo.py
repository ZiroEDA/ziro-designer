#!/usr/bin/env python3
"""A tiny xdotool: activate a window, type, click, capture.

xdotool is not installed on this box; python-xlib is.  Everything here is
XTEST, the same synthetic-input path xdotool uses.
"""
import subprocess
import time

from Xlib import X, XK, display
from Xlib.ext import xtest
from Xlib.protocol import event

_d = display.Display()
_root = _d.screen().root


def _atom(n):
    return _d.intern_atom(n)


def windows_for_pid(pid, title_has=None):
    """Every viewable toplevel whose _NET_WM_PID is pid."""
    out = []

    def rec(w):
        try:
            children = w.query_tree().children
        except Exception:
            return
        for c in children:
            try:
                p = c.get_full_property(_atom("_NET_WM_PID"), X.AnyPropertyType)
                nm = c.get_wm_name()
            except Exception:
                p, nm = None, None
            if p and p.value[0] == pid:
                if title_has is None or (nm and title_has in nm):
                    out.append((c, nm))
            rec(c)

    rec(_root)
    return out


def activate(win):
    ev = event.ClientMessage(
        window=win,
        client_type=_atom("_NET_ACTIVE_WINDOW"),
        data=(32, [2, X.CurrentTime, 0, 0, 0]),
    )
    _root.send_event(ev, event_mask=X.SubstructureRedirectMask | X.SubstructureNotifyMask)
    _d.sync()
    time.sleep(0.4)


def focused():
    f = _d.get_input_focus().focus
    try:
        return f.id, f.get_wm_name()
    except Exception:
        return f, None


def _keycode(sym):
    ks = XK.string_to_keysym(sym)
    return _d.keysym_to_keycode(ks)


def key(*names):
    """key('ctrl','l') / key('Return') / key('Escape')."""
    mods = {"ctrl": "Control_L", "alt": "Alt_L", "shift": "Shift_L"}
    codes = [_keycode(mods.get(n, n)) for n in names]
    for c in codes:
        xtest.fake_input(_d, X.KeyPress, c)
    for c in reversed(codes):
        xtest.fake_input(_d, X.KeyRelease, c)
    _d.sync()
    time.sleep(0.12)


_SYMNAME = {
    "/": "slash", ".": "period", "_": "underscore", "-": "minus", " ": "space",
    "~": "asciitilde", ":": "colon", "(": "parenleft", ")": "parenright",
    ",": "comma", "*": "asterisk", "=": "equal", "+": "plus", "%": "percent",
    "'": "apostrophe", '"': "quotedbl", "!": "exclam", "?": "question",
    "#": "numbersign", "$": "dollar", "&": "ampersand", "@": "at",
    "[": "bracketleft", "]": "bracketright", "{": "braceleft",
    "}": "braceright", ";": "semicolon", "<": "less", ">": "greater",
    "|": "bar", "\\": "backslash", "^": "asciicircum", "`": "grave",
}


def _code_and_shift(ch):
    """Keycode for ch, and whether Shift is needed to reach it on this layout."""
    sym = _SYMNAME.get(ch, ch)
    ks = XK.string_to_keysym(sym)
    kc = _d.keysym_to_keycode(ks)
    # Level 0 of that keycode is what an unshifted press produces.
    return kc, _d.keycode_to_keysym(kc, 0) != ks


_SPARE_KC = None


def _spare_keycode():
    """A keycode with no keysym bound, for remapping (xdotool's trick)."""
    global _SPARE_KC
    if _SPARE_KC is not None:
        return _SPARE_KC
    mn = _d.display.info.min_keycode
    mx = _d.display.info.max_keycode
    for kc in range(mx, mn, -1):
        if all(_d.keycode_to_keysym(kc, i) == 0 for i in range(4)):
            _SPARE_KC = kc
            return kc
    raise RuntimeError("no spare keycode")


def type_remapped(text):
    """Type text by binding each character's keysym to a spare keycode.

    XTEST Shift does not reach GTK clients on this Xwayland session, so a
    shifted character typed the ordinary way arrives unshifted ('_' becomes
    '-').  Remapping sidesteps the modifier entirely.
    """
    kc = _spare_keycode()
    for ch in text:
        sym = _SYMNAME.get(ch, ch)
        ks = XK.string_to_keysym(sym)
        _d.change_keyboard_mapping(kc, [[ks, ks, ks, ks]])
        _d.sync()
        time.sleep(0.03)
        xtest.fake_input(_d, X.KeyPress, kc)
        xtest.fake_input(_d, X.KeyRelease, kc)
        _d.sync()
        time.sleep(0.03)
    _d.change_keyboard_mapping(kc, [[0, 0, 0, 0]])
    _d.sync()


def type_text(s):
    for ch in s:
        kc, shift = _code_and_shift(ch)
        if shift:
            xtest.fake_input(_d, X.KeyPress, _keycode("Shift_L"))
            _d.sync()
            time.sleep(0.03)
        xtest.fake_input(_d, X.KeyPress, kc)
        _d.sync()
        time.sleep(0.03)
        xtest.fake_input(_d, X.KeyRelease, kc)
        _d.sync()
        time.sleep(0.03)
        if shift:
            xtest.fake_input(_d, X.KeyRelease, _keycode("Shift_L"))
            _d.sync()
            time.sleep(0.03)


def click(x, y, button=1):
    xtest.fake_input(_d, X.MotionNotify, x=x, y=y)
    _d.sync()
    time.sleep(0.15)
    xtest.fake_input(_d, X.ButtonPress, button)
    _d.sync()
    time.sleep(0.05)
    xtest.fake_input(_d, X.ButtonRelease, button)
    _d.sync()
    time.sleep(0.15)


def move(x, y):
    xtest.fake_input(_d, X.MotionNotify, x=x, y=y)
    _d.sync()
    time.sleep(0.1)


def capture(win_id, path, crop=None):
    subprocess.run(["import", "-window", hex(win_id), path], check=True)
    if crop:
        subprocess.run(["convert", path, "-crop", crop, "+repage", path], check=True)
    return path
