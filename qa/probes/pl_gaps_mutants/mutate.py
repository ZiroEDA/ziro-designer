#!/usr/bin/env python3
"""Apply ONE named mutant, or restore the tree.

Every mutant names an exact occurrence and asserts the file changed on disk
before the caller is allowed to score it: an edit whose anchor missed leaves the
file untouched, and an untouched file passes its tests, which is
indistinguishable from a mutant that was killed.

    python3 mutate.py list
    python3 mutate.py apply M4
    python3 mutate.py restore
"""
import hashlib
import os
import subprocess
import sys

# Absolute, and NOT derived from __file__: `restore` runs `git checkout --`,
# so a relative root computed from a file this script can itself revert is a
# foot-gun.  This harness is worktree-local anyway.
ROOT = '/home/akshay/ziro-wt-plgap'

# name -> (path relative to repo root, old text, new text, expected occurrences)
MUTANTS = {
    # ---- grid: the line under an axis -----------------------------------
    'M1': ('designer/src/ui/grid_cursor.ts',
           '  if (j * step + origin !== 0) return null;',
           '  if (false) return null;', 1),
    'M2': ('designer/src/ui/grid_cursor.ts',
           '  return (j - anchor) * dir;',
           '  return j - anchor;', 1),
    'M3': ('designer/src/ui/grid_cursor.ts',
           "  const axisCol = opts.axes && style !== 'crosses' ? axisLineIndex(iA, dirX, step, ox) : null;",
           '  const axisCol = opts.axes ? axisLineIndex(iA, dirX, step, ox) : null;', 1),
    'M4': ('designer/src/ui/grid_cursor.ts',
           '        if (l === skipRow) continue;\n        const y = l * pitch;',
           '        const y = l * pitch;', 1),
    'M5': ('designer/src/ui/grid_cursor.ts',
           '        if (k === skipCol) continue;\n        const x = k * pitch;\n        const sw =',
           '        const x = k * pitch;\n        const sw =', 1),
    'M6': ('designer/src/ui/grid_cursor.ts',
           '|${minorW}|${skipCol},${skipRow}`;',
           '|${minorW}`;', 1),
    # ---- toolbar: a button's right-click menu ----------------------------
    'M7': ('designer/src/ui/toolbar_context_menu_registry.ts',
           "  { action: 'gridProperties' },\n  { action: 'gridOrigin' },\n];",
           "  { action: 'gridProperties' },\n];", 1),
    'M8': ('designer/src/ui/toolbar_actions.ts',
           "  gridProperties: { name: 'Edit Grids...', tip: 'Edit grid definitions' },",
           "  gridProperties: { name: 'Grid Properties', tip: 'Edit grid definitions' },", 1),
    'M9': ('designer/src/ui/Toolbar.tsx',
           '        onContextMenu={(e) => {\n          if (opts.inPalette) return;\n          if (openButtonMenu(b.id, e)) e.preventDefault();\n        }}\n',
           '', 1),
    'M10': ('designer/src/ui/toolbar_context_menu_registry.ts',
            '      action: () => run(id),',
            '      action: () => run(actionId),', 1),
    'M11': ('designer/src/ui/toolbar_context_menu_registry.ts',
            '    if (state?.disabled?.(id)) item.disabled = true;\n',
            '', 1),
    'M12': ('designer/src/editors/drawingsheet/DrawingSheetEditor.tsx',
            '          entries={DS_LEFT_TOOLBAR}\n          app="pl_editor"\n',
            '          entries={DS_LEFT_TOOLBAR}\n', 1),
    'M13': ('designer/src/editors/drawingsheet/DrawingSheetEditor.tsx',
            "      if (id === 'gridProperties') {",
            "      if (id === 'gridPropertiesXX') {", 1),
    'M14': ('designer/src/dialogs/PreferencesDialog.tsx',
            '  const [page, setPage] = useState<PrefsPageId>(initialPage ?? FIRST_PAGE);',
            '  const [page, setPage] = useState<PrefsPageId>(FIRST_PAGE);', 1),
    'M15': ('designer/src/ui/Toolbar.tsx',
            '      disabled: (id) => !!disabledIds?.has(id),',
            '      disabled: () => false,', 1),
    # ---- the tests themselves: can they fail at all? ---------------------
    'T1': ('qa/unittests/designer/grid_axis_skip.test.ts',
           'const AXIS_X = 100;', 'const AXIS_X = 101;', 1),
    'T2': ('qa/unittests/designer/toolbar_context_menu.test.ts',
           "  pcbnew: { toggleGrid: ['gridProperties', 'gridOrigin'] },",
           "  pcbnew: { toggleGrid: ['gridProperties'] },", 1),
    # Anchored on the comment above it: a second `expect(ran).toEqual(
    # ['gridProperties'] )` was added later in the file, and a file-level hash
    # cannot tell two identical calls apart.
    'T3': ('qa/unittests/designer/toolbar_context_menu_render.test.tsx',
           "    // upstream dispatches it through the same TOOL_MANAGER the button uses.\n"
           "    expect(ran).toEqual(['gridProperties']);",
           "    // upstream dispatches it through the same TOOL_MANAGER the button uses.\n"
           "    expect(ran).toEqual(['toggleGrid']);", 1),
    'T4': ('qa/unittests/designer/prefs_initial_page.test.tsx',
           "    expect(selectedRow()).toBe('Grids');",
           "    expect(selectedRow()).toBe(labelOf(FIRST_PAGE));", 1),
}


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def apply(name):
    rel, old, new, want = MUTANTS[name]
    path = os.path.join(ROOT, rel)
    before = sha(path)
    with open(path) as f:
        src = f.read()
    n = src.count(old)
    if n != want:
        print(f'ANCHOR-MISS {name}: found {n} occurrences, expected {want}')
        return 2
    with open(path, 'w') as f:
        f.write(src.replace(old, new, want))
    after = sha(path)
    if before == after:
        print(f'ANCHOR-MISS {name}: file unchanged on disk')
        return 2
    print(f'APPLIED {name} {rel} {before[:8]} -> {after[:8]}')
    return 0


# Restore the SOURCE trees only.  `git checkout -- .` at the root would also
# revert this harness, which is tracked - and it did, silently, on the first
# run: every later mutant then reported ANCHOR-MISS against a stale path.
RESTORE_PATHS = ['designer/src', 'qa/unittests']


def restore():
    subprocess.run(['git', 'checkout', '--', *RESTORE_PATHS], cwd=ROOT, check=True)
    print('RESTORED')


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'list':
        for k, (rel, _, _, _) in MUTANTS.items():
            print(k, rel)
    elif cmd == 'apply':
        sys.exit(apply(sys.argv[2]))
    elif cmd == 'restore':
        restore()
