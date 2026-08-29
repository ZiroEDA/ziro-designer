// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FP_TREE_SYNCHRONIZING_ADAPTER` (`pcbnew/fp_tree_synchronizing_adapter.cpp`),
 * rule by rule.
 *
 * This file pins what the adapter ANSWERS. `footprint_tree_pane.test.tsx` pins
 * that `LIB_TREE` asks it and that the answer reaches the DOM — both halves are
 * needed, because the private tree computed the name and the face itself, so an
 * adapter with the right rules would have changed nothing on screen.
 *
 * The rules differ from the symbol editor's on purpose, and the difference is
 * the reason this is a second adapter rather than a shared one:
 * `SYMBOL_TREE_SYNCHRONIZING_ADAPTER` asks the library manager per row, while
 * this one asks the FRAME one question — `GetScreen()->IsContentModified()` —
 * and applies it only to what is on the canvas.
 */
import { describe, expect, it } from 'vitest';
import { FpTreeSynchronizingAdapter } from '@ziroeda/designer/src/editors/footprint/fp_tree_synchronizing_adapter.js';
import {
  LibTreeNode,
  LibTreeNodeType,
  makeItemNode,
} from '@ziroeda/designer/src/widgets/lib_tree_model.js';

interface FrameState {
  loaded: string;
  modified: boolean;
  fromBoard: boolean;
}

/** One adapter over a mutable frame state, the way the frame's refs feed it. */
function build(state: FrameState): {
  adapter: FpTreeSynchronizingAdapter;
  lib: LibTreeNode;
  item: LibTreeNode;
  other: LibTreeNode;
} {
  const adapter = new FpTreeSynchronizingAdapter({
    loadedFpId: () => state.loaded,
    isContentModified: () => state.modified,
    isCurrentFpFromBoard: () => state.fromBoard,
  });
  const lib = adapter.addLibrary('Resistor_SMD', '', false);
  const item = makeItemNode(lib, 'Resistor_SMD', 'R_0805');
  const other = makeItemNode(lib, 'Resistor_SMD', 'R_0603');
  adapter.finishLibrary(lib);
  return { adapter, lib, item, other };
}

describe('GetValue( …, NAME_COL )', () => {
  /**
   * `:235-246`:
   *
   *     if( node->m_LibId == m_frame->GetLoadedFPID() && !IsCurrentFPFromBoard() )
   *         if( m_frame->GetScreen()->IsContentModified() )
   *             aVariant = node->m_Name + wxT( " *" );
   *
   * Note the separator: a SPACE then the asterisk, and only on the footprint
   * that is open on the canvas.
   */
  it('stars the loaded footprint while the canvas is modified', () => {
    const state: FrameState = { loaded: 'Resistor_SMD:R_0805', modified: true, fromBoard: false };
    const { adapter, item } = build(state);
    expect(adapter.nameCell(item)).toBe('R_0805 *');
    state.modified = false;
    // "Synchronizing" is literal: nothing is cached, so saving un-stars the row
    // with no invalidation step at all.
    expect(adapter.nameCell(item)).toBe('R_0805');
  });

  it('stars nothing else, however dirty the canvas is', () => {
    const state: FrameState = { loaded: 'Resistor_SMD:R_0805', modified: true, fromBoard: false };
    const { adapter, lib, other } = build(state);
    // A LIBRARY row never takes the asterisk here: `GetValue`'s branch tests
    // `node->m_LibId == GetLoadedFPID()`, and a library node's LIB_ID has no
    // item name, so it can never match. Bold is all a library gets.
    expect(adapter.nameCell(lib)).toBe('Resistor_SMD');
    // And a footprint that is not on the canvas cannot be modified upstream.
    expect(adapter.nameCell(other)).toBe('R_0603');
  });

  /** `!m_frame->IsCurrentFPFromBoard()` — a footprint pulled off a board is not
   *  the library's, so the library's row is left alone. */
  it('stars nothing when the canvas footprint came off a board', () => {
    const state: FrameState = { loaded: 'Resistor_SMD:R_0805', modified: true, fromBoard: true };
    const { adapter, item } = build(state);
    expect(adapter.nameCell(item)).toBe('R_0805');
  });
});

