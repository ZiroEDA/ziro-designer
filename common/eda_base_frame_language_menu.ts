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
 * `bitmap2component/bitmap2cmp_frame_ui.tsx` and once in `home/menubar.ts` — which two
 * independent launcher audits flagged separately (Image Converter C5, CvPcb C3).
 *
 * WHAT A ROW DOES
 * ---------------
 * Picking a row stores its `m_Lang_Label` in `system.language` - the same key
 * upstream uses, and upstream stores the *label* there rather than a language
 * code (`pgm_base.cpp:592-596` matches the stored string against
 * `m_Lang_Label`, and `:642` writes it back). The application reacts to that
 * setting by loading the row's catalog (`PGM_BASE::SetLanguage`,
 * `pgm_base.ts`), and everything drawn through `_()` follows.
 *
 * No row is ever disabled, as none is upstream: every row of `LanguagesList`
 * has a catalog in `translation/`, compiled from the `.po` KiCad ships for it.
 * A few of those are thin (Croatian has no translated entry at 10.0.6), and
 * choosing one shows English wherever it has nothing - which is exactly what
 * KiCad shows.
 *
 * `m_DoNotTranslate` decides the label: it is `false` only for "Default", the
 * one label that is an English word rather than an endonym, so that row is
 * translated (`wxGetTranslation( m_Lang_Label )`) and every other row reads
 * the same in every locale - `noTranslate` on the menu row, since the menu
 * itself translates its labels when it draws them.
 */
import type { MenuItem } from '@ziroeda/wx/menu.js';
import { _HKI } from '@ziroeda/wx/translation.js';
import { DEFAULT_LANGUAGE, type LanguageDescr, LanguagesList } from './pgm_base.js';

export { DEFAULT_LANGUAGE, type LanguageDescr };

/** `LanguagesList[]`: see `pgm_base.ts`, where upstream's table lives. */
export const LANGUAGES_LIST: readonly LanguageDescr[] = LanguagesList;

export interface LanguageMenuOptions {
  /** `system.language` — the stored `m_Lang_Label`. */
  current: string;
  /** `PGM_BASE::SetLanguageIdentifier`, ours writing `system.language`. */
  onSelect: (label: string) => void;
}

/**
 * The "Set Language" submenu item, as `AddMenuLanguageList` builds it: every
 * row of `LanguagesList` as a `wxITEM_CHECK`, under a submenu titled
 * "Set Language" carrying `BITMAPS::language`.
 */
export function setLanguageMenuItem(opts: LanguageMenuOptions): MenuItem {
  // An unrecognised stored value falls back the way PGM_BASE does when no
  // LanguagesList row matches (pgm_base.cpp:588-600): wxLANGUAGE_DEFAULT.
  const current = LANGUAGES_LIST.some((l) => l.label === opts.current)
    ? opts.current
    : DEFAULT_LANGUAGE;

  return {
    label: _HKI('Set Language'),
    icon: 'language',
    submenu: LANGUAGES_LIST.map(
      (lang): MenuItem => ({
        label: lang.label,
        // `if( LanguagesList[ii].m_DoNotTranslate ) label = m_Lang_Label;`
        noTranslate: lang.doNotTranslate,
        // wxITEM_CHECK; PGM_BASE keeps exactly one of them checked.
        checked: lang.label === current,
        action: () => opts.onSelect(lang.label),
      }),
    ),
  };
}
