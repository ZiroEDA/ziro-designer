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
import { useState, type JSX } from 'react';
import { StdDialogButtons } from '../dialog_shim.js';
import type { wxTextValidator } from '../validators.js';
import { useModalEscape } from '../dialog_shim.js';

export function WX_TEXT_ENTRY_DIALOG({
  label,
  caption,
  defaultValue = '',
  extraWidth = false,
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
  /** `SetTextValidator`. */
  validator?: wxTextValidator;
  /** `GetValue()` on wxID_OK; `null` on wxID_CANCEL. */
  onResult: (value: string | null) => void;
}): JSX.Element {
  const [value, setValue] = useState(defaultValue);
  useModalEscape(() => onResult(null));

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-textentry" role="dialog" aria-modal="true" aria-label={caption}>
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-textentry-body">
          {label !== '' && <div className="ze-textentry-label">{label}</div>}
          <input
            className={`ze-search ze-textentry-ctrl${extraWidth ? ' extra' : ''}`}
            // `SetInitialFocus( m_textCtrl )`.
            // biome-ignore lint/a11y/noAutofocus: SetInitialFocus, upstream's own.
            autoFocus
            aria-label={label || caption}
            value={value}
            onChange={(e) =>
              setValue(validator ? validator.Filter(e.target.value) : e.target.value)
            }
            onKeyDown={(e) => {
              // The default button takes Enter, as a wxDialog's does.
              if (e.key === 'Enter') onResult(value);
              e.stopPropagation();
            }}
          />
        </div>
        <StdDialogButtons onCancel={() => onResult(null)} onOk={() => onResult(value)} />
      </div>
    </div>
  );
}
