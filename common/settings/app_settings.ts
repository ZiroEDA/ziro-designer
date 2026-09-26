// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/settings/app_settings.h` + `common/settings/app_settings.cpp`: the
 * in-memory settings object every frame reads. The C++ class is a
 * `JSON_SETTINGS`, whose `PARAM` list loads and stores each member from the
 * app's JSON file; here the designer's settings store is that file and the
 * PARAM mapping lands with the frame wiring (pending, #636 stage 6). What is
 * here is every member, at the default its PARAM gives it.
 */
import { CROSS_HAIR_MODE } from '../gal/gal_display_options.js';
import {
  ZOOM_LIST_EESCHEMA,
  ZOOM_LIST_GERBVIEW,
  ZOOM_LIST_PCBNEW,
  ZOOM_LIST_PCBNEW_HYPER,
  ZOOM_LIST_PL_EDITOR,
} from '../zoom_defines.js';
import { GRID, GRID_SETTINGS } from './grid_settings.js';

/**
 * Cross-probing behavior.
 */
export class CROSS_PROBING_SETTINGS {
  on_selection = true; ///< Synchronize the selection for multiple items too.
  center_on_items = true; ///< Automatically pan to cross-probed items.
  zoom_to_fit = true; ///< Zoom to fit items (ignored if center_on_items is off).
  auto_highlight = true; ///< Automatically turn on highlight mode in the target frame.
  flash_selection = false; ///< Flash newly cross-probed selection (visual attention aid).
}

/**
 * Common cursor settings, available to every frame.
 */
export class CURSOR_SETTINGS {
  always_show_cursor = true;
  cross_hair_mode: CROSS_HAIR_MODE = CROSS_HAIR_MODE.SMALL_CROSS;
}

/**
 * Settings for arc editing. Used by pcbnew and footprint editor
 */
export { ARC_EDIT_MODE } from '../frame_type.js';

/**
 * Store the window positioning/state.
 */
export class WINDOW_STATE {
  maximized = false;
  size_x = 0;
  size_y = 0;
  pos_x = 0;
  pos_y = 0;
  display = 0;
}

/**
 * Store the common settings that are saved and loaded for each window / frame.
 */
export class WINDOW_SETTINGS {
  state = new WINDOW_STATE();
  mru_path = '';
  perspective = '';
  aui_state: unknown = null;
  zoom_factors: number[] = [];

  cursor = new CURSOR_SETTINGS();
  grid = new GRID_SETTINGS();
}

export class FIND_REPLACE {
  find_string = '';
  find_history: string[] = [];
  replace_string = '';
  replace_history: string[] = [];
  search_and_replace = false;
  match_case = false;
  match_mode = 0;
}

export enum SEARCH_PANE_SELECTION_ZOOM {
  NONE,
  PAN,
  ZOOM,
}

export class SEARCH_PANE {
  selection_zoom: SEARCH_PANE_SELECTION_ZOOM = SEARCH_PANE_SELECTION_ZOOM.PAN;
  search_hidden_fields = true;
  search_metadata = false;
}

export class GRAPHICS {
  highlight_factor = 0.5; ///< How much to brighten highlighted objects by.
  select_factor = 0.75; ///< How much to brighten selected objects by.
}

export class COLOR_PICKER {
  default_tab = 0;
}

export class LIB_TREE {
  columns: string[] = []; ///< Ordered list of visible columns in the tree.
  column_widths = new Map<string, number>(); ///< Column widths, keyed by header name.
  open_libs: string[] = []; ///< list of libraries the user has open in the tree.
}

export class PANEL_DESIGN_BLOCK_CHOOSER {
  sash_pos_h = -1;
  sash_pos_v = -1;
  width = -1;
  height = -1;
  sort_mode = 0;
  repeated_placement = false;
  place_as_sheet = false;
  place_as_group = true;
  keep_annotations = false;

  // For saving tree columns and widths
  tree = new LIB_TREE();
}

export class PRINTING {
  background = false; ///< Whether or not to print background color.
  monochrome = true; ///< Whether or not to print in monochrome.
  scale = 1.0; ///< Printout scale.
  use_theme = false; ///< If false, display color theme will be used.
  color_theme = ''; ///< Color theme to use for printing.
  title_block = false; ///< Whether or not to print title block.
  layers: number[] = []; ///< List of enabled layers for printing.
  mirror = false; ///< Print mirrored.
  drill_marks = 1; ///< Drill marks type (0=none, 1=small, 2=real).
  pagination = 1; ///< 0=all layers on one page, 1=one page per layer.
  edge_cuts_on_all_pages = true; ///< Print board edges on all pages.
  as_item_checkboxes = false; ///< Honor checkboxes in appearance manager.
}

export class SYSTEM {
  first_run_shown = false; //@todo RFB remove? - not used
  max_undo_items = 0;
  file_history: string[] = [];
  units = 0;
  last_metric_units = 0;
  last_imperial_units = 0;
  show_import_issues = true;
}

export class PLUGINS {
  actions: [string, boolean][] = [];
}

/** `COLOR_SETTINGS::COLOR_BUILTIN_DEFAULT` (color_settings.cpp:34). */
export const COLOR_BUILTIN_DEFAULT = '_builtin_default';

/**
 * `EDA_UNITS` as `system.units` stores it: the enum's integer
 * (include/eda_units.h `enum class EDA_UNITS`).
 */
export enum EDA_UNITS_INT {
  INCH = 0, // Do not use IN: it conflicts with a Windows header
  MM = 1,
  UNSCALED = 2,
  DEGREES = 3,
  PERCENT = 4,
  MILS = 5,
  UM = 6,
  CM = 7,
  FS = 8, // Femtoseconds
  PS = 9, // Picoseconds
  PS_PER_INCH = 10,
  PS_PER_CM = 11,
  PS_PER_MM = 12,
}

export class APP_SETTINGS_BASE {
  protected m_filename: string;
  protected m_schemaVersion: number;

  m_CrossProbing = new CROSS_PROBING_SETTINGS();
  m_FindReplace = new FIND_REPLACE();
  m_DesignBlockChooserPanel = new PANEL_DESIGN_BLOCK_CHOOSER();
  m_Graphics = new GRAPHICS();
  m_ColorPicker = new COLOR_PICKER();
  m_LibTree = new LIB_TREE();
  m_Printing = new PRINTING();
  m_SearchPane = new SEARCH_PANE();
  m_System = new SYSTEM();
  m_Plugins = new PLUGINS();
  m_Window = new WINDOW_SETTINGS();

  m_ColorTheme: string = COLOR_BUILTIN_DEFAULT;
  m_CustomToolbars = false;

  ///< Local schema version for common app settings
  m_appSettingsSchemaVersion: number;

  constructor(aFilename: string, aSchemaVersion: number) {
    this.m_filename = aFilename;
    this.m_schemaVersion = aSchemaVersion;
    this.m_appSettingsSchemaVersion = aSchemaVersion;

    // app_settings.cpp:228-238
    if (
      this.m_filename === 'pl_editor' ||
      this.m_filename === 'eeschema' ||
      this.m_filename === 'symbol_editor'
    ) {
      this.m_System.units = EDA_UNITS_INT.MILS;
    } else {
      this.m_System.units = EDA_UNITS_INT.MM;
    }

    this.m_System.last_metric_units = EDA_UNITS_INT.MM;
    this.m_System.last_imperial_units = EDA_UNITS_INT.MILS;

    this.addParamsForWindow(this.m_Window);
  }

  GetFilename(): string {
    return this.m_filename;
  }

  DefaultGridSizeList(): GRID[] {
    if (this.m_filename === 'eeschema' || this.m_filename === 'symbol_editor') {
      return [
        new GRID('', '100 mil', '100 mil'),
        new GRID('', '50 mil', '50 mil'),
        new GRID('', '25 mil', '25 mil'),
        new GRID('', '10 mil', '10 mil'),
      ];
    }
    if (this.m_filename === 'pl_editor') {
      return [
        new GRID('', '5.00 mm', '5.00 mm'),
        new GRID('', '2.50 mm', '2.50 mm'),
        new GRID('', '2.00 mm', '2.00 mm'),
        new GRID('', '1.00 mm', '1.00 mm'),
        new GRID('', '0.50 mm', '0.50 mm'),
        new GRID('', '0.25 mm', '0.25 mm'),
        new GRID('', '0.20 mm', '0.20 mm'),
        new GRID('', '0.10 mm', '0.10 mm'),
      ];
    }
    if (this.m_filename === 'gerbview') {
      return [
        new GRID('', '100 mil', '100 mil'),
        new GRID('', '50 mil', '50 mil'),
        new GRID('', '25 mil', '25 mil'),
        new GRID('', '20 mil', '20 mil'),
        new GRID('', '10 mil', '10 mil'),
        new GRID('', '5 mil', '5 mil'),
        new GRID('', '2.5 mil', '2.5 mil'),
        new GRID('', '2 mil', '2 mil'),
        new GRID('', '1 mil', '1 mil'),
        new GRID('', '0.5 mil', '0.5 mil'),
        new GRID('', '0.2 mil', '0.2 mil'),
        new GRID('', '0.1 mil', '0.1 mil'),
        new GRID('', '5.0 mm', '5.0 mm'),
        new GRID('', '1.5 mm', '2.5 mm'),
        new GRID('', '1.0 mm', '1.0 mm'),
        new GRID('', '0.5 mm', '0.5 mm'),
        new GRID('', '0.25 mm', '0.25 mm'),
        new GRID('', '0.2 mm', '0.2 mm'),
        new GRID('', '0.1 mm', '0.1 mm'),
        new GRID('', '0.05 mm', '0.0 mm'),
        new GRID('', '0.025 mm', '0.0 mm'),
        new GRID('', '0.01 mm', '0.0 mm'),
      ];
    }
    return [
      new GRID('', '1000 mil', '1000 mil'),
      new GRID('', '500 mil', '500 mil'),
      new GRID('', '250 mil', '250 mil'),
      new GRID('', '200 mil', '200 mil'),
      new GRID('', '100 mil', '100 mil'),
      new GRID('', '50 mil', '50 mil'),
      new GRID('', '25 mil', '25 mil'),
      new GRID('', '20 mil', '20 mil'),
      new GRID('', '10 mil', '10 mil'),
      new GRID('', '5 mil', '5 mil'),
      new GRID('', '2 mil', '2 mil'),
      new GRID('', '1 mil', '1 mil'),
      new GRID('', '5.0 mm', '5.0 mm'),
      new GRID('', '2.5 mm', '2.5 mm'),
      new GRID('', '1.0 mm', '1.0 mm'),
      new GRID('', '0.5 mm', '0.5 mm'),
      new GRID('', '0.25 mm', '0.25 mm'),
      new GRID('', '0.2 mm', '0.2 mm'),
      new GRID('', '0.1 mm', '0.1 mm'),
      new GRID('', '0.05 mm', '0.05 mm'),
      new GRID('', '0.025 mm', '0.025 mm'),
      new GRID('', '0.01 mm', '0.01 mm'),
    ];
  }

  /**
   * `ADVANCED_CFG::GetCfg().m_HyperZoom` picks the hyper list; that flag is
   * pending with ADVANCED_CFG, so the plain list it is.
   */
  DefaultZoomList(): number[] {
    if (this.m_filename === 'eeschema' || this.m_filename === 'symbol_editor') {
      return [...ZOOM_LIST_EESCHEMA];
    }
    if (this.m_filename === 'pl_editor') {
      return [...ZOOM_LIST_PL_EDITOR];
    }
    if (this.m_filename === 'gerbview') {
      return [...ZOOM_LIST_GERBVIEW];
    }
    const hyperZoom = false;
    return hyperZoom ? [...ZOOM_LIST_PCBNEW_HYPER] : [...ZOOM_LIST_PCBNEW];
  }

  /**
   * `APP_SETTINGS_BASE::addParamsForWindow`: the window block's PARAM defaults
   * (app_settings.cpp:447-569), applied to the block.
   */
  protected addParamsForWindow(aWindow: WINDOW_SETTINGS): void {
    aWindow.state.maximized = false;
    aWindow.mru_path = '';
    aWindow.state.size_x = 0;
    aWindow.state.size_y = 0;
    aWindow.perspective = '';
    aWindow.state.pos_x = 0;
    aWindow.state.pos_y = 0;
    aWindow.state.display = 0;

    aWindow.zoom_factors = this.DefaultZoomList();

    const grid = aWindow.grid;
    grid.axes_enabled = false;

    let defaultGridIdx: number;

    if (this.m_filename === 'eeschema' || this.m_filename === 'symbol_editor') {
      defaultGridIdx = 1;
    } else if (this.m_filename === 'pl_editor') {
      defaultGridIdx = 4;
    } else {
      defaultGridIdx = 15;
    }

    grid.grids = this.DefaultGridSizeList();
    grid.last_size_idx = defaultGridIdx;
    grid.fast_grid_1 = defaultGridIdx;
    grid.fast_grid_2 = defaultGridIdx + 1;

    // legacy values, leave blank by default so we don't convert them
    grid.user_grid_x = '';
    grid.user_grid_y = '';

    // for grid overrides, give just the schematic and symbol editors sane values
    if (this.m_filename === 'eeschema' || this.m_filename === 'symbol_editor') {
      grid.overrides_enabled = true;
      grid.override_connected = true;
      grid.override_wires = true;
      grid.override_vias = false;
      grid.override_text = true;
      grid.override_graphics = false;

      grid.override_connected_idx = 1;
      grid.override_wires_idx = 1;
      grid.override_vias_idx = 0;
      grid.override_text_idx = 3;
      grid.override_graphics_idx = 2;
    } else {
      grid.overrides_enabled = true;
      grid.override_connected = false;
      grid.override_wires = false;
      grid.override_vias = false;
      grid.override_text = false;
      grid.override_graphics = false;

      grid.override_connected_idx = 16;
      grid.override_text_idx = 18;
      grid.override_wires_idx = 19;
      grid.override_vias_idx = 18;
      grid.override_graphics_idx = 15;
    }

    grid.line_width = 1.0;
    grid.min_spacing = 10;
    grid.show = true;
    grid.style = 0;
    grid.snap = 0;

    aWindow.cursor.always_show_cursor = true;
    aWindow.cursor.cross_hair_mode = CROSS_HAIR_MODE.SMALL_CROSS;
  }
}
