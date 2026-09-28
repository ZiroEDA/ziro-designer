SVG, PDF, Postscript and DXF plots written by `kicad-cli pcb export
svg|pdf|ps|dxf` (KiCad 10.0.6, the installed build) from
`../gerber_oracle.kicad_pcb`, one directory per command line in `regen.sh`
(all with `-t _builtin_default`, the COLOR_SETTINGS default):

| dir | options |
|---|---|
| svg | `svg --mode-multi --black-and-white -l F.Cu,F.SilkS` (drawing sheet on) |
| svgc | `svg --mode-multi -l F.Cu,B.Cu,F.Mask,F.Fab` |
| svgfit | `svg --mode-multi --fit-page-to-board --exclude-drawing-sheet -l F.Cu,Edge.Cuts` |
| pdf | `pdf --mode-separate --black-and-white -l F.Cu,F.Fab` |
| pdfmulti | `pdf --mode-multipage --bg-color '#102030' -l F.Cu,B.Cu,F.SilkS` |
| ps | `ps --mode-multi --black-and-white -l F.Cu,B.SilkS` |
| psc | `ps --mode-multi -l F.Cu` |
| dxf | `dxf --mode-multi -l F.Cu,Edge.Cuts` |
| dxfc | `dxf --mode-multi --use-contours --ou mm -l F.Cu,F.SilkS` |
| dxfsingle | `dxf --mode-single -l F.Cu,Edge.Cuts,F.SilkS` |

`qa/unittests/pcbnew/plot_formats_oracle.test.ts` plots the same board through
`PCB_PLOTTER::Plot` with the options `PlotJobToPlotOpts` builds from each line
and compares line for line (PDFs object for object, streams inflated), except
the lines that name the program and the time, and the drawing sheet's
`${KICAD_VERSION}` text. Regenerate with `./regen.sh`; never edit by hand.
