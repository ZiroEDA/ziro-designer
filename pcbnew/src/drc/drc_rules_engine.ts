// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Resolving a constraint from the rule set.
 * Counterpart: `pcbnew/drc/drc_engine.cpp` (`DRC_ENGINE::compileRules`,
 * `DRC_ENGINE::EvalRules`) and `pcbnew/pcbexpr_evaluator.cpp` for what `A` and
 * `B` mean.
 *
 * The resolution order is the whole point, and it is easy to get backwards:
 *
 *   1. A local override on the item itself wins outright and returns at once
 *      (a pad's own clearance beats every rule).
 *   2. Otherwise every rule whose layer and condition match is applied **in
 *      order**, each overwriting the min/opt/max it sets. Implicit rules —
 *      board setup and netclasses — are loaded first and user `.kicad_dru`
 *      rules after, so **the last match wins** and a user rule overrides the
 *      netclass default rather than the other way round.
 *
 * A rule that sets only `max` leaves an earlier rule's `min` standing; upstream
 * copies the three values independently, so they resolve independently too.
 */

import { testDrcCondition, type DrcExprContext } from './drc_expr.js';
import type {
  DrcConstraint,
  DrcConstraintType,
  DrcDisallow,
  DrcRule,
  DrcRuleSet,
  DrcSeverity,
  MinOptMax,
} from './drc_rule.js';

/** The item kinds `A.Type` can report, spelled as upstream spells them. */
export type DrcItemType =
  | 'Track'
  | 'Arc'
  | 'Via'
  | 'Pad'
  | 'Zone'
  | 'Footprint'
  | 'Text'
  | 'Graphic'
  | 'Hole';

/**
 * What `A` or `B` resolves to. The caller builds this from a board item; this
 * module never touches the board itself.
 */
export interface DrcEvalItem {
  type: DrcItemType;
  /** The item's own layer, for the layer test and `A.Layer`. */
  layer?: string;
  /** Every layer the item is on, for items that span several. */
  layers?: string[];
  netName?: string;
  /**
   * Every netclass the item belongs to. `A.NetClass == 'X'` matches when *any*
   * constituent is named X — upstream compares per-constituent, not against the
   * aggregate name, so a net in both Power and HighVoltage answers to either.
   */
  netClasses?: string[];
  /** Anything else a condition might ask for: Width, Orientation, … */
  props?: Record<string, string | number | undefined>;
  /** `A.insideArea('x')` and friends; the caller knows the board geometry. */
  test?: (fn: string, args: string[]) => boolean | undefined;
}

/** A rule paired with how it entered the engine. */
export interface EngineRule {
  rule: DrcRule;
  /**
   * Implicit rules are the ones the app synthesises from Board Setup and the
   * netclasses, as `DRC_ENGINE::loadImplicitRules` does. They are ordered
   * before user rules so a user rule can override them.
   */
  implicit: boolean;
}

/** One constraint, ready to evaluate, with its parent rule. */
interface IndexedConstraint {
  constraint: DrcConstraint;
  rule: DrcRule;
  implicit: boolean;
}

/** The compiled rule set: constraints bucketed by type, in resolution order. */
export interface DrcRuleEngine {
  byType: Map<DrcConstraintType, IndexedConstraint[]>;
  /** Conditions that would not compile, so a caller can surface them. */
  errors: string[];
}

/**
 * DRC_ENGINE::compileRules. Implicit rules first, user rules after — the order
 * is what makes a user rule win.
 */
export function buildDrcRuleEngine(
  implicit: readonly DrcRule[],
  user: DrcRuleSet | readonly DrcRule[],
): DrcRuleEngine {
  const userRules = Array.isArray(user) ? user : (user as DrcRuleSet).rules;
  const errors = Array.isArray(user) ? [] : [...(user as DrcRuleSet).errors];

  const byType = new Map<DrcConstraintType, IndexedConstraint[]>();

  const add = (rule: DrcRule, isImplicit: boolean): void => {
    for (const constraint of rule.constraints) {
      const list = byType.get(constraint.type);
      const entry: IndexedConstraint = { constraint, rule, implicit: isImplicit };
      if (list) list.push(entry);
      else byType.set(constraint.type, [entry]);
    }
  };

  for (const r of implicit) add(r, true);
  for (const r of userRules) add(r, false);

  return { byType, errors };
}

/** EDA_COMBINED_MATCHER's wildcard mode: `*` and `?`, anchored. */
function wildcardMatch(pattern: string, text: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return pattern === text;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(text);
  } catch {
    return false;
  }
}

