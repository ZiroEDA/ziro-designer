// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/editor_conditions.cpp` + `include/tool/editor_conditions.h`:
 * `EDITOR_CONDITIONS`, the SELECTION_CONDITIONs every frame's
 * `setupUIConditions` checks its toolbar and menu rows against.
 *
 * The frames are imported as types only: a frame module imports this, so a
 * value import back would be a cycle. The `dynamic_cast< EDA_DRAW_FRAME* >`
 * plus `wxASSERT` of the draw-frame conditions is the caller's contract here.
 */

import type { EdaUnits } from '../eda_units.js';
import { CROSS_HAIR_MODE } from '../gal/gal_display_options.js';
import type { SELECTION } from './selection.js';
import { type SELECTION_CONDITION, SELECTION_CONDITIONS } from './selection_conditions.js';
import type { TOOL_ACTION } from './tool_action.js';

/** What EDITOR_CONDITIONS asks of `EDA_BASE_FRAME`. */
export interface EDITOR_CONDITIONS_BASE_FRAME {
  IsContentModified(): boolean;
  GetUndoCommandCount(): number;
  GetRedoCommandCount(): number;
  GetUserUnits(): EdaUnits;
  IsCurrentTool(aAction: TOOL_ACTION): boolean;
  ToolStackIsEmpty(): boolean;
}

/** What the draw-frame conditions ask of `EDA_DRAW_FRAME`. */
export interface EDITOR_CONDITIONS_DRAW_FRAME extends EDITOR_CONDITIONS_BASE_FRAME {
  IsGridVisible(): boolean;
  IsGridOverridden(): boolean;
  GetShowPolarCoords(): boolean;
  GetGalDisplayOptions(): { GetCursorMode(): CROSS_HAIR_MODE };
  GetCanvas(): {
    GetView(): { GetPainter(): { GetSettings(): { GetDrawBoundingBoxes(): boolean } } };
  } | null;
  IsScriptingConsoleVisible(): boolean;
}

/**
 * Class that groups generic conditions for editor states.
 */
export class EDITOR_CONDITIONS extends SELECTION_CONDITIONS {
  /** The frame to apply the conditions to. */
  protected m_frame: EDITOR_CONDITIONS_BASE_FRAME;

  /**
   * Create an object to define conditions dependent upon a specific frame.
   *
   * @param aFrame is the frame to query for the conditions
   */
  constructor(aFrame: EDITOR_CONDITIONS_BASE_FRAME) {
    super();
    this.m_frame = aFrame;
  }

  private drawFrame(): EDITOR_CONDITIONS_DRAW_FRAME {
    // The check requires a draw frame (wxASSERT( drwFrame )).
    return this.m_frame as EDITOR_CONDITIONS_DRAW_FRAME;
  }

  /** A functor testing if the content of the frame is modified. */
  ContentModified(): SELECTION_CONDITION {
    return (aSel) => EDITOR_CONDITIONS.contentModifiedFunc(aSel, this.m_frame);
  }

  /** A functor testing if there are any items in the undo queue. */
  UndoAvailable(): SELECTION_CONDITION {
    return (aSel) => EDITOR_CONDITIONS.undoFunc(aSel, this.m_frame);
  }

  /** A functor testing if there are any items in the redo queue. */
  RedoAvailable(): SELECTION_CONDITION {
    return (aSel) => EDITOR_CONDITIONS.redoFunc(aSel, this.m_frame);
  }

  /** A functor testing if the frame's units are `aUnit`. */
  Units(aUnit: EdaUnits): SELECTION_CONDITION {
    return (aSel) => EDITOR_CONDITIONS.unitsFunc(aSel, this.m_frame, aUnit);
  }

  /** A functor testing if the tool of `aTool` is the current tool. */
  CurrentTool(aTool: TOOL_ACTION): SELECTION_CONDITION {
    return (aSel) => EDITOR_CONDITIONS.toolFunc(aSel, this.m_frame, aTool);
  }

  /** A functor testing that no tool is active in the frame, i.e. the tool stack is empty. */
  NoActiveTool(): SELECTION_CONDITION {
    return (aSel) => EDITOR_CONDITIONS.noToolFunc(aSel, this.m_frame);
  }

