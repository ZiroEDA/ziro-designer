// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's undo/redo stack — `PL_EDITOR_FRAME`'s half of it
 * (`pagelayout_editor/pl_editor_undo_redo.cpp`) plus the payload it pushes
 * (`common/drawing_sheet/ds_proxy_undo_item.cpp`).
 *
 * pl_editor does not undo *edits*; every entry is a whole serialised copy of
 * the data model, so undo is "swap the model back". That is why one module can
 * hold the entire rule set with no knowledge of what an item is.
 *
 * A `.ts` module rather than hooks inside `DrawingSheetEditor.tsx` because
 * `qa` has no DOM environment and its tsconfig has no `--jsx`: a rule that
 * lives in a `.tsx` can only ever be asserted as source text, which pins its
 * spelling and not its behaviour. These are the rules that went unnoticed
 * exactly that way.
 */

/**
 * `DS_PROXY_UNDO_ITEM::m_selectedDataItem` initialises to `INT_MAX`
 * (ds_proxy_undo_item.cpp:35) and `Restore` compares `ii == m_selectedDataItem`
 * against a real index, so the sentinel simply never matches. Ours is the same
 * shape: a number no item index can equal.
 */
export const NO_SELECTED_ITEM = Number.MAX_SAFE_INTEGER;

/**
 * The shape of the layout an entry carries: `Restore` bounds its recorded
 * selection index against the restored model's item count, so the stack has to
 * be able to count them. Nothing else about the layout is ever inspected.
 */
export interface LayoutLike {
  readonly items: readonly unknown[];
}

/**
 * `DS_PROXY_UNDO_ITEM` — one undo entry.
 *
 * `S` is the serialised layout (`m_layoutSerialization`), `P` the page settings
 * and title block (`m_pageInfo` / `m_titleBlock`), which are only captured when
 * the frame is passed to the constructor.
 */
export interface DsProxyUndoItem<S extends LayoutLike, P> {
  /**
   * `Type() == WS_PROXY_UNDO_ITEM_PLUS_T`. The constructor picks the type from
   * whether a frame was handed to it (ds_proxy_undo_item.cpp:33-41), and
   * `Restore` only touches the page settings for the PLUS type (:67-71).
   */
  readonly withPageSettings: boolean;
  readonly page: P | null;
  readonly layout: S;
  /** `m_selectedDataItem`, or {@link NO_SELECTED_ITEM}. */
  readonly selectedDataItem: number;
}

/** The frame's `m_undoList` / `m_redoList` (`EDA_BASE_FRAME`). */
export interface UndoRedoState<S extends LayoutLike, P> {
  readonly undo: DsProxyUndoItem<S, P>[];
  readonly redo: DsProxyUndoItem<S, P>[];
}

export function newUndoRedoState<S extends LayoutLike, P>(): UndoRedoState<S, P> {
  return { undo: [], redo: [] };
}

/**
 * `DS_PROXY_UNDO_ITEM::DS_PROXY_UNDO_ITEM` (ds_proxy_undo_item.cpp:33-63).
 *
 * The selection an entry carries is **one index, not a set**. The constructor
 * walks the data items and records the index pair of a selected draw item —
 * and its `break` is on the *inner* loop only, so a later data item overwrites
 * what an earlier one recorded. What survives is the LAST data item holding a
 * selected draw item. Multi-selecting three items and moving them therefore
 * loses two of the three on undo in a real pl_editor; that is not a bug we get
 * to fix, it is the behaviour a user coming from KiCad expects.
 *
 * We select a whole data item (every repeat of it highlights together), so our
 * draw-item index is always 0 and only the data-item index is worth carrying.
 */
export function captureUndoItem<S extends LayoutLike, P>(
  layout: S,
  selection: Iterable<number>,
  page: P | null,
): DsProxyUndoItem<S, P> {
  let selectedDataItem = NO_SELECTED_ITEM;

  for (const idx of selection) {
    if (selectedDataItem === NO_SELECTED_ITEM || idx > selectedDataItem) selectedDataItem = idx;
  }

  return { withPageSettings: page !== null, page, layout, selectedDataItem };
}

/**
 * `DS_PROXY_UNDO_ITEM::Restore`'s selection half (ds_proxy_undo_item.cpp:76-90)
 * followed by `PL_SELECTION_TOOL::RebuildSelection`
 * (pl_selection_tool.cpp:455-467).
 *
 * `Restore` re-syncs the draw items and sets `SELECTED` on the single one it
 * recorded, *if that index still exists* in the restored model;
 * `RebuildSelection` then clears the selection and collects whatever carries
 * the flag. So the restored selection is at most one item, found by index in
 * the restored model rather than by identity — the pointers `Restore` hands
 * back are new objects, and nothing about the old selection survives except
 * that number.
 */
