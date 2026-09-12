// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `VIA_PLACER` — the Place Vias tool's `PlaceItem` and `findTrack`
 * (`pcbnew/tools/drawing_tool.cpp:3686-4412`).
 *
 * The behaviour worth pinning is the one a screenshot cannot show: a via
 * dropped on a track **breaks** it. Without that the board still holds one
 * continuous segment running through the via, so the router cannot attach to
 * it and dragging either end moves the whole track.
 */
import { describe, expect, it } from 'vitest';
import { U } from './support/written_node.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { placeVia, trackUnderVia } from '@ziroeda/pcbnew/src/via_placer.js';
import type { Board, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

/** One 20 mm track on F.Cu, net 1, 0.25 mm wide, from (0,0) to (20,0). */
const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "GND")
  (segment (start 0 0) (end 20 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U('t1')}"))
)`;

const load = (): Board => readBoard(parse(SRC));

const via = (at: { x: number; y: number }, over: Partial<PcbVia> = {}): Omit<PcbVia, 'source'> => ({
  at,
  size: MM(0.8),
  drill: MM(0.4),
  layers: ['B.Cu', 'F.Cu'],
  kind: 'through',
  net: 1,
  ...over,
});

describe('findTrack', () => {
  it('finds the track the via overlaps', () => {
    const b = load();
    expect(trackUnderVia(b, { x: MM(10), y: 0 }, ['B.Cu', 'F.Cu'], MM(0.8))).toBe(0);
  });

  it('reaches half the two widths, and no further', () => {
    // `TestSegmentHit( pos, start, end, ( track width + via width ) / 2 )` —
    // 0.25 + 0.8 over two is 0.525 mm.
    const b = load();
    const hit = (dy: number): number | null =>
      trackUnderVia(b, { x: MM(10), y: MM(dy) }, ['B.Cu', 'F.Cu'], MM(0.8));
    expect(hit(0.5)).toBe(0);
    expect(hit(0.6)).toBeNull();
  });

  it('ignores a track on a layer the via does not reach', () => {
    const b = load();
    expect(trackUnderVia(b, { x: MM(10), y: 0 }, ['In1.Cu', 'In2.Cu'], MM(0.8))).toBeNull();
  });
});

describe('placing on a track', () => {
  it('breaks it in two at the via', () => {
    const r = placeVia(load(), via({ x: MM(10), y: 0 }));

    expect(r.splitTrack).toBe(true);
    expect(r.board.tracks).toHaveLength(2);
    // "track->SetStart( trackStart ); track->SetEnd( viaPos )" and a clone
    // from the via to the old end.
    expect(r.board.tracks[0]!.start).toEqual({ x: 0, y: 0 });
    expect(r.board.tracks[0]!.end).toEqual({ x: MM(10), y: 0 });
    expect(r.board.tracks[1]!.start).toEqual({ x: MM(10), y: 0 });
    expect(r.board.tracks[1]!.end).toEqual({ x: MM(20), y: 0 });
  });

  it('carries every other property to the far half, but not the uuid', () => {
    // The far half is `track->Clone()` with `m_Uuid = KIID()` — a NEW id, and
    // everything else the same.
    const r = placeVia(load(), via({ x: MM(10), y: 0 }));
    const [near, far] = r.board.tracks;

    expect(far!.width).toBe(near!.width);
    expect(far!.layer).toBe(near!.layer);
    expect(far!.net).toBe(near!.net);
    expect(near!.uuid).toBe(U('t1'));
    expect(far!.uuid).toBeDefined();
    expect(far!.uuid).not.toBe(U('t1'));
  });

  it('does NOT break it when the via lands on an end', () => {
    // "if( viaPos == trackStart || viaPos == trackEnd ) return true;"
    for (const at of [
      { x: 0, y: 0 },
      { x: MM(20), y: 0 },
    ]) {
      const r = placeVia(load(), via(at));
      expect(r.splitTrack).toBe(false);
      expect(r.board.tracks).toHaveLength(1);
    }
  });

  it('does NOT break it when the via is beside the track rather than on it', () => {
    // Within `findTrack`'s reach — half the two widths — but off the segment,
    // so `trackSeg.Contains( viaPos )` is false and there is nothing to split.
    const r = placeVia(load(), via({ x: MM(10), y: MM(0.4) }));
    expect(r.splitTrack).toBe(false);
    expect(r.board.tracks).toHaveLength(1);
  });

  it('does NOT break it when Shift held the snap off', () => {
    // "If the user explicitly disables snap (using shift), then don't break the
    // tracks. This will prevent PNS from being able to connect the via and
    // track but it is explicitly requested by the user."
    const r = placeVia(load(), via({ x: MM(10), y: 0 }), { allowSplit: false });
    expect(r.splitTrack).toBe(false);
    expect(r.board.tracks).toHaveLength(1);
    // The via still lands.
    expect(r.board.vias).toHaveLength(1);
  });
});

describe('the via itself', () => {
  it('is always added, split or not', () => {
    const on = placeVia(load(), via({ x: MM(10), y: 0 }));
    const off = placeVia(load(), via({ x: MM(50), y: MM(50) }));
    expect(on.board.vias).toHaveLength(1);
    expect(off.board.vias).toHaveLength(1);
    expect(off.splitTrack).toBe(false);
  });

  it('is the id the caller selects', () => {
    expect(placeVia(load(), via({ x: MM(10), y: 0 })).viaId).toBe('via:0');
  });

  it('leaves the source board untouched', () => {
    const b = load();
    placeVia(b, via({ x: MM(10), y: 0 }));
    expect(b.tracks).toHaveLength(1);
    expect(b.vias).toHaveLength(0);
  });
});

describe('the nearest track wins', () => {
  it('when two overlap the same point', () => {
    // "int min_d = max; … if( dist < min_d )" — measured to the SEGMENT, not
    // to either end.
    const b = load();
    const two: Board = {
      ...b,
      tracks: [
        ...b.tracks,
        { ...b.tracks[0]!, start: { x: 0, y: MM(0.4) }, end: { x: MM(20), y: MM(0.4) } },
      ],
    };
    // Sitting on the first track: it is 0 away, the second 0.4 mm.
    expect(trackUnderVia(two, { x: MM(10), y: 0 }, ['B.Cu', 'F.Cu'], MM(0.8))).toBe(0);
    // And nearer the second.
    expect(trackUnderVia(two, { x: MM(10), y: MM(0.4) }, ['B.Cu', 'F.Cu'], MM(0.8))).toBe(1);
  });
});
