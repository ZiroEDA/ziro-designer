// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_table.h` / `eeschema/sch_table.cpp`: `SCH_TABLE`, a grid of
 * `SCH_TABLECELL`s it owns.
 *
 * Not here: `Plot` (drawing), `GetMenuImage`,
 * `Serialize`/`Deserialize`, `SCH_TABLE_DESC`.
 */

import {
  ENUM_MAP,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_COLOR4D,
  TYPE_INT,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import type { EDA_ITEM, INSPECTOR } from '@ziroeda/common/eda_item.js';
import { INSPECT_RESULT, type RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { SCH_ITEM } from './sch_item.js';
import { SCH_TABLECELL } from './sch_tablecell.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

const sameIntMap = (a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

export class SCH_TABLE extends SCH_ITEM {
  protected m_strokeExternal: boolean;
  protected m_StrokeHeaderSeparator: boolean;
  protected m_borderStroke: STROKE_PARAMS;
  protected m_strokeRows: boolean;
  protected m_strokeColumns: boolean;
  protected m_separatorsStroke: STROKE_PARAMS;

  protected m_colCount: number;
  protected m_colWidths: Map<number, number>;
  protected m_rowHeights: Map<number, number>;
  protected m_cells: SCH_TABLECELL[];

  constructor(aLineWidth = 0) {
    super(null, KICAD_T.SCH_TABLE_T);
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
    this.m_colWidths = new Map();
    this.m_rowHeights = new Map();
    this.m_cells = [];

    this.SetLayer(SCH_LAYER_ID.LAYER_NOTES);
  }

  /** `SCH_TABLE( const SCH_TABLE& aTable )`: the cells are copied too. */
  static copyOf(aTable: SCH_TABLE): SCH_TABLE {
    const copy = SCH_ITEM.copySchItem(new SCH_TABLE(), aTable);

    copy.m_strokeExternal = aTable.m_strokeExternal;
    copy.m_StrokeHeaderSeparator = aTable.m_StrokeHeaderSeparator;
    copy.m_borderStroke = aTable.m_borderStroke.clone();
    copy.m_strokeRows = aTable.m_strokeRows;
    copy.m_strokeColumns = aTable.m_strokeColumns;
    copy.m_separatorsStroke = aTable.m_separatorsStroke.clone();
    copy.m_colCount = aTable.m_colCount;
    copy.m_colWidths = new Map(aTable.m_colWidths);
    copy.m_rowHeights = new Map(aTable.m_rowHeights);

    for (const src of aTable.m_cells) copy.AddCell(SCH_TABLECELL.copyOf(src));

    return copy;
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_TABLE_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_TABLE';
  }

  /** `GetMsgPanelInfo( aFrame, aList )` (sch_table.cpp). */
  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    // Don't use GetShownText() here; we want to show the user the variable references
    aList.push(new MSG_PANEL_ITEM('Table', `${this.m_colCount} Columns`));

    super.GetMsgPanelInfo(aFrame, aList);
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

  /**
   * `SCH_TABLE::DrawBorders` (sch_table.cpp:346): every border and separator line, with the
   * stroke it is drawn in, for the painter and the plotter.
   */
  DrawBorders(aCallback: (aPt1: VECTOR2I, aPt2: VECTOR2I, aStroke: STROKE_PARAMS) => void): void {
    const drawAngle = this.GetCell(0, 0)!.GetTextAngle();

    const topLeft = this.GetCell(0, 0)!.GetCornersInSequence(drawAngle);
    const bottomLeft = this.GetCell(this.GetRowCount() - 1, 0)!.GetCornersInSequence(drawAngle);
    const topRight = this.GetCell(0, this.GetColCount() - 1)!.GetCornersInSequence(drawAngle);
    const bottomRight = this.GetCell(
      this.GetRowCount() - 1,
      this.GetColCount() - 1,
    )!.GetCornersInSequence(drawAngle);
    let stroke: STROKE_PARAMS;

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

  override RunOnChildren(aFunction: (aItem: SCH_ITEM) => void, _aMode: RECURSE_MODE): void {
    for (const cell of this.m_cells) aFunction(cell);
  }

  /**
   * `operator<`. The C++ breaks the final tie on the first cells' addresses; creation
   * order is not observable here, so the first cells' uuids stand in.
   */
  override lessThan(aItem: SCH_ITEM): boolean {
    if (this.Type() !== aItem.Type()) return this.Type() < aItem.Type();

    const other = aItem as SCH_TABLE;

    if (this.m_cells.length !== other.m_cells.length)
      return this.m_cells.length < other.m_cells.length;

    if (this.GetPosition().x !== other.GetPosition().x)
      return this.GetPosition().x < other.GetPosition().x;

    if (this.GetPosition().y !== other.GetPosition().y)
      return this.GetPosition().y < other.GetPosition().y;

    return (this.m_cells[0]?.m_Uuid ?? '') < (other.m_cells[0]?.m_Uuid ?? '');
  }

  override SetPosition(aPos: VECTOR2I): void {
    const pos = this.GetPosition();
    this.Move({ x: aPos.x - pos.x, y: aPos.y - pos.y });
  }

  override GetPosition(): VECTOR2I {
    if (this.m_cells.length === 0) return { x: 0, y: 0 }; // Return origin if table has no cells

    return this.m_cells[0]!.GetPosition();
  }

  GetEnd(): VECTOR2I {
    const tableSize = { x: 0, y: 0 };

    for (let ii = 0; ii < this.GetColCount(); ++ii) tableSize.x += this.GetColWidth(ii);

    for (let ii = 0; ii < this.GetRowCount(); ++ii) tableSize.y += this.GetRowHeight(ii);

    const pos = this.GetPosition();
    return { x: pos.x + tableSize.x, y: pos.y + tableSize.y };
  }

  GetCenter(): VECTOR2I {
    const bbox = new BOX2I();

    for (const cell of this.m_cells) {
      bbox.Merge(cell.GetPosition());
      bbox.Merge(cell.GetEnd());
    }

    return bbox.GetCenter();
  }

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
    // size_t / int
    return Math.trunc(this.m_cells.length / this.m_colCount);
  }

  SetColWidth(aCol: number, aWidth: number): void {
    this.m_colWidths.set(aCol, aWidth);
  }
  GetColWidth(aCol: number): number {
    return this.m_colWidths.get(aCol) ?? 0;
  }

  SetRowHeight(aRow: number, aHeight: number): void {
    this.m_rowHeights.set(aRow, aHeight);
  }
  GetRowHeight(aRow: number): number {
    return this.m_rowHeights.get(aRow) ?? 0;
  }

  GetCell(aRow: number, aCol: number): SCH_TABLECELL | null {
    const idx = aRow * this.m_colCount + aCol;

    if (idx < this.m_cells.length) return this.m_cells[idx]!;
    else return null;
  }

  GetCells(): SCH_TABLECELL[] {
    return [...this.m_cells];
  }

  AddCell(aCell: SCH_TABLECELL): void {
    this.m_cells.push(aCell);
    aCell.SetParent(this);
  }

  InsertCell(aIdx: number, aCell: SCH_TABLECELL): void {
    this.m_cells.splice(aIdx, 0, aCell);
    aCell.SetParent(this);
  }

  ClearCells(): void {
    this.m_cells = [];
  }

  DeleteMarkedCells(): void {
    this.m_cells = this.m_cells.filter((cell) => !(cell.GetFlags() & STRUCT_DELETED));
  }

  /** Lay the cells out on the column widths and row heights, spans included. */
  Normalize(): void {
    // `std::map::operator[]` inserts a zero for a missing key
    const at = (m: Map<number, number>, k: number): number => {
      if (!m.has(k)) m.set(k, 0);
      return m.get(k)!;
    };

    let y = this.GetPosition().y;

    for (let row = 0; row < this.GetRowCount(); ++row) {
      let x = this.GetPosition().x;
      const rowHeight = at(this.m_rowHeights, row);

      for (let col = 0; col < this.GetColCount(); ++col) {
        const colWidth = at(this.m_colWidths, col);

        const cell = this.GetCell(row, col);

        if (!cell) continue; // Skip if cell doesn't exist (shouldn't happen, but be defensive)

        const pos = RotatePoint({ x, y }, this.GetPosition(), cell.GetTextAngle());

        if (!samePt(cell.GetPosition(), pos)) {
          cell.SetPosition(pos);
          cell.ClearRenderCache();
        }

        let end = { x: x + colWidth, y: y + rowHeight };

        if (cell.GetColSpan() > 1 || cell.GetRowSpan() > 1) {
          for (let ii = col + 1; ii < col + cell.GetColSpan(); ++ii)
            end.x += at(this.m_colWidths, ii);

          for (let ii = row + 1; ii < row + cell.GetRowSpan(); ++ii)
            end.y += at(this.m_rowHeights, ii);
        }

        end = RotatePoint(end, this.GetPosition(), cell.GetTextAngle());

        if (!samePt(cell.GetEnd(), end)) {
          cell.SetEnd(end);
          cell.ClearRenderCache();
        }

        x += colWidth;
      }

      y += rowHeight;
    }
  }

  override Move(aMoveVector: VECTOR2I): void {
    for (const cell of this.m_cells) cell.Move(aMoveVector);
  }

  override MirrorHorizontally(_aCenter: number): void {
    // We could mirror all the cells, but it doesn't seem useful....
  }

  override MirrorVertically(_aCenter: number): void {
    // We could mirror all the cells, but it doesn't seem useful....
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW: boolean): void {
    for (const cell of this.m_cells) cell.Rotate(aCenter, aRotateCCW);

    this.Normalize();
  }

  override GetBoundingBox(): BOX2I {
    if (this.m_cells.length === 0) return new BOX2I();

    // Note: a table with no cells is not allowed
    const bbox = this.m_cells[0]!.GetBoundingBox();

    bbox.Merge(this.m_cells[this.m_cells.length - 1]!.GetBoundingBox());

    return bbox;
  }

  override Visit(aInspector: INSPECTOR, aTestData: unknown, aScanTypes: readonly KICAD_T[]) {
    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === KICAD_T.SCH_TABLE_T) {
        if (INSPECT_RESULT.QUIT === aInspector(this, aTestData)) return INSPECT_RESULT.QUIT;
      }

      if (scanType === KICAD_T.SCH_LOCATE_ANY_T || scanType === KICAD_T.SCH_TABLECELL_T) {
        for (const cell of this.m_cells) {
          if (INSPECT_RESULT.QUIT === aInspector(cell, this)) return INSPECT_RESULT.QUIT;
        }
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  override Matches(_aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    // Symbols are searchable via the child field and pin item text.
    return false;
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return `${this.m_colCount} Column Table`;
  }

  override ViewGetLayers(): number[] {
    return [
      SCH_LAYER_ID.LAYER_NOTES,
      SCH_LAYER_ID.LAYER_NOTES_BACKGROUND,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
    ];
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
      const rect = new BOX2I(a.GetPosition(), a.GetSize());
      rect.Inflate(c ?? 0);

      if (b as boolean) return rect.Contains(this.GetBoundingBox());

      return rect.Intersects(this.GetBoundingBox());
    }

    if ('x' in a && 'y' in a) {
      const rect = this.GetBoundingBox();
      rect.Inflate((b as number | undefined) ?? 0);
      return rect.Contains(a);
    }

    return KIGEOM_BoxHitTestChain(a, this.GetBoundingBox(), b as boolean);
  }

  override Clone(): SCH_TABLE {
    return SCH_TABLE.copyOf(this);
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as SCH_TABLE;

    if (this.m_cells.length !== other.m_cells.length) return 0.1;

    let similarity = 1.0;

    for (let ii = 0; ii < this.m_cells.length; ++ii)
      similarity *= this.m_cells[ii]!.Similarity(other.m_cells[ii]!);

    return similarity;
  }

  override equals(aOther: SCH_ITEM): boolean {
    if (this.Type() !== aOther.Type()) return false;

    const other = aOther as SCH_TABLE;

    if (this.m_cells.length !== other.m_cells.length) return false;

    if (!sameIntMap(this.m_colWidths, other.m_colWidths)) return false;

    if (!sameIntMap(this.m_rowHeights, other.m_rowHeights)) return false;

    for (let ii = 0; ii < this.m_cells.length; ++ii) {
      if (!this.m_cells[ii]!.equals(other.m_cells[ii]!)) return false;
    }

    return true;
  }

  protected override swapData(aItem: SCH_ITEM): void {
    if (!(aItem && aItem.Type() === KICAD_T.SCH_TABLE_T)) return; // wxCHECK_RET

    const table = aItem as SCH_TABLE;

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

/**
 * `static struct SCH_TABLE_DESC` (eeschema/sch_table.cpp:521). The LINE_STYLE map is filled by
 * whoever registers first (sch_line, eda_shape), as upstream.
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(SCH_TABLE);

  propMgr.AddTypeCast(new TYPE_CAST(SCH_TABLE, SCH_ITEM));
  propMgr.InheritsAfter(SCH_TABLE, SCH_ITEM);

  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, number>(
      SCH_TABLE,
      'Start X',
      'SetPositionX',
      'GetPositionX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_X_COORD,
    ),
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, number>(
      SCH_TABLE,
      'Start Y',
      'SetPositionY',
      'GetPositionY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
  );

  const tableProps = 'Table Properties';
  const lineStyleEnum = ENUM_MAP.Instance<LINE_STYLE>('LINE_STYLE');

  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, boolean>(
      SCH_TABLE,
      'External Border',
      'SetStrokeExternal',
      'StrokeExternal',
      TYPE_BOOL,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, boolean>(
      SCH_TABLE,
      'Header Border',
      'SetStrokeHeaderSeparator',
      'StrokeHeaderSeparator',
      TYPE_BOOL,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, number>(
      SCH_TABLE,
      'Border Width',
      'SetBorderWidth',
      'GetBorderWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<SCH_TABLE, LINE_STYLE>(
      SCH_TABLE,
      'Border Style',
      'SetBorderStyle',
      'GetBorderStyle',
      lineStyleEnum,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, Color4d>(
      SCH_TABLE,
      'Border Color',
      'SetBorderColor',
      'GetBorderColor',
      TYPE_COLOR4D,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, boolean>(
      SCH_TABLE,
      'Row Separators',
      'SetStrokeRows',
      'StrokeRows',
      TYPE_BOOL,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, boolean>(
      SCH_TABLE,
      'Cell Separators',
      'SetStrokeColumns',
      'StrokeColumns',
      TYPE_BOOL,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, number>(
      SCH_TABLE,
      'Separators Width',
      'SetSeparatorsWidth',
      'GetSeparatorsWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_SIZE,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY_ENUM<SCH_TABLE, LINE_STYLE>(
      SCH_TABLE,
      'Separators Style',
      'SetSeparatorsStyle',
      'GetSeparatorsStyle',
      lineStyleEnum,
    ),
    tableProps,
  );
  propMgr.AddProperty(
    new PROPERTY<SCH_TABLE, Color4d>(
      SCH_TABLE,
      'Separators Color',
      'SetSeparatorsColor',
      'GetSeparatorsColor',
      TYPE_COLOR4D,
    ),
    tableProps,
  );
})();
