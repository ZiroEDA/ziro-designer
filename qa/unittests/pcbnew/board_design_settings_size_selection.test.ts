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

const MM = (n: number): number => mmToIU(n);

interface Sel {
  trackWidthIndex?: number;
  viaSizeIndex?: number;
  diffPairIndex?: number;
  useCustomTrackVia?: boolean;
  useCustomDiffPair?: boolean;
  customTrackWidth?: number;
  customViaSize?: VIA_DIMENSION;
  customDiffPair?: DIFF_PAIR_DIMENSION;
  /** A netclass that names differential-pair dimensions; the default does not. */
  ncDiffPair?: { width?: number; gap?: number; viaGap?: number };
}

/** The lists every board has, reserved `[0]` included. */
function sizes(over: Sel = {}): BOARD_DESIGN_SETTINGS {
  const bds = new BOARD_DESIGN_SETTINGS();

  bds.m_TrackWidthList = [0, MM(0.3), MM(0.5)];
  bds.m_ViasDimensionsList = [
    new VIA_DIMENSION(0, 0),
    new VIA_DIMENSION(MM(0.6), MM(0.3)),
    new VIA_DIMENSION(MM(1.0), MM(0.5)),
  ];
  bds.m_DiffPairDimensionsList = [
    new DIFF_PAIR_DIMENSION(0, 0, 0),
    new DIFF_PAIR_DIMENSION(MM(0.2), MM(0.25), MM(0.5)),
  ];

  // A netclass that names no differential-pair dimension at all, so the
  // fallbacks are the thing under test unless a case asks otherwise.
  const nc = bds.m_NetSettings.GetDefaultNetclass();
  nc.SetTrackWidth(MM(0.25));
  nc.SetClearance(MM(0.2));
  nc.SetViaDiameter(MM(0.8));
  nc.SetViaDrill(MM(0.4));

  // NETCLASS's constructor fills in DEFAULT_DIFF_PAIR_*, so the fallback
  // branches are unreachable until they are cleared. A board's Default class
  // does name them; a class that does not is what those branches are for.
  nc.SetDiffPairWidth(over.ncDiffPair?.width);
  nc.SetDiffPairGap(over.ncDiffPair?.gap);
  nc.SetDiffPairViaGap(over.ncDiffPair?.viaGap);

  // The setters clear the custom flags, so indices go in before the flags.
  if (over.trackWidthIndex !== undefined) bds.SetTrackWidthIndex(over.trackWidthIndex);
  if (over.viaSizeIndex !== undefined) bds.SetViaSizeIndex(over.viaSizeIndex);
  if (over.diffPairIndex !== undefined) bds.SetDiffPairIndex(over.diffPairIndex);

  if (over.customTrackWidth !== undefined) bds.SetCustomTrackWidth(over.customTrackWidth);
  if (over.customViaSize !== undefined) bds.SetCustomViaSize(over.customViaSize.m_Diameter);
  if (over.useCustomTrackVia) bds.UseCustomTrackViaSize(true);
  if (over.useCustomDiffPair) bds.UseCustomDiffPairDimensions(true);

  return bds;
}

describe('the reserved [0] entry', () => {
  it('is a dummy of zeros that shifts every real row up one', () => {
    // `trackWidths.insert( trackWidths.begin(), 0 )` and friends: index 0 is
    // reserved for "use the netclass", so the lists a board carries are one
    // longer than what the user typed in Board Setup.
    const s = sizes();

    expect(s.m_TrackWidthList[0]).toBe(0);
    expect(s.m_ViasDimensionsList[0]!.m_Diameter).toBe(0);
    expect(s.m_DiffPairDimensionsList[0]!.m_Width).toBe(0);
  });

  it('makes index 1 the first row the user typed', () => {
    const s = sizes({ trackWidthIndex: 1 });

    expect(s.GetCurrentTrackWidth()).toBe(MM(0.3));
  });
});

