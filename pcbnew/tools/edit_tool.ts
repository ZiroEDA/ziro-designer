// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDIT_TOOL` (pcbnew/tools/edit_tool.h, edit_tool.cpp): the interactive edit
 * tool - move, rotate, flip, mirror, delete, duplicate, properties and the
 * shape and track modifications of the items the selection tool selected, on
 * the live BOARD, through BOARD_COMMIT.
 *
 * KiCad splits the class across edit_tool.cpp and edit_tool_move_fct.cpp; the
 * second file's methods (Swap, SwapPadNets, SwapGateNets,
 * PackAndMoveFootprints, Move, getSafeMovement, doMoveSelection) are in
 * edit_tool_move_fct.ts, mixed into this class as `pcb_edit_frame.ts` mixes
 * its method files.
 *
 * What the tool asks the window for - its modal dialogs, the infobar, the
 * vertex editor - is the frame's, through EDIT_TOOL_FRAME (the frame's hooks).
 *
 * TRANSITIONAL (#636 stage 3): ROUTER_TOOL is not ported. A router drag
 * (`invokeInlineRouter`, `Drag`) asks WINDOW_ACTION_BRIDGE for the router's
 * state and runs `PCB_ACTIONS::routerInlineDrag`, which the bridge hands to
 * the window's router drag.
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { SaveClipboard } from '@ziroeda/common/clipboard.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_NEW, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T as GR_TEXT_H_ALIGN } from '@ziroeda/common/font/text_attributes.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { STRING_INCREMENTER } from '@ziroeda/common/increment.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { LAYER_DRAWINGSHEET, type PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS, EVENTS, type INCREMENT, REMOVE_FLAGS } from '@ziroeda/common/tool/actions.js';
import { ACTION_CONDITIONS } from '@ziroeda/common/tool/action_manager.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import { SELECTION as SELECTION_CLASS } from '@ziroeda/common/tool/selection.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_ACTION_SCOPE, TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { wxMenuEvent } from '@ziroeda/common/wx/menu.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FLIP_DIRECTION, MIRROR } from '@ziroeda/kimath/src/core/mirror.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../board.js';
import { APPEND_UNDO, BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { GENERAL_COLLECTOR } from '../collectors.js';
import { GENERAL_COLLECTOR as GENERAL_COLLECTOR_CLASS } from '../collectors.js';
import type { FOOTPRINT } from '../footprint.js';
import { CLIPBOARD_IO } from '../kicad_clipboard.js';
import type { PAD } from '../pad.js';
import { PADSTACK, PAD_SHAPE } from '../padstack.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_FIELD } from '../pcb_field.js';
import type { PCB_GENERATOR } from '../pcb_generator.js';
import type { PCB_GROUP } from '../pcb_group.js';
import { PCB_SHAPE as PCB_SHAPE_CTOR, type PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { PCB_TABLECELL } from '../pcb_tablecell.js';
import type { PCB_TEXT } from '../pcb_text.js';
import type { PCB_TEXTBOX } from '../pcb_textbox.js';
import { PCB_ARC, type PCB_TRACK, type PCB_VIA } from '../pcb_track.js';
import { VIATYPE } from '../pcb_track_types.js';
import type { ZONE } from '../zone.js';
import { ConnectBoardShapes } from '../fix_board_shape.js';
import {
  CALLABLE_BASED_HANDLER,
  type CHAMFER_PARAMS,
  DOGBONE_CORNER_ROUTINE,
  type DOGBONE_PARAMETERS,
  LINE_CHAMFER_ROUTINE,
  LINE_EXTENSION_ROUTINE,
  LINE_FILLET_ROUTINE,
  type PAIRWISE_LINE_ROUTINE,
  POLYGON_INTERSECT_ROUTINE,
  POLYGON_MERGE_ROUTINE,
  POLYGON_SUBTRACT_ROUTINE,
  type POLYGON_BOOLEAN_ROUTINE,
} from './item_modification_routine.js';
import { PCB_ACTIONS, PCB_EVENTS } from './pcb_actions.js';
import { PCB_GRID_HELPER } from './pcb_grid_helper.js';
import { type PCB_PICKER_TOOL, popupFocus } from './pcb_picker_tool.js';
import { PCB_POINT_EDITOR } from './pcb_point_editor.js';
import type { PCB_SELECTION } from './pcb_selection.js';
import type { CLIENT_SELECTION_FILTER, PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { EDIT_TOOL_MOVE_FCT } from './edit_tool_move_fct.js';
import { applyMixins } from '@ziroeda/core/mixins.js';

/** `ID_END_LIST` (common/id.h), where `pcbnew_ids` starts. */
const ID_END_LIST = 10557;
/**
 * `ID_POPUP_PCB_SWAP_UNIT_BASE` and `_LAST` (pcbnew_id.h): the 40th entry of
 * `pcbnew_ids`, which starts at ID_END_LIST, and 63 after it.
 */
export const ID_POPUP_PCB_SWAP_UNIT_BASE = ID_END_LIST + 39;
export const ID_POPUP_PCB_SWAP_UNIT_LAST = ID_POPUP_PCB_SWAP_UNIT_BASE + 63;

/** `ROTATION_ANCHOR` (dialogs/dialog_move_exact.h). */
export enum ROTATION_ANCHOR {
  ROTATE_AROUND_ITEM_ANCHOR,
  ROTATE_AROUND_SEL_CENTER,
  ROTATE_AROUND_USER_ORIGIN,
  ROTATE_AROUND_AUX_ORIGIN,
}

/** What `DIALOG_MOVE_EXACT` edits in place: the translation, the rotation and its anchor. */
export interface MOVE_EXACT_VALUES {
  translation: VECTOR2I;
  rotation: EDA_ANGLE;
  rotationAnchor: ROTATION_ANCHOR;
}

/**
 * The window half of the tool: the modal dialogs `EDIT_TOOL` shows and the
 * infobar, answered by the frame's hooks. Each dialog answers a promise; a
 * cancelled dialog answers null.
 */
export interface EDIT_TOOL_FRAME {
  /** `WX_UNIT_ENTRY_DIALOG( frame, aTitle, aLabel, aValue ).ShowModal()`: the value, or null on cancel. */
  ShowUnitEntryDialog(aTitle: string, aLabel: string, aValue: number): Promise<number | null>;
  /** `GetDogboneParams`' WX_MULTI_ENTRY_DIALOG, "Dogbone Corner Settings". */
  ShowDogboneDialog(aParams: DOGBONE_PARAMETERS): Promise<DOGBONE_PARAMETERS | null>;
  /** `DIALOG_MOVE_EXACT( frame, translation, rotation, rotationAnchor, sel_box ).ShowModal()`. */
  ShowMoveExactDialog(
    aValues: MOVE_EXACT_VALUES,
    aSelectionBox: BOX2I,
  ): Promise<MOVE_EXACT_VALUES | null>;
  /** `DIALOG_TRACK_VIA_PROPERTIES( frame, selection ).ShowQuasiModal()`. */
  ShowTrackViaPropertiesDialog(aSelection: PCB_SELECTION): Promise<void>;
  /**
   * `DIALOG_TABLECELL_PROPERTIES( frame, cells ).ShowQuasiModal()`: true when it
   * returned TABLECELL_PROPS_EDIT_TABLE.
   */
  ShowTableCellPropertiesDialog(aCells: PCB_TABLECELL[]): Promise<boolean>;
  /** `DIALOG_TABLE_PROPERTIES( frame, table ).ShowQuasiModal() == wxID_OK`. */
  ShowTablePropertiesDialog(aTable: PCB_TABLE): Promise<boolean>;
  /** `DIALOG_GET_FOOTPRINT_BY_NAME( frame, fplist ).ShowModal()`: the value, or null. */
  ShowGetFootprintByNameDialog(aList: string[]): Promise<string | null>;
  /**
   * `PromptConnectedPadDecision`'s wxRichMessageDialog: "Ignore Unselected Pads"
   * (wxID_YES) answers 'ignore', "Swap All Connected Pads" (wxID_NO) 'all',
   * Cancel null.
   */
  ShowConnectedPadDialog(
    aTitle: string,
    aMessage: string,
    aDetails: string,
  ): Promise<'ignore' | 'all' | null>;
  /** `PCB_BASE_EDIT_FRAME::OpenVertexEditor( aItem )`. */
  OpenVertexEditor(aItem: BOARD_ITEM): void;
  /** `EDA_BASE_FRAME::ShowInfoBarMsg( aMsg )`. */
  ShowInfoBarMsg(aMsg: string): void;
  /** `EDA_BASE_FRAME::ShowInfoBarError( aMsg )`. */
  ShowInfoBarError(aMsg: string, aShowCloseButton?: boolean): void;
}

/**
 * TRANSITIONAL (#636 stage 3): what EDIT_TOOL asks of ROUTER_TOOL -
 * `IsToolActive()`, `RoutingInProgress()`, `CanInlineDrag( aDragMode )` - while
 * the router is the window's. WINDOW_ACTION_BRIDGE answers it.
 */
export interface ROUTER_TOOL_LIKE {
  IsToolActive(): boolean;
  RoutingInProgress(): boolean;
  CanInlineDrag(aDragMode: number): boolean;
}

/** `PNS::DRAG_MODE` (router/pns_router.h). */
export enum PNS_DRAG_MODE {
  DM_CORNER = 0x1,
  DM_SEGMENT = 0x2,
  DM_VIA = 0x4,
  DM_FREE_ANGLE = 0x8,
  DM_ARC = 0x10,
  DM_ANY = 0x17,
  DM_COMPONENT = 0x20,
}

/** `EDIT_TOOL::COORDS_PADDING` (edit_tool.cpp:83): padding from coordinates limits. */
export const COORDS_PADDING = pcbIUScale.mmToIU(20);

/** `std::numeric_limits<int>::max()`. */
const INT_MAX = 2147483647;

function itemHasEditableCorners(aItem: BOARD_ITEM | null): boolean {
  if (!aItem) return false;

  if (aItem.Type() === KICAD_T.PCB_SHAPE_T) {
    const shape = aItem as PCB_SHAPE;
    return shape.GetShape() === SHAPE_T.POLY;
  }

  if (aItem.Type() === KICAD_T.PCB_ZONE_T) {
    const zone = aItem as ZONE;

    if (zone.IsTeardropArea()) return false;

    return true;
  }

  return false;
}

function selectionHasEditableCorners(aSelection: SELECTION): boolean {
  if (aSelection.GetSize() !== 1) return false;

  const front = aSelection.Front();
  const item = front && front.IsBOARD_ITEM() ? (front as unknown as BOARD_ITEM) : null;
  return itemHasEditableCorners(item);
}

const padTypes = [KICAD_T.PCB_PAD_T];

const footprintTypes = [KICAD_T.PCB_FOOTPRINT_T];

const trackTypes = [KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T, KICAD_T.PCB_VIA_T];

const baseConnectedTypes = [
  KICAD_T.PCB_PAD_T,
  KICAD_T.PCB_VIA_T,
  KICAD_T.PCB_TRACE_T,
  KICAD_T.PCB_ARC_T,
];

const connectedTypes = [
  KICAD_T.PCB_TRACE_T,
  KICAD_T.PCB_ARC_T,
  KICAD_T.PCB_VIA_T,
  KICAD_T.PCB_PAD_T,
  KICAD_T.PCB_ZONE_T,
];

const routableTypes = [
  KICAD_T.PCB_TRACE_T,
  KICAD_T.PCB_ARC_T,
  KICAD_T.PCB_VIA_T,
  KICAD_T.PCB_PAD_T,
  KICAD_T.PCB_FOOTPRINT_T,
];

// Types with no Mirror() override, which would fall through to the warning-dialog
// BOARD_ITEM::Mirror. Free pads are handled specially by the tool but not by PCB_GROUP::Mirror.
const nonMirrorableTypes = [
  KICAD_T.PCB_FOOTPRINT_T,
  KICAD_T.PCB_PAD_T,
  KICAD_T.PCB_TARGET_T,
  KICAD_T.PCB_REFERENCE_IMAGE_T,
];

// A group is mirrorable only if none of its members hit BOARD_ITEM::Mirror.
function groupMirrorable(aGroup: PCB_GROUP): boolean {
  let ok = true;

  aGroup.RunOnChildren((aChild: BOARD_ITEM) => {
    if (aChild.IsType(nonMirrorableTypes)) ok = false;
  }, RECURSE_MODE.RECURSE);

  return ok;
}

// True if at least one selected item can be mirrored. A group counts only if all its members can.
function selectionMirrorable(aSelection: SELECTION): boolean {
  for (const item of aSelection) {
    if (item.Type() === KICAD_T.PCB_GROUP_T) {
      if (groupMirrorable(item as unknown as PCB_GROUP)) return true;
    } else if (item.IsType(EDIT_TOOL.MirrorableItems)) {
      return true;
    }
  }

  return false;
}

/** `notMovingCondition`: nothing selected, or the selection not in flight. */
const notMovingCondition = (aSelection: SELECTION): boolean =>
  aSelection.Empty() || !aSelection.Front()!.IsMoving();

function makePositioningToolsMenu(aTool: EDIT_TOOL): CONDITIONAL_MENU {
  const menu = new CONDITIONAL_MENU(aTool);

  menu.SetIcon('special_tools' as never);
  menu.SetUntranslatedTitle('Position');

  const cond = SELECTION_CONDITIONS.And(SELECTION_CONDITIONS.NotEmpty, notMovingCondition);

  menu.AddItem(PCB_ACTIONS.moveExact, cond);
  menu.AddItem(PCB_ACTIONS.positionRelative, cond);
  menu.AddItem(PCB_ACTIONS.interactiveOffsetTool, cond);
  return menu;
}

function makeShapeModificationMenu(aTool: EDIT_TOOL): CONDITIONAL_MENU {
  const menu = new CONDITIONAL_MENU(aTool);

  menu.SetUntranslatedTitle('Shape Modification');

  const filletChamferTypes = [
    KICAD_T.PCB_SHAPE_LOCATE_POLY_T,
    KICAD_T.PCB_SHAPE_LOCATE_RECT_T,
    KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T,
  ];

  const healShapesTypes = [
    KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T,
    KICAD_T.PCB_SHAPE_LOCATE_ARC_T,
    KICAD_T.PCB_SHAPE_LOCATE_BEZIER_T,
  ];

  const lineExtendTypes = [KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T];

  const polygonBooleanTypes = [
    KICAD_T.PCB_SHAPE_LOCATE_RECT_T,
    KICAD_T.PCB_SHAPE_LOCATE_POLY_T,
    KICAD_T.PCB_SHAPE_LOCATE_CIRCLE_T,
  ];

  const polygonSimplifyTypes = [KICAD_T.PCB_SHAPE_LOCATE_POLY_T, KICAD_T.PCB_ZONE_T];

  const ptTool = (): PCB_POINT_EDITOR | null =>
    aTool.GetManager()?.GetTool(PCB_POINT_EDITOR) ?? null;

  const hasCornerCondition = (_aSelection: SELECTION): boolean => {
    const pt_tool = ptTool();
    return !!pt_tool && pt_tool.HasCorner();
  };

  const hasMidpointCondition = (_aSelection: SELECTION): boolean => {
    const pt_tool = ptTool();
    return !!pt_tool && pt_tool.HasMidpoint();
  };

  const canAddCornerCondition = (aSelection: SELECTION): boolean => {
    const item = aSelection.Front();
    return !!item && PCB_POINT_EDITOR.CanAddCorner(item);
  };

  const canChamferCornerCondition = (aSelection: SELECTION): boolean => {
    const item = aSelection.Front();
    return !!item && PCB_POINT_EDITOR.CanChamferCorner(item);
  };

  const canRemoveCornerCondition = (aSelection: SELECTION): boolean => {
    const pt_tool = ptTool();
    return !!pt_tool && pt_tool.CanRemoveCorner(aSelection);
  };

  const { And, OnlyTypes, HasTypes, Count, MoreThan } = SELECTION_CONDITIONS;

  // Shape cleanup
  menu.AddItem(PCB_ACTIONS.healShapes, HasTypes(healShapesTypes));
  menu.AddItem(PCB_ACTIONS.simplifyPolygons, HasTypes(polygonSimplifyTypes));

  menu.AddSeparator(OnlyTypes(filletChamferTypes));

  // Shape corner modifications
  menu.AddItem(PCB_ACTIONS.filletLines, OnlyTypes(filletChamferTypes));
  menu.AddItem(PCB_ACTIONS.chamferLines, OnlyTypes(filletChamferTypes));
  menu.AddItem(PCB_ACTIONS.dogboneCorners, OnlyTypes(filletChamferTypes));
  menu.AddItem(PCB_ACTIONS.extendLines, And(OnlyTypes(lineExtendTypes), Count(2)));

  menu.AddSeparator(Count(1));

  // Point editor corner operations
  menu.AddItem(PCB_ACTIONS.pointEditorMoveCorner, hasCornerCondition);
  menu.AddItem(PCB_ACTIONS.pointEditorMoveMidpoint, hasMidpointCondition);
  menu.AddItem(PCB_ACTIONS.pointEditorAddCorner, And(Count(1), canAddCornerCondition));
  menu.AddItem(PCB_ACTIONS.pointEditorRemoveCorner, And(Count(1), canRemoveCornerCondition));
  menu.AddItem(PCB_ACTIONS.pointEditorChamferCorner, And(Count(1), canChamferCornerCondition));
  menu.AddItem(PCB_ACTIONS.editVertices, selectionHasEditableCorners);

  menu.AddSeparator(And(OnlyTypes(polygonBooleanTypes), MoreThan(1)));

  // Polygon boolean operations
  menu.AddItem(PCB_ACTIONS.mergePolygons, And(OnlyTypes(polygonBooleanTypes), MoreThan(1)));
  menu.AddItem(PCB_ACTIONS.subtractPolygons, And(OnlyTypes(polygonBooleanTypes), MoreThan(1)));
  menu.AddItem(PCB_ACTIONS.intersectPolygons, And(OnlyTypes(polygonBooleanTypes), MoreThan(1)));

  return menu;
}

/** Gate-swap submenu and helpers. */
export class GATE_SWAP_MENU extends ACTION_MENU {
  constructor() {
    super(true);

    this.SetIcon('swap' as never);
    this.SetTitle('Swap Gate Nets...');
  }

  // We're looking for a selection of pad(s) that belong to a single footprint with multiple units.
  // Ignore non-pad items since we might have grabbed some traces inside the pad, etc.
  static GetSingleEligibleFootprint(aSelection: SELECTION): FOOTPRINT | null {
    let single: FOOTPRINT | null = null;

    for (const it of aSelection) {
      if (it.Type() !== KICAD_T.PCB_PAD_T) continue;

      const pad = it as unknown as PAD;
      const fp = pad.GetParentFootprint();

      if (!fp) continue;

      const units = fp.GetUnitInfo();

      if (units.length < 2) continue;

      const padNum = pad.GetNumber();
      let inAnyUnit = false;

      for (const u of units) {
        for (const pnum of u.m_pins) {
          if (pnum === padNum) {
            inAnyUnit = true;
            break;
          }
        }

        if (inAnyUnit) break;
      }

      if (!inAnyUnit) continue;

      if (!single) single = fp;
      else if (single !== fp) return null;
    }

    return single;
  }

  static CollectSelectedPadNumbers(aSelection: SELECTION, aFootprint: FOOTPRINT): Set<string> {
    const padNums = new Set<string>();

    for (const it of aSelection) {
      if (it.Type() !== KICAD_T.PCB_PAD_T) continue;

      const pad = it as unknown as PAD;

      if (pad.GetParentFootprint() !== aFootprint) continue;

      padNums.add(pad.GetNumber());
    }

    return padNums;
  }

  // Make a list of the unit names that have any pad selected
  static GetUnitsHitIndices(aFootprint: FOOTPRINT, aSelPadNums: ReadonlySet<string>): number[] {
    const indices: number[] = [];

    const units = aFootprint.GetUnitInfo();

    for (let i = 0; i < units.length; ++i) {
      let hasAny = false;

      for (const pn of units[i]!.m_pins) {
        if (aSelPadNums.has(pn)) {
          hasAny = true;
          break;
        }
      }

      if (hasAny) indices.push(i);
    }

    return indices;
  }

  // Gate swapping requires the swapped units to have equal pin counts
  static EqualPinCounts(aFootprint: FOOTPRINT, aUnitIndices: readonly number[]): boolean {
    if (aUnitIndices.length === 0) return false;

    const units = aFootprint.GetUnitInfo();
    const cnt = units[aUnitIndices[0]!]!.m_pins.length;

    for (const idx of aUnitIndices) {
      if (units[idx]!.m_pins.length !== cnt) return false;
    }

    return true;
  }

  // Used when we have exactly one source unit selected; find all other units with equal pin counts
  static GetCompatibleTargets(aFootprint: FOOTPRINT, aSourceIdx: number): number[] {
    const targets: number[] = [];

    const units = aFootprint.GetUnitInfo();
    const pinCount = units[aSourceIdx]!.m_pins.length;

    for (let i = 0; i < units.length; ++i) {
      if (i === aSourceIdx) continue;

      if (units[i]!.m_pins.length !== pinCount) continue;

      targets.push(i);
    }

    return targets;
  }

  protected override create(): ACTION_MENU {
    return new GATE_SWAP_MENU();
  }

  private selection(): SELECTION | null {
    const selTool = this.getToolManager()?.FindTool('common.InteractiveSelection') as unknown as {
      GetSelection(): SELECTION;
    } | null;

    return selTool?.GetSelection() ?? null;
  }

  // The gate swap menu dynamically populates itself based on current selection of pads
  // on a single multi-unit footprint.
  //
  // If there is exactly one unit with any pad selected, we build a menu of available swaps
  // with all other units with equal pin counts.
  protected override update(): void {
    this.Clear();

    const sel = this.selection();

    if (!sel) return;

    const fp = GATE_SWAP_MENU.GetSingleEligibleFootprint(sel);

    if (!fp) return;

    const selPadNums = GATE_SWAP_MENU.CollectSelectedPadNumbers(sel, fp);

    const unitsHit = GATE_SWAP_MENU.GetUnitsHitIndices(fp, selPadNums);

    if (unitsHit.length !== 1) return;

    const sourceIdx = unitsHit[0]!;
    const targets = GATE_SWAP_MENU.GetCompatibleTargets(fp, sourceIdx);

    for (const idx of targets) {
      const label = `Swap with ${fp.GetUnitInfo()[idx]!.m_unitName}`;
      this.Append(ID_POPUP_PCB_SWAP_UNIT_BASE + idx, label);
    }
  }

  protected override eventHandler(aEvent: wxMenuEvent): TOOL_EVENT | null {
    const id = aEvent.GetId();

    if (id >= ID_POPUP_PCB_SWAP_UNIT_BASE && id <= ID_POPUP_PCB_SWAP_UNIT_LAST) {
      const sel = this.selection();
      const fp = sel ? GATE_SWAP_MENU.GetSingleEligibleFootprint(sel) : null;

      if (!fp) return null;

      const units = fp.GetUnitInfo();
      const targetIdx = id - ID_POPUP_PCB_SWAP_UNIT_BASE;

      if (targetIdx < 0 || targetIdx >= units.length) return null;

      const evt = PCB_ACTIONS.swapGateNets.MakeEvent();
      evt.SetParameter(units[targetIdx]!.m_unitName);

      return evt;
    }

    return null;
  }
}

function makeGateSwapMenu(aTool: EDIT_TOOL): ACTION_MENU {
  const menu = new GATE_SWAP_MENU();
  menu.SetTool(aTool);
  return menu;
}

/**
 * @return the footprint found by its reference on the current board. The
 *         reference is entered by the user from a dialog (by a wxTextCtlr, or a
 *         list of available references). Resolves null when the dialog is
 *         cancelled or nothing matches.
 */
function GetFootprintFromBoardByReference(
  aFrame: PCB_BASE_EDIT_FRAME & Partial<EDIT_TOOL_FRAME>,
): Promise<FOOTPRINT | null> {
  const footprints = aFrame.GetBoard()!.Footprints();

  // Build list of available fp references, to display them in dialog
  const fplist = footprints.map((fp) => `${fp.GetReference()}    ( ${fp.GetValue()} )`);

  fplist.sort();

  if (!aFrame.ShowGetFootprintByNameDialog) return Promise.resolve(null);

  return aFrame.ShowGetFootprintByNameDialog(fplist).then((aValue) => {
    if (aValue === null) return null; //Aborted by user

    const footprintName = aValue.trim();

    if (footprintName !== '') {
      for (const fp of footprints) {
        if (fp.GetReference().toLowerCase() === footprintName.toLowerCase()) return fp;
      }
    }

    return null;
  });
}

/**
 * The interactive edit tool.
 *
 * Allows one to move, rotate, flip and change properties of items selected using the
 * pcbnew.InteractiveSelection tool.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the edit_tool_move_fct.cpp half, mixed in (libs/core/mixins.ts)
export class EDIT_TOOL extends PCB_TOOL_BASE {
  static readonly MirrorableItems: readonly KICAD_T[] = [
    KICAD_T.PCB_SHAPE_T,
    KICAD_T.PCB_FIELD_T,
    KICAD_T.PCB_TEXT_T,
    KICAD_T.PCB_TEXTBOX_T,
    KICAD_T.PCB_ZONE_T,
    KICAD_T.PCB_PAD_T,
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_ARC_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_GROUP_T,
    KICAD_T.PCB_GENERATOR_T,
    KICAD_T.PCB_POINT_T,
    KICAD_T.PCB_TABLE_T,
  ];

  // The members below are private upstream; edit_tool_move_fct.ts's half of
  // the class reaches them, so they are not marked private here.
  m_selectionTool: PCB_SELECTION_TOOL | null = null;
  /** Indicates objects are currently being dragged. */
  m_dragging = false;
  /** True while doMoveSelection runs a Move with Reference. */
  m_inMoveWithReference = false;
  /**
   * Last cursor position (so getModificationPoint() can avoid changes of edit
   * reference point).
   */
  m_cursor: VECTOR2I = { x: 0, y: 0 };
  m_statusPopup: STATUS_TEXT_POPUP | null = null;

  /** `static int filletRadius` in FilletTracks. */
  private static s_filletTracksRadius = 0;
  /** `static int s_filletRadius` in ModifyLines. */
  private static s_filletLinesRadius = pcbIUScale.mmToIU(1);
  /** `GetDogboneParams`' persistent `s_dogBoneParams`. */
  private static s_dogBoneParams: DOGBONE_PARAMETERS = {
    DogboneRadiusIU: pcbIUScale.mmToIU(1),
    AddSlots: true,
  };
  /** `GetChamferParams`' persistent `params`: non-zero and the KLC default for Fab layer chamfers. */
  private static s_chamferParams: CHAMFER_PARAMS = {
    m_chamfer_setback_a: pcbIUScale.mmToIU(1),
    m_chamfer_setback_b: pcbIUScale.mmToIU(1),
  };
  /** `SimplifyPolygons`' `s_toleranceValue`. */
  private static s_simplifyTolerance = pcbIUScale.mmToIU(3);
  /** `HealShapes`' `s_toleranceValue`. */
  private static s_healTolerance = pcbIUScale.mmToIU(3);

  constructor() {
    super('pcbnew.InteractiveEdit');
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  override Reset(_aReason: RESET_REASON): void {
    this.m_dragging = false;
    this.m_inMoveWithReference = false;

    this.m_statusPopup = new STATUS_TEXT_POPUP();
  }

  /** `m_toolMgr->GetTool<PCB_SELECTION_TOOL>()`, by name: the class imports this module's siblings. */
  selTool(): PCB_SELECTION_TOOL {
    return this.m_selectionTool!;
  }

  /** The frame, with the window half of the tool. */
  editFrame(): PCB_BASE_EDIT_FRAME & Partial<EDIT_TOOL_FRAME> {
    return this.getEditFrame<PCB_BASE_EDIT_FRAME>() as PCB_BASE_EDIT_FRAME &
      Partial<EDIT_TOOL_FRAME>;
  }

  /** `getViewControls()` as the VIEW_CONTROLS it is. */
  controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /** `frame()->ShowInfoBarMsg( aMsg )`. */
  showInfoBarMsg(aMsg: string): void {
    this.editFrame().ShowInfoBarMsg?.(aMsg);
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    // Find the selection tool, so they can cooperate
    this.m_selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;

    const positioningToolsSubMenu = makePositioningToolsMenu(this);
    this.m_selectionTool.GetToolMenu().RegisterSubMenu(positioningToolsSubMenu);

    const shapeModificationSubMenu = makeShapeModificationMenu(this);
    this.m_selectionTool.GetToolMenu().RegisterSubMenu(shapeModificationSubMenu);

    const gateSwapSubMenu = makeGateSwapMenu(this);
    this.m_selectionTool.GetToolMenu().RegisterSubMenu(gateSwapSubMenu);

    const fpAttributesMenu = new CONDITIONAL_MENU(this);
    fpAttributesMenu.SetUntranslatedTitle('Attributes');
    fpAttributesMenu.AddCheckItem(
      PCB_ACTIONS.toggleExcludeFromBOM,
      SELECTION_CONDITIONS.ShowAlways,
    );
    fpAttributesMenu.AddCheckItem(
      PCB_ACTIONS.toggleExcludeFromPosFiles,
      SELECTION_CONDITIONS.ShowAlways,
    );
    this.m_selectionTool.GetToolMenu().RegisterSubMenu(fpAttributesMenu);

    const positioningToolsCondition = (aSel: SELECTION): boolean => {
      const subMenu = makePositioningToolsMenu(this);
      subMenu.Evaluate(aSel);
      return subMenu.GetMenuItemCount() > 0;
    };

    const shapeModificationCondition = (aSel: SELECTION): boolean => {
      const subMenu = makeShapeModificationMenu(this);
      subMenu.Evaluate(aSel);
      return subMenu.GetMenuItemCount() > 0;
    };

    // Does selection map to a single eligible footprint and exactly one unit?
    const gateSwapSingleUnitOnOneFootprint = (aSelection: SELECTION): boolean => {
      const fp = GATE_SWAP_MENU.GetSingleEligibleFootprint(aSelection);

      if (!fp) return false;

      const selPadNums = GATE_SWAP_MENU.CollectSelectedPadNumbers(aSelection, fp);

      const unitsHit = GATE_SWAP_MENU.GetUnitsHitIndices(fp, selPadNums);

      if (unitsHit.length !== 1) return false;

      const sourceIdx = unitsHit[0]!;
      const targets = GATE_SWAP_MENU.GetCompatibleTargets(fp, sourceIdx);
      return targets.length > 0;
    };

    // Does selection map to a single eligible footprint and more than one unit with equal pin counts?
    const gateSwapMultipleUnitsOnOneFootprint = (aSelection: SELECTION): boolean => {
      const fp = GATE_SWAP_MENU.GetSingleEligibleFootprint(aSelection);

      if (!fp) return false;

      const selPadNums = GATE_SWAP_MENU.CollectSelectedPadNumbers(aSelection, fp);

      const unitsHit = GATE_SWAP_MENU.GetUnitsHitIndices(fp, selPadNums);

      if (unitsHit.length < 2) return false;

      return GATE_SWAP_MENU.EqualPinCounts(fp, unitsHit);
    };

    const propertiesCondition = (aSel: SELECTION): boolean => {
      if (aSel.GetSize() === 0) {
        if (this.getView()!.IsLayerVisible(LAYER_DRAWINGSHEET)) {
          const ds = this.canvas()?.GetDrawingSheet() ?? null;
          const cursor = this.controls().GetCursorPosition(false);

          if (ds?.HitTestDrawingSheetItems(this.getView()!, cursor)) return true;
        }

        return false;
      }

      if (aSel.GetSize() === 1) return true;

      for (const item of aSel) {
        if (!item.IsType(trackTypes)) return false;
      }

      return true;
    };

    const inFootprintEditor = (_aSelection: SELECTION): boolean => this.m_isFootprintEditor;

    const canMirror = (aSelection: SELECTION): boolean => {
      if (!this.m_isFootprintEditor && SELECTION_CONDITIONS.OnlyTypes(padTypes)(aSelection))
        return false;

      return selectionMirrorable(aSelection);
    };

    const { And, Or, Not, NotEmpty, MoreThan, Count, OnlyTypes, HasTypes, HasType } =
      SELECTION_CONDITIONS;

    const singleFootprintCondition = And(OnlyTypes(footprintTypes), Count(1));

    const multipleFootprintsCondition = (aSelection: SELECTION): boolean => {
      let foundFirst = false;

      for (const item of aSelection) {
        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
          if (foundFirst) return true;
          else foundFirst = true;
        }
      }

      return false;
    };

    const excludeFromBOMCond = (aSel: SELECTION): boolean => {
      let variantName = '';
      let checked = 0;
      let unchecked = 0;
      const board = this.frame().GetBoard();

      if (board) variantName = board.GetCurrentVariant();

      for (const item of aSel) {
        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
          if ((item as unknown as FOOTPRINT).GetExcludedFromBOMForVariant(variantName)) checked++;
          else unchecked++;
        }
      }

      return checked > 0 && unchecked === 0;
    };

    const excludeFromPosFilesCond = (aSel: SELECTION): boolean => {
      let variantName = '';
      let checked = 0;
      let unchecked = 0;
      const board = this.frame().GetBoard();

      if (board) variantName = board.GetCurrentVariant();

      for (const item of aSel) {
        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
          if ((item as unknown as FOOTPRINT).GetExcludedFromPosFilesForVariant(variantName))
            checked++;
          else unchecked++;
        }
      }

      return checked > 0 && unchecked === 0;
    };

    const noActiveToolCondition = (_aSelection: SELECTION): boolean =>
      this.frame().ToolStackIsEmpty();

    const noItemsCondition = (_aSelections: SELECTION): boolean => {
      const board = this.frame().GetBoard();
      return !!board && !board.IsEmpty();
    };

    const isSkippable = (_aSelection: SELECTION): boolean =>
      this.frame().IsCurrentTool(PCB_ACTIONS.moveIndividually);

    const isRoutable: SELECTION_CONDITION = And(
      And(And(NotEmpty, HasTypes(routableTypes)), notMovingCondition),
      Not(inFootprintEditor),
    );

    const canCopyAsText = And(
      NotEmpty,
      OnlyTypes([
        KICAD_T.PCB_FIELD_T,
        KICAD_T.PCB_TEXT_T,
        KICAD_T.PCB_TEXTBOX_T,
        KICAD_T.PCB_DIM_ALIGNED_T,
        KICAD_T.PCB_DIM_LEADER_T,
        KICAD_T.PCB_DIM_CENTER_T,
        KICAD_T.PCB_DIM_RADIAL_T,
        KICAD_T.PCB_DIM_ORTHOGONAL_T,
        KICAD_T.PCB_TABLE_T,
        KICAD_T.PCB_TABLECELL_T,
      ]),
    );

    // Add context menu entries that are displayed when selection tool is active
    const menu = this.m_selectionTool.GetToolMenu().GetMenu();
    const notEmptyNotMoving = And(NotEmpty, notMovingCondition);

    menu.AddItem(PCB_ACTIONS.move, notEmptyNotMoving);
    menu.AddItem(PCB_ACTIONS.moveWithReference, notEmptyNotMoving);
    menu.AddItem(PCB_ACTIONS.moveIndividually, And(MoreThan(1), notMovingCondition));

    menu.AddItem(PCB_ACTIONS.routerRouteSelected, isRoutable);
    menu.AddItem(PCB_ACTIONS.routerRouteSelectedFromEnd, isRoutable);
    menu.AddItem(PCB_ACTIONS.unrouteSelected, isRoutable);
    menu.AddItem(PCB_ACTIONS.unrouteSegment, isRoutable);
    menu.AddItem(PCB_ACTIONS.routerAutorouteSelected, isRoutable);

    menu.AddItem(PCB_ACTIONS.skip, isSkippable);
    menu.AddItem(PCB_ACTIONS.breakTrack, And(Count(1), OnlyTypes(trackTypes)));
    menu.AddItem(
      PCB_ACTIONS.drag45Degree,
      And(Count(1), OnlyTypes(GENERAL_COLLECTOR_CLASS.DraggableItems)),
    );
    menu.AddItem(
      PCB_ACTIONS.dragFreeAngle,
      And(
        And(Count(1), OnlyTypes(GENERAL_COLLECTOR_CLASS.DraggableItems)),
        Not(OnlyTypes(footprintTypes)),
      ),
    );
    menu.AddItem(PCB_ACTIONS.filletTracks, OnlyTypes(trackTypes));

    menu.AddItem(PCB_ACTIONS.rotateCcw, NotEmpty);
    menu.AddItem(PCB_ACTIONS.rotateCw, NotEmpty);
    menu.AddItem(PCB_ACTIONS.flip, NotEmpty);
    menu.AddItem(PCB_ACTIONS.mirrorH, canMirror);
    menu.AddItem(PCB_ACTIONS.mirrorV, canMirror);
    menu.AddItem(PCB_ACTIONS.swap, MoreThan(1));
    menu.AddItem(PCB_ACTIONS.swapPadNets, And(MoreThan(1), OnlyTypes(padTypes)));
    menu.AddItem(PCB_ACTIONS.swapGateNets, gateSwapMultipleUnitsOnOneFootprint);
    menu.AddMenu(gateSwapSubMenu, gateSwapSingleUnitOnOneFootprint);
    menu.AddItem(
      PCB_ACTIONS.packAndMoveFootprints,
      And(MoreThan(1), HasType(KICAD_T.PCB_FOOTPRINT_T)),
    );

    menu.AddItem(PCB_ACTIONS.properties, propertiesCondition);

    menu.AddItem(
      PCB_ACTIONS.assignNetClass,
      And(OnlyTypes(connectedTypes), Not(inFootprintEditor)),
    );
    menu.AddItem(PCB_ACTIONS.inspectClearance, Count(2));

    // Footprint actions
    menu.AddSeparator();
    menu.AddItem(PCB_ACTIONS.editFpInFpEditor, singleFootprintCondition);
    menu.AddItem(PCB_ACTIONS.updateFootprint, singleFootprintCondition);
    menu.AddItem(PCB_ACTIONS.updateFootprints, multipleFootprintsCondition);
    menu.AddItem(PCB_ACTIONS.changeFootprint, singleFootprintCondition);
    menu.AddItem(PCB_ACTIONS.changeFootprints, multipleFootprintsCondition);
    menu.AddMenu(fpAttributesMenu, Or(singleFootprintCondition, multipleFootprintsCondition));

    // Add the submenu for the special tools: modfiers and positioning tools
    menu.AddSeparator(100);
    menu.AddMenu(shapeModificationSubMenu, shapeModificationCondition, 100);
    menu.AddMenu(positioningToolsSubMenu, positioningToolsCondition, 100);

    menu.AddSeparator(150);
    menu.AddItem(ACTIONS.cut, NotEmpty, 150);
    menu.AddItem(ACTIONS.copy, NotEmpty, 150);
    menu.AddItem(PCB_ACTIONS.copyWithReference, notEmptyNotMoving, 150);
    menu.AddItem(ACTIONS.copyAsText, canCopyAsText, 150);

    // Selection tool handles the context menu for some other tools, such as the Picker.
    // Don't add things like Paste when another tool is active.
    menu.AddItem(ACTIONS.paste, noActiveToolCondition, 150);
    menu.AddItem(ACTIONS.pasteSpecial, And(noActiveToolCondition, Not(inFootprintEditor)), 150);
    menu.AddItem(ACTIONS.duplicate, NotEmpty, 150);
    menu.AddItem(ACTIONS.doDelete, NotEmpty, 150);

    menu.AddSeparator(150);
    menu.AddItem(ACTIONS.selectAll, noItemsCondition, 150);
    menu.AddItem(ACTIONS.unselectAll, noItemsCondition, 150);

    const mgr = this.m_toolMgr!.GetActionManager();
    mgr.SetConditions(
      PCB_ACTIONS.toggleExcludeFromBOM,
      new ACTION_CONDITIONS().Check(excludeFromBOMCond),
    );
    mgr.SetConditions(
      PCB_ACTIONS.toggleExcludeFromPosFiles,
      new ACTION_CONDITIONS().Check(excludeFromPosFilesCond),
    );

    return true;
  }

  ///< Find an item and start moving.
  GetAndPlace(_aEvent: TOOL_EVENT): number {
    // GetAndPlace makes sense only in board editor, although it is also called
    // in fpeditor, that shares the same EDIT_TOOL list
    if (this.IsFootprintEditor()) return 0;

    const selectionTool = this.selTool();

    void GetFootprintFromBoardByReference(this.editFrame()).then((fp) => {
      if (fp) {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_toolMgr!.RunAction<EDA_ITEM | null>(ACTIONS.selectItem, fp);

        selectionTool.GetSelection().SetReferencePoint(fp.GetPosition());
        this.m_toolMgr!.PostAction(PCB_ACTIONS.move);
      }
    });

    return 0;
  }

  /**
   * `m_toolMgr->GetTool<ROUTER_TOOL>()`. TRANSITIONAL (#636 stage 3): the
   * router is the window's, and WINDOW_ACTION_BRIDGE answers for it.
   */
  routerTool(): ROUTER_TOOL_LIKE | null {
    const bridge = this.m_toolMgr!.FindTool('pcbnew.WindowActionBridge') as unknown as {
      Router(): ROUTER_TOOL_LIKE | null;
    } | null;

    return bridge?.Router() ?? null;
  }

  invokeInlineRouter(aDragMode: number): boolean {
    const theRouter = this.routerTool();

    if (!theRouter) return false;

    // don't allow switch from moving to dragging
    if (this.m_dragging) {
      wxBell();
      return false;
    }

    // make sure we don't accidentally invoke inline routing mode while the router is already
    // active!
    if (theRouter.IsToolActive()) return false;

    if (theRouter.CanInlineDrag(aDragMode)) {
      this.m_toolMgr!.RunAction(PCB_ACTIONS.routerInlineDrag, aDragMode);
      return true;
    }

    return false;
  }

  isRouterActive(): boolean {
    const router = this.routerTool();

    return !!router && router.RoutingInProgress();
  }

  /**
   * Invoke the PNS router to drag tracks or do an offline resizing of an arc track
   * if a single arc track is selected.
   */
  Drag(aEvent: TOOL_EVENT): number {
    const router = this.routerTool();

    if (!router) {
      wxBell();
      return 0; // don't drag when no router tool (i.e. fp editor)
    }

    if (router.IsToolActive()) {
      wxBell();
      return 0; // don't drag when router is already active
    }

    if (this.m_dragging) {
      wxBell();
      return 0; // don't do a router drag when already in an EDIT_TOOL drag
    }

    let mode: number = PNS_DRAG_MODE.DM_ANY;

    if (aEvent.IsAction(PCB_ACTIONS.dragFreeAngle)) mode |= PNS_DRAG_MODE.DM_FREE_ANGLE;

    const selection = this.selTool().RequestSelection((aPt, aCollector, sTool) => {
      sTool.FilterCollectorForFreePads(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);

      let tracks: PCB_TRACK[] = [];
      let vias: PCB_TRACK[] = [];
      let footprints: FOOTPRINT[] = [];

      // Gather items from the collector into per-type vectors
      const gatherItemsByType = (): void => {
        for (const item of aCollector) {
          const t = item.Type();

          if (t === KICAD_T.PCB_VIA_T) vias.push(item as PCB_TRACK);
          else if (t === KICAD_T.PCB_TRACE_T || t === KICAD_T.PCB_ARC_T)
            tracks.push(item as PCB_TRACK);
          else if (t === KICAD_T.PCB_FOOTPRINT_T) footprints.push(item as FOOTPRINT);
        }
      };

      // Initial gathering of items
      gatherItemsByType();

      if (!sTool.GetSelection().IsHover() && footprints.length) {
        // Remove non-footprints so box-selection will drag footprints.
        for (let ii = aCollector.GetCount() - 1; ii >= 0; --ii) {
          if (aCollector.At(ii)!.Type() !== KICAD_T.PCB_FOOTPRINT_T) aCollector.Remove(ii);
        }
      } else if (tracks.length || vias.length) {
        /*
         * First trim down selection to active layer, tracks vs zones, etc.
         */
        if (aCollector.GetCount() > 1) {
          sTool.GuessSelectionCandidates(aCollector, aPt);

          // Re-gather items after trimming to update counts
          tracks = [];
          vias = [];
          footprints = [];

          gatherItemsByType();
        }

        /*
         * If we have a knee between two tracks, or a via attached to two tracks,
         * then drop the selection to a single item.  We don't want a selection
         * disambiguation menu when it doesn't matter which items is picked.
         */
        const connected = (track: PCB_TRACK, pt: VECTOR2I): boolean => {
          const s = track.GetStart();
          const e = track.GetEnd();
          return (s.x === pt.x && s.y === pt.y) || (e.x === pt.x && e.y === pt.y);
        };

        if (tracks.length === 2 && vias.length === 0) {
          if (
            connected(tracks[0]!, tracks[1]!.GetStart()) ||
            connected(tracks[0]!, tracks[1]!.GetEnd())
          )
            aCollector.Remove(tracks[1]!);
        } else if (tracks.length === 2 && vias.length === 1) {
          if (
            connected(tracks[0]!, vias[0]!.GetPosition()) &&
            connected(tracks[1]!, vias[0]!.GetPosition())
          ) {
            aCollector.Remove(tracks[0]!);
            aCollector.Remove(tracks[1]!);
          }
        }
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return 0;

    this.invokeInlineRouter(mode);

    return 0;
  }

  ToggleFootprintAttribute(aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection(EDIT_TOOL.FootprintFilter);

    if (selection.Empty()) return 0;

    let variantName = '';
    const board = this.frame().GetBoard();

    if (board) variantName = board.GetCurrentVariant();

    let new_state = false;

    for (const item of selection) {
      const fp = item as unknown as FOOTPRINT;

      if (
        (aEvent.IsAction(PCB_ACTIONS.toggleExcludeFromBOM) &&
          !fp.GetExcludedFromBOMForVariant(variantName)) ||
        (aEvent.IsAction(PCB_ACTIONS.toggleExcludeFromPosFiles) &&
          !fp.GetExcludedFromPosFilesForVariant(variantName))
      ) {
        new_state = true;
        break;
      }
    }

    const commit = new BOARD_COMMIT(this);

    for (const item of selection) {
      const fp = item as unknown as FOOTPRINT;
      commit.Modify(fp);

      if (variantName !== '') {
        let variant = fp.GetVariant(variantName);

        if (!variant) variant = fp.AddVariant(variantName);

        if (variant) {
          if (aEvent.IsAction(PCB_ACTIONS.toggleExcludeFromBOM))
            variant.SetExcludedFromBOM(new_state);
          else if (aEvent.IsAction(PCB_ACTIONS.toggleExcludeFromPosFiles))
            variant.SetExcludedFromPosFiles(new_state);

          continue;
        }
      }

      if (aEvent.IsAction(PCB_ACTIONS.toggleExcludeFromBOM)) fp.SetExcludedFromBOM(new_state);
      else if (aEvent.IsAction(PCB_ACTIONS.toggleExcludeFromPosFiles))
        fp.SetExcludedFromPosFiles(new_state);
    }

    if (!commit.Empty()) commit.Push('Toggle Attribute');

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  /** The client filter the track-width, track-layer and fillet commands share. */
  private static trackFilter: CLIENT_SELECTION_FILTER = (_aPt, aCollector, sTool) => {
    // Iterate from the back so we don't have to worry about removals.
    for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
      const item = aCollector.At(i)!;

      if (!item.IsType(trackTypes)) aCollector.Remove(item);
    }

    sTool.FilterCollectorForLockedItems(aCollector);
  };

  ChangeTrackWidth(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection(EDIT_TOOL.trackFilter);

    this.selTool().ReportFilteredLockedItems();

    const commit = new BOARD_COMMIT(this);

    for (const item of selection) {
      if (item.Type() === KICAD_T.PCB_VIA_T) {
        const via = item as unknown as PCB_VIA;

        commit.Modify(via);

        let new_width: number;
        let new_drill: number;

        if (via.GetViaType() === VIATYPE.MICROVIA) {
          const netClass = via.GetEffectiveNetClass();

          new_width = netClass.GetuViaDiameter();
          new_drill = netClass.GetuViaDrill();
        } else {
          new_width = this.board().GetDesignSettings().GetCurrentViaSize();
          new_drill = this.board().GetDesignSettings().GetCurrentViaDrill();
        }

        via.SetDrill(new_drill);
        // TODO(JE) padstacks - is this correct behavior already?  If so, also change stack mode
        via.SetWidth(PADSTACK.ALL_LAYERS, new_width);
      } else if (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T) {
        const track = item as unknown as PCB_TRACK;

        commit.Modify(track);

        const new_width = this.board().GetDesignSettings().GetCurrentTrackWidth();
        track.SetWidth(new_width);
      }
    }

    commit.Push('Edit Track Width/Via Size');

    if (selection.IsHover()) {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      // Notify other tools of the changes -- This updates the visual ratsnest
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
    }

    return 0;
  }

  ChangeTrackLayer(aEvent: TOOL_EVENT): number {
    const router = this.routerTool();

    if (router && router.IsToolActive()) return 0;

    const isNext = aEvent.IsAction(PCB_ACTIONS.changeTrackLayerNext);

    const selection = this.selTool().RequestSelection(EDIT_TOOL.trackFilter);

    this.selTool().ReportFilteredLockedItems();

    const origLayer = this.frame().GetActiveLayer();

    if (isNext) this.m_toolMgr!.RunAction(PCB_ACTIONS.layerNext);
    else this.m_toolMgr!.RunAction(PCB_ACTIONS.layerPrev);

    const newLayer = this.frame().GetActiveLayer();

    if (newLayer === origLayer) return 0;

    const commit = new BOARD_COMMIT(this);

    for (const item of selection) {
      if (item.Type() === KICAD_T.PCB_TRACE_T || item.Type() === KICAD_T.PCB_ARC_T) {
        const track = item as unknown as PCB_TRACK;

        commit.Modify(track);

        track.SetLayer(newLayer);
      }
    }

    commit.Push('Edit Track Layer');

    if (selection.IsHover()) {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      // Notify other tools of the changes -- This updates the visual ratsnest
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
    }

    return 0;
  }

  /**
   * Fillet (i.e. adds an arc tangent to) all selected straight tracks by a user defined radius.
   */
  FilletTracks(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection(EDIT_TOOL.trackFilter);

    if (this.selTool().ReportFilteredLockedItems()) return 0;

    if (selection.Size() < 2) {
      this.showInfoBarMsg('At least two straight track segments must be selected.');
      return 0;
    }

    const frame = this.editFrame();

    if (!frame.ShowUnitEntryDialog) return 0;

    // The selection is re-read after the modal, as upstream reads it after
    // ShowModal returns.
    const items = selection.GetItems();

    void frame
      .ShowUnitEntryDialog('Fillet Tracks', 'Radius:', EDIT_TOOL.s_filletTracksRadius)
      .then((aValue) => {
        if (aValue === null || aValue === 0) return;

        // Store last used fillet radius to allow pressing "enter" if repeat fillet is required
        EDIT_TOOL.s_filletTracksRadius = aValue;
        this.filletTracks(items, aValue);
      });

    return 0;
  }

  /** `FilletTracks` after the radius dialog. */
  filletTracks(aSelection: readonly EDA_ITEM[], aFilletRadius: number): void {
    interface FILLET_OP {
      t1: PCB_TRACK;
      t2: PCB_TRACK;
      // Start point of track is modified after PCB_ARC is added, otherwise the end point:
      t1Start: boolean;
      t2Start: boolean;
    }

    const filletOperations: FILLET_OP[] = [];
    let operationPerformedOnAtLeastOne = false;
    let didOneAttemptFail = false;
    const processedTracks = new Set<PCB_TRACK>();
    const selected = new Set(aSelection);

    const processFilletOp = (aTrack: PCB_TRACK, aStartPoint: boolean): void => {
      const c = this.board().GetConnectivity();
      const anchor = aStartPoint ? aTrack.GetStart() : aTrack.GetEnd();
      const itemsOnAnchor = c.GetConnectedItemsAtAnchor(aTrack, anchor, baseConnectedTypes);

      if (
        itemsOnAnchor.length > 0 &&
        selected.has(itemsOnAnchor[0]!) &&
        itemsOnAnchor[0]!.Type() === KICAD_T.PCB_TRACE_T
      ) {
        const trackOther = itemsOnAnchor[0] as unknown as PCB_TRACK;

        // Make sure we don't fillet the same pair of tracks twice
        if (!processedTracks.has(trackOther)) {
          if (itemsOnAnchor.length === 1) {
            filletOperations.push({
              t1: aTrack,
              t2: trackOther,
              t1Start: aStartPoint,
              t2Start: aTrack.IsPointOnEnds(trackOther.GetStart()) !== 0,
            });
          } else {
            // User requested to fillet these two tracks but not possible as
            // there are other elements connected at that point
            didOneAttemptFail = true;
          }
        }
      }
    };

    for (const item of aSelection) {
      if (item.Type() === KICAD_T.PCB_TRACE_T) {
        const track = item as unknown as PCB_TRACK;

        if (track.GetLength() > 0) {
          processFilletOp(track, true); // on the start point of track
          processFilletOp(track, false); // on the end point of track

          processedTracks.add(track);
        }
      }
    }

    const commit = new BOARD_COMMIT(this);
    const itemsToAddToSelection: BOARD_ITEM[] = [];

    for (const filletOp of filletOperations) {
      const track1 = filletOp.t1;
      const track2 = filletOp.t2;

      const trackOnStart = track1.IsPointOnEnds(track2.GetStart()) !== 0;
      const trackOnEnd = track1.IsPointOnEnds(track2.GetEnd()) !== 0;

      if (trackOnStart && trackOnEnd) continue; // Ignore duplicate tracks

      if ((trackOnStart || trackOnEnd) && track1.GetLayer() === track2.GetLayer()) {
        const t1Seg = new SEG(track1.GetStart(), track1.GetEnd());
        const t2Seg = new SEG(track2.GetStart(), track2.GetEnd());

        if (t1Seg.ApproxCollinear(t2Seg)) continue;

        const sArc = new SHAPE_ARC(t1Seg, t2Seg, aFilletRadius);
        const t1newPoint = { x: 0, y: 0 };
        const t2newPoint = { x: 0, y: 0 };

        const setIfPointOnSeg = (
          aPointToSet: { x: number; y: number },
          aSegment: SEG,
          aVecToTest: VECTOR2I,
        ): boolean => {
          const n = aSegment.NearestPoint(aVecToTest);

          // Find out if we are on the segment (minimum precision)
          if (Math.hypot(n.x - aVecToTest.x, n.y - aVecToTest.y) < SHAPE.MIN_PRECISION_IU) {
            aPointToSet.x = aVecToTest.x;
            aPointToSet.y = aVecToTest.y;
            return true;
          }

          return false;
        };

        //Do not draw a fillet if the end points of the arc are not within the track segments
        if (
          !setIfPointOnSeg(t1newPoint, t1Seg, sArc.GetP0()) &&
          !setIfPointOnSeg(t2newPoint, t2Seg, sArc.GetP0())
        ) {
          didOneAttemptFail = true;
          continue;
        }

        if (
          !setIfPointOnSeg(t1newPoint, t1Seg, sArc.GetP1()) &&
          !setIfPointOnSeg(t2newPoint, t2Seg, sArc.GetP1())
        ) {
          didOneAttemptFail = true;
          continue;
        }

        const tArc = new PCB_ARC(this.frame().GetBoard(), sArc);
        tArc.SetLayer(track1.GetLayer());
        tArc.SetWidth(track1.GetWidth());
        tArc.SetNet(track1.GetNet());
        tArc.SetLocked(track1.IsLocked());
        tArc.SetHasSolderMask(track1.HasSolderMask());
        tArc.SetLocalSolderMaskMargin(track1.GetLocalSolderMaskMargin());
        commit.Add(tArc);
        itemsToAddToSelection.push(tArc);

        commit.Modify(track1);
        commit.Modify(track2);

        if (filletOp.t1Start) track1.SetStart(t1newPoint);
        else track1.SetEnd(t1newPoint);

        if (filletOp.t2Start) track2.SetStart(t2newPoint);
        else track2.SetEnd(t2newPoint);

        operationPerformedOnAtLeastOne = true;
      }
    }

    commit.Push('Fillet Tracks');

    //select the newly created arcs
    for (const item of itemsToAddToSelection) this.selTool().AddItemToSel(item);

    if (!operationPerformedOnAtLeastOne)
      this.showInfoBarMsg('Unable to fillet the selected track segments.');
    else if (didOneAttemptFail)
      this.showInfoBarMsg('Some of the track segments could not be filleted.');
  }

  /**
   * "Modify" graphical lines. This includes operations such as filleting, chamfering,
   * extending to meet.
   */
  ModifyLines(aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        // We've converted the polygon and rectangle to segments, so drop everything
        // that isn't a segment at this point
        if (
          !item.IsType([
            KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T,
            KICAD_T.PCB_SHAPE_LOCATE_POLY_T,
            KICAD_T.PCB_SHAPE_LOCATE_RECT_T,
          ])
        ) {
          aCollector.Remove(item);
        }
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    // std::set<PCB_SHAPE*>: pointer order, which is creation order here
    const lines_to_add: PCB_SHAPE[] = [];
    const items_to_remove: PCB_SHAPE[] = [];

    for (const item of selection) {
      const pts: VECTOR2I[] = [];
      const graphic = item as unknown as PCB_SHAPE;
      const layer = graphic.GetLayer();
      const width = graphic.GetWidth();

      if (graphic.GetShape() === SHAPE_T.RECTANGLE) {
        items_to_remove.push(graphic);
        const start = graphic.GetStart();
        const end = graphic.GetEnd();
        pts.push({ ...start });
        pts.push({ x: end.x, y: start.y });
        pts.push({ ...end });
        pts.push({ x: start.x, y: end.y });
      }

      if (graphic.GetShape() === SHAPE_T.POLY) {
        items_to_remove.push(graphic);

        for (let jj = 0; jj < graphic.GetPolyShape().VertexCount(); ++jj)
          pts.push(graphic.GetPolyShape().CVertex(jj));
      }

      const newLine = (aStart: VECTOR2I, aEnd: VECTOR2I): PCB_SHAPE => {
        const line = new PCB_SHAPE_CTOR(this.frame().GetModel() as BOARD_ITEM, SHAPE_T.SEGMENT);

        line.SetStart(aStart);
        line.SetEnd(aEnd);
        line.SetWidth(width);
        line.SetLayer(layer);
        return line;
      };

      for (let jj = 1; jj < pts.length; ++jj) lines_to_add.push(newLine(pts[jj - 1]!, pts[jj]!));

      if (pts.length > 1) lines_to_add.push(newLine(pts[pts.length - 1]!, pts[0]!));
    }

    const segmentCount =
      selection.CountType(KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T) + lines_to_add.length;

    if (aEvent.IsAction(PCB_ACTIONS.extendLines) && segmentCount !== 2) {
      this.showInfoBarMsg('Exactly two lines must be selected to extend them.');
      return 0;
    } else if (segmentCount < 2) {
      this.showInfoBarMsg('A shape with at least two lines must be selected.');
      return 0;
    }

    const commit = new BOARD_COMMIT(this);

    // Items created like lines from a rectangle
    for (const item of lines_to_add) {
      commit.Add(item);
      selection.Add(item);
    }

    // Remove items like rectangles that we decomposed into lines
    for (const item of items_to_remove) {
      selection.Remove(item);
      commit.Remove(item);
    }

    for (const item of selection) item.ClearFlags(STRUCT_DELETED);

    // List of thing to select at the end of the operation
    // (doing it as we go will invalidate the iterator)
    const items_to_select_on_success: BOARD_ITEM[] = [];

    // And same for items to deselect
    const items_to_deselect_on_success: BOARD_ITEM[] = [];

    // Handle modifications to existing items by the routine
    // How to deal with this depends on whether we're in the footprint editor or not
    // and whether the item was conjured up by decomposing a polygon or rectangle
    const item_modification_handler = (aItem: BOARD_ITEM): void => {
      // If the item was "conjured up" it will be added later separately
      if (!lines_to_add.includes(aItem as PCB_SHAPE)) {
        commit.Modify(aItem);
        items_to_select_on_success.push(aItem);
      }
    };

    let any_items_created = lines_to_add.length > 0;
    const item_creation_handler = (aItem: BOARD_ITEM): void => {
      any_items_created = true;
      items_to_select_on_success.push(aItem);
      commit.Add(aItem);
    };

    let any_items_removed = items_to_remove.length > 0;
    const item_removal_handler = (aItem: BOARD_ITEM): void => {
      aItem.SetFlags(STRUCT_DELETED);
      any_items_removed = true;
      items_to_deselect_on_success.push(aItem);
      commit.Remove(aItem);
    };

    // Combine these callbacks into a CHANGE_HANDLER to inject in the ROUTINE
    const change_handler = new CALLABLE_BASED_HANDLER(
      item_creation_handler,
      item_modification_handler,
      item_removal_handler,
    );

    const model = this.frame().GetModel() as BOARD_ITEM;

    const run = (pairwise_line_routine: PAIRWISE_LINE_ROUTINE | null): void => {
      if (!pairwise_line_routine) {
        // Didn't construct any mofication routine - user must have cancelled
        commit.Revert();
        return;
      }

      // Apply the tool to every line pair
      const items = selection.GetItems();

      for (let i = 0; i < items.length; ++i) {
        for (let j = i + 1; j < items.length; ++j) {
          const a = items[i]!;
          const b = items[j]!;

          if ((a.GetFlags() & STRUCT_DELETED) === 0 && (b.GetFlags() & STRUCT_DELETED) === 0) {
            const line_a = a as unknown as PCB_SHAPE;
            const line_b = b as unknown as PCB_SHAPE;

            pairwise_line_routine.ProcessLinePair(line_a, line_b);
          }
        }
      }

      // Select added and modified items
      for (const item of items_to_select_on_success) this.selTool().AddItemToSel(item, true);

      // Deselect removed items
      for (const item of items_to_deselect_on_success) this.selTool().RemoveItemFromSel(item, true);

      if (any_items_removed) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

      if (any_items_created) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

      // Notify other tools of the changes
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

      commit.Push(pairwise_line_routine.GetCommitDescription());

      const msg = pairwise_line_routine.GetStatusMessage(segmentCount);

      if (msg !== null) this.showInfoBarMsg(msg);
    };

    const frame = this.editFrame();

    // Construct an appropriate tool
    if (aEvent.IsAction(PCB_ACTIONS.filletLines)) {
      if (!frame.ShowUnitEntryDialog) return run(null), 0;

      void frame
        .ShowUnitEntryDialog('Fillet Lines', 'Radius:', EDIT_TOOL.s_filletLinesRadius)
        .then((aValue) => {
          // GetRadiusParams: a cancel, or a value of 0, is no radius
          if (aValue === null || aValue === 0) return run(null);

          EDIT_TOOL.s_filletLinesRadius = aValue;
          run(new LINE_FILLET_ROUTINE(model, change_handler, aValue));
        });
    } else if (aEvent.IsAction(PCB_ACTIONS.dogboneCorners)) {
      if (!frame.ShowDogboneDialog) return run(null), 0;

      void frame.ShowDogboneDialog({ ...EDIT_TOOL.s_dogBoneParams }).then((aParams) => {
        if (!aParams) return run(null);

        EDIT_TOOL.s_dogBoneParams = { ...aParams };
        run(new DOGBONE_CORNER_ROUTINE(model, change_handler, aParams));
      });
    } else if (aEvent.IsAction(PCB_ACTIONS.chamferLines)) {
      if (!frame.ShowUnitEntryDialog) return run(null), 0;

      void frame
        .ShowUnitEntryDialog(
          'Chamfer Lines',
          'Chamfer setback:',
          EDIT_TOOL.s_chamferParams.m_chamfer_setback_a,
        )
        .then((aValue) => {
          if (aValue === null || aValue === 0) return run(null);

          // It's hard to easily specify an asymmetric chamfer (which line gets the longer setback?),
          // so we just use the same setback for each
          EDIT_TOOL.s_chamferParams = { m_chamfer_setback_a: aValue, m_chamfer_setback_b: aValue };
          run(new LINE_CHAMFER_ROUTINE(model, change_handler, { ...EDIT_TOOL.s_chamferParams }));
        });
    } else if (aEvent.IsAction(PCB_ACTIONS.extendLines)) {
      run(new LINE_EXTENSION_ROUTINE(model, change_handler));
    } else {
      run(null);
    }

    return 0;
  }

  /**
   * Simplify the outlines of selected polygon objects
   */
  SimplifyPolygons(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (!item.IsType([KICAD_T.PCB_SHAPE_LOCATE_POLY_T, KICAD_T.PCB_ZONE_T]))
          aCollector.Remove(item);

        if (item.Type() === KICAD_T.PCB_ZONE_T && (item as unknown as ZONE).IsTeardropArea())
          aCollector.Remove(item);
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    const frame = this.editFrame();

    if (!frame.ShowUnitEntryDialog) return 0;

    const items = selection.GetItems();

    void frame
      .ShowUnitEntryDialog('Simplify Shapes', 'Tolerance value:', EDIT_TOOL.s_simplifyTolerance)
      .then((aValue) => {
        if (aValue === null) return;

        // Store last used value
        EDIT_TOOL.s_simplifyTolerance = aValue;

        if (aValue <= 0) return;

        const commit = new BOARD_COMMIT(this);

        for (const item of items) {
          commit.Modify(item);

          if (item.Type() === KICAD_T.PCB_SHAPE_T) {
            const poly = (item as unknown as PCB_SHAPE).GetPolyShape();

            poly.SimplifyOutlines(aValue);
          }

          if (item.Type() === KICAD_T.PCB_ZONE_T) {
            const zone = item as unknown as ZONE;
            const poly = zone.Outline();

            poly.SimplifyOutlines(aValue);
            zone.HatchBorder();
          }
        }

        commit.Push('Simplify Polygons');

        // Notify other tools of the changes
        this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
      });

    return 0;
  }

  /**
   * Make ends of selected shapes meet by extending or cutting them, or adding extra geometry.
   */
  HealShapes(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        // We've converted the polygon and rectangle to segments, so drop everything
        // that isn't a segment at this point
        if (
          !item.IsType([
            KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T,
            KICAD_T.PCB_SHAPE_LOCATE_ARC_T,
            KICAD_T.PCB_SHAPE_LOCATE_BEZIER_T,
          ])
        ) {
          aCollector.Remove(item);
        }
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    const frame = this.editFrame();

    if (!frame.ShowUnitEntryDialog) return 0;

    const items = selection.GetItems();

    void frame
      .ShowUnitEntryDialog('Heal Shapes', 'Tolerance value:', EDIT_TOOL.s_healTolerance)
      .then((aValue) => {
        if (aValue === null) return;

        // Store last used value
        EDIT_TOOL.s_healTolerance = aValue;

        if (aValue <= 0) return;

        const commit = new BOARD_COMMIT(this);

        const shapeList: PCB_SHAPE[] = [];

        for (const item of items) {
          if (item.Type() === KICAD_T.PCB_SHAPE_T) {
            const shape = item as unknown as PCB_SHAPE;

            shapeList.push(shape);
            commit.Modify(shape);
          }
        }

        ConnectBoardShapes(shapeList, aValue);

        commit.Push('Heal Shapes');

        // Notify other tools of the changes
        this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
      });

    return 0;
  }

  /**
   * Modify selected polygons into a single polygon using boolean operations
   * such as merge (union) or subtract (difference)
   */
  BooleanPolygons(aEvent: TOOL_EVENT): number {
    const polygonBooleanTypes = [
      KICAD_T.PCB_SHAPE_LOCATE_POLY_T,
      KICAD_T.PCB_SHAPE_LOCATE_RECT_T,
      KICAD_T.PCB_SHAPE_LOCATE_CIRCLE_T,
    ];

    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (!item.IsType(polygonBooleanTypes)) aCollector.Remove(item);
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    const last_item = selection.GetLastAddedItem();

    // Gather or construct polygon source shapes to merge
    let items_to_process: PCB_SHAPE[] = [];

    for (const item of selection) {
      items_to_process.push(item as unknown as PCB_SHAPE);

      // put the last one in the selection at the front of the vector
      // so it can be used as the property donor and as the basis for the
      // boolean operation
      if (item === last_item) {
        const n = items_to_process.length - 1;
        [items_to_process[n], items_to_process[0]] = [items_to_process[0]!, items_to_process[n]!];
      }
    }

    const commit = new BOARD_COMMIT(this);

    // Handle modifications to existing items by the routine
    const item_modification_handler = (aItem: BOARD_ITEM): void => {
      commit.Modify(aItem);
    };

    let items_to_select_on_success: BOARD_ITEM[] = [];

    const item_creation_handler = (aItem: BOARD_ITEM): void => {
      items_to_select_on_success.push(aItem);
      commit.Add(aItem);
    };

    const item_removal_handler = (aItem: BOARD_ITEM): void => {
      commit.Remove(aItem);
    };

    // Combine these callbacks into a CHANGE_HANDLER to inject in the ROUTINE
    const change_handler = new CALLABLE_BASED_HANDLER(
      item_creation_handler,
      item_modification_handler,
      item_removal_handler,
    );

    // Construct an appropriate routine
    let boolean_routine: POLYGON_BOOLEAN_ROUTINE | null = null;

    const create_routine = (): POLYGON_BOOLEAN_ROUTINE | null => {
      // (Re-)construct the boolean routine based on the action
      // This is done here so that we can re-init the routine if we need to
      // go again in the reverse order.

      const model = this.frame().GetModel() as BOARD_ITEM | null;

      if (!model) return null;

      if (aEvent.IsAction(PCB_ACTIONS.mergePolygons))
        return new POLYGON_MERGE_ROUTINE(model, change_handler);
      else if (aEvent.IsAction(PCB_ACTIONS.subtractPolygons))
        return new POLYGON_SUBTRACT_ROUTINE(model, change_handler);
      else if (aEvent.IsAction(PCB_ACTIONS.intersectPolygons))
        return new POLYGON_INTERSECT_ROUTINE(model, change_handler);

      return null;
    };

    const run_routine = (): void => {
      // Perform the operation on each polygon
      for (const shape of items_to_process) boolean_routine!.ProcessShape(shape);

      boolean_routine!.Finalize();
    };

    boolean_routine = create_routine();

    if (!boolean_routine) return 0; // Could not find a polygon routine for this action

    // First run the routine and see what we get
    run_routine();

    // If we are doing a non-commutative operation (e.g. subtract), and we just got null,
    // assume the user meant go in a different opposite order
    if (!boolean_routine.IsCommutative() && items_to_select_on_success.length === 0) {
      // Clear the commit and the selection
      commit.Revert();
      items_to_select_on_success = [];

      const items_area = new Map<PCB_SHAPE, number>();

      for (const shape of items_to_process) {
        const area = shape.GetBoundingBox().GetArea();
        items_area.set(shape, area);
      }

      // Sort the shapes by their bounding box area in descending order
      // This way we will start with the largest shape first and subtract the smaller ones
      // This may not work perfectly in all cases, but it works well when the larger
      // shape completely contains the smaller ones, which is probably the most common case.
      // In other cases, the user will need to select the shapes in the correct order (i.e.
      // the largest shape last), or do the subtractions in multiple steps.
      items_to_process = [...items_to_process].sort(
        (a, b) => items_area.get(b)! - items_area.get(a)!,
      );

      // Run the routine again
      boolean_routine = create_routine()!;
      run_routine();
    }

    // Select new items
    for (const item of items_to_select_on_success) this.selTool().AddItemToSel(item, true);

    // Notify other tools of the changes
    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

    commit.Push(boolean_routine.GetCommitDescription());

    const msg = boolean_routine.GetStatusMessage();

    if (msg !== null) this.showInfoBarMsg(msg);

    return 0;
  }

  /**
   * Display properties window for the selected object.
   */
  Properties(_aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();
    const selection = this.selTool().RequestSelection(() => {});

    const finish = (): void => {
      if (selection.IsHover()) {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      } else {
        // Check for items becoming invisible and drop them from the selection.

        const selCopy = selection.GetItems();
        const visible = editFrame.GetBoard()!.GetVisibleLayers();

        for (const eda_item of selCopy) {
          if (!eda_item.IsBOARD_ITEM()) continue;

          const item = eda_item as unknown as BOARD_ITEM;

          if (!item.GetLayerSet().and(visible).any()) this.selTool().RemoveItemFromSel(item);
        }
      }

      if (this.m_dragging) {
        this.m_toolMgr!.PostAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
      }
    };

    // Tracks & vias are treated in a special way:
    if (SELECTION_CONDITIONS.OnlyTypes(trackTypes)(selection)) {
      // QuasiModal required for NET_SELECTOR
      void (editFrame.ShowTrackViaPropertiesDialog?.(selection) ?? Promise.resolve()).then(finish);
      return 0;
    } else if (SELECTION_CONDITIONS.OnlyTypes([KICAD_T.PCB_TABLECELL_T])(selection)) {
      const cells = selection.Items().map((item) => item as unknown as PCB_TABLECELL);

      // QuasiModal required for syntax help and Scintilla auto-complete
      void (editFrame.ShowTableCellPropertiesDialog?.(cells) ?? Promise.resolve(false))
        .then((aEditTable) => {
          if (aEditTable) {
            const table = cells[0]!.GetParent() as unknown as PCB_TABLE;

            // Scintilla's auto-complete requires quasiModal
            return editFrame.ShowTablePropertiesDialog?.(table);
          }
        })
        .then(finish);
      return 0;
    } else if (selection.Size() === 1 && selection.Front()!.IsBOARD_ITEM()) {
      // Display properties dialog
      const item = selection.Front() as unknown as BOARD_ITEM;

      // Do not handle undo buffer, it is done by the properties dialogs
      (editFrame as unknown as { OnEditItemRequest(aItem: BOARD_ITEM): void }).OnEditItemRequest(
        item,
      );

      // Notify other tools of the changes
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);
    } else if (selection.Size() === 0 && this.getView()!.IsLayerVisible(LAYER_DRAWINGSHEET)) {
      const ds = this.canvas()?.GetDrawingSheet() ?? null;
      const cursorPos = this.controls().GetCursorPosition(false);

      if (ds?.HitTestDrawingSheetItems(this.getView()!, cursorPos))
        this.m_toolMgr!.PostAction(ACTIONS.pageSettings);
      else this.m_toolMgr!.RunAction(PCB_ACTIONS.footprintProperties);
    }

    finish();
    return 0;
  }

  EditVertices(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForTableCells(aCollector);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (!selectionHasEditableCorners(selection)) {
      wxBell();
      return 0;
    }

    const editFrame = this.editFrame();
    const front = selection.Front();
    const item = front?.IsBOARD_ITEM() ? (front as unknown as BOARD_ITEM) : null;

    if (editFrame && item) editFrame.OpenVertexEditor?.(item);

    return 0;
  }

  /** The event's commit, when another tool runs this action synchronously inside its own. */
  private eventCommit(aEvent: TOOL_EVENT): BOARD_COMMIT | null {
    const commit = aEvent.Commit();
    return commit instanceof BOARD_COMMIT ? commit : null;
  }

  /**
   * Rotate currently selected items.
   */
  Rotate(aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const editFrame = this.editFrame();
    const localCommit = new BOARD_COMMIT(this);
    const commit = this.eventCommit(aEvent) ?? localCommit;

    // Be sure that there is at least one item that we can modify. If nothing was selected before,
    // try looking for the stuff under mouse cursor (i.e. KiCad old-style hover selection)
    let selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector, false);
      sTool.FilterCollectorForTableCells(aCollector);

      // Filter locked items if in board editor and in free-pad-mode.  (If we're not in
      // free-pad mode we delay this until the second RequestSelection().)
      if (!this.m_isFootprintEditor && this.frame().GetPcbNewSettings().m_AllowFreePads)
        sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return 0;

    let oldRefPt: VECTOR2I | null = null;
    const is_hover = selection.IsHover(); // N.B. This must be saved before the second
    // call to RequestSelection() below

    if (selection.HasReferencePoint()) oldRefPt = selection.GetReferencePoint();

    // Now filter out pads if not in free pads mode.  We cannot do this in the first
    // RequestSelection() as we need the reference point when a pad is the selection front.
    if (!this.m_isFootprintEditor && !this.frame().GetPcbNewSettings().m_AllowFreePads) {
      selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
        sTool.FilterCollectorForMarkers(aCollector);
        sTool.FilterCollectorForHierarchy(aCollector, true);
        sTool.FilterCollectorForFreePads(aCollector);
        sTool.FilterCollectorForTableCells(aCollector);
        sTool.FilterCollectorForLockedItems(aCollector);
      });

      this.selTool().ReportFilteredLockedItems();
    }

    // Did we filter everything out?  If so, don't try to operate further
    if (selection.Empty()) return 0;

    // Some PCB_SHAPE must be rotated around their center instead of their start point in
    // order to stay to the same place (at least RECT and POLY)
    // Note a RECT shape rotated by a not cardinal angle is a POLY shape
    let usePcbShapeCenter = false;
    const front = selection.Front()!;

    if (selection.Size() === 1 && !this.m_dragging && front.Type() === KICAD_T.PCB_SHAPE_T) {
      const shape = front as unknown as PCB_SHAPE;

      if (shape.GetShape() === SHAPE_T.RECTANGLE || shape.GetShape() === SHAPE_T.POLY)
        usePcbShapeCenter = true;
    }

    if (selection.Size() === 1 && !this.m_dragging && front.Type() === KICAD_T.PCB_TABLE_T)
      usePcbShapeCenter = true;

    if (selection.Size() === 1 && !this.m_dragging && front.Type() === KICAD_T.PCB_TEXTBOX_T) {
      selection.SetReferencePoint((front as unknown as PCB_TEXTBOX).GetCenter());
    } else if (usePcbShapeCenter) {
      selection.SetReferencePoint((front as unknown as PCB_SHAPE).GetCenter());
    } else {
      this.updateModificationPoint(selection);
    }

    const refPt = selection.GetReferencePoint();
    let rotateAngle = GetEventRotationAngle(editFrame, aEvent);

    if (this.frame().GetCanvas()!.GetView().GetGAL()!.IsFlippedX())
      rotateAngle = rotateAngle.negate();

    // Calculate view bounding box
    const viewBBox = front.ViewBBox().Clone();

    for (const item of selection) viewBBox.Merge(item.ViewBBox());

    // Check if the view bounding box will go out of bounds
    const rotPos = RotatePoint(viewBBox.GetPosition(), refPt, rotateAngle);
    const rotEnd = RotatePoint(viewBBox.GetEnd(), refPt, rotateAngle);

    const max = INT_MAX - COORDS_PADDING;
    const min = -max;

    const outOfBounds =
      rotPos.x < min ||
      rotPos.x > max ||
      rotPos.y < min ||
      rotPos.y > max ||
      rotEnd.x < min ||
      rotEnd.x > max ||
      rotEnd.y < min ||
      rotEnd.y > max;

    if (!outOfBounds) {
      for (const item of selection) {
        commit.Modify(item, null, RECURSE_MODE.RECURSE);

        if (item.IsBOARD_ITEM()) {
          const board_item = item as unknown as BOARD_ITEM;

          board_item.Rotate(refPt, rotateAngle);
          board_item.Normalize();

          if (board_item.Type() === KICAD_T.PCB_FOOTPRINT_T)
            (board_item as FOOTPRINT).InvalidateComponentClassCache();
        }
      }

      // Don't push a separate undo entry when we're in the middle of a move operation.
      // The parent move will handle the commit.
      if (!localCommit.Empty() && !this.m_dragging) localCommit.Push('Rotate');

      if (is_hover && !this.m_dragging) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

      if (this.m_dragging) {
        this.m_toolMgr!.PostAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
      }
    }

    // Restore the old reference so any mouse dragging that occurs doesn't make the selection jump
    // to this now invalid reference
    if (oldRefPt) selection.SetReferencePoint(oldRefPt);
    else selection.ClearReferencePoint();

    return 0;
  }

  /**
   * Mirror the current selection. The mirror axis passes through the current point.
   */
  Mirror(aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const localCommit = new BOARD_COMMIT(this);
    const commit = this.eventCommit(aEvent) ?? localCommit;

    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return 0;

    this.updateModificationPoint(selection);
    const mirrorPoint = selection.GetReferencePoint();

    const flipDirection = aEvent.IsAction(PCB_ACTIONS.mirrorV)
      ? FLIP_DIRECTION.TOP_BOTTOM
      : FLIP_DIRECTION.LEFT_RIGHT;

    let skippedFootprints = 0;
    let skippedGroups = 0;

    for (const item of selection) {
      if (!item.IsType(EDIT_TOOL.MirrorableItems)) {
        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) skippedFootprints++;

        continue;
      }

      // Skip groups that hold non-mirrorable items, else the rest would tear away from them.
      if (item.Type() === KICAD_T.PCB_GROUP_T && !groupMirrorable(item as unknown as PCB_GROUP)) {
        skippedGroups++;
        continue;
      }

      commit.Modify(item, null, RECURSE_MODE.RECURSE);

      // modify each object as necessary
      switch (item.Type()) {
        case KICAD_T.PCB_PAD_T:
          mirrorPad(item as unknown as PAD, mirrorPoint, flipDirection);
          break;

        case KICAD_T.PCB_SHAPE_T:
        case KICAD_T.PCB_ZONE_T:
        case KICAD_T.PCB_FIELD_T:
        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_TEXTBOX_T:
        case KICAD_T.PCB_TABLE_T:
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
        case KICAD_T.PCB_GROUP_T:
        case KICAD_T.PCB_GENERATOR_T:
        case KICAD_T.PCB_POINT_T:
          (item as unknown as BOARD_ITEM).Mirror(mirrorPoint, flipDirection);
          break;

        default:
          // it's likely the commit object is wrong if you get here
          console.assert(false, `EDIT_TOOL::Mirror: unimplemented for ${item.GetClass()}`);
      }
    }

    // Don't push a separate undo entry when we're in the middle of a move operation.
    // The parent move will handle the commit.
    if (!localCommit.Empty() && !this.m_dragging) localCommit.Push('Mirror');

    if (skippedFootprints > 0 && !this.m_dragging) {
      this.showInfoBarMsg(
        'Footprints cannot be mirrored. Use Flip to move them to the other side of the board.',
      );
    } else if (skippedGroups > 0 && !this.m_dragging) {
      this.showInfoBarMsg(
        'Groups containing footprints or other items that cannot be mirrored were skipped.',
      );
    }

    if (selection.IsHover() && !this.m_dragging) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

    if (this.m_dragging) {
      this.m_toolMgr!.PostAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    }

    return 0;
  }

  /**
   * Set the justification on any text items (or fields) in the current selection.
   */
  JustifyText(aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const localCommit = new BOARD_COMMIT(this);
    const commit = this.eventCommit(aEvent) ?? localCommit;

    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return 0;

    const setJustify = (aTextItem: { SetHorizJustify(aJustify: GR_TEXT_H_ALIGN): void }): void => {
      if (aEvent.Matches(ACTIONS.leftJustify.MakeEvent()))
        aTextItem.SetHorizJustify(GR_TEXT_H_ALIGN.GR_TEXT_H_ALIGN_LEFT);
      else if (aEvent.Matches(ACTIONS.centerJustify.MakeEvent()))
        aTextItem.SetHorizJustify(GR_TEXT_H_ALIGN.GR_TEXT_H_ALIGN_CENTER);
      else aTextItem.SetHorizJustify(GR_TEXT_H_ALIGN.GR_TEXT_H_ALIGN_RIGHT);
    };

    for (const item of selection) {
      if (item.Type() === KICAD_T.PCB_FIELD_T || item.Type() === KICAD_T.PCB_TEXT_T) {
        commit.Modify(item);
        setJustify(item as unknown as PCB_TEXT);
      } else if (item.Type() === KICAD_T.PCB_TEXTBOX_T) {
        commit.Modify(item);
        setJustify(item as unknown as PCB_TEXTBOX);
      }
    }

    if (!localCommit.Empty()) {
      if (aEvent.Matches(ACTIONS.leftJustify.MakeEvent())) localCommit.Push('Left Justify');
      else if (aEvent.Matches(ACTIONS.centerJustify.MakeEvent()))
        localCommit.Push('Center Justify');
      else localCommit.Push('Right Justify');
    }

    if (selection.IsHover() && !this.m_dragging) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

    if (this.m_dragging) {
      this.m_toolMgr!.PostAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    }

    return 0;
  }

  /**
   * Rotate currently selected items. The rotation point is the current cursor position.
   */
  Flip(aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const localCommit = new BOARD_COMMIT(this);
    const commit = this.eventCommit(aEvent) ?? localCommit;

    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector);
      sTool.FilterCollectorForTableCells(aCollector);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return 0;

    let oldRefPt: VECTOR2I | null = null;

    if (selection.HasReferencePoint()) oldRefPt = selection.GetReferencePoint();

    this.updateModificationPoint(selection);

    // Flip around the anchor for footprints, and the bounding box center for board items
    let refPt: VECTOR2I = this.IsFootprintEditor() ? { x: 0, y: 0 } : selection.GetCenter();

    if (this.m_dragging && this.m_inMoveWithReference && oldRefPt) {
      refPt = oldRefPt;
    } else if (selection.GetSize() === 1) {
      // If only one item selected, flip around the selection or item anchor point (instead
      // of the bounding box center) to avoid moving the item anchor
      // but only if the item is not a PCB_SHAPE with SHAPE_T::RECTANGLE shape, because
      // for this shape the flip transform swap start and end coordinates and move the shape.
      // So using the center of the shape is better (the shape does not move)
      // (Tables are a bunch of rectangles, so exclude them too)
      const item0 = selection.GetItems()[0]!;
      const rect = item0.Type() === KICAD_T.PCB_SHAPE_T ? (item0 as unknown as PCB_SHAPE) : null;
      const table = item0.Type() === KICAD_T.PCB_TABLE_T;

      if (!table && (!rect || rect.GetShape() !== SHAPE_T.RECTANGLE))
        refPt = selection.GetReferencePoint();
    }

    const flipDirection = this.frame().GetPcbNewSettings().m_FlipDirection;

    for (const item of selection) {
      if (!item.IsBOARD_ITEM()) continue;

      const boardItem = item as unknown as BOARD_ITEM;

      commit.Modify(boardItem, null, RECURSE_MODE.RECURSE);

      boardItem.Flip(refPt, flipDirection);
      boardItem.Normalize();

      if (boardItem.Type() === KICAD_T.PCB_FOOTPRINT_T)
        (boardItem as FOOTPRINT).InvalidateComponentClassCache();
    }

    // Don't push a separate undo entry when we're in the middle of a move operation.
    // The parent move will handle the commit.
    if (!localCommit.Empty() && !this.m_dragging) localCommit.Push('Change Side / Flip');

    if (selection.IsHover() && !this.m_dragging) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

    if (this.m_dragging) {
      this.m_toolMgr!.PostAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    }

    // Restore the old reference so any mouse dragging that occurs doesn't make the selection jump
    // to this now invalid reference
    if (oldRefPt) selection.SetReferencePoint(oldRefPt);
    else selection.ClearReferencePoint();

    return 0;
  }

  DeleteItems(aItems: PCB_SELECTION | readonly EDA_ITEM[], aIsCut: boolean): void {
    const editFrame = this.editFrame();
    const commit = new BOARD_COMMIT(this);
    let commitFlags = 0;
    const items = Array.isArray(aItems) ? aItems : (aItems as PCB_SELECTION).GetItems();

    // As we are about to remove items, they have to be removed from the selection first
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    let itemsDeleted = 0;
    let fieldsHidden = 0;
    let fieldsAlreadyHidden = 0;

    for (const item of items) {
      if (!item.IsBOARD_ITEM()) continue;

      const board_item = item as unknown as BOARD_ITEM;
      const parentFP = board_item.GetParentFootprint();

      switch (item.Type()) {
        case KICAD_T.PCB_FIELD_T: {
          const field = board_item as unknown as PCB_FIELD;

          commit.Modify(parentFP!);

          if (field.IsVisible()) {
            field.SetVisible(false);
            fieldsHidden++;
          } else {
            fieldsAlreadyHidden++;
          }

          this.getView()!.Update(parentFP!);
          break;
        }

        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_SHAPE_T:
        case KICAD_T.PCB_TEXTBOX_T:
        case KICAD_T.PCB_BARCODE_T:
        case KICAD_T.PCB_TABLE_T:
        case KICAD_T.PCB_REFERENCE_IMAGE_T:
        case KICAD_T.PCB_DIMENSION_T:
        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_LEADER_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        case KICAD_T.PCB_POINT_T:
          commit.Remove(board_item);
          itemsDeleted++;
          break;

        case KICAD_T.PCB_TABLECELL_T:
          // Clear contents of table cell
          commit.Modify(board_item);
          (board_item as unknown as PCB_TABLECELL).SetText('');
          itemsDeleted++;
          break;

        case KICAD_T.PCB_GROUP_T:
          board_item.RunOnChildren((aItem: BOARD_ITEM) => {
            commit.Remove(aItem);
          }, RECURSE_MODE.RECURSE);

          commit.Remove(board_item);
          itemsDeleted++;
          break;

        case KICAD_T.PCB_PAD_T:
          if (this.IsFootprintEditor() || this.frame().GetPcbNewSettings().m_AllowFreePads) {
            commit.Remove(board_item);
            itemsDeleted++;
          }

          break;

        case KICAD_T.PCB_ZONE_T: {
          // We process the zones special so that cutouts can be deleted when the delete
          // tool is called from inside a cutout when the zone is selected.
          // Only interact with cutouts when deleting and a single item is selected
          if (!aIsCut && items.length === 1) {
            const curPos = this.controls().GetCursorPosition();
            const zone = board_item as unknown as ZONE;
            const outlineIdx = { value: 0 };
            const holeIdx = { value: 0 };

            if (zone.HitTestCutout(curPos, outlineIdx, holeIdx)) {
              // Remove the cutout
              commit.Modify(zone);
              zone.RemoveCutout(outlineIdx.value, holeIdx.value);
              zone.UnFill();

              // Update the display
              zone.HatchBorder();
              this.canvas()?.Refresh();

              // Restore the selection on the original zone
              this.m_toolMgr!.RunAction<EDA_ITEM | null>(ACTIONS.selectItem, zone);

              break;
            }
          }

          // Remove the entire zone otherwise
          commit.Remove(board_item);
          itemsDeleted++;
          break;
        }

        case KICAD_T.PCB_GENERATOR_T: {
          const generator = board_item as unknown as PCB_GENERATOR;

          if (SELECTION_CONDITIONS.OnlyTypes([KICAD_T.PCB_GENERATOR_T])(selectionOf(items))) {
            this.m_toolMgr!.RunSynchronousAction<PCB_GENERATOR>(
              PCB_ACTIONS.genRemove,
              commit,
              generator,
            );
            commit.Push('Delete', commitFlags);
            commitFlags |= APPEND_UNDO;
          } else {
            for (const member of generator.GetItems()) commit.Remove(member);

            commit.Remove(board_item);
          }

          itemsDeleted++;
          break;
        }

        default:
          commit.Remove(board_item);
          itemsDeleted++;
          break;
      }
    }

    // If the entered group has been emptied then leave it.
    const enteredGroup = this.selTool().GetEnteredGroup();

    if (enteredGroup && enteredGroup.GetItems().size === 0) this.selTool().ExitGroup();

    if (aIsCut) {
      commit.Push('Cut', commitFlags);
    } else if (itemsDeleted === 0) {
      if (fieldsHidden === 1) commit.Push('Hide Field', commitFlags);
      else if (fieldsHidden > 1) commit.Push('Hide Fields', commitFlags);
      else if (fieldsAlreadyHidden > 0)
        editFrame.ShowInfoBarError?.('Use the Footprint Properties dialog to remove fields.');
    } else {
      commit.Push('Delete', commitFlags);
    }
  }

  /**
   * Delete currently selected items.
   */
  Remove(aEvent: TOOL_EVENT): number {
    const editFrame = this.editFrame();

    editFrame.PushTool(aEvent);

    this.Activate();

    // get a copy instead of reference (as we're going to clear the selection before removing items)
    let selectionCopy: EDA_ITEM[];
    const isCut = aEvent.Parameter<REMOVE_FLAGS>() === REMOVE_FLAGS.CUT;
    const isAlt = aEvent.Parameter<REMOVE_FLAGS>() === REMOVE_FLAGS.ALT;

    // If we are in a "Cut" operation, then the copied selection exists already and we want to
    // delete exactly that; no more, no fewer.  Any filtering for locked items must be done in
    // the copyToClipboard() routine.
    if (isCut) {
      selectionCopy = this.selTool().GetSelection().GetItems();
    } else {
      // Hover-pick is only a fallback for an empty selection.
      const hadInitialSelection = !this.selTool().GetSelection().Empty();

      // When not in free-pad mode we normally auto-promote selected pads to their parent
      // footprints.  But this is probably a little too dangerous for a destructive operation,
      // so we just do the promotion but not the deletion (allowing for a second delete to do
      // it if that's what the user wanted).
      let sel = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
        sTool.FilterCollectorForHierarchy(aCollector, true);
        sTool.FilterCollectorForLockedItems(aCollector);
      });

      this.selTool().ReportFilteredLockedItems();

      if (hadInitialSelection && sel.Empty()) {
        editFrame.PopTool(aEvent);
        return 0;
      }

      const beforeFPCount = sel.CountType(KICAD_T.PCB_FOOTPRINT_T);

      sel = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
        sTool.FilterCollectorForHierarchy(aCollector, true);
        sTool.FilterCollectorForFreePads(aCollector);
        sTool.FilterCollectorForLockedItems(aCollector);
      });

      if (
        !sel.IsHover() &&
        this.selTool().GetSelection().CountType(KICAD_T.PCB_FOOTPRINT_T) > beforeFPCount
      ) {
        wxBell();
        this.canvas()?.Refresh();
        editFrame.PopTool(aEvent);
        return 0;
      }

      // In "alternative" mode, we expand selected track items to their full connection.
      if (isAlt && (sel.HasType(KICAD_T.PCB_TRACE_T) || sel.HasType(KICAD_T.PCB_VIA_T)))
        this.m_toolMgr!.RunAction(PCB_ACTIONS.selectConnection);

      selectionCopy = this.selTool().GetSelection().GetItems();

      if (selectionCopy.length === 0) {
        editFrame.PopTool(aEvent);
        return 0;
      }
    }

    this.DeleteItems(selectionCopy, isCut);
    this.canvas()?.Refresh();

    editFrame.PopTool(aEvent);
    return 0;
  }

  /**
   * Invoke a dialog box to allow moving of the item by an exact amount.
   */
  MoveExact(_aEvent: TOOL_EVENT): number {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector, false);
      sTool.FilterCollectorForTableCells(aCollector);
      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return 0;

    const values: MOVE_EXACT_VALUES = {
      translation: { x: 0, y: 0 },
      rotation: ANGLE_0,
      rotationAnchor:
        selection.Size() > 1
          ? ROTATION_ANCHOR.ROTATE_AROUND_SEL_CENTER
          : ROTATION_ANCHOR.ROTATE_AROUND_ITEM_ANCHOR,
    };

    // TODO: Implement a visible bounding border at the edge
    const sel_box = selection.GetBoundingBox();
    const editFrame = this.editFrame();

    if (!editFrame.ShowMoveExactDialog) return 0;

    const items = selection.GetItems();
    const isHover = selection.IsHover();

    void editFrame.ShowMoveExactDialog(values, sel_box).then((aValues) => {
      if (!aValues) return;

      const commit = new BOARD_COMMIT(this);
      const translation = aValues.translation;
      const angle = aValues.rotation;
      const rotationAnchor = aValues.rotationAnchor;
      const rp = selection.GetCenter();

      // Make sure the rotation is from the right reference point
      const selCenter = { x: rp.x + translation.x, y: rp.y + translation.y };

      // (upstream negates `rotation` here, which nothing reads afterwards: the
      // items turn by `angle`, the value before the negation)

      for (const item of items) {
        if (!item.IsBOARD_ITEM()) continue;

        const boardItem = item as unknown as BOARD_ITEM;

        commit.Modify(boardItem, null, RECURSE_MODE.RECURSE);

        const parent = boardItem.GetParent();

        if (!parent || !parent.IsSelected()) boardItem.Move(translation);

        switch (rotationAnchor) {
          case ROTATION_ANCHOR.ROTATE_AROUND_ITEM_ANCHOR:
            boardItem.Rotate(boardItem.GetPosition(), angle);
            break;
          case ROTATION_ANCHOR.ROTATE_AROUND_SEL_CENTER:
            boardItem.Rotate(selCenter, angle);
            break;
          case ROTATION_ANCHOR.ROTATE_AROUND_USER_ORIGIN:
            boardItem.Rotate(this.frame().GetScreen()!.m_LocalOrigin, angle);
            break;
          case ROTATION_ANCHOR.ROTATE_AROUND_AUX_ORIGIN:
            boardItem.Rotate(this.board().GetDesignSettings().GetAuxOrigin(), angle);
            break;
        }

        if (!this.m_dragging) this.getView()!.Update(boardItem);
      }

      commit.Push('Move Exactly');

      if (isHover) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedItemsModified);

      if (this.m_dragging) {
        this.m_toolMgr!.PostAction(PCB_ACTIONS.updateLocalRatsnest, { x: 0, y: 0 });
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
      }
    });

    return 0;
  }

  /**
   * Duplicate the current selection and starts a move action.
   */
  *Duplicate(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.isRouterActive()) {
      wxBell();
      return 0;
    }

    const increment = aEvent.IsAction(PCB_ACTIONS.duplicateIncrement);

    // Be sure that there is at least one item that we can modify
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForFreePads(aCollector, true);
      sTool.FilterCollectorForTableCells(aCollector);
    });

    if (selection.Empty()) return 0;

    // Duplicating tuning patterns alone is not supported
    if (selection.Size() === 1 && selection.CountType(KICAD_T.PCB_GENERATOR_T)) return 0;

    // we have a selection to work on now, so start the tool process
    const editFrame = this.editFrame();
    const commit = new BOARD_COMMIT(this);
    let parentFootprint: FOOTPRINT | null = null;

    if (this.m_isFootprintEditor) parentFootprint = editFrame.GetBoard()!.GetFirstFootprint();

    // If the selection was given a hover, we do not keep the selection after completion
    const is_hover = selection.IsHover();

    const new_items: BOARD_ITEM[] = [];

    // Each selected item is duplicated and pushed to new_items list
    // Old selection is cleared, and new items are then selected.
    for (const item of selection.GetItems()) {
      if (!item.IsBOARD_ITEM()) continue;

      let dupe_item: BOARD_ITEM | null = null;
      const orig_item = item as unknown as BOARD_ITEM;

      if (!this.m_isFootprintEditor && orig_item.GetParentFootprint()) {
        // No sub-footprint modifications allowed outside of footprint editor
      } else {
        switch (orig_item.Type()) {
          case KICAD_T.PCB_FOOTPRINT_T:
          case KICAD_T.PCB_TEXT_T:
          case KICAD_T.PCB_TEXTBOX_T:
          case KICAD_T.PCB_BARCODE_T:
          case KICAD_T.PCB_REFERENCE_IMAGE_T:
          case KICAD_T.PCB_SHAPE_T:
          case KICAD_T.PCB_TRACE_T:
          case KICAD_T.PCB_ARC_T:
          case KICAD_T.PCB_VIA_T:
          case KICAD_T.PCB_ZONE_T:
          case KICAD_T.PCB_TARGET_T:
          case KICAD_T.PCB_POINT_T:
          case KICAD_T.PCB_DIM_ALIGNED_T:
          case KICAD_T.PCB_DIM_CENTER_T:
          case KICAD_T.PCB_DIM_RADIAL_T:
          case KICAD_T.PCB_DIM_ORTHOGONAL_T:
          case KICAD_T.PCB_DIM_LEADER_T:
            dupe_item = this.m_isFootprintEditor
              ? parentFootprint!.DuplicateItem(true, commit, orig_item)
              : orig_item.Duplicate(true, commit);

            // Clear the selection flag here, otherwise the PCB_SELECTION_TOOL
            // will not properly select it later on
            dupe_item!.ClearSelected();

            if (
              dupe_item!.Type() === KICAD_T.PCB_SHAPE_T &&
              (dupe_item as unknown as PCB_SHAPE).IsHatchedFill()
            ) {
              dupe_item!.SetFlags(IS_NEW);
            }

            new_items.push(dupe_item!);
            commit.Add(dupe_item!);
            break;

          case KICAD_T.PCB_FIELD_T:
            // PCB_FIELD items are specific items (not only graphic, but are properies)
            // and cannot be duplicated like other footprint items. So skip it:
            orig_item.ClearSelected();
            break;

          case KICAD_T.PCB_PAD_T: {
            dupe_item = parentFootprint!.DuplicateItem(true, commit, orig_item);
            const pad = dupe_item as unknown as PAD;

            if (increment && pad.CanHaveNumber()) {
              const padTool = this.m_toolMgr!.FindTool('pcbnew.PadTool') as unknown as {
                GetLastPadNumber(): string;
                SetLastPadNumber(aNumber: string): void;
              } | null;

              if (padTool) {
                let padNumber = padTool.GetLastPadNumber();
                padNumber = parentFootprint!.GetNextPadNumber(padNumber);
                padTool.SetLastPadNumber(padNumber);
                pad.SetNumber(padNumber);
              }
            }

            // Clear the selection flag here, otherwise the PCB_SELECTION_TOOL
            // will not properly select it later on
            dupe_item!.ClearSelected();

            new_items.push(dupe_item!);
            commit.Add(dupe_item!);
            break;
          }

          case KICAD_T.PCB_TABLE_T:
            // JEY TODO: tables
            break;

          case KICAD_T.PCB_GENERATOR_T:
          case KICAD_T.PCB_GROUP_T:
            dupe_item = (orig_item as unknown as PCB_GROUP).DeepDuplicate(true, commit);

            dupe_item.RunOnChildren((aItem: BOARD_ITEM) => {
              aItem.ClearSelected();
              new_items.push(aItem);
              commit.Add(aItem);
            }, RECURSE_MODE.RECURSE);

            dupe_item.ClearSelected();
            new_items.push(dupe_item);
            commit.Add(dupe_item);
            break;

          default:
            console.assert(
              false,
              `EDIT_TOOL::Duplicate: unimplemented for ${orig_item.GetClass()}`,
            );
            break;
        }
      }
    }

    // Clear the old selection first
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    // Select the new items
    this.m_toolMgr!.RunAction<EDA_ITEM[]>(ACTIONS.selectItems, new_items);

    // record the new items as added
    if (!selection.Empty()) {
      editFrame.DisplayToolMsg(`Duplicated ${new_items.length} item(s)`);

      // If items were duplicated, pick them up
      if (yield* this.doMoveSelection(aEvent, commit, true)) commit.Push('Duplicate');
      else commit.Revert();

      // Deselect the duplicated item if we originally started as a hover selection
      if (is_hover) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    }

    return 0;
  }

  /**
   * Increment some aspect of the selected items.q
   */
  Increment(aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      for (let i = aCollector.GetCount() - 1; i >= 0; i--) {
        switch (aCollector.At(i)!.Type()) {
          case KICAD_T.PCB_PAD_T:
          case KICAD_T.PCB_TEXT_T:
            break;
          default:
            aCollector.Remove(i);
            break;
        }
      }

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (selection.Empty()) return 0;

    let param: INCREMENT = { Delta: 1, Index: 0 };

    if (aEvent.HasParameter()) param = aEvent.Parameter<INCREMENT>();

    const incrementer = new STRING_INCREMENTER();
    incrementer.SetSkipIOSQXZ(true);

    // If we're coming via another action like 'Move', use that commit
    const localCommit = new BOARD_COMMIT(this.m_toolMgr!);
    const commit = this.eventCommit(aEvent) ?? localCommit;

    for (const item of selection) {
      switch (item.Type()) {
        case KICAD_T.PCB_PAD_T: {
          // Only increment pad numbers in the footprint editor
          if (!this.m_isFootprintEditor) break;

          const pad = item as unknown as PAD;

          if (!pad.CanHaveNumber()) continue;

          // Increment on the pad numbers
          const newNumber = incrementer.Increment(pad.GetNumber(), param.Delta, param.Index);

          if (newNumber !== undefined) {
            commit.Modify(pad);
            pad.SetNumber(newNumber);
          }

          break;
        }
        case KICAD_T.PCB_TEXT_T: {
          const text = item as unknown as PCB_TEXT;

          const newText = incrementer.Increment(text.GetText(), param.Delta, param.Index);

          if (newText !== undefined) {
            commit.Modify(text);
            text.SetText(newText);
          }

          break;
        }
        default:
          break;
      }
    }

    if (selection.Front()!.IsMoving()) this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

    commit.Push('Increment');

    return 0;
  }

  /**
   * A selection filter which prunes the selection to contain only items of type #PCB_MODULE_T.
   */
  static FootprintFilter(
    _aPt: VECTOR2I,
    aCollector: GENERAL_COLLECTOR,
    _sTool: PCB_SELECTION_TOOL,
  ): void {
    for (let i = aCollector.GetCount() - 1; i >= 0; i--) {
      if (aCollector.At(i)!.Type() !== KICAD_T.PCB_FOOTPRINT_T) aCollector.Remove(i);
    }
  }

  /**
   * A selection filter which prunes the selection to contain only items of type #PCB_PAD_T.
   */
  static PadFilter(
    _aPt: VECTOR2I,
    aCollector: GENERAL_COLLECTOR,
    _sTool: PCB_SELECTION_TOOL,
  ): void {
    for (let i = aCollector.GetCount() - 1; i >= 0; i--) {
      if (aCollector.At(i)!.Type() !== KICAD_T.PCB_PAD_T) aCollector.Remove(i);
    }
  }

  ///< Return the right modification point (e.g. for rotation), depending on the number of
  ///< selected items.
  updateModificationPoint(aSelection: PCB_SELECTION): boolean {
    // Can't modify an empty group
    if (aSelection.Empty()) return false;

    if ((this.m_dragging || aSelection.GetItems()[0]!.IsMoving()) && aSelection.HasReferencePoint())
      return false;

    // When there is only one item selected, the reference point is its position...
    if (aSelection.Size() === 1 && aSelection.Front()!.Type() !== KICAD_T.PCB_TABLE_T) {
      if (aSelection.Front()!.IsBOARD_ITEM()) {
        const item = aSelection.Front() as unknown as BOARD_ITEM;
        aSelection.SetReferencePoint(item.GetPosition());
      }
    }
    // ...otherwise modify items with regard to the grid-snapped center position
    else {
      const grid = new PCB_GRID_HELPER(this.m_toolMgr!, this.frame().GetMagneticItemsSettings());
      let refPt = aSelection.GetCenter();

      // Exclude text in the footprint editor if there's anything else selected
      if (this.m_isFootprintEditor) {
        const nonFieldsBBox = new BOX2I();

        for (const item of aSelection.Items()) {
          if (!item.IsType([KICAD_T.PCB_TEXT_T, KICAD_T.PCB_FIELD_T]))
            nonFieldsBBox.Merge(item.GetBoundingBox());
        }

        if (nonFieldsBBox.IsValid()) refPt = nonFieldsBBox.GetCenter();
      }

      aSelection.SetReferencePoint(grid.BestSnapAnchor(refPt, null));
    }

    return true;
  }

  *pickReferencePoint(
    aTooltip: string,
    aSuccessMessage: string,
    aCanceledMessage: string,
    aReferencePoint: { value: VECTOR2I },
  ): COROUTINE_BODY<boolean> {
    const picker = this.m_toolMgr!.FindTool(
      'pcbnew.InteractivePicker',
    ) as unknown as PCB_PICKER_TOOL;
    const editFrame = this.editFrame();
    let pickedPoint: VECTOR2I | null = null;
    let done = false;
    if (!this.m_statusPopup) this.m_statusPopup = new STATUS_TEXT_POPUP();

    const statusPopup = this.m_statusPopup;

    statusPopup.SetText(aTooltip);

    /// This allow the option of snapping in the tool
    picker.SetSnapping(true);
    picker.SetCursor(KICURSOR.PLACE);
    picker.ClearHandlers();

    const setPickerLayerSet = (): void => {
      const magSettings = editFrame.GetMagneticItemsSettings();
      let layerFilter: LSET;

      if (!magSettings.allLayers) layerFilter = new LSET([editFrame.GetActiveLayer()]);
      else layerFilter = LSET.AllLayersMask();

      picker.SetLayerSet(layerFilter);
    };

    // Initial set
    setPickerLayerSet();

    picker.SetClickHandler((aPoint) => {
      pickedPoint = { x: aPoint.x, y: aPoint.y };

      if (aSuccessMessage !== '') {
        statusPopup.SetText(aSuccessMessage);
        statusPopup.Expire(800);
      } else {
        statusPopup.Hide();
      }

      return false; // we don't need any more points
    });

    picker.SetMotionHandler(() => {
      const at = KIPLATFORM_UI.GetMousePosition();
      statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    });

    picker.SetCancelHandler(() => {
      if (aCanceledMessage !== '') {
        statusPopup.SetText(aCanceledMessage);
        statusPopup.Expire(800);
      } else {
        statusPopup.Hide();
      }
    });

    picker.SetFinalizeHandler(() => {
      done = true;
    });

    const at = KIPLATFORM_UI.GetMousePosition();
    statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    statusPopup.Popup();
    this.canvas()?.SetStatusPopup(popupFocus(statusPopup));

    this.m_toolMgr!.RunAction(ACTIONS.pickerSubTool);

    while (!done) {
      // Pass events unless we receive a null event, then we must shut down
      const evt = yield* this.Wait();

      if (evt) {
        if (evt.Matches(PCB_EVENTS_SnappingModeChangedByKeyEvent())) {
          // Update the layer set when the snapping mode changes
          setPickerLayerSet();
        }

        evt.SetPassEvent();
      } else {
        break;
      }
    }

    picker.ClearHandlers();

    // Ensure statusPopup is hidden after use and before deleting it:
    this.canvas()?.SetStatusPopup(null);
    statusPopup.Hide();

    if (pickedPoint) aReferencePoint.value = pickedPoint;

    return pickedPoint !== null;
  }

  /**
   * Send the current selection to the clipboard by formatting it as a fake pcb
   * see #AppendBoardFromClipboard for importing.
   */
  *copyToClipboard(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const io = new CLIPBOARD_IO();
    const grid = new PCB_GRID_HELPER(this.m_toolMgr!, this.editFrame().GetMagneticItemsSettings());
    const selectReferencePoint = new TOOL_EVENT(
      aEvent.Category(),
      aEvent.Action(),
      'pcbnew.InteractiveEdit.selectReferencePoint',
      TOOL_ACTION_SCOPE.AS_GLOBAL,
    );

    this.frame().PushTool(selectReferencePoint);
    this.Activate();

    const selection = this.selTool().RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForHierarchy(aCollector, true);
      sTool.FilterCollectorForMarkers(aCollector);

      if (aEvent.IsAction(ACTIONS.cut)) sTool.FilterCollectorForLockedItems(aCollector);
    });

    this.selTool().ReportFilteredLockedItems();

    if (!selection.Empty()) {
      const items: BOARD_ITEM[] = [];

      for (const item of selection) {
        if (item.IsBOARD_ITEM()) items.push(item as unknown as BOARD_ITEM);
      }

      const refPoint = { value: { x: 0, y: 0 } as VECTOR2I };

      if (aEvent.IsAction(PCB_ACTIONS.copyWithReference)) {
        if (
          !(yield* this.pickReferencePoint(
            'Select reference point for the copy...',
            'Selection copied',
            'Copy canceled',
            refPoint,
          ))
        ) {
          this.frame().PopTool(selectReferencePoint);
          return 0;
        }
      } else {
        refPoint.value = grid.BestDragOrigin(this.controls().GetCursorPosition(), items);
      }

      selection.SetReferencePoint(refPoint.value);

      io.SetBoard(this.board());
      io.SaveSelection(selection, this.m_isFootprintEditor);
      this.frame().SetStatusText('Selection copied');
    }

    this.frame().PopTool(selectReferencePoint);

    if (selection.IsHover()) this.selTool().ClearSelection();

    return 0;
  }

  /**
   * Send the current selection to the clipboard as text.
   */
  copyToClipboardAsText(_aEvent: TOOL_EVENT): number {
    const selection = this.selTool().RequestSelection(() => {
      // Anything unsupported will just be ignored
    });

    if (selection.IsHover()) this.selTool().ClearSelection();

    const getItemText = (aItem: BOARD_ITEM): string => {
      switch (aItem.Type()) {
        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_FIELD_T:
        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_LEADER_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T: {
          // These can all go via the PCB_TEXT class
          const text = aItem as unknown as PCB_TEXT;
          return text.GetShownText(true);
        }
        case KICAD_T.PCB_TEXTBOX_T:
        case KICAD_T.PCB_TABLECELL_T: {
          // This one goes via EDA_TEXT
          const textBox = aItem as unknown as PCB_TEXTBOX;
          return textBox.GetShownText(true);
        }
        case KICAD_T.PCB_TABLE_T: {
          const table = aItem as unknown as PCB_TABLE;
          let s = '';

          for (let row = 0; row < table.GetRowCount(); ++row) {
            for (let col = 0; col < table.GetColCount(); ++col) {
              const cell = table.GetCell(row, col)!;
              s += cell.GetShownText(true);

              if (col < table.GetColCount() - 1) s += '\t';
            }

            if (row < table.GetRowCount() - 1) s += '\n';
          }
          return s;
        }
        default:
          // No string representation for this item type
          break;
      }
      return '';
    };

    const itemTexts: string[] = [];

    for (const item of selection) {
      if (item.IsBOARD_ITEM()) {
        const boardItem = item as unknown as BOARD_ITEM;
        const itemText = getItemText(boardItem).trim();

        if (itemText !== '') itemTexts.push(itemText);
      }
    }

    // Send the text to the clipboard
    if (itemTexts.length > 0) SaveClipboard(itemTexts.join('\n'));

    return 0;
  }

  /**
   * Cut the current selection to the clipboard by formatting it as a fake pcb
   * see #AppendBoardFromClipboard for importing.
   */
  *cutToClipboard(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!(yield* this.copyToClipboard(aEvent))) {
      // N.B. Setting the CUT flag prevents lock filtering as we only want to delete the items
      // that were copied to the clipboard, no more, no fewer.  Filtering for locked item, if
      // any will be done in the copyToClipboard() routine
      const evt = aEvent.clone();
      evt.SetParameter(REMOVE_FLAGS.CUT);
      this.Remove(evt);
    }

    return 0;
  }

  ///< Rebuilds the ratsnest for operations that require it outside the commit rebuild
  rebuildConnectivity(): void {
    this.board().BuildConnectivity();
    this.m_toolMgr!.PostEvent(EVENTS.ConnectivityChangedEvent);
    this.canvas()?.RedrawRatsnest();
  }

  ///< Set up handlers for various events.
  protected override setTransitions(): void {
    const S = SYNC_HANDLER<EDIT_TOOL>;

    this.Go(S(this.GetAndPlace), PCB_ACTIONS.getAndPlace.MakeEvent());
    this.Go(this.Move, PCB_ACTIONS.move.MakeEvent());
    this.Go(this.Move, PCB_ACTIONS.moveIndividually.MakeEvent());
    this.Go(S(this.Drag), PCB_ACTIONS.drag45Degree.MakeEvent());
    this.Go(S(this.Drag), PCB_ACTIONS.dragFreeAngle.MakeEvent());
    this.Go(S(this.Rotate), PCB_ACTIONS.rotateCw.MakeEvent());
    this.Go(S(this.Rotate), PCB_ACTIONS.rotateCcw.MakeEvent());
    this.Go(S(this.Flip), PCB_ACTIONS.flip.MakeEvent());
    this.Go(S(this.Remove), ACTIONS.doDelete.MakeEvent());
    this.Go(S(this.Remove), PCB_ACTIONS.deleteFull.MakeEvent());
    this.Go(S(this.Properties), PCB_ACTIONS.properties.MakeEvent());
    this.Go(S(this.MoveExact), PCB_ACTIONS.moveExact.MakeEvent());
    this.Go(this.Move, PCB_ACTIONS.moveWithReference.MakeEvent());
    this.Go(this.Duplicate, ACTIONS.duplicate.MakeEvent());
    this.Go(this.Duplicate, PCB_ACTIONS.duplicateIncrement.MakeEvent());
    this.Go(S(this.Mirror), PCB_ACTIONS.mirrorH.MakeEvent());
    this.Go(S(this.Mirror), PCB_ACTIONS.mirrorV.MakeEvent());
    this.Go(S(this.Swap), PCB_ACTIONS.swap.MakeEvent());
    this.Go(S(this.SwapPadNets), PCB_ACTIONS.swapPadNets.MakeEvent());
    this.Go(S(this.SwapGateNets), PCB_ACTIONS.swapGateNets.MakeEvent());
    this.Go(this.PackAndMoveFootprints, PCB_ACTIONS.packAndMoveFootprints.MakeEvent());
    this.Go(S(this.ToggleFootprintAttribute), PCB_ACTIONS.toggleExcludeFromBOM.MakeEvent());
    this.Go(S(this.ToggleFootprintAttribute), PCB_ACTIONS.toggleExcludeFromPosFiles.MakeEvent());
    this.Go(S(this.ChangeTrackWidth), PCB_ACTIONS.changeTrackWidth.MakeEvent());
    this.Go(S(this.ChangeTrackLayer), PCB_ACTIONS.changeTrackLayerNext.MakeEvent());
    this.Go(S(this.ChangeTrackLayer), PCB_ACTIONS.changeTrackLayerPrev.MakeEvent());
    this.Go(S(this.FilletTracks), PCB_ACTIONS.filletTracks.MakeEvent());
    this.Go(S(this.ModifyLines), PCB_ACTIONS.filletLines.MakeEvent());
    this.Go(S(this.ModifyLines), PCB_ACTIONS.chamferLines.MakeEvent());
    this.Go(S(this.ModifyLines), PCB_ACTIONS.dogboneCorners.MakeEvent());
    this.Go(S(this.SimplifyPolygons), PCB_ACTIONS.simplifyPolygons.MakeEvent());
    this.Go(S(this.EditVertices), PCB_ACTIONS.editVertices.MakeEvent());
    this.Go(S(this.HealShapes), PCB_ACTIONS.healShapes.MakeEvent());
    this.Go(S(this.ModifyLines), PCB_ACTIONS.extendLines.MakeEvent());

    this.Go(S(this.Increment), ACTIONS.increment.MakeEvent());
    this.Go(S(this.Increment), ACTIONS.incrementPrimary.MakeEvent());
    this.Go(S(this.Increment), ACTIONS.decrementPrimary.MakeEvent());
    this.Go(S(this.Increment), ACTIONS.incrementSecondary.MakeEvent());
    this.Go(S(this.Increment), ACTIONS.decrementSecondary.MakeEvent());

    this.Go(S(this.BooleanPolygons), PCB_ACTIONS.mergePolygons.MakeEvent());
    this.Go(S(this.BooleanPolygons), PCB_ACTIONS.subtractPolygons.MakeEvent());
    this.Go(S(this.BooleanPolygons), PCB_ACTIONS.intersectPolygons.MakeEvent());

    this.Go(S(this.JustifyText), ACTIONS.leftJustify.MakeEvent());
    this.Go(S(this.JustifyText), ACTIONS.centerJustify.MakeEvent());
    this.Go(S(this.JustifyText), ACTIONS.rightJustify.MakeEvent());

    this.Go(this.copyToClipboard, ACTIONS.copy.MakeEvent());
    this.Go(this.copyToClipboard, PCB_ACTIONS.copyWithReference.MakeEvent());
    this.Go(S(this.copyToClipboardAsText), ACTIONS.copyAsText.MakeEvent());
    this.Go(this.cutToClipboard, ACTIONS.cut.MakeEvent());
  }
}

