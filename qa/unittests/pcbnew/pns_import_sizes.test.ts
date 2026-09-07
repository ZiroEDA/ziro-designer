// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS_KICAD_IFACE_BASE::ImportSizes` (`pns_kicad_iface.cpp:1098-1301`) — the
 * one call that turns Board Setup into the numbers the router places copper
 * with, and the last thing standing between Pre-defined Sizes and a router.
 *
 * It returned false and wrote nothing. These pin the resolution it does
 * instead, and in particular the three asymmetries between the track, the via
 * and the differential pair that a re-derivation would smooth over:
 *
 *   - the TRACK width is `std::max( board minimum, GetCurrentTrackWidth() )`;
 *   - the VIA is `GetCurrentViaSize()` **assigned**, so a preset smaller than
 *     the board minimum reaches the router and DRC is what complains;
 *   - the diff-pair width inherits from the starting track under
 *     `m_UseConnectedTrackWidth` alone, WITHOUT the `m_TempOverrideTrackWidth`
 *     half of the test the single-track branch uses.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { PnsBoardIface } from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import { DEFAULT_ROUTER_SIZES } from '@ziroeda/pcbnew/src/router/pns_router.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import {
  defaultTrackViaSizeState,
  withNetclassEntry,
  type TrackViaSizes,
} from '@ziroeda/pcbnew/src/board_design_settings_sizes.js';
import type { PnsDesignSettings } from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import type { PnsRouterSizes } from '@ziroeda/pcbnew/src/router/pns_router.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const BOARD: Board = {
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'N1'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
};

function sizesModel(over: Partial<TrackViaSizes> = {}): TrackViaSizes {
  return {
    trackWidthList: withNetclassEntry([MM(0.3), MM(0.5)], 0),
    viasDimensionsList: withNetclassEntry([{ diameter: MM(0.6), drill: MM(0.3) }], {
      diameter: 0,
      drill: 0,
    }),
    diffPairDimensionsList: withNetclassEntry(
      [{ width: MM(0.2), gap: MM(0.25), viaGap: MM(0.5) }],
      {
        width: 0,
        gap: 0,
        viaGap: 0,
      },
    ),
    defaultNetclass: {
      trackWidth: MM(0.25),
      clearance: MM(0.2),
      viaDiameter: MM(0.8),
      viaDrill: MM(0.4),
    },
    selection: defaultTrackViaSizeState(),
    ...over,
  };
}

/** Board Setup's minimums, which are the seed every dimension starts from. */
function designSettings(over: Partial<PnsDesignSettings> = {}): PnsDesignSettings {
  return {
    minClearance: MM(0.15),
    trackMinWidth: MM(0.2),
    viasMinSize: MM(0.5),
    minThroughDrill: MM(0.3),
    holeToHoleMin: MM(0.25),
    useConnectedTrackWidth: false,
    tempOverrideTrackWidth: false,
    sizes: sizesModel(),
    ...over,
  };
}

/** `ImportSizes` over a fresh `SIZES_SETTINGS`. */
function imported(ds: PnsDesignSettings | null): {
  ok: boolean;
  sizes: PnsRouterSizes;
} {
  const iface = new PnsBoardIface(BOARD, ds ? { designSettings: ds } : {});
  const sizes: PnsRouterSizes = { ...DEFAULT_ROUTER_SIZES };
  const ok = iface.importSizes(sizes, null, null, { x: 0, y: 0 });
  return { ok, sizes };
}

describe('with no design settings', () => {
  it('returns false and leaves the caller’s sizes untouched', () => {
    // Upstream's `if( !m_board )` early-out.
    const { ok, sizes } = imported(null);

    expect(ok).toBe(false);
    expect(sizes).toEqual(DEFAULT_ROUTER_SIZES);
  });
});

describe('the track width', () => {
  it('is the board minimum when the netclass is smaller', () => {
    // `trackWidth = std::max( trackWidth, bds.GetCurrentTrackWidth() )` with
    // `trackWidth` seeded from `m_TrackMinWidth`.
    const ds = designSettings({
      trackMinWidth: MM(0.4),
      sizes: sizesModel(),
    });

    expect(imported(ds).sizes.trackWidth).toBe(MM(0.4));
  });

  it('is the netclass when it is larger than the minimum', () => {
    expect(imported(designSettings()).sizes.trackWidth).toBe(MM(0.25));
  });

  it('is the chosen preset', () => {
    const sizes = sizesModel();
    const ds = designSettings({
      sizes: { ...sizes, selection: { ...sizes.selection, trackWidthIndex: 2 } },
    });

    expect(imported(ds).sizes.trackWidth).toBe(MM(0.5));
  });

  it('reports the board minimum alongside it', () => {
    expect(imported(designSettings()).sizes.boardMinTrackWidth).toBe(MM(0.2));
  });

  it('is explicit unless the width is being inherited', () => {
    // `SetTrackWidthIsExplicit( !m_UseConnectedTrackWidth || m_TempOverrideTrackWidth )`.
    expect(imported(designSettings()).sizes.trackWidthIsExplicit).toBe(true);
    expect(
      imported(designSettings({ useConnectedTrackWidth: true })).sizes.trackWidthIsExplicit,
    ).toBe(false);
    expect(
      imported(designSettings({ useConnectedTrackWidth: true, tempOverrideTrackWidth: true })).sizes
        .trackWidthIsExplicit,
    ).toBe(true);
  });
});

