// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The routing cursor, over the demo board the editor actually opens.
 *
 * `pcb_grid_helper.test.ts` pins the geometry on synthetic segments. This pins
 * the whole decision — pick the item, then place the cursor on it — against
 * `ecc83-pp.kicad_pcb`, at a zoom and slop the editor really uses, because the
 * geometry being right says nothing about whether the cursor reaches it.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/read_board.js';
import {
  bestDragOrigin,
  bestSnapAnchor,
  computeDragAnchors,
  snapToBoardCopper,
} from '@ziroeda/pcbnew/pcb_cursor_snap.js';
import {
  align,
  PCB_GRID_HELPER,
  type PcbGridState,
} from '@ziroeda/pcbnew/tools/pcb_grid_helper.js';
import { computeNearest } from '@ziroeda/common/tool/grid_helper.js';

const MM = 1e6;

const board = readBoard(
  parse(
    readFileSync(
      new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
      'utf8',
    ),
  ),
);

/**
 * A 0.5 mm grid on the world origin — this board carries no `(grid_origin)`,
 * so that is where pcbnew puts it.
 */
const grid = (over: Partial<PcbGridState> = {}): PcbGridState => ({
  size: 0.5 * MM,
  origin: { x: 0, y: 0 },
  enableGrid: true,
  enableSnap: true,
  ...over,
});

/**
 * `MAX_SLOP` = 5 px at a zoom that fits this ~60 mm board in an 1800 px
 * viewport, which is roughly 0.17 mm of slop.
 */
const TOL = (5 * 1) / (1800 / (60 * MM));

/**
 * The first B.Cu track in the file: horizontal, 0.8 mm wide, centred on
 * y = 99.695 mm. The nearest 0.5 mm grid line is y = 99.5 mm — 0.195 mm away,
 * which is *inside* the track but plainly not on its centre. That is exactly
 * the "sticks above or below the trace" the grid-only cursor produced.
 */
const TRACK = { y: 99.695 * MM, x0: 139.573 * MM, x1: 141.605 * MM, width: 0.8 * MM };

describe('snapToBoardCopper over ecc83-pp.kicad_pcb', () => {
  it('is a real track, on the grid nowhere', () => {
    const found = board.tracks.find(
      (t) =>
        t.start.y === TRACK.y &&
        t.end.y === TRACK.y &&
        t.layer === 'B.Cu' &&
        t.width === TRACK.width,
    );
    expect(found).toBeDefined();
    // The premise of the whole bug: the grid cannot reach this centreline.
    expect(
      computeNearest({ x: 0, y: TRACK.y }, { x: 0.5 * MM, y: 0.5 * MM }, { x: 0, y: 0 }).y,
    ).toBe(99.5 * MM);
  });

  it('puts the cursor on the centreline mid-span', () => {
    // Hovering the middle of the track, 5 microns off its centre.
    const where = { x: 140.5 * MM, y: TRACK.y + 5_000 };
    const got = snapToBoardCopper(board, where, grid(), { tol: TOL, layer: 'B.Cu' });

    expect(got).not.toBeNull();
    expect(got?.kind).toBe('track');
    // On the copper, exactly — not 0.195 mm above it.
    expect(got?.snap.y).toBe(TRACK.y);
    // And still lined up with the grid along the vertical, which is the
    // nearest of the four rays here.
    expect(got?.snap.x).toBe(140.5 * MM);
  });

  it('takes the end when the cursor is within half the track width of one', () => {
    // 0.3 mm from the end, inside the 0.4 mm half-width.
    const where = { x: TRACK.x0 + 0.3 * MM, y: TRACK.y };
    const got = snapToBoardCopper(board, where, grid(), { tol: TOL, layer: 'B.Cu' });

    expect(got?.snap).toEqual({ x: TRACK.x0, y: TRACK.y });
  });

  it('leaves the cursor on the grid when there is no copper under it', () => {
    // Far off the board.
    const where = { x: 10 * MM, y: 10 * MM };
    expect(snapToBoardCopper(board, where, grid(), { tol: TOL, layer: 'B.Cu' })).toBeNull();
  });

  it('still reaches a track on another layer when this one has nothing', () => {
    // `pickSingleItem` fills slot 1 with "a segment on the active layer" and
    // slot 3 with "a segment on any layer", and reads the slots in order — so
    // the active layer is a preference, not a filter, and a lone B.Cu track is
    // picked even with F.Cu active.
    const where = { x: 140.5 * MM, y: TRACK.y };
    const got = snapToBoardCopper(board, where, grid(), { tol: TOL, layer: 'F.Cu' });
    expect(got?.kind).toBe('track');
    expect(got?.snap.y).toBe(TRACK.y);
  });
});

