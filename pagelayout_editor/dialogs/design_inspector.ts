// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/dialogs/design_inspector.cpp`: `DIALOG_INSPECTOR`, the
 * engine half — what the grid contains (`ReCreateDesignList`, :205-315) and
 * what a click does (`onCellClicked`, :338-354); `design_inspector_ui.tsx`
 * draws it.
 *
 * The grid is five columns (`COL_INDEX`, :178-186) with the headers
 * `-` / `Type` / `Count` / `Comment` / `Text`
 * (dialog_design_inspector_base.cpp:35-39), a 40 px row-label gutter carrying
 * wxGrid's own 1-based row numbers (:45), and a leading pseudo-row describing
 * the page rather than an item.
 */
import {
  type DS_DATA_ITEM,
  type DS_DATA_ITEM_TEXT,
  DS_ITEM_TYPE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { drawSheetIUScale } from '@ziroeda/common/eda_units.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';
import { PL_SELECTION_TOOL } from '../tools/pl_selection_tool.js';

/** The five `SetColLabelValue` strings, in `COL_INDEX` order. */
export const DS_INSPECTOR_COLUMNS: readonly string[] = ['-', 'Type', 'Count', 'Comment', 'Text'];

/** The title of an unsaved / built-in sheet (design_inspector.cpp:220). */
export const DS_INSPECTOR_DEFAULT_TITLE = '<default drawing sheet>';

export interface DsInspectorRow {
  /** wxGrid's row label: 1-based, gutter width 40 px. */
  number: number;
  /** COL_TYPENAME — `DS_DATA_ITEM::GetClassName`, or `Layout` on the root. */
  type: string;
  /** COL_REPEAT_NUMBER — `m_RepeatCount`, or `-` on the root. */
  count: string;
  /** COL_COMMENT — `m_Info`, or the page type name on the root. */
  comment: string;
  /** COL_TEXTSTRING — a text item's `m_TextBase`, or the page size on the root. */
  text: string;
  /**
   * Which sheet item the row is, or null for the root row.
   * `m_itemsList.push_back( nullptr )` (:238) is why `onCellClicked` returns
   * early on row 0: "this item is not a DS_DATA_ITEM, just a pseudo item".
   */
  itemIndex: number | null;
  /** COL_BITMAP's `BitmapGridCellRenderer` XPM. */
  icon: XpmIcon | undefined;
}

/**
 * `DIALOG_INSPECTOR` (design_inspector.cpp:189-354): the grid over the live
 * `DS_DATA_MODEL`, and the click that selects an item in the editor.
 */
export class DIALOG_INSPECTOR {
  private readonly m_editorFrame: PL_EDITOR_FRAME;
  /** `m_itemsList`: row -> item; row 0 is the page, a pseudo item. */
  private m_itemsList: (DS_DATA_ITEM | null)[] = [];
  private m_rows: DsInspectorRow[] = [];
  private m_title = '';
  /** `GetGridList()->SelectRow( row )`. */
  private m_selectedRow = -1;

  constructor(aParent: PL_EDITOR_FRAME) {
    this.m_editorFrame = aParent;
    this.ReCreateDesignList();
  }

  GetTitle(): string {
    return this.m_title;
  }

  GetRows(): readonly DsInspectorRow[] {
    return this.m_rows;
  }

  GetSelectedRow(): number {
    return this.m_selectedRow;
  }

  ReCreateDesignList(): void {
    const page_info = this.m_editorFrame.GetPageLayout().GetPageSettings();

    this.m_itemsList = [];
    this.m_rows = [];

    const drawingSheet = DS_DATA_MODEL.GetTheInstance();
    const name = fileNameGetName(this.m_editorFrame.GetCurrentFileName());

    this.m_title = name === '' ? DS_INSPECTOR_DEFAULT_TITLE : name;

    // The first item is the layout: Display info about the page: fmt, size...
    const page_sizeIU = this.m_editorFrame.GetPageSizeIU();
    this.m_rows.push({
      number: 1,
      type: 'Layout',
      count: '-',
      // Display page format name.
      comment: page_info.GetTypeAsString(),
      text:
        `Size: ${drawSheetIUScale.iuToMM(page_sizeIU.x).toFixed(1)}` +
        `x${drawSheetIUScale.iuToMM(page_sizeIU.y).toFixed(1)}mm`,
      itemIndex: null,
      icon: DS_ICON_ROOT,
    });
    this.m_itemsList.push(null); // this item is not a DS_DATA_ITEM, just a pseudo item

    // Now adding all current items
    drawingSheet.GetItems().forEach((item, i) => {
      this.m_rows.push({
        number: i + 2,
        type: item.GetClassName(),
        count: String(item.m_RepeatCount),
        // m_Info verbatim: an empty comment leaves an EMPTY cell.
        comment: item.m_Info,
        text: item.GetType() === DS_ITEM_TYPE.DS_TEXT ? (item as DS_DATA_ITEM_TEXT).m_TextBase : '',
        itemIndex: i,
        icon: iconForType(item.GetType()),
      });

      this.m_itemsList.push(item);
    });
  }

  SelectRow(aItem: DS_DATA_ITEM): void {
    // m_itemsList[0] is not a true DS_DATA_ITEM
    for (let row = 1; row < this.m_itemsList.length; ++row) {
      if (this.m_itemsList[row] === aItem) {
        this.m_selectedRow = row;
        break;
      }
    }
  }

  GetDrawingSheetDataItem(aRow: number): DS_DATA_ITEM | null {
    return aRow >= 0 && aRow < this.m_itemsList.length ? this.m_itemsList[aRow]! : null;
  }

  onCellClicked(aRow: number): void {
    this.m_selectedRow = aRow;

    const item = this.GetDrawingSheetDataItem(aRow);

    if (!item) return; // only DS_DATA_ITEM are returned.

    // Select this item in drawing sheet editor, and update the properties panel:
    const selectionTool = this.m_editorFrame.GetToolManager()!.GetTool(PL_SELECTION_TOOL)!;
    selectionTool.ClearSelection();
    const draw_item = item.GetDrawItems()[0];
    if (draw_item) selectionTool.AddItemToSel(draw_item);
    this.m_editorFrame.GetCanvas()!.Refresh();
    this.m_editorFrame.GetPropertiesFrame()?.CopyPrmsFromItemToPanel(item);
  }
}

/** `wxFileName( aPath ).GetName()`: the leaf without its extension. */
function fileNameGetName(aPath: string): string {
  const leaf = aPath.slice(aPath.lastIndexOf('/') + 1);
  const dot = leaf.lastIndexOf('.');

  return dot > 0 ? leaf.slice(0, dot) : leaf;
}

/** `ReCreateDesignList`'s switch on the item type (:243-263). */
function iconForType(aType: DS_ITEM_TYPE): XpmIcon | undefined {
  switch (aType) {
    case DS_ITEM_TYPE.DS_SEGMENT:
      return DS_ICON_LINE;
    case DS_ITEM_TYPE.DS_RECT:
      return DS_ICON_RECT;
    case DS_ITEM_TYPE.DS_TEXT:
      return DS_ICON_TEXT;
    case DS_ITEM_TYPE.DS_POLYPOLYGON:
      return DS_ICON_POLY;
    case DS_ITEM_TYPE.DS_BITMAP:
      return DS_ICON_IMG;
    default:
      return undefined;
  }
}

/**
 * The Design Inspector's type icons — the six XPMs `design_inspector.cpp:46-158`
 * hardcodes, transcribed pixel for pixel.
 *
 * These are DATA, not chrome: KiCad does not ask the theme for them and they are
 * not in its icon set either. They are six `static const char* …_xpm[]` arrays
 * declared at the top of that one file, each `"12 12 2 1"` with `" c None"` and
 * one colour. So they are mirrored here rather than redrawn, and the colours are
 * KiCad's own — teal for the page and a line, navy for a rectangle, maroon for
 * text and an image, green for a polygon. There is no palette behind that
 * choice to consult; it is just the table.
 *
 * `BitmapGridCellRenderer::Draw` (`:359-366`) blits one into `COL_BITMAP` at
 * `aRect.GetX() + 5, aRect.GetY() + 2`, over whatever the string renderer drew,
 * and the column's minimum width is `BITMAP_SIZE * 2` = 32 px (`:303-304`).
 *
 * The rows below are the literal XPM rows: `x` is the colour, a space is
 * transparent. Generated from the C++ rather than retyped, and checked by
 * `ds_inspector_icons.test.ts`, which re-reads the same arrays out of the
 * reference tree.
 */

/** One 12 x 12, two-colour XPM: its ink colour and its twelve pixel rows. */
export interface XpmIcon {
  color: string;
  rows: readonly string[];
}

/** `#define BITMAP_SIZE 16`; the column's minimum is twice it (`:303-304`). */
export const DS_INSPECTOR_BITMAP_SIZE = 16;

/** The XPM is 12 x 12 (`"12 12 2 1"`). */
export const DS_INSPECTOR_ICON_PX = 12;

/** `aDc.DrawBitmap( bm, aRect.GetX() + 5, aRect.GetY() + 2, true )` (`:365`). */
export const DS_INSPECTOR_ICON_OFFSET = { x: 5, y: 2 } as const;

/** `root_xpm` — the pseudo-row describing the page itself. */
export const DS_ICON_ROOT: XpmIcon = {
  /* [data] `x c #008080` in root_xpm, design_inspector.cpp. KiCad hardcodes
     this; it is not a theme colour and not in its icon set. */
  color: '#008080',
  rows: [
    '   xxxx     ',
    '     xxx    ',
    '      xxx   ',
    '       xxx  ',
    'xxxxxxxxxxx ',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxx ',
    '       xxx  ',
    '      xxx   ',
    '     xxx    ',
    '   xxxx     ',
    '            ',
  ],
};

/** `line_xpm` — DS_DATA_ITEM::DS_SEGMENT. */
export const DS_ICON_LINE: XpmIcon = {
  /* [data] `x c #008080` in line_xpm, design_inspector.cpp. KiCad hardcodes
     this; it is not a theme colour and not in its icon set. */
  color: '#008080',
  rows: [
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
  ],
};

/** `rect_xpm` — DS_DATA_ITEM::DS_RECT. */
export const DS_ICON_RECT: XpmIcon = {
  /* [data] `x c #000080` in rect_xpm, design_inspector.cpp. KiCad hardcodes
     this; it is not a theme colour and not in its icon set. */
  color: '#000080',
  rows: [
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
  ],
};

/** `text_xpm` — DS_DATA_ITEM::DS_TEXT. */
export const DS_ICON_TEXT: XpmIcon = {
  /* [data] `x c #800000` in text_xpm, design_inspector.cpp. KiCad hardcodes
     this; it is not a theme colour and not in its icon set. */
  color: '#800000',
  rows: [
    ' xxxxxxxxxx ',
    'xxxxxxxxxxxx',
    'xx   xx   xx',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '    xxxx    ',
    '   xxxxxx   ',
  ],
};

/** `poly_xpm` — DS_DATA_ITEM::DS_POLYPOLYGON. */
export const DS_ICON_POLY: XpmIcon = {
  /* [data] `x c #008000` in poly_xpm, design_inspector.cpp. KiCad hardcodes
     this; it is not a theme colour and not in its icon set. */
  color: '#008000',
  rows: [
    '     xx     ',
    '    xxxx    ',
    '   xxxxxx   ',
    '  xxxxxxxx  ',
    ' xxxxxxxxxx ',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    ' xxxxxxxxxx ',
    '  xxxxxxxx  ',
    '   xxxxxx   ',
    '    xxxx    ',
    '     xx     ',
  ],
};

/** `img_xpm` — DS_DATA_ITEM::DS_BITMAP. */
export const DS_ICON_IMG: XpmIcon = {
  /* [data] `x c #800000` in img_xpm, design_inspector.cpp. KiCad hardcodes
     this; it is not a theme colour and not in its icon set. */
  color: '#800000',
  rows: [
    '     xx     ',
    '   xxxxxx   ',
    ' xx      xx ',
    'xx        xx',
    'xx        xx',
    ' xx      xx ',
    '   xxxxxx   ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
  ],
};

/**
 * The horizontal runs of ink in an XPM, as `[x, y, width]` triples.
 *
 * A wxBitmap built from an XPM is blitted pixel for pixel, so the browser has to
 * draw the same pixels. Runs rather than one rect per pixel because a 12 x 12
 * icon is up to 144 nodes otherwise and these sit in every row of a grid; the
 * result is identical geometry, just fewer elements.
 */
export function xpmRuns(icon: XpmIcon): [number, number, number][] {
  const runs: [number, number, number][] = [];
  icon.rows.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      const ink = row[x] === 'x';
      if (ink && start < 0) start = x;
      else if (!ink && start >= 0) {
        runs.push([start, y, x - start]);
        start = -1;
      }
    }
  });
  return runs;
}
