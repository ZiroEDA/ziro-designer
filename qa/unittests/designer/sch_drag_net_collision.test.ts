// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The drag that would rewire the sheet, and the ring that says so.
 *
 * `SCH_DRAG_NET_COLLISION_MONITOR` is the only thing in eeschema that reads
 * `selection.drag_net_collision_width`, so this file is what makes that
 * preference a live control rather than a stored number.
 *
 * Every case here is geometry plus two documents — the sheet as it was when the
 * drag began and the sheet as the ghost has it — because that pair is what the
 * port replaces upstream's mutable screen with.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  beginDragNetCollision,
  dragNetCollisionMarkers,
  dragNetCollisionAlphas,
  dragNetCollisionPenPx,
  hasDragNetCollision,
  movedPreviewItems,
  previewJunctionPoints,
  type DragPenWidths,
} from '@ziroeda/eeschema/src/tools/drag_net_collision.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';

const MM = 10000;
const LIB = new Map<string, LibSymbol>();

/** DEFAULT_LINE_WIDTH_MILS 6 / DEFAULT_WIRE_WIDTH_MILS 6 / _BUS_ 12, in IU. */
const PENS: DragPenWidths = {
  defaultLineWidthIU: 0.1524 * MM,
  wireWidthIU: 0.1524 * MM,
  busWidthIU: 0.3048 * MM,
};

const sheet = (body: string): string =>
  `(kicad_sch (version 20250114) (generator "eeschema")\n${body}\n  (sheet_instances (path "/" (page "1"))))\n`;

const wire = (uuid: string, x1: number, y1: number, x2: number, y2: number): string =>
  `  (wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)) (uuid "${uuid}"))`;

const label = (uuid: string, text: string, x: number, y: number): string =>
  `  (label "${text}" (at ${x} ${y} 0) (effects (font (size 1.27 1.27))) (uuid "${uuid}"))`;

const doc = (body: string) => readSchematic(parse(sheet(body)));

/**
 * A wire on net A dragged into the middle of a wire on net B.
 *
 * `w1` runs west from x=20 after the drag, so its end lands on `w2`'s midpoint:
 * three exits meet there (w1 west, w2 north, w2 south), which is what makes it
 * a preview junction at all, and the two wires arrive carrying different net
 * codes, which is what makes it a collision.
 */
const twoNetsBefore = doc(
  [
    wire('w1', 0, 0, 10, 0),
    label('la', 'A', 0, 0),
    wire('w2', 20, -10, 20, 10),
    label('lb', 'B', 20, 10),
  ].join('\n'),
);
const twoNetsAfter = doc(
  [
    wire('w1', 10, 0, 20, 0),
    label('la', 'A', 10, 0),
    wire('w2', 20, -10, 20, 10),
    label('lb', 'B', 20, 10),
  ].join('\n'),
);
/** The wire AND its label, so pulling the wire off its own driver is not what
 *  is being measured here. */
const DRAGGED = new Set(['w1', 'la']);

describe('a drag that would merge two nets', () => {
  const state = beginDragNetCollision(twoNetsBefore, LIB, DRAGGED, { pens: PENS });
  const marks = dragNetCollisionMarkers(state, twoNetsAfter, LIB, DRAGGED, PENS);

  it('rings the junction the two nets would meet at', () => {
    expect(marks.collisions.map((c) => c.at)).toEqual([{ x: 20 * MM, y: 0 }]);
  });

  it('is what AdjustCursor reads', () => {
    expect(hasDragNetCollision(marks)).toBe(true);
  });

  it('pulls nothing apart — the label came along', () => {
    expect(marks.disconnections).toEqual([]);
  });

  /**
   * `std::max( aJunction->GetEffectiveDiameter() * 1.5, 800.0 )`
   * (`sch_drag_net_collision.cpp:426-427`).
   *
   * A preview junction is `new SCH_JUNCTION( pt )` and is never added to a
   * screen, so `getEffectiveShape` finds no `Schematic()` and takes
   * `MilsToIU( DEFAULT_JUNCTION_DIAM )` — 36 mils — rather than this project's
   * junction-dot size. 36 x 254 x 1.5 = 13716 IU, or 54 mils across the radius.
   */
  it('is 1.5 junction diameters across, from KiCad’s default and not ours', () => {
    expect(marks.collisions[0]?.radius).toBe(13716);
  });

  it('reports the collision before the drag has been committed to anything', () => {
    // The analysis never touches the document it was given second beyond its
    // geometry: the net codes are all from the first one.
    expect(state.netByItem.get('w1')).not.toBe(state.netByItem.get('w2'));
  });
});

