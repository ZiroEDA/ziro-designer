# wxYES_NO | wxCANCEL button order

`probe.py` builds the exact `wxMessageDialog` DIALOG_DRC::OnDeleteAllClick
raises (python-wx 4.2.1 / wxWidgets 3.2.4 on GTK3) and reads the
GtkMessageDialog's action area back:

    BUTTONS [('Errors, Warnings and Exclusions', -9), ('gtk-cancel', -6), ('Errors and Warnings Only', -8)]
    DEFAULT Errors and Warnings Only

i.e. **[No] [Cancel] [Yes]**, Yes default (wxYES_DEFAULT), measured 2026-09-19.
Run with the snap-shell environment (see memory `launch-gtk-from-the-snap-shell`):

    env -i HOME=$HOME DISPLAY=:0 XAUTHORITY=$XAUTHORITY GDK_BACKEND=x11 PATH=/usr/bin:/bin python3 probe.py
