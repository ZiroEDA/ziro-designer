// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Move Exactly.
 * Counterparts: `EDIT_TOOL::MoveExact`, `DIALOG_MOVE_EXACT::GetTranslationInIU`
 * and `EDA_SHAPE::rotate`.
 *
 * Two things here are easy to get subtly wrong and invisible if untested: which
 * centre the rotation turns about once the selection has already been moved
 * (the stale one gives a different, plausible-looking answer), and what happens
 * to a rectangle rotated by a non-cardinal angle — it cannot stay a rectangle,
 * because the model stores one as two opposite corners of an axis-aligned box.
 *
 * Every expected coordinate below is hand-computed from KiCad's convention that
 * a +90° rotation maps (x, y) to (y, −x), not read back out of the code.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { atom, head, isList, list, str } from '@ziroeda/sexpr/src/index.js';
import { writeBoardNode } from '@ziroeda/pcbnew/src/write-board.js';
import {
  defaultRotationAnchor,
  itemAnchorPoint,
  MAX_BOARD_COORD,
  moveExact,
  moveKeepsSelectionInBounds,
  polarTranslation,
} from '@ziroeda/pcbnew/src/move_exact.js';
import type { Board, PcbShape, PcbTrack } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const track = (x0: number, y0: number, x1: number, y1: number): PcbTrack => ({
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.25),
  layer: 'F.Cu',
  net: 0,
  source: EMPTY,
});

const rect = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'rect',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: 0,
  fill: true,
  layer: 'F.SilkS',
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  groups: [],
  source: EMPTY,
  ...over,
});

/** Within a nanometre — rotation goes through trigonometry, then rounds to IU. */
const near = (got: number, want: number): void =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(1);

/**
 * Within a few nanometres, for a *derived* quantity — a length or a distance
 * between two independently-rounded points, where each endpoint may already be
 * a nanometre off and the error compounds. Still far below anything a board can
 * express: a nanometre is a millionth of a millimetre.
 */
const nearDerived = (got: number, want: number): void =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(4);

describe('polar translation', () => {
  it('is the distance itself along zero degrees', () => {
    const v = polarTranslation(MM(10), 0);

    near(v.x, MM(10));
    near(v.y, 0);
  });

  it('points down the screen at ninety degrees', () => {
    // Board y grows downward and the dialog reads its angle in that same frame,
    // so +90° is +y. Flipping the sign would send every polar move the wrong
    // way vertically.
    const v = polarTranslation(MM(10), 90);

    near(v.x, 0);
    near(v.y, MM(10));
  });

  it('splits a diagonal evenly', () => {
    const v = polarTranslation(MM(10), 45);

    near(v.x, Math.round(MM(10) * Math.SQRT1_2));
    near(v.y, Math.round(MM(10) * Math.SQRT1_2));
  });

  it('reverses with a negative distance', () => {
    const v = polarTranslation(MM(-10), 0);

    near(v.x, MM(-10));
  });
});

describe('translation', () => {
  it('moves every selected item by the vector', () => {
    const b = board({ tracks: [track(0, 0, 10, 0), track(0, 5, 10, 5)] });
    const out = moveExact(b, ['track:0', 'track:1'], { translation: { x: MM(3), y: MM(-2) } });

    near(out.tracks[0]!.start.x, MM(3));
    near(out.tracks[0]!.start.y, MM(-2));
    near(out.tracks[1]!.start.y, MM(3));
  });

  it('leaves unselected items alone', () => {
    const b = board({ tracks: [track(0, 0, 10, 0), track(0, 5, 10, 5)] });
    const out = moveExact(b, ['track:0'], { translation: { x: MM(3), y: 0 } });

    expect(out.tracks[1]!.start.x).toBe(b.tracks[1]!.start.x);
  });

  it('does nothing with an empty selection', () => {
    const b = board({ tracks: [track(0, 0, 10, 0)] });

    expect(moveExact(b, [], { translation: { x: MM(3), y: MM(3) } })).toBe(b);
  });
});

