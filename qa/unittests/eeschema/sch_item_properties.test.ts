// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_ITEM_DESC` (sch_item.cpp:844): the properties every schematic item has - Unit and Body
 * Style, offered only inside a multi-unit / multi-body-style symbol and hidden from the schematic
 * editor, and Private - over EDA_ITEM's.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { TYPE_HASH } from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/properties/property_mgr.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const prop = (aName: string) =>
  PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_ITEM), aName)!;

describe('SCH_ITEM_DESC', () => {
  it('registers Unit, Body Style and Private over the EDA_ITEM properties', () => {
    const names = PROPERTY_MANAGER.Instance()
      .GetProperties(TYPE_HASH(SCH_ITEM))
      .map((p) => p.Name());

    expect(names).toEqual(expect.arrayContaining(['Unit', 'Body Style', 'Private']));
    expect(prop('Unit').IsHiddenFromDesignEditors()).toBe(true);
    expect(prop('Body Style').IsHiddenFromDesignEditors()).toBe(true);
    expect(prop('Private').IsHiddenFromDesignEditors()).toBe(true);
    expect(names).not.toContain('Locked'); // #ifdef NOTYET upstream
  });

  it('offers Unit only inside a multi-unit symbol, with "All units" and each unit as choices', () => {
    const h = schToolHarness(schFrame({}));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const symbols = h.frame
      .Schematic()
      .Hierarchy()
      .flatMap((p) => [...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]);
    const dual = symbols.find((s) => s.GetUnitCount() === 2)!;
    const single = symbols.find((s) => s.GetUnitCount() === 1 && s.GetPins().length > 0)!;

    const dualPin = dual.GetPins()[0]!;
    const singlePin = single.GetPins()[0]!;

    expect(prop('Unit').Available(dualPin)).toBe(true);
    expect(prop('Unit').Available(singlePin)).toBe(false);
    expect(prop('Body Style').Available(singlePin)).toBe(false);

    const choices = prop('Unit').GetChoices(dualPin);
    const rows = Array.from({ length: choices.GetCount() }, (_, i) => [
      choices.GetLabel(i),
      choices.GetValue(i),
    ]);
    expect(rows).toEqual([
      ['All units', 0],
      ['A', 1],
      ['B', 2],
    ]);
  });
});
