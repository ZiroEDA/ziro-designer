#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
"""Mutation sweep for the shared Properties panel (PROPERTIES_PANEL).

Each mutant breaks ONE rule the tests claim to pin, then the matching tests are
run and expected to fail. Three things this harness insists on, each of which
has produced a false "killed" here before:

  * the edit must actually APPLY. An anchor that missed leaves the file
    untouched, and an untouched file passes - indistinguishable from a kill.
    Every mutant asserts the file content changed.
  * a mutant that does not COMPILE is a build failure, not a kill, and is
    scored separately.
  * the baseline must be committed, because restoring is `git checkout --`.

Run from the repo root:  python3 qa/probes/props_panel_mutants.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

WIDGET = "designer/src/widgets/properties_panel.tsx"
CSS = "designer/src/widgets/properties_panel.css"
DATA = "eeschema/src/tools/sch_properties_panel.ts"

WIDGET_TEST = "unittests/designer/properties_panel_widget.test.tsx"
DATA_TEST = "unittests/eeschema/props_panel_symbol.test.ts"

# (name, file, old, new, test file, package to typecheck or None)
MUTANTS = [
    # ---- the widget -------------------------------------------------------
    (
        "caption element removed",
        WIDGET,
        '      <div className="ze-pgrid-caption">{propertiesPanelCaption(selectionCount, friendlyName)}</div>\n',
        "",
        WIDGET_TEST,
        "designer",
    ),
    (
        "caption drops the friendly name for a single selection",
        WIDGET,
        "if (count === 1) return friendlyName ?? '';",
        "if (count === 1) return '';",
        WIDGET_TEST,
        "designer",
    ),
    (
        "unnamed group captioned something else",
        WIDGET,
        "export const UNSPECIFIED_GROUP_CAPTION = 'Basic Properties';",
        "export const UNSPECIFIED_GROUP_CAPTION = 'Properties';",
        WIDGET_TEST,
        "designer",
    ),
    (
        "groups sorted alphabetically instead of in display order",
        WIDGET,
        "  return groups;\n}",
        "  return groups.sort((a, b) => (a.title < b.title ? -1 : 1));\n}",
        WIDGET_TEST,
        "designer",
    ),
    (
        "choice cell renders its combo permanently",
        WIDGET,
        "  if (!editing)\n    return (\n      <span className=\"ze-pgrid-text\" title={display} onClick",
        "  if (!editing && row.kind !== 'choice')\n    return (\n      <span className=\"ze-pgrid-text\" title={display} onClick",
        WIDGET_TEST,
        "designer",
    ),
    (
        "text cell renders its editor permanently",
        WIDGET,
        "  if (!editing)\n    return (\n      <span className=\"ze-pgrid-text\" title={display} onClick",
        "  if (!editing && row.kind === 'choice')\n    return (\n      <span className=\"ze-pgrid-text\" title={display} onClick",
        WIDGET_TEST,
        "designer",
    ),
    (
        "every row marked read-only",
        WIDGET,
        "data-readonly={r.set ? undefined : ''}",
        "data-readonly={''}",
        WIDGET_TEST,
        "designer",
    ),
    (
        "no row marked read-only",
        WIDGET,
        "data-readonly={r.set ? undefined : ''}",
        "data-readonly={undefined}",
        WIDGET_TEST,
        "designer",
    ),
    (
        "collapsing one category collapses all of them",
        WIDGET,
        "const open = !collapsed.includes(g.title);",
        "const open = collapsed.length === 0;",
        WIDGET_TEST,
        "designer",
    ),
    (
        "a read-only bool row drops its checkbox instead of disabling it",
        WIDGET,
        "  if (row.kind === 'bool') {",
        "  if (row.kind === 'bool' && row.set) {",
        WIDGET_TEST,
        "designer",
    ),
    # ---- the stylesheet ---------------------------------------------------
    (
        "row pitch off by one",
        CSS,
        "--pgrid-row-height: 25px;",
        "--pgrid-row-height: 24px;",
        WIDGET_TEST,
        None,
    ),
    (
        "margin gutter off",
        CSS,
        "--pgrid-margin-width: 15px;",
        "--pgrid-margin-width: 12px;",
        WIDGET_TEST,
        None,
    ),
    (
        "value text inset off",
        CSS,
        "--pgrid-text-inset: 5px;",
        "--pgrid-text-inset: 4px;",
        WIDGET_TEST,
        None,
    ),
    (
        "splitter no longer centred",
        CSS,
        "--pgrid-splitter: 50%;",
        "--pgrid-splitter: 45%;",
        WIDGET_TEST,
        None,
    ),
    (
        "grey read-only text restated as a literal",
        CSS,
        ".ze-pgrid-row[data-readonly] .ze-pgrid-value {\n  color: var(--ctl-fg-disabled);\n}",
        ".ze-pgrid-row[data-readonly] .ze-pgrid-value {\n  color: #929292;\n}",
        WIDGET_TEST,
        None,
    ),
    (
        "value cell boxed again",
        CSS,
        "  border-left: 1px solid var(--content-bg);\n  overflow: hidden;\n}",
        "  border: 1px solid var(--ctl-border);\n  overflow: hidden;\n}",
        WIDGET_TEST,
        None,
    ),
    (
        "grid restates a font size",
        CSS,
        ".ze-pgrid-text {\n  overflow: hidden;",
        ".ze-pgrid-text {\n  font-size: 12px;\n  overflow: hidden;",
        WIDGET_TEST,
        None,
    ),
    # ---- the rows eeschema supplies ---------------------------------------
    (
        '"Locked" row back',
        DATA,
        "  rows.push(\n    ...positionRows(id, s.at),",
        "  rows.push(\n    { group: '', name: 'Locked', kind: 'bool', value: !!s.locked },\n    ...positionRows(id, s.at),",
        DATA_TEST,
        "eeschema",
    ),
    (
        "pin flags after the position rows instead of before",
        DATA,
        "  const rows: PropRow[] = [];",
        "  const rows: PropRow[] = [...positionRows(id, s.at)];",
        DATA_TEST,
        "eeschema",
    ),
    (
        "symbol fields listed in file order, not alphabetically",
        DATA,
        "for (const f of [...s.fields].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {",
        "for (const f of s.fields) {",
        DATA_TEST,
        "eeschema",
    ),
    (
        "Library Link made writeable",
        DATA,
        "{ group: 'Fields', name: 'Library Link', kind: 'string', value: s.libId },",
        "{ group: 'Fields', name: 'Library Link', kind: 'string', value: s.libId, set: () => null },",
        DATA_TEST,
        "eeschema",
    ),
    (
        "both pin flags read the same lib field",
        DATA,
        "        value: !lib.pinNamesHidden,",
        "        value: !lib.pinNumbersHidden,",
        DATA_TEST,
        "eeschema",
    ),
    (
        "pin flag written onto the placement instead of lib_symbols",
        DATA,
        "      libSymbols: doc.libSymbols.map((l) => (l.libId === libId ? { ...l, [which]: hidden } : l)),",
        "      symbols: doc.symbols.map((s) => ({ ...s, dnp: hidden })),",
        DATA_TEST,
        "eeschema",
    ),
    (
        "pin flags shown even with no cached definition",
        DATA,
        "  if (lib) {\n    rows.push(\n      {\n        group: '',\n        name: 'Pin numbers',\n        kind: 'bool',\n        value: !lib.pinNumbersHidden,\n        set: (v) => setPinTextHidden(libName, 'pinNumbersHidden', !v),\n      },\n      {\n        group: '',\n        name: 'Pin names',\n        kind: 'bool',\n        value: !lib.pinNamesHidden,",
        "  if (true) {\n    rows.push(\n      {\n        group: '',\n        name: 'Pin numbers',\n        kind: 'bool',\n        value: !lib?.pinNumbersHidden,\n        set: (v) => setPinTextHidden(libName, 'pinNumbersHidden', !v),\n      },\n      {\n        group: '',\n        name: 'Pin names',\n        kind: 'bool',\n        value: !lib?.pinNamesHidden,",
        DATA_TEST,
        "eeschema",
    ),
    (
        '"Exclude From Position Files" dropped again',
        DATA,
        "      name: 'Exclude From Position Files',",
        "      name: 'Exclude From Pos Files',",
        DATA_TEST,
        "eeschema",
    ),
    (
        "a wire captioned like a graphic line",
        DATA,
        "return kind === 'wire' ? 'Wire' : kind === 'bus' ? 'Bus' : 'Graphic Line';",
        "return kind === 'bus' ? 'Bus' : 'Graphic Line';",
        DATA_TEST,
        "eeschema",
    ),
    (
        "a no-connect captioned by its class name",
        DATA,
        "      return 'No-Connect Flag';",
        "      return 'No Connect';",
        DATA_TEST,
        "eeschema",
    ),
]


def run(cmd, cwd=ROOT):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)


def restore(rel):
    run(f"git checkout -- {rel}")


SCOPED_TSCONFIG_NAME = "tsconfig.propgrid-mutant.json"
SCOPED_TSCONFIG = """{
  "extends": "./tsconfig.json",
  "include": ["src/widgets/properties_panel.tsx", "src/vite-env.d.ts"]
}
"""


def main() -> int:
    killed, survived, build_failed, not_applied = [], [], [], []
    scoped = ROOT / "designer" / SCOPED_TSCONFIG_NAME
    scoped.write_text(SCOPED_TSCONFIG)

    for name, rel, old, new, test, pkg in MUTANTS:
        path = ROOT / rel
        before = path.read_text()
        if old not in before:
            not_applied.append((name, "anchor not found"))
            continue
        after = before.replace(old, new, 1)
        if after == before:
            not_applied.append((name, "replacement is a no-op"))
            continue
        path.write_text(after)
        try:
            if path.read_text() == before:
                not_applied.append((name, "file unchanged on disk"))
                continue
            if pkg == "designer":
                # A scoped project: properties_panel.tsx imports only React and
                # its own stylesheet, so this typechecks the mutated file under
                # designer's own strict settings in 15s rather than the ~5min a
                # whole-package run costs on a loaded box.
                tc = run("npx tsc --noEmit -p " + SCOPED_TSCONFIG_NAME, cwd=ROOT / "designer")
                if tc.returncode != 0:
                    build_failed.append((name, tc.stdout.strip().splitlines()[:3]))
                    continue
            elif pkg:
                tc = run("npx tsc --noEmit", cwd=ROOT / pkg)
                if tc.returncode != 0:
                    build_failed.append((name, tc.stdout.strip().splitlines()[:3]))
                    continue
            r = run(f"npx vitest run {test}", cwd=ROOT / "qa")
            (killed if r.returncode != 0 else survived).append(name)
            print(("KILLED   " if r.returncode != 0 else "SURVIVED ") + name, flush=True)
        finally:
            restore(rel)

    scoped.unlink(missing_ok=True)

    print()
    print(f"killed        {len(killed)}")
    print(f"survived      {len(survived)}")
    for n in survived:
        print("   ", n)
    print(f"build failed  {len(build_failed)}")
    for n, out in build_failed:
        print("   ", n, out)
    print(f"not applied   {len(not_applied)}")
    for n, why in not_applied:
        print("   ", n, "-", why)
    return 1 if (survived or build_failed or not_applied) else 0


if __name__ == "__main__":
    sys.exit(main())
