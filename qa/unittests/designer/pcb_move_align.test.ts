// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two parts dragged with the mouse end up lined up with each other.
 *
 * The report was "I cannot align two components properly, in KiCad it happens
 * automatically", and the cause was one line of arithmetic. A move was
 *
 *     delta = snapToGrid( cursor ) - snapToGrid( grabPoint )
 *
 * which is a *grid multiple* — so every part kept the fraction of a grid step
 * it was already off by, for ever, no matter how it was dragged. Every
 * footprint in `ecc83-pp.kicad_pcb` is off the 0.5 mm grid, each by a different
 * fraction, and KiCad put them there: the offsets are real, not our bug.
 *
 * `EDIT_TOOL::Move` places an **anchor**, absolutely
 * (edit_tool_move_fct.cpp:1144-1177 with :1311-1351):
 *
 *     m_cursor = grid.BestDragOrigin( originalMousePos, sel_items, … );  // the anchor
 *     grid.SetAuxAxes( true, dragOrigin );
 *     …                                                                  // pointer warped onto it
 *     m_cursor = grid.BestSnapAnchor( mousePos, layers, selectionGrid, sel_items );
 *     movement = m_cursor - prevPos;
 *
 * so `anchor + Σmovement = BestSnapAnchor( mousePos )`. That is the whole of
 * "it aligns itself": each part's own origin lands on a grid node.
 *
 * This exercises the three ported pieces the editor wires together —
 * `bestDragOrigin`, `moveDelta` and `bestSnapAnchor`/`align` — rather than
 * `PcbEditor.tsx`, which qa's tsc cannot compile.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { bestDragOrigin, bestSnapAnchor } from '@ziroeda/pcbnew/src/pcb_cursor_snap.js';
import { align, type PcbGridState } from '@ziroeda/pcbnew/src/pcb_grid_helper.js';
import { moveDelta, snapToGridSize } from '@ziroeda/designer/src/editors/pcb/pcb_grid.js';

const MM = 1e6;
const GRID = 0.5 * MM;

const board = readBoard(
  parse(
    readFileSync(
      new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
      'utf8',
    ),
  ),
);

/** R1 and C2, two through-hole parts KiCad placed off the grid by different fractions. */
const R1 = board.footprints[5]!;
const C2 = board.footprints[1]!;

/** `PcbEditor.gridState()`, with the gesture's auxiliary axis. */
const grid = (auxAxis: { x: number; y: number } | null = null): PcbGridState => ({
  size: GRID,
  origin: { x: 0, y: 0 },
  enableGrid: true,
  enableSnap: true,
  auxAxis,
});

/**
 * `PcbEditor.moveSnap()` — `BestSnapAnchor` at a zoom that fits this board, with
 * the moving item skipped the way upstream passes `sel_items` as `aSkip`.
 */
const moveSnap =
  (moving: string, aux: { x: number; y: number } | null) =>
  (p: { x: number; y: number }): { x: number; y: number } =>
    bestSnapAnchor(board, p, grid(aux), {
      snapScale: 25 / (1800 / (60 * MM)),
      hysteresis: 5 / (1800 / (60 * MM)),
      visibleGrid: GRID,
      avoid: new Set([moving]),
    });

/** One whole gesture: grab at `grab`, release with the pointer at `release`. */
const drag = (
  id: string,
  grab: { x: number; y: number },
  release: { x: number; y: number },
): { anchor: { x: number; y: number }; delta: { x: number; y: number } } => {
  const anchor = bestDragOrigin(board, [id], grab, { gridSize: GRID });
  return { anchor, delta: moveDelta(anchor, grab, release, moveSnap(id, anchor)) };
};

