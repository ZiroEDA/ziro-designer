// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project/board_project_settings.h`: the enums the items read, and
 * the two structs `PROJECT_LOCAL_SETTINGS` carries per project.
 */

export enum HIGH_CONTRAST_MODE {
  NORMAL = 0, ///< Inactive layers are shown normally (no high-contrast mode)
  DIMMED = 1, ///< Inactive layers are dimmed (old high-contrast mode)
  HIDDEN = 2, ///< Inactive layers are hidden
}

///< Determine how zones should be displayed.
export enum ZONE_DISPLAY_MODE {
  SHOW_FILLED,
  SHOW_ZONE_OUTLINE,

  // Debug modes

  SHOW_FRACTURE_BORDERS,
  SHOW_TRIANGULATION,
}

///< Determine how net color overrides should be applied.
export enum NET_COLOR_MODE {
  OFF, ///< Net (and netclass) colors are not shown
  RATSNEST, ///< Net/netclass colors are shown on ratsnest lines only
  ALL, ///< Net/netclass colors are shown on all net copper
}

///< Determine how ratsnest lines are drawn.
export enum RATSNEST_MODE {
  ALL, ///< Ratsnest lines are drawn to items on all layers (default)
  VISIBLE, ///< Ratsnest lines are drawn to items on visible layers only
}

/**
 * `PCB_SELECTION_FILTER_OPTIONS`: the Selection Filter panel's twelve boxes.
 * Every one defaults on; the panel exists to turn things off.
 */
export class PCB_SELECTION_FILTER_OPTIONS {
  lockedItems = true; ///< Allow selecting locked items
  footprints = true; ///< Allow selecting entire footprints
  text = true; ///< Text (free or attached to a footprint)
  tracks = true; ///< Copper tracks
  vias = true; ///< Vias (all types)
  pads = true; ///< Footprint pads
  graphics = true; ///< Graphic lines, shapes, polygons
  zones = true; ///< Copper zones
  keepouts = true; ///< Keepout zones
  dimensions = true; ///< Dimension items
  points = true; ///< Points
  otherItems = true; ///< Anything not fitting one of the above categories

  /** `Any()`: true if any of the flags are set. */
  Any(): boolean {
    return (
      this.lockedItems ||
      this.footprints ||
      this.text ||
      this.tracks ||
      this.vias ||
      this.pads ||
      this.graphics ||
      this.zones ||
      this.keepouts ||
      this.dimensions ||
      this.points ||
      this.otherItems
    );
  }

  /** `All()`: true if all the flags are set. */
  All(): boolean {
    return (
      this.lockedItems &&
      this.footprints &&
      this.text &&
      this.tracks &&
      this.vias &&
      this.pads &&
      this.graphics &&
      this.zones &&
      this.keepouts &&
      this.dimensions &&
      this.points &&
      this.otherItems
    );
  }

  /** `SetDefaults()`: everything on. */
  SetDefaults(): void {
    this.lockedItems = true;
    this.footprints = true;
    this.text = true;
    this.tracks = true;
    this.vias = true;
    this.pads = true;
    this.graphics = true;
    this.zones = true;
    this.keepouts = true;
    this.dimensions = true;
    this.points = true;
    this.otherItems = true;
  }
}

/** `PANEL_NET_INSPECTOR_SETTINGS`: the Net Inspector's per-project state. */
export class PANEL_NET_INSPECTOR_SETTINGS {
  filter_text = '';
  filter_by_net_name = true;
  filter_by_netclass = true;
  group_by_netclass = false;
  group_by_constraint = false;
  custom_group_rules: string[] = [];
  show_zero_pad_nets = false;
  show_unconnected_nets = false;
  show_time_domain_details = false;
  sorting_column = -1;
  sort_order_asc = true;
  col_order: number[] = [];
  col_widths: number[] = [];
  col_hidden: boolean[] = [];
  expanded_rows: string[] = [];
}
