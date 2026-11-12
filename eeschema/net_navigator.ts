// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * eeschema/net_navigator.cpp: SCH_EDIT_FRAME's Net Navigator, mixed into the frame by
 * sch_edit_frame.ts (the pattern of schematic_undo_redo.ts).
 *
 * The tree is `m_netNavigator`, a wxGenericTreeCtrl the frame owns (external/wx/treectrl.ts); the
 * window draws it (widgets/net_navigator_panel.tsx) and reports clicks back. It is built from the
 * live CONNECTION_GRAPH: every net under "Nets", or - while a net is highlighted - that net alone
 * as the root, its sheets beneath it and what it reaches beneath them, the item under the cursor
 * selected. Wires, junctions and bus entries carry a net but are not listed.
 */

import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { unescapeString, wildCompareString } from '@ziroeda/common/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { wxTreeItemId, type wxTreeItemIdValue } from '@ziroeda/wx/treectrl.js';
import type { CONNECTION_SUBGRAPH } from './connection_graph.js';
import type { SCH_BUS_BUS_ENTRY, SCH_BUS_WIRE_ENTRY } from './sch_bus_entry.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_JUNCTION } from './sch_junction.js';
import type { SCH_LABEL_BASE } from './sch_label.js';
import type { SCH_LINE } from './sch_line.js';
import type { SCH_NO_CONNECT } from './sch_no_connect.js';
import type { SCH_PIN } from './sch_pin.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_SHEET_PIN } from './sch_sheet_pin.js';
import { SCH_ACTIONS } from './tools/sch_actions.js';
import { updateEeschemaSettings } from './eeschema_settings.js';
import { wxID_HIGHEST, wxMenu } from '@ziroeda/wx/menu.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `NET_NAVIGATOR_ITEM_DATA` (sch_edit_frame.h:91), here beside the frame methods that make it: a net navigator row's sheet and item. */
export class NET_NAVIGATOR_ITEM_DATA {
  constructor(
    private m_sheetPath: SCH_SHEET_PATH | null = null,
    private m_item: SCH_ITEM | null = null,
  ) {}

  GetSheetPath(): SCH_SHEET_PATH | null {
    return this.m_sheetPath;
  }

  GetItem(): SCH_ITEM | null {
    return this.m_item;
  }

  /** `operator==`. */
  equals(aRhs: NET_NAVIGATOR_ITEM_DATA): boolean {
    const sameSheet =
      this.m_sheetPath === aRhs.m_sheetPath ||
      (!!this.m_sheetPath && !!aRhs.m_sheetPath && this.m_sheetPath.equals(aRhs.m_sheetPath));

    return sameSheet && this.m_item === aRhs.m_item;
  }
}

