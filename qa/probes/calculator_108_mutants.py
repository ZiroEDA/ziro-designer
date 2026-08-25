#!/usr/bin/env python3
"""Mutation sweep for the calculator work on claude/calculator-108.

Each mutant is (id, file, old, new, tests). For each:
  1. apply the edit and ASSERT the file's bytes changed -- an anchor that
     missed leaves the file untouched, and an untouched file passes, which is
     indistinguishable from a kill;
  2. typecheck FIRST. A mutant that does not compile is a build failure, not a
     kill, and is scored separately;
  3. run only the tests named, and read the process EXIT CODE alongside the
     summary. Vitest under load sometimes prints no summary at all, and that
     reads exactly like a kill -- so no parseable summary with exit 0 is a
     HARNESS error, never SURVIVED;
  4. restore with `git checkout --`, which is only safe because the baseline is
     committed.

Run from anywhere:  python3 qa/probes/calculator_108_mutants.py [id ...]
"""

import signal
import subprocess
import sys
from pathlib import Path

WT = Path(__file__).resolve().parents[2]
BIN = Path("/home/akshay/ziro-designer-1/node_modules/.bin")

D = "designer/src"
P = "pcb_calculator/src"
Q = "qa/unittests/pcb_calculator"

SETTINGS = f"{Q}/calculator_settings.test.ts"
STRIP = f"{Q}/stripline_oracle.test.ts"
UNITS = f"{Q}/unit_selector.test.ts"
ART = f"{Q}/calculator_art.test.ts"
HS = f"{Q}/high_speed.test.ts"
QA_ALL = f"{Q}/"

