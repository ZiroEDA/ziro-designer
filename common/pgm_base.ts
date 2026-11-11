// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pgm_base.h`: the process-wide `PGM_BASE`, reached through `Pgm()` /
 * `PgmOrNull()`. Only the part the ported common code reads is here — the
 * common settings — and the application installs the object at start-up
 * (`SetPgm`), as `PGM_BASE::InitPgm` would; before that `PgmOrNull()` is
 * null, which the readers already handle.
 */

import type { DialogControlValue } from './settings/common_settings.js';
import { SENTRY } from './app_monitor.js';
import { IO_ERROR } from './exceptions.js';
import type { MOUSE_DRAG_ACTION } from './mouse_drag_action.js';
import { PROJECT_VAR_NAME } from './project.js';
import type { COMMON_SETTINGS_ENVIRONMENT } from './settings/common_settings.js';
import { ENV_VAR_MAP } from './settings/environment.js';
import { wxGetEnv, wxSetEnv } from '@ziroeda/wx/utils.js';
import { wxMsgCatalog, type wxMsgCatalogData, wxTranslations } from '@ziroeda/wx/translation.js';
import type { COLOR_SETTINGS } from './settings/color_settings.js';

/** `COMMON_SETTINGS`, the slice the GAL, the panel and the view controls read. */
export interface COMMON_SETTINGS_LIKE {
  /** `m_Session` (COMMON_SETTINGS::SESSION): the libraries pinned to the top of the choosers. */
  m_Session?: { pinned_symbol_libs: string[]; pinned_fp_libs: string[] };
  m_Appearance: {
    /** `show_scrollbars`, PARAM<bool> default true. */
    show_scrollbars: boolean;
    zoom_correction_factor: number;
    /** `hicontrast_dimming_factor`, PARAM<double> default 0.8. */
    hicontrast_dimming_factor: number;
    /**
     * `canvas_scale`: a member, not a PARAM in 10.0 (only the legacy
     * `CanvasScale` migrates into it), so 0.0 - "automatic" - unless set.
     */
    canvas_scale: number;
  };
  /** `COMMON_SETTINGS::GRAPHICS`: `graphics.antialiasing_mode`. */
  m_Graphics: { aa_mode: number };
  /** `COMMON_SETTINGS::INPUT`: the modifiers are `WXK_*` codes, 0 for none. */
  m_Input: COMMON_SETTINGS_INPUT;
  /** `COMMON_SETTINGS::m_Env`: the environment variables KiCad knows about. */
  m_Env: COMMON_SETTINGS_ENVIRONMENT;
  /** `COMMON_SETTINGS::m_DoNotShowAgain` (include/settings/common_settings.h:161-169). */
  m_DoNotShowAgain: COMMON_SETTINGS_DO_NOT_SHOW_AGAIN;
  /** `CsInternals()`: the dialogs' remembered state. Absent where nothing persists. */
  CsInternals?(): COMMON_SETTINGS_INTERNALS;
}

/**
 * `COMMON_SETTINGS_INTERNALS::m_dialogControlValues` (common_settings_internals.h:29), read and
 * written through the settings store, since a write here must reach `common.json`.
 */
export interface COMMON_SETTINGS_INTERNALS {
  GetDialogControlValue(aDialogKey: string, aControlKey: string): DialogControlValue | undefined;
  SetDialogControlValue(aDialogKey: string, aControlKey: string, aValue: DialogControlValue): void;
}

/** `COMMON_SETTINGS::DO_NOT_SHOW_AGAIN`: the six persisted "Don't show again" flags. */
export interface COMMON_SETTINGS_DO_NOT_SHOW_AGAIN {
  zone_fill_warning: boolean;
  env_var_overwrite_warning: boolean;
  scaled_3d_models_warning: boolean;
  data_collection_prompt: boolean;
  update_check_prompt: boolean;
  migrate_wrl_prompt: boolean;
}

/** `COMMON_SETTINGS::INPUT` (include/settings/common_settings.h). */
export interface COMMON_SETTINGS_INPUT {
  focus_follow_sch_pcb: boolean;
  auto_pan: boolean;
  auto_pan_acceleration: number;
  center_on_zoom: boolean;
  immediate_actions: boolean;
  warp_mouse_on_move: boolean;
  horizontal_pan: boolean;
  hotkey_feedback: boolean;

  zoom_acceleration: boolean;
  zoom_speed: number;
  zoom_speed_auto: boolean;

