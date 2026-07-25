/**
 * Glue between the LIB_TREE widget and the LibTreeNode model: owns the root
 * node, the sort mode, the search scoring pass and the "which rows are shown /
 * expanded" bookkeeping the wxDataViewCtrl does natively upstream. Mirrors
 * kicad/common/lib_tree_model_adapter.cpp (LIB_TREE_MODEL_ADAPTER).
 */
import { EdaCombinedMatcher } from '@ziroeda/common';
import {
  LibTreeNode,
  LibTreeNodeType,
  makeLibraryNode,
  type LibTreeNodeFilter,
} from './lib_tree_model.js';

/** LIB_TREE_MODEL_ADAPTER::SORT_MODE. */
export enum SortMode {
  BEST_MATCH = 0,
  ALPHABETIC = 1,
}

/** The columns shown by default ("Item" is always first, loadColumnConfig). */
export const LIB_TREE_COLUMNS = ['Item', 'Description'] as const;

/** The unicode mark upstream prefixes to a pinned library's name
 *  (LIB_TREE_MODEL_ADAPTER::GetPinningSymbol). */
export const PINNING_SYMBOL = '☆ ';

// Don't cause the app to hang if someone accidentally pastes a schematic into
// the search box (upstream MAX_TERMS).
const MAX_TERMS = 100;

export class LibTreeModelAdapter {
  readonly tree = new LibTreeNode();

  private sortMode: SortMode = SortMode.BEST_MATCH;
  private filter: LibTreeNodeFilter | null = null;
  private searchString = '';
  private preselect: { libId: string; unit: number } | null = null;
  /** m_shownColumns, ordered, "Item" always first (loadColumnConfig). */
  private shownColumns: string[] = [...LIB_TREE_COLUMNS];
  /** m_availableColumns, grows as items contribute chooser fields. */
  private availableColumns: string[] = [...LIB_TREE_COLUMNS];
  /** Details-pane HTML for a node (SYMBOL_TREE_MODEL_ADAPTER::GenerateInfo). */
  generateInfo: (node: LibTreeNode) => string = () => '';

  getFilter(): LibTreeNodeFilter | null {
    return this.filter;
  }

  setFilter(filter: LibTreeNodeFilter | null): void {
    this.filter = filter;
  }

  getSortMode(): SortMode {
    return this.sortMode;
  }

  setSortMode(mode: SortMode): void {
    this.sortMode = mode;
  }

  setPreselectNode(libId: string, unit: number): void {
    this.preselect = { libId, unit };
  }

  getShownColumns(): readonly string[] {
    return this.shownColumns;
  }

  getAvailableColumns(): readonly string[] {
    return this.availableColumns;
  }

  /** SetShownColumns: "Item" is forced back to the front, then the tree's
   *  search terms are rebuilt so the new columns are searchable. */
  setShownColumns(columns: readonly string[]): void {
    const next = columns.filter((c) => c !== 'Item');
    this.shownColumns = ['Item', ...next];
    for (const lib of this.tree.children) lib.assignIntrinsicRanks(false, this.shownColumns);
  }

  /** addColumnIfNecessary, a field a symbol wants shown in the chooser
   *  becomes an available column the moment the first symbol offers it. */
  addColumnIfNecessary(header: string): void {
    if (!this.availableColumns.includes(header)) this.availableColumns.push(header);
  }

  addLibrary(name: string, desc: string, pinned: boolean): LibTreeNode {
    const node = makeLibraryNode(this.tree, name, desc);
    node.pinned = pinned;
    return node;
  }

  /** DoAddLibrary for the "-- Recently Used --" / "-- Already Placed --" groups. */
  addGroup(name: string): LibTreeNode {
    return makeLibraryNode(this.tree, name, '');
  }

  /** DoAddLibrary's tail: rank a library's items and rebuild their search terms
   *  against the columns currently shown. */
  finishLibrary(node: LibTreeNode, presorted = false): void {
    node.assignIntrinsicRanks(presorted, this.shownColumns);
  }

  /** Total number of items in the tree (drives the "(N items loaded)" title).
   *  With a filter set, only items passing it are counted
   *  (LIB_TREE_MODEL_ADAPTER::GetItemCount). */
  getItemCount(): number {
    let count = 0;
    for (const lib of this.tree.children) {
      if (this.filter) count += lib.children.filter((c) => this.filter!(c)).length;
      else count += lib.children.length;
    }
    return count;
  }

  getSearchString(): string {
    return this.searchString;
  }

  /**
   * LIB_TREE_MODEL_ADAPTER::UpdateSearchString, tokenise the query, score
   * every node, resort, and pick the node to select (showResults): an exact
   * match outranks any score, otherwise the higher score wins. With no query,
   * fall back to the preselect node.
   */
  updateSearchString(search: string): LibTreeNode | null {
    this.searchString = search;

    const matchers: EdaCombinedMatcher[] = [];
    for (const token of search.split(/[ \t\r\n]+/)) {
      if (token && matchers.length < MAX_TERMS)
        matchers.push(new EdaCombinedMatcher(token.toLowerCase()));
    }

    this.tree.updateScore(matchers, this.filter);
    this.tree.sortNodes(this.sortMode === SortMode.BEST_MATCH);

    let firstMatch: LibTreeNode | null = null;

    if (matchers.length > 0) {
      for (const lib of this.tree.children) {
        for (const item of lib.children) {
          if (item.type !== LibTreeNodeType.ITEM || item.score <= 1) continue;
          if (
            !firstMatch ||
            (item.exactMatch && !firstMatch.exactMatch) ||
            (item.exactMatch === firstMatch.exactMatch && item.score > firstMatch.score)
          ) {
            firstMatch = item;
          }
        }
      }
    }

    // If no matches, find and show the preselect node.
    if (!firstMatch && this.preselect) {
      for (const lib of this.tree.children) {
        if (lib.name.startsWith('-- ')) continue; // not the recent/placed groups
        for (const item of lib.children) {
          if (item.libId !== this.preselect.libId) continue;
          if (this.preselect.unit) {
            const unit = item.children.find((u) => u.unit === this.preselect!.unit);
            if (unit) return unit;
          }
          return item;
        }
      }
    }

    // If still no matches, expand a single library if there is only one
    // (showResults' last fallback).
    if (!firstMatch) {
      const libs = this.tree.children.filter((n) => !n.name.startsWith('-- '));
      if (libs.length !== 1) return null;
      for (const item of libs[0]!.children) {
        if (item.type === LibTreeNodeType.ITEM) return item;
      }
    }

    return firstMatch;
  }
}
