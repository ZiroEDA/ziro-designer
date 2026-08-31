# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
#
# What GTK gives a wxSpinCtrl, asked of GTK itself rather than read off a
# screenshot: a wxSpinCtrl IS a GtkSpinButton, so its natural size and the width
# its two stepper buttons take are the theme's own answer on this machine.
#
# The entry alone is the same widget without the buttons, so the difference
# between the two naturals is the pair -- once the entry is wide enough to clear
# the theme's minimum width, which is why the sweep goes to 10 characters and
# the answer is read off the settled rows, not the first one.
#
#   env -i HOME=$HOME DISPLAY=$DISPLAY PATH=/usr/bin:/bin XAUTHORITY=$XAUTHORITY \
#       /usr/bin/python3 spin_ctrl_probe.py
#
# (the bare env is because a snap in the ambient LD_LIBRARY_PATH breaks libc
# symbol lookup for a system python here.)
#
# Reads, 2026-08-31, Yaru / Ubuntu Sans 11:
#
#   chars= 1  spin 116x34   entry  26x34   spin-entry=90
#   chars= 5  spin 128x34   entry  58x34   spin-entry=70
#   chars=10  spin 168x34   entry  98x34   spin-entry=70
#
# so: control height 34, and 35 px per stepper button.
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk

def natural(chars=None, entry=False):
    w = Gtk.OffscreenWindow()
    adj = Gtk.Adjustment(value=96, lower=10, upper=1000, step_increment=1)
    ctl = Gtk.Entry() if entry else Gtk.SpinButton(adjustment=adj, climb_rate=1, digits=0)
    if chars is not None:
        ctl.set_width_chars(chars)
    w.add(ctl); w.show_all()
    while Gtk.events_pending(): Gtk.main_iteration()
    s = ctl.get_preferred_size()[1]
    return s.width, s.height

for c in (1, 2, 3, 5, 10):
    sw, sh = natural(c)
    ew, eh = natural(c, entry=True)
    print(f'chars={c:2d}  spin {sw}x{sh}   entry {ew}x{eh}   spin-entry={sw-ew}')
