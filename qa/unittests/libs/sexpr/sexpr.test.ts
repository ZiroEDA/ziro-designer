// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize, tokenize, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../data/${name}`, import.meta.url)), 'utf8');

describe('tokenizer', () => {
  it('splits parens, atoms, and strings', () => {
    const toks = tokenize('(at 0 -1.27 "hi")');
    expect(toks.map((t) => t.type)).toEqual(['lparen', 'atom', 'atom', 'atom', 'string', 'rparen']);
    expect(toks.map((t) => t.value)).toEqual(['(', 'at', '0', '-1.27', 'hi', ')']);
  });

  it('decodes escapes in strings', () => {
    const toks = tokenize('"a\\"b\\\\c\\nd"');
    expect(toks[0]!.value).toBe('a"b\\c\nd');
  });

  it('throws on an unterminated string', () => {
    expect(() => tokenize('"oops')).toThrow(/Unterminated string/);
  });
});

describe('parser', () => {
  it('preserves the bare-atom vs quoted-string distinction', () => {
    // `1` (a pin number written bare) and `"1"` (a quoted string) must not collapse.
    const root = parse('(pin 1 "1")');
    expect(root.items[1]).toEqual({ kind: 'atom', value: '1' });
    expect(root.items[2]).toEqual({ kind: 'string', value: '1' });
  });

  it('keeps numeric atoms as exact source text', () => {
    const root = parse('(at 161.29 109.22 180)');
    expect(root.items.slice(1)).toEqual([
      { kind: 'atom', value: '161.29' },
      { kind: 'atom', value: '109.22' },
      { kind: 'atom', value: '180' },
    ]);
  });

  it('rejects trailing junk after the root list', () => {
    expect(() => parse('(a) (b)')).toThrow(/trailing content/);
  });

  it('rejects an unterminated list', () => {
    expect(() => parse('(a (b)')).toThrow(/Unterminated list/);
  });

  describe('pruning', () => {
    const src =
      '(symbol "R" (property "Ref" "R" (at 0 1) (effects (font (size 1 1)))) (symbol "R_1_1" (rectangle (start 0 0) (end 1 1)) (pin passive line (at 0 0) (name "~" (effects hide)) (number "1"))))';

    it('is off by default: the tree is the whole file', () => {
      expect(serialize(parse(src))).toBe(serialize(parse(src, {})));
      expect(parse(src).items[1]).toEqual({ kind: 'string', value: 'R' });
    });

    it('drops a listed head from its parent entirely', () => {
      const unit = parse(src, { drop: new Set(['rectangle']) }).items[3] as SList;
      expect(unit.items.map((i) => (i.kind === 'list' ? i.items[0] : i))).toEqual([
        { kind: 'atom', value: 'symbol' },
        { kind: 'string', value: 'R_1_1' },
        { kind: 'atom', value: 'pin' },
      ]);
    });

    it('keeps a shallow head with its atoms and strings and nothing nested', () => {
      const root = parse(src, { shallow: new Set(['pin', 'property']) });
      expect(root.items[2]).toEqual({
        kind: 'list',
        items: [
          { kind: 'atom', value: 'property' },
          { kind: 'string', value: 'Ref' },
          { kind: 'string', value: 'R' },
        ],
      });
      const unit = root.items[3] as SList;
      expect(unit.items[3]).toEqual({
        kind: 'list',
        items: [
          { kind: 'atom', value: 'pin' },
          { kind: 'atom', value: 'passive' },
          { kind: 'atom', value: 'line' },
        ],
      });
      // The rectangle under the unit is untouched by a shallow rule elsewhere.
      expect(unit.items[2]).toEqual(parse('(rectangle (start 0 0) (end 1 1))'));
    });

    it('skips a pruned list by its parens, not by what its strings contain', () => {
      const root = parse('(a (text "a ) b (") (b 1))', { drop: new Set(['text']) });
      expect(root).toEqual(parse('(a (b 1))'));
      const flat = parse('(a (pin (name ")(") 2) (b))', { shallow: new Set(['pin']) });
      expect(flat).toEqual(parse('(a (pin 2) (b))'));
    });

    it('still rejects a pruned list that never closes', () => {
      expect(() => parse('(a (text 1 (b)', { drop: new Set(['text']) })).toThrow(
        /Unterminated list/,
      );
    });
  });
});

describe('round-trip (losslessness)', () => {
  const semanticRoundTrip = (text: string): void => {
    const once = parse(text);
    const twice = parse(serialize(once));
    // The AST must be identical after a serialize/parse cycle: zero data loss.
    expect(twice).toEqual(once);
  };

  it('is identity over the AST for a hand-written sample', () => {
    semanticRoundTrip('(kicad_sch (version 20250114) (paper "A4") (wire (pts (xy 1 2) (xy 3 4))))');
  });

  it('is identity over the AST for a real KiCad schematic', () => {
    semanticRoundTrip(fixture('nfc-antenna.kicad_sch'));
  });

  it('does not drop any node from the real schematic', () => {
    const root = parse(fixture('nfc-antenna.kicad_sch'));
    const count = (n: SNode): number =>
      n.kind === 'list' ? 1 + n.items.reduce((s, c) => s + count(c), 0) : 1;
    const before = count(root);
    const after = count(parse(serialize(root)));
    expect(after).toBe(before);
  });
});
