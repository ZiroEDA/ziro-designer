#!/usr/bin/env python3
"""Mutation sweep for the Footprint Editor parity branch.

Each entry is (id, file, old, new, note). For every mutant the script:

  1. asserts the anchor is present EXACTLY once and that the file's bytes
     actually changed after the edit -- an edit whose anchor missed leaves the
     file untouched, and an untouched file passes, which is indistinguishable
     from a kill;
  2. typechecks BEFORE running the tests, and scores a mutant that does not
     compile as BUILD-FAILED rather than as killed;
  3. runs the four footprint test files and scores KILLED / SURVIVED;
  4. restores with `git checkout --`, which is safe only because the baseline
     is committed.
"""

import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/akshay/ziro-wt-fpedit")
MENUBAR = "designer/src/editors/footprint/menubar.ts"
APPEAR = "designer/src/widgets/appearance_layers.ts"
BOARD = "designer/src/editors/footprint/footprintBoard.ts"
TOOLBARS = "designer/src/editors/footprint/footprintToolbars.ts"
STATUS = "designer/src/ui/status_format.ts"
CTX = "designer/src/editors/footprint/tree_context_menu.ts"

TESTS = [
    "unittests/designer/fp_menu_conditions.test.ts",
    "unittests/designer/fp_appearance_and_status.test.ts",
    "unittests/designer/fp_tree_context_menu.test.ts",
    "unittests/designer/symfp_menubar.test.ts",
]

MUTANTS = [
    # ---- menu enable/disable conditions -------------------------------------
    ("M1  save gated again", MENUBAR,
     "act('Save', 'save', { shortcut: 'Ctrl+S' }),",
     "act('Save', 'save', { shortcut: 'Ctrl+S', disabled: !conds.contentModified }),"),
    ("M2  undo always live", MENUBAR,
     "act('Undo', 'undo', { shortcut: 'Ctrl+Z', disabled: !conds.undoAvailable }),",
     "act('Undo', 'undo', { shortcut: 'Ctrl+Z' }),"),
    ("M3  redo reads the undo stack", MENUBAR,
     "act('Redo', 'redo', { shortcut: 'Ctrl+Y', disabled: !conds.redoAvailable }),",
     "act('Redo', 'redo', { shortcut: 'Ctrl+Y', disabled: !conds.undoAvailable }),"),
    ("M4  delete back on the selection", MENUBAR,
     "act('Delete', 'doDelete', { shortcut: 'Delete', disabled: !conds.hasItems }),",
     "act('Delete', 'doDelete', { shortcut: 'Delete', disabled: !conds.footprintSelectedInTree }),"),
    ("M5  export back on the tree target", MENUBAR,
     "act('Footprint...', 'exportFootprint', { disabled: !conds.haveFootprint }),",
     "act('Footprint...', 'exportFootprint', { disabled: !conds.targetFootprint }),"),
    ("M6  fp properties loses its tree branch", MENUBAR,
     "disabled: !(conds.footprintSelectedInTree || conds.haveFootprint),",
     "disabled: !conds.haveFootprint,"),
    ("M7  revert dead again", MENUBAR,
     "act('Revert', 'revert', { disabled: !conds.contentModified }),",
     "stub('Revert', 'revert'),"),

    # ---- the shared non_cu_seq table ----------------------------------------
    ("M8  paste layers swapped", APPEAR,
     "  ['F.Paste', \"Solder paste on board's front\"],\n  ['B.Paste', \"Solder paste on board's back\"],",
     "  ['B.Paste', \"Solder paste on board's back\"],\n  ['F.Paste', \"Solder paste on board's front\"],"),
    ("M9  unknown layers dropped", APPEAR,
     "  return [...rows, ...aEnabled.filter((n) => !placed.has(n))];",
     "  return rows;"),
    ("M10 user layers stop at 30", APPEAR,
     "export const USER_DEFINED_LAYER_COUNT = 45;",
     "export const USER_DEFINED_LAYER_COUNT = 30;"),
    ("M11 courtyard tooltip reworded", APPEAR,
     "  ['Edge.Cuts', \"Board's perimeter definition\"],",
     "  ['Edge.Cuts', 'Board outline'],"),

    # ---- the frame's enabled layers -----------------------------------------
    ("M12 In1.Cu loses its board name", BOARD,
     "  { id: 4, name: 'In1.Cu', kind: 'signal', userName: 'Inner layers' },",
     "  { id: 4, name: 'In1.Cu', kind: 'signal' },"),
    ("M13 User.4 dropped", BOARD,
     "  { id: 45, name: 'User.4', kind: 'user' },\n];",
     "];"),
    ("M14 opens on copper again", BOARD,
     "export const FP_DEFAULT_ACTIVE_LAYER = 'F.SilkS';",
     "export const FP_DEFAULT_ACTIVE_LAYER = 'F.Cu';"),
    ("M15 copper stack back to front", BOARD,
     "export const FOOTPRINT_COPPER_STACK: readonly string[] = [\n  'F.Cu',",
     "export const FOOTPRINT_COPPER_STACK: readonly string[] = [\n  'B.Cu',"),

    # ---- toolbar defaults and the tool message ------------------------------
    ("M16 line mode back to 90", TOOLBARS,
     "  'lineMode45',", "  'lineMode90',"),
    ("M17 tool message ignores the stack", TOOLBARS,
     "  if (!aArmed) return '';", "  if (!aArmed) return FP_TOOL_FRIENDLY_NAMES[aActiveTool] ?? '';"),
    ("M18 selectSetRect takes its tooltip", TOOLBARS,
     "  selectSetRect: 'Rectangle',", "  selectSetRect: 'Select items',"),

    # ---- the constraints pane -----------------------------------------------
    ("M19 45 mode prints the 90 string", STATUS,
     "      return 'Constrain to H, V, 45';", "      return 'Constrain to H, V';"),
    ("M20 lineMode45 falls through to direct", STATUS,
     "  if (toggles.has('lineMode45')) return 'deg45';", ""),

    # ---- the tree context menu ----------------------------------------------
    ("M21 New Footprint on the loose condition", CTX,
     "row(h, 'New Footprint', 'newFootprint', libSelected, 10),",
     "row(h, 'New Footprint', 'newFootprint', libInferred, 10),"),
    ("M22 Export asks the tree, not the board", CTX,
     "row(h, 'Export Current Footprint...', 'exportFootprint', conds.haveFootprint, 100),",
     "row(h, 'Export Current Footprint...', 'exportFootprint', fpSelected, 100),"),
    ("M23 the order-400 separator goes", CTX,
     "    menuSeparator(400),\n", ""),
    ("M24 Rename claims to be implemented", CTX,
     "  'renameFootprint',\n]);", "]);"),
    ("M25 Delete row renamed", CTX,
     "row(h, 'Delete Footprint from Library', 'deleteFootprint', fpSelected, 10),",
     "row(h, 'Delete Footprint', 'deleteFootprint', fpSelected, 10),"),
]


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)


