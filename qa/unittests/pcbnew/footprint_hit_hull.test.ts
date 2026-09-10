// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A footprint is picked by its body, never by its fields.
 *
 * `GENERAL_COLLECTOR::Inspect` (`collectors.cpp:413`) takes a footprint only
 * when BOTH `HitTest` — `GetBoundingBox( false )`, the text-free box, inflated
 * by the accuracy (`footprint.cpp:2349-2353`) — and `HitTestAccurate` — the
 * `GetBoundingHull` collide (`:2356-2359`) — say so, and the hull is built
 * from pads and graphics with the fields left out on purpose
 * (`:1998-2008`, "We intentionally exclude footprint fields").
 *
 * Ours measured the box WITH the text, so a terminal block whose value
 * string ran a part-width down its side was selected from anywhere along
 * that string, and the reference field next to it selected the part and not
 * the field. These pin the geometry: the string, the box, the hull and its
 * slop, the fallback square, and the same rule for a rubber-band.
 */
import { describe, expect, it } from 'vitest';
import { boardHitCandidates, boardItemsInBox } from '@ziroeda/pcbnew/src/edit-board.js';
import { footprintBBox, footprintHull } from '@ziroeda/pcbnew/src/edit-footprint.js';
import { pcbMmToIU as mm } from '@ziroeda/common/src/eda_units.js';
import type {
  Board,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
} from '@ziroeda/pcbnew/src/types.js';
import type { SList } from '@ziroeda/sexpr/src/index.js';

const EMPTY: SList = { kind: 'list', items: [] } as unknown as SList;

const pad = (at: { x: number; y: number }, s: number): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at,
  angle: 0,
  size: { x: s, y: s },
  layers: ['F.Cu'],
  source: EMPTY,
});
const rect = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  layer = 'F.CrtYd',
  width = mm(0.05),
): PcbShape => ({ kind: 'rect', start, end, width, fillMode: 'none', layer, source: EMPTY });
const text = (
  kind: PcbTextItem['kind'],
  at: { x: number; y: number },
  s: string,
  angle = 0,
): PcbTextItem => ({
  kind,
  text: s,
  at,
  angle,
  layer: 'F.Fab',
  size: { x: mm(1), y: mm(1) },
  thickness: mm(0.15),
  source: EMPTY,
});
const fp = (over: Partial<PcbFootprint>): PcbFootprint => ({
  lib: 'TerminalBlock:2P',
  at: { x: mm(10), y: mm(10) },
  angle: 0,
  layer: 'F.Cu',
  pads: [],
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
  ...over,
});
const board = (footprints: PcbFootprint[]): Board =>
  ({
    version: 20241229,
    layers: [],
    nets: new Map(),
    footprints,
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    dimensions: [],
    textBoxes: [],
    tables: [],
    images: [],
    points: [],
    barcodes: [],
    groups: [],
    source: EMPTY,
  }) as unknown as Board;

/**
 * The screenshot's J1: a 5 x 10 mm body (courtyard) with two pads, and a
 * long value string standing 3 mm to the right of it, running down its side.
 */
const j1 = fp({
  pads: [pad({ x: mm(10), y: mm(7.5) }, mm(2)), pad({ x: mm(10), y: mm(12.5) }, mm(2))],
  shapes: [rect({ x: mm(7.5), y: mm(5) }, { x: mm(12.5), y: mm(15) })],
  texts: [
    text('reference', { x: mm(10), y: mm(3) }, 'J1'),
    text('value', { x: mm(15.5), y: mm(10) }, 'Screw_Terminal_01x02', 90),
  ],
});
const SLOP = mm(0.1);

describe('a click beside the body, on the value string', () => {
  it('selects the value field and not the footprint', () => {
    // 3 mm right of the courtyard, on the string's centreline.
    const hits = boardHitCandidates(board([j1]), { x: mm(15.5), y: mm(10) }, SLOP);
    expect(hits).toEqual(['fptext:0:1']);
  });

  it('empty space between the body and the string selects nothing', () => {
    expect(boardHitCandidates(board([j1]), { x: mm(14), y: mm(10) }, SLOP)).toEqual([]);
  });

  it('the body itself still selects the footprint', () => {
    // Inside the courtyard, between the pads.
    expect(boardHitCandidates(board([j1]), { x: mm(10), y: mm(10) }, SLOP)).toEqual([
      'footprint:0',
    ]);
  });

  it('the reference field above the body is the field, not the part', () => {
    expect(boardHitCandidates(board([j1]), { x: mm(10), y: mm(3) }, SLOP)).toEqual([
      'fptext:0:0',
    ]);
  });
});

