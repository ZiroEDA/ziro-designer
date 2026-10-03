import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMPONENT, NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_NETLIST_UPDATER } from '@ziroeda/pcbnew/netlist_reader/board_netlist_updater.js';
import { boardFromBOARD } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/board_view.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import type { Board } from '@ziroeda/pcbnew/types.js';
import { describe, expect, it } from 'vitest';

const F = fileURLToPath(new URL('../../data/pcbnew/resave/ecc83-pp.kicad_pcb', import.meta.url));

/** The netlist the schematic would send for these footprints, matched by path. */
function netlistOf(view: Board, keep: (ref: string) => boolean): NETLIST {
  const netlist = new NETLIST();
  for (const f of view.footprints) {
    if (!f.path || !keep(f.reference ?? '')) continue;
    const parts = f.path.split('/').filter(Boolean);
    const base = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}/` : '/';
    const c = new COMPONENT(f.lib, f.reference ?? '', f.value ?? '', base, [
      parts[parts.length - 1] ?? '',
    ]);
    for (const pad of f.pads)
      if (pad.net !== undefined && pad.number)
        c.AddNet(pad.number, view.nets.get(pad.net) ?? '', '', '');
    netlist.AddComponent(c);
  }
  return netlist;
}

describe('Update PCB deleting a footprint', () => {
  it('checks the remaining pads against their own footprints, not the next one along', () => {
    const kb = new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(F, 'utf8'), F).Parse() as BOARD;
    const view = boardFromBOARD(kb);
    // Drop the FIRST footprint from the schematic: every later index shifts.
    const first = view.footprints[0]?.reference ?? '';
    const rep = new Reporter();
    const r = new BOARD_NETLIST_UPDATER(view, rep, () => null, {
      deleteUnusedFootprints: true,
      lookupByTimestamp: true,
    }).UpdateNetlist(netlistOf(view, (ref) => ref !== first));
    const messages = rep.lines.map((l) => l.message);
    expect(messages).toContain(`Removed unused footprint ${first}.`);
    expect(messages.filter((m) => m.includes('not found in'))).toEqual([]);
    expect(r.errorCount).toBe(0);
    expect(r.board.footprints).toHaveLength(view.footprints.length - 1);
  });
});
