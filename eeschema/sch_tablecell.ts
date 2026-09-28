// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_tablecell.h` / `eeschema/sch_tablecell.cpp`: `SCH_TABLECELL`, one cell of
 * a `SCH_TABLE` — a text box with a row and column span.
 *
 * Not here: `Plot`, `GetMsgPanelInfo`, `Serialize`/`Deserialize`, `SCH_TABLECELL_DESC`.
 */

import { RESOLVE_TEXT_RECURSION_DEPTH, ResolveTextVars } from '@ziroeda/common/common.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import type { EDA_ITEM, OutStr } from '@ziroeda/common/eda_item.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_TABLE } from './sch_table.js';
import { SCH_TEXTBOX } from './sch_textbox.js';

/** `parseCellAddress`: "B3" -> row 3, column 1 (rows are 0-based as written). */
function parseCellAddress(aAddr: string): { row: number; col: number } | null {
  if (aAddr === '') return null;

  let i = 0;
  let colPart = '';

  while (i < aAddr.length && /\p{L}/u.test(aAddr[i]!)) {
    colPart += aAddr[i]!.toUpperCase();
    i++;
  }

  if (colPart === '') return null;

  let col = 0;

  for (let j = 0; j < colPart.length; j++) col = col * 26 + (colPart.charCodeAt(j) - 65 + 1);

  col -= 1; // Convert to 0-based

  const rowPart = aAddr.slice(i);

  if (rowPart === '' || !/^[+-]?\d+$/.test(rowPart)) return null;

  const rowNum = Number.parseInt(rowPart, 10);

  if (rowNum < 0) return null;

  return { row: rowNum, col }; // Already 0-based
}

export class SCH_TABLECELL extends SCH_TEXTBOX {
  protected m_colSpan: number;
  protected m_rowSpan: number;

  constructor(aLineWidth = 0, aFillType: FILL_T = FILL_T.NO_FILL) {
    super(SCH_LAYER_ID.LAYER_NOTES, aLineWidth, aFillType, '', KICAD_T.SCH_TABLECELL_T);
    this.m_colSpan = 1;
    this.m_rowSpan = 1;
  }

  static copyOf(aOther: SCH_TABLECELL): SCH_TABLECELL {
    const copy = SCH_TEXTBOX.copyTextBox(new SCH_TABLECELL(), aOther);
    copy.m_colSpan = aOther.m_colSpan;
    copy.m_rowSpan = aOther.m_rowSpan;
    return copy;
  }

