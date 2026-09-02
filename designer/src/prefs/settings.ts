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

import {
  CROSS_PROBING_DEFAULTS,
  type CrossProbingSettings,
} from '@ziroeda/common/src/cross_probing_settings.js';
import type { EdaUnits } from '@ziroeda/common/src/eda_units.js';
import type { RegulatorData } from '@ziroeda/pcb_calculator';
import { defaultUnits } from '../ui/app_settings_units.js';
import {
  DEFAULT_GRID_INDEX,
  GRID_SIZE_LIST,
  type GridEntry,
  gridEntryOf,
} from '../ui/grid_settings.js';
import { normalizeToolbarSettings, type ToolbarSettings } from '../ui/toolbar_config.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  writeRoutingSettings,
  type RoutingSettingsJson,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';

// ----- COMMON_SETTINGS ---------------------------------------------------------

/** MOUSE_DRAG_ACTION (common_settings.h). */
export type MouseDragAction = 'select' | 'drag_selected' | 'drag_any' | 'pan' | 'zoom' | 'none';

/** Scroll-wheel modifier assignment: which modifier triggers each gesture. */
export type ScrollModifier = 'none' | 'ctrl' | 'shift' | 'alt';

export interface CommonSettings {
  appearance: {
    /** PANEL_COMMON_SETTINGS "Icon theme": light | dark | auto. */
    icon_theme: 'light' | 'dark' | 'auto';
    toolbar_icon_size: 'small' | 'normal' | 'large';
    show_scrollbars: boolean;
    use_icons_in_menus: boolean;
    hicontrast_dimming_factor: number;
    /** `appearance.grid_striping` — "Use alternating row colors in tables". */
    grid_striping: boolean;
    /**
     * `appearance.use_custom_cursors`. The checkbox is "Disable custom
     * cursors", so the control is the NEGATION of this — as upstream's
     * `m_disableCustomCursors->SetValue( !cfg->m_Appearance.use_custom_cursors )`.
     */
    use_custom_cursors: boolean;
    /**
     * `appearance.zoom_correction_factor`, PARAM<double> default 1.0, range
     * 0.1..10.0. ZOOM_CORRECTION_CTRL's whole output: the Scaling group asks
     * the user to measure a drawn ruler so a millimetre on screen is a
     * millimetre. A browser needs this MORE than a desktop app, since a CSS
     * pixel has no fixed physical size at all.
     */
    zoom_correction_factor: number;
  };
  /**
   * `git.*` — COMMON_SETTINGS `m_Git`
   * (`common/settings/common_settings.cpp:459-472`), the five parameters
   * `PANEL_GIT_REPOS` edits. `git.repositories`, the sixth, is a
   * `PARAM_LAMBDA<nlohmann::json>` the page does not touch.
   *
   * Nothing reads them here: upstream drives libgit2 against a project checked
   * out on disk, polling a remote and stamping commits with an author. Ours
   * live in the cloud store and are versioned by it. The page is still drawn,
   * disabled, because KiCad has it — and holding the stored values is what
   * makes "Reset Version Control to Defaults" a real button, as upstream's is.
   */
  git: {
    authorName: string;
    authorEmail: string;
    /** `PARAM<bool>( "git.useDefaultAuthor", …, true )`. */
    useDefaultAuthor: boolean;
    /** `PARAM<bool>( "git.enableGit", …, true )`. */
    enableGit: boolean;
    /**
     * `PARAM<int>( "git.updatInterval", …, 5 )` — minutes between remote
     * checks. The missing `e` is upstream's own: the key is spelled that way in
     * every `common.json` KiCad has written, so it is spelled that way here.
     */
    updatInterval: number;
  };
  /**
   * `spacemouse.*` — COMMON_SETTINGS `m_SpaceMouse`
   * (`include/settings/common_settings.h:124-132`,
   * `common/settings/common_settings.cpp:308-324`), the six parameters
   * `PANEL_SPACEMOUSE` edits.
   *
   * Nothing reads them here: a SpaceMouse reaches KiCad through 3Dconnexion's
   * own daemon and the 3dxware SDK, and no browser API exposes the device. The
   * page is still drawn, disabled, because it is a page KiCad has — and its
   * controls show STORED values rather than literals, so "Reset SpaceMouse to
   * Defaults" has something to reset and the page is a `RESETTABLE_PANEL` the
   * way upstream's is.
   */
  spacemouse: {
    /** `PARAM<int>( "spacemouse.rotate_speed", …, 5, 1, 10 )`. */
    rotate_speed: number;
    /** `PARAM<int>( "spacemouse.pan_speed", …, 5, 1, 10 )`. */
    pan_speed: number;
    reverse_rotate: boolean;
    reverse_pan_x: boolean;
    reverse_pan_y: boolean;
    reverse_zoom: boolean;
  };
  input: {
    auto_pan: boolean;
    auto_pan_acceleration: number; // 0..9
    center_on_zoom: boolean;
    warp_mouse_on_move: boolean;
    hotkey_feedback: boolean;
    /** `input.focus_follow_sch_pcb`, default false. */
    focus_follow_sch_pcb: boolean;
    immediate_actions: boolean; // !("First hotkey selects tool")
    zoom_acceleration: boolean;
    zoom_speed: number; // 1..10
    zoom_speed_auto: boolean;
    horizontal_pan: boolean;
    /**
     * `input.motion_pan_modifier`, `PARAM<int>( …, 0 )`
     * (`common/settings/common_settings.cpp:287`) — "Pan on mouse movement
     * with key", read by `WX_VIEW_CONTROLS::LoadSettings`
     * (`wx_view_controls.cpp:193`) and `EDA_DRAW_PANEL_GAL`
     * (`draw_panel_gal.cpp:832`).
     *
     * Upstream stores a `WXK_*` key code and the panel maps it to the four
     * choices (`panel_mouse_settings.cpp:113-119`); ours stores the choice, as
     * the other three modifier settings beside it do.
     */
    motion_pan_modifier: ScrollModifier;
    scroll_modifier_zoom: ScrollModifier;
    scroll_modifier_pan_h: ScrollModifier;
    scroll_modifier_pan_v: ScrollModifier;
    reverse_scroll_zoom: boolean;
    reverse_scroll_pan_h: boolean;
    mouse_left: MouseDragAction; // select | drag_selected | drag_any
    mouse_middle: MouseDragAction; // pan | zoom | none
    mouse_right: MouseDragAction; // pan | zoom | none
  };
  system: {
    file_history_size: number;
    /**
     * COMMON_SETTINGS `system.language` (common_settings.cpp:355-356), default
     * "Default". Upstream stores the LANGUAGE_DESCR::m_Lang_Label rather than a
     * language code — pgm_base.cpp:592-596 matches the stored string against
     * m_Lang_Label — so ours holds a label from `ui/language_menu.ts`.
     */
    language: string;
    autosave_interval: number; // seconds; 0 = disabled
    session: {
      remember_open_files: boolean;
      /** Libraries pinned to the top of the chooser tree (SESSION.pinned_symbol_libs). */
      pinned_symbol_libs: string[];
      /** The same, for footprint libraries (`session.pinned_fp_libs`,
       *  common_settings.cpp:405-406). CvPcb's "Footprint Libraries" pane
       *  lists these first (cvpcb_mainframe.cpp:1017-1046). */
      pinned_fp_libs: string[];
    };
  };
  /**
   * `auto_backup.*`. 10.0.5 reshaped this: `PANEL_COMMON_SETTINGS` now offers
   * Automatically backup projects, Format, Location and Maximum total backup
   * size, and `common_settings.cpp:128-138` registers exactly those four.
   * The count/interval params ours carried — backup_on_autosave,
   * limit_total_files, limit_daily_files, min_interval — are gone from both.
   */
  backup: {
    enabled: boolean;
    /**
     * `PARAM_ENUM<BACKUP_FORMAT>( "auto_backup.format", …, INCREMENTAL )`.
     * INCREMENTAL = 0 keeps a hidden .history git repository of continuous
     * changes; ZIP = 1 writes timestamped archives on save.
     */
    format: 'incremental' | 'zip';
    /** `PARAM_ENUM<BACKUP_LOCATION>( "auto_backup.location", …, PROJECT_DIR )`. */
    location: 'project' | 'user';
    limit_total_size: number; // bytes
  };
  /**
   * `APP_SETTINGS_BASE::m_ColorPicker`, whose single parameter is
   * `color_picker.default_tab` (common/settings/app_settings.cpp:137-138).
   * `DIALOG_COLOR_PICKER` reads it into `m_notebook->SetSelection`
   * (dialog_color_picker.cpp:89) and writes `m_notebook->GetSelection()` back
   * in its destructor (`:114`), so the picker reopens on whichever page was
   * last used. The shipped default is 0 — "Color Picker", the page the base
   * adds first (dialog_color_picker_base.cpp:140).
   *
   * Upstream this lives in each app's OWN settings file, because the dialog
   * asks `Kiface().KifaceSettings()`. Ours is one shared component with no
   * kiface to ask and the same dialog wherever it opens, so it is keyed once
   * here, beside `search_pane` — the other APP_SETTINGS_BASE slice a shared
   * widget reads.
   */
  color_picker: {
    default_tab: number;
  };
  /** APP_SETTINGS_BASE::SEARCH_PANE, the docked Search pane's own options. */
  search_pane: {
    /**
     * What picking a row does to the view (SEARCH_PANE::SELECTION_ZOOM), set
     * from the pane's "Zoom to Selection" / "Pan to Selection" toggles.
     * SCH_SEARCH_HANDLER::SelectItems runs ACTIONS::centerSelection for `pan`
     * and ACTIONS::zoomFitSelection for `zoom`, after selecting the hits.
     */
    selection_zoom: 'none' | 'pan' | 'zoom';
  };
  /**
   * `dialog.controls` — every dialog's remembered control values.
   *
   * COMMON_SETTINGS registers this as a `PARAM_LAMBDA<nlohmann::json>` named
   * exactly `"dialog.controls"` (common/settings/common_settings.cpp:478-505),
   * fed from `COMMON_SETTINGS_INTERNALS::m_dialogControlValues`, a
   * `map<dialog key, map<control key, json>>`
   * (include/settings/common_settings_internals.h:29). So this is a *user*
   * setting living in `common.json`, not session state: it outlives the
   * process, which is why KiCad's "Place repeated copies" is still ticked after
   * the placer tool has been closed and reopened.
   *
   * Written by `DIALOG_SHIM::SaveControlState` and read back by
   * `DIALOG_SHIM::LoadControlState` (common/dialog_shim.cpp:654, :765); see
   * `ui/dialog_control_state.ts` for the port of that half.
   */
  dialog: {
    controls: DialogControls;
  };
}

