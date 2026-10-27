// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_TEXT_ENTRY_DIALOG` (common/dialogs/dialog_text_entry.cpp) with its
 * `_base` folded in: a caption, an optional label, one wxTextCtrl and OK /
 * Cancel. The DRC and ERC dialogs' "Exclusion Comment" is the caller that
 * matters most:
 *
 *     WX_TEXT_ENTRY_DIALOG dlg( this, wxEmptyString, _( "Exclusion Comment" ),
 *                               marker->GetComment(), true );
 *
 * Both used to ask with the browser's own `prompt()` - a native grey box that
 * no KiCad build has ever shown.
 *
 * The sizer tree (dialog_text_entry_base.cpp): `m_ContentSizer` added to
 * `m_mainSizer` with wxALL 5; `m_label` wxEXPAND|wxTOP|wxRIGHT|wxLEFT 5 and
 * hidden when the label is empty; `m_textCtrl` wxEXPAND|wxALL 5 with a
 * 300 px minimum, or 700 with `aExtraWidth`; the std buttons wxALL 5.
 */
import { useRef, useState, type JSX } from 'react';
import { StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import { BoxSizer, SizerItem } from '@ziroeda/wx/sizer.js';
import {
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { DialogShim, StdDialogButtons } from '../dialog_shim.js';
import type { wxTextValidator } from '../validators.js';

export function WX_TEXT_ENTRY_DIALOG({
  label,
  caption,
  defaultValue = '',
  extraWidth = false,
  hint,
  notes,
  validator,
  onResult,
}: {
  /** `aFieldLabel`; empty hides `m_label`. */
  label: string;
  /** `aCaption`, the title. */
  caption: string;
  /** `aDefaultValue`. */
  defaultValue?: string;
  /** `aExtraWidth`: the entry's minimum is 700 rather than 300. */
  extraWidth?: boolean;
  /** `m_textCtrl->SetHint( aHint )`: the grey example an empty entry shows. */
  hint?: string;
  /**
   * Points under the entry, one line each. Not upstream's: a web caller whose entry needs
   * explaining (what a link may be, and what it opens) says it here, where it is read after the
   * entry rather than as a paragraph in front of it.
   */
  notes?: readonly string[];
  /** `SetTextValidator`. */
  validator?: wxTextValidator;
  /** `GetValue()` on wxID_OK; `null` on wxID_CANCEL. */
  onResult: (value: string | null) => void;
}): JSX.Element {
  const [value, setValue] = useState(defaultValue);
  const textCtrl = useRef<HTMLInputElement>(null);

  // `SetInitialFocus( m_textCtrl )`: DIALOG_SHIM gives it the focus once the dialog is shown. An
  // `autoFocus` here ran while the frame was still measured hidden, so it never took, and the
  // frame had the focus instead.
  return (
    <DialogShim title={caption} onClose={() => onResult(null)} initialFocus={textCtrl}>
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          <BoxSizer orient={wxVERTICAL}>
            {label !== '' && (
              <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                {/* Wrapped at the entry's minimum, so a label that explains is a paragraph
                    over the entry rather than a line that widens the dialog. */}
                <StaticText label={label} wrap={extraWidth ? 700 : 300} />
              </SizerItem>
            )}
            {/* m_textCtrl->SetMinSize( wxSize( aExtraWidth ? 700 : 300, -1 ) ) */}
            <SizerItem flag={wxEXPAND | wxALL} border={5} minSize={[extraWidth ? 700 : 300, -1]}>
              <TextCtrl
                inputRef={textCtrl}
                ariaLabel={label || caption}
                hint={hint}
                value={value}
                // No wxTE_PROCESS_ENTER: Enter goes on to the dialog, whose default button is OK.
                onChange={(v) => setValue(validator ? validator.Filter(v) : v)}
              />
            </SizerItem>
            {/* Each point an item bordered as the rest are, so they stand apart as points: the
                bullet in a column of its own, so a point's second line starts under its text. */}
            {notes?.map((note) => (
              <SizerItem key={note} flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxRIGHT} border={5}>
                    <StaticText label={'\u2022'} />
                  </SizerItem>
                  <SizerItem proportion={1}>
                    <StaticText label={note} wrap={extraWidth ? 700 : 300} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            ))}
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
      <StdDialogButtons onCancel={() => onResult(null)} onOk={() => onResult(value)} />
    </DialogShim>
  );
}