  static override ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && KICAD_T.SCH_TABLECELL_T === aItem.Type();
  }

  override GetClass(): string {
    return 'SCH_TABLECELL';
  }

  override GetItemDescription(_aUnitsProvider: UNITS_PROVIDER | null, _aFull: boolean): string {
    return `Table Cell ${this.GetAddr()}`;
  }

  override Clone(): SCH_TABLECELL {
    return SCH_TABLECELL.copyOf(this);
  }

  override GetParentGroup(): EDA_GROUP | null {
    return this.GetParent()?.GetParentGroup() ?? null;
  }

  private table(): SCH_TABLE {
    return this.GetParent() as unknown as SCH_TABLE;
  }

  GetRow(): number {
    const table = this.table();

    for (let row = 0; row < table.GetRowCount(); ++row) {
      for (let col = 0; col < table.GetColCount(); ++col) {
        if (table.GetCell(row, col) === this) return row;
      }
    }

    return -1;
  }

  GetColumn(): number {
    const table = this.table();

    for (let row = 0; row < table.GetRowCount(); ++row) {
      for (let col = 0; col < table.GetColCount(); ++col) {
        if (table.GetCell(row, col) === this) return col;
      }
    }

    return -1;
  }

  GetAddr(): string {
    return `${String.fromCharCode(65 + (this.GetColumn() % 26))}${this.GetRow()}`;
  }

  override GetShownText(aAllowExtraText: boolean, aDepth?: number): string;
  override GetShownText(
    aSettings: RENDER_SETTINGS | null,
    aPath: SCH_SHEET_PATH | null,
    aAllowExtraText: boolean,
    aDepth?: number,
  ): string;
  override GetShownText(
    a: RENDER_SETTINGS | null | boolean,
    b?: SCH_SHEET_PATH | null | number,
    c?: boolean,
    d?: number,
  ): string {
    if (typeof a === 'boolean') {
      const schematic = this.Schematic();
      const sheetPath = schematic ? schematic.CurrentSheet() : null;

      return this.GetShownText(null, sheetPath, a, (b as number | undefined) ?? 0);
    }

    const aSettings = a;
    const aPath = (b as SCH_SHEET_PATH | null | undefined) ?? null;
    const aAllowExtraText = c ?? false;
    const aDepth = d ?? 0;

    const depth = 0;
    const sheet = aPath ? aPath.Last() : null;

    const tableCellResolver = (token: OutStr): boolean => {
      const t = token.value;

      if (t === 'ROW') {
        token.value = String(this.GetRow()); // 0-based
        return true;
      } else if (t === 'COL') {
        token.value = String(this.GetColumn()); // 0-based
        return true;
      } else if (t === 'ADDR') {
        token.value = this.GetAddr();
        return true;
      } else if (t.startsWith('CELL(') && t.endsWith(')')) {
        const args = t.slice(5, -1).trim(); // Extract arguments
        const table = this.GetParent() as unknown as SCH_TABLE | null;

        if (!table) {
          token.value = '<Unresolved: CELL() requires table context>';
          return true;
        }

        let targetRow = -1;
        let targetCol = -1;

        if (args.startsWith('"') && args.endsWith('"')) {
          const addr = args.slice(1, -1); // Remove quotes
          const parsed = parseCellAddress(addr);

          if (!parsed) {
            token.value = `<Unresolved: Invalid cell address: ${addr}>`;
            return true;
          }

          targetRow = parsed.row;
          targetCol = parsed.col;
        } else if (args.includes(',')) {
          const comma = args.indexOf(',');
          const rowStr = args.slice(0, comma).trim();
          const colStr = args.slice(comma + 1).trim();

          if (!/^[+-]?\d+$/.test(rowStr) || !/^[+-]?\d+$/.test(colStr)) {
            token.value = `<Unresolved: Invalid cell coordinates: ${args}>`;
            return true;
          }

          targetRow = Number.parseInt(rowStr, 10);
          targetCol = Number.parseInt(colStr, 10);
        } else {
          token.value = `<Unresolved: Invalid CELL() syntax: ${args}>`;
          return true;
        }

        if (
          targetRow < 0 ||
          targetRow >= table.GetRowCount() ||
          targetCol < 0 ||
          targetCol >= table.GetColCount()
        ) {
          let cellAddr: string;

          if (targetRow >= 0 && targetCol >= 0)
            cellAddr = `${String.fromCharCode(65 + (targetCol % 26))}${targetRow}`;
          else cellAddr = args;

          token.value = `<Unresolved: Cell ${cellAddr} not found>`;
          return true;
        }

        const targetCell = table.GetCell(targetRow, targetCol);

        if (targetCell) {
          if (aDepth >= RESOLVE_TEXT_RECURSION_DEPTH) {
            token.value = '<Circular reference>';
            return true;
          }

          token.value = targetCell.GetShownText(aSettings, aPath, aAllowExtraText, aDepth + 1);
          return true;
        } else {
          token.value = '<Unresolved: Cell not found>';
          return true;
        }
      }

      if (sheet) {
        if (sheet.ResolveTextVar(aPath, token, depth + 1)) return true;
      }

      return false;
    };

    let text = EDA_TEXT.prototype.GetShownText.call(this, aAllowExtraText, depth);

    if (this.HasTextVars()) text = ResolveTextVars(text, tableCellResolver, { value: depth });

    const size = { x: this.GetEnd().x - this.GetStart().x, y: this.GetEnd().y - this.GetStart().y };
    let colWidth: number;

    if (this.GetTextAngle().IsVertical())
      colWidth = Math.abs(size.y) - (this.GetMarginTop() + this.GetMarginBottom());
    else colWidth = Math.abs(size.x) - (this.GetMarginLeft() + this.GetMarginRight());

    const wrapped = { value: text };
    this.GetDrawFont(aSettings).LinebreakText(
      wrapped,
      colWidth,
      this.GetTextSize(),
      this.GetEffectiveTextPenWidth(),
      this.IsBold(),
      this.IsItalic(),
    );
    text = wrapped.value;

    // Only convert escape markers at the top level: a CELL() reference must keep them.
    if (aDepth === 0) {
      text = text.replaceAll('<<<ESC_DOLLAR:', '${');
      text = text.replaceAll('<<<ESC_AT:', '@{');
    }

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
    return this.table().GetRowHeight(this.GetRow());
  }

  SetRowHeight(aHeight: number): void {
    const table = this.table();
    table.SetRowHeight(this.GetRow(), aHeight);
    table.Normalize();
  }

  GetColumnWidth(): number {
    return this.table().GetColWidth(this.GetColumn());
  }

  SetColumnWidth(aWidth: number): void {
    const table = this.table();
    table.SetColWidth(this.GetColumn(), aWidth);
    table.Normalize();
  }

  override IsFilledForHitTesting(): boolean {
    return true;
  }

  override Similarity(aOtherItem: SCH_ITEM): number {
    if (aOtherItem.Type() !== this.Type()) return 0.0;

    const other = aOtherItem as SCH_TABLECELL;

    let similarity = 1.0;

    if (this.m_colSpan !== other.m_colSpan) similarity *= 0.9;

    if (this.m_rowSpan !== other.m_rowSpan) similarity *= 0.9;

    similarity *= super.Similarity(other);

    return similarity;
  }

  override equals(aOtherItem: SCH_ITEM): boolean {
    if (aOtherItem.Type() !== this.Type()) return false;

    const other = aOtherItem as SCH_TABLECELL;

    return (
      this.m_colSpan === other.m_colSpan &&
      this.m_rowSpan === other.m_rowSpan &&
      super.equals(other)
    );
  }

  protected override swapData(aItem: SCH_ITEM): void {
    super.swapData(aItem);

    const cell = aItem as SCH_TABLECELL;
    [this.m_colSpan, cell.m_colSpan] = [cell.m_colSpan, this.m_colSpan];
    [this.m_rowSpan, cell.m_rowSpan] = [cell.m_rowSpan, this.m_rowSpan];
  }
}
