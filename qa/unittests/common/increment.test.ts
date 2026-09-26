// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/increment.cpp`. The STRING_INCREMENTER and alphabet tables are
 * KiCad's own `qa/tests/common/test_increment.cpp`, case for case; the rest
 * is derived from the C++ by hand, with the working in the comment.
 */
import {
  AlphabeticFromIndex,
  IncrementString,
  IndexFromAlphabetic,
  STRING_INCREMENTER,
} from '@ziroeda/common/increment.js';
import { incrementLabel, layoutDrawingSheet } from '@ziroeda/common/drawing_sheet/index.js';
import type { DsTextItem, WksSheet } from '@ziroeda/common/drawing_sheet/index.js';
import { describe, expect, it } from 'vitest';

describe('STRING_INCREMENTER (test_increment.cpp BasicCase)', () => {
  const cases: [string, number, number, string][] = [
    // Null
    ['', 1, 0, 'nullopt'],
    ['', 1, 1, 'nullopt'],
    ['', -1, 1, 'nullopt'],
    // Up
    ['1', 1, 0, '2'],
    ['1', 9, 0, '10'],
    // Down
    ['2', -1, 0, '1'],
    ['10', -1, 0, '9'],
    // Down from 0
    ['0', -1, 0, 'nullopt'],
    // Ran out of a parts
    ['1', 1, 1, 'nullopt'],
    // Leading zeros preserved
    ['01', 1, 0, '02'],
    // Alpha
    ['A', 1, 0, 'B'],
    ['E', -1, 0, 'D'],
    // Skip I
    ['H', 1, 0, 'J'],
    ['J', -1, 0, 'H'],
    // But I works if it's there
    ['I', 1, 0, 'J'],
    ['I', -1, 0, 'H'],
    // Alpha wrap
    ['Z', 1, 0, 'AA'],
    // Reject huge alphabetic value
    ['ABB', 1, 0, 'nullopt'],
    // Dashes skipped
    ['A-1', 1, 0, 'A-2'],
    ['A-1', 1, 1, 'B-1'],
    // Mixed alphabetic+numeric string behavior
    ['A12', 1, 0, 'A13'],
    ['A12', -1, 0, 'A11'],
    ['A12', 1, 1, 'B12'],
    ['A12', -1, 1, 'nullopt'],
  ];

  const incrementer = new STRING_INCREMENTER();
  incrementer.SetSkipIOSQXZ(true);

  for (const [input, delta, part, expected] of cases) {
    it(`${JSON.stringify(input)} ${delta} part ${part} -> ${expected}`, () => {
      expect(incrementer.Increment(input, delta, part) ?? 'nullopt').toBe(expected);
    });
  }
});

describe('IndexFromAlphabetic / AlphabeticFromIndex (AlphabeticIndexes)', () => {
  const alphabet = 'ABCDEFGHJKLMNPRTUVWY';
  const cases: [string, number][] = [
    ['A', 0],
    ['B', 1],
    ['Y', 19],
    ['AA', 20],
    ['AY', 39],
  ];
  for (const [input, expected] of cases) {
    it(`${input} <-> ${expected}`, () => {
      expect(IndexFromAlphabetic(input, alphabet)).toBe(expected);
      expect(AlphabeticFromIndex(expected, alphabet, true)).toBe(input);
    });
  }
  it('a letter outside the alphabet is -1', () => {
    expect(IndexFromAlphabetic('AI', alphabet)).toBe(-1);
  });
});

describe('IncrementString', () => {
  it('steps the last run of digits, keeping its width and what follows', () => {
    expect(IncrementString('NET0', 1)).toBe('NET1');
    expect(IncrementString('D07', 1)).toBe('D08');
    expect(IncrementString('D099', 1)).toBe('D100');
    expect(IncrementString('CLK0_P', 1)).toBe('CLK1_P');
    expect(IncrementString('A1B2', -1)).toBe('A1B1');
  });
  it('no digits, or empty, is unchanged (true upstream); below zero fails', () => {
    expect(IncrementString('', 1)).toBe('');
    expect(IncrementString('CLK', 1)).toBe('CLK');
    expect(IncrementString('D0', -1)).toBeNull();
  });
});

describe('the drawing sheet steps its repeats with STRING_INCREMENTER', () => {
  it('every letter counts, carries within its type, and has no length bound', () => {
    // SetSkipIOSQXZ(false): H -> I, not J.
    expect(incrementLabel('H', 1)).toBe('I');
    // Lower case rolls z -> aa (the old last-character rule gave '{').
    expect(incrementLabel('z', 1)).toBe('aa');
    // "Rev." : skip '.', then the lower-case run "ev" = 4*26+21+26 = 151
    // (non-unit column counts from 1); +1 = 152 = 5*26 + 22 -> "EW" -> "ew".
    expect(incrementLabel('Rev.', 1)).toBe('Rew.');
    // SetAlphabeticMaxIndex(-1): "ABB" (index 729) still steps.
    expect(incrementLabel('ABB', 1)).toBe('ABC');
    // Nothing to step: the repeat shows the text unchanged.
    expect(incrementLabel('-', 1)).toBe('-');
  });

  const sheet = (text: string): WksSheet => ({
    version: 20220228,
    generator: 'pl_editor',
    setup: {
      textW: 1.5,
      textH: 1.5,
      lineWidth: 0.15,
      textLineWidth: 0.15,
      leftMargin: 10,
      rightMargin: 10,
      topMargin: 10,
      bottomMargin: 10,
    },
    items: [
      {
        type: 'text',
        name: 'r',
        option: 'normal',
        repeat: 3,
        incrx: 0,
        incry: 4,
        incrlabel: 2,
        comment: '',
        text,
        pos: { x: 20, y: 5, corner: 'lbcorner' },
        fontW: 1.5,
        fontH: 1.5,
        bold: false,
        italic: false,
        lineWidth: 0,
        hjustify: 'left',
        vjustify: 'center',
        rotate: 0,
        maxlen: 0,
        maxheight: 0,
      },
    ],
  });
  const texts = (text: string): string[] =>
    (
      layoutDrawingSheet(
        sheet(text),
        { widthMM: 297, heightMM: 210 },
        { pageNumber: 4 },
      ) as DsTextItem[]
    ).map((d) => d.text);

  it('repeat j shows Increment( m_TextBase, j * incrlabel )', () => {
    expect(texts('y')).toEqual(['y', 'aa', 'ac']);
  });

  it('only the first repeat has its variables resolved (ds_data_item.cpp:549, :611)', () => {
    // m_FullText = BuildFullText( m_TextBase ) for j = 0; IncrementLabel then
    // steps the RAW base, and "${#}" has no letter or number part, so the
    // later repeats show it as written.
    expect(texts('${#}')).toEqual(['4', '${#}', '${#}']);
  });
});
