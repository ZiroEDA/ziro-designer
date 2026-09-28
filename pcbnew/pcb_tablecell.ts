// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_tablecell.h` / `.cpp`: `PCB_TABLECELL`, a `PCB_TEXTBOX` used as
 * one cell of a `PCB_TABLE` (`pcb_table.ts`).
 *
 * Not here: `PCB_TABLECELL_DESC`, the `PROPERTY_MANAGER` registration (below
 * the class, same as upstream keeps it in this file).
 */

import { ResolveTextVars, type TextVarResolverFn } from '@ziroeda/common/common.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import { EDA_SHAPE } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import type { OutStr } from '@ziroeda/common/font/font.js';
import { IsBackLayer } from '@ziroeda/common/layer_id.js';
import {
  PROPERTY,
  PROPERTY_DISPLAY,
  TYPE_CAST,
  TYPE_INT,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { KIUI_EllipsizeStatusText } from '@ziroeda/common/widgets/ui_common.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { INT_MAX } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, sub } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { BOARD_ITEM } from './board_item.js';
import { PCB_SHAPE } from './pcb_shape.js';
import { PCB_TEXTBOX } from './pcb_textbox.js';
import type { PCB_TABLE } from './pcb_table.js';

function isBoardItem(a: unknown): a is BOARD_ITEM {
  return (
    typeof (a as BOARD_ITEM).Type === 'function' && typeof (a as BOARD_ITEM).GetLayer === 'function'
  );
}

export class PCB_TABLECELL extends PCB_TEXTBOX {
  protected m_colSpan: number;
  protected m_rowSpan: number;

  constructor(aParent: BOARD_ITEM | null) {
    super(aParent, KICAD_T.PCB_TABLECELL_T);
    this.m_colSpan = 1;
    this.m_rowSpan = 1;

    const board = this.GetBoard();

    if (board) this.SetMirrored(board.IsBackLayer(aParent!.GetLayer()));
    else this.SetMirrored(IsBackLayer(aParent!.GetLayer()));

    this.SetRectangleHeight(Math.trunc(INT_MAX / 2));
    this.SetRectangleWidth(Math.trunc(INT_MAX / 2));
  }

  /** `PCB_TABLECELL( const PCB_TABLECELL& )`: the compiler-generated copy, as a static. */
  static copyOfCell(aOther: PCB_TABLECELL): PCB_TABLECELL {
    const copy = new PCB_TABLECELL(aOther.GetParent());
    copy.assignCell(aOther);
    (copy as { m_Uuid: string }).m_Uuid = aOther.m_Uuid;
    return copy;
  }

  /** The compiler-generated `operator=`. */
  assignCell(aOther: PCB_TABLECELL): this {
    this.assignPcbTextbox(aOther);
    this.m_colSpan = aOther.m_colSpan;
    this.m_rowSpan = aOther.m_rowSpan;
    return this;
  }

  static override ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && KICAD_T.PCB_TABLECELL_T === aItem.Type();
  }

  override GetClass(): string {
    return 'PCB_TABLECELL';
  }

  override GetFriendlyName(): string {
    return 'Table Cell';
  }

  override Clone(): PCB_TABLECELL {
    return PCB_TABLECELL.copyOfCell(this);
  }

  override GetParentGroup(): EDA_GROUP | null {
    const parent = this.GetParent();

    return parent ? parent.GetParentGroup() : null;
  }

  GetRow(): number {
    const table = this.GetParent() as PCB_TABLE;

    for (let row = 0; row < table.GetRowCount(); ++row) {
      for (let col = 0; col < table.GetColCount(); ++col) {
        if (table.GetCell(row, col) === this) return row;
      }
    }

    return -1;
  }

  GetColumn(): number {
    const table = this.GetParent() as PCB_TABLE;

    for (let row = 0; row < table.GetRowCount(); ++row) {
      for (let col = 0; col < table.GetColCount(); ++col) {
        if (table.GetCell(row, col) === this) return col;
      }
    }

    return -1;
  }

  // @return the spreadsheet nomenclature for the cell (ie: B3 for 2nd column, 3rd row)
  GetAddr(): string {
    return `${String.fromCharCode('A'.charCodeAt(0) + (this.GetColumn() % 26))}${this.GetRow() + 1}`;
  }

  override GetShownText(aAllowExtraText: boolean, aDepth = 0): string {
    const parentFootprint = this.GetParentFootprint();
    const board = this.GetBoard();

    const tableCellResolver: TextVarResolverFn = (token) => {
      if (token.value === 'ROW') {
        token.value = `${this.GetRow() + 1}`; // 1-based
        return true;
      } else if (token.value === 'COL') {
        token.value = `${this.GetColumn() + 1}`; // 1-based
        return true;
      } else if (token.value === 'ADDR') {
        token.value = this.GetAddr();
        return true;
      } else if (token.value === 'LAYER') {
        token.value = this.GetLayerName();
        return true;
      }

      if (parentFootprint && parentFootprint.ResolveTextVar(token, aDepth + 1)) return true;

      if (board!.ResolveTextVar(token, aDepth + 1)) return true;

      return false;
    };

    let text = EDA_TEXT.prototype.GetShownText.call(this, aAllowExtraText, aDepth);

    if (this.HasTextVars()) text = ResolveTextVars(text, tableCellResolver, { value: aDepth });

    const font = this.GetDrawFont(null);
    const drawAngle = this.GetDrawRotation();
    const corners = this.GetCornersInSequence(drawAngle);
    let colWidth = EuclideanNormI(sub(corners[1]!, corners[0]!));

    if (this.GetTextAngle().IsHorizontal())
      colWidth -= this.GetMarginLeft() + this.GetMarginRight();
    else colWidth -= this.GetMarginTop() + this.GetMarginBottom();

    const wrapped: OutStr = { value: text };
    font.LinebreakText(
      wrapped,
      colWidth,
      this.GetTextSize(),
      this.GetEffectiveTextPenWidth(),
      this.IsBold(),
      this.IsItalic(),
    );
    text = wrapped.value;

    // Convert escape markers back to literal ${} and @{} for final display
    text = text.replaceAll('<<<ESC_DOLLAR:', '${');
    text = text.replaceAll('<<<ESC_AT:', '@{');

    return text;
  }

  GetColSpan(): number {
    return this.m_colSpan;
  }
  SetColSpan(aSpan: number): void {
    this.m_colSpan = aSpan;
  }

  GetRowSpan(): number {
    return this.m_rowSpan;
  }
  SetRowSpan(aSpan: number): void {
    this.m_rowSpan = aSpan;
  }

  GetRowHeight(): number {
    return (this.GetParent() as PCB_TABLE).GetRowHeight(this.GetRow());
  }

  SetRowHeight(aHeight: number): void {
    const table = this.GetParent() as PCB_TABLE;

    table.SetRowHeight(this.GetRow(), aHeight);
    table.Normalize();
  }

  GetColumnWidth(): number {
    return (this.GetParent() as PCB_TABLE).GetColWidth(this.GetColumn());
  }

  SetColumnWidth(aWidth: number): void {
    const table = this.GetParent() as PCB_TABLE;

    table.SetColWidth(this.GetColumn(), aWidth);
    table.Normalize();
  }

  override IsFilledForHitTesting(): boolean {
    return true;
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `Table cell ${this.GetAddr()}`;
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    aList.push(new MSG_PANEL_ITEM('Table Cell', this.GetAddr()));

    // Don't use GetShownText() here; we want to show the user the variable references
    aList.push(new MSG_PANEL_ITEM('Text', KIUI_EllipsizeStatusText(aFrame, this.GetText())));

    if (aFrame.GetName() === PCB_EDIT_FRAME_NAME && this.IsLocked())
      aList.push(new MSG_PANEL_ITEM('Status', 'Locked'));

    aList.push(new MSG_PANEL_ITEM('Layer', this.GetLayerName()));
    aList.push(new MSG_PANEL_ITEM('Mirror', this.IsMirrored() ? 'Yes' : 'No'));

    aList.push(
      new MSG_PANEL_ITEM(
        'Cell Width',
        aFrame.MessageTextFromValue(Math.abs(this.GetEnd().x - this.GetStart().x)),
      ),
    );
    aList.push(
      new MSG_PANEL_ITEM(
        'Cell Height',
        aFrame.MessageTextFromValue(Math.abs(this.GetEnd().y - this.GetStart().y)),
      ),
    );

    aList.push(new MSG_PANEL_ITEM('Font', this.GetFont() ? this.GetFont()!.GetName() : 'Default'));

    if (this.GetTextThickness())
      aList.push(
        new MSG_PANEL_ITEM(
          'Text Thickness',
          aFrame.MessageTextFromValue(this.GetEffectiveTextPenWidth()),
        ),
      );
    else aList.push(new MSG_PANEL_ITEM('Text Thickness', 'Auto'));

    aList.push(new MSG_PANEL_ITEM('Text Width', aFrame.MessageTextFromValue(this.GetTextWidth())));
    aList.push(
      new MSG_PANEL_ITEM('Text Height', aFrame.MessageTextFromValue(this.GetTextHeight())),
    );
  }

  override Similarity(aBoardItem: BOARD_ITEM | EDA_SHAPE): number {
    if (!(aBoardItem instanceof PCB_SHAPE) && !isBoardItem(aBoardItem))
      return EDA_SHAPE.prototype.Similarity.call(this, aBoardItem as EDA_SHAPE);

    const item = aBoardItem as BOARD_ITEM;

    if (item.Type() !== this.Type()) return 0.0;

    const other = item as PCB_TABLECELL;

    let similarity = 1.0;

    if (this.m_colSpan !== other.m_colSpan) similarity *= 0.9;

    if (this.m_rowSpan !== other.m_rowSpan) similarity *= 0.9;

    similarity *= PCB_TEXTBOX.prototype.Similarity.call(this, other);

    return similarity;
  }

  /** `operator==( const BOARD_ITEM& )`. */
  override equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_TABLECELL;

    return this.equalsCell(other);
  }

  /** `operator==( const PCB_TABLECELL& )`. */
  equalsCell(aOther: PCB_TABLECELL): boolean {
    return (
      this.m_colSpan === aOther.m_colSpan &&
      this.m_rowSpan === aOther.m_rowSpan &&
      this.equalsTextbox(aOther)
    );
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_TABLECELL_T);

    // std::swap( *this, *aImage ): every member of both classes.
    const image = aImage as PCB_TABLECELL;
    const mine = PCB_TABLECELL.copyOfCell(this);

    this.assignCell(image);
    (this as { m_Uuid: string }).m_Uuid = image.m_Uuid;
    image.assignCell(mine);
    (image as { m_Uuid: string }).m_Uuid = mine.m_Uuid;
  }
}

