// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import {
  boardItemId,
  parseBoardItemId,
  boardItemBBox,
  hitTestBoard,
  boardHitCandidates,
  boardItemsInBox,
  moveBoardItems,
  deleteBoardItems,
  rotateBoardItems,
  duplicateBoardItems,
  mirrorBoardItems,
  groupBoardItems,
  ungroupBoardItems,
  addToGroupItems,
  removeFromGroupItems,
  expandGroupIds,
  filterSelectionForFreePads,
  filterSelectionForDelete,
  zoneHandles,
  zoneBorderHit,
  moveZoneCorner,
  moveZoneEdge,
  groupContaining,
  setBoardItemsLocked,
  allBoardItemIds,
  isBoardItemLocked,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type {
  Board,
  PcbTrack,
  PcbArcTrack,
  PcbVia,
  PcbFootprint,
  PcbShape,
  PcbTextItem,
  PcbZone,
  PcbPad,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };

// Minimal typed-model builders (geometry is unit-agnostic; coords in internal units).
const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  width = 100,
): PcbTrack => ({ start, end, width, layer: 'F.Cu', net: 0, source: EMPTY });
const via = (at: { x: number; y: number }, size = 200): PcbVia => ({
  at,
  size,
  drill: 100,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 0,
  source: EMPTY,
});
const arcTrack = (
  start: { x: number; y: number },
  mid: { x: number; y: number },
  end: { x: number; y: number },
  width = 100,
): PcbArcTrack => ({ start, mid, end, width, layer: 'F.Cu', net: 0, source: EMPTY });
const pad = (at: { x: number; y: number }, sx: number, sy: number): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at,
  angle: 0,
  size: { x: sx, y: sy },
  layers: ['F.Cu'],
  source: EMPTY,
});
const footprint = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'R',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
});
const lineShape = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  width = 100,
): PcbShape => ({
  kind: 'line',
  start,
  end,
  width,
  fillMode: 'none',
  layer: 'Edge.Cuts',
  source: EMPTY,
});
const text = (at: { x: number; y: number }, s: string, size = 1000): PcbTextItem => ({
  kind: 'user',
  text: s,
  at,
  angle: 0,
  layer: 'F.SilkS',
  size: { x: size, y: size },
  source: EMPTY,
});
const zone = (poly: { x: number; y: number }[]): PcbZone => ({
  net: 0,
  layers: ['F.Cu'],
  fills: [{ layer: 'F.Cu', polys: [poly] }],
  source: EMPTY,
});

const board = (over: Partial<Board>): Board => ({
  version: 20241229,
  layers: [],
  nets: new Map(),
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
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

describe('board item ids', () => {
  it('round-trips id <-> ref', () => {
    expect(parseBoardItemId(boardItemId('track', 3))).toEqual({ kind: 'track', index: 3 });
    expect(parseBoardItemId('footprint:0')).toEqual({ kind: 'footprint', index: 0 });
  });
  it('rejects malformed ids', () => {
    expect(parseBoardItemId('bogus:1')).toBeNull();
    expect(parseBoardItemId('track')).toBeNull();
    expect(parseBoardItemId('track:-1')).toBeNull();
    expect(parseBoardItemId('via:x')).toBeNull();
  });
});

describe('track hit-test (TestSegmentHit)', () => {
  const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100)] });
  it('hits within accuracy + half-width of the segment', () => {
    expect(hitTestBoard(b, { x: 500, y: 40 }, 10)).toBe('track:0'); // 40 <= 10 + 50
  });
  it('misses beyond accuracy + half-width', () => {
    expect(hitTestBoard(b, { x: 500, y: 100 }, 10)).toBeNull(); // 100 > 60
  });
  it('misses past the endpoints', () => {
    expect(hitTestBoard(b, { x: 1200, y: 0 }, 10)).toBeNull();
  });
});

describe('via hit-test', () => {
  const b = board({ vias: [via({ x: 2000, y: 0 }, 200)] }); // radius 100
  it('hits inside the pad radius', () => {
    expect(hitTestBoard(b, { x: 2050, y: 0 }, 0)).toBe('via:0');
  });
  it('misses outside radius + accuracy', () => {
    expect(hitTestBoard(b, { x: 2000, y: 150 }, 10)).toBeNull(); // 150 > 110
  });
});

describe('arc hit-test (PCB_ARC::HitTest)', () => {
  // CCW quarter arc centred at origin, radius 1000: (1000,0) -> (707,707) -> (0,1000)
  const b = board({
    arcs: [arcTrack({ x: 1000, y: 0 }, { x: 707, y: 707 }, { x: 0, y: 1000 }, 100)],
  });
  it('hits a point on the arc band within the sweep', () => {
    expect(hitTestBoard(b, { x: 707, y: 707 }, 20)).toBe('arc:0');
  });
  it('hits at an endpoint (short-circuit)', () => {
    expect(hitTestBoard(b, { x: 1000, y: 0 }, 5)).toBe('arc:0');
  });
  it('misses a point on the circle but outside the sweep', () => {
    expect(hitTestBoard(b, { x: -1000, y: 0 }, 20)).toBeNull(); // radius ok, angle 180 not in [0,90]
  });
  it('misses a point off the radial band', () => {
    expect(hitTestBoard(b, { x: 500, y: 500 }, 20)).toBeNull(); // dist ~707 vs r 1000
  });
});