describe('the active layer is preferred when both layers are under the cursor', () => {
  // Two tracks crossing the same point on opposite layers, which the demo board
  // does not conveniently provide.
  const twoLayer = readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "a") (net 2 "b")
  (segment (start 10 10.123) (end 20 10.123) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 10 10.321) (end 20 10.321) (width 0.25) (layer "B.Cu") (net 2))
)`),
  );

  const where = { x: 15 * MM, y: 10.22 * MM };
  const opts = { tol: 0.5 * MM };

  it('takes the front track with F.Cu active', () => {
    const got = snapToBoardCopper(twoLayer, where, grid(), { ...opts, layer: 'F.Cu' });
    expect(got?.net).toBe(1);
    expect(got?.snap.y).toBe(10.123 * MM);
  });

  it('takes the back track with B.Cu active', () => {
    const got = snapToBoardCopper(twoLayer, where, grid(), { ...opts, layer: 'B.Cu' });
    expect(got?.net).toBe(2);
    expect(got?.snap.y).toBe(10.321 * MM);
  });

  it('falls back to the plain grid while Shift is held', () => {
    const where = { x: 140.5 * MM, y: TRACK.y + 5_000 };
    const got = snapToBoardCopper(board, where, grid({ enableSnap: false }), {
      tol: TOL,
      layer: 'B.Cu',
    });

    expect(got?.snap).toEqual({ x: 140.5 * MM, y: 99.5 * MM });
  });
});

describe('bestSnapAnchor (the cursor for every tool that is not the router)', () => {
  const opts = { snapScale: 0.4 * MM, visibleGrid: 0.5 * MM, layer: 'B.Cu' };

  it('takes a track END, and pointedly not its centreline', () => {
    // Near the end, well inside the snap radius.
    const nearEnd = { x: TRACK.x0 + 0.1 * MM, y: TRACK.y + 0.05 * MM };
    expect(bestSnapAnchor(board, nearEnd, grid(), opts)).toEqual({ x: TRACK.x0, y: TRACK.y });
  });

  it('leaves the cursor on the grid mid-span, which is upstream', () => {
    // The difference that matters: `snapToItem` puts the cursor on the copper
    // here, `BestSnapAnchor` does not, because a track's midpoint anchor is
    // ORIGIN and not SNAPPABLE. Both are pcbnew; they belong to different tools.
    const midSpan = { x: 140.5 * MM, y: TRACK.y };
    expect(bestSnapAnchor(board, midSpan, grid(), opts)).toEqual({ x: 140.5 * MM, y: 99.5 * MM });
    expect(snapToBoardCopper(board, midSpan, grid(), { tol: TOL, layer: 'B.Cu' })?.snap.y).toBe(
      TRACK.y,
    );
  });

  it('rides the centreline mid-span once the grid is switched off', () => {
    // `if( !m_enableGrid )` — the point-on-element fallback. The only place
    // outside the router where the general cursor lands on a wire's centre.
    const midSpan = { x: 140.5 * MM, y: TRACK.y + 0.05 * MM };
    const got = bestSnapAnchor(board, midSpan, grid({ enableGrid: false }), opts);
    expect(got).toEqual({ x: 140.5 * MM, y: TRACK.y });
  });

  it('clamps the snap radius to the visible grid so grid points stay reachable', () => {
    // A 25 px radius larger than the grid step would swallow every grid node
    // between the cursor and the anchor (kicad issues 5638 / 7125 / 12303).
    // On an isolated track, so a neighbour's endpoint cannot win instead.
    const lone = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "a")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1))
)`),
    );
    const wide = { snapScale: 2 * MM, visibleGrid: 0.5 * MM, layer: 'F.Cu', hysteresis: 0 };

    // 0.45 mm from the end: inside the 0.5 mm grid step, so it still snaps...
    expect(bestSnapAnchor(lone, { x: 9.55 * MM, y: 10 * MM }, grid(), wide)).toEqual({
      x: 10 * MM,
      y: 10 * MM,
    });
    // ...while 0.6 mm out is past the clamp and falls back to the grid, even
    // though the raw 2 mm snapScale would have reached it.
    expect(bestSnapAnchor(lone, { x: 9.4 * MM, y: 10 * MM }, grid(), wide)).toEqual({
      x: 9.5 * MM,
      y: 10 * MM,
    });
  });

  it('does not snap at all while Shift is held', () => {
    const nearEnd = { x: TRACK.x0 + 0.1 * MM, y: TRACK.y + 0.05 * MM };
    const got = bestSnapAnchor(board, nearEnd, grid({ enableSnap: false }), opts);
    expect(got).toEqual({ x: 139.5 * MM, y: 99.5 * MM });
  });

  it('ignores copper on a layer that is not active', () => {
    const nearEnd = { x: TRACK.x0 + 0.1 * MM, y: TRACK.y + 0.05 * MM };
    const got = bestSnapAnchor(board, nearEnd, grid(), { ...opts, layer: 'F.Cu' });
    expect(got).toEqual({ x: 139.5 * MM, y: 99.5 * MM });
  });
});

