// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TRACK_VIA_SIZE` (pcbnew/dialogs/dialog_track_via_size.cpp): what the router's "Use
 * Custom Values..." opens. It edits the BOARD_DESIGN_SETTINGS it is given: `m_customTrackWidth`
 * and the custom via, which `GetCurrentTrackWidth()` and `GetCurrentViaSize()` return while
 * `UseCustomTrackViaSize()` is on.
 *
 * OK runs `PCB_VIA::ValidateViaParameters` over the via pair - the same function Board Setup >
 * Pre-defined Sizes validates its via grid with - and on a failure puts the caret in the field
 * the error names. No minimum is enforced: the constructor's `minSize` lands in UNIT_BINDER's
 * `aAllowEval` (a bool), not in a range.
 *
 * `DialogTrackViaSize` below is the window, DIALOG_TRACK_VIA_SIZE_BASE over the class.
 */
import { type JSX, useReducer, useRef, useState } from 'react';
import { MessageDialogError } from '@ziroeda/common/dialogs/dialog_message.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import {
  UNIT_BINDER,
  type UNIT_BINDER_UNITS_PROVIDER,
} from '@ziroeda/common/widgets/unit_binder.js';
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import { PCB_VIA, VIA_PARAMETER_ERROR_FIELD } from '../pcb_track.js';
import { DIALOG_TRACK_VIA_SIZE_BASE, type UNIT } from './dialog_track_via_size_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export class DIALOG_TRACK_VIA_SIZE {
  readonly m_trackWidth: UNIT_BINDER;
  readonly m_viaDiameter: UNIT_BINDER;
  readonly m_viaDrill: UNIT_BINDER;
  /** `DisplayError( GetParent(), … )` and the field `SetFocus()` goes to. */
  m_error: { message: string; focus: 'diameter' | 'drill' | null } | null = null;

  private readonly m_settings: BOARD_DESIGN_SETTINGS;

  constructor(aParent: UNIT_BINDER_UNITS_PROVIDER, aSettings: BOARD_DESIGN_SETTINGS) {
    this.m_trackWidth = new UNIT_BINDER(aParent, _('Track width:'));
    this.m_viaDiameter = new UNIT_BINDER(aParent, _('Via diameter:'));
    this.m_viaDrill = new UNIT_BINDER(aParent, _('Via hole:'));
    this.m_settings = aSettings;
  }

  TransferDataFromWindow(): boolean {
    const viaDiameter = this.m_viaDiameter.GetIntValue();
    const viaDrill = this.m_viaDrill.GetIntValue();
    const error = PCB_VIA.ValidateViaParameters(viaDiameter, viaDrill);

    if (error) {
      const focus =
        error.m_Field === VIA_PARAMETER_ERROR_FIELD.DRILL
          ? 'drill'
          : error.m_Field === VIA_PARAMETER_ERROR_FIELD.DIAMETER
            ? 'diameter'
            : null;

      this.m_error = { message: error.m_Message, focus };
      return false;
    }

    // Store dialog values to the router settings
    this.m_settings.SetCustomTrackWidth(this.m_trackWidth.GetIntValue());
    this.m_settings.SetCustomViaSize(this.m_viaDiameter.GetIntValue());
    this.m_settings.SetCustomViaDrill(this.m_viaDrill.GetIntValue());

    return true;
  }

  TransferDataToWindow(): boolean {
    // Load router settings to dialog fields
    this.m_trackWidth.SetValue(this.m_settings.GetCustomTrackWidth());
    this.m_viaDiameter.SetValue(this.m_settings.GetCustomViaSize());
    this.m_viaDrill.SetValue(this.m_settings.GetCustomViaDrill());

    return true;
  }
}

/** `ShowModal()` of DIALOG_TRACK_VIA_SIZE: `onClose( true )` is wxID_OK. */
export function DialogTrackViaSize({
  dialog,
  onClose,
}: {
  dialog: DIALOG_TRACK_VIA_SIZE;
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<DIALOG_TRACK_VIA_SIZE['m_error']>(null);
  const diameterRef = useRef<HTMLInputElement>(null);
  const drillRef = useRef<HTMLInputElement>(null);

  // OnInitDialog -> TransferDataToWindow
  useState(() => dialog.TransferDataToWindow());

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
      <DIALOG_TRACK_VIA_SIZE_BASE
        m_trackWidth={unit(dialog.m_trackWidth)}
        m_viaDiameter={{ ...unit(dialog.m_viaDiameter), inputRef: diameterRef }}
        m_viaDrill={{ ...unit(dialog.m_viaDrill), inputRef: drillRef }}
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
          message={error.message}
          onClose={() => {
            setError(null);

            if (error.focus === 'drill') drillRef.current?.focus();
            else if (error.focus === 'diameter') diameterRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
