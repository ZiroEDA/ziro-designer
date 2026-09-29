#!/bin/sh
# Regenerate the kicad-cli exporters oracle (see README.md). Run from this directory.
set -e
for B in ecc83-pp interf_u; do
  SRC=../resave/$B.kicad_pcb
  kicad-cli pcb export pos -o $B.pos --format ascii --side both --units in $SRC
  kicad-cli pcb export pos -o $B-pos.csv --format csv --side both --units in $SRC
  kicad-cli pcb export ipcd356 -o $B.d356 $SRC
done
# GenCAD: --unique-footprints (UseIndividualShapes) only, and ecc83-pp only --
# see the oracle test's own header for why.
kicad-cli pcb export gencad -o ecc83-pp-unique.gencad --unique-footprints ../resave/ecc83-pp.kicad_pcb
rm -f ../resave/*.kicad_prl
