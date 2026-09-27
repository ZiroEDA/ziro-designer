// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/tool/picker_tool.h` + `common/tool/picker_tool.cpp`:
 * `PICKER_TOOL_BASE` and `PICKER_TOOL`, the generic "pick a point" tool other
 * tools drive through handlers - a click, a motion, a cancel and a finalize -
 * as `PL_EDIT_TOOL::InteractiveDelete` does. The C++ handlers are
 * `std::optional<std::function>`; here a handler is a function or null.
 */

import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import { KICURSOR } from '../gal/cursors.js';
import type { VIEW_CONTROLS } from '../view/view_controls.js';
import { ACTIONS } from './actions.js';
import type { COROUTINE_BODY } from './coroutine.js';
import { SELECTION_CONDITIONS } from './selection_conditions.js';
import type { RESET_REASON } from './tool_base.js';
import { BUT_LEFT, BUT_RIGHT, type TOOL_EVENT } from './tool_event.js';
import { TOOL_INTERACTIVE } from './tool_interactive.js';

/// Event handler types.
export type CLICK_HANDLER = (aPos: VECTOR2D) => boolean;
export type MOTION_HANDLER = (aPos: VECTOR2D) => void;
export type CANCEL_HANDLER = () => void;
export type FINALIZE_HANDLER = (aFinalState: number) => void;

export enum pickerEndState {
  WAIT_CANCEL,
  CLICK_CANCEL,
  END_ACTIVATE,
  EVT_CANCEL,
  EXCEPTION_CANCEL,
}

/**
 * `PICKER_TOOL_BASE`'s state and setters. C++ mixes it into PICKER_TOOL by
 * multiple inheritance; here PICKER_TOOL carries the members itself and this
 * interface names them.
 */
export interface PICKER_TOOL_BASE {
  SetCursor(aCursor: KICURSOR): void;
  SetSnapping(aSnap: boolean): void;
  ClearHandlers(): void;
  SetClickHandler(aHandler: CLICK_HANDLER): void;
  SetMotionHandler(aHandler: MOTION_HANDLER): void;
  SetCancelHandler(aHandler: CANCEL_HANDLER): void;
  SetFinalizeHandler(aHandler: FINALIZE_HANDLER): void;
  CurrentModifiers(): number;
}

export class PICKER_TOOL extends TOOL_INTERACTIVE implements PICKER_TOOL_BASE {
  protected m_frame: EDA_DRAW_FRAME | null = null;
  protected m_cursor: KICURSOR = KICURSOR.ARROW;
  protected m_snap = false;
  protected m_modifiers = 0;

  protected m_clickHandler: CLICK_HANDLER | null = null;
  protected m_motionHandler: MOTION_HANDLER | null = null;
  protected m_cancelHandler: CANCEL_HANDLER | null = null;
  protected m_finalizeHandler: FINALIZE_HANDLER | null = null;
  protected m_picked: VECTOR2D | null = null;

  constructor(aName = 'common.InteractivePicker') {
    super(aName);
    this.reset();
  }

  SetCursor(aCursor: KICURSOR): void {
    this.m_cursor = aCursor;
  }

  SetSnapping(aSnap: boolean): void {
    this.m_snap = aSnap;
  }

  ClearHandlers(): void {
    this.m_clickHandler = null;
    this.m_motionHandler = null;
    this.m_cancelHandler = null;
    this.m_finalizeHandler = null;
  }

  SetClickHandler(aHandler: CLICK_HANDLER): void {
    console.assert(!this.m_clickHandler);
    this.m_clickHandler = aHandler;
  }

  SetMotionHandler(aHandler: MOTION_HANDLER): void {
    console.assert(!this.m_motionHandler);
    this.m_motionHandler = aHandler;
  }

  SetCancelHandler(aHandler: CANCEL_HANDLER): void {
    console.assert(!this.m_cancelHandler);
    this.m_cancelHandler = aHandler;
  }

