// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Custom design rules: the `.kicad_dru` parser (DRC_RULES_PARSER) and the
 * condition language (LIBEVAL::COMPILER over PCBEXPR).
 */
import { describe, it, expect } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { parseDrcRules, parseRuleValue } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import {
  DrcExprError,
  evalDrcExpr,
  parseDrcExpr,
  testDrcCondition,
  type DrcExprContext,
} from '@ziroeda/pcbnew/src/drc/drc_expr.js';

const MM = (n: number): number => mmToIU(n);

describe('parseRuleValue', () => {
  it('converts the length units the resolver supports', () => {
    expect(parseRuleValue('0.2mm')).toBe(MM(0.2));
    expect(parseRuleValue('1in')).toBe(MM(25.4));
    expect(parseRuleValue('10mil')).toBe(MM(0.254));
    expect(parseRuleValue(' 1.5 mm ')).toBe(MM(1.5));
  });

  it('leaves a bare number unscaled', () => {
    // PCBEXPR_UNIT_RESOLVER has no default unit: `0.2` is 0.2 IU, not 0.2 mm.
    // Treating it as mm would inflate the constraint a millionfold.
    expect(parseRuleValue('0.2')).toBe(0.2);
    expect(parseRuleValue('45')).toBe(45);
  });

  it('passes angles and times through unscaled', () => {
    expect(parseRuleValue('45deg')).toBe(45);
    expect(parseRuleValue('100ps')).toBe(100);
  });

  it('rejects what it cannot read', () => {
    expect(parseRuleValue('nonsense')).toBeUndefined();
    expect(parseRuleValue('1furlong')).toBeUndefined();
    expect(parseRuleValue('')).toBeUndefined();
  });
});

