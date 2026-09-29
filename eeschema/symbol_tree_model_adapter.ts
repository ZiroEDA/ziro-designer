// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_TREE_MODEL_ADAPTER` (eeschema/symbol_tree_model_adapter.{h,cpp}): the
 * symbol chooser's tree model — the two extra columns its constructor offers,
 * the persisted column set (`loadColumnConfig`), and `AddLibraries`, which
 * puts a library in the tree only once it is LOADED and retries the rest on a
 * one-second timer.
 *
 * Split out of `widgets/panel_symbol_chooser.tsx`, where it had been fused
 * into the panel's effects. What the adapter reads of the library layer
 * (`SYMBOL_LIBRARY_ADAPTER`'s load status and symbols, the library table's
 * description, the pinned list) comes in as a {@link SYMBOL_TREE_LIBRARY_SOURCE}
 * because the hosted library store is the app's.
 *
 * The node builders (`populateItemNode`, `addUnitRows`) are
 * `LIB_TREE_NODE_ITEM`'s constructor and `Update` as this adapter feeds them a
 * `LIB_TREE_ITEM` — `LIB_SYMBOL::cacheSearchTerms` / `cacheChooserFields` over
 * the projection the preload keeps.
 */
import { searchTerm } from '@ziroeda/common';
import { LibTreeModelAdapter, type SortMode } from '@ziroeda/common/lib_tree_model_adapter.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import { letterSubReference } from './fieldbox.js';
import { libTreeItem, type LibTreeItem } from './lib_tree_item.js';
import type { LibIndexEntry } from './libraries/symbol_library_adapter.js';
import type { LibSymbol } from './types.js';

/**
 * `m_check_pending_libraries_timer->Start( 1000 )`
 * (symbol_tree_model_adapter.cpp:209): how often AddLibraries retries the
 * libraries that were not LOADED yet.
 */
export const PENDING_LIBRARY_POLL_MS = 1000;

/** What `AddLibraries` asks of the library layer. */
export interface SYMBOL_TREE_LIBRARY_SOURCE {
  /** `GetLibraryStatus( lib )->load_status == LOAD_STATUS::LOADED`. */
  libraryLoaded(aLib: string): boolean;
  /** `m_adapter->GetSymbols( lib )`, as the preload keeps them. */
  loadedLibraryItems(aLib: string): readonly LibTreeItem[] | undefined;
  /** The library table row's `Description()`. */
  libraryDescription(aLib: LibIndexEntry): string;
  /** `cfg->m_Session.pinned_symbol_libs` ∪ `project.m_PinnedSymbolLibs`. */
  pinnedLibraries(): readonly string[];
  /** Whether an index symbol is a power symbol, built from the whole index. */
  powerSymbolTest(
    aIndex: readonly LibIndexEntry[],
  ): (aEntry: LibIndexEntry, aSymbolName: string) => boolean;
}

/**
 * `LIB_TREE_NODE_ITEM::Update`'s tail: a symbol with more than one unit gets a
 * child row per unit.
 *
 *   if( aItem->GetSubUnitCount() > 1 )
 *       for( int u = 1; u <= aItem->GetSubUnitCount(); ++u )
 *           AddUnit( aItem, u );
 *
 * Idempotent: the on-selection hydrate calls it again with the count read from
 * the real symbol, which corrects an index that disagrees and does nothing when
 * it does not.
 */
export function addUnitRows(node: LibTreeNode, units: number): void {
  if (units <= 1 || node.children.length === units) return;
  node.children.length = 0;
  for (let u = 1; u <= units; ++u) {
    const unit = new LibTreeNode();
    unit.type = LibTreeNodeType.UNIT;
    unit.parent = node;
    unit.name = `Unit ${letterSubReference(u)}`;
    unit.unit = u;
    unit.libNickname = node.libNickname;
    unit.libItemName = node.libItemName;
    unit.intrinsicRank = -u;
    node.children.push(unit);
  }
}

