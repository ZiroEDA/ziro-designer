// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_DRAW_FRAME` (include/eda_draw_frame.h, common/eda_draw_frame.cpp): the
 * base of every frame with a drawing canvas. Between it and EDA_BASE_FRAME the
 * C++ has KIWAY_PLAYER, the window-to-window messaging base, which has no
 * browser counterpart and is skipped. What is here is the part the model
 * layer reaches: the canvas accessor, the colour settings, the message
 * panel hooks and the item resolver — and, first, the grid snapping the
 * frame owns.
 *
 * Grid snapping, `EDA_DRAW_FRAME::GetNearestGridPosition` /
 * `::GetNearestHalfGridPosition` (`common/eda_draw_frame.cpp:1073/1098`).
 *
 * Upstream reads the grid size and origin off the frame's GAL, so both live on
 * the *frame* — in `common/`, instantiated once and used by every editor. Ours
 * therefore belongs in a shared module too, parameterised by the grid rather
 * than duplicated per editor: the symbol editor already had a private copy
 * (`designer/src/editors/symbol/edits.ts`), and the schematic transform needs
 * exactly the same answer.
 *
 * The grid origin is a user setting that we do not model anywhere yet, so
 * `gridOrigin` defaults to zero, which makes both `fmod` offsets zero.
 */

import { GAL_DISPLAY_OPTIONS_IMPL } from './gal_display_options_common.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { EdaIuScale, EdaUnits } from './eda_units.js';
import { EDA_BASE_FRAME } from './eda_base_frame.js';
import type { FRAME_T } from './frame_type.js';
import type { KIID } from './kiid.js';
import type { EDA_ITEM } from './eda_item.js';
import type { ORIGIN_TRANSFORMS } from './origin_transforms.js';
import type { BASE_SCREEN } from './base_screen.js';
import { type EDA_DRAW_PANEL_GAL, GAL_TYPE } from './draw_panel_gal.js';
import { DEFAULT_THEME, GetColorSettings } from './pgm_base.js';
import type { COLOR_SETTINGS } from './settings/color_settings.js';
import type { MSG_PANEL_ITEM } from './widgets/msgpanel.js';
import { type APP_SETTINGS_BASE, EdaUnitsFromInt, EdaUnitsToInt } from './settings/app_settings.js';
import type { SELECTION } from './tool/selection.js';
import { ACTIONS } from './tool/actions.js';
import { COMMON_TOOLS } from './tool/common_tools.js';
import { GRID_MENU } from './tool/grid_menu.js';
import { IsImperialUnit } from './units_provider.js';
import { RENDER_TARGET } from './gal/definitions.js';
import { wxChoice, wxNOT_FOUND } from './wx/choice.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `GRID_HELPER` as `COMMON_TOOLS::CursorControl` reads it. A frame that
 * snaps to items (the PCB and schematic editors) returns one from
 * MakeGridHelper; the base and GerbView return none.
 */
export interface GRID_HELPER_LIKE {
  GetSelectionGrid(aSelection: SELECTION): number;
  GetGridSize(aGrid: number): { x: number; y: number };
}

/** `KiROUND`: round half *away from zero*, not half up as `Math.round` does. */
const kiRound = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/** `KiROUND( (p - offset) / size ) * size + offset` on one axis. */
const snapAxis = (v: number, size: number, origin: number): number => {
  const offset = origin % size;
  return kiRound((v - offset) / size) * size + offset;
};

/** `EDA_DRAW_FRAME::GetNearestGridPosition`: the nearest point on the grid. */
export function nearestGridPosition(
  p: Vec2,
  grid: number,
  gridOrigin: Vec2 = { x: 0, y: 0 },
): Vec2 {
  return {
    x: snapAxis(p.x, grid, gridOrigin.x),
    y: snapAxis(p.y, grid, gridOrigin.y),
  };
}

/**
 * `EDA_DRAW_FRAME::GetNearestHalfGridPosition`: the same, on a grid of half the
 * step. Rotate and mirror snap their centre with this one, so a two-item
 * selection whose midpoint falls between grid points still lands somewhere the
 * items' own endpoints can reach.
 */