/**
 * `static struct PCB_TABLECELL_DESC` (pcbnew/pcb_tablecell.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_TABLECELL);

  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLECELL, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLECELL, BOARD_CONNECTED_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLECELL, PCB_TEXTBOX));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLECELL, PCB_SHAPE));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLECELL, EDA_SHAPE));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLECELL, EDA_TEXT));
  propMgr.InheritsAfter(PCB_TABLECELL, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_TABLECELL, BOARD_CONNECTED_ITEM);
  propMgr.InheritsAfter(PCB_TABLECELL, PCB_TEXTBOX);
  propMgr.InheritsAfter(PCB_TABLECELL, PCB_SHAPE);
  propMgr.InheritsAfter(PCB_TABLECELL, EDA_SHAPE);
  propMgr.InheritsAfter(PCB_TABLECELL, EDA_TEXT);

  propMgr.Mask(PCB_TABLECELL, BOARD_ITEM, 'Position X');
  propMgr.Mask(PCB_TABLECELL, BOARD_ITEM, 'Position Y');
  propMgr.Mask(PCB_TABLECELL, PCB_SHAPE, 'Layer');
  propMgr.Mask(PCB_TABLECELL, PCB_SHAPE, 'Soldermask');
  propMgr.Mask(PCB_TABLECELL, PCB_SHAPE, 'Soldermask Margin Override');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Corner Radius');

  propMgr.Mask(PCB_TABLECELL, BOARD_CONNECTED_ITEM, 'Net');

  propMgr.Mask(PCB_TABLECELL, PCB_TEXTBOX, 'Knockout');
  propMgr.Mask(PCB_TABLECELL, PCB_TEXTBOX, 'Border');
  propMgr.Mask(PCB_TABLECELL, PCB_TEXTBOX, 'Border Style');
  propMgr.Mask(PCB_TABLECELL, PCB_TEXTBOX, 'Border Width');

  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Start X');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Start Y');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'End X');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'End Y');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Shape');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Width');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Height');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Line Width');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Line Style');
  propMgr.Mask(PCB_TABLECELL, EDA_SHAPE, 'Line Color');

  propMgr.Mask(PCB_TABLECELL, EDA_TEXT, 'Orientation');
  propMgr.Mask(PCB_TABLECELL, EDA_TEXT, 'Hyperlink');
  propMgr.Mask(PCB_TABLECELL, EDA_TEXT, 'Color');

  const tableProps = 'Table';

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLECELL, number>(
      PCB_TABLECELL,
      'Column Width',
      'SetColumnWidth',
      'GetColumnWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLECELL, number>(
      PCB_TABLECELL,
      'Row Height',
      'SetRowHeight',
      'GetRowHeight',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    tableProps,
  );
})();
