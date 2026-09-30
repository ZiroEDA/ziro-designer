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
 *
 * The second half of this file (from `InspectSection` down) is the report
 * itself, formerly `drc/drc_inspect.ts`: `BOARD_INSPECTION_TOOL::reportClearance`
 * and `InspectConstraints`. The rule walk lives in `drc/drc_rules_engine.ts` and
 * is the same one DRC uses; this only decides *which* constraints to ask about
 * for a given pair of items and how to head each section, which upstream keeps
 * in the tool rather than the engine.
 */

import { pcbIuToMM as iuToMM } from '@ziroeda/common/eda_units.js';
import { EscapeHTML, unescapeString } from '@ziroeda/common/string_utils.js';
import type { DrcConstraintType, DrcRuleSet } from '../drc/drc_rule_view.js';
import {
  buildDrcRuleEngine,
  type DrcEvalItem,
  type DrcItemType,
  type DrcRuleEngine,
  reportDrcConstraint,
} from '../drc/drc_rules_engine.js';
import { parseBoardItemId } from '../edit-board.js';
import type { Board } from '../types.js';

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

  // Unescaped, like every other net name a person reads: `{slash}` is the file's
  // encoding of a `/` inside a label name, not part of what the net is called
  // (issue #626).
  const netName = (net: number): string =>
    unescapeString(board.nets.get(net) ?? '') || `net ${net}`;

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

/**
 * The selection as the DIALOG_BOOK_REPORTER BOARD_INSPECTION_TOOL fills:
 * PCB_EDIT_FRAME::GetInspectClearanceDialog is titled "Clearance Report" and
 * GetInspectConstraintsDialog "Constraints Report" (pcb_edit_frame.cpp:3318,
 * :3330), and each constraint goes on its upstream page (`inspectPages`).
 * `null` when the selection is neither one item nor a pair.
 */
export function inspectReport(
  board: Board,
  selection: Iterable<string>,
  rules: DrcRuleSet,
  netClassesOf: (netName: string) => readonly string[],
): { title: string; pages: InspectPage[] } | null {
  const ids = [...selection];
  const sections = inspectSelection(board, ids, rules, netClassesOf);
  if (sections.length === 0) return null;
  const pair = ids.filter((id) => describeSelected(board, id) !== null).length === 2;
  const layer = describeSelected(board, ids.find((id) => describeSelected(board, id))!)!.layer;
  return pair
    ? { title: 'Clearance Report', pages: inspectPages(sections, 'clearance', layer) }
    : { title: 'Constraints Report', pages: inspectPages(sections, 'constraints', layer) };
}

/** One headed block of the report, as a dialog renders one page. */
export interface InspectSection {
  /** The constraint this section reports, which names its notebook page. */
  type: DrcConstraintType;
  /** "Clearance resolution for:" and the like. */
  title: string;
  /** The layer and the item descriptions the question was asked about. */
  subjects: string[];
  /** The engine's reasoning, one line per step. */
  lines: string[];
}

export interface InspectItem {
  /** How the item is named in the report. */
  desc: string;
  /** What the rule engine matches against. */
  eval: DrcEvalItem;
}

const mm = (iu: number): string =>
  `${iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} mm`;

/**
 * The constraints upstream reports for a pair of items, in its order.
 *
 * A pad against a zone is the case with the most to say: the zone connection
 * decides whether the other three are even meaningful, so it comes first.
 */
function constraintsFor(a: InspectItem, b: InspectItem): DrcConstraintType[] {
  const kinds = [a.eval.type, b.eval.type];
  const padToZone = kinds.includes('Pad') && kinds.includes('Zone');

  if (padToZone)
    return [
      'zone_connection',
      'thermal_relief_gap',
      'thermal_spoke_width',
      'min_resolved_spokes',
      'clearance',
    ];

  return ['clearance'];
}

/** The human title for each constraint's section. */
/** reportHeader's titles in InspectConstraints (board_inspection_tool.cpp:1701-1824). */
const CONSTRAINT_TITLES: Partial<Record<DrcConstraintType, string>> = {
  track_width: 'Track width resolution for:',
  via_diameter: 'Via diameter resolution for:',
  annular_width: 'Via annular width resolution for:',
  hole_size: 'Hole size resolution for:',
  text_height: 'Text height resolution for:',
  text_thickness: 'Text thickness resolution for:',
  track_angle: 'Track Angle resolution for:',
  track_segment_length: 'Track segment length resolution for:',
  clearance: 'Clearance resolution for:',
};

const TITLES: Partial<Record<DrcConstraintType, string>> = {
  clearance: 'Clearance resolution for:',
  zone_connection: 'Zone connection resolution for:',
  thermal_relief_gap: 'Thermal-relief gap resolution for:',
  thermal_spoke_width: 'Thermal-relief spoke width resolution for:',
  min_resolved_spokes: 'Thermal-relief min spoke count resolution for:',
  hole_clearance: 'Hole clearance resolution for:',
  edge_clearance: 'Edge clearance resolution for:',
  physical_clearance: 'Physical clearance resolution for:',
};

/**
 * `reportClearance`: why these two items resolve to the clearance they do.
 *
 * `localOverride` is the item's own clearance, which wins outright — the
 * report says so and stops, because consulting rules whose answer cannot be
 * used would suggest they were involved.
 */
