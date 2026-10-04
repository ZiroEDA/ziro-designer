// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Application settings, mirroring KiCad's JSON settings files.
 *
 * The shapes and key names follow KiCad's own settings classes so the stored
 * JSON reads like a KiCad `common.json` / `eeschema.json`:
 *   - COMMON_SETTINGS   (common/settings/common_settings.cpp)
 *   - EESCHEMA_SETTINGS (eeschema/eeschema_settings.cpp)
 * Defaults are KiCad 9.0's defaults, merged over on load so a new key picks up
 * its default automatically.
 *
 * **Where these live.** `SETTINGS_LOC::USER` is "this user's settings for this
 * installation" — one file, however KiCad is launched. In a hosted build the
 * account is what that maps to, so `cloud/settingsSync.ts` is the port of it and
 * localStorage is the cache underneath. localStorage *alone* would be the
 * divergence: it gives the same person a different settings file in Chrome than
 * in Firefox, and different again in a private window, which is not something
 * upstream can do.
 *
 * A build with auth disabled (no Supabase env vars, `AuthGate` a passthrough)
 * has no account for settings to belong to, and localStorage is where they live
 * there. That is that deployment's design, not a degraded hosted one.
 */

import { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { AUI_PANELS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { setColorPickerTabStore } from '@ziroeda/common/dialogs/dialog_color_picker_tab.js';
import type { RegulatorData } from '@ziroeda/pcb_calculator';
import { defaultUnits } from '@ziroeda/common/settings/app_settings_units.js';
import {
  DEFAULT_GRID_INDEX,
  GRID_SIZE_LIST,
  type GridEntry,
  type GridOverride,
  gridEntryOf,
} from '@ziroeda/common/settings/grid_settings_ui.js';
import {
  normalizeToolbarSettings,
  type ToolbarSettings,
} from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  writeRoutingSettings,
  type RoutingSettingsJson,
} from '@ziroeda/pcbnew/router/pns_routing_settings.js';

// ----- COMMON_SETTINGS ---------------------------------------------------------

// ----- EESCHEMA_SETTINGS --------------------------------------------------------

// COMMON_SETTINGS (common/settings/common_settings.cpp) lives in common/ since
// 09-26, as upstream's does, so the Preferences panels in common/dialogs can
// read it. Re-exported here for this module's callers.
export * from '@ziroeda/common/settings/common_settings.js';
import {
  COMMON_DEFAULTS,
  type CommonSettings,
  type DialogControlValue,
  type DialogControls,
  mergeCommon,
  migrateCommonSettings,
  normalizeDialogControls,
} from '@ziroeda/common/settings/common_settings.js';
export { deepMerge } from '@ziroeda/common/settings/json_settings.js';
import { deepMerge } from '@ziroeda/common/settings/json_settings.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings_internals.js';
import { KICAD_SETTINGS } from '@ziroeda/common/settings/kicad_settings.js';
import { EESCHEMA_DEFAULTS, type EeschemaSettings } from '@ziroeda/eeschema/eeschema_settings.js';
import { OnKifaceStart as eeschemaOnKifaceStart } from '@ziroeda/eeschema/eeschema.js';
import {
  FOOTPRINT_VIEWER_JSON_DEFAULTS,
  type FOOTPRINT_VIEWER_JSON_SETTINGS,
} from '@ziroeda/pcbnew/pcbnew_settings.js';
import {
  SYMBOL_EDITOR_DEFAULTS,
  type SymbolEditorSettings,
} from '@ziroeda/eeschema/symbol_editor/symbol_editor_settings.js';
import {
  SETTINGS_MANAGER,
  type SETTINGS_FILE,
  type SETTINGS_STORE,
} from '@ziroeda/common/settings/settings_manager.js';
import {
  BITMAP2CMP_SETTINGS,
  type BITMAP2CMP_SETTINGS_JSON,
} from '@ziroeda/bitmap2component/bitmap2cmp_settings.js';

export type { GridOverride } from '@ziroeda/common/settings/grid_settings_ui.js';

// ----- PCBNEW_SETTINGS ---------------------------------------------------------

/**
 * APP_SETTINGS_BASE::PRINTING (include/settings/app_settings.h:179), the slice
 * pcbnew's print dialog persists. Key names and defaults are KiCad's
 * (common/settings/app_settings.cpp "printing.*" params): note monochrome and
 * pagination default ON, and drill_marks defaults to 1 (small mark).
 */
export interface PcbnewPrinting {
  /** Print the background color. */
  background: boolean;
  /** Print in black and white. */
  monochrome: boolean;
  /** Printout scale: 0.0 = fit to page, 1.0 = 1:1, else custom. */
  scale: number;
  /** Use a different color theme for printing (else the display theme). */
  use_theme: boolean;
  /** COLOR_SETTINGS filename of the print theme. */
  color_theme: string;
  /** Print the drawing sheet (border and title block). */
  title_block: boolean;
  /** Enabled layers, as PCB_LAYER_ID ordinals. */
  layers: number[];
  /** Print mirrored. */
  mirror: boolean;
  /** Drill marks: 0 = none, 1 = small, 2 = real. */
  drill_marks: number;
  /** 0 = all layers on one page, 1 = one page per layer. */
  pagination: number;
  /** Print board edges on all pages (page-per-layer mode). */
  edge_cuts_on_all_pages: boolean;
  /** Honor the appearance manager's Objects-tab checkboxes. */
  as_item_checkboxes: boolean;
}

/** The `AUI_PANELS` keys the Search and Net Inspector panes persist (the Bottom dock only: width and direction are AUI's own). */
export type PcbAuiPanels = Pick<
  AUI_PANELS,
  'show_search' | 'show_net_inspector' | 'search_panel_height'
>;

export interface PcbnewSettings {
  /**
   * `PCBNEW_SETTINGS::m_DRCDialog` -> `DRC.*` (pcbnew_settings.cpp:350-357):
   * the three settings DIALOG_DRC reads on open and writes back on close (its
   * config menu's check items). KiCad's key is the capital `DRC`.
   */
  DRC: {
    report_all_track_errors: boolean;
    crossprobe: boolean;
    scroll_on_crossprobe: boolean;
  };
  appearance: {
    /** The editor's active color theme (APP_SETTINGS_BASE m_ColorTheme). */
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
  /**
   * APP_SETTINGS_BASE `cross_probing.*` (app_settings.cpp:290-303), edited by
   * PANEL_DISPLAY_OPTIONS. This is the copy our schematic -> board probes are
   * governed by, because upstream the *receiving* frame's settings decide what
   * a probe does (pcbnew/cross-probing.cpp:140, :221-247, :734, :776).
   */
  cross_probing: CROSS_PROBING_SETTINGS;
  /**
   * `PCBNEW_SETTINGS::m_AuiPanels` -> `aui.*` (`pcbnew_settings.cpp:74-133`),
   * the slice the docked Search and Net Inspector panes read and write:
   * `PCB_EDIT_FRAME::LoadSettings` / `SaveSettings` (`pcb_edit_frame.cpp:1739-1776`)
   * and `ToggleSearch` / `ToggleNetInspector` (`toolbars_pcb_editor.cpp:774-850`).
   */
  aui: PcbAuiPanels;
  printing: PcbnewPrinting;
  /** `m_ExportD356` (pcbnew_settings.cpp:292): the D356 file dialog's checkbox. */
  export_d356: { doNotExportUnconnectedPads: boolean };
  /**
   * Tool settings nested inside pcbnew.json. `pns` is PNS::ROUTING_SETTINGS,
   * which upstream builds as a NESTED_SETTINGS at exactly this path
   * (pns_tool_base.cpp:103), so the sub-keys are KiCad's own spellings; the
   * model, its defaults and the round-trip live in
   * `@ziroeda/pcbnew/router/pns_routing_settings.ts`.
   */
  tools: {
    pns: RoutingSettingsJson;
  };
  /**
   * `APP_SETTINGS_BASE::m_System` for pcbnew (`common/settings/app_settings.cpp:
   * 223-245`): the units the frame opens in and the last of each kind, which
   * `COMMON_TOOLS::ToggleUnits` swaps between. pcbnew persisted no units at
   * all before; the left toolbar's choice was a React toggle that reset to mm.
   */
  system: {
    units: EdaUnits;
    last_metric_units: EdaUnits;
    last_imperial_units: EdaUnits;
  };
  /**
   * `APP_SETTINGS_BASE::m_Window.grid` for pcbnew — the slice
   * `PANEL_GRID_SETTINGS` edits and the canvas snaps to
   * (`common/settings/app_settings.cpp:463-560`). Same shape as the Drawing
   * Sheet Editor's, because upstream it IS the same struct on the same base
   * class; only the defaults differ per app.
   *
   * `PcbnewSettings` had none, so the PCB editor's grid lived in a React
   * `useState` seeded from the module's `GRID_SIZE_LIST.pcbnew` — nothing
   * persisted it, nothing outside the component read it, and Preferences had
   * nothing to edit. That is why this heading had no Grids page.
   */
  window: {
    grid: {
      sizes: GridEntry[];
      last_size_idx: number;
      fast_grid_1: number;
      fast_grid_2: number;
      /**
       * The four `PANEL_GAL_OPTIONS` writes back
       * (`common/dialogs/panel_gal_options.cpp:110-124`), which live in the
       * same `window.grid` slice as the list above because upstream they are
       * the same `GRID_SETTINGS` struct — the Grids page edits its sizes and
       * Display Options edits its appearance.
       *
       * `window.grid.style` (`app_settings.cpp:558-559`), 0 = DOTS.
       */
      style: 'dots' | 'lines' | 'crosses';
      /** `window.grid.line_width` (`:549-550`), 1.0 px. */
      line_width: number;
      /** `window.grid.min_spacing` (`:552-553`), 10 px. */
      min_spacing: number;
      /** `window.grid.snap` (`:561-562`), 0 = ALWAYS. */
      snap: 0 | 1 | 2;
      /**
       * `window.grid.show` (`:555-556`), true. `ACTIONS::toggleGrid`, not a
       * page — but the Snap to grid choice's "When grid shown" arm reads it, so
       * the two have to be one value.
       */
      show: boolean;
      overrides_enabled: boolean;
      overrides: {
        connected: GridOverride;
        wires: GridOverride;
        vias: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
    /** `APP_SETTINGS_BASE::m_Window.cursor`, the other half of `PANEL_GAL_OPTIONS`. */
    cursor: {
      /** `window.cursor.cross_hair_mode` (`:567-568`), SMALL_CROSS. */
      crosshair: 'small' | 'full' | '45';
      /** `window.cursor.always_show_cursor` (`:564-565`), true. */
      always_show_cursor: boolean;
    };
  };
  /**
   * `pcb_display.*` — `PCB_DISPLAY_OPTIONS` and the `m_ViewersDisplay` half of
   * `PCB_VIEWERS_SETTINGS_BASE`, registered under one prefix
   * (`pcbnew/pcbnew_settings.cpp:225-290`).
   *
   * One JSON block because that is the file's shape, but THREE pages edit it —
   * Display Options, Origins & Axes and Editing Options — so a reset must name
   * keys and never the block. The fills are the View > Drawing Mode rows, which
   * PCB_VIEWER_TOOLS and PCB_CONTROL flip in the settings object.
   */
  pcb_display: PcbDisplayOptions;
  /**
   * `editing.*` (`pcbnew/pcbnew_settings.cpp:152-215`), the slice
   * `PANEL_EDIT_OPTIONS` edits in its `!isFootprintEditor` branch. Same
   * spellings as the footprint editor's `editing.*` where a key exists in
   * both, because upstream registers them under the same names on two
   * different settings objects.
   */
  editing: PcbEditingSettings;
  /**
   * `footprint_viewer.*` — the Footprint Library Browser's slice of
   * `PCBNEW_SETTINGS` (`pcbnew_settings.cpp:328-340`). The shape and its
   * defaults are pcbnew's (`FOOTPRINT_VIEWER_JSON_SETTINGS`), because the frame
   * that reads it lives there.
   */
  footprint_viewer: FOOTPRINT_VIEWER_JSON_SETTINGS;
}

/**
 * `editing.*` for pcbnew. `PANEL_EDIT_OPTIONS`' PCB branch
 * (`panel_edit_options.cpp:102-147`, `:181-217`) reads and writes exactly
 * these, plus four `pcb_display.*` keys that live next door.
 */
export interface PcbEditingSettings {
  /**
   * `editing.pcb_angle_snap_mode` -> `m_AngleSnapMode`, a `LEADER_MODE`
   * (DIRECT 0, DEG45 1, DEG90 2), default **DIRECT**.
   *
   * The checkbox writes DEG45 or DIRECT; DEG90 is storable and reachable only
   * from the left toolbar's Line mode group, which is the same value.
   */
  pcb_angle_snap_mode: 0 | 1 | 2;
  /** `editing.rotation_angle`, **tenths of a degree**, default 900. */
  rotation_angle: number;
  /** `editing.arc_edit_mode` -> `ARC_EDIT_MODE`, default 0. */
  arc_edit_mode: number;
  /** `editing.track_drag_action` -> `TRACK_DRAG_ACTION`, MOVE 0, DRAG 1,
   *  DRAG_FREE_ANGLE 2 (`pcbnew_settings.h:76-82`), default **DRAG**. */
  track_drag_action: 0 | 1 | 2;
  /** `editing.flip_left_right` -> `m_FlipDirection == FLIP_DIRECTION::LEFT_RIGHT`
   *  (`core/mirror.h:26-30`), default **true**. */
  flip_left_right: boolean;
  /** `editing.allow_free_pads`, false. */
  allow_free_pads: boolean;
  /** `editing.auto_fill_zones` -> `m_AutoRefillZones`, **false**. */
  auto_fill_zones: boolean;
  /**
   * `editing.magnetic_pads` / `magnetic_tracks` -> `MAGNETIC_OPTIONS`
   * (`pcbnew_settings.h:53-58`): NO_EFFECT 0, CAPTURE_CURSOR_IN_TRACK_TOOL 1,
   * CAPTURE_ALWAYS 2 — the choice's own row order. Both default to **1**,
   * unlike the footprint editor's pads, which is a two-state checkbox.
   */
  magnetic_pads: 0 | 1 | 2;
  magnetic_tracks: 0 | 1 | 2;
  /**
   * `editing.magnetic_graphics`, **true** here and drawn INVERTED: the choice
   * reads Always / Never and the panel stores `!GetSelection()`
   * (`panel_edit_options.cpp:205`).
   */
  magnetic_graphics: boolean;
  /** `editing.esc_clears_net_highlight`, true. */
  esc_clears_net_highlight: boolean;
  /** `editing.show_courtyard_collisions`, true. */
  show_courtyard_collisions: boolean;
  /** `editing.ctrl_click_highlight`, false — the Ctrl row's second radio. */
  ctrl_click_highlight: boolean;
  /** `editing.polar_coords`, false. `ACTIONS::togglePolarCoords`, not a page. */
  polar_coords: boolean;
}

/** `pcbnew_settings.cpp`'s own third argument for each. */
export const PCB_EDITING_DEFAULTS: PcbEditingSettings = {
  pcb_angle_snap_mode: 0,
  rotation_angle: 900,
  arc_edit_mode: 0,
  track_drag_action: 1,
  flip_left_right: true,
  allow_free_pads: false,
  auto_fill_zones: false,
  magnetic_pads: 1,
  magnetic_tracks: 1,
  magnetic_graphics: true,
  esc_clears_net_highlight: true,
  show_courtyard_collisions: true,
  ctrl_click_highlight: false,
  polar_coords: false,
};

/**
 * The `pcb_display.*` keys Preferences > PCB Editor > Display Options edits.
 *
 * Split out as a named type because the panel, the defaults and the reset all
 * need it and because `renderBoard` takes it whole.
 */
export interface PcbDisplayOptions {
  /**
   * `pcb_display.net_names_mode` -> `m_Display.m_NetNames`, default **3**
   * (`pcbnew_settings.cpp:237-238`), range 0..3.
   *
   * 0 do not show, 1 pads, 2 tracks, 3 both — the `m_ShowNetNamesOption`
   * wxChoice's own order, which is why the stored value IS the selection index
   * here and is not for the clearance choice below.
   */
  net_names_mode: 0 | 1 | 2 | 3;
  /** `pcb_display.pad_numbers` -> `m_ViewersDisplay.m_DisplayPadNumbers`, true. */
  pad_numbers: boolean;
  /**
   * `pcb_display.track_clearance_mode` -> `m_Display.m_TrackClearance`,
   * default `SHOW_WITH_VIA_WHILE_ROUTING` = **2** (`pcbnew_settings.cpp:264`).
   *
   * The stored value is the `TRACK_CLEARANCE_MODE` enum, NOT the choice's row:
   * `clearanceModeMap` (`panel_display_options.cpp:29-36`) maps between them
   * and the two orders differ. See `TRACK_CLEARANCE_CHOICES`.
   */
  track_clearance_mode: 0 | 1 | 2 | 3 | 4;
  /** `pcb_display.pad_clearance` -> `m_Display.m_PadClearance`, true. */
  pad_clearance: boolean;
  /**
   * `pcb_display.pad_use_via_color_for_normal_th_padstacks` ->
   * `m_Display.m_UseViaColorForNormalTHPadstacks`, **false**.
   */
  pad_use_via_color_for_normal_th_padstacks: boolean;
  /**
   * `pcb_display.force_show_fields_when_fp_selected` ->
   * `m_Display.m_ForceShowFieldsWhenFPSelected`, true.
   */
  force_show_fields_when_fp_selected: boolean;
  /** `pcb_display.live_3d_refresh` -> `m_Display.m_Live3DRefresh`, **false**. */
  live_3d_refresh: boolean;

  // ---- Origins & Axes (`PANEL_PCBNEW_DISPLAY_ORIGIN`) ---------------------

  /**
   * `pcb_display.origin_mode` -> `m_Display.m_DisplayOrigin`, a
   * `PCB_DISPLAY_ORIGIN` (`pcbnew_settings.h:95-100`): PAGE 0, AUX 1, GRID 2,
   * default **PAGE**.
   *
   * `PCB_BASE_FRAME::GetUserOrigin()` turns it into the point the X/Y status
   * panes are measured from, which is the whole of what it does — the board's
   * geometry is untouched.
   */
  origin_mode: 0 | 1 | 2;
  /** `pcb_display.origin_invert_x_axis`, false — "Increases left". */
  origin_invert_x_axis: boolean;
  /** `pcb_display.origin_invert_y_axis`, false — "Increases up". */
  origin_invert_y_axis: boolean;

  // ---- Editing Options' four neighbours in this block ---------------------

  /**
   * `pcb_display.ratsnest_global` -> `m_ShowGlobalRatsnest`, true
   * (`pcbnew_settings.cpp:252-253`): the Appearance panel's ratsnest checkbox
   * and its "None" radio, and PCB_CONTROL's Show Ratsnest.
   */
  ratsnest_global: boolean;
  /** `pcb_display.ratsnest_footprint` -> `m_ShowModuleRatsnest`, true. */
  ratsnest_footprint: boolean;
  /** `pcb_display.ratsnest_curved` -> `m_DisplayRatsnestLinesCurved`, false. */
  ratsnest_curved: boolean;
  /** `pcb_display.ratsnest_thickness`, **0.5** — a multiplier, not a distance. */
  ratsnest_thickness: number;
  /** `pcb_display.show_page_borders` -> `m_ShowPageLimits`, true. */
  show_page_borders: boolean;

  // ---- View > Drawing Mode -------------------------------------------------

  /**
   * `pcb_display.graphic_items_fill` (`pcbnew_settings.cpp:225-226`) and
   * `pcb_display.graphics_fill` (`:231-232`): TWO PARAMs over one
   * `m_ViewersDisplay.m_DisplayGraphicsFill`, true. Load reads them in that
   * order, so the second wins; Save writes both.
   */
  graphic_items_fill: boolean;
  graphics_fill: boolean;
  /** `pcb_display.text_fill` -> `m_ViewersDisplay.m_DisplayTextFill`, true (`:234-235`). */
  text_fill: boolean;
  /** `pcb_display.pad_fill` -> `m_ViewersDisplay.m_DisplayPadFill`, true (`:246-247`). */
  pad_fill: boolean;
  /** `pcb_display.track_fill` -> `m_Display.m_DisplayPcbTrackFill`, true (`:267-268`). */
  track_fill: boolean;
  /** `pcb_display.via_fill` -> `m_Display.m_DisplayViaFill`, true (`:270-271`). */
  via_fill: boolean;
}

/** `pcbnew_settings.cpp`'s own third argument for each key. */
export const PCB_DISPLAY_DEFAULTS: PcbDisplayOptions = {
  net_names_mode: 3,
  pad_numbers: true,
  track_clearance_mode: 2,
  pad_clearance: true,
  pad_use_via_color_for_normal_th_padstacks: false,
  force_show_fields_when_fp_selected: true,
  live_3d_refresh: false,
  origin_mode: 0,
  origin_invert_x_axis: false,
  origin_invert_y_axis: false,
  ratsnest_global: true,
  ratsnest_footprint: true,
  ratsnest_curved: false,
  ratsnest_thickness: 0.5,
  show_page_borders: true,
  graphic_items_fill: true,
  graphics_fill: true,
  text_fill: true,
  pad_fill: true,
  track_fill: true,
  via_fill: true,
};

export const PCBNEW_DEFAULTS: PcbnewSettings = {
  DRC: {
    report_all_track_errors: false,
    crossprobe: true,
    scroll_on_crossprobe: true,
  },
  appearance: {
    color_theme: '_builtin_default',
    custom_toolbars: false,
  },
  cross_probing: { ...new CROSS_PROBING_SETTINGS() },
  // The defaults are `AUI_PANELS`' own, not a second copy of them.
  aui: (({ show_search, show_net_inspector, search_panel_height }) => ({
    show_search,
    show_net_inspector,
    search_panel_height,
  }))(new AUI_PANELS()),
  tools: {
    pns: writeRoutingSettings(DEFAULT_ROUTING_SETTINGS),
  },
  printing: {
    background: false,
    monochrome: true,
    scale: 1.0,
    use_theme: false,
    color_theme: '',
    title_block: false,
    layers: [],
    mirror: false,
    drill_marks: 1,
    pagination: 1,
    edge_cuts_on_all_pages: true,
    as_item_checkboxes: false,
  },
  export_d356: { doNotExportUnconnectedPads: false },
  system: {
    // The `app_settings.cpp:228-238` branch, asked rather than restated.
    units: defaultUnits('pcbnew'),
    last_metric_units: 'mm',
    last_imperial_units: 'mils',
  },
  window: {
    grid: {
      // `DefaultGridSizeList()`'s pcbnew row and `defaultGridIdx`, asked rather
      // than restated — the same table the grid selector and the canvas read.
      sizes: GRID_SIZE_LIST.pcbnew.map(gridEntryOf),
      last_size_idx: DEFAULT_GRID_INDEX.pcbnew,
      // `fast_grid_1 = defaultGridIdx`, `fast_grid_2 = defaultGridIdx + 1`
      // (app_settings.cpp:483-487).
      fast_grid_1: DEFAULT_GRID_INDEX.pcbnew,
      fast_grid_2: DEFAULT_GRID_INDEX.pcbnew + 1,
      // `PANEL_GAL_OPTIONS`' four, at `app_settings.cpp`'s own defaults.
      style: 'dots',
      line_width: 1.0,
      min_spacing: 10,
      snap: 0,
      show: true,
      // The `else` arm of `app_settings.cpp:522-546` — the one every frame that
      // is NOT eeschema or the symbol editor takes. Every flag is false, and
      // the five indices are 16, 19, 18, 18 and 15 into pcbnew's own grid row:
      // 0.25 mm for footprints and pads, 0.05 mm for tracks, 0.1 mm for vias
      // and text, 0.5 mm for graphics. Written as the sizes they name rather
      // than as indices, because `GridOverride` stores the size string and an
      // index into a list the user can reorder is not a stable value.
      overrides_enabled: true,
      overrides: {
        connected: { enabled: false, size: '0.25 mm' },
        wires: { enabled: false, size: '0.05 mm' },
        vias: { enabled: false, size: '0.1 mm' },
        text: { enabled: false, size: '0.1 mm' },
        graphics: { enabled: false, size: '0.5 mm' },
      },
    },
    cursor: { crosshair: 'small', always_show_cursor: true },
  },
  pcb_display: { ...PCB_DISPLAY_DEFAULTS },
  editing: { ...PCB_EDITING_DEFAULTS },
  footprint_viewer: structuredClone(FOOTPRINT_VIEWER_JSON_DEFAULTS),
};

// ----- PL_EDITOR_SETTINGS ------------------------------------------------------

export {
  type PlEditorSettings,
  PL_EDITOR_DEFAULTS,
} from '@ziroeda/pagelayout_editor/pl_editor_settings.js';
import {
  type PlEditorSettings,
  PL_EDITOR_DEFAULTS,
} from '@ziroeda/pagelayout_editor/pl_editor_settings.js';

// ----- SYMBOL_EDITOR_SETTINGS ("symbol_editor.json") ---------------------------

// ----- GERBVIEW_SETTINGS ("gerbview.json") -------------------------------------

export { type GerbviewSettings, GERBVIEW_DEFAULTS } from '@ziroeda/gerbview/gerbview_settings.js';
import { type GerbviewSettings, GERBVIEW_DEFAULTS } from '@ziroeda/gerbview/gerbview_settings.js';

// ----- FOOTPRINT_EDITOR_SETTINGS ("fpedit.json") -------------------------------

/**
 * The Footprint Editor's own settings file — `PCB_VIEWERS_SETTINGS_BASE( "fpedit", … )`
 * (`pcbnew/footprint_editor_settings.cpp:46`).
 *
 * Only the two things the library tree needs are here. The rest of
 * FOOTPRINT_EDITOR_SETTINGS (design settings, magnetic items, layer presets)
 * either lives elsewhere in this port already or is not persisted yet, and a
 * key that nothing reads is a key that can drift.
 */
/**
 * `3d_viewer.json` — `EDA_3D_VIEWER_SETTINGS`, an `APP_SETTINGS_BASE` like the
 * rest (`GetAppSettings<EDA_3D_VIEWER_SETTINGS>( "3d_viewer" )`,
 * `pcbnew/pcbnew.cpp:483`).
 *
 * A file of its own, not a corner of `pcbnew.json`, which is why the 3D viewer
 * has a Preferences page and a `3d_viewer-toolbars` file of its own too. Only
 * the key this app reads is transcribed, the same partial shape
 * {@link FpEditSettings} takes; the viewer's render options live in its own
 * state and have not needed a settings file yet.
 */
export interface Viewer3dSettings {
  appearance: {
    /** `appearance.custom_toolbars` -> `APP_SETTINGS_BASE::m_CustomToolbars`
     *  (`common/settings/app_settings.cpp:285-286`). */
    custom_toolbars: boolean;
  };
  /** `aui.*` (`eda_3d_viewer_settings.cpp:231-234`): the appearance pane. */
  aui: {
    /** `aui.show_layer_manager`, **true**. */
    show_layer_manager: boolean;
    /** `aui.right_panel_width`, **-1** — the pane's BestSize until dragged. */
    right_panel_width: number;
  };
  /**
   * `use_stackup_colors` (`:449`). Stored **true**, but the first open of the
   * frame clears it while turning `LEGACY_PRESET_FLAG` into
   * FOLLOW_PLOT_SETTINGS (eda_3d_viewer_frame.cpp:570-583); the stored default
   * here is that post-first-open state, since the flag never survives it.
   */
  use_stackup_colors: boolean;
  /** `current_layer_preset` (`:453`): FOLLOW_PCB, FOLLOW_PLOT_SETTINGS, a preset name, or "" for custom. */
  current_layer_preset: string;
  /** `layer_presets` (`:451`), `LAYER_PRESET_3D` rows — the first open adds "legacy colors". */
  layer_presets: Viewer3dLayerPreset[];
  /**
   * The pane's swatch edits. Upstream `SetLayerColors` writes them into the
   * colour theme's `3d_viewer.*` entries (board_adapter.cpp:760-769); ours
   * has no user theme for those keys, so they live here, keyed by flag.
   */
  color_overrides: Record<string, string>;
  /**
   * `render.*` — `EDA_3D_VIEWER_SETTINGS::m_Render`, the half
   * `PANEL_3D_DISPLAY_OPTIONS` and `PANEL_3D_OPENGL_OPTIONS` edit
   * (`3d-viewer/3d_viewer/eda_3d_viewer_settings.cpp:239-300`, `:410-430`).
   *
   * The `raytrace_*` block is deliberately absent — see `OMITTED_PAGES`. A key
   * with no page and no reader is a key that drifts.
   */
  render: Viewer3dRender;
  /** `camera.*` (`:431-438`), the three the General page's Camera group edits. */
  camera: Viewer3dCamera;
}

/**
 * `LAYER_PRESET_3D` (eda_3d_viewer_settings.h): the visibility set as flag
 * names and the colour map as CSS strings, the way `PARAM_LAYER_PRESET_3D`
 * serialises them.
 */
export interface Viewer3dLayerPreset {
  name: string;
  layers: string[];
  colors: Record<string, string>;
}

/** `EDA_3D_VIEWER_SETTINGS::m_Render`, restricted to the two shipped pages. */
export interface Viewer3dRender {
  // ---- General (`PANEL_3D_DISPLAY_OPTIONS`) --------------------------------

  /** `render.clip_silk_on_via_annulus`, **false**. */
  clip_silk_on_via_annulus: boolean;
  /** `render.subtract_mask_from_silk`, **false**. */
  subtract_mask_from_silk: boolean;
  /** `render.show_zones`, true. */
  show_zones: boolean;
  /**
   * `render.plated_and_bare_copper` -> `m_Render.differentiate_plated_copper`,
   * **false**. The key and the field are spelled differently upstream, which is
   * exactly the pairing to get wrong.
   */
  plated_and_bare_copper: boolean;
  /**
   * `render.material_mode` -> `MATERIAL_MODE`
   * (`3d-viewer/3d_enums.h`): NORMAL 0, DIFFUSE_ONLY 1, CAD_MODE 2, default
   * NORMAL. The choice reads Realistic / Solid colors / CAD colors.
   */
  material_mode: 0 | 1 | 2;

  // ---- Realtime Renderer (`PANEL_3D_OPENGL_OPTIONS`) -----------------------

  // ---- the appearance pane's rows (`SetVisibleLayers`, board_adapter.cpp:772-805) --
  /** `render.show_*`, the eye toggles; the third arguments of `:330-420`. */
  show_board_body: boolean;
  show_plated_barrels: boolean;
  show_copper_top: boolean;
  show_copper_bottom: boolean;
  show_silkscreen_top: boolean;
  show_silkscreen_bottom: boolean;
  show_soldermask_top: boolean;
  show_soldermask_bottom: boolean;
  show_solderpaste: boolean;
  show_adhesive: boolean;
  show_comments: boolean;
  show_drawings: boolean;
  show_eco1: boolean;
  show_eco2: boolean;
  /** `render.show_user1` .. `show_user45`, all **false**. */
  show_user: boolean[];
  show_footprints_normal: boolean;
  show_footprints_insert: boolean;
  show_footprints_virtual: boolean;
  show_footprints_not_in_posfile: boolean;
  /** `render.show_footprints_dnp`, **false**. */
  show_footprints_dnp: boolean;
  show_fp_references: boolean;
  show_fp_values: boolean;
  show_fp_text: boolean;
  /** `render.show_navigator`, **true**. */
  show_navigator: boolean;
  /** `render.opengl_show_off_board_silk`, **false**. */
  opengl_show_off_board_silk: boolean;
  /** `render.use_board_editor_copper_colors`, **false**. */
  use_board_editor_copper_colors: boolean;

  /** `render.opengl_show_model_bbox`, **false**. */
  opengl_show_model_bbox: boolean;
  /** `render.opengl_copper_thickness`, **false**. */
  opengl_copper_thickness: boolean;
  /** `render.opengl_highlight_on_rollover`, **true**. */
  opengl_highlight_on_rollover: boolean;
  /**
   * `render.opengl_AA_mode` -> `ANTIALIASING_MODE`: NONE 0, 2X 1, 4X 2, 8X 3,
   * default **8X** — the one control on either page whose default is the LAST
   * row rather than the first.
   */
  opengl_AA_mode: 0 | 1 | 2 | 3;
  /** `render.opengl_selection_color`, `COLOR4D( 0, 1, 0, 1 )` — pure green. */
  opengl_selection_color: string;
  /** `render.opengl_AA_disableOnMove`, false. */
  opengl_AA_disableOnMove: boolean;
  /** `render.opengl_thickness_disableOnMove`, false. */
  opengl_thickness_disableOnMove: boolean;
  /** `render.opengl_vias_disableOnMove` -> `m_Render.opengl_microvias_disableOnMove`,
   *  false. Another key/field pair that is not the same word. */
  opengl_vias_disableOnMove: boolean;
  /** `render.opengl_holes_disableOnMove`, false. */
  opengl_holes_disableOnMove: boolean;
}

/** `EDA_3D_VIEWER_SETTINGS::m_Camera`'s three. */
export interface Viewer3dCamera {
  /** `camera.animation_enabled`, **true**. */
  animation_enabled: boolean;
  /** `camera.moving_speed_multiplier`, **3** — the slider's 1..5 midpoint. */
  moving_speed_multiplier: number;
  /** `camera.rotation_increment`, **10.0** degrees. */
  rotation_increment: number;
}

/** `eda_3d_viewer_settings.cpp`'s own third argument for each. */
export const VIEWER3D_RENDER_DEFAULTS: Viewer3dRender = {
  show_board_body: true,
  show_plated_barrels: true,
  show_copper_top: true,
  show_copper_bottom: true,
  show_silkscreen_top: true,
  show_silkscreen_bottom: true,
  show_soldermask_top: true,
  show_soldermask_bottom: true,
  show_solderpaste: true,
  show_adhesive: true,
  show_comments: true,
  show_drawings: true,
  show_eco1: true,
  show_eco2: true,
  show_user: Array.from({ length: 45 }, () => false),
  show_footprints_normal: true,
  show_footprints_insert: true,
  show_footprints_virtual: true,
  show_footprints_not_in_posfile: true,
  show_footprints_dnp: false,
  show_fp_references: true,
  show_fp_values: true,
  show_fp_text: true,
  show_navigator: true,
  opengl_show_off_board_silk: false,
  use_board_editor_copper_colors: false,
  clip_silk_on_via_annulus: false,
  subtract_mask_from_silk: false,
  show_zones: true,
  plated_and_bare_copper: false,
  material_mode: 0,
  opengl_show_model_bbox: false,
  opengl_copper_thickness: false,
  opengl_highlight_on_rollover: true,
  opengl_AA_mode: 3,
  // [data] `PARAM<COLOR4D>( "render.opengl_selection_color", …,
  // COLOR4D( 0.0, 1.0, 0.0, 1.0 ) )` (`eda_3d_viewer_settings.cpp:261-263`).
  opengl_selection_color: 'rgb(0,255,0)',
  opengl_AA_disableOnMove: false,
  opengl_thickness_disableOnMove: false,
  opengl_vias_disableOnMove: false,
  opengl_holes_disableOnMove: false,
};

export const VIEWER3D_CAMERA_DEFAULTS: Viewer3dCamera = {
  animation_enabled: true,
  moving_speed_multiplier: 3,
  rotation_increment: 10,
};

export const VIEWER3D_DEFAULTS: Viewer3dSettings = {
  appearance: { custom_toolbars: false },
  aui: { show_layer_manager: true, right_panel_width: -1 },
  use_stackup_colors: false,
  current_layer_preset: 'follow_plot_settings',
  layer_presets: [],
  color_overrides: {},
  render: { ...VIEWER3D_RENDER_DEFAULTS },
  camera: { ...VIEWER3D_CAMERA_DEFAULTS },
};

export function mergeViewer3d(stored: unknown): Viewer3dSettings {
  return deepMerge(structuredClone(VIEWER3D_DEFAULTS), stored);
}

/**
 * One entry of `design_settings.default_footprint_text_items` — upstream's
 * `TEXT_ITEM_INFO{ m_Text, m_Visible, m_Layer }`, stored as the three-element
 * JSON array `footprint_editor_settings.cpp:145-152` writes.
 */
export interface FpTextItem {
  /** `m_Text`. `${REFERENCE}` and friends are text variables, not resolved here. */
  text: string;
  /** `m_Visible`. Only the first two rows have a control for it. */
  visible: boolean;
  /** `LSET::Name( m_Layer )` — the canonical name, e.g. `F.SilkS`. */
  layer: string;
}

/**
 * A Graphics Defaults row that carries only a line width: Edge Cuts and
 * Courtyards, whose four text cells the panel disables
 * (`panel_fp_editor_graphics_defaults.cpp:98-104`) because no `*_text_*` param
 * exists for them.
 */
export interface FpGraphicsLineClass {
  /** `design_settings.<class>_line_width`, **millimetres**. */
  line_width: number;
}

/** A Graphics Defaults row that carries text as well — silk, copper, fab, others. */
export interface FpGraphicsTextClass extends FpGraphicsLineClass {
  /** `design_settings.<class>_text_size_h`, mm. */
  text_size_h: number;
  /** `design_settings.<class>_text_size_v`, mm. */
  text_size_v: number;
  /** `design_settings.<class>_text_thickness`, mm. */
  text_thickness: number;
  /** `design_settings.<class>_text_italic`, false. */
  text_italic: boolean;
}

export interface FpEditSettings {
  /**
   * `APP_SETTINGS_BASE`'s `system.*`, the block every app settings file
   * carries. `fpedit` takes the `else` arm of the units branch
   * (`common/settings/app_settings.cpp:229-238`) — the imperial side names
   * only `pl_editor`, `eeschema` and `symbol_editor` — so it opens on **MM**.
   *
   * The frame's units button is what writes it, and the Grids page is what
   * reads it: `PANEL_GRID_SETTINGS` prints its rows through the frame's
   * `UNITS_PROVIDER` (`pcbnew/pcbnew.cpp:309-323` passes the frame), so a
   * footprint editor switched to mm shows every grid row in mm.
   */
  system: {
    /** `system.units`, MM on this branch. */
    units: EdaUnits;
    /** `system.last_metric_units` (`:240-241`), EDA_UNITS::MM. */
    last_metric_units: EdaUnits;
    /** `system.last_imperial_units` (`:243-244`), EDA_UNITS::MILS — what Ctrl+U returns to. */
    last_imperial_units: EdaUnits;
  };
  /**
   * `APP_SETTINGS_BASE`'s own block, which every app settings file carries.
   * Only the keys this app reads are transcribed, the same partial shape the
   * rest of this interface takes.
   */
  appearance: {
    /**
     * `appearance.color_theme` -> `APP_SETTINGS_BASE::m_ColorTheme`
     * (`common/settings/app_settings.cpp:282-284`). Written by the Colors page,
     * and only on its "Use theme:" branch — `PANEL_FP_EDITOR_COLOR_SETTINGS`
     * otherwise defers to pcbnew's, exactly as the symbol editor defers to
     * eeschema's (see {@link FpEditSettings.use_board_editor_color_settings}).
     */
    color_theme: string;
    /** `appearance.custom_toolbars` -> `APP_SETTINGS_BASE::m_CustomToolbars`
     *  (`common/settings/app_settings.cpp:285-286`), the Toolbars page's
     *  "Customize toolbars" checkbox. */
    custom_toolbars: boolean;
  };
  window: {
    /**
     * `PARAM<int>( "window.lib_width", &m_LibWidth, 250 )`
     * (`footprint_editor_settings.cpp:69-70`).
     *
     * `FOOTPRINT_EDIT_FRAME` writes `m_treePane->GetSize().x` into it from
     * `SaveSettings` (`:837`) and whenever the pane is hidden (`:414`), and
     * restores it with `SetAuiPaneSize` on open (`:279-280`) and whenever the
     * pane is shown again (`:410`). The 250 is the same number the pane's
     * `.MinSize( FromDIP( 250 ), … ).BestSize( FromDIP( 250 ), -1 )` declares,
     * which is why a fresh install opens at exactly the default.
     */
    lib_width: number;
    /**
     * `APP_SETTINGS_BASE::m_Window.grid`, the slice the Grids page and the
     * Display Options page's `PANEL_GAL_OPTIONS` share
     * (`common/settings/app_settings.cpp:458-562`).
     */
    grid: {
      /**
       * `window.grid.sizes`, seeded from `DefaultGridSizeList()`. `fpedit`
       * falls on the **`else`** row of that switch (`:641-664`) — pcbnew's
       * twenty-two grids — because the switch names only eeschema,
       * symbol_editor, pl_editor and gerbview.
       */
      sizes: GridEntry[];
      /**
       * `window.grid.last_size`. `defaultGridIdx` is **15** for `fpedit`, the
       * same `else` arm at `:463-481`, which is `0.5 mm`.
       */
      last_size_idx: number;
      /** `window.grid.fast_grid_1` (`:483-484`), `defaultGridIdx`. */
      fast_grid_1: number;
      /** `window.grid.fast_grid_2` (`:486-487`), `defaultGridIdx + 1`. */
      fast_grid_2: number;
      /** `window.grid.style` (`:558-559`), 0 = DOTS. */
      style: 'dots' | 'lines' | 'crosses';
      /** `window.grid.line_width` (`:549-550`), 1.0 px. */
      line_width: number;
      /** `window.grid.min_spacing` (`:552-553`), 10 px. */
      min_spacing: number;
      /** `window.grid.snap` (`:561-562`), 0 = ALWAYS. */
      snap: 0 | 1 | 2;
      /** `window.grid.show` (`:555-556`), true. `ACTIONS::toggleGrid`, not a page. */
      show: boolean;
      /** `window.grid.overrides_enabled` (`:524-525`), true. */
      overrides_enabled: boolean;
      /**
       * The three override rows `PANEL_GRID_SETTINGS` leaves standing for
       * `FRAME_FOOTPRINT_EDITOR` (`common/dialogs/panel_grid_settings.cpp:
       * 53-92`): vias is hidden outside pcbnew, and connected and wires are
       * hidden outside the four schematic frames — except that connected is
       * re-shown with the label `_( "Pads:" )` at `:57`. Wires really is gone,
       * so there is no `wires` key here; `OVERRIDE_ROWS.FRAME_FOOTPRINT_EDITOR`
       * is the same statement from the panel's side.
       */
      overrides: {
        connected: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
    /** `APP_SETTINGS_BASE::m_Window.cursor`, the other half of `PANEL_GAL_OPTIONS`. */
    cursor: {
      /** `window.cursor.cross_hair_mode` (`:567-568`), SMALL_CROSS. */
      crosshair: 'small' | 'full' | '45';
      /** `window.cursor.always_show_cursor` (`:564-565`), true. */
      always_show_cursor: boolean;
    };
  };
  /**
   * `PCB_VIEWERS_SETTINGS_BASE::m_ViewersDisplay`, registered under
   * `pcb_display.*` by this app rather than by the base class
   * (`footprint_editor_settings.cpp:95-107`).
   *
   * These four are **not** on any Preferences page in the footprint editor:
   * they are the View menu's fill toggles and the Show Pad Numbers toggle,
   * which is why they live here and not beside a panel. `PANEL_DISPLAY_OPTIONS`
   * puts `m_OptDisplayPadNumber` in front of `m_DisplayPadNumbers`, but only on
   * its PCB page — see `PanelFpDisplayOptions`.
   */
  pcb_display: {
    /** `pcb_display.graphics_fill` -> `m_DisplayGraphicsFill`, true. */
    graphics_fill: boolean;
    /** `pcb_display.text_fill` -> `m_DisplayTextFill`, true. */
    text_fill: boolean;
    /** `pcb_display.pad_fill` -> `m_DisplayPadFill`, true. */
    pad_fill: boolean;
    /** `pcb_display.pad_numbers` -> `m_DisplayPadNumbers`, true. */
    pad_numbers: boolean;
  };
  /**
   * `editing.*` — the Editing Options page's slice
   * (`footprint_editor_settings.cpp:109-137`).
   *
   * `m_ArcEditMode` is deliberately absent. `PANEL_EDIT_OPTIONS` writes
   * `cfg->m_ArcEditMode` in the footprint-editor branch too
   * (`panel_edit_options.cpp:177`), but `FOOTPRINT_EDITOR_SETTINGS` registers
   * **no** `editing.arc_edit_mode` param for it — only `PCBNEW_SETTINGS` does
   * (`pcbnew_settings.cpp:183-185`) — so upstream the choice takes effect for
   * the session and is gone at the next launch. Mirrored: see
   * `editors/footprint/arc_edit_mode.ts`.
   */
  editing: {
    /**
     * `editing.magnetic_pads` -> `m_MagneticItems.pads`, `CAPTURE_ALWAYS` (2).
     * The FP editor's page shows it as a **checkbox**, not pcbnew's three-way
     * choice: checked is `CAPTURE_ALWAYS` and clear is `NO_EFFECT` (0)
     * (`panel_edit_options.cpp:170-172`), so `CAPTURE_CURSOR_IN_TRACK_TOOL` is
     * unreachable from this editor and still storable, exactly as upstream.
     */
    magnetic_pads: 0 | 1 | 2;
    /** `editing.magnetic_graphics` -> `m_MagneticItems.graphics`, true. */
    magnetic_graphics: boolean;
    /**
     * `editing.magnetic_all_layers` -> `m_MagneticItems.allLayers`, false. No
     * control on any footprint-editor page; `PCB_GRID_HELPER` reads it.
     */
    magnetic_all_layers: boolean;
    /**
     * `editing.polar_coords` -> `m_PolarCoords`, false. The status bar's
     * polar/cartesian toggle, not a Preferences control.
     */
    polar_coords: boolean;
    /**
     * `editing.rotation_angle`, **tenths of a degree**, 900.
     *
     * Stored in tenths because that is what the `PARAM_LAMBDA<int>` writes —
     * `m_RotationAngle.AsTenthsOfADegree()` (`:126-137`) — and the setter
     * ignores a stored 0, which is upstream's guard against a file that would
     * otherwise make every rotation a no-op.
     */
    rotation_angle: number;
    /**
     * `editing.fp_angle_snap_mode` -> `m_AngleSnapMode`, `LEADER_MODE::DEG45`
     * (1) (`libs/kimath/include/geometry/geometry_utils.h:45-50`: DIRECT 0,
     * DEG45 1, DEG90 2).
     *
     * The page shows it as one checkbox, "Constrain actions to H, V, 45
     * degrees": checked is DEG45 and clear is DIRECT
     * (`panel_edit_options.cpp:174-175`), so DEG90 is likewise storable and
     * unreachable from the page.
     */
    fp_angle_snap_mode: 0 | 1 | 2;
  };
  /**
   * `origin_invert_x_axis` -> `m_DisplayInvertXAxis`, false — Origins & Axes'
   * "Increases left" (`footprint_editor_settings.cpp:118-123`).
   *
   * Top-level, not under `editing.` or `pcb_display.`, because that is where
   * this app puts it; pcbnew stores the same two under
   * `pcb_display.origin_invert_*`. Two files, two paths, one control.
   */
  origin_invert_x_axis: boolean;
  /** `origin_invert_y_axis` -> `m_DisplayInvertYAxis`, false — "Increases up". */
  origin_invert_y_axis: boolean;
  /**
   * `design_settings.*` — the slice `FOOTPRINT_EDITOR_SETTINGS` keeps in a
   * whole `BOARD_DESIGN_SETTINGS` of its own, with the comment upstream leaves
   * on it: "Only some of these settings are actually used for footprint
   * editing" (`include/footprint_editor_settings.h:60`). Only the ones a
   * Preferences page writes are here, which is the same partial shape the rest
   * of this interface takes.
   *
   * Three pages share it — Footprint Defaults, Graphics Defaults and User Layer
   * Names — because upstream all three hold a reference to the same
   * `m_DesignSettings` member.
   */
  design_settings: {
    /**
     * `design_settings.default_footprint_text_items`
     * (`footprint_editor_settings.cpp:139-186`), a JSON **array of triples**:
     * `[ text, visible, layerName ]`, in that order.
     *
     * The first two entries are the Reference designator and the Value —
     * `PANEL_FP_EDITOR_FIELD_DEFAULTS::loadFPSettings` puts exactly
     * `min( 2, size )` of them in the upper grid and everything after index 1
     * in the lower one (`panel_fp_editor_field_defaults.cpp:216-247`), so the
     * position in this list IS which grid a row belongs to. A row beyond the
     * first two is always written back visible, because the lower grid has no
     * Show column (`:296-303`).
     *
     * The layer is stored as its canonical name (`LSET::Name`), not its number,
     * which is why these are strings.
     */
    default_footprint_text_items: FpTextItem[];
    /**
     * `design_settings.default_footprint_layer_names`, a
     * `PARAM_MAP<wxString>` over `BOARD_DESIGN_SETTINGS::m_UserLayerNames`
     * (`:188-189`): canonical layer name -> the name to show. Free-form, so it
     * is normalised rather than `deepMerge`d — see {@link mergeFpEdit}.
     */
    default_footprint_layer_names: Record<string, string>;
    /**
     * `design_settings.user_layer_count` (`:191-195`), default **4** — how many
     * `User.n` layers a new footprint gets. The page offers 0..9
     * (`panel_fp_user_layer_names_base.cpp:29-32`).
     */
    user_layer_count: number;
    /**
     * The six layer classes of the Graphics Defaults grid, in the row order
     * `panel_fp_editor_graphics_defaults.cpp:47-56` declares: silk, copper,
     * edges, courtyard, fab, others.
     *
     * **Millimetres**, because that is what the file holds: every one of these
     * is a `PARAM_SCALED<int>( …, pcbIUScale.MM_PER_IU )`
     * (`footprint_editor_settings.cpp:207-290`), which stores IU scaled to mm
     * and reads it back scaled up. Storing IU here would be a different file
     * from KiCad's.
     *
     * Edge Cuts and Courtyards carry a line width and nothing else: they have
     * no `*_text_*` params at all, and the panel greys those four cells out
     * (`:98-104`). That absence is the type, not a comment.
     */
    silk: FpGraphicsTextClass;
    copper: FpGraphicsTextClass;
    edges: FpGraphicsLineClass;
    courtyard: FpGraphicsLineClass;
    fab: FpGraphicsTextClass;
    others: FpGraphicsTextClass;
    /**
     * `design_settings.dimensions.*` (`:295-330`) — `PANEL_SETUP_DIMENSIONS`,
     * which upstream is ONE class Board Setup and this page both construct
     * (`panel_fp_editor_graphics_defaults.cpp:70`).
     *
     * `arrow_length` and `extension_offset` are plain `PARAM<int>`, so unlike
     * the block above they really are **IU**.
     */
    dimensions: {
      /** `DIM_UNITS_MODE` (`pcbnew/pcb_dimension.h:71-77`): INCH 0, MILS 1, MM 2, AUTOMATIC 3. */
      units: 0 | 1 | 2 | 3;
      /** `DIM_PRECISION` (`:46-58`), X_XXXX = 4. The page offers the first six. */
      precision: number;
      /** `DIM_UNITS_FORMAT` (`:39-44`): NO_SUFFIX 0, BARE_SUFFIX 1, PAREN_SUFFIX 2. */
      units_format: 0 | 1 | 2;
      /** `design_settings.dimensions.suppress_zeroes`, true. */
      suppress_zeroes: boolean;
      /**
       * `DIM_TEXT_POSITION` (`:61-66`): OUTSIDE 0, INLINE 1. MANUAL (2) is
       * reachable on an item but not from this page — the param's range stops
       * at INLINE, with upstream's own note "excluding DIM_TEXT_POSITION::MANUAL".
       */
      text_position: 0 | 1;
      /** `design_settings.dimensions.keep_text_aligned`, true. */
      keep_text_aligned: boolean;
      /** `dimensions.arrow_length` in **IU**, `MilsToIU( 50 )`. */
      arrow_length: number;
      /** `dimensions.extension_offset` in **IU**, `mmToIU( 0.5 )`. */
      extension_offset: number;
    };
  };
  /**
   * `APP_SETTINGS_BASE::m_LibTree`, the `lib_tree.*` params every app settings
   * file carries (`common/settings/app_settings.cpp:140-171`). The Footprint
   * Editor's tree reads and writes this one, the symbol editor's reads
   * `eeschema.json`'s.
   */
  lib_tree: {
    /** `lib_tree.columns` — the shown columns, "Item" always first. */
    columns: string[];
    /**
     * `lib_tree.column_widths`, a free-form `{ column: px }` object written by
     * a `PARAM_LAMBDA<nlohmann::json>` (`:142-168`). Free-form, so it is
     * normalised rather than `deepMerge`d — see {@link normalizeColumnWidths}.
     */
    column_widths: Record<string, number>;
    /** `lib_tree.open_libs` — the libraries expanded when the frame closed. */
    open_libs: string[];
  };
}

export const FPEDIT_DEFAULTS: FpEditSettings = {
  system: {
    // The `app_settings.cpp:228-238` branch, asked rather than restated.
    units: defaultUnits('fpedit'),
    last_metric_units: 'mm',
    last_imperial_units: 'mils',
  },
  appearance: { color_theme: '_builtin_default', custom_toolbars: false },
  window: {
    lib_width: 250,
    grid: {
      // `DefaultGridSizeList()`'s `else` row — pcbnew's — and its
      // `defaultGridIdx` 15, asked rather than restated.
      sizes: GRID_SIZE_LIST.pcbnew.map(gridEntryOf),
      last_size_idx: DEFAULT_GRID_INDEX.pcbnew,
      fast_grid_1: DEFAULT_GRID_INDEX.pcbnew,
      fast_grid_2: DEFAULT_GRID_INDEX.pcbnew + 1,
      style: 'dots',
      line_width: 1,
      min_spacing: 10,
      snap: 0,
      show: true,
      // The `else` arm of `app_settings.cpp:522-548`, the one every frame that
      // is not eeschema or the symbol editor takes: every flag false, and the
      // indices 16, 18 and 15 into pcbnew's grid row above — 0.25 mm for pads,
      // 0.1 mm for text, 0.5 mm for graphics. Written as the sizes they name
      // rather than as indices, because `GridOverride` stores the size string
      // and an index into a list the user can reorder is not a stable value.
      overrides_enabled: true,
      overrides: {
        connected: { enabled: false, size: '0.25 mm' },
        text: { enabled: false, size: '0.1 mm' },
        graphics: { enabled: false, size: '0.5 mm' },
      },
    },
    cursor: { crosshair: 'small', always_show_cursor: true },
  },
  pcb_display: { graphics_fill: true, text_fill: true, pad_fill: true, pad_numbers: true },
  editing: {
    // `MAGNETIC_OPTIONS::CAPTURE_ALWAYS`, set in the constructor body rather
    // than by the param's own default (`footprint_editor_settings.cpp:60`) —
    // pcbnew's same key defaults to CAPTURE_CURSOR_IN_TRACK_TOOL, so this is
    // one of the few places the two files genuinely disagree.
    magnetic_pads: 2,
    magnetic_graphics: true,
    magnetic_all_layers: false,
    polar_coords: false,
    // ANGLE_90 in tenths of a degree.
    rotation_angle: 900,
    // LEADER_MODE::DEG45.
    fp_angle_snap_mode: 1,
  },
  origin_invert_x_axis: false,
  origin_invert_y_axis: false,
  design_settings: {
    // The `PARAM_LAMBDA`'s own default array (`footprint_editor_settings.cpp:
    // 180-185`). Three rows: two field rows and one text item, which is why a
    // fresh Footprint Defaults page shows one row in its lower grid.
    default_footprint_text_items: [
      { text: 'REF**', visible: true, layer: 'F.SilkS' },
      { text: '', visible: true, layer: 'F.Fab' },
      { text: '${REFERENCE}', visible: true, layer: 'F.Fab' },
    ],
    default_footprint_layer_names: {},
    user_layer_count: 4,
    // [data] `include/board_design_settings.h:38-50`, the DEFAULT_* macros
    // `footprint_editor_settings.cpp:207-290` names, in millimetres because
    // that is the unit the params store.
    silk: {
      line_width: 0.1, // DEFAULT_SILK_LINE_WIDTH
      text_size_h: 1.0, // DEFAULT_SILK_TEXT_SIZE
      text_size_v: 1.0,
      text_thickness: 0.1, // DEFAULT_SILK_TEXT_WIDTH
      text_italic: false,
    },
    copper: {
      line_width: 0.2, // DEFAULT_COPPER_LINE_WIDTH
      text_size_h: 1.5, // DEFAULT_COPPER_TEXT_SIZE
      text_size_v: 1.5,
      text_thickness: 0.3, // DEFAULT_COPPER_TEXT_WIDTH
      text_italic: false,
    },
    edges: { line_width: 0.05 }, // DEFAULT_EDGE_WIDTH
    courtyard: { line_width: 0.05 }, // DEFAULT_COURTYARD_WIDTH
    // Fab and Others share the generic macros: DEFAULT_LINE_WIDTH,
    // DEFAULT_TEXT_SIZE and DEFAULT_TEXT_WIDTH.
    fab: {
      line_width: 0.1,
      text_size_h: 1.0,
      text_size_v: 1.0,
      text_thickness: 0.15,
      text_italic: false,
    },
    others: {
      line_width: 0.1,
      text_size_h: 1.0,
      text_size_v: 1.0,
      text_thickness: 0.15,
      text_italic: false,
    },
    dimensions: {
      units: 3, // DIM_UNITS_MODE::AUTOMATIC
      precision: 4, // DIM_PRECISION::X_XXXX
      units_format: 0, // DIM_UNITS_FORMAT::NO_SUFFIX
      suppress_zeroes: true,
      text_position: 0, // DIM_TEXT_POSITION::OUTSIDE
      keep_text_aligned: true,
      // [data] `pcbIUScale.MilsToIU( DEFAULT_DIMENSION_ARROW_LENGTH )` — 50
      // mils at 25400 IU/mil, and upstream's comment says the mils are "for
      // legacy purposes".
      arrow_length: 1270000,
      // [data] `pcbIUScale.mmToIU( DEFAULT_DIMENSION_EXTENSION_OFFSET )`, 0.5 mm.
      extension_offset: 500000,
    },
  },
  lib_tree: { columns: [], column_widths: {}, open_libs: [] },
};

/**
 * `lib_tree.column_widths` on the way in — the getter/setter pair at
 * `app_settings.cpp:142-168`, which reads the JSON object back a key at a time
 * and takes only integer values.
 *
 * Free-form, so not `deepMerge`d: the defaults are `{}` and `deepMerge` keeps
 * only keys the defaults already have, so every stored width would be dropped
 * on the way back in. That is the trap the note above `normalizeHotkeys`
 * describes.
 */
export function normalizeColumnWidths(parsed: unknown): Record<string, number> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * `fpedit.json` on the way in: the fixed tree merged as usual, with the one
 * free-form subtree inside it normalised instead — the same shape as
 * {@link mergeCommon}, and for the same reason.
 *
 * `normalizeGrids` for the reason eeschema, the symbol editor, pl_editor and
 * gerbview need it: `window.grid.sizes` is a LIST, `deepMerge` adopts a stored
 * array whole, and a file written before `DIALOG_GRID_SETTINGS` was ported
 * holds one unit-bearing string per row instead of a `GRID{ name, x, y }`.
 */
export function mergeFpEdit(stored: unknown): FpEditSettings {
  const out = deepMerge(structuredClone(FPEDIT_DEFAULTS), stored);
  const ds = (stored as { design_settings?: Record<string, unknown> } | undefined)?.design_settings;
  const widths = (stored as { lib_tree?: { column_widths?: unknown } } | undefined)?.lib_tree
    ?.column_widths;
  out.lib_tree.column_widths = normalizeColumnWidths(widths);
  // `default_footprint_layer_names` is a `PARAM_MAP`, free-form for the same
  // reason `lib_tree.column_widths` is: the defaults are `{}` and `deepMerge`
  // keeps only keys the defaults already have, so every stored name would be
  // dropped on the way back in.
  out.design_settings.default_footprint_layer_names = normalizeLayerNames(
    ds?.['default_footprint_layer_names'],
  );
  // ...and the text items are a LIST. `deepMerge` adopts a stored array whole,
  // so a file written by an older build could hand us rows of the wrong shape;
  // `normalizeFpTextItems` is what keeps a hand-edited one from reaching the
  // grids as `undefined.text`.
  out.design_settings.default_footprint_text_items = normalizeFpTextItems(
    ds?.['default_footprint_text_items'],
  );
  return normalizeGrids(out, FPEDIT_DEFAULTS.window.grid.sizes);
}

/**
 * `PARAM_MAP<wxString>` on the way in — `default_footprint_layer_names`, whose
 * keys are canonical layer names and whose values are the names to show. A
 * value that is not a string is not a layer name; it is damage.
 */
export function normalizeLayerNames(parsed: unknown): Record<string, string> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

/**
 * `default_footprint_text_items` on the way in: the setter at
 * `footprint_editor_settings.cpp:158-179`, which skips an entry that is not a
 * non-empty array and falls back to `F_SilkS` for a layer name it cannot
 * resolve — so a bad row is dropped rather than made up.
 *
 * An empty result takes the defaults, because the Footprint Defaults page reads
 * rows 0 and 1 as the Reference and Value fields by POSITION: a list shorter
 * than two would leave those two grid rows with nothing behind them.
 */
export function normalizeFpTextItems(parsed: unknown): FpTextItem[] {
  if (!Array.isArray(parsed)) {
    return structuredClone(FPEDIT_DEFAULTS.design_settings.default_footprint_text_items);
  }
  const out: FpTextItem[] = [];
  for (const row of parsed as unknown[]) {
    // The stored shape is the three-element ARRAY the getter writes.
    if (Array.isArray(row) && row.length >= 3) {
      out.push({
        text: typeof row[0] === 'string' ? row[0] : '',
        visible: row[1] !== false,
        layer: typeof row[2] === 'string' && row[2] !== '' ? row[2] : 'F.SilkS',
      });
    } else if (typeof row === 'object' && row !== null && !Array.isArray(row)) {
      // ...and the object shape this port wrote before the array one, so a
      // settings file from an earlier build is not silently emptied.
      const r = row as Record<string, unknown>;
      out.push({
        text: typeof r['text'] === 'string' ? r['text'] : '',
        visible: r['visible'] !== false,
        layer: typeof r['layer'] === 'string' && r['layer'] !== '' ? r['layer'] : 'F.SilkS',
      });
    }
  }
  return out.length >= 2
    ? out
    : structuredClone(FPEDIT_DEFAULTS.design_settings.default_footprint_text_items);
}

// ----- PCB_CALCULATOR_SETTINGS ----------------------------------------------------

/**
 * `pcb_calculator.json`, mirroring `PCB_CALCULATOR_SETTINGS`
 * (pcb_calculator/pcb_calculator_settings.cpp:35-289).
 *
 * Upstream registers **83** parameters there, which expand to 106 stored keys:
 * the four attenuators share one three-parameter template and the eight
 * transmission lines share one two-map template. The key names and the nesting
 * below are those parameter paths character for character, including the two
 * spellings of the same word — `translines.type` for the selected line type and
 * `trans_line.<Name>.…` for the per-line values — because both are upstream's.
 *
 * Every field is loaded when the frame is created and written back when it is
 * closed (`PCB_CALCULATOR_FRAME::LoadSettings` / `SaveSettings`,
 * pcb_calculator_frame.cpp:385-419, each delegating to the panel's own
 * `LoadSettings`/`SaveSettings`). Nothing here is a *preference* in the
 * Preferences-dialog sense; it is the last thing the user typed, which is why
 * the strings are stored as strings — see the note on `PcbCalculatorTrackWidth`.
 */

/** One entry of `m_Attenuators.attenuators` (pcb_calculator_settings.cpp:57-66). */
export interface PcbCalculatorAttenuator {
  attenuation: number;
  zin: number;
  zout: number;
}

/**
 * One line type's saved parameters: keyword -> value, keyword -> unit index.
 *
 * Free-form, exactly as upstream's `PARAM_MAP<double>` / `PARAM_MAP<int>` are
 * (pcb_calculator_settings.cpp:232-236). The keywords are `TRANSLINE_PRM`'s
 * `m_KeyWord`s and they differ per line type, so this cannot be a fixed shape
 * — and `deepMerge` would drop every key of one that were, which is why
 * {@link normalizePcbCalculator} copies these two maps rather than merging them.
 */
export interface PcbCalculatorTransLine {
  values: Record<string, number>;
  units: Record<string, number>;
}

/**
 * The attenuator names upstream stores, in upstream's order
 * (pcb_calculator_settings.cpp:53-54).
 */
export const CALC_ATTENUATOR_NAMES = ['att_pi', 'att_tee', 'att_bridge', 'att_splitter'] as const;
export type CalcAttenuatorName = (typeof CALC_ATTENUATOR_NAMES)[number];

/**
 * The transmission-line names upstream stores, in upstream's order
 * (pcb_calculator_settings.cpp:227-228). There are **eight**, not nine.
 *
 * The ninth line type, coupled stripline, has no name of its own: `C_STRIPLINE`
 * sets `m_Name = "Coupled_MicroStrip"` (transline/c_stripline.cpp:30), the same
 * string `C_MICROSTRIP` uses (transline/c_microstrip.cpp:30), so the two share
 * one entry and the later `WriteConfig` in `m_transline_list` order wins
 * (transline_ident.cpp, `TRANSLINE_IDENT::WriteConfig`). That is upstream's
 * copy-paste bug and it is mirrored deliberately: this table is the *file
 * format*, and inventing a ninth key would make ours something a
 * `pcb_calculator.json` reader has never seen. See `CALC_TRANSLINE_STORE_NAME`.
 */
export const CALC_TRANSLINE_NAMES = [
  'MicroStrip',
  'CoPlanar',
  'GrCoPlanar',
  'RectWaveGuide',
  'Coax',
  'Coupled_MicroStrip',
  'StripLine',
  'TwistedPair',
] as const;
export type CalcTransLineName = (typeof CALC_TRANSLINE_NAMES)[number];

/** `m_Electrical` (pcb_calculator_settings.cpp:68-102). */
export interface PcbCalculatorElectrical {
  spacing_units: number;
  spacing_voltage: string;
  iec60664_ratedVoltage: number;
  iec60664_OVC: number;
  iec60664_RMSvoltage: number;
  iec60664_transientOV: number;
  iec60664_peakOV: number;
  iec60664_insulationType: number;
  iec60664_pollutionDegree: number;
  iec60664_materialGroup: number;
  iec60664_pcbMaterial: number;
  iec60664_altitude: number;
}

/** `m_Regulators` (pcb_calculator_settings.cpp:104-138). */
export interface PcbCalculatorRegulators {
  resTol: string;
  r1: string;
  r2: string;
  vrefMin: string;
  vrefTyp: string;
  vrefMax: string;
  voutTyp: string;
  iadjTyp: string;
  iadjMax: string;
  data_file: string;
  selected_regulator: string;
  type: number;
  last_param: number;
  /**
   * The custom-regulator library.
   *
   * ZiroEDA-only, and the one key in this file with no upstream counterpart.
   * Upstream this is a `.pcbcalc` *file on disk* named by `data_file` and read
   * by `PANEL_REGULATOR::ReadDataFile` (datafile_read_write.cpp); a browser has
   * no disk, so the file's contents live here, next to the name that would have
   * pointed at it. Folding it in rather than leaving it in its own localStorage
   * key is what makes a user's custom regulators follow their account.
   */
  library: RegulatorData[];
}

/** `m_cableSize` (pcb_calculator_settings.cpp:140-165). */
export interface PcbCalculatorCableSize {
  conductorMaterialResitivity: string;
  conductorTemperature: string;
  conductorThermalCoef: string;
  currentDensityChoice: number;
  diameterUnit: number;
  linResUnit: number;
  frequencyUnit: number;
  lengthUnit: number;
}

/** `m_wavelength` (pcb_calculator_settings.cpp:167-190). */
export interface PcbCalculatorWavelength {
  frequency: number;
  permeability: number;
  permittivity: number;
  frequencyUnit: number;
  periodUnit: number;
  wavelengthVacuumUnit: number;
  wavelengthMediumUnit: number;
  speedUnit: number;
}

/**
 * `m_TrackWidth` (pcb_calculator_settings.cpp:192-225).
 *
 * Every value a wxTextCtrl holds is stored as a **string**, not a number, and
 * the panel's state is that string: `SaveSettings` is
 * `aCfg->m_TrackWidth.current = m_TrackCurrentValue->GetValue()`
 * (panel_track_width.cpp). Storing `1.0` as a number and printing it back with
 * `%g` would show `1`, which is not what the field says.
 */
export interface PcbCalculatorTrackWidth {
  current: string;
  delta_tc: string;
  track_len: string;
  track_len_units: number;
  resistivity: string;
  ext_track_width: string;
  ext_track_width_units: number;
  ext_track_thickness: string;
  ext_track_thickness_units: number;
  int_track_width: string;
  int_track_width_units: number;
  int_track_thickness: string;
  int_track_thickness_units: number;
}

/** `m_ViaSize` (pcb_calculator_settings.cpp:238-286). */
export interface PcbCalculatorViaSize {
  hole_diameter: string;
  hole_diameter_units: number;
  thickness: string;
  thickness_units: number;
  length: string;
  length_units: number;
  pad_diameter: string;
  pad_diameter_units: number;
  clearance_diameter: string;
  clearance_diameter_units: number;
  characteristic_impedance: string;
  characteristic_impedance_units: number;
  applied_current: string;
  plating_resistivity: string;
  permittivity: string;
  temp_rise: string;
  pulse_rise_time: string;
}

export interface PcbCalculatorSettings {
  board_class_units: number;
  color_code_tolerance: number;
  last_page: number;
  /** The selected transmission line type. Spelt plural upstream, unlike
   *  `trans_line` below (pcb_calculator_settings.cpp:45). */
  translines: { type: number };
  attenuators: { type: number } & Record<CalcAttenuatorName, PcbCalculatorAttenuator>;
  electrical: PcbCalculatorElectrical;
  regulators: PcbCalculatorRegulators;
  cable_size: PcbCalculatorCableSize;
  wavelength: PcbCalculatorWavelength;
  track_width: PcbCalculatorTrackWidth;
  trans_line: Record<CalcTransLineName, PcbCalculatorTransLine>;
  via_size: PcbCalculatorViaSize;
  corrosion_table: { threshold_voltage: string; show_symbols: boolean };
}

/** Every attenuator opens on the same three numbers (pcb_calculator_settings.cpp:63-65). */
const CALC_ATTENUATOR_DEFAULT: PcbCalculatorAttenuator = {
  attenuation: 6.0,
  zin: 50.0,
  zout: 50.0,
};

export const PCB_CALCULATOR_DEFAULTS: PcbCalculatorSettings = {
  board_class_units: 0,
  color_code_tolerance: 0,
  // Treebook page 1. Page 0 is the "General system design" *group* node, which
  // `wxTreebook::AddPage( nullptr, … )` counts as a page, so 1 is Regulators
  // (pcb_calculator_frame.cpp:159-189).
  last_page: 1,
  translines: { type: 0 },
  attenuators: {
    type: 0,
    att_pi: { ...CALC_ATTENUATOR_DEFAULT },
    att_tee: { ...CALC_ATTENUATOR_DEFAULT },
    att_bridge: { ...CALC_ATTENUATOR_DEFAULT },
    att_splitter: { ...CALC_ATTENUATOR_DEFAULT },
  },
  electrical: {
    spacing_units: 0,
    spacing_voltage: '500',
    iec60664_ratedVoltage: 230,
    iec60664_OVC: 0,
    iec60664_RMSvoltage: 230,
    iec60664_transientOV: 1,
    iec60664_peakOV: 0.5,
    iec60664_insulationType: 0,
    iec60664_pollutionDegree: 0,
    iec60664_materialGroup: 0,
    iec60664_pcbMaterial: 1,
    iec60664_altitude: 2000,
  },
  regulators: {
    // DEFAULT_REGULATOR_* (pcb_calculator_settings.h:32-40). Strings, and the
    // trailing zeros are load-bearing: the panel opens reading "0.240".
    resTol: '1',
    r1: '0.240',
    r2: '0.720',
    vrefMin: '1.20',
    vrefTyp: '1.25',
    vrefMax: '1.30',
    voutTyp: '5',
    iadjTyp: '50',
    iadjMax: '100',
    data_file: '',
    selected_regulator: '',
    type: 1,
    last_param: 0,
    // KiCad ships no regulators: REGULATOR_LIST is empty until the user loads a
    // data file or presses Add Regulator (panel_regulator.cpp:47, 141).
    library: [],
  },
  cable_size: {
    // Empty, not "1.72e-8": LoadSettings substitutes the physical defaults when
    // the stored strings are empty, so a *fresh* config is genuinely blank
    // (panel_cable_size.cpp, LoadSettings).
    conductorMaterialResitivity: '',
    conductorTemperature: '',
    conductorThermalCoef: '',
    currentDensityChoice: 0,
    diameterUnit: 0,
    linResUnit: 0,
    frequencyUnit: 0,
    lengthUnit: 0,
  },
  wavelength: {
    frequency: 1e9,
    permeability: 1,
    permittivity: 4.5,
    frequencyUnit: 0,
    periodUnit: 0,
    wavelengthVacuumUnit: 0,
    wavelengthMediumUnit: 0,
    speedUnit: 0,
  },
  track_width: {
    current: '1.0',
    delta_tc: '10.0',
    track_len: '20',
    track_len_units: 0,
    resistivity: '1.72e-8',
    ext_track_width: '0.2',
    ext_track_width_units: 0,
    ext_track_thickness: '35',
    // 1 is µm in UNIT_SELECTOR_THICKNESS, which is why 35 reads as 35 microns
    // and not 35 millimetres (pcb_calculator_settings.cpp:211).
    ext_track_thickness_units: 1,
    int_track_width: '0.2',
    int_track_width_units: 0,
    int_track_thickness: '35',
    int_track_thickness_units: 1,
  },
  // `PARAM_MAP`'s default is `{}` — a fresh config stores nothing per line type
  // and `TRANSLINE_IDENT::ReadConfig` swallows the missing-key exception, so
  // every parameter keeps its own `m_DefaultValue` (transline_ident.cpp).
  trans_line: {
    MicroStrip: { values: {}, units: {} },
    CoPlanar: { values: {}, units: {} },
    GrCoPlanar: { values: {}, units: {} },
    RectWaveGuide: { values: {}, units: {} },
    Coax: { values: {}, units: {} },
    Coupled_MicroStrip: { values: {}, units: {} },
    StripLine: { values: {}, units: {} },
    TwistedPair: { values: {}, units: {} },
  },
  via_size: {
    hole_diameter: '0.4',
    hole_diameter_units: 0,
    thickness: '0.035',
    thickness_units: 0,
    length: '1.6',
    length_units: 0,
    pad_diameter: '0.6',
    pad_diameter_units: 0,
    clearance_diameter: '1.0',
    clearance_diameter_units: 0,
    characteristic_impedance: '50',
    characteristic_impedance_units: 0,
    applied_current: '1',
    plating_resistivity: '1.72e-8',
    permittivity: '4.5',
    temp_rise: '10',
    pulse_rise_time: '1',
  },
  corrosion_table: { threshold_voltage: '0', show_symbols: true },
};

/**
 * Merge a stored `pcb_calculator.json` over the defaults.
 *
 * `deepMerge` alone is wrong here for one reason: `trans_line.*.values` and
 * `.units` are free-form keyword maps whose defaults are `{}`, and `deepMerge`
 * keeps only keys the *defaults* already have — so every saved transmission
 * line parameter would be written on change and silently dropped on reload.
 * That is exactly the trap `loadFreeForm` exists for on `colors.user`. The rest
 * of the file has a fixed shape and goes through `deepMerge` as usual.
 */
export function normalizePcbCalculator(stored: unknown): PcbCalculatorSettings {
  const out = deepMerge(structuredClone(PCB_CALCULATOR_DEFAULTS), stored);
  const tl = (stored as { trans_line?: Record<string, unknown> } | null | undefined)?.trans_line;
  if (typeof tl === 'object' && tl !== null) {
    for (const name of CALC_TRANSLINE_NAMES) {
      const entry = tl[name] as Partial<PcbCalculatorTransLine> | undefined;
      if (typeof entry !== 'object' || entry === null) continue;
      out.trans_line[name] = {
        values: numberMap(entry.values),
        units: numberMap(entry.units),
      };
    }
  }
  return out;
}

/** Keep only the entries of a free-form map that are finite numbers. */
function numberMap(v: unknown): Record<string, number> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

// ----- BITMAP2CMP_SETTINGS -----------------------------------------------------

/**
 * `bitmap2component.json` — `BITMAP2CMP_SETTINGS`
 * (bitmap2component/bitmap2cmp_settings.cpp), a `SETTINGS_LOC::USER` file like
 * every other one in this module. The key names below are the seven KiCad
 * registers at :42-48, in that order, with KiCad's own defaults.
 *
 * `APP_SETTINGS_BASE`'s inherited slices are absent for the reason
 * `PlEditorSettings` gives: the Image Converter puts a control in front of
 * exactly these seven, and a setting we cannot honour is a setting we should
 * not claim to store.
 *
 * KiCad's schema version for this file is 1 and its one migration
 * (:51-68) renumbers `last_mod_layer` for the KiCad 6 layer-order change,
 * reading a KiCad 5 `bitmap2component.json` we have never written. Ours starts
 * at the post-migration numbering — `LAYER_CHOICES[0]` is `F.Cu`, matching
 * the comment at :55-56 — so there is nothing for `migrateSlice` to do. The
 * migration itself is `migrateLastModLayer` in bitmap2cmp_settings.ts.
 */
export type Bitmap2CmpSettings = BITMAP2CMP_SETTINGS_JSON;

/** The seven PARAM defaults, from the settings class itself. */
export const BITMAP2CMP_DEFAULTS: Bitmap2CmpSettings = new BITMAP2CMP_SETTINGS().ToJson();

// ----- PRIVACY (ZiroEDA-specific) -------------------------------------------------

/**
 * Not a KiCad settings mirror: KiCad is a desktop application and collects
 * nothing, so it has no equivalent. Kept in its own store rather than folded
 * into CommonSettings so `ziroeda.common` stays a faithful `common.json`.
 */
export interface PrivacySettings {
  /** Send anonymous crash reports. Opt-out: on by default. */
  crash_reports: boolean;
}

export const PRIVACY_DEFAULTS: PrivacySettings = {
  crash_reports: true,
};

// ----- persistence + store --------------------------------------------------------

/**
 * One-time corrections to already-stored settings. Every settings object is
 * persisted whole, so changing a default above never reaches anyone who has
 * used the app before, a default that was simply wrong has to be rewritten
 * once, here. KiCad's own SETTINGS_MANAGER migrates stored files the same way.
 */
export const SETTINGS_VERSION = 7;

/**
 * Where the calculator's custom regulators used to live.
 *
 * `panel_regulator.tsx` wrote `{ regulators, selected }` here before
 * `pcb_calculator` was a settings file at all. Version **4** moves both into
 * the slice — `regulators.library` and `regulators.selected_regulator` — so
 * they follow the account like everything else. Exported so the migration can
 * be tested without guessing the string.
 *
 * Four, not three, even though this shipped alongside v3's
 * `migrateBitmap2CmpKey`. A migration needs a version nobody has stamped yet:
 * anyone who ran a build carrying v3 but not this one already has `3` in
 * `ziroeda.settings_version`, so a `from < 3` gate would never fire for them
 * and their custom regulators would be stranded — which is the one thing this
 * migration exists to prevent.
 */
export const LEGACY_REGULATOR_KEY = 'ziro.calculator.regulators';

/**
 * The localStorage key the Image Converter's settings used before they became a
 * slice, and the only reason `migrateStored` does anything but load.
 *
 * They were always this object under always these key names — `bitmap2cmp.ts`
 * had ported `BITMAP2CMP_SETTINGS` faithfully — but under `ziroeda.bitmap2cmp`,
 * which is the *class* name abbreviation rather than the settings *file*
 * basename every other slice is named for (`APP_SETTINGS_BASE(
 * "bitmap2component", … )`, bitmap2cmp_settings.cpp:33). Renaming it to match
 * would strand anyone who has already set a threshold, so the value moves with
 * the key.
 */
export const LEGACY_BITMAP2CMP_KEY = 'ziroeda.bitmap2cmp';

/**
 * The settings *files*, in KiCad's sense: one independently stored,
 * independently versioned document each.
 *
 * `SETTINGS_MANAGER` keeps a `JSON_SETTINGS` per file and
 * `SETTINGS_MANAGER::Save` (settings_manager.cpp:190-209) writes each of them
 * to its own path; nothing upstream merges two of them or writes them as one
 * blob. Ours are localStorage keys rather than paths, and the names below are
 * the same basenames: `common.json`, `eeschema.json`, `pcbnew.json`,
 * `pl_editor.json`, `pcb_calculator.json`, `bitmap2component.json`,
 * `colors/user.json`, `user.hotkeys`.
 *
 * This list is also the unit the account sync works in — see
 * `cloud/settingsSync.ts` for why the granularity matters and what it costs.
 *
 * `privacy` has no upstream counterpart (KiCad collects nothing), and is a file
 * of its own here for the reason `PRIVACY_DEFAULTS` gives: so `ziroeda.common`
 * stays a faithful `common.json`.
 */
export const SETTINGS_SLICES = [
  'common',
  'eeschema',
  // `symbol_editor.json`, a file of its own beside `eeschema.json` — eeschema's
  // KIFACE asks the settings manager for it by that name
  // (`GetAppSettings<SYMBOL_EDITOR_SETTINGS>( "symbol_editor" )`,
  // `eeschema/eeschema.cpp:252`).
  'symbol_editor',
  'pcbnew',
  'pl_editor',
  'fpedit',
  'pcb_calculator',
  'bitmap2component',
  'privacy',
  '3d_viewer',
  'colors.user',
  // Every theme "New Theme..." made. Upstream these are one `<name>.json` each
  // in `GetColorSettingsPath()`; a slice is what this app syncs, so they ride
  // together with the stems as keys.
  'colors.themes',
  'hotkeys',
  // `TOOLBAR_SETTINGS` is a file of its own per app, not a key inside the app's
  // settings: `GetToolbarSettings<…>( "pl_editor-toolbars" )`
  // (`pagelayout_editor/pl_editor.cpp:88`, `eeschema/eeschema.cpp:346`,
  // `pcbnew/pcbnew.cpp:455`). One slice each, spelled as upstream spells the
  // file, so a synced account carries `eeschema-toolbars.json` and not a
  // sub-object of `eeschema.json`.
  'eeschema-toolbars',
  'fpedit-toolbars',
  '3d_viewer-toolbars',
  // `GetToolbarSettings<SYMBOL_EDIT_TOOLBAR_SETTINGS>( "symbol_editor-toolbars" )`
  // (`eeschema/eeschema.cpp:289`).
  'symbol_editor-toolbars',
  'pcbnew-toolbars',
  'pl_editor-toolbars',
  // `gerbview.json` and `GetToolbarSettings<GERBVIEW_TOOLBAR_SETTINGS>(
  // "gerbview-toolbars" )` (`gerbview/gerbview.cpp:98-99`).
  'gerbview',
  'gerbview-toolbars',
] as const;

export type SettingsSlice = (typeof SETTINGS_SLICES)[number];

/**
 * An app that has a `TOOLBAR_SETTINGS` file, and therefore a Preferences >
 * Toolbars page.
 *
 * Upstream seven frames do (`common/eda_base_frame.cpp:1637`, `:1647`, `:1672`,
 * `:1686`, `:1694`, `:1715`, `:1737`). These five are the ones whose heading
 * this port ships at all; Footprint Editor and 3D Viewer have no Preferences
 * heading here yet, and their toolbar stores arrive with those headings rather
 * than sitting unread in the meantime.
 */
export const TOOLBAR_APPS = [
  'eeschema',
  'symbol_editor',
  'pcbnew',
  'pl_editor',
  'gerbview',
  // `GetToolbarSettings<FOOTPRINT_EDIT_TOOLBAR_SETTINGS>( "fpedit-toolbars" )`
  // and `GetToolbarSettings<EDA_3D_VIEWER_TOOLBAR_SETTINGS>( "3d_viewer-toolbars" )`
  // (`pcbnew/pcbnew.cpp:384`, `:484`). Upstream builds
  // `PANEL_TOOLBAR_CUSTOMIZATION` for SEVEN frames; these are the two that had
  // neither a file nor a page here, so their editors drew the module constant
  // and a customised toolbar changed nothing.
  'fpedit',
  '3d_viewer',
] as const;

export type ToolbarApp = (typeof TOOLBAR_APPS)[number];

/** `GetToolbarSettings<…>( "<app>-toolbars" )` — the file name, spelled once. */
export const toolbarSlice = (app: ToolbarApp): SettingsSlice => `${app}-toolbars` as SettingsSlice;

/** Where a slice lives in localStorage. The one place the prefix is written. */
export const sliceStorageKey = (slice: SettingsSlice): string => settingsStorageKey(slice);

/** Where any settings file lives in localStorage, synced slice or not. */
export const settingsStorageKey = (filename: string): string => `ziroeda.${filename}`;

/**
 * Apply every correction newer than `from` to one stored eeschema settings
 * object, in place. Returns true if anything changed.
 *
 * Pure, and exported, so the corrections can be tested without a browser.
 */
export function migrateEeschemaSettings(s: EeschemaSettings, from: number): boolean {
  let changed = false;

  // v1: eeschema's crosshair defaulted to full-window lines, drawn on top of
  // each tool's own cursor bitmap, two cursors at once. KiCad's default is
  // the small cross.
  if (from < 1 && s?.window?.cursor?.crosshair === 'full') {
    s.window.cursor.crosshair = 'small';
    s.window.cursor.always_show_cursor = true;
    changed = true;
  }

  // v2: the same wrong default shipped `always_show_cursor: false` alongside
  // it, and v1 only repaired it for someone still on the full-window mode.
  // Anyone who had already picked Small from the toolbar kept `false` — and
  // with the selection tool active that gates the crosshair off entirely:
  //
  //     if( cur && ( alwaysShowCrosshair || activeTool !== 'select' ) )
  //
  // so there was no crosshair at all, and the crosshair-mode buttons looked
  // dead too, because the mode they set was never reached. `always_show_cursor`
  // has no toolbar button, so it could not be turned back on by hand.
  // KiCad's default is true (common/settings/app_settings.cpp:564).
  if (from < 2 && s?.window?.cursor && s.window.cursor.always_show_cursor === false) {
    s.window.cursor.always_show_cursor = true;
    changed = true;
  }

  return changed;
}

/**
 * Bring one slice's stored value up to `SETTINGS_VERSION`, in place.
 *
 * `JSON_SETTINGS::Migrate` (json_settings.cpp:714-750) walks the registered
 * migrators from the file's `meta.version` up to the build's schema version and
 * writes the result straight back — "write-out immediately so that we don't
 * lose data if the program later crashes" (json_settings.cpp:372-375). Only
 * eeschema has ever needed a migrator here, which is why only it has one; the
 * dispatch exists so a slice arriving from the account goes through the same
 * corrections as a slice arriving from localStorage, rather than a second copy
 * of the same rules growing beside it.
 *
 * Returns true when something was rewritten.
 */
export function migrateSlice(slice: SettingsSlice, value: unknown, from: number): boolean {
  if (from >= SETTINGS_VERSION) return false;
  if (slice === 'common') return migrateCommonSettings(value as CommonSettings, from);
  if (slice !== 'eeschema') return false;
  return migrateEeschemaSettings(value as EeschemaSettings, from);
}

/** Whether a value stored under the legacy key can be used as a regulator. */
function isRegulatorData(v: unknown): v is RegulatorData {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.name === 'string' &&
    r.name !== '' &&
    typeof r.vrefTyp === 'number' &&
    Number.isFinite(r.vrefTyp)
  );
}

/**
 * Fold the pre-slice regulator store into `pcb_calculator.regulators`.
 *
 * Pure and exported so the migration can be tested on its own: a user who added
 * regulators before this shipped must still have them, which is not something a
 * "the defaults load" test would ever notice.
 *
 * Guarded on the library already being empty, so it cannot overwrite a library
 * that arrived from the account, and so re-running it is harmless. The legacy
 * key is deliberately *not* deleted: it costs nothing, and a browser whose
 * `settings_version` is cleared should be able to recover from it again.
 */
export function migrateRegulatorLibrary(legacy: unknown, s: PcbCalculatorSettings): boolean {
  if (s.regulators.library.length > 0) return false;
  if (typeof legacy !== 'object' || legacy === null || Array.isArray(legacy)) return false;
  const l = legacy as { regulators?: unknown; selected?: unknown };
  if (!Array.isArray(l.regulators)) return false;
  const kept = l.regulators.filter(isRegulatorData);
  if (kept.length === 0) return false;
  s.regulators.library = kept;
  // `regulators.selected_regulator` is upstream's own key for this
  // (pcb_calculator_settings.cpp:131-132); the old store spelt it `selected`.
  if (typeof l.selected === 'string' && s.regulators.selected_regulator === '')
    s.regulators.selected_regulator = l.selected;
  return true;
}

/**
 * Move the Image Converter's stored settings onto their slice's key.
 *
 * Exported for its own tests, and separate from `migrateSlice` because it is
 * not a correction to a value: it is a *file rename*, the thing
 * `SETTINGS_MANAGER` does by path and we do by key. `migrateSlice` operates on
 * a value that has already been loaded, and this has to run before anything is
 * loaded at all.
 *
 * Idempotent, and it never overwrites: a `bitmap2component` value already in
 * place was written by this build or pulled from the account, and is therefore
 * newer than anything under the old key. The old key is then removed, because
 * leaving it would resurrect stale values the next time the version stamp was
 * cleared.
 */
export function migrateBitmap2CmpKey(): boolean {
  const legacy = localStorage.getItem(LEGACY_BITMAP2CMP_KEY);
  if (legacy === null) return false;
  const key = sliceStorageKey('bitmap2component');
  if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
  localStorage.removeItem(LEGACY_BITMAP2CMP_KEY);
  return true;
}

function migrateStored(): void {
  const versionKey = 'ziroeda.settings_version';
  try {
    const from = Number(localStorage.getItem(versionKey) ?? '0');
    if (from >= SETTINGS_VERSION) return;

    // Every slice `migrateSlice` dispatches. `common` was missing until v7, so
    // its v5 and v6 corrections only ever reached a slice arriving from the
    // account, while this function still stamped the new version.
    for (const slice of ['eeschema', 'common'] as const) {
      const raw = localStorage.getItem(sliceStorageKey(slice));
      if (!raw) continue;
      const s: unknown = JSON.parse(raw);
      if (migrateSlice(slice, s, from))
        localStorage.setItem(sliceStorageKey(slice), JSON.stringify(s));
    }

    // v3: `ziroeda.bitmap2cmp` -> `ziroeda.bitmap2component`.
    if (from < 3) migrateBitmap2CmpKey();

    // v4: the calculator's regulator library into `pcb_calculator.regulators`.
    // Its own version, because a device that has already stamped 3 must still
    // get this one.
    if (from < 4) {
      const legacyRaw = localStorage.getItem(LEGACY_REGULATOR_KEY);
      if (legacyRaw) {
        const calcRaw = localStorage.getItem(sliceStorageKey('pcb_calculator'));
        const calc = normalizePcbCalculator(calcRaw ? JSON.parse(calcRaw) : undefined);
        if (migrateRegulatorLibrary(JSON.parse(legacyRaw), calc))
          localStorage.setItem(sliceStorageKey('pcb_calculator'), JSON.stringify(calc));
      }
    }

    localStorage.setItem(versionKey, String(SETTINGS_VERSION));
  } catch {
    /* private mode / unparsable settings, the defaults apply anyway */
  }
}

/**
 * Upgrade a stored grid list to `GRID{ name, x, y }`.
 *
 * `window.grid.sizes` held one unit-bearing string per grid before
 * `DIALOG_GRID_SETTINGS` was ported, and `deepMerge` adopts a stored array
 * whole (it only checks that an array default got an array), so a settings file
 * written by an older build arrives here as `string[]` and would reach the grid
 * menu as a list of rows with no `.x`.
 *
 * Done at load rather than as a `SETTINGS_VERSION` step because it has to hold
 * for a hand-edited file too, and because the next `commit()` writes the new
 * shape back anyway. A row that is neither a string nor an object with an `x`
 * is dropped; if that empties the list the defaults stand, since a frame with
 * no grids has no grid to snap to.
 */
export function normalizeGrids<T extends { window: { grid: { sizes: GridEntry[] } } }>(
  settings: T,
  defaults: readonly GridEntry[],
): T {
  const stored: unknown = settings.window.grid.sizes;
  if (!Array.isArray(stored)) {
    settings.window.grid.sizes = defaults.map((g) => ({ ...g }));
    return settings;
  }
  const rows: GridEntry[] = [];
  for (const row of stored as unknown[]) {
    if (typeof row === 'string') {
      // The old shape: X only, square, unnamed.
      if (row !== '') rows.push({ name: '', x: row, y: row });
    } else if (typeof row === 'object' && row !== null) {
      const g = row as Partial<GridEntry>;
      if (typeof g.x === 'string' && g.x !== '') {
        rows.push({
          name: typeof g.name === 'string' ? g.name : '',
          x: g.x,
          y: typeof g.y === 'string' && g.y !== '' ? g.y : g.x,
        });
      }
    }
  }
  settings.window.grid.sizes = rows.length > 0 ? rows : defaults.map((g) => ({ ...g }));
  return settings;
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, settings simply don't persist */
  }
}

/**
 * The user's hotkey overrides — KiCad's `user.hotkeys`, which HOTKEY_STORE
 * writes and reads separately from every other settings file.
 *
 * An action *name* - `TOOL_ACTION::GetName()`, so `eeschema.save` rather than
 * `save` - maps to the combo the user chose, or to `null` when they cleared it.
 * An action with no entry keeps its `TOOL_ACTION::DefaultHotkey`, so the map
 * stays empty until someone changes something, and a new upstream default
 * arrives without anyone having to migrate.
 *
 * The names used to be bare, because this table was the schematic's alone and
 * nothing else could collide with it. Keys stored under the old spelling are
 * migrated on the way in rather than dropped: a user who rebound Save a month
 * ago should not silently get Ctrl+S back because the key space grew a prefix.
 *
 * Not `load()`ed: `deepMerge` keeps only keys present in the defaults, which is
 * right for a fixed settings shape and wrong for a free-form map — every stored
 * override would be dropped on the way back in.
 *
 * Takes a parsed value rather than reading storage itself, so the same
 * normalisation runs on a map arriving from the account as on one arriving from
 * localStorage. The old-spelling migration in particular has to apply to both,
 * or signing in on a second device would resurrect the bare keys.
 */
export function normalizeHotkeys(parsed: unknown): Record<string, string | null> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v !== null && typeof v !== 'string') continue;
    // Every action name carries an app prefix, so a key without one was
    // written before the schematic's ids were qualified and can only have
    // been the schematic's.
    out[k.includes('.') ? k : `eeschema.${k}`] = v;
  }
  return out;
}

// A user theme file's shape is COLOR_SETTINGS', so it lives in common/settings.
export type { UserColorTheme } from '@ziroeda/common/settings/color_theme_file.js';
import type { UserColorTheme } from '@ziroeda/common/settings/color_theme_file.js';

/**
 * `colors.themes`. Free-form for the same reason `colors.user` is: `deepMerge`
 * keeps only keys the DEFAULTS already have, and the defaults here are `{}`.
 */
export function normalizeUserThemes(parsed: unknown): Record<string, UserColorTheme> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, UserColorTheme> = {};
  for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
    const t = v as { name?: unknown; colors?: unknown; override?: unknown };
    out[id] = {
      name: typeof t.name === 'string' && t.name !== '' ? t.name : id,
      colors: normalizeUserColors(t.colors),
      override: t.override === true,
    };
  }
  return out;
}