/**
 * One remembered control value.
 *
 * `SaveControlState` stores a `nlohmann::json` per control, and the branches it
 * writes are exhaustively: a UNIT_BINDER's int, a `wxComboBox`'s string, a
 * `wxOwnerDrawnComboBox`/`wxChoice`/`wxRadioBox`'s selection index, a
 * `wxTextEntry`'s string, a `wxCheckBox`/`wxRadioButton`'s bool, a
 * `wxSpinCtrl`'s int, a splitter's sash position, a scrolled window's scroll
 * position, a notebook's *page title*, and a WX_GRID's shown-columns string
 * (dialog_shim.cpp:678-745). Every one of those is a JSON scalar, so this is
 * the whole value domain for a *control*.
 *
 * The one non-scalar upstream writes into the same map is the dialog's own
 * geometry, an `{x,y,w,h}` object under the reserved key `"__geometry"`
 * (dialog_shim.cpp:664-671, read back in `DIALOG_SHIM::Show`, :455-468). That
 * is not ported: a wxDialog is a top-level window the user drags and resizes
 * and ours are centred `.ze-modal` divs, so there is no position to remember.
 * When one becomes movable, geometry belongs here under that same key.
 */
export type DialogControlValue = boolean | number | string;

/** dialog key -> control key -> value; `m_dialogControlValues`. */
export type DialogControls = Record<string, Record<string, DialogControlValue>>;

