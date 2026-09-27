// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview.h`: the RS-274 interpreter's three enums.
 *
 * `gerbview/gerbview.cpp` is the KIFACE; its Preferences-panel half,
 * `CreateKiWindow`, is at the end of this file. The frame half is the page's.
 */

import { createElement, type JSX } from 'react';
import { PanelGridSettings } from '@ziroeda/common/dialogs/panel_grid_settings.js';
import { PanelToolbarCustomization } from '@ziroeda/common/dialogs/panel_toolbar_customization.js';
import { GERB_IU_PER_MM, gerbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { toStatusUnits } from '@ziroeda/common/settings/app_settings_units.js';
import { resetKeys } from '@ziroeda/common/settings/json_settings.js';
import type { CatalogueAction } from '@ziroeda/common/tool/action_toolbar_types.js';
import {
  resetToolbarsPanel,
  type ToolbarSettings,
} from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import { resetGerbviewColorSettings } from './dialogs/panel_gerbview_color_settings.js';
import { PanelGerbviewColorSettings } from './dialogs/panel_gerbview_color_settings_ui.js';
import { resetGerbviewDisplayOptions } from './dialogs/panel_gerbview_display_options.js';
import { PanelGerbviewDisplayOptions } from './dialogs/panel_gerbview_display_options_ui.js';
import { resetGerbviewExcellonSettings } from './dialogs/panel_gerbview_excellon_settings.js';
import { PanelGerbviewExcellonSettings } from './dialogs/panel_gerbview_excellon_settings_ui.js';
import { GERBVIEW_DEFAULTS, type GerbviewSettings } from './gerbview_settings.js';
import { GBR_DEFAULT_TOOLBARS } from './toolbars_gerber.js';

/** `Gerb_Interpolation` (`gerbview.h:33-38`), the G01 / G02 / G03 modes. */
export enum Gerb_Interpolation {
  GERB_INTERPOL_LINEAR_1X = 0,
  /** G02, clockwise. */
  GERB_INTERPOL_ARC_NEG,
  /** G03, counter-clockwise. */
  GERB_INTERPOL_ARC_POS,
}

/** `Gerb_GCommand` (`gerbview.h:42-58`), the G codes `Execute_G_Command` knows. */
export enum Gerb_GCommand {
  GC_MOVE = 0,
  GC_LINEAR_INTERPOL_1X = 1,
  GC_CIRCLE_NEG_INTERPOL = 2,
  GC_CIRCLE_POS_INTERPOL = 3,
  GC_COMMENT = 4,
  GC_TURN_ON_POLY_FILL = 36,
  GC_TURN_OFF_POLY_FILL = 37,
  GC_SELECT_TOOL = 54,
  /** Can start a D03 flash command: redundant with D03. */
  GC_PHOTO_MODE = 55,
  GC_SPECIFY_INCHES = 70,
  GC_SPECIFY_MILLIMETERS = 71,
  GC_TURN_OFF_360_INTERPOL = 74,
  GC_TURN_ON_360_INTERPOL = 75,
  GC_SPECIFY_ABSOLUES_COORD = 90,
  GC_SPECIFY_RELATIVEES_COORD = 91,
}

/** `Gerb_Analyse_Cmd` (`gerbview.h:61-66`), the reader's state. */
export enum Gerb_Analyse_Cmd {
  CMD_IDLE = 0,
  END_BLOCK,
  ENTER_RS274X_CMD,
}

/**
 * The gerbview internal unit: 10 nm, `GERB_IU_PER_MM = 1e5`
 * (`include/base_units.h:69`) - common's own, so there is one gerbview scale
 * in the tree.
 */
export const IU_PER_MM = GERB_IU_PER_MM;
/** Internal units per mil (0.001"): `GERB_IU_PER_MM * 0.0254`. */
export const IU_PER_MILS = gerbIUScale.IU_PER_MILS;

export { gerbIUScale };

// ---- KIFACE::CreateKiWindow: the Preferences pages (gerbview.cpp:69-115) ----

/**
 * What the Preferences pages edit, and read: `gerbview.json` (upstream the
 * `GERBVIEW_SETTINGS` `GetAppSettings<>( "gerbview" )` answers), the colour
 * store the Colors page shares with the Layers Manager, `gerbview-toolbars`
 * (`GetToolbarSettings<>`), and the lists the pages are given - the installed
 * themes (`GetColorSettingsList()`) and the actions (`ACTION_MANAGER::
 * GetActionList()`). The Preferences dialog, which holds the working copies,
 * builds it.
 */
export interface GBR_PREFS_CONTEXT {
  gerbview: GerbviewSettings;
  upGbr(aFn: (aSettings: GerbviewSettings) => void): void;
  userColors: Record<string, string>;
  setUserColors(aFn: (aColors: Record<string, string>) => Record<string, string>): void;
  installedThemes: readonly { id: string; name: string }[];
  toolbars: ToolbarSettings;
  upTb(aFn: (aToolbars: ToolbarSettings) => void): void;
  availableTools: readonly CatalogueAction[];
  toolbarIdOf(aActionName: string): string | undefined;
}

/** A page: the panel, and its `RESETTABLE_PANEL::ResetPanel`. */
export interface GBR_PREFS_PANEL {
  Panel: (aProps: { ctx: GBR_PREFS_CONTEXT }) => JSX.Element;
  reset(aCtx: GBR_PREFS_CONTEXT): void;
  /** `RESETTABLE_PANEL::GetResetTooltip`, where a panel overrides it. */
  resetTooltip?: string;
}

/**
 * `PANEL_GRID_SETTINGS::ResetPanel` (`common/dialogs/panel_grid_settings.cpp:
 * 110-113`) — the same two lines for every frame that constructs the panel, so
 * the slice is the same as the schematic's and the Drawing Sheet Editor's over
 * this editor's settings object.
 *
 * `overrides` is in the list even though gerbview draws no override row:
 * `TransferDataFromWindow` assigns the whole `m_grids` block back regardless,
 * and a key left out here is a field that silently never resets. It is empty
 * for this app, so resetting it is a no-op — which is the correct no-op, not an
 * omission.
 */
function resetGerbviewGrids(ctx: GBR_PREFS_CONTEXT): void {
  ctx.upGbr((s) => {
    resetKeys(s.window.grid, GERBVIEW_DEFAULTS.window.grid, [
      'sizes',
      'last_size_idx',
      'fast_grid_1',
      'fast_grid_2',
      'overrides_enabled',
      'overrides',
    ]);
  });
}

/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`) over this app's
 * toolbars, through the shared implementation. It does not touch
 * `appearance.custom_toolbars`: upstream's ResetPanel refills `m_toolbars` and
 * leaves `m_CustomToolbars` exactly as the user left it.
 */
function resetGerbviewToolbars(ctx: GBR_PREFS_CONTEXT): void {
  ctx.upTb((s) => {
    resetToolbarsPanel(s);
  });
}

/** `PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_GERBER )`. */
function PanelGerbviewGrids({ ctx }: { ctx: GBR_PREFS_CONTEXT }): JSX.Element {
  return createElement(PanelGridSettings, {
    grid: ctx.gerbview.window.grid,
    update: (fn) => ctx.upGbr((s) => fn(s.window.grid)),
    frameType: 'FRAME_GERBER',
    units: toStatusUnits(ctx.gerbview.system.units),
    // gerbIUScale: the KIFACE's own UNITS_PROVIDER (gerbview.cpp:60-61), which
    // decides the precision each row is printed to.
    iuScale: gerbIUScale,
    idPrefix: 'gbr',
  });
}

/** `PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb, FRAME_GERBER, actions, controls )`. */
function PanelGerbviewToolbars({ ctx }: { ctx: GBR_PREFS_CONTEXT }): JSX.Element {
  return createElement(PanelToolbarCustomization, {
    app: 'gerbview',
    availableTools: ctx.availableTools,
    toolbarIdOf: ctx.toolbarIdOf,
    defaults: GBR_DEFAULT_TOOLBARS,
    custom: ctx.gerbview.appearance.custom_toolbars,
    setCustom: (v: boolean) => {
      ctx.upGbr((s) => {
        s.appearance.custom_toolbars = v;
      });
    },
    store: ctx.toolbars,
    update: (fn) => ctx.upTb(fn),
  });
}

/**
 * `IFACE::CreateKiWindow( aParent, aClassId, ... )`'s panel half: the page for
 * `aClassId`, or null for one this KIFACE does not make.
 */
export function CreateKiWindow(aClassId: FRAME_T): GBR_PREFS_PANEL | null {
  switch (aClassId) {
    case FRAME_T.PANEL_GBR_DISPLAY_OPTIONS:
      return { Panel: PanelGerbviewDisplayOptions, reset: resetGerbviewDisplayOptions };

    case FRAME_T.PANEL_GBR_EXCELLON_OPTIONS:
      return { Panel: PanelGerbviewExcellonSettings, reset: resetGerbviewExcellonSettings };

    case FRAME_T.PANEL_GBR_GRIDS:
      return { Panel: PanelGerbviewGrids, reset: resetGerbviewGrids };

    case FRAME_T.PANEL_GBR_COLORS:
      return {
        Panel: PanelGerbviewColorSettings,
        reset: resetGerbviewColorSettings,
        // PANEL_COLOR_SETTINGS::GetResetTooltip
        // (include/dialogs/panel_color_settings.h:48-51): gerbview's page IS a
        // subclass of it, so it inherits the override.
        resetTooltip: 'Reset all colors in this theme to the KiCad defaults',
      };

    case FRAME_T.PANEL_GBR_TOOLBARS:
      return { Panel: PanelGerbviewToolbars, reset: resetGerbviewToolbars };

    default:
      return null;
  }
}