describe('rotation anchor', () => {
  // Two horizontal tracks, (0,0)-(10,0) and (0,20)-(10,20). The selection
  // centre is (5,10), which is neither track's own centre — so the two default
  // anchors give visibly different answers.
  const two = (): Board => board({ tracks: [track(0, 0, 10, 0), track(0, 20, 10, 20)] });

  it('defaults to the selection centre for more than one item', () => {
    const out = moveExact(two(), ['track:0', 'track:1'], {
      translation: { x: 0, y: 0 },
      rotation: 90,
    });

    // start (0,0) about (5,10): d = (−5,−10) → (−10,5) → (−5,15). The track
    // leaves its own row entirely, which is what the item anchor never does.
    near(out.tracks[0]!.start.x, MM(-5));
    near(out.tracks[0]!.start.y, MM(15));
  });

  it('preselects the anchor the way the dialog does', () => {
    // For one item the two anchors give identical geometry, so this is the only
    // place the distinction is observable: which radio button opens checked.
    expect(defaultRotationAnchor(1)).toBe('itemAnchor');
    expect(defaultRotationAnchor(2)).toBe('selectionCenter');
  });

  it('turns a single item about its own anchor, not its centre', () => {
    const out = moveExact(two(), ['track:0'], { translation: { x: 0, y: 0 }, rotation: 90 });

    // A track's anchor is its *start*, per PCB_TRACK::GetPosition — so (0,0)
    // is pinned and the far end swings from (10,0) to (0,−10). About the bbox
    // centre (5,0) it would instead land at (5,5)-(5,−5), a different result
    // and not what "rotate around item anchor" says.
    near(out.tracks[0]!.start.x, 0);
    near(out.tracks[0]!.start.y, 0);
    near(out.tracks[0]!.end.x, 0);
    near(out.tracks[0]!.end.y, MM(-10));
  });

  it('rotates each item about its own anchor', () => {
    const out = moveExact(two(), ['track:0', 'track:1'], {
      translation: { x: 0, y: 0 },
      rotation: 90,
      anchor: 'itemAnchor',
    });

    // Each keeps its own start point: the second track does not orbit the
    // first, which is exactly what the selection-centre anchor would make it do.
    near(out.tracks[0]!.start.y, 0);
    near(out.tracks[1]!.start.x, 0);
    near(out.tracks[1]!.start.y, MM(20));
  });

  it('rotates about a user origin', () => {
    const out = moveExact(two(), ['track:0'], {
      translation: { x: 0, y: 0 },
      rotation: 90,
      anchor: 'userOrigin',
      userOrigin: { x: MM(10), y: 0 },
    });

    // Deliberately not the track's own anchor, or this would not tell the two
    // apart. About (10,0): start (0,0) has d = (−10,0) → (0,10) → (10,10),
    // while the far end sits on the origin and stays put.
    near(out.tracks[0]!.start.x, MM(10));
    near(out.tracks[0]!.start.y, MM(10));
    near(out.tracks[0]!.end.x, MM(10));
    near(out.tracks[0]!.end.y, 0);
  });

  it('rotates about the aux origin', () => {
    const out = moveExact(two(), ['track:0'], {
      translation: { x: 0, y: 0 },
      rotation: 180,
      anchor: 'auxOrigin',
      auxOrigin: { x: MM(5), y: MM(5) },
    });

    // Again away from the item's own anchor. A half turn about (5,5) reflects
    // every point through it: (0,0) → (10,10) and (10,0) → (0,10).
    near(out.tracks[0]!.start.x, MM(10));
    near(out.tracks[0]!.start.y, MM(10));
    near(out.tracks[0]!.end.x, 0);
    near(out.tracks[0]!.end.y, MM(10));
  });

  it('skips the rotation when the chosen origin was not supplied', () => {
    const out = moveExact(two(), ['track:0'], {
      translation: { x: MM(1), y: 0 },
      rotation: 90,
      anchor: 'userOrigin',
    });

    // The translation still happens; only the rotation is dropped.
    near(out.tracks[0]!.start.x, MM(1));
    near(out.tracks[0]!.start.y, 0);
    near(out.tracks[0]!.end.x, MM(11));
  });

  it('returns the board untouched for a zero move', () => {
    // Not merely equal — the same object. A zero move that still rebuilt every
    // item's source node would rewrite the file with no change in it.
    const b = two();

    expect(moveExact(b, ['track:0'], { translation: { x: 0, y: 0 }, rotation: 0 })).toBe(b);
  });
});