/** `GetNetNavigatorItemText( aItem, aSheetPath, aUnitsProvider )` (net_navigator.cpp:49). */
export function GetNetNavigatorItemText(
  aItem: SCH_ITEM,
  aSheetPath: SCH_SHEET_PATH,
  aUnitsProvider: UNITS_PROVIDER,
): string {
  const at = (aValue: number): string => aUnitsProvider.MessageTextFromValue(aValue);

  switch (aItem.Type()) {
    case KICAD_T.SCH_LINE_T: {
      const line = aItem as SCH_LINE;
      const ends = `(${at(line.GetStartPoint().x)}, ${at(line.GetStartPoint().y)}) to (${at(line.GetEndPoint().x)}, ${at(line.GetEndPoint().y)})`;

      if (aItem.GetLayer() === SCH_LAYER_ID.LAYER_WIRE) return `Wire from ${ends}`;

      if (aItem.GetLayer() === SCH_LAYER_ID.LAYER_BUS) return `Bus from ${ends}`;

      return _('Graphic line not connectable');
    }

    case KICAD_T.SCH_PIN_T: {
      const pin = aItem as SCH_PIN;
      const symbol = pin.GetParentSymbol();

      if (!symbol) return '';

      let retv = wxFormat(
        _("Symbol '%s' pin '%s'"),
        symbol.GetRef(aSheetPath, true),
        unescapeString(pin.GetNumber()),
      );
      const pinName = unescapeString(pin.GetShownName());

      if (pinName !== '') retv += ` (${pinName})`;

      return retv;
    }

    case KICAD_T.SCH_SHEET_PIN_T: {
      const pin = aItem as SCH_SHEET_PIN;
      const sheet = pin.GetParent();

      return sheet
        ? wxFormat(_("Sheet '%s' pin '%s'"), sheet.GetName(), unescapeString(pin.GetText()))
        : '';
    }

    case KICAD_T.SCH_LABEL_T:
    case KICAD_T.SCH_GLOBAL_LABEL_T:
    case KICAD_T.SCH_HIER_LABEL_T:
    case KICAD_T.SCH_DIRECTIVE_LABEL_T: {
      const label = aItem as SCH_LABEL_BASE;
      const kind =
        aItem.Type() === KICAD_T.SCH_LABEL_T
          ? 'Label'
          : aItem.Type() === KICAD_T.SCH_GLOBAL_LABEL_T
            ? 'Global label'
            : aItem.Type() === KICAD_T.SCH_HIER_LABEL_T
              ? 'Hierarchical label'
              : 'Netclass label';

      return `${kind} '${unescapeString(label.GetText())}' at (${at(label.GetPosition().x)}, ${at(label.GetPosition().y)})`;
    }

    case KICAD_T.SCH_JUNCTION_T: {
      const junction = aItem as SCH_JUNCTION;
      return wxFormat(
        _('Junction at (%s, %s)'),
        at(junction.GetPosition().x),
        at(junction.GetPosition().y),
      );
    }

    case KICAD_T.SCH_NO_CONNECT_T: {
      const nc = aItem as SCH_NO_CONNECT;
      return wxFormat(_('No-Connect at (%s, %s)'), at(nc.GetPosition().x), at(nc.GetPosition().y));
    }

    case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
    case KICAD_T.SCH_BUS_BUS_ENTRY_T: {
      const entry = aItem as SCH_BUS_WIRE_ENTRY | SCH_BUS_BUS_ENTRY;
      const kind =
        aItem.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T
          ? _('Bus to wire entry')
          : _('Bus to bus entry');

      return `${kind} from (${at(entry.GetPosition().x)}, ${at(entry.GetPosition().y)}) to (${at(entry.GetEnd().x)}, ${at(entry.GetEnd().y)})`;
    }

    default:
      return wxFormat(_('Unhandled item type %d'), aItem.Type());
  }
}

/** The tree's NET_NAVIGATOR_ITEM_DATA for \a aId, or null for a row with none (a net name). */
function itemDataOf(aFrame: SCH_EDIT_FRAME, aId: wxTreeItemId): NET_NAVIGATOR_ITEM_DATA | null {
  const data = aFrame.GetNetNavigator().GetItemData(aId);
  return data instanceof NET_NAVIGATOR_ITEM_DATA ? data : null;
}

