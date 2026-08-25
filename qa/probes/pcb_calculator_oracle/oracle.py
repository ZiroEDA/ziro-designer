"""KiCad pcb_calculator oracle.

Drives the REAL KiCad 10.0.5 `pcb_calculator` through AT-SPI: sets the page
via ~/.config/kicad/10.0/pcb_calculator.json, launches, then reads the exact
strings its wxTextCtrl / wxStaticText widgets display. Nothing is OCR'd and
nothing is computed here - every expected value in the resulting tests is a
string KiCad itself rendered on this machine.
"""
import json, os, signal, subprocess, sys, time, unicodedata
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

CFG = os.path.expanduser('~/.config/kicad/10.0/pcb_calculator.json')
BACKUP = '/home/akshay/kicad-pcbcalc-json.BACKUP'
LAUNCH = '/home/akshay/launch-pcbcalc.sh'

PAGES = {
    'regulators': 1, 'r_calculator': 2, 'electrical_spacing': 4, 'via_size': 5,
    'track_width': 6, 'fusing_current': 7, 'cable_size': 8, 'wavelength': 10,
    'rf_attenuators': 11, 'transline': 12, 'eseries': 14, 'color_code': 15,
    'board_class': 16, 'galvanic': 17,
}

Atspi.init()


def kill_all():
    subprocess.run(['pkill', '-f', '/usr/bin/pcb_calculator'], check=False)
    for _ in range(40):
        r = subprocess.run(['pgrep', '-f', '/usr/bin/pcb_calculator'],
                           capture_output=True)
        if r.returncode != 0:
            return
        time.sleep(0.25)
    subprocess.run(['pkill', '-9', '-f', '/usr/bin/pcb_calculator'], check=False)
    time.sleep(1)


def write_cfg(mutate):
    with open(BACKUP) as f:
        cfg = json.load(f)
    mutate(cfg)
    with open(CFG, 'w') as f:
        json.dump(cfg, f, indent=2)


def launch(timeout=25):
    subprocess.Popen(['setsid', LAUNCH],
                     stdout=open('/home/akshay/pcbcalc.log', 'w'),
                     stderr=subprocess.STDOUT)
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.7)
        try:
            a = find_app()
        except LookupError:
            continue
        # wait until the content panel actually has widgets
        try:
            root = content(a)
            if root.get_child_count() > 0:
                time.sleep(1.2)
                return a
        except Exception:
            pass
    raise SystemExit('pcb_calculator did not come up')


def find_app(name='pcb_calculator'):
    d = Atspi.get_desktop(0)
    # libatspi caches children aggressively; a stale tree silently reports the
    # PREVIOUS page's widgets, which reads exactly like a page switch that did
    # not happen. Drop the cache on every lookup.
    try:
        Atspi.Accessible.clear_cache(d)
    except Exception:
        pass
    _ = d.get_child_count()
    for i in range(d.get_child_count()):
        x = d.get_child_at_index(i)
        if x is not None and x.get_name() == name:
            return x
    raise LookupError(name)


def content(a):
    """frame > filler > panel : the treebook's page area.

    Every page's panel is exposed, visible or not, as children 1..N of this
    node's first child (child 0 is the page-list tree)."""
    try:
        Atspi.Accessible.clear_cache(a)
    except Exception:
        pass
    frame = a.get_child_at_index(0)
    for i in range(frame.get_child_count()):
        c = frame.get_child_at_index(i)
        if role(c) == 'filler':
            for j in range(c.get_child_count()):
                d = c.get_child_at_index(j)
                if role(d) == 'panel':
                    return d
    raise SystemExit('no content panel')


def role(n):
    try:
        return n.get_role_name()
    except Exception:
        return '?'


def nm(n):
    try:
        return n.get_name() or ''
    except Exception:
        return ''


def txt(n):
    try:
        return Atspi.Text.get_text(n, 0, Atspi.Text.get_character_count(n))
    except Exception:
        return None


def walk(node, depth=0, path=(), maxdepth=40):
    yield depth, node, path
    if depth >= maxdepth:
        return
    for i in range(node.get_child_count()):
        c = node.get_child_at_index(i)
        if c is None:
            continue
        yield from walk(c, depth + 1, path + (i,), maxdepth)


def flat(a=None):
    """[(path, role, name, text)] for every widget on the visible page."""
    a = a or find_app()
    out = []
    for depth, n, path in walk(content(a)):
        out.append(('.'.join(map(str, path)), role(n), nm(n), txt(n)))
    return out


