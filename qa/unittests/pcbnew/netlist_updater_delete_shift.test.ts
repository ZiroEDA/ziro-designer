import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMPONENT, NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/settings/settings_manager.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  BOARD_NETLIST_UPDATER,
  type NETLIST_UPDATER_FRAME,
} from '@ziroeda/pcbnew/netlist_reader/board_netlist_updater.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { describe, expect, it } from 'vitest';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const F = fileURLToPath(new URL('../../data/pcbnew/resave/ecc83-pp.kicad_pcb', import.meta.url));

/** The netlist the schematic would send for these footprints, matched by path. */
function netlistOf(aBoard: BOARD, keep: (ref: string) => boolean = () => true): NETLIST {
  const netlist = new NETLIST();
  for (const f of aBoard.Footprints()) {
    const parts = f.GetPath().map(String);
    if (parts.length === 0 || !keep(f.GetReference())) continue;
    const base = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}/` : '/';
    const c = new COMPONENT(f.GetFPID().Format(), f.GetReference(), f.GetValue(), base, [
      parts[parts.length - 1] ?? '',
    ]);
    for (const pad of f.Pads())
      if (pad.GetNetCode() > 0 && pad.GetNumber())
        c.AddNet(pad.GetNumber(), pad.GetNetname(), '', '');
    netlist.AddComponent(c);
  }
  return netlist;
}

describe('Update PCB deleting a footprint', () => {
  it('checks the remaining pads against their own footprints, not the next one along', () => {
    const kb = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(F, 'utf8'), F).Parse() as BOARD;
    const manager = new SETTINGS_MANAGER();
    manager.LoadProject('netlist_test.kicad_pro', {});
    kb.SetProject(manager.Prj());
    const count = kb.Footprints().length;
    // Drop the FIRST footprint from the schematic: every later one moves up.
    const first = kb.Footprints()[0]!.GetReference();
    const netlist = netlistOf(kb, (ref) => ref !== first);
    const rep = new Reporter();
    const updater = new BOARD_NETLIST_UPDATER(
      // Deleting and relinking only: no footprint is exchanged or placed.
      new TEST_PCB_FRAME(kb) as unknown as NETLIST_UPDATER_FRAME,
      kb,
      () => null,
    );
    updater.SetReporter(rep);
    updater.SetDeleteUnusedFootprints(true);
    updater.SetLookupByTimestamp(true);
    updater.UpdateNetlist(netlist);
    const messages = rep.lines.map((l) => l.message);
    expect(messages).toContain(`Removed unused footprint ${first}.`);
    expect(messages.filter((m) => m.includes('not found in'))).toEqual([]);
    expect(updater.GetErrorCount()).toBe(0);
    expect(kb.Footprints()).toHaveLength(count - 1);
  });
});