  /** A functor testing if the grid is visible in a frame. */
  GridVisible(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) => EDITOR_CONDITIONS.gridFunc(aSel, drwFrame);
  }

  /** A functor testing if the grid overrides wires is enabled in a frame. */
  GridOverrides(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) => EDITOR_CONDITIONS.gridOverridesFunc(aSel, drwFrame);
  }

  /** A functor testing if polar coordinates are being used. */
  PolarCoordinates(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) => EDITOR_CONDITIONS.polarCoordFunc(aSel, drwFrame);
  }

  /** A functor testing if the cursor is the small crosshairs. */
  CursorSmallCrosshairs(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) => EDITOR_CONDITIONS.cursorFunc(aSel, drwFrame, CROSS_HAIR_MODE.SMALL_CROSS);
  }

  /** A functor testing if the cursor is the full screen crosshairs. */
  CursorFullCrosshairs(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) => EDITOR_CONDITIONS.cursorFunc(aSel, drwFrame, CROSS_HAIR_MODE.FULLSCREEN_CROSS);
  }

  /** A functor testing if the cursor is the 45 degree crosshairs. */
  Cursor45Crosshairs(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) =>
      EDITOR_CONDITIONS.cursorFunc(aSel, drwFrame, CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL);
  }

  /** A functor testing if bounding boxes are drawn. */
  BoundingBoxes(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) => EDITOR_CONDITIONS.bboxesFunc(aSel, drwFrame);
  }

  /** A functor testing if the scripting console is visible. */
  ScriptingConsoleVisible(): SELECTION_CONDITION {
    const drwFrame = this.drawFrame();
    return (aSel) => EDITOR_CONDITIONS.consoleVisibleFunc(aSel, drwFrame);
  }

  /// Helper function used by ContentModified().
  protected static contentModifiedFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_BASE_FRAME,
  ): boolean {
    return aFrame.IsContentModified();
  }

  /// Helper function used by UndoAvailable().
  protected static undoFunc(_aSelection: SELECTION, aFrame: EDITOR_CONDITIONS_BASE_FRAME): boolean {
    return aFrame.GetUndoCommandCount() > 0;
  }

  /// Helper function used by RedoAvailable().
  protected static redoFunc(_aSelection: SELECTION, aFrame: EDITOR_CONDITIONS_BASE_FRAME): boolean {
    return aFrame.GetRedoCommandCount() > 0;
  }

  /// Helper function used by Units().
  protected static unitsFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_BASE_FRAME,
    aUnits: EdaUnits,
  ): boolean {
    return aFrame.GetUserUnits() === aUnits;
  }

  /// Helper function used by CurrentTool().
  protected static toolFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_BASE_FRAME,
    aTool: TOOL_ACTION,
  ): boolean {
    return aFrame.IsCurrentTool(aTool);
  }

  /// Helper function used by NoActiveTool().
  protected static noToolFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_BASE_FRAME,
  ): boolean {
    return aFrame.ToolStackIsEmpty();
  }

  /// Helper function used by GridVisible().
  protected static gridFunc(_aSelection: SELECTION, aFrame: EDITOR_CONDITIONS_DRAW_FRAME): boolean {
    return aFrame.IsGridVisible();
  }

  /// Helper function used by GridOverrides().
  protected static gridOverridesFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_DRAW_FRAME,
  ): boolean {
    return aFrame.IsGridOverridden();
  }

  /// Helper function used by PolarCoordinates().
  protected static polarCoordFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_DRAW_FRAME,
  ): boolean {
    return aFrame.GetShowPolarCoords();
  }

  /// Helper function used by FullscreenCursor().
  protected static cursorFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_DRAW_FRAME,
    aMode: CROSS_HAIR_MODE,
  ): boolean {
    return aFrame.GetGalDisplayOptions().GetCursorMode() === aMode;
  }

  /// Helper function used by DrawBoundingBoxes().
  protected static bboxesFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_DRAW_FRAME,
  ): boolean {
    return aFrame.GetCanvas()!.GetView().GetPainter().GetSettings().GetDrawBoundingBoxes();
  }

  /// Helper function used by ScriptingConsoleVisible().
  protected static consoleVisibleFunc(
    _aSelection: SELECTION,
    aFrame: EDITOR_CONDITIONS_DRAW_FRAME,
  ): boolean {
    return aFrame.IsScriptingConsoleVisible();
  }
}
