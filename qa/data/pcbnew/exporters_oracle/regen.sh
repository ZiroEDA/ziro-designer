#!/bin/sh
# Regenerate the kicad-cli exporters oracle (see README.md). Run from this directory.
set -e
for B in ecc83-pp interf_u; do
  SRC=../resave/$B.kicad_pcb
  kicad-cli pcb export pos -o $B.pos --format ascii --side both --units in $SRC
  kicad-cli pcb export pos -o $B-pos.csv --format csv --side both --units in $SRC
  kicad-cli pcb export ipcd356 -o $B.d356 $SRC
done
rm -f ../resave/*.kicad_prl