export function nearestHalfGridPosition(
  p: Vec2,
  grid: number,
  gridOrigin: Vec2 = { x: 0, y: 0 },
): Vec2 {
  return nearestGridPosition(p, grid / 2, gridOrigin);
}

// The frame names (`eda_draw_frame.h:70-77`), which an item's message panel reads to know
// which editor it is describing itself for.
export const SCH_EDIT_FRAME_NAME = 'SchematicFrame';
export const SYMBOL_CHOOSER_FRAME_NAME = 'SymbolChooserFrame';
export const PL_EDITOR_FRAME_NAME = 'PlEditorFrame';
export const FOOTPRINT_WIZARD_FRAME_NAME = 'FootprintWizard';
export const FOOTPRINT_CHOOSER_FRAME_NAME = 'FootprintChooserFrame';
export const FOOTPRINT_EDIT_FRAME_NAME = 'ModEditFrame';
export const FOOTPRINT_VIEWER_FRAME_NAME = 'ModViewFrame';
export const PCB_EDIT_FRAME_NAME = 'PcbFrame';

export abstract class EDA_DRAW_FRAME extends EDA_BASE_FRAME {
  protected m_canvas: EDA_DRAW_PANEL_GAL | null = null;
  protected m_currentScreen: BASE_SCREEN | null = null; ///< current used SCREEN
  protected m_colorSettings: COLOR_SETTINGS | null = null;
  protected m_galDisplayOptions: GAL_DISPLAY_OPTIONS_IMPL = new GAL_DISPLAY_OPTIONS_IMPL();
  protected m_canvasType: GAL_TYPE = GAL_TYPE.GAL_TYPE_OPENGL;

  /// Show the drawing sheet (border & title block).
  protected m_showBorderAndTitleBlock = false;

  /// Choice box to choose the grid size.
  protected m_gridSelectBox: wxChoice | null = null;
  /// Choice box to choose the zoom value.
  protected m_zoomSelectBox: wxChoice | null = null;
  /// Index of the off-preset "Zoom %.2f" entry, or wxNOT_FOUND.
  protected m_zoomCustomEntry = wxNOT_FOUND;

  /// For those frames that support polar coordinates.
  protected m_polarCoords = false;

  constructor(aFrameType: FRAME_T, aIuScale: EdaIuScale, aUnits: EdaUnits) {
    super(aFrameType, aIuScale, aUnits);
  }

  /**
   * Return a pointer to GAL-based canvas of given EDA draw frame.
   */
  GetCanvas(): EDA_DRAW_PANEL_GAL | null {
    return this.m_canvas;
  }

  SetCanvas(aPanel: EDA_DRAW_PANEL_GAL | null): void {
    this.m_canvas = aPanel;
  }

  /**
   * `findDialogs()`: the DIALOG_SHIM children of the frame, as the screen
   * rectangles FocusOnLocation and FocusOnItems steer clear of. A window
   * without children answers none; the designer's frames list their open
   * modeless dialogs.
   */
  findDialogRects(): BOX2D[] {
    return [];
  }

  /**
   * `KIGFX::VIEW::SetCenter( aPos, dialogScreenRects )` as the window applies it.
   * The designer's editor still owns the view transform (its VIEW is synced
   * from it), so the frame lets it perform the centre; the base uses the VIEW.
   */
  protected setViewCenter(aPos: Vec2, aObscuringScreenRects: readonly BOX2D[]): void {
    this.GetCanvas()!.GetView().SetCenter(aPos, aObscuringScreenRects);
  }

