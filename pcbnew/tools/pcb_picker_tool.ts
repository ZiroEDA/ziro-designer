// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import type { Vec2 as VECTOR2D, Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { LSET } from '@ziroeda/common/lset.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import {
  type CANCEL_HANDLER,
  type CLICK_HANDLER,
  type FINALIZE_HANDLER,
  type MOTION_HANDLER,
  type PICKER_TOOL_BASE,
  pickerEndState,
} from '@ziroeda/common/tool/picker_tool.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { BUT_LEFT, BUT_RIGHT, MD_SHIFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { type INTERACTIVE_PARAMS, PCB_ACTIONS } from './pcb_actions.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import { PCB_SELECTION } from './pcb_selection.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';

/**
 * `ZONE_FILLER_TOOL::IsZoneFillAction` (zone_filler_tool.cpp:486): the user's
 * fill actions. "Don't include zoneFillDirty; that's a system action not a
 * user action".
 */
export function IsZoneFillAction(aEvent: TOOL_EVENT): boolean {
  return (
    aEvent.IsAction(PCB_ACTIONS.zoneFill) ||
    aEvent.IsAction(PCB_ACTIONS.zoneFillAll) ||
    aEvent.IsAction(PCB_ACTIONS.zoneUnfill) ||
    aEvent.IsAction(PCB_ACTIONS.zoneUnfillAll)
  );
}

/**
 * Which board tools pull the crosshair onto items, and which leave it on the
 * grid.
 *
 * `PCB_PICKER_TOOL::Main` (`pcb_picker_tool.cpp:38-52`) asks
 * `PCB_GRID_HELPER::BestSnapAnchor` and forces the cursor onto its answer
 * only `if( m_snap )`. Three pickers switch that off before they start:
 *
 *     BOARD_INSPECTION_TOOL::LocalRatsnestTool   board_inspection_tool.cpp:2297
 *     BOARD_INSPECTION_TOOL::HighlightNetTool    board_inspection_tool.cpp:303
 *     PCB_CONTROL::DeleteItemCursor              pcb_control.cpp:834
 *         -> picker->SetSnapping( false );
 *
 * With `m_snap` off nothing calls `ForceCursorPosition`, so the drawn
 * crosshair is `WX_VIEW_CONTROLS::GetCursorPosition()` with
 * `m_snappingEnabled` at its constructor default of true
 * (`view_controls.cpp:64`): `GetGridPoint( m_cursorPos )`, the grid and
 * nothing else. The click itself uses `controls->GetMousePosition()`, the
 * raw pointer, so what the pick hits is what is under the mouse, not what
 * the crosshair sits on.
 *
 * Ours routed both pickers through `bestSnapAnchor` with the drawing tools,
 * so the crosshair leapt onto pads as the ratsnest tool passed over them.
 */
const NO_SNAP_PICKERS: ReadonlySet<string> = new Set(['localRatsnestTool', 'deleteTool']);

/** True when the tool's crosshair follows the grid only, never an item. */
export const pickerSnapsToGridOnly = (tool: string): boolean => NO_SNAP_PICKERS.has(tool);

/**
 * `PCB_PICKER_TOOL` (pcbnew/tools/pcb_picker_tool.h/.cpp): the generic tool
 * for picking an item or a point, with the board's snapping. C++ mixes
 * PICKER_TOOL_BASE into PCB_TOOL_BASE; here the class carries the base's state
 * and setters itself, as common/tool/picker_tool.ts's PICKER_TOOL does.
 */
export class PCB_PICKER_TOOL extends PCB_TOOL_BASE implements PICKER_TOOL_BASE {
  private m_layerMask: LSET = LSET.AllLayersMask();

  // PICKER_TOOL_BASE
  protected m_cursor: KICURSOR = KICURSOR.ARROW;
  protected m_snap = true;
  protected m_modifiers = 0;
  protected m_clickHandler: CLICK_HANDLER | null = null;
  protected m_motionHandler: MOTION_HANDLER | null = null;
  protected m_cancelHandler: CANCEL_HANDLER | null = null;
  protected m_finalizeHandler: FINALIZE_HANDLER | null = null;
  protected m_picked: VECTOR2D | null = null;

  constructor() {
    super('pcbnew.InteractivePicker');
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
    this.m_clickHandler = aHandler;
  }

  SetMotionHandler(aHandler: MOTION_HANDLER): void {
    this.m_motionHandler = aHandler;
  }

  SetCancelHandler(aHandler: CANCEL_HANDLER): void {
    this.m_cancelHandler = aHandler;
  }

  SetFinalizeHandler(aHandler: FINALIZE_HANDLER): void {
    this.m_finalizeHandler = aHandler;
  }

  CurrentModifiers(): number {
    return this.m_modifiers;
  }

  /** Set the tool's snap layer set. */
  SetLayerSet(aLayerSet: LSET): void {
    this.m_layerMask = aLayerSet;
  }