describe('the out-of-range check that greys out OK', () => {
  const box = { minX: 0, minY: 0, maxX: MM(10), maxY: MM(10) };

  it('accepts an ordinary move', () => {
    expect(moveKeepsSelectionInBounds(box, { x: MM(50), y: MM(50) })).toBe(true);
  });

  it('rejects a move that runs off the right of the board area', () => {
    expect(moveKeepsSelectionInBounds(box, { x: MAX_BOARD_COORD, y: 0 })).toBe(false);
  });

  it('rejects a move that runs off the left', () => {
    // The far edge, not the near one, is what crosses first going negative.
    expect(moveKeepsSelectionInBounds(box, { x: -MAX_BOARD_COORD - 1, y: 0 })).toBe(false);
  });

  it('checks the vertical axis too', () => {
    expect(moveKeepsSelectionInBounds(box, { x: 0, y: MAX_BOARD_COORD })).toBe(false);
    expect(moveKeepsSelectionInBounds(box, { x: 0, y: -MAX_BOARD_COORD - 1 })).toBe(false);
  });

  it('allows a move that lands exactly on the limit', () => {
    // Upstream's test is a strict inequality, so the boundary itself is legal.
    expect(moveKeepsSelectionInBounds(box, { x: MAX_BOARD_COORD - MM(10), y: 0 })).toBe(true);
  });

  it('puts the limit at INT_MAX * sqrt(1/2)', () => {
    // The sqrt(1/2) is what keeps a corner point's magnitude inside an int, so
    // a plain INT_MAX here would be wrong by 41%.
    expect(MAX_BOARD_COORD).toBe(Math.floor(2147483647 * Math.SQRT1_2));
    // 1518.5 mm — a metre and a half, which is the real ceiling on board size.
    expect(MAX_BOARD_COORD / 1e6).toBeCloseTo(1518.5, 3);
  });
});

