#!/bin/sh
# Regenerate the kicad-cli oracle (see README.md). Run from this directory.
set -e
B=../gerber_oracle.kicad_pcb
rm -rf default nox2 nomacros prec5 auxorigin nonetlist frame
mkdir -p default nox2 nomacros prec5 auxorigin nonetlist frame
kicad-cli pcb export gerbers -o default -l F.Cu,In1.Cu,In2.Cu,B.Cu,F.Mask,B.Mask,F.Paste,F.SilkS,B.SilkS,Edge.Cuts,F.Fab,F.CrtYd,Dwgs.User $B
kicad-cli pcb export gerbers --no-x2 -o nox2 -l F.Cu,Edge.Cuts $B
kicad-cli pcb export gerbers --disable-aperture-macros -o nomacros -l F.Cu,F.Mask $B
kicad-cli pcb export gerbers --precision 5 -o prec5 -l F.Cu $B
kicad-cli pcb export gerbers --use-drill-file-origin -o auxorigin -l F.Cu $B
kicad-cli pcb export gerbers --no-netlist -o nonetlist -l F.Cu $B
kicad-cli pcb export gerbers --include-border-title -o frame -l F.SilkS,Edge.Cuts $B
rm -f */*.gbrjob
