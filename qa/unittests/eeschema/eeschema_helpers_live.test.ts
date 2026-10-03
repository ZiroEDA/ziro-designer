// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EESCHEMA_HELPERS::LoadSchematic (eeschema_helpers.cpp), the load kicad-cli runs: the steps
 * after connectivity, ResolveERCExclusionsPostUpdate and RecomputeIntersheetRefs, and the
 * project's schematic settings reaching LoadVariants through SCHEMATIC_SETTINGS.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERC_ITEM } from '@ziroeda/eeschema/erc/erc_item.js';
import { ERCE_T } from '@ziroeda/eeschema/erc/erc_settings.js';
import { LoadSchematic } from '@ziroeda/eeschema/eeschema_helpers.js';
import { SCH_MARKER } from '@ziroeda/eeschema/sch_marker.js';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../data/eeschema/netlist_oracle_graph/issue23719');

function load(aEdit: (json: Record<string, unknown>) => void = () => {}) {
  const pro = join(DIR, 'issue23719.kicad_pro');
  const project = new PROJECT();
  project.setProjectFullName(pro);
  const file = new PROJECT_FILE(pro);
  project.setProjectFile(file);
  const json = JSON.parse(readFileSync(pro, 'utf8')) as Record<string, unknown>;
  aEdit(json);
  file.LoadFromFile(json as never);
  return LoadSchematic(join(DIR, 'issue23719.kicad_sch'), project, (p) =>
    existsSync(p) ? readFileSync(p, 'utf8') : null,
  )!;
}

describe('EESCHEMA_HELPERS::LoadSchematic', () => {
  it('maps each global label to the pages it is on', () => {
    // The file: Sheet 1 is page 2, Sheet 2 page 3, Sheet 3 page 4; P5V_IF_Rtn is on all
    // three, P5V_IF_Rtn_Sense on 1 and 2, P4 on 3.
    const refs = load().GetPageRefsMap();
    expect(
      Object.fromEntries([...refs].map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
    ).toEqual({ P5V_IF_Rtn: [2, 3, 4], P5V_IF_Rtn_Sense: [2, 3], P4: [4] });
  });

  it("places the project's ERC exclusions as excluded markers", () => {
    const first = load();
    const sheet = first.Hierarchy().find((p) => p.GetPageNumber() === '4')!;
    const label = sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_GLOBAL_LABEL_T)[0]!;
    const item = ERC_ITEM.Create(ERCE_T.ERCE_SINGLE_GLOBAL_LABEL)!;
    item.SetItems(label.m_Uuid);
    item.SetItemsSheetPaths(sheet);
    const serialized = new SCH_MARKER(item, label.GetPosition()).SerializeToString();

    const schematic = load((json) => {
      (json.erc as Record<string, unknown>).erc_exclusions = [[serialized, 'checked']];
    });
    const again = schematic.Hierarchy().find((p) => p.GetPageNumber() === '4')!;
    const markers = again
      .LastScreen()!
      .Items()
      .OfType(KICAD_T.SCH_MARKER_T) as unknown as SCH_MARKER[];

    expect(markers.map((m) => [m.IsExcluded(), m.GetComment(), m.SerializeToString()])).toEqual([
      [true, 'checked', serialized],
    ]);
  });

  it("gives LoadVariants the project's variant descriptions", () => {
    const schematic = load((json) => {
      (json.schematic as Record<string, unknown>).variants = [
        { name: 'Lite', description: 'no ADC' },
      ];
    });
    expect(schematic.Settings().m_VariantDescriptions.get('Lite')).toBe('no ADC');
    expect([...schematic.GetVariantNames()]).toContain('Lite');
  });
});