MUTANTS = [
    # ---- the settings table, one entry at a time -------------------------
    (
        "defaults-thickness-unit",
        f"{D}/prefs/settings.ts",
        "    ext_track_thickness_units: 1,",
        "    ext_track_thickness_units: 0,",
        [SETTINGS],
    ),
    (
        "defaults-clearance-string",
        f"{D}/prefs/settings.ts",
        "    clearance_diameter: '1.0',",
        "    clearance_diameter: '1',",
        [SETTINGS],
    ),
    (
        "defaults-last-page",
        f"{D}/prefs/settings.ts",
        "  last_page: 1,",
        "  last_page: 0,",
        [SETTINGS],
    ),
    (
        "defaults-regulator-type",
        f"{D}/prefs/settings.ts",
        "    type: 1,\n    last_param: 0,",
        "    type: 0,\n    last_param: 0,",
        [SETTINGS],
    ),
    (
        # Adding or removing a TOP-LEVEL key is caught by the type system before
        # any test runs -- PcbCalculatorSettings is an exact shape and every
        # panel's saver is typed against it -- so this one is expected to score
        # BUILD-FAILED, and that is the stronger guarantee. What the key-set
        # assertion catches is a rename that still typechecks; see the
        # test-side mutation in the report.
        "defaults-extra-key",
        f"{D}/prefs/settings.ts",
        "  corrosion_table: { threshold_voltage: '0', show_symbols: true },",
        "  corrosion_table: { threshold_voltage: '0', show_symbols: true, invented: 1 },",
        [SETTINGS],
    ),
    (
        "defaults-corrosion-symbols",
        f"{D}/prefs/settings.ts",
        "  corrosion_table: { threshold_voltage: '0', show_symbols: true },",
        "  corrosion_table: { threshold_voltage: '0', show_symbols: false },",
        [SETTINGS],
    ),
    (
        "normalize-drops-freeform",
        f"{D}/prefs/settings.ts",
        "  const tl = (stored as { trans_line?: Record<string, unknown> } | null | undefined)?.trans_line;",
        "  const tl = undefined as Record<string, unknown> | undefined;",
        [SETTINGS],
    ),
    (
        "numbermap-keeps-junk",
        f"{D}/prefs/settings.ts",
        "    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;",
        "    out[k] = n as number;",
        [SETTINGS],
    ),
    (
        "migration-noop",
        f"{D}/prefs/settings.ts",
        "  if (s.regulators.library.length > 0) return false;",
        "  return false;\n  if (s.regulators.library.length > 0) return false;",
        [SETTINGS],
    ),
    (
        "migration-not-called",
        f"{D}/prefs/settings.ts",
        "    if (from < 3) {",
        "    if (from < 0) {",
        [SETTINGS],
    ),
    (
        "migration-keeps-junk-entries",
        f"{D}/prefs/settings.ts",
        "  const kept = l.regulators.filter(isRegulatorData);",
        "  const kept = l.regulators as RegulatorData[];",
        [SETTINGS],
    ),
    # ---- the frame's own bookkeeping -------------------------------------
    (
        "page-index-off-by-a-heading",
        f"{D}/editors/calculator/calc_settings.ts",
        "  wavelength: 10,",
        "  wavelength: 9,",
        [SETTINGS],
    ),
    (
        "page-from-index-constant",
        f"{D}/editors/calculator/calc_settings.ts",
        "  for (const [id, i] of Object.entries(CALC_PAGE_INDEX)) {\n    if (i === index) return id;\n  }",
        "",
        [SETTINGS],
    ),
    (
        "section-owner-missing",
        f"{D}/editors/calculator/calc_settings.ts",
        "  corrosion_table: 'panel_galvanic_corrosion',",
        "",
        [SETTINGS],
    ),
    (
        "flush-writes-with-no-panel",
        f"{D}/editors/calculator/calc_settings.ts",
        "  if (savers.size === 0) return;",
        "",
        [SETTINGS],
    ),
    (
        "unregister-noop",
        f"{D}/editors/calculator/calc_settings.ts",
        "  return () => {\n    savers.delete(box);\n  };",
        "  return () => {\n    void box;\n  };",
        [SETTINGS],
    ),
    # ---- the stripline engine --------------------------------------------
    (
        "stripline-ignores-a",
        f"{P}/transline/stripline.ts",
        "  const { widthM: w, heightM: h, thicknessM: t, offsetM: a } = phys;",
        "  const { widthM: w, heightM: h, thicknessM: t } = phys;\n  const a = (h - t) / 2.0;",
        [STRIP, HS],
    ),
    (
        "zf0-pre-2018",
        f"{P}/transline/tc_common.ts",
        "export const ZF0 = 376.730313668; // free-space wave impedance, Ω",
        "export const ZF0 = 376.730313412; // free-space wave impedance, Ω",
        [STRIP, f"{Q}/transline_kicad_qa.test.ts"],
    ),
    (
        "stripline-branch-threshold",
        f"{P}/transline/stripline.ts",
        "  if (w / hmt >= 0.35) {",
        "  if (w / hmt >= 0.3) {",
        [STRIP],
    ),
    (
        "skin-depth-two-pi",
        f"{P}/transline/tc_common.ts",
        "  return 1.0 / Math.sqrt(Math.PI * el.frequencyHz * el.murC * MU0 * el.sigma);",
        "  return 1.0 / Math.sqrt(2 * Math.PI * el.frequencyHz * el.murC * MU0 * el.sigma);",
        [STRIP],
    ),
    (
        "dielectric-loss-nepers",
        f"{P}/transline/stripline.ts",
        "    LOG2DB * len * (Math.PI / C0) * el.frequencyHz * Math.sqrt(el.epsilonR) * el.tanD;",
        "    len * (Math.PI / C0) * el.frequencyHz * Math.sqrt(el.epsilonR) * el.tanD;",
        [STRIP],
    ),
    # ---- the unit tables --------------------------------------------------
    (
        "len-micron-spelling",
        f"{D}/editors/calculator/unit_selector.ts",
        "  { label: 'um', mult: 1e-6 },",
        "  { label: 'µm', mult: 1e-6 },",
        [UNITS],
    ),
    (
        "speed-mile-corrected",
        f"{D}/editors/calculator/unit_selector.ts",
        "  { label: 'mi/h', mult: 1609.34 },",
        "  { label: 'mi/h', mult: 0.44704 },",
        [UNITS],
    ),
    (
        "ohm-per-foot-derived",
        f"{D}/editors/calculator/unit_selector.ts",
        "  { label: 'Ω/ft', mult: 3.28084 },",
        "  { label: 'Ω/ft', mult: 1 / 0.3048 },",
        [UNITS],
    ),
    (
        "time-units-five",
        f"{D}/editors/calculator/unit_selector.ts",
        "export const TIME_UNITS: UnitOpt[] = [\n  { label: 'ns', mult: 1e-9 },",
        "export const TIME_UNITS: UnitOpt[] = [\n  { label: 's', mult: 1 },\n  { label: 'ns', mult: 1e-9 },",
        [UNITS],
    ),
    (
        "unit-index-minus-one",
        f"{D}/editors/calculator/unit_selector.ts",
        "  Math.max(\n    0,\n    units.findIndex((u) => u.label === label),\n  );",
        "  units.findIndex((u) => u.label === label);",
        [UNITS],
    ),
    # ---- the art table ----------------------------------------------------
    (
        "art-att-pi-one-short",
        f"{D}/editors/calculator/art_sizes.ts",
        "  att_pi: [288, 159],",
        "  att_pi: [287, 159],",
        [ART],
    ),
    (
        "art-rounds-instead-of-ceils",
        f"{D}/editors/calculator/art_sizes.ts",
        "export const artPixels = (mm: number): number => Math.ceil((mm * CALC_ART_DPI) / 25.4);",
        "export const artPixels = (mm: number): number => Math.round((mm * CALC_ART_DPI) / 25.4);",
        [ART],
    ),
    (
        "art-entry-missing",
        f"{D}/editors/calculator/art_sizes.ts",
        "  creepage_clearance: [227, 167],",
        "",
        [ART],
    ),
]

