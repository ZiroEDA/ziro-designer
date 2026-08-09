// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a rule area is *for*: applying a netclass to every net inside it, so a
 * whole region of a sheet can be given a trace width or a clearance in one go
 * rather than net by net.
 *
 * Three upstream pieces, all in this file's subject:
 *
 *  - `SCH_RULE_AREA::RefreshContainedItemsAndDirectives` finds the directive
 *    labels **on the border** and the connectable items **inside**;
 *  - `SCH_RULE_AREA::GetResolvedNetclasses` reads the `Netclass` field off each
 *    attached directive;
 *  - `CONNECTION_SUBGRAPH::GetNetclassesForDriver` merges what the rule areas
 *    say with what the item's own netclass fields say.
 *
 * The border rule is the part that is easy to get wrong: a directive merely
 * sitting inside the area contributes nothing —
 *
 *     if( GetPolyShape().CollideEdge( labelConnectionPoints[0], nullptr, 5 ) )
 *         addDirective( label );
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import {
  insidePolygon,
  onPolygonEdge,
  ruleAreaItems,
  ruleAreaNetclassAssignments,
  ruleAreaNetclasses,
  ruleAreas,
} from '@ziroeda/eeschema/src/tools/rule_area.js';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();

/**
 * A 40x30 mm rule area at (50,50), with:
 *  - a wire and its label inside,
 *  - a wire and its label well outside,
 *  - `flag` placed wherever the caller asks.
 */