  scroll_modifier_zoom: number;
  scroll_modifier_pan_h: number;
  scroll_modifier_pan_v: number;

  motion_pan_modifier: number;

  drag_left: MOUSE_DRAG_ACTION;
  drag_middle: MOUSE_DRAG_ACTION;
  drag_right: MOUSE_DRAG_ACTION;

  reverse_scroll_zoom: boolean;
  reverse_scroll_pan_h: boolean;
}

// SETTINGS_MANAGER is `common/settings/settings_manager.cpp`, and lives at the
// same path here; re-exported for the importers that reached it through Pgm().
export { DEFAULT_THEME, SETTINGS_MANAGER } from './settings/settings_manager.js';
import { SETTINGS_MANAGER } from './settings/settings_manager.js';
import { LIBRARY_MANAGER } from './libraries/library_manager.js';

/** `::GetColorSettings( aName )`: `Pgm().GetSettingsManager().GetColorSettings( aName )`. */
export function GetColorSettings(aName: string): COLOR_SETTINGS {
  return Pgm().GetSettingsManager().GetColorSettings(aName);
}

/**
 * `PGM_BASE::HandleException( aPtr, aUnhandled )` (pgm_base.cpp:833-866): log
 * it, and report it when it escaped. A module function, not only the method,
 * because the browser's global handlers can fire before `Pgm()` exists.
 */
export function HandleException(aError: unknown, aUnhandled: boolean): void {
  if (aError instanceof IO_ERROR) {
    console.error(aError.What());

    // Log this IO_ERROR escaped our usual uses (bad)
    if (aUnhandled) SENTRY.Instance().LogException(aError.What(), aUnhandled, aError);
  } else if (aError instanceof Error) {
    SENTRY.Instance().LogException(aError.message, aUnhandled, aError);

    console.error(`Unhandled exception class: ${aError.name}  what: ${aError.message}`);
  } else {
    // We really shouldn't have these but just in case...
    console.error('Unhandled exception of unknown type');

    if (aUnhandled)
      SENTRY.Instance().LogException('Unhandled exception of unknown type', aUnhandled, aError);
  }
}

/** `PGM_BASE::HandleAssert` (pgm_base.cpp:869-894). */
export function HandleAssert(
  aFile: string,
  aLine: number,
  aFunc: string,
  aCond: string,
  aMsg: string,
): void {
  const assertStr =
    aMsg !== ''
      ? `Assertion failed at ${aFile}:${aLine} in ${aFunc}: ${aCond} - ${aMsg}`
      : `Assertion failed at ${aFile}:${aLine} in ${aFunc}: ${aCond}`;

  SENTRY.Instance().LogAssert({ file: aFile, line: aLine, func: aFunc, cond: aCond }, assertStr);
}

export class PGM_BASE {
  private m_settings: COMMON_SETTINGS_LIKE | null;
  private readonly m_settings_manager: SETTINGS_MANAGER;

  HandleException(aError: unknown, aUnhandled: boolean): void {
    HandleException(aError, aUnhandled);
  }

  HandleAssert(aFile: string, aLine: number, aFunc: string, aCond: string, aMsg: string): void {
    HandleAssert(aFile, aLine, aFunc, aCond, aMsg);
  }

  /**
   * @param aSettingsManager is the manager the application already built its
   *        settings files on (`PGM_BASE::InitPgm` creates it first thing);
   *        a fresh one when none is given.
   */
  constructor(
    aCommonSettings: COMMON_SETTINGS_LIKE | null = null,
    aSettingsManager: SETTINGS_MANAGER = new SETTINGS_MANAGER(),
  ) {
    this.m_settings = aCommonSettings;
    this.m_settings_manager = aSettingsManager;

    // `InitPgm`: "Need to create a project early for now (it can have an
    // empty path for the moment)", so that Prj() always works.
    this.m_settings_manager.LoadProject('');
  }

  GetCommonSettings(): COMMON_SETTINGS_LIKE | null {
    return this.m_settings;
  }

  SetCommonSettings(aCommonSettings: COMMON_SETTINGS_LIKE | null): void {
    this.m_settings = aCommonSettings;
  }

  GetSettingsManager(): SETTINGS_MANAGER {
    return this.m_settings_manager;
  }

  /** `m_library_manager`: the library tables of every type, global and project. */
  private m_library_manager: LIBRARY_MANAGER | null = null;

