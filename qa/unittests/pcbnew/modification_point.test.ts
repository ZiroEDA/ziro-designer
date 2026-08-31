// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What Rotate and Mirror turn the selection about.
 *
 * The report was "our footprint rotates around its centre but KiCad's rotates
 * around its origin". It does — `EDIT_TOOL::updateModificationPoint`
 * (edit_tool.cpp:3375-3417):
 *
 *     // When there is only one item selected, the reference point is its position...
 *     if( aSelection.Size() == 1 && aSelection.Front()->Type() != PCB_TABLE_T )
 *         aSelection.SetReferencePoint( item->GetPosition() );
 *     // ...otherwise modify items with regard to the grid-snapped center position
 *     else
 *         aSelection.SetReferencePoint( grid.BestSnapAnchor( aSelection.GetCenter(), nullptr ) );
 *
 * and `FOOTPRINT::GetPosition()` is `m_pos` (footprint.h:347), the origin cross
 * the editor draws on the part — not the middle of a bounding box that the
 * silkscreen and courtyard both grow. Rotating about the box centre translates
 * the part by half the offset between the two on every single R, by a different
 * amount for every footprint, which is why a rotated part walks off its pads.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  boardItemPosition,
  boardSelectionBBox,
  modificationPoint,
  rotateBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';

const MM = 1e6;

/**
 * One footprint whose origin is deliberately *not* the centre of its box: pad 1
 * sits on the origin, pad 2 is 5 mm below it, and the silkscreen reaches
 * further down still. Exactly the shape of the diodes in the report.
 */
const board = readBoard(
  parse(`(kicad_pcb (version 20241229) (generator "test")
	(layers (0 "F.Cu" signal) (31 "B.Cu" signal) (37 "F.SilkS" user))
	(net 0 "") (net 1 "a")
	(footprint "D_DO-41" (layer "F.Cu") (at 100 100)
		(pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu") (net 1))
		(pad "2" thru_hole circle (at 0 5) (size 1.6 1.6) (drill 0.8) (layers "*.Cu"))
		(fp_line (start -1 -1) (end -1 8) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
	)
	(footprint "R_0805" (layer "F.Cu") (at 130 100)
		(pad "1" smd roundrect (at -1 0) (size 1.2 1.4) (layers "F.Cu") (roundrect_rratio 0.25))
		(pad "2" smd roundrect (at 1 0) (size 1.2 1.4) (layers "F.Cu") (roundrect_rratio 0.25))
	)
	(segment (start 10 10) (end 30 10) (width 0.25) (layer "F.Cu") (net 1))
	(gr_rect (start 50 50) (end 60 56) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
	(gr_line (start 70 70) (end 80 75) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
)`),
);

const D1 = board.footprints[0]!;

describe('the premise: a footprint origin is not its box centre', () => {
  it('D1 sits at its pad 1, and its box is centred 3.5 mm below', () => {
    expect(D1.at).toEqual({ x: 100 * MM, y: 100 * MM });
    const b = boardSelectionBBox(board, new Set(['footprint:0']))!;
    expect((b.minY + b.maxY) / 2).not.toBe(D1.at.y);
    // The silkscreen is what put it there — the part is not symmetric about
    // its anchor, and almost none are.
    expect((b.minY + b.maxY) / 2).toBe(103.5 * MM);
  });
});

