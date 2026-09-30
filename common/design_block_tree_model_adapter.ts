// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DESIGN_BLOCK_TREE_MODEL_ADAPTER` (common/design_block_tree_model_adapter.{h,cpp}):
 * the design block chooser's tree — a library node per design-block-lib-table
 * row that is not hidden, pinned when the session or project pins it, each
 * library's blocks under it — and the details pane's HTML (`GenerateInfo`).
 */
import type { DESIGN_BLOCK } from './design_block.js';
import type { DESIGN_BLOCK_LIBRARY_ADAPTER } from './design_block_library_adapter.js';
import { IO_ERROR } from './exceptions.js';
import { LibTreeModelAdapter } from './lib_tree_model_adapter.js';
import { makeItemNode } from './lib_tree_model.js';
import type { LIB_ID } from './lib_id.js';
import type { LIBRARY_MANAGER } from './libraries/library_manager.js';
import { LIBRARY_TABLE_TYPE } from './libraries/library_table.js';
import { EscapeHTML, LinkifyHTML, unescapeString } from './string_utils.js';

export class DESIGN_BLOCK_TREE_MODEL_ADAPTER extends LibTreeModelAdapter {
  private readonly m_libs: DESIGN_BLOCK_LIBRARY_ADAPTER;

  constructor(aLibs: DESIGN_BLOCK_LIBRARY_ADAPTER) {
    super();
    this.m_libs = aLibs;
  }

  /**
   * `AddLibraries( aParent )` (design_block_tree_model_adapter.cpp:55-77).
   *
   * @param aPinned `m_Session.pinned_design_block_libs` ∪ `m_PinnedDesignBlockLibs`.
   */
  AddLibraries(aManager: LIBRARY_MANAGER, aPinned: readonly string[]): void {
    for (const row of aManager.Rows(LIBRARY_TABLE_TYPE.DESIGN_BLOCK)) {
      if (row.Hidden()) continue;

      const libName = row.Nickname();
      const pinned = aPinned.includes(libName);
      const libNode = this.addLibrary(libName, row.Description(), pinned);

      for (const block of this.getDesignBlocks(libName)) {
        const item = makeItemNode(libNode, libName, block.GetName());
        item.desc = block.GetDesc();
        item.sourceSearchTerms = block.GetSearchTerms();
      }

      // Design blocks come back in filesystem enumeration order, so they are not presorted;
      // let AssignIntrinsicRanks() sort them by name.
      this.finishLibrary(libNode, false);
    }

    this.tree.assignIntrinsicRanks();
  }

  /** `ClearLibraries()`: the tree emptied. */
  ClearLibraries(): void {
    this.tree.children.length = 0;
  }

  /** `getDesignBlocks( aParent, aLibName )` (:91-110): each block's LIB_ID given the nickname. */
  private getDesignBlocks(aLibName: string): DESIGN_BLOCK[] {
    const blocks = this.m_libs.GetDesignBlocks(aLibName);

    for (const block of blocks) {
      const id = block.GetLIB_ID();
      id.SetLibNickname(aLibName);
      block.SetLibId(id);
    }

    return blocks;
  }

  /** `GenerateInfo( aLibId, aUnit )` (:113-196): the details pane's HTML. */
  GenerateInfo(aLibId: LIB_ID): string {
    const DescriptionFormat =
      '<b>__NAME__</b>__DESC____KEY__<hr><table border=0>__FIELDS__</table>';
    const FieldFormat = '<tr>   <td><b>__FIELD_NAME__</b></td>   <td>__FIELD_VALUE__</td></tr>';

    if (!aLibId.IsValid()) return '';

    let db: DESIGN_BLOCK | null = null;

    try {
      db = this.m_libs.GetEnumeratedDesignBlock(aLibId.GetLibNickname(), aLibId.GetLibItemName());
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      // wxLogError( "Error loading design block %s from library '%s'.\n%s" ), then nothing shown
      console.error(
        `Error loading design block ${aLibId.GetLibItemName()} from library '${aLibId.GetLibNickname()}'.\n${e.message}`,
      );
      return '';
    }

    if (!db) {
      return `Error loading design block ${aLibId.GetLibItemName()} from library '${aLibId.GetLibNickname()}'.\n`;
    }

    let html = DescriptionFormat;
    const name = aLibId.GetLibItemName();
    const desc = db.GetLibDescription();
    const keywords = db.GetKeywords();

    html = html.replace('__NAME__', EscapeHTML(name));

    // Add line breaks, then links
    const escDesc = LinkifyHTML(EscapeHTML(unescapeString(desc)).replaceAll('\n', '<br>'));

    html = html.replace('__DESC__', escDesc === '' ? '' : `<br>${escDesc}`);
    html = html.replace('__KEY__', keywords === '' ? '' : `<br>Keywords: ${EscapeHTML(keywords)}`);

    let fieldTable = '';

    for (const [key, value] of db.GetFields()) {
      fieldTable += FieldFormat.replace('__FIELD_NAME__', EscapeHTML(key)).replace(
        '__FIELD_VALUE__',
        EscapeHTML(value),
      );
    }

    return html.replace('__FIELDS__', fieldTable);
  }
}
