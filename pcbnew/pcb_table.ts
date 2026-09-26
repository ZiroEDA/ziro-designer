// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_table.h` / `pcb_table.cpp` and `pcb_tablecell.h` /
 * `pcb_tablecell.cpp`: `PCB_TABLE`, a `BOARD_ITEM_CONTAINER` owning a grid of
 * `PCB_TABLECELL`s (each a `PCB_TEXTBOX`), with the border and separator
 * strokes drawn between them.
 *
 * Not here: `PCB_TABLE_DESC` / `PCB_TABLECELL_DESC`, the `PROPERTY_MANAGER`
 * registrations.
 */

import { ResolveTextVars, type TextVarResolverFn } from '@ziroeda/common/common.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/color4d.js';
import { PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import {
  type EDA_DRAW_FRAME_LIKE,
  type INSPECTOR,
  INSPECT_RESULT,
  RECURSE_MODE,
} from '@ziroeda/common/eda_item.js';
import { STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { EDA_SHAPE } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import type { OutStr } from '@ziroeda/common/font/font.js';
import {
  FLASHING,
  IsBackLayer,
  IsFrontLayer,
  GAL_LAYER_ID,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { type RENDER_SETTINGS, plotterRenderSettings } from '@ziroeda/common/render_settings.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  NO_SETTER,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_OPT_INT,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';

import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { KIUI_EllipsizeStatusText } from '@ziroeda/common/widgets/ui_common.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, ANGLE_180, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_ShapeHitTest } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  SHAPE_POLY_SET,
  TransformCircleToPolygon,
  TransformOvalToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX } from '@ziroeda/kimath/src/math/util.js';
import {
  EuclideanNormI,
  type VECTOR2I,
  add,
  equal,
  sub,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD_ITEM } from './board_item.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { ADD_MODE, BOARD_ITEM_CONTAINER, REMOVE_MODE } from './board_item_container.js';
import { PCB_SHAPE, type PCB_VIEW_FOR_LOD } from './pcb_shape.js';
import { PCB_TEXTBOX } from './pcb_textbox.js';

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

/** `std::map<int, int>` compared as a whole: the same keys with the same values. */
function mapEquals(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean {
  if (a.size !== b.size) return false;

  for (const [k, v] of a) {
    if (!b.has(k) || b.get(k) !== v) return false;
  }

  return true;
}

/** `m_colWidths[aCol]` on a `std::map`: a missing key reads as 0. */
function at(aMap: ReadonlyMap<number, number>, aKey: number): number {
  return aMap.get(aKey) ?? 0;
}

export class PCB_TABLE extends BOARD_ITEM_CONTAINER {
  protected m_strokeExternal: boolean;
  protected m_StrokeHeaderSeparator: boolean;
  protected m_borderStroke: STROKE_PARAMS;
  protected m_strokeRows: boolean;
  protected m_strokeColumns: boolean;
  protected m_separatorsStroke: STROKE_PARAMS;

  protected m_colCount: number;
  protected m_colWidths = new Map<number, number>();
  protected m_rowHeights = new Map<number, number>();
  protected m_cells: PCB_TABLECELL[] = [];

  constructor(aParent: BOARD_ITEM | null, aLineWidth: number) {
    super(aParent, KICAD_T.PCB_TABLE_T);
    this.m_strokeExternal = true;
    this.m_StrokeHeaderSeparator = true;
    this.m_borderStroke = new STROKE_PARAMS(aLineWidth, LINE_STYLE.DEFAULT, COLOR4D_UNSPECIFIED);
    this.m_strokeRows = true;
    this.m_strokeColumns = true;
    this.m_separatorsStroke = new STROKE_PARAMS(
      aLineWidth,
      LINE_STYLE.DEFAULT,
      COLOR4D_UNSPECIFIED,
    );
    this.m_colCount = 0;
  }

  /** `PCB_TABLE( const PCB_TABLE& aTable )`: the cells are deep-copied. */
  static copyOf(aTable: PCB_TABLE): PCB_TABLE {
    const copy = new PCB_TABLE(aTable.GetParent(), 0);
    BOARD_ITEM_CONTAINER.copyBase(copy, aTable);
    copy.m_strokeExternal = aTable.m_strokeExternal;
    copy.m_StrokeHeaderSeparator = aTable.m_StrokeHeaderSeparator;
    copy.m_borderStroke = aTable.m_borderStroke.clone();
    copy.m_strokeRows = aTable.m_strokeRows;
    copy.m_strokeColumns = aTable.m_strokeColumns;
    copy.m_separatorsStroke = aTable.m_separatorsStroke.clone();
    copy.m_colCount = aTable.m_colCount;
    copy.m_colWidths = new Map(aTable.m_colWidths);
    copy.m_rowHeights = new Map(aTable.m_rowHeights);

    for (const src of aTable.m_cells) copy.AddCell(PCB_TABLECELL.copyOfCell(src));

    return copy;
  }

  // If implemented, would need to copy m_cells list.
  // PCB_TABLE& operator=( const PCB_TABLE& ) = delete;

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && KICAD_T.PCB_TABLE_T === aItem.Type();
  }

  GetClass(): string {
    return 'PCB_TABLE';
  }

  SetStrokeExternal(aDoStroke: boolean): void {
    this.m_strokeExternal = aDoStroke;
  }
  StrokeExternal(): boolean {
    return this.m_strokeExternal;
  }

  SetStrokeHeaderSeparator(aDoStroke: boolean): void {
    this.m_StrokeHeaderSeparator = aDoStroke;
  }
  StrokeHeaderSeparator(): boolean {
    return this.m_StrokeHeaderSeparator;
  }

  SetBorderStroke(aParams: STROKE_PARAMS): void {
    this.m_borderStroke = aParams.clone();
  }
  GetBorderStroke(): STROKE_PARAMS {
    return this.m_borderStroke;
  }

  SetBorderWidth(aWidth: number): void {
    this.m_borderStroke.SetWidth(aWidth);
  }
  GetBorderWidth(): number {
    return this.m_borderStroke.GetWidth();
  }

  SetBorderStyle(aStyle: LINE_STYLE): void {
    this.m_borderStroke.SetLineStyle(aStyle);
  }
  GetBorderStyle(): LINE_STYLE {
    if (this.m_borderStroke.GetLineStyle() === LINE_STYLE.DEFAULT) return LINE_STYLE.SOLID;
    else return this.m_borderStroke.GetLineStyle();
  }

  SetBorderColor(aColor: Color4d): void {
    this.m_borderStroke.SetColor(aColor);
  }
  GetBorderColor(): Color4d {
    return this.m_borderStroke.GetColor();
  }

  SetSeparatorsStroke(aParams: STROKE_PARAMS): void {
    this.m_separatorsStroke = aParams.clone();
  }
  GetSeparatorsStroke(): STROKE_PARAMS {
    return this.m_separatorsStroke;
  }

  SetSeparatorsWidth(aWidth: number): void {
    this.m_separatorsStroke.SetWidth(aWidth);
  }
  GetSeparatorsWidth(): number {
    return this.m_separatorsStroke.GetWidth();
  }

  SetSeparatorsStyle(aStyle: LINE_STYLE): void {
    this.m_separatorsStroke.SetLineStyle(aStyle);
  }
  GetSeparatorsStyle(): LINE_STYLE {
    if (this.m_separatorsStroke.GetLineStyle() === LINE_STYLE.DEFAULT) return LINE_STYLE.SOLID;
    else return this.m_separatorsStroke.GetLineStyle();
  }

  SetSeparatorsColor(aColor: Color4d): void {
    this.m_separatorsStroke.SetColor(aColor);
  }
  GetSeparatorsColor(): Color4d {
    return this.m_separatorsStroke.GetColor();
  }

  SetStrokeColumns(aDoStroke: boolean): void {
    this.m_strokeColumns = aDoStroke;
  }
  StrokeColumns(): boolean {
    return this.m_strokeColumns;
  }

  SetStrokeRows(aDoStroke: boolean): void {
    this.m_strokeRows = aDoStroke;
  }
  StrokeRows(): boolean {
    return this.m_strokeRows;
  }

  override RunOnChildren(aFunction: (aItem: BOARD_ITEM) => void, aMode: RECURSE_MODE): void {
    for (const cell of this.m_cells) {
      aFunction(cell);

      if (aMode === RECURSE_MODE.RECURSE) cell.RunOnChildren(aFunction, aMode);
    }
  }

  override SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;

    for (const cell of this.m_cells) cell.SetLayer(aLayer);
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.Move(sub(aPos, this.GetPosition()));
  }

  override GetPosition(): VECTOR2I {
    if (this.m_cells.length === 0) return { x: 0, y: 0 }; // Return origin if table has no cells

    return this.m_cells[0]!.GetPosition();
  }

  GetEnd(): VECTOR2I {
    const tableSize: VECTOR2I = { x: 0, y: 0 };

    for (let ii = 0; ii < this.GetColCount(); ++ii) tableSize.x += this.GetColWidth(ii);

    for (let ii = 0; ii < this.GetRowCount(); ++ii) tableSize.y += this.GetRowHeight(ii);

    return add(this.GetPosition(), tableSize);
  }

  // For property manager:
  SetPositionX(x: number): void {
    this.SetPosition({ x, y: this.GetPosition().y });
  }
  SetPositionY(y: number): void {
    this.SetPosition({ x: this.GetPosition().x, y });
  }
  GetPositionX(): number {
    return this.GetPosition().x;
  }
  GetPositionY(): number {
    return this.GetPosition().y;
  }

  SetColCount(aCount: number): void {
    this.m_colCount = aCount;
  }
  GetColCount(): number {
    return this.m_colCount;
  }

  GetRowCount(): number {
    return Math.trunc(this.m_cells.length / this.m_colCount);
  }

  SetColWidth(aCol: number, aWidth: number): void {
    this.m_colWidths.set(aCol, aWidth);
  }
  GetColWidth(aCol: number): number {
    if (this.m_colWidths.has(aCol)) return this.m_colWidths.get(aCol)!;

    return 0;
  }

  SetRowHeight(aRow: number, aHeight: number): void {
    this.m_rowHeights.set(aRow, aHeight);
  }
  GetRowHeight(aRow: number): number {
    if (this.m_rowHeights.has(aRow)) return this.m_rowHeights.get(aRow)!;

    return 0;
  }

  GetCell(aRow: number, aCol: number): PCB_TABLECELL | null {
    const idx = aRow * this.m_colCount + aCol;

    if (idx < this.m_cells.length) return this.m_cells[idx]!;
    else return null;
  }

  GetCells(): PCB_TABLECELL[] {
    return [...this.m_cells];
  }

  AddCell(aCell: PCB_TABLECELL): void {
    this.m_cells.push(aCell);
    aCell.SetLayer(this.GetLayer());
    aCell.SetParent(this);
  }

  InsertCell(aIdx: number, aCell: PCB_TABLECELL): void {
    this.m_cells.splice(aIdx, 0, aCell);
    aCell.SetLayer(this.GetLayer());
    aCell.SetParent(this);
  }

  ClearCells(): void {
    this.m_cells = [];
  }

  DeleteMarkedCells(): void {
    this.m_cells = this.m_cells.filter((cell) => !(cell.GetFlags() & STRUCT_DELETED));
  }

  override Add(
    aItem: BOARD_ITEM,
    aMode: ADD_MODE = ADD_MODE.INSERT,
    aSkipConnectivity = false,
  ): void {
    console.assert(false, 'Use AddCell()/InsertCell() instead.');
  }

  override Remove(aItem: BOARD_ITEM, aMode: REMOVE_MODE = REMOVE_MODE.NORMAL): void {
    console.assert(false, 'Use DeleteMarkedCells() instead.');
  }

  override Normalize(): void {
    if (this.m_cells.length === 0) return;

    const cellAngle = this.m_cells[0]!.GetTextAngle();
    const cell0BBox = this.m_cells[0]!.GetBoundingBox();
    const stableCenter = cell0BBox.GetCenter();

    let cell0Width = at(this.m_colWidths, 0);
    let cell0Height = at(this.m_rowHeights, 0);

    if (this.m_cells[0]!.GetColSpan() > 1) {
      for (let ii = 1; ii < this.m_cells[0]!.GetColSpan(); ++ii)
        cell0Width += at(this.m_colWidths, ii);
    }

    if (this.m_cells[0]!.GetRowSpan() > 1) {
      for (let ii = 1; ii < this.m_cells[0]!.GetRowSpan(); ++ii)
        cell0Height += at(this.m_rowHeights, ii);
    }

    let localCell0Center: VECTOR2I = {
      x: Math.trunc(cell0Width / 2),
      y: Math.trunc(cell0Height / 2),
    };
    localCell0Center = RotatePoint(localCell0Center, cellAngle);

    if (!cellAngle.equals(ANGLE_0)) {
      for (const cell of this.m_cells) cell.Rotate(stableCenter, cellAngle.negate());
    }

    const unrotatedOrigin = sub(stableCenter, {
      x: Math.trunc(cell0Width / 2),
      y: Math.trunc(cell0Height / 2),
    });

    let y = unrotatedOrigin.y;

    for (let row = 0; row < this.GetRowCount(); ++row) {
      let x = unrotatedOrigin.x;
      const rowHeight = at(this.m_rowHeights, row);

      for (let col = 0; col < this.GetColCount(); ++col) {
        const colWidth = at(this.m_colWidths, col);
        const cell = this.GetCell(row, col);

        if (!cell) continue;

        let cellWidth = colWidth;
        let cellHeight = rowHeight;

        if (cell.GetColSpan() > 1 || cell.GetRowSpan() > 1) {
          for (let ii = col + 1; ii < col + cell.GetColSpan(); ++ii)
            cellWidth += at(this.m_colWidths, ii);

          for (let ii = row + 1; ii < row + cell.GetRowSpan(); ++ii)
            cellHeight += at(this.m_rowHeights, ii);
        }

        const pos: VECTOR2I = { x, y };
        const end: VECTOR2I = { x: x + cellWidth, y: y + cellHeight };

        if (!equal(cell.GetPosition(), pos)) {
          cell.SetPosition(pos);
          cell.ClearRenderCache();
        }

        if (!equal(cell.GetEnd(), end)) {
          cell.SetEnd(end);
          cell.ClearRenderCache();
        }

        x += colWidth;
      }

      y += rowHeight;
    }

    if (!cellAngle.equals(ANGLE_0)) {
      for (const cell of this.m_cells) cell.Rotate(stableCenter, cellAngle);
    }

    const newCell0BBox = this.m_cells[0]!.GetBoundingBox();
    const newCenter = newCell0BBox.GetCenter();

    if (!equal(newCenter, stableCenter)) {
      const correction = sub(stableCenter, newCenter);

      for (const cell of this.m_cells) cell.Move(correction);
    }
  }

  Autosize(): void {
    const extents: BOX2I[][] = [];

    for (let row = 0; row < this.GetRowCount(); ++row) {
      extents.push([]);

      for (let col = 0; col < this.GetColCount(); ++col) {
        const textPoly = new SHAPE_POLY_SET();
        this.GetCell(row, col)!.TransformTextToPolySet(
          textPoly,
          0,
          ARC_LOW_DEF,
          ERROR_LOC.ERROR_INSIDE,
        );
        extents[row]!.push(textPoly.BBox());
      }
    }

    for (let col = 0; col < this.GetColCount(); ++col) {
      let colWidth = 0;

      for (let row = 0; row < this.GetRowCount(); ++row) {
        const cell = this.GetCell(row, col)!;
        const margins = cell.GetMarginLeft() + cell.GetMarginRight();

        // std::max<int>( colWidth, extents.GetWidth() + ( margins * 1.5 ) )
        colWidth = Math.max(colWidth, Math.trunc(extents[row]![col]!.GetWidth() + margins * 1.5));
      }

      this.SetColWidth(col, colWidth);
    }

    for (let row = 0; row < this.GetRowCount(); ++row) {
      let rowHeight = 0;

      for (let col = 0; col < this.GetColCount(); ++col) {
        const cell = this.GetCell(row, col)!;
        const margins = cell.GetMarginLeft() + cell.GetMarginRight();

        rowHeight = Math.max(rowHeight, extents[row]![col]!.GetHeight() + margins);
      }

      this.SetRowHeight(row, rowHeight);
    }

    this.Normalize();
  }

  override Move(aMoveVector: VECTOR2I): void {
    for (const cell of this.m_cells) cell.Move(aMoveVector);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    if (this.GetCells().length === 0) return;

    for (const cell of this.m_cells) cell.Rotate(aRotCentre, aAngle);

    this.Normalize();
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    const originalBBox = this.GetBoundingBox();
    const targetPos: VECTOR2I = { x: 0, y: 0 };

    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      targetPos.x = 2 * aCentre.x - originalBBox.GetRight();
      targetPos.y = originalBBox.GetTop();
    } else {
      targetPos.x = originalBBox.GetLeft();
      targetPos.y = 2 * aCentre.y - originalBBox.GetBottom();
    }

    const originalAngle = this.m_cells[0]!.GetTextAngle().Clone();

    if (!originalAngle.equals(ANGLE_0)) this.Rotate(this.GetPosition(), originalAngle.negate());

    const tableOrigin = this.GetPosition();

    for (const cell of this.m_cells) cell.Flip(tableOrigin, aFlipDirection);

    const oldCells = [...this.m_cells];

    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) {
      let rowOffset = 0;

      for (let row = 0; row < this.GetRowCount(); ++row) {
        for (let col = 0; col < this.GetColCount(); ++col)
          this.m_cells[rowOffset + col] = oldCells[rowOffset + this.GetColCount() - 1 - col]!;

        rowOffset += this.GetColCount();
      }

      const newColWidths = new Map<number, number>();

      for (let col = 0; col < this.GetColCount(); ++col)
        newColWidths.set(col, at(this.m_colWidths, this.GetColCount() - 1 - col));

      this.m_colWidths = newColWidths;
    } else {
      // TOP_BOTTOM
      for (let row = 0; row < this.GetRowCount(); ++row) {
        for (let col = 0; col < this.GetColCount(); ++col) {
          const oldRow = this.GetRowCount() - 1 - row;
          this.m_cells[row * this.GetColCount() + col] =
            oldCells[oldRow * this.GetColCount() + col]!;
        }
      }

      const newRowHeights = new Map<number, number>();

      for (let row = 0; row < this.GetRowCount(); ++row)
        newRowHeights.set(row, at(this.m_rowHeights, this.GetRowCount() - 1 - row));

      this.m_rowHeights = newRowHeights;
    }

    this.SetLayer(this.GetBoard()!.FlipLayer(this.GetLayer()));

    this.Normalize();

    if (!originalAngle.equals(ANGLE_0)) this.Rotate(this.GetPosition(), originalAngle);

    const newBBox = this.GetBoundingBox();
    this.Move(sub(targetPos, newBBox.GetPosition()));

    let localWidth = 0;

    for (let col = 0; col < this.GetColCount(); ++col) localWidth += at(this.m_colWidths, col);

    let localHeight = 0;

    for (let row = 0; row < this.GetRowCount(); ++row) localHeight += at(this.m_rowHeights, row);

    const isNowOnFrontSide = IsFrontLayer(this.GetLayer());
    let translation: VECTOR2I = { x: 0, y: 0 };

    if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM) {
      translation.y = -localHeight;
    } else {
      // LEFT_RIGHT
      if (isNowOnFrontSide) translation.x = localWidth;
      else translation.x = -localWidth;
    }

    translation = RotatePoint(translation, originalAngle);
    this.Move(translation);
  }

  override Mirror(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // Mirror is Flip with the layer restored. TOP_BOTTOM needs a 180 deg pre-rotation
    // because rotate-then-LR-flip equals TB-flip.
    const origLayer = this.GetLayer();
    const origCellLayers: PCB_LAYER_ID[] = [];

    for (const cell of this.m_cells) origCellLayers.push(cell.GetLayer());

    if (aFlipDirection === FLIP_DIRECTION.TOP_BOTTOM) this.Rotate(aCentre, ANGLE_180);

    this.Flip(aCentre, FLIP_DIRECTION.LEFT_RIGHT);

    this.SetLayer(origLayer);

    for (let i = 0; i < this.m_cells.length; ++i) this.m_cells[i]!.SetLayer(origCellLayers[i]!);
  }

  override GetBoundingBox(): BOX2I {
    // Note: a table with no cells is not allowed
    const bbox = this.m_cells[0]!.GetBoundingBox();
    bbox.Merge(this.m_cells[this.m_cells.length - 1]!.GetBoundingBox());
    return bbox;
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    // Hide the locked shadow when the table's own layer is not shown
    if (aLayer === GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW && !aView!.IsLayerVisible(this.m_layer))
      return PCB_TABLE.LOD_HIDE;

    return PCB_TABLE.LOD_SHOW;
  }

  DrawBorders(aCallback: (aPt1: VECTOR2I, aPt2: VECTOR2I, aStroke: STROKE_PARAMS) => void): void {
    const drawAngle = this.GetCell(0, 0)!.GetDrawRotation();
    const topLeft = this.GetCell(0, 0)!.GetCornersInSequence(drawAngle);
    const bottomLeft = this.GetCell(this.GetRowCount() - 1, 0)!.GetCornersInSequence(drawAngle);
    const topRight = this.GetCell(0, this.GetColCount() - 1)!.GetCornersInSequence(drawAngle);
    const bottomRight = this.GetCell(
      this.GetRowCount() - 1,
      this.GetColCount() - 1,
    )!.GetCornersInSequence(drawAngle);
    let stroke = new STROKE_PARAMS();

    for (let col = 0; col < this.GetColCount() - 1; ++col) {
      for (let row = 0; row < this.GetRowCount(); ++row) {
        if (row === 0 && this.StrokeHeaderSeparator()) stroke = this.GetBorderStroke();
        else if (this.StrokeColumns()) stroke = this.GetSeparatorsStroke();
        else continue;

        const cell = this.GetCell(row, col)!;

        if (cell.GetColSpan() === 0) continue;

        if (col + cell.GetColSpan() === this.GetColCount()) continue;

        const corners = cell.GetCornersInSequence(drawAngle);

        if (corners.length === 4) aCallback(corners[1]!, corners[2]!, stroke);
      }
    }

    for (let row = 0; row < this.GetRowCount() - 1; ++row) {
      if (row === 0 && this.StrokeHeaderSeparator()) stroke = this.GetBorderStroke();
      else if (this.StrokeRows()) stroke = this.GetSeparatorsStroke();
      else continue;

      for (let col = 0; col < this.GetColCount(); ++col) {
        const cell = this.GetCell(row, col)!;

        if (cell.GetRowSpan() === 0) continue;

        if (row + cell.GetRowSpan() === this.GetRowCount()) continue;

        const corners = cell.GetCornersInSequence(drawAngle);

        if (corners.length === 4) aCallback(corners[2]!, corners[3]!, stroke);
      }
    }

    if (this.StrokeExternal() && this.GetBorderStroke().GetWidth() >= 0) {
      aCallback(topLeft[0]!, topRight[1]!, this.GetBorderStroke());
      aCallback(topRight[1]!, bottomRight[2]!, this.GetBorderStroke());
      aCallback(bottomRight[2]!, bottomLeft[3]!, this.GetBorderStroke());
      aCallback(bottomLeft[3]!, topLeft[0]!, this.GetBorderStroke());
    }
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    const angle = this.GetCell(0, 0)!.GetDrawRotation();
    const topLeft = this.GetCell(0, 0)!.GetCornersInSequence(angle);
    const bottomLeft = this.GetCell(this.GetRowCount() - 1, 0)!.GetCornersInSequence(angle);
    const topRight = this.GetCell(0, this.GetColCount() - 1)!.GetCornersInSequence(angle);
    const bottomRight = this.GetCell(
      this.GetRowCount() - 1,
      this.GetColCount() - 1,
    )!.GetCornersInSequence(angle);

    const shape = new SHAPE_COMPOUND();
    const pts = new SHAPE_LINE_CHAIN();

    pts.Append(topLeft[3]!);
    pts.Append(topRight[2]!);
    pts.Append(bottomRight[2]!);
    pts.Append(bottomLeft[3]!);

    shape.AddShape(new SHAPE_SIMPLE(pts));

    this.DrawBorders((ptA: VECTOR2I, ptB: VECTOR2I, stroke: STROKE_PARAMS) => {
      shape.AddShape(new SHAPE_SEGMENT(ptA, ptB, stroke.GetWidth()));
    });

    return shape;
  }

  override TransformShapeToPolygon(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC,
    aIgnoreLineWidth = false,
  ): void {
    let gap = aClearance;

    if (this.StrokeColumns() || this.StrokeRows())
      gap = Math.max(gap, aClearance + Math.trunc(this.GetSeparatorsStroke().GetWidth() / 2));

    if (this.StrokeExternal() || this.StrokeHeaderSeparator())
      gap = Math.max(gap, aClearance + Math.trunc(this.GetBorderStroke().GetWidth() / 2));

    for (const cell of this.m_cells)
      cell.TransformShapeToPolygon(aBuffer, aLayer, gap, aMaxError, aErrorLoc, false);
  }

  /**
   * Convert graphic items (segments and texts) to a set of polygonal shapes
   */
  TransformGraphicItemsToPolySet(
    aBuffer: SHAPE_POLY_SET,
    aMaxError: number,
    aErrorLoc: ERROR_LOC,
    aRenderSettings: RENDER_SETTINGS | null,
  ): void {
    // Convert graphic items (segments and texts) to a set of polygonal shapes
    // aRenderSettings is used to draw lines when line style != LINE_STYLE::SOLID, so
    // if nullptr line style will be ignored
    this.DrawBorders((ptA: VECTOR2I, ptB: VECTOR2I, stroke: STROKE_PARAMS) => {
      const lineWidth = stroke.GetWidth();
      const lineStyle = stroke.GetLineStyle();

      if (lineStyle <= LINE_STYLE.SOLID /* FIRST_TYPE */ || aRenderSettings === null)
        TransformOvalToPolygon(aBuffer, ptA, ptB, lineWidth, aMaxError, aErrorLoc);
      else {
        const seg = new SHAPE_SEGMENT(ptA, ptB);
        // KIGFX::PCB_RENDER_SETTINGS defaultRenderSettings -- PCB_RENDER_SETTINGS pending (#636 stage 5)
        const defaultRenderSettings = plotterRenderSettings();
        let currSettings: RENDER_SETTINGS | null = aRenderSettings;

        if (currSettings === null) currSettings = defaultRenderSettings;

        STROKE_PARAMS.Stroke(
          seg,
          lineStyle,
          lineWidth,
          currSettings,
          (a: VECTOR2I, b: VECTOR2I) => {
            if (equal(a, b))
              TransformCircleToPolygon(aBuffer, a, Math.trunc(lineWidth / 2), aMaxError, aErrorLoc);
            else
              TransformOvalToPolygon(
                aBuffer,
                { x: a.x + 1, y: a.y + 1 }, // VECTOR2I + int: both coordinates
                b,
                lineWidth,
                aMaxError,
                aErrorLoc,
              );
          },
        );
      }
    });

    for (const cell of this.m_cells) {
      cell.TransformTextToPolySet(aBuffer, 0, aMaxError, ERROR_LOC.ERROR_INSIDE);
    }
  }

  /**
   * Convert the TABLE shape to a polyset. details will be included.
   *
   * @param aBuffer a buffer to store the polygon.
   * @param aClearance the clearance around the pad.
   * @param aError the maximum deviation from true circle.
   * @param aErrorLoc should the approximation error be placed outside or inside the polygon?
   * @param aRenderSettings used to plot outlines with not solid segments like dashed lines.
   * If null, lines like dashed will be converted as SOLID
   */
  override TransformShapeToPolySet(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC,
    aRenderSettings: RENDER_SETTINGS | null = null,
  ): void {
    if (aClearance <= 0)
      this.TransformGraphicItemsToPolySet(aBuffer, aMaxError, aErrorLoc, aRenderSettings);
    else {
      const tmp = new SHAPE_POLY_SET();
      this.TransformGraphicItemsToPolySet(tmp, aMaxError, aErrorLoc, aRenderSettings);
      tmp.Inflate(aClearance, CornerStrategy.CHAMFER_ALL_CORNERS, aMaxError);
      aBuffer.Append(tmp);
    }
  }

  override Visit(
    aInspector: INSPECTOR,
    aTestData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.PCB_TABLE_T) {
        if (INSPECT_RESULT.QUIT === aInspector(this, aTestData)) return INSPECT_RESULT.QUIT;
      }

      if (scanType === KICAD_T.PCB_TABLECELL_T) {
        for (const cell of this.m_cells) {
          if (INSPECT_RESULT.QUIT === aInspector(cell, this)) return INSPECT_RESULT.QUIT;
        }
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    // Symbols are searchable via the child field and pin item text.
    return false;
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return `${this.m_colCount} column table`;
  }

  override GetMenuImage(): string {
    return 'table'; // BITMAPS::table
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) {
      const rect = a.Clone();
      rect.Inflate(c ?? 0);

      if (b as boolean) return rect.Contains(this.GetBoundingBox());

      return rect.Intersects(this.GetBoundingBox());
    }

    if (a instanceof SHAPE_LINE_CHAIN)
      return KIGEOM_ShapeHitTest(a, this.GetEffectiveShape(), b as boolean);

    const rect = this.GetBoundingBox();
    rect.Inflate((b as number | undefined) ?? 0);
    return rect.Contains(a);
  }

  override Clone(): PCB_TABLE {
    return PCB_TABLE.copyOf(this);
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    // Don't use GetShownText() here; we want to show the user the variable references
    aList.push(new MSG_PANEL_ITEM('Table', `${this.m_colCount} Columns`));
  }

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_TABLE;

    if (this.m_cells.length !== other.m_cells.length) return 0.1;

    let similarity = 1.0;

    if (this.m_strokeExternal !== other.m_strokeExternal) similarity *= 0.9;

    if (this.m_StrokeHeaderSeparator !== other.m_StrokeHeaderSeparator) similarity *= 0.9;

    if (this.m_borderStroke.notEquals(other.m_borderStroke)) similarity *= 0.9;

    if (this.m_strokeRows !== other.m_strokeRows) similarity *= 0.9;

    if (this.m_strokeColumns !== other.m_strokeColumns) similarity *= 0.9;

    if (this.m_separatorsStroke.notEquals(other.m_separatorsStroke)) similarity *= 0.9;

    if (!mapEquals(this.m_colWidths, other.m_colWidths)) similarity *= 0.9;

    if (!mapEquals(this.m_rowHeights, other.m_rowHeights)) similarity *= 0.9;

    for (let ii = 0; ii < this.m_cells.length; ++ii)
      similarity *= this.m_cells[ii]!.Similarity(other.m_cells[ii]!);

    return similarity;
  }

  /** `operator==( const BOARD_ITEM& )`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    if (this.Type() !== aBoardItem.Type()) return false;

    const other = aBoardItem as PCB_TABLE;

    return this.equalsTable(other);
  }

  /** `operator==( const PCB_TABLE& )`. */
  equalsTable(aOther: PCB_TABLE): boolean {
    if (this.m_cells.length !== aOther.m_cells.length) return false;

    if (this.m_strokeExternal !== aOther.m_strokeExternal) return false;

    if (this.m_StrokeHeaderSeparator !== aOther.m_StrokeHeaderSeparator) return false;

    if (this.m_borderStroke.notEquals(aOther.m_borderStroke)) return false;

    if (this.m_strokeRows !== aOther.m_strokeRows) return false;

    if (this.m_strokeColumns !== aOther.m_strokeColumns) return false;

    if (this.m_separatorsStroke.notEquals(aOther.m_separatorsStroke)) return false;

    if (!mapEquals(this.m_colWidths, aOther.m_colWidths)) return false;

    if (!mapEquals(this.m_rowHeights, aOther.m_rowHeights)) return false;

    for (let ii = 0; ii < this.m_cells.length; ++ii) {
      if (!this.m_cells[ii]!.equals(aOther.m_cells[ii]!)) return false;
    }

    return true;
  }

  static Compare(aTable: PCB_TABLE, aOther: PCB_TABLE): number {
    let diff: number;

    diff = aTable.GetCells().length - aOther.GetCells().length;
    if (diff !== 0) return diff;

    diff = aTable.GetColCount() - aOther.GetColCount();
    if (diff !== 0) return diff;

    for (let col = 0; col < aTable.GetColCount(); ++col) {
      diff = aTable.GetColWidth(col) - aOther.GetColWidth(col);
      if (diff !== 0) return diff;
    }

    for (let row = 0; row < aTable.GetRowCount(); ++row) {
      diff = aTable.GetRowHeight(row) - aOther.GetRowHeight(row);
      if (diff !== 0) return diff;
    }

    for (let row = 0; row < aTable.GetRowCount(); ++row) {
      for (let col = 0; col < aTable.GetColCount(); ++col) {
        const cell = aTable.GetCell(row, col)!;
        const other = aOther.GetCell(row, col)!;

        diff = EDA_SHAPE.prototype.Compare.call(cell, other as unknown as EDA_SHAPE); // cell->PCB_SHAPE::Compare( other )
        if (diff !== 0) return diff;

        diff = EDA_TEXT.prototype.Compare.call(cell, other as unknown as EDA_TEXT); // cell->EDA_TEXT::Compare( other )
        if (diff !== 0) return diff;
      }
    }

    return 0;
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    if (!(aImage !== null && aImage.Type() === KICAD_T.PCB_TABLE_T)) return; // wxCHECK_RET( "Cannot swap data with invalid table." )

    const table = aImage as PCB_TABLE;

    [this.m_layer, table.m_layer] = [table.m_layer, this.m_layer];
    [this.m_isLocked, table.m_isLocked] = [table.m_isLocked, this.m_isLocked];
    [this.m_strokeExternal, table.m_strokeExternal] = [
      table.m_strokeExternal,
      this.m_strokeExternal,
    ];
    [this.m_StrokeHeaderSeparator, table.m_StrokeHeaderSeparator] = [
      table.m_StrokeHeaderSeparator,
      this.m_StrokeHeaderSeparator,
    ];
    [this.m_borderStroke, table.m_borderStroke] = [table.m_borderStroke, this.m_borderStroke];
    [this.m_strokeRows, table.m_strokeRows] = [table.m_strokeRows, this.m_strokeRows];
    [this.m_strokeColumns, table.m_strokeColumns] = [table.m_strokeColumns, this.m_strokeColumns];
    [this.m_separatorsStroke, table.m_separatorsStroke] = [
      table.m_separatorsStroke,
      this.m_separatorsStroke,
    ];
    [this.m_colCount, table.m_colCount] = [table.m_colCount, this.m_colCount];
    [this.m_colWidths, table.m_colWidths] = [table.m_colWidths, this.m_colWidths];
    [this.m_rowHeights, table.m_rowHeights] = [table.m_rowHeights, this.m_rowHeights];
    [this.m_cells, table.m_cells] = [table.m_cells, this.m_cells];

    for (const cell of this.m_cells) cell.SetParent(this);

    for (const cell of table.m_cells) cell.SetParent(table);
  }
}

