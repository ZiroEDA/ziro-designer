#!/bin/bash
# oracle.sh <input-file> <outdir>: real KiCad eeschema (the installed 10.0.6) imports <input>
# through File > Import > Non-KiCad Schematic... and saves; the .kicad_sch it writes lands in
# <outdir>. kicad-cli cannot load a foreign schematic, so this drives the GUI over AT-SPI
# (python3-gi Atspi) and needs the desktop session on DISPLAY :0. Scratch goes in $SCHIO_WORK.
set -u
HERE=$(dirname "$(readlink -f "$0")"); WORK=${SCHIO_WORK:-$HOME/schio_oracle}; mkdir -p "$WORK"
IN=$(readlink -f "$1"); OUT=$2; D=$(mktemp -d -p "$WORK" work.XXXX)
cp "$IN" "$D/"; F="$D/$(basename "$IN")"
E="env -i DISPLAY=:0 GDK_BACKEND=x11 HOME=$HOME PATH=/usr/bin:/bin XDG_RUNTIME_DIR=/run/user/1000 XAUTHORITY=$XAUTHORITY DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
for p in $(pgrep -x eeschema); do kill $p; done; sleep 1
(cd "$D" && $E setsid eeschema > "$D/eeschema.log" 2>&1 < /dev/null &)
for i in $(seq 1 40); do sleep 1; xwininfo -root -tree 2>/dev/null | grep -q 'Schematic Editor": ("eeschema"' && break; done
sleep 3
($E timeout 120 python3 "$HERE"/atspi_menu.py 'Non-KiCad Schematic...' > /dev/null 2>&1 &)
for i in $(seq 1 20); do sleep 1; xwininfo -root -tree 2>/dev/null | grep -q '"Import Schematic"' && break; done
sleep 1.5
$E timeout 20 python3 "$HERE"/atspi_type.py "$F" > /dev/null 2>&1
sleep 1.5
($E timeout 300 python3 "$HERE"/atspi_button.py Open > /dev/null 2>&1 &)
# A file holding several PCB+Schematic combinations (EasyEDA Pro) asks which one:
# DIALOG_IMPORT_CHOOSE_PROJECT preselects row 0, so OK imports the first.
for i in $(seq 1 15); do sleep 1; xwininfo -root -tree 2>/dev/null | grep -q '"Choose Project to Import"' && { ($E timeout 600 python3 "$HERE"/atspi_button.py OK > /dev/null 2>&1 &); break; }; done
# Wait for the import: the title loses "untitled".
for i in $(seq 1 300); do sleep 1; xwininfo -root -tree 2>/dev/null | grep 'Schematic Editor": ("eeschema"' | grep -qv untitled && break; done
sleep 3
xwininfo -root -tree 2>/dev/null | grep '"' | grep '("eeschema" "' | grep -v 'Schematic Editor":\|200x200\|10x10' > "$D/dialogs.txt"
$E timeout 60 python3 "$HERE"/atspi_menu.py Save > /dev/null 2>&1 &
for i in $(seq 1 60); do sleep 1; ls "$D"/*.kicad_sch > /dev/null 2>&1 && break; done
sleep 2
mkdir -p "$OUT"; cp "$D"/*.kicad_sch "$D"/*.kicad_pro "$D"/*.kicad_sym "$D"/sym-lib-table "$OUT"/ 2>/dev/null; cp "$D/dialogs.txt" "$OUT"/
for p in $(pgrep -x eeschema); do kill $p; done
echo "oracle: $(ls "$OUT" | tr '\n' ' ')"; [ -s "$D/dialogs.txt" ] && { echo "dialogs left open:"; cat "$D/dialogs.txt"; }
rm -rf "$D"
