// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The point-editor handles a dimension carries, and what dragging one does.
 * Counterparts: `ALIGNED_DIMENSION_POINT_EDIT_BEHAVIOR`,
 * `DIM_CENTER_POINT_EDIT_BEHAVIOR`, `DIM_RADIAL_POINT_EDIT_BEHAVIOR` and
 * `DIM_LEADER_POINT_EDIT_BEHAVIOR` (pcbnew/tools/pcb_point_editor.cpp).
 *
 * These go through the *shared* point editor — `boardEditHandles` and
 * `dragBoardHandle`, the same two functions a track, a zone corner and a
 * graphic arc use — so the canvas needed no change to draw or drag them. The
 * grips, their hit tolerance and their painting were already there.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  boardEditHandles,
  dragBoardHandle,
  editablePointItems,
  type BoardEditHandle,
} from '@ziroeda/pcbnew/src/point_editor.js';
import { boardItemId } from '@ziroeda/pcbnew/src/edit-board.js';
import { radialKnee } from '@ziroeda/pcbnew/src/dimension_geometry.js';
import type { Board, PcbDimension, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): { x: number; y: number } => ({ x: MM(x), y: MM(y) });
const EMPTY = { kind: 'list' as const, items: [] };

// Upstream's point order (pcb_point_editor.h:135-146).
const DIM_START = 0;
const DIM_END = 1;
const DIM_TEXT = 2;
const DIM_CROSSBARSTART = 3;
const DIM_CROSSBAREND = 4;
const DIM_KNEE = DIM_CROSSBARSTART;

const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'user',
  text: '',
  at: P(5, 3),
  angle: 0,
  layer: 'Dwgs.User',
  size: { x: MM(1), y: MM(1) },
  thickness: MM(0.15),
  source: EMPTY,
  ...over,
});

const dim = (over: Partial<PcbDimension> = {}): PcbDimension => ({
  kind: 'aligned',
  layer: 'Dwgs.User',
  start: P(0, 0),
  end: P(10, 0),
  height: MM(5),
  style: {
    thickness: MM(0.1),
    arrowLength: MM(1.27),
    textPositionMode: 0,
    extensionOffset: MM(0.5),
    extensionHeight: MM(0.58642),
    arrowDirection: 'outward',
    keepTextAligned: true,
  },
  format: {
    prefix: '',
    suffix: '',
    units: 2,
    unitsFormat: 0,
    precision: 4,
    suppressZeroes: true,
  },
  text: text(),
  source: EMPTY,
  ...over,
});

const boardWith = (d: PcbDimension): Board =>
  ({
    tracks: [],
    arcs: [],
    shapes: [],
    zones: [],
    barcodes: [],
    dimensions: [d],
    footprints: [],
    vias: [],
    points: [],
    texts: [],
    textBoxes: [],
    tables: [],
    images: [],
    groups: [],
    nets: [],
    layers: [],
    source: EMPTY,
  }) as unknown as Board;

const ID = boardItemId('dimension', 0);
const handles = (d: PcbDimension): BoardEditHandle[] => boardEditHandles(boardWith(d), ID);
const at = (d: PcbDimension, index: number): { x: number; y: number } =>
  handles(d).find((h) => h.index === index)!.at;
const drag = (d: PcbDimension, index: number, pos: { x: number; y: number }): PcbDimension => {
  const h = handles(d).find((x) => x.index === index)!;
  return dragBoardHandle(boardWith(d), ID, h, pos).dimensions[0]!;
};

