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
import {
  PanelEeschemaAnnotationOptions,
  resetEeschemaAnnotationOptions,
} from './PanelEeschemaAnnotationOptions.js';
import {
  PanelEeschemaColorSettings,
  resetEeschemaColorSettings,
} from './PanelEeschemaColorSettings.js';
import {
  PanelEeschemaDisplayOptions,
  resetEeschemaDisplayOptions,
} from './PanelEeschemaDisplayOptions.js';
import {
  PanelEeschemaEditingOptions,
  resetEeschemaEditingOptions,
} from './PanelEeschemaEditingOptions.js';
import { PanelEeschemaGrids, resetEeschemaGrids } from './PanelEeschemaGrids.js';
import { PanelTemplateFieldnames, resetTemplateFieldnames } from './PanelTemplateFieldnames.js';
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

    case 'sch-annotation':
      return {
        Panel: PanelEeschemaAnnotationOptions,
        reset: resetEeschemaAnnotationOptions,
      };

    case 'sch-colors':
      return {
        Panel: PanelEeschemaColorSettings,
        reset: resetEeschemaColorSettings,
      };

    case 'sch-fields':
      return {
        Panel: PanelTemplateFieldnames,
        reset: resetTemplateFieldnames,
      };

    default:
      return null;
  }
};
