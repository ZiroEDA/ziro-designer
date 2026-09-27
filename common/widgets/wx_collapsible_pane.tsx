// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_COLLAPSIBLE_PANE` and `WX_COLLAPSIBLE_PANE_HEADER`
 * (`include/widgets/wx_collapsible_pane.h`, `common/widgets/wx_collapsible_pane.cpp`):
 * KiCad's own collapsible pane - a header drawn as a triangle and a label, and
 * a pane under it shown only while expanded. The appearance panel's "Layer
 * Display Options" and "Net Display Options" are the two.
 *
 * A click on the header, or Space/Enter with it focused, toggles it and posts
 * `WX_COLLAPSIBLE_PANE_CHANGED`. Collapsed state is the owner's (the frames
 * persist it in `m_AuiPanels`), so the widget is controlled.
 *
 * The metrics are the `.ze-collapsepane` / `.ze-collapse-*` rules in shell.css.
 */

import type { JSX, ReactNode } from 'react';

export interface WxCollapsiblePaneProps {
  /** `SetLabel()`: the header's text. */
  label: string;
  /** `IsCollapsed()`. */
  collapsed: boolean;
  /** `WX_COLLAPSIBLE_PANE_CHANGED`, with the new collapsed state. */
  onChange: (aCollapsed: boolean) => void;
  /** `GetPane()`'s contents. */
  children?: ReactNode;
}

export function WxCollapsiblePane({
  label,
  collapsed,
  onChange,
  children,
}: WxCollapsiblePaneProps): JSX.Element {
  return (
    <div className="ze-collapsepane">
      <button
        type="button"
        className="ze-collapse-toggle"
        aria-expanded={!collapsed}
        onClick={() => onChange(!collapsed)}
      >
        <span className={`ze-collapse-arrow${collapsed ? '' : ' open'}`} />
        {label}
      </button>
      {!collapsed && <div className="ze-collapse-body">{children}</div>}
    </div>
  );
}