describe('how many handles each kind carries', () => {
  it('gives the two crossbar kinds five', () => {
    // start, end, text, crossbar start, crossbar end.
    expect(handles(dim())).toHaveLength(5);
    expect(handles(dim({ kind: 'orthogonal', orientation: 0 }))).toHaveLength(5);
  });

  it('gives a radial four, the fourth being its knee', () => {
    const d = dim({ kind: 'radial', height: undefined, leaderLength: MM(3) });
    expect(handles(d)).toHaveLength(4);
    expect(at(d, DIM_KNEE)).toEqual(radialKnee(d));
  });

  it('gives a leader three', () => {
    expect(handles(dim({ kind: 'leader', height: undefined }))).toHaveLength(3);
  });

  it('gives a centre mark two, since it has no text and no crossbar', () => {
    const d = dim({ kind: 'center', height: undefined, text: undefined, format: undefined });
    expect(handles(d)).toHaveLength(2);
  });

  it('still gives a centre mark two even if it is carrying a text item', () => {
    // `DIM_CENTER_POINT_EDIT_BEHAVIOR::MakePoints` adds exactly the start and
    // the end and nothing else — a centre mark has no draggable label, whatever
    // the item happens to hold. Our model never gives one text, but a file can:
    // `updateText` sets a centre dimension's text position "so GetTextPos()
    // users get a valid value", and a hand-written `(gr_text …)` child survives
    // the reader.
    const d = dim({ kind: 'center', height: undefined, format: undefined, text: text() });
    expect(handles(d)).toHaveLength(2);
    expect(handles(d).map((h) => h.index)).toEqual([DIM_START, DIM_END]);
  });

  it('puts them where the geometry is', () => {
    const d = dim();
    expect(at(d, DIM_START)).toEqual(P(0, 0));
    expect(at(d, DIM_END)).toEqual(P(10, 0));
    expect(at(d, DIM_TEXT)).toEqual(d.text!.at);
    // Crossbar of a 10 mm horizontal dimension 5 mm up.
    expect(at(d, DIM_CROSSBARSTART)).toEqual(P(0, 5));
    expect(at(d, DIM_CROSSBAREND)).toEqual(P(10, 5));
  });

  it('is every one an EDIT_POINT — a dimension has no EDIT_LINE', () => {
    // Which matters because the canvas draws a `line` handle as a circle at an
    // edge midpoint and moves it by a delta rather than onto the cursor.
    for (const h of handles(dim())) expect(h.kind).toBe('point');
  });

  it('offers the point editor every dimension on the board', () => {
    expect(editablePointItems(boardWith(dim()))).toContain(ID);
  });
});

describe('the constraints on the handles', () => {
  it('snaps a centre mark end to 45 degrees off its start', () => {
    // `EC_45DEGREE( Point( DIM_END ), Point( DIM_START ) )`. |x| 10 beats |y| 3
    // by more than two, so the y component is zeroed.
    const d = dim({ kind: 'center', height: undefined, text: undefined, format: undefined });
    expect(drag(d, DIM_END, P(10, 3)).end).toEqual(P(10, 0));
    // Near the diagonal instead, the smaller component takes the larger's size.
    expect(drag(d, DIM_END, P(10, 8)).end).toEqual(P(10, 10));
  });

  it('holds a radial knee on the line through its two feature points', () => {
    // `EC_LINE( Point( DIM_START ), Point( DIM_END ) )` — the knee only ever
    // slides along the radius, so dragging it changes the leader length alone.
    const d = dim({
      kind: 'radial',
      height: undefined,
      leaderLength: MM(3),
      start: P(0, 0),
      end: P(10, 0),
      text: text({ at: P(20, 0) }),
    });
    // A cursor well off the axis projects back onto it: only x survives.
    const moved = drag(d, DIM_KNEE, P(16, 9));
    expect(moved.end).toEqual(P(10, 0)); // the measured point did not move
    expect(moved.leaderLength).toBe(MM(6)); // |16 - 10| along the radius
  });

  it('snaps a leader label to 45 degrees off its elbow', () => {
    const d = dim({ kind: 'leader', height: undefined, start: P(0, 0), end: P(10, 10) });
    // (13, 11) from (10, 10) is (3, 1): |x| > 2|y|, so it flattens.
    expect(drag(d, DIM_TEXT, P(13, 11)).text!.at).toEqual(P(13, 10));
  });
});

describe('dragging a feature point', () => {
  it('moves it and re-derives the label', () => {
    const moved = drag(dim(), DIM_END, P(25, 0));
    expect(moved.end).toEqual(P(25, 0));
    expect(moved.text!.text).toBe('25');
  });

  it('carries a leader label along with the elbow it hangs off', () => {
    // `m_dimension.SetTextPos( m_dimension.GetTextPos() + delta )`.
    const d = dim({
      kind: 'leader',
      height: undefined,
      end: P(10, 10),
      text: text({ at: P(20, 10) }),
    });
    const moved = drag(d, DIM_END, P(12, 14));
    expect(moved.end).toEqual(P(12, 14));
    expect(moved.text!.at).toEqual(P(22, 14)); // moved by the same (2, 4)
  });

  it('carries a radial label by the knee delta, not the end delta', () => {
    // The label hangs off the knee, so it must follow the knee — which moves by
    // a different amount from the measured point, because the leader length is
    // kept while its direction changes.
    const d = dim({
      kind: 'radial',
      height: undefined,
      leaderLength: MM(3),
      start: P(0, 0),
      end: P(10, 0),
      text: text({ at: P(20, 0) }),
    });
    const before = radialKnee(d);
    const moved = drag(d, DIM_END, P(20, 0));
    const after = radialKnee(moved);
    expect(moved.text!.at).toEqual({
      x: MM(20) + (after.x - before.x),
      y: after.y - before.y,
    });
  });
});

