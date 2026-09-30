// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `specctra.cpp` / `specctra.h` and the DSN lexer's Specctra mode. Expected
 * texts are written from the C++ (`Format` bodies, `DSNLEXER::NextTok`), not
 * read back from the code; whole-file agreement with KiCad is
 * `specctra_oracle.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { DSNLEXER, T } from '@ziroeda/common/dsnlexer.js';
import { OUTPUTFORMATTER, STRING_FORMATTER } from '@ziroeda/common/richio.js';
import {
  PATH,
  POINT,
  RULE,
  SPECCTRA_DB,
  SPECCTRA_KEYWORDS,
  UNIT_RES,
  VIA,
} from '@ziroeda/pcbnew/specctra_import_export/specctra.js';

const fmt = (f: (o: STRING_FORMATTER) => void): string => {
  const o = new STRING_FORMATTER('"');
  f(o);
  return o.GetString();
};

describe('OUTPUTFORMATTER::GetQuoteChar', () => {
  it.each([
    ['plain', ''],
    ['', '"'],
    ['#comment', '"'],
    ['has space', '"'],
    ['a(b', '"'],
    ['a)b', '"'],
    ['a%b', '"'],
    ['a{b', '"'],
    ['a}b', '"'],
    ['tab\there', '"'],
    ['-leading', ''],
    ['mid-dash', '"'],
  ])('%j -> %j', (s, want) => {
    expect(OUTPUTFORMATTER.GetQuoteChar(s, '"')).toBe(want);
  });

  it('StripUseless drops whitespace, parentheses and double quotes', () => {
    const f = new STRING_FORMATTER();
    f.Print(0, '(a "b" c)\n d');
    f.StripUseless();
    expect(f.GetString()).toBe('abcd');
  });
});

describe('DSNLEXER, Specctra mode', () => {
  const toks = (src: string): string[] => {
    const l = new DSNLEXER(src);
    l.SetSpecctraMode(true);
    l.SetKeywords(SPECCTRA_KEYWORDS);
    const out: string[] = [];
    for (let t = l.NextTok(); t !== T.EOF; t = l.NextTok()) out.push(`${String(t)}:${l.CurText()}`);
    return out;
  };

  it('a dash after a non-space is DASH (the pin reference "U2"-14)', () => {
    const l = new DSNLEXER('"U2"-14');
    l.SetSpecctraMode(true);
    expect(l.NextTok()).toBe(T.STRING);
    expect(l.NextTok()).toBe(T.DASH);
    expect(l.NextTok()).toBe(T.NUMBER);
  });

  it('keywords fold to their own case, other words keep theirs', () => {
    expect(toks('(PN Foo)')).toEqual([`${T.LEFT}:(`, 'pn:PN', 'Foo:Foo', `${T.RIGHT}:)`]);
  });

  it('string_quote is a token, its argument a QUOTE_DEF', () => {
    const l = new DSNLEXER('(string_quote $)');
    l.SetSpecctraMode(true);
    l.SetKeywords(SPECCTRA_KEYWORDS);
    const seen: unknown[] = [];
    for (let t = l.NextTok(); t !== T.EOF; t = l.NextTok()) seen.push(t);
    expect(seen).toEqual([T.LEFT, T.STRING_QUOTE, T.QUOTE_DEF, T.RIGHT]);
  });

  it('after SetStringDelimiter, that character quotes and " no longer does', () => {
    const l = new DSNLEXER('$a b$ "c"');
    l.SetSpecctraMode(true);
    l.SetStringDelimiter('$');
    expect(l.NextTok()).toBe(T.STRING);
    expect(l.CurText()).toBe('a b');
    expect(l.NextTok()).toBe('"c"');
  });

  it('with the delimiter `"`, spaces stay inside a quoted token in Specctra mode', () => {
    const l = new DSNLEXER('"a b"');
    l.SetSpecctraMode(true);
    expect(l.NextTok()).toBe(T.STRING);
    expect(l.CurText()).toBe('a b');
  });

  it('a delimiter that is not one of \' " $ is refused', () => {
    const l = new DSNLEXER('(string_quote x)');
    l.SetSpecctraMode(true);
    l.NextTok();
    l.NextTok();
    expect(() => l.NextTok()).toThrow(/String delimiter must be/);
  });
});