describe('shape hit-test (EDA_SHAPE)', () => {
  it('line: near the segment', () => {
    const b = board({ shapes: [lineShape({ x: 0, y: 2000 }, { x: 1000, y: 2000 }, 100)] });
    expect(hitTestBoard(b, { x: 500, y: 2030 }, 10)).toBe('shape:0');
    expect(hitTestBoard(b, { x: 500, y: 2200 }, 10)).toBeNull();
  });
  it('unfilled rect: border is live, interior is not', () => {
    const s: PcbShape = {
      kind: 'rect',
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 1000 },
      width: 40,
      fillMode: 'none',
      layer: 'Edge.Cuts',
      source: EMPTY,
    };
    const b = board({ shapes: [s] });
    expect(hitTestBoard(b, { x: 0, y: 500 }, 5)).toBe('shape:0'); // on left border
    expect(hitTestBoard(b, { x: 500, y: 500 }, 5)).toBeNull(); // interior
  });
  it('filled circle: interior hits', () => {
    const s: PcbShape = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: 500, y: 0 },
      width: 20,
      fillMode: 'solid',
      layer: 'F.SilkS',
      source: EMPTY,
    };
    const b = board({ shapes: [s] });
    expect(hitTestBoard(b, { x: 100, y: 100 }, 0)).toBe('shape:0');
  });
  it('HATCHED circle: the interior does NOT hit, because hit-testing asks IsSolidFill', () => {
    // `EDA_SHAPE::IsFilledForHitTesting()` is `IsSolidFill()` (eda_shape.h:143),
    // and the three hatch modes are not solid — so a hatched shape is picked by
    // its outline, exactly as an unfilled one is. `IsAnyFill()` would be true
    // here and is the wrong question.
    const hatched: PcbShape = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: 500, y: 0 },
      width: 20,
      fillMode: 'cross_hatch',
      layer: 'F.SilkS',
      source: EMPTY,
    };
    const b = board({ shapes: [hatched] });
    expect(hitTestBoard(b, { x: 100, y: 100 }, 0)).toBeNull();
    expect(hitTestBoard(b, { x: 500, y: 0 }, 5)).toBe('shape:0');
  });
});

describe('text hit-test (bounding box)', () => {
  const b = board({ texts: [text({ x: 8000, y: 8000 }, 'AB', 1000)] });
  it('hits within the text box', () => {
    expect(hitTestBoard(b, { x: 8000, y: 8000 }, 0)).toBe('text:0');
  });
  it('misses well outside', () => {
    expect(hitTestBoard(b, { x: 8000, y: 9000 }, 0)).toBeNull();
  });
});

describe('zone hit-test (point in filled polygon)', () => {
  const b = board({
    zones: [
      zone([
        { x: 10000, y: 10000 },
        { x: 11000, y: 10000 },
        { x: 11000, y: 11000 },
        { x: 10000, y: 11000 },
      ]),
    ],
  });
  it('hits inside the pour', () => {
    expect(hitTestBoard(b, { x: 10500, y: 10500 }, 0)).toBe('zone:0');
  });
  it('misses outside the pour', () => {
    expect(hitTestBoard(b, { x: 9000, y: 10500 }, 0)).toBeNull();
  });
});

describe("a pour is grabbed by its border, PCB_SELECTION_TOOL's zoneFilledAreaFilter", () => {
  // Real millimetres, because ZONE::HitTest floors its accuracy at 0.1 mm and
  // the toy coordinates elsewhere in this file sit well inside that floor.
  const mm = 1e6;
  // Outline and fill differ, as they do on any real board: the fill is inset
  // from the drawn boundary by the clearance. Grabbing has to follow the
  // outline — the hatched line the user can see — not the copper's edge.
  const pour: PcbZone = {
    ...zone([
      { x: 11 * mm, y: 11 * mm },
      { x: 19 * mm, y: 11 * mm },
      { x: 19 * mm, y: 19 * mm },
      { x: 11 * mm, y: 19 * mm },
    ]),
    outline: [
      { x: 10 * mm, y: 10 * mm },
      { x: 20 * mm, y: 10 * mm },
      { x: 20 * mm, y: 20 * mm },
      { x: 10 * mm, y: 20 * mm },
    ],
  };
  const b = board({ zones: [pour] });
  const tol = 0.25 * mm; // MAX_SLOP = 5 px, at a zoom where a pixel is 50 um

  it('selects on a plain click in the middle of the fill', () => {
    // Upstream only refuses to *grab* there; HitTestFilledArea still selects,
    // and M then moves what the click picked up.
    expect(boardHitCandidates(b, { x: 15 * mm, y: 15 * mm }, tol)).toEqual(['zone:0']);
  });

  it('refuses to grab it there, so the drag rubber-bands instead', () => {
    expect(
      boardHitCandidates(b, { x: 15 * mm, y: 15 * mm }, tol, { excludeZoneFills: true }),
    ).toEqual([]);
  });

  it('still grabs it on an outline edge', () => {
    expect(
      boardHitCandidates(b, { x: 15 * mm, y: 10 * mm }, tol, { excludeZoneFills: true }),
    ).toEqual(['zone:0']);
  });

  it('still grabs it on an outline corner', () => {
    expect(
      boardHitCandidates(b, { x: 20 * mm, y: 20 * mm }, tol, { excludeZoneFills: true }),
    ).toEqual(['zone:0']);
  });

  it('treats the closing edge like any other', () => {
    // The last-to-first segment: a rectangle's bottom edge is not a special
    // case, though a loop that stops at poly.length - 1 makes it one.
    expect(
      boardHitCandidates(b, { x: 15 * mm, y: 20 * mm }, tol, { excludeZoneFills: true }),
    ).toEqual(['zone:0']);
  });

  it('reads the border off the outline, not off the fill', () => {
    // The fill's own edge, 1 mm inside the outline: copper, not border.
    expect(zoneBorderHit(pour, { x: 15 * mm, y: 11 * mm }, 0)).toBe(false);
    expect(zoneBorderHit(pour, { x: 15 * mm, y: 10 * mm }, 0)).toBe(true);
  });

  it('leaves everything that is not a zone alone', () => {
    const withTrack = board({
      zones: [pour],
      tracks: [
        {
          start: { x: 14 * mm, y: 15 * mm },
          end: { x: 16 * mm, y: 15 * mm },
          width: 0.2 * mm,
          layer: 'F.Cu',
          net: 0,
          source: EMPTY,
        },
      ],
    });
    expect(
      boardHitCandidates(withTrack, { x: 15 * mm, y: 15 * mm }, tol, { excludeZoneFills: true }),
    ).toEqual(['track:0']);
  });
});

