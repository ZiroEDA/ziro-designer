// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ROUTER_TOOL`'s `TRACK_WIDTH_MENU` and `DIFF_PAIR_MENU`
 * (`pcbnew/router/router_tool.cpp:280-520`), plus the width-cycling actions
 * they share with `BOARD_EDITOR_CONTROL` (`board_editor_control.cpp:1086-1200`).
 *
 * The two menus read the SAME three lists and number their rows differently:
 * the track menu lists index 0 as a row of its own, the diff-pair menu starts
 * at 1 and folds index 0 into its "Use Net Class Values" header. Upstream even
 * comments the arithmetic that falls out of it —
 * `// remember that the menu doesn't contain index 0` — which is a good sign it
 * is worth a test.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import {
  BOARD_DESIGN_SETTINGS,
  DIFF_PAIR_DIMENSION,
  VIA_DIMENSION,
} from '@ziroeda/pcbnew/board_design_settings.js';
import {
  NextDiffPairIndex,
  NextTrackWidthIndex,
  UseNetclassTrackAndVia,
} from '@ziroeda/pcbnew/tools/board_editor_control.js';
import {
  diffPairMenuItems,
  trackWidthMenuItems,
} from '@ziroeda/pcbnew/router/router_size_menus.js';

const MM = (n: number): number => mmToIU(n);

/** `MessageTextFromValue` at a millimetre frame, near enough for a label. */
const text = (iu: number): string => `${(iu / 1e6).toFixed(2)} mm`;

const TRACKS = [0, MM(0.25), MM(0.5)];
const VIAS = [
  new VIA_DIMENSION(0, 0),
  new VIA_DIMENSION(MM(0.6), MM(0.3)),
  new VIA_DIMENSION(MM(0.8), 0),
];
const PAIRS = [
  new DIFF_PAIR_DIMENSION(0, 0, 0),
  new DIFF_PAIR_DIMENSION(MM(0.2), MM(0.25), MM(0.5)),
  new DIFF_PAIR_DIMENSION(MM(0.2), MM(0.25), 0),
  new DIFF_PAIR_DIMENSION(MM(0.3), 0, 0),
  new DIFF_PAIR_DIMENSION(MM(0.3), 0, MM(0.4)),
];

/** A BOARD_DESIGN_SETTINGS carrying the three lists and a chosen selection. */
function sizes(
  over: {
    trackWidthIndex?: number;
    viaSizeIndex?: number;
    diffPairIndex?: number;
    useCustomTrackVia?: boolean;
    useCustomDiffPair?: boolean;
  } = {},
): BOARD_DESIGN_SETTINGS {
  const bds = new BOARD_DESIGN_SETTINGS();

  bds.m_TrackWidthList = TRACKS;
  bds.m_ViasDimensionsList = VIAS;
  bds.m_DiffPairDimensionsList = PAIRS;

  const nc = bds.m_NetSettings.GetDefaultNetclass();
  nc.SetTrackWidth(MM(0.25));
  nc.SetClearance(MM(0.2));
  nc.SetViaDiameter(MM(0.8));
  nc.SetViaDrill(MM(0.4));

  // The setters clear the custom flags, so they run before the flags are set.
  if (over.trackWidthIndex !== undefined) bds.SetTrackWidthIndex(over.trackWidthIndex);
  if (over.viaSizeIndex !== undefined) bds.SetViaSizeIndex(over.viaSizeIndex);
  if (over.diffPairIndex !== undefined) bds.SetDiffPairIndex(over.diffPairIndex);
  if (over.useCustomTrackVia) bds.UseCustomTrackViaSize(true);
  if (over.useCustomDiffPair) bds.UseCustomDiffPairDimensions(true);

  return bds;
}

const labels = (items: { label: string }[]): string[] => items.map((i) => i.label);
const checkedLabel = (items: { label: string; checked: boolean }[]): string[] =>
  items.filter((i) => i.checked).map((i) => i.label);

