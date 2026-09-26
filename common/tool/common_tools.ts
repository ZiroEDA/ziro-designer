// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/common_tools.cpp` + `include/tool/common_tools.h`:
 * `COMMON_TOOLS`, the actions every draw frame shares - zoom, pan, the
 * keyboard cursor, the grid, units and the crosshair modes.
 *
 * Every handler is a plain function upstream (none waits on an event), so
 * each is a generator that returns at once.
 */

import type { COROUTINE_BODY } from './coroutine.js';
import { FRAME_T } from '../frame_type.js';
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import { DoubleValueFromStringIn, type EdaUnits } from '../eda_units.js';
import { CROSS_HAIR_MODE } from '../gal/gal_display_options.js';
import { RENDER_TARGET } from '../gal/definitions.js';
import { IsImperialUnit, IsMetricUnit } from '../units_provider.js';
import type { VIEW_CONTROLS } from '../view/view_controls.js';
import { VIEW_UPDATE_FLAGS } from '../view/view_item.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { wxGetKeyState } from '../wx/wx_event.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2D, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ACTIONS, CURSOR_EVENT_TYPE, EVENTS } from './actions.js';
import { RESET_REASON } from './tool_base.js';
import {
  AS_GLOBAL,
  BUT_LEFT,
  BUT_RIGHT,
  MD_ALT,
  MD_CTRL,
  MD_SHIFT,
  TA_CANCEL_TOOL,
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TC_COMMAND,
  TC_MOUSE,
  TOOL_EVENT,
} from './tool_event.js';
import { TOOL_INTERACTIVE } from './tool_interactive.js';

/**
 * The set of "Zoom to Fit" types that can be performed.
 */
enum ZOOM_FIT_TYPE_T {
  ZOOM_FIT_ALL, ///< Zoom to fall all items in view INCLUDING page and border
  ZOOM_FIT_OBJECTS, ///< Zoom to fit all items in view EXCLUDING page and border
  ZOOM_FIT_SELECTION, ///< Zoom to fit selected items in view
}

enum CENTER_TYPE {
  CENTER_CONTENTS,
  CENTER_SELECTION,
}

/**
 * Handles action that are shared between different applications.
 */
export class COMMON_TOOLS extends TOOL_INTERACTIVE {
  ///< Pointer to the currently used edit frame.
  private m_frame: EDA_DRAW_FRAME | null;

  ///< Grids from #APP_SETTINGS converted to internal units and with the user grid appended.
  private m_grids: VECTOR2I[] = [];

  // The last used units in each system (used for toggling between metric and imperial)
  private m_imperialUnit: EdaUnits;
  private m_metricUnit: EdaUnits;

  constructor() {
    super('common.Control');
    this.m_frame = null;
    this.m_imperialUnit = 'in';
    this.m_metricUnit = 'mm';
  }

  private frame(): EDA_DRAW_FRAME {
    return this.m_frame!;
  }

