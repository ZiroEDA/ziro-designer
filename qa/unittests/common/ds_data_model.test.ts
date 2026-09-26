// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DS_DATA_MODEL`, `DS_DATA_ITEM*` and `DS_DRAW_ITEM*`, against numbers
 * worked from the C++ by hand:
 *
 *   SetupDrawEnvironment (ds_data_model.cpp:73-92)  m_WSunits2Iu = milsToIU /
 *       (25.4 / 1000); corners from the margins and GetSizeMils. A4 is
 *       MMsize( 297, 210 ) = 11693 x 8268 mils (page_info.cpp:49), so with
 *       10 mm margins RB = (297.0022 - 10, 210.0072 - 10).
 *   GetStartPos (ds_data_item.cpp:283-311)  each anchor measured inward.
 *   MoveStartPointTo (:170-199)  the inverse, per anchor.
 *   MoveEndPointTo (:210-247)  touches m_End only for segments and rects.
 *   IsInsidePage (:340-361)  both ends for lines, the start for the rest.
 *   ReplaceAntiSlashSequence (:648-679)
 *   DS_DATA_ITEM_POLYGONS::SetBoundingBox (:442-474)  corners truncated to
 *       whole millimetres (VECTOR2I pos = m_Corners[ii]).
 *   ViewGetLayers (ds_draw_item.cpp:71-89)
 *   DS_DRAW_ITEM_RECT::HitTest (:345-430)  its four sides, not its inside.
 *   BuildFullText (ds_painter.cpp:116-230)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drawSheetIUScale } from '@ziroeda/common/eda_units.js';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_DATA_ITEM_POLYGONS,
  DS_DATA_ITEM_TEXT,
  PAGE_OPTION,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import {
  DS_DRAW_ITEM_LIST,
  DS_DRAW_ITEM_RECT,
} from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import {
  LAYER_DRAWINGSHEET,
  LAYER_DRAWINGSHEET_PAGE1,
  LAYER_DRAWINGSHEET_PAGEn,
} from '@ziroeda/common/layer_id.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';

let model: DS_DATA_MODEL;

beforeEach(() => {
  model = new DS_DATA_MODEL();
  DS_DATA_MODEL.SetAltInstance(model);
  model.SetupDrawEnvironment(new PAGE_INFO(PAGE_SIZE_TYPE.A4), drawSheetIUScale.IU_PER_MILS);
});

afterEach(() => DS_DATA_MODEL.SetAltInstance(null));

describe('SetupDrawEnvironment', () => {
  it('puts the corners at the margins of an A4 page, in mm, and 1000 IU per mm', () => {
    expect(model.m_WSunits2Iu).toBeCloseTo(1000, 9);
    expect(model.m_LT_Corner).toEqual({ x: 10, y: 10 });
    expect(model.m_RB_Corner.x).toBeCloseTo(287.0022, 9);
    expect(model.m_RB_Corner.y).toBeCloseTo(200.0072, 9);
  });
});