function isBoardItem(a: unknown): a is BOARD_ITEM {
  return (
    typeof (a as BOARD_ITEM).Type === 'function' && typeof (a as BOARD_ITEM).GetLayer === 'function'
  );
}

/**
 * `static struct PCB_TABLE_DESC` (pcbnew/pcb_table.cpp).
 */
(() => {
  const lineStyleEnum = ENUM_MAP.Instance<LINE_STYLE>('LINE_STYLE');

  if (lineStyleEnum.Choices().GetCount() === 0) {
    lineStyleEnum
      .Map(LINE_STYLE.SOLID, 'Solid')
      .Map(LINE_STYLE.DASH, 'Dashed')
      .Map(LINE_STYLE.DOT, 'Dotted')
      .Map(LINE_STYLE.DASHDOT, 'Dash-Dot')
      .Map(LINE_STYLE.DASHDOTDOT, 'Dash-Dot-Dot');
  }

  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_TABLE);

  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLE, BOARD_ITEM));
  propMgr.AddTypeCast(new TYPE_CAST(PCB_TABLE, BOARD_ITEM_CONTAINER));
  propMgr.InheritsAfter(PCB_TABLE, BOARD_ITEM);
  propMgr.InheritsAfter(PCB_TABLE, BOARD_ITEM_CONTAINER);

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, number>(
      PCB_TABLE,
      'Start X',
      'SetPositionX',
      'GetPositionX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_X_COORD,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, number>(
      PCB_TABLE,
      'Start Y',
      'SetPositionY',
      'GetPositionY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
  );

  const tableProps = 'Table Properties';

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, boolean>(
      PCB_TABLE,
      'External Border',
      'SetStrokeExternal',
      'StrokeExternal',
      TYPE_BOOL,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, boolean>(
      PCB_TABLE,
      'Header Border',
      'SetStrokeHeaderSeparator',
      'StrokeHeaderSeparator',
      TYPE_BOOL,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, number>(
      PCB_TABLE,
      'Border Width',
      'SetBorderWidth',
      'GetBorderWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_TABLE, LINE_STYLE>(
      PCB_TABLE,
      'Border Style',
      'SetBorderStyle',
      'GetBorderStyle',
      lineStyleEnum,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, Color4d>(
      PCB_TABLE,
      'Border Color',
      'SetBorderColor',
      'GetBorderColor',
      TYPE_COLOR4D,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, boolean>(
      PCB_TABLE,
      'Row Separators',
      'SetStrokeRows',
      'StrokeRows',
      TYPE_BOOL,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, boolean>(
      PCB_TABLE,
      'Cell Separators',
      'SetStrokeColumns',
      'StrokeColumns',
      TYPE_BOOL,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, number>(
      PCB_TABLE,
      'Separators Width',
      'SetSeparatorsWidth',
      'GetSeparatorsWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY_ENUM<PCB_TABLE, LINE_STYLE>(
      PCB_TABLE,
      'Separators Style',
      'SetSeparatorsStyle',
      'GetSeparatorsStyle',
      lineStyleEnum,
    ),
    tableProps,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_TABLE, Color4d>(
      PCB_TABLE,
      'Separators Color',
      'SetSeparatorsColor',
      'GetSeparatorsColor',
      TYPE_COLOR4D,
    ),
    tableProps,
  );
})();

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
