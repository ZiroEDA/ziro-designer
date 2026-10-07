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
import { PCB_CONTROL_Print, type PRINT_FRAME_HOST } from '../dialogs/dialog_print_pcbnew.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { type RESET_REASON, RESET_REASON as RESET } from '@ziroeda/common/tool/tool_base.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { INT_MAX, KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_ITEM } from '../board_item.js';
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
import type { FOOTPRINT_VIEWER_FRAME } from '../footprint_viewer_frame.js';
import type { BOARD } from '../board.js';
import { CLIPBOARD_IO } from '../kicad_clipboard.js';
import { NETINFO_LIST } from '../netinfo.js';
import { PCB_REFERENCE_IMAGE } from '../pcb_reference_image.js';
import { PCB_TEXT } from '../pcb_text.js';
import { PCB_TRACK, type PCB_VIA } from '../pcb_track.js';
import type { PASTE_MODE } from '../pcb_base_edit_frame.js';
import { type FPVIEWER_CONSTANTS, PCB_ACTIONS, PCB_EVENTS } from './pcb_actions.js';
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
import { GetMsgPanelDisplayUuid, MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { DRC_CONSTRAINT_T } from '../drc/drc_rule.js';
import { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import {
  SHAPE_POLY_SET,
  TransformCircleToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { PADSTACK } from '../padstack.js';
import type { PAD } from '../pad.js';
import { PCB_GROUP } from '../pcb_group.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { unescapeString } from '@ziroeda/common/string_utils.js';
import {
  GAL_LAYER_ID,
  UNDEFINED_LAYER,
  GetNetnameLayer,
  IsCopperLayer,
  PCB_LAYER_ID,
  ZONE_LAYER_FOR,
} from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { PCB_LAYER_PRESENTATION } from '../pcb_layer_presentation.js';
import { KeyNameFromKeyCode } from '@ziroeda/common/hotkeys_basic.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import {
  HIGH_CONTRAST_MODE,
  NET_COLOR_MODE,
  RATSNEST_MODE,
  ZONE_DISPLAY_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import { PCB_DISPLAY_OPTIONS } from '../pcb_painter.js';
import { MAGNETIC_SETTINGS } from '../pcbnew_settings.js';

/** `HITTEST_THRESHOLD_PIXELS` (pcb_control.cpp:817). */
// It'd be nice to share the min/max with the DIALOG_COLOR_PICKER, but those are
// set in wxFormBuilder.
const ALPHA_MIN = 0.2;
const ALPHA_MAX = 1.0;
const ALPHA_STEP = 0.05;

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

      this.getView()?.Remove(this.m_gridOrigin);
      this.getView()?.Add(this.m_gridOrigin);
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

  /** `PCB_EDIT_FRAME* editFrame = dynamic_cast<PCB_EDIT_FRAME*>( m_frame )`. */
  private editFrame(): PCB_EDIT_FRAME | null {
    const frame = this.m_frame;

    return frame?.IsType(FRAME_T.FRAME_PCB_EDITOR) ? (frame as unknown as PCB_EDIT_FRAME) : null;
  }

  /** `TrackDisplayMode` (pcb_control.cpp:217-236). */
  TrackDisplayMode(_aEvent: TOOL_EVENT): number {
    const opts = this.displayOptions();
    opts.m_DisplayPcbTrackFill = !opts.m_DisplayPcbTrackFill;

    for (const track of this.board().Tracks()) {
      if (track.Type() === KICAD_T.PCB_TRACE_T || track.Type() === KICAD_T.PCB_ARC_T)
        this.view()?.Update(track, VIEW_UPDATE_FLAGS.REPAINT);
    }

    for (const shape of this.board().Drawings()) {
      if (shape.Type() === KICAD_T.PCB_SHAPE_T && (shape as PCB_SHAPE).IsOnCopperLayer())
        this.view()?.Update(shape, VIEW_UPDATE_FLAGS.REPAINT);
    }

    this.canvas()?.Refresh();

    return 0;
  }

  /** `ToggleRatsnest` (pcb_control.cpp:239-261). */
  ToggleRatsnest(aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();

    if (editFrame) {
      const opts = this.displayOptions();

      if (aEvent.IsAction(PCB_ACTIONS.showRatsnest)) {
        // N.B. Do not disable the Ratsnest layer here.  We use it for local ratsnest
        opts.m_ShowGlobalRatsnest = !opts.m_ShowGlobalRatsnest;
        editFrame.SetElementVisibility(GAL_LAYER_ID.LAYER_RATSNEST, opts.m_ShowGlobalRatsnest);
      } else if (aEvent.IsAction(PCB_ACTIONS.ratsnestLineMode)) {
        opts.m_DisplayRatsnestLinesCurved = !opts.m_DisplayRatsnestLinesCurved;
      }

      editFrame.OnDisplayOptionsChanged();

      this.canvas()?.RedrawRatsnest();
      this.canvas()?.Refresh();
    }

    return 0;
  }

  /** `ViaDisplayMode` (pcb_control.cpp:264-276). */
  ViaDisplayMode(_aEvent: TOOL_EVENT): number {
    const opts = this.displayOptions();
    opts.m_DisplayViaFill = !opts.m_DisplayViaFill;

    for (const track of this.board().Tracks()) {
      if (track.Type() === KICAD_T.PCB_VIA_T) this.view()?.Update(track, VIEW_UPDATE_FLAGS.REPAINT);
    }

    this.canvas()?.Refresh();
    return 0;
  }

  /** `unfilledZoneCheck()` (pcb_control.cpp:284-322). */
  private unfilledZoneCheck(): void {
    const common = PgmOrNull()?.GetCommonSettings();

    if (common?.m_DoNotShowAgain.zone_fill_warning) return;

    let unfilledZones = false;

    for (const zone of this.board().Zones()) {
      if (!zone.GetIsRuleArea() && !zone.IsFilled()) {
        unfilledZones = true;
        break;
      }
    }

    if (unfilledZones) {
      const infobar = this.m_frame!.GetInfoBar();

      if (!infobar) return;

      infobar.RemoveAllButtons();
      infobar.AddButton({
        label: "Don't show again",
        onClick: () => {
          if (common) common.m_DoNotShowAgain.zone_fill_warning = true;

          this.m_frame!.GetInfoBar()?.Dismiss();
        },
      });

      const msg =
        'Not all zones are filled. Use Edit > Fill All Zones (' +
        KeyNameFromKeyCode(PCB_ACTIONS.zoneFillAll.GetHotKey()) +
        ') if you wish to see all fills.';

      infobar.ShowMessageFor(msg, 5000, 'warning');
    }
  }

  /** `ZoneDisplayMode` (pcb_control.cpp:325-368). */
  ZoneDisplayMode(aEvent: TOOL_EVENT): number {
    const opts = Object.assign(new PCB_DISPLAY_OPTIONS(), this.m_frame!.GetDisplayOptions());

    // Apply new display options to the GAL canvas
    if (aEvent.IsAction(PCB_ACTIONS.zoneDisplayFilled)) {
      this.unfilledZoneCheck();

      opts.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_FILLED;
    } else if (aEvent.IsAction(PCB_ACTIONS.zoneDisplayOutline)) {
      opts.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE;
    } else if (aEvent.IsAction(PCB_ACTIONS.zoneDisplayFractured)) {
      opts.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_FRACTURE_BORDERS;
    } else if (aEvent.IsAction(PCB_ACTIONS.zoneDisplayTriangulated)) {
      opts.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_TRIANGULATION;
    } else if (aEvent.IsAction(PCB_ACTIONS.zoneDisplayToggle)) {
      if (opts.m_ZoneDisplayMode === ZONE_DISPLAY_MODE.SHOW_FILLED)
        opts.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_ZONE_OUTLINE;
      else opts.m_ZoneDisplayMode = ZONE_DISPLAY_MODE.SHOW_FILLED;
    } else {
      console.assert(false, 'ZoneDisplayMode: unknown action');
    }

    this.m_frame!.SetDisplayOptions(opts);

    for (const zone of this.board().Zones()) this.view()?.Update(zone, VIEW_UPDATE_FLAGS.REPAINT);

    this.canvas()?.Refresh();

    return 0;
  }

  /** `HighContrastMode` (pcb_control.cpp:371-380): NORMAL <-> DIMMED. */
  HighContrastMode(_aEvent: TOOL_EVENT): number {
    const opts = Object.assign(new PCB_DISPLAY_OPTIONS(), this.m_frame!.GetDisplayOptions());

    opts.m_ContrastModeDisplay =
      opts.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.NORMAL
        ? HIGH_CONTRAST_MODE.DIMMED
        : HIGH_CONTRAST_MODE.NORMAL;

    this.m_frame!.SetDisplayOptions(opts);
    return 0;
  }

  /** `HighContrastModeCycle` (pcb_control.cpp:383-398): NORMAL -> DIMMED -> HIDDEN. */
  HighContrastModeCycle(_aEvent: TOOL_EVENT): number {
    const opts = Object.assign(new PCB_DISPLAY_OPTIONS(), this.m_frame!.GetDisplayOptions());

    switch (opts.m_ContrastModeDisplay) {
      case HIGH_CONTRAST_MODE.NORMAL:
        opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.DIMMED;
        break;
      case HIGH_CONTRAST_MODE.DIMMED:
        opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.HIDDEN;
        break;
      case HIGH_CONTRAST_MODE.HIDDEN:
        opts.m_ContrastModeDisplay = HIGH_CONTRAST_MODE.NORMAL;
        break;
    }

    this.m_frame!.SetDisplayOptions(opts);

    this.m_toolMgr!.PostEvent(EVENTS.ContrastModeChangedByKeyEvent);
    return 0;
  }

  /** `ContrastModeFeedback` (pcb_control.cpp:401-424). */
  ContrastModeFeedback(_aEvent: TOOL_EVENT): number {
    if (!PgmOrNull()?.GetCommonSettings()?.m_Input.hotkey_feedback) return 0;

    const opts = this.m_frame!.GetDisplayOptions();

    const labels = ['Normal', 'Dimmed', 'Hidden'];

    if (!this.m_frame!.GetHotkeyPopup()) this.m_frame!.CreateHotkeyPopup();

    const popup = this.m_frame!.GetHotkeyPopup();

    if (popup) popup.Popup('Inactive Layer Display', labels, opts.m_ContrastModeDisplay);

    return 0;
  }

  /** `NetColorModeCycle` (pcb_control.cpp:427-440): ALL -> RATSNEST -> OFF. */
  NetColorModeCycle(_aEvent: TOOL_EVENT): number {
    const opts = Object.assign(new PCB_DISPLAY_OPTIONS(), this.m_frame!.GetDisplayOptions());

    switch (opts.m_NetColorMode) {
      case NET_COLOR_MODE.ALL:
        opts.m_NetColorMode = NET_COLOR_MODE.RATSNEST;
        break;
      case NET_COLOR_MODE.RATSNEST:
        opts.m_NetColorMode = NET_COLOR_MODE.OFF;
        break;
      case NET_COLOR_MODE.OFF:
        opts.m_NetColorMode = NET_COLOR_MODE.ALL;
        break;
    }

    this.m_frame!.SetDisplayOptions(opts);
    return 0;
  }

  /** `RatsnestModeCycle` (pcb_control.cpp:443-470): off -> all -> visible layers -> off. */
  RatsnestModeCycle(_aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();

    if (editFrame) {
      const opts = this.displayOptions();

      if (!opts.m_ShowGlobalRatsnest) {
        opts.m_ShowGlobalRatsnest = true;
        opts.m_RatsnestMode = RATSNEST_MODE.ALL;
      } else if (opts.m_RatsnestMode === RATSNEST_MODE.ALL) {
        opts.m_RatsnestMode = RATSNEST_MODE.VISIBLE;
      } else {
        opts.m_ShowGlobalRatsnest = false;
      }

      editFrame.SetElementVisibility(GAL_LAYER_ID.LAYER_RATSNEST, opts.m_ShowGlobalRatsnest);

      editFrame.OnDisplayOptionsChanged();

      this.canvas()?.RedrawRatsnest();
      this.canvas()?.Refresh();
    }

    return 0;
  }

  /** `LayerSwitch` (pcb_control.cpp:473-478). */
  LayerSwitch(aEvent: TOOL_EVENT): number {
    this.m_frame!.SwitchLayer(aEvent.Parameter<PCB_LAYER_ID>());

    return 0;
  }

  /** `LayerNext` (pcb_control.cpp:481-537): the next visible copper layer, wrapping once. */
  LayerNext(_aEvent: TOOL_EVENT): number {
    const brd = this.board();
    let layer = this.m_frame!.GetActiveLayer();
    let wraparound = false;

    if (!IsCopperLayer(layer)) {
      this.m_frame!.SwitchLayer(PCB_LAYER_ID.B_Cu);
      return 0;
    }

    const cuMask = LSET.AllCuMask(brd.GetCopperLayerCount());
    const layerStack = cuMask.UIOrder();

    let ii = 0;

    // Find the active layer in list
    for (; ii < layerStack.length; ii++) {
      if (layer === layerStack[ii]) break;
    }

    // Find the next visible layer in list
    for (; ii < layerStack.length; ii++) {
      let jj = ii + 1;

      if (jj >= layerStack.length) jj = 0;

      layer = layerStack[jj]!;

      if (brd.IsLayerVisible(layer)) break;

      if (jj === 0) {
        // the end of list is reached. Try from the beginning
        if (wraparound) {
          wxBell();
          return 0;
        } else {
          wraparound = true;
          ii = -1;
        }
      }
    }

    if (!IsCopperLayer(layer)) return 0;

    this.m_frame!.SwitchLayer(layer);

    return 0;
  }

  /** `LayerPrev` (pcb_control.cpp:540-596): the previous visible copper layer, wrapping once. */
  LayerPrev(_aEvent: TOOL_EVENT): number {
    const brd = this.board();
    let layer = this.m_frame!.GetActiveLayer();
    let wraparound = false;

    if (!IsCopperLayer(layer)) {
      this.m_frame!.SwitchLayer(PCB_LAYER_ID.F_Cu);
      return 0;
    }

    const cuMask = LSET.AllCuMask(brd.GetCopperLayerCount());
    const layerStack = cuMask.UIOrder();

    let ii = 0;

    // Find the active layer in list
    for (; ii < layerStack.length; ii++) {
      if (layer === layerStack[ii]) break;
    }

    // Find the previous visible layer in list
    for (; ii >= 0; ii--) {
      let jj = ii - 1;

      if (jj < 0) jj = layerStack.length - 1;

      layer = layerStack[jj]!;

      if (brd.IsLayerVisible(layer)) break;

      if (ii === 0) {
        // the start of list is reached. Try from the last
        if (wraparound) {
          wxBell();
          return 0;
        } else {
          wraparound = true;
          ii = 1;
        }
      }
    }

    if (!IsCopperLayer(layer)) return 0;

    this.m_frame!.SwitchLayer(layer);

    return 0;
  }

  /** `LayerToggle` (pcb_control.cpp:599-610): between the route layer pair. */
  LayerToggle(_aEvent: TOOL_EVENT): number {
    const currentLayer = this.m_frame!.GetActiveLayer();
    const screen = this.m_frame!.GetScreen()!;

    if (currentLayer === screen.m_Route_Layer_TOP)
      this.m_frame!.SwitchLayer(screen.m_Route_Layer_BOTTOM);
    else this.m_frame!.SwitchLayer(screen.m_Route_Layer_TOP);

    return 0;
  }

  /** `LayerAlphaInc` / `LayerAlphaDec`'s body (pcb_control.cpp:620-677). */
  private layerAlphaStep(aStep: number): number {
    const settings = this.m_frame!.GetColorSettings();
    const currentLayer = this.m_frame!.GetActiveLayer();
    const currentColor = { ...settings.GetColor(currentLayer) };

    if (
      aStep > 0
        ? currentColor.a <= ALPHA_MAX - ALPHA_STEP
        : currentColor.a >= ALPHA_MIN + ALPHA_STEP
    ) {
      currentColor.a += aStep;
      settings.SetColor(currentLayer, currentColor);
      this.m_frame!.GetCanvas()!.UpdateColors();

      const view = this.m_frame!.GetCanvas()!.GetView();
      view.UpdateLayerColor(currentLayer);
      view.UpdateLayerColor(GetNetnameLayer(currentLayer));

      if (IsCopperLayer(currentLayer)) view.UpdateLayerColor(ZONE_LAYER_FOR(currentLayer));

      this.m_frame!.GetCanvas()!.ForceRefresh();
    } else {
      wxBell();
    }

    return 0;
  }

  /** `LayerAlphaInc` (pcb_control.cpp:620-647). */
  LayerAlphaInc(_aEvent: TOOL_EVENT): number {
    return this.layerAlphaStep(ALPHA_STEP);
  }

  /** `LayerAlphaDec` (pcb_control.cpp:650-677). */
  LayerAlphaDec(_aEvent: TOOL_EVENT): number {
    return this.layerAlphaStep(-ALPHA_STEP);
  }

  /** `CycleLayerPresets` (pcb_control.cpp:680-710): the next enabled layer pair. */
  CycleLayerPresets(_aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();

    if (editFrame) {
      const settings = editFrame.GetLayerPairSettings();

      if (!settings) return 0;

      const { pairs: presets, current } = settings.GetEnabledLayerPairs();
      let currentIndex = current;

      if (presets.length < 2) return 0;

      if (currentIndex < 0) {
        console.assert(false, 'Current layer pair not found in layer settings');
        currentIndex = 0;
      }

      const nextIndex = (currentIndex + 1) % presets.length;
      const nextPair = presets[nextIndex]!.GetLayerPair();

      settings.SetCurrentLayerPair(nextPair);

      this.m_toolMgr!.PostEvent(PCB_EVENTS.LayerPairPresetChangedByKeyEvent());
    }

    return 0;
  }

  /** `LayerPresetFeedback` (pcb_control.cpp:713-754). */
  LayerPresetFeedback(_aEvent: TOOL_EVENT): number {
    if (!PgmOrNull()?.GetCommonSettings()?.m_Input.hotkey_feedback) return 0;

    const editFrame = this.editFrame();

    if (editFrame) {
      const settings = editFrame.GetLayerPairSettings();

      if (!settings) return 0;

      const layerPresentation = new PCB_LAYER_PRESENTATION(editFrame);

      const { pairs: presets, current: currentIndex } = settings.GetEnabledLayerPairs();

      const labels: string[] = [];

      for (const layerPairInfo of presets) {
        let label = layerPresentation.getLayerPairName(layerPairInfo.GetLayerPair());

        if (layerPairInfo.GetName()) label += ` (${layerPairInfo.GetName()})`;

        labels.push(label);
      }

      if (!editFrame.GetHotkeyPopup()) editFrame.CreateHotkeyPopup();

      const popup = editFrame.GetHotkeyPopup();

      if (popup) {
        const selection = currentIndex;
        popup.Popup('Preset Layer Pairs', labels, selection);
      }
    }

    return 0;
  }

  /** `Undo` (pcb_control.cpp:2311-2320). */
  Undo(_aEvent: TOOL_EVENT): number {
    const editFrame = this.m_frame as unknown as PCB_BASE_EDIT_FRAME | null;

    if (editFrame && 'RestoreCopyFromUndoList' in editFrame) editFrame.RestoreCopyFromUndoList();

    return 0;
  }

  /** `Redo` (pcb_control.cpp:2323-2332). */
  Redo(_aEvent: TOOL_EVENT): number {
    const editFrame = this.m_frame as unknown as PCB_BASE_EDIT_FRAME | null;

    if (editFrame && 'RestoreCopyFromRedoList' in editFrame) editFrame.RestoreCopyFromRedoList();

    return 0;
  }

  /** The editor's `MAGNETIC_SETTINGS`, the footprint editor's or the board editor's. */
  private magneticSettings(): MAGNETIC_SETTINGS {
    if (!this.m_isFootprintEditor) return this.m_frame!.GetPcbNewSettings().m_MagneticItems;

    const fpSettings = this.m_frame!.GetFootprintEditorSettings();

    // A frame whose footprint editor settings carry none snaps with the defaults.
    fpSettings.m_MagneticItems ??= new MAGNETIC_SETTINGS();

    return fpSettings.m_MagneticItems;
  }

  /** `SnapMode` (pcb_control.cpp:2335-2351): snap to the active layer, all layers, or flip. */
  SnapMode(aEvent: TOOL_EVENT): number {
    const settings = this.magneticSettings();

    if (aEvent.IsAction(PCB_ACTIONS.magneticSnapActiveLayer)) settings.allLayers = false;
    else if (aEvent.IsAction(PCB_ACTIONS.magneticSnapAllLayers)) settings.allLayers = true;
    else settings.allLayers = !settings.allLayers;

    this.m_toolMgr!.PostEvent(PCB_EVENTS.SnappingModeChangedByKeyEvent());

    return 0;
  }

  /** `SnapModeFeedback` (pcb_control.cpp:2354-2375). */
  SnapModeFeedback(_aEvent: TOOL_EVENT): number {
    if (!PgmOrNull()?.GetCommonSettings()?.m_Input.hotkey_feedback) return 0;

    const labels = ['Active Layer', 'All Layers'];

    if (!this.m_frame!.GetHotkeyPopup()) this.m_frame!.CreateHotkeyPopup();

    const popup = this.m_frame!.GetHotkeyPopup();

    const settings = this.magneticSettings();

    if (popup) popup.Popup('Object Snapping', labels, settings.allLayers ? 1 : 0);

    return 0;
  }

  /**
   * `UpdateMessagePanel` (pcb_control.cpp:2378-2884): the message panel for
   * the selection - the item's own info for one, the clearances between a
   * pair, and for any selection the type counts, net, length and area.
   */
  UpdateMessagePanel(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const selTool = this.m_toolMgr!.FindTool('common.InteractiveSelection') as unknown as {
      GetSelection(): PCB_SELECTION;
    } | null;
    const routerTool = this.m_toolMgr!.FindTool('pcbnew.InteractiveRouter') as unknown as {
      RoutingInProgress(): boolean;
      UpdateMessagePanel(): void;
    } | null;
    const selection = selTool!.GetSelection();
    const pcbFrame = this.editFrame();
    const units = frame.GetUnitsProvider();
    const drcEngine = frame.GetBoard()!.GetDesignSettings().m_DRCEngine;

    const msgItems: MSG_PANEL_ITEM[] = [];

    if (routerTool && routerTool.RoutingInProgress()) {
      routerTool.UpdateMessagePanel();
      return 0;
    }

    if (!pcbFrame && !frame.GetModel()) return 0;

    if (selection.Empty()) {
      if (!pcbFrame) {
        const fp = frame.GetModel() as unknown as FOOTPRINT;
        fp.GetMsgPanelInfo(frame.AsDrawFrameLike(), msgItems);
      } else {
        frame.SetMsgPanel(frame.GetBoard()!);
      }
    } else if (selection.GetSize() === 1) {
      const item = selection.Front()!;

      const uuid = GetMsgPanelDisplayUuid(item.m_Uuid);

      if (uuid !== undefined) msgItems.push(new MSG_PANEL_ITEM('UUID', uuid));

      item.GetMsgPanelInfo(frame.AsDrawFrameLike(), msgItems);

      const track = item instanceof PCB_TRACK ? item : null;
      const net = track ? track.GetNet() : null;
      const coupledNet = net ? frame.GetBoard()!.DpCoupledNet(net) : null;

      if (coupledNet && drcEngine) {
        const trackSeg = new SEG(track!.GetStart(), track!.GetEnd());
        let coupledItem: PCB_TRACK | null = null;
        let closestDist_sq = 0;

        for (const candidate of frame.GetBoard()!.Tracks()) {
          if (candidate.GetNet() !== coupledNet) continue;

          const dist_sq = trackSeg.SquaredDistance(
            new SEG(candidate.GetStart(), candidate.GetEnd()),
          );

          if (!coupledItem || dist_sq < closestDist_sq) {
            coupledItem = candidate;
            closestDist_sq = dist_sq;
          }
        }

        let constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT,
          track,
          coupledItem,
          track!.GetLayer(),
        );

        let msg = units.MessageTextFromMinOptMax(constraint.Value());

        if (msg !== '')
          msgItems.push(
            new MSG_PANEL_ITEM(`DP Gap Constraints: ${msg}`, `(from ${constraint.GetName()})`),
          );

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT,
          track,
          coupledItem,
          track!.GetLayer(),
        );

        if (constraint.Value().HasMax()) {
          msg = units.MessageTextFromValue(constraint.Value().Max());
          msgItems.push(
            new MSG_PANEL_ITEM(`DP Max Uncoupled-length: ${msg}`, `(from ${constraint.GetName()})`),
          );
        }
      }
    } else if (pcbFrame && selection.GetSize() === 2) {
      // Pair selection broken into multiple, optional data, starting with the selected item
      // names

      const a = selection.Items()[0] as BOARD_ITEM | undefined;
      const b = selection.Items()[1] as BOARD_ITEM | undefined;

      if (a && b)
        msgItems.push(
          new MSG_PANEL_ITEM(
            a.GetItemDescription(units, false),
            b.GetItemDescription(units, false),
          ),
        );

      const a_conn = a instanceof BOARD_CONNECTED_ITEM ? a : null;
      const b_conn = b instanceof BOARD_CONNECTED_ITEM ? b : null;

      if (a_conn && b_conn) {
        const overlap = a_conn.GetLayerSet().and(b_conn.GetLayerSet()).and(LSET.AllCuMask());
        const a_netcode = a_conn.GetNetCode();
        const b_netcode = b_conn.GetNetCode();

        if (overlap.count() > 0) {
          const layer = overlap.CuStack()[0]!;

          if ((a_netcode !== b_netcode || a_netcode < 0 || b_netcode < 0) && drcEngine) {
            const constraint = drcEngine.EvalRules(
              DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT,
              a!,
              b!,
              layer,
            );
            msgItems.push(
              new MSG_PANEL_ITEM(
                'Resolved Clearance',
                units.MessageTextFromValue(constraint.m_Value.Min()),
              ),
            );
          }

          const a_shape = a_conn.GetEffectiveShape(layer);
          const b_shape = b_conn.GetEffectiveShape(layer);

          const actual_clearance = a_shape.GetClearance(b_shape);

          if (actual_clearance > -1 && actual_clearance < INT_MAX)
            msgItems.push(
              new MSG_PANEL_ITEM('Actual Clearance', units.MessageTextFromValue(actual_clearance)),
            );
        }
      }

      if (a && b && (a.HasHole() || b.HasHole())) {
        const active = frame.GetActiveLayer();
        let layer: PCB_LAYER_ID = UNDEFINED_LAYER;

        if (b.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
        else if (b.HasHole() && a.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
        else if (a.HasHole() && b.IsOnCopperLayer()) layer = b.GetLayer();
        else if (b.HasHole() && a.IsOnCopperLayer()) layer = a.GetLayer();

        if (IsCopperLayer(layer)) {
          let actual = INT_MAX;

          if (a.HasHole() && b.IsOnCopperLayer()) {
            const hole = a.GetEffectiveHoleShape()!;
            const other = b.GetEffectiveShape(layer);

            actual = Math.min(actual, hole.GetClearance(other));
          }

          if (b.HasHole() && a.IsOnCopperLayer()) {
            const hole = b.GetEffectiveHoleShape()!;
            const other = a.GetEffectiveShape(layer);

            actual = Math.min(actual, hole.GetClearance(other));
          }

          if (actual < INT_MAX && drcEngine) {
            const constraint = drcEngine.EvalRules(
              DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
              a,
              b,
              layer,
            );
            msgItems.push(
              new MSG_PANEL_ITEM(
                'Resolved Hole Clearance',
                units.MessageTextFromValue(constraint.m_Value.Min()),
              ),
            );

            if (actual > -1 && actual < INT_MAX)
              msgItems.push(
                new MSG_PANEL_ITEM('Actual Hole Clearance', units.MessageTextFromValue(actual)),
              );
          }
        }
      }

      if (a && b) {
        for (const edgeLayer of [PCB_LAYER_ID.Edge_Cuts, PCB_LAYER_ID.Margin]) {
          const active = frame.GetActiveLayer();
          let layer: PCB_LAYER_ID = UNDEFINED_LAYER;

          if (a.IsOnLayer(edgeLayer) && b.Type() !== KICAD_T.PCB_FOOTPRINT_T) {
            if (b.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
            else if (IsCopperLayer(b.GetLayer())) layer = b.GetLayer();
          } else if (b.IsOnLayer(edgeLayer) && a.Type() !== KICAD_T.PCB_FOOTPRINT_T) {
            if (a.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
            else if (IsCopperLayer(a.GetLayer())) layer = a.GetLayer();
          }

          if (layer >= 0 && drcEngine) {
            const constraint = drcEngine.EvalRules(
              DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT,
              a,
              b,
              layer,
            );

            if (edgeLayer === PCB_LAYER_ID.Edge_Cuts)
              msgItems.push(
                new MSG_PANEL_ITEM(
                  'Resolved Edge Clearance',
                  units.MessageTextFromValue(constraint.m_Value.Min()),
                ),
              );
            else
              msgItems.push(
                new MSG_PANEL_ITEM(
                  'Resolved Margin Clearance',
                  units.MessageTextFromValue(constraint.m_Value.Min()),
                ),
              );
          }
        }
      }
    }

    if (selection.GetSize()) {
      if (msgItems.length === 0) {
        // Count items by type, in KICAD_T order (a std::map's)
        const typeCounts = new Map<KICAD_T, number>();

        for (const item of selection.Items())
          typeCounts.set(item.Type(), (typeCounts.get(item.Type()) ?? 0) + 1);

        const types = [...typeCounts.keys()].sort((x, y) => x - y);

        // Check if all items are the same type
        const allSameType = types.length === 1;
        const commonType = allSameType ? types[0]! : KICAD_T.NOT_USED;

        if (allSameType) {
          // Show "Type: N" for homogeneous selections
          const typeName = selection.Front()!.GetFriendlyName();
          msgItems.push(new MSG_PANEL_ITEM(typeName, `${selection.GetSize()}`));

          // For pads, show common properties
          if (commonType === KICAD_T.PCB_PAD_T) {
            const layers = new Set<string>();
            const shapes = new Set<number>();
            const sizes = new Set<string>();

            for (const item of selection.Items()) {
              const pad = item as unknown as PAD;
              layers.add(pad.LayerMaskDescribe());
              shapes.add(pad.GetShape(PADSTACK.ALL_LAYERS));
              const size = pad.GetSize(PADSTACK.ALL_LAYERS);
              sizes.add(`${size.x},${size.y}`);
            }

            if (layers.size === 1) msgItems.push(new MSG_PANEL_ITEM('Layer', [...layers][0]!));

            if (shapes.size === 1) {
              const firstPad = selection.Front() as unknown as PAD;
              msgItems.push(
                new MSG_PANEL_ITEM('Pad Shape', firstPad.ShowPadShape(PADSTACK.ALL_LAYERS)),
              );
            }

            if (sizes.size === 1) {
              const size = (selection.Front() as unknown as PAD).GetSize(PADSTACK.ALL_LAYERS);
              msgItems.push(
                new MSG_PANEL_ITEM(
                  'Pad Size',
                  `${units.MessageTextFromValue(size.x)} x ${units.MessageTextFromValue(size.y)}`,
                ),
              );
            }
          }
        } else {
          // Show type breakdown for mixed selections
          let breakdown = '';

          for (const type of types) {
            if (breakdown !== '') breakdown += ', ';

            // Get friendly name from first item of this type
            let typeName = '';

            for (const item of selection.Items()) {
              if (item.Type() === type) {
                typeName = item.GetFriendlyName();
                break;
              }
            }

            breakdown += `${typeName}: ${typeCounts.get(type)}`;
          }

          msgItems.push(
            new MSG_PANEL_ITEM('Selected Items', `${selection.GetSize()} (${breakdown})`),
          );
        }

        if (this.m_isBoardEditor) {
          const netNames = new Set<string>();
          const netClasses = new Set<string>();

          for (const item of selection.Items()) {
            if (item instanceof BOARD_CONNECTED_ITEM) {
              const bci = item;

              if (!bci.GetNet() || bci.GetNetCode() <= NETINFO_LIST.UNCONNECTED) continue;

              netNames.add(unescapeString(bci.GetNetname()));
              netClasses.add(unescapeString(bci.GetEffectiveNetClass().GetHumanReadableName()));

              if (netNames.size > 1 && netClasses.size > 1) break;
            }
          }

          if (netNames.size === 1) msgItems.push(new MSG_PANEL_ITEM('Net', [...netNames][0]!));

          if (netClasses.size === 1)
            msgItems.push(new MSG_PANEL_ITEM('Resolved Netclass', [...netClasses][0]!));
        }
      }

      if (selection.GetSize() >= 2) {
        let lengthValid = true;
        let selectedLength = 0;

        // Lambda to accumulate track length if item is a track or arc, otherwise mark invalid
        const accumulateTrackLength = (aItem: EDA_ITEM): void => {
          if (aItem.Type() === KICAD_T.PCB_TRACE_T || aItem.Type() === KICAD_T.PCB_ARC_T) {
            selectedLength += (aItem as unknown as PCB_TRACK).GetLength();
          } else if (aItem.Type() === KICAD_T.PCB_VIA_T) {
            // zero 2D length
          } else if (aItem.Type() === KICAD_T.PCB_SHAPE_T) {
            const shape = aItem as unknown as PCB_SHAPE;

            if (
              shape.GetShape() === SHAPE_T.SEGMENT ||
              shape.GetShape() === SHAPE_T.ARC ||
              shape.GetShape() === SHAPE_T.BEZIER
            )
              selectedLength += shape.GetLength();
            else lengthValid = false;
          }
          // Use dynamic_cast to include PCB_GENERATORs.
          else if (aItem instanceof PCB_GROUP) {
            aItem.RunOnChildren(accumulateTrackLength, RECURSE_MODE.RECURSE);
          } else {
            lengthValid = false;
          }
        };

        for (const item of selection.Items()) {
          if (lengthValid) accumulateTrackLength(item);
        }

        if (lengthValid)
          msgItems.push(
            new MSG_PANEL_ITEM('Selected 2D Length', units.MessageTextFromValue(selectedLength)),
          );
      }

      if (selection.GetSize() >= 2 && selection.GetSize() < 100) {
        const enabledLayers = frame.GetBoard()!.GetEnabledLayers();
        const enabledCopper = LSET.AllCuMask(frame.GetBoard()!.GetCopperLayerCount());
        let areaValid = true;
        let hasCopper = false;
        let hasNonCopper = false;

        const layerPolys = new Map<PCB_LAYER_ID, SHAPE_POLY_SET>();
        const holes = new SHAPE_POLY_SET();

        const accumulateArea = (aItem: EDA_ITEM): void => {
          if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T || aItem.Type() === KICAD_T.PCB_MARKER_T) {
            areaValid = false;
            return;
          }

          if (aItem instanceof PCB_GROUP) {
            aItem.RunOnChildren(accumulateArea, RECURSE_MODE.RECURSE);
            return;
          }

          if (aItem instanceof BOARD_ITEM) {
            const boardItem = aItem;
            boardItem.RunOnChildren(accumulateArea, RECURSE_MODE.NO_RECURSE);

            const itemLayers = boardItem.GetLayerSet().and(enabledLayers);

            for (const layer of itemLayers.Seq()) {
              let poly = layerPolys.get(layer);

              if (!poly) {
                poly = new SHAPE_POLY_SET();
                layerPolys.set(layer, poly);
              }

              boardItem.TransformShapeToPolySet(
                poly,
                layer,
                0,
                ARC_LOW_DEF,
                ERROR_LOC.ERROR_INSIDE,
              );

              if (enabledCopper.Contains(layer)) hasCopper = true;
              else hasNonCopper = true;
            }

            if (aItem.Type() === KICAD_T.PCB_PAD_T && (aItem as unknown as PAD).HasHole()) {
              (aItem as unknown as PAD).TransformHoleToPolygon(
                holes,
                0,
                ARC_LOW_DEF,
                ERROR_LOC.ERROR_OUTSIDE,
              );
            } else if (aItem.Type() === KICAD_T.PCB_VIA_T) {
              const via = aItem as unknown as PCB_VIA;
              const center = via.GetPosition();
              const R = Math.trunc(via.GetDrillValue() / 2);

              TransformCircleToPolygon(holes, center, R, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
            }
          }
        };

        for (const item of selection.Items()) {
          if (areaValid) accumulateArea(item);
        }

        if (areaValid) {
          let area = 0.0;

          for (const [layer, layerPoly] of [...layerPolys].sort((x, y) => x[0] - y[0])) {
            // Only subtract holes from copper layers
            if (enabledCopper.Contains(layer)) layerPoly.BooleanSubtract(holes);

            area += layerPoly.Area();
          }

          // Choose appropriate label based on what layers are involved
          let areaLabel: string;

          if (hasCopper && !hasNonCopper) areaLabel = 'Selected 2D Copper Area';
          else if (!hasCopper && hasNonCopper) areaLabel = 'Selected 2D Area';
          else areaLabel = 'Selected 2D Total Area';

          msgItems.push(
            new MSG_PANEL_ITEM(areaLabel, units.MessageTextFromValue(area, true, 'area')),
          );
        }
      }
    } else {
      frame.GetBoard()!.GetMsgPanelInfo(frame.AsDrawFrameLike(), msgItems);
    }

    frame.SetMsgPanel(msgItems);

    // Update vertex editor if it exists
    if (frame.IsType(FRAME_T.FRAME_PCB_EDITOR) || frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR)) {
      const editFrame = frame as unknown as PCB_BASE_EDIT_FRAME;
      const selectedItem =
        selection.GetSize() === 1 && selection.Front()! instanceof BOARD_ITEM
          ? (selection.Front() as BOARD_ITEM)
          : null;
      editFrame.UpdateVertexEditorSelection(selectedItem);
    }

    return 0;
  }

  /** `FlipPcbView` (pcb_control.cpp:2946-2953). */
  FlipPcbView(_aEvent: TOOL_EVENT): number {
    const opts = Object.assign(new PCB_DISPLAY_OPTIONS(), this.m_frame!.GetDisplayOptions());
    opts.m_FlipBoardView = !opts.m_FlipBoardView;
    this.m_frame!.SetDisplayOptions(opts);

    return 0;
  }

  /** `rehatchBoardItem( aView, aItem )` (pcb_control.cpp:2956-2971). */
  static rehatchBoardItem(aView: VIEW | null, aItem: BOARD_ITEM): void {
    if (aItem.Type() !== KICAD_T.PCB_SHAPE_T) return;

    const shape = aItem as PCB_SHAPE;

    // Re-caching every non-hatched shape on each edit stalls commits on dense boards.
    if (!shape.IsHatchedFill()) return;

    shape.UpdateHatching();

    if (aView) aView.Update(aItem);
  }

  /** `RehatchShapes` (pcb_control.cpp:2974-2985). */
  RehatchShapes(_aEvent: TOOL_EVENT): number {
    const view = this.view();

    for (const footprint of this.board().Footprints())
      footprint.RunOnChildren(
        (aItem) => PCB_CONTROL.rehatchBoardItem(view, aItem),
        RECURSE_MODE.NO_RECURSE,
      );

    for (const item of this.board().Drawings()) PCB_CONTROL.rehatchBoardItem(view, item);

    return 0;
  }

  /**
   * `SaveFpToBoard` (pcb_control.cpp:172-180): the footprint editor's
   * `SaveFootprintToBoard( true )`, or the library browser's
   * `AddFootprintToPCB()`.
   *
   * Not ported: the footprint editor's `SaveFootprintToBoard`. Nothing here
   * loads a footprint off a board into the editor, so there is no board copy
   * to update.
   */
  SaveFpToBoard(_aEvent: TOOL_EVENT): number {
    if (this.m_frame!.IsType(FRAME_T.FRAME_FOOTPRINT_VIEWER))
      (this.m_frame as unknown as FOOTPRINT_VIEWER_FRAME).AddFootprintToPCB();

    return 0;
  }

  /** `IterateFootprint` (pcb_control.cpp:201-207). */
  IterateFootprint(aEvent: TOOL_EVENT): number {
    if (this.m_frame!.IsType(FRAME_T.FRAME_FOOTPRINT_VIEWER))
      (this.m_frame as unknown as FOOTPRINT_VIEWER_FRAME).SelectAndViewFootprint(
        aEvent.Parameter<FPVIEWER_CONSTANTS>(),
      );

    return 0;
  }

  /** `PCB_CONTROL::Print` (dialog_print_pcbnew.cpp:463-483). */
  Print(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame as unknown as PCB_BASE_EDIT_FRAME & Partial<PRINT_FRAME_HOST>;

    if (!frame.ShowPrintDialog) return 0;

    void PCB_CONTROL_Print(frame as PCB_BASE_EDIT_FRAME & PRINT_FRAME_HOST, this.m_toolMgr!);

    return 0;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.Print), ACTIONS.print.MakeEvent());

    // Footprint library actions
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.SaveFpToBoard), PCB_ACTIONS.saveFpToBoard.MakeEvent());
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.IterateFootprint),
      PCB_ACTIONS.nextFootprint.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.IterateFootprint),
      PCB_ACTIONS.previousFootprint.MakeEvent(),
    );

    // Display modes
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.TrackDisplayMode),
      PCB_ACTIONS.trackDisplayMode.MakeEvent(),
    );
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.ToggleRatsnest), PCB_ACTIONS.showRatsnest.MakeEvent());
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.ToggleRatsnest),
      PCB_ACTIONS.ratsnestLineMode.MakeEvent(),
    );
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.ViaDisplayMode), PCB_ACTIONS.viaDisplayMode.MakeEvent());
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.ZoneDisplayMode),
      PCB_ACTIONS.zoneDisplayFilled.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.ZoneDisplayMode),
      PCB_ACTIONS.zoneDisplayOutline.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.ZoneDisplayMode),
      PCB_ACTIONS.zoneDisplayFractured.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.ZoneDisplayMode),
      PCB_ACTIONS.zoneDisplayTriangulated.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.ZoneDisplayMode),
      PCB_ACTIONS.zoneDisplayToggle.MakeEvent(),
    );
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.HighContrastMode), ACTIONS.highContrastMode.MakeEvent());
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.HighContrastModeCycle),
      ACTIONS.highContrastModeCycle.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.ContrastModeFeedback),
      EVENTS.ContrastModeChangedByKeyEvent,
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.NetColorModeCycle),
      PCB_ACTIONS.netColorModeCycle.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.RatsnestModeCycle),
      PCB_ACTIONS.ratsnestModeCycle.MakeEvent(),
    );
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.FlipPcbView), PCB_ACTIONS.flipBoard.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.RehatchShapes), PCB_ACTIONS.rehatchShapes.MakeEvent());

    // Layer control
    for (const action of [
      PCB_ACTIONS.layerTop,
      PCB_ACTIONS.layerInner1,
      PCB_ACTIONS.layerInner2,
      PCB_ACTIONS.layerInner3,
      PCB_ACTIONS.layerInner4,
      PCB_ACTIONS.layerInner5,
      PCB_ACTIONS.layerInner6,
      PCB_ACTIONS.layerInner7,
      PCB_ACTIONS.layerInner8,
      PCB_ACTIONS.layerInner9,
      PCB_ACTIONS.layerInner10,
      PCB_ACTIONS.layerInner11,
      PCB_ACTIONS.layerInner12,
      PCB_ACTIONS.layerInner13,
      PCB_ACTIONS.layerInner14,
      PCB_ACTIONS.layerInner15,
      PCB_ACTIONS.layerInner16,
      PCB_ACTIONS.layerInner17,
      PCB_ACTIONS.layerInner18,
      PCB_ACTIONS.layerInner19,
      PCB_ACTIONS.layerInner20,
      PCB_ACTIONS.layerInner21,
      PCB_ACTIONS.layerInner22,
      PCB_ACTIONS.layerInner23,
      PCB_ACTIONS.layerInner24,
      PCB_ACTIONS.layerInner25,
      PCB_ACTIONS.layerInner26,
      PCB_ACTIONS.layerInner27,
      PCB_ACTIONS.layerInner28,
      PCB_ACTIONS.layerInner29,
      PCB_ACTIONS.layerInner30,
      PCB_ACTIONS.layerBottom,
    ])
      this.Go(SYNC_HANDLER<PCB_CONTROL>(this.LayerSwitch), action.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.LayerNext), PCB_ACTIONS.layerNext.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.LayerPrev), PCB_ACTIONS.layerPrev.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.LayerToggle), PCB_ACTIONS.layerToggle.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.LayerAlphaInc), PCB_ACTIONS.layerAlphaInc.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.LayerAlphaDec), PCB_ACTIONS.layerAlphaDec.MakeEvent());

    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.CycleLayerPresets),
      PCB_ACTIONS.layerPairPresetsCycle.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.LayerPresetFeedback),
      PCB_EVENTS.LayerPairPresetChangedByKeyEvent(),
    );

    for (const event of [
      EVENTS.PointSelectedEvent,
      EVENTS.SelectedEvent,
      EVENTS.UnselectedEvent,
      EVENTS.ClearedEvent,
      EVENTS.SelectedItemsModified,
      EVENTS.ConnectivityChangedEvent,
    ])
      this.Go(SYNC_HANDLER<PCB_CONTROL>(this.UpdateMessagePanel), event);

    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.Undo), ACTIONS.undo.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.Redo), ACTIONS.redo.MakeEvent());

    // Snapping control
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.SnapMode),
      PCB_ACTIONS.magneticSnapActiveLayer.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.SnapMode),
      PCB_ACTIONS.magneticSnapAllLayers.MakeEvent(),
    );
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.SnapMode), PCB_ACTIONS.magneticSnapToggle.MakeEvent());
    this.Go(
      SYNC_HANDLER<PCB_CONTROL>(this.SnapModeFeedback),
      PCB_EVENTS.SnappingModeChangedByKeyEvent(),
    );

    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.GridPlaceOrigin), ACTIONS.gridSetOrigin.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.GridResetOrigin), ACTIONS.gridResetOrigin.MakeEvent());
    this.Go(SYNC_HANDLER<PCB_CONTROL>(this.InteractiveDelete), ACTIONS.deleteTool.MakeEvent());
    this.Go(this.PlaceCharacteristics, PCB_ACTIONS.placeCharacteristics.MakeEvent());
    this.Go(this.PlaceStackup, PCB_ACTIONS.placeStackup.MakeEvent());
    this.Go(this.Paste, ACTIONS.paste.MakeEvent());
    this.Go(this.Paste, ACTIONS.pasteSpecial.MakeEvent());
  }
}
