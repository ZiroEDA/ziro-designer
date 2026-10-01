// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Renumber Pads. Counterpart: `dialog_enum_pads_base.cpp`:
 *
 *     bMainSizer (V)
 *       m_lblInfo                          wxALL|wxALIGN_CENTER_HORIZONTAL 5
 *       spacer (0,0)                       wxTOP|wxBOTTOM 5
 *       fgSizer (2 cols, col 1 growable)   1, wxEXPAND|wxALL 5
 *         "Pad name prefix:"    wxTextCtrl (max length 4)
 *         "First pad number:"   wxSpinCtrl 0..999
 *         "Numbering step:"     wxSpinCtrl 0..999
 *       wxStdDialogButtonSizer             wxEXPAND|wxALL 5
 *
 * The decisions are `dialog_enum_pads.ts`'s `DIALOG_ENUM_PADS`. `onResult( true )`
 * is `wxID_OK` after `TransferDataFromWindow()`.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { SpinCtrl } from '@ziroeda/common/widgets/spin_ctrl.js';
import { DIALOG_ENUM_PADS_TITLE, type DIALOG_ENUM_PADS } from './dialog_enum_pads.js';

export function DialogEnumPads({
  dialog,
  onResult,
}: {
  dialog: DIALOG_ENUM_PADS;
  onResult: (aOk: boolean) => void;
}): JSX.Element {
  useModalEscape(() => onResult(false));

  const [prefix, setPrefix] = useState(dialog.m_padPrefix);
  const [start, setStart] = useState(dialog.m_padStartNum);
  const [step, setStep] = useState(dialog.m_padNumStep);
  const prefixRef = useRef<HTMLInputElement>(null);

  // `SetInitialFocus( m_padPrefix )`
  useEffect(() => {
    prefixRef.current?.focus();
  }, []);

  const ok = (): void => {
    dialog.m_padPrefix = prefix;
    dialog.m_padStartNum = start;
    dialog.m_padNumStep = step;

    if (dialog.TransferDataFromWindow()) onResult(true);
  };

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-enumpads" role="dialog" aria-modal="true">
        <div className="ze-modal-header">{DIALOG_ENUM_PADS_TITLE}</div>
        <div className="ze-modal-body ze-enumpads-body">
          <div className="ze-enumpads-info">
            Pad names are restricted to 4 characters (including number).
          </div>
          <div className="ze-enumpads-gap" />
          <div className="ze-enumpads-grid">
            <label className="lbl" htmlFor="ze-enumpads-prefix">
              Pad name prefix:
            </label>
            <input
              id="ze-enumpads-prefix"
              ref={prefixRef}
              className="ze-search"
              maxLength={4}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ok();
              }}
            />
            <label className="lbl" htmlFor="ze-enumpads-start">
              First pad number:
            </label>
            <SpinCtrl id="ze-enumpads-start" value={start} onChange={setStart} min={0} max={999} />
            <label className="lbl" htmlFor="ze-enumpads-step">
              Numbering step:
            </label>
            <SpinCtrl id="ze-enumpads-step" value={step} onChange={setStep} min={0} max={999} />
          </div>
        </div>
        <StdDialogButtons onCancel={() => onResult(false)} onOk={ok} />
      </div>
    </div>
  );
}
