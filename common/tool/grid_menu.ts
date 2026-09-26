// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/grid_menu.cpp` + `include/tool/grid_menu.h`: `GRID_MENU`.
 *
 * Here: `BuildChoiceList`, the static the grid selector on every frame's
 * toolbar is filled from (`EDA_DRAW_FRAME::UpdateGridSelectBox`). The menu
 * itself - an ACTION_MENU of check items under "Grid" - comes with the
 * TOOL_MENU port; the context menus are not ACTION_MENUs yet.
 */

import type { EdaIuScale, EdaUnits } from '../eda_units.js';
import type { WINDOW_SETTINGS } from '../settings/app_settings.js';

/** What BuildChoiceList asks of `EDA_DRAW_FRAME`. */
export interface GRID_MENU_PARENT {
  GetIuScale(): EdaIuScale;
  GetUnitPair(): { primary: EdaUnits; secondary: EdaUnits };
}

export class GRID_MENU {
  static BuildChoiceList(
    aGridsList: string[],
    aCfg: WINDOW_SETTINGS,
    aParent: GRID_MENU_PARENT,
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
}
