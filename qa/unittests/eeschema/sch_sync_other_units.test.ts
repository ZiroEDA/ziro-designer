// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_SYMBOL::SyncOtherUnits (sch_symbol.cpp:1481): an edit to one unit of an annotated
 * multi-unit symbol reaches its other units - all of the synced state, or only the property
 * named.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { TYPE_HASH } from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/properties/property_mgr.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const schematic = h.frame.Schematic();
  const all = schematic.Hierarchy().flatMap((p) =>
    ([...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).map((s) => ({
      s,
      p,
    })),
  );
  const multi = all.filter(({ s }) => s.GetUnitCount() > 1);
  const { s: unit, p: path } = multi[0]!;
  const ref = unit.GetRef(path);
  const others = multi.filter(({ s, p }) => s !== unit && s.GetRef(p) === ref).map(({ s }) => s);
  schematic.SetCurrentSheet(path);
  return { h, unit, path, others, commit: new SCH_COMMIT(h.frame) };
}

describe('SCH_SYMBOL::SyncOtherUnits', () => {
  it('a named property syncs only that property', () => {
    const { unit, path, others, commit } = setUp();
    expect(others.length).toBeGreaterThan(0);
    const value = PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_SYMBOL), 'Value')!;

    unit.SetValueProp('LM-SYNC');
    unit.SetExcludedFromBOM(true, path);
    unit.SyncOtherUnits(path, commit, value);

    for (const other of others) {
      expect(other.GetField(FIELD_T.VALUE)!.GetText()).toBe('LM-SYNC');
      expect(other.GetExcludedFromBOM(path)).toBe(false);
    }
  });

  it('a property that is not synced changes nothing', () => {
    const { unit, path, others, commit } = setUp();
    const mirror = PROPERTY_MANAGER.Instance().GetProperty(TYPE_HASH(SCH_SYMBOL), 'Mirror X')!;
    const before = others.map((o) => o.GetField(FIELD_T.VALUE)!.GetText());

    unit.SetValueProp('LM-NOT');
    unit.SyncOtherUnits(path, commit, mirror);

    expect(others.map((o) => o.GetField(FIELD_T.VALUE)!.GetText())).toEqual(before);
  });

  it('no property syncs the value, the flags and the user fields - added where missing, removed where gone', () => {
    const { unit, path, others, commit } = setUp();
    const stale = new SCH_FIELD(others[0]!, FIELD_T.USER, 'Stale');
    stale.SetText('x');
    others[0]!.AddField(stale);

    const added = new SCH_FIELD(unit, FIELD_T.USER, 'Supplier');
    added.SetText('ACME');
    unit.AddField(added);
    unit.SetValueProp('LM-ALL');
    unit.SetDNP(true, path);
    unit.SyncOtherUnits(path, commit, null);

    for (const other of others) {
      expect(other.GetField(FIELD_T.VALUE)!.GetText()).toBe('LM-ALL');
      expect(other.GetDNP(path)).toBe(true);
      const copy = other.GetField('Supplier')!;
      expect(copy.GetText()).toBe('ACME');
      expect(copy.m_Uuid).not.toEqual(added.m_Uuid);
      expect(copy.GetParent()).toBe(other);
      // Offset from this unit's origin to the other's.
      expect(copy.GetPosition()).toEqual({
        x: added.GetPosition().x - unit.GetPosition().x + other.GetPosition().x,
        y: added.GetPosition().y - unit.GetPosition().y + other.GetPosition().y,
      });
      expect(other.GetField('Stale')).toBe(null);
    }
  });

  it('a single-unit symbol is left alone', () => {
    const { h, path, commit } = setUp();
    const single = (
      [...path.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]
    ).find((s) => s.GetUnitCount() === 1)!;
    single.SyncOtherUnits(path, commit, null);
    expect(commit.Empty()).toBe(true);
    expect(h.frame).toBeTruthy();
  });
});
