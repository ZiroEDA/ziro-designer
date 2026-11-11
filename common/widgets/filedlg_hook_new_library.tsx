// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILEDLG_HOOK_NEW_LIBRARY` (include/widgets/filedlg_hook_new_library.h): the two radio buttons a
 * new-library file dialog carries - which table the new library's row goes in, global or project.
 * The window draws them (`AddCustomControls`) and writes the answer back; `attached` says whether
 * it did.
 */
import { type JSX, useState } from 'react';
import { RadioButton } from '@ziroeda/wx/controls.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `wxFileDialogCustomizeHook`: what every customize hook shares. */
export interface wxFileDialogCustomizeHook {
  attached: boolean;
}

export interface FILEDLG_HOOK_NEW_LIBRARY extends wxFileDialogCustomizeHook {
  kind: 'new_library';
  useGlobalTable: boolean;
}

/** `FILEDLG_HOOK_NEW_LIBRARY( bool aDefaultUseGlobalTable )`. */
export function MakeFileDlgHookNewLibrary(
  aDefaultUseGlobalTable: boolean,
): FILEDLG_HOOK_NEW_LIBRARY {
  return { kind: 'new_library', attached: false, useGlobalTable: aDefaultUseGlobalTable };
}

/** `GetUseGlobalTable()`: the buttons' answer, or the default when the window did not show them. */
export function GetUseGlobalTable(aHook: FILEDLG_HOOK_NEW_LIBRARY): boolean {
  return aHook.useGlobalTable;
}

/**
 * `AddCustomControls( customizer )`: "Add new library to global library table" and "...to project
 * library table", the default checked. A pick is `TransferDataFromCustomControls`, at once - the
 * hook is read only after the dialog's OK.
 */
export function FileDlgHookNewLibraryControls({
  hook,
}: {
  hook: FILEDLG_HOOK_NEW_LIBRARY;
}): JSX.Element {
  hook.attached = true;
  const [global, setGlobal] = useState(hook.useGlobalTable);
  const pick = (aGlobal: boolean): void => {
    hook.useGlobalTable = aGlobal;
    setGlobal(aGlobal);
  };

  return (
    <>
      <RadioButton
        name="filedlg-hook-new-library"
        label={_('Add new library to global library table')}
        checked={global}
        onChange={() => pick(true)}
      />
      <RadioButton
        name="filedlg-hook-new-library"
        label={_('Add new library to project library table')}
        checked={!global}
        onChange={() => pick(false)}
      />
    </>
  );
}
