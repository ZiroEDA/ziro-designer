// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** BOARD_DESIGN_SETTINGS as the project file's `board.design_settings`. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import type { JsonObject } from '@ziroeda/common/settings/json_settings.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  BOARD_DESIGN_SETTINGS,
  TEXT_ITEM_INFO,
  VIA_DIMENSION,
} from '@ziroeda/pcbnew/board_design_settings.js';
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';

// A project KiCad 10 wrote (schema 2, 66 severities, every defaults.zones key).
const PRO = '/home/akshay/kicad-reference/qa/data/pcbnew/diff_pair_uncoupled_tuning_drc.kicad_pro';

function proJson(): JsonObject {
  return JSON.parse(readFileSync(PRO, 'utf8')) as JsonObject;
}

describe('BOARD_DESIGN_SETTINGS as a NESTED_SETTINGS', () => {
  it('round-trips the whole board.design_settings block of a KiCad-written project', () => {
    const src = proJson();
    const m = new SETTINGS_MANAGER();
    m.LoadProject(PRO, src);
    const b = new BOARD();
    b.SetProject(m.Prj());

    // the file's values are the board's
    const bds = b.GetDesignSettings();
    const rules = (src.board as JsonObject).design_settings as JsonObject;
    expect(bds.m_MinClearance).toBe(((rules.rules as JsonObject).min_clearance as number) * 1e6);
    expect(bds.GetDefaultZoneSettings().m_ZoneClearance).toBe(
      (((rules.defaults as JsonObject).zones as JsonObject).min_clearance as number) * 1e6,
    );

    // Against a fresh read: the store must not have rewritten the tree it was given.
    const out = m.SaveProject()!.pro;
    const expected = (proJson().board as JsonObject).design_settings as JsonObject;

    // The fixture was written by a KiCad newer than 10.0.5. Four severity keys
    // it carries are not in 10.0.5's `DRC_ITEM::allItemTypes` (drc_item.cpp:320):
    // `net_chain_*` do not exist there, and `via_diameter` / `assertion_failure`
    // are declared but not listed - so a 10.0.5 save drops them, as ours does.
    for (const k of [
      'assertion_failure',
      'net_chain_return_path',
      'net_chain_stub_length',
      'via_diameter',
    ])
      delete (expected.rule_severities as JsonObject)[k];

    expect((out.board as JsonObject).design_settings).toEqual(expected);
    expect(src).toEqual(proJson());
  });

  it('a key the file lacks leaves the value the board parser set (m_resetParamsIfMissing off)', () => {
    const b = new BOARD();
    b.GetDesignSettings().m_MinClearance = 123;
    b.GetDesignSettings().m_HoleClearance = 456;
    const m = new SETTINGS_MANAGER();
    m.LoadProject('/p/x.kicad_pro', {
      board: { design_settings: { rules: { min_clearance: 0.2 } } },
    });
    b.SetProject(m.Prj());
    expect(b.GetDesignSettings().m_MinClearance).toBe(200_000);
    expect(b.GetDesignSettings().m_HoleClearance).toBe(456);
  });

  it('migrates a schema-1 block: mask/paste margins move to the board and leave the file', () => {
    const b = new BOARD();
    const m = new SETTINGS_MANAGER();
    m.LoadProject('/p/x.kicad_pro', {
      board: {
        design_settings: {
          meta: { version: 0 },
          defaults: { dimension_units: 2, dimension_precision: 1 },
          rules: { solder_mask_clearance: 0.05, solder_paste_margin_ratio: -0.1 },
        },
      },
    });
    b.SetProject(m.Prj());
    const bds = b.GetDesignSettings();
    expect(bds.m_SolderMaskExpansion).toBe(50_000);
    expect(bds.m_SolderPasteMarginRatio).toBe(-0.1);
    // 0 -> 1: mm units add two digits to the old precision enum
    expect(bds.m_DimensionPrecision).toBe(3);
    const rules = ((m.SaveProject()!.pro.board as JsonObject).design_settings as JsonObject)
      .rules as JsonObject;
    expect('solder_mask_clearance' in rules).toBe(false);
    expect(((m.SaveProject()!.pro.board as JsonObject).design_settings as JsonObject).meta).toEqual(
      { version: 2 },
    );
  });

  it('tuning_pattern_settings: each of the three blocks reads all six fields', () => {
    const b = new BOARD();
    const m = new SETTINGS_MANAGER();
    m.LoadProject('/p/x.kicad_pro', {
      board: {
        design_settings: {
          tuning_pattern_settings: {
            diff_pair_skew_defaults: {
              min_amplitude: 0.3,
              max_amplitude: 2.5,
              spacing: 0.7,
              corner_style: 0,
              corner_radius_percentage: 40,
              single_sided: true,
            },
          },
        },
      },
    });
    b.SetProject(m.Prj());
    const s = b.GetDesignSettings().m_SkewMeanderSettings;
    expect(s.minAmplitude).toBe(300_000);
    expect(s.maxAmplitude).toBe(2_500_000);
    expect(s.spacing).toBe(700_000);
    expect(s.cornerStyle).toBe(2); // MEANDER_STYLE_CHAMFER
    expect(s.cornerRadiusPercentage).toBe(40);
    expect(s.singleSided).toBe(true);
    // the other two keep the constructor's spacing
    expect(b.GetDesignSettings().m_SingleTrackMeanderSettings.spacing).toBe(600_000);
    expect(b.GetDesignSettings().m_DiffPairMeanderSettings.spacing).toBe(1_000_000);
  });
});

