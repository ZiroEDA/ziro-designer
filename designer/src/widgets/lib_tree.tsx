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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { type LibTreeNode, LibTreeNodeType } from './lib_tree_model.js';
import {
  type LibTreeModelAdapter,
  type LibTreeNodeAttr,
  SortMode,
  LIB_TREE_INDENT,
  PINNING_SYMBOL,
} from './lib_tree_model_adapter.js';
import { SelectColumnsDialog } from './select_columns_dialog.js';
import { useModalEscape } from '../ui/useModalEscape.js';
import { bitmapUrl } from '../ui/toolbarIcons.js';

/**
 * `wxDataViewItemAttr` as CSS. `SetColour( wxSYS_COLOUR_GRAYTEXT )` becomes
 * the `--ctl-fg-disabled` token rather than a literal: GRAYTEXT is a system
 * colour, that token is where `shell.css` already keeps it (#929292 on this
 * machine, measured), and every other greyed thing in the app reads it there.
 */
/**
 * The "this is the item on the canvas" marker, `LIB_TREE_RENDERER::Render`
 * (common/lib_tree_model_adapter.cpp:100-116).
 *
 * Six points: a rectangle whose right edge is pulled into a point at half
 * height, drawn one pixel wide in white on a dark theme and black on a light
 * one (`KIPLATFORM::UI::IsDarkTheme()`). Upstream's own coordinates:
 *
 *     topLeft, topRight+(-4,0), topRight+(0,h/2),
 *     bottomRight+(-4,1), bottomLeft+(0,1), topLeft
 *
 * An SVG rather than a border, because a border cannot make that notch.
 *
 * `aRect` is the CELL, not the row: `LIB_TREE_RENDERER` is a
 * `wxDataViewCustomRenderer` and wx hands each renderer the rectangle of the
 * column it is attached to, so the marker closes around the Item cell and the
 * Description is outside it. Drawn across the whole row instead - which is what
 * this did - the point lands at the row's full scroll width, some 740 px past
 * the right-hand edge of a 250 px dock, so all that is ever on screen is a left
 * edge and two rules running off the side.
 */
function CanvasItemOutline({ left, width }: { left: number; width: number }): JSX.Element {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const ref = useCallback((el: SVGSVGElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({ w: Math.round(r.width), h: Math.round(r.height) });
  }, []);
  // Upstream's six points, verbatim. The notch is 4 device pixels whatever the
  // row is wide, so the shape is measured rather than expressed as a ratio -
  // a viewBox scaled with preserveAspectRatio would stretch the point.
  const pts = box
    ? `0,0 ${box.w - 4},0 ${box.w},${box.h / 2} ${box.w - 4},${box.h} 0,${box.h} 0,0`
    : '';
  return (
    <svg className="ze-libtree-canvasitem" ref={ref} aria-hidden="true" style={{ left, width }}>
      {box && <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1" />}
    </svg>
  );
}

function itemCellStyle(attr: LibTreeNodeAttr): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (attr.bold) style.fontWeight = 700;
  if (attr.italic) style.fontStyle = 'italic';
  // NOT strikethrough, despite the attribute's name. `LIB_TREE_RENDERER::SetAttr`
  // reads `GetStrikethrough()` as a flag - "use strikethrough as a proxy for
  // is-canvas-item" - and then explicitly clears it,
  // `realAttr.SetStrikethrough( false )` (common/lib_tree_model_adapter.cpp:89-97),
  // so a line is never drawn. `Render` draws a 6-point outline around the row
  // instead. See `canvasItemOutline`.
  if (attr.greyed) style.color = 'var(--ctl-fg-disabled)';
  return Object.keys(style).length > 0 ? style : undefined;
}

/** LIB_TREE::RECENT_SEARCHES_MAX. */
const RECENT_SEARCHES_MAX = 10;
/** LIB_TREE HOVER_TIMER_MILLIS / PREVIEW_SIZE. */
const HOVER_TIMER_MILLIS = 400;
const PREVIEW_SIZE = { width: 240, height: 200 };

/** g_recentSearches, keyed like upstream by the tree's "recent searches key"
 *  ("symbols" / "power" / "footprints"), and equally long-lived. */
const gRecentSearches = new Map<string, string[]>();

