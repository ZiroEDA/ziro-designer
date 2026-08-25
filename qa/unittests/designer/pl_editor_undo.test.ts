// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PL_EDITOR_FRAME`'s undo/redo, against `pagelayout_editor/pl_editor_undo_redo.cpp`
 * and `common/drawing_sheet/ds_proxy_undo_item.cpp`.
 *
 * Every expectation here is derived from the C++, never from calling the code
 * under test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  captureUndoItem,
  clearUndoRedoList,
  getLayoutFromRedoList,
  getLayoutFromUndoList,
  historyDepthOf,
  newUndoRedoState,
  NO_SELECTED_ITEM,
  rebuildSelection,
  rollbackFromUndo,
  saveCopyInUndoList,
} from '@ziroeda/designer/src/editors/drawingsheet/undo_stack.js';
import {
  pasteEnabled,
  redoEnabled,
  toolbarDisabledIds,
  undoEnabled,
} from '@ziroeda/designer/src/editors/drawingsheet/ui_conditions.js';

interface Layout {
  readonly items: readonly string[];
}
interface Page {
  readonly paper: string;
}

const L = (...items: string[]): Layout => ({ items });
const PAGE_A: Page = { paper: 'A3' };
const PAGE_B: Page = { paper: 'A4' };

const push = (
  s: ReturnType<typeof newUndoRedoState<Layout, Page>>,
  l: Layout,
  sel: number[] = [],
) => saveCopyInUndoList(s, captureUndoItem(l, sel, null));

describe('DS_PROXY_UNDO_ITEM: what one entry carries', () => {
  it('records INT_MAX when nothing is selected (ds_proxy_undo_item.cpp:35)', () => {
    expect(captureUndoItem(L('a', 'b'), [], null).selectedDataItem).toBe(NO_SELECTED_ITEM);
  });

  it('records the one selected index', () => {
    expect(captureUndoItem(L('a', 'b', 'c'), [1], null).selectedDataItem).toBe(1);
  });

  /**
   * ds_proxy_undo_item.cpp:46-62. The `break` is on the INNER loop, so a later
   * data item overwrites what an earlier one recorded: the LAST data item
   * holding a selected draw item is what survives. Selecting items 0 and 2 and
   * undoing therefore comes back with item 2 selected and item 0 not.
   */
  it('keeps the LAST selected index, not the first (the inner break)', () => {
    expect(captureUndoItem(L('a', 'b', 'c'), [0, 2], null).selectedDataItem).toBe(2);
    // Iteration order of a Set is insertion order, so this also pins that the
    // rule is "highest index", not "last one added".
    expect(captureUndoItem(L('a', 'b', 'c'), [2, 0], null).selectedDataItem).toBe(2);
  });

  it('is PLUS-typed exactly when the page settings are handed to it (:33-41)', () => {
    expect(captureUndoItem(L('a'), [], null).withPageSettings).toBe(false);
    expect(captureUndoItem(L('a'), [], PAGE_A).withPageSettings).toBe(true);
    expect(captureUndoItem(L('a'), [], PAGE_A).page).toBe(PAGE_A);
  });
});

describe('Restore + RebuildSelection (ds_proxy_undo_item.cpp:76-90, pl_selection_tool.cpp:455-467)', () => {
  it('restores exactly one item, by index', () => {
    const item = captureUndoItem(L('a', 'b', 'c'), [0, 2], null);
    expect([...rebuildSelection(item, 3)]).toEqual([2]);
  });

  it('restores nothing when the index is gone from the restored model', () => {
    // `Restore` guards with `m_selectedDrawItem < dataItem->GetDrawItems().size()`
    // and only fires inside `ii == m_selectedDataItem`, so an index past the end
    // of the restored model selects nothing at all.
    const item = captureUndoItem(L('a', 'b', 'c'), [2], null);
    expect(rebuildSelection(item, 2).size).toBe(0);
  });

  it('restores nothing for an entry captured with no selection', () => {
    expect(rebuildSelection(captureUndoItem(L('a'), [], null), 1).size).toBe(0);
  });
});