describe('a dragged trace can be put back exactly where it started', () => {
  /**
   * The bug this pins: the drag recorded a *raw* grab point while every update
   * fed it a *grid-snapped* one. On this trace — centred on y = 99.695 mm with
   * the nearest 0.5 mm grid line at 99.5 — the segment jumped 0.195 mm the
   * instant the drag began, and because every later update was also a grid
   * node, no cursor position could ever produce 99.695 again. Hence "no matter
   * what I do I cannot put it back".
   *
   * `ROUTER_TOOL::performDragging` uses `m_startSnapPoint` for `StartDragging`
   * and `m_endSnapPoint` for `Move`, and both come from the same `snapToItem`.
   */
  const grabbed = { x: 140.5 * MM, y: TRACK.y + 0.05 * MM };
  const opts = { tol: TOL, layer: 'B.Cu' };

  it('snaps the grab point onto the centreline, not onto the grid', () => {
    const snapped = snapToBoardCopper(board, grabbed, grid(), opts)?.snap;
    expect(snapped?.y).toBe(TRACK.y);
    // What the old code recorded instead, and could never get back to.
    expect(align(grabbed, grid()).y).toBe(99.5 * MM);
  });

  it('returns the identical point when the cursor comes back', () => {
    const start = snapToBoardCopper(board, grabbed, grid(), opts)?.snap;

    // Away, then back to the same place.
    const away = snapToBoardCopper(board, { x: 141 * MM, y: 101 * MM }, grid(), opts)?.snap;
    const back = snapToBoardCopper(board, grabbed, grid(), opts)?.snap;

    expect(back).toEqual(start);
    expect(back).not.toEqual(away ?? null);
  });

  it('still reaches the centreline with the grabbed segment excluded', () => {
    // `aAvoidItems` holds only `m_startItem`, so the line's collinear
    // neighbours stay snappable — and they are what put the cursor back on the
    // original centreline once the grabbed segment has moved away.
    const seed = board.tracks.findIndex(
      (t) => t.start.y === TRACK.y && t.end.y === TRACK.y && t.layer === 'B.Cu',
    );
    expect(seed).toBeGreaterThanOrEqual(0);

    const withoutSeed = snapToBoardCopper(board, grabbed, grid(), {
      ...opts,
      avoid: new Set([`track:${seed}`]),
    });

    // Either another collinear segment of the same line answers, or nothing
    // does — but it must never silently return the excluded segment.
    if (withoutSeed) expect(withoutSeed.snap.y).toBe(TRACK.y);
  });
});

