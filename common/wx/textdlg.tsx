// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxTextEntryDialog` (wx/textdlg.h), as KiCad's dialogs construct it:
 *
 *     wxTextEntryDialog dlg( parent, _( "New theme name:" ), _( "Add Color Theme" ) );
 *     dlg.SetTextValidator( themeNameValidator );
 *     if( dlg.ShowModal() != wxID_OK ) return;
 *
 * A caption, a message above the entry, an optional `wxTextValidator`, and OK
 * (disabled while the entry is empty) / Cancel. The caller owns what happens
 * to the text, including any "already exists" answer after the dialog has
 * closed - which is when upstream gives it.
 *
 * It was `dialog_add_color_theme.tsx`, written for that one caller.
 */
import { useState, type JSX } from 'react';
import { useModalEscape } from '../dialogs/use_modal_escape.js';
import { OK_LABEL } from '../confirm_types.js';
import type { wxTextValidator } from '../validators.js';

export function WxTextEntryDialog({
  caption,
  message,
  value = '',
  validator,
  onCancel,
  onConfirm,
}: {
  /** The dialog's title. */
  caption: string;
  /** The prompt above the entry. */
  message: string;
  /** The entry's initial text (wxTextEntryDialog's `value`). */
  value?: string;
  /** `SetTextValidator`: characters it excludes cannot be typed. */
  validator?: wxTextValidator;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}): JSX.Element {
  useModalEscape(onCancel);
  const [name, setName] = useState(value);

  const ok = name !== '';

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-newprjfolder ze-addtheme" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-modal-body ze-newprjfolder-body">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is the control. */}
          <label>
            <span>{message}</span>
            <input
              className="ze-search"
              autoFocus
              value={name}
              onChange={(e) =>
                setName(validator ? validator.Filter(e.target.value) : e.target.value)
              }
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
