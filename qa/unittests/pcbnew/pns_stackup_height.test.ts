// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS_KICAD_IFACE_BASE::StackupHeight` (`pns_kicad_iface.cpp:1305-1314`):
 * Board Setup > Constraints' "Include stackup height in track length
 * calculations", read off the live `BOARD_DESIGN_SETTINGS` and answered by
 * `BOARD_STACKUP::GetLayerDistance` on the live stackup. Without it a
 * length-tuned pair on a four-layer board is short by the thickness of the
 * board once per via. `GetLayerDistance`'s own walk (half an internal copper,
 * silk and mask skipped, either order) is pinned in `board_support_classes`.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { PnsBoardIface } from '@ziroeda/pcbnew/router/pns_board_iface.js';
import {
  BOARD_DESIGN_SETTINGS,
  DIFF_PAIR_DIMENSION,
  VIA_DIMENSION,
} from '@ziroeda/pcbnew/board_design_settings.js';
import type { BOARD_STACKUP } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import type { PnsDesignSettings } from '@ziroeda/pcbnew/router/pns_board_iface.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

const MM = (n: number): number => mmToIU(n);
const { F_Cu, In1_Cu, In2_Cu, B_Cu } = PCB_LAYER_ID;

/** The default four-layer stackup: 0.035 mm coppers, three 0.48 mm dielectrics. */
function fourLayer(): BOARD_STACKUP {
  const bds = new BOARD_DESIGN_SETTINGS();
  bds.SetCopperLayerCount(4);
  const stackup = bds.GetStackupDescriptor();
  stackup.RemoveAll();
  stackup.BuildDefaultStackupList(bds, 4);
  return stackup;
}

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
    sizes: (() => {
      const bds = new BOARD_DESIGN_SETTINGS();
      bds.m_TrackWidthList = [0];
      bds.m_ViasDimensionsList = [new VIA_DIMENSION(0, 0)];
      bds.m_DiffPairDimensionsList = [new DIFF_PAIR_DIMENSION(0, 0, 0)];
      const nc = bds.m_NetSettings.GetDefaultNetclass();
      nc.SetTrackWidth(MM(0.25));
      nc.SetClearance(MM(0.2));
      nc.SetViaDiameter(MM(0.8));
      nc.SetViaDrill(MM(0.4));
      return bds;
    })(),
    ...over,
  };
}

/** Two board layers as PNS layer numbers, through the interface's own mapping. */
function heightOf(ds: PnsDesignSettings | null, a = 'F.Cu', b = 'B.Cu'): number {
  const iface = new PnsBoardIface(BOARD, ds ? { designSettings: ds } : {});
  return iface.stackupHeight(
    iface.getPnsLayerFromBoardLayer(a),
    iface.getPnsLayerFromBoardLayer(b),
  );
}

describe('PnsBoardIface.stackupHeight', () => {
  it('is GetLayerDistance on the live stackup when the setting is on', () => {
    const stackup = fourLayer();
    const ds = designSettings({ useHeightForLengthCalcs: true, stackup });
    expect(heightOf(ds)).toBe(stackup.GetLayerDistance(F_Cu, B_Cu));
    expect(heightOf(ds)).toBe(MM(0.035 * 4 + 0.48 * 3));
    // An internal end counts half its copper: the via stops inside it.
    expect(heightOf(ds, 'In1.Cu', 'In2.Cu')).toBe(stackup.GetLayerDistance(In1_Cu, In2_Cu));
    expect(heightOf(ds, 'In1.Cu', 'In2.Cu')).toBe(Math.trunc(MM(0.035) / 2) * 2 + MM(0.48));
    // Either order.
    expect(heightOf(ds, 'B.Cu', 'In1.Cu')).toBe(heightOf(ds, 'In1.Cu', 'B.Cu'));
  });

  it('is zero when Constraints leaves the box unticked', () => {
    // `if( !m_board || !bds.m_UseHeightForLengthCalcs ) return 0` — the setting
    // doing its job.
    expect(heightOf(designSettings({ useHeightForLengthCalcs: false, stackup: fourLayer() }))).toBe(
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
