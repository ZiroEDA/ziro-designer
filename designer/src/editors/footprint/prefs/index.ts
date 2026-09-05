// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor's Preferences pages, handed to the dialog by id.
 *
 * Upstream these come out of pcbnew's `KIFACE::CreateKiWindow`, the same switch
 * the board editor's do (`pcbnew/pcbnew.cpp:306-485`). They are a factory of
 * their own here for the reason the Symbol Editor's are: this editor is its own
 * bundle, and routing the page through `editors/pcb` would pull the whole board
 * editor into the dialog for a footprint-editor user.
 *
 * Editing Options, Colors, Footprint Defaults, Graphics Defaults and User Layer
 * Names still belong here.
 */
import { PanelFpDisplayOptions } from './PanelFpDisplayOptions.js';
import { PanelFpGrids } from './PanelFpGrids.js';
import { PanelFpOriginsAxes } from './PanelFpOriginsAxes.js';
import { PanelFpToolbars } from './PanelFpToolbars.js';
import {
  resetFpDisplayOptions,
  resetFpGrids,
  resetFpOriginsAxes,
  resetFpToolbars,
} from './resets.js';
import type {
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'fp-display':
      return { Panel: PanelFpDisplayOptions, reset: resetFpDisplayOptions };

    case 'fp-grids':
      return { Panel: PanelFpGrids, reset: resetFpGrids };

    case 'fp-origins':
      return { Panel: PanelFpOriginsAxes, reset: resetFpOriginsAxes };

    case 'fp-toolbars':
      return { Panel: PanelFpToolbars, reset: resetFpToolbars };

    default:
      return null;
  }
};