# Which package's tsconfig covers a mutated file.
def project_for(rel: str) -> str:
    return rel.split("/", 1)[0]


def run(cmd, cwd, timeout=600):
    return subprocess.run(
        cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout
    )


def typecheck(project: str):
    return run(f"{BIN}/tsc --noEmit -p tsconfig.json", WT / project, timeout=400)


def dirty_targets() -> list[str]:
    """Files this sweep mutates that already differ from HEAD.

    Running over a dirty baseline scores every mutant against the wrong code,
    and the restore then throws the difference away. A killed run leaves
    exactly this state behind: `timeout` sends SIGTERM, which does not unwind
    the `finally`, so the last mutant stays applied.
    """
    targets = {rel for _, rel, _, _, _ in MUTANTS}
    out = run("git status --porcelain -- " + " ".join(sorted(targets)), WT).stdout
    return [l[3:] for l in out.splitlines() if l.strip()]


def main() -> int:
    wanted = set(sys.argv[1:])

    dirty = dirty_targets()
    if dirty:
        print("REFUSING: these are already modified, so the baseline is not HEAD:")
        for d in dirty:
            print("  ", d)
        print("`git checkout --` them first; a previous run was probably killed.")
        return 2

    killed, survived, build_failed, harness = [], [], [], []

    for mid, rel, old, new, tests in MUTANTS:
        if wanted and mid not in wanted:
            continue
        path = WT / rel
        before = path.read_bytes()
        text = before.decode()
        if old not in text:
            print(f"ANCHOR-MISSED  {mid}  ({rel})", flush=True)
            harness.append(mid)
            continue
        path.write_text(text.replace(old, new, 1))
        after = path.read_bytes()
        if after == before:
            print(f"NO-CHANGE      {mid}  ({rel})", flush=True)
            harness.append(mid)
            continue

        try:
            tc = typecheck(project_for(rel))
            if tc.returncode != 0:
                print(f"BUILD-FAILED   {mid}", flush=True)
                build_failed.append(mid)
                continue

            # vitest runs from `qa/`, so the specs must be relative to it.
            spec = " ".join(t[len("qa/"):] if t.startswith("qa/") else t for t in tests)
            r = run(f"{BIN}/vitest run {spec}", WT / "qa", timeout=600)
            out = r.stdout + r.stderr
            has_summary = "Test Files" in out
            if not has_summary:
                print(f"HARNESS-ERROR  {mid}  (no summary, exit {r.returncode})", flush=True)
                harness.append(mid)
            elif r.returncode != 0:
                fails = [l for l in out.splitlines() if l.strip().startswith("Tests ")]
                print(f"KILLED         {mid}  {fails[0].strip() if fails else ''}", flush=True)
                killed.append(mid)
            else:
                print(f"SURVIVED       {mid}", flush=True)
                survived.append(mid)
        finally:
            run(f"git checkout -- {rel}", WT)
            assert path.read_bytes() == before, f"restore failed for {rel}"

    print()
    print(f"killed={len(killed)} survived={len(survived)} "
          f"build_failed={len(build_failed)} harness={len(harness)}")
    if survived:
        print("SURVIVED:", ", ".join(survived))
    if build_failed:
        print("BUILD-FAILED:", ", ".join(build_failed))
    if harness:
        print("HARNESS:", ", ".join(harness))
    return 0


if __name__ == "__main__":
    # SIGTERM (what `timeout` sends) does not unwind the `finally` that
    # restores the file, so a killed sweep leaves a live mutant behind. Turn it
    # into an exception, which does.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit("terminated"))
    sys.exit(main())