  /** `GetLibraryManager()`. */
  GetLibraryManager(): LIBRARY_MANAGER {
    if (!this.m_library_manager) this.m_library_manager = new LIBRARY_MANAGER();

    return this.m_library_manager;
  }

  /**
   * `loadCommonSettings`, its environment half: every variable the settings
   * hold goes into the process environment, except KIPRJMOD (reserved for
   * the project path), an empty name, and one the system environment set.
   */
  loadCommonSettings(): void {
    const settings = this.m_settings;
    if (!settings) return;

    for (const [key, item] of settings.m_Env.vars) {
      // Do not store the env var PROJECT_VAR_NAME ("KIPRJMOD") definition if for some reason
      // it is found in config. (It is reserved and defined as project path)
      if (key === PROJECT_VAR_NAME) continue;

      // Don't set bogus empty entries in the environment
      if (key === '') continue;

      // Do not overwrite vars set by the system environment with values from the settings file
      if (item.GetDefinedExternally()) continue;

      this.SetLocalEnvVariable(key, item.GetValue());
    }
  }

  /**
   * `SetLocalEnvVariable`: set one variable in the process environment, unless
   * it is already set - then succeed only if it already has this value.
   */
  SetLocalEnvVariable(aName: string, aValue: string): boolean {
    if (aName === '') return false;

    // Check to see if the environment variable is already set.
    const env = wxGetEnv(aName);

    if (env !== undefined) return env === aValue;

    return wxSetEnv(aName, aValue);
  }

  /**
   * `SetLocalEnvVariables`: put every variable in the process environment,
   * overwriting externally defined ones until the next time the app runs.
   */
  SetLocalEnvVariables(): void {
    const settings = this.m_settings;
    if (!settings) return;

    for (const [key, item] of settings.m_Env.vars) wxSetEnv(key, item.GetValue());
  }

  /** `GetLocalEnvVariables`: `GetCommonSettings()->m_Env.vars`. */
  GetLocalEnvVariables(): ENV_VAR_MAP {
    return this.m_settings?.m_Env.vars ?? new ENV_VAR_MAP();
  }
}

let g_pgm: PGM_BASE | null = null;

/** `PgmOrNull()`: the program object, or null before it is set up. */
export function PgmOrNull(): PGM_BASE | null {
  return g_pgm;
}

/** `Pgm()`: the program object; throws before it is set up, as the reference would. */
export function Pgm(): PGM_BASE {
  if (!g_pgm) throw new Error('Pgm() called before the PGM_BASE was set');
  return g_pgm;
}

/** `SetPgm( PGM_BASE* )`: the application installs its program object. */
export function SetPgm(aPgm: PGM_BASE | null): void {
  g_pgm = aPgm;
}

// ---- the interface language ------------------------------------------------

/**
 * The language half of `PGM_BASE` (common/pgm_base.cpp): the `LanguagesList`
 * table (:95-148), `SetLanguage` (:578-675) and what `wxLANGUAGE_DEFAULT`
 * means in a browser.
 *
 * KiCad keeps one string in `common.json`, `system.language`, holding the
 * `m_Lang_Label` of the chosen row ("Deutsch", "简体中文") or "Default". On
 * start `SetLanguage( first_time = true )` finds that row, hands its
 * `wxLANGUAGE_*` to `wxLocale::Init` and adds the `kicad` catalog; the Set
 * Language menu does the same with the picked row and writes the label back.
 *
 * "Default" is `wxLANGUAGE_DEFAULT`: wx asks the operating system which
 * language the user works in. A page has no operating system to ask, but the
 * browser carries the same answer - `navigator.languages`, the user's ordered
 * preferences - so that is what Default follows here, mapped onto this table
 * by {@link languageForLocales}. Nothing is written back for Default, as
 * upstream writes nothing: a user who never opens the menu keeps following
 * their browser, and one who picks a row keeps that row.
 *
 * The lookup itself is wx's (`@ziroeda/wx/translation.js`); this file only
 * decides which catalog is in it.
 */

