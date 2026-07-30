// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Widget displaying a tree of library items: filter box with its recent-search
 * menu and a sort/expand menu, the column tree (Item + the columns the user has
 * enabled), the hover preview popup, and the details pane fed by the adapter's
 * info generator. Mirrors kicad/common/widgets/lib_tree.cpp (LIB_TREE); the
 * wxDataViewCtrl becomes a scrollable flex list here.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { type LibTreeNode, LibTreeNodeType } from './lib_tree_model.js';
import { type LibTreeModelAdapter, SortMode, PINNING_SYMBOL } from './lib_tree_model_adapter.js';
import { SelectColumnsDialog } from './select_columns_dialog.js';
import { LibraryLoadingPanel } from './library_loading_panel.js';

/** LIB_TREE::RECENT_SEARCHES_MAX. */
const RECENT_SEARCHES_MAX = 10;
/** LIB_TREE HOVER_TIMER_MILLIS / PREVIEW_SIZE. */
const HOVER_TIMER_MILLIS = 400;
const PREVIEW_SIZE = { width: 240, height: 200 };

/** g_recentSearches, keyed like upstream by the tree's "recent searches key"
 *  ("symbols" / "power" / "footprints"), and equally long-lived. */
const gRecentSearches = new Map<string, string[]>();

export interface LibTreeProps {
  adapter: LibTreeModelAdapter;
  /** m_recentSearchesKey, which recent-search list this tree shares. */
  recentSearchesKey?: string;
  /** Bumped by the owner whenever it mutates the adapter (lazy library loads). */
  regenerateNonce?: number;
  /** Initial filter text (g_symbolSearchString persists it across openings). */
  initialSearch?: string;
  onSearchChanged?: (search: string) => void;
  /** EVT_LIBITEM_SELECTED, selection moved (null = no selection). */
  onSelect: (node: LibTreeNode | null) => void;
  /** EVT_LIBITEM_CHOSEN, double-click or Enter on an item/unit. */
  onChoose: (node: LibTreeNode) => void;
  /** A library row was expanded/collapsed (lazy load + open_libs persistence). */
  onToggleLibrary?: (node: LibTreeNode, open: boolean) => void;
  /** Pin/Unpin Library from the context menu; owner persists and re-sorts. */
  onPinLibrary?: (node: LibTreeNode, pinned: boolean) => void;
  /** Sort mode switched from the menu; owner persists it (SaveSettings). */
  onSortModeChanged?: (mode: SortMode) => void;
  /** Shown columns changed through the header's Select Columns dialog. */
  onShownColumnsChanged?: (columns: readonly string[]) => void;
  /** LIB_TREE_MODEL_ADAPTER::HasPreview/ShowPreview, the hover popup's content
   *  for a row, or null when that row has no preview. */
  renderPreview?: (node: LibTreeNode) => ReactNode;
  /** When the panel places the details pane elsewhere (no-footprints layout). */
  hasExternalDetails?: boolean;
  /** Libraries to open initially (EESCHEMA_SETTINGS m_LibTree.open_libs). */
  openLibs?: readonly string[];
}

interface Row {
  node: LibTreeNode;
  indent: number;
  expandable: boolean;
  open: boolean;
}