describe('corner anchoring', () => {
  it('measures each anchor inward from its own corner', () => {
    const item = new DS_DATA_ITEM(DS_DATA_ITEM.DS_SEGMENT);

    item.SetStart(10, 5, CORNER_ANCHOR.RB_CORNER);
    expect(item.GetStartPos().x).toBeCloseTo(277.0022, 9);
    expect(item.GetStartPos().y).toBeCloseTo(195.0072, 9);
    // KiROUND( 277.0022 * 1000 ), KiROUND( 195.0072 * 1000 )
    expect(item.GetStartPosIU()).toEqual({ x: 277002, y: 195007 });

    item.SetStart(10, 5, CORNER_ANCHOR.RT_CORNER);
    expect(item.GetStartPos().x).toBeCloseTo(277.0022, 9);
    expect(item.GetStartPos().y).toBeCloseTo(15, 9);

    item.SetStart(10, 5, CORNER_ANCHOR.LB_CORNER);
    expect(item.GetStartPos().x).toBeCloseTo(20, 9);
    expect(item.GetStartPos().y).toBeCloseTo(195.0072, 9);

    item.SetStart(10, 5, CORNER_ANCHOR.LT_CORNER);
    expect(item.GetStartPos()).toEqual({ x: 20, y: 15 });
  });

  it('steps each repeat by the increment before anchoring it', () => {
    const item = new DS_DATA_ITEM(DS_DATA_ITEM.DS_SEGMENT);
    item.SetStart(10, 5, CORNER_ANCHOR.LT_CORNER);
    item.m_IncrementVector = { x: 2, y: 3 };

    expect(item.GetStartPos(2)).toEqual({ x: 24, y: 21 });
  });

  it('moves the start back into anchor coordinates', () => {
    const item = new DS_DATA_ITEM(DS_DATA_ITEM.DS_SEGMENT);
    item.SetStart(0, 0, CORNER_ANCHOR.RB_CORNER);

    item.MoveStartPointTo({ x: 100, y: 50 });

    expect(item.m_Pos.m_Pos.x).toBeCloseTo(187.0022, 9);
    expect(item.m_Pos.m_Pos.y).toBeCloseTo(150.0072, 9);
    expect(item.GetStartPos().x).toBeCloseTo(100, 9);
  });

  it('moves the end of a segment but not of a text', () => {
    const seg = new DS_DATA_ITEM(DS_DATA_ITEM.DS_SEGMENT);
    seg.SetEnd(0, 0, CORNER_ANCHOR.LT_CORNER);
    seg.MoveEndPointTo({ x: 30, y: 40 });
    expect(seg.m_End.m_Pos).toEqual({ x: 20, y: 30 });

    const text = new DS_DATA_ITEM_TEXT('T');
    text.SetEnd(1, 1, CORNER_ANCHOR.LT_CORNER);
    text.MoveEndPointTo({ x: 30, y: 40 });
    expect(text.m_End.m_Pos).toEqual({ x: 1, y: 1 });
  });

  it('MoveTo carries the end with the start', () => {
    const seg = new DS_DATA_ITEM(DS_DATA_ITEM.DS_SEGMENT);
    seg.SetStart(0, 0, CORNER_ANCHOR.LT_CORNER);
    seg.SetEnd(10, 0, CORNER_ANCHOR.LT_CORNER);

    seg.MoveTo({ x: 15, y: 20 });

    expect(seg.GetStartPos()).toEqual({ x: 15, y: 20 });
    expect(seg.GetEndPos()).toEqual({ x: 25, y: 20 });
  });
});

describe('IsInsidePage and repeats', () => {
  it('drops the repeats of a segment whose END leaves the page', () => {
    const seg = new DS_DATA_ITEM(DS_DATA_ITEM.DS_SEGMENT);
    seg.SetStart(0, 0, CORNER_ANCHOR.LT_CORNER);
    seg.SetEnd(0, 100, CORNER_ANCHOR.LT_CORNER);
    seg.m_RepeatCount = 3;
    seg.m_IncrementVector = { x: 0, y: 50 };

    // end y = 10 + 100 + 50j: 110, 160, 210 > 200.0072.
    expect(seg.IsInsidePage(1)).toBe(true);
    expect(seg.IsInsidePage(2)).toBe(false);

    seg.SyncDrawItems(null, null);
    expect(seg.GetDrawItems().map((d) => d.GetIndexInPeer())).toEqual([0, 1]);
  });

  it('never drops repeat 0, even off the page', () => {
    const seg = new DS_DATA_ITEM(DS_DATA_ITEM.DS_RECT);
    seg.SetStart(-50, 0, CORNER_ANCHOR.LT_CORNER);
    seg.SetEnd(0, 0, CORNER_ANCHOR.LT_CORNER);

    seg.SyncDrawItems(null, null);
    expect(seg.GetDrawItems()).toHaveLength(1);
  });
});

describe('DS_DATA_ITEM_TEXT::ReplaceAntiSlashSequence', () => {
  it('turns \\n into a newline and \\\\ into one backslash', () => {
    const t = new DS_DATA_ITEM_TEXT('');

    t.m_FullText = 'a\\nb';
    expect(t.ReplaceAntiSlashSequence()).toBe(true);
    expect(t.m_FullText).toBe('a\nb');

    t.m_FullText = 'a\\\\b';
    expect(t.ReplaceAntiSlashSequence()).toBe(false);
    expect(t.m_FullText).toBe('a\\b');

    // a lone trailing backslash stops the scan and stays
    t.m_FullText = 'ab\\';
    expect(t.ReplaceAntiSlashSequence()).toBe(false);
    expect(t.m_FullText).toBe('ab\\');
  });

  it('increments the label of each repeat from the raw text', () => {
    const t = new DS_DATA_ITEM_TEXT('A1');
    t.m_IncrementLabel = 2;
    t.IncrementLabel(2 * t.m_IncrementLabel);
    expect(t.m_FullText).toBe('A5');
  });
});

