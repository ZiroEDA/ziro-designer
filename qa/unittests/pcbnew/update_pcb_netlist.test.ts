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
import { runLiveUpdate } from './support/netlist_update_harness.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { exportKicadNetlist } from '@ziroeda/eeschema/cross-probing.js';
import { loadKicadNetlist, readBoard } from '@ziroeda/pcbnew';

const DEMO = fileURLToPath(new URL('../../../designer/public/demos/ecc83/', import.meta.url));
const read = (name: string): string => readFileSync(DEMO + name, 'utf8');

/** The demo's netlist, exported the way PCB_EDIT_FRAME::FetchNetlistFromSchematic does. */
function demoNetlist(): string {
  const files = ['ecc83-pp.kicad_sch', 'ecc83-pp.kicad_pro'].map((name) => ({
    name,
    text: read(name),
  }));
  const r = exportKicadNetlist(files, 'ecc83-pp.kicad_sch', 'ecc83-pp');
  if (!r.ok) throw new Error(r.error);
  return r.netlistText;
}

describe('update PCB from schematic (ecc83 demo)', () => {
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