describe('the premise: KiCad itself placed these parts off the grid', () => {
  it('neither part sits on a 0.5 mm node, and they differ', () => {
    expect([R1.reference, C2.reference]).toEqual(['R1', 'C2']);
    expect(R1.at).toEqual({ x: 136.271 * MM, y: 107.95 * MM });
    expect(C2.at).toEqual({ x: 137.16 * MM, y: 125.095 * MM });
    expect(R1.at.x % GRID).not.toBe(0);
    expect(C2.at.x % GRID).not.toBe(0);
    expect(R1.at.x % GRID).not.toBe(C2.at.x % GRID);
  });

  it('a delta-based move can never bring them into line', () => {
    // The old rule, stated as the invariant that makes it hopeless: whatever
    // the grab and release points, `snapToGrid(b) - snapToGrid(a)` is a
    // multiple of the grid, so `at % grid` is preserved exactly.
    for (const [gx, gy, rx, ry] of [
      [136.4, 108.2, 137.3, 125.4],
      [136.271, 107.95, 140, 140],
      [130.123_45, 99.876_54, 171.999, 88.001],
    ] as const) {
      const oldDelta = {
        x:
          snapToGridSize({ x: rx * MM, y: ry * MM }, GRID, { x: 0, y: 0 }).x -
          snapToGridSize({ x: gx * MM, y: gy * MM }, GRID, { x: 0, y: 0 }).x,
        y:
          snapToGridSize({ x: rx * MM, y: ry * MM }, GRID, { x: 0, y: 0 }).y -
          snapToGridSize({ x: gx * MM, y: gy * MM }, GRID, { x: 0, y: 0 }).y,
      };
      expect((R1.at.x + oldDelta.x) % GRID).toBe(R1.at.x % GRID);
      expect((C2.at.y + oldDelta.y) % GRID).toBe(C2.at.y % GRID);
    }
  });
});

