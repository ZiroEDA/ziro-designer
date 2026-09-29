// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SYMBOL_EDITOR_SETTINGS (`eeschema/symbol_editor/symbol_editor_settings.{h,cpp}`):
 * the shape of `symbol_editor.json` and its defaults. Moved out of
 * `designer/src/prefs/settings.ts`, which still owns the store.
 */
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { defaultUnits } from '@ziroeda/common/settings/app_settings_units.js';
import {
  DEFAULT_GRID_INDEX,
  GRID_SIZE_LIST,
  type GridEntry,
  type GridOverride,
  gridEntryOf,
} from '@ziroeda/common/settings/grid_settings_ui.js';

/**
 * `SYMBOL_EDITOR_SETTINGS` — `eeschema/symbol_editor/symbol_editor_settings.{h,cpp}`,
 * declared as `APP_SETTINGS_BASE( "symbol_editor", libeditSchemaVersion )`
 * (`symbol_editor_settings.cpp:38`).
 *
 * It is its **own file**, not a sub-object of `eeschema.json`: eeschema's KIFACE
 * asks for it by name — `GetAppSettings<SYMBOL_EDITOR_SETTINGS>( "symbol_editor" )`
 * (`eeschema/eeschema.cpp:252`, `:255`, `:288`) — and the installed 10.0.5 writes
 * `~/.config/kicad/10.0/symbol_editor.json` beside `eeschema.json`. So the
 * Symbol Editor's five Preferences pages write here and not into the schematic's
 * settings, which is what makes "use the schematic editor colour theme" a
 * *choice* on the Colors page rather than the only possibility.
 *
 * Only the keys the five Preferences pages read or write are modelled. A key
 * nothing reads is a key that can drift, which is the rule
 * {@link FpEditSettings} states below and the reason this is not a transcript
 * of all 22 `m_params` entries.
 */
