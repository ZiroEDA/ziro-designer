// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `${#}` and `${##}` in the Drawing Sheet Editor, driven through the real
 * layout engine rather than grepped for.
 *
 * The bug: the `Page 1 / Other pages` selector was feeding the title block.
 * Ours resolved `${#}/${##}` to `2/2` on `Other pages`; a pl_editor driven over
 * XTEST reads `Id: 1/1` under BOTH selector positions while 6266 canvas pixels
 * change between them, so the page layers toggle and the numbering does not
 * (`qa/probes/pl_e2e`; `DS_DRAW_ITEM_LIST` starts at page "1" of 1,
 * ds_draw_item.h:409-410, and `PL_DRAW_PANEL_GAL::DisplayDrawingSheet`
 * overrides neither, pl_draw_panel_gal.cpp:100-103).
 *
 * The printout is the one place a number moves, and only the numerator:
 * `SetVirtualPageNumber( aPageNum )` (dialogs_for_printing.cpp:189) reaches
 * `GetPageNumber()`, while `GetPageCount()` stays at `BASE_SCREEN`'s 1
 * (base_screen.cpp:39) because nothing in pl_editor calls `SetPageCount`. A
 * printed second sheet is page 2 of 1.
 *
 * These go through `layoutDrawingSheet` — the same call the canvas and the
 * print path make — so a context that carried the right numbers to an engine
 * that ignored them would fail here. Asserting the constants alone could not
 * tell that apart.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DS_CANVAS_PAGE_NUMBERING,
  dsPrintPageNumbering,
} from '@ziroeda/designer/src/editors/drawingsheet/page_numbering.js';
import { layoutDrawingSheet, type WksSheet } from '@ziroeda/common';

const A4 = { widthMM: 297, heightMM: 210 };

/** `(tbtext "Id: ${#}/${##}")` plus one item per page option. */
const base = {
  name: '',
  repeat: 1,
  incrx: 0,
  incry: 0,
  incrlabel: 1,
  comment: '',
};

const SHEET: WksSheet = {
  version: 20220228,
  generator: 'pl_editor',
  setup: {
    textW: 1.5,
    textH: 1.5,
    lineWidth: 0.15,
    textLineWidth: 0.15,
    leftMargin: 10,
    rightMargin: 10,
    topMargin: 10,
    bottomMargin: 10,
  },
  items: [
    {
      ...base,
      type: 'text',
      option: 'normal',
      text: 'Id: ${#}/${##}',
      pos: { x: 20, y: 20, corner: 'ltcorner' },
      fontW: 0,
      fontH: 0,
      bold: false,
      italic: false,
      lineWidth: 0,
      hjustify: 'left',
      vjustify: 'center',
      rotate: 0,
      maxlen: 0,
      maxheight: 0,
    },
    {
      ...base,
      type: 'line',
      option: 'page1only',
      start: { x: 30, y: 30, corner: 'ltcorner' },
      end: { x: 40, y: 30, corner: 'ltcorner' },
      lineWidth: 0,
    },
    {
      ...base,
      type: 'line',
      option: 'notonpage1',
      start: { x: 30, y: 40, corner: 'ltcorner' },
      end: { x: 40, y: 40, corner: 'ltcorner' },
      lineWidth: 0,
    },
  ],
};

/** The `Id: …` string the sheet renders under a given context. */
function idText(ctx: Record<string, unknown>): string {
  const draws = layoutDrawingSheet(SHEET, A4, ctx);
  const text = draws.find((d) => d.kind === 'text');
  if (!text || text.kind !== 'text') throw new Error('no text item was laid out');
  return text.text;
}

describe('the canvas numbering never follows the page selector', () => {
  it('reads 1/1 on "Page 1", as the driven pl_editor does', () => {
    expect(idText({ pageNumber: 1, ...DS_CANVAS_PAGE_NUMBERING })).toBe('Id: 1/1');
  });

  it('reads 1/1 on "Other pages" too', () => {
    // The whole bug in one line: this used to be `Id: 2/2`.
    expect(idText({ pageNumber: 2, ...DS_CANVAS_PAGE_NUMBERING })).toBe('Id: 1/1');
  });

  it('still hides and shows the page-option items between the two', () => {
    // The selector has to keep doing its real job — the layer toggle — or the
    // fix above would be "make the two pages identical", which is a different
    // bug wearing the same green tick.
    const one = layoutDrawingSheet(SHEET, A4, { pageNumber: 1, ...DS_CANVAS_PAGE_NUMBERING });
    const other = layoutDrawingSheet(SHEET, A4, { pageNumber: 2, ...DS_CANVAS_PAGE_NUMBERING });
    const ys = (ds: ReturnType<typeof layoutDrawingSheet>): number[] =>
      ds.filter((d) => d.kind === 'line').map((d) => (d.kind === 'line' ? d.a.y : 0));
    expect(ys(one)).toHaveLength(1);
    expect(ys(other)).toHaveLength(1);
    expect(ys(one)).not.toEqual(ys(other));
  });
});

describe('the printout numbers the sheets and not the total', () => {
  it('prints page 1 as 1/1', () => {
    expect(idText({ pageNumber: 1, ...dsPrintPageNumbering(1) })).toBe('Id: 1/1');
  });

  it('prints page 2 as 2 of 1, which is what GetPageCount() gives it', () => {
    expect(idText({ pageNumber: 2, ...dsPrintPageNumbering(2) })).toBe('Id: 2/1');
  });

  it('never invents a total of 2', () => {
    for (const n of [1, 2, 3]) expect(dsPrintPageNumbering(n).sheetCount).toBe(1);
  });
});

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

/** Statements only: a commented-out line must not satisfy any of these. */
function statements(src: string, needle: string): string[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .filter((l) => l.includes(needle));
}

describe('the frame states no page numbering of its own', () => {
  /*
   * The module above can be right while the frame ignores it, which is the
   * exact failure this whole audit is about. The frame is a `.tsx` and `qa`'s
   * tsconfig sets no `--jsx`, so the seam has to be read rather than run.
   */
  it('never writes a sheet count', () => {
    // `sheetCount: pageNumber > 1 ? 2 : 1` — twice — is what was here.
    expect(statements(EDITOR, 'sheetCount')).toHaveLength(0);
    expect(statements(EDITOR, 'pageName')).toHaveLength(0);
  });

  it('spreads the canvas defaults into the render context', () => {
    expect(statements(EDITOR, '...DS_CANVAS_PAGE_NUMBERING,')).toHaveLength(1);
  });

  it('spreads the printout’s numbering into the printed page’s context', () => {
    expect(statements(EDITOR, '...dsPrintPageNumbering(aPageNum)')).toHaveLength(1);
  });
});
