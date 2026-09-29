// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbnew_config.cpp`: `PCB_EDIT_FRAME`'s project-settings half —
 * `LoadDrawingSheet`, `LoadProjectSettings`, `SaveProjectLocalSettings` and
 * `saveProjectSettings`. Mixed into `PCB_EDIT_FRAME` with `applyMixins`, the
 * pattern `files.ts` and `undo_redo.ts` use for a C++ class whose methods are
 * spread over several `.cpp` files.
 *
 * The three widgets these methods talk to — `APPEARANCE_CONTROLS`,
 * `PANEL_SELECTION_FILTER`, and the `PCB_SELECTION_TOOL`'s filter — are the
 * window's; the frame reaches them through `PCB_BASE_EDIT_FRAME`'s
 * `m_appearancePanel` / `m_selectionFilterPanel`, which the window sets.
 *
 * Differences from the desktop, each forced by the browser:
 * - `wxFileName::IsOk()` / `IsDirWritable()` / `Exists()` on the project file
 *   become "the project has a name" and "the project is not read-only".
 * - `SETTINGS_MANAGER::SaveProject()` returns the two JSON documents instead
 *   of writing them; `SaveProjectLocalSettings` hands them back so the window
 *   can persist them to the project's file store.
 * - `LoadWindowState( fn )` — the window's size and position — is the host's
 *   (the browser tab has no window geometry to restore).
 * - `DS_DATA_MODEL::LoadDrawingSheet` takes the file's text; the resolved
 *   name is looked up in the project's files through `aReadFile`.
 */
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { BASE_SCREEN } from '@ziroeda/common/base_screen.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { FILENAME_RESOLVER } from '@ziroeda/common/filename_resolver.js';
import { Pgm, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { PCB_SELECTION_FILTER_OPTIONS } from '@ziroeda/common/project/board_project_settings.js';
import type { JsonObject } from '@ziroeda/common/settings/json_settings.js';
import type { NETINFO_LIST } from './netinfo_list.js';
import type { PCB_EDIT_FRAME } from './pcb_edit_frame.js';
import { PCB_DISPLAY_OPTIONS, type PCB_PAINTER } from './pcb_painter.js';

/**
 * The net-colour loop of `LoadProjectSettings` (pcbnew_config.cpp:95-105):
 * every assignment that is not `COLOR4D::UNSPECIFIED`, by the net code of the
 * board net of that name; a name the board has no net for is dropped.
 */
export function NetColorAssignmentsToCodes<C>(
  aNets: NETINFO_LIST,
  aAssignments: Iterable<readonly [string, C]>,
  aIsUnspecified: (aColor: C) => boolean,
): Map<number, C> {
  const netColors = new Map<number, C>();

  for (const [netname, color] of aAssignments) {
    if (!aIsUnspecified(color)) {
      const net = aNets.GetNetItem(netname);

      if (net) netColors.set(net.GetNetCode(), color);
    }
  }

  return netColors;
}

/** `color != COLOR4D::UNSPECIFIED`, for a live `COLOR4D`. */
export function IsUnspecifiedColor(aColor: Color4d): boolean {
  return (
    aColor.r === COLOR4D_UNSPECIFIED.r &&
    aColor.g === COLOR4D_UNSPECIFIED.g &&
    aColor.b === COLOR4D_UNSPECIFIED.b &&
    aColor.a === COLOR4D_UNSPECIFIED.a
  );
}

/** What `SaveProjectLocalSettings` hands the window to persist: `SaveProject()`'s two files. */
export interface SAVED_PROJECT_FILES {
  pro: JsonObject;
  prl: JsonObject;
}

/** `PCB_EDIT_FRAME`'s `pcbnew_config.cpp` half, mixed into that class by `pcb_edit_frame.ts`. */
export class PCBNEW_CONFIG_MIXIN {
  /**
   * `PCB_EDIT_FRAME::LoadDrawingSheet` (pcbnew_config.cpp:44-62): the drawing
   * sheet named in the project, resolved against the project path and the
   * board's embedded files; an empty or missing one is the default sheet, and
   * a failure goes to the infobar.
   *
   * @param aReadFile the text of a resolved file name, or null when there is
   *                  no such file (the browser's stand-in for opening it).
   * @return the error message shown, or '' when the sheet loaded.
   */
  LoadDrawingSheet(this: PCB_EDIT_FRAME, aReadFile: (aFullPath: string) => string | null): string {
    const project = this.Prj().GetProjectFile();

    // Load the drawing sheet from the filename stored in the project
    // If empty, or not existing, the default drawing sheet is loaded.
    const resolver = new FILENAME_RESOLVER();
    resolver.SetProject(this.Prj());
    resolver.SetProgramBase(PgmOrNull());

    const filename = resolver.ResolvePath(
      project.m_BoardDrawingSheetFile,
      this.Prj().GetProjectPath(),
      [this.GetBoard()!.GetEmbeddedFiles()],
    );

    const msg = { value: '' };

    if (
      !DS_DATA_MODEL.GetTheInstance().LoadDrawingSheet(
        filename,
        msg,
        false,
        filename === '' ? null : aReadFile(filename),
      )
    ) {
      this.ShowInfoBarError(msg.value, true);
      return msg.value;
    }

    return '';
  }

  /** `PCB_EDIT_FRAME::LoadProjectSettings` (pcbnew_config.cpp:64-138). */
  LoadProjectSettings(this: PCB_EDIT_FRAME): boolean {
    const project = this.Prj().GetProjectFile();
    const localSettings = this.Prj().GetLocalSettings();

    BASE_SCREEN.m_DrawingSheetFileName = project.m_BoardDrawingSheetFile;

    // Load render settings that aren't stored in PCB_DISPLAY_OPTIONS

    const netSettings = project.NetSettings();
    const renderSettings = (this.GetCanvas()!.GetView().GetPainter() as PCB_PAINTER).GetSettings();

    const nets = this.GetBoard()!.GetNetInfo();

    const hiddenNets = renderSettings.GetHiddenNets();
    hiddenNets.clear();

    for (const hidden of localSettings.m_HiddenNets) {
      const net = nets.GetNetItem(hidden);

      if (net) hiddenNets.add(net.GetNetCode());
    }

    for (const net of nets) {
      if (localSettings.m_HiddenNetclasses.has(net.GetNetClass().GetName()))
        hiddenNets.add(net.GetNetCode());
    }

    const netColors = renderSettings.GetNetColorMap();
    netColors.clear();

    for (const [code, color] of NetColorAssignmentsToCodes(
      this.GetBoard()!.GetNetInfo(),
      netSettings.GetNetColorAssignments(),
      IsUnspecifiedColor,
    ))
      netColors.set(code, color);

    this.m_appearancePanel?.SetUserLayerPresets(project.m_LayerPresets);
    this.m_appearancePanel?.SetUserViewports(project.m_Viewports);

    const filterOpts = this.GetSelectionFilter();
    Object.assign(filterOpts, localSettings.m_PcbSelectionFilter);
    this.m_selectionFilterPanel?.SetCheckboxesFromFilter(filterOpts);

    // `PCB_DISPLAY_OPTIONS opts = GetDisplayOptions()`: a copy.
    const opts = Object.assign(new PCB_DISPLAY_OPTIONS(), this.GetDisplayOptions());
    opts.m_ContrastModeDisplay = localSettings.m_ContrastModeDisplay;
    opts.m_NetColorMode = localSettings.m_NetColorMode;
    opts.m_TrackOpacity = localSettings.m_TrackOpacity;
    opts.m_ViaOpacity = localSettings.m_ViaOpacity;
    opts.m_PadOpacity = localSettings.m_PadOpacity;
    opts.m_ZoneOpacity = localSettings.m_ZoneOpacity;
    opts.m_ZoneDisplayMode = localSettings.m_ZoneDisplayMode;
    opts.m_ImageOpacity = localSettings.m_ImageOpacity;
    opts.m_FilledShapeOpacity = localSettings.m_ShapeOpacity;

    // No refresh here: callers of LoadProjectSettings refresh later
    this.SetDisplayOptions(opts, false);

    const bds = this.GetDesignSettings();
    bds.m_UseConnectedTrackWidth = localSettings.m_AutoTrackWidth;

    // `LoadWindowState( fn.GetFullPath() )`: the host's (see the file comment).

    return true;
  }

  /**
   * `PCB_EDIT_FRAME::SaveProjectLocalSettings` (pcbnew_config.cpp:141-193).
   *
   * @return the `.kicad_pro` / `.kicad_prl` `SaveProject()` wrote, for the
   *         window to persist; null when nothing was saved.
   */
  SaveProjectLocalSettings(this: PCB_EDIT_FRAME): SAVED_PROJECT_FILES | null {
    const prj = this.Prj();

    // Check for the filename before checking IsWritable as this
    // will throw errors on bad names.  Here, we just want to not
    // save the Settings if we don't have a name
    if (prj.GetProjectFullName() === '') return null;

    if (prj.IsReadOnly()) return null;

    const project = prj.GetProjectFile();

    // save some local settings like appearance control settings
    this.saveProjectSettings();

    // TODO: Can this be pulled out of BASE_SCREEN?
    project.m_BoardDrawingSheetFile = BASE_SCREEN.m_DrawingSheetFileName;

    if (this.m_appearancePanel) {
      project.m_LayerPresets.splice(
        0,
        project.m_LayerPresets.length,
        ...this.m_appearancePanel.GetUserLayerPresets(),
      );
      project.m_Viewports.splice(
        0,
        project.m_Viewports.length,
        ...this.m_appearancePanel.GetUserViewports(),
      );
    }

    this.GetBoard()!.RecordDRCExclusions();

    // Save render settings that aren't stored in PCB_DISPLAY_OPTIONS

    const netSettings = project.NetSettings();
    const nets = this.GetBoard()!.GetNetInfo();
    const renderSettings = (this.GetCanvas()!.GetView().GetPainter() as PCB_PAINTER).GetSettings();

    netSettings.ClearNetColorAssignments();

    for (const [netcode, color] of renderSettings.GetNetColorMap()) {
      const net = nets.GetNetItem(netcode);

      if (net) netSettings.SetNetColorAssignment(net.GetNetname(), color);
    }

    // The below automatically saves the project on exit, which is what we want to do if the
    // project already exists.  If the project doesn't already exist, we don't want to create it
    // through this function call (see pcbnew_config.cpp:182-189).
    if (!prj.IsNullProject()) return Pgm().GetSettingsManager().SaveProject();

    return null;
  }

  /** `PCB_EDIT_FRAME::saveProjectSettings` (pcbnew_config.cpp:196-249). */
  saveProjectSettings(this: PCB_EDIT_FRAME): void {
    const prj = this.Prj();

    // Check for the filename before checking IsWritable as this
    // will throw errors on bad names.  Here, we just want to not
    // save the Settings if we don't have a name
    if (prj.GetProjectFullName() === '') return;

    if (prj.IsReadOnly()) return;

    const localSettings = prj.GetLocalSettings();

    // Save appearance control settings
    localSettings.m_ActiveLayer = this.GetActiveLayer();
    localSettings.m_ActiveLayerPreset = this.m_appearancePanel?.GetActiveLayerPreset() ?? '';

    const displayOpts = this.GetDisplayOptions();

    localSettings.m_ContrastModeDisplay = displayOpts.m_ContrastModeDisplay;
    localSettings.m_NetColorMode = displayOpts.m_NetColorMode;
    localSettings.m_TrackOpacity = displayOpts.m_TrackOpacity;
    localSettings.m_ViaOpacity = displayOpts.m_ViaOpacity;
    localSettings.m_PadOpacity = displayOpts.m_PadOpacity;
    localSettings.m_ZoneOpacity = displayOpts.m_ZoneOpacity;
    localSettings.m_ZoneDisplayMode = displayOpts.m_ZoneDisplayMode;
    localSettings.m_ImageOpacity = displayOpts.m_ImageOpacity;
    localSettings.m_ShapeOpacity = displayOpts.m_FilledShapeOpacity;

    // Save Design settings
    const bds = this.GetDesignSettings();
    localSettings.m_AutoTrackWidth = bds.m_UseConnectedTrackWidth;

    // Net display settings
    const nets = this.GetBoard()!.GetNetInfo();
    const renderSettings = (this.GetCanvas()!.GetView().GetPainter() as PCB_PAINTER).GetSettings();

    localSettings.m_HiddenNets = [];

    for (const netcode of renderSettings.GetHiddenNets()) {
      const net = nets.GetNetItem(netcode);

      if (net) localSettings.m_HiddenNets.push(net.GetNetname());
    }

    localSettings.m_PcbSelectionFilter = Object.assign(
      new PCB_SELECTION_FILTER_OPTIONS(),
      this.GetSelectionFilter(),
    );
  }
}