describe('the setters clear the custom flag', () => {
  it('choosing a track preset turns the custom track/via override off', () => {
    // `m_useCustomTrackVia = false` is how a user leaves "custom" — there is no
    // separate control for it.
    const s = sizes({ useCustomTrackVia: true, customTrackWidth: MM(9) });

    expect(
      (() => {
        const b = s;
        b.SetTrackWidthIndex(2);
        return b.UseCustomTrackViaSize();
      })(),
    ).toBe(false);
    expect(
      (() => {
        const b = s;
        b.SetViaSizeIndex(2);
        return b.UseCustomTrackViaSize();
      })(),
    ).toBe(false);
  });

  it('the two flags are separate: a via choice does not clear the diff pair’s', () => {
    // A fresh one per assertion: these mutate, where the old free functions
    // returned a new state and could share a fixture.
    const viaChoice = sizes({ useCustomTrackVia: true, useCustomDiffPair: true });
    viaChoice.SetViaSizeIndex(1);
    expect(viaChoice.UseCustomDiffPairDimensions()).toBe(true);

    const pairChoice = sizes({ useCustomTrackVia: true, useCustomDiffPair: true });
    pairChoice.SetDiffPairIndex(1);
    expect(pairChoice.UseCustomTrackViaSize()).toBe(true);
  });

  it('clamps an index past the end of the list', () => {
    // `std::min( aIndex, (int) list.size() - 1 )`; the list is 3 long with the
    // reserved entry.
    expect(
      (() => {
        const b = sizes();
        b.SetTrackWidthIndex(99);
        return b.GetTrackWidthIndex();
      })(),
    ).toBe(2);
    expect(
      (() => {
        const b = sizes();
        b.SetViaSizeIndex(99);
        return b.GetViaSizeIndex();
      })(),
    ).toBe(2);
    expect(
      (() => {
        const b = sizes();
        b.SetDiffPairIndex(99);
        return b.GetDiffPairIndex();
      })(),
    ).toBe(1);
  });

  it('leaves the diff-pair index alone when the list is EMPTY', () => {
    // `if( !m_DiffPairDimensionsList.empty() )` guards only that assignment.
    // The other two setters have no such guard and would clamp to -1.
    const empty = sizes({ diffPairIndex: 1, useCustomDiffPair: true });
    empty.m_DiffPairDimensionsList = [];

    empty.SetDiffPairIndex(5);

    expect(empty.GetDiffPairIndex()).toBe(1);
    // …and the flag is cleared regardless, because it is outside the `if`.
    expect(empty.UseCustomDiffPairDimensions()).toBe(false);
  });

  it('clamps the track index to -1 on an empty list, which the diff pair does not', () => {
    // The asymmetry, stated as the pair it is.
    const b = sizes();
    b.m_TrackWidthList = [];
    b.SetTrackWidthIndex(5);

    expect(b.GetTrackWidthIndex()).toBe(-1);
  });
});