/**
 * `(layer …)`: a layer name, or one of the two groups.
 *
 * A rule with no `(layer …)` applies everywhere. `outer` is the two copper
 * faces; `inner` is every copper layer between them.
 */
export function ruleMatchesLayer(rule: DrcRule, layer: string | undefined): boolean {
  if (!rule.layer) return true;
  if (layer === undefined) return true;

  if (rule.layer === 'outer') return layer === 'F.Cu' || layer === 'B.Cu';
  if (rule.layer === 'inner') return /^In\d+\.Cu$/.test(layer);

  return rule.layer === layer;
}

/** The expression context for one (A, B, layer) triple. */
function contextFor(a: DrcEvalItem | undefined, b: DrcEvalItem | undefined): DrcExprContext {
  const pick = (which: 'A' | 'B'): DrcEvalItem | undefined => (which === 'A' ? a : b);

  return {
    property: (which, name) => {
      const item = pick(which);
      if (!item) return undefined;

      // PCBEXPR compares field names case-insensitively.
      switch (name.toLowerCase()) {
        case 'type':
          return item.type;
        case 'layer':
          return item.layer;
        case 'netname':
          return item.netName;
        case 'netclass':
          // Returned as the aggregate; the `==` case below handles the
          // per-constituent match that upstream actually performs.
          return item.netClasses?.join(',');
        default:
          return item.props?.[name] ?? item.props?.[name.toLowerCase()];
      }
    },
    call: (which, fn, args) => pick(which)?.test?.(fn, args),
  };
}

/**
 * Does this condition hold?
 *
 * `A.NetClass == 'X'` is special-cased before the general evaluator, because
 * upstream tests each constituent netclass with wildcards rather than comparing
 * the aggregate string. A net in `Power` and `HighVoltage` must answer to a
 * rule on either, and a plain string compare against `"Power,HighVoltage"`
 * would answer to neither.
 */
function conditionHolds(
  condition: string | undefined,
  a: DrcEvalItem | undefined,
  b: DrcEvalItem | undefined,
  errors: string[],
): boolean {
  if (!condition || condition.trim() === '') return true;

  const netClassCompare = /^\s*([AB])\.NetClass\s*(==|!=)\s*['"]([^'"]*)['"]\s*$/i.exec(condition);
  if (netClassCompare) {
    const item = netClassCompare[1]!.toUpperCase() === 'A' ? a : b;
    const classes = item?.netClasses ?? [];
    const hit = classes.some((c) => wildcardMatch(netClassCompare[3]!, c));
    return netClassCompare[2] === '==' ? hit : !hit;
  }

  const { matched, error } = testDrcCondition(condition, contextFor(a, b));
  if (error && !errors.includes(error)) errors.push(error);
  return matched;
}

/** What a lookup resolved to. */
export interface ResolvedConstraint {
  type: DrcConstraintType;
  value: MinOptMax;
  /** The rule that supplied the winning value, if any. */
  rule?: DrcRule;
  /** True when nothing but an implicit rule matched. */
  implicit: boolean;
  severity: DrcSeverity;
  disallow?: DrcDisallow[];
  zoneConnection?: DrcConstraint['zoneConnection'];
  assertion?: string;
  /** Conditions that would not compile while resolving this one. */
  errors: string[];
}

/**
 * DRC_ENGINE::EvalRules.
 *
 * `localOverride` is the item's own value, checked first and returned at once —
 * a pad's clearance beats every rule, which is why it cannot simply be modelled
 * as another rule at the end of the list.
 */
