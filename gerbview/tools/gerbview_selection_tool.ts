// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/tools/gerbview_selection_tool.cpp` + `.h`:
 * `GERBVIEW_SELECTION_TOOL`, GerbView's always-running selection tool - a
 * click picks the item under the cursor (a menu disambiguates several), a
 * right click opens the context menu with the Highlight submenu, a middle
 * double click zooms to fit.
 */

import { BITMAPS } from '@ziroeda/common/bitmaps_list.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { unescapeString as UnescapeString } from '@ziroeda/common/string_utils.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_TOOL } from '@ziroeda/common/tool/selection_tool.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_LEFT,
  BUT_MIDDLE,
  BUT_RIGHT,
  EVENTS,
  MD_ALT,
  MD_CTRL,
  MD_SHIFT,
  TA_UNDO_REDO_PRE,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { GBR_NETINFO_TYPE } from '../gbr_netlist_metadata.js';
import { GERBER_COLLECTOR } from '../gerber_collectors.js';
import type { GERBER_DRAW_ITEM } from '../gerber_draw_item.js';
import type { GERBVIEW_FRAME } from '../gerbview_frame.js';
import { GERBVIEW_ACTIONS } from './gerbview_actions.js';
import { GERBVIEW_SELECTION } from './gerbview_selection.js';

/**
 * The "Highlight" submenu: for a single selected item, the component, net,
 * aperture attribute and D-code it could highlight, then Clear Highlight.
 */
class HIGHLIGHT_MENU extends ACTION_MENU {
  constructor() {
    super(true);
    this.SetIcon(BITMAPS.net_highlight_schematic);
    this.SetTitle('Highlight');
  }

  protected override update(): void {
    let addSeparator = false;

    this.Clear();

    const tool = this.getToolManager()!.GetTool(GERBVIEW_SELECTION_TOOL)!;
    const selection = tool.GetSelection();

    if (selection.Size() === 1) {
      const item = selection.GetItem(0) as GERBER_DRAW_ITEM;
      const net_attr = item.GetNetAttributes();

      if (
        net_attr.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_PAD ||
        net_attr.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_CMP
      ) {
        const menuEntry = this.Add(GERBVIEW_ACTIONS.highlightComponent);
        menuEntry.SetItemLabel(`Highlight Items of Component '${net_attr.m_Cmpref}'`);
        addSeparator = true;
      }

      if (net_attr.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_NET) {
        const menuEntry = this.Add(GERBVIEW_ACTIONS.highlightNet);
        menuEntry.SetItemLabel(`Highlight Items of Net '${UnescapeString(net_attr.m_Netname)}'`);
        addSeparator = true;
      }

      const apertDescr = item.GetDcodeDescr();

      if (apertDescr && apertDescr.m_AperFunction !== '') {
        const menuEntry = this.Add(GERBVIEW_ACTIONS.highlightAttribute);
        menuEntry.SetItemLabel(`Highlight Aperture Type '${apertDescr.m_AperFunction}'`);
        addSeparator = true;
      }

      if (apertDescr) {
        const menuEntry = this.Add(GERBVIEW_ACTIONS.highlightDCode);
        menuEntry.SetItemLabel(`Highlight DCode D${apertDescr.m_Num_Dcode}`);
        addSeparator = true;
      }
    }

    if (addSeparator) this.AppendSeparator();

    this.Add(GERBVIEW_ACTIONS.highlightClear);
  }

  protected override create(): ACTION_MENU {
    return new HIGHLIGHT_MENU();
  }
}

/**
 * Selection tool for GerbView, based on the one in Pcbnew
 */
export class GERBVIEW_SELECTION_TOOL extends SELECTION_TOOL {
  private m_frame: GERBVIEW_FRAME | null; // Pointer to the parent frame.
  private m_selection = new GERBVIEW_SELECTION(); // Current state of selection.

  constructor() {
    super('common.InteractiveSelection');
    this.m_frame = null;
  }

  /// @copydoc TOOL_BASE::Init()
  override Init(): boolean {
    const highlightSubMenu = new HIGHLIGHT_MENU();
    highlightSubMenu.SetTool(this);
    this.m_menu.RegisterSubMenu(highlightSubMenu);

    this.m_menu.GetMenu().AddMenu(highlightSubMenu);
    this.m_menu.GetMenu().AddSeparator(1000);

    this.getEditFrame<GERBVIEW_FRAME>().AddStandardSubMenus(this.m_menu);

    return true;
  }