describe('DS_DATA_ITEM_POLYGONS::SetBoundingBox', () => {
  it('holds the box in whole millimetres, the corners truncated', () => {
    const p = new DS_DATA_ITEM_POLYGONS();
    p.SetStart(0, 0, CORNER_ANCHOR.LT_CORNER);
    p.AppendCorner({ x: 0.6, y: 0.6 });
    p.AppendCorner({ x: 277.9, y: 0.6 });
    p.CloseContour();
    p.SetBoundingBox();

    // max x truncates to 277: 10 + 277 = 287 <= 287.0022, inside. Were the
    // corner kept at 277.9 the box would end at 287.9, outside.
    expect(p.IsInsidePage(0)).toBe(true);
  });
});

describe('DS_DRAW_ITEM_BASE::ViewGetLayers', () => {
  it('puts first-page-only and later-page items on their own layers', () => {
    const seg = new DS_DATA_ITEM(DS_DATA_ITEM.DS_SEGMENT);
    seg.SyncDrawItems(null, null);
    expect(seg.GetDrawItems()[0]!.ViewGetLayers()).toEqual([LAYER_DRAWINGSHEET]);

    seg.SetPage1Option(PAGE_OPTION.FIRST_PAGE_ONLY);
    expect(seg.GetDrawItems()[0]!.ViewGetLayers()).toEqual([LAYER_DRAWINGSHEET_PAGE1]);

    seg.SetPage1Option(PAGE_OPTION.SUBSEQUENT_PAGES);
    expect(seg.GetDrawItems()[0]!.ViewGetLayers()).toEqual([LAYER_DRAWINGSHEET_PAGEn]);
  });
});

describe('DS_DRAW_ITEM_RECT::HitTest', () => {
  const rect = new DS_DRAW_ITEM_RECT(null, 0, { x: 0, y: 0 }, { x: 1000, y: 500 }, 10);

  it('hits its sides within the accuracy plus half the pen', () => {
    expect(rect.HitTest({ x: 500, y: 8 }, 3)).toBe(true); // dist = 3 + 5
    expect(rect.HitTest({ x: 500, y: 10 }, 3)).toBe(false);
    expect(rect.HitTest({ x: 1004, y: 250 }, 0)).toBe(true);
  });

  it('does not hit its inside', () => {
    expect(rect.HitTest({ x: 500, y: 250 }, 3)).toBe(false);
  });

  it('a selection box inside the frame touches none of its sides', () => {
    expect(rect.HitTest(new BOX2I({ x: 100, y: 100 }, { x: 100, y: 100 }), false)).toBe(false);
    expect(rect.HitTest(new BOX2I({ x: 100, y: -10 }, { x: 100, y: 100 }), false)).toBe(true);
  });
});

describe('DS_DRAW_ITEM_LIST::BuildFullText', () => {
  it('resolves the page, the count and the title block', () => {
    const list = new DS_DRAW_ITEM_LIST(drawSheetIUScale);
    const tb = new TITLE_BLOCK();
    tb.SetTitle('Board');
    list.SetTitleBlock(tb);
    list.SetPageNumber('3');
    list.SetSheetCount(7);
    list.SetPaperFormat('A4');

    expect(list.BuildFullText('${#}/${##} ${TITLE} ${PAPER}')).toBe('3/7 Board A4');
  });

  it('keeps an unknown variable as it was written', () => {
    const list = new DS_DRAW_ITEM_LIST(drawSheetIUScale);
    expect(list.BuildFullText('${NOPE}')).toBe('${NOPE}');
  });
});

describe('the model and the file', () => {
  it('reads the default sheet and writes the same items back', () => {
    model.SetDefaultLayout();
    const n = model.GetCount();
    expect(n).toBeGreaterThan(10);

    const text = model.SaveInString();
    const again = new DS_DATA_MODEL();
    again.SetPageLayout(text);

    expect(again.GetCount()).toBe(n);
    expect(again.SaveInString()).toBe(text);
  });

  it('LoadDrawingSheet with no name is the default layout; a missing file says so', () => {
    const msg = { value: '' };
    expect(model.LoadDrawingSheet('', msg)).toBe(true);
    const n = model.GetCount();

    expect(model.LoadDrawingSheet('/x/missing.kicad_wks', msg, false, null)).toBe(false);
    expect(msg.value).toBe('File not found.');
    expect(model.GetCount()).toBe(n);
  });
});
