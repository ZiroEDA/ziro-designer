// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Symbol Editor > Colors — `PANEL_SYM_COLOR_SETTINGS`
 * (`eeschema/dialogs/panel_sym_color_settings.cpp`), constructed by eeschema's
 * KIFACE for `PANEL_SYM_COLORS`:
 *
 *     case PANEL_SYM_COLORS:
 *         return new PANEL_SYM_COLOR_SETTINGS( aParent );
 *     (`eeschema/eeschema.cpp:304-305`)
 *
 * **It is not a `PANEL_COLOR_SETTINGS`.** It derives from
 * `PANEL_SYM_COLOR_SETTINGS_BASE`, which is a plain `wxPanel`
 * (`panel_sym_color_settings_base.h`), so there is no swatch grid, no layer
 * list, no theme-saving row, and — because it is not a `RESETTABLE_PANEL`
 * either — no "Reset to Defaults": `PAGED_DIALOG::UpdateResetButton`
 * (`common/widgets/paged_dialog.cpp:329-355`) greys the button out on it. The
 * factory registers no `reset` for `sym-colors`, and that omission is the whole
 * of how that is said here.
 *
 * The sizer tree is twenty lines (`panel_sym_color_settings_base.cpp:16-45`):
 *
 *     p1mainSizer (V)
 *       bMargins (V)                                       wxTOP 10
 *         m_eeschemaRB "Use schematic editor color theme"  wxBOTTOM|wxRIGHT|wxLEFT 5   (wxRB_GROUP)
 *         bSizer2 (H)                                      wxEXPAND|wxTOP|wxBOTTOM 5
 *           m_themeRB "Use theme:"                         wxALIGN_CENTER_VERTICAL|wxRIGHT|wxLEFT 5
 *           m_themes  wxChoice, proportion 1               wxALIGN_CENTER_VERTICAL|wxRIGHT 5
 *
 * No heading and no `wxStaticLine`, exactly as the Drawing Sheet Editor's
 * Colors page has none — both are pages that are one row of controls, and a
 * `Group` here would be an invention.
 *
 * **What reads it.** `SYMBOL_EDIT_FRAME::GetColorSettings`
 * (`symbol_edit_frame.cpp:402-410`) is the whole of what these two buttons
 * decide, and it is a swap of which settings object is asked rather than a
 * second theme id: with `m_UseEeschemaColorSettings` set the frame asks
 * `EESCHEMA_SETTINGS`, otherwise its own. `prefs/useSettings.ts`'
 * `useSymbolEditorTheme` is that function, and `SymbolEditor` calls it — it
 * called `useSchematicTheme()` before, i.e. took the first branch
 * unconditionally, so the choice could not exist.
 *
 * The theme list is `GetColorSettingsList()`, which is app-wide and not any
 * editor's; `colorThemeOptions` is the same list `ColorThemeChoice` builds.
 * `markReadOnly` is off, because this panel appends `settings->GetName()` raw
 * (`panel_sym_color_settings.cpp:56`) where `PANEL_COLOR_SETTINGS` goes through
 * `GetSettingsDropdownName` and adds "(read-only)".
 */
import type { JSX } from 'react';
import { Combo } from '../../../ui/Combo.js';
import { colorThemeOptions } from '../../../dialogs/prefs/ColorThemeChoice.js';
import { pcm, usePcmVersion } from '../../../pcm/pcmStore.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/** `wxRadioButton`'s group name — the two are one `wxRB_GROUP`. */
const GROUP = 'sym-colors-source';

export function PanelSymbolEditorColorSettings({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { symbolEditor, upSym } = ctx;
  usePcmVersion();
  const useEeschema = symbolEditor.use_eeschema_color_settings;
  return (
    <div className="ze-sym-colors">
      <label className="ze-pref-radio">
        <input
          type="radio"
          name={GROUP}
          checked={useEeschema}
          onChange={() =>
            upSym((s) => {
              s.use_eeschema_color_settings = true;
            })
          }
        />
        Use schematic editor color theme
      </label>
      <div className="ze-sym-colors-row">
        <label className="ze-pref-radio">
          <input
            type="radio"
            name={GROUP}
            checked={!useEeschema}
            onChange={() =>
              upSym((s) => {
                s.use_eeschema_color_settings = false;
              })
            }
          />
          Use theme:
        </label>
        {/* `OnThemeChanged` is one line — `m_themeRB->SetValue( true )`
            (`panel_sym_color_settings.cpp:89-92`) — so picking a theme SELECTS
            the second radio. Without it the choice could be changed while the
            first button stayed on and `TransferDataFromWindow` would discard
            what was just picked (`:74-86` writes `m_ColorTheme` only on the
            other branch). */}
        <Combo
          value={symbolEditor.appearance.color_theme}
          ariaLabel="Use theme:"
          options={colorThemeOptions(pcm.installedThemes()).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(v) =>
            upSym((s) => {
              s.appearance.color_theme = v;
              s.use_eeschema_color_settings = false;
            })
          }
        />
      </div>
    </div>
  );
}
