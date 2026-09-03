// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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

/**
 * The `wxDataViewItemAttr` fields `GetAttr` can set. Upstream's are
 * `SetBold`, `SetItalic`, `SetStrikethrough` and `SetColour`; the colour is
 * only ever `wxSYS_COLOUR_GRAYTEXT` for an unloaded library, so it is a flag
 * here rather than a colour — a literal colour would be exactly the drift the
 * central-value rule is about.
 */
export interface LibTreeNodeAttr {
  /** `SetBold` — a modified library or symbol. */
  bold?: boolean;
  /** `SetItalic` — a derived (alias) symbol. */
  italic?: boolean;
  /** `SetStrikethrough` — "LIB_TREE_RENDERER uses strikethrough as a proxy for
   *  is canvas item" (`symbol_tree_synchronizing_adapter.cpp:369`). */
  strikethrough?: boolean;
  /** `SetColour( wxSYS_COLOUR_GRAYTEXT )` — a library that failed to load. */
  greyed?: boolean;
}

/** LIB_TREE_MODEL_ADAPTER::SORT_MODE. */
export enum SortMode {
  BEST_MATCH = 0,
  ALPHABETIC = 1,
}

/**
 * `m_availableColumns` as the base adapter seeds it
 * (common/lib_tree_model_adapter.cpp:168), plus the two the symbol tree adds on
 * top of it (eeschema/symbol_tree_model_adapter.cpp:57-58). It is a fixed list
 * upstream: `addColumnIfNecessary` is fed by the library plugin's
 * `GetAvailableExtraFields`, which is a database-library capability, and NOT by
 * the fields of the symbols in a `.kicad_sym`.
 *
 * These are the SYMBOL side's four, and they are the class default here because
 * the symbol chooser mounts `LibTreeModelAdapter` itself rather than a subclass
 * — upstream that mount is a `SYMBOL_TREE_MODEL_ADAPTER`. An adapter for
 * anything else narrows them back to {@link LIB_TREE_BASE_COLUMNS} in its
 * constructor, which is what `FP_TREE_MODEL_ADAPTER` gets for free by not
 * adding any.
 */
export const LIB_TREE_COLUMNS = ['Item', 'Description', 'Value', 'Footprint'] as const;

/**
 * `m_availableColumns = { _HKI( "Item" ), _HKI( "Description" ) }` and
 * `m_shownColumns = { _HKI( "Item" ), _HKI( "Description" ) }` — the base
 * adapter's own two (common/lib_tree_model_adapter.cpp:168, 195-196).
 *
 * The footprint tree has exactly these: `FP_TREE_MODEL_ADAPTER`'s constructor
 * (pcbnew/fp_tree_model_adapter.cpp:42-46) adds nothing to either list, so
 * Value and Footprint — which the symbol tree adds — are not columns the
 * Footprint Editor can show, and its Select Columns dialog offers two rows.
 */
export const LIB_TREE_BASE_COLUMNS = ['Item', 'Description'] as const;

/**
 * `loadColumnConfig`'s fallback when the saved config names no columns
 * (eeschema/symbol_tree_model_adapter.cpp:74):
 *
 *     m_shownColumns = { _HKI( "Item" ), _HKI( "Description" ),
 *                        GetDefaultFieldName( FIELD_T::VALUE, false ) };
 *
 * Value is not decoration. `LIB_TREE_NODE::RebuildSearchTerms` turns every
 * shown column into a weight-4 search term, so dropping it from this list
 * changes the RANKING as well as the header — measured against KiCad's own
 * scorer, leaving it out reorders "conn" in Connector and "res" in Device
 * (qa/probes/chooser_score).
 */
export const LIB_TREE_DEFAULT_SHOWN_COLUMNS = ['Item', 'Description', 'Value'] as const;

/**
 * `m_colWidths` as the adapter's constructor seeds it
 * (common/lib_tree_model_adapter.cpp:158-160):
 *
 *     // Default column widths.  Do not translate these names.
 *     m_colWidths[ _HKI( "Item" ) ] = 300;
 *     m_colWidths[ _HKI( "Description" ) ] = 600;
 *
 * DATA, not chrome: KiCad writes these two numbers itself and asks nothing for
 * them, so they are mirrored rather than derived. They are also why the Symbol
 * Editor's dock shows a name column and no description at all — the pane is
 * 250 px and the Item column alone is 300, so the rest is off the right-hand
 * edge behind a horizontal scrollbar. Ours divided the pane 45/55 between the
 * two, which is a proportion upstream never had.
 *
 * A column that is not in this table takes the width `doAddColumn` computes
 * from its own header (`:481-486`); see `headerMinWidth` in `lib_tree.tsx`.
 */
export const LIB_TREE_DEFAULT_COL_WIDTHS: Readonly<Record<string, number>> = {
  Item: 300,
  Description: 600,
};

