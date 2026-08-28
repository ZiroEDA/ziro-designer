// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FP_TREE_SYNCHRONIZING_ADAPTER` (`pcbnew/fp_tree_synchronizing_adapter.cpp`),
 * the Footprint Editor's `LIB_TREE_MODEL_ADAPTER`.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS AN ADAPTER AND NOT A TREE
 * ---------------------------------------------------------------------------
 *
 * `FOOTPRINT_TREE_PANE` (`pcbnew/footprint_tree_pane.cpp:30-52`) is a `wxPanel`
 * whose entire body is one `LIB_TREE`:
 *
 *     m_tree = new LIB_TREE( this, wxT( "footprints" ),
 *                            m_frame->GetLibTreeAdapter(), LIB_TREE::SEARCH );
 *     boxSizer->Add( m_tree, 1, wxEXPAND, 5 );
 *
 * — the same `common/widgets/lib_tree.cpp` the symbol editor, the symbol
 * chooser and CvPcb mount. SEARCH alone: no `MULTISELECT` (which the symbol
 * editor asks for) and no `DETAILS`, so this pane has no HTML info panel.
 *
 * Everything the Footprint Editor's tree does differently lives HERE. Ours had
 * a third tree — a `treeRows` memo and about a hundred lines of JSX inside
 * `FootprintEditor.tsx` — which is why that pane had no "Item" header, a bare
 * `<input>` in place of the `wxSearchCtrl`, no sort/expand menu, a library
 * glyph KiCad does not draw, no virtual row window, no Description column and
 * none of the row faces below.
 *
 * ---------------------------------------------------------------------------
 * HOW IT DIFFERS FROM THE SYMBOL EDITOR'S
 * ---------------------------------------------------------------------------
 *
 * Both are called "synchronizing" and both answer from the frame on every
 * paint, but they mark different things, because a footprint library manager
 * is not a symbol library manager:
 *
 *   - `SYMBOL_TREE_SYNCHRONIZING_ADAPTER` asks `IsLibraryModified` /
 *     `IsSymbolModified` per row, so ANY dirty row is starred and bolded.
 *   - `FP_TREE_SYNCHRONIZING_ADAPTER` asks `m_frame->GetScreen()->IsContentModified()`,
 *     which is one boolean about the CANVAS, and applies it only to the loaded
 *     footprint and to its library. A footprint that is not on the canvas
 *     cannot be modified upstream, so no other row can be marked — and a
 *     LIBRARY row never takes an asterisk at all here, only bold, because
 *     `GetValue`'s asterisk branch tests `node->m_LibId == GetLoadedFPID()` and
 *     a library node's `m_LibId` has no item name.
 */

import type { LibTreeNode } from '../../widgets/lib_tree_model.js';
import { LibTreeNodeType } from '../../widgets/lib_tree_model.js';
import {
  LIB_TREE_BASE_COLUMNS,
  LibTreeModelAdapter,
  type LibTreeNodeAttr,
} from '../../widgets/lib_tree_model_adapter.js';

/**
 * The `FOOTPRINT_EDIT_FRAME` questions this adapter asks. An interface rather
 * than the frame so the rules can be run from `qa` without one — which is the
 * only way any of them get tested, `FootprintEditor` being a `.tsx`.
 */
export interface FpTreeSource {
  /**
   * `m_frame->GetLoadedFPID()` as a `"lib:name"` string, or '' for a cold
   * frame. Every rule in this file is keyed on it.
   */
  loadedFpId: () => string;
  /**
   * `m_frame->GetScreen()->IsContentModified()` — the canvas has unsaved
   * edits. ONE boolean, not a per-row question: see the class comment.
   */
  isContentModified: () => boolean;
  /**
   * `m_frame->IsCurrentFPFromBoard()`. When the footprint on the canvas came
   * off a board rather than out of a library, `GetAttr` returns early — "don't
   * link to a board footprint, even if the FPIDs match" (`:298-300`) — and
   * `GetValue` falls through to the plain name.
   */
  isCurrentFpFromBoard: () => boolean;
}