describe('parseDrcRules', () => {
  it('reads an empty file as no rules', () => {
    const r = parseDrcRules('');
    expect(r.rules).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('reads the version and a simple rule', () => {
    const r = parseDrcRules(`(version 1)
      (rule "HV"
        (constraint clearance (min 1.5mm))
        (condition "A.NetClass == 'HV'"))`);

    expect(r.version).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.rules).toHaveLength(1);

    const rule = r.rules[0]!;
    expect(rule.name).toBe('HV');
    expect(rule.condition).toBe("A.NetClass == 'HV'");
    expect(rule.constraints).toEqual([{ type: 'clearance', value: { min: MM(1.5) } }]);
  });

  it('reads min, max and opt together', () => {
    const r = parseDrcRules(`(version 1)
      (rule "w" (constraint track_width (min 0.1mm) (max 1mm) (opt 0.2mm)))`);

    expect(r.rules[0]!.constraints[0]!.value).toEqual({
      min: MM(0.1),
      max: MM(1),
      opt: MM(0.2),
    });
  });

  it('reads several constraints in one rule', () => {
    const r = parseDrcRules(`(version 1)
      (rule "under_fpga"
        (constraint clearance (min 0.1mm))
        (constraint hole_size (min 0.2mm))
        (constraint via_diameter (min 0.4mm))
        (condition "A.intersectsArea('underFPGA')"))`);

    expect(r.rules[0]!.constraints.map((c) => c.type)).toEqual([
      'clearance',
      'hole_size',
      'via_diameter',
    ]);
  });

  it('reads the layer and severity overrides', () => {
    const r = parseDrcRules(`(version 1)
      (rule "outer_only" (layer outer) (severity warning)
        (constraint track_width (min 0.115mm)))`);

    expect(r.rules[0]!.layer).toBe('outer');
    expect(r.rules[0]!.severity).toBe('warning');
  });

  it('reads a disallow constraint’s item kinds', () => {
    const r = parseDrcRules(`(version 1)
      (rule "keepout" (constraint disallow track via pad) (condition "A.insideArea('ko')"))`);

    expect(r.rules[0]!.constraints[0]!.disallow).toEqual(['track', 'via', 'pad']);
  });

  it('reads an assertion’s expression', () => {
    const r = parseDrcRules(`(version 1)
      (rule "cls" (constraint assertion "A.Component_Class == 'CLASS1'"))`);

    expect(r.rules[0]!.constraints[0]!.assertion).toBe("A.Component_Class == 'CLASS1'");
  });

  it('reads a zone connection mode', () => {
    const r = parseDrcRules(`(version 1)
      (rule "z" (constraint zone_connection solid))`);

    expect(r.rules[0]!.constraints[0]!.zoneConnection).toBe('solid');
  });

  it('accepts an unquoted rule name', () => {
    const r = parseDrcRules(`(version 1)
      (rule Rule1 (constraint clearance (min 1mm)))`);

    expect(r.rules[0]!.name).toBe('Rule1');
  });

  it('reports a bad rule and keeps the good ones', () => {
    // DRC_RULES_PARSER reports and carries on; one broken rule must not
    // silence the rest of the file.
    const r = parseDrcRules(`(version 1)
      (rule "bad" (constraint nonsense (min 1mm)))
      (rule "good" (constraint clearance (min 2mm)))`);

    expect(r.rules.map((x) => x.name)).toEqual(['bad', 'good']);
    expect(r.rules[1]!.constraints[0]!.value.min).toBe(MM(2));
    expect(r.errors.join(' ')).toContain('unknown constraint type');
  });

  it('reports a rule with no constraints', () => {
    const r = parseDrcRules(`(version 1) (rule "empty" (condition "A.Type == 'Track'"))`);
    expect(r.errors.join(' ')).toContain('no constraints');
  });

  it('reports an unreadable value without dropping the rule', () => {
    const r = parseDrcRules(`(version 1) (rule "r" (constraint clearance (min "1furlong")))`);

    expect(r.rules).toHaveLength(1);
    expect(r.rules[0]!.constraints[0]!.value.min).toBeUndefined();
    expect(r.errors.join(' ')).toContain('bad min value');
  });

  it('survives text that is not s-expressions at all', () => {
    const r = parseDrcRules('this is not a rule file (((');
    expect(r.rules).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('the condition language', () => {
  const ctx = (
    props: Record<string, string | number>,
    calls: Record<string, boolean> = {},
  ): DrcExprContext => ({
    property: (item, name) => props[`${item}.${name}`],
    call: (item, name, args) => calls[`${item}.${name}(${args.join(',')})`],
  });

  const run = (src: string, c: DrcExprContext): unknown => evalDrcExpr(parseDrcExpr(src), c);

  it('compares a property to a string', () => {
    const c = ctx({ 'A.NetClass': 'HV' });
    expect(run("A.NetClass == 'HV'", c)).toBe(true);
    expect(run("A.NetClass == 'LV'", c)).toBe(false);
    expect(run("A.NetClass != 'LV'", c)).toBe(true);
  });

  it('accepts double quotes as well as single', () => {
    expect(run('A.Type == "Track"', ctx({ 'A.Type': 'Track' }))).toBe(true);
  });

  it('compares numbers with the ordering operators', () => {
    const c = ctx({ 'A.Width': 200000 });
    expect(run('A.Width > 100000', c)).toBe(true);
    expect(run('A.Width >= 200000', c)).toBe(true);
    expect(run('A.Width < 100000', c)).toBe(false);
    expect(run('A.Width <= 100000', c)).toBe(false);
  });

  it('combines with && and ||, and && binds tighter', () => {
    const c = ctx({ 'A.Type': 'Track', 'B.Layer': 'F.Cu' });

    expect(run("A.Type == 'Track' && B.Layer == 'F.Cu'", c)).toBe(true);
    expect(run("A.Type == 'Via' && B.Layer == 'F.Cu'", c)).toBe(false);
    expect(run("A.Type == 'Via' || B.Layer == 'F.Cu'", c)).toBe(true);
    // false && false || true  ==  (false && false) || true  ==  true
    expect(run("A.Type == 'Via' && B.Layer == 'B.Cu' || A.Type == 'Track'", c)).toBe(true);
  });

  it('honours parentheses over the default precedence', () => {
    const c = ctx({ 'A.Type': 'Track', 'B.Layer': 'B.Cu' });
    expect(run("A.Type == 'Via' && (B.Layer == 'B.Cu' || A.Type == 'Track')", c)).toBe(false);
    expect(run("(A.Type == 'Via' || A.Type == 'Track') && B.Layer == 'B.Cu'", c)).toBe(true);
  });

  it('negates with !', () => {
    const c = ctx({ 'A.Type': 'Track' });
    expect(run("!(A.Type == 'Via')", c)).toBe(true);
    expect(run("!(A.Type == 'Track')", c)).toBe(false);
  });

  it('calls a function with its quoted argument', () => {
    const c = ctx({}, { 'A.intersectsArea(underFPGA)': true, 'A.insideArea(ko)': false });

    expect(run("A.intersectsArea('underFPGA')", c)).toBe(true);
    expect(run("A.insideArea('ko')", c)).toBe(false);
    expect(run("A.intersectsArea('underFPGA') || A.insideArea('ko')", c)).toBe(true);
  });

  it('calls a two-argument function', () => {
    // `A.fromTo('IC14-*','IC13-*')` appears in KiCad's own vme-wren demo.
    const c = ctx({}, { 'A.fromTo(IC14-*,IC13-*)': true });

    expect(run("A.fromTo('IC14-*','IC13-*')", c)).toBe(true);
    expect(run("A.fromTo('IC14-*', 'IC13-*' )", c)).toBe(true);
    expect(run("A.fromTo('X','Y')", c)).toBe(false);
  });

  it('records the arguments in order', () => {
    const e = parseDrcExpr("A.fromTo('a','b')");
    expect(e).toEqual({ kind: 'call', item: 'A', name: 'fromTo', args: ['a', 'b'] });
  });

  it('treats an unknown function as not matching', () => {
    expect(run("A.neverHeardOf('x')", ctx({}))).toBe(false);
  });

  it('treats an unresolvable property as not matching, rather than throwing', () => {
    // A rule naming a property we do not model must not take the run down.
    expect(run("A.NotModelled == 'x'", ctx({}))).toBe(false);
    expect(run('A.NotModelled > 5', ctx({}))).toBe(false);
  });

  it('parses the conditions from real .kicad_dru files', () => {
    for (const src of [
      "A.intersectsArea('underFPGA') || A.intersectsArea('underDDR')",
      "A.inDiffPair('*')",
      "A.NetClass == 'zse_50r' ",
      "A.intersectsArea('AREA1') && A.Type == 'Footprint'",
      "A.Component_Class == 'CLASS2,CLASS3'",
      "A.NetClass == 'DDR4_CMD' && A.fromTo('IC14-*','IC13-*' )",
    ]) {
      expect(() => parseDrcExpr(src)).not.toThrow();
    }
  });

  it('rejects what it does not implement, loudly', () => {
    // Silently returning false would apply the rule to nothing and look like
    // the board passed.
    expect(() => parseDrcExpr('A.Width + 1 > 2')).toThrow(DrcExprError);
    expect(() => parseDrcExpr('foo.Bar == 1')).toThrow(DrcExprError);
    expect(() => parseDrcExpr("A.NetClass == 'unterminated")).toThrow(DrcExprError);
    expect(() => parseDrcExpr('A.')).toThrow(DrcExprError);
    expect(() => parseDrcExpr("A.Type == 'Track'))")).toThrow(DrcExprError);
  });
});

describe('testDrcCondition', () => {
  const ctx: DrcExprContext = { property: (_i, n) => (n === 'Type' ? 'Track' : undefined) };

  it('reports a match', () => {
    expect(testDrcCondition("A.Type == 'Track'", ctx)).toEqual({ matched: true });
  });

  it('hands back the reason a condition would not compile', () => {
    const r = testDrcCondition('A.Width + 1', ctx);
    expect(r.matched).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
