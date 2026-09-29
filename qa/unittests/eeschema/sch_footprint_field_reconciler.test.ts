// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SCH_FOOTPRINT_FIELD_RECONCILER` (eeschema/sch_footprint_field_reconciler.cpp,
 * 10.0.6), after `qa/tests/eeschema/test_sch_footprint_field_reconciler.cpp`.
 *
 * KiCad's test imports an Eagle schematic to get Footprint fields on a library
 * that does not exist; the Eagle importer is not ported, so the schematic here
 * is built with the same field shapes, over two screens so the SCH_SCREENS
 * walk is exercised.
 */
import { describe, expect, it } from 'vitest';
import { IMPORT_PROJ_PROPS } from '@ziroeda/common/import_proj_properties.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { RPT_SEVERITY_INFO, Reporter } from '@ziroeda/common/reporter.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ReconcileImportedFootprintFields } from '@ziroeda/eeschema/files-io.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_FOOTPRINT_FIELD_RECONCILER } from '@ziroeda/eeschema/sch_footprint_field_reconciler.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

function build(footprints: string[][]): { schematic: SCHEMATIC; symbols: SCH_SYMBOL[] } {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const root = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(root);
  const screens = [root.LastScreen()!];

  // A second screen, reached through a sheet on the first.
  for (let i = 1; i < footprints.length; i++) {
    const sub = new SCH_SHEET(null, { x: 0, y: 0 }, { x: 1000, y: 1000 });
    const screen = new SCH_SCREEN(schematic);
    sub.SetScreen(screen);
    screens[0]!.Append(sub);
    screens.push(screen);
  }

  const symbols: SCH_SYMBOL[] = [];
  footprints.forEach((fps, i) => {
    for (const fp of fps) {
      const sym = new SCH_SYMBOL(new LIB_SYMBOL('R'), new LIB_ID('Device', 'R'), root, 1, 0, {
        x: 0,
        y: 0,
      });
      sym.SetFootprintFieldText(fp);
      screens[i]!.Append(sym);
      symbols.push(sym);
    }
  });

  return { schematic, symbols };
}

const fp = (s: SCH_SYMBOL): string => s.GetField(FIELD_T.FOOTPRINT)!.GetText();

describe('SCH_FOOTPRINT_FIELD_RECONCILER', () => {
  it('re-points every field on an unregistered library at the cache, keeping the item', () => {
    const { schematic, symbols } = build([['eagle_test:R0603', 'C0805'], ['eagle_test:SOT23']]);
    const result = new SCH_FOOTPRINT_FIELD_RECONCILER('eagle_test-import-fps', []).Reconcile(
      schematic,
    );
    expect(result.m_relinkedToCache).toBe(3);
    expect(result.m_keptSource).toBe(0);
    expect(symbols.map(fp)).toEqual([
      'eagle_test-import-fps:R0603',
      'eagle_test-import-fps:C0805',
      'eagle_test-import-fps:SOT23',
    ]);
  });

  it('keeps a field on a registered source library, and skips empty or item-less ones', () => {
    const { schematic, symbols } = build([['Altium_Lib:SOIC8', '', 'Lib:', 'other:QFN']]);
    const result = new SCH_FOOTPRINT_FIELD_RECONCILER('cache', ['Altium_Lib']).Reconcile(schematic);
    expect(result.m_keptSource).toBe(1);
    expect(result.m_relinkedToCache).toBe(1);
    expect(symbols.map(fp)).toEqual(['Altium_Lib:SOIC8', '', 'Lib:', 'cache:QFN']);
  });

  it('does nothing without a cache nickname', () => {
    const { schematic, symbols } = build([['x:R']]);
    const result = new SCH_FOOTPRINT_FIELD_RECONCILER('', []).Reconcile(schematic);
    expect(result.m_relinkedToCache).toBe(0);
    expect(symbols.map(fp)).toEqual(['x:R']);
  });

  it('reports the re-link count, and says nothing when nothing moved', () => {
    const reporter = new Reporter();
    new SCH_FOOTPRINT_FIELD_RECONCILER('cache', [], reporter).Reconcile(
      build([['a:R', 'b:C']]).schematic,
    );
    expect(reporter.lines).toEqual([
      {
        message: "Re-linked 2 imported footprint assignment(s) to library 'cache'.",
        severity: RPT_SEVERITY_INFO,
        location: 'body',
      },
    ]);
    const quiet = new Reporter();
    new SCH_FOOTPRINT_FIELD_RECONCILER('cache', ['a'], quiet).Reconcile(build([['a:R']]).schematic);
    expect(quiet.lines).toEqual([]);
  });
});

describe("importFile's re-link block", () => {
  it('reads the cache nickname and source libraries out of the import properties', () => {
    const { schematic, symbols } = build([['proj:R0603', 'Src:C']]);
    const props = new Map([
      [IMPORT_PROJ_PROPS.FP_CACHE_NICKNAME, 'proj-import-fps'],
      [IMPORT_PROJ_PROPS.SOURCE_FP_LIBS, IMPORT_PROJ_PROPS.JoinList(['Src'])],
    ]);
    const result = ReconcileImportedFootprintFields(schematic, props, null);
    expect(result.m_relinkedToCache).toBe(1);
    expect(symbols.map(fp)).toEqual(['proj-import-fps:R0603', 'Src:C']);
    expect(ReconcileImportedFootprintFields(schematic, null, null).m_relinkedToCache).toBe(0);
  });
});
