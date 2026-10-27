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
import { useRef, useState, type JSX, type ReactNode } from 'react';
import { Dialog } from './dialog.js';
import { CANCEL_LABEL, OK_LABEL } from './stockitem.js';
import type { wxTextValidator } from './valtext.js';

export function WxTextEntryDialog({
  caption,
  message,
  value = '',
  validator,
  extra,
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
  /**
   * Controls under the entry: a `wxFileDialogCustomizeHook`'s, where the entry stands for a file
   * dialog that names a file (SCH_BASE_FRAME::LibraryFileBrowser).
   */
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}): JSX.Element {
  const [name, setName] = useState(value);
  const entryRef = useRef<HTMLInputElement>(null);

  const ok = name !== '';

  return (
    // wxTextEntryDialogStyle (wxOK | wxCANCEL | wxCENTRE): no resize border.
    <Dialog
      title={caption}
      onClose={onCancel}
      resizable={false}
      className="ze-newprjfolder ze-addtheme"
      // The entry has the focus, its text selected, so typing replaces it. Once shown: the frame
      // is measured hidden first, and a hidden entry takes no focus (`autoFocus` never did).
      onShown={() => {
        entryRef.current?.focus();
        entryRef.current?.select();
      }}
    >
      <div className="ze-modal-body ze-newprjfolder-body">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the input is the control. */}
        <label>
          <span>{message}</span>
          <input
            ref={entryRef}
            className="ze-search"
            value={name}
            onChange={(e) => setName(validator ? validator.Filter(e.target.value) : e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ok) {
                e.preventDefault();
                onConfirm(name);
              }
            }}
          />
        </label>
        {extra}
      </div>
      <div className="ze-modal-footer">
        <button type="button" className="ze-btn" onClick={onCancel}>
          {CANCEL_LABEL}
        </button>
        <button type="button" className="ze-btn" disabled={!ok} onClick={() => onConfirm(name)}>
          {OK_LABEL}
        </button>
      </div>
    </Dialog>
  );
}
