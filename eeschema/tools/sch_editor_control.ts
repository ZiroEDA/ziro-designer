// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDITOR_CONTROL` (eeschema/tools/sch_editor_control.{h,cpp}): the schematic editor's
 * actions - setup and output dialogs, undo and redo, cross-probing, annotation, the view toggles,
 * the line modes.
 *
 * Ported a section at a time; setTransitions lists what each section has not reached yet.
 */
import { DS_PROXY_UNDO_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_undo_item.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { Pgm, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import {
  AS_GLOBAL,
  TA_UNDO_REDO_PRE,
  TC_MESSAGE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { updateEeschemaSettings } from '../eeschema_settings.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  ANNOTATE_ALGO_T,
  ANNOTATE_ORDER_T,
  SCH_REFERENCE,
  SCH_REFERENCE_LIST,
} from '../sch_reference_list.js';
import {
  SCH_SHEET_INSTANCE,
  SCH_SHEET_LIST,
  type SCH_SHEET_PATH,
  SCH_SYMBOL_INSTANCE,
  SYMBOL_FILTER,
} from '../sch_sheet_path.js';
import { LINE_MODE, SCH_ACTIONS } from './sch_actions.js';
import { SCH_SELECTION_TOOL } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import {
  GetClipboardUTF8,
  GetImageFromClipboard,
  SaveClipboard,
  SetClipboardData,
  wxDataObjectComposite,
} from '@ziroeda/common/clipboard.js';
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import type { PasteSpecialMode } from '@ziroeda/common/dialogs/dialog_paste_special_types.js';
import {
  ENDPOINT,
  IS_MOVING,
  IS_NEW,
  IS_PASTED,
  STARTPOINT,
} from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { KIID_PATH, newKiid } from '@ziroeda/common/kiid.js';
import { strNumCmp, unescapeString } from '@ziroeda/common/string_utils.js';
import { INT_MAX } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { LIB_SYMBOL } from '../lib_symbol.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SymbolLibAdapter } from '../project_sch.js';
import { SCH_IO_MGR } from '../sch_io/sch_io_mgr.js';
import { RESCUER, SYMBOL_LIB_TABLE_RESCUER } from '../project_rescue.js';
import { SCH_BITMAP } from '../sch_bitmap.js';
import type { SCH_LINE } from '../sch_line.js';
import type { SCH_SHAPE } from '../sch_shape.js';
import type { SCH_TABLE } from '../sch_table.js';
import { SCH_TEXT } from '../sch_text.js';
import { FORMAT_MODE, Prettify } from '@ziroeda/common/io/kicad/kicad_io_utils.js';
import { STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { PosixPath, SCH_IO_KICAD_SEXPR } from '../sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { GetSelectedItemsAsText, UniqueGroupName } from './sch_tool_utils.js';
import { SCH_EDIT_TABLE_TOOL } from './sch_edit_table_tool.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { applyMixins } from '@ziroeda/core/mixins.js';
import { SCH_ASSIGN_FOOTPRINTS_MIXIN } from './assign_footprints.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { PICKER_TOOL } from '@ziroeda/common/tool/picker_tool.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import { CONNECTION_SUBGRAPH } from '../connection_graph.js';
import { ERC_TESTER } from '../erc/erc.js';
import type { SCH_CONNECTION } from '../sch_connection.js';
import { NET_NAVIGATOR_ITEM_DATA, SCH_SEARCH_T } from '../sch_edit_frame.js';
import { SCH_ITEM } from '../sch_item.js';
import type { SCH_GROUP } from '../sch_group.js';
import type { SCH_PIN } from '../sch_pin.js';
import { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { SCH_CLEANUP_FLAGS } from '../schematic.js';
import { ensureFileExtension } from '@ziroeda/common/common.js';
import { KICTL_REVERT } from '@ziroeda/common/kiway_player.js';
import {
  KiCadSchematicFileExtension,
  kicadSchematicWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxFD_OVERWRITE_PROMPT, wxFD_SAVE } from '@ziroeda/common/wx/defs.js';
import { wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { SCH_SCREEN, SCH_SCREENS } from '../sch_screen.js';

/** `MAX_PAGE_SIZE_EESCHEMA_MILS` (page_info.h). [data] */
const MAX_PAGE_SIZE_EESCHEMA_MILS = 120000;

/** `NET_PLUGIN_CHANGE` (dialog_netlist.h): what InvokeDialogNetList returns after a plugin edit. [data] */
const NET_PLUGIN_CHANGE = 1;

/** `DIALOG_INCREMENT_ANNOTATIONS_BASE`'s three controls, which the window fills on OK. */
export interface INCREMENT_ANNOTATIONS_VALUES {
  /** `m_FirstRefDes->GetValue()`. */
  firstRefDes: string;
  /** `m_AllSheets->GetValue()`. */
  allSheets: boolean;
  /** `m_Increment->GetValue()`. */
  increment: number;
}

/** A singleton reference for clearing the highlight. */
const CLEAR: VECTOR2D = { x: Number.NaN, y: Number.NaN };

/** `highlightNet( aToolMgr, aPosition )` (sch_editor_control.cpp:1054). */
async function highlightNet(aToolMgr: TOOL_MANAGER, aPosition: VECTOR2D): Promise<boolean> {
  const editFrame = aToolMgr.GetToolHolder() as unknown as SCH_EDIT_FRAME;
  const selTool = aToolMgr.GetTool(SCH_SELECTION_TOOL)!;
  const editorControl = aToolMgr.GetTool(SCH_EDITOR_CONTROL)!;
  let conn: SCH_CONNECTION | null = null;
  let item: SCH_ITEM | null = null;
  let retVal = true;

  if (aPosition !== CLEAR) {
    const erc = new ERC_TESTER(editFrame.Schematic());

    if (erc.TestDuplicateSheetNames(false) > 0) {
      await editFrame.ShowModalDialog('wxMessageBox', [], {
        message: 'Error: duplicate sub-sheet names found in current sheet.',
      });
      retVal = false;
    } else {
      item = selTool.GetNode(aPosition) as SCH_ITEM | null;
      let symbol = item && item.Type() === KICAD_T.SCH_SYMBOL_T ? (item as SCH_SYMBOL) : null;

      if (item) {
        if (item.IsConnectivityDirty())
          editFrame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.NO_CLEANUP);

        if (item.Type() === KICAD_T.SCH_FIELD_T) {
          const parent = item.GetParent();
          symbol = parent && parent.Type() === KICAD_T.SCH_SYMBOL_T ? (parent as SCH_SYMBOL) : null;
        }

        if (symbol && symbol.GetLibSymbolRef() && symbol.GetLibSymbolRef()!.IsPower()) {
          const pins = symbol.GetPins();

          if (pins.length === 1) conn = pins[0]!.Connection();
        } else {
          conn = item.Connection();
        }
      }
    }
  }

  const connName = conn ? conn.Name() : '';

  if (!conn) {
    editFrame.SetStatusText('');
    editFrame.SendCrossProbeClearHighlight();
    editFrame.SetHighlightedConnection('');
    editorControl.SetHighlightBusMembers(false);
  } else {
    const itemData = new NET_NAVIGATOR_ITEM_DATA(editFrame.GetCurrentSheet(), item);

    if (connName !== editFrame.GetHighlightedConnection()) {
      editorControl.SetHighlightBusMembers(false);
      editFrame.SetCrossProbeConnection(conn);
      editFrame.SetHighlightedConnection(connName, itemData);
    } else {
      editorControl.SetHighlightBusMembers(!editorControl.GetHighlightBusMembers());

      if (item !== editFrame.GetSelectedNetNavigatorItem())
        editFrame.SelectNetNavigatorItem(itemData);
    }
  }

  editFrame.UpdateNetHighlightStatus();

  editorControl.UpdateNetHighlighting(new TOOL_EVENT());

  return retVal;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_ASSIGN_FOOTPRINTS_MIXIN, see libs/core/mixins.ts)
export interface SCH_EDITOR_CONTROL extends SCH_ASSIGN_FOOTPRINTS_MIXIN {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (SCH_ASSIGN_FOOTPRINTS_MIXIN, see libs/core/mixins.ts)
export class SCH_EDITOR_CONTROL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  private m_probingPcbToSch = false; // Recursion guard for PCB to schematic cross-probing
  private m_duplicateClipboard = ''; // Temporary storage for Duplicate action
  private m_duplicateIsHoverSelection = false;

  // A map of sheet filename --> screens for the clipboard contents.  We use these to hook up
  // cut/paste operations for unsaved sheet content.
  private readonly m_supplementaryClipboard = new Map<string, SCH_SCREEN>();

  // A map of KIID_PATH --> symbol instances for the clipboard contents.
  private readonly m_clipboardSymbolInstances = new Map<string, SCH_SYMBOL_INSTANCE>();
  private readonly m_pastedSymbols = new Set<SCH_SYMBOL>();
  private m_highlightBusMembers = false;

  SetHighlightBusMembers(aHighlightBusMembers: boolean): void {
    this.m_highlightBusMembers = aHighlightBusMembers;
  }

  GetHighlightBusMembers(): boolean {
    return this.m_highlightBusMembers;
  }

  /**
   * `FindSymbolAndItem( aPath, aReference, aSearchHierarchy, aSearchType, aSearchText )`
   * (cross-probing.cpp:54): find a symbol (by path, else by reference) and optionally one of its
   * pins, go to its sheet and focus on it.
   */
  FindSymbolAndItem(
    aPath: string | null,
    aReference: string | null,
    aSearchHierarchy: boolean,
    aSearchType: SCH_SEARCH_T,
    aSearchText: string,
  ): SCH_ITEM | null {
    let sheetWithSymbolFound: SCH_SHEET_PATH | null = null;
    let symbol: SCH_SYMBOL | null = null;
    let pin: SCH_PIN | null = null;
    let foundItem: SCH_ITEM | null = null;

    const sheetList = aSearchHierarchy
      ? [...this.m_frame!.Schematic().Hierarchy()]
      : [this.m_frame!.GetCurrentSheet()];

    for (const sheet of sheetList) {
      const screen = sheet.LastScreen()!;

      for (const item of screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
        const candidate = item as SCH_SYMBOL;

        // Search by path if specified, otherwise search by reference
        let found: boolean;

        if (aPath !== null) {
          const path = sheet.PathAsString() + candidate.m_Uuid;
          found = aPath === path;
        } else {
          found =
            aReference !== null &&
            aReference.toLowerCase() === candidate.GetRef(sheet).toLowerCase();
        }

        if (found) {
          symbol = candidate;
          sheetWithSymbolFound = sheet;

          if (aSearchType === SCH_SEARCH_T.HIGHLIGHT_PIN) {
            pin = symbol.GetPin(aSearchText);

            // Ensure we have found the right unit in case of multi-units symbol
            if (pin) {
              const unit = pin.GetLibPin()!.GetUnit();

              if (unit !== 0 && unit !== symbol.GetUnit()) {
                pin = null;
                continue;
              }

              // Get pin position in true schematic coordinate
              foundItem = pin;
              break;
            }
          } else {
            foundItem = symbol;
            break;
          }
        }
      }

      if (foundItem) break;
    }

    const crossProbingSettings = this.m_frame!.eeconfig()!.cross_probing;

    if (symbol) {
      if (!sheetWithSymbolFound!.equals(this.m_frame!.GetCurrentSheet()))
        this.m_frame!.GetToolManager()!.RunAction(SCH_ACTIONS.changeSheet, sheetWithSymbolFound);

      if (crossProbingSettings.center_on_items) {
        if (crossProbingSettings.zoom_to_fit) {
          const bbox = symbol.GetBoundingBox();

          this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!.ZoomFitCrossProbeBBox(bbox);
        }

        if (pin) this.m_frame!.FocusOnItem(pin);
        else this.m_frame!.FocusOnItem(symbol);
      }
    }

    /* Print diag */
    let msg: string;
    let displayRef = '';

    if (aReference !== null) displayRef = aReference;
    else if (aPath !== null) displayRef = aPath;

    if (symbol) {
      if (aSearchType === SCH_SEARCH_T.HIGHLIGHT_PIN) {
        if (foundItem) msg = `${displayRef} pin ${aSearchText} found`;
        else msg = `${displayRef} found but pin ${aSearchText} not found`;
      } else {
        msg = `${displayRef} found`;
      }
    } else {
      msg = `${displayRef} not found`;
    }

    this.m_frame!.SetStatusText(msg);
    this.m_frame!.GetCanvas()?.Refresh();

    return foundItem;
  }

  ///< Highlight net under the cursor.
  *HighlightNet(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const controls = this.getViewControls()!;
    const cursorPos = controls.GetCursorPosition(!aEvent.DisableGridSnapping());

    yield* this.RunMainStackModal(() => highlightNet(this.m_toolMgr!, cursorPos));

    return 0;
  }

  ///< Remove any net highlighting
  *ClearHighlight(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => highlightNet(this.m_toolMgr!, CLEAR));

    return 0;
  }

  ///< Launch a tool to highlight nets.
  HighlightNetCursor(aEvent: TOOL_EVENT): number {
    const picker = this.m_toolMgr!.GetTool(PICKER_TOOL)!;

    // Deactivate other tools; particularly important if another PICKER is currently running
    this.Activate();

    picker.SetCursor(KICURSOR.BULLSEYE);
    picker.SetSnapping(false);
    picker.ClearHandlers();

    picker.SetClickHandler((aPos: VECTOR2D) => {
      // highlightNet answers false only after its duplicate-sheet-name message, which the
      // window shows; the click is handled either way.
      void highlightNet(this.m_toolMgr!, aPos);
      return true;
    });

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    return 0;
  }

  *AssignNetclass(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const selectionTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const schematic = this.m_frame!.Schematic();
    const screen = this.m_frame!.GetCurrentSheet().LastScreen()!;

    const selectedConns: SCH_CONNECTION[] = [];

    for (const item of selectionTool.GetSelection()) {
      const conn = (item as SCH_ITEM).Connection();

      if (!conn) continue;

      selectedConns.push(conn);
    }

    if (selectedConns.length === 0) {
      this.m_frame!.ShowInfoBarError('No nets selected.');
      return 0;
    }

    // Remove selection in favor of highlighting so the whole net is highlighted
    selectionTool.ClearSelection();

    const getNetNamePattern = (aConn: SCH_CONNECTION): string | null => {
      const netName = aConn.Name();

      if (aConn.IsBus()) {
        const prefix = { value: '' };

        if (NET_SETTINGS.ParseBusVector(netName, prefix, null)) return `${prefix.value}*`;
        else if (NET_SETTINGS.ParseBusGroup(netName, prefix, null)) return `${prefix.value}.*`;
      } else if (
        !aConn.Driver() ||
        CONNECTION_SUBGRAPH.GetDriverPriority(aConn.Driver()!) <
          CONNECTION_SUBGRAPH.PRIORITY.SHEET_PIN
      ) {
        return null;
      }

      return netName;
    };

    const netNames = new Set<string>();

    for (const conn of selectedConns) {
      const netNamePattern = getNetNamePattern(conn);

      if (netNamePattern === null) {
        // This is a choice, we can also allow some un-labeled nets as long as some are labeled.
        this.m_frame!.ShowInfoBarError('All selected nets must be labeled to assign a netclass.');
        return 0;
      }

      netNames.add(netNamePattern);
    }

    if (netNames.size === 0) return 0; // wxCHECK

    const previewer = (aNetNames: readonly string[]) => {
      for (const item of screen.Items()) {
        let redraw = item.IsBrightened();
        const itemConn = item.Connection();

        if (itemConn && aNetNames.includes(itemConn.Name())) item.SetBrightened();
        else item.ClearBrightened();

        redraw ||= item.IsBrightened();

        if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
          const symbol = item as SCH_SYMBOL;

          redraw ||= symbol.HasBrightenedPins();

          symbol.ClearBrightenedPins();

          for (const pin of symbol.GetPins()) {
            const pin_conn = pin.Connection();

            if (pin_conn && aNetNames.includes(pin_conn.Name())) {
              pin.SetBrightened();
              redraw = true;
            }
          }
        } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
          for (const pin of (item as SCH_SHEET).GetPins()) {
            const pin_conn = pin.Connection();

            redraw ||= pin.IsBrightened();

            if (pin_conn && aNetNames.includes(pin_conn.Name())) pin.SetBrightened();
            else pin.ClearBrightened();

            redraw ||= pin.IsBrightened();
          }
        }

        if (redraw) this.getView()?.Update(item, VIEW_UPDATE_FLAGS.REPAINT);
      }

      this.m_frame!.GetCanvas()?.ForceRefresh();
    };

    const result = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_ASSIGN_NETCLASS', [], {
        netNames: [...netNames],
        candidates: schematic.GetNetClassAssignmentCandidates(),
        previewer,
      }),
    );

    if (result) {
      this.getView()?.UpdateAllItemsConditionally((aItem) => {
        let flags = 0;

        const invalidateTextVars = (text: EDA_TEXT) => {
          if (text.HasTextVars()) {
            text.ClearRenderCache();
            text.ClearBoundingBoxCache();
            flags |= VIEW_UPDATE_FLAGS.GEOMETRY | VIEW_UPDATE_FLAGS.REPAINT;
          }
        };

        // Netclass coloured items
        //
        const type = (aItem as EDA_ITEM).Type?.();

        if (
          type === KICAD_T.SCH_LINE_T ||
          type === KICAD_T.SCH_JUNCTION_T ||
          type === KICAD_T.SCH_BUS_WIRE_ENTRY_T ||
          type === KICAD_T.SCH_BUS_BUS_ENTRY_T
        )
          flags |= VIEW_UPDATE_FLAGS.REPAINT;

        // Items that might reference an item's netclass name
        //
        if (aItem instanceof SCH_ITEM) {
          aItem.RunOnChildren((aChild: SCH_ITEM) => {
            if (aChild instanceof EDA_TEXT) invalidateTextVars(aChild as unknown as EDA_TEXT);
          }, RECURSE_MODE.NO_RECURSE);

          if (flags & VIEW_UPDATE_FLAGS.GEOMETRY) this.m_frame!.GetScreen()!.Update(aItem, false); // Refresh RTree
        }

        if (aItem instanceof EDA_TEXT) invalidateTextVars(aItem as unknown as EDA_TEXT);

        return flags;
      });
    }

    yield* this.RunMainStackModal(() => highlightNet(this.m_toolMgr!, CLEAR));
    return 0;
  }

  FindNetInInspector(_aEvent: TOOL_EVENT): number {
    const selectionTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL);

    if (!selectionTool) return 0;

    let netName = '';

    for (const item of selectionTool.GetSelection()) {
      const conn = item instanceof SCH_ITEM ? item.Connection() : null;

      if (conn && conn.GetNetName() !== '') {
        netName = conn.GetNetName();
        break;
      }
    }

    if (netName === '') netName = this.m_frame!.GetHighlightedConnection();

    if (netName === '') {
      this.m_frame!.ShowInfoBarError('No connected net selected.');
      return 0;
    }

    this.m_frame!.FindNetInInspector(netName);

    return 0;
  }

  ///< Update net highlighting after an edit
  UpdateNetHighlighting(_aEvent: TOOL_EVENT): number {
    if (!this.m_frame) return 0; // wxCHECK

    const sheetPath = this.m_frame.GetCurrentSheet();
    const screen = this.m_frame.GetCurrentSheet().LastScreen();
    const connectionGraph = this.m_frame.Schematic().ConnectionGraph();
    const selectedName = this.m_frame.GetHighlightedConnection();

    const connNames = new Set<string>();
    const itemsToRedraw: EDA_ITEM[] = [];

    if (!screen || !connectionGraph) return 0; // wxCHECK

    if (selectedName !== '') {
      connNames.add(selectedName);

      const sg = connectionGraph.FindSubgraphByName(selectedName, sheetPath);

      if (sg && this.m_highlightBusMembers) {
        for (const item of sg.GetItems()) {
          const connection = item.Connection();

          if (connection) {
            for (const member of connection.AllMembers()) {
              if (member) connNames.add(member.Name());
            }
          }
        }
      }

      // Place all bus names that are connected to the selected net in the set, regardless of
      // their sheet. This ensures that nets that are connected to a bus on a different sheet
      // get their buses highlighted as well.
      for (const subgraph of connectionGraph.GetAllSubgraphs(selectedName)) {
        for (const bus_sgs of subgraph.GetBusParents().values()) {
          for (const bus_sg of bus_sgs) connNames.add(bus_sg.GetNetName());
        }
      }
    }

    for (const item of screen.Items()) {
      if (!item || !item.IsConnectable()) continue;

      let redrawItem: SCH_ITEM | null = null;

      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as SCH_SYMBOL;

        for (const pin of symbol.GetPins()) {
          const pin_conn = pin.Connection();

          if (pin_conn) {
            if (!pin.IsBrightened() && connNames.has(pin_conn.Name())) {
              pin.SetBrightened();
              redrawItem = symbol;
            } else if (pin.IsBrightened() && !connNames.has(pin_conn.Name())) {
              pin.ClearBrightened();
              redrawItem = symbol;
            }
          } else if (pin.IsBrightened()) {
            pin.ClearBrightened();
            redrawItem = symbol;
          }
        }

        if (symbol.IsPower() && symbol.GetPins().length) {
          const pinConn = symbol.GetPins()[0]!.Connection();

          for (const id of [FIELD_T.REFERENCE, FIELD_T.VALUE]) {
            const field = symbol.GetField(id)!;

            if (!field.IsVisible()) continue;

            if (pinConn) {
              if (!field.IsBrightened() && connNames.has(pinConn.Name())) {
                field.SetBrightened();
                redrawItem = symbol;
              } else if (field.IsBrightened() && !connNames.has(pinConn.Name())) {
                field.ClearBrightened();
                redrawItem = symbol;
              }
            } else if (field.IsBrightened()) {
              field.ClearBrightened();
              redrawItem = symbol;
            }
          }
        }
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const sheet = item as SCH_SHEET;

        for (const pin of sheet.GetPins()) {
          const pin_conn = pin.Connection();

          if (pin_conn) {
            if (!pin.IsBrightened() && connNames.has(pin_conn.Name())) {
              pin.SetBrightened();
              redrawItem = sheet;
            } else if (pin.IsBrightened() && !connNames.has(pin_conn.Name())) {
              pin.ClearBrightened();
              redrawItem = sheet;
            }
          } else if (pin.IsBrightened()) {
            pin.ClearBrightened();
            redrawItem = sheet;
          }
        }
      } else {
        const itemConn = item.Connection();

        if (itemConn) {
          if (!item.IsBrightened() && connNames.has(itemConn.Name())) {
            item.SetBrightened();
            redrawItem = item;
          } else if (item.IsBrightened() && !connNames.has(itemConn.Name())) {
            item.ClearBrightened();
            redrawItem = item;
          }
        } else if (item.IsBrightened()) {
          item.ClearBrightened();
          redrawItem = item;
        }
      }

      if (redrawItem) itemsToRedraw.push(redrawItem);
    }

    if (itemsToRedraw.length) {
      // Be sure highlight change will be redrawn
      const view = this.getView();

      for (const redrawItem of itemsToRedraw) view?.Update(redrawItem, VIEW_UPDATE_FLAGS.REPAINT);

      this.m_frame.GetCanvas()?.Refresh();
    }

    return 0;
  }

  constructor() {
    super('eeschema.EditorControl');
  }

  New(_aEvent: TOOL_EVENT): number {
    this.m_frame!.NewProject();
    return 0;
  }

  Open(_aEvent: TOOL_EVENT): number {
    this.m_frame!.LoadProject();
    return 0;
  }

  *Save(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.SaveProject());
    return 0;
  }

  *SaveAs(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.SaveProject(true));
    return 0;
  }

  /// Saves the currently-open schematic sheet to an other name
  *SaveCurrSheetCopyAs(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const curr_sheet = this.m_frame!.GetCurrentSheet().Last()!;
    const curr_fn = curr_sheet.GetFileName();
    const slash = curr_fn.lastIndexOf('/');

    const picked = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowFileDialog(
        'Schematic Files',
        slash >= 0 ? curr_fn.slice(0, slash) : '',
        curr_fn.slice(slash + 1),
        [kicadSchematicWildcard()],
        wxFD_SAVE | wxFD_OVERWRITE_PROMPT,
      ),
    );

    if (picked === null) return 0; // `return false`

    const newFilename = ensureFileExtension(picked, KiCadSchematicFileExtension);

    this.m_frame!.saveSchematicFile(curr_sheet, newFilename);
    return 0;
  }

  *Revert(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const schematic = this.m_frame!.Schematic();
    const root = schematic.Root();

    // Save original sheet path to restore if user cancels
    const originalSheet = this.m_frame!.GetCurrentSheet();
    const wasOnSubsheet = this.m_frame!.GetCurrentSheet().Last() !== root;

    // Navigate to root sheet first (needed for proper reload), but don't repaint yet
    if (wasOnSubsheet) {
      // Use the properly constructed root sheet path from the hierarchy
      // (manually pushing root creates a path with empty KIID which causes assertions)
      const rootSheetPath = schematic.Hierarchy()[0]!;

      this.m_frame!.GetToolManager()!.RunAction(SCH_ACTIONS.changeSheet, rootSheetPath);
    }

    const msg = `Revert '${schematic.GetFileName()}' (and all sub-sheets) to last version saved?`;

    if (!(yield* this.RunMainStackModal(() => Promise.resolve(this.m_frame!.IsOK(msg))))) {
      // User cancelled - navigate back to original sheet
      if (wasOnSubsheet)
        this.m_frame!.GetToolManager()!.RunAction(SCH_ACTIONS.changeSheet, originalSheet);

      return 0; // `return false`
    }

    const screenList = new SCH_SCREENS(schematic.Root());

    for (let screen = screenList.GetFirst(); screen; screen = screenList.GetNext())
      screen.SetContentModified(false); // do not prompt the user for changes

    // `m_frame->ReleaseFile()`: the desktop's lock file; the store keeps none.
    // OpenProjectFiles reads the files back from the mounted project.
    this.m_frame!.OpenProjectFiles([schematic.GetFileName()], KICTL_REVERT, (aPath) => {
      const bytes = wxReadFileSync(aPath);
      return bytes ? new TextDecoder().decode(bytes) : null;
    });

    return 0;
  }

  *ShowSchematicSetup(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowSchematicSetupDialog());
    return 0;
  }

  *PageSetup(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const undoCmd = new PICKED_ITEMS_LIST();
    const undoItem = new DS_PROXY_UNDO_ITEM(this.m_frame!);
    const wrapper = new ITEM_PICKER(this.m_frame!.GetScreen(), undoItem, UNDO_REDO.PAGESETTINGS);

    undoCmd.PushItem(wrapper);
    undoCmd.SetDescription('Page Settings');
    this.m_frame!.SaveCopyInUndoList(undoCmd, UNDO_REDO.PAGESETTINGS, false);

    const result = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_EESCHEMA_PAGE_SETTINGS', [], {
        embeddedFiles: this.m_frame!.Schematic().GetEmbeddedFiles(),
        maxUserSizeMils: { x: MAX_PAGE_SIZE_EESCHEMA_MILS, y: MAX_PAGE_SIZE_EESCHEMA_MILS },
      }),
    );

    if (result === wxID_OK) {
      // Update text variables
      this.m_frame!.GetCanvas()?.GetView()?.MarkDirty();
      this.m_frame!.GetCanvas()?.GetView()?.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
      this.m_frame!.GetCanvas()?.Refresh();

      this.m_frame!.OnModify();
    } else {
      this.m_frame!.RollbackSchematicFromUndo();
    }

    return 0;
  }

  /** `RescueSymbols( aEvent )` (sch_editor_control.cpp:533): the rescuer the schematic's ids call for. */
  *RescueSymbols(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const schematic = new SCH_SCREENS(this.m_frame!.Schematic().Root());

    if (schematic.HasNoFullyDefinedLibIds())
      yield* this.RunMainStackModal(() => this.RescueLegacyProject(true));
    else yield* this.RunMainStackModal(() => this.RescueSymbolLibTableProject(true));

    return 0;
  }

  /**
   * `RescueLegacyProject( aRunningOnDemand )`: LEGACY_RESCUER, for a schematic with no library
   * nicknames, is not ported (project_rescue.ts says why); there is nothing to rescue with.
   */
  async RescueLegacyProject(_aRunningOnDemand: boolean): Promise<boolean> {
    return false;
  }

  /** `RescueSymbolLibTableProject( aRunningOnDemand )`. */
  RescueSymbolLibTableProject(aRunningOnDemand: boolean): Promise<boolean> {
    const rescuer = new SYMBOL_LIB_TABLE_RESCUER(
      this.m_frame!.Prj(),
      this.m_frame!.Schematic(),
      this.m_frame!.GetCurrentSheet(),
    );

    return this.rescueProject(rescuer, aRunningOnDemand);
  }

  /** `rescueProject( aRescuer, aRunningOnDemand )` (sch_editor_control.cpp:564). */
  private async rescueProject(aRescuer: RESCUER, aRunningOnDemand: boolean): Promise<boolean> {
    if (!(await RESCUER.RescueProject(this.m_frame!, aRescuer, aRunningOnDemand))) return false;

    if (aRescuer.GetCandidateCount()) {
      // `Kiway().Player( FRAME_SCH_VIEWER, false )->ReCreateLibList()`: the symbol viewer is not a
      // KIWAY player here yet; it rebuilds its list from the libraries when it is next shown.

      if (aRunningOnDemand) {
        const schematic = new SCH_SCREENS(this.m_frame!.Schematic().Root());

        schematic.UpdateSymbolLinks();
        this.m_frame!.RecalculateConnections(null, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);
      }

      this.m_frame!.ClearUndoRedoList();
      this.m_frame!.SyncView();
      this.m_frame!.GetCanvas()?.Refresh();
      this.m_frame!.OnModify();
    }

    return true;
  }

  *RemapSymbols(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_SYMBOL_REMAP', []));

    this.m_frame!.GetCanvas()?.Refresh(true);

    return 0;
  }

  *Print(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_PRINT', []));

    return 0;
  }

  *Plot(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_PLOT_SCHEMATIC', []));

    return 0;
  }

  CrossProbeToPcb(aEvent: TOOL_EVENT): number {
    this.doCrossProbeSchToPcb(aEvent, false);
    return 0;
  }

  ExplicitCrossProbeToPcb(aEvent: TOOL_EVENT): number {
    this.doCrossProbeSchToPcb(aEvent, true);
    return 0;
  }

  private doCrossProbeSchToPcb(_aEvent: TOOL_EVENT, aForce: boolean): void {
    // Don't get in an infinite loop SCH -> PCB -> SCH -> PCB -> SCH -> ...
    if (this.m_probingPcbToSch || this.m_frame!.IsSyncingSelection()) return;

    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = aForce ? selTool.RequestSelection() : selTool.GetSelection();

    this.m_frame!.SendSelectItemsToPcb(selection.GetItemsSortedBySelectionOrder(), aForce);
  }

  /**
   * `ExportSymbolsToLibrary( aEvent )` (sch_editor_control.cpp:653): every schematic symbol's
   * library symbol, flattened, saved into a chosen library; optionally the schematic symbols are
   * relinked to it.
   */
  *ExportSymbolsToLibrary(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const savePowerSymbols = { value: false };
    const map = { value: false };

    const targetLib = yield* this.RunMainStackModal(() =>
      this.m_frame!.SelectLibrary('Export Symbols', 'Export symbols to library:', [
        { label: 'Include power symbols in export', value: savePowerSymbols },
        { label: 'Update schematic symbols to link to exported symbols', value: map },
      ]),
    );

    if (!targetLib) return 0;

    const sheets = this.m_frame!.Schematic().BuildSheetListSortedByPageNumbers();
    const symbols = new SCH_REFERENCE_LIST();
    sheets.GetSymbols(
      symbols,
      savePowerSymbols.value
        ? SYMBOL_FILTER.SYMBOL_FILTER_ALL
        : SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
    );

    // std::map<LIB_ID, …>: keyed by the formatted id.
    const libSymbols = new Map<string, { id: LIB_ID; symbol: LIB_SYMBOL }>();
    const symbolMap = new Map<string, SCH_SYMBOL[]>();

    for (let i = 0; i < symbols.GetCount(); ++i) {
      const symbol = symbols.at(i).GetSymbol();
      const libSymbol = symbol.GetLibSymbolRef()!;
      const id = libSymbol.GetLibId();
      const key = id.Format();

      // wxASSERT_MSG: "Two symbols have the same LIB_ID but are different!"
      if (!libSymbols.has(key)) libSymbols.set(key, { id, symbol: libSymbol });

      const list = symbolMap.get(key) ?? [];
      list.push(symbol);
      symbolMap.set(key, list);
    }

    let append = false;
    const commit = new SCH_COMMIT(this.m_toolMgr!);
    const adapter = SymbolLibAdapter(this.m_frame!.Prj());

    const row = adapter.GetRow(targetLib);

    if (!row) return 0; // wxCHECK

    const type = SCH_IO_MGR.EnumFromStr(row.Type());
    const pi = SCH_IO_MGR.FindPlugin(type);

    if (!pi) return 0;

    const dest = Pgm().GetLibraryManager().GetFullURI(row, true);

    for (const [key, it] of [...libSymbols].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const origSym = it.symbol;
      const newSym = origSym.Flatten();

      try {
        pi.SaveSymbol(dest, newSym);
      } catch (ioe) {
        if (!(ioe instanceof IO_ERROR)) throw ioe;

        // wxLogWarning( msg )
        DisplayErrorMessage(
          `Error saving symbol ${newSym.GetName()} to library '${row.Nickname()}'.\n\n${ioe.message}`,
        );
        return 0;
      }

      if (map.value) {
        const id = it.id.clone();
        id.SetLibNickname(targetLib);

        for (const symbol of symbolMap.get(key) ?? []) {
          const parentScreen = symbol.GetParent() as SCH_SCREEN | null;

          if (!parentScreen) continue; // wxCHECK2

          commit.Modify(symbol, parentScreen, RECURSE_MODE.NO_RECURSE);
          symbol.SetLibId(id);
          append = true;
        }
      }
    }

    if (append) {
      const processedScreens = new Set<SCH_SCREEN>();

      for (const sheet of sheets) {
        const screen = sheet.LastScreen()!;

        if (!processedScreens.has(screen)) {
          processedScreens.add(screen);
          screen.UpdateSymbolLinks();
        }
      }

      commit.Push('Update Library Identifiers');
    }

    return 0;
  }

  /** `doCopy( aUseDuplicateClipboard )` (sch_editor_control.cpp:1651): copy selection to clipboard or to m_duplicateClipboard. */
  private doCopy(aUseDuplicateClipboard = false): boolean {
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.RequestSelection();
    const schematic = this.m_frame!.Schematic();

    if (selection.Empty()) return false;

    if (aUseDuplicateClipboard) this.m_duplicateIsHoverSelection = selection.IsHover();

    selection.SetScreen(this.m_frame!.GetScreen());
    this.m_supplementaryClipboard.clear();

    for (const item of selection.GetItems()) {
      if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const sheet = item as SCH_SHEET;
        this.m_supplementaryClipboard.set(sheet.GetFileName(), sheet.GetScreen()!);
      } else if (item.Type() === KICAD_T.SCH_FIELD_T && selection.IsHover()) {
        // Most of the time the user is trying to duplicate the parent symbol
        // and the field text is in it
        selection.Add(item.GetParent()!);
      } else if (item.Type() === KICAD_T.SCH_MARKER_T) {
        // Don't let the markers be copied
        selection.Remove(item);
      } else if (item.Type() === KICAD_T.SCH_GROUP_T) {
        // Groups need to have all their items selected
        (item as SCH_ITEM).RunOnChildren(
          (aChild: SCH_ITEM) => selection.Add(aChild),
          RECURSE_MODE.RECURSE,
        );
      }
    }

    let result = true;
    const formatter = new STRING_FORMATTER();
    const plugin = new SCH_IO_KICAD_SEXPR();
    const selPath = this.m_frame!.GetCurrentSheet();

    plugin.Format(selection, selPath, schematic, formatter, true);

    const prettyData = Prettify(formatter.GetString(), FORMAT_MODE.COMPACT_TEXT_PROPERTIES);

    if (!aUseDuplicateClipboard) {
      const data = new wxDataObjectComposite();

      // Add KiCad data
      data.Add('application/kicad', new TextEncoder().encode(prettyData));

      // The bitmap, its HTML wrapper and the SVG (renderSelectionToImageForClipboard,
      // plotSelectionToSvg) need SCH_ITEM::Plot and the print GAL on the live model, which are
      // the plotting stage's; until then the clipboard carries the KiCad data and the text.

      // Finally add text data
      data.text = prettyData;

      result &&= SetClipboardData(data);
    }

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    if (aUseDuplicateClipboard) {
      this.m_duplicateClipboard = prettyData;
      return true;
    }

    return result;
  }

  /** `searchSupplementaryClipboard( aSheetFilename, aScreen )` (sch_editor_control.cpp:1767). */
  private searchSupplementaryClipboard(aSheetFilename: string): SCH_SCREEN | null {
    return this.m_supplementaryClipboard.get(aSheetFilename) ?? null;
  }

  // Cut / Copy / Paste with a text control focused (`wxTextEntry`) never reach the tool: the
  // window leaves a focused input's clipboard keys to the browser.

  *Duplicate(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    this.doCopy(true); // Use the local clipboard
    yield* this.Paste(aEvent);

    return 0;
  }

  /** `updatePastedSymbol( aSymbol, aPastePath, aClipPath, aForceKeepAnnotations )` (sch_editor_control.cpp:1856). */
  private updatePastedSymbol(
    aSymbol: SCH_SYMBOL,
    aPastePath: SCH_SHEET_PATH,
    aClipPath: KIID_PATH,
    aForceKeepAnnotations: boolean,
  ): void {
    if (!this.m_frame) return; // wxCHECK

    let newInstance = new SCH_SYMBOL_INSTANCE();
    let instanceFound = false;
    const pasteLookupPath = aClipPath.Clone();

    this.m_pastedSymbols.add(aSymbol);

    for (const tmp of aSymbol.GetInstances()) {
      if (
        (tmp.m_Path.empty() && aClipPath.empty()) ||
        (!aClipPath.empty() && tmp.m_Path.EndsWith(aClipPath))
      ) {
        newInstance = tmp.Clone();
        instanceFound = true;
        break;
      }
    }

    // The pasted symbol look up paths include the symbol UUID.
    pasteLookupPath.push_back(aSymbol.m_Uuid);

    if (!instanceFound) {
      // Some legacy versions saved value fields escaped.  While we still do in the symbol
      // editor, we don't anymore in the schematic, so be sure to unescape them.
      const valueField = aSymbol.GetField(FIELD_T.VALUE)!;
      valueField.SetText(unescapeString(valueField.GetText()));

      // Pasted from notepad or an older instance of eeschema.  Use the values in the fields
      // instead.
      newInstance.m_Reference = aSymbol.GetField(FIELD_T.REFERENCE)!.GetText();
      newInstance.m_Unit = aSymbol.GetUnit();
    }

    newInstance.m_Path = aPastePath.Path();
    newInstance.m_ProjectName = this.m_frame.Prj().GetProjectName();

    aSymbol.AddHierarchicalReference(newInstance);

    if (!aForceKeepAnnotations) aSymbol.ClearAnnotation(aPastePath, false);

    // We might clear annotations but always leave the original unit number from the paste.
    aSymbol.SetUnit(newInstance.m_Unit);
  }

  /** `updatePastedSheet( … )` (sch_editor_control.cpp:1920). */
  private updatePastedSheet(
    aSheet: SCH_SHEET,
    aPastePath: SCH_SHEET_PATH,
    aClipPath: KIID_PATH,
    aForceKeepAnnotations: boolean,
    aPastedSheets: SCH_SHEET_LIST,
    aPastedSymbols: SHEET_PATH_MAP<SCH_REFERENCE_LIST>,
  ): SCH_SHEET_PATH {
    const sheetPath = aPastePath.Clone();
    sheetPath.push_back(aSheet);

    aPastedSheets.push(sheetPath);

    if (aSheet.GetScreen() === null) return sheetPath; // We can only really set the page number but not load any items

    for (const item of aSheet.GetScreen()!.Items()) {
      if (item.IsConnectable()) item.SetConnectivityDirty();

      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as SCH_SYMBOL;

        // Only do this once if the symbol is shared across multiple sheets.
        if (!this.m_pastedSymbols.has(symbol)) {
          for (const pin of symbol.GetPins()) {
            (pin as { m_Uuid: string }).m_Uuid = newKiid();
            pin.SetConnectivityDirty();
          }
        }

        this.updatePastedSymbol(symbol, sheetPath, aClipPath, aForceKeepAnnotations);
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const subsheet = item as SCH_SHEET;

        // Make sure pins get a new UUID and set the dirty connectivity flag.
        if (!aPastedSheets.ContainsSheet(subsheet)) {
          for (const pin of subsheet.GetPins()) {
            (pin as { m_Uuid: string }).m_Uuid = newKiid();
            pin.SetConnectivityDirty();
          }
        }

        const newClipPath = aClipPath.Clone();
        newClipPath.push_back(subsheet.m_Uuid);

        this.updatePastedSheet(
          subsheet,
          sheetPath,
          newClipPath,
          aForceKeepAnnotations,
          aPastedSheets,
          aPastedSymbols,
        );
      }
    }

    sheetPath.GetSymbols(
      aPastedSymbols.at(aPastePath, () => new SCH_REFERENCE_LIST()),
      SYMBOL_FILTER.SYMBOL_FILTER_ALL,
    );

    return sheetPath;
  }

  /** `setPastedSymbolInstances( aScreen )` (sch_editor_control.cpp:1987). */
  private setPastedSymbolInstances(aScreen: SCH_SCREEN | null): void {
    if (!aScreen) return; // wxCHECK

    for (const item of aScreen.Items()) {
      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as SCH_SYMBOL;

        for (const symbolInstance of symbol.GetInstances()) {
          const pathWithSymbol = symbolInstance.m_Path.Clone();

          pathWithSymbol.push_back(symbol.m_Uuid);

          this.m_clipboardSymbolInstances.set(pathWithSymbol.AsString(), symbolInstance);
        }
      }
    }
  }

  /** `prunePastedSymbolInstances()` (sch_editor_control.cpp:2012). */
  private prunePastedSymbolInstances(): void {
    if (!this.m_frame) return; // wxCHECK

    for (const symbol of this.m_pastedSymbols) {
      const instancePathsToRemove: KIID_PATH[] = [];

      for (const instance of symbol.GetInstances()) {
        if (
          instance.m_ProjectName !== this.m_frame.Prj().GetProjectName() ||
          instance.m_Path.empty()
        )
          instancePathsToRemove.push(instance.m_Path);
      }

      for (const path of instancePathsToRemove) symbol.RemoveInstance(path);
    }
  }

  /**
   * `ChoosePasteLibSymbol( aClipboardScreen, aDestScreen, aLibSymbolName )`
   * (sch_editor_control.cpp:2034): the clipboard's cached library symbol, else the destination's.
   */
  static ChoosePasteLibSymbol(
    aClipboardScreen: SCH_SCREEN | null,
    aDestScreen: SCH_SCREEN | null,
    aLibSymbolName: string,
  ): LIB_SYMBOL | null {
    // The clipboard's cached library symbol is a matched pair with the pasted instance, so it
    // must win over the destination's same-named cache. Pasting from the destination cache would
    // silently remap the instance to a different definition and drop in-place edits such as
    // renumbered pins (issue 21401) or a changed power type (issue 22162). Fall back to the
    // destination cache only when the clipboard carries no copy.
    if (aClipboardScreen) {
      const clip = aClipboardScreen.GetLibSymbols().get(aLibSymbolName);

      if (clip) return clip;
    }

    if (aDestScreen) {
      const dest = aDestScreen.GetLibSymbols().get(aLibSymbolName);

      if (dest) return dest;
    }

    return null;
  }

  /** `Paste( aEvent )` (sch_editor_control.cpp:2063), also Paste Special and Duplicate's second half. */
  *Paste(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // A focused wxTextEntry pastes into itself: in the browser that is the input's own paste,
    // which never reaches the tool.

    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    let content: string;
    let eventPos: VECTOR2I = { x: 0, y: 0 };

    const tempSheet = new SCH_SHEET();

    // Priority for paste:
    // 1. application/kicad format (handled by GetClipboardUTF8 which checks this first)
    // 2. Text data that can be parsed as KiCad S-expressions
    // 3. Bitmap/image data (fallback only if no valid text content)
    if (aEvent.IsAction(ACTIONS.duplicate)) content = this.m_duplicateClipboard;
    else content = GetClipboardUTF8();

    // Only fall back to image data if there's no text content
    if (content === '') {
      const clipImg = GetImageFromClipboard();

      if (clipImg) {
        const bitmap = new SCH_BITMAP();

        if (bitmap.GetReferenceImage().SetImage(clipImg))
          return this.m_toolMgr!.RunAction(SCH_ACTIONS.placeImage, bitmap) ? 1 : 0;
      }

      return 0;
    }

    if (aEvent.IsAction(ACTIONS.duplicate))
      eventPos = this.getViewControls()!.GetCursorPosition(false);

    const plugin = new SCH_IO_KICAD_SEXPR();

    // Screen object on heap is owned by the sheet.
    const tempScreen = new SCH_SCREEN(this.m_frame!.Schematic());
    tempSheet.SetScreen(tempScreen);

    try {
      plugin.LoadContent(content, tempSheet);
    } catch {
      // If it wasn't schematic content, paste as a text object
      if (content.length > ADVANCED_CFG.GetCfg().m_MaxPastedTextLength) {
        const result = this.m_frame!.IsOK(
          'Pasting a long text text string may be very slow.  Do you want to continue?',
        );

        if (!result) return 0;
      }

      const text_item = new SCH_TEXT({ x: 0, y: 0 }, content);
      tempScreen.Append(text_item);
    }

    const currentSelection = selTool.GetSelection();

    let hasTableCells = false;

    for (const item of currentSelection) {
      if (item.Type() === KICAD_T.SCH_TABLECELL_T) {
        hasTableCells = true;
        break;
      }
    }

    if (hasTableCells) {
      let clipboardTable: SCH_TABLE | null = null;

      for (const item of tempScreen.Items()) {
        if (item.Type() === KICAD_T.SCH_TABLE_T) {
          clipboardTable = item as SCH_TABLE;
          break;
        }
      }

      if (clipboardTable) {
        const tableEditTool = this.m_toolMgr!.GetTool(SCH_EDIT_TABLE_TOOL);

        if (tableEditTool) {
          const errorMsg = tableEditTool.validatePasteIntoSelection(currentSelection);

          if (errorMsg !== null) {
            this.m_frame!.DisplayError(errorMsg);
            return 0;
          }

          const commit = new SCH_COMMIT(this.m_toolMgr!);

          if (tableEditTool.pasteCellsIntoSelection(currentSelection, clipboardTable, commit)) {
            commit.Push('Paste Cells');
            return 0;
          } else {
            this.m_frame!.DisplayError('Failed to paste cells');
            return 0;
          }
        }
      }
    }

    this.m_pastedSymbols.clear();
    this.m_clipboardSymbolInstances.clear();

    // Save pasted symbol instances in case the user chooses to keep existing symbol annotation.
    this.setPastedSymbolInstances(tempScreen);

    // `tempScreen->MigrateSimModels()`: the simulator's, which is not ported.

    const annotateAutomatic = this.m_frame!.eeconfig()!.annotation.automatic;
    const schematicSettings = this.m_frame!.Schematic().Settings();
    const annotateStartNum = schematicSettings.m_AnnotateStartNum;

    let pasteMode: PasteSpecialMode = annotateAutomatic
      ? 'UNIQUE_ANNOTATIONS'
      : 'REMOVE_ANNOTATIONS';
    let forceRemoveAnnotations = false;

    if (aEvent.IsAction(ACTIONS.pasteSpecial)) {
      const defaultPasteMode = pasteMode;
      const dlg = { pasteMode };

      const answer = yield* this.RunMainStackModal(() =>
        this.m_frame!.ShowModalDialog('DIALOG_PASTE_SPECIAL', [], dlg),
      );

      if (answer === wxID_CANCEL) return 0;

      pasteMode = dlg.pasteMode;

      // We have to distinguish if removing was explicit
      forceRemoveAnnotations = pasteMode === 'REMOVE_ANNOTATIONS' && pasteMode !== defaultPasteMode;
    }

    let forceKeepAnnotations = pasteMode !== 'REMOVE_ANNOTATIONS';

    // SCH_SEXP_PLUGIN added the items to the paste screen, but not to the view or anything
    // else.  Pull them back out to start with.
    const commit = new SCH_COMMIT(this.m_toolMgr!);
    const loadedItems: EDA_ITEM[] = [];
    const sortedLoadedItems: SCH_ITEM[] = [];
    let sheetsPasted = false;
    let hierarchy = this.m_frame!.Schematic().Hierarchy();
    const pasteRoot = this.m_frame!.GetCurrentSheet();
    let destFn = pasteRoot.Last()!.GetFileName();

    if (!PosixPath.isAbsolute(destFn))
      destFn = PosixPath.makeAbsolute(destFn, this.m_frame!.Prj().GetProjectPath());

    // List of paths in the hierarchy that refer to the destination sheet of the paste
    const sheetPathsForScreen = hierarchy.FindAllSheetsForScreen(pasteRoot.LastScreen()!);
    sheetPathsForScreen.SortByPageNumbers();

    // Build a list of screens from the current design (to avoid loading sheets that already exist)
    const loadedScreens = new Map<string, SCH_SCREEN>();

    for (const item of hierarchy) {
      if (item.LastScreen()) loadedScreens.set(item.Last()!.GetFileName(), item.LastScreen()!);
    }

    // Get set of sheet names in the current schematic to prevent duplicate sheet names on paste.
    const existingSheetNames = new Set(pasteRoot.LastScreen()!.GetSheetNames());

    // Build symbol list for reannotation of duplicates
    const existingRefs = new SCH_REFERENCE_LIST();
    hierarchy.GetSymbols(existingRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
    existingRefs.SortByReferenceOnly();

    const existingRefsSet = new Set<string>();

    for (const ref of existingRefs) existingRefsSet.add(ref.GetRef());

    // Build UUID map for fetching last-resolved-properties
    const itemMap = new Map<string, SCH_ITEM>();
    hierarchy.FillItemMap(itemMap);

    // Keep track of pasted sheets and symbols for the different paths to the hierarchy.
    const pastedSymbols = new SHEET_PATH_MAP<SCH_REFERENCE_LIST>();
    const pastedSheets = new SHEET_PATH_MAP<SCH_SHEET_LIST>();

    for (const item of tempScreen.Items()) {
      if (item.Type() === KICAD_T.SCH_SHEET_T) sortedLoadedItems.push(item);
      else loadedItems.push(item);
    }

    sortedLoadedItems.sort((firstItem: SCH_ITEM, secondItem: SCH_ITEM) => {
      const firstSheet = firstItem as SCH_SHEET;
      const secondSheet = secondItem as SCH_SHEET;
      return strNumCmp(firstSheet.GetName(), secondSheet.GetName(), false);
    });

    for (const item of sortedLoadedItems) {
      loadedItems.push(item);

      if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const sheet = item as SCH_SHEET;
        let srcFn = sheet.GetFileName();

        if (!PosixPath.isAbsolute(srcFn))
          srcFn = PosixPath.makeAbsolute(srcFn, this.m_frame!.Prj().GetProjectPath());

        const sheetHierarchy = SCH_SHEET_LIST.build(sheet);

        if (hierarchy.TestForRecursion(sheetHierarchy, destFn)) {
          const msg =
            `The pasted sheet '${sheet.GetFileName()}'\nwas dropped because the destination already has ` +
            'the sheet or one of its subsheets as a parent.';
          this.m_frame!.DisplayError(msg);
          loadedItems.pop();
        }
      }
    }

    // Remove the references from our temporary screen to prevent freeing on the DTOR
    tempScreen.Clear(false);

    for (const item of loadedItems) {
      const clipPath = new KIID_PATH('/'); // clipboard is at root

      const schItem = item as SCH_ITEM;

      if (schItem.IsConnectable()) schItem.SetConnectivityDirty();

      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as SCH_SYMBOL;

        const currentScreen = this.m_frame!.GetScreen();

        if (!currentScreen) continue; // wxCHECK2

        const source = SCH_EDITOR_CONTROL.ChoosePasteLibSymbol(
          tempScreen,
          currentScreen,
          symbol.GetSchSymbolLibraryName(),
        );

        if (source) symbol.SetLibSymbol(LIB_SYMBOL.copyOf(source));

        // If the symbol is already in the schematic we have to always keep the annotations. The
        // exception is if the user has chosen to remove them.
        for (const instance of symbol.GetInstances()) {
          if (!existingRefsSet.has(instance.m_Reference)) {
            forceKeepAnnotations = !forceRemoveAnnotations;
            break;
          }
        }

        for (const sheetPath of sheetPathsForScreen)
          this.updatePastedSymbol(symbol, sheetPath, clipPath, forceKeepAnnotations);

        // Most modes will need new KIIDs for the symbol and its pins.  However, if we are pasting
        // unique annotations, we need to check if the symbol is not already in the hierarchy.  If
        // we don't already have a copy of the symbol, we just keep the existing KIID data as it is
        // likely the same symbol being moved around the schematic.
        let needsNewKiid = pasteMode === 'UNIQUE_ANNOTATIONS';

        for (const instance of symbol.GetInstances()) {
          if (existingRefsSet.has(instance.m_Reference)) {
            needsNewKiid = true;
            break;
          }
        }

        if (needsNewKiid) {
          // Assign a new KIID
          (item as { m_Uuid: string }).m_Uuid = newKiid();

          // Make sure pins get a new UUID
          for (const pin of symbol.GetPins()) {
            (pin as { m_Uuid: string }).m_Uuid = newKiid();
            pin.SetConnectivityDirty();
          }

          for (const sheetPath of sheetPathsForScreen) {
            // Ignore symbols from a non-existant library.
            if (source) {
              const schReference = new SCH_REFERENCE(symbol, sheetPath);
              schReference.SetSheetNumber(sheetPath.GetPageNumberAsInt());
              pastedSymbols.at(sheetPath, () => new SCH_REFERENCE_LIST()).AddItem(schReference);
            }
          }
        }
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const sheet = item as SCH_SHEET;
        const nameField = sheet.GetField(FIELD_T.SHEET_NAME)!;
        let baseName = nameField.GetText();
        let candidateName = baseName;
        let number = '';

        while (baseName !== '' && /[0-9]/.test(baseName[baseName.length - 1]!)) {
          number = baseName[baseName.length - 1]! + number;
          baseName = baseName.slice(0, -1);
        }

        // Update hierarchy to include any other sheets we already added, avoiding
        // duplicate sheet names
        hierarchy = this.m_frame!.Schematic().Hierarchy();

        // wxAtoi: the leading digits, 0 for none
        let uniquifier = Math.max(0, Number.parseInt(number, 10) || 0) + 1;

        while (existingSheetNames.has(candidateName)) candidateName = `${baseName}${uniquifier++}`;

        nameField.SetText(candidateName);
        existingSheetNames.add(candidateName);

        let fn = sheet.GetFileName();
        let existingScreen: SCH_SCREEN | null = null;

        sheet.SetParent(pasteRoot.Last());
        sheet.SetScreen(null);

        if (!PosixPath.isAbsolute(fn)) {
          const currentSheetFileName = pasteRoot.LastScreen()!.GetFileName();
          fn = PosixPath.makeAbsolute(fn, PosixPath.dirname(currentSheetFileName));
        }

        // Try to find the screen for the pasted sheet by several means
        const found = { value: null as SCH_SCREEN | null };

        if (!this.m_frame!.Schematic().Root().SearchHierarchy(fn, found)) {
          if (loadedScreens.has(sheet.GetFileName()))
            existingScreen = loadedScreens.get(sheet.GetFileName())!;
          else existingScreen = this.searchSupplementaryClipboard(sheet.GetFileName());
        } else {
          existingScreen = found.value;
        }

        if (existingScreen) {
          sheet.SetScreen(existingScreen);
        } else {
          const loaded = yield* this.RunMainStackModal(() =>
            this.m_frame!.LoadSheetFromFile(sheet, pasteRoot, fn),
          );

          if (!loaded) this.m_frame!.InitSheet(sheet, sheet.GetFileName());
        }

        // Save the symbol instances in case the user chooses to keep the existing
        // symbol annotation.
        this.setPastedSymbolInstances(sheet.GetScreen());
        sheetsPasted = true;

        // Push it to the clipboard path while it still has its old KIID
        clipPath.push_back(sheet.m_Uuid);

        // Assign a new KIID to the pasted sheet
        (sheet as { m_Uuid: string }).m_Uuid = newKiid();

        // Make sure pins get a new UUID
        for (const pin of sheet.GetPins()) {
          (pin as { m_Uuid: string }).m_Uuid = newKiid();
          pin.SetConnectivityDirty();
        }

        // Once we have our new KIID we can update all pasted instances. This will either
        // reset the annotations or copy "kept" annotations from the supplementary clipboard.
        for (const sheetPath of sheetPathsForScreen) {
          this.updatePastedSheet(
            sheet,
            sheetPath,
            clipPath,
            forceKeepAnnotations && annotateAutomatic,
            pastedSheets.at(sheetPath, () => new SCH_SHEET_LIST()),
            pastedSymbols,
          );
        }
      } else {
        const srcItem = itemMap.get(item.m_Uuid);
        const destItem = item as SCH_ITEM;

        // Everything gets a new KIID
        (item as { m_Uuid: string }).m_Uuid = newKiid();

        if (srcItem && destItem) {
          destItem.SetConnectivityDirty(true);
          destItem.SetLastResolvedState(srcItem);
        }

        // Pasted named groups need a unique name, the multichannel tool matches groups by name.
        if (item.Type() === KICAD_T.SCH_GROUP_T) {
          const group = item as SCH_GROUP;

          if (group.GetName() !== '')
            group.SetName(UniqueGroupName(this.m_frame!.GetScreen(), group.GetName()));
        }
      }

      // Lines need both ends selected for a move after paste so the whole line moves.
      if (item.Type() === KICAD_T.SCH_LINE_T) item.SetFlags(STARTPOINT | ENDPOINT);

      item.SetFlags(IS_NEW | IS_PASTED | IS_MOVING);

      // don't want a loop!
      if (!this.m_frame!.GetScreen()!.CheckIfOnDrawList(item as SCH_ITEM))
        this.m_frame!.AddToScreen(item as SCH_ITEM, this.m_frame!.GetScreen());

      commit.Added(item as SCH_ITEM, this.m_frame!.GetScreen());

      // Start out hidden so the pasted items aren't "ghosted" in their original location
      // before being moved to the current location.
      this.getView()?.Hide(item, true);
    }

    if (sheetsPasted) {
      // The full schematic hierarchy need to be update before assigning new annotation and page
      // numbers.
      this.m_frame!.Schematic().RefreshHierarchy();

      // Update sheet instance page and virtual page numbers to ensure annotation works correctly.
      for (const sheetPath of sheetPathsForScreen) {
        for (const pastedSheet of pastedSheets.at(sheetPath, () => new SCH_SHEET_LIST())) {
          // Find next free string page number for the sheet instance.
          let page = 1;
          let pageNum = `${page}`;

          while (hierarchy.PageNumberExists(pageNum)) pageNum = `${++page}`;

          let virtualPageNumber = page;

          // The virtual page and sheet instance page numbers do not necessarily track. Increment by
          // one to ensure the annotation sheet paths all have unique virtual page numbers.
          if (page === hierarchy.GetLastVirtualPageNumber())
            virtualPageNumber = hierarchy.GetLastVirtualPageNumber() + 1;

          pastedSheet.SetVirtualPageNumber(virtualPageNumber);

          const sheetInstance = new SCH_SHEET_INSTANCE();

          sheetInstance.m_Path = pastedSheet.Path();

          // Don't include the actual sheet in the instance path.
          sheetInstance.m_Path.pop_back();
          sheetInstance.m_PageNumber = pageNum;
          sheetInstance.m_ProjectName = this.m_frame!.Prj().GetProjectName();

          const sheet = pastedSheet.Last();

          if (!sheet) continue; // wxCHECK2

          sheet.AddInstance(sheetInstance);
          hierarchy.push(pastedSheet);

          // Remove all pasted sheet instance data that is not part of the current project.
          const instancesToRemove: KIID_PATH[] = [];

          for (const instance of sheet.GetInstances()) {
            if (!hierarchy.HasPath(instance.m_Path)) instancesToRemove.push(instance.m_Path);
          }

          for (const instancePath of instancesToRemove) sheet.RemoveInstance(instancePath);

          // The sheet paths for the annotation code where copied in updatePastedSheets() when the
          // virtual page number was still 1.  Set the virtual page number in the copied sheet paths.
          for (const refs of pastedSymbols.values()) {
            for (const ref of refs) {
              if (ref.GetSheetPath().equals(pastedSheet)) {
                ref.GetSheetPath().SetVirtualPageNumber(virtualPageNumber);
                ref.SetSheetNumber(virtualPageNumber);
              }
            }
          }
        }
      }

      this.m_frame!.SetSheetNumberAndCount();

      // Get a version with correct sheet numbers since we've pasted sheets,
      // we'll need this when annotating next
      hierarchy = this.m_frame!.Schematic().Hierarchy();
    }

    const annotatedSymbols = new SHEET_PATH_MAP<SCH_REFERENCE_LIST>();
    const annotated = (aPath: SCH_SHEET_PATH) =>
      annotatedSymbols.at(aPath, () => new SCH_REFERENCE_LIST());

    // Update the list of symbol instances that satisfy the annotation criteria.
    for (const sheetPath of sheetPathsForScreen) {
      const refs = pastedSymbols.at(sheetPath, () => new SCH_REFERENCE_LIST());

      for (let i = 0; i < refs.GetCount(); i++) {
        if (pasteMode === 'UNIQUE_ANNOTATIONS' || refs.at(i).AlwaysAnnotate())
          annotated(sheetPath).AddItem(refs.at(i));
      }

      for (const pastedSheetPath of pastedSheets.at(sheetPath, () => new SCH_SHEET_LIST())) {
        const sheetRefs = pastedSymbols.at(pastedSheetPath, () => new SCH_REFERENCE_LIST());

        for (let i = 0; i < sheetRefs.GetCount(); i++) {
          if (pasteMode === 'UNIQUE_ANNOTATIONS' || sheetRefs.at(i).AlwaysAnnotate())
            annotated(pastedSheetPath).AddItem(sheetRefs.at(i));
        }
      }
    }

    if (annotatedSymbols.size > 0) {
      const annotateOrder = schematicSettings.m_AnnotateSortOrder as ANNOTATE_ORDER_T;
      const annotateAlgo = schematicSettings.m_AnnotateMethod as ANNOTATE_ALGO_T;

      const reannotate = (aPath: SCH_SHEET_PATH) => {
        const list = annotated(aPath);

        list.SortByReferenceOnly();
        list.SetRefDesTracker(schematicSettings.m_refDesTracker);

        if (pasteMode === 'UNIQUE_ANNOTATIONS')
          list.ReannotateDuplicates(existingRefs, annotateAlgo);
        else
          list.ReannotateByOptions(
            annotateOrder,
            annotateAlgo,
            annotateStartNum,
            existingRefs,
            false,
            hierarchy,
          );

        list.UpdateAnnotation();

        // Update existing refs for next iteration
        for (let i = 0; i < list.GetCount(); i++) existingRefs.AddItem(list.at(i));
      };

      for (const path of sheetPathsForScreen) {
        reannotate(path);

        for (const pastedSheetPath of pastedSheets.at(path, () => new SCH_SHEET_LIST()))
          reannotate(pastedSheetPath);
      }
    }

    this.m_frame!.GetCurrentSheet().UpdateAllScreenReferences();

    // The copy operation creates instance paths that are not valid for the current project or
    // saved as part of another project.  Prune them now so they do not accumulate in the saved
    // schematic file.
    this.prunePastedSymbolInstances();

    const sheets = this.m_frame!.Schematic().Hierarchy();
    const allScreens = new SCH_SCREENS(this.m_frame!.Schematic().Root());

    allScreens.PruneOrphanedSymbolInstances(this.m_frame!.Prj().GetProjectName(), sheets);
    allScreens.PruneOrphanedSheetInstances(this.m_frame!.Prj().GetProjectName(), sheets);

    // Now clear the previous selection, select the pasted items, and fire up the "move" tool.
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    // If the item has a parent group, it will be part of the loadedItems, and will handle
    // the move action. Iterate backwards to avoid invalidating the iterator.
    for (let i = loadedItems.length - 1; i >= 0; i--) {
      const item = loadedItems[i]!;

      if (item.GetParentGroup()) {
        loadedItems.splice(i, 1);
        // These were hidden before because they would be added to the move preview,
        // but now they need to be shown as a preview so they appear to move when
        // the group moves.
        this.getView()?.SetVisible(item);
        this.getView()?.AddToPreview(item, false);
      }
    }

    this.m_toolMgr!.RunAction(ACTIONS.selectItems, loadedItems);

    const selection = selTool.GetSelection();

    if (!selection.Empty()) {
      if (aEvent.IsAction(ACTIONS.duplicate)) {
        let closest_dist = INT_MAX;

        const processPt = (pt: VECTOR2I) => {
          const dist = EuclideanNormI({ x: eventPos.x - pt.x, y: eventPos.y - pt.y });

          if (dist < closest_dist) {
            selection.SetReferencePoint(pt);
            closest_dist = dist;
          }
        };

        // Prefer connection points (which should remain on grid)
        for (const item of selection.Items()) {
          const sch_item = item.IsSCH_ITEM() ? (item as SCH_ITEM) : null;
          const pin = item.Type() === KICAD_T.SCH_PIN_T ? (item as SCH_PIN) : null;

          if (sch_item && sch_item.IsConnectable()) {
            for (const pt of sch_item.GetConnectionPoints()) processPt(pt);
          } else if (pin) {
            processPt(pin.GetPosition());
          }

          // Symbols need to have their center point added since often users are trying to
          // move parts from their center.
          if (item.Type() === KICAD_T.SCH_SYMBOL_T) processPt(item.GetPosition());
        }

        // Only process other points if we didn't find any connection points
        if (closest_dist === INT_MAX) {
          for (const item of selection.Items()) {
            switch (item.Type()) {
              case KICAD_T.SCH_LINE_T:
                processPt((item as SCH_LINE).GetStartPoint());
                processPt((item as SCH_LINE).GetEndPoint());
                break;

              case KICAD_T.SCH_SHAPE_T: {
                const shape = item as SCH_SHAPE;

                switch (shape.GetShape()) {
                  case SHAPE_T.RECTANGLE:
                    for (const pt of shape.GetRectCorners()) processPt(pt);

                    break;

                  case SHAPE_T.CIRCLE:
                    processPt(shape.GetCenter());
                    break;

                  case SHAPE_T.POLY:
                    for (let ii = 0; ii < shape.GetPolyShape().TotalVertices(); ++ii)
                      processPt(shape.GetPolyShape().CVertex(ii));

                    break;

                  default:
                    processPt(shape.GetStart());
                    processPt(shape.GetEnd());
                    break;
                }

                break;
              }

              default:
                processPt(item.GetPosition());
                break;
            }
          }
        }

        selection.SetIsHover(this.m_duplicateIsHoverSelection);
      }
      // We want to the first non-group item in the selection to be the reference point.
      else if (selection.GetTopLeftItem()!.Type() === KICAD_T.SCH_GROUP_T) {
        const group = selection.GetTopLeftItem() as SCH_GROUP;

        let found = false;
        let item: SCH_ITEM | null = null;

        group.RunOnChildren((schItem: SCH_ITEM) => {
          if (!found && schItem.Type() !== KICAD_T.SCH_GROUP_T) {
            item = schItem;
            found = true;
          }
        }, RECURSE_MODE.RECURSE);

        if (found) selection.SetReferencePoint((item as SCH_ITEM | null)!.GetPosition());
        else selection.SetReferencePoint(group.GetPosition());
      } else {
        const item = selection.GetTopLeftItem() as SCH_ITEM;

        selection.SetReferencePoint(item.GetPosition());
      }

      if (yield* this.RunSynchronousActionWait(SCH_ACTIONS.move, commit)) {
        // Pushing the commit will update the connectivity.
        commit.Push('Paste');

        if (sheetsPasted) {
          this.m_frame!.UpdateHierarchyNavigator();
          // UpdateHierarchyNavigator() will call RefreshNetNavigator()
        } else {
          this.m_frame!.RefreshNetNavigator();
        }
      } else {
        commit.Revert();
      }

      this.getView()?.ClearPreview();
    }

    return 0;
  }

  Cut(_aEvent: TOOL_EVENT): number {
    if (this.doCopy()) this.m_toolMgr!.RunAction(ACTIONS.doDelete);

    return 0;
  }

  Copy(_aEvent: TOOL_EVENT): number {
    this.doCopy();

    return 0;
  }

  CopyAsText(_aEvent: TOOL_EVENT): number {
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.RequestSelection();

    if (selection.Empty()) return 0; // `return false`

    const itemsAsText = GetSelectedItemsAsText(selection);

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return SaveClipboard(itemsAsText) ? 1 : 0;
  }

  Undo(_aEvent: TOOL_EVENT): number {
    if (!this.m_frame) return 0; // wxCHECK

    if (this.m_frame.GetUndoCommandCount() <= 0) return 0;

    // Inform tools that undo command was issued
    this.m_toolMgr!.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_UNDO_REDO_PRE, AS_GLOBAL));

    // Get the old list
    const undo_list = this.m_frame.PopCommandFromUndoList();

    if (!undo_list) return 0; // wxCHECK

    this.m_frame.PutDataInPreviousState(undo_list);

    // Now push the old command to the RedoList
    undo_list.ReversePickersListOrder();
    this.m_frame.PushCommandToRedoList(undo_list);

    this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!.RebuildSelection();

    this.m_frame.GetCanvas()?.Refresh();
    this.m_frame.OnModify();

    return 0;
  }

  Redo(_aEvent: TOOL_EVENT): number {
    if (!this.m_frame) return 0; // wxCHECK

    if (this.m_frame.GetRedoCommandCount() === 0) return 0;

    // Inform tools that undo command was issued
    this.m_toolMgr!.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_UNDO_REDO_PRE, AS_GLOBAL));

    /* Get the old list */
    const list = this.m_frame.PopCommandFromRedoList();

    if (!list) return 0; // wxCHECK

    /* Redo the command: */
    this.m_frame.PutDataInPreviousState(list);

    /* Put the old list in UndoList */
    list.ReversePickersListOrder();
    this.m_frame.PushCommandToUndoList(list);

    this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!.RebuildSelection();

    this.m_frame.GetCanvas()?.Refresh();
    this.m_frame.OnModify();

    return 0;
  }

  Annotate(_aEvent: TOOL_EVENT): number {
    this.m_frame!.OnAnnotate();
    return 0;
  }

  *IncrementAnnotations(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const dlg: INCREMENT_ANNOTATIONS_VALUES = { firstRefDes: '', allSheets: false, increment: 1 };

    const result = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_INCREMENT_ANNOTATIONS_BASE', [], dlg),
    );

    if (result === wxID_OK) {
      const startRef = new SCH_REFERENCE();
      startRef.SetRef(dlg.firstRefDes);

      if (startRef.IsSplitNeeded()) startRef.Split();
      else return 0;

      // atoi(): the leading digits, 0 when there are none
      const startNum = Number.parseInt(startRef.GetRefNumber(), 10) || 0;

      const commit = new SCH_COMMIT(this.m_frame!);
      const schematic = this.m_frame!.Schematic();
      const references = new SCH_REFERENCE_LIST();

      if (dlg.allSheets)
        schematic.Hierarchy().GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
      else schematic.CurrentSheet().GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

      references.SplitReferences();

      for (const ref of references) {
        if (ref.GetRef() === startRef.GetRef()) {
          let num = Number.parseInt(ref.GetRefNumber(), 10) || 0;

          if (num >= startNum) {
            const sheet = ref.GetSheetPath();
            let fullRef = ref.GetRef();

            num += dlg.increment;
            fullRef += String(num);

            commit.Modify(ref.GetSymbol(), sheet.LastScreen(), RECURSE_MODE.NO_RECURSE);
            ref.GetSymbol().SetRef(sheet, fullRef);
          }
        }
      }

      if (!commit.Empty()) commit.Push('Increment Annotations');
    }

    return 0;
  }

  EditSymbolFields(_aEvent: TOOL_EVENT): number {
    const dlg = this.m_frame!.GetSymbolFieldsTableDialog();

    if (!dlg) return 0; // wxCHECK

    // Needed at least on Windows. Raise() is not enough
    dlg.Show(true);

    // Bring it to the top if already open.  Dual monitor users need this.
    dlg.Raise();

    dlg.ShowEditTab();

    return 0;
  }

  *EditSymbolLibraryLinks(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // InvokeDialogEditSymbolsLibId: true when the dialog changed something
    const result = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_EDIT_SYMBOLS_LIBID', []),
    );

    if (result === wxID_OK) this.m_frame!.HardRedraw();

    return 0;
  }

  /** `EditWithSymbolEditor( aEvent )` (sch_editor_control.cpp:2851). */
  *EditWithSymbolEditor(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.RequestSelection([KICAD_T.SCH_SYMBOL_T]);
    let symbol: SCH_SYMBOL | null = null;

    if (selection.Size() >= 1) symbol = selection.Front() as unknown as SCH_SYMBOL;

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    if (!symbol) {
      // Giant hack: by default we assign Edit Table to the same hotkey, so give the table
      // tool a chance to handle it if we can't.
      const tableTool = this.m_toolMgr!.GetTool(SCH_EDIT_TABLE_TOOL);

      if (tableTool) yield* tableTool.EditTable(aEvent);

      return 0;
    }

    if (symbol.GetEditFlags() !== 0) return 0;

    if (symbol.IsMissingLibSymbol()) {
      this.m_frame!.ShowInfoBarError('Symbols with broken library symbol links cannot be edited.');
      return 0;
    }

    this.m_toolMgr!.RunAction(ACTIONS.showSymbolEditor);
    const symbolEditor = this.m_frame!.Kiway()?.GetPlayerFrame(
      FRAME_T.FRAME_SCH_SYMBOL_EDITOR,
    ) as SYMBOL_EDIT_FRAME | null;

    if (symbolEditor) {
      // `Kiway().GetBlockingDialog()->Close()`: a page has no window-modal dialog to close.

      if (aEvent.IsAction(SCH_ACTIONS.editWithLibEdit)) {
        symbolEditor.LoadSymbolFromSchematic(symbol);
      } else if (aEvent.IsAction(SCH_ACTIONS.editLibSymbolWithLibEdit)) {
        symbolEditor.LoadSymbol(symbol.GetLibId(), symbol.GetUnit(), symbol.GetBodyStyle());

        if (!symbolEditor.IsLibraryTreeShown()) symbolEditor.ToggleLibraryTree();
      }
    }

    return 0;
  }

  ShowCvpcb(_aEvent: TOOL_EVENT): number {
    this.m_frame!.OnOpenCvpcb();
    return 0;
  }

  ShowPcbNew(_aEvent: TOOL_EVENT): number {
    this.m_frame!.OnOpenPcbnew();
    return 0;
  }

  UpdatePCB(_aEvent: TOOL_EVENT): number {
    this.m_frame!.OnUpdatePCB();
    return 0;
  }

  *UpdateFromPCB(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_UPDATE_FROM_PCB', []),
    );
    return 0;
  }

  *ExportNetlist(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let result: number | null = NET_PLUGIN_CHANGE;

    // If a plugin is removed or added, rebuild and reopen the new dialog
    while (result === NET_PLUGIN_CHANGE)
      result = yield* this.RunMainStackModal(() =>
        this.m_frame!.ShowModalDialog('DIALOG_EXPORT_NETLIST', []),
      );

    return 0;
  }

  GenerateBOM(_aEvent: TOOL_EVENT): number {
    const dlg = this.m_frame!.GetSymbolFieldsTableDialog();

    if (!dlg) return 0; // wxCHECK

    // Needed at least on Windows. Raise() is not enough
    dlg.Show(true);

    // Bring it to the top if already open.  Dual monitor users need this.
    dlg.Raise();

    dlg.ShowExportTab();

    return 0;
  }

  *GenerateBOMLegacy(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_BOM', []));
    return 0;
  }

  ShowSearch(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleSearch();
    return 0;
  }

  ShowHierarchy(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleSchematicHierarchy();
    return 0;
  }

  ShowNetNavigator(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleNetNavigator();
    return 0;
  }

  ToggleProperties(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleProperties();
    return 0;
  }

  ToggleLibraryTree(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleLibraryTree();
    return 0;
  }

  ToggleRemoteSymbolPanel(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleRemoteSymbolPanel();
    return 0;
  }

  // The toggles below assign into EESCHEMA_SETTINGS upstream; the store here replaces, so each
  // computes the new value, writes it through the updater and uses it.

  ToggleHiddenPins(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_hidden_pins;
    updateEeschemaSettings((s) => (s.appearance.show_hidden_pins = show));

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleHiddenFields(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_hidden_fields;
    updateEeschemaSettings((s) => (s.appearance.show_hidden_fields = show));

    this.m_frame!.GetRenderSettings()!.m_ShowHiddenFields = show;

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleDirectiveLabels(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_directive_labels;
    updateEeschemaSettings((s) => (s.appearance.show_directive_labels = show));

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleERCWarnings(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_erc_warnings;
    updateEeschemaSettings((s) => (s.appearance.show_erc_warnings = show));

    this.getView()!.SetLayerVisible(SCH_LAYER_ID.LAYER_ERC_WARN, show);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleERCErrors(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_erc_errors;
    updateEeschemaSettings((s) => (s.appearance.show_erc_errors = show));

    this.getView()!.SetLayerVisible(SCH_LAYER_ID.LAYER_ERC_ERR, show);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleERCExclusions(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_erc_exclusions;
    updateEeschemaSettings((s) => (s.appearance.show_erc_exclusions = show));

    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  TogglePinAltIcons(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_pin_alt_icons;
    updateEeschemaSettings((s) => (s.appearance.show_pin_alt_icons = show));

    this.m_frame!.GetRenderSettings()!.m_ShowPinAltIcons = show;

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ChangeLineMode(aEvent: TOOL_EVENT): number {
    const mode = aEvent.Parameter<LINE_MODE>();
    updateEeschemaSettings((s) => (s.drawing.line_mode = mode as 0 | 1 | 2));
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    // Notify toolbar to update selection
    this.m_toolMgr!.RunAction(SCH_ACTIONS.angleSnapModeChanged);
    return 0;
  }

  NextLineMode(_aEvent: TOOL_EVENT): number {
    const mode = (this.m_frame!.eeconfig()!.drawing.line_mode + 1) % LINE_MODE.LINE_MODE_COUNT;
    updateEeschemaSettings((s) => (s.drawing.line_mode = mode as 0 | 1 | 2));
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    // Notify toolbar to update selection
    this.m_toolMgr!.RunAction(SCH_ACTIONS.angleSnapModeChanged);
    return 0;
  }

  ToggleAnnotateAuto(_aEvent: TOOL_EVENT): number {
    const automatic = !this.m_frame!.eeconfig()!.annotation.automatic;
    updateEeschemaSettings((s) => (s.annotation.automatic = automatic));
    return 0;
  }

  OnAngleSnapModeChanged(_aEvent: TOOL_EVENT): number {
    // Update the left toolbar Line modes group icon to match current mode
    switch (this.m_frame!.eeconfig()!.drawing.line_mode as LINE_MODE) {
      case LINE_MODE.LINE_MODE_FREE:
        this.m_frame!.SelectToolbarAction(SCH_ACTIONS.lineModeFree);
        break;
      case LINE_MODE.LINE_MODE_90:
        this.m_frame!.SelectToolbarAction(SCH_ACTIONS.lineMode90);
        break;
      default:
        this.m_frame!.SelectToolbarAction(SCH_ACTIONS.lineMode45);
        break;
    }

    return 0;
  }

  /** `PlaceLinkedDesignBlock( aEvent )` (sch_editor_control.cpp:3394). */
  PlaceLinkedDesignBlock(_aEvent: TOOL_EVENT): number {
    const editFrame = this.m_frame;

    if (!editFrame) return 1;

    // Need to have a group selected and it needs to have a linked design block
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();

    if (selection.Size() !== 1 || selection.at(0)!.Type() !== KICAD_T.SCH_GROUP_T) return 1;

    const group = selection.at(0) as unknown as SCH_GROUP;

    if (!group.HasDesignBlockLink()) return 1;

    // Get the associated design block
    const designBlockPane = editFrame.GetDesignBlockPane()!;
    const designBlock = designBlockPane.GetDesignBlock(group.GetDesignBlockLibId(), true, true);

    if (!designBlock) {
      const msg = `Could not find design block ${group.GetDesignBlockLibId().GetUniStringLibId()}.`;
      editFrame.GetInfoBar()?.ShowMessageFor(msg, 5000, 'warning');
      return 1;
    }

    if (designBlock.GetSchematicFile() === '') {
      const msg = `Design block ${group.GetDesignBlockLibId().GetUniStringLibId()} does not have a schematic file.`;
      editFrame.GetInfoBar()?.ShowMessageFor(msg, 5000, 'warning');
      return 1;
    }

    editFrame.GetDesignBlockPane()!.SelectLibId(group.GetDesignBlockLibId());

    return this.m_toolMgr!.RunAction(SCH_ACTIONS.placeDesignBlock, designBlock) ? 1 : 0;
  }

  /** `SaveToLinkedDesignBlock( aEvent )` (sch_editor_control.cpp:3441). */
  SaveToLinkedDesignBlock(_aEvent: TOOL_EVENT): number {
    const editFrame = this.m_frame;

    if (!editFrame) return 1;

    // Need to have a group selected and it needs to have a linked design block
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();

    if (selection.Size() !== 1 || selection.at(0)!.Type() !== KICAD_T.SCH_GROUP_T) return 1;

    const group = selection.at(0) as unknown as SCH_GROUP;

    if (!group.HasDesignBlockLink()) return 1;

    // Get the associated design block
    const designBlockPane = editFrame.GetDesignBlockPane()!;
    const designBlock = designBlockPane.GetDesignBlock(group.GetDesignBlockLibId(), true, true);

    if (!designBlock) {
      const msg = `Could not find design block ${group.GetDesignBlockLibId().GetUniStringLibId()}.`;
      editFrame.GetInfoBar()?.ShowMessageFor(msg, 5000, 'warning');
      return 1;
    }

    editFrame.GetDesignBlockPane()!.SelectLibId(group.GetDesignBlockLibId());

    return this.m_toolMgr!.RunAction(SCH_ACTIONS.updateDesignBlockFromSelection) ? 1 : 0;
  }

  *AddVariant(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.AddVariant());
    return 0;
  }

  *RemoveVariant(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.RemoveVariant());
    return 0;
  }

  *EditVariantDescription(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.EditVariantDescription());
    return 0;
  }

  GridFeedback(_aEvent: TOOL_EVENT): number {
    if (!PgmOrNull()?.GetCommonSettings()?.m_Input.hotkey_feedback) return 0;

    const settings = this.m_toolMgr!.GetSettings() as APP_SETTINGS_BASE;
    const gridSettings = settings.m_Window.grid;
    const currentIdx = settings.m_Window.grid.last_size_idx;

    const gridsLabels: string[] = [];

    for (const grid of gridSettings.grids)
      gridsLabels.push(grid.UserUnitsMessageText(this.m_frame!));

    if (!this.m_frame!.GetHotkeyPopup()) this.m_frame!.CreateHotkeyPopup();

    const popup = this.m_frame!.GetHotkeyPopup();

    if (popup) popup.Popup('Grid', gridsLabels, currentIdx);

    return 0;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.New), ACTIONS.doNew.MakeEvent());
    this.Go(SYNC_HANDLER(this.Open), ACTIONS.open.MakeEvent());
    this.Go(this.Save, ACTIONS.save.MakeEvent());
    this.Go(this.SaveAs, ACTIONS.saveAs.MakeEvent());
    this.Go(this.SaveCurrSheetCopyAs, SCH_ACTIONS.saveCurrSheetCopyAs.MakeEvent());
    this.Go(this.Revert, ACTIONS.revert.MakeEvent());

    this.Go(this.HighlightNet, SCH_ACTIONS.highlightNet.MakeEvent());
    this.Go(this.ClearHighlight, SCH_ACTIONS.clearHighlight.MakeEvent());
    this.Go(SYNC_HANDLER(this.HighlightNetCursor), SCH_ACTIONS.highlightNetTool.MakeEvent());
    this.Go(SYNC_HANDLER(this.UpdateNetHighlighting), EVENTS.SelectedItemsModified);
    this.Go(
      SYNC_HANDLER(this.UpdateNetHighlighting),
      SCH_ACTIONS.updateNetHighlighting.MakeEvent(),
    );

    this.Go(this.AssignNetclass, SCH_ACTIONS.assignNetclass.MakeEvent());
    this.Go(SYNC_HANDLER(this.FindNetInInspector), SCH_ACTIONS.findNetInInspector.MakeEvent());

    this.Go(this.ImportFPAssignments, SCH_ACTIONS.importFPAssignments.MakeEvent());

    // Not ported yet, in KiCad's order:
    // ImportNonKicadSchematic, DrawSheetOnClipboard. Left out, as the simulator is: SimProbe,
    // SimTune, MarkSimExclusions, ToggleOPVoltages, ToggleOPCurrents.
    this.Go(this.RescueSymbols, SCH_ACTIONS.rescueSymbols.MakeEvent());
    this.Go(this.ExportSymbolsToLibrary, SCH_ACTIONS.exportSymbolsToLibrary.MakeEvent());
    this.Go(this.ShowSchematicSetup, SCH_ACTIONS.schematicSetup.MakeEvent());
    this.Go(this.PageSetup, ACTIONS.pageSettings.MakeEvent());
    this.Go(this.Print, ACTIONS.print.MakeEvent());
    this.Go(this.Plot, ACTIONS.plot.MakeEvent());

    this.Go(this.RemapSymbols, SCH_ACTIONS.remapSymbols.MakeEvent());

    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.PointSelectedEvent);
    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.SelectedEvent);
    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.UnselectedEvent);
    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.ClearedEvent);
    this.Go(SYNC_HANDLER(this.ExplicitCrossProbeToPcb), SCH_ACTIONS.selectOnPCB.MakeEvent());

    this.Go(SYNC_HANDLER(this.Undo), ACTIONS.undo.MakeEvent());
    this.Go(SYNC_HANDLER(this.Redo), ACTIONS.redo.MakeEvent());
    this.Go(SYNC_HANDLER(this.Cut), ACTIONS.cut.MakeEvent());
    this.Go(SYNC_HANDLER(this.Copy), ACTIONS.copy.MakeEvent());
    this.Go(SYNC_HANDLER(this.CopyAsText), ACTIONS.copyAsText.MakeEvent());
    this.Go(this.Paste, ACTIONS.paste.MakeEvent());
    this.Go(this.Paste, ACTIONS.pasteSpecial.MakeEvent());
    this.Go(this.Duplicate, ACTIONS.duplicate.MakeEvent());

    this.Go(SYNC_HANDLER(this.GridFeedback), EVENTS.GridChangedByKeyEvent);

    this.Go(SYNC_HANDLER(this.Annotate), SCH_ACTIONS.annotate.MakeEvent());
    this.Go(this.IncrementAnnotations, SCH_ACTIONS.incrementAnnotations.MakeEvent());
    this.Go(SYNC_HANDLER(this.EditSymbolFields), SCH_ACTIONS.editSymbolFields.MakeEvent());
    this.Go(this.EditSymbolLibraryLinks, SCH_ACTIONS.editSymbolLibraryLinks.MakeEvent());
    this.Go(this.EditWithSymbolEditor, SCH_ACTIONS.editWithLibEdit.MakeEvent());
    this.Go(this.EditWithSymbolEditor, SCH_ACTIONS.editLibSymbolWithLibEdit.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowCvpcb), SCH_ACTIONS.assignFootprints.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowPcbNew), SCH_ACTIONS.showPcbNew.MakeEvent());
    this.Go(SYNC_HANDLER(this.UpdatePCB), ACTIONS.updatePcbFromSchematic.MakeEvent());
    this.Go(this.UpdateFromPCB, ACTIONS.updateSchematicFromPcb.MakeEvent());
    this.Go(this.ExportNetlist, SCH_ACTIONS.exportNetlist.MakeEvent());
    this.Go(SYNC_HANDLER(this.GenerateBOM), SCH_ACTIONS.generateBOM.MakeEvent());
    this.Go(this.GenerateBOMLegacy, SCH_ACTIONS.generateBOMLegacy.MakeEvent());

    this.Go(SYNC_HANDLER(this.ShowSearch), ACTIONS.showSearch.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowHierarchy), SCH_ACTIONS.showHierarchy.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowNetNavigator), SCH_ACTIONS.showNetNavigator.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleProperties), ACTIONS.showProperties.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleLibraryTree), SCH_ACTIONS.showDesignBlockPanel.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.ToggleRemoteSymbolPanel),
      SCH_ACTIONS.showRemoteSymbolPanel.MakeEvent(),
    );

    this.Go(SYNC_HANDLER(this.ToggleHiddenPins), SCH_ACTIONS.toggleHiddenPins.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleHiddenFields), SCH_ACTIONS.toggleHiddenFields.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.ToggleDirectiveLabels),
      SCH_ACTIONS.toggleDirectiveLabels.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.ToggleERCWarnings), SCH_ACTIONS.toggleERCWarnings.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleERCErrors), SCH_ACTIONS.toggleERCErrors.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleERCExclusions), SCH_ACTIONS.toggleERCExclusions.MakeEvent());
    this.Go(SYNC_HANDLER(this.TogglePinAltIcons), SCH_ACTIONS.togglePinAltIcons.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeLineMode), SCH_ACTIONS.lineModeFree.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeLineMode), SCH_ACTIONS.lineMode90.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeLineMode), SCH_ACTIONS.lineMode45.MakeEvent());
    this.Go(SYNC_HANDLER(this.NextLineMode), SCH_ACTIONS.lineModeNext.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.OnAngleSnapModeChanged),
      SCH_ACTIONS.angleSnapModeChanged.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.ToggleAnnotateAuto), SCH_ACTIONS.toggleAnnotateAuto.MakeEvent());

    this.Go(
      SYNC_HANDLER(this.PlaceLinkedDesignBlock),
      SCH_ACTIONS.placeLinkedDesignBlock.MakeEvent(),
    );
    this.Go(
      SYNC_HANDLER(this.SaveToLinkedDesignBlock),
      SCH_ACTIONS.saveToLinkedDesignBlock.MakeEvent(),
    );

    this.Go(this.AddVariant, SCH_ACTIONS.addVariant.MakeEvent());
    this.Go(this.RemoveVariant, SCH_ACTIONS.removeVariant.MakeEvent());
    this.Go(this.EditVariantDescription, SCH_ACTIONS.editVariantDescription.MakeEvent());
  }
}

// assign_footprints.cpp's methods: AssignFootprints, processCmpToFootprintLinkFile,
// ImportFPAssignments.
applyMixins(SCH_EDITOR_CONTROL, [SCH_ASSIGN_FOOTPRINTS_MIXIN]);

/**
 * `std::map<SCH_SHEET_PATH, T>` as Paste uses it: `at` is `operator[]`, which adds a default value
 * for a path it has not seen. Keyed by the path's KIIDs, the same equivalence `operator<` gives.
 */
class SHEET_PATH_MAP<T> {
  private readonly m_map = new Map<string, T>();

  at(aPath: SCH_SHEET_PATH, aMake: () => T): T {
    const key = aPath.Path().AsString();
    let value = this.m_map.get(key);

    if (value === undefined) {
      value = aMake();
      this.m_map.set(key, value);
    }

    return value;
  }

  get size(): number {
    return this.m_map.size;
  }

  values(): IterableIterator<T> {
    return this.m_map.values();
  }
}