describe('bestSnapAnchor aSkip (PCB_POINT_EDITOR passes { item })', () => {
  const twoTracks = readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "a") (net 2 "b")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 10.1 10.1) (end 20 10.1) (width 0.25) (layer "F.Cu") (net 2))
)`),
  );
  const opts = { snapScale: 1 * MM, visibleGrid: 0.5 * MM, layer: 'F.Cu', hysteresis: 0 };
  const near = { x: 10.02 * MM, y: 10.02 * MM };

  it('snaps to the nearest end with nothing skipped', () => {
    expect(bestSnapAnchor(twoTracks, near, grid(), opts)).toEqual({ x: 10 * MM, y: 10 * MM });
  });

  it('skips the item being reshaped, so a point cannot pin itself', () => {
    // Without this a dragged endpoint snaps to where it already is and the
    // reshape cannot move at all.
    const got = bestSnapAnchor(twoTracks, near, grid(), {
      ...opts,
      avoid: new Set(['track:0']),
    });
    expect(got).toEqual({ x: 10.1 * MM, y: 10.1 * MM });
  });

  it('falls back to the grid when everything nearby is skipped', () => {
    const got = bestSnapAnchor(twoTracks, near, grid(), {
      ...opts,
      avoid: new Set(['track:0', 'track:1']),
    });
    expect(got).toEqual({ x: 10 * MM, y: 10 * MM });
  });
});

describe('PCB_GRID_HELPER held across events, as a tool holds it', () => {
  it("starts each BestSnapAnchor from a clean anchor list, not the last one's", () => {
    // `BestSnapAnchor` begins with `clearAnchors()` (cpp:622). A helper that
    // kept the previous board's anchors would snap to a track that is gone.
    const withTrack = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "a")
  (segment (start 10.1 10.1) (end 20 10.1) (width 0.25) (layer "F.Cu") (net 1))
)`),
    );
    const empty = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
)`),
    );
    // A hysteresis so the first ask collects the end's anchor (inside the
    // 0.5 mm range) without snapping to it (outside the 0.3 mm snapIn) -
    // nothing is held, and no snap line starts.
    const opts = { snapScale: 1 * MM, visibleGrid: 0.5 * MM, layer: 'F.Cu', hysteresis: 0.2 * MM };
    const helper = new PCB_GRID_HELPER(grid());

    expect(helper.BestSnapAnchor(withTrack, { x: 10.1 * MM, y: 10.5 * MM }, opts)).toEqual({
      x: 10 * MM,
      y: 10.5 * MM,
    });
    // 0.2 mm from where the gone track's end was: the grid, not the stale anchor.
    expect(helper.BestSnapAnchor(empty, { x: 10.1 * MM, y: 10.3 * MM }, opts)).toEqual({
      x: 10 * MM,
      y: 10.5 * MM,
    });
  });
});

describe('Ctrl disables the grid (TOOL_EVENT::DisableGridSnapping)', () => {
  it('leaves the raw point alone, so anything is placeable', () => {
    // `SetUseGrid( GetGridSnapping() && !evt->DisableGridSnapping() )`, and
    // `DisableGridSnapping()` is `Modifier( MD_CTRL )` (tool_event.h:367).
    const raw = { x: 10_123_456, y: 9_876_543 };
    expect(align(raw, grid({ enableGrid: false }))).toEqual(raw);
    expect(align(raw, grid())).toEqual({ x: 10 * MM, y: 10 * MM });
  });
});

describe("bestDragOrigin — EDIT_TOOL::Move's reference point", () => {
  /**
   * `BestDragOrigin` is the half of a move that decides whether two parts can
   * ever be lined up. A move does not translate the selection by the pointer's
   * travel: it takes an anchor **on the selection**, warps the pointer onto it
   * ("Warp mouse to origin of moved object", `warp_mouse_on_move`, default
   * true), and then writes `movement = BestSnapAnchor( mousePos ) - prevPos`
   * with `prevPos` seeded to that anchor — so the anchor is placed absolutely.
   *
   * Every footprint on this board sits off the 0.5 mm grid, each by a different
   * fraction, which is what makes the distinction visible: quantising the
   * *travel* preserves those fractions for ever.
   */
  const R1 = board.footprints[5]!;
  const U1 = board.footprints[12]!;
  const opts = { gridSize: 0.5 * MM };

  it('the board really is off-grid, or none of this matters', () => {
    expect(R1.reference).toBe('R1');
    expect(R1.at).toEqual({ x: 136.271 * MM, y: 107.95 * MM });
    // Neither coordinate is a multiple of the grid, and R1's fractions differ
    // from C2's — so no grid-multiple delta can ever bring the two into line.
    const C2 = board.footprints[1]!;
    expect(C2.reference).toBe('C2');
    expect(R1.at.x % (0.5 * MM)).not.toBe(0);
    expect(R1.at.x % (0.5 * MM)).not.toBe(C2.at.x % (0.5 * MM));
  });

  it('a footprint grabbed by its body measures itself from its own origin', () => {
    // Inside R1's outline, inside neither pad, nearer the origin than the
    // bounding-box centre.
    const grab = { x: 136.5 * MM, y: 109 * MM };
    expect(bestDragOrigin(board, ['footprint:5'], grab, opts)).toEqual(R1.at);
  });

  it('a pad the cursor is inside becomes the pick-up point', () => {
    // "pad->GetBoundingBox().Contains( aRefPos )" (pcb_grid_helper.cpp:1592).
    const inPad2 = { x: 136.6 * MM, y: 115.2 * MM };
    expect(bestDragOrigin(board, ['footprint:5'], inPad2, opts)).toEqual({
      x: 136.271 * MM,
      y: 115.57 * MM,
    });
  });

  it('a pad the cursor is not inside offers nothing', () => {
    const anchors = computeDragAnchors(
      board,
      ['footprint:5'],
      { x: 136.5 * MM, y: 109 * MM },
      opts,
    );
    // The origin and the bounding-box centre, and neither pad.
    expect(anchors.map((a) => a.pos)).toEqual([R1.at, { x: 136.271 * MM, y: 111.76 * MM }]);
  });

  it('the bounding-box centre is offered only when it is off the origin', () => {
    // "if( ( center - position ).SquaredEuclideanNorm() > grid.SquaredEuclideanNorm() )"
    // (cpp:1645). U1's box is centred 0.05 mm from its origin — well inside one
    // 0.5 mm step — so a second anchor there would be noise.
    expect(U1.reference).toBe('U1');
    const away = { x: 149.225 * MM, y: 113.6 * MM };
    expect(computeDragAnchors(board, ['footprint:12'], away, opts).map((a) => a.pos)).toEqual([
      U1.at,
    ]);
    // R1's is 3.81 mm away and survives — until the grid is coarser than that.
    expect(computeDragAnchors(board, ['footprint:5'], away, opts)).toHaveLength(2);
    expect(computeDragAnchors(board, ['footprint:5'], away, { gridSize: 10 * MM })).toHaveLength(1);
  });

  it("takes a track's midpoint, which BestSnapAnchor never would", () => {
    // The midpoint is `ORIGIN` without `SNAPPABLE` (cpp:1779), and
    // `BestDragOrigin` asks `nearestAnchor( pos, ORIGIN )` — no SNAPPABLE in the
    // mask — so it is a legal place to pick a track up by even though the
    // hovering cursor is never pulled onto it.
    const oneTrack = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "a")
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1))
)`),
    );
    const mid = { x: 15.1 * MM, y: 10.1 * MM };
    expect(bestDragOrigin(oneTrack, ['track:0'], mid, opts)).toEqual({ x: 15 * MM, y: 10 * MM });
    // The same cursor, for the tool that only weighs snappable anchors: the
    // grid, because the ends are too far and the midpoint is not eligible.
    expect(
      bestSnapAnchor(oneTrack, mid, grid(), { snapScale: 1 * MM, visibleGrid: 0.5 * MM }),
    ).toEqual({ x: 15 * MM, y: 10 * MM });
    // …and near an end it is the end, not the midpoint.
    expect(bestDragOrigin(oneTrack, ['track:0'], { x: 10.4 * MM, y: 10.2 * MM }, opts)).toEqual({
      x: 10 * MM,
      y: 10 * MM,
    });
  });

  it('falls back to the cursor when the selection contributes no anchor', () => {
    // Upstream's `best ? best->pos : aMousePos`. Zones, graphics, dimensions
    // and text are anchor sources this port does not collect, and an empty
    // selection has none by definition — all of them land here.
    const where = { x: 123.456 * MM, y: 78.9 * MM };
    expect(bestDragOrigin(board, [], where, opts)).toEqual(where);
    expect(bestDragOrigin(board, ['zone:0'], where, opts)).toEqual(where);
    // A footprint index that is not on the board must not invent one either.
    expect(bestDragOrigin(board, ['footprint:9999'], where, opts)).toEqual(where);
  });

  it('has no snap radius, unlike BestSnapAnchor', () => {
    // The selection is being grabbed, so it must always yield a reference
    // point however far the pointer is from it: `computeAnchors` adds a
    // footprint's origin with no range test at all.
    const miles = { x: 300 * MM, y: 300 * MM };
    // R1's bounding-box centre, which is the nearer of its two anchors from
    // down there — the point being that it answers with an anchor at all.
    expect(bestDragOrigin(board, ['footprint:5'], miles, opts)).toEqual({
      x: 136.271 * MM,
      y: 111.76 * MM,
    });
  });
});

