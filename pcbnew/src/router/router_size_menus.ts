// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ROUTER_TOOL`'s two size menus — `TRACK_WIDTH_MENU` and `DIFF_PAIR_MENU`
 * (`pcbnew/router/router_tool.cpp:280-520`), as item lists rather than as
 * `ACTION_MENU`s.
 *
 * The rows and their labels are the part worth porting exactly: they are what
 * tells a user which of the three overlapping ways of choosing a size is
 * currently winning, and each menu's checkmarks answer that from a different
 * combination of the same flags. The widget that draws them is the tool's, and
 * this module deliberately builds no UI — it returns what to draw, so the tool
 * that eventually draws it has nothing left to invent.
 *
 * ## The one that catches everybody
 *
 * The track menu lists index 0 as a row ("Track netclass width"); the diff-pair
 * menu does NOT — it lists from index 1 and puts index 0 behind its own "Use
 * Net Class Values" header item instead:
 *
 *     for( unsigned i = 1; i < bds.m_DiffPairDimensionsList.size(); ++i )
 *     …
 *     // remember that the menu doesn't contain index 0 (which is the netclass values)
 *     bds.SetDiffPairIndex( id - ID_POPUP_PCB_SELECT_DIFFPAIR1 + 1 );
 *
 * so the two menus number their rows differently against the same lists.
 */

import type {
  DiffPairDimension,
  TrackViaSizeState,
  ViaDimension,
} from '../board_design_settings_sizes.js';

/** One row of either menu. */
export interface RouterSizeMenuItem {
  /** The label, already formatted in the frame's units. */
  label: string;
  /**
   * `wxITEM_CHECK`'s state — which of the rows is the one in force. At most one
   * of the list rows is checked, but a header row can be checked at the same
   * time as nothing else is.
   */
  checked: boolean;
  /**
   * What choosing the row does. `index` selects that entry of the list;
   * the rest are the header rows' own transitions.
   */
  action:
    | { kind: 'index'; index: number }
    | { kind: 'useStartingWidth' }
    | { kind: 'useNetclass' }
    | { kind: 'useCustom' };
  /** A separator follows this row. */
  separatorAfter?: boolean;
}

/** `EDA_DRAW_FRAME::MessageTextFromValue`, which every label below goes through. */
export type MessageText = (aValue: number) => string;

/**
 * `TRACK_WIDTH_MENU::update()` (`router_tool.cpp:295-362`).
 *
 * Three header rows, a separator, then every track width and every via size —
 * both lists in ONE menu, index 0 included and labelled.
 */
export function trackWidthMenuItems(
  aTrackWidthList: readonly number[],
  aViasDimensionsList: readonly ViaDimension[],
  aSelection: TrackViaSizeState,
  aUseConnectedTrackWidth: boolean,
  aText: MessageText,
): RouterSizeMenuItem[] {
  // `bool useIndex = !bds.m_UseConnectedTrackWidth && !bds.UseCustomTrackViaSize();`
  const useIndex = !aUseConnectedTrackWidth && !aSelection.useCustomTrackVia;
  const items: RouterSizeMenuItem[] = [
    {
      label: 'Use Starting Track Width',
      checked: aUseConnectedTrackWidth && !aSelection.useCustomTrackVia,
      action: { kind: 'useStartingWidth' },
    },
    {
      label: 'Use Net Class Values',
      // Both indices, not one: the row covers the track AND the via.
      checked: useIndex && aSelection.trackWidthIndex === 0 && aSelection.viaSizeIndex === 0,
      action: { kind: 'useNetclass' },
    },
    {
      label: 'Use Custom Values...',
      checked: aSelection.useCustomTrackVia,
      action: { kind: 'useCustom' },
      separatorAfter: true,
    },
  ];

  aTrackWidthList.forEach((width, i) => {
    items.push({
      label: i === 0 ? 'Track netclass width' : `Track ${aText(width)}`,
      checked: useIndex && aSelection.trackWidthIndex === i,
      action: { kind: 'index', index: i },
      separatorAfter: i === aTrackWidthList.length - 1,
    });
  });

  aViasDimensionsList.forEach((via, i) => {
    let label: string;

    if (i === 0) label = 'Via netclass values';
    else if (via.drill > 0) label = `Via ${aText(via.diameter)}, hole ${aText(via.drill)}`;
    else label = `Via ${aText(via.diameter)}`;

    items.push({
      label,
      checked: useIndex && aSelection.viaSizeIndex === i,
      action: { kind: 'index', index: i },
    });
  });

  return items;
}

/**
 * `DIFF_PAIR_MENU::update()` (`router_tool.cpp:432-489`).
 *
 * Two header rows, a separator, then the pair dimensions **from index 1** — the
 * reserved entry is the "Use Net Class Values" row above, not a row of its own.
 *
 * The label grows with what the row actually carries: a gap of zero drops the
 * gap from the text, and a via gap of zero drops the via gap, so a row that
 * names only a width reads "Width 0.2 mm".
 */
export function diffPairMenuItems(
  aDiffPairDimensionsList: readonly DiffPairDimension[],
  aSelection: TrackViaSizeState,
  aText: MessageText,
): RouterSizeMenuItem[] {
  const items: RouterSizeMenuItem[] = [
    {
      label: 'Use Net Class Values',
      // `!UseCustomDiffPairDimensions() && GetDiffPairIndex() == 0`.
      checked: !aSelection.useCustomDiffPair && aSelection.diffPairIndex === 0,
      action: { kind: 'useNetclass' },
    },
    {
      label: 'Use Custom Values...',
      checked: aSelection.useCustomDiffPair,
      action: { kind: 'useCustom' },
      separatorAfter: true,
    },
  ];

  for (let i = 1; i < aDiffPairDimensionsList.length; i++) {
    const dp = aDiffPairDimensionsList[i]!;
    let label: string;

    if (dp.gap <= 0) {
      label =
        dp.viaGap <= 0
          ? `Width ${aText(dp.width)}`
          : `Width ${aText(dp.width)}, via gap ${aText(dp.viaGap)}`;
    } else {
      label =
        dp.viaGap <= 0
          ? `Width ${aText(dp.width)}, gap ${aText(dp.gap)}`
          : `Width ${aText(dp.width)}, gap ${aText(dp.gap)}, via gap ${aText(dp.viaGap)}`;
    }

    items.push({
      label,
      checked: !aSelection.useCustomDiffPair && aSelection.diffPairIndex === i,
      action: { kind: 'index', index: i },
    });
  }

  return items;
}
