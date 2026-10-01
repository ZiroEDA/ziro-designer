// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Push Pad Properties. Counterpart: `dialog_push_pad_properties_base.cpp`:
 *
 *     bMainSizer (V)
 *       bLeftSizer (V)                              wxALL|wxEXPAND 5
 *         sbSizer1 "Options" (V)                    1, wxEXPAND|wxTOP|wxRIGHT|wxLEFT 5
 *           4 wxCheckBoxes                          wxBOTTOM|wxRIGHT|wxLEFT 5
 *       wxStdDialogButtonSizer                      wxALL|wxEXPAND 5
 *         OK ("Change Pads on Current Footprint")
 *         Apply ("Change Pads on Identical Footprints"), hidden in the footprint editor
 *         Cancel
 *
 * The decisions are `dialog_push_pad_properties.ts`'s `DIALOG_PUSH_PAD_PROPERTIES`,
 * which this window renders. `onResult` is what `ShowModal()` returns: `0` for
 * OK, `1` for Apply, `wxID_CANCEL` otherwise.
 */
import { type JSX, useState } from 'react';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import {
  DIALOG_PUSH_PAD_PROPERTIES_TITLE,
  PUSH_PAD_APPLY_LABEL,
  PUSH_PAD_OK_LABEL,
  type DIALOG_PUSH_PAD_PROPERTIES,
  wxID_CANCEL,
} from './dialog_push_pad_properties.js';

type FILTER =
  | 'm_Pad_Shape_Filter_CB'
  | 'm_Pad_Layer_Filter_CB'
  | 'm_Pad_Orient_Filter_CB'
  | 'm_Pad_Type_Filter_CB';

const FILTERS: readonly { key: FILTER; label: string }[] = [
  { key: 'm_Pad_Shape_Filter_CB', label: 'Do not modify pads having a different shape' },
  { key: 'm_Pad_Layer_Filter_CB', label: 'Do not modify pads having different layers' },
  { key: 'm_Pad_Orient_Filter_CB', label: 'Do not modify pads having a different orientation' },
  { key: 'm_Pad_Type_Filter_CB', label: 'Do not modify pads having a different type' },
];

export function DialogPushPadProperties({
  dialog,
  onResult,
}: {
  dialog: DIALOG_PUSH_PAD_PROPERTIES;
  onResult: (aReturnCode: number) => void;
}): JSX.Element {
  useModalEscape(() => onResult(wxID_CANCEL));

  // the check boxes are the dialog's own fields; a counter redraws after one is toggled
  const [, redraw] = useState(0);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-pushpad" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{DIALOG_PUSH_PAD_PROPERTIES_TITLE}</div>
        <div className="ze-modal-body ze-pushpad-body">
          <div className="ze-pushpad-left">
            <fieldset className="ze-sbox ze-pushpad-box">
              <legend>Options</legend>
              {FILTERS.map(({ key, label }) => (
                <label key={key} className="ze-pushpad-cb">
                  <input
                    type="checkbox"
                    checked={dialog[key]}
                    onChange={(e) => {
                      dialog[key] = e.target.checked;
                      redraw((n) => n + 1);
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        </div>
        <StdDialogButtons
          onCancel={() => onResult(wxID_CANCEL)}
          onOk={() => onResult(dialog.PadPropertiesAccept('ok'))}
          okLabel={PUSH_PAD_OK_LABEL}
          onApply={
            dialog.m_applyShown ? () => onResult(dialog.PadPropertiesAccept('apply')) : undefined
          }
          applyLabel={PUSH_PAD_APPLY_LABEL}
        />
      </div>
    </div>
  );
}
