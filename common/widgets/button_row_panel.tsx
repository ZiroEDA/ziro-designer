// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BUTTON_ROW_PANEL` (`include/widgets/button_row_panel.h`,
 * `common/widgets/button_row_panel.cpp`): "a panel that contains buttons,
 * arranged on the left and/or right sides", each from a `BTN_DEF` of id,
 * text, tooltip and callback. `PANEL_HOTKEYS_EDITOR::installButtons` is the
 * one user.
 *
 * `addButtons` gives each button `wxTOP | wxBOTTOM` and, of `wxLEFT` /
 * `wxRIGHT`, every side except the row's outer ends, all at
 * `KIUI::GetStdMargin()`; a stretch spacer separates the two groups. The
 * margins are `.ze-button-row` in shell.css.
 */

import type { JSX } from 'react';

/** `BUTTON_ROW_PANEL::BTN_DEF`. */
export interface BTN_DEF {
  /** `m_text`. */
  text: string;
  /** `m_tooltip`. */
  tooltip: string;
  /** `m_callback`. */
  onClick: () => void;
}

export interface ButtonRowPanelProps {
  left?: readonly BTN_DEF[];
  right?: readonly BTN_DEF[];
}

export function ButtonRowPanel({ left = [], right = [] }: ButtonRowPanelProps): JSX.Element {
  const button = (def: BTN_DEF, className: string): JSX.Element => (
    <button
      key={def.text}
      type="button"
      className={`ze-btn${className}`}
      title={def.tooltip}
      onClick={def.onClick}
    >
      {def.text}
    </button>
  );
  return (
    <div className="ze-button-row">
      {left.map((d, i) => button(d, i === 0 ? ' first-left' : ''))}
      <span className="ze-button-row-spacer" />
      {right.map((d, i) => button(d, i === right.length - 1 ? ' last-right' : ''))}
    </div>
  );
}