/** `LANGUAGE_DESCR` (include/pgm_base.h:91-107). */
export interface LanguageDescr {
  /** `m_WX_Lang_Identifier`, by its wx name: the integer is wx's to renumber. */
  wxLang: string;
  /** `m_KI_Lang_Identifier`, the menu id (include/id.h). */
  kiId: string;
  /**
   * `m_Lang_Label`. Also the key: "m_Lang_Label is also used as key in config"
   * (pgm_base.cpp:89-90).
   */
  label: string;
  /** `m_DoNotTranslate` - true for every endonym, false for "Default". */
  doNotTranslate: boolean;
  /**
   * The catalog wx loads for this language: the name of its `.po` in KiCad's
   * `translation/pofiles/` (and of the compiled `translation/<name>.json`
   * here). Empty for "Default", which is whichever row the browser asks for.
   */
  catalog: string;
}

/**
 * `LanguagesList[]` (common/pgm_base.cpp:95-148), in upstream's order, minus
 * the `{ 0, 0, "", false }` sentinel that terminates the C array.
 *
 * The order is not alphabetical by English name - it is alphabetical by
 * endonym, which is why Indonesian sits under B and Japanese under N. Keep it.
 * This is KiCad's data: every row, identifier and label is transcribed, and
 * the 44 catalogs are exactly `translation/pofiles/LINGUAS`.
 */