  /**
   * Focus on a particular canvas location.
   *
   * The view will be centred on the location if it is not already in view, or
   * behind an obscuring dialog.
   */
  FocusOnLocation(aPos: Vec2, aAllowScroll = true): void {
    let centerView = false;
    const dialogScreenRects: BOX2D[] = [];

    if (aAllowScroll) {
      const r = this.GetCanvas()!.GetView().GetViewport();

      // Center if we're off the current view, or within 10% of its edge
      r.Inflate(-r.GetWidth() / 10.0);

      if (!r.Contains(aPos)) centerView = true;

      for (const dialog of this.findDialogRects()) dialogScreenRects.push(dialog);

      // Center if we're behind an obscuring dialog, or within 10% of its edge
      for (const rect of dialogScreenRects) {
        const inflated = new BOX2D(rect.GetOrigin(), rect.GetSize());
        inflated.Inflate(inflated.GetWidth() / 10);

        if (inflated.Contains(this.GetCanvas()!.GetView().ToScreen(aPos))) centerView = true;
      }
    }

    if (centerView) {
      try {
        this.setViewCenter(aPos, dialogScreenRects);
      } catch (e) {
        // wxFAIL_MSG( "Clipper2 exception occurred centering object" )
        console.error('Clipper2 exception occurred centering object:', e);
      }
    }

    this.GetCanvas()!.GetViewControls().SetCrossHairCursorPosition(aPos);
  }

  /**
   * Focus on a particular item.
   */
  FocusOnItem(_aItem: EDA_ITEM | null, _aAllowScroll = true): void {}

  ClearFocus(): void {
    this.FocusOnItem(null);
  }

  GetGalDisplayOptions(): GAL_DISPLAY_OPTIONS_IMPL {
    return this.m_galDisplayOptions;
  }

  /**
   * `Kiway().Player( aFrameType, false )`: the sibling frame if it is open.
   * KIWAY is the desktop's window broker; the designer's frames answer with
   * theirs, and the base has no siblings.
   */
  KiwayPlayer(_aFrameType: FRAME_T): unknown {
    return null;
  }

  /** `wxWindow::Raise()`: bring the frame to the front. */
  Raise(): void {}

  /**
   * Use to start up the GAL drawing canvas.
   */
  ActivateGalCanvas(): void {
    // GetCanvas()->SetEvtHandlerEnabled( true );
    this.GetCanvas()!.StartDrawing();
  }

  /**
   * Change the current rendering backend.
   */
  SwitchCanvas(aCanvasType: GAL_TYPE): void {
    this.GetCanvas()!.SwitchBackend(aCanvasType);
    this.m_canvasType = this.GetCanvas()!.GetBackend();

    this.ActivateGalCanvas();
  }

  /**
   * Return a pointer to the active color theme settings.
   */
  GetColorSettings(aForceRefresh = false): COLOR_SETTINGS {
    if (!this.m_colorSettings || aForceRefresh) {
      const colorSettings = GetColorSettings(DEFAULT_THEME);
      this.m_colorSettings = colorSettings;
    }

    return this.m_colorSettings;
  }

  GetScreen(): BASE_SCREEN | null {
    return this.m_currentScreen;
  }

  SetScreen(aScreen: BASE_SCREEN | null): void {
    this.m_currentScreen = aScreen;
  }

  override GetToolCanvas(): unknown {
    return this.GetCanvas();
  }

  /**
   * Return the frame's name, for the message panel and cross-references.
   */
  abstract GetName(): string;

  /**
   * Return a reference to the default ORIGIN_TRANSFORMS object
   */
  abstract GetOriginTransforms(): ORIGIN_TRANSFORMS;

  /**
   * Fetch an item by KIID.  Frame-type-specific implementation.
   */
  ResolveItem(_aId: KIID, _aAllowNullptrReturn = false): EDA_ITEM | null {
    return null;
  }

  /**
   * Clear all messages from the message panel.
   */
  ClearMsgPanel(): void {}

  /**
   * Clear the message panel and populates it with the contents of \a aList.
   *
   * @param aList is the list of #MSG_PANEL_ITEM objects to fill the message panel.
   */
  SetMsgPanel(_aList: readonly MSG_PANEL_ITEM[]): void;
  SetMsgPanel(_aItem: EDA_ITEM): void;
  SetMsgPanel(_a: readonly MSG_PANEL_ITEM[] | EDA_ITEM): void {}

  /**
   * Redraw the message panel.
   */
  UpdateMsgPanel(): void {}

