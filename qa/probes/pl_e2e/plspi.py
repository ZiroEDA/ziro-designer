#!/usr/bin/env python3
"""AT-SPI helpers for driving a real pl_editor and reading what it shows.

Every function here is toolkit-truth: the strings, extents and states are the
ones GTK/wx publish for the widgets KiCad actually built.  Used by the
end-to-end comparison behind docs/editor-status.md's E4 claim for pl_editor.
"""
import os
import sys
import time
import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

Atspi.init()


def app_by_pid(pid, tries=40):
    for _ in range(tries):
        d = Atspi.get_desktop(0)
        for i in range(d.get_child_count()):
            a = d.get_child_at_index(i)
            if a is None:
                continue
            try:
                if a.get_process_id() == pid:
                    return a
            except Exception:
                continue
        time.sleep(0.25)
    raise SystemExit(f"no AT-SPI application with pid {pid}")


def walk(node, depth=0, maxdepth=25):
    yield depth, node
    if depth >= maxdepth:
        return
    for i in range(node.get_child_count()):
        try:
            c = node.get_child_at_index(i)
        except Exception:
            continue
        if c is None:
            continue
        yield from walk(c, depth + 1, maxdepth)


def role(n):
    try:
        return n.get_role_name()
    except Exception:
        return "?"


def name(n):
    try:
        return n.get_name() or ""
    except Exception:
        return ""


def find(root, role_name=None, name_eq=None, name_has=None, maxdepth=25):
    for _, n in walk(root, 0, maxdepth):
        if role_name is not None and role(n) != role_name:
            continue
        nm = name(n)
        if name_eq is not None and nm != name_eq:
            continue
        if name_has is not None and name_has not in nm:
            continue
        yield n


def first(root, **kw):
    for n in find(root, **kw):
        return n
    return None


def text_of(n):
    try:
        ti = n.get_text_iface()
        if ti is None:
            return None
        return Atspi.Text.get_text(ti, 0, Atspi.Text.get_character_count(ti))
    except Exception:
        return None


def extents(n):
    try:
        c = n.get_component_iface()
        if c is None:
            return None
        r = Atspi.Component.get_extents(c, Atspi.CoordType.SCREEN)
        return (r.x, r.y, r.width, r.height)
    except Exception:
        return None


def do_action(n, want=None):
    """Fire the widget's own default action (click / press / activate)."""
    ai = n.get_action_iface()
    if ai is None:
        return False
    cnt = Atspi.Action.get_n_actions(ai)
    for i in range(cnt):
        an = Atspi.Action.get_action_name(ai, i)
        if want is None or an == want:
            Atspi.Action.do_action(ai, i)
            return True
    return False


def click(n, button=1):
    """XTEST click at the widget's centre."""
    e = extents(n)
    if not e:
        return False
    x, y, w, h = e
    Atspi.generate_mouse_event(x + w // 2, y + h // 2, "abs")
    time.sleep(0.15)
    Atspi.generate_mouse_event(x + w // 2, y + h // 2, f"b{button}c")
    return True


def key(spec):
    Atspi.generate_keyboard_event(0, spec, Atspi.KeySynthType.STRING)


def keysym(sym):
    Atspi.generate_keyboard_event(sym, None, Atspi.KeySynthType.PRESSRELEASE)


def frame_of(app):
    return app.get_child_at_index(0)


def statusbar_panes(app):
    """The eight KISTATUSBAR panes: (text, x, y, w, h) in add order."""
    fr = frame_of(app)
    panes = []
    for _, n in walk(fr, 0, 25):
        if role(n) in ("status bar",):
            for i in range(n.get_child_count()):
                c = n.get_child_at_index(i)
                panes.append((name(c) or text_of(c) or "", extents(c)))
            return panes
    # wx builds a plain GtkStatusbar-less bar; fall back to the last panel row.
    return panes


def dump(app, maxdepth=25):
    out = []
    for d, n in walk(frame_of(app), 0, maxdepth):
        t = text_of(n)
        e = extents(n)
        out.append(
            "  " * d
            + f"{role(n)} {name(n)!r}"
            + (f" ext={e}" if e else "")
            + (f" text={t!r}" if t else "")
        )
    return "\n".join(out)


if __name__ == "__main__":
    pid = int(sys.argv[1])
    depth = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    print(dump(app_by_pid(pid), depth))
