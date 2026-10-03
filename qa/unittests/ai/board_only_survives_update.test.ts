import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pcbBridge } from '@ziroeda/ai/pcb_bridge.js';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import {
  BOARD_NETLIST_UPDATER,
  type NETLIST_UPDATER_FRAME,
} from '@ziroeda/pcbnew/netlist_reader/board_netlist_updater.js';
import { COMPONENT, NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import type { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/settings/settings_manager.js';
import { routeHeadless } from '@ziroeda/pcbnew/router/route_headless.js';
import { beforeAll, expect, it } from 'vitest';
const F = fileURLToPath(new URL('../../data/pcbnew/resave/ecc83-pp.kicad_pcb', import.meta.url));
class TF extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();
  constructor(b: BOARD) {
    super(FRAME_T.FRAME_PCB_EDITOR);
    this.SetBoard(b);
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(b, null, null, this.settings, this);
  }
  GetName() {
    return 'PcbFrame';
  }
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }
  GetPcbNewSettings() {
    return this.settings;
  }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }
}
beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});
it('a board-only mounting hole survives a route commit and Update PCB from Schematic', async () => {
  const kb = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(F, 'utf8'), F).Parse() as BOARD;
  kb.BuildConnectivity();
  const manager = new SETTINGS_MANAGER();
  manager.LoadProject('netlist_test.kicad_pro', {});
  kb.SetProject(manager.Prj());
  const frame = new TF(kb);
  // A stand-in library footprint: CI has no KiCad libraries installed.
  const lib = { k: kb.Footprints()[0] };
  const bridge = pcbBridge({
    board: () => kb,
    frame: () => frame as unknown as PCB_EDIT_FRAME,
    updateFromSchematic: async () => ({ ok: true, report: '' }),
    fillZones: () => {},
    route: async () => ({ ok: true, reason: '' }),
    loadFootprint: async () => (lib?.k?.Duplicate(false) as FOOTPRINT) ?? null,
  });
  expect((await bridge.run('add_mounting_hole', { x: 105, y: 55 }))?.text).toBe(
    'H1 (M3) at 105,55.',
  );
  const live0 = () => kb.FindFootprintByReference('H1');
  // What a route does next: a commit on the live board, through the frame.
  const net = kb
    .Footprints()
    .flatMap((f) => f.Pads())
    .find((p) => p.GetNetname())!;
  const pads = kb
    .Footprints()
    .flatMap((f) => f.Pads())
    // Two of the board's own pads: the hole is a copy of a footprint with nets.
    .filter((p) => p.GetNetCode() === net.GetNetCode() && p.GetParentFootprint() !== live0());
  const rr = routeHeadless(
    kb,
    pads[0]!.GetPosition(),
    pads[1]!.GetPosition(),
    'F.Cu',
    { trackWidth: 250000, commitHost: frame },
    2,
    () => true,
    () => true,
  );
  expect(rr.ok).toBe(true);
  const live = kb.FindFootprintByReference('H1');
  expect(live?.IsBoardOnly()).toBe(true);
  // A netlist made of the board's own parts, matched by path, as the schematic would send.
  const netlist = new NETLIST();
  for (const f of kb.Footprints()) {
    const parts = f.GetPath().map(String);
    if (parts.length === 0) continue;
    const base = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}/` : '/';
    const c = new COMPONENT(f.GetFPID().Format(), f.GetReference(), f.GetValue(), base, [
      parts[parts.length - 1]!,
    ]);
    for (const pad of f.Pads())
      if (pad.GetNetCode() > 0 && pad.GetNumber())
        c.AddNet(pad.GetNumber(), pad.GetNetname(), '', '');
    netlist.AddComponent(c);
  }
  const rep = new Reporter();
  const updater = new BOARD_NETLIST_UPDATER(
    // Deleting and relinking only: no footprint is exchanged or placed.
    frame as unknown as NETLIST_UPDATER_FRAME,
    kb,
    () => null,
  );
  updater.SetReporter(rep);
  updater.SetDeleteUnusedFootprints(true);
  updater.SetLookupByTimestamp(true);
  updater.SetReplaceFootprints(true);
  updater.SetUpdateFields(true);
  updater.UpdateNetlist(netlist);
  expect(rep.lines.map((l) => l.message)).not.toContain('Removed unused footprint H1.');
  expect(kb.Footprints().some((f) => f.GetReference() === 'H1')).toBe(true);
});
