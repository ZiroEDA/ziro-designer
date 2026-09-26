// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/settings/grid_settings.h` + `common/settings/grid_settings.cpp`:
 * one grid entry and the per-window grid settings block.
 */
import type { EdaIuScale, EdaUnits } from '../eda_units.js';

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
   *
   * Pending (#636 stage 6): `EDA_UNIT_UTILS::UI::DoubleValueFromString` is not
   * in common yet (the designer's `unit_binder.ts` carries it); the designer's
   * `gridMessageText` renders this row until it moves.
   */
  MessageText(_aScale: EdaIuScale, _aUnits: EdaUnits, _aDisplayUnits = true): string {
    throw new Error('GRID::MessageText: pending (#636 stage 6)');
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
