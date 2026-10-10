#!/bin/sh
# Regenerate the IPC-2581 oracle: kicad-cli's own export of each resave/ board. Run from here.
set -e
for B in ecc83-pp interf_u blindvias_kicad_cli custompads_kicad_cli hatchpads_kicad_cli StickHub_kicad_cli; do
  kicad-cli pcb export ipc2581 -o $B.xml ../resave/$B.kicad_pcb
done
# ecc83-pp_flipped: U1 and C1 on the back, U1's pads at 45 deg to the footprint, saved by KiCad's
# own python from ecc83-pp (back-side packages, pin Xforms and flipped pad layers).
python3 - <<'PY'
import pcbnew
b = pcbnew.LoadBoard('../resave/ecc83-pp.kicad_pcb')
for f in b.GetFootprints():
    if f.GetReference() == 'U1':
        for p in f.Pads():
            p.SetFPRelativeOrientation(pcbnew.EDA_ANGLE(45, pcbnew.DEGREES_T))
    if f.GetReference() in ('U1', 'C1'):
        f.Flip(f.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
pcbnew.SaveBoard('../resave/ecc83-pp_flipped.kicad_pcb', b)
PY
rm -f ../resave/ecc83-pp_flipped.kicad_pro
kicad-cli pcb export ipc2581 -o ecc83-pp_flipped.xml ../resave/ecc83-pp_flipped.kicad_pcb
# Revision B, inches, 4 decimals.
kicad-cli pcb export ipc2581 --version B --units in --precision 4 -o ecc83-pp-B-inch.xml ../resave/ecc83-pp.kicad_pcb
rm -f ../resave/*.kicad_prl
