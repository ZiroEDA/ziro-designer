#!/usr/bin/env python3
"""Mutation sweep for the footprint LIB_TREE swap.

Each mutant is applied to a file's BYTES (never `git checkout --`, which would
revert another agent's uncommitted work in this shared checkout), the file is
asserted to have actually changed, the named test files are run, and the bytes
are restored from the in-memory backup.

Scoring is three-way, as CLAUDE.md asks: a mutant whose run failed to BUILD is
a false negative, not a kill, and is reported separately from a survivor.
"""
import subprocess
import sys
import os

ROOT = '/home/akshay/ziro-designer-1'
LT = 'designer/src/widgets/lib_tree.tsx'
AD = 'designer/src/widgets/lib_tree_model_adapter.ts'
FP = 'designer/src/editors/footprint/fp_tree_synchronizing_adapter.ts'
FE = 'designer/src/editors/footprint/FootprintEditor.tsx'
ST = 'designer/src/prefs/settings.ts'

CHROME = 'unittests/designer/lib_tree_chrome.test.tsx'
PANE = 'unittests/designer/footprint_tree_pane.test.tsx'
ADAPT = 'unittests/designer/fp_tree_adapter.test.ts'
DOCK = 'unittests/designer/dock_pane_order.test.ts'
MINW = 'unittests/designer/lib_tree_column_min.test.tsx'

MUTANTS = [
    # ---- lib_tree.tsx -----------------------------------------------------
    ('LT-ctx-nofallback', LT,
     '                  onItemContextMenu(node, e.clientX, e.clientY);\n                  return;\n',
     '                  onItemContextMenu(node, e.clientX, e.clientY);\n',
     [CHROME, PANE]),
    ('LT-ctx-noselect', LT,
     '                // menu" (`lib_tree.cpp:1041-1053`), whichever menu follows.\n                select(node);\n',
     '                // menu" (`lib_tree.cpp:1041-1053`), whichever menu follows.\n',
     [CHROME]),
    ('LT-unselect-never', LT,
     'if (unselectNonce > 0) select(null);',
     'if (unselectNonce > 100000) select(null);',
     [CHROME, PANE]),
    ('LT-grip-inert', LT,
     'onMouseDown={(e) => startColumnResize(i, e)}',
     'onMouseDown={() => {}}',
     [CHROME]),
    ('LT-grip-noclamp', LT,
     'const next = Math.max(min, Math.round(startW + ev.clientX - startX));',
     'const next = Math.round(startW + ev.clientX - startX);',
     [MINW]),
    ('LT-grip-shared-min', LT,
     '    const min = headerMinWidth(col);',
     "    const min = headerMinWidth('Item');",
     [MINW]),
    ('LT-persist-per-frame', LT,
     '      adapter.setColumnWidth(col, next);\n      setColWidthNonce((n) => n + 1);',
     '      adapter.setColumnWidth(col, next);\n      onColumnWidthsChanged?.(adapter.getColumnWidths());\n      setColWidthNonce((n) => n + 1);',
     [CHROME]),
    ('LT-memo-stale', LT,
     '    [adapter, columns, colWidthNonce],',
     '    [adapter, columns],',
     [CHROME]),
    # ---- lib_tree_model_adapter.ts ----------------------------------------
    ('AD-getwidth-const', AD,
     '    return this.colWidths[header] ?? null;',
     '    return LIB_TREE_DEFAULT_COL_WIDTHS[header] ?? null;',
     [CHROME, PANE]),
    ('AD-load-noguard', AD,
     '      if (isValidColumnWidth(width)) this.colWidths[name] = width;',
     '      this.colWidths[name] = width;',
     [CHROME]),
    ('AD-savewidths-empty', AD,
     '      if (width !== undefined && isValidColumnWidth(width)) out[col] = width;',
     '      if (false && width !== undefined && isValidColumnWidth(width)) out[col] = width;',
     [CHROME]),
    ('AD-basecols-plus-value', AD,
     "export const LIB_TREE_BASE_COLUMNS = ['Item', 'Description'] as const;",
     "export const LIB_TREE_BASE_COLUMNS = ['Item', 'Description', 'Value'] as const;",
     [ADAPT, PANE]),
    # ---- fp_tree_synchronizing_adapter.ts ---------------------------------
    ('FP-name-always-star', FP,
     '      !this.src.isCurrentFpFromBoard() &&\n      this.src.isContentModified()\n',
     '      !this.src.isCurrentFpFromBoard()\n',
     [ADAPT, PANE]),
    ('FP-name-ignores-board', FP,
     '      !this.src.isCurrentFpFromBoard() &&\n      this.src.isContentModified()\n',
     '      this.src.isContentModified()\n',
     [ADAPT]),
    ('FP-attr-ignores-board', FP,
     '    if (this.src.isCurrentFpFromBoard()) return {};\n',
     '',
     [ADAPT]),
    ('FP-attr-lib-always-struck', FP,
     '      if (!expanded) attr.strikethrough = true;',
     '      attr.strikethrough = true;',
     [ADAPT]),
    ('FP-attr-item-always-bold', FP,
     '      const attr: LibTreeNodeAttr = { strikethrough: true };\n      if (this.src.isContentModified()) attr.bold = true;',
     '      const attr: LibTreeNodeAttr = { strikethrough: true, bold: true };',
     [ADAPT, PANE]),
    ('FP-attr-falls-back-to-base', FP,
     '      if (node.libId !== loaded) return {};',
     '      if (node.libId !== loaded) return super.nodeAttr(node, expanded);',
     [ADAPT]),
    ('FP-name-star-no-space', FP,
     '      return `${node.name} *`;',
     '      return `${node.name}*`;',
     [ADAPT, PANE]),
    # ---- FootprintEditor.tsx ----------------------------------------------
    ('FE-no-unselect', FE,
     '      void loadFootprint(node.libNickname, node.libItemName);\n      setUnselectNonce((n) => n + 1);',
     '      void loadFootprint(node.libNickname, node.libItemName);',
     [PANE]),
    ('FE-ctx-library-shape', FE,
     "    setTreeMenu(\n      node.type === LibTreeNodeType.LIBRARY\n        ? { x, y, lib: node.name, name: '' }\n        : { x, y, lib: node.libNickname, name: node.libItemName },\n    );",
     "    setTreeMenu({ x, y, lib: node.name, name: '' });",
     [PANE]),
    ('FE-choose-inverted', FE,
     '      if (node.type === LibTreeNodeType.LIBRARY) return;\n      void loadFootprint',
     '      if (node.type !== LibTreeNodeType.LIBRARY) return;\n      void loadFootprint',
     [PANE]),
    ('FE-signature-drops-pin', FE,
     "        `${n}\\u0000${manager.current.isPinned(n) ? 1 : 0}\\u0000${manager.current",
     "        `${n}\\u0000${manager.current",
     [PANE]),
    ('FE-addlibrary-unpinned', FE,
     "      const libNode = treeAdapter.addLibrary(libName, '', mgr.isPinned(libName));",
     "      const libNode = treeAdapter.addLibrary(libName, '', false);",
     [PANE]),
    ('FE-desc-dropped', FE,
     "        item.desc = fp?.descr ?? '';",
     "        item.desc = '';",
     [PANE]),
    ('FE-width-ignores-store', FE,
     '    () => settings.fpEdit.window.lib_width || LIBRARY_TREE_WIDTH,',
     '    () => LIBRARY_TREE_WIDTH,',
     [PANE, DOCK]),
    ('FE-width-not-saved', FE,
     '      settings.updateFpEdit((s) => {\n        s.window.lib_width = panelWidthRef.current;\n      });\n    };\n    document.addEventListener',
     '    };\n    document.addEventListener',
     [PANE]),
    ('FE-hide-not-saved', FE,
     "    if (id === 'showLibraryTree' && togglesRef.current.has(id)) {\n      settings.updateFpEdit((s) => {\n        s.window.lib_width = panelWidthRef.current;\n      });\n    }\n",
     '',
     [PANE]),
    ('FE-no-loading-panel', FE,
     '                {libNames.length === 0 && (\n                  <LibraryLoadingPanel',
     '                {false && (\n                  <LibraryLoadingPanel',
     [PANE]),
    ('FE-no-openlibs-restore', FE,
     '                  openLibs={openLibs.current}\n',
     '',
     [PANE]),
    ('FE-no-openlibs-save', FE,
     '      settings.updateFpEdit((s) => {\n        s.lib_tree.open_libs = [...openLibSet.current];\n      });\n',
     '',
     [PANE]),
    ('FE-no-column-config', FE,
     '    adapter.loadColumnConfig({\n      columns: settings.fpEdit.lib_tree.columns,\n      widths: settings.fpEdit.lib_tree.column_widths,\n    });\n',
     '',
     [PANE]),
    # ---- settings.ts ------------------------------------------------------
    ('ST-default-width', ST,
     '  window: { lib_width: 250 },',
     '  window: { lib_width: 300 },',
     [PANE, DOCK]),
    ('ST-merge-not-normalized', ST,
     '  out.lib_tree.column_widths = normalizeColumnWidths(widths);\n',
     '',
     [PANE]),
]


