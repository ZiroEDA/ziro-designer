// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-18 — what the Design Inspector's grid actually contains, against
 * `DIALOG_INSPECTOR::ReCreateDesignList`
 * (pagelayout_editor/dialogs/design_inspector.cpp:205-315) and its wxFormBuilder
 * base (dialog_design_inspector_base.cpp:26-46).
 *
 * The audit's table, all seven rows of it:
 *
 *   dialog title         file base name, or `<default drawing sheet>`
 *   row-number gutter    yes (SetRowLabelSize( 40 ))
 *   first column header  `-`
 *   root row Comment     `A3`  (the page TYPE, not a description of the page)
 *   root row Text        `Size: 420.0x297.0mm`
 *   empty Comment cells  blank
 *   type glyphs          colour XPM bitmaps
 */
import { describe, expect, it } from 'vitest';
import {
  DS_INSPECTOR_COLUMNS,
  DS_INSPECTOR_DEFAULT_TITLE,
  dsInspectorRows,
  dsInspectorTitle,
} from '@ziroeda/designer/src/editors/drawingsheet/design_inspector.js';
import { defaultDrawingSheet, type WksItem, type WksText } from '@ziroeda/common';

const items = defaultDrawingSheet().items;

describe('dsInspectorTitle', () => {
  it('names the sheet, base name only', () => {
    expect(dsInspectorTitle('pagelayout_default')).toBe('pagelayout_default');
  });

  it('falls back to <default drawing sheet> when nothing is loaded', () => {
    // design_inspector.cpp:218-221 — `if( fn.GetName().IsEmpty() )`.
    expect(dsInspectorTitle('')).toBe(DS_INSPECTOR_DEFAULT_TITLE);
    expect(dsInspectorTitle('   ')).toBe(DS_INSPECTOR_DEFAULT_TITLE);
  });
});

describe('the column headers', () => {
  it('are KiCad’s five, the first of which is a dash', () => {
    // dialog_design_inspector_base.cpp:35-39. Ours left the first one empty.
    expect(DS_INSPECTOR_COLUMNS).toEqual(['-', 'Type', 'Count', 'Comment', 'Text']);
  });
});

describe('the root row', () => {
  const root = dsInspectorRows(items, 'A3', [420, 297])[0];

  it('is row 1, is called Layout and has no repeat count', () => {
    expect(root?.number).toBe(1);
    expect(root?.type).toBe('Layout');
    expect(root?.count).toBe('-');
  });

  it('puts the page TYPE in Comment (GetTypeAsString)', () => {
    // page_info.cpp:153-157 returns the enum name, "A3". Ours put the whole
    // "A4 297x210mm landscape" description there.
    expect(root?.comment).toBe('A3');
  });

  it('puts the page SIZE in Text', () => {
    // wxString::Format( _( "Size: %.1fx%.1fmm" ), … ) — :232-235. Ours left the
    // cell empty.
    expect(root?.text).toBe('Size: 420.0x297.0mm');
  });

  it('is not a DS_DATA_ITEM, so a click on it selects nothing', () => {
    // m_itemsList.push_back( nullptr ) — :238.
    expect(root?.itemIndex).toBeNull();
  });
});

describe('the item rows', () => {
  const rows = dsInspectorRows(items, 'A4', [297, 210]);

  it('number from 2 and index the sheet from 0', () => {
    expect(rows).toHaveLength(items.length + 1);
    expect(rows[1]?.number).toBe(2);
    expect(rows[1]?.itemIndex).toBe(0);
    expect(rows[rows.length - 1]?.itemIndex).toBe(items.length - 1);
  });

  it('leave an empty comment EMPTY', () => {
    // COL_COMMENT is `item->m_Info` verbatim (:276). Ours drew a grey "-" in
    // every blank cell, which reads as a value.
    const blank = rows.find((r) => r.itemIndex !== null && items[r.itemIndex]?.comment === '');
    expect(blank, 'default sheet has no un-commented item').toBeDefined();
    expect(blank?.comment).toBe('');
  });

  it('show a text item’s raw m_TextBase and nothing for the others', () => {
    const text = rows.find(
      (r) => r.itemIndex !== null && items[r.itemIndex]?.type === 'text',
    ) as (typeof rows)[number];
    expect(text.text).toBe((items[text.itemIndex as number] as WksText).text);

    for (const r of rows.slice(1)) {
      if (r.itemIndex !== null && items[r.itemIndex]?.type !== 'text') expect(r.text).toBe('');
    }
  });

  it('name a polygon "Imported Shape" (DS_DATA_ITEM::GetClassName)', () => {
    const poly = { ...(items[0] as WksItem), type: 'polygon', repeat: 1 } as WksItem;
    expect(dsInspectorRows([poly], 'A4', [297, 210])[1]?.type).toBe('Imported Shape');
  });
});