export class NET_NAVIGATOR_MIXIN {
  /** `MakeNetNavigatorNode( aNetName, aParentId, aSelection, aSingleSheetSchematic )` (:205). */
  MakeNetNavigatorNode(
    this: SCH_EDIT_FRAME,
    aNetName: string,
    aParentId: wxTreeItemId,
    aSelection: NET_NAVIGATOR_ITEM_DATA | null,
    _aSingleSheetSchematic: boolean,
  ): void {
    if (aNetName === '') return; // wxCHECK

    const navigator = this.GetNetNavigator();
    const connectionGraph = this.Schematic().ConnectionGraph();
    const subgraphs = new Set<CONNECTION_SUBGRAPH>(connectionGraph.GetAllSubgraphs(aNetName));

    for (const sg of [...subgraphs]) {
      for (const busSgs of sg.GetBusParents().values()) {
        for (const busSg of busSgs)
          for (const s of connectionGraph.GetAllSubgraphs(busSg.GetNetName())) subgraphs.add(s);
      }
    }

    // Upstream also tracks an `expandId` (the sheet node, for a one-sheet schematic or the one
    // holding the selection) and never reads it: only aParentId is expanded below. A selected
    // row is reached by EnsureVisible instead.
    const sheetIds = new Map<string, wxTreeItemId>();

    for (const subGraph of subgraphs) {
      const sheetPath = subGraph.GetSheet();

      if (!sheetPath.Last()) continue; // wxCHECK2

      if (subGraph.GetItems().size === 0) continue;

      let itemData = new NET_NAVIGATOR_ITEM_DATA(sheetPath, null);

      // Build path string for net navigator - include top-level sheet name to distinguish
      // multiple top-level sheets
      let txt: string;

      if (!sheetPath.empty() && sheetPath.at(0).GetScreen()) {
        // Get the top-level sheet name
        txt = sheetPath.at(0).GetField(FIELD_T.SHEET_NAME)!.GetShownText(false);

        if (txt === '') {
          // wxFileName( ... ).GetName(): no directory, no extension.
          const file = sheetPath.at(0).GetScreen()!.GetFileName();
          txt = file.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
        }

        // Add sub-sheet names
        for (let i = 1; i < sheetPath.size(); i++)
          txt += `/${sheetPath.at(i).GetField(FIELD_T.SHEET_NAME)!.GetShownText(false)}`;
      } else {
        txt = sheetPath.PathHumanReadable(true, true);
      }

      let sheetId = sheetIds.get(txt);

      if (!sheetId) {
        sheetId = navigator.AppendItem(aParentId, txt, -1, -1, itemData);
        sheetIds.set(txt, sheetId);
      }

      if (aSelection?.equals(itemData)) navigator.SelectItem(sheetId);

      for (const item of subGraph.GetItems()) {
        if (
          item.Type() === KICAD_T.SCH_LINE_T ||
          item.Type() === KICAD_T.SCH_JUNCTION_T ||
          item.Type() === KICAD_T.SCH_BUS_WIRE_ENTRY_T ||
          item.Type() === KICAD_T.SCH_BUS_BUS_ENTRY_T
        ) {
          continue;
        }

        itemData = new NET_NAVIGATOR_ITEM_DATA(sheetPath, item);
        const id = navigator.AppendItem(
          sheetId,
          GetNetNavigatorItemText(item, sheetPath, this.GetUnitsProvider()),
          -1,
          -1,
          itemData,
        );

        if (aSelection?.equals(itemData)) {
          navigator.EnsureVisible(id);
          navigator.SelectItem(id);
        }
      }

      navigator.SortChildren(sheetId);
    }

    // Sort the items in the tree control alphabetically
    navigator.SortChildren(aParentId);
    navigator.Expand(aParentId);
  }