describe('a mouse drag puts the part on the grid', () => {
  it('lands R1 on a grid node however it was grabbed', () => {
    // Grabbed by the body, well away from the origin, and dropped somewhere
    // arbitrary: the *anchor* is what gets placed, so it lands on a node.
    const { anchor, delta } = drag(
      'footprint:5',
      { x: 136.5 * MM, y: 109 * MM },
      { x: 150.31 * MM, y: 118.79 * MM },
    );
    expect(anchor).toEqual(R1.at);
    const landed = { x: R1.at.x + delta.x, y: R1.at.y + delta.y };
    expect(landed.x % GRID).toBe(0);
    expect(landed.y % GRID).toBe(0);
    // And it is the anchor's own travel, not the pointer's, that was quantised.
    expect(delta.x % GRID).not.toBe(0);
  });

  it('leaves two differently-offset parts a whole number of grid steps apart', () => {
    // The user's gesture: drag one part, then the other. Alignment is possible
    // exactly when the two landings differ by a multiple of the grid — then one
    // more nudge brings them flush. Their sub-grid offsets differ by 0.111 mm
    // in x and 0.145 mm in y, so under the old rule that difference was carried
    // through every gesture and the last fraction of a step could never be
    // closed however carefully they were dragged.
    const a = drag('footprint:5', { x: 136.5 * MM, y: 109 * MM }, { x: 150.2 * MM, y: 118.8 * MM });
    // C2 grabbed by its pad 1, a different offset from its anchor than R1's.
    const b = drag(
      'footprint:1',
      { x: 137.4 * MM, y: 125.3 * MM },
      { x: 150.4 * MM, y: 122.1 * MM },
    );
    expect(a.anchor).toEqual(R1.at);
    expect(b.anchor).toEqual(C2.at);

    const landedA = { x: R1.at.x + a.delta.x, y: R1.at.y + a.delta.y };
    const landedB = { x: C2.at.x + b.delta.x, y: C2.at.y + b.delta.y };
    expect(Math.abs((landedA.x - landedB.x) % GRID)).toBe(0);
    expect(Math.abs((landedA.y - landedB.y) % GRID)).toBe(0);

    // The old rule, on the same two gestures: the skew the two parts started
    // with, carried through untouched. 0.389 mm in x and 0.145 mm in y of
    // irreducible offset, which is what "I cannot line them up" looked like.
    const oldLanded = (
      at: { x: number; y: number },
      g: { x: number; y: number },
      r: { x: number; y: number },
    ) => ({
      x:
        at.x +
        (snapToGridSize(r, GRID, { x: 0, y: 0 }).x - snapToGridSize(g, GRID, { x: 0, y: 0 }).x),
      y:
        at.y +
        (snapToGridSize(r, GRID, { x: 0, y: 0 }).y - snapToGridSize(g, GRID, { x: 0, y: 0 }).y),
    });
    const oldA = oldLanded(R1.at, { x: 136.5 * MM, y: 109 * MM }, { x: 150.2 * MM, y: 118.8 * MM });
    const oldB = oldLanded(
      C2.at,
      { x: 137.4 * MM, y: 125.3 * MM },
      { x: 150.4 * MM, y: 122.1 * MM },
    );
    expect(Math.abs((oldA.x - oldB.x) % GRID)).toBe(Math.abs((R1.at.x - C2.at.x) % GRID));
    expect(Math.abs((oldA.y - oldB.y) % GRID)).toBe(Math.abs((R1.at.y - C2.at.y) % GRID));
    expect(Math.abs((oldA.x - oldB.x) % GRID)).toBe(0.389 * MM);
    expect(Math.abs((oldA.y - oldB.y) % GRID)).toBe(0.145 * MM);
  });

  it('a part put back where it came from goes back exactly', () => {
    // `grid.SetAuxAxes( true, dragOrigin )` (edit_tool_move_fct.cpp:1335): the
    // gesture's own origin stays reachable however far off-grid it is, so
    // changing your mind costs nothing. Without the axis the part would snap to
    // the nearest node the instant the pointer twitched and 136.271 would be
    // unreachable for the rest of the session.
    const grab = { x: 136.5 * MM, y: 109 * MM };
    const { anchor, delta } = drag('footprint:5', grab, grab);
    expect(anchor).toEqual(R1.at);
    expect(delta).toEqual({ x: 0, y: 0 });

    // A pointer nudge of a tenth of a grid step is still the aux axis, and a
    // full step away is the next node — that is `Align`'s per-coordinate test.
    const near = drag('footprint:5', grab, { x: grab.x + 0.05 * MM, y: grab.y });
    expect(near.delta).toEqual({ x: 0, y: 0 });
    const far = drag('footprint:5', grab, { x: grab.x + 0.4 * MM, y: grab.y });
    expect(far.delta.x).not.toBe(0);
  });

  it('snaps the anchor onto another part rather than the grid when it is nearer', () => {
    // `BestSnapAnchor` weighs the board's own anchors first — this is how a
    // pad is landed exactly on another pad. C2's pad 1 is at (137.16, 125.095);
    // aim R1's origin a few microns off it.
    const grab = { x: 136.5 * MM, y: 109 * MM };
    const release = { x: grab.x + (137.16 * MM - R1.at.x), y: grab.y + (125.1 * MM - R1.at.y) };
    const { delta } = drag('footprint:5', grab, release);
    expect({ x: R1.at.x + delta.x, y: R1.at.y + delta.y }).toEqual({
      x: 137.16 * MM,
      y: 125.095 * MM,
    });
  });

  it('Ctrl (grid off) places the anchor exactly where the pointer put it', () => {
    // `SetUseGrid( … && !evt->DisableGridSnapping() )`: with no grid and no
    // anchor in range, `align` returns the raw point, so the part goes where it
    // is put — off-grid on purpose rather than by accident.
    const grab = { x: 136.5 * MM, y: 109 * MM };
    const anchor = bestDragOrigin(board, ['footprint:5'], grab, { gridSize: GRID });
    const free = moveDelta(anchor, grab, { x: 136.5 * MM + 1234, y: 109 * MM - 4321 }, (p) =>
      align(p, { ...grid(anchor), enableGrid: false }),
    );
    expect(free).toEqual({ x: 1234, y: -4321 });
  });
});

describe('the editor wires it up', () => {
  /**
   * `PcbEditor.tsx` as text: qa's tsc has no `--jsx`, so the move's call site
   * cannot be imported. Everything above is arithmetic that the editor has to
   * actually use — a correct `moveDelta` that nothing calls fixes nothing, and
   * the old formula would keep every test in this file passing.
   */
  const text = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
    'utf8',
  );

  it('measures the move from the drag origin, not the grab point', () => {
    expect(text).toContain(
      'const dragOrigin = bestDragOrigin(brd, sel, origin, { gridSize: gridIURef.current });',
    );
    expect(text).toContain('const delta = moveDelta(anchor, origin, cur, moveSnap);');
    // `SetAuxAxes( true, dragOrigin )` — the anchor, not its grid round.
    expect(text).toContain('auxAxisRef.current = dragOrigin;');
  });

  it('no longer takes the difference of two grid rounds', () => {
    // The line this replaced, and the reason the parts could never be aligned.
    expect(text).not.toContain('const from = snapToGrid(origin);');
    expect(text).not.toContain('auxAxisRef.current = snapToGrid(origin);');
  });

  it('skips the moving items when it snaps, as `sel_items` does', () => {
    expect(text).toContain('avoid: dragAffectedRef.current,');
  });
});