describe('dragging the label', () => {
  it('forces MANUAL mode, which is what makes the drag stick', () => {
    // "Force manual mode if we weren't already in it". Without it the very next
    // `Update()` would put the label straight back on the crossbar.
    const d = dim();
    expect(d.style.textPositionMode).toBe(0);
    const moved = drag(d, DIM_TEXT, P(4, -6));
    expect(moved.style.textPositionMode).toBe(2);
    expect(moved.text!.at).toEqual(P(4, -6));
  });

  it('leaves the measurement alone while moving the label', () => {
    const moved = drag(dim(), DIM_TEXT, P(4, -6));
    expect(moved.start).toEqual(P(0, 0));
    expect(moved.end).toEqual(P(10, 0));
    expect(moved.text!.text).toBe('10');
  });
});

describe('dragging an aligned crossbar handle', () => {
  it('sets the height from the length of the feature line', () => {
    // Dragging the crossbar-start handle 8 mm above the start point.
    const moved = drag(dim(), DIM_CROSSBARSTART, P(0, -8));
    expect(Math.abs(moved.height!)).toBe(MM(8));
  });

  it('takes the sign from which side of the measurement the cursor is', () => {
    // `featureLine.Cross( crossBar ) > 0` gives a negative height. With the
    // crossbar running +x, a feature line running -y (up the screen) crosses
    // positive, so the height goes negative — and the bar lands above.
    const up = drag(dim(), DIM_CROSSBARSTART, P(0, -8));
    const down = drag(dim(), DIM_CROSSBARSTART, P(0, 8));
    expect(Math.sign(up.height!)).toBe(-Math.sign(down.height!));
  });

  it('projects the cursor onto the extension line, so sliding sideways does nothing', () => {
    // `EC_LINE( Point( DIM_CROSSBARSTART ), Point( DIM_START ) )`. Without the
    // projection the height would take the whole diagonal distance.
    const a = drag(dim(), DIM_CROSSBARSTART, P(0, -8));
    const b = drag(dim(), DIM_CROSSBARSTART, P(40, -8));
    expect(b.height).toBe(a.height);
  });

  it('reads the same height from either end of the bar', () => {
    const fromStart = drag(dim(), DIM_CROSSBARSTART, P(0, -8));
    const fromEnd = drag(dim(), DIM_CROSSBAREND, P(10, -8));
    expect(fromEnd.height).toBe(fromStart.height);
  });

  it('moves the label with the bar, because Update() re-places it', () => {
    const before = dim().text!.at;
    const moved = drag(dim(), DIM_CROSSBARSTART, P(0, -8));
    expect(moved.text!.at).not.toEqual(before);
  });
});

describe('dragging an orthogonal crossbar handle', () => {
  const ortho = (over: Partial<PcbDimension> = {}): PcbDimension =>
    dim({ kind: 'orthogonal', orientation: 0, start: P(0, 0), end: P(10, 7), ...over });

  it('takes one raw axis of the cursor as the height', () => {
    // Horizontal: the height is the y offset from the start point.
    const moved = drag(ortho(), DIM_CROSSBARSTART, P(5, 20));
    expect(moved.orientation).toBe(0);
    expect(moved.height).toBe(MM(20));
  });

  it('keeps the orientation while the cursor is inside the feature box', () => {
    // Otherwise it flickers as you drag across the diagonal.
    const moved = drag(ortho({ orientation: 1 }), DIM_CROSSBARSTART, P(5, 3));
    expect(moved.orientation).toBe(1);
  });

  it('re-picks it once the cursor leaves the box', () => {
    expect(drag(ortho(), DIM_CROSSBARSTART, P(5, 40)).orientation).toBe(0);
    expect(drag(ortho(), DIM_CROSSBARSTART, P(40, 3)).orientation).toBe(1);
  });

  it('breaks the tie against the nearest feature point, not the box centre', () => {
    // This is the one place the point editor and the drawing tool disagree:
    // `SET_HEIGHT` measures from `bbox.Centre()`, while this measures from
    // whichever of the two feature points is closer ("Find vector from nearest
    // dimension point to edit position"). A cursor up and left of a box that is
    // wider than it is tall lands in the diagonal fallback, where the two
    // reference points give different answers.
    const d = ortho({ start: P(0, 0), end: P(40, 4) });
    // (-6, -5): nearest feature point is the start, giving |dy| 5 < |dx| 6 and
    // so VERTICAL. From the box centre (20, 2) the offset is (-26, -7), which
    // is also vertical — so use a cursor that separates them.
    const moved = drag(d, DIM_CROSSBARSTART, P(-3, -10));
    // From the start the offset is (-3, -10): |dy| 10 < |dx| 3 is false, so
    // HORIZONTAL. From the box centre it would be (-23, -12), |12| < |23|, so
    // VERTICAL. Upstream's answer here is horizontal.
    expect(moved.orientation).toBe(0);
  });
});
