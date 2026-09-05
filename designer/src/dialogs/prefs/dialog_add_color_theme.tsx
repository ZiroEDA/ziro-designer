// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "New Theme..." — the last row of the Colors page's theme choice, and what
 * `PANEL_COLOR_SETTINGS::OnThemeChanged` does when it is picked
 * (`common/dialogs/panel_color_settings.cpp:132-176`):
 *
 *     if( !saveCurrentTheme( false ) ) return;
 *     FOOTPRINT_NAME_VALIDATOR themeNameValidator;
 *     wxTextEntryDialog dlg( …, _( "New theme name:" ), _( "Add Color Theme" ) );
 *     dlg.SetTextValidator( themeNameValidator );
 *     if( dlg.ShowModal() != wxID_OK ) return;
 *     …
 *     if( fn.Exists() ) { wxMessageBox( _( "Theme already exists!" ) ); return; }
 *     COLOR_SETTINGS* newSettings = settingsMgr.AddNewColorSettings( themeName );
 *     for( int layer : m_validLayers )
 *         newSettings->SetColor( layer, m_currentSettings->GetColor( layer ) );
 *
 * Three things there are easy to miss and all three are visible to a user: the
 * new theme is seeded from the theme that was SELECTED, not from the defaults;
 * the name is also the FILE name, so "already exists" is a question about the
 * folder and not about the display name; and the collision is reported after
 * the dialog has closed, so the name is lost and the user starts again.
 */
import { useState, type JSX } from 'react';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { OK_LABEL } from '../../ui/message_dialog.js';

/**
 * `FOOTPRINT_NAME_VALIDATOR` (`common/validators.cpp:45-53`), a
 * `wxFILTER_EXCLUDE_CHAR_LIST`:
 *
 *     wxString illegalChars = wxS( "%$<>\t\n\r\"\\/:" );
 *
 * An exclude list, not an allow list — a space, a dot and a dash are all fine
 * in a theme name, and the file is named after it. wx refuses the KEYSTROKE, so
 * the character never appears in the field rather than being stripped on OK.
 */
export const THEME_NAME_ILLEGAL_CHARS = '%$<>\t\n\r"\\/:';

/** What `SetCharExcludes` lets through. */
export function filterThemeName(text: string): string {
  return [...text].filter((c) => !THEME_NAME_ILLEGAL_CHARS.includes(c)).join('');
}

export function AddColorThemeDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  /** The typed name. The caller owns the "already exists" answer, because it is
   *  the one holding the folder. */
  onConfirm: (name: string) => void;
}): JSX.Element {
  useModalEscape(onCancel);
  const [name, setName] = useState('');

  // `wxTextEntryDialog`'s OK is live even on an empty field; upstream then
  // creates `.json`, which is why an empty name is refused here rather than
  // written. Everything else the validator already let through.
  const ok = name !== '';

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-newprjfolder ze-addtheme" role="dialog" aria-modal="true">
        <div className="ze-modal-header">Add Color Theme</div>
        <div className="ze-modal-body ze-newprjfolder-body">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is the control. */}
          <label>
            <span>New theme name:</span>
            <input
              className="ze-search"
              autoFocus
              value={name}
              onChange={(e) => setName(filterThemeName(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ok) onConfirm(name);
              }}
            />
          </label>
        </div>
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn" disabled={!ok} onClick={() => onConfirm(name)}>
            {OK_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
