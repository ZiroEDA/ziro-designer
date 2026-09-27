// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview_settings.h` + `.cpp`: `GERBVIEW_SETTINGS`, the Gerber
 * Viewer's app settings (`gerbview.json`), every member at its PARAM default.
 *
 * As `pcbnew/pcbnew_settings.ts` is, this is the in-memory object the engine
 * reads (`gvconfig()`, gerbview_painter.ts). The JSON side is the app's
 * `GerbviewSettings` slice (`designer/src/prefs/settings.ts`), and the app
 * builds one of these from it and registers it with the settings manager, as
 * the PARAMs would load it. `MigrateFromLegacy` (wxConfig) is n/a;
 * `GetFileHistories` waits on the file histories.
 */
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { defaultUnits } from '@ziroeda/common/settings/app_settings_units.js';
import {
  DEFAULT_GRID_INDEX,
  GRID_SIZE_LIST,
  type GridEntry,
  type GridOverride,
  gridEntryOf,
} from '@ziroeda/common/settings/grid_settings_ui.js';
import { EXCELLON_DEFAULTS } from './excellon_defaults.js';
import { GBR_DISPLAY_OPTIONS } from './gbr_display_options.js';

/** "Update the schema version whenever a migration is required." [data] */
const gerbviewSchemaVersion = 0;

/** `GERBVIEW_SETTINGS::APPEARANCE`. */
export class GERBVIEW_APPEARANCE {
  /** `appearance.show_border_and_titleblock`, false. */
  show_border_and_titleblock = false;
  /** `appearance.show_dcodes`, false. */
  show_dcodes = false;
  /** `appearance.show_negative_objects`, false. */
  show_negative_objects = false;
  /** `appearance.page_type`, "GERBER". */
  page_type = 'GERBER';
}

export class GERBVIEW_SETTINGS extends APP_SETTINGS_BASE {
  m_Appearance = new GERBVIEW_APPEARANCE();
  /**
   * `appearance.show_page_limit` is `m_DisplayPageLimits` (false) and
   * `appearance.mode_opacity_value` is `m_OpacityModeAlphaValue` (0.6); the
   * other members are not PARAMs and keep the constructor's values.
   */
  m_Display = new GBR_DISPLAY_OPTIONS();
  /** `gerber_to_pcb_copperlayers_count`, 2. */
  m_BoardLayersCount = 2;
  /** `system.drill_file_history`. */
  m_DrillFileHistory: string[] = [];
  /** `system.zip_file_history`. */
  m_ZipFileHistory: string[] = [];
  /** `system.job_file_history`. */
  m_JobFileHistory: string[] = [];
  /**
   * `gerber_to_pcb_layers`: a GERBER_DRAWLAYERS_COUNT long mapping of gerber
   * layers to PCB layers, used when exporting gerbers to a PCB.
   */
  m_GerberToPcbLayerMapping: number[] = [];
  /** `excellon_defaults.*`. */
  m_ExcellonDefaults = new EXCELLON_DEFAULTS();

  constructor() {
    super('gerbview', gerbviewSchemaVersion);
  }

  /** The Excellon default values to read a drill file. */
  GetExcellonDefaults(aNCDefaults: EXCELLON_DEFAULTS): void {
    aNCDefaults.m_UnitsMM = this.m_ExcellonDefaults.m_UnitsMM;
    aNCDefaults.m_LeadingZero = this.m_ExcellonDefaults.m_LeadingZero;
    aNCDefaults.m_MmIntegerLen = this.m_ExcellonDefaults.m_MmIntegerLen;
    aNCDefaults.m_MmMantissaLen = this.m_ExcellonDefaults.m_MmMantissaLen;
    aNCDefaults.m_InchIntegerLen = this.m_ExcellonDefaults.m_InchIntegerLen;
    aNCDefaults.m_InchMantissaLen = this.m_ExcellonDefaults.m_InchMantissaLen;
  }
}

// ---- gerbview.json, as the page stores it -----------------------------------

