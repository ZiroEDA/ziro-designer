# pcbnew/exporters/ oracle

Each `<board>.pos` / `<board>-pos.csv` / `<board>.d356` is what the installed
`kicad-cli` (10.0.6) wrote for `../resave/<board>.kicad_pcb`:

    kicad-cli pcb export pos -o <board>.pos --format ascii --side both --units in <board>.kicad_pcb
    kicad-cli pcb export pos -o <board>-pos.csv --format csv --side both --units in <board>.kicad_pcb
    kicad-cli pcb export ipcd356 -o <board>.d356 <board>.kicad_pcb

`ecc83-pp` (15 footprints, 4 excluded from position files) and `interf_u` (25
footprints) are both already in `../resave/`, from KiCad's own QA corpus.

`qa/unittests/pcbnew/place_file_exporter_oracle.test.ts` and
`export_d356_oracle.test.ts` run our exporters over the same boards and
compare the whole file. The `.pos` (ASCII) file's "created on"/date line and
"Printed by \<version\>" line are masked — everything else, and the whole of
the CSV and D356 files, matches byte for byte, unmasked: neither format has
a machine- or time-identifying line of its own.

Regenerate with `./regen.sh` from this directory.
