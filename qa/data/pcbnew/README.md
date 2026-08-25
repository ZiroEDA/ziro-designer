# KiCad's own board corpora

Copied unedited from KiCad 10.0.5's `qa/data/pcbnew/`
(`/home/akshay/kicad-reference`, the pinned reference tree). They are here
because a fixture we typed ourselves proves only that our reader agrees with
our writer; these are bytes KiCad actually produced, in dialects it still has
to read.

| file | version | what it pins |
| --- | --- | --- |
| `issue10906.kicad_pcb` | `20220211` | two `fp_text` items whose `hide` is a **bare positional token**, the pre-v7 spelling `parseMaybeAbsentBool` exists for |
| `connection_width_rules.kicad_pcb` | `20220621` | six `(font (size …) (thickness …) bold)` — `bold` as a bare token inside `(font …)` |
