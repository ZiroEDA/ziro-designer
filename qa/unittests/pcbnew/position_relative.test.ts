// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Position Relative To.
 * Counterparts: `POSITION_RELATIVE_TOOL::RelativeItemSelectionMove`,
 * `PCB_SELECTION::GetTopLeftItem` and `moveSelectionBy`.
 *
 * The thing worth testing hardest is that this is *not* Move Exactly. The
 * displacement is computed — `reference + offset − selectionAnchor` — so the
 * selection's anchor lands exactly `offset` from the reference no matter where
 * it started. That makes the operation idempotent, which a "shift by this much"
 * reading would not be, so a fixture that starts at the origin cannot tell the
 * two apart and proves nothing.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  positionRelative,
  promotePadsToFootprints,
  selectionAnchorId,
  selectionAnchorPosition,
  topLeftItem,
} from '@ziroeda/pcbnew/src/position_relative.js';
import { boardAuxOrigin, boardGridOrigin } from '@ziroeda/pcbnew/src/plot_gerber.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import type { Board, PcbFootprint, PcbPad, PcbTrack } from '@ziroeda/pcbnew/src/types.js';

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

const pad = (x: number, y: number, number = '1'): PcbPad => ({
  number,
  type: 'smd',
  shape: 'rect',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net: 0,
  source: EMPTY,
});

