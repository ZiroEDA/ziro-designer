// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/grid_menu.cpp` + `include/tool/grid_menu.h`: `GRID_MENU`, the
 * "Grid" submenu every draw frame's context menu carries - Grid Origin, then
 * one check item per grid - and `BuildChoiceList`, which the toolbar's grid
 * selector is filled from too.
 */

import { BITMAPS } from '../bitmaps_list.js';
import type { EdaIuScale, EdaUnits } from '../eda_units.js';
import { main_id } from '../id.js';
import type { APP_SETTINGS_BASE, WINDOW_SETTINGS } from '../settings/app_settings.js';
import { wxItemKind, type wxMenuEvent } from '../wx/menu.js';
import { ACTION_MENU } from './action_menu.js';
import { ACTIONS } from './actions.js';
import type { TOOL_EVENT } from './tool_event.js';

/** What GRID_MENU asks of `EDA_DRAW_FRAME`. */
export interface GRID_MENU_PARENT {
  GetIuScale(): EdaIuScale;
  GetUnitPair(): { primary: EdaUnits; secondary: EdaUnits };
  GetWindowSettings(aCfg: APP_SETTINGS_BASE): WINDOW_SETTINGS;
  config(): APP_SETTINGS_BASE | null;
}

export class GRID_MENU extends ACTION_MENU {
  private m_parent: GRID_MENU_PARENT;

  constructor(aParent: GRID_MENU_PARENT) {
    super(true);
    this.m_parent = aParent;

    this.UpdateTitle();
    this.SetIcon(BITMAPS.grid_select);
    this.update();
  }

  override UpdateTitle(): void {
    this.SetTitle('Grid');
  }

  static BuildChoiceList(
    aGridsList: string[],
    aCfg: WINDOW_SETTINGS,
    aParent: Pick<GRID_MENU_PARENT, 'GetIuScale' | 'GetUnitPair'>,
  ): void {
    const scale = aParent.GetIuScale();
    const { primary: primaryUnit, secondary: secondaryUnit } = aParent.GetUnitPair();

    for (const gridSize of aCfg.grid.grids) {
      let name = '';

      if (gridSize.name !== '') name = `${gridSize.name}: `;

      const msg = `${name}${gridSize.MessageText(scale, primaryUnit, true)} (${gridSize.MessageText(scale, secondaryUnit, true)})`;

      aGridsList.push(msg);
    }
  }

  protected override create(): ACTION_MENU {
    return new GRID_MENU(this.m_parent);
  }

  protected override eventHandler(aEvent: wxMenuEvent): TOOL_EVENT | null {
    const event = ACTIONS.gridPreset.MakeEvent();
    event.SetParameter<number>(aEvent.GetId() - main_id.ID_POPUP_GRID_START);
    return event;
  }

  protected override update(): void {
    const cfg = this.m_parent.GetWindowSettings(this.m_parent.config()!);
    const current = cfg.grid.last_size_idx + main_id.ID_POPUP_GRID_START;
    const gridsList: string[] = [];
    let i = main_id.ID_POPUP_GRID_START;

    GRID_MENU.BuildChoiceList(gridsList, cfg, this.m_parent);

    while (this.GetMenuItemCount() > 0) this.Delete(this.FindItemByPosition(0));

    this.Add(ACTIONS.gridOrigin);
    this.AppendSeparator();

    for (const grid of gridsList) {
      const idx = i++;
      this.Append(idx, grid, '', wxItemKind.wxITEM_CHECK).Check(idx === current);
    }
  }
}
