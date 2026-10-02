// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_CONTROL` (pcbnew/tools/pcb_control.cpp): the tool both board frames
 * share for the view, the grid origin, the delete tool and paste.
 *
 * Ported so far: the class, Reset, the grid origin (DoSetGridOrigin,
 * GridPlaceOrigin, GridResetOrigin), InteractiveDelete, placeBoardItems and
 * the two board tables. The display-mode cycles, layer switching, Paste and
 * AppendBoard follow.
 */
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { brightened, brightness, darkened, type Color4d } from '@ziroeda/common/gal/color4d.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { ORIGIN_VIEWITEM } from '@ziroeda/common/origin_viewitem.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { type RESET_REASON, RESET_REASON as RESET } from '@ziroeda/common/tool/tool_base.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '../board_item.js';
import { GENERAL_COLLECTOR } from '../collectors.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { EDIT_TOOL } from './edit_tool.js';
import type { PCB_PICKER_TOOL } from './pcb_picker_tool.js';
import { PCB_SELECTION } from './pcb_selection.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { Build_Board_Characteristics_Table } from '../board_tables/board_characteristics_table.js';
import { Build_Board_Stackup_Table } from '../board_tables/board_stackup_table.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_DIMENSION_BASE } from '../pcb_dimension.js';
import type { ZONE } from '../zone.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { BaseType, KICAD_T } from '@ziroeda/core/typeinfo.js';
import { DoSetGridOrigin } from './pcb_origins.js';

/** `HITTEST_THRESHOLD_PIXELS` (pcb_control.cpp:817). */
const HITTEST_THRESHOLD_PIXELS = 5;

export class PCB_CONTROL extends PCB_TOOL_BASE {
  private m_frame: PCB_BASE_FRAME | null = null;
  /** Grid origin marker. */
  private readonly m_gridOrigin = new ORIGIN_VIEWITEM();
  private m_pickerItem: BOARD_ITEM | null = null;
  private m_statusPopup: STATUS_TEXT_POPUP | null = null;

  constructor() {
    super('pcbnew.Control');
  }

  /** The grid origin's view item, which the grid-origin undo record clones. */
  GridOriginItem(): ORIGIN_VIEWITEM {
    return this.m_gridOrigin;
  }

  override Reset(aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<PCB_BASE_FRAME>();

    if (
      aReason === RESET.MODEL_RELOAD ||
      aReason === RESET.GAL_SWITCH ||
      aReason === RESET.REDRAW
    ) {
      // Nothing to read while the frame is still binding its board.
      if (!this.getModel()) return;

      this.m_gridOrigin.SetPosition(this.board().GetDesignSettings().GetGridOrigin());

      const gal = this.m_frame.GetCanvas()?.GetGAL();
      const grid = (this.m_frame as unknown as { GetGridColor?(): Color4d }).GetGridColor?.();

      if (gal && grid) {
        const backgroundBrightness = brightness(gal.GetClearColor());
        const color = backgroundBrightness > 0.5 ? darkened(grid, 0.25) : brightened(grid, 0.25);

        this.m_gridOrigin.SetColor(color);
      }

      // getView()->Remove / Add( m_gridOrigin ): TRANSITIONAL, the board canvas
      // draws the marker itself (see ORIGIN_VIEWITEM).
    }
  }

  static DoSetGridOrigin(
    aView: VIEW | null,
    aFrame: PCB_BASE_FRAME,
    originViewItem: EDA_ITEM,
    aPoint: VECTOR2D,
  ): void {
    DoSetGridOrigin(aView, aFrame, originViewItem, aPoint);
  }

  GridPlaceOrigin(aEvent: TOOL_EVENT): number {
    const origin = aEvent.HasParameter() ? aEvent.Parameter<VECTOR2D | null>() : null;

    if (origin) {
      // We can't undo the other grid dialog settings, so no sense undoing just the origin
      PCB_CONTROL.DoSetGridOrigin(this.getView(), this.m_frame!, this.m_gridOrigin, origin);
    } else {
      if (this.m_isFootprintEditor && !this.getEditFrame<PCB_BASE_EDIT_FRAME>().GetModel())
        return 0;

      const picker = this.m_toolMgr!.FindTool(
        'pcbnew.InteractivePicker',
      ) as unknown as PCB_PICKER_TOOL | null;

      if (!picker)
        // Happens in footprint wizard
        return 0;

      // Deactivate other tools; particularly important if another PICKER is currently running
      this.Activate();

      picker.SetCursor(KICURSOR.PLACE);
      picker.ClearHandlers();

      picker.SetClickHandler((pt: VECTOR2D): boolean => {
        (this.m_frame as unknown as PCB_BASE_EDIT_FRAME).SaveCopyInUndoList(
          this.m_gridOrigin,
          UNDO_REDO.GRIDORIGIN,
        );
        PCB_CONTROL.DoSetGridOrigin(this.getView(), this.m_frame!, this.m_gridOrigin, pt);
        return false; // drill origin is a one-shot; don't continue with tool
      });

      this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);
    }

