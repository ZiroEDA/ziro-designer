// A smoke run of the ported DRC providers on a real board: every provider
// runs to completion and the violations are printed for comparison with
// `kicad-cli pcb drc` on the same files. Not a gate test; run it by name.
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { ENUM_MAP } from '@ziroeda/common/src/properties/property.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { DRC_ITEM } from '@ziroeda/pcbnew/src/drc/drc_item.js';
import '@ziroeda/pcbnew/src/drc/drc_test_providers.js';
import { ParseBoard } from '@ziroeda/pcbnew/src/read-board.js';

const DEMO = new URL('../../designer/public/demos/ecc83/', import.meta.url);

it('runs every provider on ecc83', () => {
  const text = readFileSync(new URL('ecc83-pp.kicad_pcb', DEMO), 'utf8');
  const pro = JSON.parse(readFileSync(new URL('ecc83-pp.kicad_pro', DEMO), 'utf8'));
  const board = ParseBoard(text);

  board.GetDesignSettings().LoadFromJson(pro.board.design_settings);
  board.GetDesignSettings().m_NetSettings.LoadFromJson(pro.net_settings);
  board.SynchronizeNetsAndNetClasses(false);

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
  board.InitializeClearanceCache();

  const out: string[] = [];
  engine.SetViolationHandler((aItem: DRC_ITEM, aPos, aLayer) => {
    out.push(
      `[${aItem.GetSettingsKey()}] ${aItem.GetErrorMessage(false)} @ (${(aPos.x / 1e6).toFixed(4)}, ${(aPos.y / 1e6).toFixed(4)}) layer ${aLayer} :: ${aItem.GetIDs().join(',')}`,
    );
  });
  engine.SetLogReporter({ report: (s: string) => out.push(`# ${s}`) } as never);

  engine.RunTests('mm', true, true);

  console.log(out.join('\n'));
});
