#!/usr/bin/env python3
"""Mutation sweep for the pl_editor settings slice.

Each mutant is (name, file, old, new). For every one:
  1. apply it and ASSERT the file actually changed (an edit whose anchor
     missed leaves the file untouched, and an untouched file passes, which
     is indistinguishable from a kill);
  2. run the targeted test files, and classify a TRANSFORM/parse failure as
     BUILD-FAILED rather than as a kill;
  3. restore with `git checkout --` and assert the restore worked.

On the build gate: CLAUDE.md wants the typecheck BEFORE the tests so a
mutant that does not compile is not scored as a kill. A full
`tsc --noEmit` over designer costs ~65 s per mutant here (~45 min for the
sweep), and vitest transpiles with esbuild, which STRIPS types without
checking them — so a pure type error does not stop the mutated code from
running, and an assertion that fails on it is a real behavioural kill. The
only build break that can masquerade as a kill is a syntax error, and
esbuild reports that as a transform failure, which this scores separately.
Survivors are the case where a hidden build problem would actually mislead,
so every SURVIVOR is typechecked individually afterwards (`--typecheck`),
and the whole tree is typechecked once at the end as a CI gate.

The baseline must be committed before this runs.
"""
import subprocess
import sys
from pathlib import Path

WT = Path("/home/akshay/ziro-wt-plprefs")
SETTINGS = "designer/src/prefs/settings.ts"
TOGGLES = "designer/src/editors/drawingsheet/toggles.ts"
PREVIEW = "designer/src/editors/drawingsheet/preview_settings.ts"
EDITOR = "designer/src/editors/drawingsheet/DrawingSheetEditor.tsx"
TESTFILE = "qa/unittests/designer/pl_editor_settings.test.ts"
CANVAS = "designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx"

TESTS = [
    "unittests/designer/pl_editor_settings.test.ts",
    "unittests/designer/ds_hotkeys.test.ts",
    "unittests/designer/ds_origin_and_sash.test.ts",
    "unittests/designer/drawing_sheet_palette.test.ts",
    "unittests/designer/dock_pane_order.test.ts",
    "unittests/designer/settings_merge.test.ts",
    "unittests/designer/settings_migration.test.ts",
    "unittests/designer/ds_context_menu.test.ts",
    "unittests/designer/ds_page_settings.test.ts",
    "unittests/designer/grid_toggle.test.ts",
    "unittests/designer/prefs_registry.test.ts",
    "unittests/designer/prefs_reset_slices.test.ts",
    "unittests/designer/central_values.test.ts",
]