describe('footprint hit-test + selection priority', () => {
  // Footprint whose pad bbox spans 4800..5200; a track crosses the same region.
  const fp = footprint([pad({ x: 5000, y: 5000 }, 400, 400)]);
  const t = track({ x: 4000, y: 5000 }, { x: 6000, y: 5000 }, 100);
  it('clicking a pad selects the pad, the larger footprint is rejected (area heuristic)', () => {
    // Two pads make the footprint's hull much larger than one pad, so
    // GuessSelectionCandidates rejects it at the 1.5× area jump and the pad is
    // the sole survivor, no disambiguation, no unchecking "Footprints".
    const fp2 = footprint([
      pad({ x: 5000, y: 5000 }, 400, 400),
      pad({ x: 9000, y: 5000 }, 400, 400),
    ]);
    const b = board({ footprints: [fp2] });
    expect(boardHitCandidates(b, { x: 5000, y: 5100 }, 10)).toEqual(['pad:0:0']);
  });
  it('clicking the trace centerline over a pad prefers the trace (smallest coverage area)', () => {
    // Track coverage area is width², far below the pad's face, so the pad is
    // rejected ("clicked on a small item within a larger one"). This footprint
    // is 100% covered by its single pad, so the >70% coverage exception keeps
    // it for the disambiguation menu, exactly like GuessSelectionCandidates.
    const b = board({ footprints: [fp], tracks: [t] });
    expect(boardHitCandidates(b, { x: 5000, y: 5000 }, 10)).toEqual(['track:0', 'footprint:0']);
  });
  it('a sloppy track hit loses to an exact pad hit (prefer exact hits)', () => {
    // Click inside the pad but ~50 IU off the trace edge: the pad hit is exact
    // (slop 0) while the track hit is sloppy, so the track is pruned first.
    const fp2 = footprint([
      pad({ x: 5000, y: 5000 }, 400, 400),
      pad({ x: 9000, y: 5000 }, 400, 400),
    ]);
    const b = board({ footprints: [fp2], tracks: [t] });
    const cands = boardHitCandidates(b, { x: 5000, y: 5100 }, 60);
    expect(cands).toEqual(['pad:0:0']);
  });
});

describe('box selection (contained vs crossing)', () => {
  const b = board({
    tracks: [
      track({ x: 0, y: 0 }, { x: 100, y: 0 }, 20), // fully inside 0..1000
      track({ x: 900, y: 0 }, { x: 2000, y: 0 }, 20), // straddles the right edge
    ],
    vias: [via({ x: 5000, y: 5000 }, 100)], // far outside
  });
  it('contained: only items fully within the rect', () => {
    const sel = boardItemsInBox(b, 0, -500, 1000, 500, true);
    expect(sel).toContain('track:0');
    expect(sel).not.toContain('track:1');
    expect(sel).not.toContain('via:0');
  });
  it('crossing: items that merely intersect the rect', () => {
    const sel = boardItemsInBox(b, 0, -500, 1000, 500, false);
    expect(sel).toContain('track:0');
    expect(sel).toContain('track:1');
    expect(sel).not.toContain('via:0');
  });
});

describe('boardItemBBox', () => {
  it('via bbox is centre ± radius', () => {
    const b = board({ vias: [via({ x: 100, y: 200 }, 200)] });
    expect(boardItemBBox(b, 'via:0')).toEqual({ minX: 0, minY: 100, maxX: 200, maxY: 300 });
  });
  it('track bbox is inflated by half-width', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100)] });
    expect(boardItemBBox(b, 'track:0')).toEqual({ minX: -50, minY: -50, maxX: 1050, maxY: 50 });
  });
  it('returns null for out-of-range / bad ids', () => {
    const b = board({});
    expect(boardItemBBox(b, 'track:0')).toBeNull();
    expect(boardItemBBox(b, 'nope:0')).toBeNull();
  });
});

