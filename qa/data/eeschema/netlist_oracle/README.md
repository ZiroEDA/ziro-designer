# Netlist oracle

Each folder holds a design from KiCad's own `qa/data/eeschema/netlists/` and
the netlist the installed `kicad-cli` wrote for it (`*.kicad-cli.net`):

    kicad-cli sch export netlist --format kicadsexpr -o <name>.kicad-cli.net <name>.kicad_sch

`qa/unittests/designer/netlist_oracle.test.ts` runs our Update-PCB netlist
over the same files and compares the whole text; only `(source …)`,
`(date …)` and `(tool …)` are set aside (they name the machine and the time).
