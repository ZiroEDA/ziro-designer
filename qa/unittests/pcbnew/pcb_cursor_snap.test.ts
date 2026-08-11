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
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { bestSnapAnchor, snapToBoardCopper } from '@ziroeda/pcbnew/src/pcb_cursor_snap.js';
import { computeNearest, type PcbGridState } from '@ziroeda/pcbnew/src/pcb_grid_helper.js';

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
    expect(computeNearest({ x: 0, y: TRACK.y }, 0.5 * MM, { x: 0, y: 0 }).y).toBe(99.5 * MM);
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
