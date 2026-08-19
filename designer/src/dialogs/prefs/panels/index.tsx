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
import { PanelCommonSettings, resetCommonPanel } from './PanelCommonSettings.js';
import { PanelMouseSettings, resetMousePanel } from './PanelMouseSettings.js';
import { PanelHotkeysEditor } from './PanelHotkeysEditor.js';
import type { PrefsPageId, PrefsPanelFactory, PrefsPanelModule } from '../types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'common':
      return { Panel: ({ ctx }) => <PanelCommonSettings ctx={ctx} />, reset: resetCommonPanel };

    case 'mouse':
      return { Panel: ({ ctx }) => <PanelMouseSettings ctx={ctx} />, reset: resetMousePanel };

    case 'hotkeys':
      return {
        Panel: ({ ctx }) => (
          <PanelHotkeysEditor overrides={ctx.hotkeys} onChange={ctx.setHotkeys} />
        ),
        // PANEL_HOTKEYS_EDITOR::ResetPanel -> ResetAllHotkeys( true ): every
        // action back to its DefaultHotkey, which is an empty override map.
        reset: (ctx) => ctx.setHotkeys({}),
      };

    default:
      return null;
  }
};
