// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/pcbnew/pcb_io/altium/test_altium_rule_transformer.cpp`, the
 * parameterised table transcribed whole: each input tokenised, each token's
 * kind, position and value against KiCad's expectation.
 */

import { describe, expect, it } from 'vitest';
import {
  ALTIUM_RULE_TOKEN_KIND as K,
  ALTIUM_RULE_TOKENIZER,
} from '@ziroeda/pcbnew/pcb_io/altium/altium_rule_transformer.js';

type EXPECTED = [K, number, (number | string)?];

const altium_rule_tokens_property: [string, EXPECTED[]][] = [
  [
    '',
    [
      [K.END_OF_EXPR, 0],
      [K.END_OF_EXPR, 0],
    ],
  ],
  [
    'All',
    [
      [K.IDENT, 0, 'All'],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    '1234',
    [
      [K.CONST_INT, 0, 1234],
      [K.END_OF_EXPR, 4],
    ],
  ],
  [
    '+1234',
    [
      [K.CONST_INT, 0, 1234],
      [K.END_OF_EXPR, 5],
    ],
  ],
  [
    '-1234',
    [
      [K.CONST_INT, 0, -1234],
      [K.END_OF_EXPR, 5],
    ],
  ],
  [
    "'1234'",
    [
      [K.CONST_STRING, 0, '1234'],
      [K.END_OF_EXPR, 6],
    ],
  ],
  [
    'True',
    [
      [K.CONST_TRUE, 0],
      [K.END_OF_EXPR, 4],
    ],
  ],
  [
    'true',
    [
      [K.CONST_TRUE, 0],
      [K.END_OF_EXPR, 4],
    ],
  ],
  [
    'False',
    [
      [K.CONST_FALSE, 0],
      [K.END_OF_EXPR, 5],
    ],
  ],
  [
    'false',
    [
      [K.CONST_FALSE, 0],
      [K.END_OF_EXPR, 5],
    ],
  ],
  [
    '+',
    [
      [K.ADD, 0],
      [K.END_OF_EXPR, 1],
    ],
  ],
  [
    '-',
    [
      [K.SUB, 0],
      [K.END_OF_EXPR, 1],
    ],
  ],
  [
    '*',
    [
      [K.MUL, 0],
      [K.END_OF_EXPR, 1],
    ],
  ],
  [
    '/',
    [
      [K.DIV, 0],
      [K.END_OF_EXPR, 1],
    ],
  ],
  [
    'Div',
    [
      [K.INTEGRAL_DIV, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'div',
    [
      [K.INTEGRAL_DIV, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'Mod',
    [
      [K.MOD, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'mod',
    [
      [K.MOD, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'And',
    [
      [K.AND, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'and',
    [
      [K.AND, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    '&&',
    [
      [K.LOW_AND, 0],
      [K.END_OF_EXPR, 2],
    ],
  ],
  [
    'Or',
    [
      [K.OR, 0],
      [K.END_OF_EXPR, 2],
    ],
  ],
  [
    'or',
    [
      [K.OR, 0],
      [K.END_OF_EXPR, 2],
    ],
  ],
  [
    '||',
    [
      [K.LOW_OR, 0],
      [K.END_OF_EXPR, 2],
    ],
  ],
  [
    'Xor',
    [
      [K.XOR, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'xor',
    [
      [K.XOR, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'Not',
    [
      [K.NOT, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    'not',
    [
      [K.NOT, 0],
      [K.END_OF_EXPR, 3],
    ],
  ],
  [
    '<',
    [
      [K.LESS, 0],
      [K.END_OF_EXPR, 1],
    ],
  ],
  [
    '<=',
    [
      [K.LESS_EQUAL, 0],
      [K.END_OF_EXPR, 2],
    ],
  ],
  [
    '>',
    [
      [K.GREATER, 0],
      [K.END_OF_EXPR, 1],
    ],
  ],
  [
    '>=',
    [
      [K.GREATER_EQUAL, 0],
      [K.END_OF_EXPR, 2],
    ],
  ],
  [
    '<>',
    [
      [K.NOT_EQUAL, 0],
      [K.END_OF_EXPR, 2],
    ],
  ],
  [
    '=',
    [
      [K.EQUAL, 0],
      [K.END_OF_EXPR, 1],
    ],
  ],
  [
    'Between',
    [
      [K.BETWEEN, 0],
      [K.END_OF_EXPR, 7],
    ],
  ],
  [
    'between',
    [
      [K.BETWEEN, 0],
      [K.END_OF_EXPR, 7],
    ],
  ],
  [
    'Like',
    [
      [K.LIKE, 0],
      [K.END_OF_EXPR, 4],
    ],
  ],
  [
    'like',
    [
      [K.LIKE, 0],
      [K.END_OF_EXPR, 4],
    ],
  ],
  [
    'ab cd ef',
    [
      [K.IDENT, 0, 'ab'],
      [K.IDENT, 3, 'cd'],
      [K.IDENT, 6, 'ef'],
      [K.END_OF_EXPR, 8],
    ],
  ],
  [
    "InComponent('LEDS1') or InComponent('LEDS2')",
    [
      [K.IDENT, 0, 'InComponent'],
      [K.LPAR, 11],
      [K.CONST_STRING, 12, 'LEDS1'],
      [K.RPAR, 19],
      [K.OR, 21],
      [K.IDENT, 24, 'InComponent'],
      [K.LPAR, 35],
      [K.CONST_STRING, 36, 'LEDS2'],
      [K.RPAR, 43],
      [K.END_OF_EXPR, 44],
    ],
  ],
];

describe('AltiumRuleTransformer', () => {
  it('AltiumRuleTokenizerEmptyInput / OnlySpaces', () => {
    for (const [input, pos] of [
      ['', 0],
      ['   ', 3],
    ] as const) {
      const tokenizer = new ALTIUM_RULE_TOKENIZER(input);
      expect(tokenizer.Peek().kind).toBe(K.END_OF_EXPR);
      expect(tokenizer.Peek().pos).toBe(pos);
      const next = tokenizer.Next();
      expect(next.kind).toBe(K.END_OF_EXPR);
      expect(next.pos).toBe(pos);
      expect(tokenizer.Peek().kind).toBe(K.END_OF_EXPR);
      expect(tokenizer.Peek().pos).toBe(pos);
    }
  });

  it('AltiumRuleTokenizerSingleCharIdentifier', () => {
    const tokenizer = new ALTIUM_RULE_TOKENIZER('a');
    const next = tokenizer.Next();
    expect(next.kind).toBe(K.IDENT);
    expect(next.pos).toBe(0);
    expect(next.sValue).toBe('a');
    expect(tokenizer.Peek().kind).toBe(K.END_OF_EXPR);
    expect(tokenizer.Peek().pos).toBe(1);
    const next2 = tokenizer.Next();
    expect(next2.kind).toBe(K.END_OF_EXPR);
    expect(next2.pos).toBe(1);
  });

  it('AltiumRuleTokenizerParameterizedTest', () => {
    for (const [input, exp_token] of altium_rule_tokens_property) {
      const tokenizer = new ALTIUM_RULE_TOKENIZER(input);

      for (const [kind, pos, value] of exp_token) {
        const token = tokenizer.Next();
        const ctx = `'${input}' @${pos}`;
        expect(K[token.kind], ctx).toBe(K[kind]);
        expect(token.pos, ctx).toBe(pos);
        expect(token.iValue, ctx).toBe(typeof value === 'number' ? value : 0);
        expect(token.fValue, ctx).toBe(0);
        expect(token.sValue, ctx).toBe(typeof value === 'string' ? value : '');
      }
    }
  });
});
