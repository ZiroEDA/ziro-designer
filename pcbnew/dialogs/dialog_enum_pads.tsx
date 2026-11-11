// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ENUM_PADS` and `SEQUENTIAL_PAD_ENUMERATION_PARAMS`
 * (pcbnew/dialogs/dialog_enum_pads.cpp / .h): the numbering parameters
 * `PAD_TOOL::EnumeratePads` asks for before its click loop.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { DIALOG_ENUM_PADS_BASE } from './dialog_enum_pads_base.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/**
 * `SEQUENTIAL_PAD_ENUMERATION_PARAMS`.
 *
 * The dialog's widget limits — prefix at most 4 characters, both spin controls
 * 0..999 inclusive — are UI constraints and are deliberately not enforced here,
 * because upstream does not enforce them either. `startNumber` 0 with an empty
 * prefix legitimately produces the pad number "0", and `step` 0 is a legal (and
 * destructive) setting.
 *
 * `prefix` is `std::optional` upstream but only ever distinguishable from `''`
 * before the dialog has been accepted once — `value_or("")` erases the
 * difference everywhere it is read.
 */
export interface SequentialPadEnumerationParams {
  startNumber: number;
  step: number;
  prefix?: string;
}

export const DEFAULT_PAD_ENUMERATION_PARAMS: SequentialPadEnumerationParams = {
  startNumber: 1,
  step: 1,
};

/**
 * `DIALOG_ENUM_PADS_BASE`'s title and labels - the base file states the title
 * as wxFormBuilder's default.
 */
export const DIALOG_ENUM_PADS_TITLE = _HKI('Renumber Pads');

/**
 * `DIALOG_ENUM_PADS` (dialog_enum_pads.cpp): the modal dialog `PAD_TOOL::EnumeratePads`
 * shows for the numbering parameters. `m_params` is the caller's object, written
 * back by `TransferDataFromWindow`.
 *
 * The widgets' limits are the window's, as in the base file: the prefix takes 4
 * characters and each spin control runs 0..999.
 */
export class DIALOG_ENUM_PADS {
  private readonly m_params: SequentialPadEnumerationParams;

  /** `m_padStartNum`, `m_padNumStep`, `m_padPrefix`. */
  m_padStartNum: number;
  m_padNumStep: number;
  m_padPrefix: string;

  constructor(aParams: SequentialPadEnumerationParams) {
    this.m_params = aParams;

    // Transfer data from the params to the dialog
    this.m_padStartNum = aParams.startNumber;
    this.m_padNumStep = aParams.step;
    this.m_padPrefix = aParams.prefix ?? '';
  }

  /** Transfer data from the dialog to the params. */
  TransferDataFromWindow(): boolean {
    this.m_params.startNumber = this.m_padStartNum;
    this.m_params.step = this.m_padNumStep;
    this.m_params.prefix = this.m_padPrefix;

    // No other validation implemented
    return true;
  }
}

/** `ShowModal()` of DIALOG_ENUM_PADS: `onResult( true )` is wxID_OK after TransferDataFromWindow. */
export function DialogEnumPads({
  dialog,
  onResult,
}: {
  dialog: DIALOG_ENUM_PADS;
  onResult: (aOk: boolean) => void;
}): JSX.Element {
  const [, redraw] = useState(0);
  const prefixRef = useRef<HTMLInputElement>(null);

  // `SetInitialFocus( m_padPrefix )`
  useEffect(() => {
    prefixRef.current?.focus();
  }, []);

  const set = (aApply: () => void): void => {
    aApply();
    redraw((n) => n + 1);
  };

  return (
    <DIALOG_ENUM_PADS_BASE
      title={DIALOG_ENUM_PADS_TITLE}
      m_padPrefix={{
        value: dialog.m_padPrefix,
        onChange: (aText) => set(() => (dialog.m_padPrefix = aText)),
      }}
      padPrefixRef={prefixRef}
      m_padStartNum={{
        value: dialog.m_padStartNum,
        onChange: (aValue) => set(() => (dialog.m_padStartNum = aValue)),
      }}
      m_padNumStep={{
        value: dialog.m_padNumStep,
        onChange: (aValue) => set(() => (dialog.m_padNumStep = aValue)),
      }}
      onOK={() => {
        if (dialog.TransferDataFromWindow()) onResult(true);
      }}
      onCancel={() => onResult(false)}
    />
  );
}