  // ---- grid ---------------------------------------------------------------

  /**
   * Return the absolute coordinates of the origin of the snap grid.
   *
   * This is treated as a relative offset and snapping will occur at multiples
   * of the grid size relative to this point.
   */
  abstract GetGridOrigin(): VECTOR2I;
  abstract SetGridOrigin(aPosition: VECTOR2I): void;

  MakeGridHelper(): GRID_HELPER_LIKE | null {
    return null;
  }

  /**
   * @return true if the grid must be shown.
   */
  IsGridVisible(): boolean {
    const cfg = this.config();

    if (!cfg) return true;

    return this.GetWindowSettings(cfg).grid.show;
  }

  /**
   * It may be overloaded by derived classes.
   *
   * @param aVisible true if the grid must be shown.
   */
  SetGridVisibility(aVisible: boolean): void {
    const cfg = this.config();

    if (!cfg) return;

    this.GetWindowSettings(cfg).grid.show = aVisible;

    // Update the display with the new grid
    const canvas = this.GetCanvas();

    if (canvas) {
      // Check to ensure these exist, since this function could be called before
      // the GAL and View have been created
      canvas.GetGAL()?.SetGridVisibility(aVisible);
      canvas.GetView()?.MarkTargetDirty(RENDER_TARGET.TARGET_NONCACHED);

      canvas.Refresh();
    }
  }

  IsGridOverridden(): boolean {
    const cfg = this.config();

    if (!cfg) return false;

    return this.GetWindowSettings(cfg).grid.overrides_enabled;
  }

  SetGridOverrides(aOverride: boolean): void {
    const cfg = this.config();

    if (!cfg) return;

    this.GetWindowSettings(cfg).grid.overrides_enabled = aOverride;
  }

  /**
   * Return the nearest \a aGridSize location to \a aPosition.
   *
   * @param aPosition The position to check.
   * @return The nearest grid position.
   */
  GetNearestGridPosition(aPosition: VECTOR2I): VECTOR2I {
    const gridOrigin = this.GetGridOrigin();
    const gridSize = this.GetCanvas()!.GetGAL()!.GetGridSize();

    const xOffset = gridOrigin.x % gridSize.x;
    const x = KiROUND((aPosition.x - xOffset) / gridSize.x);
    const yOffset = gridOrigin.y % gridSize.y;
    const y = KiROUND((aPosition.y - yOffset) / gridSize.y);

    return { x: KiROUND(x * gridSize.x + xOffset), y: KiROUND(y * gridSize.y + yOffset) };
  }

  /**
   * Return the nearest \a aGridSize / 2 location to \a aPosition.
   */
  GetNearestHalfGridPosition(aPosition: VECTOR2I): VECTOR2I {
    const gridOrigin = this.GetGridOrigin();
    const g = this.GetCanvas()!.GetGAL()!.GetGridSize();
    const gridSize = { x: g.x / 2.0, y: g.y / 2.0 };

    const xOffset = gridOrigin.x % gridSize.x;
    const x = KiROUND((aPosition.x - xOffset) / gridSize.x);
    const yOffset = gridOrigin.y % gridSize.y;
    const y = KiROUND((aPosition.y - yOffset) / gridSize.y);

    return { x: KiROUND(x * gridSize.x + xOffset), y: KiROUND(y * gridSize.y + yOffset) };
  }

  /**
   * Rebuild the grid combobox to respond to any changes in the GUI (units, user
   * grid changes, etc.).
   */
  UpdateGridSelectBox(): void {
    this.UpdateStatusBar();
    this.DisplayUnitsMsg();

    if (this.m_gridSelectBox === null) return;

    // Update grid values with the current units setting.
    this.m_gridSelectBox.Clear();
    const gridsList: string[] = [];

    const cfg = this.config();

    if (!cfg) return;

    GRID_MENU.BuildChoiceList(gridsList, this.GetWindowSettings(cfg), this);

    for (const grid of gridsList) this.m_gridSelectBox.Append(grid);

    this.m_gridSelectBox.Append('---');
    this.m_gridSelectBox.Append('Edit Grids...');

    this.m_gridSelectBox.SetSelection(this.GetWindowSettings(cfg).grid.last_size_idx);
  }