  GetLayerSet(): LSET {
    return this.m_layerMask;
  }

  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    const menu = this.m_menu.GetMenu();

    const snapIsSetToAllLayers = (_aSel: SELECTION): boolean => {
      const frame = this.getEditFrame<PCB_BASE_FRAME>();

      if (frame) {
        if (frame.GetMagneticItemsSettings()) return frame.GetMagneticItemsSettings().allLayers;
      }

      return false;
    };

    // "Cancel" goes at the top of the context menu when a tool is active
    menu.AddItem(ACTIONS.cancelInteractive, SELECTION_CONDITIONS.ShowAlways, 1);
    menu.AddSeparator(1);

    menu.AddItem(
      PCB_ACTIONS.magneticSnapAllLayers,
      SELECTION_CONDITIONS.Not(snapIsSetToAllLayers),
      1,
    );
    menu.AddItem(PCB_ACTIONS.magneticSnapActiveLayer, snapIsSetToAllLayers, 1);
    menu.AddSeparator(1);

    const frame = this.getEditFrame<PCB_BASE_FRAME>();

    if (frame) frame.AddStandardSubMenus(this.m_menu);

    return true;
  }

  /// Main event loop.
  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const controls = this.controls();
    const frame = this.getEditFrame<PCB_BASE_FRAME>();
    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, frame.GetMagneticItemsSettings());
    let finalize_state: pickerEndState = pickerEndState.WAIT_CANCEL;
    let sourceEvent: TOOL_EVENT | null = null;

    if (aEvent.IsAction(ACTIONS.pickerTool)) {
      sourceEvent = aEvent.Parameter<TOOL_EVENT | null>();

      if (!sourceEvent) {
        console.assert(false, 'PCB_PICKER_TOOL::Main() called without a source event');
        return -1;
      }

      frame.PushTool(sourceEvent);
    }

    this.Activate();
    this.setControls();

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(this.m_cursor);
      controls.ShowCursor(true);
    };

    // Set initial cursor
    setCursor();
    let cursorPos: VECTOR2D;

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();
      cursorPos = controls.GetMousePosition();

      if (this.m_snap) {
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        if (!evt.IsActivate() && !evt.IsCancelInteractive()) {
          // If we are switching, the canvas may not be valid any more
          cursorPos = grid.BestSnapAnchor(cursorPos, null);
          controls.ForceCursorPosition(true, cursorPos);
        } else {
          grid.FullReset();
        }
      }

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        if (this.m_cancelHandler) {
          try {
            this.m_cancelHandler();
          } catch {
            // ignored, as upstream
          }
        }

        // Activating a new tool may have alternate finalization from canceling the current tool
        if (evt.IsActivate()) finalize_state = pickerEndState.END_ACTIVATE;
        else finalize_state = pickerEndState.EVT_CANCEL;

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
        const dummy = new PCB_SELECTION();
        this.m_menu.ShowContextMenu(dummy);
      }
      // TODO: It'd be nice to be able to say "don't allow any non-trivial editing actions",
      // but we don't at present have that, so we just knock out some of the egregious ones.
      else if (IsZoneFillAction(evt)) {
        wxBell();
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
    controls.ShowCursor(false);

    if (sourceEvent) frame.PopTool(sourceEvent);

    return 0;
  }

  /**
   * Pick a single point interactively and return this to the caller through
   * the INTERACTIVE_PARAMS receiver.
   */
  *SelectPointInteractively(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const params = aEvent.Parameter<INTERACTIVE_PARAMS>();
    const statusPopup = new STATUS_TEXT_POPUP();
    const receiver = params.m_Receiver as {
      UpdatePickedPoint(aPoint: VECTOR2I | null): void;
    } | null;

    if (!receiver) return -1;

    const grid_helper = new PCB_GRID_HELPER(
      this.m_toolMgr!,
      this.frame().GetMagneticItemsSettings(),
    );

    // By pushing this tool, we stop the Selection tool popping a disambiuation menu
    // in cases like returning to the Position Relative dialog after the selection.
    this.frame().PushTool(aEvent);
    this.Activate();

    statusPopup.SetText(params.m_Prompt);

    const sendPoint = (aPoint: VECTOR2I | null): void => {
      statusPopup.Hide();
      receiver.UpdatePickedPoint(aPoint);
    };

    this.SetSnapping(true);
    this.SetCursor(KICURSOR.PLACE);
    this.ClearHandlers();

    this.SetClickHandler((aPoint: VECTOR2D): boolean => {
      const snapped = grid_helper.GetSnappedPoint();

      sendPoint(snapped ? snapped : { x: Math.trunc(aPoint.x), y: Math.trunc(aPoint.y) });

      return false; // got our item; don't need any more
    });

    this.SetMotionHandler((_aPos: VECTOR2D): void => {
      grid_helper.SetSnap(!(this.CurrentModifiers() & MD_SHIFT));
      statusPopup.Move(offsetPopup(KIPLATFORM_UI.GetMousePosition(), 20, -50));
    });

    this.SetCancelHandler((): void => {
      sendPoint(null);
    });

    this.SetFinalizeHandler((_aFinalState: number): void => {});

    statusPopup.Move(offsetPopup(KIPLATFORM_UI.GetMousePosition(), 20, -50));
    statusPopup.Popup();
    this.canvas()?.SetStatusPopup(popupFocus(statusPopup));

    // Drop into the main event loop
    yield* this.Main(aEvent);

    this.ClearHandlers();
    this.canvas()?.SetStatusPopup(null);
    this.frame().PopTool(aEvent);
    return 0;
  }

  /**
   * Pick a single item interactively and return this to the caller through
   * the INTERACTIVE_PARAMS receiver.
   */
  *SelectItemInteractively(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const params = aEvent.Parameter<INTERACTIVE_PARAMS>();
    const statusPopup = new STATUS_TEXT_POPUP();
    let anchor_item: EDA_ITEM | null = null;
    const selectionTool = this.m_toolMgr!.FindTool('common.InteractiveSelection') as unknown as {
      RequestSelection(aFilter: unknown): PCB_SELECTION;
    };
    const receiver = params.m_Receiver as { UpdatePickedItem(aItem: EDA_ITEM | null): void } | null;

    if (!receiver) return -1;

    this.frame().PushTool(aEvent);
    this.Activate();

    statusPopup.SetText(params.m_Prompt);

    const sendItem = (aItem: EDA_ITEM | null): void => {
      statusPopup.Hide();
      receiver.UpdatePickedItem(aItem);
    };

    this.SetCursor(KICURSOR.BULLSEYE);
    this.SetSnapping(false);
    this.ClearHandlers();

    this.SetClickHandler((_aPoint: VECTOR2D): boolean => {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      const sel = selectionTool.RequestSelection(() => {});

      if (sel.Empty()) return true; // still looking for an item

      anchor_item = sel.Front();

      if (params.m_ItemFilter && !params.m_ItemFilter(anchor_item!)) return true;

      sendItem(sel.Front());
      return false; // got our item; don't need any more
    });

    this.SetMotionHandler((_aPos: VECTOR2D): void => {
      statusPopup.Move(offsetPopup(KIPLATFORM_UI.GetMousePosition(), 20, -50));
    });

    this.SetCancelHandler((): void => {
      if (anchor_item && (!params.m_ItemFilter || params.m_ItemFilter(anchor_item)))
        sendItem(anchor_item);
    });

    this.SetFinalizeHandler((_aFinalState: number): void => {});

    statusPopup.Move(offsetPopup(KIPLATFORM_UI.GetMousePosition(), 20, -50));
    statusPopup.Popup();
    this.canvas()?.SetStatusPopup(popupFocus(statusPopup));

    // Drop into the main event loop
    yield* this.Main(aEvent);

    this.ClearHandlers();
    this.canvas()?.SetStatusPopup(null);
    this.frame().PopTool(aEvent);
    return 0;
  }

  /// Reinitializes tool to its initial state.
  protected reset(): void {
    this.m_layerMask = LSET.AllLayersMask();

    // PICKER_TOOL_BASE::reset()
    this.m_cursor = KICURSOR.ARROW;
    this.m_snap = true;
    this.m_picked = null;
    this.ClearHandlers();
  }

  /// Applies the requested VIEW_CONTROLS settings.
  protected setControls(): void {
    const controls = this.controls();

    controls.CaptureCursor(false);
    controls.SetAutoPan(false);
  }

  /// @copydoc TOOL_INTERACTIVE::setTransitions();
  protected override setTransitions(): void {
    this.Go(this.Main, ACTIONS.pickerTool.MakeEvent());
    this.Go(this.Main, ACTIONS.pickerSubTool.MakeEvent());
    this.Go(this.SelectItemInteractively, PCB_ACTIONS.selectItemInteractively.MakeEvent());
    this.Go(this.SelectPointInteractively, PCB_ACTIONS.selectPointInteractively.MakeEvent());
  }
}

/** `KIPLATFORM::UI::GetMousePosition() + wxPoint( aDx, aDy )`. */
function offsetPopup(
  aAt: { x: number; y: number },
  aDx: number,
  aDy: number,
): { x: number; y: number } {
  return { x: aAt.x + aDx, y: aAt.y + aDy };
}

/** `canvas()->SetStatusPopup( popup->GetPanel() )`: the canvas asks the panel whether it has the focus. */
export function popupFocus(aPopup: STATUS_TEXT_POPUP): { HasFocus(): boolean } {
  return {
    HasFocus: () => {
      const panel = aPopup.GetPanel();
      return !!panel && typeof document !== 'undefined' && panel.contains(document.activeElement);
    },
  };
}
