// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Navigator's tree. Counterparts: `GetNetNavigatorItemText` and
 * `SCH_EDIT_FRAME::MakeNetNavigatorNode` (eeschema/net_navigator.cpp), plus
 * `SelectNextPrevNetNavigatorItem` behind Tab / Shift+Tab.
 *
 * A net becomes a node and everything connected to it becomes a leaf, each
 * described in words rather than by shape — "Symbol 'R1' pin '2'", "Wire from
 * (a, b) to (c, d)". The tree is how you walk a net without hunting the canvas,
 * and clicking a leaf selects the item it names.
 *
 * Upstream groups the leaves by sheet path under each net. We work on the open
 * sheet, like the rest of our connectivity, so a net's leaves sit directly
 * under it — the grouping level would have exactly one child.
 *
 * Two behaviours are worth stating because they differ from their neighbours:
 *
 *  - **Tab and Shift+Tab wrap.** `SelectNextPrevNetNavigatorItem` walks past the
 *    end to the beginning and vice versa, unlike the ERC marker stepping, which
 *    deliberately stops. Both are in this codebase now; they are not the same.
 *  - **A graphic line says so.** A line that is neither wire nor bus resolves to
 *    "Graphic line not connectable" rather than being left out, so a tree that
 *    somehow contains one explains itself.
 */

import type { LibSymbol, Schematic } from '../types.js';
import { computeNetlist, enumeratePins } from '../connectivity/nets.js';
import { refId } from './hittest.js';

/** One leaf: an item on the net, and the words that describe it. */
export interface NetNavigatorItem {
  /** The item's selection id, so a click can cross-probe to the canvas. */
  id: string;
  text: string;
}

/** One net node and its leaves, in the order the connectivity produced them. */
export interface NetNavigatorNet {
  name: string;
  items: NetNavigatorItem[];
}

/** Formats an internal-unit distance the way the frame shows it. */
export type ValueFormatter = (iu: number) => string;

const LABEL_TITLE: Record<string, string> = {
  label: 'Label',
  global_label: 'Global label',
  hierarchical_label: 'Hierarchical label',
};

/**
 * `GetNetNavigatorItemText` for one id, or null when the id names nothing on
 * this sheet. Exported so the panel and the tests describe items the same way.
 */
export function netNavigatorItemText(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  id: string,
  fmt: ValueFormatter,
): string | null {
  const at = (x: number, y: number): string => `(${fmt(x)}, ${fmt(y)})`;

  // A sheet pin is "<sheetRefId>:sheetpin<k>" and must be tested first: it does
  // not contain ":pin", but the reading order matters more than the fact does.
  const sheetPinAt = id.lastIndexOf(':sheetpin');
  if (sheetPinAt > 0) {
    const shId = id.slice(0, sheetPinAt);
    const k = Number(id.slice(sheetPinAt + ':sheetpin'.length));
    const sheet = sch.sheets.find((sh, i) => refId('sheet', sh.uuid, i) === shId);
    const pin = sheet?.pins[k];
    if (!sheet || !pin) return null;
    const name = sheet.fields.find((f) => f.key === 'Sheetname')?.value ?? '';
    return `Sheet '${name}' pin '${pin.name}'`;
  }

  // A symbol pin is "<symbolRef>:pin<n>"; everything else is an item's own refId.
  if (id.includes(':pin')) {
    const pin = enumeratePins(sch, libById).find((p) => p.id === id);
    if (!pin) return null;
    const name = pin.name && pin.name !== '~' ? ` (${pin.name})` : '';
    return `Symbol '${pin.refWithUnit}' pin '${pin.number}'${name}`;
  }

  const line = sch.lines.find((l, i) => refId('line', l.uuid, i) === id);
  if (line) {
    const span = `from ${at(line.start.x, line.start.y)} to ${at(line.end.x, line.end.y)}`;
    if (line.kind === 'wire') return `Wire ${span}`;
    if (line.kind === 'bus') return `Bus ${span}`;
    // Neither wire nor bus: upstream names it rather than dropping it.
    return 'Graphic line not connectable';
  }

  const label = sch.labels.find((l, i) => refId('label', l.uuid, i) === id);
  if (label) {
    const title = LABEL_TITLE[label.kind];
    // Plain text is not connectable and has no arm upstream.
    if (!title) return `Unhandled item type ${label.kind}`;
    return `${title} '${label.text}' at ${at(label.at.x, label.at.y)}`;
  }

  const junction = sch.junctions.find((j, i) => refId('junction', j.uuid, i) === id);
  if (junction) return `Junction at ${at(junction.at.x, junction.at.y)}`;

  const nc = sch.noConnects.find((n, i) => refId('noconnect', n.uuid, i) === id);
  if (nc) return `No-Connect at ${at(nc.at.x, nc.at.y)}`;

  const entry = sch.busEntries.find((e, i) => refId('busentry', e.uuid, i) === id);
  if (entry) {
    const end = { x: entry.at.x + entry.size.x, y: entry.at.y + entry.size.y };
    return `Bus to wire entry from ${at(entry.at.x, entry.at.y)} to ${at(end.x, end.y)}`;
  }

  const directive = (sch.directiveLabels ?? []).find(
    (d, i) => refId('directive', d.uuid, i) === id,
  );
  if (directive) {
    return `Netclass label '${directive.text ?? ''}' at ${at(directive.at.x, directive.at.y)}`;
  }

  return null;
}

/**
 * The whole tree: every net with a name, each carrying the items connectivity
 * put on it. Nets are listed in name order, as the navigator's root children
 * are.
 */
export function buildNetNavigator(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  fmt: ValueFormatter,
): NetNavigatorNet[] {
  const netlist = computeNetlist(sch, libById);
  const out: NetNavigatorNet[] = [];
  for (const net of netlist.nets) {
    const items: NetNavigatorItem[] = [];
    for (const id of net.items) {
      const text = netNavigatorItemText(sch, libById, id, fmt);
      if (text !== null) items.push({ id, text });
    }
    if (items.length) out.push({ name: net.name, items });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Tab / Shift+Tab: the next leaf of the tree, **wrapping** at either end.
 *
 * `order` is every leaf in tree order — upstream flattens the tree first, so
 * stepping crosses from one net's last item to the next net's first. An id that
 * is not in the tree moves nowhere, which is upstream's `find` failing.
 */
export function stepNetItem(
  order: readonly string[],
  current: string | null,
  forward: boolean,
): string | null {
  if (!order.length || current === null) return null;
  const at = order.indexOf(current);
  if (at < 0) return null;
  const n = order.length;
  return order[forward ? (at + 1) % n : (at - 1 + n) % n] ?? null;
}

/** Every leaf id in tree order, which is what `stepNetItem` walks. */
export const netNavigatorOrder = (tree: readonly NetNavigatorNet[]): string[] =>
  tree.flatMap((n) => n.items.map((i) => i.id));

/** The net a given item belongs to, for "Find in Net Navigator". */
export const netOfItem = (tree: readonly NetNavigatorNet[], id: string): string | null =>
  tree.find((n) => n.items.some((i) => i.id === id))?.name ?? null;
