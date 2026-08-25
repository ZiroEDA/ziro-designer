#!/usr/bin/env python3
"""How wide is DIALOG_PAGES_SETTINGS in each frame, on a CLEAN config?

Akshay observed real KiCad's Page Settings at the same width in eeschema and in
pcbnew, even though pcbnew hides the fourteen export checkboxes and the two
sheet tallies. I guessed that was DIALOG_SHIM restoring a remembered rect
(dialog_shim.cpp:452-474, keyed by the dialog TITLE — and eeschema and pcbnew
share the title "Page Settings", so they share the saved geometry). He says he
never resized it and both were opened fresh, which contradicts that.

Rather than argue about wxSizer internals, ask the toolkit. This runs each
frame under a THROWAWAY XDG_CONFIG_HOME so there is no saved geometry to
restore, opens Page Settings, and reads the dialog's own extents off the
accessibility bus — the same mechanism qa/probes/pcb_calculator_oracle uses.

If the two widths match on a clean config, the equal width is a layout rule and
we have to port it. If they differ, the screenshots were showing a shared
remembered rect after all, and ours shrinking is correct.
"""
import os, shutil, subprocess, sys, tempfile, time
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

Atspi.init()


def desktop_children():
    d = Atspi.get_desktop(0)
    try:
        Atspi.Accessible.clear_cache(d)
    except Exception:
        pass
    return [d.get_child_at_index(i) for i in range(d.get_child_count())]


def find_app(name):
    for a in desktop_children():
        try:
            if a and a.get_name() == name:
                return a
        except Exception:
            pass
    raise LookupError(name)


def walk(node, depth=0, limit=6):
    yield node, depth
    if depth >= limit:
        return
    for i in range(node.get_child_count()):
        c = node.get_child_at_index(i)
        if c is not None:
            yield from walk(c, depth + 1, limit)


def find_dialog(app, titles):
    for n, _ in walk(app, limit=3):
        try:
            role = n.get_role_name()
            nm = n.get_name()
        except Exception:
            continue
        if role in ('dialog', 'frame') and nm in titles:
            return n
    return None


def measure(binary, appname, cfg_home):
    env = dict(os.environ, DISPLAY=':0', XDG_CONFIG_HOME=cfg_home,
               GDK_BACKEND='x11')
    p = subprocess.Popen(['setsid', binary], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    app = None
    for _ in range(40):
        time.sleep(1.0)
        try:
            app = find_app(appname)
            break
        except LookupError:
            continue
    if app is None:
        p.kill()
        return None, 'never appeared'

    time.sleep(4.0)
    # File > Page Settings, by name, so no coordinates are guessed.
    opened = False
    for n, _ in walk(app, limit=6):
        try:
            if n.get_role_name() == 'menu item' and 'Page Settings' in (n.get_name() or ''):
                Atspi.Action.do_action(n, 0)
                opened = True
                break
        except Exception:
            continue

    dlg = None
    if opened:
        for _ in range(15):
            time.sleep(0.7)
            dlg = find_dialog(app, ('Page Settings', 'Preview Settings'))
            if dlg is not None:
                break

    out = None
    if dlg is not None:
        try:
            e = Atspi.Component.get_extents(dlg, Atspi.CoordType.SCREEN)
            out = (dlg.get_name(), e.width, e.height)
        except Exception as ex:
            out = ('extents failed', 0, 0)

    try:
        os.killpg(os.getpgid(p.pid), 15)
    except Exception:
        p.kill()
    time.sleep(2.0)
    return out, None


def main():
    for binary, appname in (('/usr/bin/eeschema', 'eeschema'),
                            ('/usr/bin/pcbnew', 'pcbnew')):
        if not os.path.exists(binary):
            print(f'{appname}: {binary} not found')
            continue
        cfg = tempfile.mkdtemp(prefix=f'kicadcfg-{appname}-')
        try:
            got, err = measure(binary, appname, cfg)
            if err:
                print(f'{appname}: {err}')
            elif got is None:
                print(f'{appname}: dialog never opened')
            else:
                title, w, h = got
                print(f'{appname}: "{title}" {w} x {h}')
        finally:
            shutil.rmtree(cfg, ignore_errors=True)


if __name__ == '__main__':
    main()
