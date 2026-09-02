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
import { PanelSymbolEditorGrids } from './PanelSymbolEditorGrids.js';
import { PanelSymbolEditorToolbars } from './PanelSymbolEditorToolbars.js';
import { resetSymbolEditorGrids, resetSymbolEditorToolbars } from './resets.js';
import type {
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'sym-grids':
      return {
        Panel: PanelSymbolEditorGrids,
        reset: resetSymbolEditorGrids,
      };

    case 'sym-toolbars':
      return {
        Panel: PanelSymbolEditorToolbars,
        reset: resetSymbolEditorToolbars,
      };

    default:
      return null;
  }
};