export function LibTree({
  adapter,
  recentSearchesKey = 'symbols',
  regenerateNonce = 0,
  initialSearch = '',
  onSearchChanged,
  onSelect,
  onChoose,
  onToggleLibrary,
  onPinLibrary,
  onSortModeChanged,
  onShownColumnsChanged,
  renderPreview,
  hasExternalDetails = false,
  openLibs,
}: LibTreeProps): JSX.Element {
  const [search, setSearch] = useState(initialSearch);
  const [sortMode, setSortModeState] = useState<SortMode>(adapter.getSortMode());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(openLibs ?? []));
  const [selected, setSelected] = useState<LibTreeNode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: LibTreeNode } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);
  const [columnsDialog, setColumnsDialog] = useState(false);
  const [preview, setPreview] = useState<{ node: LibTreeNode; top: number; left: number } | null>(
    null,
  );
  // The adapter's nodes are mutated in place; bump to re-render after a pass.
  const [version, setVersion] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<LibTreeNode, HTMLDivElement>());
  const debounce = useRef<number | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);

  const searching = search.trim().length > 0;
  const columns = adapter.getShownColumns();
  // Whether the hosted libraries have landed in the tree yet: the Recently Used
  // / Already Placed groups are always present, so an "empty" tree is one with
  // no real library rows.
  const hasLibraryRows = adapter.tree.children.some((n) => !n.isGroup);
  // Which hosted set this tree waits on, so a footprint fetch elsewhere in the
  // dialog can't make the symbol tree look like it is still loading.
  const loadingKind = recentSearchesKey === 'footprints' ? 'footprints' : 'symbols';

  const select = useCallback(
    (node: LibTreeNode | null) => {
      setSelected(node);
      setPreview(null); // onPreselect hides the hover preview
      onSelect(node);
    },
    [onSelect],
  );

  /** ExpandAncestors: make sure the node the adapter picked is reachable. */
  const expandAncestors = useCallback((node: LibTreeNode | null) => {
    if (!node) return;
    const keys: string[] = [];
    for (let p = node.parent; p; p = p.parent) {
      if (p.type === LibTreeNodeType.LIBRARY) keys.push(p.name);
      else if (p.type === LibTreeNodeType.ITEM) keys.push(p.libId);
    }
    if (keys.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  // Run the scoring/sorting pass; with a query the best match gets selected
  // (upstream UpdateSearchString + showResults).
  const regenerate = useCallback(
    (query: string, selectBest: boolean) => {
      const best = adapter.updateSearchString(query);
      setVersion((v) => v + 1);
      expandAncestors(best);
      if (selectBest) select(best);
    },
    [adapter, select, expandAncestors],
  );

  // Initial pass, ensures a preselect node is shown even with no query.
  useEffect(() => {
    regenerate(search, true);
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The owner loaded more libraries into the adapter (lazy load update).
  useEffect(() => {
    if (regenerateNonce > 0) regenerate(search, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenerateNonce]);

  /** updateRecentSearchMenu: the current query moves to the head of the list. */
  const updateRecentSearchMenu = useCallback(() => {
    const entry = searchRef.current?.value ?? '';
    if (!entry) return;
    const recents = gRecentSearches.get(recentSearchesKey) ?? [];
    const next = recents.filter((r) => r !== entry);
    if (next.length >= RECENT_SEARCHES_MAX) next.pop();
    next.unshift(entry);
    gRecentSearches.set(recentSearchesKey, next);
  }, [recentSearchesKey]);

  const onQueryText = (value: string) => {
    setSearch(value);
    onSearchChanged?.(value);
    // Upstream debounces tree regeneration behind a 200 ms timer.
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => regenerate(value, true), 200);
  };

  const setSortMode = (mode: SortMode) => {
    adapter.setSortMode(mode);
    setSortModeState(mode);
    onSortModeChanged?.(mode);
    regenerate(search, false);
  };

  const keyOf = (node: LibTreeNode): string =>
    node.type === LibTreeNodeType.LIBRARY ? node.name : node.libId;

  const setOpen = (node: LibTreeNode, open: boolean) => {
    const key = keyOf(node);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
    if (node.type === LibTreeNodeType.LIBRARY) onToggleLibrary?.(node, open);
  };

  const toggle = (node: LibTreeNode) => setOpen(node, !isOpen(node));

  const isOpen = (node: LibTreeNode): boolean => {
    // While searching, library ancestors of matches are auto-expanded
    // (showResults expands ancestors; unit rows stay collapsed).
    if (searching && node.type === LibTreeNodeType.LIBRARY && node.score > 1) return true;
    return expanded.has(keyOf(node));
  };

  // ExpandAll/CollapseAll act on the whole tree control, so multi-unit symbols
  // open too, not just the library rows.
  const expandCollapseAll = (expand: boolean) => {
    if (!expand) {
      setExpanded(new Set());
      return;
    }
    const all = new Set<string>();
    for (const lib of adapter.tree.children) {
      all.add(lib.name);
      onToggleLibrary?.(lib, true);
      for (const item of lib.children) if (item.children.length > 0) all.add(item.libId);
    }
    setExpanded(all);
  };

  // Flatten the visible rows; zero-score nodes are filtered out while a
  // query is active (they aren't in the wxDataViewCtrl at all upstream).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const lib of adapter.tree.children) {
      if (searching && lib.score <= 0) continue;
      const libOpen = isOpen(lib);
      out.push({ node: lib, indent: 0, expandable: true, open: libOpen });
      if (!libOpen) continue;
      for (const item of lib.children) {
        if (searching && item.score <= 0) continue;
        const itemOpen = item.children.length > 0 && isOpen(item);
        out.push({ node: item, indent: 1, expandable: item.children.length > 0, open: itemOpen });
        if (itemOpen) {
          for (const unit of item.children)
            out.push({ node: unit, indent: 2, expandable: false, open: false });
        }
      }
    }
    return out;
    // `version` re-flattens after each in-place scoring/sorting pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, searching, expanded, version, sortMode, regenerateNonce, selected]);

  useEffect(() => {
    if (selected) rowRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' });
  }, [selected, rows]);

  // Arrow keys move the selection whether they come from the search box or
  // the tree (upstream onQueryCharHook forwards them to the tree control).
  const onNavKey = (e: React.KeyboardEvent): void => {
    const inSearchBox = (e.target as HTMLElement).tagName === 'INPUT';

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      updateRecentSearchMenu();
      const idx = rows.findIndex((r) => r.node === selected);
      const next =
        e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
      if (rows[next]) select(rows[next]!.node);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      updateRecentSearchMenu();
      if (selected) activate(selected);
    } else if (e.key === '+' || e.key === 'Add') {
      // WXK_ADD / WXK_SUBTRACT expand and collapse the selected library from
      // either control.
      if (selected?.type === LibTreeNodeType.LIBRARY) {
        e.preventDefault();
        updateRecentSearchMenu();
        setOpen(selected, true);
      }
    } else if (e.key === '-' || e.key === 'Subtract') {
      if (selected?.type === LibTreeNodeType.LIBRARY) {
        e.preventDefault();
        updateRecentSearchMenu();
        setOpen(selected, false);
      }
    } else if (!inSearchBox && selected && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      // Bare Left/Right expand/collapse, but only from the tree, the search
      // box keeps normal caret movement (onTreeCharHook).
      e.preventDefault();
      setOpen(selected, e.key === 'ArrowRight');
    }
  };

  // wxEVT_DATAVIEW_ITEM_ACTIVATED: double-click/Enter on a container toggles
  // it, on an item/unit it chooses the item.
  const activate = (node: LibTreeNode) => {
    setPreview(null); // onTreeActivate hides the preview
    if (node.type === LibTreeNodeType.LIBRARY) toggle(node);
    else if (!node.parent?.isGroup || node.libId) onChoose(node);
  };

  // Hover preview: a 240x200 popup pinned to the tree's right edge after the
  // cursor rests on a row for 400 ms. Never shown for the selected row.
  const cancelHover = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  }, []);

  const onRowHover = (node: LibTreeNode, e: React.MouseEvent) => {
    if (!renderPreview) return;
    cancelHover();
    if (node === selected) {
      setPreview(null);
      return;
    }
    const y = e.clientY;
    hoverTimer.current = window.setTimeout(() => {
      // showPreview: the tree's right edge minus 10, centred on the cursor.
      const left = (listRef.current?.getBoundingClientRect().right ?? 0) - 10;
      setPreview({ node, top: y - PREVIEW_SIZE.height / 2, left });
    }, HOVER_TIMER_MILLIS);
  };

  const hidePreview = useCallback(() => {
    cancelHover();
    setPreview(null);
  }, [cancelHover]);

  useEffect(() => cancelHover, [cancelHover]);

  const sortMenuAction = (action: () => void) => () => {
    action();
    setMenuOpen(false);
  };

  const sortMenu = menuOpen && (
    <div className="ze-libtree-menu" onMouseLeave={() => setMenuOpen(false)}>
      <div className="item" onClick={sortMenuAction(() => setSortMode(SortMode.BEST_MATCH))}>
        <span className="check">{sortMode === SortMode.BEST_MATCH ? '✓' : ''}</span>
        Sort by Best Match
      </div>
      <div className="item" onClick={sortMenuAction(() => setSortMode(SortMode.ALPHABETIC))}>
        <span className="check">{sortMode === SortMode.ALPHABETIC ? '✓' : ''}</span>
        Sort Alphabetically
      </div>
      <div className="sep" />
      <div className="item" onClick={sortMenuAction(() => expandCollapseAll(true))}>
        <span className="check" />
        Expand All
      </div>
      <div className="item" onClick={sortMenuAction(() => expandCollapseAll(false))}>
        <span className="check" />
        Collapse All
      </div>
    </div>
  );

  // The search control's magnifier menu: the last 10 searches, or a disabled
  // "recent searches" placeholder (updateRecentSearchMenu).
  const recents = gRecentSearches.get(recentSearchesKey) ?? [];
  const recentMenu = recentOpen && (
    <div className="ze-libtree-menu" onMouseLeave={() => setRecentOpen(false)}>
      {recents.length === 0 ? (
        <div className="item disabled">
          <span className="check" />
          recent searches
        </div>
      ) : (
        recents.map((r) => (
          <div
            key={r}
            className="item"
            onClick={() => {
              setRecentOpen(false);
              onQueryText(r);
            }}
          >
            <span className="check" />
            {r}
          </div>
        ))
      )}
    </div>
  );

  const contextMenu = ctxMenu && (
    <div
      className="ze-libtree-menu ctx"
      style={{ left: ctxMenu.x, top: ctxMenu.y }}
      onMouseLeave={() => setCtxMenu(null)}
    >
      {/* LIB_TREE::onItemContextMenu: Pin/Unpin only, on library rows only,
          Expand/Collapse All live in the sort-button menu, not here. */}
      {ctxMenu.node.type === LibTreeNodeType.LIBRARY && !ctxMenu.node.isGroup ? (
        <div
          className="item"
          onClick={() => {
            onPinLibrary?.(ctxMenu.node, !ctxMenu.node.pinned);
            setCtxMenu(null);
            regenerate(search, false);
          }}
        >
          <span className="check" />
          {ctxMenu.node.pinned ? 'Unpin Library' : 'Pin Library'}
        </div>
      ) : null}
    </div>
  );

  // LIB_TREE::onHeaderContextMenu, a single "Select Columns..." entry opening
  // the reorderable Available/Enabled list.
  const headerContextMenu = headerMenu && (
    <div
      className="ze-libtree-menu ctx"
      style={{ left: headerMenu.x, top: headerMenu.y }}
      onMouseLeave={() => setHeaderMenu(null)}
    >
      <div
        className="item"
        onClick={() => {
          setHeaderMenu(null);
          setColumnsDialog(true);
        }}
      >
        <span className="check" />
        Select Columns...
      </div>
    </div>
  );

  const cellValue = (node: LibTreeNode, column: string): string =>
    column === 'Description' ? node.desc : (node.fields.get(column) ?? '');

  return (
    <div className="ze-libtree" onKeyDown={onNavKey}>
      <div className="ze-libtree-search">
        <div className="ze-libtree-recent-wrap">
          <button
            type="button"
            className="ze-libtree-recentbtn"
            title="Recent searches"
            onClick={() => setRecentOpen((o) => !o)}
          >
            🔍
          </button>
          {recentMenu}
        </div>
        <input
          ref={searchRef}
          className="ze-search"
          type="search"
          placeholder="Filter"
          value={search}
          onChange={(e) => onQueryText(e.target.value)}
          onKeyDown={(e) => {
            // First escape cancels the search string (OnChar in the panel);
            // an empty box lets it bubble up to close the dialog.
            if (e.key === 'Escape' && search) {
              e.stopPropagation();
              onQueryText('');
            }
          }}
        />
        <div className="ze-libtree-sortbtn-wrap">
          <button
            type="button"
            className="ze-libtree-sortbtn"
            title="Sort and expand options"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⚙
          </button>
          {sortMenu}
        </div>
      </div>

      <div
        className="ze-libtree-cols"
        onContextMenu={(e) => {
          e.preventDefault();
          setHeaderMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {columns.map((col) => (
          <span key={col} className={col === 'Item' ? 'col-item' : 'col-desc'}>
            {col}
          </span>
        ))}
      </div>

      <div
        className="ze-libtree-list"
        ref={listRef}
        tabIndex={0}
        onMouseLeave={hidePreview}
        onScroll={hidePreview}
      >
        {rows.map(({ node, indent, expandable, open }) => (
          <div
            key={`${node.parent?.name ?? ''}/${node.libId || node.name}${node.type === LibTreeNodeType.UNIT ? `#${node.unit}` : ''}`}
            ref={(el) => {
              el ? rowRefs.current.set(node, el) : rowRefs.current.delete(node);
            }}
            className={
              `ze-libtree-row${node === selected ? ' active' : ''}` +
              (node.type === LibTreeNodeType.LIBRARY ? ' lib' : '')
            }
            style={{ paddingLeft: 4 + indent * 16 }}
            onClick={() => select(node)}
            onDoubleClick={() => activate(node)}
            onMouseMove={(e) => onRowHover(node, e)}
            onContextMenu={(e) => {
              e.preventDefault();
              hidePreview();
              select(node);
              // LIB_TREE::onItemContextMenu: the row menu exists only for
              // pinnable (non-group) library rows.
              if (node.type === LibTreeNodeType.LIBRARY && !node.isGroup)
                setCtxMenu({ x: e.clientX, y: e.clientY, node });
            }}
            title={node.libId || node.name}
          >
            <span
              className={`twisty${expandable ? ' expandable' : ''}${open ? ' open' : ''}`}
              onClick={(e) => {
                if (expandable) {
                  e.stopPropagation();
                  toggle(node);
                }
              }}
            />
            {/* Names of non-root (derived) symbols are italicised, and a pinned
                library carries the ☆ mark (GetAttr / GetPinningSymbol). */}
            <span
              className="col-item"
              style={
                node.type === LibTreeNodeType.ITEM && !node.isRoot
                  ? { fontStyle: 'italic' }
                  : undefined
              }
            >
              {node.pinned ? PINNING_SYMBOL : ''}
              {node.name}
            </span>
            {columns.slice(1).map((col) => (
              <span key={col} className="col-desc">
                {cellValue(node, col)}
              </span>
            ))}
          </div>
        ))}
        {/* LIB_TREE has its libraries in hand by the time it is shown; ours
            are still arriving, so the pane says so where the rows will be,
            the "Recently Used"/"Already Placed" groups sit above, which is why
            this keys off library rows rather than an empty tree. */}
        {!hasLibraryRows && (
          <LibraryLoadingPanel
            kind={loadingKind}
            fallback={
              rows.length === 0 ? (
                <div className="ze-muted" style={{ padding: 8 }}>
                  No matches
                </div>
              ) : null
            }
          />
        )}
      </div>

      {preview && renderPreview && (
        <div
          className="ze-libtree-preview"
          style={{
            width: PREVIEW_SIZE.width,
            height: PREVIEW_SIZE.height,
            top: Math.max(4, preview.top),
            left: preview.left,
          }}
        >
          {renderPreview(preview.node)}
        </div>
      )}

      {!hasExternalDetails && (
        <div
          className="ze-libtree-details"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: generateInfo HTML-escapes all library data (generate_alias_info)
          dangerouslySetInnerHTML={{
            __html: selected && selected.libId ? adapter.generateInfo(selected) : '',
          }}
        />
      )}
      {contextMenu}
      {headerContextMenu}
      {columnsDialog && (
        <SelectColumnsDialog
          available={adapter.getAvailableColumns()}
          enabled={adapter.getShownColumns()}
          onOk={(cols) => {
            setColumnsDialog(false);
            adapter.setShownColumns(cols);
            onShownColumnsChanged?.(adapter.getShownColumns());
            regenerate(search, false);
          }}
          onCancel={() => setColumnsDialog(false)}
        />
      )}
    </div>
  );
}
