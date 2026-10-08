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
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
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
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { updateEeschemaSettings } from '../eeschema_settings.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { SCH_REFERENCE, SCH_REFERENCE_LIST } from '../sch_reference_list.js';
import { SYMBOL_FILTER } from '../sch_sheet_path.js';
import { LINE_MODE, SCH_ACTIONS } from './sch_actions.js';
import { SCH_SELECTION_TOOL } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
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
import type { SCH_PIN } from '../sch_pin.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
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
import { SCH_SCREENS } from '../sch_screen.js';

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

    // Not ported yet, in KiCad's order: RescueSymbols, ExportSymbolsToLibrary,
    // the clipboard, EditWithSymbolEditor, ShowCvpcb, ImportFPAssignments,
    // ImportNonKicadSchematic, ShowPcbNew, DrawSheetOnClipboard, the linked design blocks and
    // the variants. Left out, as the simulator is: SimProbe, SimTune, MarkSimExclusions,
    // ToggleOPVoltages, ToggleOPCurrents.
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

    this.Go(SYNC_HANDLER(this.GridFeedback), EVENTS.GridChangedByKeyEvent);

    this.Go(SYNC_HANDLER(this.Annotate), SCH_ACTIONS.annotate.MakeEvent());
    this.Go(this.IncrementAnnotations, SCH_ACTIONS.incrementAnnotations.MakeEvent());
    this.Go(SYNC_HANDLER(this.EditSymbolFields), SCH_ACTIONS.editSymbolFields.MakeEvent());
    this.Go(this.EditSymbolLibraryLinks, SCH_ACTIONS.editSymbolLibraryLinks.MakeEvent());
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
  }
}

// assign_footprints.cpp's methods: AssignFootprints, processCmpToFootprintLinkFile,
// ImportFPAssignments.
applyMixins(SCH_EDITOR_CONTROL, [SCH_ASSIGN_FOOTPRINTS_MIXIN]);
