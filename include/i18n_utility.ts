// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/i18n_utility.h`.
 *
 * KiCad's comment, which is the whole contract: a define to allow translation
 * of strings which must be stored in English - for instance because they are
 * used both as keywords and as messages in dialogs. `_()` (wx's
 * `wxGetTranslation`) cannot be used for them, because the English string is
 * what goes in the configuration; the translated string is used only when it
 * is displayed. Translation tools extract both the `_` and the `_HKI` prefix.
 *
 * So `_HKI` translates nothing. It marks a string as a message, stored in
 * English, and whatever draws it calls `wxGetTranslation()` on the way out -
 * a `TOOL_ACTION`'s friendly name, an `RC_ITEM`'s title, a property's name.
 * That is also what keeps a table built once at module load from freezing in
 * the language it was built in.
 */

/** `#define _HKI( x ) wxT( x )`. */
export const _HKI = (aStr: string): string => aStr;
