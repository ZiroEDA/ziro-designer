// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB Editor's Preferences pages, handed to the dialog by id.
 *
 * This is pcbnew's `KIFACE::CreateKiWindow` switch (`pcbnew/pcbnew.cpp:306-485`).
 * The dialog names `PANEL_PCB_DISPLAY_OPTS` and this returns a fresh panel for
 * it; the dialog does not know this file exists beyond the dynamic import in
 * `dialogs/prefs/registry.ts`, and nothing here may reach into another editor.
 *
 * Six more pages belong here (Grids, Origins & Axes, Editing Options, Colors,
 * Toolbars, Plugins) and four more groups belong in Display Options. They were
 * blocked on this split; they are not part of it.
 */
import { PanelPcbDisplayOptions } from './PanelPcbDisplayOptions.js';
import { resetPcbDisplayOptions, resetPcbToolbars } from './resets.js';
import { PanelPcbToolbars } from './PanelPcbToolbars.js';
import type {
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'pcb-display':
      return {
        Panel: PanelPcbDisplayOptions,
        reset: resetPcbDisplayOptions,
      };

    case 'pcb-toolbars':
      return {
        Panel: PanelPcbToolbars,
        reset: resetPcbToolbars,
      };

    default:
      return null;
  }
};
