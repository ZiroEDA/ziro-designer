// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_DESIGN_SETTINGS`'s size selection
 * (`pcbnew/board_design_settings.cpp:1489-1607`) — the layer between Board
 * Setup > Pre-defined Sizes and everything that places copper.
 *
 * Almost every case here is a branch that looks like a typo in the C++ and is
 * not:
 *
 *   - `UseNetClassDiffPair()` tests `== 0` where the other two test `<= 0`;
 *   - `SetDiffPairIndex` clamps only when the list is non-empty, where the
 *     other two setters clamp unconditionally — and clears its flag either way,
 *     outside the `if`;
 *   - `GetCurrentViaDrill()` returns **-1** for a non-positive drill, not 0;
 *   - a netclass with no differential-pair width falls back to its ordinary
 *     TRACK WIDTH, and one with no gap to its CLEARANCE;
 *   - `GetCurrentDiffPairViaGap()`'s last fallback is the RESOLVED
 *     `GetCurrentDiffPairGap()`, so a selected row's gap can supply it.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  defaultTrackViaSizeState,
  getCurrentDiffPairGap,
  getCurrentDiffPairViaGap,
  getCurrentDiffPairWidth,
  getCurrentTrackWidth,
  getCurrentViaDrill,
  getCurrentViaSize,
  setDiffPairIndex,
  setTrackWidthIndex,
  setViaSizeIndex,
  useNetClassDiffPair,
  useNetClassTrack,
  useNetClassVia,
  withNetclassEntry,
  type DefaultNetclassDims,
  type TrackViaSizes,
} from '@ziroeda/pcbnew/src/board_design_settings_sizes.js';

const MM = (n: number): number => mmToIU(n);

/** A netclass that names no differential-pair dimension at all. */
const PLAIN_NC: DefaultNetclassDims = {
  trackWidth: MM(0.25),
  clearance: MM(0.2),
  viaDiameter: MM(0.8),
  viaDrill: MM(0.4),
};

function sizes(over: Partial<TrackViaSizes> = {}): TrackViaSizes {
  return {
    // The reserved [0] is present, as it is on every board.
    trackWidthList: withNetclassEntry([MM(0.3), MM(0.5)], 0),
    viasDimensionsList: withNetclassEntry(
      [
        { diameter: MM(0.6), drill: MM(0.3) },
        { diameter: MM(1.0), drill: MM(0.5) },
      ],
      { diameter: 0, drill: 0 },
    ),
    diffPairDimensionsList: withNetclassEntry(
      [{ width: MM(0.2), gap: MM(0.25), viaGap: MM(0.5) }],
      { width: 0, gap: 0, viaGap: 0 },
    ),
    defaultNetclass: PLAIN_NC,
    selection: defaultTrackViaSizeState(),
    ...over,
  };
}

const at = (s: TrackViaSizes, over: Partial<TrackViaSizes['selection']>): TrackViaSizes => ({
  ...s,
  selection: { ...s.selection, ...over },
});

describe('the reserved [0] entry', () => {
  it('is a dummy of zeros that shifts every real row up one', () => {
    // `trackWidths.insert( trackWidths.begin(), 0 )` and friends.
    expect(withNetclassEntry([MM(0.3)], 0)).toEqual([0, MM(0.3)]);
    expect(
      withNetclassEntry([{ width: 1, gap: 2, viaGap: 3 }], { width: 0, gap: 0, viaGap: 0 }),
    ).toEqual([
      { width: 0, gap: 0, viaGap: 0 },
      { width: 1, gap: 2, viaGap: 3 },
    ]);
  });

  it('makes index 1 the first row the user typed', () => {
    const s = at(sizes(), { trackWidthIndex: 1 });

    expect(getCurrentTrackWidth(s)).toBe(MM(0.3));
  });
});

