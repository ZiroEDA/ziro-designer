// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Search panel (Ctrl+G). Counterpart: `SCH_SEARCH_PANE`
 * (`eeschema/widgets/sch_search_pane.cpp`), a `SEARCH_PANE` wired to eeschema's
 * four `SCH_SEARCH_HANDLER`s.
 *
 * A thin consumer of `common/widgets/search_pane.tsx`: this only builds the
 * handlers (`makeSchSearchHandlers`) and hands them the editor's callbacks —
 * every query, tab, column, sort and row-selection behaviour is the shared
 * widget's.
 */

import { useMemo, useRef, type JSX } from 'react';
import { SearchPane, type SearchPaneMenuState } from '@ziroeda/common/widgets/search_pane.js';
import { makeSchSearchHandlers, type SchSearchWiring } from '../index.js';
import type { LibSymbol, Schematic, Vec2 } from '../index.js';

interface Props {
  doc: Schematic;
  libById: ReadonlyMap<string, LibSymbol>;
  /** Formats an internal-unit distance for display (mm or mils). */
  fmt: (iu: number) => string;
  /** `APP_SETTINGS_BASE::SEARCH_PANE`, persisted (`common.search_pane`). */
  menuState: SearchPaneMenuState;
  onMenuStateChange: (next: SearchPaneMenuState) => void;
  /** Select the clicked item (`SCH_SEARCH_HANDLER::SelectItems`). */
  onSelect: (id: string) => void;
  /** Centre the view on it (`ACTIONS::centerSelection`). */
  onCenter?: (id: string, at: Vec2) => void;
  /** Fit the view to it (`ACTIONS::zoomFitSelection`). */
  onZoomFit?: (id: string, at: Vec2) => void;
  /**
   * The editor's selection, which is what draws a row selected — see
   * `SearchHandler.isRowSelected` for why this goes further than upstream.
   */
  selection?: ReadonlySet<string>;
  /** A click on the blank area below the rows clears the selection. */
  onClearSelection?: () => void;
}

export function SearchPanel({
  doc,
  libById,
  fmt,
  menuState,
  onMenuStateChange,
  onSelect,
  onCenter,
  onZoomFit,
  selection,
  onClearSelection,
}: Props): JSX.Element {
  // The handlers are rebuilt only when the document (or the fields the query
  // itself depends on) changes, matching `SCH_SEARCH_PANE`'s handlers, which
  // are constructed once and live for the frame's lifetime. Everything a
  // click needs — the live selection, the pan/zoom setting, the callbacks —
  // is read through this ref instead, so a selection change does not spin up
  // a fresh handler set (and with it, a fresh empty hitlist) on every click.
  const wiring = useRef<SchSearchWiring>({
    selectionZoom: menuState.selectionZoom,
    onSelect,
    onCenter,
    onZoomFit,
    onClearSelection,
    selection,
  });
  wiring.current = {
    selectionZoom: menuState.selectionZoom,
    onSelect,
    onCenter,
    onZoomFit,
    onClearSelection,
    selection,
  };

  const handlers = useMemo(
    () => makeSchSearchHandlers(doc, libById, fmt, menuState.searchHiddenFields, wiring),
    [doc, libById, fmt, menuState.searchHiddenFields],
  );

  return (
    <SearchPane handlers={handlers} menuState={menuState} onMenuStateChange={onMenuStateChange} />
  );
}
