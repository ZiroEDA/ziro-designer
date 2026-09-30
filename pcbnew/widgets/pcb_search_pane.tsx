// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_SEARCH_PANE` (`pcbnew/widgets/pcb_search_pane.cpp`): a `SEARCH_PANE`
 * that is also a `BOARD_LISTENER`, with the seven `AddSearcher` handlers of
 * `search_handlers.cpp`.
 *
 * Two halves, because the C++ class is both:
 *  - {@link PCB_SEARCH_PANE}, the listener. Every `OnBoardItem*Changed` and
 *    friend refreshes the search when the pane is on screen and does nothing
 *    when it is not; `OnBoardNetSettingsChanged` and
 *    `OnBoardHighlightNetChanged` are the two upstream leaves empty;
 *    `onUnitsChanged` / `onBoardChanging` / `onBoardChanged` are the three
 *    frame events, each clearing the results (and, for units and a new board,
 *    refreshing them).
 *  - {@link PcbSearchPane}, the view: `common/widgets/search_pane.tsx`, handed
 *    the handlers. The widget's query box, tabs, columns, sort and row
 *    selection are the shared one's, exactly as eeschema's
 *    `sch_search_pane.tsx` uses it.
 */

import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { SEARCH_PANE, SEARCH_PANE_SELECTION_ZOOM } from '@ziroeda/common/settings/app_settings.js';
import { SearchPane } from '@ziroeda/common/widgets/search_pane.js';
import type { SearchPaneMenuState } from '@ziroeda/common/widgets/search_pane_types.js';
import { type BOARD, BOARD_LISTENER } from '../board.js';
import type { BOARD_ITEM } from '../board_item.js';
import {
  makePcbSearchHandlers,
  type PcbSearchFrame,
  type PcbSearchWiring,
} from './search_handlers.js';

/** What `SEARCH_PANE` gives its subclass: the three calls this file makes on itself. */
export interface SearchPaneHost {
  /** `IsShownOnScreen()`. */
  IsShownOnScreen(): boolean;
  /** `RefreshSearch()`. */
  RefreshSearch(): void;
  /** `ClearAllResults()`. */
  ClearAllResults(): void;
}

/** `PCB_SEARCH_PANE`, the `BOARD_LISTENER` half. */
export class PCB_SEARCH_PANE extends BOARD_LISTENER {
  /** `m_brd`. */
  m_brd: BOARD | null;

  constructor(
    private readonly m_pcbFrame: Pick<PcbSearchFrame, 'GetBoard'>,
    private readonly m_host: SearchPaneHost,
  ) {
    super();

    this.m_brd = m_pcbFrame.GetBoard();

    if (this.m_brd !== null) this.m_brd.AddListener(this);
  }

  /** `~PCB_SEARCH_PANE`: the frame bindings go; the board listener is `RemoveAllListeners`'s or ours. */
  Detach(): void {
    this.m_brd?.RemoveListener(this);
  }

  /** `onUnitsChanged` (`EDA_EVT_UNITS_CHANGED`). */
  onUnitsChanged(): void {
    this.m_host.ClearAllResults();
    this.m_host.RefreshSearch();
  }

  /** `onBoardChanging` (`EDA_EVT_BOARD_CHANGING`). */
  onBoardChanging(): void {
    this.m_host.ClearAllResults();
  }

  /** `onBoardChanged` (`EDA_EVT_BOARD_CHANGED`). */
  onBoardChanged(): void {
    this.m_brd = this.m_pcbFrame.GetBoard();

    if (this.m_brd !== null) this.m_brd.AddListener(this);

    this.m_host.ClearAllResults();
    this.m_host.RefreshSearch();
  }

  private refreshIfShown(): void {
    if (!this.m_host.IsShownOnScreen()) return;

    this.m_host.RefreshSearch();
  }

  override OnBoardItemAdded(_aBoard: BOARD, _aBoardItem: BOARD_ITEM): void {
    this.refreshIfShown();
  }

  override OnBoardItemsAdded(_aBoard: BOARD, _aBoardItems: BOARD_ITEM[]): void {
    this.refreshIfShown();
  }

  override OnBoardItemRemoved(_aBoard: BOARD, _aBoardItem: BOARD_ITEM): void {
    this.refreshIfShown();
  }

  override OnBoardItemsRemoved(_aBoard: BOARD, _aBoardItems: BOARD_ITEM[]): void {
    this.refreshIfShown();
  }

