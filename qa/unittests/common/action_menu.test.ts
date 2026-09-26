// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ACTION_MENU, CONDITIONAL_MENU and the manager's context-menu round trip,
 * against the C++:
 *
 *   CONDITIONAL_MENU::addEntry (conditional_menu.cpp:218-230)  entries sort
 *       by order, ties keep insertion order.
 *   CONDITIONAL_MENU::Evaluate (:113-189)  a false condition drops the
 *       entry; a separator with nothing before it since the last one is
 *       dropped.
 *   ACTION_MENU::DisplayTitle (action_menu.cpp:107-140)  a title row and a
 *       separator at the top, removed again.
 *   ACTION_MENU::OnMenuEvent (:414-570)  an action item runs its action; an
 *       id in the popup range is TA_CHOICE_MENU_CHOICE with the label; a
 *       highlight is TA_CHOICE_MENU_UPDATE.
 *   TOOL_MANAGER::DispatchContextMenu (tool_manager.cpp:925-1025)  the menu
 *       shown is a CLONE; closing unselected sends CHOICE -1 then CLOSED.
 */
import { describe, expect, it } from 'vitest';
import { BITMAPS } from '@ziroeda/common/bitmaps_list.js';
import { main_id } from '@ziroeda/common/id.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import {
  TA_CHOICE_MENU_CHOICE,
  TA_CHOICE_MENU_CLOSED,
  TA_CHOICE_MENU_UPDATE,
  TC_COMMAND,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { wxMenuEvent, wxMenuEventType } from '@ziroeda/common/wx/menu.js';
import { gerbIUScale } from '@ziroeda/common/eda_units.js';
import { GRID_MENU } from '@ziroeda/common/tool/grid_menu.js';
import { ZOOM_MENU } from '@ziroeda/common/tool/zoom_menu.js';
import { GERBVIEW_SETTINGS } from '@ziroeda/gerbview/gerbview_settings.js';

const never = (): boolean => false;

/** A manager whose ProcessEvent records, standing in for m_tool->GetManager(). */
function recordingTool(): { tool: { GetManager(): TOOL_MANAGER }; events: TOOL_EVENT[] } {
  const events: TOOL_EVENT[] = [];
  const mgr = new TOOL_MANAGER();
  mgr.ProcessEvent = (e: TOOL_EVENT): boolean => {
    events.push(e);
    return true;
  };
  return { tool: { GetManager: () => mgr }, events };
}

function labels(aMenu: ACTION_MENU): string[] {
  return aMenu.GetMenuItems().map((i) => (i.IsSeparator() ? '---' : i.GetItemLabelText()));
}

describe('CONDITIONAL_MENU', () => {
  it('orders entries by their order, and drops what its condition rejects', () => {
    const m = new CONDITIONAL_MENU(null);
    m.AddItem(1, 'B', '', BITMAPS.INVALID_BITMAP, SELECTION_CONDITIONS.ShowAlways, 20);
    m.AddItem(2, 'A', '', BITMAPS.INVALID_BITMAP, SELECTION_CONDITIONS.ShowAlways, 10);
    m.AddItem(3, 'hidden', '', BITMAPS.INVALID_BITMAP, never, 15);
    m.AddItem(4, 'A2', '', BITMAPS.INVALID_BITMAP, SELECTION_CONDITIONS.ShowAlways, 10);

    m.Evaluate(new SELECTION());

    expect(labels(m)).toEqual(['A', 'A2', 'B']);
  });

  it('drops a separator with no item since the last one', () => {
    const m = new CONDITIONAL_MENU(null);
    m.AddSeparator(1);
    m.AddItem(1, 'X', '', BITMAPS.INVALID_BITMAP, SELECTION_CONDITIONS.ShowAlways, 2);
    m.AddSeparator(3);
    m.AddItem(2, 'gone', '', BITMAPS.INVALID_BITMAP, never, 4);
    m.AddSeparator(5);
    m.AddItem(3, 'Y', '', BITMAPS.INVALID_BITMAP, SELECTION_CONDITIONS.ShowAlways, 6);

    m.Evaluate(new SELECTION());

    // leading separator: nothing before it; the one at 5: nothing since 3's
    expect(labels(m)).toEqual(['X', '---', 'Y']);
  });
});

