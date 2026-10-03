// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_VIEWER_TOOLS` (pcbnew/tools/pcb_viewer_tools.{h,cpp}): the tools every
 * pcbnew frame shares - the measure tool, and the viewer display toggles.
 *
 * TRANSITIONAL (#636): the display toggles (ShowPadNumbers, PadDisplayMode,
 * GraphicOutlines, TextOutlines, NextLineMode), Show3DViewer and
 * FootprintAutoZoom are still the board editor window's, which keeps their
 * state; they move here with that state. MeasureTool is the whole tool.
 */
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { SetClipboardFromText } from '@ziroeda/common/clipboard.js';
import type { EdaUnits } from '@ziroeda/common/eda_units.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { RULER_ITEM } from '@ziroeda/common/preview_items/ruler_item.js';
import { TWO_POINT_GEOMETRY_MANAGER } from '@ziroeda/common/preview_items/two_point_geom_manager.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { BUT_LEFT, BUT_RIGHT, MD_SHIFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';

export class PCB_VIEWER_TOOLS extends PCB_TOOL_BASE {
  /** `m_isDefaultTool`: true in the viewers, where the measure tool is the idle tool. */
  protected m_isDefaultTool = false;

  constructor() {
    super('pcbnew.PCBViewerTools');
  }

  /** `IsFootprintFrame()`. */
  private IsFootprintFrame(): boolean {
    return this.frame<PCB_BASE_FRAME>().IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR);
  }

  override Init(): boolean {
    // Populate the context menu displayed during the tool (primarily the measure tool)
    const activeToolCondition = (_aSel: SELECTION): boolean =>
      !this.frame<PCB_BASE_FRAME>().ToolStackIsEmpty();

    const ctxMenu = this.m_menu.GetMenu();

    // "Cancel" goes at the top of the context menu when a tool is active
    if (!this.m_isDefaultTool) {
      ctxMenu.AddItem(ACTIONS.cancelInteractive, activeToolCondition, 1);
      ctxMenu.AddSeparator(1);
    }

    ctxMenu.AddSeparator(activeToolCondition, 2);

    ctxMenu.AddItem(ACTIONS.copy, activeToolCondition, 3);
    ctxMenu.AddSeparator(activeToolCondition, 3);

    this.frame<PCB_BASE_FRAME>().AddStandardSubMenus(this.m_menu);

    return true;
  }

  /** The invert-axis display options the ruler reads its directions from. */
  private invertAxes(): { x: boolean; y: boolean } {
    const display = this.displayOptions();
    let x = display.m_DisplayInvertXAxis;
    let y = display.m_DisplayInvertYAxis;

    if (this.IsFootprintFrame()) {
      const fp = this.frame<PCB_BASE_FRAME>().GetFootprintEditorSettings() as unknown as {
        m_DisplayInvertXAxis?: boolean;
        m_DisplayInvertYAxis?: boolean;
      };
      x = fp.m_DisplayInvertXAxis ?? false;
      y = fp.m_DisplayInvertYAxis ?? false;
    }

    return { x, y };
  }

  /** `MeasureTool` (pcb_viewer_tools.cpp:258-457). */
  *MeasureTool(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.frame<PCB_BASE_FRAME>();

    if (this.IsFootprintFrame() && !frame.GetModel()) return 0;

    if (frame.IsCurrentTool(ACTIONS.measureTool)) return 0;

    const view = this.getView()!;
    const controls = this.getViewControls() as unknown as VIEW_CONTROLS;

    frame.PushTool(aEvent);

    let invert = this.invertAxes();

    const twoPtMgr = new TWO_POINT_GEOMETRY_MANAGER();
    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, frame.GetMagneticItemsSettings());
    let originSet = false;
    let units: EdaUnits = frame.GetUserUnits();
    const ruler = new RULER_ITEM(twoPtMgr, pcbIUScale, units, invert.x, invert.y);

    view.Add(ruler);
    view.SetVisible(ruler, false);

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.MEASURE);
    };

    const cleanup = (): void => {
      view.SetVisible(ruler, false);
      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      controls.ForceCursorPosition(false);
      originSet = false;
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.SetAutoPan(false);
    controls.CaptureCursor(false);
    controls.ForceCursorPosition(false);

    // Set initial cursor
    setCursor();

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();
      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      grid.SetUseGrid(view.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());
      let cursorPos = evt.HasPosition() ? evt.Position() : controls.GetMousePosition();

      if (!evt.IsActivate() && !evt.IsCancelInteractive()) {
        // If we are switching, the canvas may not be valid any more
        cursorPos = grid.BestSnapAnchor(cursorPos, null);
        controls.ForceCursorPosition(true, cursorPos);
      } else {
        grid.FullReset();
      }

      if (evt.IsCancelInteractive()) {
        if (originSet) {
          cleanup();
        } else if (this.m_isDefaultTool) {
          view.SetVisible(ruler, false);
        } else {
          frame.PopTool(aEvent);
          break;
        }
      } else if (evt.IsActivate()) {
        if (originSet) cleanup();

        if (evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        } else {
          frame.PopTool(aEvent);
          break;
        }
      }
      // click or drag starts
      else if (!originSet && (evt.IsDrag(BUT_LEFT) || evt.IsClick(BUT_LEFT))) {
        twoPtMgr.SetOrigin(cursorPos);
        twoPtMgr.SetEnd(cursorPos);

        controls.CaptureCursor(true);
        controls.SetAutoPan(true);

        originSet = true;
      }
      // second click or mouse up after drag ends
      else if (originSet && (evt.IsClick(BUT_LEFT) || evt.IsMouseUp(BUT_LEFT))) {
        originSet = false;

        controls.SetAutoPan(false);
        controls.CaptureCursor(false);
      }
      // move or drag when origin set updates rules
      else if (originSet && (evt.IsMotion() || evt.IsDrag(BUT_LEFT))) {
        // The measurement tool always measures in a direct line; holding Shift
        // constrains to 45° increments for convenience.
        twoPtMgr.SetAngleSnap(evt.Modifier(MD_SHIFT) ? LEADER_MODE.DEG45 : LEADER_MODE.DIRECT);
        twoPtMgr.SetEnd(cursorPos);

        view.SetVisible(ruler, true);
        view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
      } else if (evt.IsAction(ACTIONS.updateUnits)) {
        if (frame.GetUserUnits() !== units) {
          units = frame.GetUserUnits();
          ruler.SwitchUnits(units);
          view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
          this.canvas()?.Refresh();
        }

        evt.SetPassEvent();
      } else if (evt.IsAction(ACTIONS.updatePreferences)) {
        invert = this.invertAxes();

        ruler.UpdateDir(invert.x, invert.y);

        view.Update(ruler, VIEW_UPDATE_FLAGS.GEOMETRY);
        this.canvas()?.Refresh();
        evt.SetPassEvent();
      } else if (evt.IsAction(ACTIONS.copy)) {
        if (originSet) SetClipboardFromText(ruler.GetDimensionStrings().join('\n'));
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu();
      } else {
        evt.SetPassEvent();
      }
    }

    view.SetVisible(ruler, false);
    view.Remove(ruler);

    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    controls.SetAutoPan(false);
    controls.CaptureCursor(false);
    controls.ForceCursorPosition(false);
    return 0;
  }

  protected override setTransitions(): void {
    this.Go(this.MeasureTool, ACTIONS.measureTool.MakeEvent());
  }
}
