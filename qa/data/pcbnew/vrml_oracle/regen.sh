#!/bin/bash
# regen.sh: kicad-cli 10.0.6's VRML (millimetres, the board's own centre as origin) for the
# boards in qa/data/pcbnew/resave, gzipped. Every 3D model path points at an empty folder, so the
# file is the board alone - what pcbnew writes for a model it cannot resolve - and the oracle
# does not depend on which model libraries this machine has.
set -eu
HERE=$(dirname "$(readlink -f "$0")"); B=$HERE/../resave; T=$(mktemp -d); E=$T/empty; mkdir -p "$E"
for b in ecc83-pp interf_u blindvias_kicad_cli custompads_kicad_cli hatchpads_kicad_cli StickHub_kicad_cli ecc83-pp_flipped; do
  KICAD6_3DMODEL_DIR=$E KICAD7_3DMODEL_DIR=$E KICAD8_3DMODEL_DIR=$E KICAD9_3DMODEL_DIR=$E KICAD10_3DMODEL_DIR=$E \
    kicad-cli pcb export vrml --units mm -o "$T/$b.wrl" "$B/$b.kicad_pcb" > /dev/null
  gzip -9n < "$T/$b.wrl" > "$HERE/$b.wrl.gz"
done
rm -rf "${T:?}"