  /**
   * Update the checked item in the grid wxchoice.
   */
  OnUpdateSelectGrid(): void {
    // No need to update the grid select box if it doesn't exist or the grid setting change
    // was made using the select box.
    if (this.m_gridSelectBox === null) return;

    const cfg = this.config();

    if (!cfg) return;

    let idx = this.GetWindowSettings(cfg).grid.last_size_idx;
    idx = Math.min(Math.max(idx, 0), this.m_gridSelectBox.GetCount() - 1);

    if (idx !== this.m_gridSelectBox.GetSelection()) this.m_gridSelectBox.SetSelection(idx);
  }

  /**
   * Command event handler for selecting grid sizes.
   *
   * All commands that set the grid size should eventually end up here.
   * This is where the application setting is saved.  If you override
   * this method, make sure you call down to the base class.
   */
  OnSelectGrid(): void {
    if (!this.m_gridSelectBox) {
      console.assert(false, 'm_gridSelectBox uninitialized');
      return;
    }

    const idx = this.m_gridSelectBox.GetCurrentSelection();

    if (idx === this.m_gridSelectBox.GetCount() - 2) {
      // wxWidgets will check the separator, which we don't want.
      // Re-check the current grid.
      this.OnUpdateSelectGrid();
    } else if (idx === this.m_gridSelectBox.GetCount() - 1) {
      // wxWidgets will check the Grid Settings... entry, which we don't want.
      // Re-check the current grid.
      this.OnUpdateSelectGrid();

      this.m_toolManager!.RunAction(ACTIONS.gridProperties);
    } else {
      this.m_toolManager!.RunAction(ACTIONS.gridPreset, idx);
    }

    this.UpdateStatusBar();
    this.m_canvas?.Refresh();

    // Needed on Windows because clicking on m_gridSelectBox remove the focus from m_canvas
    // (Windows specific
    this.m_canvas?.SetFocus();
  }

  /** The grid choice box, when the frame's toolbar has one. */
  GetGridSelectBox(): wxChoice | null {
    return this.m_gridSelectBox;
  }

  /** `ClearToolbarControl` / the grid control factory's `new wxChoice`. */
  SetGridSelectBox(aBox: wxChoice | null): void {
    this.m_gridSelectBox = aBox;
  }

  // ---- zoom ---------------------------------------------------------------

  /**
   * Update the checked item in the zoom wxchoice.
   */
  UpdateZoomSelectBox(): void {
    if (this.m_zoomSelectBox === null) return;

    const zoom = this.m_canvas!.GetGAL()!.GetZoomFactor();

    this.m_zoomSelectBox.Clear();
    this.m_zoomSelectBox.Append('Zoom Auto');
    this.m_zoomSelectBox.SetSelection(0);
    this.m_zoomCustomEntry = wxNOT_FOUND;

    const cfg = this.config();

    if (!cfg) return;

    const zoomFactors = this.GetWindowSettings(cfg).zoom_factors;

    for (let ii = 0; ii < zoomFactors.length; ++ii) {
      const current = zoomFactors[ii]!;

      this.m_zoomSelectBox.Append(`Zoom ${current.toFixed(2)}`);

      if (zoom === current) this.m_zoomSelectBox.SetSelection(ii + 1);
    }
  }