describe('the via', () => {
  it('takes the netclass diameter and drill at index 0', () => {
    const { sizes } = imported(designSettings());

    expect([sizes.viaDiameter, sizes.viaDrill]).toEqual([MM(0.8), MM(0.4)]);
  });

  it('takes a preset SMALLER than the board minimum, unlike the track width', () => {
    // Upstream assigns `bds.GetCurrentViaSize()` here rather than taking a
    // `std::max` against `m_ViasMinSize`. Reaching the router under-size is
    // deliberate: DRC is what reports it.
    const model = sizesModel();
    const ds = designSettings({
      viasMinSize: MM(2),
      minThroughDrill: MM(1),
      sizes: { ...model, selection: { ...model.selection, viaSizeIndex: 1 } },
    });

    expect(imported(ds).sizes.viaDiameter).toBe(MM(0.6));
    expect(imported(ds).sizes.viaDrill).toBe(MM(0.3));
  });
});

describe('the differential pair', () => {
  it('takes the netclass fallbacks at index 0', () => {
    // No pair dimensions on the netclass, so width -> track width and gap ->
    // clearance, and the via gap follows the resolved gap.
    const { sizes } = imported(designSettings());

    expect([sizes.diffPairWidth, sizes.diffPairGap, sizes.diffPairViaGap]).toEqual([
      MM(0.25),
      MM(0.2),
      MM(0.2),
    ]);
  });

  it('takes the chosen row', () => {
    const model = sizesModel();
    const ds = designSettings({
      sizes: { ...model, selection: { ...model.selection, diffPairIndex: 1 } },
    });
    const { sizes } = imported(ds);

    expect([sizes.diffPairWidth, sizes.diffPairGap, sizes.diffPairViaGap]).toEqual([
      MM(0.2),
      MM(0.25),
      MM(0.5),
    ]);
  });

  it('never claims the via gap is the trace gap', () => {
    // `SetDiffPairViaGapSameAsTraceGap( false )` — unconditional, because
    // ImportSizes has just supplied a real via gap.
    expect(imported(designSettings()).sizes.diffPairViaGapSameAsTraceGap).toBe(false);
  });

  it('seeds the hole-to-hole from the board minimum', () => {
    expect(imported(designSettings()).sizes.diffPairHoleToHole).toBe(MM(0.25));
  });
});

describe('inheriting the width from the track the route starts on', () => {
  const startItem = (): PnsSegment => {
    const seg = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: MM(10), y: 0 } }, null);
    seg.setLayer(0);
    return seg;
  };

  const withStart = (ds: PnsDesignSettings): PnsRouterSizes => {
    const iface = new PnsBoardIface(BOARD, { designSettings: ds });
    const sizes: PnsRouterSizes = { ...DEFAULT_ROUTER_SIZES };
    iface.importSizes(sizes, startItem(), null, { x: 0, y: 0 });
    return sizes;
  };

  it('uses the existing width when the toggle is on', () => {
    const sizes = withStart(
      designSettings({
        useConnectedTrackWidth: true,
        inheritTrackWidth: () => MM(0.75),
      }),
    );

    expect(sizes.trackWidth).toBe(MM(0.75));
  });

  it('ignores it while the width is being temporarily overridden', () => {
    // `m_UseConnectedTrackWidth && !m_TempOverrideTrackWidth` — cycling the
    // width mid-route sets the override, and the user's choice wins from then on.
    const sizes = withStart(
      designSettings({
        useConnectedTrackWidth: true,
        tempOverrideTrackWidth: true,
        inheritTrackWidth: () => MM(0.75),
      }),
    );

    expect(sizes.trackWidth).toBe(MM(0.25));
  });

  it('still inherits the DIFF PAIR width under that override', () => {
    // The diff-pair branch tests `m_UseConnectedTrackWidth && aStartItem` only.
    // Upstream does not consult `m_TempOverrideTrackWidth` there, and this is
    // the case that tells the two branches apart.
    const sizes = withStart(
      designSettings({
        useConnectedTrackWidth: true,
        tempOverrideTrackWidth: true,
        inheritTrackWidth: () => MM(0.75),
      }),
    );

    expect(sizes.diffPairWidth).toBe(MM(0.75));
  });

  it('falls through to the netclass when the start item carries no width', () => {
    const sizes = withStart(
      designSettings({ useConnectedTrackWidth: true, inheritTrackWidth: () => null }),
    );

    expect(sizes.trackWidth).toBe(MM(0.25));
  });
});
