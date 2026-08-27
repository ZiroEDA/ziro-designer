#!/usr/bin/env python3
"""Drive a running pl_editor through its menus and report what it shows.

    drive.py <pid> menu "File" "Open..."      -- click a menu item
    drive.py <pid> dialogs                    -- list this app's non-frame windows
    drive.py <pid> dump [depth]               -- dump the topmost window
"""
import sys
import time

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import plspi as P  # noqa: E402
from gi.repository import Atspi  # noqa: E402


def windows(app):
    fr = app.get_child_at_index(0)
    out = []
    for i in range(app.get_child_count()):
        out.append(app.get_child_at_index(i))
    return out


def click_menu(app, *path):
    node = app.get_child_at_index(0)
    bar = P.first(node, role_name="menu bar", maxdepth=4)
    cur = bar
    for step in path:
        nxt = None
        for i in range(cur.get_child_count()):
            c = cur.get_child_at_index(i)
            if c is not None and P.name(c) == step:
                nxt = c
                break
        if nxt is None:
            names = [P.name(cur.get_child_at_index(i)) for i in range(cur.get_child_count())]
            raise SystemExit(f"no menu entry {step!r}; have {names}")
        P.do_action(nxt, "click")
        time.sleep(0.6)
        cur = nxt
    return True


def main():
    pid = int(sys.argv[1])
    cmd = sys.argv[2]
    app = P.app_by_pid(pid)
    if cmd == "menu":
        click_menu(app, *sys.argv[3:])
        time.sleep(1.2)
        for i, w in enumerate(windows(app)):
            print(f"--- window {i}: {P.role(w)} {P.name(w)!r} ext={P.extents(w)}")
    elif cmd == "dialogs":
        for i, w in enumerate(windows(app)):
            print(f"--- window {i}: {P.role(w)} {P.name(w)!r} ext={P.extents(w)}")
    elif cmd == "dump":
        idx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        depth = int(sys.argv[4]) if len(sys.argv) > 4 else 25
        w = windows(app)[idx]
        out = []
        for d, n in P.walk(w, 0, depth):
            t = P.text_of(n)
            out.append("  " * d + f"{P.role(n)} {P.name(n)!r} ext={P.extents(n)}" + (f" text={t!r}" if t else ""))
        print("\n".join(out))
    elif cmd == "press":
        # press a named button in window idx
        idx = int(sys.argv[3])
        label = sys.argv[4]
        w = windows(app)[idx]
        b = P.first(w, role_name="push button", name_eq=label)
        if b is None:
            raise SystemExit("no button " + label)
        P.do_action(b, "click")
    elif cmd == "esc":
        Atspi.generate_keyboard_event(0xFF1B, None, Atspi.KeySynthType.PRESSRELEASE)
    else:
        raise SystemExit("unknown cmd")


if __name__ == "__main__":
    main()
