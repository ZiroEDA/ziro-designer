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
