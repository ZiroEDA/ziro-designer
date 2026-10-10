// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Offset Item. Counterpart: `pcbnew/dialogs/dialog_offset_item_base.cpp`:
 *
 *     bMainSizer (V)
 *       fgSizer2 (5 cols, col 1 growable)        1, wxEXPAND|wxALL 5
 *         label  entry  unit  spacer(10)  "Reset"      (X row, then Y row)
 *       bSizerBottom (H)                         wxEXPAND|wxTOP 5
 *         "Use polar coordinates"  spacer(40)  wxStdDialogButtonSizer
 *
 * The decisions are `dialog_offset_item.ts`'s `DIALOG_OFFSET_ITEM`, which this
 * window renders and whose handlers it calls. `onResult( true )` is
 * `wxID_OK` (after `TransferDataFromWindow()`), `onResult( false )` is
 * `wxID_CANCEL`.
 */
import { Button, CheckBox } from '@ziroeda/common/wx/controls.js';
import { type JSX, type Ref, useEffect, useRef, useSyncExternalStore } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import type { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { DIALOG_OFFSET_ITEM_TITLE, type DIALOG_OFFSET_ITEM } from './dialog_offset_item.js';

export function DialogOffsetItem({
  dialog,
  onResult,
}: {
  dialog: DIALOG_OFFSET_ITEM;
  onResult: (aOk: boolean) => void;
}): JSX.Element {
  useSyncExternalStore(
    (listener) => dialog.Subscribe(listener),
    () => dialog.GetVersion(),
  );

  const xRef = useRef<HTMLInputElement>(null);

  // `TransferDataToWindow()` when the dialog opens, then `SetInitialFocus( m_xEntry )`.
  useEffect(() => {
    dialog.TransferDataToWindow();
    xRef.current?.focus();
  }, [dialog]);

  const ok = (): void => {
    if (dialog.TransferDataFromWindow()) onResult(true);
  };

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
        if (e.key === 'Enter') {
          e.preventDefault();
          ok();
        }
      }}
    />
  );

  return (
    <DialogShim
      title={DIALOG_OFFSET_ITEM_TITLE}
      onClose={() => onResult(false)}
      className="ze-offset"
    >
      <div className="ze-modal-body ze-offset-body">
        <div className="ze-offset-grid">
          <label className="lbl r1" htmlFor="ze-offset-x">
            {dialog.GetXLabel()}
          </label>
          {entry(dialog.m_xOffset, 'ze-offset-x', 'r1', xRef)}
          <span className="unit1">{dialog.GetXUnitLabel()}</span>
          <span className="spacer s1" />
          <Button
            label="Reset"
            title={dialog.m_clearXToolTip}
            className="r1"
            onClick={() => dialog.OnClear('x')}
          />

          <label className="lbl r2l" htmlFor="ze-offset-y">
            {dialog.GetYLabel()}
          </label>
          {entry(dialog.m_yOffset, 'ze-offset-y', 'r2')}
          <span className="unit2">{dialog.GetYUnitLabel()}</span>
          <span className="spacer r2s" />
          <Button
            label="Reset"
            title={dialog.m_clearYToolTip}
            className="r2"
            onClick={() => dialog.OnClear('y')}
          />
        </div>
      </div>
      <StdDialogButtons onCancel={() => onResult(false)} onOk={ok}>
        <CheckBox
          label="Use polar coordinates"
          checked={dialog.m_polarCoords}
          onChange={(aChecked) => dialog.OnPolarChanged(aChecked)}
        />
      </StdDialogButtons>
    </DialogShim>
  );
}