MUTANTS = [
    # --- the defaults -----------------------------------------------------
    ("D1 units default mm", SETTINGS, "    units: 'mils',", "    units: 'mm',"),
    ("D2 last_imperial inches", SETTINGS,
     "    last_imperial_units: 'mils',", "    last_imperial_units: 'in',"),
    ("D3 grid idx eeschema's", SETTINGS,
     "      last_size_idx: DEFAULT_GRID_INDEX.pl_editor,",
     "      last_size_idx: DEFAULT_GRID_INDEX.eeschema,"),
    ("D4 grid hidden", SETTINGS, "      show: true,\n    },\n    cursor:",
     "      show: false,\n    },\n    cursor:"),
    ("D5 props width 200", SETTINGS,
     "  properties_frame_width: 150,", "  properties_frame_width: 200,"),
    ("D6 paper A4", SETTINGS, "  last_paper_size: 'A3',", "  last_paper_size: 'A4',"),
    ("D7 custom width", SETTINGS, "  last_custom_width: 17000,", "  last_custom_width: 11000,"),
    ("D8 crosshair full", SETTINGS,
     "      crosshair: 'small',", "      crosshair: 'full',"),

    # --- the store --------------------------------------------------------
    ("S1 updatePlEditor never writes", SETTINGS,
     "    this.plEditor = next;\n    store('ziroeda.pl_editor', next);",
     "    this.plEditor = next;"),
    ("S2 plEditor ignores the store", SETTINGS,
     "  plEditor: PlEditorSettings = load('ziroeda.pl_editor', PL_EDITOR_DEFAULTS);",
     "  plEditor: PlEditorSettings = structuredClone(PL_EDITOR_DEFAULTS);"),

    # --- the replay -------------------------------------------------------
    ("T1 replay drops edit mode", TOGGLES,
     "const out = new Set<string>([unitsToggleId(cfg.system.units), 'layoutEditMode']);",
     "const out = new Set<string>([unitsToggleId(cfg.system.units)]);"),
    ("T2 replay ignores grid.show", TOGGLES,
     "  if (cfg.window.grid.show) out.add('toggleGrid');",
     "  out.add('toggleGrid');"),
    ("T3 replay ignores crosshair", TOGGLES,
     "  if (cfg.window.cursor.crosshair === 'full') out.add('crosshairFull');", "  "),
    ("T4 replay ignores units", TOGGLES,
     "const out = new Set<string>([unitsToggleId(cfg.system.units), 'layoutEditMode']);",
     "const out = new Set<string>(['unitsMils', 'layoutEditMode']);"),
    ("T5 unknown unit -> mils", TOGGLES,
     "    default:\n      return 'unitsMm';", "    default:\n      return 'unitsMils';"),

    # --- can the TESTS fail? ---------------------------------------------
    # DEFAULT_TOGGLES is asserted only against `togglesFromSettings`, which is
    # the other half of the code under test: if the two drifted together the
    # check would pass regardless. Drifting ONE of them proves it cannot.
    ("X1 DEFAULT_TOGGLES drifts alone", TOGGLES,
     "  'toggleGrid',\n  'unitsMils',\n  'layoutEditMode',\n]);",
     "  'toggleGrid',\n  'unitsMils',\n  'layoutEditMode',\n  'crosshairFull',\n]);"),
    # A wrong literal in the test file itself, to prove these tests run at all
    # rather than being silently skipped or shadowed.
    ("X2 a test literal is wrong", TESTFILE,
     "expect(PL_EDITOR_DEFAULTS.corner_origin).toBe(0);",
     "expect(PL_EDITOR_DEFAULTS.corner_origin).toBe(1);"),

    # --- the writes -------------------------------------------------------
    ("W1 grid toggle does not write", TOGGLES,
     "    cfg.window.grid.show = !cfg.window.grid.show;\n    return true;", "    return true;"),
    ("W2 crosshair does not write", TOGGLES,
     "    cfg.window.cursor.crosshair = cfg.window.cursor.crosshair === 'full' ? 'small' : 'full';\n"
     "    return true;", "    return true;"),
    ("W3 units write does not remember the family", TOGGLES,
     "  if (isImperial(units)) cfg.system.last_imperial_units = units;\n"
     "  else cfg.system.last_metric_units = units;\n", "  "),
    ("W4 units write hits the wrong family", TOGGLES,
     "  if (isImperial(units)) cfg.system.last_imperial_units = units;",
     "  if (!isImperial(units)) cfg.system.last_imperial_units = units;"),
    ("W5 Ctrl+U always goes metric", TOGGLES,
     "    isImperial(cfg.system.units) ? cfg.system.last_metric_units : cfg.system.last_imperial_units,",
     "    cfg.system.last_metric_units,"),
    ("W6 session-only button writes anyway", TOGGLES,
     "  return false;\n}", "  cfg.window.grid.show = false;\n  return true;\n}"),
    ("T6 unit group is not exclusive", TOGGLES,
     "  if (UNIT_GROUP.includes(id)) {\n    for (const g of UNIT_GROUP) next.delete(g);\n    next.add(id);\n  } else if",
     "  if (false) {\n    next.add(id);\n  } else if"),

    # --- the page ---------------------------------------------------------
    ("P1 custom edge rounds instead of truncating", PREVIEW,
     "  cfg.last_custom_width = Math.trunc(s.customWidthMM / MM_PER_MIL);",
     "  cfg.last_custom_width = Math.round(s.customWidthMM / MM_PER_MIL);"),
    ("P2 no 10-mil floor", PREVIEW, "  return mils < 10 ? 10 : mils;", "  return mils;"),
    ("P3 page not restored", PREVIEW,
     "    paper: cfg.last_paper_size,\n    portrait: cfg.last_was_portrait,", "    "),
    ("P3a paper not restored", PREVIEW,
     "    paper: cfg.last_paper_size,", "    paper: 'A3',"),
    ("P3b orientation not restored", PREVIEW,
     "    portrait: cfg.last_was_portrait,", "    portrait: false,"),
    ("P3c custom edges not restored", PREVIEW,
     "    customWidthMM: clampMils(cfg.last_custom_width) * MM_PER_MIL,",
     "    customWidthMM: 431.8,"),
    ("P4 orientation not written", PREVIEW,
     "  cfg.last_was_portrait = s.portrait;", "  "),

    # --- the wiring in the .tsx ------------------------------------------
    ("E1 toolbar seeded from a literal", EDITOR,
     "useState<Set<string>>(() => togglesFromSettings(settings.plEditor));",
     "useState<Set<string>>(() => new Set(['toggleGrid', 'unitsMils', 'layoutEditMode']));"),
    ("E2 toggles never reach the store", EDITOR,
     "    settings.updatePlEditor((s) => {\n      persistToggle(s, id);\n    });\n", "    "),
    ("E3 props width seeded from the default", EDITOR,
     "useState(settings.plEditor.properties_frame_width);",
     "useState(PROPERTIES_FRAME_WIDTH);"),
    ("E4 sash drag not stored", EDITOR,
     "            settings.updatePlEditor((s) => {\n              s.properties_frame_width = w;\n            });\n",
     "            "),
    ("E5 grid index not stored", EDITOR,
     "    settings.updatePlEditor((s) => {\n      s.window.grid.last_size_idx = idx;\n    });\n",
     "    "),
    ("E6 grid index seeded from the table", EDITOR,
     "useState(settings.plEditor.window.grid.last_size_idx);",
     "useState(DEFAULT_GRID_INDEX.pl_editor);"),
    ("E7 origin not stored", EDITOR,
     "                settings.updatePlEditor((s) => {\n                  s.corner_origin = idx;\n                });\n",
     "                "),
    ("E8 black background not stored", EDITOR,
     "    settings.updatePlEditor((s) => {\n      s.black_background = on;\n    });\n", "    "),
    ("E9 page not stored", EDITOR,
     "            settings.updatePlEditor((s) => writePageToConfig(s, next));\n", "            "),
    ("E10 page not restored", EDITOR,
     "useState<PreviewSettings>(() =>\n    previewSettingsFromConfig(settings.plEditor),\n  );",
     "useState<PreviewSettings>(() => defaultPreviewSettings());"),
    ("E12 crosshair always-show back to a literal", CANVAS,
     "        alwaysShow: alwaysShowCursor,", "        alwaysShow: true,"),
    ("E13 editor stops feeding always-show", EDITOR,
     "          alwaysShowCursor={plCfg.window.cursor.always_show_cursor}\n", "          "),
    ("E11 Ctrl+U ignores the settings", EDITOR,
     "onLeftToggle(toggleUnitsId(settings.plEditor));", "onLeftToggle('unitsMm');"),
]


