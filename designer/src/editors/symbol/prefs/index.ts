// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's Preferences pages, handed to the dialog by id.
 *
 * The `PANEL_SYM_*` half of eeschema's `KIFACE::CreateKiWindow` switch
 * (`eeschema/eeschema.ts`, eeschema.cpp:251-305): the dialog names
 * `PANEL_SYM_EDIT_GRIDS` and this hands it the page the kiface picks. Upstream the same switch answers for
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
import type { PrefsPanelFactory, PrefsPanelModule } from '../../../dialogs/prefs/types.js';
import { FRAME_T, type PrefsPageId } from '@ziroeda/common/frame_type.js';
import { CreateKiWindow, type EESCHEMA_PAGES } from '@ziroeda/eeschema/eeschema.js';

/** The pages, by the class eeschema's `CreateKiWindow` constructs for each. */
const PAGES: EESCHEMA_PAGES<PrefsPanelModule> = {
  PANEL_SYM_DISPLAY_OPTIONS: {
    Panel: PanelSymbolEditorDisplayOptions,
    reset: resetSymbolEditorDisplayOptions,
  },
  PANEL_SYM_GRID_SETTINGS: {
    Panel: PanelSymbolEditorGrids,
    reset: resetSymbolEditorGrids,
  },
  PANEL_SYM_EDITING_OPTIONS: {
    Panel: PanelSymbolEditorEditingOptions,
    reset: resetSymbolEditorEditingOptions,
  },
  // No `reset`: PANEL_SYM_COLOR_SETTINGS_BASE is a plain wxPanel, not a
  // RESETTABLE_PANEL (`eeschema/dialogs/panel_sym_color_settings_base.h`),
  // and PANEL_SYM_COLOR_SETTINGS declares no ResetPanel — unlike every
  // other page under this heading. PAGED_DIALOG::UpdateResetButton
  // therefore greys the button out on it, and omitting `reset` is how that
  // is said here.
  PANEL_SYM_COLOR_SETTINGS: { Panel: PanelSymbolEditorColorSettings },
  PANEL_SYM_TOOLBAR_CUSTOMIZATION: {
    Panel: PanelSymbolEditorToolbars,
    reset: resetSymbolEditorToolbars,
  },
};

/** The Preferences dialog's page ids, as the `PANEL_SYM_*` class ids they name. */
const CLASS_ID: Partial<Record<PrefsPageId, FRAME_T>> = {
  'sym-display': FRAME_T.PANEL_SYM_DISP_OPTIONS,
  'sym-grids': FRAME_T.PANEL_SYM_EDIT_GRIDS,
  'sym-editing': FRAME_T.PANEL_SYM_EDIT_OPTIONS,
  'sym-colors': FRAME_T.PANEL_SYM_COLORS,
  'sym-toolbars': FRAME_T.PANEL_SYM_TOOLBARS,
};

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  const classId = CLASS_ID[id];

  return classId === undefined ? null : CreateKiWindow(classId, PAGES);
};
