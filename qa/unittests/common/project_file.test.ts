// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PROJECT_FILE: the `.kicad_pro` in and out, its nested settings, and the
 * three custom params of board_project_settings_params.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { LAYER_PRESET } from '@ziroeda/common/src/project/board_project_settings.js';
import {
  CONDITION_TYPE,
  CONDITIONS_OPERATOR,
} from '@ziroeda/common/src/project/component_class_settings.js';
import { PROJECT_FILE } from '@ziroeda/common/src/project/project_file.js';
import type { JsonObject } from '@ziroeda/common/src/settings/json_settings.js';

const DEMO = new URL('../../../designer/public/demos/ecc83/', import.meta.url);

function ecc83(): JsonObject {
  return JSON.parse(readFileSync(new URL('ecc83-pp.kicad_pro', DEMO), 'utf8')) as JsonObject;
}

describe('PROJECT_FILE on a KiCad-written project', () => {
  it('loads the sheets, the libraries and the nested settings from the tree', () => {
    const f = new PROJECT_FILE('ecc83-pp');
    f.LoadFromJson(ecc83());

    expect(f.GetSheets()).toEqual([
      { first: '28f865a0-4433-4a53-bbd7-b62f276848e4', second: 'Root' },
    ]);
    expect(f.GetBoards()).toEqual([]);
    expect(f.m_PinnedSymbolLibs).toEqual([]);
    expect(f.IsFutureFormat()).toBe(false);

    // net_settings is a NESTED_SETTINGS loaded off the same tree
    const dflt = f.NetSettings().GetDefaultNetclass();
    expect(dflt.GetClearance()).toBe(400_000);
    expect(dflt.GetTrackWidth()).toBe(800_000);
    expect(dflt.GetWireWidth()).toBe(6 * 254); // 6 mils; schIUScale is 10000 IU/mm
  });

  it('SaveToJson keeps every key it does not own and re-emits the nested trees', () => {
    const f = new PROJECT_FILE('ecc83-pp');
    const src = ecc83();
    f.LoadFromJson(src);

    const out = f.SaveToJson();

    // Unknown keys ride through: `pcbnew.last_paths.gencad` is a legacy leftover.
    expect((out.pcbnew as JsonObject).last_paths).toMatchObject({ gencad: '' });
    expect(out.erc).toEqual(src.erc);
    expect(out.legacy).toEqual(src.legacy);

    // The nested tree is what NET_SETTINGS stores, not what was read.
    const ns = out.net_settings as JsonObject;
    const classes = ns.classes as JsonObject[];
    expect(classes[0]!.name).toBe('Default');
    expect(classes[0]!.clearance).toBe(0.4);
    expect(classes[0]!.pcb_color).toBe('rgba(0, 0, 0, 0.000)');
    expect(classes[0]!.wire_width).toBe(6);
    expect((ns.meta as JsonObject).version).toBe(5);
  });

  it('a text variable round-trips, and removing one drops it from the file', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({ text_variables: { REV: 'A', AUTHOR: 'x' } });
    expect([...f.m_TextVars]).toEqual([
      ['REV', 'A'],
      ['AUTHOR', 'x'],
    ]);

    f.m_TextVars.delete('AUTHOR');
    f.m_TextVars.set('REV', 'B');
    expect(f.SaveToJson().text_variables).toEqual({ REV: 'B' });
  });

  it('bus aliases: members trimmed, empties dropped, the first of a name wins', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({
      schematic: {
        bus_aliases: { ' A ': [' x ', '', 'y'], A: ['later'], B: 'not-a-list', '': ['z'] },
      },
    });
    // std::map::emplace: `' A '` trims to `A` first, so `A: ['later']` loses.
    expect([...f.m_BusAliases]).toEqual([['A', ['x', 'y']]]);
    expect((f.SaveToJson().schematic as JsonObject).bus_aliases).toEqual({ A: ['x', 'y'] });
  });

  it('last paths land in the indexed slots', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({ pcbnew: { last_paths: { step: 'out/a.step', plot: 'plots' } } });
    expect(f.m_PcbLastPath).toEqual(['', '', '', '', 'plots', 'out/a.step']);
  });

  it('meta.filename is the owning project name on save', () => {
    const f = new PROJECT_FILE('p');
    f.SetProject({ GetProjectName: () => 'demo' });
    expect((f.SaveToJson().meta as JsonObject).filename).toBe('demo.kicad_pro');
  });
});