/**
 * The two icons a `wxSearchCtrl` shows.
 *
 * KiCad draws NEITHER of them. `LIB_TREE` asks for a `wxSearchCtrl` and calls
 * `ShowCancelButton( true )` (common/widgets/lib_tree.cpp:79-81); on GTK3 that
 * is a `GtkSearchEntry`, and the two glyphs it puts in its primary and
 * secondary icon slots come from the ICON THEME - `edit-find-symbolic` and
 * `edit-clear-symbolic`. `qa/probes/chooser_shell_probe.cpp` asks a real one:
 *
 *   primary   edit-find-symbolic    16x16 at x 9   of a 34px-tall entry
 *   secondary edit-clear-symbolic   16x16 at x 385 of a 410px-wide entry
 *
 * so both are 16x16 inset 9px from their end. The active theme here is
 * Yaru-dark, whose icons live in /usr/share/icons/Yaru/scalable/actions/; the
 * path data below is those two files verbatim, with the theme's own `gray` /
 * `#808080` fill replaced by `currentColor` because GTK recolours a symbolic
 * icon to the style's colour (--entry-icon-fg).
 *
 * A generic magnifier and a bare "✕" are what we had, and the clear glyph in
 * particular is not an ✕ at all: it is a backspace-shaped tag with the ✕ inside
 * it, which is the single most recognisable thing in that row.
 */
function EditFindSymbolic(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 1C3.69 1 1 3.69 1 7s2.69 6 6 6a5.948 5.948 0 0 0 3.664-1.273l2.863 2.863 1.063-1.063-2.863-2.863A5.949 5.949 0 0 0 13 7c0-3.31-2.69-6-6-6zm0 1a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5z"
      />
    </svg>
  );
}

function EditClearSymbolic(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="m4.9336 3-4.2227 4.2227-0.0039062-0.0039062-0.70703 0.70703 0.0039063 0.0039063-0.0039063 0.0039063 0.70703 0.70703 0.0039062-0.0039062 3.0469 3.0488 1.2422 1.2402v2e-3l0.072266 0.072219h10.928v-10h-11zm0.41406 1h9.6523v8h-9.5117l-4.0703-4.0703zm2.3594 1-0.70703 0.70703 2.2969 2.2969-2.2969 2.2988 0.70703 0.70703 2.2969-2.2988 2.2988 2.2988 0.70703-0.70703-2.2988-2.2988 2.2988-2.2969-0.70703-0.70703-2.2988 2.2969z"
      />
    </svg>
  );
}

export interface LibTreeProps {
  adapter: LibTreeModelAdapter;
  /**
   * `LIB_TREE::FLAGS::FILTERS` and the `m_filtersSizer` it builds
   * (common/widgets/lib_tree.cpp:165-169): a slot between the search control
   * and the tree that the tree's OWNER fills. Undefined is the flag unset.
   */
  filters?: ReactNode;
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
  /**
   * `m_adapter->GetContextMenuTool()` (`common/widgets/lib_tree.cpp:1056-1066`).
   *
   * `onItemContextMenu` selects the row under the pointer and then, if the
   * adapter names a tool, shows THAT TOOL's menu:
   *
   *     if( TOOL_INTERACTIVE* tool = m_adapter->GetContextMenuTool() )
   *     {   tool->Activate(); … tool->GetToolMenu().ShowContextMenu(); }
   *     else { … ACTIONS::pinLibrary / unpinLibrary on a library row … }
   *
   * The Pin/Unpin pair below is upstream's ELSE branch, not its only one: it is
   * what the chooser gets, because `LIB_TREE_MODEL_ADAPTER::GetContextMenuTool`
   * returns `nullptr` (`include/lib_tree_model_adapter.h:362`) and only the two
   * library editors override it. Ours had the else branch and no way to reach
   * the other, so a frame with a fifteen-row tree menu could not mount this
   * widget without losing it.
   *
   * Supplying this handler IS the adapter naming a tool: the owner draws the
   * menu, because the menu is the frame's, evaluated against the row that was
   * clicked — which this widget has already selected by the time it calls.
   */
  onItemContextMenu?: (node: LibTreeNode, x: number, y: number) => void;
  /**
   * `LIB_TREE::Unselect()` (`common/widgets/lib_tree.cpp:393`), driven as a
   * nonce: each new value clears the tree's selection.
   *
   * `FOOTPRINT_TREE_PANE::onComponentSelected` calls it immediately after the
   * double-click has loaded the footprint, with its own reason — "Make sure
   * current-part highlighting doesn't get lost in seleciton highlighting"
   * (`pcbnew/footprint_tree_pane.cpp:88-93`). The current part is drawn STRUCK
   * THROUGH by `FP_TREE_SYNCHRONIZING_ADAPTER::GetAttr`, and a selected row
   * would paint the highlight band over it.
   */
  unselectNonce?: number;
  /**
   * `SaveSettings`' `m_cfg.column_widths` (`common/lib_tree_model_adapter.cpp:240-245`)
   * — the header was dragged, so the owner persists the adapter's new widths.
   */
  onColumnWidthsChanged?: (widths: Record<string, number>) => void;
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
  /**
   * `LIB_TREE::SelectLibId( aLibId )` (`common/widgets/lib_tree.cpp:375-384`),
   * driven as a prop: whenever this changes, the row it names is found, its
   * ancestors are expanded and it is selected.
   *
   *     wxDataViewItem item = m_adapter->FindItem( aLibId );
   *     if( item.IsOk() ) m_tree_ctrl->ExpandAncestors( item );
   *     selectIfValid( item );
   *
   * A frame's only way of making the tree follow the canvas —
   * `SYMBOL_EDIT_FRAME` calls it after every load and after `AddLibraryFile`.
   * Either half of a LIB_ID: `"Device"` names the library row, `"Device:R"`
   * the symbol.
   */
  selectLibId?: string;
}