  /** `RefreshNetNavigator( aSelection )` (:327). */
  RefreshNetNavigator(
    this: SCH_EDIT_FRAME,
    aSelection: NET_NAVIGATOR_ITEM_DATA | null = null,
  ): void {
    const navigator = this.GetNetNavigator();
    // wxCHECK( m_schematic ): the window sets it once the live schematic is built.
    const schematic = this.Schematic() as ReturnType<SCH_EDIT_FRAME['Schematic']> | null;

    if (!schematic || !this.IsNetNavigatorShownOnScreen() || !schematic.HasHierarchy()) return;

    this.GetNetNavigatorFilter().Enable(this.m_highlightedConn === '');

    const singleSheetSchematic = schematic.Hierarchy().length === 1;

    // wxWindowUpdateLocker updateLock( m_netNavigator )
    navigator.Freeze();

    try {
      const filter = this.m_highlightedConn === '' ? this.m_netNavigatorFilterValue : '';

      // Determine search mode from settings
      const cfg = this.eeconfig();
      const useWildcard = cfg ? cfg.aui.net_nav_search_mode_wildcard : true;

      // For wildcard mode, wrap filter with wildcards for substring matching by default
      // unless user has already specified wildcards
      let globFilter = '';
      let regexFilter: RegExp | null = null;

      if (filter !== '') {
        if (useWildcard) {
          globFilter = filter;
          if (!globFilter.includes('*') && !globFilter.includes('?'))
            globFilter = `*${globFilter}*`;
        } else {
          // Regex mode - compile the regex pattern (icase, ECMAScript)
          try {
            regexFilter = new RegExp(filter, 'i');
          } catch {
            // Invalid regex - no filtering
            regexFilter = null;
          }
        }
      }

      if (this.m_highlightedConn === '') {
        navigator.DeleteAllItems();

        // Create a tree of all nets in the schematic.
        const rootId = navigator.AddRoot(_('Nets'), 0);

        for (const [key] of schematic.ConnectionGraph().GetNetMap()) {
          // Skip bus member subgraphs for the moment.
          if (key.Name === '') continue;

          const displayName = unescapeString(key.Name);

          // Apply filter based on mode
          if (filter !== '') {
            let matches = false;

            if (useWildcard && globFilter !== '')
              matches = wildCompareString(globFilter, displayName, false);
            else if (!useWildcard && regexFilter) matches = regexFilter.test(displayName);

            if (!matches) continue;
          }

          const netId = navigator.AppendItem(rootId, displayName, -1, -1);
          this.MakeNetNavigatorNode(key.Name, netId, aSelection, singleSheetSchematic);
        }

        navigator.Expand(rootId);
      } else if (!navigator.IsEmpty()) {
        const shownNetName = navigator.GetItemText(navigator.GetRootItem());

        if (shownNetName !== this.m_highlightedConn) {
          navigator.DeleteAllItems();

          const rootId = navigator.AddRoot(unescapeString(this.m_highlightedConn));

          this.MakeNetNavigatorNode(
            this.m_highlightedConn,
            rootId,
            aSelection,
            singleSheetSchematic,
          );
        } else {
          const selection = navigator.GetSelection();
          const itemData = selection.IsOk() ? itemDataOf(this, selection) : null;

          navigator.DeleteAllItems();

          const rootId = navigator.AddRoot(unescapeString(this.m_highlightedConn));

          this.MakeNetNavigatorNode(this.m_highlightedConn, rootId, itemData, singleSheetSchematic);
        }
      } else {
        const rootId = navigator.AddRoot(unescapeString(this.m_highlightedConn));

        this.MakeNetNavigatorNode(this.m_highlightedConn, rootId, aSelection, singleSheetSchematic);
      }
    } finally {
      navigator.Thaw();
    }
  }

  /** `SelectNextPrevNetNavigatorItem( aNext )` (:475): Tab and Shift+Tab, wrapping. */
  SelectNextPrevNetNavigatorItem(this: SCH_EDIT_FRAME, aNext: boolean): SCH_ITEM | null {
    const navigator = this.GetNetNavigator();
    const id = navigator.GetSelection();

    if (!id.IsOk()) return null;

    const netItems: wxTreeItemId[] = [];
    const itemList: wxTreeItemId[] = [navigator.GetRootItem()];

    while (itemList.length) {
      const current = itemList.shift()!;
      const cookie: wxTreeItemIdValue = { index: 0 };
      let child = navigator.GetFirstChild(current, cookie);

      while (child.IsOk()) {
        if (navigator.ItemHasChildren(child)) itemList.push(child);
        else netItems.push(child);

        child = navigator.GetNextSibling(child);
      }
    }

    // Locate current item and move forward or backward with wrap
    let nextId = new wxTreeItemId();
    const at = netItems.findIndex((i) => i.equals(id));

    if (at >= 0) {
      const n = netItems.length;
      nextId = netItems[aNext ? (at + 1) % n : (at - 1 + n) % n]!;
    }

    if (nextId.IsOk()) {
      if (!navigator.IsVisible(nextId)) {
        navigator.CollapseAll();
        navigator.EnsureVisible(nextId);
      }

      navigator.UnselectAll();
      navigator.SelectItem(nextId);

      const data = itemDataOf(this, nextId);

      if (data?.GetItem()) return data.GetItem();
    }

    return null;
  }

