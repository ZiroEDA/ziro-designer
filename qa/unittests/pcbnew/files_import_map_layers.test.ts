// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_EDIT_FRAME::OpenProjectFiles` registers `DIALOG_MAP_LAYERS::RunModal`
 * with a `LAYER_MAPPABLE_PLUGIN` (files.cpp:642-649). Ours asks from inside a
 * synchronous `LoadBoard`, so `ImportNonKicadBoard` loads once to learn the
 * layers, shows the dialog, and loads again only when the answer differs.
 */
import { describe, expect, it, vi } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_FILE_T, PCB_IO_MGR } from '@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js';
import type {
  INPUT_LAYER_DESC,
  LAYER_MAPPING_HANDLER,
} from '@ziroeda/pcbnew/pcb_io/common/plugin_common_layer_mapping.js';

const DESCS: INPUT_LAYER_DESC[] = [
  {
    Name: 'Top Layer',
    PermittedLayers: new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]),
    AutoMapLayer: PCB_LAYER_ID.F_Cu,
    Required: true,
  },
];

/** A layer-mappable plugin: LoadBoard asks its handler, synchronously, and records the answer. */
function fakePlugin(seen: Map<string, PCB_LAYER_ID>[], plain = false) {
  let handler: LAYER_MAPPING_HANDLER = () => new Map();
  const board = {
    GetEnabledLayers: () => ({ Seq: () => [] }),
    SetLayerName: () => {},
    BuildListOfNets: () => {},
  };
  return {
    SetFileReader: () => {},
    SetReporter: () => {},
    SetProgressReporter: () => {},
    GetImportedCachedLibraryFootprints: () => [],
    ...(plain ? {} : { RegisterCallback: (h: LAYER_MAPPING_HANDLER) => (handler = h) }),
    LoadBoard: () => {
      if (!plain) seen.push(handler(DESCS));
      return board;
    },
  };
}

const frame = () =>
  ({
    m_importProperties: null,
    GetPageSizeIU: () => ({ x: 1, y: 1 }),
    config: () => null,
    GetPcbNewSettings: () => ({ m_ImportKeepKiCadLayerNames: false }),
  }) as never;

function setup(plain = false) {
  const seen: Map<string, PCB_LAYER_ID>[] = [];
  let made = 0;
  vi.spyOn(PCB_IO_MGR, 'FindPluginTypeFromBoardPath').mockResolvedValue(
    PCB_FILE_T.FILE_TYPE_NONE + 1,
  );
  vi.spyOn(PCB_IO_MGR, 'FindPlugin').mockImplementation((() => {
    made++;
    return Promise.resolve(fakePlugin(seen, plain));
  }) as never);
  return { seen, made: () => made };
}

const run = (
  aMap: ((d: readonly INPUT_LAYER_DESC[]) => Promise<Map<string, PCB_LAYER_ID>>) | null,
) =>
  PCB_EDIT_FRAME.prototype.ImportNonKicadBoard.call(
    frame(),
    'a.PcbDoc',
    new Uint8Array(),
    0,
    null,
    aMap,
  );

describe('ImportNonKicadBoard and DIALOG_MAP_LAYERS', () => {
  it('shows the dialog on the layers the plugin asked about', async () => {
    setup();
    const ask = vi.fn(
      async (d: readonly INPUT_LAYER_DESC[]) => new Map([[d[0]!.Name, PCB_LAYER_ID.F_Cu]]),
    );
    await run(ask);
    expect(ask.mock.calls[0]![0]).toEqual(DESCS);
  });

  it('an answer equal to the automatic mapping costs no second load', async () => {
    const s = setup();
    await run(async () => new Map([['Top Layer', PCB_LAYER_ID.F_Cu]]));
    expect(s.made()).toBe(1);
    expect(s.seen).toHaveLength(1);
  });

  it('a different answer reloads the file on a fresh plugin with THAT mapping', async () => {
    const s = setup();
    await run(async () => new Map([['Top Layer', PCB_LAYER_ID.B_Cu]]));
    expect(s.made()).toBe(2);
    expect(s.seen[1]!.get('Top Layer')).toBe(PCB_LAYER_ID.B_Cu);
  });

  it('with no dialog (m_ImportSkipLayerMapping) the plugin keeps its own mapping', async () => {
    const s = setup();
    await run(null);
    expect(s.made()).toBe(1);
    expect(s.seen[0]!.size).toBe(0);
  });

  it('a plugin that is not layer-mappable never raises it', async () => {
    setup(true);
    const ask = vi.fn(async () => new Map<string, PCB_LAYER_ID>());
    await run(ask);
    expect(ask).not.toHaveBeenCalled();
  });
});