  /** `getViewControls()`, as the VIEW_CONTROLS the canvas made. */
  private vc(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  private windowSettings() {
    return this.frame().GetWindowSettings(this.frame().config()!);
  }

  /// @copydoc TOOL_BASE::Reset()
  override Reset(aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<EDA_DRAW_FRAME>();
    this.m_grids = [];

    if (aReason === RESET_REASON.SHUTDOWN) return;

    const settings = this.windowSettings().grid;

    // Protect against misconfigured settings with no grids
    if (settings.grids.length === 0) settings.grids = this.frame().config()!.DefaultGridSizeList();

    const scale = this.frame().GetIuScale();

    for (const gridDef of settings.grids) {
      const gridSizeX = DoubleValueFromStringIn(scale, 'mm', gridDef.x);
      const gridSizeY = DoubleValueFromStringIn(scale, 'mm', gridDef.y);

      this.m_grids.push({ x: KiROUND(gridSizeX), y: KiROUND(gridSizeY) });
    }

    this.OnGridChanged(false);
  }

  SetLastUnits(aUnit: EdaUnits): void {
    if (IsImperialUnit(aUnit)) this.m_imperialUnit = aUnit;
    else if (IsMetricUnit(aUnit)) this.m_metricUnit = aUnit;
    else console.assert(false, 'Invalid unit');
  }

  GetLastMetricUnits(): EdaUnits {
    return this.m_metricUnit;
  }

  GetLastImperialUnits(): EdaUnits {
    return this.m_imperialUnit;
  }

  *SelectionTool(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // Since selection tools are run permanently underneath the toolStack, this is really
    // just a cancel of whatever other tools might be running.

    this.m_toolMgr!.ProcessEvent(new TOOL_EVENT(TC_COMMAND, TA_CANCEL_TOOL));
    return 0;
  }

  // Cursor control

  *CursorControl(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.cursorControl(aEvent);
  }

  private cursorControl(aEvent: TOOL_EVENT): number {
    const type = aEvent.Parameter<CURSOR_EVENT_TYPE>();
    const grid = this.frame().MakeGridHelper();
    let gridSize: VECTOR2D;

    if (grid)
      gridSize = grid.GetGridSize(grid.GetSelectionGrid(this.frame().GetCurrentSelection()));
    else gridSize = this.getView()!.GetGAL()!.GetGridSize();

    const mirroredX = this.getView()!.IsMirroredX();
    let cursor = this.vc().GetCursorPosition(false);

    const selection = this.frame().GetCurrentSelection();

    if (
      !this.vc().GetSettings().m_lastKeyboardCursorPositionValid &&
      selection.HasReferencePoint()
    ) {
      cursor = selection.GetReferencePoint();
    }

    const fast = (): void => {
      gridSize = { x: gridSize.x * 10, y: gridSize.y * 10 };
    };

    switch (type) {
      case CURSOR_EVENT_TYPE.CURSOR_UP_FAST:
      case CURSOR_EVENT_TYPE.CURSOR_UP:
        if (type === CURSOR_EVENT_TYPE.CURSOR_UP_FAST) fast();
        cursor = { x: cursor.x, y: cursor.y - gridSize.y };
        break;

      case CURSOR_EVENT_TYPE.CURSOR_DOWN_FAST:
      case CURSOR_EVENT_TYPE.CURSOR_DOWN:
        if (type === CURSOR_EVENT_TYPE.CURSOR_DOWN_FAST) fast();
        cursor = { x: cursor.x, y: cursor.y + gridSize.y };
        break;

      case CURSOR_EVENT_TYPE.CURSOR_LEFT_FAST:
      case CURSOR_EVENT_TYPE.CURSOR_LEFT:
        if (type === CURSOR_EVENT_TYPE.CURSOR_LEFT_FAST) fast();
        cursor = { x: cursor.x - (mirroredX ? -gridSize.x : gridSize.x), y: cursor.y };
        break;

      case CURSOR_EVENT_TYPE.CURSOR_RIGHT_FAST:
      case CURSOR_EVENT_TYPE.CURSOR_RIGHT:
        if (type === CURSOR_EVENT_TYPE.CURSOR_RIGHT_FAST) fast();
        cursor = { x: cursor.x + (mirroredX ? -gridSize.x : gridSize.x), y: cursor.y };
        break;

      case CURSOR_EVENT_TYPE.CURSOR_CLICK: // fall through
      case CURSOR_EVENT_TYPE.CURSOR_DBL_CLICK:
      case CURSOR_EVENT_TYPE.CURSOR_RIGHT_CLICK: {
        let action = TA_MOUSE_CLICK;
        let button = BUT_LEFT;
        let modifiers = 0;

        modifiers |= wxGetKeyState(WXK.WXK_SHIFT) ? MD_SHIFT : 0;
        modifiers |= wxGetKeyState(WXK.WXK_CONTROL) ? MD_CTRL : 0;
        modifiers |= wxGetKeyState(WXK.WXK_ALT) ? MD_ALT : 0;

        if (type === CURSOR_EVENT_TYPE.CURSOR_DBL_CLICK) action = TA_MOUSE_DBLCLICK;
        else if (type === CURSOR_EVENT_TYPE.CURSOR_RIGHT_CLICK) button = BUT_RIGHT;

        const evt = new TOOL_EVENT(TC_MOUSE, action, button | modifiers, AS_GLOBAL);
        evt.SetParameter(type);
        evt.SetMousePosition(this.vc().GetMousePosition());
        this.m_toolMgr!.ProcessEvent(evt);

        return 0;
      }
      default:
        console.assert(false, 'CursorControl(): unexpected request');
    }

    this.vc().SetCursorPosition(cursor, true, true, type);
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

    return 0;
  }

  *PanControl(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const type = aEvent.Parameter<CURSOR_EVENT_TYPE>();
    const view = this.getView()!;
    let center = view.GetCenter();
    const g = view.GetGAL()!.GetGridSize();
    const gridSize = { x: g.x * 10, y: g.y * 10 };
    const mirroredX = view.IsMirroredX();

    switch (type) {
      case CURSOR_EVENT_TYPE.CURSOR_UP:
        center = { x: center.x, y: center.y - gridSize.y };
        break;

      case CURSOR_EVENT_TYPE.CURSOR_DOWN:
        center = { x: center.x, y: center.y + gridSize.y };
        break;

      case CURSOR_EVENT_TYPE.CURSOR_LEFT:
        center = { x: center.x - (mirroredX ? -gridSize.x : gridSize.x), y: center.y };
        break;

      case CURSOR_EVENT_TYPE.CURSOR_RIGHT:
        center = { x: center.x + (mirroredX ? -gridSize.x : gridSize.x), y: center.y };
        break;

      default:
        console.assert(false);
        break;
    }

    view.SetCenter(center);

    return 0;
  }

  // View controls

  *ZoomRedraw(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    this.frame().HardRedraw();
    return 0;
  }

  *ZoomInOut(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const direction = aEvent.IsAction(ACTIONS.zoomIn);
    return this.doZoomInOut(direction, true);
  }

  *ZoomInOutCenter(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const direction = aEvent.IsAction(ACTIONS.zoomInCenter);
    return this.doZoomInOut(direction, false);
  }

  private doZoomInOut(aDirection: boolean, aCenterOnCursor: boolean): number {
    let zoom = this.getView()!.GetGAL()!.GetZoomFactor();

    // Step must be AT LEAST 1.3
    if (aDirection) zoom *= 1.3;
    else zoom /= 1.3;

    // Now look for the next closest menu step
    const zoomList = this.windowSettings().zoom_factors;
    let idx: number;

    if (aDirection) {
      for (idx = 0; idx < zoomList.length; ++idx) {
        if (zoomList[idx]! >= zoom) break;
      }

      if (idx >= zoomList.length) idx = zoomList.length - 1; // if we ran off the end then peg to the end
    } else {
      for (idx = zoomList.length - 1; idx >= 0; --idx) {
        if (zoomList[idx]! <= zoom) break;
      }

      if (idx < 0) idx = 0; // if we ran off the end then peg to the end
    }

    // Note: idx == 0 is Auto; idx == 1 is first entry in zoomList
    return this.doZoomToPreset(idx + 1, aCenterOnCursor);
  }

  *ZoomCenter(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const ctls = this.vc();

    ctls.CenterOnCursor();

    return 0;
  }

  *ZoomFitScreen(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.doZoomFit(ZOOM_FIT_TYPE_T.ZOOM_FIT_ALL);
  }

  *ZoomFitObjects(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.doZoomFit(ZOOM_FIT_TYPE_T.ZOOM_FIT_OBJECTS);
  }

  *ZoomFitSelection(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.doZoomFit(ZOOM_FIT_TYPE_T.ZOOM_FIT_SELECTION);
  }

  private doZoomFit(aFitTypeIn: ZOOM_FIT_TYPE_T): number {
    let aFitType = aFitTypeIn;
    const view = this.getView()!;
    const canvas = this.frame().GetCanvas()!;
    const frame = this.getEditFrame<EDA_DRAW_FRAME>();

    let bBox = frame.GetDocumentExtents();
    const defaultBox = canvas.GetDefaultViewBBox() ?? new BOX2I();

    view.SetScale(1.0); // The best scale will be determined later, but this initial
    // value ensures all view parameters are up to date (especially
    // at init time)
    const client = canvas.GetClientSize();
    const screenSize = view.ToWorld({ x: client.x, y: client.y }, false) as VECTOR2D;

    // Currently "Zoom to Objects" is only supported in Eeschema & Pcbnew.  Support for other
    // programs in the suite can be added as needed.

    if (aFitType === ZOOM_FIT_TYPE_T.ZOOM_FIT_ALL) {
      if (frame.IsType(FRAME_T.FRAME_PCB_EDITOR)) bBox = this.frame().GetDocumentExtents(false);
    }

    if (aFitType === ZOOM_FIT_TYPE_T.ZOOM_FIT_OBJECTS) {
      if (frame.IsType(FRAME_T.FRAME_SCH)) bBox = this.frame().GetDocumentExtents(false);
      else aFitType = ZOOM_FIT_TYPE_T.ZOOM_FIT_ALL; // Just do a "Zoom to Fit" for unsupported editors
    }

    if (aFitType === ZOOM_FIT_TYPE_T.ZOOM_FIT_SELECTION) {
      const selection = this.frame().GetCurrentSelection();

      if (selection.Empty()) return 0;

      bBox = selection.GetBoundingBox();
    }

    // If the screen is empty then use the default view bbox

    if (bBox.GetWidth() === 0 || bBox.GetHeight() === 0) bBox = defaultBox;

    const vsize = bBox.GetSize();
    const scale =
      view.GetScale() /
      Math.max(Math.abs(vsize.x / screenSize.x), Math.abs(vsize.y / screenSize.y));

    // if the scale isn't finite (most likely due to an empty canvas)
    // simply just make sure we are centered and quit out of trying to zoom to fit
    if (!Number.isFinite(scale)) {
      view.SetCenter({ x: 0, y: 0 });
      canvas.Refresh();
      return 0;
    }

    // Reserve enough margin to limit the amount of the view that might be obscured behind the
    // infobar.
    let margin_scale_factor = 1.04;

    if (canvas.GetClientSize().y < 768) margin_scale_factor = 1.1;

    if (aFitType === ZOOM_FIT_TYPE_T.ZOOM_FIT_ALL) {
      // Leave a bigger margin for library editors & viewers

      if (frame.IsType(FRAME_T.FRAME_FOOTPRINT_VIEWER) || frame.IsType(FRAME_T.FRAME_SCH_VIEWER)) {
        margin_scale_factor = 1.3;
      } else if (
        frame.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR) ||
        frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR)
      ) {
        margin_scale_factor = 1.48;
      }
    }