export const COMMON_DEFAULTS: CommonSettings = {
  appearance: {
    icon_theme: 'auto',
    toolbar_icon_size: 'normal',
    show_scrollbars: true,
    use_icons_in_menus: true,
    hicontrast_dimming_factor: 80,
    grid_striping: false,
    use_custom_cursors: true,
    zoom_correction_factor: 1.0,
  },
  // `m_Git` — the five PARAM defaults.
  git: {
    authorName: '',
    authorEmail: '',
    useDefaultAuthor: true,
    enableGit: true,
    updatInterval: 5,
  },
  // `m_SpaceMouse` — the six PARAM defaults (5, 5, and four falses).
  spacemouse: {
    rotate_speed: 5,
    pan_speed: 5,
    reverse_rotate: false,
    reverse_pan_x: false,
    reverse_pan_y: false,
    reverse_zoom: false,
  },
  input: {
    auto_pan: false,
    auto_pan_acceleration: 5,
    center_on_zoom: true,
    warp_mouse_on_move: true,
    hotkey_feedback: true,
    focus_follow_sch_pcb: false,
    immediate_actions: true,
    zoom_acceleration: false,
    zoom_speed: 1,
    zoom_speed_auto: true,
    horizontal_pan: false,
    // `PARAM<int>( "input.motion_pan_modifier", …, 0 )` — 0 is no key.
    motion_pan_modifier: 'none',
    scroll_modifier_zoom: 'none',
    scroll_modifier_pan_h: 'ctrl',
    scroll_modifier_pan_v: 'shift',
    reverse_scroll_zoom: false,
    reverse_scroll_pan_h: false,
    mouse_left: 'drag_selected',
    mouse_middle: 'pan',
    mouse_right: 'pan',
  },
  system: {
    file_history_size: 9,
    language: 'Default',
    autosave_interval: 600,
    session: { remember_open_files: false, pinned_symbol_libs: [], pinned_fp_libs: [] },
  },
  backup: {
    enabled: true,
    format: 'incremental',
    location: 'project',
    // `PARAM<unsigned long long>( "auto_backup.limit_total_size", …, 104857600 )`
    limit_total_size: 104857600,
  },
  // `PARAM<int>( "color_picker.default_tab", …, 0 )` — page 0 is "Color
  // Picker", which is the page the notebook adds first and adds selected.
  color_picker: { default_tab: 0 },
  // KiCad's default is PAN (app_settings.cpp: search_pane.selection_zoom).
  search_pane: {
    selection_zoom: 'pan',
  },
  // `nlohmann::json::object()` is the param's default (common_settings.cpp:505):
  // no dialog has been opened yet, so every control takes its own default.
  dialog: { controls: {} },
};

// ----- EESCHEMA_SETTINGS --------------------------------------------------------

/** LINE_MODE (sch_line.h): 0 = free, 1 = 90°, 2 = 45°. */
export type LineMode = 0 | 1 | 2;

