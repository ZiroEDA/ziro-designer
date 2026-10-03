// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic editor's canvas construction, as `SCH_EDIT_FRAME::SCH_EDIT_FRAME` makes it
 * (`m_canvasType = loadCanvasTypeSetting(); ... CreateCanvas()` on an SCH_DRAW_PANEL), and
 * `SCH_EDIT_FRAME::DisplayCurrentSheet`'s hand-over of the current screen to the view. The
 * window supplies the element; this is the frame's side, as pcb_canvas.ts is for pcbnew.
 */
import { drawPanelWindow } from '@ziroeda/common/gal/gal_window.js';
import { GAL_TYPE } from '@ziroeda/common/draw_panel_gal.js';
import { SCH_DRAW_PANEL } from './sch_draw_panel.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';

/**
 * The panel on the element, adopted by the frame as its canvas.
 *
 * @return the panel, or null when WebGL2 is unavailable (there is no Cairo on screen here;
 *         the window keeps its own drawing for that).
 */
export function createSchDrawPanel(
  aFrame: SCH_EDIT_FRAME,
  aCanvas: HTMLCanvasElement,
  aFontImage: ImageBitmap,
): SCH_DRAW_PANEL | null {
  const window = drawPanelWindow(aCanvas, aFontImage);

  let panel: SCH_DRAW_PANEL;

  try {
    panel = new SCH_DRAW_PANEL(aFrame, window, aFrame.GetGalDisplayOptions());
  } catch (err) {
    console.warn(`Could not use OpenGL: ${(err as Error).message}`);
    return null;
  }

  if (panel.GetBackend() !== GAL_TYPE.GAL_TYPE_OPENGL) {
    panel.Destroy();
    return null;
  }

  aFrame.SetCanvas(panel);

  return panel;
}

/**
 * `SCH_EDIT_FRAME::DisplayCurrentSheet` (sch_edit_frame.cpp), the view's half: the current
 * sheet's screen into the panel. Call it after the live schematic changes sheet or reloads.
 */
export function displayCurrentSheet(aFrame: SCH_EDIT_FRAME, aPanel: SCH_DRAW_PANEL): void {
  aPanel.DisplaySheet(aFrame.GetScreen());
}