describe('modificationPoint — EDIT_TOOL::updateModificationPoint', () => {
  it('is a lone footprint’s own origin', () => {
    expect(modificationPoint(board, new Set(['footprint:0']))).toEqual(D1.at);
    expect(modificationPoint(board, new Set(['footprint:1']))).toEqual({
      x: 130 * MM,
      y: 100 * MM,
    });
  });

  it("is a lone track's start, not the middle of it", () => {
    // `PCB_TRACK::GetPosition()` is `m_Start` (pcb_track.h:87).
    expect(modificationPoint(board, new Set(['track:0']))).toEqual({ x: 10 * MM, y: 10 * MM });
  });

  it('is a lone rectangle’s centre, which upstream overrides it to', () => {
    // "Some PCB_SHAPE must be rotated around their center instead of their
    // start point in order to stay to the same place (at least RECT and POLY)"
    // (edit_tool.cpp:2289-2301).
    expect(modificationPoint(board, new Set(['shape:0']))).toEqual({ x: 55 * MM, y: 53 * MM });
    // …and a plain line is still its start point.
    expect(modificationPoint(board, new Set(['shape:1']))).toEqual({ x: 70 * MM, y: 70 * MM });
  });

  it('is the box centre once more than one item is selected', () => {
    const many = new Set(['footprint:0', 'footprint:1']);
    const b = boardSelectionBBox(board, many)!;
    expect(modificationPoint(board, many)).toEqual({
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
    });
  });

  it('snaps that centre, and only that centre', () => {
    // `grid.BestSnapAnchor( refPt, nullptr )` is in the multi-item branch only;
    // a single item's own position is used raw, or a part could never be
    // rotated in place at all.
    const snap = (): { x: number; y: number } => ({ x: -1, y: -1 });
    expect(modificationPoint(board, new Set(['footprint:0']), snap)).toEqual(D1.at);
    expect(modificationPoint(board, new Set(['footprint:0', 'track:0']), snap)).toEqual({
      x: -1,
      y: -1,
    });
  });

  it('has nothing to say about an empty selection', () => {
    expect(modificationPoint(board, new Set())).toBeNull();
  });
});

describe('rotating a footprint about it', () => {
  it('leaves the origin exactly where it was', () => {
    const at = modificationPoint(board, new Set(['footprint:0'])) ?? undefined;
    const r = rotateBoardItems(board, new Set(['footprint:0']), true, at);
    expect(r.footprints[0]!.at).toEqual(D1.at);
    expect(r.footprints[0]!.angle).toBe(90);
    // Pad 1 is on the origin and stays put; pad 2 swings round to its side.
    expect(r.footprints[0]!.pads[0]!.at).toEqual({ x: 100 * MM, y: 100 * MM });
    expect(r.footprints[0]!.pads[1]!.at).toEqual({ x: 105 * MM, y: 100 * MM });
  });

  it('and four turns put every child back', () => {
    let r = board;
    for (let i = 0; i < 4; i++) {
      const at = modificationPoint(r, new Set(['footprint:0'])) ?? undefined;
      r = rotateBoardItems(r, new Set(['footprint:0']), true, at);
    }
    expect(r.footprints[0]!.at).toEqual(D1.at);
    expect(r.footprints[0]!.angle).toBe(0);
    expect(r.footprints[0]!.pads[1]!.at).toEqual(D1.pads[1]!.at);
  });

  it('the box centre would have walked the part instead', () => {
    // What we shipped: the same rotation about the bounding-box centre. The
    // origin moves 3.5 mm on the first turn alone, and the part keeps walking.
    const b = boardSelectionBBox(board, new Set(['footprint:0']))!;
    const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const r = rotateBoardItems(board, new Set(['footprint:0']), true, centre);
    const moved = r.footprints[0]!.at;
    expect(moved).not.toEqual(D1.at);
    // Its own silkscreen is what dragged it: the origin is 3.6 mm from the box
    // centre, so one turn about that centre throws the part that far across the
    // board — and the next turn throws it somewhere else again.
    expect(Math.hypot(moved.x - D1.at.x, moved.y - D1.at.y)).toBeGreaterThan(3 * MM);
  });
});

describe('boardItemPosition — BOARD_ITEM::GetPosition per type', () => {
  it('answers per type, and null for an id the board has not got', () => {
    expect(boardItemPosition(board, 'footprint:0')).toEqual(D1.at);
    expect(boardItemPosition(board, 'pad:0:1')).toEqual({ x: 100 * MM, y: 105 * MM });
    expect(boardItemPosition(board, 'track:0')).toEqual({ x: 10 * MM, y: 10 * MM });
    expect(boardItemPosition(board, 'footprint:99')).toBeNull();
    expect(boardItemPosition(board, 'not-an-id')).toBeNull();
  });
});
