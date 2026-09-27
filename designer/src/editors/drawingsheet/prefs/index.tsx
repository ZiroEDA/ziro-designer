// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The seam between the app's Preferences dialog and pl_editor's pages: the
 * dialog's page ids to `PANEL_DS_*`, and its working copies to the
 * `PL_PREFS_CONTEXT` pl_editor's `CreateKiWindow` builds each page over.
 * The pages are `pagelayout_editor/`'s.
 */
import type { JSX } from 'react';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import {
  CreateKiWindow,
  type PL_PREFS_CONTEXT,
  type PL_PREFS_PANEL,
} from '@ziroeda/pagelayout_editor/pl_editor.js';
import type {
  PrefsContext,
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';
import { usePcmVersion } from '../../../pcm/pcmStore.js';
import { colorSettingsList } from '../../../prefs/color_settings_list.js';
import { catalogueFor, ourToolbarId } from '../../../ui/action_catalogue.js';

const CLASS_ID: Partial<Record<PrefsPageId, FRAME_T>> = {
  'ds-display': FRAME_T.PANEL_DS_DISPLAY_OPTIONS,
  'ds-grids': FRAME_T.PANEL_DS_GRIDS,
  'ds-colors': FRAME_T.PANEL_DS_COLORS,
  'ds-toolbars': FRAME_T.PANEL_DS_TOOLBARS,
};

export function plEditorPrefsContext(aCtx: PrefsContext): PL_PREFS_CONTEXT {
  return {
    plEditor: aCtx.plEditor,
    upPl: aCtx.upPl,
    // Read when a page asks, not when the context is made.
    get installedThemes() {
      return colorSettingsList();
    },
    get toolbars() {
      return aCtx.toolbars.pl_editor;
    },
    upTb: (fn) => aCtx.upTb('pl_editor', fn),
    get availableTools() {
      return catalogueFor('pl_editor');
    },
    toolbarIdOf: ourToolbarId,
  };
}

function adapt(aPage: PL_PREFS_PANEL): PrefsPanelModule {
  function Panel({ ctx }: { ctx: PrefsContext }): JSX.Element {
    // Re-render when a PCM theme is installed: the theme list is read here.
    usePcmVersion();
    return <aPage.Panel ctx={plEditorPrefsContext(ctx)} />;
  }

  return {
    Panel,
    reset: (ctx) => aPage.reset(plEditorPrefsContext(ctx)),
    ...(aPage.resetTooltip !== undefined ? { resetTooltip: aPage.resetTooltip } : {}),
  };
}

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  const classId = CLASS_ID[id];

  if (classId === undefined) return null;

  const page = CreateKiWindow(classId);

  return page ? adapt(page) : null;
};
