// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber Viewer's Preferences pages, handed to the dialog by id.
 *
 * This is gerbview's `KIFACE::CreateKiWindow` switch
 * (`gerbview/gerbview.cpp:69-115`): the dialog names
 * `PANEL_GBR_DISPLAY_OPTIONS` and this returns a fresh panel for it. The dialog
 * does not know this file exists beyond the dynamic import in
 * `dialogs/prefs/lazy_pages.ts`, and nothing here may reach into another
 * editor.
 *
 * Two of the five upstream panels are shared code — Toolbars *is*
 * `PANEL_TOOLBAR_CUSTOMIZATION` and Grids *is* `PANEL_GRID_SETTINGS`, both in
 * `dialogs/prefs/`, our `common/` — and Display Options embeds the shared
 * `PANEL_GAL_OPTIONS`. What is left is the wiring, which is all the C++ switch
 * is too.
 *
 * The pages not yet here are declared in `dialogs/prefs/registry.ts`'
 * `OMITTED_PAGES`, with a reason each, rather than silently missing.
 */
import { PanelGerbviewDisplayOptions } from './PanelGerbviewDisplayOptions.js';
import { PanelGerbviewToolbars } from './PanelGerbviewToolbars.js';
import { resetGerbviewDisplayOptions, resetGerbviewToolbars } from './resets.js';
import type {
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'gbr-display':
      return {
        Panel: PanelGerbviewDisplayOptions,
        reset: resetGerbviewDisplayOptions,
      };

    case 'gbr-toolbars':
      return {
        Panel: PanelGerbviewToolbars,
        reset: resetGerbviewToolbars,
      };

    default:
      return null;
  }
};