  SetFinalizeHandler(aHandler: FINALIZE_HANDLER): void {
    console.assert(!this.m_finalizeHandler);
    this.m_finalizeHandler = aHandler;
  }

  CurrentModifiers(): number {
    return this.m_modifiers;
  }

  /// Reinitializes tool to its initial state.
  protected reset(): void {
    this.m_cursor = KICURSOR.ARROW;
    this.m_snap = true;

    this.m_picked = null;
    this.ClearHandlers();
  }

  /** `getViewControls()` as the `VIEW_CONTROLS` it is. */
  private viewControls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    this.m_frame = this.getEditFrame<EDA_DRAW_FRAME>();

    const ctxMenu = this.m_menu.GetMenu();

    // cancel current tool goes in main context menu at the top if present
    ctxMenu.AddItem(ACTIONS.cancelInteractive, SELECTION_CONDITIONS.ShowAlways, 1);
    ctxMenu.AddSeparator(1);

    // Finally, add the standard zoom/grid items
    this.m_frame.AddStandardSubMenus(this.m_menu);

    return true;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  Reset(_aReason: RESET_REASON): void {}

  /// Main event loop.
  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;
    const controls = this.viewControls();
    let finalize_state: pickerEndState = pickerEndState.WAIT_CANCEL;

    const sourceEvent = aEvent.Parameter<TOOL_EVENT | null>();

    if (!sourceEvent) {
      console.assert(false, 'PICKER_TOOL::Main() called without a source event');
      return -1;
    }

    frame.PushTool(sourceEvent);
    this.Activate();

    this.setControls();

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(this.m_cursor);
    };

    // Set initial cursor
    setCursor();

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();
      const cursorPos = controls.GetCursorPosition(this.m_snap && frame.IsGridVisible());
      this.m_modifiers = aEvent.Modifier();

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        if (this.m_cancelHandler) {
          try {
            this.m_cancelHandler();
          } catch {
            // ignored, as upstream
          }
        }

        // Activating a new tool may have alternate finalization from canceling the current
        // tool
        if (evt.IsActivate()) {
          finalize_state = pickerEndState.END_ACTIVATE;
        } else {
          evt.SetPassEvent(false);
          finalize_state = pickerEndState.EVT_CANCEL;
        }

        break;
      } else if (evt.IsClick(BUT_LEFT)) {
        let getNext = false;

        this.m_picked = cursorPos;

        if (this.m_clickHandler) {
          try {
            getNext = this.m_clickHandler(this.m_picked);
          } catch {
            finalize_state = pickerEndState.EXCEPTION_CANCEL;
            break;
          }
        }

        if (!getNext) {
          finalize_state = pickerEndState.CLICK_CANCEL;
          break;
        } else {
          this.setControls();
        }
      } else if (evt.IsMotion()) {
        if (this.m_motionHandler) {
          try {
            this.m_motionHandler(cursorPos);
          } catch {
            // ignored, as upstream
          }
        }
      } else if (evt.IsDblClick(BUT_LEFT) || evt.IsDrag(BUT_LEFT)) {
        // Not currently used, but we don't want to pass them either
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu();
      } else {
        evt.SetPassEvent();
      }
    }

    if (this.m_finalizeHandler) {
      try {
        this.m_finalizeHandler(finalize_state);
      } catch {
        // ignored, as upstream
      }
    }

    this.reset();
    controls.ForceCursorPosition(false);
    frame.PopTool(sourceEvent);
    return 0;
  }

  /// Applies the requested VIEW_CONTROLS settings.
  protected setControls(): void {
    const controls = this.viewControls();

    controls.CaptureCursor(false);
    controls.SetAutoPan(false);
  }

  /// @copydoc TOOL_INTERACTIVE::setTransitions();
  protected setTransitions(): void {
    this.Go(this.Main, ACTIONS.pickerTool.MakeEvent());
  }
}