  OnUpdateSelectZoom(): void {
    if (this.m_zoomSelectBox === null) return;

    const zoom = this.GetCanvas()!.GetGAL()!.GetZoomFactor();

    const cfg = this.config();

    if (!cfg) return;

    const zoomList = this.GetWindowSettings(cfg).zoom_factors;
    let preset = wxNOT_FOUND;

    for (let jj = 0; jj < zoomList.length; ++jj) {
      if (zoomList[jj] === zoom) {
        preset = jj + 1; // index 0 is Zoom Auto
        break;
      }
    }

    if (preset !== wxNOT_FOUND) {
      // Zoom is on a preset, so drop the custom entry and select the preset.
      if (this.m_zoomCustomEntry !== wxNOT_FOUND) {
        this.m_zoomSelectBox.Delete(this.m_zoomCustomEntry);
        this.m_zoomCustomEntry = wxNOT_FOUND;
      }

      if (this.m_zoomSelectBox.GetSelection() !== preset) this.m_zoomSelectBox.SetSelection(preset);
    } else {
      // Off-preset zoom, show the exact value in its own entry just below Zoom Auto.
      const text = `Zoom ${zoom.toFixed(2)}`;

      if (this.m_zoomCustomEntry === wxNOT_FOUND)
        this.m_zoomCustomEntry = this.m_zoomSelectBox.Insert(text, 1);
      else if (this.m_zoomSelectBox.GetString(this.m_zoomCustomEntry) !== text)
        this.m_zoomSelectBox.SetString(this.m_zoomCustomEntry, text);

      if (this.m_zoomSelectBox.GetSelection() !== this.m_zoomCustomEntry)
        this.m_zoomSelectBox.SetSelection(this.m_zoomCustomEntry);
    }
  }

  /**
   * Set the zoom factor when selected by the zoom list box in the main tool bar.
   *
   * @note List position 0 is fit to page.
   *       List position >= 1 = zoom (1 to zoom max).
   *       Last list position is custom zoom not in zoom list.
   */
  OnSelectZoom(): void {
    if (!this.m_zoomSelectBox) {
      console.assert(false, 'm_zoomSelectBox uninitialized');
      return;
    }

    const id = this.m_zoomSelectBox.GetCurrentSelection();

    if (id < 0 || id >= this.m_zoomSelectBox.GetCount()) return;

    // Picking the custom entry means keep the current zoom, so nothing to do.
    if (id === this.m_zoomCustomEntry) return;

    // The custom entry pushes the presets down by one, so shift back to the real preset id.
    let preset = id;

    if (this.m_zoomCustomEntry !== wxNOT_FOUND && id > this.m_zoomCustomEntry) preset = id - 1;

    this.m_toolManager!.RunAction(ACTIONS.zoomPreset, preset);
    this.UpdateStatusBar();
    this.m_canvas?.Refresh();

    // Needed on Windows (only) because clicking on m_zoomSelectBox removes the focus from m_canvas
    this.m_canvas?.SetFocus();
  }

  GetZoomSelectBox(): wxChoice | null {
    return this.m_zoomSelectBox;
  }

  SetZoomSelectBox(aBox: wxChoice | null): void {
    this.m_zoomSelectBox = aBox;
    this.m_zoomCustomEntry = wxNOT_FOUND;
  }

  /**
   * Return a human readable value for display in dialogs.
   */
  GetZoomLevelIndicator(): string {
    // returns a human readable value which can be displayed as zoom
    // level indicator in dialogs.
    const zoom = this.m_canvas!.GetGAL()!.GetZoomFactor();
    return `Z ${zoom.toFixed(2)}`;
  }

  /**
   * Rebuild all toolbars and update the checked state of check tools.
   */
  Zoom_Automatique(_aWarpPointer: boolean): void {
    this.m_toolManager!.RunAction(ACTIONS.zoomFitScreen);
  }

  /**
   * Returns bbox of document with option to not include some items.
   *
   * Used most commonly by "Zoom to Fit" and "Zoom to Objects".  In Eeschema
   * for "Zoom to Fit" it's the page and any items outside the page.
   */
  GetDocumentExtents(_aIncludeAllVisible = true): BOX2I {
    return new BOX2I();
  }

  /**
   * Rebuild the GAL and redraws the screen.  Call when something went wrong.
   */
  HardRedraw(): void {
    // To be implemented by subclasses.
  }

  // ---- units and the status bar -------------------------------------------

  GetShowPolarCoords(): boolean {
    return this.m_polarCoords;
  }

  SetShowPolarCoords(aShow: boolean): void {
    this.m_polarCoords = aShow;
  }

