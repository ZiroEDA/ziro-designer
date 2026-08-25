#!/usr/bin/env python3
"""Mutation sweep for DIALOG_PAGES_SETTINGS.

Each mutant is applied by exact string replacement, and the sweep REFUSES to
score one whose anchor did not match or whose occurrence count is not what it
expected: an edit that silently did nothing leaves the file untouched, and an
untouched file passes its tests, which is indistinguishable from a kill.

Every mutant is TYPECHECKED before its tests run. A mutant that does not compile
is a build failure, not a survivor, and is scored in its own column.

"No parseable vitest summary" is a HARNESS ERROR, never a survival: the process
exit code is read alongside the summary and the two must agree.

Restores are `git checkout --` against a COMMITTED baseline; the sweep aborts if
the working tree is dirty, because a restore over an uncommitted feature is how
one gets reverted.

    python3 qa/probes/page_settings_mutants.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL = "designer/src/dialogs/page_settings_model.ts"
DIALOG = "designer/src/dialogs/dialog_page_settings.tsx"

SUITE = "unittests/designer/page_settings_dialog.test.ts"
DS_SUITE = "unittests/designer/ds_page_settings.test.ts"
FONT_SUITE = "unittests/designer/ui_font_tokens.test.ts"
CV_SUITE = "unittests/designer/central_values.test.ts"


@dataclass
class Mutant:
    name: str
    path: str
    old: str
    new: str
    tests: list[str]
    #: how many times `old` must appear in the pristine file
    occurrences: int = 1
    why: str = ""
    typecheck: list[str] = field(default_factory=lambda: ["designer"])


MUTANTS: list[Mutant] = [
    Mutant(
        "max-page-size-per-frame",
        MODEL,
        "return frame === 'pcbnew' ? MAX_PAGE_SIZE_PCBNEW_MILS : MAX_PAGE_SIZE_EESCHEMA_MILS;",
        "return frame === 'eeschema' ? MAX_PAGE_SIZE_PCBNEW_MILS : MAX_PAGE_SIZE_EESCHEMA_MILS;",
        [SUITE],
        why="board_editor_control.cpp:531 is the only caller passing PCBNEW's",
    ),
    Mutant(
        "min-page-size",
        MODEL,
        "export const MIN_PAGE_SIZE_MILS = 1000;",
        "export const MIN_PAGE_SIZE_MILS = 100;",
        [SUITE],
        why="include/page_info.h:34",
    ),
    Mutant(
        "wks-picker-enabled",
        MODEL,
        "return frame !== 'pl_editor';",
        "return true;",
        [SUITE],
        why="EnableWksFileNamePicker( false ), pl_editor_control.cpp:98",
    ),
    Mutant(
        "exports-eeschema-only",
        MODEL,
        "export function showsExportCheckboxes(frame: PageSettingsFrame): boolean {\n  return frame === 'eeschema';\n}",
        "export function showsExportCheckboxes(frame: PageSettingsFrame): boolean {\n  return frame !== 'pl_editor';\n}",
        [SUITE],
        why="dialog_page_settings.cpp:172-185 vs dialog_eeschema_page_settings.cpp:89-102",
    ),
    Mutant(
        "tallies-eeschema-only",
        MODEL,
        "export function showsSheetTallies(frame: PageSettingsFrame): boolean {\n  return frame === 'eeschema';\n}",
        "export function showsSheetTallies(frame: PageSettingsFrame): boolean {\n  return true;\n}",
        [SUITE],
        why="dialog_page_settings.cpp:170-171",
    ),
    Mutant(
        "pl-editor-labels",
        MODEL,
        "        paper: 'Preview Paper',",
        "        paper: 'Paper',",
        [DS_SUITE],
        why="dialog_page_settings.cpp:86",
    ),
    Mutant(
        "other-frames-labels",
        MODEL,
        ": { title: 'Page Settings', paper: 'Paper', titleBlock: 'Title Block' };",
        ": { title: 'Page Settings', paper: 'Paper', titleBlock: 'Title Block Parameters' };",
        [DS_SUITE],
        why="the else branch overwrites the .fbp's own label, :93",
    ),
    Mutant(
        "orientation-from-custom-size",
        MODEL,
        "  return widthMM < heightMM;",
        "  return widthMM <= heightMM;",
        [SUITE],
        why="GetPageLayoutInfoFromDialog, :647 — a square is landscape",
    ),
    Mutant(
        "orientation-zero-guard",
        MODEL,
        "  if (!widthMM || !heightMM) return null;",
        "  if (false) return null;",
        [SUITE],
        why=":645 — only when neither edge is zero",
    ),
    Mutant(
        "custom-size-enabled",
        MODEL,
        "export function customSizeEnabled(paper: string): boolean {\n  return paper === 'User';\n}",
        "export function customSizeEnabled(paper: string): boolean {\n  return paper === 'A4';\n}",
        [SUITE],
        why="OnPaperSizeChoice, :240",
    ),
    Mutant(
        "iso-date-padding",
        MODEL,
        "  const p = (n: number): string => String(n).padStart(2, '0');",
        "  const p = (n: number): string => String(n);",
        [SUITE],
        why="FormatISODate is zero-padded, :449",
    ),
    Mutant(
        "portrait-word-on-user",
        MODEL,
        "  if (customSizeEnabled(value.paper)) return `User ${value.customWidthMM} ${value.customHeightMM}`;",
        "  if (customSizeEnabled(value.paper))\n    return `User ${value.customWidthMM} ${value.customHeightMM}${value.portrait ? ' portrait' : ''}`;",
        [SUITE],
        why="PAGE_INFO::Format prints `portrait` for !IsCustom() only, page_info.cpp:252",
    ),
    Mutant(
        "default-custom-size",
        MODEL,
        "export const DEFAULT_CUSTOM_WIDTH_MM = 17000 * MM_PER_MIL;",
        "export const DEFAULT_CUSTOM_WIDTH_MM = 11000 * MM_PER_MIL;",
        [SUITE],
        why="page_info.cpp:70-71 — 17000 x 11000, width first",
    ),
    Mutant(
        "revision-min-width",
        MODEL,
        "  { label: 'Revision:', field: 'rev', comment: null, minWidth: 100 },",
        "  { label: 'Revision:', field: 'rev', comment: null, minWidth: 360 },",
        [SUITE],
        why="dialog_page_settings_base.cpp:245",
    ),
    Mutant(
        "comment-row-count",
        MODEL,
        "export const COMMENT_COUNT = 9;",
        "export const COMMENT_COUNT = 8;",
        [SUITE, DS_SUITE],
        why="TITLE_BLOCK carries nine comments",
    ),
    Mutant(
        "thumb-clamp-dropped",
        MODEL,
        "  const clamp = (v: number): number => Math.min(Math.max(v, range.min), range.max);",
        "  const clamp = (v: number): number => v;",
        [SUITE],
        why="clamped_layout_size, :532-535",
    ),
    Mutant(
        "thumb-long-edge",
        MODEL,
        "export const MAX_PAGE_EXAMPLE_SIZE = 200;",
        "export const MAX_PAGE_EXAMPLE_SIZE = 180;",
        [SUITE],
        why="dialog_page_settings.cpp:53",
    ),
    Mutant(
        "portrait-swap",
        MODEL,
        "  return value.portrait ? [base[1], base[0]] : [base[0], base[1]];",
        "  return [base[0], base[1]];",
        [SUITE],
        why="GetPageLayoutInfoFromDialog swaps to match orientation, :663-669",
    ),
    # ---- the component itself -------------------------------------------
    Mutant(
        "unit-span-back",
        DIALOG,
        "              <span className={dim(customOn)}>Width:</span>",
        '              <span className="ze-muted">mm</span>\n              <span className={dim(customOn)}>Width:</span>',
        [SUITE],
        why="the two hardcoded `mm` spans this merge deleted",
    ),
    Mutant(
        "units-pass-through",
        DIALOG,
        '                label="Width:"\n                units={units}',
        '                label="Width:"\n                units="mm"',
        [SUITE],
        why="UNIT_BINDER takes the FRAME's unit, dialog_page_settings.cpp:65-66",
    ),
    Mutant(
        "dimension-line-back",
        DIALOG,
        "            </div>\n          </div>\n\n          {/* bUpperSizerH->Add( 15, 0, … ) (:143) */}",
        "            </div>\n            <div>\n              {pageW} × {pageH} mm\n            </div>\n          </div>\n\n          {/* bUpperSizerH->Add( 15, 0, … ) (:143) */}",
        [SUITE],
        why="bleftSizer ends at the bitmap; upstream prints no dimension line",
    ),
    Mutant(
        "wks-select-back",
        DIALOG,
        '              <button\n                className="ze-btn ze-btn-bitmap"',
        '              <select className="ze-select" />\n              <button\n                className="ze-btn ze-btn-bitmap"',
        [SUITE],
        why="m_textCtrlFilePicker is a wxTextCtrl, not a wxChoice",
    ),
    Mutant(
        "font-literal-back",
        DIALOG,
        "function Spacer({ px }: { px: number }): JSX.Element {\n  return <div style={{ height: px }} />;",
        "function Spacer({ px }: { px: number }): JSX.Element {\n  return <div style={{ height: px, fontSize: 12 }} />;",
        [FONT_SUITE, CV_SUITE],
        why="proves the merged file is still inside the ratchets' scan after the "
        "drawing-sheet copy was deleted from one of their file lists",
    ),
]


def sh(cmd: list[str], cwd: Path = ROOT) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


SUMMARY = re.compile(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed")


def run_tests(files: list[str]) -> tuple[str, str]:
    """Return (verdict, detail). verdict in {killed, survived, harness}."""
    code, out = sh(["npx", "vitest", "run", "--root", "qa", *files])
    m = SUMMARY.search(out)
    if m is None:
        # No summary at all: never read this as a survival.
        return "harness", f"no vitest summary (exit {code})"
    failed = int(m.group(1) or 0)
    if failed > 0 and code != 0:
        return "killed", f"{failed} failed"
    if failed == 0 and code == 0:
        return "survived", "all passed"
    return "harness", f"summary says {failed} failed but exit was {code}"


def main() -> int:
    code, out = sh(["git", "status", "--porcelain", "--untracked-files=no"])
    if out.strip():
        print("REFUSING: working tree is dirty; commit the baseline first.")
        print(out)
        return 2

    rows: list[tuple[str, str, str]] = []
    for m in MUTANTS:
        path = ROOT / m.path
        before = path.read_text()
        found = before.count(m.old)
        if found != m.occurrences:
            rows.append((m.name, "ANCHOR", f"expected {m.occurrences} match(es), found {found}"))
            print(f"[ANCHOR ] {m.name}: {found} matches, wanted {m.occurrences}")
            continue

        path.write_text(before.replace(m.old, m.new, m.occurrences))
        after = path.read_text()
        if after == before:
            rows.append((m.name, "ANCHOR", "file bytes unchanged"))
            print(f"[ANCHOR ] {m.name}: file unchanged")
            continue

        try:
            build_ok = True
            detail = ""
            for pkg in m.typecheck:
                c, o = sh(["pnpm", "-C", pkg, "typecheck"])
                if c != 0:
                    build_ok = False
                    detail = f"{pkg} typecheck failed"
                    break
            if not build_ok:
                rows.append((m.name, "BUILD", detail))
                print(f"[BUILD  ] {m.name}: {detail}")
                continue

            verdict, detail = run_tests(m.tests)
            rows.append((m.name, verdict.upper(), detail))
            print(f"[{verdict.upper():7s}] {m.name}: {detail}")
        finally:
            sh(["git", "checkout", "--", m.path])
            assert (ROOT / m.path).read_text() == before, f"restore failed for {m.path}"

    print()
    print(f"{'mutant':30s} {'verdict':9s} detail")
    for name, verdict, detail in rows:
        print(f"{name:30s} {verdict:9s} {detail}")
    tally: dict[str, int] = {}
    for _, v, _ in rows:
        tally[v] = tally.get(v, 0) + 1
    print()
    print("  ".join(f"{k}={v}" for k, v in sorted(tally.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
