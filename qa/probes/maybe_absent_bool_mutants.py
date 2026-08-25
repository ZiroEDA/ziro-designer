#!/usr/bin/env python3
"""Mutation sweep for the parseMaybeAbsentBool port.

Each mutant is an exact (file, old, new, occurrence) edit. The harness:

  1. asserts the file's bytes actually changed (an anchor that missed leaves the
     file untouched, and an untouched file passes — indistinguishable from a
     kill);
  2. typechecks BEFORE running tests, and scores a build failure separately from
     a survivor;
  3. reads vitest's exit code rather than grepping for a "passed" count — when
     every test in a file fails, vitest prints no `passed` at all;
  4. restores with `git checkout --` against a committed baseline.

Run from the worktree root:  python3 qa/probes/maybe_absent_bool_mutants.py
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field

RB = "pcbnew/src/read-board.ts"
RS = "eeschema/src/sch_io/sexpr/read-schematic.ts"
QY = "libs/sexpr/src/query.ts"

PCB_T = "unittests/pcbnew/maybe_absent_bool.test.ts"
SCH_T = "unittests/eeschema/maybe_absent_bool.test.ts"
LIB_T = "unittests/libs/sexpr/maybe_absent_bool.test.ts"


@dataclass
class Mutant:
    name: str
    path: str
    old: str
    new: str
    tests: list[str]
    # Which occurrence of `old` to patch (0-based). A file-level hash cannot
    # tell two identical calls apart, so this is explicit.
    occurrence: int = 0
    typecheck: list[str] = field(default_factory=lambda: ["pcbnew"])


def d(name, path, old, new, tests, occurrence=0, tc=("pcbnew",)):
    return Mutant(name, path, old, new, list(tests), occurrence, list(tc))


MUTANTS: list[Mutant] = [
    # --- A: one per call-site default -------------------------------------
    d("A01 enabled true->false", RB, "maybeAbsent(node, \'enabled\', true)", "maybeAbsent(node, \'enabled\', false)", [PCB_T]),
    d("A02 allow_two_segments true->false", RB, "maybeAbsent(node, \'allow_two_segments\', true)", "maybeAbsent(node, \'allow_two_segments\', false)", [PCB_T]),
    d("A03 prefer_zone_connections false->true", RB, "maybeAbsent(node, \'prefer_zone_connections\', false)", "maybeAbsent(node, \'prefer_zone_connections\', true)", [PCB_T]),
    d("A04 curved_edges true->false", RB, "maybeAbsent(node, \'curved_edges\', true)", "maybeAbsent(node, \'curved_edges\', false)", [PCB_T]),
    d("A05 suppress_zeroes true->false", RB, "maybeAbsent(fmtNode, \'suppress_zeroes\', true)", "maybeAbsent(fmtNode, \'suppress_zeroes\', false)", [PCB_T]),
    d("A06 keep_text_aligned true->false", RB, "maybeAbsent(styleNode, \'keep_text_aligned\', true)", "maybeAbsent(styleNode, \'keep_text_aligned\', false)", [PCB_T]),
    d("A07 pcb bold true->false", RB, "maybeAbsent(font, \'bold\', true)", "maybeAbsent(font, \'bold\', false)", [PCB_T]),
    d("A08 pcb italic true->false", RB, "maybeAbsent(font, \'italic\', true)", "maybeAbsent(font, \'italic\', false)", [PCB_T]),
    d("A09 effects hide true->false", RB, "maybeAbsent(effects, \'hide\', true)", "maybeAbsent(effects, \'hide\', false)", [PCB_T]),
    d("A10 item hide true->false", RB, "maybeAbsent(item, \'hide\', true) ?? false;", "maybeAbsent(item, \'hide\', false) ?? false;", [PCB_T]),
    d("A11 unconn bare-atom true->false", RB, "applyMode(child.value, true);", "applyMode(child.value, false);", [PCB_T]),
    d("A12 unconn list true->false", RB, "maybeAbsentBoolOf(child, true, 'yes-no-true-false')", "maybeAbsentBoolOf(child, false, 'yes-no-true-false')", [PCB_T]),
    d("A13 footprint locked true->false", RB, "locked: maybeAbsent(item, 'locked', true) ?? false,", "locked: maybeAbsent(item, 'locked', false) ?? false,", [PCB_T]),
    d("A14 model hide true->false", RB, "hide: maybeAbsent(item, 'hide', true) ?? false,", "hide: maybeAbsent(item, 'hide', false) ?? false,", [PCB_T]),
    d("A15 lockedOf true->false", RB, "maybeAbsent(item, \'locked\', true);", "maybeAbsent(item, \'locked\', false);", [PCB_T]),
    d("A16 sch hide true->false", RS, "maybeAbsent(e, \'hide\', true)", "maybeAbsent(e, \'hide\', false)", [SCH_T], tc=("eeschema",)),
    d("A17 sch bold true->false", RS, "maybeAbsent(font, \'bold\', true)", "maybeAbsent(font, \'bold\', false)", [SCH_T], tc=("eeschema",)),
    d("A18 sch italic true->false", RS, "maybeAbsent(font, \'italic\', true)", "maybeAbsent(font, \'italic\', false)", [SCH_T], tc=("eeschema",)),
    d("A19 sch show_name true->false", RS, "maybeAbsent(node, \'show_name\', true)", "maybeAbsent(node, \'show_name\', false)", [SCH_T], tc=("eeschema",)),
    d("A20 sch do_not_autoplace true->false", RS, "maybeAbsent(node, \'do_not_autoplace\', true)", "maybeAbsent(node, \'do_not_autoplace\', false)", [SCH_T], tc=("eeschema",)),
    # --- B: the helper's own semantics ------------------------------------
    d("B1 drop the bare-atom shape", QY, "      if (item.value === name) result = whenPresent;", "      if (item.value === `x${name}`) result = whenPresent;", [LIB_T, PCB_T, SCH_T], tc=("libs/sexpr",)),
    d("B2 (hide) returns the opposite", QY, "  if (first === undefined) return whenPresent;", "  if (first === undefined) return !whenPresent;", [LIB_T, PCB_T, SCH_T], tc=("libs/sexpr",)),
    d("B3 eeschema accepts true/false too", QY, "  const wide = dialect === 'yes-no-true-false';", "  const wide = true;", [LIB_T, SCH_T], tc=("libs/sexpr",)),
    d("B4 swallow Expecting, use the default", QY, "  else throw new ExpectingError('yes or no', `(${name} ${first.value})`);", "  else return whenPresent;", [LIB_T, PCB_T, SCH_T], tc=("libs/sexpr",)),
    d("B5 a quoted \"yes\" counts as yes", QY, "  if (first.kind !== 'atom') throw new ExpectingError('yes or no', `(${name} …)`);", "  if (first.kind === 'list') throw new ExpectingError('yes or no', `(${name} …)`);", [LIB_T], tc=("libs/sexpr",)),
    d("B6 scan the head token too", QY, "  for (let i = 1; i < parent.items.length; i++) {", "  for (let i = 0; i < parent.items.length; i++) {", [LIB_T], tc=("libs/sexpr",)),
    d("B7 first occurrence wins", QY, "    if (isList(item) && head(item) === name) result = maybeAbsentBoolOf(item, whenPresent, dialect);", "    if (isList(item) && head(item) === name && result === undefined)\n      result = maybeAbsentBoolOf(item, whenPresent, dialect);", [LIB_T], tc=("libs/sexpr",)),
    d("B8 drop NeedRIGHT()", QY, "  if (node.items.length > 2) throw new ExpectingError(')', `(${name} …)`);", "  if (node.items.length > 99) throw new ExpectingError(')', `(${name} …)`);", [LIB_T], tc=("libs/sexpr",)),
    d("B9 ignore the (effects …) hide", RB, "  const hide = fx.hidden ?? maybeAbsent(item, 'hide', true) ?? false;", "  const hide = maybeAbsent(item, 'hide', true) ?? false;", [PCB_T]),
]


def sh(cmd: list[str]) -> tuple[int, str]:
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def apply(m: Mutant) -> bool:
    with open(m.path, encoding="utf8") as fh:
        src = fh.read()
    n = src.count(m.old)
    if n <= m.occurrence:
        print(f"    ANCHOR MISS: {n} occurrence(s), wanted #{m.occurrence}")
        return False
    idx = -1
    for _ in range(m.occurrence + 1):
        idx = src.index(m.old, idx + 1)
    out = src[:idx] + m.new + src[idx + len(m.old) :]
    if out == src:
        print("    NO-OP EDIT")
        return False
    with open(m.path, "w", encoding="utf8") as fh:
        fh.write(out)
    # Bytes actually changed?
    rc, _ = sh(["git", "diff", "--quiet", "--", m.path])
    if rc == 0:
        print("    FILE UNCHANGED after write")
        return False
    return True


def restore(paths: list[str]) -> None:
    sh(["git", "checkout", "--"] + paths)


def main() -> int:
    rc, out = sh(["git", "status", "--porcelain"])
    if out.strip():
        print("Working tree is dirty; commit the baseline first:\n" + out)
        return 2

    tally = {"KILLED": [], "SURVIVED": [], "BUILD-FAILED": [], "HARNESS-ERROR": []}

    for m in MUTANTS:
        print(f"\n=== {m.name}  [{m.path}]")
        if not apply(m):
            tally["HARNESS-ERROR"].append(m.name)
            restore([m.path])
            continue
        try:
            for pkg in m.typecheck:
                rc, out = sh(["npx", "tsc", "--noEmit", "-p", pkg])
                if rc != 0:
                    print(f"    BUILD-FAILED ({pkg})\n" + out[-800:])
                    tally["BUILD-FAILED"].append(m.name)
                    break
            else:
                rc, out = sh(["npx", "vitest", "run", "--root", "qa", *m.tests])
                if rc != 0:
                    print("    KILLED (vitest exit %d)" % rc)
                    tally["KILLED"].append(m.name)
                elif "Test Files" not in out:
                    print("    HARNESS-ERROR: no test summary\n" + out[-800:])
                    tally["HARNESS-ERROR"].append(m.name)
                else:
                    print("    *** SURVIVED ***")
                    tally["SURVIVED"].append(m.name)
        finally:
            restore([m.path])

    print("\n\n===== TALLY =====")
    for k in ("KILLED", "SURVIVED", "BUILD-FAILED", "HARNESS-ERROR"):
        print(f"{k}: {len(tally[k])}")
        for n in tally[k]:
            print(f"    {n}")
    return 1 if tally["SURVIVED"] or tally["HARNESS-ERROR"] or tally["BUILD-FAILED"] else 0


if __name__ == "__main__":
    sys.exit(main())
