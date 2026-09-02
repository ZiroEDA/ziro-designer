// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's Preferences pages, handed to the dialog by id.
 *
 * This is the `PANEL_SYM_*` half of eeschema's `KIFACE::CreateKiWindow` switch
 * (`eeschema/eeschema.cpp:251-305`): the dialog names `PANEL_SYM_EDIT_GRIDS`
 * and this returns a fresh panel for it. Upstream the same switch answers for
 * the schematic's pages too, because one KIFACE serves both frames; here they
 * are two factories because here they are two lazily-loaded bundles. See
 * `dialogs/prefs/lazy_pages.ts`.
 *
 * The dialog does not know this file exists beyond that dynamic import, and
 * nothing here may reach into another editor.
 */
import { PanelSymbolEditorColorSettings } from './PanelSymbolEditorColorSettings.js';
import { PanelSymbolEditorDisplayOptions } from './PanelSymbolEditorDisplayOptions.js';
import { PanelSymbolEditorEditingOptions } from './PanelSymbolEditorEditingOptions.js';
import { PanelSymbolEditorGrids } from './PanelSymbolEditorGrids.js';
import { PanelSymbolEditorToolbars } from './PanelSymbolEditorToolbars.js';
import {
  resetSymbolEditorDisplayOptions,
  resetSymbolEditorEditingOptions,
  resetSymbolEditorGrids,
  resetSymbolEditorToolbars,
} from './resets.js';
import type {
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'sym-display':
      return {
        Panel: PanelSymbolEditorDisplayOptions,
        reset: resetSymbolEditorDisplayOptions,
      };

    case 'sym-grids':
      return {
        Panel: PanelSymbolEditorGrids,
        reset: resetSymbolEditorGrids,
      };

    case 'sym-editing':
      return {
        Panel: PanelSymbolEditorEditingOptions,
        reset: resetSymbolEditorEditingOptions,
      };

    case 'sym-colors':
      // No `reset`: PANEL_SYM_COLOR_SETTINGS_BASE is a plain wxPanel, not a
      // RESETTABLE_PANEL (`eeschema/dialogs/panel_sym_color_settings_base.h`),
      // and PANEL_SYM_COLOR_SETTINGS declares no ResetPanel — unlike every
      // other page under this heading. PAGED_DIALOG::UpdateResetButton
      // therefore greys the button out on it, and omitting `reset` is how that
      // is said here.
      return { Panel: PanelSymbolEditorColorSettings };

    case 'sym-toolbars':
      return {
        Panel: PanelSymbolEditorToolbars,
        reset: resetSymbolEditorToolbars,
      };

    default:
      return null;
  }
};
