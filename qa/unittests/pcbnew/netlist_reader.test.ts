// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Import Netlist's reader: dialect sniffing, the legacy/OrcadPCB2 line format
 * and the CvPcb `.cmp` footprint links.
 *
 * The end-to-end case reads `interf_u.net` and `interf_u.cmp` verbatim from
 * KiCad's own legacy demo, so the fixtures carry the exporter's real quirks —
 * `$noname` placeholders, double-spaced columns, a one-space indent on every
 * footprint filter, and a second `{ … }` comment block after the filters. The
 * hand-written fixtures then pin the malformed-input rules that a well-formed
 * file can never reach.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NETLIST,
  NetlistParseError,
  guessNetlistFileType,
  loadCmpFootprintLinks,
  loadLegacyNetlist,
  loadNetlist,
} from '@ziroeda/pcbnew';

const DATA = fileURLToPath(new URL('../../data/', import.meta.url));
const read = (name: string): string => readFileSync(DATA + name, 'utf8');

/** The pin-number -> net-name pairs of one component, in the order they were read. */
function pinsOf(netlist: NETLIST, reference: string): [string, string][] {
  const component = netlist.GetComponentByReference(reference);
  if (!component) throw new Error(`no component ${reference}`);
  const out: [string, string][] = [];
  for (let i = 0; i < component.GetNetCount(); i++) {
    const net = component.GetNetAt(i);
    out.push([net.pinName, net.netName]);
  }
  return out;
}

describe('netlist dialect detection', () => {
  it('recognises the legacy header wherever it appears in the file', () => {
    // GuessNetlistFileType reads until a line matches rather than testing only
    // the first line; if it stopped at line one, a file with a leading blank or
    // a BOM-ish preamble would be rejected as "not a netlist".
    expect(guessNetlistFileType('\n\n# EESchema Netlist Version 1.1 created x\n(\n')).toBe(
      'legacy',
    );
  });

  it('recognises the s-expression export and the OrcadPCB2 opener', () => {
    // These are the other two live formats; misfiling one sends the file to a
    // reader that will throw on its very first line.
    expect(guessNetlistFileType('(export (version "E")\n')).toBe('kicad');
    expect(guessNetlistFileType('( { Netlist created by SomeTool }\n')).toBe('orcad');
  });

  it('returns unknown, and loadNetlist returns null, for anything else', () => {
    // NETLIST_READER::GetNetlistReader hands back a null reader here, which the
    // dialog turns into "not a valid netlist file" instead of importing rubbish.
    expect(guessNetlistFileType('*PADS-PCB*\n*PART*\nR1 unknown\n')).toBe('unknown');
    expect(loadNetlist('*PADS-PCB*\n')).toBeNull();
  });

  it('prefers the legacy header over a stray (export on the same line', () => {
    // The three patterns are tested in a fixed order and legacy is first; a
    // legacy file whose comment mentions "(export" must still read as legacy.
    expect(guessNetlistFileType('# EESchema Netlist (export\n')).toBe('legacy');
  });
});

