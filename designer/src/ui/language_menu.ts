// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_BASE_FRAME::AddMenuLanguageList` (common/eda_base_frame.cpp:2062-2087)
 * and the `LanguagesList` table it walks (common/pgm_base.cpp:95-148), ported.
 *
 *     void EDA_BASE_FRAME::AddMenuLanguageList( ACTION_MENU* aMasterMenu,
 *                                              TOOL_INTERACTIVE* aControlTool )
 *     {
 *         ACTION_MENU* langsMenu = new ACTION_MENU( false, aControlTool );
 *         langsMenu->SetTitle( _( "Set Language" ) );
 *         langsMenu->SetIcon( BITMAPS::language );
 *
 *         for( unsigned ii = 0; LanguagesList[ii].m_KI_Lang_Identifier != 0; ii++ )
 *         {
 *             wxString label;
 *
 *             if( LanguagesList[ii].m_DoNotTranslate )
 *                 label = LanguagesList[ii].m_Lang_Label;
 *             else
 *                 label = wxGetTranslation( LanguagesList[ii].m_Lang_Label );
 *
 *             wxMenuItem* item = new wxMenuItem( langsMenu,
 *                                     LanguagesList[ii].m_KI_Lang_Identifier,
 *                                     label, tooltip, wxITEM_CHECK );
 *             langsMenu->Append( item );
 *         }
 *
 *         aMasterMenu->Add( langsMenu );
 *     }
 *
 * As with `help_menu.ts`, the point of this file is that there is one of it.
 * Upstream this is one function in `common/`, and every frame's Preferences
 * menu ends with a call to it. Ours was an inline
 * `[{ label: 'English', disabled: true }]` stub written twice — once in
 * `editors/image/ImageConverter.tsx` and once in `home/menubar.ts` — which two
 * independent launcher audits flagged separately (Image Converter C5, CvPcb C3).
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ---------------------------------
 * The list is real: all 45 rows, in upstream's order, with upstream's endonyms.
 * The check mark is real, and the choice is real and persists — it is stored in
 * `system.language`, the same key upstream uses, and upstream stores the
 * *label* there rather than a language code (`pgm_base.cpp:592-596` matches the
 * stored string against `m_Lang_Label`, and `:642` writes it back), so ours
 * stores the label too.
 *
 * The translation is **not** real. We ship no message catalogues, so there is
 * nothing for a locale other than English to switch the UI to. Rather than
 * offer 45 rows that silently do nothing, every row without a catalogue is
 * disabled — `TRANSLATED_LANGUAGES` is the honest list, and it currently holds
 * "Default" and "English", which are the same thing today. When catalogues land
 * that set grows and nothing else here changes.
 *
 * `m_DoNotTranslate` is carried faithfully even so: it is `false` only for
 * "Default", the one label that is an English word rather than an endonym, and
 * is therefore the one row whose label would be translated once catalogues
 * exist. Every other row reads the same in every locale by design.
 */
import type { MenuItem } from './menu_types.js';

/** `LANGUAGE_DESCR` (include/pgm_base.h), minus the two wx integer ids. */
export interface LanguageDescr {
  /**
   * `m_Lang_Label`. Also the key: "m_Lang_Label is also used as key in config"
   * (pgm_base.cpp:89-90).
   */
  label: string;
  /** `m_DoNotTranslate` — true for every endonym, false for "Default". */
  doNotTranslate: boolean;
}

/**
 * `LanguagesList[]` (common/pgm_base.cpp:95-148), in upstream's order, minus
 * the `{ 0, 0, "", false }` sentinel that terminates the C array.
 *
 * The order is not alphabetical by English name — it is alphabetical by
 * endonym, which is why Indonesian sits under B and Japanese under N. Keep it.
 */
