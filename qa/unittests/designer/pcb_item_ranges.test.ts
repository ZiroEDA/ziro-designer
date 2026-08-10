// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Per-item vertex ranges, our answer to KiCad's CACHED_CONTAINER.
 *
 * KiCad gives every item a chunk of the cached vertex buffer, so `VIEW::Update`
 * re-caches just the item that moved. Ours merges items into per-layer buckets,
 * so ownership is carried per run and the recorder groups it back out — same
 * addressability. Without it, nudging a footprint meant re-recording the whole
 * board: 1228 ms on the coldfire demo, which is what made dragging unusable.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { buildScene, DEFAULT_DRAW_OPTIONS } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { Scene, SEGMENT_STRIDE } from '@ziroeda/designer/src/render/gl/scene.js';
import { recordBoardScene } from '@ziroeda/designer/src/render/gl/pcb_gl.js';
import {
  buildRatsnest,
  prepareLocalRatsnest,
  type RatsnestEdge,
} from '@ziroeda/pcbnew/src/ratsnest.js';
import {
  deleteBoardItems,
  moveBoardItems,
  subsetBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';

const MM = 1e6;
const board = (): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "VCC")
  (segment (start 100 100) (end 120 100) (width 0.25) (layer "F.Cu") (net 1))
  (segment (start 120 100) (end 120 118) (width 0.25) (layer "F.Cu") (net 1))
  (via (at 130 100) (size 1.6) (drill 0.8) (layers "F.Cu" "B.Cu") (net 1))
  (footprint "R" (layer "F.Cu") (at 110 110)
    (pad "1" smd rect (at 0 0) (size 1.5 1.5) (layers "F.Cu") (net 1 "VCC"))
    (pad "2" smd rect (at 2 0) (size 1.5 1.5) (layers "F.Cu") (net 1 "VCC")))
)`),
  );

const record = (): Scene => {
  const scene = buildScene(board(), {}, GL_PATH_FACTORY);
  const gl = new Scene(true);
  recordBoardScene(
    gl,
    {
      scene,
      visible: new Set(['F.Cu', 'B.Cu', 'Edge.Cuts']),
      opts: DEFAULT_DRAW_OPTIONS,
      emphasis: 'none',
    },
    1,
  );
  return gl;
};

describe('items are addressable in the recorded buffer', () => {
  it('names every track, via and footprint the builder walked', () => {
    const gl = record();
    expect(gl.itemRanges.has('track:0')).toBe(true);
    expect(gl.itemRanges.has('track:1')).toBe(true);
    expect(gl.itemRanges.has('via:0')).toBe(true);
    expect(gl.itemRanges.has('footprint:0')).toBe(true);
  });

  it('moves one item without touching any other vertex', () => {
    const gl = record();
    const before = gl.segments.view().slice();
    const ranges = gl.translateItem('track:0', 5 * MM, 0);
    expect(ranges).not.toBeNull();

    const after = gl.segments.view();
    const moved = new Set<number>();
    for (const [first, count] of ranges!.seg) for (let i = 0; i < count; i++) moved.add(first + i);
    for (let inst = 0; inst < gl.segmentCount; inst++) {
      const o = inst * SEGMENT_STRIDE;
      const same = after[o] === before[o] && after[o + 1] === before[o + 1];
      // Every instance outside the item's ranges must be byte-for-byte intact.
      if (!moved.has(inst)) expect(same, `instance ${inst} moved but should not`).toBe(true);
    }
    // And the item really did move: x shifted by exactly the delta.
    const [first] = ranges!.seg[0]!;
    const o = first * SEGMENT_STRIDE;
    expect(after[o]! - before[o]!).toBeCloseTo(5 * MM, 3);
  });

  it('is reversible, which is what cancelling a drag relies on', () => {
    const gl = record();
    const before = gl.segments.view().slice();
    gl.translateItem('footprint:0', 3 * MM, -2 * MM);
    gl.translateItem('footprint:0', -3 * MM, 2 * MM);
    const after = gl.segments.view();
    for (let i = 0; i < after.length; i++) expect(after[i]).toBeCloseTo(before[i]!, 3);
  });

  it('reports nothing for an item it never recorded', () => {
    expect(record().translateItem('footprint:99', 1, 1)).toBeNull();
  });
});

describe('the live ratsnest is scoped to the nets that moved', () => {
  it('computes only the requested nets, and the same edges for them', () => {
    const b = board();
    const all = buildRatsnest(b);
    const nets = new Set(all.map((e) => e.net));
    expect(nets.size).toBeGreaterThan(0);
    const one = [...nets][0]!;
    const scoped = buildRatsnest(b, { onlyNets: new Set([one]) });
    // Nothing outside the set, and inside it exactly what the full pass found.
    expect(scoped.every((e) => e.net === one)).toBe(true);
    expect(scoped.length).toBe(all.filter((e) => e.net === one).length);
  });

  it('an empty set computes nothing', () => {
    expect(buildRatsnest(board(), { onlyNets: new Set() })).toEqual([]);
  });
});

describe('the drag ratsnest is bucketed once and then only moved', () => {
  // KiCad's calculateSelectionRatsnest builds the moving items' connectivity on
  // the first frame, blocks them out of the board's graph, and thereafter only
  // calls Move( aDelta ). This checks ours lands on the same airwires as a full
  // recompute would — an airwire is undirected, so the endpoints are normalised
  // before comparing, which is exactly the trap that made a correct
  // implementation look broken.
  const key = (e: RatsnestEdge): string => {
    const a = `${Math.round(e.ax)},${Math.round(e.ay)}`;
    const b = `${Math.round(e.bx)},${Math.round(e.by)}`;
    return `${e.net}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
  };

  it('gives the same airwires as recomputing the whole board', () => {
    const b = board();
    const sel = new Set(['footprint:0']);
    const local = prepareLocalRatsnest(deleteBoardItems(b, sel), subsetBoardItems(b, sel));
    for (const d of [
      { x: 0, y: 0 },
      { x: 3 * MM, y: -1 * MM },
      { x: -4 * MM, y: 6 * MM },
    ]) {
      const incremental = local.at(d).map(key).sort();
      const full = buildRatsnest(moveBoardItems(b, sel, d), { onlyNets: local.nets })
        .map(key)
        .sort();
      expect(incremental, `delta ${d.x},${d.y}`).toEqual(full);
    }
  });

  it('translates from the original each time rather than compounding', () => {
    const b = board();
    const sel = new Set(['footprint:0']);
    const local = prepareLocalRatsnest(deleteBoardItems(b, sel), subsetBoardItems(b, sel));
    local.at({ x: 10 * MM, y: 10 * MM });
    const second = local
      .at({ x: 1 * MM, y: 0 })
      .map(key)
      .sort();
    const fresh = prepareLocalRatsnest(deleteBoardItems(b, sel), subsetBoardItems(b, sel))
      .at({ x: 1 * MM, y: 0 })
      .map(key)
      .sort();
    expect(second).toEqual(fresh);
  });
});
