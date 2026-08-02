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
  moveExact,
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

  it('turns a single item about its own centre', () => {
    const out = moveExact(two(), ['track:0'], { translation: { x: 0, y: 0 }, rotation: 90 });

    // About its own centre (5,0): d = (−5,0) → (0,5) → (5,5). It turns in
    // place, its midpoint unmoved.
    near(out.tracks[0]!.start.x, MM(5));
    near(out.tracks[0]!.start.y, MM(5));
    near(out.tracks[0]!.end.x, MM(5));
    near(out.tracks[0]!.end.y, MM(-5));
  });

  it('rotates each item in place when asked for the item anchor', () => {
    const out = moveExact(two(), ['track:0', 'track:1'], {
      translation: { x: 0, y: 0 },
      rotation: 90,
      anchor: 'itemAnchor',
    });

    // Each stays centred where it was: the second track does not orbit the
    // first, which is exactly what the selection-centre anchor would make it do.
    near((out.tracks[0]!.start.y + out.tracks[0]!.end.y) / 2, 0);
    near((out.tracks[1]!.start.y + out.tracks[1]!.end.y) / 2, MM(20));
  });

  it('rotates about a user origin', () => {
    const out = moveExact(two(), ['track:0'], {
      translation: { x: 0, y: 0 },
      rotation: 90,
      anchor: 'userOrigin',
      userOrigin: { x: 0, y: 0 },
    });

    // The start point sits on the origin, so it does not move; the end swings
    // from (10,0) to (0,−10).
    near(out.tracks[0]!.start.x, 0);
    near(out.tracks[0]!.start.y, 0);
    near(out.tracks[0]!.end.x, 0);
    near(out.tracks[0]!.end.y, MM(-10));
  });

  it('rotates about the aux origin', () => {
    const out = moveExact(two(), ['track:0'], {
      translation: { x: 0, y: 0 },
      rotation: 180,
      anchor: 'auxOrigin',
      auxOrigin: { x: 0, y: 0 },
    });

    near(out.tracks[0]!.end.x, MM(-10));
    near(out.tracks[0]!.end.y, 0);
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
