// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROPERTIES_FRAME` (pagelayout_editor/dialogs/properties_frame.cpp), the
 * engine the frame builds in `AttachCanvas`, driven through its controls as
 * the panel drives them. Every expectation is read off the C++:
 *
 *   validateMM (:175-178)  five call sites and no more - an item's pen width
 *       0..10 mm (:529), its text size 0..100 mm (:611, :614), the sheet's
 *       default line width 0..10 (:204), default text size 0.01..100
 *       (:207, :210) and default text thickness 0..5 (:213). Margins,
 *       positions, constraints and steps take whatever is typed.
 *   CopyPrmsFromItemToPanel (:223-393)  "%.3f" rotation, "%d" count / step
 *       text / DPI; which sizers show for which type; nothing selected hides
 *       the page (:226-233).
 *   CopyPrmsFromPanelToItem (:500-650)  Count < 1 becomes 1 and is written
 *       back (:558-570); DPI goes through SetPPI (:634-637).
 *   OnUpdateUI / OnAcceptPrms (:410-479)  an edit only marks the panel
 *       dirty; the idle then pushes ONE undo copy and OnModify()s.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BITMAP_BASE } from '@ziroeda/common/bitmap_base.js';
import {
  CORNER_ANCHOR,
  DS_DATA_ITEM,
  DS_DATA_ITEM_BITMAP,
  DS_DATA_ITEM_POLYGONS,
  DS_DATA_ITEM_TEXT,
  DS_ITEM_TYPE,
  PAGE_OPTION,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { DEFAULT_FONT_NAME, KICAD_FONT_NAME } from '@ziroeda/common/font/stroke_font.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import {
  CORNER_CHOICES,
  FONT_CHOICES,
  PAGE_OPTION_CHOICES,
  type PROPERTIES_FRAME,
} from '@ziroeda/pagelayout_editor/dialogs/properties_frame.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
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

function panelOf(h: Harness): PROPERTIES_FRAME {
  return h.frame.GetPropertiesFrame()!;
}

function mmFrame(): Harness {
  return makeHarness(EDA_UNITS_INT.MM);
}

const line = (): DS_DATA_ITEM => {
  const l = new DS_DATA_ITEM(DS_ITEM_TYPE.DS_SEGMENT);
  l.SetStart(10, 20, CORNER_ANCHOR.LT_CORNER);
  l.SetEnd(30, 40, CORNER_ANCHOR.RT_CORNER);
  return l;
};

describe('validateMM: the five checked fields', () => {
  it('refuses an item pen width over 10 mm, names it, and leaves the item alone', () => {
    const h = mmFrame();
    const p = panelOf(h);
    const l = line();
    l.m_LineWidth = 0.3;
    p.CopyPrmsFromItemToPanel(l);

    p.m_lineWidth.SetText('10.5');
    p.CopyPrmsFromPanelToItem(l);

    expect(l.m_LineWidth).toBe(0.3);
    expect(h.host.errors.map((e) => e.text)).toEqual(['Line width must be less than 10 mm.']);

    p.m_lineWidth.SetText('10');
    p.CopyPrmsFromPanelToItem(l);
    expect(l.m_LineWidth).toBe(10);
  });

  it('refuses an item text size over 100 mm but takes 0, "use the default"', () => {
    const h = mmFrame();
    const p = panelOf(h);
    const t = new DS_DATA_ITEM_TEXT('T');
    p.CopyPrmsFromItemToPanel(t);

    p.m_textSizeX.SetText('0');
    p.m_textSizeY.SetText('100.5');
    p.CopyPrmsFromPanelToItem(t);

    expect(t.m_TextSize.x).toBe(0);
    expect(t.m_TextSize.y).toBe(0);
    expect(h.host.errors.map((e) => e.text)).toEqual(['Text height must be less than 100 mm.']);
  });

  it('refuses a 0 DEFAULT text size - there is no further default', () => {
    const h = mmFrame();
    const p = panelOf(h);
    p.CopyPrmsFromGeneralToPanel();

    p.m_defaultTextSizeX.SetText('0');
    p.CopyPrmsFromPanelToGeneral();

    expect(model.m_DefaultTextSize.x).toBe(1.5);
    expect(h.host.errors.map((e) => e.text)).toEqual(['Text width must be at least 0.01 mm.']);
  });

  it('checks the default line width 0..10 and the default text thickness 0..5', () => {
    const h = mmFrame();
    const p = panelOf(h);
    p.CopyPrmsFromGeneralToPanel();

    p.m_defaultLineWidth.SetText('11');
    p.m_defaultTextThickness.SetText('6');
    p.CopyPrmsFromPanelToGeneral();

    expect(model.m_DefaultLineWidth).toBe(0.15);
    expect(model.m_DefaultTextThickness).toBe(0.15);
    expect(h.host.errors.map((e) => e.text)).toEqual([
      'Line thickness must be less than 10 mm.',
      'Text thickness must be less than 5 mm.',
    ]);
  });

  it('names the limit in the frame’s unit', () => {
    const h = makeHarness(EDA_UNITS_INT.MILS);
    const p = panelOf(h);
    const l = line();
    p.CopyPrmsFromItemToPanel(l);

    p.m_lineWidth.SetText('400');
    p.CopyPrmsFromPanelToItem(l);

    // 10 mm = 393.70079 mils, StringFromValue's "%.5f" trimmed.
    expect(h.host.errors[0]?.text).toBe('Line width must be less than 393.70079 mils.');
  });
});

