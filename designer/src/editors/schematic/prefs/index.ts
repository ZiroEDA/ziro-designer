// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Schematic Editor's Preferences pages, handed to the dialog by id.
 *
 * This is eeschema's `KIFACE::CreateKiWindow` switch
 * (`eeschema/eeschema.cpp:251-390`): the dialog names `PANEL_SCH_DISP_OPTIONS`
 * and this returns a fresh panel for it. The dialog does not know this file
 * exists beyond the dynamic import in `dialogs/prefs/registry.ts`, and nothing
 * here may reach into another editor.
 */
import { PanelEeschemaColorSettings } from './PanelEeschemaColorSettings.js';
import { PanelEeschemaDisplayOptions } from './PanelEeschemaDisplayOptions.js';
import { PanelEeschemaEditingOptions } from './PanelEeschemaEditingOptions.js';
import { PanelEeschemaGrids } from './PanelEeschemaGrids.js';
import { PanelTemplateFieldnames } from './PanelTemplateFieldnames.js';
import { PanelSchDataSources } from './PanelSchDataSources.js';
import { PanelSimulatorPreferences } from './PanelSimulatorPreferences.js';
import {
  resetEeschemaColorSettings,
  resetEeschemaDisplayOptions,
  resetEeschemaEditingOptions,
  resetEeschemaGrids,
  resetEeschemaToolbars,
  resetSimulatorPreferences,
} from './resets.js';
import { PanelEeschemaToolbars } from './PanelEeschemaToolbars.js';
import type {
  PrefsPageId,
  PrefsPanelFactory,
  PrefsPanelModule,
} from '../../../dialogs/prefs/types.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'sch-display':
      return {
        Panel: PanelEeschemaDisplayOptions,
        reset: resetEeschemaDisplayOptions,
      };

    case 'sch-grids':
      return {
        Panel: PanelEeschemaGrids,
        reset: resetEeschemaGrids,
      };

    case 'sch-editing':
      return {
        Panel: PanelEeschemaEditingOptions,
        reset: resetEeschemaEditingOptions,
      };

    case 'sch-colors':
      return {
        Panel: PanelEeschemaColorSettings,
        reset: resetEeschemaColorSettings,
        // PANEL_COLOR_SETTINGS::GetResetTooltip (include/dialogs/panel_color_settings.h:48).
        resetTooltip: 'Reset all colors in this theme to the KiCad defaults',
      };

    case 'sch-toolbars':
      return {
        Panel: PanelEeschemaToolbars,
        reset: resetEeschemaToolbars,
      };

    case 'sch-fields':
      // No `reset`: PANEL_TEMPLATE_FIELDNAMES_BASE is a plain wxPanel, not a
      // RESETTABLE_PANEL (eeschema/dialogs/panel_template_fieldnames_base.h:36),
      // and PANEL_TEMPLATE_FIELDNAMES declares no ResetPanel, so
      // PAGED_DIALOG::UpdateResetButton greys the button out on this page.
      return { Panel: PanelTemplateFieldnames };

    case 'sch-datasources':
      // PANEL_SCH_DATA_SOURCES IS a RESETTABLE_PANEL
      // (eeschema/dialogs/panel_sch_data_sources.h:34), and its `ResetPanel`
      // is `populateInstalledSources()` (`:90-93`) — it re-reads the PCM and
      // changes no setting, because the page holds none. Ours re-reads on
      // every render through `usePcmVersion`, so there is nothing for a reset
      // to do and no `reset` to export.
      return { Panel: PanelSchDataSources };

    case 'sch-simulator':
      return {
        Panel: PanelSimulatorPreferences,
        reset: resetSimulatorPreferences,
      };

    default:
      return null;
  }
};
