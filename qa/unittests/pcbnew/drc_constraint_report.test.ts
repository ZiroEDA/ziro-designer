// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The "why is this the answer" report behind Clearance Resolution and
 * Constraints Resolution.
 * Counterpart: `DRC_ENGINE::EvalRules`'s REPORTER output, as
 * `BOARD_INSPECTION_TOOL::InspectClearance` presents it.
 *
 * The report is the *same walk* DRC performs, with the reasoning kept, rather
 * than a second implementation. That is the whole design point: a report
 * generated separately could disagree with the markers it is meant to explain,
 * and a user chasing a violation the report says should not exist has been
 * sent somewhere worse than nowhere.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import {
  boardSetupRules,
  buildDrcRuleEngine,
  type DrcEvalItem,
  reportDrcConstraint,
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

/** The report's lines, joined, for readable assertions. */
const linesOf = (dru: string, a = track(), b = track()): string =>
  reportDrcConstraint(engineOf(dru), 'clearance', a, b, 'F.Cu').lines.join('\n');

describe('constraint report', () => {
  it('names each rule it considers, in order', () => {
    const text = linesOf(`(version 1)
      (rule "first"  (constraint clearance (min 0.3mm)))
      (rule "second" (constraint clearance (min 0.7mm)))`);

    expect(text).toContain('Checking first.');
    expect(text).toContain('Checking second.');
    expect(text.indexOf('Checking first.')).toBeLessThan(text.indexOf('Checking second.'));
  });

  it('ends with the value that won', () => {
    const text = linesOf(`(version 1) (rule "wide" (constraint clearance (min 0.5mm)))`);

    expect(text).toContain(`Resolved clearance: min ${MM(0.5)}.`);
  });

  it('says why a rule whose condition fails was ignored', () => {
    const text = linesOf(`(version 1)
      (rule "hv" (constraint clearance (min 1.5mm)) (condition "A.NetClass == 'HV'"))`);

    expect(text).toContain("Checking rule condition 'A.NetClass == 'HV''.");
    expect(text).toContain('Condition not satisfied; rule ignored.');
  });

  it('says why a rule on another layer was ignored', () => {
    const text = linesOf(`(version 1)
      (rule "inner" (layer inner) (constraint clearance (min 1mm)))`);

    expect(text).toContain("Rule layer 'inner' not matched; rule ignored.");
  });

  it('distinguishes an unconditional rule from a conditional one', () => {
    expect(linesOf(`(version 1) (rule "r" (constraint clearance (min 1mm)))`)).toContain(
      'Unconditional rule applied; overrides previous constraints.',
    );

    const conditional = linesOf(
      `(version 1) (rule "r" (constraint clearance (min 1mm)) (condition "A.Type == 'Track'"))`,
    );
    expect(conditional).toContain('Rule applied; overrides previous constraints.');
  });

  it('calls an implicit rule a constraint, not a rule', () => {
    // Board setup and netclass rules are synthetic; upstream words their
    // outcome differently so a user is not sent looking for a rule they never
    // wrote.
    const text = linesOf('');

    expect(text).toContain('Unconditional constraint applied.');
    expect(text).not.toContain('Unconditional rule applied');
  });

  it('reports a local override without consulting any rule', () => {
    const r = reportDrcConstraint(
      engineOf(`(version 1) (rule "wide" (constraint clearance (min 0.5mm)))`),
      'clearance',
      track(),
      track(),
      'F.Cu',
      MM(0.9),
    );

    expect(r.lines.join('\n')).toContain('Local override');
    expect(r.lines.join('\n')).not.toContain('Checking wide.');
    expect(r.resolved.value.min).toBe(MM(0.9));
  });

  it('says so when nothing defines the constraint at all', () => {
    const empty = buildDrcRuleEngine([], parseDrcRules(''));
    const r = reportDrcConstraint(empty, 'clearance', track(), track(), 'F.Cu');

    expect(r.lines.join('\n')).toContain('No clearance constraints defined.');
    expect(r.lines.join('\n')).toContain('Resolved clearance: no constraint.');
  });

  it('agrees with what the engine resolves', () => {
    // The report and the answer come from one walk, so they cannot diverge.
    const engine = engineOf(`(version 1)
      (rule "a" (constraint clearance (min 0.3mm)))
      (rule "b" (constraint clearance (min 0.7mm)))`);
    const r = reportDrcConstraint(engine, 'clearance', track(), track(), 'F.Cu');

    expect(r.resolved.value.min).toBe(MM(0.7));
    expect(r.resolved.rule?.name).toBe('b');
    expect(r.lines.join('\n')).toContain(`Resolved clearance: min ${MM(0.7)}.`);
  });

  it('reports min, opt and max together when a rule sets them', () => {
    const engine = engineOf(
      `(version 1) (rule "w" (constraint track_width (min 0.1mm) (opt 0.2mm) (max 1mm)))`,
      [],
    );
    const r = reportDrcConstraint(engine, 'track_width', track(), undefined, 'F.Cu');

    expect(r.lines.join('\n')).toContain(
      `Resolved track_width: min ${MM(0.1)}; opt ${MM(0.2)}; max ${MM(1)}.`,
    );
  });
});
