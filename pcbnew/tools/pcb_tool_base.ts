// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/pcb_tool_base.h` + `.cpp`: the base of every pcbnew tool -
 * the frame, board, canvas and selection accessors, the editor flags and the
 * angle-snap queries. `doInteractiveItemPlacement` and the context menu
 * (`Init`'s CONDITIONAL_MENU) come with the placement tools (#636 stage 3).
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  TC_COMMAND,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { EDA_ITEM_FLAGS } from '@ziroeda/common/eda_item_flags.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { RESET_REASON, TOOL_ID } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { BOARD } from '../board.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_BASE_EDIT_FRAME as PCB_BASE_EDIT_FRAME_T } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';
import type { PCBNEW_SETTINGS } from '../pcbnew_settings.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import { PCB_SELECTION } from './pcb_selection.js';
import { GetEventRotationAngle, IsRotateToolEvt } from './tool_event_utils.js';

export const { UNDEFINED_LAYER } = PCB_LAYER_ID;

/** `PCB_SELECTION_TOOL` as this base reads it; the tool itself is stage 3's. */
export interface PCB_SELECTION_TOOL_LIKE {
  GetSelection(): PCB_SELECTION;
}

export enum INTERACTIVE_PLACEMENT_OPTIONS {
  IPO_ROTATE = 0x01,
  IPO_FLIP = 0x02,
  IPO_SINGLE_CLICK = 0x04,
  IPO_REPEAT = 0x08,
}

/**
 * `INTERACTIVE_PLACER_BASE` (pcb_tool_base.h:53): what `doInteractiveItemPlacement`
 * asks a placing tool for - the item to create, how it snaps, and how it is placed.
 */
export abstract class INTERACTIVE_PLACER_BASE {
  m_frame!: PCB_BASE_EDIT_FRAME_T;
  m_board!: BOARD;
  m_modifiers = 0;

  abstract CreateItem(): BOARD_ITEM | null;

  SnapItem(_aItem: BOARD_ITEM): void {
    // Base implementation performs no snapping
  }

  /**
   * A placer that must wait on the user mid-placement (VIA_PLACER's net menu
   * runs its own event loop inside PlaceItem upstream) answers a coroutine,
   * which the placement loop runs with `yield*`.
   */
  PlaceItem(aItem: BOARD_ITEM, aCommit: BOARD_COMMIT): boolean | COROUTINE_BODY<boolean> {
    aCommit.Add(aItem);
    return true;
  }
}

export abstract class PCB_TOOL_BASE extends TOOL_INTERACTIVE {
  protected m_isFootprintEditor: boolean;
  protected m_isBoardEditor: boolean;

  constructor(aId: TOOL_ID, aName: string);
  constructor(aName: string);
  constructor(a: TOOL_ID | string, b?: string) {
    // TOOL_INTERACTIVE( aId, aName ) / TOOL_INTERACTIVE( aName ): the name form
    // makes the id from the name, as TOOL_INTERACTIVE's own ctor does.
    super(typeof a === 'string' ? TOOL_MANAGER.MakeToolId(a) : a, typeof a === 'string' ? a : b!);
    this.m_isFootprintEditor = false;
    this.m_isBoardEditor = false;
  }

  override Init(): boolean {
    // A basic context menu.  Many (but not all) tools will choose to override this.
    // CONDITIONAL_MENU + AddStandardSubMenus: the context menus are stage 3's.
    return true;
  }

  override Reset(_aReason: RESET_REASON): void {}

  SetIsFootprintEditor(aEnabled: boolean): void {
    this.m_isFootprintEditor = aEnabled;
  }
  IsFootprintEditor(): boolean {
    return this.m_isFootprintEditor;
  }

  SetIsBoardEditor(aEnabled: boolean): void {
    this.m_isBoardEditor = aEnabled;
  }
  IsBoardEditor(): boolean {
    return this.m_isBoardEditor;
  }

  /**
   * Should the tool use its 45° mode option?
   * @return True if set to use 45°
   */
  Is45Limited(): boolean {
    return this.GetAngleSnapMode() !== LEADER_MODE.DIRECT;
  }

  Is90Limited(): boolean {
    return this.GetAngleSnapMode() === LEADER_MODE.DEG90;
  }

  GetAngleSnapMode(): LEADER_MODE {
    // GetAppSettings<PCBNEW_SETTINGS>( "pcbnew" ) / <FOOTPRINT_EDITOR_SETTINGS>( "fpedit" ):
    // the frame answers for its own app settings.
    if (this.frame<PCB_BASE_FRAME>().IsType(FRAME_T.FRAME_PCB_EDITOR))
      return this.frame<PCB_BASE_FRAME>().GetPcbNewSettings().m_AngleSnapMode;
    else return this.frame<PCB_BASE_FRAME>().GetFootprintEditorSettings().m_AngleSnapMode;
  }

