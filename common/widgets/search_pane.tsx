// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SEARCH_PANE` (`include/widgets/search_pane.h`, `common/widgets/
 * search_pane.cpp` + `search_pane_base.{h,cpp}`): the docked Search pane every
 * `EDA_DRAW_FRAME` can show (Ctrl+G) — a search box, a notebook of tabs, and a
 * per-tab `SEARCH_HANDLER` that owns the query and the columns. The listview
 * half of the port (`SEARCH_PANE_TAB` + `SEARCH_PANE_LISTVIEW`) is
 * `search_pane_tab.tsx`.
 *
 * `SEARCH_HANDLER` (`include/widgets/search_pane.h:34-59`) is the per-editor
 * data interface this widget is built against — one instance per tab, each
 * knowing only its own columns and its own hitlist. eeschema's set is
 * `eeschema/widgets/search_handlers.ts`, over `SCH_SEARCH_HANDLER`.
 *
 * ## Why there are no counts in the tab labels
 *
 * `SEARCH_PANE::AddSearcher` sets the page title once, from
 * `aHandler->GetName()` (search_pane.cpp:175), and `RefreshSearch` /
 * `OnNotebookPageChanged` only ever call `Search` on the **current** tab
 * (search_pane.cpp:181-217) — an inactive page's hitlist is left exactly as
 * stale as it was when it was last shown. There is no count to print on a tab
 * nobody has searched yet, so upstream never tries. This mirrors that:
 * `handlers[i].search()` is called only for the active tab, on mount and
 * whenever the query or the active tab changes.
 *
 * ## `SEARCH_PANE_MENU`
 *
 * The gear button (`m_menuButton`, `BITMAP_BUTTON`) pops `SEARCH_PANE_MENU`
 * (search_pane.cpp:40-117): two checkable rows that both write
 * `APP_SETTINGS_BASE::SEARCH_PANE::selection_zoom` — ticking one unticks the
 * other, and unticking both leaves `NONE` — then a separator and two more
 * independent toggles. It is built here from `MenuItem[]` handed to the
 * already-ported `ContextMenu` (`common/tool/action_menu_bar.js`), the same
 * popup every right-click menu and menu-bar drop-down in the app uses, rather
 * than a native `<select>` or a new popup component.
 *
 * `ID_TOGGLE_SEARCH_HIDDEN_FIELDS` / `ID_TOGGLE_SEARCH_METADATA` menu icons
 * (`invisible_text`, `library`) are not drawn: GTK3 does not render menu-item
 * bitmaps at all (`action_menu_bar.tsx`'s `MenuEntry` — "No bitmap" — already
 * settled this for every menu in the app, not just this one).
 */
import { useMemo, useRef, useState, type JSX } from 'react';
import { bitmapUrl } from '../bitmap_store.js';
import { ContextMenu } from '../tool/action_menu_bar.js';
import type { MenuItem } from '../tool/action_menu_types.js';
import { SearchPaneTab } from './search_pane_tab.js';
import type { SearchHandler, SearchPaneMenuState } from './search_pane_types.js';

/**
 * The data types (`SearchColumnAlign`, `SearchColumn`, `SearchHandler`,
 * `SearchPaneMenuState`) live in `search_pane_types.ts`, a plain `.ts` module:
 * a per-editor handler set is not itself a React component (`eeschema/widgets/
 * search_handlers.ts` has no `--jsx`) and cannot import so much as a type
 * from this file without one. Re-exported here so an importer of the widget
 * does not also need to know that.
 */
export type {
  SearchColumn,
  SearchColumnAlign,
  SearchHandler,
  SearchPaneMenuState,
} from './search_pane_types.js';

export interface SearchPaneProps {
  /** `m_handlers` / `m_tabs` — one per `AddSearcher` call, in that order. */
  handlers: readonly SearchHandler[];
  menuState: SearchPaneMenuState;
  /** `SEARCH_PANE_MENU::eventHandler` writing back to `m_frame->config()`. */
  onMenuStateChange: (next: SearchPaneMenuState) => void;
  /** `RefreshSearch()`/double-click row: `handler->ActivateItem`. */
  onActivate?: (handler: SearchHandler, row: number) => void;
}

/** `SEARCH_PANE::SEARCH_PANE`. */
export function SearchPane({
  handlers,
  menuState,
  onMenuStateChange,
  onActivate,
}: SearchPaneProps): JSX.Element {
  // `m_lastQuery`.
  const [query, setQuery] = useState('');
  // `wxNotebook`'s current page.
  const [tab, setTab] = useState(0);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const activeTab = Math.min(tab, Math.max(0, handlers.length - 1));
  const handler = handlers[activeTab];

  const menu: MenuItem[] = useMemo(
    () => [
      {
        label: 'Zoom to Selection',
        tooltip: 'Toggle zooming to selections in the search pane',
        checked: menuState.selectionZoom === 'zoom',
        action: () =>
          onMenuStateChange({
            ...menuState,
            selectionZoom: menuState.selectionZoom === 'zoom' ? 'none' : 'zoom',
          }),
      },
      {
        label: 'Pan to Selection',
        tooltip: 'Toggle panning to selections in the search pane',
        checked: menuState.selectionZoom === 'pan',
        action: () =>
          onMenuStateChange({
            ...menuState,
            selectionZoom: menuState.selectionZoom === 'pan' ? 'none' : 'pan',
          }),
      },
      { sep: true },
      {
        label: 'Search Hidden Fields',
        checked: menuState.searchHiddenFields,
        action: () =>
          onMenuStateChange({
            ...menuState,
            searchHiddenFields: !menuState.searchHiddenFields,
          }),
      },
      {
        label: 'Search Metadata',
        tooltip: 'Search library links, descriptions and keywords',
        checked: menuState.searchMetadata,
        action: () =>
          onMenuStateChange({ ...menuState, searchMetadata: !menuState.searchMetadata }),
      },
    ],
    [menuState, onMenuStateChange],
  );

  return (
    // `minWidth: 0`/`minHeight: 0` throughout: a flex item's default
    // `min-width: auto` refuses to shrink below its content, which is what put
    // a horizontal scrollbar under the whole 240px dock before
    // `search_panel_fits.test.ts` pinned the fix.
    <div
      className="ze-search-pane"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div className="ze-search-pane-header">
        <input
          type="text"
          className="ze-search"
          // SEARCH_PANE::FocusSearch is called whenever ACTIONS::showSearch
          // shows the pane, and the pane mounts exactly then.
          autoFocus
          placeholder="Search"
          value={query}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="ze-libtree-sep" />
        {/* `m_menuButton`, a `BITMAP_BUTTON`; popped with `PopupMenu( m_menu )`
            on `wxEVT_LEFT_DOWN` (search_pane.cpp:128-133), at the cursor —
            which for a button click is the button itself. */}
        <button
          ref={menuBtnRef}
          type="button"
          className="ze-lp-iconbtn"
          title="Options"
          onClick={() => {
            const r = menuBtnRef.current?.getBoundingClientRect();
            if (r) setMenuAt({ x: r.left, y: r.bottom });
          }}
        >
          <img src={bitmapUrl('config')} alt="Options" />
        </button>
      </div>

      {/* `m_notebook`, `wxEXPAND|wxBOTTOM, 4` — the whole tab-strip-plus-page
          widget carries the bottom margin, not the strip alone. */}
      <div className="ze-search-pane-notebook">
        <div className="ze-erc-tabs compact" style={{ padding: '0 6px' }}>
          {handlers.map((h, i) => (
            <div
              key={h.name}
              className={`tab${i === activeTab ? ' active' : ''}`}
              onClick={() => setTab(i)}
            >
              {h.name}
            </div>
          ))}
        </div>

        {handler && (
          <SearchPaneTab
            key={handler.name}
            handler={handler}
            query={query}
            onActivate={onActivate ? (row) => onActivate(handler, row) : undefined}
          />
        )}
      </div>

      {menuAt && (
        <ContextMenu items={menu} x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)} />
      )}
    </div>
  );
}

/** Re-exported so a caller does not also need `search_pane_tab.js` directly. */
export { SearchPaneTab } from './search_pane_tab.js';