interface Row {
  node: LibTreeNode;
  indent: number;
  expandable: boolean;
  open: boolean;
}

/**
 * Rows kept above and below the viewport so a scroll of a frame or two has
 * something to show before the next render lands.
 *
 * Not a KiCad number, and not a theme value: upstream's `wxDataViewCtrl` is
 * virtual natively (`LIB_TREE_MODEL_ADAPTER` derives from
 * `wxDataViewModel`, and the control asks for the rows it is about to draw),
 * so there is no upstream constant to mirror. It is a pure render knob.
 */
const ROW_OVERSCAN = 12;

/**
 * What a row spends before its Item cell: the 4px lead-in, the 12px expander
 * and the two 4px flex gaps around it, all of them `.ze-libtree-row`'s in
 * shell.css. The Item cell is the rest of the column, so the second column
 * starts under its own header — upstream the expander is drawn INSIDE the
 * cell rect and this arithmetic is the control's.
 */
const ROW_LEAD_IN = 4;
const TWISTY_W = 12;
const CELL_GAP = 4;

/**
 * The on-screen row pitch, from the same tokens the stylesheet lays the rows
 * out with — `--ui-text-height` inside `--libtree-row-pad` above and below,
 * plus `--libtree-row-sep`, GtkTreeView's vertical-separator. The sum is the
 * pitch either way; the separator sits inside the row's own box rather than
 * between two boxes, because that is the rectangle the selection fills
 * (`qa/probes/libtree_selection_probe.cpp`).
 *
 * That is `LIB_TREE::SetRowHeight`'s `FromDIP( 6 ) + GetTextExtent( "pdI" ).y`
 * = 24, plus GtkTreeView's `vertical-separator` = 26, both of which
 * `qa/probes/libtree_rowheight_probe.cpp` measured and shell.css records. It is
 * read from the tokens rather than restated so a theme change moves the
 * virtual window with the rows; the measurement below then corrects it against
 * a row that is actually on screen, which is the only fully authoritative
 * answer once fonts have loaded.
 */
/**
 * `doAddColumn`'s width for a column `m_colWidths` does not name
 * (common/lib_tree_model_adapter.cpp:481-486):
 *
 *     // The extent of the text doesn't take into account the space on either
 *     // side in the header, so artificially pad it
 *     wxSize headerMinWidth = KIUI::GetTextSize( translatedHeader + wxT( "MMM" ), m_widget );
 *
 * — the header's own text extent in the window's font, plus three Ms. The font
 * comes from the same computed `--ui-font-*` the header is drawn in rather than
 * a literal, so this measures the face that is really on screen.
 */
const headerWidths = new Map<string, number>();

function headerMinWidth(header: string): number {
  const cached = headerWidths.get(header);
  if (cached !== undefined) return cached;

  const root = getComputedStyle(document.documentElement);
  const ctx = document.createElement('canvas').getContext('2d');
  let width = 0;
  if (ctx) {
    ctx.font = `bold ${root.getPropertyValue('--ui-font-size').trim()} ${root
      .getPropertyValue('--ui-font-family')
      .trim()}`;
    width = Math.ceil(ctx.measureText(`${header}MMM`).width);
  }
  headerWidths.set(header, width);
  return width;
}

function rowPitchFromTokens(): number {
  const root = getComputedStyle(document.documentElement);
  const px = (name: string): number => Number.parseFloat(root.getPropertyValue(name)) || 0;
  return px('--ui-text-height') + 2 * px('--libtree-row-pad') + px('--libtree-row-sep');
}