export interface TemplateFieldName {
  name: string;
  visible: boolean;
  url: boolean;
}

export interface GridOverride {
  enabled: boolean;
  size: string;
}

export interface EeschemaSettings {
  appearance: {
    /** Active colour theme id: '_builtin_default' | '_builtin_classic' | 'user'. */
    color_theme: string;
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
  cross_probing: CrossProbingSettings;
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
  /** system.never_show_rescue_dialog (RescueNeverShow). */
  system: {
    never_show_rescue_dialog: boolean;
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
  cross_probing: { ...CROSS_PROBING_DEFAULTS },
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
    highlight_netclass_colors_alpha: 60,
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

export interface PcbnewSettings {
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
  cross_probing: CrossProbingSettings;
  printing: PcbnewPrinting;
  /**
   * Tool settings nested inside pcbnew.json. `pns` is PNS::ROUTING_SETTINGS,
   * which upstream builds as a NESTED_SETTINGS at exactly this path
   * (pns_tool_base.cpp:103), so the sub-keys are KiCad's own spellings; the
   * model, its defaults and the round-trip live in
   * `@ziroeda/pcbnew/src/router/pns_routing_settings.ts`.
   */
  tools: {
    pns: RoutingSettingsJson;
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
      overrides_enabled: boolean;
      overrides: {
        connected: GridOverride;
        wires: GridOverride;
        vias: GridOverride;
        text: GridOverride;
        graphics: GridOverride;
      };
    };
  };
}

export const PCBNEW_DEFAULTS: PcbnewSettings = {
  appearance: {
    color_theme: '_builtin_default',
    custom_toolbars: false,
  },
  cross_probing: { ...CROSS_PROBING_DEFAULTS },
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
  },
};

// ----- PL_EDITOR_SETTINGS ------------------------------------------------------

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

// ----- SYMBOL_EDITOR_SETTINGS ("symbol_editor.json") ---------------------------

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

// ----- GERBVIEW_SETTINGS ("gerbview.json") -------------------------------------

/**
 * `gerbview.json` — `GERBVIEW_SETTINGS` (`gerbview/gerbview_settings.cpp:39-98`)
 * over its `APP_SETTINGS_BASE` base (`common/settings/app_settings.cpp`).
 *
 * Same rule as `PlEditorSettings` above: only the keys the Gerber Viewer puts a
 * control in front of. The four file histories (`system.drill_file_history`,
 * `system.zip_file_history`, `system.job_file_history`) and
 * `gerber_to_pcb_layers` are omitted — the first three are paths on a disk this
 * app does not have, and the fourth is written by the Map Gerber Layers dialog
 * rather than by Preferences.
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
  /** `gerber_to_pcb_copperlayers_count` (`gerbview_settings.cpp:76-77`), 2. */
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
  gerber_to_pcb_copperlayers_count: 2,
};

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
export interface FpEditSettings {
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
  window: { lib_width: 250 },
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
 */
export function mergeFpEdit(stored: unknown): FpEditSettings {
  const out = deepMerge(structuredClone(FPEDIT_DEFAULTS), stored);
  const widths = (stored as { lib_tree?: { column_widths?: unknown } } | undefined)?.lib_tree
    ?.column_widths;
  out.lib_tree.column_widths = normalizeColumnWidths(widths);
  return out;
}

/** Parse a grid size string ("50 mil", "1.27 mm") into IU (100 nm). */
export function gridSizeToIU(size: string): number {
  const m = /^\s*([\d.]+)\s*(mil|mils|mm|in|inch)?\s*$/i.exec(size);
  if (!m) return 12700; // 50 mil fallback
  const v = Number(m[1]);
  const unit = (m[2] ?? 'mil').toLowerCase();
  if (!Number.isFinite(v) || v <= 0) return 12700;
  if (unit.startsWith('mm')) return Math.round(v * 10000);
  if (unit.startsWith('in')) return Math.round(v * 254000);
  return Math.round(v * 254); // mils
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
 * at the post-migration numbering — `OUTLINE_LAYERS[0]` is `F.Cu`, matching
 * the comment at :55-56 — so there is nothing for `migrateSlice` to do.
 */
export interface Bitmap2CmpSettings {
  /** `bitmap_file_name` (:42), "". */
  bitmap_file_name: string;
  /** `converted_file_name` (:43), "". */
  converted_file_name: string;
  /** `units` (:44), 0. Output-size unit choice: 0 mm, 1 inch, 2 DPI. */
  units: number;
  /** `threshold` (:45), 50. Black/white threshold, 0..100. */
  threshold: number;
  /** `negative` (:46), false. */
  negative: boolean;
  /**
   * `last_format` (:47), 0. `OUTPUT_FMT_ID` (bitmap2component.h:32-39):
   * 0 symbol, 1 symbol-paste, 2 footprint, 3 postscript, 4 drawing sheet.
   */
  last_format: number;
  /** `last_mod_layer` (:48), 0. Footprint outline layer, PCBNew ordering. */
  last_mod_layer: number;
}

export const BITMAP2CMP_DEFAULTS: Bitmap2CmpSettings = {
  bitmap_file_name: '',
  converted_file_name: '',
  units: 0,
  threshold: 50,
  negative: false,
  last_format: 0,
  last_mod_layer: 0,
};

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
 * Whether a stored value can stand in for a default of this shape.
 *
 * Only reached for a default that is an array, null, or a scalar — `deepMerge`
 * recurses into plain objects instead. A scalar default already fails the
 * `typeof` test against an array (`typeof [] === 'object'`), so no separate
 * array guard is needed on that side; a null default accepts anything, since
 * it carries no shape to compare.
 */
function sameShape(defaults: unknown, stored: unknown): boolean {
  if (Array.isArray(defaults)) return Array.isArray(stored);
  if (defaults === null) return true;
  return typeof defaults === typeof stored;
}

/**
 * Exported for its own tests: it is the only thing standing between a stale or
 * hand-edited localStorage and the renderer, and it has no other seam.
 */
export function deepMerge<T>(defaults: T, stored: unknown): T {
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    // A stored value of the wrong *type* is not a setting, it is damage:
    // localStorage is editable by hand, survives across versions, and a string
    // where a number belongs reaches the renderer and throws before React
    // mounts — a white screen, which is the failure the capability probe
    // exists to avoid producing. Falling back to the default is always safe;
    // the worst case is one preference reverting.
    if (stored === undefined || !sameShape(defaults, stored)) return defaults;
    return stored as T;
  }
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  if (typeof stored === 'object' && stored !== null) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (k in out) out[k] = deepMerge(out[k], v);
    }
  }
  return out as T;
}

