// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK` (eeschema/widgets/symbol_library_save_as_filedlg_hook.h)
 * with `SYMBOL_SAVEAS_TYPE` (eeschema/symbol_editor/symbol_saveas_type.h): the four radio buttons
 * a symbol library's Save As dialog carries - what to do with the library tables. The window draws
 * them (AddCustomControls) and sets the option when the dialog closes
 * (TransferDataFromCustomControls).
 */

import { type JSX, useState } from 'react';
import type { wxFileDialogCustomizeHook } from '@ziroeda/common/widgets/filedlg_hook_new_library.js';
import { RadioButton } from '@ziroeda/wx/controls.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `SYMBOL_SAVEAS_TYPE`. */
export enum SYMBOL_SAVEAS_TYPE {
  NORMAL_SAVE_AS,
  REPLACE_TABLE_ENTRY,
  ADD_GLOBAL_TABLE_ENTRY,
  ADD_PROJECT_TABLE_ENTRY,
}

/** The radio buttons' labels, in AddCustomControls' order. [data] upstream's strings. */
export const SYMBOL_SAVEAS_LABELS: readonly [SYMBOL_SAVEAS_TYPE, string][] = [
  [SYMBOL_SAVEAS_TYPE.NORMAL_SAVE_AS, _HKI('Do not update library tables')],
  [SYMBOL_SAVEAS_TYPE.REPLACE_TABLE_ENTRY, _HKI('Update existing library table entry')],
  [SYMBOL_SAVEAS_TYPE.ADD_GLOBAL_TABLE_ENTRY, _HKI('Add new global library table entry')],
  [SYMBOL_SAVEAS_TYPE.ADD_PROJECT_TABLE_ENTRY, _HKI('Add new project library table entry')],
];

export class SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK implements wxFileDialogCustomizeHook {
  /** Tells the window which hook this is. */
  readonly kind = 'symbolLibrarySaveAs' as const;
  /** The window drew the controls. */
  attached = false;
  private m_option: SYMBOL_SAVEAS_TYPE;

  constructor(aOption: SYMBOL_SAVEAS_TYPE) {
    this.m_option = aOption;
  }

  /** `TransferDataFromCustomControls()`: the radio button chosen. */
  TransferDataFromCustomControls(aOption: SYMBOL_SAVEAS_TYPE): void {
    this.m_option = aOption;
  }

  GetOption(): SYMBOL_SAVEAS_TYPE {
    return this.m_option;
  }
}

/**
 * `AddCustomControls( customizer )`: the four radio buttons, in upstream's order, the hook's option
 * checked. A pick is `TransferDataFromCustomControls`, at once - the option is read only after OK.
 */
export function SymbolLibrarySaveAsControls({
  hook,
}: {
  hook: SYMBOL_LIBRARY_SAVE_AS_FILEDLG_HOOK;
}): JSX.Element {
  hook.attached = true;
  const [option, setOption] = useState(hook.GetOption());

  return (
    <>
      {SYMBOL_SAVEAS_LABELS.map(([value, label]) => (
        <RadioButton
          key={value}
          name="symbol-library-save-as"
          label={label}
          checked={option === value}
          onChange={() => {
            hook.TransferDataFromCustomControls(value);
            setOption(value);
          }}
        />
      ))}
    </>
  );
}
