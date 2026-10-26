// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/widgets/sch_search_pane.cpp`: `SCH_SEARCH_PANE`, the common `SEARCH_PANE` with the
 * five schematic handlers, listening to the live SCHEMATIC so an edit re-runs the search.
 *
 * The listview owns its selection, as upstream's does: a row lights up for the pick made in the
 * list, and `SelectItems` pushes it out to the canvas. A pick on the canvas does not come back
 * to the list.
 */

import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { SearchPane, searchPaneConfig } from '@ziroeda/common/widgets/search_pane.js';
import type { SearchPaneMenuState } from '@ziroeda/common/widgets/search_pane_types.js';
import type { SCHEMATIC, SCHEMATIC_LISTENER } from '../schematic.js';
import { makeSchSearchHandlers, type SchSearchFrame } from './search_handlers.js';

/** What `SEARCH_PANE` gives its subclass: the three calls this file makes on itself. */
export interface SearchPaneHost {
  /** `IsShownOnScreen()`. */
  IsShownOnScreen(): boolean;
  /** `RefreshSearch()`. */
  RefreshSearch(): void;
  /** `ClearAllResults()`. */
  ClearAllResults(): void;
}

/** `SCH_SEARCH_PANE`, the `SCHEMATIC_LISTENER` half. */
export class SCH_SEARCH_PANE implements SCHEMATIC_LISTENER {
  /** `m_sch`. */
  m_sch: SCHEMATIC | null;

  constructor(
    private readonly m_schFrame: { Schematic(): SCHEMATIC | null },
    private readonly m_host: SearchPaneHost,
  ) {
    this.m_sch = m_schFrame.Schematic();

    if (this.m_sch !== null) this.m_sch.AddListener(this);
  }

  /** `~SCH_SEARCH_PANE`: the listener leaves the schematic. */
  Detach(): void {
    this.m_sch?.RemoveListener(this);
  }

  /** `onUnitsChanged` (`EDA_EVT_UNITS_CHANGED`). */
  onUnitsChanged(): void {
    this.m_host.ClearAllResults();
    this.m_host.RefreshSearch();
  }

  /** `onSchChanging` (`EDA_EVT_SCHEMATIC_CHANGING`). */
  onSchChanging(): void {
    this.m_host.ClearAllResults();
  }

  /** `onSchChanged` (`EDA_EVT_SCHEMATIC_CHANGED`). */
  onSchChanged(): void {
    this.m_sch = this.m_schFrame.Schematic();

    if (this.m_sch !== null) this.m_sch.AddListener(this);

    this.m_host.ClearAllResults();
    this.m_host.RefreshSearch();
  }

  private refreshIfShown(): void {
    if (!this.m_host.IsShownOnScreen()) return;

    this.m_host.RefreshSearch();
  }

  OnSchItemsAdded(): void {
    this.refreshIfShown();
  }

  OnSchItemsRemoved(): void {
    this.refreshIfShown();
  }

  OnSchItemsChanged(): void {
    this.refreshIfShown();
  }
}

interface Props {
  /**
   * The live SCH_EDIT_FRAME; `config()` is answered from `menuState`. The C++ frame IS a
   * UNITS_PROVIDER; ours holds one.
   */
  frame: Omit<SchSearchFrame, 'config' | 'MessageTextFromValue'> & {
    GetUnitsProvider(): { MessageTextFromValue(aValue: number): string };
  };
  /** `frame.Schematic()`: a new one is `EDA_EVT_SCHEMATIC_CHANGED`. */
  schematic: SCHEMATIC | null;
  /** `APP_SETTINGS_BASE::SEARCH_PANE`, persisted (`common.search_pane`). */
  menuState: SearchPaneMenuState;
  onMenuStateChange: (next: SearchPaneMenuState) => void;
  /** The units label; a change is `EDA_EVT_UNITS_CHANGED`. */
  units: string;
}

export function SchSearchPane({
  frame,
  schematic,
  menuState,
  onMenuStateChange,
  units,
}: Props): JSX.Element {
  // `RefreshSearch()`: a new handler set is a fresh empty hitlist and a re-run of the query in
  // `SearchPaneTab`.
  const [revision, setRevision] = useState(0);

  const listener = useMemo(
    () =>
      new SCH_SEARCH_PANE(
        { Schematic: () => schematic },
        {
          IsShownOnScreen: () => true,
          RefreshSearch: () => setRevision((r) => r + 1),
          ClearAllResults: () => setRevision((r) => r + 1),
        },
      ),
    [schematic],
  );

  // `~SCH_SEARCH_PANE` / a new schematic: the listener leaves the old one.
  useEffect(() => () => listener.Detach(), [listener]);

  // `onUnitsChanged`: the units label is only the trigger, and the pane opening is not a units
  // change (`EDA_EVT_UNITS_CHANGED` is posted when they change).
  const lastUnits = useRef(units);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `units` is the event, not an input
  useEffect(() => {
    if (lastUnits.current === units) return;

    lastUnits.current = units;
    listener.onUnitsChanged();
  }, [listener, units]);

  // The frame is a class instance, so its methods are forwarded, not spread.
  const searchFrame = useMemo<SchSearchFrame>(
    () => ({
      Schematic: () => frame.Schematic(),
      GetCurrentSheet: () => frame.GetCurrentSheet(),
      GetToolManager: () => frame.GetToolManager(),
      MessageTextFromValue: (v) => frame.GetUnitsProvider().MessageTextFromValue(v),
      GetCanvas: () => frame.GetCanvas(),
      config: () => searchPaneConfig(menuState),
    }),
    [frame, menuState],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the RefreshSearch trigger
  const handlers = useMemo(() => makeSchSearchHandlers(searchFrame), [searchFrame, revision]);

  return (
    <SearchPane handlers={handlers} menuState={menuState} onMenuStateChange={onMenuStateChange} />
  );
}
