import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { routeHeadless } from '@ziroeda/pcbnew/router/route_headless.js';
import { describe, expect, it } from 'vitest';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const MM = 1e6;
const W = 0.25 * MM;

/** Two SMD pads on one net, 10 mm apart; R2's pad on `r2Layer`. */
const twoPads = (r2Layer = 'F.Cu', r1Layer = 'F.Cu'): BOARD =>
  ParseBoard(
    `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "N1")
  (footprint "R1" (layer "${r1Layer}") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "${r1Layer}") (net 1 "N1")))
  (footprint "R2" (layer "${r2Layer}") (at 110 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "${r2Layer}") (net 1 "N1")))
)`,
  );

const R1 = { x: 100 * MM, y: 100 * MM };
const R2 = { x: 110 * MM, y: 100 * MM };
/** Inside R2's 1 mm pad, on one of `layers`: what the editor checks on the live pad. */
const onPad =
  (at: { x: number; y: number }, ...layers: string[]) =>
  (e: { x: number; y: number; layer: string }) =>
    layers.includes(e.layer) &&
    Math.abs(e.x - at.x) <= 0.5 * MM &&
    Math.abs(e.y - at.y) <= 0.5 * MM;
const onR1 = (...layers: string[]) => onPad(R1, ...layers);
const onR2 = (...layers: string[]) => onPad(R2, ...layers);

describe('routing without the mouse', () => {
  it('routes pad to pad, and with a commit host the board carries the track', () => {
    const board = twoPads();
    const frame = new TEST_PCB_FRAME(board);
    const r = routeHeadless(
      board,
      R1,
      R2,
      'F.Cu',
      { trackWidth: W, commitHost: frame },
      2,
      onR1('F.Cu'),
      onR2('F.Cu'),
    );
    expect(r).toMatchObject({ ok: true, reason: '' });
    expect(r.ends.every((e) => e.layer === 'F.Cu')).toBe(true);
    expect(r.ends.some(onR2('F.Cu'))).toBe(true);
    expect(board.Tracks().length).toBeGreaterThan(0);
  });

  it('without a commit host leaves the board as it was', () => {
    const board = twoPads();
    const r = routeHeadless(
      board,
      R1,
      R2,
      'F.Cu',
      { trackWidth: W },
      2,
      onR1('F.Cu'),
      onR2('F.Cu'),
    );
    expect(r.ok).toBe(true);
    expect(board.Tracks()).toEqual([]);
  });

  it('routes on B.Cu between bottom pads and reports the ends on B.Cu', () => {
    const board = twoPads('B.Cu', 'B.Cu');
    const r = routeHeadless(
      board,
      R1,
      R2,
      'B.Cu',
      { trackWidth: W },
      2,
      onR1('B.Cu'),
      onR2('B.Cu'),
    );
    expect(r.ok).toBe(true);
    expect(r.ends.every((e) => e.layer === 'B.Cu')).toBe(true);
  });

  it('refuses a route that ends over the pad on the wrong layer, leaving nothing', () => {
    // R2's pad is on B.Cu; an F.Cu route ends right above it and connects nothing.
    const board = twoPads('B.Cu');
    const frame = new TEST_PCB_FRAME(board);
    const r = routeHeadless(
      board,
      R1,
      R2,
      'F.Cu',
      { trackWidth: W, commitHost: frame },
      2,
      onR1('B.Cu'),
      onR2('B.Cu'),
    );
    expect(r.ok).toBe(false);
    // Walkaround and shove, from both ends: none arrives, and it says so.
    expect(r.reason).toContain('could not reach the target in walkaround or shove');
    expect(r.ends).toEqual([]);
    expect(board.Tracks()).toEqual([]);
  });

  it('ends at a free point: a via site, the target of a pad-to-via route', () => {
    const board = twoPads();
    const free = { x: 100 * MM, y: 90 * MM };
    const atFree = (e: { x: number; y: number }) => Math.hypot(e.x - free.x, e.y - free.y) < 1000;
    const r = routeHeadless(board, R1, free, 'F.Cu', { trackWidth: W }, 2, onR1('F.Cu'), atFree);
    expect(r.ok).toBe(true);
    expect(r.ends.some(atFree)).toBe(true);
  });

  it('passes through a waypoint, like a click on the way', () => {
    const board = twoPads();
    const corner = { x: 105 * MM, y: 95 * MM };
    const r = routeHeadless(
      board,
      R1,
      R2,
      'F.Cu',
      { trackWidth: W },
      2,
      onR1('F.Cu'),
      onR2('F.Cu'),
      [corner],
    );
    expect(r.ok).toBe(true);
    const ends = r.ends;
    // A straight route would stay on y = 100; this one goes up to the corner.
    expect(
      ends.some((e) => Math.abs(e.x - corner.x) < 1000 && Math.abs(e.y - corner.y) < 1000),
    ).toBe(true);
  });

  it('retried from the far end, takes the waypoints in reverse', () => {
    // An F.Cu route cannot start at the free point (no item to start on), so
    // the route that lands comes from R2, and must click the corners in the
    // reverse order: R2 -> c2 -> c1 -> free.
    const board = twoPads();
    const free = { x: 100 * MM, y: 85 * MM };
    const c1 = { x: 100 * MM, y: 80 * MM };
    const c2 = { x: 110 * MM, y: 80 * MM };
    const near = (p: { x: number; y: number }) => (e: { x: number; y: number }) =>
      Math.abs(e.x - p.x) < 1000 && Math.abs(e.y - p.y) < 1000;
    const r = routeHeadless(
      board,
      free,
      R2,
      'F.Cu',
      { trackWidth: W },
      2,
      near(free),
      onR2('F.Cu'),
      [c1, c2],
    );
    expect(r.ok).toBe(true);
    const ends = r.ends;
    const first = (p: { x: number; y: number }) => ends.findIndex(near(p));
    expect(first(c1)).toBeGreaterThanOrEqual(0);
    expect(first(c2)).toBeGreaterThanOrEqual(0);
    expect(first(c2)).toBeLessThan(first(c1));
  });
});
