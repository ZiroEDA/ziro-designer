// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/tool/selection_tool.cpp` + `include/tool/selection_tool.h`:
 * `SELECTION_TOOL`, the base every editor's selection tool derives - the
 * modifier rules for additive/subtractive/toggle selection, the add/remove
 * actions, and the disambiguation menu shown when a click hits several items.
 */

import { BITMAPS } from '../bitmaps_list.js';
import type { COLLECTOR } from '../collector.js';
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import type { EDA_ITEM } from '../eda_item.js';
import { BRIGHTENED } from '../eda_item_flags.js';
import type { KIID } from '../kiid.js';
import { GAL_LAYER_ID } from '../layer_id.js';
import { wxTimer } from '../wx/wx_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ACTION_MENU } from './action_menu.js';
import { CONDITIONAL_MENU } from './conditional_menu.js';
import type { COROUTINE_BODY } from './coroutine.js';
import { SELECTION } from './selection.js';
import {
  CONTEXT_MENU_TRIGGER,
  EVENTS,
  TA_CHOICE_MENU_CHOICE,
  TA_CHOICE_MENU_CLOSED,
  TA_CHOICE_MENU_UPDATE,
  type TOOL_EVENT,
} from './tool_event.js';
import { TOOL_INTERACTIVE } from './tool_interactive.js';

export enum SELECTION_MODE {
  INSIDE_RECTANGLE,
  TOUCHING_RECTANGLE,
  INSIDE_LASSO,
  TOUCHING_LASSO,
}

export abstract class SELECTION_TOOL extends TOOL_INTERACTIVE {
  protected m_additive = false; ///< Items should be added to sel (instead of replacing).
  protected m_subtractive = false; ///< Items should be removed from selection.
  protected m_exclusive_or = false; ///< Items' selection state should be toggled.
  protected m_multiple = false; ///< Multiple selection mode is active.

  /// Show disambiguation menu for all items under the cursor rather than trying to narrow
  /// them down first using heuristics.
  protected m_skip_heuristics = false;
  protected m_highlight_modifier = false; ///< Select highlight net on left click.
  protected m_drag_additive = false; ///< Add multiple items to selection.
  protected m_drag_subtractive = false; ///< Remove multiple from selection.
  protected m_canceledMenu = false; ///< Sets to true if the disambiguation menu was canceled.

  protected m_disambiguateTimer: wxTimer; ///< Timer to show the disambiguate menu.

  protected m_originalCursor: VECTOR2I = { x: 0, y: 0 }; ///< Location of original cursor when starting click.

  constructor(aName: string) {
    super(aName);
    this.m_disambiguateTimer = new wxTimer(() => this.onDisambiguationExpire());
  }

  /**
   * Update a menu's state based on the current selection.
   */
  UpdateMenu(aEvent: TOOL_EVENT): number {
    const actionMenu = aEvent.Parameter<ACTION_MENU | null>();

    if (actionMenu instanceof CONDITIONAL_MENU) actionMenu.Evaluate(this.selection());

    if (actionMenu) actionMenu.UpdateAll();

    return 0;
  }

  AddItemToSel(aEvent: TOOL_EVENT): number;
  AddItemToSel(aItem: EDA_ITEM | null, aQuietMode?: boolean): void;
  AddItemToSel(a: TOOL_EVENT | EDA_ITEM | null, aQuietMode = false): number | undefined {
    if (isToolEvent(a)) {
      this.AddItemToSel(a.Parameter<EDA_ITEM | null>());
      this.selection().SetIsHover(false);
      return 0;
    }

    if (a) {
      this.select(a);

      // Inform other potentially interested tools
      if (!aQuietMode) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    }

    return undefined;
  }

  AddItemsToSel(aEvent: TOOL_EVENT): number;
  AddItemsToSel(aList: EDA_ITEM[] | null, aQuietMode?: boolean): void;
  AddItemsToSel(a: TOOL_EVENT | EDA_ITEM[] | null, aQuietMode = false): number | undefined {
    if (isToolEvent(a)) {
      this.AddItemsToSel(a.Parameter<EDA_ITEM[] | null>(), false);
      this.selection().SetIsHover(false);
      return 0;
    }

    if (a) {
      for (const item of a) this.select(item);

      // Inform other potentially interested tools
      if (!aQuietMode) this.m_toolMgr!.ProcessEvent(EVENTS.SelectedEvent);
    }

    return undefined;
  }

