# The wxDataViewCtrl RC_TREE_MODEL puts the DRC/ERC violations in
# (common/rc_item.cpp:406: one wxDATAVIEW_CELL_INERT text column, the client
# width wide), read back off the GtkTreeView wx builds: does a row longer than
# the column wrap, ellipsize or clip, how tall is a row, and how far is a
# child indented.
import wx
import wx.dataview as dv

LONG = ("Error: Hole clearance violation (board setup constraints hole clearance "
        "0.2000 mm; actual 0.0000 mm)")

app = wx.App(False)
frame = wx.Frame(None, size=(700, 400))
view = dv.DataViewTreeCtrl(frame, style=dv.DV_NO_HEADER)
root = view.AppendContainer(dv.NullDataViewItem, LONG)
view.AppendItem(root, "NPTH pad of J101")
view.AppendItem(root, "Zone [GND] on F.Cu, B.Cu and 3 more, priority 0")
view.ExpandChildren(root)
frame.Show()

def probe():
    col = view.GetColumn(0)
    rend = col.GetRenderer()
    print("ELLIPSIZE", rend.GetEllipsizeMode())          # wx.ELLIPSIZE_* enum
    print("  NONE=%d START=%d MIDDLE=%d END=%d" % (
        wx.ELLIPSIZE_NONE, wx.ELLIPSIZE_START, wx.ELLIPSIZE_MIDDLE, wx.ELLIPSIZE_END))
    r_parent = view.GetItemRect(root)
    kids = [view.GetNthChild(root, i) for i in range(view.GetChildCount(root))]
    print("ROW parent", r_parent.GetHeight(), "x", r_parent.GetX())
    for i, k in enumerate(kids):
        r = view.GetItemRect(k)
        print("ROW child%d" % i, r.GetHeight(), "x", r.GetX(), "y", r.GetY())
    print("FONT", view.GetFont().GetPointSize(), view.GetFont().GetNativeFontInfoUserDesc())
    # The GtkTreeView underneath: its own cell renderer's ellipsize/wrap.
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk, Pango
    def walk(w, d=0):
        if isinstance(w, Gtk.TreeView):
            for c in w.get_columns():
                for cell in c.get_cells():
                    if isinstance(cell, Gtk.CellRendererText):
                        print("GTK ellipsize", cell.get_property("ellipsize"),
                              "wrap-mode", cell.get_property("wrap-mode"),
                              "wrap-width", cell.get_property("wrap-width"),
                              "single-paragraph", cell.get_property("single-paragraph-mode"),
                              "ypad", cell.get_property("ypad"))
            print("GTK row-height-fixed", w.get_fixed_height_mode(),
                  "level-indentation", w.get_level_indentation(),
                  "show-expanders", w.get_show_expanders())
            print("GTK vertical-separator", w.style_get_property("vertical-separator"),
                  "expander-size", w.style_get_property("expander-size"))
        if isinstance(w, Gtk.Container):
            for c in w.get_children():
                walk(c, d + 1)
    for w in Gtk.Window.list_toplevels():
        walk(w)
    wx.CallLater(50, app.ExitMainLoop)
    return False

wx.CallLater(600, probe)
app.MainLoop()