  /**
   * `PCB_TOOL_BASE::doInteractiveItemPlacement` (pcb_tool_base.cpp:43): the
   * place-an-item-under-the-cursor loop the placing tools share.
   */
  protected *doInteractiveItemPlacement(
    aTool: TOOL_EVENT,
    aPlacer: INTERACTIVE_PLACER_BASE,
    aCommitMessage: string,
    aOptions: number,
  ): COROUTINE_BODY<void> {
    let newItem: BOARD_ITEM | null = null;
    const frame = this.frame<PCB_BASE_EDIT_FRAME_T>();
    const controls = this.getViewControls() as unknown as VIEW_CONTROLS;

    frame.PushTool(aTool);

    const commit = new BOARD_COMMIT(frame);

    // LEADER_MODE* angleSnapMode: the editor's own setting, which the tool overrides with DIRECT
    let angleSnap: { m_AngleSnapMode: number } | null = null;
    let savedAngleSnapMode = 0; // LEADER_MODE::DIRECT
    let restoreAngleSnapMode = false;

    if (frame.IsType(FRAME_T.FRAME_PCB_EDITOR)) angleSnap = frame.GetPcbNewSettings();
    else if (frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR))
      angleSnap = frame.GetFootprintEditorSettings();

    // (the viewers' settings branch - `GetViewerSettingsBase()` - has no counterpart: the
    // viewers have no placing tools here)