  RemoveItemFromSel(aEvent: TOOL_EVENT): number;
  RemoveItemFromSel(aItem: EDA_ITEM | null, aQuietMode?: boolean): void;
  RemoveItemFromSel(a: TOOL_EVENT | EDA_ITEM | null, aQuietMode = false): number | undefined {
    if (isToolEvent(a)) {
      this.RemoveItemFromSel(a.Parameter<EDA_ITEM | null>());
      this.selection().SetIsHover(false);
      return 0;
    }

    if (a) {
      this.unselect(a);

      // Inform other potentially interested tools
      if (!aQuietMode) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);
    }

    return undefined;
  }

  RemoveItemsFromSel(aEvent: TOOL_EVENT): number;
  RemoveItemsFromSel(aList: EDA_ITEM[] | null, aQuietMode?: boolean): void;
  /**
   * A safer version of RemoveItemsFromSel( EDA_ITEMS ) which doesn't require the items to
   * still exist.
   */
  RemoveItemsFromSel(aList: KIID[], aQuietMode?: boolean): void;
  RemoveItemsFromSel(
    a: TOOL_EVENT | EDA_ITEM[] | KIID[] | null,
    aQuietMode = false,
  ): number | undefined {
    if (isToolEvent(a)) {
      this.RemoveItemsFromSel(a.Parameter<EDA_ITEM[] | null>(), false);
      this.selection().SetIsHover(false);
      return 0;
    }

    if (!a) return undefined;

    if (a.length > 0 && !isEdaItem(a[0])) {
      const aList = a as KIID[];
      const removeItems: EDA_ITEM[] = [];

      for (const item of this.selection()) {
        if (aList.includes(item.m_Uuid)) removeItems.push(item);
      }

      this.RemoveItemsFromSel(removeItems, aQuietMode);
      return undefined;
    }

    for (const item of a as EDA_ITEM[]) this.unselect(item);

    // Inform other potentially interested tools
    if (!aQuietMode) this.m_toolMgr!.ProcessEvent(EVENTS.UnselectedEvent);

    return undefined;
  }

  ReselectItem(aEvent: TOOL_EVENT): number {
    this.RemoveItemFromSel(aEvent.Parameter<EDA_ITEM | null>());
    this.selection().SetIsHover(false);

    this.AddItemToSel(aEvent.Parameter<EDA_ITEM | null>());
    this.selection().SetIsHover(false);

    return 0;
  }

  BrightenItem(aItem: EDA_ITEM): void {
    this.highlight(aItem, BRIGHTENED);
  }

  UnbrightenItem(aItem: EDA_ITEM): void {
    this.unhighlight(aItem, BRIGHTENED);
  }

  /**
   * Show a popup menu to trim the COLLECTOR passed as aEvent's parameter down to a single
   * item.
   *
   * @note This routine **does not** modify the selection.
   */
  *SelectionMenu(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const collector = aEvent.Parameter<COLLECTOR>();

    if (!(yield* this.doSelectionMenu(collector))) collector.m_MenuCancelled = true;

    return 0;
  }

  GetSelection(): SELECTION {
    return this.selection();
  }

  /**
   * Enter the group at the head of the current selection.
   */
  EnterGroup(): void {}

  /**
   * Leave the currently-entered group.
   */
  ExitGroup(_aSelectGroup = false): void {}

  /**
   * Return a reference to the selection.
   */
  protected abstract selection(): SELECTION;

  /**
   * Start the process to show our disambiguation menu once the user has kept
   * the mouse down for the minimum time
   */
  protected onDisambiguationExpire(): void {
    // If there is a multiple selection then it's more likely that we're seeing a paused drag
    // than a long-click.
    if (this.selection().GetSize() >= 2 && !this.hasModifier()) return;

    // If another tool has since started running then we don't want to interrupt
    if (!this.getEditFrame<EDA_DRAW_FRAME>().ToolStackIsEmpty()) return;

    this.m_toolMgr!.ProcessEvent(EVENTS.DisambiguatePoint);
  }

  /**
   * Take necessary action mark an item as selected.
   */
  protected abstract select(aItem: EDA_ITEM): void;

  /**
   * Take necessary action mark an item as unselected.
   */
  protected abstract unselect(aItem: EDA_ITEM): void;

  /**
   * Highlight the item visually.
   *
   * @param aItem The item to be highlighted.
   * @param aHighlightMode Either SELECTED or BRIGHTENED
   * @param aGroup [optional] A group to add the item to.
   */
  protected abstract highlight(aItem: EDA_ITEM, aHighlightMode: number, aGroup?: SELECTION): void;

  /**
   * Unhighlight the item visually.
   */
  protected abstract unhighlight(aItem: EDA_ITEM, aHighlightMode: number, aGroup?: SELECTION): void;

  /**
   * Set the configuration of m_additive, m_subtractive, m_exclusive_or, m_skip_heuristics
   * from the state of modifier keys SHIFT, CTRL, ALT.
   */
  protected setModifiersState(aShiftState: boolean, aCtrlState: boolean, aAltState: boolean): void {
    // Set the configuration of m_additive, m_subtractive, m_exclusive_or from the state of
    // modifier keys SHIFT and CTRL

    // ALT key cannot be used on MSW because of a conflict with the system menu

    this.m_subtractive = aCtrlState && aShiftState;
    this.m_additive = !aCtrlState && aShiftState;

    if (this.ctrlClickHighlights()) {
      this.m_exclusive_or = false;
      this.m_highlight_modifier = aCtrlState && !aShiftState;
    } else {
      this.m_exclusive_or = aCtrlState && !aShiftState;
      this.m_highlight_modifier = false;
    }

    // Drag is more forgiving and allows either Ctrl+Drag or Shift+Drag to add to the selection
    // Note, however that we cannot provide disambiguation at the same time as the box selection
    this.m_drag_additive = (aCtrlState || aShiftState) && !aAltState;
    this.m_drag_subtractive = aCtrlState && aShiftState && !aAltState;

    // While the ALT key has some conflicts under MSW (and some flavors of Linux WMs), it remains
    // useful for users who only use tap-click rather than holding the button.  We disable it for
    // windows because it flashes the disambiguation menu without showing data
    this.m_skip_heuristics = aAltState;
  }

  /**
   * True if a selection modifier is enabled, false otherwise.
   */
  protected hasModifier(): boolean {
    return this.m_subtractive || this.m_additive || this.m_exclusive_or;
  }

  /**
   * Determine if ctrl-click is highlight net or XOR selection.
   */
  protected ctrlClickHighlights(): boolean {
    return false;
  }

  /**
   * Show a menu to disambiguate a click on several items. Returns true (and
   * leaves the collector holding the choice) if one was picked, or "Select
   * All" was; false if the menu was dismissed.
   */
  protected *doSelectionMenu(aCollector: COLLECTOR): COROUTINE_BODY<boolean> {
    const unitsProvider = this.getEditFrame<EDA_DRAW_FRAME>();
    let current: EDA_ITEM | null = null;
    const highlightGroup = new SELECTION();
    let selectAll = false;
    let showMoreChoices = false;

    highlightGroup.SetLayer(GAL_LAYER_ID.LAYER_SELECT_OVERLAY);
    this.getView()!.Add(highlightGroup);

    do {
      /// This must be the second time through the loop, and the user has requested the full,
      /// non-limited list of selection items
      if (showMoreChoices) {
        aCollector.Combine();

        // prime event loop so we don't have to wait around for a mouse-moved
        this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });

        showMoreChoices = false;
      }

      const limit = Math.min(100, aCollector.GetCount());
      const menu = new ACTION_MENU(true);

      const getItemDescription = (item: EDA_ITEM, itemIdx: number): string => {
        const desc = item.GetItemDescription(unitsProvider.GetUnitsProvider(), false);

        if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
          for (let i = 0; i < limit; ++i) {
            if (i === itemIdx) continue;

            const other = aCollector.At(i)!;

            if (other.GetItemDescription(unitsProvider.GetUnitsProvider(), false) === desc)
              return item.DisambiguateItemDescription(unitsProvider.GetUnitsProvider(), false);
          }
        }

        return desc;
      };

      for (let i = 0; i < limit; ++i) {
        const item = aCollector.At(i)!;
        let menuText: string;

        if (i < 9) menuText = `&${i + 1}  ${getItemDescription(item, i)}\t${i + 1}`;
        else menuText = getItemDescription(item, i);

        menu.Add(menuText, i + 1, BITMAPS.INVALID_BITMAP);
      }

      menu.AppendSeparator();
      menu.Add('Select &All\tA', limit + 1, BITMAPS.INVALID_BITMAP);

      if (!showMoreChoices && aCollector.HasAdditionalItems())
        menu.Add('Show &More Choices...\tM', limit + 2, BITMAPS.INVALID_BITMAP);

      if (aCollector.m_MenuTitle.length) {
        menu.SetTitle(aCollector.m_MenuTitle);
        menu.SetIcon(BITMAPS.info);
        menu.DisplayTitle(true);
      } else {
        menu.DisplayTitle(false);
      }

      this.SetContextMenu(menu, CONTEXT_MENU_TRIGGER.CMENU_NOW);

      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        if (evt.Action() === TA_CHOICE_MENU_UPDATE) {
          if (selectAll) {
            for (let i = 0; i < aCollector.GetCount(); ++i)
              this.unhighlight(aCollector.At(i)!, BRIGHTENED, highlightGroup);
          } else if (current) {
            this.unhighlight(current, BRIGHTENED, highlightGroup);
          }

          const id = evt.GetCommandId()!;

          // User has pointed an item, so show it in a different way
          if (id > 0 && id <= limit) {
            current = aCollector.At(id - 1);
            this.highlight(current!, BRIGHTENED, highlightGroup);
          } else {
            current = null;
          }

          // User has pointed on the "Select All" option
          if (id === limit + 1) {
            for (let i = 0; i < aCollector.GetCount(); ++i)
              this.highlight(aCollector.At(i)!, BRIGHTENED, highlightGroup);

            selectAll = true;
          } else {
            selectAll = false;
          }
        } else if (evt.Action() === TA_CHOICE_MENU_CHOICE) {
          if (selectAll) {
            for (let i = 0; i < aCollector.GetCount(); ++i)
              this.unhighlight(aCollector.At(i)!, BRIGHTENED, highlightGroup);
          } else if (current) {
            this.unhighlight(current, BRIGHTENED, highlightGroup);
          }

          const id = evt.GetCommandId();

          // User has selected the "Select All" option
          if (id === limit + 1) {
            selectAll = true;
            current = null;
          }
          // User has selected the "Expand Selection" option
          else if (id === limit + 2) {
            selectAll = false;
            current = null;
            showMoreChoices = true;
          }
          // User has selected an item, so this one will be returned
          else if (id !== undefined && id > 0 && id <= limit) {
            selectAll = false;
            current = aCollector.At(id - 1);
          }
          // User has cancelled the menu (either by <esc> or clicking out of it)
          else {
            selectAll = false;
            current = null;
          }
        } else if (evt.Action() === TA_CHOICE_MENU_CLOSED) {
          break;
        }

        this.getView()!.UpdateItems();
        this.getEditFrame<EDA_DRAW_FRAME>().GetCanvas()?.Refresh();
      }
    } while (showMoreChoices);

    this.getView()!.Remove(highlightGroup);

    if (selectAll) {
      return true;
    } else if (current) {
      aCollector.Empty();
      aCollector.Append(current);
      return true;
    }

    return false;
  }
}

function isToolEvent(a: unknown): a is TOOL_EVENT {
  return (
    a !== null &&
    typeof a === 'object' &&
    typeof (a as TOOL_EVENT).Category === 'function' &&
    typeof (a as TOOL_EVENT).Action === 'function'
  );
}

function isEdaItem(a: unknown): a is EDA_ITEM {
  return a !== null && typeof a === 'object' && typeof (a as EDA_ITEM).Type === 'function';
}
