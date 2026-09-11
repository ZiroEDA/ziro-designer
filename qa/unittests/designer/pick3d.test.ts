// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `IntersectBoardItem` for the rasteriser, and the HOVERED_ITEM / `$SELECT`
 * text `EDA_3D_CANVAS` makes of a hit (eda_3d_canvas.cpp:985-1078, 1129-1163).
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  boardItemAt,
  clickSelectionParts,
  hoveredItemMessage,
  pickBoardItem,
} from '@ziroeda/designer/src/editors/pcb/pick3d.js';

const MM = 1e6;
const board = readBoard(
  parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user) (38 "B.SilkS" user))
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  (footprint "R" (layer "F.Cu") (at 10 10)
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS"))
    (property "Value" "10k" (at 0 2 0) (layer "F.SilkS"))
    (pad "1" thru_hole circle (at -2 0) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 1 "GND"))
    (pad "2" smd rect (at 2 0) (size 2 1) (layers "F.Cu" "F.Mask") (net 2 "VCC"))
  )
  (segment (start 20 20) (end 30 20) (width 0.5) (layer "F.Cu") (net 1))
  (via (at 25 25) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 2))
  (zone (net 1) (net_name "GND") (layer "B.Cu") (name "pour")
    (polygon (pts (xy 0 30) (xy 40 30) (xy 40 40) (xy 0 40)))
    (filled_polygon (layer "B.Cu") (pts (xy 0 30) (xy 40 30) (xy 40 40) (xy 0 40))))
)`),
);
const netClassOf = (): string => 'Default';

describe('boardItemAt — which copper item covers a board point', () => {
  it('a pad by its shape, not the drill', () => {
    expect(boardItemAt(board, { x: 8.7 * MM, y: 10 * MM }, 'F.Cu')).toEqual({
      kind: 'pad',
      footprint: 0,
      pad: 0,
    });
    // through the 1 mm drill there is nothing
    expect(boardItemAt(board, { x: 8 * MM, y: 10 * MM }, 'F.Cu')).toBeNull();
    // the SMD pad is front-only
    expect(boardItemAt(board, { x: 12 * MM, y: 10 * MM }, 'F.Cu')).toEqual({
      kind: 'pad',
      footprint: 0,
      pad: 1,
    });
    expect(boardItemAt(board, { x: 12 * MM, y: 10 * MM }, 'B.Cu')).toBeNull();
  });

  it('a track within half its width, a via within its ring, a zone inside its fill', () => {
    expect(boardItemAt(board, { x: 25 * MM, y: 20.2 * MM }, 'F.Cu')).toEqual({
      kind: 'track',
      track: 0,
    });
    expect(boardItemAt(board, { x: 25 * MM, y: 20.3 * MM }, 'F.Cu')).toBeNull();
    expect(boardItemAt(board, { x: 25.3 * MM, y: 25 * MM }, 'B.Cu')).toEqual({
      kind: 'via',
      via: 0,
    });
    expect(boardItemAt(board, { x: 25.1 * MM, y: 25 * MM }, 'B.Cu')).toBeNull(); // the hole
    expect(boardItemAt(board, { x: 20 * MM, y: 35 * MM }, 'B.Cu')).toEqual({
      kind: 'zone',
      zone: 0,
      layer: 'B.Cu',
    });
    expect(boardItemAt(board, { x: 20 * MM, y: 35 * MM }, 'F.Cu')).toBeNull();
  });
});

describe('pickBoardItem — the nearest hit along the ray', () => {
  // 3D units: 1 IU · scale; a straight-down ray from above
  const outline = [
    { x: 0, y: 0 },
    { x: 40 * MM, y: 0 },
    { x: 40 * MM, y: 40 * MM },
    { x: 0, y: 40 * MM },
  ];
  const frame = { scale: 1e-7, zTopFront: 0.8, zBottomBack: -0.8, boardOutline: [outline] };
  it('a fractional hit is rounded to IU before the integer polygon tests — it must not throw', () => {
    // 2.5 / 1e-7 is exact; nudge the ray so the plane point is a non-integer IU
    const item = pickBoardItem(
      board,
      frame,
      [2.50000003, -2.00000007, 16],
      [0.0000001, 0, -1],
      null,
    );
    expect(item).toEqual({ kind: 'track', track: 0 });
  });
  it('drops onto the front copper first when the camera is above', () => {
    // track at (25, 20) mm → 3D (2.5, −2.0)
    const item = pickBoardItem(board, frame, [2.5, -2.0, 16], [0, 0, -1], null);
    expect(item).toEqual({ kind: 'track', track: 0 });
  });
  it('sees the back zone from below, and nothing through the board from above', () => {
    expect(pickBoardItem(board, frame, [2.0, -3.5, -16], [0, 0, 1], null)).toEqual({
      kind: 'zone',
      zone: 0,
      layer: 'B.Cu',
    });
    // from above the ray lands on the mask/body over that point (an object
    // with no BOARD_ITEM) and stops: the back zone is not reached
    expect(pickBoardItem(board, frame, [2.0, -3.5, 16], [0, 0, -1], null)).toBeNull();
    // off the board entirely there is nothing on either face
    expect(pickBoardItem(board, frame, [9, 9, 16], [0, 0, -1], null)).toBeNull();
  });
  it('off the board, a model still counts', () => {
    expect(pickBoardItem(board, frame, [9, 9, 16], [0, 0, -1], { t: 5, footprint: 0 })).toEqual({
      kind: 'footprint',
      footprint: 0,
    });
  });
  it('a model hit nearer than the copper wins; a farther one loses', () => {
    expect(
      pickBoardItem(board, frame, [2.5, -2.0, 16], [0, 0, -1], { t: 14, footprint: 0 }),
    ).toEqual({
      kind: 'footprint',
      footprint: 0,
    });
    expect(
      pickBoardItem(board, frame, [2.5, -2.0, 16], [0, 0, -1], { t: 17, footprint: 0 }),
    ).toEqual({
      kind: 'track',
      track: 0,
    });
  });
});

describe('the HOVERED_ITEM message', () => {
  it('"Pad %s\\tNet %s\\tNet class %s" for a pad, "REF  VALUE" for a model', () => {
    expect(hoveredItemMessage(board, { kind: 'pad', footprint: 0, pad: 0 }, netClassOf)).toBe(
      'Pad 1\tNet GND\tNet class Default',
    );
    expect(hoveredItemMessage(board, { kind: 'footprint', footprint: 0 }, netClassOf)).toBe(
      'R1  10k',
    );
    expect(hoveredItemMessage(board, { kind: 'via', via: 0 }, netClassOf)).toBe(
      'Net VCC\tNet class Default',
    );
    expect(hoveredItemMessage(board, { kind: 'zone', zone: 0, layer: 'B.Cu' }, netClassOf)).toBe(
      'Zone pour\tNet GND\tNet class Default',
    );
    expect(hoveredItemMessage(board, null, netClassOf)).toBe('');
  });
});

describe('the click', () => {
  it('names the footprint for a model or pad hit and sends nothing for the rest', () => {
    expect(clickSelectionParts(board, { kind: 'pad', footprint: 0, pad: 1 })).toEqual(['FR1']);
    expect(clickSelectionParts(board, { kind: 'footprint', footprint: 0 })).toEqual(['FR1']);
    expect(clickSelectionParts(board, { kind: 'track', track: 0 })).toEqual([]);
    expect(clickSelectionParts(board, null)).toEqual([]);
  });
});
