# The violation list's wxDataViewCtrl

`RC_TREE_MODEL::Update` (common/rc_item.cpp:400-406) puts the DRC and ERC
violations in **one** `wxDATAVIEW_CELL_INERT` text column as wide as the view's
client area. `probe.py` builds that control (python-wx 4.2.1 / wxWidgets 3.2.4
on GTK3) with a violation row too long for it, and reads back what the renderer
and the GtkTreeView underneath actually do:

    ELLIPSIZE 0                       # wxELLIPSIZE_NONE
    ROW parent 22 x 0
    ROW child0 22 x 0 y 25
    ROW child1 22 x 0 y 49
    FONT 11 Ubuntu Sans 11
    GTK ellipsize PANGO_ELLIPSIZE_NONE  wrap-mode PANGO_WRAP_CHAR
        wrap-width -1  single-paragraph False  ypad 2
    GTK vertical-separator 2  expander-size 16

i.e. a row is **one line, clipped** - not wrapped, and not ellipsized - and the
cell is **22 px** with the rows pitched **24 px** apart (22 + the 2 px
vertical-separator). Measured 2026-09-19.

`probe2.py` reads `wxSYS_COLOUR_LISTBOXTEXT`, whose brightness decides which
way `RC_TREE_MODEL::GetAttr` (rc_item.cpp:555-596) moves an excluded row:

    LISTBOXTEXT #ffffff
    BRIGHTNESS 1.0030
    EXCLUDED heading  ialpha=50 -> #7f7f7f
    EXCLUDED child    ialpha=60 -> #999999

Run both with the snap-shell environment (see memory
`launch-gtk-from-the-snap-shell`):

    env -i HOME=$HOME DISPLAY=:0 XAUTHORITY=$XAUTHORITY GDK_BACKEND=x11 \
        PATH=/usr/bin:/bin python3 probe.py
