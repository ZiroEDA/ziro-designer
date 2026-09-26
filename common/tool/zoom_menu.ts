// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/zoom_menu.cpp` + `include/tool/zoom_menu.h`: `ZOOM_MENU`, the
 * "Zoom" submenu every draw frame's context menu carries - one check item per
 * zoom preset, the one within 10 % of the current zoom checked.
 */

import { BITMAPS } from '../bitmaps_list.js';
import { main_id } from '../id.js';
import type { APP_SETTINGS_BASE } from '../settings/app_settings.js';
import { wxItemKind, type wxMenuEvent } from '../wx/menu.js';
import { ACTION_MENU } from './action_menu.js';
import { ACTIONS } from './actions.js';
import type { TOOL_EVENT } from './tool_event.js';

/** What ZOOM_MENU asks of `EDA_DRAW_FRAME`. */
export interface ZOOM_MENU_PARENT {
  config(): APP_SETTINGS_BASE | null;
  GetCanvas(): { GetGAL(): { GetZoomFactor(): number } | null } | null;
}

export class ZOOM_MENU extends ACTION_MENU {
  private m_parent: ZOOM_MENU_PARENT;

  constructor(aParent: ZOOM_MENU_PARENT) {
    super(true);
    this.m_parent = aParent;

    this.UpdateTitle();
    this.SetIcon(BITMAPS.zoom_selection);
  }

  override UpdateTitle(): void {
    this.SetTitle('Zoom');
  }

  protected override create(): ACTION_MENU {
    return new ZOOM_MENU(this.m_parent);
  }

  protected override eventHandler(aEvent: wxMenuEvent): TOOL_EVENT | null {
    const event = ACTIONS.zoomPreset.MakeEvent();
    event.SetParameter<number>(aEvent.GetId() - main_id.ID_POPUP_ZOOM_LEVEL_START);
    return event;
  }

  protected override update(): void {
    this.Clear();

    let ii = main_id.ID_POPUP_ZOOM_LEVEL_START + 1; // 0 reserved for menus which support auto-zoom

    const zoomList = this.m_parent.config()!.m_Window.zoom_factors;

    for (const factor of zoomList)
      this.Append(ii++, `Zoom: ${factor.toFixed(2)}`, '', wxItemKind.wxITEM_CHECK);

    const zoom = this.m_parent.GetCanvas()!.GetGAL()!.GetZoomFactor();

    for (let jj = 0; jj < zoomList.length; ++jj) {
      // Search for a value near the current zoom setting:
      const rel_error = Math.abs(zoomList[jj]! - zoom) / zoom;

      // IDs start with 1 (leaving 0 for auto-zoom)
      this.Check(main_id.ID_POPUP_ZOOM_LEVEL_START + jj + 1, rel_error < 0.1);
    }
  }
}
