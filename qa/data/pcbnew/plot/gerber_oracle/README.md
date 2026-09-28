Gerber files written by `kicad-cli pcb export gerbers` (KiCad 10.0.6, the
installed build) from `../gerber_oracle.kicad_pcb`, one directory per option
set:

| dir | options |
|---|---|
| default | `-l F.Cu,In1.Cu,In2.Cu,B.Cu,F.Mask,B.Mask,F.Paste,F.SilkS,B.SilkS,Edge.Cuts,F.Fab,F.CrtYd,Dwgs.User` |
| nox2 | `--no-x2 -l F.Cu,Edge.Cuts` |
| nomacros | `--disable-aperture-macros -l F.Cu,F.Mask` |
| prec5 | `--precision 5 -l F.Cu` |
| auxorigin | `--use-drill-file-origin -l F.Cu` |
| nonetlist | `--no-netlist -l F.Cu` |
| frame | `--include-border-title -l F.SilkS,Edge.Cuts` |

`qa/unittests/pcbnew/plot_gerber_oracle.test.ts` plots the same board through
`GERBER_PLOTTER` and compares byte for byte, except the three lines that name
the program and the time (`TF.GenerationSoftware`, `TF.CreationDate`,
`G04 Created by`). Regenerate with `./regen.sh`; never edit by hand.
