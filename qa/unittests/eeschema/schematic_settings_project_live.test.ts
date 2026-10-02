// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCHEMATIC_SETTINGS and ERC_SETTINGS as the project file's nested settings, made and loaded by
 * SCHEMATIC::SetProject (schematic.cpp:180; schematic_settings.cpp; erc_settings.cpp).
 *
 * The round trip is the oracle: KiCad wrote each fixture's `schematic` and `erc` sections from
 * the same parameter table, so loading and storing them must give back what it wrote.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings_internals.js';
import { ELECTRICAL_PINTYPE } from '@ziroeda/common/pin_type.js';
import { ERCE_T, PIN_ERROR } from '@ziroeda/eeschema/erc/erc_settings.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { describe, expect, it } from 'vitest';

const DATA = resolve(__dirname, '../../data');
/**
 * Each fixture, with the ERC rules its writer's KiCad did not share with 10.0.6: a rule
 * 10.0.6 has and the writer did not is stored at its default, and one only the writer had
 * (not in 10.0.6's erc_item.cpp) is dropped, as 10.0.6's own store drops it.
 */
const FIXTURES: {
  file: string;
  newerHere: string[];
  droppedHere: string[];
  /** What 10.0.6 writes back for `used_designators` (see below). */
  usedDesignators: string;
}[] = [
  {
    file: 'eeschema/netlist_oracle_graph/test1243/test1243.kicad_pro',
    newerHere: ['field_name_whitespace'],
    droppedHere: [],
    usedDesignators: 'U1',
  },
  {
    file: 'eeschema/netlist_oracle_graph/issue24044/issue24044.kicad_pro',
    newerHere: [],
    droppedHere: [],
    // The file says "R1-4,J1-2,#PWR1-4".  Deserialize inserts R, J, #PWR into the emptied
    // unordered_map in that order, and libstdc++ iterates those three in reverse
    // (qa/data/common/libc/std_unordered_map_probe.json, the last case).
    usedDesignators: '#PWR1-4,J1-2,R1-4',
  },
  {
    file: 'pcbnew/diff_pair_uncoupled_tuning_drc.kicad_pro',
    newerHere: [],
    droppedHere: ['same_local_global_power'],
    usedDesignators: 'R1-2',
  },
];

/**
 * `used_designators` is REFDES_TRACKER::Serialize over a std::unordered_map, so its prefix
 * order is libstdc++'s: a KiCad-written file need not come back in the order it was written.
 */

type Obj = { [k: string]: JsonValue };

function open(aJson: Obj) {
  const project = new PROJECT();
  const file = new PROJECT_FILE('/p/p.kicad_pro');
  project.setProjectFile(file);
  file.LoadFromFile(aJson);
  return { file, schematic: new SCHEMATIC(project) };
}

describe('the project file round trip', () => {
  for (const { file: fixture, newerHere, droppedHere, usedDesignators } of FIXTURES) {
    it(fixture, () => {
      const json = JSON.parse(readFileSync(resolve(DATA, fixture), 'utf8')) as Obj;
      const { file, schematic } = open(structuredClone(json));
      schematic.Settings().SaveToFile();
      schematic.ErcSettings().SaveToFile();

      for (const section of ['schematic', 'erc']) {
        const wrote = json[section] as Obj;
        const stored = file.GetJson(section) as Obj;

        for (const key of Object.keys(wrote)) {
          if (key === 'drawing') {
            for (const d of Object.keys(wrote.drawing as Obj))
              expect((stored.drawing as Obj)[d], `${section}.drawing.${d}`).toEqual(
                (wrote.drawing as Obj)[d],
              );
          } else if (key === 'used_designators') {
            expect(stored[key], key).toBe(usedDesignators);
          } else if (key === 'rule_severities') {
            const ours = stored[key] as Obj;
            const theirs = wrote[key] as Obj;
            const shared = Object.keys(theirs).filter((k) => !droppedHere.includes(k));

            for (const k of shared) expect(ours[k], `rule_severities.${k}`).toBe(theirs[k]);
            expect(Object.keys(ours).filter((k) => !(k in theirs))).toEqual(newerHere);
            expect(droppedHere.filter((k) => k in ours)).toEqual([]);
          } else {
            expect(stored[key], `${section}.${key}`).toEqual(wrote[key]);
          }
        }
      }
    });
  }
});

