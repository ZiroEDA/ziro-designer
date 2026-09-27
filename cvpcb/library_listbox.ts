// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `cvpcb/library_listbox.cpp` (`LIBRARY_LISTBOX`).
 */

import { PINNING_SYMBOL } from '@ziroeda/common/lib_tree_model_adapter.js';

/**
 * `LIBRARY_LISTBOX::GetSelectedLibrary` (library_listbox.cpp:63-77) — the
 * nickname a row stands for, with the leading blank and the pinning mark taken
 * back off.
 */
export function selectedLibraryOf(row: string | undefined): string {
  if (!row) return '';
  const name = row.replace(/^\s+/, '');
  return name.startsWith(PINNING_SYMBOL) ? name.slice(PINNING_SYMBOL.length) : name;
}