describe('a drag onto the same net', () => {
  // The one change: `w2`'s label says A too, and two same-named local labels on
  // one sheet are one net (`mergeBySharedDriverName`).
  const before = doc(
    [
      wire('w1', 0, 0, 10, 0),
      label('la', 'A', 0, 0),
      wire('w2', 20, -10, 20, 10),
      label('lb', 'A', 20, 10),
    ].join('\n'),
  );
  const after = doc(
    [
      wire('w1', 10, 0, 20, 0),
      label('la', 'A', 10, 0),
      wire('w2', 20, -10, 20, 10),
      label('lb', 'A', 20, 10),
    ].join('\n'),
  );

  it('rings nothing — a junction is not a warning', () => {
    const state = beginDragNetCollision(before, LIB, DRAGGED, { pens: PENS });
    const marks = dragNetCollisionMarkers(state, after, LIB, DRAGGED, PENS);
    expect(marks.collisions).toEqual([]);
    expect(hasDragNetCollision(marks)).toBe(false);
  });

  it('really is one net, so the case is the one it claims to be', () => {
    const state = beginDragNetCollision(before, LIB, DRAGGED, { pens: PENS });
    expect(state.netByItem.get('w1')).toBe(state.netByItem.get('w2'));
  });
});

/**
 * `PreviewJunctions` does not only ask about the ENDS of what moved: for a
 * dragged line it also asks about every existing connection point the line now
 * passes over (`junction_helpers.cpp:290-299`, through
 * `aScreen->GetConnections()`).
 *
 * Without that half, a wire dragged straight ACROSS another net's connection
 * point produces no candidate at all and the merge goes unwarned.
 */
describe('a wire dragged across a connection point rather than onto it', () => {
  const before = doc(
    [
      wire('w1', 0, 0, 5, 0),
      label('la', 'A', 0, 0),
      wire('w2', 20, 0, 20, 10),
      label('lb', 'B', 20, 10),
    ].join('\n'),
  );
  // w1 now runs from x=10 to x=30: (20, 0) is in its INTERIOR, not an endpoint.
  const after = doc(
    [
      wire('w1', 10, 0, 30, 0),
      label('la', 'A', 10, 0),
      wire('w2', 20, 0, 20, 10),
      label('lb', 'B', 20, 10),
    ].join('\n'),
  );

  it('finds the crossing as a candidate junction', () => {
    const state = beginDragNetCollision(before, LIB, DRAGGED, { pens: PENS });
    const moved = movedPreviewItems(state, after, DRAGGED);
    expect(previewJunctionPoints(after, LIB, moved, PENS)).toEqual([{ x: 20 * MM, y: 0 }]);
  });

  it('and rings it', () => {
    const state = beginDragNetCollision(before, LIB, DRAGGED, { pens: PENS });
    const marks = dragNetCollisionMarkers(state, after, LIB, DRAGGED, PENS);
    expect(marks.collisions.map((c) => c.at)).toEqual([{ x: 20 * MM, y: 0 }]);
  });
});

/**
 * `collectDisconnectedMarkers` (`:522-580`): the other half of the overlay, and
 * the half that fires on a drag that connects nothing.
 */
describe('a drag that pulls a connection apart', () => {
  const before = doc([wire('w1', 0, 0, 10, 0), label('la', 'A', 0, 0)].join('\n'));
  // Only the wire is selected, so the label stays where it was.
  const after = doc([wire('w1', 10, 0, 20, 0), label('la', 'A', 0, 0)].join('\n'));
  const sel = new Set(['w1']);
  const state = beginDragNetCollision(before, LIB, sel, { pens: PENS });
  const marks = dragNetCollisionMarkers(state, after, LIB, sel, PENS);

  it('recorded the touch before the drag moved anything', () => {
    expect(state.connections).toEqual([{ a: 'la', ai: 0, b: 'w1', bi: 0 }]);
  });

  it('marks the two points that came apart', () => {
    expect(marks.disconnections.map((d) => [d.a, d.b])).toEqual([
      [
        { x: 0, y: 0 },
        { x: 10 * MM, y: 0 },
      ],
    ]);
  });

  it('is a warning in its own right, with no junction anywhere', () => {
    expect(marks.collisions).toEqual([]);
    expect(hasDragNetCollision(marks)).toBe(true);
  });

  /**
   * `std::max( { 800.0, itemA->GetPenWidth(), itemB->GetPenWidth() } )`.
   *
   * A label has no pen of its own; the wire's is the netclass wire width, 6
   * mils = 1524 IU, which is over the 800 floor — so the floor is NOT what
   * decides this and a project with fatter wires gets fatter marks.
   */
  it('is sized by the thicker of the two pens, not by the floor', () => {
    expect(marks.disconnections[0]?.radius).toBe(1524);
    const fat = dragNetCollisionMarkers(state, after, LIB, sel, {
      ...PENS,
      wireWidthIU: 3 * MM,
    });
    expect(fat.disconnections[0]?.radius).toBe(3 * MM);
  });

  it('takes the 800 IU floor when both pens are under it', () => {
    const thin = dragNetCollisionMarkers(state, after, LIB, sel, {
      ...PENS,
      wireWidthIU: 100,
    });
    expect(thin.disconnections[0]?.radius).toBe(800);
  });
});