describe('moveBoardItems', () => {
  it('moves only the selected items by the delta', () => {
    const b = board({
      tracks: [track({ x: 0, y: 0 }, { x: 100, y: 0 })],
      vias: [via({ x: 500, y: 500 })],
    });
    const moved = moveBoardItems(b, new Set(['track:0']), { x: 10, y: 20 });
    expect(moved.tracks[0]!.start).toEqual({ x: 10, y: 20 });
    expect(moved.tracks[0]!.end).toEqual({ x: 110, y: 20 });
    expect(moved.vias[0]!.at).toEqual({ x: 500, y: 500 }); // untouched
  });

  it('moves a footprint anchor and its board-absolute children together', () => {
    const b = board({ footprints: [footprint([pad({ x: 5000, y: 5000 }, 400, 400)])] });
    const moved = moveBoardItems(b, new Set(['footprint:0']), { x: 100, y: -100 });
    expect(moved.footprints[0]!.at).toEqual({ x: 100, y: -100 });
    expect(moved.footprints[0]!.pads[0]!.at).toEqual({ x: 5100, y: 4900 });
  });

  it('no-ops for an empty selection or a zero delta', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 100, y: 0 })] });
    expect(moveBoardItems(b, new Set(), { x: 10, y: 10 })).toBe(b);
    expect(moveBoardItems(b, new Set(['track:0']), { x: 0, y: 0 })).toBe(b);
  });

  it('patched sources survive a serialize round-trip at the new coordinates', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal) (2 "B.Cu" signal))
	(net 0 "") (net 1 "GND")
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
	(via (at 40 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
)
`;
    const b = readBoard(parse(TEXT));
    const moved = moveBoardItems(b, new Set(['track:0', 'via:0']), { x: mmToIU(5), y: mmToIU(0) });
    const reread = readBoard(parse(serializeBoard(moved)));
    expect(reread.tracks[0]!.start.x).toBe(mmToIU(15));
    expect(reread.tracks[0]!.end.x).toBe(mmToIU(35));
    expect(reread.vias[0]!.at.x).toBe(mmToIU(45));
    // The track kept its net/width (only coords were patched).
    expect(reread.tracks[0]!.net).toBe(1);
    expect(reread.tracks[0]!.width).toBe(mmToIU(0.25));
  });
});

describe('deleteBoardItems', () => {
  it('removes only the selected items', () => {
    const b = board({
      tracks: [track({ x: 0, y: 0 }, { x: 1, y: 0 }), track({ x: 0, y: 5 }, { x: 1, y: 5 })],
      vias: [via({ x: 9, y: 9 })],
    });
    const out = deleteBoardItems(b, new Set(['track:0', 'via:0']));
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0]!.start).toEqual({ x: 0, y: 5 }); // the surviving track
    expect(out.vias).toHaveLength(0);
  });

  it('no-ops for an empty selection', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1, y: 0 })] });
    expect(deleteBoardItems(b, new Set())).toBe(b);
  });

  it('drops the right source child when a MIDDLE item is deleted (writer)', () => {
    // Three named tracks; delete the middle one and confirm the writer emits the
    // other two (positional deletion, not "drop the last").
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal))
	(net 0 "") (net 1 "A") (net 2 "B") (net 3 "C")
	(segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 1))
	(segment (start 0 1) (end 1 1) (width 0.2) (layer "F.Cu") (net 2))
	(segment (start 0 2) (end 1 2) (width 0.2) (layer "F.Cu") (net 3))
)
`;
    const b = readBoard(parse(TEXT));
    const out = deleteBoardItems(b, new Set(['track:1'])); // the net-2 track
    const reread = readBoard(parse(serializeBoard(out)));
    expect(reread.tracks.map((t) => t.net)).toEqual([1, 3]);
  });
});

describe('rotateBoardItems', () => {
  it('rotates a track ±90° about an explicit centre', () => {
    // rotatePcb(90): (x,y) -> (y, -x). About origin: (100,0)->(0,-100).
    const b = board({ tracks: [track({ x: 100, y: 0 }, { x: 200, y: 0 }, 20)] });
    const r = rotateBoardItems(b, new Set(['track:0']), true, { x: 0, y: 0 });
    expect(r.tracks[0]!.start).toEqual({ x: 0, y: -100 });
    expect(r.tracks[0]!.end).toEqual({ x: 0, y: -200 });
  });

  it('advances a footprint angle and rotates its children', () => {
    const b = board({ footprints: [footprint([pad({ x: 100, y: 0 }, 400, 400)])] });
    const r = rotateBoardItems(b, new Set(['footprint:0']), true, { x: 0, y: 0 });
    expect(r.footprints[0]!.angle).toBe(90);
    expect(r.footprints[0]!.at).toEqual({ x: 0, y: 0 });
    expect(r.footprints[0]!.pads[0]!.at).toEqual({ x: 0, y: -100 });
  });

  it('four 90° rotations return to the original geometry', () => {
    const b = board({ tracks: [track({ x: 300, y: 100 }, { x: 500, y: 400 }, 20)] });
    let r = b;
    for (let i = 0; i < 4; i++) r = rotateBoardItems(r, new Set(['track:0']), true, { x: 0, y: 0 });
    expect(r.tracks[0]!.start).toEqual({ x: 300, y: 100 });
    expect(r.tracks[0]!.end).toEqual({ x: 500, y: 400 });
  });

  it('patched source survives a serialize round-trip', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal))
	(net 0 "") (net 1 "GND")
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
)
`;
    const b = readBoard(parse(TEXT));
    const rotated = rotateBoardItems(b, new Set(['track:0']), true, {
      x: mmToIU(20),
      y: mmToIU(10),
    });
    const reread = readBoard(parse(serializeBoard(rotated)));
    // start (10,10) about (20,10): rel (-10,0) -> (0,10) -> (20,20) mm.
    expect(reread.tracks[0]!.start).toEqual({ x: mmToIU(20), y: mmToIU(20) });
    expect(reread.tracks[0]!.net).toBe(1);
  });
});

describe('duplicateBoardItems', () => {
  it('appends offset copies and returns their ids', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 100, y: 0 })] });
    const { board: out, ids } = duplicateBoardItems(b, new Set(['track:0']), { x: 10, y: 20 });
    expect(out.tracks).toHaveLength(2);
    expect(ids).toEqual(['track:1']);
    expect(out.tracks[0]!.start).toEqual({ x: 0, y: 0 }); // original untouched
    expect(out.tracks[1]!.start).toEqual({ x: 10, y: 20 }); // copy offset
  });

  it('gives the copy a fresh uuid', () => {
    const t = track({ x: 0, y: 0 }, { x: 1, y: 0 });
    t.uuid = 'aaaa';
    const b = board({ tracks: [t] });
    const { board: out } = duplicateBoardItems(b, new Set(['track:0']), { x: 5, y: 0 });
    expect(out.tracks[1]!.uuid).toBeDefined();
    expect(out.tracks[1]!.uuid).not.toBe('aaaa');
  });

  it('the appended copy serializes (writer append pass) and re-reads', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal))
	(net 0 "") (net 1 "GND")
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
)
`;
    const b = readBoard(parse(TEXT));
    const { board: out } = duplicateBoardItems(b, new Set(['track:0']), {
      x: mmToIU(0),
      y: mmToIU(5),
    });
    const reread = readBoard(parse(serializeBoard(out)));
    expect(reread.tracks).toHaveLength(2);
    expect(reread.tracks[1]!.start).toEqual({ x: mmToIU(10), y: mmToIU(15) });
    expect(reread.tracks[1]!.net).toBe(1);
  });
});