describe('the frame is every binder’s UNITS_PROVIDER (properties_frame.cpp:57-79)', () => {
  it('a units switch re-reads every field in the new unit', () => {
    const h = mmFrame();
    const p = panelOf(h);
    const l = line();

    h.mgr.RunAction(ACTIONS.milsUnits);
    p.CopyPrmsFromItemToPanel(l);

    // 10 mm = 393.70079 mils ("%.5f" trimmed, eda_units.cpp StringFromValue).
    expect(p.m_textPosX.GetUnits()).toBe('mils');
    expect(p.m_textPosX.GetText()).toBe('393.70079');
  });
});

describe('the fields upstream does NOT check', () => {
  it('takes any page margin, position, constraint or step', () => {
    const h = mmFrame();
    const p = panelOf(h);
    const t = new DS_DATA_ITEM_TEXT('T');
    p.CopyPrmsFromGeneralToPanel();
    p.CopyPrmsFromItemToPanel(t);

    p.m_textLeftMargin.SetText('500');
    p.m_textPosX.SetText('-900');
    p.m_constraintX.SetText('1000');
    p.m_textStepY.SetText('-400');
    p.CopyPrmsFromPanelToGeneral();
    p.CopyPrmsFromPanelToItem(t);

    expect(model.GetLeftMargin()).toBe(500);
    expect(t.m_Pos.m_Pos.x).toBe(-900);
    expect(t.m_BoundingBoxSize.x).toBe(1000);
    expect(t.m_IncrementVector.y).toBe(-400);
    expect(h.host.errors).toEqual([]);
  });
});

