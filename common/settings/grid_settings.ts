// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/settings/grid_settings.h` + `common/settings/grid_settings.cpp`:
 * one grid entry and the per-window grid settings block.
 */
import {
  DoubleValueFromStringIn,
  type EdaIuScale,
  type EdaUnits,
  messageTextFromValue,
} from '../eda_units.js';

export class GRID {
  name: string;
  x: string;
  y: string;

  constructor(name = '', x = '', y = '') {
    this.name = name;
    this.x = x;
    this.y = y;
  }

  /** `GRID::operator==`: all three fields. */
  equals(aOther: GRID): boolean {
    return this.x === aOther.x && this.y === aOther.y && this.name === aOther.name;
  }

  /**
   * Returns a string representation of the grid in specified units.
   * Will reduce to a single dimension if the grid is square.
   */
  MessageText(aScale: EdaIuScale, aUnits: EdaUnits, aDisplayUnits = true): string {
    const type = 'distance';

    const xStr = messageTextFromValue(
      aScale,
      aUnits,
      DoubleValueFromStringIn(aScale, 'mm', this.x, type),
      aDisplayUnits,
    );
    const yStr = messageTextFromValue(
      aScale,
      aUnits,
      DoubleValueFromStringIn(aScale, 'mm', this.y, type),
      aDisplayUnits,
    );

    if (xStr === yStr) return xStr;

    return `${xStr} x ${yStr}`;
  }

  UserUnitsMessageText(
    aProvider: { GetIuScale(): EdaIuScale; GetUserUnits(): EdaUnits },
    aDisplayUnits = true,
  ): string {
    return this.MessageText(aProvider.GetIuScale(), aProvider.GetUserUnits(), aDisplayUnits);
  }

  /** `GRID::ToDouble`: the size in internal units. */
  ToDouble(aScale: EdaIuScale): { x: number; y: number } {
    return {
      x: DoubleValueFromStringIn(aScale, 'mm', this.x),
      y: DoubleValueFromStringIn(aScale, 'mm', this.y),
    };
  }
}

/** `operator<( const GRID&, const GRID& )`: by name. */
export function gridLess(lhs: GRID, rhs: GRID): boolean {
  return lhs.name < rhs.name;
}

export class GRID_SETTINGS {
  axes_enabled = false;
  grids: GRID[] = [];
  user_grid_x = '';
  user_grid_y = '';
  last_size_idx = 0;
  fast_grid_1 = 0;
  fast_grid_2 = 0;
  line_width = 1.0;
  min_spacing = 10;
  show = true;
  style = 0;
  snap = 0;
  force_component_snap = false;
  overrides_enabled = false;
  override_connected = false;
  override_connected_idx = 0;
  override_wires = false;
  override_wires_idx = 0;
  override_vias = false;
  override_vias_idx = 0;
  override_text = false;
  override_text_idx = 0;
  override_graphics = false;
  override_graphics_idx = 0;
}
