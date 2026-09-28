// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/netlist_reader/`: the base NETLIST/COMPONENT model
 * (`netlist.ts`), the KiCad s-expression parser (`kicad_netlist_reader.ts`) and
 * the legacy/`.cmp` reader (`netlist_reader.ts`), now that they live in
 * `common/` rather than `pcbnew/` (pcbnew re-exports them unchanged; see
 * `pcbnew/netlist_reader/pcb_netlist.ts`).
 *
 * The end-to-end case reads a real netlist `kicad-cli sch export netlist`
 * produced from a BGA test schematic (`issue24330`), so the expected values
 * below are read off the fixture's own text, not derived by calling the parser.
 * The second block exercises COMPONENT::GetNet's stacked-pin expansion
 * (`ExpandStackedPinNotation`), which the base port added over what was ported
 * to `pcbnew/` before this move.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPONENT, NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { loadKicadNetlist } from '@ziroeda/common/netlist_reader/kicad_netlist_reader.js';
import { guessNetlistFileType } from '@ziroeda/common/netlist_reader/netlist_reader.js';

const DATA = fileURLToPath(
  new URL('../../data/eeschema/netlist_oracle/issue24330/', import.meta.url),
);
const NET_TEXT = readFileSync(`${DATA}issue24330.kicad-cli.net`, 'utf8');

describe('common/netlist_reader on a real kicad-cli netlist (issue24330, a BGA stacked-pin fixture)', () => {
  it('is recognised as the KiCad s-expression dialect', () => {
    expect(guessNetlistFileType(NET_TEXT)).toBe('kicad');
  });

  it('reads both components with their libsource, value and unit pins', () => {
    const netlist = loadKicadNetlist(NET_TEXT);

    expect(netlist.GetCount()).toBe(2);

    const u1 = netlist.GetComponentByReference('U1');
    const u2 = netlist.GetComponentByReference('U2');

    expect(u1).not.toBeNull();
    expect(u2).not.toBeNull();

    expect(u1!.GetValue()).toBe('BGA_TEST');
    expect(u1!.GetLibrary()).toBe('Local');
    expect(u1!.GetName()).toBe('BGA_TEST');
    expect(u1!.kiids).toEqual(['af06e391-97a5-4828-9343-f3162acaa60a']);
    expect(u2!.kiids).toEqual(['bf06e391-97a5-4828-9343-f3162acaa60b']);

    expect(u1!.GetUnitInfo()).toEqual([{ unitName: 'A', pins: ['AAB10', 'AAB11', 'AAB12'] }]);
  });

  it('wires each of the three nets to both components, by exact pin number', () => {
    const netlist = loadKicadNetlist(NET_TEXT);
    const u1 = netlist.GetComponentByReference('U1')!;
    const u2 = netlist.GetComponentByReference('U2')!;

    expect(u1.GetNetCount()).toBe(3);
    expect(u2.GetNetCount()).toBe(3);

    for (const [pin, net, pinFunction] of [
      ['AAB10', '/NET_TOP', 'P1_AAB10'],
      ['AAB11', '/NET_MID', 'P2_AAB11'],
      ['AAB12', '/NET_BOT', 'P3_AAB12'],
    ] as const) {
      expect(u1.GetNet(pin).netName).toBe(net);
      expect(u1.GetNet(pin).pinFunction).toBe(pinFunction);
      expect(u2.GetNet(pin).netName).toBe(net);
    }
  });
});

describe('COMPONENT::GetNet stacked-pin expansion (ExpandStackedPinNotation)', () => {
  it('finds a net recorded under bracketed stacked-pin notation by one of its members', () => {
    const component = new COMPONENT('Package:BGA', 'U1', 'TEST', '/', []);
    component.AddNet('[A1,A3-A5]', 'GND', '', 'power_in');
    component.AddNet('A2', 'VCC', '', 'power_in');

    // A2 is an exact match; A1, A3, A4, A5 only match once the stack expands.
    expect(component.GetNet('A2').netName).toBe('VCC');
    expect(component.GetNet('A1').netName).toBe('GND');
    expect(component.GetNet('A4').netName).toBe('GND');
    // A6 is in neither the exact pin nor the expanded range.
    expect(component.GetNet('A6').IsValid()).toBe(false);
  });
});

describe('NETLIST group membership (a base-model addition not exercised by the pcbnew tests)', () => {
  it('resolves a member UUID to the component that carries it', () => {
    const netlist = new NETLIST();
    const component = new COMPONENT('', 'R1', '10k', '/', ['abc-123']);
    netlist.AddComponent(component);
    netlist.AddGroup({ name: 'Group1', uuid: 'grp-1', libId: '', members: ['abc-123'] });

    netlist.ApplyGroupMembership();

    expect(component.GetGroup()?.name).toBe('Group1');
  });
});
