// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Update PCB from Schematic" against the board the same schematic produced:
 * every net must keep the name KiCad gave it, so the update reconnects nothing
 * and the routing stays on the pads' nets. When the netlist names a net
 * differently from the board, the updater moves the pads onto a new net and
 * leaves the tracks behind on the old one, which shows up as a ratsnest drawn
 * over copper that is already routed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { Reporter } from '@ziroeda/common/src/reporter.js';
import { readSchematic } from '@ziroeda/eeschema';
import { netlistKicad } from '@ziroeda/eeschema/src/exporters/netlist_exporter_kicad.js';
import {
  BOARD_NETLIST_UPDATER,
  buildRatsnest,
  loadKicadNetlist,
  readBoard,
  type PcbFootprint,
} from '@ziroeda/pcbnew';

const DEMO = fileURLToPath(new URL('../../../designer/public/demos/ecc83/', import.meta.url));
const read = (name: string): string => readFileSync(DEMO + name, 'utf8');

/** The demo's netlist, exported the way PCB_EDIT_FRAME::FetchNetlistFromSchematic does. */
function demoNetlist(): string {
  const doc = readSchematic(parse(read('ecc83-pp.kicad_sch')));
  const sheet = { path: '/', namePath: '/', file: 'ecc83-pp.kicad_sch', doc };
  return netlistKicad({
    sheets: [sheet],
    libsFor: () => new Map(doc.libSymbols.map((l) => [l.libId, l])),
    source: 'ecc83-pp.kicad_sch',
  });
}

describe('update PCB from schematic (ecc83 demo)', () => {
  it('renames no net, so no airwire appears over the routed copper', () => {
    const board = readBoard(parse(read('ecc83-pp.kicad_pcb')));
    expect(buildRatsnest(board)).toHaveLength(0); // the demo is fully routed

    const netlist = loadKicadNetlist(demoNetlist());

    // The board's own footprints are what the netlist names; nothing has to be
    // loaded from a library for a board that is already populated.
    const reporter = new Reporter();
    const updater = new BOARD_NETLIST_UPDATER(
      board,
      reporter,
      (fpid) => {
        const local = board.footprints.find((f) => f.lib === fpid);
        return (local as PcbFootprint | undefined) ?? null;
      },
      { isDryRun: false },
    );
    const result = updater.UpdateNetlist(netlist);

    const netChanges = reporter.lines
      .map((l) => l.message)
      .filter((m) => /^(Add net|Connect|Reconnect|Disconnect)/i.test(m));
    expect(netChanges).toEqual([]);

    expect(buildRatsnest(result.board)).toHaveLength(0);
  });

  it('names an auto-named net after a named pin, with its unit token', () => {
    const netlist = loadKicadNetlist(demoNetlist());
    const names = new Set<string>();
    for (const component of netlist.Components()) {
      for (let i = 0; i < component.GetNetCount(); i++) names.add(component.GetNetAt(i).netName);
    }

    // KiCad names these after the valve's pins, not after the passives' pads:
    // compareDrivers demotes any candidate whose name contains "-Pad", and the
    // reference carries the unit token when the name comes from a pin name.
    expect(names).toContain('Net-(U1A-K)');
    expect(names).toContain('Net-(U1A-G)');
    expect(names).toContain('Net-(U1B-K)');
    // A PWR_FLAG (reference "#FLG…") is not in the netlist, so it never names a net.
    expect([...names].filter((n) => n.includes('#'))).toEqual([]);
  });
});
