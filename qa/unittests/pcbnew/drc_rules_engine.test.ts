// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Resolving a constraint from the rule set (DRC_ENGINE::EvalRules).
 *
 * The order is the whole point: local override beats every rule, and among
 * rules the *last* match wins — which is why implicit board/netclass rules are
 * loaded before user rules rather than after.
 */
import { describe, it, expect } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import {
  boardSetupRules,
  buildDrcRuleEngine,
  evalDrcRules,
  netClassRules,
  ruleMatchesLayer,
  type DrcEvalItem,
} from '@ziroeda/pcbnew/src/drc/drc_rules_engine.js';

const MM = (n: number): number => mmToIU(n);

const track = (over: Partial<DrcEvalItem> = {}): DrcEvalItem => ({
  type: 'Track',
  layer: 'F.Cu',
  netName: 'N1',
  netClasses: ['Default'],
  ...over,
});

const engineOf = (dru: string, implicit = boardSetupRules({ clearance: MM(0.2) })) =>
  buildDrcRuleEngine(implicit, parseDrcRules(dru));

describe('ruleMatchesLayer', () => {
  const on = (layer: string | undefined, ruleLayer?: string): boolean =>
    ruleMatchesLayer({ name: 'r', layer: ruleLayer, constraints: [] }, layer);

  it('applies everywhere with no (layer …)', () => {
    expect(on('F.Cu')).toBe(true);
    expect(on('In1.Cu')).toBe(true);
  });

  it('matches an exact layer name', () => {
    expect(on('F.Cu', 'F.Cu')).toBe(true);
    expect(on('B.Cu', 'F.Cu')).toBe(false);
  });

  it('resolves the outer and inner groups', () => {
    expect(on('F.Cu', 'outer')).toBe(true);
    expect(on('B.Cu', 'outer')).toBe(true);
    expect(on('In1.Cu', 'outer')).toBe(false);

    expect(on('In1.Cu', 'inner')).toBe(true);
    expect(on('In7.Cu', 'inner')).toBe(true);
    expect(on('F.Cu', 'inner')).toBe(false);
  });
});

describe('resolution order', () => {
  it('falls back to the implicit board default when nothing else matches', () => {
    const e = engineOf('');
    const r = evalDrcRules(e, 'clearance', track(), track(), 'F.Cu');

    expect(r.value.min).toBe(MM(0.2));
    expect(r.implicit).toBe(true);
  });

  it('lets a user rule override the board default', () => {
    const e = engineOf(`(version 1)
      (rule "wide" (constraint clearance (min 0.5mm)))`);
    const r = evalDrcRules(e, 'clearance', track(), track(), 'F.Cu');

    expect(r.value.min).toBe(MM(0.5));
    expect(r.implicit).toBe(false);
    expect(r.rule?.name).toBe('wide');
  });

  it('lets the last matching user rule win', () => {
    const e = engineOf(`(version 1)
      (rule "first"  (constraint clearance (min 0.3mm)))
      (rule "second" (constraint clearance (min 0.7mm)))`);
    const r = evalDrcRules(e, 'clearance', track(), track(), 'F.Cu');

    expect(r.value.min).toBe(MM(0.7));
    expect(r.rule?.name).toBe('second');
  });

  it('gives a local override the last word over every rule', () => {
    const e = engineOf(`(version 1) (rule "wide" (constraint clearance (min 0.5mm)))`);
    const r = evalDrcRules(e, 'clearance', track(), track(), 'F.Cu', MM(0.9));

    expect(r.value.min).toBe(MM(0.9));
    expect(r.rule).toBeUndefined();
  });

  it('resolves min, opt and max independently', () => {
    // A rule setting only max must leave the earlier min standing.
    const e = engineOf(`(version 1)
      (rule "a" (constraint track_width (min 0.1mm) (opt 0.2mm)))
      (rule "b" (constraint track_width (max 1mm)))`);
    const r = evalDrcRules(e, 'track_width', track(), undefined, 'F.Cu');

    expect(r.value).toEqual({ min: MM(0.1), opt: MM(0.2), max: MM(1) });
  });

  it('returns an empty value when nothing matches at all', () => {
    const e = buildDrcRuleEngine([], parseDrcRules(''));
    const r = evalDrcRules(e, 'clearance', track(), track(), 'F.Cu');

    expect(r.value).toEqual({});
    expect(r.rule).toBeUndefined();
  });
});

