// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-14 — the Drawing Sheet Editor's canvas context menu, raised by a real
 * right click through `PL_SELECTION_TOOL::Main` (pl_selection_tool.cpp:120-135)
 * and popped through the frame's `PopupMenu`. The two forms are what the
 * driven audit captured out of real pl_editor 10.0.5
 * (`shots/k_ctxmenu_empty.png`), and they follow from
 * `CONDITIONAL_MENU::Evaluate` (`common/tool/conditional_menu.cpp:128-190`)
 * over the entries `PL_SELECTION_TOOL::Init` (:55-70), `PL_EDIT_TOOL::Init`
 * and `EDA_DRAW_FRAME::AddStandardSubMenus` put in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import type { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import {
  AS_GLOBAL,
  BUT_RIGHT,
  TA_MOUSE_CLICK,
  TC_MOUSE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { wxMenu } from '@ziroeda/common/wx/menu.js';
import { PL_SELECTION_TOOL } from '@ziroeda/pagelayout_editor/tools/pl_selection_tool.js';
import { type Harness, makeHarness, settle } from './pl_editor_fixture.js';

let model: DS_DATA_MODEL;

beforeEach(() => {
  SetPgm(new PGM_BASE());
  model = new DS_DATA_MODEL();
  DS_DATA_MODEL.SetAltInstance(model);
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

/** The menu as a user reads it: labels, a separator as `—`, a submenu with `▸`. */
function shape(aMenu: wxMenu): string[] {
  return aMenu
    .GetMenuItems()
    .map((it) =>
      it.IsSeparator() ? '—' : `${it.GetItemLabelText()}${it.IsSubMenu() ? ' ▸' : ''}`,
    );
}

/** Right-click at `aAt`, and the menu the frame was asked to pop up. */
async function rightClick(h: Harness, aAt: { x: number; y: number }): Promise<ACTION_MENU> {
  let shown: ACTION_MENU | null = null;
  h.frame.SetPopupMenuPresenter((aMenu, aOnClose) => {
    shown = aMenu;
    aOnClose();
  });

  h.cursor.at = aAt;
  const e = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_CLICK, BUT_RIGHT, AS_GLOBAL);
  e.SetMousePosition(aAt);
  h.mgr.ProcessEvent(e);
  await settle();

  expect(shown, 'no context menu was popped up').not.toBeNull();
  return shown!;
}

function withLine(): { h: Harness; line: DS_DATA_ITEM } {
  const h = makeHarness(EDA_UNITS_INT.MILS);
  model.ClearList();
  const line = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
  line.SetStart(50, 50, CORNER_ANCHOR.LT_CORNER);
  line.SetEnd(150, 50, CORNER_ANCHOR.LT_CORNER);
  model.Append(line);
  h.frame.HardRedraw();
  return { h, line };
}

describe('the canvas context menu', () => {
  it('with nothing under the cursor, offers the four SELECTION_CONDITIONS::Empty tools', async () => {
    const { h } = withLine();

    const menu = await rightClick(h, { x: 300000, y: 250000 });

    expect(shape(menu)).toEqual([
      'Draw Lines',
      'Draw Rectangles',
      'Draw Text',
      'Place Bitmaps',
      '—',
      'Paste',
      '—',
      'Zoom ▸',
      'Grid ▸',
    ]);
  });

  it('on an item, hover-selects it and matches pl_editor row for row', async () => {
    const { h } = withLine();

    // (100 mm, 50 mm) from the left-top page corner, 10 mm margins: on the line.
    const menu = await rightClick(h, { x: 110000, y: 60000 });

    expect(h.mgr.GetTool(PL_SELECTION_TOOL)!.GetSelection().GetSize()).toBe(1);
    expect(shape(menu)).toEqual([
      'Move',
      '—',
      'Cut',
      'Copy',
      'Paste',
      'Delete',
      '—',
      'Zoom ▸',
      'Grid ▸',
    ]);
  });
});