/**
 * `LIB_TREE_MODEL_ADAPTER::MAX_COL_WIDTH` (include/lib_tree_model_adapter.h:117)
 * and `IsValidColumnWidth` (:41-49), with upstream's own reason:
 *
 *     // An out-of-range persisted width (seen after mixed-DPI monitor changes)
 *     // can push the tree content out of view and leave the chooser unusable,
 *     // so anything outside a width that could legitimately fit on a display is
 *     // treated as corrupt rather than a resize.
 *
 * It guards both ends of the round trip — `loadColumnConfig` skips a stored
 * width that fails it (:186-190) and `SaveSettings` refuses to write one
 * (:241-245) — so a bad number can neither be read nor written.
 */
export const LIB_TREE_MAX_COL_WIDTH = 100000;

export function isValidColumnWidth(width: number): boolean {
  return width > 0 && width <= LIB_TREE_MAX_COL_WIDTH;
}

/**
 * `aDataViewCtrl->SetIndent( kDataViewIndent )` in `AttachTo`
 * (common/lib_tree_model_adapter.cpp:40, 397) — the px a child row is indented
 * past its parent. Data: a KiCad constant, not a GTK one. Ours was 16.
 */
export const LIB_TREE_INDENT = 20;

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
  /**
   * m_shownColumns / m_availableColumns, ordered, "Item" always first.
   *
   * The BASE adapter's own two, `common/lib_tree_model_adapter.cpp:168,195-196`.
   * These used to hold the symbol CHOOSER's set - Item, Description, Value
   * (+ Footprint available) - which inverts upstream: there the base is the
   * plain pair and `SYMBOL_TREE_MODEL_ADAPTER`'s constructor is the only thing
   * that adds Value and Footprint (eeschema/symbol_tree_model_adapter.cpp:54-58).
   *
   * Inverting it made every other tree responsible for UNDOING a column it
   * never asked for. The footprint editor remembered (`fp_tree_synchronizing_
   * adapter.ts:89-90`); the symbol editor did not, so its dock carried a Value
   * column upstream does not have there - `SYMBOL_TREE_SYNCHRONIZING_ADAPTER`
   * adds nothing at all and inherits exactly this pair.
   */
  protected shownColumns: string[] = [...LIB_TREE_BASE_COLUMNS];
  protected availableColumns: string[] = [...LIB_TREE_BASE_COLUMNS];
  /**
   * `m_colWidths`, per adapter and not per class.
   *
   * It is a member upstream, seeded with the two defaults in the constructor
   * and then written by `loadColumnConfig` from the settings file and by
   * `recreateColumns` from the widths the user dragged the header to
   * (common/lib_tree_model_adapter.cpp:158-160, 186-190, 660-682). Ours read
   * the constant table directly, so a dragged or a stored width had nowhere to
   * live.
   */
  protected colWidths: Record<string, number> = { ...LIB_TREE_DEFAULT_COL_WIDTHS };
  /** Details-pane HTML for a node (SYMBOL_TREE_MODEL_ADAPTER::GenerateInfo). */
  generateInfo: (node: LibTreeNode) => string = () => '';

  /**
   * `LIB_TREE_MODEL_ADAPTER::GetValue( …, NAME_COL )`
   * (`common/lib_tree_model_adapter.cpp`), the text of the Item cell.
   *
   * A method rather than a field on the node because upstream computes it on
   * every paint from state the adapter owns and the model does not — the
   * Symbol Editor's override asks `LIB_SYMBOL_LIBRARY_MANAGER` whether the row
   * is dirty and appends " *" (`symbol_tree_synchronizing_adapter.cpp:272-281`).
   * A flag cached on the node would be a second copy of the manager's answer.
   *
   * The pinning mark is NOT here: `LIB_TREE` prepends `GetPinningSymbol()`
   * itself, and both adapters share that.
   */
  nameCell(node: LibTreeNode): string {
    return node.name;
  }

  /**
   * `LIB_TREE_MODEL_ADAPTER::GetAttr( …, NAME_COL )` — how the row is drawn.
   *
   * The base answer is upstream's: a derived symbol's name is italic and
   * nothing else is marked. `SYMBOL_TREE_SYNCHRONIZING_ADAPTER` overrides it
   * (`:336-397`) to add bold for a modified library or symbol, strikethrough
   * for whatever is on the canvas, and grey for a library that failed to load.
   */
  nodeAttr(node: LibTreeNode, _expanded = false): LibTreeNodeAttr {
    return { italic: node.type === LibTreeNodeType.ITEM && !node.isRoot };
  }

  getFilter(): LibTreeNodeFilter | null {
    return this.filter;
  }

  setFilter(filter: LibTreeNodeFilter | null): void {
    this.filter = filter;
  }

  /**
   * Whether a row should be drawn, for the tree's flattening pass.
   *
   * Two independent reasons to hide one, and conflating them was a real bug:
   *
   *  - **score**, but only while a query is running. With no query every node
   *    scores the same, so score says nothing and must not be consulted.
   *  - **the filter**, always. `updateScore` already zeroes a rejected item's
   *    score, but that only reaches the display through the score test above —
   *    so with the power filter on and an empty search box, every non-power
   *    symbol stayed visible and the filter did nothing until the user typed.
   *
   * A library is shown when any of its children is, so a library with nothing
   * matching does not appear as an empty header. An as-yet-unloaded library has
   * no children and is kept: its symbols are not known yet, and hiding it would
   * make a library the user is about to open disappear.
   */
  /**
   * Whether a row is drawn — `LIB_TREE_MODEL_ADAPTER::GetChildren`
   * (common/lib_tree_model_adapter.cpp:598-619), which hands the dataview only
   * the children whose score is above zero:
   *
   *     for( child : node->m_Children )
   *         if( child->m_Score > 0 ) { aChildren.Add( ToItem( &*child ) ); ++count; }
   *
   * So a search DOES prune the tree, and `showResults` (:820-844) is only about
   * which of the survivors get their ancestors expanded and which one is
   * scrolled to. Reading showResults alone suggests nothing is ever hidden; the
   * model is where the filtering actually happens.
   *
   * `m_filter` is the tool's own flavour filter (power symbols), and applies
   * whether or not a query is live.
   */
  isVisible(node: LibTreeNode, searching: boolean): boolean {
    if (node.type === LibTreeNodeType.LIBRARY) {
      if (searching && node.score <= 0) return false;
      if (!this.filter || node.children.length === 0) return true;
      return node.children.some((c) => this.filter!(c));
    }
    if (searching && node.score <= 0) return false;
    return !this.filter || this.filter(node);
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

  /**
   * `SYMBOL_TREE_MODEL_ADAPTER::SYMBOL_TREE_MODEL_ADAPTER`
   * (eeschema/symbol_tree_model_adapter.cpp:54-58) plus its `loadColumnConfig`
   * fallback (:66-80). The symbol chooser is the one tree that has Value and
   * Footprint; nothing else upstream does, so widening lives at that call site
   * rather than in the shared default.
   *
   *     m_colWidths[ VALUE ] = 300;  m_colWidths[ FOOTPRINT ] = 600;
   *     m_availableColumns.emplace_back( VALUE );
   *     m_availableColumns.emplace_back( FOOTPRINT );
   */
  setSymbolChooserColumns(): void {
    this.availableColumns = [...LIB_TREE_COLUMNS];
    this.shownColumns = [...LIB_TREE_DEFAULT_SHOWN_COLUMNS];
    this.colWidths['Value'] = 300;
    this.colWidths['Footprint'] = 600;
  }

  /**
   * `m_colWidths[ aHeader ]`, or null for a column the table does not name.
   *
   * `doAddColumn` (common/lib_tree_model_adapter.cpp:477-496) fills a missing
   * entry in from the header's own text extent, which needs a font and so
   * cannot be answered here; the widget does that half.
   */
  getColumnWidth(header: string): number | null {
    return this.colWidths[header] ?? null;
  }

  /**
   * `recreateColumns`' write-back of the widths read off the columns
   * (common/lib_tree_model_adapter.cpp:672-680): the header was dragged, so the
   * adapter's table takes the new number — but only if it passes
   * `IsValidColumnWidth`, "Keep the prior sane width if a DPI change handed
   * back a corrupt one."
   */
  setColumnWidth(header: string, width: number): void {
    if (isValidColumnWidth(width)) this.colWidths[header] = width;
  }

  /**
   * `SaveSettings`' half of the round trip (:240-245) — `m_cfg.column_widths`,
   * skipping anything `IsValidColumnWidth` rejects. Only the columns actually
   * shown have a `wxDataViewColumn` upstream, so only those are written.
   */
  getColumnWidths(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const col of this.shownColumns) {
      const width = this.colWidths[col];
      if (width !== undefined && isValidColumnWidth(width)) out[col] = width;
    }
    return out;
  }

  /**
   * `loadColumnConfig` (:184-197), both halves: the stored widths over the
   * defaults, each one checked, and then the stored column list with "Item"
   * forced to the front.
   */
  loadColumnConfig(config: { columns?: readonly string[]; widths?: Record<string, number> }): void {
    for (const [name, width] of Object.entries(config.widths ?? {}))
      if (isValidColumnWidth(width)) this.colWidths[name] = width;

    if (config.columns && config.columns.length > 0) this.setShownColumns(config.columns);
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

  /**
   * addColumnIfNecessary: an extra column the LIBRARY offers becomes available.
   *
   * Upstream's one caller feeds it `m_adapter->GetAvailableExtraFields( lib )`
   * (eeschema/symbol_tree_model_adapter.cpp:150-151) — a database-library
   * capability. It is NOT fed by the chooser fields of the symbols in a
   * `.kicad_sym`: those are all of a symbol's fields, and offering Reference
   * and Datasheet as tree columns is not something KiCad does.
   */
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
