// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Select every item matching an expression.
 * Counterpart: `DIALOG_FIND_BY_PROPERTIES::selectMatchingFromQuery` and
 * `queryUsesUnsupportedPairwiseSyntax`.
 *
 * Upstream's dialog has two modes. This is the *query* one, which compiles the
 * same expression language `.kicad_dru` conditions use and runs it over every
 * board item. The other mode drives a property grid off KiCad's reflection
 * system, which has no counterpart here.
 *
 * The reuse is the point: a rule that selects the right items in Board Setup
 * selects the same items here, because it is one evaluator and one set of
 * property names.
 */

import { type DrcExprContext, parseDrcExpr, testDrcCondition } from './drc/drc_expr.js';
import type { DrcItemType } from './drc/drc_rules_engine.js';
import type { Board } from './types.js';

/** One board item, as the expression sees it. */
export interface QueryItem {
  /** The selection id, so a caller can turn matches back into a selection. */
  id: string;
  type: DrcItemType;
  layers: string[];
  netName?: string;
  netClasses: string[];
  props: Record<string, string | number | undefined>;
}

export interface QueryResult {
  /** Selection ids of every matching item, in board order. */
  matches: string[];
  /** Why the query could not run, if it could not. */
  error?: string;
}

/**
 * `queryUsesUnsupportedPairwiseSyntax`: reject `B.` before compiling.
 *
 * `A` and `B` mean "the two items being compared" in a DRC rule, and there is
 * no second item when selecting. Upstream refuses rather than evaluating `B`
 * as nothing, because a silently-false comparison would look like "no items
 * matched" and send the user rewriting a query that was never going to work.
 *
 * A `B.` inside a quoted string is text, not syntax, and is left alone.
 */
export function usesPairwiseSyntax(expression: string): boolean {
  let inString = false;

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i]!;

    if (ch === "'" && (i === 0 || expression[i - 1] !== '\\')) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    // Only a standalone `B.`, so `SUB.foo` or `A.NetB.x` is not mistaken for it.
    const prev = i > 0 ? expression[i - 1]! : '';
    if (expression.startsWith('B.', i) && !/[A-Za-z0-9_]/.test(prev)) return true;
  }

  return false;
}

/** The expression context for one item; there is no `B`. */
function contextFor(item: QueryItem, layer: string): DrcExprContext {
  return {
    property: (which, name) => {
      if (which === 'B') return undefined;

      switch (name.toLowerCase()) {
        case 'type':
          return item.type;
        case 'layer':
          return layer;
        case 'netname':
          return item.netName;
        case 'netclass':
          return item.netClasses.join(',');
        default:
          return item.props[name] ?? item.props[name.toLowerCase()];
      }
    },
    call: () => undefined,
  };
}

/**
 * Run a query over the board.
 *
 * An item is matched if the expression holds on *any* of its layers, which is
 * upstream's loop: a through-hole pad should answer a question about F.Cu even
 * though it is on every copper layer.
 */
export function findByQuery(items: readonly QueryItem[], expression: string): QueryResult {
  const trimmed = expression.trim();
  if (trimmed === '') return { matches: [] };

  if (usesPairwiseSyntax(trimmed))
    return { matches: [], error: 'B. expressions are not supported.' };

  // Compile once, so a syntax error is reported as one error rather than once
  // per item — and so a bad query costs nothing to reject.
  try {
    parseDrcExpr(trimmed);
  } catch (e) {
    return {
      matches: [],
      error: `Syntax error in expression: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const matches: string[] = [];

  for (const item of items) {
    const layers = item.layers.length > 0 ? item.layers : [''];

    for (const layer of layers) {
      if (testDrcCondition(trimmed, contextFor(item, layer)).matched) {
        matches.push(item.id);
        break;
      }
    }
  }

  return { matches };
}

/** Every board item a query can match, with the selection id that names it. */
export function boardQueryItems(
  board: Board,
  netClassesOf: (netName: string) => readonly string[],
): QueryItem[] {
  const out: QueryItem[] = [];
  const classes = (net: number): string[] => [...netClassesOf(board.nets.get(net) ?? '')];

  board.tracks.forEach((t, i) => {
    out.push({
      id: `track:${i}`,
      type: 'Track',
      layers: [t.layer],
      netName: board.nets.get(t.net),
      netClasses: classes(t.net),
      props: { Width: t.width },
    });
  });

  board.arcs.forEach((a, i) => {
    out.push({
      id: `arc:${i}`,
      type: 'Arc',
      layers: [a.layer],
      netName: board.nets.get(a.net),
      netClasses: classes(a.net),
      props: { Width: a.width },
    });
  });

  board.vias.forEach((v, i) => {
    out.push({
      id: `via:${i}`,
      type: 'Via',
      layers: [...v.layers],
      netName: board.nets.get(v.net),
      netClasses: classes(v.net),
      props: { Width: v.size, Hole: v.drill, Via_Type: v.kind },
    });
  });

  board.zones.forEach((z, i) => {
    out.push({
      id: `zone:${i}`,
      type: 'Zone',
      layers: [...z.layers],
      netName: board.nets.get(z.net),
      netClasses: classes(z.net),
      props: { Name: z.name },
    });
  });

  board.shapes.forEach((s, i) => {
    out.push({
      id: `shape:${i}`,
      type: 'Graphic',
      layers: [s.layer],
      netClasses: [],
      props: { Width: s.width },
    });
  });

  board.texts.forEach((t, i) => {
    out.push({
      id: `text:${i}`,
      type: 'Text',
      layers: [t.layer],
      netClasses: [],
      props: { Text: t.text, Orientation: t.angle },
    });
  });

  board.footprints.forEach((fp, i) => {
    out.push({
      id: `footprint:${i}`,
      type: 'Footprint',
      layers: [fp.layer],
      netClasses: [],
      props: {
        Reference: fp.reference,
        Value: fp.value,
        Footprint_Name: fp.lib,
        Orientation: fp.angle,
      },
    });

    fp.pads.forEach((pad, j) => {
      out.push({
        id: `pad:${i}:${j}`,
        type: 'Pad',
        layers: [...pad.layers],
        netName: board.nets.get(pad.net ?? 0),
        netClasses: classes(pad.net ?? 0),
        props: { Pad_Number: pad.number, Pad_Type: pad.type },
      });
    });
  });

  return out;
}
