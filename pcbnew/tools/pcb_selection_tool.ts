// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/pcb_selection_tool.cpp` + `.h`: `PCB_SELECTION_TOOL`, the
 * board editor's always-running selection tool.
 *
 * `Main` is the event loop every canvas event reaches through the
 * TOOL_DISPATCHER: a click selects (`selectPoint`, with the collectors, the
 * filters, `GuessSelectionCandidates` and the disambiguation menu), a drag
 * rubber-bands (`SelectRectArea` / `SelectPolyArea` -> `SelectMultiple`) or
 * starts a move, a right click opens the context menu, a double click opens
 * the properties or enters a group. The selection is `m_selection`, a
 * `PCB_SELECTION` of live `BOARD_ITEM`s on `LAYER_SELECT_OVERLAY`, drawn by
 * `PCB_PAINTER` like every other VIEW item.
 *
 * Porting notes (the whole file is the C++, method for method):
 *  - A C++ handler that can block (`Wait()`, the disambiguation menu) is a
 *    generator here and its callers `yield*` it (see common/tool/coroutine.ts).
 *  - A `std::set<T*>` / `std::map<T*, …>` iterates in pointer order; that is
 *    `ptrOrdinal` (libs/core/kicad_algo.ts) here, as for the DRC providers.
 *  - `DIALOG_FILTER_SELECTION::ShowModal()` is the frame's promise; the
 *    handler's tail runs when it settles.
 */

