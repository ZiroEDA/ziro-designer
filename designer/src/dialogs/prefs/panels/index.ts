// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The generic pages' factory.
 *
 * Upstream these three are not behind a `CreateKiWindow` at all — the base
 * frame constructs `PANEL_COMMON_SETTINGS`, `PANEL_MOUSE_SETTINGS` and the
 * hotkeys panel directly (`common/eda_base_frame.cpp:1573-1599`) because they
 * live in `common/dialogs/` and need no app. We still route them through the
 * same factory shape so the shell has exactly one way to reach a page, and so
 * that adding a generic page and adding an editor page are the same edit.
 */
import { PanelCommonSettings } from './PanelCommonSettings.js';
import { PanelMouseSettings } from './PanelMouseSettings.js';
import { PanelHotkeys } from './PanelHotkeys.js';
import { PanelSpacemouse } from './PanelSpacemouse.js';
import { PanelGitRepos } from './PanelGitRepos.js';
import { PanelMaintenance } from './PanelMaintenance.js';
import { resetCommonPanel, resetMousePanel } from './resets.js';
import type { PrefsPageId, PrefsPanelFactory, PrefsPanelModule } from '../types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'common':
      return { Panel: PanelCommonSettings, reset: resetCommonPanel };

    case 'mouse':
      return { Panel: PanelMouseSettings, reset: resetMousePanel };

    case 'hotkeys':
      return {
        Panel: PanelHotkeys,
        // PANEL_HOTKEYS_EDITOR::ResetPanel -> ResetAllHotkeys( true ): every
        // action back to its DefaultHotkey, which is an empty override map.
        // The overrides are this page's whole slice, so there is nothing to
        // narrow; nothing else in the settings is touched.
        reset: (ctx) => ctx.setHotkeys({}),
        // PANEL_HOTKEYS_EDITOR::GetResetTooltip (include/panel_hotkeys_editor.h:55).
        resetTooltip: 'Reset all hotkeys to the built-in KiCad defaults',
      };

    // The pages upstream draws that nothing here can back. They are not
    // resettable: `RESETTABLE_PANEL::ResetPanel` restores a panel's own
    // settings, and these have none, so the Reset button greys out exactly as
    // it does for a page with nothing of its own.
    case 'spacemouse':
      return { Panel: PanelSpacemouse };

    case 'version-control':
      return { Panel: PanelGitRepos };

    case 'maintenance':
      return { Panel: PanelMaintenance };

    default:
      return null;
  }
};