export function buildClearanceReport(
  rules: DrcRuleSet | DrcRuleEngine,
  a: InspectItem,
  b: InspectItem,
  layer: string,
  localOverride?: number,
): InspectSection[] {
  const engine = 'byType' in rules ? rules : buildDrcRuleEngine([], rules);
  const subjects = [`Layer ${layer}`, a.desc, b.desc];

  return constraintsFor(a, b).map((type) => {
    const { lines } = reportDrcConstraint(
      engine,
      type,
      a.eval,
      b.eval,
      layer,
      type === 'clearance' ? localOverride : undefined,
    );

    return { title: TITLES[type] ?? `${type} resolution for:`, subjects, lines, type };
  });
}

/**
 * `InspectConstraints`: what every constraint resolves to for one item.
 *
 * Unlike the clearance report this asks about a single item, so the
 * constraints are the ones an item can carry on its own — the pairwise ones
 * have no second item to be measured against and are left out rather than
 * reported against nothing.
 */
export function buildConstraintsReport(
  rules: DrcRuleSet | DrcRuleEngine,
  item: InspectItem,
  layer: string,
): InspectSection[] {
  const engine = 'byType' in rules ? rules : buildDrcRuleEngine([], rules);
  const subjects = [`Layer ${layer}`, item.desc];

  const single: DrcConstraintType[] =
    item.eval.type === 'Via'
      ? ['via_diameter', 'hole_size', 'annular_width']
      : item.eval.type === 'Track' || item.eval.type === 'Arc'
        ? ['track_width', 'track_segment_length', 'track_angle']
        : item.eval.type === 'Text'
          ? ['text_height', 'text_thickness']
          : ['clearance'];

  return single.map((type) => {
    const { lines } = reportDrcConstraint(engine, type, item.eval, undefined, layer);
    return { title: CONSTRAINT_TITLES[type] ?? `${type} resolution for:`, subjects, lines, type };
  });
}

/** The report as plain text, for a console, a clipboard or a snapshot. */
export function formatInspectReport(sections: readonly InspectSection[]): string {
  return sections
    .map((s) =>
      [s.title, ...s.subjects.map((x) => `  - ${x}`), ...s.lines.map((x) => `  ${x}`)].join('\n'),
    )
    .join('\n\n');
}

export { mm as formatInspectValue };

/** One DIALOG_BOOK_REPORTER page: its tab caption and what was Report()ed. */
export interface InspectPage {
  title: string;
  messages: string[];
}

/**
 * The notebook page each constraint is reported on, as
 * BOARD_INSPECTION_TOOL::InspectClearance (board_inspection_tool.cpp:1035-1530)
 * and InspectConstraints (:1686-1900) name them. A copper clearance goes on a
 * page named for its layer (`AddHTMLPage( GetLayerName( layer ) )`), and the
 * four zone checks share the one "Zone" page.
 *
 * `track_angle` and `track_segment_length` are not on upstream's constraints
 * report; they are InspectDRCError's pages (:638, :653), whose captions they
 * keep.
 */
function pageTitle(
  type: DrcConstraintType,
  report: 'clearance' | 'constraints',
  layerName: string,
): string {
  switch (type) {
    case 'clearance':
      return layerName;
    case 'zone_connection':
    case 'thermal_relief_gap':
    case 'thermal_spoke_width':
    case 'min_resolved_spokes':
      return 'Zone';
    case 'hole_clearance':
      return 'Hole';
    case 'edge_clearance':
      return `${layerName} Clearance`;
    case 'physical_clearance':
      return 'Physical Clearances';
    case 'track_width':
      return 'Track Width';
    case 'via_diameter':
      return 'Via Diameter';
    case 'annular_width':
      return report === 'constraints' ? 'Via Annular Width' : 'Via Annulus';
    case 'hole_size':
      return 'Hole Size';
    case 'text_height':
    case 'text_thickness':
      return report === 'constraints'
        ? 'Text Size'
        : type === 'text_height'
          ? 'Text Height'
          : 'Text Thickness';
    case 'track_angle':
      return 'Track Angle';
    case 'track_segment_length':
      return 'Track Segment Length';
    default:
      return type;
  }
}

/**
 * The sections as BOARD_INSPECTION_TOOL writes them into the dialog: one
 * page per caption (sections sharing a caption share its page, in order), each
 * opened by `reportHeader` - `<h7>title</h7>` and the subjects as a `<ul>` -
 * then a blank line and the engine's reasoning. Every piece of text is
 * EscapeHTML()'d, as upstream escapes each item description: a net or
 * reference name is the board's, not markup.
 */
export function inspectPages(
  sections: readonly InspectSection[],
  report: 'clearance' | 'constraints',
  layerName: string,
): InspectPage[] {
  const pages: InspectPage[] = [];
  for (const s of sections) {
    const title = pageTitle(s.type, report, layerName);
    let page = pages.find((p) => p.title === title);
    if (!page) {
      page = { title, messages: [] };
      pages.push(page);
    }
    page.messages.push(`<h7>${EscapeHTML(s.title)}</h7>`);
    page.messages.push(`<ul>${s.subjects.map((x) => `<li>${EscapeHTML(x)}</li>`).join('')}</ul>`);
    page.messages.push('');
    for (const line of s.lines) page.messages.push(EscapeHTML(line));
    page.messages.push('');
  }
  return pages;
}