/**
 * `gerbview.json` — `GERBVIEW_SETTINGS` (`gerbview/gerbview_settings.cpp:39-98`)
 * over its `APP_SETTINGS_BASE` base (`common/settings/app_settings.cpp`).
 *
 * Same rule as `PlEditorSettings` above: only the keys the Gerber Viewer puts a
 * control in front of. The three file histories (`system.drill_file_history`,
 * `system.zip_file_history`, `system.job_file_history`) are omitted — they are
 * paths on a disk this app does not have. `gerber_to_pcb_layers` and
 * `gerber_to_pcb_copperlayers_count` are here though no Preferences page shows
 * them: the Map Gerber Layers dialog's Store Choice writes them.
 *
 * **One deliberate deviation, and it is the only one.** Three of `Display
 * Options`' checkboxes — Sketch flashed items / lines / polygons — write
 * `GBR_DISPLAY_OPTIONS` members that `GERBVIEW_SETTINGS`' constructor never
 * registers a `PARAM` for (compare `m_Display.m_DisplayPageLimits` at
 * `gerbview_settings.cpp:57-58`, which it does). Upstream they therefore live
 * only in the settings object in memory, shared between the Preferences page
 * and the left toolbar for one run of the program, and are back to
 * `GBR_DISPLAY_OPTIONS`' constructor defaults on the next launch. There is no
 * in-memory-only tier here: a browser tab has no exit hook to decide not to
 * flush at. They are stored, under a `display.` prefix that is ours because
 * upstream has no key to copy, and the visible difference is that a reload
 * remembers them. Chosen over the alternative — a preference that silently
 * forgets itself every time the tab is refreshed, which in a web app reads as a
 * bug rather than as parity.
 */
export interface GerbviewSettings {
  system: {
    /**
     * `system.units` (`app_settings.cpp:228-238`). **MM**: gerbview's filename
     * is not on the imperial side of that branch.
     */
    units: EdaUnits;
    /** `system.last_metric_units` (`app_settings.cpp:240-241`). */
    last_metric_units: EdaUnits;
    /** `system.last_imperial_units` (`app_settings.cpp:243-244`). */
    last_imperial_units: EdaUnits;
  };
  appearance: {
    /** `appearance.color_theme` (`app_settings.cpp:282-283`). */
    color_theme: string;
    /** `appearance.custom_toolbars` (`app_settings.cpp:285-286`), default false. */
    custom_toolbars: boolean;
    /**
     * `appearance.show_border_and_titleblock` (`gerbview_settings.cpp:44-45`),
     * default false — LAYER_GERBVIEW_DRAWINGSHEET. A fresh GerbView shows no
     * drawing sheet.
     */
    show_border_and_titleblock: boolean;
    /** `appearance.show_dcodes` (`gerbview_settings.cpp:47-48`), default false. */
    show_dcodes: boolean;
    /**
     * `appearance.show_negative_objects` (`gerbview_settings.cpp:50-51`),
     * default false.
     */
    show_negative_objects: boolean;
    /**
     * `appearance.page_type` (`gerbview_settings.cpp:53-55`), default
     * `"GERBER"` — the seven Page Size radios, and the `PAGE_INFO` type
     * `GERBVIEW_FRAME` sets from it (`gerbview_frame.cpp:334`, `:1213`).
     */
    page_type: string;
    /**
     * `appearance.show_page_limit` -> `m_Display.m_DisplayPageLimits`
     * (`gerbview_settings.cpp:57-58`), default false. The JSON key is under
     * `appearance.` even though the C++ member is on `m_Display`, and the file
     * is what this mirrors.
     */
    show_page_limit: boolean;
    /**
     * `appearance.mode_opacity_value` -> `m_Display.m_OpacityModeAlphaValue`
     * (`gerbview_settings.cpp:60-61`), default 0.6 — the alpha a layer is drawn
     * at while forced-opacity mode is on (`gerbview_painter.cpp:65-66`).
     */
    mode_opacity_value: number;
  };
  /**
   * The `GBR_DISPLAY_OPTIONS` members with no `PARAM`. See the deviation note
   * on {@link GerbviewSettings}; every default here is that class's own
   * constructor (`gerbview/gbr_display_options.h:57-68`).
   */
  display: {
    /** `m_DisplayFlashedItemsFill`, true — so "Sketch flashed items" is off. */
    flashed_items_fill: boolean;
    /** `m_DisplayLinesFill`, true. */
    lines_fill: boolean;
    /** `m_DisplayPolygonsFill`, true. */
    polygons_fill: boolean;
    /** `m_ForceOpacityMode`, false. */
    force_opacity_mode: boolean;
    /** `m_XORMode`, false. */
    xor_mode: boolean;
    /** `m_HighContrastMode`, false. */
    high_contrast_mode: boolean;
    /** `m_FlipGerberView`, false. */
    flip_gerber_view: boolean;
  };
  window: {
    grid: {
      /** `window.grid.sizes` (`app_settings.cpp:476-477`), gerbview's row. */
      sizes: GridEntry[];
      /** `window.grid.last_size` (`app_settings.cpp:480-481`), index 15. */
      last_size_idx: number;
      /** `window.grid.fast_grid_1` (`app_settings.cpp:483-484`). */
      fast_grid_1: number;
      /** `window.grid.fast_grid_2` (`app_settings.cpp:486-487`). */
      fast_grid_2: number;
      /** `window.grid.style` (`app_settings.cpp:558-559`), 0 = DOTS. */
      style: 'dots' | 'lines' | 'crosses';
      /** `window.grid.line_width` (`app_settings.cpp:549-550`), 1.0 px. */
      line_width: number;
      /** `window.grid.min_spacing` (`app_settings.cpp:552-553`), 10 px. */
      min_spacing: number;
      /** `window.grid.snap` (`app_settings.cpp:561-562`), 0 = ALWAYS. */
      snap: 0 | 1 | 2;
      /** `window.grid.show` (`app_settings.cpp:555-556`), default true. */
      show: boolean;
      /** `window.grid.overrides_enabled` (`app_settings.cpp:522-523`), true. */
      overrides_enabled: boolean;
      /**
       * EMPTY, and that is upstream's answer rather than an omission:
       * `PANEL_GRID_SETTINGS`' constructor hides the heading, the rule and
       * every row of the Grid Overrides group for `FRAME_GERBER`
       * (`common/dialogs/panel_grid_settings.cpp:62-90`), so gerbview has no
       * override control at all. `grid_settings_rows.ts`' `FRAME_GERBER: []`
       * is the same statement from the panel's side.
       */
      overrides: Record<string, GridOverride>;
    };
    cursor: {
      /** `window.cursor.cross_hair_mode` (`app_settings.cpp:567-568`). */
      crosshair: 'small' | 'full' | '45';
      /** `window.cursor.always_show_cursor` (`app_settings.cpp:564-565`), true. */
      always_show_cursor: boolean;
    };
  };
  /**
   * `EXCELLON_DEFAULTS` — the whole of Preferences > Gerber Viewer > Excellon
   * Options (`gerbview_settings.cpp:81-97`, defaults
   * `gerbview/excellon_defaults.h:51-58`). Values a drill file is *supposed* to
   * state and often does not, used by `EXCELLON_IMAGE::LoadFile` and
   * `SelectUnits` when the header is silent
   * (`excellon_read_drill_file.cpp:478-480`, `:1130-1160`).
   */
  excellon_defaults: {
    /** `excellon_defaults.unit_mm`, false — inches. */
    unit_mm: boolean;
    /** `excellon_defaults.lz_format`, true — LZ (no trailing zeros). */
    lz_format: boolean;
    /** `excellon_defaults.mm_integer_len`, FMT_INTEGER_MM = 3, range 2..6. */
    mm_integer_len: number;
    /** `excellon_defaults.mm_mantissa_len`, FMT_MANTISSA_MM = 3, range 2..6. */
    mm_mantissa_len: number;
    /** `excellon_defaults.inch_integer_len`, FMT_INTEGER_INCH = 2, range 2..6. */
    inch_integer_len: number;
    /** `excellon_defaults.inch_mantissa_len`, FMT_MANTISSA_INCH = 4, range 2..6. */
    inch_mantissa_len: number;
  };
  /**
   * `gerber_to_pcb_layers` (`gerbview_settings.cpp:74-75`), `{}`: Store
   * Choice's GERBER_DRAWLAYERS_COUNT layer ids, one per Gerber layer.
   */
  gerber_to_pcb_layers: number[];
  /** `gerber_to_pcb_copperlayers_count` (`gerbview_settings.cpp:77-78`), 2. */
  gerber_to_pcb_copperlayers_count: number;
}

