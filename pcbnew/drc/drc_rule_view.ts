// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Custom design rules: the `.kicad_dru` model and its parser.
 * Counterparts: `pcbnew/drc/drc_rule.h` (DRC_RULE, DRC_CONSTRAINT,
 * MINOPTMAX) and `pcbnew/drc/drc_rule_parser.cpp` (DRC_RULES_PARSER).
 *
 * Board Setup has been able to edit `.kicad_dru` text since the Board Setup
 * work, but nothing read it. This is the first half of making it mean
 * something: text in, typed rules out. Evaluating a rule's condition lives in
 * drc_expr.ts; deciding which rule wins lives in drc_rules_engine.ts.
 *
 * A `.kicad_dru` file is:
 *
 *   (version 1)
 *   (rule "name"
 *     [(layer <name>|outer|inner)]
 *     [(severity error|warning|ignore|exclusion)]
 *     [(condition "<expression>")]
 *     (constraint <type> [(min <v>)] [(max <v>)] [(opt <v>)] | <enum> | "<expr>"))
 */

import { parse } from '@ziroeda/sexpr/src/index.js';
import { head, isList, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';

/** DRC_CONSTRAINT_T. Only the names appearing in `.kicad_dru` are listed. */
export type DrcConstraintType =
  | 'clearance'
  | 'creepage'
  | 'hole_clearance'
  | 'edge_clearance'
  | 'courtyard_clearance'
  | 'silk_clearance'
  | 'hole_to_hole'
  | 'hole_size'
  | 'text_height'
  | 'text_thickness'
  | 'track_width'
  | 'track_segment_length'
  | 'track_angle'
  | 'annular_width'
  | 'via_diameter'
  | 'via_count'
  | 'zone_connection'
  | 'thermal_relief_gap'
  | 'thermal_spoke_width'
  | 'min_resolved_spokes'
  | 'solder_mask_expansion'
  | 'solder_paste_abs_margin'
  | 'solder_paste_rel_margin'
  | 'physical_clearance'
  | 'physical_hole_clearance'
  | 'connection_width'
  | 'length'
  | 'skew'
  | 'diff_pair_gap'
  | 'diff_pair_uncoupled'
  | 'disallow'
  | 'assertion';

/**
 * DRC_DISALLOW_T, the item kinds a `disallow` constraint can name.
 *
 * `via` is not a kind of its own: upstream's parser expands it to all four via
 * spans at once, so `(constraint disallow via)` forbids micro and blind vias
 * too. The expansion lives in drc_rules_engine.ts, where the match happens.
 */
export type DrcDisallow =
  | 'track'
  | 'via'
  | 'through_via'
  | 'blind_via'
  | 'buried_via'
  | 'micro_via'
  | 'pad'
  | 'zone'
  | 'text'
  | 'graphic'
  | 'hole'
  | 'footprint';

/** SEVERITY, as a rule may override it. */
export type DrcSeverity = 'error' | 'warning' | 'ignore' | 'exclusion';

/** MINOPTMAX: any of the three may be absent. */
export interface MinOptMax {
  min?: number;
  opt?: number;
  max?: number;
}

/** One `(constraint …)` clause. */
export interface DrcConstraint {
  type: DrcConstraintType;
  /** Lengths in IU, angles in degrees, ratios and counts unitless. */
  value: MinOptMax;
  /** `(constraint disallow track via)` — the kinds it forbids. */
  disallow?: DrcDisallow[];
  /** `(constraint zone_connection solid|thermal_reliefs|none)`. */
  zoneConnection?: 'solid' | 'thermal_reliefs' | 'none' | 'inherited';
  /** `(constraint assertion "<expr>")` — the expression that must hold. */
  assertion?: string;
}

/** One `(rule …)`. */
export interface DrcRule {
  name: string;
  /** `(layer …)`: a layer name, or the `outer` / `inner` groups. */
  layer?: string;
  severity?: DrcSeverity;
  /** `(condition "…")`; absent means the rule always applies. */
  condition?: string;
  constraints: DrcConstraint[];
}

/** A parsed `.kicad_dru`, plus whatever went wrong reading it. */
export interface DrcRuleSet {
  version: number;
  rules: DrcRule[];
  /** Non-fatal problems, in file order. DRC_RULES_PARSER reports rather than throws. */
  errors: string[];
}

const CONSTRAINT_TYPES = new Set<string>([
  'clearance',
  'creepage',
  'hole_clearance',
  'edge_clearance',
  'courtyard_clearance',
  'silk_clearance',
  'hole_to_hole',
  'hole_size',
  'text_height',
  'text_thickness',
  'track_width',
  'track_segment_length',
  'track_angle',
  'annular_width',
  'via_diameter',
  'via_count',
  'zone_connection',
  'thermal_relief_gap',
  'thermal_spoke_width',
  'min_resolved_spokes',
  'solder_mask_expansion',
  'solder_paste_abs_margin',
  'solder_paste_rel_margin',
  'physical_clearance',
  'physical_hole_clearance',
  'connection_width',
  'length',
  'skew',
  'diff_pair_gap',
  'diff_pair_uncoupled',
  'disallow',
  'assertion',
]);

const DISALLOW_KINDS = new Set<string>([
  'track',
  'via',
  'through_via',
  'blind_via',
  'buried_via',
  'micro_via',
  'pad',
  'zone',
  'text',
  'graphic',
  'hole',
  'footprint',
]);

/**
 * PCBEXPR_UNIT_RESOLVER: mil, mm, in, deg, fs, ps.
 *
 * A bare number is *not* millimetres — upstream's resolver has no default unit,
 * so `(min 0.2)` is 0.2 IU, not 0.2 mm. Rules in the wild always write the
 * unit; treating a bare number as mm would silently inflate a constraint by a
 * million.
 */
export function parseRuleValue(text: string): number | undefined {
  const m = /^\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-Z]*)\s*$/.exec(text);
  if (!m) return undefined;

  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;

  switch ((m[2] ?? '').toLowerCase()) {
    case '':
      return n;
    case 'mm':
      return pcbIUScale.mmToIU(n);
    case 'in':
      return pcbIUScale.mmToIU(n * 25.4);
    case 'mil':
      return pcbIUScale.mmToIU((n * 25.4) / 1000);
    // Angles and times carry their own units; the caller knows which it asked
    // for, so they pass through unscaled.
    case 'deg':
    case 'fs':
    case 'ps':
      return n;
    default:
      return undefined;
  }
}

