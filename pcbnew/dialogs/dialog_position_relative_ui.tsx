// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Position Relative To Reference Item. Counterpart:
 * `pcbnew/dialogs/dialog_position_relative_base.cpp`:
 *
 *     bMainSizer (V)
 *       bUpperSizer (V)                          wxEXPAND|wxALL 5
 *         m_referenceInfo (min width 340)        wxALL|wxEXPAND 5
 *         bSizerButtOpts (H)                     1, wxEXPAND|wxTOP|wxBOTTOM 5
 *           "Use Local Origin" "Use Grid Origin"
 *           "Select Item..."   "Select Point..."   each 1, wxALL 5
 *         bSizer6 > wxStaticLine                 wxEXPAND|wxTOP 5
 *       fgSizer2 (5 cols, col 1 growable)        1, wxEXPAND|wxALL 5
 *         label  entry  unit  spacer(10)  "Reset"      (X row, then Y row)
 *       bSizerBottom (H)                         wxEXPAND|wxTOP 5
 *         "Use polar coordinates"  spacer(40)  wxStdDialogButtonSizer
 *
 * The decisions are `dialog_position_relative.ts`'s `DIALOG_POSITION_RELATIVE`,
 * which this window renders and whose handlers it calls. The dialog is
 * MODELESS: it is drawn while `dialog.IsShown()`, over the canvas, which stays
 * live (the picker buttons hide it and the picker brings it back).
 */
import { Button, CheckBox, StaticLine } from '@ziroeda/common/wx/controls.js';
import { type JSX, type Ref, useEffect, useRef, useSyncExternalStore } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import type { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import {
  DIALOG_POSITION_RELATIVE_TITLE,
  type DIALOG_POSITION_RELATIVE,
} from './dialog_position_relative.js';

export function DialogPositionRelativeModeless({
  dialog,
}: {
  dialog: DIALOG_POSITION_RELATIVE;
}): JSX.Element | null {
  useSyncExternalStore(
    (listener) => dialog.Subscribe(listener),
    () => dialog.GetVersion(),
  );

  const shown = dialog.IsShown();
  const xRef = useRef<HTMLInputElement>(null);
  const raised = dialog.GetRaiseCount();

  // `SetInitialFocus( m_xEntry )`, and `Raise(); SetFocus()` when the picker returns.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `raised` is the trigger, the effect does not read it
  useEffect(() => {
    if (shown) xRef.current?.focus();
  }, [shown, raised]);

  if (!shown) return null;

  const entry = (
    binder: UNIT_BINDER,
    id: string,
    cls: string,
    ref?: Ref<HTMLInputElement>,
  ): JSX.Element => (
    <input
      ref={ref}
      id={id}
      className={`ze-search ${cls}`}
      value={binder.GetText()}
      onChange={(e) => dialog.SetEntryText(binder, e.target.value)}
      onBlur={() => dialog.OnTextFocusLost(binder)}
      onKeyDown={(e) => {
        // The OK button is the dialog's default: Enter activates it.
        if (e.key === 'Enter') dialog.OnOkClick();
      }}
    />
  );

  return (
    <DialogShim
      title={DIALOG_POSITION_RELATIVE_TITLE}
      onClose={() => dialog.OnCancel()}
      modeless
      className="ze-posrel"
    >
      <div className="ze-posrel-body">
        <div className="ze-posrel-upper">
          <div className="ze-posrel-info">{dialog.m_referenceInfo}</div>
          <div className="ze-posrel-buttons">
            <Button label="Use Local Origin" onClick={() => dialog.OnUseUserOriginClick()} />
            <Button label="Use Grid Origin" onClick={() => dialog.OnUseGridOriginClick()} />
            <Button
              label="Select Item..."
              title={
                'Click and select a board item.\nThe anchor position will be the position of the selected item.'
              }
              onClick={() => dialog.OnSelectItemClick()}
            />
            <Button label="Select Point..." onClick={() => dialog.OnSelectPointClick()} />
          </div>
          <StaticLine className="ze-posrel-line" />
        </div>

        <div className="ze-posrel-grid">
          <label className="lbl r1" htmlFor="ze-posrel-x">
            {dialog.GetXLabel()}
          </label>
          {entry(dialog.m_xOffset, 'ze-posrel-x', 'r1', xRef)}
          <span className="unit">{dialog.GetXUnitLabel()}</span>
          <span className="spacer r1" />
          <Button
            label="Reset"
            className="r1"
            title={dialog.m_clearXToolTip}
            onClick={() => dialog.OnClear('x')}
          />

          <label className="lbl r2l" htmlFor="ze-posrel-y">
            {dialog.GetYLabel()}
          </label>
          {entry(dialog.m_yOffset, 'ze-posrel-y', 'r2')}
          <span className="unit">{dialog.GetYUnitLabel()}</span>
          <span className="spacer r2s" />
          <Button
            label="Reset"
            className="r2"
            title={dialog.m_clearYToolTip}
            onClick={() => dialog.OnClear('y')}
          />
        </div>
      </div>
      <StdDialogButtons onCancel={() => dialog.OnCancel()} onOk={() => dialog.OnOkClick()}>
        <CheckBox
          label="Use polar coordinates"
          checked={dialog.m_polarCoords}
          onChange={(on) => dialog.OnPolarChanged(on)}
        />
      </StdDialogButtons>
    </DialogShim>
  );
}