describe('GetAttr( …, NAME_COL )', () => {
  /**
   * `:323-333` — "LIB_TREE_RENDERER uses strikethrough as a proxy for 'is
   * canvas item'". This is how the Footprint Editor shows what is open, and it
   * does NOT depend on the canvas being modified.
   */
  it('strikes the footprint on the canvas, and bolds it only when modified', () => {
    const state: FrameState = { loaded: 'Resistor_SMD:R_0805', modified: false, fromBoard: false };
    const { adapter, item, other } = build(state);
    expect(adapter.nodeAttr(item)).toEqual({ strikethrough: true });
    expect(adapter.nodeAttr(other)).toEqual({});
    state.modified = true;
    expect(adapter.nodeAttr(item)).toEqual({ strikethrough: true, bold: true });
  });

  /**
   * `:307-320`: the library of the open footprint is struck through only while
   * it is COLLAPSED — with it open the footprint's own row says it. The
   * expanded flag is the WIDGET's (`m_widget->IsExpanded`), which is why it
   * arrives as a parameter rather than being asked of the frame.
   */
  it('strikes the loaded footprint’s library only while it is collapsed', () => {
    const state: FrameState = { loaded: 'Resistor_SMD:R_0805', modified: false, fromBoard: false };
    const { adapter, lib } = build(state);
    expect(adapter.nodeAttr(lib, false)).toEqual({ strikethrough: true });
    expect(adapter.nodeAttr(lib, true)).toEqual({});
    state.modified = true;
    expect(adapter.nodeAttr(lib, true)).toEqual({ bold: true });
  });

  /** `if( m_frame->IsCurrentFPFromBoard() ) return false;` (`:299-300`) —
   *  "don't link to a board footprint, even if the FPIDs match". */
  it('marks nothing at all when the canvas footprint came off a board', () => {
    const state: FrameState = { loaded: 'Resistor_SMD:R_0805', modified: true, fromBoard: true };
    const { adapter, lib, item } = build(state);
    expect(adapter.nodeAttr(item)).toEqual({});
    expect(adapter.nodeAttr(lib, false)).toEqual({});
  });

  /**
   * The base adapter answers `{ italic: !node.isRoot }` — `LIB_SYMBOL::IsRoot`,
   * a derived symbol. A footprint has no such thing, and upstream's `default:
   * return false` means a row that matches nothing gets NO attributes; an
   * override that forgot to replace the base answer would italicise every
   * footprint whose `isRoot` was left unset.
   */
  it('never italicises, because a footprint is not a derived symbol', () => {
    const state: FrameState = { loaded: '', modified: false, fromBoard: false };
    const { adapter, item } = build(state);
    item.isRoot = false;
    expect(adapter.nodeAttr(item)).toEqual({});
  });

  it('marks nothing while no footprint is loaded', () => {
    const state: FrameState = { loaded: '', modified: true, fromBoard: false };
    const { adapter, lib, item } = build(state);
    expect(adapter.nodeAttr(item)).toEqual({});
    expect(adapter.nodeAttr(lib, false)).toEqual({});
    expect(adapter.nameCell(item)).toBe('R_0805');
  });

  it('gives a unit row nothing, which is upstream’s default arm', () => {
    const state: FrameState = { loaded: 'Resistor_SMD:R_0805', modified: true, fromBoard: false };
    const { adapter, item } = build(state);
    const unit = new LibTreeNode();
    unit.type = LibTreeNodeType.UNIT;
    unit.parent = item;
    expect(adapter.nodeAttr(unit)).toEqual({});
  });
});

describe('the columns a footprint tree can show', () => {
  /**
   * `FP_TREE_MODEL_ADAPTER`'s constructor (`pcbnew/fp_tree_model_adapter.cpp:42-46`)
   * adds nothing to `m_availableColumns`, so the base's two are all there is:
   *
   *     m_availableColumns = { _HKI( "Item" ), _HKI( "Description" ) };
   *         — common/lib_tree_model_adapter.cpp:168
   *
   * The symbol tree is the one that appends Value and Footprint
   * (`eeschema/symbol_tree_model_adapter.cpp:57-58`). Offering them here would
   * put two columns in the Select Columns dialog that no footprint can fill,
   * and — because `RebuildSearchTerms` makes every shown column a weight-4
   * search term — would change the RANKING as well as the header.
   */
  it('are Item and Description, and not the symbol tree’s four', () => {
    const state: FrameState = { loaded: '', modified: false, fromBoard: false };
    const { adapter } = build(state);
    expect([...adapter.getAvailableColumns()]).toEqual(['Item', 'Description']);
    expect([...adapter.getShownColumns()]).toEqual(['Item', 'Description']);
  });
});
