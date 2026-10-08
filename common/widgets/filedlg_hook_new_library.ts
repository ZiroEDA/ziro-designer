// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILEDLG_HOOK_NEW_LIBRARY` (include/widgets/filedlg_hook_new_library.h): the "Add new library to
 * the global library table" check box a new-library file dialog carries. The window shows it
 * and writes the answer back; `attached` says whether it did.
 */

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

/** `GetUseGlobalTable()`: the box's answer, or the default when the window did not show it. */
export function GetUseGlobalTable(aHook: FILEDLG_HOOK_NEW_LIBRARY): boolean {
  return aHook.useGlobalTable;
}
