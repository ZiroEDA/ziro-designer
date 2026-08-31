// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences opens on the page the caller named.
 *
 * `EDA_BASE_FRAME::ShowPreferences( aStartPage, aStartParentPage )`
 * (`common/eda_base_frame.cpp:1585`) takes the start page as an argument, and
 * for one caller the argument is the entire action:
 *
 *     int COMMON_TOOLS::GridProperties( const TOOL_EVENT& aEvent )
 *     {
 *         auto showGridPrefs = [this]( const wxString& aParentName ) { ...
 *                     m_frame->ShowPreferences( _( "Grids" ), aParentName ); ... };
 *         switch( m_frame->GetFrameType() ) {
 *         case FRAME_SCH: showGridPrefs( _( "Schematic Editor" ) ); break;
 *
 * (`common/tool/common_tools.cpp:609-634`). "Edit Grids...", the one row of the
 * Show Grid button's toolbar context menu, does nothing else at all — so a
 * dialog that ignored the argument and opened at Common would not be that
 * action, however correct the menu above it looked.
 *
 * Rendered rather than grepped: the start page is state, and a source check
 * cannot tell an argument that is threaded into `useState` from one that is
 * accepted and dropped.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { FIRST_PAGE, PAGES, labelOf } from '@ziroeda/designer/src/dialogs/prefs/registry.js';

afterEach(cleanup);

/** The tree row the dialog has selected, by the class the shell marks it with. */
// `.ze-tree-item`, not a Preferences-only class: the dialog draws the SAME
// tree Board Setup and Schematic Setup do, because upstream all three are
// PAGED_DIALOGs over one wxTreebook. The old `.ze-prefs-page` was the second
// copy's markup.
const selectedRow = (): string | null =>
  document.querySelector('.ze-tree-item.active')?.textContent ?? null;

describe('PreferencesDialog initialPage', () => {
  it('opens where the caller asked', () => {
    render(<PreferencesDialog onClose={() => {}} initialPage="sch-grids" />);
    expect(selectedRow()).toBe('Grids');
    // And that really is a different page from the default, so the assertion
    // is not passing by coincidence.
    expect(labelOf(FIRST_PAGE)).not.toBe('Grids');
  });

  it('opens on the first page when nobody asks', () => {
    render(<PreferencesDialog onClose={() => {}} />);
    expect(selectedRow()).toBe(labelOf(FIRST_PAGE));
  });

  it('selects exactly one row', () => {
    render(<PreferencesDialog onClose={() => {}} initialPage="sch-grids" />);
    expect(document.querySelectorAll('.ze-tree-item.active')).toHaveLength(1);
    // Two pages are labelled "Display Options" in the book already, which is why
    // ours names a page by id where upstream names it by label and parent label.
    const labels = PAGES.map((p) => p.label);
    expect(labels.filter((l) => l === 'Display Options').length).toBeGreaterThan(1);
  });
});
