Drill files written by `kicad-cli pcb export drill` (KiCad 10.0.6) from
`../gerber_oracle.kicad_pcb`, one directory per option set; `regen.sh` holds
the commands. `qa/unittests/pcbnew/drill_oracle.test.ts` drives EXCELLON_WRITER
as `PCBNEW_JOBS_HANDLER::JobExportDrill` does and compares every file byte for
byte, except the lines that name the program and the clock. Regenerate with
`./regen.sh`; never edit by hand.
