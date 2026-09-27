// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The writing half of `common/gbr_metadata.ts` against KiCad's own
 * `common/gbr_metadata.cpp`: `qa/probes/gbr_metadata_probe.cpp` links that
 * file, feeds it the inputs below, and printed `gbr_metadata_oracle.txt`.
 * This file replays the same inputs, in the same order, and must print the
 * same lines.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ConvertNotAllowedCharsInGerber,
  FormatNetAttribute,
  FormatStringToGerber,
  GBR_APERTURE_ATTRIB,
  GBR_APERTURE_METADATA,
  GBR_METADATA,
  GBR_NC_STRING_FORMAT,
  GbrMakeCreationDateAttributeString,
  GbrMakeProjectGUIDfromString,
} from '@ziroeda/common/gbr_metadata.js';
import {
  GBR_CMP_PNP_METADATA,
  GBR_DATA_FIELD,
  GBR_NETLIST_METADATA,
  MOUNT_TYPE,
} from '@ziroeda/common/gbr_netlist_metadata.js';

const ORACLE = readFileSync(
  fileURLToPath(new URL('./gbr_metadata_oracle.txt', import.meta.url)),
  'utf8',
)
  .split('\n')
  .filter((l) => l !== '' && !l.startsWith('#'));

/** The probe's `show`: "tag|text|", line breaks as "\n". */
const show = (aTag: string, aText: string): string => `${aTag}|${aText.replaceAll('\n', '\\n')}|`;

/** The probe's `time()`: 2026-09-28T06:05:04Z. */
const NOW = new Date(1790575504 * 1000);

describe('GbrMakeCreationDateAttributeString', () => {
  const savedTz = process.env.TZ;
  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it.each(['Asia/Kolkata', 'UTC', 'America/St_Johns'])('in %s', (tz) => {
    process.env.TZ = tz;
    const F = GBR_NC_STRING_FORMAT;
    const got = [
      show('date.x1', GbrMakeCreationDateAttributeString(F.GBR_NC_STRING_FORMAT_X1, NOW)),
      show('date.x2', GbrMakeCreationDateAttributeString(F.GBR_NC_STRING_FORMAT_X2, NOW)),
      show('date.job', GbrMakeCreationDateAttributeString(F.GBR_NC_STRING_FORMAT_GBRJOB, NOW)),
      show('date.drill', GbrMakeCreationDateAttributeString(F.GBR_NC_STRING_FORMAT_NCDRILL, NOW)),
    ].map((l) => `${tz} ${l}`);

    expect(got).toEqual(ORACLE.filter((l) => l.startsWith(`${tz} `)));
  });
});