describe('PARAM_LAYER_PRESET / PARAM_VIEWPORT / PARAM_LAYER_PAIRS', () => {
  it('a preset reads its layers as ints and its render layers as names', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({
      board: {
        layer_presets: [
          {
            name: 'Top',
            activeLayer: PCB_LAYER_ID.F_Cu,
            flipBoard: true,
            layers: [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.Edge_Cuts, 999],
            renderLayers: ['tracks', 'bogus', 'vias'],
          },
          { noName: true },
        ],
      },
    });

    expect(f.m_LayerPresets).toHaveLength(1);
    const p = f.m_LayerPresets[0]!;
    expect(p.name).toBe('Top');
    expect(p.flipBoard).toBe(true);
    expect(p.activeLayer).toBe(PCB_LAYER_ID.F_Cu);
    expect(p.layers.Seq()).toEqual([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.Edge_Cuts]);
    expect(p.renderLayers.Seq()).toEqual([GAL_LAYER_ID.LAYER_VIAS, GAL_LAYER_ID.LAYER_TRACKS]);

    const out = (f.SaveToJson().board as JsonObject).layer_presets as JsonObject[];
    expect(out[0]).toEqual({
      name: 'Top',
      activeLayer: PCB_LAYER_ID.F_Cu,
      flipBoard: true,
      layers: [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.Edge_Cuts],
      renderLayers: ['vias', 'tracks'],
    });
  });

  it('a preset owns its layer set: reading one does not touch LSET::AllLayersMask()', () => {
    const before = LSET.AllLayersMask().count();
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({ board: { layer_presets: [{ name: 'x', layers: [0] }] } });
    expect(LSET.AllLayersMask().count()).toBe(before);
    expect(new LAYER_PRESET('y').layers.count()).toBe(before);
  });

  it('viewports and layer pairs round-trip; a pair without a name saves without one', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({
      board: {
        viewports: [{ name: 'v', x: 1.5, y: 2, w: 30, h: 40 }],
        layer_pairs: [
          { topLayer: 0, bottomLayer: 2, enabled: false, name: 'Top-Bot' },
          { topLayer: 4, bottomLayer: 6 },
          { topLayer: 4 },
        ],
      },
    });

    expect(f.m_Viewports[0]!.rect.GetX()).toBe(1.5);
    expect(f.m_Viewports[0]!.rect.GetHeight()).toBe(40);
    expect(f.m_LayerPairInfos).toHaveLength(2);
    expect(f.m_LayerPairInfos[0]!.IsEnabled()).toBe(false);
    expect(f.m_LayerPairInfos[0]!.GetName()).toBe('Top-Bot');
    expect(f.m_LayerPairInfos[1]!.IsEnabled()).toBe(true);
    expect(f.m_LayerPairInfos[1]!.GetName()).toBeUndefined();

    const board = f.SaveToJson().board as JsonObject;
    expect(board.viewports).toEqual([{ name: 'v', x: 1.5, y: 2, w: 30, h: 40 }]);
    expect(board.layer_pairs).toEqual([
      { topLayer: 0, bottomLayer: 2, enabled: false, name: 'Top-Bot' },
      { topLayer: 4, bottomLayer: 6, enabled: true },
    ]);
  });

  it('a 3D viewport is the sixteen matrix keys', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({ board: { '3dviewports': [{ name: 'iso', xx: 0.5, wz: -3 }] } });
    const m = f.m_Viewports3D[0]!.matrix;
    expect(m[0].x).toBe(0.5);
    expect(m[3].z).toBe(-3);
    expect(m[1].y).toBe(1); // identity elsewhere
    const out = ((f.SaveToJson().board as JsonObject)['3dviewports'] as JsonObject[])[0]!;
    expect(out.xx).toBe(0.5);
    expect(out.wz).toBe(-3);
    expect(Object.keys(out)).toHaveLength(17);
  });
});

