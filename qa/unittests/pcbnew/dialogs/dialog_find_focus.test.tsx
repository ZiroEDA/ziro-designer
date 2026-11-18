// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * PCB Find opens with the search box focused (DIALOG_FIND::Show: m_searchCombo->SetFocus()).
 *
 * Reported (uartbridge, U-11): typing "J1" + Enter straight after Ctrl+F did nothing. The combo
 * asked for focus with `autoFocus` while DialogShim still held the window hidden for placement, and
 * a browser does not focus a hidden element - `hiddenTakesNoFocus` makes the test environment
 * refuse it the same way, which happy-dom alone does not.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DIALOG_FIND_BASE } from '@ziroeda/pcbnew/dialogs/dialog_find_base.js';
import { hiddenTakesNoFocus } from '../../common/support/hidden_takes_no_focus.js';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  cleanup();
});

const check = () => ({ value: false, onChange: () => {} });

describe('PCB Find', () => {
  it('gives the focus to the search box once it is shown', () => {
    restore = hiddenTakesNoFocus();
    render(
      <DIALOG_FIND_BASE
        m_searchCombo={{ value: '', history: [], onChange: () => {} }}
        onTextEnter={() => {}}
        m_matchCase={check()}
        m_matchWords={check()}
        m_wildcards={check()}
        m_wrap={check()}
        m_includeReferences={check()}
        m_includeMarkers={check()}
        m_includeValues={check()}
        m_includeNets={check()}
        m_checkAllFields={check()}
        m_includeTexts={check()}
        onFindNextClick={() => {}}
        onFindPreviousClick={() => {}}
        onSearchAgainClick={() => {}}
        OnCloseButtonClick={() => {}}
        m_status=""
        searchPanelLinkLabel=""
        onShowSearchPanel={() => {}}
        onCharHook={() => {}}
        {...({} as Record<string, never>)}
      />,
    );
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Search for');
  });
});