describe('ACTION_MENU', () => {
  it('shows its title as a first row and a separator, and removes both', () => {
    const m = new ACTION_MENU(true);
    m.Add('Item', 5, BITMAPS.INVALID_BITMAP);
    m.SetTitle('Title');
    m.DisplayTitle(true);
    expect(labels(m)).toEqual(['Title', '---', 'Item']);

    m.DisplayTitle(false);
    expect(labels(m)).toEqual(['Item']);
  });

  it('a clone is a copy, submenus included', () => {
    const sub = new ACTION_MENU(true);
    sub.SetTitle('Sub');
    sub.Add('Inner', 7, BITMAPS.INVALID_BITMAP);
    const m = new ACTION_MENU(true);
    m.Add('Outer', 6, BITMAPS.INVALID_BITMAP);
    m.Add(sub);

    const c = m.Clone();

    expect(labels(c)).toEqual(['Outer', 'Sub']);
    expect(c.GetMenuItems()[1]!.GetSubMenu()).not.toBe(sub);
    expect(labels(c.GetMenuItems()[1]!.GetSubMenu() as ACTION_MENU)).toEqual(['Inner']);
  });

  it('a non-action item in the popup range is TA_CHOICE_MENU_CHOICE carrying its label', () => {
    const { tool, events } = recordingTool();
    const m = new ACTION_MENU(true, tool);
    const id = main_id.ID_POPUP_MENU_START + 3;
    m.Add('&Pick me', id, BITMAPS.INVALID_BITMAP);

    m.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED, id, m));

    expect(m.GetSelected()).toBe(id);
    expect(events).toHaveLength(1);
    expect(events[0]!.Category()).toBe(TC_COMMAND);
    expect(events[0]!.Action()).toBe(TA_CHOICE_MENU_CHOICE);
    expect(events[0]!.GetCommandId()).toBe(id);
    expect(events[0]!.Parameter<string>()).toBe('Pick me');
  });

  it('an id outside both ranges and without an action sends nothing', () => {
    const { tool, events } = recordingTool();
    const m = new ACTION_MENU(true, tool);
    m.Add('Nowhere', 5000, BITMAPS.INVALID_BITMAP);

    m.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED, 5000, m));

    expect(events).toHaveLength(0);
  });

  it('a highlight is TA_CHOICE_MENU_UPDATE with the id', () => {
    const { tool, events } = recordingTool();
    const m = new ACTION_MENU(true, tool);
    m.Add('Row', 12, BITMAPS.INVALID_BITMAP);

    m.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_MENU_HIGHLIGHT, 12, m));

    expect(events[0]!.Action()).toBe(TA_CHOICE_MENU_UPDATE);
    expect(events[0]!.GetCommandId()).toBe(12);
  });

  it("an action item makes that action's event", () => {
    const { tool, events } = recordingTool();
    const mgr = tool.GetManager();
    // The action must be registered for IsActionUIId to know its UI id.
    mgr.GetActionManager().RegisterAction(ACTIONS.zoomFitScreen);
    const m = new ACTION_MENU(true, tool);
    m.Add(ACTIONS.zoomFitScreen);

    m.OnMenuEvent(
      new wxMenuEvent(
        wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED,
        ACTIONS.zoomFitScreen.GetUIId(),
        m,
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.IsAction(ACTIONS.zoomFitScreen)).toBe(true);
  });
});

describe('ACTION_MENU in a submenu', () => {
  it('a selection in a submenu marks every parent as selected too', () => {
    const { tool } = recordingTool();
    const sub = new ACTION_MENU(true, tool);
    sub.SetTitle('Sub');
    const id = main_id.ID_POPUP_MENU_START + 1;
    sub.Add('Inner', id, BITMAPS.INVALID_BITMAP);
    const m = new ACTION_MENU(true, tool);
    m.Add(sub);

    sub.OnMenuEvent(new wxMenuEvent(wxMenuEventType.wxEVT_COMMAND_MENU_SELECTED, id, sub));

    expect(m.GetSelected()).toBe(id);
  });
});

describe('TOOL_MANAGER context menu', () => {
  it('the closed half sends CHOICE -1 for a dismissed menu, then CLOSED', () => {
    const mgr = new TOOL_MANAGER();
    const seen: TOOL_EVENT[] = [];
    (mgr as unknown as { dispatchInternal(e: TOOL_EVENT): boolean }).dispatchInternal = (e) => {
      seen.push(e);
      return true;
    };
    const m = new ACTION_MENU(true);

    (
      mgr as unknown as { contextMenuClosed(m: ACTION_MENU, menu: ACTION_MENU): void }
    ).contextMenuClosed(m, m.Clone());

    expect(seen.map((e) => e.Action())).toEqual([TA_CHOICE_MENU_CHOICE, TA_CHOICE_MENU_CLOSED]);
    expect(seen[0]!.GetCommandId()).toBe(-1);
    expect(seen[1]!.Parameter<ACTION_MENU>()).toBe(m);
  });
});

describe('GRID_MENU and ZOOM_MENU (grid_menu.cpp:60-80, zoom_menu.cpp:60-84)', () => {
  const cfg = new GERBVIEW_SETTINGS();
  const parent = {
    config: () => cfg,
    GetWindowSettings: (c: GERBVIEW_SETTINGS) => c.m_Window,
    GetIuScale: () => gerbIUScale,
    GetUnitPair: () => ({ primary: 'mm' as const, secondary: 'mils' as const }),
    GetCanvas: () => ({ GetGAL: () => ({ GetZoomFactor: () => zoom }) }),
  };
  let zoom = 1.0;

  it('GRID_MENU: Grid Origin, a separator, then one checked row per grid on the current one', () => {
    cfg.m_Window.grid.last_size_idx = 3;
    const m = new GRID_MENU(parent);
    const items = m.GetMenuItems();

    expect(items[1]!.IsSeparator()).toBe(true);
    expect(items.length).toBe(2 + cfg.m_Window.grid.grids.length);
    expect(items.filter((i) => i.IsChecked()).map((i) => items.indexOf(i))).toEqual([2 + 3]);
    expect(items[5]!.GetId()).toBe(main_id.ID_POPUP_GRID_START + 3);
  });

  it('ZOOM_MENU: "Zoom: %.2f" rows, the preset within 10 % of the zoom checked', () => {
    zoom = 1.05; // within 10 % of the 1.0 preset only
    const m = new ZOOM_MENU(parent);
    m.UpdateAll();
    const items = m.GetMenuItems();
    const i10 = cfg.m_Window.zoom_factors.indexOf(1.0);

    expect(items[i10]!.GetItemLabelText()).toBe('Zoom: 1.00');
    expect(items.filter((i) => i.IsChecked()).map((i) => items.indexOf(i))).toEqual([i10]);
    expect(items[i10]!.GetId()).toBe(main_id.ID_POPUP_ZOOM_LEVEL_START + i10 + 1);
  });
});