import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { type EDA_ITEM, INSPECT_RESULT, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  BRIGHTENED,
  CANDIDATE,
  ENTERED,
  IS_MOVING,
  IS_NEW,
  SELECTED,
  SKIP_STRUCT,
} from '@ziroeda/common/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { MOUSE_DRAG_ACTION } from '@ziroeda/common/mouse_drag_action.js';
import type { Color4d as COLOR4D } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID, PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSEQ_TestLayers } from '@ziroeda/common/lseq.js';
import { LSET } from '@ziroeda/common/lset.js';
import { SELECTION_AREA } from '@ziroeda/common/preview_items/selection_area.js';
import {
  PCB_SELECTION_FILTER_OPTIONS,
  ZONE_DISPLAY_MODE,
} from '@ziroeda/common/project/board_project_settings.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { SELECTION_MODE, SELECTION_TOOL } from '@ziroeda/common/tool/selection_tool.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import {
  BUT_LEFT,
  BUT_MIDDLE,
  BUT_RIGHT,
  EVENTS,
  MD_ALT,
  MD_CTRL,
  MD_SHIFT,
  TA_MOUSE_UP,
  TA_MOUSE_WHEEL,
  TC_ANY,
  AS_GLOBAL,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { LAYER_ITEM_PAIR } from '@ziroeda/common/view/view.js';
import { VIEW_UPDATE_FLAGS, type VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { wxGetMouseState } from '@ziroeda/common/wx/wx_event.js';
import { WXK } from '@ziroeda/core/wx_keycodes.js';
import { ptrOrdinal } from '@ziroeda/core/kicad_algo.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { BOX2I, BOX2ISafe } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  type Vec2 as VECTOR2D,
  type VECTOR2I,
  toVECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { GENERAL_COLLECTOR, GENERAL_COLLECTORS_GUIDE } from '../collectors.js';
import { EXCLUDE_ZONES, IGNORE_NETS } from '../connectivity/connectivity_data.js';
import type { SelectionFilter } from '../dialogs/dialog_filter_selection.js';
import { FOOTPRINT, type GENERAL_COLLECTOR_FOR_COVERAGE } from '../footprint.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB } from '../padstack.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import type { PCB_DRAW_PANEL_GAL } from '../pcb_draw_panel_gal.js';
import type { PCB_FIELD } from '../pcb_field.js';
import type { PCB_GENERATOR } from '../pcb_generator.js';
import { PCB_GROUP } from '../pcb_group.js';
import type { PCB_MARKER } from '../pcb_marker.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TABLE } from '../pcb_table.js';
import type { PCB_TABLECELL } from '../pcb_tablecell.js';
import type { PCB_TEXT } from '../pcb_text.js';
import type { PCB_TEXTBOX } from '../pcb_textbox.js';
import type { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import type { PCB_VIEW } from '../pcb_view.js';
import { TRACK_DRAG_ACTION } from '../pcbnew_settings.js';
import type { ZONE } from '../zone.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_SELECTION } from './pcb_selection.js';

/**
 * `CLIENT_SELECTION_FILTER` (pcb_selection_conditions.h): a tool's or
 * action's narrowing of what a cursor selection collected.
 */
export type CLIENT_SELECTION_FILTER = (
  aWhere: VECTOR2I,
  aCollector: GENERAL_COLLECTOR,
  aTool: PCB_SELECTION_TOOL,
) => void;

/** The tools `Main` asks for by type; each is registered by the frame when ported. */
interface ROUTER_TOOL_LIKE {
  IsToolActive(): boolean;
  RoutingInProgress(): boolean;
}

interface PCB_POINT_EDITOR_LIKE {
  HasPoint(): boolean;
}

interface BOARD_INSPECTION_TOOL_LIKE {
  ClearHighlight(aEvent: TOOL_EVENT): number;
}

/**
 * `DIALOG_FILTER_SELECTION( m_frame, opts ).ShowModal()`: the frame's modal,
 * editing `aOptions` in place and answering wxID_OK as true.
 */
export interface FILTER_SELECTION_DIALOG_HOST {
  ShowFilterSelectionDialog(aOptions: SelectionFilter): Promise<boolean>;
}

interface LAYER_OPACITY_ITEM {
  m_Layer: PCB_LAYER_ID;
  m_Opacity: number;
  m_Item: BOARD_ITEM;
}

/** `std::set<T*>` iteration: pointer order. */
function ptrSorted<T extends object>(aItems: Iterable<T>): T[] {
  return [...aItems].sort((a, b) => ptrOrdinal(a) - ptrOrdinal(b));
}

/** `std::map<VECTOR2I, …>`'s key order: `VECTOR2::operator<` is x, then y. */
function vecKey(aPt: VECTOR2I): string {
  return `${aPt.x},${aPt.y}`;
}

function vecLess(a: VECTOR2I, b: VECTOR2I): number {
  return a.x !== b.x ? a.x - b.x : a.y - b.y;
}

class SELECT_MENU extends ACTION_MENU {
  constructor() {
    super(true);

    this.SetTitle('Select');

    this.Add(PCB_ACTIONS.filterSelection);

    this.AppendSeparator();

    this.Add(PCB_ACTIONS.selectConnection);
    this.Add(PCB_ACTIONS.selectNet);

    // This could be enabled if we have better logic for picking the target net with the mouse
    // Add( PCB_ACTIONS::deselectNet );
    this.Add(PCB_ACTIONS.selectSameSheet);
    this.Add(PCB_ACTIONS.selectOnSchematic);

    this.Add(PCB_ACTIONS.selectUnconnected);
    this.Add(PCB_ACTIONS.grabUnconnected);
  }

  protected override create(): ACTION_MENU {
    return new SELECT_MENU();
  }
}

/**
 * Private implementation of firewalled private data.
 */
class PRIV {
  /** `DIALOG_FILTER_SELECTION::OPTIONS`, at its member initialisers (all true). */
  m_filterOpts: SelectionFilter = {
    footprints: true,
    lockedFootprints: true,
    tracks: true,
    vias: true,
    zones: true,
    techLayers: true,
    boardOutline: true,
    text: true,
  };
}

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

function passEvent(aEvent: TOOL_EVENT, aAllowedActions: readonly TOOL_ACTION[]): void {
  for (const action of aAllowedActions) {
    if (aEvent.IsAction(action)) {
      aEvent.SetPassEvent();
      break;
    }
  }
}

/**
 * Determine if an item is included by the filter specified.
 *
 * @return true if aItem should be selected by this filter (i..e not filtered out)
 */
export function itemIsIncludedByFilter(
  aItem: BOARD_ITEM,
  aFilterOptions: SelectionFilter,
): boolean {
  switch (aItem.Type()) {
    case KICAD_T.PCB_FOOTPRINT_T: {
      const footprint = aItem as FOOTPRINT;

      return (
        aFilterOptions.footprints && (aFilterOptions.lockedFootprints || !footprint.IsLocked())
      );
    }

    case KICAD_T.PCB_TRACE_T:
    case KICAD_T.PCB_ARC_T:
      return aFilterOptions.tracks;

    case KICAD_T.PCB_VIA_T:
      return aFilterOptions.vias;

    case KICAD_T.PCB_ZONE_T:
      return aFilterOptions.zones;

    case KICAD_T.PCB_SHAPE_T:
    case KICAD_T.PCB_TARGET_T:
    case KICAD_T.PCB_DIM_ALIGNED_T:
    case KICAD_T.PCB_DIM_CENTER_T:
    case KICAD_T.PCB_DIM_RADIAL_T:
    case KICAD_T.PCB_DIM_ORTHOGONAL_T:
    case KICAD_T.PCB_DIM_LEADER_T:
      if (aItem.GetLayer() === PCB_LAYER_ID.Edge_Cuts) return aFilterOptions.boardOutline;
      else return aFilterOptions.techLayers;

    case KICAD_T.PCB_FIELD_T:
    case KICAD_T.PCB_TEXT_T:
    case KICAD_T.PCB_TEXTBOX_T:
    case KICAD_T.PCB_TABLE_T:
    case KICAD_T.PCB_TABLECELL_T:
      return aFilterOptions.text;

    default:
      // Filter dialog is inclusive, not exclusive.  If it's not included, then it doesn't
      // get selected.
      return false;
  }
}

/**
 * `filterSelection`'s OK branch (:3294-3310): the selection's board items that
 * pass, in selection order - what it re-selects after clearing the selection.
 */
export function filterSelectionItems(
  aSelection: Iterable<EDA_ITEM>,
  aFilterOptions: SelectionFilter,
): BOARD_ITEM[] {
  const out: BOARD_ITEM[] = [];

  for (const i of aSelection) {
    if (!i.IsBOARD_ITEM()) continue;

    const item = i as BOARD_ITEM;

    if (itemIsIncludedByFilter(item, aFilterOptions)) out.push(item);
  }

  return out;
}

export function connectedItemFilter(
  _aWhere: VECTOR2I,
  aCollector: GENERAL_COLLECTOR,
  _sTool: PCB_SELECTION_TOOL,
): void {
  // Narrow the collection down to a single BOARD_CONNECTED_ITEM for each represented net.
  // All other items types are removed.
  const representedNets = new Set<number>();

  for (let i = aCollector.GetCount() - 1; i >= 0; i--) {
    const item = aCollector.At(i) as BOARD_ITEM;

    if (!item.IsConnected()) aCollector.Remove(i);
    else if (representedNets.has((item as BOARD_CONNECTED_ITEM).GetNetCode())) aCollector.Remove(i);
    else representedNets.add((item as BOARD_CONNECTED_ITEM).GetNetCode());
  }
}

export enum STOP_CONDITION {
  /**
   * Stop at any place where more than two traces meet.
   *
   * Because vias are also traces, this makes selection stop at a via if there is a trace
   * on another layer as well, but a via with only one connection will be selected.
   */
  STOP_AT_JUNCTION,
  /** Stop when reaching a segment (next track/arc/via). */
  STOP_AT_SEGMENT,
  /** Stop when reaching a pad. */
  STOP_AT_PAD,
  /** Select the entire net. */
  STOP_NEVER,
}

export class PCB_SELECTION_TOOL extends SELECTION_TOOL {
  static readonly STOP_AT_JUNCTION = STOP_CONDITION.STOP_AT_JUNCTION;
  static readonly STOP_AT_SEGMENT = STOP_CONDITION.STOP_AT_SEGMENT;
  static readonly STOP_AT_PAD = STOP_CONDITION.STOP_AT_PAD;
  static readonly STOP_NEVER = STOP_CONDITION.STOP_NEVER;

  private m_frame: PCB_BASE_FRAME | null; // Pointer to the parent frame
  private m_isFootprintEditor: boolean;
  private m_selection = new PCB_SELECTION(); // Current state of selection
  private m_blockedSelection = new PCB_SELECTION(); // Empty selection returned when locked items
  // block an action, real selection stays intact
  private m_filter = new PCB_SELECTION_FILTER_OPTIONS();
  private m_nonModifiedCursor: KICURSOR; // Cursor in the absence of shift/ctrl/alt
  private m_enteredGroup: PCB_GROUP | null; // If non-null, selections are limited to
  // members of this group
  private m_enteredGroupOverlay = new PCB_SELECTION(); // Overlay for the entered group's frame.
  private m_selectionMode: SELECTION_MODE; // Current selection mode
  private m_lockedItemsFiltered: boolean;
  // Anchor cell for shift+click range selection in a PCB_TABLE
  private m_previousFirstCell: PCB_TABLECELL | null;
  /// Private state (opaque pointer/compilation firewall)
  private readonly m_priv = new PRIV();

  constructor() {
    super('common.InteractiveSelection');
    this.m_frame = null;
    this.m_isFootprintEditor = false;
    this.m_nonModifiedCursor = KICURSOR.ARROW;
    this.m_enteredGroup = null;
    this.m_selectionMode = SELECTION_MODE.INSIDE_RECTANGLE;
    this.m_lockedItemsFiltered = false;
    this.m_previousFirstCell = null;

    this.m_filter.lockedItems = false;
    this.m_filter.footprints = true;
    this.m_filter.text = true;
    this.m_filter.tracks = true;
    this.m_filter.vias = true;
    this.m_filter.pads = true;
    this.m_filter.graphics = true;
    this.m_filter.zones = true;
    this.m_filter.keepouts = true;
    this.m_filter.dimensions = true;
    this.m_filter.points = true;
    this.m_filter.otherItems = true;
  }

  /** `~PCB_SELECTION_TOOL`. */
  Destroy(): void {
    this.getView()?.Remove(this.m_selection);
    this.getView()?.Remove(this.m_enteredGroupOverlay);

    this.m_disambiguateTimer.Stop();
  }

  /// @copydoc TOOL_BASE::Init()
  override Init(): boolean {
    const frame = this.getEditFrame<PCB_BASE_FRAME>();

    if (frame?.IsType(FRAME_T.FRAME_FOOTPRINT_VIEWER)) {
      frame.AddStandardSubMenus(this.m_menu);
      return true;
    }

    const selectMenu = new SELECT_MENU();
    selectMenu.SetTool(this);
    this.m_menu.RegisterSubMenu(selectMenu);

    const tableCellTypes = [KICAD_T.PCB_TABLECELL_T];

    const menu = this.m_menu.GetMenu();

    const activeToolCondition = (_aSel: SELECTION): boolean => {
      const pcbFrame = this.getEditFrame<PCB_BASE_FRAME>();
      return !!pcbFrame && !pcbFrame.ToolStackIsEmpty();
    };

    const haveHighlight = (_sel: SELECTION): boolean => {
      const cfg = this.m_toolMgr!.GetView()!.GetPainter().GetSettings();

      return cfg.GetHighlightNetCodes().size !== 0;
    };

    const groupEnterCondition = SELECTION_CONDITIONS.And(
      SELECTION_CONDITIONS.Count(1),
      SELECTION_CONDITIONS.HasType(KICAD_T.PCB_GROUP_T),
    );

    const applyDesignBlockLayoutCondition = (aSel: SELECTION): boolean => {
      for (const item of aSel) {
        if (item.Type() === KICAD_T.PCB_GROUP_T && (item as PCB_GROUP).HasDesignBlockLink()) {
          return true;
        }
      }

      return false;
    };

    const inGroupCondition = (_aSel: SELECTION): boolean => {
      return this.m_enteredGroup !== null;
    };

    const tableCellSelection = SELECTION_CONDITIONS.And(
      SELECTION_CONDITIONS.MoreThan(0),
      SELECTION_CONDITIONS.OnlyTypes(tableCellTypes),
    );

    if (frame?.IsType(FRAME_T.FRAME_PCB_EDITOR)) {
      menu.AddMenu(selectMenu, SELECTION_CONDITIONS.NotEmpty);
      menu.AddSeparator(1000);
    }

    // "Cancel" goes at the top of the context menu when a tool is active
    menu.AddItem(ACTIONS.cancelInteractive, activeToolCondition, 1);
    menu.AddItem(ACTIONS.groupEnter, groupEnterCondition, 1);
    menu.AddItem(ACTIONS.groupLeave, inGroupCondition, 1);
    menu.AddItem(PCB_ACTIONS.applyDesignBlockLayout, applyDesignBlockLayoutCondition, 1);
    menu.AddItem(PCB_ACTIONS.placeLinkedDesignBlock, groupEnterCondition, 1);
    menu.AddItem(PCB_ACTIONS.saveToLinkedDesignBlock, groupEnterCondition, 1);
    menu.AddItem(PCB_ACTIONS.clearHighlight, haveHighlight, 1);
    menu.AddSeparator(haveHighlight, 1);

    menu.AddItem(ACTIONS.selectColumns, tableCellSelection, 2);
    menu.AddItem(ACTIONS.selectRows, tableCellSelection, 2);
    menu.AddItem(ACTIONS.selectTable, tableCellSelection, 2);

    menu.AddSeparator(1);

    if (frame) frame.AddStandardSubMenus(this.m_menu);

    return true;
  }

  /// @copydoc TOOL_BASE::Reset()
  override Reset(aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<PCB_BASE_FRAME>();
    this.m_isFootprintEditor = this.m_frame.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR);

    if (aReason !== RESET_REASON.REDRAW) {
      if (this.m_enteredGroup) this.ExitGroup();

      // Deselect any item being currently in edit, to avoid unexpected behavior and remove
      // pointers to the selected items from containers.
      this.ClearSelection(true);
    }

    if (aReason === RESET_REASON.MODEL_RELOAD)
      this.getView()?.GetPainter().GetSettings().SetHighlight(false);

    // Reinsert the VIEW_GROUP, in case it was removed from the VIEW
    this.view()?.Remove(this.m_selection);
    this.view()?.Add(this.m_selection);

    this.view()?.Remove(this.m_enteredGroupOverlay);
    this.view()?.Add(this.m_enteredGroupOverlay);
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

  IsFootprintEditor(): boolean {
    return this.m_isFootprintEditor;
  }

  /**
   * The main loop.
   */
  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      const dragAction = this.m_frame!.GetDragAction();
      let trackDragAction = TRACK_DRAG_ACTION.MOVE;

      const cfg = this.m_frame!.GetPcbNewSettings();

      if (cfg) trackDragAction = cfg.m_TrackDragAction;

      // on left click, a selection is made, depending on modifiers ALT, SHIFT, CTRL:
      this.setModifiersState(
        evt.Modifier(MD_SHIFT) !== 0,
        evt.Modifier(MD_CTRL) !== 0,
        evt.Modifier(MD_ALT) !== 0,
      );

      const frame = this.getEditFrame<PCB_BASE_FRAME>();
      const brd_editor = !!frame && frame.IsType(FRAME_T.FRAME_PCB_EDITOR);
      const router = this.m_toolMgr!.FindTool(
        'pcbnew.InteractiveRouter',
      ) as unknown as ROUTER_TOOL_LIKE | null;

      // If the router tool is active, don't override
      if (router?.IsToolActive() && router.RoutingInProgress()) {
        evt.SetPassEvent();
      } else if (evt.IsMouseDown(BUT_LEFT)) {
        // Avoid triggering when running under other tools
        const pt_tool = this.m_toolMgr!.FindTool(
          'pcbnew.PointEditor',
        ) as unknown as PCB_POINT_EDITOR_LIKE | null;

        if (this.m_frame!.ToolStackIsEmpty() && pt_tool && !pt_tool.HasPoint()) {
          this.m_originalCursor = this.m_toolMgr!.GetMousePosition();
          this.m_disambiguateTimer.StartOnce(ADVANCED_CFG.GetCfg().m_DisambiguationMenuDelay);
        }
      } else if (evt.IsClick(BUT_LEFT)) {
        // If there is no disambiguation, this routine is still running and will
        // register a `click` event when released
        if (this.m_disambiguateTimer.IsRunning()) {
          this.m_disambiguateTimer.Stop();

          // Single click? Select single object
          if (this.m_highlight_modifier && brd_editor) {
            if (!this.toggleTableCellSelection(evt.Position()))
              this.m_toolMgr!.RunAction(PCB_ACTIONS.highlightNet);
          } else {
            this.m_frame!.ClearFocus();

            // Mirrors eeschema's SCH_TABLE shift+click range select.
            if (!this.extendTableCellSelectionTo(evt.Position())) {
              yield* this.selectPoint(evt.Position());

              // Anchor for a subsequent shift+click or shift+drag whose IsClick
              // jitter could otherwise promote into IsDrag, collapsing the range
              // rectangle to (DragOrigin, Position) at the press point.
              this.m_previousFirstCell = this.singleSelectedCell();
            }
          }
        }

        this.m_canceledMenu = false;
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_disambiguateTimer.Stop();

        // Right click? if there is any object - show the context menu
        const selectionCancelled = { value: false };

        if (this.m_selection.Empty()) {
          yield* this.selectPoint(evt.Position(), false, selectionCancelled);
          this.m_selection.SetIsHover(true);
        }

        // Show selection before opening menu
        this.m_frame!.GetCanvas()!.ForceRefresh();

        if (!selectionCancelled.value) {
          this.m_toolMgr!.VetoContextMenuMouseWarp();
          this.m_menu.ShowContextMenu(this.m_selection);
        }
      } else if (evt.IsDblClick(BUT_LEFT)) {
        this.m_disambiguateTimer.Stop();

        // Double clicks make no sense in the footprint viewer
        if (frame?.IsType(FRAME_T.FRAME_FOOTPRINT_VIEWER)) {
          evt.SetPassEvent();
          continue;
        }

        // Double click? Display the properties window
        this.m_frame!.ClearFocus();

        if (this.m_selection.Empty()) yield* this.selectPoint(evt.Position());

        if (
          this.m_selection.GetSize() === 1 &&
          this.m_selection.at(0)!.Type() === KICAD_T.PCB_GROUP_T
        )
          this.EnterGroup();
        else this.m_toolMgr!.RunAction(PCB_ACTIONS.properties);
      } else if (evt.IsDblClick(BUT_MIDDLE)) {
        // Middle double click?  Do zoom to fit or zoom to objects
        if (evt.Modifier(MD_CTRL))
          // Is CTRL key down?
          this.m_toolMgr!.RunAction(ACTIONS.zoomFitObjects);
        else this.m_toolMgr!.RunAction(ACTIONS.zoomFitScreen);
      } else if (evt.Action() === TA_MOUSE_WHEEL) {
        let field = -1;

        if (evt.Modifier() === (MD_SHIFT | MD_ALT)) field = 0;
        else if (evt.Modifier() === (MD_CTRL | MD_ALT)) field = 1;
        // any more?

        if (field >= 0) {
          const delta = evt.Parameter<number>();
          const params = { delta: delta > 0 ? 1 : -1, field };

          this.m_toolMgr!.RunAction(ACTIONS.increment, params);
        }
      } else if (evt.IsDrag(BUT_LEFT)) {
        this.m_disambiguateTimer.Stop();

        // Is another tool already moving a new object?  Don't allow a drag start
        if (!this.m_selection.Empty() && this.m_selection.at(0)!.HasFlag(IS_NEW | IS_MOVING)) {
          evt.SetPassEvent();
          continue;
        }

        // Drag with LMB? Select multiple objects (or at least draw a selection box)
        // or drag them
        this.m_frame!.ClearFocus();
        this.m_toolMgr!.ProcessEvent(EVENTS.InhibitSelectionEditing);

        const hoverCells = new GENERAL_COLLECTOR();
        this.collectTableCellsAt(evt.DragOrigin(), hoverCells);

        if (hoverCells.GetCount()) {
          if (
            this.m_selection.Empty() ||
            SELECTION_CONDITIONS.OnlyTypes([KICAD_T.PCB_TABLECELL_T])(this.m_selection)
          ) {
            yield* this.selectTableCells(hoverCells.At(0)!.GetParent() as PCB_TABLE);
          } else {
            this.m_toolMgr!.RunAction(PCB_ACTIONS.move);
          }
        } else if (
          this.hasModifier() ||
          dragAction === MOUSE_DRAG_ACTION.SELECT ||
          (this.m_selection.Empty() && dragAction !== MOUSE_DRAG_ACTION.DRAG_ANY)
        ) {
          if (
            this.m_selectionMode === SELECTION_MODE.INSIDE_RECTANGLE ||
            this.m_selectionMode === SELECTION_MODE.TOUCHING_RECTANGLE
          ) {
            yield* this.SelectRectArea(aEvent);
          } else if (
            this.m_selectionMode === SELECTION_MODE.INSIDE_LASSO ||
            this.m_selectionMode === SELECTION_MODE.TOUCHING_LASSO
          ) {
            yield* this.SelectPolyArea(aEvent);
          } else {
            console.assert(false, 'Unknown selection mode');
            yield* this.SelectRectArea(aEvent);
          }
        } else {
          // Don't allow starting a drag from a zone filled area that isn't already selected
          const zoneFilledAreaFilter: CLIENT_SELECTION_FILTER = (aWhere, aCollector, _aTool) => {
            const accuracy = aCollector.GetGuide()!.Accuracy();
            const remove = new Set<EDA_ITEM>();

            for (const item of aCollector) {
              if (item.Type() === KICAD_T.PCB_ZONE_T) {
                const zone = item as ZONE;

                if (
                  !zone.HitTestForCorner(aWhere, accuracy * 2) &&
                  !zone.HitTestForEdge(aWhere, accuracy)
                ) {
                  remove.add(zone);
                }
              }
            }

            for (const item of ptrSorted(remove)) aCollector.Remove(item);
          };

          // See if we can drag before falling back to SelectRectArea()
          let doDrag = false;

          if (evt.HasPosition()) {
            if (
              this.m_selection.Empty() &&
              (yield* this.selectPoint(evt.DragOrigin(), false, null, zoneFilledAreaFilter))
            ) {
              this.m_selection.SetIsHover(true);
              doDrag = true;
            }
            // Check if dragging has started within any of selected items bounding box.
            else if (evt.HasPosition() && this.selectionContains(evt.DragOrigin())) {
              doDrag = true;
            }
          }

          if (doDrag) {
            const segs = this.m_selection.CountType(KICAD_T.PCB_TRACE_T);
            const arcs = this.m_selection.CountType(KICAD_T.PCB_ARC_T);
            const vias = this.m_selection.CountType(KICAD_T.PCB_VIA_T);
            // Note: multi-track dragging is currently supported, but not multi-via
            const routable =
              (segs >= 1 || arcs >= 1 || vias === 1) &&
              segs + arcs + vias === this.m_selection.GetSize();

            if (routable && trackDragAction === TRACK_DRAG_ACTION.DRAG)
              this.m_toolMgr!.RunAction(PCB_ACTIONS.drag45Degree);
            else if (routable && trackDragAction === TRACK_DRAG_ACTION.DRAG_FREE_ANGLE)
              this.m_toolMgr!.RunAction(PCB_ACTIONS.dragFreeAngle);
            else this.m_toolMgr!.RunAction(PCB_ACTIONS.move);
          } else {
            // Otherwise drag a selection box
            if (
              this.m_selectionMode === SELECTION_MODE.INSIDE_LASSO ||
              this.m_selectionMode === SELECTION_MODE.TOUCHING_LASSO
            ) {
              yield* this.SelectPolyArea(aEvent);
            } else {
              yield* this.SelectRectArea(aEvent);
            }
          }
        }
      } else if (evt.IsCancel()) {
        this.m_disambiguateTimer.Stop();
        this.m_frame!.ClearFocus();

        if (!this.GetSelection().Empty()) {
          this.ClearSelection();
        } else if (evt.FirstResponder() === this && evt.GetCommandId() === WXK.WXK_ESCAPE) {
          if (this.m_enteredGroup) {
            this.ExitGroup();
          } else {
            const controller = this.m_toolMgr!.FindTool(
              'pcbnew.InspectionTool',
            ) as unknown as BOARD_INSPECTION_TOOL_LIKE | null;

            try {
              if (controller && this.m_frame!.GetPcbNewSettings().m_ESCClearsNetHighlight)
                controller.ClearHighlight(evt);
            } catch (e) {
              console.assert(false, (e as Error).message);
              return 0;
            }
          }
        }
      } else {
        evt.SetPassEvent();
      }

      if (this.m_frame!.ToolStackIsEmpty()) {
        // move cursor prediction
        if (
          !this.hasModifier() &&
          dragAction === MOUSE_DRAG_ACTION.DRAG_SELECTED &&
          !this.m_selection.Empty() &&
          evt.HasPosition() &&
          this.selectionContains(evt.Position())
        ) {
          this.m_nonModifiedCursor = KICURSOR.MOVING;
        } else {
          this.m_nonModifiedCursor = KICURSOR.ARROW;
        }
      }
    }

    // Shutting down; clear the selection
    this.m_previousFirstCell = null;
    this.m_selection.Clear();
    this.m_disambiguateTimer.Stop();

    return 0;
  }

  /**
   * Enter the group at the head of the current selection.
   */
  override EnterGroup(): void {
    if (
      !(this.m_selection.GetSize() === 1 && this.m_selection.at(0)!.Type() === KICAD_T.PCB_GROUP_T)
    ) {
      console.assert(false, 'EnterGroup called when selection is not a single group');
      return;
    }

    const aGroup = this.m_selection.at(0) as PCB_GROUP;

    if (this.m_enteredGroup !== null) this.ExitGroup();

    this.ClearSelection();
    this.m_enteredGroup = aGroup;
    this.m_enteredGroup.SetFlags(ENTERED);

    for (const member of this.m_enteredGroup.GetItems()) this.select(member);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    // Processing the selection event can re-enter the tool and ExitGroup(), which clears
    // m_enteredGroup. If that happened, don't operate on the now-stale (possibly null) group
    // or we would hide/overlay a null item and crash (issue #24391).
    if (this.m_enteredGroup !== aGroup) return;

    this.view()?.Hide(this.m_enteredGroup, true);
    this.m_enteredGroupOverlay.Add(this.m_enteredGroup);
    this.view()?.Update(this.m_enteredGroupOverlay);
  }

  /**
   * Leave the currently-entered group.
   *
   * @param aSelectGroup [optional] Select the group after leaving.
   */
  override ExitGroup(aSelectGroup = false): void {
    // Only continue if there is a group entered
    if (this.m_enteredGroup === null) return;

    this.m_enteredGroup.ClearFlags(ENTERED);
    this.view()?.Hide(this.m_enteredGroup, false);
    this.ClearSelection();

    if (aSelectGroup) {
      this.select(this.m_enteredGroup);
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    }

    this.m_enteredGroupOverlay.Clear();
    this.m_enteredGroup = null;
    this.view()?.Update(this.m_enteredGroupOverlay);
  }

  /**
   * @return the currently-entered group.
   */
  GetEnteredGroup(): PCB_GROUP | null {
    return this.m_enteredGroup;
  }

  GetActiveLayer(): PCB_LAYER_ID {
    return this.m_frame!.GetActiveLayer();
  }

  /**
   * @return the set of currently selected items.
   */
  override GetSelection(): PCB_SELECTION {
    return this.m_selection;
  }

  /**
   * Return the current selection, filtered according to aClientFilter.
   *
   * If the set is empty, performs the legacy-style hover selection.
   *
   * @param aClientFilter A callback to allow tool- or action-specific filtering.
   */
  RequestSelection(aClientFilter: CLIENT_SELECTION_FILTER | null): PCB_SELECTION {
    const selectionEmpty = this.m_selection.Empty();
    this.m_selection.SetIsHover(selectionEmpty);
    this.m_lockedItemsFiltered = false;

    if (selectionEmpty) {
      this.m_toolMgr!.RunAction(ACTIONS.selectionCursor, aClientFilter);
      this.m_selection.ClearReferencePoint();
    }

    if (aClientFilter) {
      const BEFORE = 1;
      const AFTER = 2;
      const BOTH = 3;

      const itemDispositions = new Map<EDA_ITEM, number>();
      const guide = this.getCollectorsGuide();
      const collector = new GENERAL_COLLECTOR();

      collector.SetGuide(guide);

      for (const item of this.m_selection) {
        collector.Append(item);
        itemDispositions.set(item, BEFORE);
      }

      aClientFilter({ x: 0, y: 0 }, collector, this);

      // Locked items were filtered with Override locks off. Keep the selection and return an
      // empty one so the action does nothing. The banner then prompts to enable the override.
      if (this.m_lockedItemsFiltered) {
        this.m_frame!.GetCanvas()!.ForceRefresh();
        this.m_blockedSelection.Clear();
        return this.m_blockedSelection;
      }

      for (const item of collector) {
        if (itemDispositions.has(item)) itemDispositions.set(item, BOTH);
        else itemDispositions.set(item, AFTER);
      }

      // Unhighlight the BEFORE items before highlighting the AFTER items.
      // This is so that in the case of groups, if aClientFilter replaces a selection
      // with the enclosing group, the unhighlight of the element doesn't undo the
      // recursive highlighting of that element by the group.

      // std::map<EDA_ITEM*, DISPOSITION>: pointer order
      const ordered = ptrSorted(itemDispositions.keys());

      for (const item of ordered) {
        const disposition = itemDispositions.get(item);

        if (disposition === BEFORE) this.unhighlight(item, SELECTED, this.m_selection);
      }

      for (const item of ordered) {
        const disposition = itemDispositions.get(item);

        // Note that we must re-highlight even previously-highlighted items
        // (ie: disposition BOTH) in case we removed any of their children.
        if (disposition === AFTER || disposition === BOTH)
          this.highlight(item, SELECTED, this.m_selection);
      }

      this.m_frame!.GetCanvas()!.ForceRefresh();
    }

    return this.m_selection;
  }

  getCollectorsGuide(): GENERAL_COLLECTORS_GUIDE {
    const board = this.board();
    const view = this.view();
    const guide = new GENERAL_COLLECTORS_GUIDE(
      board.GetVisibleLayers(),
      view.GetTopLayer() as PCB_LAYER_ID,
      view.ToWorld({ x: 1, y: 1 }, false).x,
    );

    const padsDisabled = !board.IsElementVisible(GAL_LAYER_ID.LAYER_PADS);

    // account for the globals
    guide.SetIgnoreFPTextOnBack(!board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_TEXT));
    guide.SetIgnoreFPTextOnFront(!board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_TEXT));
    guide.SetIgnoreFootprintsOnBack(!board.IsElementVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK));
    guide.SetIgnoreFootprintsOnFront(!board.IsElementVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR));
    guide.SetIgnorePadsOnBack(padsDisabled);
    guide.SetIgnorePadsOnFront(padsDisabled);
    guide.SetIgnoreThroughHolePads(padsDisabled);
    guide.SetIgnoreFPValues(!board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_VALUES));
    guide.SetIgnoreFPReferences(!board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_REFERENCES));
    guide.SetIgnoreThroughVias(!board.IsElementVisible(GAL_LAYER_ID.LAYER_VIAS));
    guide.SetIgnoreBlindBuriedVias(!board.IsElementVisible(GAL_LAYER_ID.LAYER_VIAS));
    guide.SetIgnoreMicroVias(!board.IsElementVisible(GAL_LAYER_ID.LAYER_VIAS));
    guide.SetIgnoreTracks(!board.IsElementVisible(GAL_LAYER_ID.LAYER_TRACKS));

    return guide;
  }

  protected override ctrlClickHighlights(): boolean {
    return (
      !!this.m_frame &&
      !!this.m_frame.GetPcbNewSettings() &&
      this.m_frame.GetPcbNewSettings().m_CtrlClickHighlight &&
      !this.m_isFootprintEditor
    );
  }

  protected override selection(): SELECTION {
    return this.m_selection;
  }

  /**
   * Select an item pointed by the parameter \a aWhere.
   *
   * If there is more than one item at that place, there is a menu displayed that allows
   * one to choose the item.
   *
   * @param aWhere is the place where the item should be selected.
   * @param aOnDrag indicates whether a drag operation is being performed.
   * @param aSelectionCancelledFlag allows the function to inform its caller that a selection
   *                                was canceled (for instance, by clicking outside of the
   *                                disambiguation menu).
   * @param aClientFilter a callback to allow tool- or action-specific filtering.
   * @return whether or not the selection is empty.
   */
  private *selectPoint(
    aPoint: VECTOR2D,
    aOnDrag = false,
    aSelectionCancelledFlag: { value: boolean } | null = null,
    aClientFilter: CLIENT_SELECTION_FILTER | null = null,
  ): COROUTINE_BODY<boolean> {
    // `const VECTOR2I& aWhere`: every caller hands a VECTOR2D (an event's Position(),
    // DragOrigin(), GetCursorPosition()), which C++ converts here - clamped, then truncated
    // to int. Passed through as a double, a fractional board position reached the track
    // hit-test's BigInt and threw, aborting the click.
    const aWhere = toVECTOR2I(aPoint);
    const guide = this.getCollectorsGuide();
    const collector = new GENERAL_COLLECTOR();
    const displayOpts = this.m_frame!.GetDisplayOptions();

    guide.SetIgnoreZoneFills(displayOpts.m_ZoneDisplayMode !== ZONE_DISPLAY_MODE.SHOW_FILLED);

    if (this.m_enteredGroup && !this.m_enteredGroup.GetBoundingBox().Contains(aWhere))
      this.ExitGroup();

    collector.Collect(
      this.board(),
      this.m_isFootprintEditor ? GENERAL_COLLECTOR.FootprintItems : GENERAL_COLLECTOR.AllBoardItems,
      aWhere,
      guide,
    );

    // Remove unselectable items
    for (let i = collector.GetCount() - 1; i >= 0; --i) {
      const item = collector.At(i) as BOARD_ITEM;

      if (!this.Selectable(item) || (aOnDrag && item.IsLocked())) collector.Remove(i);
    }

    this.m_selection.ClearReferencePoint();

    const preFilterCount = collector.GetCount();
    const rejected = new PCB_SELECTION_FILTER_OPTIONS();
    rejected.SetAll(false);

    // Apply the stateful filter (remove items disabled by the Selection Filter)
    this.FilterCollectedItems(collector, false, rejected);

    if (collector.GetCount() === 0 && preFilterCount > 0) {
      // dynamic_cast<PCB_BASE_EDIT_FRAME*>( m_frame )
      const editFrame = this.m_frame as Partial<PCB_BASE_EDIT_FRAME>;

      if (typeof editFrame.HighlightSelectionFilter === 'function')
        editFrame.HighlightSelectionFilter(rejected);

      if (
        !this.m_additive &&
        !this.m_subtractive &&
        !this.m_exclusive_or &&
        this.m_selection.GetSize() > 0
      ) {
        this.ClearSelection(true /*quiet mode*/);
        this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
        return true;
      }

      return false;
    }

    // Allow the client to do tool- or action-specific filtering to see if we can get down
    // to a single item
    if (aClientFilter) aClientFilter(aWhere, collector, this);

    this.FilterCollectorForHierarchy(collector, false);

    this.FilterCollectorForFootprints(collector, aWhere);

    // For subtracting, we only want items that are selected
    if (this.m_subtractive) {
      for (let i = collector.GetCount() - 1; i >= 0; --i) {
        if (!collector.At(i)!.IsSelected()) collector.Remove(i);
      }
    }

    // Apply some ugly heuristics to avoid disambiguation menus whenever possible
    if (collector.GetCount() > 1 && !this.m_skip_heuristics) {
      try {
        this.GuessSelectionCandidates(collector, aWhere);
      } catch (exc) {
        console.warn(
          `Exception '${(exc as Error).message}' occurred attempting to guess selection candidates.`,
        );
        return false;
      }
    }

    // If still more than one item we're going to have to ask the user.
    if (collector.GetCount() > 1) {
      if (aOnDrag) yield* this.Wait(new TOOL_EVENT(TC_ANY, TA_MOUSE_UP, BUT_LEFT, AS_GLOBAL));

      if (!(yield* this.doSelectionMenu(collector))) {
        if (aSelectionCancelledFlag) aSelectionCancelledFlag.value = true;

        return false;
      }
    }

    let addedCount = 0;
    let anySubtracted = false;

    if (!this.m_additive && !this.m_subtractive && !this.m_exclusive_or) {
      if (this.m_selection.GetSize() > 0) {
        this.ClearSelection(true /*quiet mode*/);
        anySubtracted = true;
      }
    }

    if (collector.GetCount() > 0) {
      for (let i = 0; i < collector.GetCount(); ++i) {
        const item = collector.At(i)!;

        if (this.m_subtractive || (this.m_exclusive_or && item.IsSelected())) {
          this.unselect(item);
          anySubtracted = true;
        } else {
          this.select(item);
          addedCount++;
        }
      }
    }

    if (addedCount === 1) {
      this.m_toolMgr!.ProcessEvent(EVENTS.PointSelectedEvent);
      return true;
    } else if (addedCount > 1) {
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
      return true;
    } else if (anySubtracted) {
      this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
      return true;
    }

    return false;
  }

  /**
   * Select an item under the cursor unless there is something already selected.
   *
   * @param aForceSelect [optional] Forces an item to be selected even if there is already a
   *                     selection.
   * @param aClientFilter A callback to allow tool- or action-specific filtering.
   * @return whether or not the selection is empty.
   */
  private *selectCursor(
    aForceSelect = false,
    aClientFilter: CLIENT_SELECTION_FILTER | null = null,
  ): COROUTINE_BODY<boolean> {
    if (aForceSelect || this.m_selection.Empty()) {
      this.ClearSelection(true /*quiet mode*/);
      yield* this.selectPoint(this.controls().GetCursorPosition(false), false, null, aClientFilter);
    }

    return !this.m_selection.Empty();
  }

  /**
   * Mark the existing selection state of table cells so that drag- and
   * shift-click range selection can preserve previously-selected cells.
   */
  private initializeTableCellSelectionState(aTable: PCB_TABLE): void {
    for (const cell of aTable.GetCells()) {
      if (cell.IsSelected()) cell.SetFlags(CANDIDATE);
      else cell.ClearFlags(CANDIDATE);
    }
  }

  /**
   * Select table cells contained within the rectangle defined by two corner points,
   * combining the result with the prior selection state (recorded by
   * initializeTableCellSelectionState) according to the current modifier keys.
   */
  private selectCellsBetween(aStart: VECTOR2D, aEnd: VECTOR2D, aTable: PCB_TABLE): void {
    const selectionRect = new BOX2I(
      { x: KiROUND(aStart.x), y: KiROUND(aStart.y) },
      { x: KiROUND(aEnd.x), y: KiROUND(aEnd.y) },
    );
    selectionRect.Normalize();

    const wasSelected = (aItem: EDA_ITEM): boolean => (aItem.GetFlags() & CANDIDATE) > 0;

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

  /**
   * If the current selection holds one or more cells from a single PCB_TABLE and the
   * cursor is over another cell in that same table, extend the selection to cover the
   * rectangular range between the original anchor cell and the cell under @p aPosition.
   *
   * @return true if a range selection was performed; false if the caller should fall
   *         back to a normal point selection.
   */
  private extendTableCellSelectionTo(aPosition: VECTOR2I): boolean {
    if (
      !this.m_additive ||
      this.m_selection.GetSize() === 0 ||
      this.m_selection.at(0)!.Type() !== KICAD_T.PCB_TABLECELL_T
    ) {
      return false;
    }

    const clickCells = new GENERAL_COLLECTOR();
    this.collectTableCellsAt(aPosition, clickCells);

    if (clickCells.GetCount() !== 1) return false;

    const clickedCell = clickCells.At(0) as PCB_TABLECELL;
    const firstCell = this.m_selection.at(0) as PCB_TABLECELL;
    const parentTable = clickedCell.GetParent() as PCB_TABLE;

    // Drop the cached anchor when the selection no longer holds only cells of the
    // clicked table, so it cannot survive into a later shift+drag on a different table.
    for (const item of this.m_selection) {
      if (item.Type() !== KICAD_T.PCB_TABLECELL_T || item.GetParent() !== parentTable) {
        this.m_previousFirstCell = null;
        return false;
      }
    }

    // Contains() prevents reading GetCenter() on a cell freed by an external mutation
    // that did not clear the cached anchor.
    if (!this.m_previousFirstCell || !this.m_selection.Contains(this.m_previousFirstCell))
      this.m_previousFirstCell = firstCell;

    if (this.m_previousFirstCell.GetParent() !== parentTable) {
      this.m_previousFirstCell = null;
      return false;
    }

    // Snapshot the prior selection so we can fire SelectedEvent/UnselectedEvent based
    // on the net delta rather than on every range change.
    const previousSelection = new Set<EDA_ITEM>();

    for (const item of this.m_selection) previousSelection.add(item);

    // Restore main-view visibility of the previously-selected cells via the overlay
    // mechanism; ClearSelected() alone would leave them hidden because
    // highlightInternal/unhighlightInternal toggle view()->Hide.
    while (this.m_selection.GetSize()) this.unselect(this.m_selection.Front()!);

    this.initializeTableCellSelectionState(parentTable);

    const start = this.m_previousFirstCell.GetCenter();
    const end = clickedCell.GetCenter();
    const topLeft = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
    const bottomRight = { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) };

    this.selectCellsBetween(
      topLeft,
      { x: bottomRight.x - topLeft.x, y: bottomRight.y - topLeft.y },
      parentTable,
    );

    let anyAdded = false;
    let anySubtracted = false;

    for (const cell of parentTable.GetCells()) {
      const wasInPrevious = previousSelection.has(cell);

      if (cell.IsSelected() && !wasInPrevious) anyAdded = true;
      else if (wasInPrevious && !cell.IsSelected()) anySubtracted = true;
    }

    if (anyAdded) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    if (anySubtracted) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

    return true;
  }

  /**
   * Collect PCB_TABLECELL items at @p aPosition into @p aCollector, scoped to either
   * the active footprint (in the footprint editor) or the full board.
   */
  private collectTableCellsAt(aPosition: VECTOR2I, aCollector: GENERAL_COLLECTOR): void {
    const scope: BOARD_ITEM =
      this.m_isFootprintEditor && this.board().GetFirstFootprint()
        ? this.board().GetFirstFootprint()!
        : this.board();

    aCollector.Collect(scope, [KICAD_T.PCB_TABLECELL_T], aPosition, this.getCollectorsGuide());
  }

  /**
   * @return the single PCB_TABLECELL in the current selection, or nullptr if the
   *         selection is empty, has more than one item, or holds something else.
   */
  private singleSelectedCell(): PCB_TABLECELL | null {
    if (this.m_selection.GetSize() !== 1) return null;

    const item = this.m_selection.at(0)!;

    return item.Type() === KICAD_T.PCB_TABLECELL_T ? (item as PCB_TABLECELL) : null;
  }

  /**
   * When the user Ctrl-clicks inside a PCB_TABLE whose cells are already in the selection,
   * toggle that cell into or out of the selection instead of triggering the net-highlight
   * action.
   *
   * @return true if a toggle was performed; false if the caller should fall back to the
   *         usual Ctrl-click action (net highlight).
   */
  private toggleTableCellSelection(aPosition: VECTOR2I): boolean {
    if (this.m_selection.GetSize() === 0) return false;

    const first = this.m_selection.at(0)!;

    if (first.Type() !== KICAD_T.PCB_TABLECELL_T) return false;

    const firstCell = first as PCB_TABLECELL;

    // Suppress highlightNet only when every selected item is a cell of the same table;
    // a mixed selection must fall through to the usual Ctrl+click action.
    const selectedTable = firstCell.GetParent() as PCB_TABLE;

    for (const item of this.m_selection) {
      if (item.Type() !== KICAD_T.PCB_TABLECELL_T || item.GetParent() !== selectedTable)
        return false;
    }

    const clickCells = new GENERAL_COLLECTOR();
    this.collectTableCellsAt(aPosition, clickCells);

    if (clickCells.GetCount() !== 1) return false;

    const clickedCell = clickCells.At(0) as PCB_TABLECELL;

    if (clickedCell.GetParent() !== selectedTable) return false;

    if (clickedCell.IsSelected()) {
      this.unselect(clickedCell);
      this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
    } else {
      this.select(clickedCell);
      this.m_toolMgr!.ProcessEvent(EVENTS.PointSelectedEvent);
    }

    // A toggle breaks the contiguous-rectangle invariant the anchor represents.
    this.m_previousFirstCell = null;

    return true;
  }

  private *selectTableCells(aTable: PCB_TABLE): COROUTINE_BODY<boolean> {
    let cancelled = false; // Was the tool canceled while it was running?
    this.m_multiple = true; // Multiple selection mode is active

    // Shift+click can jitter into IsDrag, collapsing DragOrigin..Position to the press
    // point; honour the cached anchor instead.  Snapshot its coordinate so the drag loop
    // never dereferences a cell that an external mutation could free underneath us.
    let haveAnchorStart = false;
    let anchorStart: VECTOR2D = { x: 0, y: 0 };

    if (
      this.m_additive &&
      this.m_previousFirstCell &&
      this.m_selection.Contains(this.m_previousFirstCell) &&
      this.m_previousFirstCell.GetParent() === aTable
    ) {
      anchorStart = { ...this.m_previousFirstCell.GetCenter() };
      haveAnchorStart = true;
    } else if (this.m_previousFirstCell && !this.m_selection.Contains(this.m_previousFirstCell)) {
      this.m_previousFirstCell = null;
    }

    this.initializeTableCellSelectionState(aTable);

    const wasSelected = (aItem: EDA_ITEM): boolean => (aItem.GetFlags() & CANDIDATE) > 0;

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        break;
      } else if (evt.IsDrag(BUT_LEFT)) {
        this.controls().SetAutoPan(true);

        const start = haveAnchorStart ? anchorStart : { ...evt.DragOrigin() };
        const end = { ...evt.Position() };

        this.selectCellsBetween(start, { x: end.x - start.x, y: end.y - start.y }, aTable);
      } else if (evt.IsMouseUp(BUT_LEFT)) {
        this.m_selection.SetIsHover(false);

        let anyAdded = false;
        let anySubtracted = false;

        for (const cell of aTable.GetCells()) {
          if (cell.IsSelected() && !wasSelected(cell)) anyAdded = true;
          else if (wasSelected(cell) && !cell.IsSelected()) anySubtracted = true;
        }

        // Inform other potentially interested tools
        if (anyAdded) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

        if (anySubtracted) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

        break; // Stop waiting for events
      } else {
        // Allow some actions for navigation
        passEvent(evt, allowedActions);
      }
    }

    this.controls().SetAutoPan(false);

    this.m_multiple = false; // Multiple selection mode is inactive

    if (!cancelled) this.m_selection.ClearReferencePoint();

    return cancelled;
  }

  /**
   * Handles drawing a selection box that allows multiple items to be selected simultaneously.
   *
   * @return true if the operation was canceled (i.e. a CancelEvent was received).
   */
  *SelectRectArea(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
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
      let greedySelection = area.GetEnd().x < area.GetOrigin().x;

      if (view.IsMirroredX()) greedySelection = !greedySelection;

      this.m_frame!.GetCanvas()!.SetCurrentCursor(
        !greedySelection ? KICURSOR.SELECT_WINDOW : KICURSOR.SELECT_LASSO,
      );

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        break;
      }

      if (evt.IsDrag(BUT_LEFT)) {
        if (!this.m_drag_additive && !this.m_drag_subtractive) {
          if (this.m_selection.GetSize() > 0) {
            this.ClearSelection(true /*quiet mode*/);
            this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
          }
        }

        // Start drawing a selection box
        area.SetOrigin(evt.DragOrigin());
        area.SetEnd(evt.Position());
        area.SetAdditive(this.m_drag_additive);
        area.SetSubtractive(this.m_drag_subtractive);
        area.SetExclusiveOr(false);
        area.SetMode(
          greedySelection ? SELECTION_MODE.TOUCHING_RECTANGLE : SELECTION_MODE.INSIDE_RECTANGLE,
        );

        view.SetVisible(area, true);
        view.Update(area);
        this.controls().SetAutoPan(true);
      }

      if (evt.IsMouseUp(BUT_LEFT)) {
        this.controls().SetAutoPan(false);

        // End drawing the selection box
        view.SetVisible(area, false);

        this.SelectMultiple(area, this.m_subtractive, this.m_exclusive_or);

        break; // Stop waiting for events
      }

      // Allow some actions for navigation
      passEvent(evt, allowedActions);
    }

    this.controls().SetAutoPan(false);

    // Stop drawing the selection box
    view.Remove(area);
    this.m_multiple = false; // Multiple selection mode is inactive

    if (!cancelled) this.m_selection.ClearReferencePoint();

    this.m_toolMgr!.ProcessEvent(EVENTS.UninhibitSelectionEditing);

    return cancelled ? 1 : 0;
  }

  ///< Change the selection mode
  SetSelectPoly(_aEvent: TOOL_EVENT): number {
    this.m_selectionMode = SELECTION_MODE.INSIDE_LASSO;
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.SELECT_LASSO);
    this.m_toolMgr!.PostAction(ACTIONS.selectionTool);
    return 0; // No need to wait for an event, just set the mode
  }

  SetSelectRect(_aEvent: TOOL_EVENT): number {
    this.m_selectionMode = SELECTION_MODE.INSIDE_RECTANGLE;
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    this.m_toolMgr!.PostAction(ACTIONS.selectionTool);
    return 0; // No need to wait for an event, just set the mode
  }

  /**
   * Handles drawing a lasso selection area that allows multiple items to be selected
   * simultaneously.
   *
   * @return true if the operation was canceled (i.e. a CancelEvent was received).
   */
  *SelectPolyArea(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let cancelled = false; // Was the tool canceled while it was running?

    let selectionMode = SELECTION_MODE.TOUCHING_LASSO;
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.SELECT_LASSO);

    const points = new SHAPE_LINE_CHAIN();
    points.SetClosed(true);

    const area = new SELECTION_AREA();
    this.getView()!.Add(area);
    this.getView()!.SetVisible(area, true);
    this.controls().SetAutoPan(true);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      // Auto mode: clockwise = inside, counterclockwise = touching
      const shapeArea = area.GetPoly().Area(false);
      let isClockwise = shapeArea > 0;

      if (this.getView()!.IsMirroredX() && shapeArea !== 0) isClockwise = !isClockwise;

      selectionMode = isClockwise ? SELECTION_MODE.INSIDE_LASSO : SELECTION_MODE.TOUCHING_LASSO;

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        cancelled = true;
        evt.SetPassEvent(false);
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
        this.SelectMultiple(area, this.m_subtractive, this.m_exclusive_or);
        evt.SetPassEvent(false);
        break;
      } else if (
        evt.IsAction(PCB_ACTIONS.deleteLastPoint) ||
        evt.IsAction(ACTIONS.doDelete) ||
        evt.IsAction(ACTIONS.undo)
      ) {
        if (points.GetPointCount() > 0) {
          this.controls().SetCursorPosition(points.CLastPoint());
          points.Remove(points.GetPointCount() - 1);
        }
      } else {
        // Allow navigation actions
        passEvent(evt, allowedActions);
      }

      if (points.PointCount() > 0) {
        if (!this.m_drag_additive && !this.m_drag_subtractive) {
          if (this.m_selection.GetSize() > 0) {
            this.ClearSelection(true /*quiet mode*/);
            this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
          }
        }
      }

      area.SetPoly(points);
      area.GetPoly().Append(this.m_toolMgr!.GetMousePosition());
      area.SetAdditive(this.m_additive);
      area.SetSubtractive(this.m_subtractive);
      area.SetExclusiveOr(false);
      area.SetMode(selectionMode);
      this.getView()!.Update(area);
    }

    this.controls().SetAutoPan(false);
    this.getView()!.SetVisible(area, false);
    this.getView()!.Remove(area);
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);

    if (!cancelled) this.GetSelection().ClearReferencePoint();

    this.m_toolMgr!.ProcessEvent(EVENTS.UninhibitSelectionEditing);

    return cancelled ? 1 : 0;
  }

  /**
   * Selects multiple PCB items within a specified area.
   */
  SelectMultiple(aArea: SELECTION_AREA, aSubtractive = false, aExclusiveOr = false): void {
    const view = this.getView()!;

    let anyAdded = false;
    let anySubtracted = false;

    const selectionMode = aArea.GetMode();
    const containedMode =
      selectionMode === SELECTION_MODE.INSIDE_RECTANGLE ||
      selectionMode === SELECTION_MODE.INSIDE_LASSO;
    const boxMode =
      selectionMode === SELECTION_MODE.INSIDE_RECTANGLE ||
      selectionMode === SELECTION_MODE.TOUCHING_RECTANGLE;

    const candidates: LAYER_ITEM_PAIR[] = [];
    const selectionBox = aArea.ViewBBox();
    view.Query(selectionBox, candidates); // Get the list of nearby items

    const collector = new GENERAL_COLLECTOR();
    const padsCollector = new GENERAL_COLLECTOR();
    const group_items = new Set<EDA_ITEM>();

    for (const group of this.board().Groups()) {
      // The currently entered group does not get limited
      if (this.m_enteredGroup === group) continue;

      const newset = group.GetItems();

      const boxContained = (aBox: BOX2I): boolean => {
        return boxMode
          ? selectionBox.Contains(aBox)
          : KIGEOM_BoxHitTestChain(aArea.GetPoly(), aBox, true);
      };

      // If we are not greedy and have selected the whole group, add just one item
      // to allow it to be promoted to the group later
      if (containedMode && boxContained(group.GetBoundingBox()) && newset.size) {
        for (const group_item of newset) {
          if (!group_item.IsBOARD_ITEM()) continue;

          if (this.Selectable(group_item as BOARD_ITEM))
            collector.Append(newset.values().next().value!);
        }
      }

      for (const group_item of newset) group_items.add(group_item);
    }

    const hitTest = (aItem: EDA_ITEM): boolean => {
      return boxMode
        ? aItem.HitTest(selectionBox, containedMode)
        : aItem.HitTest(aArea.GetPoly(), containedMode);
    };

    for (const [item] of candidates) {
      if (!item.IsBOARD_ITEM()) continue;

      const boardItem = item as BOARD_ITEM;

      if (
        this.Selectable(boardItem) &&
        hitTest(boardItem) &&
        (!containedMode || !group_items.has(boardItem))
      ) {
        if (boardItem.Type() === KICAD_T.PCB_PAD_T && !this.m_isFootprintEditor)
          padsCollector.Append(boardItem);
        else collector.Append(boardItem);
      }
    }

    // Apply the stateful filter
    this.FilterCollectedItems(collector, true, null);

    this.FilterCollectorForHierarchy(collector, true);

    // If we selected nothing but pads, allow them to be selected
    if (collector.GetCount() === 0) {
      collector.Empty();

      for (const item of padsCollector) collector.Append(item);

      this.FilterCollectedItems(collector, true, null);
      this.FilterCollectorForHierarchy(collector, true);
    }

    // Sort the filtered selection by rows and columns to have a nice default
    // for tools that can use it.
    collector.Sort((a: EDA_ITEM, b: EDA_ITEM): boolean => {
      const aPos = a.GetPosition();
      const bPos = b.GetPosition();

      if (aPos.y === bPos.y) return aPos.x < bPos.x;

      return aPos.y < bPos.y;
    });

    for (const i of collector) {
      if (!i.IsBOARD_ITEM()) continue;

      const item = i as BOARD_ITEM;

      if (aSubtractive || (aExclusiveOr && item.IsSelected())) {
        this.unselect(item);
        anySubtracted = true;
      } else {
        this.select(item);
        anyAdded = true;
      }
    }

    this.m_selection.SetIsHover(false);

    // Inform other potentially interested tools
    if (anyAdded) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    else if (anySubtracted) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
  }

  /**
   * Handle disambiguation actions including displaying the menu.
   */
  private *disambiguateCursor(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const keyboardState = wxGetMouseState();

    this.setModifiersState(
      keyboardState.ShiftDown(),
      keyboardState.ControlDown(),
      keyboardState.AltDown(),
    );

    this.m_skip_heuristics = true;
    const cancelled = { value: this.m_canceledMenu };
    yield* this.selectPoint(this.m_originalCursor, false, cancelled);
    this.m_canceledMenu = cancelled.value;
    this.m_skip_heuristics = false;

    return 0;
  }

  ///< Select a single item under cursor event handler.
  *CursorSelection(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const aClientFilter = aEvent.Parameter<CLIENT_SELECTION_FILTER | null>() ?? null;

    yield* this.selectCursor(false, aClientFilter);

    return 0;
  }

  ///< Clear current selection event handler.
  ClearSelectionEvt(_aEvent: TOOL_EVENT): number {
    this.ClearSelection();

    return 0;
  }

  ///< Select all items on the board
  SelectAll(_aEvent: TOOL_EVENT): number {
    const collection = new GENERAL_COLLECTOR();
    const selectionBox = new BOX2I();

    selectionBox.SetMaximum();

    this.getView()!.Query(selectionBox, (viewItem: VIEW_ITEM): boolean => {
      if (viewItem.IsBOARD_ITEM()) {
        const item = viewItem as BOARD_ITEM;

        if (item && this.Selectable(item) && this.itemPassesFilter(item, true, null))
          collection.Append(item);
      }

      return true;
    });

    this.FilterCollectorForHierarchy(collection, true);

    for (const item of collection) this.select(item);

    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    this.m_frame!.GetCanvas()!.ForceRefresh();

    return 0;
  }

  ///< Unselect all items on the board
  UnselectAll(_aEvent: TOOL_EVENT): number {
    const selectionBox = new BOX2I();

    selectionBox.SetMaximum();

    this.getView()!.Query(selectionBox, (viewItem: VIEW_ITEM): boolean => {
      if (viewItem.IsBOARD_ITEM()) {
        const item = viewItem as BOARD_ITEM;

        if (item && this.Selectable(item)) this.unselect(item);
      }

      return true;
    });

    this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

    this.m_frame!.GetCanvas()!.ForceRefresh();

    return 0;
  }

  /**
   * Unroute the selected board connected items.
   */
  private unrouteSelected(_aEvent: TOOL_EVENT): number {
    const selectedItems = this.m_selection.GetItems();

    // Get all footprints and pads
    const toUnroute: BOARD_CONNECTED_ITEM[] = [];
    const toDelete = new Set<EDA_ITEM>();

    for (const item of selectedItems) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        for (const pad of (item as FOOTPRINT).Pads()) toUnroute.push(pad);
      } else if (item.Type() === KICAD_T.PCB_GENERATOR_T) {
        toDelete.add(item);

        for (const generatedItem of (item as PCB_GENERATOR).GetBoardItems()) {
          if (generatedItem.IsConnected()) toUnroute.push(generatedItem as BOARD_CONNECTED_ITEM);
        }
      } else if ((item as BOARD_ITEM).IsConnected()) {
        toUnroute.push(item as BOARD_CONNECTED_ITEM);
      }
    }

    // Find generators connected to tracks and add their children to toUnroute
    // so selectAllConnectedTracks can traverse through meanders
    const selectedNets = new Set<number>();

    for (const item of toUnroute) if (item.GetNetCode() > 0) selectedNets.add(item.GetNetCode());

    const endpointSet = new Set<string>();

    for (const item of toUnroute) {
      // dynamic_cast<PCB_TRACK*>: a PCB_ARC and a PCB_VIA are PCB_TRACKs too, so the via
      // branch below is never reached (as upstream).
      if (isTrack(item)) {
        const track = item as PCB_TRACK;
        endpointSet.add(vecKey(track.GetStart()));
        endpointSet.add(vecKey(track.GetEnd()));
      } else if (item.Type() === KICAD_T.PCB_VIA_T) {
        endpointSet.add(vecKey(item.GetPosition()));
      } else if (item.Type() === KICAD_T.PCB_PAD_T) {
        endpointSet.add(vecKey(item.GetPosition()));
      }
    }

    let expanded = true;

    while (expanded) {
      expanded = false;

      for (const gen of this.board().Generators()) {
        if (toDelete.has(gen)) continue;

        // Find this generator's external endpoints (meander entry/exit)
        const epCount = new Map<string, { pt: VECTOR2I; count: number }>();

        for (const child of gen.GetBoardItems()) {
          if (!isTrack(child)) continue;

          const track = child as PCB_TRACK;

          if (selectedNets.has(track.GetNetCode())) {
            for (const pt of [track.GetStart(), track.GetEnd()]) {
              const e = epCount.get(vecKey(pt));

              if (e) e.count++;
              else epCount.set(vecKey(pt), { pt, count: 1 });
            }
          }
        }

        // Check if any external endpoint matches our track endpoints
        let connected = false;

        for (const { pt, count } of [...epCount.values()].sort((a, b) => vecLess(a.pt, b.pt))) {
          if (count === 1 && endpointSet.has(vecKey(pt))) {
            connected = true;
            break;
          }
        }

        if (connected) {
          toDelete.add(gen);

          for (const c of gen.GetBoardItems()) {
            if (!c.IsConnected()) continue;

            if (!selectedNets.has((c as BOARD_CONNECTED_ITEM).GetNetCode())) continue;

            toUnroute.push(c as BOARD_CONNECTED_ITEM);

            if (isTrack(c)) {
              const track = c as PCB_TRACK;
              endpointSet.add(vecKey(track.GetStart()));
              endpointSet.add(vecKey(track.GetEnd()));
            }

            expanded = true;
          }
        }
      }
    }

    // Because selectAllConnectedTracks() use m_filter to collect connected tracks
    // to pads, enable filter for these items, regardless the curent filter options
    // via filter is not changed, because it can be useful to keep via filter disabled
    const save_filter = Object.assign(new PCB_SELECTION_FILTER_OPTIONS(), this.m_filter);
    this.m_filter.tracks = true;
    this.m_filter.pads = true;

    // Clear selection so we don't delete our footprints/pads
    this.ClearSelection(true);

    // Get the tracks on our list of pads, then delete them
    this.selectAllConnectedTracks(toUnroute, STOP_CONDITION.STOP_AT_PAD);

    const commit = new BOARD_COMMIT(this.m_toolMgr!);
    const removed = new Set<BOARD_ITEM>();

    for (const item of this.m_selection) {
      if (!item.IsBOARD_ITEM()) continue;

      const bi = item as BOARD_ITEM;

      if (bi.Type() === KICAD_T.PCB_GENERATOR_T) toDelete.add(bi);

      commit.Remove(bi);
      removed.add(bi);
    }

    // Find generators whose children were removed
    for (const gen of this.board().Generators()) {
      for (const child of gen.GetBoardItems()) {
        if (removed.has(child)) {
          toDelete.add(gen);
          break;
        }
      }
    }

    for (const item of ptrSorted(toDelete)) {
      if (!item.IsBOARD_ITEM()) continue;

      const boardItem = item as BOARD_ITEM;

      boardItem.RunOnChildren((aItem: BOARD_ITEM) => {
        if (!removed.has(aItem)) {
          commit.Remove(aItem);
          removed.add(aItem);
        }
      }, RECURSE_MODE.RECURSE);

      if (!removed.has(boardItem)) commit.Remove(boardItem);
    }

    this.ClearSelection(true);
    commit.Push('Unroute Selected');

    this.m_filter = save_filter; // restore current filter options

    // Reselect our footprint/pads as they were in our original selection
    for (const item of selectedItems) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T || item.Type() === KICAD_T.PCB_PAD_T)
        this.select(item);
    }

    return 0;
  }

  /**
   * Unroute the selected track connected item.
   */
  private unrouteSegment(_aEvent: TOOL_EVENT): number {
    const selectedItems = this.m_selection.GetItems();

    // Get all footprints and pads
    const toUnroute: BOARD_CONNECTED_ITEM[] = [];

    const toDelete = new Set<EDA_ITEM>();

    for (const item of selectedItems) {
      if (
        item.Type() === KICAD_T.PCB_TRACE_T ||
        item.Type() === KICAD_T.PCB_ARC_T ||
        item.Type() === KICAD_T.PCB_VIA_T
      ) {
        const bi = item as BOARD_ITEM;
        const parentGroup = bi.GetParentGroup();

        if (parentGroup && parentGroup.AsEdaItem().Type() === KICAD_T.PCB_GENERATOR_T) {
          const gen = parentGroup.AsEdaItem() as PCB_GENERATOR;

          if (!toDelete.has(gen)) {
            toDelete.add(gen);

            for (const generatedItem of gen.GetBoardItems()) {
              toDelete.add(generatedItem);

              if (generatedItem.IsConnected())
                toUnroute.push(generatedItem as BOARD_CONNECTED_ITEM);
            }
          }
        } else {
          toUnroute.push(item as BOARD_CONNECTED_ITEM);
          toDelete.add(item);
        }
      } else if (item.Type() === KICAD_T.PCB_GENERATOR_T) {
        toDelete.add(item);

        for (const generatedItem of (item as PCB_GENERATOR).GetBoardItems()) {
          toDelete.add(generatedItem);

          if (generatedItem.IsConnected()) toUnroute.push(generatedItem as BOARD_CONNECTED_ITEM);
        }
      }
    }

    // Get the tracks connecting to our starting objects
    this.ClearSelection();
    this.selectAllConnectedTracks(toUnroute, STOP_CONDITION.STOP_AT_SEGMENT);
    const toSelectAfter: EDA_ITEM[] = [];
    // This will select the unroute items too, so filter them out
    for (const item of this.m_selection.GetItemsSortedByTypeAndXY()) {
      if (!item.IsBOARD_ITEM()) continue;

      if (!toDelete.has(item)) toSelectAfter.push(item);
    }

    const commit = new BOARD_COMMIT(this.m_toolMgr!);
    const removed = new Set<BOARD_ITEM>();

    for (const item of ptrSorted(toDelete)) {
      if (!item.IsBOARD_ITEM()) continue;

      const boardItem = item as BOARD_ITEM;

      if (item.Type() === KICAD_T.PCB_GENERATOR_T) {
        boardItem.RunOnChildren((aItem: BOARD_ITEM) => {
          if (!removed.has(aItem)) {
            removed.add(aItem);
            commit.Remove(aItem);
          }
        }, RECURSE_MODE.RECURSE);

        if (!removed.has(boardItem)) {
          removed.add(boardItem);
          commit.Remove(boardItem);
        }
      } else {
        if (!removed.has(boardItem)) {
          removed.add(boardItem);
          commit.Remove(boardItem);
        }
      }
    }

    commit.Push('Unroute Segment');

    // Now our after tracks so the user can continue backing up as desired
    this.ClearSelection(true);

    for (const item of toSelectAfter) {
      if (!toDelete.has(item)) this.select(item);
    }

    return 0;
  }

  /**
   * Expand the current connected-item selection to the next boundary (junctions, pads, or all)
   */
  private *expandConnection(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // expandConnection will get called no matter whether the user selected a connected item or a
    // non-connected shape (graphic on a non-copper layer). The algorithm for expanding to connected
    // items is different from graphics, so they need to be handled separately.
    let initialCount = 0;

    for (const item of this.m_selection.GetItems()) {
      if (
        item.Type() === KICAD_T.PCB_FOOTPRINT_T ||
        item.Type() === KICAD_T.PCB_GENERATOR_T ||
        (item as BOARD_ITEM).IsConnected()
      ) {
        initialCount++;
      }
    }

    if (initialCount === 0) {
      // First, process any graphic shapes we have
      const startShapes: PCB_SHAPE[] = [];

      for (const item of this.m_selection.GetItems()) {
        if (this.isExpandableGraphicShape(item)) startShapes.push(item as PCB_SHAPE);
      }

      // If no non-copper shapes; fall back to looking for connected items
      if (startShapes.length !== 0) this.selectAllConnectedShapes(startShapes);
      else yield* this.selectCursor(true, connectedItemFilter);
    }

    this.m_frame!.SetStatusText('Select/Expand Connection...');

    for (const stopCondition of [
      STOP_CONDITION.STOP_AT_JUNCTION,
      STOP_CONDITION.STOP_AT_PAD,
      STOP_CONDITION.STOP_NEVER,
    ]) {
      const selectedItems = this.m_selection.GetItems();

      for (const item of selectedItems) item.ClearTempFlags();

      const startItems: BOARD_CONNECTED_ITEM[] = [];

      for (const item of selectedItems) {
        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
          const footprint = item as FOOTPRINT;

          for (const pad of footprint.Pads()) startItems.push(pad);
        } else if (item.Type() === KICAD_T.PCB_GENERATOR_T) {
          for (const generatedItem of (item as PCB_GENERATOR).GetBoardItems()) {
            if (generatedItem.IsConnected()) startItems.push(generatedItem as BOARD_CONNECTED_ITEM);
          }
        } else if ((item as BOARD_ITEM).IsConnected()) {
          startItems.push(item as BOARD_CONNECTED_ITEM);
        }
      }

      this.selectAllConnectedTracks(startItems, stopCondition);

      if (this.m_selection.GetItems().length > initialCount) break;
    }

    this.m_frame!.SetStatusText('');

    // Inform other potentially interested tools
    this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  /**
   * Select connected tracks and vias.
   *
   * @param aStopCondition Indicates where to stop selecting more items.
   */
  selectAllConnectedTracks(
    aStartItems: readonly BOARD_CONNECTED_ITEM[],
    aStopCondition: STOP_CONDITION,
  ): void {
    let refreshStart = performance.now();
    const refreshIntervalMs = 500; // Refresh display with this interval to indicate progress
    let lastSelectionSize = this.m_selection.GetSize();

    const connectivity = this.board().GetConnectivity();

    // Don't let expansion select outside an entered group, or select() would ExitGroup mid-walk.
    const inScope = (aItem: BOARD_ITEM): boolean => {
      return PCB_SELECTION_TOOL.isWithinEnteredGroup(
        aItem,
        this.m_enteredGroup,
        this.m_isFootprintEditor,
      );
    };

    const startPadSet = new Set<PAD>();
    const cleanupItems: BOARD_CONNECTED_ITEM[] = [];

    for (const startItem of aStartItems) {
      // Register starting pads
      if (startItem.Type() === KICAD_T.PCB_PAD_T) startPadSet.add(startItem as PAD);

      // Select any starting track items
      if (startItem.IsType([KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T, KICAD_T.PCB_VIA_T])) {
        if (this.itemPassesFilter(startItem, true) && inScope(startItem)) this.select(startItem);
      }
    }

    for (const startItem of aStartItems) {
      const trackMap = new Map<string, { pt: VECTOR2I; tracks: PCB_TRACK[] }>();
      const viaMap = new Map<string, { pt: VECTOR2I; via: PCB_VIA }>();
      const padMap = new Map<string, PAD>();
      const shapeMap = new Map<string, PCB_SHAPE[]>();
      const activePts: [VECTOR2I, LSET][] = [];

      const trackAt = (aPt: VECTOR2I): PCB_TRACK[] => trackMap.get(vecKey(aPt))?.tracks ?? [];
      const pushTrack = (aPt: VECTOR2I, aTrack: PCB_TRACK): void => {
        const e = trackMap.get(vecKey(aPt));

        if (e) e.tracks.push(aTrack);
        else trackMap.set(vecKey(aPt), { pt: aPt, tracks: [aTrack] });
      };

      if (startItem.HasFlag(SKIP_STRUCT)) continue; // Skip already visited items

      const connectedItems = connectivity.GetConnectedItems(startItem, EXCLUDE_ZONES | IGNORE_NETS);

      // Build maps of connected items
      for (const item of connectedItems) {
        switch (item.Type()) {
          case KICAD_T.PCB_ARC_T:
          case KICAD_T.PCB_TRACE_T: {
            const track = item as PCB_TRACK;
            pushTrack(track.GetStart(), track);
            pushTrack(track.GetEnd(), track);
            break;
          }

          case KICAD_T.PCB_VIA_T: {
            const via = item as PCB_VIA;
            viaMap.set(vecKey(via.GetStart()), { pt: via.GetStart(), via });
            break;
          }

          case KICAD_T.PCB_PAD_T: {
            const pad = item as PAD;
            padMap.set(vecKey(pad.GetPosition()), pad);
            break;
          }

          case KICAD_T.PCB_SHAPE_T: {
            const shape = item as unknown as PCB_SHAPE;

            for (const point of shape.GetConnectionPoints()) {
              const list = shapeMap.get(vecKey(point));

              if (list) list.push(shape);
              else shapeMap.set(vecKey(point), [shape]);
            }

            break;
          }

          default:
            break;
        }
      }

      // Set up the initial active points
      switch (startItem.Type()) {
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_TRACE_T: {
          const track = startItem as PCB_TRACK;

          activePts.push([track.GetStart(), track.GetLayerSet()]);
          activePts.push([track.GetEnd(), track.GetLayerSet()]);
          break;
        }

        case KICAD_T.PCB_VIA_T:
          activePts.push([startItem.GetPosition(), startItem.GetLayerSet()]);
          break;

        case KICAD_T.PCB_PAD_T:
          activePts.push([startItem.GetPosition(), startItem.GetLayerSet()]);
          break;

        case KICAD_T.PCB_SHAPE_T: {
          const shape = startItem as unknown as PCB_SHAPE;

          for (const point of shape.GetConnectionPoints())
            activePts.push([point, startItem.GetLayerSet()]);

          break;
        }

        default:
          break;
      }

      let expand = true;
      let failSafe = 0;

      // std::map iteration order: VECTOR2I ascending.
      const viaEntries = (): { pt: VECTOR2I; via: PCB_VIA }[] =>
        [...viaMap.values()].sort((a, b) => vecLess(a.pt, b.pt));
      const trackEntries = (): { pt: VECTOR2I; tracks: PCB_TRACK[] }[] =>
        [...trackMap.values()].sort((a, b) => vecLess(a.pt, b.pt));

      // Iterative push from all active points
      while (expand && failSafe++ < 100000) {
        expand = false;

        for (let i = activePts.length - 1; i >= 0; --i) {
          const pt = activePts[i]![0];
          const layerSetCu = activePts[i]![1].and(LSET.AllCuMask());

          let hitVia: PCB_VIA | null = null;

          // exact position match (common case)
          const exactIt = viaMap.get(vecKey(pt));

          if (exactIt && exactIt.via.GetLayerSet().and(layerSetCu).any()) {
            hitVia = exactIt.via;
          } else {
            // off-center VIA connection
            for (const { pt: pos, via } of viaEntries()) {
              if (!via.GetLayerSet().and(layerSetCu).any()) continue;

              let hit = false;

              for (const layer of new LSET(via.GetLayerSet().and(layerSetCu)).CuStack()) {
                const radius = Math.trunc(via.GetWidth(layer) / 2);
                const radiusSq = radius * radius;
                const dx = pt.x - pos.x;
                const dy = pt.y - pos.y;

                if (dx * dx + dy * dy <= radiusSq) {
                  hit = true;
                  break;
                }
              }

              if (hit) {
                hitVia = via;
                break;
              }
            }
          }

          const padIt = padMap.get(vecKey(pt)) ?? null;

          const gotVia = hitVia !== null;
          const gotPad = padIt !== null && padIt.GetLayerSet().and(layerSetCu).any();
          const gotNonStartPad = gotPad && !startPadSet.has(padIt!);

          if (gotPad && !this.itemPassesFilter(padIt!, true)) {
            activePts.splice(i, 1);
            continue;
          }

          if (gotVia && !this.itemPassesFilter(hitVia!, true)) {
            activePts.splice(i, 1);
            continue;
          }

          if (aStopCondition === STOP_CONDITION.STOP_AT_JUNCTION) {
            let pt_count = 0;

            for (const track of trackAt(pt)) {
              if (
                (track.GetStart().x !== track.GetEnd().x ||
                  track.GetStart().y !== track.GetEnd().y) &&
                layerSetCu.Contains(track.GetLayer())
              )
                pt_count++;
            }

            if (pt_count > 2 || gotVia || gotNonStartPad) {
              activePts.splice(i, 1);
              continue;
            }
          } else if (aStopCondition === STOP_CONDITION.STOP_AT_PAD) {
            if (gotNonStartPad) {
              activePts.splice(i, 1);
              continue;
            }
          }

          if (gotPad) {
            const pad = padIt!;

            if (!pad.HasFlag(SKIP_STRUCT)) {
              pad.SetFlags(SKIP_STRUCT);
              cleanupItems.push(pad);

              activePts.push([pad.GetPosition(), pad.GetLayerSet()]);
              expand = true;
            }
          }

          for (const track of trackAt(pt)) {
            if (!layerSetCu.Contains(track.GetLayer())) continue;

            if (!this.itemPassesFilter(track, true)) continue;

            if (!track.IsSelected() && inScope(track)) this.select(track);

            if (!track.HasFlag(SKIP_STRUCT)) {
              track.SetFlags(SKIP_STRUCT);
              cleanupItems.push(track);

              if (track.GetStart().x === pt.x && track.GetStart().y === pt.y)
                activePts.push([track.GetEnd(), track.GetLayerSet()]);
              else activePts.push([track.GetStart(), track.GetLayerSet()]);

              if (aStopCondition !== STOP_CONDITION.STOP_AT_SEGMENT) expand = true;
            }
          }

          for (const shape of shapeMap.get(vecKey(pt)) ?? []) {
            if (!layerSetCu.Contains(shape.GetLayer())) continue;

            if (!this.itemPassesFilter(shape, true)) continue;

            if (!shape.IsSelected() && inScope(shape)) this.select(shape);

            if (!shape.HasFlag(SKIP_STRUCT)) {
              shape.SetFlags(SKIP_STRUCT);
              cleanupItems.push(shape as unknown as BOARD_CONNECTED_ITEM);

              for (const newPoint of shape.GetConnectionPoints()) {
                if (newPoint.x === pt.x && newPoint.y === pt.y) continue;

                activePts.push([newPoint, shape.GetLayerSet()]);
              }

              if (aStopCondition !== STOP_CONDITION.STOP_AT_SEGMENT) expand = true;
            }
          }

          if (hitVia) {
            if (!hitVia.IsSelected() && inScope(hitVia)) this.select(hitVia);

            if (!hitVia.HasFlag(SKIP_STRUCT)) {
              hitVia.SetFlags(SKIP_STRUCT);
              cleanupItems.push(hitVia);

              const viaPos = hitVia.GetPosition();

              let maxRadius = 0;

              for (const layer of hitVia.GetLayerSet().CuStack())
                maxRadius = Math.max(maxRadius, Math.trunc(hitVia.GetWidth(layer) / 2));

              const maxRadiusSq = maxRadius * maxRadius;

              for (const { pt: trkPt, tracks } of trackEntries()) {
                const dx = trkPt.x - viaPos.x;
                const dy = trkPt.y - viaPos.y;

                if (dx * dx + dy * dy > maxRadiusSq) continue;

                // Verify point is inside the VIA pad on at least one track layer
                let inside = false;

                for (const trk of tracks) {
                  const trkLayer = trk.GetLayer();

                  if (!hitVia.GetLayerSet().Contains(trkLayer)) continue;

                  const r = Math.trunc(hitVia.GetWidth(trkLayer) / 2);
                  const rSq = r * r;

                  if (dx * dx + dy * dy <= rSq) {
                    inside = true;
                    break;
                  }
                }

                if (inside) activePts.push([trkPt, hitVia.GetLayerSet()]);
              }

              if (aStopCondition !== STOP_CONDITION.STOP_AT_SEGMENT) expand = true;
            }
          }

          activePts.splice(i, 1);
        }

        // Refresh display for the feel of progress
        if (performance.now() - refreshStart >= refreshIntervalMs) {
          if (this.m_selection.Size() !== lastSelectionSize) {
            this.m_frame!.GetCanvas()!.ForceRefresh();
            lastSelectionSize = this.m_selection.Size();
          }

          refreshStart = performance.now();
        }
      }
    }

    const toDeselect = new Set<EDA_ITEM>();
    const toSelect = new Set<EDA_ITEM>();

    // Promote generated members to their PCB_GENERATOR parents
    for (const item of this.m_selection) {
      if (!item.IsBOARD_ITEM()) continue;

      const boardItem = item as BOARD_ITEM;
      const parent = boardItem.GetParentGroup();

      if (parent && parent.AsEdaItem().Type() === KICAD_T.PCB_GENERATOR_T) {
        toDeselect.add(item);

        if (!parent.AsEdaItem().IsSelected()) toSelect.add(parent.AsEdaItem());
      }
    }

    for (const item of ptrSorted(toDeselect)) this.unselect(item);

    for (const item of ptrSorted(toSelect)) this.select(item);

    for (const item of cleanupItems) item.ClearFlags(SKIP_STRUCT);
  }

  /**
   * @return true if the given item is an open PCB_SHAPE on a non-copper layer
   */
  private isExpandableGraphicShape(aItem: EDA_ITEM): boolean {
    if (aItem.Type() === KICAD_T.PCB_SHAPE_T) {
      const shape = aItem as PCB_SHAPE;

      switch (shape.GetShape()) {
        case SHAPE_T.SEGMENT:
        case SHAPE_T.ARC:
        case SHAPE_T.BEZIER:
          return !shape.IsOnCopperLayer();

        case SHAPE_T.POLY:
          return !shape.IsOnCopperLayer() && !shape.IsClosed();

        default:
          return false;
      }
    }

    return false;
  }

  /**
   * Select all non-closed shapes that are graphically connected to the given start items.
   *
   * @param aStartItems is a list of one or more non-closed shapes
   */
  private selectAllConnectedShapes(aStartItems: readonly PCB_SHAPE[]): void {
    const toSearch: PCB_SHAPE[] = [];
    const toCleanup = new Set<PCB_SHAPE>();

    for (const startItem of aStartItems) toSearch.push(startItem);

    const collector = new GENERAL_COLLECTOR();
    const guide = this.getCollectorsGuide();

    const searchPoint = (aWhere: VECTOR2I): void => {
      collector.Collect(this.board(), [KICAD_T.PCB_SHAPE_T], aWhere, guide);

      for (const item of collector) {
        if (this.isExpandableGraphicShape(item)) toSearch.push(item as PCB_SHAPE);
      }
    };

    while (toSearch.length !== 0) {
      const shape = toSearch.pop()!;

      if (shape.HasFlag(SKIP_STRUCT)) continue;

      shape.SetFlags(SKIP_STRUCT);
      toCleanup.add(shape);

      if (!this.itemPassesFilter(shape, true)) continue;

      this.select(shape);
      guide.SetLayerVisibleBits(shape.GetLayerSet());

      searchPoint(shape.GetStart());
      searchPoint(shape.GetEnd());
    }

    for (const shape of toCleanup) shape.ClearFlags(SKIP_STRUCT);
  }

  /**
   * Select nearest unconnected footprints on same net as selected items.
   */
  private selectUnconnected(_aEvent: TOOL_EVENT): number {
    // Get all pads
    const pads: PAD[] = [];

    for (const item of this.m_selection.GetItems()) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        for (const pad of (item as FOOTPRINT).Pads()) pads.push(pad);
      } else if (item.Type() === KICAD_T.PCB_PAD_T) {
        pads.push(item as PAD);
      }
    }

    // Select every footprint on the end of the ratsnest for each pad in our selection
    const conn = this.board().GetConnectivity();

    for (const pad of pads) {
      for (const edge of conn.GetRatsnestForPad(pad)) {
        const source = edge.GetSourceNode();
        const target = edge.GetTargetNode();

        if (!(source && !source.Dirty())) {
          console.assert(false);
          continue;
        }

        if (!(target && !target.Dirty())) {
          console.assert(false);
          continue;
        }

        const sourceParent = source.Parent();
        const targetParent = target.Parent();

        if (sourceParent === pad) {
          if (targetParent.Type() === KICAD_T.PCB_PAD_T) this.select(targetParent.GetParent()!);
        } else if (targetParent === pad) {
          if (sourceParent.Type() === KICAD_T.PCB_PAD_T) this.select(sourceParent.GetParent()!);
        }
      }
    }

    return 0;
  }

  /**
   * Select and move other nearest footprint unconnected on same net as selected items.
   */
  private grabUnconnected(_aEvent: TOOL_EVENT): number {
    // Get all pads
    const pads: PAD[] = [];

    for (const item of this.m_selection.GetItems()) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        for (const pad of (item as FOOTPRINT).Pads()) pads.push(pad);
      } else if (item.Type() === KICAD_T.PCB_PAD_T) {
        pads.push(item as PAD);
      }
    }

    this.ClearSelection();

    // Select every footprint on the end of the ratsnest for each pad in our selection
    const conn = this.board().GetConnectivity();

    for (const pad of pads) {
      const edges = conn.GetRatsnestForPad(pad);

      // Need to have something unconnected to grab
      if (edges.length === 0) continue;

      let currentDistance = Number.MAX_VALUE;
      let nearest: FOOTPRINT | null = null;

      // Check every ratsnest line for the nearest one
      for (const edge of edges) {
        if (
          edge.GetSourceNode()!.Parent().GetParentFootprint() ===
          edge.GetTargetNode()!.Parent().GetParentFootprint()
        ) {
          continue; // This edge is a loop on the same footprint
        }

        // Figure out if we are the source or the target node on the ratnest
        const other =
          edge.GetSourceNode()!.Parent() === pad ? edge.GetTargetNode() : edge.GetSourceNode();

        if (!(other && !other.Dirty())) {
          console.assert(false);
          continue;
        }

        // We only want to grab footprints, so the ratnest has to point to a pad
        if (other.Parent().Type() !== KICAD_T.PCB_PAD_T) continue;

        if (edge.GetLength() < currentDistance) {
          currentDistance = edge.GetLength();
          nearest = other.Parent().GetParentFootprint();
        }
      }

      if (nearest !== null) this.select(nearest);
    }

    this.m_toolMgr!.RunAction(PCB_ACTIONS.moveIndividually);

    return 0;
  }

  /**
   * Select all items with the given net code.
   *
   * @param aNetCode is the target net to select
   * @param aSelect is true to add the items to the selection, false to remove them (deselect)
   */
  SelectAllItemsOnNet(aNetCode: number, aSelect = true): void {
    const conn = this.board().GetConnectivity();

    for (const item of conn.GetNetItems(aNetCode, [
      KICAD_T.PCB_TRACE_T,
      KICAD_T.PCB_ARC_T,
      KICAD_T.PCB_VIA_T,
      KICAD_T.PCB_SHAPE_T,
    ])) {
      if (this.itemPassesFilter(item, true, null))
        aSelect ? this.select(item) : this.unselect(item);
    }
  }

  /**
   * Select all copper connections belonging to the same net(s) as the items in the selection.
   */
  private *selectNet(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const select = aEvent.IsAction(PCB_ACTIONS.selectNet);

    // If we've been passed an argument, just select that netcode1
    const netcode = aEvent.Parameter<number>() ?? 0;

    if (netcode > 0) {
      this.SelectAllItemsOnNet(netcode, select);

      // Inform other potentially interested tools
      if (this.m_selection.Size() > 0) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
      else this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

      return 0;
    }

    if (!(yield* this.selectCursor())) return 0;

    // copy the selection, since we're going to iterate and modify
    const selection = this.m_selection.GetItems();

    for (const i of selection) {
      if (i.IsBOARD_ITEM() && (i as BOARD_ITEM).IsConnected())
        this.SelectAllItemsOnNet((i as BOARD_CONNECTED_ITEM).GetNetCode(), select);
    }

    // Inform other potentially interested tools
    if (this.m_selection.Size() > 0) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    else this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

    return 0;
  }

  /**
   * Select all items with the given sheet timestamp/UUID name (the sheet path).
   *
   * The path of the root sheet is "/".
   */
  private selectAllItemsOnSheet(aSheetPath: string): void {
    const footprints: BOARD_ITEM[] = [];

    // store all footprints that are on that sheet path
    for (const footprint of this.board().Footprints()) {
      if (footprint === null) continue;

      let footprint_path = beforeLast(pathAsString(footprint), '/');

      if (footprint_path === '') footprint_path += '/';

      if (footprint_path === aSheetPath) footprints.push(footprint);
    }

    for (const i of footprints) {
      if (i !== null) this.select(i);
    }

    this.selectConnections(footprints);
  }

  /*
   * Select tracks and vias connected to specified board items.
   */
  private selectConnections(aItems: readonly BOARD_ITEM[]): void {
    // Generate a list of all pads, and of all nets they belong to.
    let netcodeList: number[] = [];
    const padList: BOARD_CONNECTED_ITEM[] = [];

    for (const item of aItems) {
      switch (item.Type()) {
        case KICAD_T.PCB_FOOTPRINT_T: {
          for (const pad of (item as FOOTPRINT).Pads()) {
            if (pad.IsConnected()) {
              netcodeList.push(pad.GetNetCode());
              padList.push(pad);
            }
          }

          break;
        }

        case KICAD_T.PCB_PAD_T: {
          const pad = item as PAD;

          if (pad.IsConnected()) {
            netcodeList.push(pad.GetNetCode());
            padList.push(pad);
          }

          break;
        }

        default:
          break;
      }
    }

    // Sort for binary search
    padList.sort((a, b) => ptrOrdinal(a) - ptrOrdinal(b));

    // remove all duplicates
    netcodeList.sort((a, b) => a - b);
    netcodeList = netcodeList.filter((c, i) => i === 0 || c !== netcodeList[i - 1]);

    this.selectAllConnectedTracks(padList, STOP_CONDITION.STOP_AT_PAD);

    // now we need to find all footprints that are connected to each of these nets then we need
    // to determine if these footprints are in the list of footprints
    const removeCodeList: number[] = [];
    const conn = this.board().GetConnectivity();
    const padSet = new Set<EDA_ITEM>(padList);

    for (const netCode of netcodeList) {
      for (const pad of conn.GetNetItems(netCode, [KICAD_T.PCB_PAD_T])) {
        if (!padSet.has(pad)) {
          // if we cannot find the pad in the padList then we can assume that that pad
          // should not be used, therefore invalidate this netcode.
          removeCodeList.push(netCode);
          break;
        }
      }
    }

    for (const removeCode of removeCodeList)
      netcodeList = netcodeList.filter((c) => c !== removeCode);

    const localConnectionList = new Set<BOARD_ITEM>();

    for (const netCode of netcodeList) {
      for (const item of conn.GetNetItems(netCode, [
        KICAD_T.PCB_TRACE_T,
        KICAD_T.PCB_ARC_T,
        KICAD_T.PCB_VIA_T,
        KICAD_T.PCB_SHAPE_T,
      ])) {
        localConnectionList.add(item);
      }
    }

    for (const item of localConnectionList) this.select(item);
  }

  ///< Set selection to items passed by parameter and connected nets (optionally).
  ///< Zooms to fit, if enabled
  private syncSelection(aEvent: TOOL_EVENT): number {
    const items = aEvent.Parameter<BOARD_ITEM[] | null>();

    if (items) this.doSyncSelection(items, false);

    return 0;
  }

  private syncSelectionWithNets(aEvent: TOOL_EVENT): number {
    const items = aEvent.Parameter<BOARD_ITEM[] | null>();

    if (items) this.doSyncSelection(items, true);

    return 0;
  }

  private doSyncSelection(aItems: readonly BOARD_ITEM[], aWithNets: boolean): void {
    if (this.m_selection.Front()?.IsMoving()) return;

    // Also check the incoming items. If the cross-probe flash timer cleared the selection
    // during a move, Front() would be null but the items are still being actively moved.
    for (const item of aItems) {
      if (item.IsMoving()) return;
    }

    this.ClearSelection(true /*quiet mode*/);

    // Perform individual selection of each item before processing the event.
    for (const item of aItems) this.select(item);

    if (aWithNets) this.selectConnections(aItems);

    const bbox = this.m_selection.GetBoundingBox();

    if (bbox.GetWidth() !== 0 && bbox.GetHeight() !== 0) {
      if (this.m_frame!.GetPcbNewSettings().m_CrossProbing.center_on_items) {
        if (this.m_frame!.GetPcbNewSettings().m_CrossProbing.zoom_to_fit)
          this.ZoomFitCrossProbeBBox(bbox);

        this.m_frame!.FocusOnLocation(bbox.Centre());
      }
    }

    this.view()?.UpdateAllLayersColor();

    this.m_frame!.GetCanvas()!.ForceRefresh();

    if (this.m_selection.Size() > 0) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
  }

  ///< Select all footprints belonging to same sheet, from Eeschema using cross-probing.
  private selectSheetContents(aEvent: TOOL_EVENT): number {
    this.ClearSelection(true /*quiet mode*/);
    const sheetPath = aEvent.Parameter<string>();

    this.selectAllItemsOnSheet(sheetPath);

    this.zoomFitSelection();

    if (this.m_selection.Size() > 0) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  ///< Select all footprints belonging to same hierarchical sheet as the selected footprint
  ///< (same sheet path).
  private selectSameSheet(_aEvent: TOOL_EVENT): number {
    // this function currently only supports footprints since they are only on one sheet.
    const item = this.m_selection.Front();

    if (!item) return 0;

    if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T) return 0;

    const footprint = item as FOOTPRINT;

    if (!footprint || footprint.GetPath().length === 0) return 0;

    this.ClearSelection(true /*quiet mode*/);

    // get the sheet path only.
    let sheetPath = beforeLast(pathAsString(footprint), '/');

    if (sheetPath === '') sheetPath += '/';

    this.selectAllItemsOnSheet(sheetPath);

    // Inform other potentially interested tools
    if (this.m_selection.Size() > 0) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  ///< Zoom the screen to center and fit the current selection.
  zoomFitSelection(): void {
    // Should recalculate the view to zoom in on the selection.
    const selectionBox = this.m_selection.GetBoundingBox();
    const view = this.getView()!;

    const clientSize = this.m_frame!.GetCanvas()!.GetClientSize();
    const screenSize = { ...view.ToWorld({ x: clientSize.x, y: clientSize.y }, false) };
    screenSize.x = Math.max(10.0, screenSize.x);
    screenSize.y = Math.max(10.0, screenSize.y);

    if (selectionBox.GetWidth() !== 0 || selectionBox.GetHeight() !== 0) {
      const vsize = selectionBox.GetSize();
      const scale =
        view.GetScale() /
        Math.max(Math.abs(vsize.x / screenSize.x), Math.abs(vsize.y / screenSize.y));
      view.SetScale(scale);
      view.SetCenter(selectionBox.Centre());
      view.Add(this.m_selection);
    }

    this.m_frame!.GetCanvas()!.ForceRefresh();
  }

  ///< Zoom the screen to fit the bounding box for cross probing/selection sync.
  ZoomFitCrossProbeBBox(aBBox: BOX2I): void {
    // Should recalculate the view to zoom in on the bbox.
    const view = this.getView()!;

    if (aBBox.GetWidth() === 0) return;

    const bbox = aBBox.Clone();
    bbox.Normalize();

    // Do the scaled zoom
    const bbSize = bbox.Inflate(KiROUND(bbox.GetWidth() * 0.2)).GetSize();
    const clientSize = this.m_frame!.GetCanvas()!.GetClientSize();
    const screenSize = { ...view.ToWorld({ x: clientSize.x, y: clientSize.y }, false) };

    // This code tries to come up with a zoom factor that doesn't simply zoom in
    // to the cross probed component, but instead shows a reasonable amount of the
    // circuit around it to provide context.  This reduces or eliminates the need
    // to manually change the zoom because it's too close.

    // Using the default text height as a constant to compare against, use the
    // height of the bounding box of visible items for a footprint to figure out
    // if this is a big footprint (like a processor) or a small footprint (like a resistor).
    // This ratio is not useful by itself as a scaling factor.  It must be "bent" to
    // provide good scaling at varying component sizes.  Bigger components need less
    // scaling than small ones.
    const currTextHeight = pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE);

    const compRatio = bbSize.y / currTextHeight; // Ratio of component to text height

    // This will end up as the scaling factor we apply to "ratio".
    let compRatioBent = 1.0;

    // This is similar to the original KiCad code that scaled the zoom to make sure
    // components were visible on screen.  It's simply a ratio of screen size to
    // component size, and its job is to zoom in to make the component fullscreen.
    // Earlier in the code the component BBox is given a 20% margin to add some
    // breathing room. We compare the height of this enlarged component bbox to the
    // default text height.  If a component will end up with the sides clipped, we
    // adjust later to make sure it fits on screen.
    //
    // The "fabs" on x ensures the right answer when the view is flipped
    screenSize.x = Math.max(10.0, Math.abs(screenSize.x));
    screenSize.y = Math.max(10.0, screenSize.y);
    let ratio = Math.max(-1.0, Math.abs(bbSize.y / screenSize.y));

    // Original KiCad code for how much to scale the zoom
    const kicadRatio = Math.max(
      Math.abs(bbSize.x / screenSize.x),
      Math.abs(bbSize.y / screenSize.y),
    );

    // LUT to scale zoom ratio to provide reasonable schematic context.  Must work
    // with footprints of varying sizes (e.g. 0402 package and 200 pin BGA).
    // "first" is used as the input and "second" as the output
    //
    // "first" = compRatio (footprint height / default text height)
    // "second" = Amount to scale ratio by
    const lut: [number, number][] = [
      [1, 8],
      [1.5, 5],
      [3, 3],
      [4.5, 2.5],
      [8, 2.0],
      [12, 1.7],
      [16, 1.5],
      [24, 1.3],
      [32, 1.0],
    ];

    compRatioBent = lut[lut.length - 1]![1]; // Large component default

    if (compRatio >= lut[0]![0]) {
      // Use LUT to do linear interpolation of "compRatio" within "first", then
      // use that result to linearly interpolate "second" which gives the scaling
      // factor needed.

      for (let it = 0; it < lut.length - 1; it++) {
        const cur = lut[it]!;
        const next = lut[it + 1]!;

        if (cur[0] <= compRatio && next[0] >= compRatio) {
          const diffx = compRatio - cur[0];
          const diffn = next[0] - cur[0];

          compRatioBent = cur[1] + ((next[1] - cur[1]) * diffx) / diffn;
          break; // We have our interpolated value
        }
      }
    } else {
      compRatioBent = lut[0]![1]; // Small component default
    }

    // If the width of the part we're probing is bigger than what the screen width will be
    // after the zoom, then punt and use the KiCad zoom algorithm since it guarantees the
    // part's width will be encompassed within the screen.  This will apply to parts that
    // are much wider than they are tall.

    if (bbSize.x > screenSize.x * ratio * compRatioBent) {
      // Use standard KiCad zoom algorithm for parts too wide to fit screen/
      ratio = kicadRatio;
      compRatioBent = 1.0; // Reset so we don't modify the "KiCad" ratio
    }

    // Now that "compRatioBent" holds our final scaling factor we apply it to the original
    // fullscreen zoom ratio to arrive at the final ratio itself.
    ratio *= compRatioBent;

    const alwaysZoom = false; // DEBUG - allows us to minimize zooming or not

    // Try not to zoom on every cross-probe; it gets very noisy
    if (ratio < 0.5 || ratio > 1.0 || alwaysZoom) view.SetScale(view.GetScale() / ratio);
  }

  /**
   * Take necessary actions to mark an item as found.
   *
   * @param aItem The item that was found and needs to be highlighted/focused/etc.
   */
  FindItem(aItem: BOARD_ITEM | null): void {
    let cleared = false;

    if (this.m_selection.GetSize() > 0) {
      // Don't fire an event now; most of the time it will be redundant as we're about to
      // fire a SelectedEvent.
      cleared = true;
      this.ClearSelection(true /*quiet mode*/);
    }

    if (aItem) {
      switch (aItem.Type()) {
        case KICAD_T.PCB_NETINFO_T: {
          const netCode = (aItem as unknown as { GetNetCode(): number }).GetNetCode();

          if (netCode > 0) {
            this.SelectAllItemsOnNet(netCode, true);
            this.m_frame!.FocusOnLocation(aItem.GetCenter());
          }
          break;
        }

        default:
          this.select(aItem);
          this.m_frame!.FocusOnLocation(aItem.GetPosition());
      }

      // If the item has a bounding box, then zoom out if needed
      if (aItem.GetBoundingBox().GetHeight() > 0 && aItem.GetBoundingBox().GetWidth() > 0) {
        // This adds some margin
        const marginFactor = 2;

        const pcbView = this.canvas().GetView();
        const screenBox = pcbView.GetViewport();
        const screenSize = screenBox.GetSize();
        const screenRect = BOX2ISafe(screenBox.GetOrigin(), {
          x: screenSize.x / marginFactor,
          y: screenSize.y / marginFactor,
        });

        if (!screenRect.Contains(aItem.GetBoundingBox())) {
          let scaleX = screenSize.x / aItem.GetBoundingBox().GetWidth();
          let scaleY = screenSize.y / aItem.GetBoundingBox().GetHeight();

          scaleX /= marginFactor;
          scaleY /= marginFactor;

          const scale = scaleX > scaleY ? scaleY : scaleX;

          if (scale < 1) {
            // Don't zoom in, only zoom out
            pcbView.SetScale(pcbView.GetScale() * scale);

            //Let's refocus because there is an algorithm to avoid dialogs in there.
            this.m_frame!.FocusOnLocation(aItem.GetCenter());
          }
        }
      }
      // Inform other potentially interested tools
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    } else if (cleared) {
      this.m_toolMgr!.ProcessEvent(EVENTS.ClearedEvent);
    }

    this.m_frame!.GetCanvas()!.ForceRefresh();
  }

  ///< Invoke filter dialog and modify current selection
  private filterSelection(_aEvent: TOOL_EVENT): number {
    const opts = this.m_priv.m_filterOpts;
    const host = this.m_frame as unknown as Partial<FILTER_SELECTION_DIALOG_HOST>;

    if (typeof host.ShowFilterSelectionDialog !== 'function') return 0;

    void host.ShowFilterSelectionDialog(opts).then((aOk) => {
      if (!aOk) return;

      // copy current selection
      const selection = this.m_selection.GetItems();

      this.ClearSelection(true /*quiet mode*/);

      // re-select items from the saved selection according to the dialog options
      for (const item of filterSelectionItems(selection, opts)) this.select(item);

      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    });

    return 0;
  }

  /**
   * Apply the SELECTION_FITLER_OPTIONS to the collector.
   */
  FilterCollectedItems(
    aCollector: GENERAL_COLLECTOR,
    aMultiSelect: boolean,
    aRejected: PCB_SELECTION_FILTER_OPTIONS | null = null,
  ): void {
    if (aCollector.GetCount() === 0) return;

    const rejected = new Set<BOARD_ITEM>();

    for (const i of aCollector) {
      if (!i.IsBOARD_ITEM()) continue;

      const item = i as BOARD_ITEM;

      if (!this.itemPassesFilter(item, aMultiSelect, aRejected)) rejected.add(item);
    }

    for (const item of ptrSorted(rejected)) aCollector.Remove(item);
  }

  ///< Return true if the given item passes the current SELECTION_FILTER_OPTIONS.
  private itemPassesFilter(
    aItem: BOARD_ITEM,
    aMultiSelect: boolean,
    aRejected: PCB_SELECTION_FILTER_OPTIONS | null = null,
  ): boolean {
    if (!this.m_filter.lockedItems) {
      if (aItem.IsLocked() || (aItem.GetParent() && aItem.GetParent()!.IsLocked())) {
        if (aItem.Type() === KICAD_T.PCB_PAD_T && !aMultiSelect) {
          // allow a single pad to be selected -- there are a lot of operations that
          // require this so we allow this one inconsistency
        } else {
          if (aRejected) aRejected.lockedItems = true;
          return false;
        }
      }
    }

    if (!aItem) return false;

    let itemType = aItem.Type();

    if (itemType === KICAD_T.PCB_GENERATOR_T) {
      const generatorItems = (aItem as PCB_GENERATOR).GetItems();

      if (generatorItems.size === 0) {
        if (!this.m_filter.otherItems) {
          if (aRejected) aRejected.otherItems = true;

          return false;
        }
      } else {
        // std::unordered_set's begin(): the first member
        itemType = generatorItems.values().next().value!.Type();
      }
    }

    switch (itemType) {
      case KICAD_T.PCB_FOOTPRINT_T:
        if (!this.m_filter.footprints) {
          if (aRejected) aRejected.footprints = true;

          return false;
        }

        break;

      case KICAD_T.PCB_PAD_T:
        if (!this.m_filter.pads) {
          if (aRejected) aRejected.pads = true;

          return false;
        }

        break;

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
        if (!this.m_filter.tracks) {
          if (aRejected) aRejected.tracks = true;

          return false;
        }

        break;

      case KICAD_T.PCB_VIA_T:
        if (!this.m_filter.vias) {
          if (aRejected) aRejected.vias = true;

          return false;
        }

        break;

      case KICAD_T.PCB_ZONE_T: {
        const zone = aItem as ZONE;

        if (
          (!this.m_filter.zones && !zone.GetIsRuleArea()) ||
          (!this.m_filter.keepouts && zone.GetIsRuleArea())
        ) {
          if (aRejected) {
            if (zone.GetIsRuleArea()) aRejected.keepouts = true;
            else aRejected.zones = true;
          }

          return false;
        }

        // m_SolderMaskBridges zone is a special zone, only used to showsolder mask briges
        // after running DRC. it is not really a board item.
        // Never select it or delete by a Commit.
        if (zone === this.m_frame!.GetBoard()!.m_SolderMaskBridges) return false;

        break;
      }

      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_TARGET_T:
        if (!this.m_filter.graphics) {
          if (aRejected) aRejected.graphics = true;

          return false;
        }

        break;

      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        if (!this.m_filter.graphics) {
          if (aRejected) aRejected.graphics = true;

          return false;
        }

        // a reference image living in a footprint must not be selected inside the board editor
        if (!this.m_isFootprintEditor && aItem.GetParentFootprint()) {
          if (aRejected) aRejected.text = true;

          return false;
        }

        break;

      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_TABLECELL_T:
        if (!this.m_filter.text) return false;

        break;

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
        if (!this.m_filter.dimensions) {
          if (aRejected) aRejected.dimensions = true;

          return false;
        }

        break;

      case KICAD_T.PCB_POINT_T:
        if (!this.m_filter.points) {
          if (aRejected) aRejected.points = true;

          return false;
        }

        break;

      default:
        if (!this.m_filter.otherItems) {
          if (aRejected) aRejected.otherItems = true;

          return false;
        }
    }

    return true;
  }

  /** `ClearSelection( bool aQuietMode = false )`. */
  ClearSelection(aQuietMode = false): void {
    // Drop any table-cell range anchor along with the selection itself (do this even when the
    // selection is already empty so that the cached pointer is not left stranded)
    this.m_previousFirstCell = null;

    if (this.m_selection.Empty()) return;

    while (this.m_selection.GetSize())
      this.unhighlight(this.m_selection.Front()!, SELECTED, this.m_selection);

    this.view()?.Update(this.m_selection);

    this.m_selection.SetIsHover(false);
    this.m_selection.ClearReferencePoint();

    // Inform other potentially interested tools
    if (!aQuietMode) {
      this.m_toolMgr!.ProcessEvent(EVENTS.ClearedEvent);
      this.m_toolMgr!.RunAction(PCB_ACTIONS.hideLocalRatsnest);
    }
  }

  /**
   * Rebuild the selection from the EDA_ITEMs' selection flags.
   *
   * Commonly called after rolling back an undo state to make sure there aren't any stale
   * pointers.
   */
  RebuildSelection(): void {
    // Drop the table-cell range anchor; the board may have been reloaded and any cached
    // pointer is no longer guaranteed to be valid.
    this.m_previousFirstCell = null;

    this.m_selection.Clear();

    let enteredGroupFound = false;

    const inspector = (item: EDA_ITEM, _testData: unknown): INSPECT_RESULT => {
      if (item.IsSelected()) {
        const parent = item.GetParent();

        // Let selected parents handle their children.
        if (parent?.IsSelected()) return INSPECT_RESULT.CONTINUE;

        this.highlight(item, SELECTED, this.m_selection);
      }

      if (item.Type() === KICAD_T.PCB_GROUP_T) {
        if (item === this.m_enteredGroup) {
          item.SetFlags(ENTERED);
          enteredGroupFound = true;
        } else {
          item.ClearFlags(ENTERED);
        }
      }

      return INSPECT_RESULT.CONTINUE;
    };

    this.board().Visit(
      inspector,
      null,
      this.m_isFootprintEditor ? GENERAL_COLLECTOR.FootprintItems : GENERAL_COLLECTOR.AllBoardItems,
    );

    if (!enteredGroupFound) {
      this.m_enteredGroupOverlay.Clear();
      this.m_enteredGroup = null;
    }
  }

  /**
   * @return true if an item fulfills conditions to be selected.
   */
  Selectable(aItem: BOARD_ITEM, checkVisibilityOnly = false): boolean {
    const settings = this.getView()!.GetPainter().GetSettings();
    const options = this.frame().GetDisplayOptions();

    const visibleLayers = (): LSET => {
      if (this.m_isFootprintEditor) {
        const set = new LSET();

        for (const layer of LSET.AllLayersMask()) set.set(layer, this.view().IsLayerVisible(layer));

        return set;
      } else {
        return this.board().GetVisibleLayers();
      }
    };

    const layerVisible = (aLayer: PCB_LAYER_ID): boolean => {
      if (this.m_isFootprintEditor) return this.view().IsLayerVisible(aLayer);
      else return this.board().IsLayerVisible(aLayer);
    };

    if (settings.GetHighContrast()) {
      const activeLayers = settings.GetHighContrastLayers();
      let onActiveLayer = false;

      for (const layer of [...activeLayers].sort((a, b) => a - b)) {
        // NOTE: Only checking the regular layers (not GAL meta-layers)
        if (layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT && aItem.IsOnLayer(ToLAYER_ID(layer))) {
          onActiveLayer = true;
          break;
        }
      }

      if (!onActiveLayer && aItem.Type() !== KICAD_T.PCB_MARKER_T) {
        // We do not want to select items that are in the background
        return false;
      }
    }

    if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
      const footprint = aItem as FOOTPRINT;

      // In footprint editor, we do not want to select the footprint itself.
      if (this.m_isFootprintEditor) return false;

      // If the footprint has no items except the reference and value fields, include the
      // footprint in the selections.
      if (
        footprint.GraphicalItems().length === 0 &&
        footprint.Pads().length === 0 &&
        footprint.Zones().length === 0
      ) {
        return true;
      }

      for (const item of footprint.GraphicalItems()) {
        if (this.Selectable(item, true)) return true;
      }

      for (const pad of footprint.Pads()) {
        if (this.Selectable(pad, true)) return true;
      }

      for (const zone of footprint.Zones()) {
        if (this.Selectable(zone, true)) return true;
      }

      for (const point of footprint.Points()) {
        if (this.Selectable(point, true)) return true;
      }

      return false;
    } else if (aItem.Type() === KICAD_T.PCB_GROUP_T) {
      const group = aItem as PCB_GROUP;

      // Similar to logic for footprint, a group is selectable if any of its members are.
      // (This recurses.)
      for (const item of group.GetBoardItems()) {
        if (this.Selectable(item, true)) return true;
      }

      return false;
    }

    if (aItem.GetParentGroup()?.AsEdaItem().Type() === KICAD_T.PCB_GENERATOR_T) return false;

    // Most footprint children can only be selected in the footprint editor.
    if (aItem.GetParentFootprint() && !this.m_isFootprintEditor && !checkVisibilityOnly) {
      if (
        aItem.Type() !== KICAD_T.PCB_FIELD_T &&
        aItem.Type() !== KICAD_T.PCB_PAD_T &&
        aItem.Type() !== KICAD_T.PCB_TEXT_T
      )
        return false;
    }

    switch (aItem.Type()) {
      case KICAD_T.PCB_ZONE_T: {
        if (
          !this.board().IsElementVisible(GAL_LAYER_ID.LAYER_ZONES) ||
          options.m_ZoneOpacity === 0.0
        )
          return false;

        const zone = aItem as ZONE;

        // A teardrop is modelled as a property of a via, pad or the board (for track-to-track
        // teardrops).  The underlying zone is only an implementation detail.
        if (zone.IsTeardropArea() && !this.board().LegacyTeardrops()) return false;

        // zones can exist on multiple layers!
        if (!zone.GetLayerSet().and(visibleLayers()).any()) return false;

        break;
      }

      case KICAD_T.PCB_TRACE_T:
      case KICAD_T.PCB_ARC_T:
        if (
          !this.board().IsElementVisible(GAL_LAYER_ID.LAYER_TRACKS) ||
          options.m_TrackOpacity === 0.0
        )
          return false;

        if (!layerVisible(aItem.GetLayer())) return false;

        break;

      case KICAD_T.PCB_VIA_T: {
        if (!this.board().IsElementVisible(GAL_LAYER_ID.LAYER_VIAS) || options.m_ViaOpacity === 0.0)
          return false;

        const via = aItem as PCB_VIA;

        // For vias it is enough if only one of its layers is visible
        if (!visibleLayers().and(via.GetLayerSet()).any()) return false;

        break;
      }

      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T: {
        if (aItem.Type() === KICAD_T.PCB_FIELD_T) {
          const field = aItem as PCB_FIELD;

          if (!field.IsVisible()) return false;

          if (field.IsReference() && !this.view().IsLayerVisible(GAL_LAYER_ID.LAYER_FP_REFERENCES))
            return false;

          if (field.IsValue() && !this.view().IsLayerVisible(GAL_LAYER_ID.LAYER_FP_VALUES))
            return false;

          // Handle all other fields with normal text visibility controls
        }

        const text = aItem as PCB_TEXT;

        if (!layerVisible(text.GetLayer())) return false;

        // Apply the LOD visibility test as well
        if (!this.view().IsVisible(text)) return false;

        if (aItem.GetParentFootprint()) {
          let controlLayer: number = GAL_LAYER_ID.LAYER_FP_TEXT;

          if (text.GetText() === '${REFERENCE}') controlLayer = GAL_LAYER_ID.LAYER_FP_REFERENCES;
          else if (text.GetText() === '${VALUE}') controlLayer = GAL_LAYER_ID.LAYER_FP_VALUES;

          if (!this.view().IsLayerVisible(controlLayer)) return false;
        }

        break;
      }

      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        if (options.m_ImageOpacity === 0.0) return false;

        // Bitmap images on board are hidden if LAYER_DRAW_BITMAPS is not visible
        if (!this.view().IsLayerVisible(GAL_LAYER_ID.LAYER_DRAW_BITMAPS)) return false;

        if (!layerVisible(aItem.GetLayer())) return false;

        break;

      case KICAD_T.PCB_SHAPE_T:
        if (options.m_FilledShapeOpacity === 0.0 && (aItem as PCB_SHAPE).IsAnyFill()) return false;

        if (!layerVisible(aItem.GetLayer())) return false;

        break;

      case KICAD_T.PCB_BARCODE_T:
        if (!layerVisible(aItem.GetLayer())) return false;

        break;

      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
        if (!layerVisible(aItem.GetLayer())) return false;

        break;

      case KICAD_T.PCB_TABLECELL_T: {
        const cell = aItem as PCB_TABLECELL;

        if (!layerVisible(aItem.GetLayer())) return false;

        if (cell.GetRowSpan() === 0 || cell.GetColSpan() === 0) return false;

        break;
      }

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        if (!layerVisible(aItem.GetLayer())) return false;

        break;

      case KICAD_T.PCB_PAD_T: {
        if (options.m_PadOpacity === 0.0) return false;

        const pad = aItem as PAD;

        if (pad.GetAttribute() === PAD_ATTRIB.PTH || pad.GetAttribute() === PAD_ATTRIB.NPTH) {
          // A pad's hole is visible on every layer the pad is visible on plus many layers the
          // pad is not visible on -- so we only need to check for any visible hole layers.
          if (!visibleLayers().and(LSET.PhysicalLayersMask()).any()) return false;
        } else {
          if (!pad.GetLayerSet().and(visibleLayers()).any()) return false;
        }

        break;
      }

      case KICAD_T.PCB_MARKER_T: {
        const marker = aItem as PCB_MARKER;

        if (
          marker?.IsExcluded() &&
          !this.board().IsElementVisible(GAL_LAYER_ID.LAYER_DRC_EXCLUSION)
        )
          return false;

        break;
      }

      case KICAD_T.PCB_POINT_T:
        if (!layerVisible(aItem.GetLayer())) return false;

        if (!this.board().IsElementVisible(GAL_LAYER_ID.LAYER_POINTS)) return false;

        break;

      // These are not selectable
      case KICAD_T.PCB_NETINFO_T:
      case KICAD_T.NOT_USED:
      case KICAD_T.TYPE_NOT_INIT:
        return false;

      default: // Suppress warnings
        break;
    }

    return true;
  }

  /**
   * Take necessary action mark an item as selected.
   *
   * @param aItem The item to be selected.
   */
  override select(aItem: EDA_ITEM | null): void {
    if (!aItem || aItem.IsSelected() || !aItem.IsBOARD_ITEM()) return;

    if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      const footprint = aItem.GetParent() as FOOTPRINT;

      if (this.m_selection.Contains(footprint)) return;
    }

    if (
      this.m_enteredGroup &&
      !PCB_GROUP.WithinScope(aItem as BOARD_ITEM, this.m_enteredGroup, this.m_isFootprintEditor)
    ) {
      this.ExitGroup();
    }

    this.highlight(aItem, SELECTED, this.m_selection);
  }

  /**
   * Take necessary action mark an item as unselected.
   *
   * @param aItem is an item to be unselected.
   */
  protected override unselect(aItem: EDA_ITEM): void {
    this.unhighlight(aItem, SELECTED, this.m_selection);
  }

  /**
   * Highlight the item visually.
   *
   * @param aItem The item to be highlighted.
   * @param aHighlightMode Either SELECTED or BRIGHTENED
   * @param aGroup [optional A group to add the item to.
   */
  protected override highlight(aItem: EDA_ITEM, aMode: number, aGroup?: SELECTION): void {
    if (aGroup) aGroup.Add(aItem);

    this.highlightInternal(aItem, aMode, aGroup !== undefined);
    this.view()?.Update(aItem, VIEW_UPDATE_FLAGS.REPAINT);

    // Many selections are very temporal and updating the display each time just
    // creates noise.
    if (aMode === BRIGHTENED) this.getView()?.MarkTargetDirty(RENDER_TARGET.TARGET_OVERLAY);
  }

  private highlightInternal(aItem: EDA_ITEM, aMode: number, aUsingOverlay: boolean): void {
    if (aMode === SELECTED) aItem.SetSelected();
    else if (aMode === BRIGHTENED) aItem.SetBrightened();

    if (aUsingOverlay && aMode !== BRIGHTENED) this.view()?.Hide(aItem, true); // Hide the original item, so it is shown only on overlay

    if (aItem.IsBOARD_ITEM()) {
      const boardItem = aItem as BOARD_ITEM;
      boardItem.RunOnChildren(
        (aChild: BOARD_ITEM) => this.highlightInternal(aChild, aMode, aUsingOverlay),
        RECURSE_MODE.RECURSE,
      );
    }
  }

  /**
   * Unhighlight the item visually.
   *
   * @param aItem The item to be highlighted.
   * @param aHighlightMode Either SELECTED or BRIGHTENED
   * @param aGroup [optional] A group to remove the item from.
   */
  protected override unhighlight(aItem: EDA_ITEM, aMode: number, aGroup?: SELECTION): void {
    if (aGroup) aGroup.Remove(aItem);

    this.unhighlightInternal(aItem, aMode, aGroup !== undefined);
    this.view()?.Update(aItem, VIEW_UPDATE_FLAGS.REPAINT);

    // Many selections are very temporal and updating the display each time just creates noise.
    if (aMode === BRIGHTENED) this.getView()?.MarkTargetDirty(RENDER_TARGET.TARGET_OVERLAY);
  }

  private unhighlightInternal(aItem: EDA_ITEM, aMode: number, aUsingOverlay: boolean): void {
    if (aMode === SELECTED) aItem.ClearSelected();
    else if (aMode === BRIGHTENED) aItem.ClearBrightened();

    if (aUsingOverlay && aMode !== BRIGHTENED) {
      this.view()?.Hide(aItem, false); // Restore original item visibility...
      this.view()?.Update(aItem); // ... and make sure it's redrawn un-selected
    }

    if (aItem.IsBOARD_ITEM()) {
      const boardItem = aItem as BOARD_ITEM;
      boardItem.RunOnChildren(
        (aChild: BOARD_ITEM) => this.unhighlightInternal(aChild, aMode, aUsingOverlay),
        RECURSE_MODE.RECURSE,
      );
    }
  }

  /**
   * @return true if the given point is contained in any of selected items' bounding boxes.
   */
  private selectionContains(aPoint: VECTOR2I): boolean {
    const GRIP_MARGIN = 20;
    const view = this.getView();

    // A frame with no canvas (a headless one) has no screen to grip in.
    if (!view) return false;

    const margin = KiROUND(view.ToWorld(GRIP_MARGIN));

    // Check if the point is located close to any of the currently selected items
    for (const item of this.m_selection) {
      if (!item.IsBOARD_ITEM()) continue;

      const itemBox = item.ViewBBox();
      itemBox.Inflate(margin); // Give some margin for gripping an item

      if (itemBox.Contains(aPoint)) {
        if (item.HitTest(aPoint, margin)) return true;

        let found = false;

        if (item.Type() === KICAD_T.PCB_GROUP_T || item.Type() === KICAD_T.PCB_GENERATOR_T) {
          (item as PCB_GROUP).RunOnChildren((aItem: BOARD_ITEM) => {
            if (aItem.HitTest(aPoint, margin)) found = true;
          }, RECURSE_MODE.RECURSE);
        }

        if (found) return true;
      }
    }

    return false;
  }

  /**
   * @return the distance from \a aWhere to \a aItem, up to and including \a aMaxDistance.
   */
  private hitTestDistance(aWhere: VECTOR2I, aItem: BOARD_ITEM, aMaxDistance: number): number {
    const viewportD = this.getView()!.GetViewport();
    const viewport = BOX2ISafe(viewportD);
    const distance = { value: INT_MAX };
    const loc = new SEG(aWhere, aWhere);

    switch (aItem.Type()) {
      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T: {
        const text = aItem as PCB_TEXT;

        // Add a bit of slop to text-shapes
        if (text.GetEffectiveTextShape().Collide(loc, aMaxDistance, distance))
          distance.value = clamp(distance.value - Math.trunc(aMaxDistance / 2), 0, distance.value);

        break;
      }

      case KICAD_T.PCB_TEXTBOX_T: {
        const textbox = aItem as PCB_TEXTBOX;

        // Add a bit of slop to text-shapes
        if (textbox.GetEffectiveTextShape().Collide(loc, aMaxDistance, distance))
          distance.value = clamp(distance.value - Math.trunc(aMaxDistance / 2), 0, distance.value);

        break;
      }

      case KICAD_T.PCB_TABLECELL_T: {
        const tablecell = aItem as PCB_TABLECELL;
        const shape = new SHAPE_COMPOUND(tablecell.MakeEffectiveShapesForHitTesting());

        shape.Collide(loc, aMaxDistance, distance);

        break;
      }

      case KICAD_T.PCB_TABLE_T: {
        const table = aItem as PCB_TABLE;
        distance.value = aMaxDistance;

        for (const cell of table.GetCells())
          distance.value = Math.min(
            distance.value,
            this.hitTestDistance(aWhere, cell, aMaxDistance),
          );

        // Tables should defer to their table cells.  Never consider them exact.
        distance.value = clamp(distance.value + Math.trunc(aMaxDistance / 4), 0, aMaxDistance);
        break;
      }

      case KICAD_T.PCB_ZONE_T: {
        const zone = aItem as ZONE;

        // Zone borders are very specific
        if (zone.HitTestForEdge(aWhere, Math.trunc(aMaxDistance / 2))) distance.value = 0;
        else if (zone.HitTestForEdge(aWhere, aMaxDistance))
          distance.value = Math.trunc(aMaxDistance / 2);
        else aItem.GetEffectiveShape().Collide(loc, aMaxDistance, distance);

        break;
      }

      case KICAD_T.PCB_FOOTPRINT_T: {
        const footprint = aItem as FOOTPRINT;
        const bbox = footprint.GetBoundingBox(false);

        try {
          footprint.GetBoundingHull().Collide(loc, aMaxDistance, distance);
        } catch (e) {
          console.assert(false, `Clipper exception occurred: ${(e as Error).message}`);
        }

        // Consider footprints larger than the viewport only as a last resort
        if (bbox.GetHeight() > viewport.GetHeight() || bbox.GetWidth() > viewport.GetWidth())
          distance.value = Math.trunc(INT_MAX / 2);

        break;
      }

      case KICAD_T.PCB_MARKER_T: {
        const marker = aItem as PCB_MARKER;
        const polygon = new SHAPE_LINE_CHAIN();

        marker.ShapeToPolygon(polygon);
        polygon.Move(marker.GetPos());
        polygon.Collide(loc, aMaxDistance, distance);
        break;
      }

      case KICAD_T.PCB_GROUP_T:
      case KICAD_T.PCB_GENERATOR_T: {
        const group = aItem as PCB_GROUP;

        for (const member of group.GetBoardItems())
          distance.value = Math.min(
            distance.value,
            this.hitTestDistance(aWhere, member, aMaxDistance),
          );

        break;
      }

      case KICAD_T.PCB_PAD_T: {
        (aItem as PAD).Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
          const layerDistance = { value: INT_MAX };
          aItem.GetEffectiveShape(aLayer).Collide(loc, aMaxDistance, layerDistance);
          distance.value = Math.min(distance.value, layerDistance.value);
        });

        break;
      }

      default:
        aItem.GetEffectiveShape().Collide(loc, aMaxDistance, distance);
        break;
    }

    return distance.value;
  }

  /**
   * Event handler to update the selection VIEW_ITEM.
   */
  private updateSelection(_aEvent: TOOL_EVENT): number {
    this.getView()?.Update(this.m_selection);
    this.getView()?.Update(this.m_enteredGroupOverlay);

    return 0;
  }

  private pruneObscuredSelectionCandidates(aCollector: GENERAL_COLLECTOR): void {
    if (!this.m_frame) return;

    if (aCollector.GetCount() < 2) return;

    const settings = this.getView()!.GetPainter().GetSettings();

    if (!settings) return;

    const activeLayer = this.m_frame.GetActiveLayer();
    const visibleLayers = this.m_frame.GetBoard()!.GetVisibleLayers();
    const enabledLayers = this.m_frame.GetBoard()!.GetEnabledLayers();
    const enabledLayerStack = enabledLayers.SeqStackupTop2Bottom(activeLayer);

    if (enabledLayerStack.length === 0) return;

    const isZoneFillKeepout = (aItem: BOARD_ITEM): boolean => {
      if (aItem.Type() === KICAD_T.PCB_ZONE_T) {
        const zone = aItem as ZONE;

        if (zone.GetIsRuleArea() && zone.GetDoNotAllowZoneFills()) return true;
      }

      return false;
    };

    const opacityStackup: LAYER_OPACITY_ITEM[] = [];

    for (let i = 0; i < aCollector.GetCount(); i++) {
      const item = aCollector.At(i) as BOARD_ITEM;

      const itemLayers = item.GetLayerSet().and(enabledLayers).and(visibleLayers);
      const itemLayerSeq = itemLayers.Seq(enabledLayerStack);

      for (const layer of itemLayerSeq) {
        const color = settings.GetColor(item, layer) as COLOR4D;

        if (color.a === 0) continue;

        const opacityItem: LAYER_OPACITY_ITEM = {
          m_Layer: layer,
          m_Opacity: color.a,
          m_Item: item,
        };

        if (isZoneFillKeepout(item)) opacityItem.m_Opacity = 0.0;

        opacityStackup.push(opacityItem);
      }
    }

    opacityStackup.sort((aLhs, aRhs) => {
      const lt = (l: LAYER_OPACITY_ITEM, r: LAYER_OPACITY_ITEM): boolean => {
        const retv = LSEQ_TestLayers(enabledLayerStack, l.m_Layer, r.m_Layer);

        if (retv) return retv > 0;

        return l.m_Opacity > r.m_Opacity;
      };

      return lt(aLhs, aRhs) ? -1 : lt(aRhs, aLhs) ? 1 : 0;
    });

    const visibleItems = new Set<BOARD_ITEM>();
    const itemsToRemove = new Set<BOARD_ITEM>();
    const minAlphaLimit = ADVANCED_CFG.GetCfg().m_PcbSelectionVisibilityRatio;
    let currentStackupOpacity = 0.0;
    let lastVisibleLayer = PCB_LAYER_ID.UNDEFINED_LAYER;

    for (const opacityItem of opacityStackup) {
      if (lastVisibleLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
        currentStackupOpacity = opacityItem.m_Opacity;
        lastVisibleLayer = opacityItem.m_Layer;
        visibleItems.add(opacityItem.m_Item);
        continue;
      }

      // Objects to ignore and fallback to the old selection behavior.
      const ignoreItem = (): boolean => {
        const item = opacityItem.m_Item;

        if (!item) return false;

        // Check items that span multiple layers for visibility.
        if (visibleItems.has(item)) return true;

        // Don't prune child items of a footprint that is already visible.
        if (
          item.GetParent() &&
          item.GetParent()!.Type() === KICAD_T.PCB_FOOTPRINT_T &&
          visibleItems.has(item.GetParent() as BOARD_ITEM)
        ) {
          return true;
        }

        // Keepout zones are transparent but for some reason, PCB_PAINTER::GetColor()
        // returns the color of the zone it prevents from filling.
        if (isZoneFillKeepout(item)) return true;

        return false;
      };

      // Everything on the currently selected layer is visible;
      if (opacityItem.m_Layer === enabledLayerStack[0]) {
        visibleItems.add(opacityItem.m_Item);
      } else {
        const itemVisibility = opacityItem.m_Opacity * (1.0 - currentStackupOpacity);

        if (itemVisibility <= minAlphaLimit && !ignoreItem()) itemsToRemove.add(opacityItem.m_Item);
        else visibleItems.add(opacityItem.m_Item);
      }

      if (opacityItem.m_Layer !== lastVisibleLayer) {
        currentStackupOpacity += opacityItem.m_Opacity * (1.0 - currentStackupOpacity);
        currentStackupOpacity = Math.min(currentStackupOpacity, 1.0);
        lastVisibleLayer = opacityItem.m_Layer;
      }
    }

    for (const itemToRemove of ptrSorted(itemsToRemove)) {
      if (!(aCollector.GetCount() > 1)) return;
      aCollector.Remove(itemToRemove);
    }
  }

  // The general idea here is that if the user clicks directly on a small item inside a larger
  // one, then they want the small item.  The quintessential case of this is clicking on a pad
  // within a footprint, but we also apply it for text within a footprint, footprints within
  // larger footprints, and vias within either larger pads or longer tracks.
  //
  // These "guesses" presume there is area within the larger item to click in to select it.  If
  // an item is mostly covered by smaller items within it, then the guesses are inappropriate as
  // there might not be any area left to click to select the larger item.  In this case we must
  // leave the items in the collector and bring up a Selection Clarification menu.
  //
  // We currently check for pads and text mostly covering a footprint, but we don't check for
  // smaller footprints mostly covering a larger footprint.
  //
  /**
   * Try to guess best selection candidates in case multiple items are clicked, by doing
   * some brain-dead heuristics.
   *
   * @param aCollector [in, out] The collector that has a list of items to be narrowed.
   * @param aWhere The selection point to consider.
   */
  GuessSelectionCandidates(aCollector: GENERAL_COLLECTOR, aWhere: VECTOR2I): void {
    const silkLayers = new LSET([PCB_LAYER_ID.B_SilkS, PCB_LAYER_ID.F_SilkS]);
    const courtyardLayers = new LSET([PCB_LAYER_ID.B_CrtYd, PCB_LAYER_ID.F_CrtYd]);
    const singleLayerSilkTypes = [
      KICAD_T.PCB_FIELD_T,
      KICAD_T.PCB_TEXT_T,
      KICAD_T.PCB_TEXTBOX_T,
      KICAD_T.PCB_TABLE_T,
      KICAD_T.PCB_TABLECELL_T,
      KICAD_T.PCB_SHAPE_T,
      KICAD_T.PCB_BARCODE_T,
    ];

    if (ADVANCED_CFG.GetCfg().m_PcbSelectionVisibilityRatio !== 1.0)
      this.pruneObscuredSelectionCandidates(aCollector);

    if (aCollector.GetCount() === 1) return;

    const preferred = new Set<BOARD_ITEM>();
    const rejected = new Set<BOARD_ITEM>();
    const where: VECTOR2I = { x: aWhere.x, y: aWhere.y };
    const settings = this.getView()!.GetPainter().GetSettings();
    const activeLayer = this.m_frame!.GetActiveLayer();

    // If a silk layer is in front, we assume the user is working with silk and give preferential
    // treatment to single-layer items on *either* silk layer.
    if (silkLayers.test(activeLayer)) {
      for (let i = 0; i < aCollector.GetCount(); ++i) {
        const item = aCollector.At(i) as BOARD_ITEM;

        if (item.IsType(singleLayerSilkTypes) && silkLayers.test(item.GetLayer()))
          preferred.add(item);
      }
    }
    // Similarly, if a courtyard layer is in front, we assume the user is positioning footprints
    // and give preferential treatment to footprints on *both* top and bottom.
    else if (courtyardLayers.test(activeLayer) && settings.GetHighContrast()) {
      for (let i = 0; i < aCollector.GetCount(); ++i) {
        const item = aCollector.At(i) as BOARD_ITEM;

        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) preferred.add(item);
      }
    }

    if (preferred.size > 0) {
      aCollector.Empty();

      for (const item of ptrSorted(preferred)) aCollector.Append(item);

      if (preferred.size === 1) return;
    }

    // Prefer exact hits to sloppy ones
    const MAX_SLOP = 5;

    const singlePixel = KiROUND(aCollector.GetGuide()!.OnePixelInIU());
    const maxSlop = KiROUND(MAX_SLOP * aCollector.GetGuide()!.OnePixelInIU());
    let minSlop = INT_MAX;

    const itemsBySloppiness = new Map<BOARD_ITEM, number>();

    for (let i = 0; i < aCollector.GetCount(); ++i) {
      const item = aCollector.At(i) as BOARD_ITEM;
      const itemSlop = this.hitTestDistance(where, item, maxSlop);

      itemsBySloppiness.set(item, itemSlop);

      if (itemSlop < minSlop) minSlop = itemSlop;
    }

    // Prune sloppier items
    if (minSlop < INT_MAX) {
      for (const item of ptrSorted(itemsBySloppiness.keys())) {
        if (itemsBySloppiness.get(item)! > minSlop + singlePixel) aCollector.Transfer(item);
      }
    }

    // If the user clicked on a small item within a much larger one then it's pretty clear
    // they're trying to select the smaller one.
    const sizeRatio = 1.5;

    const itemsByArea: [BOARD_ITEM, number][] = [];

    for (let i = 0; i < aCollector.GetCount(); ++i) {
      const item = aCollector.At(i) as BOARD_ITEM;
      let area = 0.0;

      if (
        item.Type() === KICAD_T.PCB_ZONE_T &&
        (item as ZONE).HitTestForEdge(where, Math.trunc(maxSlop / 2))
      ) {
        // Zone borders are very specific, so make them "small"
        area = SEG.Square(singlePixel) * MAX_SLOP;
      } else if (item.Type() === KICAD_T.PCB_VIA_T) {
        // Vias rarely hide other things, and we don't want them deferring to short track
        // segments underneath them -- so artificially reduce their size from πr² to r².
        area = SEG.Square(Math.trunc((item as PCB_VIA).GetDrill() / 2));
      } else if (item.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T) {
        const box = item.GetBoundingBox();
        area = box.GetWidth() * box.GetHeight();
      } else {
        try {
          area = FOOTPRINT.GetCoverageArea(
            item,
            aCollector as unknown as GENERAL_COLLECTOR_FOR_COVERAGE,
          );
        } catch (e) {
          console.assert(false, `Clipper exception occurred: ${(e as Error).message}`);
        }
      }

      itemsByArea.push([item, area]);
    }

    itemsByArea.sort((lhs, rhs) => lhs[1] - rhs[1]);

    let rejecting = false;

    for (let i = 1; i < itemsByArea.length; ++i) {
      if (itemsByArea[i]![1] > itemsByArea[i - 1]![1] * sizeRatio) rejecting = true;

      if (rejecting) rejected.add(itemsByArea[i]![0]);
    }

    // Special case: if a footprint is completely covered with other features then there's no
    // way to select it -- so we need to leave it in the list for user disambiguation.
    const maxCoverRatio = 0.7;

    for (let i = 0; i < aCollector.GetCount(); ++i) {
      const item = aCollector.At(i)!;

      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const footprint = item as FOOTPRINT;

        if (
          footprint.CoverageRatio(aCollector as unknown as GENERAL_COLLECTOR_FOR_COVERAGE) >
          maxCoverRatio
        )
          rejected.delete(footprint);
      }
    }

    // Hopefully we've now got what the user wanted.
    if (aCollector.GetCount() > rejected.size) {
      // do not remove everything
      for (const item of ptrSorted(rejected)) aCollector.Transfer(item);
    }

    // Finally, what we are left with is a set of items of similar coverage area.  We now reject
    // any that are not on the active layer, to reduce the number of disambiguation menus shown.
    // If the user wants to force-disambiguate, they can either switch layers or use the modifier
    // key to force the menu.
    if (aCollector.GetCount() > 1) {
      let haveItemOnActive = false;
      rejected.clear();

      for (let i = 0; i < aCollector.GetCount(); ++i) {
        const item = aCollector.At(i) as BOARD_ITEM;

        if (!item.IsOnLayer(activeLayer)) rejected.add(item);
        else haveItemOnActive = true;
      }

      if (haveItemOnActive) {
        for (const item of ptrSorted(rejected)) aCollector.Transfer(item);
      }
    }
  }

  /**
   * If the most recent FilterCollectorForLockedItems call filtered a locked item, show an
   * InfoBar warning prompting the user to enable Override locks and return true.  The caller
   * should stop the action in that case.  Return false otherwise.
   */
  ReportFilteredLockedItems(): boolean {
    if (this.m_lockedItemsFiltered && this.m_frame) {
      this.m_frame.ShowInfoBarWarning(
        "Selection contains locked items. Enable 'Override locks' to operate on them.",
        true,
      );
    }

    return this.m_lockedItemsFiltered;
  }

  /**
   * @return true if a locked descendant should pin aItem in place.  Locked items inside a
   * footprint move rigidly with it, so only descendants outside a parent footprint count
   * (group members, see issue 6841).
   */
  static HasLockedDescendant(aItem: BOARD_ITEM): boolean {
    let lockedDescendant = false;

    aItem.RunOnChildren((curr_item: BOARD_ITEM) => {
      if (!curr_item.GetParentFootprint() && curr_item.IsLocked()) lockedDescendant = true;
    }, RECURSE_MODE.RECURSE);

    return lockedDescendant;
  }

  /// True if aItem may be selected while aEnteredGroup is entered (24967).
  static isWithinEnteredGroup(
    aItem: BOARD_ITEM,
    aEnteredGroup: PCB_GROUP | null,
    aIsFootprintEditor: boolean,
  ): boolean {
    if (aEnteredGroup) return PCB_GROUP.WithinScope(aItem, aEnteredGroup, aIsFootprintEditor);

    // Not entered: keep expansion at the top level so it can't reach into a group and
    // silently pull the whole group into a later delete.
    return aItem.GetParentGroup() === null;
  }

  /**
   * In the PCB editor strip out any locked items unless the OverrideLocks checkbox is set.
   */
  FilterCollectorForLockedItems(aCollector: GENERAL_COLLECTOR): void {
    this.m_lockedItemsFiltered = false;

    if (
      this.m_frame &&
      this.m_frame.IsType(FRAME_T.FRAME_PCB_EDITOR) &&
      !this.m_frame.GetOverrideLocks()
    ) {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i) as BOARD_ITEM;

        if (item.IsLocked() || PCB_SELECTION_TOOL.HasLockedDescendant(item)) {
          aCollector.Remove(item);
          this.m_lockedItemsFiltered = true;
        }
      }
    }
  }

  /**
   * In general we don't want to select both a parent and any of it's children.  This includes
   * both footprints and their items, and groups and their members.
   */
  FilterCollectorForHierarchy(aCollector: GENERAL_COLLECTOR, aMultiselect: boolean): void {
    const toAdd = new Set<EDA_ITEM>();

    // Set CANDIDATE on all parents which are included in the GENERAL_COLLECTOR.  This
    // algorithm is O(3n), whereas checking for the parent inclusion could potentially be O(n^2).
    for (let j = 0; j < aCollector.GetCount(); j++) {
      const item = aCollector.At(j) as BOARD_ITEM;

      if (item.GetParent()) item.GetParent()!.ClearFlags(CANDIDATE);

      if (item.GetParentFootprint()) item.GetParentFootprint()!.ClearFlags(CANDIDATE);
    }

    if (aMultiselect) {
      for (let j = 0; j < aCollector.GetCount(); j++) aCollector.At(j)!.SetFlags(CANDIDATE);
    }

    for (let j = 0; j < aCollector.GetCount(); ) {
      const item = aCollector.At(j) as BOARD_ITEM;
      const fp = item.GetParentFootprint();
      let start: BOARD_ITEM = item;

      if (!this.m_isFootprintEditor && fp) start = fp;

      // If a group is entered, disallow selections of objects outside the group.
      if (
        this.m_enteredGroup &&
        !PCB_GROUP.WithinScope(item, this.m_enteredGroup, this.m_isFootprintEditor)
      ) {
        aCollector.Remove(item);
        continue;
      }

      // If any element is a member of a group, replace those elements with the top containing
      // group.
      const top = PCB_GROUP.TopLevelGroup(start, this.m_enteredGroup, this.m_isFootprintEditor);

      if (top) {
        if (top.AsEdaItem() !== item) {
          toAdd.add(top.AsEdaItem());
          top.AsEdaItem().SetFlags(CANDIDATE);

          aCollector.Remove(item);
          continue;
        }
      }

      // Footprints are a bit easier as they can't be nested.
      if (fp && fp.GetFlags() & CANDIDATE) {
        // Remove children of selected items
        aCollector.Remove(item);
        continue;
      }

      ++j;
    }

    // std::unordered_set: any order; insertion order here
    for (const item of toAdd) {
      if (!aCollector.HasItem(item)) aCollector.Append(item);
    }
  }

  /**
   * Promote any table cell selections to the whole table.
   */
  FilterCollectorForTableCells(aCollector: GENERAL_COLLECTOR): void {
    const to_add = new Set<BOARD_ITEM>();

    // Iterate from the back so we don't have to worry about removals.
    for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
      const item = aCollector.At(i) as BOARD_ITEM;

      if (item.Type() === KICAD_T.PCB_TABLECELL_T) {
        if (!aCollector.HasItem(item.GetParent()!)) to_add.add(item.GetParent() as BOARD_ITEM);

        aCollector.Remove(item);
      }
    }

    for (const item of ptrSorted(to_add)) aCollector.Append(item);
  }

  /**
   * Check the "allow free pads" setting and if disabled, replace any pads in the collector
   * with their parent footprints.
   */
  FilterCollectorForFreePads(aCollector: GENERAL_COLLECTOR, aForcePromotion = false): void {
    const to_add = new Set<BOARD_ITEM>();

    // Iterate from the back so we don't have to worry about removals.
    for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
      const item = aCollector.At(i) as BOARD_ITEM;

      if (
        !this.m_isFootprintEditor &&
        item.Type() === KICAD_T.PCB_PAD_T &&
        (!this.frame().GetPcbNewSettings().m_AllowFreePads || aForcePromotion)
      ) {
        if (!aCollector.HasItem(item.GetParent()!)) to_add.add(item.GetParent() as BOARD_ITEM);

        aCollector.Remove(item);
      }
    }

    for (const item of ptrSorted(to_add)) aCollector.Append(item);
  }

  /**
   * Drop any PCB_MARKERs from the collector.
   */
  FilterCollectorForMarkers(aCollector: GENERAL_COLLECTOR): void {
    // Iterate from the back so we don't have to worry about removals.
    for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
      const item = aCollector.At(i)!;

      if (item.Type() === KICAD_T.PCB_MARKER_T) aCollector.Remove(item);
    }
  }

  /**
   * Drop footprints that are not directly selected
   */
  FilterCollectorForFootprints(aCollector: GENERAL_COLLECTOR, aWhere: VECTOR2I): void {
    const settings = this.getView()!.GetPainter().GetSettings();
    const viewport = this.getView()!.GetViewport();
    const extents = BOX2ISafe(viewport);

    let need_direct_hit = false;
    let single_fp: FOOTPRINT | null = null;

    // If the designer is not modifying the existing selection AND we already have
    // a selection, then we only want to select items that are directly under the cursor.
    // This prevents us from being unable to clear the selection when zoomed into a footprint
    if (
      !this.m_additive &&
      !this.m_subtractive &&
      !this.m_exclusive_or &&
      this.m_selection.GetSize() > 0
    ) {
      need_direct_hit = true;

      for (const item of this.m_selection) {
        let fp: FOOTPRINT | null = null;

        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) fp = item as FOOTPRINT;
        else if (item.IsBOARD_ITEM()) fp = (item as BOARD_ITEM).GetParentFootprint();

        // If the selection contains items that are not footprints, then don't restrict
        // whether we deselect the item or not.
        if (!fp) {
          single_fp = null;
          break;
        } else if (!single_fp) {
          single_fp = fp;
        }
        // If the selection contains items from multiple footprints, then don't restrict
        // whether we deselect the item or not.
        else if (single_fp !== fp) {
          single_fp = null;
          break;
        }
      }
    }

    const visibleLayers = (): LSET => {
      if (this.m_isFootprintEditor) {
        const set = new LSET();

        for (const layer of LSET.AllLayersMask()) set.set(layer, this.view().IsLayerVisible(layer));

        return set;
      } else {
        return this.board().GetVisibleLayers();
      }
    };

    const layers = visibleLayers();

    if (settings.GetHighContrast()) {
      layers.reset();

      const activeLayers = settings.GetHighContrastLayers();

      for (const layer of activeLayers) {
        if (layer >= 0 && layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT) layers.set(layer);
      }
    }

    // Iterate from the back so we don't have to worry about removals.
    for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
      const item = aCollector.At(i)!;

      if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T) continue;

      const fp = item as FOOTPRINT;

      // Make footprints not difficult to select in high-contrast modes.
      if (layers.test(fp.GetLayer())) continue;

      const bbox = fp.GetLayerBoundingBox(layers);

      // If the point clicked is not inside the visible bounding box, we can also remove it.
      if (!bbox.Contains(aWhere)) aCollector.Remove(item);

      let has_hit = false;

      for (const layer of layers) {
        if (fp.HitTestOnLayer(extents, false, layer)) {
          has_hit = true;
          break;
        }
      }

      // If the point is outside of the visible bounding box, we can remove it.
      if (!has_hit) {
        aCollector.Remove(item);
      }
      // Do not require a direct hit on this fp if the existing selection only contains
      // this fp's items.  This allows you to have a selection of pads from a single
      // footprint and still click in the center of the footprint to select it.
      else if (single_fp) {
        if (fp === single_fp) continue;
      } else if (need_direct_hit) {
        has_hit = false;

        for (const layer of layers) {
          if (fp.HitTestOnLayer(aWhere, layer)) {
            has_hit = true;
            break;
          }
        }

        if (!has_hit) aCollector.Remove(item);
      }
    }
  }

  SelectColumns(_aEvent: TOOL_EVENT): number {
    const columns: [PCB_TABLE, number][] = [];
    let added = false;

    for (const item of this.m_selection) {
      if (item.Type() === KICAD_T.PCB_TABLECELL_T) {
        const cell = item as PCB_TABLECELL;
        const table = cell.GetParent() as PCB_TABLE;

        if (!columns.some(([t, c]) => t === table && c === cell.GetColumn()))
          columns.push([table, cell.GetColumn()]);
      }
    }

    // std::set<std::pair<PCB_TABLE*, int>>: by pointer, then column
    columns.sort((a, b) => ptrOrdinal(a[0]) - ptrOrdinal(b[0]) || a[1] - b[1]);

    for (const [table, col] of columns) {
      for (let row = 0; row < table.GetRowCount(); ++row) {
        const cell = table.GetCell(row, col)!;

        if (!cell.IsSelected()) {
          this.select(table.GetCell(row, col));
          added = true;
        }
      }
    }

    if (added) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  SelectRows(_aEvent: TOOL_EVENT): number {
    const rows: [PCB_TABLE, number][] = [];
    let added = false;

    for (const item of this.m_selection) {
      if (item.Type() === KICAD_T.PCB_TABLECELL_T) {
        const cell = item as PCB_TABLECELL;
        const table = cell.GetParent() as PCB_TABLE;

        if (!rows.some(([t, r]) => t === table && r === cell.GetRow()))
          rows.push([table, cell.GetRow()]);
      }
    }

    // std::set<std::pair<PCB_TABLE*, int>>: by pointer, then row
    rows.sort((a, b) => ptrOrdinal(a[0]) - ptrOrdinal(b[0]) || a[1] - b[1]);

    for (const [table, row] of rows) {
      for (let col = 0; col < table.GetColCount(); ++col) {
        const cell = table.GetCell(row, col)!;

        if (!cell.IsSelected()) {
          this.select(table.GetCell(row, col));
          added = true;
        }
      }
    }

    if (added) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  SelectTable(_aEvent: TOOL_EVENT): number {
    const tables = new Set<PCB_TABLE>();
    let added = false;

    for (const item of this.m_selection) {
      if (item.Type() === KICAD_T.PCB_TABLECELL_T) tables.add(item.GetParent() as PCB_TABLE);
    }

    this.ClearSelection();

    for (const table of ptrSorted(tables)) {
      if (!table.IsSelected()) {
        this.select(table);
        added = true;
      }
    }

    if (added) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);

    return 0;
  }

  GetFilter(): PCB_SELECTION_FILTER_OPTIONS {
    return this.m_filter;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.UpdateMenu), ACTIONS.updateMenu.MakeEvent());

    this.Go(this.Main, ACTIONS.selectionActivate.MakeEvent());
    this.Go(this.CursorSelection, ACTIONS.selectionCursor.MakeEvent());
    this.Go(SYNC_HANDLER(this.ClearSelectionEvt), ACTIONS.selectionClear.MakeEvent());

    this.Go(SYNC_HANDLER(this.AddItemToSel), ACTIONS.selectItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.AddItemsToSel), ACTIONS.selectItems.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveItemFromSel), ACTIONS.unselectItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveItemsFromSel), ACTIONS.unselectItems.MakeEvent());
    this.Go(SYNC_HANDLER(this.ReselectItem), ACTIONS.reselectItem.MakeEvent());
    this.Go(this.SelectionMenu, ACTIONS.selectionMenu.MakeEvent());

    this.Go(SYNC_HANDLER(this.filterSelection), PCB_ACTIONS.filterSelection.MakeEvent());
    this.Go(this.expandConnection, PCB_ACTIONS.selectConnection.MakeEvent());
    this.Go(SYNC_HANDLER(this.unrouteSelected), PCB_ACTIONS.unrouteSelected.MakeEvent());
    this.Go(SYNC_HANDLER(this.unrouteSegment), PCB_ACTIONS.unrouteSegment.MakeEvent());
    this.Go(this.selectNet, PCB_ACTIONS.selectNet.MakeEvent());
    this.Go(this.selectNet, PCB_ACTIONS.deselectNet.MakeEvent());
    this.Go(SYNC_HANDLER(this.selectUnconnected), PCB_ACTIONS.selectUnconnected.MakeEvent());
    this.Go(SYNC_HANDLER(this.grabUnconnected), PCB_ACTIONS.grabUnconnected.MakeEvent());
    this.Go(SYNC_HANDLER(this.syncSelection), PCB_ACTIONS.syncSelection.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.syncSelectionWithNets),
      PCB_ACTIONS.syncSelectionWithNets.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.selectSameSheet), PCB_ACTIONS.selectSameSheet.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.selectSheetContents),
      PCB_ACTIONS.selectOnSheetFromEeschema.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.updateSelection), EVENTS.SelectedItemsModified);
    this.Go(SYNC_HANDLER(this.updateSelection), EVENTS.SelectedItemsMoved);
    this.Go(SYNC_HANDLER(this.SelectColumns), ACTIONS.selectColumns.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectRows), ACTIONS.selectRows.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectTable), ACTIONS.selectTable.MakeEvent());

    this.Go(SYNC_HANDLER(this.SetSelectPoly), ACTIONS.selectSetLasso.MakeEvent());
    this.Go(SYNC_HANDLER(this.SetSelectRect), ACTIONS.selectSetRect.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectAll), ACTIONS.selectAll.MakeEvent());
    this.Go(SYNC_HANDLER(this.UnselectAll), ACTIONS.unselectAll.MakeEvent());

    this.Go(this.disambiguateCursor, EVENTS.DisambiguatePoint);
  }

  /**
   * `view()`. Null only before the frame has a canvas: the page builds the
   * `PCB_DRAW_PANEL_GAL` after the font atlas loads, while `setupTools` (and so
   * `InitTools`' first `Reset`) runs in the frame's constructor, and a frame
   * built by a test may never get one. Selecting then just draws nothing.
   */
  protected view(): PCB_VIEW {
    return this.getView() as PCB_VIEW;
  }

  protected controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  protected frame(): PCB_BASE_FRAME {
    return this.getEditFrame<PCB_BASE_FRAME>();
  }

  protected editFrame(): PCB_BASE_EDIT_FRAME {
    return this.getEditFrame<PCB_BASE_EDIT_FRAME>();
  }

  protected board(): BOARD {
    return this.getModel<BOARD>();
  }

  protected canvas(): PCB_DRAW_PANEL_GAL {
    return this.frame().GetCanvas() as PCB_DRAW_PANEL_GAL;
  }
}

/** `DEFAULT_TEXT_SIZE` (eda_text.h): 1.27 mm. */
const DEFAULT_TEXT_SIZE = 1.27;

const INT_MAX = 2147483647;

function clamp(aValue: number, aLo: number, aHi: number): number {
  return aValue < aLo ? aLo : aHi < aValue ? aHi : aValue;
}

function isTrack(aItem: BOARD_ITEM): boolean {
  return (
    aItem.Type() === KICAD_T.PCB_TRACE_T ||
    aItem.Type() === KICAD_T.PCB_ARC_T ||
    aItem.Type() === KICAD_T.PCB_VIA_T
  );
}

/** `footprint->GetPath().AsString()`. */
function pathAsString(aFootprint: FOOTPRINT): string {
  return aFootprint
    .GetPath()
    .map((k) => `/${k}`)
    .join('');
}

/** `wxString::BeforeLast( ch )`: everything before the last `ch`, or empty when there is none. */
function beforeLast(aText: string, aCh: string): string {
  const i = aText.lastIndexOf(aCh);

  return i < 0 ? '' : aText.slice(0, i);
}
