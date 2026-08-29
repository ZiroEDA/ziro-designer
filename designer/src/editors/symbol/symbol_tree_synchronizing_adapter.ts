// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_TREE_SYNCHRONIZING_ADAPTER`
 * (`eeschema/symbol_tree_synchronizing_adapter.cpp`), the Symbol Editor's
 * `LIB_TREE_MODEL_ADAPTER`.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS AN ADAPTER AND NOT A TREE
 * ---------------------------------------------------------------------------
 *
 * KiCad has ONE tree widget. `SYMBOL_TREE_PANE` is a `wxPanel` whose whole
 * body is
 *
 *     m_tree = new LIB_TREE( this, wxT( "symbols" ), m_libMgr->GetAdapter(),
 *                            LIB_TREE::SEARCH | LIB_TREE::MULTISELECT );
 *         — eeschema/widgets/symbol_tree_pane.cpp:40-44
 *
 * and everything the Symbol Editor's tree does DIFFERENTLY from the chooser's
 * lives here, in the adapter, not in a second widget. That is the whole of the
 * difference upstream: the same `common/widgets/lib_tree.cpp` paints both, and
 * this class answers `GetValue` and `GetAttr` from the library manager.
 *
 * Ours had a second tree — a `treeRows` memo and about eighty lines of JSX
 * inside `SymbolEditor.tsx` — which is why the Libraries pane had no "Item"
 * header, no search icon or settings button, a library glyph KiCad does not
 * draw, and none of the row faces below; and why a scroll fix made in
 * `widgets/lib_tree.tsx` helped the chooser and not this pane.
 *
 * ---------------------------------------------------------------------------
 * WHAT "SYNCHRONIZING" MEANS
 * ---------------------------------------------------------------------------
 *
 * The name is upstream's and it is literal: this adapter does not cache what
 * it shows. `GetValue` asks `m_libMgr->IsSymbolModified(...)` on every paint,
 * and `GetAttr` asks `m_frame->GetCurSymbol()`, so a row's asterisk, its bold
 * and its strikethrough follow an edit with no invalidation step at all. The
 * hooks are methods here for the same reason.
 */

import type { LibTreeNode } from '../../widgets/lib_tree_model.js';
import { LibTreeNodeType } from '../../widgets/lib_tree_model.js';
import { LibTreeModelAdapter, type LibTreeNodeAttr } from '../../widgets/lib_tree_model_adapter.js';

/**
 * The `LIB_SYMBOL_LIBRARY_MANAGER` and `SYMBOL_EDIT_FRAME` questions this
 * adapter asks. An interface rather than the classes themselves so the rules
 * below can be run from `qa` without a frame — which is the only way any of
 * them get tested, `SymbolEditor` being a `.tsx`.
 */
export interface SymbolTreeSource {
  /** `m_libMgr->IsLibraryModified( name )`. */
  isLibraryModified: (library: string) => boolean;
  /** `m_libMgr->IsSymbolModified( symbol, library )`. */
  isSymbolModified: (library: string, symbol: string) => boolean;
  /** `m_libMgr->IsLibraryLoaded( name )`. */
  isLibraryLoaded: (library: string) => boolean;
  /**
   * `m_frame->GetCurSymbol()->GetLibId()` as a string, or '' for a cold frame.
   * This is what "is canvas item" is tested against (:365-372, :385-389).
   */
  currentLibId: () => string;
}

export class SymbolTreeSynchronizingAdapter extends LibTreeModelAdapter {
  constructor(private readonly src: SymbolTreeSource) {
    super();
  }

  /**
   * `GetValue( …, NAME_COL )` (`symbol_tree_synchronizing_adapter.cpp:249-284`):
   *
   *     // mark modified items with an asterisk
   *     if( node->m_Type == LIB_TREE_NODE::TYPE::LIBRARY )
   *         if( m_libMgr->IsLibraryModified( node->m_Name ) )
   *             aVariant = aVariant.GetString() + " *";
   *     else if( node->m_Type == LIB_TREE_NODE::TYPE::ITEM )
   *         if( m_libMgr->IsSymbolModified( node->m_Name, node->m_Parent->m_Name ) )
   *             aVariant = aVariant.GetString() + " *";
   *
   * Note the separator: a SPACE then the asterisk. Ours wrote " *" on the
   * library row and " *" on the symbol row from two different places, and the
   * unit rows — which upstream leaves alone, since neither branch matches
   * TYPE::UNIT — never had one either way.
   */
  override nameCell(node: LibTreeNode): string {
    if (node.type === LibTreeNodeType.LIBRARY && this.src.isLibraryModified(node.name))
      return `${node.name} *`;
    if (
      node.type === LibTreeNodeType.ITEM &&
      this.src.isSymbolModified(node.parent?.name ?? '', node.name)
    )
      return `${node.name} *`;
    return node.name;
  }

  /**
   * `GetAttr( …, NAME_COL )` (`:336-397`), in upstream's order — the unloaded
   * test comes FIRST and returns, so a library that failed to load is grey and
   * is not also bold:
   *
   *     if( node->m_Type == LIBRARY && !m_libMgr->IsLibraryLoaded( node->m_Name ) )
   *     {   aAttr.SetColour( wxSYS_COLOUR_GRAYTEXT ); return true; }
   *
   * Then, per type:
   *
   *   LIBRARY  bold when modified; strikethrough when it is the current
   *            symbol's library AND the row is collapsed (:365-372).
   *   ITEM     bold when modified, italic when derived, strikethrough when it
   *            IS the symbol on the canvas (:377-389).
   *
   * The collapsed test is the widget's, not the model's — `m_widget->IsExpanded`
   * — so it arrives as a parameter rather than being asked of the manager.
   */
  override nodeAttr(node: LibTreeNode, expanded = false): LibTreeNodeAttr {
    if (node.type === LibTreeNodeType.LIBRARY && !this.src.isLibraryLoaded(node.name))
      return { greyed: true };

    const cur = this.src.currentLibId();

    if (node.type === LibTreeNodeType.LIBRARY) {
      const attr: LibTreeNodeAttr = { bold: this.src.isLibraryModified(node.name) };
      if (cur !== '' && cur.split(':')[0] === node.name && !expanded) attr.strikethrough = true;
      return attr;
    }

    if (node.type === LibTreeNodeType.ITEM) {
      return {
        bold: this.src.isSymbolModified(node.parent?.name ?? '', node.name),
        // `aAttr.SetItalic( !node->m_IsRoot )` — the base adapter's rule too,
        // restated only because this branch replaces the whole answer.
        italic: !node.isRoot,
        strikethrough: cur !== '' && cur === node.libId,
      };
    }

    // `default: return false;` — a unit row gets no attributes at all.
    return {};
  }
}