export class FpTreeSynchronizingAdapter extends LibTreeModelAdapter {
  constructor(private readonly src: FpTreeSource) {
    super();
    // `FP_TREE_MODEL_ADAPTER`'s constructor adds nothing to the base's two
    // columns (`pcbnew/fp_tree_model_adapter.cpp:42-46`), unlike the symbol
    // tree's, which appends Value and Footprint. The base class here carries
    // the symbol side's four because the symbol chooser mounts it directly.
    this.availableColumns = [...LIB_TREE_BASE_COLUMNS];
    this.shownColumns = [...LIB_TREE_BASE_COLUMNS];
  }

  /**
   * `GetValue( …, NAME_COL )` (`fp_tree_synchronizing_adapter.cpp:233-257`):
   *
   *     if( node->m_LibId == m_frame->GetLoadedFPID() && !m_frame->IsCurrentFPFromBoard() )
   *     {
   *         node->m_Name = …GetFirstFootprint()->GetFPID().GetUniStringLibItemName();
   *         if( m_frame->GetScreen()->IsContentModified() )
   *             aVariant = node->m_Name + wxT( " *" );
   *         else
   *             aVariant = node->m_Name;
   *     }
   *     else if( node->m_Pinned ) { aVariant = GetPinningSymbol() + node->m_Name; }
   *     else                      { aVariant = node->m_Name; }
   *
   * The name written back is the LIVE footprint's, not the loaded FPID's,
   * "because the footprint name may have been edited". Ours coincide: the node
   * name is the key in `FootprintLibraryManager`'s map, and `renameFootprint`
   * re-keys that map, so a rename has already moved `node.name`.
   *
   * The pinning branch is not here for the reason `LibTree` gives: the widget
   * prepends `GetPinningSymbol()` for every adapter, and an ITEM row — the only
   * kind the first branch can match — is never pinned.
   */
  override nameCell(node: LibTreeNode): string {
    const loaded = this.src.loadedFpId();
    if (
      loaded !== '' &&
      node.libId === loaded &&
      !this.src.isCurrentFpFromBoard() &&
      this.src.isContentModified()
    )
      return `${node.name} *`;
    return node.name;
  }

  /**
   * `GetAttr( …, NAME_COL )` (`:288-341`), in upstream's order.
   *
   *     if( m_frame->IsCurrentFPFromBoard() ) return false;   // :299-300
   *
   *     LIBRARY: if( node->m_Name == GetLoadedFPID().GetLibNickname() )
   *              {  if( !m_widget->IsExpanded( … ) ) SetStrikethrough( true );
   *                 if( IsContentModified() )        SetBold( true );          }
   *     ITEM:    if( node->m_LibId == GetLoadedFPID() )
   *              {  SetStrikethrough( true );
   *                 if( IsContentModified() )        SetBold( true );          }
   *     default: return false;
   *
   * Strikethrough is not decoration — "LIB_TREE_RENDERER uses strikethrough as
   * a proxy for 'is canvas item'" (`:313-314`, `:327-328`), which is how the
   * Footprint Editor shows what is open. Its library is struck only while
   * COLLAPSED, since with the library open the item's own row says it.
   *
   * There is no italic and no grey here. The base adapter italicises a derived
   * symbol (`aAttr.SetItalic( !node->m_IsRoot )`); a footprint has no such
   * thing, and this override replaces the whole answer, so a row that matches
   * nothing gets no attributes at all — upstream's `return false`.
   */
  override nodeAttr(node: LibTreeNode, expanded = false): LibTreeNodeAttr {
    if (this.src.isCurrentFpFromBoard()) return {};

    const loaded = this.src.loadedFpId();
    if (loaded === '') return {};

    if (node.type === LibTreeNodeType.LIBRARY) {
      if (node.name !== loaded.split(':')[0]) return {};
      const attr: LibTreeNodeAttr = {};
      if (!expanded) attr.strikethrough = true;
      if (this.src.isContentModified()) attr.bold = true;
      return attr;
    }

    if (node.type === LibTreeNodeType.ITEM) {
      if (node.libId !== loaded) return {};
      const attr: LibTreeNodeAttr = { strikethrough: true };
      if (this.src.isContentModified()) attr.bold = true;
      return attr;
    }

    return {};
  }
}
