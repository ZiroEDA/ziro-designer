// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Clearance and Constraints Resolution, assembled for display.
 * Counterpart: `BOARD_INSPECTION_TOOL::reportClearance` and
 * `InspectConstraints` in `pcbnew/tools/board_inspection_tool.cpp`.
 *
 * The rule walk itself lives in drc_rules_engine.ts and is the same one DRC
 * uses. This module only decides *which* constraints to ask about for a given
 * pair of items and how to head each section — which is the part that differs
 * between the two dialogs, and the part upstream keeps in the tool rather than
 * the engine.
 */

import { pcbIuToMM as iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { DrcConstraintType, DrcRuleSet } from './drc_rule.js';
import {
  buildDrcRuleEngine,
  type DrcEvalItem,
  type DrcRuleEngine,
  reportDrcConstraint,
} from './drc_rules_engine.js';

/** One headed block of the report, as a dialog renders one page. */
export interface InspectSection {
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

    return { title: TITLES[type] ?? `${type} resolution for:`, subjects, lines };
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
    return { title: `${type} resolution for:`, subjects, lines };
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