describe('schema migrations', () => {
  it('a version-1 file has its preset layers renumbered and render layers named', () => {
    const f = new PROJECT_FILE('p');
    // v8: F_Cu = 0, B_Cu = 31, In1_Cu = 1; renderLayers were ints from 125
    f.LoadFromJson({
      meta: { version: 1 },
      board: {
        layer_presets: [{ name: 'old', layers: [0, 1, 31], activeLayer: 31, renderLayers: [125] }],
      },
    });
    const p = f.m_LayerPresets[0]!;
    expect(p.layers.Seq()).toEqual([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.In1_Cu]);
    expect(p.activeLayer).toBe(PCB_LAYER_ID.B_Cu);
    expect(p.renderLayers.Seq()).toEqual([GAL_LAYER_ID.LAYER_VIAS]);
    expect((f.SaveToJson().meta as JsonObject).version).toBe(3);
    expect(f.ShouldAutoSave()).toBe(true);
  });

  it('a newer file is a future format and is not auto-saved', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({ meta: { version: 99 } });
    expect(f.IsFutureFormat()).toBe(true);
    expect(f.ShouldAutoSave()).toBe(false);
  });
});

describe('COMPONENT_CLASS_SETTINGS as a NESTED_SETTINGS', () => {
  it('loads the assignments off the project tree and stores them back, suffixing repeats', () => {
    const f = new PROJECT_FILE('p');
    f.LoadFromJson({
      component_class_settings: {
        sheet_component_classes: { enabled: true },
        assignments: [
          {
            component_class: 'HV',
            conditions_operator: 'ALL',
            conditions: {
              REFERENCE: { primary: 'R*' },
              'REFERENCE-1': { primary: 'C*' },
              SIDE: { primary: 'Back' },
            },
          },
        ],
      },
    });

    const s = f.ComponentClassSettings();
    expect(s.GetEnableSheetComponentClasses()).toBe(true);
    const a = s.GetComponentClassAssignments();
    expect(a).toHaveLength(1);
    expect(a[0]!.GetComponentClass()).toBe('HV');
    expect(a[0]!.GetConditionsOperator()).toBe(CONDITIONS_OPERATOR.ALL);
    expect(a[0]!.GetConditions()).toEqual([
      [CONDITION_TYPE.REFERENCE, 'R*', ''],
      [CONDITION_TYPE.REFERENCE, 'C*', ''],
      [CONDITION_TYPE.SIDE, 'Back', ''],
    ]);

    expect(f.SaveToJson().component_class_settings).toEqual({
      meta: { version: 0 },
      sheet_component_classes: { enabled: true },
      assignments: [
        {
          component_class: 'HV',
          conditions_operator: 'ALL',
          conditions: {
            REFERENCE: { primary: 'R*' },
            'REFERENCE-1': { primary: 'C*' },
            SIDE: { primary: 'Back' },
          },
        },
      ],
    });
  });
});

describe('TUNING_PROFILES as a NESTED_SETTINGS', () => {
  it('reads a profile with layer entries and via overrides, and writes it back by layer name', () => {
    const f = new PROJECT_FILE('p');
    const entry = {
      profile_name: 'fast',
      type: 1,
      target_impedance: 90,
      enable_time_domain_tuning: true,
      layer_entries: [
        {
          signal_layer: 'F.Cu',
          top_reference_layer: 'F.Cu',
          bottom_reference_layer: 'In1.Cu',
          width: 200000,
          diff_pair_gap: 150000,
          delay: 7000,
        },
      ],
      via_prop_delay: 12,
      via_overrides: [
        {
          signal_layer_from: 'F.Cu',
          signal_layer_to: 'B.Cu',
          via_layer_from: 'F.Cu',
          via_layer_to: 'B.Cu',
          delay: 3,
        },
      ],
    };
    f.LoadFromJson({ tuning_profiles: { tuning_profiles_impedance_geometric: [entry] } });

    const p = f.TuningProfileParameters().GetTuningProfile('fast');
    expect(p.m_TargetImpedance).toBe(90);
    expect(p.m_TrackPropagationEntries[0]!.m_bottomReferenceLayer).toBe(PCB_LAYER_ID.In1_Cu);
    expect(p.m_ViaOverrides[0]!.m_Delay).toBe(3);

    expect(f.SaveToJson().tuning_profiles).toEqual({
      meta: { version: 0 },
      tuning_profiles_impedance_geometric: [entry],
    });
  });
});
