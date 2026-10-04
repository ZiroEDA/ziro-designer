#!/bin/sh
# Regenerate the kicad-cli drill oracle (see README.md). Run from this directory.
set -e
B=../gerber_oracle.kicad_pcb
rm -rf default separate inch_lz keep mirror_route plotorigin map
mkdir -p default separate inch_lz keep mirror_route plotorigin map
kicad-cli pcb export drill -o default/ --generate-report --report-path default/gerber_oracle-drl.rpt $B
kicad-cli pcb export drill -o separate/ --excellon-separate-th $B
kicad-cli pcb export drill -o inch_lz/ -u in --excellon-zeros-format suppressleading $B
kicad-cli pcb export drill -o keep/ --excellon-zeros-format keep $B
kicad-cli pcb export drill -o mirror_route/ --excellon-mirror-y --excellon-min-header --excellon-oval-format route $B
kicad-cli pcb export drill -o plotorigin/ --drill-origin plot --excellon-zeros-format suppresstrailing $B
kicad-cli pcb export drill -o map/ --generate-map --map-format gerberx2 --excellon-separate-th $B
rm -f ../*.kicad_prl
# Gerber X2 drill files (GERBER_WRITER); the _ipc4761 board's vias carry tenting,
# covering, plugging, capping and filling.
I=../gerber_oracle_ipc4761.kicad_pcb
rm -rf gerber gerber_p5_plot gerber_ipc gerber_tenting
mkdir -p gerber gerber_p5_plot gerber_ipc gerber_tenting
kicad-cli pcb export drill --format gerber -o gerber/ $B
kicad-cli pcb export drill --format gerber --gerber-precision 5 --drill-origin plot -o gerber_p5_plot/ $B
kicad-cli pcb export drill --format gerber -o gerber_ipc/ $I
kicad-cli pcb export drill --format gerber --generate-tenting -o gerber_tenting/ $I
rm -f ../*.kicad_prl