/**
 * One-time corrections to already-stored settings. Every settings object is
 * persisted whole, so changing a default above never reaches anyone who has
 * used the app before, a default that was simply wrong has to be rewritten
 * once, here. KiCad's own SETTINGS_MANAGER migrates stored files the same way.
 */
export const SETTINGS_VERSION = 4;

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
  'colors.user',
  'hotkeys',
  // `TOOLBAR_SETTINGS` is a file of its own per app, not a key inside the app's
  // settings: `GetToolbarSettings<…>( "pl_editor-toolbars" )`
  // (`pagelayout_editor/pl_editor.cpp:88`, `eeschema/eeschema.cpp:346`,
  // `pcbnew/pcbnew.cpp:455`). One slice each, spelled as upstream spells the
  // file, so a synced account carries `eeschema-toolbars.json` and not a
  // sub-object of `eeschema.json`.
  'eeschema-toolbars',
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
] as const;

export type ToolbarApp = (typeof TOOLBAR_APPS)[number];

/** `GetToolbarSettings<…>( "<app>-toolbars" )` — the file name, spelled once. */
export const toolbarSlice = (app: ToolbarApp): SettingsSlice => `${app}-toolbars` as SettingsSlice;

/** Where a slice lives in localStorage. The one place the prefix is written. */
export const sliceStorageKey = (slice: SettingsSlice): string => `ziroeda.${slice}`;

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

    const raw = localStorage.getItem(sliceStorageKey('eeschema'));
    if (raw) {
      const s = JSON.parse(raw) as EeschemaSettings;
      if (migrateSlice('eeschema', s, from))
        localStorage.setItem(sliceStorageKey('eeschema'), JSON.stringify(s));
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

function load<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(defaults);
    return deepMerge(structuredClone(defaults), JSON.parse(raw));
  } catch {
    return structuredClone(defaults);
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

/**
 * `dialog.controls` on the way in — the port of the PARAM_LAMBDA *setter* at
 * common_settings.cpp:488-503.
 *
 * Upstream reads it defensively for the same reason ours must: the file is on
 * disk and hand-editable, so it checks `aVal.is_object()` and then
 * `dlgVal.is_object()` per dialog before copying, and silently skips anything
 * else. Ours adds the leaf check upstream gets for free from `nlohmann::json`
 * being able to hold anything: a leaf that is not a scalar is dropped, because
 * {@link DialogControlValue} is the whole domain `SaveControlState` writes.
 *
 * Free-form, so not `deepMerge`d — see the note above `normalizeHotkeys`: the
 * defaults are `{}` and `deepMerge` keeps only keys the defaults already have,
 * so every stored dialog would be dropped on the way back in.
 */
export function normalizeDialogControls(parsed: unknown): DialogControls {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: DialogControls = {};
  for (const [dlgKey, dlgVal] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof dlgVal !== 'object' || dlgVal === null || Array.isArray(dlgVal)) continue;
    const controls: Record<string, DialogControlValue> = {};
    for (const [ctrlKey, ctrlVal] of Object.entries(dlgVal as Record<string, unknown>)) {
      if (
        typeof ctrlVal === 'boolean' ||
        typeof ctrlVal === 'number' ||
        typeof ctrlVal === 'string'
      )
        controls[ctrlKey] = ctrlVal;
    }
    out[dlgKey] = controls;
  }
  return out;
}

