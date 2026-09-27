// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/text_eval/`: the `@{...}` evaluator. Every expectation is KiCad's
 * own, from `qa/tests/common/text_eval/` in the 10.0.5 tree (the file is named
 * per block), except the ones marked "derived", which are read off the C++
 * and say how.
 */

import { ResolveTextVars } from '@ziroeda/common/common.js';
import {
  EXPRESSION_EVALUATOR,
  NUMERIC_EVALUATOR_COMPAT,
} from '@ziroeda/common/text_eval/text_eval_wrapper.js';
import { MakeError, MakeValue, type Value } from '@ziroeda/common/text_eval/text_eval_types.js';
import { describe, expect, it } from 'vitest';

function evaluate(
  aInput: string,
  aSetup?: (e: EXPRESSION_EVALUATOR) => void,
): { out: string; err: boolean } {
  const e = new EXPRESSION_EVALUATOR();
  aSetup?.(e);
  const out = e.Evaluate(aInput);
  return { out, err: e.HasErrors() };
}

function expectValue(
  aInput: string,
  aExpected: string,
  aSetup?: (e: EXPRESSION_EVALUATOR) => void,
): void {
  const r = evaluate(aInput, aSetup);
  expect({ input: aInput, ...r }).toEqual({ input: aInput, out: aExpected, err: false });
}

describe('EXPRESSION_EVALUATOR (test_text_eval_parser.cpp)', () => {
  it('BasicArithmetic: precedence, right-associative power, unary signs', () => {
    expectValue('Text @{2 + 3} more text', 'Text 5 more text');
    expectValue('@{17 % 5}', '2');
    expectValue('@{2 + 3 * 4}', '14');
    expectValue('@{(2 + 3) * 4}', '20');
    expectValue('@{2^3^2}', '512');
    expectValue('@{-5}', '-5');
    expectValue('@{+5}', '5');
    expectValue('@{3.14 + 1.86}', '5');
    expectValue('@{10.5 / 2}', '5.25');
    expectValue('@{2 + 2} and @{3 * 3}', '4 and 9');
  });

  it('BasicArithmetic: division and modulo by zero fail and keep the input', () => {
    expect(evaluate('@{1 / 0}')).toEqual({ out: '@{1 / 0}', err: true });
    expect(evaluate('@{1 % 0}')).toEqual({ out: '@{1 % 0}', err: true });
  });

  it('VariableSubstitution and StringOperations', () => {
    const vars = (e: EXPRESSION_EVALUATOR) => {
      e.SetVariable('x', 10.0);
      e.SetVariable('y', 5.0);
      e.SetVariable('name', 'KiCad');
      e.SetVariable('version', 8.0);
    };

    expectValue('@{${x} / ${y}}', '2', vars);
    expectValue('Hello ${name}!', 'Hello KiCad!', vars);
    expectValue('Version ${version}.0', 'Version 8.0', vars);
    expect(evaluate('@{${undefined}}', vars)).toEqual({ out: '@{${undefined}}', err: true });

    expectValue('@{"Hello" + " " + "World"}', 'Hello World');
    expectValue('@{"Count: " + 42}', 'Count: 42');
    expectValue('@{42 + " items"}', '42 items');
  });

  it('MathematicalFunctions', () => {
    expectValue('@{round(3.14159, 2)}', '3.14');
    expectValue('@{min(3.5, 3.1)}', '3.1');
    expectValue('@{sum(1, 2, 3, 4)}', '10');
    expectValue('@{avg(2, 4, 6)}', '4');
    expect(evaluate('@{sqrt(-1)}').err).toBe(true);
  });

  it('StringFunctions: case and the four wxString splits', () => {
    expectValue('@{upper("hello world")}', 'HELLO WORLD');
    expectValue('@{concat("Count: ", 42, " items")}', 'Count: 42 items');
    expectValue('@{beforefirst("hello.world.txt", ".")}', 'hello');
    expectValue('@{beforelast("hello.world.txt", ".")}', 'hello.world');
    expectValue('@{afterfirst("hello.world.txt", ".")}', 'world.txt');
    expectValue('@{afterlast("hello.world.txt", ".")}', 'txt');
    // Derived: wxString::BeforeLast / AfterFirst answer empty when the character
    // is absent, BeforeFirst / AfterLast the whole string (wx/string.h).
    expectValue('[@{beforelast("abc", ".")}]', '[]');
    expectValue('[@{afterfirst("abc", ".")}]', '[]');
    expectValue('@{beforefirst("abc", ".")}', 'abc');
    expectValue('@{afterlast("abc", ".")}', 'abc');
  });

  it('FormattingFunctions: {:.Nf} with the default of two places', () => {
    expectValue('@{format(3.14159, 3)}', '3.142');
    expectValue('@{format(1234.5)}', '1234.50');
    expectValue('@{currency(1234.56)}', '$1234.56');
    expectValue('@{currency(999.99, "€")}', '€999.99');
  });

  it('ConditionalFunctions', () => {
    const vars = (e: EXPRESSION_EVALUATOR) => {
      e.SetVariable('x', 10.0);
      e.SetVariable('y', 5.0);
    };

    expectValue('@{if(${x} > ${y}, "greater", "not greater")}', 'greater', vars);
    expectValue('@{if(${x} == 10, "ten", "not ten")}', 'ten', vars);
  });
});

