#!/bin/sh
# Regenerate the ODB++ oracle: kicad-cli's own uncompressed export of each resave/ board, and the
# folder list of each (git keeps no empty folders). Run from this directory.
set -e
for B in ecc83-pp interf_u blindvias_kicad_cli custompads_kicad_cli hatchpads_kicad_cli StickHub_kicad_cli ecc83-pp_flipped; do
  rm -rf "./$B"
  kicad-cli pcb export odb --compression none -o "$B" "../resave/$B.kicad_pcb"
done
rm -rf ./ecc83-pp-inch
kicad-cli pcb export odb --compression none --units in --precision 4 -o ecc83-pp-inch ../resave/ecc83-pp.kicad_pcb
for B in ecc83-pp interf_u blindvias_kicad_cli custompads_kicad_cli hatchpads_kicad_cli StickHub_kicad_cli ecc83-pp_flipped ecc83-pp-inch; do
  (cd "$B" && find . -mindepth 1 -type d | sed 's|^\./||' | sort > "../$B.dirs")
done
rm -f ../resave/*.kicad_prl