describe('Format bodies', () => {
  it('POINT: %.6g and no negative zero', () => {
    const p = new POINT(-0, 1234567.891);
    p.FixNegativeZero();
    expect(fmt((o) => p.Format(o, 0))).toBe(' 0 1.23457e+06');
  });

  it('RULE: a single rule stays on one line, several wrap', () => {
    const one = new RULE(null, 'rule');
    one.m_rules = ['(width 200)'];
    expect(fmt((o) => one.Format(o, 1))).toBe('  (rule (width 200))\n');
    const two = new RULE(null, 'rule');
    two.m_rules = ['(width 200)', '(clearance 100)'];
    expect(fmt((o) => two.Format(o, 1))).toBe(
      '  (rule\n    (width 200)\n    (clearance 100)\n  )\n',
    );
  });

  it('PATH wraps after the right margin, at nest + 1 or 6, whichever is more', () => {
    const p = new PATH(null, 'path');
    p.layer_id = 'top';
    p.aperture_width = 250;
    for (let i = 0; i < 8; ++i) p.AppendPoint(new POINT(100000 + i, -200000 - i));
    const text = fmt((o) => p.Format(o, 2));
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      '    (path top 250  100000 -200000  100001 -200001  100002 -200002  100003 -200003',
    );
    expect(lines[1]!.startsWith(' '.repeat(12))).toBe(true);
    expect(text.endsWith(')\n')).toBe(true);
  });

  it('VIA: padstacks then a (spare ...) group', () => {
    const v = new VIA(null);
    v.m_padstacks = ['Via[0-1]_600:300_um'];
    v.m_spares = ['S'];
    expect(fmt((o) => v.Format(o, 1))).toBe('  (via "Via[0-1]_600:300_um"\n    (spare S))\n');
  });

  it('a resolution prints its value, a unit does not', () => {
    const r = new UNIT_RES(null, 'resolution');
    r.units = 'um';
    r.value = 10;
    expect(fmt((o) => r.Format(o, 1))).toBe('  (resolution um 10)\n');
    const u = new UNIT_RES(null, 'unit');
    u.units = 'um';
    expect(fmt((o) => u.Format(o, 1))).toBe('  (unit um)\n');
  });
});

describe('the reader', () => {
  const load = (text: string): SPECCTRA_DB => {
    const db = new SPECCTRA_DB();
    db.LoadPCB(text);
    return db;
  };

  it('reads the pcb name and a resolution', () => {
    const db = load('(pcb x.dsn (resolution mil 100))');
    expect(db.GetPCB()!.m_pcbname).toBe('x.dsn');
    expect(db.GetPCB()!.m_resolution!.GetEngUnits()).toBe('mil');
    expect(db.GetPCB()!.m_resolution!.GetValue()).toBe(100);
  });

  it('a second boundary is the place_boundary (goto L_place)', () => {
    const db = load(
      '(pcb x (structure (boundary (rect pcb 0 0 10 10)) (boundary (rect pcb 1 1 5 5))))',
    );
    const s = db.GetPCB()!.m_structure!;
    expect(s.m_boundary!.rectangle!.GetEnd().x).toBe(10);
    expect(s.m_place_boundary!.rectangle!.GetOrigin().x).toBe(1);
  });

  it('a third boundary is refused', () => {
    expect(() =>
      load(
        '(pcb x (structure (boundary (rect pcb 0 0 1 1)) (boundary (rect pcb 0 0 1 1)) (boundary (rect pcb 0 0 1 1))))',
      ),
    ).toThrow(/boundary/);
  });

  it('a pin reference without quotes splits at the dash; quoted ones take three tokens', () => {
    const db = load('(pcb x (network (net N (pins A12-14 "U 1"-"2"))))');
    const pins = db.GetPCB()!.m_network!.m_nets[0]!.m_pins;
    expect(pins.map((p) => [p.component_id, p.pin_id])).toEqual([
      ['A12', '14'],
      ['U 1', '2'],
    ]);
  });

  it('an unknown keyword under pcb is Unexpected', () => {
    expect(() => load('(pcb x (bogus))')).toThrow(/bogus/);
  });

  it('a layer cost is a token or a positive integer stored negative', () => {
    const db = load('(pcb x (structure (layer L (type signal) (cost 3)) (layer M (cost high))))');
    const [a, b] = db.GetPCB()!.m_structure!.m_layers;
    expect(a!.cost).toBe(-3);
    expect(b!.cost).toBe('high');
  });

  it('a session id with spaces is joined, and the time is read', () => {
    const db = new SPECCTRA_DB();
    db.LoadSESSION(
      '(session my file.ses (base_design b.dsn) (history (self (created_time Sep 30 09 : 15 : 00 2026))))',
    );
    const s = db.GetSESSION()!;
    expect(s.session_id).toBe('my file.ses');
    const t = s.history!.time_stamp;
    expect([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes()]).toEqual([
      2026, 8, 30, 9, 15,
    ]);
  });
});