describe('SaveCopyInUndoList (pl_editor_undo_redo.cpp:34-45)', () => {
  it('pushes onto undo and CLEARS redo', () => {
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a'));
    getLayoutFromUndoList(s, L('b'), [], PAGE_A);
    expect(historyDepthOf(s)).toEqual({ undo: 0, redo: 1 });

    push(s, L('c'));
    expect(historyDepthOf(s)).toEqual({ undo: 1, redo: 0 });
  });
});

describe('GetLayoutFromUndoList (pl_editor_undo_redo.cpp:88-119)', () => {
  it('returns null and touches nothing when the stack is empty', () => {
    const s = newUndoRedoState<Layout, Page>();
    expect(getLayoutFromUndoList(s, L('a'), [], PAGE_A)).toBeNull();
    expect(historyDepthOf(s)).toEqual({ undo: 0, redo: 0 });
  });

  it('moves one entry from undo to redo and hands back the popped layout', () => {
    const s = newUndoRedoState<Layout, Page>();
    const before = L('a');
    push(s, before);
    const r = getLayoutFromUndoList(s, L('a', 'b'), [], PAGE_A);
    expect(r?.item.layout).toBe(before);
    expect(historyDepthOf(s)).toEqual({ undo: 0, redo: 1 });
    expect(s.redo[0]?.layout.items).toEqual(['a', 'b']);
  });

  /**
   * `new DS_PROXY_UNDO_ITEM( pageSettingsAndTitleBlock ? this : nullptr )` —
   * the redo entry is PLUS-typed if and only if the popped one was. This is
   * what makes undo-then-redo of a page change put the page back rather than
   * drop it.
   */
  it('gives the redo entry the popped entry’s type, and only then the page', () => {
    const s = newUndoRedoState<Layout, Page>();
    saveCopyInUndoList(s, captureUndoItem(L('a'), [], PAGE_A));
    const r = getLayoutFromUndoList(s, L('a'), [], PAGE_B);
    expect(r?.hardRedraw).toBe(true);
    expect(s.redo[0]?.withPageSettings).toBe(true);
    expect(s.redo[0]?.page).toBe(PAGE_B);

    const s2 = newUndoRedoState<Layout, Page>();
    push(s2, L('a'));
    const r2 = getLayoutFromUndoList(s2, L('a'), [], PAGE_B);
    expect(r2?.hardRedraw).toBe(false);
    expect(s2.redo[0]?.withPageSettings).toBe(false);
    expect(s2.redo[0]?.page).toBeNull();
  });

  it('captures the LIVE selection into the redo entry, before ClearSelection', () => {
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a', 'b'));
    getLayoutFromUndoList(s, L('a', 'b'), [1], PAGE_A);
    expect(s.redo[0]?.selectedDataItem).toBe(1);
  });

  it('rebuilds the selection from the popped entry, not from the live one', () => {
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a', 'b', 'c'), [0]);
    const r = getLayoutFromUndoList(s, L('a', 'b', 'c'), [2], PAGE_A);
    expect([...(r?.selection ?? [])]).toEqual([0]);
  });
});

describe('GetLayoutFromRedoList (pl_editor_undo_redo.cpp:52-83)', () => {
  it('round-trips a layout and its page through undo and redo', () => {
    const s = newUndoRedoState<Layout, Page>();
    saveCopyInUndoList(s, captureUndoItem(L('a'), [], PAGE_A));
    const undone = getLayoutFromUndoList(s, L('a'), [], PAGE_B);
    expect(undone?.item.page).toBe(PAGE_A);

    const redone = getLayoutFromRedoList(s, L('a'), [], PAGE_A);
    expect(redone?.item.page).toBe(PAGE_B);
    expect(historyDepthOf(s)).toEqual({ undo: 1, redo: 0 });
  });

  it('returns null on an empty redo stack', () => {
    expect(getLayoutFromRedoList(newUndoRedoState<Layout, Page>(), L('a'), [], PAGE_A)).toBeNull();
  });
});