describe('dates (test_text_eval_parser_datetime.cpp)', () => {
  it('formats and parses days since the epoch', () => {
    expectValue('@{dateformat(0)}', '1970-01-01');
    expectValue('@{dateformat(0, "US")}', '01/01/1970');
    expectValue('@{dateformat(0, "long")}', 'January 1, 1970');
    expectValue('@{weekdayname(0)}', 'Thursday');
    expectValue('@{datestring("2024-03-15")}', '19797');
    expectValue('@{dateformat(datestring("2024-02-29"))}', '2024-02-29');
    expectValue('@{dateformat(19797, "Chinese")}', '2024年03月15日');
    expectValue('@{datestring("2024년 03월 15일")}', '19797');
  });

  it('an 8-byte check counts UTF-8 bytes: a CJK date without its day marker is invalid', () => {
    expect(evaluate("@{datestring('2024年02月')}").err).toBe(true);
  });
});

describe('VCS functions with no repository (text_eval_vcs.cpp)', () => {
  it('answer <unknown>, 0 and empty, as KiCad does outside a git checkout', () => {
    // Derived: OpenRepo finds nothing, every getter returns its empty value, and
    // evaluateFunction's vcsResult maps "" to "<unknown>".
    expectValue('@{vcsidentifier()}', '<unknown>');
    expectValue('@{vcsbranch()}', '<unknown>');
    expectValue('@{vcsfileauthor("board.kicad_pcb")}', '<unknown>');
    expectValue('@{vcslabeldistance()}', '0');
    expectValue('@{vcsdirty()}', '0');
    expectValue('[@{vcsdirtysuffix()}]', '[]');
    expectValue('@{vcscommitdate()}', '<unknown>');
  });
});

describe('units (test_text_eval_numeric_compat.cpp)', () => {
  it('ActualUnitParsing: suffixes convert to the evaluator units', () => {
    expectValue('@{1in}', '25.4');
    expectValue('@{1mil}', '0.0254');
    expectValue('@{1mm + 1in}', '26.4');
    expectValue('@{10mm + 0.5in + 500mil}', '35.4');
    expectValue('@{1 in}', '25.4');
    expectValue('@{${width}mm + 1in}', '35.4', (e) => e.SetVariable('width', 10));

    const inch = new EXPRESSION_EVALUATOR('in');
    expect(inch.Evaluate('@{25.4mm}')).toBe('1');
  });

  it('ValidResults / InvalidResults', () => {
    expectValue('@{1.5 + 0.2 + 0.1}', '1.8');
    expectValue('@{1 + 2 - 4 * 20 / 2}', '-37');
    expectValue('@{-(1 + (2 - 4)) * 20.8 / 2}', '10.4');

    for (const bad of ['@{}', '@{1+}', '@{*2 + 1}', '@{(1 + 2}', '@{1 + 2)}', '@{1 $ 2}'])
      expect({ bad, err: evaluate(bad).err }).toEqual({ bad, err: true });
  });

  it('NUMERIC_EVALUATOR_COMPAT reads a bare expression and says NaN on failure', () => {
    const n = new NUMERIC_EVALUATOR_COMPAT('mm');
    n.SetVar('x', 4);
    expect(n.Process('x * 2 + 1in')).toBe(true);
    expect(n.Result()).toBe('33.4');
    expect(n.Process('1 +')).toBe(false);
    expect(n.Result()).toBe('NaN');
  });
});