/**
 * Dragging a wire ALONG itself slides the contact rather than breaking it: the
 * label's point is still on the wire, just no longer at its end. Upstream tests
 * exactly this with `itemA->HitTest( pointB )` (`:551-556`).
 */
describe('a drag that slides a connection along a wire', () => {
  const before = doc([wire('w1', 0, 0, 30, 0), label('la', 'A', 0, 0)].join('\n'));
  const after = doc([wire('w1', -10, 0, 20, 0), label('la', 'A', 0, 0)].join('\n'));
  const sel = new Set(['w1']);

  it('marks nothing: the point is still on the wire', () => {
    const state = beginDragNetCollision(before, LIB, sel, { pens: PENS });
    expect(state.connections).toHaveLength(1);
    const marks = dragNetCollisionMarkers(state, after, LIB, sel, PENS);
    expect(marks.disconnections).toEqual([]);
  });
});

/**
 * The same slide, with the two items the other way round in the recorded pair.
 *
 * `m_originalConnections` stores its two sides in a stable order — upstream by
 * pointer, here by refId — and `collectDisconnectedMarkers` then hit-tests
 * `itemA` against B's point AND `itemB` against A's (`:551-556`). Which of the
 * two is the line depends entirely on that ordering, so one test only ever
 * exercises one of the two hit tests. This is the other one: the wire's id
 * sorts FIRST here, where above it sorted second.
 */
describe('the same slide, with the wire on the other side of the pair', () => {
  const before = doc([wire('aw', 0, 0, 30, 0), label('zl', 'A', 0, 0)].join('\n'));
  const after = doc([wire('aw', -10, 0, 20, 0), label('zl', 'A', 0, 0)].join('\n'));
  const sel = new Set(['aw']);
  const state = beginDragNetCollision(before, LIB, sel, { pens: PENS });

  it('really is the other ordering, or it would be the same test twice', () => {
    expect(state.connections).toEqual([{ a: 'aw', ai: 0, b: 'zl', bi: 0 }]);
  });

  it('marks nothing: the point is still on the wire', () => {
    expect(dragNetCollisionMarkers(state, after, LIB, sel, PENS).disconnections).toEqual([]);
  });
});

/**
 * `SCH_LINE::IsConnectable()` is true for LAYER_WIRE and LAYER_BUS only
 * (`sch_line.cpp:665-671`).
 *
 * A graphic polyline drawn to the same point as a wire is not wired to it, so
 * dragging the wire away breaks nothing — and a monitor that counted graphics
 * would raise a disconnection mark on every drag away from a drawn box.
 */
describe('a graphic line touching the same point', () => {
  const before = doc(
    [
      wire('w1', 0, 0, 10, 0),
      '  (polyline (pts (xy 0 0) (xy 0 -10)) (stroke (width 0) (type default)) (uuid "gfx"))',
    ].join('\n'),
  );
  const after = doc(
    [
      wire('w1', 10, 0, 20, 0),
      '  (polyline (pts (xy 0 0) (xy 0 -10)) (stroke (width 0) (type default)) (uuid "gfx"))',
    ].join('\n'),
  );
  const sel = new Set(['w1']);

  it('is not a connection, so the drag pulls nothing apart', () => {
    const state = beginDragNetCollision(before, LIB, sel, { pens: PENS });
    expect(state.connections).toEqual([]);
    expect(dragNetCollisionMarkers(state, after, LIB, sel, PENS).disconnections).toEqual([]);
  });
});

/**
 * A bus is connectable too — LAYER_BUS is the other half of
 * `SCH_LINE::IsConnectable()` — and takes the netclass BUS pen, twelve mils
 * against a wire's six, which is what a disconnection ring is sized by.
 */
describe('a drag that pulls two buses apart', () => {
  const bus = (uuid: string, x1: number, y1: number, x2: number, y2: number): string =>
    `  (bus (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)) (uuid "${uuid}"))`;
  const before = doc([bus('b1', 0, 0, 10, 0), bus('b2', 0, 0, 0, 10)].join('\n'));
  const after = doc([bus('b1', 10, 0, 20, 0), bus('b2', 0, 0, 0, 10)].join('\n'));
  const sel = new Set(['b1']);
  const state = beginDragNetCollision(before, LIB, sel, { pens: PENS });

  it('recorded the touch, so a bus is not treated as a graphic', () => {
    expect(state.connections).toEqual([{ a: 'b1', ai: 0, b: 'b2', bi: 0 }]);
  });

  it('marks it, at the BUS pen and not the wire one', () => {
    const marks = dragNetCollisionMarkers(state, after, LIB, sel, PENS);
    expect(marks.disconnections).toHaveLength(1);
    expect(marks.disconnections[0]?.radius).toBe(0.3048 * MM);
  });
});

