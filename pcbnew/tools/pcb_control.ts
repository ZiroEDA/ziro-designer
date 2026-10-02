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
import { GetClipboardUTF8, GetImageFromClipboard } from '@ziroeda/common/clipboard.js';
import { DisplayErrorMessage, IsOK } from '@ziroeda/common/confirm.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { IS_NEW, SKIP_STRUCT } from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { BOARD } from '../board.js';
import { CLIPBOARD_IO } from '../kicad_clipboard.js';
import { NETINFO_LIST } from '../netinfo.js';
import { PCB_REFERENCE_IMAGE } from '../pcb_reference_image.js';
import { PCB_TEXT } from '../pcb_text.js';
import type { PCB_VIA } from '../pcb_track.js';
import type { PASTE_MODE } from '../pcb_base_edit_frame.js';
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

/**
 * `pasteFootprintItemsToFootprintEditor( aClipFootprint, aBoard, aPastedItems )`
 * (pcb_control.cpp:925-1007): a pasted footprint's items, moved into the
 * footprint being edited, turned to its orientation.
 */
function pasteFootprintItemsToFootprintEditor(
  aClipFootprint: FOOTPRINT,
  aBoard: BOARD,
  aPastedItems: BOARD_ITEM[],
): void {
  const editorFootprint = aBoard.GetFirstFootprint()!;

  aClipFootprint.SetParent(aBoard as unknown as BOARD_ITEM);

  for (const pad of aClipFootprint.Pads()) {
    pad.SetParent(editorFootprint);
    aPastedItems.push(pad);
  }

  aClipFootprint.Pads().length = 0;

  // Not all items can be added to the current footprint: mandatory fields are already existing
  // in the current footprint.
  //
  for (const field of aClipFootprint.GetFields()) {
    if (!field) continue;

    if (field.IsMandatory()) {
      field.GetParentGroup()?.RemoveItem(field);
    } else {
      const text = field as unknown as PCB_TEXT;

      text.SetTextAngle(text.GetTextAngle().sub(aClipFootprint.GetOrientation()));
      text.SetTextAngle(text.GetTextAngle().add(editorFootprint.GetOrientation()));

      const pos = field.GetFPRelativePosition();
      field.SetParent(editorFootprint);
      field.SetFPRelativePosition(pos);

      aPastedItems.push(field);
    }
  }

  aClipFootprint.GetFields().length = 0;

  for (const item of aClipFootprint.GraphicalItems()) {
    if (item.Type() === KICAD_T.PCB_TEXT_T) {
      const text = item as unknown as PCB_TEXT;

      text.SetTextAngle(text.GetTextAngle().sub(aClipFootprint.GetOrientation()));
      text.SetTextAngle(text.GetTextAngle().add(editorFootprint.GetOrientation()));
    }

    item.Rotate(item.GetPosition(), aClipFootprint.GetOrientation().negate());
    item.Rotate(item.GetPosition(), editorFootprint.GetOrientation());

    const pos = item.GetFPRelativePosition();
    item.SetParent(editorFootprint);
    item.SetFPRelativePosition(pos);

    aPastedItems.push(item);
  }

  aClipFootprint.GraphicalItems().length = 0;

  for (const zone of aClipFootprint.Zones()) {
    zone.SetParent(editorFootprint);
    aPastedItems.push(zone);
  }

  aClipFootprint.Zones().length = 0;

  for (const group of aClipFootprint.Groups()) {
    group.SetParent(editorFootprint);
    aPastedItems.push(group);
  }

  aClipFootprint.Groups().length = 0;
}

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

  /**
   * `pruneItemLayers( aItems )` (pcb_control.cpp:1010-1074): items on layers the
   * board has not enabled are dropped (a footprint and its children never are),
   * with a warning.
   */
  private pruneItemLayers(aItems: BOARD_ITEM[]): BOARD_ITEM[] {
    // Do not prune items or layers when copying to the FP editor, because all
    // layers are accepted, even if they are not enabled in the dummy board
    // This is mainly true for internal copper layers: all are allowed but only one
    // (In1.cu) is enabled for the GUI.
    if (this.m_isFootprintEditor || this.m_frame!.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR))
      return aItems;

    const enabledLayers = this.board().GetEnabledLayers();
    const returnItems: BOARD_ITEM[] = [];
    const fpItemDeleted = false;

    for (const item of aItems) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        // Items living in a parent footprint are never removed, even if their
        // layer does not exist in the board editor
        // Otherwise the parent footprint could be seriously broken especially
        // if some layers are later re-enabled.
        // Moreover a fp lives in a fp library, that does not know the enabled
        // layers of a given board, so fp items are just ignored when on not
        // enabled layers in board editor
        returnItems.push(item);
      } else if (item.Type() === KICAD_T.PCB_GROUP_T || item.Type() === KICAD_T.PCB_GENERATOR_T) {
        returnItems.push(item);
      } else {
        const allowed = item.GetLayerSet().and(enabledLayers);
        let item_valid = true;

        // Ensure, for vias, the top and bottom layers are compatible with
        // the current board copper layers.
        // Otherwise they must be skipped, even is one layer is valid
        if (item.Type() === KICAD_T.PCB_VIA_T)
          item_valid = (item as unknown as PCB_VIA).HasValidLayerPair(
            this.board().GetCopperLayerCount(),
          );

        if (allowed.any() && item_valid) {
          item.SetLayerSet(allowed);
          returnItems.push(item);
        } else {
          item.GetParentGroup()?.RemoveItem(item);
        }
      }
    }

    if (returnItems.length < aItems.length || fpItemDeleted) {
      DisplayErrorMessage(
        'Warning: some pasted items were on layers which are not present in the current board.\n' +
          'These items could not be pasted.\n',
      );
    }

    return returnItems;
  }

  /**
   * `placeBoardItems( aCommit, aBoard, aAnchorAtOrigin, aReannotateDuplicates,
   * aSkipMove )` (:1932-1968): a parsed board's items, made new when it is not
   * this frame's board.
   */
  *placeBoardItemsFromBoard(
    aCommit: BOARD_COMMIT,
    aBoard: BOARD,
    aAnchorAtOrigin: boolean,
    aReannotateDuplicates: boolean,
    aSkipMove: boolean,
  ): COROUTINE_BODY<boolean> {
    // items are new if the current board is not the board source
    const isNew = this.board() !== aBoard;
    let items: BOARD_ITEM[] = [];

    for (const item of aBoard.GetItemSet()) {
      // Marker transfer is intentionally not part of append/paste item placement.
      if (item.Type() === KICAD_T.PCB_MARKER_T) continue;

      const doCopy = (item.GetFlags() & SKIP_STRUCT) === 0;

      item.ClearFlags(SKIP_STRUCT);
      item.SetFlags(isNew ? IS_NEW : 0);

      if (doCopy) items.push(item);
    }

    if (isNew) aBoard.RemoveAll();

    // Reparent before calling pruneItemLayers, as SetLayer can have a dependence on the
    // item's parent board being set correctly.
    if (isNew) {
      for (const item of items) item.SetParent(this.board() as unknown as BOARD_ITEM);
    }

    items = this.pruneItemLayers(items);

    return yield* this.placeBoardItems(
      aCommit,
      items,
      isNew,
      aAnchorAtOrigin,
      aReannotateDuplicates,
      aSkipMove,
    );
  }

  /** `PCB_CONTROL::Paste` (:1077-1387): the clipboard, as a board, a footprint, an image or text. */
  *Paste(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame as unknown as PCB_BASE_EDIT_FRAME;

    // The viewer frames cannot paste
    if (!frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR) && !frame.IsType(FRAME_T.FRAME_PCB_EDITOR))
      return 0;

    const isFootprintEditor =
      this.m_isFootprintEditor || frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR);

    // The clipboard can contain two different things, an entire kicad_pcb or a single footprint
    if (isFootprintEditor && (!this.getModel() || !this.board().GetFirstFootprint())) return 0;

    const commit = new BOARD_COMMIT(frame);

    const pi = new CLIPBOARD_IO();
    const clipItem = pi.Parse();

    // A selection of table cells takes a pasted table cell by cell
    // (PCB_EDIT_TABLE_TOOL::pasteCellsIntoSelection): TRANSITIONAL, that tool is
    // not ported, so a table pastes as a table.

    if (!clipItem) {
      // When the clipboard doesn't parse, create a PCB item with the clipboard contents
      const newItems: BOARD_ITEM[] = [];
      const clipImg = GetImageFromClipboard();

      if (clipImg) {
        const refImg = new PCB_REFERENCE_IMAGE(frame.GetModel() as unknown as BOARD_ITEM);

        if (refImg.GetReferenceImage().SetImage(clipImg)) newItems.push(refImg);
      } else {
        const clipText = GetClipboardUTF8();

        if (clipText === '') return 0;

        // If it wasn't content, then paste as a text object.
        if (clipText.length > ADVANCED_CFG.GetCfg().m_MaxPastedTextLength) {
          const result = yield* this.RunMainStackModal(() =>
            IsOK('Pasting a long text text string may be very slow.  Do you want to continue?'),
          );

          if (!result) return 0;
        }

        const item = new PCB_TEXT(frame.GetModel() as unknown as BOARD_ITEM);
        item.SetText(clipText);
        item.SetLayer(frame.GetActiveLayer());

        newItems.push(item);
      }

      const cancelled = !(yield* this.placeBoardItems(commit, newItems, true, false, false, false));

      if (cancelled) commit.Revert();
      else commit.Push('Paste Text');

      return 0;
    }

    // If we get here, we have a parsed board/FP to paste

    let mode: PASTE_MODE = 'KEEP_ANNOTATIONS';
    let clear_nets = false;
    const defaultRef = 'REF**';

    if (aEvent.IsAction(ACTIONS.pasteSpecial)) {
      // DIALOG_PASTE_SPECIAL dlg( m_frame, &mode, defaultRef ); HideClearNets() for a footprint
      const dlg = yield* this.RunMainStackModal(() =>
        frame.ShowPasteSpecialDialog(clipItem.Type() === KICAD_T.PCB_T),
      );

      if (!dlg) return 0;

      mode = dlg.mode;
      clear_nets = dlg.clearNets;
    }

    if (clipItem.Type() === KICAD_T.PCB_T) {
      const clipBoard = clipItem as unknown as BOARD;

      if (isFootprintEditor || clear_nets) {
        for (const item of clipBoard.AllConnectedItems()) item.SetNet(NETINFO_LIST.OrphanedItem());
      } else {
        clipBoard.MapNets(frame.GetBoard()!);
      }
    }

    let cancelled = false;

    switch (clipItem.Type()) {
      case KICAD_T.PCB_T: {
        const clipBoard = clipItem as unknown as BOARD;

        if (isFootprintEditor) {
          const editorFootprint = this.board().GetFirstFootprint()!;
          let pastedItems: BOARD_ITEM[] = [];

          for (const group of clipBoard.Groups()) {
            group.SetParent(editorFootprint);
            pastedItems.push(group);
          }

          clipBoard.RemoveAll([KICAD_T.PCB_GROUP_T]);

          for (const clipFootprint of clipBoard.Footprints())
            pasteFootprintItemsToFootprintEditor(clipFootprint, this.board(), pastedItems);

          for (const clipDrawItem of clipBoard.Drawings()) {
            switch (clipDrawItem.Type()) {
              case KICAD_T.PCB_TEXT_T:
              case KICAD_T.PCB_TEXTBOX_T:
              case KICAD_T.PCB_TABLE_T:
              case KICAD_T.PCB_SHAPE_T:
              case KICAD_T.PCB_BARCODE_T:
              case KICAD_T.PCB_DIM_ALIGNED_T:
              case KICAD_T.PCB_DIM_CENTER_T:
              case KICAD_T.PCB_DIM_LEADER_T:
              case KICAD_T.PCB_DIM_ORTHOGONAL_T:
              case KICAD_T.PCB_DIM_RADIAL_T:
              case KICAD_T.PCB_POINT_T:
                clipDrawItem.SetParent(editorFootprint);
                pastedItems.push(clipDrawItem);
                break;

              default:
                // Everything we *didn't* put into pastedItems is going to get nuked, so
                // make sure it's not still included in its parent group.
                clipDrawItem.GetParentGroup()?.RemoveItem(clipDrawItem);

                break;
            }
          }

          // NB: PCB_SHAPE_T actually removes everything in Drawings() (including PCB_TEXTs,
          // PCB_TABLEs, PCB_BARCODEs, dimensions, etc.), not just PCB_SHAPEs.)
          clipBoard.RemoveAll([KICAD_T.PCB_SHAPE_T]);

          // Anything still on the clipboard didn't get copied and needs to be
          // removed from the pasted groups.
          for (const boardItem of clipBoard.GetItemSet()) {
            boardItem.GetParentGroup()?.RemoveItem(boardItem);

            boardItem.RunOnChildren((aChild: BOARD_ITEM) => {
              aChild.GetParentGroup()?.RemoveItem(aChild);
            }, RECURSE_MODE.RECURSE);
          }

          pastedItems = this.pruneItemLayers(pastedItems);

          cancelled = !(yield* this.placeBoardItems(
            commit,
            pastedItems,
            true,
            true,
            mode === 'UNIQUE_ANNOTATIONS',
            false,
          ));
        } else {
          // isBoardEditor
          // Fixup footprint component classes
          for (const fp of clipBoard.Footprints()) {
            fp.ResolveComponentClassNames(this.board(), fp.GetTransientComponentClassNames());
            fp.ClearTransientComponentClassNames();
          }

          if (mode === 'REMOVE_ANNOTATIONS') {
            for (const fp of clipBoard.Footprints()) fp.SetReference(defaultRef);
          }

          cancelled = !(yield* this.placeBoardItemsFromBoard(
            commit,
            clipBoard,
            true,
            mode === 'UNIQUE_ANNOTATIONS',
            false,
          ));
        }

        break;
      }

      case KICAD_T.PCB_FOOTPRINT_T: {
        const clipFootprint = clipItem as unknown as FOOTPRINT;
        let pastedItems: BOARD_ITEM[] = [];

        if (isFootprintEditor) {
          pasteFootprintItemsToFootprintEditor(clipFootprint, this.board(), pastedItems);
        } else {
          if (mode === 'REMOVE_ANNOTATIONS') clipFootprint.SetReference(defaultRef);

          clipFootprint.SetParent(this.board() as unknown as BOARD_ITEM);
          clipFootprint.ResolveComponentClassNames(
            this.board(),
            clipFootprint.GetTransientComponentClassNames(),
          );
          clipFootprint.ClearTransientComponentClassNames();
          pastedItems.push(clipFootprint);
        }

        pastedItems = this.pruneItemLayers(pastedItems);

        cancelled = !(yield* this.placeBoardItems(
          commit,
          pastedItems,
          true,
          true,
          mode === 'UNIQUE_ANNOTATIONS',
          false,
        ));
        break;
      }

      default:
        frame.DisplayToolMsg('Invalid clipboard contents');
        break;
    }

    if (cancelled) commit.Revert();
    else commit.Push('Paste');

    return 1;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.GridPlaceOrigin), ACTIONS.gridSetOrigin.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.GridResetOrigin), ACTIONS.gridResetOrigin.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.InteractiveDelete), ACTIONS.deleteTool.MakeEvent());
    this.Go(this.PlaceCharacteristics, PCB_ACTIONS.placeCharacteristics.MakeEvent());
    this.Go(this.PlaceStackup, PCB_ACTIONS.placeStackup.MakeEvent());
    this.Go(this.Paste, ACTIONS.paste.MakeEvent());
    this.Go(this.Paste, ACTIONS.pasteSpecial.MakeEvent());
  }
}
