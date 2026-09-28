// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/board_editor_control.cpp`: the board editor's own tool.
 *
 * Only the size-cycling arms are here so far — `TrackWidthInc`, `TrackWidthDec`
 * and the menu transition that resets everything. They mutate the live
 * `BOARD_DESIGN_SETTINGS`, which is where the indices and the custom flags
 * live, so nothing needs a copy of them.
 *
 * `BOARD_EDITOR_CONTROL` proper — a `PCB_TOOL_BASE` with `setTransitions` —
 * lands with the rest of the tools.
 */
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';

/**
 * `BOARD_EDITOR_CONTROL::TrackWidthInc` / `TrackWidthDec`
 * (`board_editor_control.cpp:1086-1200`), the differential-pair arm.
 *
 * Which list gets walked is the router's MODE:
 *
 *     if( routerTool->IsToolActive()
 *             && routerTool->Router()->Mode() == PNS_MODE_ROUTE_DIFF_PAIR )
 *         widthIndex = bds.GetDiffPairIndex() + 1;    // or - 1
 *
 * Both directions wrap, and they wrap ASYMMETRICALLY: increment falls off the
 * end to 0, decrement falls off the front to `size() - 1`. Index 0 is in the
 * cycle, so "use netclass" is one of the stops rather than a state you have to
 * leave the menu to reach.
 */
export function NextDiffPairIndex(aBds: BOARD_DESIGN_SETTINGS, aDelta: 1 | -1): void {
  const size = aBds.m_DiffPairDimensionsList.length;
  let index = aBds.GetDiffPairIndex() + aDelta;

  if (aDelta > 0) {
    // `if( widthIndex >= (int) size ) widthIndex = 0;`
    if (index >= size) index = 0;
  } else if (index < 0) {
    // `if( widthIndex < 0 ) widthIndex = size - 1;`
    index = size - 1;
  }

  // `SetDiffPairIndex( widthIndex ); UseCustomDiffPairDimensions( false );`
  aBds.SetDiffPairIndex(index);
  aBds.UseCustomDiffPairDimensions(false);
}

/**
 * The single-track arm of the same two actions, including the step it does
 * NOT take:
 *
 *     if( routerTool->IsToolActive() && Router()->GetState() == ROUTE_TRACK
 *             && bds.m_UseConnectedTrackWidth && !bds.m_TempOverrideTrackWidth )
 *         bds.m_TempOverrideTrackWidth = true;
 *     else
 *         widthIndex++;
 *
 * The first press while "use the starting track's width" is on does not change
 * the index at all — it turns the override on, so the NEXT press starts from
 * where the index already was.
 *
 * @returns the new `m_TempOverrideTrackWidth`, which the caller owns because
 *          it is per-route rather than part of the settings.
 */
export function NextTrackWidthIndex(
  aBds: BOARD_DESIGN_SETTINGS,
  aDelta: 1 | -1,
  aRouting: {
    routingTrack: boolean;
    useConnectedTrackWidth: boolean;
    tempOverrideTrackWidth: boolean;
  },
): boolean {
  if (aRouting.routingTrack && aRouting.useConnectedTrackWidth && !aRouting.tempOverrideTrackWidth)
    return true;

  const size = aBds.m_TrackWidthList.length;
  let index = aBds.GetTrackWidthIndex() + aDelta;

  if (aDelta > 0) {
    if (index >= size) index = 0;
  } else if (index < 0) {
    index = size - 1;
  }

  // `SetTrackWidthIndex( widthIndex ); UseCustomTrackViaSize( false );`
  aBds.SetTrackWidthIndex(index);
  aBds.UseCustomTrackViaSize(false);

  return aRouting.tempOverrideTrackWidth;
}

/**
 * `TRACK_WIDTH_MENU::eventHandler`'s `ID_POPUP_PCB_SELECT_USE_NETCLASS_VALUES`
 * arm (`router_tool.cpp:383-389`) — the one menu item that resets FOUR things,
 * including `m_UseConnectedTrackWidth`, which no other arm touches.
 *
 * @returns the new `m_UseConnectedTrackWidth`, always false.
 */
export function UseNetclassTrackAndVia(aBds: BOARD_DESIGN_SETTINGS): false {
  aBds.UseCustomTrackViaSize(false);
  aBds.SetViaSizeIndex(0);
  aBds.SetTrackWidthIndex(0);

  return false;
}
