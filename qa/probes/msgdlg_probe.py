# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
"""Build the GtkMessageDialog that wxMessageDialog builds on GTK, and ask it.

`KICAD_MESSAGE_DIALOG` (include/confirm.h:50) is wxMessageDialog, and
`wxMessageDialog::GTKCreateMsgDialog` (wx 3.2 src/gtk/msgdlg.cpp) is nothing
but `gtk_message_dialog_new( parent, GTK_DIALOG_MODAL, type, buttons, message )`,
`gtk_message_dialog_format_secondary_text` when there is an extended message,
`gtk_window_set_title`, and `gtk_dialog_add_button` for custom labels. wx adds
no image and no sizer of its own, so the whole dialog — the CSD title strip,
the 48 px symbolic icon, the 60-character label wrap, the full-width button
row — is GTK's, and this asks GTK for it directly. The same dialog built here
and the one a running eeschema raises for `DisplayInfoMessage` differ by 83
anti-aliasing pixels out of 661x179.

Run under X11 the way KiCad runs here (the desktop is Wayland; KiCad and the
browser both take Xwayland):

    env -i DISPLAY=:0 GDK_BACKEND=x11 HOME=$HOME PATH=/usr/bin:/bin \
        XDG_RUNTIME_DIR=/run/user/1000 XAUTHORITY=$XAUTHORITY \
        DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS \
        python3 qa/probes/msgdlg_probe.py [--ext] [--three] [out.png]

`env -i` because a shell opened from the VS Code snap carries the snap's
GTK_PATH / LD paths, under which python3 (and eeschema) fail to start.

    (no flag)   DisplayInfoMessage's box: wxOK | wxICON_INFORMATION, one
                message, no secondary text.
    --ext       the same with a secondary text — the primary label's attribute
                list is what changes (bold, scale 1.2).
    --three     UnsavedChangesDialog: wxYES_NO | wxCANCEL with SetYesNoLabels
                and an extended message; three buttons in one homogeneous row.

Prints every widget's class, allocation, margins, padding, border, font and
colours (allocations are WINDOW coordinates; the CSD shadow margin is 10 px on
every side, so subtract 10 for client coordinates), the primary label's Pango
attributes, and saves a screenshot of the window to `out.png`.
"""
import sys
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk  # noqa: E402

# files-io.cpp:451-458, the box that started this probe.
MSG = (
    "An error was found when loading the schematic that has been automatically fixed.  "
    "Please save the schematic to repair the broken file or it may not be usable with "
    "other versions of KiCad."
)

parent = Gtk.Window(title="parent")
parent.set_default_size(1200, 800)
parent.show_all()

if "--three" in sys.argv:
    dlg = Gtk.MessageDialog(
        transient_for=parent,
        modal=True,
        message_type=Gtk.MessageType.WARNING,
        buttons=Gtk.ButtonsType.NONE,
        text="Symbol to Footprint links have been modified. Save changes?",
    )
    # wx adds custom-labelled buttons itself, No / Cancel / Yes in that order.
    dlg.add_button("Discard Changes", Gtk.ResponseType.NO)
    dlg.add_button("_Cancel", Gtk.ResponseType.CANCEL)
    dlg.add_button("_Save", Gtk.ResponseType.YES)
    dlg.set_default_response(Gtk.ResponseType.YES)
    dlg.format_secondary_text("If you don't save, all your changes will be permanently lost.")
    dlg.set_title("Save Changes?")
else:
    dlg = Gtk.MessageDialog(
        transient_for=parent,
        modal=True,
        message_type=Gtk.MessageType.INFO,
        buttons=Gtk.ButtonsType.OK,
        text=MSG,
    )
    if "--ext" in sys.argv:
        dlg.format_secondary_text("Extended text here")
    dlg.set_title("Information")

dlg.show()
for _ in range(200):
    while Gtk.events_pending():
        Gtk.main_iteration()
    time.sleep(0.01)


def css(w, prop):
    return w.get_style_context().get_property(prop, Gtk.StateFlags.NORMAL)


def walk(w, d=0):
    a = w.get_allocation()
    sc = w.get_style_context()
    font = css(w, "font")
    fg = css(w, "color")
    extra = ""
    if isinstance(w, Gtk.Label):
        attrs = w.get_attributes()
        extra = (
            f" text={w.get_text()[:30]!r} attrs={attrs.to_string() if attrs else None}"
            f" wrap={w.get_line_wrap()} max-width-chars={w.get_max_width_chars()}"
            f" justify={w.get_justify().value_nick} xalign={w.get_xalign()}"
        )
    if isinstance(w, Gtk.Button):
        extra = f" label={w.get_label()!r} focus={w.has_focus()} visible-focus={w.has_visible_focus()}"
    margin = (w.get_margin_start(), w.get_margin_top(), w.get_margin_end(), w.get_margin_bottom())
    pad = sc.get_padding(Gtk.StateFlags.NORMAL)
    bd = sc.get_border(Gtk.StateFlags.NORMAL)
    print(
        "  " * d
        + f"{type(w).__name__} classes={list(sc.list_classes())} alloc=({a.x},{a.y} {a.width}x{a.height})"
        f" margin={margin} pad=({pad.left},{pad.top},{pad.right},{pad.bottom})"
        f" border=({bd.left},{bd.top},{bd.right},{bd.bottom}) font={font.to_string()} fg={fg.to_string()}{extra}"
    )
    if isinstance(w, Gtk.Container):
        for c in w.get_children():
            walk(c, d + 1)


print("window size", tuple(dlg.get_size()))
walk(dlg)
print("--- titlebar")
walk(dlg.get_titlebar(), 1)

# The primary label's Pango attributes, one per line: `to_string()` above
# prints the weight but not the scale.
primary = dlg.get_message_area().get_children()[0]
attrs = primary.get_attributes()
if attrs:
    print("--- primary label attributes")

    def show(attr, _data):
        value = None
        for m in ("as_int", "as_float", "as_string"):
            try:
                r = getattr(attr, m)()
                if r is not None:
                    value = r.value
                    break
            except Exception:
                pass
        print(f"  {attr.klass.type.value_nick} = {value}")
        return False

    attrs.filter(show, None)

out = sys.argv[-1] if sys.argv[-1].endswith(".png") else None
if out:
    gw = dlg.get_window()
    pb = Gdk.pixbuf_get_from_window(gw, 0, 0, gw.get_width(), gw.get_height())
    pb.savev(out, "png", [], [])
    print("saved", out, gw.get_width(), gw.get_height())
