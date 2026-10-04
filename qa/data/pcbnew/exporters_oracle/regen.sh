#!/bin/sh
# Regenerate the kicad-cli exporters oracle (see README.md). Run from this directory.
set -e
for B in ecc83-pp interf_u; do
  SRC=../resave/$B.kicad_pcb
  kicad-cli pcb export pos -o $B.pos --format ascii --side both --units in $SRC
  kicad-cli pcb export pos -o $B-pos.csv --format csv --side both --units in $SRC
  kicad-cli pcb export ipcd356 -o $B.d356 $SRC
done
# GenCAD: shared shapes (the default) and --unique-footprints (UseIndividualShapes).
for B in ecc83-pp interf_u; do
  kicad-cli pcb export gencad -o $B-shared.gencad ../resave/$B.kicad_pcb
  kicad-cli pcb export gencad -o $B-unique.gencad --unique-footprints ../resave/$B.kicad_pcb
done
rm -f ../resave/*.kicad_prl
# Gerber X3 placement files (PLACEFILE_GERBER_WRITER). gerber_oracle_pnp is
# ../plot/gerber_oracle.kicad_pcb with J1 flipped to the back at 30 deg and U1
# at 90 deg and SMD, saved by KiCad's own python; _fpedge adds an Edge.Cuts
# line inside U1 (a footprint edge).
rm -rf pnp && mkdir -p pnp
for B in ecc83-pp interf_u; do
  SRC=../resave/$B.kicad_pcb
  for S in front back; do kicad-cli pcb export pos --format gerber --side $S -o pnp/$B-pnp_$S.gbr $SRC; done
  kicad-cli pcb export pos --format gerber --side front --gerber-board-edge -o pnp/$B-edge-pnp_front.gbr $SRC
done
P=../plot/gerber_oracle_pnp.kicad_pcb
for S in front back; do kicad-cli pcb export pos --format gerber --side $S -o pnp/gerber_oracle_pnp-pnp_$S.gbr $P; done
kicad-cli pcb export pos --format gerber --side back --gerber-board-edge -o pnp/gerber_oracle_pnp-edge-pnp_back.gbr $P
rm -f ../resave/*.kicad_prl ../plot/*.kicad_prl
kicad-cli pcb export pos --format gerber --side front --gerber-board-edge -o pnp/gerber_oracle_pnp_fpedge-edge-pnp_front.gbr ../plot/gerber_oracle_pnp_fpedge.kicad_pcb