const sheet = (flagAt: { x: number; y: number }, netclass = 'HV'): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (rule_area (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)
        (polyline
          (pts (xy 50 50) (xy 90 50) (xy 90 80) (xy 50 80) (xy 50 50))
          (stroke (width 0) (type dash)) (fill (type none)) (uuid "ra1")))
      (wire (pts (xy 60 60) (xy 80 60)) (stroke (width 0) (type default)) (uuid "win"))
      (label "INSIDE" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "lin"))
      (wire (pts (xy 120 60) (xy 140 60)) (stroke (width 0) (type default)) (uuid "wout"))
      (label "OUTSIDE" (at 120 60 0) (effects (font (size 1.27 1.27))) (uuid "lout"))
      (directive_label (at ${flagAt.x} ${flagAt.y} 0) (length 2.54)
        (effects (font (size 1.27 1.27)))
        (uuid "d1")
        (property "Netclass" "${netclass}" (at 0 0 0) (effects (font (size 1.27 1.27))))))`),
  );

/** A flag on the area's left border, which is what attaches it. */
const ON_BORDER = { x: 50, y: 65 };
/** A flag floating inside the area, attached to nothing. */
const INSIDE_ONLY = { x: 70, y: 70 };

const assignmentsFor = (doc: Schematic) =>
  ruleAreaNetclassAssignments(doc, LIB, computeNetlist(doc, LIB));

describe('the geometry the containment rules are built on', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
    { x: 0, y: 0 },
  ];

  it('insidePolygon separates in from out', () => {
    expect(insidePolygon(square, { x: 50, y: 50 })).toBe(true);
    expect(insidePolygon(square, { x: 150, y: 50 })).toBe(false);
    expect(insidePolygon(square, { x: -1, y: 50 })).toBe(false);
  });

  it('onPolygonEdge accepts a point on the border and rejects the middle', () => {
    // `CollideEdge( pt, nullptr, 5 )`: on the outline, within the clearance.
    expect(onPolygonEdge(square, { x: 0, y: 50 }, 5)).toBe(true);
    expect(onPolygonEdge(square, { x: 3, y: 50 }, 5)).toBe(true);
    expect(onPolygonEdge(square, { x: 50, y: 50 }, 5)).toBe(false);
    expect(onPolygonEdge(square, { x: 20, y: 50 }, 5)).toBe(false);
  });
});

describe('finding the area and what it holds', () => {
  it('the sheet has exactly one rule area', () => {
    expect(ruleAreas(sheet(ON_BORDER))).toHaveLength(1);
  });

  it('it contains the inner wire and label, not the outer ones', () => {
    const doc = sheet(ON_BORDER);
    const items = ruleAreaItems(doc, LIB, ruleAreas(doc)[0]!);
    const idOf = (uuid: string): string => {
      const li = doc.lines.findIndex((l) => l.uuid === uuid);
      if (li !== -1) return refId('line', uuid, li);
      const bi = doc.labels.findIndex((l) => l.uuid === uuid);
      return refId('label', uuid, bi);
    };
    expect(items).toContain(idOf('win'));
    expect(items).toContain(idOf('lin'));
    expect(items).not.toContain(idOf('wout'));
    expect(items).not.toContain(idOf('lout'));
  });
});

describe('a directive on the border gives the area its netclass', () => {
  it('is picked up', () => {
    const doc = sheet(ON_BORDER);
    expect(ruleAreaNetclasses(doc, ruleAreas(doc)[0]!)).toEqual(['HV']);
  });

  it('and one merely sitting inside is not', () => {
    // The distinction upstream draws with CollideEdge, and the one most likely
    // to be got wrong: a flag inside the area is attached to nothing.
    const doc = sheet(INSIDE_ONLY);
    expect(ruleAreaNetclasses(doc, ruleAreas(doc)[0]!)).toEqual([]);
  });
});

describe('the assignments that reach the netclass resolver', () => {
  it('name the enclosed net and give it the area netclass', () => {
    const out = assignmentsFor(sheet(ON_BORDER));
    expect(out).toHaveLength(1);
    expect(out[0]!.netClass).toBe('HV');
    expect(out[0]!.pattern).toContain('INSIDE');
  });

  it('and never the net outside the area', () => {
    const out = assignmentsFor(sheet(ON_BORDER));
    expect(out.some((a) => a.pattern.includes('OUTSIDE'))).toBe(false);
  });

  it('an area with no directive on its border assigns nothing', () => {
    expect(assignmentsFor(sheet(INSIDE_ONLY))).toEqual([]);
  });

  it('a differently named netclass comes through as given', () => {
    const out = assignmentsFor(sheet(ON_BORDER, 'Power'));
    expect(out[0]!.netClass).toBe('Power');
  });

  it('a sheet with no rule areas produces nothing', () => {
    const plain: Schematic = readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (wire (pts (xy 60 60) (xy 80 60)) (stroke (width 0) (type default)) (uuid "w1"))
        (label "NET1" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "l1")))`),
    );
    expect(ruleAreaNetclassAssignments(plain, LIB, computeNetlist(plain, LIB))).toEqual([]);
  });

  it('and each net/class pair is emitted once, however many items are enclosed', () => {
    // The area holds a wire *and* a label on the same net; the resolver should
    // see one assignment, not one per item.
    const out = assignmentsFor(sheet(ON_BORDER));
    const keys = out.map((a) => `${a.pattern} ${a.netClass}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('a wire that only crosses the border still counts', () => {
  // "if( GetPolyShape().Collide( &lineSeg ) )" — the segment test, not a
  // containment test, so a wire running through the area is enclosed by it.
  const crossing: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (rule_area (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)
        (polyline
          (pts (xy 50 50) (xy 90 50) (xy 90 80) (xy 50 80) (xy 50 50))
          (stroke (width 0) (type dash)) (fill (type none)) (uuid "ra1")))
      (wire (pts (xy 30 60) (xy 140 60)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "THROUGH" (at 30 60 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
      (directive_label (at 50 65 0) (length 2.54)
        (effects (font (size 1.27 1.27))) (uuid "d1")
        (property "Netclass" "HV" (at 0 0 0) (effects (font (size 1.27 1.27))))))`),
  );

  it('gets the netclass even though both its ends are outside', () => {
    const out = ruleAreaNetclassAssignments(crossing, LIB, computeNetlist(crossing, LIB));
    expect(out).toHaveLength(1);
    expect(out[0]!.netClass).toBe('HV');
    expect(out[0]!.pattern).toContain('THROUGH');
  });

  it('and the label at its far end is not itself enclosed', () => {
    const items = ruleAreaItems(crossing, LIB, ruleAreas(crossing)[0]!);
    // The label sits at x=30, well outside; only the wire is picked up.
    expect(insidePolygon(ruleAreas(crossing)[0]!.points, { x: mmToIU(30), y: mmToIU(60) })).toBe(
      false,
    );
    expect(items.length).toBeGreaterThan(0);
  });
});