describe('BOARD_DESIGN_SETTINGS copy and equality (initFromOther / operator= / operator==)', () => {
  it('a copy is equal, and a change to any one member on either side is seen', () => {
    const b = new BOARD();
    b.SetCopperLayerCount(4);
    const a = b.GetDesignSettings();
    a.m_TrackWidthList = [0, 250_000, 500_000];
    a.m_DRCSeverities.set(7, 3 as never);
    a.m_DrcExclusions.add('x');
    a.m_UserLayerNames.set('User.1', 'Notes');
    a.m_DefaultFPTextItems = [new TEXT_ITEM_INFO('REF**', true, PCB_LAYER_ID.F_SilkS)];
    a.m_CurrentViaType = VIATYPE.MICROVIA;
    // A fresh board describes no stackup; give it the default one so the
    // stackup branch has something to compare.
    a.GetStackupDescriptor().BuildDefaultStackupList(a, 4);

    const c = BOARD_DESIGN_SETTINGS.copyOf(a);
    expect(c.equals(a)).toBe(true);
    expect(a.equals(c)).toBe(true);
    expect(c).not.toBe(a);

    // Each of these is a different branch of operator==.
    const flips: ((d: BOARD_DESIGN_SETTINGS) => void)[] = [
      (d) => d.m_TrackWidthList.push(1),
      (d) => d.m_ViasDimensionsList.push(new VIA_DIMENSION(1, 1)),
      (d) => (d.m_CurrentViaType = VIATYPE.THROUGH),
      (d) => (d.m_MinClearance += 1),
      (d) => d.m_DRCSeverities.set(7, 1 as never),
      (d) => d.m_DrcExclusions.delete('x'),
      (d) => (d.m_TentViasBack = !d.m_TentViasBack),
      (d) => (d.m_DefaultFPTextItems[0]!.m_Visible = false),
      (d) => d.m_UserLayerNames.set('User.1', 'Other'),
      (d) => (d.m_LineThickness[2] = (d.m_LineThickness[2] ?? 0) + 1),
      (d) => (d.m_TextSize[1]!.y += 1),
      (d) => (d.m_TextItalic[0] = !d.m_TextItalic[0]),
      (d) => (d.m_DimensionPrecision += 1),
      (d) => d.SetAuxOrigin({ x: 5, y: 0 }),
      (d) => (d.m_UseHeightForLengthCalcs = !d.m_UseHeightForLengthCalcs),
      (d) => d.SetCustomTrackWidth(d.GetCustomTrackWidth() + 1),
      (d) => d.SetCustomDiffPairGap(d.GetCustomDiffPairGap() + 1),
      (d) => d.SetCopperLayerCount(6),
      (d) => d.SetBoardThickness(d.GetBoardThickness() + 1),
      (d) => (d.m_StyleFPBarcodes = !d.m_StyleFPBarcodes),
      // (an emptied copy would still read equal from ITS side: std::equal walks
      // the first range only, so change an item rather than the count)
      (d) => d.GetStackupDescriptor().GetList()[0]!.SetThickness(1),
      (d) => (d.GetDefaultZoneSettings().m_ZoneClearance = 999),
    ];

    for (const [i, flip] of flips.entries()) {
      const d = BOARD_DESIGN_SETTINGS.copyOf(a);
      flip(d);
      expect(d.equals(a), `flip ${i} must make the copy unequal`).toBe(false);
      expect(a.equals(d), `flip ${i} must be seen from either side`).toBe(false);
    }
  });

  it('the copy is deep for the value members and shared for NET_SETTINGS, as shared_ptr is', () => {
    const a = new BOARD().GetDesignSettings();
    a.GetStackupDescriptor().BuildDefaultStackupList(a, 2);
    const c = BOARD_DESIGN_SETTINGS.copyOf(a);

    // Value members: a later edit of the copy leaves the original alone.
    c.m_TrackWidthList.push(1);
    c.m_DRCSeverities.set(99, 1 as never);
    c.GetStackupDescriptor().RemoveAll();
    c.m_TextSize[0]!.x = 12345;
    expect(a.m_TrackWidthList).not.toContain(1);
    expect(a.m_DRCSeverities.has(99)).toBe(false);
    expect(a.GetStackupDescriptor().GetCount()).toBeGreaterThan(0);
    expect(a.m_TextSize[0]!.x).not.toBe(12345);
    expect(c.m_Pad_Master).not.toBe(a.m_Pad_Master);

    // `m_NetSettings = aOther.m_NetSettings` copies the shared_ptr: the same object.
    expect(c.m_NetSettings).toBe(a.m_NetSettings);
  });

  it('assign() is operator=: it overwrites in place and keeps the object identity', () => {
    const a = new BOARD().GetDesignSettings();
    a.m_MinClearance = 4242;
    const b = new BOARD().GetDesignSettings();
    const same = b.assign(a);
    expect(same).toBe(b);
    expect(b.m_MinClearance).toBe(4242);
    expect(b.equals(a)).toBe(true);
  });
});
