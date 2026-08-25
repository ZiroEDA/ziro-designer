#!/usr/bin/env python3
"""Does KiCad skip the grid line that would sit under an axis, and for which styles?

`OPENGL_GAL::DrawGrid` (common/gal/opengl/opengl_gal.cpp:2000-2004 and
:2027-2031) and `CAIRO_GAL_BASE::DrawGrid` (common/gal/cairo/cairo_gal.cpp:
1825-1827 and :1839-1841) both carry

    // If axes are drawn, skip the lines that would cover them
    if( m_axesEnabled && y == 0.0 )
        continue;

so for GRID_STYLE::LINES the two backends agree and the answer does not depend
on which one is running.  They do NOT agree for DOTS: in OpenGL a dots grid is
the stencil intersection of those same two line loops, so the skip removes the
whole row and column of dots on the axes, while Cairo's dots branch is a
separate double loop with no skip in it.  And neither skips for SMALL_CROSS.
KiCad's default backend is OpenGL, so this measures the live app rather than
trusting the reading.

GerbView is the frame to measure.  It is the only one that turns the axes on
without a preference (`gerbview/gerbview_frame.cpp:188-191`, "Enable the axes to
match legacy draw style") and its axes keep the GAL's own default
`SetAxesColor( COLOR4D( BLUE ) )` (opengl_gal.cpp:433), which paints as
rgb(0,0,132) against a rgb(132,132,132) grid.  The axes go down BEFORE the grid,
so an unskipped grid line overpaints the blue with grey: which colour survives
at the axis is the whole measurement.

Three things that will waste a run
----------------------------------
* KiCad is **single-instance**.  A second launch opens a window inside the
  already-running process and reads the user's real config, so each capture gets
  a throwaway HOME and XDG_CONFIG_HOME.
* `env -i` is not optional (see ../README.md): a shell started from the editor
  inherits a snap environment whose libpthread breaks the launch with
  `__libc_pthread_init`.
* **The X root window cannot be captured here.**  The session is Wayland with
  Xwayland, and `import -window root` fails with "Resource temporarily
  unavailable".  Individual toplevels CAN be captured, so this finds GerbView's
  own window id with `xwininfo -root -tree` and captures that.

Close the app by PID.  Never `xkill`: xkill on a KiCad window once killed
mutter-x11-frames and took down the whole desktop.

Usage:  python3 measure.py            # all three styles
        python3 measure.py lines      # just one

Result on 2026-08-26, KiCad 10.0.5, GerbView, default 1.0 px grid pen:

    lines    axis column unbroken blue for the full canvas height, broken only
             where the perpendicular grid lines cross it; crossing pixel BLUE
    dots     dot columns ..., 817, 835, [853 absent], 871, 889 at a 17.8 px
             pitch, and the matching row absent too; crossing pixel BLUE
    crosses  crossing pixel GREY - the cross at the origin overpainted the axes

i.e. skip for LINES and DOTS, no skip for SMALL_CROSS, and the dots answer rules
out the Cairo backend.
"""
import collections
import json
import os
import re
import subprocess
import sys
import tempfile
import time

STYLE = {'dots': 0, 'lines': 1, 'crosses': 2}
GRID_RGB = (132, 132, 132)
AXES_RGB = (0, 0, 132)


def launch_env(style):
    """A throwaway HOME with just enough gerbview.json to pin the grid style."""
    home = tempfile.mkdtemp(prefix=f'kicad-gridaxis-{style}-')
    cfg = os.path.join(home, '.config')
    d = os.path.join(cfg, 'kicad', '10.0')
    os.makedirs(d, exist_ok=True)
    json.dump({'meta': {'filename': 'gerbview', 'version': 0},
               'window': {'grid': {'style': STYLE[style],
                                   'line_width': 1.0,
                                   'show': True}}},
              open(os.path.join(d, 'gerbview.json'), 'w'))
    return {'HOME': home,
            'PATH': '/usr/bin:/bin',
            'USER': os.environ.get('USER', ''),
            'DISPLAY': ':0',
            'XDG_RUNTIME_DIR': os.environ.get('XDG_RUNTIME_DIR', ''),
            # Not ~/.Xauthority: on Xwayland it is
            # /run/user/<uid>/.mutter-Xwaylandauth.<random>, per session.
            'XAUTHORITY': os.environ.get('XAUTHORITY', ''),
            'GDK_BACKEND': 'x11',
            'XDG_CONFIG_HOME': cfg}


def capture(style, out_png):
    env = launch_env(style)
    p = subprocess.Popen(['setsid', '/usr/bin/gerbview'], env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    time.sleep(20)
    tree = subprocess.run(['xwininfo', '-root', '-tree'], env=env,
                          capture_output=True, text=True).stdout
    wid = None
    for line in tree.splitlines():
        m = re.search(r'(0x[0-9a-f]+) "Gerber Viewer": \("gerbview"', line)
        if m:
            wid = m.group(1)
    if wid:
        subprocess.run(['import', '-window', wid, out_png], env=env)
    try:
        os.killpg(os.getpgid(p.pid), 15)
        time.sleep(3)
        os.killpg(os.getpgid(p.pid), 9)
    except Exception:
        pass
    return wid is not None and os.path.exists(out_png)


def report(style, png):
    from PIL import Image
    im = Image.open(png).convert('RGB')
    px = im.load()
    w, h = im.size
    cols = collections.Counter()
    rows = collections.Counter()
    for y in range(h):
        for x in range(w):
            if px[x, y] == AXES_RGB:
                cols[x] += 1
                rows[y] += 1
    if not cols or not rows:
        print(f'{style}: no axes found in the capture')
        return
    ax = cols.most_common(1)[0][0]
    ay = rows.most_common(1)[0][0]
    crossing = px[ax, ay]
    verdict = ('BLUE - grid line skipped' if crossing == AXES_RGB
               else 'GREY - grid drawn over the axis')
    print(f'{style}: axes at x={ax} y={ay}; crossing pixel {crossing} ({verdict})')
    # Probe a row that does not pass through the origin, so a missing mark at
    # the axis shows up as a doubled gap in an otherwise even pitch.
    probe_y = ay - 287 if ay > 300 else ay + 287
    marks = [x for x in range(w) if px[x, probe_y] == GRID_RGB]
    near = [m for m in marks if abs(m - ax) < 60]
    print(f'   grid marks on row y={probe_y} within 60 px of the axis: {near}')


if __name__ == '__main__':
    styles = sys.argv[1:] or ['lines', 'dots', 'crosses']
    for s in styles:
        out = f'/tmp/gerbview-grid-{s}.png'
        if capture(s, out):
            report(s, out)
        else:
            print(f'{s}: capture FAILED')