describe("the legacy reader on KiCad's own interf_u demo", () => {
  const result = loadNetlist(read('interf_u.net'), { cmpText: read('interf_u.cmp') });

  it('reads every component, in file order', () => {
    // The nesting counter is driven by the first character of each line only.
    // Miscount it and components either vanish or pin lines get read as
    // component headers, which throws.
    expect(result).not.toBeNull();
    expect(result!.type).toBe('legacy');
    expect(result!.netlist.GetCount()).toBe(24);
    expect(
      result!.netlist
        .Components()
        .map((c) => c.GetReference())
        .slice(0, 4),
    ).toEqual(['JP1', 'RR1', 'P1', 'R3']);
  });

  it('splits the component line into path, footprint, reference, value and {Lib=…}', () => {
    // `( /32568D1E $noname  JP1 CONN_8X2 {Lib=CONN_8X2}` — two spaces after
    // $noname, so a naive single-space split shifts every field along by one.
    const jp1 = result!.netlist.GetComponentByReference('JP1')!;
    expect(jp1.path).toBe('/00000000-0000-0000-0000-000032568d1e');
    expect(jp1.GetValue()).toBe('CONN_8X2');
    expect(jp1.GetName()).toBe('CONN_8X2');
  });

  it('reads each component pin line as pin number then net name, in order', () => {
    // The pin lines are the payload of the whole file; losing their order would
    // not be visible in a set comparison but changes every ratsnest downstream.
    expect(pinsOf(result!.netlist, 'JP1').slice(0, 4)).toEqual([
      ['1', 'GND'],
      ['2', '/REF10'],
      ['3', 'GND'],
      ['4', '/REF11'],
    ]);
    expect(pinsOf(result!.netlist, 'JP1')).toHaveLength(16);
  });

  it('turns $noname into no footprint and lets the .cmp file supply one', () => {
    // Every component in a legacy netlist is $noname: the schematic never knew
    // the footprint, CvPcb did. If $noname survived as a literal FPID the board
    // updater would go looking for a footprint called "$noname".
    const jp1 = result!.netlist.GetComponentByReference('JP1')!;
    expect(jp1.GetFPID()).toBe('pin_array_8x2');
    expect(jp1.GetAltFPID()).toBe('');
    expect(result!.allLinksFound).toBe(true);
  });

  it('reads the footprint filter block, one space of indent removed', () => {
    // `loadFootprintFilters` drops the first character of every filter line. On
    // the exporter's one-space indent that is exactly right; asserting the
    // trimmed value here is what proves the indent is not being eaten twice.
    expect(result!.netlist.GetComponentByReference('P1')!.GetFootprintFilters()).toEqual(['DB25*']);
    expect(result!.netlist.GetComponentByReference('R3')!.GetFootprintFilters()).toEqual([
      'R?',
      'SM0603',
      'SM0805',
    ]);
  });

  it('treats the trailing "{ Pin List by Nets" block as a comment', () => {
    // That block repeats every connection in a different syntax. Reading it as
    // data would double every net; the comment state machine must swallow all
    // 400-odd lines of it and stop at the lone closing brace.
    expect(pinsOf(result!.netlist, 'JP1')).toHaveLength(16);
    expect(result!.netlist.GetCount()).toBe(24);
  });
});

describe('the legacy footprint filter block', () => {
  const withFilters = [
    '# EESchema Netlist Version 1.1 created x',
    '(',
    ' ( /aaa $noname R1 1k {Lib=R}',
    '  (    1 VCC )',
    ' )',
    ')',
    '{ Allowed footprints by component:',
    '$component R1',
    ' R?',
    'SM0805',
    '$endlist',
    '$endanything',
    '$component BUS1',
    ' DB25*',
    '$endlist',
    '}',
    '#End',
    '',
  ].join('\n');

  it('is skipped entirely when the caller turns filters off', () => {
    // m_loadFootprintFilters defaults to true, so this branch is only ever
    // reached by a caller that says no (CvPcb reads the filters, the board
    // updater does not). With it off the block is a plain comment.
    const netlist = new NETLIST();
    loadLegacyNetlist(withFilters, netlist, { loadFootprintFilters: false });
    expect(netlist.GetComponentByReference('R1')!.GetFootprintFilters()).toEqual([]);
    expect(netlist.GetCount()).toBe(1);
  });

  it('drops the first character of a filter that is not indented', () => {
    // `line + 1` is unconditional upstream. "SM0805" written flush left comes
    // back as "M0805" — a genuine upstream bug, reproduced so that a file KiCad
    // filters wrongly is filtered wrongly here too rather than differently.
    const netlist = new NETLIST();
    loadLegacyNetlist(withFilters, netlist);
    expect(netlist.GetComponentByReference('R1')!.GetFootprintFilters()).toEqual(['R?', 'M0805']);
  });

  it('ends the section at any $end… line, not just $endfootprintlist', () => {
    // strncasecmp compares four characters. `$endanything` therefore closes the
    // section and everything after it — including a perfectly good BUS1 entry —
    // is swallowed as comment text. Comparing the full token would assign BUS1
    // the filters that follow it.
    const netlist = new NETLIST();
    loadLegacyNetlist(withFilters, netlist);
    expect(netlist.GetComponentByReference('R1')).not.toBeNull();
    expect(netlist.GetComponentByReference('BUS1')).toBeNull();
  });

  it('refuses a filter list naming a component the netlist does not have', () => {
    // Cannot happen in a file the exporter wrote, so upstream throws rather
    // than guessing; a silent skip would hide a truncated netlist.
    const netlist = new NETLIST();
    const text = [
      '# EESchema Netlist Version 1.1 created x',
      '(',
      ')',
      '{ Allowed footprints by component:',
      '$component NOPE',
      ' R?',
      '$endlist',
      '}',
      '',
    ].join('\n');
    expect(() => loadLegacyNetlist(text, netlist)).toThrow(NetlistParseError);
  });
});