/** The text of an atom or string node, whichever it is. */
const wordOf = (n: SNode | undefined): string | undefined => {
  if (!n || isList(n)) return undefined;
  return n.kind === 'atom' || n.kind === 'string' ? n.value : undefined;
};

/** `(min 0.2mm)` -> the IU value, reporting what could not be read. */
function readValue(node: SList, errors: string[], ruleName: string): number | undefined {
  const text = wordOf(node.items[1]);
  if (text === undefined) {
    errors.push(`rule "${ruleName}": missing ${head(node)} value`);
    return undefined;
  }
  const v = parseRuleValue(text);
  if (v === undefined) {
    errors.push(
      `rule "${ruleName}": bad ${head(node)} value "${text}" (must be mm, in, mil, deg, fs or ps)`,
    );
    return undefined;
  }
  return v;
}

/** One `(constraint …)` clause. */
function readConstraint(node: SList, errors: string[], ruleName: string): DrcConstraint | null {
  const type = wordOf(node.items[1]);

  if (type === undefined || !CONSTRAINT_TYPES.has(type)) {
    errors.push(`rule "${ruleName}": unknown constraint type "${type ?? ''}"`);
    return null;
  }

  const c: DrcConstraint = { type: type as DrcConstraintType, value: {} };

  for (const item of node.items.slice(2)) {
    if (!isList(item)) {
      const word = wordOf(item);
      if (word === undefined) continue;

      // Bare words after the type: disallow kinds, a zone-connection mode, or
      // an assertion's expression.
      if (type === 'disallow' && DISALLOW_KINDS.has(word)) {
        c.disallow = [...(c.disallow ?? []), word as DrcDisallow];
      } else if (type === 'zone_connection') {
        c.zoneConnection = word as DrcConstraint['zoneConnection'];
      } else if (type === 'assertion') {
        c.assertion = word;
      } else {
        errors.push(`rule "${ruleName}": unexpected "${word}" in ${type} constraint`);
      }
      continue;
    }

    const key = head(item);
    if (key === 'min' || key === 'max' || key === 'opt') {
      const v = readValue(item, errors, ruleName);
      if (v !== undefined) c.value[key] = v;
    } else {
      errors.push(`rule "${ruleName}": expected min, max or opt, got "${key ?? ''}"`);
    }
  }

  return c;
}

/** One `(rule …)`. */
function readRule(node: SList, errors: string[]): DrcRule | null {
  const name = wordOf(node.items[1]);

  if (name === undefined) {
    errors.push('rule: missing name');
    return null;
  }

  const rule: DrcRule = { name, constraints: [] };

  for (const item of node.items.slice(2)) {
    if (!isList(item)) continue;

    switch (head(item)) {
      case 'constraint': {
        const c = readConstraint(item, errors, name);
        if (c) rule.constraints.push(c);
        break;
      }
      case 'condition':
        rule.condition = wordOf(item.items[1]) ?? '';
        break;
      case 'layer':
        rule.layer = wordOf(item.items[1]);
        break;
      case 'severity': {
        const s = wordOf(item.items[1]);
        if (s === 'error' || s === 'warning' || s === 'ignore' || s === 'exclusion')
          rule.severity = s;
        else errors.push(`rule "${name}": bad severity "${s ?? ''}"`);
        break;
      }
      default:
        errors.push(`rule "${name}": unexpected "${head(item) ?? ''}"`);
    }
  }

  if (rule.constraints.length === 0) errors.push(`rule "${name}": no constraints`);

  return rule;
}

/**
 * DRC_RULES_PARSER::Parse. Never throws on rule content: upstream reports and
 * carries on, so one bad rule does not silence the rest of the file.
 */
export function parseDrcRules(text: string): DrcRuleSet {
  const out: DrcRuleSet = { version: 0, rules: [], errors: [] };

  if (text.trim() === '') return out;

  let root: SList;
  try {
    // A `.kicad_dru` is a sequence of top-level forms, not one document, so it
    // is wrapped before parsing.
    root = parse(`(kicad_dru ${text})`);
  } catch (e) {
    out.errors.push(`could not parse rules: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }

  for (const item of root.items.slice(1)) {
    if (!isList(item)) continue;

    switch (head(item)) {
      case 'version': {
        const v = Number(wordOf(item.items[1]));
        if (Number.isFinite(v)) out.version = v;
        else out.errors.push('bad version');
        break;
      }
      case 'rule': {
        const r = readRule(item, out.errors);
        if (r) out.rules.push(r);
        break;
      }
      default:
        out.errors.push(`unexpected "${head(item) ?? ''}" at top level`);
    }
  }

  return out;
}