export interface SymbolEditorSettings {
  /**
   * `APP_SETTINGS_BASE`'s `system.*`. `system.units` is a PARAM on EVERY app —
   * the `app_settings.cpp:228-238` branch chooses its DEFAULT, not whether the
   * key exists — so this is not a pl_editor/gerbview extra that these two do
   * without. Missing here, the frame's units button was session-only and every
   * page that asks the frame for its unit got a constant instead.
   */
  system: {
    /** `system.units` (`app_settings.cpp:231-232`), MILS on this branch. */
    units: EdaUnits;
    /** `system.last_metric_units` (`:240-241`), EDA_UNITS::MM. */
    last_metric_units: EdaUnits;
    /**
     * `system.last_imperial_units` (`:243-244`), EDA_UNITS::MILS — what Ctrl+U
     * comes back to, and a setting rather than `COMMON_TOOLS`' constructor
     * seed, which `setupUnits` (`eda_draw_frame.cpp:1385`) overwrites.
     */
    last_imperial_units: EdaUnits;
  };
  /**
   * `APP_SETTINGS_BASE`'s `appearance.*`, the two keys the base class gives
   * every app (`common/settings/app_settings.cpp:282-286`).
   */
  appearance: {
    /**
     * `appearance.color_theme` -> `APP_SETTINGS_BASE::m_ColorTheme`. Written by
     * the Colors page, but only on the "Use theme:" branch — see
     * {@link SymbolEditorSettings.use_eeschema_color_settings}.
     */
    color_theme: string;
    /** `appearance.custom_toolbars`, the Toolbars page's "Customize toolbars". */
    custom_toolbars: boolean;
  };
  /**
   * `PARAM<bool>( "use_eeschema_color_settings", &m_UseEeschemaColorSettings, true )`
   * (`symbol_editor_settings.cpp:100-101`), and the whole of what the Colors
   * page's two radio buttons decide
   * (`panel_sym_color_settings.cpp:38-44`, `:74-86`).
   */
  use_eeschema_color_settings: boolean;
  /** `show_hidden_lib_pins` -> `m_ShowHiddenPins` (`:88-89`), default true. */
  show_hidden_lib_pins: boolean;
  /** `show_hidden_lib_fields` -> `m_ShowHiddenFields` (`:85-86`), default true. */
  show_hidden_lib_fields: boolean;
  /** `show_pin_electrical_type` -> `m_ShowPinElectricalType` (`:79-80`), default true. */
  show_pin_electrical_type: boolean;
  /** `show_pin_alt_icons` -> `m_ShowPinAltIcons` (`:82-83`), default true. */
  show_pin_alt_icons: boolean;
  /**
   * `drag_pins_along_with_edges` -> `m_dragPinsAlongWithEdges` (`:91-92`),
   * default true. The one control in the Editing Options page's General Editing
   * group.
   */
  drag_pins_along_with_edges: boolean;
  /**
   * `SYMBOL_EDITOR_SETTINGS::DEFAULTS`, `defaults.*`
   * (`symbol_editor_settings.cpp:58-73`). Every one is **mils**, as the
   * Editing Options page's `mils` suffixes say and as
   * `PANEL_SYM_EDITING_OPTIONS` converts through `schIUScale.MilsToIU`
   * (`panel_sym_editing_options.cpp:56-62`).
   */
  defaults: {
    /** `defaults.line_width`, 0 — "inherit from schematic". */
    line_width: number;
    /** `defaults.text_size`, `DEFAULT_TEXT_SIZE` = 50 (`eeschema/default_values.h:69`). */
    text_size: number;
    /** `defaults.pin_length`, `DEFAULT_PIN_LENGTH` = 100 (`default_values.h:39`). */
    pin_length: number;
    /** `defaults.pin_name_size`, `DEFAULT_PINNAME_SIZE` = 50 (`default_values.h:45`). */
    pin_name_size: number;
    /** `defaults.pin_num_size`, `DEFAULT_PINNUM_SIZE` = 50 (`default_values.h:42`). */
    pin_num_size: number;
  };
  /** `SYMBOL_EDITOR_SETTINGS::REPEAT`, `repeat.*` (`symbol_editor_settings.cpp:75-79`). */
  repeat: {
    /** `repeat.label_delta`, 1. The spin control's range is -10..10. */
    label_delta: number;
    /** `repeat.pin_step`, 100 **mils**, forced to a multiple of `MIN_GRID` (25). */
    pin_step: number;
  };
  /** `APP_SETTINGS_BASE::m_Window`, the slice the Grids and Display Options pages share. */
  window: {
    grid: {
      /**
       * `window.grid.sizes`, seeded from `DefaultGridSizeList()`'s
       * symbol_editor row — the same four grids eeschema gets.
       */
      sizes: GridEntry[];
      /**
       * `window.grid.last_size`, `defaultGridIdx` = **1** for `symbol_editor`:
       * the filename is named alongside `eeschema` in the branch at
       * `common/settings/app_settings.cpp:463-466`, so it is 50 mil and not
       * pcbnew's 15.
       */
      last_size_idx: number;
      /** `window.grid.fast_grid_1`, `defaultGridIdx`. */
      fast_grid_1: number;
      /** `window.grid.fast_grid_2`, `defaultGridIdx + 1`. */
      fast_grid_2: number;
      /** `window.grid.style` (`app_settings.cpp:558-559`), 0 = DOTS. */
      style: 'dots' | 'lines' | 'crosses';
      /** `window.grid.line_width` (`:549-550`), 1.0 px. */
      line_width: number;
      /** `window.grid.min_spacing` (`:552-553`), 10 px. */
      min_spacing: number;
      /** `window.grid.snap` (`:561-562`), 0 = ALWAYS. */
      snap: 0 | 1 | 2;
      /** `window.grid.show` (`:555-556`), true. `ACTIONS::toggleGrid`, not a page. */
      show: boolean;
      /** `window.grid.overrides_enabled` (`:497-498`), true. */
      overrides_enabled: boolean;
      /**
       * The four override rows `PANEL_GRID_SETTINGS` leaves visible for
       * `FRAME_SCH_SYMBOL_EDITOR` — vias is hidden outside pcbnew
       * (`common/dialogs/panel_grid_settings.cpp:62-82`), and the symbol editor
       * is one of the four schematic frames that keep connected and wires.
       */
      overrides: {
        connected: GridOverride;
        wires: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
    cursor: {
      /** `window.cursor.cross_hair_mode` (`:567-568`), SMALL_CROSS. */
      crosshair: 'small' | 'full' | '45';
      /** `window.cursor.always_show_cursor` (`:564-565`), true. */
      always_show_cursor: boolean;
    };
  };
}

export const SYMBOL_EDITOR_DEFAULTS: SymbolEditorSettings = {
  system: {
    // The `app_settings.cpp:228-238` branch, asked rather than restated.
    units: defaultUnits('symbol_editor'),
    last_metric_units: 'mm',
    last_imperial_units: 'mils',
  },
  appearance: {
    color_theme: '_builtin_default',
    custom_toolbars: false,
  },
  use_eeschema_color_settings: true,
  show_hidden_lib_pins: true,
  show_hidden_lib_fields: true,
  show_pin_electrical_type: true,
  show_pin_alt_icons: true,
  drag_pins_along_with_edges: true,
  // [data] `eeschema/default_values.h`'s four macros and the `line_width` 0 of
  // `symbol_editor_settings.cpp:58-59`. Mils, per the page's own unit labels.
  defaults: {
    line_width: 0,
    text_size: 50,
    pin_length: 100,
    pin_name_size: 50,
    pin_num_size: 50,
  },
  repeat: {
    label_delta: 1,
    pin_step: 100,
  },
  window: {
    grid: {
      // `DefaultGridSizeList()`'s symbol_editor row, asked rather than restated.
      sizes: GRID_SIZE_LIST.symbol_editor.map(gridEntryOf),
      last_size_idx: DEFAULT_GRID_INDEX.symbol_editor,
      fast_grid_1: DEFAULT_GRID_INDEX.symbol_editor,
      fast_grid_2: DEFAULT_GRID_INDEX.symbol_editor + 1,
      style: 'dots',
      line_width: 1,
      min_spacing: 10,
      snap: 0,
      show: true,
      overrides_enabled: true,
      // The eeschema/symbol_editor arm of `app_settings.cpp:495-521`:
      // connected, wires and text ON, graphics OFF, at grid indices 1, 1, 3
      // and 2 of the four-entry list above — 50 mil, 50 mil, 10 mil, 25 mil.
      // Confirmed against the installed build's own
      // `~/.config/kicad/10.0/symbol_editor.json`, which is the parity target.
      //
      // EESCHEMA_DEFAULTS disagrees with its own arm of that same `if`: it has
      // all four off and text at 25 mil. That is a pre-existing defect in the
      // schematic's settings, not a difference between the two editors — the
      // C++ gives them one branch — and it is left alone here rather than
      // fixed in passing.
      overrides: {
        connected: { enabled: true, size: '50 mil' },
        wires: { enabled: true, size: '50 mil' },
        text: { enabled: true, size: '10 mil' },
        graphics: { enabled: false, size: '25 mil' },
      },
    },
    cursor: {
      crosshair: 'small',
      always_show_cursor: true,
    },
  },
};
