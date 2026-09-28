// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/events_called_functions.cpp`: the frame's toolbar event handlers,
 * bound on the frame (`gerbview_frame.ts`). The event table and the file
 * history handlers are the page's menus; OnQuit is the browser tab.
 *
 * The four TOP_AUX highlights are four fields of the render settings, each
 * set by its own box, so a net and a D-code can be highlighted at once.
 */

import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { wxChoice } from '@ziroeda/common/wx/choice.js';
import type { GERBVIEW_FRAME } from './gerbview_frame.js';
import type { GERBVIEW_PAINTER, GERBVIEW_RENDER_SETTINGS } from './gerbview_painter.js';

function renderSettings(aFrame: GERBVIEW_FRAME): GERBVIEW_RENDER_SETTINGS {
  return (aFrame.GetCanvas()!.GetView().GetPainter() as GERBVIEW_PAINTER).GetSettings();
}

/**
 * Handle the changed selection of the component, net and aperture-attribute
 * choice boxes.
 */
export function OnSelectHighlightChoice(this: GERBVIEW_FRAME, aBox: wxChoice): void {
  const settings = renderSettings(this);

  if (aBox === this.m_SelComponentBox)
    settings.m_componentHighlightString = aBox.GetStringSelection();
  else if (aBox === this.m_SelNetnameBox) settings.m_netHighlightString = aBox.GetStringSelection();
  else if (aBox === this.m_SelAperAttributesBox)
    settings.m_attributeHighlightString = aBox.GetStringSelection();

  this.GetCanvas()!.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.COLOR);
  this.GetCanvas()!.Refresh();
}

/**
 * Select the active DCode for the current active layer. Items using this
 * DCode are highlighted.
 */
export function OnSelectActiveDCode(this: GERBVIEW_FRAME): void {
  const gerber_image = this.GetGbrImage(this.GetActiveLayer());

  if (gerber_image) {
    const d_code = this.m_DCodeSelector!.GetSelectedDCodeId();

    const settings = renderSettings(this);
    gerber_image.m_Selected_Tool = d_code;
    settings.m_dcodeHighlightValue = d_code;

    this.GetCanvas()!.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.COLOR);
    this.GetCanvas()!.Refresh();
  }
}

/**
 * Select the active layer:
 *  - if a file is loaded, it is loaded in this layer
 *  _ this layer is displayed on top of other layers
 */
export function OnSelectActiveLayer(this: GERBVIEW_FRAME, aSelection: number): void {
  this.SetActiveLayer(aSelection, true);

  // Rebuild the DCode list in toolbar (but not the Layer Box) after change
  this.syncLayerBox(false);

  // Reinit highlighted dcode
  const settings = renderSettings(this);
  const dcodeSelected = this.m_DCodeSelector!.GetSelectedDCodeId();
  settings.m_dcodeHighlightValue = dcodeSelected;
  this.GetCanvas()!.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.COLOR);
  this.GetCanvas()!.Refresh();
}
