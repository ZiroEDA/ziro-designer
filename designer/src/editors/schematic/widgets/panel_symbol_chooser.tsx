// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The working panel of the Choose Symbol dialog: library tree on the left of
 * a draggable sash; symbol preview, footprint selector and footprint preview
 * on the right. Mirrors kicad/eeschema/widgets/panel_symbol_chooser.cpp
 * (PANEL_SYMBOL_CHOOSER), including the alternate no-footprints layout where
 * a details pane spans the bottom of the window.
 *
 * Libraries load lazily (SYMBOL_TREE_MODEL_ADAPTER's lazy loader): the index
 * provides every symbol name up front; expanding or selecting into a library
 * fetches its .kicad_sym, filling descriptions, keywords, footprints and
 * multi-unit sub-rows, and bumping the dialog's "(N items loaded)" title.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { letterSubReference, type LibSymbol } from '@ziroeda/eeschema';
import { atom, list, str } from '@ziroeda/sexpr/src/types.js';
import { searchTerm } from '@ziroeda/common';
import { LibTree } from '../../../widgets/lib_tree.js';
import { LibTreeModelAdapter, type SortMode } from '../../../widgets/lib_tree_model_adapter.js';
import { LibTreeNode, LibTreeNodeType } from '../../../widgets/lib_tree_model.js';
import { FootprintPreviewWidget } from '../../../widgets/footprint_preview_widget.js';
import { FootprintSelectWidget } from '../../../widgets/footprint_select_widget.js';
import { loadFootprintIndex, filterFootprints } from '../../../widgets/footprint_list.js';
import { SymbolPreviewWidget } from './symbol_preview_widget.js';
import { generateAliasInfo } from '../generate_alias_info.js';
import { powerSymbolTest, loadIndex, loadLibrarySymbols, loadSymbol } from '../symbols/index.js';
import { settings } from '../../../prefs/settings.js';

/** Upstream PICKED_SYMBOL (sch_screen.h): LIB_ID + unit + edited fields. */
export interface PickedSymbol {
  libId: string;
  unit: number;
  fields: [string, string][];
}

export interface PanelSymbolChooserProps {
  /** SYMBOL_LIBRARY_FILTER::GetFilterPowerSymbols, power ports only. */
  powerFilter?: boolean;
  /** "Show footprint previews in Symbol Chooser" (Preferences > Editing Options). */
  showFootprints: boolean;
  /** Most-recently-placed symbols, newest first (s_SymbolHistoryList). */
  historyList: readonly PickedSymbol[];
  /** Symbols already placed anywhere in the design. */
  alreadyPlaced: readonly PickedSymbol[];
  /** Resolves a LIB_ID from the schematic's embedded library cache. */
  getPlacedLibSymbol?: (libId: string) => LibSymbol | undefined;
  /** Accept handler, double-click/Enter chose a symbol. */
  onAccept: () => void;
  /** Lazy-load handler: item count changed (updates the dialog title). */
  onItemCountChanged?: (count: number) => void;
}

export interface PanelSymbolChooserHandle {
  /** GetSelectedLibId + GetFields, resolved to the loaded symbol. */
  getSelected(): { symbol: LibSymbol; unit: number; fields: [string, string][] } | null;
}

// The search string is preserved between openings of the dialog
// (g_symbolSearchString / g_powerSearchString).
let gSymbolSearchString = '';
let gPowerSearchString = '';

const symProp = (sym: LibSymbol, key: string): string =>
  sym.properties.find((p) => p.key === key)?.value ?? '';

const itemNameOf = (libId: string): string => libId.slice(libId.indexOf(':') + 1);

/** The PICKED_SYMBOL's field edits applied to a copy of the symbol, as
 *  processList does before handing it to the tree. */
function withFields(sym: LibSymbol, fields: readonly [string, string][]): LibSymbol {
  const properties = sym.properties.map((p) => {
    const edit = fields.find(([key]) => key === p.key);
    return edit ? { ...p, value: edit[1] } : p;
  });
  for (const [key, value] of fields) {
    if (!properties.some((p) => p.key === key))
      properties.push({
        key,
        value,
        angle: 0,
        source: list(atom('property'), str(key), str(value)),
      });
  }
  return { ...sym, properties };
}

const unitCountOf = (sym: LibSymbol): number =>
  new Set(sym.units.map((u) => u.unit).filter((u) => u > 0)).size;

/** LIB_SYMBOL::GetPinCount over the unit-1 (or common) graphical pins. */
const pinCountOf = (sym: LibSymbol): number =>
  sym.units.reduce((n, u) => n + (u.unit === 0 || u.unit === 1 ? u.pins.length : 0), 0);

/**
 * LIB_SYMBOL::cacheSearchTerms + cacheChooserFields, weighted terms and the
 * optional-column values, once the real symbol is known.
 */
function populateItemNode(node: LibTreeNode, sym: LibSymbol, adapter?: LibTreeModelAdapter): void {
  const keywords = symProp(sym, 'ki_keywords');
  const desc = symProp(sym, 'Description');
  node.desc = desc;
  node.footprint = symProp(sym, 'Footprint');
  node.isPower = sym.isPower;
  node.isRoot = !sym.extends;
  node.pinCount = pinCountOf(sym);
  node.sourceSearchTerms = [
    searchTerm(node.libNickname, 4),
    searchTerm(node.name, 8, true),
    searchTerm(node.libId, 16, true),
    ...keywords
      .split(/\s+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(desc, 1),
  ];
  if (node.footprint) node.sourceSearchTerms.push(searchTerm(node.footprint, 1));

  // cacheChooserFields: fields flagged `(show_in_chooser yes)` become columns,
  // and "Keywords" is offered unless the symbol defines a field by that name.
  node.fields = new Map<string, string>();
  for (const f of sym.properties) if (f.showInChooser) node.fields.set(f.key, f.value);
  if (!node.fields.has('Keywords')) node.fields.set('Keywords', keywords);
  if (adapter) for (const name of node.fields.keys()) adapter.addColumnIfNecessary(name);
  node.rebuildSearchTerms(adapter?.getShownColumns() ?? []);

  addUnitRows(node, unitCountOf(sym));
}

/**
 * `LIB_TREE_NODE_ITEM::Update`'s tail: a symbol with more than one unit gets a
 * child row per unit.
 *
 *   if( aItem->GetSubUnitCount() > 1 )
 *       for( int u = 1; u <= aItem->GetSubUnitCount(); ++u )
 *           AddUnit( aItem, u );
 *
 * Upstream does this as the node is built, so the expander arrow is on the row
 * from the moment the tree appears. This ran only when a row was selected,
 * because a unit count needed the symbol and the symbol needed a fetch — so the
 * arrow appeared after the click that was supposed to follow it. The count now
 * travels in the library index, and the tree calls this directly.
 *
 * Idempotent: the on-selection hydrate calls it again with the count read from
 * the real symbol, which corrects an index that disagrees and does nothing when
 * it does not.
 */
function addUnitRows(node: LibTreeNode, units: number): void {
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

export const PanelSymbolChooser = forwardRef<PanelSymbolChooserHandle, PanelSymbolChooserProps>(
  function PanelSymbolChooser(
    {
      powerFilter = false,
      showFootprints,
      historyList,
      alreadyPlaced,
      getPlacedLibSymbol,
      onAccept,
      onItemCountChanged,
    },
    ref,
  ): JSX.Element {
    // aFilter && GetFilterPowerSymbols() forces the footprint panes off.
    const showFp = showFootprints && !powerFilter;

    const [regenerateNonce, setRegenerateNonce] = useState(0);
    const [selectedNode, setSelectedNode] = useState<LibTreeNode | null>(null);
    const [previewSymbol, setPreviewSymbol] = useState<LibSymbol | null>(null);
    // A derived symbol's parent (LIB_SYMBOL::GetParent), needed for the details
    // pane's "Derived from" line and its inherited field rows.
    const [parentSymbol, setParentSymbol] = useState<LibSymbol | undefined>(undefined);
    const [fpOverride, setFpOverride] = useState('');
    const fieldEdits = useRef<[string, string][]>([]);
    const loadedLibs = useRef(new Set<string>());
    // The history/already-placed group entries' symbols, with their picked
    // field edits already applied (upstream's history_list_storage).
    const groupSymbols = useRef(new Map<LibTreeNode, LibSymbol>()).current;

    // Sash positions (EESCHEMA_SETTINGS m_SymChooserPanel.sash_pos_h/_v).
    const [sashH, setSashH] = useState(settings.eeschema.sym_chooser.sash_pos_h);
    const [sashV, setSashV] = useState(settings.eeschema.sym_chooser.sash_pos_v);

    const adapter = useMemo(() => {
      const a = new LibTreeModelAdapter();
      a.setSortMode(settings.eeschema.sym_chooser.sort_mode as SortMode);
      // loadColumnConfig: the persisted column set, defaulting to Item +
      // Description with "Item" forced to the front.
      if (settings.eeschema.lib_tree.columns.length > 0)
        a.setShownColumns(settings.eeschema.lib_tree.columns);
      a.generateInfo = (node) => {
        if (node === selectedNodeRef.current && previewSymbolRef.current)
          return generateAliasInfo(previewSymbolRef.current, node.unit, parentSymbolRef.current);
        const placed = groupSymbols.get(node) ?? getPlacedLibSymbol?.(node.libId);
        return placed ? generateAliasInfo(placed, node.unit) : `<b>${node.name}</b>`;
      };

      if (powerFilter) {
        // isPower is now exact whenever the index carries power flags, so the
        // library-name guess is not layered on top of it — that second test
        // used to re-admit every symbol in a "power"-named library after the
        // per-symbol flag had already rejected it.
        a.setFilter((node) => node.isPower);
      }

      // processList: an entry whose symbol can't be resolved is dropped, and
      // the picked field values are applied to the copy that feeds the node,
      // so an edited footprint/value shows in the tree and the details pane.
      const processList = (list: readonly PickedSymbol[], group: LibTreeNode) => {
        for (const picked of list) {
          const sym = getPlacedLibSymbol?.(picked.libId);
          if (!sym) continue;
          const [nick = '', itemName = ''] = picked.libId.split(':');
          const item = new LibTreeNode();
          item.type = LibTreeNodeType.ITEM;
          item.parent = group;
          item.name = itemName;
          item.libNickname = nick;
          item.libItemName = itemName;
          const edited = picked.fields.length ? withFields(sym, picked.fields) : sym;
          groupSymbols.set(item, edited);
          populateItemNode(item, edited, a);
          group.children.push(item);
        }
      };

      // Sort the already placed list since it is potentially from multiple
      // sessions, but not the most recent list since we want this listed by
      // most recent usage.
      const recent = a.addGroup('-- Recently Used --');
      recent.isRecentlyUsedGroup = true;
      processList(historyList, recent);
      a.finishLibrary(recent, true);

      if (historyList.length > 0) a.setPreselectNode(historyList[0]!.libId, historyList[0]!.unit);

      const placedGroup = a.addGroup('-- Already Placed --');
      placedGroup.isAlreadyPlacedGroup = true;
      processList(
        // Upstream sorts on the item name, not the whole LIB_ID.
        [...alreadyPlaced].sort((x, y) => itemNameOf(x.libId).localeCompare(itemNameOf(y.libId))),
        placedGroup,
      );
      a.finishLibrary(placedGroup);

      return a;
      // The adapter is built once per dialog opening.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // generateInfo closes over these through refs so the memoised adapter
    // always sees the current selection.
    const selectedNodeRef = useRef<LibTreeNode | null>(null);
    const previewSymbolRef = useRef<LibSymbol | null>(null);
    const parentSymbolRef = useRef<LibSymbol | undefined>(undefined);
    selectedNodeRef.current = selectedNode;
    previewSymbolRef.current = previewSymbol;
    parentSymbolRef.current = parentSymbol;

    // AddLibraries: seed every library from the index with name-only items;
    // real data streams in lazily.
    useEffect(() => {
      let cancelled = false;
      loadIndex()
        .then((index) => {
          if (cancelled) return;
          const session = settings.common.system.session;
          // Built from the whole index, not per entry: the generator omits
          // `power` both for a library with none and for an index too old to
          // carry the flag, and only the index as a whole separates the two.
          const isPower = powerSymbolTest(index);
          for (const lib of index) {
            const pinned = session.pinned_symbol_libs.includes(lib.name);
            const libNode = adapter.addLibrary(lib.name, '', pinned);
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
              // The unit rows are built with the node, from the count the index
              // carries, so a multi-unit part shows its expander before anything
              // is fetched. An index without the field simply has no counts and
              // the rows appear on selection as they used to.
              addUnitRows(item, lib.units?.[name] ?? 1);
              libNode.children.push(item);
            }
            adapter.finishLibrary(libNode);
          }
          adapter.tree.assignIntrinsicRanks();
          setRegenerateNonce((n) => n + 1);
          onItemCountChanged?.(adapter.getItemCount());
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adapter]);

    /**
     * Fetch a library and enrich its item nodes — `SYMBOL_TREE_MODEL_ADAPTER::
     * AddLibraries`' `m_adapter->GetSymbols( lib )`
     * (eeschema/symbol_tree_model_adapter.cpp:148), which is a whole library at
     * a time because upstream has it resident.
     *
     * ONE request, for the library file. It used to be one request per symbol,
     * and the cost of that is not marginal: expanding `Device` is 536 symbols,
     * and measured against the bucket that is
     *
     *     536 per-symbol files   2,486,139 B   94.2 s at 6 in flight
     *                                          21.7 s at 24
     *     1 Device.kicad_sym     2,414,640 B    1.9 s
     *
     * — the same bytes, 536x the round trips, and between 10x and 50x the wall
     * clock. `loadSymbol` is still per-symbol for PLACING one part, which is
     * where the split pays; enriching a whole library's rows is the case it
     * loses, badly. The fetched library also lands in `loadLibrary`'s cache, so
     * every later `loadSymbol` in it is free.
     */
    const ensureLibraryLoaded = useCallback(
      async (libNickname: string): Promise<void> => {
        if (loadedLibs.current.has(libNickname)) return;
        loadedLibs.current.add(libNickname);
        const libNode = adapter.tree.children.find((n) => !n.isGroup && n.name === libNickname);
        if (!libNode) return;
        const symbols = await loadLibrarySymbols(libNickname).catch(() => []);
        // `loadLibrarySymbols` stamps each libId as "Library:Name"; the tree's
        // item nodes carry the bare name.
        const byName = new Map(
          symbols.map((sym) => [sym.libId.slice(libNickname.length + 1), sym]),
        );
        for (const item of libNode.children) {
          const sym = byName.get(item.libItemName);
          if (sym) populateItemNode(item, sym, adapter);
        }
        setRegenerateNonce((n) => n + 1);
        onItemCountChanged?.(adapter.getItemCount());
      },
      [adapter, onItemCountChanged],
    );

    /** onSymbolSelected: update previews, footprint select and details pane. */
    const onSelect = useCallback(
      (node: LibTreeNode | null) => {
        setSelectedNode(node);
        fieldEdits.current = [];
        setFpOverride('');

        if (node && node.libId && node.type !== LibTreeNodeType.LIBRARY) {
          // A group entry keeps the copy its picked field edits were applied to;
          // otherwise resolve from the schematic's embedded cache (GetLibSymbol)
          // before falling back to the hosted library.
          const stored = groupSymbols.get(node) ?? getPlacedLibSymbol?.(node.libId);
          if (stored) {
            populateItemNode(node, stored, adapter);
            setPreviewSymbol(stored);
            return;
          }
          // No "fetching" state: `SYMBOL_PREVIEW_WIDGET` has none, because
          // `IFACE::PreloadLibraries` (eeschema.cpp:487) has already made the
          // design's symbols resident by the time the chooser opens. What is
          // left is one hosted fetch for a symbol nothing has touched yet, and
          // covering it with a spinner made every browse of the tree look like
          // a load. The previous preview stays until the new one arrives,
          // which is what upstream shows while a repaint is pending.
          void loadSymbol(node.libNickname, node.libItemName)
            .catch(() => undefined)
            .then((sym) => {
              setPreviewSymbol(sym ?? null);
              if (sym) {
                populateItemNode(node, sym, adapter);
                void ensureLibraryLoaded(node.libNickname);
              }
            });
        } else {
          setPreviewSymbol(null);
        }
      },
      [ensureLibraryLoaded],
    );

    const onChoose = useCallback(
      (node: LibTreeNode) => {
        if (node.libId) onAccept();
      },
      [onAccept],
    );

    /** onFootprintSelected: stash the override in the field-edit list. */
    const onFootprintSelected = useCallback((fp: string) => {
      setFpOverride(fp);
      fieldEdits.current = fieldEdits.current.filter(([key]) => key !== 'Footprint');
      if (fp) fieldEdits.current.push(['Footprint', fp]);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getSelected() {
          const node = selectedNode;
          if (!node || !node.libId || !previewSymbol) return null;
          return {
            symbol: previewSymbol,
            unit: node.unit, // 0 = the symbol itself; caller defaults to 1
            fields: [...fieldEdits.current],
          };
        },
      }),
      [selectedNode, previewSymbol],
    );

    const onPinLibrary = useCallback((node: LibTreeNode, pinned: boolean) => {
      node.pinned = pinned;
      settings.updateCommon((s) => {
        const list = s.system.session.pinned_symbol_libs.filter((n) => n !== node.name);
        if (pinned) list.push(node.name);
        s.system.session.pinned_symbol_libs = list;
      });
    }, []);

    const onToggleLibrary = useCallback(
      (node: LibTreeNode, open: boolean) => {
        if (open) void ensureLibraryLoaded(node.name);
        settings.updateEeschema((s) => {
          const list = s.lib_tree.open_libs.filter((n) => n !== node.name);
          if (open) list.push(node.name);
          s.lib_tree.open_libs = list;
        });
      },
      [ensureLibraryLoaded],
    );

    const onSearchChanged = useCallback(
      (search: string) => {
        if (powerFilter) gPowerSearchString = search;
        else gSymbolSearchString = search;
      },
      [powerFilter],
    );

    // Sash dragging (wxSplitterWindow wxSP_LIVE_UPDATE).
    const bodyRef = useRef<HTMLDivElement>(null);
    const dragSash = (which: 'h' | 'v') => (down: React.MouseEvent) => {
      down.preventDefault();
      const body = bodyRef.current?.getBoundingClientRect();
      if (!body) return;
      const move = (e: MouseEvent) => {
        if (which === 'h') {
          const w = Math.max(180, Math.min(body.width - 220, body.right - e.clientX));
          setSashH(w);
          settings.updateEeschema((s) => (s.sym_chooser.sash_pos_h = w));
        } else {
          const h = Math.max(60, Math.min(body.height - 120, body.bottom - e.clientY));
          setSashV(h);
          settings.updateEeschema((s) => (s.sym_chooser.sash_pos_v = h));
        }
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    const validSelection = !!(selectedNode && selectedNode.libId);
    const defaultFootprint = previewSymbol ? symProp(previewSymbol, 'Footprint') : '';
    const fpFilters = useMemo(
      () =>
        previewSymbol ? symProp(previewSymbol, 'ki_fp_filters').split(/\s+/).filter(Boolean) : [],
      [previewSymbol],
    );
    // onSymbolSelected: a node carrying its own footprint (a history entry with
    // an edited Footprint field) is previewed with that, else showFootprintFor
    // falls back to the symbol's own Footprint field.
    const shownFootprint = fpOverride || selectedNode?.footprint || defaultFootprint;
    // showFootprint: an unparsable LIB_ID reports itself rather than drawing.
    const fpStatus = !validSelection
      ? ''
      : !shownFootprint
        ? 'No footprint specified'
        : /^[^:]+:[^:]+$/.test(shownFootprint)
          ? ''
          : 'Invalid footprint specified';

    // AddAlwaysIncludedFootprint: explicitly associated footprints (issue #2282)
    // head the list in written order and bypass the filters.
    const alwaysIncluded = useMemo(() => {
      const out: string[] = [];
      for (const a of previewSymbol?.associatedFootprints ?? []) {
        if (a.footprintLibId && !out.includes(a.footprintLibId)) out.push(a.footprintLibId);
      }
      return out;
    }, [previewSymbol]);

    // FOOTPRINT_SELECT_WIDGET::UpdateList: the always-included footprints, then
    // the hosted list narrowed by the symbol's fp_filters and by its pin count.
    //
    // The two filters are independent, and upstream offers pin-count matches to
    // a symbol with **no** fp_filters at all — so an empty glob list is not
    // "show nothing" as long as the pin count can speak for itself.
    const fpPinCount = previewSymbol ? pinCountOf(previewSymbol) : 0;
    const [fpItems, setFpItems] = useState<string[]>([]);
    useEffect(() => {
      if (!showFp) {
        setFpItems([]);
        return;
      }
      const canNarrow = fpFilters.length > 0 || fpPinCount > 0;
      if (!canNarrow) {
        setFpItems(alwaysIncluded);
        return;
      }
      let cancelled = false;
      void loadFootprintIndex().then((index) => {
        if (cancelled) return;
        const matched = filterFootprints(index, fpFilters, 400, fpPinCount).filter(
          (fp) => !alwaysIncluded.includes(fp),
        );
        setFpItems([...alwaysIncluded, ...matched]);
      });
      return () => {
        cancelled = true;
      };
    }, [showFp, fpFilters, alwaysIncluded, fpPinCount]);

    // Resolve the selected symbol's parent so the details pane can name it and
    // inherit its fields; parents live in the same library upstream.
    useEffect(() => {
      const ext = previewSymbol?.extends;
      if (!previewSymbol || !ext) {
        setParentSymbol(undefined);
        return;
      }
      let cancelled = false;
      const nick = previewSymbol.libId.split(':')[0] ?? '';
      void loadSymbol(nick, ext)
        .catch(() => undefined)
        .then((sym) => {
          if (!cancelled) setParentSymbol(sym ?? undefined);
        });
      return () => {
        cancelled = true;
      };
    }, [previewSymbol]);

    // No hover preview here: LIB_TREE_MODEL_ADAPTER::HasPreview is false unless
    // an adapter overrides it, and only the *synchronizing* adapters (the Symbol
    // and Footprint Editors' trees) do. The chooser has a preview pane instead.

    const tree = (
      <div className="ze-chooser-treepane">
        <LibTree
          adapter={adapter}
          recentSearchesKey={powerFilter ? 'power' : 'symbols'}
          regenerateNonce={regenerateNonce}
          initialSearch={powerFilter ? gPowerSearchString : gSymbolSearchString}
          onSearchChanged={onSearchChanged}
          onSelect={onSelect}
          onChoose={onChoose}
          onToggleLibrary={onToggleLibrary}
          onPinLibrary={onPinLibrary}
          onSortModeChanged={(mode) =>
            settings.updateEeschema((s) => (s.sym_chooser.sort_mode = mode as 0 | 1))
          }
          onShownColumnsChanged={(columns) =>
            settings.updateEeschema((s) => (s.lib_tree.columns = [...columns]))
          }
          hasExternalDetails={!showFp}
          openLibs={settings.eeschema.lib_tree.open_libs}
        />
      </div>
    );

    const symbolPreview = (
      <SymbolPreviewWidget
        symbol={validSelection ? previewSymbol : null}
        unit={selectedNode?.unit ?? 0}
        statusText="No symbol selected"
      />
    );

    if (showFp) {
      // Footprints layout: tree | sash | symbol preview over fp select + preview.
      return (
        <div className="ze-chooser-panel" ref={bodyRef}>
          {tree}
          <div className="ze-sash v" onMouseDown={dragSash('h')} />
          <div className="ze-chooser-right" style={{ width: sashH, flex: 'none' }}>
            <div style={{ flex: 11, minHeight: 0, display: 'flex' }}>{symbolPreview}</div>
            <FootprintSelectWidget
              defaultFootprint={defaultFootprint}
              items={fpItems}
              value={fpOverride}
              disabled={!validSelection}
              onFootprintSelected={onFootprintSelected}
            />
            <div style={{ flex: 10, minHeight: 0, display: 'flex' }}>
              <FootprintPreviewWidget
                footprint={validSelection && !fpStatus ? shownFootprint : ''}
                statusText={fpStatus}
              />
            </div>
          </div>
        </div>
      );
    }

    // No-footprints layout: details pane spans the whole bottom of the window.
    return (
      <div className="ze-chooser-panel column" ref={bodyRef}>
        <div className="ze-chooser-upper">
          {tree}
          <div className="ze-sash v" onMouseDown={dragSash('h')} />
          <div className="ze-chooser-right" style={{ width: sashH, flex: 'none' }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{symbolPreview}</div>
          </div>
        </div>
        <div className="ze-sash h" onMouseDown={dragSash('v')} />
        <div
          className="ze-libtree-details external"
          style={{ height: sashV, flex: 'none' }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: generateAliasInfo HTML-escapes all library data
          dangerouslySetInnerHTML={{
            __html:
              validSelection && previewSymbol
                ? generateAliasInfo(previewSymbol, selectedNode?.unit ?? 0, parentSymbol)
                : '',
          }}
        />
      </div>
    );
  },
);
