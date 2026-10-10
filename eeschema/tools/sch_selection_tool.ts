// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/sch_selection_tool.{h,cpp}`: SCH_SELECTION_TOOL, the schematic and symbol
 * editors' always-running selection tool, and SCH_CONDITIONS.
 *
 * `Main` is the event loop every canvas event reaches through the TOOL_DISPATCHER: a click selects
 * (CollectHits, narrowSelection with the filter and GuessSelectionCandidates, the clarification
 * menu), a drag rubber-bands (selectMultiple / selectLasso -> SelectMultiple) or moves, a right
 * click opens the context menu, a double click opens the properties or enters a sheet or group.
 * The selection is `m_selection`, an SCH_SELECTION of live SCH_ITEMs drawn on the overlay.
 *
 * Porting notes (the file is the C++, method for method):
 *  - A handler that can block (`Wait()`, the clarification menu) is a generator here and its
 *    callers `yield*` it (common/tool/coroutine.ts).
 *  - KiCad's clarification menu is modal, so RequestSelection (called synchronously from another
 *    tool) can ask it and carry on. A menu here is an event loop of the tool's own, so a
 *    synchronous RequestSelection on an ambiguous spot treats the menu as cancelled: the hover
 *    action does nothing until the user clicks the item first.
 *  - `std::set<T*>` iterates in pointer order; the sets here only feed membership tests or
 *    selection order that the caller sorts, except SelectMultiple's candidates, which KiCad sorts
 *    by position before selecting.
 *  - The net navigator is the window's; its commands are reached through the frame when it has
 *    them.
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  BRIGHTENED,
  ENDPOINT,
  ENTERED,
  IS_MOVING,
  IS_NEW,
  SELECTED,
  SELECTION_CANDIDATE,
  SHOW_ELEC_TYPE,
  STARTPOINT,
} from '@ziroeda/common/eda_item_flags.js';
import { EDA_SHAPE, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { type KIID, niluuid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/mouse_drag_action.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { SELECTION_AREA } from '@ziroeda/common/preview_items/selection_area.js';
import { SCH_SELECTION_FILTER_OPTIONS } from '@ziroeda/common/project/project_local_settings.js';
import { ACTIONS, type INCREMENT } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import { SELECTION_MODE, SELECTION_TOOL } from '@ziroeda/common/tool/selection_tool.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_AUX1,
  BUT_AUX2,
  BUT_LEFT,
  BUT_MIDDLE,
  BUT_RIGHT,
  EVENTS,
  MD_ALT,
  MD_CTRL,
  MD_SHIFT,
  type OPT_TOOL_EVENT,
  TA_CHOICE_MENU_CHOICE,
  TA_MOUSE_WHEEL,
  TA_UNDO_REDO_PRE,
  TC_COMMAND,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { LAYER_ITEM_PAIR } from '@ziroeda/common/view/view.js';
import { VIEW_GROUP } from '@ziroeda/common/view/view_group.js';
import { wxGetMouseState } from '@ziroeda/common/wx/wx_event.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { OutInt } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  toVECTOR2I,
  type Vec2 as VECTOR2D,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { DEFAULT_TEXT_SIZE } from '../default_values.js';
import { id_eeschema_frm } from '../eeschema_id.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import type { SCH_BUS_WIRE_ENTRY } from '../sch_bus_entry.js';
import { SCH_COLLECTOR } from '../sch_collectors.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { SCH_CONNECTION } from '../sch_connection.js';
import { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { SCH_GROUP } from '../sch_group.js';
import { SCH_ITEM } from '../sch_item.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
  LABEL_SHAPE,
  SPIN_STYLE,
} from '../sch_label.js';
import { SCH_LINE } from '../sch_line.js';
import type { SCH_MARKER } from '../sch_marker.js';
import { SCH_NO_CONNECT } from '../sch_no_connect.js';
import { SCH_PIN } from '../sch_pin.js';
import { SCH_SHAPE } from '../sch_shape.js';
import { SCH_SHEET } from '../sch_sheet.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../sch_sheet_pin.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import { SCH_TABLE } from '../sch_table.js';
import { SCH_TABLECELL } from '../sch_tablecell.js';
import { RotateAndMirrorPin } from '../symb_transforms_utils.js';
import { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import type { SCH_POINT_EDITOR } from './sch_point_editor.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS, type DRAW_SEGMENT_EVENT_PARAMS } from './sch_actions.js';
import { SCH_SELECTION } from './sch_selection.js';
import { GetSameSymbolMultiUnitSelection } from './sch_tool_utils.js';

const { And, Or } = SELECTION_CONDITIONS;

export class SCH_CONDITIONS extends SELECTION_CONDITIONS {
  static readonly SingleSymbol: SELECTION_CONDITION = (aSel: SELECTION) => {
    if (aSel.GetSize() === 1) {
      const symbol = aSel.Front() instanceof SCH_SYMBOL ? (aSel.Front() as SCH_SYMBOL) : null;

      if (symbol) return !symbol.GetLibSymbolRef() || !symbol.GetLibSymbolRef()!.IsPower();
    }

    return false;
  };

  static readonly SingleSymbolOrPower: SELECTION_CONDITION = (aSel: SELECTION) =>
    aSel.GetSize() === 1 && aSel.Front()!.Type() === KICAD_T.SCH_SYMBOL_T;

  static readonly SingleMultiBodyStyleSymbol: SELECTION_CONDITION = (aSel: SELECTION) => {
    if (aSel.GetSize() === 1) {
      const symbol = aSel.Front() instanceof SCH_SYMBOL ? (aSel.Front() as SCH_SYMBOL) : null;

      if (symbol) return !!symbol.GetLibSymbolRef() && symbol.GetLibSymbolRef()!.IsMultiBodyStyle();
    }

    return false;
  };

  static readonly SingleMultiUnitSymbol: SELECTION_CONDITION = (aSel: SELECTION) => {
    if (aSel.GetSize() === 1) {
      const symbol = aSel.Front() instanceof SCH_SYMBOL ? (aSel.Front() as SCH_SYMBOL) : null;

      if (symbol)
        return !!symbol.GetLibSymbolRef() && symbol.GetLibSymbolRef()!.GetUnitCount() >= 2;
    }

    return false;
  };

  static readonly SingleMultiFunctionPin: SELECTION_CONDITION = (aSel: SELECTION) => {
    if (aSel.GetSize() === 1) {
      const pin = aSel.Front() instanceof SCH_PIN ? (aSel.Front() as SCH_PIN) : null;

      if (pin?.GetLibPin()) return pin.GetLibPin()!.GetAlternates().size > 0;
    }

    return false;
  };

  static readonly SingleNonExcludedMarker: SELECTION_CONDITION = (aSel: SELECTION) => {
    if (aSel.CountType(KICAD_T.SCH_MARKER_T) !== 1) return false;

    return !(aSel.Front() as SCH_MARKER).IsExcluded();
  };

  static readonly MultipleSymbolsOrPower: SELECTION_CONDITION = (aSel: SELECTION) =>
    aSel.GetSize() > 1 && aSel.OnlyContains([KICAD_T.SCH_SYMBOL_T]);

  static readonly AllPins: SELECTION_CONDITION = (aSel: SELECTION) =>
    aSel.GetSize() >= 1 && aSel.OnlyContains([KICAD_T.SCH_PIN_T]);

  static readonly AllPinsOrSheetPins: SELECTION_CONDITION = (aSel: SELECTION) =>
    aSel.GetSize() >= 1 && aSel.OnlyContains([KICAD_T.SCH_PIN_T, KICAD_T.SCH_SHEET_PIN_T]);
}

function passEvent(aEvent: TOOL_EVENT, aAllowedActions: readonly TOOL_ACTION[]): void {
  for (const action of aAllowedActions) {
    if (aEvent.IsAction(action)) {
      aEvent.SetPassEvent();
      break;
    }
  }
}

const HITTEST_THRESHOLD_PIXELS = 5;

const connectedTypes: readonly KICAD_T[] = [
  KICAD_T.SCH_SYMBOL_LOCATE_POWER_T,
  KICAD_T.SCH_PIN_T,
  KICAD_T.SCH_ITEM_LOCATE_WIRE_T,
  KICAD_T.SCH_ITEM_LOCATE_BUS_T,
  KICAD_T.SCH_BUS_WIRE_ENTRY_T,
  KICAD_T.SCH_BUS_BUS_ENTRY_T,
  KICAD_T.SCH_LABEL_T,
  KICAD_T.SCH_HIER_LABEL_T,
  KICAD_T.SCH_GLOBAL_LABEL_T,
  KICAD_T.SCH_SHEET_PIN_T,
  KICAD_T.SCH_DIRECTIVE_LABEL_T,
  KICAD_T.SCH_JUNCTION_T,
];

const connectedLineTypes: readonly KICAD_T[] = [
  KICAD_T.SCH_ITEM_LOCATE_WIRE_T,
  KICAD_T.SCH_ITEM_LOCATE_BUS_T,
];

const expandConnectionGraphTypes: readonly KICAD_T[] = [
  KICAD_T.SCH_NO_CONNECT_T,
  KICAD_T.SCH_SYMBOL_T,
  KICAD_T.SCH_SYMBOL_LOCATE_POWER_T,
  KICAD_T.SCH_PIN_T,
  KICAD_T.SCH_ITEM_LOCATE_WIRE_T,
  KICAD_T.SCH_ITEM_LOCATE_BUS_T,
  KICAD_T.SCH_BUS_WIRE_ENTRY_T,
  KICAD_T.SCH_BUS_BUS_ENTRY_T,
  KICAD_T.SCH_LABEL_T,
  KICAD_T.SCH_HIER_LABEL_T,
  KICAD_T.SCH_GLOBAL_LABEL_T,
  KICAD_T.SCH_SHEET_PIN_T,
  KICAD_T.SCH_DIRECTIVE_LABEL_T,
  KICAD_T.SCH_JUNCTION_T,
  KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T,
  KICAD_T.SCH_SHAPE_T,
];

const crossProbingTypes: readonly KICAD_T[] = [
  KICAD_T.SCH_SYMBOL_T,
  KICAD_T.SCH_PIN_T,
  KICAD_T.SCH_SHEET_T,
];

const lineTypes: readonly KICAD_T[] = [KICAD_T.SCH_LINE_T];
const sheetTypes: readonly KICAD_T[] = [KICAD_T.SCH_SHEET_T];
const tableCellTypes: readonly KICAD_T[] = [KICAD_T.SCH_TABLECELL_T];

// Some navigation actions are allowed in selectMultiple
const allowedActions: readonly TOOL_ACTION[] = [
  ACTIONS.panUp,
  ACTIONS.panDown,
  ACTIONS.panLeft,
  ACTIONS.panRight,
  ACTIONS.cursorUp,
  ACTIONS.cursorDown,
  ACTIONS.cursorLeft,
  ACTIONS.cursorRight,
  ACTIONS.cursorUpFast,
  ACTIONS.cursorDownFast,
  ACTIONS.cursorLeftFast,
  ACTIONS.cursorRightFast,
  ACTIONS.zoomIn,
  ACTIONS.zoomOut,
  ACTIONS.zoomInCenter,
  ACTIONS.zoomOutCenter,
  ACTIONS.zoomCenter,
  ACTIONS.zoomFitScreen,
  ACTIONS.zoomFitObjects,
];

enum STOP_CONDITION {
  STOP_AT_JUNCTION, ///< Stop at the first junction, label, or pin reached
  STOP_AT_PIN, ///< Walk through junctions and labels but stop at pins
  STOP_NEVER, ///< Walk the entire connected sub-net
}

/** `VECTOR2I` as a std::set key (x then y, KiCad's std::less<VECTOR2I>). */
const pointKey = (p: VECTOR2I): string => `${p.x},${p.y}`;

const samePoint = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

export class SCH_SELECTION_TOOL extends SELECTION_TOOL {
  private m_frame: SCH_BASE_FRAME | null = null; // Pointer to the parent frame
  private m_selection = new SCH_SELECTION(); // Current state of selection

  private m_nonModifiedCursor: KICURSOR = KICURSOR.ARROW; // Cursor in the absence of shift/ctrl/alt

  private m_isSymbolEditor = false; // True when the symbol editor is the parent frame
  private m_isSymbolViewer = false; // True when the symbol browser is the parent frame
  private m_unit = 0; // Fixed unit filter (for symbol editor)
  private m_bodyStyle = 0; // Fixed DeMorgan filter (for symbol editor)

  private m_enteredGroup: SCH_GROUP | null = null; // If non-null, selections are limited to
  // members of this group
  private m_enteredGroupOverlay = new VIEW_GROUP(); // Overlay for the entered group's frame.

  private m_filter = new SCH_SELECTION_FILTER_OPTIONS();

  private m_selectionMode: SELECTION_MODE = SELECTION_MODE.INSIDE_RECTANGLE; // Current selection mode

  private m_previous_first_cell: SCH_TABLECELL | null = null; // First selected cell for shift+click selection range

  /** No clarification menu can be shown: a synchronous RequestSelection (see the file comment). */
  private m_menuBlocked = false;

  constructor() {
    super('common.InteractiveSelection');
    this.m_filter.SetDefaults();
    this.m_selection.Clear();
  }

  /** `~SCH_SELECTION_TOOL`. */
  Destroy(): void {
    this.getView()?.Remove(this.m_selection);
    this.getView()?.Remove(this.m_enteredGroupOverlay);
  }

  override Init(): boolean {
    this.m_frame = this.getEditFrame<SCH_BASE_FRAME>();

    const symbolViewerFrame = this.m_frame.IsType(FRAME_T.FRAME_SCH_VIEWER);
    const symbolEditorFrame = this.m_frame instanceof SYMBOL_EDIT_FRAME ? this.m_frame : null;

    if (symbolEditorFrame) {
      this.m_isSymbolEditor = true;
      this.m_unit = symbolEditorFrame.GetUnit();
      this.m_bodyStyle = symbolEditorFrame.GetBodyStyle();
    } else {
      this.m_isSymbolViewer = symbolViewerFrame;
    }

    const C = SCH_CONDITIONS;
    const linesSelection = And(C.MoreThan(0), C.OnlyTypes(lineTypes));
    const wireOrBusSelection = And(C.Count(1), C.OnlyTypes(connectedLineTypes));
    const connectedSelection = And(C.MoreThan(0), C.OnlyTypes(connectedTypes));
    const expandableSelection = And(C.MoreThan(0), C.HasTypes(expandConnectionGraphTypes));
    const sheetSelection = And(C.Count(1), C.OnlyTypes(sheetTypes));
    const crossProbingSelection = And(C.MoreThan(0), C.HasTypes(crossProbingTypes));
    const tableCellSelection = And(C.MoreThan(0), C.OnlyTypes(tableCellTypes));
    const multiplePinsSelection = And(C.MoreThan(1), C.OnlyTypes([KICAD_T.SCH_PIN_T]));

    const schEditSheetPageNumberCondition: SELECTION_CONDITION = (aSel) => {
      if (this.m_isSymbolEditor || this.m_isSymbolViewer) return false;

      return C.LessThan(2)(aSel) && C.OnlyTypes(sheetTypes)(aSel);
    };

    const schEditCondition: SELECTION_CONDITION = () =>
      !this.m_isSymbolEditor && !this.m_isSymbolViewer;

    const belowRootSheetCondition: SELECTION_CONDITION = () => {
      const editFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

      return !!editFrame && editFrame.GetCurrentSheet().Last() !== editFrame.Schematic().Root();
    };

    const haveHighlight: SELECTION_CONDITION = () => {
      const editFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

      return !!editFrame && editFrame.GetHighlightedConnection() !== '';
    };

    const haveSymbol: SELECTION_CONDITION = () =>
      this.m_isSymbolEditor && !!(this.m_frame as unknown as SYMBOL_EDIT_FRAME).GetCurSymbol();

    const groupEnterCondition = And(
      SELECTION_CONDITIONS.Count(1),
      SELECTION_CONDITIONS.HasType(KICAD_T.SCH_GROUP_T),
    );

    const inGroupCondition: SELECTION_CONDITION = () => this.m_enteredGroup !== null;

    const multipleUnitsSelection: SELECTION_CONDITION = (aSel) =>
      GetSameSymbolMultiUnitSelection(aSel).length > 0;

    const allowPinSwaps: SELECTION_CONDITION = () =>
      !!this.m_frame!.eeconfig() && this.m_frame!.eeconfig()!.input.allow_unconstrained_pin_swaps;

    const menu = this.m_menu.GetMenu();

    const idle = C.Idle;
    // clang-format off
    menu.AddItem(ACTIONS.groupEnter, groupEnterCondition, 1);
    menu.AddItem(ACTIONS.groupLeave, inGroupCondition, 1);
    menu.AddItem(SCH_ACTIONS.placeLinkedDesignBlock, groupEnterCondition, 1);
    menu.AddItem(SCH_ACTIONS.saveToLinkedDesignBlock, groupEnterCondition, 1);
    menu.AddItem(SCH_ACTIONS.clearHighlight, And(haveHighlight, idle), 1);
    menu.AddSeparator(1); // AddSeparator( haveHighlight && SCH_CONDITIONS::Idle, 1 )

    menu.AddItem(SCH_ACTIONS.selectConnection, And(expandableSelection, idle), 2);
    menu.AddItem(ACTIONS.selectColumns, And(tableCellSelection, idle), 2);
    menu.AddItem(ACTIONS.selectRows, And(tableCellSelection, idle), 2);
    menu.AddItem(ACTIONS.selectTable, And(tableCellSelection, idle), 2);

    menu.AddSeparator(100);
    menu.AddItem(SCH_ACTIONS.drawWire, And(schEditCondition, C.Empty), 100);
    menu.AddItem(SCH_ACTIONS.drawBus, And(schEditCondition, C.Empty), 100);

    menu.AddSeparator(100);
    // ACTIONS::finishInteractive on SCH_LINE_WIRE_BUS_TOOL::IsDrawingLineWireOrBus: arrives with
    // that tool.

    menu.AddItem(SCH_ACTIONS.enterSheet, And(sheetSelection, idle), 150);
    menu.AddItem(
      SCH_ACTIONS.selectOnPCB,
      And(And(crossProbingSelection, schEditCondition), idle),
      150,
    );
    menu.AddItem(SCH_ACTIONS.leaveSheet, belowRootSheetCondition, 150);

    menu.AddSeparator(200);
    menu.AddItem(SCH_ACTIONS.placeJunction, And(wireOrBusSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.placeLabel, And(wireOrBusSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.placeClassLabel, And(wireOrBusSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.placeGlobalLabel, And(wireOrBusSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.placeHierLabel, And(wireOrBusSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.breakWire, And(linesSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.slice, And(linesSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.placeSheetPin, And(sheetSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.autoplaceAllSheetPins, And(sheetSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.syncSheetPins, And(sheetSelection, idle), 250);
    menu.AddItem(
      SCH_ACTIONS.swapPinLabels,
      And(And(multiplePinsSelection, schEditCondition), idle),
      250,
    );
    menu.AddItem(
      SCH_ACTIONS.swapUnitLabels,
      And(And(multipleUnitsSelection, schEditCondition), idle),
      250,
    );
    menu.AddItem(
      SCH_ACTIONS.swapPins,
      And(And(And(multiplePinsSelection, schEditCondition), idle), allowPinSwaps),
      250,
    );
    menu.AddItem(SCH_ACTIONS.assignNetclass, And(connectedSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.findNetInInspector, And(connectedSelection, idle), 250);
    menu.AddItem(SCH_ACTIONS.editPageNumber, schEditSheetPageNumberCondition, 250);

    menu.AddSeparator(400);
    menu.AddItem(SCH_ACTIONS.symbolProperties, And(haveSymbol, C.Empty), 400);
    menu.AddItem(SCH_ACTIONS.pinTable, And(haveSymbol, C.Empty), 400);

    menu.AddSeparator(1000);
    this.m_frame.AddStandardSubMenus(this.m_menu);
    // clang-format on

    // m_disambiguateTimer: SELECTION_TOOL's, firing onDisambiguationExpire.
    void Or;

    return true;
  }

  override Reset(aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<SCH_BASE_FRAME>();

    if (aReason !== RESET_REASON.REDRAW) {
      if (this.m_enteredGroup) this.ExitGroup();

      // Remove pointers to the selected items from containers without changing their
      // properties (as they are already deleted while a new sheet is loaded)
      this.m_selection.Clear();
    }

    if (aReason === RESET_REASON.SHUTDOWN) return;

    if (aReason === RESET_REASON.MODEL_RELOAD || aReason === RESET_REASON.SUPERMODEL_RELOAD) {
      this.getView()!.GetPainter()?.GetSettings().SetHighlight(false);

      const symbolEditFrame = this.m_frame instanceof SYMBOL_EDIT_FRAME ? this.m_frame : null;
      const symbolViewerFrame = this.m_frame.IsType(FRAME_T.FRAME_SCH_VIEWER);

      if (symbolEditFrame) {
        this.m_isSymbolEditor = true;
        this.m_unit = symbolEditFrame.GetUnit();
        this.m_bodyStyle = symbolEditFrame.GetBodyStyle();
      } else {
        this.m_isSymbolViewer = symbolViewerFrame;
      }
    }

    // Reinsert the VIEW_GROUP, in case it was removed from the VIEW
    this.getView()!.Remove(this.m_selection);
    this.getView()!.Add(this.m_selection);

    this.getView()!.Remove(this.m_enteredGroupOverlay);
    this.getView()!.Add(this.m_enteredGroupOverlay);
  }

  *Main(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);

    let lastRolloverItemId: KIID = niluuid;
    const grid = new EE_GRID_HELPER(this.m_toolMgr);

    const pinOrientation = (aItem: EDA_ITEM): PIN_ORIENTATION => {
      const pin = aItem instanceof SCH_PIN ? aItem : null;

      if (pin) {
        const parent =
          pin.GetParentSymbol() instanceof SCH_SYMBOL
            ? (pin.GetParentSymbol() as SCH_SYMBOL)
            : null;

        if (!parent) {
          return pin.GetOrientation();
        } else {
          const dummy = pin.Clone() as SCH_PIN;
          RotateAndMirrorPin(dummy, parent.GetOrientation());
          return dummy.GetOrientation();
        }
      }

      const sheetPin = aItem instanceof SCH_SHEET_PIN ? aItem : null;

      if (sheetPin) {
        switch (sheetPin.GetSide()) {
          case SHEET_SIDE.RIGHT:
            return PIN_ORIENTATION.PIN_LEFT;
          case SHEET_SIDE.TOP:
            return PIN_ORIENTATION.PIN_DOWN;
          case SHEET_SIDE.BOTTOM:
            return PIN_ORIENTATION.PIN_UP;
          default:
            return PIN_ORIENTATION.PIN_RIGHT;
        }
      }

      return PIN_ORIENTATION.PIN_LEFT;
    };

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      let selCancelled = false;
      let displayWireCursor = false;
      let displayBusCursor = false;
      let displayLineCursor = false;
      let rolloverItemId: KIID = lastRolloverItemId;

      // on left click, a selection is made, depending on modifiers ALT, SHIFT, CTRL:
      this.setModifiersState(
        evt.Modifier(MD_SHIFT) !== 0,
        evt.Modifier(MD_CTRL) !== 0,
        evt.Modifier(MD_ALT) !== 0,
      );

      const drag_action = this.m_frame!.GetDragAction();

      if (evt.IsMouseDown(BUT_LEFT)) {
        if (!this.m_frame!.ToolStackIsEmpty()) {
          // Avoid triggering when running under other tools
        } else if (this.pointEditorHasPoint()) {
          // Distinguish point editor from selection modification by checking modifiers
          if (this.hasModifier()) {
            this.m_originalCursor = this.m_toolMgr!.GetMousePosition();
            this.m_disambiguateTimer.StartOnce(ADVANCED_CFG.GetCfg().m_DisambiguationMenuDelay);
          }
        } else {
          this.m_originalCursor = this.m_toolMgr!.GetMousePosition();
          this.m_disambiguateTimer.StartOnce(ADVANCED_CFG.GetCfg().m_DisambiguationMenuDelay);
        }
      }
      // Single click? Select single object
      else if (evt.IsClick(BUT_LEFT)) {
        // If the timer has stopped, then we have already run the disambiguate routine
        // and we don't want to register an extra click here
        if (!this.m_disambiguateTimer.IsRunning()) {
          evt.SetPassEvent();
          continue;
        }

        this.m_disambiguateTimer.Stop();

        if (this.m_frame instanceof SCH_EDIT_FRAME) this.m_frame.ClearFocus();

        // Collect items at the clicked location (doesn't select them yet)
        const collector = new SCH_COLLECTOR();
        const rejected = new SCH_SELECTION_FILTER_OPTIONS();

        this.CollectHits(collector, evt.Position());
        const preFilterCount = collector.GetCount();
        rejected.SetAll(false);
        this.narrowSelection(collector, evt.Position(), false, false, rejected);

        if (
          this.m_selection.GetSize() !== 0 &&
          this.m_selection.at(0) instanceof SCH_TABLECELL &&
          this.m_additive &&
          collector.GetCount() === 1 &&
          collector.At(0) instanceof SCH_TABLECELL
        ) {
          const firstCell = this.m_selection.at(0) as SCH_TABLECELL;
          const clickedCell = collector.At(0) as SCH_TABLECELL;
          let allCellsFromSameTable = true;

          if (this.m_previous_first_cell === null || this.m_selection.GetSize() === 1) {
            this.m_previous_first_cell = firstCell;
          }

          for (const selection of this.m_selection.GetItems()) {
            if (!selection || selection.GetParent() !== clickedCell.GetParent()) {
              allCellsFromSameTable = false;
            }
          }

          if (this.m_previous_first_cell && clickedCell && allCellsFromSameTable) {
            for (const selection of this.m_selection.GetItems()) selection.ClearSelected();

            this.m_selection.Clear();
            const parentTable =
              this.m_previous_first_cell.GetParent() instanceof SCH_TABLE
                ? (this.m_previous_first_cell.GetParent() as SCH_TABLE)
                : null;

            const start = this.m_previous_first_cell.GetCenter();
            const end = clickedCell.GetCenter();

            if (parentTable) {
              this.InitializeSelectionState(parentTable);

              const topLeft = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
              const bottomRight = { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) };

              this.SelectCellsBetween(
                topLeft,
                { x: bottomRight.x - topLeft.x, y: bottomRight.y - topLeft.y },
                parentTable,
              );
            }
          }
        } else if (collector.GetCount() === 1 && !this.m_isSymbolEditor && !this.hasModifier()) {
          const autostart = this.autostartEvent(evt, grid, collector.At(0)!);

          if (autostart) {
            const source = autostart.Parameter<DRAW_SEGMENT_EVENT_PARAMS>();
            const params: DRAW_SEGMENT_EVENT_PARAMS = {
              layer: source.layer,
              quitOnDraw: true,
              sourceSegment:
                collector.At(0) instanceof SCH_LINE ? (collector.At(0) as SCH_LINE) : null,
            };

            autostart.SetParameter<DRAW_SEGMENT_EVENT_PARAMS>(params);
            this.m_toolMgr!.ProcessEvent(autostart);

            selCancelled = true;
          } else if (collector.At(0)!.HasHoveredHypertext()) {
            collector.At(0)!.DoHypertextAction(this.m_frame!, evt.Position());
            selCancelled = true;
          } else if (collector.At(0)!.IsBrightened()) {
            if (this.m_frame instanceof SCH_EDIT_FRAME) {
              // NET_NAVIGATOR_ITEM_DATA itemData( schframe->GetCurrentSheet(), collector[0] );
              // schframe->SelectNetNavigatorItem( &itemData ): the net navigator is the window's.
              const navigate = (
                this.m_frame as unknown as {
                  SelectNetNavigatorItem?(aSheet: SCH_SHEET_PATH, aItem: SCH_ITEM): void;
                }
              ).SelectNetNavigatorItem;
              navigate?.call(this.m_frame, this.m_frame.GetCurrentSheet(), collector.At(0)!);
            }
          }
        }

        if (!selCancelled) {
          if (collector.GetCount() === 0 && preFilterCount > 0)
            this.m_frame!.HighlightSelectionFilter(rejected);

          yield* this.selectPoint(
            collector,
            evt.Position(),
            null,
            null,
            this.m_additive,
            this.m_subtractive,
            this.m_exclusive_or,
          );
          this.m_selection.SetIsHover(false);
        }
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_disambiguateTimer.Stop();

        const cancelled = { value: false };

        // right click? if there is any object - show the context menu
        if (this.m_selection.Empty()) {
          this.ClearSelection();
          yield* this.SelectPoint(evt.Position(), [KICAD_T.SCH_LOCATE_ANY_T], null, cancelled);
          this.m_selection.SetIsHover(true);
        }
        // If the cursor has moved off the bounding box of the selection by more than
        // a grid square, check to see if there is another item available for selection
        // under the cursor.  If there is, the user likely meant to get the context menu
        // for that item.  If there is no new item, then keep the original selection and
        // show the context menu for it.
        else if (
          !this.m_selection
            .GetBoundingBox()
            .Inflate(grid.GetGrid().x, grid.GetGrid().y)
            .Contains(evt.Position())
        ) {
          const collector = new SCH_COLLECTOR();

          if (this.CollectHits(collector, evt.Position(), [KICAD_T.SCH_LOCATE_ANY_T])) {
            this.ClearSelection();

            yield* this.SelectPoint(evt.Position(), [KICAD_T.SCH_LOCATE_ANY_T], null, cancelled);
            this.m_selection.SetIsHover(true);
          }
        }

        selCancelled = cancelled.value;

        if (!selCancelled) this.m_menu.ShowContextMenu(this.m_selection);
      } else if (evt.IsDblClick(BUT_LEFT)) {
        this.m_disambiguateTimer.Stop();

        // double click? Display the properties window
        if (this.m_frame instanceof SCH_EDIT_FRAME) this.m_frame.ClearFocus();

        if (this.m_selection.Empty()) yield* this.SelectPoint(evt.Position());

        const item = this.m_selection.Front();

        if (item && item.Type() === KICAD_T.SCH_SHEET_T)
          this.m_toolMgr!.PostAction(SCH_ACTIONS.enterSheet);
        else if (
          this.m_selection.GetSize() === 1 &&
          this.m_selection.at(0)!.Type() === KICAD_T.SCH_GROUP_T
        )
          this.EnterGroup();
        else this.m_toolMgr!.PostAction(SCH_ACTIONS.properties);
      } else if (evt.IsDblClick(BUT_MIDDLE)) {
        this.m_disambiguateTimer.Stop();

        // Middle double click?  Do zoom to fit or zoom to objects
        if (evt.Modifier(MD_CTRL))
          // Is CTRL key down?
          this.m_toolMgr!.RunAction(ACTIONS.zoomFitObjects);
        else this.m_toolMgr!.RunAction(ACTIONS.zoomFitScreen);
      } else if (evt.IsDrag(BUT_LEFT)) {
        this.m_disambiguateTimer.Stop();

        // Is another tool already moving a new object?  Don't allow a drag start
        if (!this.m_selection.Empty() && this.m_selection.at(0)!.HasFlag(IS_NEW | IS_MOVING)) {
          evt.SetPassEvent();
          continue;
        }

        // drag with LMB? Select multiple objects (or at least draw a selection box) or
        // drag them
        if (this.m_frame instanceof SCH_EDIT_FRAME) this.m_frame.ClearFocus();

        const collector = new SCH_COLLECTOR();
        const lasso =
          this.m_selectionMode === SELECTION_MODE.INSIDE_LASSO ||
          this.m_selectionMode === SELECTION_MODE.TOUCHING_LASSO;

        if (
          this.m_selection.GetSize() === 1 &&
          this.m_selection.at(0) instanceof SCH_TABLE &&
          evt.HasPosition() &&
          this.selectionContains(evt.DragOrigin())
        ) {
          this.m_toolMgr!.RunAction(SCH_ACTIONS.move);
        }
        // Allow drag selecting table cells, except when the table is already selected
        // or inside a group that we haven't entered
        else if (
          this.CollectHits(collector, evt.DragOrigin(), [KICAD_T.SCH_TABLECELL_T]) &&
          !collector.At(0)!.GetParent()!.IsSelected() &&
          (collector.At(0)!.GetParent()!.GetParentGroup() === null ||
            collector.At(0)!.GetParent()!.GetParentGroup() === this.m_enteredGroup)
        ) {
          yield* this.selectTableCells(collector.At(0)!.GetParent() as SCH_TABLE);
        } else if (this.hasModifier() || drag_action === MOUSE_DRAG_ACTION.SELECT) {
          if (lasso) yield* this.selectLasso();
          else yield* this.selectMultiple();
        } else if (this.m_selection.Empty() && drag_action !== MOUSE_DRAG_ACTION.DRAG_ANY) {
          if (lasso) yield* this.selectLasso();
          else yield* this.selectMultiple();
        } else {
          if (this.m_isSymbolEditor) {
            if ((this.m_frame as unknown as SYMBOL_EDIT_FRAME).IsSymbolAlias()) {
              this.m_selection = this.RequestSelection([KICAD_T.SCH_FIELD_T]);
            } else {
              this.m_selection = this.RequestSelection([
                KICAD_T.SCH_SHAPE_T,
                KICAD_T.SCH_TEXT_T,
                KICAD_T.SCH_TEXTBOX_T,
                KICAD_T.SCH_PIN_T,
                KICAD_T.SCH_FIELD_T,
              ]);
            }
          } else {
            this.m_selection = this.RequestSelection(SCH_COLLECTOR.MovableItems);
          }

          // Check if dragging has started within any of selected items bounding box
          if (evt.HasPosition() && this.selectionContains(evt.DragOrigin())) {
            // drag_is_move option exists only in schematic editor, not in symbol editor
            // (m_frame->eeconfig() returns nullptr in Symbol Editor)
            if (this.m_isSymbolEditor || this.m_frame!.eeconfig()!.input.drag_is_move)
              this.m_toolMgr!.RunAction(SCH_ACTIONS.move);
            else this.m_toolMgr!.RunAction(SCH_ACTIONS.drag);
          } else {
            // No -> drag a selection box
            if (lasso) yield* this.selectLasso();
            else yield* this.selectMultiple();
          }
        }
      } else if (evt.IsMouseDown(BUT_AUX1)) {
        this.m_toolMgr!.RunAction(SCH_ACTIONS.navigateBack);
      } else if (evt.IsMouseDown(BUT_AUX2)) {
        this.m_toolMgr!.RunAction(SCH_ACTIONS.navigateForward);
      } else if (evt.Action() === TA_MOUSE_WHEEL) {
        let field = -1;

        if (evt.Modifier() === (MD_SHIFT | MD_ALT)) field = 0;
        else if (evt.Modifier() === (MD_CTRL | MD_ALT)) field = 1;
        // any more?

        if (field >= 0) {
          const delta = evt.Parameter<number>();
          const incParams: INCREMENT = { Delta: delta > 0 ? 1 : -1, Index: field };

          this.m_toolMgr!.RunAction(ACTIONS.increment, incParams);
        }
      } else if (evt.Category() === TC_COMMAND && evt.Action() === TA_CHOICE_MENU_CHOICE) {
        this.m_disambiguateTimer.Stop();
        this.contextMenuChoice(evt, grid, pinOrientation);
      } else if (evt.IsCancelInteractive()) {
        this.m_disambiguateTimer.Stop();

        // We didn't set these, but we have reports that they leak out of some other tools,
        // so we clear them here.
        this.controls().SetAutoPan(false);
        this.controls().CaptureCursor(false);

        if (this.m_frame instanceof SCH_EDIT_FRAME) this.m_frame.ClearFocus();

        if (!this.GetSelection().Empty()) {
          this.ClearSelection();
        } else if (evt.FirstResponder() === this && evt.GetCommandId() === WXK.WXK_ESCAPE) {
          if (this.m_enteredGroup) {
            this.ExitGroup();
          } else {
            const editor = this.m_toolMgr!.FindTool('eeschema.EditorControl') as unknown as {
              ClearHighlight?(aEvent: TOOL_EVENT): number;
            } | null;

            if (editor?.ClearHighlight && this.m_frame!.eeconfig()!.input.esc_clears_net_highlight)
              editor.ClearHighlight(evt);
          }
        }
      } else if (evt.Action() === TA_UNDO_REDO_PRE) {
        if (this.m_frame instanceof SCH_EDIT_FRAME) this.m_frame.ClearFocus();
      } else if (evt.IsMotion() && !this.m_isSymbolEditor && evt.FirstResponder() === this) {
        // Update cursor and rollover item
        rolloverItemId = niluuid;
        const collector = new SCH_COLLECTOR();

        this.controls().ForceCursorPosition(false);

        if (this.CollectHits(collector, evt.Position())) {
          this.narrowSelection(collector, evt.Position(), false, false, null);

          if (collector.GetCount() === 1 && !this.hasModifier()) {
            const autostartEvt = this.autostartEvent(evt, grid, collector.At(0)!);

            if (autostartEvt) {
              if (autostartEvt.Matches(SCH_ACTIONS.drawBus.MakeEvent())) displayBusCursor = true;
              else if (autostartEvt.Matches(SCH_ACTIONS.drawWire.MakeEvent()))
                displayWireCursor = true;
              else if (autostartEvt.Matches(SCH_ACTIONS.drawLines.MakeEvent()))
                displayLineCursor = true;
            } else if (collector.At(0)!.HasHypertext() && !collector.At(0)!.IsSelected()) {
              rolloverItemId = collector.At(0)!.m_Uuid;
            }
          }
        }
      } else {
        evt.SetPassEvent();
      }

      if (lastRolloverItemId !== niluuid && lastRolloverItemId !== rolloverItemId) {
        const item = this.m_frame!.ResolveItem(lastRolloverItemId);

        if (item) {
          item.SetIsRollover(false, { x: 0, y: 0 });

          if (item.Type() === KICAD_T.SCH_FIELD_T || item.Type() === KICAD_T.SCH_TABLECELL_T)
            this.m_frame!.GetCanvas()!.GetView().Update(item.GetParent()!);
          else this.m_frame!.GetCanvas()!.GetView().Update(item);
        }
      }

      let rolloverItem: SCH_ITEM | null = null;

      if (rolloverItemId !== niluuid) {
        rolloverItem = this.m_frame!.ResolveItem(rolloverItemId) as SCH_ITEM | null;

        if (rolloverItem) {
          rolloverItem.SetIsRollover(true, this.controls().GetMousePosition());

          if (
            rolloverItem.Type() === KICAD_T.SCH_FIELD_T ||
            rolloverItem.Type() === KICAD_T.SCH_TABLECELL_T
          )
            this.m_frame!.GetCanvas()!.GetView().Update(rolloverItem.GetParent()!);
          else this.m_frame!.GetCanvas()!.GetView().Update(rolloverItem);
        }
      }

      lastRolloverItemId = rolloverItemId;

      if (this.m_frame!.ToolStackIsEmpty()) {
        if (displayWireCursor) {
          this.m_nonModifiedCursor = KICURSOR.LINE_WIRE;
        } else if (displayBusCursor) {
          this.m_nonModifiedCursor = KICURSOR.LINE_BUS;
        } else if (displayLineCursor) {
          this.m_nonModifiedCursor = KICURSOR.LINE_GRAPHIC;
        } else if (rolloverItem?.HasHoveredHypertext()) {
          this.m_nonModifiedCursor = KICURSOR.HAND;
        } else if (
          !this.m_selection.Empty() &&
          drag_action === MOUSE_DRAG_ACTION.DRAG_SELECTED &&
          evt.HasPosition() &&
          this.selectionContains(evt.Position()) //move/drag option prediction
        ) {
          this.m_nonModifiedCursor = KICURSOR.MOVING;
        } else {
          this.m_nonModifiedCursor = KICURSOR.ARROW;
        }
      }
    }

    this.m_disambiguateTimer.Stop();

    // Shutting down; clear the selection
    this.m_selection.Clear();

    return 0;
  }

  /** `getViewControls()`, with the VIEW_CONTROLS methods the TOOL_MANAGER's interface leaves out. */
  protected controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /**
   * `m_toolMgr->GetTool<SCH_POINT_EDITOR>() && …->HasPoint()`. Found by name: the point editor
   * imports this tool's frame, so a value import would cycle.
   */
  private pointEditorHasPoint(): boolean {
    const pointEditor = this.m_toolMgr!.FindTool('eeschema.PointEditor') as SCH_POINT_EDITOR | null;

    return !!pointEditor?.HasPoint();
  }

  /** Main's TA_CHOICE_MENU_CHOICE branch: unit, body style, alternate function, pin tricks, bus unfold. */
  private contextMenuChoice(
    evt: TOOL_EVENT,
    grid: EE_GRID_HELPER,
    pinOrientation: (aItem: EDA_ITEM) => PIN_ORIENTATION,
  ): void {
    const id = evt.GetCommandId() ?? -1;
    const I = id_eeschema_frm;

    // context sub-menu selection?  Handle unit selection or bus unfolding
    if (id >= I.ID_POPUP_SCH_SELECT_UNIT && id <= I.ID_POPUP_SCH_SELECT_UNIT_END) {
      const symbol =
        this.m_selection.Front() instanceof SCH_SYMBOL
          ? (this.m_selection.Front() as SCH_SYMBOL)
          : null;
      const unit = id - I.ID_POPUP_SCH_SELECT_UNIT;

      if (symbol) (this.m_frame as SCH_EDIT_FRAME).SelectUnit(symbol, unit);
    } else if (id >= I.ID_POPUP_SCH_PLACE_UNIT && id <= I.ID_POPUP_SCH_PLACE_UNIT_END) {
      const symbol =
        this.m_selection.Front() instanceof SCH_SYMBOL
          ? (this.m_selection.Front() as SCH_SYMBOL)
          : null;
      const unit = id - I.ID_POPUP_SCH_PLACE_UNIT;

      if (symbol)
        this.m_toolMgr!.RunAction(SCH_ACTIONS.placeNextSymbolUnit, {
          m_Symbol: symbol,
          m_Unit: unit,
        });
    } else if (
      id >= I.ID_POPUP_SCH_SELECT_BODY_STYLE &&
      id <= I.ID_POPUP_SCH_SELECT_BODY_STYLE_END
    ) {
      const symbol =
        this.m_selection.Front() instanceof SCH_SYMBOL
          ? (this.m_selection.Front() as SCH_SYMBOL)
          : null;
      const bodyStyle = id - I.ID_POPUP_SCH_SELECT_BODY_STYLE + 1;

      if (symbol && symbol.GetBodyStyle() !== bodyStyle)
        (this.m_frame as SCH_EDIT_FRAME).SelectBodyStyle(symbol, bodyStyle);
    } else if (id >= I.ID_POPUP_SCH_ALT_PIN_FUNCTION && id <= I.ID_POPUP_SCH_ALT_PIN_FUNCTION_END) {
      const pin =
        this.m_selection.Front() instanceof SCH_PIN ? (this.m_selection.Front() as SCH_PIN) : null;
      const alt = evt.Parameter<string>();

      if (pin) (this.m_frame as SCH_EDIT_FRAME).SetAltPinFunction(pin, alt);
    } else if (
      id >= I.ID_POPUP_SCH_PIN_TRICKS_START &&
      id <= I.ID_POPUP_SCH_PIN_TRICKS_END &&
      !this.m_isSymbolEditor &&
      !this.m_isSymbolViewer
    ) {
      const sch_frame = this.m_frame as SCH_EDIT_FRAME;

      // Keep track of new items so we make them the new selection at the end
      const newItems: EDA_ITEM[] = [];
      const commit = new SCH_COMMIT(sch_frame);

      if (id === I.ID_POPUP_SCH_PIN_TRICKS_NO_CONNECT) {
        for (const item of this.m_selection.GetItems()) {
          if (item.Type() !== KICAD_T.SCH_PIN_T && item.Type() !== KICAD_T.SCH_SHEET_PIN_T)
            continue;

          const nc = new SCH_NO_CONNECT(item.GetPosition());
          commit.Add(nc, sch_frame.GetScreen());
          newItems.push(nc);
        }

        if (!commit.Empty()) {
          commit.Push('No Connect Pins');
          this.ClearSelection();
        }
      } else if (id === I.ID_POPUP_SCH_PIN_TRICKS_WIRE) {
        const wireGrid = grid.GetGridSize(GRID_HELPER_GRIDS.GRID_WIRES);

        for (const item of this.m_selection.GetItems()) {
          if (item.Type() !== KICAD_T.SCH_PIN_T && item.Type() !== KICAD_T.SCH_SHEET_PIN_T)
            continue;

          const wire = new SCH_LINE(item.GetPosition(), SCH_LAYER_ID.LAYER_WIRE);

          // Add some length to the wire as nothing in our code base handles
          // 0 length wires very well, least of all the ortho drag algorithm
          let stub: VECTOR2I;

          switch (pinOrientation(item)) {
            case PIN_ORIENTATION.PIN_LEFT:
              stub = { x: 1 * wireGrid.x, y: 0 };
              break;
            case PIN_ORIENTATION.PIN_UP:
              stub = { x: 0, y: 1 * wireGrid.y };
              break;
            case PIN_ORIENTATION.PIN_DOWN:
              stub = { x: 0, y: -1 * wireGrid.y };
              break;
            default:
              stub = { x: -1 * wireGrid.x, y: 0 };
              break;
          }

          wire.SetEndPoint({ x: item.GetPosition().x + stub.x, y: item.GetPosition().y + stub.y });

          this.m_frame!.AddToScreen(wire, sch_frame.GetScreen());
          commit.Added(wire, sch_frame.GetScreen());
          newItems.push(wire);
        }

        if (!commit.Empty()) {
          this.ClearSelection();
          this.AddItemsToSel(newItems);

          // Select only the ends so we can immediately start dragging them
          for (const item of newItems) (item as SCH_LINE).SetFlags(ENDPOINT);

          const vc = this.controls();

          // Put the mouse on the nearest point of the first wire
          const first = newItems[0] as SCH_LINE;
          vc.SetCrossHairCursorPosition(first.GetEndPoint(), false);
          vc.WarpMouseCursor(vc.GetCursorPosition(), true);

          // Start the drag tool, canceling will remove the wires
          if (this.m_toolMgr!.RunSynchronousAction(SCH_ACTIONS.drag, commit))
            commit.Push('Wire Pins');
          else commit.Revert();
        }
      } else {
        // For every pin in the selection, add a label according to menu item
        // selected by the user
        for (const item of this.m_selection.GetItems()) {
          const pin = item instanceof SCH_PIN ? item : null;
          const sheetPin = item instanceof SCH_SHEET_PIN ? item : null;
          let label: SCH_LABEL_BASE | null = null;
          const sheetPath = sch_frame.GetCurrentSheet();

          let labelText: string;

          if (pin) {
            labelText = pin.GetShownName();

            if (labelText === '')
              labelText = `${pin.GetParentSymbol()!.GetRef(sheetPath)}_${pin.GetNumber()}`;
          } else if (sheetPin) {
            labelText = sheetPin.GetShownText(sheetPath, false);
          } else {
            continue;
          }

          switch (id) {
            case I.ID_POPUP_SCH_PIN_TRICKS_NET_LABEL:
              label = new SCH_LABEL(item.GetPosition(), labelText);
              break;
            case I.ID_POPUP_SCH_PIN_TRICKS_HIER_LABEL:
              label = new SCH_HIERLABEL(item.GetPosition(), labelText);
              break;
            case I.ID_POPUP_SCH_PIN_TRICKS_GLOBAL_LABEL:
              label = new SCH_GLOBALLABEL(item.GetPosition(), labelText);
              break;
            default:
              continue;
          }

          switch (pinOrientation(item)) {
            case PIN_ORIENTATION.PIN_LEFT:
              label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
              break;
            case PIN_ORIENTATION.PIN_UP:
              label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.BOTTOM));
              break;
            case PIN_ORIENTATION.PIN_DOWN:
              label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.UP));
              break;
            default:
              label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.LEFT));
              break;
          }

          let pinType = ELECTRICAL_PINTYPE.PT_UNSPECIFIED;

          if (pin) {
            pinType = pin.GetType();
          } else if (sheetPin) {
            switch (sheetPin.GetLabelShape()) {
              case LABEL_SHAPE.LABEL_INPUT:
                pinType = ELECTRICAL_PINTYPE.PT_INPUT;
                break;
              case LABEL_SHAPE.LABEL_OUTPUT:
                pinType = ELECTRICAL_PINTYPE.PT_OUTPUT;
                break;
              case LABEL_SHAPE.LABEL_BIDI:
                pinType = ELECTRICAL_PINTYPE.PT_BIDI;
                break;
              case LABEL_SHAPE.LABEL_TRISTATE:
                pinType = ELECTRICAL_PINTYPE.PT_TRISTATE;
                break;
              case LABEL_SHAPE.LABEL_PASSIVE:
                pinType = ELECTRICAL_PINTYPE.PT_PASSIVE;
                break;
            }
          }

          switch (pinType) {
            case ELECTRICAL_PINTYPE.PT_BIDI:
              label.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
              break;
            case ELECTRICAL_PINTYPE.PT_INPUT:
              label.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
              break;
            case ELECTRICAL_PINTYPE.PT_OUTPUT:
              label.SetShape(LABEL_FLAG_SHAPE.L_OUTPUT);
              break;
            case ELECTRICAL_PINTYPE.PT_TRISTATE:
              label.SetShape(LABEL_FLAG_SHAPE.L_TRISTATE);
              break;
            case ELECTRICAL_PINTYPE.PT_UNSPECIFIED:
              label.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);
              break;
            default:
              label.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
          }

          commit.Add(label, sch_frame.GetScreen());
          newItems.push(label);
        }

        if (!commit.Empty()) {
          commit.Push('Label Pins');

          // Many users will want to drag these items to wire off of the pins, so
          // pre-select them.
          this.ClearSelection();
          this.AddItemsToSel(newItems);
        }
      }
    } else if (id >= I.ID_POPUP_SCH_UNFOLD_BUS && id <= I.ID_POPUP_SCH_UNFOLD_BUS_END) {
      const net = evt.Parameter<string>();
      this.m_toolMgr!.RunAction<string>(SCH_ACTIONS.unfoldBus, net);
    }
  }

  override EnterGroup(): void {
    if (
      !(this.m_selection.GetSize() === 1 && this.m_selection.at(0)!.Type() === KICAD_T.SCH_GROUP_T)
    ) {
      console.assert(false, 'EnterGroup called when selection is not a single group');
      return;
    }

    const aGroup = this.m_selection.at(0) as SCH_GROUP;

    if (this.m_enteredGroup !== null) this.ExitGroup();

    this.ClearSelection();
    this.m_enteredGroup = aGroup;
    this.m_enteredGroup.SetFlags(ENTERED);
    this.m_enteredGroup.RunOnChildren((aChild: SCH_ITEM) => {
      if (aChild.Type() === KICAD_T.SCH_LINE_T) aChild.SetFlags(STARTPOINT | ENDPOINT);

      this.select(aChild);
    }, RECURSE_MODE.NO_RECURSE);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    // Processing the selection event can re-enter the tool and ExitGroup(), which clears
    // m_enteredGroup. If that happened, don't operate on the now-stale (possibly null) group
    // or we would hide/overlay a null item and crash (issue #24778).
    if (this.m_enteredGroup !== aGroup) return;

    this.getView()!.Hide(this.m_enteredGroup, true);
    this.m_enteredGroupOverlay.Add(this.m_enteredGroup);
    this.getView()!.Update(this.m_enteredGroupOverlay);
  }

  override ExitGroup(aSelectGroup = false): void {
    // Only continue if there is a group entered
    if (this.m_enteredGroup === null) return;

    this.m_enteredGroup.ClearFlags(ENTERED);
    this.getView()!.Hide(this.m_enteredGroup, false);
    this.ClearSelection();

    if (aSelectGroup) {
      this.select(this.m_enteredGroup);
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    }

    this.m_enteredGroupOverlay.Clear();
    this.m_enteredGroup = null;
    this.getView()!.Update(this.m_enteredGroupOverlay);
  }

  GetEnteredGroup(): SCH_GROUP | null {
    return this.m_enteredGroup;
  }

  private autostartEvent(
    aEvent: TOOL_EVENT,
    aGrid: EE_GRID_HELPER,
    aItem: SCH_ITEM,
  ): OPT_TOOL_EVENT {
    const pos = aGrid.BestSnapAnchor(aEvent.Position(), aGrid.GetItemGrid(aItem));

    if (
      this.m_frame!.eeconfig()!.drawing.auto_start_wires &&
      !this.pointEditorHasPoint() &&
      aItem.IsPointClickableAnchor(pos)
    ) {
      let newEvt = SCH_ACTIONS.drawWire.MakeEvent();

      if (aItem.Type() === KICAD_T.SCH_BUS_BUS_ENTRY_T) {
        newEvt = SCH_ACTIONS.drawBus.MakeEvent();
      } else if (aItem.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T) {
        const busEntry = aItem as SCH_BUS_WIRE_ENTRY;

        if (!busEntry.m_connected_bus_item) newEvt = SCH_ACTIONS.drawBus.MakeEvent();
      } else if (aItem.Type() === KICAD_T.SCH_LINE_T) {
        const line = aItem as SCH_LINE;

        if (line.IsBus()) newEvt = SCH_ACTIONS.drawBus.MakeEvent();
        else if (line.IsGraphicLine()) newEvt = SCH_ACTIONS.drawLines.MakeEvent();
      } else if (
        aItem.Type() === KICAD_T.SCH_LABEL_T ||
        aItem.Type() === KICAD_T.SCH_HIER_LABEL_T ||
        aItem.Type() === KICAD_T.SCH_SHEET_PIN_T ||
        aItem.Type() === KICAD_T.SCH_GLOBAL_LABEL_T
      ) {
        const label = aItem as SCH_LABEL_BASE;
        const possibleConnection = new SCH_CONNECTION(label.Schematic()!.ConnectionGraph());
        possibleConnection.ConfigureFromLabel(label.GetShownText(false));

        if (possibleConnection.IsBus()) newEvt = SCH_ACTIONS.drawBus.MakeEvent();
      } else if (aItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = aItem as SCH_SYMBOL;
        const pin = symbol.GetPin(pos);

        if (!pin || !pin.IsPointClickableAnchor(pos)) return undefined;

        if (
          !pin.IsVisible() &&
          !(
            this.m_frame!.eeconfig()!.appearance.show_hidden_pins ||
            this.m_frame!.GetRenderSettings()!.m_ShowHiddenPins
          )
        ) {
          return undefined;
        }
      }

      newEvt.SetMousePosition(pos);
      newEvt.SetHasPosition(true);
      newEvt.SetForceImmediate(true);

      this.controls().ForceCursorPosition(true, pos);

      return newEvt;
    }

    return undefined;
  }

  private *disambiguateCursor(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const keyboardState = wxGetMouseState();

    this.setModifiersState(
      keyboardState.ShiftDown(),
      keyboardState.ControlDown(),
      keyboardState.AltDown(),
    );

    this.m_skip_heuristics = true;
    const cancelled = { value: false };
    yield* this.SelectPoint(
      this.m_originalCursor,
      [KICAD_T.SCH_LOCATE_ANY_T],
      null,
      cancelled,
      false,
      this.m_additive,
      this.m_subtractive,
      this.m_exclusive_or,
    );
    this.m_canceledMenu = cancelled.value;
    this.m_skip_heuristics = false;

    return 0;
  }

  OnIdle(): void {
    if (this.m_frame!.ToolStackIsEmpty() && !this.m_multiple) {
      const keyboardState = wxGetMouseState();

      this.setModifiersState(
        keyboardState.ShiftDown(),
        keyboardState.ControlDown(),
        keyboardState.AltDown(),
      );

      if (this.m_additive) this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ADD);
      else if (this.m_subtractive) this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.SUBTRACT);
      else if (this.m_exclusive_or) this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.XOR);
      else this.m_frame!.GetCanvas()!.SetCurrentCursor(this.m_nonModifiedCursor);
    }
  }

  override GetSelection(): SCH_SELECTION {
    return this.m_selection;
  }

  protected override selection(): SELECTION {
    return this.m_selection;
  }

  GetFilter(): SCH_SELECTION_FILTER_OPTIONS {
    return this.m_filter;
  }

  /** Collect the items at \a aWhere (unfiltered) into \a aCollector; true when any were found. */
  CollectHits(
    aCollector: SCH_COLLECTOR,
    aWhere: VECTOR2I,
    aScanTypes: readonly KICAD_T[] = [KICAD_T.SCH_LOCATE_ANY_T],
  ): boolean {
    // `const VECTOR2I& aWhere`: the event's VECTOR2D position is cast on the way in.
    aWhere = toVECTOR2I(aWhere);
    const pixelThreshold = KiROUND(this.getView()!.ToWorld(HITTEST_THRESHOLD_PIXELS) as number);
    const gs = this.getView()!.GetGAL()!.GetGridSize();
    const gridThreshold = KiROUND(Math.hypot(gs.x, gs.y) / 2.0);
    aCollector.m_Threshold = Math.max(pixelThreshold, gridThreshold);
    aCollector.m_ShowPinElectricalTypes =
      this.m_frame!.GetRenderSettings()!.m_ShowPinsElectricalType;

    if (this.m_isSymbolEditor) {
      const symbol = (this.m_frame as unknown as SYMBOL_EDIT_FRAME).GetCurSymbol();

      if (!symbol) return false;

      aCollector.Collect(symbol.GetDrawItems(), aScanTypes, aWhere, this.m_unit, this.m_bodyStyle);
    } else {
      aCollector.Collect(
        this.m_frame!.GetScreen(),
        aScanTypes,
        aWhere,
        this.m_unit,
        this.m_bodyStyle,
      );

      // If pins are disabled in the filter, they will be removed later.  Let's add the parent
      // so that people can use pins to select symbols in this case.
      if (!this.m_filter.pins) {
        const originalCount = aCollector.GetCount();

        for (let ii = 0; ii < originalCount; ++ii) {
          if (aCollector.At(ii)!.Type() === KICAD_T.SCH_PIN_T) {
            const pin = aCollector.At(ii) as SCH_PIN;

            if (!aCollector.HasItem(pin.GetParentSymbol()!))
              aCollector.Append(pin.GetParentSymbol()!);
          }
        }
      }
    }

    return aCollector.GetCount() > 0;
  }

  private narrowSelection(
    collector: SCH_COLLECTOR,
    aWhere: VECTOR2I,
    aCheckLocked: boolean,
    aSelectedOnly = false,
    aRejected: SCH_SELECTION_FILTER_OPTIONS | null = null,
  ): void {
    // `const VECTOR2I& aWhere`: the event's VECTOR2D position is cast on the way in.
    aWhere = toVECTOR2I(aWhere);
    const symbolEditorFrame = this.m_frame instanceof SYMBOL_EDIT_FRAME ? this.m_frame : null;

    for (let i = collector.GetCount() - 1; i >= 0; --i) {
      if (symbolEditorFrame) {
        // Do not select invisible items if they are not displayed
        const item = collector.At(i)!;

        if (item.Type() === KICAD_T.SCH_FIELD_T) {
          if (!(item as SCH_FIELD).IsVisible() && !symbolEditorFrame.GetShowInvisibleFields()) {
            collector.Remove(i);
            continue;
          }
        } else if (item.Type() === KICAD_T.SCH_PIN_T) {
          if (!(item as SCH_PIN).IsVisible() && !symbolEditorFrame.GetShowInvisiblePins()) {
            collector.Remove(i);
            continue;
          }
        }
      }

      if (!this.Selectable(collector.At(i)!, aWhere)) {
        collector.Remove(i);
        continue;
      }

      if (aCheckLocked && collector.At(i)!.IsLocked()) {
        if (aRejected) aRejected.lockedItems = true;
        collector.Remove(i);
        continue;
      }

      if (!this.itemPassesFilter(collector.At(i), aRejected)) {
        collector.Remove(i);
        continue;
      }

      if (aSelectedOnly && !collector.At(i)!.IsSelected()) {
        collector.Remove(i);
      }
    }

    this.FilterCollectorForHierarchy(collector, false);

    // Apply some ugly heuristics to avoid disambiguation menus whenever possible
    if (collector.GetCount() > 1 && !this.m_skip_heuristics)
      this.GuessSelectionCandidates(collector, aWhere);
  }

  private *selectPoint(
    aCollector: SCH_COLLECTOR,
    aWhere: VECTOR2I,
    aItem: { value: EDA_ITEM | null } | null = null,
    aSelectionCancelledFlag: { value: boolean } | null = null,
    aAdd = false,
    aSubtract = false,
    aExclusiveOr = false,
  ): COROUTINE_BODY<boolean> {
    // `const VECTOR2I& aWhere`: the event's VECTOR2D position is cast on the way in.
    aWhere = toVECTOR2I(aWhere);
    this.m_selection.ClearReferencePoint();

    // If still more than one item we're going to have to ask the user.
    if (aCollector.GetCount() > 1) {
      // The C++ asks through RunAction( ACTIONS::selectionMenu ) and falls back to
      // doSelectionMenu; the menu is this tool's own event loop here (see the file comment).
      if (this.m_menuBlocked) aCollector.m_MenuCancelled = true;
      else if (!(yield* this.doSelectionMenu(aCollector))) aCollector.m_MenuCancelled = true;

      if (aCollector.m_MenuCancelled) {
        if (aSelectionCancelledFlag) aSelectionCancelledFlag.value = true;

        return false;
      }
    }

    if (!aAdd && !aSubtract && !aExclusiveOr) this.ClearSelection();

    // It is possible for slop in the selection model to cause us to be outside the group,
    // but also selecting an item within the group, so only exit if the selection doesn't
    // have an item belonging to the group
    if (this.m_enteredGroup && !this.m_enteredGroup.GetBoundingBox().Contains(aWhere)) {
      let foundEnteredGroup = false;

      for (const item of aCollector) {
        if (item.GetParentGroup() === this.m_enteredGroup) {
          foundEnteredGroup = true;
          break;
        }
      }

      if (!foundEnteredGroup) this.ExitGroup();
    }

    this.FilterCollectorForHierarchy(aCollector, true);

    let addedCount = 0;
    let anySubtracted = false;

    if (aCollector.GetCount() > 0) {
      for (let i = 0; i < aCollector.GetCount(); ++i) {
        let flags = 0;
        const isLine = aCollector.At(i)!.Type() === KICAD_T.SCH_LINE_T;

        // Handle line ends specially
        if (isLine) {
          const line = aCollector.At(i) as SCH_LINE;
          const dist = (p: VECTOR2I) => Math.hypot(p.x - aWhere.x, p.y - aWhere.y);

          if (dist(line.GetStartPoint()) <= aCollector.m_Threshold) flags = STARTPOINT;
          else if (dist(line.GetEndPoint()) <= aCollector.m_Threshold) flags = ENDPOINT;
          else flags = STARTPOINT | ENDPOINT;
        }

        if (
          aSubtract ||
          (aExclusiveOr &&
            aCollector.At(i)!.IsSelected() &&
            (!isLine || (isLine && aCollector.At(i)!.HasFlag(flags))))
        ) {
          aCollector.At(i)!.ClearFlags(flags);

          // Need to update end shadows after ctrl-click unselecting one of two selected
          // endpoints.
          if (isLine) this.getView()!.Update(aCollector.At(i)!);

          if (!aCollector.At(i)!.HasFlag(STARTPOINT) && !aCollector.At(i)!.HasFlag(ENDPOINT)) {
            this.unselect(aCollector.At(i)!);
            anySubtracted = true;
          }
        } else {
          aCollector.At(i)!.SetFlags(flags);
          this.select(aCollector.At(i)!);
          addedCount++;
        }
      }
    }

    if (addedCount === 1) {
      this.m_toolMgr!.ProcessEvent(EVENTS.PointSelectedEvent);

      if (aItem && aCollector.GetCount() === 1) aItem.value = aCollector.At(0);

      return true;
    } else if (addedCount > 1) {
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
      return true;
    } else if (anySubtracted) {
      this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
      return true;
    }

    this.m_frame!.GetCanvas()!.ForceRefresh();
    return false;
  }

  /**
   * Select one item at \a aWhere (of \a aScanTypes), asking the user through the clarification
   * menu when it is ambiguous; \a aItem receives it, \a aSelectionCancelledFlag a cancelled menu.
   */
  *SelectPoint(
    aWhere: VECTOR2I,
    aScanTypes: readonly KICAD_T[] = [KICAD_T.SCH_LOCATE_ANY_T],
    aItem: { value: EDA_ITEM | null } | null = null,
    aSelectionCancelledFlag: { value: boolean } | null = null,
    aCheckLocked = false,
    aAdd = false,
    aSubtract = false,
    aExclusiveOr = false,
  ): COROUTINE_BODY<boolean> {
    // `const VECTOR2I& aWhere`: the event's VECTOR2D position is cast on the way in.
    aWhere = toVECTOR2I(aWhere);
    const collector = new SCH_COLLECTOR();

    if (!this.CollectHits(collector, aWhere, aScanTypes)) return false;

    const preFilterCount = collector.GetCount();
    const rejected = new SCH_SELECTION_FILTER_OPTIONS();
    rejected.SetAll(false);
    this.narrowSelection(collector, aWhere, aCheckLocked, aSubtract, rejected);

    if (collector.GetCount() === 0 && preFilterCount > 0) {
      this.m_frame!.HighlightSelectionFilter(rejected);

      if (!aAdd && !aSubtract && !aExclusiveOr && this.m_selection.GetSize() > 0) {
        this.ClearSelection(true /*quiet mode*/);
        this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
      }

      return false;
    }

    return yield* this.selectPoint(
      collector,
      aWhere,
      aItem,
      aSelectionCancelledFlag,
      aAdd,
      aSubtract,
      aExclusiveOr,
    );
  }

  /** {@link SelectPoint} for a synchronous caller: an ambiguous spot is a cancelled menu. */
  SelectPointNow(
    aWhere: VECTOR2I,
    aScanTypes: readonly KICAD_T[] = [KICAD_T.SCH_LOCATE_ANY_T],
    aItem: { value: EDA_ITEM | null } | null = null,
    aSelectionCancelledFlag: { value: boolean } | null = null,
  ): boolean {
    const blocked = this.m_menuBlocked;
    this.m_menuBlocked = true;

    try {
      const gen = this.SelectPoint(aWhere, aScanTypes, aItem, aSelectionCancelledFlag);
      const r = gen.next();

      // With the menu blocked nothing waits: the generator has finished.
      return r.done ? r.value : false;
    } finally {
      this.m_menuBlocked = blocked;
    }
  }

  /** Select all visible items in sheet. */
  SelectAll(_aEvent: TOOL_EVENT): number {
    const collection = new SCH_COLLECTOR();
    this.m_multiple = true; // Multiple selection mode is active
    const view = this.getView()!;

    const sheetPins: EDA_ITEM[] = [];

    // Filter the view items based on the selection box
    const selectionBox = new BOX2I();

    selectionBox.SetMaximum();
    view.Query(selectionBox, (viewItem) => {
      // `static_cast<SCH_ITEM*>( viewItem )`, then `if( !item )`: the view also holds the
      // selection group and the tools' preview groups, which are no SCH_ITEM - the cast is
      // undefined for them upstream; here they are skipped, as UnselectAll's dynamic_cast does.
      if (!(viewItem instanceof SCH_ITEM)) return true;

      collection.Append(viewItem);
      return true;
    });

    this.FilterCollectorForHierarchy(collection, true);

    // Sheet pins aren't in the view; add them by hand
    for (const item of collection) {
      const sheet = item instanceof SCH_SHEET ? item : null;

      if (sheet) {
        for (const pin of sheet.GetPins()) sheetPins.push(pin);
      }
    }

    for (const pin of sheetPins) collection.Append(pin);

    for (const item of collection) {
      if (this.Selectable(item) && this.itemPassesFilter(item, null)) {
        if (item.Type() === KICAD_T.SCH_LINE_T) item.SetFlags(STARTPOINT | ENDPOINT);

        this.select(item);
      }
    }

    this.m_multiple = false;

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    this.m_frame!.GetCanvas()!.ForceRefresh();
    return 0;
  }

  /** Unselect all visible items in sheet. */
  UnselectAll(_aEvent: TOOL_EVENT): number {
    this.m_multiple = true; // Multiple selection mode is active
    const view = this.getView()!;

    // hold all visible items
    const selectedItems: LAYER_ITEM_PAIR[] = [];

    // Filter the view items based on the selection box
    const selectionBox = new BOX2I();

    selectionBox.SetMaximum();
    view.Query(selectionBox, selectedItems); // Get the list of selected items

    for (const [viewItem] of selectedItems) {
      const sheet = viewItem instanceof SCH_SHEET ? viewItem : null;

      if (sheet) {
        for (const pin of sheet.GetPins()) {
          if (pin && this.Selectable(pin)) this.unselect(pin);
        }
      }

      if (viewItem instanceof SCH_ITEM) {
        if (this.Selectable(viewItem)) this.unselect(viewItem);
      }
    }

    this.m_multiple = false;

    this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
    this.m_frame!.GetCanvas()!.ForceRefresh();
    return 0;
  }

  /** Apply heuristics to try and determine a single object when multiple are found under the cursor. */
  GuessSelectionCandidates(collector: SCH_COLLECTOR, aPos: VECTOR2I): void {
    // `const VECTOR2I& aPos`: the event's VECTOR2D position is cast on the way in.
    aPos = toVECTOR2I(aPos);

    // Prefer exact hits to sloppy ones
    const exactHits = new Set<EDA_ITEM>();

    for (let i = collector.GetCount() - 1; i >= 0; --i) {
      const item = collector.At(i)!;
      const line = item instanceof SCH_LINE ? item : null;
      const shape = item instanceof SCH_SHAPE ? item : null;
      const table = item instanceof SCH_TABLE ? item : null;

      // Lines are hard to hit.  Give them a bit more slop to still be considered "exact".
      if (
        line ||
        (shape && shape.GetShape() === SHAPE_T.POLY) ||
        (shape && shape.GetShape() === SHAPE_T.ARC)
      ) {
        const pixelThreshold = KiROUND(this.getView()!.ToWorld(6) as number);

        if (item.HitTest(aPos, pixelThreshold)) exactHits.add(item);
      } else if (table) {
        // Consider table cells exact, but not the table itself
      } else {
        if (this.m_frame!.GetRenderSettings()!.m_ShowPinsElectricalType)
          item.SetFlags(SHOW_ELEC_TYPE);

        if (item.HitTest(aPos, 0)) exactHits.add(item);

        item.ClearFlags(SHOW_ELEC_TYPE);
      }
    }

    if (exactHits.size > 0 && exactHits.size < collector.GetCount()) {
      for (let i = collector.GetCount() - 1; i >= 0; --i) {
        const item = collector.At(i)!;

        if (!exactHits.has(item)) collector.Transfer(item);
      }
    }

    // Find the closest item.  (Note that at this point all hits are either exact or non-exact.)
    const poss = new SEG(aPos, aPos);
    let closest: EDA_ITEM | null = null;
    const INT_MAX_4 = Math.trunc(2147483647 / 4);
    let closestDist = INT_MAX_4;

    for (const item of collector) {
      let bbox = item.GetBoundingBox();
      const dist: OutInt = { value: INT_MAX_4 };

      // A dominating item is one that would unfairly win distance tests
      // and mask out other items. For example, a filled rectangle "wins"
      // with a zero distance over anything inside it.
      let dominating = false;

      if (exactHits.has(item)) {
        if (item.Type() === KICAD_T.SCH_PIN_T || item.Type() === KICAD_T.SCH_JUNCTION_T) {
          closest = item;
          break;
        }

        const line = item instanceof SCH_LINE ? item : null;
        const field = item instanceof SCH_FIELD ? item : null;
        const text = !field && item instanceof EDA_TEXT ? (item as unknown as EDA_TEXT) : null;
        const textOf = (item as unknown as { GetEffectiveTextShape?: unknown })
          .GetEffectiveTextShape
          ? (item as unknown as EDA_TEXT)
          : text;
        const shape =
          item instanceof EDA_SHAPE || item instanceof SCH_SHAPE
            ? (item as unknown as EDA_SHAPE)
            : null;
        const symbol = item instanceof SCH_SYMBOL ? item : null;

        if (line) {
          dist.value = line.GetSeg().Distance(aPos);
        } else if (field) {
          const box = field.GetBoundingBox();
          let orient = field.GetTextAngle();

          if (field.GetParent() && field.GetParent()!.Type() === KICAD_T.SCH_SYMBOL_T) {
            if ((field.GetParent() as SCH_SYMBOL).GetTransform().y1) {
              if (orient.IsHorizontal()) orient = ANGLE_VERTICAL;
              else orient = ANGLE_HORIZONTAL;
            }
          }

          field.GetEffectiveTextShape(false, box, orient).Collide(poss, INT_MAX_4, dist);
        } else if (textOf && !shape) {
          textOf.GetEffectiveTextShape(false).Collide(poss, INT_MAX_4, dist);
        } else if (shape) {
          const shapes = new SHAPE_COMPOUND(shape.MakeEffectiveShapesForHitTesting());

          shapes.Collide(poss, INT_MAX_4, dist);

          // Filled shapes win hit tests anywhere inside them
          dominating = shape.IsFilledForHitTesting();
        } else if (symbol) {
          bbox = symbol.GetBodyBoundingBox();

          const rect = new SHAPE_RECT(bbox.GetPosition(), bbox.GetWidth(), bbox.GetHeight());

          if (bbox.Contains(aPos)) {
            const c = bbox.GetCenter();
            dist.value = KiROUND(Math.hypot(c.x - aPos.x, c.y - aPos.y));
          } else rect.Collide(poss, closestDist, dist);
        } else {
          const c = bbox.GetCenter();
          dist.value = KiROUND(Math.hypot(c.x - aPos.x, c.y - aPos.y));
        }
      } else {
        const rect = new SHAPE_RECT(bbox.GetPosition(), bbox.GetWidth(), bbox.GetHeight());
        rect.Collide(poss, collector.m_Threshold, dist);
      }

      // Don't promote dominating items to be the closest item
      // (they'll always win) - they'll still be available for selection, but they
      // won't boot out worthy competitors.
      if (!dominating) {
        if (dist.value === closestDist) {
          if (item.GetParent() === closest) closest = item;
        } else if (dist.value < closestDist) {
          closestDist = dist.value;
          closest = item;
        }
      }
    }

    // Construct a tight box (1/2 height and width) around the center of the closest item.
    // All items which exist at least partly outside this box have sufficient other areas
    // for selection and can be dropped.
    if (closest) {
      // Don't try and get a tight bbox if nothing is near the mouse pointer
      const tightBox = closest.GetBoundingBox();
      tightBox.Inflate(-Math.trunc(tightBox.GetWidth() / 4), -Math.trunc(tightBox.GetHeight() / 4));

      for (let i = collector.GetCount() - 1; i >= 0; --i) {
        const item = collector.At(i)!;

        if (item === closest) continue;

        if (!item.HitTest(tightBox, true)) collector.Transfer(item);
      }
    }
  }

  /**
   * The current selection, or the item under the cursor when it is empty (a hover selection),
   * trimmed to \a aScanTypes; table cells promoted to their tables and groups to their members
   * when asked.
   */
  RequestSelection(
    aScanTypes: readonly KICAD_T[] = [KICAD_T.SCH_LOCATE_ANY_T],
    aPromoteCellSelections = false,
    aPromoteGroups = false,
  ): SCH_SELECTION {
    let anyUnselected = false;
    let anySelected = false;

    if (this.m_selection.Empty()) {
      const cursorPos = this.controls().GetCursorPosition(true);

      this.ClearSelection();
      this.SelectPointNow(cursorPos, aScanTypes);
      this.m_selection.SetIsHover(true);
      this.m_selection.ClearReferencePoint();
    } else {
      // Trim an existing selection by aFilterList
      let isMoving = false;

      for (let i = this.m_selection.GetSize() - 1; i >= 0; --i) {
        const item = this.m_selection.at(i)!;
        isMoving ||= (item as SCH_ITEM).IsMoving();

        if (!item.IsType(aScanTypes)) {
          this.unselect(item);
          anyUnselected = true;
        }
      }

      if (!isMoving) this.updateReferencePoint();
    }

    if (aPromoteGroups) {
      for (let i = this.m_selection.GetSize() - 1; i >= 0; --i) {
        const item = this.m_selection.at(i)!;

        const selectedChildren = new Set<EDA_ITEM>();

        if (item.Type() === KICAD_T.SCH_GROUP_T) {
          (item as SCH_ITEM).RunOnChildren((aChild: SCH_ITEM) => {
            if (aChild.IsType(aScanTypes)) selectedChildren.add(aChild);
          }, RECURSE_MODE.RECURSE);
          this.unselect(item);
          anyUnselected = true;
        }

        for (const child of selectedChildren) {
          if (!child.IsSelected()) {
            if (child.Type() === KICAD_T.SCH_LINE_T)
              (child as SCH_LINE).SetFlags(STARTPOINT | ENDPOINT);

            this.select(child);
            anySelected = true;
          }
        }
      }
    }

    if (aPromoteCellSelections) {
      const parents = new Set<EDA_ITEM>();

      for (let i = this.m_selection.GetSize() - 1; i >= 0; --i) {
        const item = this.m_selection.at(i)!;

        if (item.Type() === KICAD_T.SCH_TABLECELL_T) {
          parents.add(item.GetParent()!);
          this.unselect(item);
          anyUnselected = true;
        }
      }

      for (const parent of parents) {
        if (!parent.IsSelected()) {
          this.select(parent);
          anySelected = true;
        }
      }
    }

    if (anyUnselected) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

    if (anySelected) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return this.m_selection;
  }

  private filterCollectedItems(aCollector: SCH_COLLECTOR, _aMultiSelect: boolean): void {
    if (aCollector.GetCount() === 0) return;

    const rejected = new Set<EDA_ITEM>();

    for (const item of aCollector) {
      if (!this.itemPassesFilter(item, null)) rejected.add(item);
    }

    for (const item of rejected) aCollector.Remove(item);
  }

  private itemPassesFilter(
    aItem: EDA_ITEM | null,
    aRejected: SCH_SELECTION_FILTER_OPTIONS | null,
  ): boolean {
    if (!aItem) return false;

    // Locking is not yet exposed uniformly in the schematic
    // (#if 0: schItem->IsLocked() && !m_filter.lockedItems)

    switch (aItem.Type()) {
      case KICAD_T.SCH_SYMBOL_T:
      case KICAD_T.SCH_SHEET_T:
        if (!this.m_filter.symbols) {
          if (aRejected) aRejected.symbols = true;
          return false;
        }

        break;

      case KICAD_T.SCH_PIN_T:
      case KICAD_T.SCH_SHEET_PIN_T:
        if (!this.m_filter.pins) {
          if (aRejected) aRejected.pins = true;
          return false;
        }

        break;

      case KICAD_T.SCH_JUNCTION_T:
        if (!this.m_filter.wires) {
          if (aRejected) aRejected.wires = true;
          return false;
        }

        break;

      case KICAD_T.SCH_LINE_T: {
        switch ((aItem as SCH_LINE).GetLayer()) {
          case SCH_LAYER_ID.LAYER_WIRE:
          case SCH_LAYER_ID.LAYER_BUS:
            if (!this.m_filter.wires) {
              if (aRejected) aRejected.wires = true;
              return false;
            }

            break;

          default:
            if (!this.m_filter.graphics) {
              if (aRejected) aRejected.graphics = true;
              return false;
            }
        }

        break;
      }

      case KICAD_T.SCH_SHAPE_T:
        if (!this.m_filter.graphics) {
          if (aRejected) aRejected.graphics = true;
          return false;
        }

        break;

      case KICAD_T.SCH_TEXT_T:
      case KICAD_T.SCH_TEXTBOX_T:
      case KICAD_T.SCH_TABLE_T:
      case KICAD_T.SCH_TABLECELL_T:
      case KICAD_T.SCH_FIELD_T:
        if (!this.m_filter.text) {
          if (aRejected) aRejected.text = true;
          return false;
        }

        break;

      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
        if (!this.m_filter.labels) {
          if (aRejected) aRejected.labels = true;
          return false;
        }

        break;

      case KICAD_T.SCH_BITMAP_T:
        if (!this.m_filter.images) {
          if (aRejected) aRejected.images = true;
          return false;
        }

        break;

      case KICAD_T.SCH_RULE_AREA_T:
        if (!this.m_filter.ruleAreas) {
          if (aRejected) aRejected.ruleAreas = true;
          return false;
        }

        break;

      default:
        if (!this.m_filter.otherItems) {
          if (aRejected) aRejected.otherItems = true;
          return false;
        }

        break;
    }

    return true;
  }

  private updateReferencePoint(): void {
    let refP: VECTOR2I = { x: 0, y: 0 };

    if (this.m_selection.Size() > 0)
      refP = (this.m_selection.GetTopLeftItem() as SCH_ITEM).GetPosition();

    this.m_selection.SetReferencePoint(refP);
  }

  private SetSelectPoly(_aEvent: TOOL_EVENT): number {
    this.m_selectionMode = SELECTION_MODE.INSIDE_LASSO;
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.SELECT_LASSO);
    this.m_toolMgr!.PostAction(ACTIONS.selectionTool);
    return 0;
  }

  private SetSelectRect(_aEvent: TOOL_EVENT): number {
    this.m_selectionMode = SELECTION_MODE.INSIDE_RECTANGLE;
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    this.m_toolMgr!.PostAction(ACTIONS.selectionTool);
    return 0;
  }

  /** Rubber-band selection; true when cancelled. */
  private *selectMultiple(): COROUTINE_BODY<boolean> {
    // Block selection not allowed in symbol viewer frame: no actual code to handle
    // a selection, so return to avoid to draw a selection rectangle, and to avoid crashes.
    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_VIEWER)) return false;

    let cancelled = false; // Was the tool canceled while it was running?
    this.m_multiple = true; // Multiple selection mode is active
    const view = this.getView()!;

    const area = new SELECTION_AREA();
    view.Add(area);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      /* Selection mode depends on direction of drag-selection:
       * Left > Right : Select objects that are fully enclosed by selection
       * Right > Left : Select objects that are crossed by selection
       */
      let isGreedy = area.GetEnd().x < area.GetOrigin().x;

      if (view.IsMirroredX()) isGreedy = !isGreedy;

      this.m_frame!.GetCanvas()!.SetCurrentCursor(
        isGreedy ? KICURSOR.SELECT_LASSO : KICURSOR.SELECT_WINDOW,
      );

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        break;
      }

      if (evt.IsDrag(BUT_LEFT)) {
        if (!this.m_drag_additive && !this.m_drag_subtractive) this.ClearSelection();

        // Start drawing a selection box
        area.SetOrigin(evt.DragOrigin());
        area.SetEnd(evt.Position());
        area.SetAdditive(this.m_drag_additive);
        area.SetSubtractive(this.m_drag_subtractive);
        area.SetExclusiveOr(false);
        area.SetMode(
          isGreedy ? SELECTION_MODE.TOUCHING_RECTANGLE : SELECTION_MODE.INSIDE_RECTANGLE,
        );

        view.SetVisible(area, true);
        view.Update(area);
        this.controls().SetAutoPan(true);
      }

      if (evt.IsMouseUp(BUT_LEFT)) {
        this.controls().SetAutoPan(false);
        view.SetVisible(area, false);
        this.SelectMultiple(area, this.m_drag_subtractive, false);
        evt.SetPassEvent(false);
        break;
      }

      passEvent(evt, allowedActions);
    }

    this.controls().SetAutoPan(false);

    // Stop drawing the selection box
    view.Remove(area);
    this.m_multiple = false; // Multiple selection mode is inactive

    if (!cancelled) this.m_selection.ClearReferencePoint();

    return cancelled;
  }

  /** Lasso selection; true when cancelled. */
  private *selectLasso(): COROUTINE_BODY<boolean> {
    let cancelled = false;
    this.m_multiple = true;
    const area = new SELECTION_AREA();
    this.getView()!.Add(area);
    this.getView()!.SetVisible(area, true);
    this.controls().SetAutoPan(true);

    const points = new SHAPE_LINE_CHAIN();
    points.SetClosed(true);

    let selectionMode = SELECTION_MODE.TOUCHING_LASSO;
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.SELECT_LASSO);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      const shapeArea = area.GetPoly().Area(false);
      let isClockwise = shapeArea > 0;

      if (this.getView()!.IsMirroredX() && shapeArea !== 0) isClockwise = !isClockwise;

      if (isClockwise) {
        selectionMode = SELECTION_MODE.INSIDE_LASSO;
        this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.SELECT_WINDOW);
      } else {
        selectionMode = SELECTION_MODE.TOUCHING_LASSO;
        this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.SELECT_LASSO);
      }

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        break;
      } else if (
        evt.IsDrag(BUT_LEFT) ||
        evt.IsClick(BUT_LEFT) ||
        evt.IsAction(ACTIONS.cursorClick)
      ) {
        points.Append(evt.Position());
      } else if (
        evt.IsDblClick(BUT_LEFT) ||
        evt.IsAction(ACTIONS.cursorDblClick) ||
        evt.IsAction(ACTIONS.finishInteractive)
      ) {
        area.GetPoly().GenerateBBoxCache();
        this.SelectMultiple(area, this.m_drag_subtractive, false);
        break;
      } else if (evt.IsAction(ACTIONS.doDelete) || evt.IsAction(ACTIONS.undo)) {
        if (points.GetPointCount() > 0) {
          this.controls().SetCursorPosition(points.CLastPoint());
          points.Remove(points.GetPointCount() - 1);
        }
      } else {
        passEvent(evt, allowedActions);
      }

      if (points.PointCount() > 0) {
        if (!this.m_drag_additive && !this.m_drag_subtractive) {
          if (this.m_selection.GetSize() > 0) {
            this.ClearSelection(true);
            this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
          }
        }
      }

      area.SetPoly(points);
      area.GetPoly().Append(this.m_toolMgr!.GetMousePosition());
      area.SetAdditive(this.m_drag_additive);
      area.SetSubtractive(this.m_drag_subtractive);
      area.SetExclusiveOr(false);
      area.SetMode(selectionMode);
      this.getView()!.Update(area);
    }

    this.controls().SetAutoPan(false);
    this.getView()!.SetVisible(area, false);
    this.getView()!.Remove(area);
    this.m_multiple = false;

    if (!cancelled) this.m_selection.ClearReferencePoint();

    return cancelled;
  }

  /** Select the items in \a aArea (a box or a lasso). */
  SelectMultiple(aArea: SELECTION_AREA, aSubtractive = false, aExclusiveOr = false): void {
    const view = this.getView()!;

    const selectionMode = aArea.GetMode();
    const containedMode =
      selectionMode === SELECTION_MODE.INSIDE_RECTANGLE ||
      selectionMode === SELECTION_MODE.INSIDE_LASSO;
    const boxMode =
      selectionMode === SELECTION_MODE.INSIDE_RECTANGLE ||
      selectionMode === SELECTION_MODE.TOUCHING_RECTANGLE;

    const candidates: LAYER_ITEM_PAIR[] = [];
    const selectionRect = aArea.ViewBBox();
    view.Query(selectionRect, candidates);

    const uniqueCandidates = new Set<SCH_ITEM>();

    for (const [viewItem] of candidates) {
      if (viewItem instanceof SCH_ITEM) uniqueCandidates.add(viewItem);
    }

    const boxHits = (aBox: BOX2I): boolean =>
      boxMode
        ? selectionRect.Intersects(aBox)
        : KIGEOM_BoxHitTestChain(aArea.GetPoly(), aBox, true);

    for (const item of [...uniqueCandidates]) {
      if (item instanceof SCH_SHEET) {
        for (const pin of item.GetPins()) {
          if (boxHits(pin.GetBoundingBox())) uniqueCandidates.add(pin);
        }
      } else if (item instanceof SCH_SYMBOL) {
        for (const pin of item.GetPins()) {
          if (boxHits(pin.GetBoundingBox())) uniqueCandidates.add(pin);
        }

        for (const field of item.GetFields()) {
          if (field.IsVisible() && boxHits(field.GetBoundingBox())) uniqueCandidates.add(field);
        }
      }
    }

    let collector = new SCH_COLLECTOR();
    const pinsCollector = new SCH_COLLECTOR();
    const group_items = new Set<EDA_ITEM>();

    for (const item of this.m_frame!.GetScreen()!.Items().OfType(KICAD_T.SCH_GROUP_T)) {
      const group = item as SCH_GROUP;

      if (this.m_enteredGroup === group) continue;

      const newset = group.GetItems();

      const boxContained = (aBox: BOX2I): boolean =>
        boxMode
          ? selectionRect.Contains(aBox)
          : KIGEOM_BoxHitTestChain(aArea.GetPoly(), aBox, true);

      if (containedMode && boxContained(group.GetBoundingBox()) && newset.size) {
        for (const group_item of newset) {
          if (!(group_item instanceof SCH_ITEM)) continue;

          if (this.Selectable(group_item)) collector.Append(group_item);
        }
      }

      for (const group_item of newset) group_items.add(group_item);
    }

    const hitTest = (aItem: SCH_ITEM): boolean =>
      boxMode
        ? aItem.HitTest(selectionRect, containedMode)
        : aItem.HitTest(aArea.GetPoly(), containedMode);

    for (const item of uniqueCandidates) {
      if (
        this.Selectable(item) &&
        (hitTest(item) || item.Type() === KICAD_T.SCH_LINE_T) &&
        (!containedMode || !group_items.has(item))
      ) {
        if (item.Type() === KICAD_T.SCH_PIN_T && !this.m_isSymbolEditor) pinsCollector.Append(item);
        else collector.Append(item);
      }
    }

    this.filterCollectedItems(collector, true);
    this.FilterCollectorForHierarchy(collector, true);

    if (collector.GetCount() === 0) {
      collector = pinsCollector;
      this.filterCollectedItems(collector, true);
      this.FilterCollectorForHierarchy(collector, true);
    }

    collector.Sort((a, b) => {
      const aPos = a.GetPosition();
      const bPos = b.GetPosition();

      if (aPos.y === bPos.y) return aPos.x < bPos.x;

      return aPos.y < bPos.y;
    });

    let anyAdded = false;
    let anySubtracted = false;

    const selectItem = (aItem: EDA_ITEM, flags: number): void => {
      if (aSubtractive || (aExclusiveOr && aItem.IsSelected())) {
        if (aExclusiveOr) aItem.XorFlags(flags);
        else aItem.ClearFlags(flags);

        if (!aItem.HasFlag(STARTPOINT) && !aItem.HasFlag(ENDPOINT)) {
          this.unselect(aItem);
          anySubtracted = true;
        }

        if (flags && !anySubtracted) this.getView()!.Update(aItem);
      } else {
        aItem.SetFlags(flags);
        this.select(aItem);
        anyAdded = true;
      }
    };

    const flaggedItems: EDA_ITEM[] = [];

    const shapeContains = (aPoint: VECTOR2I): boolean =>
      boxMode ? selectionRect.Contains(aPoint) : aArea.GetPoly().PointInside(aPoint);

    for (const item of collector) {
      let flags = 0;

      item.SetFlags(SELECTION_CANDIDATE);
      flaggedItems.push(item);

      if (this.m_frame!.GetRenderSettings()!.m_ShowPinsElectricalType)
        item.SetFlags(SHOW_ELEC_TYPE);

      if (item.Type() === KICAD_T.SCH_LINE_T) {
        const line = item as SCH_LINE;
        let hits = false;

        if (boxMode) hits = line.HitTest(selectionRect, false);
        else hits = line.HitTest(aArea.GetPoly(), false);

        if (
          (!containedMode && hits) ||
          (shapeContains(line.GetEndPoint()) && shapeContains(line.GetStartPoint()))
        ) {
          flags |= STARTPOINT | ENDPOINT;
        } else if (containedMode) {
          if (shapeContains(line.GetStartPoint()) && line.IsStartDangling()) flags |= STARTPOINT;

          if (shapeContains(line.GetEndPoint()) && line.IsEndDangling()) flags |= ENDPOINT;
        }

        if (flags & (STARTPOINT | ENDPOINT)) selectItem(item, flags);
      } else selectItem(item, flags);

      item.ClearFlags(SHOW_ELEC_TYPE);
    }

    for (const item of pinsCollector) {
      if (this.m_frame!.GetRenderSettings()!.m_ShowPinsElectricalType)
        item.SetFlags(SHOW_ELEC_TYPE);

      // If the pin lives inside a group that is already being selected, don't also select the pin.
      const group = SCH_GROUP.TopLevelGroup(
        item as SCH_ITEM,
        this.m_enteredGroup,
        this.m_isSymbolEditor,
      );

      if (group) {
        if (collector.HasItem(group.AsEdaItem())) {
          item.ClearFlags(SHOW_ELEC_TYPE);
          continue;
        }
      }

      if (
        this.Selectable(item) &&
        this.itemPassesFilter(item, null) &&
        !item.GetParent()!.HasFlag(SELECTION_CANDIDATE) &&
        hitTest(item as SCH_ITEM)
      ) {
        selectItem(item, 0);
      }

      item.ClearFlags(SHOW_ELEC_TYPE);
    }

    for (const item of flaggedItems) item.ClearFlags(SELECTION_CANDIDATE);

    this.m_selection.SetIsHover(false);

    if (anyAdded) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    else if (anySubtracted) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
  }

  /**
   * Prune children of items already in \a aCollector (a symbol's pins and fields), promote items
   * to their top-level group, and drop items outside an entered group.
   */
  FilterCollectorForHierarchy(aCollector: SCH_COLLECTOR, aMultiselect: boolean): void {
    const toAdd = new Set<EDA_ITEM>();

    // Set SELECTION_CANDIDATE on all parents which are included in the GENERAL_COLLECTOR.  This
    // algorithm is O(3n), whereas checking for the parent inclusion could potentially be O(n^2).
    for (let j = 0; j < aCollector.GetCount(); j++) {
      if (aCollector.At(j)!.GetParent())
        aCollector.At(j)!.GetParent()!.ClearFlags(SELECTION_CANDIDATE);

      if (aCollector.At(j)!.GetParentSymbol())
        aCollector.At(j)!.GetParentSymbol()!.ClearFlags(SELECTION_CANDIDATE);
    }

    if (aMultiselect) {
      for (let j = 0; j < aCollector.GetCount(); j++)
        aCollector.At(j)!.SetFlags(SELECTION_CANDIDATE);
    }

    // Skip group promotion when the caller asked for specific types that exclude groups
    const scanTypes = aCollector.GetScanTypes();
    const promoteToGroups =
      scanTypes.length === 0 ||
      scanTypes.includes(KICAD_T.SCH_LOCATE_ANY_T) ||
      scanTypes.includes(KICAD_T.SCH_GROUP_T);

    for (let j = 0; j < aCollector.GetCount(); ) {
      const item = aCollector.At(j)!;
      const sym = item.GetParentSymbol();
      let start: SCH_ITEM = item;

      if (!this.m_isSymbolEditor && sym) start = sym;

      // If a group is entered, disallow selections of objects outside the group.
      if (
        this.m_enteredGroup &&
        !SCH_GROUP.WithinScope(item, this.m_enteredGroup, this.m_isSymbolEditor)
      ) {
        aCollector.Remove(item);
        continue;
      }

      // If any element is a member of a group, replace those elements with the top containing
      // group.
      const top = promoteToGroups
        ? SCH_GROUP.TopLevelGroup(start, this.m_enteredGroup, this.m_isSymbolEditor)
        : null;

      if (top) {
        if (top.AsEdaItem() !== item) {
          toAdd.add(top.AsEdaItem());
          top.AsEdaItem().SetFlags(SELECTION_CANDIDATE);

          aCollector.Remove(item);
          continue;
        }
      }

      // Symbols are a bit easier as they can't be nested.
      if (sym && sym.GetFlags() & SELECTION_CANDIDATE) {
        // Remove children of selected items
        aCollector.Remove(item);
        continue;
      }

      ++j;
    }

    for (const item of toAdd) {
      if (!aCollector.HasItem(item)) aCollector.Append(item);
    }
  }

  private updateSelection(_aEvent: TOOL_EVENT): number {
    this.getView()!.Update(this.m_selection);
    this.getView()!.Update(this.m_enteredGroupOverlay);

    return 0;
  }

  private InitializeSelectionState(aTable: SCH_TABLE): void {
    for (const cell of aTable.GetCells()) {
      if (cell.IsSelected()) cell.SetFlags(SELECTION_CANDIDATE);
      else cell.ClearFlags(SELECTION_CANDIDATE);
    }
  }

  private SelectCellsBetween(start: VECTOR2D, end: VECTOR2D, aTable: SCH_TABLE): void {
    const selectionRect = new BOX2I(
      { x: KiROUND(start.x), y: KiROUND(start.y) },
      { x: KiROUND(end.x), y: KiROUND(end.y) },
    );
    selectionRect.Normalize();

    const wasSelected = (aItem: EDA_ITEM): boolean => (aItem.GetFlags() & SELECTION_CANDIDATE) > 0;

    for (const cell of aTable.GetCells()) {
      let doSelect = false;

      if (cell.HitTest(selectionRect, false)) {
        if (this.m_subtractive) doSelect = false;
        else if (this.m_exclusive_or) doSelect = !wasSelected(cell);
        else doSelect = true;
      } else if (wasSelected(cell)) {
        doSelect = this.m_additive || this.m_subtractive || this.m_exclusive_or;
      }

      if (doSelect && !cell.IsSelected()) this.select(cell);
      else if (!doSelect && cell.IsSelected()) this.unselect(cell);
    }
  }

  private *selectTableCells(aTable: SCH_TABLE): COROUTINE_BODY<boolean> {
    let cancelled = false;
    this.m_multiple = true;

    this.InitializeSelectionState(aTable);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        break;
      } else if (evt.IsDrag(BUT_LEFT)) {
        this.controls().SetAutoPan(true);
        const o = evt.DragOrigin();
        const p = evt.Position();
        this.SelectCellsBetween(o, { x: p.x - o.x, y: p.y - o.y }, aTable);
      } else if (evt.IsMouseUp(BUT_LEFT)) {
        this.m_selection.SetIsHover(false);

        let anyAdded = false;
        let anySubtracted = false;

        for (const cell of aTable.GetCells()) {
          if (cell.IsSelected() && (cell.GetFlags() & SELECTION_CANDIDATE) <= 0) anyAdded = true;
          else if ((cell.GetFlags() & SELECTION_CANDIDATE) > 0 && !cell.IsSelected())
            anySubtracted = true;
        }

        if (anyAdded) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
        if (anySubtracted) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

        break;
      } else {
        passEvent(evt, allowedActions);
      }
    }

    this.controls().SetAutoPan(false);

    this.m_multiple = false;

    if (!cancelled) this.m_selection.ClearReferencePoint();

    return cancelled;
  }

  /** The connectable item nearest \a aPosition, widening the search until one is found. */
  GetNode(aPosition: VECTOR2I): EDA_ITEM | null {
    const collector = new SCH_COLLECTOR();

    //TODO(snh): Reimplement after exposing KNN interface
    const pixelThreshold = KiROUND(this.getView()!.ToWorld(HITTEST_THRESHOLD_PIXELS) as number);
    const gs = this.getView()!.GetGAL()!.GetGridSize();
    const gridThreshold = KiROUND(Math.hypot(gs.x, gs.y));
    const thresholdMax = Math.max(pixelThreshold, gridThreshold);

    for (const threshold of [
      0,
      Math.trunc(thresholdMax / 4),
      Math.trunc(thresholdMax / 2),
      thresholdMax,
    ]) {
      collector.m_Threshold = threshold;
      collector.Collect(this.m_frame!.GetScreen(), connectedTypes, aPosition);

      if (collector.GetCount() > 0) break;
    }

    return collector.GetCount() ? collector.At(0) : null;
  }

  SelectNode(_aEvent: TOOL_EVENT): number {
    const cursorPos = this.controls().GetCursorPosition(false);

    this.SelectPointNow(cursorPos, connectedTypes);
    return 0;
  }

  private expandConnectionWithGraph(
    aItems: SCH_SELECTION,
    aStopCondition: STOP_CONDITION,
  ): Set<SCH_ITEM> {
    const editFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (this.m_isSymbolEditor || this.m_isSymbolViewer || !editFrame) return new Set();

    const graph = editFrame.Schematic().ConnectionGraph();

    if (!graph) return new Set();

    const screen = this.m_frame!.GetScreen()!;
    const currentSheet = editFrame.GetCurrentSheet();
    const startItems: SCH_ITEM[] = [];
    const added = new Set<SCH_ITEM>();

    for (const item of aItems.GetItems()) {
      if (!(item instanceof SCH_ITEM)) continue;

      const schItem = item;

      if (schItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        for (const pin of (schItem as SCH_SYMBOL).GetPins(currentSheet)) {
          if (pin) startItems.push(pin);
        }
      } else if (schItem.IsConnectable()) {
        startItems.push(schItem);
      }
    }

    if (startItems.length === 0) return new Set();

    // Pre-compute which start items belong to symbols already in the original selection so that
    // pin-stop traversal can step away from those symbols without immediately bouncing back.
    const startSymbols = new Set<SCH_SYMBOL>();

    for (const item of startItems) {
      if (item instanceof SCH_PIN) {
        if (item.GetParent() instanceof SCH_SYMBOL)
          startSymbols.add(item.GetParent() as SCH_SYMBOL);
      }
    }

    // Cache every pin position on the sheet so endpoint tests are O(log n) lookups instead of
    // an R-tree query plus a full pin iteration per call.
    const pinPositions = new Set<string>();

    for (const it of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
      for (const pin of (it as SCH_SYMBOL).GetPins(currentSheet)) {
        if (pin) pinPositions.add(pointKey(pin.GetPosition()));
      }
    }

    const isStopPoint = (aPoint: VECTOR2I): boolean => {
      if (aStopCondition === STOP_CONDITION.STOP_NEVER) return false;

      if (pinPositions.has(pointKey(aPoint))) return true;

      if (aStopCondition === STOP_CONDITION.STOP_AT_PIN) return false;

      if (screen.IsJunction(aPoint) || screen.IsExplicitJunction(aPoint)) return true;

      for (const it of screen.Items().Overlapping(aPoint)) {
        switch (it.Type()) {
          case KICAD_T.SCH_LABEL_T:
          case KICAD_T.SCH_GLOBAL_LABEL_T:
          case KICAD_T.SCH_HIER_LABEL_T:
          case KICAD_T.SCH_DIRECTIVE_LABEL_T:
          case KICAD_T.SCH_SHEET_PIN_T:
          case KICAD_T.SCH_NO_CONNECT_T:
            if (it.IsConnected(aPoint)) return true;

            break;

          default:
            break;
        }
      }

      return false;
    };

    // STOP_AT_JUNCTION refuses to pull a symbol into the selection unless the user already had
    // a symbol selected; later passes accept every reachable symbol.
    const shouldPullInSymbol = (): boolean =>
      aStopCondition !== STOP_CONDITION.STOP_AT_JUNCTION || startSymbols.size > 0;

    const queue: SCH_ITEM[] = [];
    const visited = new Set<SCH_ITEM>();

    const enqueue = (aItem: SCH_ITEM | null): void => {
      if (!aItem) return;

      if (!visited.has(aItem)) {
        visited.add(aItem);
        queue.push(aItem);
      }
    };

    for (const item of startItems) enqueue(item);

    while (queue.length > 0) {
      const item = queue.shift()!;

      if (item instanceof SCH_PIN) {
        const symbol =
          item.GetParent() instanceof SCH_SYMBOL ? (item.GetParent() as SCH_SYMBOL) : null;

        if (
          shouldPullInSymbol() &&
          symbol &&
          this.Selectable(symbol) &&
          this.itemPassesFilter(symbol, null) &&
          !symbol.IsSelected()
        ) {
          added.add(symbol);
        }
      }

      const line = item instanceof SCH_LINE ? item : null;
      const openPoints: VECTOR2I[] = [];

      if (line && aStopCondition !== STOP_CONDITION.STOP_NEVER) {
        for (const pt of [line.GetStartPoint(), line.GetEndPoint()]) {
          if (!isStopPoint(pt)) openPoints.push(pt);
        }
      }

      const neighbors = item.ConnectedItems(currentSheet);

      for (const neighbor of neighbors) {
        if (!neighbor) continue;

        if (neighbor.Type() === KICAD_T.SCH_SYMBOL_T) {
          const symbol = neighbor as SCH_SYMBOL;

          if (
            shouldPullInSymbol() &&
            this.Selectable(symbol) &&
            this.itemPassesFilter(symbol, null) &&
            !symbol.IsSelected()
          ) {
            added.add(symbol);
          }

          continue;
        }

        // Wires gate traversal on open endpoints; items without distinct endpoints always flow.
        if (line && aStopCondition !== STOP_CONDITION.STOP_NEVER) {
          let sharesOpenPoint = false;

          for (const pt of openPoints) {
            if (neighbor.IsConnected(pt)) {
              sharesOpenPoint = true;
              break;
            }
          }

          if (!sharesOpenPoint) continue;
        }

        enqueue(neighbor);
      }

      if (!this.Selectable(item) || !this.itemPassesFilter(item, null)) continue;

      added.add(item);
    }

    return added;
  }

  private expandConnectionGraphically(aItems: SCH_SELECTION): Set<SCH_ITEM> {
    const added = new Set<SCH_ITEM>();

    for (const item of aItems.GetItems()) {
      if (!(item instanceof SCH_ITEM)) continue;

      const schItem = item;

      const conns = this.m_frame!.GetScreen()!.MarkConnections(schItem, schItem.IsConnectable());

      // Make sure we don't add things the user has disabled in the selection filter
      for (const connItem of conns) {
        if (!this.Selectable(connItem) || !this.itemPassesFilter(connItem, null)) continue;

        added.add(connItem);
      }
    }

    return added;
  }

  /**
   * If the selection is a wire or bus, expand it to the whole connection; otherwise select the
   * connection under the cursor. Repeated, it widens: junctions, then pins, then the sub-net.
   */
  SelectConnection(_aEvent: TOOL_EVENT): number {
    const originalSelection = new SCH_SELECTION().assign(
      this.RequestSelection(expandConnectionGraphTypes),
    );

    if (this.m_selection.Empty()) return 0;

    const connectableSelection = new SCH_SELECTION();
    let graphicalSelection = new SCH_SELECTION();

    // We need to filter the selection into connectable items (wires, pins, symbols)
    // and non-connectable items (shapes, unconnectable lines) for processing
    // with the graph or by the graphical are-endpoints-touching method.
    for (const selItem of originalSelection.GetItems()) {
      if (!(selItem instanceof SCH_ITEM)) continue;

      const item = selItem;

      if (item.Type() === KICAD_T.SCH_LINE_T && !item.IsConnectable()) graphicalSelection.Add(item);
      else if (item.Type() === KICAD_T.SCH_SHAPE_T) graphicalSelection.Add(item);
      else connectableSelection.Add(item);
    }

    // Repeated Ctrl+4 must advance to the next stop condition if the current stage did not pull
    // in any items beyond what was already selected, matching PCBNew's "Select/Expand Connection".
    const originalConnectableSet = new Set<EDA_ITEM>(connectableSelection.GetItems());

    this.ClearSelection(true);

    let graphAdded = new Set<SCH_ITEM>();
    let graphicalAdded = new Set<SCH_ITEM>();

    if (!connectableSelection.Empty()) {
      for (const stop of [
        STOP_CONDITION.STOP_AT_JUNCTION,
        STOP_CONDITION.STOP_AT_PIN,
        STOP_CONDITION.STOP_NEVER,
      ]) {
        graphAdded = this.expandConnectionWithGraph(connectableSelection, stop);

        const grew = [...graphAdded].some((c) => !originalConnectableSet.has(c));

        if (grew) break;
      }
    }

    if (!graphicalSelection.Empty())
      graphicalAdded = this.expandConnectionGraphically(graphicalSelection);

    // For whatever reason, the connection graph isn't working (e.g. in symbol editor )
    // so fall back to graphical expansion for those items if nothing was added.
    if (graphAdded.size === 0 && !connectableSelection.Empty()) {
      const combinedSelection = new SCH_SELECTION().assign(connectableSelection);

      for (const selItem of graphicalSelection.GetItems()) combinedSelection.Add(selItem);

      graphicalSelection = combinedSelection;
    }

    graphicalAdded = this.expandConnectionGraphically(graphicalSelection);

    const smartAddToSel = (aItem: EDA_ITEM): void => {
      this.AddItemToSel(aItem, true);

      if (aItem.Type() === KICAD_T.SCH_LINE_T) aItem.SetFlags(STARTPOINT | ENDPOINT);
    };

    // Add everything to the selection, including the original selection
    for (const item of graphAdded) smartAddToSel(item);

    for (const item of graphicalAdded) smartAddToSel(item);

    for (const item of originalSelection.GetItems()) smartAddToSel(item);

    this.m_selection.SetIsHover(originalSelection.IsHover());

    if (originalSelection.HasReferencePoint())
      this.m_selection.SetReferencePoint(originalSelection.GetReferencePoint());
    else this.m_selection.ClearReferencePoint();

    this.getView()!.Update(this.m_selection);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  SelectColumns(_aEvent: TOOL_EVENT): number {
    const columns = new Map<SCH_TABLE, Set<number>>();
    let added = false;

    for (const item of this.m_selection.GetItems()) {
      if (item instanceof SCH_TABLECELL) {
        const table = item.GetParent() as SCH_TABLE;
        if (!columns.has(table)) columns.set(table, new Set());
        columns.get(table)!.add(item.GetColumn());
      }
    }

    for (const [table, cols] of columns) {
      for (const col of [...cols].sort((a, b) => a - b)) {
        for (let row = 0; row < table.GetRowCount(); ++row) {
          const cell = table.GetCell(row, col)!;

          if (!cell.IsSelected()) {
            this.select(cell);
            added = true;
          }
        }
      }
    }

    if (added) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  SelectRows(_aEvent: TOOL_EVENT): number {
    const rows = new Map<SCH_TABLE, Set<number>>();
    let added = false;

    for (const item of this.m_selection.GetItems()) {
      if (item instanceof SCH_TABLECELL) {
        const table = item.GetParent() as SCH_TABLE;
        if (!rows.has(table)) rows.set(table, new Set());
        rows.get(table)!.add(item.GetRow());
      }
    }

    for (const [table, rowSet] of rows) {
      for (const row of [...rowSet].sort((a, b) => a - b)) {
        for (let col = 0; col < table.GetColCount(); ++col) {
          const cell = table.GetCell(row, col)!;

          if (!cell.IsSelected()) {
            this.select(cell);
            added = true;
          }
        }
      }
    }

    if (added) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  SelectTable(_aEvent: TOOL_EVENT): number {
    const tables = new Set<SCH_TABLE>();
    let added = false;

    for (const item of this.m_selection.GetItems()) {
      if (item instanceof SCH_TABLECELL) tables.add(item.GetParent() as SCH_TABLE);
    }

    this.ClearSelection();

    for (const table of tables) {
      if (!table.IsSelected()) {
        this.select(table);
        added = true;
      }
    }

    if (added) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  /** Clear current selection event handler. */
  private ClearSelectionEvt(_aEvent: TOOL_EVENT): number {
    this.ClearSelection();
    return 0;
  }

  /** Zoom the screen to fit the bounding box for cross probing/selection sync. */
  ZoomFitCrossProbeBBox(aBBox: BOX2I): void {
    if (aBBox.GetWidth() === 0) return;

    const bbox = aBBox.Clone();
    bbox.Normalize();

    const bbSize = bbox.Inflate(KiROUND(bbox.GetWidth() * 0.2)).GetSize();
    const screenSize = { ...this.getView()!.GetViewport().GetSize() };

    // This code tries to come up with a zoom factor that doesn't simply zoom in to the cross
    // probed symbol, but instead shows a reasonable amount of the circuit around it to provide
    // context.  This reduces the need to manually change the zoom because it's too close.

    // Using the default text height as a constant to compare against, use the height of the
    // bounding box of visible items for a footprint to figure out if this is a big symbol (like
    // a processor) or a small symbol (like a resistor).  This ratio is not useful by itself as a
    // scaling factor.  It must be "bent" to provide good scaling at varying symbol sizes.  Bigger
    // symbols need less scaling than small ones.
    const currTextHeight = schIUScale.milsToIU(DEFAULT_TEXT_SIZE);

    const compRatio = bbSize.y / currTextHeight; // Ratio of symbol to text height
    let compRatioBent = 1.0;

    // LUT to scale zoom ratio to provide reasonable schematic context.  Must work with symbols
    // of varying sizes (e.g. 0402 package and 200 pin BGA).
    // Each entry represents a compRatio (symbol height / default text height) and an amount to
    // scale by.
    const lut: [number, number][] = [
      [1.25, 16],
      [2.5, 12],
      [5, 8],
      [6, 6],
      [10, 4],
      [20, 2],
      [40, 1.5],
      [100, 1],
    ];

    // Large symbol default is last LUT entry (1:1).
    compRatioBent = lut[lut.length - 1]![1];

    // Use LUT to do linear interpolation of "compRatio" within "first", then use that result to
    // linearly interpolate "second" which gives the scaling factor needed.
    if (compRatio >= lut[0]![0]) {
      for (let i = 0; i < lut.length - 1; ++i) {
        const it = lut[i]!;
        const next = lut[i + 1]!;

        if (it[0] <= compRatio && next[0] >= compRatio) {
          const diffx = compRatio - it[0];
          const diffn = next[0] - it[0];

          compRatioBent = it[1] + ((next[1] - it[1]) * diffx) / diffn;
          break; // We have our interpolated value
        }
      }
    } else {
      compRatioBent = lut[0]![1]; // Small symbol default is first entry
    }

    // This is similar to the original KiCad code that scaled the zoom to make sure symbols were
    // visible on screen.  It's simply a ratio of screen size to symbol size, and its job is to
    // zoom in to make the component fullscreen.  Earlier in the code the symbol BBox is given a
    // 20% margin to add some breathing room.  We compare the height of this enlarged symbol bbox
    // to the default text height.  If a symbol will end up with the sides clipped, we adjust
    // later to make sure it fits on screen.
    screenSize.x = Math.max(10.0, screenSize.x);
    screenSize.y = Math.max(10.0, screenSize.y);
    let ratio = Math.max(-1.0, Math.abs(bbSize.y / screenSize.y));

    // Original KiCad code for how much to scale the zoom
    const kicadRatio = Math.max(
      Math.abs(bbSize.x / screenSize.x),
      Math.abs(bbSize.y / screenSize.y),
    );

    // If the width of the part we're probing is bigger than what the screen width will be after
    // the zoom, then punt and use the KiCad zoom algorithm since it guarantees the part's width
    // will be encompassed within the screen.
    if (bbSize.x > screenSize.x * ratio * compRatioBent) {
      // Use standard KiCad zoom for parts too wide to fit on screen/
      ratio = kicadRatio;
      compRatioBent = 1.0; // Reset so we don't modify the "KiCad" ratio
    }

    // Now that "compRatioBent" holds our final scaling factor we apply it to the original
    // fullscreen zoom ratio to arrive at the final ratio itself.
    ratio *= compRatioBent;

    const alwaysZoom = false; // DEBUG - allows us to minimize zooming or not

    // Try not to zoom on every cross-probe; it gets very noisy
    if (ratio < 0.5 || ratio > 1.0 || alwaysZoom)
      this.getView()!.SetScale(this.getView()!.GetScale() / ratio);
  }

  /** Set the selection to \a items (on \a targetSheetPath, if given), zooming to fit if enabled. */
  SyncSelection(
    targetSheetPath: SCH_SHEET_PATH | null,
    focusItem: SCH_ITEM | null,
    items: readonly SCH_ITEM[],
  ): void {
    const editFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!editFrame) return;

    let targetZoom = 0.0;
    let targetCenter: VECTOR2D = { x: 0, y: 0 };
    let targetZoomValid = false;
    let changedSheet = false;

    if (targetSheetPath) {
      const path = targetSheetPath;
      const screen = path.LastScreen();

      if (screen) {
        targetZoom = screen.m_LastZoomLevel;
        targetCenter = screen.m_ScrollCenter;
        targetZoomValid = screen.IsZoomInitialized();
      }

      if (!path.equals(editFrame.Schematic().CurrentSheet())) {
        this.m_frame!.GetToolManager()!.RunAction<SCH_SHEET_PATH>(SCH_ACTIONS.changeSheet, path);
        changedSheet = true;
      }
    }

    if (changedSheet && targetZoomValid && !this.m_frame!.eeconfig()!.cross_probing.zoom_to_fit) {
      this.getView()!.SetScale(targetZoom);
      this.getView()!.SetCenter(targetCenter);
    }

    this.ClearSelection(items.length > 0 /*quiet mode*/);

    // Perform individual selection of each item before processing the event.
    for (const item of items) {
      const parent = item.GetParent() instanceof SCH_ITEM ? (item.GetParent() as SCH_ITEM) : null;

      // Make sure we only select items on the current screen
      if (
        this.m_frame!.GetScreen()!.CheckIfOnDrawList(item) ||
        (parent && this.m_frame!.GetScreen()!.CheckIfOnDrawList(parent))
      ) {
        this.select(item);
      }
    }

    const bbox = this.m_selection.GetBoundingBox();

    if (bbox.GetWidth() !== 0 && bbox.GetHeight() !== 0) {
      if (this.m_frame!.eeconfig()!.cross_probing.center_on_items) {
        if (this.m_frame!.eeconfig()!.cross_probing.zoom_to_fit) this.ZoomFitCrossProbeBBox(bbox);

        editFrame.FocusOnItem(focusItem);

        if (!focusItem) editFrame.FocusOnLocation(bbox.Centre());
      }
    }

    if (this.m_selection.Size() > 0) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
  }

  /** Rebuild the selection from the EDA_ITEMs' selection flags. */
  RebuildSelection(): void {
    this.m_selection.Clear();

    let enteredGroupFound = false;

    if (this.m_isSymbolEditor) {
      const start = (this.m_frame as unknown as SYMBOL_EDIT_FRAME).GetCurSymbol()!;

      for (const item of start.GetDrawItems()) {
        if (item.IsSelected()) this.select(item);

        if (item.Type() === KICAD_T.SCH_GROUP_T) {
          if (item === this.m_enteredGroup) {
            item.SetFlags(ENTERED);
            enteredGroupFound = true;
          } else {
            item.ClearFlags(ENTERED);
          }
        }
      }
    } else {
      for (const item of this.m_frame!.GetScreen()!.Items()) {
        // If the field and symbol are selected, only use the symbol
        if (item.IsSelected()) {
          this.select(item);
        } else {
          item.RunOnChildren((aChild: SCH_ITEM) => {
            if (aChild.IsSelected()) this.select(aChild);
          }, RECURSE_MODE.NO_RECURSE);
        }

        if (item.Type() === KICAD_T.SCH_GROUP_T) {
          if (item === this.m_enteredGroup) {
            item.SetFlags(ENTERED);
            enteredGroupFound = true;
          } else {
            item.ClearFlags(ENTERED);
          }
        }
      }
    }

    this.updateReferencePoint();

    if (!enteredGroupFound) {
      this.m_enteredGroupOverlay.Clear();
      this.m_enteredGroup = null;
    }

    // Inform other potentially interested tools
    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
  }

  /**
   * Whether \a aItem can be selected (visibility, the symbol editor's unit and body style, the pin
   * filter with a pin anchor allowed for auto-started wires).
   */
  Selectable(aItem: EDA_ITEM, aPos: VECTOR2I | null = null, _checkVisibilityOnly = false): boolean {
    // NOTE: in the future this is where Eeschema layer/itemtype visibility will be handled

    const symEditFrame = this.m_frame instanceof SYMBOL_EDIT_FRAME ? this.m_frame : null;

    // Do not allow selection of anything except fields when the current symbol in the symbol
    // editor is a derived symbol.
    if (symEditFrame && symEditFrame.IsSymbolAlias() && aItem.Type() !== KICAD_T.SCH_FIELD_T)
      return false;

    switch (aItem.Type()) {
      case KICAD_T.SCH_PIN_T: {
        const pin = aItem as SCH_PIN;

        if (symEditFrame) {
          if (pin.GetUnit() && pin.GetUnit() !== symEditFrame.GetUnit()) return false;

          if (pin.GetBodyStyle() && pin.GetBodyStyle() !== symEditFrame.GetBodyStyle())
            return false;
        }

        if (!pin.IsVisible() && !this.m_frame!.GetShowAllPins()) return false;

        if (!this.m_filter.pins) {
          // Pin anchors have to be allowed for auto-starting wires.
          if (aPos) {
            const grid = new EE_GRID_HELPER(this.m_toolMgr);
            const pinGrid = grid.GetItemGrid(pin);

            if (pin.IsPointClickableAnchor(grid.BestSnapAnchor(aPos, pinGrid))) return true;
          }

          return false;
        }

        break;
      }

      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
        if (!this.m_frame!.eeconfig()!.appearance.show_directive_labels) return false;

        break;

      case KICAD_T.LIB_SYMBOL_T: // In symbol_editor we do not want to select the symbol itself.
        return false;

      case KICAD_T.SCH_FIELD_T: {
        // SCH_FIELD objects are not unit/body-style-specific.
        const field = aItem as SCH_FIELD;

        if (!field.IsVisible() && !(symEditFrame && symEditFrame.GetShowInvisibleFields()))
          return false;

        break;
      }

      case KICAD_T.SCH_SHAPE_T:
      case KICAD_T.SCH_TEXT_T:
      case KICAD_T.SCH_TEXTBOX_T:
        if (symEditFrame) {
          const sch_item = aItem as SCH_ITEM;

          if (sch_item.GetUnit() && sch_item.GetUnit() !== symEditFrame.GetUnit()) return false;

          if (sch_item.GetBodyStyle() && sch_item.GetBodyStyle() !== symEditFrame.GetBodyStyle())
            return false;
        }

        break;

      case KICAD_T.SCH_MARKER_T: // Always selectable
        return true;

      case KICAD_T.SCH_TABLECELL_T: {
        const cell = aItem as SCH_TABLECELL;

        if (cell.GetColSpan() === 0 || cell.GetRowSpan() === 0) return false;

        break;
      }

      case KICAD_T.NOT_USED: // Things like CONSTRUCTION_GEOM that aren't part of the model
        return false;

      default:
        // Suppress warnings
        break;
    }

    return true;
  }

  /** Clear the selection (quietly: no ClearedEvent). */
  ClearSelection(aQuietMode = false): void {
    if (this.m_selection.Empty()) return;

    while (this.m_selection.GetSize())
      this.unhighlight(this.m_selection.Front()!, SELECTED, this.m_selection);

    this.getView()!.Update(this.m_selection);

    this.m_selection.SetIsHover(false);
    this.m_selection.ClearReferencePoint();

    // Inform other potentially interested tools
    if (!aQuietMode) this.m_toolMgr!.ProcessEvent(EVENTS.ClearedEvent);
  }

  protected override select(aItem: EDA_ITEM): void {
    // Don't group when we select new items, the schematic editor selects all new items for moving.
    // The PCB editor doesn't need this logic because it doesn't select new items for moving.
    if (
      this.m_enteredGroup &&
      !aItem.IsNew() &&
      !SCH_GROUP.WithinScope(aItem as SCH_ITEM, this.m_enteredGroup, this.m_isSymbolEditor)
    ) {
      this.ExitGroup();
    }

    this.highlight(aItem, SELECTED, this.m_selection);
  }

  protected override unselect(aItem: EDA_ITEM): void {
    this.unhighlight(aItem, SELECTED, this.m_selection);
  }

  protected override highlight(aItem: EDA_ITEM, aMode: number, aGroup?: SELECTION): void {
    if (aMode === SELECTED) aItem.SetSelected();
    else if (aMode === BRIGHTENED) aItem.SetBrightened();

    if (aGroup) aGroup.Add(aItem);

    // Highlight pins and fields.  (All the other symbol children are currently only
    // represented in the LIB_SYMBOL and will inherit the settings of the parent symbol.)
    if (aItem instanceof SCH_ITEM) {
      // We don't want to select group children if the group itself is selected,
      // we can only select them when the group is entered
      if (aItem.Type() !== KICAD_T.SCH_GROUP_T) {
        aItem.RunOnChildren((aChild: SCH_ITEM) => {
          if (aMode === SELECTED) {
            aChild.SetSelected();
            this.getView()!.Hide(aChild, true);
          } else if (aMode === BRIGHTENED) {
            aChild.SetBrightened();
          }
        }, RECURSE_MODE.NO_RECURSE);
      }
    }

    if (aGroup && aMode !== BRIGHTENED) this.getView()!.Hide(aItem, true);

    if (aItem.GetParent() && aItem.GetParent()!.Type() !== KICAD_T.SCHEMATIC_T)
      this.getView()!.Update(aItem.GetParent()!, VIEW_UPDATE_FLAGS.REPAINT);

    this.getView()!.Update(aItem, VIEW_UPDATE_FLAGS.REPAINT);
  }

  protected override unhighlight(aItem: EDA_ITEM, aMode: number, aGroup?: SELECTION): void {
    if (aMode === SELECTED) {
      aItem.ClearSelected();
      // Lines need endpoints cleared here
      if (aItem.Type() === KICAD_T.SCH_LINE_T) aItem.ClearFlags(STARTPOINT | ENDPOINT);

      this.getView()!.Hide(aItem, false);
    } else if (aMode === BRIGHTENED) {
      aItem.ClearBrightened();
    }

    if (aGroup) aGroup.Remove(aItem);

    // Unhighlight pins and fields.  (All the other symbol children are currently only
    // represented in the LIB_SYMBOL.)
    if (aItem instanceof SCH_ITEM) {
      aItem.RunOnChildren((aChild: SCH_ITEM) => {
        if (aMode === SELECTED) {
          aChild.ClearSelected();
          this.getView()!.Hide(aChild, false);
        } else if (aMode === BRIGHTENED) {
          aChild.ClearBrightened();
        }

        if (aGroup) aGroup.Remove(aChild);
      }, RECURSE_MODE.NO_RECURSE);
    }

    if (aItem.GetParent() && aItem.GetParent()!.Type() !== KICAD_T.SCHEMATIC_T)
      this.getView()!.Update(aItem.GetParent()!, VIEW_UPDATE_FLAGS.REPAINT);

    this.getView()!.Update(aItem, VIEW_UPDATE_FLAGS.REPAINT);
  }

  /** Whether \a aPoint is within (a grip margin of) any selected item's view box. */
  private selectionContains(aPoint: VECTOR2I): boolean {
    // `const VECTOR2I& aPoint`: the event's VECTOR2D position is cast on the way in.
    aPoint = toVECTOR2I(aPoint);
    const GRIP_MARGIN = 20;
    const margin = KiROUND(this.getView()!.ToWorld(GRIP_MARGIN) as number);

    // Check if the point is located within any of the currently selected items bounding boxes
    for (const item of this.m_selection.GetItems()) {
      const itemBox = item.ViewBBox();
      itemBox.Inflate(margin); // Give some margin for gripping an item

      if (itemBox.Contains(aPoint)) return true;
    }

    return false;
  }

  /** Select next net item (the net navigator's). */
  SelectNext(_aEvent: TOOL_EVENT): number {
    return this.selectNextPrev(true);
  }

  /** Select previous net item (the net navigator's). */
  SelectPrevious(_aEvent: TOOL_EVENT): number {
    return this.selectNextPrev(false);
  }

  private selectNextPrev(aNext: boolean): number {
    const editFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;
    const navigator = editFrame as unknown as {
      GetNetNavigator?(): unknown;
      SelectNextPrevNetNavigatorItem?(aNext: boolean): SCH_ITEM | null;
    } | null;

    if (!editFrame || !navigator?.GetNetNavigator?.() || this.m_selection.Size() === 0) return 0;

    if (!this.m_selection.Front()!.IsBrightened()) return 0;

    const item = navigator.SelectNextPrevNetNavigatorItem?.(aNext) ?? null;

    if (item) {
      this.ClearSelection();
      this.select(item);
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    }

    return 0;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.UpdateMenu), ACTIONS.updateMenu.MakeEvent());

    this.Go(this.Main, ACTIONS.selectionActivate.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectNode), SCH_ACTIONS.selectNode.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectConnection), SCH_ACTIONS.selectConnection.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectColumns), ACTIONS.selectColumns.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectRows), ACTIONS.selectRows.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectTable), ACTIONS.selectTable.MakeEvent());

    this.Go(SYNC_HANDLER(this.ClearSelectionEvt), ACTIONS.selectionClear.MakeEvent());

    this.Go(SYNC_HANDLER(this.SetSelectPoly), ACTIONS.selectSetLasso.MakeEvent());
    this.Go(SYNC_HANDLER(this.SetSelectRect), ACTIONS.selectSetRect.MakeEvent());

    this.Go(SYNC_HANDLER(this.AddItemToSel), ACTIONS.selectItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.AddItemsToSel), ACTIONS.selectItems.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveItemFromSel), ACTIONS.unselectItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveItemsFromSel), ACTIONS.unselectItems.MakeEvent());
    this.Go(this.SelectionMenu, ACTIONS.selectionMenu.MakeEvent());

    this.Go(SYNC_HANDLER(this.SelectAll), ACTIONS.selectAll.MakeEvent());
    this.Go(SYNC_HANDLER(this.UnselectAll), ACTIONS.unselectAll.MakeEvent());

    this.Go(SYNC_HANDLER(this.SelectNext), SCH_ACTIONS.nextNetItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectPrevious), SCH_ACTIONS.previousNetItem.MakeEvent());

    this.Go(SYNC_HANDLER(this.updateSelection), EVENTS.SelectedItemsModified);
    this.Go(SYNC_HANDLER(this.updateSelection), EVENTS.SelectedItemsMoved);

    this.Go(this.disambiguateCursor, EVENTS.DisambiguatePoint);
  }
}

void TOOL_MANAGER;