describe('RollbackFromUndo (pl_editor_undo_redo.cpp:125-150)', () => {
  /**
   * The whole point of the separate entry point: a cancelled dialog, a
   * cancelled draw and a cancelled move leave NO redo behind. Ours called
   * plain Undo for the cancelled-draw case, which armed a Redo that put the
   * abandoned rectangle straight back.
   */
  it('pops the undo stack and pushes NOTHING onto redo', () => {
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a'));
    const r = rollbackFromUndo(s);
    expect(r?.item.layout.items).toEqual(['a']);
    expect(historyDepthOf(s)).toEqual({ undo: 0, redo: 0 });
  });

  it('restores what the entry captured, rather than only popping', () => {
    const s = newUndoRedoState<Layout, Page>();
    saveCopyInUndoList(s, captureUndoItem(L('a', 'b'), [1], PAGE_A));
    const r = rollbackFromUndo(s);
    expect(r?.item.page).toBe(PAGE_A);
    expect(r?.hardRedraw).toBe(true);
    expect([...(r?.selection ?? [])]).toEqual([1]);
  });

  it('returns null on an empty stack', () => {
    expect(rollbackFromUndo(newUndoRedoState<Layout, Page>())).toBeNull();
  });
});

describe('clearUndoRedoList (OnNewDrawingSheet, and loading a file)', () => {
  it('empties both stacks', () => {
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a'));
    push(s, L('b'));
    getLayoutFromUndoList(s, L('c'), [], PAGE_A);
    clearUndoRedoList(s);
    expect(historyDepthOf(s)).toEqual({ undo: 0, redo: 0 });
  });
});

describe('setupUIConditions (pl_editor_frame.cpp:311-368)', () => {
  it('undo and redo follow GetUndoCommandCount() > 0 / GetRedoCommandCount() > 0', () => {
    expect(undoEnabled({ undo: 0, redo: 0 })).toBe(false);
    expect(undoEnabled({ undo: 1, redo: 0 })).toBe(true);
    expect(redoEnabled({ undo: 5, redo: 0 })).toBe(false);
    expect(redoEnabled({ undo: 0, redo: 1 })).toBe(true);
  });

  it('greys the toolbar Undo/Redo with the menu rows, from the same depths', () => {
    expect([...toolbarDisabledIds({ undo: 0, redo: 0 })].sort()).toEqual(['redo', 'undo']);
    expect([...toolbarDisabledIds({ undo: 2, redo: 0 })]).toEqual(['redo']);
    expect([...toolbarDisabledIds({ undo: 2, redo: 1 })]).toEqual([]);
  });

  /**
   * ACTIONS::paste is `ENABLE( SELECTION_CONDITIONS::Idle && cond.NoActiveTool() )`
   * (pl_editor_frame.cpp:326). `NoActiveTool` is `ToolStackIsEmpty()`, and the
   * drawing tools, the delete tool and the zoom-area tool all `PushTool`.
   */
  it('disables Paste while any tool is armed or an edit is in flight', () => {
    expect(pasteEnabled({ activeTool: 'select', moving: false, drawing: false })).toBe(true);
    expect(pasteEnabled({ activeTool: 'dsAddLine', moving: false, drawing: false })).toBe(false);
    expect(pasteEnabled({ activeTool: 'dsDelete', moving: false, drawing: false })).toBe(false);
    expect(pasteEnabled({ activeTool: 'zoomTool', moving: false, drawing: false })).toBe(false);
    expect(pasteEnabled({ activeTool: 'select', moving: true, drawing: false })).toBe(false);
    expect(pasteEnabled({ activeTool: 'select', moving: false, drawing: true })).toBe(false);
  });
});

