// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The library parity provider on the ecc83 demo, whose footprints came from
 * the `footprints.pretty` beside it: `kicad-cli pcb drc --severity-all` on the
 * same files reports no lib_footprint_issues and no lib_footprint_mismatch.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { ENUM_MAP } from '@ziroeda/common/src/properties/property.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import { PCB_DRC_CODE } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import '@ziroeda/pcbnew/src/drc/drc_test_providers.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/src/footprint.js';
import type {
  FOOTPRINT_LIBRARY_ADAPTER,
  LIBRARY_TABLE_ROW,
} from '@ziroeda/pcbnew/src/footprint_library_adapter.js';
import { ParseBoard, ParseFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';

const DEMO = new URL('../../../../designer/public/demos/ecc83/', import.meta.url);

/** The demo's fp-lib-table: one `KiCad` row, `Footprints`, over `footprints.pretty`. */
class DemoAdapter implements FOOTPRINT_LIBRARY_ADAPTER {
  private readonly rows: LIBRARY_TABLE_ROW[] = [
    { nickname: 'Footprints', uri: '${KIPRJMOD}/footprints.pretty', type: 'KiCad', enabled: true },
  ];

  /** A footprint file's text, replaced by a test to fake a library edit. */
  readonly override = new Map<string, string>();

  GetRow(aNickname: string): LIBRARY_TABLE_ROW | null {
    return this.rows.find((r) => r.nickname === aNickname) ?? null;
  }

  HasLibrary(aNickname: string, aCheckEnabled = false): boolean {
    const row = this.GetRow(aNickname);
    return row !== null && (!aCheckEnabled || row.enabled);
  }

  IsLibraryLoaded(aNickname: string): boolean {
    return this.GetRow(aNickname) !== null;
  }

  LoadFootprint(aNickname: string, aName: string, _aKeepUUID: boolean): FOOTPRINT | null {
    if (aNickname !== 'Footprints') return null;

    const file = new URL(`footprints.pretty/${aName}.kicad_mod`, DEMO);

    if (!existsSync(file)) return null;

    return ParseFootprintFile(this.override.get(aName) ?? readFileSync(file, 'utf8'), aName);
  }

  GetFullURI(aRow: LIBRARY_TABLE_ROW): string {
    return aRow.uri;
  }
}

function loadEcc83(adapter: FOOTPRINT_LIBRARY_ADAPTER) {
  const board = ParseBoard(readFileSync(new URL('ecc83-pp.kicad_pcb', DEMO), 'utf8'));
  const pro = JSON.parse(readFileSync(new URL('ecc83-pp.kicad_pro', DEMO), 'utf8'));

  board.GetDesignSettings().LoadFromJson(pro.board.design_settings);
  board.GetDesignSettings().m_NetSettings.LoadFromJson(pro.net_settings);
  board.SetFootprintLibAdapter(adapter);

  const layerEnum = ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID');
  layerEnum.Choices().Clear();
  layerEnum.Undefined(PCB_LAYER_ID.UNDEFINED_LAYER);
  for (const layer of LSET.AllLayersMask()) {
    layerEnum.Map(layer, LSET.Name(layer));
    layerEnum.Map(layer, board.GetLayerName(layer));
  }

  const engine = new DRC_ENGINE(board, board.GetDesignSettings());
  board.GetDesignSettings().m_DRCEngine = engine;
  engine.InitEngine(null);
  board.BuildListOfNets();
  board.BuildConnectivity();

  return board;
}

function runParity(adapter: FOOTPRINT_LIBRARY_ADAPTER): { issues: string[]; mismatches: string[] } {
  const board = loadEcc83(adapter);
  const issues: string[] = [];
  const mismatches: string[] = [];

  board.GetDesignSettings().m_DRCEngine!.SetViolationHandler((aItem: DRC_ITEM) => {
    if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES)
      issues.push(aItem.GetErrorMessage(false));
    if (aItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH)
      mismatches.push(aItem.GetErrorMessage(false));
  });

  board.GetDesignSettings().m_DRCEngine!.RunTests('mm', true, false);

  return { issues, mismatches };
}

describe('library parity on ecc83', () => {
  it('matches kicad-cli: every board footprint is its library copy', () => {
    const { issues, mismatches } = runParity(new DemoAdapter());

    expect(issues).toEqual([]);
    expect(mismatches).toEqual([]);
  });

  it('a library edit is a mismatch for every instance of that footprint', () => {
    const adapter = new DemoAdapter();
    const name = 'R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal';
    const text = readFileSync(new URL(`footprints.pretty/${name}.kicad_mod`, DEMO), 'utf8');

    // Widen the first pad's drill.
    const edited = text.replace(
      /\(drill ([0-9.]+)\)/,
      (_m, d: string) => `(drill ${Number(d) + 0.2})`,
    );
    expect(edited).not.toBe(text);
    adapter.override.set(name, edited);

    const { issues, mismatches } = runParity(adapter);

    expect(issues).toEqual([]);
    // Four resistors on the board share that footprint.
    expect(mismatches).toEqual(
      new Array(4).fill(`Footprint '${name}' does not match copy in library 'Footprints'`),
    );
  });

  it('a nickname the table does not have is an issue, not a mismatch', () => {
    const adapter = new DemoAdapter();
    (adapter as unknown as { rows: LIBRARY_TABLE_ROW[] }).rows.length = 0;

    const { issues, mismatches } = runParity(adapter);

    expect(mismatches).toEqual([]);
    expect(issues.length).toBe(15);
    expect(issues[0]).toBe(
      `The current configuration does not include the footprint library 'Footprints'`,
    );
  });
});