export const LANGUAGES_LIST: readonly LanguageDescr[] = [
  { label: 'Default', doNotTranslate: false },
  { label: 'العربية', doNotTranslate: true },
  { label: 'فارسی', doNotTranslate: true },
  { label: 'Bahasa Indonesia', doNotTranslate: true },
  { label: 'Български', doNotTranslate: true },
  { label: 'Català', doNotTranslate: true },
  { label: 'Čeština', doNotTranslate: true },
  { label: 'Dansk', doNotTranslate: true },
  { label: 'Deutsch', doNotTranslate: true },
  { label: 'Ελληνικά', doNotTranslate: true },
  { label: 'Eesti', doNotTranslate: true },
  { label: 'English', doNotTranslate: true },
  { label: 'Español', doNotTranslate: true },
  { label: 'Español (Latinoamericano)', doNotTranslate: true },
  { label: 'Français', doNotTranslate: true },
  { label: 'עברית', doNotTranslate: true },
  { label: 'हिन्दी', doNotTranslate: true },
  { label: 'Hrvatski', doNotTranslate: true },
  { label: '한국어', doNotTranslate: true },
  { label: 'Italiano', doNotTranslate: true },
  { label: 'Latviešu', doNotTranslate: true },
  { label: 'Lietuvių', doNotTranslate: true },
  { label: 'Magyar', doNotTranslate: true },
  { label: 'Nederlands', doNotTranslate: true },
  { label: 'Norsk Bokmål', doNotTranslate: true },
  { label: '日本語', doNotTranslate: true },
  { label: 'ქართული', doNotTranslate: true },
  { label: 'ภาษาไทย', doNotTranslate: true },
  { label: 'Polski', doNotTranslate: true },
  { label: 'Português', doNotTranslate: true },
  { label: 'Português (Brasil)', doNotTranslate: true },
  { label: 'Română', doNotTranslate: true },
  { label: 'Русский', doNotTranslate: true },
  { label: 'Српски', doNotTranslate: true },
  { label: 'Slovenčina', doNotTranslate: true },
  { label: 'Slovenščina', doNotTranslate: true },
  { label: 'Suomi', doNotTranslate: true },
  { label: 'Svenska', doNotTranslate: true },
  { label: 'Tiếng Việt', doNotTranslate: true },
  { label: 'தமிழ்', doNotTranslate: true },
  { label: 'తెలుగు', doNotTranslate: true },
  { label: 'Türkçe', doNotTranslate: true },
  { label: 'Українська', doNotTranslate: true },
  { label: '简体中文', doNotTranslate: true },
  { label: '繁體中文', doNotTranslate: true },
];

/**
 * `system.language`'s default (common/settings/common_settings.cpp:355-356),
 * which is the first row of `LanguagesList`.
 */
export const DEFAULT_LANGUAGE = 'Default';

/**
 * The languages we can actually render the UI in — the labels for which a
 * message catalogue exists.
 *
 * There are no catalogues yet, so this is "Default" (follow the browser, which
 * lands on English) and "English". Every other row of `LANGUAGES_LIST` is shown
 * and greyed, because the list upstream is the whole list and pretending we
 * have 45 locales would be worse than admitting we have one.
 */
export const TRANSLATED_LANGUAGES: readonly string[] = [DEFAULT_LANGUAGE, 'English'];

export interface LanguageMenuOptions {
  /** `system.language` — the stored `m_Lang_Label`. */
  current: string;
  /** `PGM_BASE::SetLanguageIdentifier`, ours writing `system.language`. */
  onSelect: (label: string) => void;
  /**
   * Override the catalogue set; the tests use it, and it is the one seam that
   * needs to move when translations land.
   */
  available?: readonly string[];
}

/**
 * The "Set Language" submenu item, as `AddMenuLanguageList` builds it: every
 * row of `LanguagesList` as a `wxITEM_CHECK`, under a submenu titled
 * "Set Language" carrying `BITMAPS::language`.
 */
export function setLanguageMenuItem(opts: LanguageMenuOptions): MenuItem {
  const available = new Set(opts.available ?? TRANSLATED_LANGUAGES);
  // An unrecognised stored value falls back the way PGM_BASE does when no
  // LanguagesList row matches (pgm_base.cpp:588-600): wxLANGUAGE_DEFAULT.
  const current = LANGUAGES_LIST.some((l) => l.label === opts.current)
    ? opts.current
    : DEFAULT_LANGUAGE;

  return {
    label: 'Set Language',
    icon: 'language',
    submenu: LANGUAGES_LIST.map(
      (lang): MenuItem => ({
        label: lang.label,
        // wxITEM_CHECK; PGM_BASE keeps exactly one of them checked.
        checked: lang.label === current,
        disabled: !available.has(lang.label),
        action: () => opts.onSelect(lang.label),
      }),
    ),
  };
}
