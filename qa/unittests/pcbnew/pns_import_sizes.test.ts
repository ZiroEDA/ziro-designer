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
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { buildDrcRuleEngine } from '@ziroeda/pcbnew/src/drc/drc_rules_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import {
  defaultTrackViaSizeState,
  withNetclassEntry,
  type TrackViaSizes,
} from '@ziroeda/pcbnew/src/board_design_settings_sizes.js';
import type { PnsDesignSettings } from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import type { PnsRouterSizes } from '@ziroeda/pcbnew/src/router/pns_router.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

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

describe('where each number came from', () => {
  /**
   * The four `Set…Source` strings. `ROUTER_TOOL`'s status bar is the only
   * reader, and it is the only place a user can find out WHY their track is
   * the width it is — by the time the number reaches the placer, the branch
   * that produced it is gone.
   */
  it('names the netclass when the toolbar is on "use netclass"', () => {
    const { sizes } = imported(designSettings());

    expect(sizes.clearanceSource).toBe('board minimum clearance');
    expect(sizes.widthSource).toBe("netclass 'Default'");
    expect(sizes.diffPairWidthSource).toBe('user choice');
    expect(sizes.diffPairGapSource).toBe('user choice');
  });

  it('names the user when a preset is chosen', () => {
    // `else if( trackWidth == bds.GetCurrentTrackWidth() ) … "user choice"`.
    const model = sizesModel();
    const ds = designSettings({
      sizes: { ...model, selection: { ...model.selection, trackWidthIndex: 2 } },
    });

    expect(imported(ds).sizes.widthSource).toBe('user choice');
  });

  it('leaves the board minimum named when the preset lost the max', () => {
    // The `if( trackWidth == … )` guard: a preset UNDER the board minimum does
    // not get the credit for a width it did not produce.
    const model = sizesModel();
    const ds = designSettings({
      trackMinWidth: MM(1),
      sizes: { ...model, selection: { ...model.selection, trackWidthIndex: 1 } },
    });

    expect(imported(ds).sizes.trackWidth).toBe(MM(1));
    expect(imported(ds).sizes.widthSource).toBe('board minimum track width');
  });

  it('names the starting track when the width is inherited', () => {
    const iface = new PnsBoardIface(BOARD, {
      designSettings: designSettings({
        useConnectedTrackWidth: true,
        inheritTrackWidth: () => MM(0.75),
      }),
    });
    const seg = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: MM(10), y: 0 } }, null);
    seg.setLayer(0);

    const sizes: PnsRouterSizes = { ...DEFAULT_ROUTER_SIZES };
    iface.importSizes(sizes, seg, null, { x: 0, y: 0 });

    expect(sizes.widthSource).toBe('existing track');
  });

  it('reports the clearance and the single-via hole-to-hole as well', () => {
    // `SetClearance( bds.m_MinClearance )` and `SetHoleToHole( holeToHoleMin )`
    // — separate from `minClearance` and `diffPairHoleToHole`, which are the
    // floors those two start from.
    const { sizes } = imported(designSettings());

    expect(sizes.clearance).toBe(MM(0.15));
    expect(sizes.holeToHole).toBe(MM(0.25));
  });
});

describe('the branches that need the rule engine', () => {
  /**
   * `ImportSizes`'s netclass arms all go through
   * `m_ruleResolver->QueryConstraint`, and the resolver only exists after
   * `SyncWorld` — which is the order the tool uses and the reason every case
   * above missed these arms entirely. A mutant that handed a losing rule the
   * credit for the width survived on that alone.
   */
  const synced = (dru: string, ds: PnsDesignSettings): PnsRouterSizes => {
    const iface = new PnsBoardIface(BOARD, {
      designSettings: ds,
      ruleEngine: buildDrcRuleEngine([], parseDrcRules(dru)),
    });
    // `ROUTER::SyncWorld` — what builds the rule resolver.
    const node = new PnsNode();
    node.beginBulkAdd();
    iface.syncWorld(node);
    node.finalizeBulkAdd();

    const seg = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: MM(10), y: 0 } }, null);
    seg.setLayer(0);

    const sizes: PnsRouterSizes = { ...DEFAULT_ROUTER_SIZES };
    iface.importSizes(sizes, seg, null, { x: 0, y: 0 });
    return sizes;
  };

  it('takes a rule’s optimal width and names the rule', () => {
    const sizes = synced(
      '(version 1)(rule wide (constraint track_width (min 0.3mm) (opt 0.6mm)))',
      designSettings(),
    );

    expect(sizes.trackWidth).toBe(MM(0.6));
    expect(sizes.widthSource).toBe('wide');
  });

  it('does NOT name a rule whose optimum lost to the board minimum', () => {
    // `trackWidth = std::max( trackWidth, opt ); if( trackWidth == opt ) …`
    // A rule asking for less than the board allows does not get the credit for
    // a width it did not produce.
    const sizes = synced(
      '(version 1)(rule narrow (constraint track_width (min 0.05mm) (opt 0.1mm)))',
      designSettings({ trackMinWidth: MM(0.4) }),
    );

    expect(sizes.trackWidth).toBe(MM(0.4));
    expect(sizes.widthSource).toBe('board minimum track width');
  });

  it('takes a diff-pair gap rule and names it for the gap and the via gap', () => {
    const sizes = synced(
      '(version 1)(rule dp (constraint diff_pair_gap (min 0.2mm) (opt 0.35mm)))',
      designSettings(),
    );

    expect(sizes.diffPairGap).toBe(MM(0.35));
    expect(sizes.diffPairViaGap).toBe(MM(0.35));
    expect(sizes.diffPairGapSource).toBe('dp');
  });

  it('does NOT name a gap rule whose optimum lost to the board minimum', () => {
    // The same `if( diffPairGap == constraint.m_Value.Opt() )` guard as the
    // width has. Without a LOSING rule the guard is never exercised, and a
    // version that names the rule unconditionally reads identically.
    const sizes = synced(
      '(version 1)(rule tight (constraint diff_pair_gap (min 0.05mm) (opt 0.08mm)))',
      designSettings({ minClearance: MM(0.3) }),
    );

    expect(sizes.diffPairGap).toBe(MM(0.3));
    expect(sizes.diffPairGapSource).toBe('board minimum clearance');
  });

  it('leaves the board minimum named when no rule matches', () => {
    const sizes = synced('(version 1)', designSettings());

    expect(sizes.widthSource).toBe("netclass 'Default'");
    expect(sizes.diffPairGapSource).toBe('board minimum clearance');
  });
});
