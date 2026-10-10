#!/bin/sh
# Regenerate the IPC-2581 oracle: kicad-cli's own export of each resave/ board. Run from here.
set -e
for B in ecc83-pp interf_u blindvias_kicad_cli custompads_kicad_cli hatchpads_kicad_cli StickHub_kicad_cli; do
  kicad-cli pcb export ipc2581 -o $B.xml ../resave/$B.kicad_pcb
done
# Revision B, inches, 4 decimals.
kicad-cli pcb export ipc2581 --version B --units in --precision 4 -o ecc83-pp-B-inch.xml ../resave/ecc83-pp.kicad_pcb
rm -f ../resave/*.kicad_prl
