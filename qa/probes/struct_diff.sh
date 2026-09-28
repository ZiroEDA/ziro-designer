#!/usr/bin/env bash
# Classify every pcbnew/*.ts against KiCad 10.0.5's own file layout.
#
# KiCad parity is a structural claim as well as a behavioural one: a module we
# put somewhere KiCad does not is a module nobody can find by reading the C++
# tree beside it. This prints one line per file so the drift is countable.
#
# Writes docs/pcbnew-structure-diff.md.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
K=${KICAD_REFERENCE:-/home/akshay/kicad-reference}
KP=$K/pcbnew
[ -d "$KP" ] || { echo "no KiCad reference at $KP (set KICAD_REFERENCE)" >&2; exit 1; }

cd "$ROOT/pcbnew"
tsv=$(mktemp)
trap 'rm -f "$tsv"' EXIT

for f in $(find . -path ./node_modules -prune -o -name '*.ts' ! -name '*.test.ts' -print | sed 's|^\./||' | sort); do
  rel=${f%.ts}; base=$(basename "$rel")
  if   [ -f "$KP/$rel.cpp" ];                         then printf 'SAME\t%s\t%s\n'      "$f" "$rel.cpp"
  elif hit=$(find "$KP" -name "$base.cpp" | head -1); [ -n "$hit" ];
                                                      then printf 'MOVED\t%s\t%s\n'     "$f" "${hit#"$KP"/}"
  elif hit=$(find "$KP" -name "$base.h"   | head -1); [ -n "$hit" ];
                                                      then printf 'HEADER\t%s\t%s\n'    "$f" "${hit#"$KP"/}"
  elif hit=$(ls "$KP/dialogs/dialog_$base.cpp" "$KP/dialogs/dialog_${base}_base.cpp" 2>/dev/null | head -1); [ -n "$hit" ];
                                                      then printf 'DIALOG\t%s\tdialogs/%s\n' "$f" "$(basename "$hit")"
  elif hit=$(find "$K/common" "$K/include" "$K/libs" \( -name "$base.cpp" -o -name "$base.h" \) 2>/dev/null | head -1); [ -n "$hit" ];
                                                      then printf 'ELSEWHERE\t%s\t%s\n' "$f" "${hit#"$K"/}"
  else                                                     printf 'OURS\t%s\t-\n'       "$f"
  fi
done > "$tsv"

out=$ROOT/docs/pcbnew-structure-diff.md
count () { grep -c "^$1" "$tsv" || true; }

{
  echo "# pcbnew file-structure divergence from KiCad 10.0.5"
  echo
  echo "Generated $(date +%F) against \`$KP\`. Regenerate with \`qa/probes/struct_diff.sh\`."
  echo
  echo "| status | count | meaning |"
  echo "|---|---:|---|"
  echo "| SAME | $(count SAME) | same relative path and name as KiCad's \`.cpp\` |"
  echo "| MOVED | $(count MOVED) | KiCad has this name, in a different directory |"
  echo "| DIALOG | $(count DIALOG) | KiCad has it as \`dialogs/dialog_<name>.cpp\` |"
  echo "| HEADER | $(count HEADER) | KiCad declares it in a \`.h\` with no matching \`.cpp\` |"
  echo "| ELSEWHERE | $(count ELSEWHERE) | KiCad puts it outside \`pcbnew/\` |"
  echo "| OURS | $(count OURS) | no KiCad file of this name anywhere |"
  echo
  for k in MOVED DIALOG ELSEWHERE HEADER OURS; do
    echo "## $k"; echo
    echo "| ours (\`pcbnew/\`) | KiCad (\`pcbnew/\` unless noted) |"
    echo "|---|---|"
    awk -F'\t' -v k="$k" '$1==k {print "| `"$2"` | `"$3"` |"}' "$tsv"
    echo
  done
  echo "## SAME"; echo
  echo "<details><summary>$(count SAME) files already at KiCad's own path</summary>"; echo
  awk -F'\t' '$1=="SAME" {print "- `"$2"`"}' "$tsv"
  echo; echo "</details>"
} > "$out"

cut -f1 "$tsv" | sort | uniq -c | sort -rn >&2
echo "wrote $out" >&2
