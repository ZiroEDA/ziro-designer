// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_INSPECTOR` (pagelayout_editor/dialogs/design_inspector.cpp), as
 * `PL_EDITOR_FRAME::ShowDesignInspector` builds it over the live model:
 *
 *   ReCreateDesignList (:205-315)  a "Layout" root row with the page type in
 *       Comment and "Size: %.1fx%.1fmm" in Text, then one row per item: its
 *       class name, "%d" repeat count, m_Info, and a text's m_TextBase; the
 *       title is the file's base name or "<default drawing sheet>".
 *   onCellClicked (:338-354)  selects the row; on an item row, clears the
 *       editor's selection, selects the item and refills the Properties panel.
 *       It never ends the dialog and never touches the view.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_DATA_ITEM_POLYGONS,
  DS_DATA_ITEM_TEXT,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import {
  DIALOG_INSPECTOR,
  DS_ICON_IMG,
  DS_ICON_LINE,
  DS_ICON_POLY,
  DS_ICON_RECT,
  DS_ICON_ROOT,
  DS_ICON_TEXT,
  DS_INSPECTOR_COLUMNS,
  DS_INSPECTOR_DEFAULT_TITLE,
} from '@ziroeda/pagelayout_editor/dialogs/design_inspector.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
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

/** A line (commented), a text, a polygon and a rectangle. */
function sheet(): Harness {
  const h = makeHarness(EDA_UNITS_INT.MM);
  model.ClearList();

  const line = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
  line.SetStart(10, 10, CORNER_ANCHOR.LT_CORNER);
  line.SetEnd(40, 10, CORNER_ANCHOR.LT_CORNER);
  line.m_Info = 'rule';
  line.m_RepeatCount = 3;
  model.Append(line);

  const text = new DS_DATA_ITEM_TEXT('${TITLE}');
  text.SetStart(20, 20, CORNER_ANCHOR.LT_CORNER);
  model.Append(text);

  model.Append(new DS_DATA_ITEM_POLYGONS());

  const rect = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_RECT);
  rect.SetStart(5, 5, CORNER_ANCHOR.LT_CORNER);
  rect.SetEnd(8, 8, CORNER_ANCHOR.LT_CORNER);
  model.Append(rect);

  h.frame.HardRedraw();
  return h;
}

async function inspect(h: Harness): Promise<DIALOG_INSPECTOR> {
  h.mgr.RunAction(PL_ACTIONS.showInspector);
  await settle();
  return h.host.inspectors[0]!;
}

describe('the title', () => {
  it('falls back to <default drawing sheet> when nothing is loaded', async () => {
    expect((await inspect(sheet())).GetTitle()).toBe(DS_INSPECTOR_DEFAULT_TITLE);
  });

  it('names the sheet by its base name only', async () => {
    const h = sheet();
    h.frame.SetCurrentFileName('/Templates/pagelayout_default.kicad_wks');
    expect((await inspect(h)).GetTitle()).toBe('pagelayout_default');
  });
});

describe('the grid', () => {
  it('has KiCad’s five columns, the first a dash', () => {
    expect(DS_INSPECTOR_COLUMNS).toEqual(['-', 'Type', 'Count', 'Comment', 'Text']);
  });

  it('opens on a Layout row: the page TYPE in Comment, its size in Text', async () => {
    const root = (await inspect(sheet())).GetRows()[0]!;

    // A3 is 16535 x 11693 mils -> 419989 x 297002 IU -> "%.1f" mm.
    expect(root).toMatchObject({
      number: 1,
      type: 'Layout',
      count: '-',
      comment: 'A3',
      text: 'Size: 420.0x297.0mm',
      itemIndex: null,
      icon: DS_ICON_ROOT,
    });
  });

  it('lists every item from row 2: class name, count, comment, raw text, type icon', async () => {
    const rows = (await inspect(sheet())).GetRows().slice(1);

    expect(rows.map((r) => [r.number, r.type, r.count, r.comment, r.text])).toEqual([
      [2, 'Line', '3', 'rule', ''],
      [3, 'Text', '1', '', '${TITLE}'],
      [4, 'Imported Shape', '1', '', ''],
      [5, 'Rectangle', '1', '', ''],
    ]);
    expect(rows.map((r) => r.icon)).toEqual([
      DS_ICON_LINE,
      DS_ICON_TEXT,
      DS_ICON_POLY,
      DS_ICON_RECT,
    ]);
    expect(rows.map((r) => r.icon)).not.toContain(DS_ICON_IMG);
  });
});

describe('onCellClicked', () => {
  it('selects the item in the editor and loads the Properties panel', async () => {
    const h = sheet();
    const dlg = await inspect(h);

    dlg.onCellClicked(2);

    const selection = h.mgr.GetTool(PL_SELECTION_TOOL)!.GetSelection();
    expect(selection.GetSize()).toBe(1);
    expect(selection.Front()).toBe(model.GetItem(1)!.GetDrawItems()[0]);
    expect(h.frame.GetPropertiesFrame()!.m_staticTextType).toBe('Text');
    expect(dlg.GetSelectedRow()).toBe(2);
  });

  it('on the root row selects the row and nothing in the editor', async () => {
    const h = sheet();
    const dlg = await inspect(h);
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(model.GetItem(0)!.GetDrawItems()[0]!);

    dlg.onCellClicked(0);

    expect(dlg.GetSelectedRow()).toBe(0);
    expect(h.mgr.GetTool(PL_SELECTION_TOOL)!.GetSelection().GetSize()).toBe(1);
  });

  it('leaves the zoom and the view centre alone', async () => {
    const h = sheet();
    const dlg = await inspect(h);
    const scale = h.view.GetScale();
    const centre = h.view.GetCenter();

    dlg.onCellClicked(4);

    expect(h.view.GetScale()).toBe(scale);
    expect(h.view.GetCenter()).toEqual(centre);
  });
});
