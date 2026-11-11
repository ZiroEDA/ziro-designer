// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PNS_DIFF_PAIR_DIMENSIONS` (pcbnew/dialogs/dialog_pns_diff_pair_dimensions.cpp): what
 * `DIFF_PAIR_MENU`'s "Use Custom Values..." opens. It edits the `PNS::SIZES_SETTINGS` it is given
 * - ROUTER_TOOL::DpDimensionsDialog's copy of the router's sizes - not BOARD_DESIGN_SETTINGS.
 *
 * It refuses a gap of zero with its own message ("Track gap must be greater than 0.") and
 * focuses that field, and refuses nothing else: a width of zero is accepted. The "Via gap same
 * as track gap" box greys the via gap row and writes the sizes as it is toggled
 * (updateCheckbox).
 *
 * `DialogPnsDiffPairDimensions` below is the window, DIALOG_PNS_DIFF_PAIR_DIMENSIONS_BASE over
 * the class.
 */
import { type JSX, useReducer, useRef, useState } from 'react';
import { MessageDialogError } from '@ziroeda/common/dialogs/dialog_message.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import {
  UNIT_BINDER,
  type UNIT_BINDER_UNITS_PROVIDER,
} from '@ziroeda/common/widgets/unit_binder.js';
import type { PnsRouterSizes } from '../router/pns_router.js';
import {
  DIALOG_PNS_DIFF_PAIR_DIMENSIONS_BASE,
  type UNIT,
} from './dialog_pns_diff_pair_dimensions_base.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `SIZES_SETTINGS::DiffPairViaGap()`: the trace gap while "same as trace gap" holds. */
function DiffPairViaGap(aSizes: PnsRouterSizes): number {
  return aSizes.diffPairViaGapSameAsTraceGap ? aSizes.diffPairGap : aSizes.diffPairViaGap;
}

export class DIALOG_PNS_DIFF_PAIR_DIMENSIONS {
  readonly m_traceWidth: UNIT_BINDER;
  readonly m_traceGap: UNIT_BINDER;
  readonly m_viaGap: UNIT_BINDER;
  /** `m_viaTraceGapEqual->SetValue( true )` in the base. */
  m_viaTraceGapEqual = true;
  /** `DisplayErrorMessage` and the field `SetFocus()` goes to. */
  m_error: { message: string; focus: 'gap' } | null = null;

  private readonly m_sizes: PnsRouterSizes;

  constructor(aParent: UNIT_BINDER_UNITS_PROVIDER, aSizes: PnsRouterSizes) {
    this.m_traceWidth = new UNIT_BINDER(aParent, _('Width:'));
    this.m_traceGap = new UNIT_BINDER(aParent, _('Track gap:'));
    this.m_viaGap = new UNIT_BINDER(aParent, _('Via gap:'));
    this.m_sizes = aSizes;
  }

  TransferDataFromWindow(): boolean {
    if (this.m_traceGap.GetValue() <= 0) {
      this.m_error = { message: _('Track gap must be greater than 0.'), focus: 'gap' };
      return false;
    }

    // Save widgets' values to settings
    this.m_sizes.diffPairGap = this.m_traceGap.GetValue();
    this.m_sizes.diffPairViaGap = this.m_viaGap.GetValue();
    this.m_sizes.diffPairWidth = this.m_traceWidth.GetValue();

    this.m_sizes.diffPairGapSource = _('user choice');
    this.m_sizes.diffPairWidthSource = _('user choice');

    return true;
  }

  TransferDataToWindow(): boolean {
    this.m_traceWidth.SetValue(this.m_sizes.diffPairWidth);
    this.m_traceGap.SetValue(this.m_sizes.diffPairGap);
    this.m_viaGap.SetValue(DiffPairViaGap(this.m_sizes));
    this.m_viaTraceGapEqual = this.m_sizes.diffPairViaGapSameAsTraceGap;
    this.updateCheckbox();

    return true;
  }

  private updateCheckbox(): void {
    this.m_sizes.diffPairViaGapSameAsTraceGap = this.m_viaTraceGapEqual;
    this.m_viaGap.Enable(!this.m_viaTraceGapEqual);
  }

  OnViaTraceGapEqualCheck(): void {
    this.updateCheckbox();
  }
}

/** `ShowModal()` of DIALOG_PNS_DIFF_PAIR_DIMENSIONS: `onClose( true )` is wxID_OK. */
export function DialogPnsDiffPairDimensions({
  dialog,
  onClose,
}: {
  dialog: DIALOG_PNS_DIFF_PAIR_DIMENSIONS;
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<string | null>(null);
  const gapRef = useRef<HTMLInputElement>(null);

  // OnInitDialog -> TransferDataToWindow
  useState(() => dialog.TransferDataToWindow());

  const unit = (aBinder: UNIT_BINDER): UNIT => ({
    value: aBinder.GetText(),
    units: unitLabel(aBinder.GetUnits()),
    enabled: aBinder.IsEnabled(),
    onChange: (aText) => {
      aBinder.SetText(aText);
      bump();
    },
  });

  return (
    <>
      <DIALOG_PNS_DIFF_PAIR_DIMENSIONS_BASE
        m_traceWidth={unit(dialog.m_traceWidth)}
        m_traceGap={{ ...unit(dialog.m_traceGap), inputRef: gapRef }}
        m_viaGap={unit(dialog.m_viaGap)}
        m_viaTraceGapEqual={{
          value: dialog.m_viaTraceGapEqual,
          onChange: (aOn) => {
            dialog.m_viaTraceGapEqual = aOn;
            dialog.OnViaTraceGapEqualCheck();
            bump();
          },
        }}
        onOK={() => {
          if (dialog.TransferDataFromWindow()) onClose(true);
          else {
            setError(dialog.m_error?.message ?? null);
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
            gapRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
