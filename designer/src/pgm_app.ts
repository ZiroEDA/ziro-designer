// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The application's program object - KiCad's PGM_KICAD / `PGM_BASE::InitPgm`,
 * which runs once at program start, before any frame exists: the settings
 * manager, the common settings (`common.json`) and the colour-theme loader.
 * Each editor's KIFACE then registers its own settings on top
 * (`installPgm` in the PCB editor).
 *
 * It used to be created by the PCB editor's canvas, so on the home screen and
 * in every other editor `Pgm()` did not exist until a board had been opened.
 */
import {
  type COMMON_SETTINGS_ENVIRONMENT,
  InitializeEnvironment,
} from '@ziroeda/common/settings/common_settings.js';
import { ENV_VAR_MAP } from '@ziroeda/common/settings/environment.js';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/mouse_drag_action.js';
import {
  type COMMON_SETTINGS_INPUT,
  type COMMON_SETTINGS_LIKE,
  PGM_BASE,
  PgmOrNull,
  SetPgm,
} from '@ziroeda/common/pgm_base.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { WXK } from '@ziroeda/common/wx/wx_event.js';
import { colorSettingsById } from './prefs/color_settings_list.js';
import { type MouseDragAction, type ScrollModifier, settings } from './prefs/settings.js';

/** `panel_mouse_settings.cpp:113-119`: the four choices are `WXK_*` codes. */
const MODIFIER_CODES: Readonly<Record<ScrollModifier, number>> = {
  none: WXK.WXK_NONE,
  ctrl: WXK.WXK_CONTROL,
  shift: WXK.WXK_SHIFT,
  alt: WXK.WXK_ALT,
};

/** `MOUSE_DRAG_ACTION`, as `common.json` encodes it. */
const DRAG_ACTIONS: Readonly<Record<MouseDragAction, MOUSE_DRAG_ACTION>> = {
  drag_any: MOUSE_DRAG_ACTION.DRAG_ANY,
  drag_selected: MOUSE_DRAG_ACTION.DRAG_SELECTED,
  select: MOUSE_DRAG_ACTION.SELECT,
  zoom: MOUSE_DRAG_ACTION.ZOOM,
  pan: MOUSE_DRAG_ACTION.PAN,
  none: MOUSE_DRAG_ACTION.NONE,
};

/**
 * `COMMON_SETTINGS::m_Env`: one map for the life of the program, so a
 * preference change that rebuilds the rest of COMMON_SETTINGS keeps it.
 */
const s_env: COMMON_SETTINGS_ENVIRONMENT = { vars: new ENV_VAR_MAP() };

/** `COMMON_SETTINGS`, from the designer's `common.json` slice. */
export function commonSettingsOf(): COMMON_SETTINGS_LIKE {
  const c = settings.common;
  const i = c.input;
  const m_Input: COMMON_SETTINGS_INPUT = {
    focus_follow_sch_pcb: i.focus_follow_sch_pcb,
    auto_pan: i.auto_pan,
    auto_pan_acceleration: i.auto_pan_acceleration,
    center_on_zoom: i.center_on_zoom,
    immediate_actions: i.immediate_actions,
    warp_mouse_on_move: i.warp_mouse_on_move,
    horizontal_pan: i.horizontal_pan,
    hotkey_feedback: i.hotkey_feedback,
    zoom_acceleration: i.zoom_acceleration,
    zoom_speed: i.zoom_speed,
    zoom_speed_auto: i.zoom_speed_auto,
    scroll_modifier_zoom: MODIFIER_CODES[i.scroll_modifier_zoom],
    scroll_modifier_pan_h: MODIFIER_CODES[i.scroll_modifier_pan_h],
    scroll_modifier_pan_v: MODIFIER_CODES[i.scroll_modifier_pan_v],
    motion_pan_modifier: MODIFIER_CODES[i.motion_pan_modifier],
    drag_left: DRAG_ACTIONS[i.mouse_left],
    drag_middle: DRAG_ACTIONS[i.mouse_middle],
    drag_right: DRAG_ACTIONS[i.mouse_right],
    reverse_scroll_zoom: i.reverse_scroll_zoom,
    reverse_scroll_pan_h: i.reverse_scroll_pan_h,
  };

  return {
    m_Appearance: {
      show_scrollbars: c.appearance.show_scrollbars,
      zoom_correction_factor: c.appearance.zoom_correction_factor,
      hicontrast_dimming_factor: c.appearance.hicontrast_dimming_factor,
    },
    m_Input,
    m_Env: s_env,
  };
}

/**
 * `SETTINGS_MANAGER::loadColorSettingsByName`'s file: a theme installed with
 * a file (`colorSettingsById`), or the "User" theme / one "New Theme..." made,
 * whose stored rows are the `board.*` parameter paths `COLOR_SETTINGS`
 * registers — a `JSON_SETTINGS::Load` over those.
 */
function loadColorSettingsByName(aName: string): COLOR_SETTINGS | null {
  const made = settings.userThemes[aName];

  if (aName === 'user' || made) {
    const cs = new COLOR_SETTINGS(aName);
    cs.SetName(made ? made.name : 'User');
    cs.LoadFromJsonPaths(made ? made.colors : settings.userColors);
    return cs;
  }

  const contents = colorSettingsById(aName);

  if (!contents) return null;

  const cs = new COLOR_SETTINGS(aName);
  cs.LoadFromContents(contents);
  return cs;
}

/**
 * `PGM_BASE::InitPgm`: install the program object once, at startup. Later
 * calls return it unchanged.
 */
export function InitPgm(): PGM_BASE {
  let pgm = PgmOrNull();
  if (!pgm) {
    pgm = new PGM_BASE(commonSettingsOf());

    // Set up built-in environment variables (and override them from the system
    // environment if set), then put them in the environment (loadCommonSettings).
    InitializeEnvironment(s_env);
    pgm.loadCommonSettings();

    pgm.GetSettingsManager().SetColorSettingsLoader(loadColorSettingsByName);
    SetPgm(pgm);
  }
  return pgm;
}