  /** `EDA_BASE_FRAME::ChangeUserUnits`. */
  ChangeUserUnits(aUnits: EdaUnits): void {
    this.SetUserUnits(aUnits);
    this.unitsChangeRefresh();
  }

  /**
   * Called when when the units setting has changed to allow for any derived classes
   * to handle refreshing and controls that have units based measurements in them.
   *
   * The toolbar's check state is `ACTION_MANAGER`'s conditions here, so the
   * `SelectToolbarAction` calls have nothing to set.
   */
  protected unitsChangeRefresh(): void {
    // Notify all tools the units have changed
    if (this.m_toolManager) this.m_toolManager.RunAction(ACTIONS.updateUnits);

    this.UpdateStatusBar();
    this.UpdateMsgPanel();
  }

  ToggleUserUnits(): void {
    const cmnTool = this.m_toolManager?.GetTool(COMMON_TOOLS) ?? null;

    if (cmnTool) {
      cmnTool.ToggleUnits();
    } else {
      this.SetUserUnits(this.GetUserUnits() === 'in' ? 'mm' : 'in');
      this.unitsChangeRefresh();
    }
  }

  /**
   * Get the pair or units in current use.
   *
   * The primary unit is the main unit of the frame, and the secondary unit is the unit
   * of the other system that was used most recently.
   */
  GetUnitPair(): { primary: EdaUnits; secondary: EdaUnits } {
    const cmnTool = this.m_toolManager?.GetTool(COMMON_TOOLS) ?? null;

    const primary = this.GetUserUnits();
    let secondary: EdaUnits = 'mils';

    if (IsImperialUnit(primary)) {
      if (cmnTool) secondary = cmnTool.GetLastMetricUnits();
      else secondary = 'mm';
    } else {
      if (cmnTool) secondary = cmnTool.GetLastImperialUnits();
      else secondary = 'mils';
    }

    return { primary, secondary };
  }

  protected setupUnits(aCfg: APP_SETTINGS_BASE): void {
    const cmnTool = this.m_toolManager!.GetTool(COMMON_TOOLS);

    if (cmnTool) {
      // Tell the tool what the units used last session
      cmnTool.SetLastUnits(EdaUnitsFromInt(aCfg.m_System.last_imperial_units));
      cmnTool.SetLastUnits(EdaUnitsFromInt(aCfg.m_System.last_metric_units));
    }

    // Tell the tool what units the frame is currently using
    switch (EdaUnitsFromInt(aCfg.m_System.units)) {
      default:
      case 'mm':
        this.m_toolManager!.RunAction(ACTIONS.millimetersUnits);
        break;
      case 'in':
        this.m_toolManager!.RunAction(ACTIONS.inchesUnits);
        break;
      case 'mils':
        this.m_toolManager!.RunAction(ACTIONS.milsUnits);
        break;
    }
  }

  /**
   * Update the status bar information.
   *
   * The EDA_DRAW_FRAME level updates the zoom and units display; derived
   * frames add the cursor position and deltas.
   */
  override UpdateStatusBar(): void {
    if (this.m_isClosing) return;

    // Upstream every draw frame has its canvas from construction. Here a
    // frame whose canvas is not hosted on the GAL yet (the board editor's)
    // has no zoom factor to report, and the field is the page's.
    if (this.m_canvas?.GetGAL()) this.SetStatusText(this.GetZoomLevelIndicator(), 1);

    // Absolute and relative cursor positions are handled by overloading this function and
    // handling the internal to user units conversion at the appropriate level.

    // refresh units display
    this.DisplayUnitsMsg();
  }

  /**
   * Send a message to the status bar field reserved for the current tool.
   */
  override DisplayToolMsg(msg: string): void {
    if (this.m_isClosing) return;

    this.SetStatusText(msg, 6);
  }

  /**
   * Send a message to the status bar field reserved for the constraints mode.
   */
  DisplayConstraintsMsg(msg: string): void {
    if (this.m_isClosing) return;

    this.SetStatusText(msg, 7);
  }