def run_tests(files):
    proc = subprocess.run(
        ['npx', 'vitest', 'run', *files],
        cwd=os.path.join(ROOT, 'qa'), capture_output=True, text=True)
    return proc.stdout + proc.stderr


def classify(out):
    if 'Failed to load' in out or 'Transform failed' in out or 'ERROR: ' in out:
        return 'BUILD'
    if 'No test files found' in out:
        return 'BUILD'
    # A collect-time error shows as "Errors  N error" without any test running.
    if 'AssertionError' in out or 'Unhandled' in out or ' failed' in out and 'Tests ' in out:
        for line in out.splitlines():
            if line.strip().startswith('Tests ') and 'failed' in line:
                return 'KILLED'
    if 'Unhandled Errors' in out:
        return 'BUILD'
    for line in out.splitlines():
        if line.strip().startswith('Tests ') and 'failed' not in line:
            return 'SURVIVED'
    return 'BUILD'


def main():
    only = sys.argv[1:] or None
    results = []
    for name, rel, old, new, tests in MUTANTS:
        if only and name not in only:
            continue
        path = os.path.join(ROOT, rel)
        with open(path, 'rb') as fh:
            backup = fh.read()
        text = backup.decode('utf-8')
        if text.count(old) != 1:
            results.append((name, f'BAD-ANCHOR({text.count(old)})'))
            print(f'{name}: BAD ANCHOR, {text.count(old)} matches', flush=True)
            continue
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(text.replace(old, new, 1))
        try:
            with open(path, 'rb') as fh:
                assert fh.read() != backup, 'mutant did not change the file'
            out = run_tests(tests)
            verdict = classify(out)
        finally:
            with open(path, 'wb') as fh:
                fh.write(backup)
            with open(path, 'rb') as fh:
                assert fh.read() == backup, 'restore failed'
        results.append((name, verdict))
        print(f'{name}: {verdict}', flush=True)
    print('\n--- summary ---')
    for name, verdict in results:
        print(f'{verdict:10} {name}')
    from collections import Counter
    print(dict(Counter(v for _, v in results)))


if __name__ == '__main__':
    main()