    view.SetScale(scale / margin_scale_factor);
    view.SetCenter(bBox.Centre());
    canvas.Refresh();

    return 0;
  }

  *CenterSelection(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.doCenter(CENTER_TYPE.CENTER_SELECTION);
  }

  *CenterContents(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.doCenter(CENTER_TYPE.CENTER_CONTENTS);
  }

  private doCenter(aCenterType: CENTER_TYPE): number {
    const canvas = this.frame().GetCanvas()!;
    let bBox: BOX2I;

    if (aCenterType === CENTER_TYPE.CENTER_SELECTION) {
      const selection = this.frame().GetCurrentSelection();

      // No selection: do nothing
      if (selection.Empty()) return 0;

      const c = selection.GetBoundingBox().Centre();
      bBox = new BOX2I(c);
    } else {
      bBox = this.getModel().ViewBBox();

      if (bBox.GetWidth() === 0 || bBox.GetHeight() === 0)
        bBox = canvas.GetDefaultViewBBox() ?? new BOX2I();
    }

    this.getView()!.SetCenter(bBox.Centre());

    // Take scrollbars into account: the element has none, so GetSize() is
    // the client size and the correction is zero.
    canvas.Refresh();

    return 0;
  }

  *ZoomPreset(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const idx = aEvent.Parameter<number>();
    return this.doZoomToPreset(idx, false);
  }

  // Note: idx == 0 is Auto; idx == 1 is first entry in zoomList
  private doZoomToPreset(aIdx: number, aCenterOnCursor: boolean): number {
    let idx = aIdx;
    const zoomList = this.windowSettings().zoom_factors;

    if (idx === 0) {
      // Zoom Auto
      return this.doZoomFit(ZOOM_FIT_TYPE_T.ZOOM_FIT_ALL);
    }

    idx--;

    const scale = zoomList[idx]!;

    if (aCenterOnCursor) {
      this.getView()!.SetScale(scale, this.vc().GetCursorPosition());

      if (this.vc().IsCursorWarpingEnabled()) this.vc().CenterOnCursor();
    } else {
      this.getView()!.SetScale(scale);
    }

    this.frame().GetCanvas()!.Refresh();

    return 0;
  }

  // Grid control

  *GridNext(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const grid = this.windowSettings().grid;

    grid.last_size_idx++;

    if (grid.last_size_idx >= this.m_grids.length) grid.last_size_idx = 0;

    return this.OnGridChanged(true);
  }

  *GridPrev(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const grid = this.windowSettings().grid;

    grid.last_size_idx--;

    if (grid.last_size_idx < 0) grid.last_size_idx = this.m_grids.length - 1;

    return this.OnGridChanged(true);
  }

  *GridPresetEvent(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.GridPreset(aEvent.Parameter<number>(), false);
  }

  GridPreset(idx: number, aFromHotkey: boolean): number {
    const grid = this.windowSettings().grid;

    grid.last_size_idx = Math.min(Math.max(idx, 0), this.m_grids.length - 1);

    return this.OnGridChanged(aFromHotkey);
  }

  OnGridChanged(aFromHotkey: boolean): number {
    const grid = this.windowSettings().grid;

    grid.last_size_idx = Math.max(0, Math.min(grid.last_size_idx, this.m_grids.length - 1));

    // Update the combobox (if any)
    this.frame().OnUpdateSelectGrid();

    // Update GAL canvas from screen
    const gal = this.getView()!.GetGAL()!;
    gal.SetGridSize(this.m_grids[grid.last_size_idx]!);
    gal.SetGridVisibility(grid.show);
    this.getView()!.MarkTargetDirty(RENDER_TARGET.TARGET_NONCACHED);

    // Put cursor on new grid
    const gridCursor = this.vc().GetCursorPosition(true);
    this.vc().SetCrossHairCursorPosition(gridCursor, false);

    // Show feedback
    if (aFromHotkey) this.m_toolMgr!.PostEvent(EVENTS.GridChangedByKeyEvent);

    return 0;
  }

  *GridFast1(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.GridPreset(this.windowSettings().grid.fast_grid_1, true);
  }

  *GridFast2(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.GridPreset(this.windowSettings().grid.fast_grid_2, true);
  }

  *GridFastCycle(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const grid = this.windowSettings().grid;

    if (grid.last_size_idx === grid.fast_grid_1) return this.GridPreset(grid.fast_grid_2, true);

    return this.GridPreset(grid.fast_grid_1, true);
  }

  *ToggleGrid(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    this.frame().SetGridVisibility(!this.frame().IsGridVisible());
    return 0;
  }

  *ToggleGridOverrides(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    this.frame().SetGridOverrides(!this.frame().IsGridOverridden());
    return 0;
  }

  *GridProperties(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const showGridPrefs = (aParentName: string): void => {
      this.frame().CallAfter(() => {
        this.frame().ShowPreferences('Grids', aParentName);
      });
    };

    switch (this.frame().GetFrameType()) {
      case FRAME_T.FRAME_SCH:
        showGridPrefs('Schematic Editor');
        break;
      case FRAME_T.FRAME_SCH_SYMBOL_EDITOR:
        showGridPrefs('Symbol Editor');
        break;
      case FRAME_T.FRAME_PCB_EDITOR:
        showGridPrefs('PCB Editor');
        break;
      case FRAME_T.FRAME_FOOTPRINT_EDITOR:
        showGridPrefs('Footprint Editor');
        break;
      case FRAME_T.FRAME_FOOTPRINT_VIEWER:
        showGridPrefs('Footprint Browser');
        break;
      case FRAME_T.FRAME_PL_EDITOR:
        showGridPrefs('Drawing Sheet Editor');
        break;
      case FRAME_T.FRAME_GERBER:
        showGridPrefs('Gerber Viewer');
        break;
      default:
        console.assert(false, `Unknown frame: ${this.GetName()}`);
        break;
    }

    return 0;
  }

  *GridOrigin(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const origin = this.frame().GetGridOrigin();

    // WX_PT_ENTRY_DIALOG dlg( m_frame, _( "Grid Origin" ), _( "X:" ), _( "Y:" ), origin, true );
    // The dialog is the page's and is not modal to the script: what follows
    // `if( dlg.ShowModal() == wxID_OK )` runs when it is accepted.
    void this.frame()
      .ShowPointEntryDialog('Grid Origin', 'X:', 'Y:', origin, true)
      .then((value) => {
        if (!value) return;

        this.frame().SetGridOrigin(value);

        this.m_toolMgr!.ResetTools(RESET_REASON.REDRAW);
        this.m_toolMgr!.RunAction(ACTIONS.gridSetOrigin, {
          x: this.frame().GetGridOrigin().x,
          y: this.frame().GetGridOrigin().y,
        });
        this.frame().GetCanvas()!.ForceRefresh();
      });

    return 0;
  }

  // Units control

  *SwitchUnits(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const newUnit = aEvent.Parameter<EdaUnits>();

    if (IsMetricUnit(newUnit)) this.m_metricUnit = newUnit;
    else if (IsImperialUnit(newUnit)) this.m_imperialUnit = newUnit;
    else console.assert(false, 'Invalid unit for the frame');

    this.frame().ChangeUserUnits(newUnit);
    return 0;
  }

  *ToggleUnitsEvent(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.ToggleUnits();
  }

  ToggleUnits(): number {
    this.frame().ChangeUserUnits(
      IsImperialUnit(this.frame().GetUserUnits()) ? this.m_metricUnit : this.m_imperialUnit,
    );
    return 0;
  }

  *TogglePolarCoords(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    this.frame().SetStatusText('');
    this.frame().SetShowPolarCoords(!this.frame().GetShowPolarCoords());
    this.frame().UpdateStatusBar();

    return 0;
  }

  *ResetLocalCoords(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const screen = this.frame().GetScreen();

    if (!screen)
      // Can happen in footprint chooser frame
      return 0;

    const vcSettings = this.m_toolMgr!.GetCurrentToolVC();

    // Use either the active tool forced cursor position or the general settings
    if (vcSettings.m_forceCursorPosition) screen.m_LocalOrigin = { ...vcSettings.m_forcedPosition };
    else screen.m_LocalOrigin = { ...this.vc().GetCursorPosition() };

    this.frame().UpdateStatusBar();

    return 0;
  }

  // Cursor control

  *ToggleCursor(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const galOpts = this.frame().GetGalDisplayOptions();

    galOpts.m_forceDisplayCursor = !galOpts.m_forceDisplayCursor;
    galOpts.WriteConfig(this.windowSettings());
    galOpts.NotifyChanged();

    return 0;
  }

  private setCursorMode(aMode: CROSS_HAIR_MODE): number {
    const galOpts = this.frame().GetGalDisplayOptions();

    galOpts.SetCursorMode(aMode);
    galOpts.WriteConfig(this.windowSettings());
    galOpts.NotifyChanged();

    return 0;
  }

  *CursorSmallCrosshairs(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.setCursorMode(CROSS_HAIR_MODE.SMALL_CROSS);
  }

  *CursorFullCrosshairs(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.setCursorMode(CROSS_HAIR_MODE.FULLSCREEN_CROSS);
  }

  *Cursor45Crosshairs(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return this.setCursorMode(CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL);
  }

  *ToggleBoundingBoxes(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const canvas = this.frame().GetCanvas();

    if (canvas) {
      const rs = canvas.GetView().GetPainter().GetSettings();

      rs.SetDrawBoundingBoxes(!rs.GetDrawBoundingBoxes());

      canvas.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.ALL);
      canvas.ForceRefresh();
    }

    return 0;
  }

  /** The grids, in IU. */
  Grids(): readonly VECTOR2I[] {
    return this.m_grids;
  }

  ///< Sets up handlers for various events.
  protected setTransitions(): void {
    this.Go(this.SelectionTool, ACTIONS.selectionTool.MakeEvent());

    // Cursor control
    this.Go(this.CursorControl, ACTIONS.cursorUp.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorDown.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorLeft.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorRight.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorUpFast.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorDownFast.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorLeftFast.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorRightFast.MakeEvent());

    this.Go(this.CursorControl, ACTIONS.cursorClick.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.cursorDblClick.MakeEvent());
    this.Go(this.CursorControl, ACTIONS.showContextMenu.MakeEvent());

    // Pan control
    this.Go(this.PanControl, ACTIONS.panUp.MakeEvent());
    this.Go(this.PanControl, ACTIONS.panDown.MakeEvent());
    this.Go(this.PanControl, ACTIONS.panLeft.MakeEvent());
    this.Go(this.PanControl, ACTIONS.panRight.MakeEvent());

    // Zoom control
    this.Go(this.ZoomRedraw, ACTIONS.zoomRedraw.MakeEvent());
    this.Go(this.ZoomInOut, ACTIONS.zoomIn.MakeEvent());
    this.Go(this.ZoomInOut, ACTIONS.zoomOut.MakeEvent());
    this.Go(this.ZoomInOutCenter, ACTIONS.zoomInCenter.MakeEvent());
    this.Go(this.ZoomInOutCenter, ACTIONS.zoomOutCenter.MakeEvent());
    this.Go(this.ZoomCenter, ACTIONS.zoomCenter.MakeEvent());
    this.Go(this.ZoomFitScreen, ACTIONS.zoomFitScreen.MakeEvent());
    this.Go(this.ZoomFitObjects, ACTIONS.zoomFitObjects.MakeEvent());
    this.Go(this.ZoomFitSelection, ACTIONS.zoomFitSelection.MakeEvent());
    this.Go(this.ZoomPreset, ACTIONS.zoomPreset.MakeEvent());
    this.Go(this.CenterContents, ACTIONS.centerContents.MakeEvent());
    this.Go(this.CenterSelection, ACTIONS.centerSelection.MakeEvent());

    // Grid control
    this.Go(this.GridNext, ACTIONS.gridNext.MakeEvent());
    this.Go(this.GridPrev, ACTIONS.gridPrev.MakeEvent());
    this.Go(this.GridPresetEvent, ACTIONS.gridPreset.MakeEvent());
    this.Go(this.GridFast1, ACTIONS.gridFast1.MakeEvent());
    this.Go(this.GridFast2, ACTIONS.gridFast2.MakeEvent());
    this.Go(this.GridFastCycle, ACTIONS.gridFastCycle.MakeEvent());
    this.Go(this.ToggleGrid, ACTIONS.toggleGrid.MakeEvent());
    this.Go(this.ToggleGridOverrides, ACTIONS.toggleGridOverrides.MakeEvent());
    this.Go(this.GridProperties, ACTIONS.gridProperties.MakeEvent());
    this.Go(this.GridOrigin, ACTIONS.gridOrigin.MakeEvent());

    // Units and coordinates
    this.Go(this.SwitchUnits, ACTIONS.inchesUnits.MakeEvent());
    this.Go(this.SwitchUnits, ACTIONS.milsUnits.MakeEvent());
    this.Go(this.SwitchUnits, ACTIONS.millimetersUnits.MakeEvent());
    this.Go(this.ToggleUnitsEvent, ACTIONS.toggleUnits.MakeEvent());
    this.Go(this.TogglePolarCoords, ACTIONS.togglePolarCoords.MakeEvent());
    this.Go(this.ResetLocalCoords, ACTIONS.resetLocalCoords.MakeEvent());

    // Misc
    this.Go(this.ToggleCursor, ACTIONS.toggleCursor.MakeEvent());
    this.Go(this.CursorSmallCrosshairs, ACTIONS.cursorSmallCrosshairs.MakeEvent());
    this.Go(this.CursorFullCrosshairs, ACTIONS.cursorFullCrosshairs.MakeEvent());
    this.Go(this.Cursor45Crosshairs, ACTIONS.cursor45Crosshairs.MakeEvent());
    this.Go(this.ToggleBoundingBoxes, ACTIONS.toggleBoundingBoxes.MakeEvent());
  }
}