/**
 * LIB_SYMBOL::cacheSearchTerms + cacheChooserFields, weighted terms and the
 * optional-column values, once the item's `LIB_TREE_ITEM` face is known.
 *
 * Takes the projection rather than the `LIB_SYMBOL` because that is all it ever
 * read, and because the preload no longer keeps the symbols.
 * {@link populateFromSymbol} is the same thing for the call sites that do hold
 * a real symbol.
 */
export function populateItemNode(
  node: LibTreeNode,
  item: LibTreeItem,
  adapter?: LibTreeModelAdapter,
): void {
  const keywords = item.keywords;
  node.desc = item.description;
  node.footprint = item.footprint;
  node.isPower = item.isPower;
  node.isRoot = item.isRoot;
  node.pinCount = item.pinCount;
  node.sourceSearchTerms = [
    searchTerm(node.libNickname, 4),
    searchTerm(node.name, 8, true),
    searchTerm(node.libId, 16, true),
    ...keywords
      .split(/\s+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(item.description, 1),
  ];
  if (node.footprint) node.sourceSearchTerms.push(searchTerm(node.footprint, 1));

  // cacheChooserFields: fields flagged `(show_in_chooser yes)` become columns,
  // and "Keywords" is offered unless the symbol defines a field by that name.
  node.fields = new Map<string, string>(item.chooserFields);
  if (!node.fields.has('Keywords')) node.fields.set('Keywords', keywords);
  if (adapter) for (const name of node.fields.keys()) adapter.addColumnIfNecessary(name);
  node.rebuildSearchTerms(adapter?.getShownColumns() ?? []);

  addUnitRows(node, item.unitCount);
}

/** {@link populateItemNode}, from a symbol that is actually in hand. */
export function populateFromSymbol(
  node: LibTreeNode,
  sym: LibSymbol,
  adapter?: LibTreeModelAdapter,
): void {
  populateItemNode(node, libTreeItem(sym), adapter);
}

/** The eeschema.json slices the constructor and `loadColumnConfig` read. */
export interface SYMBOL_TREE_CONFIG {
  /** `m_SymChooserPanel.sort_mode`. */
  sortMode: SortMode;
  /** `m_LibTree.columns`. */
  columns: readonly string[];
}

export class SYMBOL_TREE_MODEL_ADAPTER extends LibTreeModelAdapter {
  /** `m_pending_load_libraries`. */
  private m_pending_load_libraries: LibIndexEntry[] = [];
  /** `m_check_pending_libraries_timer`. */
  private m_check_pending_libraries_timer: ReturnType<typeof setInterval> | null = null;
  /** `m_lazyLoadHandler`: the panel's refresh after a pass added rows. */
  private m_lazyLoadHandler: (() => void) | null = null;

  /**
   * `SYMBOL_TREE_MODEL_ADAPTER::SYMBOL_TREE_MODEL_ADAPTER` (:50-58) — the ONLY
   * adapter upstream that widens the base pair of available columns. Not
   * decoration: every shown column becomes a weight-4 search term in
   * `RebuildSearchTerms`, so it is part of this chooser's ranking as well as
   * its header — then `loadColumnConfig`'s persisted set.
   */
  constructor(aCfg: SYMBOL_TREE_CONFIG) {
    super();
    this.setSymbolChooserColumns();
    this.setSortMode(aCfg.sortMode);
    // loadColumnConfig: the persisted column set, defaulting to Item +
    // Description with "Item" forced to the front.
    if (aCfg.columns.length > 0) this.setShownColumns(aCfg.columns);
  }

  /** `SetLazyLoadHandler( std::function<void()> )` (lib_tree_model_adapter.h). */
  SetLazyLoadHandler(aHandler: (() => void) | null): void {
    this.m_lazyLoadHandler = aHandler;
  }

  /** The libraries still waiting to load (`m_pending_load_libraries`). */
  PendingLibraries(): readonly LibIndexEntry[] {
    return this.m_pending_load_libraries;
  }

  /**
   * `SYMBOL_TREE_MODEL_ADAPTER::AddLibraries` (:81-222), including the part
   * that decides WHICH libraries are in the tree at all.
   *
   * A library is added only when its status is LOADED; anything else goes in
   * `m_pending_load_libraries` and is skipped. A retry looks at the pending set
   * ALONE and adds to the tree already built, it does not rebuild it. While
   * anything is pending, a 1000 ms timer re-runs this until the set empties.
   *
   * One difference: the lazy-load handler runs after EVERY pass, not only a
   * lazy one that added something (:217-221) — the panel builds its tree after
   * it is shown, so the first pass is the one that has to refresh it too.
   */
  AddLibraries(aIndex: readonly LibIndexEntry[], aSource: SYMBOL_TREE_LIBRARY_SOURCE): void {
    // Built from the whole index, not per entry: the generator omits `power`
    // both for a library with none and for an index too old to carry the
    // flag, and only the index as a whole separates the two.
    const isPower = aSource.powerSymbolTest(aIndex);
    const pinned = aSource.pinnedLibraries();
    const toLoad =
      this.m_pending_load_libraries.length > 0 ? this.m_pending_load_libraries : aIndex;
    const stillPending: LibIndexEntry[] = [];

    for (const lib of toLoad) {
      // `if( !status || status->load_status != LOAD_STATUS::LOADED )
      //      { m_pending_load_libraries.insert( lib ); continue; }`
      if (!aSource.libraryLoaded(lib.name)) {
        stillPending.push(lib);
        continue;
      }

      const libNode = this.addLibrary(
        lib.name,
        aSource.libraryDescription(lib),
        pinned.includes(lib.name),
      );
      // `std::vector<LIB_SYMBOL*> libSymbols = m_adapter->GetSymbols( lib );`
      const symbols = new Map(
        (aSource.loadedLibraryItems(lib.name) ?? []).map((item) => [item.name, item]),
      );

      for (const name of lib.symbols) {
        const item = new LibTreeNode();
        item.type = LibTreeNodeType.ITEM;
        item.parent = libNode;
        item.name = name;
        item.libNickname = lib.name;
        item.libItemName = name;
        item.isPower = isPower(lib, name);
        item.sourceSearchTerms = [
          searchTerm(lib.name, 4),
          searchTerm(name, 8, true),
          searchTerm(`${lib.name}:${name}`, 16, true),
        ];
        // `LIB_SYMBOL::cacheSearchTerms` is SEVEN terms, not three
        // (eeschema/lib_symbol.cpp:160-183); the loaded item supplies the rest.
        const loaded = symbols.get(name);
        if (loaded) populateItemNode(item, loaded, this);
        // The unit rows are built with the node, from the count the index
        // carries, so a multi-unit part shows its expander before anything is
        // fetched.
        addUnitRows(item, lib.units?.[name] ?? 1);
        libNode.children.push(item);
      }

      this.finishLibrary(libNode);
    }

    this.m_pending_load_libraries = stillPending;
    this.tree.assignIntrinsicRanks();
    this.m_lazyLoadHandler?.();

    // `if( !m_pending_load_libraries.empty() && !m_check_pending_libraries_timer )`
    // — one timer, started once, stopped when nothing is pending.
    if (this.m_pending_load_libraries.length > 0 && !this.m_check_pending_libraries_timer) {
      this.m_check_pending_libraries_timer = setInterval(() => {
        this.AddLibraries(aIndex, aSource);

        if (this.m_pending_load_libraries.length === 0) this.StopPendingTimer();
      }, PENDING_LIBRARY_POLL_MS);
    }
  }

  /** `m_check_pending_libraries_timer->Stop(); .reset()` — also the destructor's. */
  StopPendingTimer(): void {
    if (this.m_check_pending_libraries_timer) {
      clearInterval(this.m_check_pending_libraries_timer);
      this.m_check_pending_libraries_timer = null;
    }
  }
}