  /** `SelectNetNavigatorItem( aSelection )` (:551). */
  SelectNetNavigatorItem(this: SCH_EDIT_FRAME, aSelection: NET_NAVIGATOR_ITEM_DATA | null): void {
    const navigator = this.GetNetNavigator();

    if (navigator.IsFrozen()) return; // wxCHECK

    // Maybe in the future we can do something like collapse the tree for an empty selection.
    // For now, leave the tree selection in its current state.
    if (!aSelection) return;

    const rootId = navigator.GetRootItem();

    if (!rootId.IsOk()) return;

    const sheetCookie: wxTreeItemIdValue = { index: 0 };
    let sheetId = navigator.GetFirstChild(rootId, sheetCookie);

    while (sheetId.IsOk()) {
      // Upstream advances to the next sheet only inside this `if`, so a row with no children
      // would spin there; a sheet row is only ever made with items beneath it.
      if (!navigator.ItemHasChildren(sheetId)) break;

      const itemCookie: wxTreeItemIdValue = { index: 0 };
      let itemId = navigator.GetFirstChild(sheetId, itemCookie);

      while (itemId.IsOk()) {
        const itemData = itemDataOf(this, itemId);

        if (itemData?.equals(aSelection)) {
          if (!navigator.IsVisible(itemId)) {
            navigator.CollapseAll();
            navigator.EnsureVisible(itemId);
          }

          navigator.SelectItem(itemId);
          return;
        }

        itemId = navigator.GetNextSibling(itemId);
      }

      sheetId = navigator.GetNextSibling(sheetId);
    }
  }

  /** `GetSelectedNetNavigatorItem()` (:604). */
  GetSelectedNetNavigatorItem(this: SCH_EDIT_FRAME): SCH_ITEM | null {
    const navigator = this.GetNetNavigator();

    if (navigator.IsFrozen()) return null;

    const id = navigator.GetSelection();

    if (!id.IsOk() || id.equals(navigator.GetRootItem())) return null;

    return itemDataOf(this, id)?.GetItem() ?? null;
  }

  /** `onNetNavigatorSelection( aEvent )` (:622): wxEVT_TREE_SEL_CHANGED, the row clicked. */
  onNetNavigatorSelection(this: SCH_EDIT_FRAME, aId: wxTreeItemId): void {
    const navigator = this.GetNetNavigator();

    if (navigator.IsFrozen()) return;

    // Clicking on the root item (net name ) does nothing.
    if (aId.equals(navigator.GetRootItem())) return;

    const itemData = itemDataOf(this, aId);

    // Just a net name when we have all nets displayed.
    if (!itemData) return;

    const sheetPath = itemData.GetSheetPath();

    if (sheetPath && !this.GetCurrentSheet().equals(sheetPath))
      this.GetToolManager()?.RunAction(SCH_ACTIONS.changeSheet, sheetPath);

    // Do not focus on item when a sheet tree node is selected.
    const item = itemData.GetItem();

    if (!navigator.GetItemParent(aId).equals(navigator.GetRootItem()) && item) {
      // Make sure we didn't remove the item and/or the screen it resides on before we access it.
      // Don't search for child items in screen r-tree.
      const owner =
        item.Type() === KICAD_T.SCH_SHEET_PIN_T || item.Type() === KICAD_T.SCH_PIN_T
          ? (item.GetParent() as SCH_ITEM | null)
          : item;
      const screen = sheetPath?.LastScreen() ?? null;

      if (!screen || !owner || !screen.Items().contains(owner, true)) return; // wxCHECK

      this.FocusOnLocation(item.GetBoundingBox().Centre());
    }

    this.GetCanvas()?.Refresh();
  }