export function evalDrcRules(
  engine: DrcRuleEngine,
  type: DrcConstraintType,
  a: DrcEvalItem | undefined,
  b: DrcEvalItem | undefined,
  layer?: string,
  localOverride?: number,
): ResolvedConstraint {
  const out: ResolvedConstraint = {
    type,
    value: {},
    implicit: true,
    severity: 'error',
    errors: [],
  };

  if (localOverride !== undefined) {
    out.value = { min: localOverride };
    return out;
  }

  for (const entry of engine.byType.get(type) ?? []) {
    if (!ruleMatchesLayer(entry.rule, layer)) continue;
    // A netclass-derived rule has no condition to test upstream either.
    if (!conditionHolds(entry.rule.condition, a, b, out.errors)) continue;

    // Each of the three is copied independently, so a rule setting only `max`
    // leaves an earlier `min` standing.
    const v = entry.constraint.value;
    if (v.min !== undefined) out.value.min = v.min;
    if (v.opt !== undefined) out.value.opt = v.opt;
    if (v.max !== undefined) out.value.max = v.max;

    if (entry.constraint.disallow) out.disallow = entry.constraint.disallow;
    if (entry.constraint.zoneConnection) out.zoneConnection = entry.constraint.zoneConnection;
    if (entry.constraint.assertion) out.assertion = entry.constraint.assertion;

    out.rule = entry.rule;
    out.implicit = entry.implicit;
    if (entry.rule.severity) out.severity = entry.rule.severity;
  }

  return out;
}

/**
 * The implicit rules a board's own settings imply, as
 * `DRC_ENGINE::loadImplicitRules` synthesises them.
 *
 * Modelling the board defaults as rules rather than as a separate fallback is
 * upstream's design and it is what makes the override order fall out for free:
 * a user rule is simply later in the same list.
 */
export function boardSetupRules(defaults: {
  clearance?: number;
  trackWidth?: number;
  viaDiameter?: number;
  viaDrill?: number;
  holeToHole?: number;
  annularWidth?: number;
}): DrcRule[] {
  const rules: DrcRule[] = [];

  const rule = (name: string, type: DrcConstraintType, value: MinOptMax): void => {
    rules.push({ name, constraints: [{ type, value }] });
  };

  if (defaults.clearance !== undefined)
    rule('board setup constraints', 'clearance', { min: defaults.clearance });
  if (defaults.trackWidth !== undefined)
    rule('board setup constraints', 'track_width', { min: defaults.trackWidth });
  if (defaults.viaDiameter !== undefined)
    rule('board setup constraints', 'via_diameter', { min: defaults.viaDiameter });
  if (defaults.viaDrill !== undefined)
    rule('board setup constraints hole', 'hole_size', { min: defaults.viaDrill });
  if (defaults.holeToHole !== undefined)
    rule('board setup constraints hole to hole', 'hole_to_hole', { min: defaults.holeToHole });
  if (defaults.annularWidth !== undefined)
    rule('board setup constraints annular width', 'annular_width', {
      min: defaults.annularWidth,
    });

  return rules;
}

/** The netclass rules `loadImplicitRules` builds, one per class. */
export function netClassRules(
  classes: readonly { name: string; clearance?: number; trackWidth?: number }[],
): DrcRule[] {
  const rules: DrcRule[] = [];

  for (const c of classes) {
    if (c.clearance !== undefined) {
      rules.push({
        name: `netclass '${c.name}'`,
        condition: `A.NetClass == '${c.name}'`,
        constraints: [{ type: 'clearance', value: { min: c.clearance } }],
      });
    }
    if (c.trackWidth !== undefined) {
      rules.push({
        name: `netclass '${c.name}'`,
        condition: `A.NetClass == '${c.name}'`,
        constraints: [{ type: 'track_width', value: { min: c.trackWidth } }],
      });
    }
  }

  return rules;
}