describe('CopyPrmsFromItemToPanel', () => {
  it('with nothing selected hides the whole Item Properties page', () => {
    const p = panelOf(mmFrame());

    p.CopyPrmsFromItemToPanel(line());
    expect(p.m_showItemProperties).toBe(true);

    p.CopyPrmsFromItemToPanel(null);
    expect(p.m_showItemProperties).toBe(false);
  });

  it('prints the four plain fields with their own Printf formats', () => {
    const p = panelOf(mmFrame());
    const t = new DS_DATA_ITEM_TEXT('T');
    t.m_Orient = 0;
    t.m_IncrementLabel = 3;
    t.m_RepeatCount = 2;

    p.CopyPrmsFromItemToPanel(t);

    expect(p.m_textCtrlRotation).toBe('0.000');
    expect(p.m_textCtrlTextIncrement).toBe('3');
    expect(p.m_textCtrlRepeatCount).toBe('2');

    const bmp = new DS_DATA_ITEM_BITMAP(new BITMAP_BASE());
    p.CopyPrmsFromItemToPanel(bmp);
    // GetPPI() = 300 / scale 1 (ds_data_item.cpp:772-778).
    expect(p.m_textCtrlBitmapDPI).toBe('300');
  });

  it('shows each type the rows it has, and no others (:356-379)', () => {
    const p = panelOf(mmFrame());
    const shown = (): string[] =>
      [
        p.m_showTextOptions && 'text',
        p.m_showSyntaxHelpLink && 'help',
        p.m_showEndPosition && 'end',
        p.m_lineWidth.IsShown() && 'width',
        p.m_showRotation && 'rotation',
        p.m_showBitmapDPI && 'dpi',
        p.m_showIncLabel && 'steptext',
      ].filter((s): s is string => typeof s === 'string');

    p.CopyPrmsFromItemToPanel(new DS_DATA_ITEM_TEXT('T'));
    expect(shown()).toEqual(['text', 'help', 'width', 'rotation', 'steptext']);

    p.CopyPrmsFromItemToPanel(line());
    expect(shown()).toEqual(['end', 'width']);

    p.CopyPrmsFromItemToPanel(new DS_DATA_ITEM(DS_ITEM_TYPE.DS_RECT));
    expect(shown()).toEqual(['end', 'width']);

    p.CopyPrmsFromItemToPanel(new DS_DATA_ITEM_POLYGONS());
    expect(shown()).toEqual(['width', 'rotation']);

    p.CopyPrmsFromItemToPanel(new DS_DATA_ITEM_BITMAP(new BITMAP_BASE()));
    expect(shown()).toEqual(['dpi']);
  });

  it('writes the class name alone, and the anchors as the combo rows', () => {
    const p = panelOf(mmFrame());

    p.CopyPrmsFromItemToPanel(line());

    expect(p.m_staticTextType).toBe('Line');
    // LT_CORNER is row 1 and RT_CORNER row 0 (:251-257, :263-269).
    expect(CORNER_CHOICES[p.m_comboBoxCornerPos]).toBe('Upper Left');
    expect(CORNER_CHOICES[p.m_comboBoxCornerEnd]).toBe('Upper Right');
    expect(p.m_textPosX.GetText()).toBe('10');
    expect(p.m_textEndY.GetText()).toBe('40');
  });
});

describe('the three choices, as properties_frame_base.cpp words them', () => {
  it('page option, corners and fonts', () => {
    expect(PAGE_OPTION_CHOICES).toEqual([
      'Show on all pages',
      'First page only',
      'Subsequent pages only',
    ]);
    expect(CORNER_CHOICES).toEqual(['Upper Right', 'Upper Left', 'Lower Right', 'Lower Left']);
    // FONT_CHOICE's two KiCad rows, separate entries (font_choice.cpp:240-258).
    expect(FONT_CHOICES).toEqual([DEFAULT_FONT_NAME, KICAD_FONT_NAME]);
  });

  it('Default Font is no m_Font; KiCad Font is the stroke font by name', () => {
    const p = panelOf(mmFrame());
    const t = new DS_DATA_ITEM_TEXT('T');
    p.CopyPrmsFromItemToPanel(t);
    expect(p.m_fontCtrl).toBe(0);

    p.m_fontCtrl = 1;
    p.CopyPrmsFromPanelToItem(t);
    expect(t.m_Font?.GetName()).toBe(KICAD_FONT_NAME);

    p.CopyPrmsFromItemToPanel(t);
    expect(p.m_fontCtrl).toBe(1);

    p.m_fontCtrl = 0;
    p.CopyPrmsFromPanelToItem(t);
    expect(t.m_Font).toBeNull();
  });

  it('the page option combo maps to PAGE_OPTION both ways', () => {
    const p = panelOf(mmFrame());
    const l = line();
    p.CopyPrmsFromItemToPanel(l);

    p.m_choicePageOpt = 2;
    p.CopyPrmsFromPanelToItem(l);
    expect(l.GetPage1Option()).toBe(PAGE_OPTION.SUBSEQUENT_PAGES);

    l.SetPage1Option(PAGE_OPTION.FIRST_PAGE_ONLY);
    p.CopyPrmsFromItemToPanel(l);
    expect(p.m_choicePageOpt).toBe(1);
  });
});