  /// @copydoc TOOL_BASE::Reset()
  override Reset(aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<GERBVIEW_FRAME>();

    if (aReason === RESET_REASON.MODEL_RELOAD || aReason === RESET_REASON.SHUTDOWN) {
      // Remove pointers to the selected items from containers
      // without changing their properties (as they are already deleted
      // while a new file is loaded)
      this.m_selection.Clear();
      this.getView()!.GetPainter().GetSettings().SetHighlight(false);
    } else {
      // Restore previous properties of selected items and remove them from containers
      this.clearSelection();
    }

    // Reinsert the VIEW_GROUP, in case it was removed from the VIEW
    this.getView()!.Remove(this.m_selection);
    this.getView()!.Add(this.m_selection);
  }

  /**
   * The main loop.
   */
  *Main(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      if (frame.ToolStackIsEmpty()) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);

      // on left click, a selection is made, depending on modifiers ALT, SHIFT, CTRL:
      this.setModifiersState(
        evt.Modifier(MD_SHIFT) !== 0,
        evt.Modifier(MD_CTRL) !== 0,
        evt.Modifier(MD_ALT) !== 0,
      );

      // single click? Select single object
      if (evt.IsClick(BUT_LEFT)) {
        yield* this.selectPoint(evt.Position());
      } else if (evt.IsClick(BUT_RIGHT)) {
        // right click? if there is any object - show the context menu
        if (this.m_selection.Empty()) {
          yield* this.selectPoint(evt.Position());
          this.m_selection.SetIsHover(true);
        }

        // Show selection before opening menu
        frame.GetCanvas()!.ForceRefresh();

        this.m_menu.ShowContextMenu(this.m_selection);
      } else if (evt.IsDblClick(BUT_MIDDLE)) {
        // Middle double click?  Do zoom to fit
        this.m_toolMgr!.RunAction(ACTIONS.zoomFitScreen);
      } else if (evt.IsCancel() || evt.Action() === TA_UNDO_REDO_PRE) {
        this.clearSelection();
      } else {
        evt.SetPassEvent();
      }
    }

    return 0;
  }

  /**
   * @return the set of currently selected items.
   */
  override GetSelection(): GERBVIEW_SELECTION {
    return this.m_selection;
  }

  ///< Clear current selection event handler.
  ClearSelection(_aEvent: TOOL_EVENT): number {
    this.clearSelection();

    return 0;
  }

  ///< Item selection event handler.
  SelectItem(aEvent: TOOL_EVENT): number {
    // Check if there is an item to be selected
    const item = aEvent.Parameter<EDA_ITEM | null>();

    if (item) {
      this.select(item);

      // Inform other potentially interested tools
      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    }

    return 0;
  }

  SelectItems(aEvent: TOOL_EVENT): number {
    const items = aEvent.Parameter<EDA_ITEM[] | null>();

    if (items) {
      // Perform individual selection of each item before processing the event.
      for (const item of items) this.select(item);

      this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    }

    return 0;
  }

  ///< Item unselection event handler.
  UnselectItem(aEvent: TOOL_EVENT): number {
    // Check if there is an item to be selected
    const item = aEvent.Parameter<EDA_ITEM | null>();

    if (item) {
      this.unselect(item);

      // Inform other potentially interested tools
      this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
    }

    return 0;
  }

  UnselectItems(aEvent: TOOL_EVENT): number {
    const items = aEvent.Parameter<EDA_ITEM[] | null>();

    if (items) {
      // Perform individual unselection of each item before processing the event
      for (const item of items) this.unselect(item);

      this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
    }

    return 0;
  }

  ///< Sets up handlers for various events.
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.UpdateMenu), ACTIONS.updateMenu.MakeEvent());
    this.Go(this.Main, ACTIONS.selectionActivate.MakeEvent());
    this.Go(SYNC_HANDLER(this.ClearSelection), ACTIONS.selectionClear.MakeEvent());
    this.Go(SYNC_HANDLER(this.SelectItem), ACTIONS.selectItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.UnselectItem), ACTIONS.unselectItem.MakeEvent());
  }

  protected selection(): SELECTION {
    return this.m_selection;
  }

  /**
   * Select an item pointed by the parameter aWhere. If there is more than one item at that
   * place, there is a menu displayed that allows one to choose the item.
   *
   * @param aWhere is the place where the item should be selected.
   * @return True if an item was selected, false otherwise.
   */
  private *selectPoint(aWhere: VECTOR2I): COROUTINE_BODY<boolean> {
    let item: EDA_ITEM | null = null;
    const collector = new GERBER_COLLECTOR();
    const model = this.getModel<EDA_ITEM>();

    collector.Collect(
      model,
      [KICAD_T.GERBER_LAYOUT_T, KICAD_T.GERBER_IMAGE_T, KICAD_T.GERBER_DRAW_ITEM_T],
      aWhere,
    );

    // Remove unselectable items
    for (let i = collector.GetCount() - 1; i >= 0; --i) {
      if (!this.selectable(collector.At(i)!)) collector.Remove(i);
    }

    if (collector.GetCount() > 1) {
      yield* this.doSelectionMenu(collector);

      if (collector.m_MenuCancelled) return false;
    }

    if (!this.m_additive && !this.m_subtractive && !this.m_exclusive_or) this.clearSelection();

    if (collector.GetCount() === 1) {
      item = collector.At(0)!;

      if (this.m_subtractive || (this.m_exclusive_or && item.IsSelected())) {
        this.unselect(item);
        this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
        return false;
      } else {
        this.select(item);
        this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
        return true;
      }
    }

    return false;
  }

  /**
   * Clear the current selection.
   */
  private clearSelection(): void {
    if (this.m_selection.Empty()) return;

    for (const item of this.m_selection) this.unselectVisually(item);

    this.m_selection.Clear();

    // Inform other potentially interested tools
    this.m_toolMgr!.ProcessEvent(EVENTS.ClearedEvent);
  }

  /**
   * Check conditions for an item to be selected.
   *
   * @return True if the item fulfills conditions to be selected.
   */
  private selectable(aItem: EDA_ITEM): boolean {
    const frame = this.getEditFrame<GERBVIEW_FRAME>();
    const item = aItem as GERBER_DRAW_ITEM;
    const layer = item.GetLayer();

    if (!frame.gvconfig().m_Appearance.show_negative_objects && item.GetLayerPolarity())
      return false;

    // We do not want to select items that are in the background
    if (frame.gvconfig().m_Display.m_HighContrastMode && layer !== frame.GetActiveLayer())
      return false;

    return frame.IsLayerVisible(layer);
  }

  /**
   * Take necessary action mark an item as selected.
   *
   * @param aItem is an item to be selected.
   */
  protected select(aItem: EDA_ITEM): void {
    if (aItem.IsSelected()) return;

    this.m_selection.Add(aItem);
    this.getView()!.Add(this.m_selection, Number.MAX_SAFE_INTEGER);
    this.selectVisually(aItem);
  }

  /**
   * Take necessary action mark an item as unselected.
   *
   * @param aItem is an item to be unselected.
   */
  protected unselect(aItem: EDA_ITEM): void {
    if (!aItem.IsSelected()) return;

    this.unselectVisually(aItem);
    this.m_selection.Remove(aItem);

    if (this.m_selection.Empty()) this.getView()!.Remove(this.m_selection);
  }

  /**
   * Mark item as selected, but does not add it to the ITEMS_PICKED_LIST.
   */
  private selectVisually(aItem: EDA_ITEM): void {
    // Move the item's layer to the front
    const layer = (aItem as GERBER_DRAW_ITEM).GetLayer();
    this.m_frame!.SetActiveLayer(layer, true);

    // Hide the original item, so it is shown only on overlay
    aItem.SetSelected();
    this.getView()!.Hide(aItem, true);

    this.getView()!.Update(this.m_selection);
  }

  /**
   * Mark item as selected, but does not add it to the ITEMS_PICKED_LIST.
   */
  private unselectVisually(aItem: EDA_ITEM): void {
    // Restore original item visibility
    aItem.ClearSelected();
    this.getView()!.Hide(aItem, false);
    this.getView()!.Update(aItem, VIEW_UPDATE_FLAGS.ALL);

    this.getView()!.Update(this.m_selection);
  }

  protected highlight(_aItem: EDA_ITEM, _aHighlightMode: number, _aGroup?: SELECTION): void {
    // Currently not used in GerbView
  }

  protected unhighlight(_aItem: EDA_ITEM, _aHighlightMode: number, _aGroup?: SELECTION): void {
    // Currently not used in GerbView
  }
}
