#!/usr/bin/env python3
"""What `wxCURSOR_BULLSEYE` draws on this desktop, asked of GDK.

`KICURSOR::BULLSEYE` is the one cursor KiCad's tools ask for that is not in
`cursors_defs`: `CURSOR_STORE::GetStockCursor` (`common/gal/cursors.cpp:437-463`)
answers it with `wxCURSOR_BULLSEYE`, GTK's `IsStockCursorOk` keeps it
(`libs/kiplatform/port/wxgtk/ui.cpp:185-196`), and wxGTK builds it as
`gdk_cursor_new_for_display( display, GDK_TARGET )`. So there is no XPM to
vendor, and nothing to derive: the picture is whatever this X server hands
back for GDK_TARGET, which is the same call, on the same display, that the
installed KiCad makes. This script makes that call and saves the answer.

    python3 qa/probes/stock_cursor_probe.py            # prints size, hotspot, ASCII
    python3 qa/probes/stock_cursor_probe.py out.png    # and writes the PNG

`designer/src/assets/cursors/stock-target.png` is that output, verbatim,
and `ui/kicursors.ts` states its hotspot. Re-run rather than redraw it.

Measured 2026-09-11, Adwaita 24: 24x24, hotspot (11, 11). Adwaita has no
`target` file (`/usr/share/icons/Adwaita/cursors/` has crosshair and its
aliases only), so Xcursor falls through to the core cursor font's `target`
glyph -- the square with four inward ticks -- which is what KiCad shows here.
Yaru ships its own `target`; a desktop on it sees Yaru's.
"""

import sys

import gi

gi.require_version("Gdk", "3.0")
from gi.repository import Gdk  # noqa: E402

display = Gdk.Display.get_default()
cursor = Gdk.Cursor.new_for_display(display, Gdk.CursorType.TARGET)
image = cursor.get_image()
if image is None:
    sys.exit("GDK returned no image for GDK_TARGET")

w, h = image.get_width(), image.get_height()
print(f"display {display.get_name()}  {w}x{h}  hotspot ({image.get_option('x_hot')}, {image.get_option('y_hot')})")

pixels, stride, n = image.get_pixels(), image.get_rowstride(), image.get_n_channels()
for y in range(h):
    row = ""
    for x in range(w):
        r, g, b, a = pixels[y * stride + x * n : y * stride + x * n + 4]
        row += "." if a < 128 else ("#" if r + g + b < 300 else "o")
    print(row)

if len(sys.argv) > 1:
    image.savev(sys.argv[1], "png", [], [])
    print("wrote", sys.argv[1])