describe('who is in charge', () => {
  it('is the netclass at index 0 with no custom override', () => {
    const s = sizes();

    expect([s.UseNetClassTrack(), s.UseNetClassVia(), s.UseNetClassDiffPair()]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('is not the netclass once a row is chosen', () => {
    const s = sizes({ trackWidthIndex: 1, viaSizeIndex: 1, diffPairIndex: 1 });

    expect([s.UseNetClassTrack(), s.UseNetClassVia(), s.UseNetClassDiffPair()]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('is not the netclass under a custom override, at index 0', () => {
    const trackVia = sizes({ useCustomTrackVia: true });
    expect([trackVia.UseNetClassTrack(), trackVia.UseNetClassVia()]).toEqual([false, false]);

    const dp = sizes({ useCustomDiffPair: true });
    expect(dp.UseNetClassDiffPair()).toBe(false);
  });

  it('disagrees on a NEGATIVE index, and that is upstream’s spelling', () => {
    // `UseNetClassTrack()` is `<= 0`; `UseNetClassDiffPair()` is `== 0`. A
    // negative index — which `SetTrackWidthIndex` on an empty list produces —
    // is "netclass" for the track and NOT for the diff pair.
    const s = sizes({ trackWidthIndex: -1, viaSizeIndex: -1, diffPairIndex: -1 });

    expect(s.UseNetClassTrack()).toBe(true);
    expect(s.UseNetClassVia()).toBe(true);
    expect(s.UseNetClassDiffPair()).toBe(false);
  });
});

describe('GetCurrentTrackWidth / ViaSize / ViaDrill', () => {
  it('takes the custom value first of all', () => {
    const s = sizes({ trackWidthIndex: 1, viaSizeIndex: 1 });
    s.SetCustomTrackWidth(MM(0.9));
    s.SetCustomViaSize(MM(1.2));
    s.SetCustomViaDrill(MM(0.6));
    s.UseCustomTrackViaSize(true);

    expect(s.GetCurrentTrackWidth()).toBe(MM(0.9));
    expect(s.GetCurrentViaSize()).toBe(MM(1.2));
    expect(s.GetCurrentViaDrill()).toBe(MM(0.6));
  });

  it('takes the netclass at index 0', () => {
    expect(sizes().GetCurrentTrackWidth()).toBe(MM(0.25));
    expect(sizes().GetCurrentViaSize()).toBe(MM(0.8));
    expect(sizes().GetCurrentViaDrill()).toBe(MM(0.4));
  });

  it('takes the netclass for an index past the end, rather than reading off it', () => {
    // `|| m_trackWidthIndex >= (int) list.size()` — the second half of the same
    // test, and the reason a shrunken list does not crash.
    // The setter clamps, so an out-of-range index cannot be chosen — it is
    // reached by Board Setup DELETING a row after one was. Shrinking the
    // lists is that, and it is the reason the getter tests the bound at all.
    const s = sizes({ trackWidthIndex: 2, viaSizeIndex: 2 });
    s.m_TrackWidthList = [0];
    s.m_ViasDimensionsList = [new VIA_DIMENSION(0, 0)];

    expect(s.GetCurrentTrackWidth()).toBe(MM(0.25));
    expect(s.GetCurrentViaSize()).toBe(MM(0.8));
  });

  it('takes the selected row', () => {
    const s = sizes({ trackWidthIndex: 2, viaSizeIndex: 2 });

    expect(s.GetCurrentTrackWidth()).toBe(MM(0.5));
    expect(s.GetCurrentViaSize()).toBe(MM(1.0));
    expect(s.GetCurrentViaDrill()).toBe(MM(0.5));
  });

  it('reports a missing drill as -1, not 0', () => {
    // `return drill > 0 ? drill : -1`. PCB_VIA reads -1 as "no drill set"; a
    // zero would be a zero-diameter hole.
    const s = sizes();
    s.m_ViasDimensionsList = [new VIA_DIMENSION(0, 0), new VIA_DIMENSION(MM(0.6), 0)];
    s.SetViaSizeIndex(1);

    expect(s.GetCurrentViaDrill()).toBe(-1);
  });
});

describe('GetCurrentDiffPair* and its netclass fallbacks', () => {
  it('takes the custom values first of all', () => {
    const s = sizes({ diffPairIndex: 1 });
    s.SetCustomDiffPairWidth(MM(0.15));
    s.SetCustomDiffPairGap(MM(0.15));
    s.SetCustomDiffPairViaGap(MM(0.3));
    s.UseCustomDiffPairDimensions(true);

    expect(s.GetCurrentDiffPairWidth()).toBe(MM(0.15));
    expect(s.GetCurrentDiffPairGap()).toBe(MM(0.15));
    expect(s.GetCurrentDiffPairViaGap()).toBe(MM(0.3));
  });

  it('takes the selected row', () => {
    const s = sizes({ diffPairIndex: 1 });

    expect(s.GetCurrentDiffPairWidth()).toBe(MM(0.2));
    expect(s.GetCurrentDiffPairGap()).toBe(MM(0.25));
    expect(s.GetCurrentDiffPairViaGap()).toBe(MM(0.5));
  });

  it('falls back to the netclass’s own pair dimensions when it has them', () => {
    const s = sizes({
      ncDiffPair: { width: MM(0.18), gap: MM(0.22), viaGap: MM(0.45) },
    });

    expect(s.GetCurrentDiffPairWidth()).toBe(MM(0.18));
    expect(s.GetCurrentDiffPairGap()).toBe(MM(0.22));
    expect(s.GetCurrentDiffPairViaGap()).toBe(MM(0.45));
  });

  it('falls back to the TRACK WIDTH when the netclass names no pair width', () => {
    // `HasDiffPairWidth() ? GetDiffPairWidth() : GetTrackWidth()` — not zero,
    // and not the board minimum.
    expect(sizes().GetCurrentDiffPairWidth()).toBe(MM(0.25));
  });

  it('falls back to the CLEARANCE when the netclass names no pair gap', () => {
    // `HasDiffPairGap() ? GetDiffPairGap() : GetClearance()`.
    expect(sizes().GetCurrentDiffPairGap()).toBe(MM(0.2));
  });

  it('falls back to the RESOLVED gap for the via gap, not to the raw netclass one', () => {
    // `HasDiffPairViaGap() ? … : GetCurrentDiffPairGap()`. With no netclass via
    // gap the answer is whatever the gap resolved to — here the netclass
    // clearance, since the netclass has no pair gap either.
    expect(sizes().GetCurrentDiffPairViaGap()).toBe(MM(0.2));

    // And with a pair gap on the netclass it follows that instead.
    const withGap = sizes({ ncDiffPair: { gap: MM(0.22) } });
    expect(withGap.GetCurrentDiffPairViaGap()).toBe(MM(0.22));
  });

  it('takes the netclass for an index past the end of the pair list', () => {
    const s = sizes({ diffPairIndex: 1 });
    s.m_DiffPairDimensionsList = [new DIFF_PAIR_DIMENSION(0, 0, 0)];

    expect(s.GetCurrentDiffPairWidth()).toBe(MM(0.25));
  });

  it('reads index 0 as the netclass even though the dummy row is there', () => {
    // `m_diffPairIndex <= 0` catches the reserved entry before anything
    // dereferences it, which is why the dummy can be zeros.
    expect(sizes({ diffPairIndex: 0 }).GetCurrentDiffPairWidth()).toBe(MM(0.25));
  });
});

/**
 * The same twelve, now as BOARD_DESIGN_SETTINGS methods reading its own
 * fields. These are the ones KiCad declares; the free functions above stand
 * over a shim that duplicates the same state and is on its way out.
 */
describe('BOARD_DESIGN_SETTINGS size selection', () => {
  const bds = (): BOARD_DESIGN_SETTINGS => {
    const d = new BOARD_DESIGN_SETTINGS();
    d.m_TrackWidthList = [0, 100, 200, 300];
    d.m_ViasDimensionsList = [
      new VIA_DIMENSION(0, 0),
      new VIA_DIMENSION(600, 300),
      new VIA_DIMENSION(800, 400),
    ];
    return d;
  };

  it('index 0 means "use the netclass", and a set clears the custom flag', () => {
    const d = bds();
    d.UseCustomTrackViaSize(true);
    expect(d.UseNetClassTrack()).toBe(false);

    d.SetTrackWidthIndex(2);
    expect(d.UseCustomTrackViaSize()).toBe(false);
    expect(d.UseNetClassTrack()).toBe(false);
    expect(d.GetCurrentTrackWidth()).toBe(200);

    d.SetTrackWidthIndex(0);
    expect(d.UseNetClassTrack()).toBe(true);
  });

  it('clamps an index past the end of its list', () => {
    const d = bds();
    d.SetTrackWidthIndex(99);
    expect(d.GetTrackWidthIndex()).toBe(3);
    d.SetViaSizeIndex(99);
    expect(d.GetViaSizeIndex()).toBe(2);
  });

  it('leaves the diff-pair index alone when that list is empty, but still clears the flag', () => {
    // The two size setters have no such guard and would clamp to -1.
    const d = bds();
    d.m_DiffPairDimensionsList = [];
    d.UseCustomDiffPairDimensions(true);

    d.SetDiffPairIndex(5);

    expect(d.GetDiffPairIndex()).toBe(0);
    expect(d.UseCustomDiffPairDimensions()).toBe(false);
  });

  it('UseNetClassDiffPair tests == 0, not <= 0', () => {
    const d = bds();
    expect(d.UseNetClassDiffPair()).toBe(true);
  });

  it('returns -1, not 0, when the resolved via drill is not positive', () => {
    // A pre-defined row may name a diameter and leave the drill at zero; the
    // callers test for a negative, and a zero would read as a zero-width hole.
    const d = bds();
    d.m_ViasDimensionsList = [new VIA_DIMENSION(0, 0), new VIA_DIMENSION(600, 0)];
    d.SetViaSizeIndex(1);

    expect(d.GetCurrentViaSize()).toBe(600);
    expect(d.GetCurrentViaDrill()).toBe(-1);
  });
});
