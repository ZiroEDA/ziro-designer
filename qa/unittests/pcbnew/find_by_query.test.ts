// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Find by query: select every item matching an expression.
 * Counterpart: `DIALOG_FIND_BY_PROPERTIES::selectMatchingFromQuery`.
 *
 * The expression language is the one `.kicad_dru` conditions use, which is the
 * point — a condition that selects the right items in a rule selects the same
 * items here, because there is one evaluator and one set of property names.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  boardQueryItems,
  findByQuery,
  usesPairwiseSyntax,
} from '@ziroeda/pcbnew/src/find_by_query.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const board = (): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'GND'],
    [2, 'VCC'],
  ]),
  footprints: [
    {
      lib: 'L:R_0603',
      reference: 'R1',
      value: '10k',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.Cu',
      pads: [
        {
          number: '1',
          type: 'smd',
          shape: 'rect',
          at: { x: 0, y: 0 },
          angle: 0,
          size: { x: MM(1), y: MM(1) },
          layers: ['F.Cu'],
          net: 1,
          source: EMPTY,
        },
      ],
      shapes: [],
      texts: [],
      points: [],
      models: [],
      source: EMPTY,
    },
  ],
  tracks: [
    // 0: GND on F.Cu, thin. 1: VCC on B.Cu, thick.
    {
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: 0 },
      width: MM(0.2),
      layer: 'F.Cu',
      net: 1,
      source: EMPTY,
    },
    {
      start: { x: 0, y: MM(5) },
      end: { x: MM(10), y: MM(5) },
      width: MM(0.5),
      layer: 'B.Cu',
      net: 2,
      source: EMPTY,
    },
  ],
  arcs: [],
  vias: [
    {
      at: { x: MM(3), y: 0 },
      size: MM(0.6),
      drill: MM(0.3),
      layers: ['F.Cu', 'B.Cu'],
      kind: 'through',
      net: 1,
      source: EMPTY,
    },
  ],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  groups: [],
  source: EMPTY,
});

const noClasses = (): readonly string[] => [];
const items = (netClassesOf: (n: string) => readonly string[] = noClasses) =>
  boardQueryItems(board(), netClassesOf);
const run = (expr: string, netClassesOf: (n: string) => readonly string[] = noClasses) =>
  findByQuery(items(netClassesOf), expr);

describe('pairwise syntax', () => {
  it('rejects a standalone B.', () => {
    expect(usesPairwiseSyntax("A.NetClass == 'HV' && B.Layer == 'F.Cu'")).toBe(true);
  });

  it('accepts an expression with no B at all', () => {
    expect(usesPairwiseSyntax("A.NetClass == 'HV'")).toBe(false);
  });

  it('does not mistake a B. inside a string for syntax', () => {
    // A net or reference can legitimately contain "B.".
    expect(usesPairwiseSyntax("A.NetName == 'B.SIGNAL'")).toBe(false);
  });

  it('does not mistake a B. that follows an identifier character', () => {
    expect(usesPairwiseSyntax("A.SUB.Layer == 'F.Cu'")).toBe(false);
  });

  it('reports it as an error rather than matching nothing', () => {
    // Silently evaluating B as nothing would read as "no items matched" and
    // send the user rewriting a query that could never work.
    const r = run("A.Type == 'Track' && B.Type == 'Via'");

    expect(r.matches).toEqual([]);
    expect(r.error).toContain('B. expressions are not supported');
  });
});

describe('matching', () => {
  it('selects by item type', () => {
    expect(run("A.Type == 'Track'").matches).toEqual(['track:0', 'track:1']);
  });

  it('selects by net name', () => {
    expect(run("A.NetName == 'VCC'").matches).toEqual(['track:1']);
  });

  it('selects by a numeric property with units', () => {
    // The same unit-suffixed literals a .kicad_dru constraint takes. A via's
    // Width is its diameter, so it answers the question too — narrowing by
    // type is how you ask about tracks alone.
    expect(run('A.Width > 0.3mm').matches).toEqual(['track:1', 'via:0']);
    expect(run("A.Width > 0.3mm && A.Type == 'Track'").matches).toEqual(['track:1']);
  });

  it('selects by layer', () => {
    expect(run("A.Layer == 'B.Cu'").matches).toEqual(['track:1', 'via:0']);
  });

  it('matches an item on any of its layers', () => {
    // The through via spans F.Cu and B.Cu, so it answers to either.
    expect(run("A.Layer == 'F.Cu'").matches).toContain('via:0');
    expect(run("A.Layer == 'B.Cu'").matches).toContain('via:0');
  });

  it('combines terms', () => {
    expect(run("A.Type == 'Track' && A.NetName == 'GND'").matches).toEqual(['track:0']);
  });

  it('selects a footprint by its reference or value', () => {
    expect(run("A.Reference == 'R1'").matches).toEqual(['footprint:0']);
    expect(run("A.Value == '10k'").matches).toEqual(['footprint:0']);
  });

  it('reaches netclasses when the caller supplies them', () => {
    expect(run("A.NetClass == 'HV'").matches).toEqual([]);
    expect(run("A.NetClass == 'HV'", () => ['HV']).matches.length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty query, without an error', () => {
    const r = run('   ');

    expect(r.matches).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it('reports a syntax error once, not once per item', () => {
    const r = run('A.Width >');

    expect(r.matches).toEqual([]);
    expect(r.error).toContain('Syntax error');
  });

  it('matches nothing when the expression simply holds for nothing', () => {
    const r = run("A.NetName == 'NOPE'");

    expect(r.matches).toEqual([]);
    expect(r.error).toBeUndefined();
  });
});

describe('board items', () => {
  it('gives every item an id that names it', () => {
    const ids = items().map((i) => i.id);

    expect(ids).toContain('track:0');
    expect(ids).toContain('via:0');
    expect(ids).toContain('footprint:0');
    expect(ids).toContain('pad:0:0');
  });

  it('carries a pad’s net through from its footprint', () => {
    const pad = items().find((i) => i.id === 'pad:0:0');

    expect(pad?.netName).toBe('GND');
  });
});
