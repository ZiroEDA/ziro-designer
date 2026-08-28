// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's Preferences pages, handed to the dialog by id.
 *
 * This is pl_editor's `KIFACE::CreateKiWindow` switch
 * (`pagelayout_editor/pl_editor.cpp:61-104`). The dialog names
 * `PANEL_DS_DISPLAY_OPTIONS`, `PANEL_DS_GRIDS`, `PANEL_DS_COLORS` and
 * `PANEL_DS_TOOLBARS`; this returns a panel for the first three. The fourth is
 * declared absent in `dialogs/prefs/registry.ts`' `OMITTED_PAGES`, with the
 * reason, rather than silently missing.
 *
 * Two of the three panels are shared code: Display Options is
 * `PANEL_GAL_OPTIONS` and Grids *is* `PANEL_GRID_SETTINGS`, both of which live
 * in `dialogs/prefs/` — our `common/` — and are the same components the
 * schematic's pages use. This file is only the wiring, which is all the C++
 * switch is too.
 */
import { PanelPlEditorColorSettings } from './PanelPlEditorColorSettings.js';
import { PanelPlEditorDisplayOptions } from './PanelPlEditorDisplayOptions.js';
import { PanelPlEditorGrids } from './PanelPlEditorGrids.js';
import {
  resetPlEditorColorSettings,
  resetPlEditorDisplayOptions,
  resetPlEditorGrids,
  resetPlEditorToolbars,
} from './resets.js';
import { PanelPlEditorToolbars } from './PanelPlEditorToolbars.js';
import type {
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'ds-display':
      return {
        Panel: PanelPlEditorDisplayOptions,
        reset: resetPlEditorDisplayOptions,
      };

    case 'ds-grids':
      return {
        Panel: PanelPlEditorGrids,
        reset: resetPlEditorGrids,
      };

    case 'ds-colors':
      // No `resetTooltip`: `PANEL_PL_EDITOR_COLOR_SETTINGS` derives from
      // `RESETTABLE_PANEL` directly, not from `PANEL_COLOR_SETTINGS`, so it does
      // not carry that class's "Reset all colors in this theme…" override and
      // gets `DEFAULT_RESET_TOOLTIP`.
      return {
        Panel: PanelPlEditorColorSettings,
        reset: resetPlEditorColorSettings,
      };

    case 'ds-toolbars':
      return {
        Panel: PanelPlEditorToolbars,
        reset: resetPlEditorToolbars,
      };

    default:
      return null;
  }
};
