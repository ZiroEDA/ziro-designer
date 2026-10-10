#!/bin/bash
# hyp_oracle.sh <board.kicad_pcb> <outdir>: real KiCad pcbnew (the installed 10.0.6) writes the
# board's .hyp through File > Export > Hyperlynx... into <outdir>. Neither kicad-cli nor the
# python module can export HyperLynx, so this drives the GUI over AT-SPI (python3-gi Atspi) on
# DISPLAY :0. The save dialog preselects <board>.hyp beside the board, so Save is all it needs.
set -u
HERE=$(dirname "$(readlink -f "$0")"); WORK=${PCBX_WORK:-$HOME/pcb_oracle/work}; mkdir -p "$WORK"
IN=$(readlink -f "$1"); OUT=$2; D=$(mktemp -d -p "$WORK" hyp.XXXX)
cp "$IN" "$D/"; F="$D/$(basename "$IN")"; HYP="${F%.kicad_pcb}.hyp"
E="env -i DISPLAY=:0 GDK_BACKEND=x11 HOME=$HOME PATH=/usr/bin:/bin XDG_RUNTIME_DIR=/run/user/1000 XAUTHORITY=$XAUTHORITY DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS ATSPI_APP=pcbnew"
for p in $(pgrep -x pcbnew); do kill $p; done; sleep 1
(cd "$D" && $E setsid pcbnew "$F" > "$D/pcbnew.log" 2>&1 < /dev/null &)
for i in $(seq 1 60); do sleep 1; xwininfo -root -tree 2>/dev/null | grep -q 'PCB Editor": ("pcbnew"' && break; done
sleep 4
($E timeout 120 python3 "$HERE"/atspi_menu.py 'Hyperlynx...' > /dev/null 2>&1 &)
for i in $(seq 1 20); do sleep 1; xwininfo -root -tree 2>/dev/null | grep -q '"Export Hyperlynx Layout"' && break; done
sleep 1.5
($E timeout 120 python3 "$HERE"/atspi_button.py Save > /dev/null 2>&1 &)
for i in $(seq 1 60); do sleep 1; [ -s "$HYP" ] && break; done
sleep 2
mkdir -p "$OUT"; cp "$HYP" "$OUT"/ 2>/dev/null
[ -s "$HYP" ] || { echo "no .hyp; pcbnew windows:"; xwininfo -root -tree 2>/dev/null | grep '("pcbnew"' | grep -v '200x200\|10x10'; tail -5 "$D/pcbnew.log"; }
for p in $(pgrep -x pcbnew); do kill $p; done
echo "oracle: $(ls "$OUT" | tr '\n' ' ')"
rm -rf "${D:?}"
