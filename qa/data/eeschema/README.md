# KiCad's own schematic corpora

Copied unedited from KiCad 10.0.5's `qa/data/eeschema/`
(`/home/akshay/kicad-reference`, the pinned reference tree).

| file | what it pins |
| --- | --- |
| `NoConnectOnLineWithLabel.kicad_sch` | `(effects (font (size 1.27 1.27)) hide)` — `hide` as a bare token inside `(effects …)`, `SCH_IO_KICAD_SEXPR_PARSER::parseEDA_TEXT`'s `parseMaybeAbsentBool( true )` site |