  override OnBoardNetSettingsChanged(_aBoard: BOARD): void {}

  override OnBoardItemChanged(_aBoard: BOARD, _aBoardItem: BOARD_ITEM): void {
    this.refreshIfShown();
  }

  override OnBoardItemsChanged(_aBoard: BOARD, _aBoardItems: BOARD_ITEM[]): void {
    this.refreshIfShown();
  }

  override OnBoardHighlightNetChanged(_aBoard: BOARD): void {}

  override OnBoardRatsnestChanged(_aBoard: BOARD): void {
    this.refreshIfShown();
  }

  override OnBoardCompositeUpdate(
    _aBoard: BOARD,
    _aAddedItems: BOARD_ITEM[],
    _aRemovedItems: BOARD_ITEM[],
    _aChangedItems: BOARD_ITEM[],
  ): void {
    this.refreshIfShown();
  }
}

interface Props {
  /** The frame's slice the handlers read; `config()` is answered from `menuState`. */
  frame: Omit<PcbSearchFrame, 'config'>;
  /** `frame.GetBoard()`: a new one is `EDA_EVT_BOARD_CHANGED`. */
  board: BOARD | null;
  /** What `SelectItems` / `ActivateItem` run in the tool manager. */
  wiring: PcbSearchWiring;
  /** `APP_SETTINGS_BASE::SEARCH_PANE`, persisted (`common.search_pane`). */
  menuState: SearchPaneMenuState;
  onMenuStateChange: (next: SearchPaneMenuState) => void;
  /** The units label; a change is `EDA_EVT_UNITS_CHANGED`. */
  units: string;
}

/** `menuState` as the `m_SearchPane` settings the handlers read from `config()`. */
function searchPaneConfig(aMenu: SearchPaneMenuState): Pick<APP_SETTINGS_BASE, 'm_SearchPane'> {
  const pane = new SEARCH_PANE();

  pane.selection_zoom =
    aMenu.selectionZoom === 'zoom'
      ? SEARCH_PANE_SELECTION_ZOOM.ZOOM
      : aMenu.selectionZoom === 'pan'
        ? SEARCH_PANE_SELECTION_ZOOM.PAN
        : SEARCH_PANE_SELECTION_ZOOM.NONE;
  pane.search_hidden_fields = aMenu.searchHiddenFields;
  pane.search_metadata = aMenu.searchMetadata;

  return { m_SearchPane: pane };
}

export function PcbSearchPane({
  frame,
  board,
  wiring,
  menuState,
  onMenuStateChange,
  units,
}: Props): JSX.Element {
  // `RefreshSearch()`: a new handler set is a fresh empty hitlist and a re-run
  // of the query in `SearchPaneTab`.
  const [revision, setRevision] = useState(0);

  const listener = useMemo(
    () =>
      new PCB_SEARCH_PANE(
        { GetBoard: () => board },
        {
          IsShownOnScreen: () => true,
          RefreshSearch: () => setRevision((r) => r + 1),
          ClearAllResults: () => setRevision((r) => r + 1),
        },
      ),
    [board],
  );

  // `~PCB_SEARCH_PANE` / a new board: the listener leaves the old one.
  useEffect(() => () => listener.Detach(), [listener]);

  // `onUnitsChanged`: the units label is only the trigger, and the pane opening
  // is not a units change (`EDA_EVT_UNITS_CHANGED` is posted when they change).
  const lastUnits = useRef(units);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `units` is the event, not an input
  useEffect(() => {
    if (lastUnits.current === units) return;

    lastUnits.current = units;
    listener.onUnitsChanged();
  }, [listener, units]);

  // The frame is a class instance, so its methods are forwarded, not spread.
  const searchFrame = useMemo<PcbSearchFrame>(
    () => ({
      GetBoard: () => frame.GetBoard(),
      IsClosing: () => frame.IsClosing?.() ?? false,
      MessageTextFromValue: (v, addUnits, type) => frame.MessageTextFromValue(v, addUnits, type),
      GetOriginTransforms: () => frame.GetOriginTransforms(),
      config: () => searchPaneConfig(menuState),
    }),
    [frame, menuState],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the RefreshSearch trigger
  const handlers = useMemo(
    () => makePcbSearchHandlers(searchFrame, wiring),
    [searchFrame, wiring, revision],
  );

  return (
    <SearchPane handlers={handlers} menuState={menuState} onMenuStateChange={onMenuStateChange} />
  );
}
