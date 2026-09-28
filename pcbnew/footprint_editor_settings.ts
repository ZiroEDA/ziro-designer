// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDITOR_SETTINGS` (`pcbnew/footprint_editor_settings.h` +
 * `.cpp`) — the slice of the designer's `FpEditSettings`
 * (`prefs/settings.ts`) the footprint editor's own modules read, named
 * structurally the same way `pcb_edit_frame.ts`'s `PCBNEW_JSON_SETTINGS_LIKE`
 * is: this package states what it needs of the JSON without importing
 * `designer/`. The designer's own `FpEditSettings` satisfies this by
 * construction; every field name and type below is copied from it.
 */
import type { GridEntry, GridOverride } from '@ziroeda/common/settings/grid_settings_ui.js';

/** A Graphics Defaults row that carries only a line width (Edge Cuts, Courtyards). */
export interface FP_GRAPHICS_LINE_CLASS_LIKE {
  line_width: number;
}

/** A Graphics Defaults row that also carries text (silk, copper, fab, others). */
export interface FP_GRAPHICS_TEXT_CLASS_LIKE extends FP_GRAPHICS_LINE_CLASS_LIKE {
  text_size_h: number;
  text_size_v: number;
  text_thickness: number;
  text_italic: boolean;
}

/** One row of `design_settings.default_footprint_text_items`. */
export interface FP_TEXT_ITEM_LIKE {
  text: string;
  visible: boolean;
  layer: string;
}

export interface FP_EDIT_JSON_SETTINGS_LIKE {
  design_settings: {
    default_footprint_text_items: FP_TEXT_ITEM_LIKE[];
    default_footprint_layer_names: Record<string, string>;
    user_layer_count: number;
    silk: FP_GRAPHICS_TEXT_CLASS_LIKE;
    copper: FP_GRAPHICS_TEXT_CLASS_LIKE;
    edges: FP_GRAPHICS_LINE_CLASS_LIKE;
    courtyard: FP_GRAPHICS_LINE_CLASS_LIKE;
    fab: FP_GRAPHICS_TEXT_CLASS_LIKE;
    others: FP_GRAPHICS_TEXT_CLASS_LIKE;
  };
  window: {
    grid: {
      sizes: GridEntry[];
      last_size_idx: number;
      show: boolean;
      snap: 0 | 1 | 2;
      overrides_enabled: boolean;
      /**
       * `FRAME_FOOTPRINT_EDITOR`'s three surviving override rows
       * (`common/dialogs/panel_grid_settings.cpp:53-92`) — no `wires` or
       * `vias` key here; a footprint has neither.
       */
      overrides: {
        connected: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
  };
}
