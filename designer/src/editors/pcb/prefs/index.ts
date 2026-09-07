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
 * Six of the heading's seven rows are here. Plugins is not, and is declared in
 * `OMITTED_PAGES` — `PANEL_PCBNEW_ACTION_PLUGINS` lists Python action plugins,
 * which have no browser form.
 */
import { PanelPcbColorSettings } from './PanelPcbColorSettings.js';
import { PanelPcbDisplayOptions } from './PanelPcbDisplayOptions.js';
import { PanelPcbEditingOptions } from './PanelPcbEditingOptions.js';
import { PanelPcbGrids } from './PanelPcbGrids.js';
import { PanelPcbOriginsAxes } from './PanelPcbOriginsAxes.js';
import {
  resetPcbColors,
  resetPcbDisplayOptions,
  resetPcbEditingOptions,
  resetPcbGrids,
  resetPcbOriginsAxes,
  resetPcbToolbars,
  resetViewer3dGeneral,
  resetViewer3dOpengl,
  resetViewer3dToolbars,
} from './resets.js';
import { PanelPcbToolbars } from './PanelPcbToolbars.js';
import { PanelViewer3dGeneral } from './PanelViewer3dGeneral.js';
import { PanelViewer3dOpengl } from './PanelViewer3dOpengl.js';
import { PanelViewer3dToolbars } from './PanelViewer3dToolbars.js';
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

    case 'pcb-grids':
      return {
        Panel: PanelPcbGrids,
        reset: resetPcbGrids,
      };

    case 'pcb-origins':
      return {
        Panel: PanelPcbOriginsAxes,
        reset: resetPcbOriginsAxes,
      };

    case 'pcb-editing':
      return {
        Panel: PanelPcbEditingOptions,
        reset: resetPcbEditingOptions,
      };

    case 'pcb-colors':
      return {
        Panel: PanelPcbColorSettings,
        reset: resetPcbColors,
        // `PANEL_COLOR_SETTINGS::GetResetTooltip`
        // (`include/dialogs/panel_color_settings.h:48`).
        resetTooltip: 'Reset all colors on this page to their default',
      };

    case 'pcb-toolbars':
      return {
        Panel: PanelPcbToolbars,
        reset: resetPcbToolbars,
      };

    // The 3D Viewer is a heading of its own but the same KIFACE, so its page
    // is constructed here rather than in a factory of its own.
    case '3dv-general':
      return {
        Panel: PanelViewer3dGeneral,
        reset: resetViewer3dGeneral,
      };

    case '3dv-opengl':
      return {
        Panel: PanelViewer3dOpengl,
        reset: resetViewer3dOpengl,
      };

    case '3dv-toolbars':
      return {
        Panel: PanelViewer3dToolbars,
        reset: resetViewer3dToolbars,
      };

    default:
      return null;
  }
};