describe('TRACK_WIDTH_MENU', () => {
  const menu = (over: Parameters<typeof sizes>[0] = {}, connected = false) =>
    trackWidthMenuItems(TRACKS, VIAS, sizes(over), connected, text);

  it('lists both lists, index 0 included and labelled', () => {
    expect(labels(menu())).toEqual([
      'Use Starting Track Width',
      'Use Net Class Values',
      'Use Custom Values...',
      'Track netclass width',
      'Track 0.25 mm',
      'Track 0.50 mm',
      'Via netclass values',
      'Via 0.60 mm, hole 0.30 mm',
      'Via 0.80 mm',
    ]);
  });

  it('drops the hole from a via row that has none', () => {
    // `if( via.m_Drill > 0 )` — a zero drill is "use the netclass drill", and
    // upstream prints the diameter alone rather than "hole 0".
    expect(labels(menu())).toContain('Via 0.80 mm');
  });

  it('checks the netclass row only when BOTH indices are 0', () => {
    expect(checkedLabel(menu())).toEqual([
      'Use Net Class Values',
      'Track netclass width',
      'Via netclass values',
    ]);

    // One index off zero and the header stops being checked, though the other
    // list's own index-0 row still is. Both directions, because the row reads
    // `trackWidthIndex == 0 && viaSizeIndex == 0` and dropping either half
    // looks right from one of them.
    expect(checkedLabel(menu({ trackWidthIndex: 2 }))).toEqual([
      'Track 0.50 mm',
      'Via netclass values',
    ]);
    expect(checkedLabel(menu({ viaSizeIndex: 1 }))).toEqual([
      'Track netclass width',
      'Via 0.60 mm, hole 0.30 mm',
    ]);
  });

  it('checks no list row while a custom size or the starting width is in force', () => {
    // `useIndex = !m_UseConnectedTrackWidth && !UseCustomTrackViaSize()`.
    expect(checkedLabel(menu({ useCustomTrackVia: true }))).toEqual(['Use Custom Values...']);
    expect(checkedLabel(menu({}, true))).toEqual(['Use Starting Track Width']);
  });

  it('separates the headers from the tracks, and the tracks from the vias', () => {
    const seps = menu()
      .map((it, i) => (it.separatorAfter ? i : -1))
      .filter((i) => i >= 0);

    expect(seps).toEqual([2, 5]);
  });
});

describe('DIFF_PAIR_MENU', () => {
  const menu = (over: Parameters<typeof sizes>[0] = {}) =>
    diffPairMenuItems(PAIRS, sizes(over), text);

  it('starts at index 1 — the reserved entry is the header, not a row', () => {
    expect(labels(menu())).toEqual([
      'Use Net Class Values',
      'Use Custom Values...',
      'Width 0.20 mm, gap 0.25 mm, via gap 0.50 mm',
      'Width 0.20 mm, gap 0.25 mm',
      'Width 0.30 mm',
      'Width 0.30 mm, via gap 0.40 mm',
    ]);
  });

  it('names index 1 as the FIRST row, so the action index is off by one from the row', () => {
    // The comment upstream leaves on it:
    // `bds.SetDiffPairIndex( id - ID_POPUP_PCB_SELECT_DIFFPAIR1 + 1 )`.
    const rows = menu().filter((i) => i.action.kind === 'index');

    expect(rows[0]!.action).toEqual({ kind: 'index', index: 1 });
  });

  it('checks the netclass header at index 0 and nothing else', () => {
    expect(checkedLabel(menu())).toEqual(['Use Net Class Values']);
    expect(checkedLabel(menu({ diffPairIndex: 2 }))).toEqual(['Width 0.20 mm, gap 0.25 mm']);
    expect(checkedLabel(menu({ useCustomDiffPair: true }))).toEqual(['Use Custom Values...']);
  });

  it('checks nothing in the list while a custom value is in force, even at that index', () => {
    // `!bds.UseCustomDiffPairDimensions() && bds.GetDiffPairIndex() == i`.
    expect(checkedLabel(menu({ diffPairIndex: 2, useCustomDiffPair: true }))).toEqual([
      'Use Custom Values...',
    ]);
  });
});