export const LanguagesList: readonly LanguageDescr[] = [
  {
    wxLang: 'wxLANGUAGE_DEFAULT',
    kiId: 'ID_LANGUAGE_DEFAULT',
    label: 'Default',
    doNotTranslate: false,
    catalog: '',
  },
  {
    wxLang: 'wxLANGUAGE_ARABIC',
    kiId: 'ID_LANGUAGE_ARABIC',
    label: 'العربية',
    doNotTranslate: true,
    catalog: 'ar',
  },
  {
    wxLang: 'wxLANGUAGE_FARSI',
    kiId: 'ID_LANGUAGE_FARSI',
    label: 'فارسی',
    doNotTranslate: true,
    catalog: 'fa',
  },
  {
    wxLang: 'wxLANGUAGE_INDONESIAN',
    kiId: 'ID_LANGUAGE_INDONESIAN',
    label: 'Bahasa Indonesia',
    doNotTranslate: true,
    catalog: 'id',
  },
  {
    wxLang: 'wxLANGUAGE_BULGARIAN',
    kiId: 'ID_LANGUAGE_BULGARIAN',
    label: 'Български',
    doNotTranslate: true,
    catalog: 'bg',
  },
  {
    wxLang: 'wxLANGUAGE_CATALAN',
    kiId: 'ID_LANGUAGE_CATALAN',
    label: 'Català',
    doNotTranslate: true,
    catalog: 'ca',
  },
  {
    wxLang: 'wxLANGUAGE_CZECH',
    kiId: 'ID_LANGUAGE_CZECH',
    label: 'Čeština',
    doNotTranslate: true,
    catalog: 'cs',
  },
  {
    wxLang: 'wxLANGUAGE_DANISH',
    kiId: 'ID_LANGUAGE_DANISH',
    label: 'Dansk',
    doNotTranslate: true,
    catalog: 'da',
  },
  {
    wxLang: 'wxLANGUAGE_GERMAN',
    kiId: 'ID_LANGUAGE_GERMAN',
    label: 'Deutsch',
    doNotTranslate: true,
    catalog: 'de',
  },
  {
    wxLang: 'wxLANGUAGE_GREEK',
    kiId: 'ID_LANGUAGE_GREEK',
    label: 'Ελληνικά',
    doNotTranslate: true,
    catalog: 'el',
  },
  {
    wxLang: 'wxLANGUAGE_ESTONIAN',
    kiId: 'ID_LANGUAGE_ESTONIAN',
    label: 'Eesti',
    doNotTranslate: true,
    catalog: 'et',
  },
  {
    wxLang: 'wxLANGUAGE_ENGLISH',
    kiId: 'ID_LANGUAGE_ENGLISH',
    label: 'English',
    doNotTranslate: true,
    catalog: 'en',
  },
  {
    wxLang: 'wxLANGUAGE_SPANISH',
    kiId: 'ID_LANGUAGE_SPANISH',
    label: 'Español',
    doNotTranslate: true,
    catalog: 'es',
  },
  {
    wxLang: 'wxLANGUAGE_SPANISH_MEXICAN',
    kiId: 'ID_LANGUAGE_SPANISH_MEXICAN',
    label: 'Español (Latinoamericano)',
    doNotTranslate: true,
    catalog: 'es_MX',
  },
  {
    wxLang: 'wxLANGUAGE_FRENCH',
    kiId: 'ID_LANGUAGE_FRENCH',
    label: 'Français',
    doNotTranslate: true,
    catalog: 'fr',
  },
  {
    wxLang: 'wxLANGUAGE_HEBREW',
    kiId: 'ID_LANGUAGE_HEBREW',
    label: 'עברית',
    doNotTranslate: true,
    catalog: 'he',
  },
  {
    wxLang: 'wxLANGUAGE_HINDI',
    kiId: 'ID_LANGUAGE_HINDI',
    label: 'हिन्दी',
    doNotTranslate: true,
    catalog: 'hi',
  },
  {
    wxLang: 'wxLANGUAGE_CROATIAN',
    kiId: 'ID_LANGUAGE_CROATIAN',
    label: 'Hrvatski',
    doNotTranslate: true,
    catalog: 'hr',
  },
  {
    wxLang: 'wxLANGUAGE_KOREAN',
    kiId: 'ID_LANGUAGE_KOREAN',
    label: '한국어',
    doNotTranslate: true,
    catalog: 'ko',
  },
  {
    wxLang: 'wxLANGUAGE_ITALIAN',
    kiId: 'ID_LANGUAGE_ITALIAN',
    label: 'Italiano',
    doNotTranslate: true,
    catalog: 'it',
  },
  {
    wxLang: 'wxLANGUAGE_LATVIAN',
    kiId: 'ID_LANGUAGE_LATVIAN',
    label: 'Latviešu',
    doNotTranslate: true,
    catalog: 'lv',
  },
  {
    wxLang: 'wxLANGUAGE_LITHUANIAN',
    kiId: 'ID_LANGUAGE_LITHUANIAN',
    label: 'Lietuvių',
    doNotTranslate: true,
    catalog: 'lt',
  },
  {
    wxLang: 'wxLANGUAGE_HUNGARIAN',
    kiId: 'ID_LANGUAGE_HUNGARIAN',
    label: 'Magyar',
    doNotTranslate: true,
    catalog: 'hu',
  },
  {
    wxLang: 'wxLANGUAGE_DUTCH',
    kiId: 'ID_LANGUAGE_DUTCH',
    label: 'Nederlands',
    doNotTranslate: true,
    catalog: 'nl',
  },
  {
    wxLang: 'wxLANGUAGE_NORWEGIAN_BOKMAL',
    kiId: 'ID_LANGUAGE_NORWEGIAN_BOKMAL',
    label: 'Norsk Bokmål',
    doNotTranslate: true,
    catalog: 'no',
  },
  {
    wxLang: 'wxLANGUAGE_JAPANESE',
    kiId: 'ID_LANGUAGE_JAPANESE',
    label: '日本語',
    doNotTranslate: true,
    catalog: 'ja',
  },
  {
    wxLang: 'wxLANGUAGE_GEORGIAN',
    kiId: 'ID_LANGUAGE_GEORGIAN',
    label: 'ქართული',
    doNotTranslate: true,
    catalog: 'ka',
  },
  {
    wxLang: 'wxLANGUAGE_THAI',
    kiId: 'ID_LANGUAGE_THAI',
    label: 'ภาษาไทย',
    doNotTranslate: true,
    catalog: 'th',
  },
  {
    wxLang: 'wxLANGUAGE_POLISH',
    kiId: 'ID_LANGUAGE_POLISH',
    label: 'Polski',
    doNotTranslate: true,
    catalog: 'pl',
  },
  {
    wxLang: 'wxLANGUAGE_PORTUGUESE',
    kiId: 'ID_LANGUAGE_PORTUGUESE',
    label: 'Português',
    doNotTranslate: true,
    catalog: 'pt',
  },
  {
    wxLang: 'wxLANGUAGE_PORTUGUESE_BRAZILIAN',
    kiId: 'ID_LANGUAGE_PORTUGUESE_BRAZILIAN',
    label: 'Português (Brasil)',
    doNotTranslate: true,
    catalog: 'pt_BR',
  },
  {
    wxLang: 'wxLANGUAGE_ROMANIAN',
    kiId: 'ID_LANGUAGE_ROMANIAN',
    label: 'Română',
    doNotTranslate: true,
    catalog: 'ro',
  },
  {
    wxLang: 'wxLANGUAGE_RUSSIAN',
    kiId: 'ID_LANGUAGE_RUSSIAN',
    label: 'Русский',
    doNotTranslate: true,
    catalog: 'ru',
  },
  {
    wxLang: 'wxLANGUAGE_SERBIAN',
    kiId: 'ID_LANGUAGE_SERBIAN',
    label: 'Српски',
    doNotTranslate: true,
    catalog: 'sr',
  },
  {
    wxLang: 'wxLANGUAGE_SLOVAK',
    kiId: 'ID_LANGUAGE_SLOVAK',
    label: 'Slovenčina',
    doNotTranslate: true,
    catalog: 'sk',
  },
  {
    wxLang: 'wxLANGUAGE_SLOVENIAN',
    kiId: 'ID_LANGUAGE_SLOVENIAN',
    label: 'Slovenščina',
    doNotTranslate: true,
    catalog: 'sl',
  },
  {
    wxLang: 'wxLANGUAGE_FINNISH',
    kiId: 'ID_LANGUAGE_FINNISH',
    label: 'Suomi',
    doNotTranslate: true,
    catalog: 'fi',
  },
  {
    wxLang: 'wxLANGUAGE_SWEDISH',
    kiId: 'ID_LANGUAGE_SWEDISH',
    label: 'Svenska',
    doNotTranslate: true,
    catalog: 'sv',
  },
  {
    wxLang: 'wxLANGUAGE_VIETNAMESE',
    kiId: 'ID_LANGUAGE_VIETNAMESE',
    label: 'Tiếng Việt',
    doNotTranslate: true,
    catalog: 'vi',
  },
  {
    wxLang: 'wxLANGUAGE_TAMIL',
    kiId: 'ID_LANGUAGE_TAMIL',
    label: 'தமிழ்',
    doNotTranslate: true,
    catalog: 'ta',
  },
  {
    wxLang: 'wxLANGUAGE_TELUGU',
    kiId: 'ID_LANGUAGE_TELUGU',
    label: 'తెలుగు',
    doNotTranslate: true,
    catalog: 'te',
  },
  {
    wxLang: 'wxLANGUAGE_TURKISH',
    kiId: 'ID_LANGUAGE_TURKISH',
    label: 'Türkçe',
    doNotTranslate: true,
    catalog: 'tr',
  },
  {
    wxLang: 'wxLANGUAGE_UKRAINIAN',
    kiId: 'ID_LANGUAGE_UKRAINIAN',
    label: 'Українська',
    doNotTranslate: true,
    catalog: 'uk',
  },
  {
    wxLang: 'wxLANGUAGE_CHINESE_SIMPLIFIED',
    kiId: 'ID_LANGUAGE_CHINESE_SIMPLIFIED',
    label: '简体中文',
    doNotTranslate: true,
    catalog: 'zh_CN',
  },
  {
    wxLang: 'wxLANGUAGE_CHINESE_TRADITIONAL',
    kiId: 'ID_LANGUAGE_CHINESE_TRADITIONAL',
    label: '繁體中文',
    doNotTranslate: true,
    catalog: 'zh_TW',
  },
];

