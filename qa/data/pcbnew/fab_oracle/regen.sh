#!/bin/bash
# regen.sh: what kicad-cli 10.0.6 writes to manufacture the boards in qa/data/pcbnew/resave -
# Gerbers (every copper layer, both masks, pastes and silks, Edge.Cuts) and the Excellon drill
# files, with kicad-cli's defaults - one folder per board, each file gzipped.
set -eu
HERE=$(dirname "$(readlink -f "$0")"); B=$HERE/../resave; T=$(mktemp -d)
for b in ecc83-pp interf_u blindvias_kicad_cli custompads_kicad_cli hatchpads_kicad_cli StickHub_kicad_cli ecc83-pp_flipped; do
  L=$(python3 -c "
import re
t=open('$B/$b.kicad_pcb').read()
cu=[n for n in re.findall(r'\(\d+ \"([^\"]+)\" (?:signal|power|mixed|jumper)', t) if n.endswith('.Cu')]
print(','.join(cu+['F.Mask','B.Mask','F.Paste','B.Paste','F.SilkS','B.SilkS','Edge.Cuts']))")
  mkdir -p "$T/$b"
  kicad-cli pcb export gerbers -l "$L" -o "$T/$b/" "$B/$b.kicad_pcb" > /dev/null
  kicad-cli pcb export drill -o "$T/$b/" "$B/$b.kicad_pcb" > /dev/null
  rm -f "$T/$b"/*.gbrjob
  rm -rf "${HERE:?}/$b"; mkdir -p "$HERE/$b"
  for f in "$T/$b"/*; do gzip -9n < "$f" > "$HERE/$b/$(basename "$f").gz"; done
done
rm -rf "${T:?}"
