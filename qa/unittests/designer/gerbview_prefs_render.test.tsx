// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber Viewer's five Preferences pages, opened in the real Preferences
 * dialog: the dialog asks the owner's factory (designer's seam), which asks
 * gerbview's CreateKiWindow, which builds the page from gerbview/dialogs/ or
 * common's shared panel. Each page is found by a control only it draws, so a
 * page that failed to load, or loaded another page, fails here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import type { PrefsPageId } from '@ziroeda/designer/src/dialogs/prefs/types.js';

afterEach(cleanup);

describe('the Gerber Viewer pages open in the dialog', () => {
  it.each<[PrefsPageId, string | RegExp]>([
    // PANEL_GERBVIEW_DISPLAY_OPTIONS' "Drawing Mode" group.
    ['gbr-display', 'Sketch lines'],
    // PANEL_GERBVIEW_EXCELLON_SETTINGS: the unit radio box's label.
    ['gbr-excellon', /Coordinates/],
    // PANEL_GRID_SETTINGS: its Fast Grid Switching group.
    ['gbr-grids', /Fast Grid/],
    // PANEL_GERBVIEW_COLOR_SETTINGS: the first graphic layer's swatch row.
    ['gbr-colors', /Graphic layer 1$/i],
  ])(
    '%s',
    async (aPage, aProbe) => {
      render(<PreferencesDialog onClose={() => {}} initialPage={aPage} />);

      // The first page opened loads gerbview's module graph, lazily as the
      // dialog does, which takes seconds under vitest.
      expect((await screen.findAllByText(aProbe, {}, { timeout: 20000 })).length).toBeGreaterThan(
        0,
      );
    },
    30000,
  );
});
