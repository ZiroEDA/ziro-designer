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
 *
 * Laid out as wx's generic one (`wxTextEntryDialog::Create`, src/generic/textdlgg.cpp): the
 * message with a double border, the entry - `wxSize( 300, -1 )` - expanded with a triple border at
 * its sides, and the buttons. It was a label row of its own CSS, the message beside the entry, and a
 * long one wrapped into a column; the customize hook's controls went beside it too, not under it.
 */
import { useRef, useState, type JSX, type ReactNode } from 'react';
import { TextCtrl, StaticText } from './controls.js';
import { wxALL, wxEXPAND, wxLEFT, wxRIGHT, wxVERTICAL } from './defs.js';
import { Dialog } from './dialog.js';
import { BoxSizer, SizerItem, StdDialogButtonSizer } from './sizer.js';
import type { wxTextValidator } from './valtext.js';

/** `wxSizerFlags::DoubleBorder()` / `TripleBorder()`: twice and three times the default 5. */
const DOUBLE_BORDER = 10;
const TRIPLE_BORDER = 15;
/** The entry's `wxSize( 300, wxDefaultCoord )`. */
const ENTRY_WIDTH = 300;

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
      // The entry has the focus, its text selected, so typing replaces it. Once shown: the frame
      // is measured hidden first, and a hidden entry takes no focus (`autoFocus` never did).
      onShown={() => {
        entryRef.current?.focus();
        entryRef.current?.select();
      }}
    >
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL} border={DOUBLE_BORDER}>
          <StaticText label={message} />
        </SizerItem>
        <SizerItem
          flag={wxEXPAND | wxLEFT | wxRIGHT}
          border={TRIPLE_BORDER}
          minSize={[ENTRY_WIDTH, -1]}
        >
          <TextCtrl
            inputRef={entryRef}
            ariaLabel={message}
            value={name}
            onChange={(v) => setName(validator ? validator.Filter(v) : v)}
            onEnter={() => {
              if (ok) onConfirm(name);
            }}
          />
        </SizerItem>
        {extra !== undefined && (
          <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={TRIPLE_BORDER}>
            {extra}
          </SizerItem>
        )}
      </BoxSizer>
      <StdDialogButtonSizer onCancel={onCancel} onOk={() => onConfirm(name)} okDisabled={!ok} />
    </Dialog>
  );
}
