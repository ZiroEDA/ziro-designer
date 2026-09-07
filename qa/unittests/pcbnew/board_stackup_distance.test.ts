// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_STACKUP::GetLayerDistance` and the `StackupHeight` that reads it.
 *
 * Board Setup > Constraints' "Include stackup height in track length
 * calculations" reached nothing: `PnsBoardIface.stackupHeight()` returned 0
 * unconditionally, so a length-tuned pair on a four-layer board was short by
 * the thickness of the board once per via — and the checkbox did nothing
 * either way, which is the worse half.
 *
 * The walk has three details worth pinning, and each is a case below:
 * dielectrics are counted while silk and mask are skipped; an INTERNAL copper
 * endpoint contributes half its thickness because the via stops in the middle
 * of it; and the answer does not depend on which way round the two layers are
 * given.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { stackupLayerDistanceMM } from '@ziroeda/pcbnew/src/board_stackup_distance.js';
import { PnsBoardIface } from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import { defaultTrackViaSizeState } from '@ziroeda/pcbnew/src/board_design_settings_sizes.js';
import type { StackupDistanceItem } from '@ziroeda/pcbnew/src/board_stackup_distance.js';
import type { PnsDesignSettings } from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

/** A four-layer stack: 0.035 copper, 0.2 / 1.13 / 0.2 dielectric between. */
const FOUR_LAYER: StackupDistanceItem[] = [
  { layer: 'F.SilkS', type: 'Top Silk Screen', thicknessMM: 0.01 },
  { layer: 'F.Mask', type: 'Top Solder Mask', thicknessMM: 0.01 },
  { layer: 'F.Cu', type: 'copper', thicknessMM: 0.035 },
  { type: 'core', thicknessMM: 0.2 },
  { layer: 'In1.Cu', type: 'copper', thicknessMM: 0.035 },
  { type: 'core', thicknessMM: 1.13 },
  { layer: 'In2.Cu', type: 'copper', thicknessMM: 0.035 },
  { type: 'core', thicknessMM: 0.2 },
  { layer: 'B.Cu', type: 'copper', thicknessMM: 0.035 },
  { layer: 'B.Mask', type: 'Bottom Solder Mask', thicknessMM: 0.01 },
  { layer: 'B.SilkS', type: 'Bottom Silk Screen', thicknessMM: 0.01 },
];

const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 9);

describe('stackupLayerDistanceMM', () => {
  it('is zero between a layer and itself', () => {
    // `if( aFirstLayer == aSecondLayer ) return 0`.
    expect(stackupLayerDistanceMM(FOUR_LAYER, 'F.Cu', 'F.Cu')).toBe(0);
  });

  it('counts the dielectrics between two OUTER layers, and both coppers in full', () => {
    // F.Cu .035 + .2 + In1 .035 + 1.13 + In2 .035 + .2 + B.Cu .035
    near(stackupLayerDistanceMM(FOUR_LAYER, 'F.Cu', 'B.Cu'), 1.67);
  });

  it('skips silk and mask, which sit outside the copper stack', () => {
    // They are in the list and are never added: the walk starts at F.Cu.
    const withoutOuters = FOUR_LAYER.filter((i) => i.type.endsWith('copper') || !i.layer);
    near(
      stackupLayerDistanceMM(FOUR_LAYER, 'F.Cu', 'B.Cu'),
      stackupLayerDistanceMM(withoutOuters, 'F.Cu', 'B.Cu'),
    );
  });

  it('counts an INTERNAL endpoint at half, because the via stops inside it', () => {
    // F.Cu .035 + .2 + half of In1's .035 = 0.2525.
    near(stackupLayerDistanceMM(FOUR_LAYER, 'F.Cu', 'In1.Cu'), 0.2525);
  });

  it('halves BOTH endpoints when both are internal', () => {
    // half In1 .0175 + 1.13 + half In2 .0175 = 1.165.
    near(stackupLayerDistanceMM(FOUR_LAYER, 'In1.Cu', 'In2.Cu'), 1.165);
  });

  it('gives the same answer whichever way round the pair is given', () => {
    // The `std::swap` that puts them in stack order. B.Cu is the trap upstream:
    // its enum value is LOWER than every inner layer, so a numeric comparison
    // would put it first.
    for (const [a, b] of [
      ['F.Cu', 'B.Cu'],
      ['In1.Cu', 'B.Cu'],
      ['F.Cu', 'In2.Cu'],
    ] as const) {
      near(stackupLayerDistanceMM(FOUR_LAYER, a, b), stackupLayerDistanceMM(FOUR_LAYER, b, a));
    }
  });

  it('puts B.Cu last however the inner layers are numbered', () => {
    // In2 -> B.Cu is half In2 + .2 + B.Cu, and NOT the whole board.
    near(stackupLayerDistanceMM(FOUR_LAYER, 'In2.Cu', 'B.Cu'), 0.2525);
  });

  it('is zero for a layer that is not in the stack', () => {
    expect(stackupLayerDistanceMM(FOUR_LAYER, 'F.Cu', 'In7.Cu')).toBe(0);
  });
});

// ---------------------------------------------------------------------------

const BOARD: Board = {
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 1, name: 'In1.Cu', kind: 'signal' },
    { id: 2, name: 'In2.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
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
  source: { kind: 'list', items: [] },
};

function designSettings(over: Partial<PnsDesignSettings> = {}): PnsDesignSettings {
  return {
    minClearance: MM(0.2),
    trackMinWidth: MM(0.2),
    viasMinSize: MM(0.5),
    minThroughDrill: MM(0.3),
    holeToHoleMin: MM(0.25),
    useConnectedTrackWidth: false,
    tempOverrideTrackWidth: false,
    sizes: {
      trackWidthList: [0],
      viasDimensionsList: [{ diameter: 0, drill: 0 }],
      diffPairDimensionsList: [{ width: 0, gap: 0, viaGap: 0 }],
      defaultNetclass: {
        trackWidth: MM(0.25),
        clearance: MM(0.2),
        viaDiameter: MM(0.8),
        viaDrill: MM(0.4),
      },
      selection: defaultTrackViaSizeState(),
    },
    ...over,
  };
}

/** F.Cu and B.Cu as PNS layer numbers, through the interface's own mapping. */
function heightOf(ds: PnsDesignSettings | null): number {
  const iface = new PnsBoardIface(BOARD, ds ? { designSettings: ds } : {});
  return iface.stackupHeight(
    iface.getPnsLayerFromBoardLayer('F.Cu'),
    iface.getPnsLayerFromBoardLayer('B.Cu'),
  );
}

describe('PnsBoardIface.stackupHeight', () => {
  it('is the stackup distance in IU when the setting is on', () => {
    const h = heightOf(designSettings({ useHeightForLengthCalcs: true, stackup: FOUR_LAYER }));

    expect(h).toBe(MM(1.67));
  });

  it('is zero when Constraints leaves the box unticked', () => {
    // `if( !m_board || !bds.m_UseHeightForLengthCalcs ) return 0` — the setting
    // doing its job, which is what it could not do before.
    expect(heightOf(designSettings({ useHeightForLengthCalcs: false, stackup: FOUR_LAYER }))).toBe(
      0,
    );
  });

  it('is zero when no stackup describes the board', () => {
    expect(heightOf(designSettings({ useHeightForLengthCalcs: true }))).toBe(0);
  });

  it('is zero with no design settings at all', () => {
    expect(heightOf(null)).toBe(0);
  });
});
