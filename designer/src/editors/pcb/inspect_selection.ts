// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Turning the editor's selection into a Clearance / Constraints Resolution
 * report. Counterpart: the selection handling at the top of
 * `BOARD_INSPECTION_TOOL::InspectClearance`.
 *
 * This is a module rather than a closure inside PcbEditor so it can be tested:
 * which items a selection resolves to, and which report that produces, is
 * logic — the dialog around it is not.
 */

import {
  type Board,
  buildClearanceReport,
  buildConstraintsReport,
  type DrcItemType,
  type DrcRuleSet,
  type InspectItem,
  type InspectSection,
  parseBoardItemId,
} from '@ziroeda/pcbnew';

/** What a selection key resolves to, before it becomes an InspectItem. */
interface Described {
  desc: string;
  type: DrcItemType;
  layer: string;
  net: number;
}

/**
 * The board item behind a selection key, described the way the report names
 * it. Kinds with no copper to resolve a clearance against — graphics, text,
 * groups — return nothing rather than a section that could say nothing useful.
 */
export function describeSelected(board: Board, id: string): Described | null {
  const ref = parseBoardItemId(id);
  if (!ref) return null;

  const netName = (net: number): string => board.nets.get(net) || `net ${net}`;

  switch (ref.kind) {
    case 'track':
    case 'arc': {
      const t = ref.kind === 'track' ? board.tracks[ref.index] : board.arcs[ref.index];
      if (!t) return null;
      return {
        desc: `Track [${netName(t.net)}] on ${t.layer}`,
        type: ref.kind === 'track' ? 'Track' : 'Arc',
        layer: t.layer,
        net: t.net,
      };
    }

    case 'via': {
      const v = board.vias[ref.index];
      if (!v) return null;
      return { desc: `Via [${netName(v.net)}]`, type: 'Via', layer: v.layers[0], net: v.net };
    }

    case 'pad': {
      const fp = board.footprints[ref.index];
      const pad = fp?.pads[ref.sub ?? 0];
      if (!fp || !pad) return null;
      return {
        desc: `Pad ${pad.number} of ${fp.reference ?? fp.lib}`,
        type: 'Pad',
        layer: pad.layers[0] ?? 'F.Cu',
        net: pad.net ?? 0,
      };
    }

    case 'zone': {
      const z = board.zones[ref.index];
      if (!z) return null;
      return {
        desc: z.name ? `Zone '${z.name}'` : `Zone [${netName(z.net)}]`,
        type: 'Zone',
        layer: z.layers[0] ?? 'F.Cu',
        net: z.net,
      };
    }

    default:
      return null;
  }
}

/**
 * The report for a selection: two items give a clearance resolution, one gives
 * a constraints resolution, anything else gives nothing.
 *
 * Upstream lets a user pick the items interactively when the selection is not
 * already a pair; here the menu entries are simply disabled until it is, which
 * says the same thing without a modal picker.
 */
export function inspectSelection(
  board: Board,
  selection: Iterable<string>,
  rules: DrcRuleSet,
  netClassesOf: (netName: string) => readonly string[],
): InspectSection[] {
  const picked: Described[] = [];

  for (const id of selection) {
    const d = describeSelected(board, id);
    if (d) picked.push(d);
  }

  const toItem = (d: Described): InspectItem => ({
    desc: d.desc,
    eval: {
      type: d.type,
      layer: d.layer,
      netName: board.nets.get(d.net),
      netClasses: [...netClassesOf(board.nets.get(d.net) ?? '')],
    },
  });

  if (picked.length === 2)
    return buildClearanceReport(rules, toItem(picked[0]!), toItem(picked[1]!), picked[0]!.layer);

  if (picked.length === 1)
    return buildConstraintsReport(rules, toItem(picked[0]!), picked[0]!.layer);

  return [];
}
