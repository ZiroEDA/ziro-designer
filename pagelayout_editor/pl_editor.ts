// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor.cpp`: the `pl_editor` KIFACE. Beyond the DSO
 * plumbing (`KIFACE_GETTER`, `IfaceOrAddress`, which a page has no use for):
 *
 *  - `OnKifaceStart`: `InitSettings( new PL_EDITOR_SETTINGS )` and register
 *    it with the settings manager — here from the stored `plEditor` slice;
 *  - `CreateKiWindow`: the frame over those settings for `FRAME_PL_EDITOR`,
 *    and the four `PANEL_DS_*` Preferences pages over a `PL_PREFS_CONTEXT`
 *    - what the program's Preferences dialog hands a page;
 *  - `SaveFileAs`: where a project's Save As puts one of its `.kicad_wks`.
 */
import { createElement, type JSX } from 'react';
import { PanelGridSettings } from '@ziroeda/common/dialogs/panel_grid_settings.js';
import { PanelToolbarCustomization } from '@ziroeda/common/dialogs/panel_toolbar_customization.js';
import { drawSheetIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { toStatusUnits } from '@ziroeda/common/settings/app_settings_units.js';
import { resetKeys } from '@ziroeda/common/settings/json_settings.js';
import type { CatalogueAction } from '@ziroeda/common/tool/action_toolbar_types.js';
import {
  resetToolbarsPanel,
  type ToolbarSettings,
} from '@ziroeda/common/tool/ui/toolbar_configuration.js';
import { resetPlEditorColorSettings } from './dialogs/panel_pl_editor_color_settings.js';
import { PanelPlEditorColorSettings } from './dialogs/panel_pl_editor_color_settings_ui.js';
import { resetPlEditorDisplayOptions } from './dialogs/panel_pl_editor_display_options.js';
import { PanelPlEditorDisplayOptions } from './dialogs/panel_pl_editor_display_options_ui.js';
import { PL_EDITOR_FRAME } from './pl_editor_frame.js';
import {
  PL_EDITOR_DEFAULTS,
  PL_EDITOR_SETTINGS,
  type PL_EDITOR_SETTINGS_JSON,
  type PlEditorSettings,
} from './pl_editor_settings.js';
import { DS_DEFAULT_TOOLBARS } from './toolbars_pl_editor.js';

/** `kiface( "pl_editor", KIWAY::FACE_PL_EDITOR )`. [data] */
export const PL_EDITOR_KIFACE_NAME = 'pl_editor';

/**
 * `IFACE::OnKifaceStart`: the settings object, loaded from `aStored`, and
 * registered as `pl_editor` so `GetAppSettings<PL_EDITOR_SETTINGS>( "pl_editor" )`
 * finds it (PL_DRAW_PANEL_GAL's constructor asks).
 */
export function OnKifaceStart(aStored: Partial<PL_EDITOR_SETTINGS_JSON>): PL_EDITOR_SETTINGS {
  const settings = new PL_EDITOR_SETTINGS().FromJson(aStored);
  PgmOrNull()?.GetSettingsManager().RegisterSettings(PL_EDITOR_KIFACE_NAME, settings);
  return settings;
}

/**
 * What a Preferences page reads and writes: the `pl_editor.json` working copy
 * (`GetAppSettings<PL_EDITOR_SETTINGS>( "pl_editor" )`), the toolbar store
 * (`GetToolbarSettings<PL_EDITOR_TOOLBAR_SETTINGS>`), the installed colour
 * themes, and the action catalogue the toolbar page lists
 * (`ACTION_MANAGER::GetActionList`). The Preferences dialog is the program's,
 * so the program makes this.
 */
export interface PL_PREFS_CONTEXT {
  plEditor: PlEditorSettings;
  upPl(aFn: (aSettings: PlEditorSettings) => void): void;
  installedThemes: readonly { id: string; name: string }[];
  toolbars: ToolbarSettings;
  upTb(aFn: (aToolbars: ToolbarSettings) => void): void;
  availableTools: readonly CatalogueAction[];
  toolbarIdOf(aActionName: string): string | undefined;
}

/** A page: the panel, and its `RESETTABLE_PANEL::ResetPanel`. */
export interface PL_PREFS_PANEL {
  Panel: (aProps: { ctx: PL_PREFS_CONTEXT }) => JSX.Element;
  reset(aCtx: PL_PREFS_CONTEXT): void;
  /** `RESETTABLE_PANEL::GetResetTooltip`, where a panel overrides it. */
  resetTooltip?: string;
}

/**
 * `PANEL_GRID_SETTINGS::ResetPanel` (`common/dialogs/panel_grid_settings.cpp:
 * 110-113`) — the same two lines for every frame that constructs the panel, so
 * the slice is the same as the schematic's Grids page over this editor's
 * settings object.
 */
function resetPlEditorGrids(ctx: PL_PREFS_CONTEXT): void {
  ctx.upPl((s) => {
    resetKeys(s.window.grid, PL_EDITOR_DEFAULTS.window.grid, [
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
function resetPlEditorToolbars(ctx: PL_PREFS_CONTEXT): void {
  ctx.upTb((s) => {
    resetToolbarsPanel(s);
  });
}

/**
 * `PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_PL_EDITOR )`. The
 * `UNITS_PROVIDER` is the frame (`pl_editor.cpp:71-79`), so the rows read in
 * whatever unit pl_editor is displaying; the scale is `drawSheetIUScale`.
 */
function PanelPlEditorGrids({ ctx }: { ctx: PL_PREFS_CONTEXT }): JSX.Element {
  return createElement(PanelGridSettings, {
    grid: ctx.plEditor.window.grid,
    update: (fn) => ctx.upPl((s) => fn(s.window.grid)),
    frameType: 'FRAME_PL_EDITOR',
    units: toStatusUnits(ctx.plEditor.system.units),
    iuScale: drawSheetIUScale,
    idPrefix: 'ds',
  });
}

/** `PANEL_TOOLBAR_CUSTOMIZATION( aParent, cfg, tb, FRAME_PL_EDITOR, actions, controls )`. */
function PanelPlEditorToolbars({ ctx }: { ctx: PL_PREFS_CONTEXT }): JSX.Element {
  return createElement(PanelToolbarCustomization, {
    app: 'pl_editor',
    availableTools: ctx.availableTools,
    toolbarIdOf: ctx.toolbarIdOf,
    defaults: DS_DEFAULT_TOOLBARS,
    custom: ctx.plEditor.appearance.custom_toolbars,
    setCustom: (v: boolean) => {
      ctx.upPl((s) => {
        s.appearance.custom_toolbars = v;
      });
    },
    store: ctx.toolbars,
    update: (fn) => ctx.upTb(fn),
  });
}

/**
 * `IFACE::CreateKiWindow( aParent, aClassId, … )` (`pl_editor.cpp:61-104`):
 * `FRAME_PL_EDITOR` is `new PL_EDITOR_FRAME` over the settings; each
 * `PANEL_DS_*` is its Preferences page.
 */
export function CreateKiWindow(aSettings: PL_EDITOR_SETTINGS): PL_EDITOR_FRAME;
export function CreateKiWindow(aClassId: FRAME_T): PL_PREFS_PANEL | null;
export function CreateKiWindow(
  a: PL_EDITOR_SETTINGS | FRAME_T,
): PL_EDITOR_FRAME | PL_PREFS_PANEL | null {
  if (a instanceof PL_EDITOR_SETTINGS) return new PL_EDITOR_FRAME(a);

  switch (a) {
    case FRAME_T.PANEL_DS_DISPLAY_OPTIONS:
      return { Panel: PanelPlEditorDisplayOptions, reset: resetPlEditorDisplayOptions };

    case FRAME_T.PANEL_DS_GRIDS:
      return { Panel: PanelPlEditorGrids, reset: resetPlEditorGrids };

    case FRAME_T.PANEL_DS_COLORS:
      // No `resetTooltip`: `PANEL_PL_EDITOR_COLOR_SETTINGS` derives from
      // `RESETTABLE_PANEL` directly, not from `PANEL_COLOR_SETTINGS`, so it
      // gets `DEFAULT_RESET_TOOLTIP`.
      return { Panel: PanelPlEditorColorSettings, reset: resetPlEditorColorSettings };

    case FRAME_T.PANEL_DS_TOOLBARS:
      return { Panel: PanelPlEditorToolbars, reset: resetPlEditorToolbars };

    default:
      return null;
  }
}

/**
 * `IFACE::SaveFileAs`: a `.kicad_wks` inside the project directory moves to
 * the same place under the new directory, and one named after the project
 * takes the new project's name — an exact, case-sensitive match
 * (`destFile.GetName() == aSrcProjectName`).
 *
 * @return the destination path; the copy itself (`KiCopyFile`) is the caller's.
 *         Null for any other file type ("Unexpected filetype").
 */
export function SaveFileAs(
  aProjectBasePath: string,
  aSrcProjectName: string,
  aNewProjectBasePath: string,
  aNewProjectName: string,
  aSrcFilePath: string,
): string | null {
  const pathSep = '/';
  const slash = aSrcFilePath.lastIndexOf(pathSep);
  let destPath = aSrcFilePath.slice(0, slash + 1); // GetPathWithSep()
  const fullName = aSrcFilePath.slice(slash + 1);
  const dot = fullName.lastIndexOf('.');
  let name = dot >= 0 ? fullName.slice(0, dot) : fullName;
  const ext = dot >= 0 ? fullName.slice(dot + 1) : '';

  if (destPath.startsWith(aProjectBasePath + pathSep)) {
    // destPath.Replace( aProjectBasePath, aNewProjectBasePath, false ): the first occurrence.
    destPath = destPath.replace(aProjectBasePath, aNewProjectBasePath);
  }

  if (ext === 'kicad_wks') {
    if (name === aSrcProjectName) name = aNewProjectName;

    return `${destPath}${name}.${ext}`;
  }

  // wxFAIL_MSG( "Unexpected filetype for Pcbnew::SaveFileAs()" )
  return null;
}
