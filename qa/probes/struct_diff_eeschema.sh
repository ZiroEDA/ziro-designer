#!/usr/bin/env bash
# Classify every eeschema/*.ts against KiCad 10.0.5's own file layout.
# Sibling of struct_diff.sh (pcbnew) — see that script's header for the
# rationale. This one also scans designer/src/editors/schematic/*.ts(x) for
# non-UI modules that have a KiCad counterpart and should live in eeschema/.
#
# Writes docs/eeschema-structure-diff.md.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
K=${KICAD_REFERENCE:-/home/akshay/kicad-reference}
KE=$K/eeschema
[ -d "$KE" ] || { echo "no KiCad reference at $KE (set KICAD_REFERENCE)" >&2; exit 1; }

cd "$ROOT/eeschema"
tsv=$(mktemp)
trap 'rm -f "$tsv"' EXIT

for f in $(find . -path ./node_modules -prune -o \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' -print | sed 's|^\./||' | sort); do
  rel=${f%.ts}; rel=${rel%.tsx}; base=$(basename "$rel")
  if   [ -f "$KE/$rel.cpp" ];                          then printf 'SAME\t%s\t%s\n'      "$f" "$rel.cpp"
  elif hit=$(find "$KE" -name "$base.cpp" | head -1); [ -n "$hit" ];
                                                       then printf 'MOVED\t%s\t%s\n'     "$f" "${hit#"$KE"/}"
  elif hit=$(find "$KE" -name "$base.h"   | head -1); [ -n "$hit" ];
                                                       then printf 'HEADER\t%s\t%s\n'    "$f" "${hit#"$KE"/}"
  elif hit=$(ls "$KE/dialogs/dialog_$base.cpp" "$KE/dialogs/dialog_${base}_base.cpp" 2>/dev/null | head -1); [ -n "$hit" ];
                                                       then printf 'DIALOG\t%s\tdialogs/%s\n' "$f" "$(basename "$hit")"
  elif hit=$(find "$K/common" "$K/include" "$K/libs" \( -name "$base.cpp" -o -name "$base.h" \) 2>/dev/null | head -1); [ -n "$hit" ];
                                                       then printf 'ELSEWHERE\t%s\t%s\n' "$f" "${hit#"$K"/}"
  else                                                      printf 'OURS\t%s\t-\n'       "$f"
  fi
done > "$tsv"

# Second pass: designer/src/editors/schematic non-UI modules with a KiCad name hit.
cd "$ROOT/designer/src/editors/schematic"
for f in $(find . -path ./node_modules -prune -o \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' -print | sed 's|^\./||' | sort); do
  rel=${f%.ts}; rel=${rel%.tsx}; base=$(basename "$rel")
  hit=$(find "$KE" -name "$base.cpp" -o -name "$base.h" 2>/dev/null | head -1)
  if [ -n "$hit" ]; then
    printf 'DESIGNER_CANDIDATE\tdesigner/src/editors/schematic/%s\t%s\n' "$f" "${hit#"$KE"/}" >> "$tsv"
  fi
done

out=$ROOT/docs/eeschema-structure-diff.md
count () { grep -c "^$1" "$tsv" || true; }

{
  echo "# eeschema file-structure divergence from KiCad 10.0.5"
  echo
  echo "Generated $(date +%F) against \`$KE\`. Regenerate with \`qa/probes/struct_diff_eeschema.sh\`."
  echo
  echo "| status | count | meaning |"
  echo "|---|---:|---|"
  echo "| SAME | $(count SAME) | same relative path and name as KiCad's \`.cpp\` |"
  echo "| MOVED | $(count MOVED) | KiCad has this name, in a different directory |"
  echo "| DIALOG | $(count DIALOG) | KiCad has it as \`dialogs/dialog_<name>.cpp\` |"
  echo "| HEADER | $(count HEADER) | KiCad declares it in a \`.h\` with no matching \`.cpp\` |"
  echo "| ELSEWHERE | $(count ELSEWHERE) | KiCad puts it outside \`eeschema/\` |"
  echo "| OURS | $(count OURS) | no KiCad file of this name anywhere |"
  echo "| DESIGNER_CANDIDATE | $(count DESIGNER_CANDIDATE) | in designer/src/editors/schematic but named after a KiCad eeschema file — check for designer/ imports before moving |"
  echo
  for k in MOVED DIALOG ELSEWHERE HEADER OURS DESIGNER_CANDIDATE; do
    echo "## $k"; echo
    echo "| ours | KiCad (\`eeschema/\` unless noted) |"
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