    return 0;
  }

  GridResetOrigin(_aEvent: TOOL_EVENT): number {
    (this.m_frame as unknown as PCB_BASE_EDIT_FRAME).SaveCopyInUndoList(
      this.m_gridOrigin,
      UNDO_REDO.GRIDORIGIN,
    );
    PCB_CONTROL.DoSetGridOrigin(this.getView(), this.m_frame!, this.m_gridOrigin, { x: 0, y: 0 });
    return 0;
  }

  InteractiveDelete(aEvent: TOOL_EVENT): number {
    if (this.m_isFootprintEditor && !this.m_frame!.GetBoard()!.GetFirstFootprint()) return 0;

    const picker = this.m_toolMgr!.FindTool(
      'pcbnew.InteractivePicker',
    ) as unknown as PCB_PICKER_TOOL;
    const selectionTool = (): PCB_SELECTION_TOOL =>
      this.m_toolMgr!.FindTool('common.InteractiveSelection') as unknown as PCB_SELECTION_TOOL;

    this.m_pickerItem = null;
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    // Deactivate other tools; particularly important if another PICKER is currently running
    this.Activate();

    picker.SetCursor(KICURSOR.REMOVE);
    picker.SetSnapping(false);
    picker.ClearHandlers();

    picker.SetClickHandler((_aPosition: VECTOR2D): boolean => {
      if (this.m_pickerItem) {
        if (this.m_pickerItem?.IsLocked()) {
          this.m_statusPopup = new STATUS_TEXT_POPUP();
          this.m_statusPopup.SetText('Item locked.');
          this.m_statusPopup.PopupFor(2000);
          const at = KIPLATFORM_UI.GetMousePosition();
          this.m_statusPopup.Move({ x: at.x + 20, y: at.y + 20 });
          return true;
        }

        selectionTool().UnbrightenItem(this.m_pickerItem);

        const items = new PCB_SELECTION();
        items.Add(this.m_pickerItem);

        const editTool = this.m_toolMgr!.FindTool('pcbnew.InteractiveEdit') as unknown as EDIT_TOOL;
        editTool.DeleteItems(items, false);

        this.m_pickerItem = null;
      }

      return true;
    });

    picker.SetMotionHandler((aPos: VECTOR2D): void => {
      const board = this.m_frame!.GetBoard()!;
      const sel = selectionTool();
      const guide = sel.getCollectorsGuide();
      const collector = new GENERAL_COLLECTOR();
      collector.m_Threshold = KiROUND(this.getView()!.ToWorld(HITTEST_THRESHOLD_PIXELS));

      if (this.m_isFootprintEditor)
        collector.Collect(board, GENERAL_COLLECTOR.FootprintItems, aPos, guide);
      else collector.Collect(board, GENERAL_COLLECTOR.BoardLevelItems, aPos, guide);

      // Remove unselectable items
      for (let i = collector.GetCount() - 1; i >= 0; --i) {
        if (!sel.Selectable(collector.at(i)!)) collector.Remove(i);
      }

      sel.FilterCollectorForHierarchy(collector, false);
      sel.FilterCollectedItems(collector, false, null);

      if (collector.GetCount() > 1) sel.GuessSelectionCandidates(collector, aPos);

      const item = collector.GetCount() === 1 ? collector.at(0) : null;

      if (this.m_pickerItem !== item) {
        if (this.m_pickerItem) sel.UnbrightenItem(this.m_pickerItem);

        this.m_pickerItem = item;

        if (this.m_pickerItem) sel.BrightenItem(this.m_pickerItem);
      }
    });

    picker.SetFinalizeHandler((_aFinalState: number): void => {
      if (this.m_pickerItem) selectionTool().UnbrightenItem(this.m_pickerItem);

      this.m_statusPopup = null;

      // Ensure the cursor gets changed&updated
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      this.m_frame!.GetCanvas()?.Refresh();
    });

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    return 0;
  }

  /**
   * `placeBoardItems( aCommit, aItems, aIsNew, aAnchorAtOrigin,
   * aReannotateDuplicates, aSkipMove )` (pcb_control.cpp:1971-2083): select the
   * items, stage them in the commit, then hand them to EDIT_TOOL's move,
   * synchronously, unless asked not to.
   */
  *placeBoardItems(
    aCommit: BOARD_COMMIT,
    aItems: BOARD_ITEM[],
    aIsNew: boolean,
    aAnchorAtOrigin: boolean,
    aReannotateDuplicates: boolean,
    aSkipMove: boolean,
  ): COROUTINE_BODY<boolean> {
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    const selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;

    const itemsToSel: BOARD_ITEM[] = [];

    for (const item of aItems) {
      if (aIsNew) {
        // `ResetUuid()`: a new item is in no board's index yet, so the raw
        // reset is the same thing here.
        item.ResetUuidDirect();

        item.RunOnChildren((aChild: BOARD_ITEM) => aChild.ResetUuidDirect(), RECURSE_MODE.RECURSE);

        // While BOARD_COMMIT::Push() will add any new items to the entered group,
        // we need to do it earlier so that the previews while moving are correct.
        const enteredGroup = selectionTool.GetEnteredGroup();

        if (enteredGroup && item.IsGroupableType() && !item.GetParentGroup()) {
          aCommit.Modify(enteredGroup, null, RECURSE_MODE.NO_RECURSE);
          enteredGroup.AddItem(item);
        }

        item.SetParent(this.board() as unknown as BOARD_ITEM);

        // A pasted zone must not reuse a name already on the board (issue 23131)
        if (item.Type() === KICAD_T.PCB_ZONE_T) {
          const zone = item as unknown as ZONE;

          if (zone.GetZoneName() !== '')
            zone.SetZoneName(this.board().GetUniqueZoneName(zone.GetZoneName(), null));
        }
      }

      // Update item attributes if needed
      if (BaseType(item.Type()) === KICAD_T.PCB_DIMENSION_T) {
        (item as unknown as PCB_DIMENSION_BASE).UpdateUnits();
      } else if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const footprint = item as unknown as FOOTPRINT;

        // Update the footprint path with the new KIID path if the footprint is new
        if (aIsNew) footprint.SetPath([]);

        for (const dwg of footprint.GraphicalItems()) {
          if (BaseType(dwg.Type()) === KICAD_T.PCB_DIMENSION_T)
            (dwg as unknown as PCB_DIMENSION_BASE).UpdateUnits();
        }
      }

      // We only need to add the items that aren't inside a group currently selected
      // to the selection. If an item is inside a group and that group is selected,
      // then the selection tool will select it for us.
      const parentGroup = item.GetParentGroup();

      if (!parentGroup || !aItems.includes(parentGroup.AsEdaItem() as unknown as BOARD_ITEM))
        itemsToSel.push(item);
    }

    // Select the items that should be selected
    const toSel: EDA_ITEM[] = [...itemsToSel];
    this.m_toolMgr!.RunAction(ACTIONS.selectItems, toSel);

    // Reannotate duplicate footprints (make sense only in board editor ): TRANSITIONAL,
    // BOARD_REANNOTATE_TOOL is not ported yet.
    void aReannotateDuplicates;

    for (const item of aItems) {
      if (aIsNew) aCommit.Add(item);
      else aCommit.Added(item);
    }

    const selection = selectionTool.GetSelection();

    if (selection.Size() > 0) {
      if (aAnchorAtOrigin) {
        selection.SetReferencePoint({ x: 0, y: 0 });
      } else {
        const item = selection.GetTopLeftItem() as BOARD_ITEM | null;

        if (item) selection.SetReferencePoint(item.GetPosition());
      }

      const controls = this.getViewControls() as unknown as VIEW_CONTROLS;
      controls.SetCursorPosition(controls.GetMousePosition(), false);

      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

      if (!aSkipMove) return yield* this.RunSynchronousActionWait(PCB_ACTIONS.move, aCommit);
    }

    return true;
  }

  *PlaceCharacteristics(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const commit = new BOARD_COMMIT(this);
    const displayUnit = this.m_frame!.GetUserUnits();
    const table = Build_Board_Characteristics_Table(this.m_frame!.GetBoard()!, displayUnit);
    table.SetLayer(this.m_frame!.GetActiveLayer());

    const items: BOARD_ITEM[] = [table];

    if (yield* this.placeBoardItems(commit, items, true, true, false, false))
      commit.Push('Place Board Characteristics');

    return 0;
  }

  *PlaceStackup(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const commit = new BOARD_COMMIT(this);
    const displayUnit = this.m_frame!.GetUserUnits();

    const table = Build_Board_Stackup_Table(this.m_frame!.GetBoard()!, displayUnit);
    table.SetLayer(this.m_frame!.GetActiveLayer());

    const items: BOARD_ITEM[] = [table];

    if (yield* this.placeBoardItems(commit, items, true, true, false, false))
      commit.Push('Place Board Stackup Table');

    return 0;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.GridPlaceOrigin), ACTIONS.gridSetOrigin.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.GridResetOrigin), ACTIONS.gridResetOrigin.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.InteractiveDelete), ACTIONS.deleteTool.MakeEvent());
    this.Go(this.PlaceCharacteristics, PCB_ACTIONS.placeCharacteristics.MakeEvent());
    this.Go(this.PlaceStackup, PCB_ACTIONS.placeStackup.MakeEvent());
  }
}
