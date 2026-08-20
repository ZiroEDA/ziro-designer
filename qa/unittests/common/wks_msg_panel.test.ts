// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-17 — `DS_DRAW_ITEM_BASE::GetMsgPanelInfo`
 * (`common/drawing_sheet/ds_draw_item.cpp:107-168`) and the rule that the
 * message panel is REPLACED rather than appended to.
 *
 * The driven audit selected a Text item in real `pl_editor` and read exactly
 * six fields off the panel:
 *
 *     Text / A · First Page Option / All Pages · Repeat Count / 100 ·
 *     Repeat Label Increment / 1 ·
 *     Repeat Position Increment / (0.00 mils, 1.97 mils) · Comment /
 *
 * Ours kept `Page Width | Page Height | Paper | Page` on screen and appended a
 * `Selected / 1` row, because our panel was built from the page rather than
 * from the selection. `EDA_DRAW_FRAME::SetMsgPanel`
 * (`common/eda_draw_frame.cpp:955-964`) calls `EraseMsgBox()` first, and
 * `PL_EDITOR_CONTROL::UpdateMessagePanel`
 * (`pagelayout_editor/tools/pl_editor_control.cpp:147-179`) chooses one source
 * or the other, so the two sets can never be on screen together.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  wksItemMsgPanelInfo,
  WKS_ITEM_TYPE_LABEL,
  WKS_PAGE1_OPTION_LABEL,
  defaultDrawingSheet,
  type WksItem,
  type WksText,
  type WksLine,
} from '@ziroeda/common';

/** `MessageTextFromValue` in mils with its unit label, as the frame passes it. */
const mils = (mm: number): string => `${((mm / 25.4) * 1000).toFixed(2)} mils`;

const text = (over: Partial<WksText> = {}): WksText => {
  const sheet = defaultDrawingSheet();
  const t = sheet.items.find((i): i is WksText => i.type === 'text');
  if (!t) throw new Error('default sheet has no text item');
  return { ...t, ...over };
};

describe('wksItemMsgPanelInfo', () => {
  it('produces the six rows the audit read off pl_editor, in order', () => {
    const rows = wksItemMsgPanelInfo(
      text({
        text: 'A',
        option: 'normal',
        repeat: 100,
        incrlabel: 1,
        incrx: 0,
        incry: 0.05,
        comment: '',
      }),
      mils,
    );

    expect(rows.map((r) => r.upper)).toEqual([
      'Text',
      'First Page Option',
      'Repeat Count',
      'Repeat Label Increment',
      'Repeat Position Increment',
      'Comment',
    ]);
    expect(rows.map((r) => r.lower)).toEqual([
      'A',
      'All Pages',
      '100',
      '1',
      '(0.00 mils, 1.97 mils)',
      '',
    ]);
  });

  it('shows the raw ${…} reference, not its substitution (ds_draw_item.cpp:130)', () => {
    // "Don't use GetShownText(); we want to see the variable references here"
    const rows = wksItemMsgPanelInfo(text({ text: '${TITLE}' }), mils);
    expect(rows[0]?.lower).toBe('${TITLE}');
  });

  it('leaves the type row empty for every non-text item', () => {
    for (const t of ['line', 'rect', 'polygon', 'bitmap'] as const) {
      const item = { ...text(), type: t } as unknown as WksItem;
      expect(wksItemMsgPanelInfo(item, mils)[0]?.lower).toBe('');
    }
  });

  it('names a polygon "Imported Shape" (ds_data_item.cpp:374)', () => {
    expect(WKS_ITEM_TYPE_LABEL).toEqual({
      line: 'Line',
      rect: 'Rectangle',
      text: 'Text',
      polygon: 'Imported Shape',
      bitmap: 'Image',
    });
  });

  it('maps the three page-1 options to KiCad’s strings', () => {
    expect(WKS_PAGE1_OPTION_LABEL).toEqual({
      page1only: 'First Page Only',
      notonpage1: 'Subsequent Pages',
      normal: 'All Pages',
    });
    const line = { ...text(), type: 'line' } as unknown as WksLine;
    expect(wksItemMsgPanelInfo({ ...line, option: 'page1only' }, mils)[1]?.lower).toBe(
      'First Page Only',
    );
    expect(wksItemMsgPanelInfo({ ...line, option: 'notonpage1' }, mils)[1]?.lower).toBe(
      'Subsequent Pages',
    );
  });
});

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

/** The body of the `dsMsgPanelItems` memo, which is the whole panel. */
const MSG_PANEL_BODY = (() => {
  const at = EDITOR.indexOf('const dsMsgPanelItems');
  expect(at, 'dsMsgPanelItems memo not found').toBeGreaterThan(-1);
  return EDITOR.slice(at, EDITOR.indexOf('}, [', at));
})();

describe('PL_EDITOR_FRAME message panel', () => {
  it('falls back to Page Width and Page Height and nothing else', () => {
    // pl_editor_frame.cpp:968-977 emplaces exactly two rows.
    const uppers = [...MSG_PANEL_BODY.matchAll(/upper: '([^']*)'/g)].map((m) => m[1]);
    expect(uppers).toEqual(['Page Width', 'Page Height']);
  });

  it('routes a single selection through the item’s own rows', () => {
    expect(MSG_PANEL_BODY).toContain('selection.size === 1');
    expect(MSG_PANEL_BODY).toContain('wksItemMsgPanelInfo');
  });

  it('no longer shows the invented Paper / Page / Selected rows', () => {
    for (const gone of ["upper: 'Paper'", "upper: 'Page'", "upper: 'Selected'"])
      expect(MSG_PANEL_BODY).not.toContain(gone);
  });

  it('appends the unit label MessageTextFromValue adds by default', () => {
    // include/units_provider.h:127 — aAddUnitLabel = true.
    expect(MSG_PANEL_BODY).toContain('unitText(u)');
  });
});
