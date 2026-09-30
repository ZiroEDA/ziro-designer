// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PANEL_DISPLAY_OPTIONS (panel_display_options.cpp): the shared Pads / Clearance
 * Outlines groups (`bSizerPads`, `_base.cpp:31-77`) and what each page writes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  NET_NAMES_CHOICES,
  PanelFpDisplayOptions,
  TRACK_CLEARANCE_CHOICES,
} from '@ziroeda/pcbnew/dialogs/panel_display_options.js';

afterEach(cleanup);

describe('PANEL_DISPLAY_OPTIONS choices, verbatim from the _base.cpp', () => {
  it('Clearance Outlines > Tracks (m_OptDisplayTracksClearanceChoices, :64-66)', () => {
    expect(TRACK_CLEARANCE_CHOICES.map((c) => c[1])).toEqual([
      'Do not show clearances',
      'Show when routing',
      'Show when routing w/ via clearance at end',
      'Show when routing and editing',
      'Show always',
    ]);
  });

  it('Net names (m_ShowNetNamesOptionChoices, :123-124)', () => {
    expect(NET_NAMES_CHOICES.map((c) => c[1])).toEqual([
      'Do not show',
      'Show on pads',
      'Show on tracks',
      'Show on pads & tracks',
    ]);
  });
});

describe('PANEL_DISPLAY_OPTIONS pages', () => {
  it('the footprint page keeps Pads and Clearance in local state, never in the settings', () => {
    const win = {
      grid: { style: 'dots', snap: 0, line_width: 1, min_spacing: 10 },
      cursor: { crosshair: 'small', always_show_cursor: false },
    };
    let written = 0;
    render(
      <PanelFpDisplayOptions
        ctx={{
          fpEdit: { window: win as never },
          upFp: () => {
            written++;
          },
        }}
      />,
    );
    const pads = screen.getByLabelText('Show pad clearance') as HTMLInputElement;
    fireEvent.click(pads);
    expect(pads.checked).toBe(true);
    // `FOOTPRINT_EDITOR_SETTINGS` registers no param for the three: a click
    // does not reach `upFp` (panel_display_options.cpp:54-70, :89-108 are all
    // inside `if( m_isPCBEdit )`).
    expect(written).toBe(0);
  });
});