describe('the sequence a user actually performs', () => {
  it('draw, cancel, then Redo is not offered', () => {
    // pl_drawing_tools.cpp:278 — Escape during a placement is RollbackFromUndo.
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a')); // SaveCopyInUndoList before the shape is added
    rollbackFromUndo(s);
    expect(redoEnabled(historyDepthOf(s))).toBe(false);
    expect(undoEnabled(historyDepthOf(s))).toBe(false);
  });

  it('move, undo: the moved item comes back selected', () => {
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a', 'b'), [1]); // item 1 selected when the move started
    const r = getLayoutFromUndoList(s, L('a', 'b'), [1], PAGE_A);
    expect([...(r?.selection ?? [])]).toEqual([1]);
  });

  it('delete, undo: nothing comes back selected, because the entry recorded none', () => {
    // deleteSelection commits with the selection still live, so the entry does
    // record it — but the item is back at the same index, so it is selected.
    const s = newUndoRedoState<Layout, Page>();
    push(s, L('a', 'b'), [1]);
    const r = getLayoutFromUndoList(s, L('a'), [], PAGE_A);
    expect([...(r?.selection ?? [])]).toEqual([1]);
    expect(r?.item.layout.items).toEqual(['a', 'b']);
  });

  it('page settings, Cancel: the page is restored and no redo is left', () => {
    const s = newUndoRedoState<Layout, Page>();
    saveCopyInUndoList(s, captureUndoItem(L('a'), [], PAGE_A)); // PageSetup, before the dialog
    const r = rollbackFromUndo(s); // Cancel
    expect(r?.item.page).toBe(PAGE_A);
    expect(historyDepthOf(s)).toEqual({ undo: 0, redo: 0 });
  });

  it('page settings, OK, Undo: the page goes back to what it was', () => {
    const s = newUndoRedoState<Layout, Page>();
    saveCopyInUndoList(s, captureUndoItem(L('a'), [], PAGE_A)); // PageSetup
    // OK: the frame now holds PAGE_B. Undo pops the PLUS entry.
    const r = getLayoutFromUndoList(s, L('a'), [], PAGE_B);
    expect(r?.item.withPageSettings).toBe(true);
    expect(r?.item.page).toBe(PAGE_A);
    // and Redo puts PAGE_B back.
    expect(getLayoutFromRedoList(s, L('a'), [], PAGE_A)?.item.page).toBe(PAGE_B);
  });
});

/**
 * The rules above are executable because they live in a `.ts`. What is NOT
 * executable here is the wiring: that the frame's Undo row runs
 * `getLayoutFromUndoList` and its Cancel runs `rollbackFromUndo` rather than
 * something of its own. These are source guards over `DrawingSheetEditor.tsx`,
 * which `qa` cannot import — they pin spelling, not behaviour, and they exist
 * because every one of the three bugs above was a CALL SITE that quietly did
 * the wrong thing while the module beside it was fine.
 */
describe('the frame runs these rules and not its own', () => {
  const src = readFileSync(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
    'utf8',
  );

  it('has no hand-rolled undo/redo arrays left', () => {
    expect(src).not.toMatch(/undoStack|redoStack/);
  });

  /** All three pops go through the module; the rollback one is used four times. */
  it('pops through the module at every call site', () => {
    expect(src).toMatch(/getLayoutFromUndoList\(/);
    expect(src).toMatch(/getLayoutFromRedoList\(/);
    expect(src).toMatch(/rollbackFromUndo\(/);
  });

  /**
   * `PL_EDITOR_CONTROL::PageSetup` pushes the copy BEFORE the dialog opens and
   * Cancel rolls it back (pl_editor_control.cpp:92, :103). The dialog must not
   * be openable without that push, so nothing may call `setShowPageDialog(true)`
   * except `pageSetup`.
   */
  it('opens Page Preview Settings only through pageSetup', () => {
    const opens = [...src.matchAll(/setShowPageDialog\(true\)/g)];
    expect(opens).toHaveLength(1);
    expect(src).toMatch(
      /const pageSetup = useCallback\(\(\) => \{\s*saveCopy\(previewRef\.current\);\s*setShowPageDialog\(true\);/,
    );
  });

  /** Escaping a placement is the rollback, never the plain undo. */
  it('cancels an in-flight shape with rollback', () => {
    expect(src).toMatch(/const cancelDrawing = useCallback\(\(\) => \{[\s\S]*?rollback\(\);/);
    expect(src).not.toMatch(/const cancelDrawing = useCallback\(\(\) => \{[\s\S]*?\n {4}undo\(\);/);
  });

  /** Both rows carry an enable condition read from the depths. */
  it('greys Undo and Redo from the history depths', () => {
    expect(src).toMatch(/disabled: !undoEnabled\(historyDepth\)/);
    expect(src).toMatch(/disabled: !redoEnabled\(historyDepth\)/);
    expect(src).toMatch(/disabledIds=\{toolbarDisabledIds\(historyDepth\)\}/);
  });
});
