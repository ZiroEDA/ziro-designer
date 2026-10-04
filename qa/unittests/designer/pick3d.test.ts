// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `IntersectBoardItem` for the rasteriser, and the HOVERED_ITEM / `$SELECT`
 * text `EDA_3D_CANVAS` makes of a hit (eda_3d_canvas.cpp:985-1078, 1129-1163).
 */
import { describe, expect, it } from 'vitest';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  boardItemAt,
  clickSelectionParts,
  hoveredItemMessage,
  type PickedItem,
  pickBoardItem,
} from '@ziroeda/3d-viewer/pick3d.js';
import type { PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';

const MM = 1e6;
const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user) (5 "F.SilkS" user) (7 "B.SilkS" user))
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  (footprint "R" (layer "F.Cu") (at 10 10) (uuid "00000000-0000-4000-8000-000000000001")
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000002"))
    (property "Value" "10k" (at 0 2 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000003"))
    (pad "1" thru_hole circle (at -2 0) (size 2 2) (drill 1) (layers "*.Cu" "*.Mask") (net 1 "GND") (uuid "00000000-0000-4000-8000-000000000004"))
    (pad "2" smd rect (at 2 0) (size 2 1) (layers "F.Cu" "F.Mask") (net 2 "VCC") (uuid "00000000-0000-4000-8000-000000000005"))
  )
  (segment (start 20 20) (end 30 20) (width 0.5) (layer "F.Cu") (net 1) (uuid "00000000-0000-4000-8000-000000000006"))
  (via (at 25 25) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 2) (uuid "00000000-0000-4000-8000-000000000007"))
  (zone (net 1) (net_name "GND") (layer "B.Cu") (name "pour") (uuid "00000000-0000-4000-8000-000000000008")
    (polygon (pts (xy 0 30) (xy 40 30) (xy 40 40) (xy 0 40)))
    (filled_polygon (layer "B.Cu") (pts (xy 0 30) (xy 40 30) (xy 40 40) (xy 0 40))))
)`);
const pads = board.Footprints()[0]!.Pads();
const track = board.Tracks()[0] as PCB_TRACK;
const via = board.Tracks()[1] as PCB_VIA;
const zone = board.Zones()[0]!;

/** A picked item as something cheap to compare: live items print the whole board. */
const tag = (aItem: PickedItem | null): string | null => {
  if (!aItem) return null;

  switch (aItem.kind) {
    case 'footprint':
      return `footprint:${aItem.footprint}`;
    case 'pad':
      return `pad:${aItem.footprint}:${aItem.pad.GetNumber()}`;
    case 'track':
      return `track:${aItem.track.m_Uuid}`;
    case 'arc':
      return `arc:${aItem.arc.m_Uuid}`;
    case 'via':
      return `via:${aItem.via.m_Uuid}`;
    case 'zone':
      return `zone:${aItem.zone.m_Uuid}:${aItem.layer}`;
  }
};
const netClassOf = (): string => 'Default';

describe('boardItemAt — which copper item covers a board point', () => {
  it('a pad by its shape, not the drill', () => {
    expect(tag(boardItemAt(board, { x: 8.7 * MM, y: 10 * MM }, 'F.Cu'))).toBe('pad:0:1');
    // through the 1 mm drill there is nothing
    expect(boardItemAt(board, { x: 8 * MM, y: 10 * MM }, 'F.Cu')).toBeNull();
    // the SMD pad is front-only
    expect(tag(boardItemAt(board, { x: 12 * MM, y: 10 * MM }, 'F.Cu'))).toBe('pad:0:2');
    expect(boardItemAt(board, { x: 12 * MM, y: 10 * MM }, 'B.Cu')).toBeNull();
  });

  it('a track within half its width, a via within its ring, a zone inside its fill', () => {
    expect(tag(boardItemAt(board, { x: 25 * MM, y: 20.2 * MM }, 'F.Cu'))).toBe(
      `track:${track.m_Uuid}`,
    );
    expect(boardItemAt(board, { x: 25 * MM, y: 20.3 * MM }, 'F.Cu')).toBeNull();
    // the track is F.Cu only
    expect(boardItemAt(board, { x: 25 * MM, y: 20 * MM }, 'B.Cu')).toBeNull();
    expect(tag(boardItemAt(board, { x: 25.3 * MM, y: 25 * MM }, 'B.Cu'))).toBe(`via:${via.m_Uuid}`);
    expect(boardItemAt(board, { x: 25.1 * MM, y: 25 * MM }, 'B.Cu')).toBeNull(); // the hole
    expect(tag(boardItemAt(board, { x: 20 * MM, y: 35 * MM }, 'B.Cu'))).toBe(
      `zone:${zone.m_Uuid}:B.Cu`,
    );
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
    expect(tag(item)).toBe(`track:${track.m_Uuid}`);
  });
  it('drops onto the front copper first when the camera is above', () => {
    // track at (25, 20) mm → 3D (2.5, −2.0)
    const item = pickBoardItem(board, frame, [2.5, -2.0, 16], [0, 0, -1], null);
    expect(tag(item)).toBe(`track:${track.m_Uuid}`);
  });
  it('sees the back zone from below, and nothing through the board from above', () => {
    expect(tag(pickBoardItem(board, frame, [2.0, -3.5, -16], [0, 0, 1], null))).toBe(
      `zone:${zone.m_Uuid}:B.Cu`,
    );
    // from above the ray lands on the mask/body over that point (an object
    // with no BOARD_ITEM) and stops: the back zone is not reached
    expect(pickBoardItem(board, frame, [2.0, -3.5, 16], [0, 0, -1], null)).toBeNull();
    // off the board entirely there is nothing on either face
    expect(pickBoardItem(board, frame, [9, 9, 16], [0, 0, -1], null)).toBeNull();
  });
  it('off the board, a model still counts', () => {
    expect(tag(pickBoardItem(board, frame, [9, 9, 16], [0, 0, -1], { t: 5, footprint: 0 }))).toBe(
      'footprint:0',
    );
  });
  it('a model hit nearer than the copper wins; a farther one loses', () => {
    expect(
      tag(pickBoardItem(board, frame, [2.5, -2.0, 16], [0, 0, -1], { t: 14, footprint: 0 })),
    ).toBe('footprint:0');
    expect(
      tag(pickBoardItem(board, frame, [2.5, -2.0, 16], [0, 0, -1], { t: 17, footprint: 0 })),
    ).toBe(`track:${track.m_Uuid}`);
  });
});

describe('the HOVERED_ITEM message', () => {
  it('"Pad %s\\tNet %s\\tNet class %s" for a pad, "REF  VALUE" for a model', () => {
    expect(
      hoveredItemMessage(board, { kind: 'pad', footprint: 0, pad: pads[0]! }, netClassOf),
    ).toBe('Pad 1\tNet GND\tNet class Default');
    expect(hoveredItemMessage(board, { kind: 'footprint', footprint: 0 }, netClassOf)).toBe(
      'R1  10k',
    );
    expect(hoveredItemMessage(board, { kind: 'via', via }, netClassOf)).toBe(
      'Net VCC\tNet class Default',
    );
    expect(hoveredItemMessage(board, { kind: 'zone', zone, layer: 'B.Cu' }, netClassOf)).toBe(
      'Zone pour\tNet GND\tNet class Default',
    );
    expect(hoveredItemMessage(board, null, netClassOf)).toBe('');
  });
});

describe('the click', () => {
  it('names the footprint for a model or pad hit and sends nothing for the rest', () => {
    expect(clickSelectionParts(board, { kind: 'pad', footprint: 0, pad: pads[1]! })).toEqual([
      'FR1',
    ]);
    expect(clickSelectionParts(board, { kind: 'footprint', footprint: 0 })).toEqual(['FR1']);
    expect(clickSelectionParts(board, { kind: 'track', track })).toEqual([]);
    expect(clickSelectionParts(board, null)).toEqual([]);
  });
});
