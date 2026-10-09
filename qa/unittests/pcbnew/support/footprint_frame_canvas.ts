// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The harness's stub canvas on a FOOTPRINT_EDIT_FRAME, which KiCad's frame
 * always has: a zoom to fit asks its view, PlaceFootprint its view controls.
 * `DisplayBoard` puts a new board's items in that view, as
 * PCB_DRAW_PANEL_GAL's does.
 */
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { type HARNESS_MOUSE, harnessCanvas } from './pcb_tool_harness.js';

export function attachFootprintFrameCanvas(aFrame: FOOTPRINT_EDIT_FRAME): void {
  const { view, controls } = harnessCanvas(aFrame.GetBoard()!, aFrame, {
    mouse: { x: 0, y: 0 },
    forced: null,
    shape: null,
  } as unknown as HARNESS_MOUSE);
  const canvas = aFrame.GetCanvas() as unknown as Record<string, unknown>;
  const withCrossHair = Object.assign(controls, { SetCrossHairCursorPosition: () => {} });
  canvas.GetViewControls = () => withCrossHair;
  canvas.DisplayBoard = (aBoard: BOARD) => {
    view.Clear();
    for (const item of aBoard.GetItemSet()) view.Add(item);
  };
  canvas.UpdateColors = () => {};
  // PCB_DRAW_PANEL_GAL::GetDefaultViewBBox: the footprint editor has no sheet to fit.
  canvas.GetDefaultViewBBox = () => null;
  aFrame.SetBoard(aFrame.GetBoard());
  aFrame
    .GetToolManager()!
    .SetEnvironment(aFrame.GetBoard(), view, withCrossHair, aFrame.config(), aFrame);
}
