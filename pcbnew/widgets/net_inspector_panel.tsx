// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NET_INSPECTOR_PANEL` (`pcbnew/widgets/net_inspector_panel.cpp`): the base of
 * the docked net inspector. It owns the frame every net inspector shares: a
 * "Filter" search control, a separator, the "Configure netlist inspector"
 * button, and the data-driven list below them; a subclass
 * (`PCB_NET_INSPECTOR_PANEL`) supplies the list, the search handler and the
 * config popup.
 *
 * {@link NET_INSPECTOR_PANEL} is the class half: the virtuals a subclass
 * overrides (`OnParentSetupChanged`, `SaveSettings`, `OnShowPanel`,
 * `OnBoardChanged`, and the protected UI events, each defaulting as upstream's
 * inline bodies do). {@link NetInspectorPanelView} is the widget half, laid out
 * as the constructor's `wxGridBagSizer`: the search control at (0,0) with
 * `wxEXPAND|wxALIGN_CENTER_VERTICAL|wxTOP|wxBOTTOM|wxRIGHT, 2`, the vertical
 * static line at (0,1) with `wxEXPAND|wxTOP|wxBOTTOM|wxLEFT, 3`, the config
 * button at (0,2) with `wxALIGN_CENTER_VERTICAL|wxLEFT, 3`, and the list at (1,0)
 * spanning three columns; column 0 and row 1 are growable.
 *
 * The header reuses `SEARCH_PANE`'s (the same search-control / separator /
 * bitmap-button row), so the two docked panes look alike as they do in KiCad.
 */

import type { JSX, ReactNode } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';

/** `NET_INSPECTOR_PANEL`'s virtual interface. */
export abstract class NET_INSPECTOR_PANEL {
  /** Rebuild inspector data if project settings updated (stackup, netclass definitions). */
  OnParentSetupChanged(): void {}

  /** Save the net inspector settings - called from EDA_EDIT_FRAME when hiding the panel. */
  SaveSettings(): void {}

  /** Prepare the panel when (re-)shown in the editor. */
  OnShowPanel(): void {}

  /** Notification from file loader when board changed and connectivity rebuilt. */
  OnBoardChanged(): void {}

  protected OnSetFocus(): void {}
  protected OnSize(): void {}
  protected OnSearchTextChanged(_aText: string): void {}
  protected OnConfigButton(): void {}

  /** `OnLanguageChanged`: the two captions are constants here; only the subclass has work. */
  protected OnLanguageChanged(): void {
    this.OnLanguageChangedImpl();
  }

  /** Implementation-specific implementation of language update handling. */
  protected OnLanguageChangedImpl(): void {}
}

interface Props {
  /** `m_searchCtrl`'s text. */
  searchText: string;
  /** `OnSearchTextChanged`. */
  onSearchTextChanged: (aText: string) => void;
  /** `OnConfigButton`. */
  onConfigButton: () => void;
  /** `OnSetFocus`, bound on the panel and on `m_netsList`. */
  onFocus?: () => void;
  /** `m_netsList`: the subclass's data view control. */
  children: ReactNode;
}

export function NetInspectorPanelView({
  searchText,
  onSearchTextChanged,
  onConfigButton,
  onFocus,
  children,
}: Props): JSX.Element {
  return (
    <div
      className="ze-net-inspector-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
      }}
      onFocus={onFocus}
    >
      <div className="ze-search-pane-header">
        <input
          type="text"
          className="ze-search"
          placeholder="Filter"
          value={searchText}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => onSearchTextChanged(e.target.value)}
        />
        <span className="ze-libtree-sep" />
        <button
          type="button"
          className="ze-lp-iconbtn"
          title="Configure netlist inspector"
          onClick={onConfigButton}
        >
          <img src={bitmapUrl('config')} alt="Configure netlist inspector" />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>{children}</div>
    </div>
  );
}
