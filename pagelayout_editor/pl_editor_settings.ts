// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor_settings.h` + `.cpp`: `PL_EDITOR_SETTINGS`,
 * the Drawing Sheet Editor's app settings (`pl_editor.json`).
 *
 * As `gerbview/gerbview_settings.ts` and `bitmap2cmp_settings.ts` are, this is
 * the in-memory object the frame reads. The JSON side is the app's `plEditor`
 * slice (`designer/src/prefs/settings.ts`), whose seven top-level keys are the
 * PARAM paths below; `FromJson` / `ToJson` are the PARAMs' load and store.
 *
 * `MigrateFromLegacy` reads a KiCad 5 wxConfig, which a browser has never had:
 * n/a.
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
import { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';

/** "Update the schema version whenever a migration is required" [data] */
export const plEditorSchemaVersion = 0;

/** The JSON shape the seven PARAMs read and write (pl_editor_settings.cpp:45-58). */
export interface PL_EDITOR_SETTINGS_JSON {
  properties_frame_width: number;
  corner_origin: number;
  black_background: boolean;
  last_paper_size: string;
  last_custom_width: number;
  last_custom_height: number;
  last_was_portrait: boolean;
}

export class PL_EDITOR_SETTINGS extends APP_SETTINGS_BASE {
  /** `corner_origin`, 0: the index into the frame's five origin choices. */
  m_CornerOrigin = 0;
  /** `properties_frame_width`, 150 (pixels). */
  m_PropertiesFrameWidth = 150;
  /** `last_paper_size`, "A3". */
  m_LastPaperSize = 'A3';
  /** `last_custom_width`, 17000 (mils). */
  m_LastCustomWidth = 17000;
  /** `last_custom_height`, 11000 (mils). */
  m_LastCustomHeight = 11000;
  /** `last_was_portrait`, false. */
  m_LastWasPortrait = false;
  /** `black_background`, false. */
  m_BlackBackground = false;

  constructor() {
    super('pl_editor', plEditorSchemaVersion);
  }

  /** `getLegacyFrameName()`: the KiCad 5 wxConfig prefix. [data] */
  getLegacyFrameName(): string {
    return 'PlEditorFrame';
  }

  /** The PARAMs' load: each member from its JSON path, its default when absent. */
  FromJson(aJson: Partial<PL_EDITOR_SETTINGS_JSON>): this {
    const d = new PL_EDITOR_SETTINGS();

    this.m_PropertiesFrameWidth = aJson.properties_frame_width ?? d.m_PropertiesFrameWidth;
    this.m_CornerOrigin = aJson.corner_origin ?? d.m_CornerOrigin;
    this.m_BlackBackground = aJson.black_background ?? d.m_BlackBackground;
    this.m_LastPaperSize = aJson.last_paper_size ?? d.m_LastPaperSize;
    this.m_LastCustomWidth = aJson.last_custom_width ?? d.m_LastCustomWidth;
    this.m_LastCustomHeight = aJson.last_custom_height ?? d.m_LastCustomHeight;
    this.m_LastWasPortrait = aJson.last_was_portrait ?? d.m_LastWasPortrait;
    return this;
  }

  /** The PARAMs' store. */
  ToJson(): PL_EDITOR_SETTINGS_JSON {
    return {
      properties_frame_width: this.m_PropertiesFrameWidth,
      corner_origin: this.m_CornerOrigin,
      black_background: this.m_BlackBackground,
      last_paper_size: this.m_LastPaperSize,
      last_custom_width: this.m_LastCustomWidth,
      last_custom_height: this.m_LastCustomHeight,
      last_was_portrait: this.m_LastWasPortrait,
    };
  }
}

/**
 * `pl_editor.json` — `PL_EDITOR_SETTINGS`
 * (pagelayout_editor/pl_editor_settings.cpp) over its `APP_SETTINGS_BASE`
 * base (common/settings/app_settings.cpp).
 *
 * Upstream registers 96 parameters on this object. Most of them are base-class
 * slices the Drawing Sheet Editor has no control for — `find_replace.*`,
 * `design_block_chooser.*`, `lib_tree.*`, `printing.*`, `cross_probing.*`,
 * `plugins.actions`, the window geometry, `window.zoom_factors` — and a
 * setting we cannot honour is a setting we should not claim to store, so those
 * are absent rather than invented. What is here is exactly the set the editor
 * puts a control in front of.
 *
 * Two shapes deliberately follow the house spelling rather than KiCad's JSON:
 * `window.grid.last_size_idx` (KiCad's key is `window.grid.last_size`, but the
 * C++ member is `last_size_idx` and `EeschemaSettings` already reads that way)
 * and `window.cursor.crosshair` for `window.cursor.cross_hair_mode`. The seven
 * `PL_EDITOR_SETTINGS`-proper keys are top-level and unprefixed exactly as
 * upstream writes them.
 */
export interface PlEditorSettings {
  system: {
    /**
     * `system.units` (app_settings.cpp:231-232). **MILS**, not mm: the
     * conditional at :228-238 names `pl_editor` alongside eeschema and the
     * symbol editor on the imperial side.
     */
    units: EdaUnits;
    /** `system.last_metric_units` (app_settings.cpp:240-241), EDA_UNITS::MM. */
    last_metric_units: EdaUnits;
    /**
     * `system.last_imperial_units` (app_settings.cpp:243-244),
     * EDA_UNITS::MILS. This is what Ctrl+U comes back to, and it is a
     * *setting*, not `COMMON_TOOLS`' `m_imperialUnit( EDA_UNITS::INCH )`
     * constructor seed — `setupUnits` (eda_draw_frame.cpp:1385) overwrites
     * that seed with this value before the frame is usable.
     */
    last_imperial_units: EdaUnits;
  };
  /**
   * `appearance.color_theme` -> `APP_SETTINGS_BASE::m_ColorTheme`
   * (app_settings.cpp:282-283), default `COLOR_SETTINGS::COLOR_BUILTIN_DEFAULT`.
   * The one control on Preferences > Drawing Sheet Editor > Colors, which is
   * `Color theme:` and nothing else
   * (pagelayout_editor/dialogs/panel_pl_editor_color_settings_base.cpp:19-27).
   */
  appearance: {
    color_theme: string;
    /**
     * `APP_SETTINGS_BASE::m_CustomToolbars` -> `appearance.custom_toolbars`
     * (`common/settings/app_settings.cpp:285-286`), default false.
     *
     * The "Customize toolbars" checkbox at the top of Preferences > Toolbars,
     * and the `aAllowCustom` argument every `GetToolbarConfig` call passes
     * (`common/eda_base_frame.cpp:784`, `:800`, `:815`, `:831`): with it off the
     * frame draws `DefaultToolbarConfig` even when a stored configuration
     * exists, so switching it off restores the stock toolbars without
     * discarding the customisation.
     */
    custom_toolbars: boolean;
  };
  window: {
    grid: {
      /**
       * `window.grid.sizes` -> `GRID_SETTINGS::grids`
       * (app_settings.cpp:476-477), seeded from `DefaultGridSizeList()`'s
       * pl_editor row. Stored rather than read straight off the table because
       * `PANEL_GRID_SETTINGS` edits it: add, edit, remove and reorder all write
       * `m_grids` back into `gridCfg.grids`
       * (common/dialogs/panel_grid_settings.cpp:190-192).
       *
       * The row is `GRID{ name, x, y }`, as upstream's is: every DEFAULT of
       * pl_editor's row is square and nameless, but the Grids page can now add
       * a named, non-square one through `DIALOG_GRID_SETTINGS`, so the stored
       * shape has to be able to hold it.
       */
      sizes: GridEntry[];
      /**
       * `window.grid.last_size` -> `GRID_SETTINGS::last_size_idx`
       * (app_settings.cpp:480-481), default `defaultGridIdx` = 4 for
       * pl_editor, i.e. `0.50 mm`. Kept as `ui/grid_settings.ts`'
       * `DEFAULT_GRID_INDEX.pl_editor` rather than restated here.
       */
      last_size_idx: number;
      /**
       * `window.grid.fast_grid_1` (app_settings.cpp:483-484), default
       * `defaultGridIdx`, i.e. the same grid `last_size` starts on.
       */
      fast_grid_1: number;
      /**
       * `window.grid.fast_grid_2` (app_settings.cpp:486-487), default
       * `defaultGridIdx + 1`.
       */
      fast_grid_2: number;
      /** `window.grid.style` (app_settings.cpp:558-559), 0 = DOTS. */
      style: 'dots' | 'lines' | 'crosses';
      /** `window.grid.line_width` (app_settings.cpp:549-550), 1.0 px. */
      line_width: number;
      /** `window.grid.min_spacing` (app_settings.cpp:552-553), 10 px. */
      min_spacing: number;
      /** `window.grid.snap` (app_settings.cpp:561-562), 0 = ALWAYS. */
      snap: 0 | 1 | 2;
      /**
       * `window.grid.show` (app_settings.cpp:555-556), default true. Not
       * written by `SaveSettings`: `ACTIONS::toggleGrid` mutates the settings
       * object in place through `EDA_DRAW_FRAME::SetGridVisibility`
       * (eda_draw_frame.cpp:593-598), which is why the toggle survives a
       * restart.
       */
      show: boolean;
      /**
       * `window.grid.overrides_enabled` (app_settings.cpp:522-523), true for
       * pl_editor as for everything else — the `else` arm gives it the same
       * default the eeschema arm does.
       */
      overrides_enabled: boolean;
      /**
       * The two per-item overrides `PANEL_GRID_SETTINGS` leaves visible for
       * `FRAME_PL_EDITOR`. Its constructor hides the vias row for every frame
       * outside pcbnew, and hides the connected and wires rows for every frame
       * that is not one of the four schematic ones
       * (common/dialogs/panel_grid_settings.cpp:62-82), which leaves Text and
       * Graphics. Both default off, at grid indices 18 and 15 of the *pcbnew*
       * row upstream — indices into a 22-entry list pl_editor does not have, so
       * ours name the grid by its string instead.
       */
      overrides: {
        text: GridOverride;
        graphics: GridOverride;
      };
    };
    cursor: {
      /** `window.cursor.cross_hair_mode` (app_settings.cpp:567-568), SMALL_CROSS. */
      crosshair: 'small' | 'full' | '45';
      /** `window.cursor.always_show_cursor` (app_settings.cpp:564-565), true. */
      always_show_cursor: boolean;
    };
  };
  /** `properties_frame_width` (pl_editor_settings.cpp:45-46), 150. */
  properties_frame_width: number;
  /** `corner_origin` (pl_editor_settings.cpp:48), 0 — index into the 5 origins. */
  corner_origin: number;
  /** `black_background` (pl_editor_settings.cpp:50), false. */
  black_background: boolean;
  /** `last_paper_size` (pl_editor_settings.cpp:52), "A3". */
  last_paper_size: string;
  /** `last_custom_width` (pl_editor_settings.cpp:54), 17000 **mils**. */
  last_custom_width: number;
  /** `last_custom_height` (pl_editor_settings.cpp:56), 11000 **mils**. */
  last_custom_height: number;
  /** `last_was_portrait` (pl_editor_settings.cpp:58), false. */
  last_was_portrait: boolean;
}

export const PL_EDITOR_DEFAULTS: PlEditorSettings = {
  system: {
    // The `app_settings.cpp:228-238` branch, asked rather than restated: five
    // editors already read their starting unit from `defaultUnits`, and this
    // was the last copy of the answer written out by hand.
    units: defaultUnits('pl_editor'),
    last_metric_units: 'mm',
    last_imperial_units: 'mils',
  },
  appearance: {
    color_theme: '_builtin_default',
    custom_toolbars: false,
  },
  window: {
    grid: {
      // `DefaultGridSizeList()`'s pl_editor row, asked rather than restated —
      // the same table the grid selector and the canvas already read. All eight
      // are square, so the X column says the whole grid.
      sizes: GRID_SIZE_LIST.pl_editor.map(gridEntryOf),
      last_size_idx: DEFAULT_GRID_INDEX.pl_editor,
      // `fast_grid_1 = defaultGridIdx`, `fast_grid_2 = defaultGridIdx + 1`
      // (app_settings.cpp:483-487) — not two literals.
      fast_grid_1: DEFAULT_GRID_INDEX.pl_editor,
      fast_grid_2: DEFAULT_GRID_INDEX.pl_editor + 1,
      style: 'dots',
      line_width: 1,
      min_spacing: 10,
      snap: 0,
      show: true,
      overrides_enabled: true,
      // The `else` arm of app_settings.cpp:520-546: both off. Upstream's
      // indices (18, 15) point into pcbnew's grid list; the nearest thing
      // pl_editor's own row has is its finest grid, which is what a text or
      // graphics override would be for.
      overrides: {
        text: { enabled: false, size: '0.10 mm' },
        graphics: { enabled: false, size: '0.10 mm' },
      },
    },
    cursor: {
      crosshair: 'small',
      always_show_cursor: true,
    },
  },
  properties_frame_width: 150,
  corner_origin: 0,
  black_background: false,
  last_paper_size: 'A3',
  last_custom_width: 17000,
  last_custom_height: 11000,
  last_was_portrait: false,
};
