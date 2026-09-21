// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `board_stackup_manager/stackup_predefined_prms.cpp` and
 * `dielectric_material.cpp`: the finish, colour and material tables, read
 * back out of the C++ source so a dropped or retyped row cannot pass.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_STACKUP_ITEM_TYPE } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import {
  DIELECTRIC_SUBSTRATE,
  DIELECTRIC_SUBSTRATE_LIST,
  DL_MATERIAL_LIST_TYPE,
} from '@ziroeda/pcbnew/board_stackup_manager/dielectric_material.js';
import {
  FAB_LAYER_COLOR,
  GetColorUserDefinedListIdx,
  GetStandardColors,
  GetStandardCopperFinishes,
  IsColorNameNormalized,
  IsCustomColorIdx,
} from '@ziroeda/pcbnew/board_stackup_manager/stackup_predefined_prms.js';

const REF = '/home/akshay/kicad-reference/pcbnew/board_stackup_manager/';
const cpp = (f: string): string => readFileSync(REF + f, 'utf8');

/** The rows of a `static … name[] = { … };` block, in order. */
const block = (src: string, name: string): string => {
  const i = src.indexOf(name);
  return src.slice(i, src.indexOf('};', i));
};

describe('the copper finishes', () => {
  it('are copperFinishType[] in order, "Not specified" first and "User defined" last', () => {
    const names = [
      ...block(cpp('stackup_predefined_prms.cpp'), 'copperFinishType[]').matchAll(
        /_HKI\( "([^"]+)" \)/g,
      ),
    ].map((m) => m[1]);
    expect(GetStandardCopperFinishes()).toEqual(['Not specified', ...names]);
    expect(GetStandardCopperFinishes().at(-1)).toBe('User defined');
  });
});

describe('the colour lists', () => {
  const rows = (name: string): [string, number, number, number][] =>
    [
      ...block(cpp('stackup_predefined_prms.cpp'), name).matchAll(
        /\{ (?:_HKI\( "([^"]+)" \)|NotSpecifiedPrm\(\)),\s+wxColor\(\s*(\d+),\s*(\d+),\s*(\d+)/g,
      ),
    ].map((m) => [m[1] ?? 'Not specified', Number(m[2]), Number(m[3]), Number(m[4])]);

  const ours = (t: BOARD_STACKUP_ITEM_TYPE): [string, number, number, number][] =>
    GetStandardColors(t).map((c) => {
      const col = c.GetColor(BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC);
      return [
        c.GetName(),
        Math.round(col.r * 255),
        Math.round(col.g * 255),
        Math.round(col.b * 255),
      ];
    });

  it('mask and silk share gbrjobColors; dielectrics have their own', () => {
    const gbr = rows('gbrjobColors');
    expect(gbr.length).toBe(9);
    expect(ours(BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK)).toEqual(gbr);
    expect(ours(BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN)).toEqual(gbr);
    const diel = rows('dielectricColors');
    expect(diel.length).toBe(7);
    expect(ours(BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC)).toEqual(diel);
    expect(GetStandardColors(BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER)).toEqual([]);
  });

  it('the user-defined entry is the last; a mask colour carries the 0.83 opacity', () => {
    const t = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK;
    expect(GetColorUserDefinedListIdx(t)).toBe(8);
    expect(IsCustomColorIdx(t, 8)).toBe(true);
    expect(IsCustomColorIdx(t, 7)).toBe(false);
    expect(GetStandardColors(t)[1]!.GetColor(t).a).toBeCloseTo(0.83, 9);
    expect(
      GetStandardColors(t)[1]!.GetColor(BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN).a,
    ).toBe(1);
  });

  it('GetColorAsString: a .gbrjob keyword as is, anything else as R<r>G<g>B<b>', () => {
    expect(new FAB_LAYER_COLOR('green', { r: 0, g: 1, b: 0, a: 1 }).GetColorAsString()).toBe(
      'green',
    );
    expect(IsColorNameNormalized('Purple')).toBe(false);
    expect(
      new FAB_LAYER_COLOR('Purple', { r: 80 / 255, g: 0, b: 80 / 255, a: 1 }).GetColorAsString(),
    ).toBe('R80G0B80');
  });
});

describe('the material lists', () => {
  const rows = (name: string): [string, number, number][] =>
    [
      ...block(cpp('dielectric_material.cpp'), name).matchAll(
        /\{ (?:wxT\( "([^"]+)" \)|NotSpecifiedPrm\(\)),\s+([\d.A-Z_]+),\s+([\d.]+)/g,
      ),
    ].map((m) => [
      m[1] ?? 'Not specified',
      m[2] === 'DEFAULT_EPSILON_R_SOLDERMASK'
        ? 3.3
        : m[2] === 'DEFAULT_EPSILON_R_SILKSCREEN'
          ? 1.0
          : Number(m[2]),
      Number(m[3]),
    ]);

  const ours = (t: DL_MATERIAL_LIST_TYPE): [string, number, number][] => {
    const l = new DIELECTRIC_SUBSTRATE_LIST(t);
    const out: [string, number, number][] = [];
    for (let i = 0; i < l.GetCount(); i++) {
      const s = l.GetSubstrateAt(i)!;
      out.push([s.m_Name, s.m_EpsilonR, s.m_LossTangent]);
    }
    return out;
  };

  it('are the three static tables, row for row', () => {
    expect(rows('substrateMaterial[]').length).toBe(10);
    expect(ours(DL_MATERIAL_LIST_TYPE.DL_MATERIAL_DIELECTRIC)).toEqual(rows('substrateMaterial[]'));
    expect(ours(DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SOLDERMASK)).toEqual(
      rows('solderMaskMaterial[]'),
    );
    expect(ours(DL_MATERIAL_LIST_TYPE.DL_MATERIAL_SILKSCREEN)).toEqual(
      rows('silkscreenMaterial[]'),
    );
  });

  it('finds by name case-insensitively, by parameters exactly, and never deletes index 0', () => {
    const l = new DIELECTRIC_SUBSTRATE_LIST(DL_MATERIAL_LIST_TYPE.DL_MATERIAL_DIELECTRIC);
    expect(l.GetSubstrate('fr4')?.m_EpsilonR).toBe(4.5);
    expect(l.FindSubstrate('FR4', 4.5, 0.02)).toBe(1);
    expect(l.FindSubstrate('FR4', 4.4, 0.02)).toBe(-1);
    expect(l.FindSubstrate(new DIELECTRIC_SUBSTRATE('ptfe', 2.1, 0.0002))).toBe(7);
    const idx = l.AppendSubstrate(new DIELECTRIC_SUBSTRATE('Rogers', 3.0, 0.001));
    expect(idx).toBe(10);
    l.DeleteSubstrate(0);
    expect(l.GetCount()).toBe(11);
    l.DeleteSubstrate(10);
    expect(l.GetCount()).toBe(10);
    expect(l.GetSubstrateAt(10)).toBeNull();
    expect(new DIELECTRIC_SUBSTRATE('x', 4.5, 0.0091).FormatLossTangent()).toBe('0.0091');
  });
});