def dump(a=None):
    for p, r, n, t in flat(a):
        line = '%-16s [%s] %r' % (p, r, n)
        if t is not None and t != n:
            line += '  TEXT=%r' % t
        print(line)


def at(path, a=None):
    a = a or find_app()
    n = content(a)
    for i in str(path).split('.'):
        n = n.get_child_at_index(int(i))
    return n


def set_text(node, value):
    Atspi.EditableText.set_text_contents(node, str(value))
    time.sleep(0.15)


def press(node):
    Atspi.Action.do_action(node, 0)
    time.sleep(0.8)


def norm(s):
    # KiCad's unit labels mix U+2126 OHM SIGN with U+03A9 GREEK CAPITAL OMEGA
    # and U+00B5 MICRO SIGN with U+03BC GREEK SMALL MU. NFKC folds both pairs.
    return unicodedata.normalize('NFKC', s or '')


def choose(combo, label):
    """Pick an item from a wxChoice by its label."""
    menu = combo.get_child_at_index(0)
    for i in range(menu.get_child_count()):
        it = menu.get_child_at_index(i)
        if norm(nm(it)) == norm(label):
            # Atspi.Selection.select_child moves nothing on a wxChoice - it
            # returns True and the widget never changes, so every "unit switch"
            # case silently measured the DEFAULT unit. Clicking the menu item is
            # what a user does and what wx turns into wxEVT_CHOICE.
            Atspi.Action.do_action(it, 0)
            time.sleep(0.6)
            return
    raise SystemExit('no combo item %r in %r' %
                     (label, [nm(menu.get_child_at_index(i))
                              for i in range(menu.get_child_count())]))


def combo_items(combo):
    menu = combo.get_child_at_index(0)
    return [nm(menu.get_child_at_index(i)) for i in range(menu.get_child_count())]


def restore():
    kill_all()
    import shutil
    shutil.copy(BACKUP, CFG)


PANEL_IDX = {
    'regulators': 1, 'r_calculator': 2, 'electrical_spacing': 3, 'via_size': 4,
    'track_width': 5, 'fusing_current': 6, 'cable_size': 7, 'wavelength': 8,
    'rf_attenuators': 9, 'transline': 10, 'eseries': 11, 'color_code': 12,
    'board_class': 13, 'galvanic': 14,
}


def panel(key, a=None):
    a = a or find_app()
    return content(a).get_child_at_index(0).get_child_at_index(PANEL_IDX[key])


def pdump(key, maxdepth=40):
    root = panel(key)
    for depth, n, path in walk(root, maxdepth=maxdepth):
        r = role(n); name = nm(n); t = txt(n)
        line = '%-14s [%s] %r' % ('.'.join(map(str, path)), r, name)
        if t is not None and t != name:
            line += '  TEXT=%r' % t
        if r in ('check box', 'radio button'):
            try:
                st = n.get_state_set()
                line += '  CHECKED=%s' % st.contains(Atspi.StateType.CHECKED)
            except Exception:
                pass
        if r == 'combo box':
            line += '  ITEMS=%s' % (combo_items(n),)
        print(line)


def pat(key, path):
    n = panel(key)
    for i in str(path).split('.'):
        n = n.get_child_at_index(int(i))
    return n


def wid():
    import re
    out = subprocess.run(['xwininfo', '-root', '-tree'], capture_output=True,
                         text=True, env=dict(os.environ, DISPLAY=':0')).stdout
    for line in out.splitlines():
        if '"Calculator Tools"' in line and 'pcb_calculator' in line:
            return line.split()[0]
    raise SystemExit('no window')


def shot(node, out, pad=4):
    """Screenshot exactly the rectangle one AT-SPI widget occupies."""
    ext = Atspi.Component.get_extents(node, Atspi.CoordType.SCREEN)
    win = subprocess.run(['xwininfo', '-id', wid()], capture_output=True, text=True,
                         env=dict(os.environ, DISPLAY=':0')).stdout
    ax = int([l for l in win.splitlines() if 'Absolute upper-left X' in l][0].split()[-1])
    ay = int([l for l in win.splitlines() if 'Absolute upper-left Y' in l][0].split()[-1])
    x, y = ext.x - ax, ext.y - ay
    subprocess.run(['import', '-window', wid(), '-crop',
                    '%dx%d+%d+%d' % (ext.width + 2 * pad, ext.height + 2 * pad,
                                     max(0, x - pad), max(0, y - pad)),
                    '+repage', out],
                   check=True, env=dict(os.environ, DISPLAY=':0'))
    return out