describe('SCHEMATIC::SetProject', () => {
  it("answers Settings() and ErcSettings() with the project file's nested objects", () => {
    const { file, schematic } = open({});
    expect(schematic.Settings() === file.m_SchematicSettings).toBe(true);
    expect(schematic.ErcSettings() === file.m_ErcSettings).toBe(true);
  });

  it('reads every non-default schematic value the way the parameter table says', () => {
    const { schematic } = open({
      schematic: {
        meta: { version: 1 },
        annotate_start_num: 100,
        annotation: { method: 2, sort_order: 1 },
        connection_grid_size: 100.0,
        subpart_id_separator: 46,
        subpart_first_id: 49,
        reuse_designators: false,
        used_designators: 'R1,R3,U2',
        page_layout_descr_file: 'sheet.kicad_wks',
        drawing: {
          default_line_thickness: 8.0,
          default_text_size: 60.0,
          pin_symbol_size: 30.0,
          label_size_ratio: 0.5,
          text_offset_ratio: 0.2,
          intersheets_ref_show: true,
          intersheets_ref_prefix: '<',
          junction_size_choice: 1,
          field_names: [
            { name: 'MPN', visible: true, url: false },
            { name: 'value', visible: true, url: false }, // a mandatory name: refused
            { name: 'Datasheet2', visible: false, url: true },
          ],
        },
        variants: [{ name: 'B' }, { name: 'A', description: 'first' }],
      },
    });
    const s = schematic.Settings();

    expect(s.m_AnnotateStartNum).toBe(100);
    expect([s.m_AnnotateMethod, s.m_AnnotateSortOrder]).toEqual([2, 1]);
    // PARAM_SCALED in mils: schIUScale.MilsToIU (254 IU per mil).
    expect(s.m_ConnectionGridSize).toBe(100 * 254);
    expect(s.m_DefaultLineWidth).toBe(8 * 254);
    expect(s.m_DefaultTextSize).toBe(60 * 254);
    expect(s.m_PinSymbolSize).toBe(30 * 254);
    expect([s.m_LabelSizeRatio, s.m_TextOffsetRatio]).toEqual([0.5, 0.2]);
    expect([s.m_IntersheetRefsShow, s.m_IntersheetRefsPrefix]).toEqual([true, '<']);
    expect(s.m_JunctionSizeChoice).toBe(1);
    expect(s.SubReference(3)).toBe('.3');
    expect(s.m_SchDrawingSheetFileName).toBe('sheet.kicad_wks');
    expect(s.m_TemplateFieldNames.GetTemplateFieldNames().map((f) => f.m_Name)).toEqual([
      'MPN',
      'Datasheet2',
    ]);
    expect(s.m_refDesTracker!.GetReuseRefDes()).toBe(false);
    expect(['R1', 'R2', 'R3', 'U2'].map((r) => s.m_refDesTracker!.Contains(r))).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect([...s.m_VariantDescriptions]).toEqual([
      ['B', ''],
      ['A', 'first'],
    ]);
  });

  it('falls back to the default for a value outside its range', () => {
    const { schematic } = open({
      schematic: {
        connection_grid_size: 10.0, // below MIN_CONNECTION_GRID_MILS (25)
        annotation: { method: 3 }, // past 2
        drawing: { default_line_thickness: 2000.0 }, // past 1000 mils
      },
    });
    const s = schematic.Settings();
    expect(s.m_ConnectionGridSize).toBe(50 * 254);
    expect(s.m_AnnotateMethod).toBe(0);
    expect(s.m_DefaultLineWidth).toBe(6 * 254);
  });

  it('migrates a version 0 file: the label size ratio was the text offset ratio', () => {
    const { schematic } = open({
      schematic: { meta: { version: 0 }, drawing: { text_offset_ratio: 0.3 } },
    });
    expect(schematic.Settings().m_LabelSizeRatio).toBe(0.3);
  });

  it('stores the variants in name order, a description only when there is one', () => {
    const { file, schematic } = open({
      schematic: { variants: [{ name: 'B' }, { name: 'A', description: 'first' }] },
    });
    schematic.Settings().SaveToFile();
    expect(file.GetJson('schematic.variants')).toEqual([
      { name: 'A', description: 'first' },
      { name: 'B' },
    ]);
  });

  it('reads the ERC severities, exclusions and pin map', () => {
    const map = Array.from({ length: 12 }, () => Array<number>(12).fill(0));
    map[ELECTRICAL_PINTYPE.PT_OUTPUT]![ELECTRICAL_PINTYPE.PT_OUTPUT] = 1;
    map[0]![1] = 7; // out of range: kept at its old value
    const { schematic } = open({
      erc: {
        rule_severities: { pin_not_connected: 'warning', endpoint_off_grid: 'ignore' },
        erc_exclusions: [['marker|1', 'checked'], 'marker|2'],
        pin_map: map,
      },
    });
    const erc = schematic.ErcSettings();

    expect(erc.GetSeverity(ERCE_T.ERCE_PIN_NOT_CONNECTED)).toBe(RPT_SEVERITY_WARNING);
    expect(erc.GetSeverity(ERCE_T.ERCE_ENDPOINT_OFF_GRID)).toBe(RPT_SEVERITY_IGNORE);
    expect(erc.GetSeverity(ERCE_T.ERCE_PIN_NOT_DRIVEN)).toBe(RPT_SEVERITY_ERROR);
    expect([...erc.m_ErcExclusions].sort()).toEqual(['marker|1', 'marker|2']);
    expect(erc.m_ErcExclusionComments.get('marker|1')).toBe('checked');
    expect(erc.GetPinMapValue(ELECTRICAL_PINTYPE.PT_OUTPUT, ELECTRICAL_PINTYPE.PT_OUTPUT)).toBe(
      PIN_ERROR.WARNING,
    );
    expect(erc.GetPinMapValue(0, 1)).toBe(PIN_ERROR.OK);
    expect(erc.GetPinMapValue(0, 11)).toBe(PIN_ERROR.OK); // the file's 0, not the default ERR
  });

  it('keeps the default pin map when the file has a short one', () => {
    const { schematic } = open({ erc: { pin_map: [[0, 0]] } });
    expect(schematic.ErcSettings().GetPinMapValue(0, 11)).toBe(PIN_ERROR.PP_ERROR);
  });
});