describe('CopyPrmsFromPanelToItem', () => {
  it('a Count below 1 becomes 1, in the item AND the field; 500 is taken', () => {
    const p = panelOf(mmFrame());
    const l = line();
    p.CopyPrmsFromItemToPanel(l);

    p.m_textCtrlRepeatCount = '0';
    p.CopyPrmsFromPanelToItem(l);
    expect(l.m_RepeatCount).toBe(1);
    expect(p.m_textCtrlRepeatCount).toBe('1');

    // The 1..100 range is the reader's (drawing_sheet_parser.cpp:429), not the panel's.
    p.m_textCtrlRepeatCount = '500';
    p.CopyPrmsFromPanelToItem(l);
    expect(l.m_RepeatCount).toBe(500);
  });

  it('Bitmap DPI goes through SetPPI: the scale changes, GetPPI reads it back', () => {
    const p = panelOf(mmFrame());
    const bmp = new DS_DATA_ITEM_BITMAP(new BITMAP_BASE());
    p.CopyPrmsFromItemToPanel(bmp);

    p.m_textCtrlBitmapDPI = '600';
    p.CopyPrmsFromPanelToItem(bmp);

    expect(bmp.m_ImageBitmap!.GetScale()).toBe(0.5);
    expect(bmp.GetPPI()).toBe(600);

    // `if( msg.ToLong( &value ) )`: not a whole number leaves the item alone.
    p.m_textCtrlBitmapDPI = '12.5';
    p.CopyPrmsFromPanelToItem(bmp);
    expect(bmp.GetPPI()).toBe(600);
  });

  it('a polygon’s rotation is an angle in degrees', () => {
    const p = panelOf(mmFrame());
    const poly = new DS_DATA_ITEM_POLYGONS();
    p.CopyPrmsFromItemToPanel(poly);

    p.m_textCtrlRotation = '45';
    p.CopyPrmsFromPanelToItem(poly);

    expect(poly.m_Orient.AsDegrees()).toBe(45);
  });
});

describe('OnUpdateUI -> OnAcceptPrms', () => {
  it('an edit applies on the idle, as ONE undo entry, and modifies the sheet', async () => {
    const h = mmFrame();
    model.ClearList();
    const l = line();
    model.Append(l);
    h.frame.HardRedraw();
    h.frame.ClearUndoRedoList();
    h.mgr.GetTool(PL_SELECTION_TOOL)!.AddItemToSel(l.GetDrawItems()[0]!);
    const p = panelOf(h);

    p.m_textPosX.SetText('12');
    p.onTextFocusLost();
    // Nothing yet: the panel is only dirty.
    expect(l.m_Pos.m_Pos.x).toBe(10);

    p.OnUpdateUI();
    p.OnUpdateUI(); // the flag is cleared: a second idle does not accept again
    await settle();

    const accepted = model.GetItem(0)!;
    expect(accepted.m_Pos.m_Pos.x).toBe(12);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
    expect(h.frame.IsContentModified()).toBe(true);
  });

  it('Set to Default restores 1.5 mm text and 0.15 mm pens', () => {
    const h = mmFrame();
    const p = panelOf(h);
    model.m_DefaultTextSize = { x: 3, y: 3 };
    model.m_DefaultLineWidth = 0.5;

    p.OnSetDefaultValues();

    expect(model.m_DefaultTextSize).toEqual({ x: 1.5, y: 1.5 });
    expect(model.m_DefaultLineWidth).toBe(0.15);
    expect(model.m_DefaultTextThickness).toBe(0.15);
    expect(p.m_defaultTextSizeX.GetText()).toBe('1.5');
  });

  it('Syntax Help is HTML_MESSAGE_BOX "Predefined Keywords" with the keyword list', () => {
    const h = mmFrame();

    panelOf(h).ShowHelp();

    const box = h.host.htmlBoxes[0]!;
    expect(box.caption).toBe('Predefined Keywords');
    expect(box.list[0]).toBe('KICAD_VERSION');
    expect(box.list).toContain('# (sheet number)');
    expect(box.list).toHaveLength(13);
  });
});