const footprint = (x: number, y: number, pads: PcbPad[] = []): PcbFootprint => ({
  lib: 'Lib:R_0603',
  reference: 'R1',
  value: '10k',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  models: [],
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

const near = (got: number, want: number): void =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(1);

describe('the top-left item', () => {
  it('is the one with the smallest x', () => {
    const b = board({ tracks: [track(50, 10, 60, 10), track(20, 90, 30, 90)] });

    // Compared by anchor, not by bounding box: the second track starts further
    // left even though it sits much lower.
    expect(topLeftItem(b, ['track:0', 'track:1'])).toBe('track:1');
  });

  it('breaks a tie in x by the smaller y', () => {
    const b = board({ tracks: [track(20, 90, 30, 90), track(20, 10, 30, 10)] });

    expect(topLeftItem(b, ['track:0', 'track:1'])).toBe('track:1');
  });

  it('keeps the first item seen on an exact tie', () => {
    // Upstream's comparisons are strict, so an identical anchor never displaces
    // the incumbent.
    const b = board({ tracks: [track(20, 10, 30, 10), track(20, 10, 99, 99)] });

    expect(topLeftItem(b, ['track:0', 'track:1'])).toBe('track:0');
    expect(topLeftItem(b, ['track:1', 'track:0'])).toBe('track:1');
  });

  it('sees only footprints when asked to', () => {
    const b = board({
      tracks: [track(0, 0, 10, 0)],
      footprints: [footprint(50, 50)],
    });

    // The track is further left and still loses, because it is not a footprint.
    expect(topLeftItem(b, ['track:0', 'footprint:0'], true)).toBe('footprint:0');
  });

  it('finds nothing when the selection holds no footprint', () => {
    const b = board({ tracks: [track(0, 0, 10, 0)] });

    expect(topLeftItem(b, ['track:0'], true)).toBeNull();
  });

  it('ignores ids that resolve to nothing', () => {
    const b = board({ tracks: [track(20, 10, 30, 10)] });

    expect(topLeftItem(b, ['track:9', 'track:0'])).toBe('track:0');
  });

  it('is nothing for an empty selection', () => {
    expect(topLeftItem(board(), [])).toBeNull();
  });
});

describe('which item the selection is positioned by', () => {
  it('prefers a footprint over anything else', () => {
    const b = board({
      tracks: [track(0, 0, 10, 0)],
      footprints: [footprint(80, 80)],
    });

    // Given a footprint and stray copper, "put this 5 mm from that" means the
    // footprint — even though the track is far further top-left.
    expect(selectionAnchorId(b, ['track:0', 'footprint:0'])).toBe('footprint:0');
  });

  it('falls back to a pad when no footprint is selected', () => {
    const b = board({
      tracks: [track(0, 0, 10, 0)],
      footprints: [footprint(80, 80, [pad(90, 90)])],
    });

    expect(selectionAnchorId(b, ['track:0', 'pad:0:0'])).toBe('pad:0:0');
  });

  it('falls back to anything when neither is selected', () => {
    const b = board({ tracks: [track(50, 0, 60, 0), track(10, 0, 20, 0)] });

    expect(selectionAnchorId(b, ['track:0', 'track:1'])).toBe('track:1');
  });

  it('picks the top-left within the winning tier, not overall', () => {
    // Two footprints and a track that is further top-left than both: the tier
    // is chosen first, and only then the top-left inside it.
    const b = board({
      tracks: [track(0, 0, 5, 0)],
      footprints: [footprint(90, 20), footprint(40, 60)],
    });

    expect(selectionAnchorId(b, ['track:0', 'footprint:0', 'footprint:1'])).toBe('footprint:1');
  });

  it('reports where that anchor sits', () => {
    const b = board({ footprints: [footprint(30, 40)] });

    expect(selectionAnchorPosition(b, ['footprint:0'])).toEqual({ x: MM(30), y: MM(40) });
  });

  it('has no anchor for an empty selection', () => {
    expect(selectionAnchorPosition(board(), [])).toBeNull();
  });
});

describe('pads move their footprint', () => {
  it('promotes a pad to its parent', () => {
    expect([...promotePadsToFootprints(['pad:2:5'])]).toEqual(['footprint:2']);
  });

  it('promotes several pads of one footprint to a single entry', () => {
    // Three selected pads must not move the footprint three times.
    expect([...promotePadsToFootprints(['pad:0:0', 'pad:0:1', 'pad:0:2'])]).toEqual([
      'footprint:0',
    ]);
  });

  it('leaves everything else alone', () => {
    expect([...promotePadsToFootprints(['track:3', 'via:1'])]).toEqual(['track:3', 'via:1']);
  });

  it('actually moves the footprint when only a pad is selected', () => {
    // Without promotion this would move nothing at all: pads are not moved
    // independently by moveBoardItems.
    const b = board({ footprints: [footprint(10, 10, [pad(11, 10)])] });
    const out = positionRelative(b, ['pad:0:0'], {
      reference: { x: 0, y: 0 },
      offset: { x: MM(50), y: 0 },
    });

    // The pad is the anchor, so the *pad* lands at x = 50 and the footprint
    // body follows, keeping its 1 mm offset from the pad.
    near(out.footprints[0]!.pads[0]!.at.x, MM(50));
    near(out.footprints[0]!.at.x, MM(49));
  });
});

describe('the grid origin the dialog can measure from', () => {
  const withSetup = (body: string): Board => {
    const text = `(kicad_pcb (version 20240108) (generator "pcbnew")
	(layers (0 "F.Cu" signal))
	(net 0 "")
	(setup ${body})
)
`;
    return readBoard(parse(text));
  };

  it('reads (grid_origin x y) from the setup block', () => {
    const b = withSetup('(grid_origin 33.02 118.745)');

    expect(boardGridOrigin(b)).toEqual({ x: MM(33.02), y: MM(118.745) });
  });

  it('is the board origin when the file does not say', () => {
    expect(boardGridOrigin(withSetup('(pad_to_mask_clearance 0)'))).toEqual({ x: 0, y: 0 });
  });

  it('is not the drill/place origin', () => {
    // The two are written next to each other and usually hold the same numbers,
    // so a fixture where they agree cannot tell them apart.
    const b = withSetup('(aux_axis_origin 10 10) (grid_origin 50 60)');

    expect(boardGridOrigin(b)).toEqual({ x: MM(50), y: MM(60) });
    expect(boardAuxOrigin(b)).toEqual({ x: MM(10), y: MM(10) });
  });
});

describe('positioning', () => {
  const two = (): Board =>
    board({ tracks: [track(100, 100, 110, 100), track(100, 140, 110, 140)] });

  it('lands the anchor exactly the offset away from the reference', () => {
    const out = positionRelative(two(), ['track:0', 'track:1'], {
      reference: { x: MM(10), y: MM(20) },
      offset: { x: MM(5), y: MM(3) },
    });

    // The anchor is track:0 at (100,100); it must end at (10+5, 20+3).
    near(out.tracks[0]!.start.x, MM(15));
    near(out.tracks[0]!.start.y, MM(23));
  });

  it('is idempotent, which is what makes it not Move Exactly', () => {
    // Running it twice must change nothing the second time. A "shift by the
    // offset" reading would move twice as far, and a fixture starting at the
    // origin could not tell the two apart.
    const opts = { reference: { x: MM(10), y: MM(20) }, offset: { x: MM(5), y: MM(3) } };
    const once = positionRelative(two(), ['track:0', 'track:1'], opts);
    const twice = positionRelative(once, ['track:0', 'track:1'], opts);

    expect(twice.tracks[0]!.start).toEqual(once.tracks[0]!.start);
    expect(twice.tracks[1]!.start).toEqual(once.tracks[1]!.start);
  });

  it('moves the whole selection rigidly, not just the anchor', () => {
    const b = two();
    const out = positionRelative(b, ['track:0', 'track:1'], {
      reference: { x: MM(10), y: MM(20) },
      offset: { x: MM(5), y: MM(3) },
    });

    // The second track keeps its 40 mm separation from the first.
    near(out.tracks[1]!.start.y - out.tracks[0]!.start.y, MM(40));
    near(out.tracks[1]!.start.x, out.tracks[0]!.start.x);
  });

  it('measures from the anchor, not from the first id given', () => {
    // track:1 is listed first but track:0 is further top-left, so track:0 is
    // the anchor and lands on the target.
    const out = positionRelative(two(), ['track:1', 'track:0'], {
      reference: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
    });

    near(out.tracks[0]!.start.x, 0);
    near(out.tracks[0]!.start.y, 0);
  });

  it('puts the anchor on the reference itself for a zero offset', () => {
    const out = positionRelative(two(), ['track:0'], {
      reference: { x: MM(7), y: MM(9) },
      offset: { x: 0, y: 0 },
    });

    near(out.tracks[0]!.start.x, MM(7));
    near(out.tracks[0]!.start.y, MM(9));
  });

  it('leaves unselected items where they are', () => {
    const b = two();
    const out = positionRelative(b, ['track:0'], {
      reference: { x: 0, y: 0 },
      offset: { x: 0, y: 0 },
    });

    expect(out.tracks[1]!.start).toEqual(b.tracks[1]!.start);
  });

  it('does nothing with an empty selection', () => {
    const b = two();

    expect(positionRelative(b, [], { reference: { x: MM(5), y: 0 }, offset: { x: 0, y: 0 } })).toBe(
      b,
    );
  });

  it('does nothing when the selection resolves to no anchor', () => {
    const b = two();

    expect(
      positionRelative(b, ['track:9'], { reference: { x: MM(5), y: 0 }, offset: { x: 0, y: 0 } }),
    ).toBe(b);
  });
});