/** The "User" colour theme: layer key -> CSS colour. Free-form, same as above. */
export function normalizeUserColors(parsed: unknown): Record<string, string> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * `SETTINGS_LOC::USER`'s directory, in a browser: one localStorage key per
 * settings file, `ziroeda.<basename>`. The {@link SETTINGS_STORE} the
 * `SETTINGS_MANAGER` reads and writes through.
 *
 * Reads the global `localStorage` on every call rather than capturing it, so a
 * test that swaps the global gets a fresh device. A blocked or unparsable
 * entry reads as missing, and the file then loads as its defaults.
 */
export class BROWSER_SETTINGS_STORE implements SETTINGS_STORE {
  Read(aFilename: string): unknown {
    try {
      const raw = localStorage.getItem(settingsStorageKey(aFilename));
      if (!raw) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  Write(aFilename: string, aValue: unknown): void {
    store(settingsStorageKey(aFilename), aValue);
  }
}

/**
 * One slice as a settings file the manager can hold: the plain object the
 * editors read, and the normaliser that turns whatever was stored (or
 * nothing) into one. `LoadFromJson` is that normaliser, whether the value came
 * from the browser or from the account, so the two cannot drift apart.
 */
export class SLICE_SETTINGS<T> implements SETTINGS_FILE {
  value: T;

  constructor(
    private readonly m_filename: string,
    private readonly m_normalize: (stored: unknown) => T,
  ) {
    this.value = m_normalize(undefined);
  }

  GetFilename(): string {
    return this.m_filename;
  }

  LoadFromJson(aJson: unknown): void {
    this.value = this.m_normalize(aJson);
  }

  SaveToJson(): unknown {
    return this.value;
  }
}

/** Every slice's in-memory type, by file. */
interface SliceValues {
  common: CommonSettings;
  eeschema: EeschemaSettings;
  symbol_editor: SymbolEditorSettings;
  pcbnew: PcbnewSettings;
  pl_editor: PlEditorSettings;
  fpedit: FpEditSettings;
  pcb_calculator: PcbCalculatorSettings;
  bitmap2component: Bitmap2CmpSettings;
  privacy: PrivacySettings;
  '3d_viewer': Viewer3dSettings;
  'colors.user': Record<string, string>;
  'colors.themes': Record<string, UserColorTheme>;
  hotkeys: Record<string, string | null>;
  'eeschema-toolbars': ToolbarSettings;
  'fpedit-toolbars': ToolbarSettings;
  '3d_viewer-toolbars': ToolbarSettings;
  'symbol_editor-toolbars': ToolbarSettings;
  'pcbnew-toolbars': ToolbarSettings;
  'pl_editor-toolbars': ToolbarSettings;
  gerbview: GerbviewSettings;
  'gerbview-toolbars': ToolbarSettings;
}

/** `deepMerge` over a fresh copy of the defaults: a fixed-shape file. */
const merged =
  <T>(defaults: T) =>
  (stored: unknown): T =>
    deepMerge(structuredClone(defaults), stored);

/**
 * `normalizeGrids` as well: a stored `window.grid.sizes` is a LIST, and
 * `deepMerge` adopts a list whole, so an old or hand-edited shape has to be
 * upgraded on the way in.
 */
const mergedWithGrids =
  <T extends { window: { grid: { sizes: GridEntry[] } } }>(defaults: T) =>
  (stored: unknown): T =>
    normalizeGrids(deepMerge(structuredClone(defaults), stored), defaults.window.grid.sizes);

/**
 * How each file is read, from the browser or from the account alike.
 *
 * Not `deepMerge` for the free-form ones: it keeps only keys the defaults
 * already have, so a map whose defaults are `{}` would come back empty every
 * time (see `normalizeHotkeys`). `common.json` carries one free-form subtree
 * (`mergeCommon`), `fpedit.json` another (`mergeFpEdit`), the calculator its
 * keyword maps. A stored toolbar *replaces* its default rather than being
 * merged over it (`normalizeToolbarSettings`).
 */
const SLICE_NORMALIZE: { [K in SettingsSlice]: (stored: unknown) => SliceValues[K] } = {
  common: mergeCommon,
  eeschema: mergedWithGrids(EESCHEMA_DEFAULTS),
  symbol_editor: mergedWithGrids(SYMBOL_EDITOR_DEFAULTS),
  pcbnew: merged(PCBNEW_DEFAULTS),
  pl_editor: mergedWithGrids(PL_EDITOR_DEFAULTS),
  fpedit: mergeFpEdit,
  pcb_calculator: normalizePcbCalculator,
  bitmap2component: merged(BITMAP2CMP_DEFAULTS),
  privacy: merged(PRIVACY_DEFAULTS),
  '3d_viewer': mergeViewer3d,
  'colors.user': normalizeUserColors,
  'colors.themes': normalizeUserThemes,
  hotkeys: normalizeHotkeys,
  'eeschema-toolbars': normalizeToolbarSettings,
  'fpedit-toolbars': normalizeToolbarSettings,
  '3d_viewer-toolbars': normalizeToolbarSettings,
  'symbol_editor-toolbars': normalizeToolbarSettings,
  'pcbnew-toolbars': normalizeToolbarSettings,
  'pl_editor-toolbars': normalizeToolbarSettings,
  gerbview: mergedWithGrids(GERBVIEW_DEFAULTS),
  'gerbview-toolbars': normalizeToolbarSettings,
};

type SliceFiles = { [K in SettingsSlice]: SLICE_SETTINGS<SliceValues[K]> };

/**
 * The localStorage keys the project manager's settings were kept under before
 * they were `kicad.json`. Exported so the move can be tested without guessing
 * the strings.
 */
export const LEGACY_KICAD_KEYS = {
  leftWinWidth: 'ziro.leftWinWidth',
  historyShown: 'ziroeda.localHistoryShown',
  recentTemplates: 'ziro.recentTemplates',
  templateFilter: 'ziro.templateFilterChoice',
  templateWindowSize: 'ziro.templateWindowSize',
} as const;

/**
 * Fold the project manager's loose keys into `kicad.json` — a file rename, the
 * thing `migrateBitmap2CmpKey` does for the Image Converter.
 *
 * Not gated on `SETTINGS_VERSION`: `kicad.json` is not a synced slice, so
 * there is no version for it to stamp, and bumping the synced version would
 * make every older deploy read the account as a future format. Instead it is
 * idempotent: a path already in `kicad.json` wins over a legacy key, and the
 * legacy keys are removed once folded, so it runs at most once per browser
 * with anything to do.
 */
export function migrateKicadSettingsKeys(): boolean {
  try {
    const get = (k: string): string | null => localStorage.getItem(k);
    const width = get(LEGACY_KICAD_KEYS.leftWinWidth);
    const shown = get(LEGACY_KICAD_KEYS.historyShown);
    const recent = get(LEGACY_KICAD_KEYS.recentTemplates);
    const filter = get(LEGACY_KICAD_KEYS.templateFilter);
    const size = get(LEGACY_KICAD_KEYS.templateWindowSize);
    if ([width, shown, recent, filter, size].every((v) => v === null)) return false;

    const key = settingsStorageKey('kicad');
    const raw = localStorage.getItem(key);
    const doc = new KICAD_SETTINGS();
    doc.LoadFromJson(raw ? (JSON.parse(raw) as JsonValue) : {});
    const had = (path: string): boolean => doc.Contains(path);

    if (width !== null && !had('appearance.left_frame_width')) {
      const n = Number(width);
      if (Number.isFinite(n)) doc.Set('appearance.left_frame_width', n);
    }
    if (shown !== null && !had('aui.show_history_panel'))
      doc.Set('aui.show_history_panel', shown === '1');
    if (recent !== null && !had('template.recent_templates')) {
      const ids: unknown = JSON.parse(recent);
      if (Array.isArray(ids))
        doc.Set(
          'template.recent_templates',
          ids.filter((x): x is string => typeof x === 'string'),
        );
    }
    if (filter !== null && !had('template.filter')) {
      const n = Number(filter);
      if (Number.isInteger(n)) doc.Set('template.filter', n);
    }
    if (size !== null && !had('template.window.size')) {
      const s = JSON.parse(size) as { w?: unknown; h?: unknown } | null;
      if (typeof s?.w === 'number' && typeof s.h === 'number')
        doc.Set('template.window.size', { width: s.w, height: s.h });
    }

    // The document as it stands, not a Store(): a Store() would first write
    // the members over the paths just set.
    localStorage.setItem(key, JSON.stringify(doc.GetJson('')));
    for (const k of Object.values(LEGACY_KICAD_KEYS)) localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

type Listener = () => void;

/**
 * What this device knows about one settings slice, in *this device's* clock.
 *
 * The same three facts `projectStore`'s `StoredRecord` keeps for a project, for
 * the same reason: without `syncedAt`, "local is older than the account" cannot
 * be told apart from "local was edited *and* is older", and a pull cannot know
 * whether it is about to catch up or to overwrite something.
 */
export interface SliceStamp {
  /** When this device last wrote the slice. Monotonic — see `touch`. */
  updatedAt: number;
  /** `updatedAt` at the moment the two sides last agreed. Absent: never synced. */
  syncedAt?: number;
  /**
   * The account row's `updated_at` at that same moment, in the *server's*
   * clock. Comparing the current row against this is how "the account moved
   * since we agreed" is decided without involving a second machine's clock.
   */
  cloudAt?: number;
}

/** Where the stamps live. Deliberately not one of the slices: see `touch`. */
const STAMPS_KEY = 'ziroeda.settings_sync';

function loadStamps(): Record<string, SliceStamp> {
  try {
    const raw = localStorage.getItem(STAMPS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, SliceStamp> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const s = v as SliceStamp | undefined;
      if (typeof s?.updatedAt === 'number') out[k] = s;
    }
    return out;
  } catch {
    return {};
  }
}

const TOOLBAR_SLICES = new Map<SettingsSlice, ToolbarApp>(
  TOOLBAR_APPS.map((app) => [toolbarSlice(app), app]),
);

/**
 * The editors' view of the settings: a thin layer over the common
 * `SETTINGS_MANAGER`, which holds one settings file per slice and loads and
 * saves them through the browser's store.
 *
 * What stays here is what upstream has no counterpart for: the named fields
 * the editors read (`settings.eeschema`), the per-slice sync stamps and the
 * `onSliceChanged` hook the account sync hangs off, and the change
 * notification the editors re-render through (useSyncExternalStore).
 */
export class SettingsManager {
  /** The `SETTINGS_MANAGER` the files are registered with; `PGM_BASE` adopts it. */
  readonly manager: SETTINGS_MANAGER;
  private readonly files: SliceFiles;
  /** `kicad.json`, the project manager's own settings. Not a synced slice: see `updateKicad`. */
  readonly kicad: KICAD_SETTINGS;
  /** Per-slice modification and agreement stamps; see {@link SliceStamp}. */
  stamps: Record<string, SliceStamp> = loadStamps();
  /**
   * Called with the slice a local edit just touched.
   *
   * The seam the account sync hangs off, installed the same way and for the
   * same reason as `setCloudBackend`: a module that reaches `import.meta.env`
   * cannot be imported from here, and a store that calls the network directly
   * has no failure path anyone can test. Null when there is no account to sync
   * to — a build with auth disabled, and the moment before a session resolves —
   * which is the whole of what an account-less deployment costs.
   */
  onSliceChanged: ((slice: SettingsSlice) => void) | null = null;
  private listeners = new Set<Listener>();
  /** Monotonic snapshot id for useSyncExternalStore. */
  version = 0;
  /**
   * `<app>-toolbars.json`, one per app with a Preferences > Toolbars page, as
   * one record so a reader holds a stable object between changes.
   *
   * Upstream these are separate `TOOLBAR_SETTINGS` objects the settings manager
   * hands out by file name, never a member of the app's own settings — a frame
   * holds `m_toolbarSettings` beside `config()`, and the customisation panel is
   * given both (`PANEL_TOOLBAR_CUSTOMIZATION`'s `aCfg` and `aTbSettings`).
   */
  private m_toolbars: Record<ToolbarApp, ToolbarSettings>;

  constructor(aManager: SETTINGS_MANAGER = new SETTINGS_MANAGER()) {
    this.manager = aManager;
    if (!aManager.GetStore()) aManager.SetStore(new BROWSER_SETTINGS_STORE());

    const files: Partial<Record<SettingsSlice, SLICE_SETTINGS<unknown>>> = {};
    for (const slice of SETTINGS_SLICES)
      files[slice] = aManager.RegisterSettings(
        new SLICE_SETTINGS<unknown>(slice, SLICE_NORMALIZE[slice]),
      );
    this.files = files as SliceFiles;

    migrateKicadSettingsKeys();
    this.kicad = aManager.RegisterSettings(new KICAD_SETTINGS());

    this.m_toolbars = this.readToolbars();
  }

  private readToolbars(): Record<ToolbarApp, ToolbarSettings> {
    const out: Partial<Record<ToolbarApp, ToolbarSettings>> = {};
    for (const app of TOOLBAR_APPS)
      out[app] = this.files[toolbarSlice(app) as `${ToolbarApp}-toolbars`].value;
    return out as Record<ToolbarApp, ToolbarSettings>;
  }

  get common(): CommonSettings {
    return this.files.common.value;
  }
  set common(v: CommonSettings) {
    this.files.common.value = v;
  }
  get eeschema(): EeschemaSettings {
    return this.files.eeschema.value;
  }
  set eeschema(v: EeschemaSettings) {
    this.files.eeschema.value = v;
  }
  /** `symbol_editor.json`, the Symbol Editor's own settings file. */
  get symbolEditor(): SymbolEditorSettings {
    return this.files.symbol_editor.value;
  }
  set symbolEditor(v: SymbolEditorSettings) {
    this.files.symbol_editor.value = v;
  }
  get pcbnew(): PcbnewSettings {
    return this.files.pcbnew.value;
  }
  set pcbnew(v: PcbnewSettings) {
    this.files.pcbnew.value = v;
  }
  /** `pl_editor.json`, the Drawing Sheet Editor's own settings file. */
  get plEditor(): PlEditorSettings {
    return this.files.pl_editor.value;
  }
  set plEditor(v: PlEditorSettings) {
    this.files.pl_editor.value = v;
  }
  /** `gerbview.json`, the Gerber Viewer's own settings file. */
  get gerbview(): GerbviewSettings {
    return this.files.gerbview.value;
  }
  set gerbview(v: GerbviewSettings) {
    this.files.gerbview.value = v;
  }
  /** `fpedit.json`, the Footprint Editor's own settings file. */
  get fpEdit(): FpEditSettings {
    return this.files.fpedit.value;
  }
  set fpEdit(v: FpEditSettings) {
    this.files.fpedit.value = v;
  }
  get viewer3d(): Viewer3dSettings {
    return this.files['3d_viewer'].value;
  }
  set viewer3d(v: Viewer3dSettings) {
    this.files['3d_viewer'].value = v;
  }
  /** `pcb_calculator.json` — the Calculator Tools frame's last inputs. */
  get pcbCalculator(): PcbCalculatorSettings {
    return this.files.pcb_calculator.value;
  }
  set pcbCalculator(v: PcbCalculatorSettings) {
    this.files.pcb_calculator.value = v;
  }
  /** `bitmap2component.json`, the Image Converter's own settings file. */
  get bitmap2cmp(): Bitmap2CmpSettings {
    return this.files.bitmap2component.value;
  }
  set bitmap2cmp(v: Bitmap2CmpSettings) {
    this.files.bitmap2component.value = v;
  }
  get privacy(): PrivacySettings {
    return this.files.privacy.value;
  }
  set privacy(v: PrivacySettings) {
    this.files.privacy.value = v;
  }
  /** Every theme "New Theme..." made, by file stem. */
  get userThemes(): Record<string, UserColorTheme> {
    return this.files['colors.themes'].value;
  }
  set userThemes(v: Record<string, UserColorTheme>) {
    this.files['colors.themes'].value = v;
  }
  /** The editable "User" colour theme: layer-key -> CSS colour overrides. */
  get userColors(): Record<string, string> {
    return this.files['colors.user'].value;
  }
  set userColors(v: Record<string, string>) {
    this.files['colors.user'].value = v;
  }
  /** HOTKEY_STORE's overrides: action name -> combo, or null for "no key". */
  get hotkeys(): Record<string, string | null> {
    return this.files.hotkeys.value;
  }
  set hotkeys(v: Record<string, string | null>) {
    this.files.hotkeys.value = v;
  }
  get toolbars(): Record<ToolbarApp, ToolbarSettings> {
    return this.m_toolbars;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /**
   * Persist one slice, stamp it as locally edited, and tell everyone.
   *
   * The stamps are a separate localStorage key rather than a field inside each
   * settings object, because those objects are faithful copies of KiCad's
   * files: `common.json` has no "when did another machine last agree with this"
   * member, and putting one there would put it in the JSON a user can read and
   * in `deepMerge`'s way.
   */
  private commit(slice: SettingsSlice): void {
    this.manager.Save(this.files[slice]);
    const prev = this.stamps[slice];
    // Strictly increasing, not `Date.now()`. Two edits inside one millisecond
    // would otherwise share a stamp, so the second would satisfy
    // `updatedAt === syncedAt` after the first was pushed — read as "already
    // agreed" and never sent. It also survives a clock stepping backwards.
    const at = Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1);
    this.stamps = { ...this.stamps, [slice]: { ...prev, updatedAt: at } };
    store(STAMPS_KEY, this.stamps);
    this.notify();
    this.onSliceChanged?.(slice);
  }

  /** The slice's current value, for a push. */
  sliceValue(slice: SettingsSlice): unknown {
    return this.files[slice].SaveToJson();
  }

  /**
   * Take the account's copy of a slice.
   *
   * Not an edit: `updatedAt` does not move, and both watermarks are set so the
   * two sides read as agreed — `markSynced`'s `r.syncedAt = r.updatedAt`
   * (projectStore.ts:893) in the one other place this bookkeeping exists.
   */
  adoptSlice(slice: SettingsSlice, value: unknown, cloudAt: number): void {
    this.files[slice].LoadFromJson(value);
    if (TOOLBAR_SLICES.has(slice)) this.m_toolbars = this.readToolbars();
    this.manager.Save(this.files[slice]);
    const updatedAt = this.stamps[slice]?.updatedAt ?? Date.now();
    this.stamps = { ...this.stamps, [slice]: { updatedAt, syncedAt: updatedAt, cloudAt } };
    store(STAMPS_KEY, this.stamps);
    this.notify();
  }

  /**
   * Record that a push landed.
   *
   * `syncedAt` is the `updatedAt` the pushed *body* was read at, not the one in
   * force now: an edit made while the request was in flight must stay dirty, or
   * it is marked as agreed and never sent again. Recording agreement after a
   * transfer that did not carry the current bytes is precisely the mistake
   * `pushOne` documents in sync.ts.
   */
  markSliceSynced(slice: SettingsSlice, syncedAt: number, cloudAt: number): void {
    const prev = this.stamps[slice];
    this.stamps = {
      ...this.stamps,
      [slice]: { updatedAt: prev?.updatedAt ?? syncedAt, syncedAt, cloudAt },
    };
    store(STAMPS_KEY, this.stamps);
  }

  /** Replace one slice's value with a mutated copy, and commit it. */
  private update<K extends SettingsSlice>(slice: K, mutate: (s: SliceValues[K]) => void): void {
    const file = this.files[slice] as SLICE_SETTINGS<SliceValues[K]>;
    const next = structuredClone(file.value);
    mutate(next);
    file.value = next;
    this.commit(slice);
  }

  /** Replace one slice's value outright, and commit it. */
  private replace<K extends SettingsSlice>(slice: K, value: SliceValues[K]): void {
    (this.files[slice] as SLICE_SETTINGS<SliceValues[K]>).value = value;
    this.commit(slice);
  }

  /**
   * `KICAD_MANAGER_FRAME::SaveSettings`, one member at a time: `kicad.json`
   * saved through the manager.
   *
   * Not stamped and not handed to `onSliceChanged`: what it holds is pane and
   * window geometry and this machine's recents, which `cloud/settingsSync.ts`
   * deliberately keeps per device.
   */
  updateKicad(mutate: (s: KICAD_SETTINGS) => void): void {
    mutate(this.kicad);
    this.manager.Save(this.kicad);
    this.notify();
  }

  updateCommon(mutate: (s: CommonSettings) => void): void {
    this.update('common', mutate);
  }

  /**
   * Remember one control's value for one dialog — `dlgMap[ key ] = value` in
   * `DIALOG_SHIM::SaveControlState` (common/dialog_shim.cpp:678-745).
   *
   * The early return is not upstream's, and is deliberate. Upstream's
   * assignment is free — it writes an in-memory `std::map`, and the file is
   * written once at exit by `SETTINGS_MANAGER::Save` — so it re-stores every
   * control on every close without paying for it. A browser has no exit hook to
   * flush at, so ours must persist as it goes; and `commit` stamps the slice
   * dirty and wakes the account sync, so re-storing a value that is already
   * stored would push `common.json` to the server every time any dialog is
   * opened and closed unchanged. Storing the same bytes is what is skipped, not
   * a change.
   */
  setDialogControl(dialogKey: string, controlKey: string, value: DialogControlValue): void {
    if (this.common.dialog.controls[dialogKey]?.[controlKey] === value) return;
    this.updateCommon((s) => {
      s.dialog.controls[dialogKey] ??= {};
      s.dialog.controls[dialogKey][controlKey] = value;
    });
  }

  updateEeschema(mutate: (s: EeschemaSettings) => void): void {
    this.update('eeschema', mutate);
  }

  /** `SYMBOL_EDIT_FRAME::SaveSettings` / the five Symbol Editor Preferences pages. */
  updateSymbolEditor(mutate: (s: SymbolEditorSettings) => void): void {
    this.update('symbol_editor', mutate);
  }

  updatePcbnew(mutate: (s: PcbnewSettings) => void): void {
    this.update('pcbnew', mutate);
  }

  updatePlEditor(mutate: (s: PlEditorSettings) => void): void {
    this.update('pl_editor', mutate);
  }

  updateGerbview(mutate: (s: GerbviewSettings) => void): void {
    this.update('gerbview', mutate);
  }

  /**
   * One app's `TOOLBAR_SETTINGS`, which is what
   * `PANEL_TOOLBAR_CUSTOMIZATION::TransferDataFromWindow` writes through
   * `SetStoredToolbarConfig` (`panel_toolbar_customization.cpp:352-354`).
   */
  updateToolbars(app: ToolbarApp, mutate: (s: ToolbarSettings) => void): void {
    const slice = toolbarSlice(app) as `${ToolbarApp}-toolbars`;
    const next = structuredClone(this.files[slice].value);
    mutate(next);
    this.files[slice].value = next;
    this.m_toolbars = { ...this.m_toolbars, [app]: next };
    this.commit(slice);
  }

  /** `FOOTPRINT_EDIT_FRAME::SaveSettings` (`footprint_edit_frame.cpp:823-860`). */
  updateViewer3d(mutate: (s: Viewer3dSettings) => void): void {
    this.update('3d_viewer', mutate);
  }

  updateFpEdit(mutate: (s: FpEditSettings) => void): void {
    this.update('fpedit', mutate);
  }

  /**
   * `PCB_CALCULATOR_FRAME::SaveSettings`, one panel's worth at a time.
   *
   * Upstream writes the whole file once, when the frame closes
   * (pcb_calculator_frame.cpp:401-419). Ours is called from a debounce in
   * `editors/calculator/calc_settings.ts` for the reason that file gives.
   */
  updatePcbCalculator(mutate: (s: PcbCalculatorSettings) => void): void {
    this.update('pcb_calculator', mutate);
  }

  updateBitmap2Cmp(mutate: (s: Bitmap2CmpSettings) => void): void {
    this.update('bitmap2component', mutate);
  }

  updatePrivacy(mutate: (s: PrivacySettings) => void): void {
    this.update('privacy', mutate);
  }

  resetCommon(): void {
    this.replace('common', structuredClone(COMMON_DEFAULTS));
  }

  resetEeschema(): void {
    this.replace('eeschema', structuredClone(EESCHEMA_DEFAULTS));
  }

  setUserColors(colors: Record<string, string>): void {
    this.replace('colors.user', { ...colors });
  }

  resetUserColors(): void {
    this.replace('colors.user', {});
  }

  setUserThemes(themes: Record<string, UserColorTheme>): void {
    this.replace('colors.themes', { ...themes });
  }

  /**
   * Bind an action to `keys`, or clear it with `null`.
   *
   * Passing `undefined` restores the default, which is a *deletion* rather than
   * storing the default's value: PANEL_HOTKEYS_EDITOR's "Undo Changes" leaves no
   * trace behind, so an action whose upstream default later changes follows it.
   */
  setHotkey(id: string, keys: string | null | undefined): void {
    const next = { ...this.hotkeys };
    if (keys === undefined) delete next[id];
    else next[id] = keys;
    this.replace('hotkeys', next);
  }

  /** Replace the whole override map — the Hotkeys page committing on OK. */
  setHotkeys(overrides: Readonly<Record<string, string | null>>): void {
    this.replace('hotkeys', { ...overrides });
  }

  resetHotkeys(): void {
    this.replace('hotkeys', {});
  }
}

migrateStored();
export const settings = new SettingsManager();

// `PGM_BASE` owns `COMMON_SETTINGS` upstream and the common dialogs reach it
// through `Pgm()`. Installing the store here, where the settings live, is that
// hand-over: any dialog in `@ziroeda/common` reads the same file as the app.

setColorPickerTabStore({
  get: () => settings.common.color_picker.default_tab,
  set: (i) =>
    settings.updateCommon((s) => {
      s.color_picker.default_tab = i;
    }),
});

// eeschema's kiface registers the two settings objects its frames read (the
// symbol editor's grid and item defaults, the frames' colour theme): the
// same hand-over, through `IFACE::OnKifaceStart`.
eeschemaOnKifaceStart(
  () => settings.eeschema,
  () => settings.symbolEditor,
);
