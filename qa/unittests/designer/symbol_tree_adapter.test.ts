// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_TREE_SYNCHRONIZING_ADAPTER::GetValue` and `::GetAttr`
 * (`eeschema/symbol_tree_synchronizing_adapter.cpp:249-397`) — every row face
 * the Symbol Editor's tree has that the chooser's does not.
 *
 * These are the reason the Symbol Editor needs an adapter of its own rather
 * than a tree of its own, so they are pinned here rather than through the DOM:
 * `symbol_tree_pane.test.tsx` next door pins that the shared widget is mounted
 * and asks the adapter, and this pins what the adapter answers.
 *
 * The base class's answers are pinned beside them, because the italic rule is
 * the one thing BOTH adapters do and the chooser must not lose it.
 */
import { describe, expect, it } from 'vitest';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/designer/src/widgets/lib_tree_model.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import {
  SymbolTreeSynchronizingAdapter,
  type SymbolTreeSource,
} from '@ziroeda/designer/src/editors/symbol/symbol_tree_synchronizing_adapter.js';

/** A frame/manager that says no to everything, overridden per case. */
const source = (over: Partial<SymbolTreeSource> = {}): SymbolTreeSource => ({
  isLibraryModified: () => false,
  isSymbolModified: () => false,
  isLibraryLoaded: () => true,
  currentLibId: () => '',
  ...over,
});

const libNode = (name: string): LibTreeNode => {
  const n = new LibTreeNode();
  n.type = LibTreeNodeType.LIBRARY;
  n.name = name;
  n.libNickname = name;
  return n;
};

const itemNode = (library: string, name: string, isRoot = true): LibTreeNode => {
  const parent = libNode(library);
  const n = new LibTreeNode();
  n.type = LibTreeNodeType.ITEM;
  n.parent = parent;
  n.name = name;
  n.libNickname = library;
  n.libItemName = name;
  n.isRoot = isRoot;
  parent.children.push(n);
  return n;
};

const unitNode = (library: string, name: string): LibTreeNode => {
  const item = itemNode(library, name);
  const n = new LibTreeNode();
  n.type = LibTreeNodeType.UNIT;
  n.parent = item;
  n.name = 'Unit A';
  n.unit = 1;
  n.libNickname = library;
  n.libItemName = name;
  return n;
};

// ---------------------------------------------------------------------------
// GetValue( …, NAME_COL ): the asterisk
// ---------------------------------------------------------------------------

describe('the Item cell', () => {
  /**
   * `aVariant = aVariant.GetString() + " *"` — a space then an asterisk, on the
   * two branches upstream writes it on and no others. Written as a whole map so
   * a rule that marked the wrong row type moves an expectation.
   */
  it('marks a modified library and a modified symbol, and nothing else', () => {
    const a = new SymbolTreeSynchronizingAdapter(
      source({
        isLibraryModified: (lib) => lib === 'Device',
        isSymbolModified: (lib, sym) => lib === 'Device' && sym === 'R',
      }),
    );
    expect({
      dirtyLib: a.nameCell(libNode('Device')),
      cleanLib: a.nameCell(libNode('Connector')),
      dirtySym: a.nameCell(itemNode('Device', 'R')),
      cleanSym: a.nameCell(itemNode('Device', 'C')),
      // A symbol of the same name in a DIFFERENT library is not the dirty one:
      // upstream passes `node->m_Parent->m_Name` as the library.
      sameNameElsewhere: a.nameCell(itemNode('Connector', 'R')),
      // `default:` — a unit row is neither branch.
      unit: a.nameCell(unitNode('Device', 'R')),
    }).toEqual({
      dirtyLib: 'Device *',
      cleanLib: 'Connector',
      dirtySym: 'R *',
      cleanSym: 'C',
      sameNameElsewhere: 'R',
      unit: 'Unit A',
    });
  });

  /** The base adapter — the chooser's — never marks anything, because it has
   *  no library manager to ask. */
  it('is the bare name in the base adapter', () => {
    const base = new LibTreeModelAdapter();
    expect(base.nameCell(itemNode('Device', 'R'))).toBe('R');
    expect(base.nameCell(libNode('Device'))).toBe('Device');
  });
});

// ---------------------------------------------------------------------------
// GetAttr( …, NAME_COL ): bold / italic / strikethrough / grey
// ---------------------------------------------------------------------------

