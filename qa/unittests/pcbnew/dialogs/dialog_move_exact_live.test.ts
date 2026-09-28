// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EDIT_TOOL::MoveExact's OK branch on a live PCB_SELECTION (edit_tool.cpp).
 *
 * Rotation expectations use KiCad's RotatePoint: +90 degrees takes (1, 0) to
 * (0, -1) in the y-down board frame.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { moveExactOnSelection } from '@ziroeda/pcbnew/dialogs/dialog_move_exact.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { PCB_SELECTION } from '@ziroeda/pcbnew/tools/pcb_selection.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const P = (x: number, y: number) => ({ x: MM(x), y: MM(y) });

let board: BOARD;
let frame: TEST_PCB_FRAME;
const track = (i = 0): PCB_TRACK => board.Tracks()[i]! as PCB_TRACK;
const fp = (): FOOTPRINT => board.Footprints()[0]!;
const sel = (...items: Parameters<PCB_SELECTION['Add']>[0][]) => {
  const s = new PCB_SELECTION();
  for (const i of items) s.Add(i);
  return s;
};

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
  (footprint "Lib:R" (layer "F.Cu") (uuid "70000000-0000-4000-8000-000000000001") (at 50 50)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (hide yes) (uuid "70000000-0000-4000-8000-000000000002"))
    (pad "1" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (uuid "70000000-0000-4000-8000-000000000003")))
  (segment (start 0 0) (end 10 0) (width 0.2) (layer "F.Cu") (net 0) (uuid "70000000-0000-4000-8000-000000000011"))
  (segment (start 0 20) (end 10 20) (width 0.2) (layer "F.Cu") (net 0) (uuid "70000000-0000-4000-8000-000000000012")))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('EDIT_TOOL::MoveExact on the live selection', () => {
  it('moves, then turns each item about its own anchor', () => {
    moveExactOnSelection(frame, sel(track()), P(5, 5), new EDA_ANGLE(90), 'itemAnchor');
    // Anchor is the moved start (5, 5); the end (15, 5) swings to (5, -5).
    expect(track().GetStart()).toEqual(P(5, 5));
    expect(track().GetEnd()).toEqual(P(5, -5));
  });

  it('turns the selection about its centre, advanced by the translation', () => {
    const t0 = track(0);
    const t1 = track(1);
    // Centre of the two tracks' boxes: (5, 10); after the move (5, 10) + (0, 10).
    moveExactOnSelection(frame, sel(t0, t1), P(0, 10), new EDA_ANGLE(180), 'selectionCenter');
    // (0, 10) and (10, 10) turned 180 about (5, 20): (10, 30) and (0, 30).
    expect(t0.GetStart()).toEqual(P(10, 30));
    expect(t0.GetEnd()).toEqual(P(0, 30));
    expect(t1.GetStart()).toEqual(P(10, 10));
    expect(t1.GetEnd()).toEqual(P(0, 10));
  });

  it('turns about the aux origin', () => {
    board.GetDesignSettings().SetAuxOrigin(P(0, 10));
    moveExactOnSelection(frame, sel(track()), P(0, 0), new EDA_ANGLE(90), 'auxOrigin');
    // (0, 0) about (0, 10): (-10, 10); (10, 0): (-10, 0).
    expect(track().GetStart()).toEqual(P(-10, 10));
    expect(track().GetEnd()).toEqual(P(-10, 0));
  });

  it('turns about the frame local origin', () => {
    // PCB_EDIT_FRAME's constructor: SetScreen( new PCB_SCREEN( page size ) ).
    frame.SetScreen(new PCB_SCREEN(P(297, 210)));
    frame.GetScreen()!.m_LocalOrigin = P(10, 0);
    moveExactOnSelection(frame, sel(track()), P(0, 0), new EDA_ANGLE(90), 'userOrigin');
    // (0, 0) about (10, 0): (10, 10).
    expect(track().GetStart()).toEqual(P(10, 10));
    expect(track().GetEnd()).toEqual(P(10, 0));
  });

  it('does not move a pad twice when its footprint is selected too', () => {
    const pad = fp().Pads()[0]!;
    moveExactOnSelection(frame, sel(fp(), pad), P(3, 0), new EDA_ANGLE(0), 'itemAnchor');
    expect(fp().GetPosition()).toEqual(P(53, 50));
    expect(pad.GetPosition()).toEqual(P(54, 50));
  });

  it('moves a lone pad', () => {
    const pad = fp().Pads()[0]!;
    moveExactOnSelection(frame, sel(pad), P(3, 0), new EDA_ANGLE(0), 'itemAnchor');
    expect(fp().GetPosition()).toEqual(P(50, 50));
    expect(pad.GetPosition()).toEqual(P(54, 50));
  });

  it('is one undo step', () => {
    moveExactOnSelection(frame, sel(track(0), track(1)), P(1, 1), new EDA_ANGLE(0), 'itemAnchor');
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    const starts = board.Tracks().map((t) => (t as PCB_TRACK).GetStart());
    expect(starts).toContainEqual(P(0, 0));
    expect(starts).toContainEqual(P(0, 20));
  });

  it('does nothing on an empty selection', () => {
    moveExactOnSelection(frame, sel(), P(1, 1), new EDA_ANGLE(0), 'itemAnchor');
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});
