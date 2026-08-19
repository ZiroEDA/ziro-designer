// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which netclasses a net belongs to.
 * Counterpart: `NET_SETTINGS::GetEffectiveNetClass` and
 * `NETCLASS::ContainsNetclassWithName` (common/project/net_settings.cpp,
 * common/netclass.cpp).
 *
 * A net's effective netclass is an *aggregate*: every pattern that matches
 * contributes a constituent, and membership tests ask whether any constituent
 * carries the name. Code that only wants one label (the netlist's `netclass`
 * field) takes the first match; code that filters by class has to consider all
 * of them, or a net in both `Power` and `HighVoltage` would be invisible to a
 * filter on the second.
 */

import { CombinedMatcherContext, EdaCombinedMatcher } from '@ziroeda/common';

/** One `net_settings.netclass_patterns` row. */
export interface NetClassAssignmentLike {
  pattern: string;
  netClass: string;
}

/**
 * Upstream keeps one EDA_COMBINED_MATCHER per assignment row for the life of
 * the NET_SETTINGS (net_settings.cpp:614); we are handed plain strings, so
 * cache by pattern instead of recompiling two regexes per net per repaint.
 */
const MATCHERS = new Map<string, EdaCombinedMatcher>();

/**
 * `EDA_COMBINED_MATCHER( pattern, CTX_NETCLASS ).StartsWith( netName )`, the
 * predicate NET_SETTINGS::GetEffectiveNetClass applies (net_settings.cpp:807).
 *
 * CTX_NETCLASS is NOT a glob: it builds an anchored regular-expression matcher
 * AND an anchored wildcard matcher, and a net is selected when either fires.
 * So `.`, `+`, `[]`, `|` and friends keep their regex meaning on top of their
 * literal one, and — no wxRE_ICASE — the match is case-sensitive.
 */
export function netclassMatches(pattern: string, netName: string): boolean {
  let matcher = MATCHERS.get(pattern);
  if (!matcher) {
    matcher = new EdaCombinedMatcher(pattern, CombinedMatcherContext.NETCLASS);
    MATCHERS.set(pattern, matcher);
  }
  return matcher.startsWith(netName);
}

/**
 * The single netclass label a net reports, the first matching assignment.
 * This is what a netlist's `(netclass …)` field carries.
 */
export function netClassFor(name: string, assignments: readonly NetClassAssignmentLike[]): string {
  for (const assignment of assignments) {
    if (netclassMatches(assignment.pattern, name)) return assignment.netClass;
  }
  return 'Default';
}

/**
 * Every netclass a net belongs to — the constituent set
 * `ContainsNetclassWithName` searches.
 *
 * An unmatched net is in Default, and `<no net>` is forced into it. Explicit
 * label assignments and bus-member inheritance are not modelled: the board
 * carries pattern assignments only.
 */
export function netclassesForNet(
  name: string,
  assignments: readonly NetClassAssignmentLike[],
): string[] {
  if (name === '') return ['Default'];

  const out: string[] = [];

  for (const assignment of assignments) {
    if (!assignment.pattern || !assignment.netClass) continue;
    if (!netclassMatches(assignment.pattern, name)) continue;
    if (!out.includes(assignment.netClass)) out.push(assignment.netClass);
  }

  return out.length > 0 ? out : ['Default'];
}