describe('the setters clear the custom flag', () => {
  it('choosing a track preset turns the custom track/via override off', () => {
    // `m_useCustomTrackVia = false` is how a user leaves "custom" — there is no
    // separate control for it.
    const s = at(sizes(), { useCustomTrackVia: true, customTrackWidth: MM(9) });

    expect(setTrackWidthIndex(s, 2).useCustomTrackVia).toBe(false);
    expect(setViaSizeIndex(s, 2).useCustomTrackVia).toBe(false);
  });

  it('the two flags are separate: a via choice does not clear the diff pair’s', () => {
    const s = at(sizes(), { useCustomTrackVia: true, useCustomDiffPair: true });

    expect(setViaSizeIndex(s, 1).useCustomDiffPair).toBe(true);
    expect(setDiffPairIndex(s, 1).useCustomTrackVia).toBe(true);
  });

  it('clamps an index past the end of the list', () => {
    // `std::min( aIndex, (int) list.size() - 1 )`; the list is 3 long with the
    // reserved entry.
    expect(setTrackWidthIndex(sizes(), 99).trackWidthIndex).toBe(2);
    expect(setViaSizeIndex(sizes(), 99).viaSizeIndex).toBe(2);
    expect(setDiffPairIndex(sizes(), 99).diffPairIndex).toBe(1);
  });

  it('leaves the diff-pair index alone when the list is EMPTY', () => {
    // `if( !m_DiffPairDimensionsList.empty() )` guards only that assignment.
    // The other two setters have no such guard and would clamp to -1.
    const empty = at(sizes({ diffPairDimensionsList: [] }), {
      diffPairIndex: 1,
      useCustomDiffPair: true,
    });

    const next = setDiffPairIndex(empty, 5);
    expect(next.diffPairIndex).toBe(1);
    // …and the flag is cleared regardless, because it is outside the `if`.
    expect(next.useCustomDiffPair).toBe(false);
  });

  it('clamps the track index to -1 on an empty list, which the diff pair does not', () => {
    // The asymmetry, stated as the pair it is.
    expect(setTrackWidthIndex(sizes({ trackWidthList: [] }), 5).trackWidthIndex).toBe(-1);
  });
});