export const GERBVIEW_DEFAULTS: GerbviewSettings = {
  system: {
    units: defaultUnits('gerbview'),
    last_metric_units: 'mm',
    last_imperial_units: 'mils',
  },
  appearance: {
    color_theme: '_builtin_default',
    custom_toolbars: false,
    show_border_and_titleblock: false,
    show_dcodes: false,
    show_negative_objects: false,
    page_type: 'GERBER',
    show_page_limit: false,
    mode_opacity_value: 0.6,
  },
  display: {
    flashed_items_fill: true,
    lines_fill: true,
    polygons_fill: true,
    force_opacity_mode: false,
    xor_mode: false,
    high_contrast_mode: false,
    flip_gerber_view: false,
  },
  window: {
    grid: {
      // `DefaultGridSizeList()`'s gerbview row, asked rather than restated.
      sizes: GRID_SIZE_LIST.gerbview.map(gridEntryOf),
      last_size_idx: DEFAULT_GRID_INDEX.gerbview,
      fast_grid_1: DEFAULT_GRID_INDEX.gerbview,
      fast_grid_2: DEFAULT_GRID_INDEX.gerbview + 1,
      style: 'dots',
      line_width: 1,
      min_spacing: 10,
      snap: 0,
      show: true,
      overrides_enabled: true,
      overrides: {},
    },
    cursor: {
      crosshair: 'small',
      always_show_cursor: true,
    },
  },
  excellon_defaults: {
    unit_mm: false,
    lz_format: true,
    mm_integer_len: 3,
    mm_mantissa_len: 3,
    inch_integer_len: 2,
    inch_mantissa_len: 4,
  },
  gerber_to_pcb_layers: [],
  gerber_to_pcb_copperlayers_count: 2,
};
