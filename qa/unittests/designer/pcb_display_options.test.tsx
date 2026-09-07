// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Display Options — `PANEL_DISPLAY_OPTIONS` with
 * `m_optionsBook` on page 1 (`pcbnew/dialogs/panel_display_options.cpp:46`).
 *
 * The page shipped as the Cross-probing group alone: five checkboxes where
 * KiCad draws two columns and fourteen controls. This is the whole of what the
 * `_base.cpp` puts on it, and — the half a screenshot cannot check — that each
 * control moves a key something OUTSIDE the dialog reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { resetPrefsPanelCache } from '@ziroeda/designer/src/dialogs/prefs/lazy_pages.js';
import {
  PCBNEW_DEFAULTS,
  PCB_DISPLAY_DEFAULTS,
  settings,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  NET_NAMES_CHOICES,
  TRACK_CLEARANCE_CHOICES,
} from '@ziroeda/designer/src/dialogs/prefs/DisplayOptionsGroups.js';
import {
  crosshairToggleId,
  foldPcbToggle,
  isStoredPcbToggle,
  pcbTogglesFromSettings,
} from '@ziroeda/designer/src/editors/pcb/toggles.js';

const SLOW = 60000;

afterEach(() => {
  cleanup();
  resetPrefsPanelCache();
  settings.updatePcbnew((s) => {
    s.pcb_display = { ...PCB_DISPLAY_DEFAULTS };
    s.window.grid = structuredClone(PCBNEW_DEFAULTS.window.grid);
    s.window.cursor = { ...PCBNEW_DEFAULTS.window.cursor };
  });
});

async function openPage(): Promise<void> {
  render(<PreferencesDialog onClose={() => {}} initialPage="pcb-display" />);
  await screen.findByText('Cross-probing', { exact: false }, { timeout: 30000 });
}

const panelText = (): string =>
  document.querySelector('.ze-prefs-panel')?.textContent?.replace(/\s+/g, ' ') ?? '';

describe('the page is both columns, not the Cross-probing group alone', () => {
  it(
    'draws every group `_base.cpp` puts on the PCB page',
    async () => {
      await openPage();
      const text = panelText();
      // `bSizer11` — PANEL_GAL_OPTIONS, then bSizerPads.
      for (const t of ['Grid Display', 'Cursor', 'Pads', 'Clearance Outlines'])
        expect(text, t).toContain(t);
      // `m_optionsBook`'s page 1, which the footprint editor does NOT get.
      for (const t of ['Annotations', 'Selection & Highlighting', 'Cross-probing'])
        expect(text, t).toContain(t);
    },
    SLOW,
  );

  it(
    'carries the six controls the book adds, `m_live3Drefresh` included',
    async () => {
      await openPage();
      const text = panelText();
      expect(text).toContain('Net names:');
      expect(text).toContain('Show pad numbers');
      expect(text).toContain('Show all fields when parent footprint is selected');
      // `bSizer8`'s sixth child — it shares the Cross-probing sizer and is not
      // a cross-probe setting, which is why it is the call site's and not
      // `CrossProbingGroup`'s.
      expect(text).toContain('Refresh 3D view automatically');
    },
    SLOW,
  );

  it(
    'is two columns, as `bupperSizer` is horizontal',
    async () => {
      await openPage();
      const cols = document.querySelectorAll('.ze-display-opts > .ze-display-opts-col');
      expect(cols).toHaveLength(2);
      // The GAL panel is in the LEFT one and the book in the right.
      expect(cols[0]?.textContent).toContain('Grid Display');
      expect(cols[0]?.textContent).not.toContain('Cross-probing');
      expect(cols[1]?.textContent).toContain('Cross-probing');
      expect(cols[1]?.textContent).not.toContain('Grid Display');
    },
    SLOW,
  );
});

