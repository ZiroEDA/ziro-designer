// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * EESCHEMA_SETTINGS (`eeschema/eeschema_settings.{h,cpp}`): the shape of
 * `eeschema.json` and its defaults. Moved out of `designer/src/prefs/
 * settings.ts`, which still owns the store (load, merge, persist) and reads
 * this slice's type and defaults from here.
 */
import { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { defaultUnits } from '@ziroeda/common/settings/app_settings_units.js';
import {
  DEFAULT_GRID_INDEX,
  GRID_SIZE_LIST,
  type GridEntry,
  type GridOverride,
  gridEntryOf,
} from '@ziroeda/common/settings/grid_settings_ui.js';

/** LINE_MODE (sch_line.h): 0 = free, 1 = 90°, 2 = 45°. */
export type LineMode = 0 | 1 | 2;

export interface TemplateFieldName {
  name: string;
  visible: boolean;
  url: boolean;
}

export interface EeschemaSettings {
  appearance: {
    /** Active colour theme id: '_builtin_default' | '_builtin_classic' | 'user'. */
    color_theme: string;
    /**
     * `schematic.override_item_colors` in a COLOR_SETTINGS file
     * (`color_settings.cpp:48-49`), read into
     * `SCH_RENDER_SETTINGS::m_OverrideItemColors`
     * (`sch_render_settings.cpp:75`): draw every item in its LAYER's colour,
     * ignoring any colour the item itself carries.
     *
     * Upstream it is a field of the COLOR_SETTINGS FILE, so each theme has its
     * own. Ours belongs to the one writable theme — the built-ins are
     * read-only and both leave it false, which is `color_settings.cpp:49`'s
     * default — which is why the checkbox is dead unless "user" is selected,
     * exactly as `m_optOverrideColors->Enable( !IsReadOnly() )` has it.
     */
    override_item_colors: boolean;
    default_font: string;
    show_hidden_pins: boolean;
    show_hidden_fields: boolean;
    /**
     * `PARAM<bool>( "appearance.show_directive_labels", …, true )`
     * (`eeschema/eeschema_settings.cpp:210`), the checkbox between the hidden
     * fields and the ERC rows on Display Options. Nothing reads it here: a
     * directive label is drawn whatever it says.
     */
    show_directive_labels: boolean;
    show_erc_errors: boolean;
    show_erc_warnings: boolean;
    show_erc_exclusions: boolean;
    mark_sim_exclusions: boolean;
    show_op_voltages: boolean;
    show_op_currents: boolean;
    show_pin_alt_icons: boolean;
    show_page_limits: boolean;
    footprint_preview: boolean;
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
   * PANEL_EESCHEMA_DISPLAY_OPTIONS. Upstream this copy governs probes that
   * *arrive in* the schematic from the board.
   */
  cross_probing: CROSS_PROBING_SETTINGS;
  autoplace_fields: {
    enable: boolean;
    allow_rejustify: boolean;
    align_to_grid: boolean;
  };
  drawing: {
    default_line_thickness: number; // mils
    default_wire_thickness: number; // mils
    default_bus_thickness: number; // mils
    default_text_size: number; // mils
    line_mode: LineMode;
    /** editing.arc_edit_mode: 0 keep-center/adjust-radius, 1 keep-endpoints, 2 keep-center+radius. */
    arc_edit_mode: 0 | 1 | 2;
    auto_start_wires: boolean;
    repeat_label_increment: number;
    default_repeat_offset_x: number; // mils
    default_repeat_offset_y: number; // mils
    field_names: TemplateFieldName[];
    default_sheet_border_color: string;
    default_sheet_background_color: string;
    /** drawing.new_power_symbols: 0 Default, 1 Global, 2 Local (POWER_SYMBOLS). */
    new_power_symbols: 0 | 1 | 2;
  };
  input: {
    drag_is_move: boolean;
    esc_clears_net_highlight: boolean;
    /** input.allow_unconstrained_pin_swaps: allow swapping symbol pin positions. */
    allow_unconstrained_pin_swaps: boolean;
  };
  system: {
    /** system.never_show_rescue_dialog (RescueNeverShow). */
    never_show_rescue_dialog: boolean;
    /**
     * `system.units` (`app_settings.cpp:231-232`), MILS on this app's branch.
     *
     * It is a PARAM on EVERY `APP_SETTINGS_BASE` — the `:228-238` conditional
     * chooses the DEFAULT, not whether the key exists — so its absence here was
     * not "a pl_editor extra eeschema does without". Without it the frame's
     * units button was session state, lost on reload, and every page that asks
     * the frame for its unit got a constant instead of the live answer.
     */
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
  selection: {
    thickness: number; // mils
    highlight_thickness: number; // mils
    /**
     * `PARAM<int>( "selection.drag_net_collision_width", …, 4, 1, 50 )`
     * (`eeschema/eeschema_settings.cpp:453`) — "Net collision marker width:",
     * the row between the selection thickness and the highlight thickness on
     * Display Options. Nothing reads it: dragging a wire past another net
     * draws no collision marker here yet.
     */
    drag_net_collision_width: number;
    draw_selected_children: boolean;
    fill_shapes: boolean;
    highlight_netclass_colors: boolean;
    highlight_netclass_colors_thickness: number;
    highlight_netclass_colors_alpha: number;
  };
  /** EESCHEMA_SETTINGS m_AnnotatePanel ("annotation.*"). */
  annotation: {
    automatic: boolean;
    recursive: boolean;
    /** Regroup multi-unit symbols freely on a reset (annotation.regroup_units). */
    regroup_units: boolean;
    /** ANNOTATE_SCOPE_T: 0 whole schematic, 1 current sheet, 2 selection. */
    scope: number;
    /** 0 keep existing annotations, 1 reset them. */
    options: number;
    /** Visible-severity mask of the message panel; -1 = "not set yet" (all). */
    messages_filter: number;
    method: 0 | 1 | 2; // first free | sheet*100 | sheet*1000
    sort_order: 0 | 1; // by X | by Y
  };
  /** ERC dialog state (EESCHEMA_SETTINGS m_ERCDialog, "ERC.*"), the three
   *  toggles behind DIALOG_ERC's config-menu button. */
  erc_dialog: {
    crossprobe: boolean;
    scroll_on_crossprobe: boolean;
    show_all_errors: boolean;
  };
  /** LIB_TREE persisted state (EESCHEMA_SETTINGS m_LibTree). */
  lib_tree: {
    /** Ordered list of visible columns in the tree ("Item" is always first). */
    columns: string[];
    open_libs: string[];
  };
  /** Symbol Library Browser state (EESCHEMA_SETTINGS m_LibViewPanel, "lib_view.*").
   *  show_pin_numbers is deliberately absent: upstream keeps it in the struct but
   *  registers no param for it, so the toggle is session-only. */
  lib_view: {
    lib_list_width: number; // px
    cmp_list_width: number; // px
    show_pin_electrical_type: boolean;
  };
  /**
   * `EESCHEMA_SETTINGS::m_Simulator.preferences` — what a wheel gesture does on
   * a simulator plot, per modifier (`eeschema/sim/sim_preferences.h:53-61`,
   * serialised at `eeschema_settings.cpp:587-609`).
   *
   * The values are `SIM_MOUSE_WHEEL_ACTION` (`sim_preferences.h:37-50`), which
   * is a plain enum written as an int, so they are stored as its ordinals and
   * `SIM_WHEEL_ACTIONS` below names them.
   */
  simulator: {
    mouse_wheel_actions: {
      vertical_unmodified: number;
      vertical_with_ctrl: number;
      vertical_with_shift: number;
      vertical_with_alt: number;
      horizontal: number;
    };
  };
  /** Symbol Chooser dialog state (EESCHEMA_SETTINGS m_SymChooserPanel). */
  sym_chooser: {
    sash_pos_h: number; // px width of the right (preview) pane
    sash_pos_v: number; // px height of the details pane (power layout)
    sort_mode: 0 | 1; // SORT_MODE: 0 best match, 1 alphabetic
  };
  /** The APP_SETTINGS_BASE::PRINTING slice eeschema's Print dialog persists
   *  ("printing.*" in eeschema.json; key names + defaults from
   *  common/settings/app_settings.cpp, monochrome defaults ON). */
  printing: {
    /** Print the background color. */
    background: boolean;
    /** Print in black and white. */
    monochrome: boolean;
    /** Use a different color theme for printing (else the display theme). */
    use_theme: boolean;
    /** COLOR_SETTINGS filename of the print theme. */
    color_theme: string;
    /** Print the drawing sheet (border and title block). */
    title_block: boolean;
  };
  window: {
    /**
     * `dock_pos` for the panes of the left column, the part of
     * `window.perspective` our column can express.
     *
     * KiCad persists its whole wxAUI layout as one string
     * (`SCH_EDIT_FRAME::SaveSettings` -> `m_auimgr.SavePerspective()`, restored
     * by `RestoreAuiLayout()` at sch_edit_frame.cpp:304 BEFORE any pane is
     * shown), and each pane's entry carries a `pos=` field. Those numbers are
     * not `AddPane`'s `Position()`: wxAUI renumbers the shown panes of a dock on
     * every `Update()`, so they are wherever the last session left them.
     *
     * Measured with `qa/probes/aui_dock_pos_probe.cpp`: seeded with this
     * machine's own saved perspective (PropertiesManager `pos=0`,
     * SchematicHierarchy `pos=1`), closing both palettes and re-opening
     * Properties then the hierarchy leaves Properties on top — while the same
     * sequence from `AddPane`'s numbers leaves the hierarchy on top. Restarting
     * every session from the `Position()` table, as we did, therefore made the
     * column forget an order KiCad remembers.
     */
    left_dock_pos: Record<string, number>;
    grid: {
      /**
       * `GRID_SETTINGS::grids` — `GRID{ name, x, y }` per row
       * (`include/settings/grid_settings.h:33-54`), which is what
       * `PANEL_GRID_SETTINGS` writes back (`panel_grid_settings.cpp:190`) and
       * what `DIALOG_GRID_SETTINGS` edits. It held one string per grid until
       * that dialog was ported, which could carry neither a name nor a
       * non-square Y.
       */
      sizes: GridEntry[];
      last_size_idx: number;
      fast_grid_1: number;
      fast_grid_2: number;
      /** GAL grid appearance (gal_options_panel): dots | lines | crosses. */
      style: 'dots' | 'lines' | 'crosses';
      line_width: number; // px
      min_spacing: number; // px
      snap: 0 | 1 | 2; // always | when shown | never
      show: boolean;
      /** Whether the per-item grid overrides apply (ACTIONS::toggleGridOverrides). */
      overrides_enabled: boolean;
      overrides: {
        connected: GridOverride;
        wires: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
    cursor: {
      /** Crosshair mode (cursorSmall/Full/45Crosshairs): small cross, full-window, or 45°. */
      crosshair: 'small' | 'full' | '45';
      always_show_cursor: boolean;
    };
  };
  /**
   * The "Export to other sheets" ticks from Page Settings, remembered.
   *
   * They are preferences upstream, not per-dialog state, because
   * `SCH_EDIT_FRAME::InitSheet` reads them when a *new* sheet is created:
   *
   *     if( cfg->m_PageSettings.export_paper )
   *         newScreen->SetPageSettings( GetScreen()->GetPageSettings() );
   *     if( cfg->m_PageSettings.export_title )
   *         tb2.SetTitle( tb1.GetTitle() );
   *
   * Every one defaults to false, so a new sheet starts with its own empty title
   * block unless you have asked for the parent's to carry over.
   */
  page_settings: {
    export_paper: boolean;
    export_revision: boolean;
    export_date: boolean;
    export_title: boolean;
    export_company: boolean;
    export_comments: boolean[];
  };
}

export const EESCHEMA_DEFAULTS: EeschemaSettings = {
  appearance: {
    color_theme: '_builtin_default',
    override_item_colors: false,
    default_font: 'KiCad Font',
    show_hidden_pins: false,
    show_hidden_fields: false,
    // `PARAM<bool>( …, true )` — upstream's default.
    show_directive_labels: true,
    show_erc_errors: true,
    show_erc_warnings: true,
    show_erc_exclusions: false,
    mark_sim_exclusions: true,
    show_op_voltages: true,
    show_op_currents: true,
    show_pin_alt_icons: true,
    show_page_limits: true,
    footprint_preview: true,
    custom_toolbars: false,
  },
  cross_probing: { ...new CROSS_PROBING_SETTINGS() },
  autoplace_fields: {
    enable: true,
    allow_rejustify: true,
    align_to_grid: true,
  },
  drawing: {
    default_line_thickness: 6,
    default_wire_thickness: 6,
    default_bus_thickness: 12,
    default_text_size: 50,
    line_mode: 1,
    arc_edit_mode: 0,
    auto_start_wires: true,
    repeat_label_increment: 1,
    default_repeat_offset_x: 0,
    default_repeat_offset_y: 100,
    field_names: [],
    default_sheet_border_color: '',
    default_sheet_background_color: '',
    new_power_symbols: 0,
  },
  input: {
    drag_is_move: false,
    esc_clears_net_highlight: true,
    allow_unconstrained_pin_swaps: false,
  },
  system: {
    never_show_rescue_dialog: false,
    // The `app_settings.cpp:228-238` branch, asked rather than restated.
    units: defaultUnits('eeschema'),
    last_metric_units: 'mm',
    last_imperial_units: 'mils',
  },
  selection: {
    thickness: 3,
    highlight_thickness: 2,
    // `PARAM<int>( …, 4, 1, 50 )` — upstream's default.
    drag_net_collision_width: 4,
    draw_selected_children: true,
    fill_shapes: false,
    highlight_netclass_colors: false,
    highlight_netclass_colors_thickness: 15,
    // 0.6, NOT 60. `PARAM<double>( "selection.highlight_netclass_colors_alpha",
    // …, 0.6, 0, 1 )` (`eeschema_settings.cpp:450-451`) — the panel is what
    // scales it, showing `alpha * 100` and storing `GetValue() / 100.0`
    // (`panel_eeschema_display_options.cpp:73`, `:117`). Storing the displayed
    // number would have made a `.json` of ours disagree with KiCad's, and the
    // painter multiplies the colour's alpha by this directly.
    highlight_netclass_colors_alpha: 0.6,
  },
  annotation: {
    automatic: true,
    recursive: true,
    regroup_units: false,
    scope: 0,
    options: 0,
    messages_filter: -1,
    method: 0,
    sort_order: 0,
  },
  erc_dialog: {
    crossprobe: true,
    scroll_on_crossprobe: true,
    show_all_errors: false,
  },
  lib_tree: {
    columns: [],
    open_libs: [],
  },
  lib_view: {
    lib_list_width: 150,
    cmp_list_width: 150,
    show_pin_electrical_type: true,
  },
  // PANEL_SYMBOL_CHOOSER::FinishSetup (panel_symbol_chooser.cpp:436-446) seeds
  // both from dialog units: sash_pos_h = horizPixelsFromDU( 220 ) and
  // sash_pos_v = horizPixelsFromDU( 230 ), which [px] measure 440 and 460 here
  // (qa/probes/chooser_shell_probe.cpp). Those are wxSplitterWindow sash
  // positions, so they size the FIRST pane; ours store the second, so each is
  // the container minus the sash minus upstream's number:
  //   880 dialog wide   - 440 - 5 sash          = 435 for the preview column
  //   631 splitter tall - 460 - 5 sash          = 166 for the details pane
  // (631 is the 680px client height less the 5px wxBOTTOM under the splitter
  // and the 44px button row - a 34px wxButton in a wxALL 5 border.)
  // [data] the five PARAM_ENUM defaults at `eeschema_settings.cpp:587-609` —
  // ZOOM, PAN_LEFT_RIGHT, PAN_UP_DOWN, NONE, NONE. Note these are the PARAMs'
  // own defaults, which happen to equal `GetMouseDefaults()`; the panel's
  // "Reset to Mouse Defaults" button goes to that function, not to these.
  simulator: {
    mouse_wheel_actions: {
      vertical_unmodified: 4,
      vertical_with_ctrl: 1,
      vertical_with_shift: 3,
      vertical_with_alt: 0,
      horizontal: 0,
    },
  },
  sym_chooser: {
    sash_pos_h: 435,
    sash_pos_v: 166,
    sort_mode: 0,
  },
  printing: {
    background: false,
    monochrome: true,
    use_theme: false,
    color_theme: '',
    title_block: false,
  },
  window: {
    // The state `AddPane` leaves behind, i.e. a profile with no saved
    // perspective: `SCH_LEFT_PANE_POSITION` in
    // `editors/schematic/panes.ts`, which is where the numbers are documented
    // against their `Position()` call sites.
    left_dock_pos: { netNavigator: 0, hierarchy: 1, properties: 2, selectionFilter: 4 },
    grid: {
      // `DefaultGridSizeList()`'s eeschema row, asked rather than restated —
      // the same table the grid selector reads. It was written out by hand here
      // and agreed with the table by coincidence.
      sizes: GRID_SIZE_LIST.eeschema.map(gridEntryOf),
      last_size_idx: DEFAULT_GRID_INDEX.eeschema,
      fast_grid_1: 1,
      fast_grid_2: 2,
      style: 'dots',
      line_width: 1,
      min_spacing: 10,
      snap: 0,
      show: true,
      // `true`, and in BOTH arms of the per-editor split: APP_SETTINGS_BASE
      // gives eeschema/symbol_editor and everything else the same default for
      // this one (app_settings.cpp:497-498 and :523-524), and only
      // `override_connected` and `override_graphics_idx` differ between them.
      // So it is editor-independent, which is why it can live in this one
      // shared grid block.
      //
      // Ours defaulted it false, which is why the schematic's grid-overrides
      // toolbar button opened unlit where a real eeschema shows it lit — the
      // button is one of the two that genuinely IS a toggle
      // (ACTIONS::toggleGridOverrides declares TOOLBAR_STATE::TOGGLE), so the
      // wrong default reads as the wrong button state.
      overrides_enabled: true,
      overrides: {
        connected: { enabled: false, size: '50 mil' },
        wires: { enabled: false, size: '50 mil' },
        text: { enabled: false, size: '25 mil' },
        graphics: { enabled: false, size: '25 mil' },
      },
    },
    cursor: {
      // KiCad's defaults: CROSS_HAIR_MODE::SMALL_CROSS, always_show_cursor true
      // (common/settings/app_settings.cpp). A full-window crosshair on top of a
      // tool's own bitmap cursor reads as two cursors fighting each other.
      crosshair: 'small',
      always_show_cursor: true,
    },
  },
  // eeschema_settings.cpp declares every one of these false, so a new sheet
  // starts with its own empty title block unless asked otherwise.
  page_settings: {
    export_paper: false,
    export_revision: false,
    export_date: false,
    export_title: false,
    export_company: false,
    export_comments: [false, false, false, false, false, false, false, false, false],
  },
};
