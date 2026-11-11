// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TARGET_PROPERTIES` (`pcbnew/dialogs/dialog_target_properties.cpp`) on a live
 * `PCB_TARGET`: Size, Thickness and the `+` / `X` shape choice. `PCB_EDIT_FRAME::
 * ShowTargetOptionsDialog` opens it, from OnEditItemRequest on an alignment target.
 *
 * `DialogTargetProperties` below is the window, DIALOG_TARGET_PROPERTIES_BASE over the class.
 */
import { type JSX, useEffect, useReducer, useRef, useState } from 'react';
import { MessageDialogError } from '@ziroeda/common/dialogs/dialog_message.js';
import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { pcbIUScale, unitLabel } from '@ziroeda/common/eda_units.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { wxChoice } from '@ziroeda/wx/choice.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_TARGET } from '../pcb_target.js';
import { DIALOG_TARGET_PROPERTIES_BASE, type UNIT } from './dialog_target_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `INT_MAX`, `m_Size.Validate`'s upper bound. */
const INT_MAX = 2147483647;

export class DIALOG_TARGET_PROPERTIES {
  private readonly m_Parent: PCB_BASE_FRAME;
  private readonly m_Target: PCB_TARGET;

  readonly m_Size: UNIT_BINDER;
  readonly m_Thickness: UNIT_BINDER;
  readonly m_TargetShape = new wxChoice(['+', 'X']);
  /** The UNIT_BINDER's `DisplayError`, answered by the window. */
  m_error: string | null = null;

  constructor(aParent: PCB_BASE_FRAME, aTarget: PCB_TARGET) {
    this.m_Parent = aParent;
    this.m_Target = aTarget;
    this.m_Size = new UNIT_BINDER(aParent, _('Size:'), (aMessage) => {
      this.m_error = aMessage;
    });
    this.m_Thickness = new UNIT_BINDER(aParent, _('Thickness:'));
    this.m_TargetShape.SetSelection(0);
  }

  TransferDataToWindow(): boolean {
    this.m_Size.SetValue(this.m_Target.GetSize());
    this.m_Thickness.SetValue(this.m_Target.GetWidth());

    this.m_TargetShape.SetSelection(this.m_Target.GetShape() ? 1 : 0);

    return true;
  }

  TransferDataFromWindow(): boolean {
    // Zero-size targets are hard to see/select.
    if (!this.m_Size.Validate(pcbIUScale.milsToIU(1), INT_MAX, 'unscaled')) return false;

    const commit = new BOARD_COMMIT(this.m_Parent);
    commit.Modify(this.m_Target);

    // Save old item in undo list, if it's not currently edited (will be later if so)
    const pushCommit = this.m_Target.GetEditFlags() === 0;

    // other edit in progress (MOVE, NEW ..): set flag IN_EDIT to force
    // undo/redo/abort proper operation
    if (this.m_Target.GetEditFlags() !== 0) this.m_Target.SetFlags(IN_EDIT);

    this.m_Target.SetWidth(this.m_Thickness.GetIntValue());
    this.m_Target.SetSize(this.m_Size.GetIntValue());
    this.m_Target.SetShape(this.m_TargetShape.GetSelection() ? 1 : 0);

    if (pushCommit) commit.Push(_('Edit Alignment Target'));

    return true;
  }
}

/** `ShowModal()` of DIALOG_TARGET_PROPERTIES. */
export function DialogTargetProperties({
  dialog,
  onClose,
}: {
  dialog: DIALOG_TARGET_PROPERTIES;
  /** The dialog ended: true for wxID_OK. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<string | null>(null);
  const sizeRef = useRef<HTMLInputElement>(null);

  // OnInitDialog -> TransferDataToWindow, and SetInitialFocus( m_sizeCtrl ).
  useState(() => dialog.TransferDataToWindow());
  useEffect(() => {
    sizeRef.current?.focus();
  }, []);

  const unit = (aBinder: UNIT_BINDER): UNIT => ({
    value: aBinder.GetText(),
    units: unitLabel(aBinder.GetUnits()),
    onChange: (aText) => {
      aBinder.SetText(aText);
      bump();
    },
  });

  return (
    <>
      <DIALOG_TARGET_PROPERTIES_BASE
        m_Size={unit(dialog.m_Size)}
        sizeCtrlRef={sizeRef}
        m_Thickness={unit(dialog.m_Thickness)}
        m_TargetShape={{
          value: dialog.m_TargetShape.GetSelection(),
          onChange: (aRow) => {
            dialog.m_TargetShape.SetSelection(aRow);
            bump();
          },
        }}
        onOK={() => {
          if (dialog.TransferDataFromWindow()) onClose(true);
          else {
            setError(dialog.m_error);
            dialog.m_error = null;
          }
        }}
        onCancel={() => onClose(false)}
      />
      {error !== null && (
        <MessageDialogError
          message={error}
          onClose={() => {
            setError(null);
            sizeRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