  /** `onNetNavigatorFilterChanged( aEvent )` (sch_edit_frame.cpp:2623): wxEVT_TEXT. */
  onNetNavigatorFilterChanged(this: SCH_EDIT_FRAME): void {
    const newFilter = this.GetNetNavigatorFilter().GetValue();

    if (newFilter === this.m_netNavigatorFilterValue) return;

    this.m_netNavigatorFilterValue = newFilter;

    const selection = this.GetNetNavigator().GetSelection();
    const selectionPtr = selection.IsOk() ? itemDataOf(this, selection) : null;

    this.RefreshNetNavigator(selectionPtr);
  }

  /** `onNetNavigatorKey( aEvent )` (sch_edit_frame.cpp:2656): Escape clears the filter. */
  onNetNavigatorKey(this: SCH_EDIT_FRAME, aKey: string): boolean {
    if (aKey !== 'Escape') return false;

    // Clear the search string and refresh
    this.GetNetNavigatorFilter().SetValue('');
    this.m_netNavigatorFilterValue = '';

    this.RefreshNetNavigator();

    // Don't skip the event - we handled it
    return true;
  }

  /** `FindNetInInspector( aNetName )` (:729). */
  FindNetInInspector(this: SCH_EDIT_FRAME, aNetName: string): void {
    if (aNetName === '') return;

    // Ensure the net navigator is shown
    if (!this.IsNetNavigatorShownOnScreen()) this.ToggleNetNavigator();

    // Clear any net highlights
    this.m_highlightedConn = '';
    this.GetToolManager()?.RunAction(SCH_ACTIONS.updateNetHighlighting);

    // Set the search text to the aNetName
    this.GetNetNavigatorFilter().SetValue(aNetName);
    this.m_netNavigatorFilterValue = aNetName;

    // Refresh the tree
    this.RefreshNetNavigator();
  }

  /** `onNetNavigatorItemMenu( aEvent )` (sch_edit_frame.cpp:2677): wxEVT_TREE_ITEM_MENU. */
  onNetNavigatorItemMenu(this: SCH_EDIT_FRAME, aItem: wxTreeItemId): void {
    this.showNetNavigatorMenu(aItem);
  }

  /**
   * `onNetNavigatorContextMenu( aEvent )` (sch_edit_frame.cpp:2683): wxEVT_CONTEXT_MENU, the menu
   * for the row under the pointer - the page hit-tests, so \a aItem is that row or none.
   */
  onNetNavigatorContextMenu(this: SCH_EDIT_FRAME, aItem: wxTreeItemId): void {
    this.showNetNavigatorMenu(aItem);
  }

  /** `showNetNavigatorMenu( aItem )` (sch_edit_frame.cpp:2700). */
  showNetNavigatorMenu(this: SCH_EDIT_FRAME, aItem: wxTreeItemId): void {
    const navigator = this.GetNetNavigator();
    const menu = new wxMenu();

    menu.Append(ID_NET_NAVIGATOR.EXPAND_ALL, _('Expand All'));
    menu.Append(ID_NET_NAVIGATOR.COLLAPSE_ALL, _('Collapse All'));

    const findInInspector = menu.Append(
      ID_NET_NAVIGATOR.FIND_IN_INSPECTOR,
      _('Find in Net Inspector'),
    );

    // A row's wxStringClientData, which only a net row could carry - and RefreshNetNavigator
    // appends net rows with no data at all, so upstream finds a name here only for the
    // highlighted net's root.
    const stringData = (aId: wxTreeItemId): string | null => {
      const data = navigator.GetItemData(aId);
      return data instanceof wxStringClientData ? data.GetData() : null;
    };

    let netName = '';

    if (aItem.IsOk()) {
      let netItem = aItem;

      if (!navigator.GetItemParent(netItem).equals(navigator.GetRootItem())) {
        let parent = navigator.GetItemParent(netItem);

        while (parent.IsOk() && !parent.equals(navigator.GetRootItem())) {
          netItem = parent;
          parent = navigator.GetItemParent(netItem);
        }

        if (parent.equals(navigator.GetRootItem())) netName = stringData(netItem) ?? '';
      } else if (navigator.GetItemParent(netItem).equals(navigator.GetRootItem())) {
        netName = stringData(netItem) ?? '';
      } else if (this.m_highlightedConn !== '' && netItem.equals(navigator.GetRootItem())) {
        netName = this.m_highlightedConn;
      }
    } else if (this.m_highlightedConn !== '' && navigator.GetRootItem().IsOk()) {
      netName = this.m_highlightedConn;
    }

    if (netName === '') {
      findInInspector.Enable(false);
      this.m_netNavigatorMenuNetName = '';
    } else {
      this.m_netNavigatorMenuNetName = netName;
    }

    navigator.PopupMenu(menu, (aId) => this.onNetNavigatorMenuCommand(aId));
  }

