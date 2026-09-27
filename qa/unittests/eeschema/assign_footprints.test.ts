// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The two halves of CvPcb's MAIL_ASSIGN_FOOTPRINTS: `NETLIST::FormatCvpcbNetlist`
 * (common/netlist_reader/netlist.cpp:95-179) writing the payload, and
 * `SCH_EDITOR_CONTROL::AssignFootprints` (eeschema/tools/assign_footprints.cpp)
 * applying it. The expected text is the C++'s Print calls followed by hand:
 * NESTWIDTH is 2.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { COMPONENT, NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { readSchematic } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import type { Schematic } from '@ziroeda/eeschema/types.js';
import {
  assignFootprintsCommands,
  parseCvpcbNetlist,
} from '@ziroeda/eeschema/tools/assign_footprints.js';
import { refId } from '@ziroeda/eeschema/tools/hittest.js';
import { restoreSymbols } from '@ziroeda/eeschema/tools/properties.js';

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
    expect(parseCvpcbNetlist(sf.GetString())).toEqual([
      { reference: 'R1', footprint: 'A:B' },
      { reference: 'R2', footprint: '' },
    ]);
  });
});

const sym = (uuid: string, ref: string, fp: string, fpHidden: boolean, unit = 1) =>
  `(symbol (lib_id "Device:R") (at 0 0 0) (unit ${unit}) (uuid "${uuid}")
    (property "Reference" "${ref}" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "${fp}" (at 0 0 0) (effects (font (size 1.27 1.27))${fpHidden ? ' hide' : ''})))`;

const SHEET = `(kicad_sch (version 20250114) (generator "eeschema") (uuid "root")
  (paper "A4")
  (lib_symbols)
  ${sym('a1', 'R1', '', false, 1)}
  ${sym('a2', 'R1', '', false, 2)}
  ${sym('b1', 'C1', 'Old:C', true)}
  ${sym('p1', '#PWR01', '', false)}
  ${sym('d1', 'D1', 'Keep:D', true)}
)`;

function fpOf(doc: Schematic, uuid: string): { value: string; hidden: boolean } {
  const f = doc.symbols.find((s) => s.uuid === uuid)!.fields.find((x) => x.key === 'Footprint')!;
  return { value: f.value, hidden: !!f.effects?.hidden };
}

describe('SCH_EDITOR_CONTROL::AssignFootprints', () => {
  const doc = readSchematic(parse(SHEET));
  const docs = new Map([['root.kicad_sch', doc]]);
  const payload = (refs: [string, string][]) =>
    `(cvpcb_netlist\n${refs.map(([r, f]) => `  (ref "${r}" (fpid "${f}")\n  )\n`).join('')})\n`;

  it('sets every unit of a named reference, and hides a Footprint field that was empty and visible', () => {
    const cmds = assignFootprintsCommands(
      docs,
      ['root.kicad_sch'],
      payload([['R1', 'Res:R_0402']]),
    );
    const after = cmds!.get('root.kicad_sch')!.apply(doc);
    expect([fpOf(after, 'a1'), fpOf(after, 'a2')]).toEqual([
      { value: 'Res:R_0402', hidden: true },
      { value: 'Res:R_0402', hidden: true },
    ]);
  });

  it('changes an assigned footprint without touching its visibility', () => {
    const cmds = assignFootprintsCommands(docs, ['root.kicad_sch'], payload([['C1', 'New:C']]));
    const after = cmds!.get('root.kicad_sch')!.apply(doc);
    expect(fpOf(after, 'b1')).toEqual({ value: 'New:C', hidden: true });
    expect(fpOf(after, 'a1')).toEqual({ value: '', hidden: false });
  });

  it('can clear a footprint', () => {
    const cmds = assignFootprintsCommands(docs, ['root.kicad_sch'], payload([['C1', '']]));
    expect(fpOf(cmds!.get('root.kicad_sch')!.apply(doc), 'b1').value).toBe('');
  });

  it('returns nothing when no symbol changes (isChanged false)', () => {
    expect(
      assignFootprintsCommands(docs, ['root.kicad_sch'], payload([['D1', 'Keep:D']])),
    ).toBeNull();
    expect(assignFootprintsCommands(docs, ['root.kicad_sch'], payload([['X9', 'A:B']]))).toBeNull();
  });

  it('skips power symbols', () => {
    expect(
      assignFootprintsCommands(docs, ['root.kicad_sch'], payload([['#PWR01', 'A:B']])),
    ).toBeNull();
  });

  it('is undone by its inverse', () => {
    const cmd = assignFootprintsCommands(docs, ['root.kicad_sch'], payload([['R1', 'Res:R']]))!.get(
      'root.kicad_sch',
    )!;
    const after = cmd.apply(doc);
    const back = cmd.invert(doc).apply(after);
    expect([fpOf(back, 'a1'), fpOf(back, 'a2')]).toEqual([
      { value: '', hidden: false },
      { value: '', hidden: false },
    ]);
  });

  it('restoreSymbols puts the captured symbols back verbatim and leaves the rest', () => {
    const cmd = assignFootprintsCommands(
      docs,
      ['root.kicad_sch'],
      payload([
        ['R1', 'Res:R'],
        ['C1', 'X:C'],
      ]),
    )!.get('root.kicad_sch')!;
    const after = cmd.apply(doc);
    // Capture only R1's first unit: C1 and R1's second unit keep the new value.
    const i = doc.symbols.findIndex((x) => x.uuid === 'a1');
    const back = restoreSymbols(new Map([[refId('symbol', 'a1', i), doc.symbols[i]!]])).apply(
      after,
    );
    expect([fpOf(back, 'a1'), fpOf(back, 'a2').value, fpOf(back, 'b1').value]).toEqual([
      { value: '', hidden: false },
      'Res:R',
      'X:C',
    ]);
  });

  it('refuses a payload that is not a cvpcb_netlist', () => {
    expect(() =>
      assignFootprintsCommands(docs, ['root.kicad_sch'], '(export (ref "R1"))'),
    ).toThrow();
  });
});