describe('conditions', () => {
  it('applies a rule only where its condition holds', () => {
    const e = engineOf(`(version 1)
      (rule "hv" (constraint clearance (min 1.5mm)) (condition "A.NetClass == 'HV'"))`);

    const hv = evalDrcRules(e, 'clearance', track({ netClasses: ['HV'] }), track(), 'F.Cu');
    const lv = evalDrcRules(e, 'clearance', track({ netClasses: ['LV'] }), track(), 'F.Cu');

    expect(hv.value.min).toBe(MM(1.5));
    expect(lv.value.min).toBe(MM(0.2));
  });

  it('matches any constituent netclass, not the aggregate string', () => {
    // A net in both classes must answer to a rule on either. Comparing against
    // "Power,HighVoltage" as one string would match neither.
    const e = engineOf(`(version 1)
      (rule "hv" (constraint clearance (min 1.5mm)) (condition "A.NetClass == 'HighVoltage'"))`);

    const r = evalDrcRules(
      e,
      'clearance',
      track({ netClasses: ['Power', 'HighVoltage'] }),
      track(),
      'F.Cu',
    );

    expect(r.value.min).toBe(MM(1.5));
  });

  it('honours a wildcard netclass', () => {
    const e = engineOf(`(version 1)
      (rule "hs" (constraint clearance (min 1mm)) (condition "A.NetClass == 'HS_*'"))`);

    expect(
      evalDrcRules(e, 'clearance', track({ netClasses: ['HS_DDR'] }), track(), 'F.Cu').value.min,
    ).toBe(MM(1));
    expect(
      evalDrcRules(e, 'clearance', track({ netClasses: ['LS_DDR'] }), track(), 'F.Cu').value.min,
    ).toBe(MM(0.2));
  });

  it('inverts a netclass comparison with !=', () => {
    const e = engineOf(`(version 1)
      (rule "notHV" (constraint clearance (min 0.4mm)) (condition "A.NetClass != 'HV'"))`);

    expect(
      evalDrcRules(e, 'clearance', track({ netClasses: ['HV'] }), track(), 'F.Cu').value.min,
    ).toBe(MM(0.2));
    expect(
      evalDrcRules(e, 'clearance', track({ netClasses: ['LV'] }), track(), 'F.Cu').value.min,
    ).toBe(MM(0.4));
  });

  it('matches on item type and layer', () => {
    const e = engineOf(`(version 1)
      (rule "viaOnly" (constraint clearance (min 0.8mm))
        (condition "A.Type == 'Via' && B.Layer == 'F.Cu'"))`);

    const viaHit = evalDrcRules(e, 'clearance', track({ type: 'Via' }), track(), 'F.Cu');
    const trackMiss = evalDrcRules(e, 'clearance', track(), track(), 'F.Cu');
    const layerMiss = evalDrcRules(
      e,
      'clearance',
      track({ type: 'Via' }),
      track({ layer: 'B.Cu' }),
      'F.Cu',
    );

    expect(viaHit.value.min).toBe(MM(0.8));
    expect(trackMiss.value.min).toBe(MM(0.2));
    expect(layerMiss.value.min).toBe(MM(0.2));
  });

  it('asks the caller about geometry functions', () => {
    const e = engineOf(`(version 1)
      (rule "ko" (constraint clearance (min 2mm)) (condition "A.insideArea('keepout')"))`);

    const inside = track({ test: (fn, args) => fn === 'insideArea' && args[0] === 'keepout' });
    const outside = track({ test: () => false });

    expect(evalDrcRules(e, 'clearance', inside, track(), 'F.Cu').value.min).toBe(MM(2));
    expect(evalDrcRules(e, 'clearance', outside, track(), 'F.Cu').value.min).toBe(MM(0.2));
  });

  it('reports a condition it cannot compile, and does not apply the rule', () => {
    const e = engineOf(`(version 1)
      (rule "bad" (constraint clearance (min 5mm)) (condition "A.Width + 1 > 2"))`);
    const r = evalDrcRules(e, 'clearance', track(), track(), 'F.Cu');

    expect(r.value.min).toBe(MM(0.2));
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('layers', () => {
  it('skips a rule whose layer does not match', () => {
    const e = engineOf(`(version 1)
      (rule "innerThin" (layer inner) (constraint track_width (min 0.1mm)))
      (rule "outerFat"  (layer outer) (constraint track_width (min 0.3mm)))`);

    expect(evalDrcRules(e, 'track_width', track(), undefined, 'F.Cu').value.min).toBe(MM(0.3));
    expect(evalDrcRules(e, 'track_width', track(), undefined, 'In1.Cu').value.min).toBe(MM(0.1));
  });
});

describe('non-numeric constraints', () => {
  it('carries the disallow kinds through', () => {
    const e = engineOf(`(version 1)
      (rule "ko" (constraint disallow track via) (condition "A.insideArea('ko')"))`);

    const inside = track({ test: () => true });
    expect(evalDrcRules(e, 'disallow', inside, undefined, 'F.Cu').disallow).toEqual([
      'track',
      'via',
    ]);
  });

  it('carries an assertion expression through', () => {
    const e = engineOf(`(version 1)
      (rule "cls" (constraint assertion "A.Component_Class == 'C1'"))`);

    expect(evalDrcRules(e, 'assertion', track(), undefined, 'F.Cu').assertion).toBe(
      "A.Component_Class == 'C1'",
    );
  });

  it('carries a zone connection mode through', () => {
    const e = engineOf(`(version 1) (rule "z" (constraint zone_connection solid))`);
    expect(evalDrcRules(e, 'zone_connection', track(), undefined, 'F.Cu').zoneConnection).toBe(
      'solid',
    );
  });
});

describe('severity', () => {
  it('takes the winning rule’s severity override', () => {
    const e = engineOf(`(version 1)
      (rule "warn" (severity warning) (constraint clearance (min 0.5mm)))`);

    expect(evalDrcRules(e, 'clearance', track(), track(), 'F.Cu').severity).toBe('warning');
  });

  it('defaults to error', () => {
    expect(evalDrcRules(engineOf(''), 'clearance', track(), track(), 'F.Cu').severity).toBe(
      'error',
    );
  });
});

describe('implicit netclass rules', () => {
  it('slot in under user rules', () => {
    const implicit = [
      ...boardSetupRules({ clearance: MM(0.2) }),
      ...netClassRules([{ name: 'HV', clearance: MM(1) }]),
    ];

    const bare = buildDrcRuleEngine(implicit, parseDrcRules(''));
    const hv = track({ netClasses: ['HV'] });

    // The netclass beats the board default...
    expect(evalDrcRules(bare, 'clearance', hv, track(), 'F.Cu').value.min).toBe(MM(1));
    expect(evalDrcRules(bare, 'clearance', track(), track(), 'F.Cu').value.min).toBe(MM(0.2));

    // ...and a user rule beats the netclass.
    const withUser = buildDrcRuleEngine(
      implicit,
      parseDrcRules(`(version 1)
        (rule "tighter" (constraint clearance (min 0.05mm)) (condition "A.NetClass == 'HV'"))`),
    );
    const r = evalDrcRules(withUser, 'clearance', hv, track(), 'F.Cu');

    expect(r.value.min).toBe(MM(0.05));
    expect(r.implicit).toBe(false);
  });
});
