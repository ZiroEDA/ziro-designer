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
