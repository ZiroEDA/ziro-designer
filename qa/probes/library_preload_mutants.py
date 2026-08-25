#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
"""
Mutation sweep for the library preload, the background job monitor, and the
chooser losing its loading indicators.

Three things CLAUDE.md says this harness has to get right, and each has cost a
session:

  * ASSERT THE EDIT APPLIED. An anchor that missed leaves the file untouched,
    and an untouched file passes - indistinguishable from a kill. Every mutant
    below checks the bytes changed before it is scored.
  * TYPECHECK FIRST, AND SCORE BUILD FAILURES SEPARATELY. A mutant that does
    not compile is a false negative, not a kill.
  * NEVER PARSE FOR THE WORD "passed". When every test in a file fails, vitest
    prints `Tests  1 failed (1)` with no passed count, and a regex expecting
    "passed" reads that as a survivor. The exit code is the verdict.

Run from the repo root:  python3 qa/probes/library_preload_mutants.py
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Outside the repo on purpose: a .tsbuildinfo in the tree would show up in
# `git status` and the harness refuses to run on a dirty tree.
TSBUILDINFO = str(Path.home() / ".mutcache.tsbuildinfo")

PRELOAD = "designer/src/libraryPreload.ts"
MONITOR = "designer/src/ui/background_jobs_monitor.ts"
LIST = "designer/src/ui/BackgroundJobList.tsx"
STATUSBAR = "designer/src/ui/KiStatusBar.tsx"
TREE = "designer/src/widgets/lib_tree.tsx"
SYMPREV = "designer/src/editors/schematic/widgets/symbol_preview_widget.tsx"
FPPREV = "designer/src/widgets/footprint_preview_widget.tsx"
SYMIDX = "designer/src/editors/schematic/symbols/index.ts"
FPLIST = "designer/src/widgets/footprint_list.ts"
SCHPRE = "designer/src/editors/schematic/preload.ts"
PCBPRE = "designer/src/editors/pcb/preload.ts"
SCHED = "designer/src/editors/schematic/SchematicEditor.tsx"

T_PRELOAD = "unittests/designer/library_preload.test.ts"
T_WORK = "unittests/designer/library_preload_work.test.ts"
T_TRIGGER = "unittests/designer/library_preload_trigger.test.ts"
T_MONITOR = "unittests/designer/background_jobs_monitor.test.tsx"
T_CHOOSER = "unittests/designer/chooser_has_no_loading_row.test.tsx"


@dataclass
class Mutant:
    name: str
    file: str
    old: str
    new: str
    tests: list[str]
    # Which package's tsc must be clean for this mutant to be scorable.
    # designer's tsc alone: it compiles every file mutated here (.ts and .tsx),
    # and qa's would only re-report the same error more slowly.
    packages: list[str] = field(default_factory=lambda: ["designer"])


MUTANTS: list[Mutant] = [
    # ---- libraryPreload.ts: the constants and the loop -------------------
    Mutant(
        "interval 150 -> 200",
        PRELOAD,
        "export const PRELOAD_INTERVAL_MS = 150;",
        "export const PRELOAD_INTERVAL_MS = 200;",
        [T_PRELOAD],
    ),
    Mutant(
        "time limit 120000 -> 60000",
        PRELOAD,
        "export const PRELOAD_TIME_LIMIT_MS = 120000;",
        "export const PRELOAD_TIME_LIMIT_MS = 60000;",
        [T_PRELOAD],
    ),
    Mutant(
        "job name loses its Title Case",
        PRELOAD,
        "  symbols: 'Loading Symbol Libraries',",
        "  symbols: 'Loading symbol libraries...',",
        [T_PRELOAD],
    ),
    Mutant(
        "compare_exchange guard removed",
        PRELOAD,
        "  if (inProgress[kind]) return preloadReturn[kind] ?? Promise.resolve();\n  inProgress[kind] = true;",
        "  inProgress[kind] = true;",
        [T_PRELOAD],
    ),
    Mutant(
        "abort branch always blocks instead",
        PRELOAD,
        "    if (aborted) await adapter.abortAsyncLoad();\n    else await adapter.blockUntilLoaded();",
        "    await adapter.blockUntilLoaded();",
        [T_PRELOAD],
    ),
    Mutant(
        "nullopt progress reports 0 instead of 1",
        PRELOAD,
        "      } else {\n        reporter.setCurrentProgress(1);\n        break;",
        "      } else {\n        reporter.setCurrentProgress(0);\n        break;",
        [T_PRELOAD],
    ),
    Mutant(
        "job is never removed from the monitor",
        PRELOAD,
        "    backgroundJobsMonitor.remove(job);",
        "    void job;",
        [T_PRELOAD, T_TRIGGER],
    ),
    Mutant(
        "reporter never reports the job name",
        PRELOAD,
        "    reporter.report(PRELOAD_JOB_NAME[kind]);",
        "",
        [T_PRELOAD],
    ),
    # ---- workQueueAdapter -------------------------------------------------
    Mutant(
        "empty work list reports 0 rather than nullopt",
        PRELOAD,
        "      if (total === 0) return undefined;\n      return loaded / total;",
        "      return total === 0 ? 0 : loaded / total;",
        [T_PRELOAD],
    ),
    Mutant(
        "a failing item stops counting",
        PRELOAD,
        "        try {\n          await item();\n        } catch {\n          /* LOAD_ERROR: counted, not fatal. See above. */\n        }\n        loaded++;",
        "        await item();\n        loaded++;",
        [T_PRELOAD],
    ),
    Mutant(
        "a second asyncLoad restarts the queue",
        PRELOAD,
        "      if (running) return;\n      total = work.length;",
        "      total = work.length;",
        [T_PRELOAD],
    ),
    Mutant(
        "abort leaves the counters set",
        PRELOAD,
        "      total = 0;\n      loaded = 0;\n      abort = false;",
        "      abort = false;",
        [T_PRELOAD],
    ),
    Mutant(
        "cancelPreload fires on an idle face",
        PRELOAD,
        "  if (!inProgress[kind]) return;\n  abortRequested[kind] = true;",
        "  abortRequested[kind] = true;",
        [T_PRELOAD],
    ),
    # ---- background_jobs_monitor.ts --------------------------------------
    Mutant(
        "fractional gauge range 1000 -> 100",
        MONITOR,
        "const FRACTIONAL_PROGRESS_RANGE = 1000;",
        "const FRACTIONAL_PROGRESS_RANGE = 100;",
        [T_PRELOAD, T_MONITOR],
    ),
    Mutant(
        "static_cast<int> becomes a round",
        MONITOR,
        "    this.#job.currentProgress = Math.trunc(FRACTIONAL_PROGRESS_RANGE * progress);",
        "    this.#job.currentProgress = Math.round(FRACTIONAL_PROGRESS_RANGE * progress);",
        [T_PRELOAD],
    ),
    Mutant(
        "the status bar follows the NEWEST job",
        MONITOR,
        "    return this.#jobs[0] ?? null;",
        "    return this.#jobs[this.#jobs.length - 1] ?? null;",
        [T_MONITOR],
    ),
    Mutant(
        "SetNumPhases does not set the range",
        MONITOR,
        "    this.#job.maxProgress = numPhases;",
        "    this.#job.maxProgress = 1;",
        [T_MONITOR],
    ),
    Mutant(
        "publish reuses the array identity",
        MONITOR,
        "    this.#snapshot = this.#jobs.slice();",
        "    this.#snapshot = this.#jobs;",
        [T_MONITOR],
    ),
    # ---- BACKGROUND_JOB_LIST ---------------------------------------------
    Mutant(
        "list size 300x150 -> 320x200",
        LIST,
        "export const BACKGROUND_JOB_LIST_SIZE = { width: 300, height: 150 } as const;",
        "export const BACKGROUND_JOB_LIST_SIZE = { width: 320, height: 200 } as const;",
        [T_MONITOR],
    ),
    Mutant(
        "row height 75 -> 60",
        LIST,
        "export const BACKGROUND_JOB_PANEL_HEIGHT = 75;",
        "export const BACKGROUND_JOB_PANEL_HEIGHT = 60;",
        [T_MONITOR],
    ),
    Mutant(
        "popup opens DOWN-RIGHT of the anchor",
        LIST,
        "        left: anchorX - BACKGROUND_JOB_LIST_SIZE.width,\n        top: anchorY - BACKGROUND_JOB_LIST_SIZE.height,",
        "        left: anchorX,\n        top: anchorY,",
        [T_MONITOR],
    ),
    Mutant(
        "outside press no longer closes it",
        LIST,
        "    document.addEventListener('mousedown', onDown, true);",
        "    void onDown;",
        [T_MONITOR],
    ),
    Mutant(
        "the caption is drawn after all",
        LIST,
        '      <div className="ze-bgjob-scroll">',
        '      <div className="ze-bgjob-title">Background Jobs</div>\n      <div className="ze-bgjob-scroll">',
        [T_MONITOR],
    ),
    Mutant(
        "the job status line is dropped",
        LIST,
        '      <div className="ze-bgjob-status">{job.status}</div>\n',
        "",
        [T_MONITOR],
    ),
    # ---- KISTATUSBAR ------------------------------------------------------
    Mutant(
        "the panes stay visible when idle",
        STATUSBAR,
        "  if (!job) return null;",
        "  if (!job) return <span className=\"cell bgjob-label\" data-testid=\"statusbar-bgjob-label\" />;",
        [T_MONITOR],
    ),
    Mutant(
        "the gauge click does not open the list",
        STATUSBAR,
        "          setListAt(r ? { x: r.right, y: r.top } : { x: 0, y: 0 });",
        "          void r;",
        [T_MONITOR],
    ),
    Mutant(
        "the label shows the job NAME instead of its status",
        STATUSBAR,
        "      <span className=\"cell bgjob-label\" data-testid=\"statusbar-bgjob-label\">\n        {job.status}\n      </span>",
        "      <span className=\"cell bgjob-label\" data-testid=\"statusbar-bgjob-label\">\n        {job.name}\n      </span>",
        [T_MONITOR],
    ),
    # ---- the chooser's removed indicators --------------------------------
    Mutant(
        "the tree gets a loading row back",
        TREE,
        "        {rows.length === 0 && (\n          <div className=\"ze-muted\" style={{ padding: 8 }}>\n            No matches\n          </div>\n        )}",
        "        <div className=\"ze-lib-loading-panel\">\n          <span className=\"ze-spinner big\" />\n          <span className=\"msg\">Loading symbol libraries...</span>\n        </div>",
        [T_CHOOSER],
    ),
    Mutant(
        "the symbol preview gets a loading overlay back",
        SYMPREV,
        "        <div className=\"ze-preview-status\">{statusText}</div>",
        "        <div className=\"ze-canvas-loading\">\n          <span className=\"ze-spinner\" />\n          <span>Loading Device...</span>\n        </div>",
        [T_CHOOSER],
    ),
    Mutant(
        "the footprint preview says Loading again",
        FPPREV,
        "          {!footprint || status !== 'missing' ? statusText : 'Footprint not found.'}",
        "          {!footprint ? statusText : status === 'missing' ? 'Footprint not found' : 'Loading...'}",
        [T_CHOOSER],
    ),
    # ---- the work lists ---------------------------------------------------
    Mutant(
        "symbol work list drops the index",
        SYMIDX,
        "  const work: (() => Promise<unknown>)[] = [() => loadIndex()];\n  const seen = new Set<string>();\n  for (const libId of libIds) {",
        "  const work: (() => Promise<unknown>)[] = [];\n  const seen = new Set<string>();\n  for (const libId of libIds) {",
        [T_WORK],
    ),
    Mutant(
        "symbol work list stops deduping",
        SYMIDX,
        "    if (seen.has(libId)) continue;\n    seen.add(libId);\n    const library = libId.slice(0, sep);",
        "    const library = libId.slice(0, sep);",
        [T_WORK],
    ),
    Mutant(
        "symbol work list keeps a bare LIB_ID",
        SYMIDX,
        "    if (sep <= 0 || sep === libId.length - 1) continue;",
        "    if (sep === libId.length - 1) continue;",
        [T_WORK],
    ),
    Mutant(
        "symbol work list fetches whole libraries",
        SYMIDX,
        "    work.push(() => loadSymbol(library, name));",
        "    work.push(() => loadLibrarySymbols(library));",
        [T_WORK],
    ),
    Mutant(
        "footprint work list drops the index",
        FPLIST,
        "  const work: (() => Promise<unknown>)[] = [() => loadFootprintIndex()];",
        "  const work: (() => Promise<unknown>)[] = [];",
        [T_WORK],
    ),
    Mutant(
        "footprint work list stops deduping",
        FPLIST,
        "    if (seen.has(fpId)) continue;\n    seen.add(fpId);\n    work.push(() => loadFootprint(fpId));",
        "    work.push(() => loadFootprint(fpId));",
        [T_WORK],
    ),
    # ---- what the design contributes -------------------------------------
    Mutant(
        "only the first sheet's symbols are preloaded",
        SCHPRE,
        "  for (const doc of docs) for (const sym of doc.symbols) ids.add(sym.libId);",
        "  for (const doc of [...docs].slice(0, 1)) for (const sym of doc.symbols) ids.add(sym.libId);",
        [T_WORK],
    ),
    Mutant(
        "an unassigned Footprint field becomes a fetch",
        SCHPRE,
        "      if (fp.includes(':')) ids.add(fp);",
        "      ids.add(fp);",
        [T_WORK],
    ),
    Mutant(
        "the footprint face is not preloaded at all",
        SCHPRE,
        "    void preloadLibraries('footprints', workQueueAdapter(footprints));",
        "    void footprints;",
        [T_TRIGGER],
    ),
    Mutant(
        "board footprints stop deduping",
        PCBPRE,
        "  for (const fp of board.footprints) if (fp.lib.includes(':')) ids.add(fp.lib);\n  return [...ids];",
        "  const out: string[] = [];\n  for (const fp of board.footprints) if (fp.lib.includes(':')) out.push(fp.lib);\n  void ids;\n  return out;",
        [T_WORK],
    ),
    # ---- the trigger sites ------------------------------------------------
    Mutant(
        "loadText no longer preloads",
        SCHED,
        "        preloadSchematicLibraries([next]);",
        "",
        [T_TRIGGER],
    ),
    Mutant(
        "the preload moves to the place tool",
        SCHED,
        "        preloadSchematicLibraries(docs.values());",
        "        if (activeTool === 'placeSymbol') preloadSchematicLibraries(docs.values());",
        [T_TRIGGER],
    ),
]


def run(cmd: list[str], cwd: Path = ROOT) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def main() -> int:
    """`library_preload_mutants.py [START [END]]` - run mutants [START, END).

    Ranges, not a single sweep, and the reason is in CLAUDE.md's neighbourhood:
    a long background sweep that is killed leaves its current mutant applied in
    the tree and loses every verdict it had buffered. That happened here. Run it
    in short foreground steps and record the verdicts as they print.
    """
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    stop = int(sys.argv[2]) if len(sys.argv) > 2 else len(MUTANTS)
    rows: list[tuple[str, str, str]] = []

    _, out = run(["git", "status", "--porcelain"])
    if out.strip():
        print("REFUSING: working tree is dirty; commit the baseline first.")
        print(out)
        return 2

    for i, m in enumerate(MUTANTS):
        if not (start <= i < stop):
            continue
        path = ROOT / m.file
        before = path.read_text()
        if m.old not in before:
            rows.append((m.name, "ANCHOR-MISSED", m.file))
            print(f"  [{i:>2}] ANCHOR-MISSED  {m.name}", flush=True)
            continue
        # Exactly one occurrence, so the mutation is aimed rather than sprayed.
        if before.count(m.old) != 1:
            rows.append((m.name, f"AMBIGUOUS x{before.count(m.old)}", m.file))
            print(f"  [{i:>2}] AMBIGUOUS      {m.name}", flush=True)
            continue
        path.write_text(before.replace(m.old, m.new, 1))
        after = path.read_text()
        assert after != before, m.name

        try:
            verdict = "?"
            build_ok = True
            for pkg in m.packages:
                # `--incremental` with a build-info file kept OUTSIDE the repo:
                # a full `tsc --noEmit` on designer is 100 s and a warm
                # incremental one is 18 s, which is the difference between a
                # sweep that fits in a foreground step and one that does not.
                # It typechecks the same program; only the work it can skip
                # changes.
                rc, out = run(
                    [
                        "npx",
                        "tsc",
                        "--noEmit",
                        "--incremental",
                        "--tsBuildInfoFile",
                        TSBUILDINFO,
                    ],
                    cwd=ROOT / pkg,
                )
                if rc != 0:
                    build_ok = False
                    verdict = f"BUILD-FAIL ({pkg})"
                    break
            if build_ok:
                # The EXIT CODE is the verdict. `Tests  1 failed (1)` has no
                # "passed" count at all when every test in the file fails.
                rc, out = run(["npx", "vitest", "run", *m.tests, "--root", "qa"])
                if "No test files found" in out:
                    verdict = "HARNESS-ERROR (no test files)"
                elif rc != 0:
                    verdict = "KILLED"
                else:
                    verdict = "SURVIVED"
        finally:
            path.write_text(before)

        rows.append((m.name, verdict, m.file))
        print(f"  [{i:>2}] {verdict:<28} {m.name}", flush=True)

    print()
    print("=" * 78)
    for name, verdict, file in rows:
        print(f"{verdict:<28} {name}   [{file.split('/')[-1]}]")
    print("=" * 78)
    killed = sum(1 for _, v, _ in rows if v == "KILLED")
    survived = [n for n, v, _ in rows if v == "SURVIVED"]
    other = [(n, v) for n, v, _ in rows if v not in ("KILLED", "SURVIVED")]
    print(f"killed {killed} / {len(rows)}")
    if survived:
        print("SURVIVED: " + ", ".join(survived))
    if other:
        print("NOT SCORED: " + ", ".join(f"{n} [{v}]" for n, v in other))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