describe('what each kind of item calls its anchor', () => {
  // BOARD_ITEM::GetPosition, which differs per class and is nowhere near the
  // bounding-box centre for most of them.
  it("is a track's start point", () => {
    const b = board({ tracks: [track(3, 7, 13, 7)] });

    expect(itemAnchorPoint(b, 'track:0')).toEqual({ x: MM(3), y: MM(7) });
  });

  it("is an arc track's centre, which is stored nowhere", () => {
    // PCB_ARC::GetPosition computes the centre from the three points rather
    // than reading a field, so this is the one anchor that is derived.
    const b = board({
      arcs: [
        {
          start: { x: 0, y: 0 },
          mid: { x: MM(5), y: MM(5) },
          end: { x: MM(10), y: 0 },
          width: MM(0.25),
          layer: 'F.Cu',
          net: 0,
          source: EMPTY,
        },
      ],
    });
    const a = itemAnchorPoint(b, 'arc:0')!;

    // The circle through (0,0), (5,5) and (10,0) is centred at (5,0) — not at
    // the arc's start, which is where a field-read would land.
    near(a.x, MM(5));
    near(a.y, 0);
  });

  it("is a via's own position", () => {
    const b = board({
      vias: [
        {
          at: { x: MM(4), y: MM(9) },
          size: MM(0.8),
          drill: MM(0.4),
          layers: ['F.Cu', 'B.Cu'],
          kind: 'through',
          net: 0,
          source: EMPTY,
        },
      ],
    });

    expect(itemAnchorPoint(b, 'via:0')).toEqual({ x: MM(4), y: MM(9) });
  });

  it("is a polygon's first vertex", () => {
    const b = board({
      shapes: [
        {
          kind: 'poly',
          pts: [
            { x: MM(1), y: MM(2) },
            { x: MM(9), y: MM(2) },
            { x: MM(9), y: MM(8) },
          ],
          width: 0,
          fill: true,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

    expect(itemAnchorPoint(b, 'shape:0')).toEqual({ x: MM(1), y: MM(2) });
  });

  it("is a circle's centre", () => {
    // KiCad stores a circle as its centre plus a point on it, so getPosition
    // returns the centre — not a point on the rim.
    const b = board({
      shapes: [
        {
          kind: 'circle',
          center: { x: MM(5), y: MM(5) },
          end: { x: MM(8), y: MM(5) },
          width: MM(0.1),
          fill: false,
          layer: 'F.SilkS',
          source: EMPTY,
        },
      ],
    });

    expect(itemAnchorPoint(b, 'shape:0')).toEqual({ x: MM(5), y: MM(5) });
  });

  it("is a zone's first outline corner", () => {
    const b = board({
      zones: [
        {
          net: 0,
          layers: ['F.Cu'],
          fills: [],
          outline: [
            { x: MM(2), y: MM(3) },
            { x: MM(12), y: MM(3) },
          ],
          source: EMPTY,
        },
      ],
    });

    expect(itemAnchorPoint(b, 'zone:0')).toEqual({ x: MM(2), y: MM(3) });
  });

  it('is nothing for an id that resolves to nothing', () => {
    expect(itemAnchorPoint(board(), 'track:9')).toBeNull();
    expect(itemAnchorPoint(board(), 'nonsense')).toBeNull();
  });
});

describe('translate, then rotate about where the selection now is', () => {
  const two = (): Board => board({ tracks: [track(0, 0, 10, 0), track(0, 20, 10, 20)] });

  it('turns about the post-move centre, not the one the selection started at', () => {
    // Translating by +20 in x puts the selection centre at (25,10). Rotating
    // track:1's start (20,20) about that: d = (−5,10) → (10,5) → (35,15).
    // Using the *stale* centre (5,10) would give d = (15,10) → (10,−15) →
    // (15,−5): a different point, and the mistake this pins.
    const out = moveExact(two(), ['track:0', 'track:1'], {
      translation: { x: MM(20), y: 0 },
      rotation: 90,
    });

    near(out.tracks[1]!.start.x, MM(35));
    near(out.tracks[1]!.start.y, MM(15));
  });

  it('carries the other item along consistently', () => {
    // track:0's start (0,0) moves to (20,0); about (25,10): d = (−5,−10) →
    // (−10,5) → (15,15).
    const out = moveExact(two(), ['track:0', 'track:1'], {
      translation: { x: MM(20), y: 0 },
      rotation: 90,
    });

    near(out.tracks[0]!.start.x, MM(15));
    near(out.tracks[0]!.start.y, MM(15));
  });

  it('is a rigid motion — the selection keeps its shape and size', () => {
    const b = two();
    const out = moveExact(b, ['track:0', 'track:1'], {
      translation: { x: MM(20), y: MM(-7) },
      rotation: 33,
    });
    const len = (t: PcbTrack): number => Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y);
    const gap = (bd: Board): number =>
      Math.hypot(
        bd.tracks[0]!.start.x - bd.tracks[1]!.start.x,
        bd.tracks[0]!.start.y - bd.tracks[1]!.start.y,
      );

    nearDerived(len(out.tracks[0]!), len(b.tracks[0]!));
    nearDerived(gap(out), gap(b));
  });
});

describe('a rectangle rotated off-axis', () => {
  const rectBoard = (): Board => board({ shapes: [rect(0, 0, 10, 4)] });

  it('stays a rectangle at a cardinal angle', () => {
    const out = moveExact(rectBoard(), ['shape:0'], { translation: { x: 0, y: 0 }, rotation: 90 });

    expect(out.shapes[0]!.kind).toBe('rect');
    expect(out.shapes[0]!.pts).toBeUndefined();
  });

  it('becomes a four-point polygon at any other angle', () => {
    // The model stores a rect as two opposite corners of an axis-aligned box,
    // so rotating just those two points would keep it axis-aligned and resize
    // it into something the user never drew.
    const out = moveExact(rectBoard(), ['shape:0'], { translation: { x: 0, y: 0 }, rotation: 45 });
    const s = out.shapes[0]!;

    expect(s.kind).toBe('poly');
    expect(s.pts).toHaveLength(4);
    expect(s.start).toBeUndefined();
    expect(s.end).toBeUndefined();
  });

  it('keeps the rectangle at its original size through the conversion', () => {
    const out = moveExact(rectBoard(), ['shape:0'], { translation: { x: 0, y: 0 }, rotation: 45 });
    const p = out.shapes[0]!.pts!;
    const side = (a: number, b: number): number => Math.hypot(p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y);

    // 10 x 4 before, 10 x 4 after: a rotation is not a resize.
    nearDerived(side(0, 1), MM(10));
    nearDerived(side(1, 2), MM(4));
    // …and it really is turned, not merely retyped.
    expect(p[0]!.y).not.toBe(p[1]!.y);
  });

  it('keeps everything else about the shape', () => {
    const out = moveExact(rectBoard(), ['shape:0'], { translation: { x: 0, y: 0 }, rotation: 45 });

    expect(out.shapes[0]!.layer).toBe('F.SilkS');
    expect(out.shapes[0]!.fill).toBe(true);
  });

  it('writes itself back out as a polygon', () => {
    // The shape kind lives in the source node's head atom. Changing the model
    // without the source would write a gr_rect back out and lose the rotation
    // on the next load.
    const withSource = board({
      shapes: [
        {
          ...rect(0, 0, 10, 4),
          source: list(
            atom('gr_rect'),
            list(atom('start'), atom('0'), atom('0')),
            list(atom('end'), atom('10'), atom('4')),
            list(atom('layer'), str('F.SilkS')),
          ),
        },
      ],
      source: list(atom('kicad_pcb'), list(atom('gr_rect'))),
    });
    const out = moveExact(withSource, ['shape:0'], { translation: { x: 0, y: 0 }, rotation: 30 });
    const node = writeBoardNode(out);
    const shapeNode = node.items[1]!;

    if (!isList(shapeNode)) throw new Error('expected a shape node');
    expect(head(shapeNode)).toBe('gr_poly');

    const childHeads = shapeNode.items.filter(isList).map((i) => head(i));
    expect(childHeads).toContain('pts');
    // start/end mean nothing on a polygon and must not survive.
    expect(childHeads).not.toContain('start');
    expect(childHeads).not.toContain('end');
    // Unrelated children are left where they were.
    expect(childHeads).toContain('layer');
  });

  it('leaves a cardinal rotation writing gr_rect', () => {
    const withSource = board({
      shapes: [
        {
          ...rect(0, 0, 10, 4),
          source: list(
            atom('gr_rect'),
            list(atom('start'), atom('0'), atom('0')),
            list(atom('end'), atom('10'), atom('4')),
          ),
        },
      ],
      source: list(atom('kicad_pcb'), list(atom('gr_rect'))),
    });
    const out = moveExact(withSource, ['shape:0'], { translation: { x: 0, y: 0 }, rotation: 90 });
    const shapeNode = writeBoardNode(out).items[1]!;

    if (!isList(shapeNode)) throw new Error('expected a shape node');
    expect(head(shapeNode)).toBe('gr_rect');
  });

  it('treats a full turn as cardinal', () => {
    const out = moveExact(rectBoard(), ['shape:0'], { translation: { x: 0, y: 0 }, rotation: 360 });

    expect(out.shapes[0]!.kind).toBe('rect');
  });

  it('treats a negative right angle as cardinal', () => {
    const out = moveExact(rectBoard(), ['shape:0'], { translation: { x: 0, y: 0 }, rotation: -90 });

    expect(out.shapes[0]!.kind).toBe('rect');
  });

  it('does not treat a near-right angle as cardinal', () => {
    // Upstream's IsCardinal is an exact test, and it has to be: 89.9° really
    // does tilt the rectangle.
    const out = moveExact(rectBoard(), ['shape:0'], {
      translation: { x: 0, y: 0 },
      rotation: 89.9,
    });

    expect(out.shapes[0]!.kind).toBe('poly');
  });
});