describe('derived from the C++', () => {
  it('a unary minus takes the power with it: -2^2 is -4', () => {
    // text_eval.lemon: %right UMINUS sits below %right POWER, so lemon shifts
    // POWER after `MINUS factor` rather than reducing.
    expectValue('@{-2^2}', '-4');
    expectValue('@{2^-1}', '0.5');
  });

  it('comparisons sit below + and -, and yield 1 / 0', () => {
    expectValue('@{1 < 2 + 3}', '1');
    expectValue('@{2 >= 3}', '0');
    expectValue('@{"a" != "b"}', '1');
  });

  it('numbers print as {fmt} does: {:.0f} near a whole, else the shortest form with its exponent rule', () => {
    // VALUE_UTILS::ToString: within 1e-10 of a whole number below 1e15 is
    // "{:.0f}"; otherwise fmt's "{}", which switches to an exponent below
    // 1e-4 and at 1e16, with at least two exponent digits.
    expectValue('@{0.1 + 0.2}', '0.30000000000000004');
    expectValue('@{1 / 100000}', '1e-05');
    expectValue('@{0.0001}', '0.0001');
    expectValue('@{2^60}', '1.152921504606847e+18');
  });

  it('SI prefixes scale a number; E is exa, not an exponent, when no digit follows the E directly', () => {
    // parse_number: `k` is not a unit, so it is the 1e3 prefix. In `1E3`
    // the E is read as the exa prefix before the fraction loop, which then
    // appends the 3 to the integer digits: 13 * 1e18.
    expectValue('@{4.7k}', '4700');
    expectValue('@{2m}', '0.002');
    expectValue('@{1e3}', '1000');
    expectValue('@{1E3}', '1.3e+19');
  });

  it('format() rounds the exact binary value half-to-even, as printf does', () => {
    // 0.125 is exact in binary, so {:.2f} sees a true tie and keeps the even 2.
    expectValue('@{format(0.125)}', '0.12');
    expectValue('@{format(0.375)}', '0.38');
  });

  it('one failing expression is left as written while the others evaluate', () => {
    // evaluateWithPartialErrorRecovery replaces each @{} that evaluates and
    // keeps the ones that fail, reporting an error.
    expect(evaluate('@{1+1} @{1/0} @{2*3}')).toEqual({ out: '2 @{1/0} 6', err: true });
  });

  it('E-series: nearest, up and down in a decade', () => {
    expectValue('@{enearest(4.6k)}', '4700');
    expectValue('@{eup(1000, "E12")}', '1200');
    expectValue('@{edown(1000, "E12")}', '820');
    expectValue('@{enearest(0.00001, "E6")}', '1e-05');
  });

  it('a custom callback resolves first, and its error stands when nothing else does', () => {
    const e = new EXPRESSION_EVALUATOR((aName: string) =>
      aName === 'R' ? MakeValue<Value>(470) : MakeError<Value>(`no ${aName}`),
    );

    expect(e.Evaluate('@{${R} * 2}')).toBe('940');
    // Priority 1 is the callback, ahead of a stored variable of the same name.
    e.SetVariable('R', 1);
    expect(e.Evaluate('@{${R} * 2}')).toBe('940');
    expect(e.Evaluate('@{${Q}}')).toBe('@{${Q}}');
    expect(e.HasErrors()).toBe(true);
  });
});

describe('ResolveTextVars evaluates @{} everywhere text is shown', () => {
  it('expands ${} first, then the math', () => {
    const resolver = (token: { value: string }) => {
      if (token.value !== 'ROW') return false;
      token.value = '7';
      return true;
    };

    expect(ResolveTextVars('Pin @{${ROW} - 1}', resolver, { value: 0 })).toBe('Pin 6');
  });
});
