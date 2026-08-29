# Driving a real pl_editor

`qa/probes/` mostly builds a widget and asks it for a number. This one is
different: it drives the **whole installed `pl_editor`** and records what the
program does, which is the E4 evidence `docs/editor-status.md` asks for. The
strings and behaviour it captured are quoted in
`qa/unittests/designer/ds_file_commands.test.ts`.

## Running

    # a private profile, so the user's own KiCad session is untouched
    mkdir -p ~/pl_audit_home/.config
    cp -r ~/.config/kicad ~/pl_audit_home/.config/kicad

    nohup env -i HOME=$HOME/pl_audit_home USER=$USER PATH=/usr/bin:/bin \
        DISPLAY=:0 XAUTHORITY=$XAUTHORITY XDG_RUNTIME_DIR=/run/user/$(id -u) \
        DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
        GDK_BACKEND=x11 LANG=en_US.UTF-8 /usr/bin/pl_editor &

    export PL_PID=<the pl_editor pid>   # NOT the wrapper's
    python3 step.py menu File "Open..."
    python3 step.py chooser "Open Drawing Sheet" /path/to/sheet.kicad_wks
    python3 step.py status /tmp/status.png     # the pane-0 message, as a picture
    python3 step.py title

Close it by **pid**. Never `xkill`: it once took out this desktop's
`mutter-x11-frames` (see the memory `xkill-hits-the-frame-process`).

## The four things that cost time

**Two `pl_editor`s can be registered at once** — the user's own and yours. Every
lookup here is by **pid**, never by application name.

**AT-SPI goes stale after a native modal.** Once a GTK file chooser or the GTK
print dialog has been up, the client's cached tree starts answering
`get_child_count() == -1` and the application can drop off the desktop's child
list entirely. That is why `step.py` does **one interaction per process**; a
long-lived driver script gets four steps in and then reads nothing.

**XTEST Shift does not reach these clients** on this Xwayland session: `Shift`
+`minus` types `-`, so `probe.kicad_wks` arrives as `probe.kicad-wks` and the
chooser reports "No such file or directory" for a path that exists.
`xdo.type_remapped` binds each character's keysym to a spare keycode instead,
which is what xdotool does and which needs no modifier at all.

**A window must be activated before it can be typed into.** `xdo.activate`
sends `_NET_ACTIVE_WINDOW`; without it the keystrokes go to whatever the user
last clicked, which on this box is the editor running this audit.

## What it settled

Every status-line string pl_editor writes, read off the running program rather
than the source (`SetStatusText` is pane 0, and it is written **only** by the
five file commands):

| command | pane 0 afterwards |
|---|---|
| Open | `File '<full path>' saved.` — yes, "saved" after an Open |
| Append | `File '<full path>' inserted` |
| Save, Save As | `File '<full path>' saved.` |
| Open Recent | `File '<full path>' loaded` |
| New | *unchanged* - New writes nothing |
| a load that fails | *unchanged* - the message goes to a modal |

Save As opens on `~/.local/share/kicad/10.0/template`
(`PATHS::GetUserTemplatesPath()`) with an **empty** name field, titled
`Save Drawing Sheet As`; Open is titled `Open Drawing Sheet` and has no default
directory at all. A bad file raises **two** modals in a row, `Error loading
drawing sheet '<path>'.` with the parser message as extended text, then
`Unable to load <path> file`. An out-of-date file format raises the infobar
`This file was created by an older version of KiCad. It will be converted to the
new format when saved.` Preferences shows four Drawing Sheet Editor pages -
Display Options, Grids, Colors, Toolbars - and no "black background" control
anywhere.
