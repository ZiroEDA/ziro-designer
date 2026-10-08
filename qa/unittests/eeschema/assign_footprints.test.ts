// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `NETLIST::FormatCvpcbNetlist` (common/netlist_reader/netlist.cpp:95-179), the payload CvPcb
 * mails as MAIL_ASSIGN_FOOTPRINTS; the live SCH_EDITOR_CONTROL::AssignFootprints that applies it is
 * pinned in sch_assign_footprints_live.test.ts. The expected text is the C++'s Print calls
 * followed by hand: NESTWIDTH is 2.
 */
import { describe, expect, it } from 'vitest';
import { DSNLEXER } from '@ziroeda/common/dsnlexer.js';
import { COMPONENT, NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { PTREE, Scan } from '@ziroeda/common/ptree.js';
import { STRING_FORMATTER } from '@ziroeda/common/richio.js';

describe('NETLIST::FormatCvpcbNetlist', () => {
  it('writes (ref "…" (fpid "…")) per component and nothing CTL_FOR_CVPCB omits', () => {
    const netlist = new NETLIST();
    const r1 = new COMPONENT('Resistor_SMD:R_0402', 'R1', '10k', '/', ['u1']);
    r1.AddNet('1', 'GND', '', 'passive');
    r1.SetFootprintFilters(['R_*']);
    netlist.AddComponent(r1);
    netlist.AddComponent(new COMPONENT('', 'C1', '1u', '/', ['u2']));

    const sf = new STRING_FORMATTER();
    netlist.FormatCvpcbNetlist(sf);

    expect(sf.GetString()).toBe(
      '(cvpcb_netlist\n' +
        '  (ref "R1" (fpid "Resistor_SMD:R_0402")\n' +
        '  )\n' +
        '  (ref "C1" (fpid "")\n' +
        '  )\n' +
        ')\n',
    );
  });

  it('writes the extras, filters and nets when not told to omit them', () => {
    const c = new COMPONENT('Lib:R', 'R2', '1k', '/s1/', ['k1', 'k2']);
    c.SetName('R');
    c.SetLibrary('Device');
    c.SetFields(new Map([['Datasheet', '~']]));
    c.SetProperties(new Map([['dnp', '']]));
    c.SetFootprintFilters(['R_*', 'Res*']);
    c.AddNet('1', 'N1', '', '');
    c.AddNet('2', 'N2', '', '');

    const sf = new STRING_FORMATTER();
    c.Format(sf, 1, 0);

    expect(sf.GetString()).toBe(
      '  (ref "R2" (fpid "Lib:R")\n' +
        '    (value "1k")\n' +
        '    (name "R")\n' +
        '    (library "Device")\n' +
        '    (timestamp "/s1/k1")\n' +
        '    (fields      \n(field (name "Datasheet") "~"))\n' +
        '    (property (name "dnp"))\n' +
        '    (fp_filters "R_*" "Res*")\n' +
        '    (nets (pin_net "1" "N1")(pin_net "2" "N2"))\n' +
        '  )\n',
    );
  });

  it('wraps the nets once a line passes 80 characters', () => {
    const c = new COMPONENT('L:F', 'U1', 'v', '/', []);
    for (let i = 0; i < 6; ++i) c.AddNet(String(i), `NET_NAME_${i}`, '', '');
    const sf = new STRING_FORMATTER();
    c.Format(sf, 0, 0x1 /* CTL_OMIT_EXTRA */);
    const lines = sf.GetString().split('\n');
    // "  (nets " is 8, each pin_net here is 25: 8+25+25+25 = 83 > 80 breaks
    // before the fourth.
    expect(lines[1]).toBe(
      '  (nets (pin_net "0" "NET_NAME_0")(pin_net "1" "NET_NAME_1")(pin_net "2" "NET_NAME_2")',
    );
    expect(lines[2]).toBe(
      '    (pin_net "3" "NET_NAME_3")(pin_net "4" "NET_NAME_4")(pin_net "5" "NET_NAME_5"))',
    );
  });

  it('appends the first KIID to the timestamp unless CTL_OMIT_FP_UUID', () => {
    const one = new COMPONENT('L:F', 'R3', 'v', '/', ['only']);
    const root = new COMPONENT('L:F', 'R4', 'v', '/', []);
    const text = (c: COMPONENT, ctl: number) => {
      const sf = new STRING_FORMATTER();
      c.Format(sf, 0, ctl);
      return sf.GetString().split('\n')[4];
    };
    expect(text(one, 0)).toBe('  (timestamp "/only")');
    expect(text(one, 0x8 /* CTL_OMIT_FP_UUID */)).toBe('  (timestamp "")');
    expect(text(root, 0)).toBe('  (timestamp "")');
  });

  it("counts the nest indent into the wrap length, as Print's return value does", () => {
    // Each pin_net is 16 + 21 = 37 characters. With "  (nets " counted as 8,
    // two of them reach 82 and the third wraps; counting only "(nets " (6)
    // would reach 80, which is not past 80, and keep it on the line.
    const c = new COMPONENT('L:F', 'U2', 'v', '/', []);
    for (let i = 0; i < 3; ++i)
      c.AddNet(String(i), `N${i}_23456789012345678901`.slice(0, 21), '', '');
    const sf = new STRING_FORMATTER();
    c.Format(sf, 0, 0x1 /* CTL_OMIT_EXTRA */);
    const lines = sf.GetString().split('\n');
    expect(lines[1]!.length).toBe(8 + 37 + 37);
    expect(lines[2]!.startsWith('    (pin_net "2"')).toBe(true);
  });

  it('round-trips through the schematic side of the mail', () => {
    const netlist = new NETLIST();
    netlist.AddComponent(new COMPONENT('A:B', 'R1', '', '/', []));
    netlist.AddComponent(new COMPONENT('', 'R2', '', '/', []));
    const sf = new STRING_FORMATTER();
    netlist.FormatCvpcbNetlist(sf);
    // Read back the way SCH_EDITOR_CONTROL::AssignFootprints reads it.
    const doc = new PTREE();
    Scan(doc, new DSNLEXER(sf.GetString()));
    const refs = [...doc.get_child('cvpcb_netlist')].map(([, t]) => [
      t.front()[0],
      t.get_child('fpid').size() ? t.get_child('fpid').front()[0] : '',
    ]);
    expect(refs).toEqual([
      ['R1', 'A:B'],
      ['R2', ''],
    ]);
  });
});