describe('who is in charge', () => {
  it('is the netclass at index 0 with no custom override', () => {
    const s = sizes().selection;

    expect([useNetClassTrack(s), useNetClassVia(s), useNetClassDiffPair(s)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('is not the netclass once a row is chosen', () => {
    const s = { ...sizes().selection, trackWidthIndex: 1, viaSizeIndex: 1, diffPairIndex: 1 };

    expect([useNetClassTrack(s), useNetClassVia(s), useNetClassDiffPair(s)]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('is not the netclass under a custom override, at index 0', () => {
    const trackVia = { ...sizes().selection, useCustomTrackVia: true };
    expect([useNetClassTrack(trackVia), useNetClassVia(trackVia)]).toEqual([false, false]);

    const dp = { ...sizes().selection, useCustomDiffPair: true };
    expect(useNetClassDiffPair(dp)).toBe(false);
  });

  it('disagrees on a NEGATIVE index, and that is upstream’s spelling', () => {
    // `UseNetClassTrack()` is `<= 0`; `UseNetClassDiffPair()` is `== 0`. A
    // negative index — which `SetTrackWidthIndex` on an empty list produces —
    // is "netclass" for the track and NOT for the diff pair.
    const s = { ...sizes().selection, trackWidthIndex: -1, viaSizeIndex: -1, diffPairIndex: -1 };

    expect(useNetClassTrack(s)).toBe(true);
    expect(useNetClassVia(s)).toBe(true);
    expect(useNetClassDiffPair(s)).toBe(false);
  });
});

describe('GetCurrentTrackWidth / ViaSize / ViaDrill', () => {
  it('takes the custom value first of all', () => {
    const s = at(sizes(), {
      trackWidthIndex: 1,
      viaSizeIndex: 1,
      useCustomTrackVia: true,
      customTrackWidth: MM(0.9),
      customViaSize: { diameter: MM(1.2), drill: MM(0.6) },
    });

    expect(getCurrentTrackWidth(s)).toBe(MM(0.9));
    expect(getCurrentViaSize(s)).toBe(MM(1.2));
    expect(getCurrentViaDrill(s)).toBe(MM(0.6));
  });

  it('takes the netclass at index 0', () => {
    expect(getCurrentTrackWidth(sizes())).toBe(MM(0.25));
    expect(getCurrentViaSize(sizes())).toBe(MM(0.8));
    expect(getCurrentViaDrill(sizes())).toBe(MM(0.4));
  });

  it('takes the netclass for an index past the end, rather than reading off it', () => {
    // `|| m_trackWidthIndex >= (int) list.size()` — the second half of the same
    // test, and the reason a shrunken list does not crash.
    const s = at(sizes(), { trackWidthIndex: 99, viaSizeIndex: 99 });

    expect(getCurrentTrackWidth(s)).toBe(MM(0.25));
    expect(getCurrentViaSize(s)).toBe(MM(0.8));
  });

  it('takes the selected row', () => {
    const s = at(sizes(), { trackWidthIndex: 2, viaSizeIndex: 2 });

    expect(getCurrentTrackWidth(s)).toBe(MM(0.5));
    expect(getCurrentViaSize(s)).toBe(MM(1.0));
    expect(getCurrentViaDrill(s)).toBe(MM(0.5));
  });

  it('reports a missing drill as -1, not 0', () => {
    // `return drill > 0 ? drill : -1`. PCB_VIA reads -1 as "no drill set"; a
    // zero would be a zero-diameter hole.
    const s = at(
      sizes({
        viasDimensionsList: withNetclassEntry([{ diameter: MM(0.6), drill: 0 }], {
          diameter: 0,
          drill: 0,
        }),
      }),
      { viaSizeIndex: 1 },
    );

    expect(getCurrentViaDrill(s)).toBe(-1);
  });
});

describe('GetCurrentDiffPair* and its netclass fallbacks', () => {
  it('takes the custom values first of all', () => {
    const s = at(sizes(), {
      diffPairIndex: 1,
      useCustomDiffPair: true,
      customDiffPair: { width: MM(0.15), gap: MM(0.15), viaGap: MM(0.3) },
    });

    expect(getCurrentDiffPairWidth(s)).toBe(MM(0.15));
    expect(getCurrentDiffPairGap(s)).toBe(MM(0.15));
    expect(getCurrentDiffPairViaGap(s)).toBe(MM(0.3));
  });

  it('takes the selected row', () => {
    const s = at(sizes(), { diffPairIndex: 1 });

    expect(getCurrentDiffPairWidth(s)).toBe(MM(0.2));
    expect(getCurrentDiffPairGap(s)).toBe(MM(0.25));
    expect(getCurrentDiffPairViaGap(s)).toBe(MM(0.5));
  });

  it('falls back to the netclass’s own pair dimensions when it has them', () => {
    const s = sizes({
      defaultNetclass: {
        ...PLAIN_NC,
        diffPairWidth: MM(0.18),
        diffPairGap: MM(0.22),
        diffPairViaGap: MM(0.45),
      },
    });

    expect(getCurrentDiffPairWidth(s)).toBe(MM(0.18));
    expect(getCurrentDiffPairGap(s)).toBe(MM(0.22));
    expect(getCurrentDiffPairViaGap(s)).toBe(MM(0.45));
  });

  it('falls back to the TRACK WIDTH when the netclass names no pair width', () => {
    // `HasDiffPairWidth() ? GetDiffPairWidth() : GetTrackWidth()` — not zero,
    // and not the board minimum.
    expect(getCurrentDiffPairWidth(sizes())).toBe(MM(0.25));
  });

  it('falls back to the CLEARANCE when the netclass names no pair gap', () => {
    // `HasDiffPairGap() ? GetDiffPairGap() : GetClearance()`.
    expect(getCurrentDiffPairGap(sizes())).toBe(MM(0.2));
  });

  it('falls back to the RESOLVED gap for the via gap, not to the raw netclass one', () => {
    // `HasDiffPairViaGap() ? … : GetCurrentDiffPairGap()`. With no netclass via
    // gap the answer is whatever the gap resolved to — here the netclass
    // clearance, since the netclass has no pair gap either.
    expect(getCurrentDiffPairViaGap(sizes())).toBe(MM(0.2));

    // And with a pair gap on the netclass it follows that instead.
    const withGap = sizes({ defaultNetclass: { ...PLAIN_NC, diffPairGap: MM(0.22) } });
    expect(getCurrentDiffPairViaGap(withGap)).toBe(MM(0.22));
  });

  it('takes the netclass for an index past the end of the pair list', () => {
    const s = at(sizes(), { diffPairIndex: 99 });

    expect(getCurrentDiffPairWidth(s)).toBe(MM(0.25));
  });

  it('reads index 0 as the netclass even though the dummy row is there', () => {
    // `m_diffPairIndex <= 0` catches the reserved entry before anything
    // dereferences it, which is why the dummy can be zeros.
    expect(getCurrentDiffPairWidth(at(sizes(), { diffPairIndex: 0 }))).toBe(MM(0.25));
  });
});
