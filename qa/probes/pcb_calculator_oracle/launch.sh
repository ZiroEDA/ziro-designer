#!/bin/bash
# Launch KiCad pcb_calculator with the VSCode-snap environment scrubbed off.
unset GTK_PATH GTK_EXE_PREFIX GTK_IM_MODULE_FILE GIO_MODULE_DIR LOCPATH \
      XDG_DATA_HOME GSETTINGS_SCHEMA_DIR LD_LIBRARY_PATH LD_PRELOAD
export XDG_DATA_DIRS=/usr/share/ubuntu:/usr/share/gnome:/usr/local/share/:/usr/share/:/var/lib/snapd/desktop
export GTK_MODULES=gail:atk-bridge
export GDK_BACKEND=x11
export DISPLAY=:0
export NO_AT_BRIDGE=0
exec /usr/bin/pcb_calculator "$@"
