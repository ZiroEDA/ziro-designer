// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `eeschema/sync_sheet_pin/sync_sheet_pin_preference.h`. */

export const SYNC_SHEET_PIN_PREFERENCE = {
  /** `ICON_SIZE`. */
  NORMAL_WIDTH: 16,
  NORMAL_HEIGHT: 16,

  /** `BOOKCTRL_ICON_INDEX`. */
  HAS_UNMATCHED: 0,
  ALL_MATCHED: 1,

  /**
   * `GetBookctrlPageIcon()`: the notebook's image list, by index. Upstream maps HAS_UNMATCHED to
   * erc_green and ALL_MATCHED to ercwarn - the page with nothing left to match shows the warning
   * icon - and DIALOG_SYNC_SHEET_PINS adds them in that order; kept as written.
   */
  GetBookctrlPageIcon(): ReadonlyMap<number, string> {
    return new Map([
      [0, 'erc_green'],
      [1, 'ercwarn'],
    ]);
  },
} as const;