export function LibTree({
  adapter,
  filters,
  recentSearchesKey = 'symbols',
  regenerateNonce = 0,
  initialSearch = '',
  onSearchChanged,
  onSelect,
  onChoose,
  onToggleLibrary,
  onPinLibrary,
  onItemContextMenu,
  unselectNonce = 0,
  onColumnWidthsChanged,
  onSortModeChanged,
  onShownColumnsChanged,
  renderPreview,
  hasExternalDetails = false,
  openLibs,
  selectLibId,
}: LibTreeProps): JSX.Element {
  const [search, setSearch] = useState(initialSearch);
  const [sortMode, setSortModeState] = useState<SortMode>(adapter.getSortMode());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(openLibs ?? []));
  const [selected, setSelected] = useState<LibTreeNode | null>(null);
  /** The node `CenterLibId` was asked to centre, pending a laid-out `rows`. */
  const [pendingCenter, setPendingCenter] = useState<LibTreeNode | null>(null);
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
  /** Bumped while a header edge is being dragged; see `startColumnResize`. */
  const [colWidthNonce, setColWidthNonce] = useState(0);
  /**
   * The scrolled window: which slice of `rows` is in the DOM.
   *
   * `wxDataViewCtrl` is a virtual control — it asks the model for the rows it
   * is about to paint and no others, which is why upstream can hold 22 784
   * symbols in the chooser and scroll it smoothly. We rendered every row, so
   * expanding the libraries put 23 007 row elements (about 92 000 elements with
   * their cells) into the document, and every scored keystroke re-rendered all
   * of them.
   */
  const [win, setWin] = useState({ top: 0, height: 0, pitch: 0, gap: 0 });

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** The column header, scrolled sideways with the rows: upstream they are one
   *  control and share one horizontal scroll position. */
  const headerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<LibTreeNode, HTMLDivElement>());
  const debounce = useRef<number | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);

  const searching = search.trim().length > 0;
  const columns = adapter.getShownColumns();
  /**
   * Each column's width in px, the adapter's table first and the header's own
   * extent for anything it does not name — `doAddColumn`'s two cases, in its
   * order. They are FIXED: a wxDataViewColumn is created at a width and keeps
   * it, and when the columns are wider than the control the control scrolls
   * horizontally. Nothing upstream divides the pane into proportions.
   */
  const colWidths = useMemo(
    () => columns.map((col) => adapter.getColumnWidth(col) ?? headerMinWidth(col)),
    // `colWidthNonce` re-reads the adapter after a drag has written to it, the
    // way `recreateColumns` re-reads `m_colWidths`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, columns, colWidthNonce],
  );

  /**
   * `wxDATAVIEW_COL_RESIZABLE` with `col->SetMinWidth( headerMinWidth.x )`
   * (`doAddColumn`, common/lib_tree_model_adapter.cpp:490-495): every column in
   * this tree can be dragged, and none of them narrower than its own header
   * plus three Ms. The grip is the header cell's right edge — GTK draws no
   * pixels of its own for it, so neither does this.
   */
  const startColumnResize = (index: number, e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const col = columns[index];
    if (!col) return;
    const startX = e.clientX;
    const startW = colWidths[index] ?? 0;
    const min = headerMinWidth(col);
    const onMove = (ev: MouseEvent): void => {
      const next = Math.max(min, Math.round(startW + ev.clientX - startX));
      adapter.setColumnWidth(col, next);
      setColWidthNonce((n) => n + 1);
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onColumnWidthsChanged?.(adapter.getColumnWidths());
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const select = useCallback(
    (node: LibTreeNode | null) => {
      setSelected(node);
      setPreview(null); // onPreselect hides the hover preview
      onSelect(node);
    },
    [onSelect],
  );

  /** `m_adapter->FindItem( aLibId )` — the node a LIB_ID names, either half. */
  const findByLibId = useCallback(
    (libId: string): LibTreeNode | null => {
      if (!libId) return null;
      for (const lib of adapter.tree.children) {
        if (lib.name === libId) return lib;
        for (const item of lib.children) if (item.libId === libId) return item;
      }
      return null;
    },
    [adapter],
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

  /**
   * `LIB_TREE::SelectLibId`. Keyed on the prop, not on every render, so a frame
   * that keeps handing over the same id does not fight the user's own clicks —
   * upstream calls it once per load, not once per paint. It also re-runs on
   * `regenerateNonce`, because the node the id names does not exist until the
   * owner has put it in the adapter.
   */
  useEffect(() => {
    if (!selectLibId) return;
    const node = findByLibId(selectLibId);
    if (!node) return;
    expandAncestors(node);
    select(node);
    // `SelectLibId` then `CenterLibId` on the next idle - the pair the symbol
    // editor issues after LOADING a symbol (symbol_editor.cpp:208-213). This is
    // the only path that centres; a click just selects.
    setPendingCenter(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectLibId, regenerateNonce]);

  /**
   * `LIB_TREE::Unselect()`. Keyed on the nonce alone: a frame calls it at a
   * moment, not in a state, and re-running it on every render would fight the
   * user's next click.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the nonce IS the call
  useEffect(() => {
    if (unselectNonce > 0) select(null);
  }, [unselectNonce]);

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

  // PANEL_SYMBOL_CHOOSER::OnChar: "first escape cancels search string value",
  // and only then does Esc reach the dialog. That ordering is exactly what the
  // modal stack expresses - the tree registers above the dialog that contains
  // it, and drops off again the moment the box is empty.
  useModalEscape(() => onQueryText(''), search !== '');

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

  /**
   * ExpandAll/CollapseAll act on the whole tree control, so multi-unit symbols
   * open too, not just the library rows.
   *
   * It notifies `onToggleLibrary` for NOTHING. `LIB_TREE::ExpandAll`
   * (common/widgets/lib_tree.cpp:426-431) only walks the dataview and expands
   * items; it cannot load anything, because `IFACE::PreloadLibraries` already
   * made every library resident. Ours used to call `onToggleLibrary` for every
   * library, which is the chooser's lazy-load hook — so one click on "Expand
   * All" asked the bucket for all 223 hosted libraries, 219.7 MB. The rows
   * still open; the ones whose library has not been fetched show their names
   * without descriptions, which is the price of loading on demand and is much
   * cheaper than the alternative.
   */
  const expandCollapseAll = (expand: boolean) => {
    if (!expand) {
      setExpanded(new Set());
      return;
    }
    const all = new Set<string>();
    for (const lib of adapter.tree.children) {
      all.add(lib.name);
      for (const item of lib.children) if (item.children.length > 0) all.add(item.libId);
    }
    setExpanded(all);
  };

  /**
   * `PANEL_SYMBOL_CHOOSER::onOpenLibsTimer` -> `LIB_TREE_MODEL_ADAPTER::OpenLibs`
   * (eeschema/widgets/panel_symbol_chooser.cpp:534-538,
   * common/lib_tree_model_adapter.cpp:220-232): the libraries the user had open
   * last time are expanded once the tree exists.
   *
   * `openLibs` already seeds `expanded`, so they LOOK open — but nothing ever
   * told the owner, so the lazy-load hook never ran for them and a restored
   * library sat there showing bare names until the user collapsed and
   * re-expanded it. Upstream has no such gap: expanding is free there.
   *
   * Upstream defers this behind a 300 ms one-shot timer, and says why — "a
   * gross hack to keep GTK from garbling the display" (panel_symbol_chooser.cpp:273-276).
   * That is a GTK repaint problem, not a rule, so this runs on mount.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only, like the one-shot timer
  useEffect(() => {
    for (const lib of openLibs ?? []) {
      const node = adapter.tree.children.find((n) => !n.isGroup && n.name === lib);
      if (node) onToggleLibrary?.(node, true);
    }
  }, []);

  // Flatten the visible rows; zero-score nodes are filtered out while a
  // query is active (they aren't in the wxDataViewCtrl at all upstream).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const lib of adapter.tree.children) {
      if (!adapter.isVisible(lib, searching)) continue;
      const libOpen = isOpen(lib);
      out.push({ node: lib, indent: 0, expandable: true, open: libOpen });
      if (!libOpen) continue;
      for (const item of lib.children) {
        if (!adapter.isVisible(item, searching)) continue;
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

  /**
   * Re-read the scroll position and the row pitch.
   *
   * The pitch comes from the tokens until there is a row on screen to measure,
   * and from the row after that: fonts, zoom and the theme all move it, and a
   * window built on a stale pitch shows the wrong rows rather than merely
   * slowly.
   */
  const remeasure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector('.ze-libtree-row');
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const pitch = row ? row.getBoundingClientRect().height + gap : rowPitchFromTokens();
    const top = list.scrollTop;
    const height = list.clientHeight;
    setWin((prev) =>
      prev.top === top && prev.height === height && prev.pitch === pitch && prev.gap === gap
        ? prev
        : { top, height, pitch, gap },
    );
  }, []);

  // The first measurement needs a committed layout, and every later one needs
  // to survive the pane being resized by the chooser's sash.
  useEffect(() => {
    remeasure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(remeasure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [remeasure]);

  // A shorter list can leave the viewport scrolled past its own end.
  useEffect(remeasure, [remeasure, rows.length]);

  /**
   * The slice of `rows` that is actually rendered, and the two spacers that
   * stand in for the rest.
   *
   * The spacers are flex items in the same `row-gap` column as the rows, so
   * each of them replaces one gap as well as its rows: a run of `n` rows is
   * `n * pitch - gap` tall, and the gap the flex container puts beside the
   * spacer supplies the missing one. That keeps every row at exactly
   * `index * pitch`, which is what the scroll maths above assumes.
   */
  const view = useMemo(() => {
    const { top, height, pitch, gap } = win;
    if (pitch <= 0 || height <= 0) {
      // Before the first measurement, show a viewport's worth from the top
      // rather than the whole tree — the full render is the one thing
      // virtualisation exists to prevent, and it must not happen even once.
      return { first: 0, slice: rows.slice(0, ROW_OVERSCAN * 4), before: 0, after: 0 };
    }
    const first = Math.max(0, Math.floor(top / pitch) - ROW_OVERSCAN);
    const count = Math.ceil(height / pitch) + ROW_OVERSCAN * 2;
    const slice = rows.slice(first, first + count);
    const rest = rows.length - first - slice.length;
    // A run of n rows occupies `n * pitch - gap`; the gap the flex container
    // puts between the spacer and its neighbour supplies the one subtracted.
    return {
      first,
      slice,
      before: first > 0 ? first * pitch - gap : 0,
      after: rest > 0 ? rest * pitch - gap : 0,
    };
  }, [rows, win]);

  /**
   * The parent first, then the item.
   *
   *     EnsureVisibleIfEnabled( m_widget, GetParent( item ) );
   *     EnsureVisibleIfEnabled( m_widget, item );
   *       -- common/lib_tree_model_adapter.cpp:386-387
   *
   * with upstream's own reason: "The selected item is the first (shown) child
   * of the parent. So it's always right below the parent, and this way the user
   * can also see what library the selected part belongs to, without having a
   * case where the selection is off the screen." Scrolling only the item leaves
   * a hit sitting at the top of the pane with no clue which library it came
   * from.
   */
  // Read inside the effect below rather than depended on: see its comment.
  const winRef = useRef(win);
  winRef.current = win;

  // `EnsureVisibleIfEnabled` runs when the SELECTION moves, and only then.
  //
  // `win` must not be a dependency here. It is the virtual window, and its
  // `top` IS `list.scrollTop` (see `remeasure`), so it changes on every scroll
  // — which made this effect a feedback loop: scroll, `win` changes, the effect
  // re-runs, and it scrolls straight back to the selected row. That is the
  // hand-scrolling snapping back to the top, and it made the tree unusable
  // below the first screenful, since the selection is the first row until you
  // pick something.
  //
  // `rows` stays: a search changes the row set and the selection together, and
  // that jump is exactly what upstream calls EnsureVisibleIfEnabled for. It is
  // recomputed from the model rather than from the scroll offset, so it does
  // not move when the pointer does.
  /**
   * `LIB_TREE::selectIfValid` (common/widgets/lib_tree.cpp:531-540): a plain
   * selection does `EnsureVisibleIfEnabled` and NOTHING else - scroll only if
   * the row is off-screen, and only far enough to bring it to the near edge.
   *
   * The five-row centring that used to live here belongs to `CenterLibId`
   * alone, which nothing on this path calls; see `centerOnLoad` below.
   */
  const scrollTo = useCallback(
    (node: LibTreeNode): void => {
      const el = rowRefs.current.get(node);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        return;
      }
      // Virtualised out: the element the search jumped to may be thousands of
      // rows outside the window, so put its index where scrollIntoView would
      // have put the element and let the next measurement render it.
      const list = listRef.current;
      const { pitch, height } = winRef.current;
      if (!list || pitch <= 0) return;
      const index = rows.findIndex((r) => r.node === node);
      if (index < 0) return;
      const top = index * pitch;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + pitch > list.scrollTop + height) list.scrollTop = top + pitch - height;
    },
    [rows],
  );

  useEffect(() => {
    if (!selected) return;
    scrollTo(selected);
  }, [selected, rows, scrollTo]);

  /**
   * `LIB_TREE::centerIfValid` (common/widgets/lib_tree.cpp:543-588), reached
   * ONLY through `CenterLibId` (:387-390) - and the sole caller of that in the
   * symbol editor is `centerItemIdleHandler`, bound for one idle event after a
   * symbol is LOADED (eeschema/symbol_editor/symbol_editor.cpp:208-226):
   *
   *     m_treePane->GetLibTree()->SelectLibId( libId );
   *     m_centerItemOnIdle = libId;
   *     Bind( wxEVT_IDLE, &SYMBOL_EDIT_FRAME::centerItemIdleHandler, this );
   *
   * So it runs when the editor opens a symbol, never when the user picks a row.
   * Driving it off the selection - which is what this did - made every click
   * re-scroll the list by five rows, which upstream does not do and which is
   * exactly what "it should stay there only" describes.
   *
   * Upstream's own comment on the shape:
   *
   *   "This doesn't actually center because the wxWidgets API is poorly suited
   *    to that (and it might be too noisy as well). It does try to keep the
   *    given item a bit off the top or bottom of the window."
   *
   * The idle event is what lets the tree finish laying out first; the wait on
   * `rows` containing the node is the same guarantee, since the node does not
   * exist in the row set until the ancestors this path expanded have rendered.
   */
  useEffect(() => {
    if (!pendingCenter) return;
    const sibs = rows.filter((r) => r.node.parent === pendingCenter.parent).map((r) => r.node);
    const idx = sibs.indexOf(pendingCenter);
    if (idx < 0) return; // not laid out yet; a later `rows` will carry it
    if (pendingCenter.parent) {
      if (idx + 5 < sibs.length) {
        scrollTo(sibs[idx + 5]!);
      } else {
        const grand = pendingCenter.parent.parent;
        const pSibs = rows.filter((r) => r.node.parent === grand).map((r) => r.node);
        const pIdx = pSibs.indexOf(pendingCenter.parent);
        if (pIdx >= 0 && pIdx + 1 < pSibs.length) scrollTo(pSibs[pIdx + 1]!);
      }
      if (idx - 5 >= 0) scrollTo(sibs[idx - 5]!);
      else scrollTo(pendingCenter.parent);
    }
    scrollTo(pendingCenter);
    setPendingCenter(null);
  }, [pendingCenter, rows, scrollTo]);

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
        {/* One wxSearchCtrl, not three controls in a row. Its magnifier and its
            cancel button are the GtkEntry's own primary and secondary icons -
            `wxSearchCtrl::ShowCancelButton( true )` plus the menu LIB_TREE hangs
            off it (lib_tree.cpp:79-81, 450-476) - so they sit INSIDE the entry
            rather than beside it, and the glyphs are the icon theme's, not
            KiCad's. */}
        <div className="ze-libtree-entry">
          <button
            type="button"
            className="ze-entry-icon left"
            title="Recent searches"
            onClick={() => setRecentOpen((o) => !o)}
          >
            <EditFindSymbolic />
          </button>
          <input
            ref={searchRef}
            className="ze-search"
            type="text"
            placeholder="Filter"
            value={search}
            onChange={(e) => onQueryText(e.target.value)}
          />
          {/* ShowCancelButton only shows one while there is something to cancel:
              GtkSearchEntry hangs the secondary icon off a non-empty value. */}
          {search !== '' && (
            <button
              type="button"
              className="ze-entry-icon right"
              title="Clear"
              onClick={() => {
                onQueryText('');
                searchRef.current?.focus();
              }}
            >
              <EditClearSymbolic />
            </button>
          )}
          {recentMenu}
        </div>
        {/* The wxStaticLine wxLI_VERTICAL between the entry and the sort button
            (lib_tree.cpp:86-87), 3px in from the top and bottom of the row. */}
        <div className="ze-libtree-sep" />
        <div className="ze-libtree-sortbtn-wrap">
          <button
            type="button"
            className="ze-libtree-sortbtn"
            title="Sort and expand options"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {/* `m_sort_ctrl->SetBitmap( KiBitmapBundle( BITMAPS::config ) )`
                (lib_tree.cpp:90). KiCad's own icon, vendored from its dark
                sources, not a gear from the font.

                16px, because that is what wx draws here: the store builds the
                bundle from every size it has for the theme
                (bitmap_store.cpp:126-141) and ships config at 16, 24 and 32
                (bitmap_info.cpp), and `wxBitmapBundle::FromBitmaps` takes the
                SMALLEST as the bundle's default size, which is what a 100%
                scaling display asks for. 24 was a size KiCad only reaches at
                150%. */}
            <img src={bitmapUrl('config')} alt="" width={16} height={16} />
          </button>
          {sortMenu}
        </div>
      </div>

      {/* `LIB_TREE::m_filtersSizer`, built only under the FILTERS flag and added
          between the search control and the tree:

              if( aFlags & FILTERS )
              {
                  m_filtersSizer = new wxBoxSizer( wxVERTICAL );
                  sizer->Add( m_filtersSizer, 0, wxEXPAND | wxLEFT, 4 );
              }
          (common/widgets/lib_tree.cpp:165-169)

          The tree owns the SLOT and nothing else; what goes in it belongs to
          whoever built the tree. `PANEL_FOOTPRINT_CHOOSER::GetFiltersSizer()`
          is a one-line forward to this, and FOOTPRINT_CHOOSER_FRAME is what
          puts the two checkboxes in - because only the frame knows the symbol's
          fp_filters and pin count, which reach it by KIWAY mail. That is the
          whole reason the slot exists rather than the checkboxes living here.

          Absent prop = absent flag: no sizer, no gap. */}
      {filters === undefined ? null : <div className="ze-libtree-filters">{filters}</div>}

      {/* The wxDataViewCtrl is ONE control: its column header and its rows share
          a frame, and the header is a button drawn inside it. */}
      <div className="ze-libtree-tree">
        <div
          className="ze-libtree-cols"
          ref={headerRef}
          onContextMenu={(e) => {
            e.preventDefault();
            setHeaderMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {columns.map((col, i) => (
            <span
              key={col}
              className={col === 'Item' ? 'col-item' : 'col-desc'}
              style={{ width: colWidths[i], position: 'relative' }}
            >
              {col}
              {/* The drag grip. `wxDATAVIEW_COL_RESIZABLE` puts it on the
                  header button's own right edge and gives it no pixels of its
                  own, so this is an overlay rather than a separator: nothing in
                  the header moves because it is there. */}
              <span
                className="ze-libtree-colgrip"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 4,
                  cursor: 'col-resize',
                }}
                onMouseDown={(e) => startColumnResize(i, e)}
              />
            </span>
          ))}
        </div>

        <div
          className="ze-libtree-list"
          ref={listRef}
          tabIndex={0}
          onMouseLeave={hidePreview}
          onScroll={(e) => {
            hidePreview();
            remeasure();
            // One control, one horizontal scroll position.
            if (headerRef.current) headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
        >
          {view.before > 0 && <div style={{ height: view.before, flex: '0 0 auto' }} />}
          {view.slice.map(({ node, indent, expandable, open }) => {
            // `aRect` for the Item column: the row's width minus the lead-in,
            // this row's indent, the expander and the gaps either side of it.
            // Shared by the cell and by the canvas-item outline drawn over it,
            // so the marker cannot end up a different size from the thing it
            // marks.
            const itemCellWidth =
              (colWidths[0] ?? 0) -
              (ROW_LEAD_IN + indent * LIB_TREE_INDENT) -
              TWISTY_W -
              2 * CELL_GAP;
            return (
              <div
                key={`${node.parent?.name ?? ''}/${node.libId || node.name}${node.type === LibTreeNodeType.UNIT ? `#${node.unit}` : ''}`}
                ref={(el) => {
                  el ? rowRefs.current.set(node, el) : rowRefs.current.delete(node);
                }}
                className={
                  `ze-libtree-row${node === selected ? ' active' : ''}` +
                  (node.type === LibTreeNodeType.LIBRARY ? ' lib' : '')
                }
                style={{ paddingLeft: ROW_LEAD_IN + indent * LIB_TREE_INDENT }}
                onClick={() => select(node)}
                onDoubleClick={() => activate(node)}
                onMouseMove={(e) => onRowHover(node, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  hidePreview();
                  // "Select the item under the cursor before showing the context
                  // menu" (`lib_tree.cpp:1041-1053`), whichever menu follows.
                  select(node);
                  if (onItemContextMenu) {
                    // The adapter names a tool, so the tool's menu is what opens.
                    onItemContextMenu(node, e.clientX, e.clientY);
                    return;
                  }
                  // The else branch: Pin/Unpin, and only on a pinnable
                  // (non-group) library row.
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
                {/* The Item cell is `GetValue( …, NAME_COL )` and its face is
                `GetAttr( …, NAME_COL )` — both the adapter's, because both are
                computed on every paint from state the adapter owns. The Symbol
                Editor's synchronizing adapter is the one that has more to say
                than the base (`symbol_tree_synchronizing_adapter.cpp:249-397`);
                the italic for a derived symbol is the base answer and reaches
                the chooser unchanged. The pinning mark is LIB_TREE's own. */}
                {/* The canvas-item marker. It takes the Item cell's own box, so
                  the two cannot drift apart. */}
                {adapter.nodeAttr(node, open).strikethrough && (
                  <CanvasItemOutline
                    left={ROW_LEAD_IN + indent * LIB_TREE_INDENT + TWISTY_W + CELL_GAP}
                    width={itemCellWidth}
                  />
                )}
                <span
                  className="col-item"
                  style={{
                    ...itemCellStyle(adapter.nodeAttr(node, open)),
                    width: itemCellWidth,
                  }}
                >
                  {node.pinned ? PINNING_SYMBOL : ''}
                  {adapter.nameCell(node)}
                </span>
                {columns.slice(1).map((col, i) => (
                  <span key={col} className="col-desc" style={{ width: colWidths[i + 1] }}>
                    {cellValue(node, col)}
                  </span>
                ))}
              </div>
            );
          })}
          {view.after > 0 && <div style={{ height: view.after, flex: '0 0 auto' }} />}
          {/* LIB_TREE has no loading state, because by the time it is shown
            `IFACE::PreloadLibraries` has run and the tree holds every library
            that loaded. What it can be is EMPTY, and upstream shows nothing at
            all for that; ours says so, because a hosted library that failed to
            arrive and a filter that matched nothing look identical otherwise.
            Progress belongs in the background job monitor
            (ui/background_jobs_monitor.ts), which is where upstream puts it. */}
          {rows.length === 0 && (
            <div className="ze-muted" style={{ padding: 8 }}>
              No matches
            </div>
          )}
        </div>
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