/**
 * Mirror a pad in the H/V axis passing through a point
 */
function mirrorPad(aPad: PAD, aMirrorPoint: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
  // TODO(JE) padstacks
  if (aPad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CUSTOM) aPad.FlipPrimitives(aFlipDirection);

  const tmpPt = { ...aPad.GetPosition() };
  MIRROR(tmpPt, aMirrorPoint, aFlipDirection);
  aPad.SetPosition(tmpPt);

  const tmpOffset = { ...aPad.GetOffset(PADSTACK.ALL_LAYERS) };
  MIRROR(tmpOffset, { x: 0, y: 0 }, aFlipDirection);
  aPad.SetOffset(PADSTACK.ALL_LAYERS, tmpOffset);

  const tmpz = { ...aPad.GetDelta(PADSTACK.ALL_LAYERS) };
  MIRROR(tmpz, { x: 0, y: 0 }, aFlipDirection);
  aPad.SetDelta(PADSTACK.ALL_LAYERS, tmpz);

  aPad.SetOrientation(aPad.GetOrientation().negate());
}

/**
 * `TOOL_EVT_UTILS::GetEventRotationAngle` (tool_event_utils.cpp): the frame's
 * rotation step, signed by the action's parameter (1 or -1).
 */
export function GetEventRotationAngle(aFrame: PCB_BASE_EDIT_FRAME, aEvent: TOOL_EVENT): EDA_ANGLE {
  const rotAngle = aFrame.GetRotationAngle();
  const angleMultiplier = aEvent.Parameter<number>();

  return angleMultiplier > 0 ? rotAngle : rotAngle.negate();
}

/** A selection over a list of items, for SELECTION_CONDITIONS. */
function selectionOf(aItems: readonly EDA_ITEM[]): SELECTION {
  const sel = new SELECTION_CLASS();

  for (const item of aItems) sel.Add(item);

  return sel;
}

/** `PCB_EVENTS::SnappingModeChangedByKeyEvent()`. */
function PCB_EVENTS_SnappingModeChangedByKeyEvent(): TOOL_EVENT {
  return PCB_EVENTS.SnappingModeChangedByKeyEvent();
}

export interface EDIT_TOOL extends EDIT_TOOL_MOVE_FCT {}

applyMixins(EDIT_TOOL, [EDIT_TOOL_MOVE_FCT]);
