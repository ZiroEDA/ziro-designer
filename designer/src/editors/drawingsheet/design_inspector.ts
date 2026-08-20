// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_INSPECTOR::ReCreateDesignList`
 * (pagelayout_editor/dialogs/design_inspector.cpp:205-315) — what the Design
 * Inspector's grid actually contains, as data rather than as JSX, so it can be
 * checked against the C++ line by line.
 *
 * The grid is five columns (`COL_INDEX`, :178-186) with the headers
 * `-` / `Type` / `Count` / `Comment` / `Text`
 * (dialog_design_inspector_base.cpp:35-39), a 40 px row-label gutter carrying
 * wxGrid's own 1-based row numbers (:45), and a leading pseudo-row describing
 * the page rather than an item.
 */
import { WKS_ITEM_TYPE_LABEL, type WksItem } from '@ziroeda/common';

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
}

/**
 * `SetTitle( fn.GetName() )` / `SetTitle( "<default drawing sheet>" )`
 * (design_inspector.cpp:216-221). `wxFileName::GetName()` is the base name
 * without its extension, which `frameTitleName` already implements for the
 * window title, so the caller passes the result of that.
 */
export function dsInspectorTitle(baseName: string): string {
  return baseName.trim() === '' ? DS_INSPECTOR_DEFAULT_TITLE : baseName;
}

/**
 * The grid, root row first.
 *
 * `paperType` is `PAGE_INFO::GetTypeAsString()` — the page type NAME, `A3`,
 * and not a description of it; ours used to put the whole
 * `A4 297x210mm landscape` string there and leave the Text column empty, where
 * KiCad puts `A3` and `Size: 420.0x297.0mm`.
 */
export function dsInspectorRows(
  items: readonly WksItem[],
  paperType: string,
  pageMM: readonly [number, number],
): DsInspectorRow[] {
  const rows: DsInspectorRow[] = [
    {
      number: 1,
      type: 'Layout',
      count: '-',
      comment: paperType,
      // wxString::Format( _( "Size: %.1fx%.1fmm" ), … ) — :232-235.
      text: `Size: ${pageMM[0].toFixed(1)}x${pageMM[1].toFixed(1)}mm`,
      itemIndex: null,
    },
  ];

  items.forEach((it, i) => {
    rows.push({
      number: i + 2,
      type: WKS_ITEM_TYPE_LABEL[it.type],
      count: String(it.repeat),
      // m_Info verbatim: an empty comment leaves an EMPTY cell. Ours drew a
      // grey "-" in every one of them, which reads as a value.
      comment: it.comment,
      text: it.type === 'text' ? it.text : '',
      itemIndex: i,
    });
  });

  return rows;
}