/**
 * `system.language`'s default (common/settings/common_settings.cpp:355-356),
 * which is the first row of `LanguagesList`.
 */
export const DEFAULT_LANGUAGE = 'Default';

/** The row a stored `system.language` names, as `SetLanguage` searches for it. */
export function languageDescrOf(aLabel: string): LanguageDescr | undefined {
  return LanguagesList.find((l) => l.label === aLabel);
}

const descrOfCatalog = (aCatalog: string): LanguageDescr =>
  LanguagesList.find((l) => l.catalog === aCatalog)!;

/**
 * Spanish as spoken in the Americas. KiCad's second Spanish catalog is
 * `es_MX`, which the menu calls "Español (Latinoamericano)" - so it is the
 * right one for every Latin American locale and for `es-419`, the UN M.49
 * region code browsers use for exactly that, not for Mexico alone.
 */
// biome-ignore format: a region list reads better packed
const LATIN_AMERICAN_SPANISH = new Set([
  '419', 'MX', 'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'SV', 'GT', 'HN',
  'NI', 'PA', 'PY', 'PE', 'PR', 'UY', 'VE', 'US',
]);

/**
 * The catalog for one BCP 47 tag (`de-AT`, `zh-Hant-HK`, `pt-BR`), or
 * undefined when KiCad has no translation for that language.
 */
