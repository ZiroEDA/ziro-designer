#!/bin/sh
# Regenerate the kicad-cli oracle (see README.md). Run from this directory.
set -e
B=../gerber_oracle.kicad_pcb
T="-t _builtin_default"
rm -rf svg svgc svgfit pdf pdfmulti ps psc dxf dxfc dxfsingle
mkdir -p svg svgc svgfit pdf pdfmulti ps psc dxf dxfc dxfsingle
kicad-cli pcb export svg --mode-multi --black-and-white $T -o svg -l F.Cu,F.SilkS $B
kicad-cli pcb export svg --mode-multi $T -o svgc -l F.Cu,B.Cu,F.Mask,F.Fab $B
kicad-cli pcb export svg --mode-multi --fit-page-to-board --exclude-drawing-sheet $T -o svgfit -l F.Cu,Edge.Cuts $B
kicad-cli pcb export pdf --mode-separate --black-and-white $T -o pdf -l F.Cu,F.Fab $B
kicad-cli pcb export pdf --mode-multipage --bg-color '#102030' $T -o pdfmulti/gerber_oracle.pdf -l F.Cu,B.Cu,F.SilkS $B
kicad-cli pcb export ps --mode-multi --black-and-white $T -o ps -l F.Cu,B.SilkS $B
kicad-cli pcb export ps --mode-multi $T -o psc -l F.Cu $B
kicad-cli pcb export dxf --mode-multi -o dxf -l F.Cu,Edge.Cuts $B
kicad-cli pcb export dxf --mode-multi --use-contours --ou mm -o dxfc -l F.Cu,F.SilkS $B
kicad-cli pcb export dxf --mode-single -o dxfsingle/gerber_oracle.dxf -l F.Cu,Edge.Cuts,F.SilkS $B
