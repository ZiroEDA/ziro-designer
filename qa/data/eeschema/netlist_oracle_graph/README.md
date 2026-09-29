# Netlist oracle, connection-graph designs

The rest of KiCad's `qa/data/eeschema/netlists/` designs — the ones
`../netlist_oracle/` does not already hold — plus the designs KiCad's own
connectivity regression tests load (`qa/data/eeschema/issue*`, `test1243`;
a folder is named after its root file, so `issue23840` is `BusAndVectors` and
`issue17771` is `issue1771`), with the netlist the installed `kicad-cli`
(10.0.6) wrote for each:

    kicad-cli sch export netlist --format kicadsexpr -o <name>.kicad-cli.net <name>.kicad_sch

`qa/unittests/eeschema/connection_graph_oracle.test.ts` runs the live
`CONNECTION_GRAPH` over both folders and compares the `(nets …)` section line
for line. These are kept apart from `../netlist_oracle/` because
`designer/netlist_oracle.test.ts` compares the WHOLE netlist of every design in
that folder, and the record-model exporter does not match all of these.

`issue18299` is left out: it has no symbols, so its nets section is empty and
would pin nothing.