describe('legacy reader edge cases', () => {
  const wrap = (...body: string[]): string =>
    ['# EESchema Netlist Version 1.1 created x', '(', ...body, ')', '#End', ''].join('\n');

  it('reads ? in the net name position as "not connected"', () => {
    // The exporter writes `?` for an unconnected pin. Kept literally it would
    // become a net actually called "?" and short every unconnected pad on the
    // board together.
    const netlist = new NETLIST();
    loadLegacyNetlist(
      wrap(' ( /aaa $noname R1 1k {Lib=R}', '  (    1 VCC )', '  (    2 ? )', ' )'),
      netlist,
    );
    expect(pinsOf(netlist, 'R1')).toEqual([
      ['1', 'VCC'],
      ['2', ''],
    ]);
  });

  it('expands each step of the time stamp path into the UUID it stands for', () => {
    // The board stores `(path "/uuid")` in canonical form, and the updater
    // matches a component to a footprint by comparing those strings. Left as the
    // file's own text, a legacy path would never match anything and every import
    // would place a second copy of every footprint. A path already written as a
    // UUID is only lower-cased, and a nested path keeps its steps in order.
    const netlist = new NETLIST();
    loadLegacyNetlist(
      wrap(
        ' ( /32568D1E/AA45 $noname R1 1k {Lib=R}',
        ' )',
        ' ( /68183921-93A5-49AC-91B0-49D05A0E1647 $noname R2 2k {Lib=R}',
        ' )',
      ),
      netlist,
    );
    expect(netlist.GetComponentByReference('R1')!.path).toBe(
      '/00000000-0000-0000-0000-000032568d1e/00000000-0000-0000-0000-00000000aa45',
    );
    expect(netlist.GetComponentByReference('R2')!.path).toBe(
      '/68183921-93a5-49ac-91b0-49d05a0e1647',
    );
  });

  it('gives an unreadable time stamp a fresh random UUID every read', () => {
    // KIID's string constructor falls back to a random UUID when it can parse
    // neither shape, so the same file read twice disagrees with itself. That is
    // upstream's answer to "this identifier is not an identifier"; substituting a
    // stable hash would make such a component matchable when upstream cannot
    // match it.
    const text = wrap(' ( /not-a-timestamp $noname R1 1k {Lib=R}', ' )');
    const first = new NETLIST();
    const second = new NETLIST();
    loadLegacyNetlist(text, first);
    loadLegacyNetlist(text, second);
    const path = first.GetComponentByReference('R1')!.path;
    expect(path).toMatch(/^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(second.GetComponentByReference('R1')!.path).not.toBe(path);
  });

  it('keeps both components when a reference designator repeats', () => {
    // Upstream never checks for duplicates on the way in. Both are added and
    // every later lookup by reference resolves to the first, which is what the
    // .cmp assignment below depends on.
    const netlist = new NETLIST();
    loadLegacyNetlist(
      wrap(
        ' ( /aaa $noname R1 1k {Lib=R}',
        '  (    1 VCC )',
        ' )',
        ' ( /bbb $noname R1 2k {Lib=R}',
        '  (    1 GND )',
        ' )',
      ),
      netlist,
    );
    expect(netlist.GetCount()).toBe(2);
    expect(netlist.GetComponentByReference('R1')!.GetValue()).toBe('1k');
    expect(netlist.GetComponent(1)!.GetValue()).toBe('2k');
  });

  it('throws when a component line is missing one of its four required words', () => {
    // Path, footprint, reference and value are all mandatory; a short line means
    // the file is truncated or in another dialect, and reading on would attach
    // pins to the wrong component.
    const netlist = new NETLIST();
    expect(() => loadLegacyNetlist(wrap(' ( /aaa $noname R1', ' )'), netlist)).toThrow(
      /Cannot parse value/,
    );
  });

  it('throws when a pin line has no net name', () => {
    // A pin with a number and nothing else cannot be turned into a connection,
    // and silently dropping it would quietly disconnect a pad.
    const netlist = new NETLIST();
    expect(() =>
      loadLegacyNetlist(wrap(' ( /aaa $noname R1 1k {Lib=R}', '  (    1 )', ' )'), netlist),
    ).toThrow(/Cannot parse net name/);
  });

  it('leaves the name empty when the {Lib=…} comment is malformed', () => {
    // AfterFirst/BeforeLast both return empty when their character is missing,
    // so a half-written comment yields no library part name rather than a
    // fragment that would never match a libpart.
    const netlist = new NETLIST();
    loadLegacyNetlist(wrap(' ( /aaa $noname R1 1k {Lib=R', ' )'), netlist);
    expect(netlist.GetComponentByReference('R1')!.GetName()).toBe('');
  });

  it('swallows the rest of the file after a comment that opens and closes on one line', () => {
    // LoadNetlist sets is_comment and never clears it on the single-line path,
    // so everything up to the next `}` is lost. R1 disappears and only R2, after
    // the lone brace, survives. This is upstream's behaviour, bug and all.
    const netlist = new NETLIST();
    loadLegacyNetlist(
      wrap(
        '{ generated by something }',
        ' ( /aaa $noname R1 1k {Lib=R}',
        '}',
        ' ( /bbb $noname R2 2k {Lib=R}',
        '  (    1 VCC )',
        ' )',
      ),
      netlist,
    );
    expect(netlist.Components().map((c) => c.GetReference())).toEqual(['R2']);
  });
});

describe('the CvPcb .cmp footprint link file', () => {
  /** Two components, the first already carrying a footprint from the netlist. */
  const seeded = (): NETLIST => {
    const netlist = new NETLIST();
    loadLegacyNetlist(
      [
        '# EESchema Netlist Version 1.1 created x',
        '(',
        ' ( /aaa NetlistFP R1 1k {Lib=R}',
        ' )',
        ' ( /bbb $noname C1 1uF {Lib=C}',
        ' )',
        ')',
        '',
      ].join('\n'),
      netlist,
    );
    return netlist;
  };

  it('assigns IdModule and parks the netlist footprint as the alternate', () => {
    // CvPcb shows the user both when they disagree, so the netlist value has to
    // survive; overwriting it outright loses the fact that they ever differed.
    const netlist = seeded();
    const ok = loadCmpFootprintLinks(
      ['BeginCmp', 'Reference = R1;', 'IdModule  = R_0805;', 'EndCmp', ''].join('\n'),
      netlist,
    );
    const r1 = netlist.GetComponentByReference('R1')!;
    expect(ok).toBe(true);
    expect(r1.GetFPID()).toBe('R_0805');
    expect(r1.GetAltFPID()).toBe('NetlistFP');
  });

  it('leaves the alternate empty when the two agree', () => {
    // No disagreement, nothing to ask the user about.
    const netlist = seeded();
    loadCmpFootprintLinks(
      ['BeginCmp', 'Reference = R1;', 'IdModule  = NetlistFP;', 'EndCmp', ''].join('\n'),
      netlist,
    );
    expect(netlist.GetComponentByReference('R1')!.GetAltFPID()).toBe('');
  });

  it('clears the footprint when the entry has no IdModule line', () => {
    // SetFPID runs unconditionally with whatever was parsed, so an entry that
    // names no module un-assigns the component. Skipping the write instead would
    // make a .cmp file unable to express "I removed this assignment".
    const netlist = seeded();
    loadCmpFootprintLinks(['BeginCmp', 'Reference = R1;', 'EndCmp', ''].join('\n'), netlist);
    expect(netlist.GetComponentByReference('R1')!.GetFPID()).toBe('');
  });

  it('only matches IdModule with the two spaces CvPcb writes', () => {
    // The prefix compared is "IdModule  =". A hand-tidied single space silently
    // assigns nothing, which is exactly how upstream behaves.
    const netlist = seeded();
    loadCmpFootprintLinks(
      ['BeginCmp', 'Reference = C1;', 'IdModule = C_0603;', 'EndCmp', ''].join('\n'),
      netlist,
    );
    expect(netlist.GetComponentByReference('C1')!.GetFPID()).toBe('');
  });

  it('reports, but does not refuse, a reference the netlist no longer has', () => {
    // Deleting a symbol from the schematic leaves its entry behind in the .cmp
    // file. That is normal, so the read completes and only the return value
    // records it — throwing here would block a routine import.
    const netlist = seeded();
    const ok = loadCmpFootprintLinks(
      [
        'BeginCmp',
        'Reference = GONE;',
        'IdModule  = X;',
        'EndCmp',
        'BeginCmp',
        'Reference = C1;',
        'IdModule  = C_0603;',
        'EndCmp',
        '',
      ].join('\n'),
      netlist,
    );
    expect(ok).toBe(false);
    expect(netlist.GetComponentByReference('C1')!.GetFPID()).toBe('C_0603');
  });

  it('assigns a duplicated reference to the first component only', () => {
    // GetComponentByReference stops at the first match, so the second R1 keeps
    // whatever the netlist gave it. Documenting the rule matters: a designer
    // with a duplicate refdes gets one footprint assigned, not two.
    const netlist = new NETLIST();
    loadLegacyNetlist(
      [
        '# EESchema Netlist Version 1.1 created x',
        '(',
        ' ( /aaa $noname R1 1k {Lib=R}',
        ' )',
        ' ( /bbb $noname R1 2k {Lib=R}',
        ' )',
        ')',
        '',
      ].join('\n'),
      netlist,
    );
    loadCmpFootprintLinks(
      ['BeginCmp', 'Reference = R1;', 'IdModule  = R_0805;', 'EndCmp', ''].join('\n'),
      netlist,
    );
    expect(netlist.GetComponent(0)!.GetFPID()).toBe('R_0805');
    expect(netlist.GetComponent(1)!.GetFPID()).toBe('');
  });
});

describe('the s-expression path through loadNetlist', () => {
  const sexpr = [
    '(export (version "E")',
    '  (components',
    '    (comp (ref "R1") (value "10K") (footprint "Resistor_SMD:R_0805"))',
    '    (comp (ref "R2") (value "1K")))',
    '  (nets',
    '    (net (code "1") (name "GND")',
    '      (node (ref "R1") (pin "2"))',
    '      (node (ref "R9") (pin "1")))',
    '    (net (code "2") (name "")',
    '      (node (ref "R1") (pin "1")))))',
    '',
  ].join('\n');

  it('skips a node naming a component that is not in the netlist', () => {
    // A DNP or "exclude from board" symbol still appears in the nets section.
    // Throwing on it would make every board with a DNP part unimportable.
    const result = loadNetlist(sexpr)!;
    expect(result.type).toBe('kicad');
    expect(result.netlist.GetComponentByReference('R9')).toBeNull();
    expect(pinsOf(result.netlist, 'R1')).toEqual([
      ['2', 'GND'],
      ['1', 'N-000002'],
    ]);
  });

  it('leaves the pins in file order when no .cmp file is supplied', () => {
    // SortPins runs only on the footprint-link path upstream. Sorting always
    // would silently change the pin order every other test above relies on.
    expect(pinsOf(loadNetlist(sexpr)!.netlist, 'R1').map((p) => p[0])).toEqual(['2', '1']);
  });

  it('sorts the pins by pin name once the .cmp file has been applied', () => {
    // Upstream sorts here so an s-expression dump lines up with a legacy dump.
    // The .cmp footprint wins the primary slot; the netlist's moves to the
    // alternate, exactly as on the legacy path.
    const result = loadNetlist(sexpr, {
      cmpText: ['BeginCmp', 'Reference = R1;', 'IdModule  = R_0603;', 'EndCmp', ''].join('\n'),
    })!;
    expect(pinsOf(result.netlist, 'R1').map((p) => p[0])).toEqual(['1', '2']);
    expect(result.netlist.GetComponentByReference('R1')!.GetFPID()).toBe('R_0603');
    expect(result.netlist.GetComponentByReference('R1')!.GetAltFPID()).toBe('Resistor_SMD:R_0805');
  });
});