    if (angleSnap && angleSnap.m_AngleSnapMode !== 0) {
      savedAngleSnapMode = angleSnap.m_AngleSnapMode;
      angleSnap.m_AngleSnapMode = 0;
      restoreAngleSnapMode = true;
      this.m_toolMgr!.RunAction(PCB_ACTIONS.angleSnapModeChanged);
    }

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.ForceCursorPosition(false);
    // do not capture or auto-pan until we start placing an item

    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, frame.GetMagneticItemsSettings());

    // Add a VIEW_GROUP that serves as a preview for the new item
    const preview = new PCB_SELECTION();
    this.getView()!.Add(preview);

    aPlacer.m_board = this.board();
    aPlacer.m_frame = frame;
    aPlacer.m_modifiers = 0;

    const makeNewItem = (aPosition: VECTOR2I): void => {
      if (frame.GetModel()) newItem = aPlacer.CreateItem();

      if (newItem) {
        newItem.SetPosition(aPosition);
        preview.Add(newItem);

        // footprints have more drawable parts
        if (newItem.Type() === KICAD_T.PCB_FOOTPRINT_T)
          (newItem as FOOTPRINT).RunOnChildren(
            (aChild: BOARD_ITEM) => preview.Add(aChild),
            RECURSE_MODE.NO_RECURSE,
          );
      }
    };

    if (aOptions & INTERACTIVE_PLACEMENT_OPTIONS.IPO_SINGLE_CLICK)
      makeNewItem(controls.GetCursorPosition());

    const setCursor = (): void => {
      if (!newItem) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
      else frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PLACE);
    };

    // Set initial cursor
    setCursor();

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();

      grid.SetSnap(false); // Interactive placement tools need to set their own item snaps
      grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());
      let cursorPos = controls.GetMousePosition();

      if (!evt.IsActivate() && !evt.IsCancelInteractive()) {
        cursorPos = grid.BestSnapAnchor(cursorPos, null);
      } else {
        grid.FullReset();
      }

      aPlacer.m_modifiers = evt.Modifier();

      const cleanup = (): void => {
        newItem = null;
        preview.Clear();
        this.getView()!.Update(preview);
        controls.SetAutoPan(false);
        controls.CaptureCursor(false);
        controls.ShowCursor(true);
        controls.ForceCursorPosition(false);
      };

      if (evt.IsCancelInteractive()) {
        if (aOptions & INTERACTIVE_PLACEMENT_OPTIONS.IPO_SINGLE_CLICK) {
          cleanup();
          frame.PopTool(aTool);
          break;
        } else if (newItem) {
          cleanup();
        } else {
          frame.PopTool(aTool);
          break;
        }
      } else if (evt.IsActivate()) {
        if (newItem) cleanup();

        if (evt.IsPointEditor()) {
          // don't exit (the point editor runs in the background)
        } else if (evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        } else {
          frame.PopTool(aTool);
          break;
        }
      } else if (evt.IsClick(BUT_LEFT) || evt.IsDblClick(BUT_LEFT)) {
        if (!newItem) {
          // create the item if possible
          makeNewItem(cursorPos);

          // no item created, so wait for another click
          if (!newItem) continue;

          controls.CaptureCursor(true);
          controls.SetAutoPan(true);
        } else {
          const newBoardItem: BOARD_ITEM = newItem;
          newItem = null;
          const oldFlags: EDA_ITEM_FLAGS = newBoardItem.GetFlags();

          newBoardItem.ClearFlags();

          const placed = aPlacer.PlaceItem(newBoardItem, commit);

          if (!(typeof placed === 'boolean' ? placed : yield* placed)) {
            newBoardItem.SetFlags(oldFlags);
            newItem = newBoardItem;
            continue;
          }

          preview.Clear();
          commit.Push(aCommitMessage);

          controls.CaptureCursor(false);
          controls.SetAutoPan(false);
          controls.ShowCursor(true);

          if (!(aOptions & INTERACTIVE_PLACEMENT_OPTIONS.IPO_REPEAT)) break;

          if (aOptions & INTERACTIVE_PLACEMENT_OPTIONS.IPO_SINGLE_CLICK)
            makeNewItem(controls.GetCursorPosition());

          setCursor();
        }
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.selection());
      } else if (evt.IsAction(PCB_ACTIONS.trackViaSizeChanged)) {
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
      } else if (newItem && evt.Category() === TC_COMMAND) {
        /*
         * Handle any events that can affect the item as we move it around
         */
        if (IsRotateToolEvt(evt) && aOptions & INTERACTIVE_PLACEMENT_OPTIONS.IPO_ROTATE) {
          const rotationAngle = GetEventRotationAngle(frame, evt);
          newItem.Rotate(newItem.GetPosition(), rotationAngle);
          this.getView()!.Update(preview);
        } else if (
          evt.IsAction(PCB_ACTIONS.flip) &&
          aOptions & INTERACTIVE_PLACEMENT_OPTIONS.IPO_FLIP
        ) {
          newItem.Flip(newItem.GetPosition(), frame.GetPcbNewSettings().m_FlipDirection);
          this.getView()!.Update(preview);
        } else if (evt.IsAction(PCB_ACTIONS.properties)) {
          // `PCB_BASE_EDIT_FRAME::OnEditItemRequest`: the frame's, as EDIT_TOOL asks it
          (
            frame as unknown as { OnEditItemRequest?: (aItem: BOARD_ITEM) => void }
          ).OnEditItemRequest?.(newItem);

          // Notify other tools of the changes
          this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
        } else if (evt.IsAction(ACTIONS.refreshPreview)) {
          preview.Clear();
          newItem = null;

          makeNewItem(cursorPos);
          aPlacer.SnapItem(newItem as unknown as BOARD_ITEM);
          this.getView()!.Update(preview);
        } else {
          evt.SetPassEvent();
        }
      } else if (newItem && evt.IsMotion()) {
        // track the cursor
        newItem.SetPosition(cursorPos);
        aPlacer.SnapItem(newItem);

        // Show a preview of the item
        this.getView()!.Update(preview);
      } else {
        evt.SetPassEvent();
      }
    }

    this.getView()!.Remove(preview);
    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    controls.SetAutoPan(false);
    controls.CaptureCursor(false);
    controls.ForceCursorPosition(false);

    if (restoreAngleSnapMode && angleSnap) {
      angleSnap.m_AngleSnapMode = savedAngleSnapMode;
      this.m_toolMgr!.RunAction(PCB_ACTIONS.angleSnapModeChanged);
    }
  }

  protected override setTransitions(): void {}

  protected view(): VIEW | null {
    return this.getView();
  }

  protected frame<T = PCB_BASE_EDIT_FRAME>(): T {
    return this.getEditFrame<PCB_BASE_FRAME>() as unknown as T;
  }

  protected board(): BOARD {
    return this.getModel<BOARD>();
  }

  protected footprint(): FOOTPRINT | null {
    return this.board().GetFirstFootprint();
  }

  protected displayOptions(): PCBNEW_SETTINGS['m_Display'] {
    return this.frame<PCB_BASE_FRAME>().GetPcbNewSettings().m_Display;
  }

  protected canvas(): PCB_DRAW_PANEL_GAL | null {
    return this.frame<PCB_BASE_FRAME>().GetCanvas() as PCB_DRAW_PANEL_GAL | null;
  }

  protected selection(): PCB_SELECTION {
    // m_toolMgr->GetTool<PCB_SELECTION_TOOL>(), by its name ("common.InteractiveSelection"):
    // the class imports this module, so asking by type would be an import cycle
    const selTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL_LIKE;

    return selTool.GetSelection();
  }
}