def restore():
    run("git checkout -- designer qa", ROOT)


def main():
    results = []
    for mid, rel, old, new in [(m[0], m[1], m[2], m[3]) for m in MUTANTS]:
        path = ROOT / rel
        before = path.read_text()
        n = before.count(old)
        if n != 1:
            results.append((mid, f"ANCHOR x{n} - NOT APPLIED"))
            print(f"{mid}: anchor found {n} times, skipped", flush=True)
            continue
        path.write_text(before.replace(old, new))
        after = path.read_text()
        if after == before:
            results.append((mid, "UNCHANGED - NOT APPLIED"))
            restore()
            continue

        tc = run("pnpm -C designer typecheck", ROOT)
        if tc.returncode != 0:
            results.append((mid, "BUILD-FAILED"))
            print(f"{mid}: BUILD-FAILED", flush=True)
            restore()
            continue

        t = run("npx vitest run " + " ".join(TESTS), ROOT / "qa")
        verdict = "KILLED" if t.returncode != 0 else "SURVIVED"
        results.append((mid, verdict))
        print(f"{mid}: {verdict}", flush=True)
        restore()

    print("\n=== MUTATION TABLE ===")
    for mid, v in results:
        print(f"{v:<24} {mid}")
    survived = [m for m, v in results if v not in ("KILLED",)]
    print(f"\nkilled {sum(1 for _, v in results if v == 'KILLED')}/{len(results)}")
    if survived:
        print("not killed: " + ", ".join(survived))
    return 0


if __name__ == "__main__":
    sys.exit(main())
