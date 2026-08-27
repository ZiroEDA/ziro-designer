#!/usr/bin/env python3
"""One pl_editor interaction per process.

The AT-SPI client cache goes stale once a modal has been up, so every step runs
in a fresh process.  Usage:

    PL_PID=<pid> step.py menu File "Open..."
    PL_PID=<pid> step.py chooser "Open Drawing Sheet" /path/to/file
    PL_PID=<pid> step.py status <outfile>
    PL_PID=<pid> step.py title
    PL_PID=<pid> step.py shot <title-substr> <outfile> [crop]
    PL_PID=<pid> step.py windows
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plspi as P  # noqa: E402
import xdo  # noqa: E402
import drive  # noqa: E402

PID = int(os.environ["PL_PID"])


def app():
    return P.app_by_pid(PID)


def xwins():
    return xdo.windows_for_pid(PID)


def xwin(sub):
    for w, nm in xwins():
        if nm and sub in str(nm):
            return w
    return None


def main_window():
    best, area = None, -1
    for w, _ in xwins():
        g = w.get_geometry()
        if g.width * g.height > area:
            best, area = w, g.width * g.height
    return best


cmd = sys.argv[1]

if cmd == "menu":
    drive.click_menu(app(), *sys.argv[2:])
    time.sleep(1.2)
elif cmd == "chooser":
    sub, path = sys.argv[2], sys.argv[3]
    w = xwin(sub)
    if w is None:
        raise SystemExit("no chooser " + sub)
    xdo.activate(w)
    time.sleep(0.8)
    xdo.key("ctrl", "l")
    time.sleep(0.6)
    xdo.type_remapped(path)
    time.sleep(0.8)
    xdo.key("Return")
    time.sleep(2.5)
elif cmd == "key":
    xdo.key(*sys.argv[2:])
elif cmd == "activate":
    w = xwin(sys.argv[2]) if len(sys.argv) > 2 else main_window()
    xdo.activate(w)
elif cmd == "status":
    w = main_window()
    g = w.get_geometry()
    out = sys.argv[2]
    xdo.capture(w.id, out, f"{g.width}x23+0+{g.height - 23}")
    os.system(f"convert {out} -scale 200% {out.replace('.png', '_big.png')}")
elif cmd == "shot":
    w = xwin(sys.argv[2]) if sys.argv[2] != "-" else main_window()
    crop = sys.argv[4] if len(sys.argv) > 4 else None
    xdo.capture(w.id, sys.argv[3], crop)
elif cmd == "title":
    print(P.name(app().get_child_at_index(0)))
elif cmd == "windows":
    for w, nm in xwins():
        g = w.get_geometry()
        print(hex(w.id), repr(nm), g.width, g.height)
elif cmd == "atspi":
    a = app()
    for i in range(a.get_child_count()):
        w = a.get_child_at_index(i)
        print(i, P.role(w), repr(P.name(w)), P.extents(w))
else:
    raise SystemExit("unknown " + cmd)
