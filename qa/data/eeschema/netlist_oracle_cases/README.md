# Netlist oracle, hand-made cases

Small designs written for one exporter rule each that none of KiCad's own
`qa/data/eeschema/netlists` designs exercises, with what the installed
`kicad-cli` (10.0.6) wrote for them, in every format:

    kicad-cli sch export netlist [--format <f>] -o <name>.kicad-cli[.<f>].net <name>.kicad_sch

- `offwire`: an excluded-from-board resistor wired to a board one. Its pins
  leave the nets (makeListOfNets' `forBoard` test), so the net codes skip.
- `stacked`: an unnamed stacked pin (`[1-3]`), which still gets a
  `pinfunction` per expanded number.
- `multi`: a two-unit part with its units on different sheets: one `(comp …)`
  (findNextSymbol's `m_referencesAlreadyFound`).
- `shared_pins`: a three-unit part whose units each carry pin 8, placed so the
  first unit read leaves its pin 8 unconnected and the second puts it on /VCC
  (eraseDuplicatePins keeps the user-named net; Allegro's device file drops
  the repeated 8s); and a resistor whose value and footprint hold spaces and
  `< % > &` (the per-format space rules and XML escaping).

The `.kicad_pro` and `.kicad_prl` kicad-cli made are left out: each design
runs with the default project.
