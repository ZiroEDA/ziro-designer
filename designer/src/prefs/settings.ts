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
 * Defaults are KiCad 9.0's defaults. Persistence is localStorage (the web
 * equivalent of the ~/.config/kicad settings directory), merged over the
 * defaults on load so new keys pick up their defaults automatically.
 */

import {
  CROSS_PROBING_DEFAULTS,
  type CrossProbingSettings,
} from '@ziroeda/common/src/cross_probing_settings.js';
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
  };
  input: {
    auto_pan: boolean;
    auto_pan_acceleration: number; // 0..9
    center_on_zoom: boolean;
    warp_mouse_on_move: boolean;
    hotkey_feedback: boolean;
    immediate_actions: boolean; // !("First hotkey selects tool")
    zoom_acceleration: boolean;
    zoom_speed: number; // 1..10
    zoom_speed_auto: boolean;
    horizontal_pan: boolean;
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
    };
  };
  backup: {
    enabled: boolean;
    backup_on_autosave: boolean;
    limit_total_files: number;
    limit_daily_files: number;
    min_interval: number; // seconds
    limit_total_size: number; // bytes
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
}

export const COMMON_DEFAULTS: CommonSettings = {
  appearance: {
    icon_theme: 'auto',
    toolbar_icon_size: 'normal',
    show_scrollbars: true,
    use_icons_in_menus: true,
    hicontrast_dimming_factor: 80,
  },
  input: {
    auto_pan: false,
    auto_pan_acceleration: 5,
    center_on_zoom: true,
    warp_mouse_on_move: true,
    hotkey_feedback: true,
    immediate_actions: true,
    zoom_acceleration: false,
    zoom_speed: 1,
    zoom_speed_auto: true,
    horizontal_pan: false,
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
    session: { remember_open_files: false, pinned_symbol_libs: [] },
  },
  backup: {
    enabled: true,
    backup_on_autosave: false,
    limit_total_files: 25,
    limit_daily_files: 5,
    min_interval: 300,
    limit_total_size: 104857600,
  },
  // KiCad's default is PAN (app_settings.cpp: search_pane.selection_zoom).
  search_pane: {
    selection_zoom: 'pan',
  },
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
    show_erc_errors: boolean;
    show_erc_warnings: boolean;
    show_erc_exclusions: boolean;
    mark_sim_exclusions: boolean;
    show_op_voltages: boolean;
    show_op_currents: boolean;
    show_pin_alt_icons: boolean;
    show_page_limits: boolean;
    footprint_preview: boolean;
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
    grid: {
      sizes: string[]; // "50 mil", "25 mil", ...
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
    show_erc_errors: true,
    show_erc_warnings: true,
    show_erc_exclusions: false,
    mark_sim_exclusions: true,
    show_op_voltages: true,
    show_op_currents: true,
    show_pin_alt_icons: true,
    show_page_limits: true,
    footprint_preview: true,
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
  sym_chooser: {
    sash_pos_h: 360,
    sash_pos_v: 150,
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
    grid: {
      sizes: ['100 mil', '50 mil', '25 mil', '10 mil'],
      last_size_idx: 1,
      fast_grid_1: 1,
      fast_grid_2: 2,
      style: 'dots',
      line_width: 1,
      min_spacing: 10,
      snap: 0,
      show: true,
      overrides_enabled: false,
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
}

export const PCBNEW_DEFAULTS: PcbnewSettings = {
  appearance: {
    color_theme: '_builtin_default',
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
};

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
export const SETTINGS_VERSION = 2;

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

function migrateStored(): void {
  const versionKey = 'ziroeda.settings_version';
  try {
    const from = Number(localStorage.getItem(versionKey) ?? '0');
    if (from >= SETTINGS_VERSION) return;

    const raw = localStorage.getItem('ziroeda.eeschema');
    if (raw) {
      const s = JSON.parse(raw) as EeschemaSettings;
      if (migrateEeschemaSettings(s, from))
        localStorage.setItem('ziroeda.eeschema', JSON.stringify(s));
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
 */
function loadHotkeys(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem('ziroeda.hotkeys');
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
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
  } catch {
    return {};
  }
}

type Listener = () => void;

/**
 * SETTINGS_MANAGER, web edition: owns the common + eeschema settings and the
 * active color theme, persists on every change, and notifies subscribers (the
 * editors re-render through useSyncExternalStore).
 */
class SettingsManager {
  common: CommonSettings = load('ziroeda.common', COMMON_DEFAULTS);
  eeschema: EeschemaSettings = load('ziroeda.eeschema', EESCHEMA_DEFAULTS);
  pcbnew: PcbnewSettings = load('ziroeda.pcbnew', PCBNEW_DEFAULTS);
  privacy: PrivacySettings = load('ziroeda.privacy', PRIVACY_DEFAULTS);
  /** The editable "User" colour theme: layer-key -> CSS colour overrides. */
  userColors: Record<string, string> = load('ziroeda.colors.user', {});
  /** HOTKEY_STORE's overrides: action name -> combo, or null for "no key". */
  hotkeys: Record<string, string | null> = loadHotkeys();
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

  updateCommon(mutate: (s: CommonSettings) => void): void {
    const next = structuredClone(this.common);
    mutate(next);
    this.common = next;
    store('ziroeda.common', next);
    this.notify();
  }

  updateEeschema(mutate: (s: EeschemaSettings) => void): void {
    const next = structuredClone(this.eeschema);
    mutate(next);
    this.eeschema = next;
    store('ziroeda.eeschema', next);
    this.notify();
  }

  updatePcbnew(mutate: (s: PcbnewSettings) => void): void {
    const next = structuredClone(this.pcbnew);
    mutate(next);
    this.pcbnew = next;
    store('ziroeda.pcbnew', next);
    this.notify();
  }

  updatePrivacy(mutate: (s: PrivacySettings) => void): void {
    const next = structuredClone(this.privacy);
    mutate(next);
    this.privacy = next;
    store('ziroeda.privacy', next);
    this.notify();
  }

  resetCommon(): void {
    this.common = structuredClone(COMMON_DEFAULTS);
    store('ziroeda.common', this.common);
    this.notify();
  }

  resetEeschema(): void {
    this.eeschema = structuredClone(EESCHEMA_DEFAULTS);
    store('ziroeda.eeschema', this.eeschema);
    this.notify();
  }

  setUserColors(colors: Record<string, string>): void {
    this.userColors = { ...colors };
    store('ziroeda.colors.user', this.userColors);
    this.notify();
  }

  resetUserColors(): void {
    this.userColors = {};
    store('ziroeda.colors.user', this.userColors);
    this.notify();
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
    store('ziroeda.hotkeys', next);
    this.notify();
  }

  /** Replace the whole override map — the Hotkeys page committing on OK. */
  setHotkeys(overrides: Readonly<Record<string, string | null>>): void {
    this.hotkeys = { ...overrides };
    store('ziroeda.hotkeys', this.hotkeys);
    this.notify();
  }

  resetHotkeys(): void {
    this.hotkeys = {};
    store('ziroeda.hotkeys', this.hotkeys);
    this.notify();
  }
}

migrateStored();
export const settings = new SettingsManager();
