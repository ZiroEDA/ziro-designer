#!/usr/bin/env python3
"""Mutation sweep for the DIALOG_SHIM control-state port.

Each mutant is applied by exact string replacement, the file is asserted to
have actually changed (an anchor that missed leaves the file untouched, and an
untouched file passes - indistinguishable from a kill), the package is
typechecked so a mutant that does not compile is scored as a BUILD FAILURE
rather than a kill, and only then are the tests run. `git checkout --` restores
against the committed baseline.
"""

import subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
DCS = "designer/src/ui/dialog_control_state.ts"
HOOK = "designer/src/ui/useDialogControl.ts"
SET = "designer/src/prefs/settings.ts"
CHOOSER = "designer/src/editors/schematic/dialogs/dialog_symbol_chooser.tsx"
TEST = "unittests/designer/dialog_control_state.test.tsx"

MUTANTS = [
    ("key: no strip at all", DCS,
     "const parenPos = title.lastIndexOf('(');",
     "const parenPos = title.lastIndexOf('\\u0000');"),
    ("key: first bracket instead of last", DCS,
     "const parenPos = title.lastIndexOf('(');",
     "const parenPos = title.indexOf('(');"),
    ("key: allow a leading bracket to empty the key", DCS,
     "if (parenPos > 0) {", "if (parenPos >= 0) {"),
    ("key: keep the space before the bracket", DCS,
     "while (end > 0 && title[end - 1] === ' ') end--;", "// trim removed"),
    ("restore: no type check", DCS,
     "return typeof stored === typeof fallback ? (stored as T) : fallback;",
     "return (stored ?? fallback) as T;"),
    ("restore: never restore", DCS,
     "return typeof stored === typeof fallback ? (stored as T) : fallback;",
     "return fallback;"),
    ("hook: one dialog key for everything", HOOK,
     "dialogKeyFromTitle(dialogTitle), controlKey), defaultValue),",
     "'dlg', controlKey), defaultValue),"),
    ("hook: one control key for everything", HOOK,
     "saveDialogControl(dialogKeyFromTitle(saved.dialogTitle), saved.controlKey, saved.value);",
     "saveDialogControl(dialogKeyFromTitle(saved.dialogTitle), 'ctrl', saved.value);"),
    ("hook: save on every change, not on close", HOOK,
     "    latest.current = { dialogTitle, controlKey, value };\n  });",
     "    latest.current = { dialogTitle, controlKey, value };\n"
     "    if (dialogTitle !== null)\n"
     "      saveDialogControl(dialogKeyFromTitle(dialogTitle), controlKey, value);\n  });"),
    ("hook: save the default, not what the user chose", HOOK,
     "saved.controlKey, saved.value);", "saved.controlKey, defaultValue);"),
    ("OptOut: an opted-out dialog still writes", HOOK,
     "      if (saved.dialogTitle === null) return;\n"
     "      saveDialogControl(dialogKeyFromTitle(saved.dialogTitle), saved.controlKey, saved.value);",
     "      saveDialogControl(\n"
     "        dialogKeyFromTitle(saved.dialogTitle ?? 'Choose Symbol'),\n"
     "        saved.controlKey,\n        saved.value,\n      );"),
    ("OptOut: an opted-out dialog still reads", HOOK,
     "    dialogTitle === null\n      ? defaultValue\n"
     "      : restoredValue(loadDialogControl(dialogKeyFromTitle(dialogTitle), controlKey), defaultValue),",
     "    restoredValue(\n"
     "      loadDialogControl(dialogKeyFromTitle(dialogTitle ?? 'Choose Symbol'), controlKey),\n"
     "      defaultValue,\n    ),"),
    ("store: no top-level shape check", SET,
     "if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};\n"
     "  const out: DialogControls = {};",
     "if (parsed === undefined) return {};\n  const out: DialogControls = {};"),
    ("store: no per-dialog shape check", SET,
     "if (typeof dlgVal !== 'object' || dlgVal === null || Array.isArray(dlgVal)) continue;",
     "if (dlgVal === undefined) continue;"),
    ("store: no leaf scalar check", SET,
     "      if (\n        typeof ctrlVal === 'boolean' ||\n        typeof ctrlVal === 'number' ||\n"
     "        typeof ctrlVal === 'string'\n      )\n        controls[ctrlKey] = ctrlVal;",
     "      controls[ctrlKey] = ctrlVal as DialogControlValue;"),
    ("store: mergeCommon does not repair the free-form subtree", SET,
     "out.dialog = { controls: normalizeDialogControls(dialog?.controls) };",
     "void dialog;"),
    ("store: the loader goes back through deepMerge", SET,
     "common: CommonSettings = loadFreeForm(sliceStorageKey('common'), mergeCommon);",
     "common: CommonSettings = load(sliceStorageKey('common'), COMMON_DEFAULTS);"),
    ("store: the account pull goes back through deepMerge", SET,
     "      m.common = mergeCommon(v);",
     "      m.common = deepMerge(structuredClone(COMMON_DEFAULTS), v);"),
    ("store: re-store an unchanged value", SET,
     "if (this.common.dialog.controls[dialogKey]?.[controlKey] === value) return;",
     "// early return removed"),
    ("chooser: wrong default for Place repeated copies", CHOOSER,
     "useDialogControl(title, 'keepSymbol', false)",
     "useDialogControl(title, 'keepSymbol', true)"),
    ("chooser: back to plain useState, the old calls left as comments", CHOOSER,
     "  const [keepSymbol, setKeepSymbol] = useDialogControl(title, 'keepSymbol', false);\n"
     "  const [placeAllUnits, setPlaceAllUnits] = useDialogControl(title, 'placeAllUnits', true);",
     "  // const [keepSymbol, setKeepSymbol] = useDialogControl(title, 'keepSymbol', false);\n"
     "  // const [placeAllUnits, setPlaceAllUnits] = useDialogControl(title, 'placeAllUnits', true);\n"
     "  const [keepSymbol, setKeepSymbol] = useState(false);\n"
     "  const [placeAllUnits, setPlaceAllUnits] = useState(true);"),
]


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)


def main():
    results = []
    for name, rel, old, new in MUTANTS:
        path = ROOT / rel
        before = path.read_text()
        if old not in before:
            results.append((name, "ANCHOR MISSED"))
            continue
        path.write_text(before.replace(old, new, 1))
        assert path.read_text() != before, name

        tc = run("npx tsc --noEmit", ROOT / "designer")
        if tc.returncode != 0:
            results.append((name, "BUILD FAILURE: " + tc.stdout.strip().splitlines()[0][:90]))
        else:
            t = run(f"npx vitest run {TEST} 2>&1", ROOT / "qa")
            killed = "failed" in t.stdout
            results.append((name, "killed" if killed else "SURVIVED"))
        run(f"git checkout -- {rel}", ROOT)
        assert path.read_text() == before, f"restore failed for {name}"

    for name, r in results:
        print(f"{r:<12} {name}")
    print(f"\n{sum(1 for _, r in results if r == 'killed')}/{len(results)} killed")


if __name__ == "__main__":
    main()
