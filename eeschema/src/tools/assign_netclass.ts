// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Netclass — which net-name *patterns* a selection turns into.
 * Counterpart: `SCH_EDITOR_CONTROL::AssignNetclass` and its local
 * `getNetNamePattern` lambda (eeschema/tools/sch_editor_control.cpp).
 *
 * A netclass is not attached to a net; it is attached to a *pattern* that nets
 * are matched against (`NET_SETTINGS`'s assignment list). So the whole of this
 * action's logic is turning what the user selected into the right pattern
 * strings, and that is what lives here — the dialog then only has to pick a
 * netclass name.
 *
 * The rule has three arms, and the bus ones are the reason it is not simply
 * "use the net name":
 *
 *   - a **bus vector** (`D[0..7]`) becomes `D*`, so the class covers every
 *     member rather than the bus itself;
 *   - a **bus group** (`{USB SDA SCL}`) becomes `PREFIX.*`, matching the
 *     members' qualified names;
 *   - anything else is the net name as-is.
 *
 * And one refusal: a net whose driver is weaker than a sheet pin has no name a
 * user chose, so there is nothing stable to write a pattern against. Upstream
 * rejects the whole action in that case rather than assigning to an
 * auto-generated name that will change on the next edit.
 */

import { parseBusVector, parseBusGroup } from '../connectivity/bus.js';
import { Priority } from '../connectivity/nets.js';

/** What the action needs to know about one selected net. */
export interface SelectedNet {
  /** `SCH_CONNECTION::Name()`, the net's resolved name. */
  name: string;
  /** Whether the connection is a bus rather than a single net. */
  isBus: boolean;
  /** The naming driver's priority (CONNECTION_SUBGRAPH::GetDriverPriority). */
  driverPriority: Priority;
}

/**
 * `getNetNamePattern`: the pattern one connection contributes, or null when it
 * has no name worth assigning to.
 */
export function netNamePattern(net: SelectedNet): string | null {
  if (net.isBus) {
    const vector = parseBusVector(net.name);
    if (vector) return `${vector.name}*`;
    const group = parseBusGroup(net.name);
    if (group) return `${group.name}.*`;
    // A bus that parses as neither falls through to the driver check below,
    // exactly as upstream's if/else-if chain does.
  }
  // `!aConn.Driver() || GetDriverPriority( ... ) < PRIORITY::SHEET_PIN`
  if (net.driverPriority < Priority.SheetPin) return null;
  return net.name;
}

export interface NetclassAssignmentPlan {
  /** The patterns to offer, de-duplicated and in sorted order (a std::set). */
  patterns: string[];
  /** Set when the action refuses; the message upstream shows in the info bar. */
  error?: string;
}

/**
 * The whole of `AssignNetclass`'s pre-dialog work: validate the selection and
 * reduce it to patterns.
 *
 * Both refusals are upstream's, verbatim in intent: an empty selection, and a
 * selection where *any* net is unlabeled. The second is an all-or-nothing test
 * on purpose — upstream's comment calls it out as a choice ("we can also allow
 * some un-labeled nets as long as some are labeled") — so it is not softened
 * here.
 */
export function planNetclassAssignment(nets: readonly SelectedNet[]): NetclassAssignmentPlan {
  if (nets.length === 0) return { patterns: [], error: 'No nets selected.' };

  const patterns = new Set<string>();
  for (const net of nets) {
    const pattern = netNamePattern(net);
    if (pattern === null) {
      return {
        patterns: [],
        error: 'All selected nets must be labeled to assign a netclass.',
      };
    }
    patterns.add(pattern);
  }
  // std::set<wxString> — sorted and unique.
  return { patterns: [...patterns].sort() };
}

/** One `(pattern, netclass)` row of NET_SETTINGS' assignment list. */
export interface NetclassAssignment {
  pattern: string;
  netClass: string;
}

/**
 * `NET_SETTINGS::ForEachBusMember`: the patterns a bus pattern stands for.
 *
 * A vector bus expands to its members; a group expands to its members and each
 * of those is expanded again, since a group member may itself be a vector.
 * Anything else yields itself.
 *
 * The expansion exists because the matchers read `[` and `{` as regex, not as
 * bus notation — an unexpanded `D[0..7]` would be matched as a character class
 * and would never hit `D0`.
 */
export function busMemberPatterns(pattern: string): string[] {
  const vector = parseBusVector(pattern);
  if (vector) return [...vector.members];
  const group = parseBusGroup(pattern);
  if (group) return group.members.flatMap((m) => busMemberPatterns(m));
  return [pattern];
}

/**
 * `NET_SETTINGS::SetNetclassPatternAssignment` — add one assignment, bus
 * patterns expanded.
 *
 * Note what upstream does *not* do: it never replaces an existing assignment
 * for the same pattern. `addSinglePatternAssignment` skips only an **exact**
 * duplicate — same pattern *and* same netclass — and otherwise appends, so one
 * pattern may legitimately carry several assignments and later de-duplication
 * decides which wins. Replacing would be the intuitive guess and would silently
 * drop a user's earlier rule.
 */
export function addNetclassAssignment(
  assignments: readonly NetclassAssignment[],
  pattern: string,
  netClass: string,
): NetclassAssignment[] {
  const out = [...assignments];
  for (const member of busMemberPatterns(pattern)) {
    if (out.some((a) => a.pattern === member && a.netClass === netClass)) continue;
    out.push({ pattern: member, netClass });
  }
  return out;
}
