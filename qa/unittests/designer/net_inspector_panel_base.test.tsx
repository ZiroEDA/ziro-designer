// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `NET_INSPECTOR_PANEL`'s constructor widgets and its inline virtual defaults. */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  NET_INSPECTOR_PANEL,
  NetInspectorPanelView,
} from '@ziroeda/pcbnew/widgets/net_inspector_panel.js';

describe('NetInspectorPanelView', () => {
  it('has the Filter search control, the config button, and the list', () => {
    const onSearch = vi.fn();
    const onConfig = vi.fn();
    const { getByPlaceholderText, getByTitle, getByText } = render(
      <NetInspectorPanelView searchText="" onSearchTextChanged={onSearch} onConfigButton={onConfig}>
        <span>nets</span>
      </NetInspectorPanelView>,
    );
    fireEvent.change(getByPlaceholderText('Filter'), { target: { value: 'GND' } });
    expect(onSearch).toHaveBeenCalledWith('GND');
    fireEvent.click(getByTitle('Configure netlist inspector'));
    expect(onConfig).toHaveBeenCalledTimes(1);
    expect(getByText('nets')).toBeTruthy();
  });
});

describe('NET_INSPECTOR_PANEL', () => {
  it('OnLanguageChanged reaches the subclass hook; the other virtuals default to no-ops', () => {
    let n = 0;
    class P extends NET_INSPECTOR_PANEL {
      protected override OnLanguageChangedImpl(): void {
        n++;
      }
      Lang(): void {
        this.OnLanguageChanged();
      }
    }
    const p = new P();
    p.Lang();
    expect(n).toBe(1);
    expect(() => {
      p.OnParentSetupChanged();
      p.SaveSettings();
      p.OnShowPanel();
      p.OnBoardChanged();
    }).not.toThrow();
  });
});
