// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Schematic Editor's Preferences pages, handed to the dialog by id.
 *
 * The switch itself is eeschema's `KIFACE::CreateKiWindow`
 * (`eeschema/eeschema.ts`, eeschema.cpp:251-390): the dialog names
 * `PANEL_SCH_DISP_OPTIONS` and this hands it the page the kiface picks. The dialog does not know this file
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
  transferTemplateFieldnamesPage,
} from './resets.js';
import { PanelEeschemaToolbars } from './PanelEeschemaToolbars.js';
import type { PrefsPanelFactory, PrefsPanelModule } from '../../../dialogs/prefs/types.js';
import { FRAME_T, type PrefsPageId } from '@ziroeda/common/frame_type.js';
import { CreateKiWindow, type EESCHEMA_PAGES } from '@ziroeda/eeschema/eeschema.js';

/**
 * The pages, by the class eeschema's `CreateKiWindow` constructs for each.
 * Built once: every entry is a module-level component and reset.
 */
const PAGES: EESCHEMA_PAGES<PrefsPanelModule> = {
  PANEL_EESCHEMA_DISPLAY_OPTIONS: {
    Panel: PanelEeschemaDisplayOptions,
    reset: resetEeschemaDisplayOptions,
  },
  PANEL_SCH_GRID_SETTINGS: {
    Panel: PanelEeschemaGrids,
    reset: resetEeschemaGrids,
  },
  PANEL_EESCHEMA_EDITING_OPTIONS: {
    Panel: PanelEeschemaEditingOptions,
    reset: resetEeschemaEditingOptions,
  },
  PANEL_EESCHEMA_COLOR_SETTINGS: {
    Panel: PanelEeschemaColorSettings,
    reset: resetEeschemaColorSettings,
    // PANEL_COLOR_SETTINGS::GetResetTooltip (include/dialogs/panel_color_settings.h:48).
    resetTooltip: 'Reset all colors in this theme to the KiCad defaults',
  },
  PANEL_SCH_TOOLBAR_CUSTOMIZATION: {
    Panel: PanelEeschemaToolbars,
    reset: resetEeschemaToolbars,
  },
  // No `reset`: PANEL_TEMPLATE_FIELDNAMES_BASE is a plain wxPanel, not a
  // RESETTABLE_PANEL (eeschema/dialogs/panel_template_fieldnames_base.h:36),
  // and PANEL_TEMPLATE_FIELDNAMES declares no ResetPanel, so
  // PAGED_DIALOG::UpdateResetButton greys the button out on this page.
  // It DOES have a `TransferDataFromWindow`, which is a different virtual
  // and a different button: the grid's blanks, duplicates and mandatory
  // case variants are filtered on OK.
  PANEL_TEMPLATE_FIELDNAMES: {
    Panel: PanelTemplateFieldnames,
    transfer: transferTemplateFieldnamesPage,
  },
  // PANEL_SCH_DATA_SOURCES IS a RESETTABLE_PANEL
  // (eeschema/dialogs/panel_sch_data_sources.h:34), and its `ResetPanel`
  // is `populateInstalledSources()` (`:90-93`) — it re-reads the PCM and
  // changes no setting, because the page holds none. Ours re-reads on
  // every render through `usePcmVersion`, so there is nothing for a reset
  // to do and no `reset` to export.
  PANEL_SCH_DATA_SOURCES: { Panel: PanelSchDataSources },
  PANEL_SIMULATOR_PREFERENCES: {
    Panel: PanelSimulatorPreferences,
    reset: resetSimulatorPreferences,
  },
};

/** The Preferences dialog's page ids, as the `PANEL_SCH_*` class ids they name. */
const CLASS_ID: Partial<Record<PrefsPageId, FRAME_T>> = {
  'sch-display': FRAME_T.PANEL_SCH_DISP_OPTIONS,
  'sch-grids': FRAME_T.PANEL_SCH_GRIDS,
  'sch-editing': FRAME_T.PANEL_SCH_EDIT_OPTIONS,
  'sch-colors': FRAME_T.PANEL_SCH_COLORS,
  'sch-toolbars': FRAME_T.PANEL_SCH_TOOLBARS,
  'sch-fields': FRAME_T.PANEL_SCH_FIELD_NAME_TEMPLATES,
  'sch-datasources': FRAME_T.PANEL_SCH_DATA_SOURCES,
  'sch-simulator': FRAME_T.PANEL_SCH_SIMULATOR,
};

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  const classId = CLASS_ID[id];

  return classId === undefined ? null : CreateKiWindow(classId, PAGES);
};