  /**
   * The gear button's menu (the `wxEVT_LEFT_DOWN` lambda, sch_edit_frame.cpp:2552): wildcard or
   * regex search, the one in force checked.
   */
  showNetNavigatorSearchMenu(this: SCH_EDIT_FRAME): void {
    const menu = new wxMenu();
    const wildcardItem = menu.AppendRadioItem(
      ID_NET_NAVIGATOR.SEARCH_WILDCARD,
      _('Wildcard Search'),
    );
    const regexItem = menu.AppendRadioItem(ID_NET_NAVIGATOR.SEARCH_REGEX, _('Regex Search'));

    const cfg = this.eeconfig();

    if (cfg?.aui.net_nav_search_mode_wildcard) wildcardItem.Check();
    else regexItem.Check();

    this.GetNetNavigator().PopupMenu(menu, (aId) => this.onNetNavigatorMenuCommand(aId));
  }

  /** `onNetNavigatorMenuCommand( aEvent )` (sch_edit_frame.cpp:2771). */
  onNetNavigatorMenuCommand(this: SCH_EDIT_FRAME, aId: number): void {
    const navigator = this.GetNetNavigator();

    switch (aId) {
      case ID_NET_NAVIGATOR.EXPAND_ALL:
        navigator.ExpandAll();
        break;

      case ID_NET_NAVIGATOR.COLLAPSE_ALL:
        navigator.CollapseAll();

        if (navigator.GetRootItem().IsOk()) navigator.Expand(navigator.GetRootItem());
        break;

      case ID_NET_NAVIGATOR.FIND_IN_INSPECTOR:
        if (this.m_netNavigatorMenuNetName !== '')
          this.FindNetInInspector(this.m_netNavigatorMenuNetName);
        break;

      case ID_NET_NAVIGATOR.SEARCH_WILDCARD:
      case ID_NET_NAVIGATOR.SEARCH_REGEX:
        if (this.eeconfig()) {
          updateEeschemaSettings((cfg) => {
            cfg.aui.net_nav_search_mode_wildcard = aId === ID_NET_NAVIGATOR.SEARCH_WILDCARD;
          });

          // Refresh the navigator with current filter
          this.RefreshNetNavigator();
        }

        break;

      default:
        return;
    }

    this.m_netNavigatorMenuNetName = '';
  }
}

/** `wxStringClientData`: a string hung on a tree row. */
export class wxStringClientData {
  constructor(private m_data = '') {}

  GetData(): string {
    return this.m_data;
  }
}

/** The menu ids (sch_edit_frame.h:1053), `wxID_HIGHEST + 400` on. */
export const ID_NET_NAVIGATOR = {
  EXPAND_ALL: wxID_HIGHEST + 400,
  COLLAPSE_ALL: wxID_HIGHEST + 401,
  FIND_IN_INSPECTOR: wxID_HIGHEST + 402,
  SEARCH_WILDCARD: wxID_HIGHEST + 403,
  SEARCH_REGEX: wxID_HIGHEST + 404,
} as const;
