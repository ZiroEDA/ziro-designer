#!/bin/bash
# Score ONE mutant.  Prints exactly one verdict line.
#
#   KILLED         the target tests failed, and vitest printed a summary saying so
#   SURVIVED       the target tests passed with the mutant applied
#   BUILD-FAILED   the mutant does not typecheck - a false negative, not a kill
#   HARNESS-ERROR  no parseable "Tests" summary at all (the file failed to
#                  collect, the runner died, ...).  Never scored as SURVIVED:
#                  when EVERY test in a file fails vitest prints
#                  "Tests  1 failed (1)" with no `passed` count, so a regex
#                  expecting `passed` misreports a kill as an error.
set -u
WT=/home/akshay/ziro-wt-plgap
NAME=$1; shift
TSPROJ=$1; shift
FILES="$*"

cd "$WT" || exit 9
python3 qa/probes/pl_gaps_mutants/mutate.py apply "$NAME" || { echo "VERDICT $NAME ANCHOR-MISS"; exit 0; }

if [ "$TSPROJ" != "none" ]; then
  TSOUT=$(npx tsc -p "$TSPROJ" --noEmit --incremental \
      --tsBuildInfoFile "/tmp/claude-1000/-home-akshay-ziro-designer-1/6e141738-bbf2-447c-89aa-312d4fc9008a/scratchpad/$TSPROJ.tsbuildinfo" 2>&1)
  TSRC=$?
  if [ $TSRC -ne 0 ]; then
    echo "VERDICT $NAME BUILD-FAILED  ($(echo "$TSOUT" | head -1))"
    python3 qa/probes/pl_gaps_mutants/mutate.py restore >/dev/null
    exit 0
  fi
fi

OUT=$(npx vitest run $FILES --root qa 2>&1)
RC=$?
SUMMARY=$(echo "$OUT" | grep -E '^\s+Tests\s+' | tail -1)
python3 qa/probes/pl_gaps_mutants/mutate.py restore >/dev/null

if [ -z "$SUMMARY" ]; then
  echo "VERDICT $NAME HARNESS-ERROR rc=$RC  no Tests summary"
  echo "$OUT" | tail -6
  exit 0
fi
if echo "$SUMMARY" | grep -q 'failed'; then
  echo "VERDICT $NAME KILLED rc=$RC  |$SUMMARY|"
elif [ $RC -eq 0 ]; then
  echo "VERDICT $NAME SURVIVED rc=$RC  |$SUMMARY|"
else
  echo "VERDICT $NAME HARNESS-ERROR rc=$RC  |$SUMMARY|"
fi
