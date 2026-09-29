// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Gerber Viewer's Preferences pages, handed to the dialog by id.
 *
 * The pages and the switch are gerbview's own - `CreateKiWindow` in
 * `gerbview/gerbview.ts`, `gerbview/gerbview.cpp:69-115` upstream - over
 * `GBR_PREFS_CONTEXT`. What is left here is the seam to the app's Preferences
 * dialog: its page ids to KiCad's `PANEL_GBR_*`, and its working copies to that
 * context, with the two lists only the app holds - the installed colour themes
 * (re-read when a PCM theme is installed) and the action catalogue.
 */
import type { JSX } from 'react';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import {
  CreateKiWindow,
  type GBR_PREFS_CONTEXT,
  type GBR_PREFS_PANEL,
} from '@ziroeda/gerbview/gerbview.js';
import { usePcmVersion } from '../../../pcm/pcmStore.js';
import { colorSettingsList } from '../../../prefs/color_settings_list.js';
import { catalogueFor, ourToolbarId } from '../../../ui/action_catalogue.js';
import type {
  PrefsContext,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';
import type { PrefsPageId } from '@ziroeda/common/frame_type.js';

/** The dialog's page ids, as the KIFACE knows them. */
const CLASS_ID: Partial<Record<PrefsPageId, FRAME_T>> = {
  'gbr-display': FRAME_T.PANEL_GBR_DISPLAY_OPTIONS,
  'gbr-colors': FRAME_T.PANEL_GBR_COLORS,
  'gbr-grids': FRAME_T.PANEL_GBR_GRIDS,
  'gbr-toolbars': FRAME_T.PANEL_GBR_TOOLBARS,
  'gbr-excellon': FRAME_T.PANEL_GBR_EXCELLON_OPTIONS,
};

/** The dialog's working copies as gerbview's pages read them. */
export function gerbviewPrefsContext(aCtx: PrefsContext): GBR_PREFS_CONTEXT {
  return {
    gerbview: aCtx.gerbview,
    upGbr: aCtx.upGbr,
    userColors: aCtx.userColors,
    setUserColors: aCtx.setUserColors,
    // Read when a page asks, not when the context is made: a page reads only
    // what it needs, as upstream's panels do.
    get installedThemes() {
      return colorSettingsList();
    },
    get toolbars() {
      return aCtx.toolbars.gerbview;
    },
    upTb: (fn) => aCtx.upTb('gerbview', fn),
    get availableTools() {
      return catalogueFor('gerbview');
    },
    toolbarIdOf: ourToolbarId,
  };
}

function adapt(aPage: GBR_PREFS_PANEL): PrefsPanelModule {
  function Panel({ ctx }: { ctx: PrefsContext }): JSX.Element {
    // Re-render when a PCM theme is installed: the theme list is read here.
    usePcmVersion();
    return <aPage.Panel ctx={gerbviewPrefsContext(ctx)} />;
  }

  return {
    Panel,
    reset: (ctx) => aPage.reset(gerbviewPrefsContext(ctx)),
    ...(aPage.resetTooltip !== undefined ? { resetTooltip: aPage.resetTooltip } : {}),
  };
}

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  const classId = CLASS_ID[id];

  if (classId === undefined) return null;

  const page = CreateKiWindow(classId);

  return page ? adapt(page) : null;
};
