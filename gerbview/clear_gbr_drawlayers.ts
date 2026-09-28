// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/clear_gbr_drawlayers.cpp`: `GERBVIEW_FRAME::Clear_DrawLayers` and
 * `Erase_Current_DrawLayer`, bound on the frame (`gerbview_frame.ts`).
 *
 * `IsOK` is modal in the C++; here it is a promise, so both are async.
 */

import { IsOK } from '@ziroeda/common/confirm.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { GERBVIEW_FRAME } from './gerbview_frame.js';

export async function Clear_DrawLayers(this: GERBVIEW_FRAME, query: boolean): Promise<boolean> {
  if (this.GetGerberLayout() === null) return false;

  if (query && this.GetScreen()?.IsContentModified()) {
    if (!(await IsOK('Current data will be lost?'))) return false;
  }

  if (this.GetCanvas()) {
    this.GetToolManager()?.ResetTools(RESET_REASON.MODEL_RELOAD);

    this.GetCanvas()!.GetView().Clear();

    // Reinit the drawing-sheet view, cleared by GetView()->Clear():
    this.SetPageSettings(this.GetPageSettings());
  }

  this.GetImagesList().DeleteAllImages();

  this.GetGerberLayout().SetBoundingBox(new BOX2I());

  this.SetActiveLayer(0);
  this.ReFillLayerWidget();
  this.syncLayerBox();
  return true;
}

export async function Erase_Current_DrawLayer(this: GERBVIEW_FRAME, query: boolean): Promise<void> {
  const layer = this.GetActiveLayer();
  const msg = `Clear layer ${layer + 1}?`;

  if (query && !(await IsOK(msg))) return;

  this.GetToolManager()?.ResetTools(RESET_REASON.MODEL_RELOAD);

  this.RemapLayers(this.GetImagesList().RemoveImage(layer));

  this.ReFillLayerWidget();
  this.syncLayerBox();
  this.GetCanvas()?.Refresh();
}