function catalogForLocale(aTag: string): string | undefined {
  const parts = aTag.replace(/_/g, '-').split('-');
  const lang = (parts[0] ?? '').toLowerCase();
  // A four-letter subtag is a script (Hant), a two-letter or three-digit one a region.
  const script = parts
    .slice(1)
    .find((p) => /^[A-Za-z]{4}$/.test(p))
    ?.toLowerCase();
  const region = parts
    .slice(1)
    .find((p) => /^([A-Za-z]{2}|\d{3})$/.test(p))
    ?.toUpperCase();

  switch (lang) {
    case 'zh':
      // The script decides when it is stated; otherwise the regions that
      // write Traditional. Bare `zh` is Simplified, as it is for wx.
      if (script) return script === 'hant' ? 'zh_TW' : 'zh_CN';
      return region === 'TW' || region === 'HK' || region === 'MO' ? 'zh_TW' : 'zh_CN';
    case 'pt':
      return region === 'BR' ? 'pt_BR' : 'pt';
    case 'es':
      return region && LATIN_AMERICAN_SPANISH.has(region) ? 'es_MX' : 'es';
    // Bokmål is KiCad's Norwegian; `no` is the macrolanguage browsers also send.
    case 'nb':
    case 'no':
      return 'no';
    // The codes ISO 639 retired, which older browsers still report.
    case 'iw':
      return 'he';
    case 'in':
      return 'id';
  }
  return LanguagesList.some((l) => l.catalog === lang) ? lang : undefined;
}

/**
 * What "Default" resolves to: the first of the user's preferred locales
 * (`navigator.languages`, most wanted first) that KiCad has a translation
 * for, else English.
 *
 * English ends the search like any other match: someone whose list is
 * `en-GB, de` reads English first, and must not be handed German because
 * English needs no catalog.
 */
export function languageForLocales(aLocales: readonly string[]): LanguageDescr {
  for (const tag of aLocales) {
    const catalog = catalogForLocale(tag);
    if (catalog) return descrOfCatalog(catalog);
  }
  return descrOfCatalog('en');
}

/**
 * The row whose catalog is in use for a stored `system.language`: the row it
 * names, or for "Default" - and for a string that names no row, which
 * `SetLanguage` leaves at `wxLANGUAGE_DEFAULT` (pgm_base.cpp:588-600) - the
 * browser's.
 */
export function effectiveLanguage(aLabel: string, aLocales: readonly string[]): LanguageDescr {
  const descr = languageDescrOf(aLabel);
  return descr && descr.catalog !== '' ? descr : languageForLocales(aLocales);
}

/** Fetches a compiled catalog by its `LanguageDescr.catalog` name. */
export type CatalogLoader = (aCatalog: string) => Promise<wxMsgCatalogData>;

/** The catalog name of the most recent `SetLanguage` call, so a slow fetch cannot win late. */
let s_requested: string | null = null;

/**
 * `PGM_BASE::SetLanguage`: make `aLabel` (a `system.language` value) the
 * interface language.
 *
 * Resolves to the row now in use. When the catalog cannot be fetched it does
 * what upstream does when `kicad.mo` is missing (pgm_base.cpp:652-668): falls
 * back to untranslated text and reports it, here by rejecting with
 * "The KiCad language file for this language is not installed.".
 *
 * English loads nothing. Upstream says why at :648-651 - "for the English
 * language, the dictionary is not mandatory, as all messages are already in
 * English" - and the msgid is the English text.
 */
export async function SetLanguage(
  aLabel: string,
  aLocales: readonly string[],
  aLoad: CatalogLoader,
): Promise<LanguageDescr> {
  const descr = effectiveLanguage(aLabel, aLocales);
  const translations = wxTranslations.Get();
  s_requested = descr.catalog;

  if (descr.catalog === 'en') {
    translations.SetCatalog(null);
    return descr;
  }
  if (translations.GetCatalog()?.GetLanguage() === descr.catalog) return descr;

  let data: wxMsgCatalogData;
  try {
    data = await aLoad(descr.catalog);
  } catch (e) {
    if (s_requested === descr.catalog) translations.SetCatalog(null);
    throw new Error('The KiCad language file for this language is not installed.', { cause: e });
  }
  // A later call asked for something else while this one was on the wire.
  if (s_requested !== descr.catalog) return descr;
  // The catalog is named for its file, not for the header's `Language:` field:
  // the two differ (`nb_NO` in `no.po`), and the file name is what we asked for.
  translations.SetCatalog(new wxMsgCatalog({ ...data, language: descr.catalog }));
  return descr;
}
