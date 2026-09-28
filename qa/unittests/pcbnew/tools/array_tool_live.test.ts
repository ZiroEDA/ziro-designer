// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ARRAY_TOOL::onDialogClosed on a live PCB_SELECTION (array_tool.cpp:115-408)
 * and BOARD_REANNOTATE_TOOL::ReannotateDuplicates (board_reannotate_tool.cpp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ARRAY_CIRCULAR_OPTIONS, ARRAY_GRID_OPTIONS } from '@ziroeda/common/array_options.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  arraySpecFrom,
  DEFAULT_ARRAY_SETTINGS,
} from '@ziroeda/pcbnew/dialogs/dialog_create_array.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { ARRAY_TOOL } from '@ziroeda/pcbnew/tools/array_tool.js';
import { BOARD_REANNOTATE_TOOL } from '@ziroeda/pcbnew/tools/board_reannotate_tool.js';
import { PCB_SELECTION } from '@ziroeda/pcbnew/tools/pcb_selection.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const P = (x: number, y: number) => ({ x: MM(x), y: MM(y) });
const FP_UUID = '80000000-0000-4000-8000-000000000001';
const TRACK_UUID = '80000000-0000-4000-8000-000000000011';

let board: BOARD;
let frame: TEST_PCB_FRAME;
const fps = (): FOOTPRINT[] => board.Footprints();
const original = (): FOOTPRINT => fps().find((f) => f.m_Uuid === FP_UUID)!;
const tracks = (): PCB_TRACK[] => board.Tracks() as PCB_TRACK[];
const sel = (...items: Parameters<PCB_SELECTION['Add']>[0][]) => {
  const s = new PCB_SELECTION();
  for (const i of items) s.Add(i);
  return s;
};
const grid = (nx: number, ny: number, dx: number, dy: number) => {
  const g = new ARRAY_GRID_OPTIONS();
  g.m_nx = nx;
  g.m_ny = ny;
  g.m_delta = P(dx, dy);
  g.SetSShouldReannotateFootprints(true);
  return g;
};

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
  (footprint "Lib:R" (layer "F.Cu") (uuid "${FP_UUID}") (at 10 10)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (hide yes) (uuid "80000000-0000-4000-8000-000000000002"))
    (pad "1" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (uuid "80000000-0000-4000-8000-000000000003")))
  (segment (start 0 0) (end 2 0) (width 0.2) (layer "F.Cu") (net 0) (uuid "${TRACK_UUID}")))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('ARRAY_TOOL::onDialogClosed', () => {
  it('lays a grid of copies; the original takes the last position', () => {
    new ARRAY_TOOL(frame).onDialogClosed(sel(tracks()[0]!), grid(3, 1, 5, 0));
    const starts = tracks().map((t) => t.GetStart());
    expect(starts).toHaveLength(3);
    expect(starts).toContainEqual(P(0, 0));
    expect(starts).toContainEqual(P(5, 0));
    expect(starts).toContainEqual(P(10, 0));
    // Walked in reverse: the original gets array position 2 (:224-231).
    const orig = tracks().find((t) => t.m_Uuid === TRACK_UUID)!;
    expect(orig.GetStart()).toEqual(P(10, 0));
    expect(new Set(tracks().map((t) => t.m_Uuid)).size).toBe(3);
  });

  it('is one undo step, "Create Array"', () => {
    new ARRAY_TOOL(frame).onDialogClosed(sel(tracks()[0]!), grid(2, 2, 5, 5));
    expect(tracks()).toHaveLength(4);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(tracks()).toHaveLength(1);
    expect(tracks()[0]!.GetStart()).toEqual(P(0, 0));
  });

  it('returns the added items, then the originals', () => {
    const t = tracks()[0]!;
    const out = new ARRAY_TOOL(frame).onDialogClosed(sel(t), grid(3, 1, 5, 0));
    // The originals come twice: as the last block's items and again after it (:388-392).
    expect(out).toHaveLength(4);
    expect(out[2]).toBe(t);
    expect(out[3]).toBe(t);
  });

  it('a selected pad stands for its footprint', () => {
    const pad = original().Pads()[0]!;
    new ARRAY_TOOL(frame).onDialogClosed(sel(pad), grid(1, 2, 0, 5));
    expect(fps()).toHaveLength(2);
    expect(fps().map((f) => f.GetPosition())).toEqual(
      expect.arrayContaining([P(10, 10), P(10, 15)]),
    );
  });

  it('reannotates every block but the first processed, as upstream', () => {
    new ARRAY_TOOL(frame).onDialogClosed(sel(original()), grid(3, 1, 5, 0));
    // Reverse walk: block 2 (copy at position 0, not reannotated) keeps R1; block 1 climbs
    // past the board's R1 to R2; the original, clashing with block 2's R1,
    // climbs past R2 to R3 (array_tool.cpp:373-379).
    const refAt = (x: number) =>
      fps()
        .find((f) => f.GetPosition().x === MM(x))!
        .GetReference();
    expect(refAt(10)).toBe('R1');
    expect(refAt(15)).toBe('R2');
    expect(refAt(20)).toBe('R3');
    expect(original().GetPosition()).toEqual(P(20, 10));
  });

  it('keeps references with reannotation off', () => {
    const g = grid(3, 1, 5, 0);
    g.SetSShouldReannotateFootprints(false);
    new ARRAY_TOOL(frame).onDialogClosed(sel(original()), g);
    expect(fps().map((f) => f.GetReference())).toEqual(['R1', 'R1', 'R1']);
  });

  it('turns each copy about its own position on a circle', () => {
    const c = new ARRAY_CIRCULAR_OPTIONS();
    c.m_nPts = 4;
    c.m_centre = P(-10, 0);
    c.m_angle = new EDA_ANGLE(90);
    c.m_rotateItems = true;
    new ARRAY_TOOL(frame).onDialogClosed(sel(tracks()[0]!), c);
    expect(tracks()).toHaveLength(4);
    // Every start sits 10 mm from the centre, and each track turned with its
    // position: start (0, 0) -> end (2, 0) is a fifth of centre -> start.
    const quadrants = new Set<string>();
    for (const t of tracks()) {
      const v = { x: t.GetStart().x + MM(10), y: t.GetStart().y };
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(MM(10), -1);
      expect(t.GetEnd().x - t.GetStart().x).toBeCloseTo(v.x / 5, -1);
      expect(t.GetEnd().y - t.GetStart().y).toBeCloseTo(v.y / 5, -1);
      quadrants.add(`${Math.sign(Math.round(v.x / 1000))},${Math.sign(Math.round(v.y / 1000))}`);
    }
    expect(quadrants.size).toBe(4);
  });

  it('arranges the selection instead of copying it', () => {
    const g = grid(3, 1, 5, 0);
    g.SetShouldArrangeSelection(true);
    const t = tracks()[0]!;
    // Selection order: the footprint first, then the track.
    new ARRAY_TOOL(frame).onDialogClosed(sel(original(), t), g);
    expect(fps()).toHaveLength(1);
    expect(tracks()).toHaveLength(1);
    // Both start from the first item's position; item n takes array position n.
    expect(original().GetPosition()).toEqual(P(10, 10));
    expect(t.GetPosition()).toEqual(P(15, 10));
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it('the dialog settings default to reannotating and copying', () => {
    const spec = arraySpecFrom(DEFAULT_ARRAY_SETTINGS);
    expect(spec.ShouldReannotateFootprints()).toBe(true);
    expect(spec.ShouldArrangeSelection()).toBe(false);
    const flipped = arraySpecFrom({
      ...DEFAULT_ARRAY_SETTINGS,
      arrangeSelection: true,
      reannotateFootprints: false,
    });
    expect(flipped.ShouldReannotateFootprints()).toBe(false);
    expect(flipped.ShouldArrangeSelection()).toBe(true);
  });
});

describe('BOARD_REANNOTATE_TOOL::ReannotateDuplicates', () => {
  it('leaves a unique reference alone', () => {
    new BOARD_REANNOTATE_TOOL(board).ReannotateDuplicates(sel(original()), []);
    expect(original().GetReference()).toBe('R1');
  });

  it('climbs past references held by the additional footprints', () => {
    const extra = original().Duplicate(false) as FOOTPRINT;
    extra.SetReference('R2');
    const dup = original().Duplicate(false) as FOOTPRINT;
    new BOARD_REANNOTATE_TOOL(board).ReannotateDuplicates(sel(dup), [extra]);
    // R1 is the board's, R2 the additional footprint's.
    expect(dup.GetReference()).toBe('R3');
  });

  it('numbers an unnumbered duplicate from 1', () => {
    original().SetReference('R');
    const dup = original().Duplicate(false) as FOOTPRINT;
    new BOARD_REANNOTATE_TOOL(board).ReannotateDuplicates(sel(dup), []);
    expect(dup.GetReference()).toBe('R1');
  });

  it('sorts the selection by reference first', () => {
    const extra = original().Duplicate(false) as FOOTPRINT;
    extra.SetReference('R2');
    const a = original().Duplicate(false) as FOOTPRINT;
    const b = original().Duplicate(false) as FOOTPRINT;
    a.SetReference('R2');
    // b (R1) sorts first: R1 -> R2 (taken) -> R3; then a: R2 -> R3 (b's) -> R4.
    new BOARD_REANNOTATE_TOOL(board).ReannotateDuplicates(sel(a, b), [extra]);
    expect(b.GetReference()).toBe('R3');
    expect(a.GetReference()).toBe('R4');
  });

  it('sorts the selection by reference, then y descending', () => {
    const a = original().Duplicate(false) as FOOTPRINT;
    const b = original().Duplicate(false) as FOOTPRINT;
    a.SetPosition(P(0, 0));
    b.SetPosition(P(0, 5));
    new BOARD_REANNOTATE_TOOL(board).ReannotateDuplicates(sel(a, b), []);
    // b (larger y) goes first and takes R2.
    expect(b.GetReference()).toBe('R2');
    expect(a.GetReference()).toBe('R3');
  });
});