  /**
   * Display current grid size in the status bar.
   */
  DisplayGridMsg(): void {
    if (this.m_isClosing) return;

    const cfg = this.m_toolManager?.GetSettings() as APP_SETTINGS_BASE | null;

    if (!cfg) return;

    const gridSettings = cfg.m_Window.grid;
    const currentIdx = cfg.m_Window.grid.last_size_idx;
    const grid = gridSettings.grids[currentIdx];

    if (!grid) return;

    const msg = `grid ${grid.UserUnitsMessageText(this, false)}`;

    this.SetStatusText(msg, 4);
  }

  /**
   * Display current unit pane in the status bar.
   */
  DisplayUnitsMsg(): void {
    if (this.m_isClosing) return;

    let msg: string;

    switch (this.GetUserUnits()) {
      case 'in':
        msg = 'inches';
        break;
      case 'mils':
        msg = 'mils';
        break;
      case 'mm':
        msg = 'mm';
        break;
      default:
        msg = 'Units';
        break;
    }

    this.SetStatusText(msg, 5);
  }

  // ---- settings -----------------------------------------------------------

  /**
   * Load settings related to the canvas and the frame's units.
   *
   * The find/replace history and the toolbar icon size are the page's.
   */
  override LoadSettings(aCfg: APP_SETTINGS_BASE): void {
    super.LoadSettings(aCfg);

    const window = this.GetWindowSettings(aCfg);

    // Read units used in dialogs and toolbars
    this.SetUserUnits(EdaUnitsFromInt(aCfg.m_System.units));

    this.m_undoRedoCountMax = aCfg.m_System.max_undo_items;

    // m_galDisplayOptions.ReadConfig( *cmnCfg, *window, this ): the common
    // half is read at startup (PGM_BASE); the window half is the frame's.
    this.m_galDisplayOptions.ReadWindowSettings(window);
  }

  override SaveSettings(aCfg: APP_SETTINGS_BASE): void {
    super.SaveSettings(aCfg);

    const window = this.GetWindowSettings(aCfg);

    aCfg.m_System.units = EdaUnitsToInt(this.GetUserUnits());
    aCfg.m_System.max_undo_items = this.GetMaxUndoItems();

    this.m_galDisplayOptions.WriteConfig(window);

    // Save the units used in this frame
    if (this.m_toolManager) {
      const cmnTool = this.m_toolManager.GetTool(COMMON_TOOLS);

      if (cmnTool) {
        aCfg.m_System.last_imperial_units = EdaUnitsToInt(cmnTool.GetLastImperialUnits());
        aCfg.m_System.last_metric_units = EdaUnitsToInt(cmnTool.GetLastMetricUnits());
      }
    }
  }

  // ---- dialogs the tools open ---------------------------------------------

  private m_pointEntryPresenter:
    | ((
        aTitle: string,
        aLabelX: string,
        aLabelY: string,
        aValue: VECTOR2I,
        aShowResetButton: boolean,
      ) => Promise<VECTOR2I | null>)
    | null = null;

  /**
   * `WX_PT_ENTRY_DIALOG( this, title, labelX, labelY, value, showReset ).ShowModal()`,
   * resolved with the entered point on OK and null on Cancel. The dialog is
   * the page's (`common/dialogs/dialog_unit_entry.tsx`).
   */
  ShowPointEntryDialog(
    aTitle: string,
    aLabelX: string,
    aLabelY: string,
    aValue: VECTOR2I,
    aShowResetButton: boolean,
  ): Promise<VECTOR2I | null> {
    if (!this.m_pointEntryPresenter) return Promise.resolve(null);

    return this.m_pointEntryPresenter(aTitle, aLabelX, aLabelY, aValue, aShowResetButton);
  }

  SetPointEntryPresenter(
    aPresenter:
      | ((
          aTitle: string,
          aLabelX: string,
          aLabelY: string,
          aValue: VECTOR2I,
          aShowResetButton: boolean,
        ) => Promise<VECTOR2I | null>)
      | null,
  ): void {
    this.m_pointEntryPresenter = aPresenter;
  }
}
