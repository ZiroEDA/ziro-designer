# Zone-fill oracles from KiCad 10.0.5 itself

Nothing here was typed by us. Each file is what the installed KiCad 10.0.5
(`kicad-cli`, or the `pcbnew` Python module for the Clipper2 cases) produced
on this machine, so a test against it compares our fill with KiCad's, not
with our own reading of the C++.

| file | what it is |
| --- | --- |
| `hatch40_kicad_cli.kicad_pcb` | a 40 mm square GND zone, hatch pattern (1 mm web, 2 mm gap), filled by `kicad-cli pcb drc --refill-zones --save-board` |
| `ecc83-pp_kicad_cli.kicad_pcb` | KiCad's own `ecc83-pp` demo, refilled the same way; `ecc83-pp.kicad_pro` is its project |
| `clipper2_kicad_cases.json` | 120 boolean / `Inflate` cases run through `SHAPE_POLY_SET` in KiCad's Python API: random polygons, and unions of a hundred overlapping knockouts |
| `clipper2_kicad_cases.py` | the generator of those cases (`python3 clipper2_kicad_cases.py <seed> <count> <out>`) |
| `kicad_cli_refill.py` | the refill script: copies `<stem>.kicad_pcb` beside its project, refills with `kicad-cli`, and removes `~/.config/kicad/10.0/kicad_advanced` first so the fill runs with the stock advanced settings |

The refill is done by `kicad-cli` and not by the Python module on purpose:
`ADVANCED_CFG` only loads under a wxApp, and one of its settings —
`EnableCacheFriendlyFracture` — chooses which of two fracture algorithms
threads a filled polygon's holes onto its outline. The GUI and the CLI run the
cache-friendly one.

A useful property of the CLI: with `DebugZoneFiller=1` in `kicad_advanced`, a
zone put on `F.Cu` and `In1.Cu`…`In19.Cu` gets each inner layer's fill
replaced by one intermediate poly set of the F.Cu fill
(`DUMP_POLYS_TO_COPPER_LAYER` in `zone_filler.cpp`), which is how the
pipeline was matched stage by stage.

- `StickHub_kicad_cli.kicad_pcb` + `StickHub.kicad_pro`: the StickHub demo
  board refilled by `kicad-cli pcb drc --refill-zones --save-board`. Five
  zones on F.Cu/B.Cu with fillet smoothing (radius 0.5 mm), a board outline
  with arcs, arc tracks, and copper below the pour that the bounding-box
  guards must skip.

- `hatchpads_kicad_cli.kicad_pcb`, `hatchfull_kicad_cli.kicad_pcb`,
  `hatchsmall_kicad_cli.kicad_pcb`: the hatch40 zone with a footprint of
  through-hole, oval, rect and roundrect pads (GND, one SIG, one
  `zone_connect 0`, one `zone_connect 2`) and vias, refilled by kicad-cli —
  thermal (hatchpads); 0.3 mm gap / 0.3 mm bridge / 3 mm hatch gap with
  0.5 mm vias at hatch-hole centres (hatchsmall); and that same layout with
  `connect_pads yes` (hatchfull). Built by hand from hatch40; no project file, so KiCad's
  design-rule defaults apply.

- `custompads_kicad_cli.kicad_pcb`: the hatchpads board poured SOLID with
  five custom pads added — a polygon off-centre of its anchor, a rotated
  one with `(clearance convexhull)`, one on another net, a rect with stroked
  lines, and one with `gr_vector` spoke templates — two that cross the
  relief, one lying outside the pad, and one grazing a corner so that one of
  its edge lines misses the pad and the spoke is dropped. Refilled by kicad-cli.