describe('the row face', () => {
  /**
   * The unloaded test is FIRST and RETURNS (`:346-350`), so a library that
   * failed to load is grey and is NOT also bold — even when it is modified.
   * Order is the whole content of this case.
   */
  it('greys an unloaded library and stops there', () => {
    const a = new SymbolTreeSynchronizingAdapter(
      source({ isLibraryLoaded: () => false, isLibraryModified: () => true }),
    );
    expect(a.nodeAttr(libNode('Device'))).toEqual({ greyed: true });
  });

  /** `aAttr.SetBold( m_libMgr->IsLibraryModified( node->m_Name ) )` (:362). */
  it('bolds a modified library and leaves a clean one plain', () => {
    const a = new SymbolTreeSynchronizingAdapter(
      source({ isLibraryModified: (lib) => lib === 'Device' }),
    );
    expect(a.nodeAttr(libNode('Device'))).toEqual({ bold: true });
    expect(a.nodeAttr(libNode('Connector'))).toEqual({ bold: false });
  });

  /**
   * `LIB_TREE_RENDERER uses strikethrough as a proxy for "is canvas item"`
   * (:369, :387). On a LIBRARY row it applies only while the row is
   * COLLAPSED — `if( !m_widget->IsExpanded( ToItem( node ) ) )` — which is why
   * the widget's own expansion state is a parameter here.
   */
  it('strikes the current symbol, and its library only while collapsed', () => {
    const a = new SymbolTreeSynchronizingAdapter(source({ currentLibId: () => 'Device:R' }));
    expect({
      libCollapsed: a.nodeAttr(libNode('Device'), false).strikethrough,
      libExpanded: a.nodeAttr(libNode('Device'), true).strikethrough,
      otherLib: a.nodeAttr(libNode('Connector'), false).strikethrough,
      theSymbol: a.nodeAttr(itemNode('Device', 'R')).strikethrough,
      otherSymbol: a.nodeAttr(itemNode('Device', 'C')).strikethrough,
      // A symbol of the same NAME in another library is a different LIB_ID.
      sameNameElsewhere: a.nodeAttr(itemNode('Connector', 'R')).strikethrough,
    }).toEqual({
      libCollapsed: true,
      libExpanded: undefined,
      otherLib: undefined,
      theSymbol: true,
      otherSymbol: false,
      sameNameElsewhere: false,
    });
  });

  /** A cold frame has no current symbol, so nothing is struck through — the
   *  empty LIB_ID must not match the library whose nickname is also ''. */
  it('strikes nothing on a cold frame', () => {
    const a = new SymbolTreeSynchronizingAdapter(source());
    expect(a.nodeAttr(libNode('Device'), false).strikethrough).toBeUndefined();
    expect(a.nodeAttr(itemNode('Device', 'R')).strikethrough).toBe(false);
  });

  /** `aAttr.SetItalic( !node->m_IsRoot )` (:381) — the alias mark, which the
   *  BASE adapter also applies, so the chooser keeps it. */
  it('italicises a derived symbol in both adapters', () => {
    const sync = new SymbolTreeSynchronizingAdapter(source());
    const base = new LibTreeModelAdapter();
    expect({
      syncDerived: sync.nodeAttr(itemNode('Device', 'R_Small', false)).italic,
      syncRoot: sync.nodeAttr(itemNode('Device', 'R', true)).italic,
      baseDerived: base.nodeAttr(itemNode('Device', 'R_Small', false)).italic,
      baseRoot: base.nodeAttr(itemNode('Device', 'R', true)).italic,
      // A LIBRARY row is never italic in either.
      syncLib: sync.nodeAttr(libNode('Device')).italic,
      baseLib: base.nodeAttr(libNode('Device')).italic,
    }).toEqual({
      syncDerived: true,
      syncRoot: false,
      baseDerived: true,
      baseRoot: false,
      syncLib: undefined,
      baseLib: false,
    });
  });

  /** `default: return false;` — a unit row carries no attributes at all. */
  it('gives a unit row nothing', () => {
    const a = new SymbolTreeSynchronizingAdapter(
      source({ isSymbolModified: () => true, currentLibId: () => 'Device:R' }),
    );
    expect(a.nodeAttr(unitNode('Device', 'R'))).toEqual({});
  });
});
