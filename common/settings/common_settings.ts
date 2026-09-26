// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COMMON_SETTINGS` (common/settings/common_settings.cpp): the one settings
 * file every KiCad program shares, `common.json`. Its shape, its defaults, its
 * migrations and the load-merge.
 *
 * Moved here from `designer/src/prefs/settings.ts` on 09-26: the Preferences
 * panels in `common/dialogs` read it, and upstream's lives in `common/` for
 * the same reason. The store that loads, saves and syncs every slice is still
 * the app's; this module is the COMMON_SETTINGS half of it.
 */
import { ENV_VAR } from '../env_vars.js';
import { PATHS } from '../paths.js';
import { wxGetEnv } from '../wx/utils.js';
import { ENV_VAR_ITEM, type ENV_VAR_MAP } from './environment.js';
import { deepMerge } from './json_settings.js';

/** MOUSE_DRAG_ACTION (common_settings.h). */
export type MouseDragAction = 'select' | 'drag_selected' | 'drag_any' | 'pan' | 'zoom' | 'none';

/** Scroll-wheel modifier assignment: which modifier triggers each gesture. */
export type ScrollModifier = 'none' | 'ctrl' | 'shift' | 'alt';

export interface CommonSettings {
  appearance: {
    /** PANEL_COMMON_SETTINGS "Icon theme": light | dark | auto. */
    icon_theme: 'light' | 'dark' | 'auto';
    /**
     * `appearance.toolbar_icon_size` — `PARAM<int>( …, 24, 16, 64 )`
     * (`common_settings.cpp:115-116`). A PIXEL SIZE, not an enum: the panel's
     * three radios write 16 / 24 / 32 (`panel_common_settings.cpp:206-211`) and
     * a hand-edited `common.json` may hold any value in 16..64, in which case
     * none of the three is selected and the toolbars still honour it.
     *
     * This was `'small' | 'normal' | 'large'` here, which made our stored JSON
     * something KiCad could not read. No migrator: the control was disabled
     * until now, so no one can have stored anything but the default, and
     * `deepMerge`'s shape check turns a stray string back into 24 anyway.
     */
    toolbar_icon_size: number;
    show_scrollbars: boolean;
    use_icons_in_menus: boolean;
    /**
     * `appearance.hicontrast_dimming_factor` — `PARAM<double>( …, 0.8f )`
     * (`common_settings.cpp:109-110`). A FRACTION, not a percentage: the panel
     * shows `factor * 100` and divides by 100 on the way back
     * (`panel_common_settings.cpp:224-226`, `:330-331`), so `common.json` holds
     * 0.8 where the field reads 80.
     *
     * This held 80 and bound the control straight to it, which was invisible
     * while nothing read the setting and is not now:
     * `m_hiContrastFactor = 1.0 - 80` is -79, and a mix at -79 clamps to zero,
     * which paints every inactive layer as the bare background.
     */
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
   * `graphics.antialiasing_mode` — `PARAM<int>( …, 2, 0, 2 )`
   * (`common_settings.cpp:329-330`): `GAL_ANTIALIASING_MODE`, 0 none, 1 fast,
   * 2 high quality, which `GAL_DISPLAY_OPTIONS::ReadCommonConfig` copies into
   * the GAL and `OPENGL_COMPOSITOR::Initialize` maps to a presentor — fast is
   * SMAA, high quality is 2x supersampling (`opengl_compositor.cpp:104-115`).
   * The board editor's OPENGL_GAL draws with it (#636 stage 5).
   */
  graphics: {
    antialiasing_mode: 0 | 1 | 2;
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
    /**
     * `system.clear_3d_cache_interval` (`common_settings.cpp:366-367`), days.
     * `PROJECT_PCB::Cleanup3DCache` (`pcbnew/project_pcb.cpp:97-118`) hands it
     * to `S3D_CACHE::CleanCacheDir`, which deletes every cached model whose
     * LAST ACCESS is older than that — and does nothing at all at 0, which is
     * how the user turns cache clearing off (`:114`).
     *
     * Ours is `editors/pcb/model_cache.ts`, an IndexedDB store keyed by the
     * hash of a model's own bytes with a `usedAt` per row. Upstream reads a
     * file's access time; ours reads that column, which is the same fact
     * written down rather than asked of a filesystem we do not have.
     */
    clear_3d_cache_interval: number;
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
   * `do_not_show_again.*` — `COMMON_SETTINGS::m_DoNotShowAgain`
   * (`include/settings/common_settings.h:161-169`,
   * `common/settings/common_settings.cpp:369-386`), six named bools with one
   * warning each. NOT the same thing as `KIDIALOG`'s memory: that one is a
   * file-static map that dies with the process (`ui/do_not_show_again.ts`),
   * while these six survive a restart. Preferences > Maintenance clears both,
   * which is why `doClearDontShowAgain` has two halves.
   *
   * They are stored, and nothing here writes them yet — the six dialogs that do
   * are Export STEP's scaled-model warning, Configure Paths' restart notice,
   * the start wizard's two privacy prompts, the 3D model migration prompt and
   * pcbnew's unfilled-zone infobar, and this port has none of the six. Held
   * anyway, for the reason `git` and `spacemouse` above are: the page that
   * clears them is real, and a button that clears a store we did not model
   * would be a button that clears nothing forever.
   */
  do_not_show_again: {
    /** `PCB_CONTROL::unfilledZoneCheck` (`pcbnew/tools/pcb_control.cpp:284-322`). */
    zone_fill_warning: boolean;
    /** `DIALOG_CONFIGURE_PATHS` (`common/dialogs/dialog_configure_paths.cpp:336`). */
    env_var_overwrite_warning: boolean;
    /** `DIALOG_EXPORT_STEP` (`pcbnew/dialogs/dialog_export_step.cpp:162`). */
    scaled_3d_models_warning: boolean;
    /** `STARTWIZARD_PROVIDER_PRIVACY` (`common/startwizard/…_privacy.cpp:85`). */
    data_collection_prompt: boolean;
    /** The same provider's other prompt (`:86`). */
    update_check_prompt: boolean;
    /** The 3D model migration prompt. */
    migrate_wrl_prompt: boolean;
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
    // `PARAM<int>( "appearance.toolbar_icon_size", …, 24, 16, 64 )`.
    toolbar_icon_size: 24,
    show_scrollbars: true,
    use_icons_in_menus: true,
    // `PARAM<double>( …, 0.8f )` — the FRACTION; the panel shows 80.
    hicontrast_dimming_factor: 0.8,
    grid_striping: false,
    use_custom_cursors: true,
    zoom_correction_factor: 1.0,
  },
  // `m_Git` — the five PARAM defaults.
  // `PARAM<int>( "graphics.antialiasing_mode", …, 2, 0, 2 )`: high quality.
  graphics: {
    antialiasing_mode: 2,
  },
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
    // `PARAM<int>( "system.clear_3d_cache_interval", …, 30 )`.
    clear_3d_cache_interval: 30,
    session: { remember_open_files: false, pinned_symbol_libs: [], pinned_fp_libs: [] },
  },
  // Every one `PARAM<bool>( …, false )` (`common_settings.cpp:369-386`).
  do_not_show_again: {
    zone_fill_warning: false,
    env_var_overwrite_warning: false,
    scaled_3d_models_warning: false,
    data_collection_prompt: false,
    update_check_prompt: false,
    migrate_wrl_prompt: false,
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

/**
 * `common.json`'s migrations.
 *
 * v5: `appearance.hicontrast_dimming_factor` was stored as a PERCENTAGE here
 * and is a fraction upstream (`PARAM<double>( …, 0.8f )`; the panel is what
 * multiplies by 100). Nothing read it while the control was disabled, so the
 * wrong shape cost nothing; the moment the painters take it,
 * `1.0 - 80` is -79 and every inactive layer is mixed all the way to the
 * background — a board that goes blank in high-contrast mode, for a setting
 * the user never touched.
 *
 * `> 1` is the test rather than `>= 1`: 1.0 is a legal fraction (dim
 * completely) and 100 is the percentage that means the same thing, so the
 * ambiguous value is left alone and the unambiguous ones are converted.
 */
export function migrateCommonSettings(s: CommonSettings, from: number): boolean {
  let changed = false;
  const a = s?.appearance;

  if (from < 5 && typeof a?.hicontrast_dimming_factor === 'number') {
    if (a.hicontrast_dimming_factor > 1) {
      a.hicontrast_dimming_factor /= 100;
      changed = true;
    }
  }

  // v5: `appearance.toolbar_icon_size` was `'small' | 'normal' | 'large'` here
  // and is a pixel int upstream. `deepMerge`'s shape check already turns a
  // stored string back into the default, so this only preserves a choice that
  // was made -- which, the control having been disabled, nobody can have made.
  // It is here because the next person to read the two shapes should not have
  // to work out whether the gap was handled.
  if (from < 5 && typeof (a as { toolbar_icon_size?: unknown })?.toolbar_icon_size === 'string') {
    const legacy: Record<string, number> = { small: 16, normal: 24, large: 32 };
    a.toolbar_icon_size = legacy[a.toolbar_icon_size as unknown as string] ?? 24;
    changed = true;
  }

  return changed;
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

/**
 * The common.json draft a Preferences panel edits: the values the book opened
 * with and the updater that writes one change into the draft. Upstream a panel
 * reads `Pgm().GetCommonSettings()` in TransferDataToWindow and writes it back
 * in TransferDataFromWindow; ours edits a draft the dialog commits on OK (see
 * the Preferences dialog's TransferDataFromWindow), and this is the part of it
 * a common panel needs. The app's full context satisfies it structurally.
 */
export interface COMMON_SETTINGS_DRAFT {
  common: CommonSettings;
  upC: (fn: (s: CommonSettings) => void) => void;
}

/**
 * The SETTINGS_MANAGER operations PANEL_MAINTENANCE calls through `Pgm()`
 * (panel_maintenance.cpp:82-141), each returning how many entries it cleared
 * so the panel can say whether there was anything to clear. The app's settings
 * store implements them; the panel is handed them with its draft.
 */
export interface MAINTENANCE_SETTINGS_MANAGER {
  /** `SETTINGS_MANAGER::ClearFileHistory()` and the frames' histories. */
  ClearFileHistory(): number;
  /** `m_DoNotShowAgain` cleared and saved (`doClearDontShowAgain`). */
  ClearDontShowAgain(): number;
  /** `m_dialogControlValues` cleared and saved (`doClearDialogState`). */
  ClearDialogState(): number;
  /** `SETTINGS_MANAGER::ResetToDefaults()`. */
  ResetToDefaults(): number;
}

/** `COMMON_SETTINGS::ENVIRONMENT`: the variables KiCad knows about, by name. */
export interface COMMON_SETTINGS_ENVIRONMENT {
  vars: ENV_VAR_MAP;
}

/**
 * `COMMON_SETTINGS::InitializeEnvironment`: KiCad's built-in variables at
 * their stock defaults, each overridden by the process environment when that
 * defines it (and marked as defined externally).
 */
export function InitializeEnvironment(aEnv: COMMON_SETTINGS_ENVIRONMENT): void {
  const addVar = (aKey: string, aDefault: string): void => {
    const item = new ENV_VAR_ITEM(aKey, aDefault, aDefault);
    aEnv.vars.set(aKey, item);

    const envValue = wxGetEnv(aKey);

    if (envValue !== undefined && envValue !== '') {
      item.SetValue(envValue);
      item.SetDefinedExternally();
    }
  };

  addVar(ENV_VAR.GetVersionedEnvVarName('FOOTPRINT_DIR'), PATHS.GetStockFootprintsPath());
  addVar(ENV_VAR.GetVersionedEnvVarName('3DMODEL_DIR'), PATHS.GetStock3dmodelsPath());
  addVar(ENV_VAR.GetVersionedEnvVarName('TEMPLATE_DIR'), PATHS.GetStockTemplatesPath());
  addVar('KICAD_USER_TEMPLATE_DIR', PATHS.GetUserTemplatesPath());
  addVar(ENV_VAR.GetVersionedEnvVarName('3RD_PARTY'), PATHS.GetDefault3rdPartyPath());
  addVar(ENV_VAR.GetVersionedEnvVarName('SYMBOL_DIR'), PATHS.GetStockSymbolsPath());
  addVar(ENV_VAR.GetVersionedEnvVarName('DESIGN_BLOCK_DIR'), PATHS.GetStockDesignBlocksPath());
}
