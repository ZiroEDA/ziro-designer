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
 * All nine of the heading's rows are here — `common/eda_base_frame.cpp:1667-1675`
 * in that order, which is also the order of this switch.
 */
import { PanelFpColorSettings } from './PanelFpColorSettings.js';
import { PanelFpDisplayOptions } from '@ziroeda/pcbnew/dialogs/panel_display_options.js';
import { PanelFpEditingOptions } from '@ziroeda/pcbnew/dialogs/panel_edit_options.js';
import { PanelFpFootprintDefaults } from '@ziroeda/pcbnew/dialogs/panel_fp_editor_field_defaults.js';
import { PanelFpGraphicsDefaults } from '@ziroeda/pcbnew/dialogs/panel_fp_editor_graphics_defaults.js';
import { PanelFpGrids } from './PanelFpGrids.js';
import { PanelFpOriginsAxes } from './PanelFpOriginsAxes.js';
import { PanelFpToolbars } from './PanelFpToolbars.js';
import { PanelFpUserLayerNames } from '@ziroeda/pcbnew/dialogs/panel_fp_user_layer_names.js';
import {
  resetFpColors,
  resetFpDisplayOptions,
  resetFpEditingOptions,
  resetFpFootprintDefaults,
  resetFpGraphicsDefaults,
  resetFpGrids,
  resetFpOriginsAxes,
  resetFpToolbars,
  resetFpUserLayerNames,
} from './resets.js';
import type { PrefsPanelFactory, PrefsPanelModule } from '../../../dialogs/prefs/types.js';
import type { PrefsPageId } from '@ziroeda/common/frame_type.js';

export const createPrefsPanel: PrefsPanelFactory = (id: PrefsPageId): PrefsPanelModule | null => {
  switch (id) {
    case 'fp-display':
      return { Panel: PanelFpDisplayOptions, reset: resetFpDisplayOptions };

    case 'fp-grids':
      return { Panel: PanelFpGrids, reset: resetFpGrids };

    case 'fp-origins':
      return { Panel: PanelFpOriginsAxes, reset: resetFpOriginsAxes };

    case 'fp-editing':
      return { Panel: PanelFpEditingOptions, reset: resetFpEditingOptions };

    case 'fp-colors':
      return {
        Panel: PanelFpColorSettings,
        reset: resetFpColors,
        // `PANEL_COLOR_SETTINGS::GetResetTooltip`
        // (`include/dialogs/panel_color_settings.h:48`), one of the two panels
        // that override it.
        resetTooltip: 'Reset all colors on this page to their default',
      };

    case 'fp-toolbars':
      return { Panel: PanelFpToolbars, reset: resetFpToolbars };

    case 'fp-defaults':
      return { Panel: PanelFpFootprintDefaults, reset: resetFpFootprintDefaults };

    case 'fp-graphics':
      return { Panel: PanelFpGraphicsDefaults, reset: resetFpGraphicsDefaults };

    case 'fp-userlayers':
      return { Panel: PanelFpUserLayerNames, reset: resetFpUserLayerNames };

    default:
      return null;
  }
};