/**
 * `previewItems` is the selection PLUS `m_newDragLines` and
 * `m_changedDragLines` (`sch_move_tool.cpp:846-857`) — the rubber-band stubs a
 * drag creates and the wires whose ends it stretches. Neither is selected, so
 * neither can be found from the selection.
 */
describe('the lines a drag reshapes without selecting', () => {
  const before = doc([wire('w1', 0, 0, 10, 0), wire('w2', 10, 0, 10, 10)].join('\n'));
  const after = doc([wire('w1', 0, 10, 10, 10), wire('w2', 10, 10, 10, 20)].join('\n'));
  const state = beginDragNetCollision(before, LIB, new Set(['w1']), { pens: PENS });

  it('counts a stretched wire as moved even though it is not selected', () => {
    expect([...movedPreviewItems(state, after, new Set(['w1']))].sort()).toEqual(['w1', 'w2']);
  });

  it('counts a wire the drag added, which the old document does not have', () => {
    const grown = doc(
      [wire('w1', 0, 0, 10, 0), wire('w2', 10, 0, 10, 10), wire('stub', 10, 0, 15, 0)].join('\n'),
    );
    expect(movedPreviewItems(state, grown, new Set(['w1'])).has('stub')).toBe(true);
  });

  it('leaves a wire the drag did not touch out of it', () => {
    const same = doc([wire('w1', 0, 0, 10, 0), wire('w2', 10, 0, 10, 10)].join('\n'));
    expect(movedPreviewItems(state, same, new Set(['w1'])).has('w2')).toBe(false);
  });
});

/**
 * A selection holding anything new or pasted records no original connections at
 * all (`:487-503`) — nothing it could have been pulled away from.
 *
 * Ours reaches the same place by construction rather than by a flag: a pasted
 * item is not in the pre-drag document, so it has no points there to record.
 */
describe('a drag of something that was not on the sheet a moment ago', () => {
  it('has nothing to call a disconnection', () => {
    const before = doc([wire('w1', 0, 0, 10, 0), label('la', 'A', 0, 0)].join('\n'));
    const after = doc(
      [wire('w1', 0, 0, 10, 0), label('la', 'A', 0, 0), wire('new', 40, 40, 50, 40)].join('\n'),
    );
    const sel = new Set(['new']);
    const state = beginDragNetCollision(before, LIB, sel, { pens: PENS });
    expect(state.connections).toEqual([]);
    expect(dragNetCollisionMarkers(state, after, LIB, sel, PENS).disconnections).toEqual([]);
  });
});

/** The two numbers the overlay is actually drawn with. */
describe('the pen and the alphas the overlay takes', () => {
  it('is the configured width in device pixels, with 1 as the floor', () => {
    // `std::max( cfg->m_Selection.drag_net_collision_width, 1 )` (`:181-183`).
    expect(dragNetCollisionPenPx(4)).toBe(4);
    expect(dragNetCollisionPenPx(50)).toBe(50);
    expect(dragNetCollisionPenPx(0)).toBe(1);
    expect(dragNetCollisionPenPx(-3)).toBe(1);
  });

  it('fills at 35% of the theme alpha and strokes at all of it', () => {
    // `fillAlpha = clamp( baseAlpha * 0.35, 0.05, 1 )`,
    // `strokeAlpha = clamp( baseAlpha, 0.05, 1 )` (`:167-171`). The default
    // theme's LAYER_DRAG_NET_COLLISION is (230, 9, 13, 0.8).
    const a = dragNetCollisionAlphas(0.8);
    expect(a.fill).toBeCloseTo(0.28, 10);
    expect(a.stroke).toBeCloseTo(0.8, 10);
  });

  it('reads a fully transparent theme colour as opaque', () => {
    // `if( baseAlpha <= 0.0 ) baseAlpha = 1.0` — an invisible marker is no
    // marker, so upstream refuses to draw one.
    expect(dragNetCollisionAlphas(0)).toEqual({ fill: 0.35, stroke: 1 });
  });

  it('never fades either below 0.05', () => {
    const a = dragNetCollisionAlphas(0.01);
    expect(a.fill).toBe(0.05);
    expect(a.stroke).toBe(0.05);
  });
});
