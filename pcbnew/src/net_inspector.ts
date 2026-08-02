// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Inspector's rows.
 * Counterpart: `PCB_NET_INSPECTOR_PANEL` and its data model.
 *
 * Upstream's columns are: name, net chain, netclass, total length, net chain
 * length, via count, via length, board length, pad-die length, pad count.
 *
 * The four *counting* columns are ported. The four *length* ones are not, and
 * deliberately: upstream measures them with LENGTH_DELAY_CALCULATION, which
 * optimises the routed path — merging tracks, trimming what runs inside pads,
 * folding in via and pad-to-die contributions. A naive sum of segment lengths
 * would put a number in the column that quietly disagrees with the one KiCad
 * shows for the same board, and a length that is subtly wrong is worse than a
 * column that is honestly absent. The same reasoning kept `length` and `skew`
 * out of the DRC constraints.
 */

import type { Board } from './types.js';

export interface NetRow {
  net: number;
  name: string;
  /** Every netclass the net belongs to, joined as the panel shows them. */
  netclass: string;
  padCount: number;
  viaCount: number;
  /** Tracks and arcs on the net; not one of upstream's columns, but free. */
  trackCount: number;
}

/**
 * One row per net that exists on the board.
 *
 * Net 0 is excluded: it is the unconnected pseudo-net, not something a user
 * assigns a netclass to or routes. Upstream's panel likewise lists real nets.
 */
export function netInspectorRows(
  board: Board,
  netClassesOf: (netName: string) => readonly string[] = () => [],
): NetRow[] {
  const rows = new Map<number, NetRow>();

  const rowFor = (net: number): NetRow | undefined => {
    if (net <= 0) return undefined;

    let row = rows.get(net);
    if (!row) {
      const name = board.nets.get(net) ?? '';
      row = {
        net,
        name,
        netclass: [...netClassesOf(name)].join(', '),
        padCount: 0,
        viaCount: 0,
        trackCount: 0,
      };
      rows.set(net, row);
    }
    return row;
  };

  // Seed from the net table so a net with no copper on it still gets a row —
  // an unrouted net with zero of everything is exactly what the panel is used
  // to find.
  for (const [net] of board.nets) rowFor(net);

  for (const t of board.tracks) {
    const r = rowFor(t.net);
    if (r) r.trackCount++;
  }

  for (const a of board.arcs) {
    const r = rowFor(a.net);
    if (r) r.trackCount++;
  }

  for (const v of board.vias) {
    const r = rowFor(v.net);
    if (r) r.viaCount++;
  }

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      const r = rowFor(pad.net ?? 0);
      if (r) r.padCount++;
    }
  }

  // Sorted by name, as the panel opens: nets are looked up by name far more
  // often than by the net code the file happens to have given them.
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The panel's summary line: how many nets, and how many are unrouted. */
export function netInspectorSummary(rows: readonly NetRow[]): {
  nets: number;
  unrouted: number;
} {
  return {
    nets: rows.length,
    // A net with pads but no copper joining them has not been routed. One with
    // no pads either is a stray net entry, not an unrouted connection.
    unrouted: rows.filter((r) => r.padCount > 1 && r.trackCount === 0 && r.viaCount === 0).length,
  };
}
