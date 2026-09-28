// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_MSG_PANEL`'s *data*, split out of `MsgPanel.tsx`.
 *
 * Same reason as `chooser_types.ts`, `toolbar_types.ts` and `menu_types.ts`:
 * `qa`'s tsconfig compiles `.ts` only, so a test that imports a value from a
 * `.tsx` resolves under vitest and passes, then fails CI's `tsc` with
 * `--jsx is not set`. `msgpanel_metrics.test.ts` reached for
 * `MSG_PANEL_DEFAULT_PAD` and took the whole workspace typecheck down with it —
 * which is why its PR sat red without anyone seeing why.
 *
 * `MsgPanel.tsx` re-exports both, so existing importers are unaffected.
 */

/** One cell of the panel. `EDA_MSG_PANEL::AppendMessage`'s three arguments. */
export interface MsgPanelItem {
  /** `m_UpperText`, the label row. */
  upper: string;
  /** `m_LowerText`, the value row. */
  lower: string;
  /**
   * `m_Padding`, in spaces, appended to the measured text and so part of what
   * separates this cell from the next (`msgpanel.cpp:140`). Defaults to
   * {@link MSG_PANEL_DEFAULT_PAD}; the symbol editor is the one frame that
   * overrides it, passing 8
   * (`eeschema/symbol_editor/symbol_editor.cpp:1749-1767`).
   */
  padding?: number;
}

/**
 * `MSG_PANEL_DEFAULT_PAD` (include/widgets/msgpanel.h:41), "the default number
 * of spaces between each text string". [data] KiCad's own constant.
 */
export const MSG_PANEL_DEFAULT_PAD = 6;
