// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** BOARD_DESIGN_SETTINGS as the project file's `board.design_settings`. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTINGS_MANAGER } from '@ziroeda/common/src/pgm_base.js';
import type { JsonObject } from '@ziroeda/common/src/settings/json_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';

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
});