describe('GetBoundingBox( false ) and GetBoundingHull', () => {
  it('the text-free box is the courtyard plus its stroke, not the fields', () => {
    const b = footprintBBox(j1, false, true)!;
    expect(b.maxX).toBeCloseTo(mm(12.5), 0);
    expect(b.minY).toBeCloseTo(mm(5), 0);
  });

  it('the hull is the courtyard’s four corners, out to the half stroke', () => {
    const hull = footprintHull(j1);
    expect(hull).toHaveLength(4);
    const xs = hull.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(mm(12.5) + mm(0.025), 0);
    expect(Math.min(...xs)).toBeCloseTo(mm(7.5) - mm(0.025), 0);
  });

  it('the hull is collided with the accuracy: a hair outside the courtyard still picks', () => {
    // 0.05 mm outside the stroke, under a 0.1 mm slop.
    expect(boardHitCandidates(board([j1]), { x: mm(12.6), y: mm(10) }, SLOP)).toEqual([
      'footprint:0',
    ]);
    // 0.2 mm outside: past the slop.
    expect(boardHitCandidates(board([j1]), { x: mm(12.75), y: mm(10) }, SLOP)).toEqual([]);
  });

  it('a footprint that is nothing but its two fields gets the 1 mm square about its anchor', () => {
    const bare = fp({ texts: [text('reference', { x: mm(10), y: mm(3) }, 'J1')] });
    const hull = footprintHull(bare);
    expect(hull).toHaveLength(4);
    expect(Math.max(...hull.map((p) => p.x)) - Math.min(...hull.map((p) => p.x))).toBe(mm(2));
    // "If there are no pads, zones, or drawings", the fields ARE the box, so
    // the field click reaches the footprint too and the field wins on area.
    expect(boardHitCandidates(board([bare]), { x: mm(10), y: mm(3) }, SLOP)).toEqual([
      'fptext:0:0',
    ]);
  });

  it('annotation graphics on the user layers are outside the text-free box', () => {
    const annotated = fp({
      ...j1,
      shapes: [...j1.shapes, rect({ x: mm(0), y: mm(0) }, { x: mm(30), y: mm(30) }, 'Dwgs.User')],
    });
    expect(footprintBBox(annotated, false, true)!.maxX).toBeCloseTo(mm(12.5), 0);
    expect(footprintBBox(annotated)!.maxX).toBeCloseTo(mm(30), 0);
  });
});

describe('a rubber-band round the fields', () => {
  // `boardItemsInBox` does not yet offer a footprint's own fields and pads as
  // items of their own (upstream's `selectMultiple` does), so these pin only
  // the half that is this change's: the band does not take the PART.
  it('window-selecting the value string does not take the part', () => {
    const hits = boardItemsInBox(board([j1]), mm(14), mm(2), mm(17), mm(18), true);
    expect(hits).not.toContain('footprint:0');
  });

  it('a crossing band through the string alone touches no footprint', () => {
    const hits = boardItemsInBox(board([j1]), mm(14), mm(9), mm(17), mm(11), false);
    expect(hits).not.toContain('footprint:0');
  });

  it('a crossing band through a pad takes the footprint', () => {
    const hits = boardItemsInBox(board([j1]), mm(9), mm(7), mm(11), mm(8), false);
    expect(hits).toContain('footprint:0');
  });

  it('a window round the whole body takes the footprint whatever the string does', () => {
    // The string hangs outside this window; with the text in the box it would
    // have been "not contained".
    const hits = boardItemsInBox(board([j1]), mm(7), mm(4), mm(13), mm(16), true);
    expect(hits).toContain('footprint:0');
  });
});