describe('the choices are KiCad’s, in KiCad’s order', () => {
  it('Net names is the selection index itself', () => {
    // `SetSelection( aCfg->m_Display.m_NetNames )` with no map
    // (`panel_display_options.cpp:64`).
    expect(NET_NAMES_CHOICES.map((c) => c[1])).toEqual([
      'Do not show',
      'Show on pads',
      'Show on tracks',
      'Show on pads & tracks',
    ]);
    expect(NET_NAMES_CHOICES.map((c) => c[0])).toEqual([0, 1, 2, 3]);
  });

  it('Tracks: clearance is the TRACK_CLEARANCE_MODE enum, which happens to be identity', () => {
    // `clearanceModeMap` (`panel_display_options.cpp:29-36`) against the enum
    // at `pcbnew/pcbnew_settings.h:85-92`. If either order ever moves, this is
    // where it stops being an assumption.
    expect(TRACK_CLEARANCE_CHOICES.map((c) => c[0])).toEqual([0, 1, 2, 3, 4]);
    expect(TRACK_CLEARANCE_CHOICES[2]?.[1]).toBe('Show when routing w/ via clearance at end');
    // …and the DEFAULT is that third row, not the first.
    expect(PCB_DISPLAY_DEFAULTS.track_clearance_mode).toBe(2);
  });

  it('ships `pcbnew_settings.cpp`’s own defaults', () => {
    expect(PCB_DISPLAY_DEFAULTS).toEqual({
      net_names_mode: 3,
      pad_numbers: true,
      track_clearance_mode: 2,
      pad_clearance: true,
      // The two that are FALSE — a page that defaulted these on would show a
      // board KiCad does not.
      pad_use_via_color_for_normal_th_padstacks: false,
      force_show_fields_when_fp_selected: true,
      live_3d_refresh: false,
      // …and the seven keys of this block that OTHER pages edit: `pcb_display`
      // is one JSON object and three panels write into it.
      origin_mode: 0,
      origin_invert_x_axis: false,
      origin_invert_y_axis: false,
      ratsnest_footprint: true,
      ratsnest_curved: false,
      ratsnest_thickness: 0.5,
      show_page_borders: true,
    });
  });
});

describe('a click reaches pcbnew.json', () => {
  it(
    'stores Show pad numbers, which nothing on this page did before',
    async () => {
      await openPage();
      fireEvent.click(screen.getByLabelText('Show pad numbers'));
      fireEvent.click(screen.getByText('OK'));
      expect(settings.pcbnew.pcb_display.pad_numbers).toBe(false);
    },
    SLOW,
  );

  it(
    'stores the Cursor group, which the canvas reads for its crosshair',
    async () => {
      await openPage();
      fireEvent.click(screen.getByLabelText('Always show crosshairs'));
      fireEvent.click(screen.getByText('OK'));
      expect(settings.pcbnew.window.cursor.always_show_cursor).toBe(false);
    },
    SLOW,
  );
});

describe('the left toolbar and this page are one value', () => {
  it('boots the toggle set from the file rather than from a literal', () => {
    const cfg = structuredClone(PCBNEW_DEFAULTS);
    expect(pcbTogglesFromSettings(cfg).has('crosshairSmall')).toBe(true);
    expect(pcbTogglesFromSettings(cfg).has('toggleGrid')).toBe(true);

    cfg.window.cursor.crosshair = '45';
    cfg.window.grid.show = false;
    const t = pcbTogglesFromSettings(cfg);
    expect(t.has('crosshair45')).toBe(true);
    expect(t.has('crosshairSmall')).toBe(false);
    expect(t.has('toggleGrid')).toBe(false);
    // …and nothing else moved.
    expect(t.has('lineModeFree')).toBe(true);
  });

  it('folds a toolbar click back into the file, and only for the four ids', () => {
    const cfg = structuredClone(PCBNEW_DEFAULTS);
    expect(foldPcbToggle(cfg, 'crosshairFull')).toBe(true);
    expect(cfg.window.cursor.crosshair).toBe('full');
    expect(foldPcbToggle(cfg, 'toggleGrid')).toBe(true);
    expect(cfg.window.grid.show).toBe(false);
    // A toggle with no stored value must not touch the file at all.
    const before = JSON.stringify(cfg);
    expect(foldPcbToggle(cfg, 'zoneDisplayOutline')).toBe(false);
    expect(JSON.stringify(cfg)).toBe(before);
    expect(isStoredPcbToggle('zoneDisplayOutline')).toBe(false);
    expect(isStoredPcbToggle('crosshair45')).toBe(true);
  });

  it('round-trips every crosshair mode through the button id', () => {
    for (const mode of ['small', 'full', '45'] as const) {
      const cfg = structuredClone(PCBNEW_DEFAULTS);
      cfg.window.cursor.crosshair = mode;
      expect(pcbTogglesFromSettings(cfg).has(crosshairToggleId(mode))).toBe(true);
    }
  });
});