/** Every line the probe prints after the dates, from our port. */
function replay(): string[] {
  const out: string[] = [];

  for (const name of [
    'pic_programmer.kicad_pcb',
    'a.kicad_pcb',
    '',
    'ÿé.kicad_pcb',
    '0123456789abcdefghij',
  ])
    out.push(show('guid', GbrMakeProjectGUIDfromString(name)));

  for (const s of ['R1', 'a,b*c%d\\e', 'q"x', 'µΩ€', '"quoted,*"', '', '\u{1F600}']) {
    out.push(show('conv.ff', ConvertNotAllowedCharsInGerber(s, false, false)));
    out.push(show('conv.tf', ConvertNotAllowedCharsInGerber(s, true, false)));
    out.push(show('conv.ft', ConvertNotAllowedCharsInGerber(s, false, true)));
    out.push(show('conv.tt', ConvertNotAllowedCharsInGerber(s, true, true)));
    out.push(show('to', FormatStringToGerber(s)));
  }

  const field = new GBR_DATA_FIELD();
  field.SetField('Ωa,"b', true, true);
  out.push(show('field.tt', field.GetGerberString()));
  field.SetField('Ωa,"b', false, false);
  out.push(show('field.ff', field.GetGerberString()));

  const last = { value: '' };
  const N = GBR_NETLIST_METADATA;
  const net = (
    aTag: string,
    aType: number,
    aCmp: string,
    aPad: string,
    aFunc: string,
    aNet: string,
    aNotInNet: boolean,
    aKeep: boolean,
    aX1: boolean,
  ): void => {
    const d = new GBR_NETLIST_METADATA();
    d.m_NetAttribType = aType;
    d.m_Cmpref = aCmp;
    d.m_Padname.SetField(aPad, false, false);
    d.m_PadPinFunction.SetField(aFunc, true, true);
    d.m_Netname = aNet;
    d.m_NotInNet = aNotInNet;
    d.m_TryKeepPreviousAttributes = aKeep;
    const printed = { value: '<untouched>' };
    const clear = { value: true };
    const ok = FormatNetAttribute(printed, last, d, clear, aX1);
    out.push(
      `${aTag} ok=${ok ? 1 : 0} clear=${clear.value ? 1 : 0} ${show('printed', printed.value)}`,
    );
    out.push(show('last', last.value));
  };

  const PN = N.GBR_NETINFO_PAD | N.GBR_NETINFO_NET;
  const NC = N.GBR_NETINFO_NET | N.GBR_NETINFO_CMP;
  net('n1', PN, 'R5', '3', 'reset', 'Clk3', false, false, false);
  net('n2', PN, 'R5', '3', 'reset', 'Clk3', false, false, false);
  net('n3', PN, 'R5', '4', '', 'Clk3', false, false, false);
  net('n4', N.GBR_NETINFO_NET, '', '', '', 'GND', false, false, false);
  net('n5', NC, 'U1', '', '', '', false, false, false);
  net('n6', NC, 'U1', '', '', '', true, false, false);
  net('n7', N.GBR_NETINFO_NET, '', '', '', 'V,*%', false, true, false);
  net('n8', PN, 'J1', '', '', 'A', false, true, false);
  net('n9', N.GBR_NETINFO_CMP, 'J1', '', '', '', false, true, false);
  net('n10', N.GBR_NETINFO_NET, '', '', '', 'B', false, true, false);
  net('n11', N.GBR_NETINFO_PAD, 'J2', '1', '', '', false, true, true);
  net('n12', N.GBR_NETINFO_UNSPECIFIED, '', '', '', '', false, false, false);
  net('n13', PN | N.GBR_NETINFO_CMP, 'R7', '2', '', 'X', false, false, false);
  net('n14', PN, 'R7', '2', '', 'Y', false, false, false);
  net('n15', N.GBR_NETINFO_NET, '', '', '', 'Y', false, false, false);
  net('n16', N.GBR_NETINFO_CMP, 'U2', '', '', '', false, true, false);
  net('n17', N.GBR_NETINFO_PAD, 'U2', '1', '', '', false, true, false);

  const pnp = new GBR_CMP_PNP_METADATA();
  out.push(show('pnp.empty', pnp.FormatCmpPnPMetadata()));
  pnp.m_Manufacturer = 'TI';
  pnp.m_MPN = 'LM358';
  pnp.m_Package = 'SOIC-8';
  pnp.m_Footprint = 'SOIC-8_3.9x4.9mm';
  pnp.m_Value = 'LM358';
  pnp.m_LibraryName = 'Package_SO';
  pnp.m_LibraryDescr = 'SOIC, 8 Pin';
  pnp.m_MountType = MOUNT_TYPE.MOUNT_TYPE_SMD;
  pnp.m_Orientation = 90.0;
  out.push(show('pnp.full', pnp.FormatCmpPnPMetadata()));
  pnp.m_Orientation = -45.123456789;
  pnp.m_MountType = MOUNT_TYPE.MOUNT_TYPE_TH;
  pnp.ClearData();
  out.push(show('pnp.cleared', pnp.FormatCmpPnPMetadata()));
  pnp.m_Orientation = 0.0000123;
  out.push(show('pnp.small', pnp.FormatCmpPnPMetadata()));
  pnp.m_Orientation = 179.99999999;
  out.push(show('pnp.round', pnp.FormatCmpPnPMetadata()));

  for (
    let a = GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_NONE;
    a <= GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_END;
    ++a
  ) {
    out.push(show('ap.x2', GBR_APERTURE_METADATA.FormatAttribute(a, false, 'Custom,1')));
    out.push(show('ap.x1', GBR_APERTURE_METADATA.FormatAttribute(a, true, 'Custom,1')));
  }

  return out;
}

describe('gbr_metadata.cpp, line for line', () => {
  const ours = replay();
  const theirs = ORACLE.filter((l) => !/^\S+ date\./.test(l));

  // The probe prints the apertures first; the order of groups is the only
  // thing that differs, so compare each group in its own order.
  const group = (aLines: string[], aPrefix: RegExp): string[] =>
    aLines.filter((l) => aPrefix.test(l));

  it.each([
    ['the project GUID', /^guid\|/],
    ['the escaping', /^(conv\.|to\|)/],
    ['GBR_DATA_FIELD::GetGerberString', /^field\./],
    ['FormatNetAttribute, over a run of objects', /^(n\d+ |last\|)/],
    ['GBR_CMP_PNP_METADATA', /^pnp\./],
    ['GBR_APERTURE_METADATA::FormatAttribute, every attribute', /^ap\./],
  ])('%s', (_name, prefix) => {
    const want = group(theirs, prefix);
    expect(want.length).toBeGreaterThan(0);
    expect(group(ours, prefix)).toEqual(want);
  });

  it('replays every line the probe printed', () => {
    expect([...ours].sort()).toEqual([...theirs].sort());
  });
});

describe('GBR_METADATA', () => {
  it('takes a custom aperture attribute as OTHER', () => {
    const m = new GBR_METADATA();
    m.SetApertureAttrib(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_VIAPAD);
    expect(m.m_ApertureMetadata.FormatAttribute(false)).toBe('%TA.AperFunction,ViaPad*%\n');

    m.SetApertureAttrib('Tooling');
    expect(m.GetApertureAttrib()).toBe(GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_OTHER);
    expect(m.m_ApertureMetadata.FormatAttribute(true)).toBe(
      'G04 #@! TA.AperFunction,Other,Tooling*\n',
    );
  });

  it('fills the netlist metadata', () => {
    const m = new GBR_METADATA();
    m.SetNetAttribType(GBR_NETLIST_METADATA.GBR_NETINFO_PAD);
    m.SetCmpReference('R5');
    m.SetPadName('3');
    m.SetPadPinFunction('reset', true, true);
    const printed = { value: '' };
    FormatNetAttribute(printed, { value: '' }, m.m_NetlistMetadata, { value: false }, false);
    expect(printed.value).toBe('%TO.P,R5,3,"reset"*%\n');
    expect(m.GetNetAttribType()).toBe(GBR_NETLIST_METADATA.GBR_NETINFO_PAD);
  });
});