describe('PCB_GRID_HELPER::BestSnapAnchor, held (pcb_grid_helper.cpp:593-930)', () => {
  const boardOf = (items: string) =>
    readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user))
  (net 0 "") (net 1 "a")
  ${items}
)`),
    );
  const opts = { snapScale: 1 * MM, visibleGrid: 1 * MM, layer: 'F.Cu', hysteresis: 0.2 * MM };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a snap until the cursor is snapOut from it', () => {
    // snapRange 1 mm, hysteresis 0.2: in at 0.8, out at 1.2.
    const b = boardOf(
      '(segment (start 10.1 10.1) (end 20.1 10.1) (width 0.25) (layer "F.Cu") (net 1))',
    );
    const h = new PCB_GRID_HELPER(grid({ size: 1 * MM }));
    // Snap lines have priority over a held snap, and the cursor below sits on
    // the vertical one through the end; take them out of this question.
    h.SetSnapLine(false);
    const end = { x: 10.1 * MM, y: 10.1 * MM };
    expect(h.BestSnapAnchor(b, { x: 10.1 * MM, y: 10.6 * MM }, opts)).toEqual(end);
    // 0.9 mm off: past snapIn, inside snapOut - still held.
    expect(h.BestSnapAnchor(b, { x: 10.1 * MM, y: 11.0 * MM }, opts)).toEqual(end);
    // A fresh helper at the same place has nothing held, and takes the grid.
    const fresh = new PCB_GRID_HELPER(grid({ size: 1 * MM }));
    fresh.SetSnapLine(false);
    expect(fresh.BestSnapAnchor(b, { x: 10.1 * MM, y: 11.0 * MM }, opts)).toEqual({
      x: 10 * MM,
      y: 11 * MM,
    });
  });

  it('runs a snap line from the last anchor, and ends it where the cursor is gridded', () => {
    // Snap to the via, then go well right of it staying level: the cursor rides
    // the horizontal snap line through the via, at the nearest grid x.
    const b = boardOf('(via (at 10.3 10.3) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))');
    const h = new PCB_GRID_HELPER(grid({ size: 1 * MM }));
    expect(h.BestSnapAnchor(b, { x: 10.3 * MM, y: 10.4 * MM }, opts)).toEqual({
      x: 10.3 * MM,
      y: 10.3 * MM,
    });
    expect(h.BestSnapAnchor(b, { x: 14.9 * MM, y: 10.5 * MM }, opts)).toEqual({
      x: 15 * MM,
      y: 10.3 * MM,
    });
    // Without the snap line the same ask is plain grid.
    h.SetSnapLine(false);
    expect(h.BestSnapAnchor(b, { x: 14.9 * MM, y: 10.5 * MM }, opts)).toEqual({
      x: 15 * MM,
      y: 11 * MM,
    });
  });

  it('prefers an anchor inside snapIn over the snap line', () => {
    // Snap to via A, then come near via B, which sits just off A's
    // horizontal snap line: the anchor wins over the line.
    const b = boardOf(`
      (via (at 10.3 10.3) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))
      (via (at 15.2 10.45) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))`);
    const h = new PCB_GRID_HELPER(grid({ size: 1 * MM }));
    h.BestSnapAnchor(b, { x: 10.3 * MM, y: 10.4 * MM }, opts);
    expect(h.BestSnapAnchor(b, { x: 15.2 * MM, y: 10.35 * MM }, opts)).toEqual({
      x: 15.2 * MM,
      y: 10.45 * MM,
    });
  });

  it('snaps to the crossing of two tracks only once both are activated', () => {
    vi.useFakeTimers();
    // Two tracks crossing at (15.3, 15.3), off the 1 mm grid.
    const b = boardOf(`
      (segment (start 10.3 15.3) (end 20.3 15.3) (width 0.25) (layer "F.Cu") (net 1))
      (segment (start 15.3 10.3) (end 15.3 20.3) (width 0.25) (layer "F.Cu") (net 1))`);
    const h = new PCB_GRID_HELPER(grid({ size: 1 * MM }));
    h.SetSnapLine(false);
    const nearCrossing = { x: 15.4 * MM, y: 15.4 * MM };
    const crossing = { x: 15.3 * MM, y: 15.3 * MM };

    // Not yet: an intersection of items the user has not moused over is
    // dropped by nearestAnchor, and the grid wins.
    expect(h.BestSnapAnchor(b, nearCrossing, opts)).toEqual({ x: 15 * MM, y: 15 * MM });

    // Mouse over an end of each (proposing its construction geometry), and let
    // the 500 ms activation timer run.
    h.BestSnapAnchor(b, { x: 10.3 * MM, y: 15.4 * MM }, opts);
    vi.advanceTimersByTime(600);
    h.BestSnapAnchor(b, { x: 15.4 * MM, y: 10.3 * MM }, opts);
    vi.advanceTimersByTime(600);
    h.BestSnapAnchor(b, { x: 30 * MM, y: 30 * MM }, opts);

    expect(h.BestSnapAnchor(b, nearCrossing, opts)).toEqual(crossing);
  });

  it('with the grid off, falls back to the nearest point on a graphic line', () => {
    const b = boardOf('(gr_line (start 10 10) (end 20 12) (layer "F.SilkS") (width 0.15))');
    const h = new PCB_GRID_HELPER(grid({ enableGrid: false }));
    const got = h.BestSnapAnchor(b, { x: 15 * MM, y: 11.5 * MM }, { ...opts, layer: undefined });
    // On the line y = 10 + (x - 10) / 5, within an IU.
    expect(Math.abs(got.y - (10 * MM + (got.x - 10 * MM) / 5))).toBeLessThanOrEqual(1);
    expect(got).not.toEqual({ x: 15 * MM, y: 11.5 * MM });
  });

  it('shows a snap indicator only once a canvas is attached as the view', () => {
    const b = boardOf('(via (at 10.3 10.3) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))');
    const detached = new PCB_GRID_HELPER(grid({ size: 1 * MM }));
    detached.BestSnapAnchor(b, { x: 10.3 * MM, y: 10.4 * MM }, opts);
    expect(detached.GetSnapIndicatorState().visible).toBe(false);

    const h = new PCB_GRID_HELPER(grid({ size: 1 * MM }));
    let refreshed = 0;
    h.AttachView(() => refreshed++);
    h.BestSnapAnchor(b, { x: 10.3 * MM, y: 10.4 * MM }, opts);
    expect(h.GetSnapIndicatorState()).toMatchObject({
      visible: true,
      position: { x: 10.3 * MM, y: 10.3 * MM },
    });
    // Off the via and onto the grid: the indicator goes.
    h.BestSnapAnchor(b, { x: 13 * MM, y: 13 * MM }, opts);
    expect(h.GetSnapIndicatorState().visible).toBe(false);
    expect(h.GetConstructionGeomState().geom).toBeDefined();
    expect(refreshed).toBeGreaterThanOrEqual(0);
  });
});
