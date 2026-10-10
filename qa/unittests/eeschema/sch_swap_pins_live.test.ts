// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_TOOL::SwapPins (`eeschema/tools/sch_edit_tool.cpp:1765-1900`) on a live schematic.
 *
 * `allow_unconstrained_pin_swaps` is tested at the top of the handler as well as on the menu
 * entry (`:1769-1770`), so a hotkey cannot get past it either; a symbol whose sheet is used more
 * than once refuses with the infobar rather than swapping every instance at once.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  EESCHEMA_DEFAULTS,
  type EeschemaSettings,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import type { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import type { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  SetPgm(null);
  setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS);
});

function allowSwaps(aAllow: boolean): void {
  const settings: EeschemaSettings = {
    ...EESCHEMA_DEFAULTS,
    input: { ...EESCHEMA_DEFAULTS.input, allow_unconstrained_pin_swaps: aAllow },
  };
  setEeschemaSettingsProvider(() => settings);
}

/** The frame on `aSheet` (the root, or a sub-sheet instance), and its first two-pin symbol. */
function setUp(aSheet: (aPaths: SCH_SHEET_PATH[]) => SCH_SHEET_PATH) {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(aSheet(h.frame.Schematic().Hierarchy()));
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const select = (...items: EDA_ITEM[]) => {
    sel.ClearSelection(true);
    for (const i of items) sel.AddItemToSel(i, true);
  };
  const sym = ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).find(
    (s) => !s.GetLibSymbolRef()?.IsPower() && s.GetPins().length >= 2,
  )!;
  const [a, b] = sym.GetPins() as SCH_PIN[];
  return { h, mgr, select, a: a!, b: b! };
}

const root = (aPaths: SCH_SHEET_PATH[]) => aPaths.find((p) => p.size() === 1)!;
const sub = (aPaths: SCH_SHEET_PATH[]) => aPaths.find((p) => p.size() === 2)!;
const where = (aPin: SCH_PIN) => ({ ...aPin.GetPosition() });

describe('SCH_EDIT_TOOL::SwapPins', () => {
  it('swaps two pins of one symbol when the preference allows it', () => {
    allowSwaps(true);
    const { mgr, select, a, b } = setUp(root);
    const [pa, pb] = [where(a), where(b)];
    expect(pa).not.toEqual(pb);

    select(a, b);
    mgr.RunAction(SCH_ACTIONS.swapPins);

    expect([where(a), where(b)]).toEqual([pb, pa]);
  });

  it('does nothing when the preference is off, whatever ran the action', () => {
    allowSwaps(false);
    const { mgr, select, a, b } = setUp(root);
    const [pa, pb] = [where(a), where(b)];

    select(a, b);
    mgr.RunAction(SCH_ACTIONS.swapPins);

    expect([where(a), where(b)]).toEqual([pa, pb]);
  });

  it('refuses on a sheet used twice, naming the instances in the infobar', () => {
    allowSwaps(true);
    const { h, mgr, select, a, b } = setUp(sub);
    const info = vi.spyOn(h.frame, 'ShowInfoBarError');
    const [pa, pb] = [where(a), where(b)];

    select(a, b);
    mgr.RunAction(SCH_ACTIONS.swapPins);

    expect([where(a), where(b)]).toEqual([pa, pb]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatch(
      /^Pin swaps are disabled for symbols used by multiple sheet instances \(.+\)\. /,
    );
  });
});
