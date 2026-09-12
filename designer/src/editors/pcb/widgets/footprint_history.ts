// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `s_FootprintHistoryList` (pcbnew/load_select_footprint.cpp:55-73): the
 * "-- Recently Used --" group at the top of every Footprint Chooser.
 *
 * A file-static in upstream, so it is one list per process and it does not
 * survive a restart — a module-level array is the same thing here. Only
 * `PCB_BASE_FRAME::SelectFootprintFromLibrary` (:221) ADDS to it, i.e. the
 * Place Footprints tool; every chooser, whichever field opened it, SHOWS it.
 */

/** `s_FootprintHistoryMaxCount = 8` (:56). */
const MAX = 8;

const history: string[] = [];

/** `AddFootprintToHistory( aName )` (:58-73): dedupe, insert at the front, trim. */
export function addFootprintToHistory(libId: string): void {
  for (let i = history.length - 1; i >= 0; i--) if (history[i] === libId) history.splice(i, 1);
  history.unshift(libId);
  // `while( GetCount() >= s_FootprintHistoryMaxCount ) RemoveAt( last )` —
  // `>=`, not `>`, so the list holds at most SEVEN entries. Quoted, not fixed.
  while (history.length >= MAX) history.pop();
}

/** The list as the chooser's constructor receives it, most recent first. */
export function footprintHistory(): readonly string[] {
  return history;
}

/** For tests. */
export function clearFootprintHistory(): void {
  history.length = 0;
}