export function rebuildSelection<S extends LayoutLike, P>(
  item: DsProxyUndoItem<S, P>,
  itemCount: number,
): ReadonlySet<number> {
  if (item.selectedDataItem >= itemCount) return new Set();

  return new Set([item.selectedDataItem]);
}

/**
 * `PL_EDITOR_FRAME::SaveCopyInUndoList` (pl_editor_undo_redo.cpp:34-45).
 *
 * The comment upstream is the load-bearing half: "Clear redo list, because
 * after new save there is no redo to do."
 */
export function saveCopyInUndoList<S extends LayoutLike, P>(
  state: UndoRedoState<S, P>,
  item: DsProxyUndoItem<S, P>,
): void {
  state.undo.push(item);
  state.redo.length = 0;
}

/**
 * `GetUndoCommandCount()` / `GetRedoCommandCount()`. Whether they *enable*
 * anything is `ui_conditions.ts`'s call, not this module's — upstream splits
 * it the same way, between `EDA_BASE_FRAME` and `EDITOR_CONDITIONS`.
 */
export function historyDepthOf<S extends LayoutLike, P>(
  state: UndoRedoState<S, P>,
): { undo: number; redo: number } {
  return { undo: state.undo.length, redo: state.redo.length };
}

/** What a pop hands back to the caller: the entry to apply, and the selection it implies. */
export interface RestoredLayout<S extends LayoutLike, P> {
  readonly item: DsProxyUndoItem<S, P>;
  readonly selection: ReadonlySet<number>;
  /**
   * `pageSettingsAndTitleBlock` in all three of pl_editor's pop paths — the
   * flag that decides `HardRedraw()` over a plain `Refresh()`, and in the
   * rollback path a `zoomFitScreen` as well.
   */
  readonly hardRedraw: boolean;
}

/**
 * `PL_EDITOR_FRAME::GetLayoutFromUndoList` (pl_editor_undo_redo.cpp:88-119).
 *
 * `aCurrent` is what `new DS_PROXY_UNDO_ITEM( ... )` captures on the spot: the
 * live model and the live selection, taken *before* `ClearSelection()` runs.
 * It is PLUS-typed if and only if the popped entry was, which is why undoing a
 * page change and redoing it puts the page back rather than dropping it.
 */
export function getLayoutFromUndoList<S extends LayoutLike, P>(
  state: UndoRedoState<S, P>,
  aCurrentLayout: S,
  aCurrentSelection: Iterable<number>,
  aCurrentPage: P,
): RestoredLayout<S, P> | null {
  const item = state.undo.pop();

  if (item === undefined) return null;

  state.redo.push(
    captureUndoItem(aCurrentLayout, aCurrentSelection, item.withPageSettings ? aCurrentPage : null),
  );

  return {
    item,
    selection: rebuildSelection(item, item.layout.items.length),
    hardRedraw: item.withPageSettings,
  };
}

/** `PL_EDITOR_FRAME::GetLayoutFromRedoList` (pl_editor_undo_redo.cpp:52-83). */
export function getLayoutFromRedoList<S extends LayoutLike, P>(
  state: UndoRedoState<S, P>,
  aCurrentLayout: S,
  aCurrentSelection: Iterable<number>,
  aCurrentPage: P,
): RestoredLayout<S, P> | null {
  const item = state.redo.pop();

  if (item === undefined) return null;

  state.undo.push(
    captureUndoItem(aCurrentLayout, aCurrentSelection, item.withPageSettings ? aCurrentPage : null),
  );

  return {
    item,
    selection: rebuildSelection(item, item.layout.items.length),
    hardRedraw: item.withPageSettings,
  };
}

/**
 * `PL_EDITOR_FRAME::RollbackFromUndo` (pl_editor_undo_redo.cpp:125-150) — what
 * Cancel in Page Preview Settings runs (`pl_editor_control.cpp:100-104`).
 *
 * Its comment upstream says "Nothing to roll back but we have to at least pop
 * the stack", which undersells it: this pops **and restores**. The dialog has
 * been live-updating the frame's page settings the whole time it was open, so
 * Cancel has real work to undo. What it does not do is push a redo entry —
 * a cancelled dialog leaves no history behind.
 */
export function rollbackFromUndo<S extends LayoutLike, P>(
  state: UndoRedoState<S, P>,
): RestoredLayout<S, P> | null {
  const item = state.undo.pop();

  if (item === undefined) return null;

  return {
    item,
    selection: rebuildSelection(item, item.layout.items.length),
    hardRedraw: item.withPageSettings,
  };
}

/** `ClearUndoORRedoList` for both lists — `OnNewDrawingSheet`, and loading a file. */
export function clearUndoRedoList<S extends LayoutLike, P>(state: UndoRedoState<S, P>): void {
  state.undo.length = 0;
  state.redo.length = 0;
}