describe('cycling the diff-pair index', () => {
  it('wraps off the end to 0, which is the netclass', () => {
    // `if( widthIndex >= (int) size ) widthIndex = 0` — index 0 IS a stop.
    expect(
      (() => {
        const b = sizes({ diffPairIndex: 4 });
        NextDiffPairIndex(b, 1);
        return b.GetDiffPairIndex();
      })(),
    ).toBe(0);
  });

  it('wraps off the front to the last entry', () => {
    // `if( widthIndex < 0 ) widthIndex = size - 1`.
    expect(
      (() => {
        const b = sizes({ diffPairIndex: 0 });
        NextDiffPairIndex(b, -1);
        return b.GetDiffPairIndex();
      })(),
    ).toBe(4);
  });

  it('steps one at a time in between', () => {
    expect(
      (() => {
        const b = sizes({ diffPairIndex: 1 });
        NextDiffPairIndex(b, 1);
        return b.GetDiffPairIndex();
      })(),
    ).toBe(2);
    expect(
      (() => {
        const b = sizes({ diffPairIndex: 2 });
        NextDiffPairIndex(b, -1);
        return b.GetDiffPairIndex();
      })(),
    ).toBe(1);
  });

  it('clears the custom override on the way', () => {
    // `bds.UseCustomDiffPairDimensions( false )` follows every SetDiffPairIndex.
    const b = sizes({ useCustomDiffPair: true });
    NextDiffPairIndex(b, 1);
    expect(b.UseCustomDiffPairDimensions()).toBe(false);
  });
});

describe('cycling the track width index', () => {
  const routing = {
    routingTrack: false,
    useConnectedTrackWidth: false,
    tempOverrideTrackWidth: false,
  };

  it('wraps both ways', () => {
    const up = sizes({ trackWidthIndex: 2 });
    NextTrackWidthIndex(up, 1, routing);
    expect(up.GetTrackWidthIndex()).toBe(0);

    const down = sizes({ trackWidthIndex: 0 });
    NextTrackWidthIndex(down, -1, routing);
    expect(down.GetTrackWidthIndex()).toBe(2);
  });

  it('does NOT move the index on the first press while inheriting the width', () => {
    // `if( … m_UseConnectedTrackWidth && !m_TempOverrideTrackWidth )
    //      m_TempOverrideTrackWidth = true; else widthIndex++;`
    // The press turns the override on and leaves the index where it was, so the
    // next press continues from there rather than from 0.
    const b = sizes({ trackWidthIndex: 1 });
    const override = NextTrackWidthIndex(b, 1, {
      routingTrack: true,
      useConnectedTrackWidth: true,
      tempOverrideTrackWidth: false,
    });

    expect(b.GetTrackWidthIndex()).toBe(1);
    expect(override).toBe(true);
  });

  it('moves it on the second press, once the override is on', () => {
    const b = sizes({ trackWidthIndex: 1 });
    const override = NextTrackWidthIndex(b, 1, {
      routingTrack: true,
      useConnectedTrackWidth: true,
      tempOverrideTrackWidth: true,
    });

    expect(b.GetTrackWidthIndex()).toBe(2);
  });

  it('moves it straight away when the router is not placing a track', () => {
    // The `routerTool->IsToolActive() && … == ROUTE_TRACK` half of the guard.
    const b = sizes({ trackWidthIndex: 1 });
    NextTrackWidthIndex(b, 1, {
      routingTrack: false,
      useConnectedTrackWidth: true,
      tempOverrideTrackWidth: false,
    });

    expect(b.GetTrackWidthIndex()).toBe(2);
  });
});

describe('the "Use Net Class Values" row', () => {
  it('resets four things, including the starting-width toggle no other row touches', () => {
    const b = sizes({ trackWidthIndex: 2, viaSizeIndex: 1, useCustomTrackVia: true });
    const useConnected = UseNetclassTrackAndVia(b);

    expect(b.GetTrackWidthIndex()).toBe(0);
    expect(b.GetViaSizeIndex()).toBe(0);
    expect(b.UseCustomTrackViaSize()).toBe(false);
    expect(useConnected).toBe(false);
  });
});