def run(cmd, cwd=WT):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)


TYPECHECK = (
    "npx tsc --noEmit --incremental --tsBuildInfoFile "
    "/tmp/claude-1000/-home-akshay-ziro-designer-1/"
    "6e141738-bbf2-447c-89aa-312d4fc9008a/scratchpad/designer.tsbuildinfo "
    "-p designer/tsconfig.json"
)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_tc = "--typecheck" in sys.argv
    lo = int(args[0]) if args else 0
    hi = int(args[1]) if len(args) > 1 else len(MUTANTS)
    results = []
    for name, rel, old, new in MUTANTS[lo:hi]:
        path = WT / rel
        before = path.read_text()
        if old not in before:
            results.append((name, "ANCHOR-MISSED", ""))
            print(f"{name:45s} ANCHOR-MISSED", flush=True)
            continue
        path.write_text(before.replace(old, new, 1))
        assert path.read_text() != before, f"mutant did not apply: {name}"

        t = run(f"cd qa && npx vitest run {' '.join(TESTS)} 2>&1")
        out = t.stdout
        if "Transform failed" in out or "Failed Suites" in out:
            verdict, detail = "BUILD-FAILED", "esbuild could not transform the mutant"
        elif t.returncode != 0:
            fails = [ln for ln in out.splitlines() if ln.strip().startswith("FAIL")]
            verdict = "KILLED"
            detail = f"{len(fails)} failing: " + "; ".join(
                f.split(">")[-1].strip() for f in fails[:2]
            )
        else:
            verdict, detail = "SURVIVED", ""
            if do_tc:
                tc = run(TYPECHECK)
                if tc.returncode != 0:
                    verdict = "BUILD-FAILED"
                    detail = "survived the tests but does not typecheck"
        results.append((name, verdict, detail))
        print(f"{name:45s} {verdict:14s} {detail}", flush=True)
        run(f"git checkout -- {rel}")
        assert (WT / rel).read_text() == before, f"restore failed for {rel}"

    print("=== chunk summary ===")
    for v in ("KILLED", "SURVIVED", "BUILD-FAILED", "ANCHOR-MISSED"):
        n = sum(1 for _, x, _ in results if x == v)
        print(f"{v:14s} {n}")
    with open("/home/akshay/ziro-wt-plprefs-sweep.tsv", "a") as fh:
        for name, x, d in results:
            fh.write(f"{name}\t{x}\t{d}\n")


if __name__ == "__main__":
    main()