describe('canonical builders (source-less items append + re-read)', () => {
  it('serializes a board with freshly-built (source-less) items', () => {
    const TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew")
	(layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user))
	(net 0 "") (net 1 "GND")
)
`;
    const b = readBoard(parse(TEXT));
    // Push items with EMPTY source, the writer must build them canonically.
    const withNew: Board = {
      ...b,
      tracks: [
        track({ x: mmToIU(0), y: mmToIU(0) }, { x: mmToIU(10), y: mmToIU(0) }, mmToIU(0.25)),
      ],
      vias: [via({ x: mmToIU(10), y: mmToIU(0) }, mmToIU(0.8))],
      shapes: [
        lineShape({ x: mmToIU(0), y: mmToIU(0) }, { x: mmToIU(20), y: mmToIU(0) }, mmToIU(0.15)),
      ],
      texts: [text({ x: mmToIU(5), y: mmToIU(5) }, 'HI', mmToIU(1))],
    };
    const reread = readBoard(parse(serializeBoard(withNew)));
    expect(reread.tracks).toHaveLength(1);
    expect(reread.tracks[0]!.start.x).toBe(mmToIU(0));
    expect(reread.vias).toHaveLength(1);
    expect(reread.vias[0]!.at.x).toBe(mmToIU(10));
    expect(reread.shapes).toHaveLength(1);
    expect(reread.texts).toHaveLength(1);
    expect(reread.texts[0]!.text).toBe('HI');
  });
});

describe('groups (PCB_GROUP: group / ungroup / expansion)', () => {
  const t0 = { ...track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100), uuid: 'uuid-t0' };
  const t1 = { ...track({ x: 0, y: 500 }, { x: 1000, y: 500 }, 100), uuid: 'uuid-t1' };
  it('groups two tracks, resolves member clicks to the group, expands back', () => {
    const b = board({ tracks: [t0, t1] });
    const { board: g, id } = groupBoardItems(b, new Set(['track:0', 'track:1']), 'pair');
    expect(id).toBe('group:0');
    expect(g.groups[0]!.members.sort()).toEqual(['uuid-t0', 'uuid-t1']);
    // Clicking a member selects the top-level group.
    expect(groupContaining(g, 'track:0')).toBe('group:0');
    // Editing commands act on the expansion.
    expect([...expandGroupIds(g, new Set(['group:0']))].sort()).toEqual(['track:0', 'track:1']);
  });
  it('ungroup dissolves the group and keeps the members', () => {
    const b = board({ tracks: [t0, t1] });
    const { board: g } = groupBoardItems(b, new Set(['track:0', 'track:1']));
    const u = ungroupBoardItems(g, new Set(['group:0']));
    expect(u.groups).toHaveLength(0);
    expect(u.tracks).toHaveLength(2);
  });
  it('round-trips the exact (group …) s-expression: sorted members, no empty groups', () => {
    const src = `(kicad_pcb (version 20241229) (generator x)
      (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 0) (uuid "uuid-b"))
      (segment (start 0 1) (end 1 1) (width 0.2) (layer "F.Cu") (net 0) (uuid "uuid-a"))
    )`;
    const b = readBoard(parse(src));
    const { board: g } = groupBoardItems(b, new Set(['track:0', 'track:1']), 'G1');
    const out = serializeBoard(g);
    expect(out).toContain('(group "G1"');
    // Members are written sorted alphabetically (PCB_IO_KICAD_SEXPR).
    expect(out).toMatch(/\(members\s+"uuid-a"\s+"uuid-b"\)/);
    const reread = readBoard(parse(out));
    expect(reread.groups).toHaveLength(1);
    expect(reread.groups[0]!.name).toBe('G1');
    expect(reread.groups[0]!.members).toEqual(['uuid-a', 'uuid-b']);
    // Deleting the group (with its expansion) drops the node entirely.
    const gone = deleteBoardItems(reread, new Set(['group:0', 'track:0', 'track:1']));
    expect(serializeBoard(gone)).not.toContain('(group');
  });

  const t2 = { ...track({ x: 0, y: 900 }, { x: 1000, y: 900 }, 100), uuid: 'uuid-t2' };
  it('adds an ungrouped item to the selected group', () => {
    const b = board({ tracks: [t0, t1, t2] });
    const { board: g } = groupBoardItems(b, new Set(['track:0', 'track:1']), 'pair');
    const added = addToGroupItems(g, new Set(['group:0', 'track:2']));
    expect(added.groups[0]!.members.sort()).toEqual(['uuid-t0', 'uuid-t1', 'uuid-t2']);
  });
  it('add-to-group is a no-op unless exactly one group is selected', () => {
    const b = board({ tracks: [t0, t1, t2] });
    let g = groupBoardItems(b, new Set(['track:0', 'track:1']), 'a').board;
    g = groupBoardItems(g, new Set(['track:2']), 'b').board; // group:1 (single-member, for the test)
    // Two groups selected -> AddToGroup bails (GROUP_TOOL::AddToGroup early return).
    expect(addToGroupItems(g, new Set(['group:0', 'group:1']))).toBe(g);
  });
  it('removes a member, dissolving the group once fewer than two remain', () => {
    const b = board({ tracks: [t0, t1, t2] });
    const { board: g } = groupBoardItems(b, new Set(['track:0', 'track:1', 'track:2']), 'trio');
    // Remove one of three -> two remain, group survives.
    const r1 = removeFromGroupItems(g, new Set(['track:2']));
    expect(r1.groups).toHaveLength(1);
    expect(r1.groups[0]!.members.sort()).toEqual(['uuid-t0', 'uuid-t1']);
    // Remove another -> one left (< 2) -> group dissolves, items stay.
    const r2 = removeFromGroupItems(r1, new Set(['track:1']));
    expect(r2.groups).toHaveLength(0);
    expect(r2.tracks).toHaveLength(3);
  });
  it('an entered group stops click resolution at its boundary', () => {
    const b = board({ tracks: [t0, t1] });
    const { board: g } = groupBoardItems(b, new Set(['track:0', 'track:1']), 'pair');
    const gUuid = g.groups[0]!.uuid;
    // Not entered: a member resolves to the group.
    expect(groupContaining(g, 'track:0')).toBe('group:0');
    // Entered: the member resolves to itself (null -> caller keeps the item id).
    expect(groupContaining(g, 'track:0', gUuid)).toBeNull();
  });
});

describe('lock / unlock ((locked yes) on every lockable kind)', () => {
  it('locks a track: model + serialized token; unlock removes it', () => {
    const src = `(kicad_pcb (version 20241229) (generator x)
      (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 0) (uuid "u1"))
    )`;
    const b = readBoard(parse(src));
    const locked = setBoardItemsLocked(b, new Set(['track:0']), true);
    expect(isBoardItemLocked(locked, 'track:0')).toBe(true);
    expect(serializeBoard(locked)).toContain('(locked yes)');
    const unlocked = setBoardItemsLocked(locked, new Set(['track:0']), false);
    expect(isBoardItemLocked(unlocked, 'track:0')).toBe(false);
    expect(serializeBoard(unlocked)).not.toContain('(locked');
  });
  it('reads (locked yes) from the file', () => {
    const src = `(kicad_pcb (version 20241229) (generator x)
      (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 0) (locked yes) (uuid "u1"))
    )`;
    expect(isBoardItemLocked(readBoard(parse(src)), 'track:0')).toBe(true);
  });
  it('allBoardItemIds enumerates every top-level selectable item (Select All)', () => {
    const src = `(kicad_pcb (version 20241229) (generator x)
      (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 0) (uuid "u1"))
      (segment (start 0 1) (end 1 1) (width 0.2) (layer "F.Cu") (net 0) (uuid "u2"))
      (gr_text "hi" (at 0 0) (layer "F.SilkS") (uuid "t"))
    )`;
    const b = readBoard(parse(src));
    expect(allBoardItemIds(b).sort()).toEqual(['text:0', 'track:0', 'track:1']);
  });
  it("'toggle' flips each item independently (PCB_ACTIONS::toggleLock)", () => {
    const src = `(kicad_pcb (version 20241229) (generator x)
      (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 0) (locked yes) (uuid "u1"))
      (segment (start 0 1) (end 1 1) (width 0.2) (layer "F.Cu") (net 0) (uuid "u2"))
    )`;
    const b = readBoard(parse(src));
    const t = setBoardItemsLocked(b, new Set(['track:0', 'track:1']), 'toggle');
    expect(isBoardItemLocked(t, 'track:0')).toBe(false); // was locked -> unlocked
    expect(isBoardItemLocked(t, 'track:1')).toBe(true); // was unlocked -> locked
  });
});

describe('mirror (EDIT_TOOL::Mirror)', () => {
  it('mirrorV flips y about the selection centre; x untouched', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 400 }, 100)] });
    const m = mirrorBoardItems(b, new Set(['track:0']), 'v');
    // bbox centre y = 200 → y' = 400 − y.
    expect(m.tracks[0]!.start).toEqual({ x: 0, y: 400 });
    expect(m.tracks[0]!.end).toEqual({ x: 1000, y: 0 });
  });
  it('mirrorH flips x; footprints are skipped (KiCad: use Flip)', () => {
    const fp = footprint([pad({ x: 5000, y: 5000 }, 400, 400)]);
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100)], footprints: [fp] });
    const m = mirrorBoardItems(b, new Set(['track:0', 'footprint:0']), 'h');
    expect(m.footprints[0]!.at).toEqual(fp.at); // untouched
    expect(m.tracks[0]!.start.x).not.toBe(0); // mirrored
  });
});

describe('filterSelectionForFreePads (PCB_SELECTION_TOOL::FilterCollectorForFreePads)', () => {
  it('replaces a selected pad with its parent footprint', () => {
    const sel = new Set([boardItemId('pad', 3, 1), 'track:0']);
    expect([...filterSelectionForFreePads(sel)].sort()).toEqual(['footprint:3', 'track:0']);
  });

  it('collapses several pads of one footprint to a single footprint id', () => {
    const sel = new Set([boardItemId('pad', 2, 0), boardItemId('pad', 2, 1)]);
    expect([...filterSelectionForFreePads(sel)]).toEqual(['footprint:2']);
  });

  it('leaves footprint text alone, KiCad moves those on their own', () => {
    const sel = new Set([boardItemId('fptext', 1, 0)]);
    expect([...filterSelectionForFreePads(sel)]).toEqual([boardItemId('fptext', 1, 0)]);
  });

  it('keeps the pad when free pads are allowed, unless promotion is forced', () => {
    const sel = new Set([boardItemId('pad', 0, 0)]);
    expect([...filterSelectionForFreePads(sel, { allowFreePads: true })]).toEqual([
      boardItemId('pad', 0, 0),
    ]);
    expect([
      ...filterSelectionForFreePads(sel, { allowFreePads: true, forcePromotion: true }),
    ]).toEqual(['footprint:0']);
  });

  it('moving a grabbed pad moves the whole footprint', () => {
    const fp = footprint([
      pad({ x: 5000, y: 5000 }, 400, 400),
      pad({ x: 7000, y: 5000 }, 400, 400),
    ]);
    const b = board({ footprints: [fp] });
    const delta = { x: 1000, y: -500 };

    // The raw pad id moves nothing: pads are not independently movable items.
    expect(moveBoardItems(b, new Set([boardItemId('pad', 0, 0)]), delta)).toEqual(b);

    // Filtered the way the move tool filters, the footprint and both pads move.
    const moved = moveBoardItems(
      b,
      filterSelectionForFreePads(new Set([boardItemId('pad', 0, 0)])),
      delta,
    );
    expect(moved.footprints[0]!.at).toEqual({ x: 1000, y: -500 });
    expect(moved.footprints[0]!.pads[0]!.at).toEqual({ x: 6000, y: 4500 });
    expect(moved.footprints[0]!.pads[1]!.at).toEqual({ x: 8000, y: 4500 });
  });

  it('rotating a grabbed pad rotates the whole footprint', () => {
    const fp = footprint([
      pad({ x: 0, y: 0 }, 400, 400),
      pad({ x: 2000, y: 0 }, 400, 400), // 2000 to the right of pad 1
    ]);
    const b = board({ footprints: [fp] });

    // Unfiltered, a pad id rotates nothing.
    expect(rotateBoardItems(b, new Set([boardItemId('pad', 0, 1)]), true)).toEqual(b);

    const r = rotateBoardItems(
      b,
      filterSelectionForFreePads(new Set([boardItemId('pad', 0, 1)])),
      true,
    );
    // About the pads' bbox centre (1000, 0): the pair ends up vertical.
    expect(r.footprints[0]!.pads[0]!.at.x).toBe(r.footprints[0]!.pads[1]!.at.x);
    expect(r.footprints[0]!.pads[0]!.at.y).not.toBe(r.footprints[0]!.pads[1]!.at.y);
  });
});

describe('filterSelectionForDelete (EDIT_TOOL::Remove)', () => {
  it('refuses the delete when a pad would take its footprint with it', () => {
    expect(filterSelectionForDelete(new Set([boardItemId('pad', 0, 0)]))).toBeNull();
    expect(filterSelectionForDelete(new Set([boardItemId('pad', 0, 0), 'track:1']))).toBeNull();
  });

  it('allows it when the footprint was selected anyway', () => {
    const sel = new Set(['footprint:0', boardItemId('pad', 0, 0)]);
    expect([...filterSelectionForDelete(sel)!]).toEqual(['footprint:0']);
  });

  it('passes a pad-free selection through untouched', () => {
    const sel = new Set(['track:0', 'via:2', boardItemId('fptext', 1, 0)]);
    expect([...filterSelectionForDelete(sel)!].sort()).toEqual([...sel].sort());
  });

  it('deletes nothing at all when refused', () => {
    const b = board({
      footprints: [footprint([pad({ x: 0, y: 0 }, 400, 400)])],
      tracks: [track({ x: 0, y: 0 }, { x: 1000, y: 0 })],
    });
    const items = filterSelectionForDelete(new Set([boardItemId('pad', 0, 0), 'track:0']));
    expect(items).toBeNull(); // the track is spared too, like upstream's early return
    expect(b.footprints).toHaveLength(1);
  });
});

describe('zone move (ZONE::Move)', () => {
  const poly = [
    { x: 0, y: 0 },
    { x: 10000, y: 0 },
    { x: 10000, y: 10000 },
    { x: 0, y: 10000 },
  ];
  const src = parse(`(zone (net 1) (layer "F.Cu")
      (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1) (xy 0 1)))
      (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy 1 0) (xy 1 1) (xy 0 1))))`);

  const zoned = (): Board =>
    board({
      zones: [
        {
          net: 1,
          layers: ['F.Cu'],
          outline: poly,
          fills: [{ layer: 'F.Cu', polys: [poly] }],
          source: src,
        },
      ],
    });

  it('moves the outline and the fill together', () => {
    const d = { x: 5000, y: -2500 };
    const out = moveBoardItems(zoned(), new Set(['zone:0']), d);
    expect(out.zones[0]!.outline![0]).toEqual({ x: 5000, y: -2500 });
    expect(out.zones[0]!.outline![2]).toEqual({ x: 15000, y: 7500 });
    // The pour travels with its boundary rather than being left behind.
    expect(out.zones[0]!.fills[0]!.polys[0]![0]).toEqual({ x: 5000, y: -2500 });
    expect(out.zones[0]!.fills[0]!.polys[0]![2]).toEqual({ x: 15000, y: 7500 });
  });

  it('patches both point lists in the source, so the move survives a save', () => {
    const d = { x: mmToIU(1), y: mmToIU(2) };
    const out = moveBoardItems(zoned(), new Set(['zone:0']), d);
    const text = serializeBoard({ ...out, source: out.zones[0]!.source });
    // Every (xy ...) shifted by (1, 2) mm: the outline started at 0 0 and 1 0.
    expect(text).toContain('(xy 1 2)');
    expect(text).toContain('(xy 2 2)');
    expect(text).not.toContain('(xy 0 0)');
  });

  it('leaves other zones alone', () => {
    const b = zoned();
    const two = { ...b, zones: [b.zones[0]!, { ...b.zones[0]! }] };
    const out = moveBoardItems(two, new Set(['zone:0']), { x: 1000, y: 0 });
    expect(out.zones[1]!.outline![0]).toEqual({ x: 0, y: 0 });
  });
});

describe('zone outline editing (PCB_POINT_EDITOR over a ZONE)', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10000, y: 0 },
    { x: 10000, y: 10000 },
    { x: 0, y: 10000 },
  ];
  const zoneBoard = (): Board =>
    board({
      zones: [
        {
          net: 1,
          layers: ['F.Cu'],
          outline: square,
          fills: [{ layer: 'F.Cu', polys: [square] }],
          source: parse(
            `(zone (net 1) (layer "F.Cu")
               (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1) (xy 0 1)))
               (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy 1 0) (xy 1 1) (xy 0 1))))`,
          ),
        },
      ],
    });

  it('puts a handle on every corner and every edge midpoint', () => {
    const h = zoneHandles(zoneBoard(), 0);
    expect(h.filter((x) => x.kind === 'corner')).toHaveLength(4);
    expect(h.filter((x) => x.kind === 'edge')).toHaveLength(4);
    // The first edge runs 0,0 -> 10000,0, so its handle sits halfway along it.
    expect(h.find((x) => x.kind === 'edge' && x.index === 0)!.at).toEqual({ x: 5000, y: 0 });
    // The last edge wraps back to the first corner.
    expect(h.find((x) => x.kind === 'edge' && x.index === 3)!.at).toEqual({ x: 0, y: 5000 });
  });

  it('dragging a corner moves only that vertex', () => {
    const out = moveZoneCorner(zoneBoard(), 0, 2, { x: 20000, y: 12000 });
    expect(out.zones[0]!.outline).toEqual([
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 20000, y: 12000 },
      { x: 0, y: 10000 },
    ]);
  });

  it('dragging an edge moves both of its vertices (ZONE::MoveEdge)', () => {
    const out = moveZoneEdge(zoneBoard(), 0, 0, { x: 0, y: -3000 });
    expect(out.zones[0]!.outline![0]).toEqual({ x: 0, y: -3000 });
    expect(out.zones[0]!.outline![1]).toEqual({ x: 10000, y: -3000 });
    expect(out.zones[0]!.outline![2]).toEqual({ x: 10000, y: 10000 }); // untouched
  });

  it('the wrapping edge moves the last and first vertices', () => {
    const out = moveZoneEdge(zoneBoard(), 0, 3, { x: -2000, y: 0 });
    expect(out.zones[0]!.outline![3]).toEqual({ x: -2000, y: 10000 });
    expect(out.zones[0]!.outline![0]).toEqual({ x: -2000, y: 0 });
  });

  it('unfills the zone, as UpdateItem does before touching the polygon', () => {
    const out = moveZoneCorner(zoneBoard(), 0, 0, { x: -5000, y: -5000 });
    expect(out.zones[0]!.fills).toEqual([]);
    expect(serializeBoard({ ...out, source: out.zones[0]!.source })).not.toContain(
      'filled_polygon',
    );
  });

  it('writes the new outline into the source', () => {
    const out = moveZoneCorner(zoneBoard(), 0, 0, { x: mmToIU(5), y: mmToIU(6) });
    expect(serializeBoard({ ...out, source: out.zones[0]!.source })).toContain('(xy 5 6)');
  });

  it('leaves a zone with no outline alone', () => {
    const b = zoneBoard();
    const noOutline = { ...b, zones: [{ ...b.zones[0]!, outline: undefined }] };
    expect(zoneHandles(noOutline, 0)).toEqual([]);
    expect(moveZoneCorner(noOutline, 0, 0, { x: 1, y: 1 })).toBe(noOutline);
  });
});
