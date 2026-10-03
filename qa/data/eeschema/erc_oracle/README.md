# kicad-cli ERC oracle

`kicad-cli sch erc --format json --severity-all --units mm` over every
`netlist_oracle/*` and `netlist_oracle_graph/*` project, run with the installed KiCad
(see each file's `kicad_version`), `date` dropped and `source` made a base name.
Named `<directory with / as _>.json`. `lib_symbol_issues`, `lib_symbol_mismatch` and
`footprint_link_issues` depend on which libraries the machine has, so they are not
comparable across machines.

Regenerate from `qa/data/eeschema`:

    for pro in netlist_oracle/*/*.kicad_pro netlist_oracle_graph/*/*.kicad_pro; do
      d=$(dirname $pro); b=$(basename $pro .kicad_pro)
      kicad-cli sch erc --format json --severity-all --units mm \
        -o erc_oracle/$(echo $d | tr / _).json $d/$b.kicad_sch
    done

then strip `date` and base-name `source`.

`erc_cases_<name>.json` is the same command over `erc_cases/<name>/`, small schematics written
to reach ERC tests no netlist oracle project does (each project file enables what it needs).
