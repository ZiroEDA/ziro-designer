// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PRINTOUT_SETTINGS (`common/printout.cpp`) and BOARD_PRINTOUT_SETTINGS
 * (`common/board_printout.cpp:36-64`): the defaults and the `printing.*`
 * round trip.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_PRINTOUT_SETTINGS } from '@ziroeda/common/board_printout.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';

const page = (): PAGE_INFO => new PAGE_INFO(PAGE_SIZE_TYPE.A4);

describe('BOARD_PRINTOUT_SETTINGS', () => {
  it('starts on every layer, unmirrored, 1:1, black and white, no sheet (printout.h:37-44)', () => {
    const s = new BOARD_PRINTOUT_SETTINGS(page());

    expect(s.m_LayerSet.count()).toBe(s.m_LayerSet.size());
    expect([s.m_Mirror, s.m_scale, s.m_blackWhite, s.m_titleBlock, s.m_background]).toEqual([
      false,
      1.0,
      true,
      false,
      false,
    ]);
    expect(s.m_pageCount).toBe(0);
  });

  it('round-trips through printing.*: layers by number, mirror, mode, sheet, scale', () => {
    const cfg = new APP_SETTINGS_BASE('test', 0);
    const out = new BOARD_PRINTOUT_SETTINGS(page());
    out.m_LayerSet.reset();
    out.m_LayerSet.set(3);
    out.m_LayerSet.set(40);
    out.m_Mirror = true;
    out.m_blackWhite = false;
    out.m_titleBlock = true;
    out.m_scale = 2.5;

    out.Save(cfg);
    expect(cfg.m_Printing.layers).toEqual([3, 40]);

    const back = new BOARD_PRINTOUT_SETTINGS(page());
    back.Load(cfg);

    expect(back.m_LayerSet.count()).toBe(2);
    expect([back.m_LayerSet.test(3), back.m_LayerSet.test(40)]).toEqual([true, true]);
    expect([back.m_Mirror, back.m_blackWhite, back.m_titleBlock, back.m_scale]).toEqual([
      true,
      false,
      true,
      2.5,
    ]);
  });

  it('Load replaces the layer set rather than adding to it', () => {
    const cfg = new APP_SETTINGS_BASE('test', 0);
    cfg.m_Printing.layers = [7];
    const s = new BOARD_PRINTOUT_SETTINGS(page());

    s.Load(cfg);

    expect(s.m_LayerSet.count()).toBe(1);
  });
});
