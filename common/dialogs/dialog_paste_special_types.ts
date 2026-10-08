// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `enum class PASTE_MODE` (include/dialogs/dialog_paste_special.h:33-38), outside the dialog's
 * `.tsx` so the tools that paste can name it.
 */

/** `PASTE_MODE`, in order. */
export const PASTE_MODES = ['UNIQUE_ANNOTATIONS', 'KEEP_ANNOTATIONS', 'REMOVE_ANNOTATIONS'] as const;

export type PasteSpecialMode = (typeof PASTE_MODES)[number];