/**
 * `common.json` on the way in: the fixed settings tree merged as usual, with
 * the one free-form subtree inside it normalised instead.
 *
 * One function rather than two because the same value arrives by two routes —
 * localStorage at startup and the account at sign-in — and a subtree repaired
 * on only one of them is the `colors.user` bug again, where every change was
 * written and silently discarded on reload.
 */
export function mergeCommon(stored: unknown): CommonSettings {
  const out = deepMerge(structuredClone(COMMON_DEFAULTS), stored);
  const dialog = (stored as { dialog?: { controls?: unknown } } | undefined)?.dialog;
  out.dialog = { controls: normalizeDialogControls(dialog?.controls) };
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
 * Read a free-form map out of localStorage through `normalize`.
 *
 * `load()` cannot do this: it goes through `deepMerge`, which keeps only keys
 * the *defaults* already have, so a map whose defaults are `{}` comes back
 * empty every time. `colors.user` was loaded that way, which meant the User
 * colour theme was written on every change and silently discarded on every
 * reload — the exact trap the note above `normalizeHotkeys` describes, in the
 * one other place it applies.
 */
function loadFreeForm<T>(key: string, normalize: (parsed: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return normalize(undefined);
    return normalize(JSON.parse(raw));
  } catch {
    return normalize(undefined);
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

/** Reading and replacing one slice's value, in one table rather than nine. */
interface SliceIO {
  read(m: SettingsManager): unknown;
  /** Replace the in-memory value with one that came from storage or the account. */
  adopt(m: SettingsManager, value: unknown): void;
}

const SLICE_IO: Record<SettingsSlice, SliceIO> = {
  common: {
    read: (m) => m.common,
    // Not `deepMerge` alone: `dialog.controls` is free-form. See `mergeCommon`.
    adopt: (m, v) => {
      m.common = mergeCommon(v);
    },
  },
  eeschema: {
    read: (m) => m.eeschema,
    adopt: (m, v) => {
      m.eeschema = deepMerge(structuredClone(EESCHEMA_DEFAULTS), v);
    },
  },
  symbol_editor: {
    read: (m) => m.symbolEditor,
    adopt: (m, v) => {
      m.symbolEditor = deepMerge(structuredClone(SYMBOL_EDITOR_DEFAULTS), v);
    },
  },
  pcbnew: {
    read: (m) => m.pcbnew,
    adopt: (m, v) => {
      m.pcbnew = deepMerge(structuredClone(PCBNEW_DEFAULTS), v);
    },
  },
  pl_editor: {
    read: (m) => m.plEditor,
    adopt: (m, v) => {
      m.plEditor = deepMerge(structuredClone(PL_EDITOR_DEFAULTS), v);
    },
  },
  fpedit: {
    read: (m) => m.fpEdit,
    // Not `deepMerge` alone: `lib_tree.column_widths` is free-form.
    adopt: (m, v) => {
      m.fpEdit = mergeFpEdit(v);
    },
  },
  pcb_calculator: {
    read: (m) => m.pcbCalculator,
    // Not `deepMerge`: the transmission-line keyword maps are free-form.
    adopt: (m, v) => {
      m.pcbCalculator = normalizePcbCalculator(v);
    },
  },
  bitmap2component: {
    read: (m) => m.bitmap2cmp,
    adopt: (m, v) => {
      m.bitmap2cmp = deepMerge(structuredClone(BITMAP2CMP_DEFAULTS), v);
    },
  },
  privacy: {
    read: (m) => m.privacy,
    adopt: (m, v) => {
      m.privacy = deepMerge(structuredClone(PRIVACY_DEFAULTS), v);
    },
  },
  'colors.user': {
    read: (m) => m.userColors,
    adopt: (m, v) => {
      m.userColors = normalizeUserColors(v);
    },
  },
  hotkeys: {
    read: (m) => m.hotkeys,
    adopt: (m, v) => {
      m.hotkeys = normalizeHotkeys(v);
    },
  },
  // One entry per `TOOLBAR_SETTINGS` file. Not `deepMerge`: a stored toolbar
  // *replaces* its default rather than being merged over it, and merging two
  // item lists would produce a toolbar neither side asked for. See
  // `normalizeToolbarSettings`.
  'eeschema-toolbars': {
    read: (m) => m.toolbars.eeschema,
    adopt: (m, v) => {
      m.toolbars = { ...m.toolbars, eeschema: normalizeToolbarSettings(v) };
    },
  },
  'symbol_editor-toolbars': {
    read: (m) => m.toolbars.symbol_editor,
    adopt: (m, v) => {
      m.toolbars = { ...m.toolbars, symbol_editor: normalizeToolbarSettings(v) };
    },
  },
  'pcbnew-toolbars': {
    read: (m) => m.toolbars.pcbnew,
    adopt: (m, v) => {
      m.toolbars = { ...m.toolbars, pcbnew: normalizeToolbarSettings(v) };
    },
  },
  'pl_editor-toolbars': {
    read: (m) => m.toolbars.pl_editor,
    adopt: (m, v) => {
      m.toolbars = { ...m.toolbars, pl_editor: normalizeToolbarSettings(v) };
    },
  },
  gerbview: {
    read: (m) => m.gerbview,
    adopt: (m, v) => {
      m.gerbview = deepMerge(structuredClone(GERBVIEW_DEFAULTS), v);
    },
  },
  'gerbview-toolbars': {
    read: (m) => m.toolbars.gerbview,
    adopt: (m, v) => {
      m.toolbars = { ...m.toolbars, gerbview: normalizeToolbarSettings(v) };
    },
  },
};

/**
 * SETTINGS_MANAGER, web edition: owns the common + eeschema settings and the
 * active color theme, persists on every change, and notifies subscribers (the
 * editors re-render through useSyncExternalStore).
 */
export class SettingsManager {
  // Not `load()`: `common.json` carries one free-form subtree. See `mergeCommon`.
  common: CommonSettings = loadFreeForm(sliceStorageKey('common'), mergeCommon);
  eeschema: EeschemaSettings = normalizeGrids(
    load(sliceStorageKey('eeschema'), EESCHEMA_DEFAULTS),
    EESCHEMA_DEFAULTS.window.grid.sizes,
  );
  /**
   * `symbol_editor.json`, the Symbol Editor's own settings file.
   *
   * `normalizeGrids` for the same reason eeschema and pl_editor need it: a
   * stored `window.grid.sizes` is a LIST, and `deepMerge` would merge it
   * element-wise against the defaults instead of replacing it.
   */
  symbolEditor: SymbolEditorSettings = normalizeGrids(
    load(sliceStorageKey('symbol_editor'), SYMBOL_EDITOR_DEFAULTS),
    SYMBOL_EDITOR_DEFAULTS.window.grid.sizes,
  );
  pcbnew: PcbnewSettings = load(sliceStorageKey('pcbnew'), PCBNEW_DEFAULTS);
  /** `pl_editor.json`, the Drawing Sheet Editor's own settings file. */
  plEditor: PlEditorSettings = normalizeGrids(
    load(sliceStorageKey('pl_editor'), PL_EDITOR_DEFAULTS),
    PL_EDITOR_DEFAULTS.window.grid.sizes,
  );
  /** `gerbview.json`, the Gerber Viewer's own settings file. */
  gerbview: GerbviewSettings = normalizeGrids(
    load(sliceStorageKey('gerbview'), GERBVIEW_DEFAULTS),
    GERBVIEW_DEFAULTS.window.grid.sizes,
  );
  /** `fpedit.json`, the Footprint Editor's own settings file. Not `load()`:
   *  `lib_tree.column_widths` is free-form. See `mergeFpEdit`. */
  fpEdit: FpEditSettings = loadFreeForm(sliceStorageKey('fpedit'), mergeFpEdit);
  /** `pcb_calculator.json` — the Calculator Tools frame's last inputs. */
  pcbCalculator: PcbCalculatorSettings = loadFreeForm(
    sliceStorageKey('pcb_calculator'),
    normalizePcbCalculator,
  );
  /** `bitmap2component.json`, the Image Converter's own settings file. */
  bitmap2cmp: Bitmap2CmpSettings = load(sliceStorageKey('bitmap2component'), BITMAP2CMP_DEFAULTS);
  privacy: PrivacySettings = load(sliceStorageKey('privacy'), PRIVACY_DEFAULTS);
  /** The editable "User" colour theme: layer-key -> CSS colour overrides. */
  userColors: Record<string, string> = loadFreeForm(
    sliceStorageKey('colors.user'),
    normalizeUserColors,
  );
  /** HOTKEY_STORE's overrides: action name -> combo, or null for "no key". */
  hotkeys: Record<string, string | null> = loadFreeForm(
    sliceStorageKey('hotkeys'),
    normalizeHotkeys,
  );
  /**
   * `<app>-toolbars.json`, one per app with a Preferences > Toolbars page.
   *
   * Upstream these are separate `TOOLBAR_SETTINGS` objects the settings manager
   * hands out by file name, never a member of the app's own settings — a frame
   * holds `m_toolbarSettings` beside `config()`, and the customisation panel is
   * given both (`PANEL_TOOLBAR_CUSTOMIZATION`'s `aCfg` and `aTbSettings`). One
   * field holding all three keeps that separation without three near-identical
   * members and three near-identical updaters.
   */
  toolbars: Record<ToolbarApp, ToolbarSettings> = {
    eeschema: loadFreeForm(sliceStorageKey('eeschema-toolbars'), normalizeToolbarSettings),
    symbol_editor: loadFreeForm(
      sliceStorageKey('symbol_editor-toolbars'),
      normalizeToolbarSettings,
    ),
    pcbnew: loadFreeForm(sliceStorageKey('pcbnew-toolbars'), normalizeToolbarSettings),
    pl_editor: loadFreeForm(sliceStorageKey('pl_editor-toolbars'), normalizeToolbarSettings),
    gerbview: loadFreeForm(sliceStorageKey('gerbview-toolbars'), normalizeToolbarSettings),
  };
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
  private commit(slice: SettingsSlice, value: unknown): void {
    store(sliceStorageKey(slice), value);
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
    return SLICE_IO[slice].read(this);
  }

  /**
   * Take the account's copy of a slice.
   *
   * Not an edit: `updatedAt` does not move, and both watermarks are set so the
   * two sides read as agreed — `markSynced`'s `r.syncedAt = r.updatedAt`
   * (projectStore.ts:893) in the one other place this bookkeeping exists.
   */
  adoptSlice(slice: SettingsSlice, value: unknown, cloudAt: number): void {
    SLICE_IO[slice].adopt(this, value);
    store(sliceStorageKey(slice), SLICE_IO[slice].read(this));
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

  updateCommon(mutate: (s: CommonSettings) => void): void {
    const next = structuredClone(this.common);
    mutate(next);
    this.common = next;
    this.commit('common', next);
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
    const next = structuredClone(this.eeschema);
    mutate(next);
    this.eeschema = next;
    this.commit('eeschema', next);
  }

  /** `SYMBOL_EDIT_FRAME::SaveSettings` / the five Symbol Editor Preferences pages. */
  updateSymbolEditor(mutate: (s: SymbolEditorSettings) => void): void {
    const next = structuredClone(this.symbolEditor);
    mutate(next);
    this.symbolEditor = next;
    this.commit('symbol_editor', next);
  }

  updatePcbnew(mutate: (s: PcbnewSettings) => void): void {
    const next = structuredClone(this.pcbnew);
    mutate(next);
    this.pcbnew = next;
    this.commit('pcbnew', next);
  }

  updatePlEditor(mutate: (s: PlEditorSettings) => void): void {
    const next = structuredClone(this.plEditor);
    mutate(next);
    this.plEditor = next;
    this.commit('pl_editor', next);
  }

  updateGerbview(mutate: (s: GerbviewSettings) => void): void {
    const next = structuredClone(this.gerbview);
    mutate(next);
    this.gerbview = next;
    this.commit('gerbview', next);
  }

  /**
   * One app's `TOOLBAR_SETTINGS`, which is what
   * `PANEL_TOOLBAR_CUSTOMIZATION::TransferDataFromWindow` writes through
   * `SetStoredToolbarConfig` (`panel_toolbar_customization.cpp:352-354`).
   */
  updateToolbars(app: ToolbarApp, mutate: (s: ToolbarSettings) => void): void {
    const next = structuredClone(this.toolbars[app]);
    mutate(next);
    this.toolbars = { ...this.toolbars, [app]: next };
    this.commit(toolbarSlice(app), next);
  }

  /** `FOOTPRINT_EDIT_FRAME::SaveSettings` (`footprint_edit_frame.cpp:823-860`). */
  updateFpEdit(mutate: (s: FpEditSettings) => void): void {
    const next = structuredClone(this.fpEdit);
    mutate(next);
    this.fpEdit = next;
    this.commit('fpedit', next);
  }

  /**
   * `PCB_CALCULATOR_FRAME::SaveSettings`, one panel's worth at a time.
   *
   * Upstream writes the whole file once, when the frame closes
   * (pcb_calculator_frame.cpp:401-419). Ours is called from a debounce in
   * `editors/calculator/calc_settings.ts` for the reason that file gives.
   */
  updatePcbCalculator(mutate: (s: PcbCalculatorSettings) => void): void {
    const next = structuredClone(this.pcbCalculator);
    mutate(next);
    this.pcbCalculator = next;
    this.commit('pcb_calculator', next);
  }

  updateBitmap2Cmp(mutate: (s: Bitmap2CmpSettings) => void): void {
    const next = structuredClone(this.bitmap2cmp);
    mutate(next);
    this.bitmap2cmp = next;
    this.commit('bitmap2component', next);
  }

  updatePrivacy(mutate: (s: PrivacySettings) => void): void {
    const next = structuredClone(this.privacy);
    mutate(next);
    this.privacy = next;
    this.commit('privacy', next);
  }

  resetCommon(): void {
    this.common = structuredClone(COMMON_DEFAULTS);
    this.commit('common', this.common);
  }

  resetEeschema(): void {
    this.eeschema = structuredClone(EESCHEMA_DEFAULTS);
    this.commit('eeschema', this.eeschema);
  }

  setUserColors(colors: Record<string, string>): void {
    this.userColors = { ...colors };
    this.commit('colors.user', this.userColors);
  }

  resetUserColors(): void {
    this.userColors = {};
    this.commit('colors.user', this.userColors);
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
    this.hotkeys = next;
    this.commit('hotkeys', next);
  }

  /** Replace the whole override map — the Hotkeys page committing on OK. */
  setHotkeys(overrides: Readonly<Record<string, string | null>>): void {
    this.hotkeys = { ...overrides };
    this.commit('hotkeys', this.hotkeys);
  }

  resetHotkeys(): void {
    this.hotkeys = {};
    this.commit('hotkeys', this.hotkeys);
  }
}

migrateStored();
export const settings = new SettingsManager();
